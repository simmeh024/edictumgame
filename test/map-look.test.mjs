// "Your map look" on the World map page (2026-11-16): the card under "Your territory" lists every map colour and every
// hex background (land finish) there is, and a locked one opens its pack's Shop drawer over the map page. These checks
// keep the lists whole as packs are added, and keep the drawer over the map wired to Escape, the full-screen map and the
// gallery. The card is closed until opened (kept as left), and a colour chosen on it is worn at once. The browser test
// (test/map-look.mjs) drives the page itself.
// Run with: node --test test/map-look.test.mjs
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';

const game=readFileSync(new URL('../game/edictum.html',import.meta.url),'utf8');
const has=(s,why)=>assert.ok(game.includes(s),why||s);

test('every hex background the game has is in the card’s list, Plain aside',()=>{
  const all=[...game.matchAll(/\['(te-[a-z0-9]+)','territory','[^']+'\]/g)].map(m=>m[1]);
  const m=/MLK_TE=\[([^\]]+)\]/.exec(game);assert.ok(m,'MLK_TE is there');
  const listed=m[1].split(',').map(s=>s.trim().replace(/'/g,''));
  assert.ok(all.length>=6,'six or more land finishes');
  assert.deepEqual([...all].sort(),[...listed].sort(),'a new land finish (kind territory) must join MLK_TE');
});

test('every map colour there is shows on the card: the twelve, the tutorial’s, the Cartographer’s',()=>{
  const i=game.indexOf('function mlkCard(');assert.ok(i>0);const body=game.slice(i,game.indexOf('\nfunction mlkDrawer(',i));
  for(const s of ['Object.keys(MAP_COLORS)','tutMapcs()','Object.keys(CTG_MC)','mapcHow(n,s)','shopSells(\'cartopack\')'])assert.ok(body.includes(s),s);
  /* the Settings list is built from the same three: a colour added there must be added here */
  const set=game.slice(game.indexOf('<fieldset class="sg-fs" id="set-mapc">'),game.indexOf('</fieldset>',game.indexOf('<fieldset class="sg-fs" id="set-mapc">')));
  assert.match(set,/Object\.keys\(MAP_COLORS\)[\s\S]*mapcEarnedSw\(n,st\)\}\$\{ctgMcSw\(n,st\)\}/,'Settings still lists MAP_COLORS, the earned colours and the pack’s');
});

test('the card sits under Your territory, and the drawer opens over the map page',()=>{
  has('Centre on ${esc(n.name)}</button></div>\n    ${mlkCard(n)}`;','the card follows the Centre-on button');
  has("    <div class=\"ml-legend\">${mapLegend(placed?migToggle():'')}</div>\n  </div>${mlkDrawer(n)}`;",'the map page draws the Shop drawer when one is open');
  has("const ov=S.view==='map'?' mlk-dr':'';",'over the map the drawer and scrim take a class');
  has('.shop-scrim.mlk-dr{z-index:3100}.shop-dr.mlk-dr{z-index:3101}','above the full-screen map (z-index 3000) and its panel (3001)');
  has("${shopNotice(n)}${S.view==='map'?mlkGallery(n,p):''}${body}",'the gallery leads the drawer over the map');
});

test('Escape closes the drawer over the map first, and the full-screen map only after',()=>{
  has("if(e.key==='Escape'&&SHOP.dr&&(S.view==='shop'||S.view==='map')){e.preventDefault();shopDrClose();}");
  has("if(e.key==='Escape'&&S.mapFs&&!(SHOP.dr&&S.view==='map')){e.preventDefault();e.stopPropagation();mapFsClose();}");
});

test('over the map, a pack leaves out the land pictures the gallery already shows',()=>{
  has("${S.view==='map'?'':`<h3 class=\"sub-h\">Four finishes for your land</h3>");
  has("${S.view==='map'&&placed?'':`<div class=\"shop-pv-box\"><p class=\"shop-pv-l\">${placed?`Your land round ${esc(n.capital)}, in the Stepped Fret`");
});

test('"Back to the pack" from a try-on reopens the drawer over the map; the Founder’s Gilt can be tried on',()=>{
  has("if(S.view==='map'&&el.closest('.ctg-try')){redrawMaps();mlkShop(p,tid||'');return;}");
  has("te=cz(x.me&&S.nation?S.nation:x.n).te;",'the gilt layer reads the nation as cz() sees it, try-on included');
});

test('a colour is worn at once and the map drawn again in it; a held finish opens Customise at Finery',()=>{
  const i=game.indexOf('function mlkMcSet(');assert.ok(i>0);const body=game.slice(i,game.indexOf('\nfunction mlkCard(',i));
  assert.ok(body.includes('if(c&&!(tutMapcOk(n0,c)&&ctgMcOk(n0,c)))return;'),'only a colour the player may wear, as saveSettings allows');
  assert.ok(body.includes('n.mapc=c;commit(n);'),'saved on the nation');
  assert.ok(body.includes('if(S.settings)S.settings.mapc=c;'),'Settings shows the new colour, other changes waiting there kept');
  assert.ok(body.includes('updateMapPanel();redrawMaps();')&&!body.includes('render()'),'only the panel and the map are drawn again in the new colour: the page does not move');
  has("else if(a==='mlk-mc'){const v=el.dataset.val||'',c=v?safeColor(v,''):'';if(v&&!c)return;mlkMcSet(c);}",'a swatch, or Match my flag (no value), sets it');
  has('data-act="mlk-mc" data-val="" aria-pressed="${!mc}">Match my flag</button>','the way back to the flag colour');
  has("czTabFor('cz-sec-z');uxOpen('customise',null,'.cz-g-te');",'only the open section of Customise is drawn, so Finery is chosen first');
});

test('the colour’s name never wraps, so the card keeps its height when another is chosen',()=>{
  has('.mlk-r>b{grid-area:b;min-width:0;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}');
});

test('the card is closed until opened, drawn as a line, and remembers being opened',()=>{
  has("function mlkIsOpen(){if(MLK.open===undefined)try{MLK.open=localStorage.getItem(MLK_OPEN)==='1';}catch(e){MLK.open=false;}return !!MLK.open;}",'closed unless opened before on this device');
  has('if(!open)return `<section class="mlk" aria-labelledby="mlk-h">${head}<div class="mlk-b" id="mlk-b" hidden></div></section>`;','closed, nothing else is drawn (no land pictures, no Shop call)');
  has('data-act="mlk-tg" aria-expanded="${open}" aria-controls="mlk-b"','the toggle says whether it is open');
  has("if(a==='mlk-tg')mlkToggle();");
});
