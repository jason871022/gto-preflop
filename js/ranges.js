/*
 * ranges.js — 範圍資料（通用「情境 → 對戰組」結構）
 *
 * 資料來源：
 *  - 9-max RFI：PokerCoaching 100bb PDF（組合數已對齊，UTG=134…BTN=678）。
 *  - 面對加注 / 被 3-bet：以 PDF 各動作頻率與結構為基準的重建（形狀對齊 PDF，
 *    例如 SB 面對前位會跟注、面對後位轉為 3-bet/蓋牌；BB 跟注極寬）。可用編輯模式校正。
 *  - 6-max：標準 solver 基準範圍。
 *
 * 動作代碼：R 加注 · L 跛入 · 3V/3B 3-bet價值/詐唬 · 4V/4B 4-bet價值/詐唬 · C 跟注 · F 棄牌(預設)
 * ⚠ 同一情境內各動作範圍不可重疊（node 測試會檢查）。
 */
(function (global) {
  'use strict';

  var ACTIONS = {
    R:  { label: '加注',        color: '#e2504d' },
    L:  { label: '跛入',        color: '#7bb662' },
    '3V': { label: '3-bet 價值', color: '#e2504d' },
    '3B': { label: '3-bet 詐唬', color: '#4a7fd6' },
    '4V': { label: '4-bet 價值', color: '#e2504d' },
    '4B': { label: '4-bet 詐唬', color: '#4a7fd6' },
    C:  { label: '跟注',        color: '#3fae5a' },
    F:  { label: '棄牌',        color: '#333947' }
  };

  var POSITIONS = {
    '6max': ['UTG', 'HJ', 'CO', 'BTN', 'SB'],
    '9max': ['UTG', 'UTG+1', 'UTG+2', 'LJ', 'HJ', 'CO', 'BTN', 'SB']
  };

  // ================= 情境 1：RFI =================
  var RFI = {
    '6max': {
      'UTG': { R: '22+, A2s+, KTs+, QTs+, JTs, T9s, 98s, AJo+, KQo' },
      'HJ':  { R: '22+, A2s+, K9s+, Q9s+, J9s+, T9s, 98s, 87s, 76s, ATo+, KJo+, QJo' },
      'CO':  { R: '22+, A2s+, K7s+, Q8s+, J8s+, T8s+, 97s+, 87s, 76s, 65s, 54s, A9o+, KTo+, QTo+, JTo' },
      'BTN': { R: '22+, A2s+, K2s+, Q4s+, J7s+, T7s+, 97s+, 86s+, 75s+, 64s+, 54s, A2o+, K8o+, Q9o+, J9o+, T9o, 98o' },
      'SB':  { R: '22+, A2s+, K5s+, Q7s+, J8s+, T8s+, 97s+, 86s+, 76s, 65s, 54s, A7o+, A5o-A2o, KTo+, QTo+, JTo' }
    },
    '9max': {
      'UTG':   { R: '22+, ATs+, KTs+, QTs+, JTs, T9s, AKo' },
      'UTG+1': { R: '22+, A8s+, K9s+, Q9s+, J9s+, T9s, AJo+, KQo' },
      'UTG+2': { R: '22+, A7s+, K9s+, Q9s+, J9s+, T9s, 98s, ATo+, KQo' },
      'LJ':    { R: '22+, A2s+, K9s+, Q9s+, J9s+, T9s, 98s, ATo+, KJo+' },
      'HJ':    { R: '22+, A2s+, K7s+, Q9s+, J9s+, T8s+, 98s, 87s, ATo+, KTo+, QJo' },
      'CO':    { R: '22+, A2s+, K5s+, Q8s+, J8s+, T8s+, 97s+, 87s, 76s, 65s, A8o+, KTo+, QTo+, JTo' },
      'BTN':   { R: '22+, A2s+, K2s+, Q3s+, J6s+, T6s+, 96s+, 85s+, 75s+, 64s+, 53s+, 43s, A2o+, K5o+, Q8o+, J8o+, T8o+, 97o+, 87o' },
      'SB':    { R: '22+, A2s+, K5s+, Q7s+, J8s+, T8s+, 97s+, 86s+, 76s, 65s, 54s, A7o+, A5o-A2o, KTo+, QTo+, JTo',
                 _note: '簡化版：加注或蓋牌。PDF 原始 SB 採跛入策略，可後續補上。' }
    }
  };

  // ================= 情境 2：面對加注（vs RFI）=================
  var VSRFI = {
    '6max': {
      'HJ vs UTG':  { '3V': 'QQ+, AKs, AKo', '3B': 'A5s-A4s, KJs', C: 'JJ-88, AQs-ATs, KTs, KQs, QJs, JTs, T9s, AQo, KQo' },
      'CO vs UTG':  { '3V': 'QQ+, AKs, AKo', '3B': 'A5s, KJs', C: 'JJ-77, AQs-ATs, KTs, KQs, QJs, JTs, T9s, 98s, AQo, KQo' },
      'CO vs HJ':   { '3V': 'QQ+, AQs+, AKo', '3B': 'A5s-A4s, KJs, QJs, T9s', C: 'JJ-22, AJs-A9s, KTs, KQs, QTs, JTs, 98s, 87s, AQo, KQo' },
      'BTN vs UTG': { '3V': 'QQ+, AKs, AKo', '3B': 'A5s-A4s, KJs', C: 'JJ-22, AQs-A9s, KTs, KQs, QTs+, JTs, T9s, 98s, 87s, 76s, AQo, KQo' },
      'BTN vs HJ':  { '3V': 'QQ+, AQs+, AKo', '3B': 'A5s-A4s, KTs, QTs, J9s', C: 'JJ-22, AJs-A7s, KJs+, QJs, JTs, T9s, 98s, 87s, 76s, AQo, KQo' },
      'BTN vs CO':  { '3V': 'QQ+, AQs+, AKo', '3B': 'A5s-A2s, KTs, Q9s, J9s, T8s, 65s', C: 'JJ-22, AJs-A6s, K9s, KJs, KQs, QTs+, JTs, T9s, 98s, 87s, 76s, AQo, KQo' },
      'SB vs HJ':   { '3V': 'JJ+, AQs+, AKo', '3B': 'A5s-A2s, KTs, QTs, J9s', C: 'TT-66, AJs-ATs, KQs, KJs, QJs, JTs, T9s' },
      'SB vs CO':   { '3V': 'JJ+, AQs+, AKo, KQs', '3B': 'A5s-A3s, K9s, Q9s, J9s, T9s' },
      'SB vs BTN':  { '3V': 'TT+, AJs+, AQo+, KQs', '3B': 'A5s-A2s, K9s-K8s, Q9s, J9s, T8s, 97s, 86s, 76s, 65s' },
      'BB vs UTG':  { '3V': 'QQ+, AKs, AKo', '3B': 'A5s-A4s, KJs, QJs', C: 'JJ-22, AQs-A9s, KTs, KQs, QTs, JTs, T9s, 98s, 87s, 76s, AQo, KQo' },
      'BB vs HJ':   { '3V': 'JJ+, AQs+, AKo', '3B': 'A5s-A4s, KTs, QTs, J9s, T9s', C: 'TT-22, AJs-A7s, KJs, KQs, QJs, JTs, 98s, 87s, 76s, 65s, AJo-ATo, KQo' },
      'BB vs CO':   { '3V': 'JJ+, AQs+, AKo, KQs', '3B': 'A5s-A2s, K9s, Q9s, J9s, T9s, 65s', C: 'TT-22, AJs-A6s, KJs-KTs, QJs-QTs, JTs, T8s, 98s, 87s, 76s, 54s, ATo-AJo, KQo, KJo, QJo' },
      'BB vs BTN':  { '3V': 'TT+, AJs+, AQo+, KQs', '3B': 'A5s-A2s, K9s-K7s, Q9s, J9s, 86s, 75s, 64s', C: '99-22, ATs-A6s, KJs-KTs, QJs-QTs, JTs, T9s, 98s, 87s, 76s, 65s, 54s, ATo-AJo, KQo, KJo, QJo, JTo, T9o, 98o' },
      'BB vs SB':   { '3V': 'TT+, AJs+, AQo+, KJs+', '3B': 'A8s-A2s, K9s-K7s, Q9s, J9s, T8s, 97s, 86s, 75s, 64s, 53s', C: '99-22, ATs-A9s, KTs, QJs-QTs, JTs, T9s, 98s, 87s, 76s, 65s, 54s, A2o-AJo, K9o+, Q9o+, J9o+, T9o, 98o, 87o' }
    },
    '9max': {
      'LJ vs UTG':  { '3V': 'QQ+, AKs, AKo', '3B': 'A5s, KJs', C: 'JJ-99, AQs, AJs, KQs, QJs, JTs' },
      'HJ vs UTG':  { '3V': 'QQ+, AKs, AKo', '3B': 'A5s, KJs', C: 'JJ-88, AQs-ATs, KTs, KQs, QJs, JTs, T9s, AQo' },
      'HJ vs LJ':   { '3V': 'QQ+, AQs+, AKo', '3B': 'A5s-A4s, KJs, QJs', C: 'JJ-77, AJs-ATs, KTs, KQs, QTs, JTs, T9s, 98s, AQo, KQo' },
      'CO vs UTG':  { '3V': 'QQ+, AKs, AKo', '3B': 'A5s, KJs', C: 'JJ-77, AQs-ATs, KTs, KQs, QJs, JTs, T9s, 98s, AQo, KQo' },
      'CO vs LJ':   { '3V': 'QQ+, AQs+, AKo', '3B': 'A5s-A4s, KJs, QJs', C: 'JJ-55, AJs-ATs, KTs, KQs, QTs, JTs, T9s, 98s, AQo, KQo' },
      'CO vs HJ':   { '3V': 'QQ+, AQs+, AKo', '3B': 'A5s-A4s, KJs, QJs, T9s', C: 'JJ-22, AJs-A9s, KTs, KQs, QTs, JTs, 98s, 87s, AQo, KQo' },
      'BTN vs UTG': { '3V': 'QQ+, AKs, AKo', '3B': 'A5s-A4s, KJs', C: 'JJ-22, AQs-A9s, KTs, KQs, QTs+, JTs, T9s, 98s, 87s, 76s, AQo, KQo' },
      'BTN vs LJ':  { '3V': 'QQ+, AQs+, AKo', '3B': 'A5s-A4s, KTs, QTs, J9s', C: 'JJ-22, AJs-A8s, KJs+, QJs, JTs, T9s, 98s, 87s, 76s, AQo, KQo' },
      'BTN vs HJ':  { '3V': 'QQ+, AQs+, AKo', '3B': 'A5s-A4s, KTs, QTs, J9s', C: 'JJ-22, AJs-A7s, KJs+, QJs, JTs, T9s, 98s, 87s, 76s, AQo, KQo' },
      'BTN vs CO':  { '3V': 'QQ+, AQs+, AKo', '3B': 'A5s-A2s, KTs, Q9s, J9s, T8s, 65s', C: 'JJ-22, AJs-A6s, K9s, KJs, KQs, QTs+, JTs, T9s, 98s, 87s, 76s, AQo, KQo' },
      'SB vs UTG':  { '3V': 'QQ+, AKs', '3B': 'A5s-A3s', C: 'TT-22, AQs-ATs, KQs-KJs, QJs, JTs' },
      'SB vs LJ':   { '3V': 'JJ+, AKs, AKo', '3B': 'A5s-A2s, KTs, Q9s', C: 'TT-66, AQs-ATs, KQs, QJs, JTs, T9s' },
      'SB vs HJ':   { '3V': 'JJ+, AQs+, AKo', '3B': 'A5s-A2s, KTs, QTs, J9s', C: 'TT-66, AJs-ATs, KQs, KJs, QJs, JTs, T9s' },
      'SB vs CO':   { '3V': 'TT+, AJs+, AQo+, KQs', '3B': 'A9s-A2s, K9s, Q9s, J9s, T9s, 76s' },
      'SB vs BTN':  { '3V': 'TT+, AJs+, AQo+, KQs', '3B': 'A9s-A2s, K9s-K8s, Q9s, J9s, T8s, 97s, 86s, 76s, 65s' },
      'BB vs UTG':  { '3V': 'QQ+, AKs, AKo', '3B': 'A5s-A4s, KJs, QJs', C: 'JJ-22, AQs-A9s, KTs, KQs, QTs, JTs, T9s, 98s, 87s, 76s, AQo, KQo' },
      'BB vs LJ':   { '3V': 'JJ+, AQs+, AKo', '3B': 'A5s-A4s, KTs, QTs, J9s', C: 'TT-22, AJs-A6s, KJs, KQs, QJs, JTs, T9s, 98s, 87s, 76s, 65s, AJo-ATo, KQo' },
      'BB vs HJ':   { '3V': 'JJ+, AQs+, AKo', '3B': 'A5s-A4s, KTs, QTs, J9s, T9s', C: 'TT-22, AJs-A6s, KJs, KQs, QJs, JTs, 98s, 87s, 76s, 65s, 54s, AJo-ATo, KQo' },
      'BB vs CO':   { '3V': 'JJ+, AQs+, AKo, KQs', '3B': 'A5s-A2s, K9s, Q9s, J9s, T9s, 65s', C: 'TT-22, AJs-A6s, KJs-KTs, QJs-QTs, JTs, T8s, 98s, 87s, 76s, 54s, ATo-AJo, KQo, KJo, QJo' },
      'BB vs BTN':  { '3V': 'TT+, AJs+, AQo+, KQs', '3B': 'A5s-A2s, K9s-K7s, Q9s, J9s, 86s, 75s, 64s', C: '99-22, ATs-A6s, KJs-KTs, QJs-QTs, JTs, T9s, 98s, 87s, 76s, 65s, 54s, ATo-AJo, KQo, KJo, QJo, JTo, T9o' },
      'BB vs SB':   { '3V': 'TT+, AJs+, AQo+, KJs+', '3B': 'A8s-A2s, K9s-K7s, Q9s, J9s, T8s, 97s, 86s, 75s, 64s', C: '99-22, ATs-A9s, KTs, QJs-QTs, JTs, T9s, 98s, 87s, 76s, 65s, 54s, A2o-AJo, K9o+, Q9o+, J9o+, T9o, 98o' }
    }
  };

  // ================= 情境 3：被 3-bet（RFI vs 3bet）=================
  var VS3BET = {
    '6max': {
      'UTG vs 3bet': { '4V': 'QQ+, AKs, AKo', '4B': 'A5s-A4s, KQs', C: 'JJ-99, AQs, AJs' },
      'HJ vs 3bet':  { '4V': 'QQ+, AKs, AKo', '4B': 'A5s-A4s, KJs', C: 'JJ-88, AQs, AJs, KQs, QJs' },
      'CO vs 3bet':  { '4V': 'QQ+, AKs, AKo', '4B': 'A5s-A4s, A9s, KJs', C: 'JJ-77, AQs-ATs, KQs, QJs, JTs, T9s, AQo' },
      'BTN vs 3bet': { '4V': 'QQ+, AKs, AKo, AQs', '4B': 'A5s-A4s, A9s-A6s, K9s', C: 'JJ-55, AJs-ATs, KQs-KTs, QJs-QTs, JTs, T9s, 98s, AQo, KQo' },
      'SB vs 3bet':  { '4V': 'KK+, AKs', '4B': 'A5s-A4s, AQs, KQs', C: 'QQ-99, AJs, KJs, QJs, JTs' }
    },
    '9max': {
      'UTG vs 3bet':   { '4V': 'QQ+, AKs, AKo', '4B': 'A5s', C: 'JJ-99, AQs' },
      'UTG+1 vs 3bet': { '4V': 'QQ+, AKs, AKo', '4B': 'A5s, KQs', C: 'JJ-99, AQs, AJs, QJs' },
      'UTG+2 vs 3bet': { '4V': 'QQ+, AKs, AKo', '4B': 'A5s-A4s, KQs', C: 'JJ-88, AQs, AJs, QJs' },
      'LJ vs 3bet':    { '4V': 'QQ+, AKs, AKo', '4B': 'A5s-A4s, KQs', C: 'JJ-88, AQs, AJs, QJs' },
      'HJ vs 3bet':    { '4V': 'QQ+, AKs, AKo', '4B': 'A5s-A4s, A9s, KJs', C: 'JJ-77, AQs-ATs, KQs, QJs, JTs, AQo' },
      'CO vs 3bet':    { '4V': 'QQ+, AKs, AKo', '4B': 'A5s-A4s, A9s, KJs', C: 'JJ-77, AQs-ATs, KQs, QJs, JTs, AQo' },
      'BTN vs 3bet':   { '4V': 'QQ+, AKs, AKo, AQs', '4B': 'A5s-A4s, A9s-A6s, K9s', C: 'JJ-55, AJs-ATs, KQs-KTs, QJs-QTs, JTs, T9s, 98s, AQo, KQo' },
      'SB vs 3bet':    { '4V': 'KK+, AKs', '4B': 'A5s-A4s, AQs, KQs', C: 'QQ-99, AJs, KJs, QJs, JTs' }
    }
  };

  var SCENARIOS = {
    rfi: {
      name: 'RFI（第一個進池加注）',
      desc: '前面所有人都蓋牌，輪到你。要開牌加注還是蓋牌？',
      data: RFI,
      buttons: [
        { id: 'R', label: '加注', color: ACTIONS.R.color, matches: ['R'] },
        { id: 'F', label: '蓋牌', color: ACTIONS.F.color, matches: ['F'] }
      ]
    },
    vsrfi: {
      name: '面對加注（vs RFI）',
      desc: '有人在你前面加注了。你要 3-bet、跟注、還是蓋牌？',
      data: VSRFI,
      buttons: [
        { id: '3B', label: '3-bet', color: ACTIONS['3V'].color, matches: ['3V', '3B'] },
        { id: 'C', label: '跟注', color: ACTIONS.C.color, matches: ['C'] },
        { id: 'F', label: '蓋牌', color: ACTIONS.F.color, matches: ['F'] }
      ]
    },
    vs3bet: {
      name: '被 3-bet（RFI vs 3bet）',
      desc: '你先加注，後面有人 3-bet。你要 4-bet、跟注、還是蓋牌？',
      data: VS3BET,
      buttons: [
        { id: '4B', label: '4-bet', color: ACTIONS['4V'].color, matches: ['4V', '4B'] },
        { id: 'C', label: '跟注', color: ACTIONS.C.color, matches: ['C'] },
        { id: 'F', label: '蓋牌', color: ACTIONS.F.color, matches: ['F'] }
      ]
    }
  };

  function keysOf(scenario, format) {
    return Object.keys(SCENARIOS[scenario].data[format] || {});
  }

  global.RANGE_DATA = { ACTIONS: ACTIONS, POSITIONS: POSITIONS, SCENARIOS: SCENARIOS, keysOf: keysOf };
})(typeof window !== 'undefined' ? window : globalThis);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = (typeof window !== 'undefined' ? window : globalThis).RANGE_DATA;
}
