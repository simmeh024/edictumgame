// Quiet tabs and quiet space records: what a background or untouched tab keeps listening to, and when a nation's
// space record (which every player in every region listens to) is written again. And a still page: what keeps it
// drawing while nobody moves (the tilt light, the passport glint); test/idle.mjs measures that in Chrome.
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {parse} from 'acorn';
import {test} from 'node:test';
import assert from 'node:assert/strict';

const shim=readFileSync(new URL('../src/shim.js',import.meta.url),'utf8'),game=readFileSync(new URL('../game/edictum.html',import.meta.url),'utf8');
const fns=new Map();
function walk(n){if(!n||typeof n!=='object')return;if(n.type==='FunctionDeclaration')fns.set(n.id.name,shim.slice(n.start,n.end));for(const [k,v] of Object.entries(n))if(k!=='start'&&k!=='end'){if(Array.isArray(v))v.forEach(walk);else if(v&&typeof v==='object')walk(v);}}
walk(parse(shim,{ecmaVersion:'latest'}));
const json=v=>JSON.parse(JSON.stringify(v));

/* ── the space record: written when what other regions read changes, not for the running figures ── */
function saver(space){
  const writes=[],A={admin:false,raceAt:{}};
  A.fs={doc:path=>({path}),runTransaction:async fn=>fn({get:async ref=>{const d=ref.path==='nations/player'?{reg:'meridian',rev:5}:ref.path==='space/player'?space:null;return {exists:!!d,data:()=>d};},
    set:(ref,data)=>writes.push({path:ref.path,data:json(data)}),delete:ref=>writes.push({path:ref.path,gone:true})})};
  const c=vm.createContext({A,MAX_JSON:700000,BOOT_AT:1,SPACE_MIN:12000,SPACE_BEAT:12*3600000,serverTime:()=>'now',num:v=>typeof v==='number'&&Number.isFinite(v)?v:0,
    str:(v,max)=>typeof v==='string'?v.slice(0,max):'',isObj:v=>!!v&&typeof v==='object'&&!Array.isArray(v),parse:s=>{try{return JSON.parse(s);}catch(e){return null;}},millis:v=>v,mapError:e=>e,
    call:async(name,d)=>({...d.record,permit:'test-permit'}),setTimeout:()=>{},window:{dispatchEvent(){}},Event:class{},recoveryCheck:()=>{},splitNation:d=>[d,{}],activeUntil:(d,t)=>t,raceKeys:()=>[]});
  vm.runInContext(shim.match(/var SPACE_RUN = [^;]*;/)[0]+'\n'+['encode','revision','spaceText','sorted','spaceLayout','saveNation'].map(n=>fns.get(n)).join('\n'),c);
  return {c,writes,space:()=>writes.find(w=>w.path==='space/player')};
}
const T0=Date.UTC(2026,5,1);
const nation=(sp,more={})=>({name:'Orbitland',reg:'meridian',updatedAt:T0+9e6,pop:50,claims:[],_rev:5,flag:{c:['#112233','#445566','#778899']},pretitle:'Republic',mapc:'#123456',sp,...more});
const moon=more=>({t:T0,c:120,k:'0:12.5:3',b:'hd1a.0.k',p:0.5,pa:T0+3e6,e:2.25,ml:[0,0,0],nm:'Alder Base',...more});
const belt=more=>({v:T0,d:1,st:4,sa:T0+5e6,m:'1.2.3',hw:T0+6e6,rp:12.5,ra:T0+6e6,...more});
/* the record the server holds: as the last save wrote it, that long ago */
async function save(before,after,ago=60000){
  const s=saver(null),old=s.c.spaceText(before);
  const t=saver({reg:'meridian',name:before.name,t:before.updatedAt,j:old,ts:Date.now()-ago});await t.c.saveNation('player',after);return t.space();
}

test('a space record compares without the running figures re-stamped at every save',()=>{
  const {c}=saver(null),a=c.spaceText(nation({moon:moon(),tf:0.2}),{}),b=c.spaceText(nation({moon:moon({p:0.71,pa:T0+8e6,e:3.5}),tf:0.2}));
  assert.notEqual(a,b);assert.equal(c.spaceLayout(a),c.spaceLayout(b));
  assert.equal(c.spaceLayout(c.spaceText(nation(null,{belt:belt()}))),c.spaceLayout(c.spaceText(nation(null,{belt:belt({hw:T0+8e6,rp:40,ra:T0+8e6})}))));
  /* what a viewer cannot work out for itself stays: milestones, the terraforming level, the colony's tiles and buildings */
  for(const x of [moon({ml:[T0+7e6,0,0]}),moon({k:'0:12.5:3.4:1'}),moon({b:'hd1a.0.k,rs2b.3.c'}),moon({nm:'Port Moon'})])
    assert.notEqual(c.spaceLayout(c.spaceText(nation({moon:x}))),c.spaceLayout(a));
  assert.notEqual(c.spaceLayout(c.spaceText(nation({moon:moon(),tf:0.2001}))),c.spaceLayout(a));
  assert.notEqual(c.spaceLayout(c.spaceText(nation(null,{belt:belt({m:'1.2.3,4.5.6'})}))),c.spaceLayout(c.spaceText(nation(null,{belt:belt()}))));
  /* the same record in another key order (read back from storage) is the same record; an unreadable one is not */
  assert.equal(c.spaceLayout(JSON.stringify({pretitle:'R',sp:{moon:{nm:'X',t:1}}})),c.spaceLayout(JSON.stringify({sp:{moon:{t:1,nm:'X'}},pretitle:'R'})));
  assert.equal(c.spaceLayout('{oops'),'');
});

test('a save that only moved the running figures leaves the space record alone',async()=>{
  const before=nation({moon:moon()},{belt:belt()}),after=nation({moon:moon({p:0.62,pa:T0+8e6,e:3.1})},{belt:belt({hw:T0+8e6}),updatedAt:T0+8e6});
  assert.equal(await save(before,after),undefined);
});

test('the space record is written for a new tile, building, milestone, terraforming level, name or belt mission',async()=>{
  const before=nation({moon:moon(),tf:0.3},{belt:belt()});
  for(const after of [nation({moon:moon({k:'0:12.5:3.4:1'}),tf:0.3},{belt:belt()}),nation({moon:moon({b:'hd1a.0.k,rs2b.3.c'}),tf:0.3},{belt:belt()}),
    nation({moon:moon({ml:[T0+7e6,0,0],p:1.01,pa:T0+7e6}),tf:0.3},{belt:belt()}),nation({moon:moon(),tf:0.3001},{belt:belt()}),
    nation({moon:moon(),tf:0.3},{belt:belt(),name:'Orbitland Two'}),nation({moon:moon(),tf:0.3},{belt:belt({m:'1.2.3,4.5.6'})})]){
    const w=await save(before,after);assert.ok(w,'written');assert.equal(w.data.j,saver(null).c.spaceText(after));
  }
});

test('an unchanged space record is still written every SPACE_BEAT, and a change waits out SPACE_MIN',async()=>{
  const before=nation({moon:moon()}),moved=nation({moon:moon({p:0.9,pa:T0+8e6})}),grown=nation({moon:moon({k:'0:12.5:3.4:1'})});
  assert.ok(await save(before,moved,12*3600000+1000));
  assert.equal(await save(before,grown,5000),undefined);
  assert.ok(await save(before,grown,13000));
});

test('a nation that left space has its space record removed',async()=>{
  const t=saver({reg:'meridian',name:'Orbitland',t:T0,j:'{}',ts:Date.now()-60000});await t.c.saveNation('player',nation(null));
  assert.equal(t.space().gone,true);
});

/* ── a colony's people: a viewer carrying an older starting point forward sees what one carrying the latest sees ── */
function colonyMath(){
  const pick=(a,b)=>{const i=game.indexOf(a),j=game.indexOf(b,i);assert.ok(i>0&&j>i,a);return game.slice(i,j);};
  const fn=name=>{const i=game.indexOf('function '+name+'(');assert.ok(i>0,name);let k=game.indexOf('{',i),d=0;for(;k<game.length;k++){if(game[k]==='{')d++;else if(game[k]==='}'&&!--d)break;}return game.slice(i,k+1);};
  const c=vm.createContext({Math,DAY:864e5,spT:(B,x)=>x%(B.id==='moon'?8:11)});
  vm.runInContext([pick('const SP_BLDS={','/* ── the claims string'),fn('logistic'),fn('spState'),fn('spSteps'),fn('spRun')].join('\n'),c);
  return c;
}
test('carrying a colony forward from an older save gives the people a save at every commit would',()=>{
  const c=colonyMath(),H=36e5,D=24*H,scale=Number(game.match(/o\.p=Math\.round\(r\.P\*(1e\d+)\)\/\1;/)[1]);
  for(const [id,tf] of [['moon',0],['mars',0.35]]){
    const cells=[1,2,3,4,5,6,7,8,9,10,11,12],ct=cells.map((x,i)=>T0+(i?i*7*H:0)),blds=id==='moon'?[{k:'hd',c:2,d:T0+20*H},{k:'im',c:6,d:T0+3*D},{k:'sa',c:3,d:T0+4*D}]:[{k:'pt',c:2,d:T0+22*H},{k:'gf',c:9,d:T0+2*D},{k:'iq',c:7,d:T0+5*D}];
    const col=(o)=>({B:{id},t:T0,c:1,cells,ct,blds,p:o.p,pa:o.pa,e:o.e,tf});
    /* a busy owner's commits (one every one to three minutes, twelve hours a day), each starting the colony again
       from what the last one worked out, as the commit hook does; a viewer elsewhere keeps the landing's figures */
    let o={p:0.005,pa:T0,e:1};const first={...o};let worst=0;
    for(let t=T0+60000,i=0;t<T0+9*D;i++){t+=((t-T0)%D<12*H?1+i%3:60+i%200)*60000;
      const r=c.spRun(col(o),t,0.2);o={p:Math.round(r.P*scale)/scale,pa:t,e:Math.round(r.E*1000)/1000};
      if(i%5===0)for(const at of [t+1,t+40*60000,t+5*H])worst=Math.max(worst,Math.abs(c.spRun(col(o),at).P-c.spRun(col(first),at).P)*1e6);
    }
    assert.ok(worst<0.01,id+': '+worst+' people apart');
  }
});

/* ── quiet tabs: the listeners go after a while in the background or untouched, and come back with the player ── */
function quiet({hidden=false}={}){
  const i=game.indexOf('/* ───────── quiet tabs'),j=game.indexOf('/* ───────── shared region',i);assert.ok(i>0&&j>i);
  let now=1e12,hid=hidden;const doc={get hidden(){return hid;},listeners:{},addEventListener(t,f){(this.listeners[t]=this.listeners[t]||[]).push(f);}};
  const win={listeners:{},addEventListener(t,f){(this.listeners[t]=this.listeners[t]||[]).push(f);}},timers=[],intervals=[],log=[];
  const ctx=vm.createContext({window:win,document:doc,S:{nation:{name:'Quietland'},view:'nation'},Date:{now:()=>now},Math,Number,
    setInterval:f=>intervals.push(f),setTimeout:(f,ms)=>timers.push({f,at:now+ms}),
    render:()=>log.push('render'),tick:()=>log.push('tick'),updateMapPanel:()=>log.push('panel'),redrawMaps:()=>log.push('maps'),updateFoundLife:()=>{}});
  vm.runInContext(game.slice(i,j)+'\nthis.Q={QUIET,quietListen,quietRender};',ctx);
  /* a query that records who listens, and lets the test send snapshots */
  const q=name=>({on:0,off:0,cb:null,onSnapshot(next){this.on++;this.cb=next;return ()=>{this.off++;this.cb=null;};}});
  const api={ctx,log,doc,q,Q:ctx.Q,
    pass(ms){now+=ms;for(const f of intervals)f();for(const t of timers.splice(0))if(t.at<=now)t.f();else timers.push(t);},
    show(h){hid=h;for(const f of doc.listeners.visibilitychange||[])f();},
    touch(t='pointermove'){for(const f of win.listeners[t]||[])f();}};
  return api;
}
test('a background tab lets go of its listeners after QUIET_HIDDEN and takes them up again on return',()=>{
  const T=quiet(),qs=[T.q('nations'),T.q('space'),T.q('board')],got=[];
  qs.forEach((q,k)=>T.Q.quietListen(q,s=>got.push([k,s.v])));
  assert.deepEqual(qs.map(q=>q.on),[1,1,1]);
  T.show(true);T.pass(120000);assert.deepEqual(qs.map(q=>q.off),[0,0,0]);
  T.pass(80000);assert.deepEqual(qs.map(q=>q.off),[1,1,1]);
  T.show(false);assert.deepEqual(qs.map(q=>q.on),[2,2,2]);
  /* this browser's copy is what the page shows already; the server's first word is taken */
  qs[0].cb({fromCache:true,v:'cached'});qs[0].cb({fromCache:false,v:'fresh'});qs[0].cb({fromCache:true,v:'offline later'});
  assert.deepEqual(got,[[0,'fresh'],[0,'offline later']]);
});
test('an untouched tab in front goes quiet after QUIET_IDLE and wakes at the first touch, without a tick',()=>{
  const T=quiet(),q=T.q('nations');T.Q.quietListen(q,()=>{});
  T.pass(300000);T.touch('keydown');T.pass(500000);assert.equal(q.off,0);
  T.pass(120000);assert.equal(q.off,1);
  T.touch();assert.equal(q.on,2);assert.deepEqual(T.log,[]);
});
test('a background tab draws nothing for a snapshot; one tick and one drawing on return',()=>{
  const T=quiet();T.show(true);T.Q.quietRender();T.Q.quietRender();assert.deepEqual(T.log,[]);
  T.show(false);assert.deepEqual(T.log,['tick','render']);
  T.log.length=0;T.show(true);T.show(false);assert.deepEqual(T.log,['tick'],'nothing owed: no drawing');
});
test('on return the drawing owed waits for the listeners to report, and is skipped once they have drawn',()=>{
  const T=quiet(),q=T.q('nations');T.Q.quietListen(q,()=>T.Q.quietRender());
  T.show(true);q.cb({v:1});T.pass(200000);assert.equal(q.off,1);
  T.show(false);assert.deepEqual(T.log,['tick']);
  q.cb({fromCache:false});T.pass(2000);assert.deepEqual(T.log,['tick','render'],'one drawing, from the fresh snapshot');
  T.log.length=0;T.show(true);q.cb({v:2});T.pass(200000);T.show(false);T.pass(2000);
  assert.deepEqual(T.log,['tick','render'],'nothing new from the server: the drawing owed is made');
});

/* ── a still page: the identity foil's tilt light and the passport cover's glint keep the page busy only while
   something moves ── */
function tilt(){
  const fn=name=>{const i=game.indexOf('function '+name+'(');assert.ok(i>0,name);let k=game.indexOf('{',i),d=0;for(;k<game.length;k++){if(game[k]==='{')d++;else if(game[k]==='}'&&!--d)break;}return game.slice(i,k+1);};
  let now=0;const heard=new Set(),kicks=[];
  const ctx=vm.createContext({Math,performance:{now:()=>now},clamp:(v,a,b)=>Math.max(a,Math.min(b,v)),idTiltFree:()=>true,idKick:()=>kicks.push(now),
    window:{addEventListener:(t,f)=>heard.add(f),removeEventListener:(t,f)=>heard.delete(f)},
    ID:{src:'',tx:.5,ty:.5,b0:null,fb:0,fg:0,om:0,ot:0,zz:false,ori:false,still:false,tiltOK:true,vis:new Set([{}])}});
  vm.runInContext(['idOrient','idOriSync','idOriSleep','idOriWake'].map(fn).join('\n'),ctx);
  ctx.idOriSync();
  /* the sensor at 60 Hz for ms, the tilt given as a function of the time */
  const feed=(ms,f)=>{for(const end=now+ms;now<end;now+=1000/60){const [beta,gamma]=f(now);for(const h of heard)h({beta,gamma});}};
  return {ctx,ID:ctx.ID,heard,kicks,feed};
}
test('a phone held still: its tremble does not move the light, and after ten seconds the page stops listening',()=>{
  const T=tilt();T.feed(2000,()=>[40,0]);const k=T.kicks.length;
  T.feed(5000,t=>[40+.8*Math.sin(t/37),.8*Math.cos(t/29)]);
  assert.equal(T.kicks.length,k,'a degree of tremble is under the dead band');
  T.feed(6000,()=>[40,0]);
  assert.equal(T.heard.size,0,'ten seconds without a real move');assert.equal(T.ID.ori,false);
  T.ctx.idOriWake();assert.equal(T.heard.size,1,'a touch or a scroll listens again');
});
test('a phone turned on purpose moves the light, at most thirty times a second',()=>{
  const T=tilt();T.feed(1000,()=>[40,0]);const k=T.kicks.length;
  T.feed(1000,t=>[40,(t-1000)/1000*45-20]);
  const moves=T.kicks.length-k;assert.ok(moves>=20&&moves<=31,moves+' moves in a second');
  assert.ok(T.ID.tx>.85,'the light follows the turn: '+T.ID.tx);
});
test('the passport glint runs a few passes while its cover is on screen, never for as long as the page is open',()=>{
  const css=game.slice(0,game.indexOf('</style>'));
  assert.doesNotMatch(css,/animation:ppGlint[^;}]*infinite/);
  assert.match(css,/\.pp-gl\.run \.pp-glint\{animation:ppGlint 7s ease-in-out 3\}/);
  assert.match(game,/<svg class="pp-gl" viewBox="0 0 300 420" aria-hidden="true"><g mask="url\(#\$\{id\}k\)"><rect class="pp-glint"/);
});
