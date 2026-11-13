/* Edictum: the runtime stub. build.py inlines this at the top of <head>, before the game.
   The game expects window.claude.use(name) to exist when its own script runs. Here use() waits
   on a promise that src/shim.js settles once Firebase is up (or settles with null for
   browser-only mode). It never rejects. */
(function () {
  'use strict';
  var settled = false, resolveApi;
  var ready = new Promise(function (r) { resolveApi = r; });
  /* why: when there is no api, the reason the game plays in this browser only (off and why on window.__edictum, which
     the game reads before it lets anyone settle or claim land: game/edictum.html, landWait) */
  function settle(api, why) {
    if (settled) return false;
    settled = true;
    var E = window.__edictum;
    if (E) { E.state = 'done'; if (!api) { E.off = true; if (!E.why) E.why = why || 'start-up did not finish'; } }
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
  window.__edictum = { settle: settle, ready: ready, started: false, hostTheme: hostTheme, painted: painted, bootError: bootError, state: 'wait', off: false, why: '' };
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
  /* (build.py adds the game's scripts after the first frame, or at the latest on load, and marks them `loading`:
     scripts added before load hold it back, so by then the shim has run; the check waits a moment for that) */
  window.addEventListener('load', function () { setTimeout(function () { if (!window.__edictum.started && !window.__edictum.loading) settle(null, 'the game scripts did not start'); }, 0); });
  /* 60 s: a phone on a slow connection needs more than the 30 it once had (the scripts, then Firebase's own waits of up
     to 10 + 15 s for a sign-in): past it, the game had begun on its own and stayed there for the visit (2026-11-12).
     A start that finishes later still reloads into the region (src/shim.js, lateOnline). */
  setTimeout(function () { settle(null, 'start-up took too long'); }, 60000);
})();
