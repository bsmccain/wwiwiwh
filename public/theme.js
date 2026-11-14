// The saved appearance is applied before the first paint, so the page never flashes in other colours:
// light or dark (the system's, unless one was chosen) and the saved ink set. A file of its own, loaded
// synchronously, so it also runs under a Content-Security-Policy that forbids inline scripts. Keep the
// storage key in step with src/app/prefs.ts.
(function () {
  try {
    var prefs = JSON.parse(localStorage.getItem('wwiwiwh:prefs:v1') || '{}');
    var root = document.documentElement;
    var choice = prefs.themeChoice;
    if (choice === 'light' || choice === 'dark') root.dataset.theme = choice;
    // The style sheet matches an ink set by name; a name it does not know simply matches nothing.
    if (typeof prefs.inkSet === 'string' && /^[a-z]+$/.test(prefs.inkSet)) {
      root.dataset.inks = prefs.inkSet;
      // An ink set's dark printing is keyed on data-theme, so "match system" is settled here.
      if (!root.dataset.theme) root.dataset.theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
  } catch (error) {
    // No storage, or nothing usable in it: the page follows the system setting in the Classic inks.
  }
})();
