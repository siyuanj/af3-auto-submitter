// ==UserScript==
// @name         AF3 Auto Submitter V2.1 (失败任务也可以重跑)
// @namespace    http://tampermonkey.net/
// @version      2.1
// @description  全能版：自动识别模式。修复了在Failed列表重跑时，无法点中"Clone and reuse"菜单项的问题（增强了文字搜索和等待机制）。
// @author       Jiang Siyuan
// @match        https://alphafoldserver.com/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // --- 配置 ---
    const CONTAINER_ID = 'af3-v20-panel';
    const WAIT_FOR_MODAL = 2000;
    const WAIT_FOR_PAGE_LOAD = 3000; // 跳转等待时间
    // -----------

    let isRunning = false;
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

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

        console.log("点击菜单按钮...");
        simulateClick(menuBtn, 'rgba(0, 0, 255, 0.3)');
        return true;
    }

    // 2. 【核心修复】全屏搜索 "Clone and reuse" 文字并点击
    async function clickCloneOption() {
        console.log("寻找 Clone 选项...");

        // 轮询机制：菜单弹出可能有动画，我们给它 2秒 时间反复找
        for(let i = 0; i < 10; i++) {
            await sleep(200); // 每次等 200ms

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

                console.log("找到 Clone 选项，点击!", clickable);
                simulateClick(clickable, 'rgba(0, 255, 0, 0.5)'); // 绿色高亮
                return true;
            }
        }

        return false;
    }

    // 3. 返回 Failed 列表页
    async function backToFailedTab() {
        console.log("正在返回 Failed 列表...");
        const tabs = Array.from(document.querySelectorAll('button[role="tab"], div[role="tab"]'));
        const failedTab = tabs.find(t => t.textContent.includes("Failed"));

        if (failedTab) {
            simulateClick(failedTab);
            return true;
        }
        return false;
    }

    // --- UI 拖拽 ---
    function makeDraggable(element) {
        let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
        const header = element.querySelector('#af3-header');
        header.onmousedown = dragMouseDown;
        function dragMouseDown(e) {
            e = e || window.event; e.preventDefault();
            const currentLeft = element.offsetLeft;
            const currentTop = element.offsetTop;
            element.style.left = currentLeft + "px";
            element.style.top = currentTop + "px";
            element.style.right = "auto";
            pos3 = e.clientX; pos4 = e.clientY;
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
            element.style.cursor = 'default';
        }
    }

    // --- UI ---
    function ensureUI() {
        if (document.getElementById(CONTAINER_ID)) return;
        const container = document.createElement('div');
        container.id = CONTAINER_ID;
        Object.assign(container.style, {
            position: 'fixed', top: '80px', right: '30px', zIndex: '2147483647',
            display: 'flex', flexDirection: 'column', gap: '10px',
            padding: '15px', backgroundColor: 'rgba(32, 33, 36, 0.95)',
            borderRadius: '12px', boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
            border: '1px solid #5f6368', minWidth: '220px', fontFamily: 'Roboto, sans-serif'
        });

        const header = document.createElement('div');
        header.id = 'af3-header';
        Object.assign(header.style, {
            textAlign: 'center', cursor: 'move', paddingBottom: '8px',
            borderBottom: '1px solid #444', fontWeight: 'bold', color: '#eee', fontSize: '14px'
        });
        header.textContent = '🤖 AF3 自动助手 V2.1';

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

        const footer = document.createElement('div');
        footer.id = 'af3-footer-msg';
        footer.textContent = '⚠️ 自动识别当前页面模式';
        Object.assign(footer.style, {
            fontSize: '11px', color: '#fdd835', textAlign: 'center', marginTop: '4px'
        });

        container.appendChild(header); container.appendChild(statusRow);
        container.appendChild(controls); container.appendChild(footer);
        document.body.appendChild(container);
        makeDraggable(container);
    }

    // --- 状态检测 & 模式判断 ---
    let currentMode = 'NONE';

    function checkSystemStatus() {
        const btn = document.getElementById('af3-v20-btn');
        const light = document.getElementById('af3-status-light');
        const text = document.getElementById('af3-status-text');
        const footer = document.getElementById('af3-footer-msg');

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

        const countInput = document.getElementById('af3-v20-count');
        const maxJobs = parseInt(countInput.value, 10) || 10;

        if (currentMode === 'DRAFT') {
            await runDraftSubmission(maxJobs);
        } else if (currentMode === 'FAILED') {
            await runFailedReprocessing(maxJobs);
        }
    }

    // --- 模式 A: 草稿提交 ---
    async function runDraftSubmission(maxJobs) {
        if (!confirm(`准备提交 ${maxJobs} 个草稿任务。确认？`)) return;
        setRunningState(true);
        try {
            for (let i = 1; i <= maxJobs; i++) {
                updateBtnText(`${i} / ${maxJobs}`);
                const rows = getRows();
                if (rows.length === 0) { alert("列表已空"); break; }
                const firstRowText = rows[0].textContent.trim();

                simulateClick(rows[0], 'rgba(0,0,255,0.2)');
                await sleep(500);

                const continueBtn = findButtonByText("Continue and preview job");
                if (continueBtn) {
                    simulateClick(continueBtn, 'rgba(0,255,0,0.3)');
                    await sleep(WAIT_FOR_MODAL);
                } else {
                    console.warn("未找到 Continue 按钮，跳过");
                    continue;
                }

                let confirmBtn = findButtonByText("Confirm and submit");
                if (!confirmBtn) {
                     if (document.body.innerText.includes("Daily quota")) throw new Error("配额已满");
                     console.warn("Confirm 未出现，重试下一轮");
                     continue;
                }
                simulateClick(confirmBtn, 'rgba(0,255,0,0.3)');

                updateBtnText(`Verifying...`);
                for (let retry = 0; retry < 60; retry++) {
                    await sleep(500);
                    confirmBtn = findButtonByText("Confirm and submit");
                    if (confirmBtn && retry % 3 === 0) simulateClick(confirmBtn);

                    const rowsNow = getRows();
                    if (rowsNow.length > 0 && rowsNow[0].textContent.trim() !== firstRowText) {
                        break;
                    }
                }
            }
        } catch (e) {
            alert(`停止: ${e.message}`);
        } finally {
            setRunningState(false);
        }
    }

    // --- 模式 B: 失败重跑 (修复版) ---
    async function runFailedReprocessing(maxJobs) {
        if (!confirm(`准备重跑 ${maxJobs} 个失败任务。\n\n⚠️ 注意：脚本将执行 Clone -> Submit -> 返回列表。\n请勿手动干扰页面跳转。`)) return;

        setRunningState(true);
        try {
            for (let i = 0; i < maxJobs; i++) {
                updateBtnText(`Job ${i + 1} / ${maxJobs}`);

                // 1. 确保在 Failed 页面
                await backToFailedTab();
                await sleep(1500);

                const rows = getRows();
                if (i >= rows.length) {
                    alert("已处理完当前页所有 Failed 任务！");
                    break;
                }
                const targetRow = rows[i];
                targetRow.scrollIntoView({behavior: "auto", block: "center"});

                // 2. 点击菜单 (3个点)
                const menuClicked = await clickMenuOnRow(targetRow);
                if (!menuClicked) {
                    console.warn(`第 ${i+1} 行找不到菜单按钮，跳过`);
                    continue;
                }
                // 等待菜单弹出，这里多给一点时间
                await sleep(800);

                // 3. 【核心修复】点击 Clone
                const cloneClicked = await clickCloneOption();
                if (!cloneClicked) {
                    console.warn(`第 ${i+1} 行未找到 Clone 选项 (超时)，尝试跳过`);
                    // 点击 body 关闭可能已打开的菜单
                    document.body.click();
                    await sleep(500);
                    continue;
                }

                // 4. 等待跳转
                updateBtnText("Cloning...");
                await sleep(WAIT_FOR_PAGE_LOAD);

                // 5. 点击 Continue
                let continueBtn = null;
                for(let w=0; w<15; w++) { // 7.5秒轮询
                    await sleep(500);
                    continueBtn = findButtonByText("Continue and preview job");
                    if(continueBtn) break;
                }

                if (!continueBtn) {
                    console.warn("Clone 后未找到 Continue 按钮，可能页面加载失败");
                    continue;
                }
                simulateClick(continueBtn);
                await sleep(WAIT_FOR_MODAL);

                // 6. 点击 Confirm
                let confirmBtn = findButtonByText("Confirm and submit");
                if (!confirmBtn) {
                     if (document.body.innerText.includes("Daily quota")) throw new Error("配额已满");
                     if (continueBtn) simulateClick(continueBtn); // 再次尝试点击continue
                     await sleep(1000);
                     confirmBtn = findButtonByText("Confirm and submit");
                     if (!confirmBtn) throw new Error("提交确认框未弹出");
                }
                simulateClick(confirmBtn);

                // 7. 提交后等待
                updateBtnText("Submitted...");
                await sleep(2500);
            }

        } catch (e) {
            alert(`重跑停止: ${e.message}`);
        } finally {
            setRunningState(false);
        }
    }

    // --- 辅助状态管理 ---
    function setRunningState(state) {
        isRunning = state;
        const btn = document.getElementById('af3-v20-btn');
        const input = document.getElementById('af3-v20-count');
        if (btn) {
            btn.disabled = state;
            if (!state) {
                btn.textContent = '🚀 启动';
                input.disabled = false;
                checkSystemStatus();
            } else {
                input.disabled = true;
            }
        }
    }

    function updateBtnText(text) {
        const btn = document.getElementById('af3-v20-btn');
        if (btn) btn.textContent = text;
    }

    setInterval(ensureUI, 1000);
    setInterval(checkSystemStatus, 500);
    ensureUI();
})();