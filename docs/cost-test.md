# Cost test

Run on 2026-10-27 with `node test/load.mjs` on the Firebase emulators: 50 players in one region for
5 measured minutes, after a minute of warming up. 6 were real game clients in Chromium (half idle,
half playing: deciding edicts, visiting nations, posting on the board), with every Firestore read and write counted
inside the page. The other 44 were Node clients doing what the game does to the database: the game's four live
listeners (the region's nations, space, the region board, moderation) and a nation save every
79 seconds, the average pace of the real clients
(0.76 saves a minute: idle players save nothing, playing ones up to four a minute).

A newly founded nation saves 4,286 characters of JSON. Prices are Firestore's for eur3: reads $0.06 and
writes $0.18 per 100,000, data sent to the internet $0.12 per GiB, beyond the free quota (50,000 reads and 20,000 writes
a day, 10 GiB of data a month).

## Measured, per player per hour

| | Reads | Writes | Data received (MB) |
|---|---:|---:|---:|
| Idle game client | 2,148 | 0 | 10.2 |
| Playing game client | 2,128 | 88 | 10.1 |
| Node player | 2,135 | 92 | 10.1 |

## Measured, the whole region (50 players)

| | Reads | Writes | Data (GiB) | Cost beyond the free quota |
|---|---:|---:|---:|---:|
| One hour | 106,746 | 4,296 | 0.50 | |
| A month, 8 hours a day | 25,618,943 | 1,030,978 | 118.9 | $30.43 |
| A month, around the clock | 76,856,829 | 3,092,934 | 356.6 | $91.29 |

## What drives the bill

Almost all of it is one listener: every player listens to the full records of every nation in the region, so each save
is read by every other player there. Reads per player per hour are about (players online in the region − 1) × saves per
hour, so a region's reads grow with the square of the players online in it, and the data sent grows with the size of a
nation's record as well. Writes are small.

## Projected: one region, a month around the clock, at the measured pace

| Players online at once | Nation size | Reads | Data (GiB) | Cost |
|---:|---|---:|---:|---:|
| 50 | new (4.3 KB) | 80.4 million | 373 | $96 |
| 50 | played a day (12 KB) | 80.4 million | 1,066 | $179 |
| 50 | mature (40 KB, estimate) | 80.4 million | 3,483 | $469 |
| 100 | new (4.3 KB) | 325.0 million | 1,508 | $385 |
| 100 | played a day (12 KB) | 325.0 million | 4,309 | $721 |
| 100 | mature (40 KB, estimate) | 325.0 million | 14,075 | $1,893 |
| 250 | new (4.3 KB) | 2,043.8 million | 9,483 | $2,391 |
| 250 | played a day (12 KB) | 2,043.8 million | 27,092 | $4,504 |
| 250 | mature (40 KB, estimate) | 2,043.8 million | 88,501 | $11,873 |

Spread the same players over more regions and the cost falls: 250 players in five regions of 50 cost five times the
first rows, not the square.

## What would bring it down

1. **Send other players a small public record, not the whole nation.** What another player needs to see (name, flag,
   land, figures, relations) fits in a fraction of the full record; the full record is only needed when someone opens
   that nation's page. This is the structural fix: it cuts the data by most of its size, and the reads too if the
   public record changes less often than the nation.
2. **Compress the nation record.** The JSON compresses to about a fifth of its size, which cuts the data by about 80%
   (the reads stay the same).
3. **Publish less often.** Saving to the database at most once a minute instead of every 15 seconds (the game still
   saves when a player leaves) cuts the reads and data from playing players by up to four times.
4. **Keep regions smaller while they fill.** Steering newcomers to emptier regions sooner keeps the square small.
