# Edictum

Edictum is a multiplayer nation simulator in a single web page. Players found a nation, rule on
the edicts that land on their desk, claim land on a hex map of their region, build cities, trade,
form alliances, spy, go to war, vote in a regional assembly and, in the end, head for the Moon and
Mars. Every nation is run by a player or by the computer, and players in a region share one map
and one message board.

The game was first written as a claude.ai artifact. That version was retired in October 2026: the
game now lives here, at <https://edictumgame.com>, with Firebase: **Hosting** serves the page,
**Authentication** gives every visitor an account (a guest account at once, linked to Google, Discord
or an email address if they like), and **Firestore** holds the shared world.

## How it fits together

| Path | What it is |
| --- | --- |
| `game/edictum.html` | The game. It grew out of the claude.ai version (Version 26) and is now developed here; the build never edits it. |
| `src/stub.js` | A few lines put at the top of the page: `window.claude.use()`, which the game calls, waits until Firebase is ready. |
| `src/shim.js`, `src/shim.css` | The Firebase layer behind `window.claude.use('db' / 'user')`: documents, queries, counts, batched nation saves and board posts (see Data). Also the account control. |
| `src/favicon.svg`, `src/og.png`, `src/apple-touch-icon.png` | The seal icon and the picture shown when a link is shared (`src/og.html` is its source; `tools/make-images.mjs` redraws the PNGs). |
| `build.py` | Builds `public/`: a small page, `/assets/game.<hash>.js`, independently cached story text in `/assets/content.<hash>.js`, every region's map baked by the game's own generators in `/assets/maps.<hash>.js` with its biomes and iron deposits (`scripts/bake-maps.mjs`, checked hex for hex against them), styles in `/assets/app.<hash>.css`, and fonts in `/assets/fonts/`. Their names change with their content, so code-only updates reuse the story download. `--no-minify` keeps an unsplit game for debugging. |
| `scripts/split-content.mjs` | Uses the pinned Acorn parser to extract literal text from story and region catalogs. Predicate functions keep their original lexical scope; no `eval()` or source-regex rewriting is used. |
| `firestore.rules`, `firestore.indexes.json` | Who may read and write what. |
| `functions/` | The referee: one Cloud Function (`referee`, in `europe-west1`) that rolls battles on the server, keeps each army's readiness and seals every victory (see Fair play). |
| `firebase.json`, `.firebaserc` | Hosting (cache headers, clean URLs), Firestore and the local emulators. `.firebaserc` names the live project, `edictum-b30de` (served at <https://edictumgame.com>); the workflows pass the id explicitly from the `FIREBASE_PROJECT_ID` variable, and the emulator scripts use `demo-edictum`. |
| `.github/workflows/` | `deploy.yml` deploys on every push to `main`; `preview.yml` tests the rules and deploys a preview of each pull request to the staging project; `currency.yml` runs the daily currency job; `stats.yml` records the day's player statistics; `mail.yml` sends Letters by post every hour; `alerts.yml` files staff alerts every 15 minutes. |
| `jobs/fx/` | The daily currency job: every currency's exchange value and Currency Prestige, from the nations' records (Firebase Admin SDK, its own `package.json`). See Currencies below. |
| `jobs/stats/` | The nightly record of player statistics for the admin portal's Statistics page (`functions/stats.js` does the counting). See 9c2 below. |
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
  is open. It is rewritten only when it changed. New nations also keep their progressive feature reveals
  in private `onb` state; records without that marker retain the established full interface.
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
- `support/<id>`: a player's support ticket (topic, text, nation, optional email), the conversation after it
  (`m`, whose turn `w`, written only by `functions/support.js`) and, once closed, by whom and an expiry `exp`. A Firestore time-to-live policy on `exp` deletes closed
  tickets 90 days later. The policy is set once per project (Firebase console, Firestore,
  Time-to-live: collection group `support`, timestamp field `exp`). It needs billing, so the staging
  project goes without; `firestore.indexes.json` only takes `exp` out of indexing, and deploys leave
  the policy alone. The player and admins read the tickets; `slimits/<uid>` `{s}` paces them to one
  a minute.
- `bugs/<id>`: a player's bug report (title, text, where, how often, technical details, nation) and an
  admin's verdict (state, note); `bugImg/<id>` its screenshot, sent in the same batch. The player and
  admins read them; only admins change the state; `blimits/<uid>` `{b}` paces them to one a minute.
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
a browser running the old game must reload once the nation has a revision. Warehouse saves also set a
monotonic `storageV: 1` envelope marker: clients must preserve it, preventing older open games from
removing Warehouse data or truncating expanded stockpiles. Transactions require a
connection: offline changes stay in the local copy until they can be checked against the server.

Another device's save normally arrives through the region's listener. A phone's listener can go quiet
without an error after the phone has slept, and the SDK's own reads share its connection, so while the
player is on the page and the listener has brought nothing from the server for a minute, the game asks
for the nation's `rev` alone over REST (a field mask: a few bytes, one read) at most once a minute and
on changing page, and loads a save it missed. An open tab keeps the build it loaded, and an older
build drops what it does not know of a newer one's records when it saves them, so `build.py` stamps
every page with its build (a hash of the page, in `meta name="edictum-build"` and `/version.json`).
Coming back to a tab after 30 seconds or more away, at most every five minutes, the shim asks whether
the build has changed; if it has, it sends the latest changes and reloads, unless the player is writing
something there (a field they typed in, or a message, resolution, notice, post or history in progress),
who is told instead. A tab that stays in front checks every half hour and only tells.
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
told why and can still play; its land stays on everyone's map as a grey, nameless "Hidden nation" that
nobody can claim, settle near or attack, and it attacks nobody, the referee refusing both, so nothing moves
when it is shown again: `HIDN` in the game), ask for a new name (the nation is hidden the same way until its
player saves it under another name), remove the nation (it and its posts are deleted; the player may found
a new one), ban the player (the nation is removed and the account can no longer save, post or
report), or simply close the ticket. Hidden nations and banned players are listed in the portal
with Unhide and Unban. A banned guest can come back by clearing their browser; a linked account
cannot: a ban also keeps one-way hashes of the account's sign-ins (`banIds/`, functions/eligibility.js), so
closing the account and signing in again with the same Google account, verified address or Discord account
makes a new account that is banned as soon as it founds a nation. Unban clears them.

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

**The Customise page.** Nine sections in three groups: Identity (epithet, flag, arms, symbols, provinces),
Presentation (banner, decrees, finery) and Money (currency), shown one at a time. On a wide screen a list
down the side names them under their groups and says how much of each is held; below 1180px the dock keeps
the group tabs and adds a row of section chips. Every section is drawn and CSS shows the open one
(`.cz-dock[data-sec]`), so a jump from anywhere only picks the section (`czTabFor`, `czSecSet`); the open
section is remembered, with the last one of each group, and is in the address as `#customise/<slug>`. A dock
at the top keeps a preview in view, as the nation card, sidebar, Region row, map marker, banknote or decree. Pointing at a
tile shows it there, and a click on a locked one tries it on; neither is saved. A search and Owned / Locked /
New filters list matching cosmetics from every tab. The page also shows what is new since the last visit and
the three cosmetics closest to being earned, how many of each section are held, an Undo for this visit's
changes and a Back to default per section, and folds "Closest to unlocking" to one line. It warns before an unsaved currency is left behind. Theme, accent,
text size, density and motion are device settings and live in Settings, under Display. The coat of arms
has 24 charges, 10 of them free; the symbols save as each box is left.

**The Settings page.** Five tabs (`SG_TABS`): Your nation (type of state, leader, particulars, culture, map
colour), Edicts (holiday mode, pace, topics), Notifications (pop-ups and the bell on this device, letters by
post), Display (theme, accent, text size, density, motion) and Account (sign-in, recruiting, the tutorial,
dissolving). On a wide screen the tabs are a list down the side; below 1180px they are a row across the top
that sticks under the top bar. Every pane is drawn and CSS shows the open one (`.sg[data-tab]`), so a jump
from search, the tutorial or another page only picks the tab (`sgTabOfId`, and the `uxOpen`, `uxJump` and
`tutGo` wrappers); the open tab is in the address as `#settings/<tab>`. Your nation is a draft (`S.settings`)
with a live preview, Save and Discard, because other players see it; the tab counts unsaved changes, and
leaving Settings with some asks first in the save bar. Everything else applies at once. The currency's name
is set only in the Customise currency designer, and the flag only in the flag designer.

**The danger zone.** Account ends with a red-bordered box (`sgDanger`), one row per thing that cannot be
undone. Start over and Dissolve nation ask for the nation's name to be typed before their last button works.
Start over dissolves the nation and opens the founding page with its name and particulars filled in; what
`SG_CARRY` lists (leader's name, culture, factbook, map colour, Customise choices, currency design, edict pace
and topics) waits in localStorage (`edictum.restart`) and goes onto the new nation when the same name is
founded again. Founding waits until the old record is deleted (`S.dissolving`). Delete nation and account
opens the account panel at its own delete step (`__edictum.openAccount('delete')` in `src/shim.js`), shown only
when there is an online account to delete.

**The Great Statue.** Each region's player nations build a statue together, in ten phases (`WND_PH`), on the
Great Statue page and on the land nearest the middle of the map. Nothing is stored centrally: a nation's gifts
sit in its own record (`n.wnd`, region, amounts, highest phase seen complete), and the statue is their sum.
Computer nations take no part, and a finished phase stays finished. Six edicts (`WND_ISSUES`) arrive as it rises,
and contributors to a finished statue earn the epithet "the Patron".

**Field digs.** The Museum's Field digs hall sends diggers to six sites (`DIG_SITES`, 8 to 24 hours) for two
collections about the region's past: the Fords and the Drowned Harbours. Half of a collection brings 2 land
credits and all of it 7 more, counted from what is held. One dig at a time, or two with an Institute of Field
Archaeology (one per nation, +2 on the roll).

**Diplomatic gifts.** A postcard, a banknote or the national dish, sent from any nation's page with a set phrase
(no free text). The sender keeps `n.gft` and the recipient `n.gfr`, and computer nations answer on their own. Gifts
raise goodwill, but not past Warm (15). Three a day, one a day to the same nation.

**National symbols.** The Customise page's National symbols: the holiday and its date are open from the
start; the flower opens at 5.5 million people, the tree at 6, the bird at 7, the instrument at 8, the
colours at 10 and the capital's nickname at 20 million (`SYM_AT`). Each opens once, on the first save
after the population reaches it, with a notice (a toast and the bell, from the College of Arms) and
5 timber and 5 iron; `n.syu` keeps the ones given, so a nation that shrinks keeps them, and a symbol
chosen before it had a threshold stays open.

**The pace of edicts, and holiday mode.** In Settings › Edicts a player chooses how often a new edict arrives:
every 30 minutes (the default), hour, 4, 8 or 12 hours, or once a day (`FREQS`; a nation saved at a
pace no longer offered loads at 30 minutes). Holiday mode, also in Settings, stops new edicts until a
date and time the player chooses, at most a calendar month ahead (`n.away`, `{a, b}`). The edict clock
skips the holiday, so edicts carry on afterwards as if it had not happened rather than arriving all at
once, and the time away does not count towards going dormant. It can be ended early. `n.away` is in the
shared half, so every player works out the same dormancy, and the summary's `e` carries it into other
regions' counts.

**Dormant nations.** A player nation unsaved for 250 days (not counting a holiday) falls dormant: every other
player's game leaves it out, and its land is open to anyone with land credits. Its owner finds the Office of
dormant nations and wakes it by typing its name. Waking keeps everything but the land, which starts again: a
**welcome back** (`dormWelcome`) says how long it slept and that its land went back to the wild, and offers two
ways on: choose a place on this region's map (the old capital's hex is proposed while it is still free), or
start afresh in one of up to three open regions with fewer active nations, quietest first. Until it settles
(`dormFresh`), that move costs nothing: no land credits lost, no 14-day wait, and the capital's packed
buildings come along (`moveTo(rid, true)`). The map panel keeps a "Quieter regions…" button until then.

**Letters from Willow Street.** A citizen storyline told through eight letters from Mara Bell, of number
fourteen, Willow Street, in the capital: a broken streetlight, then the bakery she tries to open, the fight
over the street, her daughter Ada's question, and at last what goes into the record. Each letter is an edict
(`ws-1` … `ws-8`) that never enters the random pool.

- *Milestones.* Letter I is earned at 5 enacted edicts, then 10, 25, 50, 100, 250, 500 and 1,000
  (`WS_AT`). "Enacted" means a choice made on any other edict, the founding edict included: vetoes do not
  count, and neither do answers to the letters themselves. The count (`n.ws.e`) is kept apart from the
  decision history, which only holds the last 80, so it is a lifetime count.
- *Delivery.* An earned letter takes an ordinary arrival slot of the edict clock, so it follows the pace in
  Settings, waits through holiday mode, never pushes another edict off a full desk (it stays earned until a
  slot comes), and lets a follow-up that is due go first. Only one letter waits at a time: a nation that
  earned several gets them one per slot after each is resolved, in order, each exactly once. Opening or
  drawing a page never resolves anything; a letter is resolved only by an answer or a veto.
- *A veto* files the letter unanswered: the story carries on, Mara's trust falls, and later letters say
  so without pretending the offered answers happened. Once all eight are resolved the story is complete
  (`n.ws.d`), and the Edicts page keeps the whole correspondence.
- *Government.* The family of states that receives a letter (`fdFam`, the same eight as the founding
  edict: Senate, Crown, Empire, Divan, Synod, People's Congress, Governor's Council, Borough Council) tells
  it in its own voice: 64 written versions. The civil, economic and political freedom bands that
  `classify()` uses add one sentence each (27 combinations, composed rather than written separately), and
  a few laws in force add one where they matter (`WS_POL`). Facts from earlier answers (`WS_FACTS`: the
  lamp, the bakery and who runs it, Tomas, any contract or debt, hearings, how criticism was treated, the
  street, Ada) change what later letters say, so a bakery that never opened is never described as trading
  and a debt is mentioned only if a contract was actually made. A new government after the last letter
  gets a short transition line; the facts carry on unchanged.
- *Frozen letters.* A letter's context (family, bands, laws, facts, earlier answers) is fixed when it
  arrives and stored in its inbox entry, so a change of government or freedoms, a reload or another device
  never rewrites a letter already on the desk. The chosen answer goes through the ordinary decision
  process with that version's effects.
- *Rewards.* Each answered letter brings 5 land credits and a keepsake for Customise: the epithet "the
  Well-Lit", the "Received, with thanks" stamp, a loaf emblem for the flag, the Crust accent colour,
  quotation marks round the motto, a cobblestone banner pattern, a crayon flag frame and a street lamp over
  the capital on the map (`WS_KEEP`). A vetoed letter brings neither.
- *Storage.* `n.ws` is in the private half (`NX_KEYS`): `{v: 1, e, c: [{o, f, b, t, x, n}], x, d?, m?}`, the
  resolved letters in order (answer 0–2, or -1 filed unanswered; family and bands it arrived under; time;
  the ruling as recorded; title). `n.wsl`, the land the letters brought, is in the shared half so every
  player counts the land the same way. The normaliser bounds every field, drops unknown facts, keeps the
  resolved letters up to the first unreadable one, and takes a waiting letter whose context cannot be read
  off the desk (it comes back at the next slot). Saves use the ordinary revision check: a stale device's
  answer is refused, never merged.
- *Older nations.* A nation saved before the letters starts at letter I. Its count starts from the best
  lifetime record it has, the larger of `n.dec` (decisions made) and its tally of enacted edicts
  (`tly.iss`); both began, for the oldest nations, from the recent history of at most 80 decisions, so
  the count can be lower than the true total but never higher, and the letters it has already earned
  then arrive one per slot. A record saved by an older copy of the game, which drops `ws`, recovers which
  letters were resolved from the seen-edict list and the recent decisions, so none is sent twice.
- *Text.* `WS_STORY` is a catalogue in `scripts/split-content.mjs`, so its text is cached with the
  edicts. Conditions inside the text (`[[bk:open|…|…]]`) are read by a small parser in the same section
  (`wsCond`); there is no `eval`. `test/willow-street.test.mjs` (in `test:fx`) checks every version,
  every band combination and random playthroughs; `npm run test:willow` plays the story in the real game.
  New edicts go after the letters (their numbers follow every other edict's), so nothing is inserted
  before them.

**Letters from Mission Control.** A space programme told through fourteen letters from Dr. Lyra Okafor,
the director of the nation's space agency, from a borrowed classroom to the first night on the Moon. It
follows Willow Street's design (frozen context per letter, `fdFam` families, freedom bands, laws, facts
from earlier answers) and adds a playable agency on the Space page.

- *The agency.* Once the Space page is open (its edict, below) and the capital is settled, Space › Mission
  Control founds and names the agency and funds
  one team first: Science & Survey (borrowed telescope time), Flight Operations (a small camera test) or
  Engineering & Logistics (an old tracking station restored for observing time). Each first assignment
  costs a few resources and takes 15 to 45 minutes, so the first image comes in the opening session. The
  other teams join for a few resources. One mission slot at first, two once Mission Control is built.
  Missions (`MC_MS`) are timed like buildings (`{s, d}`), so they finish offline and on every device; the
  page shows the job under way, the time left, the next requirement with a direct build or start button,
  and what each mission will reveal.
- *Buildings* (`BUILDINGS`, section "Mission Control on the Space page"): Mission Control (from the start,
  4 h; the second slot), Deep Space Tracking Station (15 million people, 8 h; receives the relay's data and
  charts any sector on request), Robotics and Landing Lab (75 million, 12 h; the rover) and Crew and Habitat
  Centre (1 billion, Science 60, 24 h; the habitat test, crew and cargo planning). One per nation; a building
  in any city the nation holds counts. The Observatory, the Space Port and the Lunar Colony are reused: an
  Observatory makes the telescope route quicker and, like a Space Port, credits the first image or flight.
- *The chart.* The Space page's Moon starts black for every nation: the real lunar map under a mask of
  160 sectors (`MC_SEC`, 0 uncharted, 1 seen from orbit, 2 charted). `mcReveal` derives the mask from the
  missions flown and the story's facts (a crescent, an orbital strip, the near side, a far-side belt, the
  poles and three candidate landing sites, the rover's ground, the beacon, the corridor), so nothing extra
  is stored. Feature names and tile details appear only in charted sectors, and other colonies' names stay off the chart. The Lunar
  Colony still opens the shared settlement map and the ordinary landing, whose checks run at confirmation;
  the landing panel offers the preferred surveyed site and the free alternatives.
- *The letters* (`mc-1` … `mc-14`, after every other edict, never random). Letter I needs 50 enacted
  edicts on Willow Street's lifetime count (`n.ws.e`, which no longer counts story letters). Each ordinary
  slot that could take it rolls one in 8 from the slot's own time and the seed, the misses are kept
  (`n.mc.r`, `n.mc.rt`), and the 12th eligible slot brings it regardless. A full desk, a holiday, a
  follow-up or a Willow Street letter that is due takes the slot without a roll. Each later letter arrives
  through an ordinary slot once its mission or building has happened (`mcReady`) and the nation has
  enacted its gate of edicts (`MC_GATE`: letter II at 100, then 200, 400, 800, 1,000, 1,300, 1,800 and IX at
  2,000; X to XIV at 2,000 too), one on the desk at a time. A veto means the proposal failed; the missions
  never wait for a letter. "Fly Me to the Moon" is
  chapter IX now (the settlement charter), so the old edict left the random pool.
- *Eight governments.* 112 versions (`MC_STORY.fam`), each family with its own speakers and dilemmas;
  chapter IX is an elected commission or an appointed director (Senate), royal patronage or a civilian
  charter (Crown), frontier command or civilian science (Empire), a freight concession or public control
  (Divan), protected ground or sample collection (Synod), crew elections or central appointment
  (Congress), overseas funding with strings or local authority (Governor's Council), shared funding or
  the local rates (Borough). An answer's `cg` line goes into the cargo manifest only if it was chosen, so a
  refused contract never flies.
- *Gold.* Every letter from Mission Control has a 2 px `--mc-gold` border and a "Mission Control · Letter N
  of XIV" label, on the Edicts desk, opened and answered, in every theme.
- *Mandate.* Three spends from the Government page's mandate (`MC_MD`: second staff 2, an earlier relay
  window 3, a parallel review of the crew and cargo plans 4), priced by `mdCost` like any decree, each once,
  charged in the same commit as its effect and counted in the leader's record. Publishing the far-side
  charts gives 1 back and the first night 2, once each.
- *Older nations.* A Lunar Colony under construction, a finished one or a landed colony credits the
  programme's missions and buildings from the saved facts, so a veteran's letters arrive one slot at a
  time. A crewed landing prepared by the agency gives the colony two expansion points, once.
- *Storage.* `n.mc` is private (`NX_KEYS`): `{v, a, ms, c, x, r, rt, md, pf?, xn?, ld?, p?}`, bounded by
  `mcNorm`. `test/mission-control.test.mjs` (in `test:fx`) covers the roll, the guarantee, blocked slots,
  prerequisites, vetoes, a change of government, the chart, the mandate, veterans and two devices;
  `npm run test:mission-control` checks the page, the chart, a landing and the gold border on a desktop and
  a phone in both themes.

**The Space page opens with an edict.** A new nation does not see Space in its menu, the More sheet, Settings ›
Navigation or Go to page; `#space` explains what opens it and shows the count so far. Once it has enacted
`SPX_AT` (25) edicts on Willow Street's count, the next ordinary arrival slot brings "Class 4B Would Like to Know"
(`mc-pre`, text in `MC_STORY.pre`), after any follow-up or Willow Street letter that is due: certain, not rolled.
Thirty-one schoolchildren ask who in the nation has the Moon as their job, with a postscript from Dr. Okafor,
whose observatory budget has just been cut. Three ministers answer: a Ministry of Space Affairs in the
Education building (backs Science & Survey), the old tracking dish behind the weather station (Engineering &
Logistics) or the army range's sounding rockets (Flight Operations).

- Any answer opens the page (`n.mc.p = {o, t}`); the team it backs is chosen already in the agency's founding
  form. A veto (`{o: -1, t, e}`) puts the question off until `SPX_AGAIN` (5) more edicts have been enacted.
  It is a story edict: it does not count towards the 25, and it wears Mission Control's gold on the desk.
- Dr. Okafor's first letter waits for the page to be open, and its dice are not rolled until then.
- A nation already in space keeps the page and never sees the prelude (`mcVet`): a founded agency, a letter
  from Mission Control resolved or on the desk, a colony on the Moon or Mars, the belt, or the Lunar Colony
  wonder begun.
- *The tour.* The first visit to the open page starts the space guide `s` (`TUT_GUIDES.s`, beside the Moon,
  Mars and belt guides): eight steps that light up the agency, its teams, the missions under way, the next
  step, the survey chart, the buildings, the letters and the road to the Moon, and end with what to do now.
  On a wide screen it sits beside its target, or above or below it when the target spans the page; on a
  phone it docks. It is remembered in `n.tut.g`; "Tour of this page" and How to play bring it back, and How
  to play has "The Space page, step by step".
- Tests: four more in `test/mission-control.test.mjs`, and `npm run test:space-gate` (the closed page, the
  gold edict, an answer, the tour step by step, a veto, on a desktop and a phone in both themes).

**Portraits of the government.** The cabinet's medallions (`cvMed`, a bust in profile in one ink) can be dressed
in Customise › Portraits, which "Edit portrait" on every cabinet card also opens. A face without a look is drawn
exactly as before (`ptBust` makes the same draws as `cvBust`); a look overrides the skin (`s`: 0 is the engraving
in one ink, 1–8 the colours in `PT_SKIN`), hair (twenty kinds: the six a name draws, then a powdered wig, a tied
queue, a topknot, a braid, bald, curly, a ponytail, a bob, a pompadour, receding, locs, long waves, cornrows and a
long plait; the newer ten in `ptHairNew`), nose, chin and brow, facing, grey hair, facial hair, headwear, dress
(fourteen kinds, the last five a sash of state, white tie, a mandarin collar, a wrap robe and a breastplate) and
one detail. Every part's name in the editor opens the whole list (a native select over the stepper). With a skin
colour the bust is filled in the skin and outlined in the ink, the face gets its features in the skin's darker
tone, and the clothes (the outline below the neckline, cut from the same curve with `ptSeg`) and hair stay in the
ink; banknotes always engrave the look without the skin (`ptPrint`). The head of government also picks an ink, a
ring and a nickname earned in office (`PT_NICKS`, from the tallies since the term began, `n.ptz`), and a caption
is written from the records. The Shop's Mayan Pack sells twelve more pieces (`PT_SHOP`: hair 20–21, headwear 11–13,
dress 14–16, details 7–8, ring 5 and the jade ink), and every other pack two (headwear 14–17, dress 17–19, details
9–13, rings 6–9, the Tyrian and Hologram inks; the pack is the piece's UNLOCKS `src`, `ptPackOf`). They are held as
any Shop cosmetic is (`czHolds`): left out of the lists unless held or their pack is on sale (`ptPackSells`), tried on
by anyone, saved once held, and dropped from another nation's portrait by `ptKeep` unless its finery has them. The
flag lapel pin prints the nation's flag and the Microprint ring its name (`ptNat`, read by `ptMedHTML`).
- *The record.* Shared, so visitors see it: `n.rpt` (the leader: `s` the seed the face first came from, pinned
  when the leader is renamed so the face stays; `l` look, `i` ink, `r` ring, `k` nickname, `f` the portfolio
  they held, `b` birthplace), `n.cpt` (each minister's own look, with their name; dropped when the post changes
  hands) and `n.cdc` (the cabinet's dress code, worn by every minister and candidate under their own choices).
  Private: `n.ptu` (pieces earned in play, `PT_LOCK`) and `n.ptz`. A minister who takes over brings their face
  and look; the leader who leaves keeps their portrait in `n.cuS[].p`, so the Museum's Former leaders and the
  old banknote series show them as they were.
- *Earned pieces.* The laurel wreath (a Games gold), crown (30 days in office), bicorne (land taken in a war),
  liberty cap and mortarboard (Civil Rights or Education at 80), toga (a wonder), ermine robe (60 days), chain of
  office (10 cities), order star (100 achievements), medal (any Games medal) and the laurel ring (the court
  painter's edict). Anyone can try them on; saving waits until they are earned. No shop pack.
- *The court painter.* `PT_ISSUES` (one edict, after the crises and gambles): as they are, in the manner of the
  old emperors (laurel, ermine and a laurel ring, earned at once) or the whole cabinet; the Dispatch reports it.
- *The charter.* "Customise your leader" (tutorial key `portrait`, right after Name your leader, so Finish your
  charter waits for it) pays 5 land credits, 25 goods, 25 food and 50 timber once the leader's portrait is saved with a
  look, an ink, a ring or a nickname; its button opens Portraits on the head of government.
- Tests: `test/portraits.test.mjs` (in `test:fx`) and `npm run test:portraits` (looks, the dress code, earned
  pieces, a rename, a succession, the Museum, banknotes, the edict and a reload, on a desktop and a phone in both
  themes).

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
a message and, if the player wants, an email address. A ticket is a conversation: their tickets are listed
below it with every message from them and from the team, they write back while it is open, close it when
they need nothing more, and can open it again by writing in it within 14 days of its closing (three messages
in a row at most, until the team replies). A reply from the team brings a toast (on the next page load, or
within five minutes) and a number on the Help menu item until it is read. Admins work on the portal's
**Help queries** page (`#admin-help`), in three lists (To answer, Waiting for the player, Recently closed):
**Send reply** keeps the ticket open for the player, **Send and close** ends it; a ticket can also be closed
without a reply, reopened, or deleted as spam. Banned players can still send tickets, and write back, to appeal.

**Deleting an account.** The account menu's **Delete my nation and account** removes the player's
posts in every region, their support tickets, their nation, summary and space record, their pacing records and their
account (a Google account is asked to confirm the sign-in first). The next day's currency job deletes the
currency's history (`fxh/`). The daily backups lose it within 14 days.

**Privacy and terms.** `src/privacy.html` and `src/terms.html`, with Spanish versions
`src/privacidad.html` and `src/terminos.html`, are served as `/privacy`, `/terms`, `/privacidad`
and `/terminos`, each with a button to the other language. The game links to them from the side
bar's foot, the founding page and the account menu. The notice follows Mexico's LFPDPPP (ARCO
rights) and keeps GDPR rights for players in the EU; the terms are under Mexican law.

**Visit statistics.** Google Analytics, only with the visitor's consent (`src/shim.js`, "visit
statistics"). The measurement ID is the `measurementId` Firebase serves in `/__/firebase/init.json`
once the project is linked to Google Analytics (Owner setup, step 9c); without one, or on `localhost`
or a `demo-` project, nothing happens. Otherwise a card at the bottom of the screen asks once: **Allow**
loads Google's `gtag.js` (the same tag Firebase's analytics SDK wraps; the compat SDK cannot switch off
its automatic page views or ad signals) and **No thanks** loads nothing. The answer is kept in
`localStorage` (`edictum.analytics`: `y` or `n`) and can be changed in the account menu or on the privacy
notice, which share it with an open game tab; turning it off withdraws consent and deletes the `_ga`
cookies. Pages count by the first part of the address alone (`#visit/<id>` is `/visit`) with the page's
title, never with a player ID or a nation; advertising storage, Google signals and ad personalisation are
off. `test/analytics-e2e.mjs` checks all this with a stand-in for `gtag.js` (`window.EDICTUM_ANALYTICS_ID`
supplies a measurement ID on the emulators).

**Speed statistics.** Firebase Performance Monitoring, with the same answer (`src/shim.js`, "speed
statistics"). Only after **Allow** does the shim load `/assets/perf.<hash>.js` (the SDK's compat build
from `node_modules`, about 40 KB, after start-up has finished); it then reports the page load (first and
largest contentful paint, layout shift, interaction delay), each download's time and three of the
game's own traces: `game_start` (from the first byte to playing, with `script_ms`, `wait_ms`,
`config_ms`, `firebase_ms`, `sign_in_ms` and `account_ms`, and whether the player is a `guest` or
`linked` on a `first` or `returning` visit), `nation_load` (the first read of the player's own nation)
and `nation_save` (each save, with its `result`: `saved`, `conflict` or `failed`). The SDK reports the
address of the page and of every download, so `build.py` edits two of its lines (`PERF_EDITS`; a newer
Firebase that changes them stops the build): the page's address loses its `#hash` (`#visit/<id>`), and
download addresses go through `src/perf-url.js`, which keeps only the host of other sites and turns
anything ID-like in this site's and Firebase's paths into `*` (`documents/nations/*`). Turning
statistics off stops it, and on the next page load deletes its settings and the browser's Firebase
installation ID (`firebase-installations-database`); the privacy notice does the same. Off on `localhost`
and `demo-` projects, unless a test sets `window.EDICTUM_PERF`. `test/perf-e2e.mjs` checks it with
stand-ins for Google's installation, configuration and logging calls, and reads the logs the page posts;
`test/perf-url.test.mjs` checks the masking.

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
checks) gets a loading screen only if startup lasts more than 350 milliseconds. The saved theme is
applied in the page head, preventing a light/dark flash. Content and code are preloaded ahead of
the Firebase SDK; slow or failed downloads retain visible feedback. `npm run test:startup` checks
the real browser cache across a simulated code update, saved themes, phones and failure handling.

**Sign-in.** A new visitor is signed in as an anonymous guest straight away and can play at once.
The account control (at the foot of the side bar, or at the top of the founding screen) offers
**Keep your nation on every device**, which links the guest account to Google, Discord or an email
address so the same nation loads anywhere; a Registered Nation can add the others. If that sign-in
already has a nation, a guest can switch to it (asked first while it has a nation of its own). A
linked player also has **Sign out** under the control in the side bar (it asks first; a guest gets
none, since a guest who signed out would lose the nation). Signing out starts a new guest.

Above Sign out, a small status shows **Synced** after server confirmation, **Saving** while changes
are queued or in flight, and **Offline** when synchronization is unavailable. Guests with a nation
see the same status. Its text is announced to screen readers when it changes.
Linking is also one of the First steps: it pays 5 land credits and 5 iron, 5 timber and 5 goods,
once (`n.glk`). The step after it, **Say hi**, needs the linked sign-in, because only a Registered
Nation may post on the region's board: a message or a reply there pays 2 land credits, 5 of each
resource and Orchid, a thirteenth map colour (`mapc` on the task), which Settings shows locked until then.

- **Google** is Firebase's own provider (`linkWithPopup`).
- **Email** sends a one-time sign-in link (Firebase's email-link sign-in, a `password` provider without
  a password). Opened in the same browser it finishes at once; in another browser the page asks which
  address the link went to. Firebase counts a failed attempt to link an address that already has an
  account as the link's one use, so switching then sends a fresh link, which switches when opened.
- **Discord** is not a Firebase provider: `functions/discord.js` exchanges Discord's one-time code
  (scope `identify` only) for the Discord account's id, keeps `discordLinks/<id>` → player id, and puts
  the id on the account as a custom claim (`dc`, with the name in `dcn`); signing in elsewhere uses a
  custom token for that player id. The window goes `/discord` → Discord → `/discord` (`src/discord.html`),
  which leaves Discord's answer in localStorage for the game's page. Firebase's own OpenID Connect
  providers would do the same but are billed from the 50th monthly user; custom tokens are free up
  to 50,000. It runs in the `accounts` callable (op `discord`), not a function of its own: a new
  public function needs its Cloud Run invoker set, which the deploy's service account may not do.

Deleting a nation and account ends the account on the server (`accounts` op `close`), so it works
however long ago the player signed in, and frees a linked Discord account.

**Guest and Registered Nations.** Registration is determined from live Firebase Auth linked providers (and the `dc` claim of a linked Discord account);
recovering a Guest Nation with a custom token does not register it. The first saved guest nation receives
one 160-bit recovery code, shown until the player acknowledges saving it. Only its SHA-256 hash is stored
on the server. A lost code cannot be read back. An authenticated Guest can explicitly regenerate it;
replacement atomically revokes the old key without changing the UID, nation age or active sessions.
Version checks prevent simultaneous replacements from revoking a newer key, retries are idempotent,
and replacements are limited to one per minute. Revoked hashes retain only a non-identifying tombstone
to prevent reuse. The browser persists an unfinished replacement so interrupted responses can be retried.
Without an active session or a working code, access cannot be recovered. Registered Nations recover through linked
sign-in, and a former Guest code stops working after linking. `LINK_OPTIONS` in `src/shim.js` is the
account panel's provider list (Google, Discord, email); a Discord link counts through its `dc` claim.

`functions/eligibility.js` checks linked identity, a trusted nation creation timestamp, bans, moderation
and region availability. Assembly participation requires 24 hours of nation age. Community topics,
alliance founding/management and offensive wars against players require registration. Guests retain
ordinary gameplay, NPC battles, defence, reading debates, reports and support.

Assembly actions use the `civic` callable and protected `assemblyRegions/` records for actors, proposals,
per-cycle votes, locked resolutions, results and leadership. Legacy national history stays in the private
save; legacy JSON votes and proposals never become authoritative automatically. Nation saves first get a
two-minute server permit for their exact public JSON and revision, then use the existing atomic save.
The server injects the canonical Assembly projection and checks sensitive multiplayer changes. This
also means browsers left open on an older release must reload before they can save again.

The generated Assembly engine reuses the game's election, proposal selection and NPC voting algorithms.
Regenerate its trusted catalog and source with `node tools/build-civic.mjs` after editing those algorithms.

**Recovery runtime setup (once per project).** As a project owner, run
`node tools/setup-recovery-runtime.cjs --project <project-id>` to inspect, then add `--apply` to enable
`iamcredentials.googleapis.com` and grant the existing runtime **Service Account Token Creator on itself**.
This is required by Firebase Admin custom-token signing (guest recovery and Discord sign-in); it grants no
role on other service accounts.
Run for staging and production before releasing recovery. The command preserves existing IAM bindings
and their etag. See [Firebase custom tokens](https://firebase.google.com/docs/auth/admin/create-custom-tokens).

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
can make up accounts, and "Continue with email" puts the link in the emulator's outbox (the Auth tab of
the emulator console, or `/emulator/v1/projects/demo-edictum/oobCodes`). Discord needs the real
Discord, unless the page sets `window.EDICTUM_DISCORD_EMU = {id, name}` first (the emulators then
stand in for it, as `test/signin-e2e.mjs` does).

`npm run emulators` does the build and the start in one go. After changing `src/` or the game,
run `python3 build.py` again and reload.

### Tests

```sh
npm run test:fx            # the currency engine and the game's currency helpers (no emulator)
npm run test:rules         # the security rules, and the daily currency job (Firestore emulator only)
npm run test:referee       # the referee: readiness, fair dice, the odds' bound, seals (Auth, Firestore and Functions emulators)
npx playwright install chromium   # once, for the browser tests
npm run test:e2e           # two players, the board, other regions, reloads, rules, battles and seals, admin, offline, Google sign-in, full regions, founding drafts, the front page
npm run test:signin        # email-link and Discord sign-in: linking, another browser, switching, deleting
npm run test:smoke         # every page of the game at 1280 and 390 px wide, in two regions
npm run test:sync          # one account on desktop and phone: updates, conflicts, clocks, reconnects, a dead listener, a new build
npm run test:startup       # first load, cached updates, loading feedback and saved themes
npm run test:admin-e2e     # admin console, region access and maintenance messages
npm run test:devnews       # development news: the editor, images, the menu's count, comments and moderation
npm run test:buildings     # the later buildings: plans, completion, city effects, edict boosts, the Central Bank
npm run test:bugs          # Report a bug: the form, screenshots, pacing, the admin page, notes, deleting
npm run test:hidden-land   # a hidden nation keeps its land; a woken nation's welcome back and free move
npm run test:edict-inbox   # edict topics, read and pinned states, follow-up recaps
npm run test:willow        # Letters from Willow Street: a milestone, a change of government, reloads, a second device
npm run test:mission-control # Mission Control: the agency, the chart, the mandate, a landing, the gold letters
npm run test:space-gate      # the Space page: closed until its edict at 25, the edict, a veto, the tour
npm run test:portraits       # portraits of the government: looks, dress code, earned pieces, rename, Museum, edict
npm run test:unlock-links  # achievement and museum notifications link to each unlock
npm run test:map-development # city production areas, networks, saved plans and island annexation
npm run test:flag-layers   # flag layers, touch and keyboard editing, Undo and shared designs
npm run test:rank-borders  # every rank of prestige and the border it puts round the nation card
npm run test:warehouse     # timed storage upgrades, rewards, persistence and warehouse edicts
npm run test:ux-polish     # search, Back/Forward, remembered sections and requirements links
npm run test:onboarding    # charter, gradual feature reveals and saved progress
npm ci --prefix jobs/fx    # once, for the next two: they run the currency job as production does
npm run test:fx-e2e        # the currency: the job publishing four days, the Bureau, the designer, a phone
npm run test:currency-gameplay # trade, policy confidence, currency prose and counterfeiting
npm run test:shop           # the shop's rules alone: signatures, the Founder's deadline, refunds, the Chancery Club, the desk
npm run test:shop-backend   # the shop's server against a stand-in for Paddle (Auth, Firestore and Functions emulators)
npm run test:shop-e2e       # buying, wearing and verifying shop cosmetics, the Chancery Club and its desk of ten
```

Screenshots from the browser tests go to `test/out/`. `python3 build.py --no-minify` keeps the code readable for debugging.

Every pull request runs all twenty-two browser suites as independent parallel jobs on GitHub Actions
(`.github/workflows/preview.yml`), alongside the backend checks and staging preview. Each browser job
has its own runner and fresh emulators; suites cannot share an emulator because they reset its data.
The core game's scenarios keep their existing order within their suite. Run an individual command
above when working on that feature; there is no need to run every browser suite locally. Local commands
use the same emulator ports, so run them one at a time unless you give each a separate environment.

One failing suite leaves the other suites running, and each failed job keeps its own screenshot artifact.
The existing **Test the game end to end** check now aggregates the browser jobs and passes only when
all twenty-two succeed. It also fails if a suite is cancelled or skipped, keeping the release gate intact.

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

**The idle test.** `test/idle.mjs` opens the Nation page in Chrome and reads what the main thread does
while nobody touches it, while it scrolls and while a pointer crosses the banner: its busy time, and from
Chrome's own trace the frames the page asked for and what each cost. It counts frames from the trace, never
with a `requestAnimationFrame` loop of its own, which would keep Chrome drawing and charge every frame to
the page. It serves `public/` itself (the game's local mode, no emulators); `IDLE_PROFILE=phone` is a
390 px phone at a quarter of the CPU, and `IDLE_PUBLIC` points it at another build to compare:

```sh
npm run test:idle                                   # Playwright's Chromium (software drawing)
IDLE_CHANNEL=chrome IDLE_PROFILE=phone node test/idle.mjs   # the installed Chrome, on the GPU
```

## Owner setup

Do these once, in your browser. The referee (a Cloud Function) needs the Blaze plan, so each
project needs a billing account (see Costs).

### 1. Create the Firebase project

1. Go to <https://console.firebase.google.com> and choose **Create a project**. Pick a name; note
   the **project id** it shows (for example `edictum-4f2a1`). Google Analytics is optional (step 9c).
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
4. **Sign-in method** → **Add new provider** → **Email/Password** → switch on **Email/Password** and
   then **Email link (passwordless sign-in)** → **Save**. The game offers no passwords; a password
   account counts as registered only with a verified address. Under **Settings** → **User actions**, keep **Email enumeration protection** on. Under
   **Templates**, the sign-in email names the project's **public-facing name** (**Project settings** →
   **General**): set it to Edictum. Firebase sends up to 25,000 sign-in emails a day on Blaze (5 on Spark).
5. **Settings** → **Authorised domains** already lists `localhost`, `<project id>.web.app` and
   `<project id>.firebaseapp.com`. Your own domain is added in step 8.

### 3b. Discord sign-in

Discord does not go through Firebase's provider list (no OpenID Connect provider is needed; see
**Sign-in** above), but through the `accounts` Cloud Function and a Discord application of your own:

1. <https://discord.com/developers/applications> → **New Application** → name it Edictum. Under
   **General Information**, add the app icon, and the privacy notice and terms addresses
   (`https://edictumgame.com/privacy`, `https://edictumgame.com/terms`).
2. **OAuth2** → **Redirects** → add `https://edictumgame.com/discord` (and
   `https://<project id>.web.app/discord` if players use that address). Each address must match
   exactly; preview channels cannot sign in with Discord. Note the **Client ID**, and **Reset Secret**
   to see the **Client Secret** once.
3. On your computer, in this repository, with the same service account key as for making an admin
   (step 9):
   ```sh
   cd tools/admin && npm ci
   GOOGLE_APPLICATION_CREDENTIALS=/path/outside/the/repo/service-account.json node set-discord.mjs <client id>
   ```
   It asks for the client secret and keeps both in Firestore (`authConfig/discord`, which only the
   functions can read). Add `--origins https://edictumgame.com,https://<project id>.web.app` to change
   the addresses allowed to sign in (by default edictumgame.com, `<project id>.web.app` and
   `<project id>.firebaseapp.com`); `--off` switches Discord sign-in off.
4. The function signs players in with custom tokens, so the runtime needs **Service Account Token
   Creator** on itself (**Recovery runtime setup**, above), as guest recovery does.

Until then, "Continue with Discord" says that Discord sign-in is not set up yet.

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
pinned packages, runs `build.py`, deploys the functions, the Firestore rules and indexes, then the site. If the
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

Inspecting a player also shows the account behind the nation, read by `adminConsole` from Firebase
Authentication, never from the nation's own record: Guest or Registered (and Admin or Disabled),
the linked sign-ins (Google, Email link, Discord; Discord is the `dc` custom claim), the last
sign-in, the last token refresh, and the IP address the player last played from. Firebase keeps no
IP address, so the game records it: once a page load the shim calls `accounts({op: 'seen'})`, which
keeps only the latest address in `accountSeen/<uid>` `{ip, at, exp}` (the last `X-Forwarded-For`
entry, the one Google's front end adds; at most one write an hour from the same address). The
`accountSeen.exp` TTL policy deletes it 90 days after it was last seen (`SEEN_DAYS` in
`functions/accounts.js`, stated in both privacy notices), and closing the account deletes it at once.
No client can read or write it. From the same panel an admin can hide, delete or ban any nation,
with or without a report, force a rename, and unhide or unban it: each needs a reason (which the
player is told), every one is confirmed first, and all of them run the reports' moderation path, with
its audit events. Reports, Hidden nations, Banned players and Suspicious link to the panel.

A forced rename (`moderate` action `rename`) sets `mod/<uid>` `{hidden: true, rename: true, name}`,
so the nation leaves everyone else's view as a hidden one does. Its player sees a card at the top of
every page asking for a new name; the name is saved like any other change, and then the game calls
`civic({op: 'renamed'})`, which unhides the nation only if the saved name differs from `name` (ignoring
case, accents and spacing) and records a `renamed` audit event. A name saved but never confirmed is
confirmed on the player's next visit. Unhide cancels the rename.

The panel also keeps **staff notes** on each player: one private text (up to 4,000 characters) in
`staffNotes/<uid>` `{text, at, by}`, read and written only through `adminConsole` (`op: 'note'`); no
client, admin or not, can reach it directly, and the player never sees it. Each save is an audit
event (`note_saved` or `note_cleared`) that records who changed it but not the text, so saving an
empty note deletes it for good, and closing the account deletes it too.

Save health combines `saveHealth/` session reports with actual `nations/` server timestamps and
revisions. Reports contain only player ID, region, a Desktop/Mobile label, status, pending flag,
revision, error code and conflict count. Status changes are coalesced to at most one write every
15 seconds, with a heartbeat once a minute for visible sessions. An offline browser cannot report
live status: the console marks sessions unseen for five minutes as not recently seen. It shows up
to 250 reporting sessions from the last day, not a guarantee that every player has reported.
Reports expire after seven days via the `saveHealth.expiresAt` TTL policy and are removed when
the player deletes their account. Diagnostics never block a nation save.

The same reports give the **online dot** on the Region page's Nations tab: `civic` (`op: 'online'`,
`functions/presence.js`) answers `{reg, u: {uid: seconds since the last report}}` for every player of
the region whose newest report is under 15 minutes old, and never the reports themselves. It reads
the region once a minute per function instance however many players ask (index `saveHealth (reg, t)`),
and the page asks at most every two minutes while it is in view. A player who unticks Settings ›
Account › Online status (`dmx.on: 0`, the private half) sends `ho: true` with each report, and the
server leaves them out.

Region control uses the staff-only `adminConsole` Cloud Function. Missing `regionStatus/<id>`
documents mean enabled. Disabling greys out the region on the founding page, blocks founding,
moves and saves in the rules/adapter, and blocks battles in the referee. Connected and returning
players see the matching unavailable-region message; existing nation data is kept. Re-enabling restores access.
Admins retain console access when their own region is disabled. No region is disabled by deployment.
Disabled regions have two player-facing statuses: **Maintenance** and **Coming soon**. Choose the
status when disabling a region, or use **Change status** on an already disabled region. Both remain
greyed out and block access, but use different badges and messages. Older disabled settings without
a status remain Maintenance. Status changes are included in the private audit history.

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

**Moderators.** `node set-admin.mjs <email or player id> --mod` makes a player a moderator (`--mod --remove`
undoes it). A moderator gets no admin portal: they see **Remove** on every comment under the development
news, and each removal is kept in `adminAudit/` with the comment's text. Like Assembly actions and board
posts, commenting needs a linked sign-in, so link the moderator's nation first.

**Development news.** Admins write posts in the portal under **Game content › Development news**: a title,
formatted text with images (pasted, dropped or chosen; made at most 1600 pixels wide in the browser and kept
in Firestore, `devnewsImg/`), signed with a name and role or as their nation. Players read them on the
**Development news** page under **Other** in the menu, which shows a count of new posts until they open it.
On the page, admins can edit, delete or close the comments of a post, and remove a comment, hide its nation
or ban its player; reported comments arrive in the Reports queue as *News comment*.
The editor's toolbar also inserts a **game link** (a button that opens a page of the game; each player's first
click per page counts in `devnewsStat/<post>.g`) and a **balance table** (Change, Before, After: each row is
marked as going up or down; press Table again inside one to add a row). A post marked **Important** sends a
notification once, when it is published, to every device of every player who turned notifications on in
Settings › Letters and is not in the game just then (accounts `{op: 'letters', step: 'news'}`,
`functions/letters.js`; a player can turn these off there), and stays pinned in their bell until they read it.
A poll can let a nation pick up to six answers; its results show region by region, and once it closes the post
names the winner and the bell tells each voter. Comments can be upvoted and sorted by upvotes, and a reply from
the team is marked as its answer. Older posts fold to a card; a long post opens with its contents. Reading posts
and voting in polls count towards six achievements (never commenting). The portal's list shows each post's
reads, reach (reads as a share of the nations that played in the week after it came out), comments, link
clicks, and the letters by post and notifications that carried it.

**Report a bug.** Players report bugs on the **Report a bug** page under **Other**: a title, what happened,
where in the game, how often, and a screenshot if they like (chosen or pasted; made at most 1600 pixels wide
in the browser, `bugImg/`). The game adds technical details (the game's version, browser, screen, language,
connection, the nation's size and the last errors the page hit) and shows them before sending, one report a
minute (`bugs/`, `blimits/`). Admins read them in the portal under **Support › Bug reports**, which counts the
new ones: they look at the screenshot, mark a report *Confirmed*, *Fixed* or *Closed* with a note, or delete it.
The player sees the state and note under *Your reports*, and is told on their next visit when it changes.
Reports stay until the player or an admin deletes them, or the player deletes their account.

**Later buildings.** The Central Bank, Courthouse, Public Baths, Recycling Works, Nature Reserve, Observatory
and Hanging Gardens (section *seven more buildings* in `game/edictum.html`) have twenty edicts of their own,
which arrive only while the building works. Eight of their answers grant a small boost as a law (for example
*Court Fees*: Courthouses use no goods), which does nothing without the building. The Central Bank also
reaches the daily currency job: `jobs/fx/engine.mjs` halves how far a currency with a finished bank moves in
a day, and halves the damage of forged notes (a quarter more with *Holographic Banknotes*).

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

### 9c. Google Analytics (visit statistics)

Optional: without it the site never asks (see Visit statistics). `edictum-b30de` is linked already
(measurement ID `G-NYEX5KTEYJ`).

1. Firebase console → **Project settings** → **Integrations** → **Google Analytics** → **Enable**, and
   choose or create a Google Analytics account. The web app's configuration then has a `measurementId`,
   which Hosting serves at `/__/firebase/init.json`; the site picks it up on the next page load, with no
   deploy.
2. In Google Analytics (<https://analytics.google.com>) → **Admin**, so that the privacy notice holds:
   - **Account details**: accept the **data processing terms** (Google is then a processor), and turn
     the **data sharing settings** off.
   - **Data collection**: leave **Google signals** off (the site also tells the tag so).
   - **Data retention**: 2 months (the default) or 14 months; the notice promises at most 14.
3. The web stream's **Enhanced measurement** can stay as it is. The site switches off the tag's
   automatic page views (`send_page_view: false`), which also stops the history-based ones, and sends
   its own with the cleaned address, which it also sets (`gtag('set')`) for the tag's other events
   (scrolls, outbound links, downloads).

### 9c1. Performance Monitoring (speed statistics)

Nothing to switch on: the dashboard is in the Firebase console under **Performance**, and fills once
players who allowed visit statistics have played on a deployed build (the first numbers can take up to
a day). Custom traces are `game_start`, `nation_load` and `nation_save` (see Speed statistics).

1. If the **Browser key** (Google Cloud console → **APIs & Services** → **Credentials**) has API
   restrictions, add **Firebase Installations API** and **Firebase Remote Config API** to them. Without
   the first nothing is sent; without the second the SDK falls back to its default settings. A key
   without restrictions needs nothing.
2. Optional: pin the custom traces to the Performance dashboard's metrics board, and set alerts on them
   or on page load time from the same dashboard.

The privacy notice states Google's retention for it: 30 days for events linked to an IP address,
60 days for those linked to an installation ID or de-identified (<https://firebase.google.com/support/privacy>,
checked 12 November 2026).

### 9c2. The Statistics page and its nightly record

The admin portal's **Statistics** tab (`#admin-stats`, under World) shows how players use the game, for all
regions or any one region: who is active (now, today, this week, this month), nations founded and new visitors
day by day, how many keep playing after a day, a week or a month (also per founding week), when edicts are
decided (weekday by hour, in the admin's own time zone), edict pace and full desks, the most decided edicts and
their favourite answers, every tutorial step, which features active nations use, guests against linked
sign-ins, desktop against phone, and a table of the regions. Choosing a region lists its nations (public data:
name, population, founding, last activity, edicts decided) with **Inspect player** beside each.

`adminConsole({op: 'stats', reg})` counts it on the server (`functions/stats.js`): it reads every nation and
its private half once, lists every Firebase Authentication account, and keeps the result ten minutes per
instance (**Count again** counts afresh). That is two document reads per nation, plus one per 1,000 accounts,
each time it counts. Only counts leave the server, apart from one region's nation list.

How many played on a given day cannot be worked out later (a nation keeps only the time of its last save), so
`.github/workflows/stats.yml` runs `jobs/stats/run.mjs` every night at 00:07 UTC (and 03:53 as a safety net; a
recorded day is left alone) and keeps the day's headline figures in `statsDays/<date>`, which the page draws
as *Players active each day*. It uses the same secret and variable as Deploy; the service account also needs
to list Authentication users, which the **Firebase Admin** role of step 5 includes. The chart starts on the
first night after the workflow reaches `main`; **Actions** → **Statistics** → **Run workflow** records the
last 24 hours at once, as that day's point (the night's run then leaves that day alone). The rules refuse
`statsDays/` to every client.

The page also has an **Onboarding funnel** (the nations founded in the last eight weeks, a row per founding week,
the share that has settled, claimed land, started a building, decided an edict, founded a second city, finished
the charter and linked a sign-in; choose a cell to list who is stuck there), release markers (◆) on the day charts
for each development news post, **Feature use over time** (the nightly record keeps what the month's players use,
so this chart starts two nights after the release), **Engagement** and **Recruiting** (day-7 retention of
players who came through a recruiting link, per recruiter, against everyone else). Each count also writes every
nation's engagement score to `statsEngage/<n>` (the nightly job does too), which **Player search** shows, filters
and sorts by.

### 9c2b. The Live feed, the watchlist and staff alerts

**Live feed** (`#admin-feed`) lists what players did lately: foundings (from the founding time each save now
writes to `summaries/<uid>.f`), wars, peace, conquests, trade and alliances (the pings each game files for
Letters by post, which `jobs/mail` keeps in `feedLog/<hour>` for 7 days once handled; letters themselves never
appear), board posts, purchases, recruits, reports, help queries, bug reports and staff actions. It reads at
most every 20 seconds per time span and refreshes itself every minute while open.

**Watchlist & alerts** (`#admin-watch`) keeps the players the staff follow (`watch/<uid>`, added from a player's
page with a reason, audited, deleted with the account) beside how their nation has changed since, and the
alerts that `.github/workflows/alerts.yml` files every 15 minutes (`jobs/stats/alerts.mjs`,
`functions/alerts.js`): a player reported 3 times in a day, a nation growing 50% and a million people in a day,
save errors for 5 players and a fifth of those playing in an hour, three times the usual foundings in an hour,
every purchase, and a watched player playing again, renamed, moved, reported or gone. The thresholds are set on
the page (`adminCfg/alerts`). The admin menu shows how many alerts are unseen.

To have new alerts posted to a staff Discord channel as well: in Discord, the channel's **Edit channel** →
**Integrations** → **Webhooks** → **New webhook**, copy its URL, and add it on GitHub under **Settings** →
**Secrets and variables** → **Actions** as the secret `STAFF_ALERT_WEBHOOK`. Without it the alerts only show in
the portal. The workflow needs the same service account secret and project variable as Deploy. The rules refuse
`statsEngage/`, `watch/`, `adminAlerts/`, `adminCfg/`, `alertState/` and `feedLog/` to every client.

### 9c3. Observing another region

An admin can open any other region as its players see it, read-only: **Observe <region>** on Region control and
on a region's Statistics, and **View nation in <region>** beside a nation of another region (Statistics, Player
search, Suspicious). The tab reloads into that region's world map, Region page and board, Census, World page
and nation pages, with a bar on every page (admin portal included) and **Return to my nation**. It needs no
rules change: everything shown is public.

The admin's own nation stays out of that tab. The tab's `sessionStorage` key `edictum.observe` names the region,
and while it is set the page uses a stand-in nation without land: the admin's nation is never loaded from this
browser's copy, normalised against the other region's map, committed, saved or uploaded, and `src/shim.js`
refuses every save but the staff mark and development news (code `read_only`), board posts, the referee, the
Assembly and the shop. An account without the admin claim that has the key set goes back to its own nation;
the admin's own region is never observed (it is theirs to play). `test/observe-e2e.mjs` checks the admin's copy
in this browser and both halves of their record on the server are unchanged by a visit.

### 9d. The shop (Paddle)

The Bureau of National Finery sells cosmetics and the Chancery Club membership through Paddle, the merchant of
record. Until it is set up, the Shop page says it is not open yet. [docs/shop.md](docs/shop.md) has the whole
procedure: a Paddle account and its checks, the three products and prices, the API key, client-side token and
notification destination, deploying the new public `paddle` function once by hand (as with any new public
function), storing the keys with `tools/admin/set-paddle.mjs`, validating on staging with Paddle's sandbox, and
going live. It also explains how purchases are verified and what stays client-side.

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
  most once a minute while its player is active), every open copy in that region reads it again. A copy
  in a background tab for three minutes, or left untouched for ten, stops listening until its player is
  back, and then reads only what changed meanwhile.
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

- **Space records** are read by everyone. They change only when what other regions read does (a new
  tile, building, milestone, terraforming level, name or belt mission; not the colony's people, which
  every viewer carries forward from the last record) and every 12 hours while the nation plays, but a
  very large late game would want them split by body or summarised.
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
