import {test} from 'node:test';
import assert from 'node:assert/strict';
import DATA from '../functions/civic-data.json' with {type:'json'};
import {assemblyEngine} from '../functions/assembly-engine.js';
import {cabinetAffinity} from '../functions/affinity.js';
const now=Date.now(),DAY=86400000;
const record=(id,more={})=>({id,n:{name:id,reg:'meridian',founded:now-3*DAY,civicAt:now-2*DAY,s:{civil:50,econ:50,pol:50},asm:{r:'meridian',e:[],s:[],v:[]},...more}});
test('Guest and young nations cannot gain votes or leadership through forged nation history',()=>{
 const g=record('guest',{civicAt:0}),r=record('young',{civicAt:now+DAY});
 g.n.asm.e=[{i:'young',t:now-1000}];r.n.asm.e=[{i:'guest',t:now-1000}];
 const st=assemblyEngine('meridian',[g,r]).state(now);assert.equal(st.D,null);assert.equal(st.DD.info.size,0);
});
test('protected resolution locks win over every client-supplied lock and outcome',()=>{
 const a=record('a'),engine=assemblyEngine('meridian',[a]),c=engine.cycle(now),L={c,k:'protected',ti:'The protected resolution',tx:'Server-held text',cat:'trade',g:0,by:'npc-vellmark',bn:'Vellmark',w:'n',lt:now};
 a.n.asm.cur={...L,k:'forged'};a.n.asm.h=[{...L,k:'forged',f:1,y:9999,ok:1}];
 const st=assemblyEngine('meridian',[a],[L]).state(now);assert.equal(st.cur.k,'protected');assert.equal(st.L.get(c).y,undefined);
});
test('each eligible actor contributes one vote, with Delegate weight derived from endorsements',()=>{
 const a=record('a'),b=record('b'),engine=assemblyEngine('meridian',[a,b]),c=engine.cycle(now),L={c,k:'protected',ti:'A resolution',cat:'trade',g:0,by:'a',lt:now};
 a.n.asm.v=[{c,k:L.k,v:1,t:now-1},{c,k:L.k,v:1,t:now-1}];b.n.asm.e=[{i:'a',t:now-2}];
 const st=assemblyEngine('meridian',[a,b],[L]).state(now),row=st.V.rows.find(r=>r.id==='a');
 assert.equal(st.V.rows.filter(r=>r.id==='a').length,1);assert.equal(row.w,st.D?.id==='a'?st.D.k+1:1);
});
test('cabinet affinity retains skill, traits, loyalty and completed Palace effects',()=>{
 const n={name:'Crownland',pretitle:'Kingdom',cab:{for:{sk:5,tr:['genius','dove'],lo:80}},cities:[{b:[{k:'palace',d:now-1}]}]};
 assert.equal(cabinetAffinity(n),19);n.cab.for.lo=10;assert.equal(cabinetAffinity(n),15);n.pretitle='Republic';assert.equal(cabinetAffinity(n),7);n.cab.for.tr=['hawk','gaffe'];assert.equal(cabinetAffinity(n),-3);
});


test('computer nations keep their named statistics and endorse matching political values',()=>{
 const npc=DATA.regions.find(r=>r.id==='meridian').npcs.find(n=>n.id==='npc-karvesk');
 assert.equal(Array.isArray(npc.s),false);assert.equal(npc.s.civil,20);assert.equal(npc.s.econ,12);
 const matching=record('matching',{s:{...npc.s}}),opposite=record('opposite',{s:{civil:100,econ:100,pol:100}});
 const backing=assemblyEngine('meridian',[matching,opposite]).state(now).DD.npc.find(b=>b.x.id===npc.id);
 assert.equal(backing.r.id,'matching');assert.equal(backing.a,100);
});

test('an absent member keeps its seat but its endorsements stop counting and it cannot hold the chair',()=>{
 const a=record('a',{lastSave:now-20*DAY}),b=record('b',{lastSave:now-DAY}),c=record('c',{lastSave:now-DAY});
 a.n.asm.e=[{i:'b',t:now-5*DAY}];b.n.asm.e=[{i:'a',t:now-5*DAY}];c.n.asm.e=[{i:'a',t:now-5*DAY}];
 const st=assemblyEngine('meridian',[a,b,c]).state(now);
 assert.equal(st.DD.info.get('a').ab,true);assert.equal(st.DD.info.get('a').k>=2,true,'its endorsements from others still show');
 assert.equal(st.DD.info.get('b').by.includes('a'),false,'the absent member’s own endorsement does not count');
 assert.notEqual(st.D?.id,'a','the absent member cannot hold the chair');
 assert.ok(st.DD.npc.every(x=>x.r?.id!=='a'),'no computer nation backs an absent member');
 const back=record('a',{lastSave:now-1000});back.n.asm=a.n.asm;
 assert.equal(assemblyEngine('meridian',[back,b,c]).state(now).D?.id,'a','back again, it takes the chair');
});
test('the Delegate’s vote counts 1 plus its endorsements, up to four of them',()=>{
 const del=record('del'),others=[...Array(7)].map((_,i)=>record('m'+i));
 for(const o of others)o.n.asm.e=[{i:'del',t:now-DAY}];
 const engine=assemblyEngine('meridian',[del,...others]),c=engine.cycle(now),L={c,k:'res',ti:'A resolution',cat:'trade',g:0,by:'npc-vellmark',lt:now};
 del.n.asm.v=[{c,k:'res',v:1,t:now-1}];
 const st=assemblyEngine('meridian',[del,...others],[L]).state(now);
 assert.equal(st.D.id,'del');assert.ok(st.D.k>=7);assert.equal(st.V.rows.find(r=>r.id==='del').w,5);assert.equal(engine.weight(2),3);
});
test('the rulebook: a resolution enters, replaces one on its subject, pushes out the oldest past five, and a repeal takes it out',()=>{
 const e=assemblyEngine('meridian',[]),step=(bk,L)=>e.bookStep(bk,{f:1,ok:1,g:0,by:'x',...L});
 let bk=[];
 for(const [i,cat] of ['env','trade','rights','tax','sci'].entries())bk=step(bk,{c:i,k:'k'+i,ti:'R'+i,cat}).bk;
 assert.deepEqual(bk.map(x=>x.k),['k0','k1','k2','k3','k4']);
 let r=step(bk,{c:5,k:'k5',ti:'R5',cat:'trade'});assert.deepEqual(r.bk.map(x=>x.k),['k0','k2','k3','k4','k5']);assert.deepEqual(r.bx.map(x=>x.w),['s']);
 r=step(r.bk,{c:6,k:'k6',ti:'R6',cat:'arms'});assert.deepEqual(r.bk.map(x=>x.k),['k2','k3','k4','k5','k6']);assert.deepEqual(r.bx,[{k:'k0',ti:'R0',w:'o'}]);
 r=step(r.bk,{c:7,k:'k7',ti:'Repeal',cat:'tax',rp:'k3'});assert.deepEqual(r.bk.map(x=>x.k),['k2','k4','k5','k6']);assert.equal(r.bx[0].w,'r');
 assert.deepEqual(e.bookStep(r.bk,{f:1,ok:0,c:8,k:'k8',cat:'env'}).bk.length,4,'a failed count changes nothing');
});
test('the book in force folds the finished cycles after the last one that kept it, and a repeal of a resolution no longer in it is passed over',()=>{
 /* a member since well before this cycle opened: two days of membership fall short on a cycle's third day, when its
    proposal would not count */
 const a=record('a',{founded:now-12*DAY,civicAt:now-10*DAY}),c=assemblyEngine('meridian',[a]).cycle(now);
 const L=(x,more)=>({c:x,k:'k'+x,ti:'R'+x,tx:'',cat:['env','trade','rights'][x%3],g:0,by:'npc-vellmark',bn:'Vellmark',w:'n',lt:1,y:2,n:0,ok:1,f:1,r:'meridian',...more});
 const locks=[L(c-3,{bk:[{k:'old',c:c-9,ti:'Old',tx:'',cat:'sci',g:0,by:'x',bn:''}]}),L(c-2),L(c-1,{ok:0})];
 const e=assemblyEngine('meridian',[a],locks);
 assert.deepEqual(e.book(c).map(x=>x.k),['old','k'+(c-2)]);
 assert.deepEqual(assemblyEngine('meridian',[a],locks.map(({bk,...x})=>x)).book(c).map(x=>x.k),['k'+(c-3),'k'+(c-2)],'with no kept book, it starts from the outcomes the locks hold');
 a.n.asm.p={t:assemblyEngine('meridian',[a]).t0(c-1)+1000,ti:'Repeal of Gone',tx:'It has gone already.',c:'sci',g:0,rp:'gone'};
 assert.ok(e.pick(c,new Set(locks.map(x=>x.k))).by.startsWith('npc-'),'a moot repeal is not put to the vote: a computer nation tables one instead');
 a.n.asm.p.rp='old';const p=assemblyEngine('meridian',[a],locks).pick(c,new Set(locks.map(x=>x.k)));
 assert.equal(p.by,'a');assert.equal(p.rp,'old');
});

test('a sway reaches up to two computer nations that have not voted yet, and the count follows it; a failed or late one changes nothing',()=>{
 const a=record('a'),base=assemblyEngine('meridian',[a]),c=base.cycle(now),L={c,k:'res-sway',ti:'A resolution',cat:'trade',g:0,by:'a',lt:now},T0=base.t0(c),T1=base.t0(c+1)-1;
 let v=1,np=base.swayPick(L,c,T0,v);if(!np.length){v=-1;np=base.swayPick(L,c,T0,v);}
 assert.ok(np.length>=1&&np.length<=2,'someone to lean on');
 const vote=(w,T=T1)=>{a.n.asm.w=w;return assemblyEngine('meridian',[a],[L]).tally(L,c,[a],T,null);};
 const plain=vote(undefined),swayed=vote({c,k:L.k,v,t:T0,ok:1,ex:0,np});
 for(const id of np){assert.notEqual(plain.rows.find(r=>r.id===id).v,v);assert.equal(swayed.rows.find(r=>r.id===id).v,v);assert.equal(swayed.rows.find(r=>r.id===id).sw,undefined,'unexposed: nobody is named');}
 assert.equal(vote({c,k:L.k,v,t:T0,ok:1,ex:1,np}).rows.find(r=>r.id===np[0]).sw,'a','an exposed sway names its member');
 assert.deepEqual(vote({c,k:L.k,v,t:T0,ok:0,ex:0,np}).rows.map(r=>r.v),plain.rows.map(r=>r.v),'a failed sway');
 assert.deepEqual(vote({c,k:'other',v,t:T0,ok:1,ex:0,np}).rows.map(r=>r.v),plain.rows.map(r=>r.v),'another resolution');
 assert.deepEqual(vote({c,k:L.k,v,t:T1,ok:1,ex:0,np}).rows.map(r=>r.v),plain.rows.map(r=>r.v),'too late: they had voted');
 assert.deepEqual(base.swayPick(L,c,T1,v),[],'nobody left to lean on once all have voted');
});

/* ── commendations and condemnations: resolutions that name one nation ── */
const veteran=(id,more={})=>record(id,{founded:now-40*DAY,civicAt:now-39*DAY,lastSave:now-1000,...more});
const npcOf=reg=>DATA.regions.find(r=>r.id===reg).npcs;
test('a commendation or condemnation never enters the rulebook, and a passed one marks the nation named for seven days',()=>{
 const e=assemblyEngine('meridian',[]),bk=[{k:'k0',c:0,ti:'R0',tx:'',cat:'env',g:0,by:'x',bn:''}];
 for(const cat of ['commend','condemn']){const r=e.bookStep(bk,{f:1,ok:1,g:0,by:'x',c:1,k:'n1',ti:'Named',cat,tg:'a',tn:'A'});assert.deepEqual(r.bk,bk);assert.deepEqual(r.bx,[]);}
 const a=veteran('a'),c=e.cycle(now),t=e.t0(c);
 const L=(x,cat,more)=>({c:x,k:'m'+x,ti:'Named '+x,tx:'',cat,g:0,by:'npc-vellmark',bn:'Vellmark',w:'n',lt:1,y:3,n:0,ok:1,f:1,r:'meridian',tg:'a',tn:'a',...more});
 const eng=assemblyEngine('meridian',[a],[L(c-1,'commend'),L(c-2,'condemn',{ok:0}),L(c-4,'condemn')]);
 assert.deepEqual(eng.marks(now).map(m=>[m.m,m.tg,m.c]),[['c','a',c-1]],'the passed commendation of the last count: the failed condemnation marks nobody, and the one four counts ago has run out');
 assert.equal(eng.marks(t).length,1,'from the close of its count');assert.equal(eng.marks(t-1).length,0,'not before');
 assert.equal(eng.marks(t+7*DAY-1).length,1);assert.equal(eng.marks(t+7*DAY).length,0,'gone after seven days');
 assert.equal(eng.mark('commend'),'c');assert.equal(eng.mark('condemn'),'x');assert.equal(eng.mark('trade'),'');
});
test('a condemnation needs two votes for every one against; a commendation a simple majority',()=>{
 const ps=['a','b','c','d','e'].map(id=>veteran(id)),e=assemblyEngine('meridian',ps),c=e.cycle(now),t0=e.t0(c),T=t0+60000;
 const count=(cat,yes,no)=>{ps.forEach((p,i)=>{p.n.asm.v=i<yes?[{c,k:'nm',v:1,t:t0+1000}]:i<yes+no?[{c,k:'nm',v:-1,t:t0+1000}]:[];});
   const L={c,k:'nm',ti:'Named',cat,g:0,by:'npc-vellmark',lt:t0,tg:'npc-karvesk',tn:'Karvesk'};return assemblyEngine('meridian',ps,[L]).tally(L,c,ps,T,null);};
 assert.equal(count('condemn',2,1).ok,true,'two to one carries');
 assert.equal(count('condemn',3,2).ok,false,'three to two falls short');
 assert.equal(count('commend',3,2).ok,true,'a commendation needs only more for than against');
 assert.equal(count('commend',2,2).ok,false,'a tie fails');
});
test('a computer nation named votes for its own commendation and against its own condemnation, before the others',()=>{
 const a=veteran('a'),e=assemblyEngine('meridian',[a]),c=e.cycle(now),t0=e.t0(c),x=npcOf('meridian')[0].id;
 for(const [cat,v] of [['commend',1],['condemn',-1]]){
  const L={c,k:'nm-'+cat,ti:'Named',cat,g:0,by:'a',lt:t0,tg:x,tn:'X'},V=assemblyEngine('meridian',[a],[L]).tally(L,c,[a],t0+700000,null);
  assert.equal(V.rows.find(r=>r.id===x).v,v);assert.ok(V.rows.filter(r=>r.npc&&r.id!==x).every(r=>r.v===null),'the others take their time');}
});
test('who a resolution may name: no newcomer or absentee condemned, never its proposer, nobody twice for the same mark',()=>{
 const a=veteran('a'),fresh=veteran('fresh',{founded:now-3*DAY}),away=veteran('away',{lastSave:now-20*DAY}),hid={...veteran('hid'),hidden:true},x=npcOf('meridian')[0].id;
 const e=assemblyEngine('meridian',[a,fresh,away,hid]),why=(id,m,by='a',eng=e)=>eng.named(id,m,now,by);
 assert.equal(why(x,'x'),'','a computer nation may be condemned');assert.equal(why('away','c'),'','an absent nation may still be commended');
 assert.match(why('fresh','x'),/first fortnight/);assert.equal(why('fresh','c'),'','a newcomer may be commended');
 assert.match(why('away','x'),/not been seen/);assert.match(why('a','c'),/proposes/);
 assert.match(why('hid','c'),/not in the region/);assert.match(why('nobody','c'),/not in the region/);assert.match(why('','c'),/Choose/);
 const c=e.cycle(now),done={c:c-1,k:'m',ti:'Laurels for A',cat:'commend',g:0,by:'npc-vellmark',bn:'Vellmark',w:'n',lt:1,y:3,n:0,ok:1,f:1,r:'meridian',tg:'away',tn:'away'};
 const e2=assemblyEngine('meridian',[a,fresh,away,hid],[done]);
 assert.match(why('away','c','a',e2),/laurel/,'already commended');assert.equal(why(x,'c','a',e2),'');
 assert.equal(e.target(x).npc,true);assert.equal(e.target('a').n.name,'a');
});
test('a proposal naming a nation that already wears the mark is passed over; one that may name it goes to the vote with it',()=>{
 const a=veteran('a'),b=veteran('b'),base=assemblyEngine('meridian',[a,b]),c=base.cycle(now);
 a.n.asm.p={t:base.t0(c-1)+1000,ti:'Laurels for b',tx:'For being b, steadily.',c:'commend',g:0,tg:'b',tn:'b'};
 const p=assemblyEngine('meridian',[a,b]).pick(c,new Set());assert.equal(p.by,'a');assert.equal(p.tg,'b');assert.equal(p.tn,'b');assert.equal(p.cat,'commend');
 const done={c:c-1,k:'m',ti:'Earlier laurels',cat:'commend',g:0,by:'npc-vellmark',bn:'Vellmark',w:'n',lt:1,y:3,n:0,ok:1,f:1,r:'meridian',tg:'b',tn:'b'};
 const q=assemblyEngine('meridian',[a,b],[done]).pick(c,new Set(['m']));assert.notEqual(q.by,'a','b already wears the laurel: a computer nation tables something instead');
});
test('now and then a computer nation proposes to commend the member it likes best, when nobody has proposed anything',()=>{
 const x=npcOf('meridian')[0],fan=veteran('fan',{s:{...x.s},lastSave:0}),e=assemblyEngine('meridian',[fan]),c=e.cycle(now);
 const picks=[...Array(60)].map((_,i)=>e.pick(c+1+i,new Set())),laud=picks.filter(p=>p.cat==='commend');
 assert.ok(laud.length>=4&&laud.length<=20,'about one cycle in six: '+laud.length);
 for(const p of laud){assert.equal(p.tg,'fan');assert.ok(p.by.startsWith('npc-'));assert.match(p.ti,/fan/);assert.equal(p.w,'n');}
 const gone=veteran('gone',{s:{...x.s},lastSave:now-30*DAY}),away=assemblyEngine('meridian',[gone]);
 assert.ok([...Array(60)].map((_,i)=>away.pick(c+1+i,new Set())).every(p=>p.cat!=='commend'),'never a member who has not been seen for a fortnight');
});
