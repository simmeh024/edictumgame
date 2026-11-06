// A currency code as typed (game/edictum.html, cuSave; bug run item 54). The draft cleans the code before the save sees
// it, so "AB" or "E1" was dropped and the suggestion saved in its place, and the "three to five letters" message could
// never show. The save now checks the code as typed and refuses a bad one, saying why.
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
const line = re => { const m = html.match(re); if (!m) throw new Error('no line ' + re); return m[0]; };

/* cuSave up to the draft: a refused code stops it with a message; anything else carries on to cuDraftCur */
function save(cd) {
  const ctx = vm.createContext({ toasts: [], focused: [] });
  vm.runInContext(`
    ${line(/const cuCodeBad=[^\n]*/)}
    const S={nation:{name:'Coinland',currency:'mark'}},CU={d:{unit:'mark',cd:${JSON.stringify(cd)}}};
    const toast=t=>toasts.push(t),document={getElementById:id=>({focus:()=>focused.push(id)})};
    const cuStr=v=>String(v||''),cuDraftCur=()=>{throw new Error('reached the draft');};
    ${fn('cuSave')}
    this.run=()=>{try{return cuSave();}catch(e){return e.message;}};`, ctx);
  return { result: ctx.run(), toasts: ctx.toasts, focused: ctx.focused };
}

test('a code that is not three to five letters is refused, with the reason, and the field is focused', () => {
  for (const cd of ['AB', 'E1', 'ABCDEF', 'ÉTM', 'A B C', '12345']) {
    const r = save(cd);
    assert.equal(r.result, false, cd);
    assert.match(r.toasts.at(-1), /cannot be a currency code: a code is three to five letters/, cd);
    assert.deepEqual([...r.focused], ['cu-f-cd'], cd);
  }
});
test('three to five letters in either case, or an empty field for the suggestion, go on to be saved', () => {
  for (const cd of ['ETM', 'ald', 'Thalr', '  TRS  ', '', '   ', undefined]) assert.equal(save(cd).result, 'reached the draft', String(cd));
});
test('the old check after the draft, which could never fire, is gone', () => {
  assert.doesNotMatch(fn('cuSave'), /out\.cd&&!cuClean/);
});
