// The admin portal, round two (19 Nov 2026), in the parts that need no database:
//   - the report queue puts the tickets about one nation together, so brigading is one decision and not five;
//   - Needs attention gathers every queue into one list, the longest-waiting first;
//   - a ban's term reads as words;
//   - the balance page's counting (functions/balance.js) over the rows functions/stats.js builds.
// The rest of the round — timed bans, the case file, what an action would take — is in test/admin.test.mjs, which
// needs the emulators.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { balanceOf } from '../functions/balance.js';

const html = fs.readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
const grab = (re, what) => { const m = re.exec(html); assert.ok(m, what + ' is in the game'); return m[0]; };
/* a top-level function: its first line, and its indented body down to the closing brace at the start of a line */
const fn = name => {
  const at = html.indexOf('\nfunction ' + name + '('); assert.ok(at >= 0, name + ' is in the game');
  const lines = html.slice(at + 1).split('\n'), out = [lines[0]];
  if (!lines[1].startsWith(' ') && lines[1] !== '}') return lines[0];
  for (const l of lines.slice(1)) { out.push(l); if (l === '}') break; }
  return out.join('\n');
};
const DAY = 86400000;
const ctx = vm.createContext({});
vm.runInContext([
  'const DAY=' + DAY + ';',
  'const esc=v=>String(v==null?"":v).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;"}[c]));',
  'const rel=t=>"a while ago";const regName=r=>({mer:"Meridian",saf:"Saffron Coast"}[r]||r);const fmtPop=p=>String(p)+"m";',
  'const REPORT_WHY={name:"Offensive name",content:"Offensive content",spam:"Spam or advertising"};',
  /* the parts of the page the queue leans on, stubbed: they are the subject of their own tests */
  'const admImpactBox=()=>"";const admWhyBox=()=>"";const admKeysHint=()=>"";',
  'const S={isOwner:true,mod:{}};const ADM={d:null,ask:null,act:""};const ADMR={pick:0};',
  'const ADMH={d:null},BGA={list:null},AW={a:null};',
  grab(/const admRepKind=[\s\S]*?;\n/, 'admRepKind'),
  grab(/const admRepThing=[^\n]*\n/, 'admRepThing'),
  grab(/const admDaysWord=[^\n]*\n/, 'admDaysWord'),
  grab(/const admReportWhy=[^\n]*\n/, 'admReportWhy'),
  fn('admReports'), fn('admCases'), fn('triRows'),
  'this.admReports=admReports;this.admCases=admCases;this.triRows=triRows;this.admDaysWord=admDaysWord;this.admReportWhy=admReportWhy;this.S=S;this.ADM=ADM;this.ADMH=ADMH;this.BGA=BGA;this.AW=AW;this.ADMR=ADMR;',
].join('\n'), ctx);
const { admReports, admCases, triRows, admDaysWord, admReportWhy } = ctx;

const now = Date.now();
const ticket = (id, target, over, extra = {}) => ({ id, target, name: 'Aldara', reg: 'mer', kind: 'post', post: 'cb:mer:' + id,
  reason: 'content', t: now - over, x: 'the reported words', ...extra });

test('tickets about one nation are one case', () => {
  ctx.ADM.d = { reports: [ticket('r1', 'u1', 1000), ticket('r2', 'u1', 2000), ticket('r3', 'u2', 3000)] };
  const cases = admCases();
  assert.equal(cases.length, 2, 'three tickets about two nations are two cases');
  assert.equal(cases.map(c => c.rows.length).join(' '), '2 1');
  const h = admReports(ctx.ADM.d.reports);
  assert.match(h, /3 tickets about 2 nations/, 'the queue says how many tickets and how many nations');
  assert.equal((h.match(/<li class="adm-rep/g) || []).length, 2, 'one entry per nation, not per ticket');
  assert.match(h, /Close all 2/, 'a case of several tickets can be closed at once');
});

test('a single ticket keeps its own entry and no Close all', () => {
  const list = [ticket('r1', 'u1', 1000)];
  const h = admReports(list);
  assert.equal((h.match(/<li class="adm-rep/g) || []).length, 1);
  assert.doesNotMatch(h, /Close all/);
  assert.doesNotMatch(h, /tickets about/, 'one ticket about one nation needs no count');
});

test('a case waiting over a day is marked, a fresh one is not', () => {
  assert.match(admReports([ticket('r1', 'u1', 2 * DAY)]), /<li class="adm-rep[^"]*old"/);
  assert.doesNotMatch(admReports([ticket('r1', 'u1', 1000)]), / old"/);
});

test('the open case is the one the keys work', () => {
  ctx.ADMR.pick = 1;
  const h = admReports([ticket('r1', 'u1', 1000), ticket('r2', 'u2', 2000)]);
  const items = h.match(/<li class="adm-rep[^"]*"/g);
  assert.doesNotMatch(items[0], /cur/);
  assert.match(items[1], /cur/, 'the second case is the open one');
  ctx.ADMR.pick = 0;
});

test('a moderator sees the actions that are theirs, and not the rest', () => {
  ctx.S.isOwner = false;
  const h = admReports([ticket('r1', 'u1', 1000)]);
  assert.match(h, /Remove the post/);
  assert.match(h, /Close ticket/);
  assert.doesNotMatch(h, /Ban the player/, 'banning stays with the admins');
  assert.doesNotMatch(h, /Hide the nation/);
  ctx.S.isOwner = true;
});

test('Needs attention gathers every queue, the longest waiting first', () => {
  ctx.ADM.d = { reports: [ticket('r1', 'u1', 2 * 3600000)] };
  ctx.ADMH.d = { open: [{ id: 't1', topic: 'I cannot sign in', w: 's', lt: now - 5 * 3600000 }, { id: 't2', topic: 'waiting on the player', w: 'p', lt: now - 9 * 3600000 }] };
  ctx.BGA.list = [{ id: 'b1', ti: 'The map will not draw', st: 'new', t: now - 3600000 }, { id: 'b2', ti: 'old news', st: 'fixed', t: now - 99 * 3600000 }];
  ctx.AW.a = { alerts: [{ id: 'a1', ti: 'A nation grew tenfold', x: 'Aldara', t: now - 4 * 3600000, seen: false }, { id: 'a2', ti: 'seen already', t: now - 50 * 3600000, seen: true }] };
  const rows = triRows();
  assert.equal(rows.map(r => r.k).join(' '), 'help alert report bug', 'oldest first, and only what is still waiting');
  assert.equal(rows.length, 4, 'a ticket waiting on the player, a fixed bug and a seen alert are not waiting on the staff');
});

test('a moderator\'s queue is the reports alone', () => {
  ctx.S.isOwner = false;
  assert.equal(triRows().map(r => r.k).join(' '), 'report', 'help queries, bugs and alerts are the admins\'');
  ctx.S.isOwner = true;
});

test('a ban\'s term reads as words', () => {
  assert.equal(admDaysWord(0), '', 'a ban until it is lifted says nothing extra');
  assert.equal(admDaysWord(1), ' for a day');
  assert.equal(admDaysWord(7), ' for a week');
  assert.equal(admDaysWord(30), ' for 30 days');
});

test('the ticket\'s own words are what the player is told, unless the admin writes otherwise', () => {
  assert.equal(admReportWhy({ reason: 'spam', note: 'links to a shop' }), 'Spam or advertising: links to a shop.');
  assert.equal(admReportWhy({ reason: 'name' }), 'Offensive name.');
  assert.equal(admReportWhy(null), '');
});

/* ── the balance page's counting (functions/balance.js) ── */
const row = (o = {}) => ({ reg: 'mer', founded: now - 2 * DAY, pop: 10, cities: 1, claims: 5, dec: 3, f: ['settled'], f2: [], ach: [], pol: [], bld: [], ans: [], ...o });

test('nations are counted by the age they have reached', () => {
  const d = balanceOf([row({ founded: now - 3600000 }), row({ founded: now - 2 * DAY }), row({ founded: now - 45 * DAY })], now);
  assert.equal(d.nations, 3);
  assert.equal(d.ages.filter(a => a.n).map(a => a.label).join(' | '), 'First day | Days 1–3 | Months 1–3');
});

test('the middle nation of an age, and the quarter either side', () => {
  const pops = [1, 2, 3, 40, 50].map(p => row({ pop: p }));
  const age = balanceOf(pops, now).ages.find(a => a.label === 'Days 1–3');
  assert.equal(age.n, 5);
  assert.equal(age.pop, 3, 'the middle of five');
  assert.ok(age.lo <= age.pop && age.pop <= age.hi, 'the quarters sit either side of the middle');
});

test('an edict is counted by how its options were picked, and how often it was let go', () => {
  const d = balanceOf([row({ ans: [[now, 'tax', 0]] }), row({ ans: [[now, 'tax', 1], [now, 'war', -1]] }), row({ ans: [[now, 'tax', 0]] })], now);
  const tax = d.edicts.find(e => e.k === 'tax');
  assert.equal(tax.n, 3);
  assert.equal(tax.opts.join(' '), '2 1', 'the first option twice, the second once');
  assert.equal(tax.skip, 0);
  const war = d.edicts.find(e => e.k === 'war');
  assert.equal(war.skip, 1, 'an edict let go is counted as let go, not as an option');
  assert.equal(d.edicts[0].k, 'tax', 'the most answered first');
});

test('how far nations get, and what they build, as a share of them all', () => {
  const d = balanceOf([row({ f: ['settled', 'land'], bld: [['farm', 0, 1]] }), row({ f: ['settled'], bld: [['farm', 0, 1], ['farm', 1, 1]] }), row({ f: [] })], now);
  assert.deepEqual({ ...d.reach.find(x => x.k === 'settled') }, { k: 'settled', n: 2, pct: 66.7 });
  assert.equal(d.built.find(x => x.k === 'farm').n, 2, 'two farms in one nation are one nation with a farm');
});

test('a region with no nations counts to nothing rather than failing', () => {
  const d = balanceOf([], now);
  assert.equal(d.nations, 0);
  assert.equal(d.edicts.length, 0);
  assert.ok(d.ages.every(a => a.n === 0 && a.pop === 0));
});
