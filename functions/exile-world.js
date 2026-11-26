import fs from 'node:fs';
import vm from 'node:vm';
import {gunzipSync} from 'node:zlib';
import {performance} from 'node:perf_hooks';
import {webcrypto} from 'node:crypto';
let compiled;
export function createExileWorld(payload,{now=Date.now(),source}={}){
 const empty=()=>{},store=new Map([['statehood.nation.v1',JSON.stringify({name:'Server planner',reg:'cloudspine'})]]);
 const node=()=>({style:{setProperty:empty},dataset:{},classList:{add:empty,remove:empty,toggle:empty,contains:()=>false},appendChild:empty,remove:empty,setAttribute:empty,getAttribute:()=>null,hasAttribute:()=>false,removeAttribute:empty,addEventListener:empty,querySelector:()=>null,querySelectorAll:()=>[],getContext:()=>null});
 const app=node(),document={documentElement:{...node(),lang:'en'},body:node(),head:node(),hidden:false,visibilityState:'visible',readyState:'complete',addEventListener:empty,getElementById:id=>id==='app'?app:null,querySelector:()=>null,querySelectorAll:()=>[],createElement:node,createElementNS:node};
 const storage={getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)},FixedDate=class extends Date{constructor(...a){super(...(a.length?a:[now]));}static now(){return now;}};
 const sandbox={console,Date:FixedDate,Math,JSON,Map,Set,WeakMap,WeakSet,Uint8Array,Uint16Array,Uint32Array,Int8Array,Int16Array,Int32Array,Float32Array,Float64Array,ArrayBuffer,TextEncoder,TextDecoder,URL,URLSearchParams,structuredClone,performance,crypto:webcrypto,document,localStorage:storage,sessionStorage:storage,location:{hostname:'edictum.invalid',host:'edictum.invalid',protocol:'https:',origin:'https://edictum.invalid',pathname:'/',hash:'',search:''},navigator:{language:'en',languages:['en'],userAgent:'Edictum server world',onLine:false},history:{replaceState:empty},innerWidth:1280,innerHeight:900,devicePixelRatio:1,setTimeout:()=>1,clearTimeout:empty,setInterval:()=>1,clearInterval:empty,requestAnimationFrame:()=>1,cancelAnimationFrame:empty,addEventListener:empty,removeEventListener:empty,matchMedia:()=>({matches:false,addEventListener:empty,removeEventListener:empty}),getComputedStyle:()=>({getPropertyValue:()=>''}),fetch:()=>Promise.reject(new Error('The server world has no transport.')),atob:s=>Buffer.from(s,'base64').toString('binary'),btoa:s=>Buffer.from(s,'binary').toString('base64'),Image:class{},MutationObserver:class{observe(){}disconnect(){}},ResizeObserver:class{observe(){}disconnect(){}},IntersectionObserver:class{observe(){}disconnect(){}}};
 sandbox.window=sandbox;sandbox.self=sandbox;sandbox.top=sandbox;sandbox.parent=sandbox;sandbox.EDICTUM_PROBE=g=>sandbox.G=g;
 const context=vm.createContext(sandbox),run=code=>vm.runInContext(code,context,{timeout:30000}),data=code=>JSON.parse(JSON.stringify(run(code)));
 const script=source?new vm.Script(source):compiled||(compiled=new vm.Script(gunzipSync(fs.readFileSync(new URL('./exile-world-source.gz',import.meta.url))).toString('utf8')));
 script.runInContext(context,{timeout:30000});sandbox.payload=payload;run('window.EDICTUM_PROBE.exile.loadWorld(payload)');
 return {baseline:()=>data('window.EDICTUM_PROBE.dhaluun.plan()'),claimReads:()=>data('window.EDICTUM_PROBE.exile.claimReads()'),setStamps:stamps=>{sandbox.stamps=stamps;run('window.EDICTUM_PROBE.exile.setStamps(stamps)');},verify:key=>{sandbox.publicKey=key;return run('window.EDICTUM_PROBE.exile.verifyWorld(publicKey)');},snapshot:()=>data('window.EDICTUM_PROBE.exile.snapshot()'),plan:()=>data('window.EDICTUM_PROBE.exile.plan()'),install:event=>{sandbox.event=event;run('window.EDICTUM_PROBE.exile.install(event)');}};
}
export async function allocateExileHomeland(tx,db,payload,event,now,{source}={}){
 const world=createExileWorld(payload,{now,source}),reads=world.claimReads(),stamps=[];
 for(let at=0;at<reads.length;at+=150){const part=reads.slice(at,at+150),docs=await tx.getAll(...part.map(x=>db.doc('stamps/cloudspine/'+x.stamp+'/'+x.uid)));docs.forEach((d,k)=>stamps.push({key:part[k].key,t:d.get('t')?.toMillis?.()??null}));}
 world.setStamps(stamps);await world.verify(payload.publicKey);
 const before=world.snapshot(),nation={...world.plan(),t:now};world.install({...event,phase:'passed',nation});const after=world.snapshot();
 for(let c=0;c<before.owner.length;c++)if(before.owner[c]>=0&&after.ids[after.owner[c]]!==before.ids[before.owner[c]])throw new Error('The exile settlement would move an existing border.');
 if(after.owner.filter(o=>after.ids[o]===nation.id).length!==7||!after.cities.some(c=>c.fid===nation.id&&c.c===nation.cap))throw new Error('The new nation does not hold exactly seven hexes and its capital.');
 return nation;
}
