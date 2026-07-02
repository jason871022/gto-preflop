/*
 * hands.js — 手牌網格的基礎工具
 *
 * 為什麼有這個檔案：整個 app 都建立在「169 種起手牌 + 標準記法」之上。
 * 把「網格座標 <-> 手牌記法 <-> 組合數 <-> 範圍字串」的轉換集中在這裡，
 * 資料檔(ranges.js)就能用人類看得懂的範圍字串(如 "22+, ATs+, KQo")來寫，
 * 而不是硬編 169 格。這也讓使用者能對照 PDF 直接編輯校正。
 */

(function (global) {
  'use strict';

  // 由大到小；index 0 = A(最大)。網格的行與列都用這個順序。
  var RANKS = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'];

  // 每種牌型的組合(combo)數：對子 6、同花 4、非同花 12。全部加總 = 1326。
  var COMBOS = { pair: 6, suited: 4, offsuit: 12 };

  function rankIndex(r) {
    return RANKS.indexOf(r.toUpperCase());
  }

  // 由網格座標 (row, col) 得到手牌代號。
  // 慣例：對角線 = 對子；右上三角(col>row) = 同花(s)；左下三角 = 非同花(o)。
  // 高牌永遠寫在前面。
  function handAt(row, col) {
    var hi = RANKS[Math.min(row, col)];
    var lo = RANKS[Math.max(row, col)];
    if (row === col) return hi + lo;             // 例如 "AA"
    if (col > row) return hi + lo + 's';          // 例如 "AKs"
    return hi + lo + 'o';                          // 例如 "AKo"
  }

  function handType(hand) {
    if (hand.length === 2) return 'pair';
    return hand[2] === 's' ? 'suited' : 'offsuit';
  }

  function comboCount(hand) {
    return COMBOS[handType(hand)];
  }

  // 產生全部 169 個手牌代號(依網格順序，用來建表與逐一列舉)。
  function allHands() {
    var out = [];
    for (var r = 0; r < 13; r++) {
      for (var c = 0; c < 13; c++) {
        out.push(handAt(r, c));
      }
    }
    return out;
  }

  /*
   * expandRange(str) — 把範圍字串展開成手牌陣列。
   * 支援的語法(用逗號分隔)：
   *   對子：   "77"、"22+"(22 到 AA)、"55-99"
   *   同花：   "AKs"、"A2s+"(固定高牌 A，低牌往上到 K)、"KTs+"、"76s-54s"(等差連牌下降)
   *   非同花： "AKo"、"ATo+"、"KJo+"、"T9o-54o"
   * "+" 的意義：對子往 AA 增長；同花/非同花固定高牌、低牌往上增長到高牌下一階。
   */
  function expandRange(str) {
    if (!str) return [];
    var hands = [];
    str.split(',').forEach(function (raw) {
      var token = raw.trim();
      if (!token) return;
      hands = hands.concat(expandToken(token));
    });
    // 去重(保留第一次出現順序)
    var seen = {};
    return hands.filter(function (h) {
      if (seen[h]) return false;
      seen[h] = true;
      return true;
    });
  }

  function expandToken(token) {
    // 連牌等差區間，例如 "76s-54s"、"T9o-54o"
    if (token.indexOf('-') !== -1) {
      return expandDash(token);
    }
    var plus = token.slice(-1) === '+';
    var base = plus ? token.slice(0, -1) : token;

    // 對子
    if (base.length === 2 && base[0] === base[1]) {
      if (!plus) return [base];
      // "22+" -> 從此對子往上到 AA
      var start = rankIndex(base[0]);
      var res = [];
      for (var i = start; i >= 0; i--) res.push(RANKS[i] + RANKS[i]);
      return res;
    }

    // 同花 / 非同花
    var hi = base[0], lo = base[1], suit = base[2]; // 's' or 'o'
    if (!plus) return [hi + lo + suit];
    // "AYs+" -> 固定高牌，低牌從目前往上到(高牌的下一階)
    var hiI = rankIndex(hi);
    var loStart = rankIndex(lo);
    var out = [];
    for (var j = loStart; j > hiI; j--) out.push(hi + RANKS[j] + suit);
    return out;
  }

  // "76s-54s"：兩張牌以固定間距一起遞減。
  function expandDash(token) {
    var parts = token.split('-');
    var a = parts[0].trim(), b = parts[1].trim();
    var suit = a.slice(-1); // 's' / 'o'（對子區間則是數字）
    // 對子區間 "55-99"
    if (a.length === 2 && a[0] === a[1]) {
      var hiP = rankIndex(a[0]), loP = rankIndex(b[0]);
      var top = Math.min(hiP, loP), bot = Math.max(hiP, loP);
      var pres = [];
      for (var p = bot; p >= top; p--) pres.push(RANKS[p] + RANKS[p]);
      return pres;
    }
    var aHi = rankIndex(a[0]), aLo = rankIndex(a[1]);
    var bHi = rankIndex(b[0]), bLo = rankIndex(b[1]);
    var res = [];

    // 固定高牌、低牌遞減，例如 "A5o-A2o" -> A5o A4o A3o A2o
    if (aHi === bHi) {
      var loT = Math.min(aLo, bLo), loB = Math.max(aLo, bLo);
      for (var k = loT; k <= loB; k++) res.push(RANKS[aHi] + RANKS[k] + suit);
      return res;
    }
    // 固定低牌、高牌遞減，例如 "KQs-9Qs"（少見，一併支援）
    if (aLo === bLo) {
      var hiT = Math.min(aHi, bHi), hiB = Math.max(aHi, bHi);
      for (var m = hiT; m <= hiB; m++) res.push(RANKS[m] + RANKS[aLo] + suit);
      return res;
    }
    // 連牌區間：兩張牌維持固定間距一起遞減，例如 "76s-54s"
    if (aHi > bHi) { var t; t = aHi; aHi = bHi; bHi = t; t = aLo; aLo = bLo; bLo = t; }
    var hiCur = aHi, loCur = aLo;
    while (hiCur <= bHi && loCur <= bLo) {
      res.push(RANKS[hiCur] + RANKS[loCur] + suit);
      hiCur++; loCur++;
    }
    return res;
  }

  // 把一組手牌換算成總組合數與佔比(用來顯示覆蓋率)。
  function combosOf(hands) {
    return hands.reduce(function (sum, h) { return sum + comboCount(h); }, 0);
  }

  function percentOf(hands) {
    return combosOf(hands) / 1326 * 100;
  }

  global.Hands = {
    RANKS: RANKS,
    COMBOS: COMBOS,
    rankIndex: rankIndex,
    handAt: handAt,
    handType: handType,
    comboCount: comboCount,
    allHands: allHands,
    expandRange: expandRange,
    combosOf: combosOf,
    percentOf: percentOf
  };
})(typeof window !== 'undefined' ? window : globalThis);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = (typeof window !== 'undefined' ? window : globalThis).Hands;
}
