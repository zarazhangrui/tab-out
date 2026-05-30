(() => {
  try {
    const storedTheme = localStorage.getItem('tabOutTheme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const theme = storedTheme === 'dark' || storedTheme === 'light'
      ? storedTheme
      : prefersDark ? 'dark' : 'light';

    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  } catch {
    // Leave the CSS default in place if localStorage or matchMedia is blocked.
  }
})();
