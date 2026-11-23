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
  var back = false;
  try { if (localStorage.getItem('statehood.nation.v1')) { back = true; document.documentElement.classList.add('ed-back'); } } catch (e) {}
  /* The region's river network, which the game keeps in this browser once it has made it (game/edictum.html, rvStore),
     read now, while the game's scripts download: the game takes it if it is this page's (rvCached) instead of making it
     before the first page shows, about half a second on a phone. The database and its store are the game's own (rlfDB:
     edictum-cache, version 1, kv); a copy that comes after the game has made its own is dropped (rvDone). */
  try {
    var rvReg = localStorage.getItem('edictum.rv');
    if (back && rvReg && window.indexedDB) {
      var rq = indexedDB.open('edictum-cache', 1);
      rq.onupgradeneeded = function () { rq.result.createObjectStore('kv'); };
      rq.onsuccess = function () {
        try {
          var g = rq.result.transaction('kv').objectStore('kv').get('rv:' + rvReg);
          g.onsuccess = function () { var E = window.__edictum; if (g.result && E && !E.rvDone) E.rv = g.result; };
        } catch (e) {}
      };
    }
  } catch (e) {}
  /* The typefaces the last visit's first page used beyond the two build.py preloads (the figures' IBM Plex Mono, the
     edicts' Cinzel…), which the game notes once that page has settled (edictum.fonts): asked for from the browser's cache
     once the front page has painted, so the first page is laid out with them, rather than laid out again when they arrive
     (about a third of a second on a phone). Not on a line the browser reckons slow, as with build.py's preloads. */
  try {
    var fl = back && JSON.parse(localStorage.getItem('edictum.fonts') || 'null'), cn = navigator.connection;
    if (Array.isArray(fl) && fl.length && document.fonts && document.fonts.load && !(cn && (cn.saveData || /^(slow-2g|2g|3g)$/.test(cn.effectiveType)))) {
      var fonts = function () {
        fl.slice(0, 12).forEach(function (d) { if (typeof d === 'string' && d.length < 80) { try { document.fonts.load(d).catch(function () {}); } catch (e) {} } });
      };
      document.addEventListener('DOMContentLoaded', function () {
        if (window.requestAnimationFrame && !document.hidden) requestAnimationFrame(function () { setTimeout(fonts, 0); }); else fonts();
      });
    }
  } catch (e) {}
  /* Safety nets: if the shim never ran, or start-up hangs, the game plays in this browser only. */
  /* (build.py adds the game's scripts after the first frame, or at the latest on load, and marks them `loading`:
     scripts added before load hold it back, so by then the shim has run; the check waits a moment for that) */
  window.addEventListener('load', function () { setTimeout(function () { if (!window.__edictum.started && !window.__edictum.loading) settle(null, 'the game scripts did not start'); }, 0); });
  /* 60 s: a phone on a slow connection needs more than the 30 it once had (the scripts, then Firebase's own waits of up
     to 10 + 15 s for a sign-in): past it, the game had begun on its own and stayed there for the visit (2026-11-12).
     A start that finishes later still reloads into the region (src/shim.js, lateOnline). */
  setTimeout(function () { settle(null, 'start-up took too long'); }, 60000);
})();
