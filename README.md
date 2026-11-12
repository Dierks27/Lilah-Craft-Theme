# LilahCraft theme

The WordPress block theme for [lilahcraft.com](https://lilahcraft.com): Home, Play, Downloads, Market, Minis, Arcade, Guide and News, with a live Market board, the Minis catalogue, the Arcade's games and odds, and a player count in the header.

No build step. Plain PHP, block templates, CSS and small vanilla JavaScript files.

## Install (once)

1. Download `lilahcraft-theme-<version>.zip` from the [Releases](../../releases) page.
2. In WordPress: **Appearance → Themes → Add New Theme → Upload Theme**, choose the zip, then **Replace installed with uploaded** (or **Activate** the first time).
3. That's it. The first time the new version runs (on activation, or on the first page load after uploading it over the old one) it:
   - creates any of these pages that don't exist yet: Home, Play, Downloads, Market, Minis, Arcade, Guide, News (existing pages are never changed);
   - sets **Settings → Reading** to a static front page = Home and posts page = News. Existing posts are left alone.

Permalinks must be anything except "Plain" (Settings → Permalinks), because links between pages use `/play/`, `/market/` and so on.

## Updates (automatic from then on)

From 2.0.0 on, the theme updates itself from this repo's GitHub releases. No more downloading and uploading:

- WordPress asks GitHub for the newest release (at most once an hour) during its normal update checks. A release whose `lilahcraft-theme-<version>.zip` is newer than the installed version shows up under **Dashboard → Updates** like any other theme update.
- Auto-updates are switched on for the theme the first time it runs, so WordPress installs new releases by itself on its usual twice-daily update run. To turn that off (or back on): **Appearance → Themes → LilahCraft → Disable auto-updates**.
- In a hurry: **Dashboard → Updates → Check again**, then **Update Themes**.

This works because `style.css` has `Update URI: https://github.com/Dierks27/Lilah-Craft-Theme` (so WordPress doesn't look for it on wordpress.org) and `inc/updater.php` answers WordPress's update check. The repo is public, so no token is needed. Anyone who can publish a release on this repo can ship code to the site, so treat release access like site access.

## Settings → LilahCraft

| Setting | What it does |
|---|---|
| Market feed URL | HomeCraftMgmt's `/api/market` address. Blank = the Market page and the Home board show sample data, labelled "Sample data". |
| Minis feed URL | HomeCraftMgmt's `/api/minis` address. Blank = labelled sample data. |
| Arcade feed URL | HomeCraftMgmt's `/api/arcade` address. Blank = the Market feed URL with its trailing `/api/market` changed to `/api/arcade` (the same server); the settings page shows the address it uses. With neither, labelled sample data. |
| Feed token | Optional shared secret. When HomeCraftMgmt is set up with a token, paste the same one here; WordPress sends it with every feed request as `Authorization: Bearer …`. Visitors never see it. Use https feed addresses when the feed crosses the internet. While a token is set, WordPress doesn't follow a feed's redirects (they would carry the token to another address): use the feed's final address. |
| Cache seconds | How long WordPress keeps each feed before asking again (default 60). |
| Server address / port | Pinged for the header's player count (default `mc.lilahcraft.com`, `25565`). When the ping fails, the count is hidden. |
| Minecraft version | The version the server is on, shown on Downloads. Blank hides that line. |
| CraftBridge Client version | Shown on Downloads and used in the download links (default `0.4.0`). |
| CraftBridge download URL pattern | `{version}`, `{mc}` and `{loader}` are filled in for each pick. If a file is missing, the button links to the release page instead. |
| Hero style | Charcoal (default) or Light: the top band of every page and the header, on the site and in the Site Editor (in the dark look both are always charcoal). |

Under each feed URL the settings page says when the last fetch worked or why it failed (for a blank Arcade URL, the fetch of the address it follows).

### How the live data works

Browsers never talk to the game server. WordPress fetches, caches and serves same-origin routes:

- `GET /wp-json/lilahcraft/v1/market`: the Market **summary** (below): every item with its prices, stock, department and a sparkline, the department tabs, the LCX index, and the live market's tags, season and news. No price history. This is all that Home and the Market page's list, ticker, movers, heatmap and departments load.
- `GET /wp-json/lilahcraft/v1/market?item=<id>`: one item with its price history (below), for the Market page's chart. `{ "missing": true }` for an id the feed doesn't have.
- `GET /wp-json/lilahcraft/v1/minis`: the Minis feed (below). Only counts are passed on, never owners. The Minis page's category filter lists the categories the feed uses, in the feed's order.
- `GET /wp-json/lilahcraft/v1/arcade`: the Arcade feed (below), with the same token. No URL set and none to follow: `{ "sample": true }`.
- `GET /wp-json/lilahcraft/v1/status`: a Java server list ping from PHP (3 second timeout, cached 60 seconds): `{ online, players, max, version }`.
- `GET /wp-json/lilahcraft/v1/activity`: "When are people on?" on the Play page. WordPress keeps the highest player count of each hour from its own pings (plus a 15-minute background check) for 14 days, and serves the average day once those samples span at least three days (a log that stopped, say because the ping broke, ages out instead of passing for recent). Counts only, never names.

Each feed is cached for the configured seconds. The last good copy is kept, and if a fetch fails it is served with `"stale": true`. No URL set: `{ "sample": true }`, and the page shows its labelled sample data. Every answer has an ETag, so an unchanged one costs the browser a 304. Only the fields the site uses are passed through; anything else in a feed is dropped. For a moment after it starts, HomeCraftMgmt answers with empty placeholders; those count as a failed fetch, so the last good copy stays.

**Which HomeCraftMgmt.** The site reads the feeds of HomeCraftMgmt 0.38.8 and of 0.38.7 before it. What 0.38.8 adds is used when the feed has it and is simply not there when it doesn't, so nothing breaks on either side of the plugin's update:

| Feed | 0.38.8 adds | With it | Without it (0.38.7) |
|---|---|---|---|
| Market | `departments` at the top, `department` on each item | The tabs and each item's tab are the server's own | The eight tabs the plugin ships, each item sorted by the theme's table |
| Minis | `eventOnly`, `earnFrom`, `earnTo` on a holiday Mini | The row carries them | The row is an ordinary one |
| Arcade | `rules`, `clubhouse`, `holidays`; `track` on the Ice Boat's `fresh` | Passed on | Absent |

### The Market routes

HomeCraftMgmt's `/api/market` is about 3.8 MB for the live server's 263 items, and nearly all of that is price history. Through 2.1 WordPress stored it whole, unpacked it on every request, and sent 1 MB to every Home visitor and 3.8 MB to the Market page on each refresh (both before compression). Now the feed is taken apart once, when it is fetched:

- the **summary** is what is cached and served: about 88 KB for 263 items (14 KB compressed);
- each item's **history** is stored apart, in 16 options (`lilahcraft_market_history_0` to `_15`, picked by a hash of the item id, JSON text, not autoloaded). Charting an item reads one of them and answers with about 15 KB (2 KB compressed).

`?long=1` is gone: nothing asks for every item's history at once any more.

The summary:

| Field | What it is |
|---|---|
| `title`, `generatedAt`, `refreshSeconds` | As the feed sends them |
| `items` | Each item id once (the first wins): `id`, `name`, `material`, `department`, `price`, `buy`, `sell`, `stock`, `maxStock`, `change24h`, then the live market's `usual`, `moodPct`, `status`, `statusEndsAt` (below), then `spark` |
| `department` | The item's tab: always one of `departments` (see Departments, below) |
| `departments` | The department tabs, in the game's order. Always there: the server's own list from HomeCraftMgmt 0.38.8, otherwise the eight the plugin ships: `Blocks`, `Materials`, `Food`, `Tools`, `Combat`, `Redstone`, `Collectibles`, `Misc` |
| `spark` | The item's last 24 hours as up to 24 prices, oldest first: the newest 49 half-hour prices in 24 parts, each part averaged, keeping the real first and last price. It covers the same span as `change24h`, so a rising line never sits beside a falling number |
| `index` | The LCX index over the last 24 hours, `[ { t, v } ]`, oldest first: at each half-hour snapshot, 1000 × the average of every counted item's price against its own price 24 hours ago. Counted: items in stock that have a 24h change. The Market page did this sum in the browser through 2.1; PHP now does the same sum, once per fetch |
| `live`, `hot`, `deals`, `season`, `news` | The live market (below), only while it runs |
| `stale`, `fetchedAt` | Whether this is the last good copy after a failed fetch, and when WordPress fetched it (ms) |

The item answer is `{ generatedAt, item, departments, stale, fetchedAt }`. `departments` is the summary's list of tabs. `item` is that item's record from the summary, then:

| Field | What it is |
|---|---|
| `history` | The last 48 hours: up to 96 half-hour points `{ t, p, s }` (time in ms, price, stock on the shelf), oldest first |
| `history7d`, `history30d` | Hourly (up to 168 points) and 6-hourly (up to 120), when HomeCraftMgmt sends them. The Market page turns its 7D and 30D ranges on for an item that has them |
| `events` | The live market's chart markers (below) |

**Departments.** In game, Crate's Store and Market sort every item into departments, one tab each: eight as shipped.

- **HomeCraftMgmt 0.38.8** says so in the feed: `departments` at the top level (the tab names in order, from the server's `marketplace.departments`) and a `department` on every item. The site uses both. A tab the owner renamed, an extra tab, or an item moved with `marketplace.category_overrides` then reads on the site as it does in game, with no change to the theme: `LCData.market.departments()` gives the tabs that have an item, in the feed's order (in game an empty tab is hidden too), and a name is its own label.
- **HomeCraftMgmt 0.38.7** sends neither, so the site works it out the way the plugin does, in `lilahcraft/inc/departments.php`: the eight shipped tabs, and for each item a table of the 263 live materials made with the plugin's own classifier (it gives the server's startup line: Blocks 106, Materials 59, Food 29, Tools 15, Combat 21, Redstone 14, Collectibles 12, Misc 7); for an item added to Crate since, the plugin's name rules; and Misc when no rule decides (the plugin then asks the server whether the item can be eaten or placed, which a website can't). When Crate's catalogue grows, add the new materials to the table: it is still the answer for an older plugin, and for an item the feed gives no usable department.

How they're checked: `departments` must be a list; each name is plain text on one line with colour codes and markup removed, cut to 30 characters; blanks and repeats (in any case) are dropped; 24 names at most. A list with nothing left counts as none, and the eight are used. An item's `department` is cleaned the same way and passes when it names one of the tabs (in any case; it comes out in the tab's spelling). Otherwise the table decides, and if the tabs don't have the table's name either (a server with renamed tabs), the item goes under the last tab, which is what the plugin does with a name it doesn't know. So every item's `department` is always one of `departments`.

**Stored copies.** Each stored copy carries a format number (`lilahcraft_feed_format()`). A copy an older version of the theme stored, such as 2.1's whole market or a summary without its `departments`, is deleted and fetched again rather than served. The first request for each feed after an update therefore waits for one fetch.

### The live market (HomeCraftMgmt 0.33)

While HomeCraftMgmt's live market runs, its `/api/market` says `"live": true` and carries HOT and DEAL badges, News Flashes, the season and "Usually $X" prices. The site passes these on only when the feed says `"live": true`. With the live market off or paused (or on 0.32) none of it is in the answer, and the pages show prices without tags, news or a season.

Each item can add, after `change24h`:

| Field | What it is |
|---|---|
| `usual` | The price without the mood ("Usually $X"). A number, 0 or more |
| `moodPct` | How far `price` is from `usual`, in percent (`11.7` = +11.7 %) |
| `status` | `hot`, `deal`, `up`, `down` or `wanted`, while a badge shows |
| `statusEndsAt` | When that badge goes (ms). Only with a `status`; `wanted` has none |
| `events` | Chart markers, oldest first, at most 20 (HomeCraftMgmt sends those from the last 30 days): `{ t, kind, pct }` with `kind` `hot`, `deal`, `up`, `down` or `real`. **Only in the item answer** (`?item=<id>`) |

And at the top level, after `index`:

| Field | What it is |
|---|---|
| `live` | `true` (never sent otherwise) |
| `hot`, `deals` | Ids of the items that are HOT / on a DEAL; only ids that are in `items`, at most 50 each |
| `season` | `{ id, name, endsAt }`, left out when no season runs |
| `news` | The 5 newest rows, newest first: `{ id, t, kind, item, name, dir, pct, before, after, headline, line, source, active }`. `kind` is `up`, `down`, `hot`, `deal`, `wanted`, `season` or `real`; `item` is an id from `items` or `null` (always `null` for a season); `dir` is `1`, `-1` or `0`; `before` and `after` come together or not at all; `source` is `sim`, `admin`, `calendar` or `real`; `active` is `true` or `false` |

How they're checked: numbers must be finite (percents within ±1000, `usual`, `before` and `after` not below 0, times above 0); a `status` or event outside its list is dropped, and a news row with an unknown `kind` or `source`, or without an id, time or headline, is left out; text is plain text with Minecraft colour codes (`§a`, `&l`) and any markup removed, and cut to 60 characters for names (and the season's name), 140 for headlines and 200 for lines. Times can't run far ahead (that would be a clock or unit slip in HomeCraftMgmt): a news row or chart marker more than a day in the future is left out, a `statusEndsAt` more than 60 days away counts as missing (the badge shows with no end time), and a season whose `endsAt` is more than a year away is left out. The shipped seasons run up to three months (Cozy Winter, 1 December to 28 February), so a season shows from its first day. The same fields in any other shape, and anything else the feed adds, are dropped.

The labelled sample data has a small live market of its own, so the pages can be seen with it before a feed is set up: 24 items with at least one in every department, Oak Log HOT (+12 %), Copper Ingot on a DEAL (−10 %), an UP News Flash on Emerald (+21.5 %), Diamond WANTED, the Harvest Time season (Wheat −4 %) and five news rows. It has the same two shapes as the live routes (a summary, and a record with 48 hours of history for each item), so the Market page charts a sample item the same way. It only ever appears with the "Sample data" label, never mixed into a live feed.

### The Minis

The Minis answer is `{ generatedAt, minis, stale, fetchedAt }`. Each Mini:

| Field | What it is |
|---|---|
| `id`, `name`, `series` | As the feed sends them, as plain text |
| `rarity` | `COMMON`, `UNCOMMON`, `RARE`, `EPIC` or `LEGENDARY` |
| `category` | Upper case; `MISC` when the feed has none |
| `cap`, `printed`, `soldOut` | How many can ever exist (`-1`: no cap), how many do, and whether the cap is reached |
| `skin` | The Mini's skin on Mojang's texture server; left out when the feed has none or it is anything else |
| `eventOnly` | **HomeCraftMgmt 0.38.8.** Only on a holiday Mini, and then always `true`: it is earned at its own event and never comes from a Card Pack, a Card, the Mini Printer, a crate or a wild drop |
| `earnFrom`, `earnTo` | **HomeCraftMgmt 0.38.8.** With `eventOnly`: the first and the last millisecond it can be earned (ms). They are the first millisecond of its first day and the last of its last day on the server's clock, so a page formats them in the server's time zone (US Central; the Arcade feed names it in `rules.freshSet.zone`), not the visitor's |

How the three are checked: `eventOnly` passes only when it is exactly `true`; with any other value neither it nor the dates are passed on. `earnFrom` and `earnTo` must both be numbers (not numbers in quotes), from 2020 on and no more than two years ahead, with `earnTo` not before `earnFrom`; otherwise both are left out and `eventOnly` stays. An older feed has none of the three.

### The Arcade (HomeCraftMgmt 0.38.8)

HomeCraftMgmt's `/api/arcade` has the open games with their odds, records and leaderboards, this week's Fresh Courses, the Weekly Cup, today's pick, the Star Chart, the Scratch Ticket's pot, the Prize Counter, the Card Packs sold for tokens and the achievements, and from 0.38.8 the reward rules, the Clubhouse and the holidays. The Arcade page shows only what it has. The route passes on these keys, in this order; a section with nothing in it is left out, as the feed does:

| Key | What it is |
|---|---|
| `generatedAt` | When HomeCraftMgmt built the feed (ms). Always there: an answer without it (or the Market or Minis feed) isn't the arcade feed, and the settings page says so |
| `games` | The open games in the in-game order (the Scratch Ticket first), each id once: `{ id, name, kind }` plus the fields for its kind, below. `kind` is `chance`, `cabinet`, `parkour`, `elytra`, `boat`, `dropper`, `golf` or `arena`; a course's `id` is its `/hcm play` id |
| `featured` | Today's pick: `{ game, until }`. `game` is a skill game that is in `games` (a cabinet, a course, a Dropper, a golf course or Falling Floors; never a game of chance), or `trials` / `golf` when an admin pinned every time-trial course (`parkour`, `elytra`, `boat`, `dropper`) or every golf course; those two are passed on only while at least one such course is in `games`. `until` is when it changes (the next midnight, ms) |
| `starChart` | The Fresh Courses week's Star Chart: `{ week, best }`. `week` is the week's first day (`2026-11-09`); `best` is the most stars anyone has that week, left out until someone has stars |
| `jackpots` | `[{ game, tokens }]`: the Scratch Ticket's pot now, only while `games` has that ticket with its paytable, so the pot is never shown without its odds |
| `prizes` | The Prize Counter: `{ id, name, category, cost, description }`; `category` is the counter's tab: `boosts`, `hunt`, `cosmetics`, `looks`, `perks`, `trophies`, `minis` or `keepers`. On the page the tabs carry the game's labels: Boosts, Hunt Gear, Fireworks & Trails (`cosmetics`), Looks, Perks, Trophies, Minis, Keepers. `description` only when there is one. Collector rows come and go by date |
| `packs` | Card Packs sold for tokens: `{ id, name, cost, odds }`, `odds` in percent per rarity (`COMMON`, `UNCOMMON`, `RARE`, `EPIC`, `LEGENDARY`; only those above 0) |
| `achievements` | `{ id, name, description, tokens }` |
| `rules` | **0.38.8.** The token amounts and caps the games pay by, written by the server from its own settings (the table below), so the Arcade page can print the server's numbers; without them it has only the shipped ones |
| `clubhouse` | **0.38.8.** `{ "open": true }` while the Clubhouse's room is there and takes visitors; otherwise the key is absent. Never a head count |
| `holidays` | **0.38.8.** The holidays on the server's calendar that are running or start within 14 days, soonest first: `{ id, name, from, to }`. `id` is the holiday and the year it starts in (`thanksgiving_2026`); `from` and `to` are the first millisecond of its first day and the last of its last, on the server's clock (ms), so a page prints them in the server's time zone (`rules.freshSet.zone`), not the visitor's. Names and dates only |

The feed's `freshHistory` (past Fresh courses) and `events` (Race Night) are not shown anywhere yet, so they are not passed on.

`rules`, each part only when the server has it switched on (a number that is 0 on the server is left out by the feed, and a part with nothing in it too):

| Key | What it is |
|---|---|
| `skillDailyCap` | The most every skill game together pays a player a day (60 as shipped) |
| `chanceDailyLimit` | The most a player can put into every game of chance together a day (100) |
| `featuredBonus` | Tokens for the first finish of today's pick (5) |
| `cabinets` | `{ <id>: { milestone, daily, dailyCap } }`, one per open cabinet by its `games` id: tokens for each medal (once ever), for the daily challenge, and the most that cabinet pays a player a day. Per cabinet because they don't pay alike: the six solo cabinets ship 5 / 5 / 15, Connect Four and Tic-Tac-Toe have no medals and ship `daily` 5, `dailyCap` 5 |
| `trials` | `{ firstFinish: { easy, medium, hard, extreme }, dailyCap }`: a hand-built course's first finish by tier (10 / 15 / 25 / 50), and the most the time trials pay a day (40) |
| `golf` | `{ firstFinish, parOrBetter, holeInOne, dailyCap }` (15, 5, 3, 50) |
| `cup` | `{ entry }`: tokens to enter one course's Weekly Cup (10) |
| `freshSet` | `{ everyDays, at, zone }`: a new set of Fresh Courses every `everyDays` days (7), at `at` (`"Mon 04:00"`: a weekday and a 24-hour time; the time alone, `"04:00"`, when the sets don't change on one weekday), in the time zone `zone` (`"America/Chicago"`) |
| `restarts` | The daily restarts as 24-hour times in that zone, sorted (`["04:00", "16:00"]`) |

**The Clubhouse, three ways.** `clubhouse.open` is `true`: it is open. The feed has `rules` and no `clubhouse`: this is 0.38.8 or later with the games on, and the Clubhouse is closed or not built. The feed has neither (0.38.7, or the games are off): it doesn't say. `LCData.arcade.clubhouseOpen()` gives `true`, `false` or `null` for the three, for the Arcade page to go by.

By kind:

| Kind | Fields |
|---|---|
| `chance` (games of chance) | `stakes` (the tokens a player can put in), `rtpByStake` (percent given back at each stake, one decimal, rounded down), `rtp` (the lowest of them), `dailyLimit` (plays a day; the Scratch Ticket has none), `paytable`, `rules` (one line). Twenty-One adds `payouts` `{ stake: { win, twentyOne, doubleWin } }` (no `doubleWin` at a stake that offers no Double) and has no paytable; Higher or Lower adds `maxMultiplier` and `maxGuesses`. A closed game is `{ id, name, kind, closed: true }` and nothing else (below) |
| a paytable row | `{ stake, combo, pays, chance, oneIn }`, or `spaces` and `of` instead of `chance` and `oneIn` (the Wheel's 24 spaces). With `stake` it pays that many tokens at that stake; without, that multiple of the tokens put in. `oneIn` is the "1 in N" the game screen shows |
| `cabinet` | `board`, `unit` (`ms`, `points`, `flips`, `apples` or `wins`), `lowerIsBetter`, `best` (the server record, once someone sets one), `top` |
| `parkour`, `elytra`, `boat`, `dropper` | `tier` (`easy`, `medium`, `hard` or `extreme`), `record` `{ ms, at }`, and for a Fresh course `daily`, `fresh` or `classic`; `cup`; `top` |
| `golf` | `holes`, `par`, `record` `{ strokes, at }`, and for a Fresh course `daily`, `fresh` or `classic`; `top` |
| `arena` (Falling Floors) | `shape` (`disc`, `square`, `ring`, `plus` or `diamond`), `top`: this week's longest solo times, where the higher time is the better one. No record |

The parts:

| Part | Fields |
|---|---|
| `top` | The board's leaderboard, best first, as many rows as the server sends (5 as shipped, 25 at most): `{ rank, value, unit, at }`. Ties share a rank (1, 1, 3). `unit` is the board's own: `ms` for a course and for Falling Floors, `strokes` for golf, the cabinet's unit for a cabinet |
| `daily` | On a Fresh course (a course the server builds itself, a new set each week): `{ day, nextAt, goldMs, silverMs, cadence, lastDay }`. `day` and `lastDay` are the set's first and last day (`2026-11-09`), `nextAt` when the next set goes up (ms; a recalled Classic has none), `goldMs` and `silverMs` the times for three stars and two stars (never on golf), `cadence` the set's length in days (7 weekly, 1 daily). A Fresh course's `record` and `top` are its current set's |
| `fresh` | `{ code, from, to, cadenceDays, track }`: the course code players read off its tile (`HARD-40`), when this course went up and when it changes (ms). `track` (0.38.8) is only on the Ice Boat, a `boat` course: which of its two tracks this set is, `Winding Road` or `Slalom`. The feed's short seed is not passed on |
| `classic` | On a Classics slot (an old course brought back): `{ code, from, to }`; no `to` means for good |
| `cup` | This week's Weekly Cup on a time-trial course: `{ entry, pool, entrants, endsAt }`: tokens to enter, tokens in the pool now, how many are in, when it pays out (ms). All four or none. Never on golf |

While the games are off, `games` has only the Scratch Ticket and there is no `featured` or `starChart`; with the whole Arcade off the answer is just `generatedAt`.

**No player data.** HomeCraftMgmt sends a holder's name (`holder`: beside a cabinet's `best`, inside a `record`, on a `top` row and on the `starChart`) only while its owner switches names on (`web.dashboard.arcade_show_names`, shipped off). The site passes `holder` on from those four places only, when the feed sends it, and only if it looks like a player name (never a UUID). Nothing else about players comes through.

**A give-back is never 100 or more.** When the Scratch Ticket's prizes would give back as much as a ticket costs, HomeCraftMgmt closes it and marks its entry `"closed": true`. The site then passes on its name and `closed` and nothing else: no stakes, no odds, no pot. Any other stake whose give-back reads 100 or more is left out, and a game with no stake left is left out with it.

How they're checked: every object is rebuilt from the keys above, so anything else, at any depth, is dropped. Numbers must be finite, whole where they count something, and in range: a give-back above 0 and below 100, `chance` above 0 and at most 1 with a `oneIn` that agrees with it, `spaces` at most `of`, pack odds adding up to 100. A game of chance keeps only the stakes that have their give-back (and is left out with none), and `rtp` is worked out again as the lowest. A paytable row passes only with its odds and a stake the game has, so a payout is never shown without them. An unknown `kind`, `tier`, `unit`, `shape` or prize `category` is dropped (an unknown `unit` takes the cabinet's record and board with it). A `top` row passes only in its board's unit, with a whole rank and score, and never ranked better than the row before it. A day must be a real date, a course code a word, a dash and a number, and three stars never slower than two. An achievement about a jackpot is never shown. Text is one plain line with Minecraft colour codes and markup removed, cut to 60 characters for names and paytable lines (120 for an achievement) and 200 for rules and descriptions. Times can't run far ahead: a record's or a board row's `at` more than a day ahead is dropped (the score stays), a `featured` whose `until` is more than two days ahead is dropped, a Cup that ends more than 60 days ahead is dropped, and `nextAt`, `from` and `to` more than a year ahead count as missing.

What 0.38.8 added is checked the same way, and more strictly on types: a number must be sent as a number (a number in quotes, `true` or a list is not one).

- `rules`: rebuilt from the keys in the table above, in that order, so an unknown key is dropped at every level. Every number is a whole number of tokens from 1 to 100,000 (`everyDays` from 1 to 366); a negative number, 0, a fraction or anything larger is left out, and a part with nothing left goes with it. A cabinet's rules pass only for an id that is a cabinet in `games`. `freshSet` passes whole or not at all: `at` must read exactly `Mon 04:00` or `04:00` (a three-letter English weekday, a real 24-hour time), `zone` must be a zone name of letters, digits, `_`, `+`, `-` and at most two slashes, 40 characters at most. `restarts` keeps 24-hour times only, each once, sorted, 24 at most.
- `clubhouse`: only `{ "open": true }` passes, and only `open` is passed on.
- `holidays`: a row passes with a text `id` and `name` (the name as one plain line, 60 characters at most), a `from` from 2020 on and no more than a year ahead, and a `to` that is not before `from` and no more than a year after it. An id passes once (the first wins). 12 rows at most, soonest first. A holiday that is already over is still passed on; `LCData.arcade.holidays()` leaves it out when the page is shown.
- `fresh.track`: exactly `Winding Road` or `Slalom`, on a `boat` course's `fresh` only.

The labelled sample data (no URL, or unreachable with no good copy yet) is the Arcade with the numbers HomeCraftMgmt 0.38.8 ships: the Scratch Ticket (10 tokens, gives back about 89, prizes of 3, 10, 25 and 60 tokens and a pot of 150), Ore Slots, Twenty-One, the Wheel and Higher or Lower with their stakes, give-backs, daily limits and what they pay, the eight cabinets, four of the weekly Fresh Courses (Easy Parkour, Sky Rings, the Dropper and Golf of the Week) with this week's set, star times, course codes, the Weekly Cup and a few board rows (no names), the Star Chart, six Prize Counter rows (a Looks row and a Keepers row among them), the Starter Pack and two achievements, the shipped `rules` (the numbers in the table above), an open Clubhouse, and the holidays of the shipped calendar that are running or start within 14 days (Thanksgiving from 8 November, say; most days of the year there is none, and then the sample has no `holidays` either). Coin Flip ships switched off, so it isn't in the sample.

The sample keeps the server's clock, as the feed does. Its rules name `America/Chicago`, and its holidays, this week's set (up since Monday 4:00 AM, the next one a week later), the Star Chart's week and the midnight today's pick ends are days and hours in that zone, wherever the visitor is: a page that prints them in `rules.freshSet.zone` reads Thanksgiving as 22 to 30 November in Berlin and in Los Angeles alike, and every visitor gets the same sample. Only a browser whose `Intl` has no time zones gets them on the visitor's own clock.

In `lc-data.js` the three additions are read through `LCData.arcade.rules(data)` (the rules as a fresh object, or `null`), `LCData.arcade.clubhouseOpen(data)` (`true`, `false` or `null`, above) and `LCData.arcade.holidays(data)` (the rows that are running or still to come, each with `running: true` or `false`; `[]` when there are none). `LCData.arcade.fresh(game).track` is the Ice Boat's track, or `null`. The Market's tabs are `data.departments` (always set on a loaded market) and `LCData.market.departments(data)` (the tabs that have an item, with their counts).

### Fonts and share cards

The fonts (Unbounded, Figtree, JetBrains Mono, Silkscreen; SIL Open Font License, see `assets/fonts/OFL.txt`) are served from the theme, so pages make no requests to Google. Each page has a description and a 1200×630 share card (`assets/img/og/`) for Discord, iMessage and search results; a news post uses its own excerpt and featured image. If an SEO plugin is installed, the theme leaves those tags to it.

### Dark look and tab icon

The site has a light and a dark look. It follows the device's own setting, and switches when the device does.

- The sun/moon switch in the header overrides the device. The choice is remembered in that browser (localStorage `lc-theme`); picking the look the device already uses clears it, so the site follows the device again.
- Without JavaScript the switch is hidden and the device decides.
- In the dark look the hero and header stay charcoal, whatever Hero style says. The Market page is dark in both looks. The block editor always shows the light look.

The tab icon is the logo's four squares on a charcoal tile (`assets/img/icon/`). It shows only while no Site Icon is set: a Site Icon set in WordPress (Settings → General, or the Site Editor) always wins. Until then `/favicon.ico` redirects to the theme's `favicon-32.png`.

## Editing content

Page layouts live in the theme's templates. To change copy, open **Appearance → Editor → Templates** and pick the page (for example "Page: Play"). A template edited there is saved in the database and overrides the theme's copy of it, so later theme updates won't change that page until you reset the template (⋮ → Reset).

- **Add a world (Play):** in the Play template, select a world card in "The worlds", duplicate it (⋮ → Duplicate) and change the name and text.
- **House rules (Play):** they're in the Play template (Appearance → Editor → Templates → "Page: Play", the House rules section the "Read the house rules" link lands on). Edit them there, one rule per line. The **House rules** pattern (Patterns → LilahCraft) is the same card for another page: don't insert it into Pages → Play, or the page shows it twice.
- **News:** write posts as usual. The newest post is the big card on News. Categories are the Topics in the sidebar.
- **CraftBridge requirements** on Downloads (loader, Fabric API, NeoForge and JEI versions) are for CraftBridge Client 0.4.0 and live in `lilahcraft/inc/blocks/craftbridge.php`. Update them there when a new CraftBridge version changes them.
- **Collins** on Downloads: the client version, the jar link, the file name and the release link (its address and its text) are in `lilahcraft/templates/page-downloads.html` (the #collins card). Change all four when the client mod updates (and the size and the "You also need" list, if they changed).

### Updating from 2.0

A template or part edited in Appearance → Editor under 2.0 keeps its 2.0 layout after the update to 2.1: no hero band, no texture, and the old dark bands turn plain. The Dashboard lists any such template in a notice. Reset each one (open it, ⋮ → Reset) and redo the text changes in the new layout.

## Release a new version

1. Bump `Version:` in `lilahcraft/style.css` (every release; the asset URLs carry `?ver=` with it, which is what stops a stale browser cache hiding a release).
2. Commit and push.
3. Tag and push the tag: `git tag v2.0.1 && git push origin v2.0.1`.

GitHub Actions checks the theme, confirms the tag matches the Version, zips `lilahcraft/` into `lilahcraft-theme-<version>.zip` and attaches it to a release. The zip unpacks to `lilahcraft/`, so it replaces the live theme in place. The site picks the release up by itself (see Updates above), so **pushing a tag deploys to lilahcraft.com** within about half a day.

## Layout

```
lilahcraft/
  style.css, theme.json, functions.php
  inc/        settings, feeds + REST routes, the Market's department table, server ping, page setup, assets,
              updates from GitHub, PHP-rendered blocks
  parts/      header, footer, news-sidebar
  templates/  front-page (Home), page-play, page-downloads, page-market, page-minis, page-arcade,
              page-guide, home (News), single, archive, category, page, index, search, 404
  patterns/   house-rules
  assets/css  fonts.css, site.css (shared) + page-<name>.css, editor.css (block editor only)
  assets/js   site.js (shared), lc-data.js (feeds, sample data, symbols, department tabs, live-market badges and news,
              the Arcade's games, odds, records and leaderboards, Fresh Courses, reward rules, the Clubhouse and
              holidays, the Minis' categories), page-<name>.js
  assets/img  block textures (tex-*, strip-*), the Play QR code, share cards (og/), the tab icon (icon/)
  assets/fonts  the four font families (woff2) and their licence
tools/check-theme.php   the checks the release runs (PHP lint, every script parses, JSON, no bracket placeholders,
                        the site's name, none of the 2.0 look: its colours, tokens and classes, rounded corners,
                        outlined text, the star field; none of the words the Arcade never uses about games of chance,
                        in any Arcade file or the two data files; the department table, and that lc-data.js has the
                        same eight departments)
```
