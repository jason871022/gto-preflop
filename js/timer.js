/* 錦標賽計時器：盲注時鐘 + 玩家計分 + 獎池計算
   狀態全存 localStorage，重新整理／關閉分頁不會遺失。 */
'use strict';
(() => {
  const LS_KEY = 'gto_timer_v1';
  const $ = s => document.querySelector(s);

  /* ---------------- 盲注模板 ----------------
     結構來源：家庭賽 T25 標準（homepokertourney.org）、WSOP 主賽百盲
     結構（60k 起始、BB 前注）、PokerStars 式單桌 SNG（1.5k 起始）。 */
  const BLINDS = [
    [25,50],[50,100],[75,150],[100,200],[150,300],[200,400],[300,600],
    [400,800],[600,1200],[800,1600],[1000,2000],[1500,3000],[2000,4000],[3000,6000],
  ];
  const DEEP_BLINDS = [
    [25,50],[50,100],[75,150],[100,200],[125,250],[150,300],[200,400],[250,500],
    [300,600],[400,800],[500,1000],[600,1200],[800,1600],[1000,2000],[1500,3000],[2000,4000],
  ];
  const WSOP_BLINDS = [   // ante 以 BB 前注呈現（＝大盲）
    [100,200],[200,300],[200,400],[300,600],[400,800],[500,1000],[600,1200],
    [800,1600],[1000,2000],[1200,2400],[1500,3000],[2000,4000],[2500,5000],
    [3000,6000],[4000,8000],[5000,10000],
  ];
  const SNG_BLINDS = [    // 第三欄＝傳統前注，第 7 級起收
    [10,20,0],[15,30,0],[25,50,0],[50,100,0],[75,150,0],[100,200,0],
    [125,250,25],[150,300,25],[200,400,50],[300,600,75],[400,800,100],
    [600,1200,150],[800,1600,200],[1000,2000,250],[1500,3000,300],[2000,4000,400],
  ];
  function makeTpl(rows, min, breakEvery, bbAnte) {
    const lv = [];
    rows.forEach((r, i) => {
      lv.push({ t: 'L', sb: r[0], bb: r[1], ante: bbAnte ? r[1] : (r[2] || 0), min });
      if (breakEvery && (i + 1) % breakEvery === 0 && i !== rows.length - 1)
        lv.push({ t: 'B', min: 10 });
    });
    return lv;
  }
  const TEMPLATES = {
    std: {
      label: '家庭賽標準 · 20 分/級', chips: 10000,
      desc: '最通用的家庭錦標賽結構（T25 籌碼、每 4 級休息 10 分），約 4～5 小時。',
      make: () => makeTpl(BLINDS, 20, 4),
    },
    turbo: {
      label: '快速賽 · 10 分/級', chips: 10000,
      desc: '同標準結構但 10 分鐘一級，約 2～2.5 小時打完，適合平日晚上。',
      make: () => makeTpl(BLINDS, 10, 6),
    },
    deep: {
      label: '深籌碼 · 15 分/級', chips: 10000,
      desc: '升盲級距更細（多 125/250、250/500 等），前中期打得更深、更有技術含量。',
      make: () => makeTpl(DEEP_BLINDS, 15, 4),
    },
    wsop: {
      label: 'WSOP 主賽風格 · 30 分/級', chips: 60000,
      desc: '照 WSOP 主賽事結構：起始 60,000（300BB）、100/200 開局、BB 前注（前注＝大盲）。原版每級 120 分，這裡預設 30 分，可自行改。',
      make: () => makeTpl(WSOP_BLINDS, 30, 4, true),
    },
    sng: {
      label: '線上單桌 SNG · 10 分/級', chips: 1500,
      desc: 'PokerStars 式單桌 9 人結構：起始 1,500、10/20 開局、第 7 級起收傳統前注，全程無休息。',
      make: () => makeTpl(SNG_BLINDS, 10, 0),
    },
    hyper: {
      label: '極速 SNG · 5 分/級', chips: 1500,
      desc: '同單桌 SNG 結構、5 分鐘一級，半小時～一小時內見真章。',
      make: () => makeTpl(SNG_BLINDS, 5, 0),
    },
  };

  /* ---------------- 外觀 ---------------- */
  const ACCENTS = ['#f2c14e', '#e2504d', '#4a9fd6', '#3fae5a', '#a06ee0'];
  function defaultUI() {
    return { accent: ACCENTS[0], scale: 1, show: { next: true, avg: true, pool: true, brk: true } };
  }

  /* ---------------- 狀態 ---------------- */
  function defaultState() {
    const levels = TEMPLATES.std.make();
    return {
      cfg: {
        buyin: 100, fee: 0, startChips: 10000,
        rebuyCost: 100, rebuyChips: 10000,
        addonCost: 100, addonChips: 15000,
        payouts: [50, 30, 20], sound: true,
        ui: defaultUI(),
      },
      counters: { entries: 0, remaining: 0, rebuys: 0, addons: 0 },
      levels,
      timer: { idx: 0, remain: levels[0].min * 60000, running: false, ts: null, warned: false },
    };
  }

  let state = load();
  function load() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return defaultState();
      const s = JSON.parse(raw);
      if (!s.cfg || !s.levels || !s.levels.length || !s.timer) return defaultState();
      if (!s.cfg.ui) s.cfg.ui = defaultUI();          // 舊版存檔補上外觀設定
      s.cfg.ui.show = Object.assign({ next: true, avg: true, pool: true, brk: true }, s.cfg.ui.show);
      // 若上次關閉時計時器在跑，補回經過的時間
      if (s.timer.running && s.timer.ts) {
        s.timer.remain -= Date.now() - s.timer.ts;
        s.timer.ts = Date.now();
        while (s.timer.remain <= 0 && s.timer.idx < s.levels.length - 1) {
          s.timer.idx++;
          s.timer.remain += s.levels[s.timer.idx].min * 60000;
          s.timer.warned = false;
        }
        if (s.timer.remain <= 0) { s.timer.remain = 0; s.timer.running = false; }
      }
      return s;
    } catch { return defaultState(); }
  }
  function save() { localStorage.setItem(LS_KEY, JSON.stringify(state)); }

  /* ---------------- 音效（WebAudio，免音檔） ---------------- */
  let audioCtx = null;
  function beep(times, freq = 880) {
    if (!state.cfg.sound) return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      let t = audioCtx.currentTime;
      for (let i = 0; i < times; i++) {
        const o = audioCtx.createOscillator(), g = audioCtx.createGain();
        o.frequency.value = freq; o.type = 'sine';
        g.gain.setValueAtTime(0.001, t);
        g.gain.exponentialRampToValueAtTime(0.5, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
        o.connect(g); g.connect(audioCtx.destination);
        o.start(t); o.stop(t + 0.3);
        t += 0.38;
      }
    } catch { /* 無音效環境就算了 */ }
  }

  /* ---------------- 亮屏鎖定（手機） ---------------- */
  let wakeLock = null;
  async function acquireWakeLock() {
    try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* 不支援就略過 */ }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.timer.running) acquireWakeLock();
  });

  /* ---------------- 計時核心 ---------------- */
  function curLevel() { return state.levels[state.timer.idx]; }
  function levelDur(i) { return state.levels[i].min * 60000; }

  function gotoLevel(i, { silent = false } = {}) {
    if (i < 0 || i >= state.levels.length) return;
    state.timer.idx = i;
    state.timer.remain = levelDur(i);
    state.timer.warned = false;
    if (!silent) { beep(3); flashClock(); }
    save(); renderAll();
  }

  function flashClock() {
    const p = $('#clockPanel');
    p.classList.remove('flash'); void p.offsetWidth; p.classList.add('flash');
  }

  function toggleRun() {
    const t = state.timer;
    t.running = !t.running;
    if (t.running) {
      t.ts = Date.now();
      if (t.remain <= 0) gotoLevel(0, { silent: true });
      acquireWakeLock();
      if (audioCtx?.state === 'suspended') audioCtx.resume();
    } else {
      wakeLock?.release().catch(() => {}); wakeLock = null;
    }
    save(); renderClock();
  }

  setInterval(() => {
    const t = state.timer;
    if (!t.running) return;
    const now = Date.now();
    t.remain -= now - t.ts;
    t.ts = now;
    const lv = curLevel();
    if (lv.t === 'L' && !t.warned && t.remain <= 60000 && t.remain > 0) {
      t.warned = true; beep(1, 660);
    }
    if (t.remain <= 0) {
      if (t.idx < state.levels.length - 1) {
        const carry = t.remain;                 // 帶著超出的零頭進下一級
        gotoLevel(t.idx + 1);
        t.remain += carry;
      } else {
        t.remain = 0; t.running = false;
        beep(5, 990);
        wakeLock?.release().catch(() => {}); wakeLock = null;
      }
    }
    save(); renderClock();
  }, 250);

  /* ---------------- 獎池計算 ---------------- */
  function poolTotal() {
    const c = state.counters, f = state.cfg;
    const gross = c.entries * f.buyin + c.rebuys * f.rebuyCost + c.addons * f.addonCost;
    return Math.max(0, Math.round(gross * (1 - (f.fee || 0) / 100)));
  }
  function chipsTotal() {
    const c = state.counters, f = state.cfg;
    return c.entries * f.startChips + c.rebuys * f.rebuyChips + c.addons * f.addonChips;
  }
  const PAYOUT_PRESETS = {
    1: [100], 2: [60, 40], 3: [50, 30, 20], 4: [40, 30, 20, 10],
    5: [38, 26, 17, 11, 8], 6: [35, 24, 16, 11, 8, 6],
  };
  function payoutAmounts() {
    const pool = poolTotal(), ps = state.cfg.payouts;
    const amts = ps.map(p => Math.floor(pool * p / 100));
    const used = amts.reduce((a, b) => a + b, 0);
    if (amts.length) amts[0] += pool - used;   // 進位零頭給冠軍
    return amts;
  }

  /* ---------------- 畫面 ---------------- */
  const fmtN = n => n.toLocaleString('en-US');
  function fmtTime(ms) {
    const s = Math.max(0, Math.ceil(ms / 1000));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
    const mm = String(m).padStart(2, '0'), sss = String(ss).padStart(2, '0');
    return h > 0 ? `${h}:${mm}:${sss}` : `${mm}:${sss}`;
  }
  function levelLabel(lv, idx) {
    if (lv.t === 'B') return '☕ 休息';
    let n = 0;
    for (let i = 0; i <= idx; i++) if (state.levels[i].t === 'L') n++;
    return `第 ${n} 級`;
  }
  function blindsText(lv) {
    return lv.t === 'B' ? '休息時間' : `${fmtN(lv.sb)} / ${fmtN(lv.bb)}`;
  }

  function applyUI() {
    const ui = state.cfg.ui;
    document.documentElement.style.setProperty('--accent', ui.accent);
    document.documentElement.style.setProperty('--clock-scale', ui.scale);
    $('#nextLine').classList.toggle('hidden', !ui.show.next);
    $('#wAvg').classList.toggle('hidden', !ui.show.avg);
    $('#wPool').classList.toggle('hidden', !ui.show.pool);
    $('#wBreak').classList.toggle('hidden', !ui.show.brk);
    // 控制項狀態
    document.querySelectorAll('#swatches .swatch').forEach(b =>
      b.classList.toggle('active', b.dataset.c === ui.accent));
    document.querySelectorAll('#scaleSeg button').forEach(b =>
      b.classList.toggle('active', Number(b.dataset.s) === ui.scale));
    document.querySelectorAll('[data-show]').forEach(cb => { cb.checked = !!ui.show[cb.dataset.show]; });
  }

  function renderClock() {
    const t = state.timer, lv = curLevel();
    $('#lvlName').textContent = levelLabel(lv, t.idx);
    const dur = levelDur(t.idx);
    $('#lvlProgress').style.width = `${Math.min(100, Math.max(0, (1 - t.remain / dur) * 100))}%`;
    const bt = $('#bigTime');
    bt.textContent = fmtTime(t.remain);
    bt.classList.toggle('paused', !t.running);
    bt.classList.toggle('warn', lv.t === 'L' && t.remain <= 60000 && t.remain > 0 && t.running);
    const bb = $('#bigBlinds');
    bb.textContent = blindsText(lv);
    bb.classList.toggle('break-label', lv.t === 'B');
    $('#anteLine').textContent = lv.t === 'L' && lv.ante > 0 ? `前注 ${fmtN(lv.ante)}` : '';
    const nxt = state.levels[t.idx + 1];
    $('#nextLine').innerHTML = nxt
      ? `下一級：<b>${blindsText(nxt)}</b>${nxt.t === 'L' && nxt.ante ? `（前注 ${fmtN(nxt.ante)}）` : ''} · ${nxt.min} 分`
      : (t.remain <= 0 && !t.running ? '🏁 結構已跑完' : '最後一級');
    const btn = $('#btnStart');
    btn.textContent = t.running ? '⏸ 暫停' : '▶ 開始';
    btn.classList.toggle('running', t.running);
  }

  function renderBadges() {
    const c = state.counters;
    $('#bRemain').textContent = c.entries ? `${c.remaining} / ${c.entries}` : '—';
    const chips = chipsTotal();
    $('#bAvg').textContent = c.remaining > 0 && chips > 0
      ? `${fmtN(Math.round(chips / c.remaining))}` : '—';
    $('#bPool').textContent = c.entries ? fmtN(poolTotal()) : '—';
    // 下次休息倒數（現在起還要跑多久）
    let ms = state.timer.remain, found = null;
    for (let i = state.timer.idx + 1; i < state.levels.length; i++) {
      if (state.levels[i].t === 'B') { found = ms; break; }
      ms += levelDur(i);
    }
    $('#bBreak').textContent = curLevel().t === 'B' ? '休息中' : (found != null ? fmtTime(found) : '無');
  }

  function renderCounters() {
    $('#cEntries').textContent = state.counters.entries;
    $('#cRemaining').textContent = state.counters.remaining;
    $('#cRebuys').textContent = state.counters.rebuys;
    $('#cAddons').textContent = state.counters.addons;
  }

  function renderPool() {
    const c = state.counters, f = state.cfg;
    const gross = c.entries * f.buyin + c.rebuys * f.rebuyCost + c.addons * f.addonCost;
    $('#poolSummary').innerHTML =
      `總獎池 <b>${fmtN(poolTotal())}</b><br>` +
      `<span class="hint">買入 ${c.entries}×${fmtN(f.buyin)} ＋ 重買 ${c.rebuys}×${fmtN(f.rebuyCost)} ＋ 加碼 ${c.addons}×${fmtN(f.addonCost)} ＝ ${fmtN(gross)}` +
      (f.fee ? `，抽水 ${f.fee}%` : '') + `</span>`;

    // % 編輯器
    const pe = $('#payoutEdit');
    pe.innerHTML = '';
    state.cfg.payouts.forEach((p, i) => {
      const lab = document.createElement('label');
      lab.innerHTML = `第 ${i + 1} 名 %`;
      const inp = document.createElement('input');
      inp.type = 'number'; inp.min = 0; inp.max = 100; inp.value = p; inp.inputMode = 'numeric';
      inp.addEventListener('change', () => {
        state.cfg.payouts[i] = Math.max(0, Number(inp.value) || 0);
        save(); renderPool();
      });
      lab.appendChild(inp); pe.appendChild(lab);
    });
    const sum = state.cfg.payouts.reduce((a, b) => a + b, 0);
    if (sum !== 100) {
      const w = document.createElement('div');
      w.className = 'sum-warn';
      w.textContent = `⚠ 百分比合計 ${sum}%（不是 100%）`;
      pe.appendChild(w);
    }

    // 金額表
    const amts = payoutAmounts();
    $('#payoutTable').innerHTML = amts.map((a, i) =>
      `<div class="payout-row${i === 0 ? ' first' : ''}">
         <span class="place">第 ${i + 1} 名 · ${state.cfg.payouts[i]}%</span>
         <span class="amt">${fmtN(a)}</span>
       </div>`).join('');
  }

  function renderLevels() {
    const tb = $('#lvlBody');
    tb.innerHTML = '';
    let n = 0;
    state.levels.forEach((lv, i) => {
      const tr = document.createElement('tr');
      if (i === state.timer.idx) tr.classList.add('current');
      if (lv.t === 'B') {
        tr.classList.add('brk');
        tr.innerHTML = `<td class="idx" data-i="${i}">☕</td>
          <td colspan="3">休息</td>
          <td><input class="min-in" type="number" min="1" value="${lv.min}" data-i="${i}" data-f="min" inputmode="numeric"></td>
          <td><button class="del" data-i="${i}">✕</button></td>`;
      } else {
        n++;
        tr.innerHTML = `<td class="idx" data-i="${i}">${n}</td>
          <td><input type="number" min="0" value="${lv.sb}" data-i="${i}" data-f="sb" inputmode="numeric"></td>
          <td><input type="number" min="0" value="${lv.bb}" data-i="${i}" data-f="bb" inputmode="numeric"></td>
          <td><input type="number" min="0" value="${lv.ante}" data-i="${i}" data-f="ante" inputmode="numeric"></td>
          <td><input class="min-in" type="number" min="1" value="${lv.min}" data-i="${i}" data-f="min" inputmode="numeric"></td>
          <td><button class="del" data-i="${i}">✕</button></td>`;
      }
      tb.appendChild(tr);
    });
  }

  function renderCfg() {
    const f = state.cfg;
    $('#cfgBuyin').value = f.buyin; $('#cfgStartChips').value = f.startChips;
    $('#cfgRebuyCost').value = f.rebuyCost; $('#cfgRebuyChips').value = f.rebuyChips;
    $('#cfgAddonCost').value = f.addonCost; $('#cfgAddonChips').value = f.addonChips;
    $('#cfgFee').value = f.fee;
    $('#cfgPlaces').value = String(f.payouts.length);
    $('#soundToggle').checked = f.sound;
  }

  function renderAll() {
    applyUI(); renderClock(); renderBadges(); renderCounters(); renderPool(); renderLevels(); renderCfg();
  }

  /* ---------------- 事件 ---------------- */
  $('#btnStart').addEventListener('click', toggleRun);
  $('#btnNext').addEventListener('click', () => { if (state.timer.idx < state.levels.length - 1) gotoLevel(state.timer.idx + 1, { silent: true }); });
  $('#btnPrev').addEventListener('click', () => gotoLevel(Math.max(0, state.timer.idx - 1), { silent: true }));
  $('#btnPlus').addEventListener('click', () => { state.timer.remain += 60000; save(); renderClock(); });
  $('#btnMinus').addEventListener('click', () => { state.timer.remain = Math.max(0, state.timer.remain - 60000); save(); renderClock(); });

  // 玩家計數
  document.querySelectorAll('[data-cnt]').forEach(btn => {
    btn.addEventListener('click', () => {
      const k = btn.dataset.cnt, d = Number(btn.dataset.d);
      const c = state.counters;
      c[k] = Math.max(0, c[k] + d);
      if (k === 'entries') c.remaining = Math.max(0, c.remaining + d);   // 買入進場同步剩餘
      if (k === 'remaining' && c.remaining > c.entries) c.remaining = c.entries;
      save(); renderCounters(); renderBadges(); renderPool();
    });
  });

  // 買入設定
  const cfgMap = {
    cfgBuyin: 'buyin', cfgStartChips: 'startChips', cfgRebuyCost: 'rebuyCost',
    cfgRebuyChips: 'rebuyChips', cfgAddonCost: 'addonCost', cfgAddonChips: 'addonChips', cfgFee: 'fee',
  };
  Object.entries(cfgMap).forEach(([id, key]) => {
    $('#' + id).addEventListener('change', e => {
      state.cfg[key] = Math.max(0, Number(e.target.value) || 0);
      save(); renderBadges(); renderPool();
    });
  });

  // 名次數
  $('#cfgPlaces').addEventListener('change', e => {
    const n = Number(e.target.value);
    state.cfg.payouts = (PAYOUT_PRESETS[n] || [100]).slice();
    save(); renderPool();
  });

  // 盲注表：編輯 / 刪除 / 跳級
  $('#lvlBody').addEventListener('change', e => {
    const inp = e.target;
    if (!inp.dataset.f) return;
    const i = Number(inp.dataset.i), f = inp.dataset.f;
    const v = Math.max(f === 'min' ? 1 : 0, Number(inp.value) || 0);
    state.levels[i][f] = v;
    if (f === 'min' && i === state.timer.idx && state.timer.remain > v * 60000)
      state.timer.remain = v * 60000;
    save(); renderClock(); renderBadges(); renderLevels();
  });
  $('#lvlBody').addEventListener('click', e => {
    const del = e.target.closest('.del');
    if (del) {
      const i = Number(del.dataset.i);
      if (state.levels.length <= 1) return;
      state.levels.splice(i, 1);
      if (state.timer.idx >= state.levels.length) state.timer.idx = state.levels.length - 1;
      if (state.timer.idx === i) gotoLevel(Math.min(i, state.levels.length - 1), { silent: true });
      else { if (i < state.timer.idx) state.timer.idx--; save(); renderAll(); }
      return;
    }
    const idx = e.target.closest('.idx');
    if (idx) gotoLevel(Number(idx.dataset.i), { silent: true });
  });

  $('#addLevelBtn').addEventListener('click', () => {
    const last = [...state.levels].reverse().find(l => l.t === 'L');
    const nl = last
      ? { t: 'L', sb: last.bb, bb: last.bb * 2, ante: last.ante ? last.bb * 2 : 0, min: last.min }
      : { t: 'L', sb: 25, bb: 50, ante: 0, min: 20 };
    state.levels.push(nl);
    save(); renderLevels(); renderClock(); renderBadges();
  });
  $('#addBreakBtn').addEventListener('click', () => {
    state.levels.push({ t: 'B', min: 10 });
    save(); renderLevels(); renderBadges();
  });

  // 模板：下拉快選 + 套用
  const tplSel = $('#tplSelect');
  Object.entries(TEMPLATES).forEach(([key, t]) => {
    const o = document.createElement('option');
    o.value = key; o.textContent = t.label;
    tplSel.appendChild(o);
  });
  function showTplDesc() {
    const t = TEMPLATES[tplSel.value];
    $('#tplDesc').textContent = `${t.desc}（建議起始籌碼 ${t.chips.toLocaleString('en-US')}）`;
  }
  tplSel.addEventListener('change', showTplDesc);
  showTplDesc();
  $('#tplApply').addEventListener('click', () => {
    const t = TEMPLATES[tplSel.value];
    if (!confirm(`套用「${t.label}」？會覆蓋現有盲注結構，並把起始籌碼設為 ${t.chips.toLocaleString('en-US')}。`)) return;
    state.levels = t.make();
    state.cfg.startChips = t.chips;
    gotoLevel(0, { silent: true });   // 內含 save + renderAll
  });

  // 外觀：主題色 / 時鐘大小 / 顯示項目 / 全螢幕
  ACCENTS.forEach(c => {
    const b = document.createElement('button');
    b.className = 'swatch'; b.dataset.c = c;
    b.style.background = c; b.style.color = c;
    b.title = '主題色';
    b.addEventListener('click', () => { state.cfg.ui.accent = c; save(); applyUI(); });
    $('#swatches').appendChild(b);
  });
  document.querySelectorAll('#scaleSeg button').forEach(b => {
    b.addEventListener('click', () => { state.cfg.ui.scale = Number(b.dataset.s); save(); applyUI(); });
  });
  document.querySelectorAll('[data-show]').forEach(cb => {
    cb.addEventListener('change', () => { state.cfg.ui.show[cb.dataset.show] = cb.checked; save(); applyUI(); });
  });
  $('#fsBtn').addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else $('#clockPanel').requestFullscreen?.().catch(() => {});
  });
  document.addEventListener('fullscreenchange', () => {
    $('#fsBtn').textContent = document.fullscreenElement ? '✕' : '⛶';
  });

  // 音效開關 / 重設
  $('#soundToggle').addEventListener('change', e => { state.cfg.sound = e.target.checked; save(); });
  $('#resetAllBtn').addEventListener('click', () => {
    if (!confirm('重設全部？計時、玩家數、獎池設定都會清空。')) return;
    state = defaultState(); save(); renderAll();
  });

  window.addEventListener('beforeunload', save);

  /* ---------------- 啟動 ---------------- */
  renderAll();
  if (state.timer.running) acquireWakeLock();
})();
