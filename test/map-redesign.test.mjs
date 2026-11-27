// The World map page, redesigned (2026-11-27, game/edictum.html "the World map page, redesigned"): the six modes and
// their keys and hints, the layers each mode turns on, the Layers popover's groups and presets, the tabbed panel, the
// landing alert moved into its dock, and the page's styles (the map as tall as the window; on a phone, the tools at
// the map's foot). The page itself is checked in the browser suites that open the map.
// Run with: npm run test:fx
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import assert from 'node:assert/strict';

const source=readFileSync(new URL('../game/edictum.html',import.meta.url),'utf8');
const code=source.slice(source.indexOf('<script>')+8,source.lastIndexOf('</script>'));
const SEC=(()=>{const a=code.indexOf('/* ───────── the World map page, redesigned (27 November 2026)'),b=code.indexOf('/* Keep the moderator preview',a);assert.ok(a>0&&b>a,'the section');return code.slice(a,b);})();
const cut=(a,b)=>{const i=SEC.indexOf(a),j=SEC.indexOf(b,i);assert.ok(i>=0&&j>i,a);return SEC.slice(i,j);};
const J=v=>JSON.parse(JSON.stringify(v));

function load(){
  const ctx={Math,Object,Array,String,JSON,Set,Map,RegExp};vm.createContext(ctx);
  vm.runInContext([cut('const MPR_MODES=','function mprMode()'),cut('const MPR_HINT=','function mprForce('),cut('const MPR_GROUPS=','const MPR_PRESETS='),cut('const MPR_PRESETS=','function mprKeyOf('),
    'this.X={MPR_MODES,MPR_HINT,MPR_FORCE,MPR_GROUPS,MPR_PRESETS,mprGroupToggles};'].join('\n').replace(/^const /gm,'var '),ctx);
  return ctx.X;
}

test('six modes on keys 1 to 6, each with its hint; Esc goes back to Explore',()=>{
  const X=load();
  assert.deepEqual(J(X.MPR_MODES.map(m=>m[0])),['','claim','plan','transport','land','war']);
  assert.deepEqual(J(X.MPR_MODES.map(m=>m[2])),['1','2','3','4','5','6']);
  for(const [v] of X.MPR_MODES)assert.ok(X.MPR_HINT[v]&&X.MPR_HINT[v][0]&&X.MPR_HINT[v][1],'a hint for '+(v||'explore'));
  assert.match(SEC,/if\(e\.key==='Escape'\)\{if\(mprMode\(\)\)\{e\.preventDefault\(\);mprSetMode\(''\);\}return;\}/);
  assert.match(SEC,/if\(tag==='INPUT'\|\|tag==='TEXTAREA'\|\|tag==='SELECT'\|\|\(t&&t\.isContentEditable\)\)return;/,'never while typing');
});

test('a mode turns on the layers it needs while it is open, and leaves the player\'s own choices alone',()=>{
  const X=load();
  assert.deepEqual(J(X.MPR_FORCE.land),{colonies:true,'mp-reach':true,'mpr-rings':true});
  assert.deepEqual(J(X.MPR_FORCE.war),{war:true,'mpr-rings':true});
  assert.match(SEC,/mapOpt=\(f=>function\(k,def\)\{const v=mprForce\(k\);return v!==undefined\?v:f\.apply\(this,arguments\);\}\)\(mapOpt\);/,'read through mapOpt, never written to the saved choice');
});

test('the Layers popover: the switches in five groups, the rest kept where it belongs',()=>{
  const X=load();
  const html='<div class="nws-ctl"><label class="mig-tog nws-tog"><input type="checkbox" data-nws="on"> News</label><label class="lens-pick"><span>Lens</span><select class="input lens-sel" data-lens="1"><option>Political</option></select></label></div>'
    +'<label class="mig-tog"><input type="checkbox" data-bind="migmap"> Show migration routes</label><div id="mig-key" aria-live="polite">key</div>'
    +'<label class="mig-tog mfx-tog wx-tog"><input type="checkbox" data-wx="1"> Weather</label><p class="wx-now">Late autumn</p>'
    +'<label class="mig-tog mfx-tog"><input type="checkbox" data-mp-opt="reach"> Harbour reach</label>'
    +'<label class="mig-tog mfx-tog"><input type="checkbox" data-mp-opt="landscape"> Policy landscapes</label>'
    +'<label class="mig-tog mfx-tog tr-tog"><input type="checkbox" data-trmap> Trade routes</label>'
    +'<label class="mig-tog mfx-tog wr3-tog"><input type="checkbox" data-wr3map> War</label>';
  const out=X.mprGroupToggles(html),groups=[...out.matchAll(/<div class="mpr-lg"><p class="mpr-lg-h">([^<]+)<\/p>([\s\S]*?)<\/div>(?=<div class="mpr-lg"|$)/g)].map(m=>[m[1],m[2]]);
  const G=Object.fromEntries(groups);
  assert.deepEqual(groups.map(g=>g[0]),['Borders and lens','Movement','Military','Economy','World']);
  assert.match(G['Borders and lens'],/data-lens/);
  assert.match(G.Movement,/data-bind="migmap"/);assert.match(G.Movement,/data-trmap/);assert.match(G.Movement,/id="mig-key"/,'the migration key with the routes');
  assert.match(G.Military,/data-mp-opt="reach"/);assert.match(G.Military,/data-wr3map/);
  assert.match(G.Economy,/data-mp-opt="landscape"/);
  assert.match(G.World,/data-nws/);assert.match(G.World,/data-wx/);assert.match(G.World,/Late autumn/,'the weather\'s words with the weather');
  assert.equal((out.match(/<label/g)||[]).length,(html.match(/<label/g)||[]).length,'no switch lost');
  for(const [k,P] of Object.entries(X.MPR_PRESETS))assert.ok(Object.keys(P).length>=10,k+' sets every switch it knows');
});

test('the page: slim header, the old tool row out, the tools, chip, hint and minimap on the map, the panel in tabs',()=>{
  assert.match(SEC,/<header class="vh mpr-head"><h1>World map<\/h1>\$\{tabs\}<div class="mpr-go">\$\{mprGoBox\(\)\}<\/div><\/header>/);
  assert.match(SEC,/h=h\.split\(tb\)\.join\(''\);h=h\.split\(tb\.replace\('mp-map-toolbar row','mp-map-toolbar mp-in-tabs'\)\)\.join\(''\);/,'the old toolbar out, wherever it was');
  assert.match(SEC,/class="\$\{tools\?'mp-map-toolbar ':''\}mpr-modes"/,'the old toolbar\'s name only once the map\'s tools are open to the nation');
  assert.match(SEC,/\[\['hex','This hex'\],\['nation','My nation'\],\['activity','Activity'\]\]/);
  assert.match(SEC,/MAP_PANEL_TOP\[i\]=ctx=>mprOn\(\)\?'':f\(ctx\);/,'the landing alert moves into the dock');
  assert.match(SEC,/function mprOn\(\)\{return !!\(S\.nation&&!OBS&&S\.view==='map'&&cellOf\(S\.nation\.loc\)>=0\);\}/,'never while observing or choosing where to begin');
  const css=source.slice(source.indexOf('/* the World map page, redesigned (27 November 2026)'),source.indexOf('</style>'));
  assert.match(css,/\.mpr \.map-wrap\.map-main:not\(\.is-full\)\{height:var\(--mpr-h,/,'the map as tall as the window');
  assert.match(css,/@media \(max-width:1100px\)\{[\s\S]*\.mpr-modes\{top:auto;bottom:10px;/,'on a phone the tools at the map\'s foot');
});

/* PR #607's first CI run: the map's height set on the layout made every render find the layout changed and draw the
   whole map afresh, canvas and all (clicks on the map timed out, a canvas read after a render was 0 wide); the height
   followed the scroll; the tools covered the "Trying on" note above the map and the hexes in the top row */
test('the map stays put: its height on the root, from the top of the page; notes above it; every hex clear of the tools',()=>{
  assert.match(SEC,/const R=document\.documentElement,was=R\.style\.getPropertyValue\('--mpr-h'\);if\(was!==h\+'px'\)\{R\.style\.setProperty\('--mpr-h',h\+'px'\);/,'never a style on the patched layout');
  assert.doesNotMatch(SEC,/L\.style\.setProperty/);
  assert.match(SEC,/const h=Math\.max\(narrow\?300:460,Math\.round\(window\.innerHeight-top-foot\)\);/,'the page\'s top, not the screen\'s: scrolling never resizes it');
  assert.match(SEC,/let top=0;for\(let e=L;e;e=e\.offsetParent\)top\+=e\.offsetTop;/,'measured as laid out, not part way through the page\'s entrance (that drew the map twice on the next page drawn)');
  assert.match(SEC,/return top\+h\.replace\('<div class="map-layout',notes\+'<div class="mpr map-layout'\);/,'what the map box puts above the map goes above the layout');
  assert.match(SEC,/v\.cy=clamp\(cy,hh-e\.t\/s,MAP\.H-hh\+e\.b\/s\);\}\)\(clampView\);/,'the view may run past the edge by what the tools cover');
  assert.match(SEC,/const su=t\.closest\('#ml-sheet>summary'\);if\(su&&mprOn\(\)\)MPR\.layOpen=!su\.parentNode\.open;/,'the Layers stay open through a render');
  assert.match(SEC,/if\(t\.closest\('\[data-act="dp-lens"\]'\)\)MPR\.layOpen=true;/,'Show on the map opens the lens\'s key');
  assert.match(SEC,/if\(b\.dataset\.v&&S\.mpMode===b\.dataset\.v\)\{e\.preventDefault\(\);e\.stopPropagation\(\);\}/,'the open tool\'s button keeps it open, even after it came back with a reload');
});
