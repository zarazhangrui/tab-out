/* ================================================================
   Theme bootstrap — runs synchronously before <body> is parsed so
   the page paints with the correct theme attributes from the start.

   Must live in an external file: Manifest V3 extension pages forbid
   inline <script> blocks via the default CSP, so an inline tag is
   silently dropped and the page would render in default light mode.

   Mode = "system" | "light" | "dark"; default = system (follows OS).
   ================================================================ */
(function () {
  function apply(mode) {
    var prefersDark = window.matchMedia &&
      window.matchMedia('(prefers-color-scheme: dark)').matches;
    var isDark = mode === 'dark' || (mode === 'system' && prefersDark);
    if (isDark) document.documentElement.setAttribute('data-theme', 'dark');
    else        document.documentElement.removeAttribute('data-theme');
    document.documentElement.setAttribute('data-mode', mode);
  }

  // Sync read from localStorage mirror — instant, no flash.
  var mode = 'system';
  try {
    var v = localStorage.getItem('tabout-theme');
    if (v === 'light' || v === 'dark' || v === 'system') mode = v;
  } catch (e) {}
  apply(mode);

  // Async reconcile with chrome.storage.local (canonical, shared store).
  // If the mirror was missing or stale, this corrects it; if the canonical
  // store has nothing yet, push the current mode so future tabs find it.
  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get('theme', function (res) {
        var saved = res && res.theme;
        if (saved !== 'light' && saved !== 'dark' && saved !== 'system') {
          try { chrome.storage.local.set({ theme: mode }); } catch (e) {}
          return;
        }
        if (saved !== mode) apply(saved);
        try { localStorage.setItem('tabout-theme', saved); } catch (e) {}
      });
    }
  } catch (e) {}
})();
