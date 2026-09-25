(() => {
  const root = document.documentElement;
  const savedTheme = localStorage.getItem("nexumpedia-theme");
  if (savedTheme === "dark") root.dataset.theme = "dark";

  document.querySelectorAll("[data-theme-toggle]").forEach(btn => {
    btn.addEventListener("click", () => {
      const dark = root.dataset.theme === "dark";
      if (dark) {
        delete root.dataset.theme;
        localStorage.setItem("nexumpedia-theme", "light");
      } else {
        root.dataset.theme = "dark";
        localStorage.setItem("nexumpedia-theme", "dark");
      }
    });
  });

  document.querySelectorAll("[data-menu-toggle]").forEach(btn => {
    btn.addEventListener("click", () => {
      const nav = document.querySelector(".sidebar");
      if (nav) nav.classList.toggle("open");
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
