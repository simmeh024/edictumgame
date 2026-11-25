// Alliance cooperation on a copy of the player's nation (game/edictum.html, rsIntl and rsDisc): both read the player's
// alliances from the nation's identity, and the game works on a clone of the nation in rsResearch and in every commit
// hook. A clone is in no index, so alIdOf gave it no id and the nation silently lost every alliance discount and the
// whole cooperation share of its Research Credits: the cost check then refused a technology at its undiscounted price,
// which is not the price the card shows. A copy is recognised by islMine, as rsLabHeld already did.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const src = readFileSync(new URL('../game/edictum.html', import.meta.url), 'utf8');
function fn(name) {
  const at = src.indexOf('\nfunction ' + name + '(');
  assert.ok(at >= 0, name + ' is found');
  let i = src.indexOf('{', at), depth = 0;
  for (; i < src.length; i++) { const ch = src[i]; if (ch === '{') depth++; else if (ch === '}' && --depth === 0) break; }
  return src.slice(at + 1, i + 1);
}
const line = start => {
  const l = src.split('\n').find(l => l.startsWith(start));
  assert.ok(l, `source has a line starting ${start}`); return l;
};

/* one research accord the player belongs to: Research Credits +5%, and 5% off every track */
const ME = 'me-1';
const ACCORD = { srv: true, name: 'Meridian Research Institute', members: [ME], doc: { ty: 'research', pj: {}, mem: {} } };

function load() {
  const nation = { name: 'Selenia', founded: 1000, nrp: { i: 1, ra: 1, re: 20, rs: 0, k: '', q: [] }, s: { sci: 0 } };
  const ctx = {
    S: { nation, world: {} }, Date, Math, JSON, RS_RULES: { intlMax: 0.3, discMax: 0.3 },
    RS: [{ n: 'Basic Military Training', k: 0, t: 1, h: 0, cost: 10, fx: {}, ico: 'sword' }],
    RS_TRACKS: [{ n: 'War', k: 'w', al: 'def' }], AL_TYPES: { research: { n: 'Research accord' } },
    AL_RULES: { tyPj: {} }, AL_STUDY_RS: {}, AL_STUDY_UI: {},
    myId: () => ME, alIdOf: () => '', alliancesOf: id => id === ME ? [ACCORD] : [],
    clamp: (v, a, b) => Math.max(a, Math.min(b, v)), num0: v => +v || 0,
    rsProjOf: () => null, rsLicFor: () => null, tyResearchN: () => 0, pol: () => ({}),
    rsOf: n => n && n.nrp || null, rsIsIntel: () => false, rsIsFin: () => false, rsIsAgri: () => false,
    rsIsSoc: () => false, rsIsMilEng: () => false, rsIsNaval: () => false, rsIsDef: () => false, rsIsSpace: () => false,
    clone: v => JSON.parse(JSON.stringify(v)),
  };
  vm.createContext(ctx);
  vm.runInContext(`${line('function islMine(')}\n${fn('rsIntl')}\n${fn('rsDisc')}\nvar rsPrice=(n,i,now)=>Math.max(1,Math.round(RS[i].cost*(1-rsDisc(n,i,now).v)));`, ctx);
  return ctx;
}

test('a copy of the player’s nation keeps the alliance discount on a technology', () => {
  const G = load(), now = Date.now(), copy = G.clone(G.S.nation);
  assert.equal(G.rsDisc(G.S.nation, 0, now).v, 0.05, 'the nation itself gets the accord’s 5%');
  assert.equal(G.rsDisc(copy, 0, now).v, 0.05, 'and so does a copy of it');
  assert.equal(G.rsPrice(copy, 0, now), G.rsPrice(G.S.nation, 0, now), 'the price a copy is charged is the price the card shows');
});

test('a copy of the player’s nation keeps the cooperation share of its Research Credits', () => {
  const G = load(), now = Date.now(), copy = G.clone(G.S.nation);
  assert.equal(G.rsIntl(G.S.nation, now).v, 0.05);
  assert.equal(G.rsIntl(copy, now).v, 0.05, 'a commit works on a copy, and must count cooperation the same');
});

test('another player’s nation is still read from its own record, and an NPC gets nothing', () => {
  const G = load(), now = Date.now();
  const other = { name: 'Valoria', founded: 2000, nrp: { i: 1 }, s: {} };
  assert.equal(G.rsIntl(other, now).v, 0, 'a nation with no id of its own gets no share');
  assert.equal(G.rsDisc(other, 0, now).v, 0, 'nor a discount');
  assert.equal(G.rsIntl({ npc: true, name: 'Selenia', founded: 1000, nrp: { i: 1 } }, now).v, 0, 'an NPC gets none');
});
