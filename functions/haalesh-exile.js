import {Timestamp,FieldValue} from 'firebase-admin/firestore';
import {assemblyEngine} from './assembly-engine.js';
import {nationJSON} from './eligibility.js';
import {cbCounted} from './board.js';
import {allocateExileHomeland} from './exile-world.js';
import {EXILE_EVENT as EVENT,EXILE_ID} from './exile-npc.js';
export {EVENT};
export const EXILE_TITLE='Recognition and a homeland for Free Haalesh';
export const EXILE_TEXT='Haalesh’s former ministers petition the Assembly for recognition of a provisional republic in exile.\n\nA vote For grants recognition and creates Free Haalesh as a small computer-run nation, with its capital at Refuge, on seven connected hexes that are unclaimed when the count closes. No existing nation’s land will be taken.\n\nA vote Against refuses the petition. A tie also fails. Rejection creates no nation, changes no borders and starts no conflict.\n\nThe ordinary Assembly voting weights apply. The server will settle the count and carry out the result after the deadline.';
export const EXILE_THREAT='Recognise these traitors if you wish. Haalesh will remember every raised hand. There will be a reckoning.';
export const EXILE_SATISFIED='His Imperial Loftiness welcomes the Assembly’s sensible decision. There is, and remains, one Haalesh.';
const DAY=864e5,REG='cloudspine',PRIVATE='serverEvents/'+EVENT;
const motion=(c,now)=>({c,k:EVENT,ti:EXILE_TITLE,tx:EXILE_TEXT,cat:'exilepetition',g:0,by:'npc-cloudspine-saaveri',bn:'Saaveri',w:'n',lt:now,dt:'AsmDebate'+String(c).padStart(11,'0')});
export async function armExile(db,{publishAt,apply=false,now=Date.now()}={}){
 if(!Number.isFinite(publishAt))throw new Error('Choose a future publication time.');
 return db.runTransaction(async tx=>{
  const ref=db.doc(PRIVATE),[config,publicState,dhaluun]=await tx.getAll(ref,db.doc('worldEvents/'+EVENT),db.doc('worldEvents/dhaluun-cloudspine-v1'));
  if(config.exists||publicState.exists)return {status:'already-armed',publishAt:config.get('publishAt'),phase:config.get('phase')||publicState.get('phase')};
  if(publishAt<=now)throw new Error('Choose a future publication time.');
  if(!dhaluun.get('haalesh'))throw new Error('Haalesh’s takeover must be active first.');
  if(apply){tx.create(ref,{v:1,phase:'scheduled',publishAt,armedAt:now});tx.create(db.doc('adminAudit/'+EVENT+'-armed'),{action:'haalesh_exile_timer',actor:'admin-tool',outcome:'completed',publishAt,at:FieldValue.serverTimestamp()});}
  return {status:apply?'armed':'plan',publishAt,title:EXILE_TITLE,createsNationNow:false};
 });
}
export async function publishExile(db,now=Date.now()){
 return db.runTransaction(async tx=>{
  const configRef=db.doc(PRIVATE),ref=db.doc('worldEvents/'+EVENT),root=db.doc('assemblyRegions/'+REG);
  const [[config,event,meta,board],cycles]=await Promise.all([tx.getAll(configRef,ref,root,db.doc('cb/'+REG)),tx.get(root.collection('cycles').orderBy('c','desc').limit(12))]);
  if(!config.exists||config.get('phase')!=='scheduled'||now<config.get('publishAt'))return {status:'waiting'};
  if(event.exists)return {status:'already-published'};
  const E=assemblyEngine(REG,[]),occupied=new Set(cycles.docs.map(d=>d.get('c'))),current=E.cycle(now);if(!occupied.has(current))throw new Error('The current Assembly vote has not been protected.');
  let c=current+1;while(occupied.has(c))c++;const L=motion(c,now),opens=E.t0(c),ends=E.t0(c+1);
  tx.create(root.collection('cycles').doc(String(c)),L);
  tx.create(ref,{v:1,reg:REG,phase:'published',t:now,c,opens,ends,title:EXILE_TITLE,debate:L.dt});
  tx.update(configRef,{phase:'published',c,opens,ends,wakeAt:E.t0(current+1),publishedAt:now});
  tx.set(root,{rev:(meta.get('rev')||0)+1,at:now},{merge:true});
  tx.create(db.doc('cb/'+REG+'/posts/'+L.dt),{a:L.by,nm:L.bn,rg:REG,ti:L.ti,x:EXILE_TEXT+'\n\nVoting opens '+new Date(opens).toISOString()+' and closes '+new Date(ends).toISOString()+'. Vote on the Assembly page once the request opens.',tg:'assembly',t:now,la:now,rc:0});
  tx.set(db.doc('cb/'+REG),cbCounted(board,now,{n:1}));
  tx.create(db.doc('rchat/'+REG+'/chat/'+EVENT),{a:L.by,nm:L.bn,x:'Haalesh’s former ministers have petitioned the Assembly for recognition and a small homeland. The request is on the Assembly docket. Their nation will exist only if the vote passes.',t:now,exp:Timestamp.fromMillis(now+30*DAY)});
  tx.create(db.doc('adminAudit/'+EVENT+'-published'),{action:'haalesh_exile_publication',actor:'server-clock',outcome:'completed',c,opens,ends,at:FieldValue.serverTimestamp()});
  return {status:'published',c,opens,ends};
 });
}
export async function prepareExileOutcome(tx,db,ctx,now,{allocate=allocateExileHomeland}={}){
 const L=ctx.locks.find(L=>L.k===EVENT&&L.cat==='exilepetition'&&L.r===REG&&L.by==='npc-cloudspine-saaveri'&&L.f);if(!L)return null;
 const [event,config,topic]=await tx.getAll(db.doc('worldEvents/'+EVENT),db.doc(PRIVATE),db.doc('cb/'+REG+'/posts/'+L.dt));
 const end=assemblyEngine(REG,[]).t0(L.c+1);
 if(event.get('phase')!=='published'||event.get('c')!==L.c||event.get('ends')!==end||end>now||L.f<end||config.get('phase')!=='published')return null;
 let nation=null;
 if(L.ok){
  const [[dhaluun,publicKey],sieges]=await Promise.all([tx.getAll(db.doc('worldEvents/dhaluun-cloudspine-v1'),db.doc('referee/pub')),tx.get(db.collection('sieges').where('reg','==',REG))]);
  const saved=ctx.worldNations,mods=saved.length?await tx.getAll(...saved.map(s=>db.doc('mod/'+s.id))):[];
  const rows=saved.map((s,i)=>({id:s.id,hidden:mods[i]?.get('hidden')===true,n:{...nationJSON(s),_ts:s.get('ts')?.toMillis?.()||0,_pop:s.get('pop'),_army:s.get('army'),_cl:s.get('cl'),_rev:s.get('rev')||0,whv:s.get('storageV')===1?1:0}}));
  nation=await allocate(tx,db,{rows,dhaluun:dhaluun.data(),exile:event.data(),publicKey:publicKey.get('k')||null,sieges:sieges.docs.map(s=>({id:s.id,d:s.data()}))},event.data(),now);
 }
 return {event,config,topic,replyOnBoard:topic.exists&&!topic.get('hd')&&!topic.get('lk'),passed:!!L.ok,nation,c:L.c,message:{a:L.ok?'npc-cloudspine-haalesh':'npc-cloudspine-dhaluun',nm:L.ok?'Haalesh':'Dhaluun',x:L.ok?EXILE_THREAT:EXILE_SATISFIED,t:now}};
}
export function writeExileOutcome(tx,db,ctx,out,now){
 const phase=out.passed?'passed':'rejected';
 tx.update(out.event.ref,{phase,settledAt:now,...(out.nation?{nation:out.nation}:{})});
 tx.update(out.config.ref,{phase,settledAt:now});
 tx.create(db.doc('rchat/'+REG+'/chat/'+EVENT+'-result'),{...out.message,exp:Timestamp.fromMillis(now+30*DAY)});
 if(out.replyOnBoard){tx.create(out.topic.ref.collection('posts').doc('ExileOutcome000000001'),{...out.message,rg:REG});tx.update(out.topic.ref,{rc:(out.topic.get('rc')||0)+1,la:now,lr:out.message.nm});}
 if(out.nation)ctx.haalesh={...ctx.haalesh,exile:out.nation};
 tx.create(db.doc('adminAudit/'+EVENT+'-result'),{action:'haalesh_exile_result',actor:'assembly-server',outcome:'completed',passed:out.passed,c:out.c,...(out.nation?{nation:EXILE_ID,hexes:7}:{}),at:FieldValue.serverTimestamp()});
}
export async function runExileTimer(db,{now=Date.now(),settle}={}){
 let config=await db.doc(PRIVATE).get();if(!config.exists)return {status:'inactive'};
 if(config.get('phase')==='scheduled'){if(now<config.get('publishAt'))return {status:'waiting',at:config.get('publishAt')};if(typeof settle!=='function')throw new Error('The server Assembly settlement is unavailable.');await settle(db,REG,now);await publishExile(db,now);config=await db.doc(PRIVATE).get();}
 if(config.get('phase')!=='published')return {status:config.get('phase')};
 if(now<config.get('wakeAt'))return {status:'waiting',at:config.get('wakeAt')};
 if(typeof settle!=='function')throw new Error('The server Assembly settlement is unavailable.');
 await settle(db,REG,now);
 await db.runTransaction(async tx=>{const s=await tx.get(config.ref);if(s.get('phase')==='published'){const E=assemblyEngine(REG,[]);tx.update(s.ref,{wakeAt:Math.min(s.get('ends'),E.t0(E.cycle(now)+1)),checkedAt:now});}});
 return {status:(await config.ref.get()).get('phase')};
}
