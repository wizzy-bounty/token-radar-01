// Token Radar's dashboard (radar-3). It reads window.RADAR (written beside
// dashboard/ by main.ts) and renders the ranked board, a filterable table, a
// per-protocol detail drawer with the model's own inputs and the protocol's
// farm plan. No network: every byte it shows is in data.js.
//
// The value model, radar-3: implied = TVL x peerMultiple(category) x
// growthMult x maturityMult, where peerMultiple is the category's live-token
// peers' median mcap/TVL shrunk toward the market median. The page recomputes
// a row from the snapshot figures and checks the number board.json carries,
// so the page's code and the board's data are visibly the same arithmetic.
// The farm plan is the same derivation main.ts writes to board.json:
// category, chains, TVL and age decide the action, the capital, the hold and
// every cost and time. No name is special-cased.
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
  // The model in one function: peer multiple comes from the row, growth and
  // maturity are recomputed from the snapshot figures the row carries.
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

  // --- Farm plans: the same derivation board.json carries ---
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
  function halfGas(gas) { return Math.max(2, Math.round(gas / 2)); }
  function openingAction(p, capital) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    var chain = chainOf(p);
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.';
    if (c.indexOf('dex') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.';
    if (c.indexOf('yield') >= 0) return 'Deposit $' + capital + ' of USDC into a ' + name + ' vault on ' + chain + ' and keep the shares.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return "Stake $" + capital + " of the chain's staking asset through " + name + ' and keep the receipt.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('basis') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and place one market position on ' + name + '.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
    if (c.indexOf('rwa') >= 0) return 'Mint $' + capital + " of the protocol's yield asset on " + chain + ' and hold it.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.';
    if (c.indexOf('chain') >= 0) return 'Bridge $' + capital + ' to ' + name + ' and use it in one app built on the chain.';
    if (c.indexOf('farm') >= 0) return 'Deposit $' + capital + ' into ' + name + "'s main farm on " + chain + ' and keep the position open.';
    if (c.indexOf('index') >= 0) return 'Buy $' + capital + ' of ' + name + "'s index token on " + chain + ' and hold it through the next rebalance.';
    if (c.indexOf('payment') >= 0 || c.indexOf('card') >= 0) return 'Spend $' + capital + ' through ' + name + ' on ' + chain + ' and keep the receipt in the app.';
    if (c.indexOf('otc') >= 0) return 'Open one $' + capital + ' order on ' + name + ' and settle it through the protocol.';
    if (c.indexOf('governance') >= 0) return 'Lock $' + capital + ' of voting power with ' + name + ' on ' + chain + ' and cast one vote.';
    if (c.indexOf('btc') >= 0 || c.indexOf('anchor') >= 0) return 'Deposit $' + capital + ' of BTC-backed value into ' + name + ' on ' + chain + ' and keep the position open.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function secondAction(p) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    var chain = chainOf(p);
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Borrow a small amount against the supply on ' + name + ' and repay it within the week.';
    if (c.indexOf('dex') >= 0) return 'Swap a small amount through ' + name + "'s main pool on " + chain + ' so the wallet shows trading activity.';
    if (c.indexOf('yield') >= 0) return "Harvest the vault's rewards on " + name + ' once a week and restake them instead of selling.';
    if (c.indexOf('bridge') >= 0) return 'Bridge a small amount back through ' + name + ' so the wallet shows activity in both directions.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('basis') >= 0) return 'Close the hedge on ' + name + ' and reopen it the next week so the wallet shows repeated use.';
    if (c.indexOf('prediction') >= 0) return 'Settle one market on ' + name + " and claim any winnings from the protocol's own page.";
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Read ' + name + "'s allocation report and top up the vault by a small amount when it changes.";
    if (c.indexOf('rwa') >= 0) return 'Claim the yield the position earned on ' + name + ' and leave the principal working.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Claim the staking rewards on ' + name + ' once a week and restake them.';
    if (c.indexOf('stable') >= 0) return 'Use the stable asset in one lending pool on ' + chain + ' through ' + name + '.';
    if (c.indexOf('insurance') >= 0) return "Check the policy's coverage on " + name + ' once a week and renew it before it lapses.';
    if (c.indexOf('index') >= 0) return 'Check ' + name + "'s rebalance notice and hold the index through it.";
    if (c.indexOf('governance') >= 0) return 'Vote on one more proposal on ' + name + ' so the wallet shows repeated governance activity.';
    if (c.indexOf('btc') >= 0 || c.indexOf('anchor') >= 0) return 'Check the peg and the reserves ' + name + ' publishes, and add a small amount while they hold.';
    return 'Use ' + name + ' a second way — a swap, a vote or a claim — so the wallet shows more than one kind of activity.';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var capital = capitalFor(p);
    var gas = capital >= 150 ? 8 : 4;
    var hold = holdDaysFor(p.age_days);
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: openingAction(p, capital), cost: '$' + capital + ' of capital and about $' + gas + ' of gas', time: '15 minutes to set up' },
      { text: secondAction(p), cost: 'about $' + halfGas(gas) + ' of gas', time: '10 minutes' },
      { text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.', cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: 'Follow ' + p.name + "'s own announcements for snapshot dates, and take part in any vote or campaign it runs.", cost: 'no fee to read, gas only if you vote', time: '10 minutes a week' },
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' }
    ].map(stepText);
  }

  // --- The editorial layer: signals, shortlist reasons, watch-outs ---
  function onWatchlist(row) { return DATA.watchlistSlugs.indexOf(row.slug) >= 0; }
  function signalFor(row) {
    if (row.change_7d !== null && row.change_7d !== undefined && row.change_7d >= 10)
      return 'surging ' + fmtPct(row.change_7d) + ' in seven days';
    if (row.age_days !== null && row.age_days !== undefined && row.age_days < 90)
      return 'new: listed ' + fmtAge(row.age_days) + ' ago';
    if (row.age_days !== null && row.age_days !== undefined && row.age_days >= 730)
      return 'token-free for ' + fmtAge(row.age_days);
    if (onWatchlist(row)) return 'on the house watchlist';
    return '';
  }
  function pickReason(row, maxTvl) {
    var parts = [];
    if (row.category_rank === 1) parts.push('the largest implied value in ' + (row.category || 'Other'));
    if (row.change_7d !== null && row.change_7d !== undefined && row.change_7d >= 10)
      parts.push('TVL up ' + row.change_7d.toFixed(2) + '% in seven days');
    if (row.tvl_usd === maxTvl) parts.push(fmtUsd(row.tvl_usd) + ' of TVL with no token on record');
    if (row.age_days !== null && row.age_days !== undefined && row.age_days >= 730)
      parts.push('token-free for ' + fmtAge(row.age_days));
    if (onWatchlist(row)) parts.push('on the house watchlist');
    if (parts.length === 0) return 'Near the top of the board on implied value.';
    return parts.join('; ') + '.';
  }
  function watchOuts(row) {
    var out = [];
    if (row.change_7d !== null && row.change_7d !== undefined && row.change_7d <= -10)
      out.push('Its TVL fell ' + (-row.change_7d).toFixed(2) + '% in seven days — a launch priced off a shrinking base.');
    if (row.change_7d === null || row.change_7d === undefined)
      out.push('Its seven-day growth is not reported, so the growth factor sits at neutral — one signal fewer than most rows carry.');
    if (row.age_days !== null && row.age_days !== undefined && row.age_days < 90)
      out.push('It has run only ' + fmtAge(row.age_days) + ' with no token on record — a short history behind a launch claim.');
    if (row.peer_count < DATA.model.peer_min_peers) {
      var peers = row.peer_count === 0 ? 'no priced live peers' : row.peer_count === 1 ? 'only 1 priced live peer' : 'only ' + row.peer_count + ' priced live peers';
      out.push('Its category has ' + peers + ', so the model falls back to the market median multiple — treat this implied value as less certain than most.');
    }
    if (!row.chains || row.chains.length <= 1)
      out.push("It runs on a single chain, so that chain's trouble is the whole protocol's trouble.");
    if (out.length === 0)
      out.push('Nothing in its own figures trips a flag: growth is reported, its category has priced peers, and it runs on more than one chain.');
    return out;
  }

  // --- View state persists in the hash: filters, tab and open detail ---
  function readHash() {
    var h = location.hash.replace(/^#/, '');
    if (!h) return;
    h.split('&').forEach(function (pair) {
      var kv = pair.split('=');
      var key = decodeURIComponent(kv[0] || '');
      var val = decodeURIComponent(kv.slice(1).join('=') || '');
      if (key === 'q') state.q = val;
      else if (key === 'p') state.selected = val || null;
      else if (key === 'category') state.category = val || 'all';
      else if (key === 'chain') state.chain = val || 'all';
      else if (key === 'wl') state.wl = val === '1';
      else if (key === 'tab') state.tab = val === 'live' ? 'live' : 'pre-token';
    });
  }
  function writeHash() {
    var parts = [];
    if (state.q) parts.push('q=' + encodeURIComponent(state.q));
    if (state.selected) parts.push('p=' + encodeURIComponent(state.selected));
    if (state.category !== 'all') parts.push('category=' + encodeURIComponent(state.category));
    if (state.chain !== 'all') parts.push('chain=' + encodeURIComponent(state.chain));
    if (state.wl) parts.push('wl=1');
    if (state.tab !== 'pre-token') parts.push('tab=' + state.tab);
    var next = parts.length ? '#' + parts.join('&') : location.pathname + location.search;
    history.replaceState(null, '', next);
  }

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (state.wl && !onWatchlist(r)) return false;
      if (q) {
        var hay = (r.name + ' ' + r.slug + ' ' + (r.category || '') + ' ' + (r.chains || []).join(' ')).toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    var dir = state.dir;
    function value(r) {
      switch (key) {
        case 'rank': return r.rank;
        case 'name': return (r.name || '').toLowerCase();
        case 'tvl': return r.tvl_usd;
        case 'growth': return (r.change_7d === null || r.change_7d === undefined) ? -Infinity : r.change_7d;
        case 'age': return (r.age_days === null || r.age_days === undefined) ? Infinity : r.age_days;
        default: return r.implied_value_usd;
      }
    }
    return list.slice().sort(function (a, b) {
      var va = value(a); var vb = value(b);
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return a.slug < b.slug ? -1 : 1;
    });
  }

  function headerNode() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark', 'aria-hidden': 'true' }), 'Token Radar'),
      el('div', { class: 'top-meta' },
        el('span', null, 'Snapshot ' + DATA.as_of),
        el('span', null, 'DefiLlama protocol index'),
        el('span', null, DATA.model_version + ' model')));
  }
  function ledeNode() {
    var covered = DATA.rows.filter(function (r) { return onWatchlist(r); }).length;
    var top = DATA.rows[0];
    var facts = [
      ['Watchlist covered', covered + ' / ' + DATA.watchlist_size],
      ['Pre-token rows scored', String(DATA.board_size)],
      ['Set aside as products of live tokens', String(DATA.aside_size)],
      ['Live tokens priced as comps', String(DATA.live_size)],
      ['Top implied value', fmtUsd(top.implied_value_usd)],
      ['Market median multiple', String(DATA.market_median_multiple) + 'x']
    ];
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', null, DATA.board_size + ' pre-token protocols, ranked by implied value'),
        el('p', null, 'Every protocol in the snapshot is accounted for: ' + DATA.board_size +
          ' that record no token are ranked here (all ' + DATA.watchlist_size +
          ' watchlist protocols among them — the watchlist is the floor, not the ceiling), ' +
          DATA.aside_size + ' that record no token are set aside as wrapped, staked, bridged or exchange products of tokens that already trade, and ' +
          DATA.token_recorded_size + ' already record a token. Implied value is a model, not a promise.')),
      el('div', { class: 'facts' }, facts.map(function (f) {
        return el('div', { class: 'fact' }, el('span', null, f[0]), el('b', null, f[1]));
      })));
  }
  function picksNode() {
    var maxTvl = Math.max.apply(null, DATA.rows.map(function (r) { return r.tvl_usd; }));
    var cards = DATA.rows.slice(0, 5).map(function (r) {
      return el('button', { class: 'pick', type: 'button', onclick: function () { openSlug(r.slug); } },
        el('span', { class: 'pick-rank' }, '#' + r.rank),
        el('span', { class: 'pick-name' }, r.name),
        el('span', { class: 'pick-value' }, fmtUsd(r.implied_value_usd)),
        el('span', { class: 'pick-reason' }, pickReason(r, maxTvl)));
    });
    return el('section', null, el('h2', { class: 'picks-title' }, 'Start here — the five to farm first'), el('div', { class: 'picks' }, cards));
  }
  function boardCategories() {
    var set = {};
    DATA.rows.forEach(function (r) { set[r.category || 'Other'] = true; });
    return DATA.peer_multiples.filter(function (m) { return set[m.category]; });
  }
  function modelBandNode() {
    var chips = boardCategories().slice()
      .sort(function (a, b) { return b.multiple - a.multiple || b.peers - a.peers || (a.category < b.category ? -1 : 1); })
      .slice(0, 6)
      .map(function (m) { return el('span', { class: 'chip' }, m.category + ' ' + m.multiple.toFixed(3) + 'x'); });
    return el('section', { class: 'model-band' },
      el('div', null,
        el('b', null, 'The model: '),
        'implied value = TVL x the category\'s peer multiple x a growth factor x a maturity factor. Peer multiples are the median market cap per TVL dollar of the ' +
        DATA.live_size + ' live tokens in the same category, shrunk toward the market median of ' + String(DATA.market_median_multiple) +
        'x and clamped to [0.05x, 1.00x] — the full table is below the board, and every comp is listed in the Live token tab.'),
      el('div', { class: 'chips' }, chips));
  }
  function controlsNode() {
    var cats = {};
    DATA.rows.forEach(function (r) { var c = r.category || 'Other'; cats[c] = (cats[c] || 0) + 1; });
    var catOpts = [el('option', { value: 'all' }, 'All categories')];
    Object.keys(cats).sort().forEach(function (c) {
      var o = el('option', { value: c }, c + ' (' + cats[c] + ')');
      if (state.category === c) o.setAttribute('selected', 'selected');
      catOpts.push(o);
    });
    var chainSet = {};
    DATA.rows.forEach(function (r) { (r.chains || []).forEach(function (ch) { chainSet[ch] = true; }); });
    var chainOpts = [el('option', { value: 'all' }, 'All chains')];
    Object.keys(chainSet).sort().forEach(function (c) {
      var o = el('option', { value: c }, c);
      if (state.chain === c) o.setAttribute('selected', 'selected');
      chainOpts.push(o);
    });
    var wl = el('input', { type: 'checkbox', onchange: function (e) { state.wl = e.target.checked; writeHash(); render(); } });
    if (state.wl) wl.setAttribute('checked', 'checked');
    var countText = state.tab === 'live'
      ? (DATA.live ? DATA.live.length : 0) + ' live-token protocols'
      : filteredRows().length + ' rows shown';
    return el('section', { class: 'controls' },
      el('div', { class: 'field' },
        el('label', { for: 'q' }, 'Search'),
        el('input', { id: 'q', type: 'search', value: state.q, placeholder: 'Name, category or chain', oninput: function (e) { state.q = e.target.value; writeHash(); render(true); } })),
      el('div', { class: 'field' },
        el('label', { for: 'cat' }, 'Category'),
        el('select', { id: 'cat', onchange: function (e) { state.category = e.target.value; writeHash(); render(); } }, catOpts)),
      el('div', { class: 'field' },
        el('label', { for: 'chain' }, 'Chain'),
        el('select', { id: 'chain', onchange: function (e) { state.chain = e.target.value; writeHash(); render(); } }, chainOpts)),
      el('label', { class: 'check' }, wl, 'Watchlist only'),
      el('div', { class: 'field' },
        el('span', { class: 'sub' }, 'Token status'),
        el('div', { class: 'tabs' },
          el('button', { type: 'button', 'aria-pressed': String(state.tab === 'pre-token'), onclick: function () { state.tab = 'pre-token'; writeHash(); render(); } }, 'Pre-token'),
          el('button', { type: 'button', 'aria-pressed': String(state.tab === 'live'), onclick: function () { state.tab = 'live'; writeHash(); render(); } }, 'Live token'))),
      el('span', { class: 'count', id: 'count' }, countText));
  }
  function sortHeader(label, key, cls) {
    var marker = state.sort === key ? (state.dir === 1 ? ' ^' : ' v') : '';
    return el('th', { class: cls || '' },
      el('button', { type: 'button', onclick: function () {
        if (state.sort === key) state.dir = -state.dir;
        else { state.sort = key; state.dir = -1; }
        render();
      } }, label + marker));
  }
  function boardNode() {
    var rows = sortedRows(filteredRows());
    var shown = filteredRows();
    var maxImplied = shown.length ? Math.max.apply(null, shown.map(function (r) { return r.implied_value_usd; })) : 0;
    var head = el('thead', null, el('tr', null,
      sortHeader('Rank', 'rank'), sortHeader('Protocol', 'name'),
      sortHeader('TVL', 'tvl', 'num'), sortHeader('7D', 'growth', 'num'), sortHeader('Age', 'age', 'num'),
      sortHeader('Implied value', 'implied', 'num'), el('th', null, 'Token')));
    var bodyRows = rows.map(function (r) {
      var barPct = maxImplied > 0 ? Math.max(3, Math.round((r.implied_value_usd / maxImplied) * 100)) : 3;
      var signal = signalFor(r);
      var sub = (r.category || 'Other') + ' on ' + (r.chains || []).slice(0, 2).join(', ') + (signal ? ' · ' + signal : '');
      var changeCell = el('td', { class: 'num ' + (r.change_7d === null || r.change_7d === undefined ? '' : (r.change_7d >= 0 ? 'pos' : 'neg')) }, fmtPct(r.change_7d));
      var tr = el('tr', { 'data-clickable': 'true', 'data-selected': String(state.selected === r.slug), onclick: function () { openSlug(r.slug); } },
        el('td', null, String(r.rank)),
        el('td', { class: 'name' }, el('b', null, r.name), el('span', { class: 'sub' }, sub)),
        el('td', { class: 'num' }, fmtUsd(r.tvl_usd)),
        changeCell,
        el('td', { class: 'num' }, fmtAge(r.age_days)),
        el('td', { class: 'num' },
          el('span', { class: 'implied' },
            el('span', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + barPct + '%' })),
            fmtUsd(r.implied_value_usd))),
        el('td', null, el('span', { class: 'status' }, 'no token')));
      return tr;
    });
    var table = el('table', null,
      el('caption', null, 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.'),
      head, el('tbody', null, bodyRows));
    if (rows.length === 0) {
      return el('section', { class: 'panel' },
        el('div', { class: 'empty' },
          el('h2', null, 'No protocols match'),
          el('p', null, 'The search, category, chain and watchlist filters together leave nothing on the board. Loosen one of them.'),
          el('button', { class: 'button primary', type: 'button', onclick: function () {
            state.q = ''; state.category = 'all'; state.chain = 'all'; state.wl = false; writeHash(); render();
          } }, 'Clear filters')));
    }
    return el('section', { class: 'panel' }, el('div', { class: 'table-wrap' }, table));
  }
  function fmtLiveMultiple(m) {
    if (m === null || m === undefined || !isFinite(m)) return 'n/a';
    if (m === 0) return '0x';
    if (m >= 100) return m.toFixed(1) + 'x';
    if (m >= 1) return m.toFixed(2) + 'x';
    return m.toFixed(3) + 'x';
  }
  function liveNode() {
    var head = el('thead', null, el('tr', null,
      el('th', null, 'Status'), el('th', null, 'Protocol'),
      el('th', { class: 'num' }, 'TVL'), el('th', { class: 'num' }, '7D'),
      el('th', { class: 'num' }, 'Market cap'), el('th', { class: 'num' }, 'Multiple')));
    var bodyRows = (DATA.live || []).map(function (r) {
      var sub = (r.category || 'Other') + ' on ' + (r.chains || []).slice(0, 2).join(', ');
      return el('tr', null,
        el('td', null, el('span', { class: 'status live' }, 'already trades')),
        el('td', { class: 'name' }, el('b', null, r.name), el('span', { class: 'sub' }, sub)),
        el('td', { class: 'num' }, fmtUsd(r.tvl_usd)),
        el('td', { class: 'num ' + (r.change_7d === null || r.change_7d === undefined ? '' : (r.change_7d >= 0 ? 'pos' : 'neg')) }, fmtPct(r.change_7d)),
        el('td', { class: 'num' }, fmtUsd(r.mcap_usd)),
        el('td', { class: 'num' }, fmtLiveMultiple(r.multiple)));
    });
    var table = el('table', null,
      el('caption', null, 'Token live: these protocols already trade, so their market cap is a fact, not a model. The ' + DATA.live_size +
        ' with a price are the benchmark set — each one\'s market cap per TVL dollar is what the pre-token board is priced against. Another ' +
        DATA.unpriced_size + ' protocols record a token with no market price in the snapshot; they are neither ranked nor used as comps.'),
      head, el('tbody', null, bodyRows));
    return el('section', { class: 'panel' }, el('div', { class: 'table-wrap' }, table));
  }
  function modelPanelNode() {
    var m = DATA.model;
    var formula = 'implied = round( tvl_usd x peerMultiple(category) x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap +
      ') / 100 x ' + m.growth_weight + ') x (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + ') )';
    var multRows = boardCategories().slice()
      .sort(function (a, b) { return b.multiple - a.multiple || b.peers - a.peers || (a.category < b.category ? -1 : 1); })
      .map(function (mm) {
        return el('tr', null,
          el('td', null, mm.category),
          el('td', { class: 'num' }, mm.multiple.toFixed(3) + 'x'),
          el('td', { class: 'num' }, String(mm.peers)),
          el('td', { class: 'num' }, mm.peer_median === null ? 'n/a' : mm.peer_median.toFixed(3) + 'x'));
      });
    return el('section', { class: 'panel model' },
      el('h2', null, 'How the number is made'),
      el('p', null, 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked. The peer multiple is what the market already pays for a token in the same category: the live-token peers\' median market cap per dollar of TVL, shrunk toward the market median of ' + String(DATA.market_median_multiple) + 'x so a category with few peers cannot swing the board.'),
      el('div', { class: 'formula' }, formula),
      el('table', { class: 'mult-table' },
        el('caption', null, 'Peer multiples for the categories on the board. A category with fewer than ' + m.peer_min_peers + ' priced live peers falls back to the market median multiple of ' + String(DATA.market_median_multiple) + 'x.'),
        el('thead', null, el('tr', null, el('th', null, 'Category'), el('th', { class: 'num' }, 'Multiple used'), el('th', { class: 'num' }, 'Live peers'), el('th', { class: 'num' }, 'Peer median'))),
        el('tbody', null, multRows)),
      el('p', { class: 'note' }, 'TVL and seven-day growth come from the snapshot. Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age uses ' + m.unknown_age_days + ' days. "No token" means the snapshot records no token for the protocol — it does not prove the protocol has none. Implied value is this radar\'s own estimate, not a price and not a promise of a launch.'));
  }

  function detailNode(row) {
    var recomputed = impliedOf(row, DATA.model);
    var why = 'The ' + String(DATA.market_median_multiple) + 'x market median multiple shrinks what ' + (row.category || 'Other') +
      '\'s live peers trade at because that category has ' + row.peer_count + ' priced peers.';
    if (row.change_7d !== null && row.change_7d !== undefined) {
      why += row.change_7d >= 0
        ? ' Its TVL rose ' + row.change_7d.toFixed(2) + '% in seven days.'
        : ' Its TVL fell ' + (-row.change_7d).toFixed(2) + '% in seven days.';
    } else {
      why += ' No seven-day growth is reported.';
    }
    why += ' It has run ' + fmtAge(row.age_days) + ' with no token on record.';
    if (onWatchlist(row)) why += ' It is on the house watchlist.';
    why += ' On the board it is #' + row.category_rank + ' of ' + row.category_size + ' in its category.';

    var steps = farmSteps(row);
    var capital = capitalFor(row);
    var gas = capital >= 150 ? 8 : 4;
    var totalGas = 3 + gas + halfGas(gas) + 2;
    var hold = holdDaysFor(row.age_days);

    function pair(label, value, total) {
      return el('div', total ? { class: 'total' } : null, el('span', null, label), el('b', null, value));
    }
    var watchItems = watchOuts(row).map(function (w) { return el('li', null, w); });
    var stepItems = steps.map(function (s) {
      var cut = s.indexOf(' Cost: ');
      var action = cut >= 0 ? s.slice(0, cut) : s;
      var tail = cut >= 0 ? s.slice(cut + 1) : '';
      return el('li', null, el('b', null, action), el('span', { class: 'cost' }, tail));
    });

    return el('div', null,
      el('div', { class: 'detail-head' },
        el('div', null,
          el('span', { class: 'kicker' }, 'Rank ' + row.rank + ' of ' + DATA.board_size + (onWatchlist(row) ? ' · Watchlist' : '')),
          el('h2', null, row.name),
          el('span', { class: 'sub' }, (row.category || 'Other') + ' on ' + (row.chains || []).join(', '))),
        el('button', { class: 'close', type: 'button', onclick: closeDetail }, 'Close')),
      el('section', { class: 'detail-section' },
        el('h3', null, 'The model, on this protocol'),
        el('div', { class: 'equation' },
          pair('TVL', fmtUsd(row.tvl_usd)),
          pair('Peer multiple (' + (row.category || 'Other') + ')', row.peer_multiple.toFixed(3) + 'x'),
          pair('Base value', fmtUsd(row.base_value_usd)),
          pair('Seven-day growth', fmtPct(row.change_7d)),
          pair('Growth multiplier', String(row.growth_multiplier)),
          pair('Age with no token', fmtAge(row.age_days)),
          pair('Maturity multiplier', String(row.maturity_multiplier)),
          pair('Implied value', fmtUsd(row.implied_value_usd), true)),
        el('p', { class: 'note' }, 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' +
          fmtUsd(recomputed) + ', the same number board.json carries. This is an estimate, not a price.'),
        el('p', { class: 'why' }, 'Why this rank: ' + why)),
      el('section', { class: 'detail-section' },
        el('h3', { class: 'watch' }, 'Watch-outs'),
        el('ul', { class: 'watch-list' }, watchItems)),
      el('section', { class: 'detail-section' },
        el('h3', null, 'Farm plan'),
        el('ol', { class: 'steps' }, stepItems),
        el('p', { class: 'plan-total' }, 'Plan total: $' + capital + ' of capital, about $' + totalGas + ' of gas across the plan, and a ' + hold + '-day hold.')));
  }

  var dialog = null;
  var dialogGen = 0;
  function openSlug(slug) {
    state.selected = slug;
    writeHash();
    render();
  }
  function closeDetail() {
    state.selected = null;
    writeHash();
    render();
  }
  function render(keepFocus) {
    var activeId = document.activeElement && document.activeElement.id;
    app.setAttribute('aria-busy', 'false');
    app.textContent = '';
    var shell = el('div', { class: 'shell' },
      headerNode(), ledeNode(), picksNode(), modelBandNode(), controlsNode(),
      state.tab === 'live' ? liveNode() : boardNode(),
      modelPanelNode());
    app.appendChild(shell);
    if (dialog && dialog.open) dialog.close();
    if (state.selected) {
      var row = null;
      DATA.rows.forEach(function (r) { if (r.slug === state.selected) row = r; });
      if (row) {
        dialog = el('dialog', { class: 'detail' });
        dialog.appendChild(detailNode(row));
        var gen = ++dialogGen;
        dialog.addEventListener('close', function () {
          // A close fired while render() swaps dialogs belongs to the old
          // dialog; only a close of the current one clears the selection.
          if (gen !== dialogGen) return;
          if (state.selected) { state.selected = null; writeHash(); render(); }
        });
        app.appendChild(dialog);
        if (dialog.showModal) dialog.showModal();
      } else {
        state.selected = null;
        writeHash();
      }
    }
    if (keepFocus && activeId === 'q') {
      var input = document.getElementById('q');
      if (input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
    }
  }

  readHash();
  window.addEventListener('hashchange', function () { readHash(); render(); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && state.selected) closeDetail();
  });
  render();
})();
