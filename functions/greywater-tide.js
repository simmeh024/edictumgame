import {Timestamp,FieldValue} from 'firebase-admin/firestore';

export const GREYWATER_TIDE_EVENT='greywater-vanishing-tide-v1';
export const GREYWATER_TIDE_TITLE='The Vanishing Tide';
// Two hours after Pascal requested the live launch (21:45 Amsterdam, 20:45 UTC).
export const GREYWATER_TIDE_START_AT=Date.parse('2026-11-28T20:45:07Z');
const REGION='greywater',DAY=864e5,PRIVATE='serverEvents/'+GREYWATER_TIDE_EVENT;

// One server-authored region-chat dispatch per day: five days of escalation,
// followed by four days in which the cause is found and the estuary is made safe.
export const GREYWATER_TIDE_DAYS=[
 {a:'npc-greywater-keelborough',nm:'Keelborough',x:'The Keelborough Navigation Improvement Scheme begins today. A new channel will shorten every voyage through Greywater. Our board has reviewed the tide charts and accepts no responsibility for the tide.'},
 {a:'npc-greywater-keelborough',nm:'Keelborough',x:'The first convoy has stopped in the new channel. It is resting on the mud at what the Chairman calls “an unexpectedly low high tide”. Keelborough assures all owners that the river will be asked to keep better appointments.'},
 {a:'npc-greywater-clinkerby',nm:'Clinkerby',x:'Clinkerby’s dock crews will not enter the new channel until Keelborough publishes a safety assessment. The Chairman has replied that the assessment is being prepared by the channel itself.'},
 {a:'npc-greywater-umbrage',nm:'Umbrage',x:'Her Majesty has ordered an inquiry into the tide, the channel and the Chairman’s confidence. This morning, the water flowed into an old cut near Mudflat Isle, exposing an iron gate that does not appear on any current chart.'},
 {a:'npc-greywater-keelborough',nm:'Keelborough',x:'Keelborough confirms that its dredgers uncovered an old sluice beneath the mud. The Chairman denies authorising the river to use it. The water is now rising through the abandoned cut; two dock sheds have been cleared as a precaution.'},
 {a:'npc-greywater-umbrage',nm:'Umbrage',x:'The Royal Inquiry has suspended dredging and closed the new channel. Her Majesty requests calm, dry footwear and a complete copy of Keelborough’s plans. The Chairman has submitted a bill for the cost of suspending the tide.'},
 {a:'npc-greywater-clinkerby',nm:'Clinkerby',x:'Clinkerby crews and the Royal Survey are working together at the old sluice. A brass plate confirms it was built to divert floodwater away from the mill towns. The gate is jammed open; the crews will brace it before the next high tide.'},
 {a:'npc-greywater-keelborough',nm:'Keelborough',x:'The sluice has been secured with a crane supplied by Keelborough, at no charge until the invoice is complete. The tide is returning to its usual schedule. The Chairman says this proves the new channel has improved regional cooperation.'},
 {a:'npc-greywater-umbrage',nm:'Umbrage',x:'The estuary is stable and the sheds are safe. The new channel will remain closed pending a public review. Greywater will establish a shared tide board; Keelborough has volunteered to print the charts, subject to naming rights.'}
];

export async function runGreywaterTide(db,now=Date.now()){
 const cfgRef=db.doc(PRIVATE),pubRef=db.doc('worldEvents/'+GREYWATER_TIDE_EVENT);
 return db.runTransaction(async tx=>{
  const [cfg,pub]=await tx.getAll(cfgRef,pubRef);
  if(!cfg.exists){
   if(pub.exists)return {status:'state-mismatch'};
   tx.create(cfgRef,{v:1,reg:REGION,phase:'scheduled',startAt:GREYWATER_TIDE_START_AT,nextDay:0,armedAt:now,source:'deployed-event'});
   tx.create(pubRef,{v:1,reg:REGION,kind:'npc-story',title:GREYWATER_TIDE_TITLE,phase:'scheduled',startAt:GREYWATER_TIDE_START_AT,day:0,totalDays:GREYWATER_TIDE_DAYS.length});
   tx.create(db.doc('adminAudit/'+GREYWATER_TIDE_EVENT+'-armed'),{action:'greywater_tide_armed',actor:'server-clock',outcome:'completed',startAt:GREYWATER_TIDE_START_AT,at:FieldValue.serverTimestamp()});
   return {status:'scheduled',startAt:GREYWATER_TIDE_START_AT};
  }
  const data=cfg.data(),next=Math.max(0,Math.min(GREYWATER_TIDE_DAYS.length,Number(data.nextDay)||0));
  if(data.phase==='completed'||next>=GREYWATER_TIDE_DAYS.length)return {status:'completed'};
  let day=next;
  while(day<GREYWATER_TIDE_DAYS.length&&now>=data.startAt+day*DAY){
   const post=GREYWATER_TIDE_DAYS[day],scheduledAt=data.startAt+day*DAY,id=GREYWATER_TIDE_EVENT+'-day-'+String(day+1).padStart(2,'0');
   tx.create(db.doc('rchat/'+REGION+'/chat/'+id),{...post,t:scheduledAt,exp:Timestamp.fromMillis(now+30*DAY),event:GREYWATER_TIDE_EVENT});
   tx.create(db.doc('adminAudit/'+id),{action:'greywater_tide_dispatch',actor:'server-clock',outcome:'completed',day:day+1,at:FieldValue.serverTimestamp()});
   day++;
  }
  if(day===next)return {status:'waiting',at:data.startAt+day*DAY,day:day+1};
  const phase=day>=GREYWATER_TIDE_DAYS.length?'completed':'active',lastAt=data.startAt+(day-1)*DAY;
  tx.update(cfgRef,{nextDay:day,phase,updatedAt:now,...(phase==='completed'?{completedAt:now}:{})});
  if(pub.exists)tx.update(pubRef,{day,phase,updatedAt:now,...(phase==='completed'?{completedAt:now}:{})});
  return {status:phase,published:day-next,day,nextAt:phase==='completed'?null:data.startAt+day*DAY,lastDispatchAt:lastAt};
 });
}
