// The admin portal's Live feed (functions/admin.js, op 'feed') and the recent activity of watched players: what
// players did lately, gathered from records the server already keeps. Nothing here writes, and no new tracking is
// added: a founding is the nation's founding time in its public summary (summaries/<uid>.f), what one nation did to
// another is the ping its game files for Letters by post (mailQ/<by~to~kind>, kept by jobs/mail in feedLog/<hour>
// for FEED_KEEP once mailed), and the rest are the purchases, reports, tickets, bug reports, board posts, recruits
// and admin actions as stored. Private letters are left out: a ping of kind 'msg' never becomes an event.
import { Timestamp } from 'firebase-admin/firestore';

export const HOUR = 3600000, DAY = 24 * HOUR, FEED_KEEP = 7 * DAY;
export const SPANS = { h1: HOUR, h6: 6 * HOUR, d1: DAY, d7: FEED_KEEP };
/* every kind of event and the group the page filters it by */
export const GROUP = { found: 'found', war: 'war', conq: 'war', peace: 'war', trade: 'dip', shared: 'dip', aladmit: 'dip', alremove: 'dip', cede: 'dip',
  buy: 'shop', report: 'mod', ticket: 'mod', ticketr: 'mod', bug: 'mod', admin: 'mod', topic: 'board', reply: 'board', post: 'board', comment: 'board', recruit: 'recruit' };
export const PING_KINDS = new Set(['war', 'conq', 'peace', 'trade', 'shared', 'aladmit', 'alremove', 'cede']);
const LIMIT = 400;
const ms = v => typeof v === 'number' ? v : v?.toMillis?.() || 0;
const txt = (v, n) => typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '';
const sid = v => typeof v === 'string' ? v.slice(0, 128) : '';

/* one event from a ping (mailQ) or an archived ping (feedLog item); null for a letter or anything unknown */
export function pingEvent(x) {
  if (!x || !PING_KINDS.has(x.k)) return null;
  return { k: x.k, t: ms(x.t), uid: sid(x.by), name: txt(x.nm, 40), to: sid(x.to) };
}
/* a post, wherever it is: its path says which board it is on */
export function postEvent(path, d) {
  const p = String(path).split('/'), t = ms(d.t), uid = sid(d.a), name = txt(d.nm, 40);
  /* the Assembly's debate topics (functions/civic.js, debateTopic) are no player's doing */
  if (d.as === true) return null;
  if (p[0] === 'cb' && p.length === 4) return { k: 'topic', t, uid, name, reg: p[1], x: txt(d.ti, 90) || txt(d.x, 90) };
  if (p[0] === 'cb' && p.length === 6) return { k: 'reply', t, uid, name, reg: p[1], x: txt(d.x, 90) };
  if (p[0] === 'boards' && p.length === 4) return { k: 'post', t, uid, name, reg: p[1], x: txt(d.x, 90) };
  if (p[0] === 'devnews' && p.length === 4) return { k: 'comment', t, uid, name, x: txt(d.x, 90) };
  return null;
}
/* a shop transaction is a purchase when it went through, in the shop's own environment (sandbox records left on a live
   shop are tests, as functions/shop-stats.js has it) */
export function buyEvent(id, d, env) {
  if (d.ok !== true || (env && d.env && d.env !== env)) return null;
  return { k: 'buy', t: ms(d.paid) || ms(d.created), uid: sid(d.uid), to: d.payer && d.payer !== d.uid ? sid(d.payer) : '', x: txt(d.product, 40), gift: !!d.gift, ref: id };
}
/* the newest first, at most `limit`, each once (a ping archived while still queued counts once) */
export function mergeEvents(lists, since, limit = LIMIT) {
  const seen = new Set(), out = [];
  for (const e of lists.flat()) {
    if (!e || !(e.t > since)) continue;
    const key = [e.k, e.uid, e.to || '', e.ref || '', e.t].join('|');
    if (seen.has(key)) continue;
    seen.add(key); out.push(e);
  }
  return out.sort((a, b) => b.t - a.t).slice(0, limit);
}
/* how many of each group */
export function countGroups(events) {
  const c = {};
  for (const e of events) { const g = GROUP[e.k] || 'other'; c[g] = (c[g] || 0) + 1; }
  return c;
}

/* names and regions of everyone the events mention, from the public summaries, kept a minute per instance */
const names = new Map();
async function nameAll(db, uids) {
  const now = Date.now(), want = [...new Set(uids)].filter(u => u && !u.includes('/') && !(names.get(u)?.at > now - 60000));
  for (let i = 0; i < want.length; i += 300) {
    const docs = await db.getAll(...want.slice(i, i + 300).map(u => db.doc('summaries/' + u)), { fieldMask: ['name', 'reg'] });
    for (const d of docs) names.set(d.id, { at: now, name: d.exists ? txt(d.get('name'), 40) : '', reg: d.exists ? String(d.get('reg') || '') : '' });
  }
  if (names.size > 20000) for (const [k, v] of names) if (v.at < now - 60000) names.delete(k);
  return u => names.get(u) || { name: '', reg: '' };
}

/* Everything since `since`, newest first. Each source is read with a limit, so a very busy hour shows its latest. */
export async function gatherFeed(db, { since, now = Date.now() }) {
  // a source that fails (an index still building after a deploy, say) leaves its events out rather than the whole feed
  const ts = Timestamp.fromMillis(since), safe = p => p.catch(e => { console.warn('feed: a source failed:', e.message); return { docs: [] }; });
  const [found, queued, logged, tx, cfg, reports, tickets, talked, bugs, postsT, postsN, recruits, audit] = await Promise.all([
    safe(db.collection('summaries').where('f', '>', since).orderBy('f', 'desc').limit(300).select('name', 'reg', 'f').get()),
    safe(db.collection('mailQ').where('t', '>', ts).limit(2000).get()),
    safe(db.collection('feedLog').where('t', '>', since - HOUR).get()),
    safe(db.collection('shopTx').orderBy('paid', 'desc').limit(100).get()),
    db.doc('authConfig/paddle').get().catch(() => null),
    safe(db.collection('reports').orderBy('t', 'desc').limit(100).get()),
    safe(db.collection('support').orderBy('t', 'desc').limit(50).get()),
    // tickets with a recent message (functions/support.js, lt): the player's replies in them
    safe(db.collection('support').where('lt', '>', ts).orderBy('lt', 'desc').limit(50).get()),
    safe(db.collection('bugs').orderBy('t', 'desc').limit(50).get()),
    // posts keep their time as a server timestamp (region boards, news comments) or in ms (the Community Board)
    safe(db.collectionGroup('posts').where('t', '>', ts).orderBy('t', 'desc').limit(150).get()),
    safe(db.collectionGroup('posts').where('t', '>', since).orderBy('t', 'desc').limit(150).get()),
    safe(db.collection('recruits').orderBy('t', 'desc').limit(50).get()),
    safe(db.collection('adminAudit').orderBy('at', 'desc').limit(60).get()),
  ]);
  const env = cfg && cfg.exists ? (cfg.get('env') === 'live' ? 'live' : cfg.get('env') || 'sandbox') : '';
  const lists = [
    found.docs.map(d => ({ k: 'found', t: Number(d.get('f')) || 0, uid: d.id, name: txt(d.get('name'), 40), reg: String(d.get('reg') || '') })),
    queued.docs.map(d => pingEvent(d.data())),
    logged.docs.flatMap(d => (d.get('items') || []).map(pingEvent)),
    tx.docs.map(d => buyEvent(d.id, d.data(), env)),
    reports.docs.map(d => ({ k: 'report', t: ms(d.get('t')), uid: sid(d.get('target')), by: sid(d.get('by')), name: txt(d.get('name'), 40),
      x: txt(d.get('reason'), 20) + (d.get('kind') === 'post' ? ' · a post' : ''), ref: d.id })),
    tickets.docs.map(d => ({ k: 'ticket', t: ms(d.get('t')), uid: sid(d.get('by')), x: txt(d.get('topic'), 40), ref: d.id })),
    talked.docs.flatMap(d => (Array.isArray(d.get('m')) ? d.get('m') : []).filter(m => m && m.a === 'p').map(m => ({ k: 'ticketr', t: ms(m.t), uid: sid(d.get('by')), x: txt(m.x, 90), ref: d.id }))),
    bugs.docs.map(d => ({ k: 'bug', t: ms(d.get('t')), uid: sid(d.get('by')), x: txt(d.get('ti'), 90), ref: d.id })),
    postsT.docs.concat(postsN.docs).map(d => postEvent(d.ref.path, d.data())),
    recruits.docs.map(d => ({ k: 'recruit', t: ms(d.get('t')), uid: d.id, to: sid(d.get('r')) })),
    // a multi-step admin action records 'started' and then its outcome: only the outcome is shown
    audit.docs.filter(d => d.get('outcome') !== 'started').map(d => ({ k: 'admin', t: ms(d.get('at')), uid: sid(d.get('target')), by: sid(d.get('actor')),
      x: txt(d.get('action'), 40).replace(/_/g, ' ') + (d.get('outcome') === 'failed' ? ' (failed)' : ''), name: txt(d.get('name'), 40), ref: d.id })).filter(e => e.x),
  ];
  const events = mergeEvents(lists, since);
  const who = await nameAll(db, events.flatMap(e => [e.uid, e.to, e.by]));
  for (const e of events) {
    const a = who(e.uid);
    if (!e.name) e.name = a.name;
    if (!e.reg) e.reg = a.reg;
    if (e.to) e.toName = who(e.to).name;
    if (e.by) e.byName = who(e.by).name;
  }
  return { at: now, since, events, counts: countGroups(events) };
}
/* The feed is read at most every 20 seconds per span and instance; filters by region, group or player are applied to
   the cached events, so changing them costs nothing. */
const cache = new Map();
export async function feed(db, { span = 'h6', reg = '', groups = null, uids = null, refresh = false } = {}) {
  const width = SPANS[span] || SPANS.h6, now = Date.now(), hit = cache.get(span);
  let d = hit && !refresh && now - hit.at < 20000 ? hit : null;
  if (!d) { d = await gatherFeed(db, { since: now - width, now }); cache.set(span, d); }
  const want = groups && groups.length ? new Set(groups) : null, mine = uids ? new Set(uids) : null;
  const here = d.events.filter(e => !reg || e.reg === reg);
  const events = here.filter(e => (!want || want.has(GROUP[e.k])) && (!mine || mine.has(e.uid) || mine.has(e.to) || mine.has(e.by)));
  return { at: d.at, since: d.since, span, events, counts: countGroups(here), total: here.length };
}
