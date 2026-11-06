// The admin land check: a nation whose population fell keeps claims its credits no longer cover, which the game allows,
// so only claims beyond what it earned at its (plausible) peak population show as suspicious.
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import assert from 'node:assert/strict';

const source=readFileSync(new URL('../game/edictum.html',import.meta.url),'utf8');
function cut(from,to){const a=source.indexOf(from),b=source.indexOf(to,a+from.length);assert.ok(a>0&&b>a,'found '+from);return source.slice(a,b);}
function line(from){return cut(from,'\n');}
function check(){
  const code=[line('const budgetOf='),line('const CORE_HEXES='),cut('const MILESTONES=[','\nconst fmtPopShort'),line('function milesReached('),
    line('const MILE_NEW='),line('function mileCredit('),cut('const SUS_LAND_SLACK=','function susHere(){')].join('\n');
  const ctx=vm.createContext({DAY:864e5,num0:v=>typeof v==='number'&&isFinite(v)?v:0,tallyOf:(n,k)=>(n&&n.tly&&n.tly[k])||0,
    fmtPop:p=>p+' million',popNow:n=>n.pop});
  vm.runInContext(code+'\nlandEarned=n=>popLand(n,n.pop)+(n.extra||0);this.susLand=susLand;this.popLand=popLand;',ctx);
  return ctx;
}
const NOW=Date.UTC(2026,10,6),DAY=864e5;
const nation=over=>({name:'The Wandering Isles',pop:60,extra:40,founded:NOW-60*DAY,_ts:NOW,...over});
const earned=(c,n)=>c.popLand(n,n.pop)+(n.extra||0);

test('claims within the credits, or up to two over, are not flagged',()=>{
  const c=check(),n=nation(),e=earned(c,n);
  for(const used of [0,e-5,e,e+1,e+2])assert.equal(c.susLand(n,used,NOW),'',`${used} claims with ${e} credits`);
  assert.match(c.susLand(n,e+3,NOW),/^It holds \d+ claimed hexes with \d+ land credits earned\.$/);
});

test('a nation that dropped below a milestone keeps its claims without being flagged',()=>{
  const c=check(),then=nation({pop:52}),held=earned(c,then);
  const now=nation({pop:48,peak:52});
  assert.ok(held-earned(c,now)>=4,'dropping under 50 million costs at least four credits');
  assert.equal(c.susLand(now,held,NOW),'');
  assert.equal(c.susLand(nation({pop:48,tly:{peak:52}}),held,NOW),'','the achievement tally counts as a peak too');
  assert.match(c.susLand(nation({pop:48}),held,NOW),/^It holds \d+ claimed hexes with \d+ land credits earned\.$/,'without a recorded peak it is still flagged');
});

test('claims beyond even the peak are flagged, naming the peak',()=>{
  const c=check(),n=nation({pop:48,peak:52}),top=earned(c,nation({pop:52}));
  assert.equal(c.susLand(n,top+2,NOW),'');
  assert.equal(c.susLand(n,top+3,NOW),`It holds ${top+3} claimed hexes with ${earned(c,n)} land credits earned, and ${top} at its peak of 52 million people.`);
});

test('a made-up peak is held to what a nation of its age can have grown',()=>{
  const c=check(),young=nation({pop:6,peak:1e6,founded:NOW-DAY});
  const cap=5*1.35+3+1,top=earned(c,{...young,pop:cap});
  assert.equal(c.susLand(young,top+2,NOW),'');
  assert.match(c.susLand(young,top+3,NOW),new RegExp(`and ${top} at its peak of ${cap} million people\\.$`));
  assert.match(c.susLand(young,top+50,NOW),/claimed hexes/);
});

test('a peak below today\'s population counts as today\'s',()=>{
  const c=check(),n=nation({pop:60,peak:30}),e=earned(c,n);
  assert.equal(c.susLand(n,e+2,NOW),'');
  assert.match(c.susLand(n,e+3,NOW),/land credits earned\.$/);
});
