// The poster (game/edictum.html, "the poster"): the nation as a decorated map, saved as a picture. The parts that
// are plain arithmetic: the scale bar, the view that fits the nation, where the inset, compass and bar go, the
// sheets' measures, and that every look brings every colour the map's drawing reads.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
function fn(name) {
  let at = html.indexOf('\nfunction ' + name + '(');
  if (at < 0) at = html.indexOf('\nasync function ' + name + '(');
  assert.ok(at >= 0, name + ' is found');
  let i = html.indexOf('{', at), depth = 0;
  for (; i < html.length; i++) { const ch = html[i]; if (ch === '{') depth++; else if (ch === '}' && --depth === 0) break; }
  return html.slice(at + 1, i + 1);
}
const consts = html.slice(html.indexOf('const PST_LOOKS={'), html.indexOf('const PST_ICON='));
assert.ok(consts.includes('PST_SHAPES') && consts.includes('PST_SMAX'), 'the poster’s tables are found');
const P = new Function(`
  const HEX_R=10,SQ3=Math.sqrt(3),HEX_W=SQ3*HEX_R,AREA_PER_HEX=12500,MAP_PW=HEX_W*120,MAP_FONT='serif';
  let PST_CRC=null;
  ${consts}
  ${['pstKm', 'pstBar', 'pstView', 'pstPlace', 'pstText', 'pstTitle', 'pstCrc', 'pstPhys'].map(fn).join('\n')}
  return {PST_LOOKS,PST_SHAPES,PST_SIZES,PST_KEY,PST_PAD,PST_SMAX,PST_DPI,HEX_R,HEX_W,MAP_PW,AREA_PER_HEX,pstKm,pstBar,pstView,pstPlace,pstText,pstTitle,pstPrintTxt,pstCrc,pstPhys};`)();
/* a canvas that only measures: every letter half as wide as the type is tall, and what was written where */
function paper() {
  const out = [], g = { font: '', letterSpacing: '0px', textAlign: '', textBaseline: '', fillStyle: '', measureText: s => ({ width: String(s).length * parseFloat(/([\d.]+)px/.exec(g.font)[1]) * 0.5 }), fillText: (t, x, y) => out.push({ t, x, y, size: parseFloat(/([\d.]+)px/.exec(g.font)[1]) }) };
  return { g, out };
}

test('every look brings every colour the map reads, so no poster borrows from the player’s theme', () => {
  const draw = fn('drawMap'), keys = [...new Set([...draw.matchAll(/C\('(--[a-z0-9-]+)'\)/g)].map(m => m[1]))];
  assert.ok(keys.length >= 15 && keys.includes('--sea') && keys.includes('--terr-a'), 'the colours drawMap reads are found: ' + keys.join(' '));
  assert.match(draw, /PAL=P&&P\.pal/, 'drawMap takes a plate’s own colours');
  for (const [id, L] of Object.entries(P.PST_LOOKS)) {
    for (const k of keys) assert.ok(typeof L.pal[k] === 'string' && L.pal[k].length, `${id} has ${k}`);
    for (const k of ['--sea', '--land', '--ink', '--sheet', '--accent', '--coast']) assert.match(L.pal[k], /^#[0-9a-f]{6}$/i, `${id} ${k} is a plain colour`);
    assert.ok(parseFloat(L.pal['--terr-a']) > 0.2 && parseFloat(L.pal['--terr-a']) < 0.8, `${id}: the nations’ colours show through`);
    for (const k of ['paper', 'ink', 'ink2', 'accent', 'ol']) assert.match(L[k], /^#[0-9a-f]{6}$/i, `${id}.${k}`);
    assert.equal(L.pal['--sheet'], L.paper, `${id}: names on the map sit on the sheet’s own paper`);
    assert.ok(L.veil > 0.3 && L.veil < 0.8, `${id}: other land is paled, not hidden`);
  }
  assert.deepEqual(Object.keys(P.PST_LOOKS), ['atlas', 'antique', 'night', 'blueprint', 'chancery', 'engraved', 'watercolour']);
  /* the Cartographer's Pack's look: tried by anyone, saved only with the piece; the Chancery Club's three: tried by
     anyone, saved by members; the three others are free */
  assert.deepEqual(Object.entries(P.PST_LOOKS).filter(([, L]) => L.lock).map(([k, L]) => k + ':' + L.lock), ['blueprint:pl-blueprint']);
  assert.deepEqual(Object.entries(P.PST_LOOKS).filter(([, L]) => L.club).map(([k]) => k), ['chancery', 'engraved', 'watercolour']);
  assert.ok(Object.values(P.PST_LOOKS).every(L => !(L.lock && L.club)), 'no look is both the pack’s and the Club’s');
  /* what makes each of the Club's its own */
  const { chancery: C, engraved: E, watercolour: W } = P.PST_LOOKS;
  assert.ok(C.frame === 'gilt' && C.seal && E.frame === 'guilloche' && E.engrave && W.frame === 'pencil' && W.wash && W.grain, 'gilt and a seal; a guilloché and an engraving; washes on grained paper in a pencilled frame');
  for (const L of Object.values(P.PST_LOOKS)) if (!L.club) assert.ok(!L.frame && !L.seal && !L.engrave && !L.wash && !L.grain, L.n + ' is as it was');
});

test('the Chancery look’s seal sits on each sheet inside the frame, clear of the key and the foot', () => {
  const r = 24, inner = 19.5, w = (t, z) => String(t).length * z * 0.56;
  for (const [id, S] of Object.entries(P.PST_SHAPES)) {
    assert.ok(Array.isArray(S.seal) && S.seal.length === 2, id + ' has a place for the seal');
    const [x, y] = S.seal, box = [x - r - 3, y - r - 3, x + r + 3, y + r + 3], hit = b => b[0] < box[2] && box[0] < b[2] && b[1] < box[3] && box[1] < b[3];
    assert.ok(box[0] > inner && box[1] > S.frule && box[2] < S.W - inner && box[3] < S.H - inner, `${id}: inside the frame and under the rule over the key`);
    const K = S.key;
    P.PST_KEY.forEach(([, name], i) => { const kx = K.x + (i % K.cols) * K.cw, ky = K.y + Math.floor(i / K.cols) * 22; assert.ok(!hit([kx, ky - 12, kx + 34 + w(name, 13), ky + 4]), `${id}: clear of “${name}” in the key`); });
    const F = S.foot, longest = 'Surveyed 30 September 2026', line = F.two ? [[longest, F.y], ['edictumgame.com', F.y + 18]] : [[longest + '  ·  edictumgame.com', F.y]];
    for (const [t, fy] of line) { const tw = w(t, 13), fx = F.a === 'center' ? F.x - tw / 2 : F.x; assert.ok(!hit([fx, fy - 12, fx + tw, fy + 4]), `${id}: clear of the foot`); }
    if (id === 'wide') assert.ok(box[2] < S.map[0], 'wide: in the left column, beside the map');
  }
});

test('print size: six times the sheet (five on a phone, under a phone’s canvas limit), said in pixels and centimetres', () => {
  assert.deepEqual(Object.keys(P.PST_SIZES), ['screen', 'print']);
  assert.equal(P.PST_DPI, 300);
  assert.match(fn('pstPrintK'), /\(pointer: coarse\)'\)\.matches\?5:6;/);
  for (const [id, S] of Object.entries(P.PST_SHAPES)) {
    assert.ok(S.W * 5 * S.H * 5 <= 16777216, `${id} at five times fits a phone’s canvas: ${S.W * 5 * S.H * 5}`);
    assert.ok(S.W * 6 >= 3600 || S.H * 6 >= 3600, `${id}: at least 3600 pixels along one side`);
  }
  assert.equal(P.pstPrintTxt('portrait', 6), '3,600 × 4,800 pixels, about 30 × 41 cm (12 × 16 in)');
  assert.equal(P.pstPrintTxt('wide', 6), '5,400 × 3,360 pixels, about 46 × 28 cm (18 × 11 in)');
  assert.equal(P.pstPrintTxt('square', 5), '3,700 × 3,700 pixels, about 31 × 31 cm (12 × 12 in)');
});

test('a print-size picture says it prints at 300 dots to the inch: one pHYs chunk, after the header, true to its checksum', () => {
  const be = v => [v >>> 24 & 255, v >>> 16 & 255, v >>> 8 & 255, v & 255];
  const chunk = (type, data) => { const td = [...Buffer.from(type, 'latin1'), ...data]; return [...be(data.length), ...td, ...be(P.pstCrc(Uint8Array.from(td)))]; };
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], ihdr = chunk('IHDR', [0, 0, 0, 2, 0, 0, 0, 2, 8, 6, 0, 0, 0]), idat = chunk('IDAT', [120, 156, 99, 0, 0, 0, 1, 0, 1]), iend = chunk('IEND', []);
  /* the checksum is the PNG one: IEND's is well known */
  assert.deepEqual(iend.slice(-4), [0xae, 0x42, 0x60, 0x82]);
  const chunks = a => { const out = []; for (let o = 8; o + 12 <= a.length;) { const len = (a[o] << 24 | a[o + 1] << 16 | a[o + 2] << 8 | a[o + 3]) >>> 0, type = String.fromCharCode(...a.slice(o + 4, o + 8)), data = [...a.slice(o + 8, o + 8 + len)], crc = [...a.slice(o + 8 + len, o + 12 + len)]; out.push({ type, data, ok: JSON.stringify(crc) === JSON.stringify(be(P.pstCrc(Uint8Array.from([...Buffer.from(type, 'latin1'), ...data])))) }); o += 12 + len; } return out; };
  const ppm = Math.round(300 / 0.0254);
  /* a picture with none: one is put after the header */
  const png = Uint8Array.from([...sig, ...ihdr, ...idat, ...iend]), out = P.pstPhys(png, 300), c = chunks(out);
  assert.deepEqual(c.map(x => x.type), ['IHDR', 'pHYs', 'IDAT', 'IEND']);
  assert.ok(c.every(x => x.ok), 'every checksum holds');
  assert.deepEqual(c[1].data, [...be(ppm), ...be(ppm), 1], '11,811 dots a metre each way, in metres');
  assert.equal(out.length, png.length + 21);
  assert.deepEqual([...out.slice(0, 33)], [...png.slice(0, 33)], 'the header is untouched');
  /* a picture with one already (a browser's 72 dots to the inch): it is replaced, not doubled */
  const old = Uint8Array.from([...sig, ...ihdr, ...chunk('pHYs', [...be(2835), ...be(2835), 1]), ...idat, ...iend]), again = chunks(P.pstPhys(old, 300));
  assert.deepEqual(again.map(x => x.type), ['IHDR', 'pHYs', 'IDAT', 'IEND']);
  assert.deepEqual(again[1].data, [...be(ppm), ...be(ppm), 1]);
  assert.ok(again.every(x => x.ok));
  /* anything that is not a PNG goes back as it came */
  const junk = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46]);
  assert.equal(P.pstPhys(junk, 300), junk);
});

test('the Club’s looks and the print size are tried by anyone and saved only by members', () => {
  /* a Club look is locked unless a member, and offered to members and while the Club is on sale */
  assert.match(fn('pstLocked'), /if\(L\.club\)return !pstMember\(\);/);
  assert.match(fn('pstOffered'), /L\.club\?pstMember\(\)\|\|pstClubSold\(\)/);
  assert.match(fn('pstClubSold'), /shopSells\('vip'\)\|\|shopSells\('vipyear'\)/);
  assert.match(fn('pstSizeLocked'), /PST\.size==='print'&&!pstMember\(\)/);
  /* a locked look carries the preview band and offers the Club in place of Save; a locked size draws the screen size */
  assert.match(fn('pstRender'), /if\(pstLocked\(lookKey\)\)pstMark\(g,W,H,L\);/);
  assert.match(fn('pstMark'), /COMES WITH THE CHANCERY CLUB/);
  assert.match(fn('pstActs'), /data-act="pst-club"/);
  assert.match(fn('pstDraw'), /big=PST\.size==='print'&&!pstSizeLocked\(\)&&!pstLocked\(PST\.look\)/);
  for (const f of ['pstSave', 'pstShare']) assert.match(fn(f), /pstLocked\(PST\.look\)\|\|PST\.big&&!pstMember\(\)\)return/, f + ' refuses what is only being tried');
  /* the Shop's comparison and the perk list name them */
  assert.match(fn('clubCompare'), /'Posters of your nation'/);
  assert.match(html, /<li><b>Three Club looks for the poster of your nation<\/b>/);
});

test('each sheet holds its parts inside its frame, clear of one another', () => {
  assert.deepEqual(Object.keys(P.PST_SHAPES), ['portrait', 'wide', 'square']);
  for (const [id, S] of Object.entries(P.PST_SHAPES)) {
    const [mx, my, mw, mh] = S.map, in0 = 19, facts = S.facts, key = S.key;
    assert.ok(mx >= in0 + 10 && my >= in0 + 10 && mx + mw <= S.W - in0 - 10 && my + mh <= S.H - in0 - 10, `${id}: the map lies inside the frame`);
    assert.ok(mw >= 500 && mh >= 380, `${id}: the map has room`);
    /* the name's room does not reach the arms (60 wide) or the flag (78 wide) beside it */
    const h = S.head, left = h.cx - h.tw / 2, right = h.cx + h.tw / 2, nameTop = h.top + 22 + h.size * 0.92 - h.size, nameBot = h.top + 22 + h.size * 0.92 + 30;
    for (const [x, y, w, hh] of [[h.arms[0], h.arms[1], 78, 72], [h.flag[0], h.flag[1], 78, 52]]) {
      const besideX = x + w <= left + 1 || x >= right - 1, besideY = y + hh <= nameTop + 6 || y >= nameBot;
      assert.ok(besideX || besideY, `${id}: the name is clear of what stands at ${x},${y}`);
    }
    assert.ok(nameBot <= S.rule[2] + 6, `${id}: the rule is under the motto`);
    /* three rows of facts in two columns, or two rows in three; then the rule, then the key, then the foot */
    const fRows = Math.ceil(6 / facts.cols), kRows = Math.ceil(P.PST_KEY.length / key.cols);
    assert.ok(facts.x + facts.cols * facts.cw <= (id === 'wide' ? mx : S.W - in0) && key.x + key.cols * key.cw <= (id === 'wide' ? mx : S.W - in0), `${id}: facts and key fit across`);
    assert.ok(facts.y + (fRows - 1) * 40 + 19 < S.frule - 4, `${id}: the facts end above their rule`);
    assert.ok(key.y - 14 > S.frule && key.y + (kRows - 1) * 22 < S.foot.y - 12, `${id}: the key sits between the rule and the foot`);
    assert.ok(S.foot.y + (S.foot.two ? 18 : 0) <= S.H - in0 - 6, `${id}: the foot is inside the frame`);
    if (id !== 'wide') assert.ok(facts.y - 13 > my + mh, `${id}: the facts start under the map`);
  }
  assert.equal(P.PST_KEY.length, 6);
});

test('the scale bar is a round number of kilometres about 88 pixels long, true to the hexes', () => {
  /* a hex of circumradius HEX_R covers AREA_PER_HEX square kilometres */
  const u = P.pstKm(1), hexArea = 1.5 * Math.sqrt(3) * P.HEX_R * P.HEX_R;
  assert.ok(Math.abs(u * u * hexArea - P.AREA_PER_HEX) < 1e-6, 'one map unit squared, in square kilometres');
  assert.ok(Math.abs(P.pstKm(2) - u / 2) < 1e-9, 'twice the scale, half the kilometres to a pixel');
  for (const s of [0.08, 0.2, 0.45, 0.8, 1.2, 1.9, 2.6]) {
    const B = P.pstBar(s, 88), lead = B.km / 10 ** Math.floor(Math.log10(B.km) + 1e-9);
    assert.ok([1, 2, 2.5, 5].some(v => Math.abs(lead - v) < 1e-9), `a round length at scale ${s}: ${B.km} km`);
    assert.ok(B.px > 55 && B.px < 140, `near 88 pixels at scale ${s}: ${B.px.toFixed(1)}`);
    assert.ok(Math.abs(B.px * P.pstKm(s) - B.km) < 1e-6, 'its length is its kilometres');
  }
});

test('the view fits the nation with room round it, and does not blow up a few hexes', () => {
  const mw = 528, mh = 430;
  /* a wide nation: its width decides */
  const big = { x0: 400, x1: 1400, y0: 300, y1: 600 }, V = P.pstView(big, mw, mh);
  assert.ok(Math.abs(V.s - (mw - 2 * P.PST_PAD) / 1000) < 1e-9, 'the width fits between the paddings');
  assert.ok((big.y1 - big.y0) * V.s <= mh - 2 * P.PST_PAD + 1e-9, 'and the height fits too');
  assert.deepEqual([V.cx, V.cy], [900, 450]);
  /* a tall nation: its height decides */
  const tall = { x0: 100, x1: 200, y0: 0, y1: 800 }, W = P.pstView(tall, mw, mh);
  assert.ok(Math.abs(W.s - (mh - 2 * P.PST_PAD) / 800) < 1e-9);
  /* seven hexes: the zoom stops at PST_SMAX */
  const small = { x0: 500, x1: 500 + 3 * P.HEX_W, y0: 500, y1: 500 + 5 * P.HEX_R };
  assert.equal(P.pstView(small, mw, mh).s, P.PST_SMAX);
  /* across the seam the box is measured round the capital, so its middle may lie off the map: it comes back on */
  const seam = P.pstView({ x0: -200, x1: 100, y0: 300, y1: 500 }, mw, mh);
  assert.ok(seam.cx >= 0 && seam.cx < P.MAP_PW && Math.abs(seam.cx - (P.MAP_PW - 50)) < 1e-6, 'the middle wraps: ' + seam.cx);
  const over = P.pstView({ x0: P.MAP_PW - 100, x1: P.MAP_PW + 300, y0: 300, y1: 500 }, mw, mh);
  assert.ok(Math.abs(over.cx - 100) < 1e-6, 'from the east too: ' + over.cx);
});

test('the name fits its room: smaller, then on two lines, and the map does not write it a second time', () => {
  const L = P.PST_LOOKS.atlas, tw = 320, size = 56, base = 110;
  /* a short name: one line, full size */
  let p = paper();
  assert.equal(P.pstTitle(p.g, 'Eternia', 300, base, size, tw, L), 1);
  assert.deepEqual(p.out.map(o => [o.t, o.size, o.y]), [['Eternia', 56, base]]);
  /* a longer one: still one line, smaller, never under about two thirds */
  p = paper();
  assert.equal(P.pstTitle(p.g, 'Saxe-Lauenburg', 300, base, size, tw, L), 1);
  assert.equal(p.out.length, 1);
  assert.ok(p.out[0].size < 56 && p.out[0].size >= 56 * 0.62 && p.out[0].t === 'Saxe-Lauenburg', JSON.stringify(p.out));
  /* too long for one line: two lines of about equal length, the second where one line would stand */
  p = paper();
  assert.equal(P.pstTitle(p.g, 'Upper and Lower Wandering Isles', 300, base, size, tw, L), 2);
  assert.deepEqual(p.out.map(o => o.t), ['Upper and Lower', 'Wandering Isles']);
  assert.ok(p.out[0].size === p.out[1].size && p.out[0].size <= 56 * 0.46 && p.out[1].y === base && p.out[0].y < base - p.out[0].size, JSON.stringify(p.out));
  for (const o of p.out) assert.ok(o.t.length * o.size * 0.5 <= tw, 'each line fits: ' + o.t);
  /* one long word cannot be split: it shrinks, and is cut short only when nothing else helps */
  p = paper();
  assert.equal(P.pstTitle(p.g, 'Llanfairpwllgwyngyllgogerychwyrndrobwll', 300, base, size, tw, L), 1);
  assert.ok(p.out[0].size >= 16 && (p.out[0].t.endsWith('…') || p.out[0].t.length * p.out[0].size * 0.5 <= tw), JSON.stringify(p.out));
  /* a line of text with a limit: smaller first, then an ellipsis */
  p = paper();
  P.pstText(p.g, 'A map of the Most Serene Confederated Commonwealth of', 0, 0, { size: 15, it: true, fill: '#000', max: 200, min: 10 });
  assert.ok(p.out[0].size === 10 && p.out[0].t.endsWith('…') && p.out[0].t.length * 5 <= 200, JSON.stringify(p.out));
  /* the nation's own name is the sheet's title: on a sheet drawMap names the capital in its place (or leaves the
     label out where the capital's own line names it), and draws only the sites already found */
  const draw = fn('drawMap');
  assert.match(draw, /sheet=!!\(P&&P\.sheet&&x\.me\);if\(sheet&&s\*HEX_R>=14\.5\)continue;/);
  assert.match(draw, /String\(\(sheet\?x\.n\.capital:x\.n\.name\)\|\|''\),lc=sheet\?x\.cap:dcLabelAt\(/, 'the capital’s name stands at the capital');
  assert.match(draw, /drawSites\(g,scr,off,col,s,boxes,kind,!!\(P&&P\.sheet\)\)/);
  assert.match(fn('cpCapLines'), /if\(mini\|\|Rp<14\.5\|\|!q\.length\)return;/, 'the capital’s own line still starts where the label stops');
  assert.match(fn('drawSites'), /else if\(!known\)\{/);
  assert.match(fn('pstMap'), /sheet:true/);
});

test('the inset, the compass and the bar each take a corner, away from the nation where they can', () => {
  const mw = 528, mh = 430, r = 20, grid = (x0, y0, x1, y1) => { const p = []; for (let x = x0; x <= x1; x += 30) for (let y = y0; y <= y1; y += 30) p.push(x, y); return p; };
  /* nothing in the way: the inset bottom right, the compass top right, the bar bottom left */
  assert.deepEqual(P.pstPlace([], r, mw, mh), { inset: 'br', compass: 'tr', bar: 'bl' });
  assert.deepEqual(P.pstPlace(grid(200, 160, 320, 260), r, mw, mh), { inset: 'br', compass: 'tr', bar: 'bl' }, 'a nation in the middle moves nothing');
  /* land in the bottom right corner: the inset goes to the other bottom corner, and the bar to the middle of the
     bottom edge, clear of both */
  const a = P.pstPlace(grid(380, 300, 520, 420), r, mw, mh);
  assert.deepEqual(a, { inset: 'bl', compass: 'tr', bar: 'bc' });
  /* land along the whole right side: the compass crosses over too */
  const b = P.pstPlace(grid(400, 0, 520, 420), r, mw, mh);
  assert.deepEqual(b, { inset: 'bl', compass: 'tl', bar: 'bc' });
  /* land along the whole bottom: everything goes up */
  const c = P.pstPlace(grid(0, 330, 520, 420), r, mw, mh);
  assert.equal(c.inset[0], 't');
  assert.equal(c.compass[0], 't');
  assert.equal(c.bar, 'tc', 'the bar lies between them on the top edge');
  /* a city on the bottom edge, where the bar would lie: the bar moves along (cities weigh more than open land) */
  const city = [100, 400, 100, 414, 72, 420, 128, 420];
  assert.equal(P.pstPlace(city, r, mw, mh).bar, 'bc');
  /* whatever the land: the inset and the compass in two corners, and the bar over neither */
  const rect = { inset: [132, 104], compass: [96, 96] }, box = (k, c) => { const [w, h] = rect[k]; const x0 = c[1] === 'l' ? 0 : mw - w, y0 = c[0] === 't' ? 0 : mh - h; return [x0, y0, x0 + w, y0 + h]; };
  for (const pts of [grid(0, 0, 520, 420), grid(0, 0, 250, 420), grid(0, 300, 520, 420), grid(0, 0, 520, 100), grid(260, 0, 520, 420)]) {
    const q = P.pstPlace(pts, r, mw, mh);
    assert.match(q.inset, /^[tb][lr]$/); assert.match(q.compass, /^[tb][lr]$/); assert.match(q.bar, /^[tb][lcr]$/);
    assert.notEqual(q.inset, q.compass, JSON.stringify(q));
    const x0 = q.bar[1] === 'l' ? 0 : q.bar[1] === 'r' ? mw - 190 : (mw - 190) / 2, y0 = q.bar[0] === 't' ? 0 : mh - 34;
    for (const k of ['inset', 'compass']) { const B = box(k, q[k]); assert.ok(!(B[0] < x0 + 190 && x0 < B[2] && B[1] < y0 + 34 && y0 < B[3]), 'the bar is clear of the ' + k + ': ' + JSON.stringify(q)); }
  }
});
