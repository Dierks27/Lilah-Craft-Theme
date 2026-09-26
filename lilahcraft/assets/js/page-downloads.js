/* LilahCraft: Downloads page.
   The CraftBridge Client picker (inc/blocks/craftbridge.php). The server renders the default pick,
   so the Download link works without this file; data-lc-cb holds every pick:
   { "26.2": { "fabric": { href, file, label, line, needs: [], fallback }, ... }, ... }.
   The Minecraft and loader buttons are toggle buttons (aria-pressed); a pick updates the link,
   the file line and the "You also need" list, and says what changed through LC.announce. */
(function () {
  'use strict';

  function setup(box) {
    var picks;
    try { picks = JSON.parse(box.getAttribute('data-lc-cb') || ''); } catch (e) { return; }
    if (!picks || typeof picks !== 'object') { return; }

    var link = box.querySelector('[data-lc-cb-link]');
    var label = box.querySelector('[data-lc-cb-label]');
    var file = box.querySelector('[data-lc-cb-file]');
    var needs = box.querySelector('[data-lc-cb-needs]');
    var iconFile = box.querySelector('[data-lc-cb-icon="file"]');
    var iconPage = box.querySelector('[data-lc-cb-icon="page"]');
    var mcBtns = [].slice.call(box.querySelectorAll('[data-lc-cb-mc]'));
    var loaderBtns = [].slice.call(box.querySelectorAll('[data-lc-cb-loader]'));
    if (!link || !label || !file || !needs || !mcBtns.length || !loaderBtns.length) { return; }

    function pressedValue(btns, attr) {
      for (var i = 0; i < btns.length; i++) {
        if (btns[i].getAttribute('aria-pressed') === 'true') { return btns[i].getAttribute(attr); }
      }
      return btns[0].getAttribute(attr);
    }

    var state = {
      mc: pressedValue(mcBtns, 'data-lc-cb-mc'),
      loader: pressedValue(loaderBtns, 'data-lc-cb-loader')
    };

    // The icons are SVG elements, which have no .hidden property: use the attribute.
    function show(el, on) {
      if (!el) { return; }
      if (on) { el.removeAttribute('hidden'); } else { el.setAttribute('hidden', ''); }
    }

    function press(btns, attr, value) {
      btns.forEach(function (b) {
        b.setAttribute('aria-pressed', b.getAttribute(attr) === value ? 'true' : 'false');
      });
    }

    function render(say) {
      var pick = picks[state.mc] && picks[state.mc][state.loader];
      if (!pick) { return; }
      press(mcBtns, 'data-lc-cb-mc', state.mc);
      press(loaderBtns, 'data-lc-cb-loader', state.loader);

      link.setAttribute('href', pick.href);
      label.textContent = pick.label;
      file.textContent = pick.line;
      file.classList.toggle('is-note', !!pick.fallback);
      show(iconFile, !pick.fallback);
      show(iconPage, !!pick.fallback);

      needs.textContent = '';
      (pick.needs || []).forEach(function (text) {
        var li = document.createElement('li');
        li.textContent = text;
        needs.appendChild(li);
      });

      if (say && window.LC && LC.announce) {
        LC.announce(pick.fallback ? pick.line : 'Download set to ' + pick.file + '.');
      }
    }

    box.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('button') : null;
      if (!btn || !box.contains(btn)) { return; }
      var mc = btn.getAttribute('data-lc-cb-mc');
      var loader = btn.getAttribute('data-lc-cb-loader');
      if (mc && mc !== state.mc && picks[mc]) {
        state.mc = mc;
      } else if (loader && loader !== state.loader && picks[state.mc] && picks[state.mc][loader]) {
        state.loader = loader;
      } else {
        return;
      }
      render(true);
    });

    render(false);
  }

  [].forEach.call(document.querySelectorAll('[data-lc-cb]'), setup);
})();
