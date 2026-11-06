// The admin news editor (game/edictum.html; bug run items 59 and 60).
// 59: the link field's message was kept in NWE.lerr, the post list's own error, so a message left in the field stopped
//     the list from loading and stood over an empty list until a reload. It has its own field now (NWE.lkErr).
// 60: a poll's closing day was saved as 23:59:59 of that day in the admin's time, but read back as a UTC date: west of
//     UTC that is the next day, so every save moved it a day later. It is read back in the admin's time now.
process.env.TZ = 'America/Mexico_City';
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

test('a message in the link field does not stop the post list loading, nor show over it', () => {
  const ctx = vm.createContext({ listed: [] });
  vm.runInContext(`
    const NWE={node:null,list:null,lbusy:false,lerr:'',lkErr:'',lask:''},NW={stat:{}};
    const document={getElementById:()=>null},admShell=(v,h)=>h,esc=s=>String(s),NW_READS_TIP='',nweList=()=>listed.push(1);
    ${fn('nweLinkErr')}
    ${fn('nwAdminView')}
    nweLinkErr('A link needs an address starting with https:// or mailto:.');
    this.NWE=NWE;this.out=nwAdminView();`, ctx);
  assert.equal(ctx.NWE.lerr, '', 'the list’s own error is untouched');
  assert.match(ctx.NWE.lkErr, /A link needs an address/);
  assert.equal(ctx.listed.length, 1, 'the list is read');
  assert.doesNotMatch(ctx.out, /A link needs an address/);
});
test('the editor shows the link message from its own field, and a new post starts without one', () => {
  assert.match(html, /id="nwe-lerr" role="alert"\$\{NWE\.lkErr\?'':' hidden'\}>\$\{esc\(NWE\.lkErr\|\|''\)\}/);
  assert.match(fn('nweOpen'), /lkErr:''/);
});
test('a poll’s closing day reads back as the day it was saved, west and east of UTC', () => {
  const ctx = vm.createContext({});
  vm.runInContext(`${fn('nweDay')} this.day=nweDay;`, ctx);
  for (const tz of ['America/Mexico_City', 'America/Los_Angeles', 'UTC', 'Europe/Amsterdam', 'Asia/Tokyo', 'Pacific/Auckland']) {
    process.env.TZ = tz;
    let day = '2026-11-20';
    for (let i = 0; i < 3; i++) {            // open and save three times, as the editor does
      const end = Date.parse(day + 'T23:59:59');
      day = ctx.day(end);
    }
    assert.equal(day, '2026-11-20', tz);
  }
  process.env.TZ = 'America/Mexico_City';
  assert.equal(new Date(Date.parse('2026-11-20T23:59:59')).toISOString().slice(0, 10), '2026-11-21', 'the old reading was a day on');
});
test('the editor reads the closing day with nweDay', () => {
  assert.match(fn('nweOpen'), /pend:p&&p\.pl&&p\.pl\.end\?nweDay\(p\.pl\.end\):''/);
});
