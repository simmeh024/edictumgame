# The shop: the Bureau of National Finery

Cosmetics and convenience, sold through [Paddle](https://www.paddle.com/) as merchant of record. Paddle is the
seller to the player: it takes the payment, charges and pays VAT and sales taxes worldwide (Mexican IVA included),
sends the receipt, handles billing questions, refunds and chargebacks, and pays the owner out. Nothing in the shop
adds prestige, rank, resources or strength.

| Product | ID | Price | Kind | What it gives |
|---|---|---|---|---|
| Founder's Package | `founder` | €9.99 | one payment, sold until 1 February 2027 23:59:59 UTC | Founding Supporter badge, First Edition banner, Engraver's flag frame, First Edition decision stamp, Founder's capital marker, Founder's Gilt (land), passport inscription, a certificate in the museum |
| Nation Identity Card Pack | `idpack` | €2.99 | one payment | Diplomatic Ledger, Atlas Edition and Civic Modern card designs |
| The Chancery Club | `vip` | €4.99 a month | subscription | ten waiting edicts instead of five, one cosmetic each paid month from its collection (kept; two new pieces join it each month), a Chancery seal beside the nation's name if the player chooses, five design presets, the Expanded National Chronicle |
| The Chancery Club, yearly | `vipyear` | €49.99 a year | subscription, optional | the same membership, paid for a year (two months free); one cosmetic pick each calendar month of the paid year |
| A month of the Club, as a gift | `giftvip` | €4.99 | one payment, gift only, optional | a month of membership for another nation, from when it is paid or from where its paid membership ends |

**Optional products.** The shop opens with the first three. `vipyear` and `giftvip` are offered only once their Paddle price is
set (`set-paddle.mjs` asks for them and accepts an empty answer), so adding them never closes the shop.

**Gifts.** The Founder's Package, the card pack and a month of the Club can be given to another player's nation: the
checkout names it (`to`), and what is paid for belongs to that nation (`shopTx.uid`), while the buyer stays the payer
(`shopTx.payer`, and the Paddle customer and portal stay with the buyer's account). The recipient must be a player nation
founded at least seven days ago (by the server's clock), must not already own a one-off item, and must not be paying for the
Club when given a month of it. Two gifts of the same item: the second is refunded to whoever paid it. A refund or chargeback
takes the gift back from the recipient. The recipient's `shop/<uid>.gifts` lists what came from which nation (by name); the
game says so once on each device and in the Shop. Gifts are not awaited on the giver's devices (no `pend`).

**Trying finery on.** In Customise every Shop piece appears among the locked ones; a click shows it on the player's own
nation, on that page only. Nothing is saved: Customise's own save and preset save take the piece off before reading the
look, and leaving the page takes it off. Other players never see it (their games only show what `finery/` lists).

The catalogue is one file, `functions/shop-catalogue.json`: the server sells from it and `build.py` puts the same
file into the game. Prices shown in the game come from it; what is charged comes from the Paddle prices the owner
sets up (`set-paddle.mjs --check` compares the two).

## How it works

- **Buying.** The page asks the server (`accounts`, `op: 'shop'`, `step: 'checkout'`) for a checkout. The server
  checks the player is a Registered Nation (a linked sign-in, so the purchase can follow the account), not banned,
  that the product is on sale and not already owned, and creates a Paddle transaction at its own price with the
  player's ID in it. The page opens that transaction in Paddle's overlay checkout (Paddle.js, loaded from
  `cdn.paddle.com` only then). An open checkout is reused, so two tabs pay one bill.
- **Owning.** Only Paddle's signed notifications to the `paddle` function, and the server's own questions to
  Paddle's API (`refresh`, when the player checks back), decide what an account owns. Returning from the checkout
  grants nothing. Every notification is checked (HMAC-SHA256, `Paddle-Signature`), handled once (by event ID), and
  stored as facts (transactions, adjustments, subscriptions, each guarded by its time); what the account owns is
  then worked out again from all of its facts, so duplicates and out-of-order notifications change nothing.
  `shop/<uid>` holds the result, which only that player can read; `finery/<uid>` lists the account's shop
  cosmetics for every other player's game to check before it shows one.
- **The Founder's deadline.** No checkout opens from 2 February 2027 00:00 UTC (the server's clock). A checkout
  opened before then counts if its payment completes within two hours of the end; the page also closes an open
  checkout at the cutoff. A payment that completes later is refunded in full automatically; if Paddle turns that
  refund down, the package is delivered after all, so nobody is charged without receiving it.
- **The Chancery Club.** Membership lasts as long as the months actually paid (completed transactions and their
  billing periods). A cancellation keeps the membership to the end of the paid month; a failed renewal adds no
  month; a refunded or charged-back month is taken off. Two subscriptions paid side by side: the second is
  cancelled at once and refunded. "Manage subscription" opens Paddle's customer portal (payment method, invoices,
  cancellation); a scheduled cancellation can be taken back from the Shop.
- **Refunds and chargebacks.** A full refund or a chargeback takes back what the payment paid for (a won chargeback
  gives it back). A full refund does so from when it is asked for, while Paddle has still to approve it; a refund
  Paddle turns down gives it back. A refund made in Paddle's dashboard arrives as type `partial` even when it gives
  back the whole item, so one whose items are each refunded in full counts as full (`adjFacts`). Partial refunds
  leave it. A second payment for something already owned is refunded. A purchase this server never opened (a checkout started outside the game) is refunded, since there is no one to deliver it to.
- **The Club's collection grows.** It opened with eight pieces (`vip.collection`); the catalogue's `vip.drops` add two
  more at 00:00 UTC on the first of each month (`{from, ids}`), so a member choosing every month always has something
  new. A piece can be chosen once its month has begun (the server refuses an earlier one with `not_yet`), and the game
  shows a piece of a later month nowhere, not even to try on. **The drops run to May 2027:** add the next months (two
  new pieces each, drawn in the game and listed in its `add(…,'vip')` block, which `test/shop.test.mjs` checks) before
  then. If they ever run out, a member who holds every released piece keeps the month's choice open (below) until new
  ones come, and the Shop says so.
- **A month's choice stays open.** The pick is for the earliest paid month begun and not yet chosen for, until five
  weeks after that month ends (`pickGraceDays`, `pickPeriod`): a member who missed a month, or held everything, can still
  choose for it. A month whose choice is not made by then lapses.
- **Chancery seals.** A member may show a seal beside the nation's name (with the Founder's badge: its page, the region
  board, the Assembly, news comments). `vip.seals` maps each to the months of membership it needs: `csl-member` (0: while
  a member), `csl-brass` 3, `csl-silver` 6, `csl-gold` 12, `csl-grand` 24, the last four kept for good. Months count once
  each as they begin (`vip.m` begun when the record was worked out, `vip.f` the starts still to come, so a paid year's
  months count in on their day without a word from Paddle); a refunded month counts no more. Nothing shows unless the
  player chooses: `accounts {op: 'shop', step: 'seal', id}` (or `''` for none) stores `shop/<uid>.seal`, and only then
  does `settle` publish `finery/<uid>.cl {s, u, m, f}`, from which every game works out whether the seal is still held
  (the plain seal ends with `u`). The `status` step works out once more a record kept before months were counted.
- **The desk.** `edictCapAt(t)` in the game: 5, or 10 at any time inside a paid month. It decides only whether a new
  edict arrives; loading and saving keep up to 10 (`EDICT_KEEP`), so a queue is never cut, whatever a device knows.
  When a membership ends, every waiting edict stays and new ones arrive once fewer than five wait, at the usual
  pace, with no backlog. A nation that has held more than five carries `iq: 1`, which the rules keep, so an older
  build (which would cut the queue to five) can no longer save it.
- **Account deletion.** The page asks the server to cancel any subscription first; then `shop/`, `finery/`,
  `presets/` and `chron/` go with the account. Billing records (`shopTx`, `shopSubs`, `shopAdj`, `shopCheckouts`,
  `shopAcct`, `shopCustomers`) stay, for refunds, disputes and accounting.

### What stays client-side (known limits)

The game itself is played in the player's browser, as before, so:

- A modified client could put more edicts on its own desk than ten, as it could always change its own nation; the
  server does not check edict queues. The Club's desk is a convenience with no effect on other players.
- A modified client can *show itself* shop cosmetics it does not own; other players never see them, because their
  games check `finery/<uid>`, which only the server writes.
- The device keeps the last `shop/<uid>` it saw in local storage, to show what is owned (and the desk's size) while
  offline. Editing it changes only that device's own view and desk.
- Presets and the Chronicle are written by the player's browser, but the rules allow it only while the membership is
  paid, and only the player can read them.
- Closing the checkout at the Founder's cutoff happens in the page; the server's rule above is what counts.

## Owner setup

### 1. Paddle account

1. Sign up at <https://www.paddle.com/> and complete Paddle's checks (identity, business details, payout account).
   Paddle reviews the website: it needs the pricing (the Shop), the terms with a refund policy, and the privacy
   notice, all reachable without signing in; and the product (digital cosmetics for a game). Do this first: it can
   take a few days.
2. Also open a sandbox account at <https://sandbox-vendors.paddle.com/signup> for testing. Sandbox and live are
   separate: every step below is done once in each.
3. Your tax obligations in Mexico (SAT registration, income tax on Paddle's payouts) stay yours: ask an accountant.

### 2. Products and prices (sandbox first, then live)

**Catalog → Products → New product**, tax category *Standard digital goods*:

| Product | Price | Billing |
|---|---|---|
| Founder's Package | 9.99 EUR | one-time |
| Nation Identity Card Pack | 2.99 EUR | one-time |
| The Chancery Club | 4.99 EUR | recurring, every 1 month, no trial |
| The Chancery Club, yearly (optional) | 49.99 EUR | recurring, every 1 year, no trial |
| A month of the Chancery Club, as a gift (optional) | 4.99 EUR | one-time |

Make every price include tax (the price's own tax setting, or the account's sales tax setting that prices follow by
default), so a player in Europe pays €9.99 and not €9.99 plus VAT; `set-paddle.mjs` warns about a price that adds
tax on top. Copy each **price ID**
(`pri_…`). Never change a live price in place: make a new one and add it in front of the old one in
`set-paddle.mjs` (`--prices vip=pri_new+pri_old`), so renewals at the old price still count.

### 3. Checkout, keys and notifications

1. **Checkout → Checkout settings → Default payment link**: `https://edictumgame.com/` (sandbox: your staging
   address). Paddle asks you to approve the domain (**Checkout → Website approval**). A checkout opens only on an
   approved domain, and each subdomain counts separately: in the sandbox add `<staging project>.web.app` and the
   preview address of each pull request you test on (`<staging project>--pr<n>-<branch>-<hash>.web.app`, from the
   PR's preview comment); the sandbox approves them at once.
2. **Developer tools → Authentication → Client-side tokens**: create one (`live_…`, or `test_…` in the sandbox).
   It is public by design: the page uses it to open the checkout.
3. **Developer tools → Authentication → API keys**: create a key (`pdl_live_apikey_…` / `pdl_sdbx_apikey_…`) with
   read and write on transactions, subscriptions, adjustments and customer portal sessions, and read on customers,
   prices and notification settings. Keep it secret: it goes only into Firestore through the script below.
4. **Developer tools → Notifications → New destination**: type *Webhook*, URL
   `https://europe-west1-<project id>.cloudfunctions.net/paddle`, events `transaction.completed`,
   `subscription.created`, `subscription.updated`, `subscription.activated`, `subscription.canceled`,
   `subscription.past_due`, `adjustment.created`, `adjustment.updated`. Copy its **secret key** (`pdl_ntfset_…`).
5. **Customer portal**: on by default in Paddle Billing; add the logo under **Checkout → Branding**.

### 4. Deploy the `paddle` function once by hand

`paddle` is a new public HTTP function. The deploy's service account can create it but may not make it public
(setting its Cloud Run invoker), as with every new public function: the GitHub deploy then fails before rules and
hosting. Either deploy it once from your own login:

```sh
firebase deploy --only functions:paddle,functions:accounts --project <project id>
```

or give the deploy's service account **Cloud Run Admin** (`roles/run.admin`) once in the Google Cloud console. After
that, ordinary deploys update it. Do it in the staging project first: the pull request's preview job deploys the
functions to staging and fails at this step until then. In production, do it before merging, or the deploy after
the merge stops at the functions (the rules and the site then stay as they were, which is safe, but nothing new
goes out). The rules and indexes (`firestore.rules`, `firestore.indexes.json`, including the
`shopEvents.exp` expiry) deploy with the rest.

### 5. Store the keys

On your computer, in this repository, with the service account key used for making an admin:

```sh
cd tools/admin && npm ci
GOOGLE_APPLICATION_CREDENTIALS=/path/outside/the/repo/service-account.json node set-paddle.mjs --env sandbox
```

It asks for the API key and the notification secret (not shown as you type), the client-side token and the three
price IDs, keeps them in `authConfig/paddle` (only the functions read it), and checks with Paddle that every price
is active, in euros, at the catalogue's amount, one-off or monthly as it should be, and that a notification
destination sends the needed events to `/paddle`. `--check` runs the check alone; `--off` closes the shop (owned
things stay owned). Until it is set up, the Shop says the Bureau is not open yet.

### 6. Validate on staging (sandbox)

On the staging project, with the sandbox set-up and Paddle's test card `4242 4242 4242 4242` (any future date, any
CVC), check each of these before going live:

0. **Developer tools → Simulations** (or the API's `/simulations`): send a simulated `transaction.completed` to the
   destination. It should show *success* and the answer `simulated`: the signature matched the saved secret, and
   the function ignores simulated sample data (event IDs `ntfsimevt_…`) on purpose, so nothing is stored or refunded.
1. A guest is asked to link a sign-in; a Registered Nation buys the Founder's Package; it shows as owned within
   seconds, on a second device signed in to the same account too; the founder pieces appear in Customise; another
   player sees the badge and the gilt.
2. The card pack: each design switches in Customise; the rank border stays.
3. The Chancery Club: join; the Edicts page counts to ten; choose the month's cosmetic; save a preset; decide an
   edict and find it in the National Chronicle. Cancel in **Manage subscription**: still a member until the paid
   date; **Keep my membership** takes it back.
4. A renewal: move the sandbox subscription's next billing date to a minute from now (Paddle's API: update the
   subscription's `next_billed_at`), or wait a month: the paid-until date moves on. A failed renewal (switch the
   subscription to one of [Paddle's declining test cards](https://developer.paddle.com/concepts/payment-methods/credit-debit-card)
   first): the membership shows the failed payment and ends with the paid month.
5. Refund the card pack from the dashboard (the whole item): it leaves Customise as soon as the refund is asked for,
   while Paddle still has to approve it (the sandbox approves refunds about every ten minutes).
6. In **Notifications**, the destination's log shows every notification delivered with status 200.

### 7. Go live

Repeat steps 2–5 in the live account (`--env live`), run `set-paddle.mjs --check`, then make one real purchase of
the card pack and refund it from the dashboard. The privacy notice and terms already describe the shop and Paddle;
read them once more against Paddle's requirements.

## Tests

```sh
npm run test:shop           # the rules alone: signatures, the deadline, refunds, subscriptions, the desk (no emulator)
npm run test:shop-backend   # the server against a stand-in for Paddle (Auth, Firestore and Functions emulators)
npm run test:rules          # includes test/shop-rules.test.mjs: ownership, billing records, presets, Chronicle, iq
npm run test:shop-e2e       # the browser: buying, wearing, a neighbour, a forger, the Club, the desk of ten, a phone
```

## The Shop page

The page opens with the Chancery Club as a banner (this month's new pieces, price, Join), then filter chips (All, Club,
Cosmetics, Gifts, Limited time, Wishlist) with a Hide owned switch, then the items as compact cards in a grid: two to a
row on a desktop, one on a phone. A card shows a picture, a line about it, labels (Owned, Ends in n d, A gift, Gift only),
its price on a tag and a Buy button. Clicking it opens a drawer (a bottom sheet on a phone) with the item's full section:
previews, the full list, gifting, the Club's table, picks and seals. The drawer also has "Pairs well with" and
"Recently viewed". One card a week is the Bureau's pick. A confirmed purchase stamps "Granted" on its card.

- To add an item, add an entry in `shopCards()` (`sec` picks its section, `tags` its chips) and a case in `shopDrawerBody()`.
  Sections (Limited time, Cosmetics, Gifts, Bundles) appear once any of them holds two items; until then the cards share one grid.
- The wishlist, Recently viewed and Hide owned are kept on the device (`localStorage`, `edictum.shop.*`), not on the account.
- While a drawer is open, the cards behind it keep their prices but show no buttons, so each buy button exists once.
