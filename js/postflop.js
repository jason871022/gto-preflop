/*
 * postflop.js — 啟發式翻後分析（非精確 GTO，是「基本原則」引擎）
 *
 * 三塊：
 *   1) classifyBoard  牌面材質（乾/濕、對子面、同花性、連張性）
 *   2) classifyHand   你的成手類別 + 聽牌（用 eval.js 評牌 + 額外偵測聽牌）
 *   3) recommend      依「角色/位置/玩家數/牌面/牌力」給下注 or 過牌建議 + 理由
 *
 * 牌的表示沿用 eval.js：card = suit*13 + rank，rank 0=2 … 12=A。
 */
(function (global) {
  'use strict';
  var RNAME = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
  var rk = function (c) { return c % 13; };
  var st = function (c) { return (c / 13) | 0; };

  // ---------- 1) 牌面材質 ----------
  function classifyBoard(board) {
    var ranks = board.map(rk), suits = board.map(st);
    var rc = {}, sc = {};
    ranks.forEach(function (r) { rc[r] = (rc[r] || 0) + 1; });
    suits.forEach(function (s) { sc[s] = (sc[s] || 0) + 1; });
    var maxSuit = Math.max.apply(null, Object.keys(sc).map(function (k) { return sc[k]; }));
    var paired = Object.keys(rc).some(function (r) { return rc[r] >= 2; });
    var uniq = Object.keys(rc).map(Number).sort(function (a, b) { return b - a; });
    var high = uniq[0];

    // 同花性
    var suitLabel = maxSuit >= (board.length >= 5 ? 5 : 3) ? '同花面' : maxSuit === 2 ? '兩張同花' : '雜色';
    var flushy = maxSuit >= 2;

    // 連張性：最高三張是否落在 5 的區間內
    var top3 = uniq.slice(0, 3);
    var span = top3.length >= 2 ? top3[0] - top3[top3.length - 1] : 99;
    // 含 A 當低張(輪子)
    var connected = span <= 4 && top3.length >= 3;
    var semiConn = span <= 4 && !connected;

    // 濕度分數
    var draws = 0;
    if (maxSuit >= 3) draws += 2; else if (maxSuit === 2) draws += 1;
    if (connected) draws += 2; else if (semiConn) draws += 1;
    var wet = draws >= 3 ? 'wet' : draws >= 1 ? 'semi' : 'dry';
    var wetLabel = wet === 'wet' ? '濕（協調）' : wet === 'semi' ? '半濕' : '乾（散）';

    var tags = [wetLabel];
    if (paired) tags.push('對子面');
    tags.push(suitLabel);
    if (connected) tags.push('連張'); else if (semiConn) tags.push('半連張');
    tags.push((high >= 10 ? '高張(' : '低張(') + RNAME[high] + ') 面');

    return { wet: wet, paired: paired, flushy: flushy, connected: connected || semiConn, high: high, tags: tags };
  }

  // ---------- 聽牌偵測 ----------
  function flushDraw(hole, board) {
    for (var s = 0; s < 4; s++) {
      var heroS = hole.filter(function (c) { return st(c) === s; }).length;
      var total = heroS + board.filter(function (c) { return st(c) === s; }).length;
      if (total === 4 && heroS >= 1) return { fd: true, strong: heroS === 2 };
    }
    return { fd: false };
  }

  // 回傳能「補成順子且用到手牌」的張數 rank 陣列（2=開放兩頭/雙卡，1=卡順）
  function straightOuts(hole, board) {
    var heroR = hole.map(rk), allR = hole.concat(board).map(rk);
    function set(extra) {
      var s = {}; allR.concat([extra]).forEach(function (r) { s[r] = 1; });
      if (s[12]) s[-1] = 1; // A 當低張
      return s;
    }
    var outs = [];
    for (var r = 0; r <= 12; r++) {
      if (allR.indexOf(r) !== -1) continue;
      var s = set(r);
      for (var hi = 12; hi >= 3; hi--) {
        var win = [hi, hi - 1, hi - 2, hi - 3, hi - 4];
        if (win.every(function (x) { return s[x]; })) {
          var heroIn = win.some(function (x) { return heroR.indexOf(x) !== -1 || (x === -1 && heroR.indexOf(12) !== -1); });
          if (heroIn) { outs.push(r); break; }
        }
      }
    }
    return outs;
  }

  // ---------- 2) 成手類別 ----------
  function classifyHand(hole, board) {
    var Eval = global.Eval;
    var cat = catOf(Eval.eval7(hole.concat(board)));
    var boardRanks = board.map(rk).sort(function (a, b) { return b - a; });
    var topBoard = boardRanks[0];
    var hr = hole.map(rk), pocket = hr[0] === hr[1];
    var made = '高牌', tier = 'air';

    if (cat >= 6) { made = { 6: '葫蘆', 7: '四條', 8: '同花順' }[cat] || '超強牌'; tier = 'value_strong'; }
    else if (cat === 5) { made = '同花'; tier = 'value_strong'; }
    else if (cat === 4) { made = '順子'; tier = 'value_strong'; }
    else if (cat === 3) { made = pocket && hr.indexOf(topBoard) === -1 ? '暗三條(set)' : '三條(trips)'; tier = 'value_strong'; }
    else if (cat === 2) { made = '兩對'; tier = 'value_strong'; }
    else if (cat === 1) {
      // 一對：判斷是頂對/超對/中對/底對/口袋對
      var info = pairKind(hr, pocket, boardRanks);
      made = info.label; tier = info.tier;
    }

    // 聽牌（河牌前才算）
    var draws = [], strongDraw = false, weakDraw = false;
    if (board.length < 5 && cat < 4) {
      var fd = flushDraw(hole, board);
      if (fd.fd) { draws.push(fd.strong ? '同花聽牌(9 outs)' : '同花聽牌'); strongDraw = true; }
      var so = straightOuts(hole, board);
      if (so.length >= 2) { draws.push('兩頭/雙卡順聽(~8 outs)'); strongDraw = true; }
      else if (so.length === 1) { draws.push('卡順聽牌(~4 outs)'); weakDraw = true; }
    }
    // 有強聽牌但成手很弱 → 升級到 draw_strong
    if (strongDraw && (tier === 'air' || tier === 'showdown')) tier = 'draw_strong';

    return { made: made, tier: tier, draws: draws, strongDraw: strongDraw, weakDraw: weakDraw };
  }

  function pairKind(hr, pocket, boardRanks) {
    var topBoard = boardRanks[0];
    if (pocket) {
      if (hr[0] > topBoard) return { label: '超對(overpair)', tier: 'value_strong' };
      if (hr[0] > boardRanks[1]) return { label: '中間口袋對', tier: 'value_medium' };
      return { label: '低口袋對', tier: 'showdown' };
    }
    // 用一張手牌配對檯面
    var pairedRank = hr.filter(function (r) { return boardRanks.indexOf(r) !== -1; })[0];
    var kicker = hr.filter(function (r) { return r !== pairedRank; })[0];
    if (pairedRank === topBoard) {
      var strongKicker = kicker >= 9; // J+ kicker
      return { label: '頂對' + (strongKicker ? '好踢腳(TPTK)' : '弱踢腳'), tier: strongKicker ? 'value_strong' : 'value_medium' };
    }
    if (pairedRank === boardRanks[1]) return { label: '中對', tier: 'value_medium' };
    return { label: '底對', tier: 'showdown' };
  }

  function catOf(score) { // 從 eval7 分數還原類別（每級 16 進位，最高位是類別）
    return Math.floor(score / Math.pow(16, 5));
  }

  // ---------- 3) 啟發式決策 ----------
  // opts: {role:'PFR'|'caller', pos:'IP'|'OOP', players:2|3|4}
  function recommend(hand, boardTex, opts) {
    var multiway = opts.players >= 3, wet = boardTex.wet !== 'dry';
    var t = hand.tier, reasons = [], action, size = null, freq;

    if (opts.role === 'PFR') {
      if (t === 'value_strong') {
        action = '下注'; size = wet ? '大注 (~66-100%)' : '中注 (~50%)'; freq = '高頻';
        reasons.push('強成手：為價值下注' + (wet ? '，牌面濕要下大注求值＋保護' : ''));
        if (multiway) { size = '大注 (~75%+)'; reasons.push('多人底池：更要為價值/保護下注，少慢打'); }
      } else if (t === 'value_medium') {
        if (multiway) { action = '過牌'; freq = '高頻'; reasons.push('多人底池中等牌力傾向控池，被打常常落後'); }
        else if (wet) { action = '過牌'; freq = '混合'; reasons.push('中等牌力在濕面控池，避免被加注膨脹底池'); }
        else { action = '下注'; size = '小注 (~33%)'; freq = '混合'; reasons.push('乾面可小注薄價值/保護，也保有過牌的頻率'); }
      } else if (t === 'draw_strong') {
        action = '下注'; size = wet ? '中注 (~50%)' : '小注 (~40%)'; freq = '高頻';
        reasons.push('強聽牌半詐唬：有權益又有棄牌率，主動施壓');
        if (multiway) { action = '混合（下注/過牌）'; reasons.push('多人時半詐唬收斂，靠權益也可過牌看牌'); }
      } else if (t === 'showdown') {
        action = '過牌'; freq = '高頻'; reasons.push('有攤牌價值：過牌控池，避免把弱成手變詐唬被反打');
      } else { // air
        if (multiway) { action = '過牌'; freq = '高頻'; reasons.push('多人底池不對空氣詐唬'); }
        else if (!wet) {
          action = '下注'; size = '小注 (~33%)'; freq = '高頻';
          reasons.push('乾面通常有範圍優勢，可小注持續下注(range c-bet)施壓');
          if (hand.weakDraw) reasons.push('還有卡順/後門當加碼權益');
        } else {
          action = hand.weakDraw ? '混合（低頻小注詐唬）' : '過牌'; freq = '高頻';
          reasons.push(hand.weakDraw ? '濕面有後門/卡順可低頻詐唬，其餘過牌' : '濕面空氣缺乏權益，過牌放棄');
        }
      }
      if (opts.pos === 'OOP' && action === '下注' && (t === 'air' || t === 'value_medium'))
        reasons.push('（不利位置更保守，頻率再降一些）');
      if (opts.pos === 'IP' && action === '過牌' && t === 'showdown')
        reasons.push('（有利位置可過牌看牌，保留攤牌）');
    } else { // caller（防守方，通常對加注者過牌，不主動 donk）
      if (t === 'value_strong') {
        action = '過牌→跟注 / 過牌加注'; freq = wet ? '傾向 check-raise' : '傾向埋伏跟注';
        reasons.push('強牌對加注者過牌：' + (wet ? '濕面多用 check-raise 保護' : '乾面可埋伏跟注誘敵'));
      } else if (t === 'value_medium' || t === 'showdown') {
        action = '過牌→跟注'; freq = '高頻'; reasons.push('中等/攤牌牌力：過牌跟注控制底池');
        if (multiway) reasons.push('多人時防守更緊，面對雙下注要放掉');
      } else if (t === 'draw_strong') {
        action = '過牌→跟注 / 半詐唬加注'; freq = '混合';
        reasons.push('強聽牌：有賠率可過牌跟注，好牌面/有利位置可 check-raise 半詐唬');
      } else {
        action = '過牌→棄牌'; freq = '高頻'; reasons.push('空氣：過牌，面對下注多半棄牌（留最好的後門當詐唬）');
      }
      if (multiway && t !== 'value_strong') reasons.push('多人底池整體更緊、詐唬更少');
    }
    return { action: action, size: size, freq: freq, reasons: reasons };
  }

  global.Postflop = { classifyBoard: classifyBoard, classifyHand: classifyHand, recommend: recommend, RNAME: RNAME };
})(typeof window !== 'undefined' ? window : globalThis);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = (typeof window !== 'undefined' ? window : globalThis).Postflop;
}
