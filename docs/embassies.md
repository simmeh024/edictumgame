# Embassies

Added 28 November 2026. A player opens a mission in another nation of its region (a player or a computer nation it is
at peace with) on the Diplomacy page's **Embassies** tab, and raises it through three levels. Each level is built the
way the Research Lab's laboratory is: in stages, each stage paid for in materials from the stock (in parts, as they
come), then built in hours that pass on their own (`emAdvance`, run by a commit hook and a 5-second timer).

| Level | Stages | Hours | Materials in all | Goodwill a day / ceiling | War seen ahead | Other |
|---|---|---|---|---|---|---|
| Outpost | 3 | 10 | 45 food, 35 timber, 60 goods | +1 / +8 | 6 h | warns at a player's record ≤ −15 |
| Foreign Office | 4 | 30 | 70 food, 105 timber, 75 iron, 10 oil, 190 goods | +2 / +16 | 12 h | army measured, warning at +25%; record ≤ −8; gifts +1 (to +18) |
| Embassy | 5 | 60 | 290 food, 260 timber, 180 iron, 50 oil, 530 goods | +3 / +24 | 24 h | army warning at +10%; record ≤ −3; gifts +2 (to +21) |

A player you keep a mission with who keeps one with you adds a goodwill a day more (`emRecip`). Places grow with the
nation's people: 1 at any size, 2 at 5 million, 3 at 15, 4 at 30, 5 at 50 (`EM_SEATS`).

## War warnings

Computer nations declare war in six-hourly rolls (`npcWarTick`) that are known in advance: each slot's time and roll
come from the player's seed. The chance of one roll is `npcWarP`, shared by the roll and by the forecast
(`emWarCast`), so the warning says exactly when the declaration will come if nothing changes. It says whether
goodwill of −5 or better would stop it, and a non-aggression pact always does. Warnings show in the tab's cables,
in **Waiting for you** and on the bell (`NOTIF_SOURCES`, label "Embassies").

## The record (the shared half)

- `n.ems = {<host id>: {l, s, g, u, us, o, dt, ap, apt}}`: levels finished (0–3), stages finished of the next level,
  materials given to the stage in progress, when its works end and began, opened, goodwill counted to, and the host's
  army as last measured (Foreign Office and up, every two days).
- `n.emh`: the highest level reached (keeps the unlocks when a mission closes); `n.em3`: the most Embassies at once.
- `n.emx = {<opener id>: when}`: missions this nation has expelled. Expelling costs the host 5 goodwill with the
  opener (`EM_EXPEL_GW`); the opener's mission does nothing until it is let back.

None of it is checked by the server, like goodwill and gifts. A war with the host closes a mission until peace.

## Unlocks (kept for good, `EM_UNL`)

- Outpost: Outpost Notepaper, Outpost Wax, the Envoy.
- Foreign Office: Foreign Office Minute, Foreign Office Seal, By Order of the Minister (signature), Noted by the
  Foreign Office (decree stamp).
- Embassy: Ambassador's Letterhead, Embassy Crest, The Ambassador's Compliments (signature), Diplomatic Pouch
  (postage stamp), Embassy Row (card), the Ambassador.
- Three Embassies at once: Corps Diplomatique (paper), the Doyen.

Honours: A Flag Abroad, Chancery Hours, Credentials Presented, Corps Diplomatique (`dip-emb*`).

## Tests

`test/embassies.test.mjs` (in `test:fx`): the tables, stages and levels, goodwill, gifts, and the forecast checked
against `npcWarTick` itself. `test/diplomacy-e2e.mjs`: an outpost in another player's nation from the stock, its
stages finishing on their own, a day's goodwill, the host's list, expelling and letting back.
