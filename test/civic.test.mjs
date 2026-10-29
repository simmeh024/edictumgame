import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../functions/package.json', import.meta.url));
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const PROJECT=process.env.GCLOUD_PROJECT||'demo-edictum', AUTH=process.env.FIREBASE_AUTH_EMULATOR_HOST||'127.0.0.1:9099', FN=process.env.FUNCTIONS_EMULATOR_HOST||'127.0.0.1:5001';
initializeApp({projectId:PROJECT});
const db=getFirestore(), auth=getAuth(), DAY=86400000;
async function sign(method,data){const r=await fetch(`http://${AUTH}/identitytoolkit.googleapis.com/v1/accounts:${method}?key=fake-api-key`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...data,returnSecureToken:true})});const b=await r.json();assert.ok(r.ok,JSON.stringify(b));return {uid:b.localId||JSON.parse(Buffer.from(b.idToken.split('.')[1],'base64url')).user_id,token:b.idToken};}
async function player(linked=false,old=false,reg='meridian'){
  let p;
  if(linked){const email=`civic-${crypto.randomUUID()}@example.test`,password='test-only-password';await auth.createUser({email,password,emailVerified:true});p=await sign('signInWithPassword',{email,password});}
  else p=await sign('signUp',{});
  await db.doc('nations/'+p.uid).set({v:1,j:JSON.stringify({reg,name:p.uid,pop:10,s:{civil:50,econ:50,pol:50}}),reg,name:p.uid,pop:10,army:1,cl:0,updatedAt:Date.now(),rev:1,ts:new Date()});
  if(old)await age(p,2*DAY);
  return p;
}
async function age(p,ms){const s=await db.doc('nations/'+p.uid).get();await db.doc('accountIdentity/'+p.uid).set({nationAt:Date.now()-ms,nationGeneration:s.createTime.toMillis()},{merge:true});}
async function call(p,service,data){const r=await fetch(`http://${FN}/${PROJECT}/europe-west1/${service}`,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+p.token},body:JSON.stringify({data})});const b=await r.json();if(b.error)throw Object.assign(new Error(b.error.message),{code:b.error.details?.code,status:b.error.status});return b.result;}
const civic=(p,d)=>call(p,'civic',d), account=(p,d)=>call(p,'accounts',d);
const code=()=> 'EDC-'+Array.from(crypto.getRandomValues(new Uint8Array(20))).map(n=>n.toString(16).padStart(2,'0')).join('');
const rejects=(p,code)=>assert.rejects(p,e=>e.code===code);
const proposal={op:'propose',title:'A test resolution',body:'A valid protected resolution for the region.',category:'trade',strength:0};

test('Guest and young Registered Nations can read, but cannot bypass the 24-hour Assembly gate',async()=>{
  const g=await player(), r=await player(true);
  const gs=await civic(g,{op:'state'});assert.equal(gs.account.kind,'guest');assert.ok(gs.cur);
  await rejects(civic(g,proposal),'registration_required');
  await rejects(civic(r,proposal),'nation_too_young');
  const s=await db.doc('nations/'+r.uid).get(),n=JSON.parse(s.get('j'));n.founded=1;n.asm={v:[{c:gs.c,k:gs.cur.k,v:1,t:1}],p:{...proposal,t:1}};
  await s.ref.update({j:JSON.stringify(n)});
  await rejects(civic(r,{op:'vote',cycle:gs.c,key:gs.cur.k,vote:1}),'nation_too_young');
  assert.equal((await civic(g,{op:'state'})).recs.find(x=>x.id===r.uid).n.asm.p,undefined);
});

test('Protected votes have a fixed voter, one record per cycle, and reject stale votes',async()=>{
  const r=await player(true,true), state=await civic(r,{op:'state'});
  await civic(r,{op:'vote',cycle:state.c,key:state.cur.k,vote:1,uid:'forged',weight:9000,t:1});
  await civic(r,{op:'vote',cycle:state.c,key:state.cur.k,vote:-1});
  const path=`assemblyRegions/meridian/cycles/${state.c}/votes`, docs=await db.collection(path).where('uid','==',r.uid).get();
  assert.equal(docs.size,1);assert.equal(docs.docs[0].id,r.uid);assert.equal(docs.docs[0].get('value'),-1);assert.ok(docs.docs[0].get('at')>Date.now()-60000);assert.equal(docs.docs[0].get('weight'),undefined);
  await rejects(civic(r,{op:'vote',cycle:state.c-1,key:state.cur.k,vote:1}),'vote_closed');
  await assert.rejects(civic(r,{op:'vote',cycle:state.c,key:state.cur.k,vote:7}));
});

test('Proposals, endorsements and Delegate privileges use the same protected identity',async()=>{
  const a=await player(true,true,'frostmarch'), b=await player(true,true,'frostmarch');
  const result=await civic(a,proposal);assert.equal(result.own.p.ti,proposal.title);
  await rejects(civic(a,proposal),'proposal_exists');
  await civic(a,{...proposal,edit:true,title:'A revised resolution',category:'arms',strength:1});
  const actor=(await db.doc(`assemblyRegions/frostmarch/actors/${a.uid}`).get()).get('record');assert.equal(actor.p.c,'trade');assert.equal(actor.p.g,0);
  const observer=result.D?.id===a.uid?b:a;await rejects(civic(observer,{op:'message',message:'Forged Delegate message'}),'delegate_required');
  const endorsed=await civic(b,{op:'endorse',target:a.uid,on:true});assert.ok(endorsed.D);const leader=endorsed.D.id===a.uid?a:b;
  await civic(leader,{op:'message',message:'A protected Delegate message'});
  await rejects(civic(leader,{op:'message',message:'Too soon'}),'message_cooldown');
  await civic(b,{op:'endorse',target:a.uid,on:false});
  await rejects(civic(b,{op:'endorse',target:a.uid,on:true}),'endorsement_cooldown');
  await civic(a,{op:'withdraw'});
  await rejects(civic(a,proposal),'proposal_cooldown');
  const docs=await db.collection('assemblyRegions/frostmarch/proposals').where('uid','==',a.uid).get();assert.equal(docs.size,1);assert.equal(docs.docs[0].get('status'),'withdrawn');
});

test('Bans, moderation and disabled regions block sensitive actions at the backend',async()=>{
  const r=await player(true,true);
  await db.doc('mod/'+r.uid).set({hidden:true});const observer=await player();assert.ok(!(await civic(observer,{op:'state'})).recs.some(x=>x.id===r.uid));assert.equal((await civic(r,{op:'state'})).account.eligible,false);await rejects(civic(r,proposal),'moderated');
  await db.doc('mod/'+r.uid).delete();await db.doc('bans/'+r.uid).set({t:Date.now()});await rejects(civic(r,{op:'topic',text:'Bypass attempt'}),'banned');
  await db.doc('bans/'+r.uid).delete();await db.doc('regionStatus/meridian').set({enabled:false});
  try{await rejects(civic(r,proposal),'region_disabled');}finally{await db.doc('regionStatus/meridian').delete();}
});

test('Community topics require a linked identity and remain paced',async()=>{
  const g=await player(),r=await player(true);
  await rejects(civic(g,{op:'topic',text:'Guest topic'}),'registration_required');
  const posted=await civic(r,{op:'topic',text:'Registered topic'});assert.equal((await db.doc('boards/meridian/posts/'+posted.id).get()).get('a'),r.uid);
  await assert.rejects(civic(r,{op:'topic',text:'Too soon'}),e=>e.status==='RESOURCE_EXHAUSTED');
});

test('Ordinary saves cannot inject politics, found Guest alliances or declare Guest PvP wars',async()=>{
  const g=await player(), r=await player(true), other=await player();
  const record={reg:'meridian',name:g.uid,pop:10,army:1,cl:0,updatedAt:Date.now()}, n={reg:'meridian',name:g.uid,pop:10};
  const save=n=>civic(g,{op:'authorizeSave',record:{...record,j:JSON.stringify(n)},rev:1});
  assert.ok((await save(n)).permit);
  await assert.rejects(save({...n,asm:{v:[{v:1}]}}),e=>e.status==='INVALID_ARGUMENT');
  await rejects(save({...n,alli:{name:'Guest forged alliance',t:Date.now()}}),'registration_required');
  await rejects(save({...n,wars:{[other.uid]:{t:Date.now()}}}),'registration_required');
  assert.ok((await save({...n,wars:{'npc-vellmark':{t:Date.now()}}})).permit);
  await rejects(save({...n,wars:{'npc-fake':{t:Date.now()}}}),'registration_required');
  await rejects(civic(r,{op:'authorizeSave',record:{...record,name:r.uid,j:JSON.stringify({...n,name:r.uid})},rev:0}),'save_conflict');
});

test('A one-time hashed code recovers the original Guest UID, never registration',async()=>{
  const g=await player(), visitor=await player(), secret=code();
  assert.equal((await account(g,{op:'status'})).recoveryIssued,false);
  await account(g,{op:'issue',code:secret});await account(g,{op:'issue',code:secret});
  await rejects(account(g,{op:'issue',code:code()}),'already_issued');
  const a=await db.doc('accountIdentity/'+g.uid).get();assert.match(a.get('recoveryHash'),/^[a-f0-9]{64}$/);
  const s=await db.doc('guestRecovery/'+a.get('recoveryHash')).get();assert.equal(s.get('code'),undefined);assert.equal(s.get('uid'),g.uid);
  const recovered=await account(visitor,{op:'recover',code:secret.toLowerCase()});const session=await sign('signInWithCustomToken',{token:recovered.token});assert.equal(session.uid,g.uid);
  assert.equal((await account(session,{op:'status'})).kind,'guest');await rejects(civic(session,proposal),'registration_required');
  await rejects(account(visitor,{op:'recover',code:code()}),'invalid_recovery');
});

test('A linked or deleted nation cannot be recovered by a former Guest code',async()=>{
  const g=await player(), visitor=await player(), secret=code();await account(g,{op:'issue',code:secret});
  await auth.updateUser(g.uid,{email:`linked-${crypto.randomUUID()}@example.test`,emailVerified:true,password:'test-only-password'});
  await rejects(account(visitor,{op:'recover',code:secret}),'invalid_recovery');
  const h=await player(), next=code();await account(h,{op:'issue',code:next});await db.doc('nations/'+h.uid).delete();await rejects(account(visitor,{op:'recover',code:next}),'invalid_recovery');
});

test('Recovery rate limits apply even to well-formed unknown codes',async()=>{
  const g=await player();let limited=false;
  for(let i=0;i<12;i++){try{await account(g,{op:'recover',code:code()});}catch(e){if(e.status==='RESOURCE_EXHAUSTED'){limited=true;break;}}}
  assert.ok(limited);
});


test('deleting and refounding cannot turn a lost code into a replacement for the same account',async()=>{
  const p=await player(),secret=code();await account(p,{op:'issue',code:secret});
  await db.doc('nations/'+p.uid).delete();await call(p,'referee',{op:'forget'});
  await db.doc('nations/'+p.uid).set({j:JSON.stringify({name:p.uid,reg:'meridian'}),name:p.uid,reg:'meridian'});
  await rejects(account(p,{op:'issue',code:code()}),'already_issued');
});


test('Guest players can defend but cannot invoke offensive PvP battles directly',async()=>{
  const g=await player(),foe=await player();
  await rejects(call(g,'referee',{op:'battle',d:foe.uid,c:12,p:.5}),'registration_required');
  const saved=await db.doc('nations/'+foe.uid).get(),n=JSON.parse(saved.get('j'));n.wars={[g.uid]:{t:Date.now()}};await saved.ref.update({j:JSON.stringify(n)});
  assert.equal((await call(g,'referee',{op:'battle',d:foe.uid,c:12,p:.5})).ok,true);
});

test('Concurrent vote requests still produce one protected vote per voter',async()=>{
  const p=await player(true,true),s=await civic(p,{op:'state'});
  await Promise.all([-1,1].map(vote=>civic(p,{op:'vote',vote,cycle:s.c,key:s.cur.k})));
  const votes=await db.collection(`assemblyRegions/meridian/cycles/${s.c}/votes`).where('uid','==',p.uid).get();assert.equal(votes.size,1);assert.ok([-1,1].includes(votes.docs[0].get('value')));
});


test('maintenance allows an administrator to save without granting political privileges',async()=>{
  const p=await player();await auth.setCustomUserClaims(p.uid,{admin:true});await db.doc('regionStatus/meridian').set({enabled:false});
  try{
    const now=Date.now(),record={reg:'meridian',name:p.uid,pop:10,army:1,cl:0,updatedAt:now,j:JSON.stringify({reg:'meridian',name:p.uid,pop:10})};
    assert.ok((await civic(p,{op:'authorizeSave',rev:1,record})).permit);
    await rejects(civic(p,proposal),'region_disabled');
  }finally{await db.doc('regionStatus/meridian').delete();}
  await rejects(civic(p,proposal),'registration_required');
});
