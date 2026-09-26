(() => {
  try {
    const savedTheme = localStorage.getItem("nexumpedia-theme");
    if (savedTheme === "dark") document.documentElement.dataset.theme = "dark";
  } catch {}
})();
