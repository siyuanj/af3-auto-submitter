// ==UserScript==
// @name         AF3 Auto Submitter DEV
// @namespace    https://github.com/siyuanj/af3-auto-submitter/dev
// @version      2.19-dev.1
// @description  测试版：验证下载记录标签、History 分数读取、状态诊断、详情页缓存、SPA 路由扫描、可复制分数诊断和详情页读取稳健化，不会覆盖正式版脚本。
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
    const SCORE_CACHE_KEY = 'af3-auto-submitter-score-cache-v1';
    const SCORE_NAVIGATION_JOB_KEY = 'af3-auto-submitter-score-navigation-job-v1';
    const SCORE_RECENT_JOB_KEY = 'af3-auto-submitter-score-recent-job-v1';
    const MAX_DOWNLOAD_RECORDS = 500;
    const MAX_SCORE_CACHE = 1000;
    const SCORE_CACHE_MISSING_RETRY_MS = 6 * 60 * 60 * 1000;
    const SCORE_CACHE_ERROR_RETRY_MS = 30 * 60 * 1000;
    const SCORE_FETCH_TIMEOUT_MS = 8000;
    const SCORE_IFRAME_TIMEOUT_MS = 12000;
    const SCORE_FETCH_SPACING_MS = 350;
    const SCORE_CLICK_SPACING_MS = 900;
    const SCORE_DETAIL_WAIT_MS = 15000;
    const SCORE_NAVIGATION_JOB_MAX_AGE_MS = 60 * 1000;
    const SCORE_RECENT_JOB_MAX_AGE_MS = 5 * 60 * 1000;
    const ROW_BADGE_ATTR = 'data-af3-row-badges';
    const SCORE_VALUE_PATTERN = '(?:0?\\.\\d+|1(?:\\.0+)?|\\d{1,3}(?:\\.\\d+)?%?)';
    const IPTM_LABEL_PATTERN = 'i[_\\s.-]*p[_\\s.-]*t[_\\s.-]*m(?:[_\\s.-]*(?:score|confidence|ranking[_\\s.-]*score))?';
    const PTM_LABEL_PATTERN = 'p[_\\s.-]*t[_\\s.-]*m(?:[_\\s.-]*(?:score|confidence|ranking[_\\s.-]*score))?';
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
    const scoreFetchQueue = [];
    const scoreClickQueue = [];
    const scoreFetchPendingKeys = new Set();
    let scoreFetchActive = false;
    let scoreFetchGeneration = 0;
    let scoreClickActive = false;
    let scoreNavigationResumeActive = false;
    let routeHooksInstalled = false;
    let pageLifecycleHooksInstalled = false;
    let earlyScoreCacheHooksInstalled = false;
    let lastManualDetailCacheSignature = '';
    let lastDecorationCandidateCount = 0;
    let lastDecorationUsefulCount = 0;
    let lastScoreStatusMessage = '等待扫描';
    let lastScoreDiagnosticText = '';
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

    function getScoreCacheStats() {
        const records = Object.values(readScoreCache());
        return {
            ok: records.filter(record => record?.status === 'ok' && (record.iptm || record.ptm)).length,
            missing: records.filter(record => record?.status === 'missing').length,
            error: records.filter(record => record?.status === 'error').length
        };
    }

    function updateScoreStatus(message) {
        if (message) lastScoreStatusMessage = message;
        const box = getUiElement('af3-score-status');
        if (!box) return;

        const stats = getScoreCacheStats();
        const navJob = readScoreNavigationJob();
        const pending = scoreFetchPendingKeys.size + scoreFetchQueue.length + scoreClickQueue.length;
        const parts = [
            `分数: ${lastScoreStatusMessage}`,
            `行 ${lastDecorationUsefulCount}/${lastDecorationCandidateCount}`,
            `缓存 ${stats.ok}`,
            pending ? `队列 ${pending}` : '',
            navJob?.identity?.label ? `当前 ${navJob.identity.label.slice(0, 36)}` : '',
            stats.error ? `错误 ${stats.error}` : ''
        ].filter(Boolean);
        box.textContent = parts.join(' | ');
    }

    function forceScoreScan() {
        const resetCount = resetScoreRetryBlocksForCurrentRows();
        addLog(resetCount
            ? `手动刷新分数扫描，已清理 ${resetCount} 条失败/缺失缓存`
            : '手动刷新分数扫描');
        lastScoreStatusMessage = resetCount ? '已清理失败缓存，重试中' : '手动刷新中';
        scoreFetchGeneration++;
        scoreFetchQueue.length = 0;
        scoreClickQueue.length = 0;
        scoreFetchPendingKeys.clear();
        scheduleDecorateRows();
        updateScoreStatus();
    }

    function getScoreCandidateRows() {
        const selectors = 'tr, [role="row"], [role="listitem"], li, article, div[class*="row"], div[class*="Row"], div[class*="card"], div[class*="Card"]';
        return [...getRows(), ...Array.from(document.querySelectorAll(selectors))]
            .filter((row, index, array) => row && array.indexOf(row) === index)
            .filter(isLikelyDecoratableRow);
    }

    function resetScoreRetryBlocksForCurrentRows() {
        const cache = readScoreCache();
        const keys = new Set();

        getScoreCandidateRows().forEach(row => {
            const identity = getJobIdentity(row);
            getScoreCacheEntriesForIdentity(identity, cache).forEach(entry => {
                if (entry.key) keys.add(entry.key);
            });
        });

        let removed = 0;
        keys.forEach(key => {
            const record = cache[key];
            if (!record) return;
            if (record.status !== 'ok' || !hasScoreValues(record)) {
                delete cache[key];
                removed++;
            }
        });

        if (removed > 0) writeScoreCache(cache);
        if (isLikelyHistoryListPage()) clearScoreNavigationJob();
        return removed;
    }

    function diagnoseScoreRows() {
        const scoreCache = readScoreCache();
        const candidates = getScoreCandidateRows();

        const rows = candidates.slice(0, 8).map((row, index) => {
            const identity = getJobIdentity(row);
            const visibleScores = extractScoresFromText(getTextWithoutBadges(row));
            const cachedScores = getUsableCachedScores(identity);
            const cacheEntry = getBestScoreCacheEntry(identity, scoreCache);
            const cacheRecord = cacheEntry?.record || null;
            return {
                index: index + 1,
                label: identity?.label || '',
                key: identity?.key || '',
                href: identity?.href || '',
                text: normalizeText(getTextWithoutBadges(row)).slice(0, 160),
                visibleScores,
                cachedScores,
                cacheKey: cacheEntry?.key || '',
                cacheStatus: cacheRecord?.status || '',
                cacheSource: cacheRecord?.source || '',
                cacheFetchedAt: cacheRecord?.fetchedAt || '',
                hasBadge: Boolean(row.querySelector(`[${ROW_BADGE_ATTR}]`)),
                pending: Boolean(identity && scoreFetchPendingKeys.has(identity.key)),
                shouldFetch: isLikelyScoreFetchRow(row, identity, visibleScores, scoreCache)
            };
        });

        const summary = {
            url: location.href,
            candidates: candidates.length,
            useful: lastDecorationUsefulCount,
            pending: scoreFetchPendingKeys.size + scoreFetchQueue.length + scoreClickQueue.length,
            cache: getScoreCacheStats(),
            rows
        };
        lastScoreDiagnosticText = formatScoreDiagnostics(summary);
        console.log('[AF3] score diagnostics', summary);
        addLog(`诊断: 候选 ${summary.candidates}，缓存 ${summary.cache.ok}，队列 ${summary.pending}`);
        rows.forEach(row => {
            addLog(`诊断行${row.index}: ${row.label || '(无label)'} | ${row.href ? 'href' : 'nohref'} | 可见 ${row.visibleScores.iptm || '-'} / ${row.visibleScores.ptm || '-'} | 缓存 ${row.cachedScores.iptm || '-'} / ${row.cachedScores.ptm || '-'} | 状态 ${row.cacheStatus || '-'} | 读取 ${row.shouldFetch ? 'yes' : 'no'}`);
        });
        logExpanded = true;
        renderLogPanel();
        updateScoreStatus('诊断已写入日志');
        return summary;
    }

    function formatScoreDiagnostics(summary) {
        const lines = [
            `AF3 score diagnostics`,
            `url: ${summary.url}`,
            `candidates: ${summary.candidates}`,
            `useful: ${summary.useful}`,
            `pending: ${summary.pending}`,
            `cache: ok=${summary.cache.ok}, missing=${summary.cache.missing}, error=${summary.cache.error}`
        ];
        summary.rows.forEach(row => {
            lines.push([
                `row ${row.index}`,
                `label=${row.label || '(none)'}`,
                `key=${row.key || '(none)'}`,
                `href=${row.href || '(none)'}`,
                `visible=${row.visibleScores.iptm || '-'} / ${row.visibleScores.ptm || '-'}`,
                `cached=${row.cachedScores.iptm || '-'} / ${row.cachedScores.ptm || '-'}`,
                `cacheStatus=${row.cacheStatus || '-'}`,
                `cacheKey=${row.cacheKey || '-'}`,
                `cacheSource=${row.cacheSource || '-'}`,
                `cacheAt=${row.cacheFetchedAt || '-'}`,
                `badge=${row.hasBadge ? 'yes' : 'no'}`,
                `pending=${row.pending ? 'yes' : 'no'}`,
                `shouldFetch=${row.shouldFetch ? 'yes' : 'no'}`,
                `text=${row.text || '(empty)'}`
            ].join(' | '));
        });
        return lines.join('\n');
    }

    async function copyScoreDiagnostics() {
        const summary = diagnoseScoreRows();
        const text = lastScoreDiagnosticText || formatScoreDiagnostics(summary);
        try {
            await navigator.clipboard.writeText(text);
            addLog('诊断已复制到剪贴板');
            updateScoreStatus('诊断已复制');
        } catch (e) {
            addLog('剪贴板复制失败，请展开日志手动复制诊断行', 'warn');
            console.warn('[AF3] copy diagnostics failed', e, text);
            updateScoreStatus('诊断复制失败');
        }
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

    function pushTextPart(parts, text) {
        const value = normalizeText(text);
        if (value) parts.push(value);
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

    function collectScoreText(root = document.body, options = {}) {
        if (!root) return '';
        const parts = [];
        const includeScripts = Boolean(options.includeScripts);
        const maxParts = options.maxParts || 600;

        function visit(node) {
            if (!node || parts.length >= maxParts) return;
            if (node.nodeType === Node.TEXT_NODE) {
                pushTextPart(parts, node.nodeValue);
                return;
            }
            if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;

            const element = node.nodeType === Node.ELEMENT_NODE ? node : null;
            if (element?.hasAttribute?.(ROW_BADGE_ATTR)) return;
            if (element?.closest?.(`[${ROW_BADGE_ATTR}]`)) return;

            if (element) {
                const tagName = element.tagName || '';
                if (!includeScripts && /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/i.test(tagName)) return;
                if (includeScripts && /^(SCRIPT|TEMPLATE)$/i.test(tagName)) {
                    pushTextPart(parts, element.textContent);
                    pushTextPart(parts, extractScoreTextFromJsonString(element.textContent));
                }

                for (const attr of ['aria-label', 'title', 'alt', 'data-testid', 'data-test', 'data-score', 'data-value', 'data-name']) {
                    pushTextPart(parts, element.getAttribute?.(attr));
                }
                for (const attr of Array.from(element.attributes || [])) {
                    if (/iptm|ptm|score|confidence|ranking/i.test(attr.name)) {
                        pushTextPart(parts, `${attr.name} ${attr.value}`);
                    }
                }
            }

            const children = element?.childNodes || node.childNodes || [];
            for (const child of children) visit(child);
            if (element?.shadowRoot) visit(element.shadowRoot);
        }

        visit(root);
        return normalizeText(parts.join(' '));
    }

    function extractScoreTextFromJsonString(raw) {
        const value = String(raw || '').trim();
        if (!value || !/[{[]/.test(value) || !/iptm|ptm|score|confidence|ranking/i.test(value)) return '';
        try {
            const json = JSON.parse(value);
            const parts = [];
            collectScorePartsFromValue(json, parts, 0);
            return parts.join(' ');
        } catch (e) {
            return '';
        }
    }

    function collectScorePartsFromValue(value, parts, depth) {
        if (!value || depth > 8 || parts.length > 400) return;
        if (Array.isArray(value)) {
            value.forEach(item => collectScorePartsFromValue(item, parts, depth + 1));
            return;
        }
        if (typeof value === 'string') {
            if (/^[\[{]/.test(value.trim()) && /iptm|ptm|score|confidence|ranking/i.test(value)) {
                const nested = extractScoreTextFromJsonString(value);
                if (nested) parts.push(nested);
            }
            return;
        }
        if (typeof value !== 'object') return;

        Object.entries(value).forEach(([key, item]) => {
            if (/iptm|ptm|score|confidence|ranking/i.test(key)) {
                parts.push(`${key} ${String(item)}`);
            }
            collectScorePartsFromValue(item, parts, depth + 1);
        });
    }

    function stripScoreText(text) {
        let value = normalizeText(text);
        const iptmRegex = new RegExp(`(?:^|[^a-z0-9_])${IPTM_LABEL_PATTERN}\\s*["']?\\s*[:：=]?\\s*["']?${SCORE_VALUE_PATTERN}`, 'ig');
        const ptmRegex = new RegExp(`(?:^|[^a-z0-9_])${PTM_LABEL_PATTERN}\\s*["']?\\s*[:：=]?\\s*["']?${SCORE_VALUE_PATTERN}`, 'ig');
        value = value.replace(iptmRegex, ' ');
        value = value.replace(ptmRegex, ' ');
        return normalizeText(value.replace(/已下载|标记下载|取消标记|读取中|downloaded|scores/ig, ' '));
    }

    function hasScoreValues(scores) {
        return Boolean(scores && (scores.iptm || scores.ptm));
    }

    function documentHasPotentialScoreText() {
        const text = collectScoreText(document.documentElement, { includeScripts: true, maxParts: 1000 });
        if (!text) return false;
        return new RegExp(`${IPTM_LABEL_PATTERN}|${PTM_LABEL_PATTERN}`, 'i').test(text);
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

    function readScoreCache() {
        try {
            const raw = localStorage.getItem(SCORE_CACHE_KEY);
            const parsed = raw ? JSON.parse(raw) : {};
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
        } catch (e) {
            return {};
        }
    }

    function writeScoreCache(cache) {
        try {
            const entries = Object.entries(cache)
                .filter(([key, record]) => key && record && record.fetchedAt)
                .sort((a, b) => new Date(b[1].fetchedAt) - new Date(a[1].fetchedAt))
                .slice(0, MAX_SCORE_CACHE);
            localStorage.setItem(SCORE_CACHE_KEY, JSON.stringify(Object.fromEntries(entries)));
        } catch (e) {
            addLog('分数缓存保存失败：浏览器可能限制了 localStorage', 'warn');
        }
    }

    function cacheScores(identity, scores, status = 'ok', source = 'detail-page') {
        if (!identity || !identity.key) return;
        const cache = readScoreCache();
        const existing = cache[identity.key];
        const hasScores = hasScoreValues(scores);
        const next = {
            label: identity.label || existing?.label || identity.key,
            href: identity.href || existing?.href || '',
            iptm: scores?.iptm || null,
            ptm: scores?.ptm || null,
            status,
            source,
            fetchedAt: new Date().toISOString()
        };
        if (
            existing &&
            existing.iptm === next.iptm &&
            existing.ptm === next.ptm &&
            existing.status === next.status &&
            existing.href === next.href
        ) {
            return;
        }
        cache[identity.key] = next;
        writeScoreCache(cache);
        updateScoreStatus(status === 'ok' && hasScores ? `已缓存 ${next.label.slice(0, 36)}` : `记录 ${status}`);
    }

    function readScoreNavigationJob() {
        try {
            const raw = sessionStorage.getItem(SCORE_NAVIGATION_JOB_KEY);
            const job = raw ? JSON.parse(raw) : null;
            if (!job || !job.identity || !job.startedAt) return null;
            if (Date.now() - Date.parse(job.startedAt) > SCORE_NAVIGATION_JOB_MAX_AGE_MS) {
                sessionStorage.removeItem(SCORE_NAVIGATION_JOB_KEY);
                return null;
            }
            return job;
        } catch (e) {
            return null;
        }
    }

    function writeScoreNavigationJob(identity, returnUrl) {
        try {
            sessionStorage.setItem(SCORE_NAVIGATION_JOB_KEY, JSON.stringify({
                identity,
                returnUrl,
                startedAt: new Date().toISOString()
            }));
        } catch (e) {
            addLog('分数读取导航状态保存失败', 'warn');
        }
    }

    function clearScoreNavigationJob() {
        try {
            sessionStorage.removeItem(SCORE_NAVIGATION_JOB_KEY);
        } catch (e) {
            // Ignore storage cleanup failures.
        }
    }

    function readRecentScoreJob() {
        try {
            const raw = sessionStorage.getItem(SCORE_RECENT_JOB_KEY);
            const job = raw ? JSON.parse(raw) : null;
            if (!job || !job.identity || !job.startedAt) return null;
            if (Date.now() - Date.parse(job.startedAt) > SCORE_RECENT_JOB_MAX_AGE_MS) {
                sessionStorage.removeItem(SCORE_RECENT_JOB_KEY);
                return null;
            }
            return job;
        } catch (e) {
            return null;
        }
    }

    function writeRecentScoreJob(identity, fromUrl) {
        if (!identity?.key) return;
        try {
            sessionStorage.setItem(SCORE_RECENT_JOB_KEY, JSON.stringify({
                identity,
                fromUrl,
                startedAt: new Date().toISOString()
            }));
        } catch (e) {
            // Non-critical; row labels can still be matched from headings.
        }
    }

    function getRowDisplayLabel(row) {
        if (!row) return '';
        const link = Array.from(row.querySelectorAll('a[href]')).find(a => !a.closest(`[${ROW_BADGE_ATTR}]`));
        const linkText = normalizeJobLabel(link?.textContent || link?.getAttribute('aria-label') || link?.getAttribute('title'));
        if (isLikelyJobLabel(linkText)) return linkText;

        if (row.tagName === 'TR') {
            const cells = Array.from(row.querySelectorAll('td, th'));
            const nameCell = cells.find(cell => isLikelyNameCell(cell));
            if (nameCell) return normalizeJobLabel(getTextWithoutBadges(nameCell));
        }

        const directText = normalizeJobLabel(getTextWithoutBadges(row));
        if (isLikelyJobLabel(directText)) return directText.slice(0, 120);
        return '';
    }

    function isLikelyJobLabel(text) {
        const value = normalizeJobLabel(text);
        if (!value || value.length < 3 || /^https?:\/\//i.test(value)) return false;
        return !/^(open|open result|view|view result|details?|result|results?|download|delete|more|menu|actions?|feedback|copy link)$/i.test(value);
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
            const rowLabel = getRowDisplayLabel(row);
            const linkLabel = normalizeJobLabel(link.textContent || link.getAttribute('aria-label') || link.getAttribute('title'));
            const label = normalizeText(rowLabel || linkLabel || href).slice(0, 120);
            return { key: `href:${href}`, label: label || href, href };
        }

        const rowLabel = getRowDisplayLabel(row);

        for (const attr of ['data-job-id', 'data-id', 'data-testid', 'id', 'aria-label', 'title']) {
            const value = normalizeText(row.getAttribute?.(attr));
            if (value) return { key: `${attr}:${value}`, label: (rowLabel || value).slice(0, 120) };
        }

        const text = stripScoreText(getTextWithoutBadges(row));
        if (!text) return null;
        const label = text
            .split(/(?:\s{2,}|[|•])/)
            .map(part => normalizeText(part))
            .find(part => part && !/^(name|status|created|result|results?|download|open|delete|failed|success|running|queued)$/i.test(part));
        return { key: `text:${stableHash(text.slice(0, 500))}`, label: (label || text).slice(0, 120) };
    }

    function identityMatchesLabel(identity, label) {
        const left = normalizeText(identity?.label).toLowerCase();
        const right = normalizeText(label).toLowerCase();
        return Boolean(left && right && (left === right || left.includes(right) || right.includes(left)));
    }

    function normalizeJobLabel(label) {
        return stripScoreText(normalizeText(label))
            .replace(/\b20\d{2}[-/]\d{1,2}[-/]\d{1,2}(?:\s+\d{1,2}:\d{2})?\b/g, ' ')
            .replace(/\b(completed|saved draft|failed|in progress|examples|download|clone and reuse|feedback on structure)\b/ig, ' ')
            .replace(/[✓✔⋮]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function getLabelScoreIdentity(label) {
        const normalized = normalizeJobLabel(label);
        if (!normalized || normalized.length < 3) return null;
        return { key: `label:${stableHash(normalized.toLowerCase())}`, label: normalized.slice(0, 120) };
    }

    function isGenericDetailHeading(text) {
        return /^(search history|history|completed|results?|ranking confidence|predicted structure|download|downloads?|model|models?|terms|feedback)$/i.test(normalizeText(text));
    }

    function getDetailHeadingText() {
        return Array.from(document.querySelectorAll('h1, h2, [role="heading"]'))
            .map(el => normalizeText(el.textContent))
            .find(text => text && !isGenericDetailHeading(text));
    }

    function getPageJobIdentity() {
        const heading = getDetailHeadingText();
        const label = heading || normalizeText(document.title) || location.pathname;
        if (!label) return null;
        return { key: `page:${location.pathname}:${stableHash(label)}`, label: label.slice(0, 120) };
    }

    function getDetailPageIdentity() {
        const navJob = readScoreNavigationJob();
        const recentJob = readRecentScoreJob();
        const heading = getDetailHeadingText();

        if (navJob?.identity && (!heading || identityMatchesLabel(navJob.identity, heading))) {
            return navJob.identity;
        }

        if (recentJob?.identity && (!heading || identityMatchesLabel(recentJob.identity, heading))) {
            return recentJob.identity;
        }

        if (heading) return { key: `detail:${stableHash(heading)}`, label: heading.slice(0, 120) };
        return navJob?.identity || recentJob?.identity || getPageJobIdentity();
    }

    function cacheScoresForAliases(identity, scores, status = 'ok', source = 'detail-page') {
        if (!identity) return;
        cacheScores(identity, scores, status, source);
        const labelIdentity = getLabelScoreIdentity(identity.label);
        if (labelIdentity && labelIdentity.key !== identity.key) {
            cacheScores(labelIdentity, scores, status, `${source}-label`);
        }
        if (identity.href) {
            cacheScores({ key: `href:${identity.href}`, label: identity.label, href: identity.href }, scores, status, `${source}-href`);
        }
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
        const value = normalizeText(text)
            .replace(/&quot;|&#34;/gi, '"')
            .replace(/&#39;|&apos;/gi, "'");
        const iptm = findScoreValue(value, IPTM_LABEL_PATTERN);
        const ptm = findScoreValue(value, PTM_LABEL_PATTERN);
        return {
            iptm,
            ptm
        };
    }

    function normalizeScoreValue(raw) {
        const value = String(raw || '').trim();
        if (!value) return null;
        const isPercent = value.endsWith('%');
        const numeric = Number(value.replace('%', ''));
        if (!Number.isFinite(numeric)) return value;
        const normalized = isPercent || numeric > 1 ? numeric / 100 : numeric;
        if (normalized < 0 || normalized > 1) return value;
        return String(Number(normalized.toFixed(3)));
    }

    function findScoreValue(text, labelPattern) {
        const labelBeforeValue = new RegExp(
            `(?:^|[^a-z0-9_])${labelPattern}\\s*["']?\\s*(?:[:：=]|is|score)?\\s*["']?\\s*(${SCORE_VALUE_PATTERN})`,
            'i'
        );
        const direct = text.match(labelBeforeValue)?.[1];
        if (direct) return normalizeScoreValue(direct);

        const valueBeforeLabel = new RegExp(
            `(?:^|[^a-z0-9_])(${SCORE_VALUE_PATTERN})\\s*(?:for|as)?\\s*${labelPattern}(?:$|[^a-z0-9_])`,
            'i'
        );
        const before = text.match(valueBeforeLabel)?.[1] || null;
        return before ? normalizeScoreValue(before) : null;
    }

    function getScoreCacheEntriesForIdentity(identity, cache = readScoreCache()) {
        if (!identity) return [];
        const entries = [];
        const seen = new Set();
        const add = (key) => {
            if (!key || seen.has(key)) return;
            seen.add(key);
            if (cache[key]) entries.push({ key, record: cache[key] });
        };

        add(identity.key);
        const labelIdentity = getLabelScoreIdentity(identity.label);
        add(labelIdentity?.key);
        if (identity.href) add(`href:${identity.href}`);
        return entries;
    }

    function getBestScoreCacheEntry(identity, cache = readScoreCache()) {
        const entries = getScoreCacheEntriesForIdentity(identity, cache);
        if (entries.length === 0) return null;
        return entries.find(entry => entry.record?.status === 'ok' && hasScoreValues(entry.record)) ||
            entries.find(entry => entry.key === identity?.key) ||
            entries[0];
    }

    function getScoreCacheRecord(identity) {
        return getBestScoreCacheEntry(identity)?.record || null;
    }

    function getUsableCachedScores(identity) {
        const record = getBestScoreCacheEntry(identity)?.record || null;
        if (!record || record.status !== 'ok' || !hasScoreValues(record)) return { iptm: null, ptm: null };
        return { iptm: record.iptm || null, ptm: record.ptm || null };
    }

    function isRetryableScoreRecord(record) {
        if (!record) return true;
        if (record.status === 'ok' && (record.iptm || record.ptm)) return false;

        const fetchedAt = Date.parse(record.fetchedAt || '');
        if (!Number.isFinite(fetchedAt)) return true;
        const age = Date.now() - fetchedAt;
        if (record.status === 'missing') return age > SCORE_CACHE_MISSING_RETRY_MS;
        if (record.status === 'error') return age > SCORE_CACHE_ERROR_RETRY_MS;
        return true;
    }

    function getActiveTabText() {
        const candidates = Array.from(document.querySelectorAll(
            '[role="tab"][aria-selected="true"], button[aria-selected="true"], div[aria-selected="true"], button, [role="button"]'
        ));
        const activeTab = candidates.find(el => {
            const text = normalizeText(el.textContent).toLowerCase();
            if (!text) return false;
            if (!/completed|complete|saved draft|draft|in progress|failed|examples|完成|历史|结果/.test(text)) return false;
            if (el.getAttribute('aria-selected') === 'true' || el.getAttribute('aria-pressed') === 'true') return true;
            if (el.matches('[role="tab"]')) return true;
            const style = getComputedStyle(el);
            const aria = normalizeText(el.getAttribute('aria-label')).toLowerCase();
            return /selected|active|checked/.test(String(el.className || '') + ' ' + aria) ||
                style.backgroundColor !== 'rgba(0, 0, 0, 0)' && style.backgroundColor !== 'transparent';
        });
        return normalizeText(activeTab?.textContent).toLowerCase();
    }

    function isCompletedHistoryContext() {
        const tabText = getActiveTabText();
        if (/draft|failed|running|queued|pending|saved/.test(tabText)) return false;
        const routeText = `${location.pathname} ${location.search} ${location.hash}`.toLowerCase();
        const pageText = normalizeText(document.body?.innerText || '').toLowerCase();
        return /completed|complete|history|result|results|完成|历史|结果/.test(tabText) ||
            /history|result|results/.test(routeText) ||
            (pageText.includes('search history') && pageText.includes('completed'));
    }

    function isLikelyHistoryListPage() {
        const pageText = normalizeText(document.body?.innerText || '').toLowerCase();
        const routeText = `${location.pathname} ${location.search} ${location.hash}`.toLowerCase();
        const hasHistoryLabel = pageText.includes('search history') ||
            /\bhistory\b/.test(routeText) ||
            /\b(name|modified|created|status)\b.*\b(name|modified|created|status)\b/i.test(pageText.slice(0, 1500));
        if (!hasHistoryLabel) return false;

        const selectors = 'tr, [role="row"], [role="listitem"], li, article, div[class*="row"], div[class*="Row"], div[class*="card"], div[class*="Card"]';
        const rows = Array.from(document.querySelectorAll(selectors))
            .filter(row => !isHeaderLikeRow(row) && isLikelyDecoratableRow(row))
            .filter(row => Boolean(getJobIdentity(row)));
        return rows.length > 0 || Boolean(getVisibleScoreRows().length);
    }

    function isSameOriginDetailHref(href) {
        try {
            const url = new URL(href, location.href);
            if (!/^https?:$/.test(url.protocol)) return false;
            if (url.origin !== location.origin) return false;
            const current = new URL(location.href);
            return `${url.pathname}${url.search}` !== `${current.pathname}${current.search}`;
        } catch (e) {
            return false;
        }
    }

    function isLikelyScoreFetchRow(row, identity, visibleScores, scoreCache) {
        if (!row || !identity) return false;
        if (hasScoreValues(visibleScores)) return false;
        if (identity.href && !isSameOriginDetailHref(identity.href)) return false;

        const record = getBestScoreCacheEntry(identity, scoreCache)?.record || null;
        if (!isRetryableScoreRecord(record)) return false;

        const rowText = stripScoreText(getTextWithoutBadges(row)).toLowerCase();
        if (/\b(saved draft|draft|failed|running|queued|pending)\b/.test(rowText)) return false;
        if (isCompletedHistoryContext()) return true;
        if (isLikelyHistoryListPage() && (identity.href || /\b(open result|view result|results?)\b/.test(rowText))) return true;
        return /\b(completed|complete|done)\b/.test(rowText);
    }

    function getRowOpenTarget(row, identity) {
        if (!row) return null;
        const link = Array.from(row.querySelectorAll('a[href]')).find(el => {
            if (el.closest(`[${ROW_BADGE_ATTR}]`)) return false;
            const text = normalizeText(el.textContent || el.getAttribute('aria-label') || el.getAttribute('title'));
            return !/download|clone|feedback|delete|更多|下载|删除/i.test(text);
        });
        if (link) return link;

        const mount = getBadgeMount(row);
        if (mount && !isControlCell(mount)) {
            const mountText = stripScoreText(getTextWithoutBadges(mount));
            if (!identity?.label || identityMatchesLabel(identity, mountText) || mountText.length > 8) {
                return mount;
            }
        }

        const selectors = [
            'button:not([aria-label*="More" i]):not([aria-label*="menu" i]):not([aria-label*="更多" i])',
            '[role="button"]:not([aria-label*="More" i]):not([aria-label*="menu" i]):not([aria-label*="更多" i])'
        ];
        for (const selector of selectors) {
            const element = Array.from(row.querySelectorAll(selector)).find(el => {
                if (el.closest(`[${ROW_BADGE_ATTR}]`)) return false;
                if (el.matches('input, select, textarea')) return false;
                const text = normalizeText(el.textContent || el.getAttribute('aria-label') || el.getAttribute('title'));
                if (/more|menu|download|clone|feedback|delete|更多|下载|删除/i.test(text)) return false;
                const rect = el.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0;
            });
            if (element) return element;
        }

        return row;
    }

    async function fetchTextWithTimeout(href, timeoutMs) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const response = await fetch(href, {
                credentials: 'include',
                signal: controller.signal
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return await response.text();
        } finally {
            clearTimeout(timer);
        }
    }

    function extractScoresFromHtml(html) {
        const directScores = extractScoresFromText(html);
        if (hasScoreValues(directScores)) return directScores;

        try {
            const doc = new DOMParser().parseFromString(html, 'text/html');
            return extractScoresFromText(collectScoreText(doc.documentElement, { includeScripts: true, maxParts: 1000 }));
        } catch (e) {
            return directScores;
        }
    }

    function extractScoresWithIframe(href) {
        return new Promise(resolve => {
            const iframe = document.createElement('iframe');
            let finished = false;
            let pollTimer = null;

            function cleanup(scores) {
                if (finished) return;
                finished = true;
                clearInterval(pollTimer);
                iframe.remove();
                resolve(scores || { iptm: null, ptm: null });
            }

            Object.assign(iframe.style, {
                position: 'fixed',
                width: '1px',
                height: '1px',
                left: '-10000px',
                top: '-10000px',
                opacity: '0',
                pointerEvents: 'none'
            });

            const deadline = Date.now() + SCORE_IFRAME_TIMEOUT_MS;
            pollTimer = setInterval(() => {
                if (Date.now() > deadline) {
                    cleanup(null);
                    return;
                }
                try {
                    const doc = iframe.contentDocument || iframe.contentWindow?.document;
                    const text = collectScoreText(doc?.documentElement, { includeScripts: true, maxParts: 1000 });
                    const scores = extractScoresFromText(text);
                    if (hasScoreValues(scores)) cleanup(scores);
                } catch (e) {
                    cleanup(null);
                }
            }, 500);

            setTimeout(() => cleanup(null), SCORE_IFRAME_TIMEOUT_MS + 500);
            iframe.addEventListener('load', () => {
                try {
                    const doc = iframe.contentDocument || iframe.contentWindow?.document;
                    const text = collectScoreText(doc?.documentElement, { includeScripts: true, maxParts: 1000 });
                    const scores = extractScoresFromText(text);
                    if (hasScoreValues(scores)) cleanup(scores);
                } catch (e) {
                    cleanup(null);
                }
            });
            iframe.src = href;
            document.body.appendChild(iframe);
        });
    }

    async function fetchScoresForIdentity(identity) {
        const html = await fetchTextWithTimeout(identity.href, SCORE_FETCH_TIMEOUT_MS);
        const htmlScores = extractScoresFromHtml(html);
        if (hasScoreValues(htmlScores)) return htmlScores;
        return await extractScoresWithIframe(identity.href);
    }

    async function waitForDetailScores() {
        const deadline = Date.now() + SCORE_DETAIL_WAIT_MS;
        while (Date.now() < deadline) {
            const scores = extractScoresFromText(collectScoreText(document.body, { includeScripts: true, maxParts: 1000 }));
            if (hasScoreValues(scores)) return scores;
            await sleep(500);
        }
        return { iptm: null, ptm: null };
    }

    async function handleScoreDetailPage() {
        if (scoreNavigationResumeActive) return;
        const navJob = readScoreNavigationJob();
        const visibleScores = extractScoresFromText(collectScoreText(document.body, { includeScripts: true, maxParts: 1000 }));

        if (!navJob?.identity) {
            if (!hasScoreValues(visibleScores) || isLikelyHistoryListPage()) return;
            const identity = getDetailPageIdentity();
            if (!identity?.label || !getLabelScoreIdentity(identity.label)) return;
            const signature = [location.pathname, identity.label, visibleScores.iptm || '', visibleScores.ptm || ''].join('|');
            if (signature === lastManualDetailCacheSignature) return;
            lastManualDetailCacheSignature = signature;
            cacheScoresForAliases(identity, visibleScores, 'ok', 'manual-detail');
            addLog(`已缓存当前详情页分数：${identity.label}`);
            scheduleDecorateRows();
            return;
        }

        scoreNavigationResumeActive = true;
        try {
            const identity = getDetailPageIdentity();
            addLog(`读取详情页分数：${identity?.label || navJob.identity.label}`);
            updateScoreStatus(`详情页读取 ${navJob.identity.label.slice(0, 36)}`);
            const scores = hasScoreValues(visibleScores) ? visibleScores : await waitForDetailScores();
            cacheScoresForAliases(navJob.identity, scores, hasScoreValues(scores) ? 'ok' : 'missing', 'detail-navigation');
            if (identity?.key && identity.key !== navJob.identity.key) {
                cacheScoresForAliases(identity, scores, hasScoreValues(scores) ? 'ok' : 'missing', 'detail-navigation-alias');
            }
            scoreFetchPendingKeys.delete(navJob.identity.key);
            if (identity?.key) scoreFetchPendingKeys.delete(identity.key);
            clearScoreNavigationJob();
            addLog(hasScoreValues(scores)
                ? `已读取分数：ipTM ${scores.iptm || '-'}，pTM ${scores.ptm || '-'}`
                : '详情页未读取到 ipTM/pTM', hasScoreValues(scores) ? 'info' : 'warn');

            if (navJob.returnUrl && location.href !== navJob.returnUrl) {
                location.href = navJob.returnUrl;
            } else {
                history.back();
            }
        } catch (e) {
            cacheScores(navJob.identity, null, 'error', 'detail-navigation');
            scoreFetchPendingKeys.delete(navJob.identity.key);
            clearScoreNavigationJob();
            addLog(`详情页分数读取失败：${e.message}`, 'warn');
            if (navJob.returnUrl && location.href !== navJob.returnUrl) location.href = navJob.returnUrl;
        }
    }

    function cacheVisibleDetailScores(reason = 'detail-visible') {
        const navJob = readScoreNavigationJob();
        const visibleScores = extractScoresFromText(collectScoreText(document.body, { includeScripts: true, maxParts: 1000 }));
        if (!hasScoreValues(visibleScores)) return false;
        if (navJob?.returnUrl && location.href === navJob.returnUrl) return false;
        if (!navJob && isLikelyHistoryListPage()) return false;

        const identity = navJob?.identity || getDetailPageIdentity();
        if (!identity?.label || !getLabelScoreIdentity(identity.label)) return false;

        const signature = [location.pathname, identity.label, visibleScores.iptm || '', visibleScores.ptm || '', reason].join('|');
        if (signature === lastManualDetailCacheSignature && reason !== 'pagehide') return true;
        lastManualDetailCacheSignature = signature;

        cacheScoresForAliases(identity, visibleScores, 'ok', reason);
        const recentJob = readRecentScoreJob();
        if (recentJob?.identity?.key && recentJob.identity.key !== identity.key) {
            const heading = getDetailHeadingText();
            if (!heading || identityMatchesLabel(recentJob.identity, heading) || identityMatchesLabel(identity, recentJob.identity.label)) {
                cacheScoresForAliases(recentJob.identity, visibleScores, 'ok', `${reason}-recent`);
            }
        }
        if (!navJob) addLog(`已缓存当前详情页分数：${identity.label}`);
        return true;
    }

    function maybeCacheVisibleDetailScores(reason = 'visible-score') {
        if (!documentHasPotentialScoreText()) return false;
        if (!readScoreNavigationJob() && getVisibleScoreRows().length > 0) return false;
        return cacheVisibleDetailScores(reason);
    }

    function enqueueScoreFetch(identity, row = null) {
        if (!identity?.key || !identity.href || scoreFetchPendingKeys.has(identity.key)) return;
        const record = getScoreCacheRecord(identity);
        if (!isRetryableScoreRecord(record)) return;

        scoreFetchPendingKeys.add(identity.key);
        scoreFetchQueue.push({ identity, row });
        processScoreFetchQueue();
    }

    async function processScoreFetchQueue() {
        if (scoreFetchActive) return;
        scoreFetchActive = true;
        const generation = scoreFetchGeneration;

        try {
            while (scoreFetchQueue.length > 0) {
                const item = scoreFetchQueue.shift();
                const identity = item?.identity || item;
                if (!identity?.key || !identity.href) continue;
                let handedToClick = false;

                try {
                    const record = getScoreCacheRecord(identity);
                    if (!isRetryableScoreRecord(record)) continue;

                    updateScoreStatus(`后台读取 ${identity.label.slice(0, 36)}`);
                    const scores = await fetchScoresForIdentity(identity);
                    if (generation !== scoreFetchGeneration) continue;
                    if (hasScoreValues(scores)) {
                        cacheScoresForAliases(identity, scores, 'ok', 'detail-fetch');
                    } else {
                        const row = item?.row?.isConnected ? item.row : null;
                        scoreFetchPendingKeys.delete(identity.key);
                        if (row && enqueueScoreClick(row, identity, true, 'fetch-miss')) {
                            handedToClick = true;
                            addLog(`后台未读到分数，进入详情页重试：${identity.label}`);
                            return;
                        }
                        cacheScoresForAliases(identity, scores, 'missing', 'detail-fetch');
                    }
                } catch (e) {
                    if (generation !== scoreFetchGeneration) continue;
                    const row = item?.row?.isConnected ? item.row : null;
                    scoreFetchPendingKeys.delete(identity.key);
                    if (row && enqueueScoreClick(row, identity, true, 'fetch-error')) {
                        handedToClick = true;
                        addLog(`后台读取失败，进入详情页重试：${identity.label}`, 'warn');
                        return;
                    }
                    cacheScoresForAliases(identity, null, 'error', 'detail-fetch');
                    console.warn('[AF3] 详情页分数读取失败', identity.label || identity.href, e);
                } finally {
                    if (!handedToClick) scoreFetchPendingKeys.delete(identity.key);
                    scheduleDecorateRows();
                }

                await sleep(SCORE_FETCH_SPACING_MS);
            }
        } finally {
            scoreFetchActive = false;
            if (scoreFetchQueue.length > 0) processScoreFetchQueue();
        }
    }

    function enqueueScoreClick(row, identity, force = false, reason = 'missing-href') {
        if (!row || !identity?.key) return false;
        if (!force && scoreFetchPendingKeys.has(identity.key)) return false;
        if (scoreClickActive || scoreClickQueue.length > 0 || readScoreNavigationJob()) return;
        const record = getScoreCacheRecord(identity);
        if (!force && !isRetryableScoreRecord(record)) return false;
        const target = getRowOpenTarget(row, identity);
        if (!target) return false;

        scoreFetchPendingKeys.add(identity.key);
        scoreClickQueue.push({ row, identity, reason });
        processScoreClickQueue();
        return true;
    }

    async function processScoreClickQueue() {
        if (scoreClickActive || scoreNavigationResumeActive || isRunning) return;
        const navJob = readScoreNavigationJob();
        if (navJob) return;

        scoreClickActive = true;
        try {
            while (scoreClickQueue.length > 0 && !isRunning) {
                const item = scoreClickQueue.shift();
                if (!item?.identity?.key) continue;

                const record = getScoreCacheRecord(item.identity);
                if (!isRetryableScoreRecord(record)) {
                    scoreFetchPendingKeys.delete(item.identity.key);
                    continue;
                }

                const row = item.row?.isConnected ? item.row : null;
                const target = getRowOpenTarget(row, item.identity);
                if (!target) {
                    cacheScores(item.identity, null, 'error', 'detail-click');
                    scoreFetchPendingKeys.delete(item.identity.key);
                    continue;
                }

                addLog(`进入详情页读取分数：${item.identity.label}`);
                updateScoreStatus(`进入详情 ${item.identity.label.slice(0, 36)}`);
                writeScoreNavigationJob(item.identity, location.href);
                simulateClick(target, 'rgba(26, 115, 232, 0.25)');
                scheduleDecorateRows();
                await sleep(SCORE_CLICK_SPACING_MS);
                return;
            }
        } finally {
            scoreClickActive = false;
        }
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

    function isHeaderLikeRow(row) {
        if (!row) return false;
        if (row.closest('thead')) return true;
        if (row.tagName === 'TR' && row.querySelector('th') && !row.querySelector('td')) return true;
        const text = stripScoreText(getTextWithoutBadges(row)).toLowerCase();
        return /^(select\s+)?name\s+(status\s+)?modified$/.test(text) ||
            /^(name|modified|status|select)$/.test(text);
    }

    function isLikelyDecoratableRow(row) {
        if (!row || isInsidePanel(row) || !isElementVisible(row)) return false;
        if (isHeaderLikeRow(row)) return false;
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
            /(^|\s|[-_])(row|card)(\s|$|-|_|[A-Z])/i.test(className) ||
            /[A-Z](row|card)(\s|$|-|_)/i.test(className);

        return rowLike || Boolean(row.querySelector('input[type="checkbox"], a[href], button, [role="button"]'));
    }

    function getVisibleScoreRows() {
        const selectors = 'tr, [role="row"], [role="listitem"], li, article, div[class*="row"], div[class*="Row"], div[class*="card"], div[class*="Card"]';
        return Array.from(document.querySelectorAll(selectors))
            .filter(row => !isHeaderLikeRow(row) && isElementVisible(row) && hasScoreValues(extractScoresFromText(getTextWithoutBadges(row))));
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

    function isControlCell(cell) {
        if (!cell) return true;
        if (cell.querySelector('input[type="checkbox"]')) return true;
        const text = normalizeText(cell.textContent);
        const buttons = cell.querySelectorAll('button, [role="button"], [aria-haspopup="menu"]');
        if (buttons.length > 0 && text.length < 12) return true;
        return text === '' || /^(\u2713|\u2714|\u22ee|\.\.\.)$/.test(text);
    }

    function looksLikeDateCell(cell) {
        const text = normalizeText(cell?.textContent);
        return /\b20\d{2}[-/]\d{1,2}[-/]\d{1,2}\b/.test(text) ||
            /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/i.test(text);
    }

    function isLikelyNameCell(cell) {
        if (!cell || isControlCell(cell) || looksLikeDateCell(cell)) return false;
        const label = normalizeJobLabel(getTextWithoutBadges(cell));
        return isLikelyJobLabel(label);
    }

    function getBadgeMount(row) {
        if (row.tagName === 'TR') {
            const cells = Array.from(row.querySelectorAll('td, th'));
            const nameCell = cells.find(cell => isLikelyNameCell(cell));
            if (nameCell) return nameCell;

            const link = Array.from(row.querySelectorAll('a[href]')).find(a => !a.closest(`[${ROW_BADGE_ATTR}]`));
            const linkCell = link?.closest('td, th');
            if (linkCell && !isControlCell(linkCell)) return linkCell;
            return cells.find(cell => !isControlCell(cell)) || row;
        }

        const link = Array.from(row.querySelectorAll('a[href]')).find(a => !a.closest(`[${ROW_BADGE_ATTR}]`));
        if (link?.parentElement && link.parentElement !== row && !isControlCell(link.parentElement)) {
            return link.parentElement;
        }
        return row;
    }

    function renderRowBadges(row) {
        if (!row || isInsidePanel(row) || !isElementVisible(row)) return;

        const identity = getJobIdentity(row);
        const records = readDownloadRecords();
        const scoreCache = readScoreCache();
        const downloaded = Boolean(identity && records[identity.key]);
        const visibleScores = extractScoresFromText(getTextWithoutBadges(row));
        if (identity && hasScoreValues(visibleScores)) cacheScores(identity, visibleScores, 'ok', 'visible-row');

        const cachedScores = getUsableCachedScores(identity);
        const scores = hasScoreValues(visibleScores) ? visibleScores : cachedScores;
        const hasScores = hasScoreValues(scores);
        const hasDownload = rowHasDownloadAction(row);
        const shouldFetchScores = !hasScores && isLikelyScoreFetchRow(row, identity, visibleScores, scoreCache);
        if (shouldFetchScores) {
            if (identity?.href) {
                enqueueScoreFetch(identity, row);
            } else {
                enqueueScoreClick(row, identity);
            }
        }

        const fetchingScores = Boolean(identity && scoreFetchPendingKeys.has(identity.key));
        const shouldShow = downloaded || hasScores || hasDownload || fetchingScores;
        const mount = getBadgeMount(row);
        row.querySelectorAll(`[${ROW_BADGE_ATTR}]`).forEach(node => {
            if (node.parentElement !== mount) node.remove();
        });
        let container = mount.querySelector(`:scope > [${ROW_BADGE_ATTR}]`);
        const recordTime = identity ? records[identity.key]?.downloadedAt || '' : '';
        const signature = [
            downloaded ? '1' : '0',
            scores.iptm || '',
            scores.ptm || '',
            hasDownload ? '1' : '0',
            fetchingScores ? '1' : '0',
            recordTime,
            identity?.key || ''
        ].join('|');

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
        if (!hasScores && fetchingScores) {
            container.appendChild(makeBadge('分数读取中', '#fef7e0', '#b06000', '正在后台读取详情页分数'));
        }

        if (identity && (downloaded || hasDownload)) {
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
        const scoreCache = readScoreCache();
        const candidates = getScoreCandidateRows();
        lastDecorationCandidateCount = candidates.length;

        const usefulRows = candidates.filter(row => {
            const identity = getJobIdentity(row);
            const downloaded = Boolean(identity && records[identity.key]);
            const visibleScores = extractScoresFromText(getTextWithoutBadges(row));
            const cachedScores = getUsableCachedScores(identity);
            const hasExistingBadges = Boolean(row.querySelector(`[${ROW_BADGE_ATTR}]`));
            const shouldFetchScores = !hasScoreValues(cachedScores) && isLikelyScoreFetchRow(row, identity, visibleScores, scoreCache);
            return downloaded ||
                hasScoreValues(visibleScores) ||
                hasScoreValues(cachedScores) ||
                shouldFetchScores ||
                scoreFetchPendingKeys.has(identity?.key) ||
                rowHasDownloadAction(row) ||
                hasExistingBadges;
        });
        lastDecorationUsefulCount = usefulRows.length;
        if (lastDecorationCandidateCount === 0) {
            updateScoreStatus('未识别到列表行');
        } else if (lastDecorationUsefulCount === 0) {
            updateScoreStatus('未发现可读取行');
        } else if (!scoreFetchActive && !scoreClickActive && scoreFetchPendingKeys.size === 0) {
            updateScoreStatus('扫描完成');
        } else {
            updateScoreStatus();
        }

        return usefulRows.filter(row => !usefulRows.some(other => other !== row && row.contains(other)));
    }

    function decorateResultRows() {
        try {
            handleScoreDetailPage();
            getRowsForDecorations().forEach(renderRowBadges);
            updateScoreStatus();
        } catch (e) {
            console.warn('[AF3] 行标签刷新失败', e);
            updateScoreStatus('扫描错误');
        }
    }

    function scheduleDecorateRows() {
        if (decorateTimer) clearTimeout(decorateTimer);
        decorateTimer = setTimeout(() => {
            decorateTimer = null;
            decorateResultRows();
        }, 120);
    }

    function handleRouteChange() {
        maybeCacheVisibleDetailScores('route-change');
        ensureUI();
        scheduleDecorateRows();
        setTimeout(scheduleDecorateRows, 500);
        setTimeout(scheduleDecorateRows, 1500);
    }

    function installRouteChangeHooks() {
        if (routeHooksInstalled) return;
        routeHooksInstalled = true;

        const wrapHistoryMethod = (methodName) => {
            const original = history[methodName];
            if (typeof original !== 'function') return;
            history[methodName] = function(...args) {
                const result = original.apply(this, args);
                handleRouteChange();
                return result;
            };
        };

        try {
            wrapHistoryMethod('pushState');
            wrapHistoryMethod('replaceState');
            window.addEventListener('popstate', handleRouteChange);
            window.addEventListener('hashchange', handleRouteChange);
        } catch (e) {
            addLog(`路由监听安装失败：${e.message}`, 'warn');
        }
    }

    function installPageLifecycleHooks() {
        if (pageLifecycleHooksInstalled) return;
        pageLifecycleHooksInstalled = true;
        window.addEventListener('pagehide', () => maybeCacheVisibleDetailScores('pagehide'));
        window.addEventListener('beforeunload', () => maybeCacheVisibleDetailScores('pagehide'));
    }

    function installEarlyScoreCacheHooks() {
        if (earlyScoreCacheHooksInstalled) return;
        if (!document.documentElement) {
            setTimeout(installEarlyScoreCacheHooks, 25);
            return;
        }
        earlyScoreCacheHooksInstalled = true;

        const observer = new MutationObserver(() => {
            maybeCacheVisibleDetailScores('early-visible');
        });
        observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
        document.addEventListener('DOMContentLoaded', () => maybeCacheVisibleDetailScores('dom-ready'));
        window.addEventListener('load', () => maybeCacheVisibleDetailScores('load'));
        setTimeout(() => maybeCacheVisibleDetailScores('early-delay'), 250);
        setTimeout(() => maybeCacheVisibleDetailScores('early-delay'), 1000);
    }

    function rememberRowInteraction(event) {
        const row = findClosestRow(event.target);
        if (isMenuOrChromeRow(row)) return;
        const identity = getJobIdentity(row);
        if (identity) {
            lastInteractedJob = identity;
            lastInteractedAt = Date.now();
            writeRecentScoreJob(identity, location.href);
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
        header.textContent = '🧪 AF3 自动助手 DEV V2.8';

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

        const scoreTools = document.createElement('div');
        Object.assign(scoreTools.style, {
            display: 'flex',
            alignItems: 'center',
            gap: '6px'
        });

        const scoreStatus = document.createElement('div');
        scoreStatus.id = 'af3-score-status';
        scoreStatus.textContent = '分数: 等待扫描';
        Object.assign(scoreStatus.style, {
            flex: '1',
            minWidth: '0',
            padding: '5px 7px',
            borderRadius: '6px',
            backgroundColor: 'rgba(255,255,255,0.06)',
            color: '#dfe1e5',
            fontSize: '10px',
            lineHeight: '1.35',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
        });

        const scoreRefreshBtn = document.createElement('button');
        scoreRefreshBtn.id = 'af3-score-refresh';
        scoreRefreshBtn.type = 'button';
        scoreRefreshBtn.textContent = '刷新分数';
        scoreRefreshBtn.title = '重新扫描 History 列表并读取缺失的 ipTM/pTM';
        Object.assign(scoreRefreshBtn.style, {
            padding: '5px 7px',
            borderRadius: '6px',
            border: '1px solid #5f6368',
            backgroundColor: 'rgba(255,255,255,0.08)',
            color: '#e8eaed',
            cursor: 'pointer',
            fontSize: '10px',
            fontWeight: '700',
            whiteSpace: 'nowrap'
        });
        scoreRefreshBtn.onclick = forceScoreScan;
        const scoreDiagnoseBtn = document.createElement('button');
        scoreDiagnoseBtn.id = 'af3-score-diagnose';
        scoreDiagnoseBtn.type = 'button';
        scoreDiagnoseBtn.textContent = '诊断';
        scoreDiagnoseBtn.title = '输出当前 History 行的 label、href、缓存和读取状态';
        Object.assign(scoreDiagnoseBtn.style, {
            padding: '5px 7px',
            borderRadius: '6px',
            border: '1px solid #5f6368',
            backgroundColor: 'rgba(255,255,255,0.08)',
            color: '#e8eaed',
            cursor: 'pointer',
            fontSize: '10px',
            fontWeight: '700',
            whiteSpace: 'nowrap'
        });
        scoreDiagnoseBtn.onclick = diagnoseScoreRows;
        const scoreCopyDiagBtn = document.createElement('button');
        scoreCopyDiagBtn.id = 'af3-score-copy-diagnose';
        scoreCopyDiagBtn.type = 'button';
        scoreCopyDiagBtn.textContent = '复制';
        scoreCopyDiagBtn.title = '复制分数诊断文本，方便粘贴反馈';
        Object.assign(scoreCopyDiagBtn.style, {
            padding: '5px 7px',
            borderRadius: '6px',
            border: '1px solid #5f6368',
            backgroundColor: 'rgba(255,255,255,0.08)',
            color: '#e8eaed',
            cursor: 'pointer',
            fontSize: '10px',
            fontWeight: '700',
            whiteSpace: 'nowrap'
        });
        scoreCopyDiagBtn.onclick = copyScoreDiagnostics;
        scoreTools.appendChild(scoreStatus);
        scoreTools.appendChild(scoreRefreshBtn);
        scoreTools.appendChild(scoreDiagnoseBtn);
        scoreTools.appendChild(scoreCopyDiagBtn);

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
        container.appendChild(scoreTools);
        container.appendChild(footer); container.appendChild(logPanel);
        shadow.appendChild(container);
        document.body.appendChild(host);
        makeDraggable(host, header);
        renderLogPanel();
        updateScoreStatus();
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
        installRouteChangeHooks();
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

    installRouteChangeHooks();
    installPageLifecycleHooks();
    installEarlyScoreCacheHooks();
    bootWhenReady();
})();
