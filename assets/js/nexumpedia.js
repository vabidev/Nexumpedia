(() => {
  const root = document.documentElement;
  const savedTheme = localStorage.getItem("nexumpedia-theme");
  if (savedTheme === "dark") root.dataset.theme = "dark";

  document.querySelectorAll("[data-theme-toggle]").forEach(btn => {
    btn.setAttribute("aria-pressed", root.dataset.theme === "dark" ? "true" : "false");
    btn.addEventListener("click", () => {
      const dark = root.dataset.theme === "dark";
      if (dark) {
        delete root.dataset.theme;
        localStorage.setItem("nexumpedia-theme", "light");
      } else {
        root.dataset.theme = "dark";
        localStorage.setItem("nexumpedia-theme", "dark");
      }
      btn.setAttribute("aria-pressed", root.dataset.theme === "dark" ? "true" : "false");
    });
  });

  document.querySelectorAll("[data-menu-toggle]").forEach(btn => {
    btn.addEventListener("click", () => {
      const nav = document.querySelector(".sidebar");
      if (nav) {
        nav.classList.toggle("open");
        btn.setAttribute("aria-expanded", nav.classList.contains("open") ? "true" : "false");
      }
    });
  });

  const referenceList = document.querySelector("[data-reference-list]");
  const referenceTemplate = document.querySelector("#reference-row-template");
  const articleEditor = document.querySelector(".article-editor");

  function insertAtCursor(textarea, text) {
    if (!textarea) return;
    const start = textarea.selectionStart ?? textarea.value.length;
    const end = textarea.selectionEnd ?? start;
    textarea.value = textarea.value.slice(0, start) + text + textarea.value.slice(end);
    const next = start + text.length;
    textarea.focus();
    textarea.setSelectionRange(next, next);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function bindReferenceRow(row) {
    row.querySelector("[data-remove-reference]")?.addEventListener("click", () => row.remove());

    row.querySelector("[data-insert-citation]")?.addEventListener("click", () => {
      const keyInput = row.querySelector("[data-reference-key]");
      const key = keyInput?.value.trim();
      if (!key) {
        keyInput?.focus();
        return;
      }
      insertAtCursor(articleEditor, "[^" + key + "]");
    });

    row.querySelector("[data-reference-key]")?.addEventListener("blur", event => {
      event.target.value = event.target.value
        .trim()
        .replace(/\s+/g, "-")
        .replace(/[^A-Za-z0-9_-]/g, "")
        .slice(0, 40);
    });
  }

  if (referenceList) {
    referenceList.querySelectorAll("[data-reference-row]").forEach(bindReferenceRow);

    document.querySelector("[data-add-reference]")?.addEventListener("click", () => {
      if (!referenceTemplate?.content) return;
      const row = referenceTemplate.content.firstElementChild.cloneNode(true);
      referenceList.appendChild(row);
      bindReferenceRow(row);
      row.querySelector("[data-reference-key]")?.focus();
    });
  }

  const infoboxList = document.querySelector("[data-infobox-field-list]");
  const infoboxTemplate = document.querySelector("#infobox-field-template");

  function bindInfoboxField(row) {
    row.querySelector("[data-remove-infobox-field]")?.addEventListener("click", () => row.remove());
  }

  if (infoboxList) {
    infoboxList.querySelectorAll("[data-infobox-field-row]").forEach(bindInfoboxField);

    document.querySelector("[data-add-infobox-field]")?.addEventListener("click", () => {
      if (!infoboxTemplate?.content) return;
      if (infoboxList.querySelectorAll("[data-infobox-field-row]").length >= 20) return;

      const row = infoboxTemplate.content.firstElementChild.cloneNode(true);
      infoboxList.appendChild(row);
      bindInfoboxField(row);
      row.querySelector("input")?.focus();
    });
  }

  document.querySelectorAll("[data-select-on-focus]").forEach(input => {
    input.addEventListener("focus", () => input.select());
    input.addEventListener("click", () => input.select());
  });

  document.querySelectorAll("[data-close-window]").forEach(button => {
    button.addEventListener("click", () => window.close());
  });

  document.querySelectorAll("form[data-confirm]").forEach(form => {
    form.addEventListener("submit", event => {
      const message = form.dataset.confirm || "Confirmar esta ação?";
      if (!window.confirm(message)) event.preventDefault();
    });
  });

  const headings = [...document.querySelectorAll(".article h2[id], .article h3[id]")];
  const tocLinks = [...document.querySelectorAll(".toc-side a")];
  if (headings.length && tocLinks.length && "IntersectionObserver" in window) {
    const observer = new IntersectionObserver(entries => {
      const visible = entries.find(entry => entry.isIntersecting);
      if (!visible) return;
      tocLinks.forEach(link => link.classList.toggle("active", link.getAttribute("href") === "#" + visible.target.id));
    }, {rootMargin:"-20% 0px -70% 0px"});
    headings.forEach(h => observer.observe(h));
  }
})();
