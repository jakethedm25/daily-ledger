// boot.js: first-paint theme from the localStorage mirror (theme + lastOpenDate only). Classic script, no imports.
(function () {
  try {
    var t = JSON.parse(localStorage.getItem('ledger.theme') || 'null');
    var r = document.documentElement;
    if (t) {
      var dark = window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches;
      r.dataset.scheme = t.mode === 'auto' ? (dark ? 'dark' : 'light') : t.mode;
      if (t.palette) r.dataset.palette = t.palette;
      if (t.contrast) r.dataset.contrast = t.contrast;
    } else if (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches) {
      r.dataset.scheme = 'dark';
    }
  } catch (e) { /* storage unavailable: defaults apply */ }
})();
