// The player survey (28 Nov 2026; functions/survey.js, functions/survey-data.js, game/edictum.html "the player survey").
// Engaged players (an engagement score of 35 or more, a nation a week old, not staff) are drawn at random, a share each
// day; each answers the core questions and a few drawn from the rest, any of which they may skip; "Ask me tomorrow" at
// most twice, "No thanks" for good. The server ops run here against a small in-memory Firestore. Run with: npm run test:fx
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { SV_ID, SV_QS, SV_BY_ID, SV_MIN, SV_LATER, svCore, svPool, svPick, svDrawn, svAsked, svClean, svForPlayer, svHash } from '../functions/survey-data.js';
import { surveyStep, surveyAdmin, svConfig, svNextDay } from '../functions/survey.js';
import { engPart } from '../functions/stats.js';

const read = p => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const html = read('../game/edictum.html'), accounts = read('../functions/accounts.js'), admin = read('../functions/admin.js'), rules = read('../firestore.rules'), shim = read('../src/shim.js');
const DAY = 864e5, NOW = Date.UTC(2026, 11, 3, 15), J = v => JSON.parse(JSON.stringify(v));

test('the questions: the owner’s sixteen, eight for everyone and eight drawn from, each id and answer id once', () => {
  assert.deepEqual(SV_QS.map(q => q.id), ['ruler', 'love', 'chore', 'back', 'pace', 'src', 'len', 'when', 'rp', 'econ', 'others', 'attacked', 'shop', 'pmf', 'nps', 'change']);
  assert.deepEqual(svCore(), ['ruler', 'love', 'chore', 'back', 'pace', 'pmf', 'nps', 'change']);
  assert.equal(svPool().length, 8);
  const ids = SV_QS.flatMap(q => q.sub ? [q.id, q.sub.id] : [q.id]);
  assert.equal(new Set(ids).size, ids.length, 'question ids are unique');
  for (const q of Object.values(SV_BY_ID)) {
    assert.ok(q.q && /^(one|many|scale|text)$/.test(q.k), q.id);
    if (q.o) { const v = q.o.map(o => o.v); assert.equal(new Set(v).size, v.length, q.id + ' answers are unique'); assert.ok(q.o.every(o => o.t), q.id); }
    if (q.k === 'many') assert.ok(q.max >= 1, q.id + ' has a limit');
    if (q.k === 'scale') assert.ok(Number.isInteger(q.lo) && q.hi > q.lo && q.l.length === 2, q.id);
  }
  assert.deepEqual([SV_BY_ID.nps.lo, SV_BY_ID.nps.hi, SV_BY_ID.econ.lo, SV_BY_ID.econ.hi], [0, 10, 1, 5]);
  assert.equal(SV_BY_ID.shopwhy.when, 'no');
});

test('the draw: a share of eligible players each day, a new draw the next; each player’s extra questions stay the same', () => {
  const uids = Array.from({ length: 4000 }, (x, i) => 'player' + i);
  const share = uids.filter(u => svDrawn(u, SV_ID, NOW, 0.25)).length / uids.length;
  assert.ok(share > 0.22 && share < 0.28, 'about a quarter: ' + share);
  const today = new Set(uids.filter(u => svDrawn(u, SV_ID, NOW, 0.25))), tomorrow = uids.filter(u => svDrawn(u, SV_ID, NOW + DAY, 0.25));
  assert.ok(tomorrow.filter(u => today.has(u)).length < tomorrow.length * 0.4, 'mostly others the next day');
  assert.equal(svDrawn('a', SV_ID, NOW, 1), true);assert.equal(svDrawn('a', SV_ID, NOW, 0), false);
  assert.equal(svDrawn('a', SV_ID, NOW, 0.25), svDrawn('a', SV_ID, NOW + 3600e3, 0.25), 'the same all day');
  const p = svPick('player7', SV_ID, 2);
  assert.equal(p.length, 2);assert.deepEqual(svPick('player7', SV_ID, 2), p);assert.ok(p.every(id => svPool().includes(id)));
  assert.deepEqual(p, svPool().filter(id => p.includes(id)), 'in the survey’s order');
  assert.deepEqual(svPick('x', SV_ID, 0), []);assert.deepEqual(svPick('x', SV_ID, 99), svPool());
  const seen = {};for (const u of uids.slice(0, 1600)) for (const id of svPick(u, SV_ID, 2)) seen[id] = (seen[id] || 0) + 1;
  assert.equal(Object.keys(seen).length, 8);assert.ok(Object.values(seen).every(k => k > 300 && k < 500), 'each extra question about as often: ' + JSON.stringify(seen));
  assert.deepEqual(svAsked(['src', 'shop']).map(q => q.id), ['ruler', 'love', 'chore', 'back', 'pace', 'src', 'shop', 'pmf', 'nps', 'change']);
  assert.ok(svHash('a') >= 0 && svHash('a') < 1);
});

test('what comes back is made safe: only questions asked, only answers that fit, words cut to length', () => {
  const asked = svAsked(['others', 'shop']);
  const c = svClean(asked, {
    a: { ruler: 'builder', love: ['war', 'map', 'talk', 'games', 'bogus'], chore: ['war', 'none'], back: 'other', pace: 'sideways', nps: 11, econ: 3, change: '  <b>More</b>\n\tmaps   please ' + 'x'.repeat(400),
      others: 'worse', shop: 'no', shopwhy: ['price', 'sale', 'designs'], src: 'discord', pmf: 'very' },
    o: { back: 'The weekly letters from my rival, honestly' + 'y'.repeat(100), love: 'not an other' },
    w: { others: 'Someone took my land while I slept', ruler: 'no why here' }
  });
  assert.deepEqual(c.a.love, ['war', 'map', 'talk'], 'up to 3, unknown answers dropped');
  assert.deepEqual(c.a.chore, ['none'], 'Nothing stands alone');
  assert.equal(c.a.back, 'other');assert.equal(c.o.back.length, 80);assert.equal(c.o.love, undefined);
  assert.equal(c.a.pace, undefined, 'not an answer');assert.equal(c.a.nps, undefined, 'out of range');
  assert.equal(c.a.econ, undefined, 'not asked');assert.equal(c.a.src, undefined, 'not asked');
  assert.ok(c.a.change.startsWith('bMore/b maps please x') && c.a.change.length === 300, c.a.change.slice(0, 30));
  assert.equal(c.w.others, 'Someone took my land while I slept');assert.equal(c.w.ruler, undefined);
  assert.deepEqual(c.a.shopwhy, ['price', 'sale'], 'the follow-up, after “Not yet”, up to 2');
  assert.equal(c.a.pmf, 'very');
  assert.equal(svClean(asked, { a: { shop: 'yes', shopwhy: ['price'] } }).a.shopwhy, undefined, 'no follow-up after “Yes”');
  assert.deepEqual(J(svClean(asked, null)), { a: {}, o: {}, w: {} });
  assert.deepEqual(svClean(asked, { a: { nps: 0, love: [] } }).a, { nps: 0 }, 'a 0 counts; nothing chosen is skipped');
  const forPlayer = svForPlayer(asked);
  assert.ok(forPlayer.every(q => !('core' in q)));assert.equal(forPlayer.find(q => q.id === 'shop').sub.when, 'no');
});

/* ── a small in-memory Firestore: documents by path (with their creation time), transactions that read before they write ── */
const isDel = v => v && v.constructor && v.constructor.name === 'DeleteTransform';
const isTransform = v => v && v.constructor && /Transform$/.test(v.constructor.name);
function mergeInto(base, patch) {
  const out = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (isDel(v)) delete out[k];
    else if (v && typeof v === 'object' && !Array.isArray(v) && v.constructor === Object) out[k] = mergeInto(out[k] && typeof out[k] === 'object' ? out[k] : {}, v);
    else out[k] = v;
  }
  return out;
}
function fakeDb() {
  const docs = new Map(), born = new Map(); let auto = 0;
  const snap = (path, data) => ({ id: path.split('/').pop(), exists: data !== undefined, ref: docRef(path), createTime: { toMillis: () => born.get(path) || 0 }, data: () => data && structuredClone(data),
    get: k => data && k.split('.').reduce((o, p) => o == null ? undefined : o[p], data) });
  const write = (path, data, opt) => { if (!docs.has(path)) born.set(path, Date.now()); const d = opt && opt.merge ? mergeInto(docs.get(path) || {}, data) : mergeInto({}, data); for (const [k, v] of Object.entries(d)) if (isTransform(v)) d[k] = 'ts'; docs.set(path, d); };
  function docRef(path) { return { path, id: path.split('/').pop(), get: async () => snap(path, docs.get(path)), set: async (d, o) => write(path, d, o), delete: async () => docs.delete(path) }; }
  const db = {
    docs, born, doc: docRef,
    collection: col => ({ doc: id => docRef(col + '/' + (id || 'auto' + (++auto))), get: async () => { const L = [...docs.entries()].filter(([p]) => p.startsWith(col + '/') && !p.slice(col.length + 1).includes('/')).map(([p, d]) => snap(p, d)); return { docs: L, size: L.length }; } }),
    async runTransaction(fn) {
      const ops = []; let wrote = false;
      const tx = { get: async r => { assert.equal(wrote, false, 'reads before it writes'); return snap(r.path, docs.get(r.path)); }, set: (r, d, o) => { wrote = true; ops.push(() => write(r.path, d, o)); } };
      const out = await fn(tx); ops.forEach(f => f()); return out;
    },
    put(path, data, at) { docs.set(path, data); born.set(path, at); }
  };
  return db;
}
/* a nation founded `days` ago with an engagement score; the survey open, everyone drawn unless share says otherwise */
function world({ days = 30, score = 70, on = true, share = 1, draw = 2, uid = 'p1', ban = false } = {}) {
  const db = fakeDb();
  db.put('nations/' + uid, { j: JSON.stringify({ name: 'Tela tyhate', reg: 'saffron', pop: 41.5e6 }), name: 'Tela tyhate', reg: 'saffron' }, NOW - days * DAY);
  if (score != null) db.put('statsEngage/' + engPart(uid), { at: NOW - 3600e3, m: { [uid]: [score, 12, 28, 7, 2] } }, NOW - 10 * DAY);
  if (on != null) db.put('svCfg/live', { on, share, draw }, NOW - DAY);
  if (ban) db.put('bans/' + uid, { at: 1 }, NOW - DAY);
  return db;
}
const who = (uid = 'p1', o = {}) => ({ uid, admin: false, mod: false, registered: true, ...o });
async function at(t, fn) { const real = Date.now; Date.now = () => t; try { return await fn(); } finally { Date.now = real; } }
const step = (db, s, t = NOW, extra = {}, w = who()) => at(t, () => surveyStep(db, w, { step: s, ...extra }, t));
const rec = (db, uid = 'p1') => (db.docs.get('svy/' + uid) || { s: {} }).s[SV_ID];

test('who is asked: an open survey, a nation a week old with a score of 35 or more, not banned, not staff, drawn that day', async () => {
  assert.deepEqual(J(await step(world({ on: false }), 'check')), { ok: true, due: false, next: NOW + DAY });
  assert.equal((await step(world({ on: null }), 'check')).due, false, 'a survey nobody opened is off');
  assert.equal((await step(world(), 'check', NOW, {}, who('p1', { admin: true }))).staff, true);
  assert.equal((await step(world(), 'check', NOW, {}, who('p1', { mod: true }))).due, false);
  const young = await step(world({ days: 6 }), 'check');
  assert.equal(young.due, false);assert.equal(young.next, svNextDay('p1', NOW));assert.ok(young.next > NOW && young.next < NOW + DAY);
  assert.equal((await step(world({ score: SV_MIN - 1 }), 'check')).due, false);
  assert.equal((await step(world({ score: null }), 'check')).due, false, 'not scored yet');
  assert.equal((await step(world({ ban: true }), 'check')).due, false);
  assert.equal((await step(world({ share: 1e-9 }), 'check')).due, false, 'not drawn today');
  const db = world({ score: SV_MIN }), r = await step(db, 'check');
  assert.equal(r.due, true);assert.equal(r.s, SV_ID);assert.equal(r.qs.length, 10, 'eight core questions and two drawn');
  assert.equal(r.later, 0);assert.equal(r.laterMax, SV_LATER);assert.equal(r.gift, 'c-ballot');
  assert.deepEqual(J(rec(db)), { t: NOW, q: svPick('p1', SV_ID, 2), e: SV_MIN });
  const again = await step(db, 'check', NOW + 5 * DAY);
  assert.deepEqual(again.qs.map(q => q.id), r.qs.map(q => q.id), 'invited stays invited, with the same questions');
  assert.equal((await step(world({ draw: 0 }), 'check')).qs.length, 8);
});

test('ask me tomorrow, twice at most; no thanks for good; answers once, made safe, with the nation as it was', async () => {
  const db = world();
  await assert.rejects(step(db, 'later'), /no survey waiting/);
  await step(db, 'check');
  assert.deepEqual(J(await step(db, 'later')), { ok: true, next: NOW + DAY });
  const held = await step(db, 'check', NOW + DAY - 1);
  assert.equal(held.due, false);assert.equal(held.next, NOW + DAY);
  const back = await step(db, 'check', NOW + DAY);assert.equal(back.due, true);assert.equal(back.later, 1);
  await step(db, 'later', NOW + DAY);
  assert.equal((await step(db, 'check', NOW + 2 * DAY)).later, 2);
  await assert.rejects(step(db, 'later', NOW + 2 * DAY), /put off twice/);
  const asked = svAsked(rec(db).q).map(q => q.id);
  const r = await step(db, 'answer', NOW + 2 * DAY + 60000, { a: { ruler: 'diplomat', nps: 9, pace: 'nonsense', change: ' Fewer popups ', econ: 4, src: 'search' } });
  assert.equal(r.ok, true);
  const R = rec(db);
  assert.equal(R.d, NOW + 2 * DAY + 60000);
  assert.deepEqual(J(R.a), Object.fromEntries(Object.entries({ ruler: 'diplomat', nps: 9, change: 'Fewer popups', econ: 4, src: 'search' }).filter(([k]) => asked.includes(k))));
  assert.deepEqual(J(R.x), { name: 'Tela tyhate', reg: 'saffron', pop: 41500000, days: 32, eng: [70, 12, 28, 7, 2], acct: 'registered' });
  assert.deepEqual(J(await step(db, 'answer', NOW + 3 * DAY, { a: { ruler: 'builder' } })), { ok: true, again: true });
  assert.equal(rec(db).a.ruler, 'diplomat', 'the first answers stand');
  const done = await step(db, 'check', NOW + 3 * DAY);
  assert.equal(done.due, false);assert.equal(done.done, true);assert.equal(done.said, undefined);
  /* the staff's note reaches those who answered before it was written */
  await at(NOW + 4 * DAY, () => surveyAdmin(db, 'admin1', { action: 'said', x: 'You found the economy hard to follow: the Budget page now explains every line.', link: '#government' }, NOW + 4 * DAY));
  const said = await step(db, 'check', NOW + 5 * DAY);
  assert.deepEqual(J(said.said), { x: 'You found the economy hard to follow: the Budget page now explains every line.', link: '#government', t: NOW + 4 * DAY });

  const db2 = world();await step(db2, 'check');
  assert.deepEqual(J(await step(db2, 'no')), { ok: true });
  assert.deepEqual(J(await step(db2, 'check', NOW + DAY)), { ok: true, due: false, next: NOW + 8 * DAY });
  await assert.rejects(step(db2, 'answer', NOW + DAY, { a: { ruler: 'builder' } }), /no thanks/);
  await assert.rejects(step(db2, 'shout'), /Unknown survey step/);
});

test('the admin portal: open or pause it, the daily share, the extra questions, the note; every invitation in the results', async () => {
  const db = world({ on: null });
  await at(NOW, () => surveyAdmin(db, 'admin1', { action: 'set', on: true, share: 0.5, draw: 3 }, NOW));
  assert.deepEqual(J(svConfig(await db.doc('svCfg/live').get())), { on: true, share: 0.5, draw: 3, said: null, t: NOW, by: 'admin1' });
  await assert.rejects(surveyAdmin(db, 'admin1', { action: 'set', share: 0 }), /daily share/);
  await assert.rejects(surveyAdmin(db, 'admin1', { action: 'set', draw: 9 }), /extra questions/);
  await assert.rejects(surveyAdmin(db, 'admin1', { action: 'said', x: 'Hi', link: 'javascript:alert(1)' }), /link starts/);
  await assert.rejects(surveyAdmin(db, 'admin1', { action: 'zap' }), /Unknown survey action/);
  await surveyAdmin(db, 'admin1', { action: 'set', on: false });
  assert.equal(svConfig(await db.doc('svCfg/live').get()).on, false);assert.equal(svConfig(await db.doc('svCfg/live').get()).share, 0.5, 'the share stays');
  const audit = [...db.docs.entries()].filter(([p]) => p.startsWith('adminAudit/')).map(([, d]) => d.action);
  assert.deepEqual(audit, ['survey_set', 'survey_set']);
  await surveyAdmin(db, 'admin1', { action: 'set', on: true, share: 1 });
  await step(db, 'check');await step(db, 'answer', NOW + 1000, { a: { ruler: 'builder' } });
  db.put('svy/p2', { s: { [SV_ID]: { t: NOW - DAY, q: [], e: 60, l: 1, lt: NOW - DAY } } }, NOW - DAY);
  db.put('svy/p3', { s: { other: { t: 1 } } }, NOW - DAY);
  const g = await at(NOW + 2000, () => surveyAdmin(db, 'admin1', { action: 'get' }, NOW + 2000));
  assert.equal(g.rows.length, 2, 'only this survey’s invitations');
  assert.equal(g.rows[0].uid, 'p1');assert.equal(g.rows[0].a.ruler, 'builder');assert.equal(g.rows[0].x.name, 'Tela tyhate');
  assert.equal(g.rows[1].l, 1);assert.equal(g.rows[1].a, undefined);
  assert.equal(g.qs.length, SV_QS.length);assert.equal(g.min, SV_MIN);assert.equal(g.cfg.on, true);
  await surveyAdmin(db, 'admin1', { action: 'said', x: '' });
  assert.equal(svConfig(await db.doc('svCfg/live').get()).said, null, 'taken down');
});

test('wired in: the accounts op, the console op, the shim, the game, the rules, closing an account', () => {
  assert.match(accounts, /if \(d\.op === 'survey'\) return surveyStep\(db, who, d\);/);
  assert.ok(accounts.indexOf("d.op === 'survey'") > accounts.indexOf('const who = await identity(uid);'), 'after the account is identified');
  assert.match(accounts, /'commended\/', 'svy\/'\]\.map\(c => db\.doc\(c \+ uid\)\.delete\(\)\)/);
  assert.match(admin, /if \(d\.op === 'survey'\) return surveyAdmin\(db, actor, d\);/);
  assert.ok(admin.indexOf("d.op === 'survey'") > admin.indexOf("if (d.op === 'setMod')"), 'admins only, never moderators');
  assert.match(shim, /n === 'survey' \? surveyApi : /);
  assert.ok(!/match \/(svy|svCfg)\//.test(rules), 'no player reads or writes the survey’s records');
  assert.match(html, /tab\('admin-survey','Player survey'\)/);
  assert.match(html, /UNLOCKS\['c-ballot'\]=\{k:'charge',n:'Ballot box',src:'ach',tw:'e-ballot'\}/);
  assert.match(html, /achDef\('dip','dip-survey','b','Speak Your Mind'/);
  assert.match(read('../src/privacy.html'), /<li id="survey">/);assert.match(read('../src/privacidad.html'), /<li id="survey">/);
});

/* the workbook's ZIP, read back: every part stored with the right CRC, every XML part's tags balanced */
function unzip(buf) {
  const out = {};let i = 0;
  while (buf.readUInt32LE(i) === 0x04034b50) {
    const crc = buf.readUInt32LE(i + 14), size = buf.readUInt32LE(i + 18), nl = buf.readUInt16LE(i + 26), xl = buf.readUInt16LE(i + 28);
    const name = buf.slice(i + 30, i + 30 + nl).toString('utf8'), data = buf.slice(i + 30 + nl + xl, i + 30 + nl + xl + size);
    assert.equal(buf.readUInt16LE(i + 8), 0, name + ' is stored');assert.equal(zlib.crc32(data), crc, name + ' CRC');
    out[name] = data.toString('utf8');i += 30 + nl + xl + size;
  }
  assert.equal(buf.readUInt32LE(i), 0x02014b50, 'then the central directory');
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));assert.equal(buf.readUInt16LE(end + 10), Object.keys(out).length);assert.equal(buf.readUInt32LE(end + 16), i);
  return out;
}
function balanced(xml) {
  const stack = [];
  for (const m of xml.replace(/<\?xml[^>]*\?>/, '').matchAll(/<(\/?)([A-Za-z_:][\w:.-]*)([^>]*?)(\/?)>/g)) {
    if (m[4]) continue;if (!m[1]) stack.push(m[2]);else assert.equal(stack.pop(), m[2], 'closes ' + m[2]);
  }
  assert.equal(stack.length, 0);
}
export { unzip, balanced };
test('the Excel writer, cut from the game: a valid workbook of six sheets, dates and numbers as numbers', async () => {
  const vm = await import('node:vm');
  const cut = (a, b) => { const i = html.indexOf(a), j = html.indexOf(b, i); assert.ok(i >= 0 && j > i, a); return html.slice(i, j); };
  const code = cut('const asvAllQs=', 'function asvView(){') + cut('function svSheets(d){', '/* the browser tests\' window (EDICTUM_PROBE, SV) */');
  const ctx = vm.createContext({ TextEncoder, Blob, Uint8Array, Uint32Array, Date, Math, String, Number, Object, Array, Set, JSON, isFinite, isNaN, regName: r => r.toUpperCase(), stN: String, stPc: () => '', stBar: () => '', esc: String, rel: String, toast() {}, document: {}, URL: {} });
  vm.runInContext(code.replace(/^const /gm, 'var '), ctx);
  const qs = SV_QS, rows = [
    { uid: 'p1', t: NOW - DAY, q: ['shop', 'econ'], e: 71, l: 1, no: 0, d: NOW, a: { ruler: 'builder', love: ['war', 'map'], nps: 10, shop: 'no', shopwhy: ['price'], change: 'More <maps> & “rivers”', back: 'other' }, o: { back: 'The letters' }, w: {}, x: { name: 'Tela tyhate', reg: 'saffron', pop: 41500000, days: 32, eng: [71, 12, 28, 7, 2], acct: 'guest' } },
    { uid: 'p2', t: NOW - 2 * DAY, q: ['src', 'others'], e: 55, l: 0, no: 0, d: NOW - 3600e3, a: { ruler: 'diplomat', nps: 3, others: 'worse' }, o: {}, w: { others: 'Griefers' }, x: { name: 'Bearland', reg: 'greywater', eng: [80, 14, 30, 8, 3] } },
    { uid: 'p3', t: NOW - DAY, q: [], e: 60, l: 0, no: NOW - 1000, d: 0 }];
  const d = { id: SV_ID, qs, rows, laterMax: 2 };
  const sheets = ctx.svSheets(d);
  assert.deepEqual(J(sheets.map(s => s.name)), ['Answers', 'Choices', 'Summary', 'Invitations', 'Open answers', 'Questions']);
  const A = sheets[0].rows, col = h => A[0].indexOf(h);
  assert.equal(A.length, 3, 'a row for each player who answered');
  assert.ok(A[1][0] instanceof Date);assert.equal(A[1][col('Nation')], 'Tela tyhate');assert.equal(A[1][col('Engagement band')], '50–74');assert.equal(A[2][col('Engagement band')], '75–100');
  assert.equal(A[1][col(SV_BY_ID.love.q)], 'War; The map, land and borders');
  assert.equal(A[1][col(SV_BY_ID.nps.q)], 10);assert.equal(A[1][col(SV_BY_ID.pace.q)], '(skipped)');
  assert.equal(A[1][col(SV_BY_ID.src.q)], null, 'not asked is empty');assert.equal(A[2][col(SV_BY_ID.src.q)], '(skipped)');
  assert.equal(A[1][col(SV_BY_ID.shopwhy.q)], 'Lower prices');assert.equal(A[2][col(SV_BY_ID.shopwhy.q)], null, 'a follow-up never reached is empty');
  assert.equal(A[1][col('back (something else)')], 'The letters');assert.equal(A[2][col('others (why)')], 'Griefers');
  const C = sheets[1].rows;assert.equal(C.filter(r => r[1] === 'p1' && r[6] === 'love').length, 2, 'one row per answer');
  const S = sheets[2].rows, npsRow = S.find(r => r[0] === 'nps' && /Net Promoter/.test(r[2]));
  assert.equal(npsRow[3], 0, 'one promoter, one detractor');
  assert.equal(S.find(r => r[0] === 'ruler' && r[2].startsWith('A builder'))[4], 0.5);
  assert.equal(sheets[3].rows.length, 4, 'every invitation');
  assert.ok(sheets[4].rows.some(r => r[6] === 'More <maps> & “rivers”'));
  const blob = ctx.svXlsx(d), buf = Buffer.from(await blob.arrayBuffer()), parts = unzip(buf);
  assert.deepEqual(Object.keys(parts).sort(), ['[Content_Types].xml', '_rels/.rels', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/workbook.xml', ...[1, 2, 3, 4, 5, 6].map(i => `xl/worksheets/sheet${i}.xml`)].sort());
  for (const [n, x] of Object.entries(parts)) { assert.ok(x.startsWith('<?xml'), n);balanced(x); }
  const s1 = parts['xl/worksheets/sheet1.xml'];
  assert.match(s1, /More &lt;maps&gt; &amp; “rivers”/);assert.match(s1, /<c r="A2" s="2"><v>\d+\.\d+<\/v><\/c>/, 'a date');
  assert.match(s1, /<pane ySplit="1"/);assert.match(s1, /<autoFilter ref="A1:[A-Z]+3"\/>/);
  assert.equal(ctx.svCol(0), 'A');assert.equal(ctx.svCol(25), 'Z');assert.equal(ctx.svCol(26), 'AA');assert.equal(ctx.svCol(51), 'AZ');
  assert.equal(ctx.svCsv([['a', 'b,c', 'say "hi"'], [1, null, new Date(Date.UTC(2026, 0, 2, 3, 4))]]), 'a,"b,c","say ""hi"""\r\n1,,2026-01-02 03:04');
});
