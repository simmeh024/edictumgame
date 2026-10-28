/* Edictum: the runtime stub. build.py inlines this at the top of <head>, before the game.
   The game expects window.claude.use(name) to exist when its own script runs. Here use() waits
   on a promise that src/shim.js settles once Firebase is up (or settles with null for
   browser-only mode). It never rejects. */
(function () {
  'use strict';
  var settled = false, resolveApi;
  var ready = new Promise(function (r) { resolveApi = r; });
  function settle(api) {
    if (settled) return false;
    settled = true;
    resolveApi(api || null);
    return true;
  }
  var root = document.documentElement, hostTheme = root.getAttribute('data-theme');
  // Paint the saved theme before the stylesheet/game arrives, rather than flashing the system theme.
  try { var theme = localStorage.getItem('statehood.theme'); if (theme === 'light' || theme === 'dark') root.setAttribute('data-theme', theme); } catch (e) {}
  root.classList.add('ed-boot-pending');
  var bootTimer = setTimeout(function () { root.classList.remove('ed-boot-pending'); }, 350);
  function painted() { clearTimeout(bootTimer); root.classList.remove('ed-boot-pending'); }
  var bootFailed = false;
  function bootError() {
    if (bootFailed) return;
    bootFailed = true;
    painted();
    document.querySelectorAll('.boot-load').forEach(function (p) { p.textContent = 'The game files could not be downloaded. Reload the page to try again.'; p.setAttribute('role', 'alert'); });
  }
  window.__edictum = { settle: settle, ready: ready, started: false, hostTheme: hostTheme, painted: painted, bootError: bootError };
  window.claude = Object.freeze({
    use: function (name) {
      return ready.then(function (api) {
        try { return api ? api.use(String(name)) : null; } catch (e) { return null; }
      });
    }
  });
  /* A returning player (a nation saved in this browser) waits on the plain loading screen rather than
     the top of the front page that build.py puts there for newcomers. */
  try { if (localStorage.getItem('statehood.nation.v1')) document.documentElement.classList.add('ed-back'); } catch (e) {}
  /* Safety nets: if the shim never ran, or start-up hangs, the game plays in this browser only. */
  window.addEventListener('load', function () { if (!window.__edictum.started) settle(null); });
  setTimeout(function () { settle(null); }, 30000);
})();
