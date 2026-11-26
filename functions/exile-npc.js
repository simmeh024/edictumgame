import DATA from './civic-data.json' with {type:'json'};
export const EXILE_ID='npc-cloudspine-free-haalesh',EXILE_EVENT='haalesh-exile-v1';
export function exileDefinition(n,at=Date.now()){
 if(!n||n.id!==EXILE_ID||!Number.isFinite(n.t)||n.t<=0||n.t>at||!Number.isInteger(n.cap)||!Array.isArray(n.land)||n.land.length!==7||new Set(n.land).size!==7||!n.land.includes(n.cap)||!DATA.exile)return null;
 return {...DATA.exile,s:{...DATA.exile.s},pol:DATA.exile.pol.slice(),reg:'cloudspine',founded:n.t};
}
export function assemblyNPCs(region,story){
 const base=(DATA.regions.find(r=>r.id===region)?.npcs||[]).filter(n=>n.id!==EXILE_ID),extra=region==='cloudspine'?exileDefinition(story?.exile,Infinity):null;
 return extra?base.concat(extra):base;
}
// Runtime NPC services share DATA's registry; publication alone never installs the exiles.
export async function refreshExileNPC(db){
 const s=await db.doc('worldEvents/'+EXILE_EVENT).get(),d=s.exists?s.data():null,n=d?.phase==='passed'?exileDefinition(d.nation):null;
 if(n){const R=DATA.regions.find(r=>r.id==='cloudspine');if(!R.npcs.some(x=>x.id===EXILE_ID))R.npcs.push(n);}
 return n;
}
