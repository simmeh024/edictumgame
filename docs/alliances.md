# Alliances and the Diplomacy page

Alliances used to live inside the founder's nation record (`alli` in the founder's record, `allyOf` in each member's).
The founder leaving dissolved the alliance, and nothing else could be shared. They are now a server record of their own.

## Data (written only by `functions/alliances.js`, civic ops `al*`)

| Path | What it holds |
| --- | --- |
| `alliances/{aid}` | `reg, name, mo` (motto), `em` (banner: a flag object), `col` (map colour), `ty` (type), `acc` (who may join), `t`, `fd` (founder), `ld` (leader), `tyAt`, `mem {uid: {t, r?, g}}` (`r: 'o'` = officer, `g` = the nation's generation when it joined), `npc {id: t}`, `iv {uid: t}`, `rq {uid: {t, x}}`, `xp`, `tt` (last tally), `tr` (treasury), `dn {uid: {res…, lt, xd, xq}}`, `pj {project: level}`, `log` (last 40 events), `cl {uid: until}` (members in a clash), `tv` (a vote on a new type `{ty, t, end, by, y, n}`), `sd` (a research accord's study `{k, t, end, by}`), `ct` (a trade bloc's common tariff). Read by everyone. |
| `alliances/{aid}/chat/{id}` | The members' channel `{a, nm, x, t}`. Only members read it (rules check `mem`). Not called `posts`: every `posts` collection is readable by anyone, so players can find their own posts when deleting their account. |
| `allyOf/{id}` | `{v: 2, reg, t, s {ty: aid}, w {ty: [aid]}, a, npc?}`: the alliances a nation (or computer nation) belongs to, one of each type (`s`), those waiting for a seat it already holds (`w`, a clash), and the one whose code it wears in chat and on the board (`a`). The battle referee reads the defence pact's seat (`s.def`, else the first waiting) to decide whose armies help an attack, and every seat for a pact between alliances. An entry from before (no `v`) names one alliance in `a`, whose type is read from the alliance; the daily tally rewrites it in the new shape. |
| `alPace/{uid}` | Channel pacing (one message every 8 s, 40 an hour). Server only. |

New fields in the nation record: `alm` (the alliance whose code it wears, for the statistics), `alw` (the alliance
whose code it wears in chat, chosen by the player), `alg` (`{to, t}`: the ally in its defence pact it stands guard
for), `alp` (treasury pledges, which the server credits), `cta` (calls to arms answered) and, in the private half
(`NX_KEYS`), `gwl` (why goodwill moved).

## Ops

`alFound, alEdit, alInvite, alUninvite, alRequest, alCancel, alAnswer, alLeave, alRemove, alRole, alDonate, alBuild,
alPost, alPostDel, alTally, alMigrate, alVote, alWear, alStudy` (and the relations: `alPact, alPactAnswer, alPactEnd, alRival`). Founding needs a Registered Nation of 7.5 million (the saved `pop`, `AL_FOUND_POP`; the game's `FEATURE_AT.alli`). Joining,
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

## Alliance types (21 November 2026)

Asked by the owner: four alliances at once, one of each type, a clear mark for each, a member holding two of one type
after a leader changes it asked to leave one, and each type to feel and look different. All 22 ideas were built.

- **Seats.** A nation belongs to at most one alliance of each type (`def`, `trade`, `culture`, `research`), and to as
  many as its people allow (`AL_SEAT_POP`: any size, 10, 25 and 50 million, the saved `pop`). `alFound`, `alRequest`,
  `alAnswer` and `alInvite` refuse a second of a type (`al_member`, `al_taken`) and one more than the people allow
  (`al_seats`; `alAnswer` returns `why: 'seats'`).
- **Only defence pacts fight together.** The referee counts the defence pact's members as allies in a battle, and the
  game's `allianceOf`, `alliesOf` and `sameAlliance` (every war sum) are the defence pact. A pact between two alliances
  of any type still bars war between their members (the referee checks every alliance of each side).
- **Bonuses by type.** Each alliance gives its own type's bonus, and only the projects of its type work (`AL_TY_PJ`: Hall
  and Chronicles for every type; Arsenal, Beacons and Fleet for a defence pact; Market, Granary and the new Bloc
  Exchange for a trade bloc; Embassy Row and the new Grand Theatre for a cultural union; Academy, the new Joint
  Observatory and Cipher Office for a research accord). `alBuild` refuses another type's (`al_pj_type`); one built
  before the type changed stays and works again if the type returns. `alFx` sums every alliance a nation holds.
- **Changing the type.** `alEdit {ty}` changes it at once in an alliance of one player, else opens a vote (`tv`, two
  days, `alVote {yes}`): it passes once more than half the members say yes, is lost once half say no, and otherwise is
  decided when it closes (by `alVote` from any member's game, or the tally). The type changes at most once a week.
- **Clashes.** When an alliance takes a type a member already holds elsewhere, the seat stays with the first and the
  member waits in the second (`cl`, `w`) for a week: it leaves one of the two (Diplomacy's strip, the bell and the
  Alliance tab say so), and the tally takes it out of the one that changed when the week is up. A computer member
  leaves at once.
- **Each type its own way.** A defence pact: calls to arms, a war room with every member's army and readiness, and
  standing guard for an ally (`alg`, +8% defence for each guard, up to three, in `BATTLE_MODS`). A trade bloc: no
  tariffs and more flow between members, fellow members first on the Trade page, a common tariff on outsiders (`ct`,
  `alEdit {ct}`: members count as having Import Tariffs for outside goods, +2% prosperity) and a market ledger. A
  cultural union: a festival every month's first week, hosted by each player member in turn (host +4% prosperity and
  +3% growth, others +1% prosperity; the Grand Theatre half as much again a level). A research accord: joint studies
  from the treasury (`alStudy`, one at a time, 7 days plus 2 a level of the Observatory, 20 renown) and spy reports
  shared into its channel from the Bureau.
- **Renown by type** (`AL_XP_TY`): battles and calls count twice in a defence pact, deals in a trade bloc, gifts in a
  cultural union, members who play in a research accord.
- **Marks and looks.** Each type has a mark and colour (`AL_TY_UI`: a red shield, gold scales, a purple laurel, a teal
  flask) and its titles (Marshal and Commander, Steward and Factor, Patron and Curator, Chancellor and Fellow). The
  Alliance tab has four type tabs; each alliance's pages carry its type's look (steel band, ledger rules, ornate frame,
  blueprint grid). The nation card shows four slots. Chat and the board show the code of the alliance the player
  wears (`alWear`, `n.alw`), with its type's mark (`al.y` on world chat lines and board profiles). Map layers draw
  each type its own way (defence outlines, trade routes, a culture wash, a research network). The Region page ranks
  alliances by type, and the admin Alliances page filters by type.
- **From before.** Existing alliances keep their type and members; the computer alliances are defence pacts.

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

`test/alliances.test.mjs` (in `test:fx`), the alliance cases in `test/civic.test.mjs` (alliance types: seats, votes,
clashes, wearing, studies, project types), `test/rules.test.mjs` and `test/referee.test.mjs` (only a defence pact
helps in battle), `test/diplomacy-e2e.mjs` (`npm run test:diplomacy`) and `test/alliance-types-e2e.mjs`
(`npm run test:alliance-types`).
