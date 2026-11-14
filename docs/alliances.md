# Alliances and the Diplomacy page

Alliances used to live inside the founder's nation record (`alli` in the founder's record, `allyOf` in each member's).
The founder leaving dissolved the alliance, and nothing else could be shared. They are now a server record of their own.

## Data (written only by `functions/alliances.js`, civic ops `al*`)

| Path | What it holds |
| --- | --- |
| `alliances/{aid}` | `reg, name, mo` (motto), `em` (banner: a flag object), `col` (map colour), `ty` (type), `acc` (who may join), `t`, `fd` (founder), `ld` (leader), `tyAt`, `mem {uid: {t, r?, g}}` (`r: 'o'` = officer, `g` = the nation's generation when it joined), `npc {id: t}`, `iv {uid: t}`, `rq {uid: {t, x}}`, `xp`, `tt` (last tally), `tr` (treasury), `dn {uid: {res…, lt, xd, xq}}`, `pj {project: level}`, `log` (last 40 events). Read by everyone. |
| `alliances/{aid}/chat/{id}` | The members' channel `{a, nm, x, t}`. Only members read it (rules check `mem`). Not called `posts`: every `posts` collection is readable by anyone, so players can find their own posts when deleting their account. |
| `allyOf/{id}` | `{a, reg, t, npc?}`: the alliance a nation (or computer nation) belongs to. The battle referee reads this to decide whose armies help an attack. |
| `alPace/{uid}` | Channel pacing (one message every 8 s, 40 an hour). Server only. |

New fields in the nation record: `alm` (the alliance it belongs to, for the statistics), `alp` (treasury pledges, which
the server credits), `cta` (calls to arms answered) and, in the private half (`NX_KEYS`), `gwl` (why goodwill moved).

## Ops

`alFound, alEdit, alInvite, alUninvite, alRequest, alCancel, alAnswer, alLeave, alRemove, alRole, alDonate, alBuild,
alPost, alPostDel, alTally, alMigrate`. Founding needs a Registered Nation of 7.5 million (the saved `pop`, `AL_FOUND_POP`; the game's `FEATURE_AT.alli`). Joining,
asking, leaving and giving work for guests too.

- **Roles.** The leader edits the charter and gives out roles (at most 5 officers). Officers invite, admit and remove
  plain members. If the leader leaves, or the daily tally finds them away for 7 days, the longest-serving officer (or
  else member) who still plays takes over.
- **Treasury.** A member pledges resources in their own record (`alp`), which takes them from their stock in the same
  save. `alDonate` credits the pledges the saved record holds that are newer than the last one credited, so nothing is
  counted twice and nothing is given that was not taken.
- **Renown.** `alTally` runs at most once every 20 hours, asked by any member's game. It reads the members' records and
  pays renown for each member who played, each trade deal between members, each gift between members, each battle
  fought in an ally's war and each call to arms answered. It also removes members whose nations are gone and computer
  members whose values drifted from the leader's. Joining and giving also earn renown.
- **Places.** An alliance starts with 15 member places (players and computer nations alike), two more for each level of
  renown and two more for each level of the Alliance Hall: at most 39.
- **Projects.** Alliance Hall (places), Shared Granary (growth), Common Market (deal flow and a slot), Joint Fleet (attacks
  across the sea), Arsenal of the Alliance (army), Embassy Row (gift goodwill), and three later ones: Beacon Towers
  (levels 2/4/6: members' land 4% harder to take a level, defending allies count a fifth more a level), Alliance Academy
  (levels 3/5/8: prosperity +1.5% a level) and Hall of Chronicles (levels 2/4/7: the daily tally earns 10% more renown a
  level, `parts.chron` in the tally's log). The game applies the members' effects in `alFx`; the server only the tally's.
- **Rules shared with the game.** `functions/alliance-rules.js` holds levels, places, projects and renown values; the game
  keeps a copy in `AL_RULES`. `test/alliances.test.mjs` fails if they differ.

## Alliances from before

`politics()` in the game still reads the old records. When the founder or any member of an old alliance plays, the game
asks `alMigrate`, which creates `alliances/{founderUid}` from the founder's record (members whose `allyOf` names the
founder and whose invitation is newer than their last departure), with 5 renown per day it has stood (at most 500).
The game then clears `alli`/`allyOf` from its own record. The referee accepts either while a region moves over.

## The Diplomacy page

Five tabs (`AL.tab`, `#diplomacy/<tab>`): Overview, Alliance, Relations, Wars, Gifts. Above them, a strip lists what waits
for the player, each with its own buttons. An alliance's public page is `#alliance/<aid>`. The spy die moved to the
Intelligence page only. Two map lenses were added: Diplomacy and Alliances. The Region page ranks the region's alliances.

## Deploying

Nothing to set up by hand. Merging deploys the changed functions (`civic`, `referee`, `accounts`, `admin`), the rules and
the index overrides (`chat.a` for deleting an account's messages, `chat.x` not indexed). Old alliances move over as
their players come back.

## Tests

`test/alliances.test.mjs` (in `test:fx`), the alliance cases in `test/civic.test.mjs`, `test/rules.test.mjs` and
`test/referee.test.mjs`, and `test/diplomacy-e2e.mjs` (`npm run test:diplomacy`).
