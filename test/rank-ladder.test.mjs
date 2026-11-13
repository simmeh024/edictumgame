// The ranks of prestige (ACH_RANKS in game/edictum.html) and the rule that keeps a rank once held.
// On 10 November 2026 the ranks from Elder Statesman up were moved further apart and two were added above The Last
// Word; a nation that held a rank on the old ladder keeps it (n.rkh, written at its first save under the new one).
// On 12 November 2026 six more were added above The Blank Page, 600 apart as before (adding at the top needs no floor),
// and on 13 November eight more above The Library of Everything, up to Once Upon a Time at 31,800.
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
  from('function achFloor(n,p){', '\n'), from('function achRankOf(n,p){', '\n}\n'),
].join('\n') + '\nthis.X={ACH_RANKS,ACH_RANKS_V1,ACH_RANKS_VER,achRank,achIdxV1,achFloor,achRankOf};', ctx);
const { ACH_RANKS: R, ACH_RANKS_V1: V1, ACH_RANKS_VER: VER, achRank, achRankOf } = ctx.X;
const at = Array.from(R, r => r[0]), name = i => R[i][1];   // (Array.from: an array of this realm, so deepEqual compares it)
const marked = (pts, rkh) => Object.assign({ pts, rkv: VER }, rkh ? { rkh } : {});

test('the ladder: 67 ranks, each further than the last, with a name and a line of its own', () => {
  assert.equal(R.length, 67);
  for (let i = 1; i < R.length; i++) assert.ok(at[i] > at[i - 1], name(i));
  assert.equal(new Set(R.map(r => r[1])).size, R.length); assert.ok(R.every(r => typeof r[2] === 'string' && r[2].length > 10));
  assert.equal(at[0], 0); assert.equal(name(0), 'Unregistered');
  assert.deepEqual([name(50), name(51), name(52)], ['The Last Word', 'Postscript', 'The Blank Page']);
  assert.deepEqual(Array.from(R.slice(53, 59), r => r[1]), ['The First Line', 'Second Edition', 'Required Reading', 'The Canon', 'Illuminated Manuscript', 'The Library of Everything']);
  assert.deepEqual(Array.from(R.slice(59), r => r[1]), ['Read Aloud', 'Translated into Everything', 'Quoted Out of Context', 'Proverbial', 'Mother Tongue', 'The Alphabet', 'Written in the Stars', 'Once Upon a Time']);
  assert.deepEqual(at.slice(50), [22200, 22800, 23400, 24000, 24600, 25200, 25800, 26400, 27000, 27600, 28200, 28800, 29400, 30000, 30600, 31200, 31800]);
});

test('what moved: nothing below Elder Statesman, every rank from there up is further away, none is nearer', () => {
  assert.equal(V1.length, 51); assert.equal(VER, 2);
  assert.deepEqual(at.slice(0, 19), [...V1].slice(0, 19), 'the first nineteen ranks stand where they stood');
  assert.equal(name(19), 'Elder Statesman');
  for (let i = 19; i <= 50; i++) assert.ok(at[i] > V1[i], name(i));
  assert.deepEqual(at.slice(19, 34), [3000, 3500, 4000, 4500, 5000, 5500, 6000, 6750, 7500, 8250, 9000, 9750, 10500, 11250, 12000]);
  for (let i = 34; i < R.length; i++) assert.equal(at[i] - at[i - 1], 600, name(i));
  // two ranks' worth of the middle went up: 2,500 to 12,000 held 17 ranks, now 15
  assert.equal(at.filter(v => v > 2500 && v <= 12000).length, 15); assert.equal([...V1].filter(v => v > 2500 && v <= 12000).length, 17);
  // the rewards given at a fixed prestige still fall on a rank, so the ranks list can show them
  for (const t of [500, 1000, 1500, 2500, 5000, 5500]) assert.ok(at.includes(t), String(t));
});

test('the top rank can be reached with the achievements there are, with room to spare', () => {
  const tiers = [...html.matchAll(/'(b|s|g|p|x|o)','(?:[^'\\]|\\.)+'/g)].map(m => m[1]);
  const max = tiers.reduce((s, t) => s + TIER[t], 0);
  assert.ok(tiers.length > 480, String(tiers.length));
  assert.ok(max >= at.at(-1) + 500, `${max} prestige to be earned, the top rank asks ${at.at(-1)}`);
});

test('a nation keeps a rank it held when the ladder was stretched', () => {
  // 3,300 prestige was Eminence (rank 20, from 3,250); on the new ladder alone it is Elder Statesman (19, from 3,000)
  assert.equal(achRank(3300).i, 19);
  const n = marked(3300, 20), r = achRankOf(n);
  assert.equal(r.i, 20); assert.equal(r.name, 'Eminence'); assert.equal(r.held, true);
  assert.deepEqual({ ...r.next }, { at: 4000, name: 'Kingmaker' }); assert.ok(r.pct > 0 && r.pct < 100);
  // it stays Eminence until the new ladder itself gives more
  assert.equal(achRankOf(marked(3499, 20)).i, 20); assert.equal(achRankOf(marked(3600, 20)).i, 20); assert.equal(achRankOf(marked(3600, 20)).held, undefined);
  assert.equal(achRankOf(marked(4000, 20)).i, 21); assert.equal(achRankOf(marked(9000, 20)).i, achRank(9000).i);
  // a nation founded since has no such floor
  assert.equal(achRankOf(marked(3300)).i, 19); assert.equal(achRankOf(marked(3300, 0)).i, 19);
  // the old top rank is kept too, and the new ranks above it are earned the ordinary way
  assert.equal(achRankOf(marked(21000, 50)).i, 50); assert.equal(achRankOf(marked(22800, 50)).i, 51); assert.equal(achRankOf(marked(23400, 50)).name, 'The Blank Page');
});

test('a nation whose own game has not saved since reads as the old ladder had it, the same in every game', () => {
  for (const p of [0, 49, 50, 2500, 2875, 3300, 4999, 5000, 11000, 12000, 20999, 21000]) {
    let i = 0; for (let k = 0; k < V1.length; k++) if (p >= V1[k]) i = k;
    assert.equal(achRankOf({ pts: p }).i, i, String(p));
  }
  assert.equal(achRankOf({ pts: 22800 }).i, 51, 'past the old top, the new ranks count');
  assert.equal(achRankOf({ pts: 5000, npc: true }).i, achRank(5000).i, 'a computer nation has no floor');
});

test('the floor is never more than the points justified on the old ladder, and the past follows the old ladder up to it', () => {
  assert.equal(achRankOf(marked(100, 50)).i, 2, 'a made-up floor does nothing');
  assert.equal(achRankOf(marked(3300, 40)).i, 20);
  // looking back: a nation now at 3,300 with rank 20 held rank 19 at 2,900 (old ladder), and 18 at 2,600
  const n = marked(3300, 20);
  assert.equal(achRankOf(n, 2900).i, 19); assert.equal(achRankOf(n, 2600).i, 18); assert.equal(achRankOf(n, 0).i, 0);
});

test('every rank has a border, and every reader of a nation’s rank goes through the same function', () => {
  const bd = from('const ID_BD=[', ']];');
  assert.equal([...bd.matchAll(/\['b-[a-z0-9]+','/g)].length, R.length);
  assert.match(bd, /\['b-postscript','Afterglow','afterglow','cstar',2\],\['b-blankpage','The blank page','blank','prism',2\],/);
  assert.match(bd, /\['b-canon','Marble and laurel','marble','laurel',2\],\['b-illum','Illuminated capitals','illum','lap',2\],\['b-library','Every spine on the shelf','spines','prism',2\],/);
  assert.match(bd, /\['b-starwrit','Written in starlight','astral','cstar',2\],\['b-onceupon','Gold-leaf storybook','story','prism',2\]\];$/);
  const looks = ['afterglow', 'blank', 'ink', 'gilt', 'lamp', 'marble', 'illum', 'spines', 'candle', 'scripts', 'quote', 'sampler', 'argent', 'type', 'astral', 'story'];
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
