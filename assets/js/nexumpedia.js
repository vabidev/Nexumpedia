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

  document.querySelectorAll(".search").forEach(form => {
    form.addEventListener("submit", event => {
      event.preventDefault();
      const query = form.querySelector("input")?.value.trim();
      if (!query) return;
      const normalized = query.toLocaleLowerCase("pt-BR");
      if (["nexumpedia","enciclopédia","enciclopedia"].includes(normalized)) {
        window.location.href = "artigo.html";
        return;
      }
      alert("A busca por “" + query + "” será conectada ao índice real na etapa de backend.");
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
