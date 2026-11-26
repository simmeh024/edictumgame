import { readFileSync, writeFileSync } from 'node:fs';
import vm from 'node:vm';
import { loadWorld } from '../jobs/fx/world.mjs';
const save=(path,content)=>{if(process.argv.includes('--check')){if(readFileSync(path,'utf8')!==content)throw new Error(path+' is stale; run node tools/build-civic.mjs');}else writeFileSync(path,content);};
const src=readFileSync('game/edictum.html','utf8');
let code=src.slice(src.indexOf('const ASM_EPOCH='), src.indexOf('/* proposals waiting for the next vote'));
code=code.replace(/for\(const k of Object.keys\(ASM_CATS\)\)[^\n]*\n/,'');
code=code.replace('if(!n||n.npc||T<asmArr(n))return false;', 'if(!n||n.npc||!n.civicAt||T<n.civicAt)return false;');
const a=code.indexOf('function asmLocks('), b=code.indexOf('function asmPickFor(',a);
code=code.slice(0,a)+'function asmLocks(){return new Map(protectedLocks.map(x=>[x.c,x]));}\n'+code.slice(b);
const f=code.indexOf('function asmFinal('), end=code.indexOf('/* everything the pages need',f);
code=code.slice(0,f)+`function asmFinal(c){return protectedLocks.find(x=>x.c===c&&x.f)||null;}\n`+code.slice(end);
/* the Hall of Edicts: once a region's hall is open, its rulebook holds one resolution more (asmBookMax). The engine works
   out the opening from the hall's records (n.hal, which civicRecord keeps) with the game's own tally, the part between
   the hall-core marks */
const h0=src.indexOf('/* hall-core */'),h1=src.indexOf('/* hall-core end */');
if(h0<0||h1<h0||!code.includes('let asmBookPlus=c=>false;'))throw new Error('the Hall of Edicts core or asmBookPlus is missing from game/edictum.html');
code=code.replace('let asmBookPlus=c=>false;',src.slice(h0,h1)+`const HALL_AT=(()=>{try{return halTally(records.filter(r=>r&&r.n&&r.n.hal&&typeof r.n.hal==='object'&&r.n.hal.r===region)).at||0;}catch(e){return 0;}})();
const asmBookPlus=c=>HALL_AT>0&&HALL_AT<asmT0(c+1);`);
const helpers=src.match(/function hash\(str\)[^\n]+/)[0]+'\n'+src.match(/function rng\(seed\)[^\n]+/)[0];
const pre=`// Generated from the trusted Assembly engine in game/edictum.html; regenerate with tools/build-civic.mjs.\nimport DATA from './civic-data.json' with {type:'json'};\nimport {assemblyNPCs} from './exile-npc.js';\n${helpers}\nexport function assemblyEngine(region,records,protectedLocks=[],haalesh=null){\nconst DAY=86400000,GAMES_EPOCH=Date.UTC(2026,0,5),REG={id:region},NPC_NATIONS=assemblyNPCs(region,haalesh).map(x=>({...x,npc:true,policies:Object.fromEntries(x.pol.map(p=>[p,1]))}))||[],NPC_BASE=Object.fromEntries(NPC_NATIONS.map(x=>[x.id,x])),npcAt=(id,t)=>{const n=NPC_NATIONS.find(x=>x.id===id);return n&&region==='cloudspine'&&haalesh?.v===1&&Number.isFinite(haalesh.t)&&t>=haalesh.t&&DATA.dhaluun?.id===id?{...n,s:{...n.s,...DATA.dhaluun.s}}:n;},npcRev=0;\nconst S={mode:'server',uid:'',nation:null,world:Object.fromEntries(records.map(r=>[r.id,r.n]))},myId=()=>'',clone=x=>structuredClone(x),conflictsOf=k=>DATA.conflicts.flatMap(([a,b])=>a===k?[b]:b===k?[a]:[]);\nconst affinity=(a,b)=>Math.round(Math.max(0,Math.min(100,100-(['civil','econ','pol'].reduce((v,k)=>v+Math.abs((a.s[k]??50)-(b.s[k]??50)),0)/3)+(b.civicAffinity||0)+Math.max(-20,Math.min(20,Number(b.gw?.[a.id])||0)))));\n`;
save('functions/assembly-engine.js',pre+code+'\nreturn {state:now=>asmState(now),pick:(c,exclude)=>asmPickRaw(c,records,exclude),tally:asmTally,swayPick:asmSwayPick,delegate:asmDelegateAt,key:asmPKey,cycle:asmCyc,t0:asmT0,cats:ASM_CATS,book:c=>asmBookAt(c,asmLocks()),bookStep:asmBookStep,absent:asmAbsentAt,weight:asmDW,marks:T=>asmMarks(asmLocks(),T),named:(id,m,T,by)=>asmTgWhy(id,m,records,T,by,asmLocks()),target:id=>asmTgRec(id,records),mark:asmTg};\n}\n');
const conflicts=vm.runInNewContext(src.match(/const POLICY_CONFLICTS=(\[.*\])\.filter\(/)[1]);
const statKeys=vm.runInNewContext(src.match(/const STAT_KEYS = (\[[^\n]+\]);/)[1]);
const world=loadWorld();
for(const region of world.regions)for(const npc of region.npcs)npc.s=Object.fromEntries(statKeys.map((key,i)=>[key,npc.s[i]]));
const dhaluun=vm.runInNewContext('('+src.match(/const DH_HAALESH=(\{[^\n]+\});/)[1]+')');
const exile=vm.runInNewContext('('+src.match(/const DH_EXILE_SPEC=(\{[^\n]+\});/)[1]+')');
save('functions/civic-data.json',JSON.stringify({...world,conflicts,dhaluun,exile}));
