# Mock-ups

Throwaway prototypes, kept out of `game/edictum.html` so a change to generated or drawn content can be looked at
before the game is touched.

- `amb-desk.html` — the design the Ambassador's Desk was built from (25 Nov 2026). Self-contained: open it.
- `render-desk.mjs` — draws every page of the desk **as the game draws it**: the view functions are sliced straight
  out of `game/edictum.html` and run against made-up data, with the built stylesheet. Run `python3 build.py` first,
  then `node tools/mockups/render-desk.mjs tools/mockups/built [dark]`. It keeps only the stylesheet rules the desk
  uses, so a page is small enough to open straight from disk.
- `war-office.html` — a war office view, which gathers the fronts, the state of the army, the reachable hexes ranked by
  the odds, and what the war layer draws, in one place (26 Nov 2026). Self-contained: open it.
- `battle-die.html` — the referee's die in front of the player when an attack is rolled, in four states, with the
  attack's factors as a list (26 Nov 2026). Self-contained: open it.
- `render-war.mjs` — shoots both of those, light and dark, plus the war office at phone width. Run
  `node tools/mockups/render-war.mjs`.
- `built/` — what the last run produced. Generated; delete it whenever.

Nothing here is served or tested. `test/ambassador-desk.test.mjs` is the version of this that runs in CI.
