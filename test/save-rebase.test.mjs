// Replaying this device's actions onto another device's save (game/edictum.html, actRecord/rebaseActs): each action
// applies whole or not at all, its cost included.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
const from = html.indexOf('const ACT_SKIP='), to = html.indexOf('/* The account control lives in the Firebase adapter.');
assert.ok(from > 0 && to > from, 'the replay code is found');
const RES = ['goods', 'food'];
const make = () => new Function('RES', `
  const clone=v=>JSON.parse(JSON.stringify(v)),num0=v=>Number(v)||0,OBS=false,S={nation:null};let commitNo=0,carried=false;
  const roundStock=st=>Object.fromEntries(RES.map(r=>[r,Math.round(num0(st[r])*100)/100]));
  const stockNow=n=>({...n.stock});
  ${html.slice(from, to)}
  return {S,act(n){const r=actRecord(n);S.nation=n;commitNo++;return r;},rebase:rebaseActs,acts:()=>ownActs,carry(v){carried=v;}};`)(RES);

const base = () => ({ name: 'Testland', updatedAt: 1, stock: { goods: 100, food: 50 }, cities: [{ id: 'c1', nm: 'Port', b: [] }], mayor: null, motto: 'Old' });
// one action: a copy of the nation changed by f, with its resources set as an action does (_stockSet)
const play = (g, f) => { const n = JSON.parse(JSON.stringify(g.S.nation)); f(n); n._stockSet = true; g.act(n); };

test('a clashing action is left out whole: no cost without its effect', () => {
  const g = make(); g.S.nation = base();
  play(g, n => { n.mayor = 'Ada'; n.stock.goods -= 15; });
  const cloud = { ...base(), updatedAt: 2, mayor: 'Bo', stock: { goods: 85, food: 50 } };
  const r = g.rebase(cloud);
  assert.equal(r, null, 'nothing left to replay: the old notice and saved copy apply');
});

test('a clashing action is dropped while the others still apply', () => {
  const g = make(); g.S.nation = base();
  play(g, n => { n.mayor = 'Ada'; n.stock.goods -= 15; });
  play(g, n => { n.cities[0].b.push({ k: 'mill', s: 5 }); n.stock.goods -= 20; });
  const cloud = { ...base(), updatedAt: 2, mayor: 'Bo', stock: { goods: 85, food: 50 } };
  const r = g.rebase(cloud);
  assert.equal(r.clash, 1);
  assert.equal(r.n.mayor, 'Bo', 'the other device keeps its mayor');
  assert.equal(r.n.stock.goods, 65, 'only the mill is paid for: 85 - 20');
  assert.deepEqual(r.n.cities[0].b, [{ k: 'mill', s: 5 }]);
});

test('different changes on both devices are both kept, each paid once', () => {
  const g = make(); g.S.nation = base();
  play(g, n => { n.cities[0].b.push({ k: 'mill', s: 5 }); n.stock.goods -= 20; });
  const cloud = { ...base(), updatedAt: 2, motto: 'New', stock: { goods: 90, food: 50 } };
  const r = g.rebase(cloud);
  assert.equal(r.clash, 0);
  assert.equal(r.n.motto, 'New');
  assert.equal(r.n.stock.goods, 70);
});

test('an action the other save no longer affords is left out', () => {
  const g = make(); g.S.nation = base();
  play(g, n => { n.cities[0].b.push({ k: 'mill', s: 5 }); n.stock.goods -= 80; });
  const cloud = { ...base(), updatedAt: 2, motto: 'Spent', stock: { goods: 30, food: 50 } };
  assert.equal(g.rebase(cloud), null);
});

test('an action built on one that was left out is left out too', () => {
  const g = make(); g.S.nation = base();
  play(g, n => { n.mayor = 'Ada'; n.stock.goods -= 15; });
  play(g, n => { n.mayor = 'Ada the Second'; n.stock.goods -= 5; });
  const cloud = { ...base(), updatedAt: 2, mayor: 'Bo', stock: { goods: 85, food: 50 } };
  assert.equal(g.rebase(cloud), null);
});

test('an edit to a city the other save no longer has is left out, cost included', () => {
  const g = make(); g.S.nation = base();
  play(g, n => { n.cities[0].nm = 'Harbour'; n.stock.goods -= 10; });
  play(g, n => { n.motto = 'Kept'; });
  const cloud = { ...base(), updatedAt: 2, cities: [], stock: { goods: 100, food: 50 } };
  const r = g.rebase(cloud);
  assert.equal(r.clash, 1);
  assert.equal(r.n.motto, 'Kept');
  assert.equal(r.n._stockSet, undefined, 'no cost was charged');
  assert.equal(r.n.stock.goods, 100);
});

test('changes carried over from an earlier visit are never replayed: the copy and the notice apply', () => {
  const g = make(); g.S.nation = base(); g.carry(true);
  const cloud = { ...base(), updatedAt: 2, motto: 'Elsewhere' };
  assert.equal(g.rebase(cloud), null, 'even with no action of this visit to replay');
  play(g, n => { n.mayor = 'Ada'; });
  assert.equal(g.rebase(cloud), null);
  g.carry(false);
  assert.ok(g.rebase(cloud), 'once a save has carried them, the actions of this visit replay again');
});
