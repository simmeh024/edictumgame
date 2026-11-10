// The baked maps (scripts/bake-maps.mjs, "the baked maps" in game/edictum.html): for every region, the map a
// page rebuilds from the baked file is the very map the generators make, field by field and hex for hex.
import {readFileSync} from 'node:fs';
import {brotliCompressSync,constants} from 'node:zlib';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mapKit,mapDiff,bakeMaps,mapsScript} from '../scripts/bake-maps.mjs';
const src=readFileSync(new URL('../game/edictum.html',import.meta.url),'utf8');
const data=bakeMaps(src),ids=mapKit(src,'meridian').ids;
const page=(id,maps)=>mapKit(src,id,maps===undefined?{}:{__edictum:{maps}});

test('the game builds its map from the baked file first and generates it only without one',()=>{
  assert.match(src,/\nconst MAP=bakedMap\(\)\|\|\(REG_MER\?embedLegacy\(legacyMap\(\)\):genRegionMap\(REG\)\);\n/);
  assert.equal(page('meridian').bakedMap(),null);
});
test('every region is baked',()=>{
  assert.ok(ids.length>=26);
  assert.deepEqual(Object.keys(data.r).sort(),ids.slice().sort());
});
for(const id of ids)test(`the baked map of ${id} is the generated map`,()=>{
  const made=page(id).generate(),kit=page(id,JSON.parse(JSON.stringify(data))),back=kit.bakedMap();
  assert.equal(kit.REG.id,id);
  assert.ok(back,'the page decodes the baked entry');
  assert.equal(mapDiff(back,made),'');
  assert.equal(back.T.length,kit.MAP_COLS*kit.MAP_ROWS);
  assert.ok(Object.keys(back.npcLoc).length>0&&back.comps.some(c=>c.name));
});
test('the comparison notices one changed hex, landmass name, coast distance or capital',()=>{
  const a=page('northernpale',data).bakedMap(),b=page('northernpale',data).bakedMap();
  assert.equal(mapDiff(a,b),'');
  b.T[b.T.length>>1]^=1;assert.equal(mapDiff(a,b),`map.T[${b.T.length>>1}]`);b.T[b.T.length>>1]^=1;
  b.comps[0].name+='x';assert.equal(mapDiff(a,b),'map.comps[0].name');b.comps[0].name=a.comps[0].name;
  b.coast[b.comps[0].cells[0]]++;assert.match(mapDiff(a,b),/^map\.coast\[/);b.coast[b.comps[0].cells[0]]--;
  const k=Object.keys(b.npcLoc)[0];b.npcLoc[k]++;assert.equal(mapDiff(a,b),'map.npcLoc.'+k);
});
test('an entry for another grid, or a damaged one, is generated instead',()=>{
  const other=JSON.parse(JSON.stringify(data));other.r.frostmarch.c+=1;
  assert.equal(page('frostmarch',other).bakedMap(),null);
  const bad=JSON.parse(JSON.stringify(data)),t=Buffer.from(bad.r.meridian.t,'base64');t[t.length>>1]^=0x5a;bad.r.meridian.t=t.toString('base64');
  assert.equal(page('meridian',bad).bakedMap(),null);
  assert.equal(page('meridian',{v:2,r:data.r}).bakedMap(),null);
});
/* the baked tables ("the baked tables" in the game): biomes and large iron deposits */
test('the game takes its biomes and iron deposits from the baked tables first',()=>{
  assert.match(src,/\nconst BIOME=bakedTab\('b',MAP\)\|\|\(\(\)=>\{\n/);
  assert.match(src,/for\(const i of bakedTab\('d',MAP\)\|\|ironDepPick\(MAP\.T,CELL_RES\.oil,cellKey,hash\)\)/);
  assert.equal(page('meridian').bakedTab('b',page('meridian').generate()),null,'no baked file, no table');
});
for(const id of ['meridian','terra','coralreach'])test(`the baked tables of ${id} are the game's own`,()=>{
  const made=mapKit(src,id,{},true),kit=page(id,JSON.parse(JSON.stringify(data))),back=kit.bakedMap();
  assert.equal(mapDiff(kit.bakedTab('b',back),made.BIOME,'BIOME'),'');
  const dep=[];for(let i=0;i<made.IRON_DEP.length;i++)if(made.IRON_DEP[i])dep.push(i);
  assert.ok(dep.length>=24);
  assert.deepEqual(kit.bakedTab('d',back),dep);
});
test('a damaged table is worked out instead, and the map still comes from the baked file',()=>{
  const bad=JSON.parse(JSON.stringify(data)),b=Buffer.from(bad.r.meridian.b,'base64');b[b.length>>1]^=0x5a;bad.r.meridian.b=b.toString('base64');
  let kit=page('meridian',bad),back=kit.bakedMap();
  assert.ok(back);assert.equal(kit.bakedTab('b',back),null);
  const bad2=JSON.parse(JSON.stringify(data));bad2.r.meridian.d='zz,-3';
  kit=page('meridian',bad2);back=kit.bakedMap();
  assert.ok(back);assert.equal(kit.bakedTab('d',back),null);
  const none=JSON.parse(JSON.stringify(data));delete none.r.meridian.b;delete none.r.meridian.d;
  kit=page('meridian',none);back=kit.bakedMap();
  assert.ok(back);assert.equal(kit.bakedTab('b',back),null);assert.equal(kit.bakedTab('d',back),null);
});
/* the tables roughly double the file (≈ 56 KB to ≈ 98 KB); it is cached for good and downloads beside the much larger
   game script, so it does not lengthen a first visit, and every visit then skips over half a second on a phone */
test('all the regions together stay a small download',()=>{
  const js=Buffer.from(mapsScript(data)),br=brotliCompressSync(js,{params:{[constants.BROTLI_PARAM_QUALITY]:11}}).length;
  assert.ok(br<110*1024,`${br} bytes with brotli`);
});
