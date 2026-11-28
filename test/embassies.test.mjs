// Embassies (2026-11-28): a mission in another nation, raised Outpost → Foreign Office → Embassy in stages like the
// Research Lab's laboratory; goodwill each day up to a cap; a computer nation's war read ahead of its six-hourly
// rolls; gifts that count more; stationery and finery kept for good. The game's own code, evaluated piece by piece.
// Run with: node --test test/embassies.test.mjs
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import assert from 'node:assert/strict';

const source=readFileSync(new URL('../game/edictum.html',import.meta.url),'utf8');
const cut=(from,to)=>{const a=source.indexOf(from),b=source.indexOf(to,a);assert(a>0&&b>a,`the game still has ${from}`);return source.slice(a,b);};
const line=start=>{const a=source.indexOf(start);assert(a>0,`the game still has ${start}`);return source.slice(a,source.indexOf('\n',a)+1);};
const DAY=864e5,HOUR=36e5,NOW=Date.UTC(2026,10,28,9,0);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const plain=v=>v===undefined?v:JSON.parse(JSON.stringify(v)),deq=(a,b,m)=>assert.deepEqual(plain(a),plain(b),m);

/* the game's affinity and armyPower read a nation's own figures: a row of allNations ({id, n, npc}) is not one */
const row=x=>{if(x&&x.n&&x.npc)throw new Error('a row of allNations, not a nation');};
function load(over={}){
  const ctx={DAY,clamp,RES:['food','timber','iron','oil','goods'],num0:v=>Number(v)||0,GF_GW:3,GF_GW_TOP:15,GW_MAX:40,
    S:{mode:'local',nation:null},TY:{ready:true},cellOf:()=>1,MAP:{N:0},myId:()=>'me',sameAlliance:()=>false,tyPeace:()=>false,wrShielded:()=>false,
    npcCounter:()=>null,canFeature:()=>true,affinity:x=>{row(x);return 20;},armyPower:x=>{row(x);return 1;},landName:()=>'a hex',placePhrase:()=>'nearby',dedupeConq:a=>a,npcPeaceWait:()=>DAY,
    gwOf:(n,id)=>Math.round(clamp(((n&&n.gw)||{})[id]||0,-40,40)),warWith:()=>({}),findNation:id=>({id,n:{name:id},npc:id.startsWith('npc-')}),
    territory:()=>ctx.T,geoProfile:()=>({nb:ctx.NB.map(id=>({id,e:1}))}),NB:['npc-vellmark'],
    T:{byId:{me:0,'npc-vellmark':1},occ:[],owner:[],orig:[],list:[{id:'me'},{id:'npc-vellmark'}]},
    NPC_NATIONS:[{id:'npc-vellmark',name:'Vellmark'}],...over};
  vm.createContext(ctx);
  vm.runInContext([line('function hash('),line('function rng('),
    cut('const NPC_HAWK=','/* ───────── land spent automatically'),
    cut('/* ── em: the rules ── */','/* ── em: the page ── */')
  ].join('\n')+'\nthis.EM_LV=EM_LV;this.EM_SEATS=EM_SEATS;this.EM_UNL=EM_UNL;this.WAR_SLOT=WAR_SLOT;',ctx);
  return ctx;
}
const G=load();

test('three levels: an Outpost in 3 stages, a Foreign Office in 4, a dear Embassy in 5',()=>{
  deq(G.EM_LV.slice(1).map(V=>[V.n,V.st.length]),[['Outpost',3],['Foreign Office',4],['Embassy',5]]);
  const t=[1,2,3].map(L=>G.emTotals(L)),sum=x=>Object.values(x.m).reduce((a,b)=>a+b,0);
  deq(t.map(x=>x.h),[10,30,60],'hours of works in all');
  deq(t.map(sum),[140,450,1310],'materials in all');
  assert(sum(t[2])>2.5*sum(t[1])&&sum(t[1])>2.5*sum(t[0]),'each level much dearer than the last');
  assert(t[2].m.oil>t[1].m.oil&&t[2].m.iron>t[1].m.iron,'the Embassy wants oil and iron too');
});

test('each level gives more: goodwill, its ceiling, warning time, a keener eye, gifts',()=>{
  const V=G.EM_LV.slice(1);
  for(const k of ['gw','cap','warn','gift'])assert(V[0][k]<=V[1][k]&&V[1][k]<=V[2][k],k+' grows');
  deq(V.map(v=>v.warn*6),[6,12,24],'hours of warning');
  assert(V[0].cool<V[1].cool&&V[1].cool<V[2].cool,'a cooling is seen sooner');
  deq(V.map(v=>v.mob),[0,0.25,0.1],'the army watched from the Foreign Office, more keenly at the Embassy');
});

test('the places grow with the people',()=>{
  deq([0.5,4.9,5,15,29,30,50,200].map(p=>G.emSeatsFor(p)),[1,1,2,3,3,4,5,5]);
  deq([0.5,5,49,50].map(p=>G.emNextSeat(p)),[5,15,50,0]);
});

test('stages, then levels: each stage needs its materials and its hours, and the last stage opens the level',()=>{
  const m={l:0,s:0,o:NOW};let t=NOW;const seen=[];
  for(let i=0;i<12;i++){
    const B=G.emStage(m);assert(B,'a stage to build');
    assert.equal(G.emAdvance(m,t),null,'nothing finishes before the works begin');
    m.g={...B.m};deq({...G.emNeed(B.m,m.g)},{},'everything delivered');
    m.u=t+B.h*HOUR;m.us=t;
    assert.equal(G.emAdvance(m,t+B.h*HOUR-1),null,'not a minute early');
    t+=B.h*HOUR;const a=G.emAdvance(m,t);seen.push(a.level);
    assert.equal(m.g,undefined,'the next stage starts empty');
  }
  deq(seen,[0,0,1,0,0,0,2,0,0,0,0,3]);
  assert.equal(m.l,3);assert.equal(G.emStage(m),null,'nothing more after the Embassy');
  assert.equal(t-NOW,100*HOUR,'100 hours of works from the first stone to the credentials');
});

test('goodwill each whole day, up to the level’s ceiling, never lowering what is there',()=>{
  const m={};
  assert.equal(G.emDrift(m,0,1,false,NOW),0,'the first save starts the count');
  assert.equal(m.dt,NOW);
  assert.equal(G.emDrift(m,0,1,false,NOW+DAY-1),0,'not before a whole day');
  assert.equal(G.emDrift(m,0,1,false,NOW+3*DAY+5),3,'three days at an Outpost: +3');
  assert.equal(m.dt,NOW+3*DAY,'the part day carries over');
  assert.equal(G.emDrift(m,6,1,false,NOW+13*DAY),2,'up to +8 at an Outpost');
  assert.equal(G.emDrift(m,12,1,false,NOW+20*DAY),0,'goodwill above the ceiling is left as it is');
  const e={dt:NOW};assert.equal(G.emDrift(e,0,3,true,NOW+2*DAY),8,'an Embassy with a mission in return: 4 a day');
  assert.equal(G.emDrift({dt:NOW},20,3,false,NOW+5*DAY),4,'to +24 at an Embassy');
});

test('gifts count more at a Foreign Office and an Embassy, up to a higher ceiling',()=>{
  const base=v=>v>=15?v:Math.min(15,v+3);
  assert.equal(G.emGiftGw(base(0),0,1),3,'an Outpost changes nothing');
  assert.equal(G.emGiftGw(base(0),0,2),4);assert.equal(G.emGiftGw(base(16),16,2),18,'past the usual 15');assert.equal(G.emGiftGw(base(19),19,2),19,'never lower');
  assert.equal(G.emGiftGw(base(0),0,3),5);assert.equal(G.emGiftGw(base(18),18,3),21);
  assert.equal(G.emGiftGw(25,19,3),25,'a better answer (a cultural union) is kept');
});

test('a computer nation’s war is seen ahead, and comes when the embassy said it would',()=>{
  const W=G.WAR_SLOT;let hits=0,quiet=0;
  for(let i=0;i<60;i++){
    const H=load(),now=NOW+i*7919e3,cur=Math.floor(now/W),x=H.NPC_NATIONS[0];
    const n={seed:'s'+i,founded:NOW-30*DAY,gw:{'npc-vellmark':-40},wck:cur,wars:{},peace:{},log:[],conq:[]};
    const f=H.emWarCast(n,x,4,now,H.emWarCtx(n));
    assert(f&&f.border&&f.p>0,'a hawk on the border with a grudge');
    if(f.hit){hits++;
      assert(f.hit.ts>now&&f.hit.ts<=now+4*W,'within 24 hours');
      const before=JSON.parse(JSON.stringify(n));H.npcWarTick(before,f.hit.ts-1);assert(!before.wars['npc-vellmark'],'not a moment before');
      H.npcWarTick(n,f.hit.ts);assert.equal(n.wars['npc-vellmark']&&n.wars['npc-vellmark'].t,f.hit.ts,'declared at the slot forecast');
      const g=H.emWarCast(before,{id:'npc-vellmark',n:x,npc:true},4,now,H.emWarCtx(before));assert.equal(g&&g.hit&&g.hit.ts,f.hit.ts,'the same from a row of allNations (the page passes those)');
    }else{quiet++;
      for(let t=now;t<=now+4*W;t+=W/2)H.npcWarTick(n,t);
      assert(!n.wars['npc-vellmark'],'no war when none was forecast');
    }
  }
  assert(hits>3&&quiet>3,`both cases seen (${hits} wars, ${quiet} quiet)`);
});

test('nothing is forecast where no war can come: a pact, an ally, no border, goodwill',()=>{
  const now=NOW,n={seed:'calm',founded:NOW-30*DAY,gw:{'npc-vellmark':-40},wck:Math.floor(now/G.WAR_SLOT)};
  assert.equal(load({tyPeace:()=>true}).emWarCast(n,{id:'npc-vellmark'},4,now,{mi:0,borders:new Set(['npc-vellmark']),holds:new Set()}).calm,true,'a non-aggression pact');
  assert.equal(load({sameAlliance:()=>true}).emWarCast(n,{id:'npc-vellmark'},4,now,{mi:0,borders:new Set(['npc-vellmark']),holds:new Set()}).calm,true,'allies');
  const H=load({NB:[]}),f=H.emWarCast(n,{id:'npc-vellmark'},4,now,H.emWarCtx(n));assert(!f.border&&!f.hit&&f.p===0,'no border, no war');
  const g=load({affinity:()=>50}),k={...n,gw:{'npc-vellmark':0}},h=g.emWarCast(k,{id:'npc-vellmark'},4,now,g.emWarCtx(k));
  assert(!h.hit&&h.p===0,'goodwill above −5, values close enough and no land held: no grudge');
});

test('what a level unlocks stays: the highest level reached, and three Embassies at once',()=>{
  assert.equal(G.emHi({ems:{a:{l:1},b:{l:2}}}),2);assert.equal(G.emHi({emh:3,ems:{a:{l:1}}}),3,'kept after the Embassy closed');
  assert.equal(G.emCorps({ems:{a:{l:3},b:{l:3},c:{l:2}}}),2);assert.equal(G.emCorps({em3:3}),3);
  const U=G.EM_UNL,pre={paper:'lp-',seal:'ls-',sign:'lg-',postmark:'lm-',card:'cd-',title:'t-',stamp:'s-'};
  assert.equal(new Set(U.map(u=>u[0])).size,U.length,'every id once');
  for(const [id,k] of U)assert(id.startsWith(pre[k]),`${id} is a ${k}`);
  for(const L of [1,2,3]){const ks=U.filter(u=>u[3]===L).map(u=>u[1]);assert(ks.includes('paper')&&ks.includes('seal'),`level ${L} has a letter paper and a seal`);}
  assert.equal(U.filter(u=>u[3]===3).length,6,'the Embassy unlocks the most');
});

test('the page is wired in: a tab after Treaties, its pane, the probe, and the war roll shared with the forecast',()=>{
  assert.match(source,/DP_TABS\.splice\(DP_TABS\.findIndex\(t=>t\[0\]==='treaties'\)\+1,0,\['embassies','Embassies'\]\)/);
  assert.match(source,/\.dp\[data-tab="embassies"\]>#dp-p-embassies\{display:block\}/);
  assert.match(source,/EMX:\(\)=>emProbe\(\)/);
  assert.match(cut('function npcWarTick(','/* ───────── land spent automatically'),/const p=npcWarP\(n,x,ts,borders,holds\);\n\s*if\(p>0&&roll<p\)\{/);
});
