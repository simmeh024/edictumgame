// The Bureau's plain parts (Intelligence): the named roster, heat, how long a caught agent is held, double agents,
// chatter, the departments, the Most Wanted board, a joint operation's share for the lender, a ransom paid, and the
// saved fields. The Bureau's section of game/edictum.html runs in a vm with the region's records stubbed.
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import assert from 'node:assert/strict';

const source=readFileSync(new URL('../game/edictum.html',import.meta.url),'utf8');
const section=(a,b)=>{const s=source.indexOf(a),e=source.indexOf(b,s);assert.ok(s>0&&e>s,'section '+a);return source.slice(s,e);};
const BLOCK=section('/* ───────── The Bureau:','\n/* ───────── round 9 (b): the Daily Dispatch');
const AGENTS=section('function agentsMax(','function spyParts(');
const ROLL=section('function cvRoll(','function cvAn(');
const HASH=source.match(/function hash\(str\)[^\n]+/)[0]+'\n'+source.match(/function rng\(seed\)[^\n]+/)[0];
const DAY=864e5,H=3600e3,NOW=1_800_000_000_000;
const plain=v=>JSON.parse(JSON.stringify(v));

function bureau({nation={},recs={},npcs=[],mode='multi',now=NOW}={}){
  const R=new Map(Object.entries(recs)),me='me';
  const S={nation:{name:'Home',demonym:'Homelander',seed:'7',founded:now-30*DAY,...nation},mode,ibAg:''};
  const hooks={COMMIT_HOOKS:[],NORM_HOOKS:[],NOTIF_SOURCES:[]};let B=null;
  const index=()=>{const out=[];for(const [id,d] of [[me,S.nation],...R])for(const op of d.cov||[]){const r=B.cvRoll(op);out.push({by:id,bn:d.name,bd:d.demonym||'Foreign',op,ok:r.ok,ex:r.ex,key:B.cvKey(id,op)});}return out.sort((a,b)=>b.op.t-a.op.t);};
  const ctx=vm.createContext({...hooks,HELP_EXT:[],UNLOCKS:{},achDef(){},document:{addEventListener(){}},
    S,REG:{id:'meridian'},DAY,AGENT_MS:30*60e3,Date:{now:()=>now},
    clamp:(v,a,b)=>Math.min(b,Math.max(a,v)),myId:()=>me,NPC_SET:new Set(npcs),
    findNation:id=>id===me?{id,n:S.nation,me:true}:R.has(id)?{id,n:R.get(id),npc:npcs.includes(id)}:null,
    allNations:()=>[{id:me,n:S.nation,me:true},...[...R].map(([id,n])=>({id,n,npc:npcs.includes(id)}))],
    cvIndex:()=>({all:index()}),cvDocs:()=>[[me,S.nation],...R],
    cvAgainst:(n,days)=>index().filter(e=>e.by!==me&&e.op.tg===me&&now-e.op.t<days*DAY),
    pol:n=>(n&&n.policies)||{},XU_MUL:[0.4,0.6,0.9,1.3,1.8],XU_H:[1,2,3,5,8],XU_COL:['grey','green','blue','purple','gold'],
    RES:['food','timber','iron','oil','goods'],GW_MAX:50,num0:v=>Number.isFinite(v)?v:0,stockLimit:(n,r,v)=>Math.min(v,400),
    applyEffects:(n,fx)=>{n.fx={...(n.fx||{}),...fx};},cvBump:(n,k)=>{n.tly={...(n.tly||{})};n.tly[k]=(n.tly[k]||0)+1;},
    resName:r=>r,cvNameOfK:k=>({s:'Plant a scandal',d:'Sabotage a trade deal',b:'Steal blueprints',m:'Bribe a minister',g:'Gather intelligence'})[k]||'Covert operation',
    list:a=>a.join(', '),BUILDINGS:{housing:{n:'Housing Estates'},diplo:{n:'Diplomata'}},PF:{fin:[0,0,'Finance Minister']},PF_KEYS:['fin'],paidClean:p=>p});
  vm.runInContext(HASH+'\n'+ROLL+'\n'+AGENTS+'\n'+BLOCK+'\nthis.B={agRoster,agLv,agPut,agReplace,agHeldUntil,agCaught,agFreeAt,agPick,heatOf,ibTurned,ibMoles,buLv,buGap,buRecruits,buHoldK,buAll,ibChatter,ibWanted,ibCaptives,iflClean,ibFileSet,agentsMax,agents,cvRoll,cvKey,cvSwayOdds,ibBldNote,HEAT_MAX,AG_HOLD,AG_RANSOM,AG_LEND};',ctx);
  B=ctx.B;
  return {...B,S,hooks,R,me};
}
/* an operation whose seeded roll comes out as wanted: {ok, ex} (either may be left out) */
function op(B,o,want={}){
  const x={id:'a',k:'s',tg:'me',t:NOW-H,rg:'meridian',p:0.5,x:0.5,...o};
  for(let i=0;i<5000;i++){x.id=(o.id||'op')+i.toString(36);const r=B.cvRoll(x);if((want.ok===undefined||r.ok===want.ok)&&(want.ex===undefined||r.ex===want.ex))return x;}
  throw new Error('no roll');
}

test('the roster: three named agents, more with a Foreign Intelligence Service and the recruitment office; no two share a codename',()=>{
  const B=bureau(),R=B.agRoster(B.S.nation);
  assert.equal(R.length,3);assert.equal(new Set(R.map(a=>a.nm)).size,3);assert.equal(new Set(R.map(a=>a.sp)).size,3,'different specialties');
  const R2=B.agRoster({...B.S.nation,policies:{spyAgency:true},bu:{recruit:5}});
  assert.equal(R2.length,7);assert.equal(new Set(R2.map(a=>a.nm)).size,7);assert.equal(new Set(R2.slice(0,4).map(a=>a.sp)).size,4,'the first four cover every specialty');
  assert.deepEqual(R.map(a=>a.nm),B.agRoster(B.S.nation).map(a=>a.nm),'the same seed, the same names');
  assert.deepEqual([0,2,3,7,8,14,15,24,25,999].map(B.agLv),[1,1,2,2,3,3,4,4,5,5]);
  assert.deepEqual([0,1,2,3,4,5].map(L=>B.agentsMax({bu:{recruit:L}})),[3,4,4,5,5,6]);
});

test('an agent is saved only where it differs from a fresh recruit; a new recruit has a new codename slot generation',()=>{
  const B=bureau(),n={};
  B.agPut(n,{i:1,g:0,x:0,r:NOW-1,h:0,l:0},NOW);assert.equal(n.ag,undefined);
  B.agPut(n,{i:1,g:2,x:5,r:NOW+1000,h:1,l:0},NOW);assert.deepEqual(plain(n.ag),[{i:1,g:2,x:5,r:NOW+1000,h:1}]);
  const a=B.agRoster(B.S.nation)[0],was=a.nm,m={};B.agReplace(m,a,NOW);
  assert.equal(a.g,1);assert.equal(a.x,0);assert.ok(a.r>NOW,'the recruit trains first');assert.deepEqual(plain(m.ag),[{i:0,g:1,r:a.r}]);assert.equal(typeof was,'string');
});

test('the saved fields are checked on load: slots, decisions, hunts, departments, files',()=>{
  const B=bureau(),out={};
  B.hooks.NORM_HOOKS.forEach(h=>h(out,{ag:[{i:1,x:4},{i:1,x:9},{i:40,x:2},{i:2,h:1,l:'yes'},null],
    cvC:[{k:'abc',by:'x',d:'t',t:5,ai:1},{k:'ABC!',by:'x',d:'t',t:5},{k:'abd',by:'x',d:'q',t:5}],mh:[{k:'home',t:1,ok:1,by:'x'},{k:'',t:1}],
    bu:{safe:9,nope:2},buw:{k:'forge',u:2,s:1,d:1+2*3600e3},ifl:{x:{t:1,nm:'X',s:{v:[1,2,3],t:1},a:{b:5,t:1},c:{t:1,m:[['fin','Ada',140],['nope','B',1]]}}}}));
  assert.deepEqual(plain(out.ag),[{i:1,x:4},{i:2,h:1}]);
  assert.deepEqual(plain(out.cvC),[{k:'abc',by:'x',ai:1,d:'t',t:5}]);assert.equal(out.mh.length,1);
  assert.deepEqual(plain(out.bu),{safe:5});assert.equal(out.buw.k,'forge');
  assert.equal(out.ifl.x.s,undefined,'a stockpile of the wrong length is dropped');assert.equal(out.ifl.x.a.b,5);assert.deepEqual(plain(out.ifl.x.c.m),[['fin','Ada',100]]);
});

test('heat: 25 an operation, 10 for gathering intelligence, 25 more if exposed, fading over four days',()=>{
  const B=bureau(),n=B.S.nation;
  n.cov=[op(B,{k:'s',tg:'x',t:NOW},{ex:false})];assert.equal(B.heatOf(n,'x',NOW),25);
  n.cov=[op(B,{k:'s',tg:'x',t:NOW},{ex:true})];assert.equal(B.heatOf(n,'x',NOW),50);
  n.cov=[op(B,{k:'g',tg:'x',t:NOW},{ex:false})];assert.equal(B.heatOf(n,'x',NOW),10);
  n.cov=[op(B,{k:'s',tg:'x',t:NOW-2*DAY},{ex:false})];assert.equal(B.heatOf(n,'x',NOW),13,'half gone after two days');
  n.cov=[op(B,{k:'s',tg:'x',t:NOW-4*DAY},{ex:true})];assert.equal(B.heatOf(n,'x',NOW),0);
  n.cov=[op(B,{k:'s',tg:'y',t:NOW},{ex:true}),op(B,{k:'s',tg:'x',t:NOW,rg:'wildwood'},{ex:true})];assert.equal(B.heatOf(n,'x',NOW),0,'other nations and regions do not count');
  n.cov=Array.from({length:4},(_,i)=>op(B,{id:'h'+i,k:'d',tg:'x',t:NOW-9*H},{ex:true}));assert.ok(B.heatOf(n,'x',NOW)>=B.HEAT_MAX,'four exposures in a day are too hot');
});

test('a caught agent is held 12 hours; the target may expel it sooner, or ask a ransom and hold it two days unless paid',()=>{
  const caught=op(bureau(),{k:'s',tg:'x',t:NOW-H,ai:1},{ex:true});
  const held=(dec,o={},n={})=>{const B=bureau({nation:{cov:[{...caught,...o}],...n},recs:{x:{name:'Vellmark',cov:[]}}});if(dec)B.R.get('x').cvC=[{k:B.cvKey('me',caught),by:'me',ai:1,...dec}];return B.agHeldUntil(B.S.nation,B.S.nation.cov[0],'me');};
  assert.equal(held(null),caught.t+12*H);
  assert.equal(held({d:'x',t:caught.t+2*H}),caught.t+2*H);
  assert.equal(held({d:'r',t:caught.t+H}),caught.t+48*H);
  assert.equal(held({d:'r',t:caught.t+H},{rs:caught.t+5*H}),caught.t+5*H,'a ransom paid sends it home');
  assert.equal(held({d:'t',t:caught.t+H}),caught.t+12*H,'a turned agent comes home as if nothing happened');
  assert.equal(held(null,{},{bu:{recruit:2}}),caught.t+9*H,'the recruitment office brings agents home sooner');
  assert.equal(held(null,{},{bu:{recruit:4}}),caught.t+6*H);
  const B=bureau({nation:{cov:[caught]},recs:{x:{name:'Vellmark'}}}),a=B.agRoster(B.S.nation)[1];
  assert.equal(B.agCaught(B.S.nation,a,NOW,'me').u,caught.t+12*H);assert.notEqual(B.agPick(B.S.nation,'s',NOW,1).i,1,'a held agent cannot be sent');
  assert.equal(B.agents(B.S.nation,NOW).r,2);
});

test('home duty and resting agents are not ready; the planner picks a suited agent first',()=>{
  const B=bureau({nation:{ag:[{i:0,h:1},{i:1,r:NOW+10*60e3}]}}),n=B.S.nation,R=B.agRoster(n);
  const a=B.agents(n,NOW);assert.equal(a.r,1);assert.equal(a.next,10*60e3);
  const B2=bureau(),R2=B2.agRoster(B2.S.nation);for(const k of ['s','b','m','g']){const p=B2.agPick(B2.S.nation,k,NOW),fit=R2.find(x=>({f:['s','c'],b:['b','d'],c:['m','v'],s:['w','g']})[x.sp].includes(k));if(fit)assert.equal(p.i,fit.i,k);}
  assert.equal(R.length,3);
});

test('a double agent: the target turned it, so the next operation against them is betrayed; a new recruit ends it',()=>{
  const B=bureau({recs:{x:{name:'Vellmark',cvC:[{k:'abc',by:'me',ai:2,d:'t',t:NOW-DAY}]}}}),R=B.agRoster(B.S.nation);
  assert.ok(B.ibTurned(R[2],'x',NOW));assert.equal(B.ibTurned(R[1],'x',NOW),null);assert.equal(B.ibTurned(R[2],'x',NOW+14*DAY),null,'two weeks at most');
  B.agReplace({},R[2],NOW);assert.equal(B.ibTurned(R[2],'x',NOW),null,'the recruit in the slot is clean');
  /* the captor's side: its mole in the other service, while that slot keeps the same agent */
  const C=bureau({nation:{cvC:[{k:'abc',by:'x',ai:2,d:'t',t:NOW-DAY}]},recs:{x:{name:'Vellmark',seed:'3'}}});
  assert.equal(C.ibMoles(C.S.nation,'x',NOW).length,1);C.R.get('x').ag=[{i:2,g:1}];assert.equal(C.ibMoles(C.S.nation,'x',NOW).length,0);
});

test('chatter: a rival’s operations against you that nobody noticed add up; exposed or traced ones do not',()=>{
  const ops=[0,1].map(i=>op(bureau(),{id:'c'+i,k:'s',tg:'me',t:NOW-H},{ex:false}));
  const B=bureau({recs:{x:{name:'Vellmark',cov:ops}}});
  assert.deepEqual(plain(B.ibChatter(B.S.nation,NOW).map(c=>[c.id,c.h])),[['x',49]]);
  B.S.nation.mh=[{k:B.cvKey('x',ops[0]),t:NOW,ok:1,by:'x'}];assert.equal(B.ibChatter(B.S.nation,NOW).length,0,'one traced: below 40');
  const E=bureau({recs:{x:{name:'Vellmark',cov:[0,1].map(i=>op(bureau(),{id:'e'+i,k:'s',tg:'me',t:NOW-H},{ex:true}))}}});assert.equal(E.ibChatter(E.S.nation,NOW).length,0);
  const L=bureau({mode:'local',recs:{x:{name:'Vellmark',cov:ops}}});assert.equal(L.ibChatter(L.S.nation,NOW).length,0);
});

test('captured agents: a player’s exposed agent is yours to decide on during its hold, a computer nation’s is not',()=>{
  const ex=op(bureau(),{k:'b',tg:'me',t:NOW-H,ai:0},{ex:true}),B=bureau({recs:{x:{name:'Vellmark',cov:[ex]},npc:{name:'Karvesk',cov:[{...ex,id:ex.id}]}},npcs:['npc']});
  const C=B.ibCaptives(B.S.nation,NOW);assert.equal(C.length,1);assert.equal(C[0].e.by,'x');assert.ok(C[0].open);assert.equal(C[0].until,ex.t+12*H);
  B.S.nation.cvC=[{k:C[0].e.key,by:'x',ai:0,d:'x',t:NOW}];assert.equal(B.ibCaptives(B.S.nation,NOW)[0].open,false);
  assert.equal(B.ibCaptives(B.S.nation,ex.t+13*H)[0].open,false);
});

test('the lender’s share of a joint operation lands once: its agent is busy, it gains, it shares the crates and the blame',()=>{
  const j=op(bureau(),{k:'d',tg:'z',tn:'Zarn',t:NOW-H,r:'iron',a:8,gn:6,jn:'me',ja:1},{ok:true,ex:true});
  const B=bureau({nation:{stock:{iron:10,goods:0},ag:[{i:1,l:1}]},recs:{x:{name:'Vellmark',cov:[j]}}}),hook=B.hooks.COMMIT_HOOKS[1],n=B.S.nation;
  const notes=hook(n,{},NOW);
  assert.equal(notes.length,1);assert.match(notes[0],/took part in Vellmark’s operation against Zarn/);assert.match(notes[0],/3 iron/);
  assert.equal(n.stock.iron,13);assert.equal(n.gw.z,-4);assert.equal(n.tly['cov:joint'],1);
  const a=B.agRoster(n).find(q=>q.i===1);assert.equal(a.r,j.t+B.AG_LEND);assert.equal(a.x,2);
  assert.equal(hook(n,{},NOW).length,0,'only once');assert.equal(n.stock.iron,13);
});

test('a ransom the agent’s service pays reaches the captor once',()=>{
  const ex=op(bureau(),{k:'m',tg:'me',t:NOW-H,ai:0},{ex:true});
  const B=bureau({nation:{stock:{goods:5}},recs:{x:{name:'Vellmark',cov:[ex]}}}),n=B.S.nation,key=B.cvKey('x',ex),hook=B.hooks.COMMIT_HOOKS[2];
  n.cvC=[{k:key,by:'x',ai:0,d:'r',t:NOW-H}];
  assert.equal(hook(n,{},NOW).length,0,'not paid yet');
  B.R.get('x').cov=[{...ex,rs:NOW-60e3}];
  assert.equal(hook(n,{},NOW).length,1);assert.equal(n.stock.goods,30);assert.equal(n.cvC[0].pd,1);
  assert.equal(hook(n,{},NOW).length,0);assert.equal(n.stock.goods,30);
});

test('the departments: blocks, a finished one counted before it is written, and what they do',()=>{
  const B=bureau();
  assert.equal(B.buLv({bu:{safe:2},buw:{k:'safe',u:3,s:NOW-2*H,d:NOW-1}},'safe',NOW),3);
  assert.equal(B.buLv({bu:{safe:2},buw:{k:'safe',u:3,s:NOW-H,d:NOW+H}},'safe',NOW),2);
  assert.deepEqual([0,1,2,3,4,5].map(L=>B.buGap({bu:{safe:L}})/H),[8,7.5,7,6.5,6,5]);
  assert.deepEqual([0,1,2,3,4,5].map(L=>B.buHoldK({bu:{recruit:L}})),[1,1,0.75,0.75,0.5,0.5]);
  assert.equal(B.buAll({bu:{safe:5,cover:2}}),7);
  assert.match(B.ibBldNote('housing'),/Safe houses green/);assert.match(B.ibBldNote('diplo'),/Diplomatic cover green/);assert.equal(B.ibBldNote('farm'),'');
  assert.deepEqual({...B.cvSwayOdds({bu:{cover:5}},{lv:5,sp:'c'})},{b:14,cv:10,p:59,x:30},'the server takes at most 14 and 10');
});

test('the Most Wanted board counts exposures and military captures in the last week',()=>{
  const ex=(id,t)=>op(bureau(),{id,k:'s',tg:'me',tn:'Home',t},{ex:true});
  const B=bureau({recs:{x:{name:'Vellmark',cov:[ex('a',NOW-H),ex('b',NOW-2*H)],log:[{k:'caught',t:NOW-3*H,b:'Home'}]},y:{name:'Zarn',cov:[ex('c',NOW-H)],log:[{k:'caught',t:NOW-8*DAY,b:'Home'}]}}});
  assert.deepEqual(plain(B.ibWanted(NOW).map(w=>[w.id,w.c])),[['x',3],['y',1]]);
});
