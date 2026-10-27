/* Edictum on Firebase: the window.claude adapter and the account control.

   The game was written for the claude.ai artifact runtime, which gives a page
   window.claude.use('db' | 'user'). This file gives the same calls, backed by Firebase
   Auth and Firestore (compat SDK), so the game's source stays untouched.

   build.py inlines it after the game's own script; src/stub.js (in <head>) has already
   defined window.claude.use(), which waits until this file settles it.

   Storage format (see firestore.rules):
     nations/<uid>          {v:1, j:<the nation as JSON text>, reg, name, updatedAt, ts}: the shared half of
                            the record. Nation records contain arrays of arrays, which Firestore cannot
                            store, hence the JSON text. Players listen only to their own region's nations,
                            and every save is downloaded by every one of them.
     nationx/<uid>          {j:<JSON>, t, ts}: the private half (NX_KEYS), which only the nation's own player
                            needs, or another player opening that nation's pages. Nobody listens to it; it
                            is rewritten only when it changed. Loading nations/<uid> returns both, joined.
     summaries/<uid>        {reg, name, pop, t}: the headline for the World page and region counts.
     space/<uid>            {reg, name, t, j:<JSON of sp, belt, mapc, flag, pretitle>}, only for nations
                            with Moon, Mars or belt data. Every player listens to all of these, so it is
                            rewritten only when that data changes (or every SPACE_BEAT while playing).
     boards/<reg>/posts/<id> {a:<author uid>, t:<server time>, x:<text>}, with limits/<uid> {p} pacing posts.
     support/<id>           a player's support ticket and, once closed, an admin's answer; slimits/<uid> {s}
                            paces them.
   A nation save writes nations, summaries and (when needed) nationx and space in one batch; the rules
   check that they agree. */
(function () {
  'use strict';
  var E = window.__edictum;
  if (!E || E.started) return;
  E.started = true;

  var LS_NATION = 'statehood.nation.v1'; // the game's own copy of the player's nation
  var LS_UID = 'edictum.uid';            // the account that copy belongs to ('-' once signed out)
  var SS_FLASH = 'edictum.flash';        // a message to show after a reload
  var MAX_JSON = 700000;                 // well under Firestore's 1 MiB document limit
  var SPACE_BEAT = 12 * 3600000;         // rewrite an unchanged space document this often while playing
  var SPACE_MIN = 12000;                 // and a changed one at most this often (the rules allow one per 10 s)
  var RETRY_MS = 1500;                   // wait before trying a refused nation write once more
  var BOOT_AT = Date.now();
  var SIGN_IN_HOSTS = ['edictumgame.com']; // domains whose own address handles Google sign-in
  var SUPPORT_KEEP = 90 * 86400000;      // a closed support ticket is deleted this long after (Firestore TTL)
  var LS_SUP = 'edictum.support';        // set while this browser has sent a ticket that may get an answer
  var LS_SUP_SEEN = 'edictum.support.seen'; // the time of the last answer the player was told about
  var ERR = {
    'permission-denied': 'not_granted', unauthenticated: 'not_granted',
    'invalid-argument': 'invalid_argument', 'resource-exhausted': 'quota_exceeded', unavailable: 'unavailable'
  };
  var A = { fb: null, auth: null, fs: null, uid: null, online: false, why: '', frozen: false, leaving: false, cred: null, rest: '', projectId: '', spaceSent: {}, xSent: {} };

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
  /* The private half of a nation record: what only its own player reads (the edict engine, notices seen,
     tallies, intelligence, lore, the passport's stamps), or another player on opening that nation's
     museum, achievements, statistics or passport. Everything else stays in nations/, which the region
     reads at every save. The passport's design stays shared: visitors collect its entry stamp. */
  var NX_KEYS = {}, NX_PP = { v: 1, p: 1, l: 1 };
  ['inbox', 'chain', 'issueClock', 'issueSeq', 'freq', 'topics', 'iseen', 'isd', 'bonce', 'dec', 'shDone', 'seen',
    'bellSeen', 'mileAck', 'tut', 'autoLand', 'rpAt', 'rsk', 'mlk', 'lcb', 'lcgT', 'lcfx', 'mvl', 'regs', 'mvN', 'mvFrom',
    'mvCap', 'discArc', 'wck', 'drAt', 'alNpc', 'spy', 'intel', 'cvIn', 'cvEx', 'exp', 'mgc', 'mgAt', 'cabSeq', 'cabAt',
    'la', 'lt', 'peak', 'tly', 'tlf', 'tlx', 'colPin', 'colNm', 'lore', 'geo', 'flS', 'ppx'].forEach(function (k) { NX_KEYS[k] = 1; });
  function splitNation(d) {
    var pub = {}, ext = {};
    Object.keys(d).forEach(function (k) { (NX_KEYS[k] ? ext : pub)[k] = d[k]; });
    if (isObj(d.pp)) {
      var pp = {}, xp = {};
      Object.keys(d.pp).forEach(function (k) { (NX_PP[k] ? xp : pp)[k] = d.pp[k]; });
      pub.pp = pp; ext.pp = xp;
    }
    return [pub, ext];
  }
  /* the halves joined; the shared half wins, so a record last saved whole (before the split) reads as it was */
  function joinNation(pub, ext) {
    if (!isObj(pub) || !isObj(ext)) return pub;
    var out = Object.assign({}, ext, pub);
    if (isObj(ext.pp) && isObj(pub.pp)) out.pp = Object.assign({}, ext.pp, pub.pp);
    return out;
  }
  function decode(path, d) {
    if (!d) return d;
    var p = String(path).split('/'), col = p[0];
    if (col === 'nations') return typeof d.j === 'string' ? parse(d.j) : d;
    if (col === 'nationx') { var x = typeof d.j === 'string' ? parse(d.j) : null; return isObj(x) ? x : null; }
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
  /* a nation save: the shared half, its summary and, when they changed, the private half and the space document */
  function saveNation(uid, data, noSpace) {
    /* before the first space write of this page, count from the page load: a reload must not beat the pace */
    var enc = encode('nations', data), now = Date.now(), sent = A.spaceSent[uid] || { j: undefined, at: BOOT_AT }, next = null;
    var sj = spaceText(data), b = A.fs.batch(), halves = splitNation(isObj(data) ? data : {}), xj = JSON.stringify(halves[1]);
    enc.j = JSON.stringify(halves[0]);
    b.set(A.fs.doc('nations/' + uid), enc);
    if (A.xSent[uid] !== xj) b.set(A.fs.doc('nationx/' + uid), { j: xj, t: enc.updatedAt, ts: serverTime() });
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
    return b.commit().then(function () { A.xSent[uid] = xj; if (next) A.spaceSent[uid] = next; });
  }
  function dropNation(uid) {
    var b = A.fs.batch();
    ['nations/', 'nationx/', 'summaries/', 'space/'].forEach(function (c) { b.delete(A.fs.doc(c + uid)); });
    return b.commit().then(function () { A.spaceSent[uid] = { j: null, at: Date.now() }; delete A.xSent[uid]; });
  }
  /* a nation with its private half joined in */
  function getNation(uid) {
    return Promise.all([A.fs.doc('nations/' + uid).get(), A.fs.doc('nationx/' + uid).get().catch(function () { return null; })]).then(function (r) {
      var s = snapOf(r[0]), x = r[1] && r[1].exists ? r[1].data() : null;
      if (!s.exists || !x) return s;
      return { id: s.id, exists: true, data: function () { return joinNation(s.data(), decode('nationx', x)); } };
    });
  }
  function docApi(path) {
    var p = String(path).split('/').filter(Boolean), col = p[0], ref = A.fs.doc(p.join('/')), nation = col === 'nations' && p.length === 2;
    return Object.freeze({
      id: ref.id,
      path: ref.path,
      get: function () { return (nation ? getNation(p[1]) : ref.get().then(snapOf)).then(null, function (e) { throw mapError(e); }); },
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
  function collectionGroupApi(name) { return Object.freeze(queryApi(A.fs.collectionGroup(String(name)))); }
  /* ───────── support tickets ───────── */
  function ticketOf(s) {
    var d = s.data({ serverTimestamps: 'estimate' }) || {};
    return { id: s.id, by: str(d.by, 128), topic: str(d.topic, 20), x: str(d.x, 2000), t: millis(d.t), st: d.st === 'closed' ? 'closed' : 'open',
      name: str(d.name, 160), reg: str(d.reg, 40), email: str(d.email, 200), reply: str(d.reply, 2000), ct: millis(d.ct) };
  }
  /* the player has seen these: remember the latest answer, and stop looking once nothing is open */
  function supportSeen(list) {
    var last = num(Number(L.get(LS_SUP_SEEN))), open = false;
    list.forEach(function (t) { if (t.st === 'closed') last = Math.max(last, t.ct); else open = true; });
    L.set(LS_SUP_SEEN, last || null);
    if (!open) L.set(LS_SUP, null);
  }
  /* a while after the page loads, tell a player who is waiting for an answer that it has come */
  function supportCheck() {
    var u = A.auth && A.auth.currentUser;
    if (!L.get(LS_SUP) || !u || A.leaving) return;
    var seen = num(Number(L.get(LS_SUP_SEEN)));
    A.fs.collection('support').where('by', '==', u.uid).limit(50).get().then(function (qs) {
      var list = qs.docs.map(ticketOf), fresh = list.filter(function (t) { return t.st === 'closed' && t.ct > seen; });
      if (fresh.length) toast(fresh.length > 1 ? 'The Edictum team has answered ' + fresh.length + ' of your support tickets. The answers are on the Help page.'
        : 'The Edictum team has answered your support ticket. The answer is on the Help page.');
      supportSeen(list);
    }, function () {});
  }

  var dbApi = Object.freeze({ doc: docApi, collection: collectionApi, collectionGroup: collectionGroupApi, count: count, post: post });
  var userApi = Object.freeze({
    id: function () { var u = A.auth && A.auth.currentUser; return Promise.resolve(u ? u.uid : null); },
    /* asked once per page load; a fresh token carries an admin claim granted since the last one */
    isOwner: function () {
      var u = A.auth && A.auth.currentUser;
      if (!u) return Promise.resolve(false);
      return u.getIdTokenResult(true).catch(function () { return u.getIdTokenResult(); })
        .then(function (r) { return !!(r && r.claims && r.claims.admin === true); }, function () { return false; });
    },
    can: function (what) { return Promise.resolve(what === 'data.write' ? !!(A.auth && A.auth.currentUser) : false); }
  });
  /* the game opens the report dialog: open({kind:'post'|'nation', target:<uid>, post, reg, name, x}) */
  var reportApi = Object.freeze({ open: function (info) { if (isObj(info)) open('report', info); } });
  /* support tickets (see firestore.rules): the player opens one with open({name, reg, onSent}) and reads
     their own with mine(); admins list, answer and delete them */
  var supportApi = Object.freeze({
    open: function (info) { open('support', isObj(info) ? info : {}); },
    mine: function () {
      var u = A.auth && A.auth.currentUser;
      if (!u) return Promise.resolve([]);
      return A.fs.collection('support').where('by', '==', u.uid).limit(50).get().then(function (qs) {
        var list = qs.docs.map(ticketOf).sort(function (a, b) { return b.t - a.t; });
        supportSeen(list);
        return list;
      }, function (e) { throw mapError(e); });
    },
    list: function () {
      var c = A.fs.collection('support');
      return Promise.all([c.where('st', '==', 'open').limit(300).get(), c.orderBy('ct', 'desc').limit(30).get()]).then(function (r) {
        return { open: r[0].docs.map(ticketOf).sort(function (a, b) { return a.t - b.t; }), closed: r[1].docs.map(ticketOf) };
      }, function (e) { throw mapError(e); });
    },
    answer: function (id, reply) {
      var u = A.auth && A.auth.currentUser, d = { st: 'closed', ct: serverTime(), rby: u ? u.uid : '', exp: A.fb.firestore.Timestamp.fromMillis(Date.now() + SUPPORT_KEEP) };
      if (typeof reply === 'string' && reply.trim()) d.reply = reply.trim().slice(0, 2000);
      return A.fs.doc('support/' + str(id, 128)).update(d).then(function () {}, function (e) { throw mapError(e); });
    },
    remove: function (id) { return A.fs.doc('support/' + str(id, 128)).delete().then(function () {}, function (e) { throw mapError(e); }); }
  });
  function apiFor(online) {
    return Object.freeze({
      use: function (n) {
        if (!online) return null;
        return n === 'db' ? dbApi : n === 'user' ? userApi : n === 'report' ? reportApi : n === 'support' ? supportApi : null;
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
      leave({ nation: null, uid: user.uid }, 'The nation “' + mine.name + '” in this browser belongs to another sign-in. Sign in to that account to play it again.');
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
    /* on our own domain, Google sign-in runs through it (Hosting serves /__/auth/ there too), so
       Google's window names edictumgame.com, not <project>.firebaseapp.com. The address needs to be
       an authorised redirect URI of the project's OAuth client (README, Owner setup, step 8). */
    if (SIGN_IN_HOSTS.indexOf(location.hostname) >= 0) cfg = Object.assign({}, cfg, { authDomain: location.hostname });
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
    setTimeout(supportCheck, 6000);
  }

  /* ───────── the account control and its dialog ───────── */
  var ui = { box: null, btn: null, out: null, dlg: null, inn: null, msg: null, view: 'main', direct: false, busy: '', report: null, support: null };
  var ICON = '<svg class="ed-acct-ic" viewBox="0 0 20 20" aria-hidden="true" focusable="false"><circle cx="10" cy="10" r="8.6" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="10" cy="8.2" r="2.9" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M4.6 15.7c1.3-2.2 3.1-3.3 5.4-3.3s4.1 1.1 5.4 3.3" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>';
  var XICON = '<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
  var OUTICON = '<svg class="ed-out-ic" viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M8.2 3.6H5.1c-.8 0-1.5.7-1.5 1.5v9.8c0 .8.7 1.5 1.5 1.5h3.1" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path class="ed-out-ar" d="M12.6 6.4 16.2 10l-3.6 3.6M16 10H8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
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
    else { k = 'Playing offline'; v = head ? 'Sign-in unavailable' : 'Saved in this browser for now'; }
    ui.btn.innerHTML = ICON + '<span class="ed-acct-t"><span class="ed-acct-k">' + esc(k) + '</span> <span class="ed-acct-v">' + esc(v) + '</span></span>';
    /* signing out is offered under the control only to a Google account: a guest who signed out would lose the nation */
    if (ui.out) ui.out.hidden = !(w.kind === 'google' && !head);
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
    var out = document.createElement('button');
    out.type = 'button'; out.className = 'ed-out'; out.setAttribute('aria-haspopup', 'dialog'); out.hidden = true;
    out.innerHTML = OUTICON + '<span>Sign out</span>';
    out.addEventListener('click', function () { open('signout'); });
    box.appendChild(btn); box.appendChild(out);
    ui.box = box; ui.btn = btn; ui.out = out;
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
    d.innerHTML = '<button type="button" class="ed-x" data-ed="close" aria-label="Close">' + XICON + '</button><div class="ed-in"></div><p class="ed-msg" role="status" aria-live="polite"></p>';
    document.body.appendChild(d);
    ui.dlg = d; ui.inn = d.querySelector('.ed-in'); ui.msg = d.querySelector('.ed-msg');
    d.addEventListener('click', function (e) {
      if (e.target === d) { if (!ui.busy) d.close(); return; } /* the backdrop */
      var b = e.target.closest ? e.target.closest('[data-ed]') : null;
      if (b && !b.disabled) act(b.getAttribute('data-ed'));
    });
    d.addEventListener('cancel', function (e) { if (ui.busy) e.preventDefault(); });
    d.addEventListener('close', function () { ui.view = 'main'; ui.report = null; ui.support = null; setMsg(''); });
    /* while the dialog is open, keys belong to it, not to the game's shortcuts behind it */
    window.addEventListener('keydown', function (e) { if (d.open) e.stopPropagation(); }, true);
    return d;
  }
  function open(view, report) {
    var d = ensureDialog();
    ui.view = view || 'main';
    ui.direct = view === 'signout'; /* opened by the Sign out button: Cancel closes, rather than going back to the account */
    ui.report = view === 'report' ? report : null;
    ui.support = view === 'support' ? report : null;
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
  function draw() {
    if (!ui.inn) return;
    var w = who(), n = localNation(), nm = n ? quoted(n.name) : '', h = '';
    var row = function (x) { return '<div class="ed-row">' + x + '</div>'; };
    if (ui.view === 'switch') {
      h = '<p class="eyebrow">Your account</p><h2 class="ed-h" id="ed-dlg-h">Switch to that Google account?</h2>' +
        (n ? '<p>That Google account already plays Edictum. If it has a nation, that nation loads here and the guest nation ' + nm + ' is dissolved, because only this guest sign-in can play it. If it has no nation yet, ' + nm + ' moves into it.</p>'
           : '<p>That Google account already plays Edictum. Switch to it to carry on with its nation here.</p>') +
        row('<button type="button" class="btn" data-ed="switch" data-autofocus>Switch account</button><button type="button" class="btn ghost" data-ed="back">Cancel</button>');
    } else if (ui.view === 'report' && ui.report) {
      var r = ui.report, post = r.kind === 'post', reasons = REASONS.filter(function (x) { return post ? x[0] !== 'name' && x[0] !== 'cheating' : true; });
      h = '<p class="eyebrow">Report</p><h2 class="ed-h" id="ed-dlg-h">' + (post ? 'Report this post?' : 'Report ' + quoted(r.name) + '?') + '</h2>' +
        (post ? '<blockquote class="ed-quote">' + esc(str(r.x, 400)) + '</blockquote>' : '') +
        '<fieldset class="ed-reasons"><legend>What is wrong?</legend>' + reasons.map(function (x, i) {
          return '<label><input type="radio" name="ed-reason" value="' + x[0] + '"' + (i ? '' : ' checked data-autofocus') + '> ' + esc(post && x[0] === 'content' ? 'An offensive post' : x[1]) + '</label>';
        }).join('') + '</fieldset>' +
        '<label class="ed-lbl2" for="ed-note">Anything else the moderators should know? (optional)</label><textarea class="input" id="ed-note" rows="3" maxlength="300"></textarea>' +
        '<p class="ed-fine">Reports go to the game\'s moderators, not to the player. You can send one every 30 seconds.</p>' +
        row('<button type="button" class="btn" data-ed="report-yes">Send report</button><button type="button" class="btn ghost" data-ed="close">Cancel</button>');
    } else if (ui.view === 'support' && ui.support) {
      h = '<p class="eyebrow">Support</p><h2 class="ed-h" id="ed-dlg-h">Create a support ticket</h2>' +
        '<fieldset class="ed-reasons"><legend>What is it about?</legend>' + TOPICS.map(function (x, i) {
          return '<label><input type="radio" name="ed-topic" value="' + x[0] + '"' + (i ? '' : ' checked data-autofocus') + '> ' + esc(x[1]) + '</label>';
        }).join('') + '</fieldset>' +
        '<label class="ed-lbl2" for="ed-sup-x">What happened, or what would you like to know?</label><textarea class="input" id="ed-sup-x" rows="6" maxlength="2000"></textarea>' +
        '<label class="ed-lbl2" for="ed-sup-mail">Email address (optional, if you would like the answer by email too)</label><input class="input" id="ed-sup-mail" type="email" maxlength="200" autocomplete="email">' +
        '<p class="ed-fine">The answer appears on the Help page. The ticket includes your player ID and your nation\'s name, and only you and the game\'s team can read it. You can send one ticket a minute. <a href="/privacy" target="_blank" rel="noopener">Privacy</a></p>' +
        row('<button type="button" class="btn" data-ed="support-yes">Send ticket</button><button type="button" class="btn ghost" data-ed="close">Cancel</button>');
    } else if (ui.view === 'delete') {
      h = '<p class="eyebrow">Your account</p><h2 class="ed-h" id="ed-dlg-h">Delete your nation and account?</h2>' +
        '<p>This deletes ' + (n ? nm + ', with its land, cities and history,' : 'your nation') + ' every post you wrote on the region boards, and your account' + (w.kind === 'google' ? ' (its link to your Google account; your Google account itself stays)' : '') + '. Other players will no longer see any of it.</p>' +
        '<p><b>It cannot be undone.</b> Copies in the game\'s backups are gone within 14 days.</p>' +
        (w.kind === 'google' ? '<p class="ed-fine">Google may ask you to confirm it is you first.</p>' : '') +
        row('<button type="button" class="btn danger" data-ed="delete-yes">Delete everything</button><button type="button" class="btn ghost" data-ed="back" data-autofocus>Keep my nation</button>');
    } else if (ui.view === 'signout') {
      h = '<p class="eyebrow">Your account</p><h2 class="ed-h" id="ed-dlg-h">Sign out?</h2><p>' + (n ? nm + ' stays' : 'Your nation stays') + ' with your Google account. This browser starts again as a new guest, and you can sign back in at any time.</p>' +
        row('<button type="button" class="btn" data-ed="signout-yes" data-autofocus>Sign out</button><button type="button" class="btn ghost" data-ed="' + (ui.direct ? 'close' : 'back') + '">Cancel</button>');
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
        h = '<p class="eyebrow">Your account</p><h2 class="ed-h" id="ed-dlg-h">Playing offline</h2><p>Sign-in is not available right now, so ' + (n ? nm + ' is' : 'your nation is') + ' saved in this browser only. Reload the page when you are back online, and it joins the region again.</p>';
      }
      if (w.uid) h += '<p class="ed-id">Player ID <code>' + esc(w.uid) + '</code></p>';
      if (w.kind !== 'local') h += '<div class="ed-sec">' + row('<button type="button" class="linkish ed-danger" data-ed="delete">Delete my nation and account</button>') + '</div>';
      h += '<p class="ed-fine ed-legal"><a href="/privacy" target="_blank" rel="noopener">Privacy</a> · <a href="/terms" target="_blank" rel="noopener">Terms</a></p>';
    }
    ui.inn.innerHTML = h;
    if (ui.busy) setBusy(ui.busy);
    focusFirst();
  }
  function act(a) {
    if (a === 'close') { if (!ui.busy) ui.dlg.close(); return; }
    if (a === 'back') { ui.view = 'main'; setMsg(''); draw(); return; }
    if (a === 'google') { google(); return; }
    if (a === 'switch') { doSwitch(); return; }
    if (a === 'signout') { ui.view = 'signout'; setMsg(''); draw(); return; }
    if (a === 'signout-yes') { doSignOut(); return; }
    if (a === 'delete') { ui.view = 'delete'; setMsg(''); draw(); return; }
    if (a === 'delete-yes') { doDelete(); return; }
    if (a === 'report-yes') { sendReport(); return; }
    if (a === 'support-yes') { sendTicket(); return; }
  }

  /* ───────── reports ───────── */
  var REASONS = [['name', 'An offensive nation name, motto or flag'], ['content', 'An offensive description'], ['harassment', 'Harassment or bullying'],
    ['spam', 'Spam or advertising'], ['cheating', 'Cheating'], ['other', 'Something else']];
  function sendReport() {
    var r = ui.report, u = A.auth && A.auth.currentUser;
    if (!r || !u || ui.busy) return;
    var pick = ui.dlg.querySelector('input[name="ed-reason"]:checked'), note = ui.dlg.querySelector('#ed-note');
    var doc = { by: u.uid, kind: r.kind === 'post' ? 'post' : 'nation', target: str(r.target, 128), reg: str(r.reg, 40), reason: pick ? pick.value : 'other', t: serverTime() };
    if (r.kind === 'post' && r.post) doc.post = str(r.post, 64);
    if (note && note.value.trim()) doc.note = note.value.trim().slice(0, 300);
    if (r.name) doc.name = str(r.name, 160);
    if (r.x) doc.x = str(r.x, 600);
    setBusy('Sending…');
    var b = A.fs.batch();
    b.set(A.fs.collection('reports').doc(), doc);
    b.set(A.fs.doc('rlimits/' + u.uid), { r: serverTime() });
    b.commit().then(function () {
      setBusy(''); ui.dlg.close(); toast('Thank you. The report is with the moderators.');
    }, function (e) {
      setBusy('');
      setMsg(e && e.code === 'permission-denied' ? 'You can send one report every 30 seconds. Try again in a moment.' : 'The report could not be sent. Try again in a moment.', true);
    });
  }

  var TOPICS = [['bug', 'Something is broken'], ['account', 'My account or signing in'], ['play', 'A question about playing'], ['other', 'Something else']];
  function sendTicket() {
    var s = ui.support, u = A.auth && A.auth.currentUser;
    if (!s || !u || ui.busy) return;
    var pick = ui.dlg.querySelector('input[name="ed-topic"]:checked'), x = ui.dlg.querySelector('#ed-sup-x'), m = ui.dlg.querySelector('#ed-sup-mail');
    var text = x ? x.value.trim() : '', mail = m ? m.value.trim() : '', n = localNation();
    if (!text) { setMsg('Write a few words about what you need help with.', true); if (x) x.focus(); return; }
    if (mail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) { setMsg('That email address does not look right. Correct it, or leave it empty.', true); m.focus(); return; }
    var doc = { by: u.uid, topic: pick ? pick.value : 'other', x: text.slice(0, 2000), t: serverTime(), st: 'open' };
    var name = str(s.name, 160) || (n ? str(n.name, 160) : '');
    if (name) doc.name = name;
    if (s.reg) doc.reg = str(s.reg, 40);
    if (mail) doc.email = mail.slice(0, 200);
    setBusy('Sending…');
    var b = A.fs.batch();
    b.set(A.fs.collection('support').doc(), doc);
    b.set(A.fs.doc('slimits/' + u.uid), { s: serverTime() });
    b.commit().then(function () {
      L.set(LS_SUP, '1');
      setBusy(''); ui.dlg.close(); toast('Your ticket is with the Edictum team. The answer will appear on the Help page.');
      if (typeof s.onSent === 'function') { try { s.onSent(); } catch (e) { /* the game's own trouble */ } }
    }, function (e) {
      setBusy('');
      setMsg(e && e.code === 'permission-denied' ? 'You can send one ticket a minute. Try again in a moment.' : 'The ticket could not be sent. Try again in a moment.', true);
    });
  }

  /* ───────── deleting a nation and account ───────── */
  async function doDelete() {
    var u = A.auth && A.auth.currentUser;
    if (!u || ui.busy) return;
    var google = !u.isAnonymous, last = Date.parse((u.metadata && u.metadata.lastSignInTime) || '') || 0;
    setBusy('Deleting…');
    try {
      /* Google asks for a recent sign-in before an account is deleted: confirm first, while the click
         still counts as the player's (a pop-up opened later would be blocked) */
      if (google && Date.now() - last > 4 * 60000) await u.reauthenticateWithPopup(provider());
      A.frozen = true; A.leaving = true;
      var qs = await within(A.fs.collectionGroup('posts').where('a', '==', u.uid).get(), 15000);
      for (var i = 0; i < qs.docs.length; i += 400) {
        var bp = A.fs.batch();
        qs.docs.slice(i, i + 400).forEach(function (d) { bp.delete(d.ref); });
        await bp.commit();
      }
      var qt = await within(A.fs.collection('support').where('by', '==', u.uid).get(), 15000);
      for (var j = 0; j < qt.docs.length; j += 400) {
        var bt = A.fs.batch();
        qt.docs.slice(j, j + 400).forEach(function (d) { bt.delete(d.ref); });
        await bt.commit();
      }
      var b = A.fs.batch();
      ['nations/', 'nationx/', 'summaries/', 'space/', 'limits/', 'rlimits/', 'slimits/'].forEach(function (c) { b.delete(A.fs.doc(c + u.uid)); });
      await within(b.commit(), 15000);
    } catch (e) {
      A.frozen = false; A.leaving = false; setBusy('');
      setMsg(String((e && e.code) || '').indexOf('auth/') === 0 ? authMessage(e) : 'Nothing was deleted: the game could not reach the database. Try again in a moment.', true);
      return;
    }
    /* the data is gone; now the account. A guest's sign-in may be too old for that: it then simply
       ends, and the empty guest account holds nothing */
    L.set(LS_SUP, null); L.set(LS_SUP_SEEN, null);
    try { await u.delete(); } catch (e) { try { await A.auth.signOut(); } catch (e2) {} }
    leave({ nation: null, uid: '-' }, 'Your nation and account have been deleted. This browser starts again as a new guest.');
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

  var started = new Promise(function (r) { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', r, { once: true }); else r(); });
  started.then(boot).catch(function (e) { goOffline('start-up failed', e); });
})();
