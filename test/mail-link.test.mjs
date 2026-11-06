// Letters by post: the emailed confirmation link and the status check (game/edictum.html, mlLoad; bug run item 62).
// A link opened after its 30-minute code had expired said "open the link on the device where you asked for the code",
// which was wrong, and a status check that failed once was never tried again: Settings said "try again later" until a
// reload, and the code from the link was lost.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
function fn(name) {
  const at = html.indexOf('\nfunction ' + name + '(');
  if (at < 0) throw new Error('no function ' + name);
  let i = html.indexOf('{', at), depth = 0;
  for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}' && --depth === 0) break; }
  return html.slice(at + 1, i + 1);
}
const flush = () => new Promise(r => setTimeout(r, 0));

test('the link says why it did nothing: already confirmed, expired, another account, or no letters here', () => {
  const ctx = vm.createContext({});
  vm.runInContext(`${fn('mlLinkNote')} this.note=mlLinkNote;`, ctx);
  assert.equal(ctx.note({ email: 'a@b.test', ok: false, wait: true }), null, 'a waiting code is confirmed');
  assert.match(ctx.note({ email: 'a@b.test', ok: true, wait: false }).msg, /already confirmed/);
  assert.match(ctx.note({ email: 'a@b.test', ok: false, wait: false }).err, /has expired.*30 minutes.*new one/);
  assert.match(ctx.note({ email: '', ok: false, wait: false }).err, /another account/);
  assert.match(ctx.note(null).err, /not available here/);
  for (const r of [{ email: 'a@b.test', ok: false, wait: false }, { email: '' }]) assert.doesNotMatch(ctx.note(r).err, /on the device where/);
});

test('a failed status check is tried again after a back-off, and keeps the code from the link for it', async () => {
  const ctx = vm.createContext({ Date, Promise, Math });
  vm.runInContext(`
    var ML={st:null,busy:false,err:'',msg:'',email:'',code:'',edit:false,loading:false,tries:0,retryAt:0};
    var ML_LINK='123456',S={view:'settings'},calls=0,reply=null,timers=[],verified=[];
    function render(){}
    function setTimeout(f,ms){timers.push(ms);}
    function mlDo(data,ok){verified.push(data);}
    function mlApi(){return Promise.resolve({request(d){calls++;return reply==='fail'?Promise.reject(new Error('unavailable')):Promise.resolve(reply);}});}
    ${fn('mlLinkNote')} ${fn('mlRetryWait')} ${fn('mlLoad')}
    this.t={get ML(){return ML;},get link(){return ML_LINK;},get calls(){return calls;},get timers(){return timers;},set reply(v){reply=v;},mlLoad,mlRetryWait};
  `, ctx);
  const t = ctx.t;
  assert.deepEqual([1, 2, 3, 7, 20].map(t.mlRetryWait), [5e3, 10e3, 20e3, 300e3, 300e3]);

  t.reply = 'fail';
  t.mlLoad(); await flush(); await flush();
  assert.equal(t.calls, 1);
  assert.equal(t.ML.st.fail, true);
  assert.equal(t.ML.tries, 1);
  assert.ok(t.ML.retryAt > Date.now() + 4000 && t.ML.retryAt <= Date.now() + 5000, 'the next try waits 5 s');
  assert.deepEqual([...t.timers], [5050], 'a timer brings the next try');
  assert.equal(t.link, '123456', 'the code from the link is kept for the next try');

  t.mlLoad(); await flush(); await flush();
  assert.equal(t.calls, 1, 'no new request before the back-off is over (Settings redraws often)');

  t.ML.retryAt = Date.now() - 1;
  t.reply = { email: 'a@b.test', ok: false, wait: false, p: {} };
  t.mlLoad(); await flush(); await flush();
  assert.equal(t.calls, 2, 'the check is tried again once the back-off is over');
  assert.equal(t.ML.st.email, 'a@b.test');
  assert.equal(t.ML.tries, 0);
  assert.match(t.ML.err, /has expired/, 'the kept link is answered once the Herald replies');
  assert.equal(t.link, '');

  t.mlLoad(); await flush();
  assert.equal(t.calls, 2, 'a loaded status is not asked for again');
});

test('Settings offers a Try again button while the Herald cannot be reached', () => {
  assert.match(fn('mailSection'), /st\.fail\?`[^`]*data-f="retry"[^`]*Try again/);
  const click = html.slice(html.indexOf("if(f==='retry')"), html.indexOf("if(f==='edit')"));
  assert.match(click, /ML\.st=null;ML\.tries=0;ML\.retryAt=0;mlLoad\(true\)/);
});
