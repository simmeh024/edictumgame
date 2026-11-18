// Census trends (18 November 2026): a week's change and sparkline per scale, rank moves on the board and the
// rank-history chart, from the snapshots each record keeps (n.hist; an NPC's _hist). Run with: node --test test/census-trends.test.mjs
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import assert from 'node:assert/strict';

const source=readFileSync(new URL('../game/edictum.html',import.meta.url),'utf8');
const DAY=864e5,NOW=Date.parse('2026-11-18T12:00:00Z');
function gameFn(name){
  const a=source.indexOf('function '+name+'(');assert(a>=0,'the game has function '+name);
  let i=source.indexOf('{',a),depth=0;for(;i<source.length;i++){const c=source[i];if(c==='{')depth++;else if(c==='}'&&--depth===0)break;}
  return source.slice(a,i+1);
}
const line=start=>{const a=source.indexOf(start);assert(a>=0,start);return source.slice(a,source.indexOf('\n',a));};
const FNS=['cenTracked','cenSnaps','cenAt','cenAgo','cenRankAt','cenDelta','cenTrend','cenSpark','cenMove','cenRankHist','cenHas','cenRankOf'];
function sandbox(){
  const code=[line('const STAT_KEYS = '),line('const CEN_WEEK='),...FNS.map(gameFn),
    'const STATS=Object.fromEntries(STAT_KEYS.map(k=>[k,{g:k==="crime"||k==="corrupt"?-1:1}]));STATS.pop={g:1};',
    'function statVal(k,x){return k==="pop"?x.n.pop:x.n.s[k];}function areaOf(){return 1;}function fmt1(v){return v.toFixed(1);}function npcPop(n,t){return 10;}',
    'globalThis.X={'+FNS.join(',')+'};'].join('\n');
  const ctx={DAY,Math,Number,Array,Object,WeakMap,isFinite,clamp:(v,a,b)=>Math.max(a,Math.min(b,v))};vm.createContext(ctx);vm.runInContext(code,ctx);return ctx.X;
}
const KEYS=JSON.parse(line('const STAT_KEYS = ').replace(/^.*?=\s*/,'').replace(/;$/,'').replace(/'/g,'"'));
const snap=(t,o,p)=>({t,p,s:KEYS.map(k=>o[k]??50)});
const nat=(id,cur,hist,pop=10)=>({id,n:{s:Object.fromEntries(KEYS.map(k=>[k,cur[k]??50])),pop,hist}});

test('a week of history gives the change, coloured by whether higher is better',()=>{
  const X=sandbox();
  const me=nat('me',{happy:60,crime:40},[snap(NOW-10*DAY,{happy:50,crime:30},8),snap(NOW-7*DAY,{happy:55,crime:35},9),snap(NOW-DAY,{happy:58,crime:38},9.5)],10);
  const d=X.cenDelta('happy',me,NOW);assert.equal(Math.round(d.d),5);assert.equal(d.good,1);assert.equal(d.days,7);
  assert.equal(X.cenDelta('crime',me,NOW).good,-1,'more crime is worse');
  assert.equal(Math.round(X.cenDelta('pop',me,NOW).d*10)/10,11.1,'population as a percentage');
  assert.match(X.cenTrend('happy',me,NOW),/class="cen-tr up".*▲ 5\.0/);
  assert.equal(X.cenDelta('area',me,NOW),null,'area keeps no history');
  assert.match(X.cenSpark('happy',me,NOW),/<polyline points="/);
});

test('a young record compares with its oldest snapshot, a brand-new one shows nothing',()=>{
  const X=sandbox();
  assert.equal(X.cenDelta('happy',nat('a',{happy:52},[snap(NOW-2*DAY,{happy:50},10)]),NOW).days,2);
  assert.equal(X.cenDelta('happy',nat('b',{happy:52},[snap(NOW-3600e3,{happy:50},10)]),NOW),null);
  assert.equal(X.cenDelta('happy',nat('c',{happy:52},undefined),NOW),null);
  assert.equal(X.cenSpark('happy',nat('c',{happy:52},[]),NOW),'');
});

test('rank moves and rank history come from every nation at the same moment',()=>{
  const X=sandbox(),w=NOW-8*DAY;
  const me=nat('me',{happy:70},[snap(w,{happy:40},10),snap(NOW-4*DAY,{happy:55},10)]);
  const a=nat('a',{happy:60},[snap(w,{happy:60},10)]),b=nat('b',{happy:50},[snap(w,{happy:50},10)]);
  const all=[me,a,b];
  assert.equal(X.cenRankAt('happy',me,all,NOW-7*DAY),3);assert.equal(X.cenRankOf('happy',me,all,NOW),1);
  assert.match(X.cenMove('happy',me,all,NOW),/cen-mv up.*↑2/);assert.match(X.cenMove('happy',a,all,NOW),/↓1/);
  assert.match(X.cenMove('happy',b,all,NOW),/↓1/,'b slipped from second to third');
  assert.match(X.cenRankHist('happy',me,all,NOW),/from #3 to #1/);
  const npc={id:'n',n:{npc:true,s:{happy:50},pop:10,_hist:[{t:w,s:{happy:80}}]}};
  assert.equal(X.cenRankAt('happy',me,[me,npc],w),2,'NPC snapshots keep scores by name');
});
