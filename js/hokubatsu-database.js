// @version 1.0
// ========================================================
// 【専用データベース】北伐 統合デッキシミュレータ用（副将コスト再計算対応版）
// ========================================================
window.HokubatsuDB = (function() {
    var HOKUBATSU_TROOPS = {
        "AXE":         { key: "AXE",         name: "戦斧兵",   short: "斧兵",   attack: 142, speed: 13, type: "鋭兵",   base: "斧兵", sub: "戦斧兵" },
        "HAMMER":      { key: "HAMMER",      name: "大錘兵",   short: "大錘兵", attack: 185, speed: 11, type: "鋭兵",   base: "錘兵", sub: "大錘兵" },
        "TWIN":        { key: "TWIN",        name: "双剣兵",   short: "双兵",   attack: 105, speed: 16, type: "鋭兵",   base: "双兵", sub: "双剣兵" },
        "GREAT_SWORD": { key: "GREAT_SWORD", name: "大剣兵",   short: "大剣兵", attack: 95,  speed: 12, type: "上級兵", base: "剣兵", sub: "大剣兵" },
        "PIKE":        { key: "PIKE",        name: "矛兵",     short: "矛兵",   attack: 115, speed: 13, type: "上級兵", base: "槍兵", sub: "矛兵" },
        "CROSSBOW":    { key: "CROSSBOW",    name: "弩兵",     short: "弩兵",   attack: 120, speed: 12, type: "上級兵", base: "弓兵", sub: "弩兵" },
        "GUARD_CAV":   { key: "GUARD_CAV",   name: "近衛騎兵", short: "近衛騎", attack: 135, speed: 20, type: "上級兵", base: "騎兵", sub: "近衛騎兵" }
    };

    var RAIREI_TABLES = {
        'TENTEI': {
            1:  { 'SL': 40.00, 'L': 24.00, 'UR': 16.00, 'SR': 8.00,  'R': 4.00,  'UC': 3.20,  'C': 2.40 },
            2:  { 'SL': 50.00, 'L': 30.00, 'UR': 20.00, 'SR': 10.00, 'R': 5.00,  'UC': 4.00,  'C': 3.00 },
            3:  { 'SL': 60.00, 'L': 36.00, 'UR': 24.00, 'SR': 12.00, 'R': 6.00,  'UC': 4.80,  'C': 3.60 },
            4:  { 'SL': 70.00, 'L': 42.00, 'UR': 28.00, 'SR': 14.00, 'R': 7.00,  'UC': 5.60,  'C': 4.20 },
            5:  { 'SL': 80.00, 'L': 48.00, 'UR': 32.00, 'SR': 16.00, 'R': 8.00,  'UC': 6.40,  'C': 4.80 },
            6:  { 'SL': 90.00, 'L': 54.00, 'UR': 36.00, 'SR': 18.00, 'R': 9.00,  'UC': 7.20,  'C': 5.40 },
            7:  { 'SL': 100.00,'L': 60.00, 'UR': 40.00, 'SR': 20.00, 'R': 10.00, 'UC': 8.00,  'C': 6.00 },
            8:  { 'SL': 110.00,'L': 66.00, 'UR': 44.00, 'SR': 22.00, 'R': 11.00, 'UC': 8.80,  'C': 6.60 },
            9:  { 'SL': 130.00,'L': 78.00, 'UR': 52.00, 'SR': 26.00, 'R': 13.00, 'UC': 10.40, 'C': 7.80 },
            10: { 'SL': 170.00,'L': 102.00,'UR': 68.00, 'SR': 34.00, 'R': 17.00, 'UC': 13.60, 'C': 10.20 }
        },
        'RYUJIN': {
            1:  { 'SL': 30.00, 'L': 18.00, 'UR': 12.00, 'SR': 6.00,  'R': 3.00,  'UC': 2.40,  'C': 1.80 },
            2:  { 'SL': 35.00, 'L': 21.00, 'UR': 14.00, 'SR': 7.00,  'R': 3.50,  'UC': 2.80,  'C': 2.10 },
            3:  { 'SL': 40.00, 'L': 24.00, 'UR': 16.00, 'SR': 8.00,  'R': 4.00,  'UC': 3.20,  'C': 2.40 },
            4:  { 'SL': 45.00, 'L': 27.00, 'UR': 18.00, 'SR': 9.00,  'R': 4.50,  'UC': 3.60,  'C': 2.70 },
            5:  { 'SL': 50.00, 'L': 30.00, 'UR': 20.00, 'SR': 10.00, 'R': 5.00,  'UC': 4.00,  'C': 3.00 },
            6:  { 'SL': 55.00, 'L': 33.00, 'UR': 22.00, 'SR': 11.00, 'R': 5.50,  'UC': 4.40,  'C': 3.30 },
            7:  { 'SL': 65.00, 'L': 39.00, 'UR': 26.00, 'SR': 13.00, 'R': 6.50,  'UC': 5.20,  'C': 3.90 },
            8:  { 'SL': 75.00, 'L': 45.00, 'UR': 30.00, 'SR': 15.00, 'R': 7.50,  'UC': 6.00,  'C': 4.50 },
            9:  { 'SL': 85.00, 'L': 51.00, 'UR': 34.00, 'SR': 17.00, 'R': 8.50,  'UC': 6.80,  'C': 5.10 },
            10: { 'SL': 100.00,'L': 60.00, 'UR': 40.00, 'SR': 20.00, 'R': 10.00, 'UC': 8.00,  'C': 6.00 }
        },
        'KISHIN': {
            1:  { 'SL': 10.00, 'L': 6.00,  'UR': 4.00,  'SR': 2.00,  'R': 1.00,  'UC': 0.80,  'C': 0.60 },
            2:  { 'SL': 15.00, 'L': 9.00,  'UR': 6.00,  'SR': 3.00,  'R': 1.50,  'UC': 1.20,  'C': 0.90 },
            3:  { 'SL': 20.00, 'L': 12.00, 'UR': 8.00,  'SR': 4.00,  'R': 2.00,  'UC': 1.60,  'C': 1.20 },
            4:  { 'SL': 25.00, 'L': 15.00, 'UR': 10.00, 'SR': 5.00,  'R': 2.50,  'UC': 2.00,  'C': 1.50 },
            5:  { 'SL': 30.00, 'L': 18.00, 'UR': 12.00, 'SR': 6.00,  'R': 3.00,  'UC': 2.40,  'C': 1.80 },
            6:  { 'SL': 35.00, 'L': 21.00, 'UR': 14.00, 'SR': 7.00,  'R': 3.50,  'UC': 2.80,  'C': 2.10 },
            7:  { 'SL': 40.00, 'L': 24.00, 'UR': 16.00, 'SR': 8.00,  'R': 4.00,  'UC': 3.20,  'C': 2.40 },
            8:  { 'SL': 45.00, 'L': 27.00, 'UR': 18.00, 'SR': 9.00,  'R': 4.50,  'UC': 3.60,  'C': 2.70 },
            9:  { 'SL': 50.00, 'L': 30.00, 'UR': 20.00, 'SR': 10.00, 'R': 5.00,  'UC': 4.00,  'C': 3.00 },
            10: { 'SL': 60.00, 'L': 36.00, 'UR': 24.00, 'SR': 12.00, 'R': 6.00,  'UC': 4.80,  'C': 3.60 }
        }
    };

    function getRaireiSpeedBonus(skill, masterRarity) {
        if (!skill || typeof skill !== 'object') return { addSpeed: 0, baseSpeed: 0, series: null };
        var name = String(skill.name || '').trim();
        var desc = String(skill.description || '').trim();
        var text = name + ' ' + desc;
        if (text.indexOf('雷令') === -1 && text.indexOf('全武将の移動速度が増加') === -1) {
            return { addSpeed: 0, baseSpeed: 0, series: null };
        }

        var series = 'RYUJIN';
        var seriesName = '龍神雷令';
        if (text.indexOf('天帝') !== -1 || text.indexOf('帝雷令') !== -1) {
            series = 'TENTEI';
            seriesName = '天帝雷令';
        } else if (text.indexOf('鬼神') !== -1 || name.indexOf('大雷令') !== -1) {
            series = 'KISHIN';
            seriesName = '鬼神雷令';
        }

        var mLv = text.match(/(?:LV|Lv|レベル)\s*([0-9]+)/i);
        var lv = mLv ? Math.min(10, Math.max(1, parseInt(mLv[1]))) : 10;

        var r = String(masterRarity || 'SL').toUpperCase();
        var sTable = RAIREI_TABLES[series] || RAIREI_TABLES.RYUJIN;
        var lvRow = sTable[lv] || sTable[10];
        var baseVal = lvRow[r] !== undefined ? lvRow[r] : lvRow.SL;

        var weatherMult = (text.indexOf('1.2倍') !== -1) ? 1.2 : 1.0;
        var addSpeed = Math.round(baseVal * weatherMult * 100) / 100;
        return { addSpeed: addSpeed, baseSpeed: baseVal, series: seriesName };
    }

    function checkHokubatsuAdjutantEligibility(masterCard, fkCard, mirrorInfo, usedAdjutantCost) {
        if (!masterCard || !fkCard) return { ok: false, rate: 0 };
        var mRarity = String(masterCard.rarity || 'SL').toUpperCase();
        var fkRarity = String(fkCard.rarity || 'C').toUpperCase();
        var mOrigCost = SharedDB.safeNum(masterCard.originalCost !== undefined ? masterCard.originalCost : masterCard.cost, 4.5);
        var fkCost = SharedDB.safeNum(fkCard.cost, 0);
        var maxFkCost = SharedDB.safeNum(masterCard.maxFukushoCost, 0);
        var curUsedCost = SharedDB.safeNum(usedAdjutantCost, 0);
        var mCountry = String(masterCard.country || '').trim();

        var mRarityVal = SharedDB.RARITY_ORDER[mRarity] || 1;
        var fkRarityVal = SharedDB.RARITY_ORDER[fkRarity] || 1;

        if (fkRarityVal > mRarityVal) return { ok: false, rate: 0 };
        if (fkCost > mOrigCost + 1e-6) return { ok: false, rate: 0 };
        if (curUsedCost + fkCost > maxFkCost + 1e-6) return { ok: false, rate: 0 };

        var st = SharedDB.getAdjutantStatusEffect(fkCard, mirrorInfo);

        if (mirrorInfo) {
            if (fkRarity !== mRarity) return { ok: false, rate: 0 };
            if (String(mirrorInfo.rarity || 'SL').toUpperCase() !== mRarity) return { ok: false, rate: 0 };

            var buBonusScore = st.atkBonus * 2;
            var effRate = SharedDB.calcAdjutantEffectiveCopyRate(masterCard, fkCard, mirrorInfo);

            if (mirrorInfo.type === 'senkyo') {
                if (mRarity !== 'SL') return { ok: false, rate: 0 };
                return { ok: true, rate: effRate, atkBonus: st.atkBonus, defBonus: st.defBonus, spdBonus: st.spdBonus, statRate: 100, job: st.job, isBu: st.isBu, isGo: st.isGo, isEi: st.isEi, label: mirrorInfo.label, score: 500000 + buBonusScore + mOrigCost * 10000 };
            } else if (mirrorInfo.type === 'musume_renkyo') {
                if (SharedDB.isFemaleOrOtherBusho && SharedDB.isFemaleOrOtherBusho(masterCard)) {
                    return { ok: true, rate: effRate, atkBonus: st.atkBonus, defBonus: st.defBonus, spdBonus: st.spdBonus, statRate: SharedDB.safeNum(mirrorInfo.rate, 100), job: st.job, isBu: st.isBu, isGo: st.isGo, isEi: st.isEi, label: mirrorInfo.label, score: 300000 + buBonusScore + effRate * 1000 };
                }
                return { ok: false, rate: 0 };
            } else if (mirrorInfo.type === 'renkyo') {
                if (mCountry && mCountry !== '改' && mCountry === mirrorInfo.force) {
                    return { ok: true, rate: effRate, atkBonus: st.atkBonus, defBonus: st.defBonus, spdBonus: st.spdBonus, statRate: SharedDB.safeNum(mirrorInfo.rate, 100), job: st.job, isBu: st.isBu, isGo: st.isGo, isEi: st.isEi, label: mirrorInfo.label, score: 300000 + buBonusScore + effRate * 1000 };
                }
                return { ok: false, rate: 0 };
            } else if (mirrorInfo.type === 'meikyo') {
                return { ok: true, rate: effRate, atkBonus: st.atkBonus, defBonus: st.defBonus, spdBonus: st.spdBonus, statRate: st.statRate, job: st.job, isBu: st.isBu, isGo: st.isGo, isEi: st.isEi, label: mirrorInfo.label, score: 100000 + buBonusScore + effRate * 1000 };
            }
            return { ok: false, rate: 0 };
        } else {
            return {
                ok: true,
                rate: 0,
                atkBonus: st.atkBonus,
                defBonus: st.defBonus,
                spdBonus: st.spdBonus,
                statRate: st.statRate,
                job: st.job,
                isBu: st.isBu,
                isGo: st.isGo,
                isEi: st.isEi,
                label: (st.isBu ? '[武]' : st.isEi ? '[鋭]' : '') + '一般副将',
                score: 10000 + (st.spdBonus * 50) + (st.atkBonus * 2)
            };
        }
    }

    function solveHokubatsu2DDP(maxSlots, maxCost, items) {
        if (maxSlots <= 0 || maxCost <= 0 || !items || items.length === 0) {
            return { val: 0, picked: [] };
        }
        var capCostInt = Math.max(0, Math.floor(Math.round(maxCost * 2)));
        var dp = new Array(maxSlots + 1);
        var choice = new Array(maxSlots + 1);
        for (var s = 0; s <= maxSlots; s++) {
            dp[s] = new Float64Array(capCostInt + 1);
            choice[s] = new Array(capCostInt + 1);
            for (var c = 0; c <= capCostInt; c++) {
                dp[s][c] = -1;
                choice[s][c] = [];
            }
        }
        dp[0][0] = 0;

        for (var idx = 0; idx < items.length; idx++) {
            var it = items[idx];
            var costVal = SharedDB.safeNum(it.effectiveCost !== undefined ? it.effectiveCost : it.cost, 1.0);
            var wCost = Math.max(1, Math.round(costVal * 2));
            var v = SharedDB.safeNum(it.scoreValue, 0);
            if (wCost > capCostInt || v <= 0) continue;

            for (var s = maxSlots; s >= 1; s--) {
                for (var c = capCostInt; c >= wCost; c--) {
                    if (dp[s - 1][c - wCost] >= 0) {
                        var candVal = dp[s - 1][c - wCost] + v;
                        if (candVal > dp[s][c]) {
                            dp[s][c] = candVal;
                            choice[s][c] = choice[s - 1][c - wCost].concat(it);
                        }
                    }
                }
            }
        }

        var bestVal = 0;
        var bestPicked = [];
        for (var s2 = 1; s2 <= maxSlots; s2++) {
            for (var c2 = 0; c2 <= capCostInt; c2++) {
                if (dp[s2][c2] > bestVal) {
                    bestVal = dp[s2][c2];
                    bestPicked = choice[s2][c2];
                }
            }
        }
        return { val: bestVal, picked: bestPicked };
    }

    return {
        HOKUBATSU_TROOPS: HOKUBATSU_TROOPS,
        RAIREI_TABLES: RAIREI_TABLES,
        getRaireiSpeedBonus: getRaireiSpeedBonus,
        checkHokubatsuAdjutantEligibility: checkHokubatsuAdjutantEligibility,
        solveHokubatsu2DDP: solveHokubatsu2DDP
    };
})();