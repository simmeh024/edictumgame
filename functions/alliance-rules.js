/* The rules of an alliance that the server and the game must agree on: its renown levels, its member places, its
   projects and their costs. game/edictum.html keeps the same tables (AL_RULES, in "alliances rebuilt"), and
   test/alliances.test.mjs checks that the two copies match. */
export const AL_TYPES = ['def', 'trade', 'culture', 'research'];
export const AL_ACCESS = ['open', 'apply', 'invite'];
export const AL_RES = ['food', 'timber', 'iron', 'oil', 'goods'];
/* renown needed for each level: level 1 at 0, level 10 at 7,500 */
export const AL_LEVELS = [0, 100, 250, 500, 900, 1500, 2400, 3600, 5200, 7500];
export const AL_OFFICERS = 5;
/* founding an alliance needs this many million people (the saved pop); the game's FEATURE_AT.alli says the same */
export const AL_FOUND_POP = 7.5;
/* projects: the most levels, the alliance level each one needs, and what each costs from the treasury */
export const AL_PROJECTS = {
  hall: { max: 3, lv: [1, 3, 5], cost: [{ timber: 40, goods: 30 }, { timber: 80, goods: 60 }, { timber: 140, goods: 100 }] },
  granary: { max: 3, lv: [1, 3, 6], cost: [{ food: 60, timber: 20 }, { food: 120, timber: 40 }, { food: 200, timber: 70 }] },
  market: { max: 2, lv: [2, 4], cost: [{ goods: 60, food: 40 }, { goods: 120, food: 80 }] },
  fleet: { max: 2, lv: [2, 5], cost: [{ iron: 50, timber: 40 }, { iron: 100, timber: 80 }] },
  arsenal: { max: 3, lv: [3, 5, 7], cost: [{ iron: 60, oil: 30 }, { iron: 120, oil: 60 }, { iron: 190, oil: 100 }] },
  embassy: { max: 1, lv: [2], cost: [{ goods: 50, timber: 50 }] },
  beacon: { max: 3, lv: [2, 4, 6], cost: [{ timber: 50, iron: 40 }, { timber: 100, iron: 80 }, { timber: 160, iron: 130 }] },
  academy: { max: 3, lv: [3, 5, 8], cost: [{ goods: 70, oil: 30 }, { goods: 140, oil: 60 }, { goods: 220, oil: 100 }] },
  chronicle: { max: 3, lv: [2, 4, 7], cost: [{ goods: 40, food: 50 }, { goods: 90, food: 100 }, { goods: 150, food: 170 }] },
  exchange: { max: 2, lv: [3, 6], cost: [{ goods: 80, food: 40 }, { goods: 160, food: 80 }] },
  theatre: { max: 2, lv: [2, 5], cost: [{ goods: 60, timber: 40 }, { goods: 120, timber: 80 }] },
  observatory: { max: 2, lv: [2, 5], cost: [{ goods: 60, iron: 40 }, { goods: 120, iron: 80 }] },
  cipher: { max: 1, lv: [4], cost: [{ goods: 90, oil: 50 }] }
};
/* the type of alliance each project belongs to ('' for every type): one built by an alliance of another type (built
   before its type changed) stays built, and works again if the type comes back */
export const AL_TY_PJ = { hall: '', chronicle: '', arsenal: 'def', beacon: 'def', fleet: 'def', market: 'trade', granary: 'trade', exchange: 'trade',
  embassy: 'culture', theatre: 'culture', academy: 'research', observatory: 'research', cipher: 'research' };
/* seats: a nation belongs to at most one alliance of each type, and to as many alliances as its people allow: the
   first at any size, the second at 10 million, the third at 25 and the fourth at 50 (the saved pop) */
export const AL_SEAT_POP = [0, 10, 25, 50];
export const alSeats = pop => AL_SEAT_POP.filter(p => (Number(pop) || 0) >= p - 1e-6).length;
/* an alliance that takes a type some members already hold elsewhere: each of them leaves one of the two within a
   week (the seat stays with the alliance they were in first), or leaves the one that changed. A type changes at most
   once a week, by the members' vote over two days (at once in an alliance of one player). */
export const AL_CLASH = 7 * 86400000, AL_VOTE = 2 * 86400000, AL_TYPE_WAIT = 7 * 86400000;
/* renown each type earns its own way: its kind of shared activity counts this many times over in the daily tally */
export const AL_XP_TY = { def: { battle: 2, call: 2 }, trade: { deal: 2 }, culture: { gift: 2 }, research: { active: 2 } };
/* a research accord's joint studies: paid from the treasury, one at a time, for AL_STUDY_DAYS (two more for each
   level of the Joint Observatory); each earns the accord AL_XP.study renown when it starts */
export const AL_STUDIES = {
  agri: { cost: { food: 120, goods: 40 } }, eng: { cost: { goods: 100, timber: 60 } }, war: { cost: { iron: 90, oil: 40 } },
  logi: { cost: { goods: 80, food: 60 } }, crypt: { cost: { goods: 70, oil: 50 } }
};
export const AL_STUDY_DAYS = 7;
export const alLevel = xp => { let l = 1; for (let i = 0; i < AL_LEVELS.length; i++) if ((xp || 0) >= AL_LEVELS[i]) l = i + 1; return l; };
/* member places: 15 at level 1, two more a level, two more for each level of the Alliance Hall (computer members count) */
export const AL_PLACES = 15;
export const alPlaces = (xp, pj) => AL_PLACES + 2 * (alLevel(xp) - 1) + 2 * Math.max(0, Math.min(3, (pj && pj.hall) || 0));
/* renown: what each kind of shared activity earns in the daily tally, and its cap per member; chron is the share more
   the daily tally earns for each level of the Hall of Chronicles */
export const AL_XP = { active: 3, deal: 2, gift: 2, giftCap: 5, battle: 5, battleCap: 10, call: 5, callCap: 3, join: 10, donatePer: 10, donateDay: 50, chron: 0.1, rival: 4, rivalCap: 10, pactBreak: 100, study: 20 };
/* relations between alliances (rel {aid: …} on each): pacts both leaders sign, and rivalries one leader names. rival is
   the renown each battle against a rival's member earns in the daily tally (rivalCap a member), pactBreak what breaking
   a pact at once costs; a pact ends otherwise with AL_REL_NOTICE. At most AL_REL_MAX pacts (in force or offered) and
   rivals named by an alliance. */
export const AL_REL_MAX = { pact: 4, rival: 2 };
export const AL_REL_NOTICE = 3 * 86400000;
/* a pact in force: signed and not ended (a notice runs until end) */
export const alRelLive = (r, now) => !!r && r.k === 'pact' && (r.st === 'active' || (r.st === 'ending' && now < (Number(r.end) || 0)));
export const AL_ALLY_MIN = 65;
