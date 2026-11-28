// Fishing grounds and whales (2026-11-28): spots on the water, the same for every player, placed on the map as it was
// made: fishing grounds beside the land (sea or lake), whales two or three hexes out in the open sea, each kept apart;
// a Harbour within reach takes 5 food a day from each fishing ground and Tourism +2, once, from each whale spot; and the
// Harbour's purple block ships 3 more goods a day, gold (or a Grand Port) 4.
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mapKit} from '../scripts/bake-maps.mjs';

const source=readFileSync(new URL('../game/edictum.html',import.meta.url),'utf8');
const script=source.slice(source.indexOf('<script>')+8,source.lastIndexOf('</script>'));
const section=(a,b)=>{const s=source.indexOf(a),e=source.indexOf(b,s);assert.ok(s>0&&e>s,'section '+a);return source.slice(s,e);};
const FS=section('/* ── fishing grounds and whales (2026-11-28','\nconst fmtAmt=');
const LAKES=section('const LAKE_MAX=40','/* a hex of a lake');
const HASH=source.match(/^function hash\(str\)\{[^\n]+/m)[0];

/* the block on a map M (a region's, from the game's own generators), with the lakes as the game finds them */
function kit(M,reg){
  const ctx=vm.createContext({Math,Object,Number,String,Array,Set,Map,JSON,Uint8Array,Int8Array,Int32Array,
    MAP:M,MAP_T0:M.T.slice(),REG:{id:reg},cellKey:i=>reg+':'+i,applied:[],
    applyEffects(n,e){ctx.applied.push(e);for(const k in e)n.s[k]=(n.s[k]||0)+e[k];}});
  vm.runInContext([HASH,LAKES,FS,'this.X={fsPick,fsSpots,fsAt,fsNear,fsBall,fsHarbour,fsWhales,lakeMap,FS_FISH_R,FS_WHALE_R,FS_FISH_GAP,FS_WHALE_GAP,FS_FISH_FOOD,FS_WHALE_TOUR,FS_HB_GOODS};'].join('\n'),ctx);
  return ctx;
}
const maps=new Map();
function region(id){if(!maps.has(id)){const M=mapKit(script,id).generate();maps.set(id,{M,ctx:kit(M,id)});}return maps.get(id);}

test('the spots on three regions: on still water, the fishing grounds beside the land, the whales out in the open sea, all kept apart',()=>{
  for(const id of ['meridian','coralreach','ironsteppe']){
    const {M,ctx}=region(id),X=ctx.X,F=X.fsSpots(),lk=X.lakeMap(),nb=M.nbr;
    const land=c=>M.T[c]>=2,beside=c=>{for(let d=0;d<6;d++){const j=nb[c*6+d];if(j>=0&&land(j))return true;}return false;};
    assert.ok(F.fish.length>=100&&F.fish.length<=400,`${id}: ${F.fish.length} fishing grounds`);
    assert.ok(F.whale.length>=40&&F.whale.length<=150,`${id}: ${F.whale.length} whale spots`);
    for(const c of F.fish){assert.ok(!land(c),'a fishing ground on water');assert.ok(beside(c),'beside the land');assert.equal(X.fsAt(c),1);}
    for(const c of F.whale){
      assert.ok(!land(c)&&!lk[c],'whales in the open sea, not a lake');assert.ok(!beside(c),'not right by the shore');
      assert.ok(X.fsBall(nb,c,3).some(([j])=>land(j)),'within three hexes of the coast');assert.equal(X.fsAt(c),2);}
    const apart=(L,gap)=>{const S=new Set(L);for(const c of L)for(const [j,d] of X.fsBall(nb,c,gap-1))if(d>0)assert.ok(!S.has(j),`${id}: two spots ${d} apart`);};
    apart(F.fish,X.FS_FISH_GAP);apart(F.whale,X.FS_WHALE_GAP);
    assert.equal(X.fsAt(F.fish[0]+0)>0,true);
    /* land is never a spot */
    let k=0;for(let c=0;c<M.N&&k<500;c++)if(land(c)){k++;assert.equal(X.fsAt(c),0);}
  }
});

test('the same spots for every player: worked out again from scratch, the lists are the same',()=>{
  const {M}=region('meridian'),a=kit(M,'meridian').X.fsSpots(),b=kit(M,'meridian').X.fsSpots();
  assert.deepEqual([...a.fish],[...b.fish]);assert.deepEqual([...a.whale],[...b.whale]);
  /* and another region's hashing differs */
  const c=kit(M,'elsewhere').X.fsSpots();assert.notDeepEqual([...a.fish].slice(0,20),[...c.fish].slice(0,20));
});

test('a city reaches the fishing grounds within 3 hexes and whales within 4, nearest first; a reclaimed hex loses its spot',()=>{
  const {M,ctx}=region('meridian'),X=ctx.X,F=X.fsSpots();
  const f=F.fish[0],coast=X.fsBall(M.nbr,f,1).map(([j])=>j).find(j=>M.T[j]>=2);
  const near=X.fsNear(coast);
  assert.ok(near.f.some(([j,d])=>j===f&&d===1),'the fishing ground next to it');
  for(const [j,d] of near.f){assert.ok(d<=X.FS_FISH_R);assert.equal(F.at[j],1);}
  for(const [j,d] of near.w){assert.ok(d<=X.FS_WHALE_R);assert.equal(F.at[j],2);}
  assert.deepEqual(near.f.map(x=>x[1]),near.f.map(x=>x[1]).slice().sort((a,b)=>a-b),'nearest first');
  const was=M.T[f];M.T[f]=2;
  try{assert.ok(!X.fsNear(coast).f.some(([j])=>j===f),'reclaimed: no fish');assert.equal(X.fsAt(f),0);}finally{M.T[f]=was;}
  assert.ok(X.fsNear(coast).f.some(([j])=>j===f),'and back');
});

test('a Harbour\'s extras: 5 food a fishing ground, 3 goods at purple, 4 at gold and as a Grand Port',()=>{
  const {M,ctx}=region('meridian'),X=ctx.X,F=X.fsSpots();
  /* a coastal hex with no fishing ground in reach, and one with exactly one */
  let dry=-1,one=-1;
  for(let c=0;c<M.N&&(dry<0||one<0);c++){if(M.T[c]<2)continue;let co=false;for(let d=0;d<6;d++){const j=M.nbr[c*6+d];if(j>=0&&M.T[j]<2)co=true;}if(!co)continue;const n=X.fsNear(c).f.length;if(n===0&&dry<0)dry=c;if(n===1&&one<0)one=c;}
  assert.ok(dry>=0&&one>=0);
  const row=(c,ug,tr)=>{const x=X.fsHarbour({c,ug:ug==null?{}:{harbour:ug},tr:tr?{harbour:tr}:{}});return [x.food,x.goods,x.g];};
  assert.deepEqual(row(dry),[0,0,'']);
  for(const u of [1,2,3])assert.deepEqual(row(dry,u),[0,0,''],'grey, green and blue ship nothing more');
  assert.deepEqual(row(dry,4),[0,3,'purple']);
  assert.deepEqual(row(dry,5),[0,4,'gold'],'gold: 4, not 3 + 4');
  assert.deepEqual(row(dry,0,{t:2,ln:'fleet'}),[0,4,'gold'],'a Grand Port counts as gold');
  assert.deepEqual(row(dry,3,{t:2,ln:'salvage'}),[0,4,'gold']);
  assert.deepEqual(row(one),[5,0,'']);
  assert.deepEqual(row(one,5),[5,4,'gold']);
  assert.deepEqual(J(X.FS_HB_GOODS),[3,4]);assert.equal(X.FS_FISH_FOOD,5);assert.equal(X.FS_WHALE_TOUR,2);
});
const J=v=>JSON.parse(JSON.stringify(v));

test('whale watching: Tourism +2 once for each finished Harbour and whale spot in reach, never twice, not while building',()=>{
  const {M,ctx}=region('meridian'),X=ctx.X,F=X.fsSpots();
  /* a coastal city hex with whales in reach */
  let at=-1;for(const w of F.whale){for(const [j] of X.fsBall(M.nbr,w,X.FS_WHALE_R)){if(M.T[j]<2)continue;let co=false;for(let d=0;d<6;d++){const q=M.nbr[j*6+d];if(q>=0&&M.T[q]<2)co=true;}if(co&&X.fsNear(j).w.length){at=j;break;}}if(at>=0)break;}
  assert.ok(at>=0);
  const ws=X.fsNear(at).w.length,now=Date.now();
  const n={s:{tour:40},bonce:['old'],cities:[{id:'c1',c:at,b:[{k:'harbour',d:now+3600e3}]},{id:'c2',c:at+2,b:[{k:'farm',d:now-1}]}]};
  ctx.applied.length=0;
  assert.equal(X.fsWhales(n,now).length,0,'a Harbour still going up brings nothing');
  n.cities[0].b[0].d=now-1;
  const got=X.fsWhales(n,now);
  assert.equal(got.length,ws);assert.equal(n.s.tour,40+2*ws);
  assert.deepEqual(J(ctx.applied),Array(ws).fill({tour:2}));
  assert.ok(n.bonce.includes('old'));for(const [j] of X.fsNear(at).w)assert.ok(n.bonce.includes('c1:wh'+j));
  assert.equal(X.fsWhales(n,now).length,0,'once');assert.equal(n.s.tour,40+2*ws);
  assert.equal(X.fsWhales({npc:1,s:{},cities:n.cities},now).length,0,'computer nations are left alone');
});

test('the game uses them: cityState adds the extras, the building card explains them, commits pay for whales, the map draws them',()=>{
  const cs=section('function cityState(T){','\nfunction cityDefMult');
  assert.match(cs,/if\(key==='harbour'\)\{const x=fsHarbour\(ct\);a\.add\.food\+=x\.food;a\.add\.goods\+=x\.goods;\}/);
  assert.ok(cs.indexOf("fsHarbour(ct)")<cs.indexOf('ct.buildOutput='),'before the city\'s output is taken');
  const sb=section('function syncBuildings(n,now){','\nfunction slotsOf');
  assert.match(sb,/const wh=fsWhales\(n,now\);/);
  const gain=section('function bldGain(ct,k,T){','\n/* the same in words');
  assert.match(gain,/if\(k==='harbour'\)\{/);assert.match(gain,/return \{lm,mk,res,up,x:xs,sx\};/);
  assert.match(section('function bldGainHtml(','\nfunction bldRow('),/if\(g\.sx&&g\.sx\.length\)why\.push\(\.\.\.g\.sx\.map\(esc\)\);/);
  assert.match(source,/fsGlyphs\(g,s,x0,x1,y0,y1\);\}/);
  assert.match(section("  harbour:{n:'Harbour'",'\n'),/food \+5 more for each fishing ground within 3 hexes, and Tourism \+2 once for whales within 4\. Its purple upgrade ships 3 more goods a day, gold 4\./);
  assert.match(section('function inspectFacts(','\nfunction inspStatus'),/row\(k===1\?'Fishing ground':'Whales'/);
  assert.match(section('function siteValue(cell,T){','\n/* every hex of yours'),/F\.f\.length\*FS_FISH_FOOD\*0\.4/);
  /* the baked tables' cut (scripts/bake-maps.mjs) stays clear of the block */
  assert.ok(!section('/* large iron deposits','\nconst resName=').includes('fsPick'));
});
