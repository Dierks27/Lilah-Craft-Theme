/* LilahCraft 2.1: Play page (templates/page-play.html).
   - "When are people on?": 24 bars from /wp-json/lilahcraft/v1/activity (players per hour of the day,
     site time). The whole section stays hidden until the site has enough samples and a busiest hour.
   - First-day checklist: real checkboxes that work without this script; with it, ticks are saved in
     this browser (when storage is allowed), a polite "3 of 6 done" counter and a reset button. */
(function () {
  'use strict';
  var LC = window.LC || {};

  function isNum(n) { return typeof n === 'number' && isFinite(n); }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) { e.className = cls; }
    if (text != null) { e.textContent = text; }
    return e;
  }

  /* ---------- When are people on? ---------- */

  /* 19 → "7 pm", 0 → "12 am", 12 → "12 pm" */
  function hourText(h) { return (h % 12 || 12) + (h < 12 ? ' am' : ' pm'); }
  /* 4.25 → "4.3", 4 → "4" */
  function players(v) {
    var n = Math.round(v * 10) / 10;
    return (n % 1 ? n.toFixed(1) : String(n)) + (n === 1 ? ' player' : ' players');
  }
  /* "America/Chicago" → "Central Time"; "+05:00" → "UTC+05:00"; '' when the browser can't name it. */
  function zoneName(tz) {
    tz = String(tz || '');
    if (!tz) { return ''; }
    if (/^[+-]\d{2}:\d{2}$/.test(tz)) { return tz === '+00:00' || tz === '-00:00' ? 'UTC' : 'UTC' + tz; }
    var styles = ['longGeneric', 'long'];
    for (var i = 0; i < styles.length; i++) {
      try {
        var parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: styles[i] }).formatToParts(new Date());
        for (var j = 0; j < parts.length; j++) {
          if (parts[j].type === 'timeZoneName' && parts[j].value) { return parts[j].value; }
        }
      } catch (e) { /* unknown zone or style: try the next */ }
    }
    return '';
  }

  function drawActivity(sec, a) {
    if (!a || a.enough !== true || !Array.isArray(a.hours) || a.hours.length !== 24) { return; }
    var hours = a.hours.map(function (v) { return isNum(v) && v >= 0 ? v : null; });
    var max = 0, min = null, quiet = null;
    hours.forEach(function (v, h) {
      if (v === null) { return; }
      if (v > max) { max = v; }
      if (min === null || v < min) { min = v; quiet = h; }
    });
    var busiest = isNum(a.busiest) && a.busiest >= 0 && a.busiest < 24 && a.busiest % 1 === 0 ? a.busiest : null;
    // Nothing to say without a busiest hour (for example, nobody on yet): leave it hidden.
    if (busiest === null || hours[busiest] === null || !(max > 0)) { return; }

    var bars = sec.querySelector('[data-lc-act-bars]');
    var axis = sec.querySelector('[data-lc-act-axis]');
    var busy = sec.querySelector('[data-lc-act-busy]');
    var note = sec.querySelector('[data-lc-act-note]');
    if (!bars || !axis || !busy) { return; }
    var zone = zoneName(a.timezone);

    bars.textContent = '';
    hours.forEach(function (v, h) {
      var b = el('span');
      if (v === null) {
        b.className = 'is-none';
        b.title = hourText(h) + ': no count yet';
      } else {
        b.style.height = (v / max * 100).toFixed(1) + '%';
        b.title = hourText(h) + ': about ' + players(v);
        if (h === busiest) { b.className = 'is-peak'; }
      }
      bars.appendChild(b);
    });
    var label = 'Bar chart of the average number of players online in each hour of the day, 12 am to 11 pm' +
      (zone ? ', ' + zone : '') + '. Busiest around ' + hourText(busiest) + ', with about ' + players(hours[busiest]) + '.';
    if (quiet !== null && min < hours[busiest]) {
      label += ' Quietest around ' + hourText(quiet) + ', with about ' + players(min) + '.';
    }
    bars.setAttribute('aria-label', label);

    axis.textContent = '';
    for (var h = 0; h < 24; h += 3) {
      var t = el('span', h % 6 ? 'is-minor' : '', hourText(h));
      t.style.gridColumn = (h + 1) + ' / span 3';
      axis.appendChild(t);
    }

    busy.textContent = 'Usually busiest around ';
    busy.appendChild(el('span', 'lc-hl', hourText(busiest)));
    if (note) {
      var days = isNum(a.days) && a.days > 0 ? Math.round(a.days) : 0;
      note.textContent = 'Average players online in each hour' +
        (days > 1 ? ' over the last ' + days + ' days' : (days ? ' over the last day' : '')) + '.' +
        (zone ? ' Times are ' + zone + '.' : '');
    }
    sec.hidden = false;
  }

  var act = document.querySelector('[data-lc-activity]');
  if (act && LC.rest && window.fetch) {
    fetch(LC.rest + 'activity', { headers: { Accept: 'application/json' }, credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (a) { drawActivity(act, a); })
      .catch(function () { /* stays hidden */ });
  }

  /* ---------- First-day checklist ---------- */

  var KEY = 'lc-play-first-day';
  function storage() {
    try {
      var s = window.localStorage;
      s.setItem(KEY + '-test', '1');
      s.removeItem(KEY + '-test');
      return s;
    } catch (e) { return null; }
  }

  function initChecklist(box) {
    var boxes = [].slice.call(box.querySelectorAll('input[type="checkbox"]'));
    var count = box.querySelector('[data-lc-check-count]');
    var bar = box.querySelector('[data-lc-check-bar]');
    var cells = bar ? [].slice.call(bar.children) : [];
    var foot = box.querySelector('[data-lc-check-foot]');
    var reset = box.querySelector('[data-lc-check-reset]');
    var saved = box.querySelector('[data-lc-check-saved]');
    if (!boxes.length || !count) { return; }
    var store = storage();

    function ticked() {
      return boxes.filter(function (b) { return b.checked; }).map(function (b) { return b.value; });
    }
    function save() {
      if (!store) { return; }
      try {
        var list = ticked();
        if (list.length) { store.setItem(KEY, JSON.stringify(list)); } else { store.removeItem(KEY); }
      } catch (e) { /* full or blocked: the ticks just aren't kept */ }
    }
    function update() {
      var n = ticked().length, total = boxes.length;
      count.textContent = n + ' of ' + total + ' done' + (n === total ? '. You’re all set!' : '');
      cells.forEach(function (c, i) { c.className = i < Math.round(n / total * cells.length) ? 'is-on' : ''; });
    }

    // Restore saved ticks (and undo anything the browser restored on its own).
    if (store) {
      var list = [];
      try { list = JSON.parse(store.getItem(KEY) || '[]'); } catch (e) { list = []; }
      if (!Array.isArray(list)) { list = []; }
      boxes.forEach(function (b) { b.checked = list.indexOf(b.value) > -1; });
    }
    if (saved) { saved.hidden = !store; }
    update();
    count.hidden = false;
    if (bar) { bar.hidden = false; }
    if (foot) { foot.hidden = false; }
    // Live only after the first fill, so loading the page doesn't announce the count.
    count.setAttribute('aria-live', 'polite');

    box.addEventListener('change', function (e) {
      if (e.target && e.target.type === 'checkbox') {
        save();
        update();
      }
    });
    if (reset) {
      reset.addEventListener('click', function () {
        boxes.forEach(function (b) { b.checked = false; });
        save();
        update();
      });
    }
  }

  var checklist = document.querySelector('[data-lc-checklist]');
  if (checklist) { initChecklist(checklist); }
})();
