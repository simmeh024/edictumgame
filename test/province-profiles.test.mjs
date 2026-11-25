import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html=fs.readFileSync(new URL('../game/edictum.html',import.meta.url),'utf8');
const block=(a,b)=>{const i=html.indexOf(a),j=html.indexOf(b,i);assert.ok(i>=0&&j>i);return html.slice(i,j);};
function setup(){
  const ctx=vm.createContext({Math,Object,Array,Number,Set,isFinite,Date,DAY:86400000,REG:{id:'r'},MAP:{N:100,T:Array(100).fill(3)},PRV_GT:{},STATS:{crime:{n:'Crime'},happy:{n:'Happiness'},civil:{n:'Civil Rights'},corrupt:{n:'Corruption'},env:{n:'Environment'},safety:{n:'Safety'}},clamp:(v,a,b)=>Math.max(a,Math.min(b,v)),czText:(v,k)=>typeof v==='string'?v.slice(0,k):'',prvFlagNorm:()=>null,prvLoy:()=>70,hash:s=>[...s].reduce((a,c)=>(a*31+c.charCodeAt(0))|0,0),prvGen:(n,id,key,gov)=>({nm:key,sk:3,tr:[]}),esc:s=>String(s),fmtAmt:String});
  const constants=block('const PRV_TERMS=', 'const PRV={');
  vm.runInContext(constants+block('function prvGovNorm(', 'function prvFlagNorm(')+html.match(/function prvNorm\(d,n\)\{[\s\S]*?\n\}/)[0]+block('function prvFxOf(', '/* the stored effects')+block('function prvCands(', 'function prvNew('),ctx);
  return ctx;
}
test('candidates have three distinct deterministic profiles per role',()=>{
  const c=setup();for(let k=0;k<3;k++){const a=c.prvCands({seed:'a'},{id:1,gq:4},String(k));assert.equal(new Set(a.map(x=>x.profile)).size,3);assert.deepEqual(Array.from(a,x=>x.profile),Array.from(c.prvCands({seed:'a'},{id:1,gq:4},String(k)),x=>x.profile));assert.ok(c.prvProfileHTML(k,a[0],0.5).includes('Pro:'));assert.ok(c.prvProfileHTML(k,a[0],0.5).includes('Con:'));}
  assert.equal(c.prvCands({seed:'a'},{id:1},'g')[0].profile,undefined);
});
test('profiles survive normalization, remain role-specific and preserve old councillors',()=>{
  const c=setup(),q=c.prvNorm({on:1,l:[{id:1,nm:'A',s:5,c:[{nm:'Treasurer',profile:'taxhawk'},{nm:'Constable',profile:'taxhawk'},{nm:'Planner'}]}]},{reg:'r'}).l[0];
  assert.equal(q.c[0].profile,'taxhawk');assert.equal(q.c[1].profile,undefined);assert.equal(q.c[2].profile,undefined);
});
test('benefits and drawbacks apply in proportion to population independently of skill',()=>{
  const c=setup();for(let k=0;k<3;k++){for(const profile of vm.runInContext(`PRV_CP[${k}]`,c)){const council=[0,0,0];council[k]={sk:2,profile:profile.id};const f=c.prvFxOf({}, {q:{c:council},share:0.25}, {},0);for(const e of [profile.pro,profile.con])for(const [key,value] of Object.entries(e))assert.ok(Math.abs(f[key]-value*0.25)<1e-10,profile.id+' '+key);}}
  assert.deepEqual(Object.keys(c.prvFxOf({}, {q:{c:[{sk:2},0,0]},share:0.25},{},0)),[]);
});
