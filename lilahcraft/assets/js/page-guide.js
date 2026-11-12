/* LilahCraft: Guide page.
   Marks the "Guide sections" link for the section being read with aria-current="true"
   (styled in page-guide.css). The section at the top of the viewport, just under the sticky
   header, is the current one; at the very bottom of the page the last section wins. A link may also
   point at a subsection heading (the Golem chests and Sound Muffler h3s inside Crafting, and the Copper
   Golem Brush h4 inside Golem chests): the menu lists its targets in page order, so the last target above
   the line is the one being read. When a short window makes the menu scroll, the marked link is kept in its view.
   The command search is the shared [data-lc-filter] in site.js. */
(function () {
  'use strict';

  var nav = document.querySelector('[data-lc-toc]');
  if (!nav) { return; }

  var items = [];
  [].forEach.call(nav.querySelectorAll('a[href^="#"]'), function (a) {
    var id = a.getAttribute('href').slice(1);
    var section = null;
    try { section = id ? document.getElementById(decodeURIComponent(id)) : null; } catch (e) { section = null; }
    if (section) { items.push({ link: a, section: section }); }
  });
  if (!items.length) { return; }

  // On a short window the sticky menu scrolls inside itself: bring the marked link into its view,
  // centred so its neighbours show too (above the first section, the menu's top). Only the menu
  // scrolls, never the page (so no scrollIntoView). Not while keyboard focus is in the menu: PageDown
  // and the arrows scroll the menu first there, and moving it back would take the next key from the page.
  function reveal(link) {
    if (nav.scrollHeight <= nav.clientHeight) { return; }
    var keys = false;
    try { keys = !!nav.querySelector(':focus-visible'); } catch (e) { keys = false; }
    if (keys) { return; }
    if (!link) { nav.scrollTop = 0; return; }
    var top = nav.getBoundingClientRect().top + nav.clientTop;
    var bottom = top + nav.clientHeight;
    var r = link.getBoundingClientRect();
    if (r.top < top || r.bottom > bottom) {
      nav.scrollTop += (r.top + r.bottom) / 2 - (top + bottom) / 2;
    }
  }

  var current = null;
  function setCurrent(item) {
    if (item === current) { return; }
    if (current) { current.link.removeAttribute('aria-current'); }
    current = item;
    if (item) { item.link.setAttribute('aria-current', 'true'); }
    reveal(item ? item.link : null);
  }

  // Where an anchored section lands: html's scroll-padding-top (header + admin bar + 16 px).
  function landingLine() {
    var pad = parseFloat(window.getComputedStyle(document.documentElement).scrollPaddingTop);
    return (isNaN(pad) ? 0 : pad) + 24;
  }

  function update() {
    var doc = document.documentElement;
    var atBottom = window.innerHeight + (window.pageYOffset || doc.scrollTop) >= doc.scrollHeight - 2;
    if (atBottom && items[items.length - 1].section.getBoundingClientRect().top < window.innerHeight) {
      setCurrent(items[items.length - 1]);
      return;
    }
    var line = landingLine();
    var found = null;
    for (var i = 0; i < items.length; i++) {
      if (items[i].section.getBoundingClientRect().top <= line) { found = items[i]; } else { break; }
    }
    setCurrent(found);
  }

  // After a click, hold the clicked link while the smooth scroll runs (until scrolling
  // pauses, at most 2 s), so the highlight doesn't flick through the sections in between.
  var lockTimer = null;
  var lockEnds = 0;
  function lock() {
    lockEnds = Date.now() + 2000;
    releaseSoon();
  }
  function releaseSoon() {
    clearTimeout(lockTimer);
    lockTimer = setTimeout(function () {
      lockTimer = null;
      if (settle()) { return; }
      update();
    }, Math.max(0, Math.min(200, lockEnds - Date.now())));
  }

  // At 920 px and below the menu scrolls away with the page. Tab onto a link that is off screen and the
  // browser smooth-scrolls it into view; press Enter before that scroll ends and it can win over the jump,
  // leaving the page at the menu. So once the scroll settles, finish the jump if it fell short, unless the
  // reader has scrolled or pressed a key since (or the page can't scroll any further).
  var jump = null;
  function settle() {
    var item = jump;
    jump = null;
    if (!item || item.moved || !item.section.scrollIntoView) { return false; }
    var doc = document.documentElement;
    var off = item.section.getBoundingClientRect().top - (landingLine() - 24);
    var end = window.innerHeight + (window.pageYOffset || doc.scrollTop) >= doc.scrollHeight - 2;
    if (Math.abs(off) <= 4 || (off > 0 && end)) { return false; }
    item.section.scrollIntoView({ block: 'start' });
    lock();
    return true;
  }
  ['wheel', 'touchstart', 'keydown', 'mousedown'].forEach(function (t) {
    window.addEventListener(t, function () { if (jump) { jump.moved = true; } }, { passive: true });
  });

  var queued = false;
  function queue() {
    if (lockTimer) { releaseSoon(); return; }
    if (queued) { return; }
    queued = true;
    window.requestAnimationFrame(function () {
      queued = false;
      update();
    });
  }

  // A click marks the target straight away; scrolling then keeps it in step.
  nav.addEventListener('click', function (e) {
    var a = e.target.closest ? e.target.closest('a[href^="#"]') : null;
    if (!a || e.defaultPrevented || e.button || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) { return; } // new tab or window: this page stays put
    for (var i = 0; i < items.length; i++) {
      if (items[i].link === a) {
        setCurrent(items[i]);
        jump = { section: items[i].section, moved: false };
        lock();
        break;
      }
    }
  });

  // Opening /guide/#towns cold: the web fonts can arrive mid-scroll and shift the page, so
  // line the section up again once they're in, unless the reader has already moved on.
  (function () {
    var id = location.hash.slice(1);
    var target = null;
    try { target = id ? document.getElementById(decodeURIComponent(id)) : null; } catch (e) { target = null; }
    if (!target || !document.fonts || !document.fonts.ready || !target.scrollIntoView) { return; }
    var entry = window.performance && performance.getEntriesByType ? performance.getEntriesByType('navigation')[0] : null;
    if (entry && entry.type !== 'navigate') { return; } // reload / back: keep the restored position
    var moved = false;
    var stop = function () { moved = true; };
    ['wheel', 'touchstart', 'keydown', 'mousedown'].forEach(function (t) {
      window.addEventListener(t, stop, { once: true, passive: true });
    });
    document.fonts.ready.then(function () {
      if (moved) { return; }
      if (Math.abs(target.getBoundingClientRect().top - (landingLine() - 24)) > 4) {
        target.scrollIntoView({ block: 'start' });
      }
    });
  })();

  window.addEventListener('scroll', queue, { passive: true });
  window.addEventListener('resize', queue);
  window.addEventListener('hashchange', queue);
  window.addEventListener('load', queue);
  update();
})();
