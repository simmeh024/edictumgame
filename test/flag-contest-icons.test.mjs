// Kasimir Oduya's flag (20 Nov 2026): honouring the result of the edict “Designed by a Nine-Year-Old” gives two icons,
// a motorbike and a volcano, each a charge for the arms and an emblem for the flag. The other answers give nothing. They
// are kept in n.ppx, like the passport edicts' designs, and a nation that gave that answer before the icons existed gets
// them when it loads.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
const fn = name => { const i = html.indexOf('function ' + name + '('); assert.ok(i >= 0, name); let d = 0, k = html.indexOf('{', i);
  for (; k < html.length; k++) { if (html[k] === '{') d++; else if (html[k] === '}' && !--d) break; } return html.slice(i, k + 1); };
const cut = (a, b) => { const i = html.indexOf(a), j = html.indexOf(b, i + a.length); assert.ok(i >= 0 && j > i, 'section ' + a); return html.slice(i, j + b.length); };
const IDS = ['c-motorbike', 'e-motorbike', 'c-volcano', 'e-volcano'];
const NOTE = 'New for your flag and arms: the Motorbike and the Volcano, each a charge for the arms and an emblem for the flag. Choose them in the Flag Studio and the Arms Studio.';

/* the edict as written, and the four designs as the UNLOCKS table has them */
const issueSrc = (() => { const i = html.indexOf("{id:'prv-flag-contest'"), j = html.indexOf("\n{id:'", i + 5); return html.slice(i, j).replace(/,\s*$/, ''); })();
const unlockSrc = IDS.map(id => { const m = new RegExp(`'${id}':(\\{[^}]*\\})`).exec(html); assert.ok(m, id + ' is in UNLOCKS'); return `'${id}':${m[1]}`; }).join(',');

function game() {
  const ctx = vm.createContext({});
  vm.runInContext(`
    const ISSUE=(${issueSrc});
    const GAMBLE={id:'gamble',t:'A gamble',o:[{e:{ul:['c-volcano']},g:{p:.5,e:{}}}]};
    const ISSUE_BY_ID={[ISSUE.id]:ISSUE,gamble:GAMBLE,other:{id:'other',t:'Other',o:[{e:{}}]}};
    const UNLOCKS={${unlockSrc},'pi-uv':{k:'ppink',n:'Ultraviolet ink',src:'edict',ed:'pp-uv-ink'}};
    const NORM_HOOKS=[],UNLOCK_SOURCES=[],PP_INK={};let geoAfter=()=>[];
    ${fn('achTwin')}${fn('achUnlockWords')}
    ${cut('/* designs for the flag and arms that come with one answer', 'return notes;})(geoAfter);')}
    function unlocksOf(n){const o=new Set();for(const s of UNLOCK_SOURCES)for(const id of s.earned(n)||[])o.add(id);return o;}
    function normalize(d){const n=JSON.parse(JSON.stringify(d));for(const h of NORM_HOOKS)h(n,d);return n;}
    this.G={ISSUE,UNLOCKS,UNLOCK_SOURCES,geoAfter,unlocksOf,normalize};`, ctx);
  return ctx.G;
}

test('honouring the result lists both icons, each a charge with its twin emblem, drawn and blazoned', () => {
  const G = game();
  assert.equal(G.ISSUE.t, 'Designed by a Nine-Year-Old');
  assert.equal(G.ISSUE.ul, undefined, 'not every answer');
  assert.match(G.ISSUE.o[0].t, /^“A promise is a promise/);
  assert.deepEqual([...G.ISSUE.o[0].e.ul], IDS);
  for (let o = 1; o < G.ISSUE.o.length; o++) assert.equal(G.ISSUE.o[o].e.ul, undefined, 'answer ' + o + ' gives no icons');
  for (const id of IDS) { const u = G.UNLOCKS[id]; assert.equal(u.src, 'edict'); assert.equal(u.ed, 'prv-flag-contest'); }
  assert.equal(G.UNLOCKS['c-motorbike'].tw, 'e-motorbike');
  assert.equal(G.UNLOCKS['c-volcano'].tw, 'e-volcano');
  assert.match(html, /'e-motorbike':'motorbike','e-volcano':'volcano'\}\[e\]/, 'the flag emblems draw the charges');
  assert.match(html, /motorbike:'a motorbike',volcano:'a volcano in eruption'\}/, 'the blazon names them');
  assert.match(html, /ppu:'Passport design',ul:'Flag and arms designs'\}/, 'the admin edicts page names the effect');
  const draw = new Function(['czEll', 'czCirc', 'czStarPts', 'czSil', 'czCharge'].map(fn).join('\n') + '\nreturn czCharge;')();
  for (const k of ['motorbike', 'volcano']) for (const flat of [0, 1]) {
    const svg = draw(k, '#F2C230', '#000', flat);
    assert.ok((svg.match(/<path /g) || []).length > 10, k + ' is drawn');
    assert.ok(!/NaN|undefined/.test(svg), k + ' has no broken numbers');
    const nums = [...svg.matchAll(/ d="([^"]*)"/g)].flatMap(m => m[1].match(/-?\d+(\.\d+)?/g) || []).map(Number);
    assert.ok(nums.every(v => v >= -1 && v <= 101), k + ' stays inside its 100 × 100 box');
  }
});

test('the first answer gives all four, once, with a note; the others, an NPC and other edicts give nothing', () => {
  const G = game(), ent = { id: 'prv-flag-contest' };
  const n = { name: 'Iconia', answered: [] };
  const notes = G.geoAfter(n, G.ISSUE.o[0], ent, Date.now());
  assert.deepEqual([...n.ppx].sort(), [...IDS].sort());
  assert.deepEqual(JSON.parse(JSON.stringify(notes)), [['Flag makers', NOTE]]);
  for (const id of IDS) assert.ok(G.unlocksOf(n).has(id), id + ' is held');
  assert.equal(G.geoAfter(n, G.ISSUE.o[0], ent, Date.now()).length, 0, 'no second note');
  for (let o = 1; o < G.ISSUE.o.length; o++) {
    const m = { name: 'Plain', answered: [] };
    assert.equal(G.geoAfter(m, G.ISSUE.o[o], ent, Date.now()).length, 0, 'answer ' + o);
    assert.equal(m.ppx, undefined, 'answer ' + o);
  }
  const npc = { npc: 1, answered: [] };
  assert.equal(G.geoAfter(npc, G.ISSUE.o[0], ent, Date.now()).length, 0);
  assert.equal(npc.ppx, undefined);
  const other = { answered: [] };
  G.geoAfter(other, { e: {} }, { id: 'other' }, Date.now());
  assert.equal(other.ppx, undefined, 'another edict gives nothing');
});

test('a nation that honoured the result earlier gets the icons on load; other answers and a dismissal do not', () => {
  const G = game(), was = o => G.normalize({ name: 'Old', answered: [{ id: 'prv-flag-contest', o, t: 1 }] }).ppx;
  assert.deepEqual([...G.normalize({ name: 'Old', answered: [{ id: 'prv-flag-contest', o: 0, t: 1 }], ppx: ['pi-uv'] }).ppx].sort(),
    ['c-motorbike', 'c-volcano', 'e-motorbike', 'e-volcano', 'pi-uv']);
  for (const o of [1, 2, 3, -1]) assert.equal(was(o), undefined, 'answer ' + o);
  assert.equal(G.normalize({ name: 'Npc', npc: 1, answered: [{ id: 'prv-flag-contest', o: 0, t: 1 }] }).ppx, undefined);
  assert.equal(G.normalize({ name: 'Lost', answered: [{ id: 'gamble', o: 0, g: 0, t: 1 }] }).ppx, undefined, 'a gamble that failed gives nothing');
  assert.deepEqual([...G.normalize({ name: 'Won', answered: [{ id: 'gamble', o: 0, g: 1, t: 1 }] }).ppx], ['c-volcano'], 'a gamble that came off does');
  const kept = G.normalize({ name: 'Kept', answered: [], ppx: IDS.concat('bogus') });
  assert.deepEqual([...kept.ppx], IDS, 'held icons are kept after the answer leaves the record; unknown ids are dropped');
});

test('a locked tile says one answer to the edict brings them', () => {
  const G = game(), how = id => G.UNLOCK_SOURCES.map(s => s.how(id)).find(Boolean);
  assert.equal(how('c-motorbike'), 'Comes with one answer to the edict “Designed by a Nine-Year-Old”, which reaches nations of two provinces or more.');
  assert.equal(how('e-volcano'), how('c-motorbike'));
  assert.equal(how('pi-uv'), 'Comes with one answer to the edict “?”.', 'the passport designs keep their wording');
});
