// ========================================================
// 【共通UI描画モジュール】js/shared-ui.js (Ver. 2.00)
// 役割：カードビジュアル描画、副将バッジ表示（一般副将・ミラー鏡・帝仙鏡）、スキル詳細ツールチップ生成
// ========================================================
window.SharedUI = (function() {
    var imgLoadMode = 'AUTO';
    try {
        var savedMode = localStorage.getItem('3gokushi_img_mode_v1');
        if (savedMode === 'OFFLINE' || savedMode === 'AUTO') imgLoadMode = savedMode;
    } catch (e) {}

    var HOLO_BG_FILES = {
        'SL': 'bg_card_sl.gif',
        'L':  'bg_card_l.gif',
        'UR': 'bg_card_ur.png',
        'SR': 'bg_card_sr.png',
        'R':  'bg_card_r.png',
        'UC': 'bg_card_uc.png',
        'C':  'bg_card_c.png'
    };
    var HOLO_CDN_BASE = 'https://cdn-3gokushi.marv-games.jp/Hx39bKvONUDQ5KLWrM5ZvOb5BxssB3II-lKJC8zElQU=/20261105-01/extend_project/w945/img/card/common_4sk/';

    var resolvedSrcCache = Object.create(null);
    var failedRemoteCache = Object.create(null);

    var fetchQueue = [];
    var activeServerFetches = 0;
    var MAX_CONCURRENT_FETCHES = 2;
    var FETCH_INTERVAL_MS = 350;
    var lastFetchTimestamp = 0;
    var queueTimerId = null;
    var consecutiveServerErrors = 0;
    var emergencyOfflineLocked = false;

    function resetImageCaches() {
        resolvedSrcCache = Object.create(null);
        failedRemoteCache = Object.create(null);
        fetchQueue = [];
        consecutiveServerErrors = 0;
        emergencyOfflineLocked = false;
        updateModeUI();
    }

    function setImgLoadMode(mode) {
        if (mode !== 'AUTO' && mode !== 'OFFLINE') return;
        imgLoadMode = mode;
        emergencyOfflineLocked = false;
        consecutiveServerErrors = 0;
        try {
            localStorage.setItem('3gokushi_img_mode_v1', mode);
        } catch (e) {}
        updateModeUI();
        if (mode === 'OFFLINE') {
            fetchQueue = [];
        } else {
            pumpFetchQueue();
        }
        rerenderCurrentTab();
    }

    function updateModeUI() {
        var btnAuto = document.getElementById('btnImgModeAuto');
        var btnOff = document.getElementById('btnImgModeOffline');
        var lblQueue = document.getElementById('imgQueueStatusBadge');
        if (btnAuto && btnOff) {
            if (imgLoadMode === 'AUTO' && !emergencyOfflineLocked) {
                btnAuto.className = "px-2.5 py-1 text-[11px] font-bold rounded-md bg-emerald-600 text-white shadow cursor-pointer transition";
                btnOff.className = "px-2.5 py-1 text-[11px] font-bold rounded-md text-gray-400 hover:text-white cursor-pointer transition";
            } else {
                btnAuto.className = "px-2.5 py-1 text-[11px] font-bold rounded-md text-gray-400 hover:text-white cursor-pointer transition";
                btnOff.className = "px-2.5 py-1 text-[11px] font-bold rounded-md bg-amber-600 text-black font-extrabold shadow cursor-pointer transition";
            }
        }
        if (lblQueue) {
            if (emergencyOfflineLocked) {
                lblQueue.textContent = "通信制限検知・自動オフライン保護中";
                lblQueue.className = "text-[10px] font-mono text-red-400 font-bold";
            } else if (imgLoadMode === 'OFFLINE') {
                lblQueue.textContent = "サーバー通信: 0 (img/のみ)";
                lblQueue.className = "text-[10px] font-mono text-amber-300";
            } else if (fetchQueue.length > 0) {
                lblQueue.textContent = "低負荷読込中: 残り" + fetchQueue.length + "枚";
                lblQueue.className = "text-[10px] font-mono text-cyan-300";
            } else {
                lblQueue.textContent = "img/優先・キャッシュ済";
                lblQueue.className = "text-[10px] font-mono text-emerald-400";
            }
        }
    }

    function rerenderCurrentTab() {
        var activeTab = document.querySelector('.nav-tab.active');
        var tabName = activeTab ? activeTab.dataset.tab : 'solo';
        if (tabName === 'list') renderCardList(false);
        else if (tabName === 'solo' && window.SoloEngine) SoloEngine.run(false);
        else if (tabName === 'lead' && window.LeadEngine) LeadEngine.run(false);
        else if (tabName === 'def' && window.DefEngine) DefEngine.run(false);
        else if (tabName === 'hokubatsu' && window.HokubatsuEngine) HokubatsuEngine.run(false);
    }

    function extractFilenameFromUrl(url) {
        if (!url) return '';
        var clean = String(url).split('?')[0].split('#')[0];
        var parts = clean.split('/');
        var last = parts[parts.length - 1] || '';
        return last.trim();
    }

    function toFullIllustUrl(url) {
        if (!url) return '';
        return String(url).replace('/illust_thumb/', '/illust/');
    }

    function getLocalCandidatePaths(card, preferFullIllust) {
        var paths = [];
        if (!card) return paths;

        var rawUrl = String(card.imageSrc || '').trim();
        var fullUrl = toFullIllustUrl(rawUrl);
        var fullFname = extractFilenameFromUrl(fullUrl);
        var rawFname = extractFilenameFromUrl(rawUrl);

        if (!preferFullIllust && rawFname) {
            paths.push('img/thumb_' + rawFname);
        }
        if (fullFname) {
            paths.push('img/' + fullFname);
        }
        var cNo = String(card.cardNo || '').replace(/[^0-9]/g, '').trim();
        if (cNo) {
            var pPng = 'img/' + cNo + '.png';
            var pJpg = 'img/' + cNo + '.jpg';
            var pCardJpg = 'img/card_' + cNo + '.jpg';
            if (paths.indexOf(pPng) === -1) paths.push(pPng);
            if (paths.indexOf(pJpg) === -1) paths.push(pJpg);
            if (paths.indexOf(pCardJpg) === -1) paths.push(pCardJpg);
        }
        if (rawFname && paths.indexOf('img/' + rawFname) === -1) {
            paths.push('img/' + rawFname);
        }
        return paths;
    }

    function getRemoteUrl(card, preferFullIllust) {
        if (!card) return '';
        var src = String(card.imageSrc || '').trim();
        if (src && (src.indexOf('http://') === 0 || src.indexOf('https://') === 0)) {
            return preferFullIllust ? toFullIllustUrl(src) : src;
        }
        var cNo = String(card.cardNo || '').replace(/[^0-9]/g, '').trim();
        if (cNo) {
            return 'https://3gokushi.jp/img/card/card_' + cNo + '.jpg';
        }
        return '';
    }

    function getCardCacheKey(card, preferFullIllust) {
        if (!card) return '';
        var rUrl = getRemoteUrl(card, preferFullIllust);
        var fname = extractFilenameFromUrl(rUrl);
        var prefix = preferFullIllust ? 'full_' : 'sub_';
        if (fname) return prefix + 'fn_' + fname;
        var cNo = String(card.cardNo || '').replace(/[^0-9]/g, '').trim();
        if (cNo) return prefix + 'no_' + cNo;
        return prefix + 'nm_' + String(card.name || '');
    }

    function getInitialImageAttrs(card, preferFullIllust) {
        var cacheKey = getCardCacheKey(card, preferFullIllust);
        var localPaths = getLocalCandidatePaths(card, preferFullIllust);
        var remoteUrl = getRemoteUrl(card, preferFullIllust);
        var initialSrc = '';
        var initialStage = 'local';

        if (cacheKey && resolvedSrcCache[cacheKey]) {
            initialSrc = resolvedSrcCache[cacheKey];
            initialStage = initialSrc.indexOf('http') === 0 ? 'remote' : 'local';
        } else if (localPaths.length > 0) {
            initialSrc = localPaths[0];
            initialStage = 'local';
        } else if (imgLoadMode === 'AUTO' && !emergencyOfflineLocked && remoteUrl) {
            initialSrc = remoteUrl;
            initialStage = 'remote';
        }

        return {
            cacheKey: cacheKey,
            localPaths: localPaths,
            remoteUrl: remoteUrl,
            initialSrc: initialSrc,
            initialStage: initialStage,
            preferFullFlag: preferFullIllust ? '1' : '0'
        };
    }

    function pumpFetchQueue() {
        updateModeUI();
        if (imgLoadMode === 'OFFLINE' || emergencyOfflineLocked) {
            fetchQueue = [];
            return;
        }
        if (fetchQueue.length === 0 || activeServerFetches >= MAX_CONCURRENT_FETCHES) {
            return;
        }

        var now = Date.now();
        var wait = Math.max(0, FETCH_INTERVAL_MS - (now - lastFetchTimestamp));
        if (wait > 0) {
            if (!queueTimerId) {
                queueTimerId = setTimeout(function() {
                    queueTimerId = null;
                    pumpFetchQueue();
                }, wait);
            }
            return;
        }

        var job = fetchQueue.shift();
        if (!job || !job.imgEl || !document.body.contains(job.imgEl)) {
            pumpFetchQueue();
            return;
        }

        if (failedRemoteCache[job.remoteUrl]) {
            job.imgEl.style.display = 'none';
            pumpFetchQueue();
            return;
        }

        lastFetchTimestamp = Date.now();
        activeServerFetches++;
        job.imgEl.dataset.stage = 'remote';
        job.imgEl.src = job.remoteUrl;
        updateModeUI();
    }

    function handleImgLoad(imgEl) {
        if (!imgEl) return;
        var stage = imgEl.dataset.stage || 'local';
        var preferFull = (imgEl.dataset.preferFull === '1');

        if (stage === 'local' && preferFull && imgEl.naturalWidth > 0 && imgEl.naturalWidth < 250) {
            var remoteUrl = imgEl.dataset.remoteUrl || '';
            if (imgLoadMode === 'AUTO' && !emergencyOfflineLocked && remoteUrl && !failedRemoteCache[remoteUrl]) {
                imgEl.dataset.preferFull = '0';
                fetchQueue.push({ imgEl: imgEl, remoteUrl: remoteUrl });
                pumpFetchQueue();
                return;
            }
        }

        var cacheKey = imgEl.dataset.cacheKey;
        if (cacheKey && imgEl.getAttribute('src')) {
            resolvedSrcCache[cacheKey] = imgEl.getAttribute('src');
        }
        if (stage === 'remote') {
            activeServerFetches = Math.max(0, activeServerFetches - 1);
            consecutiveServerErrors = 0;
            pumpFetchQueue();
        }
    }

    function handleImgError(imgEl) {
        if (!imgEl) return;
        var stage = imgEl.dataset.stage || 'local';

        if (stage === 'remote') {
            activeServerFetches = Math.max(0, activeServerFetches - 1);
            var badUrl = imgEl.getAttribute('src') || '';
            if (badUrl) failedRemoteCache[badUrl] = true;
            consecutiveServerErrors++;

            if (consecutiveServerErrors >= 4) {
                emergencyOfflineLocked = true;
                fetchQueue = [];
                updateModeUI();
                if (window.AppCards && AppCards.setStatusLog) {
                    AppCards.setStatusLog("サーバー側の応答制限を検知したため、自動オフライン保護モードに切り替えました（計算機能はそのまま使えます）", true);
                }
            }
            imgEl.style.display = 'none';
            pumpFetchQueue();
            return;
        }

        var candidatesStr = imgEl.dataset.localPaths || '';
        var candidates = candidatesStr ? candidatesStr.split('|') : [];
        var nextIdx = (parseInt(imgEl.dataset.localIdx || '0', 10) || 0) + 1;

        if (nextIdx < candidates.length) {
            imgEl.dataset.localIdx = String(nextIdx);
            imgEl.src = candidates[nextIdx];
            return;
        }

        var remoteUrl = imgEl.dataset.remoteUrl || '';
        if (imgLoadMode === 'OFFLINE' || emergencyOfflineLocked || !remoteUrl || failedRemoteCache[remoteUrl]) {
            imgEl.style.display = 'none';
            return;
        }

        var cacheKey = imgEl.dataset.cacheKey || '';
        if (cacheKey && resolvedSrcCache[cacheKey]) {
            imgEl.dataset.stage = 'remote';
            imgEl.src = resolvedSrcCache[cacheKey];
            return;
        }

        fetchQueue.push({ imgEl: imgEl, remoteUrl: remoteUrl });
        pumpFetchQueue();
    }

    function escapeHTML(str) {
        return String(str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function resolveAdjutantInfo(fk, parentCard, uCards, slotIndex) {
        if (!fk || typeof fk !== 'object') return null;
        var cardObj = (typeof fk === 'object' && fk.card && typeof fk.card === 'object') ? fk.card : null;
        var cardNo = String(fk.cardNo || fk.card_no || fk.no || fk.cardId || fk.card_id || fk.illust_id || fk.illustId || fk.id || (cardObj && (cardObj.cardNo || cardObj.card_no)) || '').replace(/[^0-9]/g, '').trim();
        var name = String(fk.name || fk.card_name || fk.busho_name || fk.chara_name || (cardObj && cardObj.name) || '副将').trim();

        var matchedUserCard = null;
        if (cardNo && uCards && uCards.length > 0) {
            for (var i = 0; i < uCards.length; i++) {
                var uc = uCards[i];
                var ucNo = String(uc.cardNo || uc.card_no || '').replace(/[^0-9]/g, '').trim();
                if (ucNo && ucNo === cardNo) { matchedUserCard = uc; break; }
            }
        }

        var rarity = null;
        var rCandidates = [fk.rarity, fk.rare, fk.rank, fk.rarity_name, fk.rare_name, cardObj && cardObj.rarity, matchedUserCard && matchedUserCard.rarity];
        for (var ci = 0; ci < rCandidates.length; ci++) {
            var rVal = rCandidates[ci];
            if (rVal !== undefined && rVal !== null) {
                if (SharedDB.NUM_RARITY_MAP[rVal]) { rarity = SharedDB.NUM_RARITY_MAP[rVal]; break; }
                var rClean = String(rVal).trim().toUpperCase();
                if (SharedDB.RARITY_ORDER[rClean]) { rarity = rClean; break; }
            }
        }
        if (!rarity) {
            var mStart = name.match(/^(SL|L|UR|SR|R|UC|C)(?![a-zA-Z0-9])/i);
            if (mStart) rarity = mStart[1].toUpperCase();
        }
        if (!rarity && parentCard) rarity = String(parentCard.rarity || 'SL').toUpperCase();

        var cost = 0;
        var cCandidates = [fk.cost, fk.card_cost, cardObj && cardObj.cost, matchedUserCard && matchedUserCard.cost];
        for (var cci = 0; cci < cCandidates.length; cci++) {
            if (cCandidates[cci] !== undefined && cCandidates[cci] !== null) {
                var cNum = SharedDB.safeNum(cCandidates[cci], -1);
                if (cNum >= 0) { cost = cNum; break; }
            }
        }

        var rawAtk = SharedDB.safeNum(
            fk.baseAttack !== undefined ? fk.baseAttack : (fk.attack !== undefined ? fk.attack : (matchedUserCard ? matchedUserCard.baseAttack : 0)),
            0
        );
        var rawDef = SharedDB.safeNum(
            fk.baseDefense !== undefined ? fk.baseDefense : (fk.defense !== undefined ? fk.defense : (matchedUserCard ? matchedUserCard.baseDefense : 0)),
            0
        );
        var rawInt = SharedDB.safeNum(
            fk.intelligence !== undefined ? fk.intelligence : (matchedUserCard ? matchedUserCard.intelligence : 0),
            0
        );
        var rawSpd = SharedDB.safeNum(
            fk.speed !== undefined ? fk.speed : (matchedUserCard ? matchedUserCard.speed : 15),
            15
        );

        var mirrorInf = fk.info || SharedDB.getMirrorSkillInfo(Object.assign({}, fk, { rarity: rarity, baseAttack: rawAtk, baseDefense: rawDef, intelligence: rawInt, speed: rawSpd }));
        var st = SharedDB.getAdjutantStatusEffect(Object.assign({}, fk, { rarity: rarity, baseAttack: rawAtk, baseDefense: rawDef, intelligence: rawInt, speed: rawSpd }), mirrorInf);

        var label = String(fk.label || '').trim();
        if (!label) {
            if (mirrorInf && mirrorInf.type === 'musume_renkyo') {
                var isFemOrOther = parentCard && SharedDB.isFemaleOrOtherBusho && SharedDB.isFemaleOrOtherBusho(parentCard);
                if (isFemOrOther) {
                    label = mirrorInf.label;
                } else {
                    var fallbackRate = SharedDB.ADJUTANT_RATES.NORMAL_SKILL[rarity] || 80;
                    label = '娘錬鏡(男) ' + fallbackRate + '%';
                }
            } else if (mirrorInf && mirrorInf.label) {
                label = mirrorInf.label;
            } else if (SharedDB.isMirrorCard(name)) {
                var prefix = rarity === 'SL' ? '帝' : rarity === 'L' ? '天' : rarity === 'UR' ? '神' : '大';
                var rate = SharedDB.ADJUTANT_RATES.NORMAL_SKILL[rarity] || 80;
                label = (st.isBu ? '[武]' : st.isGo ? '[護]' : st.isEi ? '[鋭]' : '') + prefix + '明鏡 ' + rate + '%';
            } else {
                label = (st.isBu ? '[武]' : st.isGo ? '[護]' : st.isEi ? '[鋭]' : '') + '副将';
            }
        }

        var img = String(fk.imageSrc || fk.img_url || (cardObj && cardObj.imageSrc) || (matchedUserCard && matchedUserCard.imageSrc) || '').trim();
        if (!img && cardNo) img = 'https://3gokushi.jp/img/card/card_' + cardNo + '.jpg';

        return {
            name: name,
            cardNo: cardNo,
            rarity: rarity || 'SL',
            cost: cost,
            label: label,
            imageSrc: img,
            job: st.job,
            isBu: st.isBu,
            isGo: st.isGo,
            isEi: st.isEi,
            atkBonus: SharedDB.safeNum(fk.atkBonus, st.atkBonus),
            defBonus: SharedDB.safeNum(fk.defBonus, st.defBonus),
            spdBonus: SharedDB.safeNum(fk.spdBonus, st.spdBonus),
            statRate: st.statRate,
            copyRate: st.copyRate
        };
    }

    function getCardVisualHTML(card, assignedAdjutants, gekireiBonus, extraListBadgeHTML) {
        if (!card) return '';
        var b = 'badge-' + (card.rarity || 'C');
        var holoFile = HOLO_BG_FILES[card.rarity] || '';
        var holoStyle = holoFile ? ('background-image: url(\'img/' + holoFile + '\'); background-size: cover; background-position: center;') : '';
        var isExcluded = AppCards.excludedCardIds.has(card.uniqueId);

        var imgAttrs = getInitialImageAttrs(card, true);

        var countryBadge = '';
        if (card.country && card.country !== '不明') {
            var cColors = {
                '魏': 'bg-blue-600 text-white border-blue-400',
                '呉': 'bg-red-600 text-white border-red-400',
                '蜀': 'bg-green-600 text-white border-green-400',
                '他': 'bg-amber-600 text-black border-amber-400',
                '覇': 'bg-purple-700 text-white border-purple-400',
                '改': 'bg-teal-600 text-white border-teal-300'
            };
            var cStyle = cColors[card.country] || 'bg-gray-600 text-white border-gray-400';
            countryBadge = '<span class="text-[9px] px-1.5 rounded shadow-md border ' + cStyle + ' font-bold leading-none py-0.5 ml-1">' + escapeHTML(card.country) + '</span>';
        }

        var sColors = {
            'SPEAR':  'bg-emerald-700/95 text-white border-emerald-400',
            'BOW':    'bg-blue-700/95 text-white border-blue-400',
            'CAV':    'bg-amber-600/95 text-black border-amber-300',
            'SWORD':  'bg-teal-700/95 text-white border-teal-400',
            'AXE':    'bg-orange-700/95 text-white border-orange-400',
            'DOUBLE': 'bg-fuchsia-700/95 text-white border-fuchsia-400',
            'HAMMER': 'bg-sky-700/95 text-white border-sky-400'
        };
        var curSKey = card.soldierKey || 'OTHER';
        var curSLabel = (card.soldierLabel && card.soldierLabel !== '-') ? card.soldierLabel : '?';
        var sStyle = sColors[curSKey] || 'bg-gray-800/90 text-gray-300 border-gray-600';
        var soldierBadge = '<button type="button" onclick="event.stopPropagation(); SharedUI.cycleCardSoldier(\'' + escapeHTML(card.uniqueId) + '\')" title="クリックで兵科を手動変更 (現在: ' + escapeHTML(card.soldierType || '未設定') + ')" class="text-[9px] px-1 rounded shadow-md border ' + sStyle + ' font-bold leading-none py-0.5 ml-1 cursor-pointer hover:brightness-125">' + escapeHTML(curSLabel) + '</button>';

        var costBadge = '';
        if (card.hasTeisenkyo) {
            costBadge = '<span class="badge-teisen-cost text-[9px] font-black bg-gradient-to-r from-emerald-400 via-teal-300 to-cyan-300 text-slate-950 px-1.5 py-0.5 rounded shadow-lg border border-cyan-100 flex items-center space-x-0.5 tracking-tight" title="帝仙鏡効果: コスト1.0化"><i class="fa-solid fa-wand-magic-sparkles text-[8px] text-emerald-900 mr-0.5"></i><span>C1.0</span></span>';
        } else {
            costBadge = '<span class="text-[10px] bg-black/70 text-amber-300 px-1 rounded shadow-md border border-amber-500/30">C' + escapeHTML(card.cost) + '</span>';
        }

        var excludeBtn = '<button type="button" onclick="event.stopPropagation(); AppCards.toggleExcludeCard(\'' + escapeHTML(card.uniqueId) + '\')" class="absolute top-1 right-1 z-30 p-1 rounded-md text-[10px] transition shadow-md ' + (isExcluded ? 'bg-emerald-600 text-white' : 'bg-black/70 text-gray-400 hover:text-red-400') + ' cursor-pointer"><i class="fa-solid ' + (isExcluded ? 'fa-rotate-left' : 'fa-ban') + '"></i></button>';

        var skillsTooltip = '<div class="font-bold text-white mb-1.5 border-b border-gray-700 pb-1">所持スキル <span class="text-[9px] text-gray-400 font-normal">(No.' + escapeHTML(card.cardNo || '-') + ' / ' + escapeHTML(card.soldierType || '-') + ' / ' + escapeHTML(card.country || '-') + ')</span></div>';
        var skills = card.skills || [];
        if (skills.length > 0) {
            skillsTooltip += skills.map(function(s) {
                return '<div class="my-1"><span class="text-amber-400 font-bold">' + escapeHTML((s && s.name) || '') + '</span><br><span class="text-[9px] text-gray-300 block">' + escapeHTML((s && s.description) || '') + '</span></div>';
            }).join('');
        } else {
            skillsTooltip += '<div class="text-gray-500">スキルなし</div>';
        }

        var gekireiBadgeHTML = '';
        if (gekireiBonus && gekireiBonus.bonus > 0) {
            gekireiBadgeHTML = '<div class="absolute top-7 left-1 z-30 bg-gradient-to-r from-blue-700 to-indigo-800 border border-cyan-400 text-white text-[8px] font-bold px-1.5 py-0.5 rounded shadow-lg font-mono">' + escapeHTML(gekireiBonus.series || '檄令') + ' +' + gekireiBonus.bonus.toLocaleString() + '</div>';
        }

        var adjutantSectionHTML = '';
        var isHa = SharedDB.isHaBusho(card);
        var hasExplicitAdjutants = (assignedAdjutants !== undefined && assignedAdjutants !== null);

        if ((!card.isAdjutant || hasExplicitAdjutants) && !isHa) {
            var slotCount = card.rarity === 'SL' ? 2 : 1;
            var displayList = [];
            if (hasExplicitAdjutants) displayList = assignedAdjutants;
            else displayList = Array.isArray(card.fukusho) ? card.fukusho : Object.values(card.fukusho || {});

            if (card.maxFukushoCost > 0 || displayList.length > 0) {
                var miniSlotsHTML = '';
                for (var i = 0; i < slotCount; i++) {
                    var rawFk = displayList[i] || null;
                    var fk = resolveAdjutantInfo(rawFk, card, AppCards.userCards, i);
                    if (fk && fk.label && fk.label !== '副将 (通常)') {
                        var fkName = fk.name;
                        var fkRarity = fk.rarity;
                        var fkLabel = fk.label;
                        var fkCost = fk.cost;
                        var fkImgAttrs = getInitialImageAttrs(fk, false);

                        var fkBorderClass = '';
                        var fkLabelBorderClass = '';
                        var fkPopupBorderClass = '';

                        if (fkRarity === 'SL') {
                            fkBorderClass = 'border-2 border-purple-500 hover:border-purple-300 hover:ring-2 hover:ring-purple-400 shadow-[0_0_8px_rgba(147,51,234,0.4)]';
                            fkLabelBorderClass = 'border-purple-400/80';
                            fkPopupBorderClass = 'border-purple-400';
                        } else if (fkRarity === 'L') {
                            fkBorderClass = 'border-2 border-amber-400 hover:border-yellow-200 hover:ring-2 hover:ring-amber-300 shadow-[0_0_8px_rgba(251,191,36,0.4)]';
                            fkLabelBorderClass = 'border-amber-400/80';
                            fkPopupBorderClass = 'border-amber-400';
                        } else if (fkRarity === 'UR') {
                            fkBorderClass = 'border-2 border-blue-500 hover:border-cyan-300 hover:ring-2 hover:ring-blue-400 shadow-[0_0_8px_rgba(59,130,246,0.4)]';
                            fkLabelBorderClass = 'border-blue-400/80';
                            fkPopupBorderClass = 'border-blue-400';
                        } else if (fkRarity === 'SR') {
                            fkBorderClass = 'border-2 border-red-500 hover:border-rose-300 hover:ring-2 hover:ring-red-400 shadow-[0_0_8px_rgba(239,68,68,0.4)]';
                            fkLabelBorderClass = 'border-red-400/80';
                            fkPopupBorderClass = 'border-red-400';
                        } else {
                            fkBorderClass = 'border-2 border-gray-500 hover:border-gray-300 hover:ring-2 hover:ring-gray-400';
                            fkLabelBorderClass = 'border-gray-400/80';
                            fkPopupBorderClass = 'border-gray-400';
                        }

                        var bonusLines = '';
                        if (fk.atkBonus && fk.atkBonus > 0) {
                            bonusLines += '<div class="text-[10px] text-red-400 font-mono font-bold mt-0.5">武ステ加算: +' + fk.atkBonus.toLocaleString() + ' (' + fk.statRate + '%)</div>';
                        }
                        if (fk.defBonus && fk.defBonus > 0) {
                            bonusLines += '<div class="text-[10px] text-sky-400 font-mono font-bold mt-0.5">護ステ加算: +' + fk.defBonus.toLocaleString() + ' (' + fk.statRate + '%)</div>';
                        }
                        if (fk.spdBonus && fk.spdBonus > 0) {
                            bonusLines += '<div class="text-[10px] text-cyan-400 font-mono font-bold mt-0.5">鋭ステ加算: +' + fk.spdBonus + ' (' + fk.statRate + '%)</div>';
                        }
                        if (!bonusLines) {
                            bonusLines = '<div class="text-[10px] text-gray-400 mt-0.5">職種: ' + escapeHTML(fk.job) + ' (ステ' + fk.statRate + '%)</div>';
                        }

                        var fkImgTag = fkImgAttrs.initialSrc
                            ? '<img src="' + escapeHTML(fkImgAttrs.initialSrc) + '" loading="lazy" data-prefer-full="0" data-cache-key="' + escapeHTML(fkImgAttrs.cacheKey) + '" data-stage="' + fkImgAttrs.initialStage + '" data-local-idx="0" data-local-paths="' + escapeHTML(fkImgAttrs.localPaths.join('|')) + '" data-remote-url="' + escapeHTML(fkImgAttrs.remoteUrl) + '" onload="SharedUI.handleImgLoad(this)" onerror="SharedUI.handleImgError(this)" class="w-full h-full object-cover rounded-md opacity-85 group-hover/adj:opacity-100 transition">'
                            : '';
                        var fkPopupImgTag = fkImgAttrs.initialSrc
                            ? '<img src="' + escapeHTML(fkImgAttrs.initialSrc) + '" loading="lazy" data-prefer-full="0" data-cache-key="' + escapeHTML(fkImgAttrs.cacheKey) + '" data-stage="' + fkImgAttrs.initialStage + '" data-local-idx="0" data-local-paths="' + escapeHTML(fkImgAttrs.localPaths.join('|')) + '" data-remote-url="' + escapeHTML(fkImgAttrs.remoteUrl) + '" onload="SharedUI.handleImgLoad(this)" onerror="SharedUI.handleImgError(this)" class="w-full h-full object-cover">'
                            : '';

                        miniSlotsHTML += `
                            <div class="relative w-14 h-14 rounded-md ${fkBorderClass} bg-slate-900 group/adj cursor-pointer transition shadow-md flex-shrink-0">
                                ${fkImgTag}
                                <div class="absolute inset-0 bg-gradient-to-t from-black via-black/20 to-transparent pointer-events-none rounded-md"></div>
                                <div class="absolute top-0.5 inset-x-0.5 flex justify-between items-center pointer-events-none z-10">
                                    <span class="text-[7px] px-1 rounded font-black badge-${escapeHTML(fkRarity)} leading-none shadow">${escapeHTML(fkRarity)}</span>
                                    <span class="text-[7px] px-0.5 bg-black/90 text-amber-400 rounded font-mono font-bold leading-none border border-amber-500/40">C${escapeHTML(fkCost)}</span>
                                </div>
                                <div class="absolute bottom-0.5 inset-x-0.5 z-10 pointer-events-none">
                                    <div class="bg-black/90 border ${fkLabelBorderClass} rounded px-0.5 py-0.5 text-center shadow">
                                        <div class="text-[7px] font-bold text-amber-300 truncate leading-none">${escapeHTML(fkLabel)}</div>
                                    </div>
                                </div>
                                <div class="hidden group-hover/adj:block absolute bottom-[105%] left-1/2 -translate-x-1/2 w-64 bg-slate-950/95 backdrop-blur-md border-2 ${fkPopupBorderClass} rounded-xl p-2.5 shadow-[0_15px_35px_rgba(0,0,0,0.95)] text-left z-[9999] pointer-events-none">
                                    <div class="flex space-x-2 pb-1.5 border-b border-gray-700">
                                        <div class="w-12 h-16 aspect-[3/4] rounded border ${fkPopupBorderClass} overflow-hidden bg-black flex-shrink-0">
                                            ${fkPopupImgTag}
                                        </div>
                                        <div class="flex-1 min-w-0">
                                            <div class="text-[9px] px-1 rounded font-black badge-${escapeHTML(fkRarity)} inline-block">${escapeHTML(fkRarity)}</div>
                                            <div class="text-xs font-bold text-white truncate mt-0.5">${escapeHTML(fkName)}</div>
                                            <div class="text-[10px] text-amber-300 font-bold mt-0.5">${escapeHTML(fkLabel)} (C${escapeHTML(fkCost)})</div>
                                            ${bonusLines}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        `;
                    } else {
                        var limitDisplayCost = Math.min(SharedDB.safeNum(card.originalCost !== undefined ? card.originalCost : card.cost, 4.5), SharedDB.safeNum(card.maxFukushoCost, 0));
                        miniSlotsHTML += `
                            <div class="w-14 h-14 rounded-md border-2 border-dashed border-gray-700 bg-black/40 flex flex-col items-center justify-center text-gray-500 shadow-inner" title="空き枠 (解放: ${limitDisplayCost}C迄)">
                                <span class="text-[8px] text-gray-400 font-mono leading-none">空き</span>
                                <span class="text-[8px] text-amber-500 font-mono font-bold leading-tight mt-0.5">${limitDisplayCost}C</span>
                            </div>
                        `;
                    }
                }

                adjutantSectionHTML = `
                    <div class="mt-1.5 pt-1.5 border-t border-gray-800/80 w-full flex flex-col items-center">
                        <div class="w-full flex items-center justify-between text-[8px] text-gray-400 font-bold mb-1 px-1">
                            <span class="flex items-center space-x-1"><i class="fa-solid fa-clone text-purple-400"></i><span>副将 (${slotCount}枠)</span></span>
                            <span class="text-amber-400 font-mono">${card.maxFukushoCost > 0 ? card.maxFukushoCost + 'C' : '未解放'}</span>
                        </div>
                        <div class="flex items-center justify-center space-x-1.5">${miniSlotsHTML}</div>
                    </div>
                `;
            }
        }

        var mainImgTag = imgAttrs.initialSrc
            ? '<img src="' + escapeHTML(imgAttrs.initialSrc) + '" loading="lazy" data-prefer-full="1" data-cache-key="' + escapeHTML(imgAttrs.cacheKey) + '" data-stage="' + imgAttrs.initialStage + '" data-local-idx="0" data-local-paths="' + escapeHTML(imgAttrs.localPaths.join('|')) + '" data-remote-url="' + escapeHTML(imgAttrs.remoteUrl) + '" onload="SharedUI.handleImgLoad(this)" onerror="SharedUI.handleImgError(this)" class="absolute inset-0 w-full h-full object-cover drop-shadow-[0_5px_5px_rgba(0,0,0,0.8)] z-0 rounded-lg">'
            : '';

        return `
            <div class="flex flex-col w-full rounded-lg overflow-visible group/card relative ${isExcluded ? 'card-excluded' : ''}">
                <div class="relative w-full aspect-[3/4] rounded-lg overflow-visible border border-gray-800 flex flex-col justify-between p-2 shadow-inner hover:z-30 transition bg-gray-950" style="${holoStyle}">
                    ${mainImgTag}
                    ${excludeBtn}
                    ${gekireiBadgeHTML}
                    <div class="relative z-10 flex justify-between items-center pr-6">
                        <div class="flex items-center">
                            <span class="text-[10px] px-1.5 rounded ${b} shadow-md">${escapeHTML(card.rarity)}</span>
                            ${countryBadge}
                            ${soldierBadge}
                        </div>
                        ${costBadge}
                    </div>
                    <div class="relative z-30 bg-black/90 backdrop-blur-sm px-1.5 py-1 rounded-md border border-gray-700 shadow-md mt-auto cursor-help group/stats hover:border-amber-400 transition">
                        <div class="text-[11px] font-bold text-white truncate">${escapeHTML(card.name)}</div>
                        <div class="flex justify-between items-center text-[10px] mt-0.5">
                            <span class="text-amber-400 font-mono">攻 ${(card.baseAttack || 0).toLocaleString()}</span>
                            <span class="text-gray-400">Lv.${card.level}</span>
                        </div>
                        ${extraListBadgeHTML || ''}
                        <div class="hidden group-hover/stats:block absolute bottom-[105%] left-0 w-[260px] bg-slate-950 border-2 border-amber-400 rounded-lg p-2.5 z-[999] text-[10px] shadow-[0_10px_30px_rgba(0,0,0,0.95)] pointer-events-none">${skillsTooltip}</div>
                    </div>
                </div>
                ${adjutantSectionHTML}
            </div>
        `;
    }

    function cycleCardSoldier(uniqueId) {
        var order = ['SPEAR', 'BOW', 'CAV', 'SWORD', 'AXE', 'DOUBLE', 'HAMMER'];
        var target = null;
        for (var i = 0; i < AppCards.userCards.length; i++) {
            if (AppCards.userCards[i].uniqueId === uniqueId) { target = AppCards.userCards[i]; break; }
        }
        if (!target) return;
        var idx = order.indexOf(target.soldierKey);
        var nextKey = order[(idx + 1) % order.length];
        SharedDB.setManualSoldierType(target.uniqueId, nextKey);
        if (target.cardNo) SharedDB.setManualSoldierType(target.cardNo, nextKey);

        var updated = SharedDB.normalizeSoldierType('', target);
        AppCards.userCards.forEach(function(c) {
            if (c.uniqueId === uniqueId || (target.cardNo && c.cardNo === target.cardNo)) {
                c.soldierKey = updated.key;
                c.soldierLabel = updated.label;
                c.soldierType = updated.raw;
            }
        });
        renderCardList(false);
        var activeTab = document.querySelector('.nav-tab.active');
        if (activeTab && activeTab.dataset.tab === 'solo' && window.SoloEngine) SoloEngine.run(false);
    }

    var SORT_LABELS = {
        'NONE':         '未設定',
        'cardNo':       'カードNo',
        'rarity':       'レアリティ',
        'level':        '武将Lv',
        'score':        'スコア',
        'cost':         'コスト',
        'attack':       '攻撃力',
        'intelligence': '知力',
        'defInfantry':  '歩兵防御',
        'defSpear':     '槍兵防御',
        'defBow':       '弓兵防御',
        'defCav':       '騎兵防御',
        'defAxe':       '斧兵防御',
        'defDouble':    '双兵防御',
        'defHammer':    '錘兵防御',
        'speed':        '移動速度'
    };

    function getCardSortValue(card, key) {
        if (!card || !key || key === 'NONE') return 0;
        switch (key) {
            case 'cardNo':
                return parseInt(String(card.cardNo || '').replace(/[^0-9]/g, ''), 10) || 0;
            case 'rarity':
                return SharedDB.RARITY_ORDER[String(card.rarity || 'C').toUpperCase()] || 0;
            case 'level':
                return SharedDB.safeNum(card.level, 0);
            case 'score':
                return SharedDB.safeNum(card.score, 0);
            case 'cost':
                return SharedDB.safeNum(card.cost, 0);
            case 'attack':
                return SharedDB.safeNum(card.baseAttack !== undefined ? card.baseAttack : card.attack, 0);
            case 'intelligence':
                return SharedDB.safeNum(card.intelligence, 0);
            case 'defInfantry':
                return SharedDB.safeNum(card.defInfantry, card.baseDefense || 0);
            case 'defSpear':
                return SharedDB.safeNum(card.defSpear, card.baseDefense || 0);
            case 'defBow':
                return SharedDB.safeNum(card.defBow, card.baseDefense || 0);
            case 'defCav':
                return SharedDB.safeNum(card.defCav, card.baseDefense || 0);
            case 'defAxe':
                return SharedDB.safeNum(card.defAxe, card.baseDefense || 0);
            case 'defDouble':
                return SharedDB.safeNum(card.defDouble, card.baseDefense || 0);
            case 'defHammer':
                return SharedDB.safeNum(card.defHammer, card.baseDefense || 0);
            case 'speed':
                return SharedDB.safeNum(card.speed, 0);
            default:
                return 0;
        }
    }

    function formatSortMetricBadge(card, key1, key2) {
        var extraKeys = [];
        var skipKeys = { 'NONE': 1, 'rarity': 1, 'level': 1, 'cost': 1, 'attack': 1 };
        if (key1 && !skipKeys[key1]) extraKeys.push(key1);
        if (key2 && !skipKeys[key2] && key2 !== key1) extraKeys.push(key2);
        if (extraKeys.length === 0) return '';

        var parts = extraKeys.map(function(k) {
            var lbl = SORT_LABELS[k] || k;
            var val = getCardSortValue(card, k);
            var valStr = (k === 'cardNo') ? ('#' + val) : val.toLocaleString();
            return '<span class="text-cyan-300">' + escapeHTML(lbl) + ':' + escapeHTML(valStr) + '</span>';
        });
        return '<div class="flex flex-wrap justify-between items-center text-[9px] font-mono mt-0.5 pt-0.5 border-t border-gray-800/80 gap-x-1">' + parts.join('') + '</div>';
    }

    function updateExcludedBadge() {
        var count = AppCards.excludedCardIds.size;
        var prefixes = ['solo', 'lead', 'def', 'hokubatsu', 'hoku', 'list'];
        prefixes.forEach(function(p) {
            var badge = document.getElementById(p + 'ExcludedInfoBadge');
            var txt = document.getElementById(p + 'ExcludedCountText');
            if (badge && txt) {
                if (count > 0) {
                    txt.textContent = count;
                    badge.classList.remove('hidden');
                } else {
                    badge.classList.add('hidden');
                }
            }
        });
    }

    var currentPage = 1;
    var PAGE_SIZE = 60;

    function buildPaginationBarHTML(page, totalPages, totalItems, startIdx, endIdx, isBottom) {
        if (totalItems <= 0) return '';

        var startP = Math.max(1, page - 2);
        var endP = Math.min(totalPages, page + 2);
        if (startP <= 2) {
            startP = 1;
            endP = Math.min(totalPages, 5);
        }
        if (endP >= totalPages - 1) {
            endP = totalPages;
            startP = Math.max(1, totalPages - 4);
        }

        var numButtonsHTML = '';
        if (startP > 1) {
            numButtonsHTML += '<button type="button" onclick="SharedUI.changePage(1, ' + isBottom + ')" class="px-2.5 py-1 rounded-md bg-gray-800 hover:bg-gray-700 text-xs font-mono text-gray-300 cursor-pointer">1</button>';
            if (startP > 2) numButtonsHTML += '<span class="text-xs text-gray-500 px-1">...</span>';
        }
        for (var p = startP; p <= endP; p++) {
            if (p === page) {
                numButtonsHTML += '<button type="button" class="px-2.5 py-1 rounded-md bg-sangoku-gold text-black text-xs font-mono font-extrabold shadow">' + p + '</button>';
            } else {
                numButtonsHTML += '<button type="button" onclick="SharedUI.changePage(' + p + ', ' + isBottom + ')" class="px-2.5 py-1 rounded-md bg-gray-800 hover:bg-gray-700 text-xs font-mono text-gray-300 cursor-pointer">' + p + '</button>';
            }
        }
        if (endP < totalPages) {
            if (endP < totalPages - 1) numButtonsHTML += '<span class="text-xs text-gray-500 px-1">...</span>';
            numButtonsHTML += '<button type="button" onclick="SharedUI.changePage(' + totalPages + ', ' + isBottom + ')" class="px-2.5 py-1 rounded-md bg-gray-800 hover:bg-gray-700 text-xs font-mono text-gray-300 cursor-pointer">' + totalPages + '</button>';
        }

        return `
            <div class="bg-sangoku-dark/90 border border-gray-800 rounded-xl px-3 py-2.5 flex flex-wrap items-center justify-between gap-2">
                <div class="text-xs font-mono text-gray-300">
                    全 <b class="text-white">${totalItems}</b> 枚中 <b class="text-amber-300">${startIdx + 1}〜${endIdx}</b> 枚目を表示
                    <span class="text-[11px] text-gray-400 ml-1">(${page} / ${totalPages} ページ・60枚単位)</span>
                </div>
                <div class="flex flex-wrap items-center gap-1">
                    <button type="button" onclick="SharedUI.changePage(1, ${isBottom})" ${page <= 1 ? 'disabled' : ''} class="px-2 py-1 rounded-md bg-gray-800 hover:bg-gray-700 text-xs font-bold text-white disabled:opacity-35 cursor-pointer" title="最初のページ">&laquo;</button>
                    <button type="button" onclick="SharedUI.changePage(${page - 1}, ${isBottom})" ${page <= 1 ? 'disabled' : ''} class="px-2.5 py-1 rounded-md bg-gray-800 hover:bg-gray-700 text-xs font-bold text-white disabled:opacity-35 cursor-pointer">前へ</button>
                    ${numButtonsHTML}
                    <button type="button" onclick="SharedUI.changePage(${page + 1}, ${isBottom})" ${page >= totalPages ? 'disabled' : ''} class="px-2.5 py-1 rounded-md bg-gray-800 hover:bg-gray-700 text-xs font-bold text-white disabled:opacity-35 cursor-pointer">次へ</button>
                    <button type="button" onclick="SharedUI.changePage(${totalPages}, ${isBottom})" ${page >= totalPages ? 'disabled' : ''} class="px-2 py-1 rounded-md bg-gray-800 hover:bg-gray-700 text-xs font-bold text-white disabled:opacity-35 cursor-pointer" title="最後のページ">&raquo;</button>
                </div>
            </div>
        `;
    }

    function renderCardList(resetPage) {
        if (resetPage !== false) currentPage = 1;
        var search = (document.getElementById('searchInput') ? document.getElementById('searchInput').value : '').toLowerCase();
        var rarity = document.getElementById('filterRarity') ? document.getElementById('filterRarity').value : 'ALL';
        var country = document.getElementById('filterCountry') ? document.getElementById('filterCountry').value : 'ALL';

        var sortKey1 = (document.getElementById('sortKey1') && document.getElementById('sortKey1').value) || 'rarity';
        var sortDir1 = (document.getElementById('sortDir1') && document.getElementById('sortDir1').value) || 'desc';
        var sortKey2 = (document.getElementById('sortKey2') && document.getElementById('sortKey2').value) || 'attack';
        var sortDir2 = (document.getElementById('sortDir2') && document.getElementById('sortDir2').value) || 'desc';

        var filtered = AppCards.userCards.filter(function(c) {
            var matchSearch = String(c.name || '').toLowerCase().indexOf(search) !== -1 || String(c.cardNo || '').indexOf(search) !== -1;
            var matchRarity = (rarity === 'ALL' || c.rarity === rarity);
            var matchCountry = (country === 'ALL' || c.country === country);
            return matchSearch && matchRarity && matchCountry;
        });

        filtered.sort(function(a, b) {
            if (sortKey1 && sortKey1 !== 'NONE') {
                var v1A = getCardSortValue(a, sortKey1);
                var v1B = getCardSortValue(b, sortKey1);
                if (v1A !== v1B) {
                    return sortDir1 === 'asc' ? (v1A - v1B) : (v1B - v1A);
                }
            }
            if (sortKey2 && sortKey2 !== 'NONE') {
                var v2A = getCardSortValue(a, sortKey2);
                var v2B = getCardSortValue(b, sortKey2);
                if (v2A !== v2B) {
                    return sortDir2 === 'asc' ? (v2A - v2B) : (v2B - v2A);
                }
            }
            return 0;
        });

        var badge = document.getElementById('filteredCountBadge');
        if (badge) badge.textContent = filtered.length;

        var tabList = document.getElementById('tab-list');
        var grid = document.getElementById('cardGrid');
        var topPager = document.getElementById('cardListPagerTop');
        var bottomPager = document.getElementById('cardListPagerBottom');
        if (!grid) return;

        if (tabList && tabList.classList.contains('hidden')) {
            grid.innerHTML = '';
            if (topPager) topPager.innerHTML = '';
            if (bottomPager) bottomPager.innerHTML = '';
            return;
        }

        grid.innerHTML = '';

        var totalItems = filtered.length;
        var totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
        if (currentPage > totalPages) currentPage = totalPages;
        var startIdx = (currentPage - 1) * PAGE_SIZE;
        var endIdx = Math.min(totalItems, startIdx + PAGE_SIZE);

        if (topPager) {
            topPager.innerHTML = buildPaginationBarHTML(currentPage, totalPages, totalItems, startIdx, endIdx, false);
        }
        if (bottomPager) {
            bottomPager.innerHTML = buildPaginationBarHTML(currentPage, totalPages, totalItems, startIdx, endIdx, true);
        }

        if (totalItems === 0) {
            grid.innerHTML = '<div class="col-span-full text-center text-sm text-gray-400 py-10 border border-dashed border-gray-800 rounded-xl">条件に一致するカードがありません</div>';
            return;
        }

        filtered.slice(startIdx, endIdx).forEach(function(c) {
            var extraBadge = formatSortMetricBadge(c, sortKey1, sortKey2);
            var el = document.createElement('div');
            el.className = 'bg-sangoku-cardBg border border-sangoku-cardBorder p-2 rounded-xl rarity-' + c.rarity + ' relative hover:z-40 transition';
            el.innerHTML = getCardVisualHTML(c, null, null, extraBadge);
            grid.appendChild(el);
        });
    }

    function changePage(p, scrollToTop) {
        currentPage = Math.max(1, p);
        renderCardList(false);
        if (scrollToTop) {
            var tabList = document.getElementById('tab-list');
            if (tabList && tabList.scrollIntoView) {
                tabList.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        }
    }

    function downloadSafeImageScript() {
        var uCards = AppCards.userCards || [];
        if (uCards.length === 0) {
            alert("先にJSONファイルを読み込んでください。");
            return;
        }

        var urlToFileMap = Object.create(null);
        var addPair = function(url, fname) {
            if (!url || !fname) return;
            if (url.indexOf('http://') !== 0 && url.indexOf('https://') !== 0) return;
            if (!urlToFileMap[fname]) {
                urlToFileMap[fname] = url;
            }
        };

        Object.keys(HOLO_BG_FILES).forEach(function(r) {
            var fn = HOLO_BG_FILES[r];
            addPair(HOLO_CDN_BASE + fn, fn);
        });

        uCards.forEach(function(c) {
            var uFull = getRemoteUrl(c, true);
            var fFull = extractFilenameFromUrl(uFull);
            if (uFull && fFull) addPair(uFull, fFull);

            if (Array.isArray(c.fukusho)) {
                c.fukusho.forEach(function(fk) {
                    var u2 = getRemoteUrl(fk, true);
                    var f2 = extractFilenameFromUrl(u2);
                    if (u2 && f2) addPair(u2, f2);
                });
            }
        });

        var fileNames = Object.keys(urlToFileMap);
        var txtLines = fileNames.map(function(fn) {
            return fn + '\t' + urlToFileMap[fn];
        });
        var txtContent = txtLines.join('\r\n');

        var blob = new Blob(['\uFEFF' + txtContent], { type: 'text/plain;charset=utf-8' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = '3gokushi_img_list.txt';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        alert(
            "画像リスト（3gokushi_img_list.txt / 全" + fileNames.length + "件）をダウンロードしました。\n\n" +
            "【画像の保存方法】\n" +
            "ダウンロードされた「3gokushi_img_list.txt」を、\n" +
            "同梱の「画像ダウンロード.bat」の上にドラッグ＆ドロップしてください。\n" +
            "（画像ダウンロード.bat をそのままダブルクリックしても自動でリストを探して開始します）"
        );
    }

    return {
        getCardVisualHTML: getCardVisualHTML,
        renderCardList: renderCardList,
        cycleCardSoldier: cycleCardSoldier,
        changePage: changePage,
        handleImgLoad: handleImgLoad,
        handleImgError: handleImgError,
        setImgLoadMode: setImgLoadMode,
        resetImageCaches: resetImageCaches,
        downloadSafeImageScript: downloadSafeImageScript,
        updateModeUI: updateModeUI,
        updateExcludedBadge: updateExcludedBadge
    };
})();