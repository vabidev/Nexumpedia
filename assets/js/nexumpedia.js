(() => {
  const root = document.documentElement;
  let themeTransitionTimer;

  function syncThemeButtons() {
    const dark = root.dataset.theme === "dark";
    document.querySelectorAll("[data-theme-toggle]").forEach(btn => {
      btn.setAttribute("aria-pressed", dark ? "true" : "false");
      btn.setAttribute("aria-label", dark ? "Usar tema claro" : "Usar tema escuro");
    });
  }

  syncThemeButtons();

  document.querySelectorAll("[data-theme-toggle]").forEach(btn => {
    btn.addEventListener("click", () => {
      root.classList.add("theme-transitioning");
      const dark = root.dataset.theme === "dark";

      if (dark) {
        delete root.dataset.theme;
        localStorage.setItem("nexumpedia-theme", "light");
      } else {
        root.dataset.theme = "dark";
        localStorage.setItem("nexumpedia-theme", "dark");
      }

      syncThemeButtons();
      window.clearTimeout(themeTransitionTimer);
      themeTransitionTimer = window.setTimeout(() => {
        root.classList.remove("theme-transitioning");
      }, 340);
    });
  });

  const sidebar = document.querySelector(".sidebar");
  const menuToggles = [...document.querySelectorAll("[data-menu-toggle]")];
  const menuBackdrop = document.querySelector("[data-menu-backdrop]");
  const menuClose = document.querySelector("[data-menu-close]");
  let menuTrigger = null;

  function mobileMenuMode() {
    return window.matchMedia("(max-width: 820px)").matches;
  }

  function setMenuState(open, { restoreFocus = false } = {}) {
    if (!sidebar) return;

    sidebar.classList.toggle("open", open);
    menuBackdrop?.classList.toggle("open", open);
    document.body.classList.toggle("menu-open", open);
    menuToggles.forEach(btn => {
      btn.setAttribute("aria-expanded", open ? "true" : "false");
      btn.setAttribute("aria-label", open ? "Fechar menu" : "Abrir menu");
    });

    if (mobileMenuMode()) {
      sidebar.setAttribute("aria-hidden", open ? "false" : "true");
    } else {
      sidebar.removeAttribute("aria-hidden");
    }

    if (open) {
      menuClose?.focus({ preventScroll: true });
    } else if (restoreFocus && menuTrigger) {
      menuTrigger.focus({ preventScroll: true });
    }
  }

  if (!sidebar) {
    menuToggles.forEach(btn => { btn.hidden = true; });
    if (menuBackdrop) menuBackdrop.hidden = true;
  } else {
    if (mobileMenuMode()) sidebar.setAttribute("aria-hidden", "true");

    menuToggles.forEach(btn => {
      btn.addEventListener("click", () => {
        menuTrigger = btn;
        setMenuState(!sidebar.classList.contains("open"), { restoreFocus: true });
      });
    });

    menuClose?.addEventListener("click", () => setMenuState(false, { restoreFocus: true }));
    menuBackdrop?.addEventListener("click", () => setMenuState(false, { restoreFocus: true }));

    sidebar.querySelectorAll("a").forEach(link => {
      link.addEventListener("click", () => {
        if (mobileMenuMode()) setMenuState(false);
      });
    });

    document.addEventListener("keydown", event => {
      if (event.key === "Escape" && sidebar.classList.contains("open")) {
        setMenuState(false, { restoreFocus: true });
      }
    });

    window.addEventListener("resize", () => {
      if (!mobileMenuMode()) {
        setMenuState(false);
        sidebar.removeAttribute("aria-hidden");
      } else if (!sidebar.classList.contains("open")) {
        sidebar.setAttribute("aria-hidden", "true");
      }
    });
  }

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
