import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import assert from 'node:assert/strict';
const src=readFileSync(new URL('../game/edictum.html',import.meta.url),'utf8');
const helpers=src.slice(src.indexOf('function rewardRefs('),src.indexOf('/* ───────── notifications ───────── */'));
function context(){
 const c=vm.createContext({S:{nation:{ach:{a:1},coll:{x:1},colS:{set:1}},achFor:'visitor',museumFor:'visitor',colF:{own:'miss'}},
  ACH_BY_ID:{a:{n:'An honour',c:'found'},b:{n:'Locked',c:'spy'}},COL_BY_ID:{x:{n:'An <artefact>',set:'set'}},COL_SET_BY_ID:{set:{n:'A set'}},
  colName:a=>a.n,colOwned:n=>n.coll||{},colSetDone:n=>!!n.coll?.x,esc:s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;')});
 vm.runInContext(helpers,c);return c;
}
test('each grouped unlock gets a real, escaped link to its precise target',()=>{
 const c=context(),html=c.rewardLinksHTML([{kind:'achievement',id:'a'},{kind:'artefact',id:'x'},{kind:'set',id:'set'},{kind:'evil',id:'javascript:alert(1)'}]);
 assert.equal((html.match(/<a /g)||[]).length,3);assert.match(html,/href="#achievements\/a"/);assert.match(html,/href="#museum\/artefact\/x"/);assert.match(html,/href="#museum\/set\/set"/);
 assert.match(html,/An &lt;artefact>/);assert.ok(!html.includes('javascript:'));assert.equal(c.rewardLinksHTML(null),'');
});
test('deep link parser rejects unknown ids, unknown kinds and arbitrary URLs',()=>{
 const c=context();for(const hash of ['javascript:alert(1)','#museum/evil/x','#achievements/nope','#achievements/constructor','#museum/set/set/extra','#museum/artefact/<x>'])assert.equal(c.rewardRoute(hash),null);
 assert.equal(c.rewardRoute('#achievements/a').kind,'achievement');assert.equal(c.rewardRoute('#museum/artefact/x').id,'x');assert.equal(c.rewardRoute('#museum/set/set').kind,'set');
});
test('achievement links open own earned card regardless of prior visitor or filters',()=>{
 const c=context();assert.ok(c.rewardPrepare(c.rewardInfo('achievement','a')));assert.equal(c.S.achFor,null);assert.equal(c.S.achCat,'found');assert.equal(c.S.achF,'earned');assert.equal(c.S.view,'achievements');assert.equal(c.rewardPrepare(c.rewardInfo('achievement','b')),false);
});
test('museum links reset filters, open the artefact label or the completed set',()=>{
 const c=context();assert.ok(c.rewardPrepare(c.rewardInfo('artefact','x')));assert.equal(c.S.museumFor,null);assert.equal(c.S.colDetail,'x');assert.equal(c.S.colF.set,'set');assert.equal(c.S.colF.own,'all');assert.equal(c.S.colF.rar,'');
 assert.ok(c.rewardPrepare(c.rewardInfo('set','set')));assert.equal(c.S.colDetail,null);assert.equal(c.S.muHall,'collection');
 delete c.S.nation.coll.x;assert.equal(c.rewardPrepare(c.rewardInfo('artefact','x')),false);assert.equal(c.rewardPrepare(c.rewardInfo('set','set')),false);c.S.nation=null;assert.equal(c.rewardPrepare(c.rewardInfo('achievement','a')),false);
});
test('toasts retain links, escape text, deduplicate and pause while a link is focused',()=>{
 const c=context(),el={hidden:true,innerHTML:'',matches:()=>false,classList:{remove(){},toggle(){}}},timers=[];
 Object.assign(c,{document:{getElementById:()=>el},setTimeout:(fn,ms)=>(timers.push(ms),timers.length),clearTimeout:()=>{},clamp:(v,a,b)=>Math.max(a,Math.min(b,v))});
 vm.runInContext(src.slice(src.indexOf('const TOASTQ='),src.indexOf('/* The bell:'))+'\n'+src.slice(src.indexOf('function toast(msg){'),src.indexOf('/* the address shows'))+'\nthis.Q=TOASTQ;',c);
 c.toast({m:'Earned <script>',links:[{kind:'achievement',id:'a'}]});assert.match(el.innerHTML,/Earned &lt;script>/);assert.match(el.innerHTML,/#achievements\/a/);
 c.toast({m:'Earned <script>',links:[{kind:'achievement',id:'a'}]});assert.equal(c.Q.q.length,0);
 c.toast('Ordinary message');assert.equal(c.Q.q.length,1);el.matches=()=>true;c.Q.cur.at=0;c.toastNext();assert.equal(c.Q.q.length,1);assert.equal(timers.at(-1),250);
 el.matches=()=>false;c.toastNext();assert.match(el.innerHTML,/Ordinary message/);assert.ok(!el.innerHTML.includes('reward-links'));
});
