// ========================================================
// 【防御力計算エンジン】js/engine-def.js (Ver. 2.06)
// 役割：拠点防衛・警護・内政統合防御デッキ最適化、2パス反復2次元DP、一般副将レアリティ倍率（SL80%/L70%/UR60%/SR50%/R40%）＆警護「警悟」限定・天候判定完全対応
// ========================================================
window.DefEngine = (function() {
    var isDefHighland = false;
    var isDefBuff10 = false;
    var isDefGoEnabled = true;
    var defGoBuffValue = 5500;
    var defAdjutantMode = 'REASSIGN_ALL';
    var currentDefOptimizedSetup = null;

    var skillParseCache = Object.create(null);
    var RE_GLOBAL_AURA = /(?:全拠点|全ての拠点|すべての拠点|自拠点.*?(?:防衛|防御|駐屯|戦闘))/;
    var RE_MATCH_ALL_DEF = /(?:全兵士|全ての兵士|全軍|全兵科|全拠点|全兵|[^\s、，]+兵)[、，・,\/\s]+(?:[^\s、，]+科)?武将[^\n。]*?(?:防御(?:力)?|(?:攻撃(?:力)?[と・、,\/])防御(?:力)?)(?:[と・、,\/](?:攻撃(?:力)?|移動速度|移速|知力|討伐ゲージ))*\s*[がをのは]?\s*([0-9\.]+)[%％]/;
    var RE_TROOP_DEF = /(?<!武将の)(?:防御(?:力)?|(?:攻撃(?:力)?[と・、,\/])防御(?:力)?)(?:[と・、,\/](?:攻撃(?:力)?|移動速度|移速|知力|討伐ゲージ))*\s*[がをのは]?\s*([0-9\.]+)[%％]/;
    var RE_ZEN_DEF = /(?:全拠点|自拠点)[^\n。]*?(?:全兵士|全ての兵士|全軍|全兵)[^\n。]*?(?<!武将の)防御(?:力)?(?:[と・、,\/](?:攻撃(?:力)?|移動速度|移速|知力|討伐ゲージ))*\s*[がをのは]?\s*([0-9\.]+)[%％]/;
    var RE_GEN_DEF = /(?:武将の戦闘時|全武将|武将|自身)[^\n。]*?(?:防御(?:力)?|(?:攻撃(?:力)?[と・、,\/])防御(?:力)?)(?:[と・、,\/](?:攻撃(?:力)?|移動速度|移速|知力|討伐ゲージ))*\s*[がをのは]?\s*([0-9\.]+)[%％]/;

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

    function isMasterFirstSkillMirror(sName, sDesc, firstDesc, isFromAdj, isHa) {
        if (isFromAdj) return false;
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
                               (targetStat === '防御' && c.indexOf('攻撃') !== -1 && c.indexOf('防御') === -1) ||
                               (targetStat === '攻撃' && c.indexOf('防御') !== -1 && c.indexOf('攻撃') === -1);
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

    function getDefTroopStats(troopKey) {
        var baseData = (SharedDB.TROOP_DATA && SharedDB.TROOP_DATA[troopKey]) || null;
        if (!baseData && SharedDB.TROOP_DATA) {
            var keys = Object.keys(SharedDB.TROOP_DATA);
            if (keys.length > 0) baseData = SharedDB.TROOP_DATA[keys[0]];
        }
        if (!baseData) {
            return { name: '大錘兵', type: '天兵', base: '錘', sub: '歩', attack: 165, defense: 165 };
        }
        var defVal = SharedDB.safeNum(baseData.defense !== undefined ? baseData.defense : baseData.attack, 100);
        return Object.assign({}, baseData, { defense: defVal });
    }

    function parseDefSkill(skill, targetTroopData, weatherObj) {
        var empty = {
            tDefMult: 0, gDefMult: 0,
            isPassive: false, isGuardDeck: false, mustBeSameBase: false,
            isSupport: false, isNaiseiActive: false, isBaseManualDef: false
        };
        if (!skill || typeof skill !== 'object') return empty;
        var name = String(skill.name || "").trim();
        var rawDesc = String(skill.description || "").trim();

        if (name.indexOf("覚:") === 0 || name.indexOf("副覚:") === 0 || name.indexOf("覚醒") !== -1) return empty;
        if (isDuelSkill(skill)) return empty;

        var cacheKey = name + '\x01' + rawDesc + '\x01' + targetTroopData.name + '\x01' + weatherObj;
        var cached = skillParseCache[cacheKey];
        if (cached) return cached;

        var normRawDesc = rawDesc.replace(/(\d),(\d{3})/g, '$1$2');
        var desc = (normRawDesc + " " + name).trim();
        var result = Object.assign({}, empty);
        if (!desc && !name) {
            skillParseCache[cacheKey] = result;
            return result;
        }

        // 出撃専用（「攻:」単独）は防御時には発動しない（「攻防:」は有効）
        if (name.indexOf("攻:") === 0 || name.indexOf("副攻:") === 0) {
            skillParseCache[cacheKey] = result;
            return result;
        }

        var hasExplicitManual = /(?:スキル使用中|スキル発動時|発動すると|一定時間|聖壁|堅守|鉄壁|勅令|号令|戦陣|極意)/.test(desc) &&
                                desc.indexOf("自動で発動") === -1 && desc.indexOf("自動発動") === -1;

        if (!hasExplicitManual && (
            desc.indexOf("自動で発動") !== -1 ||
            desc.indexOf("自動発動") !== -1 ||
            desc.indexOf("全滅時も発動") !== -1 ||
            desc.indexOf("パッシブ") !== -1 ||
            desc.indexOf("常に発動") !== -1 ||
            desc.indexOf("常時発動") !== -1 ||
            desc.indexOf("デッキにセット") !== -1 ||
            /(?:王威令|覇王令|守護令|鉄壁令)/.test(name)
        )) {
            result.isPassive = true;
        }
        if (desc.indexOf("警護デッキ") !== -1 || name.indexOf("警悟") !== -1 || desc.indexOf("警悟") !== -1) {
            result.isGuardDeck = true;
            result.isPassive = true;
        }

        var isGlobalAura = RE_GLOBAL_AURA.test(desc);
        if (!isGlobalAura || desc.indexOf("セットした拠点") !== -1 || desc.indexOf("この武将をセットした拠点") !== -1 || desc.indexOf("所属拠点が同一") !== -1) {
            result.mustBeSameBase = true;
        }

        var isDefPrefix = (name.indexOf("防:") === 0 || name.indexOf("副防:") === 0 || name.indexOf("攻防:") === 0 || name.indexOf("副攻防:") === 0);
        var isVarPrefix = (name.indexOf("変:") === 0 || name.indexOf("副変:") === 0);

        if (isDefPrefix || isVarPrefix || result.isPassive) {
            result.isSupport = true;
        }
        if (result.isSupport && (isDefPrefix || isVarPrefix) && !result.isPassive) {
            result.isNaiseiActive = true;
            if (result.mustBeSameBase) {
                result.isBaseManualDef = true;
            }
        }

        if (!result.isSupport) {
            skillParseCache[cacheKey] = result;
            return result;
        }

        // 防御力の記載がないスキル（攻撃力のみ・速度のみ）は除外
        if (normRawDesc.indexOf("防御") === -1) {
            skillParseCache[cacheKey] = result;
            return result;
        }

        var words = ["全兵士", "全ての兵士", "全軍", "全兵科", "全拠点", "全兵"];
        if (targetTroopData.type === "天兵") {
            words.push("天兵", "天兵科", targetTroopData.name, targetTroopData.base, targetTroopData.sub);
        } else if (targetTroopData.type === "鋭兵") {
            words.push("鋭兵", "鋭兵科", targetTroopData.name, targetTroopData.base, targetTroopData.sub);
        } else if (targetTroopData.type === "上級兵") {
            words.push("上級兵", "上級兵科", targetTroopData.name, targetTroopData.base, targetTroopData.sub);
        }

        var isTroopCompatible = false;
        for (var wi0 = 0; wi0 < words.length; wi0++) {
            if (desc.indexOf(words[wi0]) !== -1) {
                isTroopCompatible = true;
                break;
            }
        }
        if (isTroopCompatible && desc.indexOf("天兵を除く") !== -1 && targetTroopData.type === "天兵") {
            isTroopCompatible = false;
        }

        var weatherMult = calcWeatherMultSafe(normRawDesc, weatherObj, '防御');

        var tDef = 0, gDef = 0;
        var matchAll = normRawDesc.match(RE_MATCH_ALL_DEF);
        if (matchAll) {
            if (isTroopCompatible) tDef = parseFloat(matchAll[1]);
            gDef = parseFloat(matchAll[1]);
        } else {
            if (isTroopCompatible) {
                for (var wi = 0; wi < words.length; wi++) {
                    var pos = normRawDesc.indexOf(words[wi]);
                    if (pos !== -1) {
                        var m = normRawDesc.slice(pos).match(RE_TROOP_DEF);
                        if (m) {
                            tDef = parseFloat(m[1]);
                            break;
                        }
                    }
                }
                if (tDef === 0) {
                    var m_zen = normRawDesc.match(RE_ZEN_DEF);
                    if (m_zen) tDef = parseFloat(m_zen[1]);
                }
            }
            var gMatch = normRawDesc.match(RE_GEN_DEF);
            if (gMatch) gDef = parseFloat(gMatch[1]);
            else if (tDef > 0 && normRawDesc.indexOf("全軍") !== -1) gDef = tDef;
        }

        var mExtra = normRawDesc.match(/更に(?:(?:攻撃(?:力)?[と・、,\/])?防御(?:力)?(?:[と・、,\/](?:攻撃(?:力)?|移動速度|移速))*\s*[がをのは]?)?\s*([0-9\.]+)[%％]/);
        if (mExtra) {
            var extraV = parseFloat(mExtra[1]);
            var okWeather = true;
            if ((normRawDesc.indexOf("晴天候") !== -1 || normRawDesc.indexOf("晴天") !== -1) && weatherObj !== 'SUN') okWeather = false;
            if ((normRawDesc.indexOf("曇") !== -1 || normRawDesc.indexOf("雨") !== -1 || normRawDesc.indexOf("雪") !== -1 || normRawDesc.indexOf("荒天") !== -1 || normRawDesc.indexOf("陰天") !== -1 || normRawDesc.indexOf("悪天候") !== -1) && ['CLOUD', 'RAIN', 'SNOW'].indexOf(weatherObj) === -1) okWeather = false;
            if (okWeather) {
                if (tDef > 0) tDef += extraV;
                if (gDef > 0) gDef += extraV;
            }
        }

        result.tDefMult = tDef * weatherMult;
        result.gDefMult = gDef * weatherMult;
        skillParseCache[cacheKey] = result;
        return result;
    }

    // =========================================================================
    // 一般武将を副将にセットした時の第1スキル評価
    // ※副将のスキル効果はレアリティに応じて SL:80% / L:70% / UR:60% / SR:50% / R:40% で発動
    // =========================================================================
    function buildDefGeneralAdjutantCand(gCard, masterRole, targetTroopData, weatherObj, isSameBaseAsTarget) {
        if (!gCard || SharedDB.isHaBusho(gCard) || SharedDB.isMirrorCard(gCard.name)) return null;
        var skills = gCard.skills || [];
        if (skills.length === 0 || !skills[0]) return null;
        var s0 = skills[0];
        var sName = String(s0.name || '').trim();
        if (!sName || sName.indexOf('覚:') === 0 || sName.indexOf('副覚:') === 0 || isDuelSkill(s0)) return null;

        var adjRatio = getGeneralAdjutantRarityRatio(gCard.rarity);
        var p0 = parseDefSkill(s0, targetTroopData, weatherObj);
        if (!p0.isPassive) return null;
        // 警護デッキに居る主将の一般武将副将は「警悟」（警護デッキセット時）スキルのみ有効
        if (masterRole === 'guard' && !p0.isGuardDeck) return null;
        if (!isSameBaseAsTarget && p0.mustBeSameBase) return null;

        var tDefVal = SharedDB.safeNum(p0.tDefMult, 0) * adjRatio;
        var gDefVal = SharedDB.safeNum(p0.gDefMult, 0) * adjRatio;
        if (tDefVal <= 0 && gDefVal <= 0) return null;

        var cleanSName = sName.replace(/^(?:攻防|攻|防|変|副攻|副防|副変):/, '').replace(/LV[0-9]+$/i, '');
        var pctTag = Math.round(adjRatio * 100) + '%';
        var badge = (tDefVal > 0)
            ? ('[副' + pctTag + ']' + cleanSName + ' 兵防+' + SharedDB.formatBuffNum(tDefVal) + '%')
            : ('[副' + pctTag + ']' + cleanSName + ' 将防+' + SharedDB.formatBuffNum(gDefVal) + '%');

        return {
            card: gCard, uniqueId: gCard.uniqueId, cardNo: gCard.cardNo,
            genTMult: tDefVal, genGMult: gDefVal, label: badge,
            genStats: { defT: tDefVal, defG: gDefVal }
        };
    }

    function evaluateCardDef(card, targetTroopData, weatherObj, excludeSubSkills) {
        var emptySupport = {
            tDefMult: 0, gDefMult: 0, firstTDefMult: 0, firstGDefMult: 0,
            naiseiTDefMult: 0, naiseiGDefMult: 0, naiseiFirstTDefMult: 0, naiseiFirstGDefMult: 0,
            canBePassiveSlot: false, canBeGuardSlot: false, canBeNaiseiSlot: false,
            passiveMustBeSameBase: false, naiseiMustBeSameBase: false, isBaseManualDef: false
        };
        if (!card.skills || !Array.isArray(card.skills) || card.skills.length === 0) return emptySupport;

        var firstSkill = card.skills[0];
        var firstDesc = String((firstSkill && firstSkill.description) || '').trim();
        var baseParsed = parseDefSkill(firstSkill, targetTroopData, weatherObj);
        var isHa = SharedDB.isHaBusho(card);
        var kMultSelf = SharedDB.getKakuseiMultiplier(card);

        if (!baseParsed.isSupport) return emptySupport;

        var passiveOnlyT = 0, passiveOnlyG = 0;
        var naiseiMirrorT = 0, naiseiMirrorG = 0;
        var naiseiActiveCands = [];
        var isGuardCard = baseParsed.isGuardDeck;
        var passiveMustBeSameBase = false;

        var firstIsPassiveSupport = (baseParsed.isSupport && baseParsed.isPassive && (baseParsed.tDefMult > 0 || baseParsed.gDefMult > 0));
        var firstIsNaiseiActive = (baseParsed.isNaiseiActive && (baseParsed.tDefMult > 0 || baseParsed.gDefMult > 0));

        for (var idx = 0; idx < card.skills.length; idx++) {
            var skill = card.skills[idx];
            if (!skill || typeof skill !== 'object') continue;
            var name = String(skill.name || '').trim();
            var sDesc = String(skill.description || '').trim();

            if (name.indexOf("覚:") === 0 || name.indexOf("副覚:") === 0 || name.indexOf("覚醒") !== -1) continue;
            if (isDuelSkill(skill)) continue;

            var isFromAdj = (name.indexOf("副:") === 0 || name.indexOf("副変:") === 0 || name.indexOf("副攻:") === 0 || name.indexOf("副防:") === 0 || name.indexOf("副ﾃﾞｭｴﾙ:") === 0);
            if (excludeSubSkills && !isHa && isFromAdj) continue;

            var parsed = parseDefSkill(skill, targetTroopData, weatherObj);
            var isSelfMirror = (idx > 0) && isMasterFirstSkillMirror(name, sDesc, firstDesc, isFromAdj, isHa);

            if (isSelfMirror) {
                var writtenT = parsed.tDefMult || 0;
                var writtenG = parsed.gDefMult || 0;
                if (writtenT > 0 || writtenG > 0) {
                    if (firstIsPassiveSupport) {
                        passiveOnlyT += writtenT;
                        passiveOnlyG += writtenG;
                        if (baseParsed.mustBeSameBase) passiveMustBeSameBase = true;
                    } else if (firstIsNaiseiActive) {
                        naiseiMirrorT += writtenT;
                        naiseiMirrorG += writtenG;
                    }
                } else {
                    var rate = getSelfMirrorCopyRatio(skill);
                    if (firstIsPassiveSupport && (baseParsed.tDefMult > 0 || baseParsed.gDefMult > 0)) {
                        passiveOnlyT += (baseParsed.tDefMult / kMultSelf) * rate;
                        passiveOnlyG += (baseParsed.gDefMult / kMultSelf) * rate;
                        if (baseParsed.mustBeSameBase) passiveMustBeSameBase = true;
                    } else if (firstIsNaiseiActive && (baseParsed.tDefMult > 0 || baseParsed.gDefMult > 0)) {
                        naiseiMirrorT += (baseParsed.tDefMult / kMultSelf) * rate;
                        naiseiMirrorG += (baseParsed.gDefMult / kMultSelf) * rate;
                    }
                }
                continue;
            }

            if (parsed.tDefMult > 0 || parsed.gDefMult > 0) {
                if (parsed.isGuardDeck) isGuardCard = true;
                if (parsed.isPassive) {
                    passiveOnlyT += parsed.tDefMult;
                    passiveOnlyG += parsed.gDefMult;
                    if (parsed.mustBeSameBase) passiveMustBeSameBase = true;
                } else if (isFromAdj && (name.indexOf("副変:") === 0)) {
                    if (firstIsNaiseiActive) {
                        naiseiMirrorT += parsed.tDefMult;
                        naiseiMirrorG += parsed.gDefMult;
                    }
                } else if (!isFromAdj && parsed.isNaiseiActive) {
                    naiseiActiveCands.push(parsed);
                }
            }
        }

        var naiseiActiveT = 0, naiseiActiveG = 0;
        var hasNaiseiActive = false;
        var isBaseManualDef = false;
        var naiseiMustBeSameBase = passiveMustBeSameBase;

        if (naiseiActiveCands.length > 0) {
            hasNaiseiActive = true;
            if (isHa) {
                for (var ai = 0; ai < naiseiActiveCands.length; ai++) {
                    naiseiActiveT += naiseiActiveCands[ai].tDefMult;
                    naiseiActiveG += naiseiActiveCands[ai].gDefMult;
                    if (naiseiActiveCands[ai].mustBeSameBase) naiseiMustBeSameBase = true;
                    if (naiseiActiveCands[ai].isBaseManualDef) isBaseManualDef = true;
                }
            } else {
                naiseiActiveCands.sort(function(a, b) {
                    if (Math.abs(b.tDefMult - a.tDefMult) > 1e-6) return b.tDefMult - a.tDefMult;
                    return b.gDefMult - a.gDefMult;
                });
                naiseiActiveT = naiseiActiveCands[0].tDefMult;
                naiseiActiveG = naiseiActiveCands[0].gDefMult;
                if (naiseiActiveCands[0].mustBeSameBase) naiseiMustBeSameBase = true;
                if (naiseiActiveCands[0].isBaseManualDef) isBaseManualDef = true;
            }
        }

        var naiseiTotalT = passiveOnlyT + naiseiMirrorT + naiseiActiveT;
        var naiseiTotalG = passiveOnlyG + naiseiMirrorG + naiseiActiveG;

        return {
            tDefMult: passiveOnlyT,
            gDefMult: passiveOnlyG,
            firstTDefMult: firstIsPassiveSupport ? baseParsed.tDefMult : 0,
            firstGDefMult: firstIsPassiveSupport ? baseParsed.gDefMult : 0,
            naiseiTDefMult: naiseiTotalT,
            naiseiGDefMult: naiseiTotalG,
            naiseiFirstTDefMult: (firstIsPassiveSupport || firstIsNaiseiActive) ? baseParsed.tDefMult : 0,
            naiseiFirstGDefMult: (firstIsPassiveSupport || firstIsNaiseiActive) ? baseParsed.gDefMult : 0,
            canBePassiveSlot: !isGuardCard && (passiveOnlyT > 0 || passiveOnlyG > 0),
            canBeGuardSlot: isGuardCard && (passiveOnlyT > 0 || passiveOnlyG > 0),
            canBeNaiseiSlot: hasNaiseiActive && (naiseiTotalT > 0 || naiseiTotalG > 0),
            passiveMustBeSameBase: passiveMustBeSameBase,
            naiseiMustBeSameBase: naiseiMustBeSameBase,
            isBaseManualDef: isBaseManualDef
        };
    }

    function getBestWeatherForCardDef(card, targetTroopData, excludeSubSkills) {
        var weathers = ['SUN', 'CLOUD', 'RAIN', 'SNOW'];
        var bestW = 'SUN';
        var bestPassiveW = 'SUN';
        var maxEval = null;
        var maxNaiseiEval = null;
        var bestPScore = -1;
        var bestNScore = -1;

        for (var i = 0; i < weathers.length; i++) {
            var w = weathers[i];
            var ev = evaluateCardDef(card, targetTroopData, w, excludeSubSkills);
            var pSc = ev.tDefMult * 100 + ev.gDefMult;
            if (pSc > bestPScore) {
                bestPScore = pSc;
                maxEval = ev;
                bestPassiveW = w;
            }
            var nSc = ev.naiseiTDefMult * 100 + ev.naiseiGDefMult;
            if (nSc > bestNScore) {
                bestNScore = nSc;
                maxNaiseiEval = ev;
                bestW = w;
            }
        }
        return {
            bestWeather: bestW,
            bestPassiveWeather: bestPassiveW,
            eval: maxEval || evaluateCardDef(card, targetTroopData, 'SUN', excludeSubSkills),
            naiseiEval: maxNaiseiEval || evaluateCardDef(card, targetTroopData, 'SUN', excludeSubSkills)
        };
    }

    function solveDefDeckKnapsackWithNaiseiLimits(costLimit, maxNaiseiSlots, candidates) {
        var maxW = Math.max(0, Math.round(costLimit * 2));
        var maxN = Math.max(0, maxNaiseiSlots);
        var NEG = -1e15;

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
            var val = SharedDB.safeNum(it.dpScore, it.tDefMult);

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

    function fastUpdateDefMultiplier() {
        if (!currentDefOptimizedSetup) { run(false); return; }
        var altMultiplier = isDefHighland ? 1.2 : 1.0;
        var buff10Multiplier = isDefBuff10 ? 1.1 : 1.0;
        var elGo = document.getElementById('optDefGoBuff');
        var goBuff = isDefGoEnabled ? SharedDB.safeNum(elGo && elGo.value, defGoBuffValue) : 0;

        currentDefOptimizedSetup.altMultiplier = altMultiplier;
        currentDefOptimizedSetup.buff10Multiplier = buff10Multiplier;
        currentDefOptimizedSetup.goBuff = goBuff;

        var finalTroopDefMult = currentDefOptimizedSetup.pureTroopDefMult + goBuff;
        var finalGenDefMult = currentDefOptimizedSetup.pureGenDefMult + goBuff;
        var troopDefense = Math.floor(currentDefOptimizedSetup.targetTroopData.defense * currentDefOptimizedSetup.troopCount * (1 + (finalTroopDefMult / 100)));
        var genDefense = Math.floor(currentDefOptimizedSetup.totalGenBaseDef * (1 + (finalGenDefMult / 100)));
        var baseTotalDefense = troopDefense + genDefense;

        currentDefOptimizedSetup.troopDefense = troopDefense;
        currentDefOptimizedSetup.genDefense = genDefense;
        currentDefOptimizedSetup.finalTroopDefMult = finalTroopDefMult;
        currentDefOptimizedSetup.finalGenDefMult = finalGenDefMult;
        currentDefOptimizedSetup.baseTotalDefense = baseTotalDefense;
        currentDefOptimizedSetup.finalTotalDefense = Math.floor(baseTotalDefense * altMultiplier * buff10Multiplier);
        render(currentDefOptimizedSetup);
    }

    function run(shouldAutoWeather) {
        try {
            var uCards = AppCards.userCards;
            if (!uCards || uCards.length === 0) return;
            AppCards.setStatusLog("防御最適化計算中... (" + uCards.length + "枚)");

            var elTroop = document.getElementById('defTroop');
            var elTroopCount = document.getElementById('defTroopCount');
            var elCost = document.getElementById('defCostDist');
            var elDefOrigin = document.getElementById('defTargetOrigin') || document.getElementById('defDefenseOrigin') || document.getElementById('defOrigin');

            var troopKey = elTroop ? elTroop.value : 'HAMMER';
            var targetTroopData = getDefTroopStats(troopKey);
            var troopCount = elTroopCount ? (parseInt(elTroopCount.value, 10) || 0) : 100000;
            var costDist = elCost ? elCost.value : '25-30';
            var honkyoLimit = costDist === '30-25' ? 30.0 : 25.0;
            var kyotenLimit = costDist === '30-25' ? 25.0 : 30.0;
            var defOrigin = elDefOrigin ? elDefOrigin.value : 'HONKYO';
            var isHonkyoDef = (defOrigin === 'HONKYO');
            var originSlotId = isHonkyoDef ? 'h0' : 'k0';
            var originLimit = isHonkyoDef ? honkyoLimit : kyotenLimit;

            var isReassignMode = (defAdjutantMode !== 'CURRENT');
            var validCards = uCards.filter(function(c) { return !c.isAdjutant && !AppCards.excludedCardIds.has(c.uniqueId); });

            var unifiedPools = SharedDB.buildUnifiedAdjutantPools(uCards, AppCards.excludedCardIds, isReassignMode);
            var allMirrorPool = unifiedPools.mirrorPool;
            var allGeneralPool = unifiedPools.generalPool;

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
            if (isReassignMode) {
                var teisenFkCards = allMirrorPool.filter(function(m) { return m.info && m.info.type === 'senkyo'; });
                if (teisenFkCards.length > 0) {
                    var teisenCandidateList = validCards.filter(function(c) {
                        var origC = SharedDB.safeNum(c.originalCost !== undefined ? c.originalCost : c.cost, 4.5);
                        if (SharedDB.isHaBusho(c) || String(c.rarity || '').toUpperCase() !== 'SL' || SharedDB.safeNum(c.maxFukushoCost, 0) <= 0 || origC <= 1.0) {
                            return false;
                        }
                        var evS = getBestWeatherForCardDef(c, targetTroopData, true);
                        return (evS.eval && evS.eval.canBePassiveSlot) || (evS.naiseiEval && evS.naiseiEval.canBeNaiseiSlot);
                    });
                    teisenCandidateList.sort(function(a, b) {
                        var origA = SharedDB.safeNum(a.originalCost !== undefined ? a.originalCost : a.cost, 4.5);
                        var origB = SharedDB.safeNum(b.originalCost !== undefined ? b.originalCost : b.cost, 4.5);
                        if (origB !== origA) return origB - origA;
                        var evA = getBestWeatherForCardDef(a, targetTroopData, true);
                        var evB = getBestWeatherForCardDef(b, targetTroopData, true);
                        var vA = Math.max(evA.eval.tDefMult, evA.naiseiEval.naiseiTDefMult);
                        var vB = Math.max(evB.eval.tDefMult, evB.naiseiEval.naiseiTDefMult);
                        return vB - vA;
                    });
                    for (var ti = 0; ti < Math.min(teisenFkCards.length, teisenCandidateList.length); ti++) {
                        var tgtCard = teisenCandidateList[ti];
                        var tFk = teisenFkCards[ti];
                        preTeisenAssignedMap[tgtCard.uniqueId] = tFk;
                        usedTeisenCardIds.add(tFk.uniqueId);
                        effectiveCostMap[tgtCard.uniqueId] = 1.0;
                    }
                }
            }

            var mirrorCount = allMirrorPool.length;
            var initSlCopyRatio = isReassignMode ? (mirrorCount >= 18 ? 1.55 : (mirrorCount >= 10 ? 1.15 : 0.65)) : 0;
            var initLCopyRatio = isReassignMode ? (mirrorCount >= 18 ? 0.65 : (mirrorCount >= 10 ? 0.45 : 0.25)) : 0;

            var baseManualPool = [], frontGlobalPool = [], frontBoundPool = [], guardPool = [];
            for (var si = 0; si < validCards.length; si++) {
                var sc = validCards[si];
                if (usedTeisenCardIds.has(sc.uniqueId)) continue;
                var bestSup = getBestWeatherForCardDef(sc, targetTroopData, isReassignMode);
                var pProbe = bestSup.eval;
                var nProbe = bestSup.naiseiEval;
                var effCost = effectiveCostMap[sc.uniqueId];

                var hasAdjSlot = (!SharedDB.isHaBusho(sc) && SharedDB.safeNum(sc.maxFukushoCost, 0) > 0 && isReassignMode);
                var scRarity = String(sc.rarity || 'SL').toUpperCase();
                var estRatio = !hasAdjSlot ? 0 : (scRarity === 'SL' ? initSlCopyRatio : initLCopyRatio);
                var kSelf = SharedDB.getKakuseiMultiplier(sc);

                if (pProbe && pProbe.canBeGuardSlot) {
                    var gBonusEst = hasAdjSlot ? ((SharedDB.safeNum(pProbe.firstTDefMult, 0) / kSelf) * estRatio) : 0;
                    guardPool.push({
                        card: sc, effectiveCost: effCost, cost: effCost,
                        tDefMult: pProbe.tDefMult, gDefMult: pProbe.gDefMult,
                        dpScore: pProbe.tDefMult + (pProbe.gDefMult * 0.05) + gBonusEst,
                        firstTDefMult: pProbe.firstTDefMult, firstGDefMult: pProbe.firstGDefMult,
                        isBound: pProbe.passiveMustBeSameBase, isBaseManualDef: false, isManualNaisei: false,
                        weather: bestSup.bestPassiveWeather
                    });
                }

                var canNaisei = Boolean(nProbe && nProbe.canBeNaiseiSlot && (nProbe.naiseiTDefMult > 0 || nProbe.naiseiGDefMult > 0));
                var canPassive = Boolean(pProbe && pProbe.canBePassiveSlot && (pProbe.tDefMult > 0 || pProbe.gDefMult > 0));

                if (canNaisei && nProbe.isBaseManualDef) {
                    var originW = shouldAutoWeather ? bestSup.bestWeather : (AppCards.slotWeathers[originSlotId] || 'SUN');
                    var ev = evaluateCardDef(sc, targetTroopData, originW, isReassignMode);
                    if (ev.canBeNaiseiSlot && (ev.naiseiTDefMult > 0 || ev.naiseiGDefMult > 0)) {
                        var sBonusEst = hasAdjSlot ? ((SharedDB.safeNum(ev.naiseiFirstTDefMult, 0) / kSelf) * estRatio) : 0;
                        baseManualPool.push({
                            card: sc, effectiveCost: effCost, cost: effCost,
                            tDefMult: ev.naiseiTDefMult, gDefMult: ev.naiseiGDefMult,
                            dpScore: ev.naiseiTDefMult + (ev.naiseiGDefMult * 0.05) + sBonusEst,
                            firstTDefMult: ev.naiseiFirstTDefMult, firstGDefMult: ev.naiseiFirstGDefMult,
                            isBound: ev.naiseiMustBeSameBase, isBaseManualDef: true, isManualNaisei: true,
                            weather: originW
                        });
                    }
                } else if (canNaisei && (!canPassive || (nProbe.naiseiTDefMult + nProbe.naiseiGDefMult * 0.05) >= (pProbe.tDefMult + pProbe.gDefMult * 0.05))) {
                    var nBonusEst = hasAdjSlot ? ((SharedDB.safeNum(nProbe.naiseiFirstTDefMult, 0) / kSelf) * estRatio) : 0;
                    var nItem = {
                        card: sc, effectiveCost: effCost, cost: effCost,
                        tDefMult: nProbe.naiseiTDefMult, gDefMult: nProbe.naiseiGDefMult,
                        dpScore: nProbe.naiseiTDefMult + (nProbe.naiseiGDefMult * 0.05) + nBonusEst,
                        firstTDefMult: nProbe.naiseiFirstTDefMult, firstGDefMult: nProbe.naiseiFirstGDefMult,
                        isBound: nProbe.naiseiMustBeSameBase, isBaseManualDef: false, isManualNaisei: true,
                        weather: bestSup.bestWeather
                    };
                    if (nProbe.naiseiMustBeSameBase) frontBoundPool.push(nItem);
                    else frontGlobalPool.push(nItem);
                } else if (canPassive) {
                    var pBonusEst = hasAdjSlot ? ((SharedDB.safeNum(pProbe.firstTDefMult, 0) / kSelf) * estRatio) : 0;
                    var pItem = {
                        card: sc, effectiveCost: effCost, cost: effCost,
                        tDefMult: pProbe.tDefMult, gDefMult: pProbe.gDefMult,
                        dpScore: pProbe.tDefMult + (pProbe.gDefMult * 0.05) + pBonusEst,
                        firstTDefMult: pProbe.firstTDefMult, firstGDefMult: pProbe.firstGDefMult,
                        isBound: pProbe.passiveMustBeSameBase, isBaseManualDef: false, isManualNaisei: false,
                        weather: bestSup.bestPassiveWeather
                    };
                    if (pProbe.passiveMustBeSameBase) frontBoundPool.push(pItem);
                    else frontGlobalPool.push(pItem);
                }
            }

            var dedupByCardNo = function(pool, usedNosSet) {
                var bestMap = Object.create(null);
                for (var idx = 0; idx < pool.length; idx++) {
                    var it = pool[idx];
                    var cNo = it.card.cardNo || it.card.uniqueId;
                    if (usedNosSet && usedNosSet.has(cNo)) continue;
                    var sc = SharedDB.safeNum(it.dpScore, it.tDefMult);
                    if (!bestMap[cNo] || sc > SharedDB.safeNum(bestMap[cNo].dpScore, bestMap[cNo].tDefMult)) {
                        bestMap[cNo] = it;
                    }
                }
                return Object.values(bestMap);
            };

            function evaluateFullDefPlan(adjBonusOverrideMap) {
                var applyOverride = function(arr) {
                    if (!adjBonusOverrideMap) return arr;
                    return arr.map(function(it) {
                        var ov = adjBonusOverrideMap[it.card.uniqueId];
                        if (ov !== undefined) {
                            return Object.assign({}, it, { dpScore: it.tDefMult + (it.gDefMult * 0.05) + ov });
                        }
                        return it;
                    });
                };

                var curBaseManualPool = applyOverride(baseManualPool);
                var curGlobalPool = applyOverride(frontGlobalPool);
                var curBoundPool = applyOverride(frontBoundPool);
                var curGuardPool = applyOverride(guardPool);

                var manualByBuff = dedupByCardNo(curBaseManualPool, null).sort(function(a, b) {
                    return SharedDB.safeNum(b.dpScore, b.tDefMult) - SharedDB.safeNum(a.dpScore, a.tDefMult);
                });
                var manualByEff = dedupByCardNo(curBaseManualPool, null).sort(function(a, b) {
                    return (SharedDB.safeNum(b.dpScore, b.tDefMult) / Math.max(0.5, b.effectiveCost)) -
                           (SharedDB.safeNum(a.dpScore, a.tDefMult) / Math.max(0.5, a.effectiveCost));
                });
                var manualPatterns = [null];
                var seenManNos = new Set();
                manualByBuff.slice(0, 3).concat(manualByEff.slice(0, 3)).forEach(function(sIt) {
                    var sNo = sIt.card.cardNo || sIt.card.uniqueId;
                    if (!seenManNos.has(sNo)) {
                        seenManNos.add(sNo);
                        manualPatterns.push(sIt);
                    }
                });

                var bestLocalScore = -1;
                var bestLocalSetup = null;

                for (var spIdx = 0; spIdx < manualPatterns.length; spIdx++) {
                    var chosenBaseManual = manualPatterns[spIdx];
                    var manCost = chosenBaseManual ? chosenBaseManual.effectiveCost : 0.0;
                    var manBuffT = chosenBaseManual ? chosenBaseManual.tDefMult : 0.0;
                    var manBuffG = chosenBaseManual ? chosenBaseManual.gDefMult : 0.0;
                    var manDpScore = chosenBaseManual ? SharedDB.safeNum(chosenBaseManual.dpScore, chosenBaseManual.tDefMult) : 0.0;
                    if (manCost > originLimit + 1e-6) continue;

                    var baseUsedNos = new Set();
                    if (chosenBaseManual) baseUsedNos.add(chosenBaseManual.card.cardNo || chosenBaseManual.card.uniqueId);

                    var hCapCost = isHonkyoDef ? (honkyoLimit - manCost) : honkyoLimit;
                    var kCapCost = isHonkyoDef ? kyotenLimit : (kyotenLimit - manCost);
                    var maxHNaiseiSlots = isHonkyoDef ? (chosenBaseManual ? 1 : 2) : 2;
                    var maxKNaiseiSlots = isHonkyoDef ? 9 : (chosenBaseManual ? 8 : 9);

                    var strategies = [1, 2];
                    for (var stIdx = 0; stIdx < strategies.length; stIdx++) {
                        var strat = strategies[stIdx];
                        var usedNos = new Set(baseUsedNos);
                        var hManual = [], kManual = [], hPassives = [], kPassives = [];

                        if (isHonkyoDef) {
                            if (strat === 1) {
                                var kAvail1 = dedupByCardNo(curGlobalPool, usedNos);
                                var kRes1 = solveDefDeckKnapsackWithNaiseiLimits(kCapCost, maxKNaiseiSlots, kAvail1);
                                kRes1.picked.forEach(function(x) {
                                    usedNos.add(x.card.cardNo || x.card.uniqueId);
                                    if (x.isManualNaisei) kManual.push(x);
                                    else kPassives.push(x);
                                });
                                var hAvail1 = dedupByCardNo(curBoundPool.concat(curGlobalPool), usedNos);
                                var hRes1 = solveDefDeckKnapsackWithNaiseiLimits(hCapCost, maxHNaiseiSlots, hAvail1);
                                hRes1.picked.forEach(function(x) {
                                    usedNos.add(x.card.cardNo || x.card.uniqueId);
                                    if (x.isManualNaisei) hManual.push(x);
                                    else hPassives.push(x);
                                });
                            } else {
                                var hAvail2 = dedupByCardNo(curBoundPool.concat(curGlobalPool), usedNos);
                                var hRes2 = solveDefDeckKnapsackWithNaiseiLimits(hCapCost, maxHNaiseiSlots, hAvail2);
                                hRes2.picked.forEach(function(x) {
                                    usedNos.add(x.card.cardNo || x.card.uniqueId);
                                    if (x.isManualNaisei) hManual.push(x);
                                    else hPassives.push(x);
                                });
                                var kAvail2 = dedupByCardNo(curGlobalPool, usedNos);
                                var kRes2 = solveDefDeckKnapsackWithNaiseiLimits(kCapCost, maxKNaiseiSlots, kAvail2);
                                kRes2.picked.forEach(function(x) {
                                    usedNos.add(x.card.cardNo || x.card.uniqueId);
                                    if (x.isManualNaisei) kManual.push(x);
                                    else kPassives.push(x);
                                });
                            }
                        } else {
                            if (strat === 1) {
                                var hAvail3 = dedupByCardNo(curGlobalPool, usedNos);
                                var hRes3 = solveDefDeckKnapsackWithNaiseiLimits(hCapCost, maxHNaiseiSlots, hAvail3);
                                hRes3.picked.forEach(function(x) {
                                    usedNos.add(x.card.cardNo || x.card.uniqueId);
                                    if (x.isManualNaisei) hManual.push(x);
                                    else hPassives.push(x);
                                });
                                var kAvail3 = dedupByCardNo(curBoundPool.concat(curGlobalPool), usedNos);
                                var kRes3 = solveDefDeckKnapsackWithNaiseiLimits(kCapCost, maxKNaiseiSlots, kAvail3);
                                kRes3.picked.forEach(function(x) {
                                    usedNos.add(x.card.cardNo || x.card.uniqueId);
                                    if (x.isManualNaisei) kManual.push(x);
                                    else kPassives.push(x);
                                });
                            } else {
                                var kAvail4 = dedupByCardNo(curBoundPool.concat(curGlobalPool), usedNos);
                                var kRes4 = solveDefDeckKnapsackWithNaiseiLimits(kCapCost, maxKNaiseiSlots, kAvail4);
                                kRes4.picked.forEach(function(x) {
                                    usedNos.add(x.card.cardNo || x.card.uniqueId);
                                    if (x.isManualNaisei) kManual.push(x);
                                    else kPassives.push(x);
                                });
                                var hAvail4 = dedupByCardNo(curGlobalPool, usedNos);
                                var hRes4 = solveDefDeckKnapsackWithNaiseiLimits(hCapCost, maxHNaiseiSlots, hAvail4);
                                hRes4.picked.forEach(function(x) {
                                    usedNos.add(x.card.cardNo || x.card.uniqueId);
                                    if (x.isManualNaisei) hManual.push(x);
                                    else hPassives.push(x);
                                });
                            }
                        }

                        var allPickedItems = hManual.concat(kManual, hPassives, kPassives);
                        var rawBuffT = manBuffT + allPickedItems.reduce(function(s, x) { return s + x.tDefMult; }, 0);
                        var rawBuffG = manBuffG + allPickedItems.reduce(function(s, x) { return s + x.gDefMult; }, 0);
                        var dpTotalScore = manDpScore + allPickedItems.reduce(function(s, x) { return s + SharedDB.safeNum(x.dpScore, x.tDefMult); }, 0);

                        if (dpTotalScore > bestLocalScore) {
                            bestLocalScore = dpTotalScore;
                            var currentSlots = {};
                            if (chosenBaseManual) currentSlots[originSlotId] = Object.assign({}, chosenBaseManual, { isBaseManualDef: true });

                            hManual.sort(function(a, b) { return b.tDefMult - a.tDefMult; });
                            kManual.sort(function(a, b) { return b.tDefMult - a.tDefMult; });
                            hPassives.sort(function(a, b) { return b.tDefMult - a.tDefMult; });
                            kPassives.sort(function(a, b) { return b.tDefMult - a.tDefMult; });

                            if (!isHonkyoDef) {
                                for (var hi = 0; hi < hManual.length; hi++) currentSlots['h' + hi] = hManual[hi];
                                for (var ki = 0; ki < kManual.length; ki++) currentSlots['k' + (ki + 1)] = kManual[ki];
                            } else {
                                for (var hi2 = 0; hi2 < hManual.length; hi2++) currentSlots['h' + (hi2 + 1)] = hManual[hi2];
                                for (var ki2 = 0; ki2 < kManual.length; ki2++) currentSlots['k' + ki2] = kManual[ki2];
                            }

                            var hTotalCost = (isHonkyoDef ? manCost : 0) +
                                             hManual.reduce(function(s, x) { return s + x.effectiveCost; }, 0) +
                                             hPassives.reduce(function(s, x) { return s + x.effectiveCost; }, 0);
                            var kTotalCost = (!isHonkyoDef ? manCost : 0) +
                                             kManual.reduce(function(s, x) { return s + x.effectiveCost; }, 0) +
                                             kPassives.reduce(function(s, x) { return s + x.effectiveCost; }, 0);

                            bestLocalSetup = {
                                activeSlots: currentSlots,
                                basePassives: hPassives,
                                subPassives: kPassives,
                                totalTroopDefMult: rawBuffT,
                                totalGenDefMult: rawBuffG,
                                hCost: hTotalCost,
                                kCost: kTotalCost,
                                activeCountBase: Object.keys(currentSlots).filter(function(s) { return s.indexOf('h') === 0; }).length,
                                activeCountSub: Object.keys(currentSlots).filter(function(s) { return s.indexOf('k') === 0; }).length,
                                usedNos: usedNos
                            };
                        }
                    }
                }

                if (!bestLocalSetup) return null;

                if (!shouldAutoWeather) {
                    var recalcSlots = {};
                    var recalcActT = 0, recalcActG = 0;
                    Object.keys(bestLocalSetup.activeSlots).forEach(function(sId) {
                        var sItem = bestLocalSetup.activeSlots[sId];
                        var slotW = AppCards.slotWeathers[sId] || sItem.weather || 'SUN';
                        var reEv = evaluateCardDef(sItem.card, targetTroopData, slotW, isReassignMode);
                        var updatedItem = Object.assign({}, sItem, {
                            tDefMult: SharedDB.safeNum(reEv.naiseiTDefMult, 0),
                            gDefMult: SharedDB.safeNum(reEv.naiseiGDefMult, 0),
                            firstTDefMult: SharedDB.safeNum(reEv.naiseiFirstTDefMult, 0),
                            firstGDefMult: SharedDB.safeNum(reEv.naiseiFirstGDefMult, 0),
                            weather: slotW
                        });
                        recalcSlots[sId] = updatedItem;
                        recalcActT += updatedItem.tDefMult;
                        recalcActG += updatedItem.gDefMult;
                    });
                    var pOnlyT = bestLocalSetup.basePassives.concat(bestLocalSetup.subPassives).reduce(function(s, p) { return s + SharedDB.safeNum(p.tDefMult, 0); }, 0);
                    var pOnlyG = bestLocalSetup.basePassives.concat(bestLocalSetup.subPassives).reduce(function(s, p) { return s + SharedDB.safeNum(p.gDefMult, 0); }, 0);
                    bestLocalSetup.activeSlots = recalcSlots;
                    bestLocalSetup.totalTroopDefMult = recalcActT + pOnlyT;
                    bestLocalSetup.totalGenDefMult = recalcActG + pOnlyG;
                }

                var finalUsedNos = new Set(bestLocalSetup.usedNos);
                var filterBestGuardPerNo = function(pool) {
                    var bestMap = Object.create(null);
                    for (var gi = 0; gi < pool.length; gi++) {
                        var g = pool[gi];
                        var gNo = g.card.cardNo || g.card.uniqueId;
                        if (finalUsedNos.has(gNo) || (g.tDefMult <= 0 && g.gDefMult <= 0)) continue;
                        var dpItem = {
                            card: g.card, cost: g.effectiveCost, effectiveCost: g.effectiveCost,
                            tMult: SharedDB.safeNum(g.dpScore, g.tDefMult), rawTDefMult: g.tDefMult, gDefMult: g.gDefMult,
                            firstTDefMult: g.firstTDefMult, firstGDefMult: g.firstGDefMult, isBound: g.isBound
                        };
                        if (!bestMap[gNo] || dpItem.tMult > bestMap[gNo].tMult) bestMap[gNo] = dpItem;
                    }
                    return Object.values(bestMap);
                };

                var availGuards = filterBestGuardPerNo(curGuardPool);
                var hGuards = SharedDB.solveKnapsackDP(honkyoLimit, availGuards.filter(function(x) { return !x.isBound || isHonkyoDef; }));
                var hGuardPicked = hGuards.picked.map(function(x) { return Object.assign({}, x, { tDefMult: x.rawTDefMult }); });
                var hGuardNos = new Set(hGuardPicked.map(function(x) { return x.card.cardNo || x.card.uniqueId; }));
                var kGuards = SharedDB.solveKnapsackDP(kyotenLimit, availGuards.filter(function(x) { return (!x.isBound || !isHonkyoDef) && !hGuardNos.has(x.card.cardNo || x.card.uniqueId); }));
                var kGuardPicked = kGuards.picked.map(function(x) { return Object.assign({}, x, { tDefMult: x.rawTDefMult }); });

                var guardBuffT = hGuardPicked.concat(kGuardPicked).reduce(function(s, x) { return s + x.tDefMult; }, 0);
                var guardBuffG = hGuardPicked.concat(kGuardPicked).reduce(function(s, x) { return s + x.gDefMult; }, 0);
                var totalTroopDefMult = bestLocalSetup.totalTroopDefMult + guardBuffT;
                var totalGenDefMult = bestLocalSetup.totalGenDefMult + guardBuffG;

                var assignedAdjutantsMap = (defAdjutantMode === 'CURRENT') ? null : Object.create(null);
                var additionalAdjutantBuffT = 0;
                var additionalAdjutantBuffG = 0;
                var adjutantAddedBuffMap = Object.create(null);
                var adjutantAddedGenBuffMap = Object.create(null);
                var usedAdjutantCostMap = Object.create(null);
                var totalDefAdjStatusBonus = 0;

                var allDeckUsedIds = new Set();
                var allDeckUsedNos = new Set();
                Object.values(bestLocalSetup.activeSlots).forEach(function(x) {
                    allDeckUsedIds.add(x.card.uniqueId);
                    allDeckUsedNos.add(x.card.cardNo || x.card.uniqueId);
                });
                bestLocalSetup.basePassives.concat(bestLocalSetup.subPassives, hGuardPicked, kGuardPicked).forEach(function(x) {
                    allDeckUsedIds.add(x.card.uniqueId);
                    allDeckUsedNos.add(x.card.cardNo || x.card.uniqueId);
                });

                var usedMirrorIds = new Set();
                var usedMirrorNos = new Set();

                var masterList = [];
                Object.keys(bestLocalSetup.activeSlots).forEach(function(sId) {
                    var it = bestLocalSetup.activeSlots[sId];
                    if (it.card && !SharedDB.isHaBusho(it.card) && SharedDB.safeNum(it.card.maxFukushoCost, 0) > 0 && (it.firstTDefMult > 0 || it.firstGDefMult > 0)) {
                        var kMult2 = SharedDB.getKakuseiMultiplier(it.card);
                        var isSameBaseSlot = isHonkyoDef ? (sId.indexOf('h') === 0) : (sId.indexOf('k') === 0);
                        masterList.push({
                            role: 'active', card: it.card, isSameBaseAsTarget: isSameBaseSlot,
                            maxCost: SharedDB.safeNum(it.card.maxFukushoCost, 4.5),
                            baseCopyVal: it.firstTDefMult / kMult2,
                            baseCopyGenVal: it.firstGDefMult / kMult2,
                            priority: 5000000 + it.firstTDefMult * 10 + it.firstGDefMult
                        });
                    }
                });
                bestLocalSetup.basePassives.forEach(function(p) {
                    if (p.card && !SharedDB.isHaBusho(p.card) && SharedDB.safeNum(p.card.maxFukushoCost, 0) > 0 && (p.firstTDefMult > 0 || p.firstGDefMult > 0)) {
                        var kMult3 = SharedDB.getKakuseiMultiplier(p.card);
                        masterList.push({
                            role: 'passive', card: p.card, isSameBaseAsTarget: isHonkyoDef,
                            maxCost: SharedDB.safeNum(p.card.maxFukushoCost, 4.5),
                            baseCopyVal: p.firstTDefMult / kMult3,
                            baseCopyGenVal: p.firstGDefMult / kMult3,
                            priority: 1000000 + p.firstTDefMult * 10 + p.firstGDefMult
                        });
                    }
                });
                bestLocalSetup.subPassives.forEach(function(p) {
                    if (p.card && !SharedDB.isHaBusho(p.card) && SharedDB.safeNum(p.card.maxFukushoCost, 0) > 0 && (p.firstTDefMult > 0 || p.firstGDefMult > 0)) {
                        var kMult3 = SharedDB.getKakuseiMultiplier(p.card);
                        masterList.push({
                            role: 'passive', card: p.card, isSameBaseAsTarget: !isHonkyoDef,
                            maxCost: SharedDB.safeNum(p.card.maxFukushoCost, 4.5),
                            baseCopyVal: p.firstTDefMult / kMult3,
                            baseCopyGenVal: p.firstGDefMult / kMult3,
                            priority: 1000000 + p.firstTDefMult * 10 + p.firstGDefMult
                        });
                    }
                });
                // 警護デッキに居る主将は role: 'guard' とし、副将には「警悟」スキル持ちのみ許可
                hGuardPicked.forEach(function(p) {
                    if (p.card && !SharedDB.isHaBusho(p.card) && SharedDB.safeNum(p.card.maxFukushoCost, 0) > 0 && (p.firstTDefMult > 0 || p.firstGDefMult > 0)) {
                        var kMult3 = SharedDB.getKakuseiMultiplier(p.card);
                        masterList.push({
                            role: 'guard', card: p.card, isSameBaseAsTarget: isHonkyoDef,
                            maxCost: SharedDB.safeNum(p.card.maxFukushoCost, 4.5),
                            baseCopyVal: p.firstTDefMult / kMult3,
                            baseCopyGenVal: p.firstGDefMult / kMult3,
                            priority: 1000000 + p.firstTDefMult * 10 + p.firstGDefMult
                        });
                    }
                });
                kGuardPicked.forEach(function(p) {
                    if (p.card && !SharedDB.isHaBusho(p.card) && SharedDB.safeNum(p.card.maxFukushoCost, 0) > 0 && (p.firstTDefMult > 0 || p.firstGDefMult > 0)) {
                        var kMult3 = SharedDB.getKakuseiMultiplier(p.card);
                        masterList.push({
                            role: 'guard', card: p.card, isSameBaseAsTarget: !isHonkyoDef,
                            maxCost: SharedDB.safeNum(p.card.maxFukushoCost, 4.5),
                            baseCopyVal: p.firstTDefMult / kMult3,
                            baseCopyGenVal: p.firstGDefMult / kMult3,
                            priority: 1000000 + p.firstTDefMult * 10 + p.firstGDefMult
                        });
                    }
                });

                masterList.sort(function(a, b) { return b.priority - a.priority; });
                var refW = AppCards.slotWeathers[originSlotId] || 'SUN';

                masterList.forEach(function(master) {
                    var mCard = master.card;
                    adjutantAddedBuffMap[mCard.uniqueId] = 0;
                    adjutantAddedGenBuffMap[mCard.uniqueId] = 0;
                    usedAdjutantCostMap[mCard.uniqueId] = 0;
                    var existing = [];
                    if ((defAdjutantMode === 'CURRENT' || defAdjutantMode === 'FILL_EMPTY') && Array.isArray(mCard.fukusho)) {
                        mCard.fukusho.forEach(function(rawFk) {
                            var inf = SharedDB.getMirrorSkillInfo(rawFk);
                            var st = SharedDB.getAdjutantStatusEffect(rawFk, inf);
                            var fkCost = SharedDB.safeNum(rawFk.cost, 0);
                            usedAdjutantCostMap[mCard.uniqueId] += fkCost;
                            if (master.isSameBaseAsTarget) totalDefAdjStatusBonus += SharedDB.safeNum(st.defBonus, 0);

                            if (inf) {
                                var rate = SharedDB.calcAdjutantEffectiveCopyRate(mCard, rawFk, inf);
                                var fkId = String(rawFk.uniqueId || rawFk.id || rawFk.cardNo || '');
                                var fkNo = String(rawFk.cardNo || fkId);
                                if (fkId) usedMirrorIds.add(fkId);
                                if (fkNo) usedMirrorNos.add(fkNo);
                                existing.push(Object.assign({}, rawFk, {
                                    copyRate: rate,
                                    label: formatMirrorLabelWithCost(inf, rate)
                                }));
                                var addB = master.baseCopyVal * (rate / 100);
                                var addG = master.baseCopyGenVal * (rate / 100);
                                additionalAdjutantBuffT += addB;
                                additionalAdjutantBuffG += addG;
                                adjutantAddedBuffMap[mCard.uniqueId] += addB;
                                adjutantAddedGenBuffMap[mCard.uniqueId] += addG;
                            } else {
                                // 一般武将が既存副将として付いている場合もレアリティ倍率（SL80/L70/UR60/SR50/R40）を適用
                                var gCandEx = buildDefGeneralAdjutantCand(rawFk, master.role, targetTroopData, refW, master.isSameBaseAsTarget);
                                if (gCandEx) {
                                    var fkId2 = String(rawFk.uniqueId || rawFk.id || rawFk.cardNo || '');
                                    var fkNo2 = String(rawFk.cardNo || fkId2);
                                    if (fkId2) usedMirrorIds.add(fkId2);
                                    if (fkNo2) usedMirrorNos.add(fkNo2);
                                    existing.push(Object.assign({}, rawFk, { label: gCandEx.label }));
                                    additionalAdjutantBuffT += gCandEx.genTMult;
                                    additionalAdjutantBuffG += gCandEx.genGMult;
                                    adjutantAddedBuffMap[mCard.uniqueId] += gCandEx.genTMult;
                                    adjutantAddedGenBuffMap[mCard.uniqueId] += gCandEx.genGMult;
                                } else {
                                    existing.push(rawFk);
                                }
                            }
                        });
                    }
                    if (assignedAdjutantsMap) assignedAdjutantsMap[mCard.uniqueId] = existing;
                });

                if (defAdjutantMode !== 'CURRENT') {
                    var availableMirrors = allMirrorPool.filter(function(m) {
                        return !allDeckUsedIds.has(m.uniqueId) && !allDeckUsedNos.has(m.cardNo) && !usedTeisenCardIds.has(m.uniqueId);
                    });
                    var availableGeneralPool = allGeneralPool.filter(function(gc) {
                        return !allDeckUsedIds.has(gc.uniqueId) &&
                               !allDeckUsedNos.has(gc.cardNo || gc.uniqueId) &&
                               !usedTeisenCardIds.has(gc.uniqueId);
                    });

                    var troopWeight = (targetTroopData.defense * troopCount) / 100;

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
                                if (master.isSameBaseAsTarget) totalDefAdjStatusBonus += SharedDB.safeNum(tSt.defBonus, 0);

                                currentAssigned.push({
                                    name: tCard.name || '副将の帝仙鏡',
                                    cardNo: tCard.cardNo || '',
                                    imageSrc: tCard.imageSrc || (tCard.cardNo ? 'https://3gokushi.jp/img/card/card_' + tCard.cardNo + '.jpg' : ''),
                                    rarity: 'SL', cost: tCost,
                                    baseAttack: SharedDB.safeNum(tCard.baseAttack, 0),
                                    label: '帝仙鏡 100% [主将C1化]',
                                    copyRate: 100, uniqueId: tWrapper.uniqueId,
                                    info: { type: 'senkyo', rate: 100 }
                                });
                                var addBT = master.baseCopyVal * 1.0;
                                var addGT = master.baseCopyGenVal * 1.0;
                                additionalAdjutantBuffT += addBT;
                                additionalAdjutantBuffG += addGT;
                                adjutantAddedBuffMap[mCard.uniqueId] += addBT;
                                adjutantAddedGenBuffMap[mCard.uniqueId] += addGT;
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
                            var gCand = buildDefGeneralAdjutantCand(gc, master.role, targetTroopData, refW, master.isSameBaseAsTarget);
                            if (gCand) validGenCands.push(gCand);
                        }

                        var bestCombo = SharedDB.findBestAdjutantCombo(mCard, unusedForMaster, currentAssigned, usedAdjutantCostMap[mCard.uniqueId], {
                            baseCopyT: master.baseCopyVal,
                            baseCopyG: master.baseCopyGenVal,
                            wTroop: troopWeight,
                            wGen: 250,
                            wAtk: 0,
                            generalPool: validGenCands
                        });

                        bestCombo.forEach(function(chosenFk) {
                            usedMirrorIds.add(chosenFk.uniqueId);
                            usedMirrorNos.add(chosenFk.cardNo);
                            usedAdjutantCostMap[mCard.uniqueId] += chosenFk.cost;
                            currentAssigned.push(chosenFk);
                            if (chosenFk.isGeneralSkill && chosenFk.genStats) {
                                var gT = SharedDB.safeNum(chosenFk.genStats.defT, 0);
                                var gG = SharedDB.safeNum(chosenFk.genStats.defG, 0);
                                additionalAdjutantBuffT += gT;
                                additionalAdjutantBuffG += gG;
                                adjutantAddedBuffMap[mCard.uniqueId] += gT;
                                adjutantAddedGenBuffMap[mCard.uniqueId] += gG;
                            } else {
                                var addB = master.baseCopyVal * (chosenFk.copyRate / 100);
                                var addG = master.baseCopyGenVal * (chosenFk.copyRate / 100);
                                additionalAdjutantBuffT += addB;
                                additionalAdjutantBuffG += addG;
                                adjutantAddedBuffMap[mCard.uniqueId] += addB;
                                adjutantAddedGenBuffMap[mCard.uniqueId] += addG;
                            }
                        });
                    });
                }

                totalTroopDefMult += additionalAdjutantBuffT;
                totalGenDefMult += additionalAdjutantBuffG;

                // 防衛拠点に駐屯している武将自身の素防御力集計
                var defendingCards = [];
                Object.keys(bestLocalSetup.activeSlots).forEach(function(sId) {
                    var isTargetSlot = isHonkyoDef ? (sId.indexOf('h') === 0) : (sId.indexOf('k') === 0);
                    if (isTargetSlot) defendingCards.push(bestLocalSetup.activeSlots[sId].card);
                });
                if (isHonkyoDef) {
                    bestLocalSetup.basePassives.forEach(function(p) { defendingCards.push(p.card); });
                    hGuardPicked.forEach(function(g) { defendingCards.push(g.card); });
                } else {
                    bestLocalSetup.subPassives.forEach(function(p) { defendingCards.push(p.card); });
                    kGuardPicked.forEach(function(g) { defendingCards.push(g.card); });
                }
                var totalGenBaseDef = defendingCards.reduce(function(sum, c) {
                    return sum + SharedDB.safeNum(c.baseDefense !== undefined ? c.baseDefense : c.baseAttack, 500);
                }, 0) + totalDefAdjStatusBonus;

                var elGoBuff = document.getElementById('optDefGoBuff');
                var currentGo = isDefGoEnabled ? SharedDB.safeNum(elGoBuff && elGoBuff.value, defGoBuffValue) : 0;
                var finalTroopDefMult = totalTroopDefMult + currentGo;
                var finalGenDefMult = totalGenDefMult + currentGo;

                var troopDefense = Math.floor(targetTroopData.defense * troopCount * (1 + (finalTroopDefMult / 100)));
                var genDefense = Math.floor(totalGenBaseDef * (1 + (finalGenDefMult / 100)));
                var baseTotalDefense = troopDefense + genDefense;
                var altMultiplier = isDefHighland ? 1.2 : 1.0;
                var buff10Multiplier = isDefBuff10 ? 1.1 : 1.0;
                var finalTotalDefense = Math.floor(baseTotalDefense * altMultiplier * buff10Multiplier);

                return {
                    finalTotalDefense: finalTotalDefense,
                    baseTotalDefense: baseTotalDefense,
                    troopDefense: troopDefense,
                    genDefense: genDefense,
                    totalGenBaseDef: totalGenBaseDef,
                    pureTroopDefMult: totalTroopDefMult,
                    pureGenDefMult: totalGenDefMult,
                    finalTroopDefMult: finalTroopDefMult,
                    finalGenDefMult: finalGenDefMult,
                    goBuff: currentGo,
                    defOrigin: defOrigin,
                    targetTroopData: targetTroopData,
                    troopCount: troopCount,
                    honkyoLimit: honkyoLimit,
                    kyotenLimit: kyotenLimit,
                    honkyoCost: bestLocalSetup.hCost,
                    kyotenCost: bestLocalSetup.kCost,
                    honkyoGuardCost: hGuardPicked.reduce(function(sum, x) { return sum + x.effectiveCost; }, 0),
                    kyotenGuardCost: kGuardPicked.reduce(function(sum, x) { return sum + x.effectiveCost; }, 0),
                    chosenActiveSlots: bestLocalSetup.activeSlots,
                    chosenBasePassives: bestLocalSetup.basePassives,
                    chosenSubPassives: bestLocalSetup.subPassives,
                    chosenBaseGuards: hGuardPicked,
                    chosenSubGuards: kGuardPicked,
                    assignedAdjutantsMap: assignedAdjutantsMap,
                    adjutantAddedBuffMap: adjutantAddedBuffMap,
                    adjutantAddedGenBuffMap: adjutantAddedGenBuffMap,
                    effectiveCostMap: effectiveCostMap,
                    activeCountBase: bestLocalSetup.activeCountBase,
                    activeCountSub: bestLocalSetup.activeCountSub,
                    altMultiplier: altMultiplier,
                    buff10Multiplier: buff10Multiplier
                };
            }

            // Pass 1 実行
            var bestSetup = evaluateFullDefPlan(null);

            // Pass 2 実行（Pass 1 の実測副将防御バフ実績を反映して再DP）
            if (isReassignMode && bestSetup && bestSetup.adjutantAddedBuffMap) {
                var plan2 = evaluateFullDefPlan(bestSetup.adjutantAddedBuffMap);
                if (plan2 && plan2.finalTotalDefense > bestSetup.finalTotalDefense) {
                    bestSetup = plan2;
                }
            }

            var area = document.getElementById('defDeckResultArea');
            if (!area) return;
            if (!bestSetup || bestSetup.finalTotalDefense <= 0) {
                area.innerHTML = '<div class="text-gray-500 text-sm border-2 border-dashed border-gray-700 p-8 text-center rounded-xl">防衛可能なスキルを持つ武将が見つかりませんでした。</div>';
                currentDefOptimizedSetup = null;
                return;
            }

            if (shouldAutoWeather) {
                Object.keys(bestSetup.chosenActiveSlots).forEach(function(sId) {
                    if (bestSetup.chosenActiveSlots[sId].weather) AppCards.slotWeathers[sId] = bestSetup.chosenActiveSlots[sId].weather;
                });
            }
            currentDefOptimizedSetup = bestSetup;
            render(bestSetup);
            AppCards.setStatusLog("防御最適化完了: 最大防御力 " + bestSetup.finalTotalDefense.toLocaleString());
        } catch (err) {
            console.error("DefEngine.run Error:", err);
            AppCards.setStatusLog("防御計算エラー: " + err.message, true);
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
        var area = document.getElementById('defDeckResultArea');
        if (!area || !setup) return;
        var isHonkyoDef = (setup.defOrigin === 'HONKYO');
        var originName = isHonkyoDef ? '本拠・塔' : '拠点＋';
        var originColor = isHonkyoDef ? 'text-amber-400' : 'text-blue-400';

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
                var typeChar = item.isBaseManualDef ? '(拠点防)' : '(内政)';
                var borderCol = item.isBaseManualDef ? 'border-cyan-400' : 'border-blue-500';
                var badgeCol = item.isBaseManualDef ? 'border-cyan-400 text-cyan-300' : 'border-blue-500 text-blue-400';
                var adjList = setup.assignedAdjutantsMap ? setup.assignedAdjutantsMap[item.card.uniqueId] : null;
                var adjAddedB = (setup.adjutantAddedBuffMap && setup.adjutantAddedBuffMap[item.card.uniqueId]) || 0;
                var totalSlotBuff = item.tDefMult + adjAddedB;
                cardContent = `
                    <div class="relative border ${borderCol} rounded-lg p-1.5 opacity-90 hover:opacity-100 hover:z-40 transition w-full mt-1">
                        ${SharedUI.getCardVisualHTML(getDisplayCard(item.card, setup), adjList)}
                        <div class="absolute -top-2 -right-2 bg-black border ${badgeCol} text-[8px] px-1 rounded-full shadow-md z-10 font-mono text-center leading-tight pointer-events-none">
                            防+${SharedDB.formatBuffNum(totalSlotBuff)}% ${typeChar}
                        </div>
                    </div>
                `;
            } else {
                cardContent = `
                    <div class="w-full aspect-[3/4] border-2 border-dashed border-gray-800 rounded-lg flex flex-col items-center justify-center text-gray-600 text-xs mt-1">
                        <i class="fa-solid fa-user-slash mb-1 text-base"></i><span>未配置</span>
                    </div>
                `;
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
                var displayVal = SharedDB.formatBuffNum(s.tDefMult + adjAddedB);
                return `
                <div class="relative border ${isGuard ? 'border-purple-500' : 'border-cyan-500/70'} rounded-lg p-1.5 opacity-90 hover:opacity-100 hover:z-40 transition">
                    ${SharedUI.getCardVisualHTML(getDisplayCard(s.card, setup), adjList)}
                    <div class="absolute -top-2 -right-2 bg-black border ${isGuard ? 'border-purple-500 text-purple-400' : 'border-cyan-400 text-cyan-300'} text-[8px] px-1 rounded-full shadow-md z-10 font-mono text-center leading-tight pointer-events-none">
                        防+${displayVal}% ${isGuard ? '(警護)' : '(自動)'}
                    </div>
                    ${s.isBound ? `<div class="absolute -top-2 left-0 bg-red-600 border border-red-400 text-white text-[8px] px-1 rounded-full shadow-md z-30 font-bold pointer-events-none">拠点縛り</div>` : ''}
                </div>
            `;}).join('');
        };

        var extraBadges = '';
        var multFormula = '';
        if (isDefHighland && isDefBuff10) {
            extraBadges += '<span class="bg-amber-500 text-black text-[10px] font-bold px-2 py-0.5 rounded shadow">高地 ×1.2</span><span class="bg-red-600 text-white text-[10px] font-bold px-2 py-0.5 rounded shadow">課金 ×1.1</span>';
            multFormula = ' × 1.32 <span class="text-amber-400 font-bold">(高地1.2 × 課金1.1)</span>';
        } else if (isDefHighland) {
            extraBadges += '<span class="bg-amber-500 text-black text-[10px] font-bold px-2 py-0.5 rounded shadow">高地 ×1.2</span>';
            multFormula = ' × 1.2 <span class="text-amber-400 font-bold">(高地)</span>';
        } else if (isDefBuff10) {
            extraBadges += '<span class="bg-red-600 text-white text-[10px] font-bold px-2 py-0.5 rounded shadow">課金 ×1.1</span>';
            multFormula = ' × 1.1 <span class="text-red-400 font-bold">(課金10%UP)</span>';
        }
        if (setup.goBuff > 0) extraBadges += '<span class="bg-cyan-700 text-white text-[10px] font-bold px-2 py-0.5 rounded shadow">号令 +' + setup.goBuff + '%</span>';

        area.className = "space-y-6 animate-flash";
        area.innerHTML = `
            <div class="bg-sangoku-dark border border-sangoku-cardBorder p-5 rounded-xl shadow-lg mb-6">
                <div class="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 border-b border-gray-800 pb-4 gap-4">
                    <div>
                        <div class="flex flex-wrap items-center gap-1.5 mb-2">
                            <span class="bg-cyan-600 text-white text-[10px] font-bold px-2 py-0.5 rounded shadow">防御計算結果 (Ver. 2.05f)</span>
                            ${extraBadges}
                            <h3 class="text-lg font-bold text-white ml-1">【防衛拠点: <span class="${originColor}">${originName}</span>】</h3>
                        </div>
                        <div class="text-xs text-gray-300 font-mono space-y-1.5 bg-black/40 p-2.5 rounded-lg border border-gray-800">
                            <div class="flex items-center space-x-2">
                                <span class="text-gray-400">防衛兵種:</span>
                                <span class="text-cyan-300 font-bold text-sm">${setup.targetTroopData.name}</span>
                                <span class="text-gray-500 text-[10px]">(1兵素防: ${setup.targetTroopData.defense})</span>
                                <span class="text-gray-400 ml-2">兵数:</span>
                                <span class="text-white font-bold">${setup.troopCount.toLocaleString()}</span>
                            </div>
                            <div class="flex items-center space-x-4">
                                <div>総兵士防御バフ: <span class="text-cyan-400 font-bold">+${SharedDB.formatBuffNum(setup.finalTroopDefMult)}%</span></div>
                                <div>総武将防御バフ: <span class="text-blue-400 font-bold">+${SharedDB.formatBuffNum(setup.finalGenDefMult)}%</span></div>
                            </div>
                        </div>
                    </div>
                    <div class="text-right bg-black/60 p-4 rounded-xl border border-gray-700 w-full md:w-auto shadow-inner">
                        <div class="text-xs text-gray-400 mb-1 text-center md:text-right">部隊 最終総合防御力</div>
                        <div class="text-3xl font-bold text-cyan-400 font-mono drop-shadow-md text-center md:text-right">${setup.finalTotalDefense.toLocaleString()}</div>
                        <div class="text-[10px] text-gray-400 mt-2 text-center md:text-right leading-relaxed bg-black/40 p-2 rounded border border-gray-800">
                            ＝ [ 兵防(${setup.troopDefense.toLocaleString()}) + 将防(${setup.genDefense.toLocaleString()}) ]${multFormula}
                        </div>
                    </div>
                </div>

                <div class="mb-6 border border-gray-700 rounded-lg p-4 bg-gray-900/50">
                    <div class="text-md font-bold text-white mb-2 flex justify-between border-b border-gray-700 pb-2">
                        <span><i class="fa-solid fa-chess-rook text-amber-500 mr-2"></i>本拠 に配置する防衛・サポート</span>
                        <span class="text-xs font-mono ${setup.honkyoCost > setup.honkyoLimit ? 'text-red-400' : 'text-gray-300'} font-bold">表コスト: ${setup.honkyoCost.toFixed(1)} / ${setup.honkyoLimit.toFixed(1)}</span>
                    </div>
                    <div class="text-xs text-blue-400 mb-2"><i class="fa-solid fa-hand-pointer mr-1"></i>内政セット枠 (手動・「防:」内政官のみ: ${setup.activeCountBase}枚)</div>
                    <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 mb-4">${renderActiveSlotHTML('h0', '1. 本拠')}${renderActiveSlotHTML('h1', '2. 塔')}</div>
                    <div class="text-xs text-gray-400 mb-1"><i class="fa-solid fa-bolt mr-1"></i>出撃・防衛デッキ枠 (パッシブのみ有効: ${setup.chosenBasePassives.length}枚)</div>
                    <div class="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-3 mb-4">${renderCardListHTML(setup.chosenBasePassives, false)}</div>
                    <div class="mt-4 border-t border-gray-700 pt-2 flex justify-between text-xs text-purple-400 mb-1">
                        <span><i class="fa-solid fa-shield-halved mr-1"></i>裏・警護デッキ (パッシブのみ有効: ${setup.chosenBaseGuards.length}枚)</span>
                        <span class="font-mono text-gray-400 font-bold">裏コスト: ${setup.honkyoGuardCost.toFixed(1)} / ${setup.honkyoLimit.toFixed(1)}</span>
                    </div>
                    <div class="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-3">${renderCardListHTML(setup.chosenBaseGuards, true)}</div>
                </div>

                <div class="border border-gray-700 rounded-lg p-4 bg-gray-900/50">
                    <div class="text-md font-bold text-white mb-2 flex justify-between border-b border-gray-700 pb-2">
                        <span><i class="fa-solid fa-tents text-blue-400 mr-2"></i>拠点＋ に配置する防衛・サポート</span>
                        <span class="text-xs font-mono ${setup.kyotenCost > setup.kyotenLimit ? 'text-red-400' : 'text-gray-300'} font-bold">表コスト: ${setup.kyotenCost.toFixed(1)} / ${setup.kyotenLimit.toFixed(1)}</span>
                    </div>
                    <div class="text-xs text-blue-400 mb-2"><i class="fa-solid fa-hand-pointer mr-1"></i>内政セット枠 (手動・「防:」内政官のみ: ${setup.activeCountSub}枚)</div>
                    <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mb-4">
                        ${renderActiveSlotHTML('k0', '3. 拠点1')}${renderActiveSlotHTML('k1', '4. 拠点2')}${renderActiveSlotHTML('k2', '5. 拠点3')}
                        ${renderActiveSlotHTML('k3', '6. 拠点4')}${renderActiveSlotHTML('k4', '7. 拠点5')}${renderActiveSlotHTML('k5', '8. 拠点6')}
                        ${renderActiveSlotHTML('k6', '9. 拠点7')}${renderActiveSlotHTML('k7', '10. 拠点8')}${renderActiveSlotHTML('k8', '11. 拠点9')}
                    </div>
                    <div class="text-xs text-gray-400 mb-1"><i class="fa-solid fa-bolt mr-1"></i>出撃・防衛デッキ枠 (パッシブのみ有効: ${setup.chosenSubPassives.length}枚)</div>
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
        changeAdjutantMode: function(val) { defAdjutantMode = val; run(true); },
        setAltitude: function(val) {
            isDefHighland = val;
            var btnNorm = document.getElementById('btnDefAltNormal');
            var btnHigh = document.getElementById('btnDefAltHigh');
            var lbl = document.getElementById('labelDefAltStatus');
            if (val) {
                if (btnNorm) btnNorm.className = "py-1 text-xs font-bold rounded-lg transition text-gray-400 hover:text-white cursor-pointer";
                if (btnHigh) btnHigh.className = "py-1 text-xs font-bold rounded-lg transition bg-amber-600 text-black shadow cursor-pointer";
                if (lbl) lbl.innerHTML = '<span class="text-amber-400 font-bold">高地 (×1.2)</span>';
            } else {
                if (btnNorm) btnNorm.className = "py-1 text-xs font-bold rounded-lg transition bg-gray-700 text-white shadow cursor-pointer";
                if (btnHigh) btnHigh.className = "py-1 text-xs font-bold rounded-lg transition text-gray-400 hover:text-white cursor-pointer";
                if (lbl) lbl.textContent = "等倍 (×1.0)";
            }
            fastUpdateDefMultiplier();
        },
        setBuff10: function(val) {
            isDefBuff10 = val;
            var btnOff = document.getElementById('btnDefBuff10Off');
            var btnOn = document.getElementById('btnDefBuff10On');
            var lbl = document.getElementById('labelDefBuff10Status');
            if (val) {
                if (btnOff) btnOff.className = "py-1 text-xs font-bold rounded-lg transition text-gray-400 hover:text-white cursor-pointer";
                if (btnOn) btnOn.className = "py-1 text-xs font-bold rounded-lg transition bg-red-600 text-white shadow cursor-pointer";
                if (lbl) lbl.innerHTML = '<span class="text-red-400 font-bold">ON (×1.1)</span>';
            } else {
                if (btnOff) btnOff.className = "py-1 text-xs font-bold rounded-lg transition bg-gray-700 text-white shadow cursor-pointer";
                if (btnOn) btnOn.className = "py-1 text-xs font-bold rounded-lg transition text-gray-400 hover:text-white cursor-pointer";
                if (lbl) lbl.textContent = "OFF (×1.0)";
            }
            fastUpdateDefMultiplier();
        },
        setGoEnabled: function(val) {
            isDefGoEnabled = val;
            var btnOff = document.getElementById('btnDefGoOff');
            var btnOn = document.getElementById('btnDefGoOn');
            var lbl = document.getElementById('labelDefGoStatus');
            var input = document.getElementById('optDefGoBuff');
            var currentVal = SharedDB.safeNum(input && input.value, defGoBuffValue);
            if (val) {
                if (btnOff) btnOff.className = "py-1 text-xs font-bold rounded-lg transition text-gray-400 hover:text-white cursor-pointer";
                if (btnOn) btnOn.className = "py-1 text-xs font-bold rounded-lg transition bg-cyan-600 text-white shadow cursor-pointer";
                if (lbl) lbl.innerHTML = '<span class="text-cyan-400 font-bold">ON (+' + currentVal + '%)</span>';
            } else {
                if (btnOff) btnOff.className = "py-1 text-xs font-bold rounded-lg transition bg-gray-700 text-white shadow cursor-pointer";
                if (btnOn) btnOn.className = "py-1 text-xs font-bold rounded-lg transition text-gray-400 hover:text-white cursor-pointer";
                if (lbl) lbl.textContent = "OFF (0%)";
            }
            fastUpdateDefMultiplier();
        },
        updateGoBuff: function(val) {
            defGoBuffValue = SharedDB.safeNum(val, 5500);
            if (isDefGoEnabled) {
                var lbl = document.getElementById('labelDefGoStatus');
                if (lbl) lbl.innerHTML = '<span class="text-cyan-400 font-bold">ON (+' + defGoBuffValue + '%)</span>';
            }
            fastUpdateDefMultiplier();
        }
    };
})();