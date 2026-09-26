/* LilahCraft Minis page: the stat cards, the filters and the card grid, from LCData ('minis').
   Cards are built once per Mini (and again only if that Mini changes) and only when first shown;
   a long list shows PAGE cards at a time with a "Show more Minis" button.
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
    statNote: $('[data-mn-statnote]')
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

  function prepare(list) {
    var seen = {};
    var out = (Array.isArray(list) ? list : []).filter(function (m) { return m && typeof m === 'object'; }).map(function (m, i) {
      var name = String(m.name == null ? '' : m.name).trim() || prettyId(m.id) || 'Mini';
      var rkey = M.rarityKey(m.rarity);
      var cat = String(m.category || 'MISC').toUpperCase();
      // Everything the card shows, so a changed Mini gets a fresh card on the next refresh.
      var sig = [m.id, name, rkey, m.cap, m.printed, m.soldOut, m.skin || '', m._art || ''].join('|');
      var key = sig;
      if (seen[sig]) { key = sig + '#' + seen[sig]; }
      seen[sig] = (seen[sig] || 0) + 1;
      return { key: key, name: name, lname: name.toLowerCase(), rkey: rkey, rank: M.RARITY_ORDER.indexOf(rkey), cat: cat, sold: M.soldOut(m), src: m, i: i };
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

  function updateCategories() {
    var sel = ui.cat;
    var have = {};
    [].forEach.call(sel.options, function (o) { have[o.value] = o; });
    var extra = {};
    all.forEach(function (m) { if (M.CATEGORY_ORDER.indexOf(m.cat) === -1) { extra[m.cat] = true; } });
    // Keep the design's eight, add any other category the feed uses (before Misc), and keep
    // the chosen one even if it just left the feed.
    if (state.cat !== 'all' && M.CATEGORY_ORDER.indexOf(state.cat) === -1) { extra[state.cat] = true; }
    var extras = Object.keys(extra).sort(function (a, b) { return M.categoryLabel(a).localeCompare(M.categoryLabel(b)); });
    var order = ['all'].concat(M.CATEGORY_ORDER.slice(0, -1), extras, M.CATEGORY_ORDER.slice(-1));
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

  function buildCard(m) {
    var li = el('li', 'lc-mn-card lc-r--' + m.rkey);
    li.appendChild(M.head(m.src));
    li.appendChild(el('p', 'lc-mn-name', m.name));
    var pills = el('p', 'lc-mn-pills');
    pills.appendChild(el('span', 'lc-rarity', M.RARITIES[m.rkey].name));
    if (m.sold) { pills.appendChild(el('span', 'lc-pill lc-pill--night', 'Sold out')); }
    li.appendChild(pills);
    var frac = M.printedFraction(m.src);
    var text = M.printedText(m.src);
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

  /* ---------- load, and refresh every two minutes while live ---------- */

  D.watch('minis', function (res) {
    var list = res && res.data && res.data.minis;
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
    updateCategories();
    render();
  }, 120);
})();
