/* LilahCraft 2.1: the Market page, a trader's view of the feed.
   Ticker tape, the LCX index and breadth, the market list (search, sector tabs, watchlist), the
   selected item (price, 12H/24H/48H chart, stock on the shelf, stats, where to trade), top movers,
   sectors today, the heatmap and "What's my stuff worth?". All from LCData.watch('market'): live,
   stale (the last good copy) or labelled sample data. The selection sits in the URL (?item=id).
   Each refresh updates the page in place, so the selection, sector, range, search, calculator and
   keyboard focus all stay put. */
(function () {
  'use strict';
  var D = window.LCData;
  var root = document.querySelector('[data-mk]');
  if (!D || !root) { return; }
  var M = D.market;
  var LC = window.LC || {};

  var DEFAULT_ID = 'iron_ingot';
  var SECTORS = ['ores', 'stone', 'wood', 'farm', 'mob', 'nether', 'other'];
  var RANGE_POINTS = { '12H': 24, '24H': 48, '48H': 96 };
  var WATCH_KEY = 'lilahcraft-market-watch';
  var CALC_KEY = 'lilahcraft-market-calc';
  var STACK = 64, MAX_QTY = 999999, MAX_LINES = 40, MAX_COUNT = 1e9;

  /* ---------- small helpers ---------- */

  function q(sel, el) { return (el || root).querySelector(sel); }
  function esc(s) { return D.esc(s); }
  function isNum(n) { return D.isNum(n); }
  function announce(text) { if (LC.announce && text) { LC.announce(text); } }
  function setHTML(el, html) { if (el && el._h !== html) { el._h = html; el.innerHTML = html; } }
  function setText(el, text) { if (el && el.textContent !== text) { el.textContent = text; } }
  function plural(n, one, many) { return n === 1 ? one : many; }
  function dict() { return Object.create(null); }
  function norm(s) { return String(s || '').toLowerCase().replace(/[_:\-]+/g, ' ').replace(/\s+/g, ' ').trim(); }
  function stillMotion() { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }

  /* Prices under $1 keep up to four decimals (the feed's own precision), so a cheap item's
     high and low, or 64 of them at $0.0855, don't all read "$0.09". */
  function fine(n) {
    if (!isNum(n)) { return ''; }
    if (Math.abs(n) >= 1 || n === 0) { return D.money(n); }
    var s = Math.abs(n).toFixed(4).replace(/0+$/, '');
    if (s.split('.')[1].length < 2) { s = Math.abs(n).toFixed(2); }
    return (n < 0 ? '−$' : '$') + s;
  }
  /* A price with a fixed number of decimals (chart gridlines) */
  function fixed(n, d) {
    return (n < 0 ? '−$' : '$') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  function signed(n) { return (n < 0 ? '−' : '+') + D.money(Math.abs(n)); }

  /* "+2.4%" with screen-reader words, as in the design's list pills. */
  function pctHTML(it) {
    if (it.out) { return '<span aria-hidden="true">OUT</span><span class="lc-sr">sold out</span>'; }
    if (!it.ch.text) { return ''; }
    if (it.ch.dir === 'flat') { return '0.0%'; }
    var up = it.ch.dir === 'up';
    return '<span aria-hidden="true">' + (up ? '+' : '−') + '</span><span class="lc-sr">' + (up ? 'up ' : 'down ') + '</span>' +
      Math.abs(it.change24h).toFixed(1) + '%';
  }
  function avgHTML(a) {
    var c = M.change(a);
    if (c.dir === 'flat') { return '0.0%'; }
    var up = c.dir === 'up';
    return '<span aria-hidden="true">' + (up ? '+' : '−') + '</span><span class="lc-sr">' + (up ? 'up ' : 'down ') + '</span>' + Math.abs(a).toFixed(1) + '%';
  }
  function dirOf(it) { return it.out ? 'out' : it.ch.dir; }
  function changeWords(it) {
    if (it.out) { return 'sold out'; }
    if (!it.ch.text) { return ''; }
    var p = Math.abs(it.change24h).toFixed(1) + '%';
    return it.ch.dir === 'up' ? 'up ' + p + ' today' : it.ch.dir === 'down' ? 'down ' + p + ' today' : 'no change today';
  }

  function readStore(key) {
    try { var v = window.localStorage.getItem(key); return v ? JSON.parse(v) : null; } catch (e) { return null; }
  }
  function writeStore(key, val) {
    try { window.localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* the page works without it */ }
  }

  function urlItem() {
    try { return String(new URLSearchParams(window.location.search).get('item') || '').toLowerCase(); } catch (e) { return ''; }
  }
  function itemURL(id) {
    try {
      var u = new URL(window.location.href);
      u.searchParams.set('item', id);
      u.hash = '';
      return u.href;
    } catch (e) { return window.location.href; }
  }
  function putURL(id) {
    try {
      var u = new URL(window.location.href);
      if (u.searchParams.get('item') === id) { return; }
      u.searchParams.set('item', id);
      window.history.replaceState(window.history.state, '', u.pathname + u.search + u.hash);
    } catch (e) { /* the selection still works */ }
  }

  /* ---------- elements ---------- */

  var status = document.querySelector('[data-mk-status]');
  var statusText = status && status.querySelector('[data-mk-status-text]');
  var tape = q('[data-mk-tape]'), tapeBtn = q('[data-mk-tape-btn]'), track = q('[data-mk-track]');
  var run1 = q('[data-mk-run]'), run2 = q('[data-mk-run2]');
  var info = q('[data-mk-info]'), pop = q('[data-mk-pop]');
  var lcxNum = q('[data-mk-lcx]'), lcxCh = q('[data-mk-lcx-ch]'), lcxLine = q('[data-mk-lcx-line]');
  var lcxSpark = lcxLine && lcxLine.ownerSVGElement;
  var outN = q('[data-mk-out]');
  var find = q('#mkFind'), tabBox = q('[data-mk-tabs]'), pick = q('[data-mk-pick]');
  var list = q('[data-mk-list]'), listEmpty = q('[data-mk-list-empty]'), listFoot = q('[data-mk-list-foot]');
  var center = q('[data-mk-center]'), quote = q('.mk-quote');
  var watchBtn = q('[data-mk-watch]'), linkBtn = q('[data-mk-link]');
  var rangeBox = q('.mk-range'), openLabel = q('[data-mk-open-label]');
  var chartBox = q('[data-mk-chart]'), svg = q('[data-mk-svg]'), gLabels = q('[data-mk-glabels]');
  var axis = q('[data-mk-axis]'), noHist = q('[data-mk-nohist]');
  var sb = q('[data-mk-sb]'), sbNow = q('[data-mk-sb-now]'), sbSvg = q('[data-mk-sb-svg]');
  var buyBox = q('[data-mk-buybox]'), sellBox = q('[data-mk-sellbox]');
  var gainUl = q('[data-mk-gainers]'), loseUl = q('[data-mk-losers]');
  var gainNone = q('[data-mk-gainers-none]'), loseNone = q('[data-mk-losers-none]');
  var secUl = q('[data-mk-sectors]'), heatUl = q('[data-mk-heat]');
  var calc = q('[data-mk-calc]');
  if (!find || !tabBox || !list || !pick || !center || !svg || !heatUl || !calc) { return; }

  var qv = {};
  [].forEach.call(root.querySelectorAll('[data-mk-q]'), function (el) { qv[el.getAttribute('data-mk-q')] = el; });
  var stats = {};
  [].forEach.call(root.querySelectorAll('[data-st]'), function (el) { stats[el.getAttribute('data-st')] = { box: el, dd: el.querySelector('dd') }; });
  var bText = {}, bBar = {};
  [].forEach.call(root.querySelectorAll('[data-mk-b]'), function (el) { bText[el.getAttribute('data-mk-b')] = el; });
  [].forEach.call(root.querySelectorAll('[data-mk-bw]'), function (el) { bBar[el.getAttribute('data-mk-bw')] = el; });
  var ax = {};
  [].forEach.call(root.querySelectorAll('[data-mk-ax]'), function (el) { ax[el.getAttribute('data-mk-ax')] = el; });
  var tfBtns = [].slice.call(root.querySelectorAll('.mk-tf[data-tf]'));

  /* ---------- state ---------- */

  var state = {
    res: null, items: [], byId: dict(),
    q: find.value || '', tab: 'all', sel: null, wanted: urlItem(), picked: false, tf: '48H',
    watch: dict(), lines: []
  };
  (function () {
    var w = readStore(WATCH_KEY);
    if (Array.isArray(w)) { w.forEach(function (id) { if (typeof id === 'string' && id) { state.watch[id] = true; } }); }
    var c = readStore(CALC_KEY);
    if (Array.isArray(c)) {
      c.forEach(function (l) {
        if (l && typeof l.id === 'string' && l.id && isNum(l.n) && l.n >= 1 && state.lines.length < MAX_LINES) {
          state.lines.push({ id: l.id, n: Math.min(MAX_COUNT, Math.floor(l.n)), name: typeof l.name === 'string' ? l.name.slice(0, 80) : '' });
        }
      });
    }
  })();
  function saveWatch() { writeStore(WATCH_KEY, Object.keys(state.watch)); }
  function saveLines() { writeStore(CALC_KEY, state.lines); }

  /* ---------- data ---------- */

  function ingest(data) {
    var raw = data && Array.isArray(data.items) ? data.items : [];
    var items = [], byId = dict();
    raw.forEach(function (r) {
      if (!r || r.id == null) { return; }
      var id = String(r.id);
      if (byId[id]) { return; }
      var hist = (Array.isArray(r.history) ? r.history : []).filter(function (h) { return h && isNum(h.p); });
      var it = {
        id: id,
        name: String(r.name || id),
        material: String(r.material || ''),
        price: isNum(r.price) ? r.price : null,
        buy: isNum(r.buy) ? r.buy : null,
        sell: isNum(r.sell) ? r.sell : null,
        stock: isNum(r.stock) ? r.stock : null,
        maxStock: isNum(r.maxStock) && r.maxStock > 0 ? r.maxStock : null,
        change24h: isNum(r.change24h) ? r.change24h : null,
        history: hist,
        series: hist.map(function (h) { return h.p; }),
        out: M.soldOut(r),
        sector: M.categoryOf(r.material || id),
        frac: M.stockFraction(r),
        ch: M.change(r.change24h)
      };
      items.push(it);
      byId[id] = it;
    });
    var syms = M.symbols(items);
    items.forEach(function (it) {
      it.sym = syms[it.id] || it.id.slice(0, 4).toUpperCase();
      it.find = ' ' + norm(it.sym + ' ' + it.name + ' ' + it.material + ' ' + it.id);
    });
    state.items = items;
    state.byId = byId;
  }

  function refreshSeconds(data) {
    return Math.max(15, Number(data && data.refreshSeconds) || Number(LC.cacheSeconds) || 60);
  }

  function ensureSelection() {
    if (!state.picked && state.wanted && state.byId[state.wanted]) { state.sel = state.wanted; return; }
    if (state.sel && state.byId[state.sel]) { return; }
    state.sel = state.byId[DEFAULT_ID] ? DEFAULT_ID : state.items.length ? state.items[0].id : null;
  }

  function visibleItems() {
    var words = norm(state.q);
    return state.items.filter(function (it) {
      var inTab = state.tab === 'all' || (state.tab === 'watch' ? !!state.watch[it.id] : it.sector === state.tab);
      return inTab && (!words || it.find.indexOf(words) > -1);
    });
  }

  /* The history slice for the chosen range */
  function rangeHist(it) { return it.history.slice(-RANGE_POINTS[state.tf]); }
  function spanHours(hist) {
    var a = hist.length ? hist[0].t : 0, b = hist.length ? hist[hist.length - 1].t : 0;
    if (isNum(a) && isNum(b) && a > 0 && b > a) { return Math.max(1, Math.round((b - a) / 3600000)); }
    return Math.max(1, Math.round((hist.length - 1) / 2));
  }
  function hoursText(h) { return h === 1 ? 'hour' : h + ' hours'; }

  /* ---------- status ---------- */

  var sampleLabels = [].slice.call(root.querySelectorAll('[data-mk-sample]'));
  function renderStatus() {
    var isSample = state.res.mode === 'sample';
    sampleLabels.forEach(function (el) { el.hidden = !isSample; });
    if (!status || !statusText) { return; }
    var res = state.res, data = res.data || {}, text;
    if (res.mode === 'live') {
      text = 'Live · updates every ' + refreshSeconds(data) + ' s';
    } else if (res.mode === 'stale') {
      var t = D.timeText(data.generatedAt || data.fetchedAt);
      text = 'Last known prices' + (t ? ' · ' + t : '');
    } else {
      text = D.SAMPLE_LABEL + (res.unreachable ? ' · the live feed can’t be reached right now' : '');
    }
    setText(statusText, text);
    status.setAttribute('data-mode', res.mode);
  }

  /* ---------- ticker tape ---------- */

  var tapeCount = -1;
  function renderTape() {
    if (!run1 || !run2 || !track) { return; }
    var html = state.items.map(function (it) {
      var ch = it.out ? '<span class="mk-t-out">SOLD OUT</span>' :
        it.ch.html ? '<span class="lc-' + it.ch.dir + '">' + it.ch.html + '</span>' : '';
      return '<li><span class="mk-t-sym">' + esc(it.sym) + '</span><span class="lc-sr"> ' + esc(it.name) + '</span> <span class="mk-t-p">' +
        esc(D.money(it.price)) + '</span> ' + ch + '</li>';
    }).join('');
    setHTML(run1, html);
    setHTML(run2, html);
    /* Speed from the run's width, set once per item count so a refresh never makes the tape jump. */
    if (tapeCount !== state.items.length) {
      tapeCount = state.items.length;
      var w = run1.offsetWidth, view = run1.parentNode.parentNode.clientWidth;
      tape.classList.toggle('is-still', !w || w <= view);
      track.style.setProperty('--mk-tape-s', Math.max(20, Math.round(w / 45)) + 's');
    }
  }
  if (tapeBtn) {
    tapeBtn.addEventListener('click', function () {
      var paused = tapeBtn.getAttribute('aria-pressed') !== 'true';
      tapeBtn.setAttribute('aria-pressed', paused ? 'true' : 'false');
      tape.classList.toggle('is-paused', paused);
    });
  }

  /* ---------- LCX index, breadth, sold out ---------- */

  /* The index's path over the last 24 hours: every in-stock item's price relative to 24 hours ago, averaged. */
  function indexSeries(list) {
    var use = list.filter(function (it) { return it.series.length >= 2; });
    if (!use.length) { return null; }
    var L = 49;
    use.forEach(function (it) { L = Math.min(L, it.series.length); });
    var out = [];
    for (var j = 0; j < L; j++) {
      var sum = 0;
      use.forEach(function (it) {
        var s = it.series, base = s[s.length - L];
        sum += base > 0 ? s[s.length - L + j] / base - 1 : 0;
      });
      out.push(1000 * (1 + sum / use.length));
    }
    return out;
  }

  function renderIndex() {
    var live = state.items.filter(function (it) { return !it.out; });
    var moved = live.filter(function (it) { return isNum(it.change24h); });
    var nOut = state.items.length - live.length;
    if (moved.length) {
      var avg = moved.reduce(function (a, it) { return a + it.change24h; }, 0) / moved.length;
      var val = 1000 * (1 + avg / 100), c = M.change(avg);
      setText(lcxNum, val.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
      lcxCh.className = 'mk-lcx-ch lc-' + c.dir;
      setHTML(lcxCh, c.html);
      var s = indexSeries(moved);
      if (lcxSpark) {
        lcxSpark.style.display = s ? '' : 'none';
        lcxSpark.setAttribute('class', 'mk-lcx-spark is-' + c.dir);
        if (s) { lcxLine.setAttribute('points', D.sparkPoints(s, 160, 40, 4)); }
      }
    } else {
      setText(lcxNum, '—');
      setHTML(lcxCh, '');
      if (lcxSpark) { lcxSpark.style.display = 'none'; }
    }
    var up = 0, down = 0;
    live.forEach(function (it) {
      if (it.ch.dir === 'up') { up++; } else if (it.ch.dir === 'down') { down++; }
    });
    var flat = live.length - up - down, n = live.length || 1;
    setText(bText.up, up + ' up');
    setText(bText.flat, flat + ' flat');
    setText(bText.down, down + ' down');
    bBar.up.style.width = (up / n * 100).toFixed(2) + '%';
    bBar.flat.style.width = (flat / n * 100).toFixed(2) + '%';
    bBar.down.style.width = (down / n * 100).toFixed(2) + '%';
    setText(outN, nOut ? nOut + plural(nOut, ' item', ' items') : 'None');
  }

  /* The LCX explainer: a disclosure. Escape or a click elsewhere closes it. */
  function setPop(open, focusBtn) {
    if (!info || !pop) { return; }
    info.setAttribute('aria-expanded', open ? 'true' : 'false');
    pop.hidden = !open;
    if (!open && focusBtn) { info.focus(); }
  }
  if (info && pop) {
    info.addEventListener('click', function () { setPop(info.getAttribute('aria-expanded') !== 'true', false); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !pop.hidden) { setPop(false, pop.contains(document.activeElement) || document.activeElement === info); }
    });
    document.addEventListener('click', function (e) {
      if (!pop.hidden && !pop.contains(e.target) && !info.contains(e.target)) { setPop(false, false); }
    });
  }

  /* ---------- sector tabs ---------- */

  var tabs = dict();
  function tabLabel(id) {
    if (id === 'watch') { return '<span class="mk-star" aria-hidden="true">★ </span>Watchlist'; }
    return esc(M.SECTOR_SHORT[id] || M.categoryLabel(id));
  }
  function syncTabs() {
    Object.keys(tabs).forEach(function (id) { tabs[id].setAttribute('aria-pressed', id === state.tab ? 'true' : 'false'); });
  }
  function renderTabs() {
    var present = dict();
    state.items.forEach(function (it) { present[it.sector] = true; });
    var ids = ['all'].concat(SECTORS.filter(function (s) { return present[s]; })).concat(['watch']);
    var active = document.activeElement, lost = false;
    if (ids.indexOf(state.tab) < 0) { state.tab = 'all'; }
    Object.keys(tabs).forEach(function (id) {
      if (ids.indexOf(id) > -1) { return; }
      if (tabs[id] === active) { lost = true; }
      tabs[id].parentNode.removeChild(tabs[id]);
      delete tabs[id];
    });
    ids.forEach(function (id, i) {
      var b = tabs[id];
      if (!b) {
        b = document.createElement('button');
        b.type = 'button';
        b.className = 'lc-chip';
        b.setAttribute('data-tab', id);
        b.innerHTML = tabLabel(id);
        tabs[id] = b;
      }
      if (tabBox.children[i] !== b) { tabBox.insertBefore(b, tabBox.children[i] || null); }
    });
    syncTabs();
    if (lost) { tabs.all.focus(); }
  }

  /* ---------- market list (and the select that replaces it at 760 px and below) ---------- */

  var rows = dict();
  function makeRow(id) {
    var li = document.createElement('li');
    li.innerHTML = '<button type="button" class="mk-row" aria-pressed="false"><span class="mk-row-id"><span class="mk-row-sym"></span>' +
      '<span class="mk-row-name"></span></span><span class="mk-row-price"></span><span class="mk-pill"></span></button>';
    var b = li.firstChild;
    b.setAttribute('data-id', id);
    return { li: li, btn: b, sym: b.querySelector('.mk-row-sym'), name: b.querySelector('.mk-row-name'), price: b.querySelector('.mk-row-price'), pill: b.querySelector('.mk-pill') };
  }
  function fillRow(r, it) {
    setText(r.sym, it.sym);
    setText(r.name, it.name);
    setText(r.price, D.money(it.price));
    var d = dirOf(it), html = pctHTML(it);
    r.pill.className = 'mk-pill mk-pill--' + d;
    r.pill.hidden = !html;
    setHTML(r.pill, html);
  }
  function put(node, ref) {
    if (list.moveBefore && node.parentNode === list) {
      try { list.moveBefore(node, ref); return; } catch (e) { /* fall back below */ }
    }
    list.insertBefore(node, ref);
  }

  function renderList() {
    var vis = visibleItems(), shown = dict(), keep = dict();
    var active = document.activeElement;
    state.items.forEach(function (it) {
      keep[it.id] = true;
      if (!rows[it.id]) { rows[it.id] = makeRow(it.id); }
      fillRow(rows[it.id], it);
    });
    Object.keys(rows).forEach(function (id) {
      if (keep[id]) { return; }
      if (rows[id].li.contains(active)) { active = find; }
      if (rows[id].li.parentNode) { rows[id].li.parentNode.removeChild(rows[id].li); }
      delete rows[id];
    });
    var cursor = list.firstChild;
    state.items.forEach(function (it) {
      var li = rows[it.id].li;
      if (li === cursor) { cursor = cursor.nextSibling; return; }
      put(li, cursor);
    });
    vis.forEach(function (it) { shown[it.id] = true; });
    Object.keys(rows).forEach(function (id) {
      var hide = !shown[id];
      if (hide && rows[id].li.contains(document.activeElement)) { active = find; }
      rows[id].li.hidden = hide;
    });
    markSelected();

    var n = vis.length, total = state.items.length;
    list.hidden = n === 0;
    listEmpty.hidden = n > 0;
    if (!n) { setText(listEmpty, emptyText(total)); }
    setText(listFoot, footText(n, total));
    renderPick(vis);
    if (active && active !== document.activeElement && document.contains(active)) {
      try { active.focus({ preventScroll: true }); } catch (e) { active.focus(); }
    }
    return vis;
  }

  function emptyText(total) {
    if (!total) { return 'Nothing is on the board right now. Check back soon.'; }
    var words = state.q.trim();
    if (state.tab === 'watch') {
      if (words) { return 'Nothing on your watchlist matches “' + words + '”.'; }
      return 'Your watchlist is empty. Pick an item and press Watch to keep it here.';
    }
    if (words && state.tab !== 'all') { return 'No item in ' + M.categoryLabel(state.tab) + ' matches “' + words + '”. Try another name, or pick All.'; }
    if (words) { return 'No item matches “' + words + '”. Try a symbol like IRON, or a name.'; }
    return 'Nothing in ' + M.categoryLabel(state.tab) + ' is on the board right now.';
  }
  function footText(n, total) {
    if (!total) { return ''; }
    if (state.res.mode === 'sample') {
      return D.SAMPLE_LABEL + ': showing ' + (n === total ? total : n + ' of ' + total) + ' sample ' + plural(total, 'item', 'items') +
        '. The live board lists every item the market carries.';
    }
    if (n === total) { return total === 1 ? 'Showing 1 item.' : 'Showing all ' + total + ' items.'; }
    return 'Showing ' + n + ' of ' + total + ' ' + plural(total, 'item', 'items') + '.';
  }

  function optionText(it) {
    var w = changeWords(it).replace(' today', '');
    return it.sym + ' · ' + it.name + ' · ' + D.money(it.price) + (w ? ', ' + w : '');
  }
  var pickKey = '';
  function renderPick(vis) {
    var inList = vis.some(function (it) { return it.id === state.sel; });
    var key = (inList ? '' : '+') + vis.map(function (it) { return it.id; }).join('|');
    if (key !== pickKey) {
      pickKey = key;
      var html = '';
      if (!vis.length) {
        html = '<option value="">No items match</option>';
      } else if (!inList) {
        html = '<option value="" disabled>Choose from ' + vis.length + ' ' + plural(vis.length, 'match', 'matches') + '</option>';
      }
      html += vis.map(function (it) { return '<option value="' + esc(it.id) + '"></option>'; }).join('');
      pick.innerHTML = html;
    }
    var opts = pick.options;
    for (var i = 0; i < opts.length; i++) {
      var it = state.byId[opts[i].value];
      if (it) { setText(opts[i], optionText(it)); }
    }
    pick.value = inList ? state.sel : '';
    if (!inList && pick.options.length) { pick.selectedIndex = 0; }
  }

  function markSelected() {
    Object.keys(rows).forEach(function (id) { rows[id].btn.setAttribute('aria-pressed', id === state.sel ? 'true' : 'false'); });
    Object.keys(tiles).forEach(function (id) { tiles[id].btn.setAttribute('aria-pressed', id === state.sel ? 'true' : 'false'); });
  }

  /* Keep the chosen row in view inside the list's own scroll, never scrolling the page. */
  function revealRow(id, middle) {
    var r = rows[id];
    if (!r || r.li.hidden || list.hidden || list.scrollHeight <= list.clientHeight + 1) { return; }
    var lr = list.getBoundingClientRect(), rr = r.li.getBoundingClientRect();
    if (middle && (rr.top < lr.top || rr.bottom > lr.bottom)) { list.scrollTop += (rr.top + rr.bottom) / 2 - (lr.top + lr.bottom) / 2; }
    else if (rr.top < lr.top) { list.scrollTop -= lr.top - rr.top; }
    else if (rr.bottom > lr.bottom) { list.scrollTop += rr.bottom - lr.bottom; }
  }

  /* ---------- the selected item ---------- */

  function renderQuote() {
    var it = state.byId[state.sel];
    center.hidden = !it;
    if (!it) { return; }
    setText(qv.sym, it.sym);
    setText(qv.name, it.name);
    setText(qv.sector, M.categoryLabel(it.sector));
    setText(qv.price, D.money(it.price));
    var ch = qv.change;
    if (it.out) {
      ch.className = 'mk-q-ch is-out';
      setHTML(ch, 'Sold out');
    } else if (it.ch.html) {
      var delta = isNum(it.price) && isNum(it.change24h) && it.change24h > -100 ? it.price - it.price / (1 + it.change24h / 100) : null;
      ch.className = 'mk-q-ch lc-' + it.ch.dir;
      setHTML(ch, it.ch.html + (delta !== null && it.ch.dir !== 'flat' ? ' (' + esc(signed(delta)) + ')' : '') + ' <span class="mk-q-today">today</span>');
    } else {
      ch.className = 'mk-q-ch';
      setHTML(ch, '');
    }
    watchBtn.setAttribute('aria-pressed', state.watch[it.id] ? 'true' : 'false');
    if (linkBtn) { linkBtn.setAttribute('data-lc-copy', itemURL(it.id)); }
    tfBtns.forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-tf') === state.tf ? 'true' : 'false'); });
    if (openLabel) { setText(openLabel, 'Open (' + state.tf + ')'); }
    renderChart(it);
    renderStock(it);
    renderStats(it);
    renderTrade(it);
  }

  var chartW = 0;
  function boxWidth(el, fallback) {
    var w = el.getBoundingClientRect().width;
    return w > 40 ? Math.round(w) : fallback;
  }

  function renderChart(it) {
    var hist = rangeHist(it), vals = hist.map(function (h) { return h.p; });
    var has = vals.length >= 2;
    chartBox.hidden = !has;
    axis.hidden = !has;
    noHist.hidden = has;
    if (!has) { setHTML(gLabels, ''); return; }
    var W = boxWidth(svg, 480), H = Math.round(chartBox.clientHeight) || 280;
    chartW = W;
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    var pad = (hi - lo) * 0.12 || (Math.abs(it.price || lo) || 1) * 0.02;
    var cmin = lo - pad, cmax = hi + pad, span = cmax - cmin;
    function y(v) { return H - 6 - (v - cmin) / span * (H - 16); }
    var pts = vals.map(function (v, i) { return (i * W / (vals.length - 1)).toFixed(1) + ',' + y(v).toFixed(1); }).join(' ');
    var step = span * 0.25, dec = 2;
    while (dec < 4 && step < 2 * Math.pow(10, -dec)) { dec++; }
    var grid = [0.2, 0.45, 0.7, 0.95].map(function (f) { var v = cmax - f * span; return { v: v, y: y(v) }; });
    var first = vals[0], last = vals[vals.length - 1];
    var dir = it.out ? 'flat' : last > first ? 'up' : last < first ? 'down' : 'flat';
    svg.setAttribute('class', 'mk-chart-svg is-' + dir);
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.innerHTML =
      '<path class="mk-c-grid" d="' + grid.map(function (g) { return 'M0 ' + g.y.toFixed(1) + 'H' + W; }).join(' ') + '"></path>' +
      '<polygon class="mk-c-area" points="0,' + H + ' ' + pts + ' ' + W + ',' + H + '"></polygon>' +
      '<polyline class="mk-c-line" points="' + pts + '"></polyline>' +
      '<circle class="mk-c-dot" cx="' + W + '" cy="' + y(last).toFixed(1) + '" r="4"></circle>';
    setHTML(gLabels, grid.map(function (g) {
      return '<span style="top:' + (g.y - 8).toFixed(1) + 'px">' + esc(fixed(g.v, dec)) + '</span>';
    }).join(''));

    var hrs = spanHours(hist);
    setText(ax.start, hrs + 'h ago');
    setText(ax.mid, hrs >= 2 ? Math.round(hrs / 2) + 'h ago' : '');
    var label = 'Price of ' + it.name + ' over the last ' + hoursText(hrs) + ': ';
    label += lo === hi ? fine(lo) + ' the whole time.' :
      'from ' + fine(first) + ' to ' + fine(last) + '; low ' + fine(lo) + ', high ' + fine(hi) + '.';
    svg.setAttribute('aria-label', label);
  }

  /* Stock on the shelf per snapshot (history[].s), scaled to a full shelf when the feed says how big it is. */
  function renderStock(it) {
    var hist = rangeHist(it);
    var s = hist.map(function (h) { return isNum(h.s) ? Math.max(0, h.s) : 0; });
    var any = s.some(function (v) { return v > 0; });
    var ok = s.length >= 2 && (any || it.out);
    sb.hidden = !ok;
    if (!ok) { return; }
    var W = chartW || boxWidth(sbSvg, 480), H = 60;
    /* Bars start at zero and the fullest snapshot in range fills the height, so the moves show;
       the label gives the full shelf size. */
    var top = Math.max.apply(null, s), smax = top * 1.04 || 1;
    var bw = W / s.length, gap = bw > 6 ? 2 : bw > 3 ? 1 : 0.5;
    var bars = '', lastBar = '';
    s.forEach(function (v, i) {
      var h = v > 0 ? Math.max(1.5, Math.min(1, v / smax) * (H - 4)) : 0;
      if (!h) { return; }
      var d = 'M' + (i * bw + gap / 2).toFixed(1) + ' ' + (H - h).toFixed(1) + 'h' + Math.max(0.5, bw - gap).toFixed(1) + 'V' + H + 'H' + (i * bw + gap / 2).toFixed(1) + 'Z';
      if (i === s.length - 1) { lastBar = d; } else { bars += d; }
    });
    sbSvg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    sbSvg.setAttribute('preserveAspectRatio', 'none');
    sbSvg.innerHTML = '<rect class="mk-sb-base" x="0" y="' + (H - 1) + '" width="' + W + '" height="1"></rect>' +
      (bars ? '<path class="mk-sb-bars" d="' + bars + '"></path>' : '') + (lastBar ? '<path class="mk-sb-last" d="' + lastBar + '"></path>' : '');
    var now = isNum(it.stock) ? it.stock : s[s.length - 1];
    var lo = Math.min.apply(null, s);
    setText(sbNow, 'Now ' + D.count(now) + (it.maxStock ? ' of ' + D.count(it.maxStock) : ''));
    sbSvg.setAttribute('aria-label', 'Stock on the shelf over the last ' + hoursText(spanHours(hist)) + ': ' + D.count(now) + ' now' +
      (it.maxStock ? ' of a full shelf of ' + D.count(it.maxStock) : '') + (lo === top ? '.' : ', between ' + D.count(lo) + ' and ' + D.count(top) + '.'));
  }

  function setStat(key, html, warn) {
    var st = stats[key];
    if (!st) { return; }
    st.box.hidden = html === null;
    if (html === null) { return; }
    setHTML(st.dd, html);
    if (warn !== undefined) { st.dd.classList.toggle('mk-warn', !!warn); }
  }
  function renderStats(it) {
    var vals = rangeHist(it).map(function (h) { return h.p; });
    var has = vals.length >= 1;
    setStat('open', has ? esc(fine(vals[0])) : null);
    setStat('high', has ? esc(fine(Math.max.apply(null, vals))) : null);
    setStat('low', has ? esc(fine(Math.min.apply(null, vals))) : null);
    var spreadOk = isNum(it.buy) && isNum(it.sell) && isNum(it.price) && it.price > 0;
    setStat('spread', spreadOk ? ((it.buy - it.sell) / it.price * 100).toFixed(1) + '%' : null);
    setStat('buy', it.out ? '<span aria-hidden="true">—</span><span class="lc-sr">none, sold out</span>' : isNum(it.buy) ? esc(fine(it.buy)) : null, it.out);
    setStat('sell', isNum(it.sell) ? esc(fine(it.sell)) : null);
    setStat('stock', it.out ? 'None' : isNum(it.stock) ? esc(D.count(it.stock)) : null, it.out);
    var shelf = null;
    if (it.out) { shelf = 'Empty'; }
    else if (it.frac !== null) {
      var p = Math.round(it.frac * 100);
      shelf = (p === 0 && it.frac > 0 ? 'Under 1%' : p + '%') + ' full';
    }
    setStat('shelf', shelf, it.out || (it.frac !== null && it.frac < 0.25));
  }

  function renderTrade(it) {
    setText(qv.buyName, it.name);
    setText(qv.sellName, it.name);
    setText(qv.buyNote, it.out ? 'Nobody can buy it until someone sells one in.' : 'At any PC: Crate store. Pick a shipping speed; it waits in your Locker.');
    setText(qv.sellNote, isNum(it.sell) ? 'At any PC: Sell to Crate. Paid instantly at ' + fine(it.sell) + ' each right now.' : 'At any PC: Sell to Crate. Paid instantly.');
    buyBox.hidden = false;
    sellBox.hidden = false;
  }

  /* ---------- movers and sectors ---------- */

  function fillMovers(ul, none, picks) {
    var active = document.activeElement, lost = false;
    while (ul.children.length > picks.length) {
      var last = ul.lastChild;
      if (last.contains(active)) { lost = true; }
      ul.removeChild(last);
    }
    picks.forEach(function (it, i) {
      var li = ul.children[i];
      if (!li) {
        li = document.createElement('li');
        li.innerHTML = '<button type="button" class="mk-mrow"></button>';
        ul.appendChild(li);
      }
      var b = li.firstChild;
      b.setAttribute('data-id', it.id);
      setHTML(b, '<span class="mk-m-sym">' + esc(it.sym) + '<span class="lc-sr"> ' + esc(it.name) + '</span></span><span class="mk-m-p">' +
        esc(D.money(it.price)) + '</span><span class="mk-m-ch lc-' + it.ch.dir + '">' + pctHTML(it) + '</span>');
    });
    ul.hidden = !picks.length;
    none.hidden = picks.length > 0;
    if (lost) { (ul.lastChild ? ul.lastChild.firstChild : find).focus(); }
  }
  function renderMovers() {
    var live = state.items.filter(function (it) { return !it.out && isNum(it.change24h); });
    var byName = function (a, b) { return a.name.localeCompare(b.name); };
    var up = live.filter(function (it) { return it.ch.dir === 'up'; })
      .sort(function (a, b) { return b.change24h - a.change24h || byName(a, b); }).slice(0, 5);
    var down = live.filter(function (it) { return it.ch.dir === 'down'; })
      .sort(function (a, b) { return a.change24h - b.change24h || byName(a, b); }).slice(0, 5);
    fillMovers(gainUl, gainNone, up);
    fillMovers(loseUl, loseNone, down);
  }

  function renderSectors() {
    var rowsOut = [];
    SECTORS.forEach(function (s) {
      var its = state.items.filter(function (it) { return it.sector === s && !it.out && isNum(it.change24h); });
      if (!its.length) { return; }
      rowsOut.push({ id: s, avg: its.reduce(function (a, it) { return a + it.change24h; }, 0) / its.length });
    });
    var maxAbs = rowsOut.reduce(function (m, r) { return Math.max(m, Math.abs(r.avg)); }, 0);
    setHTML(secUl, rowsOut.map(function (r) {
      var dir = M.change(r.avg).dir;
      var w = maxAbs > 0 ? 6 + 94 * Math.abs(r.avg) / maxAbs : 6;
      return '<li><span class="mk-sec-name">' + esc(M.categoryLabel(r.id)) + '</span><span class="mk-sec-bar" aria-hidden="true"><span class="lc-' + dir +
        '" style="width:' + w.toFixed(1) + '%"></span></span><span class="mk-sec-ch lc-' + dir + '">' + avgHTML(r.avg) + '</span></li>';
    }).join(''));
  }

  /* ---------- heatmap ---------- */

  var tiles = dict();
  function heatClass(it) {
    if (it.out) { return 'out'; }
    var c = it.change24h;
    if (!isNum(c) || it.ch.dir === 'flat') { return 'flat'; }
    if (c >= 5) { return 'up3'; }
    if (c >= 2) { return 'up2'; }
    if (c > 0) { return 'up1'; }
    if (c > -2) { return 'dn1'; }
    if (c > -4) { return 'dn2'; }
    return 'dn3';
  }
  function renderHeat() {
    var keep = dict(), active = document.activeElement, lost = false;
    state.items.forEach(function (it, i) {
      keep[it.id] = true;
      var t = tiles[it.id];
      if (!t) {
        var li = document.createElement('li');
        li.innerHTML = '<button type="button" class="mk-tile" aria-pressed="false"></button>';
        t = tiles[it.id] = { li: li, btn: li.firstChild };
        t.btn.setAttribute('data-id', it.id);
      }
      t.btn.className = 'mk-tile mk-h-' + heatClass(it);
      setHTML(t.btn, '<span class="mk-tile-top"><span class="mk-tile-sym">' + esc(it.sym) + '</span><span class="mk-tile-name">' + esc(it.name) +
        '</span></span><span class="mk-tile-row"><span class="mk-tile-p">' + esc(D.money(it.price)) + '</span><span>' + pctHTML(it) + '</span></span>');
      if (heatUl.children[i] !== t.li) { heatUl.insertBefore(t.li, heatUl.children[i] || null); }
    });
    Object.keys(tiles).forEach(function (id) {
      if (keep[id]) { return; }
      if (tiles[id].li.contains(active)) { lost = true; }
      if (tiles[id].li.parentNode) { tiles[id].li.parentNode.removeChild(tiles[id].li); }
      delete tiles[id];
    });
    if (lost) {
      var first = heatUl.querySelector('button');
      (first || find).focus();
    }
  }

  /* ---------- What's my stuff worth? ---------- */

  var calcForm = q('[data-mk-calc-form]'), calcItem = q('[data-mk-calc-item]'), calcQty = q('[data-mk-calc-qty]');
  var calcUnit = q('[data-mk-calc-unit]'), calcErr = q('[data-mk-calc-err]'), calcTable = q('[data-mk-calc-table]');
  var calcRows = q('[data-mk-calc-rows]'), calcTotal = q('[data-mk-calc-total]'), calcEmpty = q('[data-mk-calc-empty]');
  var calcKey = '', calcTouched = false, lineRows = dict();

  function sellable() {
    return state.items.filter(function (it) { return isNum(it.sell) && it.sell >= 0; })
      .sort(function (a, b) { return a.name.localeCompare(b.name); });
  }
  function amountText(n) { return D.count(n) + plural(n, ' item', ' items'); }
  function stacksText(n) {
    if (n < STACK) { return ''; }
    var st = Math.floor(n / STACK), rest = n % STACK;
    return st + plural(st, ' stack', ' stacks') + (rest ? ' + ' + rest : '');
  }
  function lineWorth(l) {
    var it = state.byId[l.id];
    return it && isNum(it.sell) ? l.n * it.sell : null;
  }
  function calcTotalValue() {
    return state.lines.reduce(function (a, l) { var w = lineWorth(l); return w === null ? a : a + w; }, 0);
  }

  function renderCalcOptions() {
    var opts = sellable();
    var key = opts.map(function (it) { return it.id; }).join('|');
    var keepVal = calcItem.value;
    if (key !== calcKey) {
      calcKey = key;
      calcItem.innerHTML = opts.map(function (it) { return '<option value="' + esc(it.id) + '"></option>'; }).join('');
    }
    for (var i = 0; i < calcItem.options.length; i++) {
      var it = state.byId[calcItem.options[i].value];
      if (it) { setText(calcItem.options[i], it.name + ' (' + it.sym + ') · ' + fine(it.sell) + ' each'); }
    }
    var want = calcTouched ? keepVal : state.sel;
    if (!want || !state.byId[want] || !isNum(state.byId[want].sell)) { want = keepVal && state.byId[keepVal] ? keepVal : opts.length ? opts[0].id : ''; }
    calcItem.value = want;
    calcItem.disabled = !opts.length;
  }

  function makeLineRow(id) {
    var tr = document.createElement('tr');
    tr.setAttribute('role', 'row');
    tr.innerHTML = '<td role="cell" class="mk-ci"></td><td role="cell" class="mk-cn mk-ca"></td><td role="cell" class="mk-cn mk-ce"></td>' +
      '<td role="cell" class="mk-cn mk-cw"></td><td role="cell" class="mk-cx"><button type="button" class="mk-rm">Remove<span class="lc-sr"></span></button></td>';
    tr.setAttribute('data-id', id);
    var td = tr.children;
    return { tr: tr, item: td[0], amt: td[1], each: td[2], worth: td[3], rm: tr.querySelector('.mk-rm'), rmName: tr.querySelector('.mk-rm .lc-sr') };
  }

  function renderCalc() {
    renderCalcOptions();
    var active = document.activeElement, keep = dict();
    state.lines.forEach(function (l, i) {
      keep[l.id] = true;
      var r = lineRows[l.id] || (lineRows[l.id] = makeLineRow(l.id));
      var it = state.byId[l.id];
      if (it) { l.name = it.name; }
      var name = it ? it.name : (l.name || l.id);
      var w = lineWorth(l), st = stacksText(l.n);
      setHTML(r.item, '<span class="mk-ci-name">' + esc(name) + '</span>' + (it ? '<span class="mk-ci-sub">' + esc(it.sym) + '</span>' :
        '<span class="mk-ci-gone">Not on the market right now</span>'));
      setHTML(r.amt, esc(amountText(l.n)) + (st ? '<span class="mk-ci-sub">' + esc(st) + '</span>' : ''));
      setHTML(r.each, w === null ? '<span aria-hidden="true">—</span><span class="lc-sr">no price</span>' : esc(fine(it.sell)) + '<span class="mk-k"> each</span>');
      setHTML(r.worth, w === null ? '<span aria-hidden="true">—</span><span class="lc-sr">not counted</span>' : esc(D.money(w)));
      setText(r.rmName, ' ' + name);
      if (calcRows.children[i] !== r.tr) { calcRows.insertBefore(r.tr, calcRows.children[i] || null); }
    });
    Object.keys(lineRows).forEach(function (id) {
      if (keep[id]) { return; }
      if (lineRows[id].tr.parentNode) { lineRows[id].tr.parentNode.removeChild(lineRows[id].tr); }
      delete lineRows[id];
    });
    var n = state.lines.length;
    calcTable.hidden = !n;
    calcEmpty.hidden = n > 0;
    setText(calcTotal, D.money(calcTotalValue()));
    if (active && active !== document.activeElement && document.contains(active)) { active.focus(); }
  }

  /* msg for the amount field (marked invalid), or for the list as a whole (notAmount) */
  function calcError(msg, notAmount) {
    setText(calcErr, msg);
    if (msg && !notAmount) { calcQty.setAttribute('aria-invalid', 'true'); } else { calcQty.removeAttribute('aria-invalid'); }
    if (msg && notAmount) { announce(msg); }
  }
  function totalWords() {
    return state.lines.length ? 'Total ' + D.money(calcTotalValue()) + '.' : 'The list is empty.';
  }

  if (calcForm) {
    calcItem.addEventListener('change', function () { calcTouched = true; });
    calcQty.addEventListener('input', function () { if (calcErr.textContent) { calcError(''); } });
    calcForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var it = state.byId[calcItem.value];
      if (!it || !isNum(it.sell)) { return; }
      var raw = String(calcQty.value || '').replace(/[,\s]/g, '');
      var qty = /^\d+$/.test(raw) ? parseInt(raw, 10) : NaN;
      if (!(qty >= 1 && qty <= MAX_QTY)) {
        calcError('Type a whole number from 1 to ' + D.count(MAX_QTY) + '.');
        calcQty.focus();
        return;
      }
      calcError('');
      calcTouched = true;
      var add = qty * (calcUnit.value === String(STACK) ? STACK : 1);
      var line = null;
      state.lines.forEach(function (l) { if (l.id === it.id) { line = l; } });
      if (!line) {
        if (state.lines.length >= MAX_LINES) {
          calcError('That’s a long list. Remove a line to add another.', true);
          return;
        }
        line = { id: it.id, n: 0, name: it.name };
        state.lines.push(line);
      }
      line.n = Math.min(MAX_COUNT, line.n + add);
      saveLines();
      renderCalc();
      announce('Added ' + amountText(add) + ' of ' + it.name + ', worth ' + D.money(add * it.sell) + '. ' + totalWords());
    });
    calcRows.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('.mk-rm') : null;
      if (!b) { return; }
      var tr = b.closest('tr'), id = tr.getAttribute('data-id');
      var idx = -1;
      state.lines.forEach(function (l, i) { if (l.id === id) { idx = i; } });
      if (idx < 0) { return; }
      var name = (state.byId[id] && state.byId[id].name) || state.lines[idx].name || id;
      state.lines.splice(idx, 1);
      saveLines();
      renderCalc();
      var next = state.lines[idx] || state.lines[idx - 1];
      if (next && lineRows[next.id]) { lineRows[next.id].rm.focus(); } else { calcItem.focus(); }
      announce('Removed ' + name + '. ' + totalWords());
    });
  }

  /* ---------- selecting ---------- */

  function headerBottom() {
    var h = document.querySelector('[data-lc-header]');
    return h ? Math.max(0, h.getBoundingClientRect().bottom) : 0;
  }
  /* From the heatmap or the movers, bring the chart into view when it's off screen. */
  function showQuote() {
    var vh = window.innerHeight || document.documentElement.clientHeight;
    var box = chartBox.hidden ? quote : chartBox, r = box.getBoundingClientRect(), mid = (r.top + r.bottom) / 2;
    if (mid > headerBottom() && mid < vh) { return; }
    try { quote.scrollIntoView({ block: 'start', behavior: stillMotion() ? 'auto' : 'smooth' }); } catch (e) { quote.scrollIntoView(true); }
  }

  function select(id, how) {
    var it = state.byId[id];
    if (!it) { return; }
    state.sel = id;
    state.picked = true;
    state.wanted = '';
    putURL(id);
    markSelected();
    renderQuote();
    renderPick(visibleItems());
    if (!calcTouched) { renderCalcOptions(); }
    revealRow(id);
    if (how === 'jump') { showQuote(); }
    if (how !== 'pick') {
      var words = changeWords(it);
      announce(it.name + ', ' + D.money(it.price) + (words ? ', ' + words : '') + '.');
    }
  }

  /* ---------- putting it together ---------- */

  function renderAll() {
    renderStatus();
    var has = state.items.length > 0;
    root.setAttribute('data-state', has ? 'ready' : 'empty');
    ensureSelection();
    renderTabs();
    renderList();
    if (has) {
      renderTape();
      renderIndex();
      renderQuote();
      renderMovers();
      renderSectors();
      renderHeat();
      markSelected();
    }
    renderCalc();
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
    if (state.res) { sayCount(renderList().length); }
  });
  tabBox.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('button[data-tab]') : null;
    if (!b) { return; }
    state.tab = b.getAttribute('data-tab');
    syncTabs();
    if (state.res) { sayCount(renderList().length); }
  });
  list.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('button.mk-row') : null;
    if (b) { select(b.getAttribute('data-id'), 'list'); }
  });
  /* Up and Down move between rows, as well as Tab */
  list.addEventListener('keydown', function (e) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') { return; }
    var btns = [].filter.call(list.querySelectorAll('button.mk-row'), function (b) { return !b.parentNode.hidden; });
    var i = btns.indexOf(document.activeElement);
    if (i < 0) { return; }
    var next = btns[i + (e.key === 'ArrowDown' ? 1 : -1)];
    if (next) { e.preventDefault(); next.focus(); }
  });
  pick.addEventListener('change', function () { if (pick.value) { select(pick.value, 'pick'); } });
  heatUl.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('button.mk-tile') : null;
    if (b) { select(b.getAttribute('data-id'), 'jump'); }
  });
  [gainUl, loseUl].forEach(function (ul) {
    ul.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('button.mk-mrow') : null;
      if (b) { select(b.getAttribute('data-id'), 'jump'); }
    });
  });
  rangeBox.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('.mk-tf') : null;
    if (!b || b.getAttribute('aria-disabled') === 'true' || !b.hasAttribute('data-tf')) { return; }
    state.tf = b.getAttribute('data-tf');
    if (state.res) { renderQuote(); }
  });
  watchBtn.addEventListener('click', function () {
    var it = state.byId[state.sel];
    if (!it) { return; }
    var on = !state.watch[it.id];
    if (on) { state.watch[it.id] = true; } else { delete state.watch[it.id]; }
    saveWatch();
    watchBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    announce(on ? it.name + ' is on your watchlist.' : it.name + ' is off your watchlist.');
    if (state.tab === 'watch') { renderList(); }
  });

  /* Redraw the chart when its width changes (window resize, the layout switching columns) */
  var resizeTimer = null;
  function onResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      var it = state.byId[state.sel];
      if (!it || center.hidden) { return; }
      if (Math.abs(boxWidth(svg, chartW) - chartW) >= 1) { renderChart(it); renderStock(it); }
    }, 80);
  }
  if (window.ResizeObserver) { new ResizeObserver(onResize).observe(chartBox); } else { window.addEventListener('resize', onResize); }

  D.watch('market', function (res) {
    var first = !state.res;
    state.res = res;
    ingest(res.data);
    renderAll();
    /* A shared link (?item=) scrolls the list to its item */
    if (first && state.sel && state.sel === urlItem()) { revealRow(state.sel, true); }
  });
})();
