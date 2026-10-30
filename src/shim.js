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
     summaries/<uid>        {reg, name, pop, t, e?}: the headline for the World page and region counts; e, with
                            a holiday after the save, is the time the nation counts as active until.
     space/<uid>            {reg, name, t, j:<JSON of sp, belt, mapc, flag, pretitle>}, only for nations
                            with Moon, Mars or belt data. Every player listens to all of these, so it is
                            rewritten only when what other regions read from it changes (spaceLayout: not the
                            running figures re-stamped at every save), or every SPACE_BEAT while playing.
     boards/<reg>/posts/<id> {a:<author uid>, t:<server time>, x:<text>}, with limits/<uid> {p} pacing posts.
     support/<id>           a player's support ticket and, once closed, an admin's answer; slimits/<uid> {s}
                            paces them.
   A nation save writes nations, summaries and (when needed) nationx and space in one transaction; the rules
   check that they agree. Battles go to the referee, a Cloud Function (functions/index.js), through
   window.claude.use('referee'). */
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
  var FN_REGION = 'europe-west1';        // where the referee runs (functions/index.js)
  var LS_SUP = 'edictum.support';        // set while this browser has sent a ticket that may get an answer
  var LS_SUP_SEEN = 'edictum.support.seen'; // the time of the last answer the player was told about
  var LS_STATS = 'edictum.analytics';    // 'y' or 'n': the visitor's answer to the visit statistics card
  var ERR = {
    'permission-denied': 'not_granted', unauthenticated: 'not_granted',
    'invalid-argument': 'invalid_argument', 'resource-exhausted': 'quota_exceeded', unavailable: 'unavailable'
  };
  var LS_EMAIL = 'edictum.emailLink';     // {email, mode} while a sign-in link is on its way to that address
  var LS_DISCORD = 'edictum.discord';      // src/discord.html's answer from Discord's window: {state, code, error}
  var A = { fb: null, auth: null, fs: null, uid: null, admin: false, online: false, why: '', frozen: false, leaving: false, sw: null, rest: '', projectId: '', raceAt: {},
    claims: null, claimsUid: '' };

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
    /* headline numbers beside the record, which the rules bound (growth since the last save, army and land for
       the population) and every player's game holds the record to: population, army strength, land claimed */
    var out = { v: 1, j: j, reg: str(d.reg, 40) || 'meridian', name: str(d.name, 80), updatedAt: num(d.updatedAt), ts: serverTime(),
      pop: Math.round(Math.min(1e7, Math.max(0, num(d.pop))) * 1e4) / 1e4, army: Math.round(Math.max(0, num(d.apw)) * 1e3) / 1e3,
      cl: Array.isArray(d.claims) ? d.claims.length : 0 };
    // Once expanded storage is used, older clients must not save their 400-unit interpretation over it.
    if (d.whv === 1) out.storageV = 1;
    return out;
  }
  function revision(d) { return d && Number.isSafeInteger(d._rev) && d._rev >= 0 ? d._rev : 0; }
  /* the part of a nation every region needs for Moon, Mars and the belt; null without any */
  function spaceText(d) {
    if (!isObj(d) || (!d.sp && !d.belt)) return null;
    var c = d.flag && Array.isArray(d.flag.c) ? d.flag.c.slice(0, 3) : [];
    return JSON.stringify({ sp: d.sp || null, belt: d.belt || null, mapc: str(d.mapc, 20), flag: { c: c }, pretitle: str(d.pretitle, 40) });
  }
  /* A space record as other regions read it: without the running figures its owner re-stamps at every save. A
     colony's people and expansion points as of a time (p, e, pa) are a starting point that every viewer carries
     forward to the present (the game's spRun), and they arrive at the same people from an older starting point
     (the game keeps p to a millionth of a person for that; other players never read e); the belt's haul mark
     and research points (hw, rp, ra) only the owner reads. Milestones (ml) and the
     terraforming level (tf) cannot be worked out that way, so they stay. Keys are sorted, so a record read back
     from storage in another order compares equal. '' for a record that cannot be read. */
  var SPACE_RUN = { sp: ['p', 'pa', 'e'], belt: ['hw', 'rp', 'ra'] };
  function sorted(v) {
    if (Array.isArray(v)) return v.map(sorted);
    if (!isObj(v)) return v;
    var o = {};
    Object.keys(v).sort().forEach(function (k) { o[k] = sorted(v[k]); });
    return o;
  }
  function spaceLayout(j) {
    var s = typeof j === 'string' ? parse(j) : null;
    if (!isObj(s)) return '';
    if (isObj(s.sp)) ['moon', 'mars'].forEach(function (b) { if (isObj(s.sp[b])) SPACE_RUN.sp.forEach(function (k) { delete s.sp[b][k]; }); });
    if (isObj(s.belt)) SPACE_RUN.belt.forEach(function (k) { delete s.belt[k]; });
    return JSON.stringify(sorted(s));
  }
  /* The private half of a nation record: what only its own player reads (the edict engine, notices seen,
     tallies, intelligence, lore, the passport's stamps), or another player on opening that nation's
     museum, achievements, statistics or passport. Everything else stays in nations/, which the region
     reads at every save. The passport's design stays shared: visitors collect its entry stamp. */
  var NX_KEYS = {}, NX_PP = { v: 1, p: 1, l: 1 };
  ['asmLocal', 'onb', 'mapPlan', 'inbox', 'chain', 'issueClock', 'issueSeq', 'freq', 'topics', 'iseen', 'isd', 'bonce', 'dec', 'shDone', 'seen',
    'bellSeen', 'mileAck', 'tut', 'autoLand', 'rpAt', 'rsk', 'mlk', 'lcb', 'whLc', 'lcgT', 'lcfx', 'mvl', 'regs', 'mvN', 'mvFrom',
    'mvCap', 'discArc', 'wck', 'drAt', 'alNpc', 'spy', 'intel', 'cvIn', 'cvEx', 'cuJournal', 'exp', 'mgc', 'mgAt', 'cabSeq', 'cabAt',
    'la', 'lt', 'peak', 'tly', 'tlf', 'tlx', 'colPin', 'colNm', 'lore', 'geo', 'flS', 'ppx'].forEach(function (k) { NX_KEYS[k] = 1; });
  function splitNation(d) {
    var pub = {}, ext = {};
    Object.keys(d).forEach(function (k) { if (k !== '_rev' && k !== '_dirty') (NX_KEYS[k] ? ext : pub)[k] = d[k]; });
    if (isObj(d.asm)) {
      ext.asmLocal = {};
      ['h','d','st','cur'].forEach(function(k) { if (k in d.asm) ext.asmLocal[k] = d.asm[k]; });
      delete pub.asm;
    }
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
    if (isObj(ext.asmLocal)) out.asm = Object.assign({}, ext.asmLocal, pub.asm || {});
    if (isObj(ext.pp) && isObj(pub.pp)) out.pp = Object.assign({}, ext.pp, pub.pp);
    return out;
  }
  function decode(path, d) {
    if (!d) return d;
    var p = String(path).split('/'), col = p[0];
    if (col === 'nations') {
      /* the record, with what the rules checked beside it: the server's time of the save and the headline
         numbers (set after parsing, so the record cannot claim its own) */
      var nd = typeof d.j === 'string' ? parse(d.j) : d;
      if (isObj(nd) && typeof d.j === 'string') Object.assign(nd, { _ts: millis(d.ts), _pop: typeof d.pop === 'number' ? d.pop : undefined,
        _army: typeof d.army === 'number' ? d.army : undefined, _cl: typeof d.cl === 'number' ? d.cl : undefined,
        _rev: Number.isSafeInteger(d.rev) && d.rev >= 0 ? d.rev : 0, _dirty: false });
      if (isObj(nd) && d.storageV === 1) nd.whv = 1;
      return nd;
    }
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
  /* a holiday after the last save (holiday mode, d.away {a, b}) does not count towards going dormant: the
     summary's e is t plus that part of it, so other regions' counts skip it too (the rules allow 32 days) */
  function activeUntil(d, t) {
    var w = isObj(d) && isObj(d.away) ? d.away : null, a = w ? num(w.a) : 0, b = w ? num(w.b) : 0;
    if (!(b > a) || !(t > 0)) return t;
    return t + Math.min(Math.max(0, b - Math.max(a, t)), 32 * 864e5 - 60000);
  }
  /* a nation save: the shared half, its summary and, when they changed, the private half and the space document */
  async function saveNation(uid, data, noSpace) {
    /* Space pacing and private-half changes are checked against the server, including saves made by
       another device; a per-page cache cannot safely decide whether a write can be skipped. */
    var enc = encode('nations', data), now = Date.now();
    var sj = spaceText(data), halves = splitNation(isObj(data) ? data : {}), xj = JSON.stringify(halves[1]);
    var ref = A.fs.doc('nations/' + uid), expected = revision(data);
    enc.j = JSON.stringify(halves[0]);
    var approved = await call('civic', { op: 'authorizeSave', record: { j: enc.j, reg: enc.reg, name: enc.name, pop: enc.pop, army: enc.army, cl: enc.cl, updatedAt: enc.updatedAt }, rev: expected });
    enc.j = approved.j; enc.permit = approved.permit;
    enc.rev = expected + 1;
    /* Read and compare in the same transaction as every part of the save. Firestore retries a raced
       transaction against the new document; it must still match the state this action was based on. */
    return A.fs.runTransaction(async function (b) {
      var current = await b.get(ref), saved = current.exists ? current.data() : null;
      for (var region of new Set([enc.reg, saved && saved.reg].filter(Boolean))) {
        var availability = await b.get(A.fs.doc('regionStatus/' + region));
        if (!A.admin && availability.exists && availability.data().enabled === false) {
          var maintenance = new Error(availability.data().mode === 'coming_soon' ? 'This region is coming soon. Please check back later.' : 'Current region is disabled and undergoing maintainance, check back soon.'); maintenance.code = 'region_disabled'; throw maintenance;
        }
      }
      if ((saved ? num(saved.rev) : 0) !== expected || (!saved && expected !== 0)) {
        var conflict = new Error('Another device saved this nation.'); conflict.code = 'save_conflict'; throw conflict;
      }
      // Supported clients preserve the guard even when restoring a backup from before warehouses.
      if (saved && saved.storageV === 1) enc.storageV = 1;
      var privateRef = A.fs.doc('nationx/' + uid), privateSnap = await b.get(privateRef);
      var spaceRef = A.fs.doc('space/' + uid), spaceSnap = await b.get(spaceRef), space = spaceSnap.exists ? spaceSnap.data() : null;
      b.set(A.fs.doc('nations/' + uid), enc);
      if (!privateSnap.exists || privateSnap.data().j !== xj) b.set(privateRef, { j: xj, t: enc.updatedAt, ts: serverTime() });
      var sum = { reg: enc.reg, name: enc.name, pop: enc.pop, t: enc.updatedAt }, e = activeUntil(data, enc.updatedAt);
      if (e > sum.t) sum.e = e;
      b.set(A.fs.doc('summaries/' + uid), sum);
      var raceFrom = A.raceAt[uid] != null ? A.raceAt[uid] : BOOT_AT;
      raceKeys(data, raceFrom).forEach(function (k) { b.set(A.fs.doc('stamps/' + enc.reg + '/' + k + '/' + uid), { t: serverTime() }); });
      if (noSpace) { /* leave space/ as it is */ }
      else if (sj) {
        var changed = !space || space.reg !== enc.reg || space.name !== enc.name || spaceLayout(space.j) !== spaceLayout(sj);
        var elapsed = space ? now - millis(space.ts) : Infinity;
        /* a change waits for the next save if the last space write was too recent */
        if ((changed && elapsed >= SPACE_MIN) || elapsed > SPACE_BEAT) {
          b.set(spaceRef, { reg: enc.reg, name: enc.name, t: enc.updatedAt, j: sj, ts: serverTime() });
        }
      } else if (space) {
        b.delete(spaceRef);
      }
    }).then(function () { A.raceAt[uid] = enc.updatedAt; setTimeout(recoveryCheck, 0); window.dispatchEvent(new Event('edictum:saved')); return { rev: enc.rev }; });
  }
  /* Races (a free hex claimed, a site found first) are judged by the server's time of the save that first
     carried each entry: every new claim or find gets stamps/<reg>/<c<cell>|s<site>>/<uid> {t: server time} in
     the same batch, and the rules accept no other time. New means made after the last save this page sent
     (or, before one, after the record it loaded, or the page load). */
  function raceKeys(d, since) {
    var out = [];
    if (!isObj(d)) return out;
    (Array.isArray(d.claims) ? d.claims : []).forEach(function (e) { if (e && num(e.t) > since && Number.isInteger(e.c) && e.c >= 0) out.push('c' + e.c); });
    (Array.isArray(d.disc) ? d.disc : []).forEach(function (e) { if (e && num(e.t) > since && (e.o === 'found' || e.o === 'great') && Number.isInteger(e.s) && e.s >= 0) out.push('s' + e.s); });
    return out.filter(function (k, i, a) { return a.indexOf(k) === i && k.length <= 7; }).slice(0, 200);
  }
  function dropNation(uid) {
    var b = A.fs.batch();
    ['nations/', 'nationx/', 'summaries/', 'space/'].forEach(function (c) { b.delete(A.fs.doc(c + uid)); });
    return b.commit().then(function () { delete A.raceAt[uid]; });
  }
  /* a nation with its private half joined in */
  function getNation(uid) {
    /* Own saves must use a coherent, server-confirmed pair. Separate gets can combine the shared half
       before another device's save with its private half afterwards (and cached reads can be stale). */
    var read = uid === A.uid ? A.fs.runTransaction(async function (tx) {
      return [await tx.get(A.fs.doc('nations/' + uid)), await tx.get(A.fs.doc('nationx/' + uid))];
    }) : Promise.all([A.fs.doc('nations/' + uid).get(), A.fs.doc('nationx/' + uid).get().catch(function () { return null; })]);
    return read.then(function (r) {
      var s = snapOf(r[0]), x = r[1] && r[1].exists ? r[1].data() : null;
      /* the player's own record, as saved: its claims and finds were stamped with that save */
      if (uid === A.uid && s.exists) { var own = s.data(); A.raceAt[uid] = isObj(own) ? num(own.updatedAt) : 0; }
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
          if (!A.auth.currentUser || A.auth.currentUser.uid !== p[1]) return Promise.reject(mapError({ code: 'permission-denied' }));
          try { encode(col, data); } catch (e) { return Promise.reject(e && e.firebaseCode ? e : mapError(e)); }
          return retried(function (noSpace) { return saveNation(p[1], data, noSpace); }).then(function (r) { return r; }, function (e) { throw mapError(e); });
        }
        return ref.set(encode(col, data)).then(function () {}, function (e) { throw mapError(e); });
      },
      delete: function () {
        if (A.frozen) return hang();
        if (A.admin && col === 'boards' && p.length === 4) return adminApi.request({ op: 'moderate', action: 'delete_post', target: p[3], reg: p[1], reason: 'Removed from the region board' });
        return (nation ? dropNation(p[1]) : ref.delete()).then(function () {}, function (e) { throw mapError(e); });
      },
      onSnapshot: function (next, error) {
        return ref.onSnapshot(function (s) { next(snapOf(s)); }, function (e) { if (typeof error === 'function') error(mapError(e)); });
      }
    });
  }
  function queryApi(q) {
    /* fromCache: the snapshot came from this browser's copy, before the server confirmed it */
    function qsOf(qs) { return { size: qs.size, empty: qs.empty, docs: qs.docs.map(snapOf), fromCache: !!(qs.metadata && qs.metadata.fromCache) }; }
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
    return call('civic', { op: 'topic', reg: str(reg,40), text: String(text || '') }).then(function(r) { return r.id; });
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

  /* ───────── the referee (functions/index.js) ───────── */
  /* a callable function, by its protocol: POST {data} with the player's ID token; {result} or {error} back */
  async function call(name, data) {
    var u = A.auth && A.auth.currentUser;
    if (!u) throw mapError({ code: 'unauthenticated' });
    var r, b;
    try {
      r = await within(fetch(A.fn + '/' + name, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + await u.getIdToken() }, body: JSON.stringify({ data: data }) }), name === 'adminConsole' ? 120000 : 20000);
      b = await r.json().catch(function () { return null; });
    } catch (e) { throw mapError({ code: 'unavailable', message: (e && e.message) || 'the referee could not be reached' }); }
    if (r.ok && b && 'result' in b) return b.result;
    var e = (b && b.error) || {};
    throw mapError({ code: (e.details && e.details.code) || String(e.status || (r.status === 429 ? 'resource-exhausted' : 'unavailable')).toLowerCase().replace(/_/g, '-'), message: e.message || 'HTTP ' + r.status });
  }
  /* battles are rolled by the referee: battle({d, c, p, w, h}) → {ok, win, t, s?, p, r} or {ok: false, why, next?} */
  var refereeApi = Object.freeze({
    battle: function (d) { return A.frozen ? hang() : call('referee', Object.assign({}, isObj(d) ? d : {}, { op: 'battle' })); }
  });
  var civicApi = Object.freeze({ request: function(data) { return call('civic', data); } });
  var adminApi = Object.freeze({ request: function (data) { return call('adminConsole', data); } });

  var dbApi = Object.freeze({ doc: docApi, collection: collectionApi, collectionGroup: collectionGroupApi, count: count, post: post });
  var userApi = Object.freeze({
    id: function () { var u = A.auth && A.auth.currentUser; return Promise.resolve(u ? u.uid : null); },
    /* asked once per page load; a fresh token carries an admin claim granted since the last one */
    isOwner: function () {
      var u = A.auth && A.auth.currentUser;
      if (!u) return Promise.resolve(false);
      return u.getIdTokenResult(true).catch(function () { return u.getIdTokenResult(); })
        .then(function (r) { keepClaims(u, r); A.admin = !!(r && r.claims && r.claims.admin === true); return A.admin; }, function () { A.admin = false; return false; });
    },
    /* linked through a sign-in the player chose: Google, Discord or an email link (the game's first steps
       reward it); the page hears 'edictum:linked' when it links. The name is the game's, from when Google was
       the only one. A password account (only the tests make them) does not count. */
    google: function () {
      var u = A.auth && A.auth.currentUser;
      return Promise.resolve(!!(u && (hasProvider(u, 'google.com') || discordOf(u) || hasProvider(u, 'password') && u.emailVerified && L.get('edictum.emailLinked.' + u.uid))));
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
      return adminApi.request({ op: 'moderate', action: reply && reply.trim() ? 'support_answer' : 'support_close', target: id, reply: reply || '', reason: reply && reply.trim() ? 'Answered support ticket' : 'Closed support ticket without an answer' });
    },
    remove: function (id) { return adminApi.request({ op: 'moderate', action: 'support_delete', target: id, reason: 'Deleted support spam' }); }
  });
  function apiFor(online) {
    return Object.freeze({
      use: function (n) {
        if (!online) return null;
        return n === 'civic' ? civicApi : n === 'db' ? dbApi : n === 'user' ? userApi : n === 'report' ? reportApi : n === 'support' ? supportApi : n === 'referee' ? refereeApi : n === 'admin' ? adminApi : null;
      }
    });
  }

  /* ───────── visit statistics: Google Analytics, only once the visitor allows it ─────────
     The measurement ID is the one Firebase serves with the configuration (the project's linked
     Google Analytics property). Nothing is loaded from Google until the visitor chooses Allow on the
     card; LS_STATS keeps the answer, which the account menu and the privacy notice can change. Pages
     count by their name alone (#visit/<id> is /visit), never with a player ID or a nation, and
     Google's advertising features stay off. This is the gtag snippet itself rather than the Firebase
     SDK's analytics, whose compat build cannot turn off the automatic page views or ad signals. */
  var GA = { id: '', on: false, page: '', card: null };
  function localHost() { return /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname); }
  function statsId(cfg) {
    var id = String(window.EDICTUM_ANALYTICS_ID || (!localHost() && !/^demo-/.test(String(cfg.projectId)) && cfg.measurementId) || '');
    return /^G-[A-Z0-9]{4,20}$/.test(id) ? id : '';
  }
  function statsChoice() { var v = L.get(LS_STATS); return v === 'y' || v === 'n' ? v : ''; }
  function gtag() { window.dataLayer.push(arguments); }
  function statsPage() { return '/' + (location.hash || '').slice(1).split('/')[0].toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40); }
  function statsView() {
    if (!GA.on || statsPage() === GA.page) return;
    GA.page = statsPage();
    /* the game puts a count of what is waiting before the page's name in the tab ("(3) Edicts · Edictum");
       statistics use the page's name alone, so a page is one page however much waits */
    var at = { page_location: location.origin + GA.page, page_title: document.title.replace(/^\(\d+\) /, '') };
    gtag('set', at); /* for Google's own events too (scrolls, outbound links, engagement) */
    gtag('event', 'page_view', at);
  }
  function statsStart() {
    if (GA.on || !GA.id) return;
    GA.on = true; GA.page = '';
    window['ga-disable-' + GA.id] = false;
    if (window.dataLayer) gtag('consent', 'update', { analytics_storage: 'granted' });
    else {
      window.dataLayer = [];
      gtag('consent', 'default', { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'granted' });
      gtag('js', new Date());
      gtag('config', GA.id, { send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false });
      var s = document.createElement('script');
      s.async = true; s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(GA.id);
      document.head.appendChild(s);
    }
    statsView();
  }
  function statsStop() {
    if (GA.id) window['ga-disable-' + GA.id] = true;
    if (GA.on) gtag('consent', 'update', { analytics_storage: 'denied' });
    GA.on = false;
    /* Google's cookies (_ga, _ga_<stream>) sit on the widest domain the browser allows */
    document.cookie.split(';').forEach(function (c) {
      var k = c.split('=')[0].trim(), d = location.hostname.split('.');
      if (!/^_ga/.test(k)) return;
      for (var i = 0; i < d.length - 1; i++) document.cookie = k + '=; Max-Age=0; path=/; domain=.' + d.slice(i).join('.');
      document.cookie = k + '=; Max-Age=0; path=/';
    });
  }
  function statsApply(v) {
    v = v || statsChoice();
    if (v && GA.card) { GA.card.remove(); GA.card = null; }
    if (v === 'y') statsStart(); else if (v === 'n') statsStop();
  }
  function statsSet(v) { L.set(LS_STATS, v); statsApply(v); }
  /* answered in another tab, or on the privacy notice */
  window.addEventListener('storage', function (e) { if (e.key === LS_STATS && GA.id) statsApply(); });
  function statsAsk() {
    if (!GA.id || statsChoice() || GA.card) return;
    var c = document.createElement('section');
    c.className = 'ed-stats'; c.setAttribute('aria-label', 'Visit statistics');
    c.innerHTML = '<p><b>Help us see how Edictum is played?</b> With your permission, Google Analytics counts visits: the pages you open, your type of device and browser, and roughly where you are. It sets cookies. Nothing about your nation or your messages is sent. <a href="/privacy#analytics" target="_blank" rel="noopener">Privacy</a></p>' +
      '<div class="ed-row"><button type="button" class="btn" data-ed="stats-y">Allow</button><button type="button" class="btn ghost" data-ed="stats-n">No thanks</button></div>';
    c.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-ed]') : null;
      if (b) statsSet(b.getAttribute('data-ed') === 'stats-y' ? 'y' : 'n');
    });
    document.body.appendChild(c);
    GA.card = c;
    statsLift();
  }
  /* above the phone tab bar and the founding page's Found bar, which are fixed at the bottom too */
  function statsLift() {
    if (!GA.card) return;
    var bar = document.querySelector('.tabbar, .found-bar'), r = bar && bar.getBoundingClientRect();
    GA.card.style.bottom = r && r.height && r.top < innerHeight ? Math.round(innerHeight - r.top + 12) + 'px' : '';
  }
  window.addEventListener('resize', statsLift);

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
    if (!localHost() || !/^demo-/.test(String(cfg.projectId || ''))) return null;
    return { firestore: '127.0.0.1:8080', auth: 'http://127.0.0.1:9099', functions: '127.0.0.1:5001' };
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
    GA.id = statsId(cfg);
    statsApply(); statsAsk();
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
    A.fn = emu && emu.functions ? 'http://' + String(emu.functions) + '/' + A.projectId + '/' + FN_REGION : 'https://' + FN_REGION + '-' + A.projectId + '.cloudfunctions.net';
    /* opened from an emailed sign-in link: finish it once the page is up, and keep the code out of the address bar */
    var emailLink = '';
    try { if (auth.isSignInWithEmailLink(location.href)) { emailLink = location.href; history.replaceState(history.state, '', location.pathname + location.hash); } } catch (e) {}
    var user = null;
    try {
      user = await within(firstUser(auth), 10000);
      if (!user) user = (await within(auth.signInAnonymously(), 15000)).user;
    } catch (e) { return goOffline('anonymous sign-in failed', e); }
    if (!user) return goOffline('anonymous sign-in failed');
    if (await guard(user)) return;
    L.set(LS_UID, user.uid);
    A.uid = user.uid;
    try { await within(readClaims(user), 5000); } catch (e) { /* read again when the token changes */ }
    A.online = E.settle(apiFor(true));
    if (!A.online) { A.why = 'start-up took too long'; mount(); return; }
    auth.onIdTokenChanged(function (u) {
      if (A.leaving) return;
      if (!u || u.uid !== A.uid) { leave({}); return; } /* signed in or out in another tab */
      readClaims(u).then(paint, paint);
    });
    mount();
    if (emailLink) finishEmailLink(emailLink);
    setTimeout(supportCheck, 6000);
    setTimeout(recoveryCheck, 1800);
  }

  /* ───────── the account control and its dialog ───────── */
  var ui = { box: null, btn: null, sync: null, out: null, dlg: null, inn: null, msg: null, view: 'main', direct: false, busy: '', report: null, support: null };
  var ICON = '<svg class="ed-acct-ic" viewBox="0 0 20 20" aria-hidden="true" focusable="false"><circle cx="10" cy="10" r="8.6" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="10" cy="8.2" r="2.9" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M4.6 15.7c1.3-2.2 3.1-3.3 5.4-3.3s4.1 1.1 5.4 3.3" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>';
  var XICON = '<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
  var OUTICON = '<svg class="ed-out-ic" viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M8.2 3.6H5.1c-.8 0-1.5.7-1.5 1.5v9.8c0 .8.7 1.5 1.5 1.5h3.1" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path class="ed-out-ar" d="M12.6 6.4 16.2 10l-3.6 3.6M16 10H8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function quoted(s) { return '“' + esc(s) + '”'; }
  /* the sign-ins a guest can link, and a Registered Nation can add: Discord is a custom claim, not a provider
     Firebase knows (functions/discord.js), and an email link is Firebase's 'password' provider without a password */
  var LINK_OPTIONS = [{ provider: 'google.com', name: 'Google', action: 'google' }, { provider: 'discord', name: 'Discord', action: 'discord' },
    { provider: 'password', name: 'email', action: 'email' }];
  /* each sign-in's mark, on a small round seal like the game's stamps (shim.css, .ed-mark): Google's G and
     Discord's logo as their brand rules ask (the G in its own colours, on white), and for email a letter
     under a wax seal, on the game's stamp purple */
  var MARKS = {
    google: '<svg viewBox="0 0 48 48" aria-hidden="true" focusable="false"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>',
    discord: '<svg viewBox="0 0 127.14 96.36" aria-hidden="true" focusable="false"><path fill="#fff" d="M107.7 8.07A105.15 105.15 0 0 0 81.47 0a72.06 72.06 0 0 0-3.36 6.83 97.68 97.68 0 0 0-29.11 0A72.37 72.37 0 0 0 45.64 0a105.89 105.89 0 0 0-26.25 8.09C2.79 32.65-1.71 56.6.54 80.21a105.73 105.73 0 0 0 32.17 16.15 77.7 77.7 0 0 0 6.89-11.11 68.42 68.42 0 0 1-10.85-5.18c.91-.66 1.8-1.34 2.66-2a75.57 75.57 0 0 0 64.32 0c.87.71 1.76 1.39 2.66 2a68.68 68.68 0 0 1-10.87 5.19 77 77 0 0 0 6.89 11.1 105.25 105.25 0 0 0 32.19-16.14c2.64-27.38-4.51-51.11-18.9-72.15ZM42.45 65.69C36.18 65.69 31 60 31 53s5-12.74 11.43-12.74S54 46 53.89 53s-5.05 12.69-11.44 12.69Zm42.24 0C78.41 65.69 73.25 60 73.25 53s5-12.74 11.44-12.74S96.23 46 96.12 53s-5.04 12.69-11.43 12.69Z"/></svg>',
    email: '<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><rect x="2.8" y="4.6" width="14.4" height="10.8" rx="1.4" fill="none" stroke="#fff" stroke-width="1.5"/><path d="M3.4 5.4 10 10.6l6.6-5.2" fill="none" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/><circle cx="10" cy="11" r="2.3" fill="#fff"/><circle cx="10" cy="11" r="1" fill="#6a3db3"/></svg>'
  };
  function linkingButtons(u) {
    var guest = !linkedUser(u);
    return LINK_OPTIONS.filter(function (o) { return !hasProvider(u, o.provider); }).map(function (o) {
      return '<button type="button" class="btn ed-signin' + (guest ? '' : ' ghost') + '" data-ed="' + o.action + '"><span class="ed-mark ed-mark-' + o.action + '">' + MARKS[o.action] + '</span><span>' +
        esc((guest ? 'Continue with ' : 'Add ') + o.name) + '</span></button>';
    }).join('');
  }
  /* the account's custom claims: admin, and dc/dcn, a linked Discord account's id and name */
  function keepClaims(u, r) { if (u && r && r.claims) { A.claims = r.claims; A.claimsUid = u.uid; } }
  function readClaims(u) { return u ? u.getIdTokenResult().then(function (r) { keepClaims(u, r); }) : Promise.resolve(); }
  function discordOf(u) { var c = u && A.claimsUid === u.uid && A.claims; return c && typeof c.dc === 'string' && c.dc ? { id: c.dc, name: str(c.dcn, 40) } : null; }
  function hasProvider(u, id) { return id === 'discord' ? !!discordOf(u) : !!(u && (u.providerData || []).some(function (p) { return p && p.providerId === id; })); }
  function linkedUser(u) { return !!(u && ((u.providerData || []).some(function(p) { return p.providerId !== 'password' || u.emailVerified; }) || discordOf(u))); }
  function who() {
    var u = A.online && A.auth && A.auth.currentUser;
    if (!u) return { kind: 'local' };
    if (!linkedUser(u)) return { kind: 'guest', uid: u.uid };
    var pick = function (id) { return (u.providerData || []).filter(function (x) { return x && x.providerId === id; })[0] || null; };
    var g = pick('google.com'), m = pick('password'), dc = discordOf(u), via = [];
    if (g) via.push('Google' + (g.email ? ' (' + g.email + ')' : ''));
    if (dc) via.push('Discord (' + (dc.name || 'linked') + ')');
    if (m && m.email) via.push('email (' + m.email + ')');
    return { kind: 'linked', uid: u.uid, email: (g && g.email) || (m && m.email) || u.email || '', name: u.displayName || (g && g.displayName) || '',
      discord: dc ? dc.name || 'Discord' : '', google: !!g, via: via };
  }
  function paintSync() {
    if (!ui.sync) return;
    ui.sync.hidden = ui.box.classList.contains('ed-head') || !localNation();
    var state = !A.online || navigator.onLine === false ? 'offline' : E.syncStatus || 'saving';
    var labels = { synced: 'Synced', saving: 'Saving', offline: 'Offline' };
    var tips = { synced: 'Your latest changes are saved online.', saving: 'Your latest changes are waiting for server confirmation.',
      offline: 'Your nation is saved in this browser. Reconnect or reload to sync.' };
    if (ui.sync.dataset.state === state) return;
    ui.sync.dataset.state = state;
    ui.sync.textContent = labels[state];
    ui.sync.title = tips[state];
  }
  window.addEventListener('edictum:sync', paintSync);
  // Coalesce status changes; heartbeat only visible sessions. Offline browsers cannot report a live status.
  var healthTimer = 0, healthLast = -15000;
  var healthSession = SS.get('edictum.health.session') || (window.crypto && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));
  SS.set('edictum.health.session', healthSession);
  function healthSoon() {
    if (healthTimer || !A.online || A.frozen || A.leaving || !A.auth.currentUser || !localNation()) return;
    healthTimer = setTimeout(function () {
      healthTimer = 0;
      if (!navigator.onLine || A.frozen || A.leaving) return;
      var n = localNation(), h = E.saveHealth;
      if (!n || !h) return;
      healthLast = performance.now();
      A.fs.doc('saveHealth/' + A.uid + '_' + healthSession).set({ uid: A.uid, reg: str(n.reg, 40) || 'meridian',
        device: /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) ? 'Mobile' : 'Desktop', status: E.syncStatus || 'saving',
        revision: revision(n), pending: !!n._dirty, error: str(h.error, 64), conflicts: Math.min(1000000, num(h.conflicts)),
        t: serverTime(), expiresAt: A.fb.firestore.Timestamp.fromMillis(Date.now() + 7 * 86400000)
      }).catch(function () { /* diagnostics must never interfere with saving the nation */ });
    }, Math.max(250, healthLast + 15000 - performance.now()));
  }
  window.addEventListener('edictum:sync', healthSoon);
  setInterval(function () { if (!document.hidden) healthSoon(); }, 60000);
  window.addEventListener('online', paintSync);
  window.addEventListener('offline', paintSync);
  function paint() {
    if (!ui.btn) return;
    var w = who(), head = ui.box.classList.contains('ed-head'), k, v;
    if (w.kind === 'linked') { k = head ? 'Signed in' : 'Registered Nation'; v = w.email || w.discord || w.name || 'Your account'; }
    else if (w.kind === 'guest') { k = head ? 'Have a nation?' : 'Guest Nation'; v = head ? 'Sign in' : 'Keep your nation on every device'; }
    else { k = 'Playing offline'; v = head ? 'Sign-in unavailable' : 'Saved in this browser for now'; }
    ui.btn.innerHTML = ICON + '<span class="ed-acct-t"><span class="ed-acct-k">' + esc(k) + '</span> <span class="ed-acct-v">' + esc(v) + '</span></span>';
    /* Guest sign-out uses the recovery-code confirmation; both account types can end this browser session. */
    if (ui.out) ui.out.hidden = !(!head && (w.kind === 'linked' || w.kind === 'guest' && localNation()));
    paintSync();
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
    paintSync();
  }
  function mount() {
    if (ui.box) { paint(); return; }
    var box = document.createElement('div'), btn = document.createElement('button');
    box.className = 'ed-acct';
    btn.type = 'button'; btn.className = 'ed-acct-b'; btn.setAttribute('aria-haspopup', 'dialog');
    btn.addEventListener('click', function () { open('main'); });
    var sync = document.createElement('div');
    sync.className = 'ed-sync'; sync.setAttribute('role', 'status'); sync.setAttribute('aria-live', 'polite'); sync.setAttribute('aria-atomic', 'true');
    var out = document.createElement('button');
    out.type = 'button'; out.className = 'ed-out'; out.setAttribute('aria-haspopup', 'dialog'); out.hidden = true;
    out.innerHTML = OUTICON + '<span>Sign out</span>';
    out.addEventListener('click', function () { open('signout'); });
    box.appendChild(btn); box.appendChild(sync); box.appendChild(out);
    ui.box = box; ui.btn = btn; ui.sync = sync; ui.out = out;
    var app = document.getElementById('app');
    if (app && window.MutationObserver) new MutationObserver(function () { place(); statsView(); statsLift(); }).observe(app, { childList: true, subtree: true });
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
    d.addEventListener('change', function(e) { if (e.target.id === 'ed-guest-code-saved') syncSignoutButton(); });
    d.addEventListener('cancel', function (e) { if (ui.busy) e.preventDefault(); });
    d.addEventListener('close', function () { ui.view = 'main'; ui.report = null; ui.support = null; setMsg(''); });
    /* while the dialog is open, keys belong to it, not to the game's shortcuts behind it; Enter in a field
       with data-enter does that field's action */
    window.addEventListener('keydown', function (e) {
      if (!d.open) return;
      e.stopPropagation();
      var go = e.key === 'Enter' && e.target && e.target.getAttribute && e.target.getAttribute('data-enter');
      if (go && !ui.busy) { e.preventDefault(); act(go); }
    }, true);
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
    syncSignoutButton();
  }
  function draw() {
    if (!ui.inn) return;
    var w = who(), n = localNation(), nm = n ? quoted(n.name) : '', h = '';
    var row = function (x) { return '<div class="ed-row">' + x + '</div>'; };
    if (ui.view === 'recovery-code') {
      var pending = pendingRecoveryCode();
      h = '<p class="eyebrow">Guest Nation</p><h2 class="ed-h" id="ed-dlg-h">Save your recovery code</h2>' +
        '<p>This code restores your nation on another browser or device. Keep it somewhere private, outside this browser.</p>' +
        '<p class="ed-quote" style="overflow-wrap:anywhere"><code id="ed-recovery-code">' + esc(pending || '') + '</code></p>' +
        '<p><b>A lost code cannot be retrieved.</b> You can regenerate a key while this Guest session is active. Without an active session or a working code, access cannot be recovered. Anyone with the code can access your nation.</p>' +
        row('<button type="button" class="btn ghost" data-ed="recovery-copy">Copy code</button><button type="button" class="btn ghost" data-ed="recovery-download">Download code</button>') +
        row('<button type="button" class="btn" data-ed="recovery-saved" data-autofocus>I saved my recovery code</button>');
    } else if (ui.view === 'regenerate') {
      h = '<p class="eyebrow">Guest Nation</p><h2 class="ed-h" id="ed-dlg-h">Regenerate recovery key?</h2>' +
        '<p>Generate a new recovery key for ' + nm + '.</p><p><b>Your previous key stops working immediately.</b> Devices already signed in stay signed in, and your nation keeps its progress.</p><p>Save the new key outside this browser before signing out. The old key cannot be retrieved.</p>' +
        row('<button type="button" class="btn" data-ed="recovery-regenerate-yes">Regenerate key</button><button type="button" class="btn ghost" data-ed="recovery-regenerate-cancel" data-autofocus>Cancel</button>');
    } else if (ui.view === 'recover') {
      h = '<p class="eyebrow">Guest Nation</p><h2 class="ed-h" id="ed-dlg-h">Recover your nation</h2>' +
        '<p>Enter your most recently saved recovery code. Your existing progress will load on this device.</p>' +
        '<label class="ed-lbl2" for="ed-recovery-input">Recovery code</label><input class="input" id="ed-recovery-input" autocomplete="off" spellcheck="false" maxlength="80" data-autofocus>' +
        '<p class="ed-fine">Lost the code? Try a browser where your Guest session is still active and choose Regenerate recovery key in your account panel. Without an active session or a working code, access cannot be recovered. Registered Nations use their linked sign-in instead.</p>' +
        row('<button type="button" class="btn" data-ed="recover-yes">Recover nation</button><button type="button" class="btn ghost" data-ed="back">Back</button>');
    } else if (ui.view === 'switch') {
      var what = (A.sw && A.sw.what) || 'Google account', that = 'That ' + what;
      h = '<p class="eyebrow">Your account</p><h2 class="ed-h" id="ed-dlg-h">Switch to that ' + esc(what) + '?</h2>' +
        (n ? '<p>' + esc(that) + ' already plays Edictum. If it has a nation, that nation loads here and the guest nation ' + nm + ' is dissolved, and its recovery code will no longer restore it. If it has no nation yet, ' + nm + ' moves into it.</p>'
           : '<p>' + esc(that) + ' already plays Edictum. Switch to it to carry on with its nation here.</p>') +
        row('<button type="button" class="btn" data-ed="switch" data-autofocus>Switch account</button><button type="button" class="btn ghost" data-ed="back">Cancel</button>');
    } else if (ui.view === 'email') {
      var adding = w.kind === 'linked' || !!n;
      h = '<p class="eyebrow">' + (w.kind === 'linked' ? 'Registered Nation' : n ? 'Guest Nation' : 'Your account') + '</p><h2 class="ed-h" id="ed-dlg-h">' + (adding ? 'Link an email address' : 'Sign in with email') + '</h2>' +
        '<p>' + (adding ? 'We email you a sign-in link. Open it in this browser, and ' + (n ? nm : 'your nation') + ' is kept with that address: use it to sign in on any device.'
          : 'We email you a sign-in link. Open it in this browser to carry on with the nation kept with that address, or to found one.') + '</p>' +
        '<label class="ed-lbl2" for="ed-email">Email address</label><input class="input" id="ed-email" type="email" maxlength="200" autocomplete="email" spellcheck="false" data-enter="email-send" value="' + esc(ui.email || '') + '" data-autofocus>' +
        '<p class="ed-fine">No password: each link works once. Edictum uses the address only to sign you in. <a href="/privacy" target="_blank" rel="noopener">Privacy</a></p>' +
        row('<button type="button" class="btn" data-ed="email-send">Send the link</button><button type="button" class="btn ghost" data-ed="back">Back</button>');
    } else if (ui.view === 'email-sent') {
      h = '<p class="eyebrow">Check your email</p><h2 class="ed-h" id="ed-dlg-h">Open the link we sent</h2>' +
        '<p>We sent a sign-in link to <b>' + esc(ui.email) + '</b>. Open it in this browser to finish. It can take a minute to arrive; if it does not, look in your spam folder.</p>' +
        row('<button type="button" class="btn" data-ed="close" data-autofocus>Done</button><button type="button" class="btn ghost" data-ed="email">Use another address</button>');
    } else if (ui.view === 'email-finish') {
      h = '<p class="eyebrow">Your account</p><h2 class="ed-h" id="ed-dlg-h">Which address was the link sent to?</h2>' +
        '<p>This browser did not ask for the sign-in link, so confirm the address it was sent to. Nobody else can finish a sign-in with your link that way.</p>' +
        '<label class="ed-lbl2" for="ed-email">Email address</label><input class="input" id="ed-email" type="email" maxlength="200" autocomplete="email" spellcheck="false" data-enter="email-finish" data-autofocus>' +
        row('<button type="button" class="btn" data-ed="email-finish">Sign in</button><button type="button" class="btn ghost" data-ed="close">Cancel</button>');
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
        '<p>This deletes ' + (n ? nm + ', with its land, cities and history,' : 'your nation') + ' every post you wrote on the region boards, and your account' + (w.kind === 'linked' ? ' (its links to your sign-ins; your Google or Discord account itself stays)' : '') + '. Other players will no longer see any of it.</p>' +
        '<p><b>It cannot be undone.</b> Copies in the game\'s backups are gone within 14 days.</p>' +
        (w.google ? '<p class="ed-fine">Google may ask you to confirm it is you first.</p>' : '') +
        row('<button type="button" class="btn danger" data-ed="delete-yes">Delete everything</button><button type="button" class="btn ghost" data-ed="back" data-autofocus>Keep my nation</button>');
    } else if (ui.view === 'signout') {
      var guestOut = w.kind === 'guest' && !!n, pendingCode = guestOut && pendingRecoveryCode();
      h = '<p class="eyebrow">' + (guestOut ? 'Guest Nation' : 'Your account') + '</p><h2 class="ed-h" id="ed-dlg-h">Sign out?</h2>' +
        (guestOut ? '<p>This ends the guest session on this browser. Your nation stays online. To sign back in, you will need your most recently saved recovery code.</p><p><b>Without an active Guest session or a working code, access cannot be recovered.</b> Save your code outside this browser before signing out.</p>' +
          (pendingCode ? row('<button type="button" class="btn ghost" data-ed="recovery-review">Save my recovery code first</button>') : '') +
          row('<button type="button" class="linkish" data-ed="recovery-regenerate">Regenerate recovery key</button>') +
          '<label class="ed-lbl2"><input type="checkbox" id="ed-guest-code-saved" data-autofocus> I have saved my recovery code.</label>' :
          '<p>' + (n ? nm + ' stays' : 'Your nation stays') + ' with your linked account. This browser starts again as a new guest, and you can sign back in at any time.</p>') +
        row('<button type="button" class="btn" data-ed="signout-yes"' + (guestOut ? ' disabled' : ' data-autofocus') + '>Sign out</button><button type="button" class="btn ghost" data-ed="' + (ui.direct ? 'close' : 'back') + '">Cancel</button>');
    } else {
      ui.view = 'main';
      if (w.kind === 'guest') {
        h = '<p class="eyebrow">' + (n ? 'Guest Nation' : 'Your account') + '</p><h2 class="ed-h" id="ed-dlg-h">' + (n ? 'Keep your nation on every device' : 'Sign in to your nation') + '</h2>' +
          (n ? '<p>' + nm + ' is a Guest Nation. Keep your recovery code safe, or link a sign-in account to become a Registered Nation. Registration unlocks community and political actions; Assembly participation also requires a nation at least 24 hours old.</p>'
             : '<p>If your nation is linked to Google, Discord or an email address, sign in with it to carry on here. New to Edictum? Found a nation on this page, and link a sign-in whenever you like.</p>') +
          row(linkingButtons(A.auth.currentUser)) +
          (n ? row('<button type="button" class="btn ghost" data-ed="recovery-regenerate">Regenerate recovery key</button><button type="button" class="btn ghost" data-ed="signout">Sign out</button>') + '<p class="ed-fine">A saved code cannot be displayed again. Regenerating replaces it and stops the previous key from working. After linking, use your linked sign-in to recover this nation.</p>' :
            row('<button type="button" class="btn ghost" data-ed="guest-session">Login with active guest session</button>') + row('<button type="button" class="linkish" data-ed="recover">Recover with a code</button>'));
      } else if (w.kind === 'linked') {
        h = '<p class="eyebrow">Registered Nation</p><h2 class="ed-h" id="ed-dlg-h">Your linked account</h2><p>' + (w.email ? 'You are signed in as <b>' + esc(w.email) + '</b>. ' : w.discord ? 'You are signed in with Discord as <b>' + esc(w.discord) + '</b>. ' : '') +
          (n ? nm + ' is kept with this account, so you can sign in on any device and carry on.' : 'Found a nation and it is kept with this account.') + '</p>' +
          '<p class="ed-fine">Sign in with: ' + esc(w.via.join(', ')) + '.</p>' +
          row(linkingButtons(A.auth.currentUser)) + row('<button type="button" class="btn ghost" data-ed="signout" data-autofocus>Sign out</button>');
      } else {
        h = '<p class="eyebrow">Your account</p><h2 class="ed-h" id="ed-dlg-h">Playing offline</h2><p>Sign-in is not available right now, so ' + (n ? nm + ' is' : 'your nation is') + ' saved in this browser only. Reload the page when you are back online, and it joins the region again.</p>';
      }
      if (w.uid && n) h += '<p class="ed-id">Player ID <code>' + esc(w.uid) + '</code></p>';
      if (w.uid && L.get('edictum.unsaved.' + w.uid)) h += '<div class="ed-sec"><p>Changes from a save conflict are kept on this device.</p>' + row('<button type="button" class="btn ghost" data-ed="unsaved">Download unsaved copy</button>') + '</div>';
      if (w.kind !== 'local' && n) h += '<div class="ed-sec">' + row('<button type="button" class="linkish ed-danger" data-ed="delete">Delete my nation and account</button>') + '</div>';
      if (GA.id) h += '<p class="ed-fine ed-stats-set">Visit statistics (Google Analytics): ' + (statsChoice() === 'y' ? 'allowed. <button type="button" class="linkish" data-ed="stats-n">Turn off</button>' : 'off. <button type="button" class="linkish" data-ed="stats-y">Allow</button>') + '</p>';
      h += '<p class="ed-fine ed-legal"><a href="/privacy" target="_blank" rel="noopener">Privacy</a> · <a href="/terms" target="_blank" rel="noopener">Terms</a></p>';
    }
    ui.inn.innerHTML = h;
    if (ui.busy) setBusy(ui.busy);
    focusFirst();
  }
  function act(a) {
    if (a === 'stats-y' || a === 'stats-n') { statsSet(a === 'stats-y' ? 'y' : 'n'); draw(); return; }
    if (a === 'recovery-regenerate') { if (who().kind !== 'guest' || !localNation() || ui.busy) return;ui.recoveryBack=ui.view;ui.view='regenerate';setMsg('');draw();return; }
    if (a === 'recovery-regenerate-cancel') { ui.view=ui.recoveryBack||'main';setMsg('');draw();return; }
    if (a === 'recovery-regenerate-yes') { regenerateRecovery();return; }
    if (a === 'recovery-review') { reviewRecoveryCode(); return; }
    if (a === 'recover') { ui.view = 'recover'; draw(); return; }
    if (a === 'recover-yes') { recoverNation(); return; }
    if (a === 'guest-session') { resumeGuest(); return; }
    if (a === 'recovery-saved') { var rotation=recoveryRotation(A.uid);if(rotation&&ui.recoveryCode!==rotation.code){setMsg('Finish regenerating and save your new recovery key first.',true);return;}clearRecovery(A.uid); recoveryChecked = A.uid; ui.view = 'main'; ui.dlg.close(); return; }
    if (a === 'recovery-copy' || a === 'recovery-download') {
      var code = pendingRecoveryCode(); if (!code) return;
      if (a === 'recovery-copy') { navigator.clipboard.writeText(code).then(function(){setMsg('Copied. Store it somewhere private.');},function(){setMsg('Select and copy the code above.',true);}); }
      else { var url = URL.createObjectURL(new Blob(['Edictum Guest Nation recovery code\n\n' + code + '\n\nKeep this private. A regenerated key replaces the previous key. A lost code cannot be retrieved; regenerate only from an active Guest session. Without an active session or a working code, access cannot be recovered.\n'],{type:'text/plain'}));
        var link=document.createElement('a');link.href=url;link.download='edictum-recovery-code.txt';link.click();setTimeout(function(){URL.revokeObjectURL(url);},1000); }
      return;
    }
    if (a === 'unsaved') {
      var u = A.auth && A.auth.currentUser, copy = u && L.get('edictum.unsaved.' + u.uid);
      if (copy) { var url = URL.createObjectURL(new Blob([copy], { type: 'application/json' })), link = document.createElement('a');
        link.href = url; link.download = 'edictum-unsaved.json'; link.click(); setTimeout(function () { URL.revokeObjectURL(url); }, 1000); }
      return;
    }
    if (a === 'close') { if (!ui.busy) ui.dlg.close(); return; }
    if (a === 'back') { ui.view = 'main'; setMsg(''); draw(); return; }
    if (a === 'google') { google(); return; }
    if (a === 'discord') { discord(); return; }
    if (a === 'email') { ui.emailMode = ''; ui.view = 'email'; setMsg(''); draw(); return; }
    if (a === 'email-send') { sendEmailLink(); return; }
    if (a === 'email-finish') { var typed = ui.dlg.querySelector('#ed-email'); finishEmailLink(ui.emailLink, typed ? typed.value.trim() : ''); return; }
    if (a === 'switch') { doSwitch(); return; }
    if (a === 'signout') { ui.view = 'signout'; setMsg(''); draw(); return; }
    if (a === 'signout-yes') { doSignOut(); return; }
    if (a === 'delete') { ui.view = 'delete'; setMsg(''); draw(); return; }
    if (a === 'delete-yes') { doDelete(); return; }
    if (a === 'report-yes') { sendReport(); return; }
    if (a === 'support-yes') { sendTicket(); return; }
  }

  var checkingRecovery = false, recoveryChecked = '', recoveryEpoch = 0;
  function newRecoveryCode() {
    var bytes=new Uint8Array(20);crypto.getRandomValues(bytes);
    return 'EDC-'+Array.from(bytes).map(function(v){return v.toString(16).padStart(2,'0');}).join('').toUpperCase().match(/.{1,8}/g).join('-');
  }
  function recoveryRotation(uid) {
    try { var value=JSON.parse(L.get('edictum.recovery.rotation.'+uid)||'null');return value&&/^EDC-(?:[A-F0-9]{8}-){4}[A-F0-9]{8}$/.test(value.code)&&Number.isSafeInteger(value.version)&&value.version>=0?value:null; }catch(e){return null;}
  }
  function pendingRecoveryCode() { return ui.recoveryCode||L.get('edictum.recovery.pending.'+A.uid)||''; }
  function clearRecovery(uid) { recoveryEpoch++;L.set('edictum.recovery.pending.'+uid,null);L.set('edictum.recovery.rotation.'+uid,null);if(uid===A.uid)ui.recoveryCode=''; }
  async function finishRecoveryRotation(uid, intent, epoch) {
    await call('accounts',{op:'regenerate',code:intent.code,version:intent.version});
    if(epoch!==recoveryEpoch||A.uid!==uid||linkedUser(A.auth.currentUser)||A.leaving)return false;
    ui.recoveryCode=intent.code;
    if(L.set('edictum.recovery.pending.'+uid,intent.code))L.set('edictum.recovery.rotation.'+uid,null);
    recoveryChecked=uid;return true;
  }
  async function regenerateRecovery() {
    if(ui.busy||who().kind!=='guest'||!localNation())return;
    var uid=A.uid,epoch=++recoveryEpoch,intent=recoveryRotation(uid);setBusy('Generating your new recovery key…');
    try {
      if(!intent){
        var status=await call('accounts',{op:'status'});
        if(status.kind!=='guest'||!status.hasNation)throw new Error('An active Guest Nation is required.');
        intent={code:newRecoveryCode(),version:status.recoveryVersion};
        if(!L.set('edictum.recovery.rotation.'+uid,JSON.stringify(intent)))throw new Error('Allow browser storage before generating a new recovery key.');
      }
      if(await finishRecoveryRotation(uid,intent,epoch)){setBusy('');open('recovery-code');setMsg('New key ready. Your previous key no longer works.');}
      else setBusy('');
    } catch(e) {
      var code=String(e.code||'').replace(/-/g,'_'),uncertain=!code||['unavailable','deadline_exceeded','internal','unknown'].includes(code);
      if(['recovery_changed','code_used','same_recovery','invalid_argument','already_registered','resource_exhausted'].includes(code)&&recoveryRotation(uid)?.code===intent?.code){L.set('edictum.recovery.rotation.'+uid,null);if(code==='recovery_changed'){L.set('edictum.recovery.pending.'+uid,null);ui.recoveryCode='';}}
      setBusy('');setMsg(uncertain&&recoveryRotation(uid)?'Your replacement is pending. Stay signed in and retry Regenerate recovery key to finish saving the new key.':e.message,true);
    }
  }
  async function recoveryCheck() {
    var u = A.auth && A.auth.currentUser;
    if (!u || !A.online || A.frozen || ui.busy || !localNation() || linkedUser(u) || checkingRecovery) return;
    var key = 'edictum.recovery.pending.' + u.uid, pending = L.get(key),intent=recoveryRotation(u.uid),epoch=recoveryEpoch;
    if (recoveryChecked === u.uid && !pending && !intent) return;
    checkingRecovery = true;
    try {
      if(intent){if(await finishRecoveryRotation(u.uid,intent,epoch))open('recovery-code');return;}
      var status = await call('accounts', { op: 'status' });
      if(epoch!==recoveryEpoch||A.uid!==u.uid||linkedUser(A.auth.currentUser)||A.leaving)return;
      if (!status.hasNation || status.kind !== 'guest') return;
      if (!status.recoveryIssued && !pending) {
        pending = newRecoveryCode();
        if (!L.set(key, pending)) return; // persist before issuance so an interrupted response can be retried
      }
      if (pending) {
        await call('accounts', { op: 'issue', code: pending });
        if (epoch===recoveryEpoch && A.uid === u.uid && L.get(key) === pending && !linkedUser(A.auth.currentUser) && !A.leaving && (!ui.dlg || !ui.dlg.open)) open('recovery-code');
      }
      recoveryChecked = u.uid;
    } catch(e) {
      if (epoch===recoveryEpoch&&e.code === 'already_issued'&&L.get(key)===pending) { L.set(key,null); recoveryChecked=u.uid; }
      if(epoch===recoveryEpoch&&intent&&e.code==='recovery_changed'&&recoveryRotation(u.uid)?.code===intent.code){L.set('edictum.recovery.rotation.'+u.uid,null);L.set(key,null);ui.recoveryCode='';recoveryChecked=u.uid;toast(e.message);}
      // An offline issuance retries after the next confirmed save, retaining the same pending code.
    } finally { checkingRecovery = false; }
  }
  async function resumeGuest() {
    setBusy('Looking for your guest session…');
    try {
      var status = await call('accounts', { op: 'status' });
      if (status.kind !== 'guest' || !status.hasNation) {
        setBusy(''); ui.view='recover';draw();setMsg('No active guest nation was found in this browser. Use your recovery code or linked sign-in.');return;
      }
      var snap = await getNation(A.uid);
      if (!snap.exists) throw new Error('No active guest nation was found.');
      leave({ nation: JSON.stringify(snap.data()), uid: A.uid });
    } catch(e) { setBusy('');setMsg(e.message,true); }
  }
  async function recoverNation() {
    if (localNation()) { setMsg('Open recovery from the sign-in screen on a browser without an active nation.',true);return; }
    var input = ui.dlg.querySelector('#ed-recovery-input');
    setBusy('Recovering your nation…');
    try {
      var result = await call('accounts',{op:'recover',code:input ? input.value : ''});
      A.leaving=true;A.frozen=true;
      var session=await A.auth.signInWithCustomToken(result.token);
      leave({nation:null,uid:session.user.uid},'Your guest nation has been recovered.');
    } catch(e) { A.leaving=false;A.frozen=false;setBusy('');setMsg(e.message,true); }
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
    var google = (u.providerData || []).some(function(p){return p.providerId === 'google.com';}), last = Date.parse((u.metadata && u.metadata.lastSignInTime) || '') || 0;
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
      var health = await within(A.fs.collection('saveHealth').where('uid', '==', u.uid).get(), 15000);
      for (var j = 0; j < qt.docs.length; j += 400) {
        var bt = A.fs.batch();
        qt.docs.slice(j, j + 400).forEach(function (d) { bt.delete(d.ref); });
        await bt.commit();
      }
      for (var k = 0; k < health.docs.length; k += 400) {
        var bh = A.fs.batch(); health.docs.slice(k, k + 400).forEach(function (d) { bh.delete(d.ref); }); await bh.commit();
      }
      var b = A.fs.batch();
      ['nations/', 'nationx/', 'summaries/', 'space/', 'limits/', 'rlimits/', 'slimits/', 'staff/'].forEach(function (c) { b.delete(A.fs.doc(c + u.uid)); });
      await within(b.commit(), 15000);
      /* the referee's record of the army (readiness, battles), which only it may clear */
      try { await call('referee', { op: 'forget' }); } catch (e) { /* it holds no more than that */ }
    } catch (e) {
      A.frozen = false; A.leaving = false; setBusy('');
      setMsg(String((e && e.code) || '').indexOf('auth/') === 0 ? authMessage(e) : 'Nothing was deleted: the game could not reach the database. Try again in a moment.', true);
      return;
    }
    /* the data is gone; now the account, with its links. The server ends it (a browser may only just after a
       sign-in); failing that the browser tries, and failing that the sign-in simply ends, and the empty
       account holds nothing of the game's */
    L.set(LS_SUP, null); L.set(LS_SUP_SEEN, null); L.set('edictum.unsaved.' + u.uid, null); L.set('edictum.emailLinked.' + u.uid, null); clearRecovery(u.uid);
    try { await call('accounts', { op: 'close' }); await A.auth.signOut(); }
    catch (e) { try { await u.delete(); } catch (e2) { try { await A.auth.signOut(); } catch (e3) {} } }
    leave({ nation: null, uid: '-' }, 'Your nation and account have been deleted. This browser starts again as a new guest.');
  }

  /* ───────── linking a sign-in: Google, Discord, an email link ───────── */
  function authMessage(e) {
    var c = String((e && e.code) || '');
    if (c === 'auth/popup-closed-by-user' || c === 'auth/cancelled-popup-request' || c === 'auth/user-cancelled') return 'Sign-in was cancelled.';
    if (c === 'auth/popup-blocked') return 'Your browser blocked the sign-in window. Allow pop-ups for this site and try again.';
    if (c === 'auth/unauthorized-domain' || c === 'auth/unauthorized-continue-uri') return 'Sign-in is not set up for this web address yet: the site owner needs to add it to the authorised domains in Firebase Authentication.';
    if (c === 'auth/operation-not-allowed') return 'This way of signing in is not switched on for this game yet.';
    if (c === 'auth/network-request-failed') return 'The sign-in could not reach the server. Check your connection and try again.';
    if (c === 'auth/web-storage-unsupported') return 'This browser blocks the storage that sign-in needs, as private windows often do.';
    if (c === 'auth/invalid-email' || c === 'auth/missing-email') return 'That email address does not look right.';
    if (c === 'auth/invalid-action-code' || c === 'auth/expired-action-code') return 'That sign-in link has expired or was already used. Ask for a new one.';
    if (c === 'auth/quota-exceeded' || c === 'auth/too-many-requests') return 'Too many sign-in emails just now. Try again in a while.';
    if (c === 'auth/user-disabled') return 'That account is disabled. Contact support.';
    return 'Sign-in did not work (' + (c || 'unknown error') + '). Try again in a moment.';
  }
  /* this account now has another sign-in (what: 'Google account', 'Discord account', 'email address') */
  function linkedNow(u, what, label) {
    clearRecovery(u.uid);
    setBusy('');
    var n = localNation();
    ui.view = 'main'; draw(); paint();
    try { window.dispatchEvent(new Event('edictum:linked')); } catch (e) {}
    setMsg(n ? 'Linked. “' + n.name + '” is now kept with your ' + what + (label ? ', ' + label : '') + '.' : 'Linked to your ' + what + '. The nation you found here will be kept with it.');
  }
  /* the sign-in is someone's other account: a guest may switch to it (asked first while it has a nation); a
     Registered Nation keeps its own. sw: {what, ready, signIn() → a UserCredential} */
  function otherAccount(sw) {
    setBusy('');
    if (linkedUser(A.auth.currentUser)) { setMsg('That ' + sw.what + ' belongs to another Edictum account. Sign out first to play that one.', true); return; }
    A.sw = sw;
    if (sw.ready && !localNation()) { doSwitch(); return; }
    ui.view = 'switch'; setMsg(''); draw();
  }

  function provider() { var p = new A.fb.auth.GoogleAuthProvider(); p.setCustomParameters({ prompt: 'select_account' }); return p; }
  function google() {
    var u = A.auth && A.auth.currentUser;
    if (!u || hasProvider(u, 'google.com')) return;
    setBusy('Waiting for Google…');
    u.linkWithPopup(provider()).then(function () {
      var g = (u.providerData || []).filter(function (p) { return p.providerId === 'google.com'; })[0];
      linkedNow(u, 'Google account', g && g.email);
    }, function (e) {
      if (e && e.code === 'auth/credential-already-in-use') {
        var cred = e.credential || null;
        otherAccount({ what: 'Google account', ready: !!cred, signIn: function () { return cred ? A.auth.signInWithCredential(cred) : A.auth.signInWithPopup(provider()); } });
        return;
      }
      setBusy('');
      setMsg(authMessage(e), true);
    });
  }

  /* Discord (functions/discord.js): the window opens on /discord at once (a window opened later would be
     blocked), goes on to Discord's consent page, and comes back to /discord, which leaves Discord's answer
     in localStorage for this page. The state ties that answer to this request. */
  function discordAnswer(pop, state) {
    return new Promise(function (res, rej) {
      var shut = 0, t = setInterval(function () {
        var a = parse(L.get(LS_DISCORD)), e;
        if (isObj(a) && a.state === state) {
          clearInterval(t); L.set(LS_DISCORD, null);
          if (a.code) { res(String(a.code)); return; }
          e = new Error(a.error || 'cancelled'); e.code = 'auth/popup-closed-by-user'; rej(e); return;
        }
        /* closed without an answer: give the answer a moment to land first */
        if (pop.closed && !shut) shut = Date.now();
        if (shut && Date.now() - shut > 1500) { clearInterval(t); e = new Error('closed'); e.code = 'auth/popup-closed-by-user'; rej(e); }
      }, 250);
    });
  }
  async function discord() {
    var u = A.auth && A.auth.currentUser;
    if (!u || discordOf(u) || ui.busy) return;
    var bytes = new Uint8Array(16), pop = null, r;
    crypto.getRandomValues(bytes);
    var state = Array.from(bytes).map(function (v) { return v.toString(16).padStart(2, '0'); }).join('');
    try { pop = window.open('/discord', 'edictum-discord', 'popup,width=520,height=780'); } catch (e) { pop = null; }
    if (!pop) { setMsg(authMessage({ code: 'auth/popup-blocked' }), true); return; }
    L.set(LS_DISCORD, null);
    setBusy('Waiting for Discord…');
    try {
      /* window.EDICTUM_DISCORD_EMU: the tests' stand-in Discord account, honoured by the emulators only */
      var start = await call('accounts', { op: 'discord', step: 'start', origin: location.origin, state: state, emu: window.EDICTUM_DISCORD_EMU || null });
      if (pop.closed) { var shut = new Error('closed'); shut.code = 'auth/popup-closed-by-user'; throw shut; }
      pop.location.href = start.url;
      var code = await discordAnswer(pop, state);
      setBusy('Linking your Discord account…');
      r = await call('accounts', { op: 'discord', step: 'link', origin: location.origin, code: code });
    } catch (e) {
      try { pop.close(); } catch (e2) {}
      setBusy('');
      setMsg(String((e && e.code) || '').indexOf('auth/') === 0 ? authMessage(e) : (e && e.message) || 'Discord sign-in did not work. Try again in a moment.', true);
      return;
    }
    if (r && r.taken) {
      otherAccount({ what: 'Discord account', ready: true, signIn: function () { return A.auth.signInWithCustomToken(r.token); } });
      return;
    }
    try { await u.getIdToken(true); await readClaims(u); } catch (e) { /* the claim arrives with the next token */ }
    linkedNow(u, 'Discord account', r && r.name);
  }

  /* An email link: Firebase emails a one-time link back to this page, and the account then has a 'password'
     provider without a password. LS_EMAIL remembers the address (Firebase asks for it again to finish), and
     the mode: 'switch' when the link is to sign in to that address's own account rather than link it here. */
  function sendLinkTo(email, mode) {
    setBusy('Sending the link…');
    return A.auth.sendSignInLinkToEmail(email, { url: location.origin + location.pathname, handleCodeInApp: true }).then(function () {
      L.set(LS_EMAIL, JSON.stringify({ email: email, mode: mode || '' }));
      ui.email = email; ui.emailMode = mode || ''; setBusy(''); ui.view = 'email-sent'; setMsg(''); draw();
    }, function (e) { setBusy(''); setMsg(authMessage(e), true); throw e; });
  }
  function sendEmailLink() {
    var input = ui.dlg.querySelector('#ed-email'), email = input ? input.value.trim() : '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) { setMsg(authMessage({ code: 'auth/invalid-email' }), true); if (input) input.focus(); return; }
    sendLinkTo(email, ui.emailMode).catch(function () {});
  }
  async function finishEmailLink(href, typed) {
    var pending = parse(L.get(LS_EMAIL)), email = typed || (isObj(pending) && typeof pending.email === 'string' ? pending.email : '');
    var u = A.auth.currentUser, mode = isObj(pending) && !typed ? pending.mode : '';
    ui.emailLink = href;
    if (!email) { open('email-finish'); return; }
    if (!href || !u || ui.busy) return;
    ui.email = email;
    if (!ui.dlg || !ui.dlg.open) open('main');
    var signIn = function () {
      return A.auth.signInWithEmailLink(email, href).then(function (res) { L.set(LS_EMAIL, null); if (res && res.user) L.set('edictum.emailLinked.' + res.user.uid, '1'); return res; });
    };
    var sw = { what: 'email address', ready: true, email: email, signIn: signIn };
    /* a link sent after the player agreed to switch; then a guest without a nation simply signs in: to the
       account kept with that address, or a new one */
    if (mode === 'switch' && !linkedUser(u)) { A.sw = sw; doSwitch(); return; }
    if (!linkedUser(u) && !localNation()) { otherAccount(sw); return; }
    setBusy('Linking your email address…');
    try {
      await u.linkWithCredential(A.fb.auth.EmailAuthProvider.credentialWithLink(email, href));
    } catch (e) {
      var c = e && e.code;
      if (c === 'auth/email-already-in-use' || c === 'auth/credential-already-in-use') { otherAccount(sw); return; }
      setBusy('');
      if (c === 'auth/invalid-action-code' || c === 'auth/expired-action-code' || c === 'auth/invalid-email') { ui.view = 'email'; draw(); }
      setMsg(c === 'auth/invalid-email' ? 'That link was sent to another address. Enter the address it was sent to, or ask for a new link.' : authMessage(e), true);
      return;
    }
    L.set(LS_EMAIL, null); L.set('edictum.emailLinked.' + u.uid, '1');
    linkedNow(u, 'email address', email);
  }

  async function doSwitch() {
    var guest = localNation(), anon = A.auth.currentUser, sw = A.sw || { what: 'Google account', signIn: function () { return A.auth.signInWithPopup(provider()); } };
    var res = null, cleared = false, via = sw.what.replace(/ account$| address$/, '');
    setBusy('Switching to your ' + sw.what + '…');
    A.frozen = true; A.leaving = true; /* the game's own saves wait from here: the page reloads */
    try {
      if (sw.ready && guest && anon && !linkedUser(anon)) {
        /* only this guest sign-in can remove the guest nation from the region, so do it now (with a pop-up
           still to open, that waits: the pop-up must open while the click counts) */
        await within(dropNation(anon.uid), 8000).then(function () { cleared = true; }, function () {});
      }
      res = await sw.signIn();
    } catch (e) {
      if (cleared && guest && anon) { try { guest._rev = 0; await within(saveNation(anon.uid, guest), 8000); } catch (e2) {} }
      A.frozen = false; A.leaving = false; A.sw = null; setBusy('');
      /* an email link used up (by the attempt to link it here, which Firebase counts as its one use) or
         expired: a fresh one, which goes straight to switching */
      if (sw.email && (e.code === 'auth/invalid-action-code' || e.code === 'auth/expired-action-code')) {
        sendLinkTo(sw.email, 'switch').then(function () { setMsg('That link could only be used once, so we sent a new one. Open it to switch.'); }, function () {});
        return;
      }
      setMsg(authMessage(e), true);
      return;
    }
    var nu = res && res.user, has = true, name = '';
    if (!nu) { leave({ nation: null, uid: '-' }); return; }
    try { var s = await within(A.fs.doc('nations/' + nu.uid).get(), 8000); has = s.exists; if (has) name = str((s.data() || {}).name, 80); } catch (e) { has = true; }
    if (has) {
      leave({ nation: null, uid: '-' }, name ? 'Signed in with ' + via + '. Welcome back to “' + name + '”.' : 'Signed in with ' + via + '.');
    } else {
      if (guest) { guest._rev = 0; L.set(LS_NATION, JSON.stringify(guest)); }
      leave({ uid: nu.uid }, guest ? 'Signed in with ' + via + '. “' + guest.name + '” now lives in your ' + sw.what + '.' : 'Signed in with ' + via + '. The nation you found here will be kept with your account.');
    }
  }
  function syncSignoutButton() {
    var check = ui.inn && ui.inn.querySelector('#ed-guest-code-saved'), button = ui.inn && ui.inn.querySelector('[data-ed="signout-yes"]');
    if (check && button) button.disabled = !!ui.busy || !check.checked;
  }
  async function reviewRecoveryCode() {
    var code = pendingRecoveryCode(); if (!code || ui.busy) return;
    if(recoveryRotation(A.uid)){ui.recoveryBack='signout';ui.view='regenerate';draw();return;}
    setBusy('Checking your recovery code…');
    try { await call('accounts', { op: 'issue', code: code }); setBusy(''); open('recovery-code'); }
    catch(e) { setBusy(''); setMsg(e.message, true); }
  }
  async function doSignOut() {
    var guest = who().kind === 'guest', n = localNation(), uid = A.uid, check = ui.inn && ui.inn.querySelector('#ed-guest-code-saved');
    if (guest && n && (!check || !check.checked)) return;
    setBusy('Saving before signing out…');
    try {
      if(guest&&recoveryRotation(uid))throw new Error('Finish regenerating and save your new recovery key before signing out.');
      if (n && typeof E.beforeSignOut === 'function') await within(E.beforeSignOut(), 25000);
      A.leaving = true; A.frozen = true;
      await A.auth.signOut();
      if (guest) clearRecovery(uid);
      leave({ nation: null, uid: '-' }, guest ? 'Signed out. Use your recovery code to sign back in to your Guest Nation.' : 'Signed out. Sign in with your linked account to continue your nation.');
    } catch(e) { A.leaving = false; A.frozen = false; setBusy(''); setMsg(e.message || 'Sign-out could not finish. Try again.', true); }
  }

  var started = new Promise(function (r) { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', r, { once: true }); else r(); });
  started.then(boot).catch(function (e) { goOffline('start-up failed', e); });
})();
