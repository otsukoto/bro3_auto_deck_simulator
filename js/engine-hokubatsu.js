// ========================================================
// 【北伐統合デッキ計算エンジン】js/engine-hokubatsu.js (Ver. 1.01)
// 役割：北伐引率・単騎統合デッキ最適化、全アクティブ同時発動、一般副将役割別評価（「攻:」持ちサポート誤爆防止）＆合計値比較
// ========================================================
window.HokubatsuEngine = (function() {
    var isBuff10 = false;
    var currentHokuSetup = null;
    var activeSubView = 'LEAD';
    var HOKUBATSU_TROOP_COUNT = 100000;

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

    function getKakuseiMult(card) {
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

    function checkHokuAdjutantSafe(masterCard, fkCard, mirrorInfo, usedAdjutantCost, remSlots, remMaxFk) {
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

        var costFitBonus = 0;
        if (remSlots === 2 && remMaxFk >= 1.99 && remMaxFk <= 2.51) {
            costFitBonus = (fkCost <= 1.0 + 1e-6) ? 6000 : -2000;
        } else {
            costFitBonus = fkCost * 250;
        }

        if (mirrorInfo) {
            if (fkRarity !== mRarity) return { ok: false, rate: 0 };
            if (String(mirrorInfo.rarity || 'SL').toUpperCase() !== mRarity) return { ok: false, rate: 0 };

            var buBonusScore = st.atkBonus * 2;
            var effRate = SharedDB.calcAdjutantEffectiveCopyRate(masterCard, fkCard, mirrorInfo);
            var dispLabel = formatMirrorLabelWithCost(mirrorInfo, effRate);

            if (mirrorInfo.type === 'senkyo') {
                if (mRarity !== 'SL') return { ok: false, rate: 0 };
                return { ok: true, rate: effRate, atkBonus: st.atkBonus, defBonus: st.defBonus, spdBonus: st.spdBonus, label: dispLabel, score: 500000 + buBonusScore + mOrigCost * 10000 + costFitBonus };
            } else if (mirrorInfo.type === 'musume_renkyo') {
                if (SharedDB.isFemaleOrOtherBusho && SharedDB.isFemaleOrOtherBusho(masterCard)) {
                    return { ok: true, rate: effRate, atkBonus: st.atkBonus, defBonus: st.defBonus, spdBonus: st.spdBonus, label: dispLabel, score: 300000 + buBonusScore + effRate * 1000 + costFitBonus };
                }
                return { ok: false, rate: 0 };
            } else if (mirrorInfo.type === 'renkyo') {
                if (mCountry && mCountry !== '改' && mCountry === mirrorInfo.force) {
                    return { ok: true, rate: effRate, atkBonus: st.atkBonus, defBonus: st.defBonus, spdBonus: st.spdBonus, label: dispLabel, score: 300000 + buBonusScore + effRate * 1000 + costFitBonus };
                }
                return { ok: false, rate: 0 };
            } else if (mirrorInfo.type === 'meikyo') {
                return { ok: true, rate: effRate, atkBonus: st.atkBonus, defBonus: st.defBonus, spdBonus: st.spdBonus, label: dispLabel, score: 100000 + buBonusScore + effRate * 1000 + costFitBonus };
            }
            return { ok: false, rate: 0 };
        } else {
            return {
                ok: true,
                rate: 0,
                atkBonus: st.atkBonus,
                defBonus: st.defBonus,
                spdBonus: st.spdBonus,
                label: (st.isBu ? '[武]' : st.isEi ? '[鋭]' : '') + '一般副将',
                score: 10000 + (st.spdBonus * 50) + (st.atkBonus * 2) + costFitBonus
            };
        }
    }

    function parseHokuSkill(skill, targetTroopData, weatherObj) {
        var empty = {
            tMult: 0, gMult: 0, speedPct: 0, troopSpeedPct: 0,
            rawGekirei: 0, rawRairei: 0,
            isPassive: false, isManualSupport: false, isAttackLead: false,
            isGekirei: false, isRairei: false, mustBeSameBase: true
        };
        if (!skill || typeof skill !== 'object') return empty;
        var name = String(skill.name || '').trim();
        var rawDesc = String(skill.description || '').trim();

        if (name.indexOf('覚:') === 0 || name.indexOf('副覚:') === 0 || name.indexOf('覚醒') !== -1) return empty;
        if (isDuelSkill(skill)) return empty;

        var normDesc = rawDesc.replace(/(\d),(\d{3})/g, '$1$2');
        var full = (normDesc + ' ' + name).trim();
        if (!full) return empty;

        var res = Object.assign({}, empty);

        if (full.indexOf('自動で発動') !== -1 || full.indexOf('自動発動') !== -1 || full.indexOf('全滅時も発動') !== -1 || full.indexOf('パッシブ') !== -1 || full.indexOf('警悟') !== -1) {
            res.isPassive = true;
        }
        if (name.indexOf('檄令') !== -1 || normDesc.indexOf('主将の攻撃力が増加') !== -1 || normDesc.indexOf('全武将の攻撃力が増加') !== -1) {
            res.isGekirei = true;
            res.isPassive = true;
        }
        if (name.indexOf('雷令') !== -1 || normDesc.indexOf('全武将の移動速度が増加') !== -1) {
            res.isRairei = true;
            res.isPassive = true;
        }

        var isAllBases = (
            (normDesc.indexOf('自拠点') !== -1 || normDesc.indexOf('全ての自拠点') !== -1 || normDesc.indexOf('すべての自拠点') !== -1 || normDesc.indexOf('全拠点') !== -1 || normDesc.indexOf('全ての拠点') !== -1) &&
            normDesc.indexOf('セットした拠点') === -1 &&
            normDesc.indexOf('この武将をセットした拠点') === -1 &&
            normDesc.indexOf('所属拠点が同一') === -1
        );
        res.mustBeSameBase = !isAllBases;

        var isAttackPrefix = (name.indexOf('攻:') === 0 || name.indexOf('副攻:') === 0 || name.indexOf('攻防:') === 0);
        var isDefPrefix = (name.indexOf('防:') === 0 || name.indexOf('副防:') === 0);

        if (isAttackPrefix) res.isAttackLead = true;
        if (isDefPrefix && !res.isPassive) res.isManualSupport = true;

        var wMult = 1.0;
        var mSun = full.match(/晴天候時(?:は|の時)?[^0-9]*?([0-9\.]+)倍/);
        if (mSun && weatherObj === 'SUN') wMult = Math.max(wMult, parseFloat(mSun[1]));
        var mBad = full.match(/(?:荒天時|曇[、・\s]*雨[、・\s]*雪天候時)(?:は|の時)?[^0-9]*?([0-9\.]+)倍/);
        if (mBad && (weatherObj === 'CLOUD' || weatherObj === 'RAIN' || weatherObj === 'SNOW')) {
            wMult = Math.max(wMult, parseFloat(mBad[1]));
        }

        var mSpd = normDesc.match(/(?:移動速度|移速)[がをのは]?([0-9\.]+)[%％]/);
        if (mSpd) {
            var spVal = parseFloat(mSpd[1]) * wMult;
            res.speedPct = spVal;
            if (/(?:全兵|全ての兵士|全軍|全兵科)/.test(normDesc)) {
                res.troopSpeedPct = spVal;
            }
        }

        var troopComp = false;
        if (targetTroopData) {
            var words = ['全兵士', '全ての兵士', '全軍', '全兵科', '全拠点', '全兵', targetTroopData.name, targetTroopData.base, targetTroopData.sub];
            if (targetTroopData.type === '天兵') words.push('天兵', '天兵科');
            else if (targetTroopData.type === '鋭兵') words.push('鋭兵', '鋭兵科');
            else if (targetTroopData.type === '上級兵') words.push('上級兵', '上級兵科');

            troopComp = words.some(function(w) { return normDesc.indexOf(w) !== -1; });
            if (troopComp && normDesc.indexOf('天兵を除く') !== -1 && targetTroopData.type === '天兵') {
                troopComp = false;
            }
        } else {
            troopComp = /(?:全兵士|全ての兵士|全軍|全兵科|全拠点|全兵)/.test(normDesc);
        }

        var tMult = 0, gMult = 0;
        var mAll = normDesc.match(/(?:全兵士|全ての兵士|全軍|全兵科|全拠点|全兵|[^\s、。]+兵)[、，・,\/\s]+(?:[^\s、。]+科)?武将.*?攻撃(?:力)?[がをのは]?([0-9\.]+)[%％]/);
        if (mAll) {
            if (troopComp) tMult = parseFloat(mAll[1]);
            gMult = parseFloat(mAll[1]);
        } else {
            var mGen = normDesc.match(/(?:全武将|[^\s、。・]*?科武将|武将|自身).*?攻撃(?:力)?[がをのは]?([0-9\.]+)[%％]/);
            if (mGen) gMult = parseFloat(mGen[1]);

            if (troopComp) {
                var mTr = normDesc.match(/(?<!武将の)攻撃(?:力)?[がをのは]?([0-9\.]+)[%％]/);
                if (mTr) {
                    tMult = parseFloat(mTr[1]);
                    if (gMult === 0 && normDesc.indexOf('全軍') !== -1) gMult = tMult;
                }
            }
            if (isAttackPrefix && tMult === 0 && gMult === 0) {
                var mSingle = normDesc.match(/攻撃(?:力)?[がをのは]?([0-9\.]+)[%％]/);
                if (mSingle) gMult = parseFloat(mSingle[1]);
            }
        }

        var mExtra = normDesc.match(/更に.*?攻撃(?:力)?[がをのは]?([0-9\.]+)[%％]/);
        if (mExtra) {
            var exV = parseFloat(mExtra[1]);
            var okWeather = true;
            if (normDesc.indexOf('晴天候') !== -1 && weatherObj !== 'SUN') okWeather = false;
            if ((normDesc.indexOf('曇') !== -1 || normDesc.indexOf('雨') !== -1 || normDesc.indexOf('雪') !== -1 || normDesc.indexOf('荒天') !== -1) && ['CLOUD', 'RAIN', 'SNOW'].indexOf(weatherObj) === -1) okWeather = false;
            if (okWeather) {
                if (tMult > 0) tMult += exV;
                if (gMult > 0) gMult += exV;
            }
        }

        res.tMult = tMult * wMult;
        res.gMult = gMult * wMult;
        return res;
    }

    function evaluateCardHoku(card, targetTroopData, masterRarity, masterCost, excludeSubSkills) {
        var skills = (card && card.skills) || [];
        var empty = {
            tMult: 0, gMult: 0, speedPct: 0, troopSpeedPct: 0,
            firstTMult: 0, firstGMult: 0, firstSpeedPct: 0, firstTroopSpeedPct: 0,
            rawGekirei: 0, firstGekirei: 0, rawRairei: 0, firstRairei: 0,
            isAttackLead: false, isManualSupport: false, isPassiveSupport: false,
            isGekirei: false, isRairei: false, mustBeSameBase: true, bestWeather: 'SUN'
        };
        if (skills.length === 0) return empty;

        var weathers = ['SUN', 'CLOUD', 'RAIN', 'SNOW'];
        var bestResult = null;
        var bestProbeScore = -1;
        var isHa = SharedDB.isHaBusho(card);

        for (var wi = 0; wi < weathers.length; wi++) {
            var w = weathers[wi];
            var s0 = skills[0];
            var p0 = parseHokuSkill(s0, targetTroopData, w);
            var gk0 = (!isDuelSkill(s0)) ? SharedDB.getGekireiBonus(s0, card.rarity, masterCost) : { bonus: 0, series: null };
            var rr0 = (!isDuelSkill(s0)) ? HokubatsuDB.getRaireiSpeedBonus(s0, masterRarity) : { addSpeed: 0, baseSpeed: 0, series: null };

            var baseGk = (gk0 && gk0.bonus) || 0;
            var baseRr = (rr0 && rr0.addSpeed) || 0;

            var tSum = p0.tMult;
            var gSum = p0.gMult;
            var spdSum = p0.speedPct;
            var tSpdSum = p0.troopSpeedPct;
            var gkSum = baseGk;
            var rrSum = baseRr;

            for (var idx = 1; idx < skills.length; idx++) {
                var sk = skills[idx];
                if (!sk || typeof sk !== 'object') continue;
                var sName = String(sk.name || '').trim();

                if (sName.indexOf('覚:') === 0 || sName.indexOf('副覚:') === 0 || sName.indexOf('覚醒') !== -1) continue;
                if (isDuelSkill(sk)) continue;

                var isFromAdj = (sName.indexOf('副:') === 0 || sName.indexOf('副変:') === 0 || sName.indexOf('副攻:') === 0 || sName.indexOf('副防:') === 0 || sName.indexOf('副ﾃﾞｭｴﾙ:') === 0);
                if (excludeSubSkills && !isHa && isFromAdj) continue;

                var isSelfMirror = !isFromAdj && (
                    sName.indexOf('変:') === 0 ||
                    sName.indexOf('主将の') !== -1 ||
                    sName.indexOf('明鑑') !== -1 ||
                    sName.indexOf('王春の') !== -1 ||
                    (sName.indexOf('明鏡') !== -1 && sName.indexOf('副将の') === -1) ||
                    (isHa && sName.indexOf('副変:') === 0)
                );

                var pi = parseHokuSkill(sk, targetTroopData, w);
                var gki = SharedDB.getGekireiBonus(sk, card.rarity, masterCost);
                var rri = HokubatsuDB.getRaireiSpeedBonus(sk, masterRarity);

                if (isSelfMirror) {
                    var hasWritten = (pi.tMult > 0 || pi.gMult > 0 || pi.speedPct > 0 || (gki && gki.bonus > 0) || (rri && rri.addSpeed > 0));
                    if (!hasWritten) {
                        var rate = SharedDB.getMasterMirrorCopyRate(sk);
                        tSum += p0.tMult * rate;
                        gSum += p0.gMult * rate;
                        spdSum += p0.speedPct * rate;
                        tSpdSum += p0.troopSpeedPct * rate;
                        gkSum += Math.floor(baseGk * rate);
                        rrSum += Math.round(baseRr * rate * 10) / 10;
                        continue;
                    }
                }

                tSum += pi.tMult;
                gSum += pi.gMult;
                spdSum += pi.speedPct;
                tSpdSum += pi.troopSpeedPct;
                gkSum += (gki && gki.bonus) || 0;
                rrSum += (rri && rri.addSpeed) || 0;
            }

            var probeScore = tSum * 100 + gSum * 10 + gkSum * 0.5 + spdSum * 5 + rrSum * 20;
            if (probeScore > bestProbeScore) {
                bestProbeScore = probeScore;
                bestResult = {
                    tMult: tSum,
                    gMult: gSum,
                    speedPct: spdSum,
                    troopSpeedPct: tSpdSum,
                    firstTMult: p0.tMult,
                    firstGMult: p0.gMult,
                    firstSpeedPct: p0.speedPct,
                    firstTroopSpeedPct: p0.troopSpeedPct,
                    rawGekirei: gkSum,
                    firstGekirei: baseGk,
                    rawRairei: rrSum,
                    firstRairei: baseRr,
                    isAttackLead: p0.isAttackLead,
                    isManualSupport: p0.isManualSupport,
                    isPassiveSupport: (!p0.isAttackLead && !p0.isManualSupport && (tSum > 0 || gSum > 0 || gkSum > 0 || spdSum > 0 || rrSum > 0)),
                    isGekirei: (gkSum > 0),
                    isRairei: (rrSum > 0),
                    mustBeSameBase: p0.mustBeSameBase,
                    bestWeather: w
                };
            }
        }

        return bestResult || empty;
    }

    // =========================================================================
    // 一般武将を副将にセットした時の第1スキル評価（役割別制限＆合計値比較用）
    // ・「攻:」アクティブスキルや単騎専用スキルが第1枠の武将は、純粋なエース(ACE)以外には一切効果が出ないため除外
    // ・サポート陣(FRONT/BACK/SPEED)には、その陣で有効な「防:」や支援第1スキル持ちのみを候補化
    // =========================================================================
    function buildGeneralAdjutantCandidateForMaster(gCard, entry, primaryTroop) {
        if (!gCard || SharedDB.isHaBusho(gCard) || SharedDB.isMirrorCard(gCard.name)) return null;
        var skills = gCard.skills || [];
        if (skills.length === 0 || !skills[0]) return null;
        var s0 = skills[0];
        var sName = String(s0.name || '').trim();
        var sDesc = String(s0.description || '').trim();
        if (!sName || sName.indexOf('覚:') === 0 || sName.indexOf('副覚:') === 0 || isDuelSkill(s0)) return null;

        var isAttackOrSelfFirstSkill = (
            sName.indexOf('攻:') === 0 ||
            sName.indexOf('副攻:') === 0 ||
            sName.indexOf('攻防:') === 0 ||
            sName.indexOf('副攻防:') === 0 ||
            /(?:自身の攻撃力|この武将の攻撃力|全滅時も発動|討伐ゲージ|持ち帰る資源)/.test(sDesc)
        );

        // 主将が前衛・後衛・速度陣のいずれかに配置されている場合は「攻:」一般副将を一切付けない
        var isSupportRole = (entry.inLead && entry.leadSlot && entry.leadSlot.role !== 'ACE') ||
                            (entry.inSolo && entry.soloSlot && entry.soloSlot.role !== 'ACE');

        if (isAttackOrSelfFirstSkill && (entry.bestRank !== 1 || isSupportRole)) {
            return null;
        }

        var weathers = ['SUN', 'CLOUD', 'RAIN', 'SNOW'];
        var bestLeadT = 0, bestLeadG = 0, bestLeadSpd = 0;
        var bestSoloG = 0, bestSoloSpd = 0;
        var mustBeSameBase = true;

        for (var wi = 0; wi < weathers.length; wi++) {
            var w = weathers[wi];
            var pLead = parseHokuSkill(s0, primaryTroop, w);
            if (pLead.tMult > bestLeadT) bestLeadT = pLead.tMult;
            if (pLead.gMult > bestLeadG) bestLeadG = pLead.gMult;
            var lSpd = pLead.troopSpeedPct || pLead.speedPct;
            if (lSpd > bestLeadSpd) bestLeadSpd = lSpd;
            if (!pLead.mustBeSameBase) mustBeSameBase = false;

            var pSolo = parseHokuSkill(s0, null, w);
            if (pSolo.gMult > bestSoloG) bestSoloG = pSolo.gMult;
            if (pSolo.speedPct > bestSoloSpd) bestSoloSpd = pSolo.speedPct;
        }

        var gk0 = SharedDB.getGekireiBonus(s0, gCard.rarity, 4.5);
        var rr0 = HokubatsuDB.getRaireiSpeedBonus(s0, 'SL');
        var bestSoloGk = (gk0 && gk0.bonus) || 0;
        var bestSoloRr = (rr0 && rr0.addSpeed) || 0;

        var genTMult = 0;
        var genGMult = 0;
        var genRaw = 0;
        var labelBadge = '';

        var cleanSName = sName.replace(/^(?:攻防|攻|防|変|副攻|副防|副変):/, '').replace(/LV[0-9]+$/i, '');

        if (entry.bestRank === 1 && !isSupportRole) {
            if (entry.inLead) {
                genTMult += bestLeadT;
                genGMult += bestLeadG;
            }
            if (entry.inSolo) {
                genGMult += bestSoloG;
            }
            if (genTMult <= 0 && genGMult <= 0) return null;
            var maxPct = Math.max(genTMult, genGMult);
            labelBadge = '[副]' + cleanSName + ' +' + SharedDB.formatBuffNum(maxPct) + '%';
        } else if (entry.bestRank === 2 || entry.bestRank === 3 || isSupportRole) {
            if (isAttackOrSelfFirstSkill) return null;
            if (entry.bestRank === 3 && mustBeSameBase) return null;

            if (entry.inLead) {
                genTMult += bestLeadT;
            }
            if (entry.inSolo) {
                genGMult += bestSoloG;
                genRaw += bestSoloGk;
            }
            if (genTMult <= 0 && genGMult <= 0 && genRaw <= 0) return null;

            if (genTMult > 0) {
                labelBadge = '[副]' + cleanSName + ' 兵+' + SharedDB.formatBuffNum(genTMult) + '%';
            } else if (genRaw > 0) {
                labelBadge = '[副]' + cleanSName + ' 檄+' + genRaw.toLocaleString();
            } else {
                labelBadge = '[副]' + cleanSName + ' 将+' + SharedDB.formatBuffNum(genGMult) + '%';
            }
        } else if (entry.bestRank === 4) {
            if (isAttackOrSelfFirstSkill) return null;
            if (entry.inLead) {
                genTMult += bestLeadSpd;
            }
            if (entry.inSolo) {
                genGMult += bestSoloSpd;
                genRaw += bestSoloRr;
            }
            if (genTMult <= 0 && genGMult <= 0 && genRaw <= 0) return null;

            if (genRaw > 0) {
                labelBadge = '[副]' + cleanSName + ' 雷+' + genRaw;
            } else {
                labelBadge = '[副]' + cleanSName + ' 速+' + SharedDB.formatBuffNum(Math.max(genTMult, genGMult)) + '%';
            }
        }

        return {
            card: gCard,
            uniqueId: gCard.uniqueId,
            cardNo: gCard.cardNo,
            genTMult: genTMult,
            genGMult: genGMult,
            genRaw: genRaw,
            label: labelBadge,
            genStats: {
                leadT: entry.inLead ? bestLeadT : 0,
                leadG: entry.inLead ? bestLeadG : 0,
                leadSpd: entry.inLead ? bestLeadSpd : 0,
                soloG: entry.inSolo ? bestSoloG : 0,
                soloSpd: entry.inSolo ? bestSoloSpd : 0,
                soloGk: entry.inSolo ? bestSoloGk : 0,
                soloRr: entry.inSolo ? bestSoloRr : 0
            }
        };
    }

    function preAssignTeisenkyoToSupport(supportPools, teisenMirrors, preAssignedMap, usedTeisenIds) {
        if (!teisenMirrors || teisenMirrors.length === 0) return;

        var candidates = [];
        var seenCands = new Set();
        supportPools.forEach(function(pool) {
            pool.forEach(function(item) {
                var c = item.card;
                if (seenCands.has(c.uniqueId)) return;
                var origC = SharedDB.safeNum(c.originalCost !== undefined ? c.originalCost : c.cost, 4.5);
                if (!SharedDB.isHaBusho(c) &&
                    String(c.rarity || '').toUpperCase() === 'SL' &&
                    SharedDB.safeNum(c.maxFukushoCost, 0) > 0 &&
                    origC > 1.0) {
                    seenCands.add(c.uniqueId);
                    candidates.push(item);
                }
            });
        });

        candidates.sort(function(a, b) {
            var kA = getKakuseiMult(a.card);
            var kB = getKakuseiMult(b.card);
            var copyValA = (SharedDB.safeNum(a.firstTMult, 0) + SharedDB.safeNum(a.firstGMult, 0)) / kA + (SharedDB.safeNum(a.firstGekirei, 0) / kA) * 0.1;
            var copyValB = (SharedDB.safeNum(b.firstTMult, 0) + SharedDB.safeNum(b.firstGMult, 0)) / kB + (SharedDB.safeNum(b.firstGekirei, 0) / kB) * 0.1;
            var scoreA = (a.effectiveCost - 1.0) * 10000 + copyValA;
            var scoreB = (b.effectiveCost - 1.0) * 10000 + copyValB;
            return scoreB - scoreA;
        });

        var count = Math.min(teisenMirrors.length, candidates.length);
        for (var i = 0; i < count; i++) {
            var targetItem = candidates[i];
            var tMirror = teisenMirrors[i];
            preAssignedMap[targetItem.card.uniqueId] = tMirror;
            usedTeisenIds.add(tMirror.uniqueId);
        }

        supportPools.forEach(function(pool) {
            pool.forEach(function(item) {
                if (preAssignedMap[item.card.uniqueId]) {
                    var kMult = getKakuseiMult(item.card);
                    var bonus100 = (SharedDB.safeNum(item.firstTMult, 0) + SharedDB.safeNum(item.firstGMult, 0)) / kMult;
                    item.effectiveCost = 1.0;
                    item.cost = 1.0;
                    item.hasTeisenkyo = true;
                    item.scoreValue += bonus100 * 0.8;
                }
            });
        });
    }

    function assignUnifiedHokubatsuAdjutants(leadSlots, soloSlots, allMirrorPool, allGeneralPool, preTeisenMap, isReassignMode, primaryTroop) {
        var ROLE_RANK = { 'ACE': 1, 'FRONT': 2, 'BACK': 3, 'SPEED': 4 };

        var uniqueMastersMap = Object.create(null);
        var registerSlot = function(slot, setType) {
            var uid = slot.card.uniqueId;
            var rank = ROLE_RANK[slot.role] || 4;
            if (!uniqueMastersMap[uid]) {
                uniqueMastersMap[uid] = {
                    card: slot.card,
                    bestRank: rank,
                    inLead: false,
                    inSolo: false,
                    leadSlot: null,
                    soloSlot: null,
                    copyImpactScore: 0
                };
            }
            var entry = uniqueMastersMap[uid];
            if (rank < entry.bestRank) entry.bestRank = rank;
            if (setType === 'LEAD') {
                entry.inLead = true;
                entry.leadSlot = slot;
            } else {
                entry.inSolo = true;
                entry.soloSlot = slot;
            }
        };

        leadSlots.forEach(function(s) { registerSlot(s, 'LEAD'); });
        soloSlots.forEach(function(s) { registerSlot(s, 'SOLO'); });

        var unifiedMasters = Object.values(uniqueMastersMap);

        unifiedMasters.forEach(function(entry) {
            var mCard = entry.card;
            var kMult = getKakuseiMult(mCard);
            var impact = 0;

            if (entry.inLead && entry.leadSlot) {
                var ls = entry.leadSlot;
                var firstLeadT = SharedDB.safeNum(ls.firstTMult, 0) / kMult;
                var firstLeadG = SharedDB.safeNum(ls.firstGMult, 0) / kMult;
                impact += (15500000 * (firstLeadT / 100)) + (SharedDB.safeNum(mCard.baseAttack, 1000) * (firstLeadG / 100));
            }
            if (entry.inSolo && entry.soloSlot) {
                var ss = entry.soloSlot;
                var firstSoloG = SharedDB.safeNum(ss.firstGMult, 0) / kMult;
                var firstSoloGk = SharedDB.safeNum(ss.firstGekirei, 0) / kMult;
                impact += (450000 * (firstSoloG / 100)) + (firstSoloGk * 150);
                if (ss.role === 'ACE') {
                    impact += 8000000;
                }
            }
            entry.copyImpactScore = impact;
        });

        var assignedMap = Object.create(null);
        var leadAddedStatsMap = Object.create(null);
        var soloAddedStatsMap = Object.create(null);
        var usedMirrorUniqueIds = new Set();

        unifiedMasters.forEach(function(entry) {
            var uid = entry.card.uniqueId;
            assignedMap[uid] = [];
            leadAddedStatsMap[uid] = { tBuff: 0, gBuff: 0, spdPct: 0, gkAdd: 0, rrAdd: 0, atkBonus: 0, spdBonus: 0 };
            soloAddedStatsMap[uid] = { tBuff: 0, gBuff: 0, spdPct: 0, gkAdd: 0, rrAdd: 0, atkBonus: 0, spdBonus: 0 };
        });

        var applyAdjutantToEntry = function(entry, fkObj) {
            var uid = entry.card.uniqueId;
            var kMult = getKakuseiMult(entry.card);
            var rRate = SharedDB.safeNum(fkObj.copyRate, 0) / 100;
            var atkB = SharedDB.safeNum(fkObj.atkBonus, 0);
            var spdB = SharedDB.safeNum(fkObj.spdBonus, 0);

            if (entry.inLead && entry.leadSlot) {
                var ls = entry.leadSlot;
                leadAddedStatsMap[uid].atkBonus += atkB;
                leadAddedStatsMap[uid].spdBonus += spdB;
                if (fkObj.isGeneralSkill && fkObj.genStats) {
                    leadAddedStatsMap[uid].tBuff += SharedDB.safeNum(fkObj.genStats.leadT, 0);
                    leadAddedStatsMap[uid].gBuff += SharedDB.safeNum(fkObj.genStats.leadG, 0);
                    leadAddedStatsMap[uid].spdPct += SharedDB.safeNum(fkObj.genStats.leadSpd, 0);
                } else if (rRate > 0) {
                    leadAddedStatsMap[uid].tBuff += (SharedDB.safeNum(ls.firstTMult, 0) / kMult) * rRate;
                    leadAddedStatsMap[uid].gBuff += (SharedDB.safeNum(ls.firstGMult, 0) / kMult) * rRate;
                    leadAddedStatsMap[uid].spdPct += (SharedDB.safeNum(ls.firstTroopSpeedPct || ls.firstSpeedPct, 0) / kMult) * rRate;
                    leadAddedStatsMap[uid].gkAdd += Math.floor((SharedDB.safeNum(ls.firstGekirei, 0) / kMult) * rRate);
                    leadAddedStatsMap[uid].rrAdd += Math.round((SharedDB.safeNum(ls.firstRairei, 0) / kMult) * rRate * 100) / 100;
                }
            }
            if (entry.inSolo && entry.soloSlot) {
                var ss = entry.soloSlot;
                soloAddedStatsMap[uid].atkBonus += atkB;
                soloAddedStatsMap[uid].spdBonus += spdB;
                if (fkObj.isGeneralSkill && fkObj.genStats) {
                    soloAddedStatsMap[uid].gBuff += SharedDB.safeNum(fkObj.genStats.soloG, 0);
                    soloAddedStatsMap[uid].spdPct += SharedDB.safeNum(fkObj.genStats.soloSpd, 0);
                    soloAddedStatsMap[uid].gkAdd += Math.floor(SharedDB.safeNum(fkObj.genStats.soloGk, 0));
                    soloAddedStatsMap[uid].rrAdd += Math.round(SharedDB.safeNum(fkObj.genStats.soloRr, 0) * 100) / 100;
                } else if (rRate > 0) {
                    soloAddedStatsMap[uid].tBuff += (SharedDB.safeNum(ss.firstTMult, 0) / kMult) * rRate;
                    soloAddedStatsMap[uid].gBuff += (SharedDB.safeNum(ss.firstGMult, 0) / kMult) * rRate;
                    soloAddedStatsMap[uid].spdPct += (SharedDB.safeNum(ss.firstSpeedPct, 0) / kMult) * rRate;
                    soloAddedStatsMap[uid].gkAdd += Math.floor((SharedDB.safeNum(ss.firstGekirei, 0) / kMult) * rRate);
                    soloAddedStatsMap[uid].rrAdd += Math.round((SharedDB.safeNum(ss.firstRairei, 0) / kMult) * rRate * 100) / 100;
                }
            }
        };

        var priorityMasters = unifiedMasters.filter(function(e) { return e.bestRank <= 3; });
        var speedOnlyMasters = unifiedMasters.filter(function(e) { return e.bestRank === 4; });

        if (!isReassignMode) {
            unifiedMasters.forEach(function(entry) {
                var mCard = entry.card;
                if (SharedDB.isHaBusho(mCard) || !Array.isArray(mCard.fukusho)) return;
                var list = [];
                mCard.fukusho.forEach(function(rawFk) {
                    var inf = SharedDB.getMirrorSkillInfo(rawFk);
                    var st = SharedDB.getAdjutantStatusEffect(rawFk, inf);
                    var rate = inf ? SharedDB.calcAdjutantEffectiveCopyRate(mCard, rawFk, inf) : 0;
                    var wrapped = Object.assign({}, rawFk, {
                        copyRate: rate,
                        label: inf ? formatMirrorLabelWithCost(inf, rate) : (rawFk.label || ''),
                        atkBonus: st.atkBonus,
                        spdBonus: st.spdBonus,
                        info: inf
                    });
                    list.push(wrapped);
                    applyAdjutantToEntry(entry, wrapped);
                });
                assignedMap[mCard.uniqueId] = list;
            });
            return {
                assignedMap: assignedMap,
                leadAddedStatsMap: leadAddedStatsMap,
                soloAddedStatsMap: soloAddedStatsMap,
                frontBackUsedCount: 0,
                speedLeftoverUsedCount: 0
            };
        }

        priorityMasters.sort(function(a, b) {
            if (Math.abs(b.copyImpactScore - a.copyImpactScore) > 1) {
                return b.copyImpactScore - a.copyImpactScore;
            }
            return a.bestRank - b.bestRank;
        });

        var allMasterUniqueIds = new Set(Object.keys(uniqueMastersMap));
        var availableMirrors = allMirrorPool.filter(function(m) {
            return !allMasterUniqueIds.has(m.uniqueId);
        });
        var availableGenerals = allGeneralPool.filter(function(c) {
            return !allMasterUniqueIds.has(c.uniqueId);
        });

        var curCostMap = Object.create(null);
        unifiedMasters.forEach(function(e) { curCostMap[e.card.uniqueId] = 0; });

        // 【ステップ0】前衛・後衛に事前予約された「帝仙鏡」を確定装着
        priorityMasters.forEach(function(entry) {
            var uid = entry.card.uniqueId;
            var tMirror = preTeisenMap && preTeisenMap[uid];
            if (!tMirror || usedMirrorUniqueIds.has(tMirror.uniqueId)) return;

            var mCard = entry.card;
            var mRarity = String(mCard.rarity || 'SL').toUpperCase();
            var maxSlots = mRarity === 'SL' ? 2 : 1;
            var maxFk = SharedDB.safeNum(mCard.maxFukushoCost, 0);
            var remSlots = maxSlots - assignedMap[uid].length;
            var remMaxFk = maxFk - curCostMap[uid];
            if (remSlots <= 0) return;

            var elig = checkHokuAdjutantSafe(mCard, tMirror.card, tMirror.info, curCostMap[uid], remSlots, remMaxFk);
            if (!elig.ok) return;

            var fkObj = {
                name: tMirror.card.name,
                cardNo: tMirror.cardNo,
                imageSrc: tMirror.card.imageSrc || (tMirror.cardNo ? 'https://3gokushi.jp/img/card/card_' + tMirror.cardNo + '.jpg' : ''),
                rarity: 'SL',
                cost: SharedDB.safeNum(tMirror.card.cost, 1.0),
                baseAttack: SharedDB.safeNum(tMirror.card.baseAttack, 0),
                atkBonus: SharedDB.safeNum(elig.atkBonus, 0),
                spdBonus: SharedDB.safeNum(elig.spdBonus, 0),
                label: elig.label,
                copyRate: 100,
                uniqueId: tMirror.uniqueId,
                info: tMirror.info
            };

            usedMirrorUniqueIds.add(fkObj.uniqueId);
            curCostMap[uid] += fkObj.cost;
            assignedMap[uid].push(fkObj);
            applyAdjutantToEntry(entry, fkObj);
        });

        // 【ステップ1】エース・前衛・後衛の副将アサイン（副将専用スキル vs 役割適合一般副将の第1スキルを合計値比較）
        priorityMasters.forEach(function(entry) {
            var mCard = entry.card;
            var maxFk = SharedDB.safeNum(mCard.maxFukushoCost, 0);
            if (SharedDB.isHaBusho(mCard) || maxFk <= 0) return;

            var mRarity = String(mCard.rarity || 'SL').toUpperCase();
            var maxSlots = mRarity === 'SL' ? 2 : 1;
            var uid = mCard.uniqueId;
            var currentAssigned = assignedMap[uid];
            if (currentAssigned.length >= maxSlots) return;

            var kMult = getKakuseiMult(mCard);
            var ls = entry.inLead ? entry.leadSlot : null;
            var ss = entry.inSolo ? entry.soloSlot : null;

            var firstLeadT = ls ? (SharedDB.safeNum(ls.firstTMult, 0) / kMult) : 0;
            var firstLeadG = ls ? (SharedDB.safeNum(ls.firstGMult, 0) / kMult) : 0;
            var firstSoloG = ss ? (SharedDB.safeNum(ss.firstGMult, 0) / kMult) : 0;
            var firstSoloGk = ss ? (SharedDB.safeNum(ss.firstGekirei, 0) / kMult) : 0;

            var wGenEff = 0;
            if (entry.inSolo) wGenEff += 4500;
            if (entry.inLead) wGenEff += SharedDB.safeNum(mCard.baseAttack, 1000) / 100;

            var unusedMirrors = availableMirrors.filter(function(fk) {
                return !usedMirrorUniqueIds.has(fk.uniqueId);
            });

            var validGeneralCands = [];
            for (var gi = 0; gi < availableGenerals.length; gi++) {
                var gCard = availableGenerals[gi];
                if (usedMirrorUniqueIds.has(gCard.uniqueId)) continue;
                var gCand = buildGeneralAdjutantCandidateForMaster(gCard, entry, primaryTroop);
                if (gCand) validGeneralCands.push(gCand);
            }

            var bestCombo = SharedDB.findBestAdjutantCombo(mCard, unusedMirrors, currentAssigned, curCostMap[uid], {
                allowSameName: true,
                disallowSenkyo: (entry.bestRank === 1),
                baseCopyT: firstLeadT,
                baseCopyG: firstLeadG + firstSoloG,
                baseCopyRaw: firstSoloGk,
                wTroop: 155000,
                wGen: wGenEff,
                wRaw: 150,
                wAtk: (entry.bestRank === 1 && entry.inSolo) ? 150 : 2,
                wSpd: 50,
                generalPool: validGeneralCands
            });

            bestCombo.forEach(function(chosenFk) {
                usedMirrorUniqueIds.add(chosenFk.uniqueId);
                curCostMap[uid] += chosenFk.cost;
                currentAssigned.push(chosenFk);
                applyAdjutantToEntry(entry, chosenFk);
            });
        });

        var frontBackUsedCount = usedMirrorUniqueIds.size;

        // 【ステップ2】エース・前衛・後衛で使って【余った副将】を速度陣へセット
        speedOnlyMasters.forEach(function(entry) {
            var mCard = entry.card;
            var maxFk = SharedDB.safeNum(mCard.maxFukushoCost, 0);
            if (SharedDB.isHaBusho(mCard) || maxFk <= 0) return;

            var mRarity = String(mCard.rarity || 'SL').toUpperCase();
            var maxSlots = mRarity === 'SL' ? 2 : 1;
            var uid = mCard.uniqueId;
            var currentAssigned = assignedMap[uid];
            if (currentAssigned.length >= maxSlots) return;

            var kMult = getKakuseiMult(mCard);
            var ls = entry.inLead ? entry.leadSlot : null;
            var ss = entry.inSolo ? entry.soloSlot : null;

            var firstLeadSpd = ls ? (SharedDB.safeNum(ls.firstTroopSpeedPct || ls.firstSpeedPct, 0) / kMult) : 0;
            var firstSoloSpd = ss ? (SharedDB.safeNum(ss.firstSpeedPct, 0) / kMult) : 0;
            var firstSoloRr = ss ? (SharedDB.safeNum(ss.firstRairei, 0) / kMult) : 0;

            var unusedMirrors2 = availableMirrors.filter(function(fk) {
                return !usedMirrorUniqueIds.has(fk.uniqueId);
            });

            var validSpeedGeneralCands = [];
            for (var gi2 = 0; gi2 < availableGenerals.length; gi2++) {
                var gCard2 = availableGenerals[gi2];
                if (usedMirrorUniqueIds.has(gCard2.uniqueId)) continue;
                var gCand2 = buildGeneralAdjutantCandidateForMaster(gCard2, entry, primaryTroop);
                if (gCand2) validSpeedGeneralCands.push(gCand2);
            }

            var bestCombo2 = SharedDB.findBestAdjutantCombo(mCard, unusedMirrors2, currentAssigned, curCostMap[uid], {
                allowSameName: true,
                disallowSenkyo: true,
                baseCopyT: firstLeadSpd,
                baseCopyG: firstSoloSpd,
                baseCopyRaw: firstSoloRr,
                wTroop: 5000,
                wGen: 5000,
                wRaw: 20000,
                wAtk: 2,
                wSpd: 150,
                generalPool: validSpeedGeneralCands
            });

            bestCombo2.forEach(function(chosenFk2) {
                usedMirrorUniqueIds.add(chosenFk2.uniqueId);
                curCostMap[uid] += chosenFk2.cost;
                currentAssigned.push(chosenFk2);
                applyAdjutantToEntry(entry, chosenFk2);
            });
        });

        var speedLeftoverUsedCount = usedMirrorUniqueIds.size - frontBackUsedCount;

        return {
            assignedMap: assignedMap,
            leadAddedStatsMap: leadAddedStatsMap,
            soloAddedStatsMap: soloAddedStatsMap,
            frontBackUsedCount: frontBackUsedCount,
            speedLeftoverUsedCount: speedLeftoverUsedCount
        };
    }

    function run(shouldAuto) {
        try {
            var uCards = AppCards.userCards;
            if (!uCards || uCards.length === 0) return;
            AppCards.setStatusLog("北伐統合デッキ最適化計算中... (" + uCards.length + "枚・副将役割別評価/合計値比較対応)");

            var elTroop = document.getElementById('hokuLeadTroop');
            var elAdjMode = document.getElementById('hokuAdjutantMode');
            var selectedTroopKey = (elTroop && elTroop.value === 'HAMMER') ? 'HAMMER' : 'AXE';
            var primaryTroop = HokubatsuDB.HOKUBATSU_TROOPS[selectedTroopKey] || HokubatsuDB.HOKUBATSU_TROOPS.AXE;
            var axeTroop = HokubatsuDB.HOKUBATSU_TROOPS.AXE;
            var hammerTroop = HokubatsuDB.HOKUBATSU_TROOPS.HAMMER;
            var troopCount = HOKUBATSU_TROOP_COUNT;
            var adjMode = elAdjMode ? elAdjMode.value : 'REASSIGN_ALL';
            var isReassign = (adjMode !== 'CURRENT');

            var validCards = uCards.filter(function(c) {
                if (AppCards.excludedCardIds.has(c.uniqueId)) return false;
                if (!isReassign && c.isAdjutant) return false;
                return true;
            });

            var allMirrorPool = [];
            var allGeneralPool = [];
            var topMirrorCountByNo = Object.create(null);
            var topGeneralCountByNo = Object.create(null);

            uCards.forEach(function(c) {
                if (AppCards.excludedCardIds.has(c.uniqueId)) return;
                var inf = SharedDB.getMirrorSkillInfo(c);
                var cNo = String(c.cardNo || '').replace(/[^0-9]/g, '').trim();
                if (inf) {
                    if (cNo) topMirrorCountByNo[cNo] = (topMirrorCountByNo[cNo] || 0) + 1;
                    allMirrorPool.push({ card: c, info: inf, uniqueId: c.uniqueId, cardNo: cNo || c.uniqueId });
                } else {
                    if (cNo) topGeneralCountByNo[cNo] = (topGeneralCountByNo[cNo] || 0) + 1;
                    allGeneralPool.push(c);
                }
            });

            if (isReassign) {
                var fkMirrorSeenByNo = Object.create(null);
                var fkGeneralSeenByNo = Object.create(null);
                uCards.forEach(function(c) {
                    if (AppCards.excludedCardIds.has(c.uniqueId)) return;
                    if (!Array.isArray(c.fukusho)) return;
                    c.fukusho.forEach(function(fk, fIdx) {
                        if (!fk || typeof fk !== 'object') return;
                        var infFk = SharedDB.getMirrorSkillInfo(fk);
                        var fkNo = String(fk.cardNo || '').replace(/[^0-9]/g, '').trim();
                        if (!fkNo && fk.imageSrc) {
                            var mImg = String(fk.imageSrc).match(/\/([0-9]+)_/);
                            if (mImg) fkNo = mImg[1];
                        }

                        if (infFk) {
                            var isExtraUnlisted = false;
                            if (fkNo) {
                                fkMirrorSeenByNo[fkNo] = (fkMirrorSeenByNo[fkNo] || 0) + 1;
                                if (fkMirrorSeenByNo[fkNo] > (topMirrorCountByNo[fkNo] || 0)) {
                                    isExtraUnlisted = true;
                                }
                            } else if (infFk.type === 'senkyo') {
                                isExtraUnlisted = true;
                            }

                            if (isExtraUnlisted) {
                                var fkUid = String(fk.uniqueId || ('fk_extra_m_' + c.uniqueId + '_' + fIdx + '_' + (fkNo || fk.name)));
                                allMirrorPool.push({
                                    card: {
                                        uniqueId: fkUid,
                                        cardNo: fkNo || fkUid,
                                        name: fk.name || '副将',
                                        rarity: infFk.rarity,
                                        cost: SharedDB.safeNum(fk.cost, 1.0),
                                        originalCost: SharedDB.safeNum(fk.cost, 1.0),
                                        baseAttack: SharedDB.safeNum(fk.baseAttack !== undefined ? fk.baseAttack : fk.attack, 0),
                                        intelligence: SharedDB.safeNum(fk.intelligence, 0),
                                        speed: SharedDB.safeNum(fk.speed, 15),
                                        imageSrc: fk.imageSrc || '',
                                        skills: fk.skills || [{ name: infFk.label, description: '' }],
                                        country: fk.country || infFk.force || '他'
                                    },
                                    info: infFk,
                                    uniqueId: fkUid,
                                    cardNo: fkNo || fkUid
                                });
                            }
                        } else {
                            var isExtraGen = false;
                            if (fkNo) {
                                fkGeneralSeenByNo[fkNo] = (fkGeneralSeenByNo[fkNo] || 0) + 1;
                                if (fkGeneralSeenByNo[fkNo] > (topGeneralCountByNo[fkNo] || 0)) {
                                    isExtraGen = true;
                                }
                            }
                            if (isExtraGen) {
                                var fkGenUid = String(fk.uniqueId || ('fk_extra_g_' + c.uniqueId + '_' + fIdx + '_' + (fkNo || fk.name)));
                                allGeneralPool.push({
                                    uniqueId: fkGenUid,
                                    cardNo: fkNo || fkGenUid,
                                    name: fk.name || '副将',
                                    rarity: String(fk.rarity || c.rarity || 'SL').toUpperCase(),
                                    cost: SharedDB.safeNum(fk.cost, 1.0),
                                    originalCost: SharedDB.safeNum(fk.cost, 1.0),
                                    baseAttack: SharedDB.safeNum(fk.baseAttack !== undefined ? fk.baseAttack : fk.attack, 500),
                                    intelligence: SharedDB.safeNum(fk.intelligence, 15),
                                    speed: SharedDB.safeNum(fk.speed, 15),
                                    imageSrc: fk.imageSrc || '',
                                    skills: fk.skills || [],
                                    country: fk.country || c.country || '他'
                                });
                            }
                        }
                    });
                });
            }

            var teisenMirrors = isReassign ? allMirrorPool.filter(function(m) { return m.info && m.info.type === 'senkyo'; }) : [];
            var usedTeisenIds = new Set();
            var preTeisenMap = Object.create(null);

            var leadAceCandidates = [];
            var leadFrontPool = [];
            var leadBackPool = [];
            var leadSpeedPool = [];

            for (var i = 0; i < validCards.length; i++) {
                var c = validCards[i];
                var cost = SharedDB.safeNum(c.originalCost !== undefined ? c.originalCost : c.cost, 4.5);

                var evAxe = evaluateCardHoku(c, axeTroop, 'SL', 4.5, isReassign);
                var evHam = evaluateCardHoku(c, hammerTroop, 'SL', 4.5, isReassign);
                var evSel = (selectedTroopKey === 'HAMMER') ? evHam : evAxe;

                if (evAxe.isAttackLead || evHam.isAttackLead) {
                    if (evAxe.tMult > 0 || evHam.tMult > 0) {
                        var scoreAxe = axeTroop.attack * troopCount * (1 + evAxe.tMult / 100) + SharedDB.safeNum(c.baseAttack, 1000) * (1 + evAxe.gMult / 100);
                        var scoreHam = hammerTroop.attack * troopCount * (1 + evHam.tMult / 100) + SharedDB.safeNum(c.baseAttack, 1000) * (1 + evHam.gMult / 100);
                        var combinedScore = (selectedTroopKey === 'HAMMER')
                            ? (scoreHam * 0.65 + scoreAxe * 0.35)
                            : (scoreAxe * 0.65 + scoreHam * 0.35);

                        var bestFirstT = Math.max(evAxe.firstTMult, evHam.firstTMult);
                        var bestFirstG = Math.max(evAxe.firstGMult, evHam.firstGMult);

                        leadAceCandidates.push({
                            card: c,
                            role: 'ACE',
                            effectiveCost: cost,
                            evAxe: evAxe,
                            evHam: evHam,
                            evSel: evSel,
                            firstTMult: bestFirstT,
                            firstGMult: bestFirstG,
                            firstSpeedPct: evSel.firstSpeedPct,
                            firstTroopSpeedPct: evSel.firstTroopSpeedPct,
                            firstGekirei: 0,
                            firstRairei: 0,
                            scoreValue: combinedScore
                        });
                    }
                }

                if (!evSel.isAttackLead && (evAxe.tMult > 0 || evHam.tMult > 0)) {
                    var supScore = (selectedTroopKey === 'HAMMER')
                        ? (evHam.tMult * 0.65 + evAxe.tMult * 0.35)
                        : (evAxe.tMult * 0.65 + evHam.tMult * 0.35);
                    var bestSupFirstT = Math.max(evAxe.firstTMult, evHam.firstTMult);
                    var bestSupFirstG = Math.max(evAxe.firstGMult, evHam.firstGMult);

                    var supItem = {
                        card: c,
                        effectiveCost: cost,
                        cost: cost,
                        evAxe: evAxe,
                        evHam: evHam,
                        evSel: evSel,
                        firstTMult: bestSupFirstT,
                        firstGMult: bestSupFirstG,
                        firstSpeedPct: evSel.firstSpeedPct,
                        firstTroopSpeedPct: evSel.firstTroopSpeedPct,
                        firstGekirei: 0,
                        firstRairei: 0,
                        isBound: evSel.mustBeSameBase,
                        isManual: evSel.isManualSupport,
                        scoreValue: supScore
                    };

                    if (evSel.isManualSupport || evSel.mustBeSameBase) {
                        leadFrontPool.push(Object.assign({}, supItem, { role: 'FRONT' }));
                    } else {
                        leadBackPool.push(Object.assign({}, supItem, { role: 'BACK' }));
                    }
                }

                if (!evSel.isAttackLead && evSel.troopSpeedPct > 0) {
                    leadSpeedPool.push({
                        card: c,
                        role: 'SPEED',
                        effectiveCost: cost,
                        cost: cost,
                        evSel: evSel,
                        firstTMult: evSel.firstTMult,
                        firstGMult: evSel.firstGMult,
                        firstSpeedPct: evSel.firstSpeedPct,
                        firstTroopSpeedPct: evSel.firstTroopSpeedPct,
                        firstGekirei: 0,
                        firstRairei: 0,
                        isBound: evSel.mustBeSameBase,
                        scoreValue: evSel.troopSpeedPct
                    });
                }
            }

            leadAceCandidates.sort(function(a, b) { return b.scoreValue - a.scoreValue; });
            var leadUsedUniqueIds = new Set();
            var pickedLeadAces = [];
            for (var ai = 0; ai < leadAceCandidates.length && pickedLeadAces.length < 5; ai++) {
                if (!leadUsedUniqueIds.has(leadAceCandidates[ai].card.uniqueId)) {
                    leadUsedUniqueIds.add(leadAceCandidates[ai].card.uniqueId);
                    pickedLeadAces.push(leadAceCandidates[ai]);
                }
            }

            if (isReassign && teisenMirrors.length > 0) {
                var unusedTeisenL = teisenMirrors.filter(function(m) { return !usedTeisenIds.has(m.uniqueId); });
                preAssignTeisenkyoToSupport([leadFrontPool, leadBackPool], unusedTeisenL, preTeisenMap, usedTeisenIds);
            }

            var availLeadFront = leadFrontPool.filter(function(x) { return !leadUsedUniqueIds.has(x.card.uniqueId); });
            var pickedLeadFront = HokubatsuDB.solveHokubatsu2DDP(10, 25.0, availLeadFront).picked;
            pickedLeadFront.forEach(function(x) { leadUsedUniqueIds.add(x.card.uniqueId); });

            var availLeadBack = leadBackPool.filter(function(x) { return !leadUsedUniqueIds.has(x.card.uniqueId); });
            var pickedLeadBack = HokubatsuDB.solveHokubatsu2DDP(10, 25.0, availLeadBack).picked;
            pickedLeadBack.forEach(function(x) { leadUsedUniqueIds.add(x.card.uniqueId); });

            var frontUsedCostL = pickedLeadFront.reduce(function(s, x) { return s + x.effectiveCost; }, 0);
            if (pickedLeadFront.length < 10 && frontUsedCostL < 24.5) {
                var remBackForFrontL = leadBackPool.filter(function(x) { return !leadUsedUniqueIds.has(x.card.uniqueId); });
                var extraFrontL = HokubatsuDB.solveHokubatsu2DDP(10 - pickedLeadFront.length, 25.0 - frontUsedCostL, remBackForFrontL).picked;
                extraFrontL.forEach(function(x) {
                    x.role = 'FRONT';
                    pickedLeadFront.push(x);
                    leadUsedUniqueIds.add(x.card.uniqueId);
                });
            }

            var availLeadSpeed = leadSpeedPool.filter(function(x) { return !leadUsedUniqueIds.has(x.card.uniqueId); });
            var pickedLeadSpeed = HokubatsuDB.solveHokubatsu2DDP(10, 25.0, availLeadSpeed).picked;
            pickedLeadSpeed.forEach(function(x) { leadUsedUniqueIds.add(x.card.uniqueId); });

            var allLeadSlots = pickedLeadAces.concat(pickedLeadFront, pickedLeadBack, pickedLeadSpeed);

            var soloAceCandidates = [];
            var soloFrontPool = [];
            var soloBackPool = [];
            var soloSpeedPool = [];

            var estGekireiBase = 250000;
            var estSupportMultBase = 12000;

            for (var j = 0; j < validCards.length; j++) {
                var sc = validCards[j];
                var sCost = SharedDB.safeNum(sc.originalCost !== undefined ? sc.originalCost : sc.cost, 4.5);
                var sRarity = String(sc.rarity || 'SL').toUpperCase();
                var evSolo = evaluateCardHoku(sc, null, sRarity, 4.5, isReassign);

                if (evSolo.isAttackLead || SharedDB.safeNum(sc.baseAttack, 0) >= 30000) {
                    var baseAtk = SharedDB.safeNum(sc.baseAttack, 1000);
                    var estSoloDmg = (baseAtk + estGekireiBase) * (1 + (estSupportMultBase + evSolo.gMult) / 100);
                    soloAceCandidates.push({
                        card: sc,
                        role: 'ACE',
                        effectiveCost: sCost,
                        evSolo: evSolo,
                        firstTMult: 0,
                        firstGMult: evSolo.firstGMult,
                        firstSpeedPct: evSolo.firstSpeedPct,
                        firstTroopSpeedPct: 0,
                        firstGekirei: 0,
                        firstRairei: 0,
                        scoreValue: estSoloDmg
                    });
                }

                if (!evSolo.isAttackLead && (evSolo.gMult > 0 || evSolo.rawGekirei > 0)) {
                    var unifiedSoloSupScore = (evSolo.rawGekirei * (1 + estSupportMultBase / 100)) + (160000 * (evSolo.gMult / 100));
                    var soloSupItem = {
                        card: sc,
                        effectiveCost: sCost,
                        cost: sCost,
                        evSolo: evSolo,
                        firstTMult: 0,
                        firstGMult: evSolo.firstGMult,
                        firstSpeedPct: evSolo.firstSpeedPct,
                        firstTroopSpeedPct: 0,
                        firstGekirei: evSolo.firstGekirei,
                        firstRairei: 0,
                        isBound: evSolo.mustBeSameBase,
                        isManual: evSolo.isManualSupport,
                        scoreValue: unifiedSoloSupScore
                    };

                    if (evSolo.isManualSupport || evSolo.mustBeSameBase) {
                        soloFrontPool.push(Object.assign({}, soloSupItem, { role: 'FRONT' }));
                    } else {
                        soloBackPool.push(Object.assign({}, soloSupItem, { role: 'BACK' }));
                    }
                }

                if (!evSolo.isAttackLead && (evSolo.rawRairei > 0 || evSolo.speedPct > 0)) {
                    var speedContribScore = (evSolo.rawRairei * 15) + (35 * (evSolo.speedPct / 100));
                    soloSpeedPool.push({
                        card: sc,
                        role: 'SPEED',
                        effectiveCost: sCost,
                        cost: sCost,
                        evSolo: evSolo,
                        firstTMult: 0,
                        firstGMult: 0,
                        firstSpeedPct: evSolo.firstSpeedPct,
                        firstTroopSpeedPct: 0,
                        firstGekirei: 0,
                        firstRairei: evSolo.firstRairei,
                        isBound: evSolo.mustBeSameBase,
                        scoreValue: speedContribScore
                    });
                }
            }

            soloAceCandidates.sort(function(a, b) { return b.scoreValue - a.scoreValue; });
            var soloUsedUniqueIds = new Set();
            var pickedSoloAces = [];
            for (var si = 0; si < soloAceCandidates.length && pickedSoloAces.length < 5; si++) {
                if (!soloUsedUniqueIds.has(soloAceCandidates[si].card.uniqueId)) {
                    soloUsedUniqueIds.add(soloAceCandidates[si].card.uniqueId);
                    pickedSoloAces.push(soloAceCandidates[si]);
                }
            }

            if (isReassign && teisenMirrors.length > 0) {
                var preTeisenSolo = Object.create(null);
                var usedTeisenSolo = new Set();
                preAssignTeisenkyoToSupport([soloFrontPool, soloBackPool], teisenMirrors, preTeisenSolo, usedTeisenSolo);
                Object.keys(preTeisenSolo).forEach(function(uid) {
                    if (!preTeisenMap[uid]) {
                        preTeisenMap[uid] = preTeisenSolo[uid];
                    }
                });
            }

            var availSoloFront = soloFrontPool.filter(function(x) { return !soloUsedUniqueIds.has(x.card.uniqueId); });
            var pickedSoloFront = HokubatsuDB.solveHokubatsu2DDP(10, 25.0, availSoloFront).picked;
            pickedSoloFront.forEach(function(x) { soloUsedUniqueIds.add(x.card.uniqueId); });

            var availSoloBack = soloBackPool.filter(function(x) { return !soloUsedUniqueIds.has(x.card.uniqueId); });
            var pickedSoloBack = HokubatsuDB.solveHokubatsu2DDP(10, 25.0, availSoloBack).picked;
            pickedSoloBack.forEach(function(x) { soloUsedUniqueIds.add(x.card.uniqueId); });

            var frontUsedCostS = pickedSoloFront.reduce(function(s, x) { return s + x.effectiveCost; }, 0);
            if (pickedSoloFront.length < 10 && frontUsedCostS < 24.5) {
                var remBackForFrontS = soloBackPool.filter(function(x) { return !soloUsedUniqueIds.has(x.card.uniqueId); });
                var extraFrontS = HokubatsuDB.solveHokubatsu2DDP(10 - pickedSoloFront.length, 25.0 - frontUsedCostS, remBackForFrontS).picked;
                extraFrontS.forEach(function(x) {
                    x.role = 'FRONT';
                    pickedSoloFront.push(x);
                    soloUsedUniqueIds.add(x.card.uniqueId);
                });
            }

            var availSoloSpeed = soloSpeedPool.filter(function(x) { return !soloUsedUniqueIds.has(x.card.uniqueId); });
            var pickedSoloSpeed = HokubatsuDB.solveHokubatsu2DDP(10, 25.0, availSoloSpeed).picked;
            pickedSoloSpeed.forEach(function(x) { soloUsedUniqueIds.add(x.card.uniqueId); });

            var allSoloSlots = pickedSoloAces.concat(pickedSoloFront, pickedSoloBack, pickedSoloSpeed);

            var unifiedAdj = assignUnifiedHokubatsuAdjutants(allLeadSlots, allSoloSlots, allMirrorPool, allGeneralPool, preTeisenMap, isReassign, primaryTroop);

            var buff10Mult = isBuff10 ? 1.1 : 1.0;

            var leadSupportTroopBuffAxe = 0;
            var leadSupportTroopBuffHam = 0;
            pickedLeadFront.concat(pickedLeadBack).forEach(function(it) {
                var addT = (unifiedAdj.leadAddedStatsMap[it.card.uniqueId] && unifiedAdj.leadAddedStatsMap[it.card.uniqueId].tBuff) || 0;
                leadSupportTroopBuffAxe += it.evAxe.tMult + addT;
                leadSupportTroopBuffHam += it.evHam.tMult + addT;
            });

            var leadSpeedTotalPct = 0;
            pickedLeadSpeed.forEach(function(it) {
                var addSpd = (unifiedAdj.leadAddedStatsMap[it.card.uniqueId] && unifiedAdj.leadAddedStatsMap[it.card.uniqueId].spdPct) || 0;
                leadSpeedTotalPct += it.evSel.troopSpeedPct + addSpd;
            });

            var leadAceSummaries = pickedLeadAces.map(function(ace) {
                var adj = unifiedAdj.leadAddedStatsMap[ace.card.uniqueId] || { tBuff: 0, gBuff: 0, spdPct: 0, atkBonus: 0 };
                var effGenAtk = SharedDB.safeNum(ace.card.baseAttack, 1000) + adj.atkBonus;

                var totAxeMult = ace.evAxe.tMult + adj.tBuff + leadSupportTroopBuffAxe;
                var totHamMult = ace.evHam.tMult + adj.tBuff + leadSupportTroopBuffHam;
                var genMult = ace.evSel.gMult + adj.gBuff;

                var dmgAxe = Math.floor((axeTroop.attack * troopCount * (1 + totAxeMult / 100) + effGenAtk * (1 + genMult / 100)) * buff10Mult);
                var dmgHam = Math.floor((hammerTroop.attack * troopCount * (1 + totHamMult / 100) + effGenAtk * (1 + genMult / 100)) * buff10Mult);

                var totalSpdPct = ace.evSel.speedPct + adj.spdPct + leadSpeedTotalPct;
                var finalTroopSpeed = Math.round(primaryTroop.speed * (1 + totalSpdPct / 100) * 10) / 10;

                return {
                    item: ace,
                    dmgAxe: dmgAxe,
                    dmgHam: dmgHam,
                    totAxeMult: totAxeMult,
                    totHamMult: totHamMult,
                    finalTroopSpeed: finalTroopSpeed
                };
            });

            var soloSupportGenBuff = 0;
            var soloTotalGekirei = 0;
            pickedSoloFront.concat(pickedSoloBack).forEach(function(it) {
                var adj = unifiedAdj.soloAddedStatsMap[it.card.uniqueId] || { gBuff: 0, gkAdd: 0 };
                soloSupportGenBuff += it.evSolo.gMult + adj.gBuff;
                soloTotalGekirei += it.evSolo.rawGekirei + adj.gkAdd;
            });

            var soloSpeedSupportPct = 0;
            var soloSpeedAdjEiBonus = 0;
            pickedSoloSpeed.forEach(function(it) {
                var adj = unifiedAdj.soloAddedStatsMap[it.card.uniqueId] || { spdPct: 0, spdBonus: 0 };
                soloSpeedSupportPct += it.evSolo.speedPct + adj.spdPct;
                soloSpeedAdjEiBonus += SharedDB.safeNum(adj.spdBonus, 0);
            });

            var calcRaireiForAce = function(aceRarity) {
                var sumRr = 0;
                pickedSoloSpeed.forEach(function(it) {
                    var skills = (it.card && it.card.skills) || [];
                    if (skills.length === 0) return;
                    var rr0 = (!isDuelSkill(skills[0])) ? HokubatsuDB.getRaireiSpeedBonus(skills[0], aceRarity) : { addSpeed: 0 };
                    var baseRr = (rr0 && rr0.addSpeed) || 0;
                    var cardRr = baseRr;
                    var isHa = SharedDB.isHaBusho(it.card);

                    for (var k = 1; k < skills.length; k++) {
                        var sk = skills[k];
                        if (!sk) continue;
                        var sn = String(sk.name || '').trim();
                        if (sn.indexOf('覚:') === 0 || sn.indexOf('副覚:') === 0) continue;
                        if (isDuelSkill(sk)) continue;
                        var isAdj = (sn.indexOf('副:') === 0 || sn.indexOf('副変:') === 0 || sn.indexOf('副攻:') === 0 || sn.indexOf('副防:') === 0);
                        if (isReassign && !isHa && isAdj) continue;

                        var isMir = !isAdj && (sn.indexOf('変:') === 0 || sn.indexOf('主将の') !== -1 || sn.indexOf('明鑑') !== -1 || sn.indexOf('王春の') !== -1 || (sn.indexOf('明鏡') !== -1 && sn.indexOf('副将の') === -1));
                        var rri = HokubatsuDB.getRaireiSpeedBonus(sk, aceRarity);
                        if (isMir && (!rri || rri.addSpeed <= 0) && baseRr > 0) {
                            var rate = SharedDB.getMasterMirrorCopyRate(sk);
                            cardRr += baseRr * rate;
                        } else if (rri && rri.addSpeed > 0) {
                            cardRr += rri.addSpeed;
                        }
                    }

                    var assignedFks = unifiedAdj.assignedMap[it.card.uniqueId] || [];
                    var kMult = getKakuseiMult(it.card);
                    assignedFks.forEach(function(fk) {
                        if (fk.isGeneralSkill && fk.genStats && SharedDB.safeNum(fk.genStats.soloRr, 0) > 0) {
                            cardRr += SharedDB.safeNum(fk.genStats.soloRr, 0);
                            return;
                        }
                        var inf = fk.info || SharedDB.getMirrorSkillInfo(fk);
                        if (inf && baseRr > 0 && SharedDB.safeNum(fk.copyRate, 0) > 0) {
                            cardRr += (baseRr / kMult) * (SharedDB.safeNum(fk.copyRate, 0) / 100);
                        }
                    });

                    sumRr += cardRr;
                });
                return Math.round(sumRr * 100) / 100;
            };

            var slRaireiTotal = calcRaireiForAce('SL');

            var soloAceSummaries = pickedSoloAces.map(function(ace) {
                var adj = unifiedAdj.soloAddedStatsMap[ace.card.uniqueId] || { gBuff: 0, spdPct: 0, atkBonus: 0, spdBonus: 0 };
                var effAtk = SharedDB.safeNum(ace.card.baseAttack, 1000) + adj.atkBonus + soloTotalGekirei;
                var totGenBuff = ace.evSolo.gMult + adj.gBuff + soloSupportGenBuff;
                var finalDmg = Math.floor(effAtk * (1 + totGenBuff / 100) * buff10Mult);

                var aceRarity = String(ace.card.rarity || 'SL').toUpperCase();
                var aceRaireiAdd = calcRaireiForAce(aceRarity);
                var baseSpd = SharedDB.safeNum(ace.card.speed, 15);

                var raireiAddedSpd = Math.round((baseSpd + aceRaireiAdd + adj.spdBonus + soloSpeedAdjEiBonus) * 100) / 100;
                var totalSpdPct = ace.evSolo.speedPct + adj.spdPct + soloSpeedSupportPct;
                var finalSoloSpeed = Math.round(raireiAddedSpd * (1 + totalSpdPct / 100) * 10) / 10;

                return {
                    item: ace,
                    effAtk: effAtk,
                    totGenBuff: totGenBuff,
                    finalDmg: finalDmg,
                    baseSpd: baseSpd,
                    adjSpdBonus: adj.spdBonus + soloSpeedAdjEiBonus,
                    aceRaireiAdd: aceRaireiAdd,
                    raireiAddedSpd: raireiAddedSpd,
                    totalSpdPct: totalSpdPct,
                    finalSoloSpeed: finalSoloSpeed
                };
            });

            var setup = {
                primaryTroop: primaryTroop,
                troopCount: troopCount,
                buff10Mult: buff10Mult,
                unifiedAdj: unifiedAdj,
                leadAceSummaries: leadAceSummaries,
                pickedLeadFront: pickedLeadFront,
                pickedLeadBack: pickedLeadBack,
                pickedLeadSpeed: pickedLeadSpeed,
                leadSupportTroopBuffAxe: leadSupportTroopBuffAxe,
                leadSupportTroopBuffHam: leadSupportTroopBuffHam,
                leadSpeedTotalPct: leadSpeedTotalPct,
                soloAceSummaries: soloAceSummaries,
                pickedSoloFront: pickedSoloFront,
                pickedSoloBack: pickedSoloBack,
                pickedSoloSpeed: pickedSoloSpeed,
                soloSupportGenBuff: soloSupportGenBuff,
                soloTotalGekirei: soloTotalGekirei,
                slRaireiTotal: slRaireiTotal,
                soloSpeedSupportPct: soloSpeedSupportPct
            };

            currentHokuSetup = setup;
            render(setup);
            AppCards.setStatusLog("北伐統合最適化完了（一般副将役割別評価・合計値比較対応 ／ エース・前衛・後衛: " + unifiedAdj.frontBackUsedCount + "枚 ／ 速度陣余り: " + unifiedAdj.speedLeftoverUsedCount + "枚）");
        } catch (err) {
            console.error("HokubatsuEngine.run Error:", err);
            AppCards.setStatusLog("北伐計算エラー: " + err.message, true);
        }
    }

    function getDisplayCardHoku(it) {
        if (!it || !it.card) return null;
        if (it.hasTeisenkyo) {
            return Object.assign({}, it.card, { cost: 1.0, hasTeisenkyo: true });
        }
        return it.card;
    }

    function render(setup) {
        var area = document.getElementById('hokubatsuDeckResultArea');
        if (!area || !setup) return;

        var calcCostSum = function(list) {
            return list.reduce(function(s, x) { return s + SharedDB.safeNum(x.effectiveCost, 0); }, 0);
        };

        var renderGridCards = function(list, statsMap, badgeFn, borderColorClass, showScopeTag) {
            if (!list || list.length === 0) {
                return '<div class="text-xs text-gray-500 p-3 border border-dashed border-gray-800 rounded-lg text-center col-span-full">該当カードなし</div>';
            }
            return list.map(function(it) {
                var adjList = setup.unifiedAdj.assignedMap[it.card.uniqueId] || [];
                var adjStats = statsMap[it.card.uniqueId] || {};
                var badgeText = badgeFn(it, adjStats);
                var scopeHTML = '';
                if (showScopeTag) {
                    scopeHTML = it.isBound
                        ? '<div class="absolute -top-2 left-0 bg-red-600 border border-red-400 text-white text-[8px] px-1 rounded-full shadow-md z-30 font-bold pointer-events-none">拠点縛り</div>'
                        : '<div class="absolute -top-2 left-0 bg-emerald-600 border border-emerald-400 text-white text-[8px] px-1 rounded-full shadow-md z-30 font-bold pointer-events-none">全拠点系</div>';
                }
                return `
                    <div class="relative border ${borderColorClass} rounded-lg p-1.5 opacity-95 hover:opacity-100 hover:z-40 transition">
                        ${SharedUI.getCardVisualHTML(getDisplayCardHoku(it), adjList)}
                        <div class="absolute -top-2 -right-2 bg-black border ${borderColorClass} text-white text-[8px] px-1.5 py-0.5 rounded-full shadow-md z-10 font-mono text-center leading-tight pointer-events-none">
                            ${badgeText}
                        </div>
                        ${scopeHTML}
                    </div>
                `;
            }).join('');
        };

        var leadAcesHTML = setup.leadAceSummaries.map(function(s, idx) {
            var adjList = setup.unifiedAdj.assignedMap[s.item.card.uniqueId] || [];
            return `
                <div class="bg-black/60 border-2 border-amber-500/70 rounded-xl p-2.5 flex flex-col justify-between shadow-lg">
                    <div class="flex items-center justify-between text-[11px] font-bold text-amber-300 pb-1.5 mb-1.5 border-b border-amber-500/30">
                        <span>引率エース ${idx + 1}</span>
                        <span class="text-[10px] text-cyan-300 font-mono">速 ${s.finalTroopSpeed}</span>
                    </div>
                    <div class="hover:z-40 relative">
                        ${SharedUI.getCardVisualHTML(s.item.card, adjList)}
                    </div>
                    <div class="mt-2 pt-1.5 border-t border-gray-800 font-mono text-[10px] space-y-1">
                        <div class="flex justify-between items-center bg-orange-950/50 px-1.5 py-0.5 rounded border border-orange-500/30">
                            <span class="text-orange-300 font-bold">斧兵(10万):</span>
                            <span class="text-white font-bold">${s.dmgAxe.toLocaleString()}</span>
                        </div>
                        <div class="flex justify-between items-center bg-sky-950/50 px-1.5 py-0.5 rounded border border-sky-500/30">
                            <span class="text-sky-300 font-bold">大錘(10万):</span>
                            <span class="text-white font-bold">${s.dmgHam.toLocaleString()}</span>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        var soloAcesHTML = setup.soloAceSummaries.map(function(s, idx) {
            var adjList = setup.unifiedAdj.assignedMap[s.item.card.uniqueId] || [];
            var tooltipSpd = "素速度" + s.baseSpd + " + 雷令" + s.aceRaireiAdd;
            if (s.adjSpdBonus > 0) tooltipSpd += " + 鋭" + Math.round(s.adjSpdBonus * 10) / 10;
            tooltipSpd += " = " + s.raireiAddedSpd + " × (1 + " + SharedDB.formatBuffNum(s.totalSpdPct) + "%)";

            return `
                <div class="bg-black/60 border-2 border-red-500/70 rounded-xl p-2.5 flex flex-col justify-between shadow-lg">
                    <div class="flex items-center justify-between text-[11px] font-bold text-red-300 pb-1.5 mb-1.5 border-b border-red-500/30">
                        <span>単騎エース ${idx + 1}</span>
                        <span class="text-[10px] text-cyan-300 font-mono font-bold">速度 ${s.finalSoloSpeed}</span>
                    </div>
                    <div class="hover:z-40 relative">
                        ${SharedUI.getCardVisualHTML(s.item.card, adjList)}
                    </div>
                    <div class="mt-2 pt-1.5 border-t border-gray-800 font-mono text-[10px] space-y-1">
                        <div class="flex justify-between items-center bg-red-950/50 px-1.5 py-0.5 rounded border border-red-500/30">
                            <span class="text-red-300 font-bold">単騎火力:</span>
                            <span class="text-white font-bold">${s.finalDmg.toLocaleString()}</span>
                        </div>
                        <div class="flex justify-between items-center bg-cyan-950/50 px-1.5 py-0.5 rounded border border-cyan-500/30 cursor-help" title="${tooltipSpd}">
                            <span class="text-cyan-300 font-bold">雷令+${s.aceRaireiAdd}:</span>
                            <span class="text-amber-300 font-bold">速 ${s.finalSoloSpeed}</span>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        var btnLeadCls = (activeSubView === 'LEAD')
            ? "flex-1 py-2.5 px-4 rounded-xl text-xs sm:text-sm font-extrabold bg-gradient-to-r from-amber-500 to-orange-600 text-black shadow-lg cursor-pointer transition flex items-center justify-center space-x-2"
            : "flex-1 py-2.5 px-4 rounded-xl text-xs sm:text-sm font-bold text-gray-400 hover:text-white hover:bg-gray-800/60 cursor-pointer transition flex items-center justify-center space-x-2";
        var btnSoloCls = (activeSubView === 'SOLO')
            ? "flex-1 py-2.5 px-4 rounded-xl text-xs sm:text-sm font-extrabold bg-gradient-to-r from-red-600 to-rose-600 text-white shadow-lg cursor-pointer transition flex items-center justify-center space-x-2"
            : "flex-1 py-2.5 px-4 rounded-xl text-xs sm:text-sm font-bold text-gray-400 hover:text-white hover:bg-gray-800/60 cursor-pointer transition flex items-center justify-center space-x-2";
        var btnBothCls = (activeSubView === 'BOTH')
            ? "py-2.5 px-4 rounded-xl text-xs font-extrabold bg-purple-600 text-white shadow-lg cursor-pointer transition flex items-center justify-center space-x-1.5"
            : "py-2.5 px-4 rounded-xl text-xs font-bold text-gray-400 hover:text-white hover:bg-gray-800/60 cursor-pointer transition flex items-center justify-center space-x-1.5";

        var subViewBarHTML = `
            <div class="bg-sangoku-dark border border-gray-800 p-2 rounded-2xl shadow-md flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                <button type="button" onclick="HokubatsuEngine.setSubView('LEAD')" class="${btnLeadCls}">
                    <i class="fa-solid fa-users-rays"></i>
                    <span>引率セット表示（エース5人 ＋ 前衛・後衛・速度 3デッキ）</span>
                </button>
                <button type="button" onclick="HokubatsuEngine.setSubView('SOLO')" class="${btnSoloCls}">
                    <i class="fa-solid fa-person-running"></i>
                    <span>単騎セット表示（エース5人 ＋ 前衛・後衛・速度 3デッキ）</span>
                </button>
                <button type="button" onclick="HokubatsuEngine.setSubView('BOTH')" class="${btnBothCls}">
                    <i class="fa-solid fa-layer-group"></i>
                    <span>全6デッキ表示</span>
                </button>
            </div>
        `;

        var leadSectionHTML = `
            <div class="bg-sangoku-dark border-2 border-amber-500/50 p-5 rounded-2xl shadow-xl space-y-6">
                <div class="flex flex-wrap items-center justify-between gap-3 border-b border-gray-800 pb-4">
                    <div>
                        <div class="flex flex-wrap items-center gap-2 mb-1">
                            <span class="bg-amber-500 text-black text-xs font-extrabold px-2.5 py-0.5 rounded">北伐・引率デッキ</span>
                            <span class="bg-gray-800 border border-gray-600 text-amber-300 text-xs font-mono font-bold px-2 py-0.5 rounded">斧兵・錘兵限定 / 兵数 100,000 固定</span>
                            <h3 class="text-lg font-bold text-white">引率エース 5人 ＆ 掩護陣 3デッキ（30枠）</h3>
                        </div>
                        <div class="text-xs text-gray-300 font-mono flex flex-wrap gap-4 mt-1">
                            <span>前衛＋後衛 斧兵バフ: <b class="text-orange-400">+${SharedDB.formatBuffNum(setup.leadSupportTroopBuffAxe)}%</b></span>
                            <span>前衛＋後衛 大錘兵バフ: <b class="text-sky-400">+${SharedDB.formatBuffNum(setup.leadSupportTroopBuffHam)}%</b></span>
                            <span>速度掩護陣バフ: <b class="text-cyan-400">+${SharedDB.formatBuffNum(setup.leadSpeedTotalPct)}%</b></span>
                        </div>
                    </div>
                </div>

                <div>
                    <div class="text-sm font-bold text-amber-300 mb-2.5 border-l-4 border-amber-500 pl-2">引率エース 5人（斧兵・錘兵の2兵種のみ自動算出・他兵科は除外）</div>
                    <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                        ${leadAcesHTML}
                    </div>
                </div>

                <div class="border border-gray-800 rounded-xl p-4 bg-gray-900/50">
                    <div class="flex justify-between items-center text-sm font-bold text-white mb-2 pb-1.5 border-b border-gray-800">
                        <span><i class="fa-solid fa-hand-fist text-amber-400 mr-1.5"></i>1. 引率・前衛掩護陣（拠点縛り・襲令・手動支援配置可 / ${setup.pickedLeadFront.length} / 10枠）</span>
                        <span class="text-xs font-mono text-amber-300">コスト: ${calcCostSum(setup.pickedLeadFront).toFixed(1)} / 25.0</span>
                    </div>
                    <div class="grid grid-cols-2 sm:grid-cols-5 gap-3">
                        ${renderGridCards(setup.pickedLeadFront, setup.unifiedAdj.leadAddedStatsMap, function(it, adj) {
                            return '斧+' + SharedDB.formatBuffNum(it.evAxe.tMult + (adj.tBuff || 0)) + '%';
                        }, 'border-amber-400', true)}
                    </div>
                </div>

                <div class="border border-gray-800 rounded-xl p-4 bg-gray-900/50">
                    <div class="flex justify-between items-center text-sm font-bold text-white mb-2 pb-1.5 border-b border-gray-800">
                        <span><i class="fa-solid fa-bolt text-emerald-400 mr-1.5"></i>2. 引率・後衛掩護陣（全拠点系スキルのみ配置 / ${setup.pickedLeadBack.length} / 10枠）</span>
                        <span class="text-xs font-mono text-emerald-300">コスト: ${calcCostSum(setup.pickedLeadBack).toFixed(1)} / 25.0</span>
                    </div>
                    <div class="grid grid-cols-2 sm:grid-cols-5 gap-3">
                        ${renderGridCards(setup.pickedLeadBack, setup.unifiedAdj.leadAddedStatsMap, function(it, adj) {
                            return '斧+' + SharedDB.formatBuffNum(it.evAxe.tMult + (adj.tBuff || 0)) + '%';
                        }, 'border-emerald-500', true)}
                    </div>
                </div>

                <div class="border border-gray-800 rounded-xl p-4 bg-gray-900/50">
                    <div class="flex justify-between items-center text-sm font-bold text-white mb-2 pb-1.5 border-b border-gray-800">
                        <span><i class="fa-solid fa-wind text-cyan-400 mr-1.5"></i>3. 引率・速度掩護陣（部隊速度上昇枠・余り副将配置 / ${setup.pickedLeadSpeed.length} / 10枠）</span>
                        <span class="text-xs font-mono text-cyan-300">コスト: ${calcCostSum(setup.pickedLeadSpeed).toFixed(1)} / 25.0</span>
                    </div>
                    <div class="grid grid-cols-2 sm:grid-cols-5 gap-3">
                        ${renderGridCards(setup.pickedLeadSpeed, setup.unifiedAdj.leadAddedStatsMap, function(it, adj) {
                            return '速+' + SharedDB.formatBuffNum(it.evSel.troopSpeedPct + (adj.spdPct || 0)) + '%';
                        }, 'border-cyan-500', false)}
                    </div>
                </div>
            </div>
        `;

        var soloSectionHTML = `
            <div class="bg-sangoku-dark border-2 border-red-500/50 p-5 rounded-2xl shadow-xl space-y-6">
                <div class="flex flex-wrap items-center justify-between gap-3 border-b border-gray-800 pb-4">
                    <div>
                        <div class="flex items-center space-x-2 mb-1">
                            <span class="bg-red-600 text-white text-xs font-extrabold px-2.5 py-0.5 rounded">北伐・単騎デッキ</span>
                            <h3 class="text-lg font-bold text-white">単騎エース 5人 ＆ 掩護陣 3デッキ（30枠）</h3>
                        </div>
                        <div class="text-xs text-gray-300 font-mono flex flex-wrap gap-4 mt-1">
                            <span>前衛＋後衛 武将バフ: <b class="text-red-400">+${SharedDB.formatBuffNum(setup.soloSupportGenBuff)}%</b></span>
                            <span>檄令加算合計: <b class="text-amber-300">+${setup.soloTotalGekirei.toLocaleString()}</b></span>
                            <span>雷令基礎速度加算(SL基準): <b class="text-cyan-300">+${setup.slRaireiTotal}</b></span>
                            <span>速度掩護陣%: <b class="text-cyan-400">+${SharedDB.formatBuffNum(setup.soloSpeedSupportPct)}%</b></span>
                        </div>
                    </div>
                </div>

                <div>
                    <div class="text-sm font-bold text-red-300 mb-2.5 border-l-4 border-red-500 pl-2">単騎エース 5人（最終火力 ＆ 雷令・鋭ステ反映後の最終移動速度）</div>
                    <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                        ${soloAcesHTML}
                    </div>
                </div>

                <div class="border border-gray-800 rounded-xl p-4 bg-gray-900/50">
                    <div class="flex justify-between items-center text-sm font-bold text-white mb-2 pb-1.5 border-b border-gray-800">
                        <span><i class="fa-solid fa-hand-fist text-red-400 mr-1.5"></i>1. 単騎・前衛掩護陣（拠点縛り・襲令・手動支援配置可 / ${setup.pickedSoloFront.length} / 10枠）</span>
                        <span class="text-xs font-mono text-red-300">コスト: ${calcCostSum(setup.pickedSoloFront).toFixed(1)} / 25.0</span>
                    </div>
                    <div class="grid grid-cols-2 sm:grid-cols-5 gap-3">
                        ${renderGridCards(setup.pickedSoloFront, setup.unifiedAdj.soloAddedStatsMap, function(it, adj) {
                            return '将+' + SharedDB.formatBuffNum(it.evSolo.gMult + (adj.gBuff || 0)) + '%';
                        }, 'border-red-400', true)}
                    </div>
                </div>

                <div class="border border-gray-800 rounded-xl p-4 bg-gray-900/50">
                    <div class="flex justify-between items-center text-sm font-bold text-white mb-2 pb-1.5 border-b border-gray-800">
                        <span><i class="fa-solid fa-bolt text-emerald-400 mr-1.5"></i>2. 単騎・後衛掩護陣（全拠点系スキルのみ配置 / ${setup.pickedSoloBack.length} / 10枠）</span>
                        <span class="text-xs font-mono text-emerald-300">コスト: ${calcCostSum(setup.pickedSoloBack).toFixed(1)} / 25.0</span>
                    </div>
                    <div class="grid grid-cols-2 sm:grid-cols-5 gap-3">
                        ${renderGridCards(setup.pickedSoloBack, setup.unifiedAdj.soloAddedStatsMap, function(it, adj) {
                            var totGk = it.evSolo.rawGekirei + (adj.gkAdd || 0);
                            if (totGk > 0) return '檄+' + totGk.toLocaleString();
                            return '将+' + SharedDB.formatBuffNum(it.evSolo.gMult + (adj.gBuff || 0)) + '%';
                        }, 'border-emerald-500', true)}
                    </div>
                </div>

                <div class="border border-gray-800 rounded-xl p-4 bg-gray-900/50">
                    <div class="flex justify-between items-center text-sm font-bold text-white mb-2 pb-1.5 border-b border-gray-800">
                        <span><i class="fa-solid fa-bolt-lightning text-cyan-400 mr-1.5"></i>3. 単騎・速度掩護陣（雷令基礎加算 ＋ 速度%上昇枠・余り副将配置 / ${setup.pickedSoloSpeed.length} / 10枠）</span>
                        <span class="text-xs font-mono text-cyan-300">コスト: ${calcCostSum(setup.pickedSoloSpeed).toFixed(1)} / 25.0</span>
                    </div>
                    <div class="grid grid-cols-2 sm:grid-cols-5 gap-3">
                        ${renderGridCards(setup.pickedSoloSpeed, setup.unifiedAdj.soloAddedStatsMap, function(it, adj) {
                            var totRr = Math.round((it.evSolo.rawRairei + (adj.rrAdd || 0)) * 100) / 100;
                            var totSpd = it.evSolo.speedPct + (adj.spdPct || 0);
                            if (totRr > 0 && totSpd > 0) return '雷(SL)+' + totRr + ' / 速+' + SharedDB.formatBuffNum(totSpd) + '%';
                            if (totRr > 0) return '雷令(SL) 素速+' + totRr;
                            return '速+' + SharedDB.formatBuffNum(totSpd) + '%';
                        }, 'border-cyan-500', false)}
                    </div>
                </div>
            </div>
        `;

        var visibleBodyHTML = '';
        if (activeSubView === 'LEAD') visibleBodyHTML = leadSectionHTML;
        else if (activeSubView === 'SOLO') visibleBodyHTML = soloSectionHTML;
        else visibleBodyHTML = leadSectionHTML + soloSectionHTML;

        area.className = "space-y-6 animate-flash";
        area.innerHTML = `
            <div class="bg-purple-950/30 border border-purple-500/40 rounded-xl px-4 py-3 text-xs text-purple-200 flex flex-wrap items-center justify-between gap-2">
                <span><i class="fa-solid fa-link text-purple-400 mr-1.5"></i><b>北伐特別ルール適用：</b>「攻:」第1スキル持ちはエース副将にのみ許可・サポート陣へは「防:」等有効スキル持ちのみ合計値比較で選出しています。</span>
                <span class="font-mono text-amber-300 font-bold">エース・前衛・後衛使用: ${setup.unifiedAdj.frontBackUsedCount}枚 ／ 速度陣への余り配置: ${setup.unifiedAdj.speedLeftoverUsedCount}枚</span>
            </div>
            ${subViewBarHTML}
            ${visibleBodyHTML}
        `;
    }

    return {
        run: run,
        setSubView: function(view) {
            activeSubView = view || 'LEAD';
            if (currentHokuSetup) render(currentHokuSetup);
        },
        setBuff10: function(val) {
            isBuff10 = Boolean(val);
            var btnOff = document.getElementById('btnHokuBuff10Off');
            var btnOn = document.getElementById('btnHokuBuff10On');
            if (isBuff10) {
                if (btnOff) btnOff.className = "py-1 text-xs font-bold rounded-lg transition text-gray-400 hover:text-white cursor-pointer";
                if (btnOn) btnOn.className = "py-1 text-xs font-bold rounded-lg transition bg-red-600 text-white shadow cursor-pointer";
            } else {
                if (btnOff) btnOff.className = "py-1 text-xs font-bold rounded-lg transition bg-gray-700 text-white shadow cursor-pointer";
                if (btnOn) btnOn.className = "py-1 text-xs font-bold rounded-lg transition text-gray-400 hover:text-white cursor-pointer";
            }
            run(false);
        }
    };
})();