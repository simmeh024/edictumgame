import { HttpsError } from 'firebase-functions/v2/https';
import { FieldValue, FieldPath, Timestamp } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { eligibility, refuse } from './eligibility.js';
import { pushChatMention } from './letters.js';
import DATA from './civic-data.json' with { type: 'json' };

/* Region chat: one live channel per region, where the region's nations talk in short lines. Written only here (civic
   ops rcPost, rcDelete), so every line carries the author the server knows; read only by the region's own nations and
   admins (firestore.rules).
     rchat/{reg}/chat/{id}   a line {a, nm, x, t, exp, st?}: the author's uid and nation name as it was, the words, the
                             server's time (ms), when Firestore's time-to-live policy may delete it (exp, RC_KEEP on)
                             and an Edictum staff mark (st 'admin' or 'mod')
     rcPace/{uid}            {p, h}: the times of the player's lines in the last hour and a hash of their last words,
                             server-only
   The lines are a 'chat' collection with the author in `a`, as the alliance channels are, so deleting an account or an
   admin removing or banning a nation takes them too (functions/accounts.js, functions/admin.js).
   Any nation writes in its own region's chat: a Registered Nation RC_HOUR lines an hour, a guest RC_GUEST_HOUR. Blocking a nation (lblock, Letters) hides
   its lines in the blocker's game; the author is not told. A reported line is a 'post' report rc:<reg>:<id>, which the
   admin portal removes (functions/admin.js, delete_post).
   Staff (an admin or mod claim) also, from the admin portal's Region chats page or a line's menu:
     - write in any region's chat as the Edictum team (rcPost team: a line {tm: true, nm 'Edictum team', a: the staff
       member's uid}), which needs no nation there;
     - silence a player (rcMute: rcMute/{uid} {until, perm?, amb?, why, by, t, nm, reg}), for an hour, a day, a week, 30 days
       or until lifted, optionally removing their lines of the last 24 hours in that region; rcPost refuses a silenced
       player, who reads their own silence (firestore.rules) and sees it in place of the writing box; admins read every
       one. rcUnmute lifts it. Both are in the audit log; staff cannot be silenced.
   An Edictum Ambassador (claim amb, functions/admin.js setAmb) may silence a player too (marked amb, so the player is
   told an ambassador did it), the same way, but takes no lines
   with it (no wipe), cannot silence another ambassador, and lifts nothing: rcUnmute stays with staff.
   A line may answer another line of the same chat (re: it keeps r {id, a, nm, x} with a few of its words) and @mention
   up to RC_MN nations of the region (mn: the ids the writer's game picked; the server keeps those whose saved name
   follows an @ in the words, who have not blocked the writer, as mn {uid: name}). Each one mentioned, and the author of
   the line answered, gets mentions/{uid}/m/{id} {k: 'chat', by, nm, reg, rc, x, t, rp?} for their bell, and a push
   notification when they are not in the game (functions/letters.js, pushChatMention). Reactions (rcReact): one of
   RC_REACT per nation per line, kept as rv {uid: kind} on the line; rcForget takes a nation's away with its account.
   A nation founded a moment ago is welcomed in its region's chat (rcHello, which its game asks once the new record is
   saved): a line {a: the new nation's uid, nm, x, t, exp, sys: 'found'} that the game draws as an announcement with a
   Welcome button (see rcHello for when it is written).
   An admin's line may carry a picture (rcPost pic, see rcPicIn): the line keeps a small copy for the chat to show,
   im {s, w, h, fw, fh, k}, and the picture itself is rcimg/{reg}/chat/{id} {a, d, k, t, exp} under the line's id, read
   only when a reader opens it. rcimg's collection is a 'chat' collection too, with the author in `a` and the same `exp`,
   so the time-to-live policy, an account's deletion and an admin's removal of a nation take it with the lines.
   An admin also writes a system message to every region at once (rcCast): the same line, {a, nm 'Edictum team', x, t,
   exp, st 'admin', tm: true, sys: 'all'}, in each region's chat under one id, which the game draws as a notice from the
   team; rcUncast takes it out of every region again. A game from before draws it as an ordinary Edictum team line.
   The world chat is one more channel beside the regions' (RC_WORLD, rchat/world/chat/{id}): every nation, of any region,
   reads it and writes in it, with the same ops (rcPost, rcReact, rcDelete, rcMute's wipe) given reg 'world'. A line there
   also carries what readers in other regions cannot look up, as the Community Board's posts do: the author's region
   (rg), flag (fl, as JSON), rank (rk, the index the author's game sends), alliance (al {n, c?}) and Founding Supporter
   mark (fd). Mentions there name any nation, of any region. Its lines count in the player's hour with their region lines
   (rcPace p), and come at most one every RC_WORLD_GAP; the repeat check is its own (rcPace w, wh: the time and words of
   the player's last world line). No welcome lines and no messages to every region go there. */
export const RC_WORLD = 'world', RC_WORLD_GAP = 4000, RC_RANKS = 99;
/* a chat the browser names: a region of the game or the world chat, or '' */
const chatOf = (d, regions) => typeof d.reg === 'string' && (regions.has(d.reg) || d.reg === RC_WORLD) ? d.reg : '';
export const RC_TEXT = 300, RC_GAP = 1500, RC_MINUTE = 12, RC_HOUR = 150, RC_GUEST_HOUR = 10, RC_SAME = 120000, RC_KEEP = 30 * 86400000;
const id20 = v => typeof v === 'string' && /^[A-Za-z0-9]{20}$/.test(v) ? v : '';
const line = (x, max) => typeof x === 'string' ? x.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';
/* the same words, however they are spaced or capitalised, for the repeat check */
const sameKey = x => line(x, RC_TEXT).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const hash = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };
export const RC_OPS = ['rcPost', 'rcDelete', 'rcMute', 'rcUnmute', 'rcReact', 'rcHello', 'rcCast', 'rcUncast'];
export const RC_MN = 5, RC_REACT = ['hear', 'ha', 'bravo', 'shame', 'fire', 'love', 'wow', 'hmm', 'sad', 'angry', 'hundred', 'thanks', 'eyes', 'salute'], RC_RV_MAX = 300;
export const isRegionChatOp = op => RC_OPS.includes(op);
/* how long a silence lasts, in hours: 0 is until lifted (kept as a far-off until, with perm) */
export const RC_MUTE_HOURS = [1, 24, 168, 720, 0], RC_FOREVER = Date.UTC(2100, 0, 1), RC_WIPE = 86400000;
const uidOf = v => typeof v === 'string' && /^[\w-]{1,128}$/.test(v) && !v.startsWith('npc-') ? v : '';
const staffOnly = who => { if (!who.admin && !who.mod) throw new HttpsError('permission-denied', 'Only Edictum staff can do that.'); };
/* a silence still running at `now`, or null; amb: an ambassador set it */
export function rcSilence(data, now) {
  if (!data || !Number.isFinite(data.until) || data.until <= now) return null;
  return { until: data.until, perm: data.perm === true, why: typeof data.why === 'string' ? data.why : '', ...(data.amb === true ? { amb: true } : {}) };
}
const whenText = ms => new Date(ms).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';

/* pictures (admins only). The game draws each picture anew on a canvas (nothing of a camera's metadata goes with it)
   and sends two data URLs: th, the small copy the line shows (JPEG, PNG or WebP, at most RC_THUMB_MAX bytes and
   RC_THUMB_SIDE pixels a side), and d, the picture (those or a GIF, kept as sent so it still moves; at most RC_PIC_MAX
   bytes, which with base64 keeps its document under Firestore's 1 MiB, and RC_PIC_SIDE pixels a side). The server checks
   each is what it says it is, by its first bytes, and keeps the sizes the game measured only to lay the picture out. */
export const RC_IMG_KINDS = ['jpeg', 'png', 'webp', 'gif'], RC_THUMB_MAX = 48 * 1024, RC_PIC_MAX = 700 * 1024, RC_THUMB_SIDE = 640, RC_PIC_SIDE = 4096;
const MAGIC = {
  jpeg: b => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  png: b => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  gif: b => b.length > 6 && /^GIF8[79]a$/.test(b.subarray(0, 6).toString('latin1')),
  webp: b => b.length > 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP'
};
/* a data URL of a picture of one of `kinds`, at most `max` bytes, whose bytes are that kind: {kind, size}, or null */
export function rcPicData(s, max, kinds = RC_IMG_KINDS) {
  if (typeof s !== 'string' || s.length > Math.ceil(max / 3) * 4 + 40) return null;
  const m = /^data:image\/(jpeg|png|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$/.exec(s);
  if (!m || !kinds.includes(m[1]) || m[2].length % 4) return null;
  const b = Buffer.from(m[2], 'base64');
  return b.length && b.length <= max && MAGIC[m[1]](b) ? { kind: m[1], size: b.length } : null;
}
const px = (v, max) => Number.isInteger(v) && v >= 1 && v <= max ? v : 0;
/* the picture a line carries, from rcPost's pic {th, w, h, d, fw, fh}: {im, d, kind} or, for anything else, a refusal */
export function rcPicIn(p) {
  const bad = () => { throw new HttpsError('invalid-argument', 'That picture cannot be posted. Choose a PNG, JPEG, WebP or GIF picture.', { code: 'rc_pic' }); };
  if (!p || typeof p !== 'object' || Array.isArray(p)) bad();
  const th = rcPicData(p.th, RC_THUMB_MAX, ['jpeg', 'png', 'webp']), full = rcPicData(p.d, RC_PIC_MAX);
  const w = px(p.w, RC_THUMB_SIDE), h = px(p.h, RC_THUMB_SIDE), fw = px(p.fw, RC_PIC_SIDE), fh = px(p.fh, RC_PIC_SIDE);
  if (!th || !full || !w || !h || !fw || !fh) bad();
  return { im: { s: p.th, w, h, fw, fh, k: full.kind }, d: p.d, kind: full.kind };
}

/* how long the player must wait before another line: a second and a half after the last, at most RC_MINUTE in any
   minute and `hour` in any hour (RC_HOUR, or RC_GUEST_HOUR for a guest). p: the times of their lines (ms), newest last */
export function rcWait(p, now, hour = RC_HOUR) {
  const recent = (Array.isArray(p) ? p : []).filter(t => typeof t === 'number' && t <= now && now - t < 3600000).sort((a, b) => a - b);
  let wait = recent.length ? recent[recent.length - 1] + RC_GAP - now : 0;
  const minute = recent.filter(t => now - t < 60000);
  if (minute.length >= RC_MINUTE) wait = Math.max(wait, minute[minute.length - RC_MINUTE] + 60000 - now);
  if (recent.length >= hour) wait = Math.max(wait, recent[recent.length - hour] + 3600000 - now);
  return { wait: Math.max(0, wait), recent };
}

/* a card a line may carry (2026-11-18, the owner picked "quick commands"): the writer typed /stock, /rank or /nation <name>
   and their game sends what it shows, as cd. Only these fields, in these ranges, are kept; the words of the line are the
   command as typed. A nation card names a nation of the writer's region (any region, in the world chat) that the server
   finds, under the name saved on it. The figures are the writer's game's, as a /stock or /rank line is about the writer.
     {k: 'stock', v: [5 amounts], r: [5 a day]}   food, timber, iron, oil, goods
     {k: 'rank', i: rank, p: points, n: achievements}
     {k: 'nation', id, nm, pop, ci: cities, hx: hexes, i: rank, al?: alliance name}
     {k: 'border', id: a border agreement of this region (functions/borders.js), drawn by each reader's game}  */
export const RC_CARDS = ['stock', 'rank', 'nation', 'border'];
const num = (v, lo, hi) => { const x = Number(v); return Number.isFinite(x) ? Math.min(hi, Math.max(lo, Math.round(x * 10) / 10)) : null; };
const int = (v, lo, hi) => { const x = Number(v); return Number.isInteger(x) && x >= lo && x <= hi ? x : null; };
export function rcCardIn(c) {
  const bad = () => { throw new HttpsError('invalid-argument', 'That card cannot be shown.', { code: 'rc_card' }); };
  if (!c || typeof c !== 'object' || Array.isArray(c) || !RC_CARDS.includes(c.k)) bad();
  if (c.k === 'stock') {
    if (!Array.isArray(c.v) || !Array.isArray(c.r) || c.v.length !== 5 || c.r.length !== 5) bad();
    const v = c.v.map(x => num(x, 0, 1e9)), r = c.r.map(x => num(x, -1e7, 1e7));
    if (v.includes(null) || r.includes(null)) bad();
    return { k: 'stock', v, r };
  }
  if (c.k === 'rank') {
    const i = int(c.i, 0, RC_RANKS), p = int(c.p, 0, 1e8), n = int(c.n, 0, 1e5);
    if (i == null || p == null || n == null) bad();
    return { k: 'rank', i, p, n };
  }
  if (c.k === 'border') {
    const id = typeof c.id === 'string' && /^[a-z0-9]{12}$/.test(c.id) ? c.id : '';
    if (!id) bad();
    return { k: 'border', id };
  }
  const id = typeof c.id === 'string' && /^[\w-]{1,128}$/.test(c.id) ? c.id : '', pop = num(c.pop, 0, 1e9), ci = int(c.ci, 0, 1e4), hx = int(c.hx, 0, 1e6), i = int(c.i, 0, RC_RANKS);
  if (!id || pop == null || ci == null || hx == null || i == null) bad();
  const al = line(c.al, 40);
  return { k: 'nation', id, pop, ci, hx, i, ...(al ? { al } : {}) };
}

async function rcPost(db, who, d, regions) {
  const x = line(d.x, RC_TEXT), team = d.team === true, re = d.re ? id20(d.re) : '', world = d.reg === RC_WORLD;
  /* a picture: an admin's alone, with or without words */
  if (d.pic != null && !who.admin) throw new HttpsError('permission-denied', 'Only Edictum admins can post pictures in the chat.');
  const pic = d.pic != null ? rcPicIn(d.pic) : null;
  const cd = d.cd != null ? rcCardIn(d.cd) : null;
  if (cd && pic) throw new HttpsError('invalid-argument', 'A card goes on its own line.');
  if (!x && !pic) throw new HttpsError('invalid-argument', 'Write something first.');
  if (team) staffOnly(who);
  if (d.re && !re) throw new HttpsError('invalid-argument', 'Choose a line to answer.');
  const asked = [...new Set(Array.isArray(d.mn) ? d.mn.map(uidOf).filter(u => u && u !== who.uid) : [])].slice(0, RC_MN);
  let tell = [];
  const out = await db.runTransaction(async tx => {
    /* the team writes in any region, open or not, with no nation of its own there */
    const e = await eligibility(tx, who, team ? { linked: false, nation: false, hidden: true, allowClosedRegion: true } : { linked: false });
    const home = team ? '' : e.n.reg || e.saved.get('reg') || '';
    const reg = world ? RC_WORLD : team ? (typeof d.reg === 'string' && regions.has(d.reg) ? d.reg : '') : home;
    if (team && !reg) throw new HttpsError('invalid-argument', 'Choose a region.');
    if (!world && !regions.has(reg)) refuse('rc_region', 'Your nation has no region to talk in.');
    if (world && !team && !regions.has(home)) refuse('rc_region', 'Your nation has no region to talk from.');
    if (!world && !team && typeof d.reg === 'string' && d.reg && d.reg !== reg) refuse('rc_region', 'Your nation is in another region now. Reload the game to join its chat.');
    /* in the world chat, the author's marks: their shop (the Founding Supporter mark) and alliance, read with the pacing */
    const extra = world && !team ? [db.doc('shop/' + who.uid), db.doc('allyOf/' + who.uid)] : [];
    const pace = db.doc('rcPace/' + who.uid), [ps, ms, shop, ally] = await tx.getAll(pace, db.doc('rcMute/' + who.uid), ...extra), now = Date.now();
    const sil = rcSilence(ms.exists ? ms.data() : null, now);
    if (sil) throw new HttpsError('failed-precondition', `You are silenced in the ${world ? 'chats' : 'region chat'}${sil.perm ? '' : ' until ' + whenText(sil.until)}${sil.why ? ': ' + sil.why : ''}.`, { code: 'rc_silenced', until: sil.until, perm: sil.perm, why: sil.why, ...(sil.amb ? { amb: true } : {}) });
    /* a guest writes RC_GUEST_HOUR lines in any hour; a sign-in lifts it to RC_HOUR */
    const guest = !team && e.kind === 'guest';
    const { wait, recent } = rcWait(ps.exists ? ps.get('p') : [], now, guest ? RC_GUEST_HOUR : RC_HOUR);
    if (guest && recent.length >= RC_GUEST_HOUR) {
      const w = recent[recent.length - RC_GUEST_HOUR] + 3600000 - now, m = Math.max(1, Math.ceil(w / 60000));
      throw new HttpsError('failed-precondition', `Guests can send ${RC_GUEST_HOUR} lines an hour. You can write again in ${m} ${m === 1 ? 'minute' : 'minutes'}, or link a sign-in to chat freely.`, { code: 'rc_guest', wait: w, max: RC_GUEST_HOUR });
    }
    /* the world chat: one line every RC_WORLD_GAP at most */
    const wLast = world && ps.exists ? Number(ps.get('w')) || 0 : 0, slow = Math.max(wait, wLast && wLast <= now ? wLast + RC_WORLD_GAP - now : 0);
    if (slow > 0) throw new HttpsError('failed-precondition', `Slow down a little. You can write again in ${Math.ceil(slow / 1000)} ${Math.ceil(slow / 1000) === 1 ? 'second' : 'seconds'}.`, { code: 'rc_paced', wait: slow });
    /* the same words again, or the same picture with the same words (the world chat's on their own) */
    const h = hash(sameKey(x) + (pic ? '#' + pic.im.s.length + pic.im.s.slice(-48) : '')), last = world ? wLast : recent.length ? recent[recent.length - 1] : 0;
    if (ps.exists && ps.get(world ? 'wh' : 'h') === h && now - last < RC_SAME) refuse('rc_same', 'You just wrote that.');
    /* a nation card: the nation is there, in this region (any, in the world chat), and goes under its saved name */
    if (cd && cd.k === 'nation') {
      const ns = await tx.get(db.doc('nations/' + cd.id)), nm = ns.exists ? line(ns.get('name'), 80) : '';
      if (!nm || (!world && ns.get('reg') !== reg)) refuse('rc_card', 'That nation is not in this region.');
      cd.nm = nm;
    }
    /* a border card: the agreement is of this region, never in the world chat */
    if (cd && cd.k === 'border') {
      const bs = await tx.get(db.doc('borders/' + cd.id));
      if (world || !bs.exists || bs.get('reg') !== reg) refuse('rc_card', 'That border agreement is not of this region.');
    }
    /* the line answered: in the same chat, still there */
    let r = null;
    if (re) {
      const rs = await tx.get(db.doc('rchat/' + reg + '/chat/' + re));
      if (!rs.exists) refuse('rc_gone', 'That line is no longer in the chat.');
      r = { id: re, a: line(rs.get('a'), 128), nm: rs.get('tm') === true ? 'Edictum team' : line(rs.get('nm'), 80) || 'A nation', x: line(rs.get('x'), 90),
        ...(rs.get('tm') === true ? { tm: true } : {}), ...(rs.get('im') ? { im: true } : {}) };
    }
    /* the nations mentioned: of this region (of any, in the world chat), named after an @, not blocking the writer; and
       the author answered */
    const low = x.toLowerCase(), mn = {}, toTell = new Map();
    const ask = asked.concat(r && !r.tm && r.a !== who.uid && !asked.includes(r.a) ? [r.a] : []);
    const got = ask.length ? await tx.getAll(...ask.flatMap(u => [db.doc('nations/' + u), db.doc('lblock/' + u + '~' + who.uid)])) : [];
    ask.forEach((u, i) => {
      const n = got[2 * i], block = got[2 * i + 1], nm = n.exists ? line(n.get('name'), 80) : '';
      if (!nm || block.exists || (!world && n.get('reg') !== reg)) return;
      if (asked.includes(u) && low.includes('@' + nm.toLowerCase())) { mn[u] = nm; toTell.set(u, false); }
      else if (r && u === r.a) toTell.set(u, true);
    });
    const ref = db.collection('rchat/' + reg + '/chat').doc(), me = team ? 'Edictum team' : line(e.saved.get('name'), 80) || 'A nation';
    /* a team line keeps the staff member's own nation name (wn), so readers see who on the team wrote it */
    const wn = team && e.saved && e.saved.exists ? line(e.saved.get('name'), 80) : '';
    /* the author as a reader in another region sees them: region, flag, rank, alliance, Founding Supporter mark */
    let marks = {};
    if (extra.length) {
      const aid = ally.exists && typeof ally.get('a') === 'string' && /^[\w-]{1,128}$/.test(ally.get('a')) ? ally.get('a') : '';
      const al = aid ? await tx.get(db.doc('alliances/' + aid)) : null, mem = al && al.exists && al.get('mem') && typeof al.get('mem') === 'object' ? al.get('mem') : {};
      const an = al && al.exists && mem[who.uid] ? line(al.get('name'), 40) : '', col = an && /^#[0-9a-fA-F]{6}$/.test(al.get('col') || '') ? al.get('col').toUpperCase() : '';
      const tg = an && /^[A-Z0-9]{2,4}$/.test(al.get('tg') || '') ? al.get('tg') : '';
      const flag = e.n.flag && typeof e.n.flag === 'object' ? JSON.stringify(e.n.flag) : '', rk = Number.isInteger(d.rk) && d.rk >= 0 && d.rk <= RC_RANKS ? d.rk : null;
      marks = { rg: home, ...(flag && flag.length <= 4000 ? { fl: flag } : {}), ...(rk != null ? { rk } : {}), ...(an ? { al: { n: an, ...(col ? { c: col } : {}), ...(tg ? { t: tg } : {}) } } : {}),
        ...(shop.exists && shop.get('owns.founder') ? { fd: true } : {}) };
    }
    tx.set(pace, { p: recent.concat(now).slice(-RC_HOUR), ...(world ? { w: now, wh: h } : { h }) }, { merge: true });
    const exp = Timestamp.fromMillis(now + RC_KEEP);
    tx.create(ref, { a: who.uid, nm: me, x, t: now, exp, ...marks,
      ...(who.admin ? { st: 'admin' } : who.mod ? { st: 'mod' } : {}), ...(team ? { tm: true, ...(wn ? { wn } : {}) } : {}), ...(r ? { r } : {}), ...(Object.keys(mn).length ? { mn } : {}), ...(pic ? { im: pic.im } : {}), ...(cd ? { cd } : {}) });
    if (pic) tx.create(db.doc('rcimg/' + reg + '/chat/' + ref.id), { a: who.uid, d: pic.d, k: pic.kind, t: now, exp });
    for (const [u, rp] of toTell) tx.create(db.collection('mentions/' + u + '/m').doc(), { k: 'chat', by: who.uid, nm: me, reg, rc: ref.id, x: line(x, 160) || '📷 A picture', t: now, ...(rp ? { rp: true } : {}) });
    tell = [...toTell].map(([u, rp]) => ({ u, rp, nm: me }));
    return { ok: true, id: ref.id, reg, t: now, ...(Object.keys(mn).length ? { mn } : {}), ...(guest ? { guest: true, left: Math.max(0, RC_GUEST_HOUR - recent.length - 1), gt: recent.concat(now).slice(-RC_GUEST_HOUR) } : {}) };
  });
  /* a push notification for those not in the game; never holds the line up */
  if (tell.length) await Promise.all(tell.map(t => pushChatMention(db, t.u, who.uid, t.nm, t.rp, world).catch(() => 0)));
  return out;
}

/* a reaction: the same one again takes it back; another replaces it */
async function rcReact(db, who, d, regions) {
  const reg = chatOf(d, regions), id = id20(d.id), kind = RC_REACT.includes(d.k) ? d.k : '';
  if (!reg || !id || !kind) throw new HttpsError('invalid-argument', 'Choose a line and a reaction.');
  return db.runTransaction(async tx => {
    const e = await eligibility(tx, who, { linked: false });
    if (reg !== RC_WORLD && !(who.admin || who.mod) && (e.n.reg || e.saved.get('reg')) !== reg) throw new HttpsError('permission-denied', 'React in your own region’s chat.');
    const ref = db.doc('rchat/' + reg + '/chat/' + id), s = await tx.get(ref);
    if (!s.exists) refuse('rc_gone', 'That line is no longer in the chat.');
    const rv = s.get('rv') && typeof s.get('rv') === 'object' ? s.get('rv') : {}, had = rv[who.uid] || '', pick = had === kind ? '' : kind;
    if (pick && !had && Object.keys(rv).length >= RC_RV_MAX) refuse('rc_full', 'This line has all the reactions it can hold.');
    tx.update(ref, new FieldPath('rv', who.uid), pick || FieldValue.delete());
    return { ok: true, k: pick };
  });
}
/* a nation's reactions go with its account (functions/accounts.js) or its removal by an admin (functions/admin.js) */
export async function rcForget(db, uid, regs) {
  if (!uidOf(uid)) return 0;
  const found = await Promise.all([...new Set([...regs, RC_WORLD])].map(reg => db.collection('rchat/' + reg + '/chat').where(new FieldPath('rv', uid), 'in', RC_REACT).get().catch(() => ({ docs: [] }))));
  const docs = found.flatMap(q => q.docs);
  if (!docs.length) return 0;
  const w = db.bulkWriter();
  await Promise.all([Promise.all(docs.map(s => w.update(s.ref, new FieldPath('rv', uid), FieldValue.delete()))), w.close()]);
  return docs.length;
}

/* the author deletes their own line; staff delete anyone's, which the audit log keeps (with the words) */
export async function rcDelete(db, who, d, regions) {
  const reg = chatOf(d, regions), id = id20(d.id);
  if (!reg || !id) throw new HttpsError('invalid-argument', 'Choose a line.');
  const ref = db.doc('rchat/' + reg + '/chat/' + id), s = await ref.get();
  if (!s.exists) return { ok: true };
  const staff = who.admin || who.mod;
  if (s.get('a') !== who.uid && !staff) throw new HttpsError('permission-denied', 'You can only delete your own lines.');
  const b = db.batch();
  b.delete(ref);
  if (s.get('im')) b.delete(db.doc('rcimg/' + reg + '/chat/' + id));
  if (s.get('a') !== who.uid) {
    b.create(db.collection('adminAudit').doc(), { actor: who.uid, action: 'chat_delete', outcome: 'completed', at: FieldValue.serverTimestamp(),
      target: line(s.get('a'), 128), name: line(s.get('nm'), 80), reg, line: id, x: line(s.get('x'), RC_TEXT), ...(s.get('im') ? { pic: true } : {}), reason: line(d.reason, 300) || (reg === RC_WORLD ? 'Removed from the world chat' : 'Removed from the region chat') });
    const report = typeof d.report === 'string' && /^[\w-]{1,128}$/.test(d.report) ? d.report : '';
    if (report) b.delete(db.doc('reports/' + report));
  }
  await b.commit();
  return { ok: true };
}

/* staff silence a player in every region's chat and the world chat; with wipe, their lines of the last 24 hours in `reg`
   (a region or the world chat; their own region if not given) go too. The audit log keeps who, why, until when and how many lines went */
async function rcMute(db, who, d, regions) {
  const staff = who.admin || who.mod;
  if (!staff && !who.amb) throw new HttpsError('permission-denied', 'Only Edictum staff and ambassadors can do that.');
  if (!staff && d.wipe === true) throw new HttpsError('permission-denied', 'Removing lines stays with the moderators.');
  const uid = uidOf(d.uid), hours = Number(d.hours), why = line(d.why, 200);
  if (!uid) throw new HttpsError('invalid-argument', 'Choose a player.');
  if (uid === who.uid) throw new HttpsError('failed-precondition', 'You cannot silence yourself.');
  if (!RC_MUTE_HOURS.includes(hours)) throw new HttpsError('invalid-argument', 'Choose how long.');
  let target = null;
  try { target = await getAuth().getUser(uid); } catch { /* an account Firebase no longer has: silenced all the same */ }
  if (target && (target.customClaims?.admin === true || target.customClaims?.mod === true)) refuse('rc_staff', 'Edictum staff cannot be silenced.');
  if (!staff && target && target.customClaims?.amb === true) refuse('rc_amb', 'An ambassador cannot silence another ambassador.');
  const nation = await db.doc('nations/' + uid).get(), now = Date.now();
  const nm = line(nation.get('name'), 80), home = line(nation.get('reg'), 40);
  const reg = chatOf(d, regions) || (regions.has(home) ? home : '');
  const until = hours ? now + hours * 3600000 : RC_FOREVER;
  let removed = 0;
  if (d.wipe === true && reg) {
    const qs = await db.collection('rchat/' + reg + '/chat').where('a', '==', uid).get();
    /* one batch: a line with a picture is two deletes */
    const old = []; let writes = 0;
    for (const s of qs.docs) {
      if (!(Number(s.get('t')) > now - RC_WIPE && s.get('tm') !== true)) continue;
      const k = s.get('im') ? 2 : 1; if (writes + k > 450) break; old.push(s); writes += k;
    }
    if (old.length) { const b = db.batch(); old.forEach(s => { b.delete(s.ref); if (s.get('im')) b.delete(db.doc('rcimg/' + reg + '/chat/' + s.id)); }); await b.commit(); removed = old.length; }
  }
  const b = db.batch();
  b.set(db.doc('rcMute/' + uid), { until, ...(hours ? {} : { perm: true }), ...(staff ? {} : { amb: true }), why, by: who.uid, t: now, nm, reg: home });
  b.create(db.collection('adminAudit').doc(), { actor: who.uid, action: 'chat_silence', outcome: 'completed', at: FieldValue.serverTimestamp(),
    target: uid, name: nm, reg: reg || home, until, hours, removed, ...(staff ? {} : { role: 'amb' }), reason: why || 'Silenced in the region chat' });
  await b.commit();
  return { ok: true, until, perm: !hours, removed };
}
async function rcUnmute(db, who, d) {
  staffOnly(who);
  const uid = uidOf(d.uid);
  if (!uid) throw new HttpsError('invalid-argument', 'Choose a player.');
  const ref = db.doc('rcMute/' + uid), s = await ref.get();
  if (!s.exists) return { ok: true };
  const b = db.batch();
  b.delete(ref);
  b.create(db.collection('adminAudit').doc(), { actor: who.uid, action: 'chat_unsilence', outcome: 'completed', at: FieldValue.serverTimestamp(),
    target: uid, name: line(s.get('nm'), 80), reg: line(s.get('reg'), 40), reason: line(d.why, 200) || 'Silence lifted' });
  await b.commit();
  return { ok: true };
}

/* "X has been founded, welcome to #Region!": written once for a nation whose record Firestore created in the last
   RC_HELLO_AGE (its birth as functions/eligibility.js knows it, never the founding time the record claims), once a day for an account (rcHello/{uid} {g: the
   record's birth, t}, so founding again and again names no one), once a day for a name in a region (a nation carried
   into another account on signing in is saved anew there) and at most RC_HELLO_HOUR a region an hour (rcHello/~{reg}
   {w: [{t, k}]}, the welcomes of the last day), and never for an account silenced in the chat. Otherwise it answers
   {ok: true, skip} and writes no line, so the game asks no more. */
export const RC_HELLO_AGE = 3600000, RC_HELLO_GAP = 86400000, RC_HELLO_HOUR = 20;
const REG_NAME = new Map(DATA.regions.map(r => [r.id, String(r.name || r.id)]));
export const rcHelloText = (nm, reg) => `${nm} has been founded, welcome to #${(REG_NAME.get(reg) || reg).replace(/^The /, '')}!`;
async function rcHello(db, who, d, regions) {
  return db.runTransaction(async tx => {
    const e = await eligibility(tx, who, { linked: false }), now = Date.now();
    const reg = e.n.reg || e.saved.get('reg') || '', nm = line(e.saved.get('name'), 80);
    if (!regions.has(reg) || !nm) return { ok: true, skip: 'region' };
    if (now - e.born > RC_HELLO_AGE) return { ok: true, skip: 'old' };
    const mine = db.doc('rcHello/' + who.uid), area = db.doc('rcHello/~' + reg);
    const [hs, rs, ms] = await tx.getAll(mine, area, db.doc('rcMute/' + who.uid));
    if (hs.exists && now - Number(hs.get('t') || 0) < RC_HELLO_GAP) return { ok: true, skip: 'done' };
    const k = sameKey(nm), w = (Array.isArray(rs.get('w')) ? rs.get('w') : []).filter(x => x && Number(x.t) > now - RC_HELLO_GAP && Number(x.t) <= now);
    const skip = rcSilence(ms.exists ? ms.data() : null, now) ? 'silenced' : w.some(x => x.k === k) ? 'again'
      : w.filter(x => x.t > now - 3600000).length >= RC_HELLO_HOUR ? 'busy' : '';
    tx.set(mine, { g: e.generation, t: now });
    if (skip) return { ok: true, skip };
    const ref = db.collection('rchat/' + reg + '/chat').doc();
    tx.set(area, { w: w.concat({ t: now, k }).slice(-100) });
    tx.create(ref, { a: who.uid, nm, x: rcHelloText(nm, reg), t: now, exp: Timestamp.fromMillis(now + RC_KEEP), sys: 'found' });
    return { ok: true, id: ref.id, reg, t: now };
  });
}

/* a system message to every region: one line in each region's chat (open, coming soon or closed for maintenance), all
   with the same id. Admins only. Paced like the admin's own lines (rcPace), so a second click on Send, the same words
   within RC_SAME, is refused rather than sent twice. The audit log keeps the words and how many regions had it */
const castOnly = who => { if (!who.admin) throw new HttpsError('permission-denied', 'Only Edictum admins can write to every region at once.'); };
async function rcCast(db, who, d, regions) {
  castOnly(who);
  const x = line(d.x, RC_TEXT), regs = [...regions];
  if (!x) throw new HttpsError('invalid-argument', 'Write something first.');
  return db.runTransaction(async tx => {
    await eligibility(tx, who, { linked: false, nation: false, hidden: true, allowClosedRegion: true });
    const pace = db.doc('rcPace/' + who.uid), ps = await tx.get(pace), now = Date.now();
    const { wait, recent } = rcWait(ps.exists ? ps.get('p') : [], now);
    if (wait > 0) throw new HttpsError('failed-precondition', `Slow down a little. You can write again in ${Math.ceil(wait / 1000)} ${Math.ceil(wait / 1000) === 1 ? 'second' : 'seconds'}.`, { code: 'rc_paced', wait });
    const h = hash(sameKey(x)), last = recent.length ? recent[recent.length - 1] : 0;
    if (ps.exists && ps.get('h') === h && now - last < RC_SAME) refuse('rc_same', 'You just sent that.');
    const id = db.collection('rchat/' + regs[0] + '/chat').doc().id, exp = Timestamp.fromMillis(now + RC_KEEP);
    tx.set(pace, { p: recent.concat(now).slice(-RC_HOUR), h });
    for (const reg of regs) tx.create(db.doc('rchat/' + reg + '/chat/' + id), { a: who.uid, nm: 'Edictum team', x, t: now, exp, st: 'admin', tm: true, sys: 'all' });
    tx.create(db.collection('adminAudit').doc(), { actor: who.uid, action: 'chat_broadcast', outcome: 'completed', at: FieldValue.serverTimestamp(),
      line: id, x, regions: regs.length, reason: 'A system message to every region’s chat' });
    return { ok: true, id, t: now, regions: regs.length };
  });
}
/* the system message out of every region's chat it is still in (a region's copy an admin or the time-to-live policy
   already took is skipped); only lines that are system messages, so an id can never take anything else */
async function rcUncast(db, who, d, regions) {
  castOnly(who);
  const id = id20(d.id);
  if (!id) throw new HttpsError('invalid-argument', 'Choose a system message.');
  const got = await db.getAll(...[...regions].map(reg => db.doc('rchat/' + reg + '/chat/' + id)));
  const lines = got.filter(s => s.exists && s.get('sys') === 'all');
  if (!lines.length) return { ok: true, removed: 0 };
  const b = db.batch();
  lines.forEach(s => b.delete(s.ref));
  b.create(db.collection('adminAudit').doc(), { actor: who.uid, action: 'chat_broadcast_delete', outcome: 'completed', at: FieldValue.serverTimestamp(),
    line: id, x: line(lines[0].get('x'), RC_TEXT), removed: lines.length, reason: line(d.reason, 300) || 'Removed from every region’s chat' });
  await b.commit();
  return { ok: true, removed: lines.length };
}

const OPS = { rcPost, rcDelete, rcMute, rcUnmute, rcReact, rcHello, rcCast, rcUncast };
export function regionChat(db, who, d, regions) {
  return OPS[d.op](db, who, d, regions);
}
