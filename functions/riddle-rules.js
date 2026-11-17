/* The rules of the riddle of the week that the server (functions/riddles.js), the weekly job (jobs/fx/riddle.mjs) and
   the game must agree on. game/edictum.html keeps the same table (RD_RULES), and test/riddle.test.mjs checks that the
   copies match.

   Every week, from Monday 08:00 UTC (the week the weekly letters keep: the game's weekStart), each region has one
   riddle, riddles/{region}_{yyyymmdd} (the Monday it began), written by the job: a few lines that point at one hex of
   the region's map, counted from the capital of one of its computer nations. The hex itself is kept apart, in
   riddleKeys/{same id}, which no player can read; the job copies it into the riddle once the week is over (a).
     riddles/{id}       {reg, wk, t (opens), x (closes), q: [lines], n (solved by), top: [{u, nm, t}] (the first RD_TOP),
                         tu: [their uids], a (the answer, once the week is over), v}
     riddleKeys/{id}    {c (the hex), t}
     riddles/{id}/guesses/{uid}  {u, g: [hexes guessed], ok (solved at, 0 until then), r (its place), t}
   A nation of the region guesses with a click on the map: RD_TRIES guesses a week, the same hex twice counts once. */
export const RD_TRIES = 3, RD_TOP = 10;
export const RD_WEEK = 7 * 86400000;
/* a riddle's id: the region's, then the Monday its week began */
export const RD_ID = /^[a-z0-9-]{1,40}_\d{8}$/;
/* the week a moment belongs to begins on the Monday before it at 08:00 UTC (as the game's weekStart) */
export const rdWeek = t => { const d = new Date(t), w = (d.getUTCDay() + 6) % 7, s = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - w, 8); return s > t ? s - RD_WEEK : s; };
export const rdId = (reg, t) => { const d = new Date(rdWeek(t)); return reg + '_' + d.getUTCFullYear() + String(d.getUTCMonth() + 1).padStart(2, '0') + String(d.getUTCDate()).padStart(2, '0'); };
/* the eight directions a riddle may name, anticlockwise from east, as the job and the players read the map (north up) */
export const RD_DIRS = ['east', 'north-east', 'north', 'north-west', 'west', 'south-west', 'south', 'south-east'];
