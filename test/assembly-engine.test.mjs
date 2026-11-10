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
 const a=record('a'),c=assemblyEngine('meridian',[a]).cycle(now);
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
