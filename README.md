# Edictum

Edictum is a multiplayer nation simulator in a single web page. Players found a nation, rule on
the edicts that land on their desk, claim land on a hex map of their region, build cities, trade,
form alliances, spy, go to war, vote in a regional assembly and, in the end, head for the Moon and
Mars. Every nation is run by a player or by the computer, and players in a region share one map
and one message board.

The game was first written as a claude.ai artifact. That version was retired in October 2026: the
game now lives here, at <https://edictumgame.com>, with Firebase: **Hosting** serves the page,
**Authentication** gives every visitor an account (a guest account at once, linked to Google if they
like), and **Firestore** holds the shared world.

## How it fits together

| Path | What it is |
| --- | --- |
| `game/edictum.html` | The game. It grew out of the claude.ai version (Version 26) and is now developed here; the build never edits it. |
| `src/stub.js` | A few lines put at the top of the page: `window.claude.use()`, which the game calls, waits until Firebase is ready. |
| `src/shim.js`, `src/shim.css` | The Firebase layer behind `window.claude.use('db' / 'user')`: documents, queries, counts, batched nation saves and board posts (see Data). Also the account control. |
| `src/favicon.svg`, `src/og.png`, `src/apple-touch-icon.png` | The seal icon and the picture shown when a link is shared (`src/og.html` is its source; `tools/make-images.mjs` redraws the PNGs). |
| `build.py` | Builds `public/`: a small page (stub, Firebase SDK, shim, meta tags, schema.org data, and the top of the front page as plain HTML) plus the game's script and styles minified into `/assets/game.<hash>.js` and `/assets/app.<hash>.css`, and the fonts in `/assets/fonts/`. Their names change with their content, so browsers keep them for a year. |
| `firestore.rules`, `firestore.indexes.json` | Who may read and write what. |
| `functions/` | The referee: one Cloud Function (`referee`, in `europe-west1`) that rolls battles on the server, keeps each army's readiness and seals every victory (see Fair play). |
| `firebase.json`, `.firebaserc` | Hosting (cache headers, clean URLs), Firestore and the local emulators. `.firebaserc` names the live project, `edictum-b30de` (served at <https://edictumgame.com>); the workflows pass the id explicitly from the `FIREBASE_PROJECT_ID` variable, and the emulator scripts use `demo-edictum`. |
| `.github/workflows/` | `deploy.yml` deploys on every push to `main`; `preview.yml` tests the rules and deploys a preview of each pull request to the staging project; `currency.yml` runs the daily currency job. |
| `jobs/fx/` | The daily currency job: every currency's exchange value and Currency Prestige, from the nations' records (Firebase Admin SDK, its own `package.json`). See Currencies below. |
| `test/` | Rules tests, end-to-end tests and a smoke test, all on the Firebase emulators, and the currency engine's tests. |
| `tools/admin/` | A one-off script that makes a player an admin. |

**Data.** Documents are named by the player's Firebase user id:

- `nations/<uid>`: `{v: 1, j: "<the nation as JSON text>", reg, name, updatedAt, ts, pop, army, cl, rev}`,
  the shared half of the nation record: what other players in the region see. It is stored as text
  because it contains lists of lists, which Firestore cannot store. `reg`, `name` and `updatedAt` are
  copies kept beside it for queries; `ts` is the server's time of the save; `pop`, `army` and `cl`
  (population, army strength, land claimed) are headline numbers the rules bound (see Fair play).
- `stamps/<reg>/<c<cell>|s<site>>/<uid>`: `{t}`, the server's time a save first carried a claim on a
  hex or a site found, which settles races between nations.
- `nationx/<uid>`: `{j, t, ts}`, the private half: the edict engine, notices seen, tallies,
  intelligence, lore and the passport's stamps (the key list is `NX_KEYS` in `src/shim.js`). Nobody
  listens to it; the game reads it with the shared half for the player's own nation, and another
  player's when one of that nation's pages (its page, museum, achievements, statistics or passport)
  is open. It is rewritten only when it changed.
- `summaries/<uid>`: `{reg, name, pop, t, e?}`, the nation's headline, for the World page and the
  player counts per region. `e`, after a save with a holiday ahead, is the time the nation counts as
  active until (at most 32 days past `t`); a region's active count is those saved within 250 days
  plus those saved earlier whose `e` is still within them.
- `staff/<uid>`: `{t}`, this player is Edictum staff (an admin). Only the admin can write their own,
  and their page clears it once the right is gone.
- `space/<uid>`: `{reg, name, t, j, ts}`, the nation's Moon, Mars and asteroid belt data, only for
  nations that have any. Those are shared by every region, so every player reads them.
- `boards/<region>/posts/<id>`: `{a: <author uid>, t, x}`, one post on a region's message board;
  `limits/<uid>` `{p}` paces each player's posting.
- `reports/<id>`: a player's report of another player's post or nation (a ticket in the admin
  portal), with a copy of what was reported; `rlimits/<uid>` `{r}` paces reporting. Only admins
  read them.
- `support/<id>`: a player's support ticket (topic, text, nation, optional email) and, once an admin
  closes it, the answer and an expiry `exp`. A Firestore time-to-live policy on `exp` deletes closed
  tickets 90 days later. The policy is set once per project (Firebase console, Firestore,
  Time-to-live: collection group `support`, timestamp field `exp`). It needs billing, so the staging
  project goes without; `firestore.indexes.json` only takes `exp` out of indexing, and deploys leave
  the policy alone. The player and admins read the tickets; `slimits/<uid>` `{s}` paces them to one
  a minute.
- `mod/<uid>`: a moderator hid a nation from the other players, or removed it (so its owner's
  browser drops its copy). Everyone reads these. `bans/<uid>`: a banned account; it may save no
  nation, post or report. The player and admins read it.
- `armies/<uid>`: `{r, at, n, w, last}`, the referee's count of an army's readiness, and its battles
  fought and won; `armies/<uid>/log/<id>` `{d, c, p, pe, cap, roll, win, t}` keeps each battle (the
  nation attacked, the hex, the odds the attacker's game gave and the odds used, the roll). Only the
  referee writes them; the player and admins read them. Deleting an account clears them.
- `referee/pub`: `{k, at}`, the public half of the referee's signing key, which every game reads to
  check seals; `referee/key` holds the private half, which nobody but the referee reads. The referee
  makes the pair on its first battle in each project.
- `fx/<region>`: `{v, day, t, j}`, the region's currencies as the Foreign Exchange Bureau published them
  that day (JSON text: each currency's value in the region's standard unit, strength, prestige, tier,
  rank, 1/7/30-day changes, factor scores, why it moved, recent milestones). `fxh/<nation id>`:
  `{reg, t, d: {'YYYY-MM-DD': [value, prestige]}}`, one currency's whole daily history. `fxs/<region>`:
  the currency job's own state (smoothing, volatility, 91 days of values, a lease); only admins read it.
  Everyone reads the first two; nobody but the job writes any of them (see Currencies).

A nation save writes the shared half, its summary and (when they changed) the private half and the
space record in one transaction. Each save advances a server-checked `rev`; the client keeps its base
as `_rev` in its local copy. A stale device cannot overwrite a newer revision, even when its clock is
ahead. Full own-nation reads join the shared and private halves in a server transaction. Returning to
the tab or reconnecting refreshes the nation or retries a pending save. Conflicts load the latest save
and explain that unsaved changes must be repeated; a copy of those changes is kept locally and can be
downloaded from the account menu. Existing unrevisioned nations migrate on their first new-client save;
a browser running the old game must reload once the nation has a revision. Transactions require a
connection: offline changes stay in the local copy until they can be checked against the server.
Anyone may read the world; each player writes only their own documents; admins may also delete any
post. The rules also check that a save's documents agree, and pace writes: a nation at most once a
second, a space record once every 10 seconds, a post once every 20. See `firestore.rules`.

**What each player downloads.** Only their own region: the shared halves of its nations, its
board's latest 60 posts, plus every region's space records. Other regions are counted (one cheap count
per region) and listed by name from `summaries/` only when the World page asks. The game sends its
saves to Firestore at most once a minute (within two seconds for what another player waits for: a
message, an offer, a declaration, a vote, a bid, a claim; at once when the tab is hidden or closed;
the browser's own copy is saved straight away), because every save is read by every other player in
the region.

**Regions fill up.** A region takes no new nations once 250 active nations live there (dormant ones,
unsaved for 250 days, not counting a holiday, do not count). A newcomer who has not chosen a region and lands in a full one
is sent to the fullest region that still has room, so players gather rather than spread thin. The
cap is `REGION_CAP` in the game. Each region's map is sized for that: its grid gives about 30,000
land hexes (`REGION_LAND`; some 120 per player besides the computer nations), so a watery region has
a larger grid than a continental one. Founding switches region by reloading the page; what the player
filled in is kept (in the tab's session storage) until the nation is founded.

**Adding a region.** When the regions fill, add more rather than enlarging these: a new entry in
`REGIONS_EXTRA` in the game (name, description, `geo`, lands, computer nations, alliances) and its id
in the `region()` list in `firestore.rules`. The map, its size and the player counts follow from that.

**Moderation.** Players report a nation (its page) or a post (the region board), choosing a reason
and adding a note; one report every 30 seconds. Each report is a ticket in the admin portal's queue,
where an admin can remove the post, hide the nation (it leaves everyone else's view; its owner is
told why and can still play), remove the nation (it and its posts are deleted; the player may found
a new one), ban the player (the nation is removed and the account can no longer save, post or
report), or simply close the ticket. Hidden nations and banned players are listed in the portal
with Unhide and Unban. A banned guest can come back by clearing their browser; a Google account
cannot.

**Edicts.** Edicts go before the nation's government, which follows its type of state: the Senate of
a republic ("By decree of the Senate and People of …"), a monarch's Privy Council (royal decrees), an
emperor's council (imperial edicts), a sultan's Divan (firmans), a Holy Synod, a People's Congress, a
governor's council or a borough council. Decrees also name the nation's own leader (Settings: the
title, and the name if one is given): a ruler signs alone ("By imperial edict of President Ada Brook
of …"), an assembly with the leader ("By decree of President Ada Brook, with the Senate and People of
…"). The Customise page's Decrees section chooses the leader by name (the default), by title only, or
the type of state's own wording ("the Emperor", "the Crown"); it is kept as `cz.ds`. Numbers and years
are Roman (Edictum MCCLI, Anno IV, counted from the founding); the decision stamp defaults to a purple
wax seal of state whose inscription follows the government (SPQ, REX, IMP and so on). The other stamps
are in the same section of the Customise page.

**National symbols.** The Customise page's National symbols: the holiday and its date are open from the
start; the flower opens at 5.5 million people, the tree at 6, the bird at 7, the instrument at 8, the
colours at 10 and the capital's nickname at 20 million (`SYM_AT`). Each opens once, on the first save
after the population reaches it, with a notice (a toast and the bell, from the College of Arms) and
5 timber and 5 iron; `n.syu` keeps the ones given, so a nation that shrinks keeps them, and a symbol
chosen before it had a threshold stays open.

**The pace of edicts, and holiday mode.** In Settings a player chooses how often a new edict arrives:
every 30 minutes (the default), hour, 4, 8 or 12 hours, or once a day (`FREQS`; a nation saved at a
pace no longer offered loads at 30 minutes). Holiday mode, also in Settings, stops new edicts until a
date and time the player chooses, at most a calendar month ahead (`n.away`, `{a, b}`). The edict clock
skips the holiday, so edicts carry on afterwards as if it had not happened rather than arriving all at
once, and the time away does not count towards going dormant. It can be ended early. `n.away` is in the
shared half, so every player works out the same dormancy, and the summary's `e` carries it into other
regions' counts.

**The banner's stamps.** A nation's banner carries ink stamps for its highest seat in the region's
Assembly (the Delegate's chair, or else a member's seat: every player nation unless it resigned, and
every computer nation) and its alliance, if it has one.

**Edictum staff.** An admin's nation carries an **Edictum staff** pill on its banner, beside its board
posts and in Messages, where its letters are marked as coming from the Edictum team. The mark comes
from `staff/<uid>`, which only an admin can write for themself, so it cannot be faked.

**Passport.** Every nation has a passport: a cover, an identity page and 20 pages of ten entry stamps.
Opening another nation's page stamps its entry stamp into yours (at most 200), keeping that nation's
stamp design as it was that day. The Passport page turns the pages, designs the cover (colour,
material, foil, ornament, emblem, wording, layout), the pages (tint, print, watermark, numerals) and
the entry stamp others collect, and arranges which page and place each stamp has. Richer options
unlock with the Passport & travel achievements and the Passport Office set in the museum. Every
nation's page has **View passport**. Stored on the nation as `n.pp` (see the comment in the game).
Each passport is issued to a random citizen of the nation (a name in its naming tradition, date and
place of birth, a drawn passport photo, a ghost image, a signature and a matching machine-readable
zone); the owner can issue it to another citizen (`pp.hs`). The book opens and turns in 3D, its foil catches the pointer, stamps are inked, and a **UV lamp**
shows the pages' fluorescent print. Every 20 stamps earn a land credit (10 for a full book; `pp.cr`
keeps the most paid, so a stamp removed and collected again does not pay twice). Two steps of the
tutorial's second checklist, a first stamp and a passport design, pay a land credit each.

**Passport edicts.** Ten edicts are about passports (visas, golden passports, pet passports, the queue
at the Passport Office, the passport index…). Five of them come only to players who hold a stamp, and one
answer to each unlocks a design that comes no other way (UNLOCKS source `edict`, kept in `n.ppx`):
ultraviolet ink that glows under the UV lamp, a starburst stamp, a sea-chart page print, a lacquer cover
and black-chrome foil.

**Diplomata.** A one-per-nation Society building (a passport office) that unlocks the Diplomata
passport designs (UNLOCKS source `bld`): five typefaces (Garamond, Fraktur, a copperplate script, a
typewriter face, poster capitals; self-hosted, downloaded only when used), eight devices, five page
prints and five watermarks. It also draws 3% more immigrants: arrivals and their cap in `migration()`.

**Currencies and the Foreign Exchange Bureau.** Every nation has a currency. Its everyday name is
`n.currency` (the word edicts and statistics use); the Customise page's **Currency** section adds an
official name and plural, a 3-to-5-letter code, a symbol, a subunit and how many make a unit, where the
symbol goes, the separators, a motto, and the banknote (colours, engraving, vignette, emblem, flag, security
strip, denomination) and coin (metal, shape, device, value, inscription, mint year), drawn in SVG from the
nation's own flag and arms. `n.cur` keeps only what the player changed from the suggestion `cuDefault()`
makes (Eternia's mark: the Eternian Mark, ETM, ₥), so every nation, old, new or computer-run, has a currency
without a migration. Renaming one is logged in the nation's history (`k: 'cur'`). Records are kept by the
nation's id, never by the code, so two nations may choose the same code.

What a currency is worth and how far it is trusted are worked out once a day by the **currency job**
(`jobs/fx/`, run by `.github/workflows/currency.yml` shortly after midnight UTC), never in the browser:

- **Value.** Strength (0 to 100) is a weighted score of the nation's real figures, the ones the game already
  simulates: productivity, the output per person the Statistics page shows (the game's average income
  times its prosperity multiplier from trade, buildings and cabinet; 30%), economic growth, mostly per
  person, from the record's history snapshots (20%), government stability and confidence: approval, rule of
  law, safety and stable prices, less for wars (20%), trade in live deals: partners and volume, open markets
  (20%), and development: science, education and how evenly industries share the economy (10%). Population
  and land count only through output and scale. The value is `denomination × 4^((strength − 50) / 50)`
  standard units, where the denomination (0.05 to 20) is fixed from the nation's id, so rates such as 1:0.82
  or 1:32.88 come out naturally and no name or design can move them. Strength moves 35% of the way to its
  new level a day, never more than 3% of value. Exchange rates are derived, `V(A) / V(B)`, so inverse and
  cross rates always agree, and pairs are never stored. Every region's standard unit has the same
  definition, so a future interregional benchmark needs no rewrite.
- **Currency Prestige** (0 to 100: Fragile, Vulnerable, Established, Trusted, Highly Trusted) never looks at
  the value: economic stability and resilience (steady output, jobs, size, growth; 25%), stable government
  and institutions (20%), the currency's own day-to-day steadiness, in percent (20%), trade participation
  (15%), productivity and development (10%) and monetary credibility: inflation, public debt, the credit
  rating, an independent central bank or a People's Bank, a sovereign fund (10%). It moves 10% of the way to
  its target a day, at most 1.5 points up or 2 down (5 in a crisis: a new war, or government or economic
  stability falling 15 points in a day), with a point of hysteresis at the tier lines, and a player's
  currency is capped at 50 rising to 100 over its nation's first 180 days (computer-run nations are long
  established). Nothing a player buys or designs changes it, and it has no effect on play yet: it is for
  information, comparison and pride.

The formulas the job copies from the game (income, approval, inflation, debt, credit rating, unemployment,
rule of law, industries, the computer nations' budget) are named functions in the game, and
`test/fx.test.mjs` checks the two agree. The job reads the regions and the computer-run nations from the
game file itself, so a new region is valued the next day with no change to the job. It skips nations
unsaved for 260 days and removed ones, marks hidden ones (only their owner sees them), and leaves the
nation records alone: trade deals, resources and everything else in play are untouched. A nation that
moves region carries its currency's history and smoothing with it.

The **Foreign Exchange Bureau** (`#exchange`, under Abroad) shows the player's currency (value and prestige
side by side, each with why, in words), a converter between any two currencies of the region with a swap
button and both prestige ratings, the region's most trusted currencies, a sortable directory of every
currency (rate against the player's, 24 hours, 7 days, strength, stability, prestige, rank), charts of the
rate and of prestige over 7 days to all the history there is, the milestones the Bureau recorded, and how it
all works. Nation pages show the currency, its rate against the viewer's and its prestige; the Statistics
page's economy shows the real rate; the Census adds the Bureau's indicators below its scales (not as new
scales); a currency's milestones (a new tier, the most trusted or a top-five currency, a ninety-day high or
low, each at most so often) go into its nation's history once its player next opens the game, and into the
Daily Dispatch's business pages. The game reads `fx/<region>` at most once a session (the browser keeps the
copy until the next day's) and a currency's history only when a chart shows it, and listens to neither.

**Currency rewards.** Ten **Currency & finance** achievements (designing, renaming and fully designing
the currency, visiting the Bureau, a ninety-day high or low, Trusted and Highly Trusted, a top-five and the
most trusted currency) each unlock a design the Customise page shows locked until then: the Moiré,
Basketweave, Mosaic and Constellation engravings, rose-gold, platinum and black-nickel coins, a holed coin, and
holographic and gold-foil security strips (UNLOCKS kinds `cunote`, `cumetal`, `cushape`, `custrip`). The
museum's seven-artefact **National Mint** set (`mint`) adds the Filigree engraving, an eight-sided coin and
the epithet *the Treasurer*. Prestige milestones count from the nation's history (`k: 'fxm'`), and on the
player's own screen from the day's rating too. As with every cosmetic, other players see an earned design
only when the record lists it (`n.cz.u`); otherwise it shows the suggestion (`CU_HOLDS`). Once the Next steps
are done or hidden, a third checklist, **Treasury steps: Money of your own**, offers visiting the Bureau and
designing the currency, each worth `CU_STEP_CREDITS` (2) land credits and `CU_STEP_GIFT` (5 oil), paid once:
the steps join `n.tut.lc` with the others.

**Support.** The Help page (and the founding page's help) has **Create a support ticket**: a topic,
a message and, if the player wants, an email address. Their tickets and the team's answers are listed
below it, and a player waiting for an answer is told when it comes. Admins answer on the portal's
**Help queries** page (`#admin-help`): an answer closes the ticket; a ticket can also be closed
without one, or deleted as spam. Banned players can still send tickets, to appeal.

**Deleting an account.** The account menu's **Delete my nation and account** removes the player's
posts in every region, their support tickets, their nation, summary and space record, their pacing records and their
account (a Google account is asked to confirm the sign-in first). The next day's currency job deletes the
currency's history (`fxh/`). The daily backups lose it within 14 days.

**Privacy and terms.** `src/privacy.html` and `src/terms.html`, with Spanish versions
`src/privacidad.html` and `src/terminos.html`, are served as `/privacy`, `/terms`, `/privacidad`
and `/terminos`, each with a button to the other language. The game links to them from the side
bar's foot, the founding page and the account menu. The notice follows Mexico's LFPDPPP (ARCO
rights) and keeps GDPR rights for players in the EU; the terms are under Mexican law.

**The front page.** A visitor without a nation lands on the founding page, which is also the front
page. Besides the charter it says what Edictum is (`HOME_FEATS` in the game), offers a sample edict
to try, worded for the nation being drafted (`HOME_TRY`; nothing chosen there counts), and shows the
region's player nations: how many, how many were founded this week or were active in the last 15
minutes, and their flags. These come from the records the founding map listens to anyway, so they
cost no reads. Every field but the name has a default, so a Found button is always in reach: beside
the preview on wide screens, and in a bar at the foot of the screen on phones, where the preview card
gives way to the form. `build.py` writes the page's heading, lede and features (read from the game's
`HOME_LEDE`, `HOME_FEATS` and `HOME_FREE`) into the page itself, so a newcomer sees them while the
game's script downloads; a returning player (a nation saved in the browser, which `src/stub.js`
checks) sees the plain loading screen instead.

**Sign-in.** A new visitor is signed in as an anonymous guest straight away and can play at once.
The account control (at the foot of the side bar, or at the top of the founding screen) offers
**Keep your nation on every device**, which links the guest account to Google so the same nation
loads anywhere. If that Google account already has a nation, the player can switch to it. A player
signed in with Google also has **Sign out** under the control in the side bar (it asks first; a guest
gets none, since a guest who signed out would lose the nation). Signing out starts a new guest.
Above Sign out, a small status shows **Synced** after server confirmation, **Saving** while changes
are queued or in flight, and **Offline** when synchronization is unavailable. Guests with a nation
see the same status. Its text is announced to screen readers when it changes.
Linking is also the last of the First steps: it pays 5 land credits and 5 iron, 5 timber and 5 goods,
once (`n.glk`).

**Without Firebase.** If the Firebase scripts or the configuration cannot be loaded, the game
plays in the browser only, as it always could, and says so.

**Fonts.** The game's three typefaces (Bodoni Moda, Public Sans, IBM Plex Mono; SIL Open Font
License) are served from the site itself, Latin and Latin Extended only, from the pinned Fontsource
packages: no visitor's browser contacts Google for them.

**Nation files.** There is no import or export: every nation lives in Firestore, kept with the
player's account. (The retired claude.ai version's nations are not carried over.)

## Local development

You need Node.js 22 or later, Python 3, and Java 21 or later (for the Firestore emulator).

```sh
npm ci                     # the pinned Firebase SDK, tools, esbuild, fonts and Playwright
npm ci --prefix functions  # the referee's packages, for the Functions emulator
python3 build.py           # writes public/
npx firebase-tools emulators:start --project demo-edictum
```

Then open <http://127.0.0.1:5000>. The `demo-` project id means everything runs on your machine:
the page finds the local Auth, Firestore and Functions emulators by itself, and nothing touches a real
Firebase project. The emulator console at <http://127.0.0.1:4000> shows the accounts and
documents; in the Auth emulator, "Continue with Google" opens a stand-in sign-in window where you
can make up accounts.

`npm run emulators` does the build and the start in one go. After changing `src/` or the game,
run `python3 build.py` again and reload.

### Tests

```sh
npm run test:fx            # the currency engine and the game's currency helpers (no emulator)
npm run test:rules         # the security rules, and the daily currency job (Firestore emulator only)
npm run test:referee       # the referee: readiness, fair dice, the odds' bound, seals (Auth, Firestore and Functions emulators)
npx playwright install chromium   # once, for the browser tests
npm run test:e2e           # two players, the board, other regions, reloads, rules, battles and seals, admin, offline, Google sign-in, full regions, founding drafts, the front page
npm run test:smoke         # every page of the game at 1280 and 390 px wide, in two regions
npm run test:sync          # one account on desktop and phone: updates, conflicts, clocks, reconnects
npm ci --prefix jobs/fx    # once, for the next one: it runs the currency job as production does
npm run test:fx-e2e        # the currency: the job publishing four days, the Bureau, the designer, a phone
```

Screenshots from the browser tests go to `test/out/`. `python3 build.py --no-minify` keeps the code readable for debugging.

Every pull request runs the rules and referee tests and the end-to-end and smoke tests on GitHub Actions
(`.github/workflows/preview.yml`); a failed run keeps its screenshots as an artifact.

**The cost test.** `test/load.mjs` puts 50 players in one region for five minutes: six real game
clients (half idle, half playing) with every Firestore read and write counted inside the page, and
Node clients that keep the game's listeners and save at the pace the real clients do. It writes
`docs/cost-test.md`, the reads, writes and data per player and per region, and what a month of it
costs at Firestore's eur3 prices, beside the run before the shared/private split and the one-minute
save gap (`test/cost-baseline.json`):

```sh
python3 build.py
npx firebase emulators:exec --project demo-edictum --only auth,firestore,hosting "node test/load.mjs"
```

## Owner setup

Do these once, in your browser. The referee (a Cloud Function) needs the Blaze plan, so each
project needs a billing account (see Costs).

### 1. Create the Firebase project

1. Go to <https://console.firebase.google.com> and choose **Create a project**. Pick a name; note
   the **project id** it shows (for example `edictum-4f2a1`). Google Analytics is not needed.
2. In the project, open **Project settings** (the gear) → **General** → **Your apps** → **Add
   app** → **Web** (`</>`). Call it Edictum, tick **Also set up Firebase Hosting for this app**, and
   choose **Register app**. You can skip the code it shows: the site reads its configuration from
   Hosting at `/__/firebase/init.json`.

### 2. Firestore

1. **Build** → **Firestore Database** → **Create database**.
2. Choose the **Standard** edition, if asked.
3. Location: `europe-west4` (Netherlands) for one region, or `eur3` (Europe, multi-region) for
   more resilience at a higher price. **This cannot be changed later.**
4. Start in **production mode**. The real rules arrive with the first deploy.

### 3. Authentication

1. **Build** → **Authentication** → **Get started**.
2. **Sign-in method** → **Anonymous** → enable → **Save**.
3. **Sign-in method** → **Add new provider** → **Google** → enable, choose a **support email**,
   **Save**.
4. **Settings** → **Authorised domains** already lists `localhost`, `<project id>.web.app` and
   `<project id>.firebaseapp.com`. Your own domain is added in step 8.

### 4. Hosting

**Build** → **Hosting** → **Get started**, and click through to the end. You do not need to run
the commands it shows; GitHub does the deploying. Your site's first address is
`https://<project id>.web.app`.

### 5. The service account key, as a GitHub secret

1. **Project settings** → **Service accounts** → **Firebase Admin SDK** → **Generate new private
   key** → **Generate key**. A JSON file downloads. Treat it like a password: never commit it.
2. Give that service account the rights to deploy. Open
   <https://console.cloud.google.com/iam-admin/iam>, pick your project, find the account named
   `firebase-adminsdk-…@<project id>.iam.gserviceaccount.com`, choose **Edit** (the pencil) and add
   these roles: **Firebase Admin**, **API Keys Viewer** and **Service Usage Consumer**, and for the
   referee **Cloud Functions Admin**, **Service Account User** and **Artifact Registry
   Reader**. Save.
4. The referee runs on Cloud Functions, which needs the **Blaze** plan (**Usage and billing** →
   **Modify plan**) and, once, a deploy from your own computer, which switches on the Google Cloud
   services it uses and keeps only the latest build of it:

   ```sh
   npm ci --prefix functions
   npx firebase deploy --only functions --project <project id>
   npx firebase functions:artifacts:setpolicy --project <project id> --location europe-west1 --days 1 --force
   ```
3. In your GitHub repository: **Settings** → **Secrets and variables** → **Actions** → **Secrets**
   → **New repository secret**. Name: `FIREBASE_SERVICE_ACCOUNT`. Value: the whole content of the
   JSON file. **Add secret**. Then delete the downloaded file, or keep it somewhere safe outside
   the repository (you need it again only for step 9).

### 6. The project id, as a GitHub variable

Same page, **Variables** tab → **New repository variable**. Name: `FIREBASE_PROJECT_ID`. Value:
your project id. **Add variable**.

### 7. Deploy

Push to `main` (or open **Actions** → **Deploy** → **Run workflow**). The workflow installs the
pinned packages, runs `build.py`, deploys the Firestore rules and indexes, the referee, then the site. If the
secret or the variable is missing it says so in a yellow warning and deploys nothing. If a deploy
fails with "The caller does not have permission", the message names the permission; add the role
that holds it to the service account (step 5.2).

Pull requests get their own preview address, posted on the pull request, for seven days. Previews
run on the separate staging project (step 10), so playing on a preview never touches real nations.

### 8. Your own domain

1. Firebase console → **Hosting** → **Add custom domain**. Enter the domain (for example
   `edictum.example`). Firebase shows the DNS records to add.
2. At your domain registrar's DNS settings, add exactly those records: a **TXT** record that
   proves you own the domain, and the **A** records (IP addresses) that point the domain at
   Firebase. To serve `www.edictum.example` too, add it as a second custom domain and choose to
   redirect it to the first.
3. Wait. DNS changes can take up to a day, and Firebase then issues the HTTPS certificate itself;
   the console shows **Connected** when it is done.
4. **Authentication** → **Settings** → **Authorised domains** → **Add domain**: add
   `edictum.example` (and the `www` name if you use it). Without this, Google sign-in on your domain
   fails, and the game tells the player the address is not authorised yet.
5. In GitHub, add the variable `SITE_URL` with the value `https://edictum.example` and run the
   Deploy workflow again, so link previews point at your domain.
6. So that Google's sign-in window names your domain instead of `<project id>.firebaseapp.com`, the
   game sends sign-in through the domain itself (`SIGN_IN_HOSTS` in `src/shim.js`). Google must
   accept that address first: <https://console.cloud.google.com/apis/credentials> → your project →
   **OAuth 2.0 Client IDs** → **Web client (auto created by Google Service)**: add
   `https://edictum.example` under **Authorised JavaScript origins** and
   `https://edictum.example/__/auth/handler` under **Authorised redirect URIs** → **Save**. Then, under
   **Google Auth Platform** → **Branding**, set the **App name** (Edictum) that Google shows, and
   have it verified: Google checks that you own the domain (a DNS record from
   [Search Console](https://search.google.com/search-console)) and that the homepage and privacy
   notice are live. Add the URIs before the change is deployed, or Google sign-in on the domain fails.

### 9. Making yourself an admin

Admins see **Remove** on everyone's posts on the region message board, and a purple **Admin** pill
beside their nation's name; other players see their nation marked **Edictum staff**. The pill opens the admin portal (`#admin`): players in all and per
region (active in the last 250 days, today, this week, in the last 15 minutes), how full each
region is, its board posts, nations in space and the largest nations, all counted live, the report
queue, and a button back to the game. Its **Help queries** tab (`#admin-help`) lists the players'
support tickets, and its **Suspicious** tab (`#admin-sus`) the nations whose records the game caught
out (see Fair play), with Hide and Ban. For anyone else `#admin` simply shows the game.

The categorized left sidebar also includes **Player search**, **Save health**, **Admin audit log**,
and **Region control**. Search covers existing public nation summaries without a migration, matches
names without regard to capitalization or accents, supports player IDs and region filters, and
shows server-confirmed save times and revisions when a player is inspected. The summary directory
is cached for a minute; Refresh directory reloads it.

Save health combines `saveHealth/` session reports with actual `nations/` server timestamps and
revisions. Reports contain only player ID, region, a Desktop/Mobile label, status, pending flag,
revision, error code and conflict count. Status changes are coalesced to at most one write every
15 seconds, with a heartbeat once a minute for visible sessions. An offline browser cannot report
live status: the console marks sessions unseen for five minutes as not recently seen. It shows up
to 250 reporting sessions from the last day, not a guarantee that every player has reported.
Reports expire after seven days via the `saveHealth.expiresAt` TTL policy and are removed when
the player deletes their account. Diagnostics never block a nation save.

Region control uses the staff-only `adminConsole` Cloud Function. Missing `regionStatus/<id>`
documents mean enabled. Disabling greys out the region on the founding page, blocks founding,
moves and saves in the rules/adapter, and blocks battles in the referee. Connected and returning
players see the maintenance message; existing nation data is kept. Re-enabling restores access.
Admins retain console access when their own region is disabled. No region is disabled by deployment.

Console moderation, board removal, support actions and region changes are recorded by the server
in `adminAudit/`, using the authenticated admin and server time. Clients cannot create, edit or
delete audit events. Multi-document moderation cleanup records intent and then completion or
failure; an unfinished operation remains visible. Existing direct Firestore admin privileges remain
compatible with older clients; changes made outside the updated console are not reconstructed.
Audit history starts with this release and remains after player account deletion.

Validation: `npm run test:admin` tests backend permissions, search, maintenance, diagnostics and
audit outcomes. `npm run test:admin-e2e` tests the console and the player/home maintenance flows.

1. Play on the site and link your nation to Google (**Keep your nation on every device**), so the
   right stays with an account you can sign in to anywhere.
2. On your computer, in this repository:

   ```sh
   cd tools/admin
   npm ci
   GOOGLE_APPLICATION_CREDENTIALS=/path/outside/the/repo/service-account.json node set-admin.mjs you@gmail.com
   ```

   It also accepts the **Player ID** shown in the account menu, and `--remove` takes the right away.
3. Reload the game. It asks for a fresh sign-in token on every load, so the right arrives at once;
   there is no need to sign out (which, for a guest, would start a new guest).

   On Windows PowerShell: `npm.cmd ci`, then
   `$env:GOOGLE_APPLICATION_CREDENTIALS = "C:\path\to\key.json"; node set-admin.mjs <email or player id>`.

### 9b. The daily currency job

`.github/workflows/currency.yml` runs `jobs/fx/run.mjs` every day at 00:17 UTC (and again at 06:41 as a
safety net; a day already done is skipped) with the same secret and variable as Deploy. The service account
needs to read and write Firestore, which the **Firebase Admin** role of step 5 includes. It starts once the
workflow is on `main`. To publish the first rates without waiting, open **Actions** → **Currency** → **Run
workflow**; choose `staging` to run it against the staging project. To run it from a computer instead:

```sh
cd jobs/fx
npm ci
GOOGLE_APPLICATION_CREDENTIALS=/path/outside/the/repo/service-account.json node run.mjs --project <project id>
```

Until the first run, the Bureau says no rates have been published yet; nothing else in the game depends on
it. If a day is missed (GitHub occasionally delays or drops a scheduled run), the next run carries on: the
smoothing treats the gap as a quiet day and charts simply have no point for it. The job's core
(`runCurrencyDay` in `jobs/fx/daily.mjs`) takes any Firestore instance, so moving it to a scheduled Cloud
Function later is a few lines.

### 10. The staging project, for previews

A second Firebase project, `edictum-staging` (alias `staging` in `.firebaserc`), has its own
database, accounts and address (<https://edictum-staging.web.app>). Pull request previews deploy
there, and you can deploy a branch to it by hand:

```sh
python3 build.py --site-url https://edictum-staging.web.app
npx firebase deploy --only firestore:rules,firestore:indexes,functions,hosting --project staging
```

It is set up like the live project (steps 1 to 5: web app, Firestore in `eur3`, Anonymous and Google
sign-in, the roles on its `firebase-adminsdk-…` service account, Blaze with a 100 MXN budget alert,
the referee's first deploy). For the previews, GitHub
needs the variable `FIREBASE_STAGING_PROJECT_ID` = `edictum-staging` and the secret
`FIREBASE_SERVICE_ACCOUNT_STAGING` holding a key of the staging project's service account (step 5,
in the staging project). Without them a pull request gets the rules test and a yellow note instead.

## Costs: Spark and Blaze

Firebase has a free plan (**Spark**) and a pay-as-you-go plan (**Blaze**, which includes the same
free allowance each day and charges only beyond it). Check <https://firebase.google.com/pricing>
for current figures; at the time of writing:

- **Hosting.** Spark allows about 360 MB of downloads a day. A first visit downloads about 1.9 MB
  (the game's script is 4 MB, about 1.5 MB compressed, plus styles, fonts and 0.2 MB of Firebase),
  so Spark covers roughly 150 to 200 first visits a day. Returning visitors download only the 21 KB
  page until you deploy a new version.
- **Firestore reads.** Spark allows 50,000 reads and 20,000 writes a day. Each copy of the game
  that is open listens to its own region's nations, its board and the space records: opening the
  game reads one document for each of those, and each time a nation in the region is saved (at
  most once a minute while its player is active), every open copy in that region reads it again.
  Twenty players in one region, active for an hour, make at most about 20 × 20 × 60 = 24,000 reads;
  the same twenty spread over four regions make a quarter of that. Spark suits a group of friends;
  for a public launch use Blaze, where reads cost a few US cents per 100,000.
- When a Spark quota runs out, the game keeps working in each browser and tells players their
  changes are saved in the browser only, until the quota resets at midnight Pacific time.
- On Blaze, set a **budget alert** (Google Cloud console → Billing → Budgets and alerts) so
  surprises reach your inbox.
- **The referee** (Cloud Functions, Blaze only) runs once per attack: about five document reads and
  two writes each, and Cloud Functions' free allowance (two million calls a month) covers far more
  battles than readiness allows. Building it on each deploy stores a container image in Artifact
  Registry; the clean-up policy (Owner setup, step 5) keeps that to a few cents a month.

- **The currency job** reads each region's nation records once a day and writes one document per region
  plus one history entry per currency: for 26 regions of 250 nations, about 6,600 reads and 6,600 writes a
  day (well inside the free quota), and up to some 200 MB of records sent to GitHub's runner a day. Players
  read `fx/<region>` (about 60 KB for a full region) at most once a session, and not at all once their
  browser has the day's copy, plus one small history document per currency they chart.

## Scaling

Reads grow with the size of a region (at most 250 active nations), not with the whole world: see
Data above. What is left for later, as numbers grow:

- **Space records** are read by everyone. They change only when a nation's Moon, Mars or belt data
  does (and every 12 hours while it plays), but a very large late game would want them split by
  body or summarised.
- **Dormant nations** still arrive with their region's records (the game sets them aside). If
  regions fill with abandoned nations, listen only to active ones and fetch the rest on demand.
- **Fair play.** Each browser still writes its own nation, so the defences are layered:
  - *The rules* bound three headline numbers saved beside the record: population may grow no faster
    than ×1.35 a day since the last save (plus 3 million a day of migrants), and army strength and land
    claimed stay within what that population allows. A record that has them keeps them.
  - *Every game checks the others* (`auditNation`): the record is held to those numbers (no more people,
    army or claims), nothing may be dated after the save that carries it (the server's time, ten
    minutes for clocks), and growth rate and stock stay within the game's limits. What a game sets aside
    is the same on every screen, so a cheat shows only on the cheat's own. It also flags a population
    beyond the nation's age and more conquests in a day than the replay counts.
  - *Races go by the server's time*: when two nations claim the same free hex or find the same site,
    the stamps decide, not the times the records give themselves.
  - *The referee rolls the battles* (`functions/index.js`). An attack asks the server, which keeps the
    army's readiness (6 points, 8 with an Army Reserve, one back every 15 minutes or 10 with Rapid
    Mobilisation, plus one for a master spy's gift), rolls the dice and signs each victory: a seal over
    the attacker, the hex, the server's time and the ally whose war it was. Every game checks the seal
    (`sealed()`) before a conquest counts, so a lost battle cannot be rolled again by reloading the
    page, and a conquest typed into a record counts nowhere. The odds are the attacker's game's own,
    cut to what the two armies saved beside the records allow (20 to 1 for the attacker's army and
    half its allies', which covers borders, distance, terrain, spies and buildings); the attacker is
    told when they were cut. Conquests from before the referee (`REF_EPOCH`, 29 October 2026) need
    no seal.
  - *Deals with computer nations* are held to terms the computer nation could have accepted: the
    player gives at least 0.12 of what they get, the least that any prices allow.
  - *Admins* see what was caught on the portal's Suspicious tab, for their own region and, on request,
    the others (one read per nation), and each army's battles in `armies/<uid>/log`.
  What is left is what the referee cannot see: the odds it is given within that bound, spy missions
  and computer nations' counterattacks (still rolled in the browser; a counterattack only harms the
  player who rolls it), and anything a deal between two players both agree to.

## Changing the game

Edit `game/edictum.html` on a branch, run the tests, and open a pull request (its preview runs on
staging); merging to `main` deploys. `build.py` checks that the file still has the shape it expects
(one `<div id="app"></div>` followed by one inline script) and stops with a clear message if not.
Nations saved by an older version load through the game's own normaliser.
