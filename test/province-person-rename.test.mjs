import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html=fs.readFileSync(new URL('../game/edictum.html',import.meta.url),'utf8');
const block=(a,b)=>html.slice(html.indexOf(a),html.indexOf(b,html.indexOf(a)));
function setup(){
  const P={l:[{id:1,g:{nm:'Original Governor',tr:['builder'],sk:4,lo:71,t:1},c:[0,1,2].map(i=>({nm:'Person '+i,tr:[],sk:i+1,lo:60,t:1}))}]};
  const c={P,PRV:{ui:{ren:'g'}},PRV_GT:{builder:1},clamp:(v,a,b)=>Math.min(b,Math.max(a,v)),czText:(v,max)=>typeof v==='string'?v.replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g,'').replace(/\s+/g,' ').trim().slice(0,max).trim():'',render:()=>{}};
  c.prvEdit=(fn,ok)=>{const copy=structuredClone(c.P),err=fn({},copy);c.msg=err||ok;if(err)return false;c.P=copy;return true;};
  vm.createContext(c);vm.runInContext(block('function prvGovNorm(', 'function prvFlagNorm(')+block('function prvRenamePerson(', 'function prvSetAut('),c);return c;
}
test('renaming each official preserves their attributes and the governor portrait through normalization',()=>{
  const c=setup();c.prvRenamePerson(1,'g',' New Governor ');c.prvRenamePerson(1,'g','Another Name');
  assert.equal(c.P.l[0].g.nm,'Another Name');assert.equal(c.P.l[0].g.lo,71);assert.equal(c.prvGovNorm(c.P.l[0].g).seed,'Original Governor');
  for(let i=0;i<3;i++){c.prvRenamePerson(1,String(i),'Renamed '+i);assert.equal(c.P.l[0].c[i].nm,'Renamed '+i);assert.equal(c.P.l[0].c[i].sk,i+1);}
});
test('invalid names and missing officials do not change the record',()=>{
  const c=setup(),before=structuredClone(c.P);c.prvRenamePerson(1,'0',' ');assert.match(c.msg,/at least two/);assert.deepEqual(c.P,before);
  c.prvRenamePerson(1,'3','Name');assert.match(c.msg,/no longer holds/);assert.deepEqual(c.P,before);
});
