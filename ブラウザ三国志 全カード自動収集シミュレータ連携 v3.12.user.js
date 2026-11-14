// ==UserScript==
// @name         ブラウザ三国志 全カード自動収集シミュレータ連携 v3.12
// @namespace    http://tampermonkey.net/
// @version      3.12
// @description  最終ページ後の「データがもうありません」判定修正・大容量JSONのBlobダウンロード対応
// @match        https://*.3gokushi.jp/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// ==/UserScript==

(function() {
    'use strict';

    if (window.self !== window.top && !location.href.includes('deck') && !location.href.includes('card')) {
        return;
    }

    const STORAGE_KEY = 'bro3_cards_storage_v312';
    const STATUS_KEY = 'bro3_status_v312';
    const VALID_SOLDIER_TYPES = ['槍兵', '弓兵', '騎兵', '剣兵', '斧兵', '双兵', '錘兵'];

    function extractCardUniqueId(el) {
        const html = el.innerHTML;
        const matchComment = html.match(/cardWindow[_-](\d+)/i);
        if (matchComment) return matchComment[1];
        const matchCid = html.match(/cid[_-](\d+)/i);
        if (matchCid) return matchCid[1];
        const noEl = el.querySelector('.cardno');
        const cardNo = noEl ? noEl.textContent.trim() : "0000";
        return cardNo + '_' + Math.random().toString(36).substring(2, 8);
    }

    function extractSoldierType(el) {
        const searchContainers = [el];
        const parentPanel = el.closest('.ui-tabs-panel, .cardWrapper');
        if (parentPanel && parentPanel !== el) {
            searchContainers.push(parentPanel);
        }

        for (const container of searchContainers) {
            const priorityImgs = container.querySelectorAll('[class*="soltype"] img');
            for (const img of priorityImgs) {
                const label = (img.getAttribute('alt') || img.getAttribute('title') || '').trim();
                const matched = VALID_SOLDIER_TYPES.find(type => label.includes(type));
                if (matched) return matched;
            }

            const allImgs = container.querySelectorAll('img');
            for (const img of allImgs) {
                const alt = (img.getAttribute('alt') || '').trim();
                const title = (img.getAttribute('title') || '').trim();
                const matched = VALID_SOLDIER_TYPES.find(type => alt === type || title === type);
                if (matched) return matched;
            }
        }
        return "";
    }

    function extractCardData(el, cardNoFallback = "") {
        const nameEl = el.querySelector('.name-for-sub, .name, [class*="name"]');
        const name = nameEl ? nameEl.textContent.trim() : "不明";

        let rarity = "C";
        const isHa = !!el.querySelector('[class*="cardStatus_rarerity_ha_"]');

        const elementsToCheck = [el, ...el.querySelectorAll('*')];
        for (let node of elementsToCheck) {
            let found = false;
            for (let cls of node.classList) {
                if (cls.startsWith('rarity_') || cls.startsWith('rarerity_')) {
                    const m = cls.match(/_(sl|l|ur|sr|r|uc|c)(?:_|$)/i);
                    if (m) {
                        rarity = m[1].toUpperCase();
                        found = true;
                        break;
                    }
                }
            }
            if (found) break;
        }

        const lvEl = el.querySelector('.level span, .level');
        const level = lvEl ? parseInt(lvEl.textContent.replace('Lv.', '').trim()) || 0 : 0;

        const costEl = el.querySelector('.cost-for-sub, .cost');
        const cost = costEl ? parseFloat(costEl.textContent.trim()) || 0 : 0;

        const noEl = el.querySelector('.cardno');
        const cardNo = noEl ? noEl.textContent.trim() : cardNoFallback;

        const soldierType = extractSoldierType(el);

        let attack = 0;
        let baseAttack = 0;
        const attEls = el.querySelectorAll('.status_att');
        if (attEls.length > 1) {
            attEls.forEach(a => {
                const val = parseFloat(a.textContent.trim()) || 0;
                if (a.classList.contains('status_black') || a.style.display === 'none') {
                    baseAttack = val;
                } else {
                    attack = val;
                }
            });
        } else if (attEls.length === 1) {
            attack = parseFloat(attEls[0].textContent.trim()) || 0;
            baseAttack = attack;
        }

        const intEl = el.querySelector('.status_int');
        const intelligence = intEl ? parseFloat(intEl.textContent.trim()) || 0 : 0;

        const hpEl = el.querySelector('.status_hp .value');
        const hp = hpEl ? hpEl.textContent.trim() : "";

        let imageSrc = "";
        const imgCandidates = el.querySelectorAll('img');
        for (let img of imgCandidates) {
            let src = img.getAttribute('data-src') || img.getAttribute('data-original') || img.getAttribute('lazy-src') || img.src || "";
            if (!src || src.includes('icon') || src.includes('soltype') || src.includes('rarerity') || src.includes('btn') || src.includes('spacer') || src.includes('bg.png') || src.includes('No.png')) continue;
            if (src.startsWith('/')) src = window.location.origin + src;
            if (src.includes('/illust/') || src.includes('/illust_thumb/') || src.includes('card_') || (cardNo && src.includes(cardNo))) {
                imageSrc = src;
                break;
            }
        }

        let skills = [];
        let backPanel = null;

        const frontPanel = el.closest('.ui-tabs-panel');
        if (frontPanel && frontPanel.nextElementSibling && (frontPanel.nextElementSibling.classList.contains('ui-tabs-hide') || frontPanel.nextElementSibling.id.includes('-back'))) {
            backPanel = frontPanel.nextElementSibling;
        } else if (el.nextElementSibling && el.nextElementSibling.classList.contains('card_back_extra')) {
            backPanel = el.nextElementSibling;
        } else {
            const wrapper = el.closest('.cardWrapper, .cardWrapper2col');
            if (wrapper) backPanel = wrapper.querySelector('.card_back_extra, [id$="-back"]');
        }

        if (backPanel) {
            const skillItems = backPanel.querySelectorAll('li');
            skillItems.forEach(li => {
                const nameSpan = li.querySelector('.skill_name, .skill_name_subgeneral');
                if (!nameSpan) return;
                const skillName = nameSpan.textContent.trim();
                if (!skillName) return;

                let description = "";
                const divEl = li.querySelector('div[class^="skill"]');
                if (divEl) {
                    const clone = divEl.cloneNode(true);
                    const aTags = clone.querySelectorAll('a');
                    aTags.forEach(a => a.remove());
                    description = clone.textContent.replace(/\s+/g, ' ').trim();
                }
                if (description) {
                    skills.push({ name: skillName, description: description });
                }
            });
        }

        return { name, rarity, level, cost, cardNo, soldierType, attack, baseAttack, intelligence, hp, imageSrc, isHa, skills };
    }

    function scrapeCurrentPage() {
        const cardColumns = document.querySelectorAll('.cardColmn');
        let pageCards = [];
        let processedIds = new Set();

        cardColumns.forEach(container => {
            const mainCardEl = container.querySelector('.cardWrapper > .ui-tabs-panel > .card') || container.querySelector('.card');
            if (!mainCardEl) return;

            const uniqueId = extractCardUniqueId(mainCardEl);
            if (processedIds.has(uniqueId)) return;
            processedIds.add(uniqueId);

            const mainData = extractCardData(mainCardEl);
            const isAdjutant = !!container.querySelector('img[src*="lbl_adjutant.png"]');

            let maxFukushoCost = 0;
            let fukushoArr = [];

            const sgBox = container.querySelector('.sgSlotAlreadyBox');
            if (!mainData.isHa && !isAdjutant && sgBox) {
                const costTextEl = sgBox.querySelector('.name');
                if (costTextEl) {
                    const match = costTextEl.textContent.match(/[\d\.]+\/([\d\.]+)/);
                    if (match) maxFukushoCost = parseFloat(match[1]);
                }

                const fkThumbs = sgBox.querySelectorAll('.subgeneral-slot-area__a--thumb');
                let seenFkIds = new Set();

                fkThumbs.forEach(thumbLink => {
                    const targetId = thumbLink.getAttribute('href');
                    if (!targetId || seenFkIds.has(targetId)) return;
                    seenFkIds.add(targetId);

                    let fukushoData = { name: "副将", cost: 0, soldierType: "", imageSrc: "", skills: [] };
                    const thumbImg = thumbLink.querySelector('img');
                    if (thumbImg) {
                        let src = thumbImg.getAttribute('data-src') || thumbImg.src || "";
                        if (src.startsWith('/')) src = window.location.origin + src;
                        fukushoData.imageSrc = src;
                    }

                    const inlineIdMatch = targetId.match(/inlineId=(cardWindow_\d+)/);
                    if (inlineIdMatch) {
                        const fkCardWindow = container.querySelector('#' + inlineIdMatch[1]);
                        if (fkCardWindow) {
                            const fkCardEl = fkCardWindow.querySelector('.card');
                            if (fkCardEl) {
                                const fkDetails = extractCardData(fkCardEl);
                                fukushoData.name = fkDetails.name;
                                fukushoData.cost = fkDetails.cost;
                                fukushoData.soldierType = fkDetails.soldierType;
                                fukushoData.skills = fkDetails.skills;
                                if (!fukushoData.imageSrc && fkDetails.imageSrc) fukushoData.imageSrc = fkDetails.imageSrc;
                            }
                        }
                    }
                    fukushoArr.push(fukushoData);
                });
            }

            pageCards.push({
                uniqueId: uniqueId,
                ...mainData,
                isAdjutant: isAdjutant,
                maxFukushoCost: maxFukushoCost,
                fukusho: fukushoArr
            });
        });

        return pageCards;
    }

    // ページャー要素を優先取得（関係ない箇所の誤クリック防止）
    function getPagerLinks() {
        const pagerSelectors = [
            'ul.pager a',
            '.pager a',
            '.paginate a',
            '[class*="pager"] a',
            '[class*="paging"] a'
        ];
        for (const sel of pagerSelectors) {
            const found = document.querySelectorAll(sel);
            if (found.length > 0) return Array.from(found);
        }
        return Array.from(document.querySelectorAll('a, button, input'));
    }

    function isElementClickable(el) {
        const parent = el.parentElement;
        const isParentDisabled = parent && (
            parent.classList.contains('disabled') ||
            parent.classList.contains('off') ||
            parent.classList.contains('current')
        );
        return !el.hasAttribute('disabled') &&
               !el.classList.contains('disabled') &&
               !el.classList.contains('current') &&
               !isParentDisabled &&
               el.offsetParent !== null;
    }

    function findAndClickNext() {
        const links = getPagerLinks();
        for (const el of links) {
            const text = (el.textContent || el.value || '').trim();
            // 「次へ」「次へ＞」「＞」などに限定（ページ全体の単独 '>' 誤爆を防止）
            if (text === '次へ' || text === '次へ＞' || text === '次のページ' || text === '＞') {
                if (isElementClickable(el)) {
                    el.click();
                    return true;
                }
            }
        }
        return false;
    }

    function goToFirstPage() {
        const links = getPagerLinks();
        for (const el of links) {
            const text = (el.textContent || '').trim();
            if (text === '1' && isElementClickable(el)) {
                el.click();
                return true;
            }
        }
        return false;
    }

    function hasNoMoreDataMessage() {
        const bodyText = document.body ? document.body.textContent : '';
        return bodyText.includes('データがもうありません');
    }

    function processAutoScrape() {
        const status = GM_getValue(STATUS_KEY, 'idle');
        if (status !== 'running') return;

        let allCards = GM_getValue(STORAGE_KEY, []);
        const currentCards = scrapeCurrentPage();

        // 「データがもうありません」表示、または既に収集済みで現在ページが0件なら最終ページを超えたと判断して完了
        if (hasNoMoreDataMessage() || (currentCards.length === 0 && allCards.length > 0)) {
            finishScrape(allCards);
            return;
        }

        if (currentCards.length > 0) {
            let uniqueMap = new Map();
            allCards.forEach(c => uniqueMap.set(c.uniqueId, c));
            currentCards.forEach(c => uniqueMap.set(c.uniqueId, c));
            allCards = Array.from(uniqueMap.values());
            GM_setValue(STORAGE_KEY, allCards);
        }

        const prevFirstId = currentCards.length > 0 ? currentCards[0].uniqueId : null;

        setTimeout(() => {
            if (GM_getValue(STATUS_KEY, 'idle') !== 'running') return;
            const hasNext = findAndClickNext();
            if (!hasNext) {
                finishScrape(allCards);
            } else {
                // 画面遷移（リロード）するページはload時に自動再開、Ajax更新ページ用にDOM変化を監視
                let checks = 0;
                const waitAjax = setInterval(() => {
                    if (GM_getValue(STATUS_KEY, 'idle') !== 'running') {
                        clearInterval(waitAjax);
                        return;
                    }
                    checks++;
                    const nowCards = scrapeCurrentPage();
                    const nowFirstId = nowCards.length > 0 ? nowCards[0].uniqueId : null;
                    if (hasNoMoreDataMessage() || nowFirstId !== prevFirstId || checks >= 8) {
                        clearInterval(waitAjax);
                        processAutoScrape();
                    }
                }, 500);
            }
        }, 2000);
    }

    function updatePanelButtonState() {
        const btn = document.getElementById('bro3-sim-btn');
        if (!btn) return;
        const status = GM_getValue(STATUS_KEY, 'idle');
        if (status === 'running') {
            const count = GM_getValue(STORAGE_KEY, []).length;
            btn.textContent = `🔄 収集中(${count}件)... [クリックで保存終了]`;
            btn.style.backgroundColor = '#ff8800';
        } else {
            btn.textContent = '📥 全ページ自動収集スタート';
            btn.style.backgroundColor = '#ff4500';
        }
    }

    function finishScrape(allCards) {
        GM_setValue(STATUS_KEY, 'idle');
        GM_deleteValue(STORAGE_KEY);
        updatePanelButtonState();

        if (!allCards || allCards.length === 0) {
            alert("カードが見つかりませんでした。武将一覧・デッキ画面を開いているかご確認ください。");
            return;
        }

        allCards.forEach((card, idx) => card.index = idx + 1);

        // 大容量データでも失敗しないよう Blob を使用
        const jsonStr = JSON.stringify(allCards, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
        const blobUrl = URL.createObjectURL(blob);

        const downloadAnchor = document.createElement('a');
        downloadAnchor.href = blobUrl;
        downloadAnchor.download = "3gokushi_all_cards.json";
        document.body.appendChild(downloadAnchor);
        downloadAnchor.click();
        downloadAnchor.remove();

        setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
        alert(`【完了】全ページから合計 ${allCards.length} 件のデータを収集し、JSONをダウンロードしました！`);
    }

    function createPanel() {
        if (document.getElementById('bro3-sim-panel')) {
            updatePanelButtonState();
            return;
        }
        const hasCards = document.querySelectorAll('.card').length > 0;
        if (!hasCards && !location.href.includes('card') && !location.href.includes('deck')) return;

        const panel = document.createElement('div');
        panel.id = 'bro3-sim-panel';
        panel.style.position = 'fixed';
        panel.style.top = '10px';
        panel.style.right = '10px';
        panel.style.zIndex = '999999';
        panel.style.padding = '10px 14px';
        panel.style.backgroundColor = 'rgba(0, 0, 0, 0.9)';
        panel.style.color = '#fff';
        panel.style.borderRadius = '8px';
        panel.style.boxShadow = '0 4px 10px rgba(0,0,0,0.5)';
        panel.style.fontSize = '12px';
        panel.style.textAlign = 'center';

        const title = document.createElement('div');
        title.textContent = '三国志 デッキシミュレータ';
        title.style.fontWeight = 'bold';
        title.style.marginBottom = '6px';
        title.style.color = '#ffcc00';
        panel.appendChild(title);

        const btn = document.createElement('button');
        btn.id = 'bro3-sim-btn';
        btn.style.color = '#fff';
        btn.style.padding = '6px 10px';
        btn.style.border = 'none';
        btn.style.borderRadius = '4px';
        btn.style.cursor = 'pointer';
        btn.style.fontWeight = 'bold';

        btn.addEventListener('click', () => {
            const currentStatus = GM_getValue(STATUS_KEY, 'idle');
            if (currentStatus === 'running') {
                const collected = GM_getValue(STORAGE_KEY, []);
                if (confirm(`現在 ${collected.length} 件収集済みです。\n収集を中断してここまでのデータをダウンロードしますか？`)) {
                    finishScrape(collected);
                }
                return;
            }

            if (confirm("1ページ目に移動して全ページのカードを自動収集します。\n開始しますか？")) {
                GM_setValue(STORAGE_KEY, []);
                GM_setValue(STATUS_KEY, 'running');
                updatePanelButtonState();
                const jumped = goToFirstPage();
                setTimeout(processAutoScrape, jumped ? 2000 : 500);
            }
        });

        panel.appendChild(btn);
        document.body.appendChild(panel);
        updatePanelButtonState();
    }

    window.addEventListener('load', () => setTimeout(createPanel, 1000));
    setTimeout(createPanel, 1500);
    setInterval(createPanel, 3000);
    if (GM_getValue(STATUS_KEY, 'idle') === 'running') setTimeout(processAutoScrape, 2000);
})();
