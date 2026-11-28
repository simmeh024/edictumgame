# Reputation

Added 28 November 2026 (idea 8 of the Diplomacy ideas). Every player's nation has one public reputation label,
judged from its last 30 days using only what every player and the server can see: the region's treaties
(`treaties/`, readable by everyone) and the shared half of the nation's record.

| Label | When (first that fits wins) | Treaty with a computer nation |
|---|---|---|
| Oathbreaker | broke a treaty in the last 30 days | refused for 30 days (as before) |
| Warmonger | declared war 3 times, or twice without making peace | needs 10 more affinity |
| Peacemaker | made peace twice, declared no war | needs 5 less |
| Steadfast Ally | answered 2 calls to arms | needs 5 less |
| Treaty Keeper | 2 treaties in force for 14 days or more | needs 5 less |
| Generous | 6 gifts in 14 days (thanks and treasury pledges count) | needs 5 less |
| Well Connected | 2 open missions abroad (embassies) | needs 5 less |
| Untested | founded less than a week ago | unchanged |
| Isolationist | no treaty, gift, mission, war, call or pledge in 30 days | unchanged |
| Steady | none of the above | unchanged |

Counted from: `treaties/` (live, broken `by` + `bt`, `at`; a previous founding's treaties, `f[id]` ≠ `founded`,
are left out), `log` entries `war` and `peace`, `gft` and `gfr` (gifts and thanks), `alp` (pledges), `cta` (calls
answered) and `ems` (missions at level 1 or more).

## Where

- Diplomacy › Overview: "Your reputation" card, with why and how it changes.
- Diplomacy › Relations: a chip on each player's row (beside its treaties).
- Another nation's page: a Reputation section after Relations (`VL_SECS` key `rep`).
- Diplomacy › Treaties: the forecast for a computer nation adds the same amount.
- Help: "Reputation".

## Code

- `functions/reputation-rules.js`: `repFacts`, `repKey`, `repOf`, the tables. `functions/treaties.js` asks
  `TR_NPC_MIN[k] + REP_NEED[rep]` of the player's own record and its treaties.
- `game/edictum.html`, section "reputation (28 November 2026)" just before "edict works" (it needs `VL_SECS`):
  the same rules between `/* ── rep: the rules ── */` and `/* ── rep: the page ── */`, then the page.
- Tests: `test/reputation.test.mjs` (both copies on every label and 500 random records), a Warmonger case in
  `test/civic.test.mjs`, three checks in `test/diplomacy-e2e.mjs`.
