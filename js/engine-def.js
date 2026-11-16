// ========================================================
// 【兵士防御計算エンジン】js/engine-def.js (Ver. 2.00)
// 役割：拠点防衛・南蛮太守5枠最適化、回復／短縮／武将専用スキル除外、2拠点同時DP最適配分（拠点縛り1枠厳密化）・主将コピー反映
// ========================================================
window.DefEngine = (function() {
    var isDefBuff10 = false;
    var isDefGoEnabled = true;
    var defGoBuffValue = 3000;
    var defMatchupMult = 1.0;
    var defAdjutantMode = 'REASSIGN_ALL';
    var isNanbanMode = false;
    var currentDefSetup = null;

    var defSkillCache = Object.create(null);

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

    function getDefKakuseiMult(card) {
        if (!card || !Array.isArray(card.skills)) return 1.0;
        for (var i = 0; i < card.skills.length; i++) {
            var s = card.skills[i];
            if (!s) continue;
            var sName = String(s.name || '').trim();
            var sDesc = String(s.description || '').trim();
            if (sName.indexOf('覚:') === 0 || sName.indexOf('副覚:') === 0 || sName.indexOf('覚醒') !== -1 || sDesc.indexOf('覚醒') !== -1) {
                var mTimes = sDesc.match(/([0-9\.]+)倍/);
                if (mTimes) return parseFloat(mTimes[1]);
                var mPct = sDesc.match(/([0-9\.]+)[%％]上昇/);
                if (mPct) return 1 + (parseFloat(mPct[1]) / 100);
                return 3.0;
            }
        }
        return 1.0;
    }

    function floatVal(s) {
        var n = parseFloat(s);
        return isNaN(n) ? 0 : n;
    }

    function parseDefSkill(skill, targetTroopData, weatherObj) {
        var empty = { tMult: 0, gMult: 0, perSameCountryMult: 0, reqCountry: null, dmgReduce: 0, isPassive: false, isGuardDeck: false, mustBeSameBase: true, isDefSkill: false, isManualNaisei: false };
        if (!skill || typeof skill !== 'object') return empty;
        var name = String(skill.name || '').trim();
        var rawDesc = String(skill.description || '').trim();

        if (name.indexOf('覚:') === 0 || name.indexOf('副覚:') === 0 || name.indexOf('覚醒') !== -1) return empty;
        if (isDuelSkill(skill)) return empty;

        var cacheKey = name + '\x01' + rawDesc + '\x01' + targetTroopData.name + '\x01' + weatherObj;
        var cached = defSkillCache[cacheKey];
        if (cached) return cached;

        var normDesc = rawDesc.replace(/(\d),(\d{3})/g, '$1$2');
        var full = (normDesc + ' ' + name).trim();
        var res = Object.assign({}, empty);
        if (!full) {
            defSkillCache[cacheKey] = res;
            return res;
        }

        if (full.indexOf('自動で発動') !== -1 || full.indexOf('自動発動') !== -1 || full.indexOf('全滅時も発動') !== -1 || full.indexOf('パッシブ') !== -1) {
            res.isPassive = true;
        }
        if (full.indexOf('警護デッキ') !== -1 || full.indexOf('警悟') !== -1) {
            res.isGuardDeck = true;
            res.isPassive = true;
        }

        var hasBaseBind = (
            normDesc.indexOf('セットした拠点') !== -1 ||
            normDesc.indexOf('この武将をセットした拠点') !== -1 ||
            normDesc.indexOf('所属拠点が同一') !== -1
        );
        res.mustBeSameBase = hasBaseBind;

        if (name.indexOf('防:') === 0 || name.indexOf('副防:') === 0 || name.indexOf('攻防:') === 0 || name.indexOf('副攻防:') === 0 || name.indexOf('変:') === 0 || name.indexOf('副変:') === 0) {
            res.isDefSkill = true;
        } else if (normDesc.indexOf('防御力') !== -1 || normDesc.indexOf('受けるダメージを') !== -1) {
            res.isDefSkill = true;
        }

        if (!res.isDefSkill) {
            defSkillCache[cacheKey] = res;
            return res;
        }

        if (name.indexOf('防:') === 0 && !res.isPassive) {
            res.isManualNaisei = true;
        }

        var wMult = 1.0;
        var cleanedWeatherDesc = full.replace(/[（\(][^）\)]*?[）\)]/g, ' ');
        var mSun = cleanedWeatherDesc.match(/晴天候時(?:は|の時)?[^0-9。]*?([0-9\.]+)倍/);
        if (mSun && weatherObj === 'SUN') wMult = Math.max(wMult, parseFloat(mSun[1]));
        var mBad = cleanedWeatherDesc.match(/(?:荒天時|曇[、・\s]*雨[、・\s]*雪天候時)(?:は|の時)?[^0-9。]*?([0-9\.]+)倍/);
        if (mBad && (weatherObj === 'CLOUD' || weatherObj === 'RAIN' || weatherObj === 'SNOW')) {
            wMult = Math.max(wMult, parseFloat(mBad[1]));
        }

        var mSameC = normDesc.match(/同一勢力\((魏|呉|蜀|他)\)の武将1枚につき([0-9\.]+)[%％]/);
        if (mSameC) {
            res.reqCountry = mSameC[1];
            res.perSameCountryMult = parseFloat(mSameC[2]) * wMult;
            defSkillCache[cacheKey] = res;
            return res;
        }

        var mRed = normDesc.match(/受けるダメージを([0-9\.]+)[%％]軽減/);
        if (mRed) {
            res.dmgReduce = parseFloat(mRed[1]);
        }

        var generalWords = ['全兵士', '全ての兵士', 'すべての兵士', '兵士', '全軍', '全兵科', '全拠点', '全兵'];
        var troopWords = [targetTroopData.name, targetTroopData.base, targetTroopData.sub];
        if (targetTroopData.type === '天兵') troopWords.push('天兵', '天兵科');
        else if (targetTroopData.type === '鋭兵') troopWords.push('鋭兵', '鋭兵科');

        var isGeneralTroop = generalWords.some(function(w) { return normDesc.indexOf(w) !== -1; }) && normDesc.indexOf('兵士を除く') === -1;
        var isSpecificTroop = troopWords.some(function(w) { return normDesc.indexOf(w) !== -1; });
        var isTroopComp = isGeneralTroop || isSpecificTroop;
        if (isTroopComp && normDesc.indexOf('天兵を除く') !== -1 && targetTroopData.type === '天兵') {
            isTroopComp = false;
        }

        var otherSpecificWords = ['槍兵', '弓兵', '騎兵', '剣兵', '斧兵', '戦斧兵', '双兵', '双剣兵', '錘兵', '大錘兵'];
        var mentionsAnySpecific = otherSpecificWords.some(function(ow) { return normDesc.indexOf(ow) !== -1; });
        var hasAllTroopWord = ['全兵士', '全ての兵士', 'すべての兵士', '全軍', '全兵科', '全拠点', '全兵'].some(function(gw) { return normDesc.indexOf(gw) !== -1; });
        if (mentionsAnySpecific && !isSpecificTroop && !hasAllTroopWord) {
            defSkillCache[cacheKey] = res;
            return res;
        }

        // ★重要：回復スキル（HPを〜回復）・短縮スキル（時間を〜短縮）・低下デバフを100%除外するため、
        //   「防御(力)...〇〇%(上昇|増加|増)」の形で上昇/増加する防御バフのみを厳密抽出！
        var tMult = 0, gMult = 0;
        var mBoth = normDesc.match(/(?:全兵士|全ての兵士|すべての兵士|兵士|全軍|全兵科|全拠点|全兵|[^\s、。]+兵)[、，・,\/\s]+(?:[^\s、。]+科)?武将.*?防御(?:力)?(?:全て)?[がをのは]?([0-9\.]+)[%％]\s*(?:上昇|増加|増)/);
        if (mBoth && isTroopComp) {
            tMult = floatVal(mBoth[1]);
            gMult = tMult;
        } else {
            var mGenOnly = normDesc.match(/(?:所属拠点が同一の武将|全武将|[^\s、。・]*?科武将|武将).*?防御(?:力)?(?:全て)?[がをのは]?([0-9\.]+)[%％]\s*(?:上昇|増加|増)/);
            if (mGenOnly && !isTroopComp) {
                gMult = floatVal(mGenOnly[1]);
            } else if (isTroopComp) {
                var mTr = normDesc.match(/防御(?:力)?(?:全て)?[がをのは]?([0-9\.]+)[%％]\s*(?:上昇|増加|増)/);
                if (mTr) {
                    tMult = floatVal(mTr[1]);
                    if (normDesc.indexOf('武将') !== -1) gMult = tMult;
                }
            }
        }

        res.tMult = tMult * wMult;
        res.gMult = gMult * wMult;
        defSkillCache[cacheKey] = res;
        return res;
    }

    function buildDefGeneralAdjutantCand(gCard, targetTroopData, weatherObj, isExactDefendedBaseSlot) {
        if (!gCard || SharedDB.isHaBusho(gCard) || SharedDB.isMirrorCard(gCard.name)) return null;
        var skills = gCard.skills || [];
        if (skills.length === 0 || !skills[0]) return null;
        var s0 = skills[0];
        var sName = String(s0.name || '').trim();
        if (!sName || sName.indexOf('覚:') === 0 || sName.indexOf('副覚:') === 0 || isDuelSkill(s0)) return null;

        if (sName.indexOf('攻:') === 0 || sName.indexOf('副攻:') === 0) return null;

        var p0 = parseDefSkill(s0, targetTroopData, weatherObj);
        if (!p0.isDefSkill || !p0.isPassive || p0.tMult <= 0) return null;

        if (!isExactDefendedBaseSlot && p0.mustBeSameBase) return null;

        var tVal = SharedDB.safeNum(p0.tMult, 0);
        var gVal = SharedDB.safeNum(p0.gMult, 0);

        var cleanSName = sName.replace(/^(?:攻防|攻|防|変|副攻|副防|副変):/, '').replace(/LV[0-9]+$/i, '');
        var badge = '[副]' + cleanSName + ' 防+' + SharedDB.formatBuffNum(tVal) + '%';

        return {
            card: gCard,
            uniqueId: gCard.uniqueId,
            cardNo: gCard.cardNo,
            genTMult: tVal,
            genGMult: gVal,
            label: badge,
            genStats: { defT: tVal, defG: gVal }
        };
    }

    function evaluateCardDef(card, targetTroopData, weatherObj, excludeSubSkills) {
        var empty = {
            tMult: 0, gMult: 0, firstTMult: 0, firstGMult: 0,
            perSameCountryMult: 0, reqCountry: null, dmgReduce: 0,
            isManualNaisei: false, isPassive: false, isGuard: false, mustBeSameBase: true
        };
        var skills = (card && card.skills) || [];
        if (skills.length === 0) return empty;

        var firstSkill = skills[0];
        var p0 = parseDefSkill(firstSkill, targetTroopData, weatherObj);
        if (!p0.isDefSkill) return empty;

        var passiveTMult = 0, passiveGMult = 0;
        var passivePerCountry = 0, reqCountry = p0.reqCountry;
        var passiveDmgReduce = 0;
        var activeCandidates = [];
        var isGuardCard = p0.isGuardDeck;
        var mustBeSameBaseCard = false;
        var isHa = SharedDB.isHaBusho(card);
        var kMultSelf = getDefKakuseiMult(card);

        for (var idx = 0; idx < skills.length; idx++) {
            var s = skills[idx];
            if (!s || typeof s !== 'object') continue;
            var sName = String(s.name || '').trim();

            if (sName.indexOf('覚:') === 0 || sName.indexOf('副覚:') === 0 || sName.indexOf('覚醒') !== -1) continue;
            if (isDuelSkill(s)) continue;

            var isFromAdj = (sName.indexOf('副:') === 0 || sName.indexOf('副変:') === 0 || sName.indexOf('副攻:') === 0 || sName.indexOf('副防:') === 0 || sName.indexOf('副ﾃﾞｭｴﾙ:') === 0);
            if (excludeSubSkills && !isHa && isFromAdj) continue;

            var parsed = parseDefSkill(s, targetTroopData, weatherObj);

            var isSelfMirror = (idx > 0) && !isFromAdj && (
                sName.indexOf('変:') === 0 ||
                sName.indexOf('主将の') !== -1 ||
                sName.indexOf('明鑑') !== -1 ||
                sName.indexOf('王春の') !== -1 ||
                (sName.indexOf('明鏡') !== -1 && sName.indexOf('副将の') === -1) ||
                (isHa && sName.indexOf('副変:') === 0)
            );

            if (isSelfMirror) {
                if (parsed.tMult <= 0 && parsed.gMult <= 0 && parsed.perSameCountryMult <= 0 && (p0.tMult > 0 || p0.gMult > 0 || p0.perSameCountryMult > 0)) {
                    var rate = getSelfMirrorCopyRatio(s);
                    passiveTMult += (p0.tMult / kMultSelf) * rate;
                    passiveGMult += (p0.gMult / kMultSelf) * rate;
                    passivePerCountry += (p0.perSameCountryMult / kMultSelf) * rate;
                } else {
                    passiveTMult += parsed.tMult;
                    passiveGMult += parsed.gMult;
                    passivePerCountry += parsed.perSameCountryMult;
                }
                if (p0.mustBeSameBase || parsed.mustBeSameBase) mustBeSameBaseCard = true;
                continue;
            }

            if (parsed.tMult > 0 || parsed.gMult > 0 || parsed.perSameCountryMult > 0 || parsed.dmgReduce > 0) {
                if (parsed.isGuardDeck) isGuardCard = true;
                if (parsed.reqCountry) reqCountry = parsed.reqCountry;
                if (parsed.isPassive || isFromAdj) {
                    if (!isFromAdj || parsed.isPassive) {
                        passiveTMult += parsed.tMult;
                        passiveGMult += parsed.gMult;
                        passivePerCountry += parsed.perSameCountryMult;
                        passiveDmgReduce += parsed.dmgReduce;
                        if (parsed.mustBeSameBase) mustBeSameBaseCard = true;
                    }
                } else {
                    activeCandidates.push(parsed);
                }
            }
        }

        var activeTMult = 0, activeGMult = 0;
        var activePerCountry = 0, activeDmgReduce = 0;
        var isManualNaisei = false;

        if (activeCandidates.length > 0) {
            if (isHa) {
                for (var ai = 0; ai < activeCandidates.length; ai++) {
                    var ac = activeCandidates[ai];
                    activeTMult += ac.tMult;
                    activeGMult += ac.gMult;
                    activePerCountry += ac.perSameCountryMult;
                    activeDmgReduce += ac.dmgReduce;
                    if (ac.isManualNaisei) isManualNaisei = true;
                    if (ac.mustBeSameBase) mustBeSameBaseCard = true;
                }
            } else {
                activeCandidates.sort(function(a, b) {
                    var scA = a.tMult * 100 + a.gMult + a.perSameCountryMult * 500 + a.dmgReduce * 1000;
                    var scB = b.tMult * 100 + b.gMult + b.perSameCountryMult * 500 + b.dmgReduce * 1000;
                    return scB - scA;
                });
                var topAc = activeCandidates[0];
                activeTMult = topAc.tMult;
                activeGMult = topAc.gMult;
                activePerCountry = topAc.perSameCountryMult;
                activeDmgReduce = topAc.dmgReduce;
                isManualNaisei = Boolean(topAc.isManualNaisei);
                if (topAc.mustBeSameBase) mustBeSameBaseCard = true;
            }
        }

        var tMultTotal = passiveTMult + activeTMult;
        var gMultTotal = passiveGMult + activeGMult;
        var perCountryTotal = passivePerCountry + activePerCountry;
        var dmgReduceTotal = passiveDmgReduce + activeDmgReduce;

        if (tMultTotal <= 0 && perCountryTotal <= 0 && dmgReduceTotal <= 0) return empty;

        return {
            tMult: tMultTotal,
            gMult: gMultTotal,
            firstTMult: p0.tMult,
            firstGMult: p0.gMult,
            perSameCountryMult: perCountryTotal,
            reqCountry: reqCountry,
            dmgReduce: dmgReduceTotal,
            isManualNaisei: isManualNaisei,
            isPassive: !isManualNaisei,
            isGuard: isGuardCard,
            mustBeSameBase: mustBeSameBaseCard
        };
    }

    function getBestWeatherForCardDef(card, targetTroopData, excludeSubSkills) {
        var weathers = ['SUN', 'CLOUD', 'RAIN', 'SNOW'];
        var bestW = 'SUN';
        var maxEval = null;
        var maxScore = -1;
        for (var i = 0; i < weathers.length; i++) {
            var w = weathers[i];
            var ev = evaluateCardDef(card, targetTroopData, w, excludeSubSkills);
            var sc = ev.tMult * 100 + ev.perSameCountryMult * 500 + ev.dmgReduce * 1000;
            if (sc > maxScore) {
                maxScore = sc;
                maxEval = ev;
                bestW = w;
            }
        }
        return { bestWeather: bestW, eval: maxEval };
    }

    // =========================================================================
    // 2次元ナップサックDP：コスト上限(costLimit) と 内政スロット上限(maxNaiseiSlots)
    // および 拠点縛り内政上限(maxBoundNaiseiSlots) を同時に満たしながら総合バフを最大化！
    // → これにより「全拠点有効の1コスパッシブを拠点＋側へ自動移動し、本拠の30C枠に
    //   拠点縛り武将を新たに設置して防御力を最大化する」配分を厳密に自動計算する！
    // =========================================================================
    function solveDeckKnapsackWithNaiseiLimits(costLimit, maxNaiseiSlots, maxBoundNaiseiSlots, candidates) {
        var maxW = Math.max(0, Math.round(costLimit * 2));
        var maxN = Math.max(0, maxNaiseiSlots);
        var maxB = Math.max(0, maxBoundNaiseiSlots);
        var NEG = -1e15;

        var dp = new Array(maxW + 1);
        var pick = new Array(maxW + 1);
        for (var w = 0; w <= maxW; w++) {
            dp[w] = new Array(maxN + 1);
            pick[w] = new Array(maxN + 1);
            for (var n = 0; n <= maxN; n++) {
                dp[w][n] = new Array(maxB + 1);
                pick[w][n] = new Array(maxB + 1);
                for (var b = 0; b <= maxB; b++) {
                    dp[w][n][b] = NEG;
                    pick[w][n][b] = [];
                }
            }
        }
        dp[0][0][0] = 0;

        for (var i = 0; i < candidates.length; i++) {
            var it = candidates[i];
            var iw = Math.round(SharedDB.safeNum(it.effectiveCost, 0) * 2);
            if (iw <= 0 || iw > maxW) continue;
            var dn = it.isManualNaisei ? 1 : 0;
            var db = (it.isManualNaisei && it.isBound) ? 1 : 0;
            if (dn > maxN || db > maxB) continue;

            for (var c = maxW; c >= iw; c--) {
                for (var n = maxN; n >= dn; n--) {
                    for (var b = maxB; b >= db; b--) {
                        var prev = dp[c - iw][n - dn][b - db];
                        if (prev > NEG / 2) {
                            var candVal = prev + SharedDB.safeNum(it.tMult, 0);
                            if (candVal > dp[c][n][b]) {
                                dp[c][n][b] = candVal;
                                pick[c][n][b] = pick[c - iw][n - dn][b - db].concat([it]);
                            }
                        }
                    }
                }
            }
        }

        var bestVal = -1;
        var bestPicked = [];
        for (var c2 = 0; c2 <= maxW; c2++) {
            for (var n2 = 0; n2 <= maxN; n2++) {
                for (var b2 = 0; b2 <= maxB; b2++) {
                    if (dp[c2][n2][b2] > bestVal) {
                        bestVal = dp[c2][n2][b2];
                        bestPicked = pick[c2][n2][b2];
                    }
                }
            }
        }
        return bestPicked;
    }

    function fastUpdateDefMultiplier() {
        if (!currentDefSetup) { run(false); return; }
        var buff10Mult = isDefBuff10 ? 1.1 : 1.0;
        var matchupMult = SharedDB.safeNum(defMatchupMult, 1.0);
        var elGo = document.getElementById('optDefGoBuff');
        var goBuff = isDefGoEnabled ? SharedDB.safeNum(elGo && elGo.value, defGoBuffValue) : 0;

        currentDefSetup.buff10Multiplier = buff10Mult;
        currentDefSetup.matchupMultiplier = matchupMult;
        currentDefSetup.goBuff = goBuff;

        var finalTroopMult = currentDefSetup.pureTroopMult + goBuff;
        var finalGenMult = currentDefSetup.pureGenMult + goBuff;
        var troopDef = Math.floor(currentDefSetup.targetTroopData.defense * currentDefSetup.troopCount * (1 + finalTroopMult / 100));
        var genDef = Math.floor(currentDefSetup.totalDefenderBaseDef * (1 + finalGenMult / 100));
        var baseTotalDef = troopDef + genDef;
        var finalTotalDef = Math.floor(baseTotalDef * matchupMult * buff10Mult);

        currentDefSetup.troopDefense = troopDef;
        currentDefSetup.genDefense = genDef;
        currentDefSetup.finalTroopMult = finalTroopMult;
        currentDefSetup.finalGenMult = finalGenMult;
        currentDefSetup.baseTotalDefense = baseTotalDef;
        currentDefSetup.finalTotalDefense = finalTotalDef;
        render(currentDefSetup);
    }

    function run(shouldAutoWeather) {
        try {
            var uCards = AppCards.userCards;
            if (!uCards || uCards.length === 0) return;
            AppCards.setStatusLog("兵士防御最適化計算中... (" + uCards.length + "枚)");

            var elTargetBase = document.getElementById('defTargetBase');
            var elTroop = document.getElementById('defTroop');
            var elTroopCount = document.getElementById('defTroopCount');
            var elCost = document.getElementById('defCostDist');
            var elHonkyoSlots = document.getElementById('defHonkyoNaiseiSlots');
            var elKyotenSlots = document.getElementById('defKyotenNaiseiSlots');
            if (!elTargetBase || !elTroop || !elTroopCount || !elCost) return;

            var targetBase = elTargetBase.value;
            var isHonkyoDef = (targetBase === 'HONKYO');
            var targetTroopData = SharedDB.DEF_TROOP_DATA[elTroop.value];
            var troopCount = parseInt(elTroopCount.value) || 0;
            var costDist = elCost.value;
            var honkyoLimit = costDist === '30-25' ? 30.0 : 25.0;
            var kyotenLimit = costDist === '30-25' ? 25.0 : 30.0;

            var maxHonkyoNaisei = Math.max(0, Math.min(2, parseInt(elHonkyoSlots ? elHonkyoSlots.value : '2') || 0));
            var maxKyotenNaisei = Math.max(0, Math.min(9, parseInt(elKyotenSlots ? elKyotenSlots.value : '9') || 0));

            var isReassignMode = (defAdjutantMode !== 'CURRENT');

            var validCards = uCards.filter(function(c) {
                if (AppCards.excludedCardIds.has(c.uniqueId)) return false;
                if (!isReassignMode && c.isAdjutant) return false;
                return true;
            });

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
                        return !SharedDB.isHaBusho(c) &&
                            String(c.rarity || '').toUpperCase() === 'SL' &&
                            SharedDB.safeNum(c.maxFukushoCost, 0) > 0 &&
                            origC > 1.0 &&
                            evaluateCardDef(c, targetTroopData, 'SUN', true).tMult > 0;
                    });
                    teisenCandidateList.sort(function(a, b) {
                        var origA = SharedDB.safeNum(a.originalCost !== undefined ? a.originalCost : a.cost, 4.5);
                        var origB = SharedDB.safeNum(b.originalCost !== undefined ? b.originalCost : b.cost, 4.5);
                        if (origB !== origA) return origB - origA;
                        return evaluateCardDef(b, targetTroopData, 'SUN', true).tMult - evaluateCardDef(a, targetTroopData, 'SUN', true).tMult;
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

            var frontGlobalPool = [];
            var frontBoundPool = [];
            var guardBoundPool = [];
            var guardGlobalPool = [];

            for (var i = 0; i < validCards.length; i++) {
                var c = validCards[i];
                if (usedTeisenCardIds.has(c.uniqueId)) continue;
                var bestEv = getBestWeatherForCardDef(c, targetTroopData, isReassignMode);
                var ev = bestEv.eval;
                if (!ev || (ev.tMult <= 0 && ev.perSameCountryMult <= 0 && ev.dmgReduce <= 0)) continue;

                var effCost = effectiveCostMap[c.uniqueId];
                var estValue = ev.tMult + (ev.perSameCountryMult * 4) + (ev.dmgReduce * 15);
                var item = {
                    card: c,
                    effectiveCost: effCost,
                    cost: effCost,
                    tMult: estValue,
                    rawTMult: ev.tMult,
                    rawGMult: ev.gMult,
                    firstTMult: ev.firstTMult,
                    firstGMult: ev.firstGMult,
                    perSameCountryMult: ev.perSameCountryMult,
                    reqCountry: ev.reqCountry,
                    dmgReduce: ev.dmgReduce,
                    isBound: ev.mustBeSameBase,
                    isManualNaisei: ev.isManualNaisei,
                    isGuard: ev.isGuard,
                    weather: bestEv.bestWeather
                };

                if (ev.isGuard) {
                    if (ev.mustBeSameBase) guardBoundPool.push(item);
                    else guardGlobalPool.push(item);
                } else {
                    if (ev.mustBeSameBase) frontBoundPool.push(item);
                    else frontGlobalPool.push(item);
                }
            }

            var dedupByCardNo = function(pool, usedNosSet) {
                var bestMap = Object.create(null);
                for (var idx = 0; idx < pool.length; idx++) {
                    var it = pool[idx];
                    var cNo = it.card.cardNo || it.card.uniqueId;
                    if (usedNosSet && usedNosSet.has(cNo)) continue;
                    if (!bestMap[cNo] || it.tMult > bestMap[cNo].tMult) bestMap[cNo] = it;
                }
                return Object.values(bestMap);
            };

            var usedNos = new Set();
            var pickedNanbanTaishu = [];

            // 1. 南蛮モード時は、まず全パッシブ候補から高コスト・高バフパッシブを最大5枠「南蛮太守」へ優先配置
            if (isNanbanMode) {
                var allPassiveForNanban = dedupByCardNo(
                    frontBoundPool.concat(frontGlobalPool).filter(function(x) { return !x.isManualNaisei; }),
                    usedNos
                );
                var expandedCap = honkyoLimit + kyotenLimit + 22.5;
                var eliteSelection = SharedDB.solveKnapsackDP(expandedCap, allPassiveForNanban).picked;
                if (!eliteSelection || eliteSelection.length === 0) {
                    eliteSelection = allPassiveForNanban.slice();
                }

                eliteSelection.sort(function(a, b) {
                    if (Math.abs(b.effectiveCost - a.effectiveCost) > 1e-6) return b.effectiveCost - a.effectiveCost;
                    if (b.isBound !== a.isBound) return b.isBound ? 1 : -1;
                    return b.tMult - a.tMult;
                });

                for (var ni = 0; ni < eliteSelection.length && pickedNanbanTaishu.length < 5; ni++) {
                    var nIt = eliteSelection[ni];
                    var nNo = nIt.card.cardNo || nIt.card.uniqueId;
                    if (usedNos.has(nNo)) continue;
                    pickedNanbanTaishu.push(nIt);
                    usedNos.add(nNo);
                }

                if (pickedNanbanTaishu.length < 5) {
                    var remPoolN = allPassiveForNanban.filter(function(x) {
                        return !usedNos.has(x.card.cardNo || x.card.uniqueId);
                    }).sort(function(a, b) {
                        if (Math.abs(b.effectiveCost - a.effectiveCost) > 1e-6) return b.effectiveCost - a.effectiveCost;
                        return b.tMult - a.tMult;
                    });
                    for (var ni2 = 0; ni2 < remPoolN.length && pickedNanbanTaishu.length < 5; ni2++) {
                        var nIt2 = remPoolN[ni2];
                        var nNo2 = nIt2.card.cardNo || nIt2.card.uniqueId;
                        pickedNanbanTaishu.push(nIt2);
                        usedNos.add(nNo2);
                    }
                }
            }

            // 2. 本拠(30C) と 拠点＋(25C) の 2拠点同時最適配分（Knapsack DP）：
            //    ・防衛対象外側の拠点（本拠防衛なら「拠点＋」、拠点＋防衛なら「本拠」）には「全拠点有効カード」のみ効くため、
            //      まずそちらのコスト枠に「全拠点有効カード（内政＋パッシブ）」を最大限詰め込む！
            //    ・これにより防衛対象側のコスト枠が空くので、防衛対象拠点でしか効かない「拠点縛りカード（内政最大1枠＋パッシブ）」を
            //      最大限設置して総合防御力を最大化する！
            var hManualSlots = [];
            var kManualSlots = [];
            var pickedHPassives = [];
            var pickedKPassives = [];

            if (isHonkyoDef) {
                // Step A: 拠点＋(kyotenLimit) に「全拠点有効（内政最大maxKyotenNaisei枠＋パッシブ）」を最適充填
                var availGlobalsForK = dedupByCardNo(frontGlobalPool, usedNos);
                var kPickedAll = solveDeckKnapsackWithNaiseiLimits(kyotenLimit, maxKyotenNaisei, 0, availGlobalsForK);
                kPickedAll.forEach(function(it) {
                    usedNos.add(it.card.cardNo || it.card.uniqueId);
                    if (it.isManualNaisei) kManualSlots.push(it);
                    else pickedKPassives.push(it);
                });

                // Step B: 本拠(honkyoLimit) に「残った全拠点有効 ＋ 本拠の拠点縛り（内政最大1枠＋パッシブ）」を最適充填
                var availForH = dedupByCardNo(frontBoundPool.concat(frontGlobalPool), usedNos);
                var hPickedAll = solveDeckKnapsackWithNaiseiLimits(honkyoLimit, maxHonkyoNaisei, Math.min(1, maxHonkyoNaisei), availForH);
                hPickedAll.forEach(function(it) {
                    usedNos.add(it.card.cardNo || it.card.uniqueId);
                    if (it.isManualNaisei) hManualSlots.push(it);
                    else pickedHPassives.push(it);
                });
            } else {
                // 拠点＋防衛時：
                // Step A: 本拠(honkyoLimit) に「全拠点有効（内政最大maxHonkyoNaisei枠＋パッシブ）」を最適充填
                var availGlobalsForH = dedupByCardNo(frontGlobalPool, usedNos);
                var hPickedAll2 = solveDeckKnapsackWithNaiseiLimits(honkyoLimit, maxHonkyoNaisei, 0, availGlobalsForH);
                hPickedAll2.forEach(function(it) {
                    usedNos.add(it.card.cardNo || it.card.uniqueId);
                    if (it.isManualNaisei) hManualSlots.push(it);
                    else pickedHPassives.push(it);
                });

                // Step B: 拠点＋(kyotenLimit) に「残った全拠点有効 ＋ 拠点の拠点縛り（内政最大1枠＋パッシブ）」を最適充填
                var availForK = dedupByCardNo(frontBoundPool.concat(frontGlobalPool), usedNos);
                var kPickedAll2 = solveDeckKnapsackWithNaiseiLimits(kyotenLimit, maxKyotenNaisei, Math.min(1, maxKyotenNaisei), availForK);
                kPickedAll2.forEach(function(it) {
                    usedNos.add(it.card.cardNo || it.card.uniqueId);
                    if (it.isManualNaisei) kManualSlots.push(it);
                    else pickedKPassives.push(it);
                });
            }

            // 拠点縛り内政官がある場合は必ず防衛拠点スロット（h0 または k0）に配置されるようソート
            hManualSlots.sort(function(a, b) {
                if (a.isBound !== b.isBound) return a.isBound ? -1 : 1;
                return b.tMult - a.tMult;
            });
            kManualSlots.sort(function(a, b) {
                if (a.isBound !== b.isBound) return a.isBound ? -1 : 1;
                return b.tMult - a.tMult;
            });
            pickedHPassives.sort(function(a, b) { return b.tMult - a.tMult; });
            pickedKPassives.sort(function(a, b) { return b.tMult - a.tMult; });

            var pickedHGuards = [];
            var pickedKGuards = [];
            if (isHonkyoDef) {
                var hgPool = dedupByCardNo(guardBoundPool.concat(guardGlobalPool), usedNos);
                pickedHGuards = SharedDB.solveKnapsackDP(honkyoLimit, hgPool).picked;
                pickedHGuards.forEach(function(g) { usedNos.add(g.card.cardNo || g.card.uniqueId); });

                var kgPool = dedupByCardNo(guardGlobalPool, usedNos);
                pickedKGuards = SharedDB.solveKnapsackDP(kyotenLimit, kgPool).picked;
                pickedKGuards.forEach(function(g) { usedNos.add(g.card.cardNo || g.card.uniqueId); });
            } else {
                var kgPool2 = dedupByCardNo(guardBoundPool.concat(guardGlobalPool), usedNos);
                pickedKGuards = SharedDB.solveKnapsackDP(kyotenLimit, kgPool2).picked;
                pickedKGuards.forEach(function(g) { usedNos.add(g.card.cardNo || g.card.uniqueId); });

                var hgPool2 = dedupByCardNo(guardGlobalPool, usedNos);
                pickedHGuards = SharedDB.solveKnapsackDP(honkyoLimit, hgPool2).picked;
                pickedHGuards.forEach(function(g) { usedNos.add(g.card.cardNo || g.card.uniqueId); });
            }

            var activeSlots = {};
            for (var hi2 = 0; hi2 < hManualSlots.length; hi2++) activeSlots['h' + hi2] = hManualSlots[hi2];
            for (var ki2 = 0; ki2 < kManualSlots.length; ki2++) activeSlots['k' + ki2] = kManualSlots[ki2];

            if (shouldAutoWeather) {
                Object.keys(activeSlots).forEach(function(sId) {
                    if (activeSlots[sId].weather) AppCards.slotWeathers[sId] = activeSlots[sId].weather;
                });
            }

            var allActiveItems = [];
            Object.keys(activeSlots).forEach(function(sId) {
                var it = activeSlots[sId];
                var curW = shouldAutoWeather ? it.weather : (AppCards.slotWeathers[sId] || it.weather || 'SUN');
                var reEv = evaluateCardDef(it.card, targetTroopData, curW, isReassignMode);
                it.rawTMult = reEv.tMult;
                it.rawGMult = reEv.gMult;
                it.firstTMult = reEv.firstTMult;
                it.firstGMult = reEv.firstGMult;
                it.perSameCountryMult = reEv.perSameCountryMult;
                it.dmgReduce = reEv.dmgReduce;
                it.isExactDefendedBaseSlot = isHonkyoDef ? (sId === 'h0') : (sId === 'k0');
                allActiveItems.push(it);
            });

            pickedNanbanTaishu.forEach(function(x) { x.isExactDefendedBaseSlot = true; });
            pickedHPassives.forEach(function(x) { x.isExactDefendedBaseSlot = isHonkyoDef; });
            pickedKPassives.forEach(function(x) { x.isExactDefendedBaseSlot = !isHonkyoDef; });
            pickedHGuards.forEach(function(x) { x.isExactDefendedBaseSlot = isHonkyoDef; });
            pickedKGuards.forEach(function(x) { x.isExactDefendedBaseSlot = !isHonkyoDef; });

            var allSelectedItems = pickedNanbanTaishu.concat(allActiveItems, pickedHPassives, pickedKPassives, pickedHGuards, pickedKGuards);

            var assignedAdjutantsMap = (defAdjutantMode === 'CURRENT') ? null : Object.create(null);
            var adjutantAddedTroopBuffMap = Object.create(null);
            var adjutantAddedGenBuffMap = Object.create(null);
            var usedAdjutantCostMap = Object.create(null);
            var additionalAdjutantTroopBuff = 0;
            var additionalAdjutantGenBuff = 0;
            var totalDefenderAdjDefBonus = 0;

            var allDeckUsedIds = new Set();
            var allDeckUsedNos = new Set();
            allSelectedItems.forEach(function(x) {
                allDeckUsedIds.add(x.card.uniqueId);
                allDeckUsedNos.add(x.card.cardNo || x.card.uniqueId);
            });

            var masterList = [];
            allSelectedItems.forEach(function(it) {
                if (it.card && !SharedDB.isHaBusho(it.card) && SharedDB.safeNum(it.card.maxFukushoCost, 0) > 0) {
                    var kMult = getDefKakuseiMult(it.card);
                    var rWeight = (SharedDB.RARITY_ORDER[String(it.card.rarity || 'SL').toUpperCase()] || 1) * 10000000;
                    masterList.push({
                        card: it.card,
                        isExactDefendedBaseSlot: Boolean(it.isExactDefendedBaseSlot),
                        maxCost: SharedDB.safeNum(it.card.maxFukushoCost, 4.5),
                        baseCopyTVal: SharedDB.safeNum(it.firstTMult, 0) / kMult,
                        baseCopyGVal: SharedDB.safeNum(it.firstGMult, 0) / kMult,
                        priority: rWeight + SharedDB.safeNum(it.firstTMult, 0) * 1000 + SharedDB.safeNum(it.firstGMult, 0) * 10
                    });
                }
            });
            masterList.sort(function(a, b) { return b.priority - a.priority; });

            var usedMirrorIds = new Set();
            var usedMirrorNos = new Set();

            masterList.forEach(function(master) {
                var mCard = master.card;
                adjutantAddedTroopBuffMap[mCard.uniqueId] = 0;
                adjutantAddedGenBuffMap[mCard.uniqueId] = 0;
                usedAdjutantCostMap[mCard.uniqueId] = 0;
                var existing = [];
                if ((defAdjutantMode === 'CURRENT' || defAdjutantMode === 'FILL_EMPTY') && Array.isArray(mCard.fukusho)) {
                    mCard.fukusho.forEach(function(rawFk) {
                        var inf = SharedDB.getMirrorSkillInfo(rawFk);
                        var st = SharedDB.getAdjutantStatusEffect(rawFk, inf);
                        var fkCost = SharedDB.safeNum(rawFk.cost, 0);
                        usedAdjutantCostMap[mCard.uniqueId] += fkCost;
                        totalDefenderAdjDefBonus += st.defBonus;

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
                            var addT = master.baseCopyTVal * (rate / 100);
                            var addG = master.baseCopyGVal * (rate / 100);
                            additionalAdjutantTroopBuff += addT;
                            additionalAdjutantGenBuff += addG;
                            adjutantAddedTroopBuffMap[mCard.uniqueId] += addT;
                            adjutantAddedGenBuffMap[mCard.uniqueId] += addG;
                        } else {
                            existing.push(rawFk);
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

                var troopDefWeight = Math.max(1000, (targetTroopData.defense * troopCount) / 100);

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
                            totalDefenderAdjDefBonus += tSt.defBonus;

                            currentAssigned.push({
                                name: tCard.name || '副将の帝仙鏡',
                                cardNo: tCard.cardNo || '',
                                imageSrc: tCard.imageSrc || (tCard.cardNo ? 'https://3gokushi.jp/img/card/card_' + tCard.cardNo + '.jpg' : ''),
                                rarity: 'SL',
                                cost: tCost,
                                baseDefense: SharedDB.safeNum(tCard.baseDefense, 0),
                                label: (tSt.isGo ? '[護]' : tSt.isBu ? '[武]' : '') + '帝仙鏡 100% [主将C1化]',
                                copyRate: 100,
                                uniqueId: tWrapper.uniqueId,
                                info: { type: 'senkyo', rate: 100 }
                            });
                            var addTT = master.baseCopyTVal * 1.0;
                            var addGT = master.baseCopyGVal * 1.0;
                            additionalAdjutantTroopBuff += addTT;
                            additionalAdjutantGenBuff += addGT;
                            adjutantAddedTroopBuffMap[mCard.uniqueId] += addTT;
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
                        var gCand = buildDefGeneralAdjutantCand(gc, targetTroopData, 'SUN', master.isExactDefendedBaseSlot);
                        if (gCand) validGenCands.push(gCand);
                    }

                    var bestCombo = SharedDB.findBestAdjutantCombo(mCard, unusedForMaster, currentAssigned, usedAdjutantCostMap[mCard.uniqueId], {
                        baseCopyT: master.baseCopyTVal,
                        baseCopyG: master.baseCopyGVal,
                        wTroop: troopDefWeight,
                        wGen: SharedDB.safeNum(mCard.baseDefense !== undefined ? mCard.baseDefense : mCard.defense, 1000) / 100,
                        wDef: 50,
                        generalPool: validGenCands
                    });

                    bestCombo.forEach(function(chosenFk) {
                        usedMirrorIds.add(chosenFk.uniqueId);
                        usedMirrorNos.add(chosenFk.cardNo);
                        usedAdjutantCostMap[mCard.uniqueId] += chosenFk.cost;
                        totalDefenderAdjDefBonus += SharedDB.safeNum(chosenFk.defBonus, 0);
                        currentAssigned.push(chosenFk);
                        if (chosenFk.isGeneralSkill && chosenFk.genStats) {
                            var gT = SharedDB.safeNum(chosenFk.genStats.defT, 0);
                            var gG = SharedDB.safeNum(chosenFk.genStats.defG, 0);
                            additionalAdjutantTroopBuff += gT;
                            additionalAdjutantGenBuff += gG;
                            adjutantAddedTroopBuffMap[mCard.uniqueId] += gT;
                            adjutantAddedGenBuffMap[mCard.uniqueId] += gG;
                        } else {
                            var addT = master.baseCopyTVal * (chosenFk.copyRate / 100);
                            var addG = master.baseCopyGVal * (chosenFk.copyRate / 100);
                            additionalAdjutantTroopBuff += addT;
                            additionalAdjutantGenBuff += addG;
                            adjutantAddedTroopBuffMap[mCard.uniqueId] += addT;
                            adjutantAddedGenBuffMap[mCard.uniqueId] += addG;
                        }
                    });
                });
            }

            var targetDeckItems = (isHonkyoDef ? hManualSlots.concat(pickedHPassives) : kManualSlots.concat(pickedKPassives)).concat(pickedNanbanTaishu);
            var countryCounts = Object.create(null);
            targetDeckItems.forEach(function(it) {
                var cntry = it.card.country || '他';
                countryCounts[cntry] = (countryCounts[cntry] || 0) + 1;
            });

            var pureTroopMult = additionalAdjutantTroopBuff;
            var pureGenMult = additionalAdjutantGenBuff;
            var dmgReduceSum = 0;

            allSelectedItems.forEach(function(it) {
                pureTroopMult += SharedDB.safeNum(it.rawTMult, 0);
                pureGenMult += SharedDB.safeNum(it.rawGMult, 0);
                if (it.perSameCountryMult > 0 && it.reqCountry) {
                    var sameCnt = countryCounts[it.reqCountry] || 0;
                    var bonusSame = it.perSameCountryMult * sameCnt;
                    pureTroopMult += bonusSame;
                    pureGenMult += bonusSame;
                }
                dmgReduceSum += SharedDB.safeNum(it.dmgReduce, 0);
            });

            var defenderBaseDefSum = targetDeckItems.reduce(function(s, it) {
                return s + SharedDB.safeNum(it.card.baseDefense !== undefined ? it.card.baseDefense : it.card.defense, 1000);
            }, 0) + totalDefenderAdjDefBonus;

            var elGo = document.getElementById('optDefGoBuff');
            var currentGo = isDefGoEnabled ? SharedDB.safeNum(elGo && elGo.value, defGoBuffValue) : 0;
            var finalTroopMult = pureTroopMult + currentGo;
            var finalGenMult = pureGenMult + currentGo;

            var troopDefense = Math.floor(targetTroopData.defense * troopCount * (1 + finalTroopMult / 100));
            var genDefense = Math.floor(defenderBaseDefSum * (1 + finalGenMult / 100));
            var baseTotalDefense = troopDefense + genDefense;
            var matchupMult = SharedDB.safeNum(defMatchupMult, 1.0);
            var buff10Mult = isDefBuff10 ? 1.1 : 1.0;
            var finalTotalDefense = Math.floor(baseTotalDefense * matchupMult * buff10Mult);

            var honkyoTotalCost = hManualSlots.reduce(function(s, x) { return s + x.effectiveCost; }, 0) +
                                  pickedHPassives.reduce(function(s, x) { return s + x.effectiveCost; }, 0);
            var kyotenTotalCost = kManualSlots.reduce(function(s, x) { return s + x.effectiveCost; }, 0) +
                                  pickedKPassives.reduce(function(s, x) { return s + x.effectiveCost; }, 0);
            var nanbanSavedCost = pickedNanbanTaishu.reduce(function(s, x) { return s + x.effectiveCost; }, 0);

            var setup = {
                isNanbanMode: isNanbanMode,
                pickedNanbanTaishu: pickedNanbanTaishu,
                nanbanSavedCost: nanbanSavedCost,
                targetBase: targetBase,
                targetTroopData: targetTroopData,
                troopCount: troopCount,
                honkyoLimit: honkyoLimit,
                kyotenLimit: kyotenLimit,
                maxHonkyoNaisei: maxHonkyoNaisei,
                maxKyotenNaisei: maxKyotenNaisei,
                honkyoCost: honkyoTotalCost,
                kyotenCost: kyotenTotalCost,
                honkyoGuardCost: pickedHGuards.reduce(function(s, x) { return s + x.effectiveCost; }, 0),
                kyotenGuardCost: pickedKGuards.reduce(function(s, x) { return s + x.effectiveCost; }, 0),
                chosenActiveSlots: activeSlots,
                chosenBasePassives: pickedHPassives,
                chosenSubPassives: pickedKPassives,
                chosenBaseGuards: pickedHGuards,
                chosenSubGuards: pickedKGuards,
                assignedAdjutantsMap: assignedAdjutantsMap,
                adjutantAddedTroopBuffMap: adjutantAddedTroopBuffMap,
                adjutantAddedGenBuffMap: adjutantAddedGenBuffMap,
                effectiveCostMap: effectiveCostMap,
                totalDefenderBaseDef: defenderBaseDefSum,
                pureTroopMult: pureTroopMult,
                pureGenMult: pureGenMult,
                finalTroopMult: finalTroopMult,
                finalGenMult: finalGenMult,
                goBuff: currentGo,
                dmgReduceSum: Math.min(90, dmgReduceSum),
                troopDefense: troopDefense,
                genDefense: genDefense,
                baseTotalDefense: baseTotalDefense,
                matchupMultiplier: matchupMult,
                buff10Multiplier: buff10Mult,
                finalTotalDefense: finalTotalDefense
            };

            currentDefSetup = setup;
            render(setup);
            var modeTag = isNanbanMode ? ("南蛮モード・太守" + pickedNanbanTaishu.length + "枠 / 節約" + nanbanSavedCost.toFixed(1) + "C") : "通常防衛モード";
            AppCards.setStatusLog("兵士防御最適化完了 (" + modeTag + "): 総合防御力 " + finalTotalDefense.toLocaleString());
        } catch (err) {
            console.error("DefEngine.run Error:", err);
            AppCards.setStatusLog("兵士防御計算エラー: " + err.message, true);
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

        var isHonkyoDef = (setup.targetBase === 'HONKYO');
        var baseLabel = isHonkyoDef ? '本拠・塔' : '拠点＋';
        var baseColor = isHonkyoDef ? 'text-amber-400' : 'text-sky-400';

        var renderActiveSlotHTML = function(slotKey, slotTitle, isAvailable) {
            if (!isAvailable) {
                return `
                    <div class="bg-red-950/20 border border-dashed border-red-900/60 rounded-xl p-2 flex flex-col items-center opacity-60">
                        <div class="w-full flex items-center justify-between pb-1 mb-1 border-b border-red-900/40">
                            <span class="text-[11px] font-bold text-red-400/80">${slotTitle}</span>
                            <span class="text-[9px] bg-red-950 text-red-300 px-1.5 py-0.5 rounded border border-red-700/50">拠点喪失</span>
                        </div>
                        <div class="w-full aspect-[3/4] border border-dashed border-red-900/40 rounded-lg flex flex-col items-center justify-center text-red-400/70 text-xs mt-1">
                            <i class="fa-solid fa-fire mb-1 text-base"></i><span>配置不可</span>
                        </div>
                    </div>
                `;
            }

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
                var adjList = setup.assignedAdjutantsMap ? setup.assignedAdjutantsMap[item.card.uniqueId] : null;
                var adjAddedT = (setup.adjutantAddedTroopBuffMap && setup.adjutantAddedTroopBuffMap[item.card.uniqueId]) || 0;
                var totalSlotBuff = SharedDB.safeNum(item.rawTMult, 0) + adjAddedT;
                var scopeBadge = item.isBound
                    ? '<div class="absolute -top-2 left-0 bg-red-600 border border-red-400 text-white text-[8px] px-1 rounded-full shadow-md z-30 font-bold pointer-events-none">その拠点のみ</div>'
                    : '<div class="absolute -top-2 left-0 bg-emerald-600 border border-emerald-400 text-white text-[8px] px-1 rounded-full shadow-md z-30 font-bold pointer-events-none">全拠点有効</div>';

                cardContent = `
                    <div class="relative border ${item.isBound ? 'border-amber-400' : 'border-sky-400'} rounded-lg p-1.5 opacity-90 hover:opacity-100 hover:z-40 transition w-full mt-1">
                        ${SharedUI.getCardVisualHTML(getDisplayCard(item.card, setup), adjList)}
                        <div class="absolute -top-2 -right-2 bg-black border border-sky-400 text-sky-300 text-[8px] px-1 rounded-full shadow-md z-10 font-mono text-center leading-tight pointer-events-none">
                            防+${SharedDB.formatBuffNum(totalSlotBuff)}% (内政)
                        </div>
                        ${scopeBadge}
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
                var adjAddedT = (setup.adjutantAddedTroopBuffMap && setup.adjutantAddedTroopBuffMap[s.card.uniqueId]) || 0;
                var dispT = SharedDB.safeNum(s.rawTMult, 0) + adjAddedT;
                var badgeStr = '防+' + SharedDB.formatBuffNum(dispT) + '% ' + (isGuard ? '(警護)' : '(自動)');

                return `
                <div class="relative border ${isGuard ? 'border-purple-500' : 'border-sky-600/70'} rounded-lg p-1.5 opacity-90 hover:opacity-100 hover:z-40 transition">
                    ${SharedUI.getCardVisualHTML(getDisplayCard(s.card, setup), adjList)}
                    <div class="absolute -top-2 -right-2 bg-black border ${isGuard ? 'border-purple-500 text-purple-400' : 'border-sky-400 text-sky-300'} text-[8px] px-1 rounded-full shadow-md z-10 font-mono text-center leading-tight pointer-events-none">
                        ${badgeStr}
                    </div>
                    ${s.isBound ? '<div class="absolute -top-2 left-0 bg-red-600 border border-red-400 text-white text-[8px] px-1 rounded-full shadow-md z-30 font-bold pointer-events-none">その拠点のみ</div>' : ''}
                </div>
            `;}).join('');
        };

        var nanbanSectionHTML = '';
        if (setup.isNanbanMode) {
            var taishuSlotsHTML = '';
            for (var ti = 0; ti < 5; ti++) {
                var tItem = setup.pickedNanbanTaishu[ti];
                if (tItem) {
                    var tAdjList = setup.assignedAdjutantsMap ? setup.assignedAdjutantsMap[tItem.card.uniqueId] : null;
                    var tAdjAddedT = (setup.adjutantAddedTroopBuffMap && setup.adjutantAddedTroopBuffMap[tItem.card.uniqueId]) || 0;
                    var tDispT = SharedDB.safeNum(tItem.rawTMult, 0) + tAdjAddedT;
                    var tBadge = '防+' + SharedDB.formatBuffNum(tDispT) + '% (太守)';

                    taishuSlotsHTML += `
                        <div class="bg-black/60 border border-amber-500/50 rounded-xl p-2 flex flex-col items-center">
                            <div class="w-full flex items-center justify-between pb-1 mb-1 border-b border-amber-500/30">
                                <span class="text-[11px] font-bold text-amber-300">南蛮太守 ${ti + 1}</span>
                                <span class="text-[9px] bg-amber-950 text-amber-300 border border-amber-500/40 px-1.5 py-0.5 rounded font-mono font-bold">元C${tItem.effectiveCost.toFixed(1)} → C0</span>
                            </div>
                            <div class="relative border border-amber-400 rounded-lg p-1.5 opacity-95 hover:opacity-100 hover:z-40 transition w-full mt-1">
                                ${SharedUI.getCardVisualHTML(getDisplayCard(tItem.card, setup), tAdjList)}
                                <div class="absolute -top-2 -right-2 bg-black border border-amber-400 text-amber-300 text-[8px] px-1 rounded-full shadow-md z-10 font-mono text-center leading-tight pointer-events-none">
                                    ${tBadge}
                                </div>
                                <div class="absolute -top-2 left-0 bg-amber-600 border border-amber-300 text-black text-[8px] px-1 rounded-full shadow-md z-30 font-extrabold pointer-events-none">縛り無視</div>
                            </div>
                        </div>
                    `;
                } else {
                    taishuSlotsHTML += `
                        <div class="bg-black/40 border border-dashed border-gray-800 rounded-xl p-2 flex flex-col items-center">
                            <div class="w-full flex items-center justify-between pb-1 mb-1 border-b border-gray-800">
                                <span class="text-[11px] font-bold text-gray-500">南蛮太守 ${ti + 1}</span>
                                <span class="text-[9px] text-gray-600 font-mono">C0</span>
                            </div>
                            <div class="w-full aspect-[3/4] border-2 border-dashed border-gray-800 rounded-lg flex flex-col items-center justify-center text-gray-600 text-xs mt-1">
                                <i class="fa-solid fa-user-slash mb-1 text-base"></i><span>空き枠</span>
                            </div>
                        </div>
                    `;
                }
            }

            nanbanSectionHTML = `
                <div class="mb-6 border-2 border-amber-500/60 rounded-xl p-4 bg-gradient-to-br from-amber-950/30 via-gray-900/70 to-gray-900/50 shadow-[0_0_20px_rgba(245,158,11,0.15)]">
                    <div class="text-md font-bold text-white mb-2 flex flex-wrap items-center justify-between gap-2 border-b border-amber-500/30 pb-2">
                        <span class="flex items-center space-x-2">
                            <i class="fa-solid fa-crown text-amber-400"></i>
                            <span>南蛮太守 配置（5枠 / 高コストパッシブ優先・コスト0消費・拠点縛り無視）</span>
                        </span>
                        <span class="text-xs font-mono bg-amber-500 text-black font-extrabold px-2.5 py-0.5 rounded shadow">
                            太守節約コスト: ${setup.nanbanSavedCost.toFixed(1)}C 分（実質タダ配置）
                        </span>
                    </div>
                    <div class="text-xs text-amber-200/80 mb-3">
                        <i class="fa-solid fa-circle-info text-amber-400 mr-1"></i>コスト1.0等の軽量パッシブは表デッキに温存し、コストが重い（4.5C・4.0C等）強力パッシブ武将を優先的に太守5枠へ配置しています。
                    </div>
                    <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                        ${taishuSlotsHTML}
                    </div>
                </div>
            `;
        }

        var extraBadges = '';
        var multParts = [];
        if (setup.isNanbanMode) {
            extraBadges += '<span class="bg-amber-500 text-black text-[10px] font-extrabold px-2 py-0.5 rounded shadow">南蛮モード (太守5枠)</span>';
        }
        if (setup.matchupMultiplier !== 1.0) {
            extraBadges += '<span class="bg-emerald-600 text-white text-[10px] font-bold px-2 py-0.5 rounded shadow">相性 ×' + setup.matchupMultiplier + '</span>';
            multParts.push('相性' + setup.matchupMultiplier);
        }
        if (isDefBuff10) {
            extraBadges += '<span class="bg-sky-600 text-white text-[10px] font-bold px-2 py-0.5 rounded shadow">課金 ×1.1</span>';
            multParts.push('課金1.1');
        }
        if (setup.goBuff > 0) extraBadges += '<span class="bg-cyan-700 text-white text-[10px] font-bold px-2 py-0.5 rounded shadow">伍 +' + setup.goBuff + '%</span>';
        if (setup.dmgReduceSum > 0) extraBadges += '<span class="bg-indigo-700 text-white text-[10px] font-bold px-2 py-0.5 rounded shadow">被ダメ-' + setup.dmgReduceSum + '%</span>';

        var multFormula = multParts.length > 0 ? (' × <span class="text-sky-400 font-bold">(' + multParts.join(' × ') + ')</span>') : '';

        var kyotenSlotsHTML = '';
        for (var ki = 0; ki < 9; ki++) {
            kyotenSlotsHTML += renderActiveSlotHTML('k' + ki, (ki + 3) + '. 拠点' + (ki + 1), ki < setup.maxKyotenNaisei);
        }

        area.className = "space-y-6 animate-flash";
        area.innerHTML = `
            <div class="bg-sangoku-dark border border-sangoku-cardBorder p-5 rounded-xl shadow-lg mb-6">
                <div class="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 border-b border-gray-800 pb-4 gap-4">
                    <div>
                        <div class="flex flex-wrap items-center gap-1.5 mb-2">
                            <span class="bg-sky-600 text-white text-[10px] font-bold px-2 py-0.5 rounded shadow">兵士防御計算結果</span>
                            <span class="bg-gray-800 border border-gray-600 text-amber-300 text-[10px] font-bold px-2 py-0.5 rounded">有効内政枠: 本拠${setup.maxHonkyoNaisei} + 拠点${setup.maxKyotenNaisei}</span>
                            ${extraBadges}
                            <h3 class="text-lg font-bold text-white ml-1">【防衛拠点: <span class="${baseColor}">${baseLabel}</span>】</h3>
                        </div>
                        <div class="text-xs text-gray-300 font-mono space-y-1.5 bg-black/40 p-2.5 rounded-lg border border-gray-800">
                            <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
                                <span>防衛兵種: <b class="text-sky-300 text-sm">${setup.targetTroopData.name}</b> <span class="text-gray-500 text-[10px]">(1兵基礎防: ${setup.targetTroopData.defense})</span></span>
                                <span>兵数: <b class="text-white">${setup.troopCount.toLocaleString()}</b></span>
                            </div>
                            <div class="flex flex-wrap items-center gap-x-4 gap-y-1">
                                <div>総兵士防御バフ: <span class="text-sky-400 font-bold">+${SharedDB.formatBuffNum(setup.finalTroopMult)}%</span></div>
                                <div>総武将防御バフ: <span class="text-emerald-400 font-bold">+${SharedDB.formatBuffNum(setup.finalGenMult)}%</span></div>
                            </div>
                        </div>
                    </div>
                    <div class="text-right bg-black/60 p-4 rounded-xl border border-gray-700 w-full md:w-auto shadow-inner">
                        <div class="text-xs text-gray-400 mb-1 text-center md:text-right">拠点 最終総合防御力</div>
                        <div class="text-3xl font-bold text-sky-400 font-mono drop-shadow-md text-center md:text-right">${setup.finalTotalDefense.toLocaleString()}</div>
                        <div class="text-[10px] text-gray-400 mt-2 text-center md:text-right leading-relaxed bg-black/40 p-2 rounded border border-gray-800">
                            ＝ [ 兵防(${setup.troopDefense.toLocaleString()}) + 将防(${setup.genDefense.toLocaleString()}) ]${multFormula}
                        </div>
                    </div>
                </div>

                ${nanbanSectionHTML}

                <div class="mb-6 border border-gray-700 rounded-lg p-4 bg-gray-900/50">
                    <div class="text-md font-bold text-white mb-2 flex justify-between border-b border-gray-700 pb-2">
                        <span><i class="fa-solid fa-chess-rook text-amber-500 mr-2"></i>本拠・塔 デッキ配置（有効内政枠: ${setup.maxHonkyoNaisei} / 2）</span>
                        <span class="text-xs font-mono ${setup.honkyoCost > setup.honkyoLimit ? 'text-red-400' : 'text-gray-300'} font-bold">表コスト: ${setup.honkyoCost.toFixed(1)} / ${setup.honkyoLimit.toFixed(1)}</span>
                    </div>
                    <div class="text-xs text-sky-400 mb-2"><i class="fa-solid fa-hand-pointer mr-1"></i>内政セット枠 (手動)</div>
                    <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                        ${renderActiveSlotHTML('h0', '1. 本拠', 0 < setup.maxHonkyoNaisei)}
                        ${renderActiveSlotHTML('h1', '2. 塔', 1 < setup.maxHonkyoNaisei)}
                    </div>
                    <div class="text-xs text-gray-400 mb-1"><i class="fa-solid fa-bolt mr-1"></i>本拠デッキ空き枠 (自動・パッシブ: ${setup.chosenBasePassives.length}枚)</div>
                    <div class="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-3 mb-4">${renderCardListHTML(setup.chosenBasePassives, false)}</div>
                    <div class="mt-4 border-t border-gray-700 pt-2 flex justify-between text-xs text-purple-400 mb-1">
                        <span><i class="fa-solid fa-shield-halved mr-1"></i>裏・警護デッキ (${setup.chosenBaseGuards.length}枚)</span>
                        <span class="font-mono text-gray-400 font-bold">裏コスト: ${setup.honkyoGuardCost.toFixed(1)} / ${setup.honkyoLimit.toFixed(1)}</span>
                    </div>
                    <div class="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-3">${renderCardListHTML(setup.chosenBaseGuards, true)}</div>
                </div>

                <div class="border border-gray-700 rounded-lg p-4 bg-gray-900/50">
                    <div class="text-md font-bold text-white mb-2 flex justify-between border-b border-gray-700 pb-2">
                        <span><i class="fa-solid fa-tents text-sky-400 mr-2"></i>拠点＋ デッキ配置（生存内政枠: ${setup.maxKyotenNaisei} / 9拠点）</span>
                        <span class="text-xs font-mono ${setup.kyotenCost > setup.kyotenLimit ? 'text-red-400' : 'text-gray-300'} font-bold">表コスト: ${setup.kyotenCost.toFixed(1)} / ${setup.kyotenLimit.toFixed(1)}</span>
                    </div>
                    <div class="text-xs text-sky-400 mb-2"><i class="fa-solid fa-hand-pointer mr-1"></i>内政セット枠 (手動・全拠点有効スキルのみ配置)</div>
                    <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mb-4">
                        ${kyotenSlotsHTML}
                    </div>
                    <div class="text-xs text-gray-400 mb-1"><i class="fa-solid fa-bolt mr-1"></i>拠点＋デッキ空き枠 (自動・パッシブ: ${setup.chosenSubPassives.length}枚)</div>
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
        changeAdjutantMode: function(val) { defAdjutantMode = val; run(true); },
        setNanbanMode: function(val) {
            isNanbanMode = Boolean(val);
            var btnOff = document.getElementById('btnDefNanbanOff');
            var btnOn = document.getElementById('btnDefNanbanOn');
            var lbl = document.getElementById('labelDefNanbanStatus');
            if (isNanbanMode) {
                if (btnOff) btnOff.className = "px-3 py-1.5 text-xs font-bold rounded-lg transition text-gray-400 hover:text-white cursor-pointer";
                if (btnOn) btnOn.className = "px-3 py-1.5 text-xs font-bold rounded-lg transition bg-amber-500 text-black shadow cursor-pointer";
                if (lbl) lbl.innerHTML = '<span class="text-amber-400 font-bold">ON（南蛮太守 5枠有効・コスト0・拠点縛り無視）</span>';
            } else {
                if (btnOff) btnOff.className = "px-3 py-1.5 text-xs font-bold rounded-lg transition bg-sky-600 text-white shadow cursor-pointer";
                if (btnOn) btnOn.className = "px-3 py-1.5 text-xs font-bold rounded-lg transition text-gray-400 hover:text-white cursor-pointer";
                if (lbl) lbl.textContent = "通常防衛モード（南蛮太守枠なし）";
            }
            run(true);
        },
        setNaiseiPreset: function(hCount, kCount) {
            var elH = document.getElementById('defHonkyoNaiseiSlots');
            var elK = document.getElementById('defKyotenNaiseiSlots');
            if (elH) elH.value = String(hCount);
            if (elK) elK.value = String(kCount);
            run(true);
        },
        updateMatchup: function(val) {
            defMatchupMult = SharedDB.safeNum(val, 1.0);
            var lbl = document.getElementById('labelDefMatchupStatus');
            if (lbl) {
                if (defMatchupMult > 1.0) lbl.innerHTML = '<span class="text-emerald-400 font-bold">有利 (×' + defMatchupMult + ')</span>';
                else if (defMatchupMult < 1.0) lbl.innerHTML = '<span class="text-red-400 font-bold">不利 (×' + defMatchupMult + ')</span>';
                else lbl.textContent = '等倍 (×1.0)';
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
                if (btnOn) btnOn.className = "py-1 text-xs font-bold rounded-lg transition bg-sky-600 text-white shadow cursor-pointer";
                if (lbl) lbl.innerHTML = '<span class="text-sky-400 font-bold">ON (×1.1)</span>';
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
            defGoBuffValue = SharedDB.safeNum(val, 3000);
            if (isDefGoEnabled) {
                var lbl = document.getElementById('labelDefGoStatus');
                if (lbl) lbl.innerHTML = '<span class="text-cyan-400 font-bold">ON (+' + defGoBuffValue + '%)</span>';
            }
            fastUpdateDefMultiplier();
        }
    };
})();