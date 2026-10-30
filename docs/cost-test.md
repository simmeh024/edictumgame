# Cost test

Run on 2026-10-27 with `node test/load.mjs` on the Firebase emulators: 50 players in one region for
5 measured minutes, after a minute of warming up. 6 were real game clients in Chromium (half idle,
half playing: deciding edicts, visiting nations, posting on the board), with every Firestore read and write counted
inside the page. The other 44 were Node clients doing what the game does to the database: the game's four live
listeners (the region's nations, space, the region board, moderation) and a nation save every
103 seconds, the average pace of the real clients over their first two minutes
(0.58 saves a minute: idle players save nothing, playing ones at most once a minute, or
within two seconds of something another player waits for).

A newly founded nation is 4,248 characters of JSON, of which the region downloads the shared half,
3,166 characters (src/shim.js keeps the other 1,083 in nationx/, read only when a page
of that nation is opened). The real clients rewrote the private half in 100% of their
saves. Prices are Firestore's for eur3: reads $0.06 and writes $0.18 per 100,000, data sent to the internet $0.12 per
GiB, beyond the free quota (50,000 reads and 20,000 writes a day, 10 GiB of data a month).

## Before and after

Before (2026-10-27): every save sent the whole record to the region, at most every 15 seconds. Now: the
shared half only, at most once a minute (fixes 1 and 3 below).

| Per hour | Before | Now | Saved |
|---|---:|---:|---:|
| Saves per player (average) | 46 | 35 | 24% |
| Reads per player | 2,135 | 1,772 | 17% |
| Data per player (MB) | 10.1 | 6.3 | 38% |
| Region reads | 106,746 | 88,702 | 17% |
| Region writes | 4,296 | 5,316 | -24% |
| Region data (GiB) | 0.50 | 0.31 | 38% |
| **A month, 8 hours a day** | **$30.43** | **$22.90** | **25%** |
| **A month, around the clock** | **$91.29** | **$68.71** | **25%** |

## Measured, per player per hour

| | Reads | Writes | Data received (MB) |
|---|---:|---:|---:|
| Idle game client | 1,788 | 0 | 6.4 |
| Playing game client | 1,792 | 152 | 6.3 |
| Node player | 1,772 | 110 | 6.3 |

In the measured window the real clients saved 0, 0, 0, 48, 60, 12 times an hour each (idle ones first).

## Measured, the whole region (50 players)

| | Reads | Writes | Data (GiB) | Cost beyond the free quota |
|---|---:|---:|---:|---:|
| One hour | 88,702 | 5,316 | 0.31 | |
| A month, 8 hours a day | 21,288,463 | 1,275,810 | 74.1 | $22.90 |
| A month, around the clock | 63,865,390 | 3,827,431 | 222.4 | $68.71 |

## What drives the bill

Almost all of it is one listener: every player listens to the shared halves of every nation in the region, so each
save is read by every other player there. Reads per player per hour are about (players online in the region − 1) ×
saves per hour, so a region's reads grow with the square of the players online in it, and the data sent grows with the
size of a nation's shared half as well. Writes are small.

## Projected: one region, a month around the clock

Before at the earlier run's pace and whole records; now at this run's pace and shared halves. Eternia's shared half
(9,688 of 12,809 characters) was measured on the live site; the mature record is an estimate.

| Players online at once | Nation | Reads | Data (GiB) | Before | Now | Saved |
|---:|---|---:|---:|---:|---:|---:|
| 50 | new (4.2 KB) | 80.4 → 61.4 million | 370 → 214 | $95 | $66 | 31% |
| 50 | played a day (Eternia) | 80.4 → 61.4 million | 1,115 → 654 | $185 | $119 | 36% |
| 50 | mature (40 KB, estimate) | 80.4 → 61.4 million | 3,483 → 2,042 | $469 | $285 | 39% |
| 100 | new (4.2 KB) | 325.0 → 248.1 million | 1,495 → 864 | $383 | $263 | 31% |
| 100 | played a day (Eternia) | 325.0 → 248.1 million | 4,507 → 2,643 | $745 | $476 | 36% |
| 100 | mature (40 KB, estimate) | 325.0 → 248.1 million | 14,075 → 8,252 | $1,893 | $1,149 | 39% |
| 250 | new (4.2 KB) | 2,043.8 → 1,559.7 million | 9,399 → 5,431 | $2,381 | $1,618 | 32% |
| 250 | played a day (Eternia) | 2,043.8 → 1,559.7 million | 28,340 → 16,618 | $4,653 | $2,961 | 36% |
| 250 | mature (40 KB, estimate) | 2,043.8 → 1,559.7 million | 88,501 → 51,888 | $11,873 | $7,193 | 39% |

Spread the same players over more regions and the cost falls: 250 players in five regions of 50 cost five times the
first rows, not the square.

## What would bring it down

1. **Done: send other players the shared half, not the whole nation.** The edict engine, notices seen, tallies,
   intelligence, lore and the passport's stamps live in nationx/, read when someone opens that nation's pages. The
   shared half is still most of a played record: the edict history, provinces, cabinet, museum, achievements and
   messages are read across the region (the Dispatch, the Flock, the region page).
2. **Compress the shared half.** The JSON compresses to about a fifth of its size, which would cut the data by about
   80% (the reads stay the same).
3. **Done: publish less often.** At most once a minute instead of every 15 seconds, and within two seconds for what
   another player waits for (messages, offers, declarations, votes, bids, claims). A player making several changes a
   minute now costs the region a quarter of what they did.
4. **Keep regions smaller while they fill.** Steering newcomers to emptier regions sooner keeps the square small.
5. **Skip the shared write when only private or running figures changed.** Many saves change only the private half,
   or population and stock, which other players work out from the last save anyway. Writing the private half alone
   then (with a save of the shared half at least every 15 minutes, so the nation does not look dormant) would cut the
   reads further.
6. **Done (after this run): quiet tabs.** A tab in the background for three minutes, or untouched for ten, lets go of
   its listeners until the player is back, and then reads only what changed meanwhile. The idle clients above (1,788
   reads an hour each) read nothing from them in that state, and saves only their clock would make wait for the
   player's return.
7. **Done (after this run): space records only when they change for other regions.** Every save used to rewrite a
   colony owner's space record (its people and their time move at every save), and every player in every region read
   each rewrite. Now a record is written for a new tile, building, milestone, terraforming level, name or belt
   mission, or every 12 hours, and viewers carry the people forward from it.
