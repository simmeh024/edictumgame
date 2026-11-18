# Border agreements

Asked by a player on 18 November 2026: "draw some borders to expand to and agree with a neighbouring nation not to claim outside of them". The owner picked ideas 1, 3, 4, 6–14, 16–18.

- **Server**: `functions/borders.js` (civic ops `bdOffer`, `bdAnswer`, `bdEnd`, `bdRenew`, `bdBreach`, `bdSwap`, `bdSwapAnswer`; `bdDrop` on account deletion) and `functions/border-rules.js` (`BD_RULES`, shape checks). Data `borders/{bid}`, readable by everyone (firestore.rules), written only by the server.
- **Game**: the block "border agreements" before "joint ventures" in `game/edictum.html`. `BD_RULES` must match the server's (`test/borders.test.mjs`).
  - Treaties tab › Border agreements: pick 1–3 players, then **Draw the border on the map**.
  - Painter on the main map: a brush per nation, a buffer zone, an eraser, brush sizes, **Suggest a fair split**, and how long it lasts (30 or 90 days, or until ended). Land, lakes and sea can all be painted.
  - Counter-proposal: **Draw it again** sends a new version, which only its sender has accepted.
  - In force: dashed lines on the map (Map layers › Border agreements), free land tinted as a nation's sphere, a hatched buffer, and hover tips.
  - A claim past the line asks first. Claimed anyway, the agreement breaks (`bdBreach`): −10 goodwill with each other side, a happening, a bell note and a record for 30 days. "Spend for me" keeps to your side.
  - Swaps: select a hex of yours, then one of theirs. Once accepted, each game cedes its own hex (`n.bx`, log kind `cede`).
  - Renewal reminder 3 days before an agreement runs out. **Post in the region chat** adds a card (`cd.k` `border`). The Assembly shows a **Register of borders**.
  - Nine achievements, `dip-bd*`.
- **Tests**: `test/borders.test.mjs` (in `test:fx`) and `test/borders-e2e.mjs` (`npm run test:borders`, CI suite `borders`).
