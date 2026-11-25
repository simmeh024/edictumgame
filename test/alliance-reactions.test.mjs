import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
const reactAt = html.indexOf("else if(a==='react'&&m){if(RGC.menu)");
assert.ok(reactAt > 0, 'the reaction listener exists');
const start = html.lastIndexOf("document.addEventListener('click',e=>{", reactAt);
const end = html.indexOf('\n});', reactAt) + 4;
const listener = html.slice(start, end);

test('clicks find alliance messages in the alliance channel, and region messages in the region', () => {
  let handler, selected = 'ally', calls = [];
  const alliance = { id: 'alliance-message', ally: true }, region = { id: 'region-message' };
  const document = { addEventListener: (_, fn) => { handler = fn; }, querySelector: () => null };
  const context = vm.createContext({ document, CSS: { escape: s => s }, RGC: { menu: 'open' }, rgcTab: () => selected,
    rgcAllyLines: () => [alliance], rgcCh: () => ({ list: [region] }),
    rgcReact: (m, k) => calls.push([m, k]) });
  vm.runInContext(listener, context);
  const click = (id, k) => handler({ target: { closest: () => ({ tagName: 'BUTTON', dataset: { rgc: 'react', id, k } }) } });
  click('alliance-message', 'hear');
  selected = 'region';
  click('region-message', 'love');
  assert.deepEqual(calls, [[alliance, 'hear'], [region, 'love']]);
});
