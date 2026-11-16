// ========================================================
// 【アプリ統合・カード管理】js/app-cards.js (Ver. 2.00)
// 役割：全カードJSON読込・フィルタ・除外設定、スロット別天候管理、単騎・引率・兵士防御の各計算エンジン制御
// ========================================================
window.AppCards = (function() {
    var state = {
        userCards: [],
        excludedCardIds: new Set(),
        slotWeathers: {
            h0: 'SUN', h1: 'SUN',
            k0: 'SUN', k1: 'SUN', k2: 'SUN', k3: 'SUN', k4: 'SUN',
            k5: 'SUN', k6: 'SUN', k7: 'SUN', k8: 'SUN'
        }
    };

    function setStatusLog(msg, isError) {
        var bar = document.getElementById('statusLogBar');
        var txt = document.getElementById('statusLogText');
        var errBox = document.getElementById('errorAlertBox');
        if (!bar || !txt) return;
        bar.classList.remove('hidden');
        txt.textContent = msg;
        if (isError) {
            errBox.classList.remove('hidden');
            errBox.textContent = msg;
        } else {
            errBox.classList.add('hidden');
        }
    }

    function extractAllCardsSmart(rawData) {
        var cards = [];
        var seenIds = new Set();

        function isRealCard(obj) {
            if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
            var containerKeys = ['cards', 'cardList', 'card_list', 'busho_list', 'list'];
            for (var ci = 0; ci < containerKeys.length; ci++) {
                if (obj[containerKeys[ci]] && typeof obj[containerKeys[ci]] === 'object') return false;
            }
            var name = String(obj.name || obj.card_name || obj.busho_name || obj.chara_name || '').trim();
            if (!name) return false;

            var containerNames = [
                'デッキ', 'ファイル', '待機', '宿舎', '宿舎1', '宿舎2', '倉庫', '本拠', '拠点',
                'deck', 'file', 'wait', 'dormitory', 'dormitory1', 'dormitory2', 'box', 'cards', '本拠デッキ'
            ];
            for (var cni = 0; cni < containerNames.length; cni++) {
                if (name.toLowerCase().indexOf(containerNames[cni]) !== -1 && name.length <= 10) return false;
            }

            var childDictCount = 0;
            var keys = Object.keys(obj);
            for (var ki = 0; ki < keys.length; ki++) {
                var k = keys[ki];
                if (['skills', 'fukusho', 'skill', 'skill_list', 'fukusho_cards', 'assist', 'card', 'defenses'].indexOf(k) === -1) {
                    if (obj[k] && typeof obj[k] === 'object' && !Array.isArray(obj[k])) childDictCount++;
                }
            }
            if (childDictCount >= 2) return false;

            var rawRarity = obj.rarity || obj.rare || obj.rank || obj.rarity_name || obj.rare_id;
            var hasValidRarity = false;
            if (rawRarity !== undefined && rawRarity !== null) {
                var rClean = String(rawRarity).trim().toUpperCase();
                if (SharedDB.RARITY_ORDER[rClean] || SharedDB.NUM_RARITY_MAP[rawRarity] || SharedDB.NUM_RARITY_MAP[parseInt(rClean)]) hasValidRarity = true;
            }
            if (name.match(/^(SL|L|UR|SR|R|UC|C)\b/i)) hasValidRarity = true;

            var hasCost = (obj.cost !== undefined || obj.card_cost || obj.c !== undefined);
            var hasAtk = (obj.attack !== undefined || obj.baseAttack !== undefined || obj.base_attack !== undefined || obj.atk !== undefined || obj.default_attack !== undefined);
            var hasSkills = Boolean(obj.skills || obj.skill || obj.skill_list || obj.skill_1);
            var hasNo = Boolean(obj.cardNo || obj.card_no || obj.no || obj.illust_id || obj.illustId || obj.cardId || obj.card_id);

            return (hasValidRarity && (hasCost || hasAtk || hasSkills || hasNo)) || (hasCost && hasAtk && hasSkills);
        }

        function traverse(node, depth) {
            if (depth > 12 || !node) return;
            if (Array.isArray(node)) {
                for (var i = 0; i < node.length; i++) traverse(node[i], depth + 1);
            } else if (typeof node === 'object') {
                if (isRealCard(node)) {
                    var cId = String(node.uniqueId || node.id || node.card_id || node.cardNo || node.card_no || Math.random());
                    if (!seenIds.has(cId)) { seenIds.add(cId); cards.push(node); }
                } else {
                    var values = Object.values(node);
                    for (var j = 0; j < values.length; j++) traverse(values[j], depth + 1);
                }
            }
        }
        traverse(rawData, 0);
        return cards;
    }

    function extractSkills(c) {
        var list = [];
        if (!c || typeof c !== 'object') return list;
        var raw = c.skills || c.skill_list || c.skills_info || c.skillList;
        if (raw) {
            if (Array.isArray(raw)) list = raw;
            else if (typeof raw === 'object') list = Object.values(raw);
            else if (typeof raw === 'string' && raw.trim()) list = [raw.trim()];
        }
        if (list.length === 0) {
            var sk = c.skill;
            if (typeof sk === 'string' && sk.trim()) list.push(sk.trim());
            else if (typeof sk === 'object' && sk) list = Array.isArray(sk) ? sk : [sk];
            if (c.skill_name) list.push({ name: c.skill_name, description: c.skill_desc || c.desc || '' });
        }
        for (var i = 1; i <= 5; i++) {
            var sk_i = c['skill_' + i] || c['skill' + i];
            if (sk_i) list.push(sk_i);
        }
        var result = [];
        for (var j = 0; j < list.length; j++) {
            var item = list[j];
            if (!item) continue;
            if (typeof item === 'string' && item.trim()) result.push({ name: item.trim(), description: item.trim() });
            else if (typeof item === 'object') {
                var n = String(item.name || item.skill_name || item.skillName || item.title || '').trim();
                var d = String(item.description || item.skill_desc || item.skillDesc || item.desc || item.detail || n).trim();
                if (n || d) result.push({ name: n || d, description: d || n });
            }
        }
        return result;
    }

    function extractFukusho(c, isHa) {
        if (isHa || !c || typeof c !== 'object') return [];
        var raw = c.fukusho || c.fukusho_cards || c.assist || c.assist_cards || c.sub_cards;
        if (!raw) return [];
        var list = Array.isArray(raw) ? raw : (typeof raw === 'object' ? Object.values(raw) : (typeof raw === 'string' && raw.trim() && raw !== 'なし' ? [{ name: raw.trim() }] : []));
        var result = [];
        for (var i = 0; i < list.length; i++) {
            var fk = list[i];
            if (!fk) continue;
            if (typeof fk === 'string' || typeof fk === 'number') result.push({ name: String(fk), cardNo: String(fk) });
            else if (typeof fk === 'object') result.push(fk);
        }
        return result;
    }

    function extractTroopDefenses(c, fallbackDef) {
        var defObj = (c && typeof c.defense === 'object' && c.defense !== null) ? c.defense :
                     (c && typeof c.defenses === 'object' && c.defenses !== null) ? c.defenses : {};

        var pickDef = function(keys) {
            for (var i = 0; i < keys.length; i++) {
                var k = keys[i];
                if (c && c[k] !== undefined && c[k] !== null && c[k] !== '') {
                    return SharedDB.safeNum(c[k], fallbackDef);
                }
                if (defObj && defObj[k] !== undefined && defObj[k] !== null && defObj[k] !== '') {
                    return SharedDB.safeNum(defObj[k], fallbackDef);
                }
            }
            return fallbackDef;
        };

        return {
            defInfantry: pickDef(['defInfantry', 'infantryDef', 'infantry_def', 'def_infantry', 'hoheiDef', 'hohei_def', 'def_hohei', 'swordDef', 'sword_def', 'def_sword', 'kenDef', 'ken_def', 'infantry', 'sword', '歩兵防御', '歩防御', '剣兵防御']),
            defSpear:    pickDef(['defSpear', 'spearDef', 'spear_def', 'def_spear', 'yariDef', 'yari_def', 'def_yari', 'spear', '槍兵防御', '槍防御']),
            defBow:      pickDef(['defBow', 'bowDef', 'bow_def', 'def_bow', 'yumiDef', 'yumi_def', 'def_yumi', 'bow', '弓兵防御', '弓防御']),
            defCav:      pickDef(['defCav', 'cavDef', 'cav_def', 'cavalryDef', 'cavalry_def', 'def_cav', 'def_cavalry', 'kiheiDef', 'kihei_def', 'cav', 'cavalry', '騎兵防御', '騎防御']),
            defAxe:      pickDef(['defAxe', 'axeDef', 'axe_def', 'def_axe', 'onoDef', 'ono_def', 'def_ono', 'axe', '斧兵防御', '斧防御']),
            defDouble:   pickDef(['defDouble', 'doubleDef', 'double_def', 'twinDef', 'twin_def', 'def_double', 'def_twin', 'souDef', 'sou_def', 'double', 'twin', '双兵防御', '双防御']),
            defHammer:   pickDef(['defHammer', 'hammerDef', 'hammer_def', 'def_hammer', 'suiDef', 'sui_def', 'tsuchiDef', 'hammer', '錘兵防御', '錘防御'])
        };
    }

    function resolveCountry(c) {
        var name = String((c && (c.name || c.card_name)) || '').trim();
        var rarity = String((c && (c.rarity || c.rare)) || '').trim();
        if (c && c.isHa || name.indexOf('×') !== -1 || rarity.indexOf('覇') !== -1 || name.indexOf('覇') !== -1) return '覇';
        var raw = String((c && (c.country || c.force || c.faction || c.seiryoku || c.group)) || '').trim();
        if (raw.indexOf('改') !== -1) return '改';
        if (raw.indexOf('魏') !== -1) return '魏';
        if (raw.indexOf('呉') !== -1) return '呉';
        if (raw.indexOf('蜀') !== -1) return '蜀';
        if (raw.indexOf('他') !== -1) return '他';
        var digits = String((c && (c.cardNo || c.card_no || c.no || c.cardno || c.cardId)) || '').replace(/[^0-9]/g, '');
        if (digits.length >= 3) {
            var first = digits.charAt(0);
            if (first === '1') return '蜀';
            if (first === '2') return '魏';
            if (first === '3') return '呉';
            if (first === '4') return '他';
            if (first === '5') return '覇';
            if (first === '6') return '改';
        }
        return '他';
    }

    function processFile(file) {
        if (!file) return;
        setStatusLog("ファイル読込中: " + file.name + "...");
        var reader = new FileReader();
        reader.onload = function(e) {
            var parsedData;
            try {
                parsedData = JSON.parse(e.target.result);
                if (typeof parsedData === 'string') parsedData = JSON.parse(parsedData);
            } catch (err) {
                alert("JSONファイルの解析に失敗しました。\n" + err.message);
                setStatusLog("JSONパースエラー: " + err.message, true);
                return;
            }
            var extractedCards = extractAllCardsSmart(parsedData);
            if (!extractedCards || extractedCards.length === 0) {
                alert("有効なカードデータが検出できませんでした。");
                setStatusLog("カードデータ未検出", true);
                return;
            }
            setStatusLog("カード抽出完了: " + extractedCards.length + "枚。最適化中...");
            loadData(extractedCards);
        };
        reader.readAsText(file);
    }

    function loadData(cards) {
        var cardList = Array.isArray(cards) ? cards : Object.values(cards || {});
        var dropZone = document.getElementById('uploadDropZone');
        var appContent = document.getElementById('appContent');
        if (dropZone) dropZone.classList.add('hidden');
        if (appContent) appContent.classList.remove('hidden');

        if (window.SharedUI && SharedUI.resetImageCaches) {
            SharedUI.resetImageCaches();
        }

        state.userCards = cardList.filter(function(c) { return c && typeof c === 'object'; }).map(function(c, idx) {
            var rawRarity = String((c && (c.rarity || c.rare || c.rank)) || 'C').trim().toUpperCase();
            var name = String((c && (c.name || c.card_name || c.busho_name)) || '不明').trim();
            var country = resolveCountry(c);
            var isHa = SharedDB.isHaBusho(c) || (country === '覇');
            var rawNo = String((c && (c.cardNo || c.card_no || c.no || c.cardno || c.cardId || c.card_id || c.id)) || idx).trim();

            var skills = extractSkills(c);
            var fukushoArr = extractFukusho(c, isHa);
            var hasEquippedTeisen = fukushoArr.some(function(fk) {
                if (!fk) return false;
                var t = String(fk.name || '') + ' ' + String(fk.label || '') + ' ' + String(fk.description || '');
                return t.indexOf('帝仙鏡') !== -1 || t.indexOf('仙鏡') !== -1;
            });

            var baseCost = SharedDB.safeNum(c && (c.cost || c.card_cost || c.c), 4.5);
            var finalCost = hasEquippedTeisen ? 1.0 : baseCost;
            var atk = SharedDB.safeNum(c && (c.attack || c.baseAttack || c.base_attack || c.atk || c.power || c.default_attack), 1000);
            var baseAtk = SharedDB.safeNum(c && (c.baseAttack || c.base_attack || c.attack || c.atk || c.power || c.default_attack), atk);
            var rawDefScalar = (c && typeof c.defense !== 'object') ? c.defense : undefined;
            var def = SharedDB.safeNum(c && (rawDefScalar || c.baseDefense || c.base_defense || c.def || c.default_defense), 1000);
            var baseDef = SharedDB.safeNum(c && (c.baseDefense || c.base_defense || rawDefScalar || c.def || c.default_defense), def);
            var troopDefs = extractTroopDefenses(c, baseDef);
            var spd = SharedDB.safeNum(c && (c.speed || c.move_speed || c.spd || c.default_speed), 15);
            var scoreVal = SharedDB.safeNum(c && (c.score || c.card_score || c.busho_score || c.point || c['スコア']), 0);

            var isAdj = Boolean(c && c.isAdjutant);
            var rawMaxFkVal = (c && c.maxFukushoCost !== undefined) ? c.maxFukushoCost :
                              (c && c.fukusho_cost !== undefined) ? c.fukusho_cost :
                              (c && c.fukusho_max_cost !== undefined) ? c.fukusho_max_cost : undefined;
            var maxFkCost = 0;
            if (!isHa) {
                if (rawMaxFkVal !== undefined && rawMaxFkVal !== null && rawMaxFkVal !== '') {
                    var parsedMaxFk = SharedDB.safeNum(rawMaxFkVal, 0);
                    if (parsedMaxFk > 0) {
                        maxFkCost = parsedMaxFk;
                    } else if (isAdj && parsedMaxFk === 0 && !SharedDB.isMirrorCard(name) && !SharedDB.getMirrorSkillInfo({ name: name, skills: skills })) {
                        maxFkCost = (rawRarity === 'SL') ? 9.0 : baseCost;
                    }
                } else {
                    maxFkCost = (rawRarity === 'SL' || rawRarity === 'L') ? 4.5 : 0;
                }
            }

            var rawSoldier = c && (c.soldierType || c.soldier_type || c.heika || c.unit_type || c.weapon_type || c.soldier || '-');
            var soldierInfo = SharedDB.normalizeSoldierType(rawSoldier, Object.assign({}, c, { skills: skills }));

            return {
                uniqueId: String((c && c.uniqueId) || ('card_' + idx + '_' + Math.random().toString(36).substring(2, 7))),
                cardNo: rawNo, name: name, rarity: rawRarity, country: country,
                attack: atk, baseAttack: baseAtk, defense: def, baseDefense: baseDef,
                defInfantry: troopDefs.defInfantry,
                defSpear: troopDefs.defSpear,
                defBow: troopDefs.defBow,
                defCav: troopDefs.defCav,
                defAxe: troopDefs.defAxe,
                defDouble: troopDefs.defDouble,
                defHammer: troopDefs.defHammer,
                speed: spd,
                score: scoreVal,
                intelligence: SharedDB.safeNum(c && c.intelligence, 50), originalCost: baseCost, cost: finalCost,
                hasTeisenkyo: hasEquippedTeisen, level: parseInt(c.level || 0) || 0,
                soldierType: soldierInfo.raw,
                soldierKey: soldierInfo.key,
                soldierLabel: soldierInfo.label,
                imageSrc: String(c.imageSrc || c.img_url || ''), isHa: isHa, isAdjutant: isAdj,
                maxFukushoCost: maxFkCost, fukusho: fukushoArr, skills: skills
            };
        });

        var cardByNo = Object.create(null);
        var cardByName = Object.create(null);
        state.userCards.forEach(function(uc) {
            if (uc.cardNo && (!cardByNo[uc.cardNo] || uc.baseAttack > cardByNo[uc.cardNo].baseAttack)) {
                cardByNo[uc.cardNo] = uc;
            }
            if (uc.name && (!cardByName[uc.name] || uc.baseAttack > cardByName[uc.name].baseAttack)) {
                cardByName[uc.name] = uc;
            }
        });

        state.userCards.forEach(function(uc) {
            if (!Array.isArray(uc.fukusho) || uc.fukusho.length === 0) return;
            uc.fukusho.forEach(function(fk) {
                if (!fk || typeof fk !== 'object') return;
                if (!fk.cardNo && fk.imageSrc) {
                    var mImg = String(fk.imageSrc).match(/\/([0-9]+)_/);
                    if (mImg) fk.cardNo = mImg[1];
                }
                var refCard = (fk.cardNo && cardByNo[fk.cardNo]) || (fk.name && cardByName[fk.name]);
                if (refCard) {
                    if (fk.baseAttack === undefined && fk.attack === undefined) fk.baseAttack = refCard.baseAttack;
                    if (fk.baseDefense === undefined && fk.defense === undefined) fk.baseDefense = refCard.baseDefense;
                    if (fk.speed === undefined) fk.speed = refCard.speed;
                    if (!fk.rarity) fk.rarity = refCard.rarity;
                    if (!fk.country) fk.country = refCard.country;
                    if (fk.intelligence === undefined) fk.intelligence = refCard.intelligence;
                }
            });
        });

        var maxAtk = 0, totalCost = 0, highRarityCount = 0;
        for (var i = 0; i < state.userCards.length; i++) {
            var card = state.userCards[i];
            if (card.baseAttack > maxAtk) maxAtk = card.baseAttack;
            totalCost += card.cost;
            if (card.rarity === 'SL' || card.rarity === 'L' || card.rarity === 'UR') highRarityCount++;
        }

        document.getElementById('statTotalCards').textContent = state.userCards.length;
        document.getElementById('statHighRarity').textContent = highRarityCount;
        document.getElementById('statMaxAttack').textContent = maxAtk.toLocaleString();
        document.getElementById('statAvgCost').textContent = state.userCards.length ? (totalCost / state.userCards.length).toFixed(1) : "0.0";

        if (window.SoloEngine && SoloEngine.resetFilter) {
            SoloEngine.resetFilter();
        }

        updateExcludedBadge();
        SharedUI.renderCardList(true);
        var activeTab = document.querySelector('.nav-tab.active');
        var tabName = activeTab ? activeTab.dataset.tab : 'solo';
        if (tabName === 'solo' && window.SoloEngine) SoloEngine.run(true);
        else if (tabName === 'lead' && window.LeadEngine) LeadEngine.run(true);
        else if (tabName === 'def' && window.DefEngine) DefEngine.run(true);
        else if (tabName === 'hokubatsu' && window.HokubatsuEngine) HokubatsuEngine.run(true);
    }

    function toggleExcludeCard(uniqueId) {
        if (state.excludedCardIds.has(uniqueId)) state.excludedCardIds.delete(uniqueId);
        else state.excludedCardIds.add(uniqueId);
        updateExcludedBadge();
        SharedUI.renderCardList(false);
        var activeTab = document.querySelector('.nav-tab.active');
        if (activeTab && activeTab.dataset.tab === 'solo') SoloEngine.run(false);
        else if (activeTab && activeTab.dataset.tab === 'lead') LeadEngine.run(false);
        else if (activeTab && activeTab.dataset.tab === 'def' && window.DefEngine) DefEngine.run(false);
        else if (activeTab && activeTab.dataset.tab === 'hokubatsu' && window.HokubatsuEngine) HokubatsuEngine.run(false);
    }

    function clearExcludedCards() {
        state.excludedCardIds.clear();
        updateExcludedBadge();
        SharedUI.renderCardList(false);
        var activeTab = document.querySelector('.nav-tab.active');
        if (activeTab && activeTab.dataset.tab === 'solo') SoloEngine.run(true);
        else if (activeTab && activeTab.dataset.tab === 'lead') LeadEngine.run(true);
        else if (activeTab && activeTab.dataset.tab === 'def' && window.DefEngine) DefEngine.run(true);
        else if (activeTab && activeTab.dataset.tab === 'hokubatsu' && window.HokubatsuEngine) HokubatsuEngine.run(true);
    }

    function updateExcludedBadge() {
        var count = state.excludedCardIds.size;
        var targets = [
            { badge: 'soloExcludedInfoBadge', text: 'soloExcludedCountText' },
            { badge: 'leadExcludedInfoBadge', text: 'leadExcludedCountText' },
            { badge: 'defExcludedInfoBadge', text: 'defExcludedCountText' },
            { badge: 'hokubatsuExcludedInfoBadge', text: 'hokubatsuExcludedCountText' },
            { badge: 'listExcludedInfoBadge', text: 'listExcludedCountText' }
        ];
        for (var i = 0; i < targets.length; i++) {
            var bEl = document.getElementById(targets[i].badge);
            var tEl = document.getElementById(targets[i].text);
            if (bEl && tEl) {
                if (count > 0) {
                    tEl.textContent = count;
                    bEl.classList.remove('hidden');
                } else {
                    bEl.classList.add('hidden');
                }
            }
        }
        if (window.SharedUI && SharedUI.updateExcludedBadge) {
            SharedUI.updateExcludedBadge();
        }
    }

    function changeSlotWeather(slotKey, newWeather) {
        state.slotWeathers[slotKey] = newWeather;
        var activeTab = document.querySelector('.nav-tab.active');
        if (activeTab && activeTab.dataset.tab === 'solo') SoloEngine.run(false);
        else if (activeTab && activeTab.dataset.tab === 'lead') LeadEngine.run(false);
        else if (activeTab && activeTab.dataset.tab === 'def' && window.DefEngine) DefEngine.run(false);
        else if (activeTab && activeTab.dataset.tab === 'hokubatsu' && window.HokubatsuEngine) HokubatsuEngine.run(false);
    }

    return {
        get userCards() { return state.userCards; },
        get excludedCardIds() { return state.excludedCardIds; },
        get slotWeathers() { return state.slotWeathers; },
        setStatusLog: setStatusLog,
        processFile: processFile,
        loadData: loadData,
        toggleExcludeCard: toggleExcludeCard,
        clearExcludedCards: clearExcludedCards,
        updateExcludedBadge: updateExcludedBadge,
        changeSlotWeather: changeSlotWeather
    };
})();