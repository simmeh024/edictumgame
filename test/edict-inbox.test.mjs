// Run the actual inbox helpers with small story fixtures; no duplicate implementation.
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {parse} from 'acorn';
import {test} from 'node:test';
import assert from 'node:assert/strict';
const html=readFileSync(new URL('../game/edictum.html',import.meta.url),'utf8');
const src=html.slice(html.indexOf('function edictPriorNorm('),html.indexOf('function issuesView('));
parse(src,{ecmaVersion:'latest'});
function helpers(){
  const ctx=vm.createContext({ISSUE_BY_ID:{a:{c:'econ',t:'Original',o:[{nx:'b'},{}]},b:{c:'tech',o:[]},c:{c:'econ',o:[]}},
    ISSUE_TOPICS:[['econ','Economy'],['tech','Technology']],fill:s=>s,esc:s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),cap1:s=>s[0].toUpperCase()+s.slice(1),
    S:{nation:{inbox:[{id:'a',at:10},{id:'b',at:20}]}},clone:structuredClone,syncInbox:n=>n});
  ctx.commits=0;ctx.saves=0;ctx.commit=n=>{ctx.S.nation=n;ctx.commits++;};ctx.saveSoon=()=>ctx.saves++;
  vm.runInContext(src,ctx);return ctx;
}
test('topic/status filters intersect, pinned first, original queue order untouched',()=>{
  const h=helpers(),entries=[{id:'a',at:1},{id:'c',at:3,pin:1},{id:'b',at:2,read:1}];
  assert.deepEqual([...h.edictVisible(entries,'all','all')].map(x=>x.id),['c','a','b']);
  assert.deepEqual([...h.edictVisible(entries,'econ','unread')].map(x=>x.id),['c','a']);
  assert.equal(h.edictVisible(entries,'econ','opened').length,0);
  assert.deepEqual([...h.edictVisible(entries,'all','opened')].map(x=>x.id),['b']);
  assert.deepEqual([...h.edictVisible(entries,'all','pinned')].map(x=>x.id),['c']);
  assert.deepEqual(entries.map(x=>x.id),['a','c','b']);
});
test('read is idempotent, pin toggles independently, stale occurrence cannot mutate a repeat',()=>{
  const h=helpers();assert.equal(h.edictChange('a',9,'read'),false);assert.equal(h.commits,0);
  assert.equal(h.edictChange('a',10,'pin'),true);assert.equal(h.S.nation.inbox[0].pin,1);assert.equal(h.S.nation.inbox[0].read,undefined);
  h.edictChange('a',10,'read');h.edictChange('a',10,'read');assert.equal(h.commits,2);assert.equal(h.saves,2);
  h.edictChange('a',10,'pin');assert.equal(h.S.nation.inbox[0].pin,undefined);assert.equal(h.S.nation.inbox[0].read,1);
  h.S.nation.inbox=[{id:'a',at:100}];assert.equal(h.edictChange('a',10,'pin'),false);assert.equal(h.S.nation.inbox[0].read,undefined);
  h.S.nation=null;assert.equal(h.edictChange('a',10,'pin'),false);
});
test('saved prior ruling survives expired history, is escaped, and is exclusive to follow-ups',()=>{
  const h=helpers(),x={id:'b',at:30,ch:1,prior:{id:'a',t:10,title:'<Original>',fx:'chosen <script> ruling'}};
  assert.match(h.edictRecap({answered:[]},x),/chosen &lt;script> ruling/i);
  assert.match(h.edictRecap({},x),/“&lt;Original>”/);
  assert.equal(h.edictRecap({}, {...x,ch:undefined}), '');
});
test('legacy recap uses latest actual accepted parent, ignoring vetoes, unrelated and future choices',()=>{
  const h=helpers(),answered=[{id:'a',o:0,t:10,fx:'older'},{id:'a',o:0,t:20,fx:'actual chosen ruling'},
    {id:'a',o:1,t:22,fx:'not a parent'},{id:'a',o:-1,t:23,fx:'veto'}, {id:'a',o:0,t:40,fx:'future'}];
  assert.equal(h.edictPrior({answered},{id:'b',ch:1,at:30}).fx,'actual chosen ruling');
  assert.match(h.edictRecap({answered:[]},{id:'b',ch:1,at:30}),/no longer in the recent record/);
});
test('malformed snapshots are rejected and untrusted text is bounded',()=>{
  const h=helpers();
  for(const p of [null,{}, {id:'bad',t:10,fx:'x'},{id:'a',t:Infinity,fx:'x'},{id:'a',t:0,fx:'x'},{id:'a',t:10,fx:'\n\t'}])assert.equal(h.edictPriorNorm(p),null);
  const p=h.edictPriorNorm({id:'a',t:1,title:'t'.repeat(300),fx:'x\n'.repeat(700)});
  assert.equal(p.title.length,180);assert.equal(p.fx.length,600);assert.ok(!p.fx.includes('\n'));
});
test('list recap is concise while reading view keeps full ruling',()=>{
  const h=helpers(),x={id:'b',ch:1,prior:{id:'a',t:1,title:'Earlier',fx:'a'.repeat(500)}};
  assert.match(h.edictRecap({},x),/a{237}…/i);assert.match(h.edictRecap({},x,true),/a{500}/i);
});
