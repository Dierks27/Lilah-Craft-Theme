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
  /* When a feed was made, in the visitor's own time: "6:00 PM" today, "Nov 3, 6:00 PM" on another day (so a
     stale copy days old doesn't read as today), "Dec 30, 2025, 6:00 PM" in another year; '' when it isn't a time. */
  function timeText(ms) {
    var d = new Date(isNum(ms) && ms > 0 ? ms : NaN), now = new Date();
    if (isNaN(d.getTime())) { return ''; }
    var t = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (d.toDateString() === now.toDateString()) { return t; }
    var day = { month: 'short', day: 'numeric' };
    if (d.getFullYear() !== now.getFullYear()) { day.year = 'numeric'; }
    return d.toLocaleDateString('en-US', day) + ', ' + t;
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
  /* The last real copy of each feed this page has seen, kept for when a refresh fails. */
  var lastGood = {};

  /* JSON from one of the site's own routes. Rejects when there is no answer in time, on an HTTP error or on bad JSON. */
  function fetchJSON(url) {
    if (!window.fetch) { return Promise.reject(new Error('no fetch')); }
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
    return Promise.race([req, timeout]).then(
      function (j) { clearTimeout(timer); return j; },
      function (e) { clearTimeout(timer); throw e; }
    );
  }

  /* Resolves to { mode: 'live'|'stale'|'sample', unreachable: bool, data: feed } for 'market', 'minis' or 'arcade'.
     sample = no feed URL set, or the feed can't be reached and there's no good copy yet.
     'market' is the summary: every item without its price history (LCData.market.item() has that, one item at a time).
     Its data.departments is always set: the department tabs in order (see LCData.market.departments()). */
  function load(name) {
    var got = !window.fetch ? Promise.resolve(sampleResult(name, false)) : fetchJSON(REST + name).then(function (j) {
      var res = normalize(name, j);
      if (res.mode !== 'sample') { lastGood[name] = res; }
      return res;
    }).catch(function () { return unreachableResult(name); });
    return got.then(function (res) {
      if (name === 'market') { marketLoaded(res); }
      return res;
    });
  }
  function sampleResult(name, unreachable) {
    var data = name === 'market' ? marketSample() : (name === 'arcade' ? arcadeSample() : minisSample());
    return { mode: 'sample', unreachable: !!unreachable, data: data };
  }
  /* Can't reach the feed: the last good copy as stale if there is one, otherwise labelled sample data. */
  function unreachableResult(name) {
    var good = lastGood[name];
    return good ? { mode: 'stale', unreachable: true, data: good.data } : sampleResult(name, true);
  }
  function normalize(name, j) {
    if (j && j.sample && !j.unreachable) { return sampleResult(name, false); }
    // The arcade feed can be just its timestamp (the Arcade switched off): every other key may be missing.
    var ok = !!j && !j.sample && (name === 'arcade' ? isNum(j.generatedAt) && j.generatedAt > 0 :
      Array.isArray(name === 'market' ? j.items : j.minis));
    if (!ok) { return unreachableResult(name); }
    // WordPress always sends the tabs; an answer without a usable list still gets the eight, so pages never guess.
    if (name === 'market') { j.departments = tabNames(j); }
    return { mode: j.stale ? 'stale' : 'live', unreachable: false, data: j };
  }

  /* Load now and again every `everySeconds`, else the feed's refreshSeconds (market), else Cache seconds (Settings >
     LilahCraft, 60 by default; the arcade feed has no refreshSeconds).
     Sample data isn't reloaded unless the feed was unreachable. While the tab is hidden a due
     refresh waits, and runs as soon as the tab is shown again. Returns a stop function. */
  function watch(name, cb, everySeconds) {
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
      load(name).then(function (res) {
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

  /* Crate's departments: the tabs of the Store and the Market in game. A loaded market always has them in
     data.departments, the names in tab order: the server's own from HomeCraftMgmt 0.38.8 (so a renamed or an extra
     tab shows here as it does in game), and until then the eight the plugin ships, which are DEPARTMENTS. A name is
     its own label. Every item's `department` is one of data.departments: the feed's own for the item, else worked
     out in inc/departments.php the way the plugin sorts its tabs. Build tabs from departments(data), never from
     DEPARTMENTS. */
  var DEPARTMENTS = ['Blocks', 'Materials', 'Food', 'Tools', 'Combat', 'Redstone', 'Collectibles', 'Misc'];
  /* The tab names of a market answer: its `departments` when that is a usable list (text, each once), else the eight. */
  function tabNames(data) {
    var out = [];
    (data && Array.isArray(data.departments) ? data.departments : []).forEach(function (d) {
      if (typeof d === 'string' && d !== '' && out.indexOf(d) < 0) { out.push(d); }
    });
    return out.length ? out : DEPARTMENTS.slice();
  }
  /* An item's department, as the feed names it ('Misc' for an item without one, which a cleaned feed never has). */
  function departmentOf(item) {
    var d = item && item.department;
    return typeof d === 'string' && d !== '' ? d : 'Misc';
  }
  /* The tabs that have an item, in tab order: [{ name: 'Blocks', count: 106 }] (in game an empty tab is hidden too).
     The order is data.departments'. A department an item names that isn't listed there follows at the end, so every
     item sits under one of these tabs whatever the answer looks like: filter with departmentOf(item) === name. */
  function departments(data) {
    var n = Object.create(null), order = tabNames(data);
    ((data && data.items) || []).forEach(function (it) {
      if (!it) { return; }
      var d = departmentOf(it);
      if (!(d in n)) {
        n[d] = 0;
        if (order.indexOf(d) < 0) { order.push(d); }
      }
      n[d]++;
    });
    return order.filter(function (d) { return n[d] > 0; }).map(function (d) { return { name: d, count: n[d] }; });
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

  /* The summary's sparkline for an item: the last 24 hours as up to 24 prices, oldest first ([] when it has none). */
  function spark(item) {
    return (item && Array.isArray(item.spark) ? item.spark : []).filter(isNum);
  }
  /* An item's prices as numbers, oldest first: its history when the record has one (a record from item(), the last
     48 hours), otherwise the summary's spark. */
  function priceSeries(item) {
    var hist = (item && Array.isArray(item.history) ? item.history : []).map(function (h) { return h && h.p; }).filter(isNum);
    return hist.length ? hist : spark(item);
  }
  /* The LCX index over the last 24 hours as numbers, oldest first, ready for sparkPoints(): data.index is [{ t, v }],
     worked out once per fetch in inc/feeds.php from every item in stock. null with fewer than two points. */
  function index(data) {
    var v = (data && Array.isArray(data.index) ? data.index : []).map(function (p) { return p && p.v; }).filter(isNum);
    return v.length >= 2 ? v : null;
  }

  /* One item with its price history, for the chart. The summary doesn't carry history (for a few hundred items it runs
     to megabytes), so the page asks for the item it is charting: ?item=<id> answers with the summary's fields for
     that item plus
       history     the last 48 hours, [{ t, p, s }] half-hourly, oldest first (p price, s stock on the shelf)
       history7d   hourly, and history30d, every 6 hours, when HomeCraftMgmt sends them
       events      the live market's chart markers, [{ t, kind: 'hot'|'deal'|'up'|'down'|'real', pct }]
     Resolves (never rejects) to { mode, item }:
       'live'         item is the record, fresh
       'stale'        item is the last good record: WordPress's (the feed is down) or this page's (the request failed)
       'sample'       item is the labelled sample's record. Only while the market itself is the sample (no feed set, or
                      none reachable yet), so sample history never sits under live prices
       'missing'      item is null: the market doesn't have that id (any more)
       'unreachable'  item is null: the request failed and this page has no earlier copy
     Asked once per item per refresh: until the next load of 'market' the same promise comes back, so drawing again
     costs nothing; after it the item is fetched again (an unchanged one is a 304). */
  var itemAsked = Object.create(null), itemGood = Object.create(null), marketMode = '';
  function marketLoaded(res) {
    marketMode = res.mode;
    itemAsked = Object.create(null);
  }
  function sampleItemResult(id) {
    var it = sampleItem(id);
    return { mode: it ? 'sample' : 'missing', item: it };
  }
  function item(id) {
    var key = String(id == null ? '' : id);
    if (itemAsked[key]) { return itemAsked[key]; }
    var asked;
    if (marketMode === 'sample' || !window.fetch) {
      asked = Promise.resolve(sampleItemResult(key));
    } else {
      asked = fetchJSON(REST + 'market' + (REST.indexOf('?') > -1 ? '&' : '?') + 'item=' + encodeURIComponent(key)).then(function (j) {
        // WordPress has no feed (any more). Before the market has loaded that means the sample; under a live or
        // stale market it is a failed request.
        if (j && j.sample) {
          if (marketMode === '') { return sampleItemResult(key); }
          throw new Error('no feed');
        }
        if (j && j.missing) { return { mode: 'missing', item: null }; }
        var it = j && j.item;
        if (!it || typeof it !== 'object' || it.id !== key || !Array.isArray(it.history)) { throw new Error('not an item'); }
        itemGood[key] = it;
        return { mode: j.stale ? 'stale' : 'live', item: it };
      }).catch(function () {
        return itemGood[key] ? { mode: 'stale', item: itemGood[key] } : { mode: 'unreachable', item: null };
      });
    }
    itemAsked[key] = asked;
    return asked;
  }
  /* The last record this page has for an item, from any refresh, without asking: null when it has none yet. It lets
     a chart keep its line while item() is on its way after a refresh. */
  function cachedItem(id) {
    var key = String(id == null ? '' : id);
    return marketMode === 'sample' ? sampleItem(key) : (itemGood[key] || null);
  }

  /* ---------- the live market (HomeCraftMgmt 0.33) ----------
     Only in the feed while HomeCraftMgmt's live market runs (data.live is true), and in the sample.
     Without it these give null / [] and the pages look exactly like 2.1. */

  var TAGS = { hot: 'HOT', deal: 'DEAL', up: 'UP', down: 'DOWN', wanted: 'WANTED' };
  function tagOf(kind) {
    return typeof kind === 'string' && hasOwn(TAGS, kind) ? { kind: kind, label: TAGS[kind] } : null;
  }
  /* Times further ahead than these are a clock or unit slip upstream (micro- or nanoseconds), as in inc/feeds.php:
     a news row more than a day ahead is left out, a badge's end more than 60 days away counts as missing, and so
     does a season's more than a year away (the shipped seasons run up to three months). */
  var DAY_MS = 24 * 3600000, END_MS = 60 * DAY_MS, SEASON_MS = 366 * DAY_MS;

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

  /* The running season: { id, name, endsAt }, or null (none, it has ended, or its end is more than a year away). */
  function season(data) {
    var s = data && data.season, now = Date.now();
    if (!s || typeof s.name !== 'string' || !s.name || !isNum(s.endsAt) || s.endsAt <= now || s.endsAt > now + SEASON_MS) { return null; }
    return { id: typeof s.id === 'string' ? s.id : '', name: s.name, endsAt: s.endsAt };
  }

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

  /* Sample market: the trader design's twenty items, and one more for each department they leave out, in the real
     feed's shape, 96 half-hour snapshots each. Price, stock history and the 24h change agree with each other.
     marketSample() is the summary load('market') gives; sampleItem(id) is the record item(id) gives. */
  var MARKET_SRC = [
    // id, name, material, department, price, 24h change %, shelf %, maxStock, seed
    ['cobblestone', 'Cobblestone', 'COBBLESTONE', 'Blocks', 0.08, 2.4, 86, 50000, 1],
    ['stone', 'Stone', 'STONE', 'Blocks', 0.12, 1.2, 78, 50000, 2],
    ['dirt', 'Dirt', 'DIRT', 'Blocks', 0.04, -0.5, 92, 50000, 3],
    ['oak_log', 'Oak Log', 'OAK_LOG', 'Blocks', 0.35, -1.1, 64, 20000, 4],
    ['spruce_log', 'Spruce Log', 'SPRUCE_LOG', 'Blocks', 0.33, 0.6, 70, 20000, 5],
    ['wheat', 'Wheat', 'WHEAT', 'Materials', 0.22, -2.0, 71, 20000, 6],
    ['carrot', 'Carrot', 'CARROT', 'Food', 0.18, 3.1, 66, 20000, 7],
    ['coal', 'Coal', 'COAL', 'Materials', 0.62, 5.8, 48, 10000, 8],
    ['copper_ingot', 'Copper Ingot', 'COPPER_INGOT', 'Materials', 0.95, -3.2, 51, 10000, 9],
    ['iron_ingot', 'Iron Ingot', 'IRON_INGOT', 'Materials', 2.40, 0.9, 42, 10000, 10],
    ['gold_ingot', 'Gold Ingot', 'GOLD_INGOT', 'Materials', 6.15, -0.6, 23, 5000, 11],
    ['lapis_lazuli', 'Lapis Lazuli', 'LAPIS_LAZULI', 'Materials', 1.80, 4.1, 35, 5000, 12],
    ['redstone', 'Redstone Dust', 'REDSTONE', 'Redstone', 0.55, 1.7, 58, 10000, 13],
    ['emerald', 'Emerald', 'EMERALD', 'Materials', 18.40, 12.3, 12, 2000, 14],
    ['diamond', 'Diamond', 'DIAMOND', 'Materials', 96.00, 0, 0, 2000, 15],
    ['bone', 'Bone', 'BONE', 'Materials', 0.30, -1.4, 60, 10000, 16],
    ['string', 'String', 'STRING', 'Materials', 0.28, 2.2, 55, 10000, 17],
    ['gunpowder', 'Gunpowder', 'GUNPOWDER', 'Materials', 0.85, -4.6, 30, 5000, 18],
    ['quartz', 'Nether Quartz', 'QUARTZ', 'Materials', 0.75, 1.9, 44, 10000, 19],
    ['ender_pearl', 'Ender Pearl', 'ENDER_PEARL', 'Materials', 4.20, 6.5, 18, 2000, 20],
    ['iron_pickaxe', 'Iron Pickaxe', 'IRON_PICKAXE', 'Tools', 4.05, 1.9, 20, 8000, 21],
    ['bow', 'Bow', 'BOW', 'Combat', 0.40, -0.9, 50, 15000, 22],
    ['painting', 'Painting', 'PAINTING', 'Collectibles', 0.35, 0.3, 50, 15000, 23],
    ['shulker_shell', 'Shulker Shell', 'SHULKER_SHELL', 'Misc', 12.00, 0.8, 8, 500, 24]
  ];
  var sampleFeed = null, marketCache = null;
  /* The whole sample: every item with its history (and events), as HomeCraftMgmt would send it. */
  function sampleMarket() {
    if (sampleFeed) { return sampleFeed; }
    var N = 96, step = 30 * 60 * 1000, now = Date.now();
    sampleFeed = {
      title: 'LilahCraft market',
      generatedAt: now,
      refreshSeconds: 30,
      items: MARKET_SRC.map(function (s) {
        var price = s[4], ch = s[5], shelf = s[6] / 100, max = s[7], seed = s[8], out = s[6] === 0;
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
          id: s[0], name: s[1], material: s[2], department: s[3], price: price,
          buy: out ? null : round(price * 1.05, 4), sell: round(price * 0.95, 4),
          stock: out ? 0 : Math.round(max * shelf), maxStock: max,
          change24h: out ? 0 : round((price / history[N - 49].p - 1) * 100, 1), history: history
        };
      }),
      // The tabs, as HomeCraftMgmt 0.38.8 sends them after the items: the shipped eight.
      departments: DEPARTMENTS.slice()
    };
    addLiveSample(sampleFeed, now);
    return sampleFeed;
  }
  /* The spark and the index, worked out as inc/feeds.php works them out for a live feed (lilahcraft_market_spark(),
     lilahcraft_market_index()): the last 49 prices as 24, and the items in stock against their price 24 hours ago. */
  function sparkOf(prices) {
    var s = prices.slice(-49), n = s.length, out = s;
    if (n > 24) {
      out = [];
      for (var i = 0; i < 24; i++) {
        var a = Math.floor(i * n / 24), b = Math.floor((i + 1) * n / 24), sum = 0;
        for (var j = a; j < b; j++) { sum += s[j]; }
        out.push(sum / (b - a));
      }
      out[0] = s[0];
      out[23] = s[n - 1];
    }
    return out.map(function (p) { return round(p, 4); });
  }
  function indexOf(items) {
    var use = items.filter(function (it) { return !soldOut(it) && isNum(it.change24h) && it.history.length >= 2; })
      .map(function (it) { return it.history; });
    if (!use.length) { return []; }
    var L = 49, out = [];
    use.forEach(function (h) { L = Math.min(L, h.length); });
    for (var j = 0; j < L; j++) {
      var sum = 0;
      for (var k = 0; k < use.length; k++) {
        var h = use[k], base = h[h.length - L].p;
        sum += base > 0 ? h[h.length - L + j].p / base - 1 : 0;
      }
      out.push({ t: use[0][use[0].length - L + j].t, v: 1000 * (1 + sum / use.length) });
    }
    return out;
  }
  /* A sample item as the summary has it: no history or events, with its spark. */
  function summaryOf(it) {
    var out = {};
    Object.keys(it).forEach(function (k) { if (k !== 'history' && k !== 'events') { out[k] = it[k]; } });
    out.spark = sparkOf(it.history.map(function (h) { return h.p; }));
    return out;
  }
  function marketSample() {
    if (marketCache) { return marketCache; }
    var feed = sampleMarket();
    marketCache = {};
    // In the summary's order: the items, the tabs, then the index.
    Object.keys(feed).forEach(function (k) {
      marketCache[k] = k === 'items' ? feed.items.map(summaryOf) : feed[k];
      if (k === 'departments') { marketCache.index = indexOf(feed.items); }
    });
    return marketCache;
  }
  /* A sample item as ?item=<id> answers: the summary's record, then its history and events. null for any other id. */
  function sampleItem(id) {
    var it = sampleMarket().items.filter(function (x) { return x.id === id; })[0];
    if (!it) { return null; }
    var out = summaryOf(it);
    out.history = it.history;
    if (it.events) { out.events = it.events; }
    return out;
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
      var history = it.history;
      // The live fields sit after change24h and before the history, as in the feed.
      delete it.history;
      it.usual = round(it.price / (1 + s[0] / 100), 4);
      it.moodPct = s[0];
      if (s[1]) { it.status = s[1]; }
      if (s[2]) { it.statusEndsAt = now + s[2] * HOUR_MS; }
      it.history = history;
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

  /* ---------- minis ----------
     A Mini is { id, name, rarity, category, series, cap, printed, soldOut, skin? }. A holiday Mini (HomeCraftMgmt
     0.38.8) also has eventOnly: true (it is earned at its own event, never from a pack, a Card, the Printer or a
     drop; the key is only ever true) and, when the feed has its dates, earnFrom and earnTo: the first and the last
     millisecond it can be earned. Those days are the server's: format them in the server's time zone, not the
     visitor's. An older feed has none of the three. */

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
  /* A Mini's category as the feed writes it: upper case, "MISC" when it has none. */
  function miniCategory(m) {
    var c = m && typeof m.category === 'string' ? m.category.trim().toUpperCase() : '';
    return c || 'MISC';
  }
  /* The categories the feed's Minis are in, each once, in the order the catalogue first uses them (the server's own
     order): ['ANIMAL', 'BLOCK', 'FOOD', …]. The filter lists these and nothing else, so a category the server drops
     leaves the list and a new one joins it. */
  function miniCategories(data) {
    var seen = Object.create(null), out = [];
    (data && Array.isArray(data.minis) ? data.minis : []).forEach(function (m) {
      var c = miniCategory(m);
      if (m && !seen[c]) { seen[c] = true; out.push(c); }
    });
    return out;
  }
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
        return { id: s[0], name: s[1], rarity: s[2], category: 'BLOCK', series: '', cap: s[5], printed: s[4], soldOut: s[4] >= s[5], _art: s[3] || undefined };
      })
    };
    return minisCache;
  }

  /* ---------- the Arcade (HomeCraftMgmt 0.38.8, and 0.38.7 before it) ----------
     The feed is inc/feeds.php's lilahcraft_clean_arcade(): every section can be missing (games off, or the Arcade
     switched off), so read data.games || [] and so on. These helpers check what they use, like the market ones.
     0.38.8 added the reward rules, the Clubhouse and the holidays: rules(), clubhouseOpen() and holidays() say what
     the feed has, and null or [] when it is an older one. */

  /* The in-game Games screen's tabs, in its order. Droppers are courses; Falling Floors (kind arena) is on Together. */
  var COURSE_KINDS = ['parkour', 'elytra', 'boat', 'dropper'];
  var GROUPS = [
    { id: 'luck', label: 'Luck', kinds: ['chance'] },
    { id: 'cabinets', label: 'Cabinets', kinds: ['cabinet'] },
    { id: 'courses', label: 'Courses', kinds: COURSE_KINDS },
    { id: 'golf', label: 'Mini golf', kinds: ['golf'] },
    { id: 'together', label: 'Together', kinds: ['arena'] }
  ];
  var KIND_LABEL = {
    chance: 'Game of chance', cabinet: 'Arcade cabinet', parkour: 'Parkour', elytra: 'Elytra', boat: 'Boat', dropper: 'Dropper',
    golf: 'Mini golf', arena: 'Arena'
  };
  var TIERS = ['easy', 'medium', 'hard', 'extreme'];
  var TIER_LABEL = { easy: 'Easy', medium: 'Medium', hard: 'Hard', extreme: 'Why did we build this?' };
  var CABINET_UNITS = ['ms', 'points', 'flips', 'apples', 'wins'];
  var UNIT_WORD = { points: 'point', apples: 'apple', flips: 'flip', wins: 'win', strokes: 'stroke' };
  /* Falling Floors' floor this week, as the game words it. */
  var SHAPE_LABEL = { disc: 'disc', square: 'rounded square', ring: 'ring with an island', plus: 'plus', diamond: 'diamond' };
  /* The Ice Boat's two tracks, as the game names them. */
  var BOAT_TRACKS = ['Winding Road', 'Slalom'];

  function kindLabel(kind) { return typeof kind === 'string' && hasOwn(KIND_LABEL, kind) ? KIND_LABEL[kind] : ''; }
  function tierLabel(tier) { return typeof tier === 'string' && hasOwn(TIER_LABEL, tier) ? TIER_LABEL[tier] : ''; }
  function shapeLabel(shape) { return typeof shape === 'string' && hasOwn(SHAPE_LABEL, shape) ? SHAPE_LABEL[shape] : ''; }
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
  /* The games by tab: [{ id: 'luck'|'cabinets'|'courses'|'golf'|'together', label, games: […] }], only tabs with a game
     in them. Fresh Courses sit in courses and golf like any other course; freshSet() has them as a set. */
  function byGroup(data) {
    var list = games(data);
    return GROUPS.map(function (grp) {
      return { id: grp.id, label: grp.label, games: list.filter(function (g) { return grp.kinds.indexOf(g.kind) > -1; }) };
    }).filter(function (grp) { return grp.games.length > 0; });
  }
  /* The Scratch Ticket has no /hcm play id: it's bought from the Arcade's Luck row or the Games screen's Luck tab. */
  function playCommand(g) { return g && typeof g.id === 'string' && g.id !== 'scratch_ticket' ? '/hcm play ' + g.id : ''; }

  /* A game of chance that is closed right now: the Scratch Ticket while its prizes would give back 100 of every 100
     tokens or more. Its entry is { id, name, kind, closed: true } with no stakes, odds or pot: show its name and
     "Closed right now", and nothing else. */
  function closed(g) { return !!g && g.kind === 'chance' && g.closed === true; }
  /* A game of chance's give-back as the game words it, "about N of every 100 tokens": N is the feed's percent
     rounded DOWN (89.7 is 89), never up, and never 100. At `stake` when given (rtpByStake), else the headline
     (the lowest). null if unknown. */
  function giveBack(g, stake) {
    var p = !g ? null : (stake == null ? g.rtp : (g.rtpByStake && hasOwn(g.rtpByStake, String(stake)) ? g.rtpByStake[String(stake)] : null));
    return isNum(p) && p > 0 && p < 100 ? Math.floor(p) : null;
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
  /* The unit a game's board is scored in: a cabinet's own, 'strokes' for golf, 'ms' for a course and for Falling Floors;
     '' for a game with no board (a game of chance, a cabinet whose unit isn't known). */
  function boardUnit(g) {
    if (!g) { return ''; }
    if (g.kind === 'cabinet') { return CABINET_UNITS.indexOf(g.unit) > -1 ? g.unit : ''; }
    if (g.kind === 'golf') { return 'strokes'; }
    return g.kind === 'arena' || COURSE_KINDS.indexOf(g.kind) > -1 ? 'ms' : '';
  }
  /* Whether the lower score is the better one on a game's board: times and strokes, yes; Falling Floors' times, no
     (the longest survives); a cabinet says for itself. */
  function lowerIsBetter(g) {
    if (!g || g.kind === 'arena') { return false; }
    return g.kind === 'cabinet' ? g.lowerIsBetter === true : boardUnit(g) !== '';
  }
  /* A game's server record, the same for every kind, or null (none yet, a game of chance, or Falling Floors, which
     has a weekly board and no record):
     { value, unit: 'ms'|'points'|'flips'|'apples'|'wins'|'strokes', text: score(value, unit), lowerIsBetter,
       at: ms or null (cabinets have no date), holder: a name or null (only when the feed has names on) }.
     A Fresh course's record is its current set's. */
  function record(g) {
    if (!g) { return null; }
    var r = null;
    if (g.kind === 'cabinet' && isNum(g.best) && boardUnit(g)) {
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
  /* A game's leaderboard, best first as the feed sends it (five rows as shipped, ties sharing a rank: 1, 1, 3):
     [{ rank, value, unit, text: score(value, unit), at: ms or null, holder: a name or null }]; [] when it has none.
     A Fresh course's board is its current set's, so it starts empty with each new set; Falling Floors' is this
     week's longest solo times. Scores and dates only, unless the feed has names on. */
  function top(g) {
    var unit = boardUnit(g);
    if (!unit || !Array.isArray(g.top)) { return []; }
    return g.top.filter(function (r) {
      return !!r && isNum(r.rank) && r.rank >= 1 && isNum(r.value) && r.unit === unit;
    }).map(function (r) {
      return {
        rank: r.rank, value: r.value, unit: unit, text: score(r.value, unit), at: isNum(r.at) && r.at > 0 ? r.at : null,
        holder: typeof r.holder === 'string' && r.holder !== '' ? r.holder : null
      };
    });
  }

  /* Fresh Courses: the courses and golf courses the server builds by itself, a new set each week. Their entries
     carry `daily` (the set), `fresh` (this course) or `classic` (an old course recalled into a Classics slot). */
  function isFresh(g) {
    return !!g && (g.kind === 'golf' || COURSE_KINDS.indexOf(g.kind) > -1) && !!g.daily && typeof g.daily.day === 'string' && g.daily.day !== '';
  }
  /* A Fresh course's own facts, or null for any other entry:
     { day: '2026-11-09' the set's first day, lastDay: '2026-11-15' or null, cadence: the set's length in days or null
       (7 weekly, 1 daily), nextAt: when the next set goes up (ms) or null (not known, a recalled Classic, or already
       past in an old copy), code: the course code players read off its tile ('HARD-40') or null,
       classic: true for a Classics slot, from, to: when this course went up and when it goes (ms or null),
       track: 'Winding Road' or 'Slalom' on the Ice Boat (a boat course) when the feed says which of its two tracks
       this set is (HomeCraftMgmt 0.38.8), else null,
       stars: [{ stars: 3, ms, text: '0:24.0' }, { stars: 2, ms, text: '0:35.0' }] the times to beat for three and
       two stars, those the feed has ([] for golf, whose stars go by strokes against par) }.
     Finishing is always one star. On a Hard Dropper the third star also needs a run with no bonks. */
  function fresh(g) {
    if (!isFresh(g)) { return null; }
    var d = g.daily, part = g.classic && typeof g.classic.code === 'string' ? g.classic : (g.fresh || {}), now = Date.now();
    var stars = [];
    if (g.kind !== 'golf') {
      [[3, d.goldMs], [2, d.silverMs]].forEach(function (s) {
        if (isNum(s[1]) && s[1] > 0) { stars.push({ stars: s[0], ms: s[1], text: time(s[1]) }); }
      });
    }
    return {
      day: d.day, lastDay: typeof d.lastDay === 'string' && d.lastDay ? d.lastDay : null,
      cadence: isNum(d.cadence) && d.cadence > 0 ? d.cadence : null,
      nextAt: isNum(d.nextAt) && d.nextAt > now ? d.nextAt : null,
      code: typeof part.code === 'string' && part.code ? part.code : null, classic: part === g.classic,
      from: isNum(part.from) && part.from > 0 ? part.from : null, to: isNum(part.to) && part.to > 0 ? part.to : null,
      track: g.kind === 'boat' && part !== g.classic && BOAT_TRACKS.indexOf(part.track) > -1 ? part.track : null,
      stars: stars
    };
  }
  /* The set of Fresh Courses that is up, or null when none is open:
     { label: "This week's courses" | "Today's courses" | "The current courses" (as every screen in game says it),
       day, lastDay, cadence, nextAt: as fresh(), from the set (nextAt the soonest any course gives),
       games: [the set's entries, in the feed's order], classics: [entries recalled into a Classics slot] }. */
  function freshSet(data) {
    var all = games(data).filter(isFresh);
    var set = all.filter(function (g) { return !fresh(g).classic; });
    if (!all.length) { return null; }
    var first = fresh(set[0] || all[0]), next = null;
    set.forEach(function (g) { var n = fresh(g).nextAt; if (n !== null && (next === null || n < next)) { next = n; } });
    return {
      label: first.cadence === 7 ? 'This week’s courses' : (first.cadence === 1 ? 'Today’s courses' : 'The current courses'),
      day: first.day, lastDay: first.lastDay, cadence: first.cadence, nextAt: next,
      games: set, classics: all.filter(function (g) { return fresh(g).classic; })
    };
  }
  /* This week's Weekly Cup on a course: { entry: tokens to enter, pool: tokens in the pool now, entrants: how many
     are in, endsAt: when it pays out (ms) }, or null (no Cup on it, or an old copy whose Cup has ended). Golf never
     has one. In game: "Cup pool: 40 tokens · 2 in". */
  function cup(g) {
    var c = g && COURSE_KINDS.indexOf(g.kind) > -1 ? g.cup : null;
    if (!c || !isNum(c.entry) || c.entry < 1 || !isNum(c.pool) || !isNum(c.entrants) || !isNum(c.endsAt) || c.endsAt <= Date.now()) { return null; }
    return { entry: c.entry, pool: c.pool, entrants: c.entrants, endsAt: c.endsAt };
  }
  /* The Star Chart: { week: '2026-11-09' the Fresh Courses week's first day, best: the most stars anyone has that
     week or null (nobody has stars yet), holder: a name or null (only when the feed has names on) }, or null when
     the feed has none or no Fresh course is open. */
  function starChart(data) {
    var c = data && data.starChart;
    if (!c || typeof c.week !== 'string' || !c.week || !freshSet(data)) { return null; }
    var best = isNum(c.best) && c.best >= 0 ? c.best : null;
    return { week: c.week, best: best, holder: best !== null && typeof c.holder === 'string' && c.holder !== '' ? c.holder : null };
  }

  /* An admin can pin a whole world game as today's pick: "trials" (every parkour, elytra, boat and dropper course) or "golf". */
  var WHOLE_PICKS = {
    trials: { name: 'All time-trial courses', kinds: COURSE_KINDS },
    golf: { name: 'All mini golf courses', kinds: ['golf'] }
  };
  /* Today's pick: { game, games: [every entry that is the pick], until: ms (the next midnight) }, or null (none, a game
     that isn't open, a game of chance, or an old copy whose day is over). It can be a cabinet, a course (a Dropper
     too), a golf course or Falling Floors. For a whole world game, game is a stand-in
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
     pot is never shown on its own; a closed game has neither. */
  function jackpot(data, id) {
    var want = id || 'scratch_ticket';
    var j = (data && Array.isArray(data.jackpots) ? data.jackpots : []).filter(function (p) { return p && p.game === want; })[0];
    var g = j && isNum(j.tokens) ? game(data, want) : null;
    return g && g.kind === 'chance' && !closed(g) && (g.paytable || []).some(function (r) { return odds(r) !== ''; }) ? { game: g, tokens: j.tokens } : null;
  }

  /* The Prize Counter's tabs, in the game's order and with the game's labels (the feed's `cosmetics` tab reads
     "Fireworks & Trails" in game). */
  var PRIZE_CATEGORIES = [
    { id: 'boosts', label: 'Boosts' }, { id: 'hunt', label: 'Hunt Gear' }, { id: 'cosmetics', label: 'Fireworks & Trails' },
    { id: 'looks', label: 'Looks' }, { id: 'perks', label: 'Perks' }, { id: 'trophies', label: 'Trophies' },
    { id: 'minis', label: 'Minis' }, { id: 'keepers', label: 'Keepers' }
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

  /* The reward rules (HomeCraftMgmt 0.38.8): the token amounts and caps the games pay by, written by the server from
     its own settings, so a page can print the server's numbers. null when the feed has none (0.38.7, or the games
     are off): the page then prints the shipped numbers. Otherwise a fresh object with these keys, each only when
     the feed has a good one:
       skillDailyCap     the most every skill game together pays a player a day
       chanceDailyLimit  the most a player can put into every game of chance together a day
       featuredBonus     tokens for the first finish of today's pick
       cabinets          { id: { milestone?, daily?, dailyCap? } } for cabinets that are in games: tokens for each
                         medal (once ever), for the daily challenge, and the most that cabinet pays a day. They
                         don't all pay alike (Connect Four and Tic-Tac-Toe have no medals). Read it with
                         cabinets[g.id]: it has no other keys, so an id it doesn't have is undefined
       trials            { firstFinish?: { easy?, medium?, hard?, extreme? }, dailyCap? }: a hand-built course's
                         first finish by tier (LCData.arcade.TIERS), and the most time trials pay a day
       golf              { firstFinish?, parOrBetter?, holeInOne?, dailyCap? }
       cup               { entry }: tokens to enter one course's Weekly Cup
       freshSet          { everyDays: 7, at: 'Mon 04:00', zone: 'America/Chicago' }: a new set of Fresh Courses
                         every so many days, at that weekday and 24-hour time ('04:00' alone when the sets don't
                         change on one weekday) in that time zone. All three or none
       restarts          ['04:00', '16:00']: the daily restarts, 24-hour times in that zone, sorted
     Every number is a whole number of tokens, 1 or more. The server leaves out what is switched off, so with rules
     in hand a missing number means "not on this server", not "use the shipped number". */
  var RULE_MAX = 100000;
  var CLOCK_RE = /^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/;
  var SET_AT_RE = /^(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) )?(?:[01][0-9]|2[0-3]):[0-5][0-9]$/;
  var ZONE_RE = /^[A-Za-z][A-Za-z0-9_+\-]*(?:\/[A-Za-z0-9_+\-]+){0,2}$/;
  function isObject(o) { return !!o && typeof o === 'object' && !Array.isArray(o); }
  function wholeIn(n, min, max) { return isNum(n) && Math.floor(n) === n && n >= min && n <= max; }
  /* The whole token amounts (1 or more) a part has under `keys`, in that order; null when it has none. */
  function tokenRules(part, keys) {
    var out = {}, any = false;
    keys.forEach(function (k) {
      if (isObject(part) && hasOwn(part, k) && wholeIn(part[k], 1, RULE_MAX)) { out[k] = part[k]; any = true; }
    });
    return any ? out : null;
  }
  function rules(data) {
    var r = data && data.rules;
    if (!isObject(r)) { return null; }
    var out = tokenRules(r, ['skillDailyCap', 'chanceDailyLimit', 'featuredBonus']) || {};
    var cabinets = Object.create(null), any = false;
    if (isObject(r.cabinets)) {
      games(data).forEach(function (g) {
        var part = g.kind === 'cabinet' && hasOwn(r.cabinets, g.id) ? tokenRules(r.cabinets[g.id], ['milestone', 'daily', 'dailyCap']) : null;
        if (part) { cabinets[g.id] = part; any = true; }
      });
    }
    if (any) { out.cabinets = cabinets; }
    var first = tokenRules(isObject(r.trials) ? r.trials.firstFinish : null, TIERS), cap = tokenRules(r.trials, ['dailyCap']);
    if (first || cap) {
      out.trials = {};
      if (first) { out.trials.firstFinish = first; }
      if (cap) { out.trials.dailyCap = cap.dailyCap; }
    }
    var golf = tokenRules(r.golf, ['firstFinish', 'parOrBetter', 'holeInOne', 'dailyCap']);
    if (golf) { out.golf = golf; }
    var entry = tokenRules(r.cup, ['entry']);
    if (entry) { out.cup = entry; }
    var s = r.freshSet;
    if (isObject(s) && wholeIn(s.everyDays, 1, 366) && typeof s.at === 'string' && SET_AT_RE.test(s.at) &&
      typeof s.zone === 'string' && s.zone.length <= 40 && ZONE_RE.test(s.zone)) {
      out.freshSet = { everyDays: s.everyDays, at: s.at, zone: s.zone };
    }
    var restarts = (Array.isArray(r.restarts) ? r.restarts : []).filter(function (t, i, all) {
      return typeof t === 'string' && CLOCK_RE.test(t) && all.indexOf(t) === i;
    }).sort();
    if (restarts.length) { out.restarts = restarts; }
    return Object.keys(out).length ? out : null;
  }
  /* Whether the Clubhouse takes visitors:
       true   the feed says so (clubhouse.open)
       false  the feed has rules, so it is HomeCraftMgmt 0.38.8 or later with the games on, and it has no open
              Clubhouse: the room isn't built, is switched off or is closed
       null   the feed doesn't say: an older HomeCraftMgmt (0.38.7), or the games are off
     So a page shows its Clubhouse section on true, hides it on false, and on null goes by whether the feed has games. */
  function clubhouseOpen(data) {
    if (data && isObject(data.clubhouse) && data.clubhouse.open === true) { return true; }
    return rules(data) ? false : null;
  }
  /* The holidays on the server's calendar that are running or still to come, soonest first:
     [{ id: 'thanksgiving_2026', name: 'Thanksgiving', from, to, running }]; [] when the feed has none (an older
     HomeCraftMgmt, the holiday shows off, or none near: the server lists a holiday from 14 days before it starts).
     from and to are the first millisecond of its first day and the last of its last, on the server's clock: format
     them in the server's time zone (rules(data).freshSet.zone when the feed has it), not the visitor's. running is
     true once it has begun. One that is over (an old copy of the feed) is left out. `now` defaults to Date.now(). */
  function holidays(data, now) {
    var n = isNum(now) ? now : Date.now(), seen = Object.create(null);
    return (data && Array.isArray(data.holidays) ? data.holidays : []).filter(function (h) {
      var ok = isObject(h) && typeof h.id === 'string' && h.id !== '' && !seen[h.id] && typeof h.name === 'string' && h.name.trim() !== '' &&
        isNum(h.from) && h.from > 0 && h.from <= n + SEASON_MS && isNum(h.to) && h.to >= h.from && h.to >= n;
      if (ok) { seen[h.id] = true; }
      return ok;
    }).map(function (h) {
      return { id: h.id, name: h.name, from: h.from, to: h.to, running: h.from <= n };
    }).sort(function (a, b) { return a.from - b.from; });
  }

  /* Sample Arcade, in the real feed's shape, with the numbers HomeCraftMgmt 0.38.8 ships (its games guide): every
     game of chance that ships on (Coin Flip ships off) with its stakes, give-backs, daily limits and what it pays;
     the eight cabinets; four of the weekly Fresh Courses (a parkour course, Sky Rings, the Dropper, Golf of the Week)
     with this week's set, star times, course codes, the Weekly Cup and a board; the Star Chart; a few prizes
     (a Looks row and a Keepers row among them), the Starter Pack and two achievements; the shipped reward rules, an
     open Clubhouse, and the shipped calendar's holidays that are near today. No names: a sample record has no holder. */
  /* The holidays HomeCraftMgmt ships (arcade.holiday_shows): id, name, first month and day, last month and day. */
  var HOLIDAYS_SRC = [
    ['halloween', 'Halloween', 10, 24, 10, 31], ['christmas', 'Christmas', 12, 18, 12, 26], ['new_year', 'New Year', 12, 31, 1, 1],
    ['valentines', 'Valentine\'s', 2, 10, 2, 14], ['st_patricks', 'St Patrick\'s', 3, 14, 3, 17],
    ['independence_day', 'Independence Day', 7, 1, 7, 5], ['thanksgiving', 'Thanksgiving', 11, 22, 11, 30]
  ];
  /* The sample's clock. The server's own times in the feed (a holiday's first and last millisecond, the Monday
     4:00 AM a Fresh set goes up, the midnight today's pick ends) are wall-clock times in the server's time zone,
     and a page prints them in that zone (rules.freshSet.zone), not the visitor's. So the sample's are wall-clock
     times in the zone its own rules name: they read as the same days and hours wherever the visitor is. A browser
     whose Intl has no time zones gets them on the visitor's own clock, which is all its page can print. */
  var SAMPLE_ZONE = 'America/Chicago';
  var zoneFormat;
  /* What the clocks in SAMPLE_ZONE read at `ms`, written as if that reading were UTC (ms, to the second), or null
     without Intl time zones. */
  function zoneWall(ms) {
    if (zoneFormat === undefined) {
      try {
        zoneFormat = new Intl.DateTimeFormat('en-US', {
          timeZone: SAMPLE_ZONE, hour12: false, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric'
        });
        // Chicago is six hours behind UTC in January: a browser that reads anything else has no real time zones.
        if (zoneWall(Date.UTC(2026, 0, 15, 12)) !== Date.UTC(2026, 0, 15, 6)) { zoneFormat = null; }
      } catch (e) { zoneFormat = null; }
    }
    if (!zoneFormat) { return null; }
    var p = {};
    zoneFormat.formatToParts(ms).forEach(function (part) { p[part.type] = parseInt(part.value, 10); });
    return Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second);
  }
  /* The sample's day at `ms`: [year, month (1 to 12), day, weekday (0 Sunday)] on SAMPLE_ZONE's calendar. */
  function sampleDay(ms) {
    var wall = zoneWall(ms), d = new Date(wall === null ? ms : wall);
    return wall === null ? [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getDay()] :
      [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCDay()];
  }
  /* The moment (ms) the clocks in SAMPLE_ZONE read `hour`:00 on that day. The day may run over the month's ends
     (day 0, day 35). Twice through the zone's offset, so a day the clocks change comes out right. */
  function sampleAt(year, month, day, hour) {
    var wall = Date.UTC(year, month - 1, day, hour), near = zoneWall(wall);
    if (near === null) { return new Date(year, month - 1, day, hour).getTime(); }
    var guess = wall - (near - wall);
    return wall - (zoneWall(guess) - guess);
  }
  /* The sample's holidays, picked as the server picks them: the windows running today or starting within 14 days,
     soonest first, each dated for this time round (the id carries the year it starts in; a window over New Year
     ends the year after). Today and the windows' days are the sample's clock's, as the server's are its own:
     from is the first millisecond of the first day there and to the last of the last. Most days of the year there
     is none. */
  function sampleHolidays(now) {
    var t = sampleDay(now), out = [];
    // Calendar days compared as plain dates (UTC stands in for "no time zone").
    var today = Date.UTC(t[0], t[1] - 1, t[2]), ahead = Date.UTC(t[0], t[1] - 1, t[2] + 14);
    HOLIDAYS_SRC.forEach(function (h) {
      var wraps = h[4] < h[2] || (h[4] === h[2] && h[5] < h[3]);
      for (var year = t[0] - 1; year <= t[0] + 1; year++) {
        var endYear = year + (wraps ? 1 : 0);
        if (today <= Date.UTC(endYear, h[4] - 1, h[5]) && Date.UTC(year, h[2] - 1, h[3]) <= ahead) {
          out.push({ id: h[0] + '_' + year, name: h[1], from: sampleAt(year, h[2], h[3], 0), to: sampleAt(endYear, h[4], h[5] + 1, 0) - 1 });
        }
      }
    });
    return out.sort(function (a, b) { return a.from - b.from; });
  }
  var arcadeCache = null;
  function arcadeSample() {
    if (arcadeCache) { return arcadeCache; }
    var now = Date.now(), today = sampleDay(now);
    // The pot starts at 50 and grows by 1 a ticket; won 1 time in 100, it sits around 150 (the 89.5 assumes that).
    var pot = 150;
    var ticket = [[3, 0.4, 3], [10, 0.22, 5], [25, 0.09, 11], [60, 0.03, 33]].map(function (r) {
      return { stake: 10, combo: r[0] + ' tokens', pays: r[0], chance: r[1], oneIn: r[2] };
    }).concat([{ stake: 10, combo: 'the jackpot', pays: pot, chance: 0.01, oneIn: 100 }]);
    // Ore Slots pays multiples of the tokens in. The lines read as the feed names them, with the shipped reels' odds.
    var slots = [['3 wild', 50, 0.0000781, 12805], ['3 diamond', 40, 0.0005467, 1829], ['3 gold', 20, 0.002031, 492],
      ['3 iron', 10, 0.00492, 203], ['3 copper', 6, 0.009684, 103], ['3 coal', 4, 0.01679, 60], ['two the same', 2, 0.3294, 3]];
    var wheel = [];
    [[5, 22, 17, 8], [10, 44, 35, 17], [20, 87, 70, 35]].forEach(function (w) {
      var s = w[0];
      wheel.push({ stake: s, combo: w[1] + ' tokens', pays: w[1], spaces: 1, of: 24 }, { stake: s, combo: w[2] + ' tokens', pays: w[2], spaces: 2, of: 24 },
        { stake: s, combo: w[3] + ' tokens', pays: w[3], spaces: 3, of: 24 }, { stake: s, combo: 'your ' + s + ' back', pays: s, spaces: 5, of: 24 },
        { stake: s, combo: 'nothing', pays: 0, spaces: 13, of: 24 });
    });
    // This week's set went up on Monday at 4:00 AM and the next one follows a week later, on the sample's clock
    // (its rules say "Mon 04:00" in SAMPLE_ZONE). `monday` is that Monday as a day of today's month (it may be 0 or less).
    var monday = today[2] - (today[3] + 6) % 7;
    if (sampleAt(today[0], today[1], monday, 4) > now) { monday -= 7; }
    var from = sampleAt(today[0], today[1], monday, 4), to = sampleAt(today[0], today[1], monday + 7, 4);
    // A day of today's month as the feed writes a date ('2026-11-09'), running over the month's ends like sampleAt().
    function ymd(day) {
      var d = new Date(Date.UTC(today[0], today[1] - 1, day));
      return d.getUTCFullYear() + '-' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + d.getUTCDate()).slice(-2);
    }
    // A board's rows, best first, set at these hours ago (never before the set went up); equal scores share a rank.
    function board(unit, rows) {
      return rows.map(function (r, i) {
        var rank = i + 1;
        while (rank > 1 && rows[rank - 2][0] === r[0]) { rank--; }
        return { rank: rank, value: r[0], unit: unit, at: Math.max(from, now - r[1] * HOUR_MS) };
      });
    }
    function cabinet(id, name, boardName, unit, rows) {
      var g = { id: id, name: name, kind: 'cabinet', board: boardName, unit: unit, lowerIsBetter: unit === 'ms' || unit === 'flips' };
      if (rows) {
        g.best = rows[0][0];
        g.top = board(unit, rows);
      }
      return g;
    }
    // A Fresh entry: its record and board are this set's. A Cup runs on the time trials, never on golf: every entry
    // is 10 tokens, and the server adds 20 once two are in.
    function course(id, name, kind, tier, code, gold, silver, rows, cupIn) {
      var g = { id: id, name: name, kind: kind }, unit = kind === 'golf' ? 'strokes' : 'ms';
      if (kind === 'golf') { g.holes = 9; g.par = 30; } else { g.tier = tier; }
      if (rows) {
        var set = Math.max(from, now - rows[0][1] * HOUR_MS);
        g.record = kind === 'golf' ? { strokes: rows[0][0], at: set } : { ms: rows[0][0], at: set };
      }
      g.daily = { day: ymd(monday), nextAt: to };
      if (gold) { g.daily.goldMs = gold; g.daily.silverMs = silver; }
      g.daily.cadence = 7;
      g.daily.lastDay = ymd(monday + 6);
      g.fresh = { code: code, from: from, to: to, cadenceDays: 7 };
      if (cupIn !== null) { g.cup = { entry: 10, pool: 10 * cupIn + (cupIn > 1 ? 20 : 0), entrants: cupIn, endsAt: to }; }
      if (rows) { g.top = board(unit, rows); }
      return g;
    }
    function cabinetPays(medals) { return medals ? { milestone: 5, daily: 5, dailyCap: 15 } : { daily: 5, dailyCap: 5 }; }
    arcadeCache = {
      generatedAt: now,
      games: [
        { id: 'scratch_ticket', name: 'Scratch Ticket', kind: 'chance', stakes: [10], rtp: 89.5, rtpByStake: { 10: 89.5 }, paytable: ticket },
        { id: 'ore_slots', name: 'Ore Slots', kind: 'chance', stakes: [1, 2, 5], rtp: 89.9, rtpByStake: { 1: 89.9, 2: 89.9, 5: 89.9 }, dailyLimit: 50,
          paytable: slots.map(function (r) { return { combo: r[0], pays: r[1], chance: r[2], oneIn: r[3] }; }),
          rules: 'Three reels, one line. Three the same pays that ore\'s line (a Wild stands in for any ore), two the same pays a little, and Stone never pays.' },
        { id: 'twenty_one', name: 'Twenty-One', kind: 'chance', stakes: [5, 10, 20], rtp: 89.7, rtpByStake: { 5: 89.7, 10: 89.7, 20: 89.7 }, dailyLimit: 30,
          rules: 'Beat the Arcade\'s hand without going over 21. The Arcade draws to 17 and stops on any 17; it checks for Twenty-One when it shows an Ace or a ten. Double on your first two cards. No split.',
          payouts: { 5: { win: 9, twentyOne: 11, doubleWin: 18 }, 10: { win: 18, twentyOne: 22, doubleWin: 36 }, 20: { win: 36, twentyOne: 44, doubleWin: 72 } } },
        { id: 'wheel', name: 'The Wheel', kind: 'chance', stakes: [5, 10, 20], rtp: 87.5, rtpByStake: { 5: 87.5, 10: 89.5, 20: 90 }, dailyLimit: 30, paytable: wheel },
        { id: 'higher_lower', name: 'Higher or Lower', kind: 'chance', stakes: [10, 20, 50], rtp: 89.6, rtpByStake: { 10: 89.6, 20: 90, 50: 89.7 }, dailyLimit: 30,
          rules: 'Guess whether the next card is higher or lower (Aces high; the same card loses). Each right guess grows the pot; cash out any time after one.',
          maxMultiplier: 20, maxGuesses: 10 },
        cabinet('creeper_sweeper', 'Creeper Sweeper', 'normal', 'ms', [[18400, 30], [21750, 52], [21750, 9], [26300, 70]]),
        cabinet('ore_merge', 'Ore Merge', 'classic', 'points'),
        cabinet('snake', 'Snake', 'classic', 'apples', [[34, 20], [29, 44], [12, 3]]),
        cabinet('mini_match', 'Mini Match', 'classic', 'flips'),
        cabinet('simon_says', 'Simon Says', 'classic', 'points', [[14, 26]]),
        cabinet('whack_a_zombie', 'Whack-a-Zombie', 'classic', 'points'),
        cabinet('connect_four', 'Connect Four', 'hard', 'wins'),
        cabinet('tic_tac_toe', 'Tic-Tac-Toe', 'wins', 'wins'),
        course('fresh_parkour_easy', 'Easy Parkour', 'parkour', 'easy', 'EASY-12', 45000, 70000, [[41200, 28], [44900, 6], [52300, 47], [61800, 15], [75400, 2]], 2),
        course('fresh_rings', 'Sky Rings', 'elytra', 'easy', 'RINGS-12', 82000, 117000, null, 0),
        course('fresh_dropper', 'Dropper', 'dropper', 'hard', 'DROP-12', 24000, 35000, [[23450, 5], [31900, 22], [38740, 40]], 4),
        course('fresh_golf', 'Golf of the Week', 'golf', '', 'GOLF-12', 0, 0, [[28, 8], [30, 31], [30, 12], [33, 50]], null)
      ],
      // Today's pick lasts until the next midnight on the sample's clock, as the server's does on its own.
      featured: { game: 'fresh_dropper', until: sampleAt(today[0], today[1], today[2] + 1, 0) },
      starChart: { week: ymd(monday), best: 14 },
      jackpots: [{ game: 'scratch_ticket', tokens: pot }],
      prizes: [
        { id: 'night_vision', name: 'Night Vision', category: 'boosts', cost: 6, description: 'See in the dark for 20 minutes.' },
        { id: 'hat_creeper', name: 'Creeper Hat', category: 'looks', cost: 120, description: 'Wear it on your head! Yours for 90 days.' },
        { id: 'ball_pink', name: 'Pink Golf Ball', category: 'looks', cost: 40, description: 'Play golf with a pink ball!' },
        { id: 'home_slot', name: '+1 Home', category: 'perks', cost: 400, description: 'One more /home, on top of the homes you already have.' },
        { id: 'hat_command', name: '/hat', category: 'perks', cost: 300, description: 'Wear the block in your hand on your head with /hat.' },
        { id: 'keeper_legend_crown', name: 'Legend Crown', category: 'keepers', cost: 5000, description: 'The rarest look of all. Comes with its own Royal Trail.' }
      ],
      packs: [{ id: 'starter', name: 'Starter Pack', cost: 50, odds: { COMMON: 62, UNCOMMON: 28, RARE: 9, EPIC: 1 } }],
      achievements: [
        { id: 'first_sale', name: 'Sell something to Crate', description: 'Sell something to Crate', tokens: 10 },
        { id: 'first_crate', name: 'Open an Arcade Crate', description: 'Open an Arcade Crate', tokens: 5 }
      ],
      // What the games pay, as HomeCraftMgmt 0.38.8 writes it from the shipped settings. The six solo cabinets pay
      // alike; Connect Four and Tic-Tac-Toe have no medals.
      rules: {
        skillDailyCap: 60, chanceDailyLimit: 100, featuredBonus: 5,
        cabinets: {
          creeper_sweeper: cabinetPays(true), ore_merge: cabinetPays(true), snake: cabinetPays(true), mini_match: cabinetPays(true),
          simon_says: cabinetPays(true), whack_a_zombie: cabinetPays(true), connect_four: cabinetPays(false), tic_tac_toe: cabinetPays(false)
        },
        trials: { firstFinish: { easy: 10, medium: 15, hard: 25, extreme: 50 }, dailyCap: 40 },
        golf: { firstFinish: 15, parOrBetter: 5, holeInOne: 3, dailyCap: 50 },
        cup: { entry: 10 },
        freshSet: { everyDays: 7, at: 'Mon 04:00', zone: SAMPLE_ZONE },
        restarts: ['04:00', '16:00']
      },
      clubhouse: { open: true }
    };
    // A section with nothing in it is left out, as in the feed.
    var near = sampleHolidays(now);
    if (near.length) { arcadeCache.holidays = near; }
    return arcadeCache;
  }

  window.LCData = {
    SAMPLE_LABEL: 'Sample data',
    esc: esc, isNum: isNum, money: money, count: count, timeText: timeText, timeLeft: timeLeft, ago: ago, agoWords: agoWords,
    load: load, watch: watch, sparkPoints: sparkPoints,
    market: {
      DEPARTMENTS: DEPARTMENTS, departmentOf: departmentOf, departments: departments,
      stockFraction: stockFraction, soldOut: soldOut, symbols: symbols, change: change,
      spark: spark, priceSeries: priceSeries, index: index, item: item, cachedItem: cachedItem,
      badge: badge, news: news, season: season, sample: marketSample
    },
    minis: {
      RARITY_ORDER: RARITY_ORDER, RARITIES: RARITIES, rarityKey: rarityKey,
      categories: miniCategories, categoryOf: miniCategory, categoryLabel: miniCategoryLabel,
      soldOut: miniSoldOut, printedText: printedText, printedFraction: printedFraction,
      head: head, sample: minisSample
    },
    arcade: {
      GROUPS: GROUPS, TIERS: TIERS, PRIZE_CATEGORIES: PRIZE_CATEGORIES, kindLabel: kindLabel, tierLabel: tierLabel, shapeLabel: shapeLabel,
      groupOf: groupOf, games: games, game: game, byGroup: byGroup, playCommand: playCommand,
      closed: closed, giveBack: giveBack, odds: odds, paytable: paytable,
      time: time, score: score, lowerIsBetter: lowerIsBetter, record: record, top: top,
      isFresh: isFresh, fresh: fresh, freshSet: freshSet, cup: cup, starChart: starChart,
      featured: featured, jackpot: jackpot, prizeGroups: prizeGroups, packOdds: packOdds,
      rules: rules, clubhouseOpen: clubhouseOpen, holidays: holidays,
      sample: arcadeSample
    }
  };
})();
