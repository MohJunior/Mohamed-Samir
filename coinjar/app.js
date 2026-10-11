/* Coin Jar — watch your pay pile up while you work. */
(function () {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const STORE_KEY = 'coinjar.v1';
  const JAR_CAPACITY = 80;
  const AWAY_LIMIT_MS = 10 * 60 * 1000;
  const IS_EXTENSION = typeof chrome !== 'undefined' && !!(chrome.runtime && chrome.runtime.id);

  const CURRENCIES = ['USD', 'EUR', 'GBP', 'EGP', 'SAR', 'AED', 'KWD', 'QAR', 'MAD', 'TRY', 'INR', 'PKR', 'CAD', 'AUD', 'JPY', 'CNY', 'BRL', 'MXN', 'NGN', 'ZAR'];
  const COIN_SYMBOL = { USD: '$', EUR: '€', GBP: '£', EGP: '£', SAR: 'ر', AED: 'د', KWD: 'د', QAR: 'ر', MAD: 'د', TRY: '₺', INR: '₹', PKR: '₨', CAD: '$', AUD: '$', JPY: '¥', CNY: '¥', BRL: 'R', MXN: '$', NGN: '₦', ZAR: 'R' };
  const NICE = [0.01, 0.02, 0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10, 20, 25, 50, 100, 200, 500, 1000];
  const FUR = {
    orange: ['#f4a259', '#fde3c4'], gray: ['#9aa3b5', '#e3e7ef'], black: ['#3a3446', '#6b6278'],
    white: ['#f3f1ee', '#ffffff'], cream: ['#e9c99a', '#fbeedb'],
  };
  const QUOTES = [
    'Every coin counts. You\'re doing great 💛', 'Small steps, big jar 🫙', 'Hydrate! Then back to it 💧',
    'Future you says thanks 🙏', 'Slow progress is still progress 🐢', 'You showed up. That\'s the hardest part ✨',
    'One task at a time 🧘', 'Look at that jar go! 🪙', 'Burnout is real — breaks are productive too 🌿',
    'You\'re getting paid to be awesome 😎', 'Deep breath… keep going 🌙', 'Proud of you, human 🐾',
    'Done is better than perfect ✅', 'Treat yourself (later) 🍰', 'The cat believes in you 🐱',
  ];

  /* ---------------- state ---------------- */
  const defaults = () => ({
    settings: { payType: 'hourly', amount: 0, currency: 'USD', hoursPerWeek: 40, hoursPerDay: 8, breakEvery: 50, fur: 'orange', autoMusic: true, coinSound: true, volume: 0.6, rain: false, crackle: true },
    bank: 0, spent: 0, history: [], products: [], bought: [], focusId: null, session: null,
  });
  let state = load();

  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return defaults();
      const d = defaults(), s = JSON.parse(raw);
      return Object.assign(d, s, { settings: Object.assign(d.settings, s.settings || {}) });
    } catch (e) { return defaults(); }
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* storage unavailable */ }
  }

  /* ---------------- money helpers ---------------- */
  function hourlyRate(st = state.settings) {
    const a = +st.amount || 0;
    switch (st.payType) {
      case 'daily': return a / (+st.hoursPerDay || 8);
      case 'monthly': return a / ((+st.hoursPerWeek || 40) * 52 / 12);
      case 'yearly': return a / ((+st.hoursPerWeek || 40) * 52);
      default: return a;
    }
  }
  const fmtCache = {};
  function fmt(v, digits) {
    const c = state.settings.currency;
    const key = c + digits;
    if (!fmtCache[key]) {
      const opts = { style: 'currency', currency: c };
      if (digits != null) { opts.minimumFractionDigits = digits; opts.maximumFractionDigits = digits; }
      try { fmtCache[key] = new Intl.NumberFormat(undefined, opts); }
      catch (e) { fmtCache[key] = { format: (x) => c + ' ' + x.toFixed(digits ?? 2) }; }
    }
    return fmtCache[key].format(v);
  }
  function fmtShort(v) {
    if (Math.abs(v) >= 10000) {
      try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: state.settings.currency, notation: 'compact', maximumFractionDigits: 1 }).format(v); } catch (e) { /* fall through */ }
    }
    return fmt(v);
  }
  function fmtDuration(ms, withSeconds = true) {
    const t = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
    if (withSeconds) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    if (h >= 1) return `${h}h ${m}m`;
    return `${Math.max(m, 0)}m`;
  }
  function hoursOfWork(amount) {
    const r = hourlyRate();
    if (!r) return '—';
    const ms = (amount / r) * 3600000;
    if (ms < 60000) return '< 1m';
    const h = ms / 3600000;
    if (h > 24 * 3) {
      const days = h / ((+state.settings.hoursPerWeek || 40) / 5);
      return `${Math.round(h)}h (~${days.toFixed(days < 10 ? 1 : 0)} work days)`;
    }
    return fmtDuration(ms, false);
  }
  function pickDenomination(ratePerHour) {
    const target = ratePerHour / 3600 * 9; // about one coin every ~9 seconds
    let best = NICE[0];
    for (const n of NICE) if (n <= target * 1.4) best = n;
    return best;
  }

  /* ---------------- session ---------------- */
  const sess = () => state.session;
  const running = () => !!(sess() && sess().startedAt);
  function sessionMs(now = Date.now()) {
    const s = sess();
    if (!s) return 0;
    return s.accMs + (s.startedAt ? now - s.startedAt : 0);
  }
  const sessionEarned = (now) => (sess() ? sessionMs(now) / 3600000 * sess().rate : 0);
  const saved = (now) => state.bank - state.spent + sessionEarned(now);

  function startOrPause() {
    lofi.getCtx(); // unlock audio on this click
    if (!hourlyRate()) { switchTab('settings'); toast('Set your pay first 💸'); $('#amount').focus(); return; }
    const now = Date.now();
    if (!sess()) {
      const rate = hourlyRate();
      state.session = { startedAt: now, accMs: 0, rate, denom: pickDenomination(rate), dropped: 0, jars: 0, lastBreakMs: 0, lastSeen: now, firstStart: now };
      jar.reset();
      say(pick(['Let\'s get that bread 🍞', 'Clocking in! 🐾', 'Coins incoming 🪙', 'Focus mode: ON 🎧']));
      if (state.settings.autoMusic) startMusic();
    } else if (running()) {
      sess().accMs += now - sess().startedAt;
      sess().startedAt = null;
      say('Taking a little nap… 😴');
      if (state.settings.autoMusic) stopMusic();
    } else {
      sess().startedAt = now;
      sess().lastSeen = now;
      say(pick(['Back at it! 💪', 'Refreshed and ready ✨', 'Let\'s go! 🚀']));
      if (state.settings.autoMusic) startMusic();
    }
    save(); render();
  }

  function finishSession() {
    const s = sess();
    if (!s) return;
    const now = Date.now();
    const ms = sessionMs(now), amount = sessionEarned(now);
    state.bank += amount;
    if (ms > 5000) state.history.unshift({ start: s.firstStart, end: now, ms, amount });
    state.history = state.history.slice(0, 500);
    state.session = null;
    save();
    stopMusic();
    lofi.chime();
    toast(`🏦 Banked ${fmt(amount)} for ${fmtDuration(ms, false)} of work. Nice!`, true);
    say('Good work today! Rest well 🌙');
    confetti(60);
    jar.drain();
    render(); renderProducts(); renderStats();
  }

  /* ---------------- products ---------------- */
  const uid = () => Math.random().toString(36).slice(2, 10);

  function addProduct(e) {
    e.preventDefault();
    const name = $('#pName').value.trim(), price = parseFloat($('#pPrice').value);
    if (!name || !(price > 0)) return;
    const p = { id: uid(), name, price, emoji: $('#pEmoji').value.trim() || '🎁', link: $('#pLink').value.trim(), added: Date.now(), milestone: 0 };
    p.milestone = milestoneOf(saved() / price);
    state.products.push(p);
    if (!state.focusId) state.focusId = p.id;
    e.target.reset();
    save(); renderProducts(); render();
    toast(`${p.emoji} ${p.name} = ${hoursOfWork(p.price)} of work`);
  }
  const milestoneOf = (ratio) => (ratio >= 1 ? 100 : ratio >= 0.75 ? 75 : ratio >= 0.5 ? 50 : ratio >= 0.25 ? 25 : 0);

  function buyProduct(id) {
    const p = state.products.find((x) => x.id === id);
    if (!p) return;
    if (!confirm(`Mark "${p.name}" as bought? ${fmt(p.price)} will be taken out of your jar savings.`)) return;
    state.spent += p.price;
    state.products = state.products.filter((x) => x.id !== id);
    state.bought.unshift(Object.assign({}, p, { boughtAt: Date.now() }));
    if (state.focusId === id) state.focusId = state.products[0] ? state.products[0].id : null;
    save(); renderProducts(); render(); renderStats();
    confetti(160); lofi.chime();
    toast(`🎉 You earned your ${p.emoji} ${p.name}! Enjoy it.`, true);
  }

  function renderProducts() {
    const ul = $('#products'), now = Date.now(), have = saved(now);
    ul.innerHTML = '';
    $('#productsEmpty').classList.toggle('hidden', state.products.length > 0);
    state.products.forEach((p) => {
      const ratio = Math.min(1, Math.max(0, have / p.price));
      const left = Math.max(0, p.price - have);
      const li = document.createElement('li');
      li.className = 'product' + (state.focusId === p.id ? ' focus' : '');
      li.dataset.id = p.id;
      li.innerHTML = `
        <div class="p-row">
          <div class="p-emoji"></div>
          <div class="p-info"><div class="p-name"></div><div class="p-price"></div></div>
          <div class="p-actions">
            <button class="icon-btn ${state.focusId === p.id ? 'on' : ''}" data-act="focus" title="Show under the jar">⭐</button>
            <button class="icon-btn" data-act="del" title="Remove">✕</button>
          </div>
        </div>
        <div class="bar"><div class="bar-fill ${ratio >= 1 ? 'done' : ''}" style="width:${(ratio * 100).toFixed(1)}%"></div></div>
        <div class="p-sub"><span class="p-pct">${(ratio * 100).toFixed(ratio < 0.1 ? 1 : 0)}%</span><span class="p-left">${ratio >= 1 ? 'You can afford it! 🎉' : `${fmt(left)} to go · ${hoursOfWork(left)} of work`}</span></div>
        ${ratio >= 1 ? '<button class="btn primary small p-buy" data-act="buy">🛒 I bought it!</button>' : ''}`;
      li.querySelector('.p-emoji').textContent = p.emoji;
      const nameEl = li.querySelector('.p-name');
      if (p.link && /^https?:\/\//i.test(p.link)) {
        const a = document.createElement('a'); a.href = p.link; a.target = '_blank'; a.rel = 'noopener'; a.textContent = p.name;
        nameEl.appendChild(a);
      } else nameEl.textContent = p.name;
      li.querySelector('.p-price').textContent = `${fmt(p.price)} · ${hoursOfWork(p.price)} total`;
      ul.appendChild(li);
    });

    const bw = $('#boughtWrap'), bl = $('#bought');
    bw.classList.toggle('hidden', state.bought.length === 0);
    $('#boughtCount').textContent = state.bought.length;
    bl.innerHTML = '';
    state.bought.slice(0, 30).forEach((p) => {
      const li = document.createElement('li');
      li.className = 'product';
      li.innerHTML = '<div class="p-row"><div class="p-emoji"></div><div class="p-info"><div class="p-name"></div><div class="p-price"></div></div></div>';
      li.querySelector('.p-emoji').textContent = p.emoji;
      li.querySelector('.p-name').textContent = p.name;
      li.querySelector('.p-price').textContent = `${fmt(p.price)} · ${new Date(p.boughtAt).toLocaleDateString()}`;
      bl.appendChild(li);
    });
  }

  // cheap live update of progress bars without rebuilding the list
  function updateProductBars(have) {
    document.querySelectorAll('#products .product').forEach((li) => {
      const p = state.products.find((x) => x.id === li.dataset.id);
      if (!p) return;
      const ratio = Math.min(1, Math.max(0, have / p.price));
      const wasDone = li.querySelector('.p-buy');
      if (ratio >= 1 && !wasDone) { renderProducts(); return; }
      li.querySelector('.bar-fill').style.width = (ratio * 100).toFixed(2) + '%';
      li.querySelector('.p-pct').textContent = (ratio * 100).toFixed(ratio < 0.1 ? 1 : 0) + '%';
      if (ratio < 1) {
        const left = p.price - have;
        li.querySelector('.p-left').textContent = `${fmt(left)} to go · ${hoursOfWork(left)} of work`;
      }
    });
  }

  function checkMilestones(have) {
    state.products.forEach((p) => {
      const m = milestoneOf(have / p.price);
      if (m > (p.milestone || 0)) {
        p.milestone = m;
        save();
        if (m === 100) { toast(`🎉 You can now afford ${p.emoji} ${p.name}!`, true); confetti(120); lofi.chime(); notify(`You can afford ${p.name}! 🎉`); }
        else { toast(`${p.emoji} ${m}% of the way to ${p.name}!`); say(`${m}% to ${p.name}! ${m >= 75 ? 'Almost there 🔥' : 'Keep going 💪'}`); }
      }
    });
  }

  /* ---------------- stats ---------------- */
  const dayKey = (t) => { const d = new Date(t); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };
  function renderStats() {
    const now = Date.now(), today = dayKey(now);
    const byDay = {};
    let allMs = 0;
    state.history.forEach((h) => { const k = dayKey(h.end); byDay[k] = (byDay[k] || 0) + h.amount; allMs += h.ms; });
    const live = sessionEarned(now);
    byDay[today] = (byDay[today] || 0) + live;
    allMs += sessionMs(now);

    let week = 0;
    const cols = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - i);
      const v = byDay[dayKey(d)] || 0;
      week += v;
      cols.push({ v, label: d.toLocaleDateString(undefined, { weekday: 'short' }), today: i === 0 });
    }
    let streak = 0;
    for (let i = 0; i < 3650; i++) {
      const d = new Date(now); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - i);
      if (byDay[dayKey(d)] > 0) streak++;
      else if (i > 0) break;
    }

    $('#sToday').textContent = fmtShort(byDay[today] || 0);
    $('#sWeek').textContent = fmtShort(week);
    $('#sAll').textContent = fmtShort(state.bank + live);
    $('#sHours').textContent = (allMs / 3600000).toFixed(1) + 'h';
    $('#sStreak').textContent = streak;
    $('#sSpent').textContent = fmtShort(state.spent);

    const max = Math.max(...cols.map((c) => c.v), 0.0001);
    $('#weekChart').innerHTML = cols.map((c) => `<div class="wc-col" title="${fmt(c.v)}"><div class="wc-bar ${c.today ? 'today' : ''}" style="height:${Math.max(2, c.v / max * 100)}%"></div><div class="wc-l">${c.label}</div></div>`).join('');

    const hist = $('#history');
    hist.innerHTML = state.history.length ? '' : '<li><span class="h-meta">No sessions yet — your first one is waiting!</span></li>';
    state.history.slice(0, 40).forEach((h) => {
      const li = document.createElement('li');
      li.innerHTML = `<span class="h-meta">${new Date(h.end).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · ${fmtDuration(h.ms, false)}</span><span class="h-amt">${fmt(h.amount)}</span>`;
      hist.appendChild(li);
    });
  }

  /* ---------------- settings ---------------- */
  function fillSettings() {
    const st = state.settings;
    const cur = $('#currency');
    if (!cur.options.length) {
      CURRENCIES.forEach((c) => {
        let label = c;
        try { label = `${c} — ${new Intl.DisplayNames(undefined, { type: 'currency' }).of(c)}`; } catch (e) { /* older browsers */ }
        cur.add(new Option(label, c));
      });
    }
    $('#payType').value = st.payType; $('#amount').value = st.amount || '';
    $('#currency').value = st.currency; $('#hoursPerWeek').value = st.hoursPerWeek; $('#hoursPerDay').value = st.hoursPerDay;
    $('#breakEvery').value = String(st.breakEvery); $('#fur').value = st.fur;
    $('#autoMusic').checked = st.autoMusic; $('#coinSound').checked = st.coinSound;
    $('#volume').value = st.volume; $('#rain').checked = st.rain; $('#crackle').checked = st.crackle;
    updateSettingsVisibility();
  }
  function readSettingsForm() {
    return Object.assign({}, state.settings, {
      payType: $('#payType').value, amount: parseFloat($('#amount').value) || 0, currency: $('#currency').value,
      hoursPerWeek: parseFloat($('#hoursPerWeek').value) || 40, hoursPerDay: parseFloat($('#hoursPerDay').value) || 8,
      breakEvery: parseInt($('#breakEvery').value, 10) || 0, fur: $('#fur').value,
      autoMusic: $('#autoMusic').checked, coinSound: $('#coinSound').checked,
    });
  }
  function updateSettingsVisibility() {
    const t = $('#payType').value;
    document.querySelector('.salary-only').classList.toggle('hidden', !(t === 'monthly' || t === 'yearly'));
    document.querySelector('.daily-only').classList.toggle('hidden', t !== 'daily');
    const st = readSettingsForm(), r = hourlyRate(st);
    const prev = state.settings.currency;
    state.settings.currency = st.currency; // format preview in the chosen currency
    $('#ratePreview').textContent = r ? `≈ ${fmt(r)} / hour · ${fmt(r / 60, r / 60 < 1 ? 3 : 2)} / minute · ${fmt(r / 3600, 4)} / second` : 'Enter your pay to see your per-second rate ⏱';
    state.settings.currency = prev;
  }
  function saveSettings(e) {
    e.preventDefault();
    const changedCurrency = state.settings.currency !== $('#currency').value;
    state.settings = readSettingsForm();
    if (changedCurrency) { for (const k in fmtCache) delete fmtCache[k]; jar.refreshSprite(); }
    save(); applyFur(); render(); renderProducts(); renderStats();
    const m = $('#savedMsg'); m.classList.remove('hidden'); setTimeout(() => m.classList.add('hidden'), 1800);
    if (sess() && Math.abs(sess().rate - hourlyRate()) > 1e-9) toast('New rate applies from your next session.');
  }
  function applyFur() {
    const [f, b] = FUR[state.settings.fur] || FUR.orange;
    document.documentElement.style.setProperty('--fur', f);
    document.documentElement.style.setProperty('--belly', b);
  }

  /* ---------------- music ---------------- */
  const lofi = new window.Lofi();
  lofi.volume = state.settings.volume; lofi.rain = state.settings.rain; lofi.crackle = state.settings.crackle;
  function startMusic() { lofi.start(); renderMusic(); }
  function stopMusic() { lofi.stop(); renderMusic(); }
  function renderMusic() {
    $('#musicBtn').textContent = lofi.playing ? '⏸ Pause lofi' : '🎧 Play lofi';
    $('#scene').classList.toggle('music', lofi.playing);
  }

  /* ---------------- UI bits ---------------- */
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  let bubbleTimer = 0;
  function say(text) {
    const b = $('#bubble');
    b.style.opacity = 0;
    clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(() => { b.textContent = text; b.style.opacity = 1; }, 250);
  }
  function toast(text, gold = false) {
    const t = document.createElement('div');
    t.className = 'toast' + (gold ? ' gold' : '');
    t.textContent = text;
    $('#toasts').appendChild(t);
    setTimeout(() => { t.style.transition = 'opacity .4s'; t.style.opacity = 0; setTimeout(() => t.remove(), 450); }, 4200);
  }
  function notify(text) {
    if (!document.hidden || !('Notification' in window) || Notification.permission !== 'granted') return;
    try { new Notification('Coin Jar', { body: text, icon: 'icons/icon-128.png' }); } catch (e) { /* ignore */ }
  }
  function switchTab(name) {
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
    ['wishlist', 'stats', 'settings'].forEach((n) => $('#panel-' + n).classList.toggle('hidden', n !== name));
    if (name === 'stats') renderStats();
  }

  let lastTitle = '', lastBadge = '';
  function render() {
    const now = Date.now(), s = sess(), earned = sessionEarned(now), have = saved(now);
    const r = s ? s.rate : hourlyRate();

    const scene = $('#scene');
    scene.classList.toggle('working', running());
    scene.classList.toggle('resting', !running());

    const full = fmt(earned, 4);
    const main = fmt(earned, 2);
    // show the two extra "ticking" decimals next to the normal amount
    const m = full.match(/(\d)(\d\d)(\D*)$/);
    $('#earnMain').textContent = main;
    $('#earnExtra').textContent = m ? m[2] : '';
    $('#elapsed').textContent = fmtDuration(sessionMs(now));
    $('#ratePer').textContent = r ? `${fmt(r)}/h · ${fmt(r / 60, r / 60 < 1 ? 3 : 2)}/min` : 'set your pay ⚙️';
    $('#savedTop').textContent = fmt(have);

    $('#welcome').classList.toggle('hidden', !!hourlyRate());
    const sb = $('#startBtn');
    sb.textContent = !s ? '▶ Start working' : running() ? '⏸ Pause (break)' : '▶ Resume';
    sb.classList.toggle('paused', !!s && !running());
    $('#stopBtn').disabled = !s;

    $('#coinValue').textContent = s ? fmt(s.denom, s.denom < 1 ? 2 : 0) : '–';
    $('#coinCount').textContent = s ? s.dropped : 0;
    $('#jarsFilled').textContent = s && s.jars ? ` · 🫙×${s.jars} filled` : '';

    const fp = state.products.find((p) => p.id === state.focusId);
    $('#focusGoal').classList.toggle('hidden', !fp);
    if (fp) {
      const ratio = Math.min(1, Math.max(0, have / fp.price));
      $('#fgName').textContent = `${fp.emoji} ${fp.name}`;
      $('#fgPct').textContent = (ratio * 100).toFixed(ratio < 0.1 ? 2 : 1) + '%';
      const bar = $('#fgBar'); bar.style.width = (ratio * 100) + '%'; bar.classList.toggle('done', ratio >= 1);
      $('#fgSub').textContent = ratio >= 1 ? 'Goal reached — go get it! 🎉' : `${fmt(fp.price - have)} to go · about ${hoursOfWork(fp.price - have)} more work`;
    }

    const title = running() ? `${main} · Coin Jar` : 'Coin Jar';
    if (title !== lastTitle) { document.title = title; lastTitle = title; }

    if (IS_EXTENSION && chrome.action) {
      const badge = running() ? compact(earned) : '';
      if (badge !== lastBadge) {
        lastBadge = badge;
        try { chrome.action.setBadgeBackgroundColor({ color: '#e0a325' }); chrome.action.setBadgeText({ text: badge }); } catch (e) { /* ignore */ }
      }
    }
  }
  function compact(v) {
    if (v < 10) return v.toFixed(2);
    if (v < 100) return v.toFixed(1);
    if (v < 10000) return String(Math.floor(v));
    return Math.floor(v / 1000) + 'k';
  }

  /* ---------------- confetti ---------------- */
  const cc = $('#confetti'), cctx = cc.getContext('2d');
  let parts = [], confettiOn = false;
  function confetti(n) {
    cc.width = innerWidth; cc.height = innerHeight;
    const colors = ['#ffcc4d', '#ff8fab', '#6ee7b7', '#a5b4fc', '#fff'];
    for (let i = 0; i < n; i++) parts.push({ x: innerWidth / 2 + (Math.random() - 0.5) * 200, y: innerHeight * 0.35, vx: (Math.random() - 0.5) * 12, vy: -Math.random() * 12 - 4, r: Math.random() * 6 + 3, c: pick(colors), a: Math.random() * 6, life: 0 });
    if (!confettiOn) { confettiOn = true; requestAnimationFrame(stepConfetti); }
  }
  function stepConfetti() {
    cctx.clearRect(0, 0, cc.width, cc.height);
    parts.forEach((p) => { p.vy += 0.35; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.a += 0.15; p.life++; cctx.save(); cctx.translate(p.x, p.y); cctx.rotate(p.a); cctx.fillStyle = p.c; cctx.fillRect(-p.r, -p.r / 2, p.r * 2, p.r); cctx.restore(); });
    parts = parts.filter((p) => p.y < cc.height + 20 && p.life < 400);
    if (parts.length) requestAnimationFrame(stepConfetti); else { confettiOn = false; cctx.clearRect(0, 0, cc.width, cc.height); }
  }

  /* ---------------- the jar (canvas physics) ---------------- */
  const jar = (function () {
    const canvas = $('#jar'), ctx = canvas.getContext('2d');
    const W = 240, H = 300, CX = 120, R = 11, FLOOR = 282;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = W * dpr; canvas.height = H * dpr; ctx.scale(dpr, dpr);
    let coins = [], draining = false, full = false, drainT = 0, sprite = null, lastClink = 0;

    const halfWidth = (y) => (y < 48 ? 44 : y < 86 ? 44 + (y - 48) / 38 * 50 : 94);

    function refreshSprite() {
      const s = document.createElement('canvas'), d = R * 2 + 4;
      s.width = d * dpr; s.height = d * dpr;
      const g = s.getContext('2d'); g.scale(dpr, dpr);
      const c = d / 2;
      const grad = g.createRadialGradient(c - 4, c - 4, 1, c, c, R);
      grad.addColorStop(0, '#fff6cf'); grad.addColorStop(0.45, '#ffcc4d'); grad.addColorStop(1, '#d4921c');
      g.fillStyle = grad; g.beginPath(); g.arc(c, c, R, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#b07612'; g.lineWidth = 1.5; g.stroke();
      g.strokeStyle = 'rgba(176,118,18,.55)'; g.lineWidth = 1; g.beginPath(); g.arc(c, c, R - 3.2, 0, Math.PI * 2); g.stroke();
      g.fillStyle = '#9a640c'; g.font = '900 11px Nunito, system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(COIN_SYMBOL[state.settings.currency] || '¤', c, c + 0.5);
      sprite = s;
    }

    function add(instant = false) {
      if (draining || full) return;
      coins.push({ x: CX + (Math.random() - 0.5) * (instant ? 160 : 50), y: instant ? 90 + Math.random() * 180 : -10, vx: (Math.random() - 0.5) * 40, vy: instant ? 0 : 60, rot: Math.random() * Math.PI * 2, landed: instant, alpha: 1 });
    }

    function physics(dt) {
      const g = 900;
      for (const c of coins) { c.vy += g * dt; c.vx *= 0.995; c.x += c.vx * dt; c.y += c.vy * dt; }
      const D = R * 2;
      for (let it = 0; it < 4; it++) {
        for (let i = 0; i < coins.length; i++) {
          const a = coins[i];
          for (let j = i + 1; j < coins.length; j++) {
            const b = coins[j];
            const dx = b.x - a.x, dy = b.y - a.y, d2 = dx * dx + dy * dy;
            if (d2 >= D * D || d2 === 0) continue;
            const d = Math.sqrt(d2), nx = dx / d, ny = dy / d, ov = (D - d) / 2;
            a.x -= nx * ov; a.y -= ny * ov; b.x += nx * ov; b.y += ny * ov;
            const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
            if (vn < 0) {
              const imp = -1.2 * vn / 2;
              a.vx -= imp * nx; a.vy -= imp * ny; b.vx += imp * nx; b.vy += imp * ny;
              if (-vn > 140) { hit(a); hit(b); }
            }
          }
        }
        for (const c of coins) {
          if (c.y > FLOOR - R) { if (c.vy > 140) hit(c); c.y = FLOOR - R; c.vy *= -0.2; c.vx *= 0.85; }
          if (c.y > 20) {
            const hw = halfWidth(c.y) - R;
            if (c.x < CX - hw) { c.x = CX - hw; c.vx = Math.abs(c.vx) * 0.3; }
            if (c.x > CX + hw) { c.x = CX + hw; c.vx = -Math.abs(c.vx) * 0.3; }
          }
        }
      }
    }
    function hit(c) {
      if (c.landed) return;
      c.landed = true;
      const now = performance.now();
      if (state.settings.coinSound && now - lastClink > 60) { lastClink = now; lofi.clink(0.8 + Math.random() * 0.4); }
    }

    function jarPath() {
      ctx.beginPath();
      ctx.moveTo(CX - 46, 26);
      ctx.lineTo(CX - 46, 48);
      ctx.bezierCurveTo(CX - 46, 66, CX - 100, 66, CX - 100, 96);
      ctx.lineTo(CX - 100, FLOOR - 16);
      ctx.quadraticCurveTo(CX - 100, FLOOR + 6, CX - 78, FLOOR + 6);
      ctx.lineTo(CX + 78, FLOOR + 6);
      ctx.quadraticCurveTo(CX + 100, FLOOR + 6, CX + 100, FLOOR - 16);
      ctx.lineTo(CX + 100, 96);
      ctx.bezierCurveTo(CX + 100, 66, CX + 46, 66, CX + 46, 48);
      ctx.lineTo(CX + 46, 26);
    }

    function draw() {
      ctx.clearRect(0, 0, W, H);
      // glass back
      jarPath(); ctx.fillStyle = 'rgba(180, 200, 255, 0.07)'; ctx.fill();
      // coins
      for (const c of coins) {
        ctx.save(); ctx.globalAlpha = c.alpha; ctx.translate(c.x, c.y); ctx.rotate(c.rot);
        ctx.drawImage(sprite, -R - 2, -R - 2, R * 2 + 4, R * 2 + 4);
        ctx.restore();
      }
      // glass front
      jarPath(); ctx.strokeStyle = 'rgba(220, 230, 255, 0.45)'; ctx.lineWidth = 3; ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.beginPath(); ctx.roundRect ? ctx.roundRect(CX - 86, 104, 10, 150, 5) : ctx.rect(CX - 86, 104, 10, 150); ctx.fill();
      ctx.beginPath(); ctx.roundRect ? ctx.roundRect(CX - 70, 110, 4, 60, 2) : ctx.rect(CX - 70, 110, 4, 60); ctx.fill();
      // lid
      const lg = ctx.createLinearGradient(0, 10, 0, 28);
      lg.addColorStop(0, '#ff9fb8'); lg.addColorStop(1, '#e06b8d');
      ctx.fillStyle = lg;
      ctx.beginPath(); ctx.roundRect ? ctx.roundRect(CX - 54, 10, 108, 18, 6) : ctx.rect(CX - 54, 10, 108, 18); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.3)'; ctx.fillRect(CX - 48, 14, 96, 3);
      // slot
      ctx.fillStyle = '#7a2d48'; ctx.fillRect(CX - 16, 17, 32, 4);
    }

    let last = performance.now();
    function frame(now) {
      const dt = Math.min(0.033, (now - last) / 1000); last = now;
      // spawn coins owed by the session
      const s = sess();
      if (s && !draining) {
        const owed = Math.floor(sessionEarned() / s.denom + 1e-9);
        if (owed > s.dropped) {
          const pending = owed - s.dropped;
          if (pending > 40) {
            // way behind (tab was in the background): settle the jar instantly
            s.jars = Math.floor(owed / JAR_CAPACITY);
            s.dropped = owed;
            coins = [];
            for (let i = 0; i < owed % JAR_CAPACITY; i++) add(true);
          }
          // drop one at a time, or catch up quickly when a few behind
          const n = Math.min(owed - s.dropped, pending > 6 ? 3 : 1);
          for (let i = 0; i < n; i++) {
            s.dropped++;
            add();
            if (!full && coins.length >= JAR_CAPACITY) { fillUp(); break; }
          }
        }
      }
      if (draining) {
        drainT += dt;
        coins.forEach((c) => { c.alpha = Math.max(0, 1 - drainT / 0.8); c.vy -= 30; });
        if (drainT > 0.85) { coins = []; draining = false; full = false; drainT = 0; }
      }
      physics(dt / 2); physics(dt / 2);
      draw();
      requestAnimationFrame(frame);
    }

    function fillUp() {
      const s = sess();
      full = true;
      if (s) s.jars = (s.jars || 0) + 1;
      save();
      toast(`🫙 Jar full! That's ${fmt(s.denom * JAR_CAPACITY)} in coins. Emptying it into your savings…`, true);
      say('The jar is FULL! 🤩');
      confetti(80); lofi.chime();
      setTimeout(() => { draining = true; }, 900);
    }

    canvas.addEventListener('click', () => {
      lofi.getCtx();
      coins.forEach((c) => { c.vx += (Math.random() - 0.5) * 300; c.vy -= Math.random() * 280; c.landed = false; });
      if (!coins.length && state.settings.coinSound) lofi.clink();
    });

    refreshSprite();
    requestAnimationFrame(frame);

    return {
      reset() { coins = []; draining = false; full = false; },
      drain() { draining = true; drainT = 0; },
      refreshSprite,
      restore(count) { for (let i = 0; i < Math.min(count, JAR_CAPACITY - 1); i++) add(true); },
    };
  })();

  /* ---------------- wiring ---------------- */
  $('#startBtn').addEventListener('click', startOrPause);
  $('#stopBtn').addEventListener('click', () => {
    if (confirm(`Finish this session and bank ${fmt(sessionEarned())}?`)) finishSession();
  });
  $('#musicBtn').addEventListener('click', () => (lofi.playing ? stopMusic() : startMusic()));
  $('#volume').addEventListener('input', (e) => { state.settings.volume = +e.target.value; lofi.setVolume(state.settings.volume); save(); });
  $('#rain').addEventListener('change', (e) => { state.settings.rain = e.target.checked; lofi.setRain(e.target.checked); save(); if (e.target.checked && !lofi.playing) startMusic(); });
  $('#crackle').addEventListener('change', (e) => { state.settings.crackle = e.target.checked; lofi.setCrackle(e.target.checked); save(); });

  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => switchTab(t.dataset.tab)));
  document.querySelectorAll('[data-tab].link').forEach((t) => t.addEventListener('click', () => switchTab(t.dataset.tab)));

  $('#productForm').addEventListener('submit', addProduct);
  $('#products').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const id = btn.closest('.product').dataset.id;
    if (btn.dataset.act === 'focus') { state.focusId = id; save(); renderProducts(); render(); }
    if (btn.dataset.act === 'buy') buyProduct(id);
    if (btn.dataset.act === 'del') {
      const p = state.products.find((x) => x.id === id);
      if (p && confirm(`Remove "${p.name}" from your wishlist?`)) {
        state.products = state.products.filter((x) => x.id !== id);
        if (state.focusId === id) state.focusId = state.products[0] ? state.products[0].id : null;
        save(); renderProducts(); render();
      }
    }
  });

  $('#settingsForm').addEventListener('submit', saveSettings);
  ['payType', 'amount', 'currency', 'hoursPerWeek', 'hoursPerDay'].forEach((id) => $('#' + id).addEventListener('input', updateSettingsVisibility));
  $('#fur').addEventListener('change', () => { state.settings.fur = $('#fur').value; applyFur(); save(); });
  $('#breakEvery').addEventListener('change', () => {
    if ($('#breakEvery').value !== '0' && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission();
  });

  $('#exportBtn').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `coin-jar-${new Date().toISOString().slice(0, 10)}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  $('#importFile').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (typeof data !== 'object' || !data.settings) throw new Error('bad file');
      if (!confirm('Replace your current data with this backup?')) return;
      localStorage.setItem(STORE_KEY, JSON.stringify(data));
      location.reload();
    } catch (err) { toast('That file doesn\'t look like a Coin Jar backup.'); }
  });
  $('#resetBtn').addEventListener('click', () => {
    if (!confirm('Delete ALL your Coin Jar data (savings, history, wishlist)? This cannot be undone.')) return;
    try { localStorage.removeItem(STORE_KEY); } catch (e) { /* ignore */ }
    location.reload();
  });

  document.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && !/INPUT|SELECT|TEXTAREA|BUTTON/.test(document.activeElement.tagName)) { e.preventDefault(); startOrPause(); }
  });
  window.addEventListener('storage', (e) => { if (e.key === STORE_KEY) { state = load(); render(); renderProducts(); } });

  /* ---------------- boot ---------------- */
  applyFur();
  fillSettings();

  if (sess() && sess().startedAt) {
    // the page was closed while the timer was running
    const gap = Date.now() - (sess().lastSeen || sess().startedAt);
    if (gap > AWAY_LIMIT_MS && !confirm(`Welcome back! The timer was running while this page was closed (${fmtDuration(gap, false)}). Count that time as work?`)) {
      sess().accMs += Math.max(0, sess().lastSeen - sess().startedAt);
      sess().startedAt = null;
    }
    save();
  }
  if (sess()) jar.restore(sess().dropped % JAR_CAPACITY);
  if (!hourlyRate()) switchTab('settings');

  render(); renderProducts(); renderStats(); renderMusic();
  if (!sess()) say(hourlyRate() ? 'Ready when you are ✨  (Space = start/pause)' : 'Hi! Tell me your pay and let\'s fill this jar 🪙');

  let ticks = 0;
  setInterval(() => {
    ticks++;
    render();
    if (ticks % 16 === 0 && !$('#panel-stats').classList.contains('hidden')) renderStats();
    const s = sess();
    if (!s || !s.startedAt) return;
    const now = Date.now(), have = saved(now);
    if (ticks % 2 === 0) updateProductBars(have);
    checkMilestones(have);
    if (ticks % 20 === 0) { s.lastSeen = now; save(); }
    if (ticks % 240 === 0) say(pick(QUOTES)); // about once a minute

    const every = state.settings.breakEvery * 60000, worked = sessionMs(now);
    if (every && worked - (s.lastBreakMs || 0) >= every) {
      s.lastBreakMs = worked; save();
      const msg = `You've been working ${fmtDuration(every, false)}. Stretch, drink some water, rest your eyes 🌿`;
      toast(msg, true); say('Break time? 🍵'); notify(msg); lofi.chime();
    }
  }, 250);
  window.addEventListener('beforeunload', () => { if (sess()) { sess().lastSeen = Date.now(); save(); } });
})();
