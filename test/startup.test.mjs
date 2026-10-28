import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const stub=readFileSync(new URL('../src/stub.js',import.meta.url),'utf8');
const game=readFileSync(new URL('../game/edictum.html',import.meta.url),'utf8');
function boot({theme,hostTheme,blocked=false,nation=true}={}){
  const attrs=new Map(hostTheme?[['data-theme',hostTheme]]:[]),classes=new Set(),timers=new Map();let id=0,time=0,writes=0;
  const stored=new Map([['statehood.theme',theme],['statehood.nation.v1',nation?'{}':null]]);
  const root={getAttribute:k=>attrs.get(k)||null,setAttribute:(k,v)=>attrs.set(k,v),removeAttribute:k=>attrs.delete(k),classList:{add:k=>classes.add(k),remove:k=>classes.delete(k)}};
  const p={set textContent(v){writes++;},setAttribute(){}};
  const ctx=vm.createContext({document:{documentElement:root,querySelectorAll:()=>[p]},localStorage:{getItem:k=>{if(blocked)throw Error('blocked');return stored.get(k);}},
    setTimeout:(f,ms)=>{const key=++id;timers.set(key,{f,at:time+ms});return key;},clearTimeout:k=>timers.delete(k),addEventListener(){}});
  ctx.window=ctx;vm.runInContext(stub,ctx);
  return {ctx,attrs,classes,stored,writes:()=>writes,advance(ms){time+=ms;for(const [key,t] of [...timers])if(t.at<=time){timers.delete(key);t.f();}}};
}
test('the saved theme is applied before game download and loading feedback is delayed briefly',()=>{
  const b=boot({theme:'dark'});
  assert.equal(b.attrs.get('data-theme'),'dark');assert.equal(b.ctx.__edictum.hostTheme,null);
  assert.ok(b.classes.has('ed-back'));assert.ok(b.classes.has('ed-boot-pending'));
  b.advance(349);assert.ok(b.classes.has('ed-boot-pending'));
  b.advance(1);assert.ok(!b.classes.has('ed-boot-pending'));
});
test('a fast game render cancels the loading-screen reveal',()=>{
  const b=boot();b.advance(100);b.ctx.__edictum.painted();
  assert.ok(!b.classes.has('ed-boot-pending'));b.advance(1000);assert.ok(!b.classes.has('ed-boot-pending'));
});
test('Automatic theme still follows the system or original host after an early saved preference',()=>{
  for(const hostTheme of [null,'light']){
    const b=boot({theme:'dark',hostTheme});
    const start=game.indexOf('function applyTheme('),end=game.indexOf('\nfunction setTheme(',start);
    vm.runInContext(game.match(/const HOST_THEME=.*;/)[0]+'\n'+game.slice(start,end)+'\napplyTheme("auto");',b.ctx);
    assert.equal(b.attrs.get('data-theme')||null,hostTheme);
  }
});
test('blocked storage preserves startup and a failed download reveals one actionable message',async()=>{
  const b=boot({blocked:true});assert.ok(!b.classes.has('ed-back'));
  b.ctx.__edictum.bootError();b.ctx.__edictum.bootError();assert.equal(b.writes(),1);
  assert.ok(!b.classes.has('ed-boot-pending'));
  assert.equal(b.ctx.__edictum.settle(null),true);assert.equal(await b.ctx.claude.use('db'),null);
});
