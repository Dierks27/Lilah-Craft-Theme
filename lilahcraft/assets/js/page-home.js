/* LilahCraft home: the hero's market board and the four Minis, both from window.LCData.
   Board: Cobblestone, Oak Log, Iron Ingot, Gold Ingot, Emerald and Diamond when the feed has them,
   any empty slots filled with the biggest movers; refreshed on the feed's refreshSeconds.
   Minis: the design's four when showing sample data, otherwise four picked the same way every load
   (a spread of rarities, rarest first). Sample data is always labelled. */
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

  function pickBoard(items) {
    var list = (Array.isArray(items) ? items : []).filter(usable);
    var byId = {}, used = {}, out = [];
    list.forEach(function (it) {
      var id = String(it.id);
      if (!byId[id]) { byId[id] = it; }
    });
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
        if (!used[String(movers[k].it.id)]) {
          out.push(movers[k].it);
          used[String(movers[k].it.id)] = true;
        }
      }
    }
    return out;
  }

  var NO_CHANGE = '<span aria-hidden="true">—</span><span class="lc-sr">not available</span>';

  function trendWord(series) {
    var first = series[0], last = series[series.length - 1];
    var rel = first ? (last - first) / Math.abs(first) : last - first;
    if (Math.abs(rel) < 0.005) { return 'steady'; }
    return rel > 0 ? 'rising' : 'falling';
  }

  /* The design draws 24 points in 96 px; thin a longer history to that many, keeping the first and last. */
  var SPARK_POINTS = 24;
  function thin(series) {
    if (series.length <= SPARK_POINTS) { return series; }
    var out = [];
    for (var i = 0; i < SPARK_POINTS; i++) {
      out.push(series[Math.round(i * (series.length - 1) / (SPARK_POINTS - 1))]);
    }
    return out;
  }

  function sparkHTML(item) {
    var series = thin(D.market.priceSeries(item));
    if (series.length < 2) { return ''; }
    return '<svg class="lc-home-bd-spark" width="96" height="28" viewBox="0 0 96 28" preserveAspectRatio="none" aria-hidden="true" focusable="false">' +
      '<polyline points="' + D.sparkPoints(series, 96, 28, 3) + '" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"></polyline></svg>' +
      '<span class="lc-sr">' + trendWord(series) + '</span>';
  }

  function rowHTML(item) {
    var out = D.market.soldOut(item);
    var ch = D.market.change(item.change24h);
    var html = '<tr><th scope="row">' + D.esc(item.name) + '</th>' +
      '<td class="lc-home-bd-price">' + D.esc(D.money(item.price)) + '</td>';
    if (out) {
      html += '<td class="lc-home-bd-chg lc-flat">' + NO_CHANGE + '</td>' +
        '<td class="lc-home-bd-trend"><span class="lc-home-bd-out">sold out</span></td>';
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

  function renderBoard(res) {
    var items = pickBoard(res && res.data && res.data.items);
    setStatus(boardStatus, boardStatusText(res));
    boardRows.innerHTML = items.length ?
      items.map(rowHTML).join('') :
      '<tr class="lc-home-bd-msg"><td colspan="4">Nothing is on the board right now.</td></tr>';
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

  function miniCard(m) {
    var key = D.minis.rarityKey(m.rarity);
    var li = document.createElement('li');
    li.className = 'lc-home-mini lc-r--' + key;
    li.appendChild(D.minis.head(m));
    var name = document.createElement('p');
    name.className = 'lc-home-mini-name';
    name.textContent = m.name;
    var pill = document.createElement('span');
    pill.className = 'lc-rarity';
    pill.textContent = D.minis.RARITIES[key].name;
    li.appendChild(name);
    li.appendChild(pill);
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
