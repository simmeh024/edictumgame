import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
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

test('An initially issued hashed code recovers the original Guest UID, never registration',async()=>{
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

test('Guest regeneration revokes old keys, preserves identity and age, and safely retries or races',async()=>{
  const g=await player(false,true),visitor=await player(),first=code(),next=code();
  await account(g,{op:'issue',code:first});const before=await db.doc('accountIdentity/'+g.uid).get();
  const state=await account(g,{op:'status'});assert.equal(state.recoveryVersion,0);
  const rotate={op:'regenerate',code:next,version:state.recoveryVersion};
  await account(g,rotate);await account(g,rotate);
  const after=await db.doc('accountIdentity/'+g.uid).get();assert.equal(after.get('recoveryVersion'),1);
  assert.equal(after.get('nationAt'),before.get('nationAt'));assert.equal(after.get('nationGeneration'),before.get('nationGeneration'));
  assert.equal(after.get('generation'),before.get('generation'));assert.notEqual(after.get('recoveryHash'),before.get('recoveryHash'));
  assert.deepEqual((await db.doc('guestRecovery/'+before.get('recoveryHash')).get()).data(),{revoked:true});
  await rejects(account(visitor,{op:'recover',code:first}),'invalid_recovery');
  const restored=await sign('signInWithCustomToken',{token:(await account(visitor,{op:'recover',code:next})).token});assert.equal(restored.uid,g.uid);
  assert.equal((await account(restored,{op:'status'})).kind,'guest');
  await rejects(account(g,{op:'regenerate',code:next,version:1}),'same_recovery');
  await assert.rejects(account(g,{op:'regenerate',code:code(),version:1}),e=>e.status==='RESOURCE_EXHAUSTED');
  await db.doc('accountIdentity/'+g.uid).update({recoveryRotatedAt:Date.now()-61000});
  await rejects(account(g,{op:'regenerate',code:first,version:1}),'code_used');
  const candidates=[code(),code()],results=await Promise.allSettled(candidates.map(code=>account(g,{op:'regenerate',code,version:1})));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(results.find(r=>r.status==='rejected').reason.code,'recovery_changed');
  assert.equal((await db.doc('accountIdentity/'+g.uid).get()).get('recoveryVersion'),2);
  const winner=candidates[results.findIndex(r=>r.status==='fulfilled')];
  assert.equal((await sign('signInWithCustomToken',{token:(await account(visitor,{op:'recover',code:winner})).token})).uid,g.uid);
  await rejects(account(visitor,{op:'recover',code:next}),'invalid_recovery');
});

test('Regeneration requires the current Guest identity, a saved nation and valid eligibility',async()=>{
  const owner=await player(),caller=await player(),linked=await player(true),first=code(),replacement=code();
  await account(owner,{op:'issue',code:first});
  await rejects(account(caller,{op:'regenerate',code:first,version:0}),'code_used');
  await account(caller,{op:'regenerate',code:replacement,version:0,uid:owner.uid});
  assert.equal((await account(owner,{op:'status'})).recoveryVersion,0);
  assert.equal((await sign('signInWithCustomToken',{token:(await account(caller,{op:'recover',code:first})).token})).uid,owner.uid);
  await rejects(account(linked,{op:'regenerate',code:code(),version:0}),'already_registered');
  const empty=await player();await db.doc('nations/'+empty.uid).delete();await rejects(account(empty,{op:'regenerate',code:code(),version:0}),'nation_required');
  await db.doc('bans/'+owner.uid).set({t:Date.now()});await rejects(account(owner,{op:'regenerate',code:code(),version:0}),'banned');
  const denied=await fetch(`http://${FN}/${PROJECT}/europe-west1/accounts`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({data:{op:'regenerate',code:code(),version:0}})});
  assert.equal((await denied.json()).error.status,'UNAUTHENTICATED');
});

test('Recovery rate limits apply even to well-formed unknown codes',async()=>{
  const g=await player();let limited=false;
  for(let i=0;i<12;i++){try{await account(g,{op:'recover',code:code()});}catch(e){if(e.status==='RESOURCE_EXHAUSTED'){limited=true;break;}}}
  assert.ok(limited);
});


test('Refounding does not silently issue a replacement recovery key',async()=>{
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

test('The kept Assembly view follows every action at once, writes nothing, and always reads the caller fresh',async()=>{
  const a=await player(true,true,'wildwood'),b=await player(true,true,'wildwood');
  await civic(a,{op:'state'});await civic(b,{op:'endorse',target:a.uid,on:true});
  const seen=await civic(a,{op:'state'}),root=await db.doc('assemblyRegions/wildwood').get();
  assert.ok(seen.info.find(([id])=>id===a.uid)?.[1].by.includes(b.uid),'an endorsement shows in the next view');
  assert.ok((await civic(b,{op:'state'})).own.e.some(e=>e.i===a.uid&&!e.w));
  assert.ok((await db.doc('assemblyRegions/wildwood').get()).updateTime.isEqual(root.updateTime),'a view with nothing due writes nothing');
  // a Guest that links and comes of age sees its own seat at once, though the region's kept records are a minute old
  const c=await player(false,false,'wildwood');assert.equal((await civic(c,{op:'state'})).account.kind,'guest');
  await auth.updateUser(c.uid,{email:`late-${crypto.randomUUID()}@example.test`,emailVerified:true,password:'test-only-password'});await age(c,2*DAY);
  const own=await civic(c,{op:'state'});
  assert.equal(own.account.eligible,true);assert.ok(own.recs.find(r=>r.id===c.uid).n.civicAt>0);
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

test('Community Board: any Registered Nation posts in any region; the server writes the author and the counts',async()=>{
  const g=await player(),r=await player(true),far=await player(true,false,'frostmarch');
  await rejects(civic(g,{op:'cbTopic',reg:'meridian',ti:'Guest topic',x:'Hello'}),'registration_required');
  await db.doc('shop/'+r.uid).set({owns:{founder:Date.now()}});
  const t=await civic(r,{op:'cbTopic',reg:'frostmarch',ti:'  Grain for steel  ',x:'Anyone <b>selling</b> steel?',tg:'trade',a:'forged',fd:false,st:'admin',rc:99});
  const topic=(await db.doc('cb/frostmarch/posts/'+t.id).get()).data();
  assert.equal(topic.a,r.uid);assert.equal(topic.rg,'meridian');assert.equal(topic.ti,'Grain for steel');assert.equal(topic.tg,'trade');assert.equal(topic.fd,true);assert.equal(topic.st,undefined);assert.equal(topic.rc,0);
  const rep=await civic(far,{op:'cbReply',reg:'frostmarch',topic:t.id,x:'I have steel.'});
  await db.doc('cbPace/'+r.uid).delete();                                 // the pacing has a test of its own
  await civic(r,{op:'cbReply',reg:'frostmarch',topic:t.id,x:'Deal.'});
  assert.equal((await db.doc('cb/frostmarch/posts/'+t.id).get()).get('rc'),2);
  const meta=(await db.doc('cb/frostmarch').get()).data();assert.equal(meta.n,1);assert.equal(meta.r,2);assert.equal(meta.dn,3);
  await assert.rejects(civic(r,{op:'cbEdit',reg:'frostmarch',topic:t.id,reply:rep.id,x:'Not mine'}),e=>e.status==='PERMISSION_DENIED');
  await civic(far,{op:'cbEdit',reg:'frostmarch',topic:t.id,reply:rep.id,x:'I have iron.'});
  assert.equal((await db.doc('cb/frostmarch/posts/'+t.id+'/posts/'+rep.id).get()).get('x'),'I have iron.');
  await assert.rejects(civic(r,{op:'cbMod',act:'lock',reg:'frostmarch',topic:t.id}),e=>e.status==='PERMISSION_DENIED');
  await assert.rejects(civic(r,{op:'cbTopic',reg:'atlantis',ti:'Nowhere',x:'x'}),e=>e.status==='INVALID_ARGUMENT');
  await db.doc('bans/'+far.uid).set({t:Date.now()});await rejects(civic(far,{op:'cbReply',reg:'frostmarch',topic:t.id,x:'Banned'}),'banned');
});

test('Community Board: staff pin, lock, hide, move and delete from inside the board, with an audit trail',async()=>{
  const r=await player(true),o=await player(true),staff=await player(true);await auth.setCustomUserClaims(staff.uid,{admin:true});
  const t=await civic(r,{op:'cbTopic',reg:'meridian',ti:'A rude topic',x:'Rude words'});
  const rep=await civic(o,{op:'cbReply',reg:'meridian',topic:t.id,x:'A reply'});
  const ref=db.doc('cb/meridian/posts/'+t.id);
  await civic(staff,{op:'cbMod',act:'pin',reg:'meridian',topic:t.id});assert.equal((await ref.get()).get('pn'),true);
  await civic(staff,{op:'cbMod',act:'lock',reg:'meridian',topic:t.id});
  await rejects(civic(o,{op:'cbReply',reg:'meridian',topic:t.id,x:'Locked out'}),'cb_locked');
  await civic(staff,{op:'cbReply',reg:'meridian',topic:t.id,x:'Staff may still answer'});
  await civic(staff,{op:'cbMod',act:'hide',reg:'meridian',topic:t.id,reason:'Rude'});
  let d=(await ref.get()).data();assert.equal(d.hd,true);assert.equal(d.x,'');assert.equal(d.ti,'');
  assert.equal((await db.doc('cbHidden/'+t.id).get()).get('x'),'Rude words');
  await civic(staff,{op:'cbMod',act:'unhide',reg:'meridian',topic:t.id});d=(await ref.get()).data();assert.equal(d.hd,undefined);assert.equal(d.ti,'A rude topic');
  const moved=await civic(staff,{op:'cbMod',act:'move',reg:'meridian',topic:t.id,to:'wildwood'});assert.equal(moved.reg,'wildwood');
  assert.equal((await ref.get()).exists,false);
  const there=db.doc('cb/wildwood/posts/'+t.id);assert.equal((await there.get()).get('rc'),2);assert.equal((await there.collection('posts').doc(rep.id).get()).get('x'),'A reply');
  await civic(staff,{op:'cbDelete',reg:'wildwood',topic:t.id});
  assert.equal((await there.get()).exists,false);assert.equal((await there.collection('posts').get()).size,0);
  const w=(await db.doc('cb/wildwood').get()).data();assert.equal(w.n,0);assert.equal(w.r,0);
  const log=await db.collection('adminAudit').where('topic','==',t.id).get();
  assert.deepEqual(new Set(log.docs.map(x=>x.get('action'))),new Set(['board_pin','board_lock','board_hide','board_unhide','board_move','board_delete']));
});

test('A new record starts no larger than a new nation could have grown, the account\'s last save, or the guest it was carried from',async()=>{
  const save=(p,pop,{rev=0,name='Freshland',...extra}={})=>civic(p,{op:'authorizeSave',record:{reg:'meridian',name,pop,army:1,cl:0,updatedAt:Date.now(),j:JSON.stringify({reg:'meridian',name,pop})},rev,...extra});
  const big=async(p,linked)=>{await db.doc('nations/'+p.uid).update({pop:900,ts:new Date()});assert.ok((await save(p,900,{rev:1,name:p.uid})).permit);};
  const hw=async p=>(await db.doc('accountIdentity/'+p.uid).get()).get('hw');
  // a fresh account: a new nation's size, and its first save is noted
  const fresh=await sign('signUp',{});
  assert.ok((await save(fresh,5)).permit);
  await rejects(save(fresh,5000),'population_limit');
  assert.equal((await hw(fresh)).pop,5);
  // a nation deleted and saved again: no larger than its last save allows
  const again=await player();await big(again);assert.equal((await hw(again)).pop,900);
  await db.doc('nations/'+again.uid).delete();
  await rejects(save(again,5000,{name:again.uid}),'population_limit');
  assert.ok((await save(again,900,{name:again.uid})).permit);
  // an update's permit notes no more than the rules would let it save
  const jump=await player();await save(jump,10,{rev:1,name:jump.uid});await save(jump,9e6,{rev:1,name:jump.uid});
  assert.ok((await hw(jump)).pop<11,'a jump the rules refuse is not noted: '+(await hw(jump)).pop);
  // a guest's nation carried into an account: from that guest's last save, once
  const guest=await player();await big(guest);await db.doc('nations/'+guest.uid).delete();
  const into=await sign('signUp',{}), other=await sign('signUp',{});
  await rejects(save(into,900,{name:guest.uid}),'population_limit');
  assert.ok((await save(into,900,{name:guest.uid,from:guest.uid})).permit);
  assert.equal((await hw(guest)).to,into.uid);
  await rejects(save(other,900,{name:guest.uid,from:guest.uid}),'population_limit');
  // never from a Registered Nation still in the region, nor from a guest's of another name
  const kept=await player(true);await big(kept);
  await rejects(save(other,900,{name:kept.uid,from:kept.uid}),'population_limit');
  const live=await player();await big(live);
  await rejects(save(other,900,{name:'Another name',from:live.uid}),'population_limit');
  assert.ok((await save(other,900,{name:live.uid,from:live.uid})).permit,'a guest copy of the same name, which a switch could not drop first');
});

test('A recruit counts once, as a Registered Nation founded in the last 30 days and after its recruiter',async()=>{
  const recruiter=await player();await age(recruiter,3*DAY);
  const guest=await player(), linked=await player(true);
  assert.deepEqual(await account(guest,{op:'recruit',by:recruiter.uid}),{ok:false,why:'guest'});
  assert.deepEqual(await account(linked,{op:'recruit',by:recruiter.uid}),{ok:true});
  assert.equal((await db.doc('recruits/'+linked.uid).get()).get('r'),recruiter.uid);
  assert.deepEqual(await account(linked,{op:'recruit',by:recruiter.uid}),{ok:false,why:'done'});
  await assert.rejects(account(linked,{op:'recruit',by:linked.uid}),e=>e.status==='INVALID_ARGUMENT');
  // two players opening each other's links: only the newer one is a recruit
  const a=await player(true), b=await player(true);await age(a,2*DAY);
  assert.deepEqual(await account(a,{op:'recruit',by:b.uid}),{ok:false,why:'old'});
  assert.deepEqual(await account(b,{op:'recruit',by:a.uid}),{ok:true});
  // a veteran, a recruiter that does not exist, and an account with no nation yet
  const veteran=await player(true);await age(veteran,40*DAY);const elder=await player();await age(elder,50*DAY);
  assert.deepEqual(await account(veteran,{op:'recruit',by:elder.uid}),{ok:false,why:'old'});
  assert.deepEqual(await account(await player(true),{op:'recruit',by:'no-such-player'}),{ok:false,why:'gone'});
  const email=`civic-${crypto.randomUUID()}@example.test`;await auth.createUser({email,password:'test-only-password',emailVerified:true});
  const empty=await sign('signInWithPassword',{email,password:'test-only-password'});
  assert.deepEqual(await account(empty,{op:'recruit',by:recruiter.uid}),{ok:false,why:'nation_required'});
});

test('Community Board posts are paced: one every 30 seconds, 20 an hour, 5 of them topics; staff are not',async()=>{
  const r=await player(true),now=Date.now(),ago=(k,ms)=>Array.from({length:k},(_,i)=>now-(i+1)*ms);
  const topic=(p,i)=>civic(p,{op:'cbTopic',reg:'meridian',ti:'Topic number '+i,x:'Some words',tg:'general'});
  const reply=(p,id,x)=>civic(p,{op:'cbReply',reg:'meridian',topic:id,x});
  const first=await topic(r,1);
  await assert.rejects(reply(r,first.id,'Too soon'),e=>e.code==='cb_paced'&&/post again in \d+ seconds/.test(e.message));
  await db.doc('cbPace/'+r.uid).set({p:[now-31000],q:[now-31000]});
  assert.ok((await reply(r,first.id,'Now it fits')).id);
  await db.doc('cbPace/'+r.uid).set({p:ago(5,60000),q:ago(5,60000)});
  await assert.rejects(topic(r,2),e=>e.code==='cb_paced'&&/5 topics in the last hour/.test(e.message));
  assert.ok((await reply(r,first.id,'A reply still fits')).id);
  await db.doc('cbPace/'+r.uid).set({p:ago(20,60000),q:[]});
  await assert.rejects(reply(r,first.id,'The twenty-first'),e=>e.code==='cb_paced'&&/20 times in the last hour/.test(e.message));
  const staff=await player(true);await auth.setCustomUserClaims(staff.uid,{mod:true});
  const t=await topic(staff,3);assert.ok((await reply(staff,t.id,'At once')).id);
});

test('A save dated over a day ahead is refused; a permit lists the new claims and finds; old letters become letters/',async()=>{
  const g=await player(),base={reg:'meridian',name:g.uid,pop:10,army:1,cl:0};
  const save=(n,extra={})=>civic(g,{op:'authorizeSave',record:{...base,updatedAt:Date.now(),j:JSON.stringify({reg:'meridian',name:g.uid,pop:10,...n}),...extra},rev:1});
  await rejects(save({},{updatedAt:Date.now()+2*DAY}),'clock_ahead');
  const dm=[{w:'some-player-1',t:111,x:'Hello there'},{w:'npc-vellmark',t:112,x:'To a computer nation'},{w:'npc-vellmark',t:113,x:'Its reply',i:1},{w:'office-monuments',t:114,x:'To an office'}];
  await db.doc('nations/'+g.uid).update({j:JSON.stringify({reg:'meridian',name:g.uid,pop:10,claims:[{c:5,t:1}],disc:[{s:3,o:'found',t:1}],dm})});
  const kept=await save({claims:[{c:5,t:1}],dm});
  assert.deepEqual(kept.sk,[],'nothing new to stamp');
  assert.equal((await db.collection('letters').where('by','==',g.uid).get()).size,0,'a save that still carries the letters moves none');
  const p=await save({claims:[{c:5,t:1},{c:6,t:2}],disc:[{s:3,o:'found',t:1},{s:4,o:'great',t:2},{s:9,o:'nothing',t:3}]});
  assert.deepEqual([...p.sk].sort(),['c6','s4']);
  const l=await db.doc(`letters/${g.uid}~some-player-1~111`).get();
  assert.equal(l.get('x'),'Hello there');assert.equal(l.get('to'),'some-player-1');assert.equal(l.get('t'),111);
  assert.equal((await db.collection('letters').where('by','==',g.uid).get()).size,1,'only letters to players');
});

/* ── alliances (functions/alliances.js) ── */
const allianceOf = async aid => (await db.doc('alliances/' + aid).get()).data();
async function record(p, patch) { const s = await db.doc('nations/' + p.uid).get(), n = JSON.parse(s.get('j')); Object.assign(n, patch); await s.ref.update({ j: JSON.stringify(n) }); }
const BLOCS = ['npc-vellmark', 'npc-karvesk', 'npc-lucanto', 'npc-ilsund', 'npc-marrowmere'];

test('Alliances: founded by a Registered Nation of 10 million, joined on request, run by officers, and passed on when the leader leaves', async () => {
  const f = await player(true, true), b = await player(true, true), c = await player(), g = await player(true, true), name = 'Pact ' + crypto.randomUUID().slice(0, 8);
  await rejects(civic(c, { op: 'alFound', name }), 'registration_required');
  const { aid } = await civic(f, { op: 'alFound', name, mo: 'Together', ty: 'trade', acc: 'apply', col: '#2a9d8f', em: { p: 'tri-h', c: ['#C8102E', '#FFFFFF', '#152450'], e: 'star', ec: '#F2C230' } });
  let A = await allianceOf(aid);
  assert.equal(A.ld, f.uid); assert.equal(A.ty, 'trade'); assert.equal(A.col, '#2A9D8F'); assert.ok(A.mem[f.uid]);
  assert.equal((await db.doc('allyOf/' + f.uid).get()).get('a'), aid);
  await rejects(civic(g, { op: 'alFound', name: name.toUpperCase() }), 'al_name');
  await rejects(civic(f, { op: 'alFound', name: name + ' II' }), 'al_member');
  await db.doc('nations/' + g.uid).update({ pop: 9 });
  await rejects(civic(g, { op: 'alFound', name: 'Too small' }), 'al_small');
  /* asking: a note waits for an officer; a guest may ask too */
  await civic(b, { op: 'alRequest', aid, x: 'We share a river.' });
  await civic(c, { op: 'alRequest', aid });
  A = await allianceOf(aid); assert.equal(A.rq[b.uid].x, 'We share a river.'); assert.ok(A.rq[c.uid]);
  await assert.rejects(civic(b, { op: 'alAnswer', aid, id: c.uid, yes: true }));
  assert.equal((await civic(f, { op: 'alAnswer', aid, id: b.uid, yes: true })).joined, true);
  await civic(f, { op: 'alRole', aid, id: b.uid, r: 'o' });
  assert.equal((await civic(b, { op: 'alAnswer', aid, id: c.uid, yes: true })).joined, true);
  A = await allianceOf(aid); assert.equal(A.mem[b.uid].r, 'o'); assert.ok(A.mem[c.uid]); assert.equal(A.xp, 20);
  /* an officer removes members, never the leader or another officer */
  await assert.rejects(civic(b, { op: 'alRemove', aid, id: f.uid }));
  /* the leader leaves: the longest-serving officer leads */
  await civic(f, { op: 'alLeave', aid });
  A = await allianceOf(aid); assert.equal(A.ld, b.uid); assert.equal(A.mem[f.uid], undefined); assert.equal(A.mem[b.uid].r, undefined);
  assert.equal((await db.doc('allyOf/' + f.uid).get()).exists, false);
  assert.ok(A.log.some(e => e.k === 'leader' && e.a === b.uid && e.x === 'left'));
  /* an invitation-only alliance turns away a request; an invitation lets the nation in */
  await civic(b, { op: 'alEdit', aid, acc: 'invite', mo: 'Closed doors' });
  await rejects(civic(f, { op: 'alRequest', aid }), 'al_closed');
  await civic(b, { op: 'alInvite', aid, id: f.uid });
  assert.equal((await civic(f, { op: 'alRequest', aid })).joined, true);
  /* the type changes once a week */
  await civic(b, { op: 'alEdit', aid, ty: 'def' });
  await rejects(civic(b, { op: 'alEdit', aid, ty: 'research' }), 'al_type_wait');
  /* the leader dissolves it */
  await civic(b, { op: 'alLeave', aid, disband: true });
  assert.equal((await db.doc('alliances/' + aid).get()).exists, false);
  for (const p of [b, c, f]) assert.equal((await db.doc('allyOf/' + p.uid).get()).exists, false);
});

test('Alliances: pledges are credited once, projects need the level and the treasury, and the daily tally earns renown and replaces an absent leader', async () => {
  const f = await player(true, true), b = await player(true, true), now = Date.now();
  const { aid } = await civic(f, { op: 'alFound', name: 'Treasury ' + crypto.randomUUID().slice(0, 8), acc: 'open' });
  await civic(b, { op: 'alRequest', aid });
  await record(f, { alp: [{ t: now - 2000, k: 'goods', q: 50, a: aid }, { t: now - 1000, k: 'timber', q: 45, a: aid }, { t: now - 900, k: 'iron', q: 9, a: 'elsewhere' }] });
  const d1 = await civic(f, { op: 'alDonate', aid });
  assert.deepEqual(d1.credited, { goods: 50, timber: 45 }); assert.equal(d1.xp, 9);
  assert.deepEqual((await civic(f, { op: 'alDonate', aid })).credited, {});
  let A = await allianceOf(aid); assert.equal(A.tr.goods, 50); assert.equal(A.dn[f.uid].lt, now - 1000);
  await rejects(civic(f, { op: 'alBuild', aid, p: 'market' }), 'al_level');
  await civic(f, { op: 'alBuild', aid, p: 'hall' });
  A = await allianceOf(aid); assert.equal(A.pj.hall, 1); assert.equal(A.tr.timber, 5); assert.equal(A.tr.goods, 20);
  await rejects(civic(f, { op: 'alBuild', aid, p: 'granary' }), 'al_treasury');
  await assert.rejects(civic(b, { op: 'alBuild', aid, p: 'granary' }));
  /* the tally: a deal between the two, a gift, a battle fought in an ally's war, both active; once a day */
  await record(f, { deals: [{ id: 'd1', w: b.uid, g: ['food', 1], r: ['iron', 1], t: now - 5000 }], gft: [{ id: 'g1', to: b.uid, k: 'card', m: 0, t: now - 4000 }] });
  await record(b, { deals: [{ id: 'd1', w: f.uid, a: 1, g: ['iron', 1], r: ['food', 1], t: now - 4500 }], conq: [{ c: 5, t: now - 3000, w: f.uid, d: 'npc-x' }] });
  await db.doc('alliances/' + aid).update({ tt: now - 21 * 3600e3 });
  const t1 = await civic(b, { op: 'alTally', aid });
  assert.deepEqual(t1.parts, { active: 2, deals: 1, gifts: 1, battles: 1, calls: 0 });
  assert.equal(t1.xp, 2 * 3 + 2 + 2 + 5);
  assert.equal((await civic(b, { op: 'alTally', aid })).skipped, true);
  /* a leader away for a week hands over to a member who still plays */
  await db.doc('nations/' + f.uid).update({ updatedAt: now - 8 * 86400000 });
  await db.doc('alliances/' + aid).update({ tt: now - 21 * 3600e3 });
  await civic(b, { op: 'alTally', aid });
  A = await allianceOf(aid); assert.equal(A.ld, b.uid); assert.ok(A.mem[f.uid], 'the old leader stays a member');
  assert.ok(A.log.some(e => e.k === 'leader' && e.x === 'away'));
});

test('Alliances: computer nations join by affinity with the leader, and an alliance from before moves over under its founder', async () => {
  const data = JSON.parse(fs.readFileSync(new URL('../functions/civic-data.json', import.meta.url), 'utf8'));
  const npc = data.regions.find(r => r.id === 'meridian').npcs.find(n => !BLOCS.includes(n.id));
  const f = await player(true, true);
  const { aid } = await civic(f, { op: 'alFound', name: 'Machines ' + crypto.randomUUID().slice(0, 8) });
  /* values as far from the computer nation's as they go */
  const far = k => ((npc.s[k] ?? 50) >= 50 ? 0 : 100);
  await record(f, { s: { civil: far('civil'), econ: far('econ'), pol: far('pol') }, gw: {} });
  await rejects(civic(f, { op: 'alInvite', aid, id: npc.id }), 'al_affinity');
  await record(f, { s: { civil: npc.s.civil, econ: npc.s.econ, pol: npc.s.pol } });
  assert.equal((await civic(f, { op: 'alInvite', aid, id: npc.id })).joined, true);
  assert.equal((await db.doc('allyOf/' + npc.id).get()).get('a'), aid);
  await rejects(civic(f, { op: 'alInvite', aid, id: 'npc-vellmark' }), 'al_bloc');
  await civic(f, { op: 'alLeave', aid, disband: true });
  assert.equal((await db.doc('allyOf/' + npc.id).get()).exists, false);
  /* an old alliance: in its founder's record, with a member whose record names the founder */
  const L = await player(true, true), m = await player(true, true), now = Date.now();
  await record(L, { alli: { name: 'Old Guard', t: now - 10 * 86400000, inv: [{ id: m.uid, t: now - 9 * 86400000 }] } });
  await record(m, { allyOf: L.uid });
  assert.equal((await civic(m, { op: 'alMigrate', f: L.uid })).aid, L.uid);
  const A = await allianceOf(L.uid);
  assert.equal(A.name, 'Old Guard'); assert.equal(A.ld, L.uid); assert.ok(A.mem[m.uid]); assert.equal(A.xp, 50);
  assert.equal((await db.doc('allyOf/' + m.uid).get()).get('a'), L.uid);
  assert.equal((await civic(L, { op: 'alMigrate', f: L.uid })).aid, L.uid, 'asked again, it is already there');
  await civic(L, { op: 'alLeave', aid: L.uid, disband: true });
});
