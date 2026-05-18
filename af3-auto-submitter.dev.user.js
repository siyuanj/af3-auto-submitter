// ==UserScript==
// @name         AF3 Auto Submitter DEV
// @namespace    https://github.com/siyuanj/af3-auto-submitter/dev
// @version      2.4-dev.1
// @description  测试版：验证下载记录标签和结果行 pTM/ipTM 分数显示，不会覆盖正式版脚本。
// @author       Jiang Siyuan
// @match        https://alphafoldserver.com/*
// @match        https://www.alphafoldserver.com/*
// @grant        none
// @run-at       document-start
// @noframes
// @updateURL    https://raw.githubusercontent.com/siyuanj/af3-auto-submitter/test/greasyfork-dev-v2.2/af3-auto-submitter.dev.user.js
// @downloadURL  https://raw.githubusercontent.com/siyuanj/af3-auto-submitter/test/greasyfork-dev-v2.2/af3-auto-submitter.dev.user.js
// ==/UserScript==

(function() {
    'use strict';

    // --- 配置 ---
    const CONTAINER_ID = 'af3-dev-panel';
    const PANEL_ROOT_ID = 'af3-dev-panel-root';
    const PANEL_POSITION_KEY = `${CONTAINER_ID}-position`;
    const DOWNLOAD_RECORD_KEY = 'af3-auto-submitter-download-records-v1';
    const MAX_DOWNLOAD_RECORDS = 500;
    const ROW_BADGE_ATTR = 'data-af3-row-badges';
    const SCORE_VALUE_PATTERN = '(?:0?\\.\\d+|1(?:\\.0+)?|\\d{1,3}(?:\\.\\d+)?%?)';
    const WAIT_FOR_MODAL = 2000;
    const WAIT_FOR_PAGE_LOAD = 3000; // 跳转等待时间
    // -----------

    if (window.__af3AutoSubmitterDevLoaded) return;
    window.__af3AutoSubmitterDevLoaded = true;

    let isRunning = false;
    let shouldStop = false;
    let isPaused = false;
    let isDraggingPanel = false;
    let logExpanded = false;
    let lastInteractedJob = null;
    let lastInteractedAt = 0;
    let decorateTimer = null;
    const logEntries = [];
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    function getPanelHost() {
        return document.getElementById(CONTAINER_ID);
    }

    function getUiElement(id) {
        return getPanelHost()?.shadowRoot?.getElementById(id) || document.getElementById(id) || null;
    }

    function getSavedPanelPosition() {
        try {
            const raw = localStorage.getItem(PANEL_POSITION_KEY);
            if (!raw) return null;
            const pos = JSON.parse(raw);
            if (!Number.isFinite(pos.left) || !Number.isFinite(pos.top)) return null;
            return pos;
        } catch (e) {
            return null;
        }
    }

    function savePanelPosition(host) {
        const rect = host.getBoundingClientRect();
        try {
            localStorage.setItem(PANEL_POSITION_KEY, JSON.stringify({
                left: Math.round(rect.left),
                top: Math.round(rect.top)
            }));
        } catch (e) {
            // localStorage can be unavailable in strict browser configurations.
        }
    }

    function applyHostStyle(host) {
        const savedPosition = getSavedPanelPosition();
        Object.assign(host.style, {
            position: 'fixed',
            zIndex: '2147483647',
            display: 'block',
            visibility: 'visible',
            opacity: '1',
            pointerEvents: 'auto',
            width: '260px',
            maxWidth: 'calc(100vw - 24px)',
            height: 'auto',
            colorScheme: 'light',
            transform: 'none'
        });

        if (isDraggingPanel) return;

        if (savedPosition) {
            const maxLeft = Math.max(12, window.innerWidth - 272);
            const maxTop = Math.max(12, window.innerHeight - 180);
            host.style.left = Math.min(Math.max(12, savedPosition.left), maxLeft) + 'px';
            host.style.top = Math.min(Math.max(12, savedPosition.top), maxTop) + 'px';
            host.style.right = 'auto';
        } else if (!host.style.left && !host.style.top) {
            host.style.top = '80px';
            host.style.right = '30px';
            host.style.left = 'auto';
        }
    }

    function addLog(message, level = 'info') {
        const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
        logEntries.push({ time, message, level });
        if (logEntries.length > 40) logEntries.shift();

        const consoleFn = level === 'warn' ? console.warn : level === 'error' ? console.error : console.log;
        consoleFn(`[AF3] ${message}`);
        renderLogPanel();
    }

    function renderLogPanel() {
        const toggle = getUiElement('af3-log-toggle');
        const body = getUiElement('af3-log-body');

        if (toggle) toggle.textContent = `${logExpanded ? '▼' : '▶'} 日志 (${logEntries.length})`;
        if (!body) return;

        body.style.display = logExpanded ? 'block' : 'none';
        body.textContent = logEntries.map(entry => `[${entry.time}] ${entry.message}`).join('\n');
        if (logExpanded) body.scrollTop = body.scrollHeight;
    }

    function toggleLogPanel() {
        logExpanded = !logExpanded;
        renderLogPanel();
    }

    function requestStop() {
        if (!isRunning) return;
        shouldStop = true;
        isPaused = false;
        addLog('收到停止请求，当前步骤结束后停止', 'warn');
        updateBtnText('Stopping...');
        updateRunControls();
    }

    function togglePause() {
        if (!isRunning) return;
        isPaused = !isPaused;
        addLog(isPaused ? '已暂停，点击继续恢复' : '继续运行');
        updateBtnText(isPaused ? 'Paused' : 'Running...');
        updateRunControls();
    }

    function checkStop() {
        if (shouldStop) throw new Error('用户已停止');
    }

    async function waitIfPaused() {
        while (isPaused && !shouldStop) {
            updateBtnText('Paused');
            await sleep(300);
        }
        checkStop();
    }

    async function controlledSleep(ms) {
        let elapsed = 0;
        while (elapsed < ms) {
            await waitIfPaused();
            const step = Math.min(250, ms - elapsed);
            await sleep(step);
            elapsed += step;
        }
        checkStop();
    }

    function getModeLabel() {
        if (currentMode === 'DRAFT') return '批量提交 Saved Drafts';
        if (currentMode === 'FAILED') return '失败任务 Clone & Resubmit';
        return '未识别';
    }

    function confirmStart(maxJobs) {
        const rows = getRows();
        const rowCount = rows.length;
        const plannedJobs = Math.min(maxJobs, rowCount);

        if (rowCount === 0) {
            alert('当前页面没有识别到可处理的任务行。');
            addLog('启动取消：未识别到可处理任务行', 'warn');
            return 0;
        }

        const ok = confirm(
            `运行前确认\n\n` +
            `当前模式：${getModeLabel()}\n` +
            `识别到任务行：${rowCount}\n` +
            `计划处理数量：${plannedJobs}\n\n` +
            `请确认当前列表和数量无误。`
        );

        if (!ok) {
            addLog('用户取消启动');
            return 0;
        }

        addLog(`启动确认：${getModeLabel()}，计划处理 ${plannedJobs} 个，当前识别 ${rowCount} 行`);
        return plannedJobs;
    }

    function normalizeText(text) {
        return (text || '').replace(/\s+/g, ' ').trim();
    }

    function stableHash(text) {
        let hash = 5381;
        const input = text || '';
        for (let i = 0; i < input.length; i++) {
            hash = ((hash << 5) + hash) ^ input.charCodeAt(i);
        }
        return (hash >>> 0).toString(36);
    }

    function getTextWithoutBadges(element) {
        if (!element) return '';
        const clone = element.cloneNode(true);
        clone.querySelectorAll(`[${ROW_BADGE_ATTR}]`).forEach(node => node.remove());
        const parts = [];
        const walker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT);
        let node = walker.nextNode();
        while (node) {
            const text = normalizeText(node.nodeValue);
            if (text) parts.push(text);
            node = walker.nextNode();
        }
        return normalizeText(parts.join(' '));
    }

    function stripScoreText(text) {
        let value = normalizeText(text);
        const iptmRegex = new RegExp(`\\bi[_\\s-]*p[_\\s-]*t[_\\s-]*m(?:\\b|(?=_))(?:[_\\s-]*score)?\\s*[:：=]?\\s*${SCORE_VALUE_PATTERN}`, 'ig');
        const ptmRegex = new RegExp(`(^|[^a-z0-9_])p[_\\s-]*t[_\\s-]*m(?:\\b|(?=_))(?:[_\\s-]*score)?\\s*[:：=]?\\s*${SCORE_VALUE_PATTERN}`, 'ig');
        value = value.replace(iptmRegex, ' ');
        value = value.replace(ptmRegex, ' ');
        return normalizeText(value.replace(/已下载|标记下载|取消标记|downloaded/ig, ' '));
    }

    function readDownloadRecords() {
        try {
            const raw = localStorage.getItem(DOWNLOAD_RECORD_KEY);
            const parsed = raw ? JSON.parse(raw) : {};
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
        } catch (e) {
            return {};
        }
    }

    function writeDownloadRecords(records) {
        try {
            const entries = Object.entries(records)
                .filter(([key, record]) => key && record && record.downloadedAt)
                .sort((a, b) => new Date(b[1].downloadedAt) - new Date(a[1].downloadedAt))
                .slice(0, MAX_DOWNLOAD_RECORDS);
            localStorage.setItem(DOWNLOAD_RECORD_KEY, JSON.stringify(Object.fromEntries(entries)));
        } catch (e) {
            addLog('下载记录保存失败：浏览器可能限制了 localStorage', 'warn');
        }
    }

    function getJobIdentity(row) {
        if (!row) return null;

        const link = Array.from(row.querySelectorAll('a[href]')).find(a => {
            if (a.closest(`[${ROW_BADGE_ATTR}]`)) return false;
            const href = a.getAttribute('href') || '';
            return href && href !== '#' && !href.toLowerCase().startsWith('javascript:');
        });
        if (link) {
            let href = link.href;
            try {
                const url = new URL(link.href, location.href);
                href = `${url.origin}${url.pathname}${url.search}`;
            } catch (e) {
                // Keep the browser-provided href fallback.
            }
            const label = normalizeText(link.textContent || link.getAttribute('aria-label') || link.getAttribute('title') || href).slice(0, 120);
            return { key: `href:${href}`, label: label || href };
        }

        for (const attr of ['data-job-id', 'data-id', 'data-testid', 'id', 'aria-label', 'title']) {
            const value = normalizeText(row.getAttribute?.(attr));
            if (value) return { key: `${attr}:${value}`, label: value.slice(0, 120) };
        }

        const text = stripScoreText(getTextWithoutBadges(row));
        if (!text) return null;
        const label = text
            .split(/(?:\s{2,}|[|•])/)
            .map(part => normalizeText(part))
            .find(part => part && !/^(name|status|created|result|results?|download|open|delete|failed|success|running|queued)$/i.test(part));
        return { key: `text:${stableHash(text.slice(0, 500))}`, label: (label || text).slice(0, 120) };
    }

    function getPageJobIdentity() {
        const heading = Array.from(document.querySelectorAll('h1, h2, [role="heading"]'))
            .map(el => normalizeText(el.textContent))
            .find(Boolean);
        const label = heading || normalizeText(document.title) || location.pathname;
        if (!label) return null;
        return { key: `page:${location.pathname}:${stableHash(label)}`, label: label.slice(0, 120) };
    }

    function markJobDownloaded(identity, source = 'manual') {
        if (!identity || !identity.key) return false;
        const records = readDownloadRecords();
        records[identity.key] = {
            label: identity.label || identity.key,
            downloadedAt: new Date().toISOString(),
            source
        };
        writeDownloadRecords(records);
        addLog(`已记录下载：${records[identity.key].label}`);
        scheduleDecorateRows();
        return true;
    }

    function unmarkJobDownloaded(identity) {
        if (!identity || !identity.key) return false;
        const records = readDownloadRecords();
        if (!records[identity.key]) return false;
        delete records[identity.key];
        writeDownloadRecords(records);
        addLog(`已取消下载标记：${identity.label || identity.key}`);
        scheduleDecorateRows();
        return true;
    }

    function isJobDownloaded(identity) {
        return Boolean(identity && readDownloadRecords()[identity.key]);
    }

    function extractScoresFromText(text) {
        const value = normalizeText(text);
        const iptmRegex = new RegExp(`\\bi[_\\s-]*p[_\\s-]*t[_\\s-]*m(?:\\b|(?=_))(?:[_\\s-]*score)?\\s*[:：=]?\\s*(${SCORE_VALUE_PATTERN})`, 'i');
        const ptmRegex = new RegExp(`(^|[^a-z0-9_])p[_\\s-]*t[_\\s-]*m(?:\\b|(?=_))(?:[_\\s-]*score)?\\s*[:：=]?\\s*(${SCORE_VALUE_PATTERN})`, 'i');
        const iptm = value.match(iptmRegex)?.[1] || null;
        const ptmMatch = value.match(ptmRegex);
        return {
            iptm,
            ptm: ptmMatch ? ptmMatch[2] : null
        };
    }

    function isInsidePanel(element) {
        const host = getPanelHost();
        return Boolean(host && element && host.contains(element));
    }

    function isElementVisible(element) {
        if (!element || !element.getBoundingClientRect) return false;
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    }

    function isDownloadActionElement(element) {
        if (!element || element.closest?.(`[${ROW_BADGE_ATTR}]`)) return false;
        const href = element.getAttribute?.('href') || '';
        const text = normalizeText([
            element.textContent,
            element.getAttribute?.('aria-label'),
            element.getAttribute?.('title'),
            href
        ].filter(Boolean).join(' ')).toLowerCase();
        return /(download|下载|mmcif|modelcif|\bcif\b|\.cif\b|\.json\b|full data|model data|result data|all models)/i.test(text);
    }

    function rowHasDownloadAction(row) {
        return Array.from(row.querySelectorAll('a, button, [role="button"], [role="menuitem"], li'))
            .some(isDownloadActionElement);
    }

    function isLikelyDecoratableRow(row) {
        if (!row || isInsidePanel(row) || !isElementVisible(row)) return false;
        if (row.closest('[role="menu"], [role="listbox"], nav, header, footer')) return false;

        const rect = row.getBoundingClientRect();
        const text = getTextWithoutBadges(row);
        if (rect.width < 160 || text.length < 3 || text.length > 1800) return false;

        const tag = row.tagName;
        const role = row.getAttribute('role') || '';
        const className = String(row.className || '');
        const rowLike = tag === 'TR' ||
            tag === 'ARTICLE' ||
            role.includes('row') ||
            role === 'listitem' ||
            /(^|\s)(row|Row|card|Card)(\s|$|-|_)/.test(className);

        return rowLike || Boolean(row.querySelector('input[type="checkbox"], a[href], button, [role="button"]'));
    }

    function findClosestRow(element) {
        if (!element || !element.closest) return null;
        const row = element.closest('tr, [role="row"], [role="listitem"], li, article, div[class*="row"], div[class*="Row"], div[class*="card"], div[class*="Card"]');
        return row && !isInsidePanel(row) ? row : null;
    }

    function isMenuOrChromeRow(row) {
        if (!row) return false;
        const role = row.getAttribute('role') || '';
        const className = String(row.className || '');
        return role === 'menuitem' ||
            /menu|popover|dropdown/i.test(className) ||
            Boolean(row.closest('[role="menu"], [role="listbox"], nav, header, footer'));
    }

    function makeBadge(text, bg, color, title) {
        const badge = document.createElement('span');
        badge.textContent = text;
        if (title) badge.title = title;
        Object.assign(badge.style, {
            display: 'inline-flex',
            alignItems: 'center',
            minHeight: '18px',
            padding: '1px 6px',
            borderRadius: '999px',
            backgroundColor: bg,
            color,
            fontSize: '11px',
            fontWeight: '700',
            lineHeight: '16px',
            whiteSpace: 'nowrap'
        });
        return badge;
    }

    function getBadgeMount(row) {
        if (row.tagName === 'TR') {
            return row.querySelector('td:last-child, th:last-child') || row;
        }
        return row;
    }

    function renderRowBadges(row) {
        if (!row || isInsidePanel(row) || !isElementVisible(row)) return;

        const identity = getJobIdentity(row);
        const records = readDownloadRecords();
        const downloaded = Boolean(identity && records[identity.key]);
        const scores = extractScoresFromText(getTextWithoutBadges(row));
        const hasScores = Boolean(scores.ptm || scores.iptm);
        const hasDownload = rowHasDownloadAction(row);
        const shouldShow = downloaded || hasScores || hasDownload;
        const mount = getBadgeMount(row);
        let container = mount.querySelector(`:scope > [${ROW_BADGE_ATTR}]`);
        const recordTime = identity ? records[identity.key]?.downloadedAt || '' : '';
        const signature = [downloaded ? '1' : '0', scores.iptm || '', scores.ptm || '', hasDownload ? '1' : '0', recordTime, identity?.key || ''].join('|');

        if (!shouldShow) {
            if (container) container.remove();
            return;
        }

        if (!container) {
            container = document.createElement('span');
            container.setAttribute(ROW_BADGE_ATTR, 'true');
            mount.appendChild(container);
        }

        if (container.dataset.signature === signature) return;
        container.dataset.signature = signature;

        Object.assign(container.style, {
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
            marginLeft: '8px',
            verticalAlign: 'middle',
            flexWrap: 'wrap'
        });
        container.innerHTML = '';

        if (downloaded) {
            const title = records[identity.key]?.downloadedAt
                ? `已下载：${new Date(records[identity.key].downloadedAt).toLocaleString('zh-CN', { hour12: false })}`
                : '已下载';
            container.appendChild(makeBadge('已下载', '#e6f4ea', '#137333', title));
        }
        if (scores.iptm) container.appendChild(makeBadge(`ipTM ${scores.iptm}`, '#e6f4ea', '#137333', '结果行识别到的 ipTM 分数'));
        if (scores.ptm) container.appendChild(makeBadge(`pTM ${scores.ptm}`, '#e8f0fe', '#174ea6', '结果行识别到的 pTM 分数'));

        if (identity) {
            const toggle = document.createElement('button');
            toggle.type = 'button';
            toggle.textContent = downloaded ? '取消标记' : '标记下载';
            toggle.title = downloaded ? '点击取消已下载标记' : '点击手动标记为已下载';
            Object.assign(toggle.style, {
                height: '20px',
                padding: '1px 6px',
                borderRadius: '999px',
                border: downloaded ? '1px solid #b7dfc2' : '1px solid #dadce0',
                backgroundColor: downloaded ? '#fff' : 'rgba(255,255,255,0.85)',
                color: downloaded ? '#137333' : '#5f6368',
                fontSize: '11px',
                lineHeight: '16px',
                cursor: 'pointer',
                whiteSpace: 'nowrap'
            });
            toggle.addEventListener('click', event => {
                event.preventDefault();
                event.stopPropagation();
                if (isJobDownloaded(identity)) {
                    unmarkJobDownloaded(identity);
                } else {
                    markJobDownloaded(identity, 'manual');
                }
            });
            container.appendChild(toggle);
        }
    }

    function getRowsForDecorations() {
        const records = readDownloadRecords();
        const selectors = 'tr, [role="row"], [role="listitem"], li, article, div[class*="row"], div[class*="Row"], div[class*="card"], div[class*="Card"]';
        const candidates = [...getRows(), ...Array.from(document.querySelectorAll(selectors))]
            .filter((row, index, array) => row && array.indexOf(row) === index)
            .filter(isLikelyDecoratableRow);

        const usefulRows = candidates.filter(row => {
            const identity = getJobIdentity(row);
            const downloaded = Boolean(identity && records[identity.key]);
            const scores = extractScoresFromText(getTextWithoutBadges(row));
            const hasExistingBadges = Boolean(row.querySelector(`[${ROW_BADGE_ATTR}]`));
            return downloaded || scores.ptm || scores.iptm || rowHasDownloadAction(row) || hasExistingBadges;
        });

        return usefulRows.filter(row => !usefulRows.some(other => other !== row && row.contains(other)));
    }

    function decorateResultRows() {
        try {
            getRowsForDecorations().forEach(renderRowBadges);
        } catch (e) {
            console.warn('[AF3] 行标签刷新失败', e);
        }
    }

    function scheduleDecorateRows() {
        if (decorateTimer) clearTimeout(decorateTimer);
        decorateTimer = setTimeout(() => {
            decorateTimer = null;
            decorateResultRows();
        }, 120);
    }

    function rememberRowInteraction(event) {
        const row = findClosestRow(event.target);
        if (isMenuOrChromeRow(row)) return;
        const identity = getJobIdentity(row);
        if (identity) {
            lastInteractedJob = identity;
            lastInteractedAt = Date.now();
        }
    }

    function handleDownloadClick(event) {
        const target = event.target?.closest?.('a, button, [role="button"], [role="menuitem"], li');
        if (!target || !isDownloadActionElement(target)) return;

        const row = findClosestRow(target);
        const rowIdentity = isMenuOrChromeRow(row) ? null : getJobIdentity(row);
        const recentIdentity = lastInteractedJob && Date.now() - lastInteractedAt < 15000 ? lastInteractedJob : null;
        const menuClick = isMenuOrChromeRow(row) || isMenuOrChromeRow(target);
        const identity = rowIdentity || (menuClick ? recentIdentity : null) || getPageJobIdentity() || recentIdentity;
        markJobDownloaded(identity, 'download-click');
    }

    // --- 通用查找工具 ---
    function findButtonByText(text) {
        const els = Array.from(document.querySelectorAll('button, div[role="button"], span[role="button"]'));
        return els.find(el =>
            el.textContent &&
            el.textContent.toLowerCase().includes(text.toLowerCase()) &&
            !el.disabled &&
            el.offsetParent !== null
        );
    }

    // 获取列表行 (兼容 Draft 和 Failed 页面)
    function getRows() {
        const checkboxes = Array.from(document.querySelectorAll('input[type="checkbox"]'));
        const listItems = checkboxes.map(cb => {
            let parent = cb.parentElement;
            while(parent && parent.tagName !== 'TR' && !parent.getAttribute('role')?.includes('row') && parent.className.indexOf('row') === -1) {
                parent = parent.parentElement;
                if (!parent || parent === document.body) return null;
            }
            return parent;
        }).filter(row => row !== null);
        return [...new Set(listItems)].filter(r => !r.textContent.includes('Name'));
    }

    // 强力点击
    function simulateClick(element, color = 'rgba(255, 0, 0, 0.3)') {
        if (!element) return;
        const originalBg = element.style.backgroundColor;
        const originalTrans = element.style.transition;

        // 视觉反馈
        element.style.backgroundColor = color;
        element.style.transition = 'background 0.2s';
        setTimeout(() => {
            element.style.backgroundColor = originalBg;
            element.style.transition = originalTrans;
        }, 300);

        // 完整事件链
        const opts = { bubbles: true, cancelable: true, view: window, buttons: 1 };
        element.dispatchEvent(new MouseEvent('mouseover', opts));
        element.dispatchEvent(new MouseEvent('mousedown', opts));
        element.dispatchEvent(new MouseEvent('mouseup', opts));
        element.click();
    }

    // --- 失败重跑特有逻辑 ---

    // 1. 点击某行的“三点”菜单
    async function clickMenuOnRow(row) {
        // 策略：找行内的 button，通常最后一个是菜单
        const buttons = Array.from(row.querySelectorAll('button'));
        if (buttons.length === 0) return false;

        const menuBtn = buttons[buttons.length - 1];

        addLog('点击行菜单按钮');
        simulateClick(menuBtn, 'rgba(0, 0, 255, 0.3)');
        return true;
    }

    // 2. 【核心修复】全屏搜索 "Clone and reuse" 文字并点击
    async function clickCloneOption() {
        addLog('寻找 Clone and reuse 选项');

        // 轮询机制：菜单弹出可能有动画，我们给它 2秒 时间反复找
        for(let i = 0; i < 10; i++) {
            await controlledSleep(200); // 每次等 200ms

            // 搜索策略：不局限于 li/div，直接找包含文字的“最小节点”
            // 很多框架把文字放在 span 里，span 放在 div 里，div 放在 li 里
            // 我们找到文字节点，然后往上找最近的可点击元素

            // 获取所有包含 "Clone and reuse" 的元素
            // 这里使用 TreeWalker 或者简单的 querySelectorAll 遍历效率稍低但稳
            // 简单点：找 body 下所有包含该文本的元素

            const allElements = document.body.querySelectorAll('*');
            let target = null;

            for (let el of allElements) {
                // 必须是肉眼可见的
                if (el.offsetParent === null) continue;

                // 只有当它是“叶子节点”（没有子标签）且包含文字时，才是我们要找的最底层元素
                if (el.children.length === 0 && el.textContent && el.textContent.includes("Clone and reuse")) {
                    target = el;
                    break;
                }
            }

            if (target) {
                // 找到了文字节点（比如 span）。
                // 尝试点击它，或者它的父级菜单项。
                // 为了保险，我们优先找它的 li 或 role="menuitem" 父级
                const clickable = target.closest('li') || target.closest('[role="menuitem"]') || target.closest('button') || target;

                addLog('找到 Clone and reuse，准备点击');
                simulateClick(clickable, 'rgba(0, 255, 0, 0.5)'); // 绿色高亮
                return true;
            }
        }

        return false;
    }

    // 3. 返回 Failed 列表页
    async function backToFailedTab() {
        addLog('尝试切回 Failed 列表');
        const tabs = Array.from(document.querySelectorAll('button[role="tab"], div[role="tab"]'));
        const failedTab = tabs.find(t => t.textContent.includes("Failed"));

        if (failedTab) {
            simulateClick(failedTab);
            return true;
        }
        return false;
    }

    // --- UI 拖拽 ---
    function makeDraggable(element, handle) {
        let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
        const header = handle || element.querySelector('#af3-header');
        if (!header) return;
        header.onmousedown = dragMouseDown;
        function dragMouseDown(e) {
            e = e || window.event; e.preventDefault();
            const currentLeft = element.offsetLeft;
            const currentTop = element.offsetTop;
            element.style.left = currentLeft + "px";
            element.style.top = currentTop + "px";
            element.style.right = "auto";
            pos3 = e.clientX; pos4 = e.clientY;
            isDraggingPanel = true;
            document.onmouseup = closeDragElement; document.onmousemove = elementDrag;
            element.style.cursor = 'grabbing';
        }
        function elementDrag(e) {
            e = e || window.event; e.preventDefault();
            pos1 = pos3 - e.clientX; pos2 = pos4 - e.clientY;
            pos3 = e.clientX; pos4 = e.clientY;
            element.style.top = (element.offsetTop - pos2) + "px";
            element.style.left = (element.offsetLeft - pos1) + "px";
        }
        function closeDragElement() {
            document.onmouseup = null; document.onmousemove = null;
            savePanelPosition(element);
            isDraggingPanel = false;
            element.style.cursor = 'default';
            addLog('已保存面板位置');
        }
    }

    function stylePanelButton(button, backgroundColor, color = '#fff') {
        Object.assign(button.style, {
            padding: '7px 8px',
            backgroundColor,
            color,
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
            fontWeight: 'bold',
            fontSize: '12px',
            transition: 'all 0.2s'
        });
    }

    // --- UI ---
    function ensureUI() {
        if (!document.documentElement || !document.body) return;

        let host = getPanelHost();
        if (host?.shadowRoot?.getElementById(PANEL_ROOT_ID)) {
            applyHostStyle(host);
            return;
        }

        if (host) host.remove();

        host = document.createElement('div');
        host.id = CONTAINER_ID;
        host.setAttribute('data-af3-auto-submitter', 'true');
        applyHostStyle(host);

        const shadow = host.attachShadow({ mode: 'open' });
        const container = document.createElement('div');
        container.id = PANEL_ROOT_ID;
        Object.assign(container.style, {
            all: 'initial',
            boxSizing: 'border-box',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
            width: '100%',
            padding: '15px',
            backgroundColor: 'rgba(32, 33, 36, 0.97)',
            borderRadius: '12px',
            boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
            border: '1px solid #5f6368',
            fontFamily: 'Roboto, Arial, sans-serif',
            color: '#fff',
            lineHeight: 'normal'
        });

        const header = document.createElement('div');
        header.id = 'af3-header';
        Object.assign(header.style, {
            textAlign: 'center', cursor: 'move', paddingBottom: '8px',
            borderBottom: '1px solid #444', fontWeight: 'bold', color: '#eee', fontSize: '14px'
        });
        header.textContent = '🧪 AF3 自动助手 DEV';

        const statusRow = document.createElement('div');
        Object.assign(statusRow.style, { display: 'flex', alignItems: 'center', gap: '8px', padding: '0 4px' });
        const statusLight = document.createElement('div');
        statusLight.id = 'af3-status-light';
        Object.assign(statusLight.style, {
            width: '10px', height: '10px', borderRadius: '50%',
            backgroundColor: '#f44336', flexShrink: '0', transition: 'all 0.3s'
        });
        const statusText = document.createElement('span');
        statusText.id = 'af3-status-text';
        statusText.textContent = '初始化...';
        Object.assign(statusText.style, { fontSize: '12px', color: '#bbb', whiteSpace: 'nowrap' });
        statusRow.appendChild(statusLight); statusRow.appendChild(statusText);

        const controls = document.createElement('div');
        Object.assign(controls.style, { display: 'flex', alignItems: 'center', gap: '8px' });
        const input = document.createElement('input');
        input.type = 'number'; input.value = '10'; input.id = 'af3-v20-count';
        Object.assign(input.style, {
            width: '50px', padding: '8px', borderRadius: '6px', border: '1px solid #555',
            textAlign: 'center', fontWeight: 'bold', backgroundColor: '#333', color: '#fff'
        });
        const btn = document.createElement('button');
        btn.id = 'af3-v20-btn'; btn.textContent = '🚀 启动';
        Object.assign(btn.style, {
            flex: '1', padding: '8px', backgroundColor: '#666', color: '#aaa',
            border: 'none', borderRadius: '6px', cursor: 'not-allowed',
            fontWeight: 'bold', fontSize: '14px', transition: 'all 0.3s'
        });
        btn.disabled = true; btn.onclick = mainProcess;
        controls.appendChild(input); controls.appendChild(btn);

        const runControls = document.createElement('div');
        runControls.id = 'af3-run-controls';
        Object.assign(runControls.style, { display: 'none', gap: '8px' });

        const pauseBtn = document.createElement('button');
        pauseBtn.id = 'af3-pause-btn';
        pauseBtn.textContent = '暂停';
        stylePanelButton(pauseBtn, '#5f6368');
        pauseBtn.onclick = togglePause;

        const stopBtn = document.createElement('button');
        stopBtn.id = 'af3-stop-btn';
        stopBtn.textContent = '停止';
        stylePanelButton(stopBtn, '#d93025');
        stopBtn.onclick = requestStop;

        runControls.appendChild(pauseBtn);
        runControls.appendChild(stopBtn);

        const footer = document.createElement('div');
        footer.id = 'af3-footer-msg';
        footer.textContent = '⚠️ DEV测试版：请禁用正式版后测试';
        Object.assign(footer.style, {
            fontSize: '11px', color: '#fdd835', textAlign: 'center', marginTop: '4px'
        });

        const logPanel = document.createElement('div');
        Object.assign(logPanel.style, { borderTop: '1px solid #444', paddingTop: '6px' });

        const logToggle = document.createElement('button');
        logToggle.id = 'af3-log-toggle';
        logToggle.type = 'button';
        logToggle.textContent = '▶ 日志 (0)';
        Object.assign(logToggle.style, {
            width: '100%',
            padding: '4px 0',
            background: 'transparent',
            border: 'none',
            color: '#9aa0a6',
            textAlign: 'left',
            cursor: 'pointer',
            fontSize: '11px',
            fontWeight: 'bold'
        });
        logToggle.onclick = toggleLogPanel;

        const logBody = document.createElement('pre');
        logBody.id = 'af3-log-body';
        Object.assign(logBody.style, {
            display: 'none',
            maxHeight: '120px',
            overflow: 'auto',
            margin: '6px 0 0',
            padding: '8px',
            backgroundColor: 'rgba(0,0,0,0.25)',
            border: '1px solid #3c4043',
            borderRadius: '6px',
            color: '#dfe1e5',
            whiteSpace: 'pre-wrap',
            fontFamily: 'Consolas, monospace',
            fontSize: '10px',
            lineHeight: '1.35'
        });
        logPanel.appendChild(logToggle);
        logPanel.appendChild(logBody);

        container.appendChild(header); container.appendChild(statusRow);
        container.appendChild(controls); container.appendChild(runControls);
        container.appendChild(footer); container.appendChild(logPanel);
        shadow.appendChild(container);
        document.body.appendChild(host);
        makeDraggable(host, header);
        renderLogPanel();
        updateRunControls();
    }

    // --- 状态检测 & 模式判断 ---
    let currentMode = 'NONE';

    function checkSystemStatus() {
        const btn = getUiElement('af3-v20-btn');
        const light = getUiElement('af3-status-light');
        const text = getUiElement('af3-status-text');
        const footer = getUiElement('af3-footer-msg');

        if (!btn || !light || !text || isRunning) return;

        const activeTab = document.querySelector('button[aria-selected="true"], div[aria-selected="true"]');
        const tabName = activeTab ? activeTab.textContent.toLowerCase() : "";

        if (tabName.includes('draft')) {
            currentMode = 'DRAFT';
            light.style.backgroundColor = '#00e676'; // Green
            light.style.boxShadow = '0 0 8px #00e676';
            text.textContent = '🟢 就绪: 提交草稿'; text.style.color = '#00e676';
            footer.textContent = '模式: 批量提交 Saved Drafts';
            btn.disabled = false; btn.style.backgroundColor = '#1a73e8'; btn.style.color = 'white'; btn.style.cursor = 'pointer';
        } else if (tabName.includes('failed')) {
            currentMode = 'FAILED';
            light.style.backgroundColor = '#2979ff'; // Blue
            light.style.boxShadow = '0 0 8px #2979ff';
            text.textContent = '🔵 就绪: 失败任务重跑'; text.style.color = '#2979ff';
            footer.textContent = '模式: Clone & Resubmit';
            btn.disabled = false; btn.style.backgroundColor = '#1565c0'; btn.style.color = 'white'; btn.style.cursor = 'pointer';
        } else {
            currentMode = 'NONE';
            light.style.backgroundColor = '#f44336'; // Red
            light.style.boxShadow = '0 0 8px #f44336';
            text.textContent = '😴 待机中: 请切换页面'; text.style.color = '#ef5350';
            footer.textContent = '请在下方列表中仅保留 Saved draft/Failed 列表';
            btn.disabled = true; btn.style.backgroundColor = '#444'; btn.style.color = '#888'; btn.style.cursor = 'not-allowed';
        }
    }

    // --- 主入口 ---
    async function mainProcess() {
        if (isRunning) return;

        const countInput = getUiElement('af3-v20-count');
        const requestedJobs = parseInt(countInput.value, 10) || 10;
        const maxJobs = confirmStart(requestedJobs);
        if (!maxJobs) return;

        if (currentMode === 'DRAFT') {
            await runDraftSubmission(maxJobs);
        } else if (currentMode === 'FAILED') {
            await runFailedReprocessing(maxJobs);
        }
    }

    // --- 模式 A: 草稿提交 ---
    async function runDraftSubmission(maxJobs) {
        setRunningState(true);
        try {
            for (let i = 1; i <= maxJobs; i++) {
                await waitIfPaused();
                updateBtnText(`${i} / ${maxJobs}`);
                const rows = getRows();
                addLog(`草稿提交：处理第 ${i} / ${maxJobs} 个，当前识别 ${rows.length} 行`);
                if (rows.length === 0) { addLog('列表已空，停止处理', 'warn'); alert("列表已空"); break; }
                const firstRowText = rows[0].textContent.trim();

                simulateClick(rows[0], 'rgba(0,0,255,0.2)');
                await controlledSleep(500);

                const continueBtn = findButtonByText("Continue and preview job");
                if (continueBtn) {
                    addLog('找到 Continue and preview job，准备点击');
                    simulateClick(continueBtn, 'rgba(0,255,0,0.3)');
                    await controlledSleep(WAIT_FOR_MODAL);
                } else {
                    addLog('未找到 Continue 按钮，跳过当前行', 'warn');
                    continue;
                }

                let confirmBtn = findButtonByText("Confirm and submit");
                if (!confirmBtn) {
                     if (document.body.innerText.includes("Daily quota")) throw new Error("配额已满");
                     addLog('Confirm 未出现，跳过当前行', 'warn');
                     continue;
                }
                addLog('找到 Confirm and submit，准备提交');
                simulateClick(confirmBtn, 'rgba(0,255,0,0.3)');

                updateBtnText(`Verifying...`);
                for (let retry = 0; retry < 60; retry++) {
                    await controlledSleep(500);
                    confirmBtn = findButtonByText("Confirm and submit");
                    if (confirmBtn && retry % 3 === 0) simulateClick(confirmBtn);

                    const rowsNow = getRows();
                    if (rowsNow.length > 0 && rowsNow[0].textContent.trim() !== firstRowText) {
                        addLog(`第 ${i} 个草稿提交完成`);
                        break;
                    }
                }
            }
        } catch (e) {
            addLog(`草稿提交停止：${e.message}`, e.message.includes('用户已停止') ? 'warn' : 'error');
            alert(`停止: ${e.message}`);
        } finally {
            setRunningState(false);
        }
    }

    // --- 模式 B: 失败重跑 (修复版) ---
    async function runFailedReprocessing(maxJobs) {
        setRunningState(true);
        try {
            for (let i = 0; i < maxJobs; i++) {
                await waitIfPaused();
                updateBtnText(`Job ${i + 1} / ${maxJobs}`);
                addLog(`失败重跑：处理第 ${i + 1} / ${maxJobs} 个`);

                // 1. 确保在 Failed 页面
                await backToFailedTab();
                await controlledSleep(1500);

                const rows = getRows();
                if (i >= rows.length) {
                    addLog('已处理完当前页所有 Failed 任务');
                    alert("已处理完当前页所有 Failed 任务！");
                    break;
                }
                const targetRow = rows[i];
                targetRow.scrollIntoView({behavior: "auto", block: "center"});

                // 2. 点击菜单 (3个点)
                const menuClicked = await clickMenuOnRow(targetRow);
                if (!menuClicked) {
                    addLog(`第 ${i + 1} 行找不到菜单按钮，跳过`, 'warn');
                    continue;
                }
                // 等待菜单弹出，这里多给一点时间
                await controlledSleep(800);

                // 3. 【核心修复】点击 Clone
                const cloneClicked = await clickCloneOption();
                if (!cloneClicked) {
                    addLog(`第 ${i + 1} 行未找到 Clone 选项，跳过`, 'warn');
                    // 点击 body 关闭可能已打开的菜单
                    document.body.click();
                    await controlledSleep(500);
                    continue;
                }

                // 4. 等待跳转
                updateBtnText("Cloning...");
                await controlledSleep(WAIT_FOR_PAGE_LOAD);

                // 5. 点击 Continue
                let continueBtn = null;
                for(let w=0; w<15; w++) { // 7.5秒轮询
                    await controlledSleep(500);
                    continueBtn = findButtonByText("Continue and preview job");
                    if(continueBtn) break;
                }

                if (!continueBtn) {
                    addLog('Clone 后未找到 Continue 按钮，跳过当前任务', 'warn');
                    continue;
                }
                addLog('找到 Continue and preview job，准备点击');
                simulateClick(continueBtn);
                await controlledSleep(WAIT_FOR_MODAL);

                // 6. 点击 Confirm
                let confirmBtn = findButtonByText("Confirm and submit");
                if (!confirmBtn) {
                     if (document.body.innerText.includes("Daily quota")) throw new Error("配额已满");
                     if (continueBtn) simulateClick(continueBtn); // 再次尝试点击continue
                     await controlledSleep(1000);
                     confirmBtn = findButtonByText("Confirm and submit");
                     if (!confirmBtn) throw new Error("提交确认框未弹出");
                }
                addLog('找到 Confirm and submit，准备提交');
                simulateClick(confirmBtn);

                // 7. 提交后等待
                updateBtnText("Submitted...");
                addLog(`第 ${i + 1} 个失败任务已提交`);
                await controlledSleep(2500);
            }

        } catch (e) {
            addLog(`失败重跑停止：${e.message}`, e.message.includes('用户已停止') ? 'warn' : 'error');
            alert(`重跑停止: ${e.message}`);
        } finally {
            setRunningState(false);
        }
    }

    // --- 辅助状态管理 ---
    function setRunningState(state) {
        isRunning = state;
        shouldStop = false;
        isPaused = false;
        const btn = getUiElement('af3-v20-btn');
        const input = getUiElement('af3-v20-count');
        if (btn) {
            if (!state) {
                btn.textContent = '🚀 启动';
                btn.disabled = false;
                if (input) input.disabled = false;
                checkSystemStatus();
            } else {
                btn.disabled = true;
                if (input) input.disabled = true;
                updateBtnText('Running...');
            }
        }
        updateRunControls();
        addLog(state ? '运行开始' : '运行结束');
    }

    function updateRunControls() {
        const runControls = getUiElement('af3-run-controls');
        const pauseBtn = getUiElement('af3-pause-btn');
        const stopBtn = getUiElement('af3-stop-btn');

        if (runControls) runControls.style.display = isRunning ? 'flex' : 'none';
        if (pauseBtn) {
            pauseBtn.textContent = isPaused ? '继续' : '暂停';
            pauseBtn.style.backgroundColor = isPaused ? '#188038' : '#5f6368';
            pauseBtn.disabled = !isRunning || shouldStop;
            pauseBtn.style.opacity = pauseBtn.disabled ? '0.6' : '1';
        }
        if (stopBtn) {
            stopBtn.disabled = !isRunning || shouldStop;
            stopBtn.style.opacity = stopBtn.disabled ? '0.6' : '1';
            stopBtn.style.cursor = stopBtn.disabled ? 'not-allowed' : 'pointer';
        }
    }

    function updateBtnText(text) {
        const btn = getUiElement('af3-v20-btn');
        if (btn) btn.textContent = text;
    }

    function boot() {
        ensureUI();
        decorateResultRows();

        setInterval(ensureUI, 1000);
        setInterval(checkSystemStatus, 500);
        setInterval(decorateResultRows, 1500);

        const observer = new MutationObserver(() => {
            if (!getPanelHost()) ensureUI();
            scheduleDecorateRows();
        });
        observer.observe(document.documentElement, { childList: true, subtree: true });

        window.addEventListener('pageshow', ensureUI);
        window.addEventListener('pageshow', scheduleDecorateRows);
        document.addEventListener('visibilitychange', () => {
            ensureUI();
            scheduleDecorateRows();
        });
        document.addEventListener('pointerdown', rememberRowInteraction, true);
        document.addEventListener('click', handleDownloadClick, true);
    }

    function bootWhenReady() {
        if (document.documentElement && document.body) {
            boot();
        } else {
            setTimeout(bootWhenReady, 50);
        }
    }

    bootWhenReady();
})();
