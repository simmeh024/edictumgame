// Every region's map has its share of large iron deposits: one per 250 land hexes (at least 24), mostly in the hills and
// mountains, never on oil, from the game's own ironDepPick on every baked map.
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mapKit,bakeMaps} from '../scripts/bake-maps.mjs';
const src=readFileSync(new URL('../game/edictum.html',import.meta.url),'utf8');
const data=bakeMaps(src),ids=mapKit(src,'meridian').ids;
const grab=re=>{const m=re.exec(src);assert.ok(m,String(re));return m[0];};
const hash=new Function(grab(/function hash\(str\)\{[^\n]*\}/)+';return hash;')();
const ironDepPick=new Function(grab(/const IRON_DEP_PER=[^\n]*/)+'\n'+grab(/function ironDepPick\(T,oil,keyOf,h\)\{[\s\S]*?\n\}/)+';return ironDepPick;')();
for(const id of ids)test(`${id} has its iron deposits`,()=>{
  const M=mapKit(src,id,{__edictum:{maps:JSON.parse(JSON.stringify(data))}}).bakedMap();assert.ok(M,'the baked map decodes');
  const keyOf=i=>M.leg&&M.leg[i]>=0?M.leg[i]:id+':'+i;
  /* oil as the game places it (CELL_RES): lowland and hills, 4% of them */
  const oil=new Uint8Array(M.T.length);for(let i=0;i<M.T.length;i++)if(M.T[i]>=2&&M.T[i]<4&&hash('oil:'+keyOf(i))%1000<40)oil[i]=1;
  let land=0;for(let i=0;i<M.T.length;i++)if(M.T[i]>=2&&!oil[i])land++;const dep=ironDepPick(M.T,oil,keyOf,hash),by=[0,0,0,0,0];for(const i of dep)by[M.T[i]]++;
  assert.ok(dep.length>=Math.min(24,land),`${dep.length} deposits on ${land} land hexes`);
  assert.ok(Math.abs(dep.length-Math.max(24,Math.min(400,Math.round(land/250))))<=1||dep.length===land);
  assert.ok(dep.every(i=>M.T[i]>=2&&!oil[i]),'on land, never on oil');
  if(by[3]+by[4]>=dep.length/2||by[2]===dep.length)assert.ok(true);else assert.fail(`mostly lowland: ${by}`);
  assert.deepEqual(ironDepPick(M.T,oil,keyOf,hash),dep,'the same for every player');
  console.log(`  ${id}: ${dep.length} deposits on ${land} free land hexes (lowland ${by[2]}, hills ${by[3]}, mountains ${by[4]})`);
});
