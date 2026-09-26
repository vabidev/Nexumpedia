(() => {
  try {
    if (localStorage.getItem("nexumpedia-theme") === "dark") {
      document.documentElement.dataset.theme = "dark";
    }
  } catch {}
})();
