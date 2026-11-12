import { HttpsError } from 'firebase-functions/v2/https';
import { FieldValue, FieldPath } from 'firebase-admin/firestore';
import { eligibility, refuse } from './eligibility.js';

/* The Community Board: one board per region, read by everyone, written only here (civic ops cb*), so every post
   carries what the server knows rather than what a browser claims.
     cb/{reg}                         {n: topics, r: replies, la: last activity (ms), dd: day (UTC date), dn: posts that day}
     cb/{reg}/posts/{tid}             a topic {a, nm, rg, fl?, fd?, st?, of?, rl?, ti, x, tg, t, la, rc, pn?, lk?, hd?, ed?}
     cb/{reg}/posts/{tid}/posts/{rid} a reply {a, nm, rg, fl?, fd?, st?, of?, rl?, x, t, hd?, ed?}
     cbHidden/{id}                    what a hidden topic or reply said, for admins only {reg, tid, rid?, ti?, x, by, t}
     cbPace/{uid}                     the pacing of each player's posts {p, q} (paced(), below)
     cbSubs/{tid}                     who hears of a topic's replies {reg, f: {uid: 1 following | 0 muted}}, server-only
     cbWatch/{uid}/t/{tid}            the player's own copy {reg, ti, f, n, t, nt?, nm?, s?}: following or muted, the n new
                                      replies since they last read it (the newest by someone else at nt, by nm), the last
                                      activity t; they mark it read (n 0, s their time)
     cbUser/{uid}                     what readers show beside a nation's posts {n, t, nm, rg, rk?, al?, cl?, fd?, sg?}
     cbRx/{uid}                       where the player reacted {p: ['reg/tid[/rid]']}, so the reactions go with the account
   A topic or reply may carry reactions rv {uid: kind} (cbReact), and a reply the id of the post it quotes, q.
   Topics and replies are 'posts' collections so deleting an account, or an admin removing a nation, takes them too.
   Any Registered Nation may open a topic or reply in any region; the author is shown as their nation was when they
   posted: its name, region, flag, a Founding Supporter mark (fd) and an Edictum staff mark (st).
   An admin may instead sign as the Edictum team (of: true, with a name and a role of their choosing, no flag or
   region): that needs no nation of their own, reaches a closed region's board too, and any admin may edit it.
   cbPost, from the admin portal, opens the same topic on several boards (or all of them) at once.
   The Assembly opens a debate topic for each resolution at the vote (functions/civic.js, debateTopic): signed by its
   clerk (a: 'assembly', as: true): staff may lock, hide or delete it like any other. */
export const CB_TAGS = ['general', 'trade', 'diplomacy', 'war', 'help', 'offtopic', 'assembly'];
const id20 = v => typeof v === 'string' && /^[A-Za-z0-9]{20}$/.test(v) ? v : '';
const line = (x, max) => typeof x === 'string' ? x.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';
const body = (x, max) => typeof x === 'string' ? x.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, max) : '';
const day = t => new Date(t).toISOString().slice(0, 10);
export const CB_TITLE = 120, CB_TEXT = 4000;

/* The Chancery: one more board, not a region's, for Chancery Club members (a paid-up vip.until) and Founding
   Supporters (owns.founder), both read from the server's own shop/{uid}; staff always. firestore.rules keeps the
   same test for reading it. */
export const CB_CHANCERY = 'chancery';
export const chanceryOk = (shop, now = Date.now()) => !!(shop && shop.exists && (shop.get('owns.founder') || (shop.get('vip.until') || 0) > now));
async function gate(db, who, reg) {
  if (reg !== CB_CHANCERY || who.admin || who.mod) return;
  if (!chanceryOk(await db.doc('shop/' + who.uid).get())) refuse('cb_chancery', 'The Chancery board is for Chancery Club members and Founding Supporters.');
}
/* @mentions: the browser sends the ids of the nations it picked (mn, at most CB_MN), the server keeps only those whose
   saved name follows an @ in the text, who are not the author, have not blocked them (lblock/{to~by}) and, on the
   Chancery board, may read it. Each gets mentions/{uid}/m/{id} {by, nm, reg, tid, rid?, ti, x, t} for their bell,
   and the post keeps mn {uid: name} so readers see the names as mentions. */
export const CB_MN = 5;
async function mentioned(tx, db, who, d, reg, text) {
  const ids = [...new Set(Array.isArray(d.mn) ? d.mn.filter(u => typeof u === 'string' && /^[A-Za-z0-9_-]{6,128}$/.test(u) && u !== who.uid) : [])].slice(0, CB_MN);
  if (!ids.length) return {};
  const low = text.toLowerCase(), out = {};
  const docs = await Promise.all(ids.map(u => Promise.all([tx.get(db.doc('nations/' + u)), tx.get(db.doc('lblock/' + u + '~' + who.uid)), reg === CB_CHANCERY ? tx.get(db.doc('shop/' + u)) : null])));
  ids.forEach((u, i) => {
    const [n, block, shop] = docs[i], nm = n.exists ? line(n.get('name'), 80) : '';
    if (!nm || block.exists || (shop && !chanceryOk(shop)) || !low.includes('@' + nm.toLowerCase())) return;
    out[u] = nm;
  });
  return out;
}
function notifyMentions(tx, db, mn, me, reg, tid, rid, ti, x, now) {
  for (const u of Object.keys(mn)) tx.create(db.collection('mentions/' + u + '/m').doc(),
    { by: me.a, nm: me.nm, reg, tid, ...(rid ? { rid } : {}), ti: line(ti, CB_TITLE), x: line(x, 160), t: now });
}
function where(regions, d) {
  const reg = typeof d.reg === 'string' && (regions.has(d.reg) || d.reg === CB_CHANCERY) ? d.reg : '';
  if (!reg) throw new HttpsError('invalid-argument', 'Choose a region.');
  return reg;
}
/* the author as readers see them, from the saved nation and the server's own records. Beside it, not stored on the
   post (not enumerable, so a spread leaves it out): pf, the marks their board profile carries (cbUser, below) */
async function author(tx, db, who, e) {
  const [shop, ally] = await tx.getAll(db.doc('shop/' + who.uid), db.doc('allyOf/' + who.uid));
  const aid = ally.exists && typeof ally.get('a') === 'string' && /^[\w-]{1,128}$/.test(ally.get('a')) ? ally.get('a') : '';
  const al = aid ? await tx.get(db.doc('alliances/' + aid)) : null, mem = al && al.exists && al.get('mem') && typeof al.get('mem') === 'object' ? al.get('mem') : {};
  const flag = e.n.flag && typeof e.n.flag === 'object' ? JSON.stringify(e.n.flag) : '';
  const me = { a: who.uid, nm: line(e.saved.get('name'), 80) || 'A nation', rg: e.n.reg || e.saved.get('reg') || '',
    ...(flag && flag.length <= 4000 ? { fl: flag } : {}), ...(shop.exists && shop.get('owns.founder') ? { fd: true } : {}), ...(who.admin ? { st: 'admin' } : who.mod ? { st: 'mod' } : {}) };
  const col = al && al.exists && /^#[0-9a-fA-F]{6}$/.test(al.get('col') || '') ? al.get('col').toUpperCase() : '';
  Object.defineProperty(me, 'pf', { enumerable: false, value: {
    al: mem[who.uid] && line(al.get('name'), 40) ? { n: line(al.get('name'), 40), ...(col ? { c: col } : {}) } : null,
    cl: !!(shop.exists && (shop.get('vip.until') || 0) > Date.now()) } });
  return me;
}
/* who signs a new post: the player's nation, or for an admin who asks (as: 'team') the Edictum team. The team needs
   no nation, so only a ban stops it, and a nation of the admin's in a closed region does not. The region page's
   message board (civic op 'topic') signs the same way. */
export const TEAM_OK = { nation: false, hidden: true, linked: false, allowClosedRegion: true };
export const asTeam = (who, d) => who.admin && d.as === 'team';
/* the team's signature: the name and role the admin chose, the staff mark */
export function teamMark(d) { const rl = line(d.rl, 60); return { nm: line(d.nm, 80) || 'Edictum team', st: 'admin', of: true, ...(rl ? { rl } : {}) }; }
async function signer(tx, db, who, d) {
  if (!asTeam(who, d)) return author(tx, db, who, await eligibility(tx, who));
  await eligibility(tx, who, TEAM_OK);
  return { a: who.uid, rg: '', ...teamMark(d) };
}
/* the board's counts with a post added (also the Assembly's debates, functions/civic.js) */
export function cbCounted(meta, now, add) { return counted(meta, now, add); }
function counted(meta, now, add) {
  const m = meta.exists ? meta.data() : {}, same = m.dd === day(now);
  return { n: (m.n || 0) + (add.n || 0), r: (m.r || 0) + (add.r || 0), la: add.n > 0 || add.r > 0 ? now : m.la || 0,
    dd: day(now), dn: (same ? m.dn || 0 : 0) + Math.max(0, (add.n || 0) + (add.r || 0)) };
}
/* Pacing (cbPace/{uid} {p: times of the player's posts in the last hour, q: of their topics}): one post every
   CB_GAP, at most CB_HOUR an hour, CB_TOPICS of them new topics. Staff are not paced. Read in the post's
   transaction; the returned function records the post, after the transaction's other reads. */
export const CB_GAP = 30000, CB_HOUR = 20, CB_TOPICS = 5;
const HOUR = 3600000;
const inWords = ms => { const s = Math.ceil(ms / 1000); return s < 90 ? s + (s === 1 ? ' second' : ' seconds') : Math.ceil(s / 60) + ' minutes'; };
async function paced(tx, db, who, topic, now) {
  const ref = db.doc('cbPace/' + who.uid), s = await tx.get(ref);
  const recent = k => (s.exists && Array.isArray(s.get(k)) ? s.get(k) : []).filter(t => typeof t === 'number' && t <= now && now - t < HOUR);
  const p = recent('p'), q = recent('q');
  if (!who.admin && !who.mod) {
    const gap = p.length ? Math.max(...p) + CB_GAP - now : 0;
    const hour = p.length >= CB_HOUR ? Math.min(...p.slice(-CB_HOUR)) + HOUR - now : 0;
    const topics = topic && q.length >= CB_TOPICS ? Math.min(...q.slice(-CB_TOPICS)) + HOUR - now : 0;
    const wait = Math.max(gap, hour, topics);
    if (wait > 0) {
      const why = topics >= wait ? `You have opened ${CB_TOPICS} topics in the last hour.` : hour >= wait ? `You have posted ${CB_HOUR} times in the last hour.` : 'Slow down a little.';
      throw new HttpsError('failed-precondition', `${why} You can post again in ${inWords(wait)}.`, { code: 'cb_paced', wait });
    }
  }
  return () => tx.set(ref, { p: p.concat(now).slice(-CB_HOUR), q: topic ? q.concat(now).slice(-CB_TOPICS) : q });
}
const staffOnly = who => { if (!who.admin && !who.mod) throw new HttpsError('permission-denied', 'Only Edictum staff can do that.'); };
const audit = (b, db, who, action, extra) => b.create(db.collection('adminAudit').doc(), { actor: who.uid, action, outcome: 'completed', at: FieldValue.serverTimestamp(), ...extra });

/* ── the author's board profile ──
   cbUser/{uid} {n, t, nm, rg, rk?, al?: {n, c?}, cl?, fd?, sg?}: what every reader shows beside a nation's posts (the
   author column): how many it has written on the Community Board, its rank (the index its own game sends with each
   post, from the achievements it saves), its alliance, the Chancery Club and Founding Supporter marks, and the
   signature it chose (cbSig). Refreshed with every post; written only here, read by everyone. A profile written before
   the count existed is counted once from the posts already on the boards (posts where a == uid under cb/). */
export const CB_SIG = 100, CB_RANKS = 99;
const userRef = (db, uid) => db.doc('cbUser/' + uid);
const counts = u => u.exists && typeof u.get('n') === 'number';
async function backCount(db, uid) {
  if (counts(await userRef(db, uid).get())) return 0;
  try { return (await db.collectionGroup('posts').where('a', '==', uid).select().get()).docs.filter(d => d.ref.path.startsWith('cb/')).length; }
  catch { return 0; }
}
function profiled(tx, db, who, d, me, u, back, now) {
  if (me.of) return;
  const rk = Number.isInteger(d.rk) && d.rk >= 0 && d.rk <= CB_RANKS ? d.rk : null, pf = me.pf || {};
  tx.set(userRef(db, who.uid), { n: (counts(u) ? u.get('n') : back) + 1, t: now, nm: me.nm, rg: me.rg,
    rk: rk == null ? FieldValue.delete() : rk, al: pf.al || FieldValue.delete(), cl: pf.cl ? true : FieldValue.delete(), fd: me.fd ? true : FieldValue.delete() }, { merge: true });
}
/* posts gone: each author's count drops by the posts of theirs that went (only profiles that exist) */
async function uncount(db, tally) {
  const ids = [...tally.keys()].filter(u => typeof u === 'string' && /^[\w-]{1,128}$/.test(u));
  for (let i = 0; i < ids.length; i += 300) {
    const docs = await db.getAll(...ids.slice(i, i + 300).map(u => userRef(db, u))), b = db.batch();
    docs.forEach(s => { if (counts(s)) b.update(s.ref, { n: Math.max(0, s.get('n') - tally.get(s.id)) }); });
    await b.commit();
  }
}

/* ── following a topic ──
   cbSubs/{tid} {reg, f: {uid: 1 | 0}}: who hears of the topic's replies (1) and who muted it (0); cbWatch/{uid}/t/{tid}
   is each one's own copy, which their bell and the board read. The author follows a topic from the start, and so does
   everyone who replies to it, unless they muted it. A reply counts one more on every other follower's copy (n, with the
   newest reply's time and author), so the bell says "3 new replies"; reading the topic sets n back to 0 (firestore.rules).
   At most CB_SUBS follow one topic, which keeps a reply's transaction far below Firestore's 500 writes. */
export const CB_SUBS = 200;
const subsRef = (db, tid) => db.doc('cbSubs/' + tid);
const watchRef = (db, uid, tid) => db.doc('cbWatch/' + uid + '/t/' + tid);
const subsOf = s => { const f = s && s.exists ? s.get('f') : null; return f && typeof f === 'object' && !Array.isArray(f) ? f : {}; };
const following = f => Object.keys(f).filter(u => f[u] === 1);

export async function cbTopic(db, who, d, regions) {
  const reg = where(regions, d), ti = line(d.ti, CB_TITLE), x = body(d.x, CB_TEXT), tg = CB_TAGS.includes(d.tg) ? d.tg : 'general';
  await gate(db, who, reg);
  if (ti.length < 3) throw new HttpsError('invalid-argument', 'Give the topic a title of at least three characters.');
  if (!x) throw new HttpsError('invalid-argument', 'Write something first.');
  const back = asTeam(who, d) ? 0 : await backCount(db, who.uid);
  return db.runTransaction(async tx => {
    const me = await signer(tx, db, who, d), metaRef = db.doc('cb/' + reg), [meta, u] = await tx.getAll(metaRef, userRef(db, who.uid));
    const now = Date.now(), ref = db.collection('cb/' + reg + '/posts').doc(), mark = await paced(tx, db, who, true, now);
    const mn = await mentioned(tx, db, who, d, reg, ti + ' ' + x);
    mark();
    tx.create(ref, { ...me, ti, x, tg, t: now, la: now, rc: 0, ...(Object.keys(mn).length ? { mn } : {}) });
    notifyMentions(tx, db, mn, me, reg, ref.id, '', ti, x, now);
    tx.set(metaRef, counted(meta, now, { n: 1 }));
    // the author follows their topic
    tx.set(subsRef(db, ref.id), { reg, f: { [who.uid]: 1 } });
    tx.set(watchRef(db, who.uid, ref.id), { reg, ti, f: 1, n: 0, t: now, s: now });
    profiled(tx, db, who, d, me, u, back, now);
    return { id: ref.id };
  });
}

export async function cbReply(db, who, d, regions) {
  const reg = where(regions, d), tid = id20(d.topic), x = body(d.x, CB_TEXT);
  await gate(db, who, reg);
  if (!tid) throw new HttpsError('invalid-argument', 'Choose a topic.');
  if (!x) throw new HttpsError('invalid-argument', 'Write a reply first.');
  // a quote: the topic itself, or another reply under it (the page shows that post's words as they are now)
  const q = d.q ? id20(d.q) : '';
  if (d.q && !q) throw new HttpsError('invalid-argument', 'Choose the post to quote.');
  const back = asTeam(who, d) ? 0 : await backCount(db, who.uid);
  return db.runTransaction(async tx => {
    const me = await signer(tx, db, who, d), metaRef = db.doc('cb/' + reg), topicRef = db.doc('cb/' + reg + '/posts/' + tid);
    const [meta, topic, subs, u, qp] = await tx.getAll(metaRef, topicRef, subsRef(db, tid), userRef(db, who.uid), ...(q && q !== tid ? [topicRef.collection('posts').doc(q)] : []));
    if (!topic.exists || topic.get('hd')) refuse('cb_missing', 'This topic is no longer there.');
    if (topic.get('lk') && !who.admin && !who.mod) refuse('cb_locked', 'This topic is locked: it takes no more replies.');
    if (qp && (!qp.exists || qp.get('hd'))) refuse('cb_quote_missing', 'The post you quoted is no longer there.');
    const now = Date.now(), ref = topicRef.collection('posts').doc(), mark = await paced(tx, db, who, false, now);
    const mn = await mentioned(tx, db, who, d, reg, x);
    mark();
    tx.create(ref, { ...me, x, t: now, ...(q ? { q } : {}), ...(Object.keys(mn).length ? { mn } : {}) });
    notifyMentions(tx, db, mn, me, reg, tid, ref.id, topic.get('ti'), x, now);
    tx.update(topicRef, { rc: (topic.get('rc') || 0) + 1, la: now });
    tx.set(metaRef, counted(meta, now, { r: 1 }));
    profiled(tx, db, who, d, me, u, back, now);
    /* the followers: a topic from before following began starts with its author; the one replying joins unless they
       muted it, and every other follower's copy counts one more reply */
    const f = { ...subsOf(subs) }, ti = line(topic.get('ti'), CB_TITLE), add = {};
    if (!subs.exists && !topic.get('as') && typeof topic.get('a') === 'string' && topic.get('a')) add[topic.get('a')] = 1;
    if (f[who.uid] === undefined && following(f).length < CB_SUBS) add[who.uid] = 1;
    Object.assign(f, add);
    if (Object.keys(add).length || !subs.exists) tx.set(subsRef(db, tid), { reg, f: add }, { merge: true });
    for (const v of following(f).slice(0, CB_SUBS)) {
      if (v === who.uid) tx.set(watchRef(db, v, tid), { reg, ti, f: 1, n: 0, t: now, s: now }, { merge: true });
      else tx.set(watchRef(db, v, tid), { reg, ti, f: 1, n: FieldValue.increment(1), t: now, nt: now, nm: me.nm }, { merge: true });
    }
    return { id: ref.id };
  });
}

/* An admin's topic on several boards at once, from the admin portal: the same words as a topic of its own on each
   chosen board, pinned or locked as asked, signed as the Edictum team or as the admin's nation. One transaction:
   two writes a board and the audit entry, far below Firestore's 500. */
export async function cbPost(db, who, d, regions) {
  if (!who.admin) throw new HttpsError('permission-denied', 'Only admins can post to several boards at once.');
  const regs = [...new Set(Array.isArray(d.regs) ? d.regs.filter(r => typeof r === 'string' && regions.has(r)) : [])];
  const ti = line(d.ti, CB_TITLE), x = body(d.x, CB_TEXT), tg = CB_TAGS.includes(d.tg) ? d.tg : 'general';
  if (!regs.length) throw new HttpsError('invalid-argument', 'Choose at least one board.');
  if (ti.length < 3) throw new HttpsError('invalid-argument', 'Give the topic a title of at least three characters.');
  if (!x) throw new HttpsError('invalid-argument', 'Write something first.');
  return db.runTransaction(async tx => {
    const me = await signer(tx, db, who, d), metaRefs = regs.map(r => db.doc('cb/' + r)), metas = await tx.getAll(...metaRefs);
    const now = Date.now(), ids = {};
    regs.forEach((reg, i) => {
      const ref = db.collection('cb/' + reg + '/posts').doc(); ids[reg] = ref.id;
      tx.create(ref, { ...me, ti, x, tg, t: now, la: now, rc: 0, ...(d.pn === true ? { pn: true } : {}), ...(d.lk === true ? { lk: true } : {}) });
      tx.set(metaRefs[i], counted(metas[i], now, { n: 1 }));
    });
    audit(tx, db, who, 'board_post', { target: who.uid, name: me.nm, reg: regs.join(', '), topics: ids, x: line(ti + ': ' + x, 1000),
      reason: line(`“${ti}” on ${regs.length === 1 ? 'the board of ' + regs[0] : regs.length + ' boards: ' + regs.join(', ')}`, 300),
      ...(d.pn === true ? { pinned: true } : {}), ...(d.lk === true ? { locked: true } : {}) });
    return { ids };
  });
}

/* the author changes their own words, and any admin those signed by the Edictum team; the post shows when it was edited */
export async function cbEdit(db, who, d, regions) {
  const reg = where(regions, d), tid = id20(d.topic), rid = d.reply ? id20(d.reply) : '', x = body(d.x, CB_TEXT), ti = line(d.ti, CB_TITLE);
  await gate(db, who, reg);
  if (!tid || (d.reply && !rid)) throw new HttpsError('invalid-argument', 'Choose a post.');
  if (!x || (!rid && ti.length < 3)) throw new HttpsError('invalid-argument', 'A post needs its text, and a topic its title.');
  return db.runTransaction(async tx => {
    const ref = db.doc('cb/' + reg + '/posts/' + tid + (rid ? '/posts/' + rid : '')), p = await tx.get(ref);
    const team = p.get('of') === true && who.admin;
    if (p.exists && p.get('a') !== who.uid && !team) throw new HttpsError('permission-denied', 'You can only edit your own posts.');
    await eligibility(tx, who, team ? TEAM_OK : {});
    if (!p.exists || p.get('hd')) refuse('cb_missing', 'This post is no longer there.');
    tx.update(ref, { x, ...(rid ? {} : { ti, ...(CB_TAGS.includes(d.tg) ? { tg: d.tg } : {}) }), ed: Date.now() });
    return { ok: true };
  });
}

/* every reply under a topic, in batches (the topic itself goes last); how many each author wrote */
async function dropTopic(db, ref) {
  const tally = new Map();
  for (;;) {
    const qs = await ref.collection('posts').limit(400).get();
    if (qs.empty) break;
    const b = db.batch(); qs.docs.forEach(r => { const a = r.get('a'); if (!r.get('of')) tally.set(a, (tally.get(a) || 0) + 1); b.delete(r.ref); b.delete(db.doc('cbHidden/' + r.id)); }); await b.commit();
  }
  return tally;
}
/* a topic gone: who followed it, and their copies */
async function dropSubs(db, tid) {
  const s = await subsRef(db, tid).get(), uids = Object.keys(subsOf(s));
  for (let i = 0; i < uids.length; i += 400) { const b = db.batch(); uids.slice(i, i + 400).forEach(u => b.delete(watchRef(db, u, tid))); await b.commit(); }
  if (s.exists) await s.ref.delete();
}

/* the author deletes their own post, or staff delete anyone's */
export async function cbDelete(db, who, d, regions) {
  const reg = where(regions, d), tid = id20(d.topic), rid = d.reply ? id20(d.reply) : '';
  await gate(db, who, reg);
  if (!tid || (d.reply && !rid)) throw new HttpsError('invalid-argument', 'Choose a post.');
  const topicRef = db.doc('cb/' + reg + '/posts/' + tid), ref = rid ? topicRef.collection('posts').doc(rid) : topicRef, p = await ref.get();
  if (!p.exists) return { ok: true };
  const staff = who.admin || who.mod;
  if (p.get('a') !== who.uid && !staff) throw new HttpsError('permission-denied', 'You can only delete your own posts.');
  const replies = rid ? 0 : p.get('rc') || 0;
  const tally = rid ? new Map() : await dropTopic(db, ref);
  if (!p.get('of') && !p.get('as')) tally.set(p.get('a'), (tally.get(p.get('a')) || 0) + 1);
  await db.runTransaction(async tx => {
    const metaRef = db.doc('cb/' + reg), [meta, topic] = await Promise.all([tx.get(metaRef), rid ? tx.get(topicRef) : null]);
    const m = meta.exists ? meta.data() : {};
    tx.set(metaRef, { n: Math.max(0, (m.n || 0) - (rid ? 0 : 1)), r: Math.max(0, (m.r || 0) - (rid ? 1 : replies)) }, { merge: true });
    if (rid && topic.exists) tx.update(topicRef, { rc: Math.max(0, (topic.get('rc') || 0) - 1) });
    tx.delete(ref); tx.delete(db.doc('cbHidden/' + (rid || tid)));
  });
  await uncount(db, tally);
  if (!rid) await dropSubs(db, tid);
  if (p.get('a') !== who.uid) {
    const b = db.batch();
    audit(b, db, who, 'board_delete', { target: line(p.get('a'), 128), name: line(p.get('nm'), 80), reg, topic: tid, ...(rid ? { reply: rid } : {}),
      x: line((p.get('ti') ? p.get('ti') + ': ' : '') + (p.get('x') || ''), 1000), reason: line(d.reason, 300) || 'Removed from the Community Board' });
    const report = typeof d.report === 'string' && /^[\w-]{1,128}$/.test(d.report) ? d.report : '';
    if (report) b.delete(db.doc('reports/' + report));
    await b.commit();
  }
  return { ok: true };
}

/* staff, from inside the board: pin, lock, hide (its words move to cbHidden, which only admins read) and move */
export async function cbMod(db, who, d, regions) {
  staffOnly(who);
  const reg = where(regions, d), tid = id20(d.topic), rid = d.reply ? id20(d.reply) : '', act = d.act, reason = line(d.reason, 300);
  if (!tid || (d.reply && !rid)) throw new HttpsError('invalid-argument', 'Choose a post.');
  const acts = rid ? ['hide', 'unhide', 'nosig'] : ['pin', 'unpin', 'lock', 'unlock', 'hide', 'unhide', 'move', 'nosig'];
  if (!acts.includes(act)) throw new HttpsError('invalid-argument', 'Unknown moderation action.');
  if (['pin', 'unpin', 'move'].includes(act) && !who.admin) throw new HttpsError('permission-denied', 'Only admins can pin or move topics.');
  const topicRef = db.doc('cb/' + reg + '/posts/' + tid), ref = rid ? topicRef.collection('posts').doc(rid) : topicRef;
  if (act === 'move') return cbMove(db, who, reg, tid, d, regions, reason);
  return db.runTransaction(async tx => {
    const hidRef = db.doc('cbHidden/' + (rid || tid)), [p, h, subs] = await tx.getAll(ref, hidRef, subsRef(db, tid));
    if (!p.exists) refuse('cb_missing', 'This post is no longer there.');
    // a hidden topic's title leaves the followers' copies too (their bells show them), and comes back with it
    const titled = ti => { if (!rid) for (const u of Object.keys(subsOf(subs))) tx.set(watchRef(db, u, tid), { ti }, { merge: true }); };
    let was = '';
    if (act === 'pin' || act === 'unpin') tx.update(ref, { pn: act === 'pin' ? true : FieldValue.delete() });
    else if (act === 'lock' || act === 'unlock') tx.update(ref, { lk: act === 'lock' ? true : FieldValue.delete() });
    else if (act === 'hide') {
      if (p.get('hd')) return { ok: true };
      tx.set(hidRef, { reg, tid, ...(rid ? { rid } : { ti: p.get('ti') || '' }), x: p.get('x') || '', by: who.uid, t: Date.now(), ...(reason ? { why: reason } : {}) });
      tx.update(ref, { hd: true, x: '', ...(rid ? {} : { ti: '' }) });
      titled('');
    } else if (act === 'unhide') {
      if (!p.get('hd')) return { ok: true };
      const ti = h.exists ? h.get('ti') || 'Untitled' : 'Untitled';
      tx.update(ref, { hd: FieldValue.delete(), x: h.exists ? h.get('x') || '' : '', ...(rid ? {} : { ti }) });
      tx.delete(hidRef);
      titled(line(ti, CB_TITLE));
    } else if (act === 'nosig') {
      // the author's signature, which shows under all their posts: staff take it away (the author may write another)
      const a = p.get('a'), u = typeof a === 'string' && /^[\w-]{1,128}$/.test(a) && !p.get('of') && !p.get('as') ? await tx.get(userRef(db, a)) : null;
      if (!u || !u.exists || !u.get('sg')) return { ok: true };
      was = line(u.get('sg'), CB_SIG);
      tx.update(u.ref, { sg: FieldValue.delete() });
    }
    audit(tx, db, who, 'board_' + act, { target: line(p.get('a'), 128), name: line(p.get('nm'), 80), reg, topic: tid, ...(rid ? { reply: rid } : {}), ...(was ? { x: was } : {}), ...(reason ? { reason } : {}) });
    return { ok: true };
  });
}

/* a topic, with its replies, to another region's board under the same ids */
async function cbMove(db, who, reg, tid, d, regions, reason) {
  const to = typeof d.to === 'string' && regions.has(d.to) && d.to !== reg ? d.to : '';
  if (!to) throw new HttpsError('invalid-argument', 'Choose another region.');
  const from = db.doc('cb/' + reg + '/posts/' + tid), dest = db.doc('cb/' + to + '/posts/' + tid), p = await from.get();
  if (!p.exists) refuse('cb_missing', 'This topic is no longer there.');
  const replies = await from.collection('posts').get();
  for (let i = 0; i < replies.docs.length; i += 400) {
    const b = db.batch(); replies.docs.slice(i, i + 400).forEach(r => b.set(dest.collection('posts').doc(r.id), r.data())); await b.commit();
  }
  const n = replies.size;
  await db.runTransaction(async tx => {
    const [mf, mt] = await Promise.all([tx.get(db.doc('cb/' + reg)), tx.get(db.doc('cb/' + to))]), f = mf.exists ? mf.data() : {}, t = mt.exists ? mt.data() : {};
    tx.set(dest, { ...p.data(), rc: n });
    tx.set(db.doc('cb/' + reg), { n: Math.max(0, (f.n || 0) - 1), r: Math.max(0, (f.r || 0) - n) }, { merge: true });
    tx.set(db.doc('cb/' + to), { n: (t.n || 0) + 1, r: (t.r || 0) + n, la: Math.max(t.la || 0, p.get('la') || 0) }, { merge: true });
    tx.delete(from);
    audit(tx, db, who, 'board_move', { target: line(p.get('a'), 128), name: line(p.get('nm'), 80), reg, to, topic: tid, ...(reason ? { reason } : {}) });
  });
  for (let i = 0; i < replies.docs.length; i += 400) {
    const b = db.batch(); replies.docs.slice(i, i + 400).forEach(r => b.delete(r.ref)); await b.commit();
  }
  const hid = await db.collection('cbHidden').where('tid', '==', tid).get();
  if (!hid.empty) { const b = db.batch(); hid.docs.forEach(h => b.update(h.ref, { reg: to })); await b.commit(); }
  // its followers follow it to its new board
  const s = await subsRef(db, tid).get(), uids = Object.keys(subsOf(s));
  for (let i = 0; i < uids.length; i += 400) { const b = db.batch(); uids.slice(i, i + 400).forEach(u => b.set(watchRef(db, u, tid), { reg: to }, { merge: true })); await b.commit(); }
  if (s.exists) await s.ref.update({ reg: to });
  return { ok: true, reg: to };
}

/* follow a topic (its replies come to the bell) or stop: stopping mutes it, so replying to it again does not follow it
   again; Follow does. Any nation that reads the board may follow, a guest too */
export async function cbFollow(db, who, d, regions) {
  const reg = where(regions, d), tid = id20(d.topic), on = d.on === true;
  await gate(db, who, reg);
  if (!tid) throw new HttpsError('invalid-argument', 'Choose a topic.');
  return db.runTransaction(async tx => {
    await eligibility(tx, who, { linked: false });
    const topicRef = db.doc('cb/' + reg + '/posts/' + tid), [p, s] = await tx.getAll(topicRef, subsRef(db, tid));
    if (!p.exists || p.get('hd')) refuse('cb_missing', 'This topic is no longer there.');
    const f = subsOf(s), now = Date.now();
    if (on && f[who.uid] !== 1 && following(f).length >= CB_SUBS) refuse('cb_subs_full', `This topic already has ${CB_SUBS} followers, all it can tell of its replies.`);
    if (f[who.uid] === undefined && Object.keys(f).length >= 2 * CB_SUBS) refuse('cb_subs_full', 'This topic cannot take more followers.');
    tx.set(subsRef(db, tid), { reg, f: { [who.uid]: on ? 1 : 0 } }, { merge: true });
    tx.set(watchRef(db, who.uid, tid), { reg, ti: line(p.get('ti'), CB_TITLE), f: on ? 1 : 0, n: 0, t: now, s: now }, { merge: true });
    return { ok: true, f: on ? 1 : 0 };
  });
}

/* a reaction on a topic or a reply: one per nation on each post (the kinds of the region page's board), the same kind
   again takes it back. Any nation that reads the board may react, a guest too; a moderated or banned one may not.
   cbRx/{uid} lists where, so the reactions go with the account (cbForget) */
export const CB_RV_MAX = 500, CB_RX_KEEP = 2000;
export async function cbReact(db, who, d, regions) {
  const reg = where(regions, d), tid = id20(d.topic), rid = d.reply ? id20(d.reply) : '', kind = RMB_REACT.includes(d.e) ? d.e : '';
  await gate(db, who, reg);
  if (!tid || (d.reply && !rid) || !kind) throw new HttpsError('invalid-argument', 'Choose a post and a reaction.');
  return db.runTransaction(async tx => {
    await eligibility(tx, who, { linked: false });
    const ref = db.doc('cb/' + reg + '/posts/' + tid + (rid ? '/posts/' + rid : '')), kRef = db.doc('cbRx/' + who.uid), [p, k] = await tx.getAll(ref, kRef);
    if (!p.exists || p.get('hd')) refuse('cb_missing', 'This post is no longer there.');
    const rv = p.get('rv') && typeof p.get('rv') === 'object' ? p.get('rv') : {}, had = rv[who.uid] || '', pick = had === kind ? '' : kind;
    if (pick && !had && Object.keys(rv).length >= CB_RV_MAX) refuse('cb_rx_full', 'This post has all the reactions it can hold.');
    tx.update(ref, new FieldPath('rv', who.uid), pick || FieldValue.delete());
    const at = reg + '/' + tid + (rid ? '/' + rid : ''), was = (k.exists && Array.isArray(k.get('p')) ? k.get('p') : []).filter(x => typeof x === 'string' && x !== at);
    tx.set(kRef, { p: pick ? was.concat(at).slice(-CB_RX_KEEP) : was });
    return { e: pick };
  });
}

/* the signature under the player's posts (Customise › Community Board): a line of their own, or none. A Registered
   Nation, as for posting; it shows at once under every post of theirs */
export async function cbSig(db, who, d) {
  const sg = line(d.sg, CB_SIG);
  return db.runTransaction(async tx => {
    await eligibility(tx, who);
    tx.set(userRef(db, who.uid), { sg: sg || FieldValue.delete() }, { merge: true });
    return { ok: true, sg };
  });
}

/* an account closed, or a nation removed by an admin (functions/accounts.js, functions/admin.js): its reactions, the
   topics it followed, its copies of them and its board profile */
export async function cbForget(db, uid) {
  if (typeof uid !== 'string' || !/^[\w-]{1,128}$/.test(uid)) return;
  const [k, ws] = await Promise.all([db.doc('cbRx/' + uid).get(), db.collection('cbWatch/' + uid + '/t').get()]);
  const w = db.bulkWriter(), quiet = p => p.catch(() => {});
  w.onWriteError(() => false);
  const done = [];
  for (const at of k.exists && Array.isArray(k.get('p')) ? k.get('p') : []) {
    const m = /^([a-z]{2,40})\/([A-Za-z0-9]{20})(?:\/([A-Za-z0-9]{20}))?$/.exec(String(at));
    if (m) done.push(quiet(w.update(db.doc('cb/' + m[1] + '/posts/' + m[2] + (m[3] ? '/posts/' + m[3] : '')), new FieldPath('rv', uid), FieldValue.delete())));
  }
  for (const s of ws.docs) done.push(quiet(w.update(subsRef(db, s.id), new FieldPath('f', uid), FieldValue.delete())));
  await Promise.all([Promise.all(done), w.close()]);
  await db.recursiveDelete(db.collection('cbWatch/' + uid + '/t'));
  await Promise.all([db.doc('cbRx/' + uid).delete(), userRef(db, uid).delete()]);
}

/* ── the Region page's message board ──
     boards/{reg}/posts/{pid}  {a, t, x, re?, rv?, of?, nm?, rl?, st?}
   A reply is a message of its own in the same collection, with re: the id of the message it answers. Threads stay
   one level deep: a reply answers a message on the same board that is not itself a reply (civic op 'topic' checks it
   with rmbParent). Reactions are rv {uid: kind}, written only here (civic op 'topicReact'): one per nation on each
   message, and the same kind again takes it back. Everyone reads them, so readers see which nations reacted. */
export const RMB_REACT = ['up', 'heart', 'party', 'think'];
export const RMB_RV_MAX = 500;
export async function rmbParent(tx, db, reg, re) {
  const id = id20(re);
  if (!id) throw new HttpsError('invalid-argument', 'Choose a message to reply to.');
  const p = await tx.get(db.doc('boards/' + reg + '/posts/' + id));
  if (!p.exists || p.get('re')) refuse('rmb_reply_missing', 'That message is no longer there to reply to.');
  return id;
}
/* any nation of the region reacts (a guest too, as on development news); a moderated or banned one may not */
export async function rmbReact(db, who, d) {
  const pid = id20(d.post), kind = RMB_REACT.includes(d.e) ? d.e : '';
  if (!pid || !kind) throw new HttpsError('invalid-argument', 'Choose a message and a reaction.');
  return db.runTransaction(async tx => {
    const e = await eligibility(tx, who, { linked: false }), reg = e.n.reg;
    if (d.reg && d.reg !== reg) throw new HttpsError('permission-denied', 'React on your own region’s board.');
    const ref = db.doc('boards/' + reg + '/posts/' + pid), p = await tx.get(ref);
    if (!p.exists) refuse('rmb_missing', 'That message is no longer on the board.');
    const rv = p.get('rv') && typeof p.get('rv') === 'object' ? p.get('rv') : {}, had = rv[who.uid] || '', pick = had === kind ? '' : kind;
    if (pick && !had && Object.keys(rv).length >= RMB_RV_MAX) refuse('rmb_full', 'This message has all the reactions it can hold.');
    tx.update(ref, new FieldPath('rv', who.uid), pick || FieldValue.delete());
    return { e: pick };
  });
}
/* a nation's reactions go with its account (functions/accounts.js) or with its removal by an admin (functions/admin.js) */
export async function rmbForget(db, uid, regs) {
  if (typeof uid !== 'string' || !uid) return 0;
  const found = await Promise.all([...regs].map(reg => db.collection('boards/' + reg + '/posts').where(new FieldPath('rv', uid), 'in', RMB_REACT).get()));
  const docs = found.flatMap(q => q.docs);
  if (!docs.length) return 0;
  const w = db.bulkWriter();
  await Promise.all([Promise.all(docs.map(d => w.update(d.ref, new FieldPath('rv', uid), FieldValue.delete()))), w.close()]);
  return docs.length;
}
