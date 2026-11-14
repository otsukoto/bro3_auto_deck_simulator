// @version 1.0
// ========================================================
// 【エンジン 1】単騎火力 計算・最適化ロジック
// ========================================================
window.SoloEngine = (function() {
    var isBuff10 = false;
    var isGoEnabled = true;
    var goBuffValue = 7000;
    var adjutantMode = 'REASSIGN_ALL';
    var currentSetup = null;
    var selectedSoldierFilter = null;
    var SOLDIER_ORDER = ['HAMMER', 'DOUBLE', 'AXE', 'BOW', 'SPEAR', 'CAV', 'SWORD'];
    var SOLDIER_META = {
        'HAMMER': { label: '錘兵エース', short: '錘兵', badgeColor: 'bg-sky-600 text-white' },
        'DOUBLE': { label: '双兵エース', short: '双兵', badgeColor: 'bg-fuchsia-600 text-white' },
        'AXE':    { label: '斧兵エース', short: '斧兵', badgeColor: 'bg-orange-600 text-white' },
        'BOW':    { label: '弓兵エース', short: '弓兵', badgeColor: 'bg-blue-600 text-white' },
        'SPEAR':  { label: '槍兵エース', short: '槍兵', badgeColor: 'bg-emerald-600 text-white' },
        'CAV':    { label: '騎兵エース', short: '騎兵', badgeColor: 'bg-amber-600 text-black' },
        'SWORD':  { label: '剣兵エース', short: '剣兵', badgeColor: 'bg-teal-600 text-white' }
    };

    function formatMirrorLabelWithCost(inf, effRate) {
        if (!inf) return '';
        if (inf.type === 'meikyo' && Math.abs(effRate - SharedDB.safeNum(inf.rate, 80)) > 0.05) {
            return inf.label + '→' + (Math.round(effRate * 10) / 10) + '%';
        }
        return inf.label;
    }

    function isDuelSkill(skill) {
        if (!skill || typeof skill !== 'object') return false;
        var name = String(skill.name || '').trim();
        var desc = String(skill.description || '').trim();
        return name.indexOf('ﾃﾞｭｴﾙ') !== -1 || name.indexOf('デュエル') !== -1 ||
               desc.indexOf('デュエルと一部イベントで発動') !== -1 ||
               desc.indexOf('デュエル専用') !== -1 || desc.indexOf('デュエルでのみ') !== -1;
    }

    function syncSoldierFilterButtons(activeKey) {
        for (var i = 0; i < SOLDIER_ORDER.length; i++) {
            var btn = document.getElementById('btnSoloSoldier_' + SOLDIER_ORDER[i]);
            if (!btn) continue;
            if (SOLDIER_ORDER[i] === activeKey) {
                btn.className = "py-1.5 text-xs font-bold rounded-lg transition bg-gradient-to-r from-red-600 to-amber-600 text-white shadow cursor-pointer";
            } else {
                btn.className = "py-1.5 text-xs font-bold rounded-lg transition text-gray-400 hover:text-white cursor-pointer";
            }
        }
        var lbl = document.getElementById('labelSoloSoldierStatus');
        if (lbl && SOLDIER_META[activeKey]) {
            lbl.textContent = SOLDIER_META[activeKey].label;
        }
    }

    function parseSkill(skill, weatherObj) {
        var empty = { gMult: 0, leadBuff: 0, rawAdd: 0, isGekirei: false, isPassive: false, isGuard: false, mustBeSameBase: false, isShurei: false, isLead: false, isSupport: false };
        if (!skill || typeof skill !== 'object') return empty;
        var name = String(skill.name || "").trim();
        var rawDesc = String(skill.description || "").trim();
        var desc = (rawDesc + " " + name).trim();
        if (!desc) return empty;

        if (name.indexOf("覚:") === 0 || name.indexOf("副覚:") === 0 || name.indexOf("覚醒") !== -1) return empty;
        if (isDuelSkill(skill)) return empty;

        var res = Object.assign({}, empty);
        var normRawDesc = rawDesc.replace(/(\d),(\d{3})/g, '$1$2');
        var normDesc = (normRawDesc + " " + name).trim();

        var isAttackSkill = (name.indexOf("攻:") === 0 || name.indexOf("副攻:") === 0 || name.indexOf("攻防:") === 0 || name.indexOf("副攻防:") === 0);
        var isDefenseSkill = (name.indexOf("防:") === 0 || name.indexOf("副防:") === 0);

        if (normDesc.indexOf("自動で発動") !== -1 || normDesc.indexOf("自動発動") !== -1 || normDesc.indexOf("全滅時も発動") !== -1 || normDesc.indexOf("パッシブ") !== -1) res.isPassive = true;
        if (normDesc.indexOf("警護デッキ") !== -1 || name.indexOf("警悟") !== -1 || normDesc.indexOf("警悟") !== -1) { res.isGuard = true; res.isPassive = true; }
        if (name.indexOf("檄令") !== -1 || normDesc.indexOf("主将の攻撃力が増加") !== -1 || normDesc.indexOf("全武将の攻撃力が増加") !== -1) { res.isGekirei = true; res.isPassive = true; res.isSupport = true; }

        var isSelfOnly = isAttackSkill || (
            /(?:進攻|突撃|強襲|遼来撃|猛撃|豪撃|極撃|天撃|神撃|帝撃|龍撃|覇撃|烈撃|雷光|神速|飛将|闘将|騎将|槍将|弓将|攻城|破砕|衝車|劫略|撃破|一騎当千|覇道|滅亡|武神|闘神|軍神)/.test(name) ||
            /(?:自身の攻撃力|この武将の攻撃力|全滅時も発動|討伐ゲージ|持ち帰る資源)/.test(normDesc)
        );

        var isTrueSupportAura = !isAttackSkill && (
            /(?:自拠点|セットした拠点|この武将をセットした拠点).*?(?:出兵|出撃|戦闘時).*?(?:全武将|全兵士|全ての武将|すべての武将|全ての兵士|すべての兵士|全軍)/.test(normDesc) ||
            /(?:全拠点|すべての拠点|全ての拠点|全軍).*?(?:出兵|出撃|戦闘時)?.*?(?:全武将|全ての武将|すべての武将|全軍).*?(?:自動で発動|自動発動|パッシブ)/.test(normDesc) ||
            /(?:自拠点|セットした拠点).*?(?:全武将|すべての武将|全ての武将|全兵士|すべての兵士|全ての兵士|全軍).*?攻撃/.test(normDesc) ||
            /(?:勅令|襲令|斗魂令)/.test(name)
        ) && !isSelfOnly;

        var isGlobalAura = /(?:全拠点|全ての拠点|すべての拠点|自拠点.*?(?:出兵|出撃))/.test(normDesc);
        if (!isGlobalAura || normDesc.indexOf("セットした拠点") !== -1 || normDesc.indexOf("この武将をセットした拠点") !== -1) res.mustBeSameBase = true;

        var wMult = 1.0;
        var mSun = normDesc.match(/晴天候時(?:は|の時)?.*?([0-9\.]+)倍/);
        if (mSun && weatherObj === 'SUN') wMult = Math.max(wMult, parseFloat(mSun[1]));
        var mBad = normDesc.match(/(?:荒天時|曇[、・\s]*雨[、・\s]*雪天候時)(?:は|の時)?.*?([0-9\.]+)倍/);
        if (mBad && ['CLOUD', 'RAIN', 'SNOW'].indexOf(weatherObj) !== -1) wMult = Math.max(wMult, parseFloat(mBad[1]));

        var val = 0;
        var m1 = normRawDesc.match(/(?:全武将|[^\s、。・]*?科武将|武将|自身).*?攻撃(?:力)?[がをのは]?([0-9\.]+)[%％]/);
        if (m1) {
            val = parseFloat(m1[1]);
        } else {
            var m2 = normRawDesc.match(/(?:兵士|軍|兵科|全兵)[、，・,\/\s]+(?:[^\s、。]+科)?武将.*?攻撃(?:力)?[がをのは]?([0-9\.]+)[%％]/);
            if (m2) {
                val = parseFloat(m2[1]);
            } else {
                var m3 = normRawDesc.match(/(?:全軍|全拠点).*?攻撃(?:力)?[がをのは]?([0-9\.]+)[%％]/);
                if (m3 && normRawDesc.indexOf("兵を除く") === -1) {
                    val = parseFloat(m3[1]);
                } else if (isAttackSkill) {
                    var m4 = normRawDesc.match(/攻撃(?:力)?[がをのは]?([0-9\.]+)[%％]/);
                    if (m4) val = parseFloat(m4[1]);
                }
            }
        }

        var mExtra = normRawDesc.match(/更に.*?攻撃(?:力)?[がをのは]?([0-9\.]+)[%％]/);
        if (mExtra) {
            var extraV = parseFloat(mExtra[1]);
            if (normRawDesc.indexOf("晴天候") !== -1) {
                if (weatherObj === 'SUN') val += extraV;
            } else if (normRawDesc.indexOf("曇") !== -1 || normRawDesc.indexOf("雨") !== -1 || normRawDesc.indexOf("雪") !== -1 || normRawDesc.indexOf("荒天") !== -1) {
                if (['CLOUD', 'RAIN', 'SNOW'].indexOf(weatherObj) !== -1) val += extraV;
            } else {
                val += extraV;
            }
        }

        var effectiveVal = val * wMult;

        if (isSelfOnly) { res.isLead = true; res.leadBuff = effectiveVal; res.gMult = 0; res.isSupport = false; }
        else if (isTrueSupportAura || res.isGekirei) {
            res.isSupport = true; res.gMult = effectiveVal; res.leadBuff = effectiveVal;
            if (isDefenseSkill && !res.isPassive && (normDesc.indexOf("セットした拠点") !== -1 || normDesc.indexOf("この武将をセットした拠点") !== -1)) res.isShurei = true;
        } else if (name.indexOf("変:") === 0 || name.indexOf("副変:") === 0) {
            res.isSupport = true; res.gMult = effectiveVal; res.leadBuff = effectiveVal;
        } else { res.isLead = true; res.leadBuff = effectiveVal; res.gMult = 0; res.isSupport = false; }

        return res;
    }

    function evaluateCard(card, weatherObj, mode, masterCost) {
        var skills = (card && card.skills) || [];
        if (skills.length === 0) return { gMult: 0, rawAdd: 0, firstRawAdd: 0, firstGMult: 0, isPassive: false, isGuard: false, isActive: false, mustBeSameBase: false, isShurei: false, isGekirei: false, series: null };

        var isHa = SharedDB.isHaBusho(card);
        var firstSkill = skills[0];
        var firstGk = (!isDuelSkill(firstSkill)) ? SharedDB.getGekireiBonus(firstSkill, card.rarity, masterCost) : { bonus: 0, series: null };
        var isGekirei = (firstGk && firstGk.bonus > 0);
        var baseGkBonus = isGekirei ? firstGk.bonus : 0;
        var seriesName = isGekirei ? firstGk.series : null;

        var p0 = parseSkill(firstSkill, weatherObj);
        var firstVal = (mode === 'lead') ? (p0.leadBuff || 0) : (p0.gMult || 0);

        var passiveRawAdd = baseGkBonus;
        var passiveBuffSum = 0;
        var activeCandidates = []; // 主将自身のアクティブスキル（覇以外は最大1つのみ発動）
        var hasPassive = p0.isPassive;
        var isGuardCard = p0.isGuard;
        var mustBeSameBase = p0.mustBeSameBase;

        if (!isGekirei && firstVal > 0) {
            if (p0.isPassive) {
                passiveBuffSum += firstVal;
                hasPassive = true;
            } else {
                activeCandidates.push({ val: firstVal, isShurei: p0.isShurei, mustBeSameBase: p0.mustBeSameBase });
            }
        }

        for (var i = 1; i < skills.length; i++) {
            var s = skills[i];
            if (!s) continue;
            var sName = String(s.name || '').trim();
            var sDesc = String(s.description || '').trim();

            if (sName.indexOf("覚:") === 0 || sName.indexOf("副覚:") === 0 || sName.indexOf("覚醒") !== -1) continue;
            if (isDuelSkill(s)) continue;

            var isFromAdjutant = (sName.indexOf("副:") === 0 || sName.indexOf("副変:") === 0 || sName.indexOf("副攻:") === 0 || sName.indexOf("副防:") === 0 || sName.indexOf("副ﾃﾞｭｴﾙ:") === 0);
            if (!isHa && isFromAdjutant) continue;

            // 主将自身の明鏡（パッシブ扱い：1枠目スキルをレベル別コピー率で自動発動）
            var isShujoMirror = !isFromAdjutant && (
                sName.indexOf("主将の") !== -1 ||
                sName.indexOf("明鑑") !== -1 ||
                sName.indexOf("王春の") !== -1 ||
                (sName.indexOf("明鏡") !== -1 && sName.indexOf("副将の") === -1) ||
                sName.indexOf("変:") === 0 ||
                (isHa && sName.indexOf("副変:") === 0)
            );

            if (isShujoMirror) {
                var pi = parseSkill(s, weatherObj);
                var writtenVal = (mode === 'lead') ? (pi.leadBuff || 0) : (pi.gMult || 0);
                if (writtenVal > 0) {
                    passiveBuffSum += writtenVal;
                } else {
                    var copyRateRatio = SharedDB.getMasterMirrorCopyRate(s);
                    if (isGekirei && baseGkBonus > 0) passiveRawAdd += Math.floor(baseGkBonus * copyRateRatio);
                    else if (firstVal > 0) passiveBuffSum += firstVal * copyRateRatio;
                }
                hasPassive = true;
                continue;
            }

            if (sName.indexOf("檄令") !== -1 || sDesc.indexOf("主将の攻撃力が増加") !== -1) {
                var gk_i = SharedDB.getGekireiBonus(s, card.rarity, masterCost);
                passiveRawAdd += (gk_i && gk_i.bonus) || 0;
                hasPassive = true;
            } else {
                var pi2 = parseSkill(s, weatherObj);
                var sBuff = (mode === 'lead') ? (pi2.leadBuff || 0) : (pi2.gMult || 0);
                if (sBuff > 0) {
                    if (pi2.isPassive || isFromAdjutant) {
                        passiveBuffSum += sBuff;
                        hasPassive = true;
                    } else {
                        activeCandidates.push({ val: sBuff, isShurei: pi2.isShurei, mustBeSameBase: pi2.mustBeSameBase });
                    }
                    if (pi2.isGuard) isGuardCard = true;
                }
            }
        }

        // 一般武将はアクティブスキル1つだけ発動、覇武将は全アクティブスキル同時発動
        var activeBuffSum = 0;
        var hasActive = false;
        var isShureiCard = false;

        if (activeCandidates.length > 0) {
            hasActive = true;
            if (isHa) {
                for (var ai = 0; ai < activeCandidates.length; ai++) {
                    activeBuffSum += activeCandidates[ai].val;
                    if (activeCandidates[ai].isShurei) isShureiCard = true;
                    if (activeCandidates[ai].mustBeSameBase) mustBeSameBase = true;
                }
            } else {
                activeCandidates.sort(function(a, b) { return b.val - a.val; });
                activeBuffSum = activeCandidates[0].val;
                isShureiCard = Boolean(activeCandidates[0].isShurei);
                if (activeCandidates[0].mustBeSameBase) mustBeSameBase = true;
            }
        }

        return {
            gMult: passiveBuffSum + activeBuffSum,
            rawAdd: passiveRawAdd,
            firstRawAdd: baseGkBonus,
            firstGMult: firstVal,
            isPassive: !hasActive && hasPassive,
            isActive: hasActive,
            isGuard: isGuardCard,
            mustBeSameBase: mustBeSameBase,
            isShurei: isShureiCard,
            isGekirei: isGekirei,
            series: seriesName
        };
    }

    function getBestWeatherForCard(card, masterCost) {
        var weathers = ['SUN', 'CLOUD', 'RAIN', 'SNOW'];
        var bestW = 'SUN';
        var maxEval = { gMult: 0, rawAdd: 0, firstRawAdd: 0, firstGMult: 0, isActive: false, isPassive: false, isGuard: false, mustBeSameBase: false, isShurei: false, isGekirei: false, series: null };
        for (var i = 0; i < weathers.length; i++) {
            var w = weathers[i];
            var ev = evaluateCard(card, w, 'support', masterCost);
            if ((ev.gMult || 0) > (maxEval.gMult || 0) || ((ev.gMult || 0) === (maxEval.gMult || 0) && (ev.rawAdd || 0) > (maxEval.rawAdd || 0))) {
                maxEval = ev; bestW = w;
            }
        }
        return { bestWeather: bestW, eval: maxEval };
    }

    function estimateLeadWithOptimalAdjutants(card, leadGMult, firstGMult, allMirrorPool, usedTeisenIds, estSupportMult, estGekirei) {
        var baseAtk = SharedDB.safeNum(card.baseAttack, 1000);
        if (SharedDB.isHaBusho(card) || SharedDB.safeNum(card.maxFukushoCost, 0) <= 0) {
            return {
                adjAtkBonus: 0,
                adjBuffBonus: 0,
                estTotalAtk: baseAtk + estGekirei,
                estTotalMult: estSupportMult + leadGMult,
                estScore: (baseAtk + estGekirei) * (1 + (estSupportMult + leadGMult) / 100)
            };
        }

        var kMult = SharedDB.getKakuseiMultiplier(card);
        var baseCopyVal = firstGMult / kMult;

        if (adjutantMode === 'CURRENT') {
            var curAtkAdd = 0, curBuffAdd = 0;
            if (Array.isArray(card.fukusho)) {
                card.fukusho.forEach(function(rawFk) {
                    var inf = SharedDB.getMirrorSkillInfo(rawFk);
                    var st = SharedDB.getAdjutantStatusEffect(rawFk, inf);
                    curAtkAdd += st.atkBonus;
                    if (inf) {
                        var effRate = SharedDB.calcAdjutantEffectiveCopyRate(card, rawFk, inf);
                        curBuffAdd += baseCopyVal * (effRate / 100);
                    }
                });
            }
            var curTotAtk = baseAtk + curAtkAdd + estGekirei;
            var curTotMult = estSupportMult + leadGMult + curBuffAdd;
            return {
                adjAtkBonus: curAtkAdd,
                adjBuffBonus: curBuffAdd,
                estTotalAtk: curTotAtk,
                estTotalMult: curTotMult,
                estScore: curTotAtk * (1 + curTotMult / 100)
            };
        }

        var fixedSlots = [];
        var fixedUsedIds = new Set();
        var fixedUsedNos = new Set([card.cardNo]);
        var fixedCost = 0;
        if (adjutantMode === 'FILL_EMPTY' && Array.isArray(card.fukusho)) {
            card.fukusho.forEach(function(rawFk) {
                var inf = SharedDB.getMirrorSkillInfo(rawFk);
                if (inf) {
                    var st = SharedDB.getAdjutantStatusEffect(rawFk, inf);
                    var c = SharedDB.safeNum(rawFk.cost, 0);
                    var effRateF = SharedDB.calcAdjutantEffectiveCopyRate(card, rawFk, inf);
                    fixedSlots.push({ name: rawFk.name, atkAdd: st.atkBonus, buffAdd: baseCopyVal * (effRateF / 100), cost: c });
                    if (rawFk.uniqueId) fixedUsedIds.add(String(rawFk.uniqueId));
                    if (rawFk.cardNo) fixedUsedNos.add(String(rawFk.cardNo));
                    fixedCost += c;
                }
            });
        }

        var filteredPool = allMirrorPool.filter(function(fk) {
            return !fixedUsedIds.has(fk.uniqueId) && !fixedUsedNos.has(fk.cardNo) && fk.uniqueId !== card.uniqueId && fk.cardNo !== card.cardNo;
        });

        var combo = SharedDB.findBestAdjutantCombo(card, filteredPool, fixedSlots, fixedCost, {
            baseCopyG: baseCopyVal,
            wGen: (baseAtk + estGekirei) / 100,
            wAtk: 1 + (estSupportMult + leadGMult) / 100
        });

        var bestComboAtk = fixedSlots.reduce(function(s, x) { return s + x.atkAdd; }, 0);
        var bestComboBuff = fixedSlots.reduce(function(s, x) { return s + x.buffAdd; }, 0);
        combo.forEach(function(fk) {
            bestComboAtk += SharedDB.safeNum(fk.atkBonus, 0);
            bestComboBuff += baseCopyVal * (SharedDB.safeNum(fk.copyRate, 0) / 100);
        });

        var bestComboScore = (baseAtk + bestComboAtk + estGekirei) * (1 + (estSupportMult + leadGMult + bestComboBuff) / 100);

        return {
            adjAtkBonus: bestComboAtk,
            adjBuffBonus: bestComboBuff,
            estTotalAtk: baseAtk + bestComboAtk + estGekirei,
            estTotalMult: estSupportMult + leadGMult + bestComboBuff,
            estScore: bestComboScore
        };
    }

    function run(shouldAutoWeather) {
        try {
            var uCards = AppCards.userCards;
            if (!uCards || uCards.length === 0) return;
            AppCards.setStatusLog("単騎最適化計算中... (" + uCards.length + "枚)");

            var elCost = document.getElementById('soloCostDist');
            var elOrigin = document.getElementById('soloAttackOrigin');
            var costDist = elCost ? elCost.value : '25-30';
            var honkyoLimit = costDist === '30-25' ? 30.0 : 25.0;
            var kyotenLimit = costDist === '30-25' ? 25.0 : 30.0;
            var attackOrigin = elOrigin ? elOrigin.value : 'KYOTEN';
            var isHonkyoAttack = (attackOrigin === 'HONKYO');
            var originSlotId = isHonkyoAttack ? 'h0' : 'k0';
            var originLimit = isHonkyoAttack ? honkyoLimit : kyotenLimit;

            var validCards = uCards.filter(function(c) { return !c.isAdjutant && !AppCards.excludedCardIds.has(c.uniqueId); });

            var allMirrorPool = [];
            var seenMirrorKeys = new Set();
            uCards.forEach(function(c) {
                if (AppCards.excludedCardIds.has(c.uniqueId)) return;
                var inf = SharedDB.getMirrorSkillInfo(c);
                if (inf) {
                    var cid = String(c.uniqueId || c.cardNo || allMirrorPool.length);
                    if (!seenMirrorKeys.has(cid)) { seenMirrorKeys.add(cid); allMirrorPool.push({ card: c, info: inf, uniqueId: cid, cardNo: c.cardNo || cid }); }
                }
            });

            uCards.forEach(function(c) {
                var fks = c.fukusho || [];
                for (var fi = 0; fi < fks.length; fi++) {
                    var fk = fks[fi];
                    if (!fk || typeof fk !== 'object') continue;
                    var inf2 = SharedDB.getMirrorSkillInfo(fk);
                    if (inf2) {
                        var fkid = String(fk.uniqueId || fk.id || fk.cardNo || allMirrorPool.length);
                        if (!seenMirrorKeys.has(fkid)) {
                            seenMirrorKeys.add(fkid);
                            allMirrorPool.push({
                                card: {
                                    uniqueId: fkid, cardNo: fk.cardNo || fkid, name: fk.name || '副将',
                                    rarity: inf2.rarity, cost: SharedDB.safeNum(fk.cost, 4.0),
                                    originalCost: SharedDB.safeNum(fk.cost, 4.0),
                                    baseAttack: SharedDB.safeNum(fk.baseAttack !== undefined ? fk.baseAttack : fk.attack, 0),
                                    intelligence: SharedDB.safeNum(fk.intelligence, 0),
                                    imageSrc: fk.imageSrc || '', skills: [{ name: inf2.label, description: '' }],
                                    country: fk.country || inf2.force || '他'
                                },
                                info: inf2, uniqueId: fkid, cardNo: fk.cardNo || fkid
                            });
                        }
                    }
                }
            });

            var effectiveCostMap = Object.create(null);
            validCards.forEach(function(c) {
                var baseC = SharedDB.safeNum(c.originalCost !== undefined ? c.originalCost : c.cost, 4.5);
                var hasEqTeisen = Array.isArray(c.fukusho) && c.fukusho.some(function(fk) {
                    if (!fk) return false;
                    var t = String(fk.name || '') + ' ' + String(fk.label || '') + ' ' + String(fk.description || '');
                    return t.indexOf('帝仙鏡') !== -1 || t.indexOf('仙鏡') !== -1;
                });
                effectiveCostMap[c.uniqueId] = hasEqTeisen ? 1.0 : baseC;
            });

            var preTeisenAssignedMap = Object.create(null);
            var usedTeisenCardIds = new Set();
            if (adjutantMode !== 'CURRENT') {
                var teisenFkCards = allMirrorPool.filter(function(m) { return m.info && m.info.type === 'senkyo'; });
                var teisenCandidateList = validCards.filter(function(c) {
                    var origC = SharedDB.safeNum(c.originalCost !== undefined ? c.originalCost : c.cost, 4.5);
                    return !SharedDB.isHaBusho(c) && String(c.rarity || '').toUpperCase() === 'SL' && SharedDB.safeNum(c.maxFukushoCost, 0) > 0 && origC > 1.0;
                });
                teisenCandidateList.sort(function(a, b) {
                    var origA = SharedDB.safeNum(a.originalCost !== undefined ? a.originalCost : a.cost, 4.5);
                    var origB = SharedDB.safeNum(b.originalCost !== undefined ? b.originalCost : b.cost, 4.5);
                    return (origB - origA) || (evaluateCard(b, 'SUN', 'support', 4.5).gMult - evaluateCard(a, 'SUN', 'support', 4.5).gMult);
                });

                for (var ti = 0; ti < Math.min(teisenFkCards.length, teisenCandidateList.length); ti++) {
                    var tgtCard = teisenCandidateList[ti];
                    var tFk = teisenFkCards[ti];
                    preTeisenAssignedMap[tgtCard.uniqueId] = tFk;
                    usedTeisenCardIds.add(tFk.uniqueId);
                    effectiveCostMap[tgtCard.uniqueId] = 1.0;
                }
            }

            var getCardSoldierKey = function(c) {
                if (c.soldierKey && SOLDIER_META[c.soldierKey]) return c.soldierKey;
                var info = SharedDB.normalizeSoldierType(c.soldierType, c);
                c.soldierKey = info.key;
                c.soldierLabel = info.label;
                c.soldierType = info.raw;
                return info.key;
            };

            var getBestLeadWeatherEval = function(c) {
                var effC = effectiveCostMap[c.uniqueId] || SharedDB.safeNum(c.cost, 4.5);
                if (!shouldAutoWeather) {
                    var fixedW = AppCards.slotWeathers[originSlotId] || 'SUN';
                    var fixedEv = evaluateCard(c, fixedW, 'lead', effC);
                    return { gMult: SharedDB.safeNum(fixedEv.gMult, 0), firstGMult: SharedDB.safeNum(fixedEv.firstGMult, 0), bestWeather: fixedW };
                }
                var weathers = ['SUN', 'CLOUD', 'RAIN', 'SNOW'];
                var bestW = AppCards.slotWeathers[originSlotId] || 'SUN';
                var maxG = -1;
                var bestFirstG = 0;
                for (var wi = 0; wi < weathers.length; wi++) {
                    var ev = evaluateCard(c, weathers[wi], 'lead', effC);
                    var g = SharedDB.safeNum(ev.gMult, 0);
                    if (g > maxG) {
                        maxG = g;
                        bestFirstG = SharedDB.safeNum(ev.firstGMult, 0);
                        bestW = weathers[wi];
                    }
                }
                return { gMult: Math.max(0, maxG), firstGMult: bestFirstG, bestWeather: bestW };
            };

            var elGoInit = document.getElementById('optSoloGoBuff');
            var initGo = isGoEnabled ? SharedDB.safeNum(elGoInit && elGoInit.value, goBuffValue) : 0;
            var estSupportMultBase = initGo + 8000;
            var estGekireiBase = 0;
            var seenGkNos = new Set();
            validCards.forEach(function(c) {
                var gkEv = evaluateCard(c, 'SUN', 'support', 4.5);
                if (gkEv.isGekirei && gkEv.rawAdd > 0) {
                    var gNo = c.cardNo || c.uniqueId;
                    if (!seenGkNos.has(gNo)) {
                        seenGkNos.add(gNo);
                        estGekireiBase += gkEv.rawAdd;
                    }
                }
            });
            if (estGekireiBase <= 0) estGekireiBase = 150000;

            var allLeadPool = validCards.filter(function(c) {
                var effC = effectiveCostMap[c.uniqueId] || SharedDB.safeNum(c.cost, 4.5);
                return !usedTeisenCardIds.has(c.uniqueId) && effC <= originLimit;
            }).map(function(c) {
                var bestL = getBestLeadWeatherEval(c);
                var adjEst = estimateLeadWithOptimalAdjutants(c, bestL.gMult, bestL.firstGMult, allMirrorPool, usedTeisenCardIds, estSupportMultBase, estGekireiBase);
                return {
                    card: c,
                    soldierKey: getCardSoldierKey(c),
                    gMult: bestL.gMult,
                    firstGMult: bestL.firstGMult,
                    adjAtkBonus: adjEst.adjAtkBonus,
                    adjBuffBonus: adjEst.adjBuffBonus,
                    score: adjEst.estScore,
                    bestWeather: bestL.bestWeather
                };
            });
            allLeadPool.sort(function(a, b) { return b.score - a.score; });

            var topBySoldier = { HAMMER: null, DOUBLE: null, AXE: null, BOW: null, SPEAR: null, CAV: null, SWORD: null };
            for (var si = 0; si < allLeadPool.length; si++) {
                var sk = allLeadPool[si].soldierKey;
                if (topBySoldier.hasOwnProperty(sk) && !topBySoldier[sk]) {
                    topBySoldier[sk] = allLeadPool[si];
                }
            }

            var isAutoDetectingBestSoldier = (!selectedSoldierFilter || !SOLDIER_META[selectedSoldierFilter]);
            var topSoloLeads = [];
            if (isAutoDetectingBestSoldier) {
                for (var oi = 0; oi < SOLDIER_ORDER.length; oi++) {
                    var sKey0 = SOLDIER_ORDER[oi];
                    var perSoldier = allLeadPool.filter(function(item) { return item.soldierKey === sKey0; });
                    for (var pi = 0; pi < Math.min(2, perSoldier.length); pi++) {
                        topSoloLeads.push(perSoldier[pi]);
                    }
                }
            } else {
                var filteredLeadPool = allLeadPool.filter(function(item) { return item.soldierKey === selectedSoldierFilter; });
                topSoloLeads = filteredLeadPool.slice(0, Math.min(8, filteredLeadPool.length));
            }

            var bestSetup = { finalTotalDamage: -1 };

            topSoloLeads.forEach(function(leadItem) {
                var leadCard = leadItem.card;
                var leadEffCost = effectiveCostMap[leadCard.uniqueId] || SharedDB.safeNum(leadCard.cost, 4.5);
                if (leadEffCost > originLimit) return;
                var leadGMult = SharedDB.safeNum(leadItem.gMult, 0);
                var leadBestWeather = leadItem.bestWeather || (AppCards.slotWeathers[originSlotId] || 'SUN');
                var masterCost = leadEffCost;
                var leadNo = leadCard.cardNo || leadCard.uniqueId;

                var shureiPool = [], allActivesPool = [], globalPassivePool = [], boundPassivePool = [], guardPool = [];
                validCards.forEach(function(c) {
                    if (c.uniqueId === leadCard.uniqueId || (c.cardNo || c.uniqueId) === leadNo || usedTeisenCardIds.has(c.uniqueId)) return;
                    var bestSup = getBestWeatherForCard(c, masterCost);
                    var probe = bestSup.eval;
                    if (!probe.isActive && !probe.isPassive && !probe.isGuard) return;
                    if (SharedDB.safeNum(probe.gMult, 0) <= 0 && SharedDB.safeNum(probe.rawAdd, 0) <= 0) return;

                    var effCost = effectiveCostMap[c.uniqueId] || SharedDB.safeNum(c.cost, 1.0);
                    var item = {
                        card: c, effectiveCost: effCost,
                        gMult: SharedDB.safeNum(probe.gMult, 0), rawAdd: SharedDB.safeNum(probe.rawAdd, 0),
                        firstRawAdd: SharedDB.safeNum(probe.firstRawAdd, 0), firstGMult: SharedDB.safeNum(probe.firstGMult, 0),
                        series: probe.series, isBound: probe.mustBeSameBase, isShurei: probe.isShurei, isGekirei: probe.isGekirei,
                        weather: bestSup.bestWeather
                    };
                    if (probe.isGuard) guardPool.push(item);
                    else if (probe.isPassive) {
                        if (probe.mustBeSameBase) boundPassivePool.push(item);
                        else globalPassivePool.push(item);
                    } else if (probe.isActive) {
                        var firstSName = String((c.skills && c.skills[0] && c.skills[0].name) || '');
                        if (firstSName.indexOf("防:") === 0) {
                            if (probe.isShurei) shureiPool.push(item);
                            else allActivesPool.push(item);
                        }
                    }
                });

                var chosenShurei = null;
                shureiPool.sort(function(a, b) { return b.gMult - a.gMult; });
                if (shureiPool.length > 0) chosenShurei = shureiPool[0];

                var shureiCost = chosenShurei ? chosenShurei.effectiveCost : 0.0;
                var shureiBuff = chosenShurei ? SharedDB.safeNum(chosenShurei.gMult, 0) : 0.0;
                var originInitCost = leadEffCost + shureiCost;
                if (originInitCost > originLimit) return;

                var globalActives = allActivesPool.filter(function(a) { return !a.isBound; });
                var topGlobals = globalActives.slice().sort(function(a, b) { return b.gMult - a.gMult; }).slice(0, 6);

                var hSlotPatterns = [];
                if (!isHonkyoAttack) {
                    for (var i = 0; i < topGlobals.length; i++) {
                        for (var j = i + 1; j < topGlobals.length; j++) {
                            var noI = topGlobals[i].card.cardNo || topGlobals[i].card.uniqueId;
                            var noJ = topGlobals[j].card.cardNo || topGlobals[j].card.uniqueId;
                            if (noI !== noJ) hSlotPatterns.push([topGlobals[i], topGlobals[j]]);
                        }
                    }
                    for (var i = 0; i < topGlobals.length; i++) hSlotPatterns.push([topGlobals[i]]);
                    hSlotPatterns.push([]);
                } else {
                    var topH1 = allActivesPool.filter(function(a) { return !a.isShurei; }).sort(function(a, b) { return b.gMult - a.gMult; }).slice(0, 6);
                    for (var i = 0; i < topH1.length; i++) hSlotPatterns.push([topH1[i]]);
                    hSlotPatterns.push([]);
                }

                var bestLocalBuff = -1;
                var bestLocalSetup = null;

                for (var patIdx = 0; patIdx < hSlotPatterns.length; patIdx++) {
                    var hPair = hSlotPatterns[patIdx];
                    var curHCost = isHonkyoAttack ? (originInitCost + (hPair[0] ? hPair[0].effectiveCost : 0)) : hPair.reduce(function(s, x) { return s + x.effectiveCost; }, 0);
                    if (curHCost > honkyoLimit) continue;

                    var usedNos = new Set([leadNo]);
                    if (chosenShurei) usedNos.add(chosenShurei.card.cardNo || chosenShurei.card.uniqueId);
                    hPair.forEach(function(x) { usedNos.add(x.card.cardNo || x.card.uniqueId); });

                    var curKCost = isHonkyoAttack ? 0.0 : originInitCost;
                    var kActives = [];
                    var remActivesForK = (!isHonkyoAttack ? allActivesPool : globalActives).filter(function(a) {
                        var aNo = a.card.cardNo || a.card.uniqueId;
                        return !usedNos.has(aNo) && !a.isShurei;
                    });
                    remActivesForK.sort(function(a, b) { return b.gMult - a.gMult; });

                    for (var ai = 0; ai < remActivesForK.length; ai++) {
                        var act = remActivesForK[ai];
                        var actNo = act.card.cardNo || act.card.uniqueId;
                        var cCost = act.effectiveCost;
                        var maxSlots = isHonkyoAttack ? 9 : 8;
                        if (kActives.length < maxSlots && !usedNos.has(actNo) && (curKCost + cCost <= kyotenLimit)) {
                            kActives.push(act); curKCost += cCost; usedNos.add(actNo);
                        }
                    }

                    var hRemCost = honkyoLimit - curHCost;
                    var kRemCost = kyotenLimit - curKCost;
                    var sumHG = hPair.reduce(function(s, x) { return s + SharedDB.safeNum(x.gMult, 0); }, 0);
                    var sumKG = kActives.reduce(function(s, x) { return s + SharedDB.safeNum(x.gMult, 0); }, 0);
                    var estBuff = leadGMult + SharedDB.safeNum(leadItem.adjBuffBonus, 0) + shureiBuff + sumHG + sumKG + SharedDB.safeNum(goBuffValue, 7000);
                    var multFactor = 1 + estBuff / 100;
                    var leadBaseWithAdjEst = SharedDB.safeNum(leadCard.baseAttack, 1000) + SharedDB.safeNum(leadItem.adjAtkBonus, 0);

                    var mapItemToScore = function(it) {
                        var score = (it.isGekirei && SharedDB.safeNum(it.rawAdd, 0) > 0) ? (SharedDB.safeNum(it.rawAdd, 0) * multFactor) : (leadBaseWithAdjEst * (SharedDB.safeNum(it.gMult, 0) / 100));
                        return {
                            card: it.card, cost: it.effectiveCost, effectiveCost: it.effectiveCost,
                            gMult: SharedDB.safeNum(it.gMult, 0), rawAdd: SharedDB.safeNum(it.rawAdd, 0),
                            firstRawAdd: it.firstRawAdd, firstGMult: it.firstGMult,
                            series: it.series, isGekirei: it.isGekirei, isBound: it.isBound, tMult: score
                        };
                    };

                    var filterBestPerNo = function(pool) {
                        var bestMap = {};
                        pool.forEach(function(x) {
                            var xNo = x.card.cardNo || x.card.uniqueId;
                            if (usedNos.has(xNo)) return;
                            var scored = mapItemToScore(x);
                            if (!bestMap[xNo] || scored.tMult > bestMap[xNo].tMult) bestMap[xNo] = scored;
                        });
                        return Object.values(bestMap);
                    };

                    var availGP = filterBestPerNo(globalPassivePool);
                    var availBP = filterBestPerNo(boundPassivePool);

                    var pickedHPassives = [], pickedKPassives = [];
                    if (!isHonkyoAttack) {
                        var kRes = SharedDB.solveKnapsackDP(kRemCost, availBP);
                        pickedKPassives = kRes.picked;
                        var pKNos = new Set(pickedKPassives.map(function(p) { return p.card.cardNo || p.card.uniqueId; }));
                        var remGP = availGP.filter(function(x) { return !pKNos.has(x.card.cardNo || x.card.uniqueId); });
                        var hRes = SharedDB.solveKnapsackDP(hRemCost, remGP);
                        pickedHPassives = hRes.picked;
                        var kExtra = kRemCost - pickedKPassives.reduce(function(s, p) { return s + p.effectiveCost; }, 0);
                        var pHNos = new Set(pickedHPassives.map(function(p) { return p.card.cardNo || p.card.uniqueId; }));
                        var remForK = remGP.filter(function(x) { return !pHNos.has(x.card.cardNo || x.card.uniqueId); });
                        if (kExtra >= 0.5 && remForK.length > 0) pickedKPassives = pickedKPassives.concat(SharedDB.solveKnapsackDP(kExtra, remForK).picked);
                    } else {
                        var hRes = SharedDB.solveKnapsackDP(hRemCost, availBP);
                        pickedHPassives = hRes.picked;
                        var pHNos = new Set(pickedHPassives.map(function(p) { return p.card.cardNo || p.card.uniqueId; }));
                        var remGP = availGP.filter(function(x) { return !pHNos.has(x.card.cardNo || x.card.uniqueId); });
                        var kRes = SharedDB.solveKnapsackDP(kRemCost, remGP);
                        pickedKPassives = kRes.picked;
                        var pKNos = new Set(pickedKPassives.map(function(p) { return p.card.cardNo || p.card.uniqueId; }));
                        var hExtra = hRemCost - pickedHPassives.reduce(function(s, p) { return s + p.effectiveCost; }, 0);
                        var remForH = remGP.filter(function(x) { return !pKNos.has(x.card.cardNo || x.card.uniqueId); });
                        if (hExtra >= 0.5 && remForH.length > 0) pickedHPassives = pickedHPassives.concat(SharedDB.solveKnapsackDP(hExtra, remForH).picked);
                    }

                    var allPickedP = pickedHPassives.concat(pickedKPassives);
                    var gekireiSum = allPickedP.reduce(function(s, p) { return s + SharedDB.safeNum(p.rawAdd, 0); }, 0);
                    var passiveGMultSum = allPickedP.reduce(function(s, p) { return s + SharedDB.safeNum(p.gMult, 0); }, 0);
                    var activeGMultSum = sumHG + sumKG;

                    var currentPureGenMult = leadGMult + shureiBuff + activeGMultSum + passiveGMultSum;
                    var effectiveAtk = leadBaseWithAdjEst + gekireiSum;
                    var candidateDamage = effectiveAtk * (1 + (currentPureGenMult + SharedDB.safeNum(leadItem.adjBuffBonus, 0) + SharedDB.safeNum(goBuffValue, 7000)) / 100);

                    if (candidateDamage > bestLocalBuff) {
                        bestLocalBuff = candidateDamage;
                        var currentSlots = {};
                        if (chosenShurei) currentSlots[originSlotId] = Object.assign({}, chosenShurei, { isShurei: true });
                        if (!isHonkyoAttack) {
                            if (hPair[0]) currentSlots['h0'] = hPair[0];
                            if (hPair[1]) currentSlots['h1'] = hPair[1];
                            for (var ki = 0; ki < kActives.length; ki++) currentSlots['k' + (ki + 1)] = kActives[ki];
                        } else {
                            if (hPair[0]) currentSlots['h1'] = hPair[0];
                            for (var ki = 0; ki < kActives.length; ki++) currentSlots['k' + ki] = kActives[ki];
                        }
                        var actualUsedNos = new Set(usedNos);
                        pickedHPassives.concat(pickedKPassives).forEach(function(p) { actualUsedNos.add(p.card.cardNo || p.card.uniqueId); });

                        bestLocalSetup = {
                            activeSlots: currentSlots, basePassives: pickedHPassives, subPassives: pickedKPassives,
                            pureGenMult: currentPureGenMult, gekireiBonusTotal: gekireiSum,
                            hCost: curHCost + pickedHPassives.reduce(function(s, p) { return s + p.effectiveCost; }, 0),
                            kCost: curKCost + pickedKPassives.reduce(function(s, p) { return s + p.effectiveCost; }, 0),
                            usedNos: actualUsedNos
                        };
                    }
                }

                if (!bestLocalSetup) return;

                var finalUsedNos = new Set(bestLocalSetup.usedNos);
                var leadBaseWithAdjEst2 = SharedDB.safeNum(leadCard.baseAttack, 1000) + SharedDB.safeNum(leadItem.adjAtkBonus, 0);
                var guardMultFactor = 1 + (bestLocalSetup.pureGenMult + SharedDB.safeNum(leadItem.adjBuffBonus, 0) + SharedDB.safeNum(goBuffValue, 7000)) / 100;
                var availGuards = guardPool.filter(function(g) { return !finalUsedNos.has(g.card.cardNo || g.card.uniqueId); }).map(function(g) {
                    var score = (g.isGekirei && SharedDB.safeNum(g.rawAdd, 0) > 0) ? (SharedDB.safeNum(g.rawAdd, 0) * guardMultFactor) : (leadBaseWithAdjEst2 * (SharedDB.safeNum(g.gMult, 0) / 100));
                    return Object.assign({}, g, { cost: g.effectiveCost, tMult: score });
                });
                var hGuards = SharedDB.solveKnapsackDP(honkyoLimit, availGuards.filter(function(x) { return !x.isBound || isHonkyoAttack; }));
                var hGuardPicked = hGuards.picked;
                var hGuardNos = new Set(hGuardPicked.map(function(x) { return x.card.cardNo || x.card.uniqueId; }));
                var kGuards = SharedDB.solveKnapsackDP(kyotenLimit, availGuards.filter(function(x) { return (!x.isBound || !isHonkyoAttack) && !hGuardNos.has(x.card.cardNo || x.card.uniqueId); }));
                var kGuardPicked = kGuards.picked;

                var allGuardPicked = hGuardPicked.concat(kGuardPicked);
                var totalGekireiBonus = bestLocalSetup.gekireiBonusTotal + allGuardPicked.reduce(function(s, g) { return s + SharedDB.safeNum(g.rawAdd, 0); }, 0);
                var pureGenMult = bestLocalSetup.pureGenMult + allGuardPicked.reduce(function(s, g) { return s + SharedDB.safeNum(g.gMult, 0); }, 0);

                var assignedAdjutantsMap = (adjutantMode === 'CURRENT') ? null : Object.create(null);
                var additionalAdjutantBuff = 0;
                var adjutantAddedBuffMap = Object.create(null);
                var adjutantAddedGekireiMap = Object.create(null);
                var usedAdjutantCostMap = Object.create(null);
                var leadAdjutantAtkBonus = 0;

                var allDeckUsedCardIds = new Set([leadCard.uniqueId]);
                var allDeckUsedCardNos = new Set([leadNo]);
                Object.values(bestLocalSetup.activeSlots).forEach(function(x) { allDeckUsedCardIds.add(x.card.uniqueId); allDeckUsedCardNos.add(x.card.cardNo || x.card.uniqueId); });
                bestLocalSetup.basePassives.concat(bestLocalSetup.subPassives, allGuardPicked).forEach(function(x) { allDeckUsedCardIds.add(x.card.uniqueId); allDeckUsedCardNos.add(x.card.cardNo || x.card.uniqueId); });

                var masterList = [];
                if (!SharedDB.isHaBusho(leadCard) && SharedDB.safeNum(leadCard.maxFukushoCost, 0) > 0) {
                    var firstS = (leadCard.skills && leadCard.skills[0]) || {};
                    var sVal = SharedDB.safeNum(parseSkill(firstS, leadBestWeather).leadBuff, leadItem.firstGMult || 0);
                    var kMult = SharedDB.getKakuseiMultiplier(leadCard);
                    masterList.push({
                        role: 'lead', card: leadCard,
                        originalCost: SharedDB.safeNum(leadCard.originalCost !== undefined ? leadCard.originalCost : leadCard.cost, 4.5),
                        maxCost: SharedDB.safeNum(leadCard.maxFukushoCost, 4.5),
                        firstSkillVal: sVal, baseCopyVal: sVal / kMult, firstSkillObj: firstS, isGekirei: false, firstRawAdd: 0, baseCopyRawAdd: 0
                    });
                }

                Object.keys(bestLocalSetup.activeSlots).forEach(function(sId) {
                    var it = bestLocalSetup.activeSlots[sId];
                    if (it.card && !SharedDB.isHaBusho(it.card) && SharedDB.safeNum(it.card.maxFukushoCost, 0) > 0) {
                        var firstS2 = (it.card.skills && it.card.skills[0]) || {};
                        var slotW = it.weather || AppCards.slotWeathers[sId] || 'SUN';
                        var sVal2 = SharedDB.safeNum(parseSkill(firstS2, slotW).gMult, it.firstGMult || it.gMult || 0);
                        var kMult2 = SharedDB.getKakuseiMultiplier(it.card);
                        masterList.push({
                            role: 'active', slotId: sId, card: it.card,
                            originalCost: SharedDB.safeNum(it.card.originalCost !== undefined ? it.card.originalCost : it.card.cost, 4.5),
                            maxCost: SharedDB.safeNum(it.card.maxFukushoCost, 4.5),
                            firstSkillVal: sVal2, baseCopyVal: sVal2 / kMult2, firstSkillObj: firstS2, isGekirei: false, firstRawAdd: 0, baseCopyRawAdd: 0
                        });
                    }
                });

                bestLocalSetup.basePassives.concat(bestLocalSetup.subPassives, allGuardPicked).forEach(function(p) {
                    if (p.card && !SharedDB.isHaBusho(p.card) && SharedDB.safeNum(p.card.maxFukushoCost, 0) > 0) {
                        var firstS3 = (p.card.skills && p.card.skills[0]) || {};
                        var fRaw = SharedDB.safeNum(p.firstRawAdd !== undefined ? p.firstRawAdd : p.rawAdd, 0);
                        var fG = SharedDB.safeNum(p.firstGMult !== undefined ? p.firstGMult : p.gMult, 0);
                        var kMult3 = SharedDB.getKakuseiMultiplier(p.card);
                        masterList.push({
                            role: 'passive', card: p.card,
                            originalCost: SharedDB.safeNum(p.card.originalCost !== undefined ? p.card.originalCost : p.card.cost, 4.5),
                            maxCost: SharedDB.safeNum(p.card.maxFukushoCost, 4.5),
                            firstSkillVal: fG, baseCopyVal: fG / kMult3, firstSkillObj: firstS3, isGekirei: Boolean(p.isGekirei),
                            firstRawAdd: fRaw, baseCopyRawAdd: fRaw / kMult3
                        });
                    }
                });

                masterList.forEach(function(m) {
                    var rWeight = (SharedDB.RARITY_ORDER[String(m.card.rarity || 'SL').toUpperCase()] || 1) * 10000000;
                    var roleWeight = (m.role === 'lead') ? 100000000 : 0;
                    m.priority = roleWeight + rWeight + (m.isGekirei ? (m.firstRawAdd * guardMultFactor) : (m.firstSkillVal * 1000));
                    adjutantAddedBuffMap[m.card.uniqueId] = 0;
                    adjutantAddedGekireiMap[m.card.uniqueId] = 0;
                    usedAdjutantCostMap[m.card.uniqueId] = 0;
                });
                masterList.sort(function(a, b) { return b.priority - a.priority; });

                var usedMirrorIds = new Set();
                var usedMirrorNos = new Set();

                masterList.forEach(function(master) {
                    var mCard = master.card;
                    var existingList = [];
                    if ((adjutantMode === 'CURRENT' || adjutantMode === 'FILL_EMPTY') && Array.isArray(mCard.fukusho)) {
                        mCard.fukusho.forEach(function(rawFk) {
                            var inf = SharedDB.getMirrorSkillInfo(rawFk);
                            var st = SharedDB.getAdjutantStatusEffect(rawFk, inf);
                            var fkCost = SharedDB.safeNum(rawFk.cost, 0);
                            usedAdjutantCostMap[mCard.uniqueId] += fkCost;
                            if (master.role === 'lead') leadAdjutantAtkBonus += st.atkBonus;

                            if (inf) {
                                var rate = SharedDB.calcAdjutantEffectiveCopyRate(mCard, rawFk, inf);
                                var fkId = String(rawFk.uniqueId || rawFk.id || rawFk.cardNo || '');
                                var fkNo = String(rawFk.cardNo || fkId);
                                if (fkId) usedMirrorIds.add(fkId);
                                if (fkNo) usedMirrorNos.add(fkNo);
                                existingList.push(Object.assign({}, rawFk, {
                                    copyRate: rate,
                                    label: formatMirrorLabelWithCost(inf, rate)
                                }));
                                if (master.isGekirei && master.baseCopyRawAdd > 0) {
                                    var addGk0 = master.baseCopyRawAdd * (rate / 100);
                                    totalGekireiBonus += addGk0;
                                    adjutantAddedGekireiMap[mCard.uniqueId] += addGk0;
                                } else if (master.baseCopyVal > 0) {
                                    var addB0 = master.baseCopyVal * (rate / 100);
                                    additionalAdjutantBuff += addB0;
                                    adjutantAddedBuffMap[mCard.uniqueId] += addB0;
                                }
                            } else {
                                existingList.push(rawFk);
                            }
                        });
                    }
                    if (assignedAdjutantsMap) assignedAdjutantsMap[mCard.uniqueId] = existingList;
                });

                if (adjutantMode !== 'CURRENT') {
                    var availableMirrors = allMirrorPool.filter(function(m) {
                        return !allDeckUsedCardIds.has(m.uniqueId) && !allDeckUsedCardNos.has(m.cardNo) && !usedTeisenCardIds.has(m.uniqueId);
                    });

                    masterList.forEach(function(master) {
                        var mCard = master.card;
                        var mRarity = String(mCard.rarity || 'SL').toUpperCase();
                        var maxSlots = mRarity === 'SL' ? 2 : 1;
                        var currentAssigned = assignedAdjutantsMap[mCard.uniqueId];

                        if (preTeisenAssignedMap[mCard.uniqueId] && currentAssigned.length < maxSlots) {
                            var tWrapper = preTeisenAssignedMap[mCard.uniqueId];
                            var tCard = tWrapper.card || tWrapper;
                            var tCost = SharedDB.safeNum(tCard.cost, 4.0);
                            if (usedAdjutantCostMap[mCard.uniqueId] + tCost <= master.maxCost + 1e-6) {
                                var tSt = SharedDB.getAdjutantStatusEffect(tCard, { type: 'senkyo', rarity: 'SL', rate: 100 });
                                usedAdjutantCostMap[mCard.uniqueId] += tCost;
                                if (master.role === 'lead') leadAdjutantAtkBonus += tSt.atkBonus;

                                currentAssigned.push({
                                    name: tCard.name || tWrapper.name || '副将の帝仙鏡', cardNo: tCard.cardNo || tWrapper.cardNo || '',
                                    imageSrc: tCard.imageSrc || tWrapper.imageSrc || (tCard.cardNo ? 'https://3gokushi.jp/img/card/card_' + tCard.cardNo + '.jpg' : ''),
                                    rarity: 'SL', cost: tCost,
                                    baseAttack: SharedDB.safeNum(tCard.baseAttack, 0),
                                    label: (tSt.isBu ? '[武]' : '') + '帝仙鏡 100% [主将C1化]', copyRate: 100,
                                    uniqueId: tWrapper.uniqueId || tCard.uniqueId, info: { type: 'senkyo', rate: 100 }
                                });
                                if (master.isGekirei && master.baseCopyRawAdd > 0) {
                                    totalGekireiBonus += master.baseCopyRawAdd * 1.0;
                                    adjutantAddedGekireiMap[mCard.uniqueId] += master.baseCopyRawAdd * 1.0;
                                } else if (master.baseCopyVal > 0) {
                                    additionalAdjutantBuff += master.baseCopyVal * 1.0;
                                    adjutantAddedBuffMap[mCard.uniqueId] += master.baseCopyVal * 1.0;
                                }
                            }
                        }

                        if (currentAssigned.length >= maxSlots) return;

                        var unusedForMaster = availableMirrors.filter(function(fk) {
                            return !usedMirrorIds.has(fk.uniqueId) && !usedMirrorNos.has(fk.cardNo);
                        });

                        var bestCombo = SharedDB.findBestAdjutantCombo(mCard, unusedForMaster, currentAssigned, usedAdjutantCostMap[mCard.uniqueId], {
                            baseCopyG: master.isGekirei ? 0 : master.baseCopyVal,
                            baseCopyRaw: master.isGekirei ? master.baseCopyRawAdd : 0,
                            wGen: leadBaseWithAdjEst2 / 100,
                            wRaw: guardMultFactor,
                            wAtk: (master.role === 'lead') ? guardMultFactor * 1.5 : 0
                        });

                        bestCombo.forEach(function(chosenFk) {
                            usedMirrorIds.add(chosenFk.uniqueId);
                            usedMirrorNos.add(chosenFk.cardNo);
                            usedAdjutantCostMap[mCard.uniqueId] += chosenFk.cost;
                            if (master.role === 'lead') leadAdjutantAtkBonus += chosenFk.atkBonus;
                            currentAssigned.push(chosenFk);
                            if (master.isGekirei && master.baseCopyRawAdd > 0) {
                                var addGk = master.baseCopyRawAdd * (chosenFk.copyRate / 100);
                                totalGekireiBonus += addGk;
                                adjutantAddedGekireiMap[mCard.uniqueId] += addGk;
                            } else if (master.baseCopyVal > 0) {
                                var addB = master.baseCopyVal * (chosenFk.copyRate / 100);
                                additionalAdjutantBuff += addB;
                                adjutantAddedBuffMap[mCard.uniqueId] += addB;
                            }
                        });
                    });
                }

                pureGenMult += additionalAdjutantBuff;
                var elGo = document.getElementById('optSoloGoBuff');
                var currentGo = isGoEnabled ? SharedDB.safeNum(elGo && elGo.value, goBuffValue) : 0;
                var finalGenMult = pureGenMult + currentGo;
                var effectiveAttack = SharedDB.safeNum(leadCard.baseAttack, 1000) + leadAdjutantAtkBonus + totalGekireiBonus;
                var baseTotalDamage = Math.floor(effectiveAttack * (1 + (finalGenMult / 100)));
                var buff10Mult = isBuff10 ? 1.1 : 1.0;
                var finalTotalDamage = Math.floor(baseTotalDamage * buff10Mult);

                if (finalTotalDamage > bestSetup.finalTotalDamage) {
                    bestSetup = {
                        finalTotalDamage: finalTotalDamage, baseTotalDamage: baseTotalDamage, pureGenMult: pureGenMult,
                        finalGenMult: finalGenMult, goBuff: currentGo, lead: leadCard, leadSoldierKey: leadItem.soldierKey,
                        leadGMult: leadGMult, leadAdjutantAtkBonus: leadAdjutantAtkBonus,
                        attackOrigin: attackOrigin, gekireiBonusTotal: totalGekireiBonus, effectiveAttack: effectiveAttack,
                        honkyoLimit: honkyoLimit, kyotenLimit: kyotenLimit, honkyoCost: bestLocalSetup.hCost, kyotenCost: bestLocalSetup.kCost,
                        honkyoGuardCost: hGuardPicked.reduce(function(s, x) { return s + x.effectiveCost; }, 0),
                        kyotenGuardCost: kGuardPicked.reduce(function(s, x) { return s + x.effectiveCost; }, 0),
                        chosenActiveSlots: bestLocalSetup.activeSlots, chosenBasePassives: bestLocalSetup.basePassives,
                        chosenSubPassives: bestLocalSetup.subPassives, chosenBaseGuards: hGuardPicked, chosenSubGuards: kGuardPicked,
                        assignedAdjutantsMap: assignedAdjutantsMap, adjutantAddedBuffMap: adjutantAddedBuffMap,
                        adjutantAddedGekireiMap: adjutantAddedGekireiMap, effectiveCostMap: effectiveCostMap,
                        buff10Multiplier: buff10Mult, topBySoldier: topBySoldier
                    };
                }
            });

            var area = document.getElementById('soloDeckResultArea');
            if (!area) return;
            if (bestSetup.finalTotalDamage === -1) {
                if (isAutoDetectingBestSoldier) selectedSoldierFilter = 'HAMMER';
                syncSoldierFilterButtons(selectedSoldierFilter);
                var sLabel = (SOLDIER_META[selectedSoldierFilter] && SOLDIER_META[selectedSoldierFilter].label) || selectedSoldierFilter;
                area.innerHTML = '<div class="text-gray-400 text-sm border-2 border-dashed border-gray-700 p-8 text-center rounded-xl space-y-3">' +
                    '<div>指定条件（<b class="text-amber-400">' + sLabel + '</b>）に合致する単騎エース武将が見つかりませんでした。</div>' +
                    '<div class="text-xs text-gray-500">別の兵科ボタンをクリックするか、カード左上の兵科バッジをクリックして兵科を調整してください。</div>' +
                    '</div>';
                currentSetup = null;
                return;
            }

            if (isAutoDetectingBestSoldier) {
                selectedSoldierFilter = (bestSetup.leadSoldierKey && SOLDIER_META[bestSetup.leadSoldierKey]) ? bestSetup.leadSoldierKey : 'HAMMER';
            }
            bestSetup.selectedSoldierFilter = selectedSoldierFilter;
            syncSoldierFilterButtons(selectedSoldierFilter);

            if (shouldAutoWeather) {
                Object.keys(bestSetup.chosenActiveSlots).forEach(function(sId) {
                    if (bestSetup.chosenActiveSlots[sId].weather) AppCards.slotWeathers[sId] = bestSetup.chosenActiveSlots[sId].weather;
                });
            }
            currentSetup = bestSetup;
            render(bestSetup);
            AppCards.setStatusLog("単騎最適化完了 (" + SOLDIER_META[selectedSoldierFilter].short + "): 最大攻撃力 " + bestSetup.finalTotalDamage.toLocaleString());
        } catch (err) {
            console.error("SoloEngine.run Error:", err);
            AppCards.setStatusLog("単騎計算エラー: " + err.message, true);
        }
    }

    function getDisplayCard(card, setup) {
        if (!card || !setup || !setup.effectiveCostMap) return card;
        var effC = setup.effectiveCostMap[card.uniqueId];
        var origC = SharedDB.safeNum(card.originalCost !== undefined ? card.originalCost : card.cost, 4.5);
        if (effC === 1.0 && origC > 1.0) {
            return Object.assign({}, card, { cost: 1.0, hasTeisenkyo: true });
        }
        return card;
    }

    function render(setup) {
        var area = document.getElementById('soloDeckResultArea');
        if (!area || !setup) return;
        var isHonkyoAttack = (setup.attackOrigin === 'HONKYO');
        var originName = isHonkyoAttack ? '本拠・塔' : '拠点＋';
        var originColor = isHonkyoAttack ? 'text-amber-400' : 'text-blue-400';

        var renderActiveSlotHTML = function(slotKey, slotTitle) {
            var currentW = AppCards.slotWeathers[slotKey] || 'SUN';
            var item = setup.chosenActiveSlots[slotKey];
            var weathers = [
                { k: 'SUN', l: '晴', c: 'bg-amber-600 text-white' },
                { k: 'CLOUD', l: '曇', c: 'bg-gray-600 text-white' },
                { k: 'RAIN', l: '雨', c: 'bg-blue-600 text-white' },
                { k: 'SNOW', l: '雪', c: 'bg-cyan-600 text-black font-bold' }
            ];
            var weatherBtns = weathers.map(function(w) {
                var active = currentW === w.k ? (w.c + ' font-bold shadow-sm') : 'bg-gray-800 text-gray-400 hover:text-white border border-gray-700';
                return '<button type="button" onclick="AppCards.changeSlotWeather(\'' + slotKey + '\', \'' + w.k + '\')" class="px-1.5 py-0.5 rounded text-[10px] transition ' + active + ' cursor-pointer">' + w.l + '</button>';
            }).join('');

            var cardContent = '';
            if (item) {
                var typeChar = item.isShurei ? '(襲令)' : '(内政)';
                var borderCol = item.isShurei ? 'border-amber-400' : 'border-blue-500';
                var badgeCol = item.isShurei ? 'border-amber-400 text-amber-400' : 'border-blue-500 text-blue-400';
                var adjList = setup.assignedAdjutantsMap ? setup.assignedAdjutantsMap[item.card.uniqueId] : null;
                var adjAddedB = (setup.adjutantAddedBuffMap && setup.adjutantAddedBuffMap[item.card.uniqueId]) || 0;
                var totalSlotBuff = item.gMult + adjAddedB;
                cardContent = `
                    <div class="relative border ${borderCol} rounded-lg p-1.5 opacity-90 hover:opacity-100 hover:z-40 transition w-full mt-1">
                        ${SharedUI.getCardVisualHTML(getDisplayCard(item.card, setup), adjList)}
                        <div class="absolute -top-2 -right-2 bg-black border ${badgeCol} text-[8px] px-1 rounded-full shadow-md z-10 font-mono text-center leading-tight pointer-events-none">
                            将+${SharedDB.formatBuffNum(totalSlotBuff)}% ${typeChar}
                        </div>
                    </div>
                `;
            } else {
                cardContent = '<div class="w-full aspect-[3/4] border-2 border-dashed border-gray-800 rounded-lg flex flex-col items-center justify-center text-gray-600 text-xs mt-1"><i class="fa-solid fa-user-slash mb-1 text-base"></i><span>未配置</span></div>';
            }

            return `
                <div class="bg-sangoku-dark border border-gray-800 rounded-xl p-2 flex flex-col items-center">
                    <div class="w-full flex items-center justify-between pb-1 mb-1 border-b border-gray-800">
                        <span class="text-[11px] font-bold text-gray-300">${slotTitle}</span>
                        <div class="flex space-x-1">${weatherBtns}</div>
                    </div>
                    ${cardContent}
                </div>
            `;
        };

        var renderCardListHTML = function(list, isGuard) {
            if (!Array.isArray(list) || list.length === 0) return '<div class="text-xs text-gray-500 p-2 border border-dashed border-gray-800 rounded text-center col-span-full">該当なし</div>';
            return list.map(function(s) {
                var adjList = setup.assignedAdjutantsMap ? setup.assignedAdjutantsMap[s.card.uniqueId] : null;
                var adjAddedB = (setup.adjutantAddedBuffMap && setup.adjutantAddedBuffMap[s.card.uniqueId]) || 0;
                var adjAddedGk = (setup.adjutantAddedGekireiMap && setup.adjutantAddedGekireiMap[s.card.uniqueId]) || 0;
                var totalGekirei = (s.rawAdd || 0) + adjAddedGk;
                var totalBuff = (s.gMult || 0) + adjAddedB;
                var gekireiObj = s.isGekirei ? { bonus: totalGekirei, series: s.series || '檄令' } : null;
                var badgeText = (s.isGekirei && totalGekirei > 0) ? ('素攻+' + totalGekirei.toLocaleString() + (isGuard ? ' (警護)' : '')) : ('将+' + SharedDB.formatBuffNum(totalBuff) + '% ' + (isGuard ? '(警護)' : '(自動)'));

                return `
                <div class="relative border ${s.isGekirei ? 'border-cyan-500' : isGuard ? 'border-purple-500' : 'border-gray-500'} rounded-lg p-1.5 opacity-90 hover:opacity-100 hover:z-40 transition">
                    ${SharedUI.getCardVisualHTML(getDisplayCard(s.card, setup), adjList, gekireiObj)}
                    <div class="absolute -top-2 -right-2 bg-black border ${s.isGekirei ? 'border-cyan-400 text-cyan-300' : isGuard ? 'border-purple-500 text-purple-400' : 'border-gray-500 text-gray-300'} text-[8px] px-1 rounded-full shadow-md z-10 font-mono text-center leading-tight pointer-events-none">
                        ${badgeText}
                    </div>
                    ${s.isBound ? '<div class="absolute -top-2 left-0 bg-red-600 border border-red-400 text-white text-[8px] px-1 rounded-full shadow-md z-30 font-bold pointer-events-none">拠点縛り</div>' : ''}
                </div>
            `;}).join('');
        };

        var extraBadges = '';
        var multFormula = '';
        if (isBuff10) {
            extraBadges += '<span class="bg-red-600 text-white text-[10px] font-bold px-2 py-0.5 rounded shadow">課金 ×1.1</span>';
            multFormula = ' × 1.1 <span class="text-red-400 font-bold">(課金10%UP)</span>';
        }
        if (setup.goBuff > 0) extraBadges += '<span class="bg-cyan-700 text-white text-[10px] font-bold px-2 py-0.5 rounded shadow">伍 +' + setup.goBuff + '%</span>';
        var leadAdjList = setup.assignedAdjutantsMap ? setup.assignedAdjutantsMap[setup.lead.uniqueId] : null;
        var leadAdjAddedB = (setup.adjutantAddedBuffMap && setup.adjutantAddedBuffMap[setup.lead.uniqueId]) || 0;
        var leadTotalDisplayBuff = setup.leadGMult + leadAdjAddedB;
        var leadAdjAtkAdd = SharedDB.safeNum(setup.leadAdjutantAtkBonus, 0);

        var soldierCardsHTML = SOLDIER_ORDER.map(function(sKey) {
            var meta = SOLDIER_META[sKey];
            var cand = setup.topBySoldier ? setup.topBySoldier[sKey] : null;
            var isCurrent = (setup.selectedSoldierFilter === sKey);
            var borderClass = isCurrent ? 'border-amber-400 bg-amber-950/30 shadow-[0_0_12px_rgba(251,191,36,0.25)]' : 'border-gray-800 bg-black/50 hover:border-gray-600';

            if (!cand) {
                return `
                    <button type="button" onclick="SoloEngine.setSoldierFilter('${sKey}')" class="p-2.5 rounded-xl border ${borderClass} text-left transition cursor-pointer">
                        <div class="flex items-center justify-between mb-1">
                            <span class="text-[10px] font-bold px-1.5 py-0.5 rounded ${meta.badgeColor}">${meta.short}</span>
                            <span class="text-[9px] text-gray-500">なし</span>
                        </div>
                        <div class="text-[11px] text-gray-500 mt-1.5">該当武将なし</div>
                    </button>
                `;
            }

            var estDmg = 0;
            var candAdjAtk = SharedDB.safeNum(cand.adjAtkBonus, 0);
            var candAdjBuff = SharedDB.safeNum(cand.adjBuffBonus, 0);
            if (isCurrent) {
                estDmg = setup.finalTotalDamage;
            } else {
                var supportOnlyMult = setup.finalGenMult - leadTotalDisplayBuff;
                var estMult = supportOnlyMult + cand.gMult + candAdjBuff;
                var estEffAtk = SharedDB.safeNum(cand.card.baseAttack, 1000) + candAdjAtk + setup.gekireiBonusTotal;
                estDmg = Math.floor(estEffAtk * (1 + estMult / 100) * (setup.buff10Multiplier || 1.0));
            }

            var totalCandBase = SharedDB.safeNum(cand.card.baseAttack, 0) + candAdjAtk;
            var totalCandSkill = cand.gMult + candAdjBuff;

            return `
                <button type="button" onclick="SoloEngine.setSoldierFilter('${sKey}')" class="p-2.5 rounded-xl border ${borderClass} text-left transition cursor-pointer group">
                    <div class="flex items-center justify-between mb-1">
                        <span class="text-[10px] font-bold px-1.5 py-0.5 rounded ${meta.badgeColor}">${meta.short}</span>
                        ${isCurrent ? '<span class="text-[9px] text-amber-400 font-bold"><i class="fa-solid fa-check mr-0.5"></i>選択中</span>' : '<span class="text-[9px] text-gray-400 group-hover:text-amber-300">切替 <i class="fa-solid fa-arrow-right"></i></span>'}
                    </div>
                    <div class="text-xs font-bold text-white truncate mt-1">${cand.card.name}</div>
                    <div class="text-sm font-bold text-red-400 font-mono mt-0.5">${estDmg.toLocaleString()}</div>
                    <div class="text-[9px] text-gray-400 font-mono truncate">基礎 ${totalCandBase.toLocaleString()}</div>
                    <div class="text-[9px] text-amber-300 font-mono truncate">スキル +${SharedDB.formatBuffNum(totalCandSkill)}%</div>
                </button>
            `;
        }).join('');

        var curMeta = SOLDIER_META[setup.selectedSoldierFilter] || SOLDIER_META.HAMMER;
        var soldierCompareBarHTML = `
            <div class="bg-sangoku-cardBg border border-sangoku-cardBorder p-4 rounded-xl shadow-md mb-4">
                <div class="flex items-center justify-between mb-2.5">
                    <div class="text-xs font-bold text-gray-300 flex items-center space-x-2">
                        <i class="fa-solid fa-chart-simple text-amber-400"></i>
                        <span>7兵科別 単騎エース火力比較（錘・双・斧・弓・槍・馬・剣）</span>
                    </div>
                    <span class="text-[10px] text-gray-400">※クリックで各兵科の専用最適化へ切替</span>
                </div>
                <div class="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
                    ${soldierCardsHTML}
                </div>
            </div>
        `;

        area.className = "space-y-6 animate-flash";
        area.innerHTML = soldierCompareBarHTML + `
            <div class="bg-sangoku-dark border border-sangoku-cardBorder p-5 rounded-xl shadow-lg mb-6">
                <div class="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 border-b border-gray-800 pb-4 gap-4">
                    <div>
                        <div class="flex flex-wrap items-center gap-1.5 mb-2">
                            <span class="text-[10px] font-bold px-2 py-0.5 rounded shadow ${curMeta.badgeColor}">${curMeta.short}単騎</span>
                            ${extraBadges}
                            <h3 class="text-lg font-bold text-white ml-1">【出撃拠点: <span class="${originColor}">${originName}</span>】</h3>
                        </div>
                        <div class="grid grid-cols-2 sm:grid-cols-6 gap-2 bg-black/40 p-2.5 rounded-lg border border-gray-800 font-mono text-xs">
                            <div><span class="text-gray-400 block text-[10px]">主将素攻:</span><span class="text-white font-bold">${SharedDB.safeNum(setup.lead.baseAttack, 1000).toLocaleString()}</span></div>
                            <div><span class="text-gray-400 block text-[10px]">副将武ステ加算:</span><span class="text-purple-400 font-bold">+${leadAdjAtkAdd.toLocaleString()}</span></div>
                            <div><span class="text-gray-400 block text-[10px]">檄令加算合計:</span><span class="text-cyan-400 font-bold">+${setup.gekireiBonusTotal.toLocaleString()}</span></div>
                            <div><span class="text-gray-400 block text-[10px]">実質基礎攻撃力:</span><span class="text-amber-300 font-bold text-sm">${setup.effectiveAttack.toLocaleString()}</span></div>
                            <div><span class="text-gray-400 block text-[10px]">主将スキル(副込):</span><span class="text-orange-400 font-bold">+${SharedDB.formatBuffNum(leadTotalDisplayBuff)}%</span></div>
                            <div><span class="text-gray-400 block text-[10px]">総武将バフ:</span><span class="text-red-400 font-bold text-sm">+${SharedDB.formatBuffNum(setup.finalGenMult)}%</span></div>
                        </div>
                    </div>
                    <div class="text-right bg-black/60 p-4 rounded-xl border border-gray-700 w-full md:w-auto shadow-inner">
                        <div class="text-xs text-gray-400 mb-1 text-center md:text-right">${curMeta.short}単騎 最終総合攻撃力</div>
                        <div class="text-3xl font-bold text-red-400 font-mono drop-shadow-md text-center md:text-right">${setup.finalTotalDamage.toLocaleString()}</div>
                        <div class="text-[10px] text-gray-400 mt-2 text-center md:text-right leading-relaxed bg-black/40 p-2 rounded border border-gray-800">
                            ＝ [ (${setup.effectiveAttack.toLocaleString()}) × (1 + ${SharedDB.formatBuffNum(setup.finalGenMult)}%) ]${multFormula}
                        </div>
                    </div>
                </div>
                
                <div class="mb-2 text-sm text-gray-300 font-bold border-l-4 border-red-500 pl-2">${curMeta.short}単騎エース武将 <span class="text-xs text-gray-500 font-normal">(${originName} に配置)</span></div>
                <div class="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-3 mb-8">
                    <div class="relative border-2 border-red-500 rounded-lg p-1.5 shadow-[0_0_15px_rgba(239,68,68,0.3)] hover:z-40">
                        ${SharedUI.getCardVisualHTML(getDisplayCard(setup.lead, setup), leadAdjList)}
                        <div class="absolute -top-2 -right-2 bg-black border border-red-500 text-red-400 text-[8px] px-1.5 py-0.5 rounded-full shadow-md z-10 font-mono text-center leading-tight pointer-events-none">
                            将+${SharedDB.formatBuffNum(leadTotalDisplayBuff)}%${leadAdjAtkAdd > 0 ? '<br>武+' + leadAdjAtkAdd.toLocaleString() : ''}
                        </div>
                    </div>
                </div>
                
                <div class="mb-6 border border-gray-700 rounded-lg p-4 bg-gray-900/50">
                    <div class="text-md font-bold text-white mb-2 flex justify-between border-b border-gray-700 pb-2">
                        <span><i class="fa-solid fa-chess-rook text-amber-500 mr-2"></i>本拠 に配置するサポート</span>
                        <span class="text-xs font-mono ${setup.honkyoCost > setup.honkyoLimit ? 'text-red-400' : 'text-gray-300'} font-bold">表コスト: ${setup.honkyoCost.toFixed(1)} / ${setup.honkyoLimit.toFixed(1)}</span>
                    </div>
                    <div class="text-xs text-blue-400 mb-2"><i class="fa-solid fa-hand-pointer mr-1"></i>内政セット枠 (手動)</div>
                    <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 mb-4">${renderActiveSlotHTML('h0', '1. 本拠')}${renderActiveSlotHTML('h1', '2. 塔')}</div>
                    <div class="text-xs text-gray-400 mb-1"><i class="fa-solid fa-bolt mr-1"></i>出撃デッキ空き枠 (パッシブ・檄令: ${setup.chosenBasePassives.length}枚)</div>
                    <div class="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-3 mb-4">${renderCardListHTML(setup.chosenBasePassives, false)}</div>
                    <div class="mt-4 border-t border-gray-700 pt-2 flex justify-between text-xs text-purple-400 mb-1">
                        <span><i class="fa-solid fa-shield-halved mr-1"></i>裏・警護デッキ (${setup.chosenBaseGuards.length}枚)</span>
                        <span class="font-mono text-gray-400 font-bold">裏コスト: ${setup.honkyoGuardCost.toFixed(1)} / ${setup.honkyoLimit.toFixed(1)}</span>
                    </div>
                    <div class="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-3">${renderCardListHTML(setup.chosenBaseGuards, true)}</div>
                </div>

                <div class="border border-gray-700 rounded-lg p-4 bg-gray-900/50">
                    <div class="text-md font-bold text-white mb-2 flex justify-between border-b border-gray-700 pb-2">
                        <span><i class="fa-solid fa-tents text-blue-400 mr-2"></i>拠点＋ に配置するサポート</span>
                        <span class="text-xs font-mono ${setup.kyotenCost > setup.kyotenLimit ? 'text-red-400' : 'text-gray-300'} font-bold">表コスト: ${setup.kyotenCost.toFixed(1)} / ${setup.kyotenLimit.toFixed(1)}</span>
                    </div>
                    <div class="text-xs text-blue-400 mb-2"><i class="fa-solid fa-hand-pointer mr-1"></i>内政セット枠 (手動)</div>
                    <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mb-4">
                        ${renderActiveSlotHTML('k0', '3. 拠点1')}${renderActiveSlotHTML('k1', '4. 拠点2')}${renderActiveSlotHTML('k2', '5. 拠点3')}
                        ${renderActiveSlotHTML('k3', '6. 拠点4')}${renderActiveSlotHTML('k4', '7. 拠点5')}${renderActiveSlotHTML('k5', '8. 拠点6')}
                        ${renderActiveSlotHTML('k6', '9. 拠点7')}${renderActiveSlotHTML('k7', '10. 拠点8')}${renderActiveSlotHTML('k8', '11. 拠点9')}
                    </div>
                    <div class="text-xs text-gray-400 mb-1"><i class="fa-solid fa-bolt mr-1"></i>出撃デッキ空き枠 (パッシブ・檄令: ${setup.chosenSubPassives.length}枚)</div>
                    <div class="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-3 mb-4">${renderCardListHTML(setup.chosenSubPassives, false)}</div>
                    <div class="mt-4 border-t border-gray-700 pt-2 flex justify-between text-xs text-purple-400 mb-1">
                        <span><i class="fa-solid fa-shield-halved mr-1"></i>裏・警護デッキ (${setup.chosenSubGuards.length}枚)</span>
                        <span class="font-mono text-gray-400 font-bold">裏コスト: ${setup.kyotenGuardCost.toFixed(1)} / ${setup.kyotenLimit.toFixed(1)}</span>
                    </div>
                    <div class="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-3">${renderCardListHTML(setup.chosenSubGuards, true)}</div>
                </div>
            </div>
        `;
    }

    return {
        run: run,
        resetFilter: function() { selectedSoldierFilter = null; },
        changeAdjutantMode: function(val) { adjutantMode = val; run(true); },
        setSoldierFilter: function(sKey) {
            if (!sKey || !SOLDIER_META[sKey]) return;
            selectedSoldierFilter = sKey;
            syncSoldierFilterButtons(selectedSoldierFilter);
            run(true);
        },
        setBuff10: function(val) {
            isBuff10 = val;
            var btnOff = document.getElementById('btnSoloBuff10Off');
            var btnOn = document.getElementById('btnSoloBuff10On');
            var lbl = document.getElementById('labelSoloBuff10Status');
            if (val) {
                if (btnOff) btnOff.className = "py-1 text-xs font-bold rounded-lg transition text-gray-400 hover:text-white cursor-pointer";
                if (btnOn) btnOn.className = "py-1 text-xs font-bold rounded-lg transition bg-red-600 text-white shadow cursor-pointer";
                if (lbl) lbl.innerHTML = '<span class="text-red-400 font-bold">ON (×1.1)</span>';
            } else {
                if (btnOff) btnOff.className = "py-1 text-xs font-bold rounded-lg transition bg-gray-700 text-white shadow cursor-pointer";
                if (btnOn) btnOn.className = "py-1 text-xs font-bold rounded-lg transition text-gray-400 hover:text-white cursor-pointer";
                if (lbl) lbl.textContent = "OFF (×1.0)";
            }
            if (currentSetup) run(false);
        },
        setGoEnabled: function(val) {
            isGoEnabled = val;
            var btnOff = document.getElementById('btnSoloGoOff');
            var btnOn = document.getElementById('btnSoloGoOn');
            var lbl = document.getElementById('labelSoloGoStatus');
            var input = document.getElementById('optSoloGoBuff');
            var currentVal = SharedDB.safeNum(input && input.value, goBuffValue);
            if (val) {
                if (btnOff) btnOff.className = "py-1 text-xs font-bold rounded-lg transition text-gray-400 hover:text-white cursor-pointer";
                if (btnOn) btnOn.className = "py-1 text-xs font-bold rounded-lg transition bg-cyan-600 text-white shadow cursor-pointer";
                if (lbl) lbl.innerHTML = '<span class="text-cyan-400 font-bold">ON (+' + currentVal + '%)</span>';
            } else {
                if (btnOff) btnOff.className = "py-1 text-xs font-bold rounded-lg transition bg-gray-700 text-white shadow cursor-pointer";
                if (btnOn) btnOn.className = "py-1 text-xs font-bold rounded-lg transition text-gray-400 hover:text-white cursor-pointer";
                if (lbl) lbl.textContent = "OFF (0%)";
            }
            if (currentSetup) run(false);
        },
        updateGoBuff: function(val) {
            goBuffValue = SharedDB.safeNum(val, 7000);
            if (isGoEnabled) {
                var lbl = document.getElementById('labelSoloGoStatus');
                if (lbl) lbl.innerHTML = '<span class="text-cyan-400 font-bold">ON (+' + goBuffValue + '%)</span>';
            }
            if (currentSetup) run(false);
        }
    };
})();