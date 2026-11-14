# Treaties, and relations between alliances

Two additions to the Diplomacy page (13 November 2026): treaties between two nations, on a Treaties tab of their own,
and relations between alliances, on the Alliance tab's Relations.

## Treaties between two nations

Kept by the server in `treaties/{k}_{lo}_{hi}` (one of each kind between the same two nations), written only by
`functions/treaties.js` (civic ops `trOffer`, `trAnswer`, `trCancel`, `trEnd`). The rules are in
`functions/treaty-rules.js`; the game keeps a copy in `TY_RULES`, and `test/treaties.test.mjs` fails if they differ.

| Kind | What it does | At most |
| --- | --- | --- |
| Non-aggression pact (`nap`) | Neither side may declare war on the other, or on an alliance the other belongs to. A computer nation under one never attacks. The referee refuses any battle between the two while it stands. | 8 |
| Trade agreement (`trade`) | Deals between the two flow 10% more and pay no import tariffs. | 3 |
| Research pact (`research`) | Prosperity +1% for each side, for each pact (three count at most). | 3 |

- **Signing.** A Registered Nation offers one. A player accepts or declines it from the waiting strip or the Treaties
  tab; offering what the other side already offered signs it. A computer nation answers at once by its affinity with
  the player: 35 for a non-aggression pact, 50 for a trade agreement, 60 for a research pact. It never signs while at
  war, nor with a nation that broke a treaty in the last 30 days.
- **Ending.** Either side ends one with 3 days' notice (it stays in force until then), or breaks it at once. A broken
  treaty stays on the breaker's record for 30 days (Treaties tab, and the nation's page), and the two cannot sign the
  same kind again for 7 days. The breaker loses 15 goodwill with the other side and 5 with every computer nation and
  every nation it already has a record with (the game, `tyPenalty`; the goodwill reasons say "You broke a treaty").
- **A nation founded again** (dissolved, restarted) is not bound by its old treaties: each treaty keeps the `founded`
  time of each player's nation as it signed (`f`), and the server, the referee and the game ignore one that no longer
  matches. A deleted account's treaties are deleted (`trDrop`, in `accounts.js` and `admin.js`).

## Relations between alliances

Kept in each alliance's record as `rel {aid: …}`, written only by `functions/alliances.js` (civic ops `alPact`,
`alPactAnswer`, `alPactEnd`, `alRival`); only the leader acts.

- **A pact.** One leader offers it (`{k:'pact', st:'offered'}` on that side, `st:'asked'` on the other), the other's
  leader accepts it. While it stands, no member of either alliance may attack a member of the other: the game refuses
  the declaration and the referee the battle. It ends with 3 days' notice, or at once at a cost of 100 renown to the
  alliance that broke it. At most 4 pacts, in force or offered.
- **A rivalry.** One leader names another alliance (`me` on that side, `them` on the other); the other may name it
  back. In the daily tally, each battle a member won against a member of a rival alliance earns 4 renown (up to 10
  battles a member). At most 2 rivals named. A pact and a rivalry between the same two cannot stand together.
- Shown on the Alliance tab's Relations, in the Region's ranking (a Pact or Rival chip beside other alliances) and on an
  alliance's public page.

## Tests

`test/treaties.test.mjs` (in `test:fx`), the treaty and pact cases in `test/civic.test.mjs`, `test/referee.test.mjs` and
`test/rules.test.mjs`, the Treaties part of `test/diplomacy-e2e.mjs`, and `test/alliance-relations-e2e.mjs`
(`npm run test:alliance-relations`).

## Deploying

Nothing to set up by hand. Merging deploys the `civic`, `referee`, `accounts` and `admin` functions, the rules (the
`treaties` collection is readable by everyone) and the site. Single-field indexes cover the two queries (`reg ==` and
`p array-contains`).
