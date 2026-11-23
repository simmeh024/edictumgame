import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import assert from 'node:assert/strict';

const source=readFileSync(new URL('../game/edictum.html',import.meta.url),'utf8');
const begin=source.indexOf('/* ───────── material balance: the extra starting goods paid back'),end=source.indexOf('/* ───────── twelve fun achievements',begin);
assert.ok(begin>0&&end>begin);
const block=source.slice(begin,end),copy=v=>JSON.parse(JSON.stringify(v));
const NOW=1800000000000;
const nation=(goods=100,more={})=>({name:'Backpayland',founded:1,seed:'one',stock:{goods,food:60,timber:45,iron:25,oil:10},stockAt:NOW,...more});
function fixture(){
  const callbacks=[],c=vm.createContext({COMMIT_HOOKS:[],NORM_HOOKS:[],setInterval:f=>callbacks.push(f),
    num0:v=>Number.isFinite(v)?v:0,stockNow:n=>({...n.stock}),stockCap:n=>n.cap||400,roundStock:s=>({...s}),
    S:{nation:null},document:{hidden:false,activeElement:null},OBS:false,PV:null,tabPassive:false,regBlocked:()=>false,
    RCTRL:{ready:true},clone:copy,quietRender(){},commits:[]});
  vm.runInContext(block,c);
  c.commit=n=>{c.mbGoodsBackpay(n,c.S.nation,NOW);c.S.nation=n;c.commits.push(n);};
  return {c,pay:(n,old=copy(n))=>c.mbGoodsBackpay(n,old,NOW),
    reload:n=>{const d=copy(n),out=copy(d);delete out.mbg;for(const h of c.NORM_HOOKS)h(out,d);return out;},tick:()=>callbacks[0]()};
}
test('an existing nation receives 20 goods once, with a notice and preserved other stores',()=>{
  const {pay,reload}=fixture(),n=nation();
  const notices=pay(n);
  assert.equal(n.stock.goods,120);assert.equal(n.mbg,20);assert.equal(n.stock.food,60);
  assert.match(notices[0],/\+20 goods/);
  assert.equal(pay(n).length,0);assert.equal(n.stock.goods,120);
  const loaded=reload(n);assert.equal(loaded.mbg,20);assert.equal(pay(loaded).length,0);assert.equal(loaded.stock.goods,120);
});
test('new nations include the payment marker with their 60-goods starting stock',()=>{
  const a=source.indexOf('function found(){'),b=source.indexOf('\n/* From the front page',a);
  assert.match(source.slice(a,b),/mileAck:1,mbg:20,onb:/);
  const {pay}=fixture(),n=nation(60,{mbg:20});
  assert.equal(pay(n,null).length,0);assert.equal(n.stock.goods,60);
});
test('full and over-cap stores keep the payment due until room opens',()=>{
  const {pay,reload}=fixture();
  for(const goods of [400,450]){
    let n=nation(goods);assert.equal(pay(n).length,0);assert.equal(n.stock.goods,goods);assert.equal(n.mbg,0);
    n=reload(n);n.stock.goods=370;
    pay(n);assert.equal(n.stock.goods,390);assert.equal(n.mbg,20);
  }
});
test('partial room pays only what fits, with the remainder surviving a reload',()=>{
  const {pay,reload}=fixture();let n=nation(395);
  assert.match(pay(n)[0],/\+5 goods.*15 more/);assert.equal(n.stock.goods,400);assert.equal(n.mbg,5);
  n=reload(n);assert.equal(pay(n).length,0);
  n.stock.goods=390;pay(n);assert.equal(n.stock.goods,400);assert.equal(n.mbg,15);
  n=reload(n);n.stock.goods=390;pay(n);assert.equal(n.stock.goods,395);assert.equal(n.mbg,20);
});
test('a newer paid marker wins over a stale candidate, but does not carry into a re-founded nation',()=>{
  const {pay}=fixture(),old=nation(120,{mbg:20}),stale=nation(120);
  assert.equal(pay(stale,old).length,0);assert.equal(stale.mbg,20);assert.equal(stale.stock.goods,120);
  const fresh=nation(60,{founded:NOW,seed:'new',mbg:20});
  assert.equal(pay(fresh,old).length,0);assert.equal(fresh.stock.goods,60);
});
test('computer nations are not paid, and malformed markers cannot add a larger payment',()=>{
  const {pay,reload}=fixture(),npc=nation(100,{npc:true});assert.equal(pay(npc).length,0);assert.equal(npc.stock.goods,100);
  for(const mbg of [-5,.5,NaN,'20',{}]){const n=reload(nation(100,{mbg}));pay(n);assert.equal(n.stock.goods,120);assert.equal(n.mbg,20);}
  const n=reload(nation(100,{mbg:999}));assert.equal(n.mbg,20);assert.equal(pay(n).length,0);
});
test('opening the game pays automatically, while full, hidden and passive games do not save',()=>{
  const {c,tick}=fixture();c.S.nation=nation();tick();assert.equal(c.commits.length,1);assert.equal(c.S.nation.stock.goods,120);
  tick();assert.equal(c.commits.length,1);
  c.S.nation=nation(400);tick();assert.equal(c.commits.length,1);
  c.S.nation=nation();c.document.hidden=true;tick();assert.equal(c.commits.length,1);
  c.document.hidden=false;c.tabPassive=true;tick();assert.equal(c.commits.length,1);
});
test('two devices replay their player actions onto the winning payment without paying the gift twice',()=>{
  const from=source.indexOf('const ACT_SKIP='),to=source.indexOf('/* The account control lives in the Firebase adapter.');
  const g=new Function(`
    const RES=['goods','food','timber','iron','oil'],clone=v=>JSON.parse(JSON.stringify(v)),num0=v=>Number(v)||0;
    const OBS=false,PV=null,S={nation:null},COMMIT_HOOKS=[],NORM_HOOKS=[];
    let commitNo=0,carried=false;
    const roundStock=s=>({...s}),stockNow=n=>({...n.stock}),stockCap=()=>400,setInterval=()=>{};
    ${source.slice(from,to)}
    ${block}
    return {S,commit(n){actRecord(n);mbGoodsBackpay(n,S.nation,${NOW});S.nation=n;commitNo++;},rebase:rebaseActs};
  `)();
  g.S.nation=nation();
  const local=copy(g.S.nation);local.motto='Played here';g.commit(local);
  assert.equal(g.S.nation.stock.goods,120);
  const remote=nation(120,{mbg:20,updatedAt:2,capital:'Played elsewhere'}),r=g.rebase(remote);
  assert.ok(r);assert.equal(r.n.motto,'Played here');assert.equal(r.n.stock.goods,120);
  g.S.nation=remote;g.commit(r.n);assert.equal(g.S.nation.stock.goods,120);assert.equal(g.S.nation.mbg,20);
});
