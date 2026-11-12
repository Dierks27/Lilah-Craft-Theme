/* LilahCraft Arcade page (templates/page-arcade.html): the live parts, from LCData ('arcade').
   The hero's status line and the holidays line; the token numbers in the static copy (the feed's reward rules when
   it has them, else the shipped numbers the template carries); the games, grouped like the in-game Games screen
   (Luck, Cabinets, Courses, Mini golf, Together) under Today's pick; the Fresh Courses set with its countdown, Star
   Chart, star times, course codes, Weekly Cups and boards; the Prize Counter's tabs, the Card Packs and the
   achievements; and the "Arcade sections" side menu, which marks the section being read (as on the Guide).
   The template's parts about games that aren't open (.lc-ac-if-games, -chance, -skill, -fresh, -cup, -clubhouse,
   -courses, -race, -golf, -boat, -friend) hide once the feed says so, a section the feed has nothing for hides
   whole, and the side menu drops what is hidden: the page shows exactly what the feed has.
   Feed text goes in with textContent only. No player data: the only names shown are a record's or a board row's
   holder and the Star Chart's, and only when the feed sends one (HomeCraftMgmt sends them only while its owner has
   names switched on). Server days and times are printed in the server's time zone, not the visitor's. */
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
  var DAY_MS = 86400000;
  var SERVER_ZONE = 'America/Chicago';

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

  /* ---------- the server's clock ----------
     Holiday days, a Fresh set's next change, a Cup's payout and the restarts are the server's, so they are printed in
     its zone (the rules' freshSet.zone, else US Central) and named ("Central time"). Without time zones in the
     browser they fall back to the visitor's clock, which is all it can print. */
  var WEEKDAYS = { Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday', Sun: 'Sunday' };
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var ZONE_WORDS = {
    'America/Chicago': 'Central time', 'America/New_York': 'Eastern time', 'America/Denver': 'Mountain time',
    'America/Phoenix': 'Mountain time', 'America/Los_Angeles': 'Pacific time'
  };
  function zoneOf(rules) { return rules && rules.freshSet ? rules.freshSet.zone : SERVER_ZONE; }
  function zoneWords(zone) {
    if (hasOwn(ZONE_WORDS, zone)) { return ZONE_WORDS[zone]; }
    return String(zone).split('/').pop().replace(/_/g, ' ') + ' time';
  }
  /* "04:00" is "4:00 AM", "16:00" "4:00 PM" */
  function clock(hhmm) {
    var h = parseInt(hhmm.slice(0, 2), 10), m = hhmm.slice(3, 5);
    return (h % 12 || 12) + ':' + m + (h < 12 ? ' AM' : ' PM');
  }
  var formats = {};
  /* The server's calendar and clock at `ms`: { wd: 'Mon', day: 16, mon: 'Nov', time: '4:00 AM' }. */
  function zoned(ms, zone) {
    var p = null;
    if (!formats[zone]) {
      try {
        formats[zone] = new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'short', day: 'numeric', month: 'numeric', hour: 'numeric', minute: '2-digit', hour12: false });
        if (!formats[zone].formatToParts) { formats[zone] = null; }
      } catch (e) { formats[zone] = null; }
    }
    if (formats[zone]) {
      p = {};
      try {
        formats[zone].formatToParts(ms).forEach(function (part) { p[part.type] = part.value; });
      } catch (e) { p = null; }
    }
    if (!p || !p.day || !p.month || !p.hour || !p.weekday) {
      var d = new Date(ms);
      p = { weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()], day: d.getDate(), month: d.getMonth() + 1,
        hour: String(d.getHours()), minute: ('0' + d.getMinutes()).slice(-2) };
    }
    var h = parseInt(p.hour, 10) % 24;
    return { wd: p.weekday, day: parseInt(p.day, 10), mon: MONTHS[parseInt(p.month, 10) - 1] || '', time: clock(('0' + h).slice(-2) + ':' + p.minute) };
  }
  function dayText(ms, zone) { var z = zoned(ms, zone); return z.day + ' ' + z.mon; }
  /* "Mon 16 Nov, 4:00 AM Central time" */
  function whenText(ms, zone) { var z = zoned(ms, zone); return z.wd + ' ' + z.day + ' ' + z.mon + ', ' + z.time + ' ' + zoneWords(zone); }
  /* Two days as one span: "22–30 Nov", "31 Dec – 1 Jan" */
  function spanText(a, b) {
    var sa = a.split(' '), sb = b.split(' ');
    if (a === b) { return a; }
    return sa[1] === sb[1] ? sa[0] + '–' + b : a + ' – ' + b;
  }
  /* A feed date ('2026-11-09') as "9 Nov" (it already is a server day: no zone to apply) */
  function feedDay(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
    return m && MONTHS[+m[2] - 1] ? +m[3] + ' ' + MONTHS[+m[2] - 1] : '';
  }

  /* ---------- words: facts from HomeCraftMgmt's games guide ---------- */

  /* One plain line per game. A game this list doesn't know gets its kind's line or, for a game of chance, the
     feed's own `rules` line. */
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
    tic_tac_toe: 'Three in a row on a 3 by 3 board, against the Arcade or a friend.',
    // The Fresh Courses the server builds
    fresh_rings: 'A 1 to 2 minute elytra loop through the rings. Your rockets have to last the whole run: there are none at the rings. A white ring means climb, so fire a rocket.',
    fresh_dropper: 'Levels that get harder, the last the Long Drop: 128 blocks straight down through dark floors. Land anywhere but water and it’s a bonk: back to the top of that level, clock still running.',
    fresh_dropper_easy: 'Three easy levels. Steer through the holes as you fall: every hole glows and the whole floor is water.',
    fresh_golf: 'Holes of four lengths, par 2 to 5, with a job for every club. Read the tee sign: it says what’s on the hole.',
    fresh_tiny_golf: 'Three short holes, with no water in play.',
    fresh_boat: 'One long boat run down a mountain, about 2 to 3 minutes, with drops, hairpins and signs that say what’s coming.'
  };
  var KIND_LINES = {
    parkour: 'Jump from the start to the finish through every checkpoint, against the clock.',
    elytra: 'Glide through every ring from the start to the finish, against the clock.',
    boat: 'Row your own boat through every checkpoint to the finish, against the clock.',
    dropper: 'Step off the ledge and steer through the holes in each floor as you fall. Land anywhere but water and it’s a bonk: back to the top of the level, clock still running.',
    golf: 'Putt your ball into the cup in as few strokes as you can: a ball you bought, one of your Minis (Java only) or plain white.',
    arena: 'The floor falls away under your feet, a block at a time. Last one standing wins, or play alone and see how long you last.'
  };
  /* Fresh parkour judges its checkpoints by the pad itself. */
  var FRESH_PARKOUR = ' On these courses a checkpoint counts only with your feet over its pad.';
  /* Under a game of chance's "What it pays" table. */
  var NOTES = {
    scratch_ticket: 'Three “Tokens back” squares return part of your tokens, and that isn’t a win. The jackpot starts at 50 tokens, grows by 1 with every ticket anyone buys (up to 1,000) and goes back to 50 when someone wins it.',
    ore_slots: 'Only the line between the arrows counts, and only its best result pays. Stone never pays.',
    twenty_one: 'Twenty-One! is 21 with your first two cards. The same total as the Arcade gives your tokens back. How you play changes how often each result comes up.',
    wheel: 'Where it stops is picked before the light moves, and the light always moves the same way.',
    higher_lower: 'A wrong guess, or the same card again, ends the run with nothing back. A 2 or an Ace after a right guess cashes you out, since no guess from there can grow your pot. The best play is to cash out after your first right guess.',
    coin_flip: 'The winner gets most of both players’ tokens, and the rest is gone. The player you ask needs Coin Flip invites on.'
  };
  var ANCHOR = { luck: 'luck', cabinets: 'cabinets', courses: 'courses', golf: 'mini-golf', together: 'together-games' };
  /* Games whose give-back assumes the best choices (/hcm arcade odds says "the best play gives back about…") */
  var BEST_PLAY = { twenty_one: true, higher_lower: true };
  /* Both players put in the same */
  var EACH = { coin_flip: true };
  var FRIEND_GAMES = ['connect_four', 'tic_tac_toe'];
  var RACE_KINDS = ['parkour', 'elytra', 'boat'];
  var UNITS = ['ms', 'points', 'flips', 'apples', 'wins'];

  /* The numbers the feed's rules carry, as HomeCraftMgmt ships them (the shipped numbers are the server's: nothing
     in its games config was changed). Used only while the feed has no rules (0.38.7, or games off). */
  var SHIPPED = {
    skillDailyCap: 60, chanceDailyLimit: 100, featuredBonus: 5,
    trials: { firstFinish: { easy: 10, medium: 15, hard: 25, extreme: 50 }, dailyCap: 40 },
    golf: { firstFinish: 15, parOrBetter: 5, holeInOne: 3, dailyCap: 50 }
  };
  /* What each cabinet pays as shipped: the six solo cabinets alike; Connect Four and Tic-Tac-Toe have no medals. */
  var SOLO_PAY = { milestone: 5, daily: 5, dailyCap: 15 }, DUEL_PAY = { daily: 5, dailyCap: 5 };
  var SHIPPED_CABINETS = {
    creeper_sweeper: SOLO_PAY, ore_merge: SOLO_PAY, snake: SOLO_PAY, mini_match: SOLO_PAY, simon_says: SOLO_PAY,
    whack_a_zombie: SOLO_PAY, connect_four: DUEL_PAY, tic_tac_toe: DUEL_PAY
  };
  /* A Fresh course's first finish in a weekly set (games.fresh.rewards, not in the feed). */
  var FRESH_FIRST = {
    fresh_parkour_easy: 10, fresh_parkour: 15, fresh_parkour_hard: 20, fresh_rings: 15, fresh_golf: 25,
    fresh_tiny_golf: 10, fresh_boat: 15, fresh_dropper_easy: 10, fresh_dropper: 15
  };
  /* Under each Prize Counter tab: what its prizes do once bought. */
  var TAB_NOTES = {
    boosts: 'Used up when you use them.',
    hunt: 'For finding wild Minis.',
    cosmetics: 'Shows are used up when you use them, one long show at a time and never in the games. Trails last 30 days. Launchers, the Firework Remote and collector trails are yours for good.',
    looks: 'Hats and caps last 90 days. Collectors (a year in the name) and golf balls are yours for good, and a golf ball is your ball in mini golf on Java and Bedrock.',
    perks: 'Yours for good.',
    trophies: 'Yours for good, numbered, with your name on it.',
    minis: 'The Rare Card and Trade In Cards are on this tab in game too.',
    keepers: 'One each and yours for good: never a present, never traded.'
  };

  /* ---------- the page's pieces ---------- */

  var status = $('[data-ac-status]', main);
  var statusText = status && $('[data-ac-status-text]', status);
  var holidaysLine = $('[data-ac-holidays]', main);
  var gamesTitle = $('.lc-ac-games-title', main);
  var GAMES_TITLE = gamesTitle ? gamesTitle.textContent : '';
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
  var freshRoot = $('[data-ac-fresh]', main);
  var fresh = freshRoot ? {
    root: freshRoot, note: $('[data-ac-note]', freshRoot), set: $('[data-ac-set]', freshRoot),
    label: $('[data-ac-set-label]', freshRoot), days: $('[data-ac-set-days]', freshRoot),
    next: $('[data-ac-set-next]', freshRoot), left: $('[data-ac-set-left]', freshRoot), when: $('[data-ac-set-when]', freshRoot),
    chart: $('[data-ac-star-chart]', freshRoot), best: $('[data-ac-star-best]', freshRoot),
    list: $('[data-ac-list]', freshRoot), classics: $('[data-ac-classics]', freshRoot), classicsList: $('[data-ac-classics-list]', freshRoot)
  } : null;
  function slot(sel) {
    var s = $(sel, main);
    return s ? { root: s, note: $('[data-ac-note]', s), list: $('[data-ac-list]', s), count: $('[data-ac-count]', s), more: $('[data-ac-more]', s), sig: null } : null;
  }
  var packs = slot('[data-ac-packs]'), achs = slot('[data-ac-achievements]');
  var prizeRoot = $('[data-ac-prizes]', main);
  var prizes = prizeRoot ? { root: prizeRoot, note: $('[data-ac-note]', prizeRoot), tabs: $('[data-ac-tabs]', prizeRoot), panels: $('[data-ac-panels]', prizeRoot), sig: null } : null;

  var state = { res: null, open: Object.create(null), stake: Object.create(null), achsOpen: false, tab: null };
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

  /* Times that move on by themselves ("set 3 hours ago", "4d 20h") are written by tickTimes(), so a card is only
     rebuilt when what it says changes, never because a minute went by. */
  function agoSpan(ms, before, short) {
    var s = el('span', null, (before || '') + (short ? D.ago(ms) : D.agoWords(ms)));
    s.setAttribute('data-ac-ago', String(ms));
    if (before) { s.setAttribute('data-ac-before', before); }
    if (short) { s.setAttribute('data-ac-short', ''); }
    return s;
  }
  function tickTimes() {
    all('[data-ac-ago]', main).forEach(function (n) {
      var t = Number(n.getAttribute('data-ac-ago'));
      setText(n, (n.getAttribute('data-ac-before') || '') + (n.hasAttribute('data-ac-short') ? D.ago(t) : D.agoWords(t)));
    });
    all('[data-ac-left]', main).forEach(function (n) {
      setText(n, D.timeLeft(Number(n.getAttribute('data-ac-left'))) || 'a moment');
    });
  }

  /* ---------- status, holidays and the rules' numbers ---------- */

  function updatedText(d) { return D.timeText(d.generatedAt || d.fetchedAt); }

  function renderStatus(res) {
    if (!status || !statusText) { return; }
    var t = updatedText(res.data || {}), text;
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

  /* One line for the holidays on the server's calendar (HomeCraftMgmt 0.38.8): running now, or starting within two
     weeks. They are the windows the long firework shows dress up for. */
  function renderHolidays(data, zone) {
    if (!holidaysLine) { return; }
    var list = A.holidays(data), now = [], soon = [];
    list.forEach(function (h) {
      var to = dayText(h.to, zone);
      (h.running ? now : soon).push(h.name + (h.running ? ', until ' + to : ', ' + spanText(dayText(h.from, zone), to)));
    });
    var parts = [];
    if (now.length) { parts.push('Now on the server: ' + now.join('; ') + '.'); }
    if (soon.length) { parts.push((now.length ? 'Coming up: ' : 'Coming up on the server: ') + soon.join('; ') + '.'); }
    if (parts.length) { parts.push('The long firework shows fire in holiday colours.'); }
    setText(holidaysLine, parts.join(' '));
    holidaysLine.hidden = !parts.length;
  }

  /* "every Monday at 4:00 AM", "every day at 4:00 AM", "every 3 days at 4:00 AM" */
  function setWhen(fs) {
    var m = /^(?:(Mon|Tue|Wed|Thu|Fri|Sat|Sun) )?(\d\d:\d\d)$/.exec(fs.at);
    if (!m) { return null; }
    var at = ' at ' + clock(m[2]);
    if (m[1] && fs.everyDays % 7 === 0) {
      return 'every ' + (fs.everyDays === 7 ? '' : fs.everyDays / 7 + ' weeks on ') + WEEKDAYS[m[1]] + at;
    }
    return fs.everyDays === 1 ? 'every day' + at : 'every ' + fs.everyDays + ' days' + at;
  }
  function rulePath(r, key) {
    return key.split('.').reduce(function (o, k) { return hasOwn(o, k) ? o[k] : undefined; }, r);
  }
  /* First finishes of a weekly set, from the set the feed has: ['10 to 25', '120'], or null when the set isn't weekly
     or has a course whose amount isn't known. */
  function setFirsts(set, r) {
    if (!set || !set.games.length || set.cadence !== 7 || (r && r.freshSet && r.freshSet.everyDays !== 7)) { return null; }
    var amounts = set.games.map(function (g) { return hasOwn(FRESH_FIRST, g.id) ? FRESH_FIRST[g.id] : null; });
    if (amounts.indexOf(null) > -1) { return null; }
    var lo = Math.min.apply(null, amounts), hi = Math.max.apply(null, amounts);
    return [lo === hi ? String(lo) : lo + ' to ' + hi, D.count(amounts.reduce(function (t, n) { return t + n; }, 0))];
  }
  /* A [data-ac-n] number: a string to print, undefined to keep the shipped text, or null when the server has it
     switched off (the rules leave it out), which hides its sentence. */
  function ruleValue(key, r, set, mode) {
    if (key === 'zone') { return zoneWords(zoneOf(r)); }
    if (key === 'setFirst' || key === 'setTotal') {
      // Only a real set (live or last known) says what the server's set pays: the sample's few courses don't.
      if (mode === 'sample') { return undefined; }
      var f = setFirsts(set, r);
      return f ? f[key === 'setFirst' ? 0 : 1] : null;
    }
    if (!r) { return undefined; }
    if (key === 'freshWhen') { return r.freshSet ? setWhen(r.freshSet) : null; }
    if (key === 'restarts') { return r.restarts ? andList(r.restarts.map(clock)) : null; }
    var v = rulePath(r, key);
    return whole(v) ? D.count(v) : null;
  }
  function applyRules(r, set, mode) {
    var spans = all('[data-ac-n]', main), hide = [];
    spans.forEach(function (n) {
      if (!n.hasAttribute('data-ac-shipped')) { n.setAttribute('data-ac-shipped', n.textContent); }
      var v = ruleValue(n.getAttribute('data-ac-n'), r, set, mode);
      setText(n, v === undefined || v === null ? n.getAttribute('data-ac-shipped') : v);
      var host = n.closest('li, p');
      if (host && v === null) { hide.push(host); }
    });
    spans.forEach(function (n) { var host = n.closest('li, p'); if (host) { host.hidden = hide.indexOf(host) > -1; } });
  }
  /* A number from the rules, or the shipped one while the feed has none; null when the server has it off. */
  function num(r, key) {
    var v = rulePath(r || SHIPPED, key);
    return whole(v) && v > 0 ? v : null;
  }

  /* The line over each live section: a sentence over the games, a short label over the rest. '' when live. */
  function noteFor(res, long) {
    var t = updatedText(res.data || {});
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
     feed even while the games are off. The Clubhouse goes by the feed's word when it has one (0.38.8), else by
     whether the games are on. */
  function toggleParts(list, set, data) {
    var has = { games: false, chance: false, skill: false, fresh: !!set, cup: false, clubhouse: false, courses: false, race: false, golf: false, boat: false, friend: false };
    list.forEach(function (g) {
      if (g.id === SCRATCH) { return; }
      has.games = true;
      if (g.kind === 'chance') { has.chance = true; } else { has.skill = true; }
      if (g.kind === 'golf' || A.groupOf(g.kind) === 'courses') { has.courses = true; }
      if (RACE_KINDS.indexOf(g.kind) > -1) { has.race = true; }
      if (g.kind === 'golf') { has.golf = true; }
      if (g.kind === 'boat') { has.boat = true; }
      if (FRIEND_GAMES.indexOf(g.id) > -1) { has.friend = true; }
      if (A.cup(g)) { has.cup = true; }
    });
    var open = A.clubhouseOpen(data);
    has.clubhouse = open === true || (open === null && has.games);
    Object.keys(has).forEach(function (k) {
      all('.lc-ac-if-' + k, main).forEach(function (node) { node.hidden = !has[k]; });
    });
    return has;
  }

  /* The games by tab, like LCData.arcade.byGroup(), with the courses easiest first (as /hcm play trials lists them).
     Fresh Courses have a section of their own. */
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
  /* A Fresh set in the order the game announces it: parkour easiest first, Sky Rings, the Ice Boat, the Droppers
     (easy first), then golf in the feed's order. */
  var FRESH_ORDER = ['parkour', 'elytra', 'boat', 'dropper', 'golf'];
  function freshSorted(list) {
    return list.map(function (g, i) { return { g: g, i: i }; }).sort(function (a, b) {
      return (FRESH_ORDER.indexOf(a.g.kind) - FRESH_ORDER.indexOf(b.g.kind)) ||
        (a.g.kind === 'golf' ? 0 : tierRank(a.g) - tierRank(b.g)) || (a.i - b.i);
    }).map(function (x) { return x.g; });
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
    if (hasOwn(KIND_LINES, g.kind)) { return KIND_LINES[g.kind] + (g.kind === 'parkour' && A.isFresh(g) ? FRESH_PARKOUR : ''); }
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
    if (A.isFresh(g)) { parts.push(A.fresh(g).classic ? 'Classic' : 'Fresh Course'); }
    return parts.filter(Boolean).join(' · ');
  }
  /* Creeper Sweeper's record is on its Normal board, Connect Four's on Hard. */
  function recordLabel(g) {
    var b = g.kind === 'cabinet' && typeof g.board === 'string' ? g.board.trim() : '';
    return 'Record' + (b && ['classic', 'wins'].indexOf(b.toLowerCase()) < 0 ? ' (' + cap(b) + ')' : '');
  }
  /* Whether "No record yet" is true: a board the site can read, with nothing on it. Falling Floors has no record. */
  function canHaveRecord(g) {
    if (g.kind === 'arena') { return false; }
    return g.kind === 'cabinet' ? UNITS.indexOf(g.unit) > -1 : g.kind !== 'chance';
  }
  /* A date more than a day ahead is a clock or unit slip upstream: shown without it. */
  function sane(ms) { return ms && ms <= Date.now() + DAY_MS ? ms : null; }
  /* LCData.arcade.record(), shown only with a score that reads (none below zero). */
  function recordOf(g) {
    var r = A.record(g);
    if (!r || !(r.value >= 0) || !r.text) { return null; }
    r.at = sane(r.at);
    return r;
  }
  /* LCData.arcade.top(), rows with a score that reads. */
  function boardOf(g) {
    return A.top(g).filter(function (r) { return r.value >= 0 && r.text; }).map(function (r) { r.at = sane(r.at); return r; });
  }
  /* The jackpot's own odds, from the paytable row HomeCraftMgmt names "the jackpot" (never a row that happens to pay
     the same as the pot: at 50 that would be the "50 tokens" row). '' when that row isn't there (then no pot is shown). */
  function jackpotOdds(j) {
    var row = (Array.isArray(j.game.paytable) ? j.game.paytable : []).filter(function (r) {
      return !!r && /jackpot/i.test(String(r.combo)) && A.odds(r) !== '';
    })[0];
    return row ? A.odds(row) : '';
  }
  /* What a cabinet pays: "5 for today’s goal, 5 a medal (once each), up to 15 a day"; '' when nothing is known. */
  function cabinetPays(g, r) {
    var p = r ? (r.cabinets && hasOwn(r.cabinets, g.id) ? r.cabinets[g.id] : null) : (hasOwn(SHIPPED_CABINETS, g.id) ? SHIPPED_CABINETS[g.id] : null);
    if (!p) { return ''; }
    var parts = [];
    if (whole(p.daily)) { parts.push(D.count(p.daily) + ' for today’s goal'); }
    if (whole(p.milestone)) { parts.push(D.count(p.milestone) + ' a medal (once each)'); }
    if (whole(p.dailyCap)) { parts.push('up to ' + D.count(p.dailyCap) + ' a day'); }
    return parts.join(', ');
  }
  /* What a course pays for its first finish: a Fresh course's in this weekly set, a hand-built one's once ever. */
  function firstFinish(g, r, set) {
    if (A.isFresh(g)) {
      var f = A.fresh(g);
      return !f.classic && set && setFirsts(set, r) && hasOwn(FRESH_FIRST, g.id) ? tokens(FRESH_FIRST[g.id]) + ', once this set' : '';
    }
    var n = g.kind === 'golf' ? num(r, 'golf.firstFinish') : num(r, 'trials.firstFinish.' + g.tier);
    return n ? tokens(n) + ', once ever' : '';
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
  /* Stars as the game draws them ("★★★"), read out as words */
  function stars(n) {
    var s = el('span', 'lc-ac-stars');
    s.appendChild(el('span', null, new Array(n + 1).join('★'))).setAttribute('aria-hidden', 'true');
    s.appendChild(el('span', 'lc-sr', n + ' stars'));
    return s;
  }

  function table(caption, heads, rows, cls) {
    var t = el('table', 'lc-ac-table' + (cls ? ' ' + cls : ''));
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
        var cell = el(i ? 'td' : 'th', heads[i][1] || null);
        if (c && c.nodeType) { cell.appendChild(c); } else { cell.textContent = c == null ? '' : c; }
        if (!i) { cell.setAttribute('scope', 'row'); }
        r.appendChild(cell);
      });
      body.appendChild(r);
    });
    t.appendChild(body);
    return t;
  }

  /* A disclosure under a card ("What it pays", "Top 5"): a button, then its panel. The game's name rides along for
     screen readers and voice control, since every card has one. */
  function disclosure(li, key, label, g, fill) {
    var id = 'lc-ac-panel-' + (++uid);
    var open = !!state.open[key];
    var btn = el('button', 'lc-ac-toggle');
    btn.type = 'button';
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    btn.setAttribute('aria-controls', id);
    btn.setAttribute('data-ac-key', key);
    var what = el('span', null, label);
    what.appendChild(el('span', 'lc-sr', ', ' + nameOf(g)));
    btn.appendChild(what);
    btn.appendChild(chevron());
    var panel = el('div', 'lc-ac-pays');
    panel.id = id;
    panel.hidden = !open;
    fill(panel);
    btn.addEventListener('click', function () {
      var on = btn.getAttribute('aria-expanded') !== 'true';
      state.open[key] = on;
      btn.setAttribute('aria-expanded', on ? 'true' : 'false');
      panel.hidden = !on;
    });
    li.appendChild(btn);
    li.appendChild(panel);
  }

  /* ---------- What it pays (games of chance) ---------- */

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
    // Twenty-One: what a win, a Twenty-One! and a doubled win give back at this stake (a doubled win only when the
    // feed has it).
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
    // (250 tokens, which the feed doesn't carry), so the top pot is never worked out as stake × multiplier.
    var cashAt = D.isNum(g.maxMultiplier) && g.maxMultiplier > 1 ?
      'when it reaches ' + times(g.maxMultiplier) + ' times your tokens in or 250 tokens, whichever is lower' : '';
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
    disclosure(li, 'pays:' + g.id, 'What it pays', g, function (panel) {
      var body = el('div', 'lc-ac-pays-body');
      if (stakes.length > 1) {
        var pickRow = el('div', 'lc-ac-stakes');
        var label = el('span', 'lc-ac-stakes-label', 'Tokens in');
        label.appendChild(el('span', 'lc-sr', ', ' + nameOf(g)));
        label.id = panel.id + '-in';
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
    });
  }

  /* ---------- a board's top five ---------- */

  function addBoard(li, g, rows) {
    if (!rows.length) { return; }
    var unit = rows[0].unit;
    var names = rows.some(function (r) { return !!r.holder; });
    var label = 'Top ' + rows.length + (g.kind === 'arena' ? ' this week' : (A.isFresh(g) && !A.fresh(g).classic ? ' this set' : ''));
    disclosure(li, 'top:' + g.id, label, g, function (panel) {
      var heads = [['Place'], [unit === 'ms' ? 'Time' : (unit === 'strokes' ? 'Strokes' : 'Score'), 'lc-ac-num'], ['Set']];
      if (names) { heads.push(['Player']); }
      panel.appendChild(table('Top ' + rows.length + ' on ' + nameOf(g) + (g.kind === 'arena' ? ', longest first' : ''), heads, rows.map(function (r) {
        var cells = [D.count(r.rank), r.text, r.at ? agoSpan(r.at, '', true) : ''];
        if (names) { cells.push(r.holder || ''); }
        return cells;
      }), 'lc-ac-board'));
      if (g.kind !== 'arena' && A.lowerIsBetter(g) && unit !== 'ms') { panel.appendChild(el('p', 'lc-ac-pays-note', 'Fewer is better. Ties share a place.')); }
    });
  }

  /* ---------- a game's card ---------- */

  function pill(cls, text) { return el('span', 'lc-pill ' + cls, text); }

  function buildCard(g, ctx) {
    var li = el('li', 'lc-ac-game lc-ac-game--' + ctx.grp);
    var top = el('div', 'lc-ac-game-top');
    top.appendChild(el('h' + ctx.level, 'lc-ac-game-name', nameOf(g)));
    // A closed game of chance: its name and that it's closed, nothing else.
    if (A.closed(g)) {
      li.appendChild(top);
      li.appendChild(el('p', 'lc-ac-game-line', 'Closed right now.'));
      return li;
    }
    var f = A.isFresh(g) ? A.fresh(g) : null;
    var tags = el('p', 'lc-ac-tags');
    if (ctx.pick) {
      var pickTag = pill('lc-ac-pill-pick', null);
      pickTag.appendChild(el('span', null, '★')).setAttribute('aria-hidden', 'true');
      pickTag.appendChild(document.createTextNode(' Today’s pick'));
      tags.appendChild(pickTag);
    }
    if (g.kind !== 'chance') { tags.appendChild(pill('lc-ac-pill-free', 'Free')); }
    if (A.groupOf(g.kind) === 'courses' || (f && g.kind === 'golf')) {
      tags.appendChild(pill('lc-ac-pill-kind', A.kindLabel(g.kind)));
      if (A.tierLabel(g.tier)) { tags.appendChild(pill('lc-ac-tier lc-ac-tier--' + g.tier, A.tierLabel(g.tier))); }
    }
    if (f && f.classic) { tags.appendChild(pill('lc-ac-pill-kind', 'Classic')); }
    if (tags.children.length) { top.appendChild(tags); }
    li.appendChild(top);

    var line = lineOf(g);
    if (line) { li.appendChild(el('p', 'lc-ac-game-line', line)); }

    var facts = el('dl', 'lc-ac-facts');
    var board = boardOf(g);
    if (g.kind === 'chance') {
      var stakes = stakesOf(g);
      if (stakes.length) {
        fact(facts, 'Tokens in', orList(stakes.map(D.count)) + (stakes.length === 1 && stakes[0] === 1 ? ' token' : ' tokens') +
          (hasOwn(EACH, g.id) ? ' each' : ''));
      }
      var back = A.giveBack(g);
      if (back !== null) { fact(facts, 'Gives back', 'about ' + back + ' of every 100 tokens' + (bestPlay(g) ? ' with the best play' : '')); }
      if (whole(g.dailyLimit) && g.dailyLimit > 0) { fact(facts, 'Plays a day', D.count(g.dailyLimit)); }
      var jOdds = ctx.jp ? jackpotOdds(ctx.jp) : '';
      if (jOdds && whole(ctx.jp.tokens)) { fact(facts, 'Jackpot now', tokens(ctx.jp.tokens) + ' · ' + jOdds, 'lc-ac-jackpot'); }
    } else {
      if (f && f.code) {
        var code = el('dd', 'lc-ac-mono', f.code);
        fact(facts, 'Course code', code);
      }
      if (f && f.track) { fact(facts, 'Track', f.track); }
      if (g.kind === 'golf' && courseText(g)) { fact(facts, 'Course', cap(courseText(g))); }
      if (g.kind === 'arena' && A.shapeLabel(g.shape)) { fact(facts, 'This week’s floor', cap(A.shapeLabel(g.shape))); }
      if (f) {
        // One line per star count: "★★★ under 0:24.0, no bonks", "★★ under 0:35.0"; golf goes by par. The lines
        // are blocks on screen; a hidden ". " keeps them apart when read as one text.
        var sdd = el('dd', 'lc-ac-starlist');
        var starLine = function (n, text) {
          var s = el('span', 'lc-ac-starline');
          s.appendChild(stars(n));
          s.appendChild(document.createTextNode(text));
          s.appendChild(el('span', 'lc-sr', '. '));
          sdd.appendChild(s);
        };
        if (g.kind === 'golf') {
          starLine(3, ' at par or better');
        } else {
          f.stars.forEach(function (s) {
            starLine(s.stars, ' under ' + s.text + (s.stars === 3 && g.kind === 'dropper' && g.tier === 'hard' ? ', no bonks' : ''));
          });
        }
        if (sdd.childNodes.length) { fact(facts, 'Stars', sdd); }
      }
      var rec = recordOf(g);
      if (rec) {
        var dd = el('dd', 'lc-ac-rec');
        dd.appendChild(el('span', 'lc-ac-rec-val', rec.text));
        if (rec.lowerIsBetter && rec.unit !== 'ms') { dd.appendChild(el('span', 'lc-ac-rec-hint', ' (fewer is better)')); }
        if (rec.at || rec.holder) {
          var meta = el('span', 'lc-ac-rec-meta');
          if (rec.at) { meta.appendChild(agoSpan(rec.at, 'set ')); }
          if (rec.holder) { meta.appendChild(document.createTextNode((rec.at ? ' ' : '') + 'by ' + rec.holder)); }
          dd.appendChild(document.createTextNode(' '));
          dd.appendChild(meta);
        }
        fact(facts, recordLabel(g), dd);
      } else if (g.kind === 'arena' && board.length) {
        fact(facts, 'Longest this week', board[0].text);
      } else if (canHaveRecord(g)) {
        fact(facts, recordLabel(g), 'No record yet');
      }
      var c = A.cup(g);
      if (c) {
        var cdd = el('dd', 'lc-ac-cup');
        // Two lines on screen, two sentences when read ("Cup pool: 50 tokens · 3 entered. 10 tokens to enter…"), so a
        // head count never runs into the entry as if it were odds. The no-break space keeps "3 entered" together on a phone.
        cdd.appendChild(el('span', 'lc-ac-cup-pool', c.entrants > 0 ? 'Cup pool: ' + tokens(c.pool) + ' · ' + D.count(c.entrants) + ' entered' : 'Nobody entered yet'));
        cdd.appendChild(el('span', 'lc-sr', '. '));
        cdd.appendChild(el('span', 'lc-ac-dd-after', tokens(c.entry) + ' to enter · pays out ' + whenText(c.endsAt, ctx.zone)));
        fact(facts, 'Weekly Cup', cdd, 'lc-ac-cuprow');
      }
      var pays = g.kind === 'cabinet' ? cabinetPays(g, ctx.rules) : (g.kind === 'arena' ? '' : firstFinish(g, ctx.rules, ctx.set));
      if (pays) { fact(facts, g.kind === 'cabinet' ? 'Pays' : 'First finish', pays); }
    }
    // The Scratch Ticket isn't a /hcm play game: its tile is in the Arcade, and a click on it buys a ticket.
    if (g.id === SCRATCH) {
      fact(facts, 'Open it', codeDd('/hcm arcade', ', then its tile: a click buys a ticket'));
    } else {
      fact(facts, 'Open it', codeDd(A.playCommand(g)));
    }
    li.appendChild(facts);
    if (g.kind === 'chance') { addPays(li, g); } else { addBoard(li, g, board); }
    return li;
  }

  /* A card from cache, or built again when what it shows has changed, so focus and open tables survive a refresh. */
  function cardFor(g, ctx) {
    var sig = JSON.stringify([g, ctx.grp, ctx.level, ctx.pick, ctx.jp ? ctx.jp.tokens : null, ctx.zone, !!A.cup(g),
      g.kind === 'cabinet' ? cabinetPays(g, ctx.rules) : firstFinish(g, ctx.rules, ctx.set)]);
    var c = cards[g.id];
    if (!c || c.sig !== sig) {
      var li = buildCard(g, ctx);
      if (c && c.li.parentNode) { c.li.parentNode.replaceChild(li, c.li); }
      c = cards[g.id] = { sig: sig, li: li };
    }
    return c.li;
  }
  /* Put these cards in this list, in this order, and nothing else. */
  function fillList(list, lis) {
    lis.forEach(function (li, i) { if (list.children[i] !== li) { list.insertBefore(li, list.children[i] || null); } });
    while (list.children.length > lis.length) { list.removeChild(list.lastChild); }
  }

  /* ---------- Today's pick, the jump links, the groups ---------- */

  /* The line under a whole world game's name: "Parkour, elytra and dropper · 4 courses", "Mini golf · 2 courses". */
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
  function renderPick(data, r, zone) {
    var ids = Object.create(null);
    var f = A.featured(data);
    if (!ui.pick || !f || !D.timeLeft(f.until)) {
      if (ui.pick) { ui.pick.hidden = true; }
      return ids;
    }
    f.games.forEach(function (g) { ids[g.id] = true; });
    setText(ui.pickName, nameOf(f.game));
    setText(ui.pickMeta, f.game.whole ? wholeMeta(f) : metaOf(f.game));
    if (ui.pickLeft) { ui.pickLeft.setAttribute('data-ac-left', String(f.until)); }
    if (ui.pickCmd) { fillCode(ui.pickCmd, A.playCommand(f.game)); }
    var bonus = num(r, 'featuredBonus');
    var first = f.game.whole ? 'Your first finish of one of these courses today pays ' :
      (f.game.kind === 'arena' ? 'Your first full round of it today pays ' : 'Your first finish of it today pays ');
    setText(ui.pickBonus, (bonus ? first +
      plural(bonus, 'extra token', 'extra tokens') + '. ' : '') + 'The next pick comes at midnight ' + zoneWords(zone) + '.');
    ui.pick.hidden = false;
    return ids;
  }

  function renderJump(groups, set, on) {
    if (!ui.jump || !ui.jumpList) { return; }
    var links = groups.map(function (grp) { return { id: grp.id, href: ANCHOR[grp.id], label: grp.label, n: grp.games.length }; });
    if (set) { links.push({ id: 'fresh', href: 'fresh', label: 'Fresh Courses', n: set.games.length + set.classics.length }); }
    ui.jump.hidden = !on || links.length < 2;
    var sig = JSON.stringify(links);
    if (ui.jump.hidden || sig === jumpSig) { return; }
    jumpSig = sig;
    ui.jumpList.textContent = '';
    links.forEach(function (l) {
      var li = el('li');
      var a = el('a', 'lc-ac-jump-link', l.label);
      a.href = '#' + l.href;
      a.setAttribute('data-ac-key', 'jump:' + l.id);
      a.appendChild(el('span', 'lc-sr', ', '));
      a.appendChild(el('span', 'lc-ac-jump-n', D.count(l.n)));
      a.appendChild(el('span', 'lc-sr', l.id === 'fresh' || l.id === 'courses' || l.id === 'golf' ? (l.n === 1 ? ' course' : ' courses') : (l.n === 1 ? ' game' : ' games')));
      li.appendChild(a);
      ui.jumpList.appendChild(li);
    });
  }

  /* A group's intro, with the numbers the server pays by. */
  function introOf(id, r) {
    if (id === 'luck') {
      var lim = num(r, 'chanceDailyLimit');
      return 'Tokens in, tokens back. Each game shows what it gives back and what it pays, and over many plays every one gives back less than goes in.' +
        (lim ? ' Together they take at most ' + tokens(lim) + ' a day.' : '');
    }
    if (id === 'cabinets') { return 'Free: no tokens go in. Medals and each day’s goal pay tokens, as each card says. Your first try each day is the one that counts for the goal.'; }
    if (id === 'courses') {
      var cap1 = num(r, 'trials.dailyCap');
      return 'Time trials in the Games world, built by hand. Free, as many runs as you like. Starting one asks Warm up (3:00) or Go straight to the timed run.' +
        (cap1 ? ' Time trials pay up to ' + tokens(cap1) + ' a day, first finishes on top.' : '');
    }
    if (id === 'golf') {
      var par = num(r, 'golf.parOrBetter'), ace = num(r, 'golf.holeInOne'), cap2 = num(r, 'golf.dailyCap'), bits = [];
      if (par) { bits.push(tokens(par) + ' for a round at par or better'); }
      if (ace) { bits.push(D.count(ace) + ' for each hole-in-one'); }
      return 'Mini golf in the Games world. Free, as many rounds as you like.' + (bits.length ? ' ' + cap(andList(bits)) + ', once a day each' : '') +
        (bits.length && cap2 ? ', up to ' + tokens(cap2) + ' a day.' : (bits.length ? '.' : ''));
    }
    if (id === 'together') { return 'Free, with everyone who’s in.'; }
    return '';
  }

  function groupBox(grp) {
    if (groupEls[grp.id]) { return groupEls[grp.id]; }
    var wrap = el('div', 'lc-ac-group lc-ac-group--' + grp.id);
    wrap.id = ANCHOR[grp.id];
    var head = el('div', 'lc-ac-group-head');
    head.appendChild(el('h3', 'lc-ac-group-title', grp.label));
    var count = el('p', 'lc-ac-group-count');
    head.appendChild(count);
    var intro = el('p', 'lc-ac-group-intro');
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

  function renderGames(res, list, has, set, ctx0) {
    var data = res.data || {};
    var pickIds = renderPick(data, ctx0.rules, ctx0.zone);
    var on = has.games;
    var others = list.filter(function (g) { return !A.isFresh(g); });
    var groups = grouped(others);
    // With the games off the feed has only the Scratch Ticket: no groups, no jump links, no Games-screen words, and
    // the section and its menu entry are named for what is there.
    var title = on ? GAMES_TITLE : (others.length === 1 ? nameOf(others[0]) : GAMES_TITLE);
    setText(gamesTitle, title);
    all('[data-ac-games-label]', main).forEach(function (a) { setText(a, title); });
    // "Everything open right now" is only said of the live feed (sample and stale have their own line above).
    if (ui.lede) { ui.lede.hidden = !on || res.mode !== 'live'; }
    showSection(app, groups.length > 0 || (!!ui.pick && !ui.pick.hidden));
    renderJump(groups, set, on);
    var level = on ? 4 : 3;
    var j = A.jackpot(data);
    var keepGroup = Object.create(null);
    groups.forEach(function (grp, gi) {
      var box = groupBox(grp);
      keepGroup[grp.id] = true;
      box.head.hidden = !on;
      box.intro.hidden = !on;
      setText(box.intro, introOf(grp.id, ctx0.rules));
      if (box.brk) { box.brk.hidden = !on; }
      var n = grp.games.length;
      setText(box.count, grp.id === 'courses' || grp.id === 'golf' ? plural(n, 'course', 'courses') : plural(n, 'game', 'games'));
      if (ui.groups.children[gi] !== box.wrap) { ui.groups.insertBefore(box.wrap, ui.groups.children[gi] || null); }
      fillList(box.list, grp.games.map(function (g) {
        return cardFor(g, { grp: grp.id, level: level, pick: pickIds[g.id] === true, jp: j && j.game.id === g.id ? j : null, rules: ctx0.rules, zone: ctx0.zone, set: set });
      }));
    });
    Object.keys(groupEls).forEach(function (id) {
      if (!keepGroup[id] && groupEls[id].wrap.parentNode) { groupEls[id].wrap.parentNode.removeChild(groupEls[id].wrap); }
    });
    return pickIds;
  }

  /* ---------- Fresh Courses ---------- */

  function renderFresh(res, set, pickIds, ctx0) {
    if (!fresh) { return; }
    setNote(fresh.note, noteFor(res, false));
    if (!set) { fillList(fresh.list, []); fillList(fresh.classicsList, []); return; }
    var data = res.data || {}, now = Date.now();
    var ended = set.games.length > 0 && set.games.every(function (g) { var f = A.fresh(g); return f.to !== null && f.to <= now; });
    setText(fresh.label, ended ? 'The last known courses' : set.label);
    var days = feedDay(set.day), last = feedDay(set.lastDay);
    setText(fresh.days, days ? (last ? spanText(days, last) : 'From ' + days) : '');
    fresh.days.hidden = !days;
    var nextAt = ended ? null : set.nextAt;
    fresh.next.hidden = !nextAt;
    if (nextAt) { fresh.left.setAttribute('data-ac-left', String(nextAt)); } else { fresh.left.removeAttribute('data-ac-left'); }
    setText(fresh.when, nextAt ? 'The next set goes up ' + whenText(nextAt, ctx0.zone) + '.' : (ended ? 'This set has ended; the next one is up in game.' : ''));
    fresh.when.hidden = !fresh.when.textContent;
    // The Star Chart is this week's: an old copy whose set has ended doesn't show it.
    var chart = ended ? null : A.starChart(data);
    fresh.chart.hidden = !chart;
    if (chart) {
      setText(fresh.best, chart.best === null ? 'No stars yet this week' : 'Most so far: ' + plural(chart.best, 'star', 'stars') + (chart.holder ? ', ' + chart.holder : ''));
    }
    fresh.set.hidden = false;
    // The set's cards are h3s beside the set's box; the Classics' are h4s under their "Classics" h3.
    var ctx = function (g, level) { return { grp: 'fresh', level: level || 3, pick: pickIds[g.id] === true, jp: null, rules: ctx0.rules, zone: ctx0.zone, set: set }; };
    fillList(fresh.list, freshSorted(set.games).map(function (g) { return cardFor(g, ctx(g)); }));
    fillList(fresh.classicsList, freshSorted(set.classics).map(function (g) { return cardFor(g, ctx(g, 4)); }));
    fresh.classics.hidden = !set.classics.length;
  }

  /* ---------- the Prize Counter: one tab at a time, as in game ---------- */

  function costText(n) { return n === 0 ? 'Free' : tokens(n); }

  function selectTab(id, focus) {
    if (!prizes) { return; }
    state.tab = id;
    all('[role="tab"]', prizes.tabs).forEach(function (t) {
      var on = t.getAttribute('data-ac-tab') === id;
      t.setAttribute('aria-selected', on ? 'true' : 'false');
      t.tabIndex = on ? 0 : -1;
      if (on && focus) { t.focus(); }
    });
    all('[role="tabpanel"]', prizes.panels).forEach(function (p) { p.hidden = p.getAttribute('data-ac-tab') !== id; });
  }

  function renderPrizes(res) {
    if (!prizes) { return; }
    var groups = A.prizeGroups(res.data).map(function (grp) {
      return { id: grp.id, label: grp.label, prizes: grp.prizes.filter(function (p) { return whole(p.cost) && nameOf(p); }) };
    }).filter(function (grp) { return grp.prizes.length > 0; });
    prizes.tabs.hidden = !groups.length;
    setNote(prizes.note, noteFor(res, false));
    var sig = JSON.stringify(groups);
    if (sig === prizes.sig) { return; }
    prizes.sig = sig;
    prizes.tabs.textContent = '';
    prizes.panels.textContent = '';
    groups.forEach(function (grp) {
      var tab = el('button', 'lc-ac-ptab');
      tab.type = 'button';
      tab.id = 'lc-ac-ptab-' + grp.id;
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-controls', 'lc-ac-ppanel-' + grp.id);
      tab.setAttribute('data-ac-tab', grp.id);
      tab.setAttribute('data-ac-key', 'tab:' + grp.id);
      tab.appendChild(el('span', null, grp.label));
      tab.appendChild(el('span', 'lc-sr', ', '));
      tab.appendChild(el('span', 'lc-ac-ptab-n', D.count(grp.prizes.length)));
      tab.appendChild(el('span', 'lc-sr', grp.prizes.length === 1 ? ' prize' : ' prizes'));
      tab.addEventListener('click', function () { selectTab(grp.id, false); });
      prizes.tabs.appendChild(tab);

      var panel = el('div', 'lc-ac-ppanel');
      panel.id = 'lc-ac-ppanel-' + grp.id;
      panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('aria-labelledby', tab.id);
      panel.setAttribute('data-ac-tab', grp.id);
      panel.setAttribute('data-ac-key', 'panel:' + grp.id);
      panel.tabIndex = 0;
      if (hasOwn(TAB_NOTES, grp.id)) { panel.appendChild(el('p', 'lc-ac-ptab-note', TAB_NOTES[grp.id])); }
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
      panel.appendChild(ul);
      prizes.panels.appendChild(panel);
    });
    var ids = groups.map(function (grp) { return grp.id; });
    selectTab(ids.indexOf(state.tab) > -1 ? state.tab : ids[0], false);
  }

  // Arrow keys move along the tabs (and wrap), Home and End jump to the ends; the tab that gets focus is shown.
  if (prizes) {
    prizes.tabs.addEventListener('keydown', function (e) {
      var tabs = all('[role="tab"]', prizes.tabs);
      var i = tabs.indexOf(document.activeElement);
      if (i < 0) { return; }
      var to = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
      if (to === undefined) { return; }
      e.preventDefault();
      to = (to + tabs.length) % tabs.length;
      selectTab(tabs[to].getAttribute('data-ac-tab'), true);
    });
  }

  /* ---------- the Card Packs and the achievements ---------- */

  function gem() {
    return svg(14, '0 0 24 24', ['M6 3h12l3 6-9 12L3 9z'], 'lc-gem');
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
        var tag = el('span', 'lc-rarity');
        tag.appendChild(gem());
        tag.appendChild(document.createTextNode(o.name));
        row.appendChild(tag);
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

  /* ---------- the side menu ----------
     As on the Guide (page-guide.js): the link for the section at the top of the window, just under the sticky header,
     gets aria-current="true"; at the very bottom of the page the last section wins. A link whose section the feed
     has hidden is hidden with it. On a short window the menu scrolls inside itself and keeps the marked link in view. */
  var nav = $('[data-ac-toc]', main);
  var toc = [];
  if (nav) {
    all('a[href^="#"]', nav).forEach(function (a) {
      var target = document.getElementById(a.getAttribute('href').slice(1));
      if (target) { toc.push({ link: a, li: a.parentNode, section: target }); }
    });
  }
  var current = null;
  function reveal(link) {
    if (nav.scrollHeight <= nav.clientHeight) { return; }
    var keys = false;
    try { keys = !!nav.querySelector(':focus-visible'); } catch (e) { keys = false; }
    if (keys) { return; }
    if (!link) { nav.scrollTop = 0; return; }
    var top = nav.getBoundingClientRect().top + nav.clientTop, bottom = top + nav.clientHeight;
    var r = link.getBoundingClientRect();
    if (r.top < top || r.bottom > bottom) { nav.scrollTop += (r.top + r.bottom) / 2 - (top + bottom) / 2; }
  }
  function setCurrent(item) {
    if (item === current) { return; }
    if (current) { current.link.removeAttribute('aria-current'); }
    current = item;
    if (item) { item.link.setAttribute('aria-current', 'true'); }
    reveal(item ? item.link : null);
  }
  function shown() { return toc.filter(function (t) { return !t.li.hidden; }); }
  function landingLine() {
    var pad = parseFloat(window.getComputedStyle(document.documentElement).scrollPaddingTop);
    return (isNaN(pad) ? 0 : pad) + 24;
  }
  function updateCurrent() {
    var items = shown();
    if (!items.length) { setCurrent(null); return; }
    var doc = document.documentElement;
    var atBottom = window.innerHeight + (window.pageYOffset || doc.scrollTop) >= doc.scrollHeight - 2;
    if (atBottom && items[items.length - 1].section.getBoundingClientRect().top < window.innerHeight) {
      setCurrent(items[items.length - 1]);
      return;
    }
    var line = landingLine(), found = null;
    for (var i = 0; i < items.length; i++) {
      if (items[i].section.getBoundingClientRect().top <= line) { found = items[i]; } else { break; }
    }
    setCurrent(found);
  }
  /* After a render: a menu entry shows only while its section does. */
  function updateToc() {
    toc.forEach(function (t) { t.li.hidden = !!(t.section.hidden || t.section.closest('[hidden]')); });
    if (current && current.li.hidden) { setCurrent(null); }
    queue();
  }
  // After a click, hold the clicked link while the smooth scroll runs (until scrolling pauses, at most 2 s).
  var lockTimer = null, lockEnds = 0, queued = false;
  function lock() {
    lockEnds = Date.now() + 2000;
    releaseSoon();
  }
  function releaseSoon() {
    clearTimeout(lockTimer);
    lockTimer = setTimeout(function () { lockTimer = null; updateCurrent(); }, Math.max(0, Math.min(200, lockEnds - Date.now())));
  }
  function queue() {
    if (!nav) { return; }
    if (lockTimer) { releaseSoon(); return; }
    if (queued) { return; }
    queued = true;
    window.requestAnimationFrame(function () { queued = false; updateCurrent(); });
  }
  if (nav && toc.length) {
    nav.addEventListener('click', function (e) {
      var a = e.target.closest ? e.target.closest('a[href^="#"]') : null;
      if (!a || e.defaultPrevented || e.button || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) { return; }
      toc.forEach(function (t) { if (t.link === a) { setCurrent(t); lock(); } });
    });
    window.addEventListener('scroll', queue, { passive: true });
    window.addEventListener('resize', queue);
    window.addEventListener('hashchange', queue);
    window.addEventListener('load', queue);
  }

  /* ---------- load, and refresh every Cache seconds while live ---------- */

  function render(res) {
    if (!res) { return; }
    state.res = res;
    var key = focusKey();
    var data = res.data || {};
    var list = openGames(data);
    var set = A.freshSet(data);
    var r = A.rules(data);
    var ctx0 = { rules: r, zone: zoneOf(r) };
    renderStatus(res);
    renderHolidays(data, ctx0.zone);
    var has = toggleParts(list, set, data);
    applyRules(r, set, res.mode);
    app.removeAttribute('aria-busy');
    setNote(ui.note, noteFor(res, true));
    var pickIds = renderGames(res, list, has, set, ctx0);
    renderFresh(res, set, pickIds, ctx0);
    renderPrizes(res);
    renderPacks(res);
    renderAchs(res);
    tickTimes();
    updateToc();
    refocus(key);
  }

  D.watch('arcade', render);
  // Today's pick and the next set count down, "set 3 minutes ago" moves on, and a pick, a Cup or a set can end
  // between refreshes (sample data never refreshes).
  setInterval(function () {
    if (state.res && !document.hidden) { render(state.res); }
  }, 30000);
})();
