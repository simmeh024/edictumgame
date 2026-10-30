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
test('all the regions together stay a small download',()=>{
  const js=Buffer.from(mapsScript(data)),br=brotliCompressSync(js,{params:{[constants.BROTLI_PARAM_QUALITY]:11}}).length;
  assert.ok(br<60*1024,`${br} bytes with brotli`);
});
