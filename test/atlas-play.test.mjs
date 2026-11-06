// The atlas's Play button (game/edictum.html, atlasLoop and the atlas-play click; bug run item 63). When playback
// reached the end, the loop stopped without clearing its frame handle, so pressing Play again saw a loop "already
// running" and never started one: the button said Pause and nothing moved.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
function block(at) {
  let i = html.indexOf('{', at), depth = 0;
  for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}' && --depth === 0) break; }
  return html.slice(at, i + 1);
}
function fn(name) { const at = html.indexOf('\nfunction ' + name + '('); if (at < 0) throw new Error('no function ' + name); return block(at + 1); }
const click = block(html.indexOf("if(a==='atlas-play'){"));

test('Play after the atlas reached the end starts it again from the beginning', () => {
  const ctx = vm.createContext({ Math, String });
  vm.runInContext(`
    var S={view:'atlas',atlasPlay:false,atlasT:null},frames=[],nextId=1,renders=0;
    let atlasRaf=0,atlasLast=0;
    const D={start:0,end:100000,keys:[]};
    function atlasData(){return D;}
    function atlasKey(t){return 0;}
    function atlasCaption(){return '';}
    function atlasSide(){return '';}
    function atlasRefresh(){}
    function redrawMaps(){}
    function render(){renders++;}
    var document={getElementById(){return null;}};
    function requestAnimationFrame(f){frames.push(f);return nextId++;}
    ${fn('atlasLoop')}
    function play(el){const a='atlas-play';${click}}
    const el={textContent:'Play',setAttribute(){}};
    function runFrames(){let ts=0,n=0;while(frames.length&&n<1000){const f=frames.shift();ts+=100;f(ts);n++;}return n;}
    this.t={S,el,play,runFrames,get frames(){return frames.length;},get raf(){return atlasRaf;}};
  `, ctx);
  const t = ctx.t;
  t.play(t.el);
  assert.equal(t.S.atlasPlay, true);
  assert.equal(t.frames, 1, 'the first Play starts a frame');
  assert.ok(t.runFrames() > 10, 'the atlas plays through');
  assert.equal(t.S.atlasPlay, false, 'and stops at the end');
  assert.equal(t.S.atlasT, 100000);
  assert.equal(t.raf, 0, 'the loop lets go of its frame handle at the end');

  t.play(t.el);
  assert.equal(t.S.atlasPlay, true);
  assert.equal(t.el.textContent, 'Pause');
  assert.equal(t.S.atlasT, 0, 'Play again starts from the beginning');
  assert.equal(t.frames, 1, 'and a new frame is asked for (it was not)');
  t.runFrames();
  assert.equal(t.S.atlasT, 100000, 'the second run reaches the end too');
});
