// @version 1.0
// ========================================================
// 【エンジン 2】引率火力 計算・最適化ロジック（単騎専用サポート除外・一般武将アクティブ1つ制限・覇全アクティブ同時・デュエル除外版）
// ========================================================
window.LeadEngine = (function() {
    var isLeadHighland = false;
    var isLeadAttackBuff10 = false;
    var isLeadGoEnabled = true;
    var leadGoBuffValue = 5500;
    var leadAdjutantMode = 'REASSIGN_ALL';
    var currentLeadOptimizedSetup = null;

    var skillParseCache = Object.create(null);
    var RE_GLOBAL_AURA = /(?:全拠点|全ての拠点|すべての拠点|自拠点.*?(?:出兵|出撃))/;
    var RE_FORCE_LIMIT = /(魏|呉|蜀|他)勢力が率いた部隊/;
    var RE_SUN_MULT = /晴天候時(?:は|の時)?[^0-9]*?([0-9\.]+)倍/;
    var RE_BAD_MULT = /(?:荒天時|曇[、・\s]*雨[、・\s]*雪天候時)(?:は|の時)?[^0-9]*?([0-9\.]+)倍/;
    var RE_MATCH_ALL = /(?:全兵士|全ての兵士|全軍|全兵科|全拠点|全兵|[^\s、，]+兵)[、，・,\/\s]+(?:[^\s、，]+科)?武将.*?攻撃(?:力)?[がをのは]?([0-9\.]+)[%％]/;
    var RE_TROOP_ATK = /(?<!武将の)攻撃(?:力)?[がをのは]?([0-9\.]+)[%％]/;
    var RE_ZEN_ATK = /(?:全拠点|自拠点).*?(?:全兵士|全ての兵士|全軍|全兵).*?(?<!武将の)攻撃(?:力)?[がをのは]?([0-9\.]+)[%％]/;
    var RE_GEN_ATK = /(?:武将の戦闘時|武将).*?攻撃(?:力)?[がをのは]?([0-9\.]+)[%％]/;

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

    function parseLeadSkill(skill, targetTroopData, weatherObj, mode, leadCard) {
        var empty = { tMult: 0, gMult: 0, isPassive: false, isGuardDeck: false, mustBeSameBase: false, isSupport: false, isLead: false, isShurei: false };
        if (!skill || typeof skill !== 'object') return empty;
        var name = String(skill.name || "").trim();
        var rawDesc = String(skill.description || "").trim();

        if (name.indexOf("覚:") === 0 || name.indexOf("副覚:") === 0 || name.indexOf("覚醒") !== -1) return empty;
        if (isDuelSkill(skill)) return empty;

        var leadCountry = leadCard ? (leadCard.country || '') : '';
        var isLeadHa = leadCard ? (SharedDB.isHaBusho(leadCard) || leadCountry === '覇') : false;

        var cacheKey = name + '\x01' + rawDesc + '\x01' + targetTroopData.name + '\x01' + weatherObj + '\x01' + mode + '\x01' + leadCountry + '\x01' + (isLeadHa ? '1' : '0');
        var cached = skillParseCache[cacheKey];
        if (cached) return cached;

        var normRawDesc = rawDesc.replace(/(\d),(\d{3})/g, '$1$2');
        var desc = (normRawDesc + " " + name).trim();
        var result = Object.assign({}, empty);
        if (!desc && !name) {
            skillParseCache[cacheKey] = result;
            return result;
        }

        if (desc.indexOf("自動で発動") !== -1 || desc.indexOf("自動発動") !== -1 || desc.indexOf("全滅時も発動") !== -1 || desc.indexOf("パッシブ") !== -1) {
            result.isPassive = true;
        }
        if (desc.indexOf("警護デッキ") !== -1) {
            result.isGuardDeck = true;
        }

        var isGlobalAura = RE_GLOBAL_AURA.test(desc);
        if (!isGlobalAura || desc.indexOf("セットした拠点") !== -1 || desc.indexOf("この武将をセットした拠点") !== -1) {
            result.mustBeSameBase = true;
        }

        var isVarOrAwake = (name.indexOf("変:") === 0 || name.indexOf("覚:") === 0 || name.indexOf("副変:") === 0 || name.indexOf("副覚:") === 0);
        if (name.indexOf("攻:") === 0 || name.indexOf("副攻:") === 0 || name.indexOf("攻防:") === 0) {
            result.isLead = true;
        }
        if (name.indexOf("防:") === 0 || name.indexOf("副防:") === 0 || name.indexOf("副変:") === 0) {
            result.isSupport = true;
        }
        if (result.isPassive && !result.isLead && !isVarOrAwake) {
            result.isSupport = true;
        }
        if (isVarOrAwake) {
            result.isLead = true;
            result.isSupport = true;
        }
        if (result.isSupport && !result.isPassive && result.mustBeSameBase && (desc.indexOf("スキル使用中") !== -1 || desc.indexOf("出兵") !== -1 || desc.indexOf("戦闘時") !== -1)) {
            result.isShurei = true;
        }

        if (mode === 'lead' && !result.isLead) {
            skillParseCache[cacheKey] = result;
            return result;
        }
        if (mode === 'support' && !result.isSupport) {
            skillParseCache[cacheKey] = result;
            return result;
        }

        var forceMatch = desc.match(RE_FORCE_LIMIT);
        if (forceMatch) {
            var reqCountry = forceMatch[1];
            if (!leadCard || (!isLeadHa && leadCountry !== reqCountry)) {
                skillParseCache[cacheKey] = result;
                return result;
            }
        }

        var words = ["全兵士", "全ての兵士", "全軍", "全兵科", "全拠点", "全兵"];
        if (targetTroopData.type === "天兵") {
            words.push("天兵", "天兵科", targetTroopData.name, targetTroopData.base, targetTroopData.sub);
        } else if (targetTroopData.type === "鋭兵") {
            words.push("鋭兵", "鋭兵科", targetTroopData.name, targetTroopData.base, targetTroopData.sub);
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

        var weatherMult = 1.0;
        var mSun = desc.match(RE_SUN_MULT);
        if (mSun && weatherObj === 'SUN') weatherMult = Math.max(weatherMult, parseFloat(mSun[1]));
        var mBad = desc.match(RE_BAD_MULT);
        if (mBad && (weatherObj === 'CLOUD' || weatherObj === 'RAIN' || weatherObj === 'SNOW')) {
            weatherMult = Math.max(weatherMult, parseFloat(mBad[1]));
        }

        var tMult = 0, gMult = 0;
        var matchAll = normRawDesc.match(RE_MATCH_ALL);
        if (matchAll && isTroopCompatible) {
            var matchedStr = matchAll[0];
            var hitWord = false;
            for (var wi1 = 0; wi1 < words.length; wi1++) {
                if (matchedStr.indexOf(words[wi1]) !== -1) { hitWord = true; break; }
            }
            if (hitWord) {
                tMult = parseFloat(matchAll[1]);
                gMult = tMult;
            }
        } else {
            if (isTroopCompatible) {
                for (var wi = 0; wi < words.length; wi++) {
                    var pos = normRawDesc.indexOf(words[wi]);
                    if (pos !== -1) {
                        var m = normRawDesc.slice(pos).match(RE_TROOP_ATK);
                        if (m) {
                            tMult = parseFloat(m[1]);
                            break;
                        }
                    }
                }
                if (tMult === 0) {
                    var m_zen = normRawDesc.match(RE_ZEN_ATK);
                    if (m_zen) tMult = parseFloat(m_zen[1]);
                }
            }
            var gMatch = normRawDesc.match(RE_GEN_ATK);
            if (gMatch) gMult = parseFloat(gMatch[1]);
            else if (tMult > 0 && normRawDesc.indexOf("全軍") !== -1) gMult = tMult;
            else if (result.isLead && tMult === 0 && gMult === 0) {
                var mSingle = normRawDesc.match(/攻撃(?:力)?[がをのは]?([0-9\.]+)[%％]/);
                if (mSingle) gMult = parseFloat(mSingle[1]);
            }
        }

        result.tMult = tMult * weatherMult;
        result.gMult = gMult * weatherMult;
        skillParseCache[cacheKey] = result;
        return result;
    }

    function evaluateCardLead(card, targetTroopData, weatherObj, mode, leadCard, excludeSubSkills) {
        var empty = { tMult: 0, gMult: 0, firstTMult: 0, firstGMult: 0, isPassive: false, isGuard: false, isActive: false, mustBeSameBase: false, isShurei: false };
        if (!card.skills || !Array.isArray(card.skills) || card.skills.length === 0) return empty;

        var firstSkill = card.skills[0];
        var baseParsed = parseLeadSkill(firstSkill, targetTroopData, weatherObj, mode, leadCard);
        if (mode === 'lead' && !baseParsed.isLead) return empty;
        if (mode === 'support' && !baseParsed.isSupport) return empty;

        var passiveTMult = 0, passiveGMult = 0;
        var activeCandidates = [];
        var hasPassiveContrib = false;
        var isGuardCard = false, mustBeSameBaseCard = false, isShureiCard = false;
        var isHa = SharedDB.isHaBusho(card);

        for (var idx = 0; idx < card.skills.length; idx++) {
            var skill = card.skills[idx];
            if (!skill || typeof skill !== 'object') continue;
            var name = String(skill.name || '').trim();

            if (name.indexOf("覚:") === 0 || name.indexOf("副覚:") === 0 || name.indexOf("覚醒") !== -1) continue;
            if (isDuelSkill(skill)) continue;

            var isFromAdj = (name.indexOf("副:") === 0 || name.indexOf("副変:") === 0 || name.indexOf("副攻:") === 0 || name.indexOf("副防:") === 0 || name.indexOf("副ﾃﾞｭｴﾙ:") === 0);
            if (excludeSubSkills && !isHa && isFromAdj) continue;

            var parsed = parseLeadSkill(skill, targetTroopData, weatherObj, mode, leadCard);

            var isSelfMirror = (idx > 0) && !isFromAdj && (
                name.indexOf("変:") === 0 ||
                name.indexOf("主将の") !== -1 ||
                name.indexOf("明鑑") !== -1 ||
                name.indexOf("王春の") !== -1 ||
                (name.indexOf("明鏡") !== -1 && name.indexOf("副将の") === -1) ||
                (isHa && name.indexOf("副変:") === 0)
            );

            if (isSelfMirror) {
                if (parsed.tMult <= 0 && parsed.gMult <= 0 && (baseParsed.tMult > 0 || baseParsed.gMult > 0)) {
                    var rate = SharedDB.getMasterMirrorCopyRate(skill);
                    passiveTMult += baseParsed.tMult * rate;
                    passiveGMult += baseParsed.gMult * rate;
                } else {
                    passiveTMult += parsed.tMult;
                    passiveGMult += parsed.gMult;
                }
                if (baseParsed.mustBeSameBase || parsed.mustBeSameBase) mustBeSameBaseCard = true;
                if (baseParsed.isShurei || parsed.isShurei) isShureiCard = true;
                hasPassiveContrib = true;
                continue;
            }

            if (parsed.tMult > 0 || parsed.gMult > 0) {
                if (parsed.isGuardDeck) isGuardCard = true;
                if (parsed.isPassive || isFromAdj) {
                    passiveTMult += parsed.tMult;
                    passiveGMult += parsed.gMult;
                    if (parsed.mustBeSameBase) mustBeSameBaseCard = true;
                    hasPassiveContrib = true;
                } else {
                    activeCandidates.push(parsed);
                }
            }
        }

        var activeTMult = 0, activeGMult = 0;
        var hasActiveContrib = false;

        if (activeCandidates.length > 0) {
            if (mode === 'support') hasActiveContrib = true;
            if (isHa) {
                for (var ai = 0; ai < activeCandidates.length; ai++) {
                    activeTMult += activeCandidates[ai].tMult;
                    activeGMult += activeCandidates[ai].gMult;
                    if (activeCandidates[ai].mustBeSameBase) mustBeSameBaseCard = true;
                    if (activeCandidates[ai].isShurei) isShureiCard = true;
                }
            } else {
                activeCandidates.sort(function(a, b) {
                    if (Math.abs(b.tMult - a.tMult) > 1e-6) return b.tMult - a.tMult;
                    return b.gMult - a.gMult;
                });
                activeTMult = activeCandidates[0].tMult;
                activeGMult = activeCandidates[0].gMult;
                if (activeCandidates[0].mustBeSameBase) mustBeSameBaseCard = true;
                if (activeCandidates[0].isShurei) isShureiCard = true;
            }
        }

        var tMultTotal = passiveTMult + activeTMult;
        var gMultTotal = passiveGMult + activeGMult;

        // 引率サポートモードでは、兵士攻撃力上昇(tMult > 0)を持たない単騎専用スキル（武将攻撃力のみ上昇）は除外
        if (mode === 'support' && tMultTotal <= 0) return empty;
        if (tMultTotal <= 0 && gMultTotal <= 0) return empty;

        return {
            tMult: tMultTotal,
            gMult: gMultTotal,
            firstTMult: baseParsed.tMult,
            firstGMult: baseParsed.gMult,
            isPassive: !hasActiveContrib && hasPassiveContrib,
            isGuard: isGuardCard,
            isActive: hasActiveContrib,
            mustBeSameBase: mustBeSameBaseCard,
            isShurei: isShureiCard
        };
    }

    function getBestWeatherForCardForLead(card, targetTroopData, mode, leadCard, excludeSubSkills) {
        var weathers = ['SUN', 'CLOUD', 'RAIN', 'SNOW'];
        var bestW = 'SUN';
        var maxEval = { tMult: 0, gMult: 0, firstTMult: 0, firstGMult: 0, isActive: false, isPassive: false, isGuard: false, mustBeSameBase: false, isShurei: false };
        for (var i = 0; i < weathers.length; i++) {
            var w = weathers[i];
            var ev = evaluateCardLead(card, targetTroopData, w, mode, leadCard, excludeSubSkills);
            if (ev.tMult > maxEval.tMult || (ev.tMult === maxEval.tMult && ev.gMult > maxEval.gMult)) {
                maxEval = ev;
                bestW = w;
            }
        }
        return { bestWeather: bestW, eval: maxEval };
    }

    function fastUpdateLeadMultiplier() {
        if (!currentLeadOptimizedSetup) { run(false); return; }
        var altMultiplier = isLeadHighland ? 1.2 : 1.0;
        var buff10Multiplier = isLeadAttackBuff10 ? 1.1 : 1.0;
        var elGo = document.getElementById('optLeadGoBuff');
        var goBuff = isLeadGoEnabled ? SharedDB.safeNum(elGo && elGo.value, leadGoBuffValue) : 0;

        currentLeadOptimizedSetup.altMultiplier = altMultiplier;
        currentLeadOptimizedSetup.buff10Multiplier = buff10Multiplier;
        currentLeadOptimizedSetup.goBuff = goBuff;

        var finalTroopMult = currentLeadOptimizedSetup.pureTroopMult + goBuff;
        var finalGenMult = currentLeadOptimizedSetup.pureGenMult + goBuff;
        var effectiveGenAtk = currentLeadOptimizedSetup.lead.baseAttack + SharedDB.safeNum(currentLeadOptimizedSetup.leadAdjutantAtkBonus, 0);
        var troopDamage = Math.floor(currentLeadOptimizedSetup.targetTroopData.attack * currentLeadOptimizedSetup.troopCount * (1 + (finalTroopMult / 100)));
        var genDamage = Math.floor(effectiveGenAtk * (1 + (finalGenMult / 100)));
        var baseTotalDamage = troopDamage + genDamage;

        currentLeadOptimizedSetup.troopDamage = troopDamage;
        currentLeadOptimizedSetup.genDamage = genDamage;
        currentLeadOptimizedSetup.finalTroopMult = finalTroopMult;
        currentLeadOptimizedSetup.finalGenMult = finalGenMult;
        currentLeadOptimizedSetup.baseTotalDamage = baseTotalDamage;
        currentLeadOptimizedSetup.finalTotalDamage = Math.floor(baseTotalDamage * altMultiplier * buff10Multiplier);
        render(currentLeadOptimizedSetup);
    }

    function firstNameIsAttack(sName) {
        return sName.indexOf("攻:") === 0 || sName.indexOf("攻防:") === 0;
    }

    function run(shouldAutoWeather) {
        try {
            var uCards = AppCards.userCards;
            if (!uCards || uCards.length === 0) return;
            AppCards.setStatusLog("引率最適化計算中... (" + uCards.length + "枚)");

            var elTroop = document.getElementById('leadTroop');
            var elTroopCount = document.getElementById('leadTroopCount');
            var elCost = document.getElementById('leadCostDist');
            var elAttackOrigin = document.getElementById('leadAttackOrigin');
            if (!elTroop || !elTroopCount || !elCost || !elAttackOrigin) return;

            var targetTroopData = SharedDB.TROOP_DATA[elTroop.value];
            var troopCount = parseInt(elTroopCount.value) || 0;
            var costDist = elCost.value;
            var honkyoLimit = costDist === '30-25' ? 30.0 : 25.0;
            var kyotenLimit = costDist === '30-25' ? 25.0 : 30.0;
            var attackOrigin = elAttackOrigin.value;
            var isHonkyoAttack = (attackOrigin === 'HONKYO');
            var originSlotId = isHonkyoAttack ? 'h0' : 'k0';
            var originLimit = isHonkyoAttack ? honkyoLimit : kyotenLimit;

            var isReassignMode = (leadAdjutantMode !== 'CURRENT');
            var validCards = uCards.filter(function(c) { return !c.isAdjutant && !AppCards.excludedCardIds.has(c.uniqueId); });

            var allMirrorPool = [];
            var seenMirrorKeys = new Set();
            uCards.forEach(function(c) {
                if (AppCards.excludedCardIds.has(c.uniqueId)) return;
                var inf = SharedDB.getMirrorSkillInfo(c);
                if (inf) {
                    var cid = String(c.uniqueId || c.cardNo || allMirrorPool.length);
                    if (!seenMirrorKeys.has(cid)) {
                        seenMirrorKeys.add(cid);
                        allMirrorPool.push({ card: c, info: inf, uniqueId: cid, cardNo: c.cardNo || cid });
                    }
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
                                    uniqueId: fkid,
                                    cardNo: fk.cardNo || fkid,
                                    name: fk.name || '副将',
                                    rarity: inf2.rarity,
                                    cost: SharedDB.safeNum(fk.cost, 4.0),
                                    originalCost: SharedDB.safeNum(fk.cost, 4.0),
                                    baseAttack: SharedDB.safeNum(fk.baseAttack !== undefined ? fk.baseAttack : fk.attack, 0),
                                    intelligence: SharedDB.safeNum(fk.intelligence, 0),
                                    imageSrc: fk.imageSrc || '',
                                    skills: [{ name: inf2.label, description: '' }],
                                    country: fk.country || inf2.force || '他'
                                },
                                info: inf2,
                                uniqueId: fkid,
                                cardNo: fk.cardNo || fkid
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
            if (isReassignMode) {
                var teisenFkCards = allMirrorPool.filter(function(m) { return m.info && m.info.type === 'senkyo'; });
                if (teisenFkCards.length > 0) {
                    var teisenCandidateList = validCards.filter(function(c) {
                        var origC = SharedDB.safeNum(c.originalCost !== undefined ? c.originalCost : c.cost, 4.5);
                        if (SharedDB.isHaBusho(c) || String(c.rarity || '').toUpperCase() !== 'SL' || SharedDB.safeNum(c.maxFukushoCost, 0) <= 0 || origC <= 1.0) {
                            return false;
                        }
                        // 引率で実際に兵士バフを持つサポート候補のみに帝仙鏡を割り当てる（単騎専用サポートへの誤爆防止）
                        var bestSupT = getBestWeatherForCardForLead(c, targetTroopData, 'support', null, true).eval.tMult;
                        return bestSupT > 0;
                    });
                    teisenCandidateList.sort(function(a, b) {
                        var origA = SharedDB.safeNum(a.originalCost !== undefined ? a.originalCost : a.cost, 4.5);
                        var origB = SharedDB.safeNum(b.originalCost !== undefined ? b.originalCost : b.cost, 4.5);
                        if (origB !== origA) return origB - origA;
                        return getBestWeatherForCardForLead(b, targetTroopData, 'support', null, true).eval.tMult - getBestWeatherForCardForLead(a, targetTroopData, 'support', null, true).eval.tMult;
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

            var leadCandidates = [];
            for (var li = 0; li < validCards.length; li++) {
                var c = validCards[li];
                if (usedTeisenCardIds.has(c.uniqueId)) continue;
                var firstSName = String((c.skills && c.skills[0] && c.skills[0].name) || '').trim();
                if (firstNameIsAttack(firstSName)) {
                    var bestLead = getBestWeatherForCardForLead(c, targetTroopData, 'lead', c, isReassignMode);
                    var curOriginWeather = AppCards.slotWeathers[originSlotId] || 'SUN';
                    var fixedEval = evaluateCardLead(c, targetTroopData, curOriginWeather, 'lead', c, isReassignMode);
                    var useEval = shouldAutoWeather ? bestLead.eval : fixedEval;
                    var useWeather = shouldAutoWeather ? bestLead.bestWeather : curOriginWeather;
                    if (useEval.tMult > 0 || useEval.gMult > 0) {
                        var estScore = targetTroopData.attack * troopCount * (1 + useEval.tMult / 100) + SharedDB.safeNum(c.baseAttack, 1000) * (1 + useEval.gMult / 100);
                        leadCandidates.push({
                            card: c,
                            tMult: useEval.tMult,
                            gMult: useEval.gMult,
                            firstTMult: useEval.firstTMult,
                            firstGMult: useEval.firstGMult,
                            bestWeather: useWeather,
                            score: estScore
                        });
                    }
                }
            }

            if (leadCandidates.length === 0) {
                for (var li2 = 0; li2 < validCards.length; li2++) {
                    var c2 = validCards[li2];
                    if (usedTeisenCardIds.has(c2.uniqueId)) continue;
                    var bestLead2 = getBestWeatherForCardForLead(c2, targetTroopData, 'lead', c2, isReassignMode);
                    var curW2 = AppCards.slotWeathers[originSlotId] || 'SUN';
                    var fixedEv2 = evaluateCardLead(c2, targetTroopData, curW2, 'lead', c2, isReassignMode);
                    var useEv2 = shouldAutoWeather ? bestLead2.eval : fixedEv2;
                    var useW2 = shouldAutoWeather ? bestLead2.bestWeather : curW2;
                    if (useEv2.tMult > 0 || useEv2.gMult > 0) {
                        var estScore2 = targetTroopData.attack * troopCount * (1 + useEv2.tMult / 100) + SharedDB.safeNum(c2.baseAttack, 1000) * (1 + useEv2.gMult / 100);
                        leadCandidates.push({
                            card: c2,
                            tMult: useEv2.tMult,
                            gMult: useEv2.gMult,
                            firstTMult: useEv2.firstTMult,
                            firstGMult: useEv2.firstGMult,
                            bestWeather: useW2,
                            score: estScore2
                        });
                    }
                }
            }

            leadCandidates.sort(function(a, b) { return b.score - a.score; });
            var topLeadPool = leadCandidates.slice(0, Math.min(5, leadCandidates.length));

            var supportPoolsByCountry = Object.create(null);
            function getSupportPoolsForLead(leadCard) {
                var cKey = SharedDB.isHaBusho(leadCard) ? '覇' : (leadCard.country || '他');
                if (supportPoolsByCountry[cKey]) return supportPoolsByCountry[cKey];

                var shureiPool = [], allActivesPool = [], globalPassivePool = [], boundPassivePool = [], guardPool = [];
                for (var si = 0; si < validCards.length; si++) {
                    var sc = validCards[si];
                    if (usedTeisenCardIds.has(sc.uniqueId)) continue;
                    var bestSup = getBestWeatherForCardForLead(sc, targetTroopData, 'support', leadCard, isReassignMode);
                    var probe = bestSup.eval;
                    if (!probe.isActive && !probe.isPassive && !probe.isGuard) continue;
                    // 兵士攻撃力を上げない単騎専用サポートは引率サポート候補から完全に除外
                    if (SharedDB.safeNum(probe.tMult, 0) <= 0) continue;

                    var effCost = effectiveCostMap[sc.uniqueId];
                    var item = {
                        card: sc,
                        effectiveCost: effCost,
                        tMult: probe.tMult,
                        gMult: probe.gMult,
                        firstTMult: probe.firstTMult,
                        firstGMult: probe.firstGMult,
                        isBound: probe.mustBeSameBase,
                        isShurei: probe.isShurei,
                        weather: bestSup.bestWeather
                    };
                    if (probe.isGuard) {
                        guardPool.push(item);
                    } else if (probe.isPassive) {
                        if (probe.mustBeSameBase) boundPassivePool.push(item);
                        else globalPassivePool.push(item);
                    } else if (probe.isActive) {
                        var firstSName = String((sc.skills && sc.skills[0] && sc.skills[0].name) || '');
                        if (firstSName.indexOf("防:") === 0) {
                            if (probe.isShurei) {
                                var originW = shouldAutoWeather ? bestSup.bestWeather : (AppCards.slotWeathers[originSlotId] || 'SUN');
                                var ev = evaluateCardLead(sc, targetTroopData, originW, 'support', leadCard, isReassignMode);
                                if (ev.tMult > 0 && ev.isActive) {
                                    shureiPool.push(Object.assign({}, item, {
                                        tMult: ev.tMult,
                                        gMult: ev.gMult,
                                        firstTMult: ev.firstTMult,
                                        firstGMult: ev.firstGMult,
                                        weather: originW
                                    }));
                                }
                            } else {
                                allActivesPool.push(item);
                            }
                        }
                    }
                }
                supportPoolsByCountry[cKey] = {
                    shureiPool: shureiPool,
                    allActivesPool: allActivesPool,
                    globalPassivePool: globalPassivePool,
                    boundPassivePool: boundPassivePool,
                    guardPool: guardPool
                };
                return supportPoolsByCountry[cKey];
            }

            var bestSetup = { finalTotalDamage: -1 };

            topLeadPool.forEach(function(leadItem) {
                var leadCard = leadItem.card;
                var leadEffCost = effectiveCostMap[leadCard.uniqueId];
                if (leadEffCost > originLimit) return;

                var leadNo = leadCard.cardNo || leadCard.uniqueId;
                var leadTMult = leadItem.tMult;
                var leadGMult = leadItem.gMult;

                var pools = getSupportPoolsForLead(leadCard);
                var shureiPool = pools.shureiPool.filter(function(x) { return x.card.uniqueId !== leadCard.uniqueId && (x.card.cardNo || x.card.uniqueId) !== leadNo && x.tMult > 0; });
                var allActivesPool = pools.allActivesPool.filter(function(x) { return x.card.uniqueId !== leadCard.uniqueId && (x.card.cardNo || x.card.uniqueId) !== leadNo && x.tMult > 0; });
                var globalPassivePool = pools.globalPassivePool.filter(function(x) { return x.card.uniqueId !== leadCard.uniqueId && (x.card.cardNo || x.card.uniqueId) !== leadNo && x.tMult > 0; });
                var boundPassivePool = pools.boundPassivePool.filter(function(x) { return x.card.uniqueId !== leadCard.uniqueId && (x.card.cardNo || x.card.uniqueId) !== leadNo && x.tMult > 0; });
                var guardPool = pools.guardPool.filter(function(x) { return x.card.uniqueId !== leadCard.uniqueId && (x.card.cardNo || x.card.uniqueId) !== leadNo && x.tMult > 0; });

                var chosenShurei = null;
                shureiPool.sort(function(a, b) { return b.tMult - a.tMult; });
                if (shureiPool.length > 0) chosenShurei = shureiPool[0];

                var shureiCost = chosenShurei ? chosenShurei.effectiveCost : 0.0;
                var shureiBuff = chosenShurei ? chosenShurei.tMult : 0.0;
                var originInitCost = leadEffCost + shureiCost;
                if (originInitCost > originLimit) return;

                var globalActives = allActivesPool.filter(function(a) { return !a.isBound && a.tMult > 0; });
                var topGlobals = globalActives.slice().sort(function(a, b) { return b.tMult - a.tMult; });
                var evalGlobals = topGlobals.slice(0, Math.min(6, topGlobals.length));
                var hSlotPatterns = [];

                if (!isHonkyoAttack) {
                    for (var i = 0; i < evalGlobals.length; i++) {
                        for (var j = i + 1; j < evalGlobals.length; j++) {
                            var noI = evalGlobals[i].card.cardNo || evalGlobals[i].card.uniqueId;
                            var noJ = evalGlobals[j].card.cardNo || evalGlobals[j].card.uniqueId;
                            if (noI !== noJ) hSlotPatterns.push([evalGlobals[i], evalGlobals[j]]);
                        }
                    }
                    for (var i = 0; i < evalGlobals.length; i++) hSlotPatterns.push([evalGlobals[i]]);
                    hSlotPatterns.push([]);
                } else {
                    var h1Candidates = allActivesPool.filter(function(a) { return !a.isShurei && a.tMult > 0; }).sort(function(a, b) { return b.tMult - a.tMult; });
                    var topH1 = h1Candidates.slice(0, Math.min(6, h1Candidates.length));
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
                        return !usedNos.has(aNo) && !a.isShurei && a.tMult > 0;
                    });
                    remActivesForK.sort(function(a, b) { return b.tMult - a.tMult; });

                    for (var ai = 0; ai < remActivesForK.length; ai++) {
                        var act = remActivesForK[ai];
                        var actNo = act.card.cardNo || act.card.uniqueId;
                        var maxSlots = isHonkyoAttack ? 9 : 8;
                        if (kActives.length < maxSlots && !usedNos.has(actNo) && (curKCost + act.effectiveCost <= kyotenLimit)) {
                            kActives.push(act);
                            curKCost += act.effectiveCost;
                            usedNos.add(actNo);
                        }
                    }

                    var hRemCost = honkyoLimit - curHCost;
                    var kRemCost = kyotenLimit - curKCost;

                    var filterBestPerNo = function(pool) {
                        var bestMap = Object.create(null);
                        for (var pi = 0; pi < pool.length; pi++) {
                            var x = pool[pi];
                            var xNo = x.card.cardNo || x.card.uniqueId;
                            if (usedNos.has(xNo) || x.tMult <= 0) continue;
                            var dpItem = {
                                card: x.card,
                                cost: x.effectiveCost,
                                effectiveCost: x.effectiveCost,
                                tMult: x.tMult,
                                gMult: x.gMult,
                                firstTMult: x.firstTMult,
                                firstGMult: x.firstGMult,
                                isBound: x.isBound
                            };
                            if (!bestMap[xNo] || dpItem.tMult > bestMap[xNo].tMult) bestMap[xNo] = dpItem;
                        }
                        return Object.values(bestMap);
                    };

                    var availGlobalPassives = filterBestPerNo(globalPassivePool);
                    var availBoundPassives = filterBestPerNo(boundPassivePool);

                    var pickedHPassives = [], pickedKPassives = [], passivesBuffSum = 0;
                    if (!isHonkyoAttack) {
                        var kRes = SharedDB.solveKnapsackDP(kRemCost, availBoundPassives);
                        pickedKPassives = kRes.picked; passivesBuffSum += kRes.val;
                        var pKNos = new Set(pickedKPassives.map(function(p) { return p.card.cardNo || p.card.uniqueId; }));
                        var remGP1 = availGlobalPassives.filter(function(p) { return !pKNos.has(p.card.cardNo || p.card.uniqueId); });
                        var hRes = SharedDB.solveKnapsackDP(hRemCost, remGP1);
                        pickedHPassives = hRes.picked; passivesBuffSum += hRes.val;
                        var pHNos = new Set(pickedHPassives.map(function(p) { return p.card.cardNo || p.card.uniqueId; }));
                        var remGlobalP = remGP1.filter(function(p) { return !pHNos.has(p.card.cardNo || p.card.uniqueId); });
                        var kExtra = kRemCost - pickedKPassives.reduce(function(s, p) { return s + p.effectiveCost; }, 0);
                        if (kExtra >= 0.5 && remGlobalP.length > 0) {
                            var exK = SharedDB.solveKnapsackDP(kExtra, remGlobalP);
                            pickedKPassives = pickedKPassives.concat(exK.picked); passivesBuffSum += exK.val;
                        }
                    } else {
                        var hRes = SharedDB.solveKnapsackDP(hRemCost, availBoundPassives);
                        pickedHPassives = hRes.picked; passivesBuffSum += hRes.val;
                        var pHNos2 = new Set(pickedHPassives.map(function(p) { return p.card.cardNo || p.card.uniqueId; }));
                        var remGP2 = availGlobalPassives.filter(function(p) { return !pHNos2.has(p.card.cardNo || p.card.uniqueId); });
                        var kRes = SharedDB.solveKnapsackDP(kRemCost, remGP2);
                        pickedKPassives = kRes.picked; passivesBuffSum += kRes.val;
                        var pKNos2 = new Set(pickedKPassives.map(function(p) { return p.card.cardNo || p.card.uniqueId; }));
                        var remGlobalP2 = remGP2.filter(function(p) { return !pKNos2.has(p.card.cardNo || p.card.uniqueId); });
                        var hExtra = hRemCost - pickedHPassives.reduce(function(s, p) { return s + p.effectiveCost; }, 0);
                        if (hExtra >= 0.5 && remGlobalP2.length > 0) {
                            var exH = SharedDB.solveKnapsackDP(hExtra, remGlobalP2);
                            pickedHPassives = pickedHPassives.concat(exH.picked); passivesBuffSum += exH.val;
                        }
                    }

                    var activeBuffSum = hPair.reduce(function(s, x) { return s + x.tMult; }, 0) + kActives.reduce(function(s, x) { return s + x.tMult; }, 0);
                    var currentTotalBuff = shureiBuff + activeBuffSum + passivesBuffSum;

                    if (currentTotalBuff > bestLocalBuff) {
                        bestLocalBuff = currentTotalBuff;
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
                            activeSlots: currentSlots,
                            basePassives: pickedHPassives,
                            subPassives: pickedKPassives,
                            totalSupportTMult: currentTotalBuff,
                            hCost: curHCost + pickedHPassives.reduce(function(sum, x) { return sum + x.effectiveCost; }, 0),
                            kCost: curKCost + pickedKPassives.reduce(function(sum, x) { return sum + x.effectiveCost; }, 0),
                            activeCountBase: Object.keys(currentSlots).filter(function(s) { return s.indexOf('h') === 0; }).length,
                            activeCountSub: Object.keys(currentSlots).filter(function(s) { return s.indexOf('k') === 0; }).length,
                            usedNos: actualUsedNos
                        };
                    }
                }

                if (!bestLocalSetup) return;

                var finalUsedNos = new Set(bestLocalSetup.usedNos);
                var filterBestGuardPerNo = function(pool) {
                    var bestMap = Object.create(null);
                    for (var gi = 0; gi < pool.length; gi++) {
                        var g = pool[gi];
                        var gNo = g.card.cardNo || g.card.uniqueId;
                        if (finalUsedNos.has(gNo) || g.tMult <= 0) continue;
                        var dpItem = {
                            card: g.card,
                            cost: g.effectiveCost,
                            effectiveCost: g.effectiveCost,
                            tMult: g.tMult,
                            gMult: g.gMult,
                            firstTMult: g.firstTMult,
                            firstGMult: g.firstGMult,
                            isBound: g.isBound
                        };
                        if (!bestMap[gNo] || dpItem.tMult > bestMap[gNo].tMult) bestMap[gNo] = dpItem;
                    }
                    return Object.values(bestMap);
                };

                var availGuards = filterBestGuardPerNo(guardPool);
                var hGuards = SharedDB.solveKnapsackDP(honkyoLimit, availGuards.filter(function(x) { return !x.isBound || isHonkyoAttack; }));
                var hGuardPicked = hGuards.picked;
                var hGuardNos = new Set(hGuardPicked.map(function(x) { return x.card.cardNo || x.card.uniqueId; }));
                var kGuards = SharedDB.solveKnapsackDP(kyotenLimit, availGuards.filter(function(x) { return (!x.isBound || !isHonkyoAttack) && !hGuardNos.has(x.card.cardNo || x.card.uniqueId); }));
                var kGuardPicked = kGuards.picked;

                var guardBuffSum = hGuards.val + kGuards.val;
                var totalSupportTMult = bestLocalSetup.totalSupportTMult + guardBuffSum;

                var assignedAdjutantsMap = (leadAdjutantMode === 'CURRENT') ? null : Object.create(null);
                var additionalAdjutantBuff = 0;
                var additionalAdjutantGenBuff = 0;
                var adjutantAddedBuffMap = Object.create(null);
                var adjutantAddedGenBuffMap = Object.create(null);
                var usedAdjutantCostMap = Object.create(null);
                var leadAdjutantAtkBonus = 0;

                var allDeckUsedIds = new Set([leadCard.uniqueId]);
                var allDeckUsedNos = new Set([leadNo]);
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
                if (!SharedDB.isHaBusho(leadCard) && SharedDB.safeNum(leadCard.maxFukushoCost, 0) > 0) {
                    var kMult = SharedDB.getKakuseiMultiplier(leadCard);
                    masterList.push({
                        role: 'lead',
                        card: leadCard,
                        maxCost: SharedDB.safeNum(leadCard.maxFukushoCost, 4.5),
                        baseCopyVal: leadItem.firstTMult / kMult,
                        baseCopyGenVal: leadItem.firstGMult / kMult,
                        priority: 100000000 + leadItem.firstTMult + leadItem.firstGMult
                    });
                }
                Object.keys(bestLocalSetup.activeSlots).forEach(function(sId) {
                    var it = bestLocalSetup.activeSlots[sId];
                    if (it.card && !SharedDB.isHaBusho(it.card) && SharedDB.safeNum(it.card.maxFukushoCost, 0) > 0 && it.firstTMult > 0) {
                        var kMult2 = SharedDB.getKakuseiMultiplier(it.card);
                        masterList.push({
                            role: 'active',
                            card: it.card,
                            maxCost: SharedDB.safeNum(it.card.maxFukushoCost, 4.5),
                            baseCopyVal: it.firstTMult / kMult2,
                            baseCopyGenVal: 0,
                            priority: 5000000 + it.firstTMult
                        });
                    }
                });
                bestLocalSetup.basePassives.concat(bestLocalSetup.subPassives, hGuardPicked, kGuardPicked).forEach(function(p) {
                    if (p.card && !SharedDB.isHaBusho(p.card) && SharedDB.safeNum(p.card.maxFukushoCost, 0) > 0 && p.firstTMult > 0) {
                        var kMult3 = SharedDB.getKakuseiMultiplier(p.card);
                        masterList.push({
                            role: 'passive',
                            card: p.card,
                            maxCost: SharedDB.safeNum(p.card.maxFukushoCost, 4.5),
                            baseCopyVal: p.firstTMult / kMult3,
                            baseCopyGenVal: 0,
                            priority: 1000000 + p.firstTMult
                        });
                    }
                });

                masterList.sort(function(a, b) { return b.priority - a.priority; });

                masterList.forEach(function(master) {
                    var mCard = master.card;
                    adjutantAddedBuffMap[mCard.uniqueId] = 0;
                    adjutantAddedGenBuffMap[mCard.uniqueId] = 0;
                    usedAdjutantCostMap[mCard.uniqueId] = 0;
                    var existing = [];
                    if ((leadAdjutantMode === 'CURRENT' || leadAdjutantMode === 'FILL_EMPTY') && Array.isArray(mCard.fukusho)) {
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
                                existing.push(Object.assign({}, rawFk, {
                                    copyRate: rate,
                                    label: formatMirrorLabelWithCost(inf, rate)
                                }));
                                var addB = master.baseCopyVal * (rate / 100);
                                var addG = master.baseCopyGenVal * (rate / 100);
                                additionalAdjutantBuff += addB;
                                additionalAdjutantGenBuff += addG;
                                adjutantAddedBuffMap[mCard.uniqueId] += addB;
                                adjutantAddedGenBuffMap[mCard.uniqueId] += addG;
                            } else {
                                existing.push(rawFk);
                            }
                        });
                    }
                    if (assignedAdjutantsMap) assignedAdjutantsMap[mCard.uniqueId] = existing;
                });

                if (leadAdjutantMode !== 'CURRENT') {
                    var availableMirrors = allMirrorPool.filter(function(m) {
                        return !allDeckUsedIds.has(m.uniqueId) && !allDeckUsedNos.has(m.cardNo) && !usedTeisenCardIds.has(m.uniqueId);
                    });

                    var troopWeight = (targetTroopData.attack * troopCount) / 100;

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
                                    name: tCard.name || '副将の帝仙鏡',
                                    cardNo: tCard.cardNo || '',
                                    imageSrc: tCard.imageSrc || (tCard.cardNo ? 'https://3gokushi.jp/img/card/card_' + tCard.cardNo + '.jpg' : ''),
                                    rarity: 'SL',
                                    cost: tCost,
                                    baseAttack: SharedDB.safeNum(tCard.baseAttack, 0),
                                    label: (tSt.isBu ? '[武]' : '') + '帝仙鏡 100% [主将C1化]',
                                    copyRate: 100,
                                    uniqueId: tWrapper.uniqueId,
                                    info: { type: 'senkyo', rate: 100 }
                                });
                                var addBT = master.baseCopyVal * 1.0;
                                var addGT = master.baseCopyGenVal * 1.0;
                                additionalAdjutantBuff += addBT;
                                additionalAdjutantGenBuff += addGT;
                                adjutantAddedBuffMap[mCard.uniqueId] += addBT;
                                adjutantAddedGenBuffMap[mCard.uniqueId] += addGT;
                            }
                        }

                        if (currentAssigned.length >= maxSlots) return;

                        var unusedForMaster = availableMirrors.filter(function(fk) {
                            return !usedMirrorIds.has(fk.uniqueId) && !usedMirrorNos.has(fk.cardNo);
                        });

                        var bestCombo = SharedDB.findBestAdjutantCombo(mCard, unusedForMaster, currentAssigned, usedAdjutantCostMap[mCard.uniqueId], {
                            baseCopyT: master.baseCopyVal,
                            baseCopyG: master.baseCopyGenVal,
                            wTroop: troopWeight,
                            wGen: SharedDB.safeNum(mCard.baseAttack, 1000) / 100,
                            wAtk: (master.role === 'lead') ? 60 : 0
                        });

                        bestCombo.forEach(function(chosenFk) {
                            usedMirrorIds.add(chosenFk.uniqueId);
                            usedMirrorNos.add(chosenFk.cardNo);
                            usedAdjutantCostMap[mCard.uniqueId] += chosenFk.cost;
                            if (master.role === 'lead') leadAdjutantAtkBonus += chosenFk.atkBonus;
                            currentAssigned.push(chosenFk);
                            var addB = master.baseCopyVal * (chosenFk.copyRate / 100);
                            var addG = master.baseCopyGenVal * (chosenFk.copyRate / 100);
                            additionalAdjutantBuff += addB;
                            additionalAdjutantGenBuff += addG;
                            adjutantAddedBuffMap[mCard.uniqueId] += addB;
                            adjutantAddedGenBuffMap[mCard.uniqueId] += addG;
                        });
                    });
                }

                totalSupportTMult += additionalAdjutantBuff;

                var elGoBuff = document.getElementById('optLeadGoBuff');
                var currentGo = isLeadGoEnabled ? SharedDB.safeNum(elGoBuff && elGoBuff.value, leadGoBuffValue) : 0;
                var pureTroopMult = leadTMult + totalSupportTMult;
                var pureGenMult = leadGMult + additionalAdjutantGenBuff;
                var finalTroopMult = pureTroopMult + currentGo;
                var finalGenMult = pureGenMult + currentGo;

                var effectiveGenAtk = leadCard.baseAttack + leadAdjutantAtkBonus;
                var troopDamage = Math.floor(targetTroopData.attack * troopCount * (1 + (finalTroopMult / 100)));
                var genDamage = Math.floor(effectiveGenAtk * (1 + (finalGenMult / 100)));
                var baseTotalDamage = troopDamage + genDamage;
                var altMultiplier = isLeadHighland ? 1.2 : 1.0;
                var buff10Multiplier = isLeadAttackBuff10 ? 1.1 : 1.0;
                var finalTotalDamage = Math.floor(baseTotalDamage * altMultiplier * buff10Multiplier);

                if (finalTotalDamage > bestSetup.finalTotalDamage) {
                    bestSetup = {
                        finalTotalDamage: finalTotalDamage,
                        baseTotalDamage: baseTotalDamage,
                        troopDamage: troopDamage,
                        genDamage: genDamage,
                        pureTroopMult: pureTroopMult,
                        pureGenMult: pureGenMult,
                        finalTroopMult: finalTroopMult,
                        finalGenMult: finalGenMult,
                        goBuff: currentGo,
                        lead: leadCard,
                        leadAdjutantAtkBonus: leadAdjutantAtkBonus,
                        leadTMult: leadTMult,
                        leadGMult: leadGMult,
                        attackOrigin: attackOrigin,
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
            });

            var area = document.getElementById('leadDeckResultArea');
            if (!area) return;
            if (bestSetup.finalTotalDamage === -1) {
                area.innerHTML = '<div class="text-gray-500 text-sm border-2 border-dashed border-gray-700 p-8 text-center rounded-xl">指定した出兵元で引率可能な武将が見つかりませんでした。</div>';
                currentLeadOptimizedSetup = null;
                return;
            }

            if (shouldAutoWeather) {
                Object.keys(bestSetup.chosenActiveSlots).forEach(function(sId) {
                    if (bestSetup.chosenActiveSlots[sId].weather) AppCards.slotWeathers[sId] = bestSetup.chosenActiveSlots[sId].weather;
                });
            }
            currentLeadOptimizedSetup = bestSetup;
            render(bestSetup);
            AppCards.setStatusLog("引率最適化完了: 最大攻撃力 " + bestSetup.finalTotalDamage.toLocaleString());
        } catch (err) {
            console.error("LeadEngine.run Error:", err);
            AppCards.setStatusLog("引率計算エラー: " + err.message, true);
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
        var area = document.getElementById('leadDeckResultArea');
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
                var totalSlotBuff = item.tMult + adjAddedB;
                cardContent = `
                    <div class="relative border ${borderCol} rounded-lg p-1.5 opacity-90 hover:opacity-100 hover:z-40 transition w-full mt-1">
                        ${SharedUI.getCardVisualHTML(getDisplayCard(item.card, setup), adjList)}
                        <div class="absolute -top-2 -right-2 bg-black border ${badgeCol} text-[8px] px-1 rounded-full shadow-md z-10 font-mono text-center leading-tight pointer-events-none">
                            兵+${SharedDB.formatBuffNum(totalSlotBuff)}% ${typeChar}
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
                var displayVal = SharedDB.formatBuffNum(s.tMult + adjAddedB);
                return `
                <div class="relative border ${isGuard ? 'border-purple-500' : 'border-gray-500'} rounded-lg p-1.5 opacity-90 hover:opacity-100 hover:z-40 transition">
                    ${SharedUI.getCardVisualHTML(getDisplayCard(s.card, setup), adjList)}
                    <div class="absolute -top-2 -right-2 bg-black border ${isGuard ? 'border-purple-500 text-purple-400' : 'border-gray-500 text-gray-300'} text-[8px] px-1 rounded-full shadow-md z-10 font-mono text-center leading-tight pointer-events-none">
                        兵+${displayVal}% ${isGuard ? '(警護)' : '(自動)'}
                    </div>
                    ${s.isBound ? `<div class="absolute -top-2 left-0 bg-red-600 border border-red-400 text-white text-[8px] px-1 rounded-full shadow-md z-30 font-bold pointer-events-none">拠点縛り</div>` : ''}
                </div>
            `;}).join('');
        };

        var extraBadges = '';
        var multFormula = '';
        if (isLeadHighland && isLeadAttackBuff10) {
            extraBadges += '<span class="bg-amber-500 text-black text-[10px] font-bold px-2 py-0.5 rounded shadow">高地 ×1.2</span><span class="bg-red-600 text-white text-[10px] font-bold px-2 py-0.5 rounded shadow">課金 ×1.1</span>';
            multFormula = ' × 1.32 <span class="text-amber-400 font-bold">(高地1.2 × 課金1.1)</span>';
        } else if (isLeadHighland) {
            extraBadges += '<span class="bg-amber-500 text-black text-[10px] font-bold px-2 py-0.5 rounded shadow">高地 ×1.2</span>';
            multFormula = ' × 1.2 <span class="text-amber-400 font-bold">(高地)</span>';
        } else if (isLeadAttackBuff10) {
            extraBadges += '<span class="bg-red-600 text-white text-[10px] font-bold px-2 py-0.5 rounded shadow">課金 ×1.1</span>';
            multFormula = ' × 1.1 <span class="text-red-400 font-bold">(課金10%UP)</span>';
        }
        if (setup.goBuff > 0) extraBadges += '<span class="bg-cyan-700 text-white text-[10px] font-bold px-2 py-0.5 rounded shadow">伍 +' + setup.goBuff + '%</span>';

        var leadAdjList = setup.assignedAdjutantsMap ? setup.assignedAdjutantsMap[setup.lead.uniqueId] : null;
        var leadAdjAddedB = (setup.adjutantAddedBuffMap && setup.adjutantAddedBuffMap[setup.lead.uniqueId]) || 0;
        var leadAdjAddedG = (setup.adjutantAddedGenBuffMap && setup.adjutantAddedGenBuffMap[setup.lead.uniqueId]) || 0;
        var leadAdjAtkAdd = SharedDB.safeNum(setup.leadAdjutantAtkBonus, 0);
        var effectiveGenAtk = setup.lead.baseAttack + leadAdjAtkAdd;

        area.className = "space-y-6 animate-flash";
        area.innerHTML = `
            <div class="bg-sangoku-dark border border-sangoku-cardBorder p-5 rounded-xl shadow-lg mb-6">
                <div class="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 border-b border-gray-800 pb-4 gap-4">
                    <div>
                        <div class="flex flex-wrap items-center gap-1.5 mb-2">
                            <span class="bg-amber-600 text-white text-[10px] font-bold px-2 py-0.5 rounded shadow">引率計算結果</span>
                            ${extraBadges}
                            <h3 class="text-lg font-bold text-white ml-1">【出撃拠点: <span class="${originColor}">${originName}</span>】</h3>
                        </div>
                        <div class="text-xs text-gray-300 font-mono space-y-1.5 bg-black/40 p-2.5 rounded-lg border border-gray-800">
                            <div class="flex items-center space-x-2">
                                <span class="text-gray-400">引率兵種:</span>
                                <span class="text-amber-300 font-bold text-sm">${setup.targetTroopData.name}</span>
                                <span class="text-gray-500 text-[10px]">(1兵素攻: ${setup.targetTroopData.attack})</span>
                                <span class="text-gray-400 ml-2">兵数:</span>
                                <span class="text-white font-bold">${setup.troopCount.toLocaleString()}</span>
                            </div>
                            <div class="flex items-center space-x-4">
                                <div>総兵士バフ: <span class="text-amber-400 font-bold">+${SharedDB.formatBuffNum(setup.finalTroopMult)}%</span></div>
                                <div>総武将バフ: <span class="text-blue-400 font-bold">+${SharedDB.formatBuffNum(setup.finalGenMult)}%</span></div>
                            </div>
                        </div>
                    </div>
                    <div class="text-right bg-black/60 p-4 rounded-xl border border-gray-700 w-full md:w-auto shadow-inner">
                        <div class="text-xs text-gray-400 mb-1 text-center md:text-right">部隊 最終総合攻撃力</div>
                        <div class="text-3xl font-bold text-red-400 font-mono drop-shadow-md text-center md:text-right">${setup.finalTotalDamage.toLocaleString()}</div>
                        <div class="text-[10px] text-gray-400 mt-2 text-center md:text-right leading-relaxed bg-black/40 p-2 rounded border border-gray-800">
                            ＝ [ 兵(${setup.troopCount.toLocaleString()}兵) + 将(${effectiveGenAtk.toLocaleString()}) ]${multFormula}
                        </div>
                    </div>
                </div>
                
                <div class="mb-2 text-sm text-gray-300 font-bold border-l-4 border-amber-500 pl-2">引率エース武将 <span class="text-xs text-gray-500 font-normal">(${originName} に配置)</span></div>
                <div class="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-3 mb-8">
                    <div class="relative border-2 border-amber-500 rounded-lg p-1.5 shadow-[0_0_15px_rgba(245,205,104,0.3)] hover:z-40">
                        ${SharedUI.getCardVisualHTML(getDisplayCard(setup.lead, setup), leadAdjList)}
                        <div class="absolute -top-2 -right-2 bg-black border border-amber-500 text-amber-400 text-[8px] px-1.5 py-0.5 rounded-full shadow-md z-10 font-mono text-center leading-tight pointer-events-none">
                            兵+${SharedDB.formatBuffNum(setup.leadTMult + leadAdjAddedB)}%<br>将+${SharedDB.formatBuffNum(setup.leadGMult + leadAdjAddedG)}%${leadAdjAtkAdd > 0 ? '<br>武+' + leadAdjAtkAdd.toLocaleString() : ''}
                        </div>
                    </div>
                </div>
                
                <div class="mb-6 border border-gray-700 rounded-lg p-4 bg-gray-900/50">
                    <div class="text-md font-bold text-white mb-2 flex justify-between border-b border-gray-700 pb-2">
                        <span><i class="fa-solid fa-chess-rook text-amber-500 mr-2"></i>本拠 に配置するサポート</span>
                        <span class="text-xs font-mono ${setup.honkyoCost > setup.honkyoLimit ? 'text-red-400' : 'text-gray-300'} font-bold">表コスト: ${setup.honkyoCost.toFixed(1)} / ${setup.honkyoLimit.toFixed(1)}</span>
                    </div>
                    <div class="text-xs text-blue-400 mb-2"><i class="fa-solid fa-hand-pointer mr-1"></i>内政セット枠 (手動: ${setup.activeCountBase}枚)</div>
                    <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 mb-4">${renderActiveSlotHTML('h0', '1. 本拠')}${renderActiveSlotHTML('h1', '2. 塔')}</div>
                    <div class="text-xs text-gray-400 mb-1"><i class="fa-solid fa-bolt mr-1"></i>出撃デッキ空き枠 (パッシブ: ${setup.chosenBasePassives.length}枚)</div>
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
                    <div class="text-xs text-blue-400 mb-2"><i class="fa-solid fa-hand-pointer mr-1"></i>内政セット枠 (手動: ${setup.activeCountSub}枚)</div>
                    <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mb-4">
                        ${renderActiveSlotHTML('k0', '3. 拠点1')}${renderActiveSlotHTML('k1', '4. 拠点2')}${renderActiveSlotHTML('k2', '5. 拠点3')}
                        ${renderActiveSlotHTML('k3', '6. 拠点4')}${renderActiveSlotHTML('k4', '7. 拠点5')}${renderActiveSlotHTML('k5', '8. 拠点6')}
                        ${renderActiveSlotHTML('k6', '9. 拠点7')}${renderActiveSlotHTML('k7', '10. 拠点8')}${renderActiveSlotHTML('k8', '11. 拠点9')}
                    </div>
                    <div class="text-xs text-gray-400 mb-1"><i class="fa-solid fa-bolt mr-1"></i>出撃デッキ空き枠 (パッシブ: ${setup.chosenSubPassives.length}枚)</div>
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
        changeAdjutantMode: function(val) { leadAdjutantMode = val; run(true); },
        setAltitude: function(val) {
            isLeadHighland = val;
            var btnNorm = document.getElementById('btnLeadAltNormal');
            var btnHigh = document.getElementById('btnLeadAltHigh');
            var lbl = document.getElementById('labelLeadAltStatus');
            if (val) {
                if (btnNorm) btnNorm.className = "py-1 text-xs font-bold rounded-lg transition text-gray-400 hover:text-white cursor-pointer";
                if (btnHigh) btnHigh.className = "py-1 text-xs font-bold rounded-lg transition bg-amber-600 text-black shadow cursor-pointer";
                if (lbl) lbl.innerHTML = '<span class="text-amber-400 font-bold">高地 (×1.2)</span>';
            } else {
                if (btnNorm) btnNorm.className = "py-1 text-xs font-bold rounded-lg transition bg-gray-700 text-white shadow cursor-pointer";
                if (btnHigh) btnHigh.className = "py-1 text-xs font-bold rounded-lg transition text-gray-400 hover:text-white cursor-pointer";
                if (lbl) lbl.textContent = "等倍 (×1.0)";
            }
            fastUpdateLeadMultiplier();
        },
        setBuff10: function(val) {
            isLeadAttackBuff10 = val;
            var btnOff = document.getElementById('btnLeadBuff10Off');
            var btnOn = document.getElementById('btnLeadBuff10On');
            var lbl = document.getElementById('labelLeadBuff10Status');
            if (val) {
                if (btnOff) btnOff.className = "py-1 text-xs font-bold rounded-lg transition text-gray-400 hover:text-white cursor-pointer";
                if (btnOn) btnOn.className = "py-1 text-xs font-bold rounded-lg transition bg-red-600 text-white shadow cursor-pointer";
                if (lbl) lbl.innerHTML = '<span class="text-red-400 font-bold">ON (×1.1)</span>';
            } else {
                if (btnOff) btnOff.className = "py-1 text-xs font-bold rounded-lg transition bg-gray-700 text-white shadow cursor-pointer";
                if (btnOn) btnOn.className = "py-1 text-xs font-bold rounded-lg transition text-gray-400 hover:text-white cursor-pointer";
                if (lbl) lbl.textContent = "OFF (×1.0)";
            }
            fastUpdateLeadMultiplier();
        },
        setGoEnabled: function(val) {
            isLeadGoEnabled = val;
            var btnOff = document.getElementById('btnLeadGoOff');
            var btnOn = document.getElementById('btnLeadGoOn');
            var lbl = document.getElementById('labelLeadGoStatus');
            var input = document.getElementById('optLeadGoBuff');
            var currentVal = SharedDB.safeNum(input && input.value, leadGoBuffValue);
            if (val) {
                if (btnOff) btnOff.className = "py-1 text-xs font-bold rounded-lg transition text-gray-400 hover:text-white cursor-pointer";
                if (btnOn) btnOn.className = "py-1 text-xs font-bold rounded-lg transition bg-cyan-600 text-white shadow cursor-pointer";
                if (lbl) lbl.innerHTML = '<span class="text-cyan-400 font-bold">ON (+' + currentVal + '%)</span>';
            } else {
                if (btnOff) btnOff.className = "py-1 text-xs font-bold rounded-lg transition bg-gray-700 text-white shadow cursor-pointer";
                if (btnOn) btnOn.className = "py-1 text-xs font-bold rounded-lg transition text-gray-400 hover:text-white cursor-pointer";
                if (lbl) lbl.textContent = "OFF (0%)";
            }
            fastUpdateLeadMultiplier();
        },
        updateGoBuff: function(val) {
            leadGoBuffValue = SharedDB.safeNum(val, 5500);
            if (isLeadGoEnabled) {
                var lbl = document.getElementById('labelLeadGoStatus');
                if (lbl) lbl.innerHTML = '<span class="text-cyan-400 font-bold">ON (+' + leadGoBuffValue + '%)</span>';
            }
            fastUpdateLeadMultiplier();
        }
    };
})();