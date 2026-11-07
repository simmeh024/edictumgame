import { HttpsError } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { eligibility, refuse } from './eligibility.js';

/* The Community Board: one board per region, read by everyone, written only here (civic ops cb*), so every post
   carries what the server knows rather than what a browser claims.
     cb/{reg}                         {n: topics, r: replies, la: last activity (ms), dd: day (UTC date), dn: posts that day}
     cb/{reg}/posts/{tid}             a topic {a, nm, rg, fl?, fd?, st?, of?, rl?, ti, x, tg, t, la, rc, pn?, lk?, hd?, ed?}
     cb/{reg}/posts/{tid}/posts/{rid} a reply {a, nm, rg, fl?, fd?, st?, of?, rl?, x, t, hd?, ed?}
     cbHidden/{id}                    what a hidden topic or reply said, for admins only {reg, tid, rid?, ti?, x, by, t}
     cbPace/{uid}                     the pacing of each player's posts {p, q} (paced(), below)
   Topics and replies are 'posts' collections so deleting an account, or an admin removing a nation, takes them too.
   Any Registered Nation may open a topic or reply in any region; the author is shown as their nation was when they
   posted: its name, region, flag, a Founding Supporter mark (fd) and an Edictum staff mark (st).
   An admin may instead sign as the Edictum team (of: true, with a name and a role of their choosing, no flag or
   region): that needs no nation of their own, reaches a closed region's board too, and any admin may edit it.
   cbPost, from the admin portal, opens the same topic on several boards (or all of them) at once. */
export const CB_TAGS = ['general', 'trade', 'diplomacy', 'war', 'help', 'offtopic'];
const id20 = v => typeof v === 'string' && /^[A-Za-z0-9]{20}$/.test(v) ? v : '';
const line = (x, max) => typeof x === 'string' ? x.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';
const body = (x, max) => typeof x === 'string' ? x.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, max) : '';
const day = t => new Date(t).toISOString().slice(0, 10);
export const CB_TITLE = 120, CB_TEXT = 4000;

function where(regions, d) {
  const reg = typeof d.reg === 'string' && regions.has(d.reg) ? d.reg : '';
  if (!reg) throw new HttpsError('invalid-argument', 'Choose a region.');
  return reg;
}
/* the author as readers see them, from the saved nation and the server's own records */
async function author(tx, db, who, e) {
  const shop = await tx.get(db.doc('shop/' + who.uid));
  const flag = e.n.flag && typeof e.n.flag === 'object' ? JSON.stringify(e.n.flag) : '';
  return { a: who.uid, nm: line(e.saved.get('name'), 80) || 'A nation', rg: e.n.reg || e.saved.get('reg') || '',
    ...(flag && flag.length <= 4000 ? { fl: flag } : {}), ...(shop.exists && shop.get('owns.founder') ? { fd: true } : {}), ...(who.admin ? { st: 'admin' } : who.mod ? { st: 'mod' } : {}) };
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

export async function cbTopic(db, who, d, regions) {
  const reg = where(regions, d), ti = line(d.ti, CB_TITLE), x = body(d.x, CB_TEXT), tg = CB_TAGS.includes(d.tg) ? d.tg : 'general';
  if (ti.length < 3) throw new HttpsError('invalid-argument', 'Give the topic a title of at least three characters.');
  if (!x) throw new HttpsError('invalid-argument', 'Write something first.');
  return db.runTransaction(async tx => {
    const me = await signer(tx, db, who, d), metaRef = db.doc('cb/' + reg), meta = await tx.get(metaRef);
    const now = Date.now(), ref = db.collection('cb/' + reg + '/posts').doc(), mark = await paced(tx, db, who, true, now);
    mark();
    tx.create(ref, { ...me, ti, x, tg, t: now, la: now, rc: 0 });
    tx.set(metaRef, counted(meta, now, { n: 1 }));
    return { id: ref.id };
  });
}

export async function cbReply(db, who, d, regions) {
  const reg = where(regions, d), tid = id20(d.topic), x = body(d.x, CB_TEXT);
  if (!tid) throw new HttpsError('invalid-argument', 'Choose a topic.');
  if (!x) throw new HttpsError('invalid-argument', 'Write a reply first.');
  return db.runTransaction(async tx => {
    const me = await signer(tx, db, who, d), metaRef = db.doc('cb/' + reg), topicRef = db.doc('cb/' + reg + '/posts/' + tid);
    const [meta, topic] = await Promise.all([tx.get(metaRef), tx.get(topicRef)]);
    if (!topic.exists || topic.get('hd')) refuse('cb_missing', 'This topic is no longer there.');
    if (topic.get('lk') && !who.admin && !who.mod) refuse('cb_locked', 'This topic is locked: it takes no more replies.');
    const now = Date.now(), ref = topicRef.collection('posts').doc(), mark = await paced(tx, db, who, false, now);
    mark();
    tx.create(ref, { ...me, x, t: now });
    tx.update(topicRef, { rc: (topic.get('rc') || 0) + 1, la: now });
    tx.set(metaRef, counted(meta, now, { r: 1 }));
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

/* every reply under a topic, in batches; the topic itself goes last */
async function dropTopic(db, ref) {
  for (;;) {
    const qs = await ref.collection('posts').limit(400).get();
    if (qs.empty) break;
    const b = db.batch(); qs.docs.forEach(r => { b.delete(r.ref); b.delete(db.doc('cbHidden/' + r.id)); }); await b.commit();
  }
}

/* the author deletes their own post, or staff delete anyone's */
export async function cbDelete(db, who, d, regions) {
  const reg = where(regions, d), tid = id20(d.topic), rid = d.reply ? id20(d.reply) : '';
  if (!tid || (d.reply && !rid)) throw new HttpsError('invalid-argument', 'Choose a post.');
  const topicRef = db.doc('cb/' + reg + '/posts/' + tid), ref = rid ? topicRef.collection('posts').doc(rid) : topicRef, p = await ref.get();
  if (!p.exists) return { ok: true };
  const staff = who.admin || who.mod;
  if (p.get('a') !== who.uid && !staff) throw new HttpsError('permission-denied', 'You can only delete your own posts.');
  const replies = rid ? 0 : p.get('rc') || 0;
  if (!rid) await dropTopic(db, ref);
  await db.runTransaction(async tx => {
    const metaRef = db.doc('cb/' + reg), [meta, topic] = await Promise.all([tx.get(metaRef), rid ? tx.get(topicRef) : null]);
    const m = meta.exists ? meta.data() : {};
    tx.set(metaRef, { n: Math.max(0, (m.n || 0) - (rid ? 0 : 1)), r: Math.max(0, (m.r || 0) - (rid ? 1 : replies)) }, { merge: true });
    if (rid && topic.exists) tx.update(topicRef, { rc: Math.max(0, (topic.get('rc') || 0) - 1) });
    tx.delete(ref); tx.delete(db.doc('cbHidden/' + (rid || tid)));
  });
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
  const acts = rid ? ['hide', 'unhide'] : ['pin', 'unpin', 'lock', 'unlock', 'hide', 'unhide', 'move'];
  if (!acts.includes(act)) throw new HttpsError('invalid-argument', 'Unknown moderation action.');
  if (['pin', 'unpin', 'move'].includes(act) && !who.admin) throw new HttpsError('permission-denied', 'Only admins can pin or move topics.');
  const topicRef = db.doc('cb/' + reg + '/posts/' + tid), ref = rid ? topicRef.collection('posts').doc(rid) : topicRef;
  if (act === 'move') return cbMove(db, who, reg, tid, d, regions, reason);
  return db.runTransaction(async tx => {
    const hidRef = db.doc('cbHidden/' + (rid || tid)), [p, h] = await Promise.all([tx.get(ref), tx.get(hidRef)]);
    if (!p.exists) refuse('cb_missing', 'This post is no longer there.');
    if (act === 'pin' || act === 'unpin') tx.update(ref, { pn: act === 'pin' ? true : FieldValue.delete() });
    else if (act === 'lock' || act === 'unlock') tx.update(ref, { lk: act === 'lock' ? true : FieldValue.delete() });
    else if (act === 'hide') {
      if (p.get('hd')) return { ok: true };
      tx.set(hidRef, { reg, tid, ...(rid ? { rid } : { ti: p.get('ti') || '' }), x: p.get('x') || '', by: who.uid, t: Date.now(), ...(reason ? { why: reason } : {}) });
      tx.update(ref, { hd: true, x: '', ...(rid ? {} : { ti: '' }) });
    } else if (act === 'unhide') {
      if (!p.get('hd')) return { ok: true };
      tx.update(ref, { hd: FieldValue.delete(), x: h.exists ? h.get('x') || '' : '', ...(rid ? {} : { ti: h.exists ? h.get('ti') || 'Untitled' : 'Untitled' }) });
      tx.delete(hidRef);
    }
    audit(tx, db, who, 'board_' + act, { target: line(p.get('a'), 128), name: line(p.get('nm'), 80), reg, topic: tid, ...(rid ? { reply: rid } : {}), ...(reason ? { reason } : {}) });
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
  return { ok: true, reg: to };
}
