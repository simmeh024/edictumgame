// The outfitters' tier II (2026-11-23): every track but the second team refits, once and for good, as one of three
// lines; five more blocks follow, dearer and slower; every purple and gold block is worth a land credit; the lines'
// small boosts; the Lost Atlas's five kinds of lost place; and Field Notes' credits as the server allows them.
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {rsFieldNotes, RS_FN_MAX} from '../functions/research-rules.js';

const source=readFileSync(new URL('../game/edictum.html',import.meta.url),'utf8');
const section=(a,b)=>{const s=source.indexOf(a),e=source.indexOf(b,s);assert.ok(s>0&&e>s,'section '+a);return source.slice(s,e);};
const line=a=>{const s=source.indexOf(a);assert.ok(s>0,a);return source.slice(s,source.indexOf('\n',s));};
const XUB=section('/* ── the outfitters: upgrades to the explorers\' kit','/* the blocks in words');
const WORDS=section('/* the blocks in words','function siteDefault(');
const LOSTK=section('const LOST_KINDS={','\n{\n');
const SEC=section('/* ───────── the outfitters, tier II (23 November 2026)','/* ───────── Round 11, K');
const CRED=section('/* the outfitters (2026-11-23): every purple and gold block','/* population marks');
const OUTCOME=section('const EXP_TABLE=','function resolveExp(');
const NORMX=section('NORM_HOOKS.push((n,d)=>{\n  if(d&&d.xu&&','\n/* why the next block of a track');
const PAID=line('function paidClean(p,max){');
const HASH=line('function hash(str){');

const DAY=864e5,NOW=Date.now(),J=v=>JSON.parse(JSON.stringify(v));
function game(){
  const NORM_HOOKS=[],COMMIT_HOOKS=[],EXP_MODS=[],HELP_EXT=[{k:'outfitters',body:()=>'<p>tier I</p>'}],COL_SETS=[],COL_ITEMS=[];
  const ctx=vm.createContext({NORM_HOOKS,COMMIT_HOOKS,EXP_MODS,HELP_EXT,COL_SETS,COL_ITEMS,COL_SET_BY_ID:{},COL_BY_ID:{},UNLOCKS:{},XP_IC:{},
    DAY,Math,Number,Object,String,Array,Set,Map,JSON,Date,RES:['food','timber','iron','oil','goods'],SITE_KINDS:{},BUILDINGS:{},
    clamp:(v,a,b)=>Math.min(b,Math.max(a,v)),list:a=>a.length<2?a.join(''):a.slice(0,-1).join(', ')+' and '+a[a.length-1],cap1:s=>s?s[0].toUpperCase()+s.slice(1):s,
    esc:v=>String(v),fmtDur:ms=>Math.round(ms/60000)+' min',colF:f=>f,xuDeskOk:()=>false,myId:()=>'me',alliancesOf:()=>[]});
  vm.runInContext([HASH,PAID,LOSTK,'Object.assign(SITE_KINDS,LOST_KINDS,LOST2_KINDS);',XUB,WORDS,CRED,OUTCOME,SEC,NORMX,
    'this.X={XU,XU_KEYS,XU_COL,XU_MUL,XU_H,xuCost,xuHours,xuLv,XU2,XU2_KEYS,XU2_UG,XU2_UH,XU2_REFIT_MUL,XU2_REFIT_H,XU_CR_MAX,xuLine,xu2Lv,xb,xu2Cost,xu2Hours,xuJobCost,xuJobName,xuSettle,xu2LvText,xu2NowText,xuDoneText,xuCredits,xuMapsLv,xuTimeK,xuReach,xuCostK,xuCurio,xuParty,xuGwK,xuGreatAt,xuFindK,xuWayK,xuCharm,xuFlK,xuAlmMs,expOutcome,LOST_KINDS,LOST_ORDER,LOST2_KINDS,LOST2_ORDER,XP_IC,xuPl};'].join('\n'),ctx);
  return {...ctx.X,NORM_HOOKS,COMMIT_HOOKS,EXP_MODS,HELP_EXT,COL_SETS,ctx};
}
const G=game();
/* a nation at gold on every track, refitted as the lines given, with b tier II blocks each */
const at=(lines={},b=0,extra={})=>{const xu={};for(const k of G.XU2_KEYS)xu[k]=5;const x2={};for(const k of Object.keys(lines))if(b)x2[k]=b;return {xu,xl:{...lines},x2,...extra};};

test('every track but the second team has a tier II of three lines, each named once, with words for every block',()=>{
  assert.deepEqual([...G.XU2_KEYS].sort(),G.XU_KEYS.filter(k=>k!=='team').sort());
  const names=new Set();let n=0;
  for(const k of G.XU2_KEYS){const T=G.XU2[k];assert.ok(T.n&&!names.has(T.n),k);names.add(T.n);
    assert.equal(Object.keys(T.lines).length,3,k+' has three lines');
    for(const [ln,L] of Object.entries(T.lines)){n++;assert.match(ln,/^[a-z]{2,8}$/);assert.ok(!names.has(L.n),L.n+' is named once');names.add(L.n);assert.match(L.s,/\.$/,L.n);
      for(let i=0;i<5;i++)assert.ok(G.xu2LvText(k,ln,i).length>5,`${L.n} block ${i}`);
      for(let b=1;b<=5;b++)assert.match(G.xu2NowText(k,ln,b),/\.$/,`${L.n} with ${b}`);}}
  assert.equal(n,21,'21 lines');
});

test('the refit costs three times the base and takes 12 hours; tier II blocks twice tier I, half as long again',()=>{
  for(const k of G.XU2_KEYS){const U=G.XU[k];
    assert.deepEqual({...G.xu2Cost(k,-1)},Object.fromEntries(Object.entries(U.base).map(([r,v])=>[r,Math.round(v*3)])),k+' refit');
    assert.equal(G.xu2Hours(k,-1),12);
    for(let i=0;i<5;i++){const one=G.xuCost(k,i),two=G.xu2Cost(k,i);for(const r in one)assert.ok(Math.abs(two[r]-2*one[r])<=1,`${k} ${i} ${r}: ${two[r]} vs ${one[r]}`);
      assert.equal(G.xu2Hours(k,i),G.xuHours(k,i)*1.5);}
    assert.ok(Object.values(G.xu2Cost(k,4)).every(v=>v<=400),'gold II fits a stockpile of 400');}
  assert.deepEqual({...G.xuJobCost({k:'gear',u:0,x:2,ln:'path'})},{...G.xu2Cost('gear',-1)});
  assert.deepEqual({...G.xuJobCost({k:'gear',u:3,x:2})},{...G.xu2Cost('gear',2)});
  assert.deepEqual({...G.xuJobCost({k:'gear',u:3})},{...G.xuCost('gear',2)});
});

test('a land credit for every purple and gold block, tier I and tier II: 28 in all',()=>{
  const c=n=>G.xuCredits(n);
  assert.equal(c({xu:{gear:3}}),0,'blue pays nothing');
  assert.equal(c({xu:{gear:4}}),1,'purple pays one');
  assert.equal(c({xu:{gear:5,mules:4}}),3);
  assert.equal(c({xu:{team:1}}),0,'the second team is one block, not a colour');
  assert.equal(c(at()),14,'gold everywhere');
  assert.equal(c(at({gear:'path'},3)),14,'blue II pays nothing more');
  assert.equal(c(at({gear:'path'},4)),15);
  assert.equal(c(at(Object.fromEntries(G.XU2_KEYS.map(k=>[k,Object.keys(G.XU2[k].lines)[0]])),5)),G.XU_CR_MAX);
  assert.equal(G.XU_CR_MAX,28);
  assert.equal(c({xu:{gear:5},x2:{gear:5}}),2,'tier II blocks without a line count nothing');
  assert.equal(c({xu:{gear:3},xuw:{k:'gear',u:4,s:NOW-2e3,d:NOW-1e3}}),1,'a block whose time is up counts');
  assert.equal(c({xu:{gear:3},xuw:{k:'gear',u:4,s:NOW,d:NOW+1e6}}),0,'one still in the workshop does not');
  assert.equal(c({xu:{gear:5},xl:{gear:'path'},x2:{gear:3},xuw:{k:'gear',u:4,x:2,s:NOW-2e3,d:NOW-1e3}}),3);
  assert.equal(c({npc:1,xu:{gear:5}}),0);
  // its own list of tracks (it runs before XU exists) is XU's
  assert.match(CRED,new RegExp(`const K=\\[${G.XU2_KEYS.map(k=>`'${k}'`).join(',')}\\]`));
});

test('the workshop: a refit writes the line, a tier II block its count, a tier I block as before',()=>{
  let n={xu:{gear:5},xuw:{k:'gear',u:0,x:2,ln:'envoy',s:NOW-2e3,d:NOW-1e3}};
  assert.equal(G.xuLine(n,'gear'),'envoy','a refit whose time is up counts before it is written');
  G.xuSettle(n,NOW);assert.equal(n.xl.gear,'envoy');assert.equal(n.xuw,undefined);assert.deepEqual({...n.xul},{k:'gear',u:0,t:NOW-1e3,x:2,ln:'envoy'});
  n.xuw={k:'gear',u:1,x:2,s:NOW-2e3,d:NOW-1e3};assert.equal(G.xu2Lv(n,'gear'),1);G.xuSettle(n,NOW);assert.equal(n.x2.gear,1);assert.equal(n.xu.gear,5,'tier I untouched');
  n.xuw={k:'mules',u:2,s:NOW-2e3,d:NOW-1e3};G.xuSettle(n,NOW);assert.equal(n.xu.mules,2);
  n.xuw={k:'mules',u:3,s:NOW,d:NOW+1e6};G.xuSettle(n,NOW);assert.ok(n.xuw,'a job still under way stays');
  assert.equal(G.xuLv({xu:{gear:2},xuw:{k:'gear',u:3,x:2,s:0,d:1}},'gear'),2,'a tier II job is not a tier I block');
  assert.equal(G.xb(n,'gear','envoy'),1);assert.equal(G.xb(n,'gear','path'),0,'another line has nothing');assert.equal(G.xb({xu:{gear:5}},'gear','envoy'),0);
  assert.match(G.xuJobName({k:'gear',u:0,x:2,ln:'survey'}),/refit of Trekking gear as Surveyors’ Kit/);
  assert.match(G.xuJobName({k:'gear',u:2,x:2},n),/^Envoys’ Kit, green II$/);
  assert.match(G.xuDoneText(n,{k:'gear',u:4,x:2}),/purple II.*land credit/);
  assert.doesNotMatch(G.xuDoneText(n,{k:'gear',u:2,x:2}),/land credit/);
  assert.match(G.xuDoneText(n,{k:'mules',u:5}),/gold.*land credit/);
});

test('loading keeps the lines, their blocks and a tier II job, and drops what does not fit',()=>{
  const load=d=>{const n={};for(const h of G.NORM_HOOKS)h(n,d);return n;};
  const n=load({xu:{gear:5},xl:{gear:'path',mules:'nope',swift:'out'},x2:{gear:9,swift:2,depots:3},xcr:5,
    xuw:{k:'gear',u:2,x:2,s:NOW,d:NOW+3600e3,p:{goods:9999,iron:10}},xul:{k:'swift',u:0,x:2,ln:'out',t:NOW}});
  assert.deepEqual({...n.xl},{gear:'path',swift:'out'});
  assert.deepEqual({...n.x2},{gear:5,swift:2},'blocks only for a line, never more than five');
  assert.equal(n.xcr,5);
  assert.deepEqual({...n.xuw,p:{...n.xuw.p}},{k:'gear',u:2,s:NOW,d:NOW+3600e3,x:2,p:{goods:G.xu2Cost('gear',1).goods,iron:10}},'paid no more than its price');
  assert.deepEqual({...n.xul},{k:'swift',u:0,t:NOW,x:2,ln:'out'});
  assert.deepEqual({...load({xuw:{k:'gear',u:0,x:2,ln:'envoy',s:NOW,d:NOW+12*3600e3}}).xuw},{k:'gear',u:0,s:NOW,d:NOW+12*3600e3,x:2,ln:'envoy'},'a refit');
  assert.equal(load({xuw:{k:'gear',u:0,x:2,ln:'bogus',s:NOW,d:NOW+1}}).xuw,undefined,'a refit to no line');
  assert.equal(load({xuw:{k:'team',u:1,x:2,s:NOW,d:NOW+1}}).xuw,undefined,'the second team has no tier II');
  assert.equal(load({xuw:{k:'gear',u:6,x:2,s:NOW,d:NOW+1}}).xuw,undefined);
});

test('the lines’ boosts: small, and on top of tier I',()=>{
  const one=(k,ln,b)=>at({[k]:ln},b);
  assert.equal(G.xuTimeK(at()),0.7);assert.equal(Math.round(G.xuTimeK(one('mules','camel',5))*100)/100,0.55,'Camel Trains: −45% in all');
  assert.equal(G.xuReach(at()),15);assert.equal(G.xuReach(one('depots','long',5)),25);assert.equal(G.xuReach(one('depots','allied',5)),20);
  assert.equal(Math.round(G.xuCostK(one('rations','hard',5))*100)/100,0.4,'Hardtack: −60% in all');
  assert.equal(Math.round(G.xuCurio(one('nat','coll',5))*100)/100,0.45);
  const P0=G.xuParty(at()),P1=G.xuParty(one('swift','out',5)),P2=G.xuParty(one('swift','turn',5));
  assert.equal(P0.t,0.8);assert.equal(Math.round(P1.t*100)/100,0.6);assert.equal(P0.cd,20*60000);assert.equal(P2.cd,10*60000);assert.equal(P2.roll,1);
  assert.equal(G.xuGwK(one('gear','envoy',5)),0);assert.equal(G.xuGwK(one('gear','envoy',2)),0.6);assert.equal(G.xuGwK(at()),1);
  assert.equal(G.xuGreatAt(one('gear','survey',4)),6);assert.equal(G.xuGreatAt(one('gear','survey',5)),5);
  const K={e:{sci:3},stock:{goods:30}},L={lost:1,e:{sci:3}};
  assert.deepEqual({...G.xuFindK(at(),K,'found')},{e:1,s:1});
  assert.deepEqual({...G.xuFindK(at(),K,'great')},{e:1.5,s:1.5});
  assert.deepEqual({...G.xuFindK(one('gear','survey',5),K,'great')},{e:2,s:2});
  assert.deepEqual({...G.xuFindK(one('maps','treas',5),L,'found')},{e:1.5,s:1.5});
  assert.deepEqual({...G.xuFindK(one('maps','treas',5),K,'found')},{e:1,s:1},'Treasure Maps: lost places only');
  assert.deepEqual({...G.xuFindK(one('nat','lect',5),K,'found')},{e:1.2,s:1});
  assert.deepEqual({...G.xuFindK(one('mules','packs',5),K,'found')},{e:1,s:1.25});
  assert.equal(G.xuWayK(one('depots','way',5),31),0.75);assert.equal(G.xuWayK(one('depots','way',5),30),1,'only past 30 hexes');
  assert.deepEqual({...G.xuFlK(at({mules:'ponies',rations:'pres'},5))},{m:1.2,h:1.25});
  assert.equal(G.xuAlmMs(one('maps','alm',3)),60*60000);
  assert.equal(G.xuMapsLv(one('maps','lost',2)),7);assert.equal(G.xuMapsLv(one('maps','alm',2)),5);
});

test('Lucky Charms: a low roll is rolled again from its own seed, and the better stands',()=>{
  const n3=at({swift:'charm'},3);
  assert.equal(G.xuCharm(at(),1,'s'),1,'nothing without the line');
  assert.equal(G.xuCharm(n3,4,'s'),4,'a 4 is past blue II');
  for(const seed of ['a','b','c','d','e','f']){const r=G.xuCharm(n3,2,seed);assert.ok(r>=2&&r<=20);assert.equal(G.xuCharm(n3,2,seed),r,'the same seed, the same roll');}
  assert.ok(['a','b','c','d','e','f','g','h'].some(seed=>G.xuCharm(n3,1,seed)>1),'a 1 is often more after all');
});

test('Pathfinders’ and Envoys’ Kits on an expedition’s roll; Surveyors’ Kit: 5 over is remarkable',()=>{
  const [hook]=G.EXP_MODS;G.ctx.SITES=[{c:0,k:'cove',lost:1},{c:1,k:'observatory',lost:1},{c:2,k:'falls'}];
  const T={byId:{me:0},owner:[1,-1,0]},one=(ln,b)=>at({gear:ln},b);
  assert.deepEqual(J(hook(one('path',1),0,T)),[['pathfinders’ kit',1]]);
  assert.deepEqual(J(hook(one('path',4),1,T)),[],'the observatory needs gold II');
  assert.deepEqual(J(hook(one('path',5),1,T)),[['pathfinders’ kit',1]]);
  assert.deepEqual(J(hook(one('envoy',2),0,T)),[],'below blue II the foreign soil costs its 2');
  assert.deepEqual(J(hook(one('envoy',3),0,T)),[['envoys’ kit',1]]);
  assert.deepEqual(J(hook(one('envoy',5),0,T)),[['envoys’ kit',2]]);
  assert.deepEqual(J(hook(one('envoy',5),2,T)),[],'not on its own land');
  assert.deepEqual(J(hook(one('path',5),-1,T)),[],'a fleeting party is no site');
  assert.equal(G.expOutcome({r:10,m:0,dc:5}),'found','5 over');
  assert.equal(G.expOutcome({r:10,m:0,dc:5,g:5}),'great','5 over, with the Surveyors’ Kit at gold II');
  assert.equal(G.expOutcome({r:10,m:0,dc:4}),'great','6 over, as always');
});

test('the Lost Atlas: five more kinds after the first five, harder, each with a glyph and a curio',()=>{
  assert.equal(G.LOST2_ORDER.length,5);
  G.LOST2_ORDER.forEach((k,i)=>{const K=G.LOST2_KINDS[k];assert.equal(K.lv,6+i);assert.equal(K.lost,1);assert.ok(K.dc>=16&&K.dc<=18);assert.ok(!G.LOST_KINDS[k],k+' is new');
    for(const b of K.b)assert.ok(['farmland','forest','marsh','arid','hills','mountain','polder','islet'].includes(b),k+' '+b);
    assert.ok(G.XP_IC[k],k+' has a glyph');assert.match(K.dn,/\{X\}/);});
  const set=G.COL_SETS.find(s=>s.id==='curios2');assert.ok(set);assert.deepEqual(J(set.items.map(i=>i.id)),J(G.LOST2_ORDER.map(k=>'xc-'+k)));
  assert.deepEqual(J(G.LOST2_ORDER.map(G.xuPl)),['whale graveyards','glass deserts','crater lakes','giants’ stairs','hermits’ libraries']);
  assert.match(G.xu2NowText('maps','lost',2),/whale graveyards and glass deserts/);
  assert.match(G.HELP_EXT[0].body({}),/Tier II[\s\S]*Land credits[\s\S]*Lost Atlas/);
});

test('the land credits are told once, back pay first',()=>{
  const hook=G.COMMIT_HOOKS[G.COMMIT_HOOKS.length-1],n=at();
  const a=hook(n,null,NOW);assert.equal(a.length,1);assert.match(a[0],/Land Office pays 14 land credits/);assert.equal(n.xcr,14);
  assert.deepEqual(J(hook(n,null,NOW)),[],'told once');
  n.xl={gear:'path'};n.x2={gear:4};const b=hook(n,null,NOW);assert.match(b[0],/^A land credit from the outfitters/);assert.equal(n.xcr,15);
});

test('Field Notes: the server allows as many credits as the line’s blocks for each first find a save adds',()=>{
  const rec=(b,disc,ln='notes')=>({xl:{nat:ln},x2:{nat:b},disc});
  const f=(s,t)=>({s,t,o:'found',f:1}),plain={s:9,t:1,o:'found'};
  assert.equal(rsFieldNotes(rec(3,[f(1,1),f(2,2)]),rec(3,[f(1,1)])),3,'one new first find, three blocks');
  assert.equal(rsFieldNotes(rec(3,[f(1,1),plain]),rec(3,[f(1,1)])),0,'a find somebody else made first is not one');
  assert.equal(rsFieldNotes(rec(2,[f(1,1),f(2,2)]),rec(2,[f(1,1)],'coll')),2,'the line is the saved one');
  assert.equal(rsFieldNotes(rec(3,[f(1,1),f(2,2)],'coll'),rec(3,[f(1,1)])),0,'another line');
  assert.equal(rsFieldNotes(rec(5,Array.from({length:10},(_,i)=>f(i,i))),rec(5,[])),5*RS_FN_MAX,'a few at most in one save');
  assert.equal(rsFieldNotes(rec(9,[f(1,1),f(2,2)]),rec(9,[f(1,1)])),5,'never more than five blocks');
  assert.equal(rsFieldNotes(rec(3,[]),rec(3,[f(1,1)])),0,'moving away loses nothing and gains nothing');
});
