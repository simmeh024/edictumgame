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
  // the board may already hold the Assembly's debate topics (functions/civic.js, debateTopic): count from here
  const was=(await db.doc('cb/frostmarch').get()).data()||{},today=new Date().toISOString().slice(0,10);
  await rejects(civic(g,{op:'cbTopic',reg:'meridian',ti:'Guest topic',x:'Hello'}),'registration_required');
  await db.doc('shop/'+r.uid).set({owns:{founder:Date.now()}});
  const t=await civic(r,{op:'cbTopic',reg:'frostmarch',ti:'  Grain for steel  ',x:'Anyone <b>selling</b> steel?',tg:'trade',a:'forged',fd:false,st:'admin',rc:99});
  const topic=(await db.doc('cb/frostmarch/posts/'+t.id).get()).data();
  assert.equal(topic.a,r.uid);assert.equal(topic.rg,'meridian');assert.equal(topic.ti,'Grain for steel');assert.equal(topic.tg,'trade');assert.equal(topic.fd,true);assert.equal(topic.st,undefined);assert.equal(topic.rc,0);
  const rep=await civic(far,{op:'cbReply',reg:'frostmarch',topic:t.id,x:'I have steel.'});
  await db.doc('cbPace/'+r.uid).delete();                                 // the pacing has a test of its own
  await civic(r,{op:'cbReply',reg:'frostmarch',topic:t.id,x:'Deal.'});
  assert.equal((await db.doc('cb/frostmarch/posts/'+t.id).get()).get('rc'),2);
  const meta=(await db.doc('cb/frostmarch').get()).data();assert.equal(meta.n,(was.n||0)+1);assert.equal(meta.r,(was.r||0)+2);assert.equal(meta.dn,(was.dd===today?was.dn||0:0)+3);
  await assert.rejects(civic(r,{op:'cbEdit',reg:'frostmarch',topic:t.id,reply:rep.id,x:'Not mine'}),e=>e.status==='PERMISSION_DENIED');
  await civic(far,{op:'cbEdit',reg:'frostmarch',topic:t.id,reply:rep.id,x:'I have iron.'});
  assert.equal((await db.doc('cb/frostmarch/posts/'+t.id+'/posts/'+rep.id).get()).get('x'),'I have iron.');
  await assert.rejects(civic(r,{op:'cbMod',act:'lock',reg:'frostmarch',topic:t.id}),e=>e.status==='PERMISSION_DENIED');
  await assert.rejects(civic(r,{op:'cbTopic',reg:'atlantis',ti:'Nowhere',x:'x'}),e=>e.status==='INVALID_ARGUMENT');
  await db.doc('bans/'+far.uid).set({t:Date.now()});await rejects(civic(far,{op:'cbReply',reg:'frostmarch',topic:t.id,x:'Banned'}),'banned');
});

test('Community Board: staff pin, lock, hide, move and delete from inside the board, with an audit trail',async()=>{
  const r=await player(true),o=await player(true),staff=await player(true);await auth.setCustomUserClaims(staff.uid,{admin:true});
  const was=(await db.doc('cb/wildwood').get()).data()||{};
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
  const w=(await db.doc('cb/wildwood').get()).data();assert.equal(w.n,was.n||0);assert.equal(w.r,was.r||0);
  const log=await db.collection('adminAudit').where('topic','==',t.id).get();
  assert.deepEqual(new Set(log.docs.map(x=>x.get('action'))),new Set(['board_pin','board_lock','board_hide','board_unhide','board_move','board_delete']));
});

test('Community Board: an admin posts one topic on several boards as the Edictum team, which any admin may edit',async()=>{
  const r=await player(true),staff=await player(true),other=await player(true),bare=await sign('signUp',{});
  await Promise.all([staff,other,bare].map(p=>auth.setCustomUserClaims(p.uid,{admin:true})));
  const d={op:'cbPost',regs:['meridian','frostmarch','atlantis','meridian'],ti:'  Server maintenance  ',x:'Back in an hour.',tg:'help',as:'team',nm:'Pascal',rl:'Lead developer',pn:true};
  await assert.rejects(civic(r,d),e=>e.status==='PERMISSION_DENIED');
  await assert.rejects(civic(staff,{...d,regs:['atlantis']}),e=>e.status==='INVALID_ARGUMENT');
  await assert.rejects(civic(staff,{...d,ti:'Hi'}),e=>e.status==='INVALID_ARGUMENT');
  const before=(await db.doc('cb/frostmarch').get()).get('n')||0;
  // an admin with no nation of their own still signs as the team; a region it does not know, or named twice, is skipped
  const res=await civic(bare,d);
  assert.deepEqual(Object.keys(res.ids).sort(),['frostmarch','meridian']);
  const tref=db.doc('cb/meridian/posts/'+res.ids.meridian),t=(await tref.get()).data();
  assert.equal(t.of,true);assert.equal(t.a,bare.uid);assert.equal(t.nm,'Pascal');assert.equal(t.rl,'Lead developer');assert.equal(t.st,'admin');assert.equal(t.rg,'');assert.equal(t.fl,undefined);
  assert.equal(t.ti,'Server maintenance');assert.equal(t.tg,'help');assert.equal(t.pn,true);assert.equal(t.lk,undefined);assert.equal(t.rc,0);
  assert.equal((await db.doc('cb/frostmarch/posts/'+res.ids.frostmarch).get()).get('x'),'Back in an hour.');
  assert.equal((await db.doc('cb/frostmarch').get()).get('n'),before+1);
  // as the admin's nation, locked
  const n=await civic(staff,{...d,regs:['frostmarch'],as:'nation',lk:true}),nt=(await db.doc('cb/frostmarch/posts/'+n.ids.frostmarch).get()).data();
  assert.equal(nt.of,undefined);assert.equal(nt.nm,staff.uid);assert.equal(nt.rg,'meridian');assert.equal(nt.st,'admin');assert.equal(nt.lk,true);assert.equal(nt.rl,undefined);
  // a player who asks to sign as the team still signs as their nation
  const p=await civic(r,{op:'cbReply',reg:'meridian',topic:res.ids.meridian,x:'Thanks',as:'team',nm:'Edictum team'});
  const pr=(await tref.collection('posts').doc(p.id).get()).data();assert.equal(pr.of,undefined);assert.equal(pr.nm,r.uid);assert.equal(pr.st,undefined);
  // another admin answers as the team, with the plain signature, and edits the team's topic; a player may not
  const a=await civic(other,{op:'cbReply',reg:'meridian',topic:res.ids.meridian,x:'Ask away',as:'team'});
  const ar=(await tref.collection('posts').doc(a.id).get()).data();assert.equal(ar.of,true);assert.equal(ar.nm,'Edictum team');assert.equal(ar.rl,undefined);
  await civic(other,{op:'cbEdit',reg:'meridian',topic:res.ids.meridian,ti:'Server maintenance tonight',x:'Back in two hours.'});
  const ed=(await tref.get()).data();assert.equal(ed.ti,'Server maintenance tonight');assert.equal(ed.nm,'Pascal');assert.ok(ed.ed>0);
  await assert.rejects(civic(r,{op:'cbEdit',reg:'meridian',topic:res.ids.meridian,ti:'Mine now',x:'Mine now'}),e=>e.status==='PERMISSION_DENIED');
  await assert.rejects(civic(other,{op:'cbEdit',reg:'meridian',topic:res.ids.meridian,reply:p.id,x:'Not yours'}),e=>e.status==='PERMISSION_DENIED');
  assert.equal((await tref.get()).get('rc'),2);
  const log=await db.collection('adminAudit').where('actor','==',bare.uid).get(),e=log.docs.find(x=>x.get('action')==='board_post');
  assert.ok(e);assert.deepEqual(e.get('topics'),res.ids);assert.match(e.get('reason'),/Server maintenance/);
});

test('Region message board: an admin posts on any region’s board as the Edictum team, unpaced; a player cannot',async()=>{
  const r=await player(true),staff=await sign('signUp',{});await auth.setCustomUserClaims(staff.uid,{admin:true});
  // an admin with no nation at all, on a region that is not theirs
  const t=await civic(staff,{op:'topic',reg:'frostmarch',text:'Hello from the team',as:'team',nm:'Pascal',rl:'Lead developer'});
  const d=(await db.doc('boards/frostmarch/posts/'+t.id).get()).data();
  assert.equal(d.a,staff.uid);assert.equal(d.of,true);assert.equal(d.nm,'Pascal');assert.equal(d.rl,'Lead developer');assert.equal(d.st,'admin');assert.equal(d.x,'Hello from the team');
  const w=await civic(staff,{op:'topic',reg:'wildwood',text:'And here at once',as:'team'});
  const wd=(await db.doc('boards/wildwood/posts/'+w.id).get()).data();assert.equal(wd.nm,'Edictum team');assert.equal(wd.rl,undefined);
  await assert.rejects(civic(staff,{op:'topic',reg:'atlantis',text:'Nowhere',as:'team'}),e=>e.status==='INVALID_ARGUMENT');
  await assert.rejects(civic(staff,{op:'topic',reg:'frostmarch',text:'As a nation I have none'}),e=>e.code==='nation_required');
  // a player who asks to sign as the team still posts as their nation, and only on their own region's board
  await assert.rejects(civic(r,{op:'topic',reg:'frostmarch',text:'Not my region',as:'team'}),e=>e.status==='PERMISSION_DENIED');
  const p=await civic(r,{op:'topic',reg:'meridian',text:'My own region',as:'team',nm:'Edictum team'});
  const pd=(await db.doc('boards/meridian/posts/'+p.id).get()).data();assert.equal(pd.a,r.uid);assert.equal(pd.of,undefined);assert.equal(pd.nm,undefined);assert.equal(pd.st,undefined);
});

test('Region message board: replies stay one level deep on the same board; a nation has one reaction a message, and a second click takes it back',async()=>{
  const a=await player(true),b=await player(true),c=await player(true),g=await player(),far=await player(true,false,'frostmarch');
  const top=await civic(a,{op:'topic',text:'A question for the region'});
  const re=await civic(b,{op:'topic',text:'An answer',re:top.id});
  const rd=(await db.doc('boards/meridian/posts/'+re.id).get()).data();assert.equal(rd.re,top.id);assert.equal(rd.a,b.uid);assert.equal(rd.x,'An answer');
  // not to a reply, not to a message that is gone, not across regions: a refused reply leaves no pacing behind
  await rejects(civic(c,{op:'topic',text:'Deeper still',re:re.id}),'rmb_reply_missing');
  await rejects(civic(c,{op:'topic',text:'To nothing',re:'A'.repeat(20)}),'rmb_reply_missing');
  await assert.rejects(civic(c,{op:'topic',text:'A bad id',re:'short'}),e=>e.status==='INVALID_ARGUMENT');
  await rejects(civic(far,{op:'topic',text:'From the Frostmarch',re:top.id}),'rmb_reply_missing');
  const ok=await civic(c,{op:'topic',text:'A second answer',re:top.id});assert.equal((await db.doc('boards/meridian/posts/'+ok.id).get()).get('re'),top.id);
  // reactions: a guest nation too; another kind replaces the first, the same kind again takes it back
  assert.deepEqual(await civic(g,{op:'topicReact',post:top.id,e:'heart'}),{e:'heart'});
  assert.deepEqual(await civic(b,{op:'topicReact',post:top.id,e:'up'}),{e:'up'});
  assert.deepEqual((await db.doc('boards/meridian/posts/'+top.id).get()).get('rv'),{[g.uid]:'heart',[b.uid]:'up'});
  assert.deepEqual(await civic(b,{op:'topicReact',post:top.id,e:'party'}),{e:'party'});
  assert.deepEqual(await civic(g,{op:'topicReact',post:top.id,e:'heart'}),{e:''});
  assert.deepEqual((await db.doc('boards/meridian/posts/'+top.id).get()).get('rv'),{[b.uid]:'party'});
  await civic(g,{op:'topicReact',post:re.id,e:'think'});
  assert.deepEqual((await db.doc('boards/meridian/posts/'+re.id).get()).get('rv'),{[g.uid]:'think'});
  await assert.rejects(civic(b,{op:'topicReact',post:top.id,e:'angry'}),e=>e.status==='INVALID_ARGUMENT');
  await rejects(civic(far,{op:'topicReact',post:top.id,e:'up'}),'rmb_missing');
  await assert.rejects(civic(far,{op:'topicReact',reg:'meridian',post:top.id,e:'up'}),e=>e.status==='PERMISSION_DENIED');
  await db.doc('mod/'+c.uid).set({hidden:true,t:Date.now()});await rejects(civic(c,{op:'topicReact',post:top.id,e:'up'}),'moderated');
  // a closed account takes its reactions with it
  await civic(g,{op:'topicReact',post:top.id,e:'up'});
  await db.doc('nations/'+g.uid).delete();await account(g,{op:'close'});
  assert.deepEqual((await db.doc('boards/meridian/posts/'+top.id).get()).get('rv'),{[b.uid]:'party'});
  assert.equal((await db.doc('boards/meridian/posts/'+re.id).get()).get('rv.'+g.uid),undefined);
});

test('A new record starts no larger than a new nation could have grown, the account\'s last save, or the guest it was carried from',async()=>{
  const save=(p,pop,{rev=0,name='Freshland',...extra}={})=>civic(p,{op:'authorizeSave',record:{reg:'meridian',name,pop,army:1,cl:0,updatedAt:Date.now(),j:JSON.stringify({reg:'meridian',name,pop})},rev,...extra});
  const big=async(p,ck)=>{await db.doc('nations/'+p.uid).update({pop:900,ts:new Date()});assert.ok((await save(p,900,{rev:1,name:p.uid,...(ck?{ck}:{})})).permit);};
  const KEY='a'.repeat(64), KEY2='b'.repeat(64);
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
  // a guest's nation carried into an account: from that guest's last save, once, and only with the guest's carry key
  const guest=await player();await big(guest,KEY);await db.doc('nations/'+guest.uid).delete();
  assert.ok((await hw(guest)).k&&(await hw(guest)).k!==KEY,'only a hash of the key is kept');
  const into=await sign('signUp',{}), other=await sign('signUp',{});
  await rejects(save(into,900,{name:guest.uid}),'population_limit');
  await rejects(save(into,900,{name:guest.uid,from:guest.uid}),'population_limit');
  await rejects(save(into,900,{name:guest.uid,from:guest.uid,fk:KEY2}),'population_limit');
  assert.ok((await save(into,900,{name:guest.uid,from:guest.uid,fk:KEY})).permit);
  assert.equal((await hw(guest)).to,into.uid);
  await rejects(save(other,900,{name:guest.uid,from:guest.uid,fk:KEY}),'population_limit');
  // never from a Registered Nation still in the region (its saves note no key), nor from a guest's of another name
  const kept=await player(true);await big(kept,KEY);assert.equal((await hw(kept)).k,undefined);
  await rejects(save(other,900,{name:kept.uid,from:kept.uid,fk:KEY}),'population_limit');
  const live=await player();await big(live,KEY);
  await rejects(save(other,900,{name:'Another name',from:live.uid,fk:KEY}),'population_limit');
  assert.ok((await save(other,900,{name:live.uid,from:live.uid,fk:KEY})).permit,'a guest copy of the same name, which a switch could not drop first');
  // never from a banned account
  const gone=await player();await big(gone,KEY);await db.doc('nations/'+gone.uid).delete();await db.doc('bans/'+gone.uid).set({note:'Cheating',t:1,by:'staff'});
  await rejects(save(await sign('signUp',{}),900,{name:gone.uid,from:gone.uid,fk:KEY}),'population_limit');
  // a guest whose saves never sent a key notes it before switching (src/shim.js, otherAccount)
  const quiet=await player();await big(quiet);assert.equal((await hw(quiet)).k,undefined);
  assert.deepEqual(await civic(quiet,{op:'carryKey',ck:'not a key'}),{ok:false});
  assert.deepEqual(await civic(quiet,{op:'carryKey',ck:KEY2}),{ok:true});
  await db.doc('nations/'+quiet.uid).delete();
  assert.ok((await save(await sign('signUp',{}),900,{name:quiet.uid,from:quiet.uid,fk:KEY2})).permit);
  assert.deepEqual(await civic(await player(true),{op:'carryKey',ck:KEY}),{ok:false},'a Registered Nation has no carry key');
});

test('A save cannot add letters through the old shared letter list (dm); one it already had becomes letters once, which expire',async()=>{
  const p=await player(), victim=await player();
  const save=n=>civic(p,{op:'authorizeSave',record:{reg:'meridian',name:p.uid,pop:10,army:1,cl:0,updatedAt:Date.now(),j:JSON.stringify({reg:'meridian',name:p.uid,pop:10,...n})},rev:1});
  const sent=async()=>(await db.collection('letters').where('by','==',p.uid).get()).docs;
  // a list the saved record never had is not approved, and so never turns into letters
  assert.equal(JSON.parse((await save({dm:[{w:victim.uid,x:'Spam',t:123}]})).j).dm,undefined);
  assert.ok((await save({})).permit);assert.equal((await sent()).length,0);
  // a list from before letters were private: kept only as it was, then turned into letters once dropped
  const old=[{w:victim.uid,x:'An old letter',t:456}];
  const s=await db.doc('nations/'+p.uid).get();await s.ref.update({j:JSON.stringify({...JSON.parse(s.get('j')),dm:old})});
  assert.deepEqual(JSON.parse((await save({dm:[...old,{w:victim.uid,x:'Added',t:789}]})).j).dm,old);
  assert.equal((await sent()).length,0);
  await save({});
  const ls=await sent();assert.deepEqual(ls.map(d=>d.id),[p.uid+'~'+victim.uid+'~456']);
  assert.ok(ls[0].get('exp').toMillis()>Date.now()+360*DAY,'expires like any other letter');
});

test('civic refuses an unknown request before it reads anything',async()=>{
  await assert.rejects(civic(await player(),{op:'nonsense'}),e=>e.status==='INVALID_ARGUMENT');
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

test('Community Board: authors and repliers follow a topic, each reply counts on the other followers’ copies, and muting stops it',async()=>{
  const a=await player(true),b=await player(true),c=await player(true),g=await player(),staff=await player(true);await auth.setCustomUserClaims(staff.uid,{admin:true});
  const t=await civic(a,{op:'cbTopic',reg:'meridian',ti:'Iron for oil?',x:'Who trades?'});
  const w=(p,id=t.id)=>db.doc('cbWatch/'+p.uid+'/t/'+id).get().then(s=>s.exists?s.data():null),subs=()=>db.doc('cbSubs/'+t.id).get();
  let wa=await w(a);assert.equal(wa.f,1);assert.equal(wa.n,0);assert.equal(wa.reg,'meridian');assert.equal(wa.ti,'Iron for oil?');
  assert.deepEqual((await subs()).get('f'),{[a.uid]:1});
  await civic(b,{op:'cbReply',reg:'meridian',topic:t.id,x:'I do.'});
  wa=await w(a);assert.equal(wa.n,1);assert.equal(wa.nm,b.uid);assert.ok(wa.nt>Date.now()-60000);
  let wb=await w(b);assert.equal(wb.f,1);assert.equal(wb.n,0);
  // anyone who reads the board may follow, a guest too
  assert.deepEqual(await civic(g,{op:'cbFollow',reg:'meridian',topic:t.id,on:true}),{ok:true,f:1});assert.equal((await w(g)).f,1);
  await civic(c,{op:'cbReply',reg:'meridian',topic:t.id,x:'Me too.'});
  wa=await w(a);assert.equal(wa.n,2);assert.equal(wa.nm,c.uid);assert.equal((await w(b)).n,1);assert.equal((await w(g)).n,1);assert.equal((await w(c)).n,0);
  // b mutes it: replying again does not follow it again
  await civic(b,{op:'cbFollow',reg:'meridian',topic:t.id,on:false});wb=await w(b);assert.equal(wb.f,0);assert.equal(wb.n,0);
  await db.doc('cbPace/'+b.uid).delete();
  await civic(b,{op:'cbReply',reg:'meridian',topic:t.id,x:'Still here.'});
  assert.equal((await w(b)).f,0);assert.equal((await w(b)).n,0);assert.equal((await subs()).get('f')[b.uid],0);assert.equal((await w(a)).n,3);
  // a topic from before following began: its author follows it from the first reply
  const old=db.collection('cb/meridian/posts').doc();await old.set({a:c.uid,nm:c.uid,rg:'meridian',ti:'An old topic',x:'Old words',tg:'general',t:Date.now()-DAY,la:Date.now()-DAY,rc:0});
  await db.doc('cbPace/'+a.uid).delete();await civic(a,{op:'cbReply',reg:'meridian',topic:old.id,x:'Late answer'});
  assert.equal((await w(c,old.id)).n,1);assert.equal((await w(a,old.id)).f,1);
  // a hidden topic's title leaves the copies and comes back; moved, they follow it; deleted, they go
  await civic(staff,{op:'cbMod',act:'hide',reg:'meridian',topic:t.id});assert.equal((await w(a)).ti,'');
  await civic(staff,{op:'cbMod',act:'unhide',reg:'meridian',topic:t.id});assert.equal((await w(a)).ti,'Iron for oil?');
  await civic(staff,{op:'cbMod',act:'move',reg:'meridian',topic:t.id,to:'wildwood'});assert.equal((await w(a)).reg,'wildwood');assert.equal((await subs()).get('reg'),'wildwood');
  await civic(staff,{op:'cbDelete',reg:'wildwood',topic:t.id});
  assert.equal(await w(a),null);assert.equal(await w(b),null);assert.equal(await w(g),null);assert.equal((await subs()).exists,false);
  await rejects(civic(a,{op:'cbFollow',reg:'wildwood',topic:t.id,on:true}),'cb_missing');
  await assert.rejects(civic(a,{op:'cbFollow',reg:'wildwood',topic:'nope',on:true}),e=>e.status==='INVALID_ARGUMENT');
});

test('Community Board: one reaction per nation on each post, the same again takes it back; a reply quotes a post under its own topic',async()=>{
  const a=await player(true),b=await player(true),g=await player(),x=await player(true),staff=await player(true);await auth.setCustomUserClaims(staff.uid,{admin:true});
  const t=await civic(a,{op:'cbTopic',reg:'meridian',ti:'React to me',x:'Words'});
  const r1=await civic(b,{op:'cbReply',reg:'meridian',topic:t.id,x:'A reply'});
  const ref=db.doc('cb/meridian/posts/'+t.id),rref=ref.collection('posts').doc(r1.id),la=(await ref.get()).get('la');
  assert.deepEqual(await civic(g,{op:'cbReact',reg:'meridian',topic:t.id,e:'heart'}),{e:'heart'});
  await civic(b,{op:'cbReact',reg:'meridian',topic:t.id,e:'up'});
  assert.deepEqual((await ref.get()).get('rv'),{[g.uid]:'heart',[b.uid]:'up'});
  await civic(g,{op:'cbReact',reg:'meridian',topic:t.id,e:'party'});assert.equal((await ref.get()).get('rv')[g.uid],'party');
  assert.deepEqual(await civic(g,{op:'cbReact',reg:'meridian',topic:t.id,e:'party'}),{e:''});assert.equal((await ref.get()).get('rv')[g.uid],undefined);
  assert.equal((await ref.get()).get('la'),la);
  await civic(a,{op:'cbReact',reg:'meridian',topic:t.id,reply:r1.id,e:'think'});assert.deepEqual((await rref.get()).get('rv'),{[a.uid]:'think'});
  assert.deepEqual((await db.doc('cbRx/'+a.uid).get()).get('p'),['meridian/'+t.id+'/'+r1.id]);
  await assert.rejects(civic(a,{op:'cbReact',reg:'meridian',topic:t.id,e:'angry'}),e=>e.status==='INVALID_ARGUMENT');
  // quotes: a reply under the same topic, or the topic itself; never another topic's post
  await db.doc('cbPace/'+a.uid).delete();
  const q1=await civic(a,{op:'cbReply',reg:'meridian',topic:t.id,x:'Quoting you',q:r1.id});assert.equal((await ref.collection('posts').doc(q1.id).get()).get('q'),r1.id);
  await db.doc('cbPace/'+a.uid).delete();
  const q2=await civic(a,{op:'cbReply',reg:'meridian',topic:t.id,x:'Quoting the topic',q:t.id});assert.equal((await ref.collection('posts').doc(q2.id).get()).get('q'),t.id);
  const other=await civic(x,{op:'cbTopic',reg:'meridian',ti:'Another topic',x:'Elsewhere'});
  await db.doc('cbPace/'+a.uid).delete();
  await rejects(civic(a,{op:'cbReply',reg:'meridian',topic:t.id,x:'Wrong topic',q:other.id}),'cb_quote_missing');
  await assert.rejects(civic(a,{op:'cbReply',reg:'meridian',topic:t.id,x:'Bad id',q:'nope'}),e=>e.status==='INVALID_ARGUMENT');
  // a hidden reply is neither quoted nor reacted to
  await civic(staff,{op:'cbMod',act:'hide',reg:'meridian',topic:t.id,reply:r1.id});
  await rejects(civic(a,{op:'cbReply',reg:'meridian',topic:t.id,x:'Quoting the hidden',q:r1.id}),'cb_quote_missing');
  await rejects(civic(g,{op:'cbReact',reg:'meridian',topic:t.id,reply:r1.id,e:'up'}),'cb_missing');
  // the account closes: its reactions, the topics it followed and its profile go with it
  await db.doc('nations/'+a.uid).delete();await account(a,{op:'close'});
  assert.equal(((await rref.get()).get('rv')||{})[a.uid],undefined);
  assert.equal((await db.doc('cbRx/'+a.uid).get()).exists,false);assert.equal((await db.doc('cbUser/'+a.uid).get()).exists,false);
  assert.equal((await db.collection('cbWatch/'+a.uid+'/t').get()).size,0);assert.equal(((await db.doc('cbSubs/'+t.id).get()).get('f')||{})[a.uid],undefined);
});

test('Community Board: a nation’s board profile counts its posts and carries its rank, alliance, marks and signature',async()=>{
  const a=await player(true),b=await player(true),staff=await player(true);await auth.setCustomUserClaims(staff.uid,{admin:true});
  // posts from before profiles are counted once, at the next post
  const old=db.collection('cb/meridian/posts').doc();await old.set({a:a.uid,nm:a.uid,rg:'meridian',ti:'Older',x:'x',tg:'general',t:1,la:1,rc:1});
  await old.collection('posts').doc().set({a:a.uid,nm:a.uid,rg:'meridian',x:'An older reply',t:2});
  await db.doc('shop/'+a.uid).set({owns:{founder:Date.now()},vip:{until:Date.now()+DAY}});
  await db.doc('alliances/al-'+a.uid).set({name:'The Iron Pact',col:'#aa3311',reg:'meridian',mem:{[a.uid]:{t:1}}});await db.doc('allyOf/'+a.uid).set({a:'al-'+a.uid,reg:'meridian',t:1});
  const t=await civic(a,{op:'cbTopic',reg:'meridian',ti:'My profile',x:'Hello',rk:7});
  let u=(await db.doc('cbUser/'+a.uid).get()).data();
  assert.equal(u.n,3);assert.equal(u.rk,7);assert.deepEqual(u.al,{n:'The Iron Pact',c:'#AA3311'});assert.equal(u.cl,true);assert.equal(u.fd,true);assert.equal(u.nm,a.uid);assert.equal(u.rg,'meridian');
  await db.doc('cbPace/'+a.uid).delete();await db.doc('allyOf/'+a.uid).delete();await db.doc('shop/'+a.uid).set({owns:{founder:1}});
  const r=await civic(a,{op:'cbReply',reg:'meridian',topic:t.id,x:'Again',rk:500});
  u=(await db.doc('cbUser/'+a.uid).get()).data();assert.equal(u.n,4);assert.equal(u.rk,undefined);assert.equal(u.al,undefined);assert.equal(u.cl,undefined);assert.equal(u.fd,true);
  // the signature: the player's own line; a guest has none; staff take one away
  assert.deepEqual(await civic(a,{op:'cbSig',sg:'  Long   live the Pact!  '}),{ok:true,sg:'Long live the Pact!'});assert.equal((await db.doc('cbUser/'+a.uid).get()).get('sg'),'Long live the Pact!');
  await rejects(civic(await player(),{op:'cbSig',sg:'A guest'}),'registration_required');
  await assert.rejects(civic(b,{op:'cbMod',act:'nosig',reg:'meridian',topic:t.id,reply:r.id}),e=>e.status==='PERMISSION_DENIED');
  await civic(staff,{op:'cbMod',act:'nosig',reg:'meridian',topic:t.id,reply:r.id,reason:'Rude'});assert.equal((await db.doc('cbUser/'+a.uid).get()).get('sg'),undefined);
  const log=await db.collection('adminAudit').where('topic','==',t.id).where('action','==','board_nosig').get();assert.equal(log.size,1);assert.equal(log.docs[0].get('x'),'Long live the Pact!');
  await civic(a,{op:'cbSig',sg:'Peace'});await civic(a,{op:'cbSig',sg:''});assert.equal((await db.doc('cbUser/'+a.uid).get()).get('sg'),undefined);
  // a post deleted lowers its author's count; a topic deleted takes its replies' counts too
  await civic(b,{op:'cbReply',reg:'meridian',topic:t.id,x:'A reply of b'});assert.equal((await db.doc('cbUser/'+b.uid).get()).get('n'),1);
  await civic(a,{op:'cbDelete',reg:'meridian',topic:t.id,reply:r.id});assert.equal((await db.doc('cbUser/'+a.uid).get()).get('n'),3);
  await civic(staff,{op:'cbDelete',reg:'meridian',topic:t.id});
  assert.equal((await db.doc('cbUser/'+a.uid).get()).get('n'),2);assert.equal((await db.doc('cbUser/'+b.uid).get()).get('n'),0);
  // the Edictum team's posts are nobody's
  await civic(staff,{op:'cbTopic',reg:'meridian',ti:'Team news',x:'Hello all',as:'team'});assert.equal((await db.doc('cbUser/'+staff.uid).get()).exists,false);
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
  /* founding opens at 7.5 million */
  await db.doc('nations/' + g.uid).update({ pop: 7.4 });
  await rejects(civic(g, { op: 'alFound', name: 'Too small' }), 'al_small');
  await db.doc('nations/' + g.uid).update({ pop: 7.5 });
  const big = await civic(g, { op: 'alFound', name: 'Just big enough ' + crypto.randomUUID().slice(0, 8) });
  await civic(g, { op: 'alLeave', aid: big.aid, disband: true });
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
  /* a Hall of Chronicles of level 2: a fifth more renown, rounded, and named in the tally */
  await db.doc('alliances/' + aid).update({ tt: now - 21 * 3600e3, 'pj.chronicle': 2 });
  const xp0 = (await allianceOf(aid)).xp, t3 = await civic(b, { op: 'alTally', aid }), base = t3.xp - t3.parts.chron;
  assert.ok(base > 0 && t3.parts.chron === Math.round(base * 0.2), JSON.stringify(t3));
  assert.equal((await allianceOf(aid)).xp, xp0 + t3.xp);
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

test('Treaties: offered and accepted, limited, ended with notice or broken; a computer nation answers by affinity and shuns a breaker', async () => {
  const data = JSON.parse(fs.readFileSync(new URL('../functions/civic-data.json', import.meta.url), 'utf8'));
  const npc = data.regions.find(r => r.id === 'meridian').npcs.find(n => !BLOCS.includes(n.id));
  const a = await player(true, true), b = await player(true, true), g = await player(), now = Date.now();
  const tid = k => k + '_' + [a.uid, b.uid].sort().join('_'), treaty = async id => (await db.doc('treaties/' + id).get()).data();
  await rejects(civic(g, { op: 'trOffer', id: a.uid, k: 'nap' }), 'registration_required');
  await assert.rejects(civic(a, { op: 'trOffer', id: a.uid, k: 'nap' }));
  await assert.rejects(civic(a, { op: 'trOffer', id: b.uid, k: 'alliance' }));
  /* offered, then accepted */
  assert.equal((await civic(a, { op: 'trOffer', id: b.uid, k: 'nap' })).signed, false);
  let T = await treaty(tid('nap')); assert.equal(T.st, 'offered'); assert.equal(T.a, a.uid); assert.deepEqual(T.p, [a.uid, b.uid].sort());
  await rejects(civic(a, { op: 'trOffer', id: b.uid, k: 'nap' }), 'tr_offered');
  await rejects(civic(a, { op: 'trAnswer', tid: tid('nap'), yes: true }), 'tr_gone');
  assert.equal((await civic(b, { op: 'trAnswer', tid: tid('nap'), yes: true })).signed, true);
  T = await treaty(tid('nap')); assert.equal(T.st, 'active'); assert.ok(T.at >= now);
  await rejects(civic(b, { op: 'trOffer', id: a.uid, k: 'nap' }), 'tr_exists');
  /* offering what the other side already offered signs it */
  await civic(a, { op: 'trOffer', id: b.uid, k: 'trade' });
  assert.equal((await civic(b, { op: 'trOffer', id: a.uid, k: 'trade' })).signed, true);
  assert.equal((await treaty(tid('trade'))).st, 'active');
  /* declined, and withdrawn */
  await civic(a, { op: 'trOffer', id: b.uid, k: 'research' });
  await civic(b, { op: 'trAnswer', tid: tid('research'), yes: false });
  assert.equal(await treaty(tid('research')), undefined);
  await civic(b, { op: 'trOffer', id: a.uid, k: 'research' });
  await civic(b, { op: 'trCancel', tid: tid('research') });
  assert.equal(await treaty(tid('research')), undefined);
  /* ended with notice: in force until it runs out */
  const e = await civic(a, { op: 'trEnd', tid: tid('trade') });
  assert.ok(e.end > now + 2.9 * DAY && e.end < now + 3.1 * DAY);
  T = await treaty(tid('trade')); assert.equal(T.st, 'ending'); assert.equal(T.by, a.uid);
  /* broken at once: on the breaker's record, and no computer nation signs with it for a while */
  const br = await civic(b, { op: 'trEnd', tid: tid('nap'), now: true });
  assert.equal(br.broken, true); assert.equal(br.other, a.uid);
  T = await treaty(tid('nap')); assert.equal(T.st, 'broken'); assert.equal(T.by, b.uid);
  await rejects(civic(a, { op: 'trOffer', id: b.uid, k: 'nap' }), 'tr_wait');
  await rejects(civic(b, { op: 'trEnd', tid: tid('nap') }), 'tr_gone');
  await record(b, { s: { civil: npc.s.civil, econ: npc.s.econ, pol: npc.s.pol }, gw: {} });
  await rejects(civic(b, { op: 'trOffer', id: npc.id, k: 'nap' }), 'tr_breaker');
  /* a computer nation: declines when values are far apart, signs at once when they are close, never at war */
  const far = k => ((npc.s[k] ?? 50) >= 50 ? 0 : 100);
  await record(a, { s: { civil: far('civil'), econ: far('econ'), pol: far('pol') }, gw: {} });
  await rejects(civic(a, { op: 'trOffer', id: npc.id, k: 'research' }), 'tr_npc');
  await record(a, { s: { civil: npc.s.civil, econ: npc.s.econ, pol: npc.s.pol } });
  assert.equal((await civic(a, { op: 'trOffer', id: npc.id, k: 'research' })).signed, true);
  const nt = await treaty('research_' + [a.uid, npc.id].sort().join('_')); assert.equal(nt.st, 'active'); assert.equal(nt.npc, true);
  await record(a, { wars: { [npc.id]: { t: now - 1000 } } });
  await rejects(civic(a, { op: 'trOffer', id: npc.id, k: 'nap' }), 'tr_war');
  /* the most of a kind: three research pacts */
  const c = await player(true, true), d2 = await player(true, true), e2 = await player(true, true);
  for (const p of [c, d2]) { await civic(a, { op: 'trOffer', id: p.uid, k: 'research' }); await civic(p, { op: 'trAnswer', tid: 'research_' + [a.uid, p.uid].sort().join('_'), yes: true }); }
  await rejects(civic(a, { op: 'trOffer', id: e2.uid, k: 'research' }), 'tr_max');
  await rejects(civic(e2, { op: 'trOffer', id: a.uid, k: 'research' }), 'tr_max');
});

test('Alliances: pacts are offered and signed by leaders, ended with notice or broken at a cost; rivals earn renown for battles won against each other', async () => {
  const L1 = await player(true, true), L2 = await player(true, true), m2 = await player(true, true), L3 = await player(true, true), now = Date.now();
  const A1 = (await civic(L1, { op: 'alFound', name: 'North ' + crypto.randomUUID().slice(0, 8), acc: 'open' })).aid;
  const A2 = (await civic(L2, { op: 'alFound', name: 'South ' + crypto.randomUUID().slice(0, 8), acc: 'open' })).aid;
  const A3 = (await civic(L3, { op: 'alFound', name: 'East ' + crypto.randomUUID().slice(0, 8), acc: 'open' })).aid;
  await civic(m2, { op: 'alRequest', aid: A2 });
  await assert.rejects(civic(m2, { op: 'alPact', aid: A2, to: A1 }), e => e.code === 'permission-denied' || /leader/i.test(e.message));
  /* offered by one leader, accepted by the other */
  assert.equal((await civic(L1, { op: 'alPact', aid: A1, to: A2 })).signed, false);
  let a1 = await allianceOf(A1), a2 = await allianceOf(A2);
  assert.equal(a1.rel[A2].st, 'offered'); assert.equal(a2.rel[A1].st, 'asked');
  await rejects(civic(L1, { op: 'alPactAnswer', aid: A1, to: A2, yes: true }), 'al_no_offer');
  assert.equal((await civic(L2, { op: 'alPactAnswer', aid: A2, to: A1, yes: true })).signed, true);
  a1 = await allianceOf(A1); a2 = await allianceOf(A2);
  assert.equal(a1.rel[A2].st, 'active'); assert.equal(a2.rel[A1].st, 'active');
  assert.ok(a2.log.some(e => e.k === 'pact'));
  await rejects(civic(L1, { op: 'alRival', aid: A1, to: A2, on: true }), 'al_pact');
  /* ended with notice: in force until it runs out */
  const end = (await civic(L2, { op: 'alPactEnd', aid: A2, to: A1 })).end;
  assert.ok(end > now + 2.9 * DAY);
  a1 = await allianceOf(A1); assert.equal(a1.rel[A2].st, 'ending'); assert.equal(a1.rel[A2].end, end);
  /* broken at once: gone from both, and the breaker loses renown */
  await db.doc('alliances/' + A1).update({ xp: 150 });
  const br = await civic(L1, { op: 'alPactEnd', aid: A1, to: A2, now: true });
  assert.equal(br.broken, true);
  a1 = await allianceOf(A1); a2 = await allianceOf(A2);
  assert.equal(a1.rel[A2], undefined); assert.equal(a2.rel[A1], undefined); assert.equal(a1.xp, 50);
  assert.ok(a2.log.some(e => e.k === 'pactbrk' && e.a === L1.uid));
  /* a rivalry: named by one, seen by both; the other may name it back; withdrawn by the one that named it */
  await civic(L1, { op: 'alRival', aid: A1, to: A2, on: true });
  a1 = await allianceOf(A1); a2 = await allianceOf(A2);
  assert.deepEqual([a1.rel[A2].me, a1.rel[A2].them, a2.rel[A1].me, a2.rel[A1].them], [true, false, false, true]);
  await rejects(civic(L2, { op: 'alPact', aid: A2, to: A1 }), 'al_rival');
  await civic(L1, { op: 'alRival', aid: A1, to: A3, on: true });
  const A4 = (await civic(m2, { op: 'alLeave', aid: A2 }), (await civic(m2, { op: 'alFound', name: 'West ' + crypto.randomUUID().slice(0, 8) })).aid);
  await rejects(civic(L1, { op: 'alRival', aid: A1, to: A4, on: true }), 'al_rivals');
  /* the tally: a battle won by a member of North against a member of East (its rival) earns renown */
  await record(L1, { conq: [{ c: 7, t: now - 2000, d: L3.uid }, { c: 8, t: now - 1500, d: 'npc-x' }] });
  await db.doc('alliances/' + A1).update({ tt: now - 21 * 3600e3 });
  const t = await civic(L1, { op: 'alTally', aid: A1 });
  assert.equal(t.parts.rival, 1);
  assert.equal(t.xp, 3 + 4);
  await civic(L1, { op: 'alRival', aid: A1, to: A2, on: false });
  a1 = await allianceOf(A1); a2 = await allianceOf(A2);
  assert.equal(a1.rel[A2], undefined); assert.equal(a2.rel[A1], undefined);
  for (const [p, aid] of [[L1, A1], [L2, A2], [L3, A3], [m2, A4]]) await civic(p, { op: 'alLeave', aid, disband: true });
});

test('The Delegate names the region’s newspaper; nobody else can, and the same Delegate waits six hours',async()=>{
  const a=await player(true,true,'driftlands'),b=await player(true,true,'driftlands');
  const endorsed=await civic(b,{op:'endorse',target:a.uid,on:true});assert.ok(endorsed.D);
  const leader=endorsed.D.id===a.uid?a:b,other=leader===a?b:a;
  await rejects(civic(other,{op:'paper',name:'The Forged Times'}),'delegate_required');
  await assert.rejects(civic(leader,{op:'paper',name:'X'}));
  await assert.rejects(civic(leader,{op:'paper',name:'',motto:'A motto without a name'}));
  await civic(leader,{op:'paper',name:'The Driftlands Courier',motto:'Washed up, written down'});
  const p=await db.doc('press/driftlands').get();
  assert.equal(p.get('nm'),'The Driftlands Courier');assert.equal(p.get('mo'),'Washed up, written down');assert.equal(p.get('by'),leader.uid);assert.ok(p.get('t')>Date.now()-60000);
  await rejects(civic(leader,{op:'paper',name:'The Second Name'}),'paper_cooldown');
});

test('An admin observing a region reads its Assembly without a seat; a player cannot',async()=>{
  const f=await player(false,false,'frostmarch'), p=await player(), a=await player();
  await auth.setCustomUserClaims(a.uid,{admin:true});
  const fresh=await sign('signInWithCustomToken',{token:await auth.createCustomToken(a.uid,{admin:true})});
  await assert.rejects(civic(p,{op:'state',obs:'frostmarch'}),e=>e.status==='PERMISSION_DENIED');
  const s=await civic(fresh,{op:'state',obs:'frostmarch'});
  assert.equal(s.reg,'frostmarch');assert.ok(s.cur);assert.ok(s.recs.some(r=>r.id===f.uid));assert.ok(!s.recs.some(r=>r.id===a.uid));
  assert.equal(s.account.eligible,false);
  await assert.rejects(civic(fresh,{op:'state',obs:'atlantis'}),e=>e.status==='INVALID_ARGUMENT');
});

test('A vote carries its reason: kept with the vote and shown beside it, cut to 100 characters; an abstention is a vote on record',async()=>{
  const r=await player(true,true,'gilded'), st=await civic(r,{op:'state'});
  const out=await civic(r,{op:'vote',cycle:st.c,key:st.cur.k,vote:0,why:'  For the ducks,\n who cannot vote.  '+'x'.repeat(200)});
  const mine=out.V.rows.find(x=>x.id===r.uid);
  assert.equal(mine.v,0);assert.ok(mine.t>0);assert.ok(mine.x.startsWith('For the ducks, who cannot vote.'));assert.equal(mine.x.length,100);
  assert.equal((await db.doc(`assemblyRegions/gilded/cycles/${st.c}/votes/${r.uid}`).get()).get('why'),mine.x);
  const again=await civic(r,{op:'vote',cycle:st.c,key:st.cur.k,vote:1});
  assert.equal(again.V.rows.find(x=>x.id===r.uid).x,undefined,'a vote cast with no reason has none');
  assert.ok(again.recs.find(x=>x.id===r.uid).n.lastSave>Date.now()-60000,'each record says when its nation was last saved');
});

test('A repeal names a resolution in the rulebook and takes its category and strength; one no longer there is refused',async()=>{
  const r=await player(true,true,'gilded'), st=await civic(r,{op:'state'}), c=st.c;
  const entry={k:'npc~gilded~'+(c-1),c:c-1,ti:'The Happy Hen Convention',tx:'Cages are banned.',cat:'animals',g:1,by:'npc-x',bn:'X'};
  await db.doc(`assemblyRegions/gilded/cycles/${c-1}`).set({...entry,w:'n',lt:st.t0-DAY,y:3,n:1,ok:1,f:Date.now()-1000,r:'gilded',bk:[entry]});
  await db.doc('assemblyRegions/gilded').set({at:Date.now()},{merge:true});
  const seen=(await civic(r,{op:'state'})).locks.find(L=>L.c===c-1);assert.deepEqual(seen.bk.map(x=>x.k),[entry.k],'the latest finished cycle carries the book');
  await rejects(civic(r,{...proposal,repeal:'npc~gilded~1'}),'repeal_gone');
  const out=await civic(r,{op:'propose',title:'Repeal of the Hens',body:'The hens have all gone home.',category:'trade',strength:0,repeal:entry.k});
  assert.equal(out.own.p.rp,entry.k);assert.equal(out.own.p.c,'animals');assert.equal(out.own.p.g,1);assert.equal(out.own.p.rt,'The Happy Hen Convention');
});

test('Closing a count keeps it in the Book with every vote and reason, the next opens its debate on the Community Board, and a deleted account leaves the Book',async()=>{
  const reg='lanterncoast', a=await player(true,true,reg), b=await player(true,true,reg);
  await age(a,10*DAY);await age(b,10*DAY);
  const st=await civic(a,{op:'state'}), c=st.c, t0=st.t0-3*DAY, root=`assemblyRegions/${reg}`;
  await civic(a,{op:'vote',cycle:c,key:st.cur.k,vote:1});await civic(b,{op:'vote',cycle:c,key:st.cur.k,vote:1});
  // the count before this one, still open, with both votes in it; this cycle's lock taken away so it is locked again
  const L={c:c-1,k:'test~close',ti:'The Polite Chimney Accord',tx:'Clean smoke only.',cat:'env',g:0,by:a.uid,bn:a.uid,w:'s',lt:t0+1000};
  await db.doc(`${root}/cycles/${c-1}`).set(L);await db.doc(`${root}/cycles/${c}`).delete();
  for(const [p,v,x] of [[a,1,'Clean chimneys for all.'],[b,-1,'']]){const ref=db.doc(`${root}/actors/${p.uid}`),s=await ref.get();
    await ref.set({...s.data(),record:{...s.get('record'),v:[{c:c-1,k:L.k,v,t:t0+5000,...(x?{x}:{})}]}});}
  await db.doc(root).set({at:Date.now()},{merge:true});
  const out=await civic(a,{op:'state'}),closed=out.locks.find(x=>x.c===c-1),open=out.locks.find(x=>x.c===c);
  assert.ok(closed.f);assert.ok(Array.isArray(closed.bk));assert.equal(closed.bk.some(e=>e.k===L.k),!!closed.ok);
  const page=(await db.doc(`${root}/asmBook/${c-1}`).get()).data();
  assert.equal(page.vm[a.uid],1);assert.equal(page.vm[b.uid],-1);assert.equal(page.vx[a.uid],'Clean chimneys for all.');assert.ok(page.vu.includes(a.uid)&&page.vu.includes(b.uid));assert.ok(Object.keys(page.nv).length>0);
  assert.equal(page.bk,undefined,'the Book page does not copy the rulebook');
  assert.equal(open.dt,'AsmDebate'+String(c).padStart(11,'0'));
  const topic=await db.doc(`cb/${reg}/posts/${open.dt}`).get();
  assert.ok(topic.exists);assert.equal(topic.get('as'),true);assert.equal(topic.get('tg'),'assembly');assert.equal(topic.get('a'),'assembly');assert.ok(topic.get('ti').startsWith(`Resolution No. ${c+1}: `));
  assert.ok((await db.doc(`cb/${reg}`).get()).get('n')>=1);
  const book=await civic(b,{op:'book'});assert.equal(book.list[0].c,c-1);assert.equal(book.list[0].vm[b.uid],-1);
  await assert.rejects(civic(b,{op:'book',obs:'meridian'}),e=>e.status==='PERMISSION_DENIED');
  await db.doc('nations/'+b.uid).delete();await call(b,'referee',{op:'forget'});
  const after=(await db.doc(`${root}/asmBook/${c-1}`).get()).data();
  assert.equal(after.vm[b.uid],undefined);assert.equal(after.vu.includes(b.uid),false);assert.equal(after.vm[a.uid],1);
});

test('Who is online: the region’s players seen in the last 15 minutes, by their newest save report, unless they hide it',async()=>{
  const R='greywater',MIN=60000,now=Date.now(),a=await player(false,false,R);
  const hp=(id,reg,ago,more={})=>db.doc('saveHealth/'+id).set({uid:id.split('_')[0],reg,device:'Desktop',status:'synced',revision:1,pending:false,error:'',conflicts:0,t:new Date(now-ago),expiresAt:new Date(now+DAY),...more});
  await Promise.all([hp(a.uid+'_1',R,6*MIN),hp(a.uid+'_2',R,1*MIN),
    hp('old_1',R,30*MIN),hp('hid_1',R,8*MIN),hp('hid_2',R,1*MIN,{ho:true}),hp('back_1',R,9*MIN,{ho:true}),hp('back_2',R,2*MIN,{ho:false}),
    hp('away_1','meridian',1*MIN)]);
  const r=await civic(a,{op:'online',reg:R});
  assert.equal(r.reg,R);
  assert.deepEqual(Object.keys(r.u).sort(),[a.uid,'back'].sort());
  assert.ok(r.u[a.uid]>=50&&r.u[a.uid]<=90,JSON.stringify(r.u));
  assert.ok(r.u.back>=110&&r.u.back<=150,JSON.stringify(r.u));
  // nothing of the reports themselves
  assert.deepEqual(Object.keys(r).sort(),['reg','u']);
  await assert.rejects(civic(a,{op:'online',reg:'nowhere'}),e=>e.status==='INVALID_ARGUMENT');
  await assert.rejects(civic(a,{op:'online'}),e=>e.status==='INVALID_ARGUMENT');
});

test('Swaying a vote: the server rolls it, keeps it in the member’s record once a vote, and refuses stale or repeated sways',async()=>{
  const r=await player(true,true,'saffron'), state=await civic(r,{op:'state'});
  await rejects(civic(r,{op:'sway',cycle:state.c-1,key:state.cur.k,vote:1}),'vote_closed');
  await rejects(civic(r,{op:'sway',cycle:state.c,key:state.cur.k,vote:3}),'vote_closed');
  let res;try{res=await civic(r,{op:'sway',cycle:state.c,key:state.cur.k,vote:1,bonus:999,cover:-5});}catch(e){if(e.code==='sway_none')return;throw e;}
  const w=res.own.w;assert.equal(w.c,state.c);assert.equal(w.k,state.cur.k);assert.equal(w.v,1);assert.ok([0,1].includes(w.ok)&&[0,1].includes(w.ex));
  assert.ok(w.ok?w.np.length>=1&&w.np.length<=2:w.np.length===0);assert.ok(w.t>Date.now()-60000);
  assert.deepEqual((await db.doc(`assemblyRegions/saffron/actors/${r.uid}`).get()).get('record').w,w);
  await rejects(civic(r,{op:'sway',cycle:state.c,key:state.cur.k,vote:-1}),'sway_used');
});

test('Region chat: a Registered Nation writes in its own region, paced and never twice the same; authors delete their own lines, staff any, audited',async()=>{
  const r=await player(true),o=await player(true),far=await player(true,false,'frostmarch');
  await assert.rejects(civic(r,{op:'rcPost',x:'   '}),e=>e.status==='INVALID_ARGUMENT');
  // the author, name, staff mark and time are the server's, whatever the browser sends
  const a=await civic(r,{op:'rcPost',reg:'meridian',x:'  Hello\n  <b>region</b>   all ',a:'forged',nm:'Forged',st:'admin',t:1});
  assert.equal(a.reg,'meridian');
  const line=(await db.doc('rchat/meridian/chat/'+a.id).get()).data();
  assert.equal(line.a,r.uid);assert.equal(line.nm,r.uid);assert.equal(line.x,'Hello <b>region</b> all');assert.equal(line.st,undefined);
  assert.ok(line.t>Date.now()-60000&&line.exp.toMillis()>Date.now()+29*DAY);
  await rejects(civic(r,{op:'rcPost',x:'Too fast'}),'rc_paced');
  await new Promise(res=>setTimeout(res,1600));
  await rejects(civic(r,{op:'rcPost',x:'hello b REGION b, all!'}),'rc_same');
  assert.equal((await civic(r,{op:'rcPost',x:'x'.repeat(400)})).ok,true);
  assert.equal((await db.collection('rchat/meridian/chat').where('a','==',r.uid).get()).docs.map(d=>d.get('x')).sort((p,q)=>q.length-p.length)[0].length,300);
  // a nation writes in its own region only
  await rejects(civic(far,{op:'rcPost',reg:'meridian',x:'Wrong room'}),'rc_region');
  const f=await civic(far,{op:'rcPost',x:'Frost here'});assert.equal(f.reg,'frostmarch');
  // deleting: not another player's line; one's own; staff anyone's, with the words in the audit log
  await assert.rejects(civic(o,{op:'rcDelete',reg:'meridian',id:a.id}),e=>e.status==='PERMISSION_DENIED');
  await assert.rejects(civic(o,{op:'rcDelete',reg:'atlantis',id:a.id}),e=>e.status==='INVALID_ARGUMENT');
  await civic(far,{op:'rcDelete',reg:'frostmarch',id:f.id});
  assert.equal((await db.doc('rchat/frostmarch/chat/'+f.id).get()).exists,false);
  await auth.setCustomUserClaims(o.uid,{mod:true});
  await civic(o,{op:'rcDelete',reg:'meridian',id:a.id});
  assert.equal((await db.doc('rchat/meridian/chat/'+a.id).get()).exists,false);
  const au=await db.collection('adminAudit').where('line','==',a.id).get();
  assert.equal(au.size,1);assert.equal(au.docs[0].get('action'),'chat_delete');assert.equal(au.docs[0].get('actor'),o.uid);assert.equal(au.docs[0].get('target'),r.uid);assert.equal(au.docs[0].get('x'),'Hello <b>region</b> all');
  assert.deepEqual(await civic(o,{op:'rcDelete',reg:'meridian',id:a.id}),{ok:true});
  // a moderator's line carries the staff mark; a banned player writes nothing
  await new Promise(res=>setTimeout(res,1600));
  const m=await civic(o,{op:'rcPost',x:'Be kind, everyone.'});
  assert.equal((await db.doc('rchat/meridian/chat/'+m.id).get()).get('st'),'mod');
  await db.doc('bans/'+r.uid).set({t:Date.now()});await rejects(civic(r,{op:'rcPost',x:'Banned'}),'banned');
});

test('Region chat welcome: a nation founded in the last hour is welcomed once in its region’s chat, never again, never when old, renamed alike, silenced or in a busy hour',async()=>{
  const g=await player(),now=Date.now();
  const h=await civic(g,{op:'rcHello',reg:'frostmarch',nm:'Forged',x:'Forged words'});
  assert.equal(h.ok,true);assert.equal(h.reg,'meridian');assert.ok(h.id);
  const line=(await db.doc('rchat/meridian/chat/'+h.id).get()).data();
  assert.equal(line.a,g.uid);assert.equal(line.nm,g.uid);assert.equal(line.sys,'found');assert.equal(line.x,g.uid+' has been founded, welcome to #Meridian Reach!');
  assert.ok(line.t>=now-60000&&line.exp.toMillis()>Date.now()+29*DAY);assert.equal(line.st,undefined);assert.equal(line.tm,undefined);
  // once: asked again (another device, a reload), nothing more is written
  assert.deepEqual(await civic(g,{op:'rcHello'}),{ok:true,skip:'done'});
  assert.equal((await db.collection('rchat/meridian/chat').where('a','==',g.uid).get()).size,1);
  // a welcome is no line of the player's own: their pacing is untouched
  assert.equal((await db.doc('rcPace/'+g.uid).get()).exists,false);
  // a nation older than an hour (its birth as the server knows it) is not welcomed
  const o=await player(true,true);assert.deepEqual(await civic(o,{op:'rcHello'}),{ok:true,skip:'old'});
  // the same name in the same region within a day (a nation carried into another account) is not welcomed twice
  const twin=await player();await db.doc('nations/'+twin.uid).update({name:g.uid.toUpperCase()});
  assert.deepEqual(await civic(twin,{op:'rcHello'}),{ok:true,skip:'again'});
  // a player silenced in the chat is not announced
  const s=await player();await db.doc('rcMute/'+s.uid).set({until:Date.now()+3600000,why:'spam',by:'x',t:Date.now()});
  assert.deepEqual(await civic(s,{op:'rcHello'}),{ok:true,skip:'silenced'});
  // at most twenty a region an hour
  await db.doc('rcHello/~frostmarch').set({w:Array.from({length:20},(_,i)=>({t:Date.now()-i*60000,k:'busy'+i}))});
  const f=await player(false,false,'frostmarch');assert.deepEqual(await civic(f,{op:'rcHello'}),{ok:true,skip:'busy'});
  assert.equal((await db.collection('rchat/frostmarch/chat').where('a','==',f.uid).get()).size,0);
  // a nation is needed, and a banned one gets nothing
  const none=await sign('signUp',{});await rejects(civic(none,{op:'rcHello'}),'nation_required');
  const b=await player();await db.doc('bans/'+b.uid).set({t:Date.now()});await rejects(civic(b,{op:'rcHello'}),'banned');
});

test('Region chat guests: a guest writes too, ten lines in any hour, told how many are left; a sign-in lifts it',async()=>{
  const g=await player(),r=await player(true),now=Date.now();
  const first=await civic(g,{op:'rcPost',x:'Hello from a guest'});
  assert.equal(first.ok,true);assert.equal(first.guest,true);assert.equal(first.left,9);assert.equal(first.gt.length,1);
  const line=(await db.doc('rchat/meridian/chat/'+first.id).get()).data();assert.equal(line.a,g.uid);assert.equal(line.x,'Hello from a guest');
  // eight more in the last hour (kept as the server keeps them): the tenth is the last
  const p=Array.from({length:8},(_,i)=>now-50*60000+i*60000).concat(first.t);
  await db.doc('rcPace/'+g.uid).set({p,h:'x'});
  await new Promise(res=>setTimeout(res,1600));
  const tenth=await civic(g,{op:'rcPost',x:'The tenth'});assert.equal(tenth.left,0);assert.equal(tenth.gt.length,10);
  await new Promise(res=>setTimeout(res,1600));
  await assert.rejects(civic(g,{op:'rcPost',x:'The eleventh'}),e=>{
    assert.equal(e.code,'rc_guest');assert.match(e.message,/Guests can send 10 lines an hour\. You can write again in (9|10|11) minutes, or link a sign-in/);return true;});
  // a Registered Nation with as many lines writes on, and is told nothing of a limit
  await db.doc('rcPace/'+r.uid).set({p:Array.from({length:20},(_,i)=>now-50*60000+i*60000),h:'x'});
  const reg=await civic(r,{op:'rcPost',x:'Still writing'});assert.equal(reg.ok,true);assert.equal(reg.guest,undefined);assert.equal(reg.left,undefined);
  // a banned guest writes nothing
  await db.doc('bans/'+g.uid).set({t:Date.now()});await rejects(civic(g,{op:'rcPost',x:'Banned guest'}),'banned');
});

test('Region chat staff: the team writes in any region, staff silence a player everywhere (and may take their last day of lines) and lift it, all audited',async()=>{
  const r=await player(true),o=await player(true),staff=await player(true),far=await player(true,false,'frostmarch');
  await auth.setCustomUserClaims(staff.uid,{mod:true});
  // only staff sign as the team; the team writes in a region where it has no nation, and the line carries no nation
  await assert.rejects(civic(r,{op:'rcPost',team:true,reg:'frostmarch',x:'Pretending'}),e=>e.status==='PERMISSION_DENIED');
  await assert.rejects(civic(staff,{op:'rcPost',team:true,x:'Where?'}),e=>e.status==='INVALID_ARGUMENT');
  const tl=await civic(staff,{op:'rcPost',team:true,reg:'frostmarch',x:'Welcome, Frostmarch.'});
  assert.equal(tl.reg,'frostmarch');
  const t=(await db.doc('rchat/frostmarch/chat/'+tl.id).get()).data();
  assert.equal(t.tm,true);assert.equal(t.nm,'Edictum team');assert.equal(t.a,staff.uid);assert.equal(t.st,'mod');
  // a player's lines, then a day's silence that takes the lines of the last 24 hours with it
  const l1=await civic(r,{op:'rcPost',x:'Buy my grain!'});
  await db.doc('rchat/meridian/chat/old'+r.uid.slice(0,10)).set({a:r.uid,nm:'Old',x:'From last week',t:Date.now()-3*DAY});
  await assert.rejects(civic(o,{op:'rcMute',uid:r.uid,hours:24}),e=>e.status==='PERMISSION_DENIED');
  await assert.rejects(civic(staff,{op:'rcMute',uid:r.uid,hours:5}),e=>e.status==='INVALID_ARGUMENT');
  await assert.rejects(civic(staff,{op:'rcMute',uid:staff.uid,hours:24}),e=>e.status==='FAILED_PRECONDITION');
  const mu=await civic(staff,{op:'rcMute',uid:r.uid,hours:24,why:'  Spam,\n spam  ',wipe:true});
  assert.equal(mu.removed,1);assert.equal(mu.perm,false);
  assert.equal((await db.doc('rchat/meridian/chat/'+l1.id).get()).exists,false);
  assert.equal((await db.doc('rchat/meridian/chat/old'+r.uid.slice(0,10)).get()).exists,true);
  const m=(await db.doc('rcMute/'+r.uid).get()).data();
  assert.equal(m.why,'Spam, spam');assert.equal(m.by,staff.uid);assert.equal(m.reg,'meridian');assert.ok(m.until>Date.now()+23*3600000&&m.until<Date.now()+25*3600000);
  // a silenced player writes nothing, anywhere, and is told until when and why
  await new Promise(res=>setTimeout(res,1600));
  await assert.rejects(civic(r,{op:'rcPost',x:'Let me speak'}),e=>e.code==='rc_silenced'&&e.message.includes(new Date(m.until).toISOString().slice(0,16).replace('T',' ')+' UTC: Spam, spam.'));
  // staff cannot be silenced; a silence until lifted
  const s2=await player(true);await auth.setCustomUserClaims(s2.uid,{admin:true});
  await rejects(civic(staff,{op:'rcMute',uid:s2.uid,hours:0}),'rc_staff');
  const fm=await civic(staff,{op:'rcMute',uid:far.uid,hours:0,why:'Threats'});
  assert.equal(fm.perm,true);assert.equal((await db.doc('rcMute/'+far.uid).get()).get('perm'),true);
  // lifting: only staff; the player writes again
  await assert.rejects(civic(o,{op:'rcUnmute',uid:r.uid}),e=>e.status==='PERMISSION_DENIED');
  await civic(staff,{op:'rcUnmute',uid:r.uid});
  assert.equal((await db.doc('rcMute/'+r.uid).get()).exists,false);
  assert.equal((await civic(r,{op:'rcPost',x:'Sorry about that.'})).ok,true);
  assert.deepEqual(await civic(staff,{op:'rcUnmute',uid:r.uid}),{ok:true});
  const au=(await db.collection('adminAudit').where('target','==',r.uid).get()).docs.map(d=>d.data());
  const sil=au.find(a=>a.action==='chat_silence'),un=au.find(a=>a.action==='chat_unsilence');
  assert.ok(sil&&sil.actor===staff.uid&&sil.hours===24&&sil.removed===1&&sil.reason==='Spam, spam'&&sil.reg==='meridian');
  assert.ok(un&&un.actor===staff.uid);
});

test('Region chat pictures: only an admin posts one, with words or alone, the picture kept beside the line and gone with it',async()=>{
  const r=await player(true),mod=await player(true),staff=await player(true);
  await auth.setCustomUserClaims(mod.uid,{mod:true});await auth.setCustomUserClaims(staff.uid,{admin:true});
  const b64=(head,n)=>Buffer.concat([Buffer.from(head),Buffer.alloc(n-head.length,7)]).toString('base64');
  const th='data:image/webp;base64,'+b64([...Buffer.from('RIFF'),1,2,3,4,...Buffer.from('WEBPVP8 ')],2000);
  const full='data:image/jpeg;base64,'+b64([0xff,0xd8,0xff,0xe0],600*1024);
  const pic={th,w:440,h:248,d:full,fw:1920,fh:1080};
  // a player or a moderator cannot; an admin can, as their nation, with no words
  await assert.rejects(civic(r,{op:'rcPost',x:'Look',pic}),e=>e.status==='PERMISSION_DENIED');
  await assert.rejects(civic(mod,{op:'rcPost',team:true,reg:'meridian',x:'Look',pic}),e=>e.status==='PERMISSION_DENIED');
  await assert.rejects(civic(staff,{op:'rcPost',pic:{...pic,d:'data:image/svg+xml;base64,PHN2Zy8+'}}),e=>e.code==='rc_pic'&&e.status==='INVALID_ARGUMENT');
  await assert.rejects(civic(staff,{op:'rcPost',pic:{...pic,d:'data:image/jpeg;base64,'+b64([0xff,0xd8,0xff,0xe0],701*1024)}}),e=>e.code==='rc_pic');
  const a=await civic(staff,{op:'rcPost',x:'   ',pic});
  const line=(await db.doc('rchat/meridian/chat/'+a.id).get()).data(),kept=(await db.doc('rcimg/meridian/chat/'+a.id).get()).data();
  assert.equal(line.x,'');assert.equal(line.st,'admin');assert.equal(line.a,staff.uid);
  assert.deepEqual(line.im,{s:th,w:440,h:248,fw:1920,fh:1080,k:'jpeg'});
  assert.equal(kept.d,full);assert.equal(kept.a,staff.uid);assert.equal(kept.k,'jpeg');assert.equal(kept.t,line.t);assert.equal(kept.exp.toMillis(),line.exp.toMillis());
  // the same picture again at once is a repeat; with other words it is not
  await new Promise(res=>setTimeout(res,1600));
  await rejects(civic(staff,{op:'rcPost',pic}),'rc_same');
  const b=await civic(staff,{op:'rcPost',x:'The new harbour, as promised.',pic});
  assert.equal((await db.doc('rchat/meridian/chat/'+b.id).get()).get('x'),'The new harbour, as promised.');
  // an answer to a picture says it was one; a mention of it in the bell names a picture
  await new Promise(res=>setTimeout(res,1600));
  const ans=await civic(r,{op:'rcPost',x:'Lovely!',re:a.id});
  const rr=(await db.doc('rchat/meridian/chat/'+ans.id).get()).get('r');assert.equal(rr.im,true);assert.equal(rr.x,'');
  await new Promise(res=>setTimeout(res,1600));
  const c=await civic(staff,{op:'rcPost',re:ans.id,pic});
  const mn=(await db.collection('mentions/'+r.uid+'/m').where('rc','==',c.id).get()).docs[0];
  assert.ok(mn&&mn.get('x')==='📷 A picture'&&mn.get('rp')===true);
  // as the team, in another region
  await new Promise(res=>setTimeout(res,1600));
  const tl=await civic(staff,{op:'rcPost',team:true,reg:'frostmarch',x:'Frostmarch from above',pic});
  assert.equal((await db.doc('rcimg/frostmarch/chat/'+tl.id).get()).get('a'),staff.uid);
  // removed by its writer, by staff, or from the Reports queue: the picture goes with the line, and the audit log says it had one
  await civic(staff,{op:'rcDelete',reg:'meridian',id:a.id});
  assert.equal((await db.doc('rchat/meridian/chat/'+a.id).get()).exists,false);assert.equal((await db.doc('rcimg/meridian/chat/'+a.id).get()).exists,false);
  await civic(mod,{op:'rcDelete',reg:'frostmarch',id:tl.id});
  assert.equal((await db.doc('rcimg/frostmarch/chat/'+tl.id).get()).exists,false);
  const au=(await db.collection('adminAudit').where('line','==',tl.id).get()).docs[0];assert.equal(au.get('pic'),true);assert.equal(au.get('x'),'Frostmarch from above');
  const console2=await sign('signInWithCustomToken',{token:await auth.createCustomToken(staff.uid,{admin:true})});
  await call(console2,'adminConsole',{op:'moderate',action:'delete_post',target:'rc:meridian:'+b.id,reg:'meridian',reason:'Spam or advertising'});
  assert.equal((await db.doc('rchat/meridian/chat/'+b.id).get()).exists,false);assert.equal((await db.doc('rcimg/meridian/chat/'+b.id).get()).exists,false);
  // and with the account: the picture is a 'chat' document with its author
  const gone=(await db.collectionGroup('chat').where('a','==',staff.uid).get()).docs.map(d=>d.ref.path);
  assert.ok(gone.includes('rcimg/meridian/chat/'+c.id),gone.join());
});

test('Region chat: answers quote their line and tell its writer, @mentions tell the nations of the region named, reactions are one per nation, and go with the account',async()=>{
  const r=await player(true),o=await player(true),far=await player(true,false,'frostmarch'),g=await player();
  const l1=await civic(r,{op:'rcPost',x:'Grain for sale, cheap.'});
  // an answer that mentions its writer, and a nation of another region: only the writer of this region is mentioned
  await db.doc('pushSubs/'+r.uid).set({s:[{e:'https://push.example/one',k:{p256dh:'p',auth:'a'},at:Date.now()}]});
  const a1=await civic(o,{op:'rcPost',re:l1.id,mn:[r.uid,far.uid,'npc-x','bad/id'],x:`@${r.uid} deal, and @${far.uid} too`});
  const L=(await db.doc('rchat/meridian/chat/'+a1.id).get()).data();
  assert.deepEqual(L.r,{id:l1.id,a:r.uid,nm:r.uid,x:'Grain for sale, cheap.'});
  assert.deepEqual(L.mn,{[r.uid]:r.uid});
  const told=async u=>(await db.collection('mentions/'+u+'/m').get()).docs.map(d=>d.data());
  let mr=await told(r.uid);assert.equal(mr.length,1);assert.equal(mr[0].k,'chat');assert.equal(mr[0].rc,a1.id);assert.equal(mr[0].by,o.uid);assert.equal(mr[0].reg,'meridian');assert.equal(mr[0].rp,undefined);
  assert.equal((await told(far.uid)).length,0,'a nation of another region is not told');
  const out=(await db.collection('pushOutbox').where('to','==',r.uid).get()).docs.map(d=>d.data());
  assert.equal(out.length,1);assert.match(out[0].payload.title,/mentioned you in the region chat/);assert.equal(out[0].payload.url,'/#chat');
  // an answer with no mention tells its writer as an answer; a second push within ten minutes is held back
  await new Promise(res=>setTimeout(res,1600));
  const a2=await civic(o,{op:'rcPost',re:l1.id,x:'Still selling?'});
  mr=await told(r.uid);assert.equal(mr.length,2);assert.equal(mr.find(m=>m.rc===a2.id).rp,true);
  assert.equal((await db.collection('pushOutbox').where('to','==',r.uid).get()).size,1,'one push every ten minutes at most');
  // a line gone, or not a line at all
  await new Promise(res=>setTimeout(res,1600));
  await rejects(civic(o,{op:'rcPost',re:'A'.repeat(20),x:'Hello?'}),'rc_gone');
  await assert.rejects(civic(o,{op:'rcPost',re:'nope',x:'Hello?'}),e=>e.status==='INVALID_ARGUMENT');
  // a nation that blocked the writer is not told
  await db.doc('lblock/'+r.uid+'~'+o.uid).set({b:r.uid,x:o.uid,t:new Date()});
  const a3=await civic(o,{op:'rcPost',mn:[r.uid],x:`@${r.uid} are you there?`});
  assert.equal((await db.doc('rchat/meridian/chat/'+a3.id).get()).get('mn'),undefined);assert.equal((await told(r.uid)).length,2);
  // reactions: one per nation, the same again takes it back, another replaces it; guests react; not in another region
  await civic(o,{op:'rcReact',reg:'meridian',id:l1.id,k:'hear'});
  assert.equal((await db.doc('rchat/meridian/chat/'+l1.id).get()).get('rv')[o.uid],'hear');
  await civic(o,{op:'rcReact',reg:'meridian',id:l1.id,k:'ha'});
  assert.equal((await db.doc('rchat/meridian/chat/'+l1.id).get()).get('rv')[o.uid],'ha');
  await civic(o,{op:'rcReact',reg:'meridian',id:l1.id,k:'ha'});
  assert.equal((await db.doc('rchat/meridian/chat/'+l1.id).get()).get('rv')[o.uid],undefined);
  assert.deepEqual(await civic(g,{op:'rcReact',reg:'meridian',id:l1.id,k:'bravo'}),{ok:true,k:'bravo'});
  await assert.rejects(civic(o,{op:'rcReact',reg:'meridian',id:l1.id,k:'love'}),e=>e.status==='INVALID_ARGUMENT');
  await assert.rejects(civic(far,{op:'rcReact',reg:'meridian',id:l1.id,k:'hear'}),e=>e.status==='PERMISSION_DENIED');
  await rejects(civic(o,{op:'rcReact',reg:'meridian',id:'B'.repeat(20),k:'hear'}),'rc_gone');
  // a deleted account's reactions go with it (functions/accounts.js calls rcForget)
  const { rcForget } = await import('../functions/regionchat.js');
  assert.equal(await rcForget(db,g.uid,['meridian','frostmarch']),1);
  assert.equal((await db.doc('rchat/meridian/chat/'+l1.id).get()).get('rv')[g.uid],undefined);
});

test('A commendation or a condemnation names one nation of the region, checked at the backend',async()=>{
  const reg='jadeterraces', a=await player(true,true,reg), b=await player(true,true,reg), c=await player(true,true,reg);
  const x=JSON.parse(fs.readFileSync(new URL('../functions/civic-data.json',import.meta.url),'utf8')).regions.find(r=>r.id===reg).npcs[0];
  const named={op:'propose',title:'Laurels for a neighbour',body:'For keeping the peace and lending us its snowploughs.',category:'commend',strength:1};
  await rejects(civic(a,named),'invalid_target');
  await rejects(civic(a,{...named,target:a.uid}),'invalid_target');
  await rejects(civic(a,{...named,target:'nobody-here'}),'invalid_target');
  await rejects(civic(a,{...named,category:'condemn',target:b.uid}),'invalid_target');
  const out=await civic(a,{...named,target:b.uid});
  assert.equal(out.own.p.c,'commend');assert.equal(out.own.p.tg,b.uid);assert.equal(out.own.p.tn,b.uid);assert.equal(out.own.p.g,0,'always mild');
  const kept=(await db.doc(`assemblyRegions/${reg}/proposals/${a.uid}~${Math.round(out.own.p.t).toString(36)}`).get());assert.equal(kept.get('tg'),b.uid);
  const cx=await civic(c,{...named,title:'A Censure',category:'condemn',target:x.id});assert.equal(cx.own.p.tg,x.id);assert.equal(cx.own.p.tn,x.name);
  /* a nation already wearing the laurel cannot be commended again until it runs out */
  const st=await civic(b,{op:'state'});
  await db.doc(`assemblyRegions/${reg}/cycles/${st.c-1}`).set({c:st.c-1,k:'test~laurel',ti:'Earlier laurels',tx:'',cat:'commend',g:0,by:x.id,bn:x.name,w:'n',lt:1,y:2,n:0,ok:1,f:Date.now(),r:reg,tg:a.uid,tn:a.uid});
  await db.doc('assemblyRegions/'+reg).set({at:Date.now()},{merge:true});
  await assert.rejects(civic(b,{...named,target:a.uid}),e=>e.code==='invalid_target'&&/laurel/.test(e.message));
  const seen=await civic(b,{op:'state'});assert.ok(seen.locks.some(L=>L.k==='test~laurel'&&L.tg===a.uid),'every player of the region receives the mark with the counts');
});
