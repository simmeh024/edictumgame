// The gap audit of 28 Nov 2026, items 5, 6, 8 and 9: trade deals that lost their timings on the way to other players,
// the Great Statue's accent hidden by the Club's piece of the same id, one name to a nation in each region on the
// server, and the region's Delegates kept where every player can read them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { delegateNext } from '../functions/civic.js';

const html = fs.readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
const civic = fs.readFileSync(new URL('../functions/civic.js', import.meta.url), 'utf8');
const catalogue = fs.readFileSync(new URL('../functions/shop-catalogue.json', import.meta.url), 'utf8');
const fnBody = (src, head) => { const i = src.indexOf(head); assert.ok(i >= 0, head); return src.slice(i, src.indexOf('\n}\n', i) + 2); };

test('5: a deal read from another nation keeps when the offer was made (s) and when its reminder went (nu)', () => {
  const body = fnBody(html, 'function normalizeBase(d){');
  const line = body.split('\n').findIndex(l => l.trimStart().startsWith('const deals='));
  assert.ok(line >= 0, 'the deals line');
  const lines = body.split('\n'), end = lines.findIndex((l, i) => i >= line && /return o;\}\):\[\];\s*$/.test(l));
  const code = lines.slice(line, end + 1).join('\n') + '\ndeals;';
  const ctx = { d: null, RES: ['food', 'timber', 'iron', 'oil', 'goods'], TR_STORE: 48, clamp: (v, a, b) => Math.max(a, Math.min(b, v)), num: (v, f) => typeof v === 'number' && isFinite(v) ? v : f };
  ctx.d = { deals: [
    { id: 'acc1', w: 'them', g: ['food', 3], r: ['iron', 2], t: 2000, a: 1, s: 1000 },
    { id: 'off1', w: 'them', g: ['oil', 1], r: ['goods', 4], t: 3000, nu: 3500 },
    { id: 'off2', w: 'them', g: ['oil', 1], r: ['goods', 4], t: 3000, nu: 'soon', s: -4 }
  ] };
  const out = vm.runInNewContext(code, ctx);
  assert.equal(out[0].s, 1000, 'an acceptance keeps the offer time, so "usually answers within" can be worked out');
  assert.equal(out[1].nu, 3500, 'an offer keeps its reminder, so the other side sees "sent a reminder"');
  assert.equal(out[2].nu, undefined); assert.equal(out[2].s, undefined, 'nonsense is still left out');
  // what reads them
  assert.ok(/function trResp\(id\)\{[^\n]*x\.a&&x\.s&&x\.t>=x\.s/.test(html), 'trResp reads s');
  assert.ok(html.includes("nu:x.nu||0"), 'the pending offer carries nu');
});

test('6: the Great Statue’s accent has an id of its own, which no shop piece takes over', () => {
  const keep = JSON.parse(html.match(/WND_KEEP=(\[[^\]]+\])/)[1].replace(/'/g, '"'));
  assert.ok(keep.includes('a-bronzegreen') && !keep.includes('a-verdigris'));
  assert.ok(html.includes("'a-bronzegreen':{k:'accent',n:'Bronze Green',src:'wonder'}"));
  // the shop's add() lists and the catalogue: none of the statue's keepsakes is sold
  const shopPart = html.slice(html.indexOf("['t-illustrious','title','the Illustrious']") - 4000, html.indexOf("const SHOP_IDS={founder:[]"));
  for (const id of keep) {
    assert.ok(!shopPart.includes(`['${id}',`), `${id} is not a shop piece`);
    assert.ok(!catalogue.includes(`"${id}"`), `${id} is not in the catalogue`);
  }
  // the Club keeps its Verdigris, with its own colour; the statue's accent has its colours under its own name
  assert.ok(catalogue.includes('"a-verdigris"') && html.includes("['a-verdigris','accent','Verdigris']"));
  for (const sel of [':root[data-accent="bronzegreen"]{', '.cz-asw[data-a="bronzegreen"]{', ':root[data-accent="verdigris"]{', '.cz-asw[data-a="verdigris"]{'])
    assert.ok(html.includes(sel), sel);
  assert.equal(html.split(':root[data-accent="verdigris"]{').length - 1, 1, 'one Verdigris colour, the Club’s');
});

test('8: the server refuses a name the region already has when a save founds, renames or moves a nation', () => {
  const settle = fnBody(civic, 'async function settleSave(');
  const at = settle.indexOf('await nameFree(tx, db, who, p, d)'), firstWrite = settle.indexOf('tx.set(');
  assert.ok(at > 0 && at < firstWrite, 'asked before the save’s first write (a transaction reads first)');
  assert.ok(/!e\.saved\.exists \|\| before\.name !== p\.name \|\| before\.reg !== p\.reg \? await nameFree/.test(settle), 'only a new record, a new name or a new region');
  const free = fnBody(civic, 'async function nameFree(');
  assert.ok(free.includes("refuse('name_taken'"));
  assert.ok(free.includes('npcNameSets.get(p.reg)'), 'the region’s computer nations count');
  assert.ok(free.includes("db.collection('summaries').where('reg', '==', p.reg)"), 'every nation of the region, by its summary');
  assert.ok(/mine = new Set\(\[who\.uid, typeof d\.from === 'string'/.test(free), 'the account’s own and the guest it carries from are no clash');
  // the same fold as the game's nameTaken
  const gameFold = html.match(/const nameFold=s=>(.+);\n/)[1].replace(/\s/g, ''), serverFold = civic.match(/const fold = s => (.+);\n/)[1].replace(/\s/g, '');
  assert.equal(serverFold, gameFold);
  // the game: a refused save asks for a new name instead of trying again for ever
  assert.ok(html.includes("if(e&&e.code==='name_taken'){remoteDirty=true;nameClash(e.message);return;}"));
  assert.ok(/function renDue\(\)\{[^\n]*\n\s*const c=S\.nameClash/.test(html), 'the rename card answers for a clash');
  const flush = fnBody(html, 'async function flushRemote(){'), held = flush.indexOf('S.nameClash&&S.nation&&nameFold(S.nation.name)===nameFold(S.nameClash.name)');
  assert.ok(held > 0 && held < flush.indexOf('remoteDirty=false;remoteSoon=false'), 'nothing is sent again under the refused name');
});

test('9: the region notes each change of Delegate, the first as already under way', () => {
  assert.deepEqual(delegateNext(undefined, '', 1), [{ u: '', t: 1, f: 1 }], 'an empty chair begins the list too, so the first Delegate after it is news');
  assert.equal(delegateNext([{ u: '', t: 1, f: 1 }], '', 2), null);
  assert.deepEqual(delegateNext([{ u: '', t: 1, f: 1 }], 'a', 3).at(-1), { u: 'a', t: 3 }, 'a Delegate after the empty chair: a start the list knows');
  assert.deepEqual(delegateNext(undefined, 'a', 5), [{ u: 'a', t: 5, f: 1 }], 'a chair already held: its start unknown');
  const one = [{ u: 'a', t: 5, f: 1 }];
  assert.equal(delegateNext(one, 'a', 9), null, 'the same Delegate: nothing');
  assert.deepEqual(delegateNext(one, 'b', 9), [{ u: 'a', t: 5, f: 1 }, { u: 'b', t: 9 }]);
  assert.deepEqual(delegateNext(one, '', 9).at(-1), { u: '', t: 9 }, 'the chair falling empty is noted too');
  const long = Array.from({ length: 40 }, (_, i) => ({ u: 'n' + i, t: i }));
  assert.equal(delegateNext(long, 'z', 99).length, 40, 'forty at most');
  assert.deepEqual(delegateNext([{ u: 3 }, null, { u: 'a', t: 1 }], 'a', 2), null, 'broken entries are left out');
});

test('9: a nation’s terms come from the region’s list, its own record keeping older ones and other regions’', () => {
  const src = fnBody(html, 'function asmTermsOf(n,id){');
  const run = (dh, n, id) => vm.runInNewContext(src + '\nasmTermsOf(n,id);', { S: { civic: dh ? { reg: 'meridian', dh } : null }, REG: { id: 'meridian' }, n, id });
  const plain = v => JSON.parse(JSON.stringify(v));
  const dh = [{ u: 'a', t: 100, f: 1 }, { u: 'b', t: 200 }, { u: '', t: 300 }, { u: 'a', t: 400 }];
  assert.deepEqual(plain(run(dh, {}, 'a')), [{ t: 100, r: 'meridian', on: 1, f: 1 }, { t: 200, r: 'meridian', on: 0 }, { t: 400, r: 'meridian', on: 1 }]);
  assert.deepEqual(plain(run(dh, {}, 'b')), [{ t: 200, r: 'meridian', on: 1 }, { t: 300, r: 'meridian', on: 0 }]);
  assert.deepEqual(plain(run(dh, {}, 'c')), []);
  // its own record: a term begun before the list (then not counted twice), and one in another region
  const own = { asm: { d: [{ t: 50, r: 'meridian', on: 1 }, { t: 60, r: 'frostmarch', on: 1 }, { t: 150, r: 'meridian', on: 0 }] } };
  assert.deepEqual(plain(run(dh, own, 'a')), [{ t: 50, r: 'meridian', on: 1 }, { t: 60, r: 'frostmarch', on: 1 }, { t: 200, r: 'meridian', on: 0 }, { t: 400, r: 'meridian', on: 1 }]);
  // no list yet (an older server, another region): the record's own, as before
  assert.deepEqual(plain(run(null, own, 'a')), own.asm.d);
  assert.deepEqual(plain(run([], {}, 'a')), []);
  // the places that tell it read it, and none tells a term of unknown start as news
  for (const s of ['since=asmTermsOf(n,D.id).filter(x=>x.r===REG.id&&!x.f).pop()', 'asmTermsOf(n,me).filter(d=>d.r===REG.id&&!d.f)', 'for(const d of asmTermsOf(n,x.id))if(d.r===REG.id&&d.on&&!d.f',
    'for(const d of asmTermsOf(n,r.id))if(d.r===REG.id&&d.on&&!d.f', 'for(const d of asmTermsOf(n,F.id)){if(!d||d.r!==REG.id||d.f', 'asmHonours(x.n,L.isD,x.id)'])
    assert.ok(html.includes(s), s);
  /* the readers of other nations' terms no longer read n.asm.d itself (the own nation's own checks still do) */
  for (const old of ['since=((n.asm&&n.asm.d)||[])', 'const t=(n.asm&&n.asm.d)||[],terms=', 'for(const d of (n.asm&&n.asm.d)||[])if(d.r===REG.id&&d.on&&d.t>=',
    'try{for(const d of (n.asm&&n.asm.d)||[]){if(!d||d.r!==REG.id'])
    assert.ok(!html.includes(old), 'left: ' + old);
  // the server sends the list with every view
  assert.ok(civic.includes("dh: dhList(ctx.dh) };"));
});
