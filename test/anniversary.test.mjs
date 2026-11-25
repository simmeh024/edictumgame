import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const event = fs.readFileSync(new URL('../src/anniversary.js', import.meta.url), 'utf8');
assert.ok(event.includes('/* One month of Edictum: five gifts'));

function game(request = async () => ({ ok: true })) {
  const code = `
    const S={nation:{name:'Testland',stock:{goods:10,food:20},cities:[{}]},mode:'world'};
    const NORM_HOOKS=[], UNLOCKS={}, EMBLEMS={}, CZ_EMBS=[], LP_X={}, UNLOCK_SOURCES=[];
    let czEmblemSVG=()=>'', museumView=()=>'<div class="mu-hall" data-hall="entrance">';
    const document={head:{appendChild(){}},body:{appendChild(){}},createElement(){return {querySelector(){return {focus(){}}},remove(){}}},getElementById(){return null},querySelector(){return null},addEventListener(){},hidden:false};
    const RealDate=globalThis.Date, now=RealDate.UTC(2026,10,27,12);
    const Date=class extends RealDate { static now(){return now} };
    const window={}, navigator={}, OBS=false, PV=false, tabPassive=false, RCTRL={ready:true};
    const shopReq=request, clone=x=>JSON.parse(JSON.stringify(x)), num0=x=>Number(x)||0, stockNow=n=>({...n.stock}), roundStock=x=>x, xsMark=()=>{};
    const commit=n=>{S.nation=n}, esc=x=>String(x), fullName=n=>n.name, achDef=()=>{}, achYes=x=>x, myId=()=>'', regBlocked=()=>false, m100Busy=()=>false, quietRender=()=>{}, setInterval=()=>{};
    ${event}
    return {S, ANN, annOpen, annBits, UNLOCK_SOURCES, NORM_HOOKS, museum:()=>museumView(now)};
  `;
  return new Function('request', code)(request);
}

test('five anniversary boxes unlock their gifts and preserve their state', async () => {
  let calls = 0;
  const g = game(async () => { calls++; return { ok: true }; });
  for (const i of [3, 1, 0, 4, 2]) await g.annOpen(i);
  assert.equal(g.annBits(g.S.nation), 31);
  assert.deepEqual(g.S.nation.stock, { goods: 60, food: 70 });
  assert.equal(calls, 1);
  await g.annOpen(1);
  await g.annOpen(4);
  assert.equal(calls, 1);
  assert.deepEqual(g.S.nation.stock, { goods: 60, food: 70 });
  assert.deepEqual(g.UNLOCK_SOURCES[0].earned(g.S.nation), ['e-firstmonth', 'lp-firstmonth', 'ls-firstmonth']);
  const saved = {}; g.NORM_HOOKS[0](saved, g.S.nation);
  assert.equal(saved.ann1, 31);
  assert.match(g.museum(), /Certificate of celebration/);
});

test('a failed Club claim remains unopened and can be retried', async () => {
  let calls = 0;
  const g = game(async () => { if (++calls === 1) throw new Error('offline'); return { ok: true }; });
  await g.annOpen(4);
  assert.equal(g.annBits(g.S.nation), 0);
  assert.equal(g.ANN.error, 'offline');
  await g.annOpen(4);
  assert.equal(g.annBits(g.S.nation), 16);
  assert.equal(calls, 2);
});
