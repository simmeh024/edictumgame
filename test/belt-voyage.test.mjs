// A choice on the Belt Expedition's voyage that costs stock (game/edictum.html, btEvChoose): it took what the stockpile
// held, even nothing, and its morale came anyway. It now needs the stock, and says what is missing.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
function fn(name) {
  const at = html.indexOf('\nfunction ' + name + '(');
  if (at < 0) return '';
  let i = html.indexOf('{', at), depth = 0;
  for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}' && --depth === 0) break; }
  return html.slice(at + 1, i + 1);
}
function voyage(stock) {
  const ctx = vm.createContext({ toasts: [], commits: [] });
  vm.runInContext(`
    const RES=['food','timber','iron','oil','goods'],resName=r=>r,list=a=>a.join(' and '),myId=()=>'me';
    ${fn('costText')}
    const S={nation:{name:'Shipland',stock:${JSON.stringify(stock)},belt:{v:0,ev:''}}};
    const stockNow=n=>({...n.stock}),roundStock=s=>({...s}),clone=v=>JSON.parse(JSON.stringify(v)),btRP=()=>0,applyEffects=()=>{};
    const btEvents=()=>[{i:0,t:0,end:Date.now()+864e5,c:null}];
    const btEvDef=()=>({t:'Out of tea',d:'',ch:[['Make do','Morale holds.',{}],['Ask home for an emergency shipment','30 goods from your stockpile. Morale rises.',{mo:1,st:{goods:30}}]]});
    const toast=t=>toasts.push(t),commit=n=>{commits.push(n);S.nation=n;};
    ${fn('btEvLack')}
    ${fn('btEvChoose')}
    this.choose=c=>btEvChoose(0,c);this.S=S;`, ctx);
  return ctx;
}

test('a choice the stockpile cannot pay for is refused, and says what is missing', () => {
  const V = voyage({ goods: 10 });
  assert.equal(V.choose(1), false);
  assert.equal(V.commits.length, 0, 'nothing changes');
  assert.match(V.toasts.at(-1), /needs 30 goods\. You have 10 goods/);
});
test('with the stock there, it is paid and chosen', () => {
  const V = voyage({ goods: 45 });
  assert.equal(V.choose(1), true);
  assert.equal(V.S.nation.stock.goods, 15);
  assert.equal(V.S.nation.belt.ev, '1');
});
test('a choice that costs nothing is always open', () => {
  const V = voyage({ goods: 0 });
  assert.equal(V.choose(0), true);
});
