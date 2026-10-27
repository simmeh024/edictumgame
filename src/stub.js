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
  window.__edictum = { settle: settle, ready: ready, started: false };
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
