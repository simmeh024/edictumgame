// Deep-sea finds (2026-11-26): the kinds out at sea, kept apart from the land's; the Harbour's multiplier, reach,
// roll and depth by its upgrade blocks and tier; the place's share; the Grand Port's three lines; the record's fields
// as the game keeps them; and the admin portal's count of hauls (functions/stats-more.js).
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {rowMore, moreSummary, DS_LEVELS} from '../functions/stats-more.js';

const source=readFileSync(new URL('../game/edictum.html',import.meta.url),'utf8');
const section=(a,b)=>{const s=source.indexOf(a),e=source.indexOf(b,s);assert.ok(s>0&&e>s,'section '+a);return source.slice(s,e);};
const line=a=>{const s=source.indexOf(a);assert.ok(s>0,a);return source.slice(s,source.indexOf('\n',s));};

/* the kinds, as the fleeting finds keep them (their placement tests are never called here) */
const KINDS=section('const FL_KINDS={','\n/* the bonuses: what they are called');
const FX=section('const FL_FX={','\nconst FL_STAT=');
const DSC=section('const DS_PER=','\nconst DS_LATE=');
const MULT=line('const dsMult=');
const INFO=section('function dsHbInfo(ct,navy){','/* “blue Harbour”');
const UG=section('const CX_UG=[','\nconst CX_WALL=');
const TIER=section('const BTIER={','\nconst TIER_ROMAN=');
const LINE=section('function bTier(k,t){','/* the tier a building can be retooled to next');
const ctx=vm.createContext({Math,Object,Number,String,Array,Set,Map,JSON,FL_H:3600e3,clamp:(v,a,b)=>Math.min(b,Math.max(a,v)),flCo:()=>1,flFarm:()=>1,flFor:()=>1,flMar:()=>1,flAri:()=>1,flHigh:()=>1,flFlat:()=>1,flCold:()=>1,flRiver:()=>null,MAP:{coast:[],T:[]},BIOME:[]});
vm.runInContext([KINDS,FX,DSC,MULT,UG,TIER,LINE,INFO,
  'this.X={FL_KINDS,FL_KEYS,FL_FX,FL_CAP,DS_KEYS,DS_PLAIN,DS_SEA_KINDS,DS_PLACE,DS_HL_N,DS_BAND_S,DS_REACH,DS_BLOCK_R,DS_NAVY_R,DS_HM_MAX,dsMult,dsHbInfo,CX_LV,CX_UG_MAX,BTIER};'].join('\n'),ctx);
const X=ctx.X,J=v=>JSON.parse(JSON.stringify(v));

test('the deep sea\'s kinds: each marked ds, at a depth, with bonuses the game knows, a headline and a report',()=>{
  const D=X.DS_KEYS;
  assert.ok(D.length>=13,'eight plain kinds, four of the seasons and the storm\'s');
  for(const k of D){const K=X.FL_KINDS[k];
    assert.ok([0,1,2].includes(K.bd),k+' lies at a depth');
    assert.ok(K.fx.length>=1&&K.fx.every(([st,v,mode,h])=>X.FL_FX[st]&&v>0&&(mode==='h'||mode==='l')&&h>0),k+' has bonuses');
    assert.match(K.h,/\{P\}/,k+' has a headline with its place');
    assert.ok(K.n&&K.a&&K.d&&K.ok&&K.nw>0,k+' has its words');}
  assert.deepEqual(J(X.DS_PLAIN.map(k=>X.FL_KINDS[k].bd).sort()),[0,0,1,1,2,2,2,2],'two on the shelf, two in deep water, four in the abyss');
  assert.deepEqual(J(X.DS_SEA_KINDS.map(a=>a.length)),[1,1,1,1],'one kind for each season');
  assert.equal(X.FL_KINDS.foundered.w,0,'the storm\'s freighter comes only with a storm');
  assert.ok(X.FL_KINDS.foundered.wx.includes('storm'));
});

test('the land\'s kinds are dealt as before: no deep kind among them',()=>{
  const land=section('const FL_KEYS=Object.keys(FL_KINDS)','\n/* the bonuses');
  assert.match(land,/FL_LAND=FL_KEYS\.filter\(k=>!FL_KINDS\[k\]\.ds\)/);
  assert.match(land,/FL_SEA_KINDS=\[0,1,2,3\]\.map\(s=>FL_LAND\.filter/);
  assert.match(land,/FL_PLAIN=FL_LAND\.filter/);
  /* lanes from FL_LANES on are the sea's */
  assert.match(section('function flFrame(k,f){','\n  const key'),/if\(k>=FL_LANES\)return dsFrame\(k,f\);/);
  assert.match(section('function flSite(seg){','\n  const key'),/if\(seg\.k>=FL_LANES\)return dsSite\(seg\);/);
  assert.match(line('  FL_CD=30*60000'),/FL_KEY_RE=\/\^\[a-z0-9-\]\{2,24\}:\\d\{1,2\}:/,'a key may name a lane past 7');
});

test('a Harbour\'s haul, reach, roll and depth by its blocks; a Grand Port; a Salvage Port',()=>{
  const ct=(ug,tr)=>({c:7,nm:'Portwick',ug:ug?{harbour:ug}:{},tr:tr?{harbour:tr}:{}});
  const row=H=>[H.hm,H.reach,H.roll,H.band,H.hl,H.sv];
  assert.deepEqual(row(X.dsHbInfo(ct(0),false)),[100,55,0,0,0,false]);
  assert.deepEqual(row(X.dsHbInfo(ct(1),false)),[110,59,0,0,1,false]);
  assert.deepEqual(row(X.dsHbInfo(ct(2),false)),[125,63,0,0,2,false]);
  assert.deepEqual(row(X.dsHbInfo(ct(3),false)),[145,67,1,1,3,false]);
  assert.deepEqual(row(X.dsHbInfo(ct(4),false)),[170,71,1,1,4,false]);
  assert.deepEqual(row(X.dsHbInfo(ct(5),false)),[200,75,2,2,5,false]);
  assert.deepEqual(row(X.dsHbInfo(ct(0),true)),[100,70,0,0,0,false],'a navy sails 15 further');
  assert.deepEqual(row(X.dsHbInfo(ct(0,{t:2,ln:'merchant'}),false)),[200,75,2,2,6,false]);
  assert.deepEqual(row(X.dsHbInfo(ct(3,{t:2,ln:'salvage'}),false)),[280,84,2,2,7,true]);
  assert.deepEqual(row(X.dsHbInfo(ct(5,{t:2,ln:'salvage'}),false)),[300,90,2,2,7,true]);
  assert.ok(X.dsHbInfo(ct(5,{t:2,ln:'salvage'}),false).hm<=X.DS_HM_MAX,'the most a voyage may carry');
});

test('the share by place: 30, 25, 20, 15 and 10% of the five, times the harbour',()=>{
  assert.deepEqual(J(X.DS_PLACE.slice(1).map(v=>v/5)),[0.3,0.25,0.2,0.15,0.1]);
  assert.equal(X.dsMult(200,1),3);assert.equal(X.dsMult(145,3),1.45);assert.equal(X.dsMult(100,5),0.5);
  assert.equal(X.dsMult(undefined,3),1,'an old voyage without a multiplier hauls ×1');
  assert.equal(X.dsMult(9999,3),3,'and none hauls more than ×3');
});

test('the Grand Port: three lines, each starting at a gold Harbour\'s food and goods',()=>{
  const T=X.BTIER.harbour[2];assert.equal(T.n,'Grand Port');
  assert.deepEqual(J(Object.keys(T.lines)),['fleet','merchant','salvage']);
  const sum=L=>Object.values(L.res).reduce((a,[m,f])=>a+f,0);
  assert.equal(sum(T.lines.fleet),12);assert.equal(sum(T.lines.merchant),12);assert.ok(sum(T.lines.salvage)<12,'the Salvage Port gives up some of the catch');
  for(const L of Object.values(T.lines))assert.ok(L.n&&L.s&&L.d);
});

test('the record: a voyage keeps its harbour, multiplier, level and curio; the levels match the statistics',()=>{
  const norm=section('function flNorm(a){','\nNORM_HOOKS.push');
  assert.match(norm,/o\.hb=e\.hb;o\.hm=/);assert.match(norm,/\^td-\[a-z\]\{2,16\}\$/);
  assert.equal(X.DS_HL_N.length,DS_LEVELS,'eight Harbour levels, here and in the admin portal');
  assert.match(source,/DS_CURIOS=\['td-doubloon'/);
});

test('the admin portal counts hauls by the Harbour and the depth, and who sailed this week',()=>{
  const DAY=864e5,now=Date.parse('2026-11-26T12:00:00Z');
  const r1={tly:{ds:5,'ds:h0':2,'ds:h5':2,'ds:h7':1,'ds:b0':3,'ds:b2':2,'ds:leg':1,'ds:abyss:leg':1},fl:[{k:'a',hb:12},{k:'b'}]},r2={tly:{flk:3}};
  const m1=rowMore(r1,now),m2=rowMore(r2,now);
  assert.deepEqual(m1.ds,{n:5,h:[2,0,0,0,0,2,0,1],b:[3,0,2],leg:1,al:1});assert.equal(m1.dsv,1);
  assert.equal(m2.ds,null);assert.equal(m2.dsv,0);
  const row=(id,x)=>({id,reg:'meridian',t:now-DAY,founded:now-9*DAY,f:[],f2:[],pol:[],ach:[],dd:null,...x});
  const g={at:now,rows:[row('a',m1),row('b',m2),row('c',{...m1,t:now-40*DAY})]};
  const m={health:[],bugs:[],tickets:[],posts:[],alliances:[]};
  const S=moreSummary(g,m,'',now).content.ds;
  assert.equal(S.nations,2);assert.equal(S.hauls,10);assert.deepEqual(S.h,[4,0,0,0,0,4,0,2]);assert.deepEqual(S.b,[6,0,4]);
  assert.equal(S.leg,2);assert.equal(S.al,2);assert.equal(S.sailing,1,'only the nation active this month');
});
