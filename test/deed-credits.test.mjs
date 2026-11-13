// Land credits for deeds: crises decided in time, gambles won, city titles, buildings upgraded to gold and trade deals
// signed (section "land credits for deeds"). Run with: node --test test/deed-credits.test.mjs
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import assert from 'node:assert/strict';

const source=readFileSync(new URL('../game/edictum.html',import.meta.url),'utf8');
const line=s=>{const i=source.indexOf(s);assert(i>=0,s);return source.slice(i,source.indexOf('\n',i));};
const section=(a,b)=>{const s=source.indexOf(a),e=source.indexOf(b,s);assert(s>0&&e>s,'section '+a);return source.slice(s,e);};
const DEEDS=section('/* ───────── land credits for deeds','/* ───────── land credits: a toast when one arrives');

function game({paused=false,view='nation'}={}){
  const ctx=vm.createContext({});
  vm.runInContext(`
    ${line('function list(a){')}
    ${line('const blkTi=rec=>')}
    const CX_UG_MAX=5,NORM_HOOKS=[],COMMIT_HOOKS=[],S={view:${JSON.stringify(view)}};
    function cxUpgradable(k){return k!=='warehouse'&&k!=='wonder';}
    function cxUps(b,now){return b.ug||0;}
    function lcPaused(){return ${paused};}
    function landEarned(n){return 7;}function earnedAt(n,p){return 7;}
    function landHelp(n){return '<p><b>Land credits.</b> …</p>\\n    <p><b>Lakes.</b> …</p>';}
    ${DEEDS}
    this.G={dlCount,dlValue,dlOf,dlWhy,deedCredits,landEarned:n=>landEarned(n),earnedAt:(n,p)=>earnedAt(n,p),landHelp:n=>landHelp(n),
      hook:(n,now)=>{let out=[];for(const h of COMMIT_HOOKS)out=out.concat(h(n,null,now||1e12)||[]);return out;},
      norm:d=>{const n={};for(const h of NORM_HOOKS)h(n,d);return n;},DL_GOLD_MAX,DL_TRADE};`,ctx);
  return ctx.G;
}
const NOW=1e12,done=NOW-1000;
const bld=(k,ug)=>({k,d:done,ug});
const nation=o=>({name:'Testland',crd:0,gmb:{w:0,l:0},tly:{},cities:[],...o});

test('back pay: what a record already shows is paid once, in one toast, and counted by landEarned and earnedAt',()=>{
  const G=game();
  const n=nation({crd:3,gmb:{w:4,l:2},tly:{crs:2,'gmb:crs':1,'gmb:w:25':1,'gmb:w:50':3,'log:trade':55},
    cities:[{ti:1,b:[bld('farm',5),bld('mine',5),bld('warehouse',5),bld('mill',4)]},{ti:2,b:[bld('port',5),{k:'farm',d:NOW+5000,ug:5}]}]});
  assert.deepEqual({...G.dlCount(n,NOW)},{c:3,b:1,g:4,l:1,t:3,u:3,r:2},'crises 3 (n.crd beats the tally), gold 3 (no warehouse, no unfinished building)');
  const out=G.hook(n,NOW);
  assert.equal(out.length,1);
  assert.equal(out[0].m,'Back pay for deeds done before they earned land: 27 land credits for 2 crises decided in time, a crisis decided in time with a gamble that came off at one in four, 3 gambles won, 3 city titles, 3 buildings upgraded to gold, and 50 trade deals signed. Spend them on the map.');
  assert.equal(out[0].k,'land');assert.deepEqual({...out[0].go},{v:'map',l:'Open the map'});
  assert.deepEqual({...n.dlc},{c:3,b:1,g:4,l:1,t:3,u:3,r:2});
  assert.equal(G.deedCredits(n),3+1+4+2+6+6+5,'1 a crisis, 1 a crisis gamble, 1 a win, 2 more at one in four, 2 a title, 2 a gold building, 2+3 for 50 deals');
  assert.equal(G.landEarned(n),7+27);assert.equal(G.earnedAt(n,1),7+27);
  assert.equal(G.hook(n,NOW).length,0,'nothing new: no toast');
  assert.equal(G.deedCredits(n),27);
});

test('a new nation starts with an empty ledger and no back pay toast',()=>{
  const G=game(),n=nation({});
  assert.equal(G.hook(n,NOW).length,0);
  assert.deepEqual({...n.dlc},{});
  n.crd=1;n.tly.crs=1;
  const out=G.hook(n,NOW);
  assert.equal(out[0].m,'A land credit for a crisis decided in time. Spend it on the map.','not back pay once the ledger exists');
});

test('one ruling at a time: a crisis, a crisis won by a gamble at one in four, a plain gamble',()=>{
  const G=game(),n=nation({});G.hook(n,NOW);
  n.crd=1;n.tly.crs=1;
  assert.equal(G.hook(n,NOW)[0].m,'A land credit for a crisis decided in time. Spend it on the map.');
  n.crd=2;n.tly.crs=2;n.tly['gmb:crs']=1;n.gmb.w=1;n.tly['gmb:w:25']=1;
  assert.equal(G.hook(n,NOW)[0].m,'5 land credits for a crisis decided in time with a gamble that came off at one in four. Spend them on the map.');
  n.gmb.w=2;n.tly['gmb:w:50']=1;
  assert.equal(G.hook(n,NOW)[0].m,'A land credit for a gamble won. Spend it on the map.');
  n.gmb.w=3;n.tly['gmb:w:25']=2;
  assert.equal(G.hook(n,NOW)[0].m,'3 land credits for a gamble won at one in four. Spend them on the map.');
  n.gmb.l=5;n.tly['gmb:l:50']=5;
  assert.equal(G.hook(n,NOW).length,0,'a gamble lost pays nothing');
  assert.equal(G.deedCredits(n),1+5+1+3);
});

test('a crisis left to the cabinet pays nothing (n.crd and the tally count only the player\'s own)',()=>{
  const G=game(),n=nation({tly:{'crs:cab':4}});G.hook(n,NOW);
  assert.equal(G.deedCredits(n),0);
});

test('city titles and gold buildings: lost ones are kept, and only a new peak pays',()=>{
  const G=game(),n=nation({cities:[{ti:2,b:[bld('farm',5),bld('mine',5)]},{ti:1,b:[bld('port',5)]}]});
  G.hook(n,NOW);assert.equal(G.deedCredits(n),3*2+3*2);
  n.cities=[{ti:2,b:[bld('farm',5)]}];
  assert.equal(G.hook(n,NOW).length,0,'a city lost and a building pulled down: no toast');
  assert.equal(G.deedCredits(n),12,'and nothing taken back');
  n.cities=[{ti:2,b:[bld('farm',5),bld('mine',5)]},{ti:1,b:[bld('port',5)]}];
  assert.equal(G.hook(n,NOW).length,0,'built back up to the old peak: still nothing new');
  n.cities.push({ti:1,b:[bld('mill',5)]});
  assert.equal(G.hook(n,NOW)[0].m,'4 land credits for a new city title and a building upgraded to gold. Spend them on the map.');
});

test('gold pays for up to DL_GOLD_MAX buildings',()=>{
  const G=game(),n=nation({cities:[{ti:0,b:Array.from({length:70},()=>bld('farm',5))}]});
  G.hook(n,NOW);
  assert.equal(n.dlc.u,G.DL_GOLD_MAX);assert.equal(G.deedCredits(n),2*G.DL_GOLD_MAX);
});

test('trade deals pay at 10, 50, 100 and 250 signed, 20 in all',()=>{
  const G=game(),n=nation({});G.hook(n,NOW);
  n.tly['log:trade']=9;assert.equal(G.hook(n,NOW).length,0);
  n.tly['log:trade']=10;assert.equal(G.hook(n,NOW)[0].m,'2 land credits for 10 trade deals signed. Spend them on the map.');
  n.tly['log:trade']=120;assert.equal(G.hook(n,NOW)[0].m,'8 land credits for 100 trade deals signed. Spend them on the map.');
  n.tly['log:trade']=5000;G.hook(n,NOW);
  assert.equal(G.deedCredits(n),20);assert.equal(n.dlc.r,G.DL_TRADE.length);
});

test('the map button is left out on the map and while gains are paused; NPCs earn nothing',()=>{
  for(const opt of [{view:'map'},{paused:true}]){const G=game(opt),n=nation({crd:1});assert.equal(G.hook(n,NOW)[0].go,null);}
  const G=game();assert.equal(G.deedCredits({npc:1,dlc:{c:9}}),0);assert.equal(G.hook({npc:1,name:'X',crd:4},NOW).length,0);
});

test('loading keeps the ledger, clamped, and drops what is not one',()=>{
  const G=game();
  assert.deepEqual({...G.norm({dlc:{c:4,b:-1,g:2.5,l:'3',t:7,u:999,r:9,zz:1}}).dlc},{c:4,t:7,u:G.DL_GOLD_MAX,r:G.DL_TRADE.length});
  assert.deepEqual({...G.norm({dlc:{}}).dlc},{},'an empty ledger stays (no back pay twice)');
  assert.equal('dlc' in G.norm({dlc:[1,2]}),false);assert.equal('dlc' in G.norm({}),false);
});

test('Help tells of deeds just before lakes',()=>{
  const G=game(),h=G.landHelp({});
  assert(h.indexOf('<p><b>Deeds.</b>')>h.indexOf('Land credits.')&&h.indexOf('<p><b>Deeds.</b>')<h.indexOf('<p><b>Lakes.</b>'));
  assert.match(h,/A crisis you decide in time earns 1 land credit, and 1 more when a gamble in it comes off\. A gamble won earns 1, or 3 at odds of one in four\./);
  assert.match(h,/Signing trade deals earns 2 at 10, 3 at 50, 5 at 100, and 10 at 250\./);
});

test('the game keeps the Warehouse out of the gold count (it pays through whLc) and the help has a Lakes paragraph to stand before',()=>{
  assert.match(line('function cxUpgradable(k){'),/k!=='warehouse'/);
  assert(line('    <p><b>Lakes.</b>').length>0);
  assert.match(line('function landExtras(n){'),/landHelp\(n\)/);
});
