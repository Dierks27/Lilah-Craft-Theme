/* LilahCraft 2.0: the Market page.
   Stat cards, search, sort, category chips, the price table with sparklines and the detail panel
   with the 48-hour chart, all from LCData.watch('market'): live, stale (the last good copy) or
   labelled sample data. On desktop the panel is the sticky right column; at 920 px and below it
   sits right under the chosen row. Each refresh keeps the search, sort, category, selection and
   keyboard focus: rows are updated in place, never rebuilt. */
(function () {
  'use strict';
  var D = window.LCData;
  var root = document.querySelector('[data-mk]');
  if (!D || !root) { return; }
  var M = D.market;
  var LC = window.LC || {};

  var DEFAULT_ID = 'iron_ingot';
  var CHANGE_COLOUR = { up: '#1d7a4b', down: '#b8421c', flat: '#6b6d8f' };
  var STOCK_NONE = '#e3869f', STOCK_LOW = '#e0a83a', STOCK_OK = '#2bb5bf';
  var CW = 346, CH = 170, CPAD = 12; /* the detail chart's viewBox */
  var DASH = '<span aria-hidden="true">—</span>';

  function q(sel, el) { return (el || root).querySelector(sel); }
  function announce(text) { if (LC.announce) { LC.announce(text); } }
  function setHTML(el, html) { if (el._h !== html) { el._h = html; el.innerHTML = html; } }
  function setText(el, text) { if (el.textContent !== text) { el.textContent = text; } }
  function plural(n, one, many) { return n === 1 ? one : many; }

  var status = document.querySelector('[data-mk-status]');
  var statusText = status && status.querySelector('[data-mk-status-text]');
  var find = q('#mkFind');
  var sortSel = q('#mkSort');
  var chipBox = q('[data-mk-chips]');
  var table = q('[data-mk-table]');
  var tbody = q('[data-mk-rows]');
  var emptyEl = q('[data-mk-empty]');
  var foot = q('[data-mk-foot]');
  var side = q('[data-mk-side]');
  var detail = q('#mkDetail');
  if (!find || !sortSel || !chipBox || !table || !tbody || !side || !detail) { return; }

  var d = {};
  [].forEach.call(detail.querySelectorAll('[data-mk-d]'), function (el) { d[el.getAttribute('data-mk-d')] = el; });
  var stat = {}, sub = {};
  [].forEach.call(root.querySelectorAll('[data-mk-stat]'), function (el) { stat[el.getAttribute('data-mk-stat')] = el; });
  [].forEach.call(root.querySelectorAll('[data-mk-sub]'), function (el) { sub[el.getAttribute('data-mk-sub')] = el; });

  /* At 920 px and below the panel lives in this row, right after the chosen item. */
  var detailRow = document.createElement('tr');
  detailRow.className = 'mk-detail-row';
  detailRow.setAttribute('role', 'row');
  var detailCell = document.createElement('td');
  detailCell.setAttribute('role', 'cell');
  detailCell.colSpan = 6;
  detailRow.appendChild(detailCell);
  var narrow = window.matchMedia ? window.matchMedia('(max-width: 920px)') : { matches: false };

  var state = { res: null, items: [], byId: {}, q: find.value || '', sort: sortSel.value || 'change', cat: 'all', sel: null };
  var rows = {};

  /* ---------- data ---------- */

  function ingest(data) {
    var list = data && Array.isArray(data.items) ? data.items : [];
    state.items = [];
    state.byId = {};
    list.forEach(function (raw) {
      if (!raw || raw.id == null) { return; }
      var id = String(raw.id);
      if (state.byId[id]) { return; }
      var it = {
        id: id,
        name: String(raw.name || id),
        price: raw.price, buy: raw.buy, sell: raw.sell,
        stock: raw.stock, change24h: raw.change24h, history: Array.isArray(raw.history) ? raw.history : [],
        out: M.soldOut(raw),
        cat: M.categoryOf(raw.material || id),
        frac: M.stockFraction(raw),
        ch: M.change(raw.change24h),
        series: M.priceSeries(raw),
        swatch: M.swatchOf(raw)
      };
      it.find = (it.name + ' ' + String(raw.material || '') + ' ' + id).toLowerCase().replace(/[_:\-]+/g, ' ');
      state.items.push(it);
      state.byId[id] = it;
    });
  }

  function visibleSorted() {
    var words = state.q.toLowerCase().replace(/[_:\-]+/g, ' ').trim();
    var list = state.items.filter(function (it) {
      return (state.cat === 'all' || it.cat === state.cat) && (!words || it.find.indexOf(words) > -1);
    });
    var key = state.sort;
    return list.sort(function (a, b) {
      var r = 0;
      if (key === 'change') { r = changeSize(b) - changeSize(a); }
      else if (key === 'price') { r = (D.isNum(b.price) ? b.price : -1) - (D.isNum(a.price) ? a.price : -1); }
      else if (key === 'stock') { r = stockLevel(a) - stockLevel(b); }
      return r || a.name.localeCompare(b.name);
    });
  }
  /* Biggest change = largest move either way. Sold out and unknown go last. */
  function changeSize(it) { return !it.out && D.isNum(it.change24h) ? Math.abs(it.change24h) : -1; }
  /* Lowest stock = emptiest shelf first. A shelf with no known size goes last. */
  function stockLevel(it) {
    if (it.out) { return 0; }
    return it.frac === null ? 2 : it.frac;
  }

  function refreshSeconds(data) {
    return Math.max(15, Number(data && data.refreshSeconds) || Number(LC.cacheSeconds) || 60);
  }

  /* ---------- page head and stat cards ---------- */

  function renderStatus() {
    if (!status || !statusText) { return; }
    var res = state.res, data = res.data || {}, text;
    if (res.mode === 'live') {
      text = 'Live · refreshes every ' + refreshSeconds(data) + ' s';
    } else if (res.mode === 'stale') {
      var t = D.timeText(data.generatedAt || data.fetchedAt);
      text = 'Last known prices' + (t ? ' · ' + t : '');
    } else {
      text = D.SAMPLE_LABEL + (res.unreachable ? ' · the live feed can’t be reached' : '');
    }
    setText(statusText, text);
    status.setAttribute('data-mode', res.mode);
  }

  function setStat(key, value, subHTML, dir) {
    if (!stat[key] || !sub[key]) { return; }
    setText(stat[key], value);
    setHTML(sub[key], subHTML);
    sub[key].className = 'mk-stat-sub' + (dir ? ' lc-' + dir : '');
  }

  function renderStats() {
    var best = null, worst = null, out = 0;
    state.items.forEach(function (it) {
      if (it.out) { out++; return; }
      if (it.ch.dir === 'up' && (!best || it.change24h > best.change24h)) { best = it; }
      if (it.ch.dir === 'down' && (!worst || it.change24h < worst.change24h)) { worst = it; }
    });
    setStat('gain', best ? best.name : 'Nothing up', best ? best.ch.html : 'no price rose today', best ? 'up' : '');
    setStat('drop', worst ? worst.name : 'Nothing down', worst ? worst.ch.html : 'no price fell today', worst ? 'down' : '');
    setStat('out', out + plural(out, ' item', ' items'), out ? 'waiting for a seller' : 'everything is in stock', '');
    var mode = state.res.mode;
    setStat('count', D.count(state.items.length), mode === 'live' ? 'updated live' : mode === 'stale' ? 'last known prices' : 'on the sample board', '');
  }

  /* ---------- category chips ---------- */

  var chips = {};
  M.CATEGORIES.forEach(function (c) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'lc-chip';
    b.textContent = c.label;
    b.setAttribute('data-cat', c.id);
    b.setAttribute('aria-pressed', c.id === state.cat ? 'true' : 'false');
    if (c.id === 'other') { b.hidden = true; }
    chips[c.id] = b;
    chipBox.appendChild(b);
  });
  function syncChips() {
    Object.keys(chips).forEach(function (id) { chips[id].setAttribute('aria-pressed', id === state.cat ? 'true' : 'false'); });
  }
  /* "Other" only shows when some item maps to it. */
  function renderChips() {
    var other = chips.other;
    if (!other) { return; }
    var has = state.items.some(function (it) { return it.cat === 'other'; });
    if (!has && state.cat === 'other') {
      var hadFocus = document.activeElement === other;
      state.cat = 'all';
      syncChips();
      if (hadFocus && chips.all) { chips.all.focus(); }
    }
    other.hidden = !has;
  }

  /* ---------- table rows ---------- */

  function makeRow(id) {
    var tr = document.createElement('tr');
    tr.className = 'mk-row';
    tr.setAttribute('role', 'row');
    tr.setAttribute('data-id', id);
    tr.innerHTML =
      '<th class="mk-c-item" role="rowheader" scope="row"><button type="button" class="mk-pick" aria-pressed="false">' +
      '<span class="mk-sw" aria-hidden="true"></span><span class="mk-name"></span></button></th>' +
      '<td class="mk-c-price" role="cell"></td><td class="mk-c-chg" role="cell"></td><td class="mk-c-spread" role="cell"></td>' +
      '<td class="mk-c-stock" role="cell"></td><td class="mk-c-spark" role="cell"></td>';
    var td = tr.querySelectorAll('td');
    var r = {
      tr: tr, btn: tr.querySelector('button'), sw: tr.querySelector('.mk-sw'), name: tr.querySelector('.mk-name'),
      price: td[0], chg: td[1], spread: td[2], stock: td[3], spark: td[4]
    };
    r.btn.setAttribute('data-id', id);
    return r;
  }

  function stockPct(f) {
    var p = Math.round(f * 100);
    return p === 0 && f > 0 ? null : p;
  }

  function fillRow(r, it) {
    setText(r.name, it.name);
    if (r._sw !== it.swatch) { r._sw = it.swatch; r.sw.style.background = it.swatch; }
    setHTML(r.price, D.esc(D.money(it.price)));

    var dir = it.out ? 'flat' : it.ch.dir;
    r.chg.className = 'mk-c-chg lc-' + dir;
    setHTML(r.chg, it.out ? 'sold out' : it.ch.html);

    var sell = D.isNum(it.sell) ? D.money(it.sell) : '';
    var buy = !it.out && D.isNum(it.buy) ? D.money(it.buy) : '';
    setHTML(r.spread, sell || buy ?
      '<span class="mk-k">Sell </span>' + (sell || DASH) + '<span aria-hidden="true"> · </span><span class="mk-k">, buy </span>' +
      (buy || DASH + '<span class="lc-sr">none</span>') : '');

    var stockHTML = '';
    if (it.out || it.frac !== null) {
      var f = it.out ? 0 : it.frac;
      var colour = it.out ? STOCK_NONE : f < 0.25 ? STOCK_LOW : STOCK_OK;
      var pct = stockPct(f);
      stockHTML = '<span class="mk-k" aria-hidden="true">Stock</span><span class="mk-bar" aria-hidden="true"><span style="width:' +
        (f * 100).toFixed(1) + '%;background:' + colour + '"></span></span><span>' +
        (it.out ? 'none' : pct === null ? '&lt;1%' : pct + '%') + '</span>';
    } else if (D.isNum(it.stock)) {
      stockHTML = '<span class="mk-k" aria-hidden="true">Stock</span><span>' + D.count(it.stock) + '</span>';
    }
    setHTML(r.stock, stockHTML);

    var vals = it.out ? [1, 1] : it.series;
    setHTML(r.spark, vals.length < 2 ? '' :
      '<svg width="104" height="30" viewBox="0 0 104 30" aria-hidden="true" focusable="false"><polyline points="' +
      D.sparkPoints(vals, 104, 30, 3) + '" fill="none" stroke="' + CHANGE_COLOUR[dir] +
      '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"></polyline></svg>');
  }

  /* Move a row without dropping keyboard focus where the browser can (moveBefore). */
  function put(node, ref) {
    if (tbody.moveBefore && node.parentNode === tbody) {
      try { tbody.moveBefore(node, ref); return; } catch (e) { /* fall back below */ }
    }
    tbody.insertBefore(node, ref);
  }

  function markSelected() {
    Object.keys(rows).forEach(function (id) {
      var on = id === state.sel;
      rows[id].tr.classList.toggle('is-sel', on);
      rows[id].btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function renderRows(list) {
    var active = document.activeElement;
    var keep = {}, shown = {};
    state.items.forEach(function (it) {
      keep[it.id] = 1;
      if (!rows[it.id]) { rows[it.id] = makeRow(it.id); }
      fillRow(rows[it.id], it);
    });
    Object.keys(rows).forEach(function (id) {
      if (keep[id]) { return; }
      if (rows[id].tr.contains(active)) { active = find; }
      if (rows[id].tr.parentNode) { rows[id].tr.parentNode.removeChild(rows[id].tr); }
      delete rows[id];
    });

    /* order the visible rows; the detail row is put back afterwards */
    if (detailRow.parentNode) { detailRow.parentNode.removeChild(detailRow); }
    var cursor = tbody.firstChild;
    list.forEach(function (it) {
      shown[it.id] = 1;
      var tr = rows[it.id].tr;
      if (tr === cursor) { cursor = cursor.nextSibling; return; }
      put(tr, cursor);
    });
    Object.keys(rows).forEach(function (id) {
      if (!rows[id].tr.parentNode) { tbody.appendChild(rows[id].tr); }
      rows[id].tr.hidden = !shown[id];
    });
    markSelected();

    var n = list.length, total = state.items.length;
    table.hidden = n === 0;
    if (emptyEl) {
      emptyEl.hidden = n > 0;
      if (!n) { emptyEl.textContent = emptyText(total); }
    }
    if (foot) {
      foot.hidden = n === 0;
      setText(foot, footText(n, total));
    }
    if (active && active !== document.activeElement && document.contains(active)) {
      try { active.focus({ preventScroll: true }); } catch (e) { active.focus(); }
    }
  }

  function footText(n, total) {
    if (state.res.mode === 'sample') {
      return 'Showing ' + (n === total ? total : n + ' of ' + total) + ' sample ' + plural(total, 'item', 'items') +
        '. The live board lists every item the market carries.';
    }
    if (n === total) { return total === 1 ? 'Showing 1 item.' : 'Showing all ' + total + ' items.'; }
    return 'Showing ' + n + ' of ' + total + ' ' + plural(total, 'item', 'items') + '.';
  }

  function emptyText(total) {
    if (!total) { return 'Nothing is on the board right now. Check back soon.'; }
    var words = state.q.trim(), label = M.categoryLabel(state.cat);
    if (words && state.cat !== 'all') { return 'No item in ' + label + ' matches “' + words + '”. Try another name, or pick All items.'; }
    if (words) { return 'No item matches “' + words + '”. Try another name.'; }
    return 'Nothing in ' + label + ' is on the board right now. Pick All items to see everything.';
  }

  /* ---------- detail panel ---------- */

  function spanHours(it) {
    var h = it.history, a = h.length && h[0] && h[0].t, b = h.length && h[h.length - 1] && h[h.length - 1].t;
    if (!D.isNum(a) || !D.isNum(b) || !(a > 0) || b <= a) { return 48; }
    var hrs = Math.round((b - a) / 3600000);
    return hrs >= 47 ? 48 : Math.max(1, hrs);
  }

  function renderDetail() {
    var it = state.byId[state.sel];
    detail.hidden = !it;
    if (!it) { return; }

    setText(d.name, it.name);
    if (it.out) {
      d.badge.hidden = false;
      d.badge.className = 'mk-d-badge mk-d-badge--out';
      setHTML(d.badge, 'Sold out');
    } else if (it.ch.html) {
      d.badge.hidden = false;
      d.badge.className = 'mk-d-badge lc-' + it.ch.dir;
      setHTML(d.badge, it.ch.html + ' today');
    } else {
      d.badge.hidden = true;
    }
    setText(d.price, D.money(it.price));

    /* the 48-hour chart */
    var line = null;
    if (it.out) { line = '0.0,' + (CH - CPAD).toFixed(1) + ' ' + CW.toFixed(1) + ',' + (CH - CPAD).toFixed(1); }
    else if (it.series.length >= 2) { line = D.sparkPoints(it.series, CW, CH, CPAD); }
    d.chart.hidden = !line;
    if (line) {
      var hrs = spanHours(it), span = hrs === 1 ? 'hour' : hrs + ' hours';
      d.line.setAttribute('points', line);
      d.line.setAttribute('stroke', it.out ? '#aeb2e4' : '#63e3ea');
      d.area.setAttribute('points', '0,' + CH + ' ' + line + ' ' + CW + ',' + CH);
      d.area.setAttribute('fill', it.out ? '#1b1f4d' : '#1f3a63');
      d.svg.setAttribute('aria-label', 'Price of ' + it.name + ' over the last ' + span);
      setText(d.ago, (hrs === 1 ? '1 hour' : span) + ' ago');
      if (it.out) {
        setText(d.range, 'no trades');
      } else {
        var lo = Math.min.apply(null, it.series), hi = Math.max.apply(null, it.series);
        setText(d.range, 'low ' + D.money(lo) + ' · high ' + D.money(hi));
      }
    }

    /* stock */
    var stockText = '', width = null;
    if (it.out) { stockText = 'None left'; width = 0; }
    else if (it.frac !== null) {
      var pct = stockPct(it.frac);
      stockText = (pct === null ? 'Under 1%' : pct + '%') + ' of a full shelf';
      width = it.frac * 100;
    } else if (D.isNum(it.stock)) { stockText = D.count(it.stock) + ' in stock'; }
    d.stockWrap.hidden = !stockText;
    setText(d.stock, stockText);
    d.barWrap.hidden = width === null;
    if (width !== null) { d.bar.style.width = width.toFixed(1) + '%'; }

    /* what you get and pay; hide what the feed doesn't give */
    var sellOk = D.isNum(it.sell), buyOk = it.out || D.isNum(it.buy);
    d.sellBox.hidden = !sellOk;
    d.buyBox.hidden = !buyOk;
    d.trade.hidden = !sellOk && !buyOk;
    setText(d.sell, sellOk ? D.money(it.sell) : '');
    setHTML(d.buy, it.out ? DASH + '<span class="lc-sr">none, sold out</span>' : buyOk ? D.esc(D.money(it.buy)) : '');

    setText(d.note, it.out ?
      'Sold out. Nobody can buy it until somebody sells one in, so the first seller sets the price.' :
      'Buy it on any PC. It ships to your Locker.');
    d.sample.hidden = state.res.mode !== 'sample';
  }

  /* Desktop: the sticky right column. 920 px and below: right after the chosen row, or back in
     its own slot under the table when that row is filtered out. */
  function placeDetail() {
    var r = state.sel && rows[state.sel];
    var inline = narrow.matches && r && !r.tr.hidden && !table.hidden;
    if (inline) {
      if (detailRow.parentNode !== tbody || detailRow.previousSibling !== r.tr) { tbody.insertBefore(detailRow, r.tr.nextSibling); }
      if (detail.parentNode !== detailCell) { detailCell.appendChild(detail); }
      side.hidden = true;
    } else {
      if (detailRow.parentNode) { detailRow.parentNode.removeChild(detailRow); }
      if (detail.parentNode !== side) { side.appendChild(detail); }
      side.hidden = false;
    }
  }

  function headerBottom() {
    var h = document.querySelector('[data-lc-header]') || document.querySelector('.lc-top');
    return h ? Math.max(0, h.getBoundingClientRect().bottom) : 0;
  }

  /* On a phone, bring the panel into view under the row without pushing the row off screen. */
  function reveal(btn) {
    var vh = window.innerHeight || document.documentElement.clientHeight;
    var over = detail.getBoundingClientRect().bottom - vh + 16;
    if (over <= 0) { return; }
    var room = btn.getBoundingClientRect().top - headerBottom() - 12;
    var by = Math.min(over, Math.max(0, room));
    if (by < 1) { return; }
    var still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    try { window.scrollBy({ top: by, behavior: still ? 'auto' : 'smooth' }); } catch (e) { window.scrollBy(0, by); }
  }

  function changeWords(it) {
    if (it.out) { return 'sold out'; }
    if (!it.ch.text) { return ''; }
    var pct = Math.abs(it.change24h).toFixed(1) + '%';
    return it.ch.dir === 'up' ? 'up ' + pct + ' today' : it.ch.dir === 'down' ? 'down ' + pct + ' today' : 'no change today';
  }

  function select(id, btn) {
    var it = state.byId[id];
    if (!it) { return; }
    var before = btn ? btn.getBoundingClientRect().top : 0;
    state.sel = id;
    markSelected();
    renderDetail();
    placeDetail();
    if (btn && narrow.matches && detail.parentNode === detailCell) {
      var shift = btn.getBoundingClientRect().top - before;
      if (Math.abs(shift) >= 1) { window.scrollBy(0, shift); }
      reveal(btn);
    }
    var words = changeWords(it);
    announce(it.name + ', ' + D.money(it.price) + (words ? ', ' + words : '') + '.');
  }

  /* ---------- putting it together ---------- */

  function ensureSelection(list) {
    if (state.sel && state.byId[state.sel]) { return; }
    state.sel = state.byId[DEFAULT_ID] ? DEFAULT_ID : list.length ? list[0].id : state.items.length ? state.items[0].id : null;
  }

  function update() {
    var list = visibleSorted();
    renderRows(list);
    placeDetail();
    return list;
  }

  function renderAll() {
    renderStatus();
    renderStats();
    renderChips();
    var list = visibleSorted();
    ensureSelection(list);
    renderRows(list);
    renderDetail();
    placeDetail();
  }

  var sayTimer = null;
  function sayCount(n) {
    clearTimeout(sayTimer);
    sayTimer = setTimeout(function () {
      announce(n === 0 ? 'No items match.' : n + plural(n, ' item', ' items') + ' shown.');
    }, 500);
  }

  find.addEventListener('input', function () {
    state.q = find.value;
    if (state.res) { sayCount(update().length); }
  });
  sortSel.addEventListener('change', function () {
    state.sort = sortSel.value;
    if (state.res) { update(); }
  });
  chipBox.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('button[data-cat]') : null;
    if (!b) { return; }
    state.cat = b.getAttribute('data-cat');
    syncChips();
    if (state.res) { sayCount(update().length); }
  });
  tbody.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('button.mk-pick') : null;
    if (b) { select(b.getAttribute('data-id'), b); }
  });
  if (narrow.addEventListener) { narrow.addEventListener('change', placeDetail); }
  else if (narrow.addListener) { narrow.addListener(placeDetail); }

  D.watch('market', function (res) {
    state.res = res;
    ingest(res.data);
    renderAll();
  });
})();
