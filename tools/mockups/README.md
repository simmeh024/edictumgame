# Mock-ups

Throwaway prototypes, kept out of `game/edictum.html` so a change to generated or drawn content can be looked at
before the game is touched.

- `amb-desk.html` — the design the Ambassador's Desk was built from (25 Nov 2026). Self-contained: open it.
- `render-desk.mjs` — draws every page of the desk **as the game draws it**: the view functions are sliced straight
  out of `game/edictum.html` and run against made-up data, with the built stylesheet. Run `python3 build.py` first,
  then `node tools/mockups/render-desk.mjs tools/mockups/built [dark]`. It keeps only the stylesheet rules the desk
  uses, so a page is small enough to open straight from disk.
- `built/` — what that last run produced. Generated; delete it whenever.

Nothing here is served or tested. `test/ambassador-desk.test.mjs` is the version of this that runs in CI.
