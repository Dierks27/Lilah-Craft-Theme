/* LilahCraft shared data for Home, Market, Minis and the Arcade: window.LCData.
   Loads the same-origin feeds, falls back to labelled sample data, and has the
   formatting and drawing helpers the pages share. Never talks to the game server. */
(function () {
  'use strict';
  var CFG = window.LC || {};
  var REST = CFG.rest || '/wp-json/lilahcraft/v1/';

  /* ---------- small helpers ---------- */

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function isNum(n) { return typeof n === 'number' && isFinite(n); }
  /* Own keys only, so feed text like "constructor" never matches an Object.prototype name. */
  function hasOwn(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function round(n, d) { var f = Math.pow(10, d); return Math.round(n * f) / f; }

  /* $0.08, $2.40, $1,250.00; very cheap things keep a third decimal. */
  function money(n) {
    if (!isNum(n)) { return ''; }
    var a = Math.abs(n);
    var d = a > 0 && a < 0.01 ? 3 : 2;
    return (n < 0 ? '−$' : '$') + a.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  function count(n) { return isNum(n) ? Math.round(n).toLocaleString('en-US') : ''; }
  function timeText(ms) {
    return isNum(ms) && ms > 0 ? new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
  }
  /* Time until `endsAt` (ms since 1970, like statusEndsAt): "2d 4h", "1d", "5h", "40 min"; '' when it has
     passed or isn't a time. Minutes round up (30 s left is "1 min"), hours and days down. `now` defaults to Date.now(). */
  function timeLeft(endsAt, now) {
    var n = isNum(now) ? now : Date.now();
    if (!isNum(endsAt) || endsAt <= n) { return ''; }
    var mins = Math.ceil((endsAt - n) / 60000);
    if (mins < 60) { return mins + ' min'; }
    var hours = Math.floor(mins / 60);
    if (hours < 24) { return hours + 'h'; }
    return Math.floor(hours / 24) + 'd' + (hours % 24 ? ' ' + (hours % 24) + 'h' : '');
  }
  /* How long ago `t` (ms since 1970, like a news row's t) was: "just now" (under a minute, or a clock a little
     ahead), "20 min ago", "3h ago", "2d ago"; '' when it isn't a time. Rounds down. */
  function ago(t, now) {
    var n = isNum(now) ? now : Date.now();
    if (!isNum(t) || t <= 0) { return ''; }
    var mins = Math.floor(Math.max(0, n - t) / 60000);
    if (mins < 1) { return 'just now'; }
    if (mins < 60) { return mins + ' min ago'; }
    if (mins < 1440) { return Math.floor(mins / 60) + 'h ago'; }
    return Math.floor(mins / 1440) + 'd ago';
  }
  /* The same in words, for a date in a sentence ("set 2 days ago"): "just now", "1 minute ago", "3 hours ago",
     "2 days ago", and from 30 days on the date ("on Mar 4, 2026"); '' when it isn't a time. Rounds down. */
  function agoWords(t, now) {
    var n = isNum(now) ? now : Date.now();
    if (!isNum(t) || t <= 0) { return ''; }
    var mins = Math.floor(Math.max(0, n - t) / 60000);
    function unit(k, word) { return k + ' ' + word + (k === 1 ? '' : 's') + ' ago'; }
    if (mins < 1) { return 'just now'; }
    if (mins < 60) { return unit(mins, 'minute'); }
    if (mins < 1440) { return unit(Math.floor(mins / 60), 'hour'); }
    if (mins < 30 * 1440) { return unit(Math.floor(mins / 1440), 'day'); }
    return 'on ' + new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  /* ---------- loading ---------- */

  /* No answer after 12 s counts as unreachable (so a hung request can't stop the refreshes);
     a slow connection gets another 30 s to download a big answer once it has started. */
  var ANSWER_MS = 12000, BODY_MS = 30000;
  /* The last real copy of each feed (and variant) this page has seen, kept for when a refresh fails. */
  var lastGood = {};

  /* Resolves to { mode: 'live'|'stale'|'sample', unreachable: bool, data: feed } for 'market', 'minis' or 'arcade'.
     sample = no feed URL set, or the feed can't be reached and there's no good copy yet.
     opts.long asks for the long 7D/30D history too (?long=1, Market only); it keeps its own last good copy. */
  function load(name, opts) {
    var long = !!(opts && opts.long);
    var key = long ? name + ':long' : name;
    var url = REST + name + (long ? (REST.indexOf('?') > -1 ? '&' : '?') + 'long=1' : '');
    if (!window.fetch) { return Promise.resolve(sampleResult(name, false)); }
    var ctrl = window.AbortController ? new AbortController() : null;
    var timer = 0, fail = null;
    var timeout = new Promise(function (resolve, reject) { fail = reject; });
    function giveUpAfter(ms) {
      clearTimeout(timer);
      timer = setTimeout(function () {
        if (ctrl) { ctrl.abort(); }
        fail(new Error('timeout'));
      }, ms);
    }
    giveUpAfter(ANSWER_MS);
    var req = fetch(url, { headers: { Accept: 'application/json' }, credentials: 'same-origin', signal: ctrl ? ctrl.signal : undefined })
      .then(function (r) {
        if (!r.ok) { throw new Error('HTTP ' + r.status); }
        giveUpAfter(BODY_MS);
        return r.json();
      });
    return Promise.race([req, timeout])
      .then(function (j) {
        clearTimeout(timer);
        var res = normalize(name, j, key);
        if (res.mode !== 'sample') { lastGood[key] = res; }
        return res;
      })
      .catch(function () { clearTimeout(timer); return unreachableResult(name, key); });
  }
  function sampleResult(name, unreachable) {
    var data = name === 'market' ? marketSample() : (name === 'arcade' ? arcadeSample() : minisSample());
    return { mode: 'sample', unreachable: !!unreachable, data: data };
  }
  /* Can't reach the feed: the last good copy as stale if there is one, otherwise labelled sample data. */
  function unreachableResult(name, key) {
    var good = lastGood[key || name];
    return good ? { mode: 'stale', unreachable: true, data: good.data } : sampleResult(name, true);
  }
  function normalize(name, j, key) {
    if (j && j.sample && !j.unreachable) { return sampleResult(name, false); }
    // The arcade feed can be just its timestamp (the Arcade switched off): every other key may be missing.
    var ok = !!j && !j.sample && (name === 'arcade' ? isNum(j.generatedAt) && j.generatedAt > 0 :
      Array.isArray(name === 'market' ? j.items : j.minis));
    if (!ok) { return unreachableResult(name, key); }
    return { mode: j.stale ? 'stale' : 'live', unreachable: false, data: j };
  }

  /* Load now and again every `everySeconds`, else the feed's refreshSeconds (market), else Cache seconds (Settings >
     LilahCraft, 60 by default; the arcade feed has no refreshSeconds); `opts` as for load().
     Sample data isn't reloaded unless the feed was unreachable. While the tab is hidden a due
     refresh waits, and runs as soon as the tab is shown again. Returns a stop function. */
  function watch(name, cb, everySeconds, opts) {
    var timer = null, stopped = false, pending = false;
    function schedule(res) {
      var secs = 0;
      if (res.mode !== 'sample') {
        secs = Math.max(15, Number(everySeconds || res.data.refreshSeconds || CFG.cacheSeconds || 60));
      } else if (res.unreachable) {
        secs = 60;
      }
      if (secs) { timer = setTimeout(due, secs * 1000); }
    }
    function tick() {
      load(name, opts).then(function (res) {
        if (stopped) { return; }
        try { cb(res); } catch (e) { if (window.console) { console.error(e); } }
        schedule(res);
      });
    }
    function due() {
      if (document.hidden) { pending = true; } else { tick(); }
    }
    function onVisible() {
      if (!document.hidden && pending && !stopped) {
        pending = false;
        tick();
      }
    }
    document.addEventListener('visibilitychange', onVisible);
    tick();
    return function () {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }

  /* ---------- drawing ---------- */

  /* SVG polyline points for values in a w×h box with `pad` px top and bottom. */
  function sparkPoints(values, w, h, pad) {
    var v = (values || []).filter(isNum);
    if (v.length < 2) { v = [1, 1]; }
    var min = Math.min.apply(null, v), max = Math.max.apply(null, v), span = (max - min) || 1;
    var flat = max === min;
    return v.map(function (y, i) {
      var py = flat ? h / 2 : h - pad - (y - min) / span * (h - pad * 2);
      return (i * w / (v.length - 1)).toFixed(1) + ',' + py.toFixed(1);
    }).join(' ');
  }

  /* ---------- market ---------- */

  var CATEGORIES = [
    { id: 'all', label: 'All items' },
    { id: 'stone', label: 'Stone and earth' },
    { id: 'wood', label: 'Wood' },
    { id: 'farm', label: 'Farming' },
    { id: 'ores', label: 'Ores and gems' },
    { id: 'mob', label: 'Mob drops' },
    { id: 'nether', label: 'Nether and End' },
    { id: 'other', label: 'Other' }
  ];

  /* The feed has no category, so materials map to the design's groups here. Exact names first,
     then name patterns; anything unmatched is "other". */
  var CAT_EXACT = {};
  function addCat(cat, list) { list.split(' ').forEach(function (m) { CAT_EXACT[m] = cat; }); }
  addCat('stone', 'COBBLESTONE STONE SMOOTH_STONE STONE_BRICKS DEEPSLATE COBBLED_DEEPSLATE GRANITE DIORITE ANDESITE TUFF CALCITE ' +
    'DIRT COARSE_DIRT ROOTED_DIRT GRASS_BLOCK PODZOL MYCELIUM MUD PACKED_MUD MUD_BRICKS GRAVEL FLINT SAND RED_SAND SANDSTONE RED_SANDSTONE ' +
    'CLAY CLAY_BALL BRICK BRICKS TERRACOTTA SNOWBALL SNOW_BLOCK ICE PACKED_ICE BLUE_ICE MOSS_BLOCK DRIPSTONE_BLOCK POINTED_DRIPSTONE OBSIDIAN ' +
    'MOSSY_COBBLESTONE PRISMARINE');
  addCat('wood', 'STICK BAMBOO CHARCOAL');
  addCat('farm', 'WHEAT WHEAT_SEEDS BREAD CARROT GOLDEN_CARROT POTATO BAKED_POTATO POISONOUS_POTATO BEETROOT BEETROOT_SEEDS MELON MELON_SLICE ' +
    'MELON_SEEDS PUMPKIN PUMPKIN_SEEDS CARVED_PUMPKIN SUGAR_CANE SUGAR CACTUS COCOA_BEANS KELP DRIED_KELP SWEET_BERRIES GLOW_BERRIES APPLE ' +
    'EGG HONEYCOMB HONEY_BOTTLE BROWN_MUSHROOM RED_MUSHROOM HAY_BLOCK COD SALMON TROPICAL_FISH PUFFERFISH LILY_PAD VINE SEA_PICKLE ' +
    'TORCHFLOWER_SEEDS PITCHER_POD');
  addCat('ores', 'COAL RAW_IRON IRON_INGOT IRON_NUGGET RAW_GOLD GOLD_INGOT GOLD_NUGGET RAW_COPPER COPPER_INGOT REDSTONE LAPIS_LAZULI ' +
    'DIAMOND EMERALD AMETHYST_SHARD AMETHYST_BLOCK COPPER_BLOCK IRON_BLOCK GOLD_BLOCK DIAMOND_BLOCK EMERALD_BLOCK REDSTONE_BLOCK ' +
    'LAPIS_BLOCK COAL_BLOCK');
  addCat('mob', 'ROTTEN_FLESH BONE BONE_MEAL STRING SPIDER_EYE FERMENTED_SPIDER_EYE GUNPOWDER SLIME_BALL LEATHER FEATHER RABBIT_HIDE ' +
    'RABBIT_FOOT INK_SAC GLOW_INK_SAC ARROW PHANTOM_MEMBRANE PRISMARINE_SHARD PRISMARINE_CRYSTALS NAUTILUS_SHELL TURTLE_SCUTE SCUTE ' +
    'ARMADILLO_SCUTE BREEZE_ROD BEEF PORKCHOP CHICKEN MUTTON RABBIT COOKED_BEEF COOKED_PORKCHOP COOKED_CHICKEN COOKED_MUTTON TOTEM_OF_UNDYING ' +
    'HEART_OF_THE_SEA');
  addCat('nether', 'NETHERRACK NETHER_BRICK NETHER_BRICKS SOUL_SAND SOUL_SOIL BASALT SMOOTH_BASALT BLACKSTONE GLOWSTONE GLOWSTONE_DUST QUARTZ ' +
    'NETHER_QUARTZ_ORE QUARTZ_BLOCK MAGMA_BLOCK MAGMA_CREAM BLAZE_ROD BLAZE_POWDER GHAST_TEAR NETHER_WART SHROOMLIGHT NETHERITE_SCRAP ' +
    'NETHERITE_INGOT ANCIENT_DEBRIS CRYING_OBSIDIAN END_STONE END_STONE_BRICKS CHORUS_FRUIT POPPED_CHORUS_FRUIT SHULKER_SHELL ENDER_PEARL ' +
    'ENDER_EYE DRAGON_BREATH PURPUR_BLOCK WITHER_SKELETON_SKULL NETHER_STAR');
  var CAT_RULES = [
    [/^(CRIMSON|WARPED)_/, 'nether'],
    [/^NETHER|NETHERITE|^END_|^PURPUR|CHORUS|SHULKER|BLACKSTONE|BASALT/, 'nether'],
    [/_ORE$|^RAW_|_INGOT$|_NUGGET$/, 'ores'],
    [/_(LOG|WOOD|PLANKS|SAPLING|LEAVES|STEM|HYPHAE)$|^STRIPPED_/, 'wood'],
    [/_(SEEDS|CROP)$|_WOOL$|MUSHROOM|FLOWER$/, 'farm'],
    [/TERRACOTTA|CONCRETE|_STONE$|STONE_|COBBLE|DEEPSLATE|SANDSTONE|_SAND$|_DIRT$|_ICE$/, 'stone']
  ];
  function categoryOf(material) {
    var m = String(material || '').toUpperCase();
    if (CAT_EXACT[m]) { return CAT_EXACT[m]; }
    for (var i = 0; i < CAT_RULES.length; i++) {
      if (CAT_RULES[i][0].test(m)) { return CAT_RULES[i][1]; }
    }
    return 'other';
  }
  function categoryLabel(id) {
    for (var i = 0; i < CATEGORIES.length; i++) { if (CATEGORIES[i].id === id) { return CATEGORIES[i].label; } }
    return 'Other';
  }

  /* A colour square per item, like the design. Known materials first, then the category colour. */
  var SWATCH = {
    COBBLESTONE: '#8a8a8a', STONE: '#a3a3a3', DEEPSLATE: '#50505a', COBBLED_DEEPSLATE: '#50505a', GRANITE: '#9a6b58', DIORITE: '#c8c8c6',
    ANDESITE: '#8c8c8e', DIRT: '#866043', GRAVEL: '#86807e', SAND: '#dccf9e', RED_SAND: '#be6621', CLAY_BALL: '#a4a8b8', FLINT: '#4a4a4a',
    OAK_LOG: '#8a6a3f', SPRUCE_LOG: '#5a3d1e', BIRCH_LOG: '#d8d4c4', JUNGLE_LOG: '#8a6a3a', ACACIA_LOG: '#a0562b', DARK_OAK_LOG: '#4a3218',
    MANGROVE_LOG: '#6e2e2a', CHERRY_LOG: '#e4a6b4', STICK: '#9c7a45', BAMBOO: '#7a9a2a',
    WHEAT: '#d8b547', CARROT: '#e98a1d', POTATO: '#c9a45a', BEETROOT: '#a4272d', MELON_SLICE: '#d8403a', PUMPKIN: '#e38a1d',
    SUGAR_CANE: '#8fc46a', CACTUS: '#5a8a2e', COCOA_BEANS: '#7a4a28', APPLE: '#d8303a', EGG: '#efe3c4', KELP: '#4a7a2e',
    COAL: '#3b3b3b', CHARCOAL: '#4a3f36', COPPER_INGOT: '#c9744a', RAW_COPPER: '#c9744a', IRON_INGOT: '#d8d8d8', RAW_IRON: '#d8af93',
    GOLD_INGOT: '#f2c230', RAW_GOLD: '#e0a830', REDSTONE: '#c0271f', LAPIS_LAZULI: '#2a55c4', EMERALD: '#20b35a', DIAMOND: '#5fd8d2',
    AMETHYST_SHARD: '#9a6ad8', QUARTZ: '#e8e0d8',
    ROTTEN_FLESH: '#9a5a3a', BONE: '#e8e4d0', STRING: '#e8e8e8', SPIDER_EYE: '#9a2a3a', GUNPOWDER: '#6a6a6a', SLIME_BALL: '#7ac45a',
    LEATHER: '#a0582b', FEATHER: '#f0f0f0', ENDER_PEARL: '#1f7a6a', INK_SAC: '#2a2a3a',
    NETHERRACK: '#7a3232', SOUL_SAND: '#5a4434', BLAZE_ROD: '#f2a830', GLOWSTONE_DUST: '#f2d06a', NETHER_WART: '#8a1f2a',
    GHAST_TEAR: '#d8eef2', MAGMA_CREAM: '#e0703a', NETHERITE_SCRAP: '#5a4a48', NETHERITE_INGOT: '#4a4448', END_STONE: '#e0e2a8',
    CHORUS_FRUIT: '#8a5a8a', SHULKER_SHELL: '#9a6a9a'
  };
  var CAT_SWATCH = { stone: '#9a9a9a', wood: '#8a6a3f', farm: '#d8b547', ores: '#c9c9c9', mob: '#a0582b', nether: '#7a3232', other: '#b9b3d6' };
  function swatchOf(item) {
    var m = String((item && (item.material || item.id)) || '').toUpperCase();
    return SWATCH[m] || CAT_SWATCH[categoryOf(m)] || CAT_SWATCH.other;
  }

  /* Fraction of a full shelf, 0..1, or null when the feed doesn't say. */
  function stockFraction(item) {
    if (!item || !isNum(item.stock)) { return null; }
    if (item.stock <= 0) { return 0; }
    if (!isNum(item.maxStock) || item.maxStock <= 0) { return null; }
    return Math.max(0, Math.min(1, item.stock / item.maxStock));
  }
  function soldOut(item) { return !!item && isNum(item.stock) && item.stock <= 0; }

  /* 24h change for display. Returns { text, html, dir: 'up'|'down'|'flat' }.
     html adds screen-reader words for the arrows. */
  function change(ch) {
    if (!isNum(ch)) { return { text: '', html: '', dir: 'flat' }; }
    var a = Math.abs(ch);
    if (a < 0.05) { return { text: '0.0%', html: '0.0%', dir: 'flat' }; }
    var up = ch > 0, pct = a.toFixed(1) + '%';
    return {
      text: (up ? '▲ +' : '▼ −') + pct,
      html: '<span aria-hidden="true">' + (up ? '▲ +' : '▼ −') + '</span><span class="lc-sr">' + (up ? 'up ' : 'down ') + '</span>' + pct,
      dir: up ? 'up' : 'down'
    };
  }

  /* The price history as numbers, oldest first. */
  function priceSeries(item) {
    return ((item && item.history) || []).map(function (h) { return h && h.p; }).filter(isNum);
  }

  /* ---------- the live market (HomeCraftMgmt 0.33) ----------
     Only in the feed while HomeCraftMgmt's live market runs (data.live is true), and in the sample.
     Without it these give null / [] and the pages look exactly like 2.1. */

  var TAGS = { hot: 'HOT', deal: 'DEAL', up: 'UP', down: 'DOWN', wanted: 'WANTED' };
  function tagOf(kind) {
    return typeof kind === 'string' && hasOwn(TAGS, kind) ? { kind: kind, label: TAGS[kind] } : null;
  }
  /* Times further ahead than these are a clock or unit slip upstream (micro- or nanoseconds), as in inc/feeds.php:
     a news row more than a day ahead is left out, an end more than 60 days away counts as missing. */
  var DAY_MS = 24 * 3600000, END_MS = 60 * DAY_MS;

  /* The item's badge while one shows: { kind: 'hot'|'deal'|'up'|'down'|'wanted', label: 'HOT'|'DEAL'|'UP'|'DOWN'|'WANTED',
     endsAt: ms or null (WANTED has no end) }, or null. A badge whose end has passed (an old copy of the feed) is gone. */
  function badge(item) {
    var tag = item ? tagOf(item.status) : null;
    if (!tag) { return null; }
    var now = Date.now(), ends = item.statusEndsAt;
    tag.endsAt = isNum(ends) && ends > 0 && ends <= now + END_MS ? ends : null;
    return tag.endsAt !== null && tag.endsAt <= now ? null : tag;
  }

  /* The market news: at most 5 rows from the last 7 days, newest first, as copies:
     { id, t, kind: 'up'|'down'|'hot'|'deal'|'wanted'|'season'|'real', item: an id in data.items or null, name,
       dir: 1|-1|0, pct, before and after (only when both are known), headline, line, source, active,
       tag: { kind, label } for up/down/hot/deal/wanted, null for season and real }.
     Rows with an unknown kind, no time, a time more than a day ahead or no headline are left out. [] when the feed has none. */
  var NEWS_KINDS = ['up', 'down', 'hot', 'deal', 'wanted', 'season', 'real'];
  var WEEK_MS = 7 * DAY_MS;
  function news(data) {
    var list = data && Array.isArray(data.news) ? data.news : [];
    var ids = Object.create(null), now = Date.now(), since = now - WEEK_MS;
    ((data && data.items) || []).forEach(function (it) { if (it) { ids[it.id] = true; } });
    return list.filter(function (r) {
      return !!r && NEWS_KINDS.indexOf(r.kind) > -1 && isNum(r.t) && r.t > since && r.t <= now + DAY_MS &&
        typeof r.headline === 'string' && r.headline.trim() !== '';
    }).map(function (r) {
      var row = {
        id: isNum(r.id) ? r.id : null, t: r.t, kind: r.kind,
        item: typeof r.item === 'string' && ids[r.item] ? r.item : null,
        name: typeof r.name === 'string' ? r.name : '',
        dir: r.dir > 0 ? 1 : (r.dir < 0 ? -1 : 0), pct: isNum(r.pct) ? r.pct : 0,
        headline: r.headline, line: typeof r.line === 'string' ? r.line : '',
        source: typeof r.source === 'string' ? r.source : '', active: r.active === true, tag: tagOf(r.kind)
      };
      if (isNum(r.before) && isNum(r.after)) { row.before = r.before; row.after = r.after; }
      return row;
    }).sort(function (a, b) { return b.t - a.t; }).slice(0, 5);
  }

  /* The running season: { id, name, endsAt }, or null (none, it has ended, or its end is more than 60 days away). */
  function season(data) {
    var s = data && data.season, now = Date.now();
    if (!s || typeof s.name !== 'string' || !s.name || !isNum(s.endsAt) || s.endsAt <= now || s.endsAt > now + END_MS) { return null; }
    return { id: typeof s.id === 'string' ? s.id : '', name: s.name, endsAt: s.endsAt };
  }

  /* Short sector names for tabs (the long ones are in CATEGORIES). */
  var SECTOR_SHORT = { all: 'All', ores: 'Ores', stone: 'Stone', wood: 'Wood', farm: 'Farm', mob: 'Mob', nether: 'Nether', other: 'Other' };

  /* Ticker symbols: a table for common items, otherwise a short code from the id. Always unique. */
  var SYMBOL = {
    COBBLESTONE: 'COBL', STONE: 'STON', DIRT: 'DIRT', OAK_LOG: 'OAK', SPRUCE_LOG: 'SPRC', BIRCH_LOG: 'BRCH', JUNGLE_LOG: 'JNGL',
    ACACIA_LOG: 'ACAC', DARK_OAK_LOG: 'DOAK', MANGROVE_LOG: 'MNGR', CHERRY_LOG: 'CHRY', WHEAT: 'WHT', CARROT: 'CARR', POTATO: 'POTA',
    BEETROOT: 'BEET', PUMPKIN: 'PUMP', MELON_SLICE: 'MELN', SUGAR_CANE: 'CANE', APPLE: 'APPL', EGG: 'EGG', BAMBOO: 'BMBO', KELP: 'KELP',
    COAL: 'COAL', COPPER_INGOT: 'COPR', IRON_INGOT: 'IRON', GOLD_INGOT: 'GOLD', LAPIS_LAZULI: 'LAPS', REDSTONE: 'RDST', EMERALD: 'EMRD',
    DIAMOND: 'DIAM', AMETHYST_SHARD: 'AMTH', RAW_IRON: 'RIRN', RAW_GOLD: 'RGLD', RAW_COPPER: 'RCPR', BONE: 'BONE', STRING: 'STRG',
    GUNPOWDER: 'GUNP', ROTTEN_FLESH: 'FLSH', SPIDER_EYE: 'SPEY', SLIME_BALL: 'SLME', LEATHER: 'LTHR', FEATHER: 'FTHR', INK_SAC: 'INKS',
    QUARTZ: 'QRTZ', ENDER_PEARL: 'ENDP', NETHERRACK: 'NRCK', BLAZE_ROD: 'BLZR', GLOWSTONE_DUST: 'GLOW', GHAST_TEAR: 'GHST',
    NETHERITE_INGOT: 'NTHR', NETHERITE_SCRAP: 'NSCR', ANCIENT_DEBRIS: 'DEBR', END_STONE: 'ENDS', OBSIDIAN: 'OBSD', SAND: 'SAND',
    GRAVEL: 'GRVL', CLAY_BALL: 'CLAY', DEEPSLATE: 'DPSL', COBBLED_DEEPSLATE: 'CDPS', GRANITE: 'GRNT', DIORITE: 'DIOR', ANDESITE: 'ANDS'
  };
  function codeFrom(id) {
    // "minecraft:sponge" → from "sponge", so a namespace doesn't give every item the same code.
    var s = String(id || 'item');
    s = s.slice(s.lastIndexOf(':') + 1);
    var words = s.toUpperCase().replace(/[^A-Z0-9_]/g, '').split('_').filter(Boolean);
    if (!words.length) { return 'ITEM'; }
    if (words.length === 1) {
      var w = words[0];
      return (w.charAt(0) + w.slice(1).replace(/[AEIOU]/g, '')).slice(0, 4) || w.slice(0, 4);
    }
    return (words[0].slice(0, 2) + words[words.length - 1].slice(0, 2)).slice(0, 4);
  }
  /* { id: symbol } for a list of items. Stable across refreshes and feed order (worked out in id order):
     table symbols first, then codes from the ids, numbered when two would clash.
     Prototype-free maps, so ids like "__proto__" or "constructor" are ordinary keys. */
  function symbols(items) {
    var out = Object.create(null), used = Object.create(null);
    var list = (items || []).slice().sort(function (a, b) {
      return String(a.id) < String(b.id) ? -1 : (String(a.id) > String(b.id) ? 1 : 0);
    });
    list.forEach(function (it) {
      var t = SYMBOL[String(it.material || '').toUpperCase()] || SYMBOL[String(it.id || '').toUpperCase()];
      if (t && !used[t]) { out[it.id] = t; used[t] = true; }
    });
    list.forEach(function (it) {
      if (out[it.id]) { return; }
      var base = codeFrom(it.id), sym = base, n = 2;
      // IRO2 … IRO9, IR10 …: n keeps growing, so this always finds a free one.
      while (used[sym]) { var tail = String(n++); sym = base.slice(0, Math.max(1, 4 - tail.length)) + tail; }
      out[it.id] = sym;
      used[sym] = true;
    });
    return out;
  }

  /* Sample market: the trader design's twenty items in the real feed's shape, 96 half-hour snapshots
     each. Price, stock history and the 24h change agree with each other. */
  var MARKET_SRC = [
    // id, name, material, price, 24h change %, shelf %, maxStock, seed
    ['cobblestone', 'Cobblestone', 'COBBLESTONE', 0.08, 2.4, 86, 50000, 1],
    ['stone', 'Stone', 'STONE', 0.12, 1.2, 78, 50000, 2],
    ['dirt', 'Dirt', 'DIRT', 0.04, -0.5, 92, 50000, 3],
    ['oak_log', 'Oak Log', 'OAK_LOG', 0.35, -1.1, 64, 20000, 4],
    ['spruce_log', 'Spruce Log', 'SPRUCE_LOG', 0.33, 0.6, 70, 20000, 5],
    ['wheat', 'Wheat', 'WHEAT', 0.22, -2.0, 71, 20000, 6],
    ['carrot', 'Carrot', 'CARROT', 0.18, 3.1, 66, 20000, 7],
    ['coal', 'Coal', 'COAL', 0.62, 5.8, 48, 10000, 8],
    ['copper_ingot', 'Copper Ingot', 'COPPER_INGOT', 0.95, -3.2, 51, 10000, 9],
    ['iron_ingot', 'Iron Ingot', 'IRON_INGOT', 2.40, 0.9, 42, 10000, 10],
    ['gold_ingot', 'Gold Ingot', 'GOLD_INGOT', 6.15, -0.6, 23, 5000, 11],
    ['lapis_lazuli', 'Lapis Lazuli', 'LAPIS_LAZULI', 1.80, 4.1, 35, 5000, 12],
    ['redstone', 'Redstone Dust', 'REDSTONE', 0.55, 1.7, 58, 10000, 13],
    ['emerald', 'Emerald', 'EMERALD', 18.40, 12.3, 12, 2000, 14],
    ['diamond', 'Diamond', 'DIAMOND', 96.00, 0, 0, 2000, 15],
    ['bone', 'Bone', 'BONE', 0.30, -1.4, 60, 10000, 16],
    ['string', 'String', 'STRING', 0.28, 2.2, 55, 10000, 17],
    ['gunpowder', 'Gunpowder', 'GUNPOWDER', 0.85, -4.6, 30, 5000, 18],
    ['quartz', 'Nether Quartz', 'QUARTZ', 0.75, 1.9, 44, 10000, 19],
    ['ender_pearl', 'Ender Pearl', 'ENDER_PEARL', 4.20, 6.5, 18, 2000, 20]
  ];
  var marketCache = null;
  function marketSample() {
    if (marketCache) { return marketCache; }
    var N = 96, step = 30 * 60 * 1000, now = Date.now();
    marketCache = {
      title: 'LilahCraft market',
      generatedAt: now,
      refreshSeconds: 30,
      items: MARKET_SRC.map(function (s) {
        var price = s[3], ch = s[4], shelf = s[5] / 100, max = s[6], seed = s[7], out = s[5] === 0;
        var history = [], raw = [], i;
        // Gentle waves, then a steady drift chosen so the last 24 hours move exactly by the item's change.
        for (i = 0; i < N; i++) {
          raw.push(Math.sin(i * 0.21 + seed) * 0.02 + Math.sin(i * 0.9 + seed * 1.7) * 0.008 + Math.sin(i * 2.3 + seed) * 0.003);
        }
        var k = Math.log(1 + ch / 100) - (raw[N - 1] - raw[N - 49]);
        for (i = 0; i < N; i++) { raw[i] = out ? price : Math.exp(raw[i] + k * (i - (N - 1)) / 48); }
        var last = raw[N - 1];
        for (i = 0; i < N; i++) {
          var p = out ? price : round(raw[i] * price / last, 4);
          var ago = N - 1 - i, st;
          if (out) {
            // A sold-out item ran dry over the last seven hours.
            st = ago < 14 ? Math.round(max * 0.06 * ago / 14) : Math.round(max * (0.06 + (ago - 14) * 0.0008));
          } else {
            // More on the shelf when the price is lower.
            st = Math.round(max * shelf * (1 - (p / price - 1) * 2.5));
          }
          history.push({ t: now - ago * step, p: p, s: Math.max(0, Math.min(max, st)) });
        }
        return {
          id: s[0], name: s[1], material: s[2], price: price,
          buy: out ? null : round(price * 1.05, 4), sell: round(price * 0.95, 4),
          stock: out ? 0 : Math.round(max * shelf), maxStock: max,
          change24h: out ? 0 : round((price / history[N - 49].p - 1) * 100, 1), history: history
        };
      })
    };
    addLiveSample(marketCache, now);
    return marketCache;
  }

  /* The sample's live market, like the test feed's: Oak Log HOT, Copper Ingot on a DEAL, an UP News Flash
     (on Emerald: the test feed's Blaze Rod isn't a sample item), Diamond WANTED (it's sold out) and the
     Harvest Time season (Wheat −4 %). The times fit each item's history (a HOT or DEAL that began more than
     a day ago, a flash half gone), and the headlines and lines are HomeCraftMgmt's own wording. */
  var HOUR_MS = 3600000;
  var LIVE_SRC = {
    // id: [mood %, badge, badge ends in (hours), marker (hours ago), marker %]
    oak_log: [12, 'hot', 22, 26, 12],
    copper_ingot: [-10, 'deal', 14, 30, -10],
    emerald: [12, 'up', 19, 5, 21.5],
    diamond: [0, 'wanted'],
    wheat: [-4]
  };
  function addLiveSample(market, now) {
    market.items.forEach(function (it) {
      var s = hasOwn(LIVE_SRC, it.id) ? LIVE_SRC[it.id] : [0];
      it.usual = round(it.price / (1 + s[0] / 100), 4);
      it.moodPct = s[0];
      if (s[1]) { it.status = s[1]; }
      if (s[2]) { it.statusEndsAt = now + s[2] * HOUR_MS; }
      if (s[3]) { it.events = [{ t: now - s[3] * HOUR_MS, kind: s[1], pct: s[4] }]; }
    });
    // The season ends at local midnight after its last day, four days from now.
    var ends = new Date(now);
    ends.setHours(24 * 5, 0, 0, 0);
    var lastDay = new Date(ends.getTime() - 12 * HOUR_MS).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    // The flash's sell prices before and after it, from Emerald's usual price (sell is 95 % of the price here).
    var usual = market.items.filter(function (it) { return it.id === 'emerald'; })[0].usual;
    var before = round(usual * 0.95, 2), after = round(usual * 1.215 * 0.95, 2);
    market.live = true;
    market.hot = ['oak_log'];
    market.deals = ['copper_ingot'];
    market.season = { id: 'harvest_time', name: 'Harvest Time', endsAt: ends.getTime() };
    market.news = [
      // Diamond's shelf ran out in the last half hour of its history.
      { id: 41, t: now - 20 * 60000, kind: 'wanted', item: 'diamond', name: 'Diamond', dir: 0, pct: 0,
        headline: 'Crate is looking for Diamonds!', line: 'Be the first to sell some!', source: 'sim', active: true },
      { id: 40, t: now - 5 * HOUR_MS, kind: 'up', item: 'emerald', name: 'Emerald', dir: 1, pct: 21.5, before: before, after: after,
        headline: 'A famous builder just ordered lots of Emeralds!',
        line: 'Emerald is going UP! Crate pays ' + money(before) + ' → ' + money(after) + ' (+22%) Sell now!', source: 'sim', active: true },
      { id: 39, t: now - 26 * HOUR_MS, kind: 'hot', item: 'oak_log', name: 'Oak Log', dir: 1, pct: 12,
        headline: 'Builders all over the land need Oak Logs!', line: 'Oak Log: Crate pays about +12% for about 2 days. Sell now!', source: 'sim', active: true },
      { id: 38, t: now - 30 * HOUR_MS, kind: 'deal', item: 'copper_ingot', name: 'Copper Ingot', dir: -1, pct: -10,
        headline: 'Copper Ingot is on sale at Crate!', line: 'Copper Ingot is about 10% off for about 2 days. Limit 64 a day. Order at a PC!', source: 'sim', active: true },
      { id: 37, t: now - 50 * HOUR_MS, kind: 'season', item: null, name: 'Harvest Time', dir: -1, pct: -4,
        headline: 'Harvest time! The farms are full of wheat.', line: 'Wheat -4% until ' + lastDay, source: 'calendar', active: true }
    ];
  }

  /* ---------- minis ---------- */

  var RARITY_ORDER = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
  var RARITIES = {
    common: { name: 'Common', gem: '#8a938a', bg: '#e9ece9', fg: '#40493f', shadow: '#cfd4cf', q: '#dde2dd', text: 'The everyday set. Where most collections start.' },
    uncommon: { name: 'Uncommon', gem: '#4caf6a', bg: '#dff2e6', fg: '#1d6538', shadow: '#bfe3cb', q: '#a8e6bd', text: 'Shows up often enough to trade.' },
    rare: { name: 'Rare', gem: '#4a8fe0', bg: '#e1ecfb', fg: '#1b529a', shadow: '#bcd4f4', q: '#9fc3ff', text: 'People notice in chat when you pull one.' },
    epic: { name: 'Epic', gem: '#a064e0', bg: '#efe5fb', fg: '#652ca8', shadow: '#dcc7f4', q: '#d6b8f7', text: 'Small runs. Placed ones slowly spin.' },
    legendary: { name: 'Legendary', gem: '#e0a83a', bg: '#fbf0dc', fg: '#7d4f06', shadow: '#f1d9a8', q: '#ffd66b', text: 'Tiny runs, full glow, and a burst of light when you place one.' }
  };
  /* The feed's "RARE" → "rare". Unknown rarities read as common. */
  function rarityKey(r) {
    var k = String(r || '').toLowerCase();
    return hasOwn(RARITIES, k) ? k : 'common';
  }
  var CATEGORY_ORDER = ['ANIMAL', 'FOOD', 'LETTER', 'SYMBOL', 'CHARACTER', 'VEHICLE', 'HOLIDAY', 'MISC'];
  function miniCategoryLabel(c) {
    var s = String(c || 'MISC').toLowerCase().replace(/_/g, ' ');
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  function miniSoldOut(m) { return !!m && (m.soldOut === true || (m.cap > 0 && m.printed >= m.cap)); }
  /* "12 of 50 printed", or "12 printed" when there's no cap. */
  function printedText(m) {
    if (!m || !isNum(m.printed)) { return ''; }
    return m.cap > 0 ? count(m.printed) + ' of ' + count(m.cap) + ' printed' : count(m.printed) + ' printed';
  }
  /* 0..1 of the cap, or null when uncapped. */
  function printedFraction(m) {
    return m && m.cap > 0 && isNum(m.printed) ? Math.max(0, Math.min(1, m.printed / m.cap)) : null;
  }

  /* Pixel art from the design, 8 rows of 8 palette letters. */
  var ART = {
    amethyst: [['eabbcaae', 'abcddcba', 'bcdccdcb', 'acdbbdca', 'acdbbdca', 'bcdccdcb', 'abcddcba', 'eaabbaae'], { a: '#4b3a9c', b: '#6a54c9', c: '#8f78e8', d: '#b9a8f5', e: '#2f2468' }],
    cdirt: [['abdbcbad', 'bdabdbca', 'dbcadbab', 'abdbaecb', 'bcadbbad', 'dbabcadb', 'abedbabc', 'cbadbdab'], { a: '#6c4a30', b: '#593d29', c: '#866043', d: '#4a3222', e: '#9b6f4b' }],
    dirt: [['abacdaba', 'cabaebac', 'abdacaba', 'baeabdca', 'acabacae', 'dabacaba', 'abacabda', 'caebacab'], { a: '#866043', b: '#9b6f4b', c: '#6c4a30', d: '#b9855c', e: '#593d29' }],
    bricks: [['abbmbaab', 'bacmabca', 'mmmmmmmm', 'bmabbamb', 'abmacbma', 'mmmmmmmm', 'abbmbaab', 'bacmabca'], { a: '#9c5230', b: '#b8663d', c: '#7a3b1d', m: '#d8b99b' }],
    grate: [['abcabcab', 'bddbddbc', 'cddcddca', 'abcabcab', 'bddbddbc', 'cddcddca', 'abcabcab', 'bcabcabc'], { a: '#a77e67', b: '#c49a7e', c: '#6fb39a', d: '#3a2a24' }],
    cobble: [['cabbcdaa', 'abebcaed', 'dbbacdba', 'cacddbea', 'abbeacdc', 'dcaabbad', 'aebcdaeb', 'bdacbadc'], { a: '#7f7f7f', b: '#9a9a9a', c: '#5e5e5e', d: '#6e6e6e', e: '#b0b0b0' }],
    lapis: [['abacbdab', 'cadabacb', 'abcaebac', 'bdabacda', 'acbadbac', 'baecabdb', 'adbacaeb', 'cabdbacd'], { a: '#1f4aa8', b: '#2a5cc8', c: '#173a86', d: '#4f82e2', e: '#8db4f5' }],
    beacon: [['aabbbbbc', 'addeeddc', 'bdeffedc', 'befggfec', 'befggfec', 'bdeffedc', 'bhhhhhhc', 'bccccccc'], { a: '#f4fdfe', b: '#d2f1f4', c: '#9fd2da', d: '#2c3a66', e: '#2fb8c4', f: '#5fe3e0', g: '#e6feff', h: '#221c3a' }]
  };
  var MYSTERY = ['aaaaaaaa', 'aabqqbaa', 'abqaaqba', 'aaaaqqaa', 'aaaqqaaa', 'aaaqqaaa', 'aaaaaaaa', 'aaaqqaaa'];
  var artCache = {};
  function pixelURL(rows, pal) {
    var key = rows.join('') + JSON.stringify(pal);
    if (artCache[key]) { return artCache[key]; }
    var c = document.createElement('canvas');
    c.width = 8; c.height = 8;
    var g = c.getContext('2d');
    for (var y = 0; y < 8; y++) {
      for (var x = 0; x < 8; x++) {
        g.fillStyle = pal[rows[y].charAt(x)] || '#000';
        g.fillRect(x, y, 1, 1);
      }
    }
    artCache[key] = c.toDataURL('image/png');
    return artCache[key];
  }
  /* The generated block for a Mini with no skin: charcoal with a charcoal-2 ring, a "?" in its rarity colour. */
  function mysteryURL(rarity) {
    return pixelURL(MYSTERY, { a: '#26242b', b: '#3a3740', q: RARITIES[rarityKey(rarity)].q });
  }
  var SKIN_RE = /^https:\/\/textures\.minecraft\.net\/texture\/[0-9a-f]{16,128}$/i;

  /* A head for a Mini: <span class="lc-head" aria-hidden="true">. Size and rarity shadow come from CSS
     (--head on the element or a parent, rarity class lc-r--{key} on a parent).
     With a skin: the 8×8 face at (8,8) with the hat layer at (40,8) on top, pixelated.
     Without one (or if it fails to load): the design's generated pixel block. */
  function head(mini) {
    var el = document.createElement('span');
    el.className = 'lc-head';
    el.setAttribute('aria-hidden', 'true');
    var fallback = mini && mini._art && hasOwn(ART, mini._art) ? pixelURL(ART[mini._art][0], ART[mini._art][1]) : mysteryURL(mini && mini.rarity);
    var skin = mini && typeof mini.skin === 'string' && SKIN_RE.test(mini.skin) ? mini.skin : '';
    if (!skin) {
      el.style.backgroundImage = 'url("' + fallback + '")';
      return el;
    }
    el.classList.add('lc-head--skin');
    el.style.backgroundImage = 'url("' + skin + '"), url("' + skin + '")';
    var img = new Image();
    img.onload = function () {
      if (img.naturalHeight && img.naturalWidth === img.naturalHeight * 2) { el.classList.add('lc-head--legacy'); }
    };
    img.onerror = function () {
      el.classList.remove('lc-head--skin', 'lc-head--legacy');
      el.style.backgroundImage = 'url("' + fallback + '")';
    };
    img.src = skin;
    return el;
  }

  /* Sample Minis: the design's eight, in the real feed's shape. The design leaves the Rare and
     Legendary names open, so those two get example blocks (ids kept for page-home.js). */
  var MINIS_SRC = [
    ['blue_amethyst', 'Blue Amethyst', 'COMMON', 'amethyst', 31, 50],
    ['compressed_dirt', 'Compressed Dirt', 'COMMON', 'cdirt', 17, 50],
    ['dirt', 'Dirt', 'COMMON', 'dirt', 81, 100],
    ['dried_clay_bricks', 'Dried Clay Bricks', 'COMMON', 'bricks', 47, 100],
    ['exposed_copper_grate', 'Exposed Copper Grate', 'COMMON', 'grate', 25, 100],
    ['cobblestone', 'Cobblestone', 'UNCOMMON', 'cobble', 29, 50],
    ['rare_mini', 'Lapis Block', 'RARE', 'lapis', 10, 25],
    ['legendary_mini', 'Beacon', 'LEGENDARY', 'beacon', 5, 5]
  ];
  var minisCache = null;
  function minisSample() {
    if (minisCache) { return minisCache; }
    minisCache = {
      generatedAt: Date.now(),
      minis: MINIS_SRC.map(function (s) {
        return { id: s[0], name: s[1], rarity: s[2], category: 'MISC', series: '', cap: s[5], printed: s[4], soldOut: s[4] >= s[5], _art: s[3] || undefined };
      })
    };
    return minisCache;
  }

  /* ---------- the Arcade (HomeCraftMgmt 0.35) ----------
     The feed is inc/feeds.php's lilahcraft_clean_arcade(): every section can be missing (games off, or the Arcade
     switched off), so read data.games || [] and so on. These helpers check what they use, like the market ones. */

  /* The in-game Games screen's tabs, in its order. */
  var GROUPS = [
    { id: 'luck', label: 'Luck', kinds: ['chance'] },
    { id: 'cabinets', label: 'Cabinets', kinds: ['cabinet'] },
    { id: 'courses', label: 'Courses', kinds: ['parkour', 'elytra', 'boat'] },
    { id: 'golf', label: 'Mini golf', kinds: ['golf'] }
  ];
  var KIND_LABEL = { chance: 'Game of chance', cabinet: 'Arcade cabinet', parkour: 'Parkour', elytra: 'Elytra', boat: 'Boat', golf: 'Mini golf' };
  var TIERS = ['easy', 'medium', 'hard', 'extreme'];
  var TIER_LABEL = { easy: 'Easy', medium: 'Medium', hard: 'Hard', extreme: 'Why did we build this?' };
  var CABINET_UNITS = ['ms', 'points', 'flips', 'apples', 'wins'];
  var UNIT_WORD = { points: 'point', apples: 'apple', flips: 'flip', wins: 'win', strokes: 'stroke' };

  function kindLabel(kind) { return typeof kind === 'string' && hasOwn(KIND_LABEL, kind) ? KIND_LABEL[kind] : ''; }
  function tierLabel(tier) { return typeof tier === 'string' && hasOwn(TIER_LABEL, tier) ? TIER_LABEL[tier] : ''; }
  function groupOf(kind) {
    for (var i = 0; i < GROUPS.length; i++) { if (GROUPS[i].kinds.indexOf(kind) > -1) { return GROUPS[i].id; } }
    return null;
  }
  /* Open games in the feed's order (the Scratch Ticket first), each a { id, name, kind, … } entry. */
  function games(data) {
    return (data && Array.isArray(data.games) ? data.games : []).filter(function (g) {
      return !!g && typeof g.id === 'string' && typeof g.name === 'string' && groupOf(g.kind) !== null;
    });
  }
  function game(data, id) { return games(data).filter(function (g) { return g.id === id; })[0] || null; }
  /* The games by tab: [{ id: 'luck'|'cabinets'|'courses'|'golf', label, games: […] }], only tabs with a game in them. */
  function byGroup(data) {
    var list = games(data);
    return GROUPS.map(function (grp) {
      return { id: grp.id, label: grp.label, games: list.filter(function (g) { return grp.kinds.indexOf(g.kind) > -1; }) };
    }).filter(function (grp) { return grp.games.length > 0; });
  }
  /* The Scratch Ticket has no /hcm play id: it's bought from the Arcade's Luck row or the Games screen's Luck tab. */
  function playCommand(g) { return g && typeof g.id === 'string' && g.id !== 'scratch_ticket' ? '/hcm play ' + g.id : ''; }

  /* A game of chance's give-back as the game words it, "about N of every 100 tokens": N is the feed's percent
     rounded DOWN (89.7 is 89), never up. At `stake` when given (rtpByStake), else the headline (the lowest). null if unknown. */
  function giveBack(g, stake) {
    var p = !g ? null : (stake == null ? g.rtp : (g.rtpByStake && hasOwn(g.rtpByStake, String(stake)) ? g.rtpByStake[String(stake)] : null));
    return isNum(p) && p > 0 && p <= 100 ? Math.floor(p) : null;
  }
  /* A paytable row's odds as the game screen shows them: "1 in 1,829", or "3 of 24 spaces" (the Wheel); '' if it has none. */
  function odds(row) {
    if (!row) { return ''; }
    if (isNum(row.oneIn) && row.oneIn >= 1 && isNum(row.chance) && row.chance > 0) { return '1 in ' + count(row.oneIn); }
    if (isNum(row.spaces) && isNum(row.of) && row.spaces > 0 && row.spaces <= row.of) { return row.spaces + ' of ' + row.of + ' spaces'; }
    return '';
  }
  /* What each result pays at one stake (default: the first), in the feed's order, only rows with their odds:
     [{ combo, tokens: whole tokens back at that stake, times: the multiple for a row that pays one (Ore Slots) else null,
        odds: '1 in 1,829' | '3 of 24 spaces', chance, oneIn, spaces, of }] ([] for a stake the game doesn't have). */
  function paytable(g, stake) {
    var stakes = g && Array.isArray(g.stakes) ? g.stakes : [];
    var s = stake == null ? stakes[0] : stake;
    if (!isNum(s) || stakes.indexOf(s) < 0 || !Array.isArray(g.paytable)) { return []; }
    return g.paytable.filter(function (r) {
      return !!r && typeof r.combo === 'string' && isNum(r.pays) && (r.stake == null || r.stake === s) && odds(r) !== '';
    }).map(function (r) {
      var times = r.stake == null;
      return {
        combo: r.combo, tokens: times ? r.pays * s : r.pays, times: times ? r.pays : null, odds: odds(r),
        chance: isNum(r.chance) ? r.chance : null, oneIn: isNum(r.oneIn) ? r.oneIn : null,
        spaces: isNum(r.spaces) ? r.spaces : null, of: isNum(r.of) ? r.of : null
      };
    });
  }

  /* A time as the game shows it: m:ss.t, tenths rounded down (83456 ms is "1:23.4", 18400 is "0:18.4"). */
  function time(ms) {
    if (!isNum(ms) || ms < 0) { return ''; }
    var t = Math.floor(ms / 100), secs = Math.floor(t / 10) % 60;
    return Math.floor(t / 600) + ':' + (secs < 10 ? '0' : '') + secs + '.' + (t % 10);
  }
  /* A score with its unit: "1:23.4" (ms), "18,400 points", "34 apples", "22 flips", "7 wins", "24 strokes" (1 point…). */
  function score(value, unit) {
    if (!isNum(value)) { return ''; }
    if (unit === 'ms') { return time(value); }
    if (!hasOwn(UNIT_WORD, unit)) { return count(value); }
    return count(value) + ' ' + UNIT_WORD[unit] + (value === 1 ? '' : 's');
  }
  /* A game's server record, the same for every kind, or null (none yet, or a game of chance):
     { value, unit: 'ms'|'points'|'flips'|'apples'|'wins'|'strokes', text: score(value, unit), lowerIsBetter,
       at: ms or null (cabinets have no date), holder: a name or null (only when the feed has names on) }. */
  function record(g) {
    if (!g) { return null; }
    var r = null;
    if (g.kind === 'cabinet' && isNum(g.best) && CABINET_UNITS.indexOf(g.unit) > -1) {
      r = { value: g.best, unit: g.unit, lowerIsBetter: g.lowerIsBetter === true, at: null, holder: g.holder };
    } else if (g.kind === 'golf' && g.record && isNum(g.record.strokes)) {
      r = { value: g.record.strokes, unit: 'strokes', lowerIsBetter: true, at: g.record.at, holder: g.record.holder };
    } else if (groupOf(g.kind) === 'courses' && g.record && isNum(g.record.ms)) {
      r = { value: g.record.ms, unit: 'ms', lowerIsBetter: true, at: g.record.at, holder: g.record.holder };
    }
    if (!r) { return null; }
    r.text = score(r.value, r.unit);
    r.at = isNum(r.at) && r.at > 0 ? r.at : null;
    r.holder = typeof r.holder === 'string' && r.holder !== '' ? r.holder : null;
    return r;
  }

  /* An admin can pin a whole world game as today's pick: "trials" (every parkour, elytra and boat course) or "golf". */
  var WHOLE_PICKS = {
    trials: { name: 'All time-trial courses', kinds: ['parkour', 'elytra', 'boat'] },
    golf: { name: 'All mini golf courses', kinds: ['golf'] }
  };
  /* Today's pick: { game, games: [every entry that is the pick], until: ms (the next midnight) }, or null (none, a game
     that isn't open, a game of chance, or an old copy whose day is over). For a whole world game, game is a stand-in
     { id: 'trials'|'golf', name, kind, whole: true } (its /hcm play id works) and games lists its open courses. */
  function featured(data) {
    var f = data && data.featured, now = Date.now();
    if (!f || typeof f.game !== 'string' || !isNum(f.until) || f.until <= now || f.until > now + 2 * DAY_MS) { return null; }
    var whole = Object.prototype.hasOwnProperty.call(WHOLE_PICKS, f.game) && !game(data, f.game) ? WHOLE_PICKS[f.game] : null;
    if (whole) {
      var list = games(data).filter(function (e) { return whole.kinds.indexOf(e.kind) > -1; });
      return list.length ? { game: { id: f.game, name: whole.name, kind: f.game, whole: true }, games: list, until: f.until } : null;
    }
    var g = game(data, f.game);
    return g && g.kind !== 'chance' ? { game: g, games: [g], until: f.until } : null;
  }
  /* A pot now: { game: the entry, tokens }, or null. Only with the game's odds (a paytable row with them), so the
     pot is never shown on its own. */
  function jackpot(data, id) {
    var want = id || 'scratch_ticket';
    var j = (data && Array.isArray(data.jackpots) ? data.jackpots : []).filter(function (p) { return p && p.game === want; })[0];
    var g = j && isNum(j.tokens) ? game(data, want) : null;
    return g && g.kind === 'chance' && (g.paytable || []).some(function (r) { return odds(r) !== ''; }) ? { game: g, tokens: j.tokens } : null;
  }

  /* The Prize Counter's tabs, labelled as on the Arcade page. */
  var PRIZE_CATEGORIES = [
    { id: 'boosts', label: 'Boosts' }, { id: 'hunt', label: 'Hunt gear' }, { id: 'cosmetics', label: 'Cosmetics' },
    { id: 'perks', label: 'Perks' }, { id: 'trophies', label: 'Trophies' }, { id: 'minis', label: 'Mini supplies' }
  ];
  /* [{ id, label, prizes: [{ id, name, category, cost, description? }] }], only tabs with a prize in them. */
  function prizeGroups(data) {
    var list = data && Array.isArray(data.prizes) ? data.prizes : [];
    return PRIZE_CATEGORIES.map(function (c) {
      return { id: c.id, label: c.label, prizes: list.filter(function (p) { return p && p.category === c.id && isNum(p.cost); }) };
    }).filter(function (c) { return c.prizes.length > 0; });
  }
  /* A Card Pack's odds in rarity order, for the Minis colours (LCData.minis.RARITIES[key]):
     [{ key: 'common', name: 'Common', pct: 62, text: '62%' }]. */
  function packOdds(pack) {
    var o = pack && pack.odds && typeof pack.odds === 'object' ? pack.odds : {};
    return RARITY_ORDER.map(function (key) {
      var pct = hasOwn(o, key.toUpperCase()) ? o[key.toUpperCase()] : null;
      return isNum(pct) && pct > 0 ? { key: key, name: RARITIES[key].name, pct: pct, text: round(pct, 2) + '%' } : null;
    }).filter(Boolean);
  }

  /* Sample Arcade, in the real feed's shape, with the guide's default numbers (HomeCraftMgmt 0.35's games guide):
     every game that ships on (Coin Flip ships off), their stakes, give-backs, daily limits and what they pay. The
     courses are the guide's examples; records, prizes, the pack and the achievements are HomeCraftMgmt's test fixtures.
     No names: a sample record has no holder. */
  var arcadeCache = null;
  function arcadeSample() {
    if (arcadeCache) { return arcadeCache; }
    var now = Date.now(), midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0);
    // The pot starts at 50 and grows by 1 a ticket; won 1 time in 100, it sits around 150 (the 77.6 assumes that).
    var pot = 150;
    var ticket = [[3, 0.4, 3], [8, 0.22, 5], [20, 0.09, 11], [50, 0.03, 33]].map(function (r) {
      return { stake: 10, combo: r[0] + ' tokens', pays: r[0], chance: r[1], oneIn: r[2] };
    }).concat([{ stake: 10, combo: 'the jackpot', pays: pot, chance: 0.01, oneIn: 100 }]);
    // Ore Slots pays multiples of the tokens in; "two the same" is what's left of 89.97 % after the rest.
    var slots = [['three wilds', 50, 0.00007809, 12805], ['three diamonds', 40, 0.0005467, 1829], ['three gold', 20, 0.002033, 492],
      ['three iron', 10, 0.004926, 203], ['three copper', 6, 0.009709, 103], ['three coal', 4, 0.01667, 60], ['two the same', 2, 0.3295, 3]];
    var wheel = [];
    [[5, 22, 17, 8], [10, 44, 35, 17], [20, 87, 70, 35]].forEach(function (w) {
      var s = w[0];
      wheel.push({ stake: s, combo: w[1] + ' tokens', pays: w[1], spaces: 1, of: 24 }, { stake: s, combo: w[2] + ' tokens', pays: w[2], spaces: 2, of: 24 },
        { stake: s, combo: w[3] + ' tokens', pays: w[3], spaces: 3, of: 24 }, { stake: s, combo: 'your ' + s + ' back', pays: s, spaces: 5, of: 24 },
        { stake: s, combo: 'nothing', pays: 0, spaces: 13, of: 24 });
    });
    function cabinet(id, name, board, unit, best) {
      var g = { id: id, name: name, kind: 'cabinet', board: board, unit: unit, lowerIsBetter: unit === 'ms' || unit === 'flips' };
      if (best) { g.best = best; }
      return g;
    }
    arcadeCache = {
      generatedAt: now,
      games: [
        { id: 'scratch_ticket', name: 'Scratch Ticket', kind: 'chance', stakes: [10], rtp: 77.6, rtpByStake: { 10: 77.6 }, paytable: ticket },
        { id: 'ore_slots', name: 'Ore Slots', kind: 'chance', stakes: [1, 2, 5], rtp: 89.9, rtpByStake: { 1: 89.9, 2: 89.9, 5: 89.9 }, dailyLimit: 50,
          paytable: slots.map(function (r) { return { combo: r[0], pays: r[1], chance: r[2], oneIn: r[3] }; }) },
        { id: 'twenty_one', name: 'Twenty-One', kind: 'chance', stakes: [5, 10, 20], rtp: 89.7, rtpByStake: { 5: 89.7, 10: 89.7, 20: 89.7 }, dailyLimit: 30,
          rules: 'Beat the Arcade\'s hand without going over 21.',
          payouts: { 5: { win: 9, twentyOne: 11, doubleWin: 18 }, 10: { win: 18, twentyOne: 22, doubleWin: 36 }, 20: { win: 36, twentyOne: 44, doubleWin: 72 } } },
        { id: 'wheel', name: 'The Wheel', kind: 'chance', stakes: [5, 10, 20], rtp: 87.5, rtpByStake: { 5: 87.5, 10: 89.5, 20: 90 }, dailyLimit: 30, paytable: wheel },
        { id: 'higher_lower', name: 'Higher or Lower', kind: 'chance', stakes: [10, 20, 50], rtp: 89.6, rtpByStake: { 10: 89.6, 20: 90, 50: 89.7 }, dailyLimit: 30,
          rules: 'Guess higher or lower. Cash out any time.', maxMultiplier: 20, maxGuesses: 10 },
        cabinet('creeper_sweeper', 'Creeper Sweeper', 'normal', 'ms', 18400),
        cabinet('ore_merge', 'Ore Merge', 'classic', 'points'),
        cabinet('snake', 'Snake', 'classic', 'apples', 12),
        cabinet('mini_match', 'Mini Match', 'classic', 'flips'),
        cabinet('simon_says', 'Simon Says', 'classic', 'points', 14),
        cabinet('whack_a_zombie', 'Whack-a-Zombie', 'classic', 'points'),
        cabinet('connect_four', 'Connect Four', 'hard', 'wins'),
        cabinet('tic_tac_toe', 'Tic-Tac-Toe', 'wins', 'wins'),
        { id: 'cliffs', name: 'Cliffs', kind: 'parkour', tier: 'easy' },
        { id: 'river_run', name: 'River Run', kind: 'boat', tier: 'medium', record: { ms: 61234, at: now - 2 * DAY_MS } },
        { id: 'golf_meadow', name: 'Meadow Links', kind: 'golf', holes: 9, par: 27, record: { strokes: 24, at: now - 3 * DAY_MS } }
      ],
      featured: { game: 'river_run', until: midnight.getTime() },
      jackpots: [{ game: 'scratch_ticket', tokens: pot }],
      prizes: [
        { id: 'night_vision', name: 'Night Vision', category: 'boosts', cost: 6, description: 'See in the dark for 20 minutes.' },
        { id: 'home_slot', name: '+1 Home', category: 'perks', cost: 400, description: 'One more /home, on top of the homes you already have.' },
        { id: 'hat_command', name: '/hat', category: 'perks', cost: 300, description: 'Wear the block in your hand on your head with /hat.' }
      ],
      packs: [{ id: 'starter', name: 'Starter Pack', cost: 50, odds: { COMMON: 62, UNCOMMON: 28, RARE: 9, EPIC: 1 } }],
      achievements: [
        { id: 'first_sale', name: 'Sell something to Crate', description: 'Sell something to Crate', tokens: 10 },
        { id: 'first_crate', name: 'Open an Arcade Crate', description: 'Open an Arcade Crate', tokens: 5 }
      ]
    };
    return arcadeCache;
  }

  window.LCData = {
    SAMPLE_LABEL: 'Sample data',
    esc: esc, isNum: isNum, money: money, count: count, timeText: timeText, timeLeft: timeLeft, ago: ago, agoWords: agoWords,
    load: load, watch: watch, sparkPoints: sparkPoints,
    market: {
      CATEGORIES: CATEGORIES, categoryOf: categoryOf, categoryLabel: categoryLabel, swatchOf: swatchOf,
      stockFraction: stockFraction, soldOut: soldOut, symbols: symbols, SECTOR_SHORT: SECTOR_SHORT, change: change, priceSeries: priceSeries,
      badge: badge, news: news, season: season, sample: marketSample
    },
    minis: {
      RARITY_ORDER: RARITY_ORDER, RARITIES: RARITIES, CATEGORY_ORDER: CATEGORY_ORDER, rarityKey: rarityKey,
      categoryLabel: miniCategoryLabel, soldOut: miniSoldOut, printedText: printedText, printedFraction: printedFraction,
      head: head, sample: minisSample
    },
    arcade: {
      GROUPS: GROUPS, TIERS: TIERS, PRIZE_CATEGORIES: PRIZE_CATEGORIES, kindLabel: kindLabel, tierLabel: tierLabel, groupOf: groupOf,
      games: games, game: game, byGroup: byGroup, playCommand: playCommand, giveBack: giveBack, odds: odds, paytable: paytable,
      time: time, score: score, record: record, featured: featured, jackpot: jackpot, prizeGroups: prizeGroups, packOdds: packOdds,
      sample: arcadeSample
    }
  };
})();
