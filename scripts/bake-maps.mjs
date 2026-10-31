// Bake every region's map at build time, so a page decodes its map in a few milliseconds instead of
// generating it on every load (see "the baked maps" in game/edictum.html). This runs the game's own
// generators, taken from its source, for each region, codes the land levels with the game's own mapLevels
// (a context-modelled binary range coder: all regions together come to about 50 KB) and keeps the landmass
// names and the computer nations' capitals. Every entry is then decoded with the game's own bakedMap and
// compared with the generated map, hex for hex and field by field; any difference stops the build. The
// build bakes from the source it builds, so the maps can never be older than the generators.
//   node scripts/bake-maps.mjs < game-script.js > maps.js
import {fileURLToPath} from 'node:url';

// The parts of the game the generators need, from these markers up to the next ones.
const PARTS=[
  ['const LEG={','/* a stable key for per-hex randomness'],
  ['/* hex geometry for a grid','/* older Meridian records (map version 2)'],
  ['const HEX_R=10,','\nconst MAP=bakedMap()'],
];
function cut(source,a,b){
  const i=source.indexOf(a),j=i<0?-1:source.indexOf(b,i);
  if(i<0||j<0)throw new Error(`bake-maps: the game no longer has "${a}" … "${b}"; update PARTS in scripts/bake-maps.mjs`);
  return source.slice(i,j);
}
// A fresh copy of the generators, as the game would set them up in a browser whose saved nation lives in `region`.
export function mapKit(source,region,win={}){
  const hash=source.match(/^function hash\(str\)\{[^\n]+/m);
  if(!hash)throw new Error('bake-maps: the game no longer has function hash(str) on one line');
  const code=PARTS.map(([a,b])=>cut(source,a,b)).join('\n')+'\n'+hash[0]+'\n'+
    'return {REG,REG_MER,MAP_COLS,MAP_ROWS,ids:REGIONS.map(r=>r.id),generate:()=>REG_MER?embedLegacy(legacyMap()):genRegionMap(REG),bakedMap,mapLevels,mapUnpack,mapSum,genGeom};';
  const store={'statehood.nation.v1':JSON.stringify({name:'Baker',reg:region})};
  return new Function('localStorage','window',code)({getItem:k=>Object.prototype.hasOwnProperty.call(store,k)?store[k]:null},win);
}
// The first difference between two maps, as a path ('T[123]', 'comps[4].name'), or '' when they are the same.
export function mapDiff(a,b,path='map'){
  if(ArrayBuffer.isView(a)||ArrayBuffer.isView(b)){
    if(!ArrayBuffer.isView(a)||!ArrayBuffer.isView(b)||a.constructor!==b.constructor)return path+' (type)';
    if(a.length!==b.length)return path+'.length';
    for(let i=0;i<a.length;i++)if(!Object.is(a[i],b[i]))return `${path}[${i}]`;
    return '';
  }
  if(Array.isArray(a)||Array.isArray(b)){
    if(!Array.isArray(a)||!Array.isArray(b))return path+' (type)';
    if(a.length!==b.length)return path+'.length';
    for(let i=0;i<a.length;i++){const x=a[i],y=b[i];if(x===y&&typeof x!=='object')continue;const d=mapDiff(x,y,`${path}[${i}]`);if(d)return d;}
    return '';
  }
  if(a&&b&&typeof a==='object'&&typeof b==='object'){
    const ka=Object.keys(a),kb=Object.keys(b);
    if(ka.join('\n')!==kb.join('\n'))return path+' (keys)';
    for(const k of ka){const d=mapDiff(a[k],b[k],`${path}.${k}`);if(d)return d;}
    return '';
  }
  return Object.is(a,b)?'':path;
}
// An adaptive binary range coder (as in LZMA): 11-bit probabilities that move an eighth of the way each time.
function rangeEncoder(){
  let low=0,range=0xFFFFFFFF,cache=0,pending=1;const out=[],P=new Uint16Array(4096).fill(1024);
  const shift=()=>{
    if(low<0xFF000000||low>=0x100000000){const carry=low>=0x100000000?1:0;let t=cache;do{out.push((t+carry)&255);t=255;}while(--pending);cache=Math.floor(low/0x1000000)&255;}
    pending++;low=(low%0x1000000)*256;
  };
  return {
    bit(k,b){const p=P[k],bound=(range>>>11)*p;if(!b){range=bound;P[k]=p+((2048-p)>>3);}else{low+=bound;range-=bound;P[k]=p-(p>>3);}while(range<0x1000000){range=range*256>>>0;shift();}return b?1:0;},
    finish(){for(let i=0;i<5;i++)shift();return Buffer.from(out);},
  };
}
// One region's entry: its grid, coded levels, exceptions to the worked-out shallows, landmass names, NPC capitals.
function bakeRegion(source,kit,m){
  const id=kit.REG.id,L=Uint8Array.from(m.T,t=>t>=2?t-1:0),coder=rangeEncoder();
  kit.mapLevels(L,m.nbr,(k,b)=>coder.bit(k,b));
  const names=m.comps.map(c=>c.name);while(names.length&&!names[names.length-1])names.pop();
  const entry={c:kit.MAP_COLS,r:kit.MAP_ROWS,t:coder.finish().toString('base64'),x:[],h:kit.mapSum(m.T),n:names,p:{...m.npcLoc}};
  // the page works out the shallows from the land; any sea hex where the generator made something else is listed
  const T=kit.mapUnpack(entry,kit.genGeom(entry.c,entry.r));
  for(let i=0;i<T.length;i++)if(T[i]!==m.T[i]){
    if(T[i]>=2||m.T[i]>=2)throw new Error(`bake-maps: the land levels of ${id} do not decode at hex ${i}`);
    entry.x.push(i,m.T[i]);
  }
  return entry;
}
export function bakeMaps(source){
  const ids=mapKit(source,'meridian').ids,r={};
  for(const id of ids){
    const kit=mapKit(source,id);
    if(kit.REG.id!==id)throw new Error(`bake-maps: could not set up region ${id}`);
    const m=kit.generate(),entry=bakeRegion(source,kit,m);
    // the check: a fresh copy of the game, given only this entry, must build exactly the generated map
    const back=mapKit(source,id,{__edictum:{maps:{v:1,r:{[id]:entry}}}}).bakedMap();
    const diff=back?mapDiff(back,m):'no map';
    if(diff)throw new Error(`bake-maps: the baked map of ${id} differs from the generated one at ${diff}`);
    r[id]=entry;
  }
  return {v:1,r};
}
export function mapsScript(data){return 'window.__edictum&&(window.__edictum.maps='+JSON.stringify(data)+');\n';}
if(process.argv[1]===fileURLToPath(import.meta.url)){
  process.stdin.setEncoding('utf8');
  let source='';for await(const chunk of process.stdin)source+=chunk;
  process.stdout.write(mapsScript(bakeMaps(source)));
}
