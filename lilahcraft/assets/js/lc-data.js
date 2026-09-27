/* LilahCraft shared data for Home, Market and Minis: window.LCData.
   Loads the same-origin feeds, falls back to labelled sample data, and has the
   formatting and drawing helpers both pages share. Never talks to the game server. */
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

  /* ---------- loading ---------- */

  /* No answer after 12 s counts as unreachable (so a hung request can't stop the refreshes);
     a slow connection gets another 30 s to download a big answer once it has started. */
  var ANSWER_MS = 12000, BODY_MS = 30000;
  /* The last real copy of each feed (and variant) this page has seen, kept for when a refresh fails. */
  var lastGood = {};

  /* Resolves to { mode: 'live'|'stale'|'sample', unreachable: bool, data: feed }.
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
    return { mode: 'sample', unreachable: !!unreachable, data: name === 'market' ? marketSample() : minisSample() };
  }
  /* Can't reach the feed: the last good copy as stale if there is one, otherwise labelled sample data. */
  function unreachableResult(name, key) {
    var good = lastGood[key || name];
    return good ? { mode: 'stale', unreachable: true, data: good.data } : sampleResult(name, true);
  }
  function normalize(name, j, key) {
    if (j && j.sample && !j.unreachable) { return sampleResult(name, false); }
    var list = j && !j.sample ? (name === 'market' ? j.items : j.minis) : null;
    if (!Array.isArray(list)) { return unreachableResult(name, key); }
    return { mode: j.stale ? 'stale' : 'live', unreachable: false, data: j };
  }

  /* Load now and again every refreshSeconds (market) or `everySeconds`; `opts` as for load().
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
    return marketCache;
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

  window.LCData = {
    SAMPLE_LABEL: 'Sample data',
    esc: esc, isNum: isNum, money: money, count: count, timeText: timeText,
    load: load, watch: watch, sparkPoints: sparkPoints,
    market: {
      CATEGORIES: CATEGORIES, categoryOf: categoryOf, categoryLabel: categoryLabel, swatchOf: swatchOf,
      stockFraction: stockFraction, soldOut: soldOut, symbols: symbols, SECTOR_SHORT: SECTOR_SHORT, change: change, priceSeries: priceSeries, sample: marketSample
    },
    minis: {
      RARITY_ORDER: RARITY_ORDER, RARITIES: RARITIES, CATEGORY_ORDER: CATEGORY_ORDER, rarityKey: rarityKey,
      categoryLabel: miniCategoryLabel, soldOut: miniSoldOut, printedText: printedText, printedFraction: printedFraction,
      head: head, sample: minisSample
    }
  };
})();
