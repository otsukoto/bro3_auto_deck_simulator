// ========================================================
// 【兵士防御計算エンジン】js/engine-def.js (Ver. 2.09)
// 役割：拠点防衛・南蛮太守5枠最適化、防御アクティブスキル(四神の大聖郭等)は内政官枠(h0〜h1/k0〜k8)のみに配置しパッシブデッキ枠(pickedHPassives/pickedKPassives)には混入させない厳密分離、南蛮太守はパッシブ防御のみ厳密選出、同一デッキ/同一勢力(覇＝全勢力扱い含む)対応、「自拠点の全兵/自拠点の全ての兵/全拠点」等の明示がない防御バフはその拠点のみ有効、主将コピースキル・檄令＆覇超覇補正・2パス/2拠点DP・副将覚醒無効化対応
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

    function hasTeisenKeywordInText(txt) {
        if (!txt) return false;
        return txt.indexOf('帝仙鏡') !== -1 ||
               txt.indexOf('仙鏡') !== -1 ||
               txt.indexOf('コストが1') !== -1 ||
               txt.indexOf('コストを1') !== -1;
    }

    function isTeisenAdjutantObject(fk) {
        if (!fk || typeof fk !== 'object') return false;
        var inf = SharedDB.getMirrorSkillInfo ? SharedDB.getMirrorSkillInfo(fk) : null;
        if (inf && (inf.type === 'senkyo' || inf.type === 'teisen' || inf.type === 'teisenkyo')) return true;
        var topTxt = String(fk.name || '') + ' ' + String(fk.label || '') + ' ' + String(fk.description || '') + ' ' + (inf ? String(inf.label || '') : '');
        if (hasTeisenKeywordInText(topTxt)) return true;
        if (Array.isArray(fk.skills)) {
            for (var i = 0; i < fk.skills.length; i++) {
                var sk = fk.skills[i];
                if (!sk) continue;
                var skTxt = String(sk.name || '') + ' ' + String(sk.description || '');
                if (hasTeisenKeywordInText(skTxt)) return true;
            }
        }
        return false;
    }

    function isTeisenMirrorItem(m) {
        if (!m) return false;
        if (m.info && (m.info.type === 'senkyo' || m.info.type === 'teisen' || m.info.type === 'teisenkyo')) return true;
        if (m.card && isTeisenAdjutantObject(m.card)) return true;
        return isTeisenAdjutantObject(m);
    }

    function cardHasEquippedTeisen(c) {
        if (!c) return false;
        if (c.hasTeisenkyo) return true;
        if (c.originalCost !== undefined && SharedDB.safeNum(c.originalCost, 0) > 1.0 + 1e-6 && SharedDB.safeNum(c.cost, 4.5) <= 1.0 + 1e-6) {
            return true;
        }
        if (Array.isArray(c.fukusho) && c.fukusho.some(isTeisenAdjutantObject)) {
            return true;
        }
        if (Array.isArray(c.skills)) {
            for (var i = 0; i < c.skills.length; i++) {
                var sk = c.skills[i];
                if (!sk) continue;
                var sn = String(sk.name || '');
                var sd = String(sk.description || '');
                if ((sn.indexOf('副') === 0 || sn.indexOf('仙鏡') !== -1) && hasTeisenKeywordInText(sn + ' ' + sd)) {
                    return true;
                }
            }
        }
        return false;
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
        return SharedDB.getMasterMirrorCopyRate(skill);
    }

    function getDefKakuseiMult(card) {
        return SharedDB.getKakuseiMultiplier(card);
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

    function floatVal(s) {
        var n = parseFloat(s);
        return isNaN(n) ? 0 : n;
    }

    // 「自拠点の全兵」「自拠点の全ての兵」「全拠点」等の全拠点対象明示があるかを判定
    function isAllBasesDefenseDesc(normDesc) {
        if (!normDesc) return false;
        if (normDesc.indexOf('同一デッキ') !== -1 ||
            normDesc.indexOf('セットした拠点') !== -1 ||
            normDesc.indexOf('この武将をセットした拠点') !== -1 ||
            normDesc.indexOf('所属拠点が同一') !== -1) {
            return false;
        }
        return /(?:自拠点の?全(?:ての)?兵|全拠点|全ての拠点|すべての拠点)/.test(normDesc);
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

        // 「自動で発動」「自動発動」「全滅時も発動」「パッシブ」等の明記がある場合のみパッシブ判定
        var hasExplicitManual = /(?:スキル使用中|スキル発動時|発動すると|一定時間|勅令|襲令|斗魂令|号令|戦陣|極意)/.test(normDesc) &&
                                normDesc.indexOf('自動で発動') === -1 && normDesc.indexOf('自動発動') === -1;

        if (!hasExplicitManual && (
            normDesc.indexOf('自動で発動') !== -1 ||
            normDesc.indexOf('自動発動') !== -1 ||
            normDesc.indexOf('全滅時も発動') !== -1 ||
            normDesc.indexOf('パッシブ') !== -1
        )) {
            res.isPassive = true;
        }
        if (normDesc.indexOf('警護デッキ') !== -1 || name.indexOf('警悟') !== -1 || normDesc.indexOf('警悟') !== -1) {
            res.isGuardDeck = true;
            if (normDesc.indexOf('自動で発動') !== -1 || normDesc.indexOf('自動発動') !== -1 || normDesc.indexOf('パッシブ') !== -1) {
                res.isPassive = true;
            }
        }

        // 「自拠点の全兵」「自拠点の全ての兵」「全拠点」等の記述がなければその拠点のみ有効(mustBeSameBase = true)
        var isAllBases = isAllBasesDefenseDesc(normDesc);
        res.mustBeSameBase = !isAllBases;

        if (name.indexOf('防:') === 0 || name.indexOf('副防:') === 0 || name.indexOf('攻防:') === 0 || name.indexOf('副攻防:') === 0 || name.indexOf('変:') === 0 || name.indexOf('副変:') === 0) {
            res.isDefSkill = true;
        } else if (normDesc.indexOf('防御力') !== -1 || normDesc.indexOf('受けるダメージを') !== -1) {
            res.isDefSkill = true;
        }

        if (!res.isDefSkill) {
            defSkillCache[cacheKey] = res;
            return res;
        }

        var wMult = calcWeatherMultSafe(normDesc, weatherObj, '防御');

        var mSameC = normDesc.match(/同一勢力\((魏|呉|蜀|他)\)の武将1枚につき([0-9\.]+)[%％]/);
        if (mSameC) {
            res.reqCountry = mSameC[1];
            res.perSameCountryMult = parseFloat(mSameC[2]) * wMult;
            res.mustBeSameBase = true;
            // 「自動で発動」等の明記がない場合はパッシブではなく内政官(h0〜h1/k0〜k8)使用時のみ有効
            res.isManualNaisei = !res.isPassive;
            defSkillCache[cacheKey] = res;
            return res;
        }

        // パッシブ明記のない防御スキルは内政官(h0〜h1/k0〜k8)使用時のみ効果を発揮
        if (!res.isPassive) {
            res.isManualNaisei = true;
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

        var mExtra = normDesc.match(/更に(?:(?:攻撃(?:力)?[と・、,\/])?防御(?:力)?(?:[と・、,\/](?:攻撃(?:力)?|移動速度|移速))*\s*[がをのは]?)?\s*([0-9\.]+)[%％]/);
        if (mExtra) {
            var extraV = floatVal(mExtra[1]);
            var okWeather = true;
            if ((normDesc.indexOf('晴天候') !== -1 || normDesc.indexOf('晴天') !== -1) && weatherObj !== 'SUN') okWeather = false;
            if ((normDesc.indexOf('曇') !== -1 || normDesc.indexOf('雨') !== -1 || normDesc.indexOf('雪') !== -1 || normDesc.indexOf('荒天') !== -1 || normDesc.indexOf('陰天') !== -1 || normDesc.indexOf('悪天候') !== -1) && ['CLOUD', 'RAIN', 'SNOW'].indexOf(weatherObj) === -1) okWeather = false;
            if (okWeather) {
                if (tDefCondition(tMult)) tMult += extraV;
                if (tDefCondition(gMult)) gMult += extraV;
            }
        }

        res.tMult = tMult * wMult;
        res.gMult = gMult * wMult;
        defSkillCache[cacheKey] = res;
        return res;
    }

    function tDefCondition(v) {
        return v > 0;
    }

    // =========================================================================
    // 一般武将を副将にセットした時の第1スキル評価
    // ※副将のスキル効果はレアリティに応じて SL:80% / L:70% / UR:60% / SR:50% / R:40% で発動
    // ※副将時は覚醒スキル（覚:）が無効化されるため、覚醒対象なら覚醒倍率（3〜4倍）で割り戻す
    // =========================================================================
    function buildDefGeneralAdjutantCand(gCard, targetTroopData, weatherObj, isExactDefendedBaseSlot, isGuardMaster, targetMasterCost) {
        if (!gCard || SharedDB.isHaBusho(gCard) || SharedDB.isMirrorCard(gCard.name)) return null;
        var skills = gCard.skills || [];
        if (skills.length === 0 || !skills[0]) return null;
        var s0 = skills[0];
        var sName = String(s0.name || '').trim();
        if (!sName || sName.indexOf('覚:') === 0 || sName.indexOf('副覚:') === 0 || isDuelSkill(s0)) return null;

        if (sName.indexOf('攻:') === 0 || sName.indexOf('副攻:') === 0) return null;

        var adjRatio = getGeneralAdjutantRarityRatio(gCard.rarity);
        var p0 = parseDefSkill(s0, targetTroopData, weatherObj);
        if (!p0.isDefSkill || !p0.isPassive || p0.tMult <= 0) return null;
        // 警護デッキに居る主将の一般武将副将は「警悟」（警護デッキセット時）スキルのみ有効
        if (isGuardMaster && !p0.isGuardDeck) return null;

        if (!isExactDefendedBaseSlot && p0.mustBeSameBase) return null;

        var rawTVal = SharedDB.safeNum(p0.tMult, 0);
        var rawGVal = SharedDB.safeNum(p0.gMult, 0);

        var awakeInfo = SharedDB.getAwakeningInfo(gCard);
        if (awakeInfo.hasAwakening && awakeInfo.isFirstSkillTarget && awakeInfo.multiplier > 1.0) {
            rawTVal = rawTVal / awakeInfo.multiplier;
            rawGVal = rawGVal / awakeInfo.multiplier;
        }

        var costRatio = SharedDB.calcCostAdjustedRatio(s0, SharedDB.safeNum(gCard.cost, 4.5), SharedDB.safeNum(targetMasterCost, 4.5));
        var tVal = rawTVal * adjRatio * costRatio;
        var gVal = rawGVal * adjRatio * costRatio;
        if (tVal <= 0) return null;

        var cleanSName = sName.replace(/^(?:攻防|攻|防|変|副攻|副防|副変):/, '').replace(/LV[0-9]+$/i, '');
        var pctTag = Math.round(adjRatio * 100) + '%';
        var badge = '[副' + pctTag + ']' + cleanSName + ' 防+' + SharedDB.formatBuffNum(tVal) + '%';

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
            tMult: 0, gMult: 0,
            passiveTMult: 0, passiveGMult: 0, passivePerCountryMult: 0, passiveDmgReduce: 0,
            activeTMult: 0, activeGMult: 0, activePerCountryMult: 0, activeDmgReduce: 0,
            firstTMult: 0, firstGMult: 0,
            perSameCountryMult: 0, reqCountry: null, dmgReduce: 0,
            isManualNaisei: false, hasManualNaisei: false, isPassive: false, isGuard: false, mustBeSameBase: true
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
        var mustBeSameBaseCard = Boolean(p0.mustBeSameBase);
        var hasAnyPassive = false;
        var isHa = SharedDB.isHaBusho(card);
        var hasFukushoArr = Array.isArray(card.fukusho) && card.fukusho.length > 0;
        var shouldStripAdjSkills = Boolean(excludeSubSkills || hasFukushoArr);
        var kMultSelf = getDefKakuseiMult(card);

        for (var idx = 0; idx < skills.length; idx++) {
            var s = skills[idx];
            if (!s || typeof s !== 'object') continue;
            var sName = String(s.name || '').trim();

            if (sName.indexOf('覚:') === 0 || sName.indexOf('副覚:') === 0 || sName.indexOf('覚醒') !== -1) continue;
            if (isDuelSkill(s)) continue;

            var isFromAdj = (sName.indexOf('副:') === 0 || sName.indexOf('副変:') === 0 || sName.indexOf('副攻:') === 0 || sName.indexOf('副防:') === 0 || sName.indexOf('副ﾃﾞｭｴﾙ:') === 0);
            if (shouldStripAdjSkills && !isHa && isFromAdj) continue;

            var parsed = parseDefSkill(s, targetTroopData, weatherObj);

            var isSelfMirror = (idx > 0) && !isFromAdj && (
                sName.indexOf('変:') === 0 ||
                sName.indexOf('主将の') !== -1 ||
                sName.indexOf('明鑑') !== -1 ||
                sName.indexOf('王春の') !== -1 ||
                (sName.indexOf('鏡') !== -1 && sName.indexOf('副将') === -1) ||
                (sName.indexOf('鑑') !== -1 && sName.indexOf('副将') === -1) ||
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
                if (p0.isPassive) hasAnyPassive = true;
                if (p0.mustBeSameBase || parsed.mustBeSameBase) mustBeSameBaseCard = true;
                continue;
            }

            if (parsed.tMult > 0 || parsed.gMult > 0 || parsed.perSameCountryMult > 0 || parsed.dmgReduce > 0) {
                if (parsed.isGuardDeck) isGuardCard = true;
                if (parsed.reqCountry) reqCountry = parsed.reqCountry;
                if (parsed.isPassive || isFromAdj) {
                    if (!isFromAdj || parsed.isPassive) {
                        hasAnyPassive = true;
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
        var hasManualNaisei = false;

        if (activeCandidates.length > 0) {
            hasManualNaisei = true;
            if (isHa) {
                for (var ai = 0; ai < activeCandidates.length; ai++) {
                    var ac = activeCandidates[ai];
                    activeTMult += ac.tMult;
                    activeGMult += ac.gMult;
                    activePerCountry += ac.perSameCountryMult;
                    activeDmgReduce += ac.dmgReduce;
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
            passiveTMult: passiveTMult,
            passiveGMult: passiveGMult,
            passivePerCountryMult: passivePerCountry,
            passiveDmgReduce: passiveDmgReduce,
            activeTMult: activeTMult,
            activeGMult: activeGMult,
            activePerCountryMult: activePerCountry,
            activeDmgReduce: activeDmgReduce,
            firstTMult: p0.tMult,
            firstGMult: p0.gMult,
            perSameCountryMult: perCountryTotal,
            reqCountry: reqCountry,
            dmgReduce: dmgReduceTotal,
            isManualNaisei: hasManualNaisei && !hasAnyPassive,
            hasManualNaisei: hasManualNaisei,
            isPassive: hasAnyPassive,
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

    // 同一勢力(reqCountry)カウント（「覇」は全勢力扱いとして常にカウントに含める）
    function countMatchingCountryCards(deckItems, reqCountry) {
        if (!reqCountry || !Array.isArray(deckItems)) return 0;
        var cnt = 0;
        for (var i = 0; i < deckItems.length; i++) {
            var it = deckItems[i];
            var c = it && it.card;
            if (!c) continue;
            var cCountry = String(c.country || '').trim();
            var isHa = SharedDB.isHaBusho(c) || (cCountry === '覇');
            if (isHa || cCountry === reqCountry) {
                cnt++;
            }
        }
        return cnt;
    }

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

            // サポート評価プローブ事前計算
            var defProbeCache = Object.create(null);
            validCards.forEach(function(c) {
                defProbeCache[c.uniqueId] = getBestWeatherForCardDef(c, targetTroopData, true);
            });

            // 帝仙鏡（コスト1化）の事前割り当て
            var effectiveCostMap = Object.create(null);
            var preTeisenAssignedMap = Object.create(null);
            var usedTeisenCardIds = new Set();

            validCards.forEach(function(c) {
                var baseC = SharedDB.safeNum(c.originalCost !== undefined ? c.originalCost : c.cost, 4.5);
                effectiveCostMap[c.uniqueId] = baseC;
            });

            if (defAdjutantMode === 'CURRENT') {
                validCards.forEach(function(c) {
                    if (cardHasEquippedTeisen(c)) {
                        effectiveCostMap[c.uniqueId] = 1.0;
                    }
                });
            } else {
                var allTeisenMirrors = allMirrorPool.filter(isTeisenMirrorItem);

                if (defAdjutantMode === 'FILL_EMPTY') {
                    validCards.forEach(function(c) {
                        if (cardHasEquippedTeisen(c)) {
                            effectiveCostMap[c.uniqueId] = 1.0;
                            if (Array.isArray(c.fukusho)) {
                                c.fukusho.forEach(function(fk) {
                                    if (fk && isTeisenAdjutantObject(fk)) {
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

                    // 拠点縛り内政官は防衛対象拠点の1枠しか使われないため、2番手以降に帝仙鏡を奪われないよう制限
                    var boundNaiseiOnlyIds = new Set();
                    var bestBoundNaiseiId = null;
                    var bestBoundNaiseiVal = -1;
                    validCards.forEach(function(c) {
                        var dp = defProbeCache[c.uniqueId];
                        var ev = dp && dp.eval;
                        if (ev && ev.hasManualNaisei && ev.mustBeSameBase && !ev.isPassive) {
                            boundNaiseiOnlyIds.add(c.uniqueId);
                            var bv = SharedDB.safeNum(ev.activeTMult, 0) + SharedDB.safeNum(ev.activePerCountryMult, 0) * 4;
                            if (bv > bestBoundNaiseiVal) {
                                bestBoundNaiseiVal = bv;
                                bestBoundNaiseiId = c.uniqueId;
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
                        if (boundNaiseiOnlyIds.has(c.uniqueId) && c.uniqueId !== bestBoundNaiseiId) {
                            return false;
                        }
                        var dp = defProbeCache[c.uniqueId];
                        var ev = dp && dp.eval;
                        return Boolean(ev && (ev.tMult > 0 || ev.perSameCountryMult > 0 || ev.dmgReduce > 0));
                    });

                    teisenCandidateList.sort(function(a, b) {
                        var eqA = cardHasEquippedTeisen(a) ? 1 : 0;
                        var eqB = cardHasEquippedTeisen(b) ? 1 : 0;
                        if (eqB !== eqA) return eqB - eqA;

                        var origA = SharedDB.safeNum(a.originalCost !== undefined ? a.originalCost : a.cost, 4.5);
                        var origB = SharedDB.safeNum(b.originalCost !== undefined ? b.originalCost : b.cost, 4.5);
                        if (Math.abs(origB - origA) > 1e-6) return origB - origA;

                        var evA = defProbeCache[a.uniqueId] && defProbeCache[a.uniqueId].eval;
                        var evB = defProbeCache[b.uniqueId] && defProbeCache[b.uniqueId].eval;
                        var vA = SharedDB.safeNum(evA && evA.tMult, 0);
                        var vB = SharedDB.safeNum(evB && evB.tMult, 0);
                        return vB - vA;
                    });

                    for (var ci = 0; ci < teisenCandidateList.length && unequippedTeisen.length > 0; ci++) {
                        var tgtCard = teisenCandidateList[ci];
                        var maxFkC = SharedDB.safeNum(tgtCard.maxFukushoCost, 0);
                        var tFk = null;
                        for (var ti = 0; ti < unequippedTeisen.length; ti++) {
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

            // 「現在の副将のまま計算 (CURRENT)」時に、既に装着されている副将の実効バフを事前算出してDPへ直接反映
            var preExistingAdjTMap = Object.create(null);
            if (!isReassignMode) {
                validCards.forEach(function(c) {
                    preExistingAdjTMap[c.uniqueId] = 0;
                    if (SharedDB.isHaBusho(c) || !Array.isArray(c.fukusho) || c.fukusho.length === 0) return;
                    var dpC = defProbeCache[c.uniqueId];
                    var evC = dpC && dpC.eval;
                    var isGuardRoleC = Boolean(evC && evC.isGuard);
                    var kMultC = getDefKakuseiMult(c);
                    var firstTValC = SharedDB.safeNum(evC && evC.firstTMult, 0);
                    var cOrigCost = SharedDB.safeNum(c.originalCost !== undefined ? c.originalCost : c.cost, 4.5);

                    c.fukusho.forEach(function(rawFk) {
                        var inf = SharedDB.getMirrorSkillInfo(rawFk);
                        var isTeisenFk = isTeisenAdjutantObject(rawFk);
                        if (inf || isTeisenFk) {
                            var rate = isTeisenFk ? 100 : SharedDB.calcAdjutantEffectiveCopyRate(c, rawFk, inf);
                            preExistingAdjTMap[c.uniqueId] += (firstTValC / kMultC) * (rate / 100);
                        } else {
                            var gCand = buildDefGeneralAdjutantCand(rawFk, targetTroopData, 'SUN', true, isGuardRoleC, cOrigCost);
                            if (gCand) {
                                preExistingAdjTMap[c.uniqueId] += SharedDB.safeNum(gCand.genTMult, 0);
                            }
                        }
                    });
                });
            }

            var frontGlobalPool = [];
            var frontBoundPool = [];
            var guardBoundPool = [];
            var guardGlobalPool = [];
            var nanbanPassivePool = [];

            for (var i = 0; i < validCards.length; i++) {
                var c = validCards[i];
                if (usedTeisenCardIds.has(c.uniqueId)) continue;
                var bestEv = defProbeCache[c.uniqueId] || getBestWeatherForCardDef(c, targetTroopData, true);
                var ev = bestEv.eval;
                if (!ev || (ev.tMult <= 0 && ev.perSameCountryMult <= 0 && ev.dmgReduce <= 0)) continue;

                var effCost = effectiveCostMap[c.uniqueId];
                var pT = SharedDB.safeNum(ev.passiveTMult !== undefined ? ev.passiveTMult : (ev.isPassive ? ev.tMult : 0), 0);
                var pG = SharedDB.safeNum(ev.passiveGMult !== undefined ? ev.passiveGMult : (ev.isPassive ? ev.gMult : 0), 0);
                var pSame = SharedDB.safeNum(ev.passivePerCountryMult !== undefined ? ev.passivePerCountryMult : (ev.isPassive ? ev.perSameCountryMult : 0), 0);
                var pRed = SharedDB.safeNum(ev.passiveDmgReduce !== undefined ? ev.passiveDmgReduce : (ev.isPassive ? ev.dmgReduce : 0), 0);

                var aT = SharedDB.safeNum(ev.activeTMult, 0);
                var aG = SharedDB.safeNum(ev.activeGMult, 0);
                var aSame = SharedDB.safeNum(ev.activePerCountryMult, 0);
                var aRed = SharedDB.safeNum(ev.activeDmgReduce, 0);

                var baseItem = {
                    card: c,
                    effectiveCost: effCost,
                    cost: effCost,
                    firstTMult: ev.firstTMult,
                    firstGMult: ev.firstGMult,
                    perSameCountryMult: ev.perSameCountryMult,
                    reqCountry: ev.reqCountry,
                    dmgReduce: ev.dmgReduce,
                    isBound: ev.mustBeSameBase,
                    isPassive: ev.isPassive,
                    isGuard: ev.isGuard,
                    weather: bestEv.bestWeather
                };

                // 南蛮太守は防御系パッシブスキル（ev.isPassive && !ev.isGuard）のみ対象
                if (ev.isPassive && !ev.isGuard && (pT > 0 || pSame > 0 || pRed > 0)) {
                    var pVal = pT + (pSame * 4) + (pRed * 15) + (!isReassignMode ? SharedDB.safeNum(preExistingAdjTMap[c.uniqueId], 0) : 0);
                    nanbanPassivePool.push(Object.assign({}, baseItem, {
                        tMult: pVal,
                        rawTMult: pT,
                        rawGMult: pG,
                        perSameCountryMult: pSame,
                        dmgReduce: pRed,
                        isManualNaisei: false
                    }));
                }

                if (ev.isGuard) {
                    var gVal = pT + (pSame * 4) + (pRed * 15) + (!isReassignMode ? SharedDB.safeNum(preExistingAdjTMap[c.uniqueId], 0) : 0);
                    if (gVal > 0 || pSame > 0 || pRed > 0) {
                        var gItem = Object.assign({}, baseItem, {
                            tMult: gVal,
                            rawTMult: pT,
                            rawGMult: pG,
                            perSameCountryMult: pSame,
                            dmgReduce: pRed,
                            isManualNaisei: false
                        });
                        if (ev.mustBeSameBase) guardBoundPool.push(gItem);
                        else guardGlobalPool.push(gItem);
                    }
                } else {
                    // パッシブ効果（「自動で発動」等）がある場合はパッシブ枠候補として追加
                    if (ev.isPassive && (pT > 0 || pSame > 0 || pRed > 0)) {
                        var pScore = pT + (pSame * 4) + (pRed * 15) + (!isReassignMode ? SharedDB.safeNum(preExistingAdjTMap[c.uniqueId], 0) : 0);
                        var pItem = Object.assign({}, baseItem, {
                            tMult: pScore,
                            rawTMult: pT,
                            rawGMult: pG,
                            perSameCountryMult: pSame,
                            dmgReduce: pRed,
                            isManualNaisei: false
                        });
                        if (ev.mustBeSameBase) frontBoundPool.push(pItem);
                        else frontGlobalPool.push(pItem);
                    }

                    // アクティブ防御スキル（内政官h0〜h1 / k0〜k8使用時のみ有効）がある場合は内政官枠候補として追加
                    if (ev.hasManualNaisei && (aT > 0 || aSame > 0 || aRed > 0)) {
                        var aScore = aT + (aSame * 4) + (aRed * 15) + (!isReassignMode ? SharedDB.safeNum(preExistingAdjTMap[c.uniqueId], 0) : 0);
                        var aItem = Object.assign({}, baseItem, {
                            tMult: aScore,
                            rawTMult: aT,
                            rawGMult: aG,
                            perSameCountryMult: aSame,
                            dmgReduce: aRed,
                            isManualNaisei: true
                        });
                        if (ev.mustBeSameBase) frontBoundPool.push(aItem);
                        else frontGlobalPool.push(aItem);
                    }
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

            if (isNanbanMode) {
                var allPassiveForNanban = dedupByCardNo(nanbanPassivePool, usedNos);
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

            var hManualSlots = [];
            var kManualSlots = [];
            var pickedHPassives = [];
            var pickedKPassives = [];

            // パッシブ枠候補（isManualNaisei === false のみ）と内政官枠候補（isManualNaisei === true のみ）を明確に分離
            var filterPassiveOnly = function(pool) {
                return pool.filter(function(x) { return !x.isManualNaisei && x.isPassive; });
            };
            var filterNaiseiOnly = function(pool) {
                return pool.filter(function(x) { return Boolean(x.isManualNaisei); });
            };

            if (isHonkyoDef) {
                // 1. 拠点＋：内政官枠(kManualSlots)とパッシブ枠(pickedKPassives)を分離して選出
                var kNaiseiCands = dedupByCardNo(filterNaiseiOnly(frontGlobalPool), usedNos);
                var kNaiseiPicked = maxKyotenNaisei > 0 ? solveDeckKnapsackWithNaiseiLimits(kyotenLimit, maxKyotenNaisei, 0, kNaiseiCands) : [];
                kNaiseiPicked.forEach(function(it) {
                    usedNos.add(it.card.cardNo || it.card.uniqueId);
                    kManualSlots.push(it);
                });
                var kUsedCost = kNaiseiPicked.reduce(function(s, x) { return s + x.effectiveCost; }, 0);
                var kPassiveCands = dedupByCardNo(filterPassiveOnly(frontGlobalPool), usedNos);
                var kPassivePicked = solveDeckKnapsackWithNaiseiLimits(Math.max(0, kyotenLimit - kUsedCost), 0, 0, kPassiveCands);
                kPassivePicked.forEach(function(it) {
                    usedNos.add(it.card.cardNo || it.card.uniqueId);
                    pickedKPassives.push(it);
                });

                // 2. 本拠：内政官枠(hManualSlots)とパッシブ枠(pickedHPassives)を分離して選出
                var hNaiseiCands = dedupByCardNo(filterNaiseiOnly(frontBoundPool.concat(frontGlobalPool)), usedNos);
                var hNaiseiPicked = maxHonkyoNaisei > 0 ? solveDeckKnapsackWithNaiseiLimits(honkyoLimit, maxHonkyoNaisei, Math.min(1, maxHonkyoNaisei), hNaiseiCands) : [];
                hNaiseiPicked.forEach(function(it) {
                    usedNos.add(it.card.cardNo || it.card.uniqueId);
                    hManualSlots.push(it);
                });
                var hUsedCost = hNaiseiPicked.reduce(function(s, x) { return s + x.effectiveCost; }, 0);
                var hPassiveCands = dedupByCardNo(filterPassiveOnly(frontBoundPool.concat(frontGlobalPool)), usedNos);
                var hPassivePicked = solveDeckKnapsackWithNaiseiLimits(Math.max(0, honkyoLimit - hUsedCost), 0, 0, hPassiveCands);
                hPassivePicked.forEach(function(it) {
                    usedNos.add(it.card.cardNo || it.card.uniqueId);
                    pickedHPassives.push(it);
                });
            } else {
                // 1. 本拠：内政官枠(hManualSlots)とパッシブ枠(pickedHPassives)を分離して選出
                var hNaiseiCands2 = dedupByCardNo(filterNaiseiOnly(frontGlobalPool), usedNos);
                var hNaiseiPicked2 = maxHonkyoNaisei > 0 ? solveDeckKnapsackWithNaiseiLimits(honkyoLimit, maxHonkyoNaisei, 0, hNaiseiCands2) : [];
                hNaiseiPicked2.forEach(function(it) {
                    usedNos.add(it.card.cardNo || it.card.uniqueId);
                    hManualSlots.push(it);
                });
                var hUsedCost2 = hNaiseiPicked2.reduce(function(s, x) { return s + x.effectiveCost; }, 0);
                var hPassiveCands2 = dedupByCardNo(filterPassiveOnly(frontGlobalPool), usedNos);
                var hPassivePicked2 = solveDeckKnapsackWithNaiseiLimits(Math.max(0, honkyoLimit - hUsedCost2), 0, 0, hPassiveCands2);
                hPassivePicked2.forEach(function(it) {
                    usedNos.add(it.card.cardNo || it.card.uniqueId);
                    pickedHPassives.push(it);
                });

                // 2. 拠点＋：内政官枠(kManualSlots)とパッシブ枠(pickedKPassives)を分離して選出
                var kNaiseiCands2 = dedupByCardNo(filterNaiseiOnly(frontBoundPool.concat(frontGlobalPool)), usedNos);
                var kNaiseiPicked2 = maxKyotenNaisei > 0 ? solveDeckKnapsackWithNaiseiLimits(kyotenLimit, maxKyotenNaisei, Math.min(1, maxKyotenNaisei), kNaiseiCands2) : [];
                kNaiseiPicked2.forEach(function(it) {
                    usedNos.add(it.card.cardNo || it.card.uniqueId);
                    kManualSlots.push(it);
                });
                var kUsedCost2 = kNaiseiPicked2.reduce(function(s, x) { return s + x.effectiveCost; }, 0);
                var kPassiveCands2 = dedupByCardNo(filterPassiveOnly(frontBoundPool.concat(frontGlobalPool)), usedNos);
                var kPassivePicked2 = solveDeckKnapsackWithNaiseiLimits(Math.max(0, kyotenLimit - kUsedCost2), 0, 0, kPassiveCands2);
                kPassivePicked2.forEach(function(it) {
                    usedNos.add(it.card.cardNo || it.card.uniqueId);
                    pickedKPassives.push(it);
                });
            }

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
                var reEv = evaluateCardDef(it.card, targetTroopData, curW, true);
                it.rawTMult = reEv.activeTMult;
                it.rawGMult = reEv.activeGMult;
                it.firstTMult = reEv.firstTMult;
                it.firstGMult = reEv.firstGMult;
                it.perSameCountryMult = reEv.activePerCountryMult;
                it.reqCountry = reEv.reqCountry;
                it.dmgReduce = reEv.activeDmgReduce;
                it.isExactDefendedBaseSlot = isHonkyoDef ? (sId === 'h0') : (sId === 'k0');
                it.isGuardMaster = false;
                allActiveItems.push(it);
            });

            pickedNanbanTaishu.forEach(function(x) { x.isExactDefendedBaseSlot = true; x.isGuardMaster = false; });
            pickedHPassives.forEach(function(x) { x.isExactDefendedBaseSlot = isHonkyoDef; x.isGuardMaster = false; });
            pickedKPassives.forEach(function(x) { x.isExactDefendedBaseSlot = !isHonkyoDef; x.isGuardMaster = false; });
            // 警護デッキに居る主将は isGuardMaster = true とし、一般武将副将には「警悟」スキル持ちのみ許可
            pickedHGuards.forEach(function(x) { x.isExactDefendedBaseSlot = isHonkyoDef; x.isGuardMaster = true; });
            pickedKGuards.forEach(function(x) { x.isExactDefendedBaseSlot = !isHonkyoDef; x.isGuardMaster = true; });

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
                    var itOrigC = SharedDB.safeNum(it.card.originalCost !== undefined ? it.card.originalCost : it.card.cost, 4.5);
                    masterList.push({
                        card: it.card,
                        targetMasterCost: itOrigC,
                        isExactDefendedBaseSlot: Boolean(it.isExactDefendedBaseSlot),
                        isGuardMaster: Boolean(it.isGuardMaster),
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
                        var isTeisenFk = isTeisenAdjutantObject(rawFk);
                        var st = SharedDB.getAdjutantStatusEffect(rawFk, inf);
                        var fkCost = SharedDB.safeNum(rawFk.cost, 0);
                        usedAdjutantCostMap[mCard.uniqueId] += fkCost;
                        totalDefenderAdjDefBonus += st.defBonus;

                        if (inf || isTeisenFk) {
                            var rate = isTeisenFk ? 100 : SharedDB.calcAdjutantEffectiveCopyRate(mCard, rawFk, inf);
                            var fkId = String(rawFk.uniqueId || rawFk.id || rawFk.cardNo || '');
                            var fkNo = String(rawFk.cardNo || fkId);
                            if (fkId) usedMirrorIds.add(fkId);
                            if (fkNo) usedMirrorNos.add(fkNo);
                            var lbl = isTeisenFk ? ((st.isGo ? '[護]' : st.isBu ? '[武]' : '') + '帝仙鏡 100% [主将C1化]') : formatMirrorLabelWithCost(inf, rate);
                            existing.push(Object.assign({}, rawFk, {
                                copyRate: rate,
                                label: lbl
                            }));
                            var addT = master.baseCopyTVal * (rate / 100);
                            var addG = master.baseCopyGVal * (rate / 100);
                            additionalAdjutantTroopBuff += addT;
                            additionalAdjutantGenBuff += addG;
                            adjutantAddedTroopBuffMap[mCard.uniqueId] += addT;
                            adjutantAddedGenBuffMap[mCard.uniqueId] += addG;
                        } else {
                            // 一般武将が既存副将として付いている場合もレアリティ倍率（SL80/L70/UR60/SR50/R40）＆覚醒割戻しを適用
                            var gCandEx = buildDefGeneralAdjutantCand(rawFk, targetTroopData, 'SUN', master.isExactDefendedBaseSlot, master.isGuardMaster, master.targetMasterCost);
                            if (gCandEx) {
                                var fkId2 = String(rawFk.uniqueId || rawFk.id || rawFk.cardNo || '');
                                var fkNo2 = String(rawFk.cardNo || fkId2);
                                if (fkId2) usedMirrorIds.add(fkId2);
                                if (fkNo2) usedMirrorNos.add(fkNo2);
                                existing.push(Object.assign({}, rawFk, { label: gCandEx.label }));
                                additionalAdjutantTroopBuff += gCandEx.genTMult;
                                additionalAdjutantGenBuff += gCandEx.genGMult;
                                adjutantAddedTroopBuffMap[mCard.uniqueId] += gCandEx.genTMult;
                                adjutantAddedGenBuffMap[mCard.uniqueId] += gCandEx.genGMult;
                            } else {
                                existing.push(Object.assign({}, rawFk, {
                                    label: rawFk.label || ((st.isBu ? '[武]' : st.isGo ? '[護]' : st.isEi ? '[鋭]' : '') + '一般副将')
                                }));
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
                        var gCand = buildDefGeneralAdjutantCand(gc, targetTroopData, 'SUN', master.isExactDefendedBaseSlot, master.isGuardMaster, master.targetMasterCost);
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

            // 防衛対象拠点（本拠または拠点＋）に配置される武将一覧で同一勢力（覇＝全勢力扱い含む）をカウント
            var targetDeckItems = (isHonkyoDef ? hManualSlots.concat(pickedHPassives) : kManualSlots.concat(pickedKPassives)).concat(pickedNanbanTaishu);

            var pureTroopMult = additionalAdjutantTroopBuff;
            var pureGenMult = additionalAdjutantGenBuff;
            var dmgReduceSum = 0;

            allSelectedItems.forEach(function(it) {
                pureTroopMult += SharedDB.safeNum(it.rawTMult, 0);
                pureGenMult += SharedDB.safeNum(it.rawGMult, 0);
                if (it.perSameCountryMult > 0 && it.reqCountry) {
                    var sameCnt = countMatchingCountryCards(targetDeckItems, it.reqCountry);
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
            AppCards.setStatusLog("兵士防御最適化完了 (Ver. 2.08f / " + modeTag + "): 総合防御力 " + finalTotalDefense.toLocaleString());
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
                            <span>南蛮太守 配置（5枠 / パッシブ防御のみ・コスト0消費・拠点縛り無視）</span>
                        </span>
                        <span class="text-xs font-mono bg-amber-500 text-black font-extrabold px-2.5 py-0.5 rounded shadow">
                            太守節約コスト: ${setup.nanbanSavedCost.toFixed(1)}C 分（実質タダ配置）
                        </span>
                    </div>
                    <div class="text-xs text-amber-200/80 mb-3">
                        <i class="fa-solid fa-circle-info text-amber-400 mr-1"></i>防御系パッシブスキルのみを対象に、コスト1.0等の軽量パッシブは表デッキへ温存しつつ、高コスト（4.5C・4.0C等）の強力パッシブ武将を太守5枠へ優先配置しています。
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
                            <span class="bg-sky-600 text-white text-[10px] font-bold px-2 py-0.5 rounded shadow">兵士防御計算結果 (Ver. 2.08f)</span>
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