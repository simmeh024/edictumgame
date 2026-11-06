// Reading the development news (game/edictum.html, nwLoad; bug run items 57 and 58).
// 57: a post published or changed while "Older posts" was still being read cleared the list, and the read that should
//     have followed was dropped (a read was already running). The older page then appended to a list that was gone, and
//     the page said "The news could not be loaded". The older page is now dropped and the list read again after it.
// 58: when the first page arrived, the first post's comments were opened (a live listener) even if the player had left
//     the page meanwhile, and nothing closed it. It now opens on the page only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
function fn(name, kw = 'function ') {
  const at = html.indexOf('\n' + kw + name + '(');
  if (at < 0) throw new Error('no function ' + name);
  let i = html.indexOf('{', at), depth = 0;
  for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}' && --depth === 0) break; }
  return html.slice(at + 1, i + 1);
}

/* the news page with a database whose reads wait until the test answers them */
function page() {
  const ctx = vm.createContext({ reads: [], autos: [], console });
  vm.runInContext(`
    const NW_PAGE=2,NW={posts:null,busy:false,err:'',more:false,at:0,again:false,pin:'',pinned:null};
    const q={where:()=>q,orderBy:()=>q,limit:()=>q,get:()=>new Promise(res=>reads.push(res))};
    const S={db:{collection:()=>q},view:'devnews'};
    const nwPost=(id,d)=>({id,t:d.t,pub:true}),nwGetPost=async()=>null,nwAuto=()=>autos.push(NW.posts&&NW.posts[0]&&NW.posts[0].id),nwExtras=()=>{},nwSeen=()=>{},render=()=>{};
    ${fn('nwLoad', 'async function ')}
    /* what the news listener does when a post is published, changed or taken down */
    this.changed=()=>{NW.posts=null;NW.err='';if(NW.busy)NW.again=true;if(S.view==='devnews')nwLoad(false);};
    this.NW=NW;this.S=S;this.load=nwLoad;`, ctx);
  const answer = async (k, ts) => { ctx.reads[k]({ size: ts.length, docs: ts.map(t => ({ id: 'p' + t, data: () => ({ t }) })) }); for (let i = 0; i < 20; i++) await null; };
  return { ctx, answer, ids: () => (ctx.NW.posts || []).map(p => p.id) };
}

test('a post published while Older posts is being read: no error, and the list is read again', async () => {
  const P = page();
  P.ctx.load(false); await P.answer(0, [10, 9]);
  assert.deepEqual(P.ids(), ['p10', 'p9']);
  P.ctx.load(true);                 // Older posts
  P.ctx.changed();                  // a post is published meanwhile
  assert.equal(P.ctx.reads.length, 2, 'the new read waits for the one running');
  await P.answer(1, [8, 7]);        // the older page comes back
  assert.equal(P.ctx.NW.err, '', 'no "could not be loaded"');
  assert.equal(P.ctx.reads.length, 3, 'the list is read again');
  await P.answer(2, [11, 10]);
  assert.deepEqual(P.ids(), ['p11', 'p10']);
  assert.equal(P.ctx.NW.err, '');
  assert.equal(P.ctx.NW.busy, false);
});
test('a change while the first page is read on another page leaves the list to be read on the next visit', async () => {
  const P = page();
  P.ctx.load(false);
  P.ctx.S.view = 'nation';
  P.ctx.changed();
  await P.answer(0, [10, 9]);
  assert.equal(P.ctx.NW.posts, null, 'not the list from before the change');
  assert.equal(P.ctx.reads.length, 1, 'nothing read while away');
});
test('Older posts on its own still adds the older page', async () => {
  const P = page();
  P.ctx.load(false); await P.answer(0, [10, 9]);
  P.ctx.load(true); await P.answer(1, [8, 7]);
  assert.deepEqual(P.ids(), ['p10', 'p9', 'p8', 'p7']);
});
test('the first post’s comments open only on the news page', async () => {
  const P = page();
  P.ctx.load(false); P.ctx.S.view = 'nation'; await P.answer(0, [10, 9]);
  assert.equal(P.ctx.autos.length, 0, 'left the page while it loaded: no listener');
  const Q = page();
  Q.ctx.load(false); await Q.answer(0, [10, 9]);
  assert.deepEqual([...Q.ctx.autos], ['p10']);
});
test('the news listener marks a read for later while one is running', () => {
  assert.match(html, /if\(was\)\{NW\.posts=null;NW\.err='';if\(NW\.busy\)NW\.again=true;/);
});
