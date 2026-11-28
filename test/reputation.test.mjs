// Reputation (2026-11-28): one public label per player's nation from the region's treaties and the shared half of its
// record, weighed by computer nations when they are asked to sign a treaty. The server's rules
// (functions/reputation-rules.js) and the game's copy must agree on every record.
// Run with: node --test test/reputation.test.mjs
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../functions/reputation-rules.js';

const source=readFileSync(new URL('../game/edictum.html',import.meta.url),'utf8');
const server=readFileSync(new URL('../functions/treaties.js',import.meta.url),'utf8');
const cut=(from,to)=>{const a=source.indexOf(from),b=source.indexOf(to,a);assert(a>0&&b>a,`the game still has ${from}`);return source.slice(a,b);};
const plain=v=>JSON.parse(JSON.stringify(v));
const DAY=864e5,NOW=Date.UTC(2026,10,28,12);
const G=(()=>{const ctx={DAY};vm.createContext(ctx);vm.runInContext(cut('/* ── rep: the rules ── */','/* ── rep: the page ── */')+'\nthis.REP_KEYS=REP_KEYS;this.REP_NAME=REP_NAME;this.REP_NEED=REP_NEED;this.REP_WIN=REP_WIN;',ctx);return ctx;})();
const both=(rec,trs,id='me',now=NOW)=>{const a=R.repFacts(rec,trs,id,now),b=plain(G.repFacts(rec,trs,id,now));assert.deepEqual(b,a,'the game counts as the server does');
  const k=R.repKey(a);assert.equal(G.repKey(b),k,'and names it the same');return k;};
const old={founded:NOW-60*DAY};
const ago=d=>NOW-d*DAY;
const tr=(o={})=>({k:'nap',p:['me','other'],a:'me',b:'other',st:'active',t:ago(20),at:ago(20),...o});

test('the game and the server share their tables',()=>{
  assert.deepEqual(plain(G.REP_KEYS),R.REP_KEYS);assert.deepEqual(plain(G.REP_NAME),R.REP_NAME);assert.deepEqual(plain(G.REP_NEED),R.REP_NEED);
  assert.equal(G.REP_WIN,R.REP_WIN);
  for(const k of R.REP_KEYS)assert(R.REP_NAME[k]&&k in R.REP_NEED,k);
});

test('each label, as the first that fits',()=>{
  assert.equal(both({founded:ago(2)},[]),'new','a nation under a week old is untested');
  assert.equal(both(old,[]),'iso','a month without treaty, gift, mission or war');
  assert.equal(both({...old,log:[{k:'peace',t:ago(3)}]},[]),'steady','one peace is unremarkable');
  assert.equal(both(old,[tr({st:'broken',by:'me',bt:ago(10)}),tr({k:'trade'}),tr({k:'research'})]),'oath','a broken treaty outweighs two kept');
  assert.equal(both(old,[tr({st:'broken',by:'me',bt:ago(31)}),tr({k:'trade'}),tr({k:'research'})]),'keeper','after 30 days the break is off the record');
  assert.equal(both(old,[tr({st:'broken',by:'other',bt:ago(3)})]),'iso','the other side’s break is not held against us (and leaves no treaty)');
  assert.equal(both({...old,log:[{k:'war',t:ago(1)},{k:'war',t:ago(2)}]},[]),'war','two wars and no peace');
  assert.equal(both({...old,log:[{k:'war',t:ago(1)},{k:'war',t:ago(2)},{k:'peace',t:ago(1)}]},[]),'steady','two wars with a peace between');
  assert.equal(both({...old,log:[{k:'war',t:ago(1)},{k:'war',t:ago(2)},{k:'war',t:ago(9)},{k:'peace',t:ago(1)}]},[]),'war','three wars, whatever the peace');
  assert.equal(both({...old,log:[{k:'war',t:ago(40)},{k:'war',t:ago(41)},{k:'peace',t:ago(1)},{k:'peace',t:ago(2)}]},[]),'peace','old wars are forgotten');
  assert.equal(both({...old,cta:[{w:'a',e:'b',t:ago(1)},{w:'a',e:'c',t:ago(5)}]},[]),'ally');
  assert.equal(both(old,[tr(),tr({k:'trade'})]),'keeper','two treaties in force for two weeks');
  assert.equal(both(old,[tr({at:ago(5),t:ago(5)}),tr({k:'trade',at:ago(5),t:ago(5)})]),'steady','too new to count as kept, but in force');
  assert.equal(both(old,[tr({st:'ending',end:NOW+DAY}),tr({k:'trade'})]),'keeper','a treaty on notice counts until it ends');
  assert.equal(both(old,[tr({st:'ending',end:NOW-DAY}),tr({k:'trade'})]),'steady','not after');
  const gifts=n=>Array.from({length:n},(_,i)=>({id:'g'+i,to:'x',k:'card',m:0,t:ago(1+i)}));
  assert.equal(both({...old,gft:gifts(6)},[]),'generous');
  assert.equal(both({...old,gft:gifts(4),gfr:[{id:'r',f:'x',k:'card',m:0,t:ago(2)}],alp:[{t:ago(20),k:'food',q:5,a:'al'}]},[]),'generous','thanks and treasury gifts count too');
  assert.equal(both({...old,gft:gifts(20).map(g=>({...g,t:g.t-14*DAY}))},[]),'steady','gifts older than two weeks are not Generous, but not Isolationist either');
  assert.equal(both({...old,ems:{a:{l:1},b:{l:3},c:{l:0}}},[]),'connected','two open missions; one still being set up does not count');
  assert.equal(both({...old,gft:[{t:ago(40)}]},[]),'iso','a gift more than a month old is forgotten');
});

test('a previous founding’s treaties are not this nation’s',()=>{
  const rec={founded:ago(60)},prev=tr({st:'broken',by:'me',bt:ago(5),f:{me:ago(200),other:ago(300)}}),now=tr({k:'trade',f:{me:ago(60)}});
  assert.equal(both(rec,[prev]),'iso');
  assert.equal(both(rec,[now,tr({k:'research',f:{me:ago(60)}})]),'keeper');
});

test('any record: the game and the server agree',()=>{
  let s=7;const r=()=>(s=(s*1103515245+12345)%2147483648)/2147483648,pick=a=>a[Math.floor(r()*a.length)],t=()=>NOW-Math.floor(r()*45*DAY)+(r()<0.05?DAY:0);
  for(let i=0;i<500;i++){
    const rec={founded:r()<0.1?0:ago(r()*40),log:Array.from({length:Math.floor(r()*8)},()=>({k:pick(['war','peace','npcwar','build','lost']),t:t()})),
      gft:Array.from({length:Math.floor(r()*8)},()=>({t:t()})),gfr:Array.from({length:Math.floor(r()*3)},()=>({t:t()})),alp:Array.from({length:Math.floor(r()*3)},()=>({t:t()})),
      cta:Array.from({length:Math.floor(r()*3)},()=>({t:t()})),ems:r()<0.5?{a:{l:Math.floor(r()*4)},b:{l:Math.floor(r()*4)}}:undefined};
    const trs=Array.from({length:Math.floor(r()*5)},()=>tr({st:pick(['active','ending','broken','offered']),end:t(),at:t(),bt:t(),by:pick(['me','other']),p:pick([['me','other'],['other','third']])}));
    both(rec,trs);
  }
});

test('computer nations weigh it: the server asks the reputation’s affinity, and the Treaties tab forecasts the same',()=>{
  assert.match(server,/import \{ REP_NAME, REP_NEED, repOf \} from '\.\/reputation-rules\.js';/);
  assert.match(server,/rep = repOf\(e\.n, mine\.map\(x => x\.T\), who\.uid, now\), need = TR_NPC_MIN\[k\] \+ \(REP_NEED\[rep\] \|\| 0\);\s*\n\s*if \(af < need\) refuse\('tr_npc'/);
  assert.match(source,/need=TY_RULES\.npcMin\[k\]\+repNeedOf\(me\);/);
  assert.equal(R.REP_NEED.war,10);assert.equal(R.REP_NEED.iso,0,'keeping to itself never makes a first treaty dearer');
  for(const k of ['peace','ally','keeper','generous','connected'])assert.equal(R.REP_NEED[k],-5,k);
});
