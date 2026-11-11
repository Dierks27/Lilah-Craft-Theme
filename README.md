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

- `GET /wp-json/lilahcraft/v1/market`: the Market feed. `history7d` and `history30d` (when HomeCraftMgmt sends them) and the live market's chart markers (`events`, below) are only in `?long=1`, which the Market page asks for to turn on its 7D and 30D ranges; Home and the plain route stay small. Cached for the configured seconds. The last good copy is kept, and if a fetch fails it is served with `"stale": true`. No URL set: `{ "sample": true }`.
- `GET /wp-json/lilahcraft/v1/minis`: the same for the Minis feed. Only counts are passed on, never owners.
- `GET /wp-json/lilahcraft/v1/arcade`: the same for the Arcade feed (below), with the same token. No URL set and none to follow: `{ "sample": true }`.
- `GET /wp-json/lilahcraft/v1/status`: a Java server list ping from PHP (3 second timeout, cached 60 seconds): `{ online, players, max, version }`.

Only the fields the site uses are passed through; anything else in a feed is dropped.

- `GET /wp-json/lilahcraft/v1/activity`: "When are people on?" on the Play page. WordPress keeps the highest player count of each hour from its own pings (plus a 15-minute background check) for 14 days, and serves the average day once those samples span at least three days (a log that stopped, say because the ping broke, ages out instead of passing for recent). Counts only, never names.

### The live market (HomeCraftMgmt 0.33)

While HomeCraftMgmt's live market runs, its `/api/market` says `"live": true` and carries HOT and DEAL badges, News Flashes, the season and "Usually $X" prices. The site passes these on only when the feed says `"live": true`. With the live market off or paused (or on 0.32) none of it is in the answer, which is then exactly what theme 2.1 served, and the pages look as they did.

Each item can add, after its history:

| Field | What it is |
|---|---|
| `usual` | The price without the mood ("Usually $X"). A number, 0 or more |
| `moodPct` | How far `price` is from `usual`, in percent (`11.7` = +11.7 %) |
| `status` | `hot`, `deal`, `up`, `down` or `wanted`, while a badge shows |
| `statusEndsAt` | When that badge goes (ms). Only with a `status`; `wanted` has none |
| `events` | Chart markers, oldest first, at most 20 (HomeCraftMgmt sends those from the last 30 days): `{ t, kind, pct }` with `kind` `hot`, `deal`, `up`, `down` or `real`. **Only with `?long=1`** |

And at the top level, after `items`:

| Field | What it is |
|---|---|
| `live` | `true` (never sent otherwise) |
| `hot`, `deals` | Ids of the items that are HOT / on a DEAL; only ids that are in `items`, at most 50 each |
| `season` | `{ id, name, endsAt }`, left out when no season runs |
| `news` | The 5 newest rows, newest first: `{ id, t, kind, item, name, dir, pct, before, after, headline, line, source, active }`. `kind` is `up`, `down`, `hot`, `deal`, `wanted`, `season` or `real`; `item` is an id from `items` or `null` (always `null` for a season); `dir` is `1`, `-1` or `0`; `before` and `after` come together or not at all; `source` is `sim`, `admin`, `calendar` or `real`; `active` is `true` or `false` |

How they're checked: numbers must be finite (percents within ±1000, `usual`, `before` and `after` not below 0, times above 0); a `status` or event outside its list is dropped, and a news row with an unknown `kind` or `source`, or without an id, time or headline, is left out; text is plain text with Minecraft colour codes (`§a`, `&l`) and any markup removed, and cut to 60 characters for names (and the season's name), 140 for headlines and 200 for lines. Times can't run far ahead (that would be a clock or unit slip in HomeCraftMgmt): a news row or chart marker more than a day in the future is left out, and a `statusEndsAt` or season `endsAt` more than 60 days away counts as missing, so the badge shows with no end time and the season is left out. The same fields in any other shape, and anything else the feed adds, are dropped.

The labelled sample data has a small live market of its own, so the pages can be seen with it before a feed is set up: Oak Log HOT (+12 %), Copper Ingot on a DEAL (−10 %), an UP News Flash on Emerald (+21.5 %), Diamond WANTED, the Harvest Time season (Wheat −4 %) and five news rows. It only ever appears with the "Sample data" label, never mixed into a live feed.

### The Arcade (HomeCraftMgmt 0.35)

HomeCraftMgmt 0.35's `/api/arcade` has the open games with their odds or records, today's pick, the Scratch Ticket's pot, the Prize Counter, the Card Packs sold for tokens and the achievements. The Arcade page shows only what it has. The route passes on these keys, in this order; a section with nothing in it is left out, as the feed does:

| Key | What it is |
|---|---|
| `generatedAt` | When HomeCraftMgmt built the feed (ms). Always there: an answer without it (or the Market or Minis feed) isn't the arcade feed, and the settings page says so |
| `games` | The open games in the in-game order (the Scratch Ticket first), each id once: `{ id, name, kind }` plus the fields for its kind, below. `kind` is `chance`, `cabinet`, `parkour`, `elytra`, `boat` or `golf`; a course's `id` is its `/hcm play` id |
| `featured` | Today's pick: `{ game, until }`. `game` is a skill game or course that is in `games` (never a game of chance), or `trials` / `golf` when an admin pinned every time-trial course (`parkour`, `elytra`, `boat`) or every golf course; those two are passed on only while at least one such course is in `games`. `until` is when it changes (the next midnight, ms) |
| `jackpots` | `[{ game, tokens }]`: the Scratch Ticket's pot now, only while `games` has that ticket with its paytable, so the pot is never shown without its odds |
| `prizes` | The Prize Counter: `{ id, name, category, cost, description }`; `category` is `boosts`, `hunt`, `cosmetics`, `perks`, `trophies` or `minis`; `description` only when there is one |
| `packs` | Card Packs sold for tokens: `{ id, name, cost, odds }`, `odds` in percent per rarity (`COMMON`, `UNCOMMON`, `RARE`, `EPIC`, `LEGENDARY`; only those above 0) |
| `achievements` | `{ id, name, description, tokens }` |

By kind:

| Kind | Fields |
|---|---|
| `chance` (games of chance) | `stakes` (the tokens a player can put in), `rtpByStake` (percent given back at each stake, one decimal, rounded down), `rtp` (the lowest of them), `dailyLimit` (plays a day; the Scratch Ticket has none), `paytable`, `rules` (one line). Twenty-One adds `payouts` `{ stake: { win, twentyOne, doubleWin } }` and has no paytable; Higher or Lower adds `maxMultiplier` and `maxGuesses` |
| a paytable row | `{ stake, combo, pays, chance, oneIn }`, or `spaces` and `of` instead of `chance` and `oneIn` (the Wheel's 24 spaces). With `stake` it pays that many tokens at that stake; without, that multiple of the tokens put in. `oneIn` is the "1 in N" the game screen shows |
| `cabinet` | `board`, `unit` (`ms`, `points`, `flips`, `apples` or `wins`), `lowerIsBetter`, `best` (the server record, once someone sets one) |
| `parkour`, `elytra`, `boat` | `tier` (`easy`, `medium`, `hard` or `extreme`), `record` `{ ms, at }` |
| `golf` | `holes`, `par`, `record` `{ strokes, at }` |

While the games are off, `games` has only the Scratch Ticket and there is no `featured`; with the whole Arcade off the answer is just `generatedAt`.

**No player data.** HomeCraftMgmt sends a record holder's name (`holder`, beside a cabinet's `best` or inside a `record`) only while its owner switches names on (`web.dashboard.arcade_show_names`, shipped off). The site passes `holder` on from those two places only, when the feed sends it, and only if it looks like a player name (never a UUID). Nothing else about players comes through.

How they're checked: every object is rebuilt from the keys above, so anything else, at any depth, is dropped. Numbers must be finite, whole where they count something, and in range: a give-back above 0 and at most 100, `chance` above 0 and at most 1 with a `oneIn` that agrees with it, `spaces` at most `of`, pack odds adding up to 100. A game of chance keeps only the stakes that have their give-back (and is left out with none), and `rtp` is worked out again as the lowest. A paytable row passes only with its odds and a stake the game has, so a payout is never shown without them. An unknown `kind`, `tier`, `unit` or prize `category` is dropped (an unknown `unit` takes the cabinet's record with it). An achievement about a jackpot is never shown. Text is one plain line with Minecraft colour codes and markup removed, cut to 60 characters for names and paytable lines (120 for an achievement) and 200 for rules and descriptions. A record's `at` more than a day ahead is dropped, and so is a `featured` whose `until` is more than two days ahead.

The labelled sample data (no URL, or unreachable with no good copy yet) is the Arcade with the default numbers from HomeCraftMgmt's games guide: the Scratch Ticket (10 tokens, gives back about 77, a pot of 150), Ore Slots, Twenty-One, the Wheel and Higher or Lower with their default stakes, give-backs, daily limits and what they pay, the eight cabinets, two courses and a golf course, a few records (no names), three Prize Counter rows, the Starter Pack and two achievements. Coin Flip ships switched off, so it isn't in the sample.

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
- **House rules (Play):** once the rules are written, open **Pages → Play**, insert the **House rules** pattern (Patterns → LilahCraft) and type one rule per line. Until then the section isn't on the page.
- **News:** write posts as usual. The newest post is the big card on News. Categories are the Topics in the sidebar.
- **CraftBridge requirements** on Downloads (loader, Fabric API, NeoForge and JEI versions) are for CraftBridge Client 0.4.0 and live in `lilahcraft/inc/blocks/craftbridge.php`. Update them there when a new CraftBridge version changes them.

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
  inc/        settings, feeds + REST routes, server ping, page setup, assets, updates from GitHub,
              PHP-rendered blocks
  parts/      header, footer, news-sidebar
  templates/  front-page (Home), page-play, page-downloads, page-market, page-minis, page-arcade,
              page-guide, home (News), single, archive, category, page, index, search, 404
  patterns/   house-rules
  assets/css  fonts.css, site.css (shared) + page-<name>.css, editor.css (block editor only)
  assets/js   site.js (shared), lc-data.js (feeds, sample data, symbols, live-market badges and news, the Arcade's
              games, odds and records), page-<name>.js
  assets/img  block textures (tex-*, strip-*), the Play QR code, share cards (og/), the tab icon (icon/)
  assets/fonts  the four font families (woff2) and their licence
tools/check-theme.php   the checks the release runs (PHP lint, JSON, no bracket placeholders, none of the 2.0 look:
                        its colours, tokens and classes, rounded corners, outlined text, the star field; and none of
                        the words the Arcade never uses about games of chance in its page files)
```
