export function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function slugify(value = "") {
  const slug = String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "artigo";
}

export async function uniqueSlug(client, title, ignoreId = null) {
  const base = slugify(title);
  let candidate = base;
  let n = 2;

  while (true) {
    const params = [candidate];
    let sql = "SELECT id FROM articles WHERE slug = $1";
    if (ignoreId) {
      params.push(ignoreId);
      sql += " AND id <> $2";
    }
    const result = await client.query(sql, params);
    if (!result.rows.length) return candidate;
    candidate = `${base}-${n++}`;
  }
}

export function statusLabel(status) {
  return ({
    draft: "Rascunho",
    review: "Em revisão",
    published: "Publicado",
    archived: "Arquivado",
  })[status] || status;
}

export function canEditArticle(article, user) {
  if (!user) return false;
  if (user.role === "admin") return true;
  return Number(article.author_id) === Number(user.id)
    && ["draft", "review"].includes(article.status);
}

export function formatDate(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(value));
}

function inlineMarkup(text, referenceIndex = new Map()) {
  let safe = escapeHtml(text);
  safe = safe.replace(/\[\^([A-Za-z0-9_-]{1,40})\]/g, (_match, key) => {
    const ref = referenceIndex.get(key.toLowerCase());
    if (!ref) return '<span class="citation-missing">[?]</span>';
    ref.occurrence = (ref.occurrence || 0) + 1;
    const citeId = 'cite-' + escapeHtml(ref.citation_key) + '-' + ref.occurrence;
    return '<sup class="citation"><a href="#ref-' + escapeHtml(ref.citation_key) + '" id="' + citeId + '">[' + ref.number + ']</a></sup>';
  });
  safe = safe.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  safe = safe.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "<em>$1</em>");
  safe = safe.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" rel="noopener noreferrer">$1</a>',
  );
  return safe;
}

export function renderMarkup(content = "", references = []) {
  const referenceIndex = new Map(
    references.map((ref, index) => [
      String(ref.citation_key).toLowerCase(),
      { ...ref, number: index + 1 },
    ]),
  );
  const lines = String(content).trim().split(/\r?\n/);
  const html = [];
  let inList = false;

  const closeList = () => {
    if (inList) {
      html.push("</ul>");
      inList = false;
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();

    let match = line.match(/^!\[([^\]]*)\]\(\/media\/(\d+)\)$/);
    if (match) {
      closeList();
      html.push(
        `<figure class="article-image"><img src="/media/${match[2]}" alt="${escapeHtml(match[1])}"><figcaption>${escapeHtml(match[1])}</figcaption></figure>`,
      );
      continue;
    }

    match = line.match(/^###\s+(.+)$/);
    if (match) {
      closeList();
      html.push(`<h3>${inlineMarkup(match[1], referenceIndex)}</h3>`);
      continue;
    }

    match = line.match(/^##\s+(.+)$/);
    if (match) {
      closeList();
      html.push(`<h2 id="${slugify(match[1])}">${inlineMarkup(match[1], referenceIndex)}</h2>`);
      continue;
    }

    match = line.match(/^-\s+(.+)$/);
    if (match) {
      if (!inList) {
        html.push("<ul>");
        inList = true;
      }
      html.push(`<li>${inlineMarkup(match[1], referenceIndex)}</li>`);
      continue;
    }

    closeList();
    if (!line.trim()) continue;
    html.push(`<p>${inlineMarkup(line, referenceIndex)}</p>`);
  }

  closeList();
  return html.join("\n");
}

export function headingsFromContent(content = "") {
  return [...String(content).matchAll(/^##\s+(.+)$/gm)].map((match) => ({
    id: slugify(match[1]),
    title: match[1],
  }));
}


export function citationKeysFromContent(content = "") {
  return [...String(content).matchAll(/\[\^([A-Za-z0-9_-]{1,40})\]/g)]
    .map((match) => match[1].toLowerCase());
}


export function diffLines(before = "", after = "") {
  const left = String(before).split(/\r?\n/);
  const right = String(after).split(/\r?\n/);

  const maxCells = 120000;
  if (left.length * right.length > maxCells) {
    if (before === after) return [{ type: "same", text: String(before) }];
    return [
      { type: "remove", text: String(before) },
      { type: "add", text: String(after) },
    ];
  }

  const dp = Array.from({ length: left.length + 1 }, () =>
    new Uint16Array(right.length + 1)
  );

  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      dp[i][j] = left[i] === right[j]
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const result = [];
  let i = 0;
  let j = 0;

  const push = (type, text) => {
    const previous = result[result.length - 1];
    if (previous?.type === type) {
      previous.text += "\n" + text;
    } else {
      result.push({ type, text });
    }
  };

  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      push("same", left[i]);
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      push("remove", left[i]);
      i += 1;
    } else {
      push("add", right[j]);
      j += 1;
    }
  }

  while (i < left.length) push("remove", left[i++]);
  while (j < right.length) push("add", right[j++]);

  return result;
}

export function normalizeSnapshotReferences(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((ref) => ({
      citation_key: String(ref?.citation_key || "").trim(),
      title: String(ref?.title || "").trim(),
      author: String(ref?.author || "").trim(),
      publisher: String(ref?.publisher || "").trim(),
      url: String(ref?.url || "").trim(),
      published_date: ref?.published_date ? String(ref.published_date).slice(0, 10) : "",
      accessed_date: ref?.accessed_date ? String(ref.accessed_date).slice(0, 10) : "",
      note: String(ref?.note || "").trim(),
    }))
    .filter((ref) => ref.citation_key && ref.title)
    .slice(0, 50);
}

export function normalizeSnapshotInfobox(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const fields = Array.isArray(value.fields)
    ? value.fields
      .map((field) => ({
        label: String(field?.label || "").trim(),
        value: String(field?.value || "").trim(),
      }))
      .filter((field) => field.label && field.value)
      .slice(0, 20)
    : [];

  const mediaId = Number(value.media_id || 0);
  const infobox = {
    title: String(value.title || "").trim().slice(0, 160),
    media_id: Number.isInteger(mediaId) && mediaId > 0 ? mediaId : null,
    caption: String(value.caption || "").trim().slice(0, 240),
    fields,
  };

  return infobox.title || infobox.media_id || infobox.caption || infobox.fields.length
    ? infobox
    : null;
}
