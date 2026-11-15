// ========================================================
// 【北伐データベースモジュール】js/hokubatsu-database.js (Ver. 1.01)
// 役割：北伐専用兵種データ（戦斧兵・大錘兵）、雷令シリーズ別・レアリティ別速度加算テーブル、枠数・コスト2次元DP最適化
// ========================================================
window.HokubatsuDB = (function() {
    var HOKUBATSU_TROOPS = {
        'AXE':    { name: '戦斧兵', attack: 142, speed: 13, type: '鋭兵', base: '斧兵', sub: '戦斧兵' },
        'HAMMER': { name: '大錘兵', attack: 185, speed: 11, type: '鋭兵', base: '錘兵', sub: '大錘兵' }
    };

    var RAIREI_TABLES = {
        'TENTEI': { 'SL': 170, 'L': 102, 'UR': 68, 'SR': 34, 'R': 17, 'UC': 13.6, 'C': 10.2 },
        'RYUJIN': { 'SL': 100, 'L': 60,  'UR': 40, 'SR': 20, 'R': 10, 'UC': 8.0,  'C': 6.0 },
        'KISHIN': { 'SL': 60,  'L': 36,  'UR': 24, 'SR': 12, 'R': 6,  'UC': 4.8,  'C': 3.6 }
    };

    var RAIREI_LV_RATIOS = {
        1: 0.25, 2: 0.28, 3: 0.31, 4: 0.36, 5: 0.42,
        6: 0.50, 7: 0.60, 8: 0.72, 9: 0.85, 10: 1.00
    };

    function getRaireiSpeedBonus(skill, masterRarity) {
        if (!skill || typeof skill !== 'object') return { addSpeed: 0, baseSpeed: 0, series: null };
        var name = String(skill.name || '').trim();
        var desc = String(skill.description || '').trim();
        var text = name + ' ' + desc;

        if (text.indexOf('雷令') === -1 && text.indexOf('全武将の移動速度が増加') === -1) {
            return { addSpeed: 0, baseSpeed: 0, series: null };
        }

        var series = 'TENTEI';
        var seriesName = '天帝';
        if (text.indexOf('鬼神') !== -1) {
            series = 'KISHIN';
            seriesName = '鬼神';
        } else if (text.indexOf('龍神') !== -1 || text.indexOf('亀神') !== -1) {
            series = 'RYUJIN';
            seriesName = text.indexOf('亀神') !== -1 ? '亀神' : '龍神';
        }

        var mLv = text.match(/(?:LV|Lv|レベル)\s*([0-9]+)/i);
        var lv = mLv ? Math.min(10, Math.max(1, parseInt(mLv[1], 10))) : 10;
        var lvRatio = RAIREI_LV_RATIOS[lv] !== undefined ? RAIREI_LV_RATIOS[lv] : 1.0;

        var r = String(masterRarity || 'SL').toUpperCase();
        var table = RAIREI_TABLES[series] || RAIREI_TABLES['TENTEI'];
        var baseVal = table[r] !== undefined ? table[r] : table['SL'];
        var finalVal = Math.round(baseVal * lvRatio * 100) / 100;

        return { addSpeed: finalVal, baseSpeed: finalVal, series: seriesName };
    }

    function solveHokubatsu2DDP(maxCount, maxCost, items) {
        var countCap = Math.max(0, Math.floor(maxCount || 0));
        var costCap = Math.max(0, Math.floor(Math.round((maxCost || 0) * 2)));
        if (countCap <= 0 || costCap <= 0 || !items || items.length === 0) {
            return { val: 0, picked: [] };
        }

        var dp = [];
        var choice = [];
        for (var k = 0; k <= countCap; k++) {
            dp[k] = new Float64Array(costCap + 1);
            choice[k] = new Array(costCap + 1);
            for (var c = 0; c <= costCap; c++) {
                choice[k][c] = [];
            }
        }

        for (var idx = 0; idx < items.length; idx++) {
            var item = items[idx];
            var rawCost = (item.effectiveCost !== undefined) ? item.effectiveCost :
                          (item.card && item.card.cost !== undefined) ? item.card.cost : item.cost;
            var wInt = Math.max(1, Math.round(SharedDB.safeNum(rawCost, 1.0) * 2));
            var v = SharedDB.safeNum(item.scoreValue !== undefined ? item.scoreValue : (item.tMult || item.gMult), 0);
            if (wInt > costCap || v <= 0) continue;

            for (var k = countCap; k >= 1; k--) {
                for (var c = costCap; c >= wInt; c--) {
                    var candVal = dp[k - 1][c - wInt] + v;
                    if (candVal > dp[k][c]) {
                        dp[k][c] = candVal;
                        choice[k][c] = choice[k - 1][c - wInt].concat(item);
                    }
                }
            }
        }

        var bestVal = 0;
        var bestK = 0;
        var bestC = 0;
        for (var k2 = 0; k2 <= countCap; k2++) {
            for (var c2 = 0; c2 <= costCap; c2++) {
                if (dp[k2][c2] > bestVal) {
                    bestVal = dp[k2][c2];
                    bestK = k2;
                    bestC = c2;
                }
            }
        }

        return { val: bestVal, picked: choice[bestK][bestC] || [] };
    }

    return {
        HOKUBATSU_TROOPS: HOKUBATSU_TROOPS,
        RAIREI_TABLES: RAIREI_TABLES,
        getRaireiSpeedBonus: getRaireiSpeedBonus,
        solveHokubatsu2DDP: solveHokubatsu2DDP
    };
})();