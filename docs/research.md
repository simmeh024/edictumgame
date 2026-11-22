# The National Research Programme

A long programme for the middle and the end of the game. A nation founds a National Research Laboratory, earns
Research Credits (RC) every day, and spends them on 360 technologies in three tracks. Research ties the rest of the
game together: it changes the economy, trade, building, war, spies, the currency, mandate, field digs and space
missions, and it brings edicts, laws, Assembly conventions, letters, honours and alliance projects of its own.

Code: `game/edictum.html`, the section "the National Research Programme" (just before "military buildings"), with
its styles between `/* rs:start */` and `/* rs:end */`; `functions/research-rules.js` (what the server holds a
save to); `functions/civic.js` (the save permit calls `rsSettle`); `functions/alliances.js` (`alRsStart`,
`alRsGive`); `functions/treaties.js` (`trLic`, `trLicAns`); `functions/war-rules.js` and `functions/index.js`
(readiness); `jobs/fx/engine.mjs` (`researchOf`).

## For players

1. **The petition.** After 75 enacted edicts (the count Space and Willow Street use: vetoes and letters do not count),
   the nation's scientists petition the government: the gold-bordered edict *A Nation of Discovery*, in the words of
   the nation's type of state (republic, crown, empire, sultanate, theocracy, people's republic, colony, borough). Its
   three answers are three **sites**, shown as pins I, II and III on a map in the edict, the way the founding edict
   shows its places (`rsLabSites`: for each kind, the suitable hex nearest the capital):

   | Site | Where | Advantage |
   | --- | --- | --- |
   | The university quarter | own land within 2 hexes of one of the nation's cities | +2 RC a day, Growth research 5% cheaper |
   | The coast | own coastal land | Trade research 10% cheaper |
   | The hills | own hills or mountains | War research 10% cheaper, and the laboratory's hex 30% harder to take |

   An answer whose kind has no hex within the borders is refused with a toast. A veto does not shut research out: the
   petition comes back after five more enacted edicts. Nations already past 75 get it at once.
2. **The laboratory.** *Research Lab* appears in the menu (Your nation) once the petition is granted, and not before
   (a veto leaves it hidden). The Laboratory tab shows the three kinds of site as buttons and a map framed on the
   nation's own land, with the answer's pin and a dot on every hex the chosen kind may take: never water, a city or
   another nation's land (`rsSiteWhy`). The player keeps the pin or selects another dot, names the
   laboratory and its scientific director, and picks the director's portrait from the Customise › Portraits pieces
   the nation holds. Five stages follow: site preparation; foundations and infrastructure; research facilities;
   scientific equipment and recruitment; inauguration. Each takes materials from the stock (given 10, 50 or all at
   a time, as for the Great Statue) and then hours of works. In all about 120 timber, 95 iron, 155 goods, 15 oil and
   130 food, a few days' surplus for a nation of 75 edicts. The inauguration is in the national history, the
   newspaper and the bell, and pays the **Founding Research Grant of 12 RC**: Tier I's 2, 3 and 4.
   Works and studies whose time is up finish by themselves within seconds, whatever page the player is on.
3. **Research Credits.** From the inauguration: `10 + floor(Science & Technology / 5) + the institution's bonus`
   a day, plus a few from technologies and research buildings, counted while the player is away. At Science 50 the
   laboratory gives 20 a day. International cooperation adds up to 30%, the nation's own science report up to 15%.
   A laboratory that is not at work (held by an enemy, destroyed, or being rebuilt) earns nothing: see *The laboratory
   at war*.
4. **The research tree.** Three tracks (Trade, Growth, War), each 24 tiers in six eras (Foundations I–IV,
   Industrialisation V–VIII, Modernisation IX–XII, National Excellence XIII–XVI, International Leadership XVII–XX,
   Golden Age XXI–XXIV), five technologies a tier: the tier's milestone (from the design's table) and four
   supporting technologies. A tier needs the whole tier before it; the milestone needs its tier's four. Later tiers
   need the other tracks too:

   | Tier | Also needs |
   | --- | --- |
   | IX–X | Tier IV complete in another track |
   | XI–XII | Tier VI in both other tracks |
   | XIII | Tier VIII in all tracks |
   | XIV | Tier X in all tracks |
   | XV | Tier XII in all tracks |
   | XVI | Tier XIV in all tracks |
   | XVII | The Grand Academy (the fifth institution) |
   | XVIII | Tier XVI in all tracks |
   | XX | Tier XVIII in all tracks |
   | XXII | Tier XX in all tracks |
   | XXIV | Tier XXII in all tracks |

   Some technologies also need a technology of another track (a lower tier), buildings (Banking a Market Hall,
   Central Banking a Central Bank, Military Engineering a Barracks and a Fortress, Environmental Restoration a Nature
   Reserve and a Recycling Works, Universal Healthcare a Hospital, Advanced Education a University), cities (Urban
   Planning three, Metropolitan Planning five) or a Grand Challenge. From Tier III every technology costs materials
   of its track (Trade goods and iron, Growth food and timber, War iron and oil). Tiers I–IV are researched at once;
   from Tier V a technology is **studied** once paid for: 2 hours a technology in Industrialisation, 6, 12, 24 and 36
   in the eras after, half as long again for a milestone, one study per track at a time.
5. **The page.** Five tabs: *Overview* (credits, generation, studies under way, what can be researched now, recent
   discoveries, the credits' make-up, scientific initiatives), *Research tree* (track selectors, era tabs, four tier
   columns of five cards with lines between them, a detail panel with the price, prerequisites, materials, study time,
   discounts, exact effects and exactly why a locked one is locked), *Laboratory* (the building drawn as it rises
   and grows, the director, the stages, the eight institutions, the Grand Challenges), *Alliance cooperation* and
   *Scientific record* (every discovery, stage, challenge, grant, letter and award by day, with filters). Later eras
   can be inspected before they open. Only one era of one track is drawn at a time (20 cards). On a phone the four
   tiers stack in one column and the detail panel follows them.

## The laboratory on the map, and at war

The laboratory stands on one hex (`n.nrp.c`), chosen when it is founded and movable until the builders start
(*Move the site*). The World map, the visiting map and the founding map draw it with its own icon (`RS_FLASK`): a
flask in a paper disc ringed in the owner's colour, dashed while it is being built, with the institution's level
beside it close up. Its tip names the institution and its nation; the hex's panel says whose it is, and a hills site
adds its 30% to the hex's defence (`cityDefMult`, `cityDefNotes`).

Whoever holds the hex holds the laboratory (`rsLabWhere`: `held`, `lost`, `ruined` or `none`):

- **Taken.** If an enemy takes the hex in a war, nothing researched is lost: the technologies, the credits saved, the
  studies and the institution are all kept. But while it is held no research is done (`rsActive`): no credits, no
  discoveries, no studies finished, no works, no expansion and no Grand Challenge begun. The map icon turns red and is
  struck through, the drawing shows the enemy's flags and soldiers behind a line of tape, and the Overview says why.
  Retaking the hex (or getting it back at the peace) sets it to work again at once.
- **Destroyed.** The nation that holds another's laboratory hex can destroy it from the hex's panel (`rsRaze`): it
  salvages `30 + 10 × level` iron and goods, its goodwill with that nation falls by 10, and the deed is in its history (`rsraze`). The owner's
  next save sees it (`n.rsd`, newer than the site's placing `ft`) and the laboratory falls to ruins (`rsRuin`):
  no site, the stages back to the foundations (stage 1 of 5), the research and the institution's level kept.
- **Left behind.** A nation that moves to another region leaves its laboratory behind (`p.rg`), which counts as
  ruined in the same way.
- **Rebuilt.** A ruined laboratory is rebuilt from the Laboratory tab: the player chooses a site again (any kind,
  anywhere within the borders), and the four stages after the foundations are built anew. Research goes on once it
  reopens.

## The laboratory, drawn

`rsLabState` reads how far the works have got and `rsLabArt` draws it (the Overview card, the Laboratory tab and the
founding prompt), with a bar of stages under it (`rsLabProgressHTML`): a stage is three fifths materials delivered and
two fifths works done. What is still to come is drawn in dashed outline. The site is staked out and fenced, the
foundations rise from their pit as the power line arrives, the walls rise behind scaffolding, then the roof, portico,
lantern, rooftop observatory and mast go up while crates are delivered and the first scientists arrive; a tower
crane stands over the works and its load swings while the builders are at work (held still for players who prefer reduced motion). The
inauguration brings bunting, flags, a ribbon and a crowd (for three days), then lit windows and trees. Each institution
adds its own building, rising the same way: an east wing, a west wing and a dome, a research tower, the Grand
Academy's colonnade and great dome, an observatory pavilion with the flags of other nations, a glass hall, a clock
tower, and gilding and a statue for the Eternal Academy. A destroyed laboratory is drawn as broken walls, fallen
columns and smoke over its outline, and one held by an enemy with the enemy's flags, soldiers and tape. The view is close while there is only the laboratory and
widens to the whole campus with the first expansion. Its colours are the theme's, in light and dark.

## Prices and balance

The average price per tier is 5, 8, 12, 18, 25, 35, 48, 65, 85, 110, 140, 175, 220, 275, 340, 420, 480, 550, 630, 720,
820, 930, 1,050 and 1,200 RC. Tier I's five cost 2, 3, 4, 6 and 10. From Tier II the four supporting technologies
cost 0.7, 0.85, 1 and 1.05 of the tier's average and the milestone the rest (1.4). The whole programme costs
**125,415 RC** before discounts.

The institutions (`RS_INST`) and the credits a day each gives at Science 50:

| | Institution | Needs | RC a day |
| --- | --- | --- | ---: |
| I | The National Research Laboratory (its own name) | the petition | 20 |
| II | National Research Institute | one track at Tier IV | 30 |
| III | National Academy of Sciences | one track at VIII, another at IV | 40 |
| IV | Advanced Research Complex | one track at XII, both others at VIII | 55 |
| V | The Grand Academy | all tracks at XVI | 70 |
| VI | International Research Institute | all tracks at XVIII | 95 |
| VII | National Innovation Directorate | all tracks at XX | 130 |
| VIII | National (Royal) Society of Sciences | all tracks at XXII | 175 |
| IX | The Eternal Academy | all tracks at XXIV | 250 |

Names follow the type of state (Royal, Imperial, Pontifical, People's, Dominion, Borough; a sultanate's academy is the
House of Wisdom). Each is built in 3 to 8 stages of materials, more each time.

At Science 50 a player who spends everything: Tier I of a track on the first day, the first expansion (Tier IV of one
track) inside two weeks, the Foundations era of all three tracks in about a month, Modernisation in months, and the
whole programme in about three and a half years. The late game is held back by the cross-track gates, the materials,
the studies, the buildings and the Grand Challenges more than by credits.

**Discounts** come from international cooperation (an alliance's type and buildings, a joint study, an alliance's
completed research project, a licence) and the nation's own research committee and laws, **25% at most in all**.
**Credits** from international cooperation are 30% more at most.

## Effects

Every technology does something (`RS_DATA`, effects in `rsFxBits`), summed and capped at the catalogue's own totals
(`RS_FX_CAP`, so every one counts and nothing stacks past them):

| Effect | Where it acts | All 360 |
| --- | --- | ---: |
| Output of food, timber, iron, oil, goods | `economy()` (`rsEcon`) | +12.5%, +5.5%, +7%, +5.5%, +16.5% |
| Materials consumed | `economy()` demand | −8% |
| Trade efficiency, deals at once | `jvFlow` (every deal's flow), `maxDeals` | +22%, +3 |
| Prosperity, growth, army | the economy's effects, as an alliance's | +14%, +8.5%, +7% |
| Construction time, building costs | `bHours`, `bCost`, the laboratory's works | −11.5%, −9% |
| Land harder to take | `defenceMult` | +15.5% |
| Readiness | `readyMs`, `maxReady`; the referee's `milReady` (`rsWar`) | 18% sooner, +1 point |
| People lost to war, war materials | `wrPopFx`, `wrUpkeep` | −20%, −16.5% |
| Spy rolls, foreign covert operations | `spyParts`, `cvOdds` | +2, −15 points |
| Research Credits | `rsRateParts` | +20 a day |
| Mandate refill, field digs, space missions | `mdRate`, `digMod`, `mcHours` | +14%, +2, −20% |
| Currency | the currency job's development factor and forgery damage (`researchOf`) | +6 points, −30% |
| Buildings working harder (`bx`) | `nbCity` (output, prosperity, army, growth), `cityDefMult` (Fortress, Naval Dockyard), Military Hospital, Recycling Works, Granary, Observatory, Central Bank | up to +50% each |
| Figures once (`once`) | `applyEffects` when researched | Public Health +21 in all, and so on |

Six buildings are unlocked by research: the Technical College (Public Education), Teaching Hospital (Advanced
Medicine), Data Centre (Digital Economy), Signals Station (Electronic Warfare), Wind Farm (Renewable Energy) and
Science Park (National Innovation). No technology needs an alliance or the space programme: the whole programme can be
finished alone, on Earth.

## Mandate

Scientific initiatives (`RS_MD`, through `MD_COST`, `mdOk` and `mdSpend` on a copy, like every mandate spend):
emergency funding (3, halves a study's time, once a study), accelerating construction (3, halves a stage's works,
once a stage), a scientific report (2, RC +10% for three days, weekly), a research committee (3, one track 5% cheaper
for a week, fortnightly) and support for national innovation (2, Science & Technology +1, weekly).

## Edicts, laws, the Assembly, letters

- **Letters from the Laboratory** (`RS_LETTERS`): twelve gold-bordered letters from the scientific director as the
  research goes on (the inauguration, the first discovery, a scientist tempted abroad, medical trials, a foreign
  request, a minister's interference, a budget dispute, an accident, a conference, a new academy, a lifetime award,
  the Grand Academy). They adapt to the type of state, the laws, Science & Technology and earlier answers, some grant
  RC once, and none counts as an enacted edict.
- **Dilemmas** (`RS_DILEMMAS`): eight edicts that a technology makes possible (genetically bred crops, programs that
  decide, satellites over the nation's own streets, the last banknote, a national genome library, robots on the night
  shift, nuclear power, a space agency). Laws that need a technology first come through them (surveillance, data
  protection, a cashless economy, a basic income, a space programme).
- **Laws**: Open Science, Classified Research and a Research Ethics Board, each with an effect on research.
- **The Assembly**: seven scientific conventions (international health cooperation, scientific exchange, trade
  standardisation, environmental protection, international research funding, nuclear safety, arms control),
  proposed only by a nation that has researched their technology (`RS_ASM_REQ`); passed strong, each makes its law.
  They give their members benefits; no technology waits for another player's vote.

## Alliances and licences

- Each alliance type helps one track (a defence pact War, a trade bloc Trade, a cultural union Growth, a research
  accord all three, 5% each); the research accord adds 5% RC. Its buildings: the Alliance Academy RC +5% a level;
  the Joint Observatory longer joint studies and cheaper space and astronomy research; the Cipher Office cheaper
  intelligence research; the Common Market, Bloc Exchange and Shared Granary cheaper trade, financial and agricultural
  research; the Grand Theatre social research; Embassy Row scientific exchanges; the Arsenal, Joint Fleet and Beacon
  Towers military engineering, naval and defensive research.
- The research accord's five joint studies (same treasury cost, length and Observatory as before) also make their
  track's research cheaper while they run: agriculture Growth, engineering Trade, warfare War, logistics Trade and
  Growth, cryptography War and intelligence.
- **Research projects** (`rp` on the alliance's document): an officer begins one of its type from the treasury (or its
  Grand Challenge from alliance level 4); members give Research Credits, pledged in their own record (`nrp.ap`) and
  spent there, credited by the server once each (`alRsGive`, a watermark per member), at most 300 (1,200) a member.
  Completed, every member who gave has 8–12% off its track for 30 (90) days, and the alliance earns renown.
- **Licences** (`rsLic/<licensee>_<technology>`): a nation with a research pact in force licenses a technology it has
  researched to its partner, for a fee in materials by tier, paid by the licensee and credited once to the exporter
  (`nrx.lr`). The licensee pays 20% less for that technology for 30 days and still researches it itself. Once per
  technology per licensee (a declined one may be offered again after a week), three offers and three acceptances a
  week, both nations a week old with an open laboratory, Registered.

## Grand Challenges

`RS_CH`: the Great Accelerator (Tier XIII of Trade, 5 stages), the National Medical Research Centre (XIV of Growth,
5), the National Infrastructure Programme (XV of Growth, a Railway Station in three cities, 6), the Grand Academy
(the fifth institution, 6), the National University City (XVIII, 10), the International Financial Centre (XX of
Trade, 8), the National Heritage Complex (XXII, 60 museum pieces, 8) and the Legacy of a Nation (all 360
technologies and the other challenges, 20). Each is drawn stage by stage, gives lasting effects, and several later
milestones need one finished.

## Honours

The Research achievement category: the laboratory, 1 to 360 technologies, every tier in all tracks, every era, every
track, every institution, every Grand Challenge, licences given and taken, a joint study, alliance research and the
twelve letters. Titles: the Scholar, the Innovator, Master of Commerce, Architect of Civilisation, Supreme Strategist,
the Enlightened Nation and Architect of Eternity (all 360 and the Legacy of a Nation). An astrolabe for the arms, a
laboratory blueprint for the nation card, and a museum set, *Instruments of Discovery* (an astrolabe, the director's
notebook, a model steam engine, the first stethoscope, a vaccine's vial, a valve computer, a manuscript, the Grand
Academy's seal, the Legacy Register).

## Data

`n.nrp`, shared (the save permit, the referee, the currency job and every player's game read it):

| Field | |
| --- | --- |
| `v`, `a`, `o` | version, petition granted, the kind of site (0 the university quarter, 1 the coast, 2 the hills) |
| `c`, `sc`, `rg`, `ft`, `rz` | the laboratory's hex, the petition's suggested hex, its region, when it was placed, when it fell to ruins |
| `nm`, `dn`, `dl` | the laboratory's name, director's name and look |
| `st`, `sg`, `su`, `sh` | stages built (0–5), materials given to the stage in progress, its works' end, hurried |
| `i` | inaugurated (credits count from here) |
| `l`, `xs`, `xg`, `xu`, `xh` | the institution (0–8), and the next one's stages likewise |
| `k` | technologies researched: 360 bits, 60 characters of base64url; index = track × 120 + (tier − 1) × 5 + slot, slot 0 the milestone |
| `re`, `rs`, `ra` | RC earned and spent in all (the balance is `re − rs`), and the time they were counted to |
| `q` | studies `[index, start, end, paid, halved, saved]` |
| `gr` | grants received (`f` the founding grant, `a`–`d` letters') |
| `ch` | Grand Challenges `{id: {s, g, u, h, d}}` |
| `ap` | RC pledged to alliance projects `[{t, a, q}]` |
| `lc`, `dc`, `rp` | licences taken, a research committee, a science report |

`n.rsd`, shared: laboratories this nation destroyed, `[{d: their nation, c: the hex, t: when}]` (the last 10).

`n.nrx`, private (`NX_KEYS`): `h` the scientific record `[[t, kind, a, b]]`, `md` mandate initiatives, `lt` letters
answered, `lr` licence fees received, `dv`/`dvt` the petition's veto. Normalised on load (`rsCleanP`, `rsCleanX`).
Dissolving or starting over makes a new record, so research starts again; the server sees a new founding and
carries nothing over.

## Fair play

Every save passes the `civic` permit (`authorizeSave`), which calls `rsSettle(n, before, now, savedAt)` by the
server's clock before it signs the save:

- research is never lost: technologies, studies and credits the saved record held stay;
- credits earned grow no faster than `rsRateMax` (the record's Science, institution and technologies, the research
  buildings, and every boost) from the time they were last counted, never past the server's time; a grant counts once;
- a new technology must follow its prerequisites and gates and be paid for (spent grows by at least its price less
  25%); one of Tier V or above must come from a study the saved record already held, finished by the server's time;
- a study must start after the saved record, last its full time (half with emergency funding) and be paid when it
  starts;
- the institution rises one level at a time, only as far as the research allows;
- a pledge to an alliance must be paid for.

What it does not allow it takes back, and says so (`rs` in the permit's answer); the game takes the same back and tells
the player (`edictum:saved`). The device's clock is held to the server's (`RSV.skew`). A study's end makes the
technology only once a save carrying its start has landed. Saves from another device conflict on `rev` as always, so
credits are never counted twice. The referee reads readiness research from the record (`rsWar`), applied before the
Drill Ground as the game does; army and defence research flow into the saved army headline the referee and the rules
already bound. Nothing here adds a scheduled job or a listener per player: credits are counted lazily at each commit,
and the only new listener is a player's own licences.

## Tests

- `test/research.test.mjs` (in `npm run test:fx`): the catalogue (360, five a tier, the milestones, ids, icons, an
  effect each), prices (tier I, averages, 125,415, the grant), prerequisites (valid, lower tiers, acyclic, the gates),
  effects within caps, readiness for the referee, the credits formula and institution targets, the server's settle
  (clock manipulation, replayed saves, unpaid research, gates, studies, grants, levels, pledges, a nation founded
  again), the permit and the game's handling, the currency job's agreement, the petition, letters and dilemmas,
  Assembly conventions, alliances and licences.
- `test/research.mjs` (`npm run test:research`, CI group 1): the whole path in the browser, desktop light and phone
  dark: the petition at 75, a veto and its return, the menu, founding, five stages, the grant, three discoveries,
  a day away, the tree's eras and locks, a study, the Grand Challenges, the record and the first letter; no sideways
  scroll on any tab on a phone.
- `test/civic.test.mjs` (emulators): the permit's settle, an alliance research project, licences.
  `test/rules.test.mjs`: licences readable only by the two nations.
