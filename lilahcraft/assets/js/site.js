/* LilahCraft: shared behaviour on every page.
   - [data-lc-copy="text"] buttons copy text (data-lc-copied="Copied!" is the done label; data-lc-copy-what="link" names it when it's announced)
   - header Menu button below 1150 px
   - header switch for the dark look (the <head> script in inc/assets.php picks the look before first paint)
   - header player count from /wp-json/lilahcraft/v1/status, hidden when the ping fails
   - [data-lc-filter="tableId"] search boxes filter [data-lc-row] rows, grouped by [data-lc-group]
   - LC.announce(text) speaks through one polite live region */
(function () {
  'use strict';
  var LC = window.LC = window.LC || {};

  /* one polite live region for the whole page */
  var live = document.createElement('p');
  live.className = 'lc-sr';
  live.setAttribute('aria-live', 'polite');
  document.body.appendChild(live);
  LC.announce = function (text) {
    live.textContent = '';
    setTimeout(function () { live.textContent = text; }, 60);
  };

  /* COPY ADDRESS */
  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      if (ok) { resolve(); } else { reject(); }
    });
  }
  document.addEventListener('click', function (e) {
    var btn = e.target.closest ? e.target.closest('[data-lc-copy]') : null;
    if (!btn) { return; }
    var text = btn.getAttribute('data-lc-copy');
    if (!btn.hasAttribute('data-lc-label')) { btn.setAttribute('data-lc-label', btn.textContent); }
    var label = btn.getAttribute('data-lc-label');
    clearTimeout(btn._lcTimer);
    copyText(text).then(function () {
      btn.textContent = btn.getAttribute('data-lc-copied') || 'Copied!';
      btn.setAttribute('data-done', '1');
      // Name what was copied when the button says (a long link read out is noise); the address reads fine.
      LC.announce(btn.hasAttribute('data-lc-copy-what') ? 'Copied the ' + btn.getAttribute('data-lc-copy-what') + '.' : 'Copied ' + text);
      btn._lcTimer = setTimeout(function () {
        btn.textContent = label;
        btn.setAttribute('data-done', '0');
      }, 1800);
    }).catch(function () {
      btn.textContent = 'Select it and copy';
      LC.announce('Copy did not work. The ' + (btn.getAttribute('data-lc-copy-what') || 'address') + ' is ' + text);
      btn._lcTimer = setTimeout(function () { btn.textContent = label; }, 2600);
    });
  });

  /* HEADER MENU */
  var header = document.querySelector('[data-lc-header]');
  var menuBtn = header && header.querySelector('[data-lc-menu-btn]');
  if (menuBtn) {
    var setOpen = function (open, focusBtn) {
      header.classList.toggle('is-open', open);
      menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (!open && focusBtn) { menuBtn.focus(); }
    };
    menuBtn.addEventListener('click', function () {
      setOpen(menuBtn.getAttribute('aria-expanded') !== 'true', false);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && header.classList.contains('is-open')) { setOpen(false, true); }
    });
    document.addEventListener('click', function (e) {
      if (header.classList.contains('is-open') && !header.contains(e.target)) { setOpen(false, false); }
    });
    header.addEventListener('focusout', function (e) {
      if (header.classList.contains('is-open') && e.relatedTarget && !header.contains(e.relatedTarget)) { setOpen(false, false); }
    });
    window.matchMedia('(min-width: 1151px)').addEventListener('change', function (mq) {
      if (mq.matches) { setOpen(false, false); }
    });
  }

  /* DARK LOOK: <html data-theme="light|dark">. The switch stores the visitor's choice in localStorage lc-theme,
     or removes it when the choice is what the device asks for anyway, so the site follows the device again.
     aria-pressed follows the attribute, whoever sets it (this switch, the <head> script on a device change,
     another tab). */
  var root = document.documentElement;
  var themeBtn = header && header.querySelector('[data-lc-theme-btn]');
  var deviceDark = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  var deviceTheme = function () { return deviceDark && deviceDark.matches ? 'dark' : 'light'; };
  if (themeBtn) {
    var syncBtn = function () {
      themeBtn.setAttribute('aria-pressed', root.getAttribute('data-theme') === 'dark' ? 'true' : 'false');
    };
    syncBtn();
    if (window.MutationObserver) {
      new MutationObserver(syncBtn).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    }
    themeBtn.addEventListener('click', function () {
      var next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      try {
        if (next === deviceTheme()) { localStorage.removeItem('lc-theme'); } else { localStorage.setItem('lc-theme', next); }
      } catch (e) { /* not stored: this page still switches */ }
      root.setAttribute('data-theme', next);
      syncBtn();
    });
    // A choice made in another tab applies here too, and on a page the Back button brings back from memory
    var applyStored = function () {
      var s = null;
      try { s = localStorage.getItem('lc-theme'); } catch (e) { return; }
      root.setAttribute('data-theme', s === 'dark' || s === 'light' ? s : deviceTheme());
    };
    window.addEventListener('storage', function (e) {
      if (e.key === 'lc-theme' || e.key === null) { applyStored(); }
    });
    window.addEventListener('pageshow', function (e) {
      if (e.persisted) { applyStored(); }
    });
  }

  /* PLAYER COUNT */
  var slots = document.querySelectorAll('[data-lc-status]');
  if (slots.length && LC.rest && window.fetch) {
    fetch(LC.rest + 'status', { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (s) {
        if (!s || s.online !== true || typeof s.players !== 'number') { return; }
        var text = 'Online, ' + s.players + ' playing';
        [].forEach.call(slots, function (slot) {
          var t = slot.querySelector('[data-lc-status-text]') || slot;
          t.textContent = text;
          slot.hidden = false;
        });
      })
      .catch(function () { /* stays hidden */ });
  }

  /* TABLE FILTER (Guide commands) */
  [].forEach.call(document.querySelectorAll('[data-lc-filter]'), function (input) {
    var table = document.getElementById(input.getAttribute('data-lc-filter'));
    if (!table) { return; }
    var none = document.getElementById(input.getAttribute('data-lc-filter-none') || '');
    var groups = [].slice.call(table.querySelectorAll('[data-lc-group]'));
    if (!groups.length) { groups = [table]; }
    var timer;
    input.addEventListener('input', function () {
      var q = input.value.trim().toLowerCase();
      var total = 0;
      groups.forEach(function (g) {
        var n = 0;
        [].forEach.call(g.querySelectorAll('[data-lc-row]'), function (row) {
          var hit = !q || row.textContent.toLowerCase().indexOf(q) > -1;
          row.hidden = !hit;
          if (hit) { n++; }
        });
        if (g !== table) { g.hidden = n === 0; }
        total += n;
      });
      if (none) { none.hidden = total > 0; }
      clearTimeout(timer);
      timer = setTimeout(function () {
        LC.announce(q ? (total === 0 ? 'No command matches.' : total + (total === 1 ? ' command matches.' : ' commands match.')) : '');
      }, 400);
    });
  });
})();
