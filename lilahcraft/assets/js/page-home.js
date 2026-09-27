/* LilahCraft home: the hero's market board (with its headlines) and the four Minis, both from window.LCData.
   Board: Cobblestone, Oak Log, Iron Ingot, Gold Ingot, Emerald and Diamond when the feed has them,
   any empty slots filled with the biggest movers; refreshed on the feed's refreshSeconds.
   Headlines: up to three short sentences worked out from the whole feed, always true of the prices shown
   (sold out, biggest gain, biggest drop, lowest shelf), picked the same way every time.
   Minis: the design's four when showing sample data, otherwise four picked the same way every load
   (a spread of rarities, rarest first), each with "Only N left" when nearly gone, or "Sold out".
   Sample data is always labelled. */
(function () {
  'use strict';
  var D = window.LCData;
  if (!D) { return; }

  var CANT_REACH = ' · the live feed can’t be reached right now';

  /* A name that is only a placeholder, like "[Rare Mini]", never shows. */
  function usable(x) {
    return !!x && typeof x === 'object' && typeof x.name === 'string' && x.name.trim() !== '' && !/^\s*\[.*\]\s*$/.test(x.name);
  }
  function setStatus(el, text) {
    if (!el) { return; }
    el.textContent = text;
    el.hidden = !text;
  }

  /* ---------- market board ---------- */

  var BOARD_IDS = ['cobblestone', 'oak_log', 'iron_ingot', 'gold_ingot', 'emerald', 'diamond'];
  var BOARD_ROWS = 6;
  var board = document.querySelector('[data-lc-home-board]');
  var boardRows = board && board.querySelector('[data-lc-home-board-rows]');
  var boardStatus = board && board.querySelector('[data-lc-home-board-status]');
  var newsBox = board && board.querySelector('[data-lc-home-headlines]');
  var newsList = newsBox && newsBox.querySelector('[data-lc-home-headlines-list]');

  /* Each feed item once, by id, in feed order. */
  function uniqueItems(items) {
    var seen = {}, out = [];
    (Array.isArray(items) ? items : []).filter(usable).forEach(function (it) {
      var id = String(it.id);
      if (!seen[id]) { seen[id] = true; out.push(it); }
    });
    return out;
  }

  function pickBoard(list) {
    var byId = {}, used = {}, out = [];
    list.forEach(function (it) { byId[String(it.id)] = it; });
    BOARD_IDS.forEach(function (id) {
      if (byId[id] && out.length < BOARD_ROWS) { out.push(byId[id]); used[id] = true; }
    });
    if (out.length < BOARD_ROWS) {
      var movers = list.map(function (it, i) { return { it: it, i: i }; })
        .filter(function (x) { return !used[String(x.it.id)]; })
        .sort(function (a, b) {
          var ma = D.isNum(a.it.change24h) ? Math.abs(a.it.change24h) : -1;
          var mb = D.isNum(b.it.change24h) ? Math.abs(b.it.change24h) : -1;
          return mb - ma || a.i - b.i;
        });
      for (var k = 0; k < movers.length && out.length < BOARD_ROWS; k++) {
        out.push(movers[k].it);
      }
    }
    return out;
  }

  var NO_CHANGE = '<span aria-hidden="true">—</span><span class="lc-sr">not available</span>';
  var SOLD_OUT = '<span class="lc-pill lc-pill--dark lc-home-bd-out">Sold out</span>';

  function trendWord(series) {
    var first = series[0], last = series[series.length - 1];
    var rel = first ? (last - first) / Math.abs(first) : last - first;
    if (Math.abs(rel) < 0.005) { return 'steady'; }
    return rel > 0 ? 'rising' : 'falling';
  }

  /* The design draws 24 points in 80 px. A longer history is split into 24 buckets and each bucket
     averaged (picking every 4th point zigzags on the half-hourly ripple), keeping the real first and last price. */
  var SPARK_POINTS = 24;
  function thin(series) {
    var n = series.length;
    if (n <= SPARK_POINTS) { return series; }
    var out = [];
    for (var i = 0; i < SPARK_POINTS; i++) {
      var a = Math.floor(i * n / SPARK_POINTS), b = Math.floor((i + 1) * n / SPARK_POINTS), sum = 0;
      for (var j = a; j < b; j++) { sum += series[j]; }
      out.push(sum / (b - a));
    }
    out[0] = series[0];
    out[SPARK_POINTS - 1] = series[n - 1];
    return out;
  }

  /* The sparkline covers the same 24 hours as the change beside it (the last 49 half-hourly prices),
     so a green "▲" never sits next to a falling line. */
  var DAY_POINTS = 49;
  function sparkHTML(item) {
    var series = thin(D.market.priceSeries(item).slice(-DAY_POINTS));
    if (series.length < 2) { return ''; }
    return '<svg class="lc-home-bd-spark" width="80" height="24" viewBox="0 0 80 24" preserveAspectRatio="none" aria-hidden="true" focusable="false">' +
      '<polyline points="' + D.sparkPoints(series, 80, 24, 3) + '" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"></polyline></svg>' +
      '<span class="lc-sr">' + trendWord(series) + '</span>';
  }

  function rowHTML(item) {
    var out = D.market.soldOut(item);
    var ch = D.market.change(item.change24h);
    var html = '<tr><th scope="row">' + D.esc(item.name) + '</th>' +
      '<td class="lc-home-bd-price">' + D.esc(D.money(item.price)) + '</td>';
    if (out) {
      /* The second "Sold out" only shows on narrow phones, where the trend column is dropped (page-home.css). */
      html += '<td class="lc-home-bd-chg lc-flat"><span class="lc-home-bd-dash">' + NO_CHANGE + '</span>' +
        SOLD_OUT.replace('lc-home-bd-out"', 'lc-home-bd-out lc-home-bd-out--chg"') + '</td>' +
        '<td class="lc-home-bd-trend">' + SOLD_OUT + '</td>';
    } else {
      html += '<td class="lc-home-bd-chg lc-' + ch.dir + '">' + (ch.html || NO_CHANGE) + '</td>' +
        '<td class="lc-home-bd-trend lc-' + ch.dir + '">' + sparkHTML(item) + '</td>';
    }
    return html + '</tr>';
  }

  function boardStatusText(res) {
    var d = res.data || {};
    var t = D.timeText(d.generatedAt) || D.timeText(d.fetchedAt);
    if (res.mode === 'sample') { return D.SAMPLE_LABEL + (res.unreachable ? CANT_REACH : ''); }
    if (res.mode === 'stale') { return 'Last known prices' + (t ? ' · ' + t : ''); }
    return t ? 'as of ' + t : 'Live';
  }

  /* ---------- headlines (feature 4) ---------- */

  var HEADLINES = 3;
  var GAIN_MIN = 2, DROP_MAX = -2, LOW_SHELF = 0.15;

  /* Best item by score (higher first); ties go to the feed order, so the pick never flickers. */
  function best(list, ok, score) {
    var top = null, topScore = 0;
    list.forEach(function (it) {
      if (!ok(it)) { return; }
      var s = score(it);
      if (top === null || s > topScore) { top = it; topScore = s; }
    });
    return top;
  }

  function pct1(n) { return Math.abs(n).toFixed(1) + '%'; }
  /* Whole percent of a full shelf, never rounded up past what's there. */
  function shelfText(f) {
    var p = Math.floor(f * 100);
    return p < 1 ? 'under 1%' : p + '%';
  }

  function headlines(list) {
    var used = {}, out = [];
    function free(it) { return !used[String(it.id)]; }
    function add(it, cls, text) {
      if (!it || out.length >= HEADLINES) { return; }
      used[String(it.id)] = true;
      out.push({ cls: cls, text: text });
    }
    var inStock = function (it) { return free(it) && !D.market.soldOut(it); };

    // Sold out: the priciest one.
    var gone = best(list, function (it) { return free(it) && D.market.soldOut(it); },
      function (it) { return D.isNum(it.price) ? it.price : 0; });
    add(gone, 'is-out', gone && gone.name + ' is sold out: the next seller sets the price.');

    // Biggest gain of at least 2%.
    var up = best(list, function (it) { return inStock(it) && D.isNum(it.change24h) && it.change24h >= GAIN_MIN; },
      function (it) { return it.change24h; });
    add(up, 'is-up', up && up.name + ' is up ' + pct1(up.change24h) + ' today.');

    // Biggest drop of at least 2%.
    var down = best(list, function (it) { return inStock(it) && D.isNum(it.change24h) && it.change24h <= DROP_MAX; },
      function (it) { return -it.change24h; });
    add(down, 'is-down', down && down.name + ' is down ' + pct1(down.change24h) + ' today.');

    // Lowest shelf under 15%, still in stock.
    var low = best(list, function (it) {
      var f = D.market.stockFraction(it);
      return inStock(it) && f !== null && f > 0 && f < LOW_SHELF;
    }, function (it) { return -D.market.stockFraction(it); });
    add(low, 'is-low', low && low.name + ' is running low: ' + shelfText(D.market.stockFraction(low)) + ' of a full shelf.');

    return out;
  }

  function renderHeadlines(list) {
    if (!newsList) { return; }
    var lines = headlines(list);
    newsList.innerHTML = lines.map(function (h) {
      return '<li class="' + h.cls + '">' + D.esc(h.text) + '</li>';
    }).join('');
    newsBox.hidden = !lines.length;
  }

  function renderBoard(res) {
    var list = uniqueItems(res && res.data && res.data.items);
    var items = pickBoard(list);
    setStatus(boardStatus, boardStatusText(res));
    boardRows.innerHTML = items.length ?
      items.map(rowHTML).join('') :
      '<tr class="lc-home-bd-msg"><td colspan="4">Nothing is on the board right now.</td></tr>';
    renderHeadlines(list);
  }

  if (boardRows) { D.watch('market', renderBoard); }

  /* ---------- Minis ---------- */

  var SAMPLE_MINIS = ['blue_amethyst', 'cobblestone', 'dried_clay_bricks', 'legendary_mini'];
  var MINIS_SHOWN = 4;
  var minisBox = document.querySelector('[data-lc-home-minis]');
  var minisList = minisBox && minisBox.querySelector('[data-lc-home-minis-list]');
  var minisStatus = minisBox && minisBox.querySelector('[data-lc-home-minis-status]');

  function rank(m) { return D.minis.RARITY_ORDER.indexOf(D.minis.rarityKey(m.rarity)); }

  /* Within a rarity: ones you can still get first, then ones with a skin, then by name. */
  function byPreference(a, b) {
    var sa = D.minis.soldOut(a) ? 1 : 0, sb = D.minis.soldOut(b) ? 1 : 0;
    if (sa !== sb) { return sa - sb; }
    var ka = a.skin ? 0 : 1, kb = b.skin ? 0 : 1;
    if (ka !== kb) { return ka - kb; }
    var n = String(a.name).localeCompare(String(b.name), 'en', { numeric: true, sensitivity: 'base' });
    return n || (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0);
  }

  /* One from each rarity, rarest first, round and round until four are picked; shown rarest first. */
  function pickSpread(list) {
    var order = D.minis.RARITY_ORDER.slice().reverse();
    var groups = {};
    order.forEach(function (k) { groups[k] = []; });
    list.forEach(function (m) { groups[D.minis.rarityKey(m.rarity)].push(m); });
    order.forEach(function (k) { groups[k].sort(byPreference); });
    var picked = [];
    for (var round = 0; picked.length < MINIS_SHOWN; round++) {
      var added = false;
      for (var r = 0; r < order.length && picked.length < MINIS_SHOWN; r++) {
        var m = groups[order[r]][round];
        if (m) { picked.push({ m: m, at: picked.length }); added = true; }
      }
      if (!added) { break; }
    }
    return picked.sort(function (a, b) { return rank(b.m) - rank(a.m) || a.at - b.at; })
      .map(function (x) { return x.m; });
  }

  function pickMinis(res) {
    var list = ((res && res.data && res.data.minis) || []).filter(usable);
    if (res.mode === 'sample') {
      var byId = {};
      list.forEach(function (m) { byId[String(m.id)] = m; });
      var mine = SAMPLE_MINIS.map(function (id) { return byId[id]; }).filter(Boolean);
      if (mine.length) { return mine; }
    }
    return pickSpread(list);
  }

  /* Scarcity (feature 5): a capped Mini that isn't sold out, with at most max(3, 10% of the cap) left. */
  function leftCount(m) {
    if (D.minis.soldOut(m) || !D.isNum(m.cap) || m.cap <= 0 || !D.isNum(m.printed)) { return 0; }
    var left = Math.round(m.cap - m.printed);
    return left > 0 && left <= Math.max(3, Math.ceil(m.cap * 0.1)) ? left : 0;
  }

  function pill(cls, text) {
    var el = document.createElement('span');
    el.className = cls;
    el.textContent = text;
    return el;
  }

  function miniCard(m) {
    var key = D.minis.rarityKey(m.rarity);
    var li = document.createElement('li');
    li.className = 'lc-home-mini lc-r--' + key;
    li.appendChild(D.minis.head(m));
    var name = document.createElement('p');
    name.className = 'lc-home-mini-name';
    name.textContent = m.name;
    li.appendChild(name);
    var pills = document.createElement('p');
    pills.className = 'lc-home-mini-pills';
    pills.appendChild(pill('lc-rarity', D.minis.RARITIES[key].name));
    var left = leftCount(m);
    if (D.minis.soldOut(m)) {
      pills.appendChild(pill('lc-pill lc-pill--dark', 'Sold out'));
    } else if (left) {
      pills.appendChild(pill('lc-pill lc-home-mini-left', 'Only ' + left + ' left'));
    }
    li.appendChild(pills);
    return li;
  }

  function renderMinis(res) {
    var minis = pickMinis(res);
    setStatus(minisStatus, res.mode === 'sample' ? D.SAMPLE_LABEL + (res.unreachable ? CANT_REACH : '') : '');
    if (!minis.length) {
      minisBox.hidden = true;
      return;
    }
    var frag = document.createDocumentFragment();
    minis.forEach(function (m) { frag.appendChild(miniCard(m)); });
    minisList.innerHTML = '';
    minisList.appendChild(frag);
  }

  if (minisList) { D.load('minis').then(renderMinis); }
})();
