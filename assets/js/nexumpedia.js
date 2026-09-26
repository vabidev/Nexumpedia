(() => {
  const root = document.documentElement;
  const body = document.body;
  const topbar = document.querySelector(".topbar");
  const sidebar = document.querySelector("#navegacao-lateral");
  const menuButtons = [...document.querySelectorAll("[data-menu-toggle]")];
  const backdrop = document.querySelector("[data-menu-backdrop]");
  const mobileQuery = window.matchMedia("(max-width: 820px)");
  let themeTimer = null;

  function syncThemeButton() {
    const dark = root.dataset.theme === "dark";
    document.querySelectorAll("[data-theme-toggle]").forEach(btn => {
      btn.setAttribute("aria-pressed", dark ? "true" : "false");
      btn.setAttribute("aria-label", dark ? "Usar tema claro" : "Usar tema escuro");
    });
  }

  syncThemeButton();

  document.querySelectorAll("[data-theme-toggle]").forEach(btn => {
    btn.addEventListener("click", () => {
      root.classList.add("theme-changing");

      if (root.dataset.theme === "dark") {
        delete root.dataset.theme;
        localStorage.setItem("nexumpedia-theme", "light");
      } else {
        root.dataset.theme = "dark";
        localStorage.setItem("nexumpedia-theme", "dark");
      }

      syncThemeButton();
      window.clearTimeout(themeTimer);
      themeTimer = window.setTimeout(() => {
        root.classList.remove("theme-changing");
      }, 300);
    });
  });

  function updateDrawerTop() {
    if (!topbar) return;
    const bottom = Math.max(0, Math.round(topbar.getBoundingClientRect().bottom));
    root.style.setProperty("--drawer-top", bottom + "px");
  }

  function setMenuOpen(open, restoreFocus = false) {
    if (!sidebar) return;

    updateDrawerTop();
    sidebar.classList.toggle("open", open);
    backdrop?.classList.toggle("open", open);
    body.classList.toggle("menu-open", open);

    menuButtons.forEach(btn => {
      btn.setAttribute("aria-expanded", open ? "true" : "false");
      btn.setAttribute("aria-label", open ? "Fechar menu" : "Abrir menu");
    });

    if (mobileQuery.matches) {
      sidebar.setAttribute("aria-hidden", open ? "false" : "true");
    } else {
      sidebar.removeAttribute("aria-hidden");
    }

    if (!open && restoreFocus) {
      menuButtons[0]?.focus({ preventScroll: true });
    }
  }

  if (sidebar) {
    updateDrawerTop();
    if (mobileQuery.matches) sidebar.setAttribute("aria-hidden", "true");

    menuButtons.forEach(btn => {
      btn.addEventListener("click", () => {
        setMenuOpen(!sidebar.classList.contains("open"));
      });
    });

    backdrop?.addEventListener("click", () => setMenuOpen(false, true));

    sidebar.querySelectorAll("a").forEach(link => {
      link.addEventListener("click", () => {
        if (mobileQuery.matches) setMenuOpen(false);
      });
    });

    document.addEventListener("keydown", event => {
      if (event.key === "Escape" && sidebar.classList.contains("open")) {
        setMenuOpen(false, true);
      }
    });

    const handleViewportChange = () => {
      updateDrawerTop();
      if (!mobileQuery.matches) {
        sidebar.classList.remove("open");
        backdrop?.classList.remove("open");
        body.classList.remove("menu-open");
        sidebar.removeAttribute("aria-hidden");
        menuButtons.forEach(btn => {
          btn.setAttribute("aria-expanded", "false");
          btn.setAttribute("aria-label", "Abrir menu");
        });
      } else if (!sidebar.classList.contains("open")) {
        sidebar.setAttribute("aria-hidden", "true");
      }
    };

    window.addEventListener("resize", handleViewportChange, { passive: true });
    window.addEventListener("orientationchange", handleViewportChange);
  } else {
    menuButtons.forEach(btn => { btn.hidden = true; });
    if (backdrop) backdrop.hidden = true;
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
