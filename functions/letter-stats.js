// Letter statistics for the admin portal (functions/admin.js, op 'letterStats'): how players use the Messages page.
// Counts only. It reads who wrote to whom and when, the kind of note and of attachment, never the words, and it lists
// no pairs of correspondents: who a player writes to stays on that player's admin page (op 'letters'), behind a
// reason the audit log keeps.
//   letters/<by>~<to>~<t> {by, to, x, t, ts, exp, k?, r?, a?, g?}: one document per reader, so a group letter is one per
//   member. A letter here is a writer's letter (by + t), its copies the documents.
import { Timestamp } from 'firebase-admin/firestore';

export const DAY = 86400000, LS_DAYS = [7, 30], LS_READ = 20000, LS_TOP = 15, LS_CHART = 30, LS_REPORTS = 10;
const str = (v, max = 128) => typeof v === 'string' ? v.slice(0, max) : '';
const NOTES = new Set(['congrats', 'protest', 'condol', 'friend', 'ultim', 'treaty']);
const ATTS = new Set(['deal', 'peace', 'ally', 'city', 'ach']);
export const lsDayKey = t => new Date(t).toISOString().slice(0, 10);

/* the letters of the window, boiled down. rows: {by, to, t, g?, k?, a?} (one per copy) */
export function letterSummary(rows) {
  const writers = new Map(), readers = new Map(), pairs = new Set(), sent = new Set(), notes = {}, att = {};
  let copies = 0, group = 0;
  for (const r of rows) {
    const by = str(r.by), to = str(r.to), t = Number(r.t) || 0;
    if (!by || !to) continue;
    copies++;
    const key = by + '~' + t, first = !sent.has(key);
    sent.add(key);
    const w = writers.get(by) || { uid: by, sent: 0, copies: 0, readers: new Set(), groups: 0, last: 0 };
    w.copies++; w.readers.add(to); if (t > w.last) w.last = t;
    if (first) {
      w.sent++;
      if (r.g) { group++; w.groups++; }
      if (NOTES.has(r.k)) notes[r.k] = (notes[r.k] || 0) + 1;
      if (ATTS.has(r.a)) att[r.a] = (att[r.a] || 0) + 1;
    }
    writers.set(by, w);
    const d = readers.get(to) || { uid: to, got: 0 };
    d.got++; readers.set(to, d);
    pairs.add(by < to ? by + '|' + to : to + '|' + by);
  }
  const top = [...writers.values()].sort((a, b) => b.sent - a.sent || b.readers.size - a.readers.size || b.last - a.last)
    .slice(0, LS_TOP).map(w => ({ uid: w.uid, sent: w.sent, copies: w.copies, readers: w.readers.size, groups: w.groups, last: w.last }));
  const most = [...readers.values()].sort((a, b) => b.got - a.got).slice(0, LS_TOP);
  return { letters: sent.size, copies, group, writers: writers.size, readers: readers.size, pairs: pairs.size, notes, att, top, most,
    perWriter: [...writers.values()].map(w => [w.uid, w.sent]) };
}

/* the page's numbers, read now: a few counts, the window's letters (newest first, at most LS_READ copies), the names and
   regions of the nations in it, the letter reports waiting and the blocks */
export async function letterStats(db, data = {}, now = Date.now()) {
  const days = LS_DAYS.includes(data.days) ? data.days : 7, col = db.collection('letters');
  const since = n => Timestamp.fromMillis(now - n * DAY), count = q => q.count().get().then(s => s.data().count).catch(() => null);
  const dayStart = Math.floor(now / DAY) * DAY;
  const [d1, d7, d30, perDay, qs, reps, repN, blocks, blocksNew] = await Promise.all([
    count(col.where('ts', '>=', since(1))), count(col.where('ts', '>=', since(7))), count(col.where('ts', '>=', since(30))),
    Promise.all(Array.from({ length: LS_CHART }, (_, i) => {
      const a = dayStart - (LS_CHART - 1 - i) * DAY;
      return count(col.where('ts', '>=', Timestamp.fromMillis(a)).where('ts', '<', Timestamp.fromMillis(a + DAY))).then(n => ({ d: lsDayKey(a), n }));
    })),
    col.where('ts', '>=', since(days)).orderBy('ts', 'desc').select('by', 'to', 't', 'g', 'k', 'a').limit(LS_READ).get(),
    db.collection('reports').where('kind', '==', 'letter').limit(200).get().catch(() => ({ docs: [] })),
    count(db.collection('reports').where('kind', '==', 'letter')),
    count(db.collection('lblock')), count(db.collection('lblock').where('t', '>=', since(days)))
  ]);
  const rows = qs.docs.map(d => ({ by: d.get('by'), to: d.get('to'), t: d.get('t'), g: !!d.get('g'), k: d.get('k'), a: d.get('a')?.k }));
  const S = letterSummary(rows);
  /* the nations named on the page, and every writer's region for the letters by region */
  const recent = reps.docs.map(d => ({ id: d.id, target: str(d.get('target')), reason: str(d.get('reason'), 40), t: d.get('t')?.toMillis?.() || 0 }))
    .sort((a, b) => b.t - a.t).slice(0, LS_REPORTS);
  const ids = [...new Set([...S.perWriter.map(w => w[0]), ...S.most.map(r => r.uid), ...recent.map(r => r.target)])].filter(u => u && !u.includes('/')).slice(0, 3000);
  const who = new Map();
  for (let i = 0; i < ids.length; i += 300) {
    const got = await db.getAll(...ids.slice(i, i + 300).map(u => db.doc('nations/' + u)), { fieldMask: ['name', 'reg'] });
    for (const n of got) if (n.exists) who.set(n.id, { name: str(n.get('name'), 80), reg: str(n.get('reg'), 40) });
  }
  const named = o => ({ ...o, name: who.get(o.uid)?.name || '', reg: who.get(o.uid)?.reg || '' });
  const regions = {};
  for (const [uid, n] of S.perWriter) { const r = who.get(uid)?.reg || ''; regions[r] = (regions[r] || 0) + n; }
  return {
    at: now, days, limited: qs.size >= LS_READ,
    total: { d1, d7, d30 }, perDay,
    window: { letters: S.letters, copies: S.copies, group: S.group, writers: S.writers, readers: S.readers, pairs: S.pairs, notes: S.notes, att: S.att,
      regions: Object.entries(regions).map(([reg, n]) => ({ reg, n })).sort((a, b) => b.n - a.n) },
    top: S.top.map(named), most: S.most.map(named),
    reports: { n: repN ?? reps.docs.length, recent: recent.map(r => ({ ...r, name: who.get(r.target)?.name || '' })) },
    blocks: { all: blocks, recent: blocksNew }
  };
}
