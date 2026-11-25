// The ranks of prestige (ACH_RANKS in game/edictum.html) and the rule that keeps a rank once held.
// On 10 November 2026 the ranks from Elder Statesman up were moved further apart and two were added above The Last
// Word; a nation that held a rank on the old ladder keeps it (n.rkh, written at its first save under the new one).
// On 12 November 2026 six more were added above The Blank Page, 600 apart as before (adding at the top needs no floor),
// on 13 November eight more above The Library of Everything, up to Once Upon a Time at 31,800, and on 14 November five
// more above that, up to Back to Page One at 34,800.
// On 25 November 2026 the ladder was filled out both ways: fifteen ranks went into the middle, between Luminary and
// Eternal, halving every step there, and sixteen went on top, up to The Open Book at 44,400, which is as far as the
// 45,420 prestige of all the achievements there are will carry a nation. Adding in the middle moves a rank's place on
// the ladder without changing the rank, so n.rkh stays a place on the old ladder and ACH_V1_RANK says where each of
// those ranks now sits.
//   node --test test/rank-ladder.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
const from = (start, end) => { const at = html.indexOf(start); assert.ok(at >= 0, start); return html.slice(at, html.indexOf(end, at) + end.length); };
const TIER = { b: 10, s: 25, g: 50, p: 100, x: 200, o: 500 };
const ctx = vm.createContext({ clamp: (v, a, b) => Math.min(b, Math.max(a, v)), achPoints: n => (n && n.pts) || 0 });
vm.runInContext([
  from('const ACH_RANKS=[[0,', ']];'), from('function achRank(p){', '\n'), from('const ACH_RANKS_V1=[', '\n'), from('function achIdxV1(p){', '\n'),
  from('function achFloor(n,p){', '\n'), from('function achRankOf(n,p){', '\n}\n'), from('function rkMarkIdx(rk,rv){', '\n}\n'),
].join('\n') + '\nthis.X={ACH_RANKS,ACH_RANKS_V1,ACH_RANKS_VER,ACH_V1_RANK,RK_MARK_VER,achRank,achIdxV1,achFloor,achRankOf,rkMarkIdx};', ctx);
const { ACH_RANKS: R, ACH_RANKS_V1: V1, ACH_RANKS_VER: VER, ACH_V1_RANK: MAP, RK_MARK_VER: MV, achRank, achRankOf, rkMarkIdx } = ctx.X;
const at = Array.from(R, r => r[0]), name = i => R[i][1];   // (Array.from: an array of this realm, so deepEqual compares it)
const marked = (pts, rkh) => Object.assign({ pts, rkv: VER }, rkh ? { rkh } : {});

test('the ladder: 103 ranks, each further than the last, with a name and a line of its own', () => {
  assert.equal(R.length, 103);
  for (let i = 1; i < R.length; i++) assert.ok(at[i] > at[i - 1], name(i));
  assert.equal(new Set(R.map(r => r[1])).size, R.length); assert.ok(R.every(r => typeof r[2] === 'string' && r[2].length > 10));
  assert.equal(at[0], 0); assert.equal(name(0), 'Unregistered');
  assert.deepEqual([name(65), name(66), name(67)], ['The Last Word', 'Postscript', 'The Blank Page']);
  assert.deepEqual(Array.from(R.slice(68, 74), r => r[1]), ['The First Line', 'Second Edition', 'Required Reading', 'The Canon', 'Illuminated Manuscript', 'The Library of Everything']);
  assert.deepEqual(Array.from(R.slice(74, 82), r => r[1]), ['Read Aloud', 'Translated into Everything', 'Quoted Out of Context', 'Proverbial', 'Mother Tongue', 'The Alphabet', 'Written in the Stars', 'Once Upon a Time']);
  assert.deepEqual(Array.from(R.slice(82, 87), r => r[1]), ['Told and Retold', 'The Moral of the Story', 'Legend Has It', 'Happily Ever After', 'Back to Page One']);
  assert.deepEqual(Array.from(R.slice(87), r => r[1]), ['The Second Reading', 'Dog-Eared', 'Marginalia', 'The Annotated Edition', 'Set to Music', 'The Festival', 'Played by an Actor',
    'Learned by Heart', 'The Anniversary', 'The Centenary', 'Beyond Living Memory', 'The Old Country', 'The Source', 'Where It All Began', 'The Pen Passed On', 'The Open Book']);
  assert.deepEqual(at.slice(65), [22200, 22800, 23400, 24000, 24600, 25200, 25800, 26400, 27000, 27600, 28200, 28800, 29400, 30000, 30600, 31200, 31800, 32400, 33000, 33600, 34200, 34800,
    35400, 36000, 36600, 37200, 37800, 38400, 39000, 39600, 40200, 40800, 41400, 42000, 42600, 43200, 43800, 44400]);
});

test('the middle: fifteen ranks between Luminary and Eternal, every step there halved', () => {
  assert.deepEqual(at.slice(18, 49), [2500, 2750, 3000, 3250, 3500, 3750, 4000, 4250, 4500, 4750, 5000, 5250, 5500, 5750, 6000,
    6375, 6750, 7125, 7500, 7875, 8250, 8625, 9000, 9375, 9750, 10125, 10500, 10875, 11250, 11625, 12000]);
  assert.deepEqual(Array.from(R.slice(19, 33).filter((_, k) => k % 2 === 0), r => r[1]),
    ['Standing Invitation', 'Asked for an Opinion', 'Precedent', 'Quorum of One', 'Safe Pair of Hands', 'Benchmark', 'Head of the Table']);
  assert.deepEqual(Array.from(R.slice(33, 48).filter((_, k) => k % 2 === 0), r => r[1]),
    ['Authorised Biography', 'Cast in Bronze', 'Named After You', 'In the Dictionary', 'Ballad in Nine Verses', 'Public Holiday', 'Carved in the Cliffs', 'Creation Story']);
  for (let i = 19; i <= 32; i++) assert.equal(at[i] - at[i - 1], 250, name(i));
  for (let i = 33; i <= 48; i++) assert.equal(at[i] - at[i - 1], 375, name(i));
  // the middle of the ladder holds twice the ranks it did: 2,500 to 12,000 held 15, now 30
  assert.equal(at.filter(v => v > 2500 && v <= 12000).length, 30);
});

test('what moved: nothing below Luminary, every rank from there up is further away, none is nearer', () => {
  assert.equal(V1.length, 51); assert.equal(VER, 2);
  assert.deepEqual(at.slice(0, 19), [...V1].slice(0, 19), 'the first nineteen ranks stand where they stood');
  assert.equal(name(20), 'Elder Statesman');
  // every one of the old ladder's ranks is still there, under its own name, and none of them is nearer than it was
  assert.equal(MAP.length, 51);
  assert.deepEqual([...MAP].slice(0, 19), [...Array(19).keys()], 'nothing below Luminary moved');
  assert.deepEqual([MAP[19], MAP[33], MAP[34], MAP[50]], [20, 48, 49, 65]);
  for (let i = 19; i <= 50; i++) assert.ok(at[MAP[i]] > V1[i], name(MAP[i]));
  assert.deepEqual([name(MAP[19]), name(MAP[50])], ['Elder Statesman', 'The Last Word']);
  for (let i = 49; i < R.length; i++) assert.equal(at[i] - at[i - 1], 600, name(i));
  assert.equal([...V1].filter(v => v > 2500 && v <= 12000).length, 17);
  // the rewards given at a fixed prestige still fall on a rank, so the ranks list can show them
  for (const t of [500, 1000, 1500, 2500, 5000, 5500]) assert.ok(at.includes(t), String(t));
});

test('the top rank can be reached with the achievements there are, with room to spare', () => {
  const tiers = [...html.matchAll(/'(b|s|g|p|x|o)','(?:[^'\\]|\\.)+'/g)].map(m => m[1]);
  const max = tiers.reduce((s, t) => s + TIER[t], 0);
  assert.ok(tiers.length > 480, String(tiers.length));
  assert.ok(max >= at.at(-1) + 500, `${max} prestige to be earned, the top rank asks ${at.at(-1)}`);
  /* that count is a rough one (it reads the source, and reads a little too much). Measured in the running game on
     25 November 2026, the 936 achievements there are pay 45,420 prestige in all, and the ladder is filled up to the
     last rank that leaves a 500 margin: one more at the usual 600 would ask 45,000, which is too close to the top. */
  assert.equal(at.at(-1), 44400);
});

test('a nation keeps a rank it held when the ladder was stretched', () => {
  // 3,300 prestige was Eminence (place 20 on the old ladder, from 3,250); on the new ladder alone it is Asked for an Opinion
  assert.equal(achRank(3300).i, 21); assert.equal(achRank(3300).name, 'Asked for an Opinion');
  const n = marked(3300, 20), r = achRankOf(n);
  assert.equal(r.i, 22); assert.equal(r.name, 'Eminence'); assert.equal(r.held, true);
  assert.deepEqual({ ...r.next }, { at: 3750, name: 'Precedent' }); assert.ok(r.pct > 0 && r.pct < 100);
  // it stays Eminence until the new ladder itself gives more
  assert.equal(achRankOf(marked(3499, 20)).i, 22); assert.equal(achRankOf(marked(3600, 20)).i, 22); assert.equal(achRankOf(marked(3600, 20)).held, undefined);
  assert.equal(achRankOf(marked(3750, 20)).name, 'Precedent'); assert.equal(achRankOf(marked(9000, 20)).i, achRank(9000).i);
  // a nation founded since has no such floor
  assert.equal(achRankOf(marked(3300)).i, 21); assert.equal(achRankOf(marked(3300, 0)).i, 21);
  // the old top rank is kept too, and the new ranks above it are earned the ordinary way
  assert.equal(achRankOf(marked(21000, 50)).name, 'The Last Word'); assert.equal(achRankOf(marked(22800, 50)).i, 66); assert.equal(achRankOf(marked(23400, 50)).name, 'The Blank Page');
});

test('a nation whose own game has not saved since reads as the old ladder had it, the same in every game', () => {
  for (const p of [0, 49, 50, 2500, 2875, 3300, 4999, 5000, 11000, 12000, 20999, 21000]) {
    let i = 0; for (let k = 0; k < V1.length; k++) if (p >= V1[k]) i = k;
    assert.equal(achRankOf({ pts: p }).i, MAP[i], String(p));
  }
  assert.equal(achRankOf({ pts: 22800 }).i, 66, 'past the old top, the new ranks count');
  assert.equal(achRankOf({ pts: 5000, npc: true }).i, achRank(5000).i, 'a computer nation has no floor');
});

test('the floor is never more than the points justified on the old ladder, and the past follows the old ladder up to it', () => {
  assert.equal(achRankOf(marked(100, 50)).i, 2, 'a made-up floor does nothing');
  assert.equal(achRankOf(marked(3300, 40)).i, 22);
  // looking back: a nation now at 3,300 with Eminence held Elder Statesman at 2,900 (old ladder), and Luminary at 2,600
  const n = marked(3300, 20);
  assert.equal(achRankOf(n, 2900).name, 'Elder Statesman'); assert.equal(achRankOf(n, 2600).i, 18); assert.equal(achRankOf(n, 0).i, 0);
});

test('a rank published for others to read says which numbering it is written in, and an older mark is mapped up', () => {
  // a mark of this build's numbering is read as it stands
  for (const i of [0, 18, 19, 48, 102]) assert.equal(rkMarkIdx(i, MV), i, String(i));
  // one from before the middle ranks were added is a place on the ladder as it was: the same shift ACH_V1_RANK uses
  assert.equal(rkMarkIdx(18, undefined), 18, 'nothing below Luminary moved');
  assert.equal(name(rkMarkIdx(33, undefined)), 'Eternal', 'not Authorised Biography, which sits at 33 now');
  assert.equal(name(rkMarkIdx(20, undefined)), 'Eminence');
  assert.equal(name(rkMarkIdx(71, undefined)), 'Back to Page One', 'the old top rank');
  for (let i = 0; i < 51; i++) assert.equal(rkMarkIdx(i, undefined), MAP[i], String(i));
  // and nothing a reader is sent can point past the ladder, or be anything but a place on it
  assert.equal(rkMarkIdx(5000, MV), R.length - 1); assert.equal(rkMarkIdx(5000, undefined), R.length - 1);
  for (const bad of [-1, 1.5, '3', null, undefined, NaN]) assert.equal(rkMarkIdx(bad, MV), 0, String(bad));
  // every reader of a published mark goes through it, and every publisher sends the version beside the index
  for (const read of ['rkMarkIdx(U.rk,U.rkn)', 'rkMarkIdx(m.rk,m.rkn)', 'ACH_RANKS[rkMarkIdx(c.i,c.rkn)]']) assert.ok(html.includes(read), read);
  assert.equal([...html.matchAll(/rkn:RK_MARK_VER/g)].length, 4, 'the board profile, a chat line, a rank card and a nation card');
  assert.ok(html.includes('rkn:Number.isInteger(v.rkn)&&v.rkn>=0?v.rkn:0'), 'a line keeps the version it was sent with');
});

test('every rank has a border, and every reader of a nation’s rank goes through the same function', () => {
  const bd = from('const ID_BD=[', ']];');
  assert.equal([...bd.matchAll(/\['b-[a-z0-9]+','/g)].length, R.length);
  assert.match(bd, /\['b-postscript','Afterglow','afterglow','cstar',2\],\['b-blankpage','The blank page','blank','prism',2\],/);
  assert.match(bd, /\['b-canon','Marble and laurel','marble','laurel',2\],\['b-illum','Illuminated capitals','illum','lap',2\],\['b-library','Every spine on the shelf','spines','prism',2\],/);
  assert.match(bd, /\['b-starwrit','Written in starlight','astral','cstar',2\],\['b-onceupon','Gold-leaf storybook','story','prism',2\],/);
  assert.match(bd, /\['b-retold','Fireside tale','hearth','sun',2\],\['b-moral','Fable woodcut','woodcut','fleur',2\],\['b-legend','Woven tapestry','tapestry','laurel',2\],\s*\['b-everafter','Storybook dusk','dusk','cstar',2\],\['b-pageone','Every page at once','pages','prism',2\],/);
  assert.match(bd, /\['b-openbook','Every page open','pages','crystal',2\]\];$/);
  // the ranks added in the middle and on top wear looks the ladder already has, each with a charge of its own
  const pairs = [...bd.matchAll(/\['b-[a-z0-9]+','[^']+','([a-z ]+)','([a-z]*)',(\d)\]/g)].map(m => m.slice(1).join('/'));
  assert.equal(pairs.length, R.length); assert.equal(new Set(pairs).size, pairs.length, 'no two borders share a look, a charge and a grade');
  const looks = ['afterglow', 'blank', 'ink', 'gilt', 'lamp', 'marble', 'illum', 'spines', 'candle', 'scripts', 'quote', 'sampler', 'argent', 'type', 'astral', 'story', 'hearth', 'woodcut', 'tapestry', 'dusk', 'pages'];
  for (const look of looks) {
    assert.match(html, new RegExp(`\\n\\.id-rk-${look}\\{--bd-1:`)); assert.match(html, new RegExp(`\\n\\.id-bd-${look} \\.id-bd-r\\{--bd-w:\\d+px;background:[^\\n]*animation:idBdSpin [^\\n]*idBdGlow`));
    assert.match(html, new RegExp(`[,{ ]${look}:\\['#`), 'and colours for the card’s picture');
    /* it glows past the card's edge, and stands still for those who asked for less motion */
    assert.match(html, new RegExp(`\\.hero\\.id-rk-${look}[,{]`), look + ' glows');
    assert.match(html, new RegExp(`prefers-reduced-motion:reduce\\)\\{[^\\n]*\\.id-bd-${look} \\.id-bd-r[,{]`), look + ' stills (system)');
    assert.match(html, new RegExp(`:root\\[data-motion="reduce"\\] \\.id-bd-${look} \\.id-bd-r[,{]`), look + ' stills (setting)');
  }
  const calls = [...html.matchAll(/achRank\(/g)].length;
  assert.equal(calls, 2, 'achRank(p) is the bare ladder: only its definition and achRankOf use it');
  assert.match(html, /ACH_RANK_CREDITS\*achRankOf\(n\)\.i/, 'land credits follow the rank held');
});
