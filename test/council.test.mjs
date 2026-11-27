// The World Assembly Council (27 Nov 2026; functions/council.js, game/edictum.html "the World Assembly Council"). Every
// region's Delegate holds that region's seat; the chair is elected by region from the 1st to the 6th of each month; motions
// pass once more than half of the seats, and at least two, vote For; a passed edict idea goes to the admins. The ops run
// here against a small in-memory Firestore, with the Assembly engine stood in by a table of Delegates.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  WAC_FIRST, WAC_VOTE_DAYS, wacMonth, wacOpenAt, wacCloseAt, wacNext, wacWindow, wacDue, wacCount, wacChairFrom, wacPasses,
  wacRefresh, wacNote, council, councilAdmin, resetCouncil, isCouncilOp
} from '../functions/council.js';
import { RC_WAC, rcShared, rcMayUse } from '../functions/regionchat.js';

const html = fs.readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
const rules = fs.readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
const civic = fs.readFileSync(new URL('../functions/civic.js', import.meta.url), 'utf8');
const admin = fs.readFileSync(new URL('../functions/admin.js', import.meta.url), 'utf8');
const D = (y, m, d, h = 0) => Date.UTC(y, m - 1, d, h);

test('the calendar: the vote runs from the 1st to the 6th of each month, from December 2026', () => {
  assert.equal(WAC_FIRST, '2026-12');
  assert.equal(WAC_VOTE_DAYS, 5);
  assert.equal(wacMonth(D(2026, 12, 31, 23)), '2026-12');
  assert.equal(wacNext('2026-12'), '2027-01');
  assert.equal(wacNext('2027-01'), '2027-02');
  assert.equal(wacOpenAt('2027-03'), D(2027, 3, 1));
  assert.equal(wacCloseAt('2027-03'), D(2027, 3, 6));
  // before the first vote: the first one, not yet open
  assert.deepEqual(wacWindow(D(2026, 11, 27)), { m: '2026-12', open: D(2026, 12, 1), close: D(2026, 12, 6), on: false });
  assert.equal(wacWindow(D(2026, 12, 1)).on, true);
  assert.equal(wacWindow(D(2026, 12, 5, 23)).on, true);
  // once closed, the next month's
  assert.deepEqual(wacWindow(D(2026, 12, 6)), { m: '2027-01', open: D(2027, 1, 1), close: D(2027, 1, 6), on: false });
  // the votes closed and not counted, oldest first
  assert.deepEqual(wacDue('', D(2026, 12, 5)), []);
  assert.deepEqual(wacDue('', D(2026, 12, 6)), ['2026-12']);
  assert.deepEqual(wacDue('2026-12', D(2027, 2, 10)), ['2027-01', '2027-02']);
  assert.deepEqual(wacDue('2027-02', D(2027, 2, 10)), []);
});

test('the count: most ballots, then the region in the chair, then the first to reach its count', () => {
  const b = { a: { v: 'x', t: 5 }, b: { v: 'x', t: 9 }, c: { v: 'y', t: 1 }, d: { v: 'y', t: 2 }, e: { v: 'z', t: 3 } };
  assert.deepEqual(wacCount(b, '').rank, ['y', 'x', 'z'], 'y reached two first');
  assert.deepEqual(wacCount(b, 'x').rank, ['x', 'y', 'z'], 'the region in the chair keeps it on a tie');
  assert.deepEqual(wacCount(b, '').n, { y: 2, x: 2, z: 1 });
  // a ballot for its own region, or for nothing, does not count
  assert.deepEqual(wacCount({ a: { v: 'a', t: 1 }, b: { v: '', t: 1 }, c: null }, '').rank, []);
  // no ballots: the chair stays where it was
  assert.deepEqual(wacCount({}, 'q').rank, ['q']);
  assert.deepEqual(wacCount({}, '').rank, []);
});

test('the chair passes down the count to the first region that has a Delegate', () => {
  const seats = { y: { id: 'uy', nm: 'Yland' }, z: { id: 'uz', nm: 'Zland' } };
  assert.deepEqual(wacChairFrom(['y', 'z'], seats), { reg: 'y', id: 'uy', nm: 'Yland' });
  assert.deepEqual(wacChairFrom(['x', 'z'], seats), { reg: 'z', id: 'uz', nm: 'Zland' });
  assert.equal(wacChairFrom(['x'], seats), null);
  assert.equal(wacChairFrom([], seats), null);
});

test('a motion passes with more than half of the seats, and at least two, For', () => {
  const v = (...a) => Object.fromEntries(a.map((x, i) => ['r' + i, { v: x }]));
  assert.equal(wacPasses(v(1), 1), false, 'one seat alone never passes anything');
  assert.equal(wacPasses(v(1, 1), 2), true);
  assert.equal(wacPasses(v(1, 1), 4), false, 'half is not more than half');
  assert.equal(wacPasses(v(1, 1, 1), 4), true);
  assert.equal(wacPasses(v(1, 1, -1, 0), 5), false);
  assert.equal(wacPasses(v(1, 1, 1, -1, 0), 5), true);
});

/* ── a small in-memory Firestore: documents by path, transactions that read before they write ── */
const isDel = v => v && v.constructor && v.constructor.name === 'DeleteTransform';
function mergeInto(base, patch) {
  const out = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (isDel(v)) delete out[k];
    else if (v && typeof v === 'object' && !Array.isArray(v) && !(v.constructor && v.constructor.name !== 'Object')) out[k] = mergeInto(out[k] && typeof out[k] === 'object' ? out[k] : {}, v);
    else out[k] = v;
  }
  return out;
}
const strip = o => { const out = {}; for (const [k, v] of Object.entries(o)) if (!isDel(v)) out[k] = v && typeof v === 'object' && !Array.isArray(v) ? strip(v) : v; return out; };
function fakeDb() {
  const docs = new Map(); let auto = 0;
  const snap = (path, data) => ({ id: path.split('/').pop(), exists: data !== undefined, ref: docRef(path), data: () => data && structuredClone(data), get: k => data && k.split('.').reduce((o, p) => o == null ? undefined : o[p], data) });
  const write = {
    set(path, data, opt) { docs.set(path, opt && opt.merge ? mergeInto(docs.get(path) || {}, data) : strip(data)); },
    update(path, data) { if (!docs.has(path)) throw new Error('no document ' + path); docs.set(path, mergeInto(docs.get(path), data)); },
    create(path, data) { if (docs.has(path)) throw new Error('exists ' + path); docs.set(path, strip(data)); },
    delete(path) { docs.delete(path); }
  };
  function docRef(path) { return { path, id: path.split('/').pop(), get: async () => snap(path, docs.get(path)), set: async (d, o) => write.set(path, d, o), update: async d => write.update(path, d), delete: async () => write.delete(path), _q: false }; }
  function query(col, f = [], ord = null, lim = 0) {
    return { _q: true, where: (k, op, v) => query(col, f.concat([[k, v]]), ord, lim), orderBy: (k, dir = 'asc') => query(col, f, [k, dir], lim), limit: n => query(col, f, ord, n),
      doc: id => docRef(col + '/' + (id || 'auto' + String(++auto).padStart(16, '0'))),
      get: async () => {
        let L = [...docs.entries()].filter(([p]) => p.startsWith(col + '/') && !p.slice(col.length + 1).includes('/')).map(([p, d]) => snap(p, d));
        L = L.filter(s => f.every(([k, v]) => s.get(k) === v));
        if (ord) L.sort((a, b) => (a.get(ord[0]) - b.get(ord[0])) * (ord[1] === 'desc' ? -1 : 1));
        if (lim) L = L.slice(0, lim);
        return { docs: L, size: L.length, empty: !L.length };
      } };
  }
  const db = {
    docs, doc: docRef, collection: query,
    batch() { const ops = []; return { update: (r, d) => ops.push(() => write.update(r.path, d)), set: (r, d, o) => ops.push(() => write.set(r.path, d, o)), commit: async () => ops.forEach(f => f()) }; },
    async runTransaction(fn) {
      const ops = []; let wrote = false;
      const tx = {
        get: async r => { assert.equal(wrote, false, 'a transaction reads before it writes'); return r._q ? r.get() : snap(r.path, docs.get(r.path)); },
        getAll: async (...rs) => { assert.equal(wrote, false, 'a transaction reads before it writes'); return rs.map(r => snap(r.path, docs.get(r.path))); },
        set: (r, d, o) => { wrote = true; ops.push(() => write.set(r.path, d, o)); }, update: (r, d) => { wrote = true; ops.push(() => write.update(r.path, d)); },
        create: (r, d) => { wrote = true; ops.push(() => write.create(r.path, d)); }, delete: r => { wrote = true; ops.push(() => write.delete(r.path)); }
      };
      const out = await fn(tx); ops.forEach(f => f()); return out;
    }
  };
  return db;
}
/* the stand-ins: regions, the Assembly's Delegates, and the eligibility check that tells a nation's region */
function world(seats) {
  const regions = new Set(['north', 'south', 'east', 'west', 'empty']), home = { un: 'north', us: 'south', ue: 'east', uw: 'west', ux: 'empty' };
  const ctx = { regions, delegateOf: async reg => seats[reg] ? { id: seats[reg], nm: seats[reg].toUpperCase() + 'land', k: 3 } : null,
    eligibility: async (tx, who) => ({ n: { reg: home[who.uid] || '' }, saved: { get: k => k === 'name' ? who.uid + 'land' : home[who.uid] } }),
    flagsOf: async ids => Object.fromEntries(ids.map(id => [id, { c: ['#123456'] }])) };
  /* every region's Delegate as the Assembly would have it: what each region's own players' games note */
  ctx.all = () => Object.fromEntries([...regions].map(r => [r, seats[r] ? { id: seats[r], nm: seats[r].toUpperCase() + 'land', k: 3 } : null]));
  return ctx;
}
async function at(t, fn) { const real = Date.now; Date.now = () => t; try { return await fn(); } finally { Date.now = real; } }

test('the seats follow the Assembly; a new Delegate takes the seat and the chair at once', async () => {
  resetCouncil();
  const db = fakeDb(), seats = { north: 'un', south: 'us', east: 'ue', west: 'uw' }, ctx = world(seats);
  // the first count seats everyone without logging that anybody "took" a seat
  let S = await at(D(2026, 11, 28), () => wacRefresh(db, ctx.regions, ctx.all()));
  assert.deepEqual(Object.keys(S.seats).sort(), ['east', 'north', 'south', 'west']);
  assert.equal(S.sh.length, 0);
  assert.ok(db.docs.has('councilSeats/un') && db.docs.has('councilSeats/uw'), 'every holder may read the Council chat');
  assert.equal(S.ch, null, 'no chair before the first vote');
  // the December vote: north and east vote south, south votes west, west votes north
  const vote = (uid, v) => at(D(2026, 12, 2), () => council(db, { uid }, { op: 'wacVote', v }, ctx));
  await vote('un', 'south'); await vote('ue', 'south'); await vote('us', 'west'); await vote('uw', 'north');
  await assert.rejects(vote('un', 'north'), /own region/);
  await assert.rejects(vote('un', 'empty'), /no seat to vote for/);
  await assert.rejects(at(D(2026, 12, 7), () => council(db, { uid: 'un' }, { op: 'wacVote', v: 'south' }, ctx)), /opens at 00:00 UTC/);
  await assert.rejects(at(D(2026, 12, 2), () => council(db, { uid: 'ux' }, { op: 'wacVote', v: 'south' }, ctx)), /Only a sitting Delegate/);
  // secret while open: a seat sees its own ballot and how many have voted
  const open = await at(D(2026, 12, 3), () => council(db, { uid: 'un' }, { op: 'wacState' }, ctx));
  assert.equal(open.vote.cast, 4); assert.deepEqual(open.vote.mine.v, 'south'); assert.equal(open.hist.length, 0);
  assert.deepEqual([...open.vote.who].sort(), ['east', 'north', 'south', 'west'], 'which seats have voted, for the chamber’s ticks');
  assert.ok(!/"v":/.test(JSON.stringify({ ...open.vote, mine: null })), 'but never what any seat but its own chose');
  // counted after the close: south holds the chair, the ballots are published
  resetCouncil();
  S = await at(D(2026, 12, 6, 1), () => wacRefresh(db, ctx.regions, ctx.all()));
  assert.equal(S.term, '2026-12'); assert.deepEqual(S.rank.slice(0, 1), ['south']);
  assert.deepEqual(S.ch && [S.ch.reg, S.ch.id], ['south', 'us']);
  assert.deepEqual(S.hist[0].b, { north: 'south', east: 'south', south: 'west', west: 'north' });
  assert.equal(S.chairs[0].reg, 'south');
  // endorsements move: south's new Delegate takes the seat and the chair; the old one loses the chat
  seats.south = 'us2'; resetCouncil();
  S = await at(D(2026, 12, 10), () => wacRefresh(db, ctx.regions, ctx.all()));
  assert.deepEqual([S.ch.reg, S.ch.id], ['south', 'us2']);
  assert.deepEqual(S.sh[0] && [S.sh[0].reg, S.sh[0].id, S.sh[0].p], ['south', 'us2', 'us']);
  assert.equal(db.docs.has('councilSeats/us'), false); assert.equal(db.docs.has('councilSeats/us2'), true);
  assert.deepEqual(S.chairs[0].h.map(h => h.id), ['us', 'us2']);
  // south has no Delegate at all: the chair passes down the count
  delete seats.south; resetCouncil();
  S = await at(D(2026, 12, 11), () => wacRefresh(db, ctx.regions, ctx.all()));
  assert.equal(S.ch.reg, S.rank.find(r => r !== 'south' && seats[r]));
  assert.equal(S.sh[0].id, '', 'the seat stands empty');
  // nobody votes in January: the chair stays with the region that holds it
  resetCouncil();
  const before = S.ch.reg;
  S = await at(D(2027, 1, 7), () => wacRefresh(db, ctx.regions, ctx.all()));
  assert.equal(S.term, '2027-01'); assert.equal(S.ch.reg, before);
});

test('a region’s seat is noted from its own Assembly reads: a change at once, the same seat at most every ten minutes', async () => {
  resetCouncil();
  const db = fakeDb(), regions = new Set(['north', 'south']), t0 = D(2026, 11, 28);
  let writes = 0; const run = db.runTransaction; db.runTransaction = async fn => run.call(db, async tx => { const set = tx.set; tx.set = (r, d, o) => { if (r.path === 'council/state') writes++; return set(r, d, o); }; return fn(tx); });
  await at(t0, () => wacNote(db, regions, 'north', { id: 'un', nm: 'Northland', k: 2 }));
  assert.equal(db.docs.get('council/state').seats.north.id, 'un'); assert.equal(writes, 1);
  assert.equal(db.docs.get('council/state').sh.length, 0, 'a region’s first noting is not news: its Delegate held the seat already');
  assert.equal(await at(t0 + 60000, () => wacNote(db, regions, 'north', { id: 'un', nm: 'Northland', k: 2 })), null, 'the same seat a minute later: nothing read');
  await at(t0 + 11 * 60000, () => wacNote(db, regions, 'north', { id: 'un', nm: 'Northland', k: 2 }));
  assert.equal(writes, 1, 'ten minutes on, read again, and nothing changed, so nothing written');
  await at(t0 + 12 * 60000, () => wacNote(db, regions, 'north', { id: 'un2', nm: 'Neuland', k: 3 }));
  assert.equal(db.docs.get('council/state').seats.north.id, 'un2'); assert.equal(writes, 2, 'a new Delegate at once');
  assert.equal(db.docs.get('council/state').sh[0].p, 'un');
  await at(t0 + 13 * 60000, () => wacNote(db, regions, 'south', null));
  assert.equal(writes, 3, 'a region with no Delegate is noted once');
  await at(t0 + 30 * 60000, () => wacNote(db, regions, 'south', null));
  assert.equal(writes, 3, 'and then changes nothing');
  await at(t0 + 31 * 60000, () => wacNote(db, regions, 'south', { id: 'us', nm: 'Southland', k: 1 }));
  assert.deepEqual(db.docs.get('council/state').sh.slice(0, 1).map(e => [e.reg, e.id, e.p]), [['south', 'us', '']], 'a seat filled after the region was first noted is news');
  assert.equal(await wacNote(db, regions, 'nowhere', { id: 'x' }), null, 'only the game’s regions');
});

test('motions: an edict idea passes at a majority and goes to the admins; one seat cannot pass anything alone', async () => {
  resetCouncil();
  const db = fakeDb(), seats = { north: 'un', south: 'us', east: 'ue', west: 'uw' }, ctx = world(seats), t0 = D(2026, 12, 8);
  await at(t0, () => wacRefresh(db, ctx.regions, ctx.all()));
  const idea = { op: 'wacMotion', k: 'edict', ti: 'The Lost Lighthouse Keeper', cat: 'culture', x: 'A lighthouse keeper has not been seen for a week, and the lamp still turns every night without him.',
    o: [{ t: 'Send the coastguard to look for him at once.', fx: 'safety up' }, { t: 'Leave the lamp alone: it seems to manage.', fx: '' }] };
  await assert.rejects(at(t0, () => council(db, { uid: 'un' }, { ...idea, o: idea.o.slice(0, 1) }, ctx)), /two to four options/);
  await assert.rejects(at(t0, () => council(db, { uid: 'un' }, { ...idea, cat: 'nope' }, ctx)), /Choose what the edict is about/);
  const r = await at(t0, () => council(db, { uid: 'un' }, idea, ctx));
  assert.equal(r.st, 'open', 'the tabling seat votes For, which is not enough alone');
  await assert.rejects(at(t0, () => council(db, { uid: 'un' }, idea, ctx)), /edict idea open already/);
  // 4 seats: three For pass it
  assert.equal((await at(t0 + 1000, () => council(db, { uid: 'us' }, { op: 'wacMotionVote', id: r.id, v: 1 }, ctx))).st, 'open');
  assert.equal((await at(t0 + 2000, () => council(db, { uid: 'ue' }, { op: 'wacMotionVote', id: r.id, v: 1 }, ctx))).st, 'passed');
  await assert.rejects(at(t0 + 3000, () => council(db, { uid: 'uw' }, { op: 'wacMotionVote', id: r.id, v: -1 }, ctx)), /has been decided/);
  const M = db.docs.get('councilMotions/' + r.id);
  assert.equal(M.ad.st, 'waiting'); assert.equal(M.y, 3);
  let S = db.docs.get('council/state');
  assert.equal(S.ideas[0].id, r.id); assert.equal(S.ideas[0].st, 'waiting');
  // the admins decide; a moderator may not
  await assert.rejects(councilAdmin(db, 'mod1', { op: 'wacIdea', id: r.id, st: 'accepted' }, 'mod'), /Only Edictum admins/);
  await councilAdmin(db, 'adm1', { op: 'wacIdea', id: r.id, st: 'declined', note: 'Too close to the lighthouse edicts we have.' }, 'admin');
  S = db.docs.get('council/state');
  assert.equal(S.ideas[0].st, 'declined'); assert.equal(S.ideas[0].note, 'Too close to the lighthouse edicts we have.');
  assert.equal(db.docs.get('councilMotions/' + r.id).ad.st, 'declined');
  assert.ok([...db.docs.keys()].some(k => k.startsWith('adminAudit/')), 'in the audit log');
  // a resolution that nobody else backs fails after three days
  const res = await at(t0, () => council(db, { uid: 'uw' }, { op: 'wacMotion', k: 'res', ti: 'On the matter of rivers', x: 'The Council asks every region to keep its rivers clean and name them kindly.' }, ctx));
  await at(t0 + 4 * 86400000, () => council(db, { uid: 'un' }, { op: 'wacState' }, ctx));
  assert.equal(db.docs.get('councilMotions/' + res.id).st, 'failed');
});

test('the agenda: posts, replies, the chair pins and closes; the address is the chair’s alone', async () => {
  resetCouncil();
  const db = fakeDb(), seats = { north: 'un', south: 'us', east: 'ue' }, ctx = world(seats), t0 = D(2026, 12, 7);
  await at(D(2026, 11, 30), () => wacRefresh(db, ctx.regions, ctx.all()));
  await at(D(2026, 12, 2), () => council(db, { uid: 'un' }, { op: 'wacVote', v: 'south' }, ctx));
  await at(D(2026, 12, 2), () => council(db, { uid: 'ue' }, { op: 'wacVote', v: 'south' }, ctx));
  await at(t0, () => wacRefresh(db, ctx.regions, ctx.all()));
  const p = await at(t0, () => council(db, { uid: 'un' }, { op: 'wacPost', ti: 'Shared fishing grounds', x: 'Should the northern seas be shared between our regions?' }, ctx));
  await at(t0 + 1000, () => council(db, { uid: 'ue' }, { op: 'wacReply', id: p.id, x: 'Only on Tuesdays.' }, ctx));
  await at(t0 + 2000, () => council(db, { uid: 'ue' }, { op: 'wacReact', id: p.id, k: 'up' }, ctx));
  await assert.rejects(at(t0, () => council(db, { uid: 'un' }, { op: 'wacPin', id: p.id }, ctx)), /Only the Chair/);
  await at(t0, () => council(db, { uid: 'us' }, { op: 'wacPin', id: p.id }, ctx));
  let A = db.docs.get('councilAgenda/' + p.id);
  assert.equal(A.pin, 1); assert.equal(A.r.length, 1); assert.deepEqual(A.rx, { ue: 'up' });
  await assert.rejects(at(t0, () => council(db, { uid: 'ue' }, { op: 'wacClose', id: p.id }, ctx)), /chair or the seat that raised it/);
  await at(t0, () => council(db, { uid: 'un' }, { op: 'wacClose', id: p.id }, ctx));
  A = db.docs.get('councilAgenda/' + p.id); assert.equal(A.cl, 1); assert.equal(A.pin, 0);
  await assert.rejects(at(t0, () => council(db, { uid: 'ue' }, { op: 'wacReply', id: p.id, x: 'Too late?' }, ctx)), /closed/);
  await assert.rejects(at(t0, () => council(db, { uid: 'un' }, { op: 'wacAddress', x: 'Hello, world.' }, ctx)), /Only the Chair/);
  await at(t0, () => council(db, { uid: 'us' }, { op: 'wacAddress', x: 'Hello, world.' }, ctx));
  assert.equal(db.docs.get('council/state').msg.x, 'Hello, world.');
  await assert.rejects(at(t0 + 60000, () => council(db, { uid: 'us' }, { op: 'wacAddress', x: 'Again.' }, ctx)), /once an hour/);
  // a moderator clears words, in the audit log
  await councilAdmin(db, 'mod1', { op: 'wacMod', what: 'address' }, 'mod');
  assert.equal(db.docs.get('council/state').msg, null);
});

test('the civic function, the admin console and the rules know the Council', () => {
  assert.equal(isCouncilOp('wacState'), true); assert.equal(isCouncilOp('state'), false);
  assert.match(civic, /isCouncilOp\(d\.op\)\) return council\(db, who, d/);
  assert.match(civic, /isCouncilOp\(op\) \? \[\['wc:'/, 'paced');
  assert.match(admin, /WAC_ADMIN_OPS\.includes\(d\.op\)\) return councilAdmin\(db, actor, d, 'admin'\)/);
  assert.match(admin, /d\.op === 'wacAdmin' \|\| d\.op === 'wacMod'\)\) return councilAdmin\(db, actor, d, 'mod'\)/);
  assert.match(rules, /match \/council\/\{id\} \{\s*allow read: if id == 'state' && signedIn\(\);/);
  for (const c of ['councilVotes', 'councilMotions', 'councilAgenda', 'councilSeats', 'councilPace']) assert.match(rules, new RegExp(`match /${c}/\\{\\w+\\} \\{ allow read, write: if false; \\}`), c);
  assert.equal(rules.match(/reg == 'wac' && exists\(\/databases\/\$\(database\)\/documents\/councilSeats\/\$\(request\.auth\.uid\)\)/g).length, 2, 'rchat and rcimg');
  // the Council chat: seats and staff only
  assert.equal(RC_WAC, 'wac'); assert.equal(rcShared('wac'), true);
  assert.equal(rcMayUse('wac', { uid: 'p' }), false); assert.equal(rcMayUse('wac', { wac: true }), true);
  assert.equal(rcMayUse('wac', { mod: true }), true); assert.equal(rcMayUse('wac', { amb: true }), false, 'an ambassador is not a seat');
});

test('the game: Council in the menu for a Delegate and for an admin, its edicts last, the chair’s mark in the chat', () => {
  assert.match(html, /EXT_PAGES\.push\('council'\);NAV_LABELS\.council='Council';/);
  assert.match(html, /if\(NAVP\.raw\|\|wacSeated\(\)\|\|wacAdmin\(\)\|\|S\.view==='council'\)return g;/);
  assert.match(html, /function wacAdmin\(\)\{try\{return !!S\.isOwner&&!PV&&!!S\.uid&&S\.mode!=='local';\}/, 'an admin, never in a role preview');
  assert.match(html, /const label='WAC Delegate · '\+R\.name;/);
  assert.match(html, /const label='WAC Chair · '\+R\.name;/);
  assert.match(html, /const RGS=\[RGW,RGF,RGA,RGK\];/);
  const ids = [...html.slice(html.indexOf('const WAC_ISSUES=[')).matchAll(/\{id:'(wac-[a-z-]+)'/g)].map(m => m[1]);
  assert.equal(ids.length, 12);
  const order = fs.readFileSync(new URL('./edict-order.txt', import.meta.url), 'utf8').trim().split('\n');
  assert.deepEqual(order.slice(-12), ids, 'pinned after every other edict');
  assert.ok(html.indexOf('const WAC_ISSUES=[') > html.indexOf('const SK_ISSUES=['), 'after the sacking edicts');
});

test('an admin observing a region still reads the Council; the shim keeps every Council write blocked there and in a preview', async () => {
  const shim = fs.readFileSync(new URL('../src/shim.js', import.meta.url), 'utf8');
  const start = shim.indexOf('  async function call(name, data)'), end = shim.indexOf('  /* battles are rolled', start);
  for (const mode of ['player', 'observe', 'preview']) {
    const requests = [], A = { auth: { currentUser: { getIdToken: async () => 'test-token' } }, fn: 'http://test.invalid' };
    const call = new Function('A', 'isObj', 'pviewing', 'observing', 'readOnly', 'mapError', 'within', 'fetch', shim.slice(start, end) + '\nreturn call;')(
      A, v => v && typeof v === 'object', () => mode === 'preview', () => mode !== 'player', () => new Error('read_only'), e => new Error(e.message || e.code), p => p,
      async (url, init) => { requests.push(JSON.parse(init.body).data); return { ok: true, json: async () => ({ result: { ok: true } }) }; });
    if (mode === 'preview') await assert.rejects(call('civic', { op: 'wacState' }), /read_only/, 'a role preview is never an admin');
    else { await call('civic', { op: 'wacState' }); assert.equal(requests.length, 1, mode + ': the page is read'); }
    if (mode !== 'player') for (const op of ['wacVote', 'wacPost', 'wacMotion', 'wacMotionVote', 'wacAddress']) await assert.rejects(call('civic', { op }), /read_only/, mode + ' ' + op);
  }
});
