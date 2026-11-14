// @version 1.0
// ========================================================
// 共有データベース モジュール（SL2枚ペア最適化 ＆ 主将明鏡LV別 ＆ 副将コスト再計算統合版）
// ========================================================
window.SharedDB = (function() {
    var GEKIREI_TABLES = {
        'TENTEI': {
            'SL': { 4.5: 103950, 4.0: 84000, 3.5: 66150, 3.0: 50400, 2.5: 36750, 2.0: 25200, 1.5: 15750, 1.0: 8400 },
            'L':  { 4.5: 62370,  4.0: 50400, 3.5: 39690, 3.0: 30240, 2.5: 22050, 2.0: 15120, 1.5: 9450,  1.0: 5040 },
            'UR': { 4.5: 41580,  4.0: 33600, 3.5: 26460, 3.0: 20160, 2.5: 14700, 2.0: 10080, 1.5: 6300,  1.0: 3360 },
            'SR': { 4.5: 20790,  4.0: 16800, 3.5: 13230, 3.0: 10080, 2.5: 7350,  2.0: 5040,  1.5: 3150,  1.0: 1680 },
            'R':  { 4.5: 10395,  4.0: 8400,  3.5: 6615,  3.0: 5040,  2.5: 3675,  2.0: 2520,  1.5: 1575,  1.0: 840 },
            'UC': { 4.5: 8316,   4.0: 6720,  3.5: 5292,  3.0: 4032,  2.5: 2940,  2.0: 2016,  1.5: 1260,  1.0: 672 },
            'C':  { 4.5: 6237,   4.0: 5040,  3.5: 3969,  3.0: 3024,  2.5: 2205,  2.0: 1512,  1.5: 945,   1.0: 504 }
        },
        'RYUJIN': {
            'SL': { 4.5: 61875,  4.0: 50000, 3.5: 39375, 3.0: 30000, 2.5: 21875, 2.0: 15000, 1.5: 9375,  1.0: 5000 },
            'L':  { 4.5: 37125,  4.0: 30000, 3.5: 23625, 3.0: 18000, 2.5: 13125, 2.0: 9000,  1.5: 5625,  1.0: 3000 },
            'UR': { 4.5: 24750,  4.0: 20000, 3.5: 15750, 3.0: 12000, 2.5: 8750,  2.0: 6000,  1.5: 3750,  1.0: 2000 },
            'SR': { 4.5: 12375,  4.0: 10000, 3.5: 7875,  3.0: 6000,  2.5: 4375,  2.0: 3000,  1.5: 1875,  1.0: 1000 },
            'R':  { 4.5: 6188,   4.0: 5000,  3.5: 3938,  3.0: 3000,  2.5: 2188,  2.0: 1500,  1.5: 938,   1.0: 500 },
            'UC': { 4.5: 4950,   4.0: 4000,  3.5: 3150,  3.0: 2400,  2.5: 1750,  2.0: 1200,  1.5: 750,   1.0: 400 },
            'C':  { 4.5: 3713,   4.0: 3000,  3.5: 2363,  3.0: 1800,  2.5: 1313,  2.0: 900,   1.5: 563,   1.0: 300 }
        },
        'KISHIN': {
            'SL': { 4.5: 37125,  4.0: 30000, 3.5: 23625, 3.0: 18000, 2.5: 13125, 2.0: 9000,  1.5: 5625,  1.0: 3000 },
            'L':  { 4.5: 22275,  4.0: 18000, 3.5: 14175, 3.0: 10800, 2.5: 7875,  2.0: 5400,  1.5: 3375,  1.0: 1800 },
            'UR': { 4.5: 14850,  4.0: 12000, 3.5: 9450,  3.0: 7200,  2.5: 5250,  2.0: 3600,  1.5: 2250,  1.0: 1200 },
            'SR': { 4.5: 7425,   4.0: 6000,  3.5: 4725,  3.0: 3600,  2.5: 2625,  2.0: 1800,  1.5: 1125,  1.0: 600 },
            'R':  { 4.5: 3713,   4.0: 3000,  3.5: 2363,  3.0: 1800,  2.5: 1313,  2.0: 900,   1.5: 563,   1.0: 300 },
            'UC': { 4.5: 2970,   4.0: 2400,  3.5: 1890,  3.0: 1440,  2.5: 1050,  2.0: 720,   1.5: 450,   1.0: 240 },
            'C':  { 4.5: 2228,   4.0: 1800,  3.5: 1418,  3.0: 1080,  2.5: 788,   2.0: 540,   1.5: 338,   1.0: 180 }
        }
    };

    var TROOP_DATA = {
        "HEAVY_BOW": { name: "重装弓兵", attack: 286, type: "天兵", base: "弓兵", sub: "弓兵科" },
        "HEAVY_SPEAR": { name: "重装槍兵", attack: 262, type: "天兵", base: "槍兵", sub: "槍兵科" },
        "HEAVY_CAV": { name: "重装騎兵", attack: 253, type: "天兵", base: "騎兵", sub: "騎兵科" },
        "AXE": { name: "戦斧兵", attack: 142, type: "鋭兵", base: "斧兵", sub: "戦斧兵" },
        "TWIN": { name: "双剣兵", attack: 105, type: "鋭兵", base: "双兵", sub: "双剣兵" },
        "HAMMER": { name: "大錘兵", attack: 185, type: "鋭兵", base: "錘兵", sub: "大錘兵" }
    };

    var DEF_TROOP_DATA = {
        "HEAVY_SPEAR": { name: "重装槍兵", defense: 286, type: "天兵", base: "槍兵", sub: "槍兵科" },
        "HEAVY_BOW":   { name: "重装弓兵", defense: 262, type: "天兵", base: "弓兵", sub: "弓兵科" },
        "HEAVY_CAV":   { name: "重装騎兵", defense: 253, type: "天兵", base: "騎兵", sub: "騎兵科" },
        "GUARD":       { name: "近衛兵",   defense: 190, type: "上級兵", base: "剣兵", sub: "剣兵科" },
        "HAMMER":      { name: "大錘兵",   defense: 185, type: "鋭兵", base: "錘兵", sub: "大錘兵" },
        "AXE":         { name: "戦斧兵",   defense: 142, type: "鋭兵", base: "斧兵", sub: "戦斧兵" },
        "TWIN":        { name: "双剣兵",   defense: 105, type: "鋭兵", base: "双兵", sub: "双剣兵" }
    };

    var ADJUTANT_RATES = {
        NORMAL_SKILL:  { 'C': 10, 'UC': 20, 'R': 40, 'SR': 50, 'UR': 60, 'L': 70, 'SL': 80 },
        NORMAL_BU_GO:  { 'C': 5,  'UC': 10, 'R': 20, 'SR': 30, 'UR': 40, 'L': 50, 'SL': 60 },
        NORMAL_EI_HAKU:{ 'C': 10, 'UC': 20, 'R': 30, 'SR': 40, 'UR': 60, 'L': 70, 'SL': 80 },
        RENKYO_ALL:    { 'C': 10, 'UC': 20, 'R': 50, 'SR': 60, 'UR': 70, 'L': 85, 'SL': 100 }
    };

    // 主将自身の明鏡（変:主将の帝明鏡 等）レベル別コピー率テーブル（LV8=80%, LV10=100%）
    var MASTER_MEIKYO_LV_RATES = {
        1: 45, 2: 50, 3: 55, 4: 60, 5: 65,
        6: 70, 7: 75, 8: 80, 9: 90, 10: 100
    };

    function getMasterMirrorCopyRate(skill) {
        if (!skill || typeof skill !== 'object') return 0.8;
        var sName = String(skill.name || '').trim();
        var sDesc = String(skill.description || '').trim();
        var combined = sName + ' ' + sDesc;

        var mPct = sDesc.match(/([0-9\.]+)\s*[%％]\s*の効果/);
        if (mPct) {
            return Math.max(0, parseFloat(mPct[1])) / 100;
        }

        var mLv = combined.match(/(?:LV|Lv|レベル)\s*([0-9]+)/i);
        var lv = mLv ? Math.min(10, Math.max(1, parseInt(mLv[1], 10))) : 10;
        var pct = MASTER_MEIKYO_LV_RATES[lv] !== undefined ? MASTER_MEIKYO_LV_RATES[lv] : 100;
        return pct / 100;
    }

    // 副将コストでの第1スキル再計算比率（コスト変動文言から逆算）
    function calcCostAdjustedRatio(skillOrDesc, masterOrigCost, adjutantCost) {
        var cM = safeNum(masterOrigCost, 4.5);
        var cF = safeNum(adjutantCost, cM);
        if (cM <= 0 || cF <= 0 || Math.abs(cM - cF) < 0.01) return 1.0;

        var desc = '';
        if (typeof skillOrDesc === 'string') desc = skillOrDesc;
        else if (skillOrDesc && typeof skillOrDesc === 'object') {
            desc = String(skillOrDesc.description || '') + ' ' + String(skillOrDesc.name || '');
        }

        if (desc.indexOf('コストにより非常に大きく変動') !== -1) {
            return (cF * cF) / (cM * cM);
        }
        if (desc.indexOf('コストにより大きく変動') !== -1) {
            return (cF * (cF + 1)) / (cM * (cM + 1));
        }
        if (desc.indexOf('コストにより変動') !== -1) {
            return cF / cM;
        }
        return 1.0;
    }

    // 副将の実効コピー率（%）を算出（明鏡の場合は副将コストで第1スキルを再計算した比率を反映）
    function calcAdjutantEffectiveCopyRate(masterCard, fkCard, mirrorInfo) {
        if (!masterCard || !fkCard || !mirrorInfo) return 0;
        var baseRate = safeNum(mirrorInfo.rate, 0);
        if (baseRate <= 0) return 0;

        var mOrigCost = safeNum(masterCard.originalCost !== undefined ? masterCard.originalCost : masterCard.cost, 4.5);
        var fkCost = safeNum(fkCard.cost, mOrigCost);
        var s0 = (Array.isArray(masterCard.skills) && masterCard.skills[0]) ? masterCard.skills[0] : null;

        if (mirrorInfo.type === 'senkyo' || mirrorInfo.type === 'renkyo') {
            return baseRate;
        }
        if (mirrorInfo.type === 'musume_renkyo') {
            if (isFemaleOrOtherBusho(masterCard)) {
                return baseRate;
            }
            var fallbackR = ADJUTANT_RATES.NORMAL_SKILL[String(mirrorInfo.rarity || 'SL').toUpperCase()] || 80;
            return fallbackR * calcCostAdjustedRatio(s0, mOrigCost, fkCost);
        }
        return baseRate * calcCostAdjustedRatio(s0, mOrigCost, fkCost);
    }

    // 女性・動物・その他性別判定テーブル（娘将の錬鏡 100%対象）
    var FEMALE_OTHER_EXACT_TOKENS = {
        '夏侯氏': 1, '黄月英': 1, '甘夫人': 1, '糜夫人': 1, '敬哀皇后': 1, '穆皇后': 1,
        '関銀屏': 1, '張姫': 1, '鮑三娘': 1, '馬雲緑': 1, '王悦': 1, '王桃': 1,
        '孫尚香': 1, '諸葛鈴': 1, '甄姫': 1, '卞夫人': 1, '郭夫人': 1, '劉夫人': 1,
        '張春華': 1, '辛憲英': 1, '王元姫': 1, '賈南風': 1, '趙娥': 1, '曹憲': 1,
        '曹節': 1, '曹華': 1, '盧氏': 1, '崔氏': 1, '東郷公主': 1, '大喬': 1,
        '小喬': 1, '呉夫人': 1, '呉国太': 1, '虎姉妹': 1, '歩夫人': 1, '徐氏': 1,
        '大虎': 1, '小虎': 1, '孫氏': 1, '周姫': 1, '朱皇后': 1, '大懿皇后': 1,
        '祝融': 1, '貂蝉': 1, '蔡琰': 1, '王異': 1, '厳氏': 1, '何皇后': 1,
        '董白': 1, '鄒氏': 1, '呂氏': 1, '王美人': 1, '袁姫': 1, '花鬘': 1,
        '劉曼': 1, '蔡夫人': 1, '楊氏': 1, '伏寿': 1,
        '于吉娘': 1, '水鏡娘': 1, '左慈娘': 1, '張角娘': 1, '南華娘': 1,
        'パンダ': 1, '鶴爺': 1, '亀': 1, '虎': 1, '龍': 1, '青龍': 1, '黒虎': 1,
        '龍虎': 1, '鶴亀': 1, '娘々': 1,
        '十伍周年・娘': 1, '十伍周年・獣': 1,
        '新春・于吉一門': 1, '新春・左慈一門': 1, '新春・三人娘': 1,
        '張角雑技団': 1, '伍娘雑技団': 1, '水鏡雑技団': 1, '参娘雑技団': 1,
        '貴妃': 1, '蜀妃': 1, '曹妃': 1
    };

    var FEMALE_OTHER_SUBSTRINGS = [
        '于吉娘', '水鏡娘', '左慈娘', '張角娘', '南華娘',
        '娘々', '虎姉妹', 'パンダ', '鶴爺', '青龍', '黒虎', '龍虎', '鶴亀',
        '雑技団', '一門', '三人娘', '皇后', '夫人', '公主', '国太', '美人', '貴妃', '蜀妃', '曹妃'
    ];

    function isFemaleOrOtherBusho(cardOrName) {
        var name = '';
        if (typeof cardOrName === 'string') name = cardOrName;
        else if (cardOrName && typeof cardOrName === 'object') name = String(cardOrName.name || '');
        name = name.trim();
        if (!name) return false;

        if (FEMALE_OTHER_EXACT_TOKENS[name]) return true;
        for (var i = 0; i < FEMALE_OTHER_SUBSTRINGS.length; i++) {
            if (name.indexOf(FEMALE_OTHER_SUBSTRINGS[i]) !== -1) return true;
        }

        var tokens = name.split(/[×・\s/／\(\)（）]+/);
        for (var j = 0; j < tokens.length; j++) {
            var t = tokens[j].trim();
            if (!t) continue;
            if (FEMALE_OTHER_EXACT_TOKENS[t]) return true;
            if (/(?:娘|姫|氏|妃)$/.test(t)) return true;
        }
        return false;
    }

    var manualSoldierMap = {};
    try {
        var savedSoldier = localStorage.getItem('3gokushi_manual_soldier_v2');
        if (savedSoldier) manualSoldierMap = JSON.parse(savedSoldier) || {};
    } catch (e) {}

    function setManualSoldierType(cardKey, soldierKey) {
        if (!cardKey) return;
        if (!soldierKey || soldierKey === 'AUTO') delete manualSoldierMap[cardKey];
        else manualSoldierMap[cardKey] = soldierKey;
        try {
            localStorage.setItem('3gokushi_manual_soldier_v2', JSON.stringify(manualSoldierMap));
        } catch (e) {}
    }

    var SOLDIER_DEFS = {
        'SPEAR':  { key: 'SPEAR',  label: '槍', raw: '槍兵' },
        'BOW':    { key: 'BOW',    label: '弓', raw: '弓兵' },
        'CAV':    { key: 'CAV',    label: '騎', raw: '騎兵' },
        'SWORD':  { key: 'SWORD',  label: '剣', raw: '剣兵' },
        'AXE':    { key: 'AXE',    label: '斧', raw: '斧兵' },
        'DOUBLE': { key: 'DOUBLE', label: '双', raw: '双兵' },
        'HAMMER': { key: 'HAMMER', label: '錘', raw: '錘兵' }
    };

    function parseExplicitSoldierString(str) {
        var s = String(str || '').trim();
        if (!s || s === 'illust' || s === '-' || s === '不明') return null;
        if (s.indexOf('双') !== -1) return SOLDIER_DEFS.DOUBLE;
        if (s.indexOf('斧') !== -1) return SOLDIER_DEFS.AXE;
        if (s.indexOf('錘') !== -1 || s.indexOf('鎚') !== -1) return SOLDIER_DEFS.HAMMER;
        if (s.indexOf('槍') !== -1) return SOLDIER_DEFS.SPEAR;
        if (s.indexOf('弓') !== -1) return SOLDIER_DEFS.BOW;
        if (s.indexOf('騎') !== -1) return SOLDIER_DEFS.CAV;
        if (s.indexOf('剣') !== -1 || s.indexOf('歩') !== -1) return SOLDIER_DEFS.SWORD;
        return null;
    }

    function detectSoldierFromSkillText(text) {
        if (!text) return null;
        if (/(?:兵舎修練|の義勇軍|の檄文|重装.*修練|禁軍兵修練)/.test(text)) return null;

        if (text.indexOf('双兵') !== -1 || text.indexOf('双剣') !== -1) return SOLDIER_DEFS.DOUBLE;
        if (text.indexOf('斧兵') !== -1 || text.indexOf('戦斧') !== -1) return SOLDIER_DEFS.AXE;
        if (text.indexOf('錘兵') !== -1 || text.indexOf('大錘') !== -1) return SOLDIER_DEFS.HAMMER;
        if (text.indexOf('槍兵') !== -1 || text.indexOf('槍戟') !== -1) return SOLDIER_DEFS.SPEAR;
        if (text.indexOf('弓兵') !== -1 || text.indexOf('弓神') !== -1) return SOLDIER_DEFS.BOW;
        if (text.indexOf('騎兵') !== -1 || text.indexOf('戦蹄') !== -1 || text.indexOf('飛蹄') !== -1) return SOLDIER_DEFS.CAV;
        if (text.indexOf('剣兵') !== -1) return SOLDIER_DEFS.SWORD;
        return null;
    }

    function inferSoldierFromGeneralName(name) {
        var head = String(name || '').split(/[×・\s\(\（【]/)[0];
        if (/(?:双|二喬|大喬|小喬|大虎|小虎|貂蝉|鮑三娘|水鏡|南華|王桃|王悦|鄒氏|蔡琰|甄氏|歩夫人|甘夫人|穆皇后|敬哀|花鬘)/.test(head)) return SOLDIER_DEFS.DOUBLE;
        if (/(?:典韋|徐晃|黄蓋|韓遂|華雄|関興|張角)/.test(head)) return SOLDIER_DEFS.AXE;
        if (/(?:許褚|沙摩柯|兀突骨|孟獲|孟優|曹仁|紀霊|龐徳|董卓|鶴爺|亀|虎|パンダ)/.test(head)) return SOLDIER_DEFS.HAMMER;
        if (/(?:趙雲|張飛|関羽|姜維|馬超|文醜|魏延|太史慈|周泰|孫策|呂蒙|于禁|楽進|程普|甘寧|関平|張苞|劉封|厳顔|王平)/.test(head)) return SOLDIER_DEFS.SPEAR;
        if (/(?:黄忠|夏侯淵|陸遜|周瑜|諸葛亮|龐統|司馬懿|徐庶|賈詡|荀攸|魯粛|呂布|孫尚香|凌操|黄月英|張春華|王元姫|辛憲英|王異|祝融)/.test(head)) return SOLDIER_DEFS.BOW;
        if (/(?:張遼|馬岱|曹洪|曹彰|夏侯惇|公孫瓚|馬騰|馬雲緑|顔良|高順|曹真|鄧艾|鍾会|文鴦|張繍|孫堅)/.test(head)) return SOLDIER_DEFS.CAV;
        return SOLDIER_DEFS.SWORD;
    }

    function normalizeSoldierType(rawType, card) {
        var cNo = card ? String(card.cardNo || card.card_no || '').trim() : '';
        var uId = card ? String(card.uniqueId || '').trim() : '';

        var manualKey = (uId && manualSoldierMap[uId]) || (cNo && manualSoldierMap[cNo]);
        if (manualKey && SOLDIER_DEFS[manualKey]) {
            return SOLDIER_DEFS[manualKey];
        }

        var explicit = parseExplicitSoldierString(rawType);
        if (explicit) return explicit;

        if (card) {
            var fieldCandidates = [card.soldierType, card.soldier_type, card.heika, card.unit_type, card.weapon_type, card.soldier];
            for (var fi = 0; fi < fieldCandidates.length; fi++) {
                var exp2 = parseExplicitSoldierString(fieldCandidates[fi]);
                if (exp2) return exp2;
            }
        }

        if (card && Array.isArray(card.skills)) {
            for (var i = 0; i < card.skills.length; i++) {
                var sk = card.skills[i];
                if (!sk) continue;
                var sName = String(sk.name || '').trim();
                var sDesc = String(sk.description || '').trim();
                if (sName.indexOf('副') === 0) continue;
                var hit = detectSoldierFromSkillText(sName + ' ' + sDesc);
                if (hit) return hit;
            }
        }

        return inferSoldierFromGeneralName(card && card.name);
    }

    var RARITY_ORDER = { 'SL': 7, 'L': 6, 'UR': 5, 'SR': 4, 'R': 3, 'UC': 2, 'C': 1 };
    var NUM_RARITY_MAP = { 7: 'SL', 6: 'L', 5: 'UR', 4: 'SR', 3: 'R', 2: 'UC', 1: 'C' };

    function safeNum(val, fallback) {
        if (val === undefined || val === null) return fallback || 0;
        if (typeof val === 'number') return isNaN(val) ? (fallback || 0) : val;
        var clean = String(val).replace(/,/g, '').trim();
        var n = parseFloat(clean);
        return isNaN(n) ? (fallback || 0) : n;
    }

    function formatBuffNum(num) {
        var rounded = Math.round((Number(num) || 0) * 10000) / 10000;
        return rounded.toLocaleString(undefined, { maximumFractionDigits: 4 });
    }

    function isHaBusho(card) {
        if (!card) return false;
        if (card.isHa) return true;
        var c = String(card.country || '');
        if (c === '覇') return true;
        var n = String(card.name || '');
        if (n.indexOf('×') !== -1 || n.indexOf('覇') !== -1) return true;
        var r = String(card.rarity || '');
        if (r.indexOf('覇') !== -1) return true;
        return false;
    }

    function isMirrorCard(name) {
        var n = String(name || '');
        return n.indexOf("水鏡") !== -1 || n.indexOf("水鏡娘") !== -1 || n.indexOf("南華老仙") !== -1 || n.indexOf("鑑") !== -1 || n.indexOf("鏡") !== -1;
    }

    function getGeneralCoreNames(name) {
        var clean = String(name || '').replace(/^(SL|L|UR|SR|R|UC|C|覇)\s*/i, '').trim();
        clean = clean.replace(/(\(|\[|【).*?(\)|\]|】)/g, '').trim();
        var parts = clean.split(/[×・\s]+/);
        return parts.map(function(p) { return String(p).trim(); }).filter(function(p) { return p.length > 0; });
    }

    function getGekireiBonus(skill, cardRarity, masterCost) {
        var name = String((skill && skill.name) || '');
        var desc = String((skill && skill.description) || '');
        var text = name + " " + desc;
        if (text.indexOf("檄令") === -1 && text.indexOf("主将の攻撃力が増加") === -1 && text.indexOf("全武将の攻撃力が増加") === -1) return { bonus: 0, series: null };

        var series = 'TENTEI';
        var seriesName = '天帝';
        if (text.indexOf("鬼神") !== -1 || name.indexOf("大檄令") !== -1) { series = 'KISHIN'; seriesName = '鬼神'; }
        else if (text.indexOf("龍神") !== -1 || text.indexOf("亀神") !== -1 || name.indexOf("神檄令") !== -1) { series = 'RYUJIN'; seriesName = text.indexOf("亀神") !== -1 ? '亀神' : '龍神'; }

        var r = String(cardRarity || 'SL').toUpperCase();
        if (name.indexOf("帝") !== -1) r = 'SL';
        else if (name.indexOf("天") !== -1) r = 'L';
        else if (name.indexOf("神") !== -1 && name.indexOf("龍神") === -1 && name.indexOf("亀神") === -1 && name.indexOf("鬼神") === -1) r = 'UR';
        else if (name.indexOf("大") !== -1 && name.indexOf("鬼神") === -1) r = 'SR';

        var c = Math.round((Number(masterCost) || 4.5) * 2) / 2;
        c = Math.max(1.0, Math.min(4.5, c));

        var table = (GEKIREI_TABLES[series] || GEKIREI_TABLES['TENTEI'])[r] || (GEKIREI_TABLES[series] || GEKIREI_TABLES['TENTEI'])['SL'];
        return { bonus: table[c] || 0, series: seriesName };
    }

    function getKakuseiMultiplier(card) {
        if (!card) return 1.0;
        var rawSkills = card.skills || [];
        var skills = Array.isArray(rawSkills) ? rawSkills : Object.values(rawSkills);
        for (var i = 0; i < skills.length; i++) {
            var s = skills[i];
            if (!s) continue;
            var sName = String(s.name || '').trim();
            var sDesc = String(s.description || '').trim();
            if (sName.indexOf('覚:') === 0 || sName.indexOf('副覚:') === 0 || sName.indexOf('覚醒') !== -1 || sDesc.indexOf('覚醒') !== -1) {
                var m = sDesc.match(/([0-9\.]+)倍/);
                return m ? parseFloat(m[1]) : 3.0;
            }
        }
        return 1.0;
    }

    function getAdjutantStatusEffect(fkCard, mirrorInfo) {
        if (!fkCard || typeof fkCard !== 'object') {
            return { job: '他', isBu: false, isGo: false, isEi: false, atkBonus: 0, defBonus: 0, spdBonus: 0, statRate: 0, copyRate: 0, rawAtk: 0, rawDef: 0, rawSpd: 15 };
        }
        var r = String((mirrorInfo && mirrorInfo.rarity) || fkCard.rarity || 'C').toUpperCase();
        if (!RARITY_ORDER[r]) r = 'C';

        var isRenkyoOrSenkyo = Boolean(mirrorInfo && (mirrorInfo.type === 'renkyo' || mirrorInfo.type === 'senkyo' || mirrorInfo.type === 'musume_renkyo'));
        var isMirror = Boolean(mirrorInfo && mirrorInfo.type);
        
        var copyRate = mirrorInfo && mirrorInfo.rate ? safeNum(mirrorInfo.rate, 0) : (isRenkyoOrSenkyo ? (ADJUTANT_RATES.RENKYO_ALL[r] || 100) : (ADJUTANT_RATES.NORMAL_SKILL[r] || 0));
        var buGoRate = isRenkyoOrSenkyo ? (ADJUTANT_RATES.RENKYO_ALL[r] || 100) : (ADJUTANT_RATES.NORMAL_BU_GO[r] || 5);
        var eiHakuRate = isRenkyoOrSenkyo ? (ADJUTANT_RATES.RENKYO_ALL[r] || 100) : (ADJUTANT_RATES.NORMAL_EI_HAKU[r] || 10);

        var rawAtk = safeNum(fkCard.baseAttack !== undefined ? fkCard.baseAttack : fkCard.attack, 0);
        var rawDef = safeNum(fkCard.baseDefense !== undefined ? fkCard.baseDefense : fkCard.defense, 0);
        var rawInt = safeNum(fkCard.intelligence, 0);
        var rawSpd = safeNum(fkCard.speed !== undefined ? fkCard.speed : (fkCard.move_speed !== undefined ? fkCard.move_speed : 15), 15);

        var explicitJob = String(fkCard.job || fkCard.adjutantType || fkCard.specialty || '').trim();
        var job = '護';
        var isBu = false;
        var isGo = false;
        var isEi = false;
        
        if (explicitJob === '鋭') {
            job = '鋭';
            isEi = true;
        } else if (explicitJob === '武' || rawAtk >= 5000) {
            job = '武';
            isBu = true;
        } else if (explicitJob === '護' || rawDef >= 5000) {
            job = '護';
            isGo = true;
        } else if (explicitJob === '博' || rawInt >= 50) {
            job = '博';
        } else {
            job = '鋭';
            isEi = true;
        }

        var atkBonus = Math.floor(rawAtk * (buGoRate / 100));
        var defBonus = Math.floor(rawDef * (buGoRate / 100));
        var spdBonus = (job === '鋭') ? Math.round(rawSpd * (eiHakuRate / 100) * 10) / 10 : 0;

        return {
            job: job,
            isBu: isBu,
            isGo: isGo,
            isEi: isEi,
            atkBonus: atkBonus,
            defBonus: defBonus,
            spdBonus: spdBonus,
            statRate: (job === '博' || job === '鋭') ? eiHakuRate : buGoRate,
            buStatRate: buGoRate,
            copyRate: copyRate,
            rawAtk: rawAtk,
            rawDef: rawDef,
            rawSpd: rawSpd,
            isMirror: isMirror
        };
    }

    function getMirrorSkillInfo(card) {
        if (!card || typeof card !== 'object' || isHaBusho(card)) return null;
        var name = String(card.name || '');
        var skills = card.skills || [];
        var sName = skills.length > 0 && skills[0] ? String(skills[0].name || '').trim() : String(card.skill_name || card.skill || card.label || '').trim();
        var sDesc = skills.length > 0 && skills[0] ? String(skills[0].description || '').trim() : String(card.skill_desc || card.description || '').trim();
        var sText = sName + " " + sDesc;

        // 1. 帝仙鏡
        if (sName.indexOf("帝仙鏡") !== -1 || (sName.indexOf("仙鏡") !== -1 && sName.indexOf("帝") !== -1) || (sDesc.indexOf("帝仙鏡") !== -1 && sName.indexOf("副将") !== -1)) {
            var stSen = getAdjutantStatusEffect(card, { type: 'senkyo', rarity: 'SL', rate: 100 });
            return {
                type: "senkyo", rarity: "SL", force: "ALL", rate: 100,
                statRate: 100, job: stSen.job, isBu: stSen.isBu, isGo: stSen.isGo, isEi: stSen.isEi, atkBonus: stSen.atkBonus, defBonus: stSen.defBonus, spdBonus: stSen.spdBonus,
                label: (stSen.isBu ? "[武]" : stSen.isGo ? "[護]" : stSen.isEi ? "[鋭]" : "") + "帝仙鏡 100% [主将C1化]", makeCost1: true
            };
        }

        // 2. 娘将の〇〇錬鏡
        var mMusume = sName.match(/娘将の(帝|天|神|大)?錬鏡/) || sText.match(/娘将の(帝|天|神|大)?錬鏡/);
        if (mMusume) {
            var rCharM = mMusume[1];
            var rM = 'R', rateM = 50;
            if (rCharM === '帝') { rM = 'SL'; rateM = 100; }
            else if (rCharM === '天') { rM = 'L'; rateM = 85; }
            else if (rCharM === '神') { rM = 'UR'; rateM = 70; }
            else if (rCharM === '大') { rM = 'SR'; rateM = 60; }
            var stMusume = getAdjutantStatusEffect(card, { type: 'musume_renkyo', rarity: rM, rate: rateM });
            return {
                type: "musume_renkyo", rarity: rM, force: "FEMALE_OTHER", rate: rateM,
                statRate: rateM, job: stMusume.job, isBu: stMusume.isBu, isGo: stMusume.isGo, isEi: stMusume.isEi, atkBonus: stMusume.atkBonus, defBonus: stMusume.defBonus, spdBonus: stMusume.spdBonus,
                label: (stMusume.isBu ? "[武]" : stMusume.isGo ? "[護]" : stMusume.isEi ? "[鋭]" : "") + "娘錬鏡 " + rateM + "%", makeCost1: false
            };
        }

        // 3. 勢力別錬鏡（蜀・魏・呉・群・他）
        var mRen = sName.match(/(蜀|魏|呉|群|他)将の(帝|天|神|大)?錬鏡/) || sText.match(/(蜀|魏|呉|群|他)将の(帝|天|神|大)?錬鏡/);
        if (mRen) {
            var fChar = mRen[1];
            var force = fChar === '群' ? '他' : fChar;
            var rChar = mRen[2];
            var r = 'R', rate = 50;
            if (rChar === '帝') { r = 'SL'; rate = 100; }
            else if (rChar === '天') { r = 'L'; rate = 85; }
            else if (rChar === '神') { r = 'UR'; rate = 70; }
            else if (rChar === '大') { r = 'SR'; rate = 60; }
            var stRen = getAdjutantStatusEffect(card, { type: 'renkyo', rarity: r, rate: rate });
            return {
                type: "renkyo", rarity: r, force: force, rate: rate,
                statRate: rate, job: stRen.job, isBu: stRen.isBu, isGo: stRen.isGo, isEi: stRen.isEi, atkBonus: stRen.atkBonus, defBonus: stRen.defBonus, spdBonus: stRen.spdBonus,
                label: (stRen.isBu ? "[武]" : stRen.isGo ? "[護]" : stRen.isEi ? "[鋭]" : "") + fChar + "錬鏡 " + rate + "%", makeCost1: false
            };
        }

        // 4. 明鏡（帝・天・神・大・通常）
        var mMei = sName.match(/(?:副将の)?(帝|天|神|大)?明鏡/) || sText.match(/(?:副将の)?(帝|天|神|大)?明鏡/);
        if (mMei) {
            var rChar2 = mMei[1];
            var r2 = 'R', rate2 = 40;
            if (rChar2 === '帝') { r2 = 'SL'; rate2 = 80; }
            else if (rChar2 === '天') { r2 = 'L'; rate2 = 70; }
            else if (rChar2 === '神') { r2 = 'UR'; rate2 = 60; }
            else if (rChar2 === '大') { r2 = 'SR'; rate2 = 50; }
            var stMei = getAdjutantStatusEffect(card, { type: 'meikyo', rarity: r2, rate: rate2 });
            return {
                type: "meikyo", rarity: r2, force: "ALL", rate: rate2,
                statRate: stMei.statRate, job: stMei.job, isBu: stMei.isBu, isGo: stMei.isGo, isEi: stMei.isEi, atkBonus: stMei.atkBonus, defBonus: stMei.defBonus, spdBonus: stMei.spdBonus,
                label: (stMei.isBu ? "[武]" : stMei.isGo ? "[護]" : stMei.isEi ? "[鋭]" : "") + (rChar2 || '') + "明鏡 " + rate2 + "%", makeCost1: false
            };
        }

        if (isMirrorCard(name) || card.isAdjutant) {
            if (sName && sText.indexOf("明鏡") === -1 && sText.indexOf("錬鏡") === -1 && sText.indexOf("仙鏡") === -1 && sText.indexOf("コピー") === -1 && sText.indexOf("主将の") === -1) return null;
            var rawR = card.rarity || card.rare || card.rank;
            var cardR = 'SL';
            if (rawR && RARITY_ORDER[String(rawR).trim().toUpperCase()]) cardR = String(rawR).trim().toUpperCase();
            else {
                var mN = name.match(/^(SL|L|UR|SR|R|UC|C)(?![a-zA-Z0-9])/i);
                if (mN) cardR = mN[1].toUpperCase();
            }
            var rate3 = ADJUTANT_RATES.NORMAL_SKILL[cardR] || 80;
            var prefix = cardR === 'SL' ? '帝' : cardR === 'L' ? '天' : cardR === 'UR' ? '神' : '大';
            var stMei2 = getAdjutantStatusEffect(card, { type: 'meikyo', rarity: cardR, rate: rate3 });
            return {
                type: "meikyo", rarity: cardR, force: "ALL", rate: rate3,
                statRate: stMei2.statRate, job: stMei2.job, isBu: stMei2.isBu, isGo: stMei2.isGo, isEi: stMei2.isEi, atkBonus: stMei2.atkBonus, defBonus: stMei2.defBonus, spdBonus: stMei2.spdBonus,
                label: (stMei2.isBu ? "[武]" : stMei2.isGo ? "[護]" : stMei2.isEi ? "[鋭]" : "") + prefix + "明鏡 " + rate3 + "%", makeCost1: false
            };
        }
        return null;
    }

    function checkAdjutantEligibility(masterCard, fkCard, mirrorInfo, usedAdjutantCost) {
        if (!masterCard || !fkCard) return { ok: false, rate: 0 };
        var mRarity = String(masterCard.rarity || 'SL').toUpperCase();
        var fkRarity = String(fkCard.rarity || 'C').toUpperCase();
        var mOrigCost = safeNum(masterCard.originalCost !== undefined ? masterCard.originalCost : masterCard.cost, 4.5);
        var fkCost = safeNum(fkCard.cost, 0);
        var maxFkCost = safeNum(masterCard.maxFukushoCost, 0);
        var curUsedCost = safeNum(usedAdjutantCost, 0);
        var mCountry = String(masterCard.country || '').trim();

        var mRarityVal = RARITY_ORDER[mRarity] || 1;
        var fkRarityVal = RARITY_ORDER[fkRarity] || 1;

        if (fkRarityVal > mRarityVal) return { ok: false, rate: 0 };
        if (fkCost > mOrigCost + 1e-6) return { ok: false, rate: 0 };
        if (curUsedCost + fkCost > maxFkCost + 1e-6) return { ok: false, rate: 0 };

        var st = getAdjutantStatusEffect(fkCard, mirrorInfo);

        if (mirrorInfo) {
            if (String(mirrorInfo.rarity || 'SL').toUpperCase() !== mRarity) return { ok: false, rate: 0 };
            var buBonusScore = st.atkBonus * 2;
            var effRate = calcAdjutantEffectiveCopyRate(masterCard, fkCard, mirrorInfo);

            if (mirrorInfo.type === 'senkyo') {
                if (mRarity !== 'SL') return { ok: false, rate: 0 };
                return { ok: true, rate: effRate, atkBonus: st.atkBonus, defBonus: st.defBonus, spdBonus: st.spdBonus, statRate: 100, job: st.job, isBu: st.isBu, isGo: st.isGo, isEi: st.isEi, label: mirrorInfo.label, score: 500000 + buBonusScore + mOrigCost * 10000 };
            } else if (mirrorInfo.type === 'musume_renkyo') {
                if (isFemaleOrOtherBusho(masterCard)) {
                    return { ok: true, rate: effRate, atkBonus: st.atkBonus, defBonus: st.defBonus, spdBonus: st.spdBonus, statRate: safeNum(mirrorInfo.rate, 100), job: st.job, isBu: st.isBu, isGo: st.isGo, isEi: st.isEi, label: mirrorInfo.label, score: 300000 + buBonusScore + effRate * 1000 };
                }
                return { ok: false, rate: 0 };
            } else if (mirrorInfo.type === 'renkyo') {
                if (mCountry && mCountry !== '改' && mCountry === mirrorInfo.force) {
                    return { ok: true, rate: effRate, atkBonus: st.atkBonus, defBonus: st.defBonus, spdBonus: st.spdBonus, statRate: safeNum(mirrorInfo.rate, 100), job: st.job, isBu: st.isBu, isGo: st.isGo, isEi: st.isEi, label: mirrorInfo.label, score: 300000 + buBonusScore + effRate * 1000 };
                }
                return { ok: false, rate: 0 };
            } else if (mirrorInfo.type === 'meikyo') {
                return { ok: true, rate: effRate, atkBonus: st.atkBonus, defBonus: st.defBonus, spdBonus: st.spdBonus, statRate: st.statRate, job: st.job, isBu: st.isBu, isGo: st.isGo, isEi: st.isEi, label: mirrorInfo.label, score: 100000 + buBonusScore + effRate * 1000 };
            }
        } else {
            return { ok: true, rate: 0, atkBonus: st.atkBonus, defBonus: st.defBonus, spdBonus: st.spdBonus, statRate: st.statRate, job: st.job, isBu: st.isBu, isGo: st.isGo, isEi: st.isEi, label: '一般副将', score: 10000 + (st.spdBonus * 50) + (st.atkBonus * 2) };
        }
        return { ok: false, rate: 0 };
    }

    // =========================================================================
    // 【SL 2枚ペア最適化】1枚単体 vs 2枚ペアの合計実効威力を比較して最良コンボを選出
    // 例：2コスSL主将(上限2.0C)なら「2コス錬鏡1枚(100%)」と「1コス帝明鏡2枚(80%+80%=160%)」を比較し、強い方を選ぶ
    // =========================================================================
    function findBestAdjutantCombo(masterCard, mirrorPool, fixedAdjutants, usedAdjutantCost, opts) {
        if (!masterCard || isHaBusho(masterCard)) return [];
        var maxFkCost = safeNum(masterCard.maxFukushoCost, 0);
        if (maxFkCost <= 0) return [];

        var mRarity = String(masterCard.rarity || 'SL').toUpperCase();
        var maxSlots = (mRarity === 'SL') ? 2 : 1;
        var fixedList = Array.isArray(fixedAdjutants) ? fixedAdjutants : [];
        var remSlots = maxSlots - fixedList.length;
        var remMaxCost = maxFkCost - safeNum(usedAdjutantCost, 0);
        if (remSlots <= 0 || remMaxCost <= 0) return [];

        opts = opts || {};
        var allowSameName = Boolean(opts.allowSameName);
        var disallowSenkyo = Boolean(opts.disallowSenkyo);
        var baseCopyT = safeNum(opts.baseCopyT, 0);
        var baseCopyG = safeNum(opts.baseCopyG, 0);
        var baseCopyRaw = safeNum(opts.baseCopyRaw, 0);
        var wTroop = safeNum(opts.wTroop, 0);
        var wGen = safeNum(opts.wGen, 0);
        var wRaw = safeNum(opts.wRaw, 0);
        var wAtk = safeNum(opts.wAtk, 0);
        var wDef = safeNum(opts.wDef, 0);
        var wSpd = safeNum(opts.wSpd, 0);

        var mOrigCost = safeNum(masterCard.originalCost !== undefined ? masterCard.originalCost : masterCard.cost, 4.5);
        var mCoreNames = getGeneralCoreNames(masterCard.name);

        var buildCandidate = function(rawItem, isGeneral) {
            var fkCard = rawItem.card || rawItem;
            var inf = isGeneral ? null : (rawItem.info || getMirrorSkillInfo(fkCard));
            var fkCost = safeNum(fkCard.cost, 0);
            if (fkCost > remMaxCost + 1e-6 || fkCost > mOrigCost + 1e-6) return null;

            var elig = checkAdjutantEligibility(masterCard, fkCard, inf, usedAdjutantCost);
            if (!elig.ok) return null;
            if (inf && inf.type === 'senkyo' && disallowSenkyo) return null;

            if (!allowSameName) {
                if (!isMirrorCard(fkCard.name) && !isMirrorCard(masterCard.name)) {
                    var fkCoreNames = getGeneralCoreNames(fkCard.name);
                    if (mCoreNames.some(function(mn) { return fkCoreNames.indexOf(mn) !== -1; })) return null;
                }
                if (fixedList.some(function(ex) { return ex && ex.name === fkCard.name; })) return null;
            }

            var effRate = inf ? safeNum(elig.rate, 0) : 0;
            var ratio = effRate / 100;
            var skillGain = (baseCopyT * ratio) * wTroop + (baseCopyG * ratio) * wGen + (baseCopyRaw * ratio) * wRaw;
            if (skillGain <= 0 && effRate > 0) {
                skillGain = effRate * 1000;
            }
            var statGain = safeNum(elig.atkBonus, 0) * wAtk + safeNum(elig.defBonus, 0) * wDef + safeNum(elig.spdBonus, 0) * wSpd;
            var senkyoBonus = (inf && inf.type === 'senkyo') ? 50000000 : 0;
            var genSlotBonus = isGeneral ? 500 : 0;

            var dispLabel = inf ? elig.label : ((elig.isBu ? '[武]' : elig.isEi ? '[鋭]' : '') + '一般副将');
            if (inf && inf.type === 'meikyo' && Math.abs(effRate - safeNum(inf.rate, 80)) > 0.05) {
                dispLabel = inf.label + '→' + (Math.round(effRate * 10) / 10) + '%';
            }

            return {
                uniqueId: String(rawItem.uniqueId || fkCard.uniqueId || ''),
                cardNo: String(rawItem.cardNo || fkCard.cardNo || ''),
                name: fkCard.name || '副将',
                imageSrc: fkCard.imageSrc || (fkCard.cardNo ? 'https://3gokushi.jp/img/card/card_' + fkCard.cardNo + '.jpg' : ''),
                rarity: inf ? inf.rarity : String(fkCard.rarity || mRarity).toUpperCase(),
                cost: fkCost,
                baseAttack: safeNum(fkCard.baseAttack, 0),
                baseDefense: safeNum(fkCard.baseDefense, 0),
                speed: safeNum(fkCard.speed, 15),
                atkBonus: safeNum(elig.atkBonus, 0),
                defBonus: safeNum(elig.defBonus, 0),
                spdBonus: safeNum(elig.spdBonus, 0),
                label: dispLabel,
                copyRate: effRate,
                info: inf,
                gain: skillGain + statGain + senkyoBonus + genSlotBonus
            };
        };

        var validList = [];
        for (var i = 0; i < mirrorPool.length; i++) {
            var cand = buildCandidate(mirrorPool[i], false);
            if (cand && cand.gain > 0) validList.push(cand);
        }
        if (Array.isArray(opts.generalPool)) {
            for (var gi = 0; gi < opts.generalPool.length; gi++) {
                var gCand = buildCandidate(opts.generalPool[gi], true);
                if (gCand && gCand.gain > 0) validList.push(gCand);
            }
        }
        if (validList.length === 0) return [];

        validList.sort(function(a, b) { return b.gain - a.gain; });
        var topCands = validList.slice(0, Math.min(30, validList.length));

        var bestCombo = [topCands[0]];
        var bestTotalGain = topCands[0].gain;

        if (remSlots >= 2 && topCands.length >= 2) {
            for (var a = 0; a < topCands.length; a++) {
                var c1 = topCands[a];
                for (var b = a + 1; b < topCands.length; b++) {
                    var c2 = topCands[b];
                    if (c1.uniqueId && c1.uniqueId === c2.uniqueId) continue;
                    if (!allowSameName) {
                        if (c1.cardNo && c1.cardNo === c2.cardNo) continue;
                        if (c1.name === c2.name) continue;
                    }
                    if (c1.cost + c2.cost > remMaxCost + 1e-6) continue;

                    var pairGain = c1.gain + c2.gain;
                    if (pairGain > bestTotalGain + 1e-6) {
                        bestTotalGain = pairGain;
                        bestCombo = [c1, c2];
                    }
                }
            }
        }

        return bestCombo;
    }

    function solveKnapsackDP(capacity, items) {
        if (capacity <= 0 || !items || items.length === 0) return { val: 0, picked: [] };
        var capInt = Math.max(0, Math.floor(Math.round(capacity * 2)));
        var dp = new Float64Array(capInt + 1);
        var choice = new Array(capInt + 1);
        for (var i = 0; i <= capInt; i++) choice[i] = [];

        for (var idx = 0; idx < items.length; idx++) {
            var item = items[idx];
            var costVal = safeNum(item.card ? item.card.cost : item.cost, 1.0);
            var wInt = Math.max(1, Math.round(costVal * 2));
            var v = safeNum(item.tMult || item.gMult, 0);
            if (wInt > capInt) continue;

            for (var w = capInt; w >= wInt; w--) {
                if (dp[w - wInt] + v > dp[w]) {
                    dp[w] = dp[w - wInt] + v;
                    choice[w] = choice[w - wInt].concat(item);
                }
            }
        }
        var bestW = 0, bestVal = 0;
        for (var w = 0; w <= capInt; w++) {
            if (dp[w] > bestVal) { bestVal = dp[w]; bestW = w; }
        }
        return { val: bestVal, picked: choice[bestW] || [] };
    }

    var DEMO_CARDS = [
        {
            uniqueId: 'demo_1', cardNo: '4579', name: '呂布', rarity: 'SL', level: 400, cost: 4.5,
            soldierType: '騎兵', attack: 55000, baseAttack: 55000, defense: 12000, intelligence: 15, speed: 22,
            maxFukushoCost: 9,
            skills: [{ name: '攻:神威LV10', description: '武将の攻撃力が2700%上昇する コストにより変動' }]
        },
        {
            uniqueId: 'demo_2', cardNo: '6021', name: '趙雲', rarity: 'SL', level: 400, cost: 4.5,
            soldierType: '双兵', attack: 920, baseAttack: 920, defense: 850, intelligence: 22, speed: 24,
            maxFukushoCost: 9,
            skills: [{ name: '防:帝軍の王威令LV10', description: '自拠点から出兵する全ての兵士、武将の戦闘時に、攻撃力が465.3％上昇する 自動で発動 コストにより大きく変動' }]
        }
    ];

    return {
        GEKIREI_TABLES: GEKIREI_TABLES,
        TROOP_DATA: TROOP_DATA,
        DEF_TROOP_DATA: DEF_TROOP_DATA,
        ADJUTANT_RATES: ADJUTANT_RATES,
        MASTER_MEIKYO_LV_RATES: MASTER_MEIKYO_LV_RATES,
        DEMO_CARDS: DEMO_CARDS,
        RARITY_ORDER: RARITY_ORDER,
        NUM_RARITY_MAP: NUM_RARITY_MAP,
        safeNum: safeNum,
        formatBuffNum: formatBuffNum,
        isHaBusho: isHaBusho,
        isMirrorCard: isMirrorCard,
        isFemaleOrOtherBusho: isFemaleOrOtherBusho,
        getMasterMirrorCopyRate: getMasterMirrorCopyRate,
        calcCostAdjustedRatio: calcCostAdjustedRatio,
        calcAdjutantEffectiveCopyRate: calcAdjutantEffectiveCopyRate,
        getGeneralCoreNames: getGeneralCoreNames,
        getGekireiBonus: getGekireiBonus,
        getKakuseiMultiplier: getKakuseiMultiplier,
        getAdjutantStatusEffect: getAdjutantStatusEffect,
        getMirrorSkillInfo: getMirrorSkillInfo,
        checkAdjutantEligibility: checkAdjutantEligibility,
        findBestAdjutantCombo: findBestAdjutantCombo,
        solveKnapsackDP: solveKnapsackDP,
        normalizeSoldierType: normalizeSoldierType,
        setManualSoldierType: setManualSoldierType
    };
})();