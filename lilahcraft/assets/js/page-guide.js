/* LilahCraft: Guide page.
   Marks the "Guide sections" link for the section being read with aria-current="true"
   (styled in page-guide.css). The section at the top of the viewport, just under the sticky
   header, is the current one; at the very bottom of the page the last section wins.
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

  var current = null;
  function setCurrent(item) {
    if (item === current) { return; }
    if (current) { current.link.removeAttribute('aria-current'); }
    current = item;
    if (item) { item.link.setAttribute('aria-current', 'true'); }
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
  function releaseSoon() {
    clearTimeout(lockTimer);
    lockTimer = setTimeout(function () {
      lockTimer = null;
      update();
    }, Math.max(0, Math.min(200, lockEnds - Date.now())));
  }

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
    if (!a) { return; }
    for (var i = 0; i < items.length; i++) {
      if (items[i].link === a) {
        setCurrent(items[i]);
        lockEnds = Date.now() + 2000;
        releaseSoon();
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
