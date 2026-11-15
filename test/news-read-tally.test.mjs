// Reading the development news counts for the reader's own tally (n.nwr: the Bonus task "Read the development
// news" and the news achievements) for admins too, whose reads are still not counted on the post; and a first read
// the server refuses (the account read it before, for an earlier nation or on another device) counts for a nation
// that has read nothing yet, at once. Runs the game's own reads section.
//   node --test test/news-read-tally.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const src = fs.readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
const cut = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); assert.ok(i >= 0 && j > i, a); return src.slice(i, j); };
const P1 = 'A'.repeat(20), P2 = 'B'.repeat(20);

function game({ admin = false, nwr = 0, refuse = false } = {}) {
  const ctx = vm.createContext({});
  vm.runInContext(`
    const DAY=864e5,NW_ID=/^[A-Za-z0-9]{20}$/,OBS=false,NW={stat:{}},window={innerHeight:800};let T=1e12;Date.now=()=>T;
    const store={};const localStorage={getItem:k=>k in store?store[k]:null,setItem:(k,v)=>{store[k]=String(v);}};
    function setInterval(){}const clone=o=>JSON.parse(JSON.stringify(o));let saves=0;function commit(n){S.nation=n;saves++;}
    let POSTS=[];const document={hidden:false,querySelectorAll:()=>POSTS};
    const sent=[];const S={view:'devnews',uid:'u1',isOwner:${admin},mode:'world',nation:{name:'Readland',nwr:${nwr}},
      db:{newsRead:id=>{sent.push(id);return ${refuse}?Promise.reject({code:'not_granted'}):Promise.resolve();}}};
    function nwPostOf(id){return {id,t:T-3600e3};}
    const post=(id,fold)=>({id:'nw-'+id,classList:{contains:c=>c==='nw-fold'&&!!fold},getBoundingClientRect:()=>({top:100,bottom:700,height:600})});
    ${cut('const NW_READ_MS=3000', '/* a vote: one more')}
    this.G={S,sent,NW,show:(...l)=>{POSTS=l.map(x=>typeof x==='string'?post(x):post(x[0],x[1]));},tick:ms=>{T+=ms;nwReadScan();},saves:()=>saves};`, ctx);
  return ctx.G;
}
const settle = () => new Promise(r => setTimeout(r, 0));

test('an admin’s reading counts for their own tally, and nothing is sent to the post', async () => {
  const G = game({ admin: true });
  G.show(P1); G.tick(0); G.tick(3000); await settle();
  assert.equal(G.S.nation.nwr, 1, 'the Bonus task and the achievements see it');
  assert.equal(G.S.nation.nwd, 1, 'read within a day of coming out');
  assert.equal(G.sent.length, 0, 'an admin’s reads are still not counted on the post');
  G.tick(3000); G.tick(3000); await settle();
  assert.equal(G.S.nation.nwr, 1, 'once per post');
  G.show(P1, P2); G.tick(0); G.tick(3000); await settle();
  assert.equal(G.S.nation.nwr, 2);
});

test('a player’s first read counts on the post and in their tally', async () => {
  const G = game();
  G.show(P1); G.tick(0); G.tick(2999); await settle();
  assert.equal(G.S.nation.nwr, 0, 'not before three seconds on screen');
  G.tick(1); await settle(); await settle();
  assert.equal(G.S.nation.nwr, 1);
  assert.deepEqual([...G.sent], [P1]);
});

test('a read the server refuses (the account read it before) still counts for a nation that has read nothing', async () => {
  let G = game({ refuse: true });
  G.show(P1); G.tick(0); G.tick(3000); await settle(); await settle();
  assert.equal(G.S.nation.nwr, 1, 'counted at once, not only at the next load');
  G = game({ refuse: true, nwr: 3 });
  G.show(P1); G.tick(0); G.tick(3000); await settle(); await settle();
  assert.equal(G.S.nation.nwr, 3, 'a nation that has read before may have counted it already: no second count');
});

test('a folded post is not read until it is opened', async () => {
  const G = game({ admin: true });
  G.show([P1, true]); G.tick(0); G.tick(5000); await settle();
  assert.ok(!G.S.nation.nwr);
});
