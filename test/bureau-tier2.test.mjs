// The bureau's tier II (2026-11-23): each of its six departments refits, once and for good, as one of two lines; five
// more blocks follow at four times the price; every purple and gold block is worth a land credit; and the lines' tiny
// boosts. The Bureau's section of game/edictum.html runs in a vm with the region's records stubbed, as in bureau.test.
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import assert from 'node:assert/strict';

const source=readFileSync(new URL('../game/edictum.html',import.meta.url),'utf8');
const section=(a,b)=>{const s=source.indexOf(a),e=source.indexOf(b,s);assert.ok(s>0&&e>s,'section '+a);return source.slice(s,e);};
const BLOCK=section('/* ───────── The Bureau:','\n/* ───────── round 9 (b): the Daily Dispatch');
const AGENTS=section('function agentsMax(','function spyParts(');
const ROLL=section('function cvRoll(','function cvAn(');
const CRED=section('/* the bureau (2026-11-23), likewise: every purple and gold block','/* population marks');
const HASH=source.match(/function hash\(str\)[^\n]+/)[0]+'\n'+source.match(/function rng\(seed\)[^\n]+/)[0];
const DAY=864e5,H=3600e3,NOW=1_800_000_000_000,J=v=>JSON.parse(JSON.stringify(v));

function bureau({nation={},now=NOW}={}){
  const me='me',S={nation:{name:'Home',seed:'7',founded:now-30*DAY,...nation},mode:'multi',ibAg:''};
  const hooks={COMMIT_HOOKS:[],NORM_HOOKS:[],NOTIF_SOURCES:[]},HELP_EXT=[];
  const ctx=vm.createContext({...hooks,HELP_EXT,UNLOCKS:{},achDef(){},document:{addEventListener(){}},
    S,REG:{id:'meridian'},DAY,AGENT_MS:30*60e3,Date:{now:()=>now},Math,Object,Number,String,Array,Set,Map,JSON,
    clamp:(v,a,b)=>Math.min(b,Math.max(a,v)),myId:()=>me,NPC_SET:new Set(),findNation:id=>id===me?{id,n:S.nation,me:true}:null,
    allNations:()=>[{id:me,n:S.nation,me:true}],cvIndex:()=>({all:[]}),cvDocs:()=>[[me,S.nation]],cvAgainst:()=>[],
    pol:n=>(n&&n.policies)||{},XU_MUL:[0.4,0.6,0.9,1.3,1.8],XU_H:[1,2,3,5,8],XU_COL:['grey','green','blue','purple','gold'],
    RES:['food','timber','iron','oil','goods'],GW_MAX:50,num0:v=>Number.isFinite(v)?v:0,stockLimit:(n,r,v)=>Math.min(v,400),
    applyEffects(){},cvBump(){},resName:r=>r,cvNameOfK:()=>'Covert operation',list:a=>a.join(', '),esc:v=>String(v),
    cap1:s=>s?s[0].toUpperCase()+s.slice(1):s,fmtDur:ms=>Math.round(ms/60000)+' min',
    BUILDINGS:{housing:{n:'Housing Estates'},diplo:{n:'Diplomata'}},PF:{fin:[0,0,'Finance Minister']},PF_KEYS:['fin'],
    paidClean:(p,max)=>{if(!p||!max)return null;const o={};for(const r in p)if(max[r])o[r]=Math.min(max[r],p[r]);return Object.keys(o).length?o:null;}});
  vm.runInContext(HASH+'\n'+ROLL+'\n'+AGENTS+'\n'+BLOCK+'\n'+CRED+'\nthis.B={BU,BU_KEYS,BU2,BU2_KEYS,BU2_UG,BU2_REFIT_H,BU_CR_MAX,SAFE_H,buLv,buCost,buLine,bu2Lv,bb,bu2Cost,bu2Hours,buJobCost,buJobName,buSettle,bu2LvText,bu2NowText,buDoneText,buGap,buGapWords,buHoldK,agRestMs,agRoster,heatOf,cvSwayOdds,ibTurnChance,mhChance,buCredits,buHeatK,buGwK};',ctx);
  return {...ctx.B,S,hooks,HELP_EXT};
}
const G=bureau();
/* gold in every department, refitted as the lines given, with b tier II blocks each */
const at=(lines={},b=0,extra={})=>{const bu={};for(const k of G.BU_KEYS)bu[k]=5;const bu2={};for(const k of Object.keys(lines))if(b)bu2[k]=b;return {bu,bln:{...lines},bu2,...extra};};
const one=(k,ln,b)=>at({[k]:ln},b);

test('every department has a tier II of two lines, each named once, with words for every block',()=>{
  assert.deepEqual(J(G.BU2_KEYS),J(G.BU_KEYS));
  const names=new Set();let n=0;
  for(const k of G.BU2_KEYS){const T=G.BU2[k];assert.ok(T.n&&!names.has(T.n));names.add(T.n);assert.equal(Object.keys(T.lines).length,2,k+' has two lines');
    for(const [ln,L] of Object.entries(T.lines)){n++;assert.match(ln,/^[a-z]{2,8}$/);assert.ok(!names.has(L.n),L.n);names.add(L.n);assert.match(L.s,/\.$/);
      for(let i=0;i<5;i++)assert.ok(G.bu2LvText(k,ln,i).length>5,`${L.n} ${i}`);assert.match(G.bu2NowText(k,ln,3),/\.$/);}}
  assert.equal(n,12);
});

test('four times as expensive: a tier II block four times its tier I block, the refit four times the gold block',()=>{
  for(const k of G.BU_KEYS){
    for(let i=0;i<5;i++){const a=G.buCost(k,i),b=G.bu2Cost(k,i);for(const r in a)assert.equal(b[r],4*a[r],`${k} ${i} ${r}`);assert.equal(G.bu2Hours(k,i),[1,2,3,5,8][i]*1.5);}
    assert.deepEqual(J(G.bu2Cost(k,-1)),J(G.bu2Cost(k,4)),k+': the refit costs what gold II does');assert.equal(G.bu2Hours(k,-1),12);
    assert.ok(Object.values(G.bu2Cost(k,4)).every(v=>v<=400),k+' fits a stockpile of 400');}
  assert.deepEqual(J(G.bu2Cost('safe',-1)),{timber:288,goods:144});
  assert.deepEqual(J(G.buJobCost({k:'safe',u:0,x:2,ln:'bolt'})),J(G.bu2Cost('safe',-1)));
  assert.deepEqual(J(G.buJobCost({k:'safe',u:2,x:2})),J(G.bu2Cost('safe',1)));
  assert.deepEqual(J(G.buJobCost({k:'safe',u:2})),J(G.buCost('safe',1)));
});

test('a land credit for every purple and gold block, tier I and tier II: 24 in all',()=>{
  const c=n=>G.buCredits(n);
  assert.equal(c({bu:{safe:3}}),0);assert.equal(c({bu:{safe:4}}),1);assert.equal(c(at()),12);
  assert.equal(c(one('safe','bolt',4)),13);
  assert.equal(c(at(Object.fromEntries(G.BU2_KEYS.map(k=>[k,Object.keys(G.BU2[k].lines)[0]])),5)),G.BU_CR_MAX);assert.equal(G.BU_CR_MAX,24);
  assert.equal(c({bu:{safe:5},bu2:{safe:5}}),2,'tier II blocks without a line count nothing');
  assert.equal(c({bu:{safe:3},buw:{k:'safe',u:4,s:NOW-2,d:Date.now()-1}}),1,'a block whose time is up counts');
  assert.equal(c({npc:1,bu:{safe:5}}),0);
  assert.match(CRED,new RegExp(`const K=\\[${G.BU_KEYS.map(k=>`'${k}'`).join(',')}\\]`),'its own list is BU’s');
  const hook=G.hooks.COMMIT_HOOKS[G.hooks.COMMIT_HOOKS.length-1],n={name:'Home',...at()};
  assert.match(hook(n,null,NOW)[0],/Land Office pays 12 land credits for the bureau/);assert.equal(n.bcr,12);
  assert.deepEqual(J(hook(n,null,NOW)),[],'told once');
});

test('training: a refit writes the line, a tier II block its count, a tier I block as before; loading keeps them',()=>{
  const n={bu:{safe:5},buw:{k:'safe',u:0,x:2,ln:'drops',s:NOW-2*H,d:NOW-1}};
  assert.equal(G.buLine(n,'safe',NOW),'drops');G.buSettle(n,NOW);assert.equal(n.bln.safe,'drops');assert.equal(n.buw,undefined);assert.deepEqual(J(n.bul),{k:'safe',u:0,t:NOW-1,x:2,ln:'drops'});
  n.buw={k:'safe',u:1,x:2,s:NOW-2*H,d:NOW-1};G.buSettle(n,NOW);assert.equal(n.bu2.safe,1);assert.equal(n.bu.safe,5);
  assert.equal(G.buLv({bu:{safe:2},buw:{k:'safe',u:3,x:2,s:0,d:1}},'safe',NOW),2,'a tier II job is no tier I block');
  assert.equal(G.bb(n,'safe','drops'),1);assert.equal(G.bb(n,'safe','bolt'),0);
  assert.match(G.buJobName({k:'safe',u:0,x:2,ln:'bolt'}),/refit of Safe houses as Bolt-holes/);
  assert.match(G.buDoneText(n,{k:'safe',u:4,x:2}),/Dead Drops, purple II.*land credit/);
  const load=d=>{const o={};for(const h of G.hooks.NORM_HOOKS)h(o,d);return o;};
  const m=load({bu:{safe:5},bln:{safe:'bolt',forge:'nope'},bu2:{safe:9,school:2},bcr:7,buw:{k:'safe',u:2,x:2,s:NOW,d:NOW+3*H,p:{timber:99999}}});
  assert.deepEqual(J(m.bln),{safe:'bolt'});assert.deepEqual(J(m.bu2),{safe:5});assert.equal(m.bcr,7);
  assert.deepEqual(J(m.buw),{k:'safe',u:2,s:NOW,d:NOW+3*H,x:2,p:{timber:G.bu2Cost('safe',1).timber}});
  assert.equal(load({buw:{k:'safe',u:0,x:2,ln:'bogus',s:NOW,d:NOW+1}}).buw,undefined);
});

test('the lines’ tiny boosts, on top of tier I',()=>{
  assert.equal(G.buGap(at()),5*H);assert.equal(G.buGap(one('safe','bolt',5)),5*H-50*60e3);
  assert.equal(G.buGapWords(at()),'5 hours');assert.equal(G.buGapWords(one('safe','bolt',1)),'4 hours 50 minutes');assert.equal(G.buGapWords({bu:{safe:1}}),'7.5 hours');
  assert.equal(G.buHeatK(one('safe','drops',5)),0.75);
  assert.equal(G.agRestMs(at()),15*60e3);assert.equal(G.agRestMs(one('school','instr',5)),9*60e3,'70% less in all');
  assert.equal(G.buHoldK(at()),0.5);assert.equal(G.buHoldK(one('recruit','reserve',5)),0.25);
  assert.equal(G.buGwK(one('cover','deny',5)),0.5);
  const sw0=G.cvSwayOdds(at(),null),sw1=G.cvSwayOdds(one('cover','att',5),null);assert.equal(sw1.x,sw0.x-5,'Attachés help a sway too');
  assert.equal(G.ibTurnChance(one('listen','mole',5))-G.ibTurnChance(at()),10);
  assert.equal(G.mhChance(one('listen','mole',5),null)-G.mhChance(at(),null),10);
  /* Headhunters: no agent below the line's blocks in experience; from blue II a fresh recruit is level 2 */
  const R=G.agRoster({seed:'7',...one('recruit','head',3)});assert.ok(R.every(a=>a.x>=3&&a.lv>=2));
  assert.ok(G.agRoster({seed:'7',...one('recruit','head',2)}).every(a=>a.lv===1));
  assert.deepEqual(J(G.agRoster({seed:'7',ag:[{i:0,x:9}],...one('recruit','head',5)}).map(a=>a.x)),[9,5,5,5,5,5],'more experience is kept');
});

test('the operations’ odds read the lines: masterclass, engravers, copy room, codebreakers, attachés; heat and goodwill',()=>{
  const odds=section('function cvOdds(','function cvCabOf(');
  assert.match(odds,/if\(ag\.lv>=3\)add\(ps,'the masterclass',bb\(me,'school','master'\)\);/);
  assert.match(odds,/if\(k==='s'\|\|k==='c'\)add\(ps,'your master engravers',bb\(me,'forge','engr'\)\);if\(k==='b'\|\|k==='d'\)add\(ps,'your copy room',bb\(me,'forge','copy'\)\);/);
  assert.match(odds,/add\(px,'their codebreakers',bb\(t,'listen','code'\)\);/,'the target’s Codebreakers, from its shared record');
  assert.match(odds,/add\(px,'your attachés',-bb\(me,'cover','att'\)\);/);
  assert.match(source,/return Math\.round\(h\*buHeatK\(rec\)\);/,'Dead Drops on heat');
  assert.match(source,/op\.gw=Math\.round\(\(k==='g'\?3:jn\?5:al\?12:8\)\*buGwK\(n\)\);/,'Plausible Deniability on an exposure');
  assert.equal(source.match(/one covert operation every \$\{buGapWords\(n\)\}/g).length,2,'the wait in words');
});

test('How to play tells of tier II and the credits',()=>{
  const h=G.HELP_EXT.find(x=>x.k==='bureau').body({});
  assert.match(h,/<b>Tier II\.<\/b> A department with all five blocks can be refitted to tier II as one of two lines/);
  assert.match(h,/Safe houses becomes Safe House Network \(Bolt-holes or Dead Drops\)/);
  assert.match(h,/<b>Land credits\.<\/b>.*24 in all/);
});
