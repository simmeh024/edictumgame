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
     nationp/<uid>          {j:<JSON>, t, ts}: the own half (OWN_KEYS: the player's letters), which nobody else
                            reads; with the others when the player loads their own nation.
     letters/<by>~<to>~<t>  {by, to, x, t, ts, exp, k?, r?, a?, g?}: a letter from one player to another, which only
                            those two read; llimits/<uid> {l, d, n} paces and counts them, lpair/<by>~<to> {u} counts
                            those not yet answered, lblock/<b>~<x> refuses them and lseen/<r>~<w> {t} is a read
                            receipt. The writer keeps their own copy in nationp.
     summaries/<uid>        {reg, name, pop, t, e?, f?}: the headline for the World page and region counts (f, the
                            founding time, for the admin portal's Live feed); e, with
                            a holiday after the save, is the time the nation counts as active until.
     space/<uid>            {reg, name, t, j:<JSON of sp, belt, mapc, flag, pretitle>}, only for nations
                            with Moon, Mars or belt data. Every player listens to all of these, so it is
                            rewritten only when what other regions read from it changes (spaceLayout: not the
                            running figures re-stamped at every save), or every SPACE_BEAT while playing.
     boards/<reg>/posts/<id> {a:<author uid>, t:<server time>, x:<text>}, with limits/<uid> {p} pacing posts; one an
                            admin signed as the Edictum team adds {of: true, nm, rl?, st: 'admin'}; a reply adds
                            re:<the id of the message it answers>, and reactions are rv {<uid>: kind} (civic only).
     devnews/<id>           a development news post (admins write it in the portal), devnews/<id>/posts/<id>
                            its comments (through civic()), devnews/<id>/rd/<uid> its readers (newsRead, with
                            the count in devnewsStat/<id>.n), devnewsImg/<id> its images, and devnewsMeta/latest
                            the latest published posts, which the game's unread count listens to.
     support/<id>           a player's support ticket: the conversation with the team (functions/support.js), and
                            once closed, when and by whom; slimits/<uid> {s}
                            paces them.
     bugs/<id>              a player's bug report and the team's verdict, bugImg/<id> its screenshot;
                            blimits/<uid> {b} paces them.
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
  var LS_PARK = 'edictum.parked';        // {uid, at, nation}: the copy of an account this browser was signed out of
  var LS_OUT = 'edictum.signedOut';      // the account this browser last signed out of, until the next sign-in here
  var LS_CARRY = 'edictum.carry';        // {from, to, at, k}: a guest's nation carried into account `to` on signing in, until its first save there
  var LS_CK = 'edictum.ck';              // {u, k}: this browser's guest's carry key (carryKey)
  var SS_FLASH = 'edictum.flash';        // a message to show after a reload
  var MAX_JSON = 700000;                 // well under Firestore's 1 MiB document limit
  var SPACE_BEAT = 12 * 3600000;         // rewrite an unchanged space document this often while playing
  var SPACE_MIN = 12000;                 // and a changed one at most this often (the rules allow one per 10 s)
  var RETRY_MS = 1500;                   // wait before trying a refused nation write once more
  var BOOT_AT = Date.now();
  var SIGN_IN_HOSTS = ['edictumgame.com']; // domains whose own address handles Google sign-in
  var SUPPORT_KEEP = 90 * 86400000;      // a closed support ticket is deleted this long after (Firestore TTL)
  var FN_REGION = 'europe-west1';        // where the referee runs (functions/index.js)
  var LS_SUP = 'edictum.support';        // set while this browser has a ticket that may get an answer
  var LS_SUP_SEEN = 'edictum.support.seen'; // the time of the team's latest word the player has read on the Help page
  var LS_SUP_TOLD = 'edictum.support.told'; // the time of the team's latest word a toast has told them about
  var LS_SUP_NEW = 'edictum.support.new';   // how many tickets have a word from the team not yet read (the Help badge)
  var SUP_REOPEN = 14 * 86400000;           // a ticket closed this recently opens again when the player writes in it
  var LS_BUG = 'edictum.bugs';           // set while this browser has sent a bug report the team may still look at
  var LS_BUG_SEEN = 'edictum.bugs.seen'; // the time of the last change to them the player was told about
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
  /* An admin observing another region (game/edictum.html, OBS) sees it read-only. While this tab's key is set, the
     adapter refuses what would act for the player there or touch their nation: saving or deleting any document but
     the admin's own staff mark and development news, a board post, the referee, the Assembly and the shop. The game
     sends none of these while observing; this holds should a page path be missed. Two exceptions act as the admin,
     not the player: a message on the region's board signed by the Edictum team (post, as: 'team'), and removing a
     board message (boards/, which the rules let only its author or an admin delete, and nobody create), and sending a
     newspaper edition back to be filed again from the records (papers/, which only an admin may delete; the game files
     none while observing, and the rules want a nation of that region). */
  var SS_OBSERVE = 'edictum.observe', OBS_WRITE = ['staff', 'devnews', 'devnewsImg', 'devnewsMeta', 'boards', 'papers'];
  /* An admin viewing the game as a player (game/edictum.html, PV: sessionStorage edictum.pview = "<uid>|<region>") sees
     that player's nation, pages and settings and may do nothing at all: every write, board post, callable and letter is
     refused, the admin's own team posts included; only the Assembly's read-only state (civic state with obs) is asked. */
  var SS_PVIEW = 'edictum.pview';
  function pviewing() { return !!SS.get(SS_PVIEW); }
  function observing() { return !!SS.get(SS_OBSERVE) || pviewing(); }
  function readOnly() { return mapError({ code: 'read_only', message: 'Nothing is saved while observing a region.' }); }
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
    /* what the server added to a refusal (functions: HttpsError details), such as how long to wait */
    if (e && e.details && typeof e.details === 'object' && !Array.isArray(e.details)) out.details = e.details;
    return out;
  }
  function num(v) { return typeof v === 'number' && isFinite(v) ? v : 0; }
  function serverTime() { return A.fb.firestore.FieldValue.serverTimestamp(); }
  function millis(t) { return t && typeof t.toMillis === 'function' ? t.toMillis() : num(t); }
  function encode(col, data) {
    /* presence/<uid> {t}: always the server's time (the rules insist), whatever the game passes */
    if (col === 'presence') return { t: serverTime() };
    /* papers/<region>_<edition>: filed at the server's time (the rules insist) */
    if (col === 'papers') return Object.assign(JSON.parse(JSON.stringify(data == null ? {} : data)), { t: serverTime() });
    if (col !== 'nations') return JSON.parse(JSON.stringify(data == null ? {} : data));
    var j = JSON.stringify(data == null ? {} : data);
    if (j.length > MAX_JSON) throw mapError({ code: 'too_large', message: 'This nation is too large to save (' + j.length + ' characters).' });
    var d = isObj(data) ? data : {};
    /* headline numbers beside the record, which the rules bound (growth since the last save, army and land for
       the population) and every player's game holds the record to: population, army strength, land claimed */
    var out = { v: 1, j: j, reg: str(d.reg, 40) || 'meridian', name: str(d.name, 80), updatedAt: num(d.updatedAt), ts: serverTime(),
      pop: Math.round(Math.min(1e7, Math.max(0, num(d.pop))) * 1e4) / 1e4, army: Math.round(Math.max(0, num(d.apw)) * 1e3) / 1e3,
      cl: Array.isArray(d.claims) ? d.claims.length : 0 };
    // Once expanded storage is used, older clients must not save their 400-unit interpretation over it.
    if (d.whv === 1) out.storageV = 1;
    // Once the desk has held more than five edicts (the Chancery Club's ten), no build that cuts it back may save.
    if (d.iqv === 1) out.iq = 1;
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
    'mvCap', 'discArc', 'wck', 'drAt', 'alNpc', 'spy', 'intel', 'cvIn', 'cvEx', 'cvJ', 'mh', 'ifl', 'cuJournal', 'exp', 'exp2', 'mgc', 'mgAt', 'cabSeq', 'cabAt',
    'la', 'lt', 'peak', 'tly', 'tlf', 'tlx', 'colPin', 'colNm', 'lore', 'geo', 'flS', 'ppx', 'nws', 'cuS', 'ws', 'svc', 'atl',
    'mdt', 'pso', 'rpl', 'brf', 'aph', 'ldr', 'crt', 'crz', 'crl', 'crd', 'gmb', 'gwl', 'mc'].forEach(function (k) { NX_KEYS[k] = 1; });
  /* The own half: what nobody but the player may read, not even on opening the nation's pages: the letters (dm),
     which reach the nations they are written to as letters/ documents (lettersApi) */
  /* … and what only the player needs to know about them: which conversations they have read (seenDm) and their
     letter settings (dmx: blocks, mutes, pins, archives, offices, read receipts) */
  var OWN_KEYS = { dm: 1, seenDm: 1, dmx: 1 };
  /* the menu as its player arranged it (Settings › Navigation, n.nav) is for the private half too */
  NX_KEYS.nav = 1;
  /* the portraits' pieces earned in play (ptu) and the current leader's term (ptz, for the nicknames): the looks
     themselves (rpt, cpt, cdc) stay shared, since visitors see the cabinet */
  NX_KEYS.ptu = NX_KEYS.ptz = 1;
  /* development news read and polls voted in, for the achievements (nwr, nwvn, nwd), and the polls whose results
     the bell tells of when they close (nwp) */
  NX_KEYS.nwr = NX_KEYS.nwvn = NX_KEYS.nwd = NX_KEYS.nwp = 1;
  /* the Supply Caches the nation opened and was paid for (sco: game/edictum.html, the section "Supply Caches") */
  NX_KEYS.sco = 1;
  /* fields this build's game kept without knowing them (a newer build's: game/edictum.html, normalize, d._fk) go to the
     private half, so a newer build's private field never turns public by way of an older tab; _fk itself is not saved */
  function splitNation(d) {
    var pub = {}, ext = {}, own = {}, fwd = {};
    if (Array.isArray(d._fk)) d._fk.forEach(function (k) { if (typeof k === 'string') fwd[k] = 1; });
    Object.keys(d).forEach(function (k) { if (k !== '_rev' && k !== '_dirty' && k !== '_fk') (OWN_KEYS[k] ? own : NX_KEYS[k] || fwd[k] ? ext : pub)[k] = d[k]; });
    if (isObj(d.asm)) {
      ext.asmLocal = {};
      /* the record's own part of the Assembly: past resolutions, terms, the lock, the resolutions it follows (f, fv)
         and its attendance (vs); the rest is the server's (functions/civic.js) */
      ['h','d','st','cur','f','fv','vs'].forEach(function(k) { if (k in d.asm) ext.asmLocal[k] = d.asm[k]; });
      delete pub.asm;
    }
    if (isObj(d.pp)) {
      var pp = {}, xp = {};
      Object.keys(d.pp).forEach(function (k) { (NX_PP[k] ? xp : pp)[k] = d.pp[k]; });
      pub.pp = pp; ext.pp = xp;
    }
    return [pub, ext, own];
  }
  /* the halves joined; the shared half wins, so a record last saved whole (before the split) reads as it was */
  function joinNation(pub, ext, own) {
    if (!isObj(pub) || (!isObj(ext) && !isObj(own))) return pub;
    if (!isObj(ext)) ext = {};
    var out = Object.assign({}, ext, isObj(own) ? own : {}, pub);
    if (isObj(ext.asmLocal)) out.asm = Object.assign({}, ext.asmLocal, pub.asm || {});
    if (isObj(ext.pp) && isObj(pub.pp)) out.pp = Object.assign({}, ext.pp, pub.pp);
    return out;
  }
  /* a nations/ document's JSON text: v 1 in j, v 2 deflated in z (bytes; functions/nationtext.js). The region's
     listener hands over every nation at every change, so each one's text is kept until its next save. */
  function nationText(path, d) {
    if (typeof d.j === 'string') return d.j;
    var z = d.z, inflate = typeof self !== 'undefined' && self.edictumInflate;
    if (!z || typeof inflate !== 'function' || typeof TextDecoder !== 'function') return null;
    var cache = nationText.cache || (nationText.cache = new Map());
    var key = num(d.rev) + ':' + num(d.updatedAt) + ':' + millis(d.ts), hit = cache.get(path);
    if (hit && hit.key === key) return hit.txt;
    try {
      var txt = new TextDecoder().decode(inflate(typeof z.toUint8Array === 'function' ? z.toUint8Array() : new Uint8Array(z)));
      if (cache.size > 2000) cache.clear();
      cache.set(path, { key: key, txt: txt });
      return txt;
    } catch (e) { return null; }
  }
  function decode(path, d) {
    if (!d) return d;
    var p = String(path).split('/'), col = p[0];
    if (col === 'nations') {
      /* the record, with what the rules checked beside it: the server's time of the save and the headline
         numbers (set after parsing, so the record cannot claim its own) */
      var txt = nationText(path, d), nd = txt != null ? parse(txt) : d;
      if (isObj(nd) && txt != null) Object.assign(nd, { _ts: millis(d.ts), _pop: typeof d.pop === 'number' ? d.pop : undefined,
        _army: typeof d.army === 'number' ? d.army : undefined, _cl: typeof d.cl === 'number' ? d.cl : undefined,
        _rev: Number.isSafeInteger(d.rev) && d.rev >= 0 ? d.rev : 0, _dirty: false });
      if (isObj(nd) && d.storageV === 1) nd.whv = 1;
      return nd;
    }
    if (col === 'nationx' || col === 'nationp') { var x = typeof d.j === 'string' ? parse(d.j) : null; return isObj(x) ? x : null; }
    if (col === 'space') { var s = typeof d.j === 'string' ? parse(d.j) : null; return isObj(s) ? Object.assign(s, { reg: d.reg, name: d.name, updatedAt: num(d.t) }) : null; }
    if (col === 'presence') return { t: millis(d.t) || 0 };
    if (col === 'boards') {
      var post = { id: p[3], a: str(d.a, 128), t: millis(d.t) || Date.now(), x: str(d.x, 500), r: p[1] };
      if (typeof d.re === 'string' && /^[A-Za-z0-9]{20}$/.test(d.re)) post.re = d.re;
      // the reactions: {uid: kind}, at most RMB_RV_MAX (functions/board.js) of the known kinds
      if (isObj(d.rv)) { var rv = {}, k = 0; for (var u in d.rv) { if (k >= 500) break; if (Object.prototype.hasOwnProperty.call(d.rv, u) && /^[\w-]{1,128}$/.test(u) && RMB_RX.indexOf(d.rv[u]) >= 0) { rv[u] = d.rv[u]; k++; } } if (k) post.rv = rv; }
      // a message an admin signed as the Edictum team: the name and role they chose
      return d.of === true ? Object.assign(post, { of: true, nm: str(d.nm, 80), rl: str(d.rl, 60) }) : post;
    }
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
  /* A guest's carry key: a secret only this browser holds. The guest's saves send it, and the server notes its hash
     beside the account's last save (functions/civic.js, carryHash); the first save after switching to another account
     (doSwitch, LS_CARRY.k) sends it back, so only the browser that played the guest can carry its nation over. */
  function carryKey(uid) {
    var c = isObj(A.ck) && A.ck.u === uid ? A.ck : parse(L.get(LS_CK));
    if (!(isObj(c) && c.u === uid && /^[0-9a-f]{64}$/.test(c.k))) {
      var b = new Uint8Array(32); crypto.getRandomValues(b);
      c = { u: uid, k: Array.from(b).map(function (v) { return v.toString(16).padStart(2, '0'); }).join('') };
      L.set(LS_CK, JSON.stringify(c));
    }
    A.ck = c;
    return c.k;
  }
  /* the carry key this browser holds for guest uid, if any (none is made here: the server would not know it) */
  function heldCarryKey(uid) {
    var c = isObj(A.ck) && A.ck.u === uid ? A.ck : parse(L.get(LS_CK));
    return isObj(c) && c.u === uid && /^[0-9a-f]{64}$/.test(c.k) ? c.k : '';
  }
  function isGuest(uid) { var u = A.auth && A.auth.currentUser; return !!(u && u.uid === uid && !linkedUser(u)); }
  /* a nation save: the shared half, its summary and, when they changed, the private half and the space document */
  async function saveNation(uid, data, noSpace) {
    /* Space pacing and private-half changes are checked against the server, including saves made by
       another device; a per-page cache cannot safely decide whether a write can be skipped. */
    var enc = encode('nations', data), now = Date.now();
    var sj = spaceText(data), halves = splitNation(isObj(data) ? data : {}), xj = JSON.stringify(halves[1]), oj = JSON.stringify(halves[2]);
    var ref = A.fs.doc('nations/' + uid), expected = revision(data);
    enc.j = JSON.stringify(halves[0]);
    /* a guest's nation carried into this account (doSwitch): its first save here names the guest account, whose last
       save the server lets a new record start from (functions/civic.js, createCap) */
    var carry = expected === 0 ? parse(L.get(LS_CARRY)) : null, from = isObj(carry) && carry.to === uid && Date.now() - num(carry.at) < 7 * 864e5 ? str(carry.from, 128) : '';
    var zip = typeof self !== 'undefined' && typeof self.edictumInflate === 'function' && A.fb && A.fb.firestore && A.fb.firestore.Blob;
    var approved = await call('civic', Object.assign({ op: 'authorizeSave', record: { j: enc.j, reg: enc.reg, name: enc.name, pop: enc.pop, army: enc.army, cl: enc.cl, updatedAt: enc.updatedAt }, rev: expected },
      from ? { from: from, fk: str(carry.k, 64) } : {}, isGuest(uid) ? { ck: carryKey(uid) } : {}, zip ? { zip: 1 } : {}, { cap: 1 }));
    /* The rules (grows) let the headline population rise only as fast as the game can since the last save, by the
       server's clock, while the game counts growth by this device's clock: a clock running ahead, or another device's,
       sends a population "from the future", refused (permission-denied) at every save once saves are seconds apart.
       The server holds the headline within what the rules allow by its own clock (cap; functions/civic.js, permit),
       and the permit names that number: it is the one saved. The record itself (j) keeps the game's number. (This page
       once held it by performance.now() since its last save, which stops while a phone sleeps and starts again at
       each acknowledgement: honest saves were held below their records, and listed as suspicious.) */
    if (typeof approved.pop === 'number' && approved.pop >= 0 && approved.pop <= enc.pop) enc.pop = approved.pop;
    /* saved deflated (v 2, z) when the server sent it so: every player in the region downloads a fifth as much */
    if (typeof approved.z === 'string') { delete enc.j; enc.v = 2; enc.z = A.fb.firestore.Blob.fromBase64String(approved.z); }
    else enc.j = approved.j;
    enc.permit = approved.permit;
    var stampable = Array.isArray(approved.sk) ? approved.sk : null;
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
      if (saved && saved.iq === 1) enc.iq = 1;
      var privateRef = A.fs.doc('nationx/' + uid), privateSnap = await b.get(privateRef);
      var ownRef = A.fs.doc('nationp/' + uid), ownSnap = await b.get(ownRef);
      var spaceRef = A.fs.doc('space/' + uid), spaceSnap = await b.get(spaceRef), space = spaceSnap.exists ? spaceSnap.data() : null;
      b.set(A.fs.doc('nations/' + uid), enc);
      if (!privateSnap.exists || privateSnap.data().j !== xj) b.set(privateRef, { j: xj, t: enc.updatedAt, ts: serverTime() });
      if (ownSnap.exists ? ownSnap.data().j !== oj : oj !== '{}') b.set(ownRef, { j: oj, t: enc.updatedAt, ts: serverTime() });
      var sum = { reg: enc.reg, name: enc.name, pop: enc.pop, t: enc.updatedAt }, e = activeUntil(data, enc.updatedAt);
      if (e > sum.t) sum.e = e;
      /* when the nation was founded, for the admin portal's Live feed and founding alerts (functions/feed.js) */
      if (isObj(data) && typeof data.founded === 'number' && data.founded > 0 && data.founded <= sum.t + 60000) sum.f = Math.floor(data.founded);
      b.set(A.fs.doc('summaries/' + uid), sum);
      var raceFrom = A.raceAt[uid] != null ? A.raceAt[uid] : BOOT_AT;
      /* only the entries the permit lists as new (sk): the rules take no other stamp */
      raceKeys(data, raceFrom).filter(function (k) { return !stampable || stampable.indexOf(k) >= 0; }).forEach(function (k) { b.set(A.fs.doc('stamps/' + enc.reg + '/' + k + '/' + uid), { t: serverTime() }); });
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
    }).then(function () { if (from) L.set(LS_CARRY, null); A.raceAt[uid] = enc.updatedAt; setTimeout(recoveryCheck, 0); window.dispatchEvent(new Event('edictum:saved')); return { rev: enc.rev }; });
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
  /* how: 'dissolve', 'restart' (Start over) or 'switch' (doSwitch). The player's own nation is first filed with the
     server, which keeps a copy of its last save for the admins' Recently dissolved (functions/gone.js), so a mistaken
     dissolve can be put back; that never holds the deletion up for long, nor stops it when it fails. */
  function dropNation(uid, how) {
    var u = A.auth && A.auth.currentUser;
    var filed = u && u.uid === uid ? within(call('accounts', { op: 'gone', how: how || 'dissolve' }), 6000).catch(function () {}) : Promise.resolve();
    return filed.then(function () {
      var b = A.fs.batch();
      ['nations/', 'nationx/', 'nationp/', 'summaries/', 'space/'].forEach(function (c) { b.delete(A.fs.doc(c + uid)); });
      return b.commit();
    }).then(function () { delete A.raceAt[uid]; });
  }
  /* a nation with its private half joined in */
  function getNation(uid) {
    var t0 = performance.now(), first = uid === A.uid && !PF.read; /* the first read of one's own nation: speed statistics */
    if (first) PF.read = true;
    /* Own saves must use a coherent, server-confirmed pair. Separate gets can combine the shared half
       before another device's save with its private half afterwards (and cached reads can be stale). */
    var read = uid === A.uid ? A.fs.runTransaction(async function (tx) {
      return [await tx.get(A.fs.doc('nations/' + uid)), await tx.get(A.fs.doc('nationx/' + uid)), await tx.get(A.fs.doc('nationp/' + uid))];
    }) : Promise.all([A.fs.doc('nations/' + uid).get(), A.fs.doc('nationx/' + uid).get().catch(function () { return null; }),
      /* viewing as this player, the admin also reads their private half (the rules let an admin) */
      pviewing() && SS.get(SS_PVIEW).split('|')[0] === uid ? A.fs.doc('nationp/' + uid).get().catch(function () { return null; }) : null]);
    return read.then(function (r) {
      var s = snapOf(r[0]), x = r[1] && r[1].exists ? r[1].data() : null, o = r[2] && r[2].exists ? r[2].data() : null;
      if (first) perfTrace('nation_load', t0, performance.now() - t0, {}, { found: s.exists ? 'yes' : 'no' });
      /* the player's own record, as saved: its claims and finds were stamped with that save */
      if (uid === A.uid && s.exists) { var own = s.data(); A.raceAt[uid] = isObj(own) ? num(own.updatedAt) : 0; }
      if (!s.exists || (!x && !o)) return s;
      return { id: s.id, exists: true, data: function () { return joinNation(s.data(), x ? decode('nationx', x) : null, o ? decode('nationp', o) : null); } };
    });
  }
  function docApi(path) {
    var p = String(path).split('/').filter(Boolean), col = p[0], ref = A.fs.doc(p.join('/')), nation = col === 'nations' && p.length === 2;
    var shut = function () { return pviewing() || observing() && OBS_WRITE.indexOf(col) < 0; };
    return Object.freeze({
      id: ref.id,
      path: ref.path,
      get: function () { return (nation ? getNation(p[1]) : ref.get().then(snapOf)).then(null, function (e) { throw mapError(e); }); },
      set: function (data) {
        if (A.frozen) return hang();
        if (shut()) return Promise.reject(readOnly());
        if (nation) {
          if (!A.auth.currentUser || A.auth.currentUser.uid !== p[1]) return Promise.reject(mapError({ code: 'permission-denied' }));
          try { encode(col, data); } catch (e) { return Promise.reject(e && e.firebaseCode ? e : mapError(e)); }
          var t0 = performance.now(), took = function (how) { perfTrace('nation_save', t0, performance.now() - t0, {}, { result: how }); };
          return retried(function (noSpace) { return saveNation(p[1], data, noSpace); }).then(function (r) { took('saved'); return r; }, function (e) { took(e && e.code === 'save_conflict' ? 'conflict' : 'failed'); throw mapError(e); });
        }
        return ref.set(encode(col, data)).then(function () {}, function (e) { throw mapError(e); });
      },
      /* fields merged into what is there, maps and all (the shop's National Chronicle adds entries this way) */
      merge: function (data) {
        if (A.frozen) return hang();
        if (shut()) return Promise.reject(readOnly());
        if (nation) return Promise.reject(mapError({ code: 'invalid-argument' }));
        return ref.set(encode(col, data), { merge: true }).then(function () {}, function (e) { throw mapError(e); });
      },
      /* opts.how, for a nation: why it goes (dropNation) */
      delete: function (opts) {
        if (A.frozen) return hang();
        if (shut()) return Promise.reject(readOnly());
        if (A.admin && col === 'boards' && p.length === 4) return adminApi.request({ op: 'moderate', action: 'delete_post', target: p[3], reg: p[1], reason: 'Removed from the region board' });
        return (nation ? dropNation(p[1], opts && opts.how) : ref.delete()).then(function () {}, function (e) { throw mapError(e); });
      },
      onSnapshot: function (next, error) {
        return ref.onSnapshot(function (s) { next(snapOf(s)); }, function (e) { if (typeof error === 'function') error(mapError(e)); });
      },
      /* a nation's revision and save time alone, {rev, updatedAt} or null (see revisionOf) */
      revision: function () { return nation ? revisionOf(p[1]) : Promise.reject(mapError({ code: 'invalid-argument' })); }
    });
  }
  /* Straight from the server over REST, past the SDK: its reads share the listeners' connection, which on a phone
     can go quiet without an error after sleep, and this is how the game checks it has not missed a save from
     another device meanwhile. A field mask keeps it to a few bytes; it costs one read. */
  async function revisionOf(uid) {
    var headers = {}, u = A.auth.currentUser;
    if (u) headers.authorization = 'Bearer ' + await u.getIdToken();
    var url = A.rest + '/projects/' + A.projectId + '/databases/(default)/documents/nations/' + encodeURIComponent(uid) + '?mask.fieldPaths=rev&mask.fieldPaths=updatedAt';
    var r = await within(fetch(url, { headers: headers, cache: 'no-store' }), 10000);
    if (r.status === 404) return null;
    if (!r.ok) throw mapError({ code: r.status === 403 ? 'permission-denied' : r.status === 429 ? 'resource-exhausted' : 'unavailable', message: 'revision: HTTP ' + r.status });
    var f = ((await r.json()) || {}).fields || {}, val = function (x) { return x ? Number(x.integerValue != null ? x.integerValue : x.doubleValue) || 0 : 0; };
    return { rev: val(f.rev), updatedAt: val(f.updatedAt) };
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
  /* a post on a region's board, paced by limits/<uid> (see firestore.rules); an admin's signed by the Edictum team
     (o: {as: 'team', nm, rl}) may go to any region, observed or not, and the server checks they are an admin */
  var RMB_RX = ['up', 'heart', 'party', 'think'];
  function post(reg, text, o) {
    if (A.frozen) return hang();
    var team = isObj(o) && o.as === 'team', re = isObj(o) && typeof o.re === 'string' && /^[A-Za-z0-9]{20}$/.test(o.re) ? o.re : '';
    if (pviewing() || observing() && !team) return Promise.reject(readOnly());
    var u = A.auth.currentUser;
    if (!u) return Promise.reject(mapError({ code: 'unauthenticated' }));
    return call('civic', Object.assign({ op: 'topic', reg: str(reg,40), text: String(text || '') }, team ? { as: 'team', nm: str(o.nm, 80), rl: str(o.rl, 60) } : {}, re ? { re: re } : {})).then(function(r) { return r.id; });
  }
  function collectionGroupApi(name) { return Object.freeze(queryApi(A.fs.collectionGroup(String(name)))); }
  /* ───────── support tickets ─────────
     A ticket is a conversation (functions/support.js): the player's first message, then m, the replies of both
     sides. The game gets msgs, all of them oldest first; w, whose turn it is while it is open ('p' the player,
     's' the team); news, the time of the team's latest word (a reply, or closing it); and closedBy. */
  function ticketOf(s) {
    var d = s.data({ serverTimestamps: 'estimate' }) || {}, by = str(d.by, 128), t = millis(d.t), ct = millis(d.ct), rby = str(d.rby, 128);
    var st = d.st === 'closed' ? 'closed' : 'open', first = str(d.x, 2000);
    var m = (Array.isArray(d.m) ? d.m : []).slice(0, 60).map(function (x) {
      return isObj(x) && typeof x.x === 'string' && x.x ? { a: x.a === 's' ? 's' : 'p', x: str(x.x, 2000), t: num(x.t) } : null;
    }).filter(Boolean);
    /* a ticket answered before replies existed keeps the team's answer in reply */
    if (typeof d.reply === 'string' && d.reply && !m.some(function (x) { return x.a === 's'; })) m.push({ a: 's', x: str(d.reply, 2000), t: ct || t });
    var closedBy = st === 'closed' ? (rby && rby === by ? 'player' : 'team') : '', news = 0;
    m.forEach(function (x) { if (x.a === 's') news = Math.max(news, x.t); });
    if (closedBy === 'team') news = Math.max(news, ct);
    return { id: s.id, by: by, topic: str(d.topic, 20), x: first, t: t, st: st, name: str(d.name, 160), reg: str(d.reg, 40), email: str(d.email, 200),
      ct: ct, closedBy: closedBy, msgs: [{ a: 'p', x: first, t: t }].concat(m), replies: m.length, w: st === 'open' ? (d.w === 'p' ? 'p' : 's') : '',
      pc: num(d.pc), lt: millis(d.lt) || (m.length ? m[m.length - 1].t : t), news: news, reopen: st === 'closed' && ct > 0 && Date.now() - ct < SUP_REOPEN };
  }
  /* keep looking for the team's words while a ticket is open, or closed recently enough to open again */
  function supportWatch(list) {
    L.set(LS_SUP, list.some(function (t) { return t.st === 'open' || t.reopen; }) ? '1' : null);
  }
  function supportNew(list, since) { return list.filter(function (t) { return t.news > since; }); }
  /* a while after the page loads, tell a player whose ticket the team has replied to or closed; the Help menu item
     shows how many until they read them there (unread(); the game's menu looks at it every second) */
  function supportCheck() {
    var u = A.auth && A.auth.currentUser;
    if (!L.get(LS_SUP) || !u || A.leaving) return;
    A.fs.collection('support').where('by', '==', u.uid).limit(50).get().then(function (qs) {
      var list = qs.docs.map(ticketOf), seen = num(Number(L.get(LS_SUP_SEEN))), told = Math.max(seen, num(Number(L.get(LS_SUP_TOLD))));
      var unread = supportNew(list, seen), fresh = supportNew(list, told);
      var said = fresh.filter(function (t) { return t.msgs.some(function (x) { return x.a === 's' && x.t > told; }); });
      if (said.length) toast(said.length > 1 ? 'The Edictum team has replied to ' + said.length + ' of your support tickets. The replies are on the Help page.'
        : 'The Edictum team has replied to your support ticket. The reply is on the Help page.');
      else if (fresh.length) toast(fresh.length > 1 ? 'The Edictum team has closed ' + fresh.length + ' of your support tickets. They are on the Help page.' : 'The Edictum team has closed your support ticket. It is on the Help page.');
      if (fresh.length) L.set(LS_SUP_TOLD, Math.max.apply(null, fresh.map(function (t) { return t.news; })));
      L.set(LS_SUP_NEW, unread.length || null);
      supportWatch(list);
    }, function () {});
  }
  /* ───────── bug reports ───────── */
  var BUG_ST = { seen: 'Confirmed', fixed: 'Fixed', closed: 'Closed', 'new': 'New' };
  function bugOf(s) {
    var d = s.data({ serverTimestamps: 'estimate' }) || {};
    return { id: s.id, by: str(d.by, 128), ti: str(d.ti, 120), x: str(d.x, 3000), where: str(d.where, 40), often: str(d.often, 20), env: str(d.env, 3000),
      t: millis(d.t), st: BUG_ST[d.st] ? d.st : 'new', name: str(d.name, 160), reg: str(d.reg, 40), img: d.img === true, note: str(d.note, 1000), ut: millis(d.ut) };
  }
  /* the player has seen these: remember the latest change the team made, and stop looking once none is open */
  function bugsSeen(list) {
    var last = num(Number(L.get(LS_BUG_SEEN))), open = false;
    list.forEach(function (b) { last = Math.max(last, b.ut); if (b.st === 'new' || b.st === 'seen') open = true; });
    L.set(LS_BUG_SEEN, last || null);
    if (!open) L.set(LS_BUG, null);
  }
  /* a while after the page loads, tell a player whose report the team has looked at what became of it */
  function bugsCheck() {
    var u = A.auth && A.auth.currentUser;
    if (!L.get(LS_BUG) || !u || A.leaving) return;
    var seen = num(Number(L.get(LS_BUG_SEEN)));
    A.fs.collection('bugs').where('by', '==', u.uid).limit(50).get().then(function (qs) {
      var list = qs.docs.map(bugOf), fresh = list.filter(function (b) { return b.ut > seen; });
      if (fresh.length) toast(fresh.length > 1 ? 'The Edictum team has looked at ' + fresh.length + ' of your bug reports. See Report a bug, under Other in the menu.'
        : 'Your bug report “' + fresh[0].ti + '” is now marked ' + BUG_ST[fresh[0].st] + '. See Report a bug, under Other in the menu.');
      bugsSeen(list);
    }, function () {});
  }

  /* ───────── the referee (functions/index.js) ───────── */
  /* a callable function, by its protocol: POST {data} with the player's ID token; {result} or {error} back */
  async function call(name, data) {
    var u = A.auth && A.auth.currentUser;
    if (!u) throw mapError({ code: 'unauthenticated' });
    var op = isObj(data) ? data.op : '';
    /* who of the region is online (op online) only reads, so it is asked observing as well */
    if (pviewing() && !(name === 'civic' && (op === 'state' && data.obs || op === 'online'))) throw readOnly();
    if (observing() && (name === 'referee' || name === 'civic' && !/^(news|cb)/.test(op) && !(op === 'topic' && data.as === 'team') && !(op === 'state' && data.obs) && op !== 'online' || name === 'accounts' && op === 'shop')) throw readOnly();
    var r, b;
    try {
      r = await within(fetch(A.fn + '/' + name, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + await u.getIdToken() }, body: JSON.stringify({ data: data }) }), name === 'adminConsole' ? 120000 : 20000);
      b = await r.json().catch(function () { return null; });
    } catch (e) { throw mapError({ code: 'unavailable', message: (e && e.message) || 'the referee could not be reached' }); }
    if (r.ok && b && 'result' in b) return b.result;
    var e = (b && b.error) || {};
    throw mapError({ code: (e.details && e.details.code) || String(e.status || (r.status === 429 ? 'resource-exhausted' : 'unavailable')).toLowerCase().replace(/_/g, '-'), message: e.message || 'HTTP ' + r.status, details: e.details });
  }
  /* battles are rolled by the referee: battle({d, c, p, w, h}) → {ok, win, t, s?, p, r} or {ok: false, why, next?} */
  var refereeApi = Object.freeze({
    battle: function (d) { return A.frozen ? hang() : call('referee', Object.assign({}, isObj(d) ? d : {}, { op: 'battle' })); }
  });
  var civicApi = Object.freeze({ request: function(data) { return call('civic', data); } });
  /* the shop (functions/shop.js, through the accounts callable): request({step, …}); checkout({txn, env, token, theme,
     onEvent}) opens Paddle's checkout over the page for a transaction the server made. Paddle.js is loaded from
     Paddle's own address only when the Shop asks for local prices or a checkout opens. In the emulators the server may answer env 'fake': no Paddle,
     and the tests drive window.__edictumCheckout instead. */
  var PADDLE = { p: null, token: '', on: null };
  function paddleJs() {
    if (PADDLE.p) return PADDLE.p;
    PADDLE.p = new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = 'https://cdn.paddle.com/paddle/v2/paddle.js'; s.async = true;
      s.onload = function () { if (window.Paddle) res(window.Paddle); else { PADDLE.p = null; rej(mapError({ code: 'unavailable', message: 'Paddle.js did not start' })); } };
      s.onerror = function () { PADDLE.p = null; rej(mapError({ code: 'unavailable', message: 'Paddle.js could not be loaded' })); };
      document.head.appendChild(s);
    });
    return PADDLE.p;
  }
  function paddleReady(o) {
    return paddleJs().then(function (P) {
      if (PADDLE.token !== o.token) {
        if (PADDLE.token) throw mapError({ code: 'unavailable', message: 'The checkout changed; reload the page' });
        if (o.env === 'sandbox') P.Environment.set('sandbox');
        P.Initialize({ token: str(o.token, 200), eventCallback: function (e) { if (PADDLE.on) PADDLE.on(e); } });
        PADDLE.token = o.token;
      }
      return P;
    });
  }
  var shopApi = Object.freeze({
    request: function (data) { return A.frozen ? hang() : call('accounts', Object.assign({}, isObj(data) ? data : {}, { op: 'shop' })); },
    /* local({env, token, items: [pri_…]}) → {cur, prices: {pri_…: 'MX$209.39'}, amounts: {pri_…: 20939}}: what Paddle
       charges where the player is (it works the country out from their IP address), tax included, or null; amounts in the
       currency's smallest unit (the basket adds them up). At most 40 prices (the Shop sells 11 products; it was capped
       at 10, which left the 11th in euros). In the emulators the tests answer through window.__edictumPrices(items). */
    local: function (o) {
      var items = isObj(o) && Array.isArray(o.items) ? o.items.filter(function (v) { return typeof v === 'string' && /^pri_[a-z0-9]{8,64}$/.test(v); }).slice(0, 40) : [];
      if (!items.length) return Promise.resolve(null);
      var tidy = function (r) {
        if (!isObj(r) || typeof r.cur !== 'string' || !isObj(r.prices)) return null;
        var out = {}, am = {}, ra = isObj(r.amounts) ? r.amounts : {};
        items.forEach(function (id) {
          if (typeof r.prices[id] === 'string') out[id] = str(r.prices[id], 40);
          var n = Number(ra[id]); if (typeof ra[id] !== 'boolean' && ra[id] !== '' && ra[id] != null && isFinite(n) && n >= 0 && n < 1e9) am[id] = Math.round(n);
        });
        return { cur: str(r.cur, 3).toUpperCase(), prices: out, amounts: am };
      };
      if (o.env === 'fake') return Promise.resolve(typeof window.__edictumPrices === 'function' ? tidy(window.__edictumPrices(items)) : null);
      return paddleReady(o).then(function (P) {
        return P.PricePreview({ items: items.map(function (id) { return { priceId: id, quantity: 1 }; }) });
      }).then(function (r) {
        var d = r && r.data, cur = d && typeof d.currencyCode === 'string' ? d.currencyCode : '', prices = {}, amounts = {};
        var lines = d && d.details && Array.isArray(d.details.lineItems) ? d.details.lineItems : [];
        /* Paddle writes pesos as "$209.39", which reads as dollars: written again from the amount (in the currency's
           smallest unit) with the currency named, "MX$209.39"; Paddle's own text if that fails */
        var named = function (amount) {
          try {
            var f = new Intl.NumberFormat('en-IE', { style: 'currency', currency: cur }), n = Number(amount);
            return isFinite(n) && amount !== '' && amount != null ? f.format(n / Math.pow(10, f.resolvedOptions().maximumFractionDigits)) : '';
          } catch (e) { return ''; }
        };
        lines.forEach(function (l) { if (l && l.price && l.formattedTotals) { prices[l.price.id] = named(l.totals && l.totals.total) || l.formattedTotals.total; if (l.totals) amounts[l.price.id] = l.totals.total; } });
        return tidy({ cur: cur, prices: prices, amounts: amounts });
      }).catch(function () { return null; });
    },
    checkout: function (o) {
      if (!isObj(o) || typeof o.txn !== 'string' || !/^txn_[a-z0-9]{8,64}$/.test(o.txn)) return Promise.reject(mapError({ code: 'invalid-argument' }));
      PADDLE.on = function (e) { if (typeof o.onEvent === 'function') try { o.onEvent({ name: str(e && e.name, 60), txn: str(e && e.data && e.data.transaction_id, 80) }); } catch (x) {} };
      if (o.env === 'fake') {
        window.__edictumCheckout = { txn: o.txn, event: function (name) { PADDLE.on({ name: name, data: { transaction_id: o.txn } }); } };
        return Promise.resolve({ opened: true });
      }
      return paddleReady(o).then(function (P) {
        P.Checkout.open({ transactionId: o.txn, settings: { displayMode: 'overlay', variant: 'one-page', theme: o.theme === 'dark' ? 'dark' : 'light', showAddDiscounts: false } });
        return { opened: true };
      });
    },
    close: function () { try { if (window.Paddle && PADDLE.token) window.Paddle.Checkout.close(); } catch (e) {} if (window.__edictumCheckout) window.__edictumCheckout.closed = true; }
  });
  var adminApi = Object.freeze({ request: function (data) { return call('adminConsole', data); } });

  /* A player's first read of a development news post: their mark devnews/<post>/rd/<uid> and one more on the
     post's count devnewsStat/<post>.n, in one batch the rules accept only together and only once per player. */
  function newsRead(post) {
    var u = A.auth && A.auth.currentUser, id = String(post || '');
    if (A.frozen) return hang();
    if (observing()) return Promise.reject(readOnly());
    if (!u) return Promise.reject(mapError({ code: 'unauthenticated' }));
    if (!/^[A-Za-z0-9]{20}$/.test(id)) return Promise.reject(mapError({ code: 'invalid-argument' }));
    var b = A.fs.batch();
    b.set(A.fs.doc('devnews/' + id + '/rd/' + u.uid), {});
    b.set(A.fs.doc('devnewsStat/' + id), { n: A.fb.firestore.FieldValue.increment(1) }, { merge: true });
    return b.commit().then(function () {}, function (e) { throw mapError(e); });
  }
  var dbApi = Object.freeze({ doc: docApi, collection: collectionApi, collectionGroup: collectionGroupApi, count: count, post: post, newsRead: newsRead });
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
    /* a moderator (custom claim mod, tools/admin/set-admin.mjs --mod) removes development news comments;
       read from the token isOwner() fetched */
    isMod: function () {
      var u = A.auth && A.auth.currentUser;
      return Promise.resolve(!!(u && A.claimsUid === u.uid && A.claims && A.claims.mod === true));
    },
    can: function (what) { return Promise.resolve(what === 'data.write' ? !!(A.auth && A.auth.currentUser) : false); }
  });
  /* the game opens the report dialog: open({kind:'post'|'letter'|'chat'|'nation', target:<uid>, post, reg, name, x}); a region
     chat line ('chat') is filed as a post rc:<reg>:<line> */
  var reportApi = Object.freeze({ open: function (info) { if (isObj(info)) open('report', info); } });
  /* support tickets (see firestore.rules and functions/support.js): the player opens one with open({name, reg, onSent}),
     reads their own with mine() (each with fresh, the time they had read up to when the team has said something
     since, which marks it read), writes back with reply(id, text) and closes one with close(id); unread() is how many
     have a word from the team not yet read. Admins list them, reply (keeping it open) or answer (closing it), reopen
     and delete them. */
  var supportApi = Object.freeze({
    open: function (info) { open('support', isObj(info) ? info : {}); },
    mine: function () {
      var u = A.auth && A.auth.currentUser;
      if (!u) return Promise.resolve([]);
      return A.fs.collection('support').where('by', '==', u.uid).limit(50).get().then(function (qs) {
        var seen = num(Number(L.get(LS_SUP_SEEN))), list = qs.docs.map(ticketOf).sort(function (a, b) { return b.lt - a.lt; });
        list.forEach(function (t) { t.fresh = t.news > seen ? seen || 1 : 0; });
        var last = list.reduce(function (m, t) { return Math.max(m, t.news); }, seen);
        L.set(LS_SUP_SEEN, last || null); L.set(LS_SUP_TOLD, Math.max(last, num(Number(L.get(LS_SUP_TOLD)))) || null);
        L.set(LS_SUP_NEW, null);
        supportWatch(list);
        return list;
      }, function (e) { throw mapError(e); });
    },
    reply: function (id, text) {
      return call('accounts', { op: 'support', step: 'reply', id: str(id, 64), x: str(String(text || ''), 2000) }).then(function (r) { L.set(LS_SUP, '1'); return r; });
    },
    close: function (id) { return call('accounts', { op: 'support', step: 'close', id: str(id, 64) }); },
    unread: function () { return num(Number(L.get(LS_SUP_NEW))); },
    list: function () {
      var c = A.fs.collection('support');
      return Promise.all([c.where('st', '==', 'open').limit(300).get(), c.orderBy('ct', 'desc').limit(30).get()]).then(function (r) {
        return { open: r[0].docs.map(ticketOf), closed: r[1].docs.map(ticketOf).filter(function (t) { return t.st === 'closed'; }) };
      }, function (e) { throw mapError(e); });
    },
    /* keepOpen: a reply that leaves the ticket open, the player's turn; otherwise the answer closes it (none: closes it without one) */
    answer: function (id, reply, keepOpen) {
      var said = !!(reply && String(reply).trim());
      return adminApi.request({ op: 'moderate', action: keepOpen ? 'support_reply' : said ? 'support_answer' : 'support_close', target: id, reply: reply || '',
        reason: keepOpen ? 'Replied to support ticket' : said ? 'Answered and closed support ticket' : 'Closed support ticket without an answer' });
    },
    reopen: function (id) { return adminApi.request({ op: 'moderate', action: 'support_reopen', target: id, reason: 'Reopened support ticket' }); },
    remove: function (id) { return adminApi.request({ op: 'moderate', action: 'support_delete', target: id, reason: 'Deleted support spam' }); }
  });
  /* Letters by post (functions/mail.js): the game's Settings card reads and changes the player's address with
     request({step, ...}); ping(to, k, nm) tells the mail job that this nation did k to nation `to` (firestore.rules,
     mailQ). A ping carries no text; if that player asked for letters, the hourly job may write to them. */
  var mailApi = Object.freeze({
    request: function (data) { return A.frozen ? hang() : call('accounts', Object.assign({}, isObj(data) ? data : {}, { op: 'mail' })); },
    /* one ping per sender, nation and kind until the job has handled it (the rules: nm is the nation's saved name,
       `to` a nation of the same region, and a ping refreshed at most every 10 minutes) */
    ping: function (to, k, nm) {
      var u = A.auth && A.auth.currentUser;
      if (!u || A.frozen || observing() || typeof to !== 'string' || !to || to.length > 128 || to === u.uid) return Promise.resolve(false);
      return A.fs.doc('mailQ/' + u.uid + '~' + to + '~' + String(k)).set({ to: to, by: u.uid, k: String(k), nm: str(nm, 80) || 'A nation', t: serverTime() }).then(function () { return true; }, function () { return false; });
    }
  });
  /* recruiting (functions/accounts.js, 'recruit'): a player who founded a nation through another player's link
     has the server file recruits/<own uid> {r: that player's uid} once, as a Registered Nation; the recruiter lists
     the ones naming them. claim(by) → 'ok' (filed now), 'done' (filed before), 'guest' (link an account first),
     'retry' (the first save may still be on its way), 'no' (it does not count) or 'bad' */
  /* letters between players (firestore.rules, letters). A letter is {to, x, t, k?, r?, a?, g?}: t is the time in the
     writer's own copy (nationp), which the document's id repeats (letters/<uid>~<to>~<t>), so a letter sent again is
     the same document. Each batch also counts the day's letters (llimits {l, d, n}) and, outside group letters, those
     to that nation not yet answered (lpair/<uid>~<to> {u}); a letter to a nation whose own count to us stands above
     nought sets it back (lpair/<to>~<uid>). What the shim knows of those counts is kept for a short while (LQ) and
     read again when a batch is refused, which is then tried once more.
     send(letter) → 'ok' (delivered, now or before), 'later' (paced or offline: try again), 'no' (no such nation),
       'blocked' (that nation accepts no letters from us), 'cap' (ten unanswered) or 'day' (150 today)
     sendGroup([letter, …]) → the same answer for each: a group letter goes to up to four members a batch
     listen(next, error, since) hears the letters written to this player, newest first, as [{id, by, to, x, t, ts, k?,
       r?, a?, g?}]: all of the last 200, or (since, the server time of the newest the game holds) only those after it
     older(peer, before, n) → the letters both ways with that player written before `before`, newest first
     seen(next) hears the read receipts of the players this one writes to: {uid: time read up to}
     markSeen(w, t) tells w we have read their letters up to t; unseen() takes back every receipt we gave
     block(x, on) → 'ok' or 'no'; blocks() → the uids this player blocks
     remove(ids) deletes letters (written by or to this player)
     notify(ids) asks the server to tell the readers of letters just delivered (functions/letters.js: a push
       notification, or a letter by post), and push(step, data) sets up this device's notifications */
  var DAY_MS = 86400000, LETTERS_DAY = 150, LETTER_KEEP = 365 * DAY_MS;
  var LQ = { at: 0, d: -1, n: 0, out: {}, inn: {}, blk: {} };
  function lqFresh() { if (Date.now() - LQ.at > 30000) { LQ.at = Date.now(); LQ.out = {}; LQ.inn = {}; } }
  function lqDay() { return Math.floor(Date.now() / DAY_MS); }
  function letterDoc(uid, m) {
    var d = { by: uid, to: m.to, x: String(m.x).slice(0, 2500), t: m.t, ts: serverTime(), exp: A.fb.firestore.Timestamp.fromMillis(Date.now() + LETTER_KEEP) };
    if (typeof m.k === 'string' && /^(congrats|protest|condol|friend|ultim|treaty)$/.test(m.k)) d.k = m.k;
    if (isObj(m.r) && Number.isSafeInteger(m.r.t)) d.r = { t: m.r.t, x: str(m.r.x, 160) };
    if (isObj(m.a) && /^(deal|peace|ally|city|ach)$/.test(m.a.k)) {
      var a = { k: m.a.k };
      if (typeof m.a.id === 'string' && m.a.id) a.id = m.a.id.slice(0, 128);
      if (Number.isSafeInteger(m.a.c)) a.c = m.a.c;
      if (typeof m.a.nm === 'string' && m.a.nm) a.nm = m.a.nm.slice(0, 80);
      d.a = a;
    }
    if (isObj(m.g) && typeof m.g.id === 'string' && Array.isArray(m.g.m)) {
      d.g = { id: m.g.id.slice(0, 80), m: m.g.m.filter(function (x) { return typeof x === 'string' && /^[\w-]{1,128}$/.test(x); }).slice(0, 13) };
      if (typeof m.g.nm === 'string' && m.g.nm) d.g.nm = m.g.nm.slice(0, 60);
    }
    return d;
  }
  function letterOf(d) {
    var v = d.data({ serverTimestamps: 'estimate' }) || {}, o = { id: d.id, by: str(v.by, 128), to: str(v.to, 128), x: str(v.x, 2500), t: num(v.t), ts: millis(v.ts) || num(v.t) };
    if (typeof v.k === 'string') o.k = v.k.slice(0, 12);
    if (isObj(v.r) && Number.isSafeInteger(v.r.t)) o.r = { t: v.r.t, x: str(v.r.x, 160) };
    if (isObj(v.a) && typeof v.a.k === 'string') { o.a = { k: v.a.k.slice(0, 12) }; if (typeof v.a.id === 'string') o.a.id = v.a.id.slice(0, 128); if (Number.isSafeInteger(v.a.c)) o.a.c = v.a.c; if (typeof v.a.nm === 'string') o.a.nm = v.a.nm.slice(0, 80); }
    if (isObj(v.g) && typeof v.g.id === 'string' && Array.isArray(v.g.m)) { o.g = { id: v.g.id.slice(0, 80), m: v.g.m.filter(function (x) { return typeof x === 'string'; }).slice(0, 13) }; if (typeof v.g.nm === 'string') o.g.nm = v.g.nm.slice(0, 60); }
    return o;
  }
  /* what the rules will check: today's count, and the two counts of each pair (read when not known) */
  async function lqLoad(uid, tos, pairs) {
    lqFresh();
    var jobs = [];
    if (LQ.d < 0) jobs.push(A.fs.doc('llimits/' + uid).get().then(function (s) { var v = s.exists ? s.data() : {}; LQ.d = Number.isInteger(v.d) ? v.d : -1; LQ.n = Number.isInteger(v.n) ? v.n : 0; if (LQ.d < 0) LQ.d = -2; }));
    tos.forEach(function (to) {
      /* a block is read again whenever it is known, so a lifted one is never trusted from memory */
      if (!(to in LQ.blk) || LQ.blk[to]) jobs.push(A.fs.doc('lblock/' + to + '~' + uid).get().then(function (s) { LQ.blk[to] = s.exists; }, function () { LQ.blk[to] = false; }));
      if (!pairs) return;
      if (!(to in LQ.out)) jobs.push(A.fs.doc('lpair/' + uid + '~' + to).get().then(function (s) { LQ.out[to] = s.exists ? num(s.get('u')) : 0; }));
      if (!(to in LQ.inn)) jobs.push(A.fs.doc('lpair/' + to + '~' + uid).get().then(function (s) { LQ.inn[to] = s.exists ? num(s.get('u')) : 0; }));
    });
    await within(Promise.all(jobs), 15000);
  }
  function lqForget() { LQ.at = 0; LQ.d = -1; LQ.out = {}; LQ.inn = {}; LQ.blk = {}; }
  async function sendBatch(list, group) {
    var u = A.auth && A.auth.currentUser;
    if (!u || A.frozen || observing()) return list.map(function () { return 'later'; });
    var ok = list.filter(function (m) { return isObj(m) && typeof m.to === 'string' && /^[\w-]{1,128}$/.test(m.to) && m.to !== u.uid && typeof m.x === 'string' && m.x.trim() && Number.isSafeInteger(m.t); });
    if (ok.length !== list.length || !ok.length || ok.length > 4 || (!group && ok.length > 1)) return list.map(function () { return 'no'; });
    var tos = ok.map(function (m) { return m.to; }), attempt = async function () {
      await lqLoad(u.uid, tos, !group);
      var out = [], b = A.fs.batch(), day = lqDay(), go = ok.filter(function (m) { if (LQ.blk[m.to]) { out.push('blocked'); return false; } out.push(null); return true; });
      if (!group && LQ.out[tos[0]] >= 10) return ['cap'];
      var n = (LQ.d === day ? LQ.n : 0) + go.length;
      if (n > LETTERS_DAY) return list.map(function () { return 'day'; });
      if (!go.length) return out;
      go.forEach(function (m) { b.set(A.fs.doc('letters/' + u.uid + '~' + m.to + '~' + m.t), letterDoc(u.uid, m)); });
      b.set(A.fs.doc('llimits/' + u.uid), { l: serverTime(), d: day, n: n });
      if (!group) {
        var to = tos[0];
        b.set(A.fs.doc('lpair/' + u.uid + '~' + to), { by: u.uid, to: to, u: LQ.out[to] + 1, l: serverTime() });
        if (LQ.inn[to] > 0) b.update(A.fs.doc('lpair/' + to + '~' + u.uid), { u: 0 });
      }
      await within(b.commit(), 20000);
      LQ.d = day; LQ.n = n; if (!group) { LQ.out[tos[0]] += 1; LQ.inn[tos[0]] = 0; }
      return out.map(function (r) { return r || 'ok'; });
    };
    try { return await attempt(); } catch (e) {
      if (!e || e.code !== 'permission-denied') return list.map(function () { return 'later'; });
    }
    /* refused: what we knew may be stale (another device wrote), so read it all again and try once more */
    lqForget();
    try { return await attempt(); } catch (e) {
      if (!e || e.code !== 'permission-denied') return list.map(function () { return 'later'; });
    }
    /* still refused: delivered before (a retry), blocked, too many, or no such nation; or only paced */
    return Promise.all(ok.map(function (m) {
      return A.fs.doc('letters/' + u.uid + '~' + m.to + '~' + m.t).get().then(function (d) {
        if (d.exists) return 'ok';
        if (LQ.blk[m.to]) return 'blocked';
        if (!group && LQ.out[m.to] >= 10) return 'cap';
        if (LQ.d === lqDay() && LQ.n + ok.length > LETTERS_DAY) return 'day';
        return A.fs.doc('nations/' + m.to).get().then(function (n) { return n.exists ? 'later' : 'no'; });
      }).catch(function () { return 'later'; });
    }));
  }
  var lettersApi = Object.freeze({
    send: function (m) { return sendBatch([m], false).then(function (r) { return r[0]; }); },
    sendGroup: function (list) { return Array.isArray(list) ? sendBatch(list, true) : Promise.resolve([]); },
    listen: function (next, error, since) {
      var u = A.auth && A.auth.currentUser;
      if (!u || observing()) return null;
      /* only the letters newer than those the game holds; while that query's index is still being built (just after a
         deploy) the last 200 instead */
      var unsub = null, stopped = false;
      function start(since) {
        var q = A.fs.collection('letters').where('to', '==', u.uid);
        q = since > 0 ? q.where('ts', '>', A.fb.firestore.Timestamp.fromMillis(since)).orderBy('ts', 'desc').limit(200) : q.orderBy('t', 'desc').limit(200);
        unsub = q.onSnapshot(function (qs) {
          var list = qs.docs.map(letterOf).filter(function (l) { return l.by && l.x && l.t > 0; });
          list.forEach(function (l) { delete LQ.inn[l.by]; delete LQ.out[l.by]; });
          next(list);
        }, function (e) {
          if (since > 0 && e && e.code === 'failed-precondition' && !stopped) { start(0); return; }
          if (typeof error === 'function') error(mapError(e));
        });
      }
      start(num(since));
      return function () { stopped = true; if (unsub) unsub(); };
    },
    older: function (peer, before, n) {
      var u = A.auth && A.auth.currentUser;
      if (!u || observing() || typeof peer !== 'string' || !/^[\w-]{1,128}$/.test(peer)) return Promise.resolve([]);
      var lim = Math.max(1, Math.min(50, num(n) || 30)), c = A.fs.collection('letters'), t = num(before) || Date.now() + DAY_MS;
      return within(Promise.all([c.where('by', '==', u.uid).where('to', '==', peer).where('t', '<', t).orderBy('t', 'desc').limit(lim).get(),
        c.where('by', '==', peer).where('to', '==', u.uid).where('t', '<', t).orderBy('t', 'desc').limit(lim).get()]), 15000).then(function (r) {
        return r[0].docs.concat(r[1].docs).map(letterOf).filter(function (l) { return l.x && l.t > 0; }).sort(function (a, b) { return b.t - a.t; });
      }, function (e) { throw mapError(e); });
    },
    seen: function (next) {
      var u = A.auth && A.auth.currentUser;
      if (!u || observing()) return null;
      return A.fs.collection('lseen').where('w', '==', u.uid).limit(300).onSnapshot(function (qs) {
        var o = {}; qs.docs.forEach(function (d) { var r = str(d.get('r'), 128), t = num(d.get('t')); if (r && t > 0) o[r] = t; }); next(o);
      }, function () {});
    },
    markSeen: function (w, t) {
      var u = A.auth && A.auth.currentUser;
      if (!u || A.frozen || observing() || typeof w !== 'string' || !/^[\w-]{1,128}$/.test(w) || w === u.uid || !Number.isSafeInteger(t)) return Promise.resolve(false);
      return A.fs.doc('lseen/' + u.uid + '~' + w).set({ r: u.uid, w: w, t: Math.min(t, Date.now()) }).then(function () { return true; }, function () { return false; });
    },
    unseen: function () {
      var u = A.auth && A.auth.currentUser;
      if (!u || observing()) return Promise.resolve(false);
      return A.fs.collection('lseen').where('r', '==', u.uid).get().then(function (qs) {
        var b = A.fs.batch(); qs.docs.forEach(function (d) { b.delete(d.ref); }); return qs.docs.length ? b.commit() : null;
      }).then(function () { return true; }, function () { return false; });
    },
    block: function (x, on) {
      var u = A.auth && A.auth.currentUser;
      if (!u || A.frozen || observing() || typeof x !== 'string' || !/^[\w-]{1,128}$/.test(x) || x === u.uid) return Promise.resolve('no');
      var ref = A.fs.doc('lblock/' + u.uid + '~' + x);
      return (on ? ref.set({ b: u.uid, x: x, t: serverTime() }) : ref.delete()).then(function () { return 'ok'; }, function () { return 'no'; });
    },
    blocks: function () {
      var u = A.auth && A.auth.currentUser;
      if (!u || observing()) return Promise.resolve(null);
      return A.fs.collection('lblock').where('b', '==', u.uid).limit(500).get().then(function (qs) { return qs.docs.map(function (d) { return str(d.get('x'), 128); }).filter(Boolean); }, function () { return null; });
    },
    remove: function (ids) {
      var u = A.auth && A.auth.currentUser;
      if (!u || A.frozen || observing() || !Array.isArray(ids)) return Promise.resolve(false);
      var ok = ids.filter(function (id) { return typeof id === 'string' && /^[\w-]{1,128}~[\w-]{1,128}~\d{1,16}$/.test(id) && id.split('~').slice(0, 2).indexOf(u.uid) >= 0; }).slice(0, 400);
      if (!ok.length) return Promise.resolve(true);
      var b = A.fs.batch(); ok.forEach(function (id) { b.delete(A.fs.doc('letters/' + id)); });
      return b.commit().then(function () { return true; }, function () { return false; });
    },
    notify: function (ids) {
      if (A.frozen || observing() || !Array.isArray(ids) || !ids.length) return Promise.resolve(false);
      return call('accounts', { op: 'letters', step: 'notify', ids: ids.filter(function (x) { return typeof x === 'string'; }).slice(0, 13) }).then(function () { return true; }, function () { return false; });
    },
    /* an admin's important development news post, told by notification once (functions/letters.js, newsPush) */
    newsPush: function (post) {
      if (A.frozen || observing() || typeof post !== 'string' || !/^[A-Za-z0-9]{20}$/.test(post)) return Promise.reject(new Error('no'));
      return call('accounts', { op: 'letters', step: 'news', post: post });
    },
    push: function (step, data) {
      if (A.frozen || observing() || ['key', 'add', 'remove', 'status'].indexOf(step) < 0) return Promise.reject(new Error('no'));
      return call('accounts', Object.assign({}, isObj(data) ? data : {}, { op: 'letters', step: step }));
    }
  });
  var recruitApi = Object.freeze({
    me: function () { var u = A.auth && A.auth.currentUser; return u ? u.uid : ''; },
    claim: function (by) {
      var u = A.auth && A.auth.currentUser;
      if (!u || A.frozen || observing() || typeof by !== 'string' || !/^[A-Za-z0-9_-]{6,128}$/.test(by) || by === u.uid) return Promise.resolve('bad');
      return call('accounts', { op: 'recruit', by: by }).then(function (r) {
        var why = r && r.why;
        return r && r.ok ? 'ok' : why === 'done' || why === 'guest' ? why : why === 'nation_required' || why === 'region_disabled' ? 'retry' : 'no';
      }, function () { return 'retry'; });
    },
    mine: function () {
      var u = A.auth && A.auth.currentUser;
      if (!u || observing()) return Promise.resolve([]);
      return A.fs.collection('recruits').where('r', '==', u.uid).limit(200).get().then(function (q) {
        return q.docs.map(function (d) { var t = d.get('t'); return { id: d.id, t: t && t.toMillis ? t.toMillis() : 0 }; });
      }, function () { return null; });
    }
  });
  /* bug reports (see firestore.rules): the game's Report a bug page sends one with send(report, screenshot?)
     and reads the player's own with mine(); admins list them, set(id, state, note) and remove them */
  var bugsApi = Object.freeze({
    send: function (r, img) {
      var u = A.auth && A.auth.currentUser;
      if (A.frozen) return hang();
      if (!u || !isObj(r)) return Promise.reject(mapError({ code: 'unauthenticated' }));
      var ref = A.fs.collection('bugs').doc(), b = A.fs.batch();
      var doc = { by: u.uid, ti: str(r.ti, 120), x: str(r.x, 3000), where: str(r.where, 40), often: ['always', 'sometimes', 'once'].indexOf(r.often) >= 0 ? r.often : 'once',
        env: str(r.env, 3000), t: serverTime(), st: 'new' };
      if (str(r.name, 80)) doc.name = str(r.name, 80);
      if (str(r.reg, 40)) doc.reg = str(r.reg, 40);
      if (isObj(img) && typeof img.d === 'string') {
        doc.img = true;
        b.set(A.fs.doc('bugImg/' + ref.id), { d: img.d, m: str(img.m, 20), w: Math.round(num(img.w)), h: Math.round(num(img.h)), by: u.uid });
      }
      b.set(ref, doc);
      b.set(A.fs.doc('blimits/' + u.uid), { b: serverTime() });
      return b.commit().then(function () { L.set(LS_BUG, '1'); return ref.id; }, function (e) { throw mapError(e); });
    },
    mine: function () {
      var u = A.auth && A.auth.currentUser;
      if (!u) return Promise.resolve([]);
      return A.fs.collection('bugs').where('by', '==', u.uid).limit(50).get().then(function (qs) {
        var list = qs.docs.map(bugOf).sort(function (a, b) { return b.t - a.t; });
        bugsSeen(list);
        return list;
      }, function (e) { throw mapError(e); });
    },
    list: function () {
      return A.fs.collection('bugs').orderBy('t', 'desc').limit(300).get().then(function (qs) { return qs.docs.map(bugOf); }, function (e) { throw mapError(e); });
    },
    image: function (id) {
      return A.fs.doc('bugImg/' + str(id, 40)).get().then(function (s) {
        var d = s.exists ? s.data() : null;
        return d && typeof d.d === 'string' ? { d: d.d, m: str(d.m, 20), w: num(d.w), h: num(d.h) } : null;
      }, function (e) { throw mapError(e); });
    },
    set: function (id, st, note) {
      var u = A.auth && A.auth.currentUser;
      if (!u) return Promise.reject(mapError({ code: 'unauthenticated' }));
      return A.fs.doc('bugs/' + str(id, 40)).update({ st: BUG_ST[st] ? st : 'new', note: str(note, 1000), ut: serverTime(), uby: u.uid })
        .then(function () {}, function (e) { throw mapError(e); });
    },
    /* the public Known bugs list: anyone reads it, admins add, change and remove entries */
    known: function () {
      return A.fs.collection('known').orderBy('ut', 'desc').limit(200).get().then(function (qs) {
        return qs.docs.map(function (s) {
          var d = s.data({ serverTimestamps: 'estimate' }) || {};
          return { id: s.id, ti: str(d.ti, 120), x: str(d.x, 600), st: ['new', 'inv', 'fixed'].indexOf(d.st) >= 0 ? d.st : 'new', t: millis(d.t), ut: millis(d.ut) };
        });
      }, function (e) { throw mapError(e); });
    },
    knownSave: function (id, k) {
      if (!isObj(k) || !str(k.ti, 120).trim()) return Promise.reject(mapError({ code: 'invalid-argument' }));
      var ref = id ? A.fs.doc('known/' + str(id, 40)) : A.fs.collection('known').doc();
      var doc = { ti: str(k.ti, 120).trim(), x: str(k.x, 600).trim(), st: ['new', 'inv', 'fixed'].indexOf(k.st) >= 0 ? k.st : 'new', ut: serverTime() };
      if (!id) doc.t = serverTime();
      return (id ? ref.update(doc) : ref.set(doc)).then(function () { return ref.id; }, function (e) { throw mapError(e); });
    },
    knownRemove: function (id) {
      return A.fs.doc('known/' + str(id, 40)).delete().then(function () {}, function (e) { throw mapError(e); });
    },
    /* with its screenshot, when it has one (a player may not delete a screenshot that is not there) */
    remove: function (id, img) {
      var b = A.fs.batch();
      b.delete(A.fs.doc('bugs/' + str(id, 40)));
      if (img) b.delete(A.fs.doc('bugImg/' + str(id, 40)));
      return b.commit().then(function () {}, function (e) { throw mapError(e); });
    }
  });
  function apiFor(online) {
    return Object.freeze({
      use: function (n) {
        if (!online) return null;
        return n === 'shop' ? shopApi : n === 'civic' ? civicApi : n === 'db' ? dbApi : n === 'user' ? userApi : n === 'report' ? reportApi : n === 'support' ? supportApi : n === 'bugs' ? bugsApi : n === 'mail' ? mailApi : n === 'recruit' ? recruitApi : n === 'letters' ? lettersApi : n === 'referee' ? refereeApi : n === 'admin' ? adminApi : null;
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
  /* a named step of the game (the founding funnel: nation_founded, capital_settled, ...), with numbers only:
     never a player ID, a nation or anything typed */
  window.edictumStat = function (name, p) {
    if (!GA.on || !/^[a-z_]{3,40}$/.test(String(name))) return;
    var at = {};
    Object.keys(p || {}).forEach(function (k) { if (/^[a-z_]{1,40}$/.test(k) && typeof p[k] === 'number' && isFinite(p[k])) at[k] = p[k]; });
    gtag('event', name, at);
  };
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
    perfApply(v);
  }
  function statsSet(v) { L.set(LS_STATS, v); statsApply(v); }
  /* answered in another tab, or on the privacy notice */
  window.addEventListener('storage', function (e) { if (e.key === LS_STATS) statsApply(); });
  function statsAsk() {
    if (!GA.id || statsChoice() || GA.card) return;
    var c = document.createElement('section');
    c.className = 'ed-stats'; c.setAttribute('aria-label', 'Visit statistics');
    c.innerHTML = '<p><b>Help us see how Edictum is played?</b> With your permission, Google Analytics counts visits (the pages you open, your type of device and browser, and roughly where you are) and Firebase measures how fast the game loads and saves. They set cookies and keep a random ID in this browser. Nothing about your nation or your messages is sent. <a href="/privacy#analytics" target="_blank" rel="noopener">Privacy</a></p>' +
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

  /* ───────── speed statistics: Firebase Performance Monitoring, with the same answer ─────────
     A player who allows visit statistics also sends how fast the game is for them: how the page loaded (first
     and largest paint, layout shifts, how long a tap waits for the screen), how long each download took, and three
     of the game's own steps (perfTrace): start-up, reading the player's nation and saving it. Its script
     (self.edictumPerfSdk, from build.py) loads only then, and stops sending when visit statistics are turned off.
     Addresses go without player IDs: build.py's PERF_EDITS and src/perf-url.js. Off on this machine's emulators,
     unless a test sets EDICTUM_PERF. */
  var PF = { app: null, perf: null, loading: false, queue: [], read: false, shim: performance.now() };
  function perfAllowed() {
    return !!(PF.app && PF.app.options && PF.app.options.appId && self.edictumPerfSdk && statsChoice() === 'y' &&
      (window.EDICTUM_PERF || !localHost() && !/^demo-/.test(String(PF.app.options.projectId))));
  }
  function perfApply(v) {
    v = v || statsChoice();
    if (v === 'y') perfStart(); else if (v === 'n') perfStop();
  }
  function perfStart() {
    if (!perfAllowed()) return;
    if (PF.perf) { PF.perf.dataCollectionEnabled = true; PF.perf.instrumentationEnabled = true; return; }
    if (PF.loading) return;
    PF.loading = true;
    var s = document.createElement('script');
    s.async = true; s.src = self.edictumPerfSdk;
    s.onload = function () {
      try { PF.perf = window.firebase.performance(PF.app); } catch (e) { console.warn('[edictum] Speed statistics did not start.', e && (e.code || e.message)); return; }
      if (statsChoice() !== 'y') { perfStop(); return; } /* turned off while it loaded */
      PF.queue.splice(0).forEach(function (f) { f(); });
    };
    s.onerror = function () { PF.loading = false; s.remove(); };
    document.head.appendChild(s);
  }
  function perfStop() {
    PF.queue = [];
    if (PF.perf) { PF.perf.instrumentationEnabled = false; PF.perf.dataCollectionEnabled = false; return; }
    /* like Google's cookies: its settings and this browser's Firebase installation ID go too. Not while it runs in
       this tab, whose open database would hold the deletion (and a later Allow) up until the tab closes */
    try { localStorage.removeItem('@firebase/performance/config'); localStorage.removeItem('@firebase/performance/configexpire'); } catch (e) {}
    try { indexedDB.deleteDatabase('firebase-installations-database'); } catch (e) {}
  }
  /* one of the game's own steps, from start (performance.now()) for ms: numbers and fixed words only, never an ID or a
     name. Steps before the script loads wait for it (a few), and are dropped if the answer is no */
  function perfTrace(name, start, ms, metrics, attrs) {
    if (!(ms >= 0) || statsChoice() === 'n') return;
    var go = function () {
      if (!PF.perf || statsChoice() !== 'y') return;
      var m = {};
      Object.keys(metrics || {}).forEach(function (k) { if (metrics[k] >= 0) m[k] = Math.round(metrics[k]); });
      try { PF.perf.trace(name).record((performance.timeOrigin || BOOT_AT - PF.shim) + start, Math.max(1, Math.round(ms)), { metrics: m, attributes: attrs || {} }); } catch (e) {}
    };
    if (PF.perf) go(); else if (PF.queue.length < 20) PF.queue.push(go);
  }

  /* ───────── start-up ───────── */
  function goOffline(why, err) {
    if (A.online) return;
    A.why = why;
    /* the game reads why before it lets anyone settle or claim land (game/edictum.html, landWait): with no server
       configured it keeps its own map, otherwise it waits for one */
    E.off = true; E.why = why;
    console.warn('[edictum] Playing in this browser only: ' + why + '.', err ? (err.code || err.message || err) : '');
    E.settle(apiFor(false));
    mount();
    if (why === 'anonymous sign-in failed') signInLater(0);
  }
  /* The game began in this browser only, and the account is signed in now (start-up finished after the 60 s src/stub.js
     gives it, or a later sign-in worked): a reload starts it in the region. Whatever was played meanwhile is saved in
     this browser and goes up with the first save. Never while the player is typing, and at most twice in ten minutes,
     or a start that is always this slow would reload for ever. Before this (2026-11-12) such a visit stayed offline
     until the player reloaded, with no other nation on its map. */
  var LATE_RELOAD = 'edictum.lateReload';
  function lateOnline() {
    var now = Date.now(), v = [];
    try { v = JSON.parse(SS.get(LATE_RELOAD) || '[]').filter(function (t) { return now - t < 600000; }); } catch (e) { v = []; }
    if (v.length >= 2 || A.leaving) return;
    var waited = 0;
    (function go() {
      if (A.leaving) return;
      if (typing() && waited++ < 120) { setTimeout(go, 5000); return; }
      v.push(Date.now()); SS.set(LATE_RELOAD, JSON.stringify(v));
      toast('Connected. Edictum is reloading to join your region.');
      setTimeout(function () { if (!A.leaving) location.reload(); }, 1200);
    })();
  }
  /* a guest sign-in that failed is tried again in the background (a phone between networks, a slow line), up to ten
     times, further apart each time; once it works, lateOnline */
  function signInLater(n) {
    if (n >= 10 || A.leaving || !A.auth) return;
    setTimeout(function () {
      if (A.leaving) return;
      if (navigator.onLine === false) { signInLater(n + 1); return; }
      var u = A.auth.currentUser;
      within(u ? Promise.resolve(u) : A.auth.signInAnonymously().then(function (r) { return r && r.user; }), 15000)
        .then(function (user) { if (user) lateOnline(); else signInLater(n + 1); }, function () { signInLater(n + 1); });
    }, 20000 * Math.min(6, n + 1));
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
  /* the nation in this browser may belong to another sign-in: never let it overwrite this account's, and never
     carry a saved nation over to a new sign-in. A browser can lose its sign-in and keep its nation (site data
     partly cleared, a session ended elsewhere), and then starts as a new guest: under that guest the copy would
     be a second nation of the same name, which the server never saves (its revisions are the other account's) */
  async function guard(user) {
    var prev = L.get(LS_UID), mine = localNation();
    if (!mine || !prev || prev === user.uid) return false;
    if (prev !== '-') {
      var has = true, kept = true;
      try {
        var both = await within(Promise.all([A.fs.doc('nations/' + user.uid).get(), A.fs.doc('nations/' + prev).get()]), 8000);
        has = both[0].exists; kept = both[1].exists;
      } catch (e) { /* unknown: as if both were there */ }
      /* neither account holds a nation (founded here and never saved, or its record is gone): it carries on */
      if (!has && !kept) return false;
      park(prev);
      leave({ nation: null, uid: user.uid }, has ? 'The nation “' + mine.name + '” in this browser belongs to another sign-in. Sign in to that account to play it again.' : signedOut(mine.name));
      return true;
    }
    /* signed out here since. A copy no save ever carried was founded after that, in this browser (offline, before a new
       guest could be made): it carries on under this sign-in, as a first nation would. A copy with a revision is the
       account's that signed out (a tab still open saved it after the sign-out): kept for that account, as above */
    var out = str(L.get(LS_OUT), 128);
    if (!revision(mine)) return false;
    if (out) park(out);
    leave({ nation: null, uid: user.uid }, out ? signedOut(mine.name) : '');
    return true;
  }
  function signedOut(name) {
    return 'This browser was signed out of the account that holds “' + name + '”. Sign in to it again to carry on (a Guest Nation uses its recovery code): its latest changes are kept here until then.';
  }
  /* This browser's copy of an account's nation, kept aside (LS_PARK) while another sign-in plays here: one at a
     time. The copy leaves LS_NATION first, so the browser's storage holds it only once. */
  function park(uid) {
    var n = parse(L.get(LS_NATION));
    if (!isObj(n)) return;
    L.set(LS_NATION, null);
    L.set(LS_PARK, JSON.stringify({ uid: uid, at: Date.now(), nation: n }));
  }
  /* signed in to that account again (by any way in): its copy goes back, and the game then weighs it against the
     account's saved record by revision, as after any time offline (a newer save elsewhere wins, and this copy is
     offered in the account menu) */
  function unpark(user) {
    var p = parse(L.get(LS_PARK));
    if (!isObj(p) || p.uid !== user.uid) return false;
    L.set(LS_PARK, null);
    if (localNation() || !isObj(p.nation)) return false;
    leave({ nation: JSON.stringify(p.nation), uid: user.uid });
    return true;
  }
  /* The game's save was refused as another device's, yet this account holds no nation (game/edictum.html,
     syncOwnNation): the copy here carries another account's revisions. Before guard() kept them apart, a lost
     sign-in left such copies under a new guest, where they never save and show as a second nation. The account
     they belong to holds the nation of the same name and founding; the copy is kept for it, as guard() does now. */
  var strayAt = 0; /* every refused save asks: look at most every 5 minutes */
  /* → 'left' (the copy went to its account, and the page reloads), 'none' (no other account holds it: the game then
     takes the nation as dissolved, game/edictum.html ownGone) or '' (not known: this account has a record again, the
     check failed, or one is under way); the answer stands for 5 minutes */
  var strayLast = '';
  E.strayCopy = async function () {
    var u = A.auth && A.auth.currentUser, n = localNation();
    if (A.leaving) return 'left';
    if (Date.now() - strayAt < 300000) return strayLast;
    if (!u || u.uid !== A.uid) return '';
    if (!n || !revision(n) || !num(n.founded)) return 'none';
    strayAt = Date.now(); strayLast = '';
    try {
      if ((await within(A.fs.doc('nations/' + u.uid).get(), 8000)).exists) { strayAt = 0; return ''; }
      var qs = await within(A.fs.collection('nations').where('name', '==', str(n.name, 80)).get(), 15000), own = null;
      qs.docs.forEach(function (d) {
        var x = d.id !== u.uid ? decode(d.ref.path, d.data()) : null;
        if (!own && isObj(x) && x.founded === n.founded) own = { id: d.id, rec: x };
      });
      if (A.leaving) return 'left';
      if (!own) { strayLast = 'none'; return 'none'; }
      /* the same revision, saved later than this copy's last change: then the account's record wins, and this
         copy is offered in the account menu instead */
      if (revision(own.rec) === revision(n) && num(own.rec.updatedAt) > num(n.updatedAt)) { n._rev = 0; L.set(LS_NATION, JSON.stringify(n)); }
      L.set('edictum.unsaved.' + u.uid, null); /* the refused saves' copies of it, older than the one kept */
      park(own.id);
      leave({ nation: null, uid: u.uid }, signedOut(n.name));
      strayLast = 'left'; return 'left';
    } catch (e) { strayAt = 0; return ''; /* asked again by a later refused save */ }
  };
  async function boot() {
    var fb = window.firebase, t0 = performance.now();
    if (!fb || typeof fb.initializeApp !== 'function' || typeof fb.auth !== 'function' || typeof fb.firestore !== 'function') return goOffline('the Firebase scripts did not load');
    var cfg = window.EDICTUM_FIREBASE_CONFIG || await fetchConfig();
    if (!isObj(cfg) || !cfg.apiKey || !cfg.projectId) return goOffline('there is no Firebase configuration');
    var t1 = performance.now();
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
    var t2 = performance.now(), fresh = false;
    A.rest = emu && emu.firestore ? 'http://' + String(emu.firestore) + '/v1' : 'https://firestore.googleapis.com/v1';
    A.fn = emu && emu.functions ? 'http://' + String(emu.functions) + '/' + A.projectId + '/' + FN_REGION : 'https://' + FN_REGION + '-' + A.projectId + '.cloudfunctions.net';
    /* opened from an emailed sign-in link: finish it once the page is up, and keep the code out of the address bar */
    var emailLink = '';
    try { if (auth.isSignInWithEmailLink(location.href)) { emailLink = location.href; history.replaceState(history.state, '', location.pathname + location.hash); } } catch (e) {}
    var user = null;
    try {
      user = await within(firstUser(auth), 10000);
      if (!user) { fresh = true; user = (await within(auth.signInAnonymously(), 15000)).user; }
    } catch (e) { return goOffline('anonymous sign-in failed', e); }
    if (!user) return goOffline('anonymous sign-in failed');
    var t3 = performance.now();
    if (await guard(user) || unpark(user)) return;
    L.set(LS_UID, user.uid); L.set(LS_OUT, null);
    A.uid = user.uid;
    try { await within(readClaims(user), 5000); } catch (e) { /* read again when the token changes */ }
    A.online = E.settle(apiFor(true));
    if (!A.online) { A.why = E.why || 'start-up took too long'; mount(); lateOnline(); return; }
    /* start-up in steps, from the moment the page was asked for: the page and the scripts (downloaded and run),
       waiting for the page, Firebase's configuration, starting Firebase, sign-in, and the account's checks */
    var t4 = performance.now();
    perfTrace('game_start', 0, t4, { script_ms: PF.shim, wait_ms: t0 - PF.shim, config_ms: t1 - t0, firebase_ms: t2 - t1, sign_in_ms: t3 - t2, account_ms: t4 - t3 },
      { account: linkedUser(user) ? 'linked' : 'guest', visit: fresh ? 'first' : 'returning' });
    auth.onIdTokenChanged(function (u) {
      if (A.leaving) return;
      if (!u || u.uid !== A.uid) { leave({}); return; } /* signed in or out in another tab */
      readClaims(u).then(paint, paint);
    });
    mount();
    PF.app = app; perfApply(); /* after start-up, which its download would only slow */
    if (emailLink) finishEmailLink(emailLink);
    else setTimeout(googleReturn, 0);
    setTimeout(supportCheck, 6000);
    /* and again every few minutes while a ticket waits, so a reply reaches a player who keeps the game open */
    setInterval(function () { if (!document.hidden) supportCheck(); }, 5 * 60000);
    setTimeout(bugsCheck, 7000);
    setTimeout(recoveryCheck, 1800);
    setTimeout(seenCheck, 4000);
    versionWatch();
  }
  /* the address this browser plays from, which the admins see when they inspect the nation and which expires
     90 days after it was last seen (functions/accounts.js, 'seen'; the privacy notice says so): once a page load */
  function seenCheck() { if (A.auth && A.auth.currentUser && !A.leaving && !A.frozen) call('accounts', { op: 'seen' }).catch(function () {}); }

  /* ───────── a newer build ───────── */
  /* An open tab keeps the build it loaded, for days on a phone, and an older build drops what it does not know
     of a newer one's records when it saves them (the tutorial's paid lists, say). build.py stamps the page with
     its build (meta edictum-build) and writes /version.json beside it. When the page comes back to the front
     after a while away, at most every VERSION_MIN, it asks whether that has changed; if so it sends the latest
     changes and reloads, unless the player is writing something, who is told instead and gets the new build
     the next time they come back. A page that stays in front asks every VERSION_EVERY and only tells. */
  var VERSION_URL = '/version.json';
  function msOr(v, def) { v = Number(v); return v >= 0 ? v : def; } /* the tests shorten these */
  var VERSION_AWAY = msOr(window.EDICTUM_VERSION_AWAY, 30000);
  var VERSION_MIN = msOr(window.EDICTUM_VERSION_MIN, 5 * 60000);
  var VERSION_EVERY = 30 * 60000;
  var V = { build: '', at: 0, hiddenAt: 0, busy: false, next: '', told: '' };
  /* a field the player has typed into since the page drew it, or is typing in now */
  function typing() {
    var plain = /^(button|submit|reset|image|checkbox|radio|range|color|file|hidden)$/;
    var a = document.activeElement;
    if (a && (a.isContentEditable || a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && !plain.test(a.type)))) return true;
    return Array.prototype.some.call(document.querySelectorAll('textarea, input'), function (el) { return !plain.test(el.type) && el.value !== el.defaultValue; });
  }
  function versionTell() {
    if (V.told === V.next) return;
    V.told = V.next;
    toast('A new version of Edictum is out. It loads the next time you come back to this tab, or reload the page now.');
  }
  async function versionCheck(back) {
    if (!V.build || V.busy || A.leaving || A.frozen || navigator.onLine === false) return;
    if (!V.next) {
      if (Date.now() - V.at < VERSION_MIN) return;
      V.busy = true; V.at = Date.now();
      try {
        var r = await within(fetch(VERSION_URL, { cache: 'no-store' }), 10000), v = r.ok ? await r.json() : null;
        if (v && typeof v.b === 'string' && /^[0-9a-f]{6,64}$/.test(v.b) && v.b !== V.build) V.next = v.b;
      } catch (e) { /* asked again next time */ } finally { V.busy = false; }
      if (!V.next) return;
    }
    if (!back) { versionTell(); return; }
    /* the game's drafts (a message, a resolution, a history) live only in the page */
    var keep = function () { return document.hidden || typing() || ui.busy || (ui.dlg && ui.dlg.open) || (typeof E.keepPage === 'function' && E.keepPage()); };
    if (keep()) { versionTell(); return; }
    V.busy = true;
    try { if (typeof E.flushSaves === 'function') await within(E.flushSaves(), 15000); } catch (e) {} finally { V.busy = false; }
    if (A.leaving || keep() || E.syncStatus === 'saving') { versionTell(); return; }
    leave({}, 'Edictum was updated while you were away, so the page has loaded the new version. Your nation is as you left it.');
  }
  function versionWatch() {
    var m = document.querySelector('meta[name="edictum-build"]'), b = m ? m.getAttribute('content') || '' : '';
    if (!/^[0-9a-f]{6,64}$/.test(b)) return; /* not a page build.py made */
    V.build = b; V.at = Date.now();
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) { V.hiddenAt = Date.now(); return; }
      var away = V.hiddenAt ? Date.now() - V.hiddenAt : 0;
      V.hiddenAt = 0;
      if (away >= VERSION_AWAY) versionCheck(true);
    });
    setInterval(function () { if (!document.hidden) versionCheck(false); }, VERSION_EVERY);
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
  /* the sign-in this browser last used (LS_LAST: 'google' | 'discord' | 'email'): a returning guest sees it first */
  var LS_LAST = 'edictum.lastSignIn';
  function lastSignIn() { var v = L.get(LS_LAST); return v === 'google' || v === 'discord' || v === 'email' ? v : ''; }
  function noteSignIn(what) { var a = /google/i.test(what) ? 'google' : /discord/i.test(what) ? 'discord' : /email/i.test(what) ? 'email' : ''; if (a) L.set(LS_LAST, a); }
  function linkingButtons(u) {
    var guest = !linkedUser(u), last = guest ? lastSignIn() : '';
    var opts = LINK_OPTIONS.filter(function (o) { return !hasProvider(u, o.provider); });
    if (last) opts.sort(function (a, b) { return (b.action === last) - (a.action === last); });
    return opts.map(function (o) {
      return '<button type="button" class="btn ed-signin ed-signin-' + o.action + (guest ? '' : ' ghost') + '" data-ed="' + o.action + '"><span class="ed-mark ed-mark-' + o.action + '">' + MARKS[o.action] + '</span><span>' +
        esc((guest ? 'Continue with ' : 'Add ') + o.name) + '</span>' + (o.action === last ? '<span class="ed-last">Last used</span>' : '') + '</button>';
    }).join('');
  }
  /* in-app browsers (Discord, Instagram, Facebook, X, TikTok, Snapchat, Line, Android WebView) block Google's sign-in
     and often pop-ups: such a visitor is told to open the game in their own browser */
  function webview() { return /FBAN|FBAV|Instagram|Discord|Twitter|TikTok|musical_ly|Snapchat|Line\/|; wv\)|GSA\//i.test(navigator.userAgent || ''); }
  function phoneLike() { return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '') || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent || '')); }
  function webviewNote() {
    return webview() ? '<div class="ed-web" role="note"><p><b>You are in an in-app browser.</b> Google and Discord often refuse to sign in here. Open Edictum in Safari or Chrome instead: use the app\'s menu (⋯) and choose Open in browser, or copy the link.</p><div class="ed-row"><button type="button" class="btn ghost small" data-ed="copy-url">Copy the link</button></div></div>' : '';
  }
  /* what linking gives, and what it never does: said beside the buttons */
  var PERKS = '<ul class="ed-perks"><li>Play the same nation on your phone and computer</li><li>Keep it safe if this browser is cleared</li><li>Vote in the Assembly, post on the boards and found alliances</li></ul>';
  var TRUST = '<p class="ed-fine ed-trust">We never post anything for you or see your password. <a href="/privacy" target="_blank" rel="noopener">Privacy</a> · <a href="/terms" target="_blank" rel="noopener">Terms</a></p>';
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
    var state = observing() ? 'observing' : !A.online || navigator.onLine === false ? 'offline' : E.syncStatus || 'saving';
    var labels = { synced: 'Synced', saving: 'Saving', offline: 'Offline', observing: 'Read-only' };
    var tips = { synced: 'Your latest changes are saved online.', saving: 'Your latest changes are waiting for server confirmation.',
      offline: 'Your nation is saved in this browser. Reconnect or reload to sync.', observing: 'You are observing a region: nothing is saved in this tab.' };
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
    /* an observing tab saves nothing, so it has no save health to report */
    if (healthTimer || !A.online || A.frozen || A.leaving || observing() || !A.auth.currentUser || !localNation()) return;
    healthTimer = setTimeout(function () {
      healthTimer = 0;
      if (!navigator.onLine || A.frozen || A.leaving) return;
      var n = localNation(), h = E.saveHealth;
      if (!n || !h) return;
      healthLast = performance.now();
      var report = { uid: A.uid, reg: str(n.reg, 40) || 'meridian',
        device: /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) ? 'Mobile' : 'Desktop', status: E.syncStatus || 'saving',
        revision: revision(n), pending: !!n._dirty, error: str(h.error, 64), conflicts: Math.min(1000000, num(h.conflicts)), pg: (location.hash || '').slice(1).split('/')[0].toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40),
        t: serverTime(), expiresAt: A.fb.firestore.Timestamp.fromMillis(Date.now() + 7 * 86400000)
      };
      /* the player chose not to show the region when they are online (Settings › Account, the game's dmx.on):
         the server then leaves them out of who is online (functions/presence.js) */
      if (isObj(n.dmx) && n.dmx.on === 0) report.ho = true;
      A.fs.doc('saveHealth/' + A.uid + '_' + healthSession).set(report).catch(function () { /* diagnostics must never interfere with saving the nation */ });
    }, Math.max(250, healthLast + 15000 - performance.now()));
  }
  window.addEventListener('edictum:sync', healthSoon);
  /* the admin Online players page shows which page each player is on */
  window.addEventListener('hashchange', healthSoon);
  setInterval(function () { if (!document.hidden) healthSoon(); }, 60000);
  window.addEventListener('online', paintSync);
  window.addEventListener('offline', paintSync);
  function paint() {
    if (!ui.btn) return;
    var w = who(), head = ui.box.classList.contains('ed-head'), k, v;
    ui.box.dataset.kind = w.kind;
    if (w.kind === 'linked') { k = head ? 'Signed in' : 'Registered Nation'; v = w.email || w.discord || w.name || 'Your account'; }
    else if (w.kind === 'guest') { k = head ? 'Already rule a nation?' : 'Guest Nation'; v = head ? 'Sign in to continue' : (localNation() ? 'Clearing this browser can lose it' : 'Keep your nation on every device'); }
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
  /* the game's Settings › Account › Danger zone opens the panel at its delete step; where that step is not offered
     (offline, no nation) the panel opens as usual */
  E.openAccount = function (view) {
    if (!ui.box) return false;
    open(view === 'delete' && who().kind !== 'local' && localNation() ? 'delete' : 'main');
    return true;
  };
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
        row('<button type="button" class="btn ghost" data-ed="recovery-copy">Copy code</button><button type="button" class="btn ghost" data-ed="recovery-download">Download code</button>' +
          (ui.rcMail ? '' : '<button type="button" class="btn ghost" data-ed="recovery-mail-open">Email code</button>')) +
        /* the code by email (functions/mail.js, recoveryMail): sent once, with no copy of it or the address kept */
        (ui.rcMail ? '<div class="ed-rcmail"><label class="ed-lbl2" for="ed-rc-email">Email the code to</label>' +
          '<input class="input" id="ed-rc-email" type="email" maxlength="200" autocomplete="email" spellcheck="false" data-enter="recovery-mail" value="' + esc(ui.rcEmail || '') + '">' +
          '<p class="ed-fine">We send it once and keep neither the code nor the address. Anyone who can read that inbox can take over your nation.</p>' +
          row('<button type="button" class="btn ghost" data-ed="recovery-mail">' + (ui.rcMailed ? 'Send it again' : 'Send the code') + '</button>') + '</div>' : '') +
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
        '<p>We sent a sign-in link to <b>' + esc(ui.email) + '</b>. Open it <b>in this browser</b> to finish.</p>' +
        '<ul class="ed-perks"><li>It can take a minute or two to arrive.</li><li>Not there? Look in your spam or promotions folder for a message from Edictum.</li><li>Each link works once and expires after a while.</li>' +
        (ui.emailKeeps ? '<li>If your email app opens links in its own browser, copy the link into this one instead.</li>' : '') + '</ul>' +
        row('<button type="button" class="btn" data-ed="close" data-autofocus>Done</button><button type="button" class="btn ghost" data-ed="email-resend" id="ed-resend"' + (resendLeft() ? ' disabled' : '') + '>' + resendLabel() + '</button>') +
        row('<button type="button" class="linkish" data-ed="email">Wrong address? Use another one</button>');
    } else if (ui.view === 'email-finish') {
      h = '<p class="eyebrow">Your account</p><h2 class="ed-h" id="ed-dlg-h">Which address was the link sent to?</h2>' +
        '<p>It looks like you opened the link on a different browser or device from the one that asked for it (or this browser\'s data was cleared since). That is fine: type the address the link was sent to, and you are signed in <b>here</b>. Nobody else can finish a sign-in with your link that way.</p>' +
        '<label class="ed-lbl2" for="ed-email">Email address</label><input class="input" id="ed-email" type="email" maxlength="200" autocomplete="email" spellcheck="false" data-enter="email-finish" data-autofocus>' +
        row('<button type="button" class="btn" data-ed="email-finish">Sign in here</button><button type="button" class="btn ghost" data-ed="close">Cancel</button>') +
        '<p class="ed-fine">Meant to sign in on the other device? Open the link there instead. Or <button type="button" class="linkish" data-ed="email">send a new link to use on this one</button>.</p>';
    } else if (ui.view === 'email-elsewhere') {
      h = '<p class="eyebrow">Your account</p><h2 class="ed-h" id="ed-dlg-h">Open this link where your nation is</h2>' +
        '<p>This link keeps a nation with your email address, and that nation is in another browser' + (webview() ? ' (this looks like your email app\'s own browser)' : '') + '. Used here, it would start a separate, empty account instead, so nothing has changed yet.</p>' +
        '<p>Copy the link and paste it into the address bar of the browser where you play. It still works, once.</p>' +
        '<label class="ed-lbl2" for="ed-link">Your sign-in link</label><input class="input" id="ed-link" readonly spellcheck="false" value="' + esc(ui.emailLink || '') + '">' +
        row('<button type="button" class="btn" data-ed="link-copy" data-autofocus>Copy the link</button><button type="button" class="btn ghost" data-ed="close">Close</button>');
    } else if (ui.view === 'report' && ui.report) {
      var r = ui.report, post = r.kind === 'post' || r.kind === 'letter' || r.kind === 'chat', reasons = REASONS.filter(function (x) { return post ? x[0] !== 'name' && x[0] !== 'cheating' : true; });
      h = '<p class="eyebrow">Report</p><h2 class="ed-h" id="ed-dlg-h">' + (r.kind === 'letter' ? 'Report this letter?' : r.kind === 'chat' ? 'Report this chat message?' : post ? 'Report this post?' : 'Report ' + quoted(r.name) + '?') + '</h2>' +
        (post ? '<blockquote class="ed-quote">' + esc(str(r.x, 400)) + '</blockquote>' : '') +
        '<fieldset class="ed-reasons"><legend>What is wrong?</legend>' + reasons.map(function (x, i) {
          return '<label><input type="radio" name="ed-reason" value="' + x[0] + '"' + (i ? '' : ' checked data-autofocus') + '> ' + esc(post && x[0] === 'content' ? (r.kind === 'letter' ? 'An offensive letter' : r.kind === 'chat' ? 'An offensive message' : 'An offensive post') : x[1]) + '</label>';
        }).join('') + '</fieldset>' +
        '<label class="ed-lbl2" for="ed-note">Anything else the moderators should know? (optional)</label><textarea class="input" id="ed-note" rows="3" maxlength="300"></textarea>' +
        '<p class="ed-fine">Reports go to the game\'s moderators, not to the player' + (r.kind === 'letter' ? ', with the letter, so they can read it' : r.kind === 'chat' ? ', with the message, so they can read it' : '') + '. You can send one every 30 seconds.</p>' +
        row('<button type="button" class="btn" data-ed="report-yes">Send report</button><button type="button" class="btn ghost" data-ed="close">Cancel</button>');
    } else if (ui.view === 'support' && ui.support) {
      h = '<p class="eyebrow">Support</p><h2 class="ed-h" id="ed-dlg-h">Create a support ticket</h2>' +
        '<fieldset class="ed-reasons"><legend>What is it about?</legend>' + TOPICS.map(function (x, i) {
          return '<label><input type="radio" name="ed-topic" value="' + x[0] + '"' + (i ? '' : ' checked data-autofocus') + '> ' + esc(x[1]) + '</label>';
        }).join('') + '</fieldset>' +
        '<label class="ed-lbl2" for="ed-sup-x">What happened, or what would you like to know?</label><textarea class="input" id="ed-sup-x" rows="6" maxlength="2000"></textarea>' +
        '<label class="ed-lbl2" for="ed-sup-mail">Email address (optional, if you would like the answer by email too)</label><input class="input" id="ed-sup-mail" type="email" maxlength="200" autocomplete="email">' +
        '<p class="ed-fine">The team replies on the Help page, and you can write back there until your question is settled. The ticket includes your player ID and your nation\'s name, and only you and the game\'s team can read it. You can send one ticket a minute. <a href="/privacy" target="_blank" rel="noopener">Privacy</a></p>' +
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
          (n ? '<p>' + nm + ' is a Guest Nation, tied to this browser: <b>if its data is cleared, the nation can be lost</b>. Link a sign-in to become a Registered Nation.</p>' + PERKS + '<p class="ed-fine">Assembly voting also needs a nation at least 24 hours old.</p>'
             : '<p>If your nation is linked to Google, Discord or an email address, sign in with it to carry on here. New to Edictum? Close this and found a nation on this page; you can link a sign-in whenever you like.</p>') +
          webviewNote() + row(linkingButtons(A.auth.currentUser)) + TRUST +
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
      if (GA.id) h += '<p class="ed-fine ed-stats-set">Visit statistics (Google Analytics and Firebase speed): ' + (statsChoice() === 'y' ? 'allowed. <button type="button" class="linkish" data-ed="stats-n">Turn off</button>' : 'off. <button type="button" class="linkish" data-ed="stats-y">Allow</button>') + '</p>';
      if (w.kind !== 'guest') h += '<p class="ed-fine ed-legal"><a href="/privacy" target="_blank" rel="noopener">Privacy</a> · <a href="/terms" target="_blank" rel="noopener">Terms</a></p>';
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
    if (a === 'recovery-mail-open') { ui.rcMail = true; setMsg(''); draw(); var mi = ui.dlg.querySelector('#ed-rc-email'); if (mi) mi.focus(); return; }
    if (a === 'recovery-mail') { mailRecovery(); return; }
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
    if (a === 'email-resend') { if (!resendLeft() && ui.email) sendLinkTo(ui.email, ui.emailMode).then(function () { setMsg('Sent again. Use the newest link.'); }, function () {}); return; }
    if (a === 'copy-url') { var url = location.origin + location.pathname; try { navigator.clipboard.writeText(url).then(function () { setMsg('Link copied. Paste it into Safari or Chrome.'); }, function () { setMsg(url); }); } catch (e) { setMsg(url); } return; }
    if (a === 'email-finish') { var typed = ui.dlg.querySelector('#ed-email'); finishEmailLink(ui.emailLink, typed ? typed.value.trim() : ''); return; }
    if (a === 'link-copy') {
      var lk = ui.emailLink || '', field = ui.dlg.querySelector('#ed-link');
      var by = function () { if (field) { field.focus(); field.select(); } setMsg('Select the link above and copy it.', true); };
      try { navigator.clipboard.writeText(lk).then(function () { setMsg('Link copied. Paste it into the browser where you play.'); }, by); } catch (e) { by(); }
      return;
    }
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
  /* the recovery code shown now, emailed to an address the player types: the server sends only this account's current
     code (functions/mail.js, recoveryMail), and the letter names no nation */
  async function mailRecovery() {
    var code = pendingRecoveryCode(), input = ui.dlg && ui.dlg.querySelector('#ed-rc-email'), email = input ? input.value.trim() : '';
    if (!code || ui.busy) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) { setMsg(authMessage({ code: 'auth/invalid-email' }), true); if (input) input.focus(); return; }
    ui.rcEmail = email;
    setBusy('Sending your code…');
    try {
      await call('accounts', { op: 'recoveryMail', email: email, code: code });
      setBusy(''); ui.rcMailed = true; draw();
      setMsg('Sent to ' + email + '. It can take a minute or two to arrive: look in spam too. Keep the letter private.');
    } catch (e) { setBusy(''); setMsg(e.message || 'The code could not be sent. Try again in a while.', true); }
  }
  function clearRecovery(uid) { recoveryEpoch++;L.set('edictum.recovery.pending.'+uid,null);L.set('edictum.recovery.rotation.'+uid,null);if(uid===A.uid){ui.recoveryCode='';ui.rcMail=false;ui.rcMailed=false;} }
  async function finishRecoveryRotation(uid, intent, epoch) {
    await call('accounts',{op:'regenerate',code:intent.code,version:intent.version});
    if(epoch!==recoveryEpoch||A.uid!==uid||linkedUser(A.auth.currentUser)||A.leaving)return false;
    ui.recoveryCode=intent.code;ui.rcMailed=false;
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
    var doc = { by: u.uid, kind: r.kind === 'post' || r.kind === 'letter' ? r.kind : r.kind === 'chat' ? 'post' : 'nation', target: str(r.target, 128), reg: str(r.reg, 40), reason: pick ? pick.value : 'other', t: serverTime() };
    if ((r.kind === 'post' || r.kind === 'letter' || r.kind === 'chat') && r.post) doc.post = str(r.post, r.kind === 'letter' ? 200 : 64);
    if (note && note.value.trim()) doc.note = note.value.trim().slice(0, 300);
    if (r.name) doc.name = str(r.name, 160);
    if (r.x) doc.x = str(r.x, r.kind === 'letter' ? 2500 : 600);
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
      setBusy(''); ui.dlg.close(); toast('Your ticket is with the Edictum team. Their reply will appear on the Help page, where you can write back.');
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
      /* a Chancery Club membership is cancelled before anything is deleted, so none goes on billing a lost account */
      await call('accounts', { op: 'shop', step: 'closing' });
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
      /* letters written by the player and to them */
      var sent = await within(A.fs.collection('letters').where('by', '==', u.uid).get(), 15000), got = await within(A.fs.collection('letters').where('to', '==', u.uid).get(), 15000);
      var mine = await within(Promise.all([A.fs.collection('lblock').where('b', '==', u.uid).get(), A.fs.collection('lseen').where('r', '==', u.uid).get()]), 15000);
      var letters = sent.docs.concat(got.docs, mine[0].docs, mine[1].docs);
      for (var q = 0; q < letters.length; q += 400) {
        var bl = A.fs.batch(); letters.slice(q, q + 400).forEach(function (d) { bl.delete(d.ref); }); await bl.commit();
      }
      /* bug reports, with their screenshots: a batch holds 200 of them */
      var bugs = await within(A.fs.collection('bugs').where('by', '==', u.uid).get(), 15000);
      for (var m = 0; m < bugs.docs.length; m += 200) {
        var bb = A.fs.batch();
        bugs.docs.slice(m, m + 200).forEach(function (d) { bb.delete(d.ref); if (d.get('img') === true) bb.delete(A.fs.doc('bugImg/' + d.id)); });
        await bb.commit();
      }
      var b = A.fs.batch();
      /* the pacing documents (limits/, rlimits/, slimits/, blimits/) are the server's to remove with the account */
      ['nations/', 'nationx/', 'nationp/', 'summaries/', 'space/', 'staff/', 'presence/'].forEach(function (c) { b.delete(A.fs.doc(c + u.uid)); });
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
    L.set(LS_SUP, null); L.set(LS_SUP_SEEN, null); L.set(LS_SUP_TOLD, null); L.set(LS_SUP_NEW, null); L.set(LS_BUG, null); L.set(LS_BUG_SEEN, null); L.set('edictum.unsaved.' + u.uid, null); L.set('edictum.emailLinked.' + u.uid, null); clearRecovery(u.uid);
    try { await call('accounts', { op: 'close' }); await A.auth.signOut(); }
    catch (e) { try { await u.delete(); } catch (e2) { try { await A.auth.signOut(); } catch (e3) {} } }
    leave({ nation: null, uid: '-' }, 'Your nation and account have been deleted. This browser starts again as a new guest.');
  }

  /* ───────── linking a sign-in: Google, Discord, an email link ───────── */
  function authMessage(e) {
    var c = String((e && e.code) || '');
    if (c === 'auth/popup-closed-by-user' || c === 'auth/cancelled-popup-request' || c === 'auth/user-cancelled') return 'Sign-in was cancelled.';
    if (c === 'auth/popup-blocked') return webview() ? 'This in-app browser blocked the sign-in window. Open Edictum in Safari or Chrome and sign in there.' : 'Your browser blocked the sign-in window. Tap the button again, or allow pop-ups for this site.';
    if (c === 'auth/account-exists-with-different-credential') return 'That email address already belongs to an Edictum nation that signs in another way. Sign in the way you used before' + (lastSignIn() ? ' (this browser last used ' + ({ google: 'Google', discord: 'Discord', email: 'an email link' })[lastSignIn()] + ')' : '') + '.';
    if (c === 'auth/timeout') return 'The sign-in took too long. Try again.';
    if (c === 'auth/internal-error') return webview() ? 'Sign-in does not work in this in-app browser. Open Edictum in Safari or Chrome.' : 'Something went wrong on the sign-in side. Try again in a moment.';
    if (c === 'auth/requires-recent-login') return 'For your safety, sign in again first, then try once more.';
    if (c === 'auth/missing-or-invalid-nonce' || c === 'auth/invalid-credential') return 'That sign-in could not be checked. Try again.';
    if (c === 'auth/redirect-cancelled-by-user' || c === 'auth/redirect-operation-pending') return 'Sign-in was cancelled.';
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
    noteSignIn(what);
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
    /* a guest about to switch: its carry key is noted now, should none of its saves have sent it yet */
    var me = A.auth.currentUser;
    if (me && localNation()) call('civic', { op: 'carryKey', ck: carryKey(me.uid) }).catch(function () {});
    ui.view = 'switch'; setMsg(''); draw();
  }

  function provider() { var p = new A.fb.auth.GoogleAuthProvider(); p.setCustomParameters({ prompt: 'select_account' }); return p; }
  function google() {
    var u = A.auth && A.auth.currentUser;
    if (!u || hasProvider(u, 'google.com')) return;
    setBusy('Waiting for Google…');
    /* a phone (where pop-ups open as tabs that often lose their way back) goes to Google and back instead */
    if (phoneLike() && !webview()) { googleRedirect(u); return; }
    u.linkWithPopup(provider()).then(function () {
      var g = (u.providerData || []).filter(function (p) { return p.providerId === 'google.com'; })[0];
      linkedNow(u, 'Google account', g && g.email);
    }, function (e) {
      if (e && e.code === 'auth/credential-already-in-use') {
        var cred = e.credential || null;
        otherAccount({ what: 'Google account', ready: !!cred, signIn: function () { return cred ? A.auth.signInWithCredential(cred) : A.auth.signInWithPopup(provider()); } });
        return;
      }
      if (e && e.code === 'auth/popup-blocked' && !webview()) { googleRedirect(u); return; }
      setBusy('');
      setMsg(authMessage(e), true);
    });
  }
  /* SS_GREDIR marks a redirect under way; googleReturn() finishes it once the page is back */
  var SS_GREDIR = 'edictum.gredir';
  function googleRedirect(u) {
    var flush = E.flushSaves;
    Promise.resolve(typeof flush === 'function' ? flush() : null).catch(function () {}).then(function () {
      SS.set(SS_GREDIR, '1');
      return u.linkWithRedirect(provider());
    }).catch(function (e) { SS.set(SS_GREDIR, null); setBusy(''); setMsg(authMessage(e), true); });
  }
  function googleReturn() {
    if (!SS.get(SS_GREDIR)) return;
    SS.set(SS_GREDIR, null);
    A.auth.getRedirectResult().then(function (res) {
      var u = res && res.user;
      if (!u) return;
      open('main');
      var g = (u.providerData || []).filter(function (p) { return p.providerId === 'google.com'; })[0];
      linkedNow(u, 'Google account', g && g.email);
    }, function (e) {
      open('main');
      if (e && e.code === 'auth/credential-already-in-use') {
        var cred = e.credential || null;
        otherAccount({ what: 'Google account', ready: !!cred, signIn: function () { return cred ? A.auth.signInWithCredential(cred) : A.auth.signInWithPopup(provider()); } });
        return;
      }
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
  /* a resend waits a minute after each send, counted down on its button */
  var RESEND_MS = 60000, resendTimer = 0;
  function resendLeft() { return Math.max(0, Math.ceil(((ui.sentAt || 0) + RESEND_MS - Date.now()) / 1000)); }
  function resendLabel() { var s = resendLeft(); return s ? 'Resend in ' + s + ' s' : 'Resend the link'; }
  function resendTick() {
    clearInterval(resendTimer);
    resendTimer = setInterval(function () {
      var b = ui.inn && ui.inn.querySelector('#ed-resend');
      if (!b || ui.view !== 'email-sent') { clearInterval(resendTimer); return; }
      b.textContent = resendLabel(); b.disabled = !!ui.busy || resendLeft() > 0;
      if (!resendLeft()) clearInterval(resendTimer);
    }, 1000);
  }
  /* A link that is to keep something (a guest's nation, or a Registered Nation adding the address) names the account
     that asked for it, as a short tag in the page address it comes back to (?elk=). Opened in another browser, such
     as an email app's own, it would otherwise sign in there and make a separate, empty account for the address: the
     nation it was meant to keep stays a guest in the first browser (finishEmailLink sends the player back there). A
     plain sign-in, from a guest without a nation, carries no tag and works in any browser. The tag is no secret and
     proves nothing: it only tells the two cases apart. */
  function linkTag(uid) {
    var h = 0x811c9dc5, s = String(uid || '');
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return ('0000000' + h.toString(16)).slice(-8);
  }
  /* the tag a link carries: in the address itself, or in the continue URL Firebase nests in it */
  function linkTagOf(href) {
    for (var depth = 0; href && depth < 4; depth++) {
      var q;
      try { q = new URL(href, location.origin).searchParams; } catch (e) { return ''; }
      var t = q.get('elk');
      if (t && /^[0-9a-f]{8}$/.test(t)) return t;
      href = q.get('continueUrl') || q.get('link') || q.get('deep_link_id') || '';
    }
    return '';
  }
  function sendLinkTo(email, mode) {
    setBusy('Sending the link…');
    var u = A.auth.currentUser, tag = u && (linkedUser(u) || localNation()) ? linkTag(u.uid) : '';
    return A.auth.sendSignInLinkToEmail(email, { url: location.origin + location.pathname + (tag ? '?elk=' + tag : ''), handleCodeInApp: true }).then(function () {
      ui.sentAt = Date.now(); setTimeout(resendTick, 0);
      L.set(LS_EMAIL, JSON.stringify({ email: email, mode: mode || '' }));
      ui.email = email; ui.emailMode = mode || ''; ui.emailKeeps = !!tag; setBusy(''); ui.view = 'email-sent'; setMsg(''); draw();
    }, function (e) { setBusy(''); setMsg(authMessage(e), true); throw e; });
  }
  function sendEmailLink() {
    var input = ui.dlg.querySelector('#ed-email'), email = input ? input.value.trim() : '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) { setMsg(authMessage({ code: 'auth/invalid-email' }), true); if (input) input.focus(); return; }
    sendLinkTo(email, ui.emailMode).catch(function () {});
  }
  async function finishEmailLink(href, typed) {
    var pending = parse(L.get(LS_EMAIL)), email = typed || (isObj(pending) && typeof pending.email === 'string' ? pending.email : '');
    var u = A.auth.currentUser, mode = isObj(pending) && !typed ? pending.mode : '', tag = linkTagOf(href);
    ui.emailLink = href;
    /* a link asked for by another account, to keep its nation: used here it would make a separate account, so the
       player is sent back to the browser that asked for it, with the link to paste there (it is still unused) */
    if (tag && u && tag !== linkTag(u.uid)) { open('email-elsewhere'); return; }
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
        await within(dropNation(anon.uid, 'switch'), 14000).then(function () { cleared = true; }, function () {});
      }
      res = await sw.signIn();
    } catch (e) {
      /* the guest's region copy went before the sign-in: it goes back (asked twice; a refusal as another device's save means
         the first one landed after all). The game then saves on from the revision the region holds: 1 once it is back,
         or 0, a new record at its next save, when it could not be put back now (game/edictum.html, reviseOwn) */
      var back = -1;
      if (cleared && guest && anon) {
        guest._rev = 0;
        for (var tr = 0; tr < 2 && back < 0; tr++) {
          try { await within(saveNation(anon.uid, guest), 10000); back = 1; } catch (e2) { if (e2 && e2.code === 'save_conflict') back = 1; }
        }
        if (back < 0) back = 0;
      }
      A.frozen = false; A.leaving = false; A.sw = null; setBusy('');
      if (back >= 0 && typeof E.reviseOwn === 'function') { try { E.reviseOwn(back); } catch (e3) {} }
      /* an email link used up (by the attempt to link it here, which Firebase counts as its one use) or
         expired: a fresh one, which goes straight to switching */
      if (sw.email && (e.code === 'auth/invalid-action-code' || e.code === 'auth/expired-action-code')) {
        sendLinkTo(sw.email, 'switch').then(function () { setMsg('That link could only be used once, so we sent a new one. Open it to switch.'); }, function () {});
        return;
      }
      setMsg(authMessage(e) + (back === 0 ? ' “' + guest.name + '” is kept in this browser and goes back to the region with its next save.' : ''), true);
      return;
    }
    var nu = res && res.user, has = true, known = false, name = '';
    noteSignIn(sw.what);
    if (!nu) { leave({ nation: null, uid: '-' }); return; }
    /* does that account hold a nation? asked twice: a slow phone link can miss the first answer */
    for (var tries = 0; tries < 2 && !known; tries++) {
      try { var s = await within(A.fs.doc('nations/' + nu.uid).get(), tries ? 15000 : 8000); has = s.exists; known = true; if (has) name = str((s.data() || {}).name, 80); } catch (e) { /* asked again, then unknown */ }
    }
    /* Still unknown, with a guest nation whose region copy may already be gone (dropped above): it must not be
       wiped on a guess. It comes along as an unsaved copy at revision 0, and the game weighs it against the
       account's record at load: a nation the account already holds is newer and loads (this copy goes to the
       account menu, as the switch dialog promised); with none, this one is saved as the account's. */
    if (!known && guest) {
      guest._rev = 0; guest._dirty = true;
      if (anon && anon.uid !== nu.uid) L.set(LS_CARRY, JSON.stringify({ from: anon.uid, to: nu.uid, at: Date.now(), k: heldCarryKey(anon.uid) }));
      var carried = JSON.stringify(guest);
      L.set(LS_NATION, carried);
      leave({ nation: carried, uid: nu.uid }, 'Signed in with ' + via + '. “' + guest.name + '” came with you: if this ' + sw.what + ' already held a nation, that one loads and “' + guest.name + '” is kept in your account menu.');
      return;
    }
    if (has) {
      SS.set('edictum.wb', '1'); /* the game greets the player with what waited for them */
      leave({ nation: null, uid: '-' }, name ? 'Signed in with ' + via + '. Welcome back to “' + name + '”.' : 'Signed in with ' + via + '.');
    } else if (guest) {
      guest._rev = 0;
      if (anon && anon.uid !== nu.uid) L.set(LS_CARRY, JSON.stringify({ from: anon.uid, to: nu.uid, at: Date.now(), k: heldCarryKey(anon.uid) }));
      var moved = JSON.stringify(guest);
      L.set(LS_NATION, moved);
      /* the copy goes back on pagehide too, should the game save it again (with the guest's revision) before the reload */
      leave({ nation: moved, uid: nu.uid }, 'Signed in with ' + via + '. “' + guest.name + '” now lives in your ' + sw.what + '.');
    } else {
      leave({ uid: nu.uid }, 'Signed in with ' + via + '. The nation you found here will be kept with your account.');
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
      /* 'kept': no save could go from here (view-only, maintenance), and the latest changes wait in this browser */
      var kept = n && typeof E.beforeSignOut === 'function' ? await within(E.beforeSignOut(), 25000) : '';
      A.leaving = true; A.frozen = true;
      await A.auth.signOut();
      if (guest) clearRecovery(uid);
      L.set(LS_OUT, uid);
      var note = kept === 'kept' ? ' Your latest changes could not reach the region from here: they are kept in this browser, in the account menu once you sign in again.' : '';
      leave({ nation: null, uid: '-' }, (guest ? 'Signed out. Use your recovery code to sign back in to your Guest Nation.' : 'Signed out. Sign in with your linked account to continue your nation.') + note);
    } catch(e) { A.leaving = false; A.frozen = false; setBusy(''); setMsg(e.message || 'Sign-out could not finish. Try again.', true); }
  }

  var started = new Promise(function (r) { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', r, { once: true }); else r(); });
  started.then(boot).catch(function (e) { goOffline('start-up failed', e); });
})();
