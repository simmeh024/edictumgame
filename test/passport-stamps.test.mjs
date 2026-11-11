// Eight more entry stamp shapes: five from easy (bronze) passport achievements, three from hard (gold) ones.
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import assert from 'node:assert/strict';

const source=readFileSync(new URL('../game/edictum.html',import.meta.url),'utf8');
const EASY=['ps-arch','ps-tag','ps-banner','ps-scroll','ps-scallop'],HARD=['ps-post','ps-laurel','ps-wings'];
const line=name=>{const i=source.indexOf('function '+name+'(');assert.ok(i>0,name);return source.slice(i,source.indexOf('\n',i));};

/* the stamp drawing, run on its own with plain stand-ins for the helpers it borrows */
function drawing(){
  const a=source.indexOf('function ppStampDate'),b=source.indexOf('/* one stamp on its own',a);assert.ok(a>0&&b>a);
  const ctx=vm.createContext({PP_INK:{'pi-violet':'#5b2a86','pi-black':'#262626'},DAY:864e5,rng:()=>{let x=7;return ()=>((x=(x*48271)%2147483647)%1000)/1000;},
    hash:s=>[...String(s)].reduce((h,c)=>(h*31+c.charCodeAt(0))>>>0,7),esc:s=>String(s),ppTitle:s=>s,
    ppFont:()=>({f:'monospace',ls:1,sz:1,uc:1}),ppDevice:(id,c)=>`<circle data-device="${id}" fill="${c}"/>`});
  vm.runInContext('const PP_Q=v=>(+v).toFixed(1);'+line('czEll')+'\n'+line('czCirc')+'\n'+line('czStarPts')+'\n'+source.slice(a,b)+
    ';this.T={body:ppStampBody,perf:ppPerf,scallop:ppScallop};',ctx);
  return ctx.T;
}

test('the eight shapes are registered as achievement unlocks, after the old ones',()=>{
  const reg=[...source.matchAll(/'(ps-[a-z]+)':\{k:'ppshape',n:'([^']+)',src:'(\w+)'/g)].map(m=>({id:m[1],n:m[2],src:m[3]}));
  for(const id of EASY.concat(HARD)){const r=reg.filter(x=>x.id===id);assert.equal(r.length,1,id);assert.equal(r[0].src,'ach',id);}
  const names=reg.map(r=>r.n);assert.equal(new Set(names).size,names.length,'every shape has its own name');
  assert.ok(reg.findIndex(r=>r.id==='ps-shield')<reg.findIndex(r=>r.id==='ps-arch'),'new shapes follow the old ones in the designer');
});

test('each shape comes from exactly one passport achievement: bronze for the easy five, gold for the hard three',()=>{
  const ach=[...source.matchAll(/P\('(pass-[a-z0-9]+)','([bsgp])','([^']+)','([^']+)',[^\n]*?,'(ps-[a-z]+)'(?:,\{[^}]*\})?\);/g)].map(m=>({id:m[1],t:m[2],n:m[3],u:m[5]}));
  for(const [ids,tier] of [[EASY,'b'],[HARD,'g']])for(const u of ids){const a=ach.filter(x=>x.u===u);assert.equal(a.length,1,u);assert.equal(a[0].t,tier,u+' '+a[0].id);}
  const titles=[...source.matchAll(/(?:achDef\('[a-z]+',|P\()'[a-z0-9-]+','[bsgpxo]','([^']+)'/g)].map(m=>m[1]);
  for(const a of ach.filter(x=>EASY.includes(x.u)||HARD.includes(x.u)))assert.equal(titles.filter(t=>t===a.n).length,1,'no other achievement is called '+a.n);
});

test('every shape draws cleanly with every border, round ones setting their text on a circle',()=>{
  const T=drawing();
  for(const sh of EASY.concat(HARD))for(const bd of ['pb-single','pb-double','pb-dashed','pb-thick','pb-dots','pb-twin']){
    const h=T.body({sh,bd,ink:'pi-violet',ic:'pk-globe',nm:'The Most Serene Republic of Vel',t2:'ADMITTED'},Date.UTC(2026,10,11),'t',false);
    assert.doesNotMatch(h,/NaN|undefined|Infinity/,sh+' '+bd);assert.match(h,/11 NOV 2026/);assert.match(h,/data-device="pk-globe"/);
    assert.equal(/<textPath/.test(h),['ps-scallop','ps-laurel','ps-wings'].includes(sh),sh+' text layout');
    if(bd==='pb-double')assert.ok((h.match(/<path d="/g)||[]).length>=2,sh+' draws an inner line');
  }
  const T2=T.body({sh:'ps-laurel',bd:'pb-single',ink:'pi-violet',nm:'Vel'},1,'u',false);assert.ok((T2.match(/<ellipse /g)||[]).length>=30,'a wreath of leaves');
  const T3=T.body({sh:'ps-wings',bd:'pb-single',ink:'pi-violet',nm:'Vel'},1,'v',false);assert.equal((T3.match(/stroke-linejoin="round"/g)||[]).length,10,'five feathers a side');
  const old=T.body({sh:'ps-circle',bd:'pb-single',ink:'pi-violet',nm:'Vel'},1,'w',false);assert.match(old,/A22,22 0 0,1/,'the old round stamps keep their text radius');
});

test('the perforated and scalloped edges close, with one bite or bump each step',()=>{
  const {perf,scallop}=drawing();
  const p=perf(5,5,117,61,7,2.2);assert.match(p,/^M5,5H/);assert.match(p,/Z$/);assert.equal((p.match(/A2\.2,2\.2 0 0,0/g)||[]).length,2*16+2*8);
  const s=scallop(61,33,29,24);assert.equal((s.match(/A/g)||[]).length,24);assert.match(s,/^M90\.0,33\.0/);assert.match(s,/90\.0,33\.0Z$/);
});

test('the counters behind the new achievements: stamping days and endorsed stamps',()=>{
  const ctx=vm.createContext({DAY:864e5,PP_SLOTS:10,NPC_NATIONS:[{id:'npc-a'}]});
  const a=source.indexOf('const PP_STATS=new WeakMap();'),e=source.indexOf('function ppEndo(');assert.ok(a>0&&e>a);
  vm.runInContext(source.slice(a,source.indexOf('/* how many nations of this region carry',a))+'\n'+source.slice(e,source.indexOf('return o;}',e)+10)+';this.T={ppStats,ppEndo};',ctx);
  const D=864e5,st=(t,b)=>{const e=['N','meridian',t,'ps-circle','pb-single','pi-violet','','','',''];if(b!=null)e[10]=b;return e;};
  const n={pp:{v:{a:st(D*100+5,1),b:st(D*100+9,7),c:st(D*101,4),d:st(D*140,8),e:st(0,7),f:st(D*150,2|4)}}};
  assert.equal(ctx.T.ppStats(n).dd,4,'days 100, 101, 140 and 150; a stamp with no date counts no day');
  assert.deepEqual({...ctx.T.ppEndo(n)},{any:5,trade:3,all:2},'war alone is no endorsement; all three needs trade, alliance and letters');
  assert.deepEqual({...ctx.T.ppEndo(null)},{any:0,trade:0,all:0});assert.equal(ctx.T.ppStats(null).dd,0);
});
