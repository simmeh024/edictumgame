// What a cancelled building gives back (game/edictum.html, bug run item 52). Cancelling a queued or half-built
// building, or abandoning its city, refunded today's price: the cabinet's cost bonus (70 to 100 per cent) could have
// changed since it was paid, so a cheap cabinet then a dear one paid out more than went in. The price paid is now kept
// on the building (p), a level being raised (lu.p) and walls going up (wu.p), and a cancel gives that back.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
function fn(name) {
  const at = html.indexOf('\nfunction ' + name + '(');
  if (at < 0) throw new Error('no function ' + name);
  let i = html.indexOf('{', at), depth = 0;
  for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}' && --depth === 0) break; }
  return html.slice(at + 1, i + 1);
}
const line = re => { const m = html.match(re); if (!m) throw new Error('no line ' + re); return m[0]; };
const copy = v => JSON.parse(JSON.stringify(v));

/* a nation with one city: a Farm (list price 10 timber, 8 goods) under way, a Sawmill queued behind it */
function city({ costK = 1, farmP, millP } = {}) {
  const ctx = vm.createContext({ toasts: [], commits: [] });
  vm.runInContext(`
    const RES=['food','timber','iron','oil','goods'],DAY=864e5;
    ${line(/const BUILDINGS=\{\n  farm:[^\n]*\n  sawmill:[^\n]*\n/)}};
    let K=${costK};const cabFx=n=>({cost:n&&n.name?K:1});this.setK=k=>{K=k;};
    ${fn('bCost')}
    ${fn('paidClean')}
    ${fn('bPaid')}
    ${line(/const CX_LV=[^\n]*/)}
    ${line(/const CX_WALL=[^\n]*/)}
    const CX_TRAITS={},clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),c3CleanName=v=>String(v);
    ${fn('cxUpList')}
    ${fn('cxWallList')}
    ${fn('cxBldExtras')}
    ${fn('cxCityExtras')}
    const now=Date.now(),farm={k:'farm',s:now-3600e3,d:now+3600e3},mill={k:'sawmill',s:now+3600e3,d:now+3*3600e3};
    ${farmP ? `farm.p=${JSON.stringify(farmP)};` : ''}${millP ? `mill.p=${JSON.stringify(millP)};` : ''}
    const S={nation:{name:'Builderland',loc:0,stock:{food:0,timber:0,iron:0,oil:0,goods:0},cities:[{id:'c1',c:5,nm:'Kiln',b:[farm,mill]}]}};
    const clone=v=>JSON.parse(JSON.stringify(v)),ensureCities=n=>n,stockNow=n=>({...n.stock}),stockLimit=(n,r,v)=>v,roundStock=s=>({...s});
    const c3Chain=()=>{},cityLabel=(n,c)=>c.nm,render=()=>{},toast=t=>toasts.push(t),commit=n=>{commits.push(n);S.nation=n;};
    ${fn('cancelBuild')}
    this.S=S;this.cancelBuild=cancelBuild;this.bPaid=bPaid;this.paidClean=paidClean;this.bCost=bCost;
    this.cxBldExtras=cxBldExtras;this.cxCityExtras=cxCityExtras;`, ctx);
  return ctx;
}

test('a queued building gives back what was paid for it, not today’s price', () => {
  const C = city({ millP: { food: 8, goods: 6 } });   // paid under a 70% cabinet; the list price is 12 food, 8 goods
  const list = copy(C.bCost(C.S.nation, 'sawmill'));
  assert.ok(list.food > 8, 'today’s price is dearer than what was paid');
  C.cancelBuild('c1', 'sawmill');
  assert.equal(C.S.nation.stock.food, 8);
  assert.equal(C.S.nation.stock.goods, 6);
  assert.match(C.toasts.at(-1), /All the materials were returned/);
});
test('a building under way gives back half of what was paid', () => {
  const C = city({ farmP: { timber: 7, goods: 6 } });
  C.cancelBuild('c1', 'farm');
  assert.equal(C.S.nation.stock.timber, 3);
  assert.equal(C.S.nation.stock.goods, 3);
});
test('work started before the price was kept still gets today’s price', () => {
  const C = city({ costK: 0.7 });
  const today = copy(C.bCost(C.S.nation, 'sawmill'));
  C.cancelBuild('c1', 'sawmill');
  for (const r of Object.keys(today)) assert.equal(C.S.nation.stock[r], today[r]);
});
test('a kept price is never more than the list price, and junk is dropped', () => {
  const C = city();
  const list = copy(C.bCost(null, 'farm'));
  assert.deepEqual(copy(C.paidClean({ timber: 9999, goods: 2.4, iron: 50, food: -3 }, list)), { timber: list.timber, goods: 2 });
  assert.equal(C.paidClean({ timber: 'ten' }, list), null);
  assert.equal(C.paidClean([5], list), null);
  assert.equal(C.paidClean(null, list), null);
  assert.deepEqual(copy(C.bPaid(C.S.nation, { k: 'farm', p: { timber: 1e9 } })), { timber: list.timber });
});
test('a level being raised and walls going up keep their price, capped at the list', () => {
  const C = city();
  const t = Date.now();
  const lu = C.cxBldExtras({ k: 'farm', lu: { l: 2, s: t, d: t + 3600e3, p: { timber: 11, goods: 999 } } }).lu;
  assert.equal(lu.p.timber, 11);
  assert.ok(lu.p.goods < 999 && lu.p.goods > 0, 'goods capped at the level’s list price');
  assert.equal(C.cxBldExtras({ k: 'farm', lu: { l: 2, s: t, d: t + 3600e3 } }).lu.p, undefined, 'none kept, none made up');
  const wu = C.cxCityExtras({ wu: { l: 1, s: t, d: t + 3600e3, p: { timber: 15, iron: 7 } } }).wu;
  assert.deepEqual(copy(wu.p), { timber: 15, iron: 7 });
});
test('the build, queue and quick-first-building paths keep the price, and the save keeps it while work is unfinished', () => {
  assert.match(fn('startBuild'), /c\.b\.push\(\{k:key,s:now,d:now\+ms,p:cost\}\)/);
  assert.match(fn('c3Queue'), /c\.b\.push\(\{k:key,s,d:s\+ms,p:cost\}\)/);
  assert.match(fn('ffbStart'), /c\.b\.push\(\{k:key,s:now,d:now\+FFB_MS,p:cost\}\)/);
  assert.match(fn('cxUpgrade'), /p:q\.cost\}/);
  assert.match(fn('cxWall'), /p:q\.cost\}/);
  assert.match(html, /if\(o\.d>Date\.now\(\)\)\{const p=paidClean\(b\.p,bCost\(null,b\.k\)\);if\(p\)o\.p=p;\}/);
  assert.match(fn('c3AbandonPlan'), /bPaid\(n,b\)/);
  assert.match(fn('cxUpCancel'), /e\.lu\.p\|\|/);
  assert.match(fn('cxWallCancel'), /e\.wu\.p\|\|/);
});
