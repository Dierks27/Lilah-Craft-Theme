/* LilahCraft Arcade page (templates/page-arcade.html): the live parts, from LCData ('arcade').
   The hero's status line; the games, grouped like the in-game Games screen (Luck, Cabinets, Courses, Mini golf),
   with Today's pick on top; the Prize Counter, the Card Packs and the achievements. The template's parts about
   games that aren't open (.lc-ac-if-games, -chance, -skill, -courses, -invites) hide once the feed says so, and a
   section the feed has nothing for hides whole: the page shows exactly what the feed has.
   Feed text goes in with textContent only. No player data: the only name shown is a record's holder, and only when
   the feed sends one (HomeCraftMgmt sends it only while its owner has names switched on). */
(function () {
  'use strict';
  var D = window.LCData;
  var main = document.querySelector('.lc-main--arcade');
  var app = main && main.querySelector('[data-ac-games]');
  if (!D || !D.arcade || !app) { return; }
  var A = D.arcade;
  var LC = window.LC || {};
  var SCRATCH = 'scratch_ticket';
  var ACH_SHOWN = 6;

  function $(sel, scope) { return (scope || document).querySelector(sel); }
  function all(sel, scope) { return [].slice.call((scope || document).querySelectorAll(sel)); }
  function hasOwn(o, k) { return !!o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k); }
  function whole(n) { return D.isNum(n) && n >= 0 && Math.floor(n) === n; }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) { e.className = cls; }
    if (text != null) { e.textContent = text; }
    return e;
  }
  function setText(node, text) { if (node && node.textContent !== text) { node.textContent = text; } }
  function announce(text) { if (LC.announce) { LC.announce(text); } }
  function cap(s) { s = String(s); return s.charAt(0).toUpperCase() + s.slice(1); }
  function tokens(n) { return n === 1 ? '1 token' : D.count(n) + ' tokens'; }
  function plural(n, one, many) { return D.count(n) + ' ' + (n === 1 ? one : many); }
  /* "1, 2 or 5"; "parkour, elytra and boat" */
  function orList(parts) { return parts.length < 2 ? parts.join('') : parts.slice(0, -1).join(', ') + ' or ' + parts[parts.length - 1]; }
  function andList(parts) { return parts.length < 2 ? parts.join('') : parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1]; }
  /* A multiple as the game writes it: 50, 1.5 */
  function times(n) { return String(Math.round(n * 100) / 100); }
  function prettyId(id) {
    var s = String(id || '').replace(/[_:\-]+/g, ' ').trim();
    return s ? cap(s) : '';
  }
  function nameOf(g) { return String(g.name || '').trim() || prettyId(g.id); }

  /* ---------- words: facts from HomeCraftMgmt's games guide ---------- */

  /* One plain line per game. A game this list doesn't know gets its kind's line (courses, golf) or, for a game of
     chance, the feed's own `rules` line. */
  var LINES = {
    scratch_ticket: 'Scratch three squares. Three stars or three suns wins, and the jackpot grows by 1 token with every ticket anyone buys.',
    ore_slots: 'Three reels of ores and one line. Match ores on the line; a wild counts as any ore.',
    twenty_one: 'Get closer to 21 than the Arcade without going over. Hit, stand or double.',
    wheel: 'A ring of 24 spaces, each as likely as the next. Every space shows what it gives.',
    higher_lower: 'Guess whether the next card is higher or lower. Each right guess grows your pot, and you cash out when you like.',
    coin_flip: 'Two players nearby put in the same tokens, and one flip picks who gets most of both.',
    creeper_sweeper: 'Dig every safe square on a 9 by 5 field without digging up a creeper.',
    ore_merge: 'Slide ores around a 4 by 4 grid. Two of the same merge into the next, from coal up to a dragon egg.',
    snake: 'Steer the snake to the apples without hitting the wall or its own body.',
    mini_match: 'Find all 8 pairs of cards in as few flips as you can.',
    simon_says: 'Copy the pattern of lit pads. It gets one longer every round.',
    whack_a_zombie: 'Bonk the zombies as they pop up, a point each. Bonking a villager costs a point.',
    connect_four: 'Four in a row on a board 7 columns wide, against the Arcade or a friend.',
    tic_tac_toe: 'Three in a row on a 3 by 3 board, against the Arcade or a friend.'
  };
  var KIND_LINES = {
    parkour: 'Jump from the start to the finish through every checkpoint, against the clock.',
    elytra: 'Glide through every ring from the start to the finish, against the clock.',
    boat: 'Row your own boat through every checkpoint to the finish, against the clock.',
    golf: 'Putt a ball that looks like one of your own Minis into the cup, in as few strokes as you can.'
  };
  /* Under a game of chance's "What it pays" table. */
  var NOTES = {
    scratch_ticket: 'Three “Tokens back” squares return part of your tokens, and that isn’t a win. The jackpot starts at 50 tokens, grows by 1 with every ticket anyone buys (up to 1,000) and goes back to 50 when someone wins it.',
    ore_slots: 'Only the line between the arrows counts, and only its best result pays. Stone never pays.',
    twenty_one: 'Twenty-One! is 21 with your first two cards. The same total as the Arcade gives your tokens back. How you play changes how often each result comes up.',
    wheel: 'Where it stops is picked before the light moves, and the light always moves the same way.',
    higher_lower: 'A wrong guess, or the same card again, ends the run with nothing back. A 2 or an Ace after a right guess cashes you out, since no guess from there can grow your pot. The best play is to cash out after your first right guess.',
    coin_flip: 'The winner gets most of both players’ tokens, and the rest is gone. The player you ask needs Coin Flip invites on.'
  };
  var INTRO = {
    luck: 'Tokens in, tokens back. Each game shows what it gives back and what it pays, and over many plays every one gives back less than you put in.',
    cabinets: 'Free: no tokens go in. Milestones and each day’s challenge pay a token (by default).',
    courses: 'Time trials in the Games world. Free, as many runs as you like, and the first time you finish a course pays 5, 10, 20 or 40 tokens by tier (by default). Typing a course’s command starts the run straight away.',
    golf: 'Mini golf in the Games world. Free, as many rounds as you like, and the first time you finish a course pays 5 tokens (by default).'
  };
  var ANCHOR = { luck: 'luck', cabinets: 'cabinets', courses: 'courses', golf: 'mini-golf' };
  /* Games whose give-back assumes the best choices (/hcm arcade odds says "the best play gives back about…") */
  var BEST_PLAY = { twenty_one: true, higher_lower: true };
  /* Both players put in the same */
  var EACH = { coin_flip: true };
  var INVITE_GAMES = ['connect_four', 'tic_tac_toe', 'coin_flip'];
  var UNITS = ['ms', 'points', 'flips', 'apples', 'wins'];

  /* ---------- the page's pieces ---------- */

  var status = $('[data-ac-status]', main);
  var statusText = status && $('[data-ac-status-text]', status);
  var ui = {
    note: $('[data-ac-note]', app),
    lede: $('[data-ac-lede]', app),
    pick: $('[data-ac-pick]', app),
    pickName: $('[data-ac-pick-name]', app),
    pickMeta: $('[data-ac-pick-meta]', app),
    pickLeft: $('[data-ac-pick-left]', app),
    pickCmd: $('[data-ac-pick-cmd]', app),
    pickBonus: $('[data-ac-pick-bonus]', app),
    jump: $('[data-ac-jump]', app),
    jumpList: $('[data-ac-jump-list]', app),
    groups: $('[data-ac-groups]', app)
  };
  /* Under Today's pick: the template's line for one game, this one for a whole world game (every course is the pick,
     and the bonus is still once a day in total). */
  var PICK_BONUS = ui.pickBonus ? ui.pickBonus.textContent : '';
  var PICK_BONUS_WHOLE = 'Your first finish of one of these courses today pays 1 extra token (by default). The next pick comes at midnight.';
  function slot(sel) {
    var s = $(sel, main);
    return s ? { root: s, note: $('[data-ac-note]', s), list: $('[data-ac-list]', s), count: $('[data-ac-count]', s), more: $('[data-ac-more]', s), sig: null } : null;
  }
  var prizes = slot('[data-ac-prizes]'), packs = slot('[data-ac-packs]'), achs = slot('[data-ac-achievements]');

  var state = { res: null, open: Object.create(null), stake: Object.create(null), achsOpen: false };
  var cards = Object.create(null);     // game id -> { sig, li }
  var groupEls = Object.create(null);  // group id -> { wrap, head, count, intro, list }
  var jumpSig = null, uid = 0;

  /* A section (the <section> around a slot) shows only when the feed has something for it. */
  function showSection(node, on) {
    var sec = node && node.closest ? node.closest('section') : null;
    if (sec) { sec.hidden = !on; }
  }

  /* Focus survives a refresh that rebuilds the focused control: every control carries data-ac-key. */
  function focusKey() {
    var a = document.activeElement;
    return a && a.getAttribute ? a.getAttribute('data-ac-key') : null;
  }
  function refocus(key) {
    var a = document.activeElement;
    if (!key || (a && a !== document.body && document.documentElement.contains(a))) { return; }
    var t = all('[data-ac-key]', main).filter(function (n) { return n.getAttribute('data-ac-key') === key; })[0];
    if (t && !t.closest('[hidden]')) { t.focus({ preventScroll: true }); }
  }

  /* ---------- status and labels ---------- */

  function whenText(d) { return D.timeText(d.generatedAt || d.fetchedAt); }

  function renderStatus(res) {
    if (!status || !statusText) { return; }
    var t = whenText(res.data || {}), text;
    if (res.mode === 'live') {
      text = 'Live' + (t ? ' · updated ' + t : '');
    } else if (res.mode === 'stale') {
      text = 'Last known Arcade' + (t ? ' · ' + t : '');
    } else {
      text = D.SAMPLE_LABEL + (res.unreachable ? ' · the live feed can’t be reached right now' : '');
    }
    setText(statusText, text);
    status.setAttribute('data-mode', res.mode);
  }

  /* The line over each live section: a sentence over the games, a short label over the rest. '' when live. */
  function noteFor(res, long) {
    var t = whenText(res.data || {});
    if (res.mode === 'sample') {
      return long ? D.SAMPLE_LABEL + ': example games and numbers, not the live Arcade.' +
        (res.unreachable ? ' The live feed can’t be reached right now.' : '') : D.SAMPLE_LABEL;
    }
    if (res.mode === 'stale') {
      return long ? 'The live feed can’t be reached right now, so this is the last known Arcade' + (t ? ', from ' + t : '') + '.' :
        'Last known' + (t ? ' · ' + t : '');
    }
    return '';
  }
  function setNote(node, text) {
    if (!node) { return; }
    setText(node, text);
    node.hidden = !text;
  }

  /* ---------- which games are open ---------- */

  /* The feed's games, each id once (the feed promises that; a page.route test may not keep it). */
  function openGames(data) {
    var seen = Object.create(null);
    return A.games(data).filter(function (g) {
      if (seen[g.id]) { return false; }
      seen[g.id] = true;
      return true;
    });
  }

  /* Show or hide the template's .lc-ac-if-* parts. "games" is anything besides the Scratch Ticket, which is in the
     feed even while the games are off. */
  function toggleParts(list) {
    var has = { games: false, chance: false, skill: false, courses: false, invites: false };
    list.forEach(function (g) {
      if (g.id === SCRATCH) { return; }
      has.games = true;
      if (g.kind === 'chance') { has.chance = true; } else { has.skill = true; }
      if (g.kind === 'golf' || A.groupOf(g.kind) === 'courses') { has.courses = true; }
      if (INVITE_GAMES.indexOf(g.id) > -1) { has.invites = true; }
    });
    Object.keys(has).forEach(function (k) {
      all('.lc-ac-if-' + k, main).forEach(function (node) { node.hidden = !has[k]; });
    });
    return has;
  }

  /* The games by tab, like LCData.arcade.byGroup(), with the courses easiest first (as /hcm play trials lists them). */
  function tierRank(g) {
    var i = A.TIERS.indexOf(g.tier);
    return i < 0 ? A.TIERS.length : i;
  }
  function grouped(list) {
    return A.GROUPS.map(function (grp) {
      var games = list.filter(function (g) { return grp.kinds.indexOf(g.kind) > -1; });
      if (grp.id === 'courses') {
        games = games.map(function (g, i) { return { g: g, i: i }; })
          .sort(function (a, b) { return (tierRank(a.g) - tierRank(b.g)) || (a.i - b.i); })
          .map(function (x) { return x.g; });
      }
      return { id: grp.id, label: grp.label, games: games };
    }).filter(function (grp) { return grp.games.length > 0; });
  }

  /* ---------- game facts ---------- */

  function stakesOf(g) {
    var seen = {};
    return (Array.isArray(g.stakes) ? g.stakes : []).filter(function (s) {
      if (!whole(s) || s < 1 || seen[s]) { return false; }
      seen[s] = true;
      return true;
    });
  }
  function currentStake(g, stakes) {
    var s = state.stake[g.id];
    return stakes.indexOf(s) > -1 ? s : stakes[0];
  }
  function bestPlay(g) { return hasOwn(BEST_PLAY, g.id) || hasOwn(g, 'payouts') || D.isNum(g.maxMultiplier); }
  function lineOf(g) {
    if (hasOwn(LINES, g.id)) { return LINES[g.id]; }
    if (hasOwn(KIND_LINES, g.kind)) { return KIND_LINES[g.kind]; }
    return g.kind === 'chance' && typeof g.rules === 'string' ? g.rules.trim() : '';
  }
  function courseText(g) {
    var parts = [];
    if (whole(g.holes) && g.holes > 0) { parts.push(plural(g.holes, 'hole', 'holes')); }
    if (whole(g.par) && g.par > 0) { parts.push('par ' + D.count(g.par)); }
    return parts.join(', ');
  }
  /* "Boat · Medium", "Arcade cabinet", "Mini golf · 9 holes, par 27" */
  function metaOf(g) {
    var parts = [A.kindLabel(g.kind)];
    if (A.groupOf(g.kind) === 'courses' && A.tierLabel(g.tier)) { parts.push(A.tierLabel(g.tier)); }
    if (g.kind === 'golf' && courseText(g)) { parts.push(courseText(g)); }
    return parts.filter(Boolean).join(' · ');
  }
  /* Creeper Sweeper's record is on its Normal board, Connect Four's on Hard. */
  function recordLabel(g) {
    var b = g.kind === 'cabinet' && typeof g.board === 'string' ? g.board.trim() : '';
    return 'Record' + (b && ['classic', 'wins'].indexOf(b.toLowerCase()) < 0 ? ' (' + cap(b) + ')' : '');
  }
  /* Whether "No record yet" is true: a board the site can read, with nothing on it. */
  function canHaveRecord(g) {
    return g.kind === 'cabinet' ? UNITS.indexOf(g.unit) > -1 : g.kind !== 'chance';
  }
  /* LCData.arcade.record(), shown only with a score that reads (none below zero), and dated only when the date isn't
     more than a day ahead (a clock or unit slip upstream). */
  var DAY_MS = 86400000;
  function recordOf(g) {
    var r = A.record(g);
    if (!r || !(r.value >= 0) || !r.text) { return null; }
    if (r.at && r.at > Date.now() + DAY_MS) { r.at = null; }
    return r;
  }
  function recordAgo(g) {
    var r = recordOf(g);
    return r && r.at ? D.agoWords(r.at) : '';
  }
  /* The jackpot's own odds, from the paytable row HomeCraftMgmt names "the jackpot" (never a row that happens to pay
     the same as the pot: at 50 that would be the "50 tokens" row). '' when that row isn't there (then no pot is shown). */
  function jackpotOdds(j) {
    var row = (Array.isArray(j.game.paytable) ? j.game.paytable : []).filter(function (r) {
      return !!r && /jackpot/i.test(String(r.combo)) && A.odds(r) !== '';
    })[0];
    return row ? A.odds(row) : '';
  }

  /* ---------- building blocks ---------- */

  function fact(dl, label, value, cls) {
    var row = el('div', cls || null);
    row.appendChild(el('dt', null, label));
    var dd = value && value.nodeType ? value : el('dd', null, value);
    row.appendChild(dd);
    dl.appendChild(row);
    return row;
  }
  /* A command in a <code>, with a line break allowed after each "_" (a <wbr>), so a narrow card breaks an id like
     creeper_sweeper at the underscore instead of mid-word. The CSS's break-anywhere is only the last resort. */
  function fillCode(code, cmd) {
    if (code.textContent === cmd) { return code; }
    code.textContent = '';
    String(cmd).split('_').forEach(function (part, i, parts) {
      var last = i === parts.length - 1;
      var text = last ? part : part + '_';
      if (text) { code.appendChild(document.createTextNode(text)); }
      if (!last) { code.appendChild(document.createElement('wbr')); }
    });
    return code;
  }
  function codeDd(cmd, after) {
    var dd = el('dd', 'lc-ac-code');
    dd.appendChild(fillCode(el('code'), cmd));
    if (after) { dd.appendChild(el('span', 'lc-ac-dd-after', after)); }
    return dd;
  }
  var SVG = 'http://www.w3.org/2000/svg';
  function svg(w, box, paths, cls) {
    var s = document.createElementNS(SVG, 'svg');
    s.setAttribute('width', w);
    s.setAttribute('height', w);
    s.setAttribute('viewBox', box);
    s.setAttribute('aria-hidden', 'true');
    s.setAttribute('focusable', 'false');
    if (cls) { s.setAttribute('class', cls); }
    paths.forEach(function (d) {
      var p = document.createElementNS(SVG, 'path');
      p.setAttribute('d', d);
      s.appendChild(p);
    });
    return s;
  }
  function chevron() {
    var s = svg(16, '0 0 8 8', ['M1 2h2v1h2V2h2v2H6v1H5v1H3V5H2V4H1z']);
    s.setAttribute('shape-rendering', 'crispEdges');
    return s;
  }

  /* ---------- What it pays (games of chance) ---------- */

  function table(caption, heads, rows) {
    var t = el('table', 'lc-ac-table');
    t.appendChild(el('caption', 'lc-sr', caption));
    var head = el('thead'), tr = el('tr');
    heads.forEach(function (h) {
      var th = el('th', h[1] || null, h[0]);
      th.setAttribute('scope', 'col');
      tr.appendChild(th);
    });
    head.appendChild(tr);
    t.appendChild(head);
    var body = el('tbody');
    rows.forEach(function (cells) {
      var r = el('tr');
      cells.forEach(function (c, i) {
        var cell = el(i ? 'td' : 'th', heads[i][1] || null, c);
        if (!i) { cell.setAttribute('scope', 'row'); }
        r.appendChild(cell);
      });
      body.appendChild(r);
    });
    t.appendChild(body);
    return t;
  }

  /* Tokens back for a paytable row: "200", or "250 (×50)" for a row that pays a multiple of the tokens in. */
  function backText(r) {
    if (r.times !== null) {
      return (whole(r.tokens) ? D.count(r.tokens) + ' ' : '') + '(×' + times(r.times) + ')';
    }
    return D.isNum(r.tokens) && r.tokens >= 0 ? D.count(r.tokens) : '';
  }

  function fillPays(body, g, s) {
    body.textContent = '';
    var name = nameOf(g);
    var back = A.giveBack(g, s);
    if (back !== null) {
      body.appendChild(el('p', 'lc-ac-pays-back', bestPlay(g) ?
        'With the best play, ' + tokens(s) + ' in gives back about ' + back + ' of every 100 tokens.' :
        'At ' + tokens(s) + ' in it gives back about ' + back + ' of every 100 tokens.'));
    }
    var rows = A.paytable(g, s);
    if (rows.length) {
      body.appendChild(table('What ' + name + ' pays at ' + tokens(s) + ' in',
        [['Result'], ['Tokens back', 'lc-ac-num'], ['Odds', 'lc-ac-odds']],
        rows.map(function (r) { return [cap(r.combo), backText(r), r.odds]; })));
    }
    // Twenty-One: what a win, a Twenty-One! and a doubled win give back at this stake.
    var p = hasOwn(g.payouts, String(s)) ? g.payouts[String(s)] : null;
    if (p && typeof p === 'object') {
      var pay = [['A win', s, p.win], ['Twenty-One!', s, p.twentyOne], ['A doubled win', s * 2, p.doubleWin]].filter(function (r) { return whole(r[2]); });
      if (pay.length) {
        body.appendChild(table('What ' + name + ' pays at ' + tokens(s) + ' in',
          [['Result'], ['Tokens in', 'lc-ac-num'], ['Tokens back', 'lc-ac-num']],
          pay.map(function (r) { return [r[0], D.count(r[1]), D.count(r[2])]; })));
      }
    }
    // Higher or Lower: where a run cashes out by itself. The feed's multiplier, capped by the most one play pays
    // (250 tokens by default, which the feed doesn't carry), so the top pot is never worked out as stake × multiplier.
    var cashAt = D.isNum(g.maxMultiplier) && g.maxMultiplier > 1 ?
      'when it reaches ' + times(g.maxMultiplier) + ' times your tokens in or 250 tokens (by default), whichever is lower' : '';
    var cashAfter = whole(g.maxGuesses) && g.maxGuesses > 0 ? 'after ' + plural(g.maxGuesses, 'right guess', 'right guesses') : '';
    if (cashAt || cashAfter) {
      body.appendChild(el('p', 'lc-ac-pays-line', 'Your pot starts at your tokens in and grows with each right guess. It cashes out by itself ' +
        [cashAt, cashAfter].filter(Boolean).join(', or ') + '.'));
    }
    if (hasOwn(NOTES, g.id)) { body.appendChild(el('p', 'lc-ac-pays-note', NOTES[g.id])); }
  }

  function addPays(li, g) {
    var stakes = stakesOf(g);
    if (!stakes.length) { return; }
    var id = 'lc-ac-pay-' + (++uid);
    var open = !!state.open[g.id];
    var btn = el('button', 'lc-ac-toggle');
    btn.type = 'button';
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    btn.setAttribute('aria-controls', id);
    btn.setAttribute('data-ac-key', 'pays:' + g.id);
    // Five of these on the page: the game's name (for screen readers and voice control) tells them apart.
    var what = el('span', null, 'What it pays');
    what.appendChild(el('span', 'lc-sr', ', ' + nameOf(g)));
    btn.appendChild(what);
    btn.appendChild(chevron());
    var panel = el('div', 'lc-ac-pays');
    panel.id = id;
    panel.hidden = !open;
    var body = el('div', 'lc-ac-pays-body');
    if (stakes.length > 1) {
      var pickRow = el('div', 'lc-ac-stakes');
      var label = el('span', 'lc-ac-stakes-label', 'Tokens in');
      label.appendChild(el('span', 'lc-sr', ', ' + nameOf(g)));
      label.id = id + '-in';
      var chips = el('div', 'lc-chips lc-ac-chips');
      chips.setAttribute('role', 'group');
      chips.setAttribute('aria-labelledby', label.id);
      var now = currentStake(g, stakes);
      stakes.forEach(function (s) {
        var chip = el('button', 'lc-chip', D.count(s));
        chip.type = 'button';
        chip.appendChild(el('span', 'lc-sr', s === 1 ? ' token' : ' tokens'));
        chip.setAttribute('aria-pressed', s === now ? 'true' : 'false');
        chip.setAttribute('data-ac-key', 'stake:' + g.id + ':' + s);
        chip.addEventListener('click', function () {
          state.stake[g.id] = s;
          all('.lc-chip', chips).forEach(function (c) { c.setAttribute('aria-pressed', c === chip ? 'true' : 'false'); });
          fillPays(body, g, s);
          var first = body.firstChild;
          if (first && first.className === 'lc-ac-pays-back') { announce(first.textContent); }
        });
        chips.appendChild(chip);
      });
      pickRow.appendChild(label);
      pickRow.appendChild(chips);
      panel.appendChild(pickRow);
    }
    panel.appendChild(body);
    fillPays(body, g, currentStake(g, stakes));
    btn.addEventListener('click', function () {
      var on = btn.getAttribute('aria-expanded') !== 'true';
      state.open[g.id] = on;
      btn.setAttribute('aria-expanded', on ? 'true' : 'false');
      panel.hidden = !on;
    });
    li.appendChild(btn);
    li.appendChild(panel);
  }

  /* ---------- a game's card ---------- */

  function buildCard(g, grp, level, pickIds, jp) {
    var li = el('li', 'lc-ac-game lc-ac-game--' + grp);
    var top = el('div', 'lc-ac-game-top');
    top.appendChild(el('h' + level, 'lc-ac-game-name', nameOf(g)));
    var tags = el('p', 'lc-ac-tags');
    if (pickIds[g.id] === true) {
      var pickTag = el('span', 'lc-pill lc-ac-pill-pick');
      pickTag.appendChild(el('span', null, '★')).setAttribute('aria-hidden', 'true');
      pickTag.appendChild(document.createTextNode(' Today’s pick'));
      tags.appendChild(pickTag);
    }
    if (g.kind !== 'chance') { tags.appendChild(el('span', 'lc-pill lc-ac-pill-free', 'Free')); }
    if (grp === 'courses') {
      tags.appendChild(el('span', 'lc-pill lc-ac-pill-kind', A.kindLabel(g.kind)));
      if (A.tierLabel(g.tier)) { tags.appendChild(el('span', 'lc-pill lc-ac-tier lc-ac-tier--' + g.tier, A.tierLabel(g.tier))); }
    }
    if (tags.children.length) { top.appendChild(tags); }
    li.appendChild(top);

    var line = lineOf(g);
    if (line) { li.appendChild(el('p', 'lc-ac-game-line', line)); }

    var facts = el('dl', 'lc-ac-facts');
    if (g.kind === 'chance') {
      var stakes = stakesOf(g);
      if (stakes.length) {
        fact(facts, 'Tokens in', orList(stakes.map(D.count)) + (stakes.length === 1 && stakes[0] === 1 ? ' token' : ' tokens') +
          (hasOwn(EACH, g.id) ? ' each' : ''));
      }
      var back = A.giveBack(g);
      if (back !== null) { fact(facts, 'Gives back', 'about ' + back + ' of every 100 tokens' + (bestPlay(g) ? ' with the best play' : '')); }
      if (whole(g.dailyLimit) && g.dailyLimit > 0) { fact(facts, 'Plays a day', D.count(g.dailyLimit)); }
      var jOdds = jp ? jackpotOdds(jp) : '';
      if (jOdds && whole(jp.tokens)) { fact(facts, 'Jackpot now', tokens(jp.tokens) + ' · ' + jOdds, 'lc-ac-jackpot'); }
    } else {
      if (g.kind === 'golf' && courseText(g)) { fact(facts, 'Course', courseText(g)); }
      var rec = recordOf(g);
      if (rec) {
        var dd = el('dd', 'lc-ac-rec');
        dd.appendChild(el('span', 'lc-ac-rec-val', rec.text));
        if (rec.lowerIsBetter && rec.unit !== 'ms') { dd.appendChild(el('span', 'lc-ac-rec-hint', ' (fewer is better)')); }
        var meta = [];
        if (rec.at) { meta.push('set ' + D.agoWords(rec.at)); }
        if (rec.holder) { meta.push('by ' + rec.holder); }
        if (meta.length) {
          dd.appendChild(document.createTextNode(' '));
          dd.appendChild(el('span', 'lc-ac-rec-meta', meta.join(' ')));
        }
        fact(facts, recordLabel(g), dd);
      } else if (canHaveRecord(g)) {
        fact(facts, recordLabel(g), 'No record yet');
      }
    }
    // The Scratch Ticket isn't a /hcm play game: its tile is in the Arcade, and a click on it buys a ticket.
    if (g.id === SCRATCH) {
      fact(facts, 'Open it', codeDd('/hcm arcade', ', then its tile: a click buys a ticket'));
    } else {
      fact(facts, 'Open it', codeDd(A.playCommand(g)));
    }
    li.appendChild(facts);
    if (g.kind === 'chance') { addPays(li, g); }
    return li;
  }

  /* ---------- Today's pick, the jump links, the groups ---------- */

  /* The line under a whole world game's name: "Parkour, elytra and boat · 4 courses", "Mini golf · 2 courses". */
  function wholeMeta(f) {
    var kinds = [];
    A.GROUPS.forEach(function (grp) {
      grp.kinds.forEach(function (k) {
        if (A.kindLabel(k) && f.games.some(function (g) { return g.kind === k; })) { kinds.push(A.kindLabel(k).toLowerCase()); }
      });
    });
    return (kinds.length ? cap(andList(kinds)) + ' · ' : '') + plural(f.games.length, 'course', 'courses');
  }

  /* Today's pick; returns the ids of every card that is the pick ({ id: true }, empty when there is none). A whole
     world game (trials, golf) is every open course of that kind. */
  function renderPick(data) {
    var ids = Object.create(null);
    var f = A.featured(data);
    var left = f ? D.timeLeft(f.until) : '';
    if (!ui.pick || !f || !left) {
      if (ui.pick) { ui.pick.hidden = true; }
      return ids;
    }
    f.games.forEach(function (g) { ids[g.id] = true; });
    setText(ui.pickName, nameOf(f.game));
    setText(ui.pickMeta, f.game.whole ? wholeMeta(f) : metaOf(f.game));
    setText(ui.pickLeft, left);
    if (ui.pickCmd) { fillCode(ui.pickCmd, A.playCommand(f.game)); }
    setText(ui.pickBonus, f.game.whole ? PICK_BONUS_WHOLE : PICK_BONUS);
    ui.pick.hidden = false;
    return ids;
  }

  function renderJump(groups, on) {
    if (!ui.jump || !ui.jumpList) { return; }
    ui.jump.hidden = !on || groups.length < 2;
    var sig = groups.map(function (grp) { return grp.id + ':' + grp.games.length; }).join('|');
    if (ui.jump.hidden || sig === jumpSig) { return; }
    jumpSig = sig;
    ui.jumpList.textContent = '';
    groups.forEach(function (grp) {
      var li = el('li');
      var a = el('a', 'lc-ac-jump-link', grp.label);
      a.href = '#' + ANCHOR[grp.id];
      a.setAttribute('data-ac-key', 'jump:' + grp.id);
      a.appendChild(el('span', 'lc-sr', ', '));
      a.appendChild(el('span', 'lc-ac-jump-n', D.count(grp.games.length)));
      a.appendChild(el('span', 'lc-sr', grp.games.length === 1 ? ' game' : ' games'));
      li.appendChild(a);
      ui.jumpList.appendChild(li);
    });
  }

  function groupBox(grp) {
    if (groupEls[grp.id]) { return groupEls[grp.id]; }
    var wrap = el('div', 'lc-ac-group lc-ac-group--' + grp.id);
    wrap.id = ANCHOR[grp.id];
    var head = el('div', 'lc-ac-group-head');
    head.appendChild(el('h3', 'lc-ac-group-title', grp.label));
    var count = el('p', 'lc-ac-group-count');
    head.appendChild(count);
    var intro = el('p', 'lc-ac-group-intro', INTRO[grp.id] || '');
    // Luck: the way to Take a break on a line of its own, so its 44 px target (and focus ring) has room.
    var brk = null;
    if (grp.id === 'luck') {
      brk = el('p', 'lc-ac-break-line');
      var a = el('a', null, 'Set your own limit: Take a break');
      a.href = '#take-a-break';
      a.setAttribute('data-ac-key', 'break');
      brk.appendChild(a);
    }
    var list = el('ul', 'lc-ac-cards');
    list.setAttribute('role', 'list');
    wrap.appendChild(head);
    wrap.appendChild(intro);
    if (brk) { wrap.appendChild(brk); }
    wrap.appendChild(list);
    groupEls[grp.id] = { wrap: wrap, head: head, count: count, intro: intro, brk: brk, list: list };
    return groupEls[grp.id];
  }

  /* Cards are built once and again only when what they show changes, so focus and open tables survive a refresh. */
  function renderGames(res, list, has) {
    var data = res.data || {};
    var pickIds = renderPick(data);
    var on = has.games;
    // With the games off the feed has only the Scratch Ticket: no groups, no jump links, no Games-screen words.
    // "Everything open right now" is only said of the live feed (sample and stale have their own line above).
    if (ui.lede) { ui.lede.hidden = !on || res.mode !== 'live'; }
    var groups = grouped(list);
    renderJump(groups, on);
    var level = on ? 4 : 3;
    var j = A.jackpot(data);
    var keepGroup = Object.create(null), keepCard = Object.create(null);
    groups.forEach(function (grp, gi) {
      var box = groupBox(grp);
      keepGroup[grp.id] = true;
      box.head.hidden = !on;
      box.intro.hidden = !on;
      if (box.brk) { box.brk.hidden = !on; }
      var n = grp.games.length;
      setText(box.count, grp.id === 'courses' || grp.id === 'golf' ? plural(n, 'course', 'courses') : plural(n, 'game', 'games'));
      if (ui.groups.children[gi] !== box.wrap) { ui.groups.insertBefore(box.wrap, ui.groups.children[gi] || null); }
      grp.games.forEach(function (g, i) {
        var jp = j && j.game.id === g.id ? j : null;
        var sig = JSON.stringify([g, grp.id, level, pickIds[g.id] === true, jp ? jp.tokens : null, recordAgo(g)]);
        var c = cards[g.id];
        if (!c || c.sig !== sig) {
          var li = buildCard(g, grp.id, level, pickIds, jp);
          if (c && c.li.parentNode) { c.li.parentNode.replaceChild(li, c.li); }
          c = cards[g.id] = { sig: sig, li: li };
        }
        keepCard[g.id] = true;
        if (box.list.children[i] !== c.li) { box.list.insertBefore(c.li, box.list.children[i] || null); }
      });
      while (box.list.children.length > n) { box.list.removeChild(box.list.lastChild); }
    });
    Object.keys(groupEls).forEach(function (id) {
      if (!keepGroup[id] && groupEls[id].wrap.parentNode) { groupEls[id].wrap.parentNode.removeChild(groupEls[id].wrap); }
    });
    Object.keys(cards).forEach(function (id) {
      if (!keepCard[id]) {
        if (cards[id].li.parentNode) { cards[id].li.parentNode.removeChild(cards[id].li); }
        delete cards[id];
      }
    });
  }

  /* ---------- the Prize Counter, the Card Packs, the achievements ---------- */

  function costText(n) { return n === 0 ? 'Free' : tokens(n); }

  function renderPrizes(res) {
    if (!prizes) { return; }
    var groups = A.prizeGroups(res.data).map(function (grp) {
      return { label: grp.label, prizes: grp.prizes.filter(function (p) { return whole(p.cost) && nameOf(p); }) };
    }).filter(function (grp) { return grp.prizes.length > 0; });
    showSection(prizes.root, groups.length > 0);
    setNote(prizes.note, noteFor(res, false));
    var sig = JSON.stringify(groups);
    if (sig === prizes.sig) { return; }
    prizes.sig = sig;
    prizes.list.textContent = '';
    groups.forEach(function (grp) {
      var li = el('li', 'lc-card lc-ac-prizecat');
      li.appendChild(el('h3', 'lc-h3', grp.label));
      var ul = el('ul', 'lc-ac-prizes');
      ul.setAttribute('role', 'list');
      grp.prizes.forEach(function (p) {
        var row = el('li', 'lc-ac-prize');
        var head = el('p', 'lc-ac-prize-top');
        head.appendChild(el('span', 'lc-ac-prize-name', nameOf(p)));
        head.appendChild(el('span', 'lc-pill lc-pill--code', costText(p.cost)));
        row.appendChild(head);
        var desc = typeof p.description === 'string' ? p.description.trim() : '';
        if (desc) { row.appendChild(el('p', 'lc-ac-prize-desc', desc)); }
        ul.appendChild(row);
      });
      li.appendChild(ul);
      prizes.list.appendChild(li);
    });
  }

  function gem() {
    var s = svg(14, '0 0 24 24', ['M6 3h12l3 6-9 12L3 9z'], 'lc-gem');
    return s;
  }

  function renderPacks(res) {
    if (!packs) { return; }
    var data = res.data || {};
    var list = (Array.isArray(data.packs) ? data.packs : []).filter(function (p) {
      return !!p && whole(p.cost) && nameOf(p) && A.packOdds(p).length > 0;
    });
    showSection(packs.root, list.length > 0);
    setNote(packs.note, noteFor(res, false));
    var sig = JSON.stringify(list);
    if (sig === packs.sig) { return; }
    packs.sig = sig;
    packs.list.textContent = '';
    list.forEach(function (p) {
      var odds = A.packOdds(p);
      var total = odds.reduce(function (t, o) { return t + o.pct; }, 0) || 1;
      var li = el('li', 'lc-card lc-ac-pack');
      var top = el('div', 'lc-ac-pack-top');
      top.appendChild(el('h3', 'lc-h3 lc-ac-pack-name', nameOf(p)));
      top.appendChild(el('p', 'lc-pill lc-pill--code', costText(p.cost)));
      li.appendChild(top);
      var bar = el('p', 'lc-ac-oddsbar');
      bar.setAttribute('aria-hidden', 'true');
      odds.forEach(function (o) {
        var seg = el('span', 'lc-r--' + o.key);
        seg.style.width = (Math.round(o.pct / total * 1000) / 10) + '%';
        bar.appendChild(seg);
      });
      li.appendChild(bar);
      var ul = el('ul', 'lc-ac-rarities');
      ul.setAttribute('role', 'list');
      ul.setAttribute('aria-label', 'Chance of each rarity');
      odds.forEach(function (o) {
        var row = el('li', 'lc-r--' + o.key);
        var pill = el('span', 'lc-rarity');
        pill.appendChild(gem());
        pill.appendChild(document.createTextNode(o.name));
        row.appendChild(pill);
        row.appendChild(el('span', 'lc-ac-odds-pct', o.text));
        ul.appendChild(row);
      });
      li.appendChild(ul);
      packs.list.appendChild(li);
    });
  }

  function achsButton(n) {
    var b = achs.more;
    if (!b) { return; }
    b.hidden = n <= ACH_SHOWN;
    b.setAttribute('aria-expanded', state.achsOpen ? 'true' : 'false');
    setText(b, state.achsOpen ? 'Show fewer' : 'Show all ' + D.count(n) + ' achievements');
  }
  function achsShow() {
    [].forEach.call(achs.list.children, function (li, i) { li.hidden = !state.achsOpen && i >= ACH_SHOWN; });
  }

  function renderAchs(res) {
    if (!achs) { return; }
    var data = res.data || {};
    var list = (Array.isArray(data.achievements) ? data.achievements : []).filter(function (a) {
      return !!a && typeof a.name === 'string' && a.name.trim() !== '';
    });
    showSection(achs.root, list.length > 0);
    setNote(achs.note, noteFor(res, false));
    var sig = JSON.stringify(list);
    if (sig !== achs.sig) {
      achs.sig = sig;
      achs.list.textContent = '';
      var sum = 0;
      list.forEach(function (a) {
        var li = el('li', 'lc-ac-ach');
        var text = el('div', 'lc-ac-ach-text');
        var name = a.name.trim();
        text.appendChild(el('p', 'lc-ac-ach-name', name));
        var desc = typeof a.description === 'string' ? a.description.trim() : '';
        if (desc && desc !== name) { text.appendChild(el('p', 'lc-ac-ach-desc', desc)); }
        li.appendChild(text);
        if (whole(a.tokens)) {
          sum += a.tokens;
          li.appendChild(el('p', 'lc-ac-ach-tok', tokens(a.tokens)));
        }
        achs.list.appendChild(li);
      });
      if (achs.count) {
        setText(achs.count, plural(list.length, 'achievement', 'achievements') + (sum > 0 ? ' · ' + tokens(sum) + ' in all' : ''));
        achs.count.hidden = false;
      }
    }
    achsShow();
    achsButton(list.length);
  }

  if (achs && achs.more) {
    achs.more.addEventListener('click', function () {
      state.achsOpen = !state.achsOpen;
      var n = achs.list.children.length;
      achsShow();
      achsButton(n);
      if (state.achsOpen) {
        announce('Showing all ' + D.count(n) + ' achievements.');
      } else {
        // The list got shorter above the button: keep the button in view.
        achs.more.scrollIntoView({ block: 'nearest', behavior: 'instant' });
      }
    });
  }

  /* ---------- load, and refresh every Cache seconds while live ---------- */

  function render(res) {
    if (!res) { return; }
    state.res = res;
    var key = focusKey();
    var data = res.data || {};
    var list = openGames(data);
    renderStatus(res);
    var has = toggleParts(list);
    app.removeAttribute('aria-busy');
    setNote(ui.note, noteFor(res, true));
    showSection(app, list.length > 0);
    renderGames(res, list, has);
    renderPrizes(res);
    renderPacks(res);
    renderAchs(res);
    refocus(key);
  }

  D.watch('arcade', render);
  // Today's pick counts down and "set 3 minutes ago" moves on between refreshes (and sample data never refreshes).
  setInterval(function () {
    if (state.res && !document.hidden) { render(state.res); }
  }, 30000);
})();
