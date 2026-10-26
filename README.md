# Edictum

Edictum is a multiplayer nation simulator in a single web page. Players found a nation, decide
the issues that land on their desk, claim land on a hex map of their region, build cities, trade,
form alliances, spy, go to war, vote in a regional assembly and, in the end, head for the Moon and
Mars. Every nation is run by a player or by the computer, and players in a region share one map
and one message board.

The game was first written as a claude.ai artifact. This repository runs the same game on its own
site with Firebase: **Hosting** serves the page, **Authentication** gives every visitor an account
(a guest account at once, linked to Google if they like), and **Firestore** holds the shared world.

## How it fits together

| Path | What it is |
| --- | --- |
| `game/edictum.html` | The game, exactly as it runs on claude.ai (Version 26). Never edited by the build. |
| `src/stub.js` | A few lines put at the top of the page: `window.claude.use()`, which the game calls, waits until Firebase is ready. |
| `src/shim.js`, `src/shim.css` | The adapter: the claude.ai runtime calls the game makes (`db.doc().get/set/delete`, `db.collection().onSnapshot`, `user.id/isOwner/can`), backed by Firebase. Also the account control and the nation file import and export. |
| `src/favicon.svg`, `src/og.png`, `src/apple-touch-icon.png` | The seal icon and the picture shown when a link is shared (`src/og.html` is its source; `tools/make-images.mjs` redraws the PNGs). |
| `build.py` | Wraps the game in a full page with the stub, the Firebase SDK, the shim and the meta tags, and writes `public/`. |
| `firestore.rules`, `firestore.indexes.json` | Who may read and write what. |
| `firebase.json`, `.firebaserc` | Hosting (cache headers, clean URLs), Firestore and the local emulators. `.firebaserc` names the live project, `edictum-b30de` (served at <https://edictumgame.com>); the workflows pass the id explicitly from the `FIREBASE_PROJECT_ID` variable, and the emulator scripts use `demo-edictum`. |
| `.github/workflows/` | `deploy.yml` deploys on every push to `main`; `preview.yml` tests the rules and deploys a preview for each pull request. |
| `test/` | Rules tests, end-to-end tests and a smoke test, all on the Firebase emulators. |
| `tools/admin/` | A one-off script that makes a player an admin. |

**Data.** Two collections, one document per player in each, named by the player's Firebase user id:

- `nations/<uid>`: `{v: 1, j: "<the nation as JSON text>", reg, name, updatedAt}`. The nation
  record is stored as text because it contains lists of lists, which Firestore cannot store, and
  because the game expects its fields back exactly as it saved them. `reg`, `name` and `updatedAt`
  are copies kept beside it for queries and for the Firebase console.
- `rmb/<uid>`: `{posts: [...]}`, the player's posts on their region's message board, at most 40.

Anyone may read both; each player writes only their own; admins may also edit anyone's `rmb`
document to remove posts. See `firestore.rules`.

**Sign-in.** A new visitor is signed in as an anonymous guest straight away and can play at once.
The account control (at the foot of the side bar, or at the top of the founding screen) offers
**Keep your nation on every device**, which links the guest account to Google so the same nation
loads anywhere. If that Google account already has a nation, the player can switch to it. Signing
out starts a new guest.

**Without Firebase.** If the Firebase scripts or the configuration cannot be loaded, the game
plays in the browser only, as it always could, and says so.

**Fonts.** The game loads its three typefaces (Bodoni Moda, Public Sans, IBM Plex Mono) from
Google Fonts. That is kept as it was; it means each visitor's browser contacts Google's font
servers. The fonts are under the SIL Open Font License, so they could be copied into `public/`
later if you would rather not.

## Local development

You need Node.js 20 or later, Python 3, and Java 21 or later (for the Firestore emulator).

```sh
npm ci                     # the pinned Firebase SDK and tools
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
npm install --no-save playwright && npx playwright install chromium
npm run test:e2e           # two players, the message board, reloads, rules, admin, offline, import and export, Google sign-in
npm run test:smoke         # every page of the game at 1280 and 390 px wide, in two regions
```

Screenshots and downloaded files from the browser tests go to `test/out/`.

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
use the same database and accounts as the live site, so playing on a preview changes real nations.

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

Admins see **Remove** on everyone's posts on the region message board.

1. Play on the site and link your nation to Google (**Keep your nation on every device**).
2. On your computer, in this repository:

   ```sh
   cd tools/admin
   npm ci
   GOOGLE_APPLICATION_CREDENTIALS=/path/outside/the/repo/service-account.json node set-admin.mjs you@gmail.com
   ```

   It also accepts the **Player ID** shown in the account menu, and `--remove` takes the right away.
3. In the game, open the account menu, **Sign out**, and sign back in with Google. (The right
   otherwise arrives on its own within the hour, when the sign-in renews.)

## Costs: Spark and Blaze

Firebase has a free plan (**Spark**) and a pay-as-you-go plan (**Blaze**, which includes the same
free allowance each day and charges only beyond it). Check <https://firebase.google.com/pricing>
for current figures; at the time of writing:

- **Hosting.** Spark allows about 360 MB of downloads a day. A first visit downloads about 1.9 MB
  (the game page is 4.9 MB, about 1.7 MB compressed, plus 0.2 MB of Firebase), so Spark covers
  roughly 150 to 200 first visits a day. Returning visitors download almost nothing until you
  deploy a new version.
- **Firestore reads.** Spark allows 50,000 reads and 20,000 writes a day. Each copy of the game
  that is open listens to every nation and every message board: opening the game reads one
  document per nation and per board, and each time any player's nation changes (most actions
  save it), every open copy reads that one document again. Twenty players with the game open for
  an hour, each saving about once a minute, make about 20 × 20 × 60 = 24,000 reads. Fine for a
  group of friends on Spark; for more, move to Blaze, where reads cost a few US cents per 100,000.
- When a Spark quota runs out, the game keeps working in each browser and tells players their
  changes are saved in the browser only, until the quota resets at midnight Pacific time.
- On Blaze, set a **budget alert** (Google Cloud console → Billing → Budgets and alerts) so
  surprises reach your inbox.

## Moving nations from the claude.ai version

A nation on the claude.ai version lives in that artifact's database and in the player's browser.
On this site, the account menu has **Import a nation file** (choose a file, or paste its text),
which replaces the nation you play here with the one in the file. The game's own loading code
checks the record as the page reloads; if it refuses the record, the previous nation is put back
and the player is told. **Export my nation** downloads the current nation as a file, so a nation
can also move the other way, or be kept safe.

The claude.ai version has no export button yet (see `NOTES.md` for a short patch that adds one).
Until it does, there are two ways to get a nation file out of it:

- **The owner exports everyone's.** Ask Claude, in a conversation with access to the artifact, to
  save each document of the artifact's `nations` collection to its own `.json` file, and send each
  player their own. A file holding the bare nation record, or `{"data": {...}}`, imports as it is.
- **A player copies their own.** In a desktop browser on claude.ai, open the game, open the
  developer tools console, choose the game's frame in the console's context menu (it is the
  sandboxed frame, not the top page), run `copy(localStorage.getItem('statehood.nation.v1'))`,
  then paste the result into **Or paste the text of a nation file** on this site.

## Scaling later

Today every copy of the game listens to the whole `nations` collection and decodes every record,
which is fine for dozens of players. With hundreds or thousands it costs a lot of reads, because
every save by anyone is read by everyone, and records are large (about 15 KB, growing as a nation ages). The follow-up,
not built yet:

- **Region-scoped queries.** Listen only to the player's own region,
  `db.collection('nations').where('reg', '==', REG.id)`. The `reg` field is already stored beside
  each record for this. It needs a small change in the game's `connect()` (and the shim's
  collection adapter to pass `where` through).
- **A small summary document per nation** (name, region, population, flag, last active), kept in a
  `summaries` collection and written alongside the nation, for the World page and the other
  places that only need a nation's headline figures from other regions.

## Updating the game

Replace `game/edictum.html` with the new version and push. `build.py` checks that the file still
has the shape it expects (one `<div id="app"></div>` followed by one inline script) and stops with
a clear message if not. Nations saved by an older version load through the game's own
normaliser, as they do on claude.ai.
