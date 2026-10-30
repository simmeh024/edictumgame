// The browser tab: the count of what waits, what arrived while it was in the background, and the dotted icon.
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import assert from 'node:assert/strict';

const source=readFileSync(new URL('../game/edictum.html',import.meta.url),'utf8');
const ICON='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="30"/></svg>\n';
function tab({page='Edicts'}={}){
  const start=source.indexOf('/* ───────── the browser tab'),end=source.indexOf('/* ───────── boot',start);
  assert.ok(start>0&&end>start);
  const link={href:'/favicon.svg',getAttribute(){return this.href;},setAttribute(k,v){this.href=v;}},listeners=[];
  const document={hidden:false,title:'',querySelector:s=>s==='.nav'?{}:s==='link[rel="icon"]'?link:null,addEventListener:(t,f)=>listeners.push(f)};
  const w={dm:0,exp:false,lc:0},nation={name:'Tabland',inbox:[]};
  const ctx=vm.createContext({document,S:{nation},syncInbox:n=>n,dmUnread:()=>w.dm,expBack:()=>w.exp,landCredits:()=>w.lc,Date,Promise,
    fetch:async()=>({ok:true,text:async()=>ICON}),navAfter:()=>{document.title=page+' · Edictum';},encodeURIComponent});
  vm.runInContext(source.slice(start,end)+'\nthis.render=()=>navAfter();',ctx);
  const edicts=(unread,read=0)=>{nation.inbox=[...Array(unread).fill(0).map((x,i)=>({id:'u'+i})),...Array(read).fill(0).map((x,i)=>({id:'r'+i,read:1}))];};
  return {document,link,w,edicts,render:ctx.render,show:hidden=>{document.hidden=hidden;listeners.forEach(f=>f());},settle:()=>new Promise(r=>setTimeout(r,0))};
}

test('the title counts unread edicts and letters, land to claim and an expedition back',()=>{
  const T=tab();T.edicts(2,3);T.w.dm=1;T.w.lc=5;T.w.exp=true;T.render();
  assert.equal(T.document.title,'(5) Edicts · Edictum');
  T.w.lc=0;T.w.exp=false;T.render();assert.equal(T.document.title,'(3) Edicts · Edictum');
});

test('nothing waiting leaves the page title and the plain icon',async()=>{
  const T=tab();T.edicts(1);T.render();await T.settle();assert.match(T.link.href,/^data:image\/svg\+xml,/);
  T.edicts(0,2);T.render();assert.equal(T.document.title,'Edicts · Edictum');assert.equal(T.link.href,'/favicon.svg');
});

test('the icon is the site icon with a red dot',async()=>{
  const T=tab();T.w.dm=2;T.render();await T.settle();
  const svg=decodeURIComponent(T.link.href.replace('data:image/svg+xml,',''));
  assert.ok(svg.startsWith('<svg')&&svg.includes('<circle cx="32" cy="32" r="30"/>')&&/<circle cx="50" cy="14"[^>]*fill="#D1342F"[^>]*\/><\/svg>$/.test(svg));
});

test('in the background the title says what arrived, and looking at the tab puts the page back',()=>{
  const T=tab();T.edicts(1);T.render();T.show(true);
  T.edicts(2);T.render();assert.equal(T.document.title,'(2) New edict · Edictum');
  T.edicts(4);T.render();assert.equal(T.document.title,'(4) New edicts · Edictum');
  T.show(false);assert.equal(T.document.title,'(4) Edicts · Edictum');
  T.show(true);T.w.dm=1;T.render();assert.equal(T.document.title,'(5) New letter · Edictum');
  T.show(false);T.show(true);T.w.exp=true;T.render();assert.equal(T.document.title,'(6) Expedition back · Edictum');
  T.show(false);T.show(true);T.w.lc=2;T.render();assert.equal(T.document.title,'(7) Land to claim · Edictum');
});

test('reading or spending in the background never claims something new arrived',()=>{
  const T=tab();T.edicts(3);T.w.lc=1;T.render();T.show(true);
  T.edicts(1,2);T.w.lc=0;T.render();assert.equal(T.document.title,'(1) Edicts · Edictum');
});
