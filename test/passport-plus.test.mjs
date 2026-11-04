// Passport endorsements, the reach of your own stamp, and the travel diary.
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import assert from 'node:assert/strict';

const source=readFileSync(new URL('../game/edictum.html',import.meta.url),'utf8');
function section(o={}){
  const start=source.indexOf('/* ───────── stamps that mean something'),end=source.indexOf("/* the cover's glint runs",start);
  assert.ok(start>0&&end>start);
  const hooks=[],world=o.world||{},nations=o.nations||[];
  const ctx=vm.createContext({S:{nation:null,mode:'remote',world},OBS:'',COMMIT_HOOKS:hooks,REGION:'Testland',
    liveDeals:n=>n.deals||[],sameAlliance:(a,b)=>(o.allies||[]).includes(b),myId:()=>'me',warWith:id=>({war:(o.wars||[]).includes(id)}),
    popNow:n=>n.pop,classify:s=>'Moderates',czText:(t,k)=>String(t||'').slice(0,k),esc:s=>String(s),fmtPop:p=>p+' million',
    findNation:id=>nations.find(x=>x.id===id)||null,allNations:()=>nations,ppHash:id=>'h'+id,
    ppClean:d=>({v:Object.fromEntries(Object.keys(d.v||{}).map(k=>[k,d.v[k].slice(0,10)]))}),ppSnap:e=>({nm:e[0]}),ppStampBody:()=>'BODY',
    ppBook:x=>x.n.pp,ppBookHTML:(x,st)=>`<div class="pp-book"><p class="hint pp-count">N</p>${st.info?'<div class="pp-info" role="status"><span>S</span><div><p class="pp-info-n">K</p><p class="hint">stamped</p></div></div>':''}</div>`});
  vm.runInContext(source.slice(start,end)+';this.T={ppClean:d=>ppClean(d),ppSnap:e=>ppSnap(e),ppStampBody:s=>ppStampBody(s),ppBookHTML:(x,st,c)=>ppBookHTML(x,st,c),PPR};',ctx);
  return {T:ctx.T,S:ctx.S,hooks};
}
const entry=()=>['Karvesk','meridian',1,'ps-circle','pb-single','pi-violet','','ADMITTED','','',];
const run=(hooks,n,old)=>{const m=[];for(const h of hooks){const r=h(n,old,1000);if(r)m.push(...r);}return m;};

test('relationships are endorsed on a stamp once, and never taken away',()=>{
  const k={id:'k',n:{name:'Karvesk',pop:12,leader:'Chairman',ruler:'Ivo',capital:'Steelgrad',s:{}}};
  const {hooks}=section({nations:[k],allies:['k']});
  const n={dm:[{w:'k',t:1,x:'hi'}],deals:[{w:'k'}],pp:{v:{k:entry()}}};
  const msgs=run(hooks,n,{pp:{v:{}}});
  assert.equal(n.pp.v.k[10],1|2|4,'trade, alliance and letters');
  assert.match(msgs[0],/trade visa and alliance seal and letters endorsement on the stamp of Karvesk/);
  assert.deepEqual([...n.pp.v.k[11]],[12,'Chairman Ivo','Moderates','Steelgrad'],'a new stamp keeps a note of the nation then');
  n.deals=[];n.dm=[];const again=run(hooks,n,structuredClone(n));
  assert.equal(n.pp.v.k[10],7,'a deal that ended keeps its visa');assert.equal(again.length,0);
});

test('the endorsements and the note survive cleaning, and only valid ones',()=>{
  const {T}=section();
  const e=entry();e[10]=8|32;e[11]=[5,'Queen','Moderates','Port'];
  const o=T.ppClean({v:{k:e,x:entry()}});
  assert.equal(o.v.k[10],8);assert.deepEqual([...o.v.k[11]],[5,'Queen','Moderates','Port']);assert.equal(o.v.x.length,10);
  const bad=entry();bad[11]=['x'];assert.equal(T.ppClean({v:{k:bad}}).v.k.length,10);
});

test('a stamp shows its endorsements, two at most',()=>{
  const {T}=section();const e=entry();e[10]=1|2|8;
  const s=T.ppSnap(e);assert.equal(s.rel,11);
  const h=T.ppStampBody(s);assert.ok(h.startsWith('BODY'));assert.match(h,/ALLIED/);assert.match(h,/BORDER CROSSED/);assert.doesNotMatch(h,/TRADE VISA/);
  assert.equal(T.ppStampBody({rel:0}),'BODY');
});

test('the passport says how many passports carry your stamp, and where it ranks',()=>{
  const world={a:{pph:['hme','hb']},b:{pph:['hme']},c:{pph:['hb']},d:{pph:['hb']}};
  const nations=[{id:'me',me:true,n:{name:'Mine'}},{id:'b',n:{name:'Bee'}},{id:'npc-x',npc:1,n:{name:'Computer'}}];
  const {T,S}=section({world,nations});S.nation={};
  const h=T.ppBookHTML({me:true,n:{pp:{v:{}}}},{},'p');
  assert.match(h,/Your stamp is in 2 passports<\/b> · 2nd most collected in Testland · most collected: Bee \(3\), Mine \(2\)/);
});

test('a chosen stamp shows its endorsements and the nation then beside now',()=>{
  const k={id:'k',n:{name:'Karvesk',pop:20,leader:'Chairman',ruler:'Ivo',capital:'Steelgrad',s:{}}};
  const {T,S}=section({nations:[k]});S.nation={};
  const e=entry();e[10]=4;e[11]=[12,'Chairman Olga','Moderates','Steelgrad'];
  const h=T.ppBookHTML({me:true,n:{pp:{v:{k:e}}}},{info:'k'},'p');
  assert.match(h,/✓ Letters endorsement/);assert.match(h,/Trade visa: make a trade deal/);assert.doesNotMatch(h,/Border crossed:/);
  assert.match(h,/<td>12 million<\/td><td>20 million<\/td>/);assert.match(h,/Chairman Olga<\/td><td>Chairman Ivo/);
  assert.ok(h.indexOf('pp-diary')<h.indexOf('</div></div>'),'inside the stamp panel');
});
