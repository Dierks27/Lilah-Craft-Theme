/* LilahCraft home: the hero's market board (with its headlines) and the four Minis, both from window.LCData.
   Board: Cobblestone, Oak Log, Iron Ingot, Gold Ingot, Emerald and Diamond when the feed has them,
   any empty slots filled with the biggest movers; refreshed on the feed's refreshSeconds.
   While HomeCraftMgmt's live market runs, a row's name carries the item's tag (HOT, DEAL, UP, DOWN, WANTED).
   Headlines: the newest market news (tag, headline, "20 min ago") when the feed has some; otherwise up to three
   short sentences worked out from the whole feed, always true of the prices shown (sold out, biggest gain,
   biggest drop, lowest shelf), picked the same way every time. Under them, the running season in one line.
   Without the live market (no tags, news or season in the feed) the board is exactly 2.1's.
   Minis: the design's four when showing sample data, otherwise four picked the same way every load
   (a spread of rarities, rarest first), each with "Only N left" when nearly gone, or "Sold out".
   Feed text only ever goes in as text (textContent), never as markup. Sample data is always labelled. */
(function () {
  'use strict';
  var D = window.LCData;
  if (!D) { return; }

  var CANT_REACH = ' · the live feed can’t be reached right now';
  var SVG_NS = 'http://www.w3.org/2000/svg';

  /* A name that is only a placeholder, like "[Rare Mini]", never shows. */
  function usable(x) {
    return !!x && typeof x === 'object' && typeof x.name === 'string' && x.name.trim() !== '' && !/^\s*\[.*\]\s*$/.test(x.name);
  }
  function setStatus(el, text) {
    if (!el) { return; }
    el.textContent = text;
    el.hidden = !text;
  }
  /* An element with a class and, optionally, its text (always as text, never as markup). */
  function make(tag, cls, text) {
    var el = document.createElement(tag);
    if (cls) { el.className = cls; }
    if (text != null) { el.textContent = text; }
    return el;
  }
  function svgEl(tag, attrs) {
    var el = document.createElementNS(SVG_NS, tag);
    Object.keys(attrs).forEach(function (k) { el.setAttribute(k, attrs[k]); });
    return el;
  }
  function hide(el) {
    el.setAttribute('aria-hidden', 'true');
    return el;
  }
  function empty(el) {
    while (el.firstChild) { el.removeChild(el.firstChild); }
  }
  /* A live-market tag: <span class="lc-tag lc-tag--hot">HOT</span> */
  function tagEl(tag) {
    return make('span', 'lc-tag lc-tag--' + tag.kind, tag.label);
  }

  /* ---------- market board ---------- */

  var BOARD_IDS = ['cobblestone', 'oak_log', 'iron_ingot', 'gold_ingot', 'emerald', 'diamond'];
  var BOARD_ROWS = 6;
  var board = document.querySelector('[data-lc-home-board]');
  var boardRows = board && board.querySelector('[data-lc-home-board-rows]');
  var boardStatus = board && board.querySelector('[data-lc-home-board-status]');
  var newsBox = board && board.querySelector('[data-lc-home-headlines]');
  var newsLabel = newsBox && newsBox.querySelector('[data-lc-home-headlines-label]');
  var newsList = newsBox && newsBox.querySelector('[data-lc-home-headlines-list]');
  var seasonLine = newsBox && newsBox.querySelector('[data-lc-home-season]');

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

  /* "—", read as "not available" */
  function noChange() {
    var f = document.createDocumentFragment();
    f.appendChild(hide(make('span', null, '—')));
    f.appendChild(make('span', 'lc-sr', 'not available'));
    return f;
  }
  function soldOutPill(cls) {
    return make('span', 'lc-pill lc-pill--dark lc-home-bd-out' + (cls ? ' ' + cls : ''), 'Sold out');
  }
  /* The 24h change as LCData.market.change() words it: the arrow and sign hidden, "up" or "down" read out. */
  function changeNodes(ch) {
    if (!ch.text) { return noChange(); }
    var m = /^(\D*)(.*)$/.exec(ch.text); // "▲ +" and "2.4%"
    if (!m[1]) { return document.createTextNode(ch.text); }
    var f = document.createDocumentFragment();
    f.appendChild(hide(make('span', null, m[1])));
    f.appendChild(make('span', 'lc-sr', ch.dir === 'up' ? 'up ' : 'down '));
    f.appendChild(document.createTextNode(m[2]));
    return f;
  }

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
  /* Adds the sparkline and its word ("rising") to the cell, when there are two prices to draw. */
  function addSpark(td, item) {
    var series = thin(D.market.priceSeries(item).slice(-DAY_POINTS));
    if (series.length < 2) { return; }
    var svg = svgEl('svg', { 'class': 'lc-home-bd-spark', width: '80', height: '24', viewBox: '0 0 80 24', preserveAspectRatio: 'none', 'aria-hidden': 'true', focusable: 'false' });
    svg.appendChild(svgEl('polyline', { points: D.sparkPoints(series, 80, 24, 3), fill: 'none', stroke: 'currentColor', 'stroke-width': '2',
      'stroke-linejoin': 'round', 'stroke-linecap': 'round', 'vector-effect': 'non-scaling-stroke' }));
    td.appendChild(svg);
    td.appendChild(make('span', 'lc-sr', trendWord(series)));
  }

  function row(item) {
    var tr = make('tr');
    var name = make('th', null, item.name);
    name.setAttribute('scope', 'row');
    /* The live market's tag after the name: "Oak Log, HOT" to a screen reader; it wraps under a long name. */
    var tag = D.market.badge(item);
    if (tag) {
      name.appendChild(make('span', 'lc-sr', ','));
      name.appendChild(document.createTextNode(' '));
      name.appendChild(tagEl(tag));
    }
    tr.appendChild(name);
    tr.appendChild(make('td', 'lc-home-bd-price', D.money(item.price)));
    var chg, trend;
    if (D.market.soldOut(item)) {
      chg = make('td', 'lc-home-bd-chg lc-flat');
      chg.appendChild(make('span', 'lc-home-bd-dash')).appendChild(noChange());
      /* The second "Sold out" only shows on narrow phones, where the trend column is dropped (page-home.css). */
      chg.appendChild(soldOutPill('lc-home-bd-out--chg'));
      trend = make('td', 'lc-home-bd-trend');
      trend.appendChild(soldOutPill());
    } else {
      var ch = D.market.change(item.change24h);
      chg = make('td', 'lc-home-bd-chg lc-' + ch.dir);
      chg.appendChild(changeNodes(ch));
      trend = make('td', 'lc-home-bd-trend lc-' + ch.dir);
      addSpark(trend, item);
    }
    tr.appendChild(chg);
    tr.appendChild(trend);
    return tr;
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

  /* A market news row (the live market): its tag (a plain square for a season), the headline, then how long ago. */
  function newsItem(r) {
    var li = make('li');
    if (r.tag) {
      li.appendChild(tagEl(r.tag));
      li.appendChild(make('span', 'lc-sr', ', '));
    } else {
      li.appendChild(hide(make('span', 'lc-home-bd-mark')));
    }
    var text = li.appendChild(make('span', 'lc-home-bd-flash', r.headline));
    var when = D.ago(r.t);
    if (when) {
      text.appendChild(make('span', 'lc-sr', ','));
      text.appendChild(document.createTextNode(' '));
      var time = text.appendChild(make('time', 'lc-home-bd-ago', when));
      /* A time past what a Date can hold (a malformed row) gets no datetime; toISOString() would throw and blank the strip. */
      var d = new Date(r.t);
      if (isFinite(d.getTime())) { time.setAttribute('datetime', d.toISOString()); }
    }
    return li;
  }

  /* The newest news rows (as many as there are computed headlines), or the computed headlines when there's no news. */
  function renderHeadlines(list, data) {
    if (!newsList) { return; }
    var news = D.market.news(data).slice(0, HEADLINES);
    var lines = news.length ? news.map(newsItem) : headlines(list).map(function (h) { return make('li', h.cls, h.text); });
    empty(newsList);
    lines.forEach(function (li) { newsList.appendChild(li); });
    newsList.classList.toggle('is-news', news.length > 0);
    newsList.hidden = !lines.length;
    // (A copy of this template saved in the Site Editor before 2.2 has no label hook and no season line.)
    if (newsLabel) { newsLabel.hidden = !lines.length; }
    newsBox.hidden = !lines.length && (!seasonLine || seasonLine.hidden);
  }

  /* The running season in one line: "Season: Harvest Time, ends in 4d 2h". */
  function renderSeason(data) {
    if (!seasonLine) { return; }
    var s = D.market.season(data);
    var left = s ? D.timeLeft(s.endsAt) : '';
    empty(seasonLine);
    if (s) {
      seasonLine.appendChild(make('span', 'lc-home-bd-news-label', 'Season'));
      seasonLine.appendChild(make('span', 'lc-sr', ':'));
      seasonLine.appendChild(document.createTextNode(' '));
      seasonLine.appendChild(make('strong', null, s.name));
      if (left) { seasonLine.appendChild(document.createTextNode(', ends in ' + left)); }
    }
    seasonLine.hidden = !s;
  }

  function renderBoard(res) {
    var data = (res && res.data) || {};
    var list = uniqueItems(data.items);
    var items = pickBoard(list);
    setStatus(boardStatus, boardStatusText(res));
    empty(boardRows);
    if (items.length) {
      items.forEach(function (it) { boardRows.appendChild(row(it)); });
    } else {
      boardRows.appendChild(make('tr', 'lc-home-bd-msg'))
        .appendChild(make('td', null, 'Nothing is on the board right now.')).setAttribute('colspan', '4');
    }
    renderSeason(data);
    renderHeadlines(list, data);
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
    return make('span', cls, text);
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
    empty(minisList);
    minisList.appendChild(frag);
  }

  if (minisList) { D.load('minis').then(renderMinis); }
})();
