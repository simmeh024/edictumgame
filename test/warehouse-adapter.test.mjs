import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {parse} from 'acorn';
import {test} from 'node:test';
import assert from 'node:assert/strict';
const source=readFileSync(new URL('../src/shim.js',import.meta.url),'utf8'),functions=new Map();
function walk(n){if(!n||typeof n!=='object')return;if(n.type==='FunctionDeclaration')functions.set(n.id.name,source.slice(n.start,n.end));for(const [k,v] of Object.entries(n))if(k!=='start'&&k!=='end'){if(Array.isArray(v))v.forEach(walk);else if(v&&typeof v==='object')walk(v);}}
walk(parse(source,{ecmaVersion:'latest'}));
const json=v=>JSON.parse(JSON.stringify(v));
function fixture(saved=null){
 const writes=[],A={admin:false,raceAt:{}};
 A.fs={doc:path=>({path}),runTransaction:async fn=>fn({get:async ref=>ref.path==='nations/player'?{exists:!!saved,data:()=>saved}:{exists:false,data:()=>null},set:(ref,data)=>writes.push({path:ref.path,data:json(data)}),delete(){}})};
 const c=vm.createContext({A,MAX_JSON:700000,BOOT_AT:1,serverTime:()=>123,num:v=>typeof v==='number'&&Number.isFinite(v)?v:0,str:(v,max)=>typeof v==='string'?v.slice(0,max):'',isObj:v=>!!v&&typeof v==='object'&&!Array.isArray(v),parse:s=>JSON.parse(s),millis:()=>1,mapError:e=>e,
  spaceText:()=>null,splitNation:d=>[d,{}],activeUntil:(d,t)=>t,raceKeys:()=>[]});
 vm.runInContext(['encode','decode','revision','saveNation'].map(n=>functions.get(n)).join('\n'),c);return {c,writes};
}
const nation=more=>({name:'Storeland',reg:'meridian',updatedAt:1000,pop:5,claims:[],...more});
test('legacy nation envelopes retain their existing shape until warehouse support is used',()=>{const {c}=fixture(),out=c.encode('nations',nation());assert.equal(out.v,1);assert.equal(out.storageV,undefined);});
test('warehouse envelopes identify the expanded-storage save format',()=>{const {c}=fixture(),out=c.encode('nations',nation({whv:1,stock:{iron:750}}));assert.equal(out.storageV,1);assert.equal(JSON.parse(out.j).stock.iron,750);});
test('decoding a guarded record restores its compatibility marker',()=>{const {c}=fixture(),out=c.decode('nations/player',{j:JSON.stringify(nation()),storageV:1,rev:5});assert.equal(out.whv,1);assert.equal(out._rev,5);});
test('a supported client preserves the server guard when restoring an older backup',async()=>{const {c,writes}=fixture({reg:'meridian',rev:5,storageV:1});await c.saveNation('player',nation({_rev:5}));const out=writes.find(x=>x.path==='nations/player').data;assert.equal(out.storageV,1);assert.equal(out.rev,6);});
