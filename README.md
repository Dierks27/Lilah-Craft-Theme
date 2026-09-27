# LilahCraft theme

The WordPress block theme for [lilahcraft.com](https://lilahcraft.com): Home, Play, Downloads, Market, Minis, Arcade, Guide and News, with a live Market board, the Minis catalogue and a player count in the header.

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
| Cache seconds | How long WordPress keeps each feed before asking again (default 60). |
| Server address / port | Pinged for the header's player count (default `mc.lilahcraft.com`, `25565`). When the ping fails, the count is hidden. |
| Minecraft version | The version the server is on, shown on Downloads. Blank hides that line. |
| CraftBridge Client version | Shown on Downloads and used in the download links (default `0.4.0`). |
| CraftBridge download URL pattern | `{version}`, `{mc}` and `{loader}` are filled in for each pick. If a file is missing, the button links to the release page instead. |
| Hero style | Charcoal (default) or Light: the top band of every page and the header. |

Under each feed URL the settings page says when the last fetch worked or why it failed.

### How the live data works

Browsers never talk to the game server. WordPress fetches, caches and serves same-origin routes:

- `GET /wp-json/lilahcraft/v1/market`: the Market feed. Cached for the configured seconds. The last good copy is kept, and if a fetch fails it is served with `"stale": true`. No URL set: `{ "sample": true }`.
- `GET /wp-json/lilahcraft/v1/minis`: the same for the Minis feed. Only counts are passed on, never owners.
- `GET /wp-json/lilahcraft/v1/status`: a Java server list ping from PHP (3 second timeout, cached 60 seconds): `{ online, players, max, version }`.

Only the fields the site uses are passed through; anything else in a feed is dropped.

- `GET /wp-json/lilahcraft/v1/activity`: "When are people on?" on the Play page. WordPress keeps the highest player count of each hour from its own pings (plus a 15-minute background check) for 14 days, and serves the average day once it has at least three days of data. Counts only, never names.

### Fonts and share cards

The fonts (Unbounded, Figtree, JetBrains Mono, Silkscreen; SIL Open Font License, see `assets/fonts/OFL.txt`) are served from the theme, so pages make no requests to Google. Each page has a description and a 1200×630 share card (`assets/img/og/`) for Discord, iMessage and search results; a news post uses its own excerpt and featured image. If an SEO plugin is installed, the theme leaves those tags to it.

## Editing content

Page layouts live in the theme's templates. To change copy, open **Appearance → Editor → Templates** and pick the page (for example "Page: Play"). A template edited there is saved in the database and overrides the theme's copy of it, so later theme updates won't change that page until you reset the template (⋮ → Reset).

- **Add a world (Play):** in the Play template, select a world card in "The worlds", duplicate it (⋮ → Duplicate) and change the name and text.
- **House rules (Play):** once the rules are written, open **Pages → Play**, insert the **House rules** pattern (Patterns → LilahCraft) and type one rule per line. Until then the section isn't on the page.
- **News:** write posts as usual. The newest post is the big card on News. Categories are the Topics in the sidebar.
- **CraftBridge requirements** on Downloads (loader, Fabric API, NeoForge and JEI versions) are for CraftBridge Client 0.4.0 and live in `lilahcraft/inc/blocks/craftbridge.php`. Update them there when a new CraftBridge version changes them.

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
  parts/      header, footer
  templates/  front-page (Home), page-play, page-downloads, page-market, page-minis, page-arcade,
              page-guide, home (News), single, archive, page, index, 404
  patterns/   house-rules
  assets/css  fonts.css, site.css (shared) + page-<name>.css, editor.css (block editor only)
  assets/js   site.js (shared), lc-data.js (feeds, sample data, symbols), page-<name>.js
  assets/img  block textures (tex-*, strip-*), the Play QR code, share cards (og/)
  assets/fonts  the four font families (woff2) and their licence
tools/check-theme.php   the checks the release runs (PHP lint, JSON, no bracket placeholders, no old colours)
```
