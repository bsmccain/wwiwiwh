// A saved light or dark choice is applied before the first paint, so the page never flashes in the
// other theme. A file of its own, loaded synchronously, so it also runs under a Content-Security-Policy
// that forbids inline scripts. Keep the storage key in step with src/app/prefs.ts.
(function () {
  try {
    var choice = JSON.parse(localStorage.getItem('wwiwiwh:prefs:v1') || '{}').themeChoice;
    if (choice === 'light' || choice === 'dark') document.documentElement.dataset.theme = choice;
  } catch (error) {
    // No storage, or nothing usable in it: the page follows the system setting.
  }
})();
