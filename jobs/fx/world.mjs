// The regions and their computer-run nations, read from the game itself (game/edictum.html), so a region
// added to the game needs nothing here: the daily job values its currencies the next day.
//
// The game keeps them as plain data: REGIONS_EXTRA (every region but the first, each with its npcs),
// NPCS_MER (the Meridian Reach's own), NPC_ROOM (the Meridian nations' room to grow; the other regions'
// npcs carry `room`), NPC_POP (computer nations have this share of their founding population) and
// NPC_EPOCH (when their populations started growing). Those slices are evaluated on their own in a
// sandbox; nothing else of the game runs.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const GAME = new URL('../../game/edictum.html', import.meta.url);

function slice(src, start, end, what) {
  const a = src.indexOf(start);
  const b = a < 0 ? -1 : src.indexOf(end, a + start.length);
  if (a < 0 || b < 0) throw new Error(`jobs/fx/world.mjs: cannot find ${what} in the game (looked for "${start}")`);
  return src.slice(a, b);
}
function evaluate(code, name) {
  const ctx = vm.createContext({ Date });
  vm.runInContext(code.replace(new RegExp('^const\\s+' + name + '\\s*='), name + '='), ctx, { timeout: 5000 });
  return ctx[name];
}

export function loadWorld(src = readFileSync(GAME, 'utf8')) {
  const extra = evaluate(slice(src, 'const REGIONS_EXTRA=', 'const REGION_MER=', 'REGIONS_EXTRA'), 'REGIONS_EXTRA');
  const mer = evaluate(slice(src, 'const NPCS_MER = [', '\n];', 'NPCS_MER') + '\n];', 'NPCS_MER');
  const room = evaluate(slice(src, 'const NPC_ROOM=', ';', 'NPC_ROOM'), 'NPC_ROOM');
  const npcPop = Number((/const NPC_POP=([\d.]+);/.exec(src) || [])[1]);
  const ep = /const NPC_EPOCH=Date\.UTC\((\d+),(\d+),(\d+)\)/.exec(src);
  if (!Array.isArray(extra) || !Array.isArray(mer) || !(npcPop > 0) || !ep) throw new Error('jobs/fx/world.mjs: the game\'s regions are not in the expected shape');
  const npc = d => ({ id: d.id, name: d.name, s: d.s, pol: d.pol || [], pop: d.pop, room: d.room || room[d.id] || 1.5 });
  const meridianName = (/const REGION_MER=\{id:'meridian',name:'([^']+)'/.exec(src) || [])[1] || 'Meridian Reach';
  const regions = [{ id: 'meridian', name: meridianName, npcs: mer.map(npc) }]
    .concat(extra.map(r => ({ id: r.id, name: r.name, npcs: (r.npcs || []).map(npc) })));
  return { regions, npcPop, npcEpoch: Date.UTC(+ep[1], +ep[2], +ep[3]) };
}
