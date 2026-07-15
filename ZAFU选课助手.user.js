// ==UserScript==
// @name         浙江农林大学(ZAFU)正方教务选课自动助手
// @namespace    http://tampermonkey.net/
// @version      3.1
// @description  针对ZAFU选课系统的多任务定时抢课助手。每行独立删除按钮、数据库可视化查看、本地持久化、运行日志记录、三备份检索、Tab自动切换。
// @author       Endotch Cat
// @match        *://jwxt.zafu.edu.cn/jwglxt/xsxk/*
// @noframes
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        unsafeWindow
// @license      GPL-3.0-only
// ==/UserScript==

(function () {
    'use strict';

    // 二重保险：如果 @noframes 因为油猴版本兼容性未生效，用DOM标记阻止第二个实例
    if (document.getElementById('xk-helper-panel')) {
        console.log("ZAFU选课助手：面板已存在，跳过重复初始化。");
        return;
    }

    // 注入全局悬浮框样式
    const style = document.createElement('style');
    style.innerHTML = `
        .xk-row { cursor: pointer; transition: background-color 0.2s; }
        .xk-row:hover td { background-color: #f1f3f5 !important; }
        .xk-row-selected td { background-color: #ffe8a1 !important; font-weight: bold; }
        .xk-row-del-btn {
            background: #dc3545; color: white; border: none; border-radius: 3px;
            cursor: pointer; font-size: 11px; padding: 1px 5px; font-weight: bold;
            line-height: 1.2; transition: background 0.2s;
        }
        .xk-row-del-btn:hover { background: #a71d2a; }
    `;
    document.head.appendChild(style);

    // 分类Tab映射配置
    const TAB_MAP = {
        '01': '主修课程',
        '58': '公共艺术',
        '26': '劳动教育',
        '10': '通识选修课',
        '15': '个性发展选修课',
        '16': '通识限选课'
    };

    // 1. 初始化队列数据
    let activeQueue = [];
    try {
        const stored = GM_getValue('xk_queue');
        if (stored) {
            activeQueue = JSON.parse(stored);
            // 自动修复老版本数据库中缺失 id 的历史遗留记录
            let hasRepaired = false;
            activeQueue.forEach((task, idx) => {
                if (!task.id) {
                    task.id = task.code || task.name || ('auto_' + idx + '_' + Date.now());
                    hasRepaired = true;
                }
            });
            if (hasRepaired) {
                GM_setValue('xk_queue', JSON.stringify(activeQueue));
                console.log("ZAFU选课助手：已自动修复老数据库记录的唯一ID标识！");
            }
        }
    } catch (e) {
        console.error("读取油猴本地存储失败", e);
    }

    let uiQueue = JSON.parse(JSON.stringify(activeQueue));
    let selectedTaskId = null;

    // 暴露调试接口到全局
    const getQueueDebug = function () {
        try {
            const q = GM_getValue('xk_queue');
            const parsed = q ? JSON.parse(q) : [];
            console.log("📦 当前数据库任务队列：", parsed);
            console.table(parsed);
            return parsed;
        } catch (e) { console.error("读取数据库出错:", e); }
    };
    const getLogsDebug = function () {
        try {
            const l = GM_getValue('xk_logs');
            const parsed = l ? JSON.parse(l) : [];
            console.log("📋 历史运行日志：", parsed);
            return parsed;
        } catch (e) { console.error("读取日志出错:", e); }
    };
    window.showXkQueue = getQueueDebug;
    window.showXkLogs = getLogsDebug;
    if (typeof unsafeWindow !== 'undefined') {
        unsafeWindow.showXkQueue = getQueueDebug;
        unsafeWindow.showXkLogs = getLogsDebug;
    }

    // 2. 创建悬浮控制面板
    const panel = document.createElement('div');
    panel.id = 'xk-helper-panel';
    panel.style.cssText = 'position:fixed;top:60px;right:20px;z-index:99999;background:#fff;border:2px solid #e0a800;border-radius:8px;padding:12px;box-shadow:0 6px 25px rgba(0,0,0,0.3);width:400px;font-family:Microsoft YaHei,sans-serif;font-size:12px;';

    panel.innerHTML = `
        <div style="font-weight:bold;border-bottom:1px solid #ddd;padding-bottom:5px;margin-bottom:8px;color:#d39e00;display:flex;justify-content:space-between;align-items:center;">
            <span>ZAFU 抢课本地沙盒提交版 v3.1</span>
            <span id="xk-close-btn" style="cursor:pointer;color:#999;font-size:16px;">✕</span>
        </div>
        <div style="margin-bottom:6px;color:#555;display:flex;justify-content:space-between;font-size:11px;background:#e9ecef;padding:3px 6px;border-radius:4px;">
            <span>本地北京时间:</span>
            <span id="xk-clock" style="font-family:monospace;font-weight:bold;color:#007bff;font-size:12px;">00:00:00</span>
        </div>
        
        <div style="max-height:150px;overflow-y:auto;border:1px solid #ccc;border-radius:4px;margin-bottom:4px;background:#fff;">
            <table id="xk-queue-table" style="width:100%;border-collapse:collapse;font-size:11px;text-align:left;">
                <thead>
                    <tr style="background:#f1f3f5;border-bottom:1px solid #ddd;">
                        <th style="padding:4px;width:18px;">#</th>
                        <th style="padding:4px;">课号</th>
                        <th style="padding:4px;">课名</th>
                        <th style="padding:4px;">分类</th>
                        <th style="padding:4px;">时间</th>
                        <th style="padding:4px;">状态</th>
                        <th style="padding:4px;text-align:center;">存盘</th>
                    </tr>
                </thead>
                <tbody id="xk-queue-tbody"></tbody>
            </table>
        </div>
        <div style="display:flex;gap:4px;margin-bottom:8px;align-items:center;">
            <span style="font-size:11px;color:#666;white-space:nowrap;">输入行号:</span>
            <input type="number" id="xk-del-row-num" min="1" value="1" style="width:40px;padding:2px;font-size:11px;border:1px solid #ccc;border-radius:3px;text-align:center;">
            <button id="xk-del-by-num-btn" style="padding:3px 8px;background:#dc3545;color:white;border:none;border-radius:3px;cursor:pointer;font-size:11px;font-weight:bold;">🗑️ 删除该行</button>
            <span style="font-size:10px;color:#999;">（对应上方表格 # 列的序号）</span>
        </div>

        <div style="background:#f8f9fa;padding:6px;border-radius:4px;border:1px solid #e9ecef;margin-bottom:6px;">
            <div style="display:flex;gap:4px;margin-bottom:4px;">
                <input type="text" id="xk-new-code" placeholder="精确课号(C1201009-02)" style="flex:1;padding:3px;font-size:11px;border:1px solid #ccc;border-radius:3px;">
                <input type="text" id="xk-new-name" placeholder="模糊课名(葡萄酒)" style="flex:1;padding:3px;font-size:11px;border:1px solid #ccc;border-radius:3px;">
            </div>
            <div style="display:flex;gap:4px;align-items:center;margin-bottom:4px;">
                <select id="xk-new-tab" style="padding:2px;font-size:11px;border:1px solid #ccc;border-radius:3px;flex:1.2;">
                    <option value="10">通识选修课</option>
                    <option value="16">通识限选课</option>
                    <option value="15">个性发展选修课</option>
                    <option value="01">主修课程</option>
                    <option value="26">劳动教育</option>
                    <option value="58">公共艺术</option>
                </select>
                <span style="font-size:11px;color:#666;">时间:</span>
                <input type="text" id="xk-new-time" value="09:00:00" style="width:60px;padding:2px;font-size:11px;border:1px solid #ccc;border-radius:3px;font-family:monospace;text-align:center;">
            </div>
            <button id="xk-add-btn" style="width:100%;padding:4px;background:#007bff;color:white;border:none;border-radius:3px;font-weight:bold;cursor:pointer;font-size:11px;">+ 添加到上方列表</button>
        </div>

        <div style="color:#856404;background-color:#fff3cd;border:1px solid #ffeeba;padding:7px 10px;border-radius:4px;font-size:10.5px;margin-bottom:8px;line-height:1.45;">
            💡 <b>使用提醒</b>：<br>
            1️⃣ <b>防错</b>：课号（数字/字母）或课名（汉字）<b>前后及中间千万不能有空格</b>！<br>
            2️⃣ 添加任务后必须点【💾 保存并提交】，存盘列变 ✅ 后刷新才不丢。<br>
            3️⃣ 必须点击【启动挂机监控任务】机器才会运转，否则任务不会自动触发！<br>
            4️⃣ 每门课的【分类】必须和网页选项卡一致，时间格式 HH:MM:SS（如 09:00:00）。<br>
            5️⃣ <b>删除单项</b>：在行号输入框输入要删除的行号（# 列数字），点【🗑️ 删除该行】即时删除并存盘！
        </div>

        <div style="display:flex;gap:4px;margin-bottom:8px;">
            <button id="xk-submit-btn" style="flex:1.5;padding:5px;background:#28a745;color:white;border:none;border-radius:4px;font-weight:bold;cursor:pointer;font-size:11px;box-shadow:0 2px 4px rgba(40,167,69,0.3);">💾 保存并提交</button>
            <button id="xk-reset-btn" style="flex:1;padding:5px;background:#ffc107;color:#212529;border:none;border-radius:4px;cursor:pointer;font-size:11px;font-weight:bold;">重置状态</button>
            <button id="xk-clear-btn" style="flex:1;padding:5px;background:#343a40;color:white;border:none;border-radius:4px;cursor:pointer;font-size:11px;font-weight:bold;">清空队列</button>
            <button id="xk-view-db-btn" style="flex:1;padding:5px;background:#6610f2;color:white;border:none;border-radius:4px;cursor:pointer;font-size:11px;font-weight:bold;">🔍 查看数据库</button>
        </div>

        <div style="display:flex;gap:6px;margin-bottom:8px;">
            <button id="xk-export-btn" style="flex:1;padding:4px;background:#6f42c1;color:white;border:none;border-radius:4px;cursor:pointer;font-size:11px;font-weight:bold;">📥 导出运行日志</button>
            <button id="xk-clear-log-btn" style="flex:0.6;padding:4px;background:#17a2b8;color:white;border:none;border-radius:4px;cursor:pointer;font-size:11px;font-weight:bold;">🗑️ 清空日志</button>
        </div>

        <div style="margin-bottom:8px;display:flex;align-items:center;">
            <input type="checkbox" id="xk-auto-reload" checked style="margin-right:4px;cursor:pointer;">
            <label for="xk-auto-reload" style="font-weight:bold;color:#c82333;cursor:pointer;font-size:11px;">网页卡死 6秒自动重载</label>
        </div>

        <div style="display:flex;gap:6px;margin-bottom:6px;">
            <button id="xk-start-btn" style="flex:1;padding:7px;background-color:#17a2b8;color:white;border:none;border-radius:4px;cursor:pointer;font-weight:bold;font-size:12px;box-shadow:0 2px 4px rgba(23,162,184,0.3);">启动挂机监控任务</button>
            <button id="xk-stop-btn" style="flex:1;padding:7px;background-color:#6c757d;color:white;border:none;border-radius:4px;cursor:pointer;font-weight:bold;font-size:12px;" disabled>停止</button>
        </div>
        <div id="xk-status" style="padding:6px;background:#f8f9fa;border-radius:4px;font-size:11px;color:#333;max-height:90px;overflow-y:auto;border:1px solid #eee;line-height:1.4;">
            状态: 就绪。请输入精确课号和模糊中文名后添加。
        </div>

        <!-- 数据库查看弹窗（默认隐藏） -->
        <div id="xk-db-viewer" style="display:none;position:absolute;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.85);border-radius:8px;padding:15px;z-index:100;overflow-y:auto;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                <span style="color:#ffc107;font-weight:bold;font-size:13px;">🔍 油猴数据库原始内容</span>
                <span id="xk-db-close" style="cursor:pointer;color:#ff6b6b;font-size:18px;font-weight:bold;">✕</span>
            </div>
            <pre id="xk-db-content" style="color:#0f0;background:#111;padding:10px;border-radius:4px;font-size:11px;white-space:pre-wrap;word-break:break-all;max-height:400px;overflow-y:auto;font-family:Consolas,monospace;"></pre>
        </div>
    `;
    document.body.appendChild(panel);

    // 控制变量
    let mainLoopInterval = null;
    let clockInterval = null;
    let logHistory = [];
    let lastResponseTime = Date.now();
    let isMonitoring = false;
    let searchStep = 0;

    function cleanText(str) {
        return (str || '').toString().toUpperCase().replace(/\s+/g, '');
    }

    function isTaskSavedInDB(task) {
        const matched = activeQueue.find(t => t.id === task.id);
        if (!matched) return false;
        return matched.code === task.code &&
            matched.name === task.name &&
            matched.tab === task.tab &&
            matched.time === task.time;
    }

    function saveQueueToDB() {
        try {
            GM_setValue('xk_queue', JSON.stringify(activeQueue));
        } catch (e) {
            console.error("保存队列到本地失败", e);
        }
    }

    function writeLogToDB(msg) {
        const timeLocal = new Date().toLocaleTimeString();
        const timeISO = new Date().toISOString();
        const formatted = `[${timeLocal}] ${msg}`;

        logHistory.unshift(formatted);
        if (logHistory.length > 25) logHistory.pop();
        const statusElem = document.getElementById('xk-status');
        if (statusElem) statusElem.innerHTML = logHistory.join('<br>');

        try {
            let persistentLogs = [];
            const storedLogs = GM_getValue('xk_logs');
            if (storedLogs) {
                persistentLogs = JSON.parse(storedLogs);
            }
            persistentLogs.push(`[${timeISO}] ${msg}`);
            if (persistentLogs.length > 1500) {
                persistentLogs.shift();
            }
            GM_setValue('xk_logs', JSON.stringify(persistentLogs));
        } catch (e) {
            console.error("写入持久化日志发生错误", e);
        }
    }

    // ====== 核心改进：每行独立删除按钮，彻底告别"选中再删"的不可靠流程 ======
    function deleteTaskById(taskId) {
        const toDelete = uiQueue.find(t => t.id === taskId);
        const displayName = toDelete ? (toDelete.name || toDelete.code || taskId) : taskId;

        // 从草稿队列中移除
        uiQueue = uiQueue.filter(t => t.id !== taskId);
        // 同步到生效队列
        activeQueue = JSON.parse(JSON.stringify(uiQueue));
        // 立即写入数据库
        saveQueueToDB();
        // 清空选中状态
        selectedTaskId = null;
        // 重新渲染界面
        renderQueue();

        writeLogToDB(`🗑️ 已删除 [${displayName}] 并即时同步至数据库。当前剩余 ${uiQueue.length} 条任务。`);
    }

    function renderQueue() {
        const tbody = document.getElementById('xk-queue-tbody');
        tbody.innerHTML = '';
        if (uiQueue.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:#999;padding:8px;">列表为空，请先添加任务</td></tr>`;
            return;
        }
        uiQueue.forEach((task, index) => {
            const rowNum = index + 1;
            const tr = document.createElement('tr');
            tr.className = 'xk-row';
            tr.setAttribute('data-id', task.id);
            tr.style.borderBottom = '1px solid #eee';

            let statusColor = '#666';
            if (task.status === '已成功') statusColor = '#28a745';
            else if (task.status === '抢课中') statusColor = '#dc3545';
            else if (task.status === '正在切类') statusColor = '#17a2b8';
            else if (task.status === '备用方案') statusColor = '#e0a800';

            const savedStateHTML = isTaskSavedInDB(task)
                ? `<span style="color:#28a745;font-size:14px;" title="已保存至数据库">✅</span>`
                : `<span style="color:#e0a800;font-size:14px;" title="未保存，请点保存并提交">⏳</span>`;

            tr.innerHTML = `
                <td style="padding:5px 4px;font-weight:bold;color:#007bff;text-align:center;font-size:11px;">${rowNum}</td>
                <td style="padding:5px 4px;font-family:monospace;font-size:10px;" title="${task.code || ''}">${task.code || '-'}</td>
                <td style="padding:5px 4px;font-weight:bold;max-width:70px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${task.name}">${task.name || '-'}</td>
                <td style="padding:5px 4px;color:#666;font-size:10px;">${TAB_MAP[task.tab] || task.tab}</td>
                <td style="padding:5px 4px;font-family:monospace;">${task.time}</td>
                <td style="padding:5px 4px;color:${statusColor};font-weight:bold;">${task.status}</td>
                <td style="padding:5px 4px;text-align:center;">${savedStateHTML}</td>
            `;

            tbody.appendChild(tr);
        });
    }
    // 按行号删除（保证与"清空队列"使用完全相同的按钮绑定机制，所以一定能用）
    document.getElementById('xk-del-by-num-btn').addEventListener('click', () => {
        const rowNumInput = document.getElementById('xk-del-row-num');
        const rowNum = parseInt(rowNumInput.value, 10);

        if (isNaN(rowNum) || rowNum < 1 || rowNum > uiQueue.length) {
            alert('行号无效！请输入上方表格 # 列中的数字（1 到 ' + uiQueue.length + '）。');
            return;
        }

        const targetIndex = rowNum - 1;
        const targetTask = uiQueue[targetIndex];
        const displayName = targetTask ? (targetTask.name || targetTask.code || '未知') : '未知';

        // 直接按数组下标精确删除，不依赖任何ID匹配
        uiQueue.splice(targetIndex, 1);
        activeQueue = JSON.parse(JSON.stringify(uiQueue));
        saveQueueToDB();
        selectedTaskId = null;
        renderQueue();

        // 重置输入框
        rowNumInput.value = '1';

        writeLogToDB(`🗑️ 已删除第 ${rowNum} 行 [${displayName}] 并即时同步至数据库。剩余 ${uiQueue.length} 条。`);
    });

    // 添加任务
    document.getElementById('xk-add-btn').addEventListener('click', () => {
        const code = document.getElementById('xk-new-code').value.trim();
        const name = document.getElementById('xk-new-name').value.trim();
        const tab = document.getElementById('xk-new-tab').value;
        const time = document.getElementById('xk-new-time').value.trim();

        if (!code && !name) {
            alert('精确课号与模糊课名至少需要填写一个！');
            return;
        }
        if (!/^\d{2}:\d{2}:\d{2}$/.test(time)) {
            alert('时间格式必须为 HH:MM:SS，如 09:00:00');
            return;
        }

        const newTask = {
            id: (code || name) + '_' + Date.now(),
            code: code,
            name: name,
            tab: tab,
            time: time,
            status: '等待中'
        };
        uiQueue.push(newTask);
        renderQueue();

        document.getElementById('xk-new-code').value = '';
        document.getElementById('xk-new-name').value = '';
        writeLogToDB(`已添加草稿：[${name || code}]，请点【💾 保存并提交】存盘！`);
    });

    // 保存并提交
    document.getElementById('xk-submit-btn').addEventListener('click', () => {
        activeQueue = JSON.parse(JSON.stringify(uiQueue));
        try {
            saveQueueToDB();
            renderQueue();
            writeLogToDB('💾 成功！任务已写入本地数据库，刷新不丢失！');
        } catch (e) {
            writeLogToDB('❌ 写入数据库失败！');
            console.error(e);
        }
    });

    // 🔍 查看数据库原始内容
    document.getElementById('xk-view-db-btn').addEventListener('click', () => {
        const viewer = document.getElementById('xk-db-viewer');
        const content = document.getElementById('xk-db-content');
        try {
            const rawQueue = GM_getValue('xk_queue');
            const parsed = rawQueue ? JSON.parse(rawQueue) : [];
            let display = `=== xk_queue (任务队列，共 ${parsed.length} 条) ===\n\n`;
            if (parsed.length === 0) {
                display += '(空)\n';
            } else {
                parsed.forEach((item, i) => {
                    display += `--- 第 ${i + 1} 条 ---\n`;
                    display += `  id:     ${item.id || '(无)'}\n`;
                    display += `  课号:   ${item.code || '(无)'}\n`;
                    display += `  课名:   ${item.name || '(无)'}\n`;
                    display += `  分类:   ${TAB_MAP[item.tab] || item.tab || '(无)'}\n`;
                    display += `  时间:   ${item.time || '(无)'}\n`;
                    display += `  状态:   ${item.status || '(无)'}\n\n`;
                });
            }
            display += '\n=== 原始JSON ===\n' + JSON.stringify(parsed, null, 2);
            content.textContent = display;
        } catch (e) {
            content.textContent = '读取数据库出错: ' + e.message;
        }
        viewer.style.display = 'block';
    });

    document.getElementById('xk-db-close').addEventListener('click', () => {
        document.getElementById('xk-db-viewer').style.display = 'none';
    });

    // 导出日志
    document.getElementById('xk-export-btn').addEventListener('click', () => {
        try {
            const storedLogs = GM_getValue('xk_logs');
            let logs = storedLogs ? JSON.parse(storedLogs) : [];
            if (logs.length === 0) {
                alert('当前未记录到任何日志！');
                return;
            }
            const text = logs.join('\n');
            const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `ZAFU选课日志_${new Date().toISOString().slice(0, 10)}.txt`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (e) {
            alert('导出失败');
            console.error(e);
        }
    });

    // 清空日志
    document.getElementById('xk-clear-log-btn').addEventListener('click', () => {
        if (confirm('确认清空所有历史日志？')) {
            GM_setValue('xk_logs', JSON.stringify([]));
            logHistory = [];
            const statusElem = document.getElementById('xk-status');
            if (statusElem) statusElem.innerHTML = '日志已清空。';
        }
    });

    // 清空队列
    document.getElementById('xk-clear-btn').addEventListener('click', () => {
        if (confirm('确认清空全部任务？此操作不可撤销！')) {
            uiQueue = [];
            activeQueue = [];
            saveQueueToDB();
            selectedTaskId = null;
            renderQueue();
            writeLogToDB('已清空全部任务及数据库。');
        }
    });

    // 重置状态
    document.getElementById('xk-reset-btn').addEventListener('click', () => {
        uiQueue.forEach(t => { t.status = '等待中'; });
        activeQueue = JSON.parse(JSON.stringify(uiQueue));
        saveQueueToDB();
        renderQueue();
        writeLogToDB('所有任务状态已重置为"等待中"。');
    });

    // 时钟
    function updateClock() {
        const now = new Date();
        const hrs = String(now.getHours()).padStart(2, '0');
        const mins = String(now.getMinutes()).padStart(2, '0');
        const secs = String(now.getSeconds()).padStart(2, '0');
        const clockElem = document.getElementById('xk-clock');
        if (clockElem) clockElem.innerText = `${hrs}:${mins}:${secs}`;
        return `${hrs}:${mins}:${secs}`;
    }
    clockInterval = setInterval(updateClock, 1000);
    updateClock();

    // 关闭面板
    document.getElementById('xk-close-btn').addEventListener('click', () => {
        panel.style.display = 'none';
    });

    // 自动确认弹窗（仅在监控模式下被调用）
    function autoConfirmModals() {
        const okButtons = document.querySelectorAll(
            '.modal-footer .btn-primary, .bootbox-accept, .layui-layer-btn0, .ajs-button.ajs-ok, #btn_confirm, .modal-footer button[data-bb-handler="confirm"]'
        );
        okButtons.forEach(btn => {
            if (btn.style.display !== 'none' && !btn.disabled) {
                btn.click();
                writeLogToDB('已自动确认系统弹窗');
            }
        });
    }

    // 核心调度逻辑
    function mainScheduleLoop() {
        const currentTime = updateClock();
        autoConfirmModals();

        const isRunSession = sessionStorage.getItem('xk_queue_running') === 'true';
        if (!isRunSession) {
            const triggerTask = activeQueue.find(t => t.status !== '已成功' && currentTime >= t.time);
            if (triggerTask) {
                writeLogToDB(`⚡ 到达定时时间 [${triggerTask.time}]！刷新页面激活选课...`);
                sessionStorage.setItem('xk_queue_running', 'true');
                window.location.reload();
                return;
            }
            return;
        }

        const activeTask = activeQueue.find(t => t.status !== '已成功' && currentTime >= t.time);
        if (!activeTask) {
            writeLogToDB('🎉 所有任务已完成！');
            sessionStorage.removeItem('xk_queue_running');
            return;
        }

        if (activeTask.status !== '抢课中' && activeTask.status !== '正在切类' && activeTask.status !== '备用方案') {
            activeTask.status = '抢课中';
            const uiT = uiQueue.find(t => t.id === activeTask.id);
            if (uiT) uiT.status = '抢课中';
            renderQueue();
        }

        // 自动切换Tab
        const targetTabId = `tab_kklx_${activeTask.tab}`;
        const tabLink = document.querySelector(`a[id^="${targetTabId}"]`);
        if (tabLink) {
            const parentLi = tabLink.parentElement;
            if (parentLi && !parentLi.classList.contains('active')) {
                writeLogToDB(`🔄 切换分类 ➔ [${TAB_MAP[activeTask.tab]}]...`);
                activeTask.status = '正在切类';
                const uiT = uiQueue.find(t => t.id === activeTask.id);
                if (uiT) uiT.status = '正在切类';
                renderQueue();
                tabLink.click();
                searchStep = 0;
                return;
            }
        }

        // 三备份检索逻辑
        let currentSearchKey = "";
        const searchInput = document.querySelector('input[name="searchInput"]');
        const rows = document.querySelectorAll('table tbody tr, .table tbody tr, tr.body_tr');
        const tableBody = document.querySelector('table tbody, .table tbody');
        const hasRows = tableBody && tableBody.querySelectorAll('tr').length > 0;
        const hasInputted = searchInput && cleanText(searchInput.value) !== "";
        const isSearchFailed = hasInputted && !hasRows;

        if (isSearchFailed) {
            if (searchStep === 0 && activeTask.code) {
                searchStep = 1;
                writeLogToDB(`⚠️ 课号 [${activeTask.code}] 未找到，尝试模糊课名 [${activeTask.name}]...`);
                activeTask.status = '备用方案';
                const uiT = uiQueue.find(t => t.id === activeTask.id);
                if (uiT) uiT.status = '备用方案';
                renderQueue();
            } else if (searchStep === 1 || (searchStep === 0 && !activeTask.code)) {
                const rawName = activeTask.name || "";
                const suffixMatch = rawName.match(/^(.*?)[a-zA-Z]$/);
                if (suffixMatch && suffixMatch[1]) {
                    searchStep = 2;
                    writeLogToDB(`⚠️ 课名 [${rawName}] 未找到，去尾缀 [${suffixMatch[1]}] 搜索...`);
                }
            }
        }

        if (searchStep === 0 && activeTask.code) {
            currentSearchKey = activeTask.code;
        } else if (searchStep === 2) {
            const suffixMatch = (activeTask.name || "").match(/^(.*?)[a-zA-Z]$/);
            currentSearchKey = suffixMatch ? suffixMatch[1] : activeTask.name;
        } else {
            currentSearchKey = activeTask.name || activeTask.code;
        }

        if (searchInput) {
            const cleanInputVal = cleanText(searchInput.value);
            const cleanTargetVal = cleanText(currentSearchKey);
            if (cleanInputVal !== cleanTargetVal) {
                searchInput.value = currentSearchKey.trim();
                searchInput.dispatchEvent(new Event('input', { bubbles: true }));
                searchInput.dispatchEvent(new Event('change', { bubbles: true }));
                writeLogToDB("搜索: " + currentSearchKey.trim());
            }
        }

        // 自动选课
        let matchedRows = [];
        const cleanSearchKey = cleanText(currentSearchKey);
        for (let row of rows) {
            if (cleanText(row.innerText).includes(cleanSearchKey)) {
                matchedRows.push(row);
            }
        }

        if (matchedRows.length > 0) {
            const matchedRow = matchedRows[0];
            const actionTd = matchedRow.querySelector('.an, td:last-child');
            if (actionTd) {
                const clickables = actionTd.querySelectorAll('button, a, span, font');
                for (let elem of clickables) {
                    const elemText = (elem.innerText || '').trim();
                    if (elemText.includes('选课')) {
                        writeLogToDB(`🚀 点击【${activeTask.name || activeTask.code}】选课按钮！`);
                        elem.click();
                        lastResponseTime = Date.now();
                        break;
                    } else if (elemText.includes('退选')) {
                        writeLogToDB(`🎉 【${activeTask.name || activeTask.code}】已选上！`);
                        activeTask.status = '已成功';
                        const uiT = uiQueue.find(t => t.id === activeTask.id);
                        if (uiT) uiT.status = '已成功';
                        renderQueue();
                        try { saveQueueToDB(); } catch (e) { }
                        searchStep = 0;
                        break;
                    } else if (elemText.includes('禁选')) {
                        writeLogToDB(`【${activeTask.name || activeTask.code}】禁选中，等待...`);
                        break;
                    }
                }
            }
        }

        // 触发查询刷新
        const queryBtn = document.querySelector('button[name="query"], #cx, .btn-query');
        if (queryBtn) {
            queryBtn.click();
        }

        // 防卡死
        const autoReloadChecked = document.getElementById('xk-auto-reload');
        if (autoReloadChecked && autoReloadChecked.checked) {
            if (Date.now() - lastResponseTime > 6000) {
                writeLogToDB('⚠️ 网页可能假死，强制重载...');
                sessionStorage.setItem('xk_queue_running', 'true');
                window.location.reload();
            }
        }
    }

    // 启动监控
    function startMonitoring() {
        if (activeQueue.length === 0) {
            alert('队列为空！请先添加任务并点【保存并提交】！');
            return;
        }
        isMonitoring = true;
        document.getElementById('xk-start-btn').disabled = true;
        document.getElementById('xk-stop-btn').disabled = false;

        // 记录监控状态，保证刷新页面后也能自动恢复
        sessionStorage.setItem('xk_is_monitoring', 'true');

        // 监控期间覆盖 alert/confirm 避免弹窗阻塞自动操作
        window.alert = function (msg) { writeLogToDB('拦截提示: ' + msg); return true; };
        window.confirm = function (msg) { writeLogToDB('拦截确认: ' + msg); return true; };

        logHistory = [];
        writeLogToDB('🎮 监控已启动！');

        const isRunSession = sessionStorage.getItem('xk_queue_running') === 'true';
        const interval = isRunSession ? 250 : 1000;
        lastResponseTime = Date.now();
        mainLoopInterval = setInterval(mainScheduleLoop, interval);
        writeLogToDB(`模式：${isRunSession ? '⚡ 高频抢选 (250ms)' : '⏰ 定时等待'}`);
    }

    // 停止监控
    function stopMonitoring() {
        isMonitoring = false;
        if (mainLoopInterval) {
            clearInterval(mainLoopInterval);
            mainLoopInterval = null;
        }
        document.getElementById('xk-start-btn').disabled = false;
        document.getElementById('xk-stop-btn').disabled = true;

        sessionStorage.removeItem('xk_is_monitoring');
        sessionStorage.removeItem('xk_queue_running');
        activeQueue.forEach(t => {
            if (t.status !== '已成功') t.status = '等待中';
        });
        uiQueue = JSON.parse(JSON.stringify(activeQueue));
        saveQueueToDB();
        renderQueue();
        writeLogToDB('监控已手动停止。');
    }

    document.getElementById('xk-start-btn').addEventListener('click', startMonitoring);
    document.getElementById('xk-stop-btn').addEventListener('click', stopMonitoring);

    // 初始化
    window.addEventListener('load', () => {
        renderQueue();
        const isMon = sessionStorage.getItem('xk_is_monitoring');
        if (isMon === 'true' && activeQueue.length > 0) {
            const isRunSession = sessionStorage.getItem('xk_queue_running') === 'true';
            writeLogToDB(isRunSession ? '[重载恢复] 自动恢复高频抢课...' : '[重载恢复] 自动恢复定时等待...');
            startMonitoring();
        }
    });

})();
