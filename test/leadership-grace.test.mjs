// The leadership grace: a nation that leaves a leadership group while one of its buildings stands keeps that building
// working for three days (n.ldg), and is told which figure moved, the line it must reach, which edict did it and
// until when. Zatra's Free Port went dormant on 19 Nov 2026 when three edicts took Economic Freedom from 74.5 to 69.5.
// The game's own code, evaluated piece by piece. Run with: node --test test/leadership-grace.test.mjs
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import assert from 'node:assert/strict';

const source=readFileSync(new URL('../game/edictum.html',import.meta.url),'utf8');
const cut=(from,to)=>{const a=source.indexOf(from),b=source.indexOf(to,a);assert(a>0&&b>a,`the game still has ${from}`);return source.slice(a,b);};

const DAY=864e5,T0=Date.UTC(2026,10,19,6,15);
function load(){
  const ctx={DAY,NORM_HOOKS:[],COMMIT_HOOKS:[],MONARCH_PRE:['Kingdom','Empire'],REPUBLIC_PRE:['Republic','Federation'],
    BUILDINGS:{freeport:{n:'Free Port',lead:'free'},exchange:{n:'Stock Exchange',lead:'free'},palace:{n:'Royal Palace',lead:'crown'},farm:{n:'Farm Estates'}},
    ISSUE_BY_ID:{'fun-parrot-ministry':{t:'Polly Has the Portfolio'},'txt-n':{t:'The {N} Affair'}},
    fill:(t,n)=>String(t).replace(/\{N\}/g,n.name),
    list:a=>a.length<2?a.join(''):a.slice(0,-1).join(', ')+' and '+a[a.length-1],cap1:s=>s?s.charAt(0).toUpperCase()+s.slice(1):s,
    esc:s=>String(s),awayWhen:t=>'@'+new Date(t).toISOString().slice(0,16),Object,Math,Number,Date,WeakMap,Set,isFinite};
  vm.createContext(ctx);
  vm.runInContext([
    cut('const LDR=[','Object.assign(BUILDINGS,{'),
    cut('/* the edict that has just been decided','/* ── How to play ── */')
  ].join('\n')+'\nthis.LDR_GRACE=LDR_GRACE;this.ldrOf=ldrOf;this.ldrWork=ldrWork;this.ldrGrace=ldrGrace;this.ldrGap=ldrGap;this.ldrNotice=ldrNotice;this.ldrFig=ldrFig;',ctx);
  return ctx;
}
const G=load();
const hook=G.COMMIT_HOOKS[0];
const s=o=>Object.assign({civil:70,econ:70.5,pol:75,wealth:70,equal:70,relig:50},o);
/* a nation as the record holds it: a United States with a finished Free Port */
const nation=(o={})=>({name:'Zatra',pretitle:o.pretitle||'United States',s:s(o.s),cities:o.cities||[{nm:'East Myna',b:[{k:'freeport',d:T0-DAY},{k:'farm',d:T0-DAY}]}],
  answered:o.answered||[{id:'odd',o:0,t:T0-3600e3}],...(o.ldg?{ldg:o.ldg}:{})});
const decide=(n,id,econ)=>({...structuredClone(n),s:s({...n.s,econ}),answered:n.answered.concat({id,o:1,t:T0})});

test('figures are never rounded across a line: 69.96 reads 69.9, not 70.0',()=>{
  assert.equal(G.ldrFig(69.54),'69.5');assert.equal(G.ldrFig(69.96),'69.9');assert.equal(G.ldrFig(70),'70.0');
  const q=G.ldrGap(nation({s:{econ:69.54}}),'free');
  assert.equal(q.is,'Economic Freedom is 69.5');assert.equal(q.was,'Economic Freedom fell to 69.5');
  assert.equal(q.need,'the Free market group needs 70 or more');assert.equal(q.fix,'bring Economic Freedom back to 70');
});

test('falling out of a group with a building standing: three days of grace, and the toast names figure, edict, line and deadline',()=>{
  const old=nation(),n=decide(old,'fun-parrot-ministry',69.54);
  const out=hook(n,old,T0);
  assert.deepEqual({...n.ldg},{free:T0});
  assert.equal(out.length,1);
  assert.equal(out[0],`Economic Freedom fell to 69.5 after “Polly Has the Portfolio”, and the Free market group needs 70 or more. Your Free Port keeps working for three more days, until @${new Date(T0+3*DAY).toISOString().slice(0,16)}. Bring Economic Freedom back to 70 by then and nothing stops; otherwise it falls dormant until you do.`);
  /* a United States with Political Freedom 75 is also a Republic, which nothing here touches */
  assert.deepEqual([...G.ldrOf(n)],['rep'],'building a new one still needs the group');
  assert.deepEqual([...G.ldrWork(n,T0+DAY)],['rep','free'],'the standing one works');
  assert.deepEqual([...G.ldrWork(n,T0+3*DAY-1)],['rep','free'],'until the last moment of the third day');
  assert.deepEqual([...G.ldrWork(n,T0+3*DAY)],['rep'],'then it is dormant (the same record: the memo knows when the grace ends)');
});

test('back over the line in time: the record is cleared and the player is told there is no deadline',()=>{
  const old=nation(),n=decide(old,'fun-parrot-ministry',69.5);hook(n,old,T0);
  const back={...structuredClone(n),s:s({econ:71.5}),answered:n.answered.concat({id:'yth',o:1,t:T0+3600e3})};
  const out=hook(back,n,T0+3600e3);
  assert.equal(back.ldg,undefined);
  assert.deepEqual([...out],['Free market again: your Free Port keeps working, with no deadline.']);
  /* and a dip after that starts a fresh three days */
  const again=decide(back,'fun-parrot-ministry',69.5);hook(again,back,T0+2*DAY);
  assert.equal(again.ldg.free,T0+2*DAY);
});

test('back after the grace ran out: the building wakes, as before',()=>{
  const old=nation({s:{econ:69.5},ldg:{free:T0-4*DAY}}),n={...structuredClone(old),s:s({econ:72})};
  assert.deepEqual([...G.ldrWork(old,T0)],['rep']);
  assert.deepEqual([...hook(n,old,T0)],['The Free Port wakes and works again under your government.']);
});

test('no building of the group: nothing recorded, nothing said; an ended grace drops off the record at the next save',()=>{
  const old=nation({cities:[{nm:'Oak',b:[{k:'farm',d:T0-DAY}]}]}),n=decide(old,'fun-parrot-ministry',60);
  assert.deepEqual([...hook(n,old,T0)],[]);assert.equal(n.ldg,undefined);
  const stale=nation({s:{econ:60},ldg:{free:T0-5*DAY}}),next={...structuredClone(stale)};
  hook(next,stale,T0);assert.equal(next.ldg,undefined);
});

test('a building still going up is graced too, but only finished ones are named',()=>{
  const old=nation({cities:[{nm:'East Myna',b:[{k:'freeport',d:T0+3600e3}]}]}),n=decide(old,'fun-parrot-ministry',69);
  assert.deepEqual([...hook(n,old,T0)],[]);assert.equal(n.ldg.free,T0);
});

test('a title change: the Crown group needs a crowned state, and the fix is in Settings',()=>{
  const old=nation({pretitle:'Kingdom',cities:[{nm:'Cap',b:[{k:'palace',d:T0-DAY}]}]}),n={...structuredClone(old),pretitle:'Republic'};
  const out=hook(n,old,T0);
  assert.match(out[0],/^Your type of state is “Republic” now, and the Crown group needs a crowned state, such as a kingdom or an empire\. Your Royal Palace keeps working for three more days/);
  assert.match(out[0],/Choose a crowned type of state in Settings by then and nothing stops/);
});

test('the edict is named only when this save decided it',()=>{
  const old=nation(),n={...structuredClone(old),s:s({econ:69})};
  assert.match(hook(n,old,T0)[0],/^Economic Freedom fell to 69\.0, and the Free market/,'a save without a new decision names none');
  const odd=decide(old,'txt-n',69);assert.match(hook(odd,old,T0)[0],/after “The Zatra Affair”/,'titles are filled in');
});

test('the Nation page notice: what stops, when, and what saves it',()=>{
  const n=nation({s:{econ:69.5},ldg:{free:T0-DAY}});
  const h=G.ldrNotice(n,T0);
  assert.match(h,/data-act="ux-government"/);
  assert.match(h,new RegExp(`Your Free Port stops working on @${new Date(T0+2*DAY).toISOString().slice(0,16)} unless you bring Economic Freedom back to 70\\. Economic Freedom is 69\\.5\\.`));
  assert.equal(G.ldrNotice(n,T0+2*DAY),'','gone once the grace has run out');
  assert.equal(G.ldrNotice(nation({s:{econ:71},ldg:{free:T0}}),T0),'','and while the group is held');
});

test('records from other players are checked: unknown groups, future dates and junk are dropped',()=>{
  const n={},norm=G.NORM_HOOKS[0];
  norm(n,{ldg:{free:T0-DAY,crown:'x',nope:T0,iron:Date.now()+DAY,faith:-5}});
  assert.deepEqual({...n.ldg},{free:T0-DAY});
  const m={ldg:{free:1}};norm(m,{});assert.equal(m.ldg,undefined);
});
