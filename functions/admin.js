// Staff-only operations. Audit events use authenticated identities and server time; clients cannot edit them.
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { registered, banMarks, regionClosed } from './eligibility.js';
import { nationText } from './nationtext.js';
import { gather, summarize, nationRow, saveEngage, loadEngage } from './stats.js';
import { nationDetail } from './stats-acts.js';
import { feed, SPANS, GROUP } from './feed.js';
import { alertConfig, ALERT_DEFAULTS } from './alerts.js';
import { setComp, setGrant, packState } from './shop.js';
import { cbDelete, rmbForget, cbForget } from './board.js';
import { rcForget, rcShared } from './regionchat.js';
import { alDrop } from './alliances.js';
import { trDrop } from './treaties.js';
import { bdDrop } from './borders.js';
import { jvDrop } from './ventures.js';
import { rdForget } from './riddles.js';
import { fcForget } from './flagcomp.js';
import { shopSummary, founderGiftSummary, grantSummary, parseEcb, ECB_URL } from './shop-stats.js';
import { gatherMore, moreSummary, buyerTiming } from './stats-more.js';
import { supportAdmin } from './support.js';
import { goneList, goneRestore } from './gone.js';
import { banOver } from './bans.js';
import { balanceOf } from './balance.js';
import { letterStats } from './letter-stats.js';
import { onceAdmin, onceStatus } from './once.js';
import DATA from './civic-data.json' with { type: 'json' };

/* every region, from the same list the save permit checks (civic-data.json): a list of its own here missed Terra */
const REGIONS = new Set(DATA.regions.map(r => r.id));
export const MAINTENANCE = 'Current region is disabled and undergoing maintainance, check back soon.';
const text = (v, max = 128) => typeof v === 'string' ? v.trim().slice(0, max) : '';
const id = v => { const s = text(v); if (!s || s.includes('/')) throw new HttpsError('invalid-argument', 'A valid record ID is required.'); return s; };
const ms = v => v?.toMillis?.() || 0;
const key = s => String(s || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
let directory = null, directoryAt = 0, onlineSet = null, onlineAt = 0;
/* Online now: a game tab in front reports its save health at least once a minute (src/shim.js, healthSoon), so a
   player with a report in the last ONLINE_MS has the game open. Cached briefly, like the directory. */
const ONLINE_MS = 3 * 60000;
async function online(db, refresh) {
  if (!onlineSet || refresh || Date.now() - onlineAt > 20000) {
    const qs = await db.collection('saveHealth').where('t', '>', Timestamp.fromMillis(Date.now() - ONLINE_MS)).select('uid').get();
    onlineSet = new Set(qs.docs.map(d => d.get('uid')).filter(Boolean));
    onlineAt = Date.now();
  }
  return onlineSet;
}
/* last activity filters: within the last hour, day or week, or quiet for over a week or a month */
const ACT = { h1: t => t >= Date.now() - 3600000, d1: t => t >= Date.now() - 86400000, d7: t => t >= Date.now() - 7 * 86400000, old7: t => t < Date.now() - 7 * 86400000, old30: t => t < Date.now() - 30 * 86400000 };

/* engagement filters (functions/stats.js, engagement): high, middling, low, or not scored yet */
const ENG = { hi: e => !!e && e[0] >= 60, mid: e => !!e && e[0] >= 30 && e[0] < 60, lo: e => !!e && e[0] < 30, none: e => !e };
const SORTS = { eng: (a, b) => (b.eng?.[0] ?? -1) - (a.eng?.[0] ?? -1), act: (a, b) => tOf(b) - tOf(a), pop: (a, b) => (Number(b.pop) || 0) - (Number(a.pop) || 0) };
const tOf = p => typeof p.t === 'number' ? p.t : ms(p.t);
/* the engagement scores the statistics last wrote (statsEngage, eight small documents), kept a minute per instance
   like the directory, so a count made on another instance shows soon */
let engaged = null, engagedAt = 0;
async function engagement(db, refresh) {
  if (!engaged || refresh || Date.now() - engagedAt > 60000) { engaged = await loadEngage(db).catch(() => ({ at: 0, m: new Map() })); engagedAt = Date.now(); }
  return engaged;
}
async function players(db, data) {
  // Read only the small public summaries, cached for a minute. Legacy nations need no migration.
  if (!directory || data.refresh === true || Date.now() - directoryAt > 60000) {
    const qs = await db.collection('summaries').select('name', 'reg', 'pop', 't').get();
    directory = qs.docs.map(d => ({ uid: d.id, ...d.data() })).sort((a, b) => String(a.name).localeCompare(String(b.name)));
    directoryAt = Date.now();
  }
  const q = key(text(data.q, 128)), reg = text(data.reg, 40), act = text(data.act, 8), en = text(data.eng, 8), sort = text(data.sort, 8);
  const [on, E] = await Promise.all([online(db, data.refresh === true), engagement(db, data.refresh === true)]);
  const eng = p => E.m.get(p.uid) || null;
  let matches = directory.filter(p => (!reg || p.reg === reg) && (!q || key(p.name).includes(q) || key(p.uid).includes(q))
    && (act !== 'online' || on.has(p.uid)) && (!ACT[act] || ACT[act](tOf(p))) && (!ENG[en] || ENG[en](eng(p))));
  if (q && !text(data.q).includes('/') && !matches.some(p => p.uid === text(data.q))) {
    const direct = await db.doc('summaries/' + text(data.q)).get();
    if (direct.exists && (!reg || direct.get('reg') === reg)) matches.unshift({ uid: direct.id, ...direct.data() });
  }
  if (SORTS[sort]) matches = matches.map(p => ({ ...p, eng: eng(p) })).sort((a, b) => SORTS[sort](a, b) || String(a.name).localeCompare(String(b.name)));
  const offset = Number.isSafeInteger(data.offset) && data.offset >= 0 ? data.offset : 0;
  const page = matches.slice(offset, offset + 50).map(p => ({ ...p, on: on.has(p.uid), eng: eng(p) }));
  return { players: page, total: matches.length, online: on.size, next: offset + 50 < matches.length ? offset + 50 : null, at: directoryAt, engAt: E.at };
}
// Who is behind a nation, from Firebase Authentication itself, never from the nation's shared record.
// Email link sign-in is Firebase's 'password' provider; Discord is a custom claim (functions/discord.js).
const SIGN_INS = { 'google.com': 'google', password: 'email' };
// Firebase keeps no IP address: the last one is recorded by functions/accounts.js ('seen') and expires on its own.
async function account(db, uid) {
  const [u, s] = await Promise.all([getAuth().getUser(uid).catch(e => { if (e.code === 'auth/user-not-found') return null; throw e; }), db.doc('accountSeen/' + uid).get()]);
  if (!u) return null;
  const at = t => Date.parse(t || '') || 0, claims = u.customClaims || {};
  const linked = u.providerData.map(p => p.providerId === 'password' && !u.emailVerified ? 'email_unverified' : SIGN_INS[p.providerId] || p.providerId);
  if (claims.dc) linked.push('discord');
  return { kind: registered(u) ? 'registered' : 'guest', linked, admin: claims.admin === true, disabled: u.disabled, created: at(u.metadata.creationTime), lastSignIn: at(u.metadata.lastSignInTime), lastRefresh: at(u.metadata.lastRefreshTime), ip: s.get('ip') || '', ipAt: s.get('at') || 0 };
}
async function player(db, uid) {
  const [n, ban, mod, sessions, acct, notes, shop, comp, watch, grant] = await Promise.all([db.doc('nations/' + uid).get(), db.doc('bans/' + uid).get(), db.doc('mod/' + uid).get(), db.collection('saveHealth').where('uid', '==', uid).limit(30).get(), account(db, uid), db.doc('staffNotes/' + uid).get(), db.doc('shop/' + uid).get(), db.doc('shopComp/' + uid).get(), db.doc('watch/' + uid).get(), db.doc('shopGrant/' + uid).get()]);
  const d = n.data() || {}, more = await overview(db, uid, d, acct, shop);
  // the one-time sign-in link waiting for this player, if any (functions/once.js)
  const once = acct ? await onceStatus(db, uid, await getAuth().getUser(uid).catch(() => null)) : null;
  return { ...more, once, uid, exists: n.exists, name: d.name || ban.get('name') || mod.get('name') || uid, reg: d.reg || '', pop: d.pop ?? null, revision: d.rev || 0, savedAt: ms(d.ts), banned: ban.exists, banUntil: banUntil(ban), banOver: ban.exists && banOver(banUntil(ban)), hidden: mod.get('hidden') === true, rename: mod.get('rename') === true, removed: mod.get('removed') || 0, note: ban.get('note') || mod.get('note') || '', account: acct, staffNote: staffNote(notes), club: clubState(shop, comp), packs: packState(shop, grant), watch: watchState(watch), sessions: sessions.docs.map(s => { const { expiresAt, ...value } = s.data(); return { id: s.id, ...value, t: ms(s.get('t')) }; }) };
}
/* What a moderator sees when they look a player up from the report queue or a region's chat: the nation, how it has
   been moderated, the reports by and about it, the staff's case file and the admin actions already taken — enough to
   judge a report. Nothing of the account behind it: no sign-ins, no address, no other accounts seen from it, no
   purchases, no sign-in links, no session reports. Built from a list of its own, so nothing new leaks by accident. */
const MOD_FIELDS = ['uid', 'exists', 'name', 'reg', 'pop', 'revision', 'savedAt', 'banned', 'banUntil', 'banOver',
  'hidden', 'rename', 'removed', 'note', 'nation', 'reports', 'actions', 'staffNote', 'watch'];
async function modPlayer(db, uid) {
  const p = await player(db, uid), out = { mod: true };
  for (const k of MOD_FIELDS) if (k in p) out[k] = p[k];
  return { ...out, account: null, alts: [], purchases: null, sessions: [], once: null, club: null, packs: null };
}
/* The rest of a player's page: their nation at a glance, what they bought, other accounts seen from their address,
   reports and tickets by and about them, and the admin actions on them (the page builds its timeline from these) */
const when = v => typeof v === 'number' ? v : ms(v);
const few = (qs, map, n = 20) => qs.docs.map(map).sort((a, b) => b.t - a.t).slice(0, n);
async function overview(db, uid, shared, acct, shop) {
  const now = Date.now();
  const [priv, txs, ctm, paddle, against, by, tickets, bugs, acts, seen] = await Promise.all([
    db.doc('nationx/' + uid).get(), db.collection('shopTx').where('uid', '==', uid).limit(100).get(), db.doc('shopAcct/' + uid).get(), db.doc('authConfig/paddle').get(),
    db.collection('reports').where('target', '==', uid).limit(50).get(), db.collection('reports').where('by', '==', uid).limit(50).get(),
    db.collection('support').where('by', '==', uid).limit(50).get(), db.collection('bugs').where('by', '==', uid).limit(50).get(),
    db.collection('adminAudit').where('target', '==', uid).orderBy('at', 'desc').limit(30).get(),
    acct?.ip ? db.collection('accountSeen').where('ip', '==', acct.ip).limit(21).get() : null]);
  const r = shared && Object.keys(shared).length ? nationRow(uid, shared, priv.data(), now) : null;
  const nation = r && { name: r.name, pop: r.pop, founded: r.founded, t: r.t, dec: r.dec, cities: r.cities, claims: r.claims, tut: r.tut.length, lists: r.lists, features: r.f, inbox: r.inbox, eng: r.eng,
    rulings: r.ans.sort((a, b) => b[0] - a[0]).slice(0, 8).map(([t, id, o]) => ({ t, id, o })) };
  const txIds = txs.docs.map(t => t.id), adjs = [];
  for (let i = 0; i < txIds.length; i += 30) adjs.push(...(await db.collection('shopAdj').where('txn', 'in', txIds.slice(i, i + 30)).get()).docs.map(a => a.data()));
  const purchases = {
    owns: shop.get('owns') || {}, ctm: ctm.get('ctm') || '', env: paddle.get('env') === 'live' ? 'live' : 'sandbox',
    /* a basket: its products, and the lines this server asked Paddle to refund (refundItems) */
    tx: few(txs, t => ({ id: t.id, product: t.get('product') || '', products: [].concat(t.get('products') || []), t: when(t.get('paid')) || when(t.get('created')), status: t.get('status') || '', ok: t.get('ok') === true, sub: t.get('sub') || '', gift: !!t.get('gift'), payer: t.get('payer') || '',
      refund: t.get('refundWhy') || Object.values(t.get('refundItems') || {}).map(x => (x.p ? x.p + ': ' : '') + (x.why || '')).join(', '),
      adj: adjs.filter(a => a.txn === t.id).map(a => ({ action: a.action || '', status: a.status || '' })) }), 100) };
  const others = seen ? seen.docs.map(s => s.id).filter(id => id !== uid) : [];
  const names = others.length ? await db.getAll(...others.map(id => db.doc('summaries/' + id)), { fieldMask: ['name', 'reg', 't'] }) : [];
  const alts = names.map(s => ({ uid: s.id, name: s.get('name') || '', reg: s.get('reg') || '', t: s.get('t') || 0, at: (seen.docs.find(d => d.id === s.id)?.get('at')) || 0 }));
  const rep = d => ({ id: d.id, t: when(d.get('t')), reason: text(d.get('reason'), 40), note: text(d.get('note'), 300), kind: d.get('kind') || '', name: text(d.get('name'), 80), by: d.get('by') || '', target: d.get('target') || '' });
  return { nation, purchases, alts, reports: { against: few(against, rep), by: few(by, rep),
    tickets: few(tickets, d => ({ id: d.id, t: when(d.get('t')), topic: d.get('topic') || '', x: text(d.get('x'), 300), st: d.get('st') || '', n: Array.isArray(d.get('m')) ? d.get('m').length : 0 })),
    bugs: few(bugs, d => ({ id: d.id, t: when(d.get('t')), ti: text(d.get('ti'), 120), st: d.get('st') || '' })) },
    actions: acts.docs.map(e => ({ t: ms(e.get('at')), action: e.get('action') || '', reason: text(e.get('reason'), 200), actor: e.get('actor') || '', outcome: e.get('outcome') || '' })) };
}
/* The player's Chancery Club: what the shop worked out (shop/{uid}.vip) and any free membership an admin granted */
const clubState = (shop, comp) => {
  const v = shop.get('vip') || null;
  return { until: v?.until || 0, status: v?.status || '', plan: v?.plan || '', renews: v?.renews || 0, comp: comp.exists ? { at: comp.get('at') || 0, until: comp.get('until') || 0, by: comp.get('by') || '', why: comp.get('why') || '' } : null };
};
const CLUB_DAYS = [7, 30, 90, 365, 3650];
async function club(db, actor, data) {
  const target = id(data.uid), days = data.days, reason = text(data.reason, 500);
  if (days !== 0 && !CLUB_DAYS.includes(days)) throw new HttpsError('invalid-argument', 'Choose how long the membership lasts.');
  if (!reason) throw new HttpsError('invalid-argument', 'A reason is required.');
  const name = text((await db.doc('nations/' + target).get()).get('name'), 80), event = db.collection('adminAudit').doc();
  const common = { actor, action: days ? 'club_granted' : 'club_revoked', target, reason: days ? days + ' days: ' + reason : reason, ...(name ? { name } : {}), operation: event.id };
  try {
    await setComp(target, days ? Date.now() + days * 86400000 : 0, actor, reason);
    await event.create({ ...common, outcome: 'completed', at: FieldValue.serverTimestamp() });
  } catch (e) {
    await event.create({ ...common, outcome: 'failed', error: text(e.code || 'unknown', 64), at: FieldValue.serverTimestamp() });
    throw e;
  }
  const [shop, comp] = await db.getAll(db.doc('shop/' + target), db.doc('shopComp/' + target));
  return { club: clubState(shop, comp) };
}
/* A Shop pack given to a player for free, or taken back (functions/shop.js, setGrant): only a pack the player does not own
   yet, with a reason for the audit log. The player's Shop calls it a gift from the Edictum team. */
async function pack(db, actor, data) {
  const target = id(data.uid), p = text(data.p, 40), on = data.on === true, reason = text(data.reason, 500);
  if (!reason) throw new HttpsError('invalid-argument', 'A reason is required.');
  const name = text((await db.doc('nations/' + target).get()).get('name'), 80), event = db.collection('adminAudit').doc();
  const common = { actor, action: on ? 'pack_given' : 'pack_taken_back', target, pack: p, reason: p + ': ' + reason, ...(name ? { name } : {}), operation: event.id };
  try {
    const packs = await setGrant(target, p, on, actor, reason);
    await event.create({ ...common, outcome: 'completed', at: FieldValue.serverTimestamp() });
    return { packs };
  } catch (e) {
    await event.create({ ...common, outcome: 'failed', error: text(e.code || 'unknown', 64), at: FieldValue.serverTimestamp() });
    throw e;
  }
}
/* The staff's private notes on a player, in staffNotes/{uid}: read and written only here (the rules refuse every
   client) and never shown to the player. The audit log records each change, not the words, so a note is gone for
   good when it is deleted or the player deletes their account (functions/accounts.js). */
const NOTE_MAX = 4000, NOTES_KEEP = 60;
/* A case file, not one text: each note is an entry of its own {id, t, by, text}, so two admins reading the same player
   never write over each other, and what was said stays beside who said it and when. The newest is first; the oldest
   fall away past NOTES_KEEP. A note written before this release is read as a single entry, and is rewritten as one the
   next time anybody adds to the file. */
export const staffNote = s => {
  if (!s.exists) return { entries: [], at: 0, by: '' };
  const raw = Array.isArray(s.get('entries')) ? s.get('entries') : [];
  const entries = raw.filter(e => e && typeof e.text === 'string')
    .map(e => ({ id: text(e.id, 24), t: +e.t || 0, by: text(e.by, 128), text: String(e.text).slice(0, NOTE_MAX) }));
  const legacy = text(s.get('text'), NOTE_MAX);
  if (legacy && !entries.length) entries.push({ id: 'first', t: +s.get('at') || 0, by: text(s.get('by'), 128), text: legacy });
  entries.sort((a, b) => b.t - a.t);
  return { entries, at: +s.get('at') || 0, by: text(s.get('by'), 128) };
};
async function note(db, actor, data) {
  const target = id(data.uid), action = text(data.action, 8) || 'add';
  if (!['add', 'drop'].includes(action)) throw new HttpsError('invalid-argument', 'Unknown note action.');
  const body = typeof data.text === 'string' ? data.text.replace(/\r\n?/g, '\n').trim().slice(0, NOTE_MAX) : '';
  const drop = text(data.id, 24);
  if (action === 'add' && !body) throw new HttpsError('invalid-argument', 'Write a note first.');
  if (action === 'drop' && !drop) throw new HttpsError('invalid-argument', 'Name the note to delete.');
  const ref = db.doc('staffNotes/' + target), event = db.collection('adminAudit').doc(), now = Date.now();
  const name = text((await db.doc('nations/' + target).get()).get('name'), 80);
  let out = null;
  await db.runTransaction(async tx => {
    const cur = staffNote(await tx.get(ref)).entries;
    const entries = action === 'add'
      ? [{ id: event.id.slice(0, 24), t: now, by: actor, text: body }, ...cur].slice(0, NOTES_KEEP)
      : cur.filter(e => e.id !== drop);
    if (entries.length) tx.set(ref, { entries, at: now, by: actor }); else tx.delete(ref);
    /* the audit log keeps who changed the file and how much, never the words */
    tx.create(event, { actor, action: action === 'add' ? 'note_saved' : entries.length ? 'note_deleted' : 'note_cleared', target,
      reason: action === 'add' ? body.length + ' characters' : 'A note was deleted', ...(name ? { name } : {}), operation: event.id, outcome: 'completed', at: FieldValue.serverTimestamp() });
    out = { entries, at: now, by: actor };
  });
  return { staffNote: out };
}
async function health(db) {
  const qs = await db.collection('saveHealth').where('t', '>', Timestamp.fromMillis(Date.now() - 86400000)).orderBy('t', 'desc').limit(250).get();
  const uids = [...new Set(qs.docs.map(d => d.get('uid')))];
  const ns = uids.length ? await db.getAll(...uids.map(uid => db.doc('nations/' + uid)), { fieldMask: ['name', 'reg', 'rev', 'ts'] }) : [];
  const nations = new Map(ns.map(n => [n.id, n.data() || {}]));
  return { at: Date.now(), limited: qs.size === 250, sessions: qs.docs.map(d => {
    const s = d.data(), n = nations.get(s.uid) || {};
    return { id: d.id, uid: s.uid, reg: n.reg || s.reg, name: n.name || s.uid, device: s.device, status: s.status, pending: s.pending, error: s.error, conflicts: s.conflicts, revision: s.revision, t: ms(s.t), savedAt: ms(n.ts), serverRevision: n.rev || 0 };
  }) };
}
/* Online players: every session that reported in the last ONLINE_MS, one row per player (their latest tab), with the
   page that tab is on (saveHealth.pg, newer game versions) and the nation's name, region and flag from its save. */
async function onlinePlayers(db) {
  const qs = await db.collection('saveHealth').where('t', '>', Timestamp.fromMillis(Date.now() - ONLINE_MS)).orderBy('t', 'desc').limit(1000).get();
  const latest = new Map(), tabs = new Map();
  for (const d of qs.docs) { const u = d.get('uid'); if (!u) continue; tabs.set(u, (tabs.get(u) || 0) + 1); if (!latest.has(u)) latest.set(u, d.data()); }
  const uids = [...latest.keys()];
  const ns = uids.length ? await db.getAll(...uids.map(u => db.doc('nations/' + u)), { fieldMask: ['name', 'reg', 'j', 'z'] }) : [];
  /* the flag lives inside the nation's JSON text (j), not as a field of its own */
  const flagOf = j => { try { const f = JSON.parse(j || '{}').flag; return f && typeof f === 'object' ? f : null; } catch { return null; } };
  const nations = new Map(ns.map(n => { const d = n.data() || {}; return [n.id, { name: d.name, reg: d.reg, flag: flagOf(nationText(d)) }]; }));
  return { at: Date.now(), limited: qs.size === 1000, players: uids.map(u => {
    const s = latest.get(u), n = nations.get(u) || {};
    return { uid: u, name: text(n.name, 80) || u, reg: n.reg || s.reg, flag: n.flag, pg: text(s.pg, 40), device: s.device, status: s.status, tabs: tabs.get(u), t: ms(s.t) };
  }) };
}
async function audit(db, data) {
  let q = db.collection('adminAudit');
  if (text(data.target)) q = q.where('target', '==', text(data.target));
  q = q.orderBy('at', 'desc').limit(50);
  if (text(data.after)) { const cursor = await db.doc('adminAudit/' + id(data.after)).get(); if (cursor.exists) q = q.startAfter(cursor); }
  const qs = await q.get();
  return { events: qs.docs.map(d => ({ id: d.id, ...d.data(), at: ms(d.get('at')) })), next: qs.size === 50 ? qs.docs.at(-1).id : null };
}
/* The Statistics page (functions/stats.js): every nation and account is read once and kept for ten minutes per
   instance, so moving between regions costs nothing; 'refresh' counts again. Two requests at once share one count. */
let counted = null, counting = null;
async function stats(db, data) {
  const reg = text(data.reg, 40);
  if (reg && !REGIONS.has(reg)) throw new HttpsError('invalid-argument', 'Choose a region.');
  if (!counted || data.refresh === true || Date.now() - counted.at > 600000) {
    counting = counting || gather(db, (max, token) => getAuth().listUsers(max, token), { regions: [...REGIONS] })
      .then(async g => { counted = g; await saveEngage(db, g).then(() => { engaged = null; }, () => {}); return g; }).finally(() => { counting = null; });
    await counting;
  }
  if (!counted.more) counted.more = await gatherMore(db, counted.at);
  return { ...summarize(counted, reg), more: moreSummary(counted, counted.more, reg) };
}
/* One nation in full for the Statistics page's Nations tab (functions/stats-acts.js, nationDetail): read fresh, both
   halves joined as functions/stats.js nationRow joins them. Never the own half (nationp): a player's letters stay theirs. */
async function statsNation(db, data) {
  const uid = id(data.uid);
  const [s, x] = await Promise.all([db.doc('nations/' + uid).get(), db.doc('nationx/' + uid).get()]);
  if (!s.exists) throw new HttpsError('not-found', 'That nation no longer exists.');
  const parse = t => { try { const v = JSON.parse(t); return v && typeof v === 'object' && !Array.isArray(v) ? v : null; } catch { return null; } };
  const shared = s.data(), txt = nationText(shared), own = txt != null ? parse(txt) : shared;
  if (!own) throw new HttpsError('failed-precondition', 'That nation’s record could not be read.');
  const r = Object.assign({}, parse(x.exists ? x.get('j') : null) || {}, own);
  if (!r.reg) r.reg = shared.reg; if (!r.name) r.name = shared.name; if (!r.updatedAt) r.updatedAt = shared.updatedAt;
  const now = Date.now(), row = nationRow(uid, shared, x.exists ? x.data() : null, now);
  return { ...nationDetail(uid, r, now), eng: row?.eng || null, style: row?.style || '', features: row ? row.f.concat(row.f2 || []) : [] };
}
/* Export everything (the Statistics page's Export button): the world and every region as the page counts them, every
   nation's row (no account details: no email, IP or sign-in), the shop, for a spreadsheet or an AI to read. */
async function statsExport(db) {
  const world = await stats(db, {});
  const regions = {};
  for (const r of REGIONS) regions[r] = await stats(db, { reg: r });
  const shop = await shopStats(db);
  const nations = counted.rows.map(x => ({ id: x.id, reg: x.reg, name: x.name, pop: x.pop, founded: x.founded, lastActive: x.t, decided: x.dec,
    decided14d: x.r14, daysPlayed14d: x.d14, cities: x.cities, claims: x.claims, edictPace: x.freq, inbox: x.inbox, engagement: x.eng?.[0] ?? null,
    tutorialSteps: x.tut.length, tutorialLists: x.lists, features: x.f.concat(x.f2 || []), edictsInForce: x.pol || [], achievements: x.ach || [],
    styleThisWeek: x.style, actionsThisWeek: x.a7, lastAction: x.last, buildings: x.bld, lifetime: x.life }));
  return { at: counted.at, world, regions, shop, nations };
}
/* What a removal or a ban would take with it, counted before the admin confirms it rather than described in prose.
   Counts only (aggregation queries): nothing is read in full and nothing is changed. */
async function impact(db, data) {
  const target = id(data.uid);
  const n = async q => { try { return (await q.count().get()).data().count; } catch { return null; } };
  const [nation, ban, posts, chat, reports, space] = await Promise.all([
    db.doc('nations/' + target).get(), db.doc('bans/' + target).get(),
    n(db.collectionGroup('posts').where('a', '==', target)),
    n(db.collectionGroup('chat').where('a', '==', target)),
    n(db.collection('reports').where('target', '==', target)),
    db.doc('space/' + target).get()]);
  const d = nation.data() || {};
  return { uid: target, at: Date.now(), exists: nation.exists, name: text(d.name, 80), reg: text(d.reg, 40),
    pop: +d.pop || 0, claims: +d.cl || 0, army: +d.army || 0, space: space.exists,
    posts, chat, reports, banned: ban.exists, banUntil: banUntil(ban) };
}
async function balance(db, data) {
  const reg = text(data.reg, 40);
  if (reg && !REGIONS.has(reg)) throw new HttpsError('invalid-argument', 'Choose a region.');
  await stats(db, { refresh: data.refresh === true });
  return { ...balanceOf(counted.rows.filter(r => !reg || r.reg === reg), counted.at), reg };
}
/* The Shop statistics page (functions/shop-stats.js): the shop's billing records are few, so they are read whole
   each time; the latest sales name their nations. */
async function shopStats(db) {
  const [cfg, tx, sub, adj, ck, fg, fw, fx, gr] = await Promise.all([db.doc('authConfig/paddle').get(), db.collection('shopTx').get(), db.collection('shopSubs').get(),
    db.collection('shopAdj').get(), db.collection('shopCheckouts').get(), db.collection('shopFGift').get(), db.collection('founders').select().get(), euroRates(db),
    db.collection('shopGrant').get()]);
  const all = q => q.docs.map(d => ({ id: d.id, ...d.data() }));
  const env = cfg.exists ? (cfg.get('env') === 'live' ? 'live' : cfg.get('env') || 'sandbox') : '';
  const out = shopSummary({ txs: all(tx), subs: all(sub), adjs: all(adj), cks: all(ck) }, Date.now(), env);
  /* the founders' thank-you gift: which pack each founder chose */
  out.fgift = founderGiftSummary(fg.docs.map(d => ({ uid: d.id, ...d.data() })), fw.docs.map(d => d.id), Date.now());
  /* the packs admins gave for free */
  out.given = grantSummary(gr.docs.map(d => ({ uid: d.id, p: d.get('p') })));
  const uids = [...new Set([...out.recent.flatMap(r => [r.uid, r.payer]), ...out.fgift.recent.map(r => r.uid), ...out.given.recent.map(r => r.uid)].filter(Boolean))];
  const names = {};
  if (uids.length) for (const n of await db.getAll(...uids.map(u => db.doc('nations/' + u)), { fieldMask: ['name'] })) if (n.exists) names[n.id] = text(n.get('name'), 80);
  if (!counted) await stats(db, {});
  return { ...out, on: cfg.exists, names, timing: buyerTiming(all(tx), counted.rows), fx };
}
/* The page shows money in euro and Mexican peso: the ECB's rates (functions/shop-stats.js, parseEcb), fetched at most every
   six hours and kept in shopMeta/ecb, so when the ECB cannot be reached the last rates still serve (marked stale). Null when
   there have never been any. */
async function euroRates(db) {
  const ref = db.doc('shopMeta/ecb'), s = await ref.get(), have = s.exists ? s.data() : null, now = Date.now();
  const out = (v, stale) => ({ date: v.date, rates: v.rates, at: v.at, ...(stale ? { stale: true } : {}) });
  if (have && have.rates && now - (Number(have.at) || 0) < 6 * 3600000) return out(have);
  try {
    const r = await fetch(ECB_URL, { signal: AbortSignal.timeout(6000) }), got = r.ok ? parseEcb(await r.text()) : null;
    if (got) { const v = { ...got, at: now }; await ref.set(v); return out(v); }
    console.warn('ecb rates: the answer held no rates', r.status);
  } catch (e) { console.warn('ecb rates:', e.message); }
  return have && have.rates ? out(have, true) : null;
}
async function setRegion(db, actor, data) {
  const target = id(data.reg), reason = text(data.reason, 300);
  if (!REGIONS.has(target) || typeof data.enabled !== 'boolean' || !reason) throw new HttpsError('invalid-argument', 'Choose a region, availability and a reason.');
  const mode = data.enabled ? 'enabled' : data.mode ?? 'maintenance';
  if (!['enabled', 'maintenance', 'coming_soon'].includes(mode) || (!data.enabled && mode === 'enabled')) throw new HttpsError('invalid-argument', 'Choose Maintenance or Coming soon.');
  const ref = db.doc('regionStatus/' + target), event = db.collection('adminAudit').doc();
  await db.runTransaction(async tx => {
    const previous = await tx.get(ref), before = previous.get('enabled') !== false;
    const beforeMode = before ? 'enabled' : previous.get('mode') === 'coming_soon' ? 'coming_soon' : 'maintenance';
    // Public availability contains no staff notes or actor identity; those belong to the private audit. Merged, so the
    // region keeps its mark as the default for newcomers (def, regionDefault) through a change of status.
    tx.set(ref, { enabled: data.enabled, mode, at: FieldValue.serverTimestamp() }, { merge: true });
    tx.create(event, { actor, action: data.enabled ? 'region_enabled' : 'region_disabled', target, reason, before, after: data.enabled, beforeMode, mode, outcome: 'completed', at: FieldValue.serverTimestamp() });
  });
  return { ok: true };
}
/* The region newcomers are shown first on the front page (game/edictum.html, hmDef; functions/home.js copies it into
   home/live): one regionStatus/<id> marked def, which every visitor already reads. reg '' clears it, and newcomers get
   the game's own (FIRST_REG). Only an open region: a closed one, or one coming soon with no status of its own, is refused. */
async function setDefaultRegion(db, actor, data) {
  const target = text(data.reg, 40);
  if (target && !REGIONS.has(target)) throw new HttpsError('invalid-argument', 'Choose a region.');
  const event = db.collection('adminAudit').doc();
  await db.runTransaction(async tx => {
    const marked = await tx.get(db.collection('regionStatus').where('def', '==', true));
    const ref = target ? db.doc('regionStatus/' + target) : null, cur = ref ? await tx.get(ref) : null;
    if (ref && regionClosed(cur, target)) throw new HttpsError('failed-precondition', 'Open the region before making it the default.');
    const before = marked.docs.map(d => d.id).join(',');
    for (const d of marked.docs) if (d.id !== target) tx.update(d.ref, { def: FieldValue.delete() });
    // a region with no status of its own yet gets a whole one: the rules read enabled from any that exists (regionEnabled)
    if (ref) tx.set(ref, cur.exists ? { def: true } : { def: true, enabled: true, mode: 'enabled', at: FieldValue.serverTimestamp() }, { merge: true });
    tx.create(event, { actor, action: 'region_default', target: target || '-', before: before || '-', after: target || '-', outcome: 'completed', at: FieldValue.serverTimestamp() });
  });
  return { ok: true, reg: target };
}
const AD_KEEP = 12 * 86400000;
async function adOff(db, reg, key, now, field = 'x', keep = AD_KEEP) {
  const ref = db.doc('press/' + reg);
  await db.runTransaction(async tx => {
    const s = await tx.get(ref), x = { ...(s.get(field) || {}) };
    for (const k of Object.keys(x)) if (!(Number(x[k]) > now - keep)) delete x[k];
    x[key] = now;
    tx.set(ref, { [field]: x }, { mergeFields: [field] });
  });
}
// a removed Flock peep stays struck out this long: its author's game drops it from their record when it next reads
// the list, and a peep older than this only shows inside an old quote
const FLK_KEEP = 180 * 86400000;
const MOD_ACTIONS = ['delete_post', 'close_report'];
/* How long a ban lasts, in days; 0 is until an admin lifts it (functions/bans.js explains how one is lifted). */
export const BAN_DAYS = [1, 3, 7, 30, 90, 0];
const banUntil = b => +b.get('until') || 0;
/* an admin appoints a moderator, or stands one down: the custom claim mod (the player's game sees it at the next load) and
   staff/<uid> {t, m: true}, which shows the other players the green Mod pill at once. A moderator is no longer an
   ambassador (setAmb): the moderator's powers hold the ambassador's */
async function setMod(db, actor, data) {
  const uid = id(data.uid), on = data.on === true;
  if (!uid) throw new HttpsError('invalid-argument', 'Choose a player.');
  let u;
  try { u = await getAuth().getUser(uid); } catch (e) { throw new HttpsError('not-found', 'No such player.'); }
  const claims = { ...(u.customClaims || {}) };
  if (on && claims.admin === true) throw new HttpsError('failed-precondition', 'That player is already an admin.');
  const wasAmb = on && claims.amb === true;
  if (on) { claims.mod = true; delete claims.amb; } else delete claims.mod;
  await getAuth().setCustomUserClaims(uid, claims);
  if (on) await db.doc('staff/' + uid).set({ t: Date.now(), m: true });
  else if (claims.admin !== true) await db.doc('staff/' + uid).delete();
  if (wasAmb) await db.doc('ambassadors/' + uid).delete();
  const nation = await db.doc('nations/' + uid).get();
  await db.collection('adminAudit').doc().set({ actor, action: on ? 'mod_appointed' : 'mod_removed', target: uid, ...(nation.exists ? { name: text(nation.get('name'), 80) } : {}),
    reason: on ? 'Appointed as moderator' : 'No longer a moderator', outcome: 'completed', at: FieldValue.serverTimestamp() });
  return { uid, mod: on };
}
/* an admin appoints an Edictum Ambassador, or stands one down: the custom claim amb (their game sees it at the next load)
   and ambassadors/<uid> {t}, which shows every player the blue Ambassador pill at once. An ambassador may only silence
   players in the chats (functions/regionchat.js, rcMute): no portal, no console, no deleting. Staff are not appointed */
async function setAmb(db, actor, data) {
  const uid = id(data.uid), on = data.on === true;
  let u;
  try { u = await getAuth().getUser(uid); } catch (e) { throw new HttpsError('not-found', 'No such player.'); }
  const claims = { ...(u.customClaims || {}) };
  if (on && (claims.admin === true || claims.mod === true)) throw new HttpsError('failed-precondition', 'That player is already Edictum staff.');
  if (on) claims.amb = true; else delete claims.amb;
  await getAuth().setCustomUserClaims(uid, claims);
  if (on) await db.doc('ambassadors/' + uid).set({ t: Date.now() });
  else await db.doc('ambassadors/' + uid).delete();
  const nation = await db.doc('nations/' + uid).get();
  await db.collection('adminAudit').doc().set({ actor, action: on ? 'amb_appointed' : 'amb_removed', target: uid, ...(nation.exists ? { name: text(nation.get('name'), 80) } : {}),
    reason: on ? 'Appointed as ambassador' : 'No longer an ambassador', outcome: 'completed', at: FieldValue.serverTimestamp() });
  return { uid, amb: on };
}
async function modsList(db) {
  const qs = await db.collection('staff').where('m', '==', true).get();
  const rows = await Promise.all(qs.docs.map(async d => { const n = await db.doc('nations/' + d.id).get(); return { uid: d.id, name: text(n.get('name'), 80), reg: text(n.get('reg'), 40), t: +d.get('t') || 0 }; }));
  return { mods: rows };
}
async function mutate(db, actor, data) {
  const action = text(data.action, 40), target = id(data.target), reason = text(data.reason, 300) || 'Admin console action';
  const allowed = ['hide', 'rename', 'unhide', 'remove', 'ban', 'unban', 'delete_post', 'close_report', 'press_reset', 'support_reply', 'support_answer', 'support_close', 'support_reopen', 'support_delete'];
  if (!allowed.includes(action)) throw new HttpsError('invalid-argument', 'Unknown admin action.');
  if (['hide', 'rename', 'remove', 'ban'].includes(action) && target === actor) throw new HttpsError('failed-precondition', 'You cannot moderate your own account.');
  /* how long a ban lasts: a whole number of days from the list, or 0 for until an admin lifts it */
  const days = action === 'ban' && Number.isInteger(data.days) && BAN_DAYS.includes(data.days) ? data.days : 0;
  /* the term goes in a field of its own: `reason` stays the words the player was told, which the log is read for */
  const event = db.collection('adminAudit').doc();
  const common = { actor, action, target, reason, operation: event.id, ...(action === 'ban' ? { days } : {}) };
  // Record intent before a multi-document cleanup, and its outcome separately, so a partial failure is visible.
  await event.create({ ...common, outcome: 'started', at: FieldValue.serverTimestamp() });
  try {
    const nation = await db.doc('nations/' + target).get(), name = text(nation.get('name'), 80) || text(data.name, 80);
    const now = Date.now();
    if (action === 'hide') await db.doc('mod/' + target).set({ hidden: true, note: reason, name, t: now, by: actor });
    // A forced rename hides the nation until its player saves it under a name other than this one; the game asks
    // functions/civic.js ('renamed') to check that and show the nation again.
    if (action === 'rename') {
      if (!nation.exists) throw new HttpsError('failed-precondition', 'This player has no nation to rename.');
      await db.doc('mod/' + target).set({ hidden: true, rename: true, note: reason, name, t: now, by: actor });
    }
    if (action === 'unhide') await db.doc('mod/' + target).delete();
    if (action === 'unban') {
      await db.doc('bans/' + target).delete();
      const marks = await db.collection('banIds').where('u', '==', target).get();
      if (!marks.empty) { const b = db.batch(); marks.docs.forEach(d => b.delete(d.ref)); await b.commit(); }
    }
    if (action === 'remove' || action === 'ban') {
      // Publish the ban/tombstone together with removal; open browsers follow the tombstone.
      const b = db.batch();
      b.set(db.doc('mod/' + target), { hidden: false, removed: now, note: reason, name, t: now, by: actor });
      if (action === 'ban') {
        b.set(db.doc('bans/' + target), { note: reason, name, t: now, by: actor, ...(days ? { until: now + days * 86400000 } : {}) });
        // the sign-ins it uses (functions/eligibility.js, identityHashes), so a new account on them is banned too
        for (const h of await banMarks(target)) b.set(db.doc('banIds/' + h), { u: target, t: now });
      }
      // and the size it last saved at (functions/civic.js, createCap): a nation founded again starts afresh
      b.set(db.doc('accountIdentity/' + target), { hw: FieldValue.delete() }, { merge: true });
      ['nations', 'nationx', 'nationp', 'summaries', 'space'].forEach(c => b.delete(db.doc(c + '/' + target)));
      await b.commit();
      await alDrop(db, target);
      await trDrop(db, target);
      await bdDrop(db, target);
      await jvDrop(db, target);
      await rdForget(db, target);
      const chat = await db.collectionGroup('chat').where('a', '==', target).get();
      if (!chat.empty) { const w = db.bulkWriter(); await Promise.all([Promise.all(chat.docs.map(d => w.delete(d.ref))), w.close()]); }
      const [posts, reports] = await Promise.all([db.collectionGroup('posts').where('a', '==', target).get(), db.collection('reports').where('target', '==', target).get()]);
      const writer = db.bulkWriter(), writes = posts.docs.concat(reports.docs).map(d => writer.delete(d.ref)); await Promise.all([Promise.all(writes), writer.close()]);
      await rmbForget(db, target, REGIONS);
      await cbForget(db, target);
      await rcForget(db, target, REGIONS);
      await fcForget(db, target);
    }
    // a reported comment on development news is news:<post>:<comment>; anything else is a region board post
    const news = action === 'delete_post' && /^news:([A-Za-z0-9]{20}):([A-Za-z0-9]{20})$/.exec(target);
    if (news) await db.doc('devnews/' + news[1] + '/posts/' + news[2]).delete();
    // and a Community Board post is cb:<region>:<topic>[:<reply>] (functions/board.js keeps the counts right)
    const cb = action === 'delete_post' && /^cb:([a-z]{2,40}):([A-Za-z0-9]{20})(?::([A-Za-z0-9]{20}))?$/.exec(target);
    if (cb) await cbDelete(db, { uid: actor, admin: true }, { reg: cb[1], topic: cb[2], ...(cb[3] ? { reply: cb[3] } : {}), reason }, new Set([cb[1]]));
    // a line of a region chat is rc:<region>:<line> (functions/regionchat.js), of a shared chat rc:world:<line> or
    // rc:fr:<line>, with the picture it may carry; the audit entry below keeps who removed it
    const rc = action === 'delete_post' && /^rc:([a-z]{2,40}):([A-Za-z0-9]{20})$/.exec(target);
    if (rc) {
      if (!REGIONS.has(rc[1]) && !rcShared(rc[1])) throw new HttpsError('invalid-argument', 'Choose a region.');
      const b = db.batch();
      b.delete(db.doc('rchat/' + rc[1] + '/chat/' + rc[2])); b.delete(db.doc('rcimg/' + rc[1] + '/chat/' + rc[2]));
      await b.commit();
    }
    // a classified advertisement in the region's newspaper is ad:<region>:<player>:<ad>. It lives in the player's own
    // record, which only their game writes, so it is struck out in press/<region>.x, which every reader of the paper
    // follows; entries older than the longest an advertisement is kept (12 days) go at the same time
    const ad = action === 'delete_post' && !cb && !news && !rc && /^ad:([a-z]{2,40}):([\w-]{1,128}):([a-z0-9]{1,12})$/.exec(target);
    // a leader's Flock peep is flk:<player>:<time>, also in the player's own record: struck out in press/<region>.fk
    const flk = action === 'delete_post' && !cb && !news && !rc && !ad && /^flk:([\w-]{1,128}):(\d{10,16})$/.exec(target);
    if (ad) {
      if (!REGIONS.has(ad[1])) throw new HttpsError('invalid-argument', 'Choose a region.');
      await adOff(db, ad[1], ad[2] + '_' + ad[3], now);
    } else if (flk) {
      if (!REGIONS.has(text(data.reg))) throw new HttpsError('invalid-argument', 'Choose a region.');
      await adOff(db, text(data.reg), flk[1] + '_' + flk[2], now, 'fk', FLK_KEEP);
    } else if (action === 'delete_post' && !news && !cb && !rc) { if (!REGIONS.has(text(data.reg))) throw new HttpsError('invalid-argument', 'Choose a region.'); await db.doc('boards/' + data.reg + '/posts/' + target).delete(); }
    if (action === 'close_report') await db.doc('reports/' + target).delete();
    // the newspaper's name and motto as a Delegate chose them (functions/civic.js, paper): back to the paper's own
    if (action === 'press_reset') {
      if (!REGIONS.has(target)) throw new HttpsError('invalid-argument', 'Choose a region.');
      await db.doc('press/' + target).set({ nm: '', mo: '', by: FieldValue.delete(), bn: FieldValue.delete(), t: now }, { merge: true });
    }
    // a reply keeps the ticket open (the player's turn); an answer closes it (functions/support.js)
    if (action.startsWith('support_')) await supportAdmin(db, actor, action, target, data.reply);
    if (text(data.report)) await db.doc('reports/' + id(data.report)).delete();
    await db.collection('adminAudit').add({ ...common, name, outcome: 'completed', at: FieldValue.serverTimestamp() });
    directoryAt = 0;
    return { ok: true };
  } catch (e) {
    await db.collection('adminAudit').add({ ...common, outcome: 'failed', error: text(e.code || 'unknown', 64), at: FieldValue.serverTimestamp() });
    throw e;
  }
}
/* The watchlist: players the staff follow, watch/{uid} {by, at, why, base}, base being their nation as it was when
   they were added, to compare with now. Read and written only here (the rules refuse every client), each change in the
   audit log, and deleted with the player's account (functions/accounts.js). The alerts job reports what they do. */
const watchState = s => s.exists ? { at: s.get('at') || 0, by: s.get('by') || '', why: s.get('why') || '' } : null;
const glance = r => r ? { name: r.name, reg: r.reg, pop: r.pop, cities: r.cities, claims: r.claims, dec: r.dec, t: r.t } : null;
async function watchOp(db, actor, data) {
  const action = text(data.action, 10), now = Date.now();
  if (action === 'add' || action === 'remove') {
    const target = id(data.uid), why = text(data.why, 200), ref = db.doc('watch/' + target), event = db.collection('adminAudit').doc();
    if (action === 'add' && !why) throw new HttpsError('invalid-argument', 'Say why you are watching this player.');
    const [n, x] = await db.getAll(db.doc('nations/' + target), db.doc('nationx/' + target));
    const r = n.exists ? nationRow(target, n.data(), x.exists ? x.data() : null, now) : null;
    await db.runTransaction(async tx => {
      if (action === 'add') tx.set(ref, { by: actor, at: now, why, base: glance(r) }); else tx.delete(ref);
      tx.create(event, { actor, action: action === 'add' ? 'watch_added' : 'watch_removed', target, reason: why || 'Taken off the watchlist', ...(r?.name ? { name: r.name } : {}),
        operation: event.id, outcome: 'completed', at: FieldValue.serverTimestamp() });
    });
    return { watch: action === 'add' ? { at: now, by: actor, why } : null };
  }
  /* the list: each player now beside when they were added, their open reports, and what they did in the last week */
  const qs = await db.collection('watch').orderBy('at', 'desc').limit(200).get(), uids = qs.docs.map(d => d.id);
  const [on, halves, reports] = await Promise.all([online(db), uids.length ? db.getAll(...uids.flatMap(u => [db.doc('nations/' + u), db.doc('nationx/' + u)])) : [],
    Promise.all(uids.map(u => db.collection('reports').where('target', '==', u).count().get().then(s => s.data().count, () => null)))]);
  const rows = qs.docs.map((d, i) => {
    const n = halves[2 * i], x = halves[2 * i + 1], r = n.exists ? nationRow(d.id, n.data(), x.exists ? x.data() : null, now) : null;
    return { uid: d.id, why: d.get('why') || '', by: d.get('by') || '', at: d.get('at') || 0, base: d.get('base') || null, now: glance(r), eng: r?.eng || null, on: on.has(d.id), reports: reports[i] };
  });
  const recent = uids.length ? (await feed(db, { span: 'd7', uids })).events.slice(0, 150) : [];
  return { at: now, rows, recent };
}
/* Staff alerts (functions/alerts.js files them from the alerts job): the latest, how many are unseen, the thresholds
   (adminCfg/alerts) and how the job last ran (alertState/run). */
async function alertsOp(db, actor, data) {
  const action = text(data.action, 10) || 'list';
  const unseen = () => db.collection('adminAlerts').where('seen', '==', false).count().get().then(s => s.data().count, () => 0);
  if (action === 'count') return { unseen: await unseen() };
  if (action === 'seen') {
    const ids = Array.isArray(data.ids) ? data.ids.map(v => text(v, 300)).filter(v => v && !v.includes('/')).slice(0, 300) : null;
    const docs = ids ? (ids.length ? await db.getAll(...ids.map(i => db.doc('adminAlerts/' + i))) : []).filter(d => d.exists)
      : (await db.collection('adminAlerts').where('seen', '==', false).limit(450).get()).docs;
    for (let i = 0; i < docs.length; i += 450) { const b = db.batch(); docs.slice(i, i + 450).forEach(d => b.update(d.ref, { seen: true })); await b.commit(); }
    return { marked: docs.length, unseen: await unseen() };
  }
  const cfgRef = db.doc('adminCfg/alerts');
  if (action === 'cfg') {
    const before = await cfgRef.get(), cfg = alertConfig({ ...(before.exists ? before.data() : {}), ...(data.cfg && typeof data.cfg === 'object' ? data.cfg : {}) });
    const event = db.collection('adminAudit').doc();
    await db.runTransaction(async tx => {
      tx.set(cfgRef, cfg);
      tx.create(event, { actor, action: 'alerts_config', target: 'alerts', reason: Object.entries(cfg).map(([k, v]) => k + ' ' + v).join(', ').slice(0, 300), operation: event.id, outcome: 'completed', at: FieldValue.serverTimestamp() });
    });
    return { cfg };
  }
  const [qs, cfg, st, n] = await Promise.all([db.collection('adminAlerts').orderBy('t', 'desc').limit(150).get(), cfgRef.get(), db.doc('alertState/run').get(), unseen()]);
  return { alerts: qs.docs.map(d => ({ id: d.id, ...d.data() })), unseen: n, cfg: alertConfig(cfg.exists ? cfg.data() : null), defaults: ALERT_DEFAULTS,
    run: st.exists ? { at: st.get('at') || 0, discord: st.get('discord') || '', filed: st.get('filed') || 0 } : null };
}
/* The Live feed (functions/feed.js) and how many play now */
async function feedOp(db, data) {
  const span = SPANS[text(data.span, 4)] ? text(data.span, 4) : 'h6', reg = text(data.reg, 40);
  if (reg && !REGIONS.has(reg)) throw new HttpsError('invalid-argument', 'Choose a region.');
  const known = new Set(Object.values(GROUP)), groups = Array.isArray(data.groups) ? data.groups.map(g => text(g, 12)).filter(g => known.has(g)) : null;
  const [d, on] = await Promise.all([feed(db, { span, reg, groups, refresh: data.refresh === true }), online(db, data.refresh === true)]);
  return { ...d, online: on.size };
}
/* Letters between players (letters/, written by the game, kept a year): who a player writes to, and one
   conversation in full. Every look is an adminAudit event; reading a conversation needs a stated reason, which the
   audit keeps. The player is not told. */
const LT_LIST = 1000, LT_THREAD = 300;
async function lettersOp(db, actor, data) {
  const uid = id(data.uid), other = data.with ? id(data.with) : '', event = db.collection('adminAudit').doc();
  const name = text((await db.doc('nations/' + uid).get()).get('name'), 80);
  if (!other) {
    const [out, inn] = await Promise.all([
      db.collection('letters').where('by', '==', uid).select('to', 't').limit(LT_LIST).get(),
      db.collection('letters').where('to', '==', uid).select('by', 't').limit(LT_LIST).get()]);
    const per = new Map(), add = (w, t, dir) => { const c = per.get(w) || { uid: w, sent: 0, got: 0, last: 0 }; c[dir]++; if (t > c.last) c.last = t; per.set(w, c); };
    for (const d of out.docs) add(d.get('to'), +d.get('t') || 0, 'sent');
    for (const d of inn.docs) add(d.get('by'), +d.get('t') || 0, 'got');
    const ids = [...per.keys()], ns = ids.length ? await db.getAll(...ids.map(u => db.doc('nations/' + u)), { fieldMask: ['name', 'reg'] }) : [];
    for (const n of ns) { const c = per.get(n.id); c.name = text(n.get('name'), 80) || ''; c.reg = text(n.get('reg'), 40) || ''; }
    await event.create({ actor, action: 'letters_listed', target: uid, reason: ids.length + ' correspondents', ...(name ? { name } : {}), operation: event.id, outcome: 'completed', at: FieldValue.serverTimestamp() });
    return { uid, limited: out.size === LT_LIST || inn.size === LT_LIST, people: [...per.values()].sort((a, b) => b.last - a.last) };
  }
  const reason = text(data.reason, 300);
  if (reason.length < 5) throw new HttpsError('invalid-argument', 'Say why you are reading this conversation (at least 5 characters). The reason is kept in the audit log.');
  const [a, b] = await Promise.all([
    db.collection('letters').where('by', '==', uid).where('to', '==', other).limit(LT_THREAD).get(),
    db.collection('letters').where('by', '==', other).where('to', '==', uid).limit(LT_THREAD).get()]);
  const letters = [...a.docs, ...b.docs].map(d => ({ id: d.id, by: d.get('by'), to: d.get('to'), x: text(d.get('x'), 2500), t: +d.get('t') || 0, ...(d.get('g') ? { g: true } : {}) }))
    .sort((p, q) => p.t - q.t).slice(-LT_THREAD);
  const otherName = text((await db.doc('nations/' + other).get()).get('name'), 80);
  await event.create({ actor, action: 'letters_read', target: uid, with: other, reason, ...(name ? { name } : {}), operation: event.id, outcome: 'completed', at: FieldValue.serverTimestamp() });
  return { uid, with: other, name, otherName, limited: a.size === LT_THREAD || b.size === LT_THREAD, letters };
}
/* Alliances page: every alliance in every region, and (op alChat) one alliance's members' channel, read by an admin
   and kept in the audit log */
async function alliancesList(db) {
  const qs = await db.collection('alliances').select('reg', 'name', 'mo', 'ty', 'acc', 't', 'ld', 'mem', 'npc', 'xp', 'rel').limit(2000).get();
  const uids = [...new Set(qs.docs.flatMap(d => Object.keys(d.get('mem') || {})))].filter(u => /^[\w-]{1,128}$/.test(u));
  const names = {};
  for (let i = 0; i < uids.length; i += 300) for (const n of await db.getAll(...uids.slice(i, i + 300).map(u => db.doc('nations/' + u)), { fieldMask: ['name'] })) if (n.exists) names[n.id] = text(n.get('name'), 80);
  const rows = qs.docs.map(d => {
    const mem = d.get('mem') || {}, rel = d.get('rel') || {};
    return { aid: d.id, reg: text(d.get('reg'), 40), name: text(d.get('name'), 80), mo: text(d.get('mo'), 120), ty: text(d.get('ty'), 24), acc: text(d.get('acc'), 24),
      t: +d.get('t') || 0, ld: d.get('ld') || '', xp: +d.get('xp') || 0, npc: Object.keys(d.get('npc') || {}).length,
      mem: Object.entries(mem).map(([u, m]) => ({ uid: u, name: names[u] || '', r: u === d.get('ld') ? 'ld' : m && m.r === 'o' ? 'o' : 'm', t: +(m && m.t) || 0 })),
      pacts: Object.values(rel).filter(r => r && r.k === 'pact' && (r.st === 'active' || r.st === 'ending')).length,
      rivals: Object.values(rel).filter(r => r && r.k === 'rival').length };
  });
  return { at: Date.now(), alliances: rows };
}
async function allianceChat(db, actor, data) {
  const aid = id(data.aid), A = await db.doc('alliances/' + aid).get();
  if (!A.exists) throw new HttpsError('not-found', 'That alliance no longer exists.');
  const qs = await db.collection('alliances/' + aid + '/chat').orderBy('t', 'desc').limit(300).get();
  const posts = qs.docs.map(d => ({ id: d.id, a: d.get('a') || '', nm: text(d.get('nm'), 80), x: text(d.get('x'), 1200), t: +d.get('t') || 0 })).reverse();
  await db.collection('adminAudit').doc().set({ actor, action: 'alliance_chat_read', target: aid, name: text(A.get('name'), 80), outcome: 'completed', at: FieldValue.serverTimestamp() });
  return { aid, name: text(A.get('name'), 80), limited: qs.size === 300, posts };
}
export const adminConsole = onCall({ region: 'europe-west1', maxInstances: 5, memory: '512MiB', timeoutSeconds: 300 }, async req => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  const d = req.data || {}, db = getFirestore(), actor = req.auth.uid;
  /* a moderator (claim mod, appointed below with op 'setMod') uses the console's moderation part only: the report queue
     (close a report, remove the reported post or chat line). Silencing and the region chats are functions/regionchat.js's */
  if (req.auth.token.admin !== true) {
    if (req.auth.token.mod === true && d.op === 'moderate' && MOD_ACTIONS.includes(d.action)) return mutate(db, actor, d);
    /* a moderator judging a report can look the player up and write in the case file, and sees nothing of the account
       behind the nation: no sign-ins, no address, no other accounts from it, no purchases (modPlayer) */
    if (req.auth.token.mod === true && d.op === 'player') return modPlayer(db, id(d.uid));
    if (req.auth.token.mod === true && d.op === 'note' && text(d.action, 8) !== 'drop') return note(db, actor, d);
    throw new HttpsError('permission-denied', 'Only Edictum admins can use the console.');
  }
  if (d.op === 'setMod') return setMod(db, actor, d);
  if (d.op === 'setAmb') return setAmb(db, actor, d);
  if (d.op === 'mods') return modsList(db);
  if (d.op === 'search') return players(db, d);
  if (d.op === 'player') return player(db, id(d.uid));
  if (d.op === 'health') return health(db);
  if (d.op === 'online') return onlinePlayers(db);
  if (d.op === 'alliances') return alliancesList(db);
  if (d.op === 'alChat') return allianceChat(db, actor, d);
  if (d.op === 'impact') return impact(db, d);
  if (d.op === 'balance') return balance(db, d);
  if (d.op === 'stats') return stats(db, d);
  if (d.op === 'shopStats') return shopStats(db);
  if (d.op === 'statsExport') return statsExport(db);
  if (d.op === 'statsNation') return statsNation(db, d);
  if (d.op === 'audit') return audit(db, d);
  if (d.op === 'region') return setRegion(db, actor, d);
  if (d.op === 'regionDefault') return setDefaultRegion(db, actor, d);
  if (d.op === 'moderate') return mutate(db, actor, d);
  if (d.op === 'note') return note(db, actor, d);
  if (d.op === 'letters') return lettersOp(db, actor, d);
  // how players use letters, in counts (functions/letter-stats.js): never the words, never who writes to whom
  if (d.op === 'letterStats') return letterStats(db, d);
  if (d.op === 'club') return club(db, actor, d);
  if (d.op === 'pack') return pack(db, actor, d);
  // a one-time sign-in link for a player who cannot get back in (functions/once.js)
  if (d.op === 'once') return onceAdmin(db, actor, id(d.uid), d);
  if (d.op === 'feed') return feedOp(db, d);
  if (d.op === 'watch') return watchOp(db, actor, d);
  if (d.op === 'alerts') return alertsOp(db, actor, d);
  // Recently dissolved, and putting one back (functions/gone.js)
  if (d.op === 'gone') return goneList(db);
  if (d.op === 'restore') { const r = await goneRestore(db, actor, d); directoryAt = 0; return r; }
  throw new HttpsError('invalid-argument', 'Unknown console request.');
});
