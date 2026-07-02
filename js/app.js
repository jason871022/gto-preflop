/*
 * app.js — 介面邏輯：範圍表檢視、條列、加權編輯（混合頻率）、隨機練習、Equity。
 *
 * 資料模型（仿 solver）：每個 spot 建成 map[hand] = 分布物件 {動作: 權重}，
 *   權重總和 <= 1，剩下的 (1 - sum) 就是「棄牌」。純策略圖每手是 {R:1} 這種。
 *   編輯模式可用「動作 + 權重」畫出混合頻率格（如 {'3B':0.5} = 50% 3-bet / 50% 蓋牌）。
 */
(function () {
  'use strict';
  var H = window.Hands;
  var DATA = window.RANGE_DATA;
  var ACT = DATA.ACTIONS;
  var ACT_ORDER = ['R', 'L', '3V', '3B', '4V', '4B', 'C'];

  var state = {
    format: '6max', mode: 'chart', scenario: 'rfi',
    spotKey: null, chartMode: 'grid',
    editing: false, brush: 'R', brushWeight: 1,
    overrides: {}   // "format|scenario|spotKey" -> { hand: {act:w} }
  };
  var trainer = { keys: [], total: 0, correct: 0, streak: 0, best: 0, current: null, answered: false, mistakes: [], reviewMode: false, timed: false, timeLeft: 0, timerId: null };

  // ---------- 資料存取 ----------
  function scen() { return DATA.SCENARIOS[state.scenario]; }
  function currentKeys() { return DATA.keysOf(state.scenario, state.format); }
  function spotOf(key) { return scen().data[state.format][key]; }
  function rawSpot() { return spotOf(state.spotKey); }
  function overrideKey() { return state.format + '|' + state.scenario + '|' + state.spotKey; }

  function actionsInSpot(spot) {
    return Object.keys(spot).filter(function (k) { return k !== '_note'; })
      .sort(function (a, b) { return ACT_ORDER.indexOf(a) - ACT_ORDER.indexOf(b); });
  }

  // 建 hand -> 分布物件（套用編輯覆蓋）。
  function buildMapFrom(spot, ovKey) {
    var map = {};
    actionsInSpot(spot).forEach(function (act) {
      H.expandRange(spot[act]).forEach(function (h) { (map[h] = map[h] || {})[act] = 1; });
    });
    var ov = ovKey && state.overrides[ovKey];
    if (ov) Object.keys(ov).forEach(function (h) { map[h] = Object.assign({}, ov[h]); });
    return map;
  }
  function buildMap(spot) { return buildMapFrom(spot, overrideKey()); }

  function distSum(d) { var s = 0; for (var k in d) s += d[k]; return s; }
  function topAction(d) {   // 分布中權重最大的動作（棄牌以剩餘權重參賽）——給練習/縮圖上色用
    var best = 'F', bw = 1 - distSum(d);
    for (var a in d) if (d[a] > bw) { bw = d[a]; best = a; }
    return best;
  }
  // 各動作的組合數（含分數權重），fold = 剩餘。
  function combosByAction(map) {
    var res = { F: 0 };
    ACT_ORDER.forEach(function (a) { res[a] = 0; });
    H.allHands().forEach(function (h) {
      var d = map[h] || {}, used = 0, cc = H.comboCount(h);
      for (var a in d) { res[a] += cc * d[a]; used += d[a]; }
      res.F += cc * (1 - used);
    });
    return res;
  }
  function pctPlayed(map) {
    var c = combosByAction(map);
    return (1326 - c.F) / 1326 * 100;
  }

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  // ---------- localStorage ----------
  function saveOverrides() {
    try { localStorage.setItem('gto_overrides', JSON.stringify(state.overrides)); } catch (e) {}
  }
  function loadOverrides() {
    try { var s = localStorage.getItem('gto_overrides'); if (s) state.overrides = JSON.parse(s); } catch (e) {}
  }

  // ============================================================
  // 範圍表模式
  // ============================================================
  function renderKeys() {
    var box = document.getElementById('posList');
    box.innerHTML = '';
    document.getElementById('posHeading').textContent = state.scenario === 'rfi' ? '位置' : '對戰組';
    currentKeys().forEach(function (key) {
      var ovK = state.format + '|' + state.scenario + '|' + key;
      var map = buildMapFrom(spotOf(key), ovK);
      var b = el('button', key === state.spotKey ? 'active' : '',
        '<span>' + key + '</span><span class="mini-pct">' + pctPlayed(map).toFixed(0) + '%</span>');
      b.onclick = function () { state.spotKey = key; renderChart(); renderKeys(); };
      box.appendChild(b);
    });
  }

  function renderChart() {
    if (!currentKeys().length) return;
    if (currentKeys().indexOf(state.spotKey) === -1) state.spotKey = currentKeys()[0];
    var spot = rawSpot(), map = buildMap(spot);
    var note = spot._note ? '　⚠ ' + spot._note : '';
    var edited = state.overrides[overrideKey()] ? '　✎ 已編輯' : '';
    document.getElementById('spotTitle').textContent = state.format + ' · ' + state.spotKey + note + edited;
    document.getElementById('scenarioDesc').textContent = scen().desc;
    renderGrid(map);
    renderList(map, spot);
    renderLegend(spot);
    renderCoverage(map, spot);
    renderBrushes(spot);
  }

  function renderGrid(map) {
    var grid = document.getElementById('grid');
    grid.innerHTML = '';
    grid.classList.toggle('editing', state.editing);
    for (var r = 0; r < 13; r++) {
      for (var c = 0; c < 13; c++) {
        var hand = H.handAt(r, c), d = map[hand] || {};
        var cell = el('div', 'cell ' + H.handType(hand));
        var frac = el('div', 'frac'), used = 0;
        ACT_ORDER.forEach(function (a) {
          if (d[a]) { var sp = el('span'); sp.style.width = (d[a] * 100) + '%'; sp.style.background = ACT[a].color; frac.appendChild(sp); used += d[a]; }
        });
        if (used < 0.999) { var f = el('span'); f.style.width = ((1 - used) * 100) + '%'; f.style.background = ACT.F.color; frac.appendChild(f); }
        cell.appendChild(frac);
        cell.appendChild(el('span', 'lbl', hand));
        cell.dataset.hand = hand;
        if (state.editing) cell.onclick = onEditCell;
        grid.appendChild(cell);
      }
    }
  }

  function onEditCell(e) {
    var hand = e.currentTarget.dataset.hand;
    var ov = state.overrides[overrideKey()] || (state.overrides[overrideKey()] = {});
    if (state.brush === 'F' || state.brushWeight === 0) ov[hand] = {};
    else { ov[hand] = {}; ov[hand][state.brush] = state.brushWeight; }
    saveOverrides();
    renderChart();
  }

  function renderList(map, spot) {
    var wrap = document.getElementById('listWrap');
    wrap.innerHTML = '';
    actionsInSpot(spot).forEach(function (act) {
      var hands = H.allHands().filter(function (h) { return map[h] && map[h][act]; });
      if (!hands.length) return;
      var combos = hands.reduce(function (s, h) { return s + H.comboCount(h) * map[h][act]; }, 0);
      var group = el('div', 'list-group');
      group.appendChild(el('h3', '',
        '<span class="dot" style="background:' + ACT[act].color + '"></span>' +
        ACT[act].label + ' <span class="sub">' + combos.toFixed(0) + ' combos · ' + (combos / 1326 * 100).toFixed(1) + '%</span>'));
      ['pair', 'suited', 'offsuit'].forEach(function (type) {
        var sub = hands.filter(function (h) { return H.handType(h) === type; });
        if (!sub.length) return;
        var row = el('div', 'chip-row');
        row.appendChild(el('span', 'sub', { pair: '對子', suited: '同花', offsuit: '非同花' }[type] + '：'));
        sub.forEach(function (h) {
          var w = map[h][act];
          row.appendChild(el('span', 'chip', h + (w < 0.999 ? ' <span class="wt">' + Math.round(w * 100) + '%</span>' : '')));
        });
        group.appendChild(row);
      });
      wrap.appendChild(group);
    });
  }

  function renderLegend(spot) {
    var box = document.getElementById('legend');
    box.innerHTML = '';
    actionsInSpot(spot).concat(['F']).forEach(function (act) {
      box.appendChild(el('div', 'item', '<span class="swatch" style="background:' + ACT[act].color + '"></span>' + ACT[act].label));
    });
  }

  function renderCoverage(map, spot) {
    var box = document.getElementById('coverage');
    box.innerHTML = '';
    var c = combosByAction(map);
    var bar = el('div', 'cov-bar'), rows = el('div', 'cov-rows');
    actionsInSpot(spot).concat(['F']).forEach(function (act) {
      var pct = c[act] / 1326 * 100;
      if (pct > 0) { var seg = el('span'); seg.style.background = ACT[act].color; seg.style.width = pct + '%'; bar.appendChild(seg); }
      rows.appendChild(el('div', 'cr', '<span class="dot" style="background:' + ACT[act].color + '"></span>' +
        ACT[act].label + ' ' + pct.toFixed(1) + '% (' + c[act].toFixed(0) + ')'));
    });
    box.appendChild(bar); box.appendChild(rows);
  }

  // ---------- 編輯模式 ----------
  function renderBrushes(spot) {
    var box = document.getElementById('brushList');
    box.innerHTML = '';
    var acts = actionsInSpot(spot).concat(['F']);
    if (acts.indexOf(state.brush) === -1) state.brush = acts[0];
    acts.forEach(function (act) {
      var b = el('button', act === state.brush ? 'active' : '', ACT[act].label);
      b.style.background = ACT[act].color;
      b.onclick = function () { state.brush = act; renderBrushes(spot); };
      box.appendChild(b);
    });
    var wbox = document.getElementById('brushWeights');
    wbox.innerHTML = '';
    [1, 0.75, 0.5, 0.25].forEach(function (w) {
      var b = el('button', w === state.brushWeight ? 'active' : '', Math.round(w * 100) + '%');
      b.style.background = 'var(--panel-2)';
      b.onclick = function () { state.brushWeight = w; renderBrushes(spot); };
      wbox.appendChild(b);
    });
  }

  function exportRange() {
    var map = buildMap(rawSpot()), out = {};
    actionsInSpot(rawSpot()).forEach(function (act) {
      var hs = H.allHands().filter(function (h) { return map[h] && map[h][act]; })
        .map(function (h) { return map[h][act] < 0.999 ? h + ':' + map[h][act] : h; });
      if (hs.length) out[act] = hs.join(', ');
    });
    var text = JSON.stringify(out, null, 2);
    if (navigator.clipboard) navigator.clipboard.writeText(text);
    alert('已複製到剪貼簿（也印在主控台）：\n\n' + text);
    console.log('=== ' + overrideKey() + ' ===\n' + text);
  }

  function resetSpot() {
    delete state.overrides[overrideKey()];
    saveOverrides();
    renderChart(); renderKeys();
  }

  // ============================================================
  // 隨機練習模式
  // ============================================================
  function renderKeyCheck() {
    var box = document.getElementById('posCheck');
    box.innerHTML = '';
    currentKeys().forEach(function (key) {
      var lab = el('label', '', '<input type="checkbox" value="' + key + '" ' +
        (trainer.keys.indexOf(key) !== -1 ? 'checked' : '') + '/> ' + key);
      lab.querySelector('input').onchange = function (e) {
        var v = e.target.value;
        if (e.target.checked) { if (trainer.keys.indexOf(v) === -1) trainer.keys.push(v); }
        else trainer.keys = trainer.keys.filter(function (k) { return k !== v; });
      };
      box.appendChild(lab);
    });
  }

  function startTrainer() {
    stopTimer();
    if (!trainer.keys.length) trainer.keys = currentKeys().slice();
    trainer.total = trainer.correct = trainer.streak = trainer.best = 0;
    trainer.answered = false; trainer.reviewMode = false;
    document.getElementById('quizTimer').classList.add('hidden');
    renderStats(); nextQuestion();
  }

  // ---------- 限時挑戰 ----------
  function stopTimer() {
    if (trainer.timerId) { clearInterval(trainer.timerId); trainer.timerId = null; }
    trainer.timed = false;
  }
  function startTimed() {
    stopTimer();
    if (!trainer.keys.length) trainer.keys = currentKeys().slice();
    trainer.total = trainer.correct = trainer.streak = trainer.best = 0;
    trainer.reviewMode = false; trainer.timed = true; trainer.timeLeft = 60;
    renderTimer();
    trainer.timerId = setInterval(function () {
      trainer.timeLeft--;
      renderTimer();
      if (trainer.timeLeft <= 0) endTimed();
    }, 1000);
    renderStats(); nextQuestion();
  }
  function renderTimer() {
    var t = document.getElementById('quizTimer');
    t.classList.remove('hidden');
    t.classList.toggle('low', trainer.timeLeft <= 10);
    t.textContent = '⏱ ' + Math.max(0, trainer.timeLeft) + ' 秒';
  }
  function endTimed() {
    stopTimer();
    document.getElementById('quizActions').innerHTML = '';
    document.getElementById('quizCards').innerHTML = '';
    document.getElementById('quizMini').innerHTML = '';
    document.getElementById('nextQuiz').classList.add('hidden');
    var fb = document.getElementById('quizFeedback');
    fb.className = 'quiz-feedback correct';
    fb.textContent = '';
    document.getElementById('quizContext').innerHTML =
      '⏱ 時間到！答對 <b style="color:var(--accent);font-size:22px">' + trainer.correct + '</b> 題（共 ' +
      trainer.total + ' 題，正確率 ' + (trainer.total ? Math.round(trainer.correct / trainer.total * 100) : 0) + '%）';
  }

  function mistakePool() {
    return trainer.mistakes.filter(function (m) { return m.format === state.format && m.scenario === state.scenario; });
  }
  function saveMistakes() { try { localStorage.setItem('gto_mistakes', JSON.stringify(trainer.mistakes)); } catch (e) {} }
  function addMistake(e) {
    if (!trainer.mistakes.some(function (m) { return m.format === e.format && m.scenario === e.scenario && m.key === e.key && m.hand === e.hand; }))
      trainer.mistakes.push(e);
    saveMistakes(); updateReviewBtn();
  }
  function removeMistake(e) {
    trainer.mistakes = trainer.mistakes.filter(function (m) { return !(m.format === e.format && m.scenario === e.scenario && m.key === e.key && m.hand === e.hand); });
    saveMistakes(); updateReviewBtn();
  }
  function updateReviewBtn() {
    document.getElementById('reviewMistakes').textContent = '複習錯題 (' + mistakePool().length + ')';
  }
  function startReview() {
    if (!mistakePool().length) { alert('目前這個情境沒有錯題可複習。先在「開始」練習中答錯幾題，錯題會自動收進來。'); return; }
    trainer.reviewMode = true;
    trainer.total = trainer.correct = trainer.streak = trainer.best = 0;
    renderStats(); nextQuestion();
  }

  function weightedHand() {
    var hands = H.allHands(), total = H.combosOf(hands), r = Math.random() * total, acc = 0;
    for (var i = 0; i < hands.length; i++) { acc += H.comboCount(hands[i]); if (r <= acc) return hands[i]; }
    return hands[hands.length - 1];
  }

  function nextQuestion() {
    if (trainer.timed && trainer.timeLeft <= 0) return;
    var key, hand;
    if (trainer.reviewMode) {
      var pool = mistakePool();
      if (!pool.length) { trainer.reviewMode = false; document.getElementById('quizContext').textContent = '錯題都複習完了！按「開始」繼續一般練習。'; document.getElementById('quizActions').innerHTML = ''; document.getElementById('quizCards').innerHTML = ''; document.getElementById('nextQuiz').classList.add('hidden'); return; }
      var m = pool[Math.floor(Math.random() * pool.length)];
      key = m.key; hand = m.hand;
    } else {
      key = trainer.keys[Math.floor(Math.random() * trainer.keys.length)];
      hand = weightedHand();
    }
    var spot = spotOf(key), map = buildMapFrom(spot, null);
    trainer.current = { key: key, spot: spot, map: map, hand: hand, correct: topAction(map[hand] || {}) };
    trainer.answered = false;
    renderQuestion();
  }

  function renderQuestion() {
    var q = trainer.current;
    document.getElementById('quizContext').textContent = state.scenario === 'rfi'
      ? '你在 ' + q.key + '（' + state.format + '），前面都蓋牌。手牌如下，你要怎麼做？'
      : q.key + '（' + state.format + '）。' + scen().desc;
    renderCards(q.hand);
    var fb = document.getElementById('quizFeedback');
    fb.textContent = ''; fb.className = 'quiz-feedback';
    document.getElementById('quizMini').innerHTML = '';
    document.getElementById('nextQuiz').classList.add('hidden');
    var box = document.getElementById('quizActions');
    box.innerHTML = '';
    scen().buttons.forEach(function (btn, i) {
      var b = el('button', '', btn.label + '<span class="k">[' + (i + 1) + ']</span>');
      b.style.borderColor = btn.color; b.dataset.id = btn.id;
      b.onclick = function () { answer(btn); };
      box.appendChild(b);
    });
  }

  var SUIT = { s: '♠', h: '♥', d: '♦', c: '♣' };
  function renderCards(hand) {
    var box = document.getElementById('quizCards');
    box.innerHTML = '';
    var type = H.handType(hand), pairs;
    if (type === 'pair') pairs = [['s', hand[0]], ['h', hand[1]]];
    else if (type === 'suited') pairs = [['s', hand[0]], ['s', hand[1]]];
    else pairs = [['s', hand[0]], ['h', hand[1]]];
    pairs.forEach(function (p) {
      var suit = p[0], rank = p[1] === 'T' ? '10' : p[1], red = (suit === 'h' || suit === 'd');
      box.appendChild(el('div', 'pcard' + (red ? ' red' : ''), rank + '<span class="suit">' + SUIT[suit] + '</span>'));
    });
  }

  function answer(btn) {
    if (trainer.answered) return;
    trainer.answered = true;
    var q = trainer.current, ok = btn.matches.indexOf(q.correct) !== -1;
    trainer.total++;
    var mEntry = { format: state.format, scenario: state.scenario, key: q.key, hand: q.hand, correct: q.correct };
    if (ok) { trainer.correct++; trainer.streak++; trainer.best = Math.max(trainer.best, trainer.streak); if (trainer.reviewMode) removeMistake(mEntry); }
    else { trainer.streak = 0; addMistake(mEntry); }
    Array.prototype.forEach.call(document.querySelectorAll('#quizActions button'), function (b) {
      b.disabled = true;
      var bd = scen().buttons.filter(function (x) { return x.id === b.dataset.id; })[0];
      if (bd && bd.matches.indexOf(q.correct) !== -1) b.style.background = bd.color;
    });
    var fb = document.getElementById('quizFeedback');
    fb.className = 'quiz-feedback ' + (ok ? 'correct' : 'wrong');
    fb.textContent = ok
      ? '✓ 正確！' + q.hand + ' 應該「' + ACT[q.correct].label + '」'
      : '✗ 應該「' + ACT[q.correct].label + '」（' + q.hand + '），你選了「' + btn.label + '」';
    renderMini(q);
    renderStats();
    if (trainer.timed) {
      if (trainer.timeLeft > 0) setTimeout(function () { if (trainer.timed && trainer.timeLeft > 0) nextQuestion(); }, 750);
    } else {
      document.getElementById('nextQuiz').classList.remove('hidden');
    }
  }

  function renderMini(q) {
    var box = document.getElementById('quizMini');
    box.innerHTML = '';
    for (var r = 0; r < 13; r++) {
      for (var c = 0; c < 13; c++) {
        var hand = H.handAt(r, c), act = topAction(q.map[hand] || {});
        var m = el('div', 'm' + (hand === q.hand ? ' hl' : ''));
        m.style.background = ACT[act].color;
        box.appendChild(m);
      }
    }
  }

  function renderStats() {
    var acc = trainer.total ? Math.round(trainer.correct / trainer.total * 100) : 0;
    document.getElementById('trainerStats').innerHTML =
      (trainer.reviewMode ? '<div class="row"><span class="acc">複習錯題模式</span></div>' : '') +
      '<div class="row"><span>答題數</span><b>' + trainer.total + '</b></div>' +
      '<div class="row"><span>正確率</span><b class="acc">' + acc + '%</b></div>' +
      '<div class="row"><span>目前連對</span><b>' + trainer.streak + '</b></div>' +
      '<div class="row"><span>最佳連對</span><b>' + trainer.best + '</b></div>' +
      '<div class="row"><span>累積錯題</span><b>' + mistakePool().length + '</b></div>';
  }

  // ============================================================
  // Equity 計算器
  // ============================================================
  function eqMeta(id, metaId) {
    var hands = H.expandRange(document.getElementById(id).value);
    var box = document.getElementById(metaId);
    if (!hands.length) { box.textContent = '（尚未輸入有效範圍）'; return 0; }
    box.textContent = H.combosOf(hands) + ' combos · ' + H.percentOf(hands).toFixed(1) + '% · ' + hands.length + ' 種手牌';
    return hands.length;
  }

  var eqMode = 'bar';
  var SUITSYM = { s: '♠', h: '♥', d: '♦', c: '♣' };

  function renderBoardCards() {
    var str = document.getElementById('eqBoard').value;
    var box = document.getElementById('eqBoardShow');
    box.innerHTML = '';
    var toks = (str.replace(/[^AKQJT2-9shdc]/gi, '').match(/([AKQJT2-9])([shdc])/gi) || []).slice(0, 5);
    toks.forEach(function (t) {
      var rank = t[0].toUpperCase(), suit = t[1].toLowerCase();
      var red = (suit === 'h' || suit === 'd');
      box.appendChild(el('div', 'bcard' + (red ? ' red' : ''),
        (rank === 'T' ? '10' : rank) + '<span style="font-size:11px">' + SUITSYM[suit] + '</span>'));
    });
  }

  function heatColor(e) {
    var lo, hi; e = Math.max(0, Math.min(100, e));
    if (e <= 50) { lo = [0, 226, 80, 77]; hi = [50, 242, 193, 78]; }
    else { lo = [50, 242, 193, 78]; hi = [100, 63, 174, 90]; }
    var t = (e - lo[0]) / (hi[0] - lo[0]);
    return 'rgb(' + [1, 2, 3].map(function (i) { return Math.round(lo[i] + (hi[i] - lo[i]) * t); }).join(',') + ')';
  }

  function bindEquity() {
    var a = document.getElementById('eqA'), b = document.getElementById('eqB');
    a.oninput = function () { eqMeta('eqA', 'eqAMeta'); };
    b.oninput = function () { eqMeta('eqB', 'eqBMeta'); };
    document.getElementById('eqBoard').oninput = renderBoardCards;
    eqMeta('eqA', 'eqAMeta'); eqMeta('eqB', 'eqBMeta');
    document.querySelectorAll('#eqMode button').forEach(function (btn) {
      btn.onclick = function () { setSeg('#eqMode', btn); eqMode = btn.dataset.eqmode; runEquity(); };
    });
    document.getElementById('eqRun').onclick = runEquity;
    document.querySelectorAll('#toolView [data-ex]').forEach(function (btn) {
      btn.onclick = function () {
        var parts = btn.dataset.ex.split('|');
        a.value = parts[0]; b.value = parts[1];
        eqMeta('eqA', 'eqAMeta'); eqMeta('eqB', 'eqBMeta'); runEquity();
      };
    });
    document.querySelectorAll('#toolView [data-load]').forEach(function (btn) {
      btn.onclick = function () {
        var map = buildMap(rawSpot());
        var hands = H.allHands().filter(function (h) { return map[h] && distSum(map[h]) > 0; });
        document.getElementById(btn.dataset.load === 'A' ? 'eqA' : 'eqB').value = hands.join(', ');
        eqMeta('eqA', 'eqAMeta'); eqMeta('eqB', 'eqBMeta');
      };
    });
  }

  function runEquity() {
    var Eval = window.Eval;
    var handsA = H.expandRange(document.getElementById('eqA').value);
    var handsB = H.expandRange(document.getElementById('eqB').value);
    var box = document.getElementById('eqResult');
    if (!handsA.length || !handsB.length) { box.innerHTML = '<p class="eq-note">請兩邊都輸入有效範圍。</p>'; return; }
    var board = Eval.parseBoard(document.getElementById('eqBoard').value);
    renderBoardCards();
    var iters = parseInt(document.getElementById('eqIters').value, 10);
    var boardTxt = board.length ? '（公牌 ' + board.length + ' 張）' : '（翻前全下）';
    box.innerHTML = '<p class="eq-note">計算中…</p>';
    setTimeout(function () {
      if (eqMode === 'heat') return runHeatmap(handsA, handsB, iters, board, boardTxt, box);
      var r = Eval.equity(handsA, handsB, iters, board);
      var aw = r.a + r.tie / 2, bw = r.b + r.tie / 2;
      box.innerHTML =
        '<div class="eq-bar">' +
        '<span class="a" style="width:' + r.a + '%">' + (r.a > 8 ? r.a.toFixed(1) + '%' : '') + '</span>' +
        (r.tie > 1.5 ? '<span class="tie" style="width:' + r.tie + '%">' + r.tie.toFixed(1) + '%</span>' : '') +
        '<span class="b" style="width:' + r.b + '%">' + (r.b > 8 ? r.b.toFixed(1) + '%' : '') + '</span></div>' +
        '<div class="eq-legend"><span style="color:var(--raise)">■ A 勝 ' + r.a.toFixed(1) + '%</span>' +
        '<span>和局 ' + r.tie.toFixed(1) + '%</span>' +
        '<span style="color:var(--bluff)">B 勝 ' + r.b.toFixed(1) + '% ■</span></div>' +
        '<p class="eq-note">含和局平分後：A ' + aw.toFixed(1) + '% / B ' + bw.toFixed(1) +
        '%　（' + r.n.toLocaleString() + ' 次模擬' + boardTxt + '）</p>';
    }, 20);
  }

  // 逐手熱圖：範圍 A 每一手 vs 範圍 B 的 equity，用漸層色畫在網格。
  function runHeatmap(handsA, handsB, iters, board, boardTxt, box) {
    var Eval = window.Eval;
    var setA = {}; handsA.forEach(function (h) { setA[h] = true; });
    var per = Math.max(400, Math.min(2500, Math.round(iters / Math.max(handsA.length, 1))));
    var grid = el('div', 'heat-grid'), sumEq = 0, cnt = 0;
    for (var r = 0; r < 13; r++) {
      for (var c = 0; c < 13; c++) {
        var hand = H.handAt(r, c);
        var cell = el('div', 'hc');
        if (setA[hand]) {
          var e = Eval.handEquity(hand, handsB, per, board);
          if (e == null) { cell.className = 'hc off'; cell.innerHTML = hand; }
          else {
            cell.style.background = heatColor(e);
            cell.innerHTML = hand + '<span class="hl">' + e.toFixed(0) + '</span>';
            sumEq += e * H.comboCount(hand); cnt += H.comboCount(hand);
          }
        } else { cell.className = 'hc off'; cell.innerHTML = hand; }
        grid.appendChild(cell);
      }
    }
    box.innerHTML = '';
    var avg = cnt ? (sumEq / cnt) : 0;
    box.appendChild(el('p', 'eq-note', '範圍 A 對 範圍 B 的加權平均 equity：<b style="color:var(--accent)">' +
      avg.toFixed(1) + '%</b>　（每手約 ' + per + ' 次模擬' + boardTxt + '）'));
    box.appendChild(grid);
    box.appendChild(el('div', 'heat-legend', '<span>0%</span><span class="grad"></span><span>100%</span>　格內數字＝該手勝率'));
  }

  // ============================================================
  // 翻後決策（啟發式）
  // ============================================================
  var pf = { role: 'PFR', pos: 'IP', players: 2 };

  function pfCard(cardInt) {
    var r = cardInt % 13, s = (cardInt / 13) | 0;
    var sym = ['♠', '♥', '♦', '♣'][s], red = (s === 1 || s === 2);
    var name = window.Postflop.RNAME[r]; if (name === 'T') name = '10';
    return el('div', 'pc2' + (red ? ' red' : ''), name + '<span class="s">' + sym + '</span>');
  }

  function analyzePostflop(reveal) {
    var Eval = window.Eval, PF = window.Postflop;
    var hand = Eval.parseBoard(document.getElementById('pfHand').value);
    var board = Eval.parseBoard(document.getElementById('pfBoard').value);
    var box = document.getElementById('pfResult');
    var all = hand.concat(board), dup = all.some(function (c, i) { return all.indexOf(c) !== i; });
    if (hand.length !== 2) { box.innerHTML = '<p class="hint">請輸入正好 2 張手牌（如 AhKs）。</p>'; return; }
    if (board.length < 3 || board.length > 5) { box.innerHTML = '<p class="hint">公牌請輸入 3~5 張（翻牌 3、轉牌 4、河牌 5）。</p>'; return; }
    if (dup) { box.innerHTML = '<p class="hint">手牌與公牌有重複的牌，請檢查。</p>'; return; }

    var bt = PF.classifyBoard(board), h = PF.classifyHand(hand, board);
    var rec = PF.recommend(h, bt, pf);
    var villain = H.expandRange(document.getElementById('pfVillain').value);
    var eq = villain.length ? Eval.equityVsRange(hand, villain, 4000, board).eq : null;

    var roleTxt = pf.role === 'PFR' ? '翻前加注者' : '跟注者';
    var posTxt = pf.pos === 'IP' ? '有利位置' : '不利位置';
    var street = { 3: '翻牌', 4: '轉牌', 5: '河牌' }[board.length];

    var html = '<div class="pf-cards">' +
      '<div class="grp"><div class="cap">你的手牌</div><div class="row">' + hand.map(pfCard).map(function (e) { return e.outerHTML; }).join('') + '</div></div>' +
      '<div class="grp"><div class="cap">' + street + '公牌</div><div class="row">' + board.map(pfCard).map(function (e) { return e.outerHTML; }).join('') + '</div></div>' +
      '</div>';
    html += '<div class="pf-tags">' + bt.tags.map(function (t) { return '<span class="tag">' + t + '</span>'; }).join('') + '</div>';
    html += '<div class="pf-row"><span class="lab">情境</span><span>' + roleTxt + '　·　' + posTxt + '　·　' + (pf.players >= 4 ? '4人+' : pf.players + '人') + '底池　·　' + street + '</span></div>';
    html += '<div class="pf-row"><span class="lab">你的牌力</span><span><b>' + h.made + '</b>' + (h.draws.length ? '　＋ ' + h.draws.join('、') : '') + '</span></div>';
    if (eq != null) {
      var them = 100 - eq;
      html += '<div class="pf-row"><span class="lab">對抗對手範圍</span><span><div class="pf-eqbar"><span class="me" style="width:' + eq + '%"></span><span class="them" style="width:' + them + '%"></span></div>你的 equity ≈ <b style="color:var(--limp)">' + eq.toFixed(1) + '%</b></span></div>';
    }

    if (reveal) {
      html += '<div class="pf-rec"><div class="verdict">' + rec.action + '</div>' +
        '<div class="meta">' + (rec.size ? '尺寸：' + rec.size + '　·　' : '') + '頻率：' + rec.freq + '</div>' +
        '<ul>' + rec.reasons.map(function (r) { return '<li>' + r + '</li>'; }).join('') + '</ul></div>';
    } else {
      html += '<button id="pfReveal" class="btn primary" style="margin-top:8px">先想想…然後顯示建議</button>';
    }
    html += '<div class="pf-disclaimer">⚠ 這是「啟發式基本原則」建議（依牌力/牌面/位置/人數的通則），不是精確 solver 解。真正的 GTO 頻率需靠翻後 solver 逐一求解。</div>';
    box.innerHTML = html;
    if (!reveal) document.getElementById('pfReveal').onclick = function () { analyzePostflop(true); };
  }

  function randomPostflop() {
    var deck = [], i;
    for (i = 0; i < 52; i++) deck.push(i);
    // Fisher-Yates（用 Math.random；此為瀏覽器端練習，非工作流腳本）
    for (i = deck.length - 1; i > 0; i--) { var j = (Math.random() * (i + 1)) | 0; var t = deck[i]; deck[i] = deck[j]; deck[j] = t; }
    var hand = [deck[0], deck[1]], board = [deck[2], deck[3], deck[4]];
    var fmt = function (c) { return window.Postflop.RNAME[c % 13] + 'shdc'[(c / 13) | 0]; };
    document.getElementById('pfHand').value = hand.map(fmt).join('');
    document.getElementById('pfBoard').value = board.map(fmt).join('');
    syncPicksFromText('pfHand', 'pfHandPick');
    syncPicksFromText('pfBoard', 'pfBoardPick');
    // 隨機情境設定
    var roles = ['PFR', 'caller'], poss = ['IP', 'OOP'], pls = [2, 2, 2, 3, 4];
    setPfSeg('pfRole', roles[(Math.random() * 2) | 0]);
    setPfSeg('pfPos', poss[(Math.random() * 2) | 0]);
    setPfSeg('pfPlayers', String(pls[(Math.random() * pls.length) | 0]));
    analyzePostflop(false); // 先不顯示建議 → 練習：自己先決定
  }

  function setPfSeg(id, val) {
    var key = id === 'pfRole' ? 'role' : id === 'pfPos' ? 'pos' : 'players';
    pf[key] = key === 'players' ? parseInt(val, 10) : val;
    document.querySelectorAll('#' + id + ' button').forEach(function (b) {
      b.classList.toggle('active', b.dataset.v === val);
    });
  }

  // 卡牌下拉選擇器（數字 + 花色分開選），與文字框雙向同步。
  function cardSelect() {
    var span = el('span', 'csel');
    var rk = document.createElement('select'); rk.className = 'rank';
    rk.appendChild(new Option('—', ''));
    ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'].forEach(function (r) { rk.appendChild(new Option(r, r)); });
    var su = document.createElement('select'); su.className = 'suit';
    su.appendChild(new Option('—', ''));
    [['s', '♠'], ['h', '♥'], ['d', '♦'], ['c', '♣']].forEach(function (p) { su.appendChild(new Option(p[1], p[0])); });
    span.appendChild(rk); span.appendChild(su);
    return span;
  }
  function buildCardPickers() {
    var hp = document.getElementById('pfHandPick'), bp = document.getElementById('pfBoardPick');
    hp.innerHTML = ''; bp.innerHTML = '';
    var i;
    for (i = 0; i < 2; i++) hp.appendChild(cardSelect());
    for (i = 0; i < 5; i++) bp.appendChild(cardSelect());
    hp.addEventListener('change', function () { syncTextFromPicks('pfHandPick', 'pfHand'); });
    bp.addEventListener('change', function () { syncTextFromPicks('pfBoardPick', 'pfBoard'); });
    document.getElementById('pfHand').addEventListener('input', function () { syncPicksFromText('pfHand', 'pfHandPick'); });
    document.getElementById('pfBoard').addEventListener('input', function () { syncPicksFromText('pfBoard', 'pfBoardPick'); });
  }
  function syncTextFromPicks(pickId, inputId) {
    var toks = [];
    document.querySelectorAll('#' + pickId + ' .csel').forEach(function (c) {
      var r = c.querySelector('.rank').value, s = c.querySelector('.suit').value;
      if (r && s) toks.push(r + s);
    });
    document.getElementById(inputId).value = toks.join('');
  }
  function syncPicksFromText(inputId, pickId) {
    var text = document.getElementById(inputId).value;
    var toks = text.replace(/[^AKQJT2-9shdc]/gi, '').match(/([AKQJT2-9])([shdc])/gi) || [];
    document.querySelectorAll('#' + pickId + ' .csel').forEach(function (c, i) {
      var r = c.querySelector('.rank'), s = c.querySelector('.suit');
      if (toks[i]) { r.value = toks[i][0].toUpperCase(); s.value = toks[i][1].toLowerCase(); }
      else { r.value = ''; s.value = ''; }
    });
  }

  function bindPostflop() {
    ['pfRole', 'pfPos', 'pfPlayers'].forEach(function (id) {
      document.querySelectorAll('#' + id + ' button').forEach(function (b) {
        b.onclick = function () { setPfSeg(id, b.dataset.v); };
      });
    });
    buildCardPickers();
    document.getElementById('pfAnalyze').onclick = function () { analyzePostflop(true); };
    document.getElementById('pfRandom').onclick = randomPostflop;
  }

  // ============================================================
  // 事件綁定
  // ============================================================
  function resetForScenarioOrFormat() {
    stopTimer(); document.getElementById('quizTimer').classList.add('hidden');
    state.spotKey = currentKeys()[0];
    trainer.keys = []; trainer.reviewMode = false;
    renderKeys(); renderChart(); renderKeyCheck(); updateReviewBtn(); renderStats();
    document.getElementById('quizContext').textContent = '按「開始」出題';
    document.getElementById('quizActions').innerHTML = '';
    document.getElementById('quizCards').innerHTML = '';
    document.getElementById('quizFeedback').textContent = '';
    document.getElementById('quizMini').innerHTML = '';
    document.getElementById('nextQuiz').classList.add('hidden');
  }

  function bind() {
    document.querySelectorAll('#formatToggle button').forEach(function (b) {
      b.onclick = function () { setSeg('#formatToggle', b); state.format = b.dataset.format; resetForScenarioOrFormat(); };
    });
    document.querySelectorAll('#scenarioTabs button').forEach(function (b) {
      b.onclick = function () { setSeg('#scenarioTabs', b); state.scenario = b.dataset.scenario; resetForScenarioOrFormat(); };
    });
    document.querySelectorAll('#modeToggle button').forEach(function (b) {
      b.onclick = function () {
        setSeg('#modeToggle', b); state.mode = b.dataset.mode;
        if (state.mode !== 'trainer') { stopTimer(); document.getElementById('quizTimer').classList.add('hidden'); }
        ['chart', 'trainer', 'tool', 'postflop'].forEach(function (m) {
          document.getElementById(m + 'View').classList.toggle('active', state.mode === m);
        });
      };
    });
    document.querySelectorAll('[data-chartmode]').forEach(function (b) {
      b.onclick = function () {
        setSeg('.view-toggle', b); state.chartMode = b.dataset.chartmode;
        document.getElementById('gridWrap').classList.toggle('hidden', state.chartMode !== 'grid');
        document.getElementById('legend').classList.toggle('hidden', state.chartMode !== 'grid');
        document.getElementById('listWrap').classList.toggle('hidden', state.chartMode !== 'list');
      };
    });
    document.getElementById('editToggle').onchange = function (e) {
      state.editing = e.target.checked;
      document.getElementById('editPanel').classList.toggle('hidden', !state.editing);
      renderChart();
    };
    document.getElementById('exportBtn').onclick = exportRange;
    document.getElementById('resetBtn').onclick = resetSpot;
    document.getElementById('startTrainer').onclick = startTrainer;
    document.getElementById('timedChallenge').onclick = startTimed;
    document.getElementById('reviewMistakes').onclick = startReview;
    document.getElementById('nextQuiz').onclick = nextQuestion;
    document.addEventListener('keydown', onTrainerKey);
    bindEquity();
    bindPostflop();
  }

  // 練習鍵盤快捷鍵：1/2/3 選動作、空白鍵/Enter 下一題。僅在練習分頁生效。
  function onTrainerKey(e) {
    if (state.mode !== 'trainer') return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test((e.target.tagName || ''))) return;
    if (e.key === ' ' || e.key === 'Enter') {
      var nx = document.getElementById('nextQuiz');
      if (!nx.classList.contains('hidden')) { e.preventDefault(); nextQuestion(); }
      return;
    }
    var n = parseInt(e.key, 10);
    if (n >= 1 && n <= 9 && !trainer.answered) {
      var btns = document.querySelectorAll('#quizActions button');
      if (btns[n - 1]) { e.preventDefault(); btns[n - 1].click(); }
    }
  }

  function setSeg(sel, active) {
    document.querySelectorAll(sel + ' button').forEach(function (b) { b.classList.remove('active'); });
    active.classList.add('active');
  }

  function init() {
    loadOverrides();
    try { var m = localStorage.getItem('gto_mistakes'); if (m) trainer.mistakes = JSON.parse(m); } catch (e) {}
    state.spotKey = currentKeys()[0];
    bind();
    renderKeys(); renderChart(); renderKeyCheck(); renderStats(); updateReviewBtn();
  }
  document.addEventListener('DOMContentLoaded', init);
})();
