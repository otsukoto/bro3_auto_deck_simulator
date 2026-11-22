// ========================================================
// 【単騎火力計算エンジン】js/engine-solo.js (Ver. 2.07)
// 役割：単騎攻撃・破壊10枠最適化、帝仙鏡(コスト1化)優先割当修正、乗算ダメージ実測フィードバック型2パス反復2次元DP、一般副将レアリティ倍率（SL80%/L70%/UR60%/SR50%/R40%）＆警護「警悟」限定対応
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

    // 一般武将を副将にセットした際のレアリティ別スキル発動倍率
    var GENERAL_ADJUTANT_RARITY_RATES = {
        'SL': 0.80,
        'L':  0.70,
        'UR': 0.60,
        'SR': 0.50,
        'R':  0.40,
        'UC': 0.30,
        'C':  0.20
    };

    function getGeneralAdjutantRarityRatio(rarity) {
        var r = String(rarity || 'R').toUpperCase();
        return GENERAL_ADJUTANT_RARITY_RATES[r] !== undefined ? GENERAL_ADJUTANT_RARITY_RATES[r] : 0.40;
    }

    function isTeisenMirrorItem(m) {
        if (!m) return false;
        if (m.info && (m.info.type === 'senkyo' || m.info.type === 'teisen' || m.info.type === 'teisenkyo')) return true;
        var nm = String((m.card && m.card.name) || m.name || '') + ' ' + String((m.info && m.info.label) || '');
        return nm.indexOf('帝仙鏡') !== -1 || nm.indexOf('仙鏡') !== -1;
    }

    function cardHasEquippedTeisen(c) {
        if (!c || !Array.isArray(c.fukusho)) return false;
        return c.fukusho.some(function(fk) {
            if (!fk) return false;
            var t = String(fk.name || '') + ' ' + String(fk.label || '') + ' ' + String(fk.description || '');
            return t.indexOf('帝仙鏡') !== -1 || t.indexOf('仙鏡') !== -1;
        });
    }

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

    function getSelfMirrorCopyRatio(skill) {
        if (!skill || typeof skill !== 'object') return 1.0;
        var sName = String(skill.name || '').trim();
        var mLv = sName.match(/(?:LV|Lv|lv|ＬＶ)\s*([0-9]+)/);
        if (mLv) {
            var lv = parseInt(mLv[1], 10);
            if (!isNaN(lv) && lv > 0) {
                return Math.min(1.0, lv * 0.1);
            }
        }
        return SharedDB.getMasterMirrorCopyRate(skill);
    }

    function isMasterFirstSkillMirror(sName, sDesc, firstDesc, isFromAdjutant, isHa) {
        if (isFromAdjutant) return false;
        if (sName.indexOf("副将の") !== -1) return false;

        var isVarPrefix = (sName.indexOf("変:") === 0) || (isHa && sName.indexOf("副変:") === 0);
        var hasMirrorKeyword = (
            sName.indexOf("主将の") !== -1 ||
            sName.indexOf("明鏡") !== -1 ||
            sName.indexOf("明鑑") !== -1 ||
            sName.indexOf("王春の") !== -1 ||
            sDesc.indexOf("1つ目のスキル") !== -1 ||
            sDesc.indexOf("１つ目のスキル") !== -1 ||
            sDesc.indexOf("最初のスキル") !== -1 ||
            sDesc.indexOf("第1スキル") !== -1
        );
        if (hasMirrorKeyword) return true;

        if (isVarPrefix && firstDesc && sDesc) {
            var norm1 = firstDesc.replace(/[\s ,，、。]/g, '');
            var norm2 = sDesc.replace(/[\s ,，、。]/g, '');
            if (norm1 === norm2) return true;
            var skel1 = norm1.replace(/[0-9\.]+/g, '#');
            var skel2 = norm2.replace(/[0-9\.]+/g, '#');
            if (skel1.length >= 10 && skel1 === skel2) return true;
        }
        return false;
    }

    function calcWeatherMultSafe(rawDesc, weatherObj, targetStat) {
        var cleaned = String(rawDesc || '')
            .replace(/（/g, ' ')
            .replace(/）/g, ' ')
            .replace(/\(/g, ' ')
            .replace(/\)/g, ' ');
        var clauses = cleaned.split(
            /[。\n\r]+|\s+(?=(?:晴天候|晴天|荒天|陰天|悪天候|雨天候|雨天|曇天候|曇天|雪天候|雪天|天候が|(?:[曇雨雪][、・\/／\s]+){1,2}[曇雨雪](?:天候|の時|時)|コスト|兵数|距離|武将|全武将|全兵))/
        );
        var isSun = (weatherObj === 'SUN');
        var isBad = (weatherObj === 'CLOUD' || weatherObj === 'RAIN' || weatherObj === 'SNOW');
        var bestMult = 1.0;

        for (var i = 0; i < clauses.length; i++) {
            var c = clauses[i].trim();
            if (!c) continue;

            if (!/([0-9\.]+)\s*倍/.test(c)) continue;

            var matchedWeather = false;
            if (isSun && /(?:晴天候|晴天|晴の時|天候が晴)/.test(c)) matchedWeather = true;
            if (isBad && /(?:荒天|陰天|悪天候|(?:[曇雨雪][、・\/／\s]+){1,2}[曇雨雪])/.test(c)) matchedWeather = true;
            if (weatherObj === 'RAIN' && /(?:雨天候|雨天|雨の時|天候が雨)/.test(c)) matchedWeather = true;
            if (weatherObj === 'CLOUD' && /(?:曇天候|曇天|曇の時|天候が曇)/.test(c)) matchedWeather = true;
            if (weatherObj === 'SNOW' && /(?:雪天候|雪天|雪の時|天候が雪)/.test(c)) matchedWeather = true;
            if (!matchedWeather) continue;

            var hasTarget = (c.indexOf(targetStat) !== -1) || (c.indexOf('効果') !== -1) || (c.indexOf('威力') !== -1);
            var hasOtherStat = /(?:移動速度|移速|討伐ゲージ|経験値|資源|知力)/.test(c) ||
                               (targetStat === '攻撃' && c.indexOf('防御') !== -1 && c.indexOf('攻撃') === -1) ||
                               (targetStat === '防御' && c.indexOf('攻撃') !== -1 && c.indexOf('防御') === -1);
            if (hasOtherStat && !hasTarget) continue;

            var reSpecific = new RegExp('(?:効果|威力|' + targetStat + '(?:力)?)[がはのを]?\\s*([0-9\\.]+)\\s*倍');
            var mMult = c.match(reSpecific);
            if (!mMult) {
                mMult = c.match(/(?:晴天候|晴天|荒天|陰天|悪天候|雨天候|雨天|曇天候|曇天|雪天候|雪天|(?:[曇雨雪][、・\/／\s]+){1,2}[曇雨雪])(?:天候)?[はの時に]?\s*([0-9\.]+)\s*倍/);
            }
            if (mMult) {
                var val = parseFloat(mMult[1]);
                if (!isNaN(val) && val > 1.0) {
                    bestMult = Math.max(bestMult, val);
                }
            }
        }
        return bestMult;
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
        if (lbl && SOLDIER_META[activeKey]) lbl.textContent = SOLDIER_META[activeKey].label;
    }

    function parseSkill(skill, weatherObj) {
        var empty = {
            gMult: 0, leadBuff: 0, rawAdd: 0,
            isGekirei: false, isPassive: false, isGuard: false,
            mustBeSameBase: false, isShurei: false,
            isLead: false, isSupport: false, isDefPrefix: false, isNaiseiActive: false
        };
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
        res.isDefPrefix = (name.indexOf("防:") === 0);
        var isVarPrefix = (name.indexOf("変:") === 0 || name.indexOf("副変:") === 0);

        var hasExplicitManual = /(?:スキル使用中|スキル発動時|発動すると|一定時間|勅令|襲令|斗魂令|号令|戦陣|極意)/.test(normDesc) &&
                                normDesc.indexOf("自動で発動") === -1 && normDesc.indexOf("自動発動") === -1;

        if (!hasExplicitManual && (
            normDesc.indexOf("自動で発動") !== -1 ||
            normDesc.indexOf("自動発動") !== -1 ||
            normDesc.indexOf("全滅時も発動") !== -1 ||
            normDesc.indexOf("パッシブ") !== -1 ||
            normDesc.indexOf("常に発動") !== -1 ||
            normDesc.indexOf("常時発動") !== -1 ||
            normDesc.indexOf("デッキにセット") !== -1 ||
            /(?:王威令|覇王令)/.test(name)
        )) {
            res.isPassive = true;
        }
        if (normDesc.indexOf("警護デッキ") !== -1 || name.indexOf("警悟") !== -1 || normDesc.indexOf("警悟") !== -1) {
            res.isGuard = true;
            res.isPassive = true;
        }
        if (name.indexOf("檄令") !== -1 || normDesc.indexOf("主将の攻撃力が増加") !== -1 || normDesc.indexOf("全武将の攻撃力が増加") !== -1) {
            res.isGekirei = true;
            res.isPassive = true;
            res.isSupport = true;
        }

        var isSelfOnly = isAttackSkill || (
            /(?:進攻|突撃|強襲|遼来撃|猛撃|豪撃|極撃|天撃|神撃|帝撃|龍撃|覇撃|烈撃|雷光|神速|飛将|闘将|騎将|槍将|弓将|攻城|破砕|衝車|劫略|撃破|一騎当千|覇道|滅亡|武神|闘神|軍神)/.test(name) ||
            /(?:自身の攻撃力|この武将の攻撃力|全滅時も発動|討伐ゲージ|持ち帰る資源)/.test(normDesc)
        );

        var affectsGenerals = /(?:全武将|全ての武将|すべての武将|武将|全軍)/.test(normRawDesc) && normRawDesc.indexOf("武将を除く") === -1;
        var isTrueSupportAura = !isAttackSkill && !isSelfOnly && (
            affectsGenerals ||
            /(?:勅令|襲令|斗魂令)/.test(name)
        );

        var isGlobalAura = /(?:全拠点|全ての拠点|すべての拠点|自拠点.*?(?:出兵|出撃))/.test(normDesc);
        if (!isGlobalAura || normDesc.indexOf("セットした拠点") !== -1 || normDesc.indexOf("この武将をセットした拠点") !== -1 || normDesc.indexOf("所属拠点が同一") !== -1) {
            res.mustBeSameBase = true;
        }

        var wMult = calcWeatherMultSafe(normRawDesc, weatherObj, '攻撃');

        var val = 0;
        var m1 = normRawDesc.match(/(?:全武将|[^\s、。・]*?科武将|武将|自身|全軍|全拠点)[^\n。]*?攻撃(?:力)?(?:[と・、,\/](?:防御(?:力)?|移動速度|移速|知力|討伐ゲージ))*\s*[がをのは]?\s*([0-9\.]+)[%％]/);
        if (m1) {
            val = parseFloat(m1[1]);
        } else {
            var m2 = normRawDesc.match(/(?:兵士|軍|兵科|全兵)[、，・,\/\s]+(?:[^\s、。]+科)?武将[^\n。]*?攻撃(?:力)?(?:[と・、,\/](?:防御(?:力)?|移動速度|移速))*\s*[がをのは]?\s*([0-9\.]+)[%％]/);
            if (m2) {
                val = parseFloat(m2[1]);
            } else {
                var isTroopOnlyText = /(?:兵士|槍兵|弓兵|騎兵|剣兵|斧兵|双兵|錘兵)の攻撃/.test(normRawDesc) || normRawDesc.indexOf("武将を除く") !== -1;
                if (!isTroopOnlyText || isAttackSkill) {
                    var m3 = normRawDesc.match(/攻撃(?:力)?(?:[と・、,\/](?:防御(?:力)?|移動速度|移速))*\s*[がをのは]?\s*([0-9\.]+)[%％]/);
                    if (m3) val = parseFloat(m3[1]);
                }
            }
        }

        var mExtra = normRawDesc.match(/更に(?:攻撃(?:力)?(?:[と・、,\/](?:防御(?:力)?|移動速度|移速))*\s*[がをのは]?)?\s*([0-9\.]+)[%％]/);
        if (mExtra) {
            var extraV = parseFloat(mExtra[1]);
            if (normRawDesc.indexOf("晴天候") !== -1 || normRawDesc.indexOf("晴天") !== -1) {
                if (weatherObj === 'SUN') val += extraV;
            } else if (normRawDesc.indexOf("曇") !== -1 || normRawDesc.indexOf("雨") !== -1 || normRawDesc.indexOf("雪") !== -1 || normRawDesc.indexOf("荒天") !== -1 || normRawDesc.indexOf("陰天") !== -1 || normRawDesc.indexOf("悪天候") !== -1) {
                if (['CLOUD', 'RAIN', 'SNOW'].indexOf(weatherObj) !== -1) val += extraV;
            } else {
                val += extraV;
            }
        }

        var effectiveVal = val * wMult;

        if (isSelfOnly) {
            res.isLead = true;
            res.leadBuff = effectiveVal;
            res.gMult = 0;
            res.isSupport = false;
        } else if (isTrueSupportAura || res.isGekirei) {
            res.isSupport = true;
            res.gMult = effectiveVal;
            res.leadBuff = effectiveVal;
            if ((res.isDefPrefix || isVarPrefix) && !res.isPassive) {
                res.isNaiseiActive = true;
                if (normDesc.indexOf("セットした拠点") !== -1 || normDesc.indexOf("この武将をセットした拠点") !== -1) {
                    res.isShurei = true;
                }
            }
        } else if (isVarPrefix) {
            res.isSupport = true;
            res.gMult = effectiveVal;
            res.leadBuff = effectiveVal;
            if (!res.isPassive) {
                res.isNaiseiActive = true;
            }
        } else {
            res.isLead = true;
            res.leadBuff = effectiveVal;
            res.gMult = 0;
            res.isSupport = false;
        }

        return res;
    }

    function buildSoloGeneralAdjutantCand(gCard, masterRole, weatherObj, isSameBaseAsAce) {
        if (!gCard || SharedDB.isHaBusho(gCard) || SharedDB.isMirrorCard(gCard.name)) return null;
        var skills = gCard.skills || [];
        if (skills.length === 0 || !skills[0]) return null;
        var s0 = skills[0];
        var sName = String(s0.name || '').trim();
        if (!sName || sName.indexOf('覚:') === 0 || sName.indexOf('副覚:') === 0 || isDuelSkill(s0)) return null;

        var adjRatio = getGeneralAdjutantRarityRatio(gCard.rarity);
        var p0 = parseSkill(s0, weatherObj);
        var gk0 = SharedDB.getGekireiBonus(s0, gCard.rarity, 4.5);
        var gkAdd = Math.floor(((gk0 && gk0.bonus) || 0) * adjRatio);

        if (masterRole !== 'lead' && (!p0.isSupport || !p0.isPassive)) return null;
        if (masterRole === 'guard' && !p0.isGuard) return null;
        if (!isSameBaseAsAce && p0.mustBeSameBase) return null;

        var rawGVal = (masterRole === 'lead') ? SharedDB.safeNum(p0.leadBuff, 0) : SharedDB.safeNum(p0.gMult, 0);
        var gVal = rawGVal * adjRatio;
        if (gVal <= 0 && gkAdd <= 0) return null;

        var cleanSName = sName.replace(/^(?:攻防|攻|防|変|副攻|副防|副変):/, '').replace(/LV[0-9]+$/i, '');
        var pctTag = Math.round(adjRatio * 100) + '%';
        var badge = (gkAdd > 0)
            ? ('[副' + pctTag + ']' + cleanSName + ' 檄+' + gkAdd.toLocaleString())
            : ('[副' + pctTag + ']' + cleanSName + ' 将+' + SharedDB.formatBuffNum(gVal) + '%');

        return {
            card: gCard, uniqueId: gCard.uniqueId, cardNo: gCard.cardNo,
            genGMult: gVal, genRaw: gkAdd, label: badge,
            genStats: { soloG: gVal, soloGk: gkAdd }
        };
    }

    function evaluateCard(card, weatherObj, mode, masterCost) {
        var emptySupport = {
            gMult: 0, rawAdd: 0, firstRawAdd: 0, firstGMult: 0,
            naiseiGMult: 0, naiseiRawAdd: 0, naiseiFirstGMult: 0, naiseiMarginalGain: 0,
            canBePassiveSlot: false, canBeGuardSlot: false, canBeNaiseiSlot: false,
            passiveMustBeSameBase: false, naiseiMustBeSameBase: false,
            isShurei: false, isGekirei: false, series: null
        };
        var skills = (card && card.skills) || [];
        if (skills.length === 0) return emptySupport;

        var isHa = SharedDB.isHaBusho(card);
        var kMultSelf = SharedDB.getKakuseiMultiplier(card);
        var firstSkill = skills[0];
        var firstDesc = String((firstSkill && firstSkill.description) || '').trim();
        var firstGk = (!isDuelSkill(firstSkill)) ? SharedDB.getGekireiBonus(firstSkill, card.rarity, masterCost) : { bonus: 0, series: null };
        var isGekirei = (firstGk && firstGk.bonus > 0);
        var baseGkBonus = isGekirei ? firstGk.bonus : 0;
        var seriesName = isGekirei ? firstGk.series : null;

        var p0 = parseSkill(firstSkill, weatherObj);
        var firstVal = (mode === 'lead') ? (p0.leadBuff || 0) : (p0.gMult || 0);

        if (mode === 'lead') {
            var leadPassiveRaw = baseGkBonus;
            var leadPassiveBuff = 0;
            var leadActiveCands = [];
            if (!isGekirei && firstVal > 0) {
                if (p0.isPassive) leadPassiveBuff += firstVal;
                else leadActiveCands.push(firstVal);
            }
            for (var li = 1; li < skills.length; li++) {
                var ls = skills[li];
                if (!ls) continue;
                var lName = String(ls.name || '').trim();
                var lDesc = String(ls.description || '').trim();
                if (lName.indexOf("覚:") === 0 || lName.indexOf("副覚:") === 0 || lName.indexOf("覚醒") !== -1) continue;
                if (isDuelSkill(ls)) continue;
                var lFromAdj = (lName.indexOf("副:") === 0 || lName.indexOf("副変:") === 0 || lName.indexOf("副攻:") === 0 || lName.indexOf("副防:") === 0 || lName.indexOf("副ﾃﾞｭｴﾙ:") === 0);
                if (!isHa && lFromAdj) continue;

                var lSelfMir = isMasterFirstSkillMirror(lName, lDesc, firstDesc, lFromAdj, isHa);
                if (lSelfMir) {
                    var lpi = parseSkill(ls, weatherObj);
                    var lWritten = lpi.leadBuff || 0;
                    if (lWritten > 0) {
                        leadPassiveBuff += lWritten;
                    } else {
                        var lRate = getSelfMirrorCopyRatio(ls);
                        if (isGekirei && baseGkBonus > 0) {
                            leadPassiveRaw += Math.floor((baseGkBonus / kMultSelf) * lRate);
                        } else if (firstVal > 0) {
                            leadPassiveBuff += (firstVal / kMultSelf) * lRate;
                        }
                    }
                    continue;
                }
                if (lName.indexOf("檄令") !== -1 || lDesc.indexOf("主将の攻撃力が増加") !== -1) {
                    var lgk = SharedDB.getGekireiBonus(ls, card.rarity, masterCost);
                    leadPassiveRaw += (lgk && lgk.bonus) || 0;
                } else {
                    var lpi2 = parseSkill(ls, weatherObj);
                    var lBuff = lpi2.leadBuff || 0;
                    if (lBuff > 0) {
                        if (lpi2.isPassive || lFromAdj) leadPassiveBuff += lBuff;
                        else leadActiveCands.push(lBuff);
                    }
                }
            }
            var leadActiveSum = 0;
            if (leadActiveCands.length > 0) {
                if (isHa) {
                    for (var lai = 0; lai < leadActiveCands.length; lai++) leadActiveSum += leadActiveCands[lai];
                } else {
                    leadActiveCands.sort(function(a, b) { return b - a; });
                    leadActiveSum = leadActiveCands[0];
                }
            }
            return {
                gMult: leadPassiveBuff + leadActiveSum,
                rawAdd: leadPassiveRaw,
                firstRawAdd: baseGkBonus,
                firstGMult: firstVal
            };
        }

        // サポート（mode === 'support'）評価
        var passiveOnlyRaw = baseGkBonus;
        var passiveOnlyBuff = 0;
        var naiseiMirrorBuff = 0;
        var naiseiActiveCands = [];
        var isGuardCard = p0.isGuard;
        var passiveMustBeSameBase = false;

        var firstIsPassiveSupport = isGekirei || (p0.isSupport && p0.isPassive && firstVal > 0);
        var firstIsNaiseiActive = (!isGekirei && p0.isNaiseiActive && firstVal > 0);

        if (firstIsPassiveSupport) {
            if (!isGekirei) passiveOnlyBuff += firstVal;
            if (p0.mustBeSameBase) passiveMustBeSameBase = true;
        } else if (firstIsNaiseiActive) {
            naiseiActiveCands.push({ val: firstVal, isShurei: p0.isShurei, mustBeSameBase: p0.mustBeSameBase });
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

            var pi = parseSkill(s, weatherObj);
            var isShujoMirror = isMasterFirstSkillMirror(sName, sDesc, firstDesc, isFromAdjutant, isHa);

            if (isShujoMirror) {
                var writtenVal = pi.gMult || 0;
                if (writtenVal > 0) {
                    if (firstIsPassiveSupport) {
                        passiveOnlyBuff += writtenVal;
                        if (p0.mustBeSameBase) passiveMustBeSameBase = true;
                    } else if (firstIsNaiseiActive) {
                        naiseiMirrorBuff += writtenVal;
                    }
                } else {
                    var copyRateRatio = getSelfMirrorCopyRatio(s);
                    if (firstIsPassiveSupport) {
                        if (isGekirei && baseGkBonus > 0) passiveOnlyRaw += Math.floor((baseGkBonus / kMultSelf) * copyRateRatio);
                        else if (firstVal > 0) passiveOnlyBuff += (firstVal / kMultSelf) * copyRateRatio;
                    } else if (firstIsNaiseiActive && firstVal > 0) {
                        naiseiMirrorBuff += (firstVal / kMultSelf) * copyRateRatio;
                    }
                }
                continue;
            }

            if (sName.indexOf("檄令") !== -1 || sDesc.indexOf("主将の攻撃力が増加") !== -1) {
                var gk_i = SharedDB.getGekireiBonus(s, card.rarity, masterCost);
                passiveOnlyRaw += (gk_i && gk_i.bonus) || 0;
            } else {
                var sBuff = pi.gMult || 0;
                if (sBuff > 0 && pi.isSupport) {
                    if (pi.isPassive) {
                        passiveOnlyBuff += sBuff;
                        if (pi.mustBeSameBase) passiveMustBeSameBase = true;
                        if (pi.isGuard) isGuardCard = true;
                    } else if (isFromAdjutant && (sName.indexOf("副変:") === 0)) {
                        if (firstIsNaiseiActive) naiseiMirrorBuff += sBuff;
                    } else if (!isFromAdjutant && pi.isNaiseiActive) {
                        naiseiActiveCands.push({ val: sBuff, isShurei: pi.isShurei, mustBeSameBase: pi.mustBeSameBase });
                    }
                }
            }
        }

        var naiseiActiveBuff = 0;
        var hasNaiseiActive = false;
        var isShureiCard = false;
        var naiseiMustBeSameBase = passiveMustBeSameBase;

        if (naiseiActiveCands.length > 0) {
            hasNaiseiActive = true;
            if (isHa) {
                for (var ai = 0; ai < naiseiActiveCands.length; ai++) {
                    naiseiActiveBuff += naiseiActiveCands[ai].val;
                    if (naiseiActiveCands[ai].isShurei) isShureiCard = true;
                    if (naiseiActiveCands[ai].mustBeSameBase) naiseiMustBeSameBase = true;
                }
            } else {
                naiseiActiveCands.sort(function(a, b) { return b.val - a.val; });
                naiseiActiveBuff = naiseiActiveCands[0].val;
                isShureiCard = Boolean(naiseiActiveCands[0].isShurei);
                if (naiseiActiveCands[0].mustBeSameBase) naiseiMustBeSameBase = true;
            }
        }

        var hasPassiveEffect = (passiveOnlyBuff > 0 || passiveOnlyRaw > 0);
        var naiseiTotalBuff = passiveOnlyBuff + naiseiMirrorBuff + naiseiActiveBuff;
        var naiseiMarginalGain = naiseiMirrorBuff + naiseiActiveBuff;

        return {
            gMult: passiveOnlyBuff,
            rawAdd: passiveOnlyRaw,
            firstRawAdd: isGekirei ? baseGkBonus : 0,
            firstGMult: (firstIsPassiveSupport && !isGekirei) ? firstVal : 0,
            naiseiGMult: naiseiTotalBuff,
            naiseiRawAdd: passiveOnlyRaw,
            naiseiFirstGMult: (firstIsPassiveSupport || firstIsNaiseiActive) ? firstVal : 0,
            naiseiMarginalGain: naiseiMarginalGain,
            canBePassiveSlot: !isGuardCard && hasPassiveEffect,
            canBeGuardSlot: isGuardCard && hasPassiveEffect,
            canBeNaiseiSlot: hasNaiseiActive,
            passiveMustBeSameBase: passiveMustBeSameBase,
            naiseiMustBeSameBase: naiseiMustBeSameBase,
            isShurei: isShureiCard,
            isGekirei: isGekirei,
            series: seriesName
        };
    }

    function getBestWeatherForCard(card, masterCost) {
        var weathers = ['SUN', 'CLOUD', 'RAIN', 'SNOW'];
        var bestPassiveW = 'SUN';
        var bestNaiseiW = 'SUN';
        var maxPassiveEval = null;
        var maxNaiseiEval = null;
        var bestPassiveScore = -1;
        var bestNaiseiScore = -1;

        for (var i = 0; i < weathers.length; i++) {
            var w = weathers[i];
            var ev = evaluateCard(card, w, 'support', masterCost);
            var pScore = (ev.gMult || 0) * 100 + (ev.rawAdd || 0);
            if (pScore > bestPassiveScore) {
                bestPassiveScore = pScore;
                maxPassiveEval = ev;
                bestPassiveW = w;
            }
            var nScore = (ev.naiseiGMult || 0) * 100 + (ev.naiseiRawAdd || 0);
            if (nScore > bestNaiseiScore) {
                bestNaiseiScore = nScore;
                maxNaiseiEval = ev;
                bestNaiseiW = w;
            }
        }
        return {
            bestWeather: bestNaiseiW,
            bestPassiveWeather: bestPassiveW,
            eval: maxPassiveEval || evaluateCard(card, 'SUN', 'support', masterCost),
            naiseiEval: maxNaiseiEval || evaluateCard(card, 'SUN', 'support', masterCost)
        };
    }

    function solveSoloDeckKnapsackWithNaiseiLimits(costLimit, maxNaiseiSlots, candidates) {
        var maxW = Math.max(0, Math.round(costLimit * 2));
        var maxN = Math.max(0, maxNaiseiSlots);
        var NEG = -1e18;

        var dp = new Array(maxW + 1);
        var pick = new Array(maxW + 1);
        for (var w = 0; w <= maxW; w++) {
            dp[w] = new Array(maxN + 1);
            pick[w] = new Array(maxN + 1);
            for (var n = 0; n <= maxN; n++) {
                dp[w][n] = NEG;
                pick[w][n] = [];
            }
        }
        dp[0][0] = 0;

        for (var i = 0; i < candidates.length; i++) {
            var it = candidates[i];
            var iw = Math.round(SharedDB.safeNum(it.effectiveCost, 0) * 2);
            if (iw <= 0 || iw > maxW) continue;
            var dn = it.isManualNaisei ? 1 : 0;
            if (dn > maxN) continue;
            var val = SharedDB.safeNum(it.dpScore, 0);

            for (var c = maxW; c >= iw; c--) {
                for (var n = maxN; n >= dn; n--) {
                    var prev = dp[c - iw][n - dn];
                    if (prev > NEG / 2) {
                        var candVal = prev + val;
                        if (candVal > dp[c][n]) {
                            dp[c][n] = candVal;
                            pick[c][n] = pick[c - iw][n - dn].concat([it]);
                        }
                    }
                }
            }
        }

        var bestVal = -1;
        var bestPicked = [];
        for (var c2 = 0; c2 <= maxW; c2++) {
            for (var n2 = 0; n2 <= maxN; n2++) {
                if (dp[c2][n2] > bestVal) {
                    bestVal = dp[c2][n2];
                    bestPicked = pick[c2][n2];
                }
            }
        }
        return { val: Math.max(0, bestVal), picked: bestPicked };
    }

    function estimateLeadWithOptimalAdjutants(card, leadGMult, firstGMult, allMirrorPool, usedTeisenIds, estSupportMult, estGekirei) {
        var baseAtk = SharedDB.safeNum(card.baseAttack, 1000);
        if (SharedDB.isHaBusho(card) || SharedDB.safeNum(card.maxFukushoCost, 0) <= 0) {
            return {
                adjAtkBonus: 0, adjBuffBonus: 0,
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
                    } else if (Array.isArray(rawFk.skills) && rawFk.skills.length > 0) {
                        var gCandCur = buildSoloGeneralAdjutantCand(rawFk, 'lead', 'SUN', true);
                        if (gCandCur) {
                            curBuffAdd += SharedDB.safeNum(gCandCur.genGMult, 0);
                            curAtkAdd += SharedDB.safeNum(gCandCur.genRaw, 0);
                        }
                    }
                });
            }
            var curTotAtk = baseAtk + curAtkAdd + estGekirei;
            var curTotMult = estSupportMult + leadGMult + curBuffAdd;
            return {
                adjAtkBonus: curAtkAdd, adjBuffBonus: curBuffAdd,
                estTotalAtk: curTotAtk, estTotalMult: curTotMult,
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
            return !fixedUsedIds.has(fk.uniqueId) && !fixedUsedNos.has(fk.cardNo) && fk.uniqueId !== card.uniqueId && fk.cardNo !== card.cardNo && !usedTeisenIds.has(fk.uniqueId);
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
            adjAtkBonus: bestComboAtk, adjBuffBonus: bestComboBuff,
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

            var isReassignMode = (adjutantMode !== 'CURRENT');
            var validCards = uCards.filter(function(c) { return !c.isAdjutant && !AppCards.excludedCardIds.has(c.uniqueId); });

            var unifiedPools = SharedDB.buildUnifiedAdjutantPools(uCards, AppCards.excludedCardIds, isReassignMode);
            var allMirrorPool = unifiedPools.mirrorPool;
            var allGeneralPool = unifiedPools.generalPool;

            // 各カードのサポート性能（全天候最大値）と襲令専用フラグを事前計算
            var supportProbeCache = Object.create(null);
            validCards.forEach(function(c) {
                supportProbeCache[c.uniqueId] = getBestWeatherForCard(c, 4.5);
            });

            // 帝仙鏡（コスト1化）の事前割り当て
            var effectiveCostMap = Object.create(null);
            var preTeisenAssignedMap = Object.create(null);
            var usedTeisenCardIds = new Set();

            validCards.forEach(function(c) {
                var baseC = SharedDB.safeNum(c.originalCost !== undefined ? c.originalCost : c.cost, 4.5);
                effectiveCostMap[c.uniqueId] = baseC;
            });

            if (adjutantMode === 'CURRENT') {
                validCards.forEach(function(c) {
                    if (cardHasEquippedTeisen(c)) {
                        effectiveCostMap[c.uniqueId] = 1.0;
                    }
                });
            } else {
                var allTeisenMirrors = allMirrorPool.filter(isTeisenMirrorItem);

                // FILL_EMPTY モードでは既に帝仙鏡が付いているカードを優先維持
                if (adjutantMode === 'FILL_EMPTY') {
                    validCards.forEach(function(c) {
                        if (cardHasEquippedTeisen(c)) {
                            effectiveCostMap[c.uniqueId] = 1.0;
                            if (Array.isArray(c.fukusho)) {
                                c.fukusho.forEach(function(fk) {
                                    if (fk && (String(fk.name || '') + String(fk.label || '')).indexOf('仙鏡') !== -1) {
                                        if (fk.uniqueId) usedTeisenCardIds.add(String(fk.uniqueId));
                                    }
                                });
                            }
                        }
                    });
                }

                var unequippedTeisen = allTeisenMirrors.filter(function(m) {
                    return !usedTeisenCardIds.has(m.uniqueId);
                });

                if (unequippedTeisen.length > 0) {
                    var minTeisenCost = unequippedTeisen.reduce(function(mn, m) {
                        var tc = SharedDB.safeNum((m.card && m.card.cost) !== undefined ? m.card.cost : m.cost, 4.0);
                        return Math.min(mn, tc);
                    }, 4.0);

                    // 襲令専用カードはデッキ全体で最大1枚しか使われないため、2番手以降の襲令ベンチカードに帝仙鏡を奪われないよう制限
                    var shureiOnlyIds = new Set();
                    var bestShureiId = null;
                    var bestShureiVal = -1;
                    validCards.forEach(function(c) {
                        var sp = supportProbeCache[c.uniqueId];
                        var pEv = sp && sp.eval;
                        var nEv = sp && sp.naiseiEval;
                        var isPassive = Boolean(pEv && pEv.canBePassiveSlot);
                        var isNonShureiNaisei = Boolean(nEv && nEv.canBeNaiseiSlot && !nEv.isShurei);
                        var isShureiOnly = Boolean(nEv && nEv.canBeNaiseiSlot && nEv.isShurei && !isPassive && !isNonShureiNaisei);
                        if (isShureiOnly) {
                            shureiOnlyIds.add(c.uniqueId);
                            var sv = SharedDB.safeNum(nEv.naiseiGMult, 0);
                            if (sv > bestShureiVal) {
                                bestShureiVal = sv;
                                bestShureiId = c.uniqueId;
                            }
                        }
                    });

                    var teisenCandidateList = validCards.filter(function(c) {
                        if (effectiveCostMap[c.uniqueId] <= 1.0 + 1e-6) return false;
                        var origC = SharedDB.safeNum(c.originalCost !== undefined ? c.originalCost : c.cost, 4.5);
                        var maxFk = SharedDB.safeNum(c.maxFukushoCost, 0);
                        if (SharedDB.isHaBusho(c) || String(c.rarity || '').toUpperCase() !== 'SL' || origC <= 1.0 + 1e-6 || maxFk < minTeisenCost - 1e-6) {
                            return false;
                        }
                        if (shureiOnlyIds.has(c.uniqueId) && c.uniqueId !== bestShureiId) {
                            return false;
                        }
                        var sp = supportProbeCache[c.uniqueId];
                        var pEv = sp && sp.eval;
                        var nEv = sp && sp.naiseiEval;
                        return Boolean((pEv && (pEv.canBePassiveSlot || pEv.canBeGuardSlot)) || (nEv && nEv.canBeNaiseiSlot));
                    });

                    teisenCandidateList.sort(function(a, b) {
                        // 1. 元々帝仙鏡を装備していたカードを最優先
                        var eqA = cardHasEquippedTeisen(a) ? 1 : 0;
                        var eqB = cardHasEquippedTeisen(b) ? 1 : 0;
                        if (eqB !== eqA) return eqB - eqA;

                        // 2. 元コストが高い順（4.5コスト削減効果最大）
                        var origA = SharedDB.safeNum(a.originalCost !== undefined ? a.originalCost : a.cost, 4.5);
                        var origB = SharedDB.safeNum(b.originalCost !== undefined ? b.originalCost : b.cost, 4.5);
                        if (Math.abs(origB - origA) > 1e-6) return origB - origA;

                        // 3. サポートスキル威力順
                        var spA = supportProbeCache[a.uniqueId];
                        var spB = supportProbeCache[b.uniqueId];
                        var valA = Math.max(SharedDB.safeNum(spA && spA.eval && spA.eval.gMult, 0), SharedDB.safeNum(spA && spA.naiseiEval && spA.naiseiEval.naiseiGMult, 0));
                        var valB = Math.max(SharedDB.safeNum(spB && spB.eval && spB.eval.gMult, 0), SharedDB.safeNum(spB && spB.naiseiEval && spB.naiseiEval.naiseiGMult, 0));
                        return valB - valA;
                    });

                    var assignIdx = 0;
                    for (var ci = 0; ci < teisenCandidateList.length && assignIdx < unequippedTeisen.length; ci++) {
                        var tgtCard = teisenCandidateList[ci];
                        var maxFkC = SharedDB.safeNum(tgtCard.maxFukushoCost, 0);
                        var tFk = null;
                        for (var ti = assignIdx; ti < unequippedTeisen.length; ti++) {
                            var candT = unequippedTeisen[ti];
                            var tc = SharedDB.safeNum((candT.card && candT.card.cost) !== undefined ? candT.card.cost : candT.cost, 4.0);
                            if (tc <= maxFkC + 1e-6) {
                                tFk = candT;
                                unequippedTeisen.splice(ti, 1);
                                break;
                            }
                        }
                        if (tFk) {
                            preTeisenAssignedMap[tgtCard.uniqueId] = tFk;
                            usedTeisenCardIds.add(tFk.uniqueId);
                            effectiveCostMap[tgtCard.uniqueId] = 1.0;
                        }
                    }
                }
            }

            var mirrorCount = allMirrorPool.length;
            var initSlCopyRatio = isReassignMode ? (mirrorCount >= 18 ? 1.55 : (mirrorCount >= 10 ? 1.15 : 0.65)) : 0;
            var initLCopyRatio = isReassignMode ? (mirrorCount >= 18 ? 0.65 : (mirrorCount >= 10 ? 0.45 : 0.25)) : 0;

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
            var estSupportMultBase = initGo + 35000;
            var estGekireiBase = 0;
            var seenGkNos = new Set();
            validCards.forEach(function(c) {
                var gkEv = evaluateCard(c, 'SUN', 'support', 4.5);
                if (gkEv.canBePassiveSlot && gkEv.isGekirei && gkEv.rawAdd > 0) {
                    var gNo = c.cardNo || c.uniqueId;
                    if (!seenGkNos.has(gNo)) {
                        seenGkNos.add(gNo);
                        estGekireiBase += gkEv.rawAdd * (1 + initSlCopyRatio * 0.5);
                    }
                }
            });
            if (estGekireiBase <= 0) estGekireiBase = 250000;

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
                if (topBySoldier.hasOwnProperty(sk) && !topBySoldier[sk]) topBySoldier[sk] = allLeadPool[si];
            }

            var isAutoDetectingBestSoldier = (!selectedSoldierFilter || !SOLDIER_META[selectedSoldierFilter]);
            var topSoloLeads = [];
            if (isAutoDetectingBestSoldier) {
                for (var oi = 0; oi < SOLDIER_ORDER.length; oi++) {
                    var sKey0 = SOLDIER_ORDER[oi];
                    var perSoldier = allLeadPool.filter(function(item) { return item.soldierKey === sKey0; });
                    for (var pi = 0; pi < Math.min(2, perSoldier.length); pi++) topSoloLeads.push(perSoldier[pi]);
                }
            } else {
                var filteredLeadPool = allLeadPool.filter(function(item) { return item.soldierKey === selectedSoldierFilter; });
                topSoloLeads = filteredLeadPool.slice(0, Math.min(8, filteredLeadPool.length));
            }

            var dedupByCardNo = function(pool, usedNosSet) {
                var bestMap = Object.create(null);
                for (var idx = 0; idx < pool.length; idx++) {
                    var it = pool[idx];
                    var cNo = it.card.cardNo || it.card.uniqueId;
                    if (usedNosSet && usedNosSet.has(cNo)) continue;
                    var sc = SharedDB.safeNum(it.dpScore, 0);
                    if (!bestMap[cNo] || sc > SharedDB.safeNum(bestMap[cNo].dpScore, 0)) {
                        bestMap[cNo] = it;
                    }
                }
                return Object.values(bestMap);
            };

            var bestSetup = { finalTotalDamage: -1 };

            topSoloLeads.forEach(function(leadItem) {
                var leadCard = leadItem.card;
                var leadEffCost = effectiveCostMap[leadCard.uniqueId] || SharedDB.safeNum(leadCard.cost, 4.5);
                if (leadEffCost > originLimit) return;
                var leadGMult = SharedDB.safeNum(leadItem.gMult, 0);
                var leadBestWeather = leadItem.bestWeather || (AppCards.slotWeathers[originSlotId] || 'SUN');
                var masterCost = leadEffCost;
                var leadNo = leadCard.cardNo || leadCard.uniqueId;

                var leadBaseWithAdjEst = SharedDB.safeNum(leadCard.baseAttack, 1000) + SharedDB.safeNum(leadItem.adjAtkBonus, 0);
                var initEffAtk = leadBaseWithAdjEst + estGekireiBase;
                var initTotalMult = leadGMult + SharedDB.safeNum(leadItem.adjBuffBonus, 0) + estSupportMultBase;

                var shureiPool = [], frontGlobalPool = [], frontBoundPool = [], guardPool = [];
                validCards.forEach(function(c) {
                    if (c.uniqueId === leadCard.uniqueId || (c.cardNo || c.uniqueId) === leadNo || usedTeisenCardIds.has(c.uniqueId)) return;
                    var bestSup = getBestWeatherForCard(c, masterCost);
                    var pProbe = bestSup.eval;
                    var nProbe = bestSup.naiseiEval;
                    var effCost = effectiveCostMap[c.uniqueId] || SharedDB.safeNum(c.cost, 1.0);

                    var hasAdjSlot = (!SharedDB.isHaBusho(c) && SharedDB.safeNum(c.maxFukushoCost, 0) > 0 && isReassignMode);
                    var cRarity = String(c.rarity || 'SL').toUpperCase();
                    var estRatio = !hasAdjSlot ? 0 : (cRarity === 'SL' ? initSlCopyRatio : initLCopyRatio);
                    var kSelf = SharedDB.getKakuseiMultiplier(c);

                    var calcInitDpScore = function(gVal, rawVal, fG, fRaw, isGk) {
                        var estAdjG = hasAdjSlot && !isGk ? ((SharedDB.safeNum(fG, 0) / kSelf) * estRatio) : 0;
                        var estAdjRaw = hasAdjSlot && isGk ? ((SharedDB.safeNum(fRaw, 0) / kSelf) * estRatio) : 0;
                        var gScore = initEffAtk * ((SharedDB.safeNum(gVal, 0) + estAdjG) / 100);
                        var rScore = (SharedDB.safeNum(rawVal, 0) + estAdjRaw) * (1 + initTotalMult / 100);
                        return gScore + rScore;
                    };

                    if (pProbe && pProbe.canBeGuardSlot) {
                        var gG = SharedDB.safeNum(pProbe.gMult, 0);
                        var gR = SharedDB.safeNum(pProbe.rawAdd, 0);
                        guardPool.push({
                            card: c, effectiveCost: effCost, cost: effCost,
                            gMult: gG, rawAdd: gR,
                            firstRawAdd: SharedDB.safeNum(pProbe.firstRawAdd, 0), firstGMult: SharedDB.safeNum(pProbe.firstGMult, 0),
                            dpScore: calcInitDpScore(gG, gR, pProbe.firstGMult, pProbe.firstRawAdd, pProbe.isGekirei),
                            series: pProbe.series, isBound: pProbe.passiveMustBeSameBase, isShurei: false, isGekirei: pProbe.isGekirei, isManualNaisei: false,
                            weather: bestSup.bestPassiveWeather
                        });
                    }

                    var canNaisei = Boolean(nProbe && nProbe.canBeNaiseiSlot && (nProbe.naiseiGMult > 0 || nProbe.naiseiRawAdd > 0));
                    var canPassive = Boolean(pProbe && pProbe.canBePassiveSlot && (pProbe.gMult > 0 || pProbe.rawAdd > 0));

                    if (canNaisei && nProbe.isShurei) {
                        var sG = SharedDB.safeNum(nProbe.naiseiGMult, 0);
                        var sR = SharedDB.safeNum(nProbe.naiseiRawAdd, 0);
                        shureiPool.push({
                            card: c, effectiveCost: effCost, cost: effCost,
                            gMult: sG, rawAdd: sR,
                            firstRawAdd: SharedDB.safeNum(nProbe.firstRawAdd, 0), firstGMult: SharedDB.safeNum(nProbe.naiseiFirstGMult, 0),
                            dpScore: calcInitDpScore(sG, sR, nProbe.naiseiFirstGMult, nProbe.firstRawAdd, nProbe.isGekirei),
                            marginalGain: SharedDB.safeNum(nProbe.naiseiMarginalGain, 0),
                            series: nProbe.series, isBound: nProbe.naiseiMustBeSameBase, isShurei: true, isGekirei: nProbe.isGekirei, isManualNaisei: true,
                            weather: bestSup.bestWeather
                        });
                    } else if (canNaisei && (!canPassive || (nProbe.naiseiGMult + nProbe.naiseiRawAdd * 0.01) >= (pProbe.gMult + pProbe.rawAdd * 0.01))) {
                        var nG = SharedDB.safeNum(nProbe.naiseiGMult, 0);
                        var nR = SharedDB.safeNum(nProbe.naiseiRawAdd, 0);
                        var nItem = {
                            card: c, effectiveCost: effCost, cost: effCost,
                            gMult: nG, rawAdd: nR,
                            firstRawAdd: SharedDB.safeNum(nProbe.firstRawAdd, 0), firstGMult: SharedDB.safeNum(nProbe.naiseiFirstGMult, 0),
                            dpScore: calcInitDpScore(nG, nR, nProbe.naiseiFirstGMult, nProbe.firstRawAdd, nProbe.isGekirei),
                            marginalGain: SharedDB.safeNum(nProbe.naiseiMarginalGain, 0),
                            series: nProbe.series, isBound: nProbe.naiseiMustBeSameBase, isShurei: false, isGekirei: nProbe.isGekirei, isManualNaisei: true,
                            weather: bestSup.bestWeather
                        };
                        if (nProbe.naiseiMustBeSameBase) frontBoundPool.push(nItem);
                        else frontGlobalPool.push(nItem);
                    } else if (canPassive) {
                        var pG = SharedDB.safeNum(pProbe.gMult, 0);
                        var pR = SharedDB.safeNum(pProbe.rawAdd, 0);
                        var pItem = {
                            card: c, effectiveCost: effCost, cost: effCost,
                            gMult: pG, rawAdd: pR,
                            firstRawAdd: SharedDB.safeNum(pProbe.firstRawAdd, 0), firstGMult: SharedDB.safeNum(pProbe.firstGMult, 0),
                            dpScore: calcInitDpScore(pG, pR, pProbe.firstGMult, pProbe.firstRawAdd, pProbe.isGekirei),
                            series: pProbe.series, isBound: pProbe.passiveMustBeSameBase, isShurei: false, isGekirei: pProbe.isGekirei, isManualNaisei: false,
                            weather: bestSup.bestPassiveWeather
                        };
                        if (pProbe.passiveMustBeSameBase) frontBoundPool.push(pItem);
                        else frontGlobalPool.push(pItem);
                    }
                });

                function evaluateFullSoloPlan(adjBuffOverrideMap, adjGkOverrideMap, refEffAtk, refTotalMult) {
                    var curEffAtk = SharedDB.safeNum(refEffAtk, initEffAtk);
                    var curTotalMult = SharedDB.safeNum(refTotalMult, initTotalMult);
                    var curMultFactor = 1 + curTotalMult / 100;

                    var applyOverride = function(arr) {
                        if (!adjBuffOverrideMap && !adjGkOverrideMap && !refEffAtk && !refTotalMult) return arr;
                        return arr.map(function(it) {
                            var hasAdjSlot2 = (!SharedDB.isHaBusho(it.card) && SharedDB.safeNum(it.card.maxFukushoCost, 0) > 0 && isReassignMode);
                            var cRar2 = String(it.card.rarity || 'SL').toUpperCase();
                            var estR2 = !hasAdjSlot2 ? 0 : (cRar2 === 'SL' ? initSlCopyRatio : initLCopyRatio);
                            var kS2 = SharedDB.getKakuseiMultiplier(it.card);

                            var ovB = adjBuffOverrideMap ? adjBuffOverrideMap[it.card.uniqueId] : undefined;
                            var ovGk = adjGkOverrideMap ? adjGkOverrideMap[it.card.uniqueId] : undefined;

                            var adjB = (ovB !== undefined) ? SharedDB.safeNum(ovB, 0) : (hasAdjSlot2 && !it.isGekirei ? (SharedDB.safeNum(it.firstGMult, 0) / kS2) * estR2 : 0);
                            var adjGk = (ovGk !== undefined) ? SharedDB.safeNum(ovGk, 0) : (hasAdjSlot2 && it.isGekirei ? (SharedDB.safeNum(it.firstRawAdd, 0) / kS2) * estR2 : 0);

                            var newScore = curEffAtk * ((SharedDB.safeNum(it.gMult, 0) + adjB) / 100) +
                                           (SharedDB.safeNum(it.rawAdd, 0) + adjGk) * curMultFactor;
                            return Object.assign({}, it, { dpScore: newScore, estAdjG: adjB, estAdjGk: adjGk });
                        });
                    };

                    var curShureiPool = applyOverride(shureiPool);
                    var curGlobalPool = applyOverride(frontGlobalPool);
                    var curBoundPool = applyOverride(frontBoundPool);
                    var curGuardPool = applyOverride(guardPool);

                    var shureiByScore = dedupByCardNo(curShureiPool, null).sort(function(a, b) {
                        return SharedDB.safeNum(b.dpScore, 0) - SharedDB.safeNum(a.dpScore, 0);
                    });
                    var shureiByEff = dedupByCardNo(curShureiPool, null).sort(function(a, b) {
                        return (SharedDB.safeNum(b.dpScore, 0) / Math.max(0.5, b.effectiveCost)) -
                               (SharedDB.safeNum(a.dpScore, 0) / Math.max(0.5, a.effectiveCost));
                    });
                    var shureiPatterns = [null];
                    var seenShureiNos = new Set();
                    shureiByScore.slice(0, 3).concat(shureiByEff.slice(0, 3)).forEach(function(sIt) {
                        var sNo = sIt.card.cardNo || sIt.card.uniqueId;
                        if (!seenShureiNos.has(sNo)) {
                            seenShureiNos.add(sNo);
                            shureiPatterns.push(sIt);
                        }
                    });

                    var bestLocalDamage = -1;
                    var bestLocalSetup = null;

                    for (var spIdx = 0; spIdx < shureiPatterns.length; spIdx++) {
                        var chosenShurei = shureiPatterns[spIdx];
                        var shureiCost = chosenShurei ? chosenShurei.effectiveCost : 0.0;
                        var shureiBuff = chosenShurei ? SharedDB.safeNum(chosenShurei.gMult, 0) : 0.0;
                        var shureiAdjBuff = chosenShurei ? SharedDB.safeNum(chosenShurei.estAdjG, 0) : 0.0;
                        var originInitCost = leadEffCost + shureiCost;
                        if (originInitCost > originLimit + 1e-6) continue;

                        var baseUsedNos = new Set([leadNo]);
                        if (chosenShurei) baseUsedNos.add(chosenShurei.card.cardNo || chosenShurei.card.uniqueId);

                        var hCapCost = isHonkyoAttack ? (honkyoLimit - originInitCost) : honkyoLimit;
                        var kCapCost = isHonkyoAttack ? kyotenLimit : (kyotenLimit - originInitCost);
                        var maxHNaiseiSlots = isHonkyoAttack ? (chosenShurei ? 1 : 2) : 2;
                        var maxKNaiseiSlots = isHonkyoAttack ? 9 : (chosenShurei ? 8 : 9);

                        var strategies = [1, 2];
                        for (var stIdx = 0; stIdx < strategies.length; stIdx++) {
                            var strat = strategies[stIdx];
                            var usedNos = new Set(baseUsedNos);
                            var hManual = [], kManual = [], hPassives = [], kPassives = [];

                            if (isHonkyoAttack) {
                                if (strat === 1) {
                                    var kAvail1 = dedupByCardNo(curGlobalPool, usedNos);
                                    var kRes1 = solveSoloDeckKnapsackWithNaiseiLimits(kCapCost, maxKNaiseiSlots, kAvail1);
                                    kRes1.picked.forEach(function(x) {
                                        usedNos.add(x.card.cardNo || x.card.uniqueId);
                                        if (x.isManualNaisei) kManual.push(x);
                                        else kPassives.push(x);
                                    });
                                    var hAvail1 = dedupByCardNo(curBoundPool.concat(curGlobalPool), usedNos);
                                    var hRes1 = solveSoloDeckKnapsackWithNaiseiLimits(hCapCost, maxHNaiseiSlots, hAvail1);
                                    hRes1.picked.forEach(function(x) {
                                        usedNos.add(x.card.cardNo || x.card.uniqueId);
                                        if (x.isManualNaisei) hManual.push(x);
                                        else hPassives.push(x);
                                    });
                                } else {
                                    var hAvail2 = dedupByCardNo(curBoundPool.concat(curGlobalPool), usedNos);
                                    var hRes2 = solveSoloDeckKnapsackWithNaiseiLimits(hCapCost, maxHNaiseiSlots, hAvail2);
                                    hRes2.picked.forEach(function(x) {
                                        usedNos.add(x.card.cardNo || x.card.uniqueId);
                                        if (x.isManualNaisei) hManual.push(x);
                                        else hPassives.push(x);
                                    });
                                    var kAvail2 = dedupByCardNo(curGlobalPool, usedNos);
                                    var kRes2 = solveSoloDeckKnapsackWithNaiseiLimits(kCapCost, maxKNaiseiSlots, kAvail2);
                                    kRes2.picked.forEach(function(x) {
                                        usedNos.add(x.card.cardNo || x.card.uniqueId);
                                        if (x.isManualNaisei) kManual.push(x);
                                        else kPassives.push(x);
                                    });
                                }
                            } else {
                                if (strat === 1) {
                                    var hAvail3 = dedupByCardNo(curGlobalPool, usedNos);
                                    var hRes3 = solveSoloDeckKnapsackWithNaiseiLimits(hCapCost, maxHNaiseiSlots, hAvail3);
                                    hRes3.picked.forEach(function(x) {
                                        usedNos.add(x.card.cardNo || x.card.uniqueId);
                                        if (x.isManualNaisei) hManual.push(x);
                                        else hPassives.push(x);
                                    });
                                    var kAvail3 = dedupByCardNo(curBoundPool.concat(curGlobalPool), usedNos);
                                    var kRes3 = solveSoloDeckKnapsackWithNaiseiLimits(kCapCost, maxKNaiseiSlots, kAvail3);
                                    kRes3.picked.forEach(function(x) {
                                        usedNos.add(x.card.cardNo || x.card.uniqueId);
                                        if (x.isManualNaisei) kManual.push(x);
                                        else kPassives.push(x);
                                    });
                                } else {
                                    var kAvail4 = dedupByCardNo(curBoundPool.concat(curGlobalPool), usedNos);
                                    var kRes4 = solveSoloDeckKnapsackWithNaiseiLimits(kCapCost, maxKNaiseiSlots, kAvail4);
                                    kRes4.picked.forEach(function(x) {
                                        usedNos.add(x.card.cardNo || x.card.uniqueId);
                                        if (x.isManualNaisei) kManual.push(x);
                                        else kPassives.push(x);
                                    });
                                    var hAvail4 = dedupByCardNo(curGlobalPool, usedNos);
                                    var hRes4 = solveSoloDeckKnapsackWithNaiseiLimits(hCapCost, maxHNaiseiSlots, hAvail4);
                                    hRes4.picked.forEach(function(x) {
                                        usedNos.add(x.card.cardNo || x.card.uniqueId);
                                        if (x.isManualNaisei) hManual.push(x);
                                        else hPassives.push(x);
                                    });
                                }
                            }

                            var allPickedItems = hManual.concat(kManual, hPassives, kPassives);
                            var gekireiSum = allPickedItems.reduce(function(s, p) { return s + SharedDB.safeNum(p.rawAdd, 0); }, 0);
                            var estAdjGkSum = allPickedItems.reduce(function(s, p) { return s + SharedDB.safeNum(p.estAdjGk, 0); }, 0);
                            var pureGenMultSum = leadGMult + shureiBuff + allPickedItems.reduce(function(s, p) { return s + SharedDB.safeNum(p.gMult, 0); }, 0);
                            var estAdjGSum = shureiAdjBuff + allPickedItems.reduce(function(s, p) { return s + SharedDB.safeNum(p.estAdjG, 0); }, 0);

                            var simEffAtk = leadBaseWithAdjEst + gekireiSum + estAdjGkSum;
                            var simTotalMult = pureGenMultSum + SharedDB.safeNum(leadItem.adjBuffBonus, 0) + estAdjGSum + initGo;
                            var simLocalDamage = simEffAtk * (1 + simTotalMult / 100);

                            if (simLocalDamage > bestLocalDamage) {
                                bestLocalDamage = simLocalDamage;
                                var currentSlots = {};
                                if (chosenShurei) currentSlots[originSlotId] = Object.assign({}, chosenShurei, { isShurei: true });

                                hManual.sort(function(a, b) { return SharedDB.safeNum(b.dpScore, 0) - SharedDB.safeNum(a.dpScore, 0); });
                                kManual.sort(function(a, b) { return SharedDB.safeNum(b.dpScore, 0) - SharedDB.safeNum(a.dpScore, 0); });
                                hPassives.sort(function(a, b) { return SharedDB.safeNum(b.dpScore, 0) - SharedDB.safeNum(a.dpScore, 0); });
                                kPassives.sort(function(a, b) { return SharedDB.safeNum(b.dpScore, 0) - SharedDB.safeNum(a.dpScore, 0); });

                                if (!isHonkyoAttack) {
                                    for (var hi = 0; hi < hManual.length; hi++) currentSlots['h' + hi] = hManual[hi];
                                    for (var ki = 0; ki < kManual.length; ki++) currentSlots['k' + (ki + 1)] = kManual[ki];
                                } else {
                                    for (var hi2 = 0; hi2 < hManual.length; hi2++) currentSlots['h' + (hi2 + 1)] = hManual[hi2];
                                    for (var ki2 = 0; ki2 < kManual.length; ki2++) currentSlots['k' + ki2] = kManual[ki2];
                                }

                                var hTotalCost = (isHonkyoAttack ? originInitCost : 0) +
                                                 hManual.reduce(function(s, x) { return s + x.effectiveCost; }, 0) +
                                                 hPassives.reduce(function(s, x) { return s + x.effectiveCost; }, 0);
                                var kTotalCost = (!isHonkyoAttack ? originInitCost : 0) +
                                                 kManual.reduce(function(s, x) { return s + x.effectiveCost; }, 0) +
                                                 kPassives.reduce(function(s, x) { return s + x.effectiveCost; }, 0);

                                bestLocalSetup = {
                                    activeSlots: currentSlots,
                                    basePassives: hPassives,
                                    subPassives: kPassives,
                                    pureGenMult: pureGenMultSum,
                                    gekireiBonusTotal: gekireiSum,
                                    hCost: hTotalCost,
                                    kCost: kTotalCost,
                                    usedNos: usedNos
                                };
                            }
                        }
                    }

                    if (!bestLocalSetup) return null;

                    if (!shouldAutoWeather) {
                        var recalculatedSlots = {};
                        var recalcActiveSum = 0;
                        Object.keys(bestLocalSetup.activeSlots).forEach(function(sId) {
                            var sItem = bestLocalSetup.activeSlots[sId];
                            var slotW = AppCards.slotWeathers[sId] || sItem.weather || 'SUN';
                            var reEv = evaluateCard(sItem.card, slotW, 'support', masterCost);
                            var updatedItem = Object.assign({}, sItem, {
                                gMult: SharedDB.safeNum(reEv.naiseiGMult, 0),
                                rawAdd: SharedDB.safeNum(reEv.naiseiRawAdd, 0),
                                firstGMult: SharedDB.safeNum(reEv.naiseiFirstGMult, 0),
                                weather: slotW
                            });
                            recalculatedSlots[sId] = updatedItem;
                            recalcActiveSum += updatedItem.gMult;
                        });
                        var pSumOnly = bestLocalSetup.basePassives.concat(bestLocalSetup.subPassives).reduce(function(s, p) { return s + SharedDB.safeNum(p.gMult, 0); }, 0);
                        bestLocalSetup.activeSlots = recalculatedSlots;
                        bestLocalSetup.pureGenMult = leadGMult + recalcActiveSum + pSumOnly;
                    }

                    var finalUsedNos = new Set(bestLocalSetup.usedNos);
                    var guardMultFactor = 1 + (bestLocalSetup.pureGenMult + SharedDB.safeNum(leadItem.adjBuffBonus, 0) + SharedDB.safeNum(goBuffValue, 7000)) / 100;
                    var filterBestGuardPerNo = function(pool) {
                        var bestMap = Object.create(null);
                        for (var gi = 0; gi < pool.length; gi++) {
                            var g = pool[gi];
                            var gNo = g.card.cardNo || g.card.uniqueId;
                            if (finalUsedNos.has(gNo)) continue;
                            var dpItem = Object.assign({}, g, { cost: g.effectiveCost, tMult: SharedDB.safeNum(g.dpScore, 0) });
                            if (!bestMap[gNo] || dpItem.tMult > bestMap[gNo].tMult) bestMap[gNo] = dpItem;
                        }
                        return Object.values(bestMap);
                    };

                    var availGuards = filterBestGuardPerNo(curGuardPool);
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
                            role: 'lead', card: leadCard, isSameBaseAsAce: true,
                            originalCost: SharedDB.safeNum(leadCard.originalCost !== undefined ? leadCard.originalCost : leadCard.cost, 4.5),
                            maxCost: SharedDB.safeNum(leadCard.maxFukushoCost, 4.5),
                            firstSkillVal: sVal, baseCopyVal: sVal / kMult, firstSkillObj: firstS, isGekirei: false, firstRawAdd: 0, baseCopyRawAdd: 0
                        });
                    }

                    Object.keys(bestLocalSetup.activeSlots).forEach(function(sId) {
                        var it = bestLocalSetup.activeSlots[sId];
                        if (it.card && !SharedDB.isHaBusho(it.card) && SharedDB.safeNum(it.card.maxFukushoCost, 0) > 0) {
                            var firstS2 = (it.card.skills && it.card.skills[0]) || {};
                            var sVal2 = SharedDB.safeNum(it.firstGMult, 0);
                            var kMult2 = SharedDB.getKakuseiMultiplier(it.card);
                            var isSameBaseSlot = isHonkyoAttack ? (sId.indexOf('h') === 0) : (sId.indexOf('k') === 0);
                            masterList.push({
                                role: 'active', slotId: sId, card: it.card, isSameBaseAsAce: isSameBaseSlot,
                                originalCost: SharedDB.safeNum(it.card.originalCost !== undefined ? it.card.originalCost : it.card.cost, 4.5),
                                maxCost: SharedDB.safeNum(it.card.maxFukushoCost, 4.5),
                                firstSkillVal: sVal2, baseCopyVal: sVal2 / kMult2, firstSkillObj: firstS2, isGekirei: false, firstRawAdd: 0, baseCopyRawAdd: 0
                            });
                        }
                    });

                    bestLocalSetup.basePassives.forEach(function(p) {
                        if (p.card && !SharedDB.isHaBusho(p.card) && SharedDB.safeNum(p.card.maxFukushoCost, 0) > 0) {
                            var firstS3 = (p.card.skills && p.card.skills[0]) || {};
                            var fRaw = SharedDB.safeNum(p.firstRawAdd, 0);
                            var fG = SharedDB.safeNum(p.firstGMult, 0);
                            var kMult3 = SharedDB.getKakuseiMultiplier(p.card);
                            masterList.push({
                                role: 'passive', card: p.card, isSameBaseAsAce: isHonkyoAttack,
                                originalCost: SharedDB.safeNum(p.card.originalCost !== undefined ? p.card.originalCost : p.card.cost, 4.5),
                                maxCost: SharedDB.safeNum(p.card.maxFukushoCost, 4.5),
                                firstSkillVal: fG, baseCopyVal: fG / kMult3, firstSkillObj: firstS3, isGekirei: Boolean(p.isGekirei && fRaw > 0),
                                firstRawAdd: fRaw, baseCopyRawAdd: fRaw / kMult3
                            });
                        }
                    });
                    bestLocalSetup.subPassives.forEach(function(p) {
                        if (p.card && !SharedDB.isHaBusho(p.card) && SharedDB.safeNum(p.card.maxFukushoCost, 0) > 0) {
                            var firstS3 = (p.card.skills && p.card.skills[0]) || {};
                            var fRaw = SharedDB.safeNum(p.firstRawAdd, 0);
                            var fG = SharedDB.safeNum(p.firstGMult, 0);
                            var kMult3 = SharedDB.getKakuseiMultiplier(p.card);
                            masterList.push({
                                role: 'passive', card: p.card, isSameBaseAsAce: !isHonkyoAttack,
                                originalCost: SharedDB.safeNum(p.card.originalCost !== undefined ? p.card.originalCost : p.card.cost, 4.5),
                                maxCost: SharedDB.safeNum(p.card.maxFukushoCost, 4.5),
                                firstSkillVal: fG, baseCopyVal: fG / kMult3, firstSkillObj: firstS3, isGekirei: Boolean(p.isGekirei && fRaw > 0),
                                firstRawAdd: fRaw, baseCopyRawAdd: fRaw / kMult3
                            });
                        }
                    });
                    hGuardPicked.forEach(function(p) {
                        if (p.card && !SharedDB.isHaBusho(p.card) && SharedDB.safeNum(p.card.maxFukushoCost, 0) > 0) {
                            var firstS3 = (p.card.skills && p.card.skills[0]) || {};
                            var fRaw = SharedDB.safeNum(p.firstRawAdd, 0);
                            var fG = SharedDB.safeNum(p.firstGMult, 0);
                            var kMult3 = SharedDB.getKakuseiMultiplier(p.card);
                            masterList.push({
                                role: 'guard', card: p.card, isSameBaseAsAce: isHonkyoAttack,
                                originalCost: SharedDB.safeNum(p.card.originalCost !== undefined ? p.card.originalCost : p.card.cost, 4.5),
                                maxCost: SharedDB.safeNum(p.card.maxFukushoCost, 4.5),
                                firstSkillVal: fG, baseCopyVal: fG / kMult3, firstSkillObj: firstS3, isGekirei: Boolean(p.isGekirei && fRaw > 0),
                                firstRawAdd: fRaw, baseCopyRawAdd: fRaw / kMult3
                            });
                        }
                    });
                    kGuardPicked.forEach(function(p) {
                        if (p.card && !SharedDB.isHaBusho(p.card) && SharedDB.safeNum(p.card.maxFukushoCost, 0) > 0) {
                            var firstS3 = (p.card.skills && p.card.skills[0]) || {};
                            var fRaw = SharedDB.safeNum(p.firstRawAdd, 0);
                            var fG = SharedDB.safeNum(p.firstGMult, 0);
                            var kMult3 = SharedDB.getKakuseiMultiplier(p.card);
                            masterList.push({
                                role: 'guard', card: p.card, isSameBaseAsAce: !isHonkyoAttack,
                                originalCost: SharedDB.safeNum(p.card.originalCost !== undefined ? p.card.originalCost : p.card.cost, 4.5),
                                maxCost: SharedDB.safeNum(p.card.maxFukushoCost, 4.5),
                                firstSkillVal: fG, baseCopyVal: fG / kMult3, firstSkillObj: firstS3, isGekirei: Boolean(p.isGekirei && fRaw > 0),
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
                                var isTeisenFk = isTeisenMirrorItem({ card: rawFk, info: inf });
                                var st = SharedDB.getAdjutantStatusEffect(rawFk, inf);
                                var fkCost = SharedDB.safeNum(rawFk.cost, 0);
                                usedAdjutantCostMap[mCard.uniqueId] += fkCost;
                                if (master.role === 'lead') leadAdjutantAtkBonus += st.atkBonus;

                                if (inf || isTeisenFk) {
                                    var rate = isTeisenFk ? 100 : SharedDB.calcAdjutantEffectiveCopyRate(mCard, rawFk, inf);
                                    var fkId = String(rawFk.uniqueId || rawFk.id || rawFk.cardNo || '');
                                    var fkNo = String(rawFk.cardNo || fkId);
                                    if (fkId) usedMirrorIds.add(fkId);
                                    if (fkNo) usedMirrorNos.add(fkNo);
                                    var lbl = isTeisenFk ? ((st.isBu ? '[武]' : '') + '帝仙鏡 100% [主将C1化]') : formatMirrorLabelWithCost(inf, rate);
                                    existingList.push(Object.assign({}, rawFk, {
                                        copyRate: rate,
                                        label: lbl
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
                                    var gCandEx = buildSoloGeneralAdjutantCand(rawFk, master.role, leadBestWeather, master.isSameBaseAsAce);
                                    if (gCandEx) {
                                        var fkId2 = String(rawFk.uniqueId || rawFk.id || rawFk.cardNo || '');
                                        var fkNo2 = String(rawFk.cardNo || fkId2);
                                        if (fkId2) usedMirrorIds.add(fkId2);
                                        if (fkNo2) usedMirrorNos.add(fkNo2);
                                        existingList.push(Object.assign({}, rawFk, { label: gCandEx.label }));
                                        if (gCandEx.genGMult > 0) {
                                            additionalAdjutantBuff += gCandEx.genGMult;
                                            adjutantAddedBuffMap[mCard.uniqueId] += gCandEx.genGMult;
                                        }
                                        if (gCandEx.genRaw > 0) {
                                            totalGekireiBonus += gCandEx.genRaw;
                                            adjutantAddedGekireiMap[mCard.uniqueId] += gCandEx.genRaw;
                                        }
                                    } else {
                                        existingList.push(rawFk);
                                    }
                                }
                            });
                        }
                        if (assignedAdjutantsMap) assignedAdjutantsMap[mCard.uniqueId] = existingList;
                    });

                    if (adjutantMode !== 'CURRENT') {
                        var availableMirrors = allMirrorPool.filter(function(m) {
                            return !allDeckUsedCardIds.has(m.uniqueId) && !allDeckUsedCardNos.has(m.cardNo) && !usedTeisenCardIds.has(m.uniqueId);
                        });
                        var availableGeneralPool = allGeneralPool.filter(function(gc) {
                            return !allDeckUsedCardIds.has(gc.uniqueId) &&
                                   !allDeckUsedCardNos.has(gc.cardNo || gc.uniqueId) &&
                                   !usedTeisenCardIds.has(gc.uniqueId);
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
                            var validGenCands = [];
                            for (var gi = 0; gi < availableGeneralPool.length; gi++) {
                                var gc = availableGeneralPool[gi];
                                var gcNo = gc.cardNo || gc.uniqueId;
                                if (usedMirrorIds.has(gc.uniqueId) || usedMirrorNos.has(gcNo)) continue;
                                var gCand = buildSoloGeneralAdjutantCand(gc, master.role, leadBestWeather, master.isSameBaseAsAce);
                                if (gCand) validGenCands.push(gCand);
                            }

                            var bestCombo = SharedDB.findBestAdjutantCombo(mCard, unusedForMaster, currentAssigned, usedAdjutantCostMap[mCard.uniqueId], {
                                baseCopyG: master.isGekirei ? 0 : master.baseCopyVal,
                                baseCopyRaw: master.isGekirei ? master.baseCopyRawAdd : 0,
                                wGen: curEffAtk / 100,
                                wRaw: guardMultFactor,
                                wAtk: (master.role === 'lead') ? guardMultFactor * 1.5 : 0,
                                generalPool: validGenCands
                            });

                            bestCombo.forEach(function(chosenFk) {
                                usedMirrorIds.add(chosenFk.uniqueId);
                                usedMirrorNos.add(chosenFk.cardNo);
                                usedAdjutantCostMap[mCard.uniqueId] += chosenFk.cost;
                                if (master.role === 'lead') leadAdjutantAtkBonus += chosenFk.atkBonus;
                                currentAssigned.push(chosenFk);
                                if (chosenFk.isGeneralSkill && chosenFk.genStats) {
                                    var gB = SharedDB.safeNum(chosenFk.genStats.soloG, 0);
                                    var gGk = SharedDB.safeNum(chosenFk.genStats.soloGk, 0);
                                    if (gB > 0) {
                                        additionalAdjutantBuff += gB;
                                        adjutantAddedBuffMap[mCard.uniqueId] += gB;
                                    }
                                    if (gGk > 0) {
                                        totalGekireiBonus += gGk;
                                        adjutantAddedGekireiMap[mCard.uniqueId] += gGk;
                                    }
                                } else if (master.isGekirei && master.baseCopyRawAdd > 0) {
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

                    return {
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

                // Pass 1 実行
                var plan1 = evaluateFullSoloPlan(null, null, null, null);
                if (!plan1) return;
                if (plan1.finalTotalDamage > bestSetup.finalTotalDamage) {
                    bestSetup = plan1;
                }

                // Pass 2 実行（Pass 1 の実測有効基礎攻撃力・実測総倍率・実測副将バフ・檄令実績をフィードバックして再2次元DP）
                var plan2 = evaluateFullSoloPlan(
                    isReassignMode ? plan1.adjutantAddedBuffMap : null,
                    isReassignMode ? plan1.adjutantAddedGekireiMap : null,
                    plan1.effectiveAttack,
                    plan1.finalGenMult
                );
                if (plan2 && plan2.finalTotalDamage > bestSetup.finalTotalDamage) {
                    bestSetup = plan2;
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
            AppCards.setStatusLog("単騎最適化完了 (Ver. 2.06 / " + SOLDIER_META[selectedSoldierFilter].short + "): 最大攻撃力 " + bestSetup.finalTotalDamage.toLocaleString());
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
                            <span class="text-[10px] font-bold px-2 py-0.5 rounded shadow ${curMeta.badgeColor}">${curMeta.short}単騎 (Ver. 2.06)</span>
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
                    <div class="text-xs text-blue-400 mb-2"><i class="fa-solid fa-hand-pointer mr-1"></i>内政セット枠 (手動・「防:」内政官のみ)</div>
                    <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 mb-4">${renderActiveSlotHTML('h0', '1. 本拠')}${renderActiveSlotHTML('h1', '2. 塔')}</div>
                    <div class="text-xs text-gray-400 mb-1"><i class="fa-solid fa-bolt mr-1"></i>出撃デッキ空き枠 (パッシブ・檄令のみ有効: ${setup.chosenBasePassives.length}枚)</div>
                    <div class="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-3 mb-4">${renderCardListHTML(setup.chosenBasePassives, false)}</div>
                    <div class="mt-4 border-t border-gray-700 pt-2 flex justify-between text-xs text-purple-400 mb-1">
                        <span><i class="fa-solid fa-shield-halved mr-1"></i>裏・警護デッキ (パッシブのみ有効: ${setup.chosenBaseGuards.length}枚)</span>
                        <span class="font-mono text-gray-400 font-bold">裏コスト: ${setup.honkyoGuardCost.toFixed(1)} / ${setup.honkyoLimit.toFixed(1)}</span>
                    </div>
                    <div class="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-3">${renderCardListHTML(setup.chosenBaseGuards, true)}</div>
                </div>

                <div class="border border-gray-700 rounded-lg p-4 bg-gray-900/50">
                    <div class="text-md font-bold text-white mb-2 flex justify-between border-b border-gray-700 pb-2">
                        <span><i class="fa-solid fa-tents text-blue-400 mr-2"></i>拠点＋ に配置するサポート</span>
                        <span class="text-xs font-mono ${setup.kyotenCost > setup.kyotenLimit ? 'text-red-400' : 'text-gray-300'} font-bold">表コスト: ${setup.kyotenCost.toFixed(1)} / ${setup.kyotenLimit.toFixed(1)}</span>
                    </div>
                    <div class="text-xs text-blue-400 mb-2"><i class="fa-solid fa-hand-pointer mr-1"></i>内政セット枠 (手動・「防:」内政官のみ)</div>
                    <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mb-4">
                        ${renderActiveSlotHTML('k0', '3. 拠点1')}${renderActiveSlotHTML('k1', '4. 拠点2')}${renderActiveSlotHTML('k2', '5. 拠点3')}
                        ${renderActiveSlotHTML('k3', '6. 拠点4')}${renderActiveSlotHTML('k4', '7. 拠点5')}${renderActiveSlotHTML('k5', '8. 拠点6')}
                        ${renderActiveSlotHTML('k6', '9. 拠点7')}${renderActiveSlotHTML('k7', '10. 拠点8')}${renderActiveSlotHTML('k8', '11. 拠点9')}
                    </div>
                    <div class="text-xs text-gray-400 mb-1"><i class="fa-solid fa-bolt mr-1"></i>出撃デッキ空き枠 (パッシブ・檄令のみ有効: ${setup.chosenSubPassives.length}枚)</div>
                    <div class="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-3 mb-4">${renderCardListHTML(setup.chosenSubPassives, false)}</div>
                    <div class="mt-4 border-t border-gray-700 pt-2 flex justify-between text-xs text-purple-400 mb-1">
                        <span><i class="fa-solid fa-shield-halved mr-1"></i>裏・警護デッキ (パッシブのみ有効: ${setup.chosenSubGuards.length}枚)</span>
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