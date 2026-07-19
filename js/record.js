/* 手牌記錄器：快速記錄實戰手牌 + 自動對照翻前 GTO 範圍 + 復盤列表
   紀錄存 localStorage（gto_handlog_v1），可匯出 CSV。 */
'use strict';
(() => {
  const LS_KEY = 'gto_handlog_v1';
  const $ = s => document.querySelector(s);
  const S = RANGE_DATA.SCENARIOS;

  const POS_LISTS = {
    '6max': ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'],
    '9max': ['UTG', 'UTG+1', 'UTG+2', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB'],
  };
  const SCEN_LABEL = { rfi: '開牌 RFI', vsrfi: '面對加注', vs3bet: '被 3-bet', other: '其他' };
  const ACTS = { rfi: ['R', 'L', 'F'], vsrfi: ['3B', 'C', 'F'], vs3bet: ['4B', 'C', 'F'], other: ['R', 'C', 'X', 'F', 'A'] };
  const ACT_LABEL = { R: '加注', L: '跛入', '3B': '3-bet', C: '跟注', '4B': '4-bet', X: '過牌', F: '蓋牌', A: '全下' };

  /* ---------------- 狀態 ---------------- */
  let log = load();
  let filter = 'all';
  const draft = { hand: null, exact: '', fmt: '6max', pos: 'BTN', scen: 'rfi', vs: '', act: null, result: 'none' };

  function load() {
    try { return JSON.parse(localStorage.getItem(LS_KEY)) || []; }
    catch { return []; }
  }
  function save() { localStorage.setItem(LS_KEY, JSON.stringify(log)); }

  /* ---------------- GTO 對照 ---------------- */
  const rangeCache = {};
  function inRange(rangeStr, hand) {
    if (!rangeStr) return false;
    if (!rangeCache[rangeStr]) rangeCache[rangeStr] = new Set(Hands.expandRange(rangeStr));
    return rangeCache[rangeStr].has(hand);
  }
  // 回傳 {advice: 動作代碼, spotKey} 或 null（無對應範圍表）
  function gtoAdvice(fmt, pos, scen, vs, hand) {
    if (!hand) return null;
    if (scen === 'rfi') {
      const spot = S.rfi.data[fmt][pos];
      if (!spot) return null;
      const advice = inRange(spot.R, hand) ? 'R' : (inRange(spot.L, hand) ? 'L' : 'F');
      return { advice, spotKey: `${fmt} ${pos} RFI` };
    }
    if (scen === 'vsrfi') {
      if (!vs) return null;
      const key = `${pos} vs ${vs}`;
      const spot = S.vsrfi.data[fmt][key];
      if (!spot) return null;
      const advice = (inRange(spot['3V'], hand) || inRange(spot['3B'], hand)) ? '3B'
        : (inRange(spot.C, hand) ? 'C' : 'F');
      return { advice, spotKey: `${fmt} ${key}` };
    }
    if (scen === 'vs3bet') {
      const key = `${pos} vs 3bet`;
      const spot = S.vs3bet.data[fmt][key];
      if (!spot) return null;
      const advice = (inRange(spot['4V'], hand) || inRange(spot['4B'], hand)) ? '4B'
        : (inRange(spot.C, hand) ? 'C' : 'F');
      return { advice, spotKey: `${fmt} ${key}` };
    }
    return null;
  }

  /* ---------------- 輸入卡渲染 ---------------- */
  function buildGrid() {
    const g = $('#handGrid');
    g.innerHTML = '';
    for (let r = 0; r < 13; r++) for (let c = 0; c < 13; c++) {
      const h = Hands.handAt(r, c);
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = h;
      b.dataset.h = h;
      b.classList.add(Hands.handType(h));
      b.addEventListener('click', () => {
        draft.hand = draft.hand === h ? null : h;
        renderDraft();
      });
      g.appendChild(b);
    }
  }

  function chipRow(el, items, selected, onPick, clsFn) {
    el.innerHTML = '';
    items.forEach(it => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = it.label;
      if (clsFn) b.className = clsFn(it);
      b.classList.toggle('sel', it.value === selected);
      b.addEventListener('click', () => onPick(it.value));
      el.appendChild(b);
    });
  }

  function validVsList() {
    if (draft.scen !== 'vsrfi') return [];
    return RANGE_DATA.keysOf('vsrfi', draft.fmt)
      .filter(k => k.startsWith(draft.pos + ' vs '))
      .map(k => k.split(' vs ')[1]);
  }

  function renderDraft() {
    // 手牌
    $('#handShow').textContent = draft.hand || '—';
    document.querySelectorAll('#handGrid button').forEach(b =>
      b.classList.toggle('sel', b.dataset.h === draft.hand));

    // 桌型
    document.querySelectorAll('#fmtSeg button').forEach(b =>
      b.classList.toggle('active', b.dataset.fmt === draft.fmt));

    // 位置
    chipRow($('#posRow'),
      POS_LISTS[draft.fmt].map(p => ({ value: p, label: p })),
      draft.pos,
      v => { draft.pos = v; draft.vs = ''; renderDraft(); });

    // 情境
    chipRow($('#scenRow'),
      Object.entries(SCEN_LABEL).map(([v, l]) => ({ value: v, label: l })),
      draft.scen,
      v => { draft.scen = v; draft.vs = ''; draft.act = null; renderDraft(); });

    // 加注者位置（僅 vsrfi）
    const vsList = validVsList();
    $('#vsWrap').classList.toggle('hidden', draft.scen !== 'vsrfi');
    if (draft.scen === 'vsrfi') {
      if (vsList.length) {
        chipRow($('#vsRow'), vsList.map(p => ({ value: p, label: p })), draft.vs,
          v => { draft.vs = v; renderDraft(); });
      } else {
        $('#vsRow').innerHTML = '<span class="sec-label">此位置沒有對應的面對加注範圍表</span>';
      }
    }

    // 動作
    chipRow($('#actRow'),
      ACTS[draft.scen].map(a => ({ value: a, label: ACT_LABEL[a] })),
      draft.act,
      v => { draft.act = v; renderDraft(); },
      it => `act-${it.value}`);

    // GTO 提示
    const g = gtoAdvice(draft.fmt, draft.pos, draft.scen, draft.vs, draft.hand);
    const hint = $('#gtoHint');
    if (g) {
      let txt = `📖 範圍表建議：${ACT_LABEL[g.advice]}`;
      hint.className = 'gto-hint';
      if (draft.act) {
        const ok = draft.act === g.advice;
        hint.classList.add(ok ? 'ok' : 'bad');
        txt += ok ? ' — 一致 ✓' : ` — 你選了${ACT_LABEL[draft.act]} ✗`;
      }
      hint.textContent = txt;
    } else {
      hint.className = 'gto-hint hidden';
    }

    // 結果
    document.querySelectorAll('#resultSeg button').forEach(b =>
      b.classList.toggle('active', b.dataset.r === draft.result));

    $('#saveBtn').disabled = !(draft.hand && draft.pos && draft.act);
  }

  /* ---------------- 儲存 ---------------- */
  function saveHand() {
    const bbRaw = Math.abs(Number($('#bbIn').value) || 0);
    const bb = draft.result === 'lose' ? -bbRaw : (draft.result === 'win' ? bbRaw : Number($('#bbIn').value) || 0);
    const g = gtoAdvice(draft.fmt, draft.pos, draft.scen, draft.vs, draft.hand);
    log.unshift({
      id: Date.now() + '' + Math.floor(Math.random() * 1e4),
      ts: Date.now(),
      hand: draft.hand, exact: $('#exactIn').value.trim(),
      fmt: draft.fmt, pos: draft.pos, scen: draft.scen, vs: draft.vs,
      act: draft.act, result: draft.result, bb,
      board: $('#boardIn').value.trim(), note: $('#noteIn').value.trim(),
      gto: g ? { advice: g.advice, match: draft.act === g.advice } : null,
    });
    save();
    // 保留 桌型/位置/情境，清掉本手專屬欄位，方便連續輸入
    draft.hand = null; draft.act = null; draft.result = 'none'; draft.vs = draft.vs;
    $('#exactIn').value = ''; $('#bbIn').value = ''; $('#boardIn').value = ''; $('#noteIn').value = '';
    renderDraft(); renderLog();
    const t = $('#toast');
    t.textContent = '✅ 已記錄';
    t.classList.remove('hidden');
    clearTimeout(t._h); t._h = setTimeout(() => t.classList.add('hidden'), 1500);
  }

  /* ---------------- 列表渲染 ---------------- */
  function filtered() {
    if (filter === 'today') {
      const d = new Date().toDateString();
      return log.filter(r => new Date(r.ts).toDateString() === d);
    }
    if (filter === 'gtoX') return log.filter(r => r.gto && !r.gto.match);
    return log;
  }

  function fmtTs(ts) {
    const d = new Date(ts);
    const p = n => String(n).padStart(2, '0');
    return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  function renderLog() {
    const rows = filtered();

    // 統計
    const net = rows.reduce((a, r) => a + (r.bb || 0), 0);
    const cmp = rows.filter(r => r.gto);
    const ok = cmp.filter(r => r.gto.match).length;
    const netCls = net > 0 ? 'pos' : (net < 0 ? 'neg' : '');
    $('#statsRow').innerHTML =
      `<div class="stat"><span>手數</span><b>${rows.length}</b></div>` +
      `<div class="stat"><span>淨籌碼 (BB)</span><b class="${netCls}">${net > 0 ? '+' : ''}${Math.round(net * 10) / 10}</b></div>` +
      (cmp.length ? `<div class="stat"><span>GTO 符合</span><b>${ok}/${cmp.length}（${Math.round(ok / cmp.length * 100)}%）</b></div>` : '');

    // 列表
    const list = $('#logList');
    if (!rows.length) {
      list.innerHTML = '<div class="log-empty">還沒有紀錄。上面選好手牌→位置→情境→動作，按「記錄這手」。</div>';
      return;
    }
    list.innerHTML = '';
    rows.forEach(r => {
      const row = document.createElement('div');
      row.className = 'log-row';
      const bbTxt = r.bb ? `${r.bb > 0 ? '+' : ''}${r.bb} BB` : '';
      const bbCls = r.bb > 0 ? 'pos' : (r.bb < 0 ? 'neg' : '');
      const gtoTag = r.gto
        ? `<span class="gto-tag ${r.gto.match ? 'ok' : 'bad'}">${r.gto.match ? 'GTO ✓' : `建議${ACT_LABEL[r.gto.advice]}`}</span>`
        : '';
      row.innerHTML =
        `<div class="log-main">
           <span class="log-hand">${r.hand}</span>
           <span class="log-pos">${r.pos}${r.vs ? ' vs ' + r.vs : ''}</span>
           <span class="log-act a-${r.act}">${ACT_LABEL[r.act]}</span>
           ${gtoTag}
           <span class="log-bb ${bbCls}">${bbTxt}</span>
         </div>
         <div class="log-detail">
           ${fmtTs(r.ts)} · ${r.fmt} · ${SCEN_LABEL[r.scen]}${r.exact ? ' · 牌面 ' + r.exact : ''}${r.board ? ' · 公牌 ' + r.board : ''}
           ${r.note ? '<br>📝 ' + escapeHtml(r.note) : ''}
           <br><button class="del-btn" data-id="${r.id}">🗑 刪除這筆</button>
         </div>`;
      row.addEventListener('click', e => {
        if (e.target.closest('.del-btn')) return;
        row.classList.toggle('open');
      });
      list.appendChild(row);
    });
    list.querySelectorAll('.del-btn').forEach(b => {
      b.addEventListener('click', () => {
        if (!confirm('刪除這筆紀錄？')) return;
        log = log.filter(r => r.id !== b.dataset.id);
        save(); renderLog();
      });
    });
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ---------------- 匯出 CSV ---------------- */
  function exportCsv() {
    if (!log.length) { alert('還沒有紀錄可匯出。'); return; }
    const esc = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const head = ['時間', '手牌', '精確牌面', '桌型', '位置', '情境', '加注者', '動作', '結果', 'BB', '公牌', '備註', 'GTO建議', '符合GTO'];
    const lines = [head.join(',')];
    log.forEach(r => {
      lines.push([
        new Date(r.ts).toLocaleString('zh-TW'), r.hand, r.exact, r.fmt, r.pos,
        SCEN_LABEL[r.scen], r.vs, ACT_LABEL[r.act],
        r.result === 'win' ? '贏' : (r.result === 'lose' ? '輸' : '沒攤牌'),
        r.bb, r.board, r.note,
        r.gto ? ACT_LABEL[r.gto.advice] : '', r.gto ? (r.gto.match ? 'Y' : 'N') : '',
      ].map(esc).join(','));
    });
    const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const d = new Date();
    a.download = `hands_${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  /* ---------------- 事件 ---------------- */
  document.querySelectorAll('#fmtSeg button').forEach(b => {
    b.addEventListener('click', () => {
      draft.fmt = b.dataset.fmt;
      if (!POS_LISTS[draft.fmt].includes(draft.pos)) draft.pos = 'BTN';
      draft.vs = '';
      renderDraft();
    });
  });
  document.querySelectorAll('#resultSeg button').forEach(b => {
    b.addEventListener('click', () => { draft.result = b.dataset.r; renderDraft(); });
  });
  document.querySelectorAll('#filterSeg button').forEach(b => {
    b.addEventListener('click', () => {
      filter = b.dataset.f;
      document.querySelectorAll('#filterSeg button').forEach(x => x.classList.toggle('active', x === b));
      renderLog();
    });
  });
  $('#saveBtn').addEventListener('click', saveHand);
  $('#exportCsvBtn').addEventListener('click', exportCsv);
  $('#clearBtn').addEventListener('click', () => {
    if (!log.length) return;
    if (!confirm(`清空全部 ${log.length} 筆紀錄？建議先匯出 CSV 備份。`)) return;
    log = []; save(); renderLog();
  });

  /* ---------------- 啟動 ---------------- */
  buildGrid();
  renderDraft();
  renderLog();
})();
