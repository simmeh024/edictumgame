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
