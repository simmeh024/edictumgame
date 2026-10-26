# Edictum

Edictum is a multiplayer nation simulator in a single web page. Players found a nation, decide
the issues that land on their desk, claim land on a hex map of their region, build cities, trade,
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
| `build.py` | Builds `public/`: a small page (stub, Firebase SDK, shim, meta tags) plus the game's script and styles minified into `/assets/game.<hash>.js` and `/assets/app.<hash>.css`, and the fonts in `/assets/fonts/`. Their names change with their content, so browsers keep them for a year. |
| `firestore.rules`, `firestore.indexes.json` | Who may read and write what. |
| `firebase.json`, `.firebaserc` | Hosting (cache headers, clean URLs), Firestore and the local emulators. `.firebaserc` names the live project, `edictum-b30de` (served at <https://edictumgame.com>); the workflows pass the id explicitly from the `FIREBASE_PROJECT_ID` variable, and the emulator scripts use `demo-edictum`. |
| `.github/workflows/` | `deploy.yml` deploys on every push to `main`; `preview.yml` tests the rules and deploys a preview of each pull request to the staging project. |
| `test/` | Rules tests, end-to-end tests and a smoke test, all on the Firebase emulators. |
| `tools/admin/` | A one-off script that makes a player an admin. |

**Data.** Documents are named by the player's Firebase user id:

- `nations/<uid>`: `{v: 1, j: "<the nation as JSON text>", reg, name, updatedAt, ts}`. The nation
  record is stored as text because it contains lists of lists, which Firestore cannot store, and
  because the game expects its fields back exactly as it saved them. `reg`, `name` and `updatedAt`
  are copies kept beside it for queries; `ts` is the server's time of the save.
- `summaries/<uid>`: `{reg, name, pop, t}`, the nation's headline, for the World page and the
  player counts per region.
- `space/<uid>`: `{reg, name, t, j, ts}`, the nation's Moon, Mars and asteroid belt data, only for
  nations that have any. Those are shared by every region, so every player reads them.
- `boards/<region>/posts/<id>`: `{a: <author uid>, t, x}`, one post on a region's message board;
  `limits/<uid>` `{p}` paces each player's posting.

A nation save writes the nation, its summary and (when it changed) its space record in one batch.
Anyone may read the world; each player writes only their own documents; admins may also delete any
post. The rules also check that a save's documents agree, and pace writes: a nation at most once a
second, a space record once every 10 seconds, a post once every 20. See `firestore.rules`.

**What each player downloads.** Only their own region: its nations in full, its board's latest 60
posts, plus every region's space records. Other regions are counted (one cheap count per region) and
listed by name from `summaries/` only when the World page asks. The game sends its saves to Firestore
at most every 15 seconds (at once when the tab is hidden or closed; the browser's own copy is saved
straight away), so the other players in the region read each nation less often.

**Regions fill up.** A region takes no new nations once 250 active nations live there (dormant ones,
unsaved for 250 days, do not count). A newcomer who has not chosen a region and lands in a full one
is sent to the fullest region that still has room, so players gather rather than spread thin. The
cap is `REGION_CAP` in the game. Each region's map is sized for that: its grid gives about 30,000
land hexes (`REGION_LAND`; some 120 per player besides the computer nations), so a watery region has
a larger grid than a continental one. Founding switches region by reloading the page; what the player
filled in is kept (in the tab's session storage) until the nation is founded.

**Adding a region.** When the regions fill, add more rather than enlarging these: a new entry in
`REGIONS_EXTRA` in the game (name, description, `geo`, lands, computer nations, alliances) and its id
in the `region()` list in `firestore.rules`. The map, its size and the player counts follow from that.

**Sign-in.** A new visitor is signed in as an anonymous guest straight away and can play at once.
The account control (at the foot of the side bar, or at the top of the founding screen) offers
**Keep your nation on every device**, which links the guest account to Google so the same nation
loads anywhere. If that Google account already has a nation, the player can switch to it. Signing
out starts a new guest.

**Without Firebase.** If the Firebase scripts or the configuration cannot be loaded, the game
plays in the browser only, as it always could, and says so.

**Fonts.** The game's three typefaces (Bodoni Moda, Public Sans, IBM Plex Mono; SIL Open Font
License) are served from the site itself, Latin and Latin Extended only, from the pinned Fontsource
packages: no visitor's browser contacts Google for them.

**Nation files.** There is no import or export: every nation lives in Firestore, kept with the
player's account. (The retired claude.ai version's nations are not carried over.)

## Local development

You need Node.js 20 or later, Python 3, and Java 21 or later (for the Firestore emulator).

```sh
npm ci                     # the pinned Firebase SDK, tools, esbuild, fonts and Playwright
python3 build.py           # writes public/
npx firebase-tools emulators:start --project demo-edictum
```

Then open <http://127.0.0.1:5000>. The `demo-` project id means everything runs on your machine:
the page finds the local Auth and Firestore emulators by itself, and nothing touches a real
Firebase project. The emulator console at <http://127.0.0.1:4000> shows the accounts and
documents; in the Auth emulator, "Continue with Google" opens a stand-in sign-in window where you
can make up accounts.

`npm run emulators` does the build and the start in one go. After changing `src/` or the game,
run `python3 build.py` again and reload.

### Tests

```sh
npm run test:rules         # the security rules (Firestore emulator only)
npx playwright install chromium   # once, for the browser tests
npm run test:e2e           # two players, the board, other regions, reloads, rules, admin, offline, Google sign-in, full regions, founding drafts
npm run test:smoke         # every page of the game at 1280 and 390 px wide, in two regions
```

Screenshots from the browser tests go to `test/out/`. `python3 build.py --no-minify` keeps the code readable for debugging.

## Owner setup

Do these once, in your browser. Nothing here needs a credit card unless you choose the Blaze
plan (see Costs).

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
   these roles: **Firebase Admin**, **API Keys Viewer** and **Service Usage Consumer**. Save.
3. In your GitHub repository: **Settings** → **Secrets and variables** → **Actions** → **Secrets**
   → **New repository secret**. Name: `FIREBASE_SERVICE_ACCOUNT`. Value: the whole content of the
   JSON file. **Add secret**. Then delete the downloaded file, or keep it somewhere safe outside
   the repository (you need it again only for step 9).

### 6. The project id, as a GitHub variable

Same page, **Variables** tab → **New repository variable**. Name: `FIREBASE_PROJECT_ID`. Value:
your project id. **Add variable**.

### 7. Deploy

Push to `main` (or open **Actions** → **Deploy** → **Run workflow**). The workflow installs the
pinned packages, runs `build.py`, deploys the Firestore rules and indexes, then the site. If the
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

### 9. Making yourself an admin

Admins see **Remove** on everyone's posts on the region message board, and a purple **Admin** pill
beside their nation's name. The pill opens the admin portal (`#admin`): players in all and per
region (active in the last 250 days, today, this week, in the last 15 minutes), how full each
region is, its board posts, nations in space and the largest nations, all counted live, and a
button back to the game. For anyone else `#admin` simply shows the game.

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

### 10. The staging project, for previews

A second Firebase project, `edictum-staging` (alias `staging` in `.firebaserc`), has its own
database, accounts and address (<https://edictum-staging.web.app>). Pull request previews deploy
there, and you can deploy a branch to it by hand:

```sh
python3 build.py --site-url https://edictum-staging.web.app
npx firebase deploy --only firestore:rules,firestore:indexes,hosting --project staging
```

It is set up like the live project (steps 1 to 5: web app, Firestore in `eur3`, Anonymous and Google
sign-in, the three roles on its `firebase-adminsdk-…` service account). For the previews, GitHub
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
  most every 15 seconds while its player is active), every open copy in that region reads it again.
  Twenty players in one region, active for an hour, make at most about 20 × 20 × 240 = 96,000 reads;
  the same twenty spread over four regions make a quarter of that. Spark suits a group of friends;
  for a public launch use Blaze, where reads cost a few US cents per 100,000.
- When a Spark quota runs out, the game keeps working in each browser and tells players their
  changes are saved in the browser only, until the quota resets at midnight Pacific time.
- On Blaze, set a **budget alert** (Google Cloud console → Billing → Budgets and alerts) so
  surprises reach your inbox.

## Scaling

Reads grow with the size of a region (at most 250 active nations), not with the whole world: see
Data above. What is left for later, as numbers grow:

- **Space records** are read by everyone. They change only when a nation's Moon, Mars or belt data
  does (and every 12 hours while it plays), but a very large late game would want them split by
  body or summarised.
- **Dormant nations** still arrive with their region's records (the game sets them aside). If
  regions fill with abandoned nations, listen only to active ones and fetch the rest on demand.
- **The game trusts each browser** with its own nation. Server-side checks (Cloud Functions) would
  be the next step against cheating.

## Changing the game

Edit `game/edictum.html` on a branch, run the tests, and open a pull request (its preview runs on
staging); merging to `main` deploys. `build.py` checks that the file still has the shape it expects
(one `<div id="app"></div>` followed by one inline script) and stops with a clear message if not.
Nations saved by an older version load through the game's own normaliser.
