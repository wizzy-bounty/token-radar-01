// Token Radar's dashboard (radar-3). It reads window.RADAR (written beside dashboard/
// by main.ts) and renders the ranked board, a filterable table, a per-protocol detail
// drawer with the model's own inputs, its watch-outs and its farm plan, and the full
// live-token benchmark table the model prices off. No network: every byte it shows
// is in data.js.
//
// The value model, radar-3: implied = TVL x peerMultiple(category) x growthMult x
// maturityMult, where peerMultiple is the category's live-token peers' median mcap/TVL
// shrunk toward the market median. The page recomputes a row from the snapshot figures
// and checks the number board.json carries, so the page's code and the board's data are
// visibly the same arithmetic. The farm plan is the same derivation main.ts writes to
// board.json: category, chains, TVL and age decide the action, the capital, the hold
// and every cost and time. No name is special-cased. Every protocol in the snapshot is
// accounted for on the page: ranked on the board, set aside as a product of a token
// that already trades, or listed in the benchmark table with its own multiple.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('app');
  var state = { q: '', category: 'all', chain: 'all', wl: false, tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMult(x) {
    if (x === null || x === undefined || !isFinite(x)) return 'n/a';
    return x.toFixed(3) + 'x';
  }
  // The model in one function: peer multiple comes from the row, growth and maturity
  // are recomputed from the snapshot figures the row carries.
  function impliedOf(row, model) {
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    return Math.max(1, Math.round(row.tvl_usd * row.peer_multiple * growthMult * maturity));
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.';
    if (c.indexOf('dex') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.';
    if (c.indexOf('yield') >= 0) return 'Deposit $' + capital + ' of USDC into a ' + name + ' vault on ' + chain + ' and keep the shares.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return "Stake $" + capital + " of the chain's staking asset through " + name + ' and keep the receipt.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('basis') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and place one market position on ' + name + '.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
    if (c.indexOf('rwa') >= 0) return "Mint $" + capital + " of the protocol's yield asset on " + chain + ' and hold it.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.';
    if (c.indexOf('chain') >= 0) return 'Bridge $' + capital + ' to ' + name + ' and use it in one app built on the chain.';
    if (c.indexOf('farm') >= 0) return 'Deposit $' + capital + " into " + name + "'s main farm on " + chain + ' and keep the position open.';
    if (c.indexOf('index') >= 0) return 'Buy $' + capital + " of " + name + "'s index token on " + chain + ' and hold it through the next rebalance.';
    if (c.indexOf('payment') >= 0 || c.indexOf('card') >= 0) return 'Spend $' + capital + ' through ' + name + ' on ' + chain + ' and keep the receipt in the app.';
    if (c.indexOf('otc') >= 0) return 'Open one $' + capital + ' order on ' + name + ' and settle it through the protocol.';
    if (c.indexOf('governance') >= 0) return 'Lock $' + capital + ' of voting power with ' + name + ' on ' + chain + ' and cast one vote.';
    if (c.indexOf('btc') >= 0 || c.indexOf('anchor') >= 0) return 'Deposit $' + capital + ' of BTC-backed value into ' + name + ' on ' + chain + ' and keep the position open.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function secondActionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Borrow a small amount against the supply on ' + name + ' and repay it within the week.';
    if (c.indexOf('dex') >= 0) return 'Swap a small amount through ' + name + "'s main pool on " + chain + ' so the wallet shows trading activity.';
    if (c.indexOf('yield') >= 0) return 'Harvest the vault rewards on ' + name + ' once a week and restake them instead of selling.';
    if (c.indexOf('bridge') >= 0) return 'Bridge a small amount back through ' + name + ' so the wallet shows activity in both directions.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('basis') >= 0) return 'Close the hedge on ' + name + ' and reopen it the next week so the wallet shows repeated use.';
    if (c.indexOf('prediction') >= 0) return 'Settle one market on ' + name + ' and claim any winnings from the protocol\'s own page.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Read ' + name + "'s allocation report and top up the vault by a small amount when it changes.";
    if (c.indexOf('rwa') >= 0) return 'Claim the yield the position earned on ' + name + ' and leave the principal working.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Claim the staking rewards on ' + name + ' once a week and restake them.';
    if (c.indexOf('stable') >= 0) return 'Use the stable asset in one lending pool on ' + chain + ' through ' + name + '.';
    if (c.indexOf('insurance') >= 0) return 'Check the policy coverage on ' + name + ' once a week and renew it before it lapses.';
    if (c.indexOf('index') >= 0) return 'Check ' + name + "'s rebalance notice and hold the index through it.";
    if (c.indexOf('governance') >= 0) return 'Vote on one more proposal on ' + name + ' so the wallet shows repeated governance activity.';
    if (c.indexOf('btc') >= 0 || c.indexOf('anchor') >= 0) return 'Check the peg and the reserves ' + name + ' publishes, and add a small amount while they hold.';
    return 'Use ' + name + ' a second way - a swap, a vote or a claim - so the wallet shows more than one kind of activity.';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    var gas = capital >= 150 ? 8 : 4;
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and about $' + gas + ' of gas', time: '15 minutes to set up' },
      { text: secondActionFor(p, capital, chain), cost: 'about $' + Math.max(2, Math.round(gas / 2)) + ' of gas', time: '10 minutes' },
      { text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.', cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: 'Follow ' + p.name + "'s own announcements for snapshot dates, and take part in any vote or campaign it runs.", cost: 'no fee to read, gas only if you vote', time: '10 minutes a week' },
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' }
    ].map(stepText);
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('wl') === '1') state.wl = true;
    if (params.get('tab')) state.tab = params.get('tab');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.wl) params.set('wl', '1');
    if (state.tab !== 'pre-token') params.set('tab', state.tab);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && !(r.chains || []).includes(state.chain)) return false;
      if (state.wl && !DATA.watchlistSlugs.includes(r.slug)) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'Token Radar' })),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', { text: DATA.model_version + ' model' })
      )
    );
  }

  function lede() {
    var top = DATA.rows[0];
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.board_size + ' pre-token protocols, ranked by implied value' }),
        el('p', { text: 'Every protocol in the snapshot is accounted for: ' + DATA.board_size + ' that record no token are ranked here (all ' + DATA.watchlist_size + ' watchlist protocols among them — the watchlist is the floor, not the ceiling), ' + DATA.aside_size + ' that record no token are set aside as wrapped, staked, bridged or exchange products of tokens that already trade, and ' + DATA.token_recorded_size + ' already record a token. Implied value is a model, not a promise.' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Set aside as products of live tokens' }), el('b', { text: String(DATA.aside_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Live tokens priced as comps' }), el('b', { text: String(DATA.live_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Top implied value' }), el('b', { text: top ? fmtUsd(top.implied_value_usd) : 'n/a' })),
        el('div', { class: 'fact' }, el('span', { text: 'Market median multiple' }), el('b', { text: String(DATA.market_median_multiple) + 'x' }))
      )
    );
  }

  // The one-line reason a top pick earns its place, from the row's own figures only.
  function pickReason(r) {
    var bits = [];
    if (r.category_rank === 1) bits.push('the largest implied value in ' + (r.category || 'its category'));
    if (DATA.watchlistSlugs.includes(r.slug)) bits.push('on the house watchlist');
    if (r.change_7d !== null && r.change_7d >= 10) bits.push('TVL up ' + r.change_7d.toFixed(1) + '% in seven days');
    else if (r.change_7d !== null && r.change_7d <= -10) bits.push('ranked on size despite a ' + (-r.change_7d).toFixed(1) + '% TVL dip');
    if (r.age_days !== null && r.age_days >= 1095) bits.push('token-free for ' + fmtAge(r.age_days));
    if (bits.length === 0) bits.push(fmtUsd(r.tvl_usd) + ' of TVL with no token on record');
    return bits.slice(0, 2).join('; ') + '.';
  }

  // Start here: the five rows a reader should farm first, each with its reason.
  function picks() {
    var cards = DATA.rows.slice(0, 5).map(function (r) {
      return el('button', { type: 'button', class: 'pick', onclick: function () { openDetail(r.slug); } },
        el('span', { class: 'pick-rank', text: '#' + r.rank }),
        el('b', { text: r.name }),
        el('span', { class: 'pick-value num', text: fmtUsd(r.implied_value_usd) }),
        el('span', { class: 'pick-reason', text: pickReason(r) })
      );
    });
    return el('section', { class: 'picks', 'aria-label': 'Start here' },
      el('h2', { text: 'Start here — the five to farm first' }),
      el('div', { class: 'pick-row' }, cards)
    );
  }

  // The model in one band, visible before the table: the formula and the multiples
  // that carry the most board value, so the pricing is on the first screen.
  function modelBand() {
    var boardCats = {};
    DATA.rows.forEach(function (r) { boardCats[r.category || 'Other'] = true; });
    var chips = (DATA.peer_multiples || []).filter(function (t) { return boardCats[t.category]; })
      .sort(function (a, b) { return b.multiple - a.multiple; })
      .slice(0, 6)
      .map(function (t) { return el('span', { class: 'chip', text: t.category + ' ' + fmtMult(t.multiple) }); });
    return el('section', { class: 'band', 'aria-label': 'The value model' },
      el('p', null,
        el('b', { text: 'The model: ' }),
        'implied value = TVL x the category\u2019s peer multiple x a growth factor x a maturity factor. Peer multiples are the median market cap per TVL dollar of the ' + DATA.live_size + ' live tokens in the same category, shrunk toward the market median of ' + String(DATA.market_median_multiple) + 'x and clamped to [0.05x, 1.00x] — the full table is below the board, and every comp is listed in the Live token tab.'
      ),
      el('div', { class: 'chips' }, chips)
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.flatMap(function (r) { return r.chains || []; }))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var catSelect = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c + ' (' + DATA.rows.filter(function (r) { return (r.category || 'Other') === c; }).length + ')', selected: c === state.category ? 'selected' : null }); })
    );
    catSelect.addEventListener('change', function () { state.category = catSelect.value; writeHash(); render(); });
    var chainSelect = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    chainSelect.addEventListener('change', function () { state.chain = chainSelect.value; writeHash(); render(); });
    var wl = el('input', { type: 'checkbox', id: 'wl', checked: state.wl ? 'checked' : null });
    wl.addEventListener('change', function () { state.wl = wl.checked; writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), catSelect),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSelect),
      el('label', { class: 'check' }, wl, 'Watchlist only'),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', text: state.tab === 'pre-token' ? rows().length + ' rows shown' : DATA.live.length + ' priced live-token protocols' })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  // The glanceable signal in a row's sub-line, from the row's own figures only:
  // momentum first, then a long token-free run, then a very new listing, then the
  // watchlist mark. A row with none of them shows its category and chain alone.
  function signalFor(r) {
    if (r.change_7d !== null && r.change_7d >= 15) return 'surging: TVL up ' + r.change_7d.toFixed(1) + '% this week';
    if (r.age_days !== null && r.age_days >= 1095) return 'token-free for ' + fmtAge(r.age_days);
    if (r.age_days !== null && r.age_days <= 90) return 'new: listed ' + fmtAge(r.age_days) + ' ago';
    if (DATA.watchlistSlugs.includes(r.slug)) return 'on the house watchlist';
    return '';
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.wl = false; writeHash(); render(); } })
      ));
    }
    var max = list[0].implied_value_usd || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var signal = signalFor(r);
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') + (signal ? ' · ' + signal : '') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', null, el('span', { class: 'status', text: 'no token' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel', id: 'board' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num', text: fmtMult(r.multiple) }),
        el('td', null, el('span', { class: 'status live', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'The benchmark set: every protocol in the snapshot whose token already trades at a recorded price — all ' + DATA.live_size + ' of them, each with the market cap per TVL dollar it contributes. The board\u2019s peer multiples are medians of this table by category, shrunk toward the market median and clamped, so one huge multiple cannot swing a category. Another ' + DATA.unpriced_size + ' protocols record a token with no market price in the snapshot: they are neither ranked nor used as comps.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Mcap / TVL' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var m = DATA.model;
    var boardCats = {};
    DATA.rows.forEach(function (r) { boardCats[r.category || 'Other'] = true; });
    var mults = (DATA.peer_multiples || []).filter(function (t) { return boardCats[t.category]; })
      .sort(function (a, b) { return b.multiple - a.multiple || b.peers - a.peers || (a.category < b.category ? -1 : 1); });
    var multRows = mults.map(function (t) {
      return el('tr', null,
        el('td', { text: t.category }),
        el('td', { class: 'num', text: fmtMult(t.multiple) }),
        el('td', { class: 'num', text: String(t.peers) }),
        el('td', { class: 'num', text: fmtMult(t.peer_median) })
      );
    });
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked. The peer multiple is what the market already pays for a token in the same category: the live-token peers\' median market cap per dollar of TVL, shrunk toward the market median of ' + DATA.market_median_multiple + 'x so a category with few peers cannot swing the board. Every one of the ' + DATA.live_size + ' priced peers behind these medians is listed, with its own multiple, in the Live token tab.' }),
      el('div', { class: 'formula' },
        'implied = round( tvl_usd x peerMultiple(category) x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + ') )'
      ),
      el('table', { class: 'mult-table' },
        el('caption', { class: 'sub', text: 'Peer multiples by category, from the snapshot\'s live-token protocols.' }),
        el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Category' }), el('th', { scope: 'col', text: 'Multiple used' }), el('th', { scope: 'col', text: 'Live peers' }), el('th', { scope: 'col', text: 'Peer median' }))),
        el('tbody', null, multRows)
      ),
      el('p', { class: 'sub', text: 'TVL and seven-day growth come from the snapshot. Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age uses ' + m.unknown_age_days + ' days. "No token" means the snapshot records no token for the protocol — it does not prove the protocol has none. Implied value is this radar\'s own estimate, not a price and not a promise of a launch.' })
    );
  }

  // The risks a farmer should see before the plan, each one read off the row's own
  // snapshot figures — never a hand-written note on a named protocol.
  function watchOuts(row) {
    var flags = [];
    if (row.change_7d !== null && row.change_7d <= -10) flags.push('TVL fell ' + (-row.change_7d).toFixed(1) + '% in seven days. Momentum is against it: size the position down, or wait for the trend to turn before adding.');
    if (row.change_7d === null) flags.push('No seven-day growth is reported, so the model scores its growth as flat — there is no momentum evidence either way.');
    if (row.age_days !== null && row.age_days < 90) flags.push('Listed only ' + fmtAge(row.age_days) + ' ago. The record is short and any points program this young is unproven; keep the position small.');
    if (row.peer_count < 3) flags.push('Its category has ' + (row.peer_count === 0 ? 'no' : 'only ' + row.peer_count) + ' priced live peer' + (row.peer_count === 1 ? '' : 's') + ', so the model falls back to the market median multiple — treat this implied value as less certain than most.');
    if (!row.chains || row.chains.length <= 1) flags.push('It runs on a single chain, so bridge trouble or an outage there pauses the whole farm.');
    return flags;
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = farmSteps(row);
    var recomputed = impliedOf(row, DATA.model);
    var onWatchlist = DATA.watchlistSlugs.includes(row.slug);
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + (onWatchlist ? ' · watchlist' : ' · early radar') }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Peer multiple (' + (row.category || 'Other') + ')' }), el('b', { class: 'num', text: row.peer_multiple.toFixed(3) + 'x' })),
        el('div', null, el('span', { text: 'Base value' }), el('b', { class: 'num', text: fmtUsd(row.base_value_usd) })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { class: 'num', text: String(row.growth_multiplier) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Maturity multiplier' }), el('b', { class: 'num', text: String(row.maturity_multiplier) })),
        el('div', { class: 'total' }, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + fmtUsd(recomputed) + (recomputed === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.' }),
      el('p', { class: 'why', text: 'Why this rank: ' + row.name + ' records no token and holds ' + fmtUsd(row.tvl_usd) + ' of TVL in ' + (row.category || 'an uncategorised') + ', a category whose live-token peers trade at ' + row.peer_multiple.toFixed(3) + 'x TVL. ' + (row.change_7d === null ? 'No seven-day growth is reported.' : row.change_7d >= 0 ? 'Its TVL rose ' + row.change_7d.toFixed(2) + '% in seven days.' : 'Its TVL fell ' + (-row.change_7d).toFixed(2) + '% in seven days.') + ' It has run ' + fmtAge(row.age_days) + ' with no token on record. On the board it is #' + row.category_rank + ' of ' + row.category_size + ' in its category.' })
    ));
    var flags = watchOuts(row);
    dialog.appendChild(el('section', { class: 'detail-section watchouts' },
      el('h3', { text: 'Watch-outs' }),
      flags.length > 0
        ? el('ul', { class: 'flags' }, flags.map(function (f) { return el('li', { text: f }); }))
        : el('p', { class: 'sub', text: 'None from the snapshot figures: TVL is not falling fast, the record is not brand new, its category multiple rests on at least three priced peers, and it runs on more than one chain.' })
    ));
    var planCapital = capitalFor(row);
    var planGas = planCapital >= 150 ? 8 : 4;
    var planTotalGas = 3 + planGas + Math.max(2, Math.round(planGas / 2)) + 2;
    var planHold = holdDaysFor(row.age_days);
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan — 8 steps' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      })),
      el('p', { class: 'why', text: 'Plan total: $' + planCapital + ' capital, about $' + planTotalGas + ' gas, ' + planHold + ' days hold.' })
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    if (state.tab === 'pre-token') {
      shell.appendChild(picks());
      shell.appendChild(modelBand());
    }
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') shell.appendChild(modelPanel());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
