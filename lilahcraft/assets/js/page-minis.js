/* LilahCraft Minis page: the hero's stat tiles, the filters, the card grid and the Holiday Minis rows, from
   LCData ('minis'). Cards are built once per Mini (and again only if that Mini changes) and only when first shown;
   a long list shows PAGE cards at a time with a "Show more Minis" button. The category filter lists the feed's
   own categories, so there are no dead choices.
   Feed text goes in with textContent only. The feed has no owners and none are shown. */
(function () {
  'use strict';
  var D = window.LCData;
  var root = document.querySelector('[data-mn-finder]');
  if (!D || !D.minis || !root) { return; }
  var M = D.minis;
  var LC = window.LC || {};
  var PAGE = 48;

  function $(sel, scope) { return (scope || document).querySelector(sel); }
  function announce(text) { if (LC.announce) { LC.announce(text); } }

  var ui = {
    find: $('[data-mn-find]', root),
    cat: $('[data-mn-cat]', root),
    hide: $('[data-mn-hide]', root),
    chips: [].slice.call(root.querySelectorAll('[data-mn-rarity]')),
    note: $('[data-mn-note]', root),
    grid: $('[data-mn-grid]', root),
    empty: $('[data-mn-empty]', root),
    more: $('[data-mn-more]', root),
    moreBtn: $('[data-mn-more-btn]', root),
    count: $('[data-mn-count]', root),
    stats: $('[data-mn-stats]'),
    statNote: $('[data-mn-statnote]'),
    hol: $('[data-mn-hol]'),
    holList: $('[data-mn-hol-list]'),
    holNote: $('.lc-mn-hol-note')
  };

  var state = { q: '', cat: 'all', hide: false, rarity: 'all', limit: PAGE };
  var all = [];       // the Minis, in display order
  var cards = {};     // card key -> <li>
  var loaded = false;
  var shownCount = 0;

  /* ---------- data ---------- */

  function prettyId(id) {
    var s = String(id || '').replace(/[_:\-]+/g, ' ').trim();
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
  }

  /* ---------- holiday Minis ----------
     A holiday Mini is earned at its event, never printed. HomeCraftMgmt 0.38.8 marks one eventOnly, with earnFrom and
     earnTo (the first and the last millisecond it can be earned) when it has the dates; an older feed only has its
     series, the Holiday Collection. Its days are the server's, so they are written in US Central time. */

  var HOLIDAY_SERIES = 'holiday collection';
  var ZONE = 'America/Chicago';
  var dayFmt = null;

  /* { from, to } (both ms, or both null) for a holiday Mini, null for any other. */
  function holidayOf(m) {
    if (m.eventOnly !== true && String(m.series || '').trim().toLowerCase() !== HOLIDAY_SERIES) { return null; }
    var ok = D.isNum(m.earnFrom) && D.isNum(m.earnTo) && m.earnFrom > 0 && m.earnTo >= m.earnFrom;
    return { from: ok ? m.earnFrom : null, to: ok ? m.earnTo : null };
  }

  /* { day: '22', month: 'Nov', year: '2026' } in the server's zone (the visitor's if the browser has no time zones). */
  function dayParts(ms) {
    if (!dayFmt) {
      try {
        dayFmt = new Intl.DateTimeFormat('en-US', { timeZone: ZONE, day: 'numeric', month: 'short', year: 'numeric' });
      } catch (e) {
        dayFmt = new Intl.DateTimeFormat('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
      }
    }
    var p = {};
    if (dayFmt.formatToParts) {
      dayFmt.formatToParts(new Date(ms)).forEach(function (x) { p[x.type] = x.value; });
    } else {
      var d = new Date(ms);
      p = { day: String(d.getDate()), month: d.toLocaleDateString('en-US', { month: 'short' }), year: String(d.getFullYear()) };
    }
    return p;
  }

  /* "22–29 Nov 2026", "28 Nov – 3 Dec 2026", "28 Dec 2026 – 3 Jan 2027", "22 Nov 2026". A date never breaks
     across lines (no-break spaces inside it, and a word joiner after the dash in "22–29"). */
  var NB = '\u00a0';
  function dayRange(from, to) {
    var a = dayParts(from), b = dayParts(to);
    if (a.year !== b.year) { return a.day + NB + a.month + NB + a.year + ' – ' + b.day + NB + b.month + NB + b.year; }
    if (a.month !== b.month) { return a.day + NB + a.month + ' – ' + b.day + NB + b.month + NB + b.year; }
    if (a.day !== b.day) { return a.day + '–\u2060' + b.day + NB + b.month + NB + b.year; }
    return a.day + NB + a.month + NB + a.year;
  }
  function dayText(ms) {
    var p = dayParts(ms);
    return p.day + NB + p.month;
  }

  /* "0 of 20 earned": a holiday Mini is never printed. */
  function earnedText(s) {
    if (!D.isNum(s.printed)) { return ''; }
    return s.cap > 0 ? D.count(s.printed) + ' of ' + D.count(s.cap) + ' earned' : D.count(s.printed) + ' earned';
  }

  function prepare(list) {
    var seen = {};
    var out = (Array.isArray(list) ? list : []).filter(function (m) { return m && typeof m === 'object'; }).map(function (m, i) {
      var name = String(m.name == null ? '' : m.name).trim() || prettyId(m.id) || 'Mini';
      var rkey = M.rarityKey(m.rarity);
      var hol = holidayOf(m);
      // Everything the card shows, so a changed Mini gets a fresh card on the next refresh.
      var sig = [m.id, name, rkey, m.cap, m.printed, m.soldOut, m.skin || '', m._art || '',
        hol ? 'hol' : '', hol && hol.from, hol && hol.to].join('|');
      var key = sig;
      if (seen[sig]) { key = sig + '#' + seen[sig]; }
      seen[sig] = (seen[sig] || 0) + 1;
      return { key: key, name: name, lname: name.toLowerCase(), rkey: rkey, rank: M.RARITY_ORDER.indexOf(rkey), cat: M.categoryOf(m),
        sold: M.soldOut(m), hol: hol, src: m, i: i };
    });
    // Common to Legendary, then by name ("Mini 2" before "Mini 10").
    out.sort(function (a, b) {
      return (a.rank - b.rank) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }) || (a.i - b.i);
    });
    return out;
  }

  /* ---------- stats and labels ---------- */

  function setStats(list) {
    var printed = 0, sold = 0;
    list.forEach(function (m) {
      if (D.isNum(m.src.printed) && m.src.printed > 0) { printed += m.src.printed; }
      if (m.sold) { sold++; }
    });
    var vals = { total: list.length, printed: printed, sold: sold };
    [].forEach.call(document.querySelectorAll('[data-mn-stat]'), function (dd) {
      var v = vals[dd.getAttribute('data-mn-stat')];
      dd.textContent = D.isNum(v) ? D.count(v) : '';
    });
    if (ui.stats) { ui.stats.removeAttribute('aria-busy'); }
  }

  function setLabels(res) {
    var d = res.data || {};
    var when = D.timeText(d.fetchedAt || d.generatedAt);
    var head = '', grid = '';
    if (res.mode === 'sample') {
      head = D.SAMPLE_LABEL;
      grid = D.SAMPLE_LABEL + ': ' + (all.length === 1 ? 'one example Mini' : D.count(all.length) + ' example Minis') + ', not the real list.';
      if (res.unreachable) {
        head += ' · the live feed can’t be reached right now';
        grid += ' The live feed can’t be reached right now.';
      }
    } else if (res.mode === 'stale') {
      head = 'Last known list' + (when ? ' · ' + when : '');
      grid = 'The live feed can’t be reached right now, so this is the last known list' + (when ? ', from ' + when : '') + '.';
    }
    if (ui.statNote) {
      ui.statNote.textContent = head;
      ui.statNote.hidden = !head;
    }
    ui.note.textContent = grid;
    ui.note.hidden = !grid;
  }

  /* The feed's own categories, in the server's order, and nothing else; the chosen one stays (last) even if it
     just left the feed, so a refresh never changes the filter under the reader. */
  function updateCategories(data) {
    var sel = ui.cat;
    var have = {};
    [].forEach.call(sel.options, function (o) { have[o.value] = o; });
    var cats = M.categories(data);
    if (state.cat !== 'all' && cats.indexOf(state.cat) === -1) { cats.push(state.cat); }
    var order = ['all'].concat(cats);
    order.forEach(function (v, i) {
      var o = have[v];
      if (!o) {
        o = document.createElement('option');
        o.value = v;
        o.textContent = M.categoryLabel(v);
      }
      if (sel.options[i] !== o) { sel.insertBefore(o, sel.options[i] || null); }
    });
    while (sel.options.length > order.length) { sel.removeChild(sel.options[sel.options.length - 1]); }
    sel.value = state.cat;
  }

  /* ---------- cards ---------- */

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) { e.className = cls; }
    if (text != null) { e.textContent = text; }
    return e;
  }

  /* Scarcity: a capped Mini that isn't sold out, with cap - printed <= max(3, ceil(cap / 10)) left.
     Returns how many are left, or 0 when there's nothing to say. */
  function leftOf(m) {
    var s = m.src;
    if (m.sold || !D.isNum(s.cap) || s.cap <= 0 || !D.isNum(s.printed)) { return 0; }
    var left = Math.floor(s.cap - s.printed);
    return left > 0 && left <= Math.max(3, Math.ceil(s.cap * 0.1)) ? left : 0;
  }

  function buildCard(m) {
    var li = el('li', 'lc-mn-card lc-r--' + m.rkey + (m.hol ? ' lc-mn-card--hol' : ''));
    li.appendChild(M.head(m.src));
    li.appendChild(el('p', 'lc-mn-name', m.name));
    var pills = el('p', 'lc-mn-pills');
    pills.appendChild(el('span', 'lc-rarity', M.RARITIES[m.rkey].name));
    if (m.sold) { pills.appendChild(el('span', 'lc-pill lc-pill--dark', 'Sold out')); }
    var left = leftOf(m);
    if (left) { pills.appendChild(el('span', 'lc-pill lc-mn-left', 'Only ' + D.count(left) + ' left')); }
    li.appendChild(pills);
    // "Holiday Mini · earned 22–29 Nov 2026": what explains a holiday Mini's empty count.
    if (m.hol) {
      li.appendChild(el('p', 'lc-mn-event', 'Holiday Mini' + (m.hol.from !== null ? ' · earned ' + dayRange(m.hol.from, m.hol.to) : '')));
    }
    var frac = M.printedFraction(m.src);
    var text = m.hol ? earnedText(m.src) : M.printedText(m.src);
    if (frac !== null || text) {
      var prog = el('div', 'lc-mn-prog');
      if (frac !== null) {
        var bar = el('span', 'lc-mn-bar');
        bar.setAttribute('aria-hidden', 'true');
        var fill = el('span', 'lc-mn-fill');
        fill.style.width = (Math.round(frac * 1000) / 10) + '%';
        bar.appendChild(fill);
        prog.appendChild(bar);
      }
      if (text) { prog.appendChild(el('p', 'lc-mn-printed', text)); }
      li.appendChild(prog);
    }
    return li;
  }

  function cardFor(m) {
    if (!cards[m.key]) { cards[m.key] = buildCard(m); }
    return cards[m.key];
  }

  /* ---------- filtering ---------- */

  function matches(m) {
    if (state.rarity !== 'all' && m.rkey !== state.rarity) { return false; }
    if (state.cat !== 'all' && m.cat !== state.cat) { return false; }
    if (state.hide && m.sold) { return false; }
    if (state.q && m.lname.indexOf(state.q) === -1) { return false; }
    return true;
  }

  function onlyRarity() {
    return state.rarity !== 'all' && !state.q && state.cat === 'all' && !state.hide;
  }

  function emptyText() {
    if (!all.length) { return 'No Minis yet. Keep an eye on the news.'; }
    if (onlyRarity()) { return 'No Minis of that rarity yet. Keep an eye on the news.'; }
    return 'No Minis match that.';
  }

  /* Put the shown cards in the grid, moving only what has to move (so focus survives a refresh). */
  function render() {
    if (!loaded) { return 0; }
    var list = all.filter(matches);
    var shown = list.slice(0, state.limit);
    var grid = ui.grid;
    shown.forEach(function (m, i) {
      var li = cardFor(m);
      if (grid.children[i] !== li) { grid.insertBefore(li, grid.children[i] || null); }
    });
    while (grid.children.length > shown.length) { grid.removeChild(grid.lastChild); }
    shownCount = shown.length;

    grid.hidden = !shown.length;
    ui.empty.hidden = !!shown.length;
    if (!shown.length) { ui.empty.textContent = emptyText(); }

    var rest = list.length - shown.length;
    ui.more.hidden = rest <= 0;
    if (rest > 0) {
      ui.count.textContent = 'Showing ' + D.count(shown.length) + ' of ' + D.count(list.length);
      ui.moreBtn.textContent = 'Show more Minis';
    }
    return list.length;
  }

  var sayTimer;
  function sayCount(n) {
    clearTimeout(sayTimer);
    sayTimer = setTimeout(function () {
      if (!n) { announce(emptyText()); return; }
      var t = n === 1 ? '1 Mini' : D.count(n) + ' Minis';
      announce(n > shownCount ? t + ', showing the first ' + D.count(shownCount) + '.' : t + '.');
    }, 350);
  }

  function refilter() {
    state.limit = PAGE;
    var n = render();
    if (loaded) { sayCount(n); }
  }

  ui.find.addEventListener('input', function () {
    state.q = ui.find.value.trim().replace(/\s+/g, ' ').toLowerCase();
    refilter();
  });
  // Escape in a search box clears it in most browsers; make sure the list follows.
  ui.find.addEventListener('search', function () {
    state.q = ui.find.value.trim().replace(/\s+/g, ' ').toLowerCase();
    refilter();
  });
  ui.cat.addEventListener('change', function () {
    state.cat = ui.cat.value || 'all';
    refilter();
  });
  ui.hide.addEventListener('change', function () {
    state.hide = !!ui.hide.checked;
    refilter();
  });
  ui.chips.forEach(function (chip) {
    chip.addEventListener('click', function () {
      state.rarity = chip.getAttribute('data-mn-rarity') || 'all';
      ui.chips.forEach(function (c) { c.setAttribute('aria-pressed', c === chip ? 'true' : 'false'); });
      refilter();
    });
  });
  ui.moreBtn.addEventListener('click', function () {
    var before = shownCount;
    state.limit += PAGE;
    var n = render();
    // Move to the first new card so keyboard and screen reader users carry on from there.
    var first = ui.grid.children[before];
    if (first) {
      first.setAttribute('tabindex', '-1');
      first.focus();
    }
    announce('Showing ' + D.count(shownCount) + ' of ' + D.count(n) + ' Minis.');
  });

  /* ---------- Holiday Minis: one row per holiday Mini in the feed ----------
     With the feed's dates the rows say when it can be earned and the template's hand-written dates step aside;
     without them (an older feed) the hand-written note stays. Rows are kept across refreshes, only their state moves. */

  var holRows = {};   // card key -> { li, state }

  function holState(m, now) {
    var h = m.hol;
    if (h.from === null) { return m.sold ? { text: 'All earned', cls: 'lc-pill--dark' } : null; }
    if (now > h.to) { return { text: 'Closed for good', cls: 'lc-pill--dark' }; }
    if (m.sold) { return { text: 'All earned', cls: 'lc-pill--dark' }; }
    if (now < h.from) { return { text: 'Starts ' + dayText(h.from), cls: 'lc-mn-hol-soon' }; }
    return { text: 'On now, until ' + dayText(h.to), cls: 'lc-mn-left' };
  }

  function buildHolRow(m) {
    var li = el('li', 'lc-mn-hol-row lc-r--' + m.rkey);
    li.appendChild(M.head(m.src));
    var info = el('div', 'lc-mn-hol-info');
    info.appendChild(el('p', 'lc-mn-hol-name', m.name));
    if (m.hol.from !== null) { info.appendChild(el('p', 'lc-mn-hol-when', 'Earned ' + dayRange(m.hol.from, m.hol.to) + ', Central time')); }
    var pills = el('p', 'lc-mn-pills');
    pills.appendChild(el('span', 'lc-rarity', M.RARITIES[m.rkey].name));
    var state = el('span', 'lc-pill');
    pills.appendChild(state);
    info.appendChild(pills);
    var text = earnedText(m.src);
    if (text) { info.appendChild(el('p', 'lc-mn-printed', text)); }
    li.appendChild(info);
    return { li: li, state: state };
  }

  function renderHoliday() {
    if (!ui.hol || !ui.holList) { return; }
    var list = all.filter(function (m) { return m.hol; });
    var now = Date.now(), keep = {}, dated = false;
    list.forEach(function (m, i) {
      var row = holRows[m.key] || (holRows[m.key] = buildHolRow(m));
      keep[m.key] = true;
      var st = holState(m, now);
      row.state.hidden = !st;
      if (st) {
        row.state.textContent = st.text;
        row.state.className = 'lc-pill ' + st.cls;
      }
      if (ui.holList.children[i] !== row.li) { ui.holList.insertBefore(row.li, ui.holList.children[i] || null); }
      if (m.hol.from !== null) { dated = true; }
    });
    Object.keys(holRows).forEach(function (k) {
      if (!keep[k]) {
        if (holRows[k].li.parentNode) { holRows[k].li.parentNode.removeChild(holRows[k].li); }
        delete holRows[k];
      }
    });
    ui.hol.hidden = !list.length;
    if (ui.holNote) { ui.holNote.hidden = dated; }
  }

  /* ---------- load, and refresh every two minutes while live ---------- */

  // Which Mini a card is, across refreshes: its id, or its name when the feed has no id.
  function ident(m) {
    return m.src.id == null || m.src.id === '' ? 'name:' + m.name : 'id:' + m.src.id;
  }

  D.watch('minis', function (res) {
    var list = res && res.data && res.data.minis;
    // A card that changed is rebuilt below. If it has focus (after "Show more Minis"), note which
    // Mini it is and where it sat, so focus can move to its new card instead of dropping to the page.
    var active = document.activeElement, lost = null;
    all.forEach(function (m) {
      var li = cards[m.key];
      if (!lost && li && li.parentNode === ui.grid && li.contains(active)) {
        lost = { id: ident(m), at: [].indexOf.call(ui.grid.children, li) };
      }
    });
    // While a focused card is rebuilt, the cards stay out of scroll anchoring (see page-minis.css).
    if (lost) { ui.grid.classList.add('lc-mn-rebuild'); }
    all = prepare(list);
    // Forget cards for Minis that are gone or changed.
    var keep = {};
    all.forEach(function (m) { keep[m.key] = true; });
    Object.keys(cards).forEach(function (k) {
      if (!keep[k]) {
        if (cards[k].parentNode) { cards[k].parentNode.removeChild(cards[k]); }
        delete cards[k];
      }
    });
    loaded = true;
    ui.grid.removeAttribute('aria-busy');
    setStats(all);
    setLabels(res);
    updateCategories(res.data);
    render();
    renderHoliday();
    if (lost && (!document.activeElement || document.activeElement === document.body)) {
      var back = null;
      all.forEach(function (m) {
        var li = cards[m.key];
        if (!back && li && li.parentNode === ui.grid && ident(m) === lost.id) { back = li; }
      });
      // The Mini left the list (or the filters): use the card now in its place.
      back = back || ui.grid.children[Math.min(lost.at, ui.grid.children.length - 1)];
      if (back) {
        back.setAttribute('tabindex', '-1');
        back.focus({ preventScroll: true });
      }
    }
    ui.grid.classList.remove('lc-mn-rebuild');
  }, 120);
})();
