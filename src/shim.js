/* Edictum on Firebase: the window.claude adapter and the account control.

   The game was written for the claude.ai artifact runtime, which gives a page
   window.claude.use('db' | 'user'). This file gives the same calls, backed by Firebase
   Auth and Firestore (compat SDK), so the game's source stays untouched.

   build.py inlines it after the game's own script; src/stub.js (in <head>) has already
   defined window.claude.use(), which waits until this file settles it.

   Storage format (see firestore.rules):
     nations/<uid>          {v:1, j:<the nation as JSON text>, reg, name, updatedAt, ts}. Nation records
                            contain arrays of arrays, which Firestore cannot store, and their exact key
                            order is kept this way. Players listen only to their own region's nations.
     summaries/<uid>        {reg, name, pop, t}: the headline for the World page and region counts.
     space/<uid>            {reg, name, t, j:<JSON of sp, belt, mapc, flag, pretitle>}, only for nations
                            with Moon, Mars or belt data. Every player listens to all of these, so it is
                            rewritten only when that data changes (or every SPACE_BEAT while playing).
     boards/<reg>/posts/<id> {a:<author uid>, t:<server time>, x:<text>}, with limits/<uid> {p} pacing posts.
   A nation save writes nations, summaries and (when needed) space in one batch; the rules check that
   they agree. */
(function () {
  'use strict';
  var E = window.__edictum;
  if (!E || E.started) return;
  E.started = true;

  var LS_NATION = 'statehood.nation.v1'; // the game's own copy of the player's nation
  var LS_UID = 'edictum.uid';            // the account that copy belongs to ('-' once signed out)
  var LS_BACKUP = 'edictum.backup';      // the last nation replaced or left behind in this browser
  var SS_FLASH = 'edictum.flash';        // a message to show after a reload
  var SS_IMPORT = 'edictum.import';      // an import waiting for the game's verdict after a reload
  var MAX_JSON = 700000;                 // well under Firestore's 1 MiB document limit
  var SPACE_BEAT = 12 * 3600000;         // rewrite an unchanged space document this often while playing
  var SPACE_MIN = 12000;                 // and a changed one at most this often (the rules allow one per 10 s)
  var RETRY_MS = 1500;                   // wait before trying a refused nation write once more
  var BOOT_AT = Date.now();
  var ERR = {
    'permission-denied': 'not_granted', unauthenticated: 'not_granted',
    'invalid-argument': 'invalid_argument', 'resource-exhausted': 'quota_exceeded', unavailable: 'unavailable'
  };
  var A = { fb: null, auth: null, fs: null, uid: null, online: false, why: '', frozen: false, leaving: false, cred: null, rest: '', projectId: '', spaceSent: {} };

  /* ───────── small helpers ───────── */
  function storeOf(name) { try { return window[name] || null; } catch (e) { return null; } }
  function sget(name, k) { try { var s = storeOf(name); return s ? s.getItem(k) : null; } catch (e) { return null; } }
  function sset(name, k, v) {
    try { var s = storeOf(name); if (!s) return false; if (v == null) s.removeItem(k); else s.setItem(k, String(v)); return true; } catch (e) { return false; }
  }
  var L = { get: function (k) { return sget('localStorage', k); }, set: function (k, v) { return sset('localStorage', k, v); } };
  var SS = { get: function (k) { return sget('sessionStorage', k); }, set: function (k, v) { return sset('sessionStorage', k, v); } };
  function parse(s) { try { return s ? JSON.parse(s) : null; } catch (e) { return null; } }
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function str(v, max) { return typeof v === 'string' ? v.slice(0, max) : ''; }
  function localNation() { var n = parse(L.get(LS_NATION)); return isObj(n) && typeof n.name === 'string' && n.name.trim() ? n : null; }
  function backup() { var b = parse(L.get(LS_BACKUP)); return isObj(b) && isObj(b.nation) && typeof b.nation.name === 'string' ? b : null; }
  function keepBackup(n) { if (isObj(n)) L.set(LS_BACKUP, JSON.stringify({ at: Date.now(), nation: n })); }
  function within(p, ms) {
    return new Promise(function (res, rej) {
      var t = setTimeout(function () { var e = new Error('timed out'); e.code = 'deadline-exceeded'; rej(e); }, ms);
      Promise.resolve(p).then(function (v) { clearTimeout(t); res(v); }, function (e) { clearTimeout(t); rej(e); });
    });
  }
  function hang() { return new Promise(function () {}); }
  /* leave the page with these values in place; pagehide puts them back if the game saves in between */
  function leave(final, msg) {
    A.leaving = true; A.frozen = true;
    function apply() { if ('nation' in final) L.set(LS_NATION, final.nation); if ('uid' in final) L.set(LS_UID, final.uid); }
    apply();
    window.addEventListener('pagehide', apply);
    if (msg) SS.set(SS_FLASH, msg);
    location.reload();
  }

  /* ───────── Firestore, shaped like the artifact runtime ───────── */
  function mapError(e) {
    var raw = String((e && e.code) || 'unavailable').replace(/^firestore\//, '');
    var out = new Error((e && e.message) || raw);
    out.code = ERR[raw] || raw;
    out.firebaseCode = raw;
    return out;
  }
  function num(v) { return typeof v === 'number' && isFinite(v) ? v : 0; }
  function serverTime() { return A.fb.firestore.FieldValue.serverTimestamp(); }
  function millis(t) { return t && typeof t.toMillis === 'function' ? t.toMillis() : num(t); }
  function encode(col, data) {
    if (col !== 'nations') return JSON.parse(JSON.stringify(data == null ? {} : data));
    var j = JSON.stringify(data == null ? {} : data);
    if (j.length > MAX_JSON) throw mapError({ code: 'resource-exhausted', message: 'This nation is too large to save (' + j.length + ' characters).' });
    var d = isObj(data) ? data : {};
    return { v: 1, j: j, reg: str(d.reg, 40) || 'meridian', name: str(d.name, 80), updatedAt: num(d.updatedAt), ts: serverTime() };
  }
  /* the part of a nation every region needs for Moon, Mars and the belt; null without any */
  function spaceText(d) {
    if (!isObj(d) || (!d.sp && !d.belt)) return null;
    var c = d.flag && Array.isArray(d.flag.c) ? d.flag.c.slice(0, 3) : [];
    return JSON.stringify({ sp: d.sp || null, belt: d.belt || null, mapc: str(d.mapc, 20), flag: { c: c }, pretitle: str(d.pretitle, 40) });
  }
  function decode(path, d) {
    if (!d) return d;
    var p = String(path).split('/'), col = p[0];
    if (col === 'nations') return typeof d.j === 'string' ? parse(d.j) : d;
    if (col === 'space') { var s = typeof d.j === 'string' ? parse(d.j) : null; return isObj(s) ? Object.assign(s, { reg: d.reg, name: d.name, updatedAt: num(d.t) }) : null; }
    if (col === 'boards') return { id: p[3], a: str(d.a, 128), t: millis(d.t) || Date.now(), x: str(d.x, 500), r: p[1] };
    return d;
  }
  function snapOf(s) {
    return { id: s.id, exists: !!s.exists, data: function () { return s.exists ? decode(s.ref.path, s.data({ serverTimestamps: 'estimate' })) : undefined; } };
  }
  /* The rules allow one nation write a second per player, and one space write every 10 seconds. A write
     queued while offline, by the tab before a reload or by the same account on another device can land
     just before this one, so a refusal is tried once more, without the space record (the next save
     brings it). */
  function retried(fn) {
    return fn(false).catch(function (e) {
      if (!e || e.code !== 'permission-denied') throw e;
      return new Promise(function (r) { setTimeout(r, RETRY_MS); }).then(function () { return fn(true); });
    });
  }
  /* a nation save: the record, its summary and, when its space data changed, its space document */
  function saveNation(uid, data, noSpace) {
    /* before the first space write of this page, count from the page load: a reload must not beat the pace */
    var enc = encode('nations', data), now = Date.now(), sent = A.spaceSent[uid] || { j: undefined, at: BOOT_AT }, next = null;
    var sj = spaceText(data), b = A.fs.batch();
    b.set(A.fs.doc('nations/' + uid), enc);
    b.set(A.fs.doc('summaries/' + uid), { reg: enc.reg, name: enc.name, pop: Math.max(0, num(isObj(data) ? data.pop : 0)), t: enc.updatedAt });
    if (noSpace) { /* leave space/ as it is */ }
    else if (sj) {
      var changed = sent.j !== sj || sent.reg !== enc.reg || sent.name !== enc.name;
      /* a change waits for the next save if the last space write was too recent */
      if ((changed && now - sent.at >= SPACE_MIN) || now - sent.at > SPACE_BEAT) {
        b.set(A.fs.doc('space/' + uid), { reg: enc.reg, name: enc.name, t: enc.updatedAt, j: sj, ts: serverTime() });
        next = { j: sj, reg: enc.reg, name: enc.name, at: now };
      }
    } else if (sent.j) {
      b.delete(A.fs.doc('space/' + uid));
      next = { j: null, at: now };
    }
    return b.commit().then(function () { if (next) A.spaceSent[uid] = next; });
  }
  function dropNation(uid) {
    var b = A.fs.batch();
    ['nations/', 'summaries/', 'space/'].forEach(function (c) { b.delete(A.fs.doc(c + uid)); });
    return b.commit().then(function () { A.spaceSent[uid] = { j: null, at: Date.now() }; });
  }
  function docApi(path) {
    var p = String(path).split('/').filter(Boolean), col = p[0], ref = A.fs.doc(p.join('/')), nation = col === 'nations' && p.length === 2;
    return Object.freeze({
      id: ref.id,
      path: ref.path,
      get: function () { return ref.get().then(snapOf, function (e) { throw mapError(e); }); },
      set: function (data) {
        if (A.frozen) return hang();
        if (nation) {
          try { encode(col, data); } catch (e) { return Promise.reject(e && e.firebaseCode ? e : mapError(e)); }
          return retried(function (noSpace) { return saveNation(p[1], data, noSpace); }).then(function () {}, function (e) { throw mapError(e); });
        }
        return ref.set(encode(col, data)).then(function () {}, function (e) { throw mapError(e); });
      },
      delete: function () {
        if (A.frozen) return hang();
        return (nation ? dropNation(p[1]) : ref.delete()).then(function () {}, function (e) { throw mapError(e); });
      },
      onSnapshot: function (next, error) {
        return ref.onSnapshot(function (s) { next(snapOf(s)); }, function (e) { if (typeof error === 'function') error(mapError(e)); });
      }
    });
  }
  function queryApi(q) {
    function qsOf(qs) { return { size: qs.size, empty: qs.empty, docs: qs.docs.map(snapOf) }; }
    return {
      where: function (f, op, v) { return Object.freeze(queryApi(q.where(f, op, v))); },
      orderBy: function (f, dir) { return Object.freeze(queryApi(q.orderBy(f, dir === 'desc' ? 'desc' : 'asc'))); },
      limit: function (n) { return Object.freeze(queryApi(q.limit(n))); },
      get: function () { return q.get().then(qsOf, function (e) { throw mapError(e); }); },
      onSnapshot: function (next, error) {
        return q.onSnapshot(function (qs) { next(qsOf(qs)); }, function (e) { if (typeof error === 'function') error(mapError(e)); });
      }
    };
  }
  function collectionApi(path) {
    var name = String(path);
    return Object.freeze(Object.assign(queryApi(A.fs.collection(name)), { doc: function (id) { return docApi(name + '/' + id); } }));
  }
  /* COUNT over REST: the compat SDK has no aggregation queries. Costs one read per 1,000 matches. */
  var OPS = { '==': 'EQUAL', '<': 'LESS_THAN', '<=': 'LESS_THAN_OR_EQUAL', '>': 'GREATER_THAN', '>=': 'GREATER_THAN_OR_EQUAL' };
  function restValue(v) {
    if (typeof v === 'string') return { stringValue: v };
    if (typeof v === 'boolean') return { booleanValue: v };
    return Number.isSafeInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  }
  async function count(path, wheres) {
    var segs = String(path).split('/').filter(Boolean), cid = segs.pop();
    var parent = 'projects/' + A.projectId + '/databases/(default)/documents' + (segs.length ? '/' + segs.join('/') : '');
    var filters = (wheres || []).map(function (w) { return { fieldFilter: { field: { fieldPath: w[0] }, op: OPS[w[1]], value: restValue(w[2]) } }; });
    var query = { from: [{ collectionId: cid }] };
    if (filters.length === 1) query.where = filters[0];
    else if (filters.length) query.where = { compositeFilter: { op: 'AND', filters: filters } };
    var headers = { 'content-type': 'application/json' }, u = A.auth.currentUser;
    if (u) headers.authorization = 'Bearer ' + await u.getIdToken();
    var r = await within(fetch(A.rest + '/' + parent + ':runAggregationQuery', {
      method: 'POST', headers: headers,
      body: JSON.stringify({ structuredAggregationQuery: { structuredQuery: query, aggregations: [{ alias: 'n', count: {} }] } })
    }), 10000);
    if (!r.ok) throw mapError({ code: r.status === 403 ? 'permission-denied' : r.status === 429 ? 'resource-exhausted' : 'unavailable', message: 'count failed: HTTP ' + r.status });
    var out = await r.json(), f = out && out[0] && out[0].result && out[0].result.aggregateFields;
    return f && f.n ? Number(f.n.integerValue || 0) : 0;
  }
  /* a post on a region's board, paced by limits/<uid> (see firestore.rules) */
  function post(reg, text) {
    if (A.frozen) return hang();
    var u = A.auth.currentUser;
    if (!u) return Promise.reject(mapError({ code: 'unauthenticated' }));
    var ref = A.fs.collection('boards/' + str(reg, 40) + '/posts').doc(), b = A.fs.batch();
    b.set(ref, { a: u.uid, t: serverTime(), x: String(text || '').slice(0, 400) });
    b.set(A.fs.doc('limits/' + u.uid), { p: serverTime() });
    return b.commit().then(function () { return ref.id; }, function (e) { throw mapError(e); });
  }
  var dbApi = Object.freeze({ doc: docApi, collection: collectionApi, count: count, post: post });
  var userApi = Object.freeze({
    id: function () { var u = A.auth && A.auth.currentUser; return Promise.resolve(u ? u.uid : null); },
    isOwner: function () {
      var u = A.auth && A.auth.currentUser;
      if (!u) return Promise.resolve(false);
      return u.getIdTokenResult().then(function (r) { return !!(r && r.claims && r.claims.admin === true); }, function () { return false; });
    },
    can: function (what) { return Promise.resolve(what === 'data.write' ? !!(A.auth && A.auth.currentUser) : false); }
  });
  /* the artifact runtime's 'downloads' capability, for a site that can simply download */
  var downloadsApi = Object.freeze({
    save: function (req) {
      return new Promise(function (resolve, reject) {
        var name = String((req && req.filename) || '').trim(), data = req && req.data;
        if (!name || data == null || data === '') { reject({ code: 'bad_request', message: 'filename and data are required' }); return; }
        try {
          var blob = data instanceof Blob ? data : new Blob([data], { type: /\.json$/i.test(name) ? 'application/json' : 'application/octet-stream' });
          var url = URL.createObjectURL(blob), a = document.createElement('a');
          a.href = url; a.download = name; a.rel = 'noopener'; a.hidden = true;
          document.body.appendChild(a); a.click();
          setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 4000);
          resolve({ status: 'saved' });
        } catch (e) { reject({ code: 'unavailable', message: String((e && e.message) || e) }); }
      });
    }
  });
  function apiFor(online) {
    return Object.freeze({
      use: function (n) {
        if (n === 'downloads') return downloadsApi;
        if (!online) return null;
        return n === 'db' ? dbApi : n === 'user' ? userApi : null;
      }
    });
  }

  /* ───────── start-up ───────── */
  function goOffline(why, err) {
    if (A.online) return;
    A.why = why;
    console.warn('[edictum] Playing in this browser only: ' + why + '.', err ? (err.code || err.message || err) : '');
    E.settle(apiFor(false));
    mount();
  }
  function fetchConfig() {
    return within(fetch('/__/firebase/init.json', { credentials: 'same-origin', cache: 'no-cache' }), 8000)
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }
  /* `firebase emulators:start --project demo-…` on this machine: talk to the local emulators */
  function autoEmulators(cfg) {
    if (!/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) || !/^demo-/.test(String(cfg.projectId || ''))) return null;
    return { firestore: '127.0.0.1:8080', auth: 'http://127.0.0.1:9099' };
  }
  function firstUser(auth) {
    return new Promise(function (res) { var off = auth.onAuthStateChanged(function (u) { off(); res(u); }); });
  }
  /* the nation in this browser may belong to another sign-in: never let it overwrite this account's */
  async function guard(user) {
    var prev = L.get(LS_UID), mine = localNation();
    if (!mine || !prev || prev === user.uid) return false;
    if (prev !== '-') {
      var has = true;
      try { has = (await within(A.fs.doc('nations/' + user.uid).get(), 8000)).exists; } catch (e) { has = true; }
      if (!has) return false; /* a lost guest sign-in: the nation carries on under this one */
      keepBackup(mine);
      leave({ nation: null, uid: user.uid }, 'The nation “' + mine.name + '” in this browser belonged to another sign-in, so it was set aside. You can download it from the account menu.');
      return true;
    }
    leave({ nation: null, uid: user.uid });
    return true;
  }
  async function boot() {
    var fb = window.firebase;
    if (!fb || typeof fb.initializeApp !== 'function' || typeof fb.auth !== 'function' || typeof fb.firestore !== 'function') return goOffline('the Firebase scripts did not load');
    var cfg = window.EDICTUM_FIREBASE_CONFIG || await fetchConfig();
    if (!isObj(cfg) || !cfg.apiKey || !cfg.projectId) return goOffline('there is no Firebase configuration');
    var emu = window.EDICTUM_EMULATORS || autoEmulators(cfg), auth, fs;
    try {
      var app = fb.apps && fb.apps.length ? fb.app() : fb.initializeApp(cfg);
      auth = app.auth(); fs = app.firestore();
      if (emu && emu.auth) auth.useEmulator(String(emu.auth), { disableWarnings: true });
      if (emu && emu.firestore) { var hp = String(emu.firestore), i = hp.lastIndexOf(':'); fs.useEmulator(hp.slice(0, i), Number(hp.slice(i + 1))); }
    } catch (e) { return goOffline('Firebase did not start', e); }
    if (window.EDICTUM_PERSISTENCE !== false) {
      /* offline cache shared by every open tab; a browser without IndexedDB simply goes without */
      try { await within(fs.enablePersistence({ synchronizeTabs: true }), 5000); } catch (e) { /* no cache */ }
    }
    A.fb = fb; A.auth = auth; A.fs = fs; A.projectId = String(cfg.projectId);
    A.rest = emu && emu.firestore ? 'http://' + String(emu.firestore) + '/v1' : 'https://firestore.googleapis.com/v1';
    var user = null;
    try {
      user = await within(firstUser(auth), 10000);
      if (!user) user = (await within(auth.signInAnonymously(), 15000)).user;
    } catch (e) { return goOffline('anonymous sign-in failed', e); }
    if (!user) return goOffline('anonymous sign-in failed');
    if (await guard(user)) return;
    L.set(LS_UID, user.uid);
    A.uid = user.uid;
    A.online = E.settle(apiFor(true));
    if (!A.online) { A.why = 'start-up took too long'; mount(); return; }
    auth.onIdTokenChanged(function (u) {
      if (A.leaving) return;
      if (!u || u.uid !== A.uid) { leave({}); return; } /* signed in or out in another tab */
      paint();
    });
    mount();
  }
  /* after an import, the game's own normaliser has just loaded the record (or refused it) */
  function importVerdict() {
    var p = parse(SS.get(SS_IMPORT));
    if (!isObj(p)) return true;
    SS.set(SS_IMPORT, null);
    if (document.querySelector('#app .layout, #app .dorm')) {
      SS.set(SS_FLASH, 'Imported “' + str(p.name, 80) + '”. It is now your nation.');
      return true;
    }
    L.set(LS_BACKUP, typeof p.prevBackup === 'string' ? p.prevBackup : null);
    leave({ nation: typeof p.prev === 'string' ? p.prev : null }, 'That file could not be read as a nation, so nothing was changed.');
    return false;
  }

  /* ───────── the account control and its dialog ───────── */
  var ui = { box: null, btn: null, dlg: null, inn: null, msg: null, view: 'main', busy: '', pending: null };
  var ICON = '<svg class="ed-acct-ic" viewBox="0 0 20 20" aria-hidden="true" focusable="false"><circle cx="10" cy="10" r="8.6" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="10" cy="8.2" r="2.9" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M4.6 15.7c1.3-2.2 3.1-3.3 5.4-3.3s4.1 1.1 5.4 3.3" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>';
  var XICON = '<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function quoted(s) { return '“' + esc(s) + '”'; }
  function who() {
    var u = A.online && A.auth && A.auth.currentUser;
    if (!u) return { kind: 'local' };
    if (u.isAnonymous) return { kind: 'guest', uid: u.uid };
    var g = (u.providerData || []).filter(function (x) { return x && x.providerId === 'google.com'; })[0] || {};
    return { kind: 'google', uid: u.uid, email: u.email || g.email || '', name: u.displayName || g.displayName || '' };
  }
  function paint() {
    if (!ui.btn) return;
    var w = who(), head = ui.box.classList.contains('ed-head'), k, v;
    if (w.kind === 'google') { k = head ? 'Signed in' : 'Signed in with Google'; v = w.email || w.name || 'Your account'; }
    else if (w.kind === 'guest') { k = head ? 'Have a nation?' : 'Playing as a guest'; v = head ? 'Sign in' : 'Keep your nation on every device'; }
    else { k = head ? 'Have a nation file?' : 'Saved in this browser'; v = head ? 'Import it' : 'Export or import your nation'; }
    ui.btn.innerHTML = ICON + '<span class="ed-acct-t"><span class="ed-acct-k">' + esc(k) + '</span> <span class="ed-acct-v">' + esc(v) + '</span></span>';
  }
  /* the game redraws #app on every change; keep the control in the side bar foot, or in the
     header of the founding screen */
  function place() {
    if (!ui.box || ui.box.isConnected) return;
    var app = document.getElementById('app');
    if (!app) return;
    var foot = app.querySelector('.side-foot'), head = foot ? null : app.querySelector('.found-head');
    if (foot) { var m = foot.querySelector('.mode'); foot.insertBefore(ui.box, m ? m.nextSibling : foot.firstChild); }
    else if (head) head.appendChild(ui.box);
    else return;
    if (ui.box.classList.contains('ed-head') !== !!head) { ui.box.classList.toggle('ed-head', !!head); paint(); }
  }
  function mount() {
    if (ui.box) { paint(); return; }
    var box = document.createElement('div'), btn = document.createElement('button');
    box.className = 'ed-acct';
    btn.type = 'button'; btn.className = 'ed-acct-b'; btn.setAttribute('aria-haspopup', 'dialog');
    btn.addEventListener('click', function () { open('main'); });
    box.appendChild(btn);
    ui.box = box; ui.btn = btn;
    var app = document.getElementById('app');
    if (app && window.MutationObserver) new MutationObserver(place).observe(app, { childList: true, subtree: true });
    place(); paint();
    var f = SS.get(SS_FLASH);
    if (f) { SS.set(SS_FLASH, null); toast(f); }
  }
  function toast(msg) {
    var t = document.createElement('div');
    t.className = 'toast ed-toast'; t.setAttribute('role', 'status'); t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, Math.min(14000, 4500 + msg.split(/\s+/).length * 320));
  }
  function ensureDialog() {
    if (ui.dlg) return ui.dlg;
    var d = document.createElement('dialog');
    d.className = 'ed-dlg'; d.setAttribute('aria-labelledby', 'ed-dlg-h');
    d.innerHTML = '<button type="button" class="ed-x" data-ed="close" aria-label="Close">' + XICON + '</button><div class="ed-in"></div><p class="ed-msg" role="status" aria-live="polite"></p><input type="file" class="ed-file" accept=".json,application/json,text/plain" hidden>';
    document.body.appendChild(d);
    ui.dlg = d; ui.inn = d.querySelector('.ed-in'); ui.msg = d.querySelector('.ed-msg');
    d.addEventListener('click', function (e) {
      if (e.target === d) { if (!ui.busy) d.close(); return; } /* the backdrop */
      var b = e.target.closest ? e.target.closest('[data-ed]') : null;
      if (b && !b.disabled) act(b.getAttribute('data-ed'));
    });
    d.addEventListener('cancel', function (e) { if (ui.busy) e.preventDefault(); });
    d.addEventListener('close', function () { ui.view = 'main'; ui.pending = null; setMsg(''); });
    d.querySelector('.ed-file').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      if (!f) return;
      if (f.size > MAX_JSON * 2) { setMsg('That file is too large to be a nation file.', true); return; }
      f.text().then(takeImport, function () { setMsg('That file could not be read.', true); });
    });
    /* while the dialog is open, keys belong to it, not to the game's shortcuts behind it */
    window.addEventListener('keydown', function (e) { if (d.open) e.stopPropagation(); }, true);
    return d;
  }
  function open(view) {
    var d = ensureDialog();
    ui.view = view || 'main';
    setMsg('');
    draw();
    if (!d.open) { try { d.showModal(); } catch (e) { d.setAttribute('open', ''); } }
    focusFirst();
  }
  function focusFirst() { var f = ui.inn && ui.inn.querySelector('[data-autofocus]'); if (f) try { f.focus(); } catch (e) {} }
  function setMsg(m, err) { if (!ui.msg) return; ui.msg.textContent = m || ''; ui.msg.classList.toggle('ed-err', !!err); }
  function setBusy(m) {
    ui.busy = m || '';
    if (!ui.dlg) return;
    setMsg(ui.busy);
    ui.dlg.querySelectorAll('button').forEach(function (b) { b.disabled = !!ui.busy; });
  }
  function fmtDate(t) { try { return new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }); } catch (e) { return 'an earlier day'; } }
  function draw() {
    if (!ui.inn) return;
    var w = who(), n = localNation(), nm = n ? quoted(n.name) : '', h = '';
    var row = function (x) { return '<div class="ed-row">' + x + '</div>'; };
    if (ui.view === 'switch') {
      h = '<p class="eyebrow">Your account</p><h2 class="ed-h" id="ed-dlg-h">Switch to that Google account?</h2>' +
        (n ? '<p>That Google account already plays Edictum. If it has a nation, that nation loads here and the guest nation ' + nm + ' is dissolved, because only this guest sign-in can play it. If it has no nation yet, ' + nm + ' moves into it.</p><p class="ed-fine">This browser keeps a copy of ' + nm + ' that you can download later.</p>'
           : '<p>That Google account already plays Edictum. Switch to it to carry on with its nation here.</p>') +
        row('<button type="button" class="btn" data-ed="switch" data-autofocus>Switch account</button>' + (n ? '<button type="button" class="btn ghost" data-ed="export">Export ' + nm + '</button>' : '') + '<button type="button" class="btn ghost" data-ed="back">Cancel</button>');
    } else if (ui.view === 'signout') {
      h = '<p class="eyebrow">Your account</p><h2 class="ed-h" id="ed-dlg-h">Sign out?</h2><p>' + (n ? nm + ' stays' : 'Your nation stays') + ' with your Google account. This browser starts again as a new guest, and you can sign back in at any time.</p>' +
        row('<button type="button" class="btn" data-ed="signout-yes" data-autofocus>Sign out</button><button type="button" class="btn ghost" data-ed="back">Cancel</button>');
    } else if (ui.view === 'import' && ui.pending) {
      var im = quoted(ui.pending.name), where = w.kind === 'local' ? ' in this browser' : ' in this browser and in the region';
      h = '<p class="eyebrow">Nation file</p><h2 class="ed-h" id="ed-dlg-h">Import ' + im + '?</h2>' +
        (n ? '<p>' + im + ' replaces ' + nm + where + '. This browser keeps a copy of ' + nm + ' that you can download later.</p>' : '<p>' + im + ' becomes your nation' + where + '.</p>') +
        '<p class="ed-fine">The page reloads, and the game checks the nation as it loads it.</p>' +
        row('<button type="button" class="btn" data-ed="import-yes" data-autofocus>Import ' + im + '</button>' + (n ? '<button type="button" class="btn ghost" data-ed="export">Export ' + nm + ' first</button>' : '') + '<button type="button" class="btn ghost" data-ed="back">Cancel</button>');
    } else {
      ui.view = 'main';
      if (w.kind === 'guest') {
        h = '<p class="eyebrow">Your account</p><h2 class="ed-h" id="ed-dlg-h">' + (n ? 'Keep your nation on every device' : 'Sign in to your nation') + '</h2>' +
          (n ? '<p>You are playing as a guest, so only this browser can play ' + nm + '. Link it to a Google account to keep it safe and play it on any device.</p>'
             : '<p>If your nation is linked to a Google account, sign in to carry on with it here. New to Edictum? Found a nation on this page, and link it to Google whenever you like.</p>') +
          row('<button type="button" class="btn" data-ed="google" data-autofocus>Continue with Google</button>') +
          (n ? '<p class="ed-fine">If that Google account already has a nation, you can switch to it instead.</p>' : '');
      } else if (w.kind === 'google') {
        h = '<p class="eyebrow">Your account</p><h2 class="ed-h" id="ed-dlg-h">Signed in with Google</h2><p>' + (w.email ? 'You are signed in as <b>' + esc(w.email) + '</b>. ' : '') +
          (n ? nm + ' is kept with this account, so you can sign in on any device and carry on.' : 'Found a nation and it is kept with this account.') + '</p>' +
          row('<button type="button" class="btn ghost" data-ed="signout" data-autofocus>Sign out</button>');
      } else {
        h = '<p class="eyebrow">Nation file</p><h2 class="ed-h" id="ed-dlg-h">Saved in this browser</h2><p>Sign-in is not available right now, so ' + (n ? nm + ' is' : 'your nation is') + ' saved in this browser only. You can still export it, or import a nation file.</p>';
      }
      var b = backup();
      h += '<section class="ed-sec" aria-labelledby="ed-file-h"><h3 class="ed-h3" id="ed-file-h">Nation file</h3><p>' +
        (n ? 'Download ' + nm + ' to keep a copy, or bring in' : 'Bring in') + ' a nation from another copy of Edictum, such as the original on claude.ai. Importing replaces the nation you play here.</p>' +
        row((n ? '<button type="button" class="btn ghost" data-ed="export">Export my nation</button>' : '') + '<button type="button" class="btn ghost" data-ed="import">Import a nation file</button>') +
        '<details class="ed-paste"><summary>Or paste the text of a nation file</summary><label class="ed-lbl" for="ed-paste-t">Nation file text</label><textarea class="input" id="ed-paste-t" rows="4" spellcheck="false" autocomplete="off"></textarea>' +
        row('<button type="button" class="btn ghost" data-ed="paste">Import this text</button>') + '</details>' +
        (b ? '<p class="ed-fine">This browser also keeps ' + quoted(b.nation.name) + ', a nation set aside on ' + esc(fmtDate(b.at)) + '. <button type="button" class="linkish" data-ed="export-backup">Download it</button></p>' : '') +
        '</section>' + (w.uid ? '<p class="ed-id">Player ID <code>' + esc(w.uid) + '</code></p>' : '');
    }
    ui.inn.innerHTML = h;
    if (ui.busy) setBusy(ui.busy);
    focusFirst();
  }
  function act(a) {
    if (a === 'close') { if (!ui.busy) ui.dlg.close(); return; }
    if (a === 'back') { ui.view = 'main'; ui.pending = null; setMsg(''); draw(); return; }
    if (a === 'google') { google(); return; }
    if (a === 'switch') { doSwitch(); return; }
    if (a === 'signout') { ui.view = 'signout'; setMsg(''); draw(); return; }
    if (a === 'signout-yes') { doSignOut(); return; }
    if (a === 'export') { exportNation(localNation()); return; }
    if (a === 'export-backup') { var b = backup(); exportNation(b && b.nation); return; }
    if (a === 'import') { var f = ui.dlg.querySelector('.ed-file'); f.value = ''; f.click(); return; }
    if (a === 'paste') { var t = ui.dlg.querySelector('#ed-paste-t'); takeImport(t ? t.value : ''); return; }
    if (a === 'import-yes') { doImport(); return; }
  }

  /* ───────── nation files ───────── */
  function exportNation(n) {
    if (!isObj(n)) { setMsg('There is no nation to export yet.', true); return; }
    var slug = String(n.name).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 40) || 'nation';
    downloadsApi.save({ filename: slug + '-' + new Date().toISOString().slice(0, 10) + '.edictum.json', data: JSON.stringify(n, null, 2) + '\n' })
      .then(function () { setMsg('Downloaded ' + '“' + n.name + '”. Keep the file somewhere safe.'); }, function () { setMsg('The download did not start.', true); });
  }
  function readNationFile(text) {
    text = String(text || '').trim();
    if (!text) return { err: 'Choose a nation file, or paste its text.' };
    if (text.length > MAX_JSON) return { err: 'That file is too large to be a nation file.' };
    var d = parse(text);
    if (d == null) return { err: 'That is not a nation file: Edictum saves nations as JSON text.' };
    if (isObj(d) && isObj(d.nation)) d = d.nation;
    else if (isObj(d) && isObj(d.data) && !('name' in d)) d = d.data;
    if (!isObj(d) || typeof d.name !== 'string' || !d.name.trim() || !isObj(d.s)) return { err: 'That file holds no nation: it has no nation name or national statistics.' };
    if (d.npc) return { err: 'That is a computer-run nation, which cannot be imported.' };
    return { nation: d };
  }
  function takeImport(text) {
    var r = readNationFile(text);
    if (r.err) { setMsg(r.err, true); return; }
    ui.pending = r.nation; ui.view = 'import'; setMsg(''); draw();
  }
  function doImport() {
    var d = ui.pending;
    if (!d) return;
    var rec = JSON.parse(JSON.stringify(d)), prev = L.get(LS_NATION), prevBackup = L.get(LS_BACKUP);
    rec.updatedAt = Date.now(); /* newer than any copy in the region, so the game saves it there */
    var text = JSON.stringify(rec);
    if (prev) keepBackup(parse(prev));
    if (!L.set(LS_NATION, text)) { L.set(LS_BACKUP, prevBackup); setMsg('This browser would not store the nation: its storage may be full or blocked.', true); return; }
    SS.set(SS_IMPORT, JSON.stringify({ name: str(rec.name, 80), t: rec.updatedAt, prev: prev, prevBackup: prevBackup }));
    setBusy('Importing…');
    leave({ nation: text });
  }

  /* ───────── Google ───────── */
  function provider() { var p = new A.fb.auth.GoogleAuthProvider(); p.setCustomParameters({ prompt: 'select_account' }); return p; }
  function authMessage(e) {
    var c = String((e && e.code) || '');
    if (c === 'auth/popup-closed-by-user' || c === 'auth/cancelled-popup-request' || c === 'auth/user-cancelled') return 'Sign-in was cancelled.';
    if (c === 'auth/popup-blocked') return 'Your browser blocked the Google window. Allow pop-ups for this site and try again.';
    if (c === 'auth/unauthorized-domain') return 'Google sign-in is not set up for this web address yet: the site owner needs to add it to the authorised domains in Firebase Authentication.';
    if (c === 'auth/operation-not-allowed') return 'Google sign-in is not switched on for this game yet.';
    if (c === 'auth/network-request-failed') return 'Google could not be reached. Check your connection and try again.';
    if (c === 'auth/web-storage-unsupported') return 'This browser blocks the storage that sign-in needs, as private windows often do.';
    return 'Sign-in did not work (' + (c || 'unknown error') + '). Try again in a moment.';
  }
  function google() {
    var u = A.auth && A.auth.currentUser;
    if (!u || !u.isAnonymous) return;
    setBusy('Waiting for Google…');
    u.linkWithPopup(provider()).then(function () {
      setBusy('');
      var w = who(), n = localNation();
      ui.view = 'main'; draw(); paint();
      setMsg(n ? 'Linked. “' + n.name + '” is now kept with your Google account' + (w.email ? ', ' + w.email : '') + '.' : 'Linked to your Google account. The nation you found here will be kept with it.');
    }, function (e) {
      setBusy('');
      if (e && e.code === 'auth/credential-already-in-use') {
        A.cred = e.credential || null;
        if (A.cred && !localNation()) { doSwitch(); return; }
        ui.view = 'switch'; setMsg(''); draw(); return;
      }
      setMsg(authMessage(e), true);
    });
  }
  async function doSwitch() {
    var guest = localNation(), anon = A.auth.currentUser, cred = A.cred, res = null, cleared = false;
    setBusy('Switching to your Google account…');
    A.frozen = true; A.leaving = true; /* the game's own saves wait from here: the page reloads */
    try {
      if (cred) {
        if (guest && anon && anon.isAnonymous) {
          /* only this guest sign-in can remove the guest nation from the region, so do it now */
          await within(dropNation(anon.uid), 8000).then(function () { cleared = true; }, function () {});
        }
        res = await A.auth.signInWithCredential(cred);
      } else {
        res = await A.auth.signInWithPopup(provider());
      }
    } catch (e) {
      if (cleared && guest && anon) { try { await within(saveNation(anon.uid, guest), 8000); } catch (e2) {} }
      A.frozen = false; A.leaving = false; A.cred = null; setBusy('');
      setMsg(authMessage(e), true);
      return;
    }
    var nu = res && res.user, has = true, name = '';
    if (!nu) { leave({ nation: null, uid: '-' }); return; }
    try { var s = await within(A.fs.doc('nations/' + nu.uid).get(), 8000); has = s.exists; if (has) name = str((s.data() || {}).name, 80); } catch (e) { has = true; }
    if (has) {
      if (guest) keepBackup(guest);
      leave({ nation: null, uid: '-' }, name ? 'Signed in with Google. Welcome back to “' + name + '”.' : 'Signed in with Google.');
    } else {
      leave({ uid: nu.uid }, guest ? 'Signed in with Google. “' + guest.name + '” now lives in your Google account.' : 'Signed in with Google. The nation you found here will be kept with your account.');
    }
  }
  function doSignOut() {
    setBusy('Signing out…');
    A.leaving = true; A.frozen = true;
    A.auth.signOut().catch(function () {}).then(function () {
      leave({ nation: null, uid: '-' }, 'Signed out. This browser is now a new guest, and your nation is safe with your Google account.');
    });
  }

  if (!importVerdict()) return;
  var started = new Promise(function (r) { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', r, { once: true }); else r(); });
  started.then(boot).catch(function (e) { goOffline('start-up failed', e); });
})();
