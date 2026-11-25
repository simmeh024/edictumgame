import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assemblyEngine} from '../functions/assembly-engine.js';
import {DH_ASM_EVENT as EVENT,DH_ASM_BY as BY,DH_ASM_TARGET as TARGET,DH_ASM_TEXT as TEXT,DH_ASM_REPLY as REPLY,DH_ASM_ANNOUNCEMENT as ANNOUNCEMENT,dhaluunMotion,dhAsmT0,dhaluunClosingReply} from '../functions/dhaluun-assembly.js';
import {runCondemnation} from '../tools/admin/dhaluun-assembly.mjs';
const now=Date.now(),c=assemblyEngine('cloudspine',[]).cycle(now),path='assemblyRegions/cloudspine',old={c,k:'player-motion',cat:'trade',g:1,ti:'More Trade, More Good',tx:'Make that money',by:'player-a',bn:'A',w:'s',lt:now};
function database(){
  const data=new Map([['worldEvents/dhaluun-customs-v1',{v:1}],[path,{rev:16}],[path+'/cycles/'+c,old]]),writes=[];
  const doc=p=>({path:p,collection:k=>({doc:id=>doc(p+'/'+k+'/'+id)})});
  const snap=r=>({id:r.path.split('/').at(-1),ref:r,exists:data.has(r.path),data:()=>structuredClone(data.get(r.path)),get:k=>data.get(r.path)?.[k]});
  return {data,writes,doc,runTransaction:async fn=>{
    const pending=[],tx={get:async r=>snap(r),getAll:async(...refs)=>refs.map(snap),create:(r,d)=>{assert.ok(!data.has(r.path));pending.push([r.path,d]);},set:(r,d,o)=>pending.push([r.path,o?.merge?{...data.get(r.path),...d}:d])};
    const result=await fn(tx);for(const [p,d] of pending){data.set(p,structuredClone(d));writes.push(p);}return result;
  }};
}
test('Saaveri tables the complete approved condemnation of Dhaluun and a real target, without deciding the vote',()=>{
  const L=dhaluunMotion(c+1,now);assert.equal(L.by,BY);assert.equal(L.tg,TARGET);assert.equal(L.cat,'condemn');assert.equal(L.g,0);assert.equal(L.tx,TEXT);assert.ok(TEXT.length>280);assert.ok(!('ok' in L));assert.ok(!('f' in L));
  assert.match(TEXT,/elevation of a throne confers no jurisdiction/);assert.match(TEXT,/actual customs policy\.$/);assert.equal(assemblyEngine('cloudspine',[]).named(TARGET,'x',now,BY),'');
});
test('the protected next motion leaves the player vote in progress and becomes votable only in its own cycle',()=>{
  const L=dhaluunMotion(c+1,now),locks=[old,L];
  assert.equal(assemblyEngine('cloudspine',[],locks).state(now).cur.k,old.k);
  assert.equal(assemblyEngine('cloudspine',[],locks).state(dhAsmT0(c+1)+1000).cur.k,EVENT);
  const records=Array.from({length:20},(_,i)=>({id:'voter'+i,n:{name:'Voter',reg:'cloudspine',civicAt:dhAsmT0(c)-864e5,asm:{r:'cloudspine',v:[{c:c+1,k:EVENT,v:-1,t:dhAsmT0(c+1)+1}]}}}));
  const E=assemblyEngine('cloudspine',records,locks),V=E.tally(L,c+1,records,dhAsmT0(c+2)-1,null);
  assert.equal(V.ok,false);assert.ok(V.n>=20,'normal player votes can defeat the condemnation');
});
test('the announcement and next motion publish atomically and once, without touching player records or the current vote',async()=>{
  const db=database(),preview=await runCondemnation(db);assert.equal(preview.status,'plan');assert.equal(db.writes.length,0);
  const result=await runCondemnation(db,{apply:true});assert.equal(result.status,'applied');assert.equal(result.cycle,c+1);assert.equal(result.ends-result.starts,3*864e5);
  assert.deepEqual(db.data.get(path+'/cycles/'+c),old);assert.equal(db.data.get(path+'/cycles/'+(c+1)).tx,TEXT);
  assert.equal(db.data.get('rchat/cloudspine/chat/'+EVENT).x,ANNOUNCEMENT);assert.ok(db.data.get('cb/cloudspine/posts/'+result.debate).x.includes(TEXT));
  assert.equal(db.data.get(path).rev,17);assert.ok(!db.writes.some(p=>p.startsWith('nations/')||p.includes('/actors/')));assert.ok(!db.data.has('rchat/cloudspine/chat/'+EVENT+'-reply'));
  const count=db.writes.length;assert.equal((await runCondemnation(db,{apply:true})).status,'already-applied');assert.equal(db.writes.length,count);
});
test('an already scheduled vote or a missing prerequisite prevents every publication write',async()=>{
  const db=database();db.data.set(path+'/cycles/'+(c+1),{k:'another'});await assert.rejects(runCondemnation(db,{apply:true}),/already scheduled/);assert.equal(db.writes.length,0);
  db.data.delete(path+'/cycles/'+(c+1));db.data.delete('worldEvents/dhaluun-customs-v1');await assert.rejects(runCondemnation(db,{apply:true}),/not been published/);assert.equal(db.writes.length,0);
});
test('Dhaluun answers only the final protected count, after its deadline, regardless of whether it passed',()=>{
  const L=dhaluunMotion(c+1,now),end=dhAsmT0(c+2),final={...L,r:'cloudspine',f:end,ok:1};
  assert.equal(dhaluunClosingReply(L,end),'');assert.equal(dhaluunClosingReply(final,end-1),'');assert.equal(dhaluunClosingReply({...final,k:'other'},end),'');assert.equal(dhaluunClosingReply({...final,r:'meridian'},end),'');
  assert.equal(dhaluunClosingReply(final,end),REPLY);assert.equal(dhaluunClosingReply({...final,ok:0},end),REPLY);
  assert.equal(REPLY,'His Imperial Loftiness acknowledges the Assembly’s concern. The wall shall be raised accordingly.');
});
