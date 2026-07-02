/*
 * eval.js — 撲克牌力評估 + 翻前 equity（勝率）計算
 *
 * 為什麼有這個檔案：wasm-postflop 之類的 solver 會顯示 equity。我們雖然不做翻後
 * CFR，但「範圍 vs 範圍的全下勝率」是可以精準算的（蒙地卡羅抽樣 + 7 張評牌）。
 * 這給工具一個真正「會算牌」的功能。
 *
 * 牌的表示：整數 0..51，rank = card % 13（0=2 … 12=A），suit = (card/13)|0。
 * eval7 回傳一個可比較的分數（越大越強），用來比兩手 7 張牌誰贏。
 */
(function (global) {
  'use strict';
  var H = global.Hands;
  var RANK_TO_VAL = { A: 12, K: 11, Q: 10, J: 9, T: 8, '9': 7, '8': 6, '7': 5, '6': 4, '5': 3, '4': 2, '3': 1, '2': 0 };

  // 手牌類別（由弱到強）用於分數的最高位
  // 8=同花順 7=四條 6=葫蘆 5=同花 4=順子 3=三條 2=兩對 1=一對 0=高牌

  // 評估 7 張牌（陣列，元素 0..51），回傳整數分數。
  function eval7(cards) {
    var rankCount = new Array(13).fill(0);
    var suitCount = new Array(4).fill(0);
    var bySuit = [[], [], [], []];
    for (var i = 0; i < cards.length; i++) {
      var r = cards[i] % 13, s = (cards[i] / 13) | 0;
      rankCount[r]++; suitCount[s]++; bySuit[s].push(r);
    }

    // 同花 / 同花順
    var flushSuit = -1;
    for (var s2 = 0; s2 < 4; s2++) if (suitCount[s2] >= 5) flushSuit = s2;
    if (flushSuit !== -1) {
      var sf = straightHigh(bySuit[flushSuit]);
      if (sf !== -1) return score(8, [sf]);
    }

    // 依數量分組
    var quads = [], trips = [], pairs = [], singles = [];
    for (var r2 = 12; r2 >= 0; r2--) {
      if (rankCount[r2] === 4) quads.push(r2);
      else if (rankCount[r2] === 3) trips.push(r2);
      else if (rankCount[r2] === 2) pairs.push(r2);
      else if (rankCount[r2] === 1) singles.push(r2);
    }

    if (quads.length) {
      var kick = highestExcept(rankCount, quads[0]);
      return score(7, [quads[0], kick]);
    }
    if (trips.length >= 1 && (pairs.length >= 1 || trips.length >= 2)) {
      var three = trips[0];
      var pairForFull = trips.length >= 2 ? trips[1] : pairs[0];
      return score(6, [three, pairForFull]);
    }
    if (flushSuit !== -1) {
      var fr = bySuit[flushSuit].slice().sort(function (a, b) { return b - a; }).slice(0, 5);
      return score(5, fr);
    }
    var st = straightHigh(allRanks(rankCount));
    if (st !== -1) return score(4, [st]);
    if (trips.length) {
      var ks = topN(rankCount, 2, [trips[0]]);
      return score(3, [trips[0]].concat(ks));
    }
    if (pairs.length >= 2) {
      var k2 = highestExcept(rankCount, pairs[0], pairs[1]);
      return score(2, [pairs[0], pairs[1], k2]);
    }
    if (pairs.length === 1) {
      var k3 = topN(rankCount, 3, [pairs[0]]);
      return score(1, [pairs[0]].concat(k3));
    }
    return score(0, topN(rankCount, 5, []));
  }

  // 找順子最高牌（含 A2345 = 5 高）。輸入為 rank 陣列（可重複），回傳最高牌 rank 或 -1。
  function straightHigh(ranks) {
    var has = new Array(13).fill(false);
    ranks.forEach(function (r) { has[r] = true; });
    // A(12) 可當低 A：A2345
    for (var hi = 12; hi >= 4; hi--) {
      var ok = true;
      for (var k = 0; k < 5; k++) { if (!has[hi - k]) { ok = false; break; } }
      if (ok) return hi;
    }
    // 輪子 5-4-3-2-A
    if (has[3] && has[2] && has[1] && has[0] && has[12]) return 3; // 5 高
    return -1;
  }

  function allRanks(rankCount) {
    var out = [];
    for (var r = 0; r < 13; r++) if (rankCount[r]) out.push(r);
    return out;
  }
  function highestExcept(rankCount) {
    var except = Array.prototype.slice.call(arguments, 1);
    for (var r = 12; r >= 0; r--) if (rankCount[r] && except.indexOf(r) === -1) return r;
    return 0;
  }
  function topN(rankCount, n, except) {
    var out = [];
    for (var r = 12; r >= 0 && out.length < n; r--) {
      if (rankCount[r] && except.indexOf(r) === -1) out.push(r);
    }
    return out;
  }
  // 把類別 + 各級 tiebreaker 打包成單一可比較整數（每級 4 bits，最高位是類別）。
  function score(cat, kickers) {
    var v = cat;
    for (var i = 0; i < 5; i++) v = v * 16 + (kickers[i] || 0);
    return v;
  }

  // ---------- equity ----------
  // 把手牌代號（如 "AKs"）展開成所有具體 2 張牌組合（[c1,c2]）。
  function comboCards(hand) {
    var hiV = RANK_TO_VAL[hand[0]], loV = RANK_TO_VAL[hand[1]];
    var out = [];
    if (hand.length === 2) { // 對子：4 種花色取 2
      for (var a = 0; a < 4; a++) for (var b = a + 1; b < 4; b++) out.push([a * 13 + hiV, b * 13 + loV]);
    } else if (hand[2] === 's') {
      for (var s = 0; s < 4; s++) out.push([s * 13 + hiV, s * 13 + loV]);
    } else {
      for (var s1 = 0; s1 < 4; s1++) for (var s2 = 0; s2 < 4; s2++) if (s1 !== s2) out.push([s1 * 13 + hiV, s2 * 13 + loV]);
    }
    return out;
  }

  // 把一組手牌代號展開成所有具體 combo。
  function rangeCombos(hands) {
    var out = [];
    hands.forEach(function (h) { comboCards(h).forEach(function (c) { out.push(c); }); });
    return out;
  }

  var SUIT_IDX = { s: 0, h: 1, d: 2, c: 3 };
  // 解析公牌字串，例如 "AsKd7h" -> [card,...]。無效字元忽略。
  function parseBoard(str) {
    if (!str) return [];
    var out = [], m = str.replace(/[^AKQJT2-9shdc]/gi, '').match(/([AKQJT2-9])([shdc])/gi) || [];
    m.forEach(function (tok) {
      var r = RANK_TO_VAL[tok[0].toUpperCase()], s = SUIT_IDX[tok[1].toLowerCase()];
      if (r != null && s != null) out.push(s * 13 + r);
    });
    return out;
  }

  // 蒙地卡羅：範圍 A vs 範圍 B 的 equity。board 可給 0~5 張已知公牌。回傳 {a,b,tie,n}（%）。
  function equity(handsA, handsB, iters, board) {
    iters = iters || 4000;
    board = board || [];
    var combosA = rangeCombos(handsA), combosB = rangeCombos(handsB);
    if (!combosA.length || !combosB.length) return { a: 0, b: 0, tie: 0, n: 0 };
    var aWin = 0, bWin = 0, tie = 0, done = 0;
    for (var it = 0; it < iters; it++) {
      var ca = combosA[(Math.random() * combosA.length) | 0];
      var cb = combosB[(Math.random() * combosB.length) | 0];
      var used = [ca[0], ca[1], cb[0], cb[1]];
      // 洞牌彼此或與公牌衝突則跳過
      if (hasDup(used) || board.indexOf(ca[0]) !== -1 || board.indexOf(ca[1]) !== -1 ||
          board.indexOf(cb[0]) !== -1 || board.indexOf(cb[1]) !== -1) continue;
      used = used.concat(board);
      var run = board.slice();
      while (run.length < 5) {
        var card = (Math.random() * 52) | 0;
        if (used.indexOf(card) === -1) { used.push(card); run.push(card); }
      }
      var sa = eval7([ca[0], ca[1]].concat(run));
      var sb = eval7([cb[0], cb[1]].concat(run));
      if (sa > sb) aWin++; else if (sb > sa) bWin++; else tie++;
      done++;
    }
    if (!done) return { a: 0, b: 0, tie: 0, n: 0 };
    return { a: aWin / done * 100, b: bWin / done * 100, tie: tie / done * 100, n: done };
  }

  function hasDup(a) {
    return a[0] === a[1] || a[0] === a[2] || a[0] === a[3] || a[1] === a[2] || a[1] === a[3] || a[2] === a[3];
  }

  // 單一手牌對範圍 B 的 equity（給熱圖用）。回傳勝率+和局一半的百分比。
  function handEquity(hand, handsB, iters, board) {
    var r = equity([hand], handsB, iters || 1200, board);
    return r.n ? r.a + r.tie / 2 : null;
  }

  // 指定的 2 張手牌 vs 一個範圍的 equity（翻後用，heroCards 是具體牌）。
  function equityVsRange(heroCards, handsB, iters, board) {
    board = board || []; iters = iters || 3000;
    var combosB = rangeCombos(handsB), dead = heroCards.concat(board);
    var win = 0, tie = 0, done = 0;
    for (var i = 0; i < iters; i++) {
      var cb = combosB[(Math.random() * combosB.length) | 0];
      if (cb[0] === cb[1] || dead.indexOf(cb[0]) !== -1 || dead.indexOf(cb[1]) !== -1) continue;
      var used = heroCards.concat(board, [cb[0], cb[1]]), run = board.slice();
      while (run.length < 5) { var c = (Math.random() * 52) | 0; if (used.indexOf(c) === -1) { used.push(c); run.push(c); } }
      var sh = eval7(heroCards.concat(run)), sv = eval7([cb[0], cb[1]].concat(run));
      if (sh > sv) win++; else if (sh === sv) tie++;
      done++;
    }
    return done ? { eq: (win + tie / 2) / done * 100, n: done } : { eq: 0, n: 0 };
  }

  global.Eval = { eval7: eval7, equity: equity, handEquity: handEquity, equityVsRange: equityVsRange, parseBoard: parseBoard, comboCards: comboCards, rangeCombos: rangeCombos };
})(typeof window !== 'undefined' ? window : globalThis);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = (typeof window !== 'undefined' ? window : globalThis).Eval;
}
