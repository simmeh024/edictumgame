// Keeping small: Settings › Land can pause land credit gains (n.lcp). Credits are still earned and stored meanwhile, none
// can be spent, and every stored credit is available again once gains are back on.
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import assert from 'node:assert/strict';

const source=readFileSync(new URL('../game/edictum.html',import.meta.url),'utf8');
const MARK='/* ───────── keeping small: land credit gains paused';
const STORED=9;

function sandbox(nation){
  // the section ends at the hot-reload tail, or at the next banner if a later feature is added after it
  const start=source.indexOf(MARK),tail=source.indexOf('\nconst hot=window.claude',start),next=source.indexOf('\n/* ───────── ',start+MARK.length);
  const end=next>start&&next<tail?next:tail;
  assert.ok(start>0&&end>start,'the section sits near the end of the script, before the hot-reload tail');
  const listeners=[],applied=[],toasts=[];
  const ctx=vm.createContext({
    S:{nation,view:'settings'},OBS:false,NORM_HOOKS:[],
    SG_TABS:[['nation','Your nation'],['edicts','Edicts'],['notif','Notifications'],['letters','Letters'],['display','Display']],
    landCredits:()=>STORED,
    landBox:n=>'<div class="lc-box">the usual box</div>',
    landExtras:()=>'<p>extras</p>',
    sgTabOfId:()=>'nation',sgTabSub:k=>'other: '+k,
    settingsView:()=>'<div class="sg-pane" id="sg-p-edicts"></div><div class="sg-pane" id="sg-p-notif"></div>',
    sgHead:(k,scope,lead)=>`<h2>${k}</h2><p>${scope}</p><p>${lead}</p>`,
    esc:s=>String(s).replace(/</g,'&lt;'),fmtDate:()=>'7 Nov 2026',
    sgApply(fn){const n=structuredClone(ctx.S.nation);fn(n);ctx.S.nation=n;applied.push(n);},
    toast:t=>toasts.push(t),
    document:{addEventListener:(k,f)=>listeners.push([k,f])},
  });
  vm.runInContext(source.slice(start,end)+'\nthis.X={lcPaused,lcStored,lcPauseMsg,landCredits,landBox,sgTabOfId,sgTabSub,settingsView,lhPane,lhPauseNote};',ctx);
  const change=(act,checked)=>{for(const [k,f] of listeners)if(k==='change')f({target:{dataset:{act},checked}});};
  return {ctx,X:ctx.X,change,applied,toasts};
}
const nation=over=>({name:'Smallholm',seed:'1',...over});

test('gains on: credits are spent as before, and nothing is paused',()=>{
  const {X}=sandbox(nation());
  assert.equal(X.lcPaused(nation()),false);
  assert.equal(X.landCredits(nation()),STORED);
  assert.equal(X.lcStored(nation()),STORED);
});

test('gains paused: no credit can be spent, and the earned ones are stored',()=>{
  const {X}=sandbox(nation({lcp:1}));
  const n=nation({lcp:Date.now()});
  assert.equal(X.lcPaused(n),true);
  assert.equal(X.landCredits(n),0,'nothing to spend while paused');
  assert.equal(X.lcStored(n),STORED,'but everything earned is kept');
  const back={...n};delete back.lcp;
  assert.equal(X.landCredits(back),STORED,'and all of it is available again once gains are back on');
});

test('only a real pause counts, and never for a computer nation',()=>{
  const {X}=sandbox(nation());
  for(const lcp of [0,-5,'1',null,undefined,NaN,true])assert.equal(X.lcPaused(nation({lcp})),false,String(lcp));
  assert.equal(X.lcPaused(nation({lcp:5,npc:true})),false);
  assert.equal(X.lcPaused(null),false);
});

test('the pause survives a reload, and junk does not',()=>{
  const {ctx}=sandbox(nation());
  const load=d=>{const out={};for(const h of ctx.NORM_HOOKS)h(out,d);return out;};
  assert.equal(load({lcp:1762500000000}).lcp,1762500000000);
  for(const lcp of [0,-1,'x',Infinity,{}])assert.equal('lcp' in load({lcp}),false,String(lcp));
});

test('notes that credits were earned say they are stored, only while paused',()=>{
  const {X}=sandbox(nation());
  const on=nation(),off=nation({lcp:1});
  const city='Founding Bellmouth earned 2 land credits. Spend them on the map.';
  assert.equal(X.lcPauseMsg(on,city),city);
  assert.equal(X.lcPauseMsg(off,city),'Founding Bellmouth earned 2 land credits. They are stored while land credit gains are paused.');
  assert.equal(X.lcPauseMsg(off,'Every nation is now founded with 7 land credits, and Smallholm has its 7: spend them on the map.'),
    'Every nation is now founded with 7 land credits, and Smallholm has its 7. They are stored while land credit gains are paused.');
  assert.equal(X.lcPauseMsg(off,'Milestone reached.'),'Milestone reached.');
  const obj=X.lcPauseMsg(off,{m:'Welcome back: 2 land credits. Spend them on the map.',links:[1]});
  assert.equal(obj.m,'Welcome back: 2 land credits. They are stored while land credit gains are paused.');assert.deepEqual([...obj.links],[1]);
});

test('every note in the game that says to spend credits on the map is caught by the rewrite',()=>{
  const {X}=sandbox(nation());
  const notes=[...source.matchAll(/[^`'"]{0,40}[Ss]pend (?:them|it) on the map\.[^`'"]{0,5}/g)].map(m=>m[0]);
  assert.ok(notes.length>=4);
  for(const t of notes)assert.doesNotMatch(X.lcPauseMsg(nation({lcp:1}),t),/[Ss]pend (?:them|it) on the map/,t);
});

test('the map land office shows the stored credits and the way to Settings while paused',()=>{
  const {X}=sandbox(nation());
  assert.match(X.landBox(nation()),/the usual box/);
  const h=X.landBox(nation({lcp:1}));
  assert.match(h,/lc-paused/);assert.match(h,/Stored land credits<\/span><span class="lc-v">9</);
  assert.match(h,/data-sg-tab="land"/);assert.match(h,/extras/,'release and help stay');
  assert.match(X.lhPauseNote(),/paused.*data-sg-tab="land"/s);
});

test('Settings has a Land tab after Edicts, found by its ids, with its own line',()=>{
  const {ctx,X}=sandbox(nation());
  assert.deepEqual(ctx.SG_TABS.map(t=>t[0]),['nation','edicts','land','notif','letters','display']);
  assert.equal(X.sgTabOfId('set-land'),'land');assert.equal(X.sgTabOfId('#lh-pause'),'land');assert.equal(X.sgTabOfId('s-motto'),'nation');
  assert.equal(X.sgTabSub('edicts',nation()),'other: edicts');
  assert.equal(X.sgTabSub('land',nation()),'Gains on');
  assert.equal(X.sgTabSub('land',nation({autoLand:true})),'Gains on · spent automatically');
  assert.equal(X.sgTabSub('land',nation({lcp:1})),'Gains paused · 9 stored');
});

test('the Land pane sits before Notifications and shows the switch as it stands',()=>{
  const {ctx,X}=sandbox(nation());
  const h=X.settingsView();
  assert.ok(h.indexOf('id="sg-p-land"')>h.indexOf('id="sg-p-edicts"')&&h.indexOf('id="sg-p-land"')<h.indexOf('id="sg-p-notif"'));
  assert.match(h,/<input type="checkbox" id="lh-pause" data-act="lh-pause">/);
  assert.match(h,/Gains are on\. You have <b>9<\/b> land credits to spend/);
  ctx.S.nation=nation({lcp:1,autoLand:true});
  const p=X.lhPane(ctx.S.nation);
  assert.match(p,/id="lh-pause" data-act="lh-pause" checked/);assert.match(p,/<b>9<\/b> land credits stored/);
  assert.match(p,/spends the stored credits at once/,'warns that automatic spending takes them all on resuming');
  assert.match(p,/id="lh-auto" data-act="lh-auto" checked/);
});

test('the switch pauses and resumes at once, with a note each way',()=>{
  const {ctx,change,applied,toasts}=sandbox(nation());
  change('lh-pause',true);
  assert.equal(applied.length,1);assert.ok(ctx.S.nation.lcp>0);assert.match(toasts[0],/paused: Smallholm keeps its borders/);
  change('lh-pause',true);assert.equal(applied.length,1,'pausing twice saves nothing');
  change('lh-pause',false);
  assert.equal(applied.length,2);assert.equal('lcp' in ctx.S.nation,false);assert.match(toasts[1],/back on\. 9 stored land credits are yours to spend/);
  change('lh-auto',true);assert.equal(ctx.S.nation.autoLand,true);
  change('lh-auto',false);assert.equal(ctx.S.nation.autoLand,false);
  ctx.OBS=true;change('lh-pause',true);assert.equal(applied.length,4,'an observing admin changes nothing');
});

test('the Land pane is shown when its tab is picked (one CSS rule names every pane)',()=>{
  assert.match(source,/\.sg\[data-tab="land"\] #sg-p-land[,{]/);
});
