// The map, faster (2026-11-20; the owner picked ideas 1, 2, 3, 4 and 10 of a measured list): facts worked out once per
// pass (render, drawMap, the map panel), one map picture per page drawn, the sea held still at rest, the land's colours
// and borders ready drawn when zoomed out, and label widths remembered. These checks run the pieces that can run on their
// own and keep the wiring in place; test/map-speed.mjs drives the page itself.
// Run with: node --test test/map-speed.test.mjs
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const game=readFileSync(new URL('../game/edictum.html',import.meta.url),'utf8');
const cut=(a,b)=>{const i=game.indexOf(a);assert.ok(i>=0,a);const j=game.indexOf(b,i);assert.ok(j>i,b);return game.slice(i,j);};

test('a pass keeps each answer once, and forgets it on a save, a new record or the end of the pass',()=>{
  const ctx=vm.createContext({S:{nation:{a:1},world:{}},HIDN:{w:{}}});
  vm.runInContext(cut('const PASS={d:0','const terrCache=new Map();').replace('const PASS=','var PASS=')+'\nthis.PASS=PASS;this.passRun=passRun;this.passGet=passGet;this.passForget=passForget;',ctx);
  const {passRun,passGet,passForget}=ctx;let n=0;const ask=()=>passGet('q','k',()=>++n);
  assert.equal(ask(),1);assert.equal(ask(),2,'outside a pass every question is worked out');
  n=0;passRun(()=>{assert.equal(ask(),1);assert.equal(ask(),1,'kept within the pass');
    assert.equal(passGet('q','other',()=>'x'),'x','another subject is another answer');
    passRun(()=>{assert.equal(ask(),1,'a pass inside a pass is the same pass');});
    passForget();assert.equal(ask(),2,'a save forgets');
    ctx.S.nation={a:2};assert.equal(ask(),3,'a new record of the nation forgets');
    ctx.S.world={};assert.equal(ask(),4,'so does a new world');
    ctx.HIDN.w={};assert.equal(ask(),5,'and new hidden nations');
    assert.equal(ask(),5);},null,[]);
  assert.equal(ctx.PASS.m,null,'the pass ends with its outermost call');assert.equal(ask(),6);
  assert.throws(()=>passRun(()=>{throw new Error('x');},null,[]));assert.equal(ctx.PASS.d,0,'an error still ends the pass');
});

test('the questions a pass keeps are wrapped last, round every other hook, and the passes open where they should',()=>{
  const tail=cut('/* The questions a pass keeps (see passRun)','\nif(hot&&typeof hot.snapshot===');
  assert.ok(game.indexOf(tail)>game.indexOf('\nconst hot=window.claude&&window.claude.hot;\n'),'after const hot: the tests that run the script up to it leave the wrappers out');
  const at=game.indexOf(tail);
  for(const f of ['territory','politics','atWar','warWith','protectedNow','frontier','cityState','mpHarbours','landCredits','render','updateMapPanel','drawMap'])
    for(const m of game.matchAll(new RegExp('\\n'+f+'=\\(f=>','g')))assert.ok(m.index<at||m.index<at+tail.length,`${f}: every other hook comes before the pass's (${m.index})`);
  assert.equal(game.indexOf('=(f=>',at+tail.length),-1,'nothing is wrapped after them');
  for(const f of ['territory','politics','atWar','warWith','protectedNow','frontier','cityState','mpHarbours','landCredits'])assert.match(tail,new RegExp('\\n'+f+'=\\(f=>function\\([^)]*\\)\\{return [^\\n]*passGet\\('),f);
  for(const f of ['render','updateMapPanel','drawMap'])assert.match(tail,new RegExp('\\n'+f+'=\\(f=>function\\([^)]*\\)\\{return PASS\\.m\\?f\\.apply\\(this,arguments\\):passRun\\(f,this,arguments\\);\\}\\)\\('+f+'\\);'),f);
  assert.match(tail,/territory=\(f=>function\(extra\)\{return extra\|\|!PASS\.m\?f\.apply\(this,arguments\):passGet\('terr',TERR_AT==null\?'':TERR_AT,/,'the land as it was at another moment is its own answer');
  assert.match(game,/function commit\(n\)\{passForget\(\);/,'a save forgets the pass’s answers');
  /* code that changes a record in place to see what would follow (the income forecast) forgets them too */
  const ifc=cut('function ifcPlan(','\n/* what is under way, in words');
  assert.match(ifc,/const fresh=\(\)=>\{econMemo=[^\n]*cityMemo=[^\n]*passForget\(\);return/,'each step of the forecast');
  assert.match(ifc,/undo\[j\]\(\);econMemo=saved\.e;cityMemo=saved\.c;passForget\(\);/,'and the record put back');
  assert.match(game,/function findNation\(id\)\{\n {2}\/\*[^\n]*\*\/\n {2}if\(PASS\.m\)return passGet\('nat','',/,'nations by id once per pass');
});

test('the hexes to claim are worked out once and drawn twice from the same list',()=>{
  assert.match(game,/function claimCells\(T\)\{return passGet\('claimCells',T,\(\)=>\{const set=new Set\(\),list=\[\];for\(const b of claimableBlocks\(T\)\)for\(const c of blockPlan\(T,b\)\)if\(freeCell\(T,c\)&&!set\.has\(c\)\)/);
  const dm=cut('function drawMap(cv,P){','\nconst pendingDraw=new Set();');
  assert.ok(dm.includes('const CC=claimCells(T),set=CC.set,cells=CC.list.filter('),'the map’s shading and dashed edge');
  assert.ok(game.includes('for(const c of claimCells(M.T).list){hexPath(P,c,HEX_R-0.6);any=true;}'),'the overlay’s pulse');
  assert.ok(!/for\(const b of claimableBlocks\(M?\.?T\)\)for\(const c of blockPlan\(M?\.?T,b\)\)if\(freeCell\(M?\.?T,c\)\)\{(hexPath|set\.add)/.test(game),'no copy of the old loop left');
});

test('a page drawn asks each map for one picture in the next frame; the observer stays and asks only on a new size',()=>{
  const im=cut('let mapRO=null;const mapObs=new Set();','\nfunction zoomAt(');
  assert.ok(!/drawMap\(/.test(im),'no picture drawn at once');assert.ok(!/disconnect\(\)/.test(im),'the observer is not made again');
  assert.match(im,/cvs\.forEach\(cv=>\{bindMap\(cv\);if\(mapRO&&!mapObs\.has\(cv\)\)\{mapObs\.add\(cv\);mapRO\.observe\(cv\);\}schedule\(cv\);\}\);/);
  assert.match(im,/cv\._sz!==cv\.clientWidth\+'x'\+cv\.clientHeight\)schedule\(cv\)/,'a resize still draws');
  assert.match(im,/if\(!cv\.isConnected\)\{mapObs\.delete\(cv\);if\(mapRO\)mapRO\.unobserve\(cv\);\}/,'canvases gone from the page are let go');
  assert.match(game,/if\(!cw\|\|!ch\)return;if\(!P\)cv\._sz=cw\+'x'\+ch;/,'drawMap notes the size it drew at');
});

test('the sea moves at 15 frames a second, holds still at rest or out of focus, and the night still moves',()=>{
  const t=cut('const MFX_AMB=','\nfunction mfxHover(');
  assert.match(t,/MFX_AMB=1000\/15,MFX_PARK=Math\.max\(500,Number\(window\.EDICTUM_MFX_PARK\)\|\|30000\),MFX_NIGHT_EVERY=Math\.max\(500,Number\(window\.EDICTUM_MFX_NIGHT\)\|\|10000\)/);
  assert.match(t,/if\(park&&!fast\)\{held=true;if\(mfxNightOn&&ts-f\.last>=MFX_NIGHT_EVERY-4\)\{f\.last=ts;mfxFrame\(f,f\.lt\|\|ts\);\}continue;\}/,'held: the sea at its last moment, the night drawn on');
  assert.match(t,/fast\?MFX_STEP:MFX_AMB/,'claims and hover keep 30 a second');
  assert.match(t,/window\.addEventListener\('blur',\(\)=>\{mfxBlur=true;\}\);/);assert.match(t,/window\.addEventListener\('focus',\(\)=>\{mfxBlur=false;mfxFocusAt=Date\.now\(\);mfxWake\(\);\}\);/,'back in focus counts as a touch');
  for(const e of ['pointerdown','pointermove','keydown','wheel','touchstart','scroll'])assert.ok(t.includes(`'${e}'`),e);
  assert.ok(!/mfxStep/.test(game),'the old rates are gone');
});

test('the held hexes in view come out by holder in the order the hex-by-hex loop met them',()=>{
  const COLS=23,ROWS=17,N=COLS*ROWS,cx=new Float64Array(N),cy=new Float64Array(N);
  for(let i=0;i<N;i++){const r=Math.floor(i/COLS),c=i%COLS;cx[i]=c*10+(r&1?5:0);cy[i]=r*8.66;}
  let seed=7;const rnd=()=>(seed=(seed*1103515245+12345)&0x7fffffff)/0x7fffffff;
  const owner=new Int16Array(N).fill(-1);for(let i=0;i<N;i++){const u=rnd();owner[i]=u<0.4?-1:Math.floor(u*9)%6;}
  const T={list:[0,1,2,3,4,5].map(()=>({})),owner};
  const ctx=vm.createContext({MAP:{N,COLS,ROWS,cx,cy}});
  vm.runInContext(cut('function mtpCells(T){','function mtpDrop(){')+'\nthis.mtpByO=mtpByO;this.mtpCells=mtpCells;',ctx);
  for(const [x0,x1,y0,y1] of [[0,999,0,999],[37,141,20,90],[-50,60,-10,40],[150,240,100,150]]){
    const want=new Map();for(let i=0;i<N;i++){const x=cx[i],y=cy[i];if(x<x0||x>x1||y<y0||y>y1)continue;const o=owner[i];if(o>=0){let a=want.get(o);if(!a)want.set(o,a=[]);a.push(i);}}
    const got=ctx.mtpByO(T,x0,x1,y0,y1);
    assert.deepEqual([...got.keys()],[...want.keys()],'holders in the same order');
    for(const [o,a] of want)assert.deepEqual([...got.get(o)],a,'the same hexes');
  }
  assert.equal(ctx.mtpCells(T),ctx.mtpCells(T),'worked out once for each share-out of the land');
});

test('the land comes ready drawn zoomed out on the World map, at the hex-by-hex picture’s places and order',()=>{
  const dm=cut('function drawMap(cv,P){','\nconst pendingDraw=new Set();');
  assert.ok(dm.includes("const tp=useBmp&&kind==='main'?mtpGet(T,kind,s,dpr,ox,oy,TA,!P,PW*PH):null;"),'only zoomed out, on the World map; a plate never makes them');
  assert.match(dm,/ML\('terrain'\);\n {2}if\(tp\)mtpDraw\(g,tp\.fill,dpr,ox,oy\);\n {2}else\{g\.globalAlpha=TA;for\(const \[o,cells\] of byO\)fillHeld\(/,'the colours where the fills went');
  assert.match(dm,/ML\('land'\);\n {2}if\(tp\)mtpDraw\(g,tp\.edge,dpr,ox,oy\);\n {2}else for\(const \[o,cells\] of byO\)\{g\.beginPath\(\);edgeList\(/,'the borders where the border lines went');
  assert.ok(dm.includes('get byT(){needCells();return byT;},get byP(){needCells();return byP;}'),'layers still get hexes by terrain and paint when they ask');
  const g=cut('function mtpGet(','function mtpDraw(');
  assert.match(g,/const key=\[q,s,alpha,W,H,fill\.join\(','\),edge\.join\(','\)\]\.join\('\|'\);\n {2}if\(MTP\.T===T&&MTP\.key===key\)return MTP;/,'kept while the land, its colours, the shade and the scale stay');
  assert.match(g,/order\.sort\(\(a,b\)=>C\[a\]\[0\]-C\[b\]\[0\]\)/,'nations by their first hex, as before');
  assert.match(g,/if\(W\*H>Math\.min\(MTP_MAX,Math\.max\(MTP_MIN,1\.25\*cvPx\)\)\)/,'only when the whole region is not much bigger than the canvas');
  assert.match(game,/const cvs=document\.querySelectorAll\('canvas\.map-cv'\);mtpTidy\(\);/,'let go when the World map leaves the page');
});

test('label widths are remembered by font, letter spacing and text, and forgotten when a typeface loads',()=>{
  let onLoad=null;const ctx=vm.createContext({document:{fonts:{addEventListener:(e,f)=>{if(e==='loadingdone')onLoad=f;}}}});
  vm.runInContext(cut('const MAP_TW=new Map();',"\nconst ")+'\nthis.mapTW=mapTW;this.MAP_TW=MAP_TW;',ctx);
  let calls=0;const g={font:'600 11px serif',letterSpacing:'0px',measureText:t=>{calls++;return {width:t.length*7};}};
  assert.equal(ctx.mapTW(g,'Lampwick'),56);assert.equal(ctx.mapTW(g,'Lampwick'),56);assert.equal(calls,1,'measured once');
  g.font='700 12px serif';ctx.mapTW(g,'Lampwick');assert.equal(calls,2,'another font is measured');
  g.letterSpacing='0.9px';ctx.mapTW(g,'Lampwick');assert.equal(calls,3,'so is another letter spacing');
  assert.ok(onLoad,'listens for typefaces loading');onLoad();ctx.mapTW(g,'Lampwick');assert.equal(calls,4,'a typeface loaded: measured again');
  const sites=game.match(/mapTW\(g,/g)||[];assert.ok(sites.length>=10,'the map’s labels use it ('+sites.length+')');
  assert.ok(game.includes('const tw=mapTW(g,name),b={x:px-tw/2-3,y:py-fs,w:tw+6,h:fs+5};'),'the nations’ names');
});
