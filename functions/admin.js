// Staff-only operations. Audit events use authenticated identities and server time; clients cannot edit them.
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { registered } from './eligibility.js';
import { gather, summarize, nationRow } from './stats.js';
import { setComp } from './shop.js';
import { cbDelete } from './board.js';
import { shopSummary } from './shop-stats.js';
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

async function players(db, data) {
  // Read only the small public summaries, cached for a minute. Legacy nations need no migration.
  if (!directory || data.refresh === true || Date.now() - directoryAt > 60000) {
    const qs = await db.collection('summaries').select('name', 'reg', 'pop', 't').get();
    directory = qs.docs.map(d => ({ uid: d.id, ...d.data() })).sort((a, b) => String(a.name).localeCompare(String(b.name)));
    directoryAt = Date.now();
  }
  const q = key(text(data.q, 128)), reg = text(data.reg, 40), act = text(data.act, 8), on = await online(db, data.refresh === true);
  const tOf = p => typeof p.t === 'number' ? p.t : ms(p.t);
  const matches = directory.filter(p => (!reg || p.reg === reg) && (!q || key(p.name).includes(q) || key(p.uid).includes(q))
    && (act !== 'online' || on.has(p.uid)) && (!ACT[act] || ACT[act](tOf(p))));
  if (q && !text(data.q).includes('/') && !matches.some(p => p.uid === text(data.q))) {
    const direct = await db.doc('summaries/' + text(data.q)).get();
    if (direct.exists && (!reg || direct.get('reg') === reg)) matches.unshift({ uid: direct.id, ...direct.data() });
  }
  const offset = Number.isSafeInteger(data.offset) && data.offset >= 0 ? data.offset : 0;
  const page = matches.slice(offset, offset + 50).map(p => ({ ...p, on: on.has(p.uid) }));
  return { players: page, total: matches.length, online: on.size, next: offset + 50 < matches.length ? offset + 50 : null, at: directoryAt };
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
  const [n, ban, mod, sessions, acct, notes, shop, comp] = await Promise.all([db.doc('nations/' + uid).get(), db.doc('bans/' + uid).get(), db.doc('mod/' + uid).get(), db.collection('saveHealth').where('uid', '==', uid).limit(30).get(), account(db, uid), db.doc('staffNotes/' + uid).get(), db.doc('shop/' + uid).get(), db.doc('shopComp/' + uid).get()]);
  const d = n.data() || {}, more = await overview(db, uid, d, acct, shop);
  return { ...more, uid, exists: n.exists, name: d.name || ban.get('name') || mod.get('name') || uid, reg: d.reg || '', pop: d.pop ?? null, revision: d.rev || 0, savedAt: ms(d.ts), banned: ban.exists, hidden: mod.get('hidden') === true, rename: mod.get('rename') === true, removed: mod.get('removed') || 0, note: ban.get('note') || mod.get('note') || '', account: acct, staffNote: staffNote(notes), club: clubState(shop, comp), sessions: sessions.docs.map(s => { const { expiresAt, ...value } = s.data(); return { id: s.id, ...value, t: ms(s.get('t')) }; }) };
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
  const nation = r && { name: r.name, pop: r.pop, founded: r.founded, t: r.t, dec: r.dec, cities: r.cities, claims: r.claims, tut: r.tut.length, lists: r.lists, features: r.f, inbox: r.inbox,
    rulings: r.ans.sort((a, b) => b[0] - a[0]).slice(0, 8).map(([t, id, o]) => ({ t, id, o })) };
  const txIds = txs.docs.map(t => t.id), adjs = [];
  for (let i = 0; i < txIds.length; i += 30) adjs.push(...(await db.collection('shopAdj').where('txn', 'in', txIds.slice(i, i + 30)).get()).docs.map(a => a.data()));
  const purchases = {
    owns: shop.get('owns') || {}, ctm: ctm.get('ctm') || '', env: paddle.get('env') === 'live' ? 'live' : 'sandbox',
    tx: few(txs, t => ({ id: t.id, product: t.get('product') || '', t: when(t.get('paid')) || when(t.get('created')), status: t.get('status') || '', ok: t.get('ok') === true, sub: t.get('sub') || '', gift: !!t.get('gift'), payer: t.get('payer') || '', refund: t.get('refundWhy') || '',
      adj: adjs.filter(a => a.txn === t.id).map(a => ({ action: a.action || '', status: a.status || '' })) }), 100) };
  const others = seen ? seen.docs.map(s => s.id).filter(id => id !== uid) : [];
  const names = others.length ? await db.getAll(...others.map(id => db.doc('summaries/' + id)), { fieldMask: ['name', 'reg', 't'] }) : [];
  const alts = names.map(s => ({ uid: s.id, name: s.get('name') || '', reg: s.get('reg') || '', t: s.get('t') || 0, at: (seen.docs.find(d => d.id === s.id)?.get('at')) || 0 }));
  const rep = d => ({ id: d.id, t: when(d.get('t')), reason: text(d.get('reason'), 40), note: text(d.get('note'), 300), kind: d.get('kind') || '', name: text(d.get('name'), 80), by: d.get('by') || '', target: d.get('target') || '' });
  return { nation, purchases, alts, reports: { against: few(against, rep), by: few(by, rep),
    tickets: few(tickets, d => ({ id: d.id, t: when(d.get('t')), topic: d.get('topic') || '', x: text(d.get('x'), 300), st: d.get('st') || '' })),
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
/* The staff's private notes on a player: one text per player in staffNotes/{uid} {text, at, by}, read and written
   only here (the rules refuse every client) and never shown to the player. The audit log records each change, not
   the text, so a note is gone for good when it is cleared or the player deletes their account (functions/accounts.js). */
const NOTE_MAX = 4000;
const staffNote = s => s.exists ? { text: s.get('text') || '', at: s.get('at') || 0, by: s.get('by') || '' } : { text: '', at: 0, by: '' };
async function note(db, actor, data) {
  const target = id(data.uid), body = typeof data.text === 'string' ? data.text.replace(/\r\n?/g, '\n').trim().slice(0, NOTE_MAX) : null;
  if (body === null) throw new HttpsError('invalid-argument', 'Write a note, or leave it empty to clear it.');
  const ref = db.doc('staffNotes/' + target), event = db.collection('adminAudit').doc(), now = Date.now();
  const name = text((await db.doc('nations/' + target).get()).get('name'), 80);
  await db.runTransaction(async tx => {
    if (body) tx.set(ref, { text: body, at: now, by: actor }); else tx.delete(ref);
    tx.create(event, { actor, action: body ? 'note_saved' : 'note_cleared', target, reason: body ? body.length + ' characters' : 'Note cleared', ...(name ? { name } : {}), operation: event.id, outcome: 'completed', at: FieldValue.serverTimestamp() });
  });
  return { staffNote: body ? { text: body, at: now, by: actor } : { text: '', at: 0, by: '' } };
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
    counting = counting || gather(db, (max, token) => getAuth().listUsers(max, token), { regions: [...REGIONS] }).then(g => { counted = g; return g; }).finally(() => { counting = null; });
    await counting;
  }
  return summarize(counted, reg);
}
/* The Shop statistics page (functions/shop-stats.js): the shop's billing records are few, so they are read whole
   each time; the latest sales name their nations. */
async function shopStats(db) {
  const [cfg, tx, sub, adj, ck] = await Promise.all([db.doc('authConfig/paddle').get(), db.collection('shopTx').get(), db.collection('shopSubs').get(),
    db.collection('shopAdj').get(), db.collection('shopCheckouts').get()]);
  const all = q => q.docs.map(d => ({ id: d.id, ...d.data() }));
  const env = cfg.exists ? (cfg.get('env') === 'live' ? 'live' : cfg.get('env') || 'sandbox') : '';
  const out = shopSummary({ txs: all(tx), subs: all(sub), adjs: all(adj), cks: all(ck) }, Date.now(), env);
  const uids = [...new Set(out.recent.flatMap(r => [r.uid, r.payer]).filter(Boolean))];
  const names = {};
  if (uids.length) for (const n of await db.getAll(...uids.map(u => db.doc('nations/' + u)))) if (n.exists) names[n.id] = text(n.get('name'), 80);
  return { ...out, on: cfg.exists, names };
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
    // Public availability contains no staff notes or actor identity; those belong to the private audit.
    tx.set(ref, { enabled: data.enabled, mode, at: FieldValue.serverTimestamp() });
    tx.create(event, { actor, action: data.enabled ? 'region_enabled' : 'region_disabled', target, reason, before, after: data.enabled, beforeMode, mode, outcome: 'completed', at: FieldValue.serverTimestamp() });
  });
  return { ok: true };
}
async function mutate(db, actor, data) {
  const action = text(data.action, 40), target = id(data.target), reason = text(data.reason, 300) || 'Admin console action';
  const allowed = ['hide', 'rename', 'unhide', 'remove', 'ban', 'unban', 'delete_post', 'close_report', 'support_answer', 'support_close', 'support_delete'];
  if (!allowed.includes(action)) throw new HttpsError('invalid-argument', 'Unknown admin action.');
  if (['hide', 'rename', 'remove', 'ban'].includes(action) && target === actor) throw new HttpsError('failed-precondition', 'You cannot moderate your own account.');
  const event = db.collection('adminAudit').doc(), common = { actor, action, target, reason, operation: event.id };
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
    if (action === 'unban') await db.doc('bans/' + target).delete();
    if (action === 'remove' || action === 'ban') {
      // Publish the ban/tombstone together with removal; open browsers follow the tombstone.
      const b = db.batch();
      b.set(db.doc('mod/' + target), { hidden: false, removed: now, note: reason, name, t: now, by: actor });
      if (action === 'ban') b.set(db.doc('bans/' + target), { note: reason, name, t: now, by: actor });
      ['nations', 'nationx', 'nationp', 'summaries', 'space'].forEach(c => b.delete(db.doc(c + '/' + target)));
      await b.commit();
      const [posts, reports] = await Promise.all([db.collectionGroup('posts').where('a', '==', target).get(), db.collection('reports').where('target', '==', target).get()]);
      const writer = db.bulkWriter(), writes = posts.docs.concat(reports.docs).map(d => writer.delete(d.ref)); await Promise.all([Promise.all(writes), writer.close()]);
    }
    // a reported comment on development news is news:<post>:<comment>; anything else is a region board post
    const news = action === 'delete_post' && /^news:([A-Za-z0-9]{20}):([A-Za-z0-9]{20})$/.exec(target);
    if (news) await db.doc('devnews/' + news[1] + '/posts/' + news[2]).delete();
    // and a Community Board post is cb:<region>:<topic>[:<reply>] (functions/board.js keeps the counts right)
    const cb = action === 'delete_post' && /^cb:([a-z]{2,40}):([A-Za-z0-9]{20})(?::([A-Za-z0-9]{20}))?$/.exec(target);
    if (cb) await cbDelete(db, { uid: actor, admin: true }, { reg: cb[1], topic: cb[2], ...(cb[3] ? { reply: cb[3] } : {}), reason }, new Set([cb[1]]));
    else if (action === 'delete_post' && !news) { if (!REGIONS.has(text(data.reg))) throw new HttpsError('invalid-argument', 'Choose a region.'); await db.doc('boards/' + data.reg + '/posts/' + target).delete(); }
    if (action === 'close_report') await db.doc('reports/' + target).delete();
    if (action.startsWith('support_')) {
      const ref = db.doc('support/' + target);
      if (action === 'support_delete') await ref.delete();
      else await db.runTransaction(async tx => {
        const s = await tx.get(ref);
        if (!s.exists || s.get('st') !== 'open') throw new HttpsError('failed-precondition', 'This ticket is already closed or removed.');
        const reply = text(data.reply, 2000);
        if (action === 'support_answer' && !reply) throw new HttpsError('invalid-argument', 'Write an answer first.');
        tx.update(ref, { st: 'closed', ct: FieldValue.serverTimestamp(), rby: actor, exp: Timestamp.fromMillis(now + 90 * 86400000), ...(reply ? { reply } : {}) });
      });
    }
    if (text(data.report)) await db.doc('reports/' + id(data.report)).delete();
    await db.collection('adminAudit').add({ ...common, name, outcome: 'completed', at: FieldValue.serverTimestamp() });
    directoryAt = 0;
    return { ok: true };
  } catch (e) {
    await db.collection('adminAudit').add({ ...common, outcome: 'failed', error: text(e.code || 'unknown', 64), at: FieldValue.serverTimestamp() });
    throw e;
  }
}
export const adminConsole = onCall({ region: 'europe-west1', maxInstances: 5, memory: '512MiB', timeoutSeconds: 300 }, async req => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  if (req.auth.token.admin !== true) throw new HttpsError('permission-denied', 'Only Edictum admins can use the console.');
  const d = req.data || {}, db = getFirestore(), actor = req.auth.uid;
  if (d.op === 'search') return players(db, d);
  if (d.op === 'player') return player(db, id(d.uid));
  if (d.op === 'health') return health(db);
  if (d.op === 'stats') return stats(db, d);
  if (d.op === 'shopStats') return shopStats(db);
  if (d.op === 'audit') return audit(db, d);
  if (d.op === 'region') return setRegion(db, actor, d);
  if (d.op === 'moderate') return mutate(db, actor, d);
  if (d.op === 'note') return note(db, actor, d);
  if (d.op === 'club') return club(db, actor, d);
  throw new HttpsError('invalid-argument', 'Unknown console request.');
});
