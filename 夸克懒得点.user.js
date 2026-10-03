// ==UserScript==
// @name         夸克懒得点
// @namespace    https://greasyfork.org/users/158417
// @version      1.17
// @downloadURL  https://update.greasyfork.org/scripts/483069/%E5%A4%B8%E5%85%8B%E6%87%92%E5%BE%97%E7%82%B9.user.js
// @updateURL    https://update.greasyfork.org/scripts/483069/%E5%A4%B8%E5%85%8B%E6%87%92%E5%BE%97%E7%82%B9.meta.js
// @homepageURL  https://github.com/jiemo9527/quark-lazy
// @description  115/123/139/天翼/夸克/UC/迅雷/光鸭 RPC下载与复制Bash命令；分享来源红橙名单、日志回溯、WebDAV同步
// @author       JIEMO
// @match        *://pan.quark.cn/*
// @match        *://www.xn--wcv59z.com/*
// @match        *://drive.uc.cn/*
// @match        *://cloud.189.cn/*
// @match        *://pan.xunlei.com/*
// @match        *://yun.139.com/*
// @match        *://yun.123pan.cn/*
// @match        *://115.com/*
// @match        *://re0.me/*
// @match        *://*.re0.me/*
// @match        *://pan.baidu.com/*
// @match        *://yun.baidu.com/*
// @match        *://115cdn.com/s/*
// @match        *://*.115cdn.com/s/*
// @match        *://115.com/s/*
// @match        *://anxia.com/s/*
// @match        *://*.123pan.cn/*
// @match        *://*.123pan.com/*
// @match        *://*.123684.com/*
// @match        *://*.123865.com/*
// @match        *://*.123912.com/*
// @match        *://*.123952.com/*
// @match        *://www.guangyapan.com/*
// @icon         https://pan.quark.cn/favicon.ico
// @license      GPL-3.0 License
// @run-at       document-start
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_listValues
// @grant        GM_setClipboard
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
// @connect      *
// @connect      localhost
// @connect      127.0.0.1
// @connect      quark.cn
// @connect      uc.cn
// @connect      189.cn
// @connect      xunlei.com
// @connect      139.com
// @connect      123pan.cn
// @connect      123pan.com
// @connect      115.com
// @connect      115cdn.com
// @connect      baidu.com
// @connect      baidupcs.com
// @connect      guangyapan.com
// @connect      guangyacdn.com
// ==/UserScript==

(function () {
  'use strict';

  // 同一网盘的镜像/备用域名统一按主站处理（功能、记录、红橙名单都归到主站）。
  function canonicalHost(host) {
    const h = String(host || '').toLowerCase();
    if (h === 'yun.baidu.com') return 'pan.baidu.com';
    if (/(^|\.)(123pan\.(cn|com)|123684\.com|123865\.com|123912\.com|123952\.com)$/.test(h)) return 'yun.123pan.cn';
    return h;
  }
  const SITE_HOST = canonicalHost(location.hostname);

  const STORAGE_KEY = 'blocked_users_v2';
  const WARNING_KEY = 'warning_users_v2';
  const LOG_KEY = 'auto_save_logs';
  const SYNC_AUDIT_KEY = 'sync_audit_logs';
  const WEBDAV_CONF_KEY = 'webdav_config';
  const AUTO_SAVE_ENABLED_KEY = 'auto_save_enabled';
  const FEATURE_OPTIONS_KEY = 'qk_feature_options';
  const featureEnabled = (key) => {
    const value = GM_getValue(FEATURE_OPTIONS_KEY, {})[key];
    return key.endsWith('SelectAll') ? value === true : value !== false;
  };
  const setFeatureEnabled = (key, enabled) => GM_setValue(FEATURE_OPTIONS_KEY, { ...GM_getValue(FEATURE_OPTIONS_KEY, {}), [key]: Boolean(enabled) });
  const REDIRECT_PENDING_KEY = '__quark_lazy_pending_source_click';
  const LIST_LOAD_ALL = { uiPageSize: 50, apiMaxSize: 2000 };
  const TOOLBAR = {
    styleId: 'qk-lazy-toolbar-style',
    frontDeleteClass: 'qk-front-delete',
    hiddenNativeClass: 'qk-native-delete-hidden',
    narrowMaxWidth: 1100
  };

  const MAX_LOGS = 3000;
  const MAX_SYNC_AUDITS = 120;
  const CLOUD_FILE_NAME = 'quark_script_data.json';
  const DEFAULT_LIST = [];

  const FLOW = {
    pullWaitMs: 2500,
    selectorWaitMs: 15000,
    clickRetryGapMs: 600,
    flowRetry: 3,
    listAutoCheckDelayMs: 300,
    shareStartDelayMs: 350,
    routePollMs: 1000,
    redirectAfterSaveMs: 500
  };

  const SELECTORS = {
    shareContainer: ['.share-info-wrap'],
    authorName: ['.author-name'],
    fileTitle: ['.filename-text'],
    checkboxInput: ['.ant-checkbox-input', '.ant-checkbox-wrapper input[type="checkbox"]'],
    checkboxWrapper: ['.ant-checkbox-wrapper'],
    saveButton: ['.share-save', '.file-info_r', '.share-operate .share-save', '.share-footer .share-save'],
    confirmButton: ['.confirm-btn', '.ant-modal-confirm-btns .ant-btn-primary', '.ant-modal-footer .ant-btn-primary']
  };

  const LIST_PAGE_URL = 'https://pan.quark.cn/list#/list/all';

  const Runtime = {
    initialized: false,
    shareFlowRunning: false,
    shareFlowUrl: '',
    shareFlowDone: new Set(),
    lastUrl: location.href,
    routeHooksBound: false,
    routePollId: null,
    scheduleTimer: null,
    scheduleReason: '',
    pullDoneForUrl: new Set(),
    listFlowDone: new Set(),
    quarkStore: null,
    listLoadAllRunning: false,
    toolbarRaf: 0,
    siderAutoCollapsed: false
  };

  function getBlockedList() {
    return GM_getValue(STORAGE_KEY, DEFAULT_LIST);
  }

  function setBlockedList(list) {
    GM_setValue(STORAGE_KEY, list);
  }

  function getWarningList() {
    return GM_getValue(WARNING_KEY, DEFAULT_LIST);
  }

  function setWarningList(list) {
    GM_setValue(WARNING_KEY, list);
  }

  function getLogs() {
    return GM_getValue(LOG_KEY, []);
  }

  function getEntrySite(entry) {
    if (!entry) return 'pan.quark.cn';
    const origin = entry.site || entry.url;
    if (!origin) return 'pan.quark.cn';
    try { return canonicalHost(new URL(origin.includes('://') ? origin : `https://${origin}/`).hostname); }
    catch (error) { return 'pan.quark.cn'; }
  }
  function is115RelatedHost(host = SITE_HOST) {
    return ['115.com', '115cdn.com', 'anxia.com', 're0.me']
      .some((domain) => host === domain || host.endsWith('.' + domain));
  }
  function getSiteEntries(list, site = SITE_HOST) {
    return (Array.isArray(list) ? list : []).filter((entry) => getEntrySite(entry) === site);
  }

  // 日志分三类：save=保存记录，rpc=下载记录，失败记录单独存放（含直链/请求头，随 WebDAV 一起同步）。
  const RPC_FAILURE_KEY = 'rpc_failure_records_v1';
  const MAX_RPC_FAILURES = 500;
  // 失败记录的错误类型（旧记录没有该字段时按原因文字推断）。
  const RPC_FAILURE_TYPE_LABELS = {
    link: '取链失败', unreachable: 'RPC 连不上', timeout: 'RPC 超时', bad: 'RPC 响应异常', rejected: 'aria2 拒绝', skipped: '未发送'
  };
  function rpcFailureType(entry) {
    if (entry && RPC_FAILURE_TYPE_LABELS[entry.errorType]) return entry.errorType;
    const reason = String((entry && entry.reason) || '');
    if (/^取链失败/.test(reason)) return 'link';
    if (/超时/.test(reason)) return 'timeout';
    if (/无法连接|网络/.test(reason)) return 'unreachable';
    if (/拒绝/.test(reason)) return 'rejected';
    return 'bad';
  }
  const SITE_LABELS = {
    'pan.quark.cn': '夸克', 'drive.uc.cn': 'UC', '115.com': '115', 'pan.baidu.com': '百度', 'yun.139.com': '139',
    'cloud.189.cn': '天翼', 'pan.xunlei.com': '迅雷', 'yun.123pan.cn': '123', 'www.guangyapan.com': '光鸭', 're0.me': 'RE0 影巢'
  };
  function siteLabel(host) {
    return SITE_LABELS[host] || host || '未知';
  }
  function getLogKind(entry) {
    if (entry && entry.kind) return entry.kind;
    return entry && !entry.hash && /RPC 任务汇总|失败记录重试/.test(entry.title || '') ? 'rpc' : 'save';
  }
  function getRpcFailures() {
    const list = GM_getValue(RPC_FAILURE_KEY, []);
    return Array.isArray(list) ? list : [];
  }
  function setRpcFailures(list) {
    GM_setValue(RPC_FAILURE_KEY, (Array.isArray(list) ? list : []).slice(0, MAX_RPC_FAILURES));
  }

  // 发送记录标题：单个文件显示文件名；多个文件显示「第一个文件名 等 N 个文件」，完整清单放在 files 里（鼠标悬停可看）。
  function summarizeFileNames(names) {
    const list = (Array.isArray(names) ? names : []).filter(Boolean).map(String);
    if (!list.length) return '';
    return list.length === 1 ? list[0] : `${list[0]} 等 ${list.length} 个文件`;
  }
  function recordRpcLog(site, title, status, host, names) {
    const files = (Array.isArray(names) ? names : []).filter(Boolean).map(String);
    const logs = getLogs();
    logs.unshift({ kind: 'rpc', time: formatTime(new Date()), name: site, hash: '',
      title: files.length ? summarizeFileNames(files) : `${status}：${title}`, status, files: files.slice(0, 300),
      url: location.href, site: host || SITE_HOST });
    setLogs(logs.slice(0, MAX_LOGS));
    WebDAV.push();
  }

  function recordShareSaveLog(entry) {
    const logs = getLogs().filter((item) => !(getLogKind(item) === 'save' && item.url === entry.url));
    logs.unshift({ kind: 'save', time: formatTime(new Date()), hash: '', name: '', ...entry });
    setLogs(logs.slice(0, MAX_LOGS));
    WebDAV.push();
  }

  function playRpcResultSound() {
    try {
      const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextCtor) return;
      const audio = new AudioContextCtor();
      if (audio.state === 'suspended') audio.resume().catch(() => {});
      const start = audio.currentTime;
      // 失败提示：四个下行音，每个约 0.3 秒，总长约 1.3 秒（原来约 0.28 秒）。
      const notes = [440, 370, 294, 220];
      const step = 0.32;
      const hold = 0.3;
      notes.forEach((frequency, index) => {
        const oscillator = audio.createOscillator();
        const gain = audio.createGain();
        const at = start + index * step;
        const length = index === notes.length - 1 ? hold + 0.25 : hold;
        oscillator.type = 'triangle';
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0.001, at);
        gain.gain.linearRampToValueAtTime(0.8, at + 0.02);
        gain.gain.setValueAtTime(0.8, at + length * 0.6);
        gain.gain.exponentialRampToValueAtTime(0.001, at + length);
        oscillator.connect(gain);
        gain.connect(audio.destination);
        oscillator.start(at);
        oscillator.stop(at + length + 0.01);
      });
      setTimeout(() => audio.close().catch(() => {}), 2000);
    } catch (error) { console.warn('[夸克懒得点] 音效不可用:', error); }
  }

  function setLogs(list) {
    GM_setValue(LOG_KEY, list);
  }

  function getSyncAudits() {
    return GM_getValue(SYNC_AUDIT_KEY, []);
  }

  function setSyncAudits(list) {
    GM_setValue(SYNC_AUDIT_KEY, list);
  }

  function addSyncAudit(mode, status, detail) {
    const logs = getSyncAudits();
    logs.unshift({
      time: formatTime(new Date()),
      mode,
      status,
      detail: detail || ''
    });
    if (logs.length > MAX_SYNC_AUDITS) logs.length = MAX_SYNC_AUDITS;
    setSyncAudits(logs);
  }

  function isAutoSaveEnabled() {
    return GM_getValue(AUTO_SAVE_ENABLED_KEY, true);
  }

  function setAutoSaveEnabled(enabled) {
    GM_setValue(AUTO_SAVE_ENABLED_KEY, Boolean(enabled));
  }

  // 手动加载全部：不再持久化原自动开关，也不在页面初始化时改变夸克请求条数。
  // 点击时仅对当前「全部文件」目录调整 page size，然后从第一页重新拉取。
  function getPageWindow() {
    return typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  }

  function findQuarkStore() {
    const cached = Runtime.quarkStore;
    if (cached && typeof cached.getState === 'function') return cached;

    const doc = getPageWindow().document;
    const roots = [doc.getElementById('ice-container'), doc.getElementById('root'), doc.body && doc.body.firstElementChild];
    for (const el of roots) {
      if (!el) continue;
      const container = el._reactRootContainer;
      let fiber = container ? ((container._internalRoot || container).current) : null;
      if (!fiber) {
        const key = Object.keys(el).find((k) => k.startsWith('__reactContainer$') || k.startsWith('__reactFiber$'));
        fiber = key ? el[key] : null;
      }
      const queue = fiber ? [fiber] : [];
      for (let n = 0; queue.length && n < 5000; n++) {
        const node = queue.shift();
        const props = node && node.memoizedProps;
        const store = props && props.store;
        if (store && typeof store.getState === 'function' && store.dispatch && store.dispatch.file) {
          Runtime.quarkStore = store;
          return store;
        }
        if (node && node.child) queue.push(node.child);
        if (node && node.sibling) queue.push(node.sibling);
      }
    }
    return null;
  }

  function getCurrentListFid() {
    const hash = decodeURIComponent((getPageWindow().location.hash || '').replace(/^#/, ''));
    const match = hash.match(/^\/list\/all(?:\/(.*))?$/);
    if (!match) return null;
    if (!match[1]) return '0';
    const last = match[1].split('/').filter(Boolean).pop() || '';
    const fid = last.split('-')[0];
    return /^[0-9a-f]{32}$/i.test(fid) ? fid : null;
  }

  async function ensureListLoadAll() {
    const fid = getCurrentListFid();
    if (!fid) return false;

    const start = Date.now();
    let store = null;
    let all = null;
    while (Date.now() - start < FLOW.selectorWaitMs) {
      store = findQuarkStore();
      const fileState = store && store.getState().file;
      all = fileState && fileState.all;
      if (all && fileState.listType === 'all' && !all.loading && !all.bigLoading && Array.isArray(all.list)) break;
      all = null;
      await sleep(200);
    }
    if (!store || !all) return false;

    if (Runtime.listLoadAllRunning) return true;
    Runtime.listLoadAllRunning = true;
    try {
      const target = LIST_LOAD_ALL.apiMaxSize;
      if (all.size !== target) store.dispatch.file.changeListFile({ listType: 'all', size: target });
      console.log(`[夸克懒得点] 手动加载文件：当前 ${all.list.length}/${all.total}`);
      await store.dispatch.file.loadTableFiles({ listType: 'all', fid, page: 1 });
      const after = store.getState().file.all;
      console.log(`[夸克懒得点] 列表已加载 ${after.list.length}/${after.total}`);
      return true;
    } catch (error) {
      console.warn('[夸克懒得点] 手动加载全部失败:', error);
      return false;
    } finally {
      Runtime.listLoadAllRunning = false;
    }
  }

  async function restoreListPaging() {
    const fid = getCurrentListFid();
    const store = findQuarkStore();
    const all = store && store.getState().file && store.getState().file.all;
    if (!fid || !all || Runtime.listLoadAllRunning) return false;
    Runtime.listLoadAllRunning = true;
    try {
      store.dispatch.file.changeListFile({ listType: 'all', size: LIST_LOAD_ALL.uiPageSize });
      await store.dispatch.file.loadTableFiles({ listType: 'all', fid, page: 1 });
      return true;
    } catch (error) {
      console.warn('[夸克懒得点] 还原分页加载失败:', error);
      return false;
    } finally {
      Runtime.listLoadAllRunning = false;
    }
  }

  function isListLoadAllActive() {
    const store = findQuarkStore();
    const all = store && store.getState().file && store.getState().file.all;
    return Boolean(all && all.size === LIST_LOAD_ALL.apiMaxSize);
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function notifyToast(message, level, durationMs) {
    const type = level || 'info';
    const duration = durationMs || 4000;
    const tone = {
      info: { bg: '#2f54eb', fg: '#fff' },
      success: { bg: '#389e0d', fg: '#fff' },
      warning: { bg: '#fa8c16', fg: '#fff' },
      error: { bg: '#cf1322', fg: '#fff' }
    };
    const currentTone = tone[type] || tone.info;

    const toast = document.createElement('div');
    toast.innerText = message;
    toast.style.cssText = [
      'position:fixed',
      'top:20px',
      'left:50%',
      'transform:translateX(-50%)',
      `background:${currentTone.bg}`,
      `color:${currentTone.fg}`,
      'z-index:999999',
      'padding:10px 16px',
      'border-radius:999px',
      'font-size:13px',
      'font-weight:600',
      'box-shadow:0 4px 14px rgba(0,0,0,.22)',
      'max-width:80vw',
      'white-space:nowrap',
      'overflow:hidden',
      'text-overflow:ellipsis',
      'pointer-events:none',
      'opacity:0',
      'transition:opacity .2s ease'
    ].join(';');

    document.body.appendChild(toast);
    requestAnimationFrame(() => { toast.style.opacity = '1'; });
    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 250);
    }, duration);
  }

  // 替代原生 confirm：不再弹确认框，直接执行并以气泡提示本次操作。
  function qkNotice(message) {
    const text = String(message || '').replace(/[？?]\s*$/, '').replace(/\n+/g, ' ');
    notifyToast(text, 'info', 3500);
    return true;
  }

  function setPendingSourceClick() {
    try {
      sessionStorage.setItem(REDIRECT_PENDING_KEY, '1');
    } catch (error) {
      console.warn('[夸克懒得点] 无法写入跳转标记:', error);
    }
  }

  function hasPendingSourceClick() {
    try {
      return sessionStorage.getItem(REDIRECT_PENDING_KEY) === '1';
    } catch (error) {
      console.warn('[夸克懒得点] 无法读取跳转标记:', error);
      return false;
    }
  }

  function clearPendingSourceClick() {
    try {
      sessionStorage.removeItem(REDIRECT_PENDING_KEY);
    } catch (error) {
      console.warn('[夸克懒得点] 无法清理跳转标记:', error);
    }
  }

  function formatTime(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const h = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    const s = String(date.getSeconds()).padStart(2, '0');
    return `${y}-${m}-${d} ${h}:${min}:${s}`;
  }

  function computeStringHash(str) {
    if (!str) return 'null';
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash |= 0;
    }
    return 'u' + Math.abs(hash);
  }

  function queryFirst(selectors, root) {
    const host = root || document;
    for (const selector of selectors) {
      const node = host.querySelector(selector);
      if (node) return node;
    }
    return null;
  }

  function isVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function safeClick(el) {
    if (!el) return false;
    try {
      el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      el.click();
      return true;
    } catch (error) {
      console.warn('[夸克懒得点] 点击失败:', error);
      return false;
    }
  }

  function waitForElement(selectors, options) {
    const config = options || {};
    const timeoutMs = config.timeoutMs || FLOW.selectorWaitMs;
    const visibleOnly = Boolean(config.visibleOnly);

    return new Promise((resolve) => {
      const start = Date.now();
      let done = false;
      let observer = null;
      let timerId = null;

      const finish = (node) => {
        if (done) return;
        done = true;
        if (observer) observer.disconnect();
        if (timerId) clearInterval(timerId);
        resolve(node || null);
      };

      const pick = () => {
        for (const selector of selectors) {
          if (!visibleOnly) {
            const candidate = document.querySelector(selector);
            if (candidate) return candidate;
            continue;
          }

          const candidates = document.querySelectorAll(selector);
          for (const candidate of candidates) {
            if (isVisible(candidate)) return candidate;
          }
        }
        return null;
      };

      const immediate = pick();
      if (immediate) {
        finish(immediate);
        return;
      }

      observer = new MutationObserver(() => {
        const target = pick();
        if (target) finish(target);
      });

      observer.observe(document.documentElement || document.body, {
        childList: true,
        subtree: true,
        attributes: true
      });

      timerId = setInterval(() => {
        const target = pick();
        if (target) {
          finish(target);
          return;
        }

        if (Date.now() - start >= timeoutMs) {
          finish(null);
        }
      }, 200);
    });
  }

  function findClickableByText(texts) {
    const candidates = document.querySelectorAll('button, a, div[role="button"], span[role="button"], .ant-btn');
    for (const node of candidates) {
      const raw = (node.innerText || node.textContent || '').trim();
      if (!raw) continue;
      if (!isVisible(node)) continue;
      if (texts.some((t) => raw.includes(t))) {
        return node;
      }
    }
    return null;
  }

  function isEditableTarget(target) {
    if (!(target instanceof Element)) return false;
    return Boolean(target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]'));
  }

  function isUsableButton(button) {
    return Boolean(button) && !button.disabled && !button.classList.contains('ant-btn-disabled') && button.getAttribute('aria-disabled') !== 'true';
  }

  // 夸克原生"删除"在右侧 .btn-group 里，被本脚本隐藏后改由前置按钮代理，所以这里不要求可见。
  function findNativeDeleteButton() {
    const buttons = document.querySelectorAll('.btn-group button.ant-btn.btn-file');
    for (const button of buttons) {
      if (button.classList.contains(TOOLBAR.frontDeleteClass)) continue;
      if (!isUsableButton(button)) continue;
      if ((button.textContent || '').trim() === '删除') return button;
    }
    return null;
  }

  function findDeleteButton() {
    const native = findNativeDeleteButton();
    if (native) return native;
    const buttons = document.querySelectorAll('button.ant-btn.btn-file');
    for (const button of buttons) {
      if (button.classList.contains(TOOLBAR.frontDeleteClass)) continue;
      if (!isVisible(button) || !isUsableButton(button)) continue;
      if ((button.innerText || button.textContent || '').trim() === '删除') return button;
    }
    return null;
  }

  function injectToolbarStyle() {
    if (document.getElementById(TOOLBAR.styleId)) return;
    const style = document.createElement('style');
    style.id = TOOLBAR.styleId;
    style.textContent = `
      /* ===== 工具栏样式统一：以夸克原生 .btn-file 为基准 ===== */
      .section-header.list-header { height: auto !important; }
      .btn-operate { height: auto !important; align-items: center !important; }
      .btn-operate .btn-main > * { margin-right: 0 !important; }

      /* 保留上传，只隐藏添加备份。 */
      .btn-operate .btn-main .ant-btn.btn-file.btn-add-backup.btn-add-backup { display: none !important; }

      /* 保留第三方重命名按钮的定位容器和弹窗定位上下文。 */
      .btn-operate { display:flex !important; flex-wrap:wrap !important; justify-content:flex-start !important; gap:8px 10px; }
      .btn-operate .btn-main { display:flex !important; align-items:center; flex-wrap:wrap; gap:8px 10px; min-width:0; }
      .btn-operate .btn-main > .${TOOLBAR.frontDeleteClass} { order:-3; }
      .btn-operate .btn-main > .ant-dropdown-trigger:has(.upload-btn) { order:-2; }
      .btn-operate .btn-main > .btn-create-folder { order:-1; }
      .btn-operate > .btn-group { margin:0 !important; order:1; }
      .btn-operate > .btn-main { order:0; min-height:36px; }
      /* 预留两行高度（第一行：原生按钮+下载/分享等；第二行：RPC），避免打开/跳转时工具栏上下抖动。 */
      .btn-operate:has(> .btn-main) { min-height:88px; align-content:flex-start !important; }
      .btn-operate > .btn-group .ant-btn { height:36px !important; }
      .btn-operate .btn-main .ant-btn.btn-file,
      .btn-operate .btn-main .drive-rename-root > button,
      .btn-operate .btn-main .rpc-helper-btn,
      .btn-operate .btn-main .rpc-helper-select,
      .btn-operate .btn-main .pl-button-mode {
        box-sizing: border-box !important;
        height: 36px !important;
        line-height: 34px !important;
        padding: 0 12px !important;
        margin: 0 !important;
        border: 1px solid rgba(6, 10, 38, .1) !important;
        border-radius: 8px !important;
        background: #fff !important;
        color: #1f2026 !important;
        font-size: 12px !important;
        font-weight: 600 !important;
        box-shadow: 0 2px 0 rgba(0, 0, 0, .016) !important;
        display: inline-flex !important;
        align-items: center;
        justify-content: center;
        gap: 4px;
        white-space: nowrap;
        cursor: pointer;
        transition: color .2s, border-color .2s, background .2s;
      }
      .btn-operate .btn-main .rpc-helper-select { padding: 0 8px !important; cursor: default; }
      .btn-operate .btn-main .drive-rename-root > button span { font-size: 12px !important; font-weight: 600 !important; }
      .btn-operate .btn-main .drive-rename-root > button i { font-size: 14px !important; }
      .btn-operate .btn-main .ant-btn.btn-file:hover,
      .btn-operate .btn-main .drive-rename-root > button:hover,
      .btn-operate .btn-main .rpc-helper-btn:hover,
      .btn-operate .btn-main .pl-button-mode:hover {
        color: #0d53ff !important;
        border-color: #0d53ff !important;
        background: #fff !important;
      }
      .btn-operate .btn-main .ant-btn.btn-file.ant-btn-primary {
        background: #0d53ff !important;
        border-color: #0d53ff !important;
        color: #fff !important;
      }
      .btn-operate .btn-main .ant-btn.btn-file.ant-btn-primary:hover { background: #3d75ff !important; color: #fff !important; }
      .btn-operate .btn-main .pl-button { margin: 0 !important; }
      .btn-operate .btn-main :is(#qk-rpc-container, #rpc-helper-container) { margin: 0 !important; gap: 6px !important; padding: 0 !important; border: 0 !important; background: transparent !important; box-shadow: none !important; height: auto !important; }
      .btn-operate .btn-main .ant-dropdown-trigger { display: inline-flex !important; }
      .btn-operate .btn-main #qk-rpc-container .qk-rpc-setting-tab { color: #525fa8 !important; border-color: #c8cef5 !important; }
      .btn-operate .btn-main #qk-rpc-container .qk-rpc-server { color: #1667be !important; border-color: #bbd9fb !important; }
      .btn-operate .btn-main #qk-rpc-container .qk-rpc-path { color: #17804f !important; border-color: #b7e5cf !important; }
      .btn-operate .btn-main #qk-rpc-container .qk-rpc-send { color: #fff !important; border-color: #ed762b !important; background: #ed762b !important; }
      .btn-operate .btn-main #qk-rpc-container .qk-rpc-send:hover { background: #d95f18 !important; color: #fff !important; }
      .btn-operate .btn-main #qk-rpc-container .qk-rpc-send:disabled { background: #bd885f !important; border-color: #bd885f !important; }
      .qk-rpc-tabs { display:flex; flex-wrap:wrap; gap:10px; padding:14px 18px; background:#fff; border-bottom:1px solid #d7e0ea; }
      .qk-rpc-tabs button { min-height:40px; min-width:112px; padding:8px 18px; border:2px solid #bdc8d4; border-radius:9px; background:#f8fafc; color:#203043; cursor:pointer; font-size:14px; font-weight:700; line-height:1.3; box-shadow:0 2px 4px rgba(15,23,42,.10); }
      .qk-rpc-tabs button:hover { border-color:#b45309; color:#7c2d12; background:#fff7ed; }
      .qk-rpc-tabs button[aria-selected="true"] { background:#b45309; border-color:#92400e; color:#fff; box-shadow:0 3px 9px rgba(146,64,14,.28); }
      .qk-rpc-extra { padding:14px 16px; overflow:auto; max-height:65vh; }
      .qk-rpc-extra .qk-lazy-settings-grid { display:block !important; }
      .qk-rpc-extra .qk-lazy-settings-grid > * { margin-bottom:10px; }
      .qk-rpc-extra .qk-lazy-settings-grid > [hidden] { display:none !important; }
      .qk-lists-two-columns > * { min-width:0; }
      @media (max-width:720px) { .qk-lists-two-columns { grid-template-columns:1fr !important; } }
      .qk-rpc-115-row { display:flex;align-items:center;gap:10px;padding: 12px 24px;min-height:48px;box-sizing:border-box;border-bottom:1px solid #eef0f4; }
      .qk-rpc-115-row #qk-rpc-container { display:flex; gap:10px; align-items:center; flex-wrap:wrap; padding:0 !important; border:0 !important; box-shadow:none !important; background:transparent !important; }
      .qk-rpc-115-row :is(.rpc-helper-select,.rpc-helper-btn) { min-height:32px; }

      /* 前置删除按钮（代理原生删除） */
      .btn-operate .btn-main .ant-btn.btn-file.${TOOLBAR.frontDeleteClass} {
        color: #e5484d !important;
        border-color: rgba(229, 72, 77, .35) !important;
      }
      .btn-operate .btn-main .ant-btn.btn-file.${TOOLBAR.frontDeleteClass}:hover {
        color: #fff !important;
        background: #e5484d !important;
        border-color: #e5484d !important;
      }
      .btn-operate .btn-main .ant-btn.btn-file.${TOOLBAR.frontDeleteClass}[disabled] {
        color: rgba(6, 10, 38, .25) !important;
        border-color: rgba(6, 10, 38, .1) !important;
        background: #f7f8fa !important;
        cursor: not-allowed;
      }
      .${TOOLBAR.hiddenNativeClass} { display: none !important; }
      .file-list .ant-table-tbody tr.qk-hidden-system-folder { display: none !important; }
      .btn-group .ant-btn-group > .ant-btn:first-child:not(.${TOOLBAR.hiddenNativeClass}) { border-radius: 8px 0 0 8px !important; }

      /* ===== 窄屏 / 手机"桌面版"适配 ===== */
      @media (max-width: ${TOOLBAR.narrowMaxWidth}px) {
        .basic-v2-layout, .basic-v2-layout.ant-layout { min-width: 0 !important; }
        .section-main { min-width: 0 !important; width: 100% !important; }
        .section-header.list-header { padding-top: 8px; padding-bottom: 8px; }
        .btn-operate .btn-main .rpc-helper-select { max-width: 42vw; }
        .ant-table .td-file.td-file-sort { min-width: 0 !important; }
        .file-list-breadcrumb { height: auto !important; min-height: 40px; white-space: normal !important; }
        .file-list-breadcrumb * { white-space: normal !important; }
        .file-search-box { width: 180px !important; min-width: 0 !important; }
        [class*="SectionHeaderController--section-header-right"] { gap: 6px; flex-wrap: wrap; }
      }
      @media (max-width: ${TOOLBAR.narrowMaxWidth}px) and (pointer: coarse) {
        .ant-table-tbody > tr > td { padding-top: 12px !important; padding-bottom: 12px !important; }
        .ant-table .ant-checkbox-wrapper .ant-checkbox { transform: scale(1.35); transform-origin: center; }
        .ant-table-body { -webkit-overflow-scrolling: touch; }
      }
      @media (max-width: 760px) {
        .qk-lazy-settings-grid { grid-template-columns: 1fr !important; }
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function refreshFrontDeleteButton() {
    if (!featureEnabled('quarkFrontDelete')) {
      document.querySelectorAll('.' + TOOLBAR.frontDeleteClass).forEach((node) => node.remove());
      document.querySelectorAll('.' + TOOLBAR.hiddenNativeClass).forEach((node) => node.classList.remove(TOOLBAR.hiddenNativeClass));
      return;
    }
    if (!shouldHandleListPage()) return;
    const btnMain = document.querySelector('.btn-operate .btn-main');
    if (!btnMain) return;

    let front = btnMain.querySelector('.' + TOOLBAR.frontDeleteClass);
    if (!front) {
      front = document.createElement('button');
      front.type = 'button';
      front.className = `ant-btn btn-file ${TOOLBAR.frontDeleteClass}`;
      front.title = '删除选中的文件（Delete 键同效）';
      front.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M6 2h4M2.5 4h11M12.5 4l-.6 9.1a1 1 0 0 1-1 .9H5.1a1 1 0 0 1-1-.9L3.5 4M6.5 7v4M9.5 7v4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg><span>删除</span>';
      front.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const native = findNativeDeleteButton();
        if (native) {
          safeClick(native);
        } else {
          notifyToast('请先勾选要删除的文件', 'warning', 2000);
        }
      });
    }
    if (btnMain.firstElementChild !== front) btnMain.insertBefore(front, btnMain.firstElementChild);

    const native = findNativeDeleteButton();
    if (native && !native.classList.contains(TOOLBAR.hiddenNativeClass)) native.classList.add(TOOLBAR.hiddenNativeClass);
    const shouldDisable = !native;
    if (front.disabled !== shouldDisable) front.disabled = shouldDisable;
  }

  // 左侧栏默认折叠：每次打开页面只自动折叠一次，之后用户手动展开不会被再次收起。
  function autoCollapseSider() {
    if (!featureEnabled('quarkSidebarCollapse')) return;
    if (Runtime.siderAutoCollapsed) return;
    const sider = document.querySelector('.ant-layout-sider.ant-layout-sider-has-trigger');
    const trigger = sider && sider.querySelector('.ant-layout-sider-trigger');
    if (!sider || !trigger) return;
    Runtime.siderAutoCollapsed = true;
    if (!sider.classList.contains('ant-layout-sider-collapsed')) safeClick(trigger);
  }

  // 夸克把表格高度写死为 calc(100vh - 246px)（按单行工具栏算）。工具栏改为两行后表格会超出屏幕，这里按实际位置重算。
  function fitListTableHeight() {
    const body = document.querySelector('.file-list .ant-table-body');
    if (!body || !body.style.maxHeight) return;
    const top = Math.round(body.getBoundingClientRect().top);
    if (top <= 0) return;
    const want = `calc(100vh - ${Math.max(top + 10, 120)}px)`;
    if (body.style.maxHeight !== want) body.style.maxHeight = want;
  }

  // 仅隐藏当前夸克列表中精确命名的文件夹行，不影响网盘数据或同名文件。
  function refreshQuarkHiddenFolders() {
    const rows = document.querySelectorAll('.file-list .ant-table-tbody tr[data-row-key]');
    const hiddenFids = new Set();
    if (shouldHandleListPage() && featureEnabled('quarkHideSystemFolders')) {
      const list = document.querySelector('.file-list');
      const key = list && Object.keys(list).find((k) => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
      let fiber = key && list[key];
      for (let i = 0; fiber && i < 40; i++, fiber = fiber.return) {
        const props = fiber.memoizedProps;
        if (props && Array.isArray(props.list) && Array.isArray(props.selectedRowKeys)) {
          props.list.forEach((item) => {
            if (item && item.file === false && (item.file_name === '隐私空间' || item.file_name === '我的备份')) hiddenFids.add(String(item.fid));
          });
          break;
        }
      }
    }
    rows.forEach((row) => row.classList.toggle('qk-hidden-system-folder', hiddenFids.has(row.getAttribute('data-row-key'))));
  }

  function scheduleToolbarRefresh() {
    if (Runtime.toolbarRaf) return;
    Runtime.toolbarRaf = requestAnimationFrame(() => {
      Runtime.toolbarRaf = 0;
      try {
        refreshFrontDeleteButton();
        refreshQuarkHiddenFolders();
        autoCollapseSider();
        fitListTableHeight();
      } catch (error) {
        console.warn('[夸克懒得点] 工具栏增强失败:', error);
      }
    });
  }

  function installToolbarEnhance() {
    injectToolbarStyle();
    scheduleToolbarRefresh();
    const observer = new MutationObserver(scheduleToolbarRefresh);
    observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
    window.addEventListener('resize', scheduleToolbarRefresh);
  }

  function findDeleteConfirmButton() {
    const dialogs = document.querySelectorAll('.ant-modal, [role="dialog"]');
    for (const dialog of dialogs) {
      if (!isVisible(dialog)) continue;
      const dialogText = (dialog.innerText || dialog.textContent || '').trim();
      if (!dialogText.includes('删除') && !dialogText.includes('移入回收站')) continue;

      const buttons = dialog.querySelectorAll('button.ant-btn-primary, button');
      for (const button of buttons) {
        if (!isVisible(button) || button.disabled || button.classList.contains('ant-btn-disabled')) continue;
        const text = (button.innerText || button.textContent || '').trim();
        if (text === '确定' || text === '删除' || text === '确认删除') return button;
      }
    }
    return null;
  }

  function handleDeleteKey(event) {
    if (!featureEnabled('quarkDeleteKey')) return;
    const isDeleteKey = event.key === 'Delete' || event.key === 'Del' || event.code === 'Delete' || event.keyCode === 46;
    if (!isDeleteKey || event.repeat) return;
    if (isEditableTarget(document.activeElement)) return;

    const deleteButton = findDeleteButton();
    if (!deleteButton) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    safeClick(deleteButton);
    setTimeout(() => {
      const confirmButton = findDeleteConfirmButton();
      if (confirmButton) safeClick(confirmButton);
    }, 100);
  }

  async function waitClickable(selectors, textFallbacks, timeoutMs) {
    const timeout = timeoutMs || FLOW.selectorWaitMs;
    const start = Date.now();

    while (Date.now() - start < timeout) {
      const node = await waitForElement(selectors, { timeoutMs: 1000, visibleOnly: true });
      if (node) return node;

      if (Array.isArray(textFallbacks) && textFallbacks.length > 0) {
        const textNode = findClickableByText(textFallbacks);
        if (textNode) return textNode;
      }
    }

    return null;
  }

  function findSaveSuccessEl() {
    const nodes = document.querySelectorAll('span.text');
    for (const node of nodes) {
      if ((node.textContent || '').trim() === '保存成功') return node;
    }
    return null;
  }

  async function waitForSaveSuccess(timeoutMs) {
    const timeout = timeoutMs || FLOW.selectorWaitMs;
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const node = findSaveSuccessEl();
      if (node) return node;
      await sleep(150);
    }
    return null;
  }

  function shouldHandleSharePage() {
    return /^https:\/\/pan\.quark\.cn\/s\//.test(window.location.href);
  }

  function shouldHandleListPage() {
    return window.location.href.startsWith('https://pan.quark.cn/list');
  }

  // WebDAV 同步：脚本存储里除 WebDAV 账号外的所有键都参与备份/恢复。
  const SYNC_EXCLUDED_KEYS = new Set([WEBDAV_CONF_KEY]);
  const SYNC_KNOWN_KEYS = [STORAGE_KEY, WARNING_KEY, LOG_KEY, SYNC_AUDIT_KEY, AUTO_SAVE_ENABLED_KEY, FEATURE_OPTIONS_KEY,
    RPC_FAILURE_KEY, 'rpc_helper_settings_v3', 'rpc_active_v1', 'quark_social_token', 'baidu_access_token', 'qk115_hdhive_jobs_v1'];
  function collectSyncValues() {
    let keys = [];
    try { if (typeof GM_listValues === 'function') keys = GM_listValues() || []; } catch (error) { keys = []; }
    const out = {};
    [...new Set([...keys, ...SYNC_KNOWN_KEYS])].forEach((key) => {
      if (SYNC_EXCLUDED_KEYS.has(key)) return;
      const value = GM_getValue(key, undefined);
      if (value !== undefined) out[key] = value;
    });
    return out;
  }
  function cloudValues(cloudData) {
    const values = cloudData && cloudData.values;
    return values && typeof values === 'object' && !Array.isArray(values) ? values : {};
  }
  function mergeById(local, remote, max) {
    const list = Array.isArray(local) ? local.slice() : [];
    const ids = new Set(list.map((x) => x && x.id));
    (Array.isArray(remote) ? remote : []).forEach((x) => { if (x && x.id && !ids.has(x.id)) { ids.add(x.id); list.push(x); } });
    list.sort((a, b) => String(b.time || '').localeCompare(String(a.time || '')));
    return list.slice(0, max);
  }

  const WebDAV = {
    getConfig: () => GM_getValue(WEBDAV_CONF_KEY, { url: '', user: '', pass: '' }),
    setConfig: (conf) => GM_setValue(WEBDAV_CONF_KEY, conf),

    pull: function (callback, options) {
      const conf = this.getConfig();
      const timeoutMs = (options && options.timeoutMs) || 8000;
      const applyMode = (options && options.applyMode) || 'merge';
      if (!conf.url) {
        if (callback) callback({ ok: false, reason: 'no-config', status: 0 });
        return;
      }

      const fileUrl = conf.url.endsWith('/') ? conf.url + CLOUD_FILE_NAME : conf.url + '/' + CLOUD_FILE_NAME;
      let finished = false;

      const finish = (result) => {
        if (finished) return;
        finished = true;
        if (callback) callback(result || { ok: false, reason: 'unknown', status: 0 });
      };

      console.log('[夸克懒得点] 正在从云端拉取数据...');

      GM_xmlhttpRequest({
        method: 'GET',
        url: fileUrl,
        user: conf.user,
        password: conf.pass,
        timeout: timeoutMs,
        headers: { 'Cache-Control': 'no-cache' },
        onload: function (response) {
          if (response.status >= 200 && response.status < 300) {
            try {
              const cloudData = JSON.parse(response.responseText || '{}');
              WebDAV.applyCloudData(cloudData, applyMode);
              console.log('[夸克懒得点] ✅ 云端同步成功');
              finish({ ok: true, reason: 'ok', status: response.status });
              return;
            } catch (error) {
              console.error('[夸克懒得点] 解析云端数据失败', error);
              finish({ ok: false, reason: 'parse-error', status: response.status });
              return;
            }
          } else if (response.status === 404) {
            console.log('[夸克懒得点] 云端文件不存在，将在下次保存时创建');
            finish({ ok: true, reason: 'not-found', status: response.status });
            return;
          } else {
            console.warn(`[夸克懒得点] 拉取失败: ${response.status}`);
            finish({ ok: false, reason: 'http-error', status: response.status });
            return;
          }
        },
        onerror: function (error) {
          console.error('[夸克懒得点] 网络请求错误 (Pull)', error);
          finish({ ok: false, reason: 'network-error', status: 0 });
        },
        ontimeout: function () {
          console.warn('[夸克懒得点] Pull 超时，继续本地流程');
          finish({ ok: false, reason: 'timeout', status: 0 });
        }
      });
    },

    push: function (callback) {
      const conf = this.getConfig();
      if (!conf.url) { if (callback) callback({ ok: false, reason: 'no-config' }); return; }
      let finished = false;
      const finish = (result) => { if (finished) return; finished = true; if (callback) callback(result); };

      // 备份范围：除 WebDAV 账号本身外的全部脚本数据（values 为完整快照；下面的字段保留给旧版本读取）。
      const data = {
        schema: 3,
        values: collectSyncValues(),
        blocked: getBlockedList(),
        warning: getWarningList(),
        logs: getLogs(),
        rpcSettings: GM_getValue('rpc_helper_settings_v3', null),
        rpcActive: GM_getValue('rpc_active_v1', null),
        options: {
          autoSave: isAutoSaveEnabled(),
          features: GM_getValue(FEATURE_OPTIONS_KEY, {})
        },
        syncAudits: getSyncAudits(),
        updated: Date.now()
      };

      const fileUrl = conf.url.endsWith('/') ? conf.url + CLOUD_FILE_NAME : conf.url + '/' + CLOUD_FILE_NAME;

      GM_xmlhttpRequest({
        method: 'PUT',
        url: fileUrl,
        user: conf.user,
        password: conf.pass,
        timeout: 10000,
        data: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json;charset=UTF-8' },
        onload: function (response) {
          if (response.status >= 200 && response.status < 300) {
            console.log('[夸克懒得点] ✅ 上传成功');
            finish({ ok: true, status: response.status });
          } else {
            console.error(`[夸克懒得点] ❌ 上传失败: ${response.status}`);
            finish({ ok: false, reason: 'http-error', status: response.status });
          }
        },
        onerror: function (error) {
          console.error('[夸克懒得点] ❌ 上传请求失败', error);
          finish({ ok: false, reason: 'network-error' });
        },
        ontimeout: function () {
          console.warn('[夸克懒得点] ❌ 上传超时');
          finish({ ok: false, reason: 'timeout' });
        }
      });
    },

    normalizeUserItem: function (u) {
      if (!u || typeof u !== 'object') return null;
      const name = (u.name || '').trim();
      const hash = (u.hash || '').trim();
      if (!name && !hash) return null;
      const site = getEntrySite(u);
      const sharerId = site === '115.com' && /^\d+$/.test(String(u.sharerId || '')) ? String(u.sharerId) : '';
      return { name: name || 'Unknown', hash: hash || computeStringHash(name || 'Unknown'), site, ...(sharerId ? { sharerId } : {}) };
    },

    userKey: function (u) {
      const site = getEntrySite(u);
      if (site === '115.com' && /^\d+$/.test(String(u.sharerId || ''))) return `${site}::id:${u.sharerId}`;
      return `${site}::${(u.hash || '').trim()}::${(u.name || '').trim()}`;
    },

    normalizeLogs: function (logs) {
      if (!Array.isArray(logs)) return [];
      const out = [];
      const seen = new Set();
      logs.forEach((l) => {
        if (!l || !l.url) return;
        const key = `${getEntrySite(l)}::${getLogKind(l)}::${l.url}::${l.time || ''}::${l.title || ''}`;
        if (seen.has(key)) return;
        seen.add(key);
        out.push({ ...l, site: getEntrySite(l), kind: getLogKind(l) });
      });
      out.sort((a, b) => new Date(b.time) - new Date(a.time));
      if (out.length > MAX_LOGS) return out.slice(0, MAX_LOGS);
      return out;
    },

    mergeUserList: function (localList, cloudList) {
      const list = Array.isArray(localList) ? localList.slice() : [];
      const keys = new Set(list.map((u) => this.userKey(u || {})));
      if (Array.isArray(cloudList)) {
        cloudList.forEach((u) => {
          const normalized = this.normalizeUserItem(u);
          if (!normalized) return;
          const key = this.userKey(normalized);
          if (!keys.has(key)) {
            list.push(normalized);
            keys.add(key);
          }
        });
      }
      return list;
    },

    replaceUserList: function (cloudList) {
      if (!Array.isArray(cloudList)) return [];
      const list = [];
      const keys = new Set();
      cloudList.forEach((u) => {
        const normalized = this.normalizeUserItem(u);
        if (!normalized) return;
        const key = this.userKey(normalized);
        if (keys.has(key)) return;
        keys.add(key);
        list.push(normalized);
      });
      return list;
    },

    mergeRpcSettings: function (local, remote) {
      if (!remote || !Array.isArray(remote.rpcConfigs) || !Array.isArray(remote.downloadPaths)) return local;
      if (!local || !Array.isArray(local.rpcConfigs) || !Array.isArray(local.downloadPaths)) return remote;
      const merged = JSON.parse(JSON.stringify(local));
      const pathIds = new Map(merged.downloadPaths.map((p) => [p.path, p.id]));
      const remotePathIds = new Map();
      remote.downloadPaths.forEach((p) => {
        if (!p || !p.path) return;
        if (!pathIds.has(p.path)) {
          const id = `sync-path-${Math.random().toString(36).slice(2)}`;
          merged.downloadPaths.push({ id, path: p.path });
          pathIds.set(p.path, id);
        }
        remotePathIds.set(p.id, pathIds.get(p.path));
      });
      const usedIds = new Set(merged.rpcConfigs.map((r) => r.id));
      remote.rpcConfigs.forEach((rpc) => {
        if (!rpc || !rpc.domain || !rpc.port) return;
        // Endpoint is the identity. Local values win, including credentials and bindings.
        if (merged.rpcConfigs.some((r) => r.domain === rpc.domain && String(r.port) === String(rpc.port))) return;
        let id = rpc.id;
        if (!id || usedIds.has(id)) id = `sync-rpc-${Math.random().toString(36).slice(2)}`;
        usedIds.add(id);
        merged.rpcConfigs.push({ ...rpc, id });
        const binding = remote.rpcPathBindings && remote.rpcPathBindings[rpc.id];
        const paths = binding && Array.isArray(binding.pathIds) ? binding.pathIds.map((p) => remotePathIds.get(p)).filter(Boolean) : [];
        const fallback = merged.downloadPaths[0] && merged.downloadPaths[0].id;
        const pathIdsForRpc = paths.length ? [...new Set(paths)] : [fallback].filter(Boolean);
        const defaultId = binding && remotePathIds.get(binding.defaultPathId);
        merged.rpcPathBindings[id] = {
          pathIds: pathIdsForRpc,
          defaultPathId: pathIdsForRpc.includes(defaultId) ? defaultId : pathIdsForRpc[0]
        };
      });
      return merged;
    },
    mergeRemoteSettings: function (cloudData) {
      if (!cloudData || !cloudData.rpcSettings) return;
      const current = GM_getValue('rpc_helper_settings_v3', null);
      const merged = this.mergeRpcSettings(current, cloudData.rpcSettings);
      if (JSON.stringify(current) !== JSON.stringify(merged)) {
        GM_setValue('rpc_helper_settings_v3', merged);
        RpcHelper.reloadSettings();
      }
    },
    applyRemoteSettings: function (cloudData) {
      // 云端覆盖本地：完整快照中的每个键（WebDAV 账号除外）都写回本地。
      Object.entries(cloudValues(cloudData)).forEach(([key, value]) => {
        if (!SYNC_EXCLUDED_KEYS.has(key) && value !== undefined) GM_setValue(key, value);
      });
      if (cloudData.rpcSettings && Array.isArray(cloudData.rpcSettings.rpcConfigs)) {
        GM_setValue('rpc_helper_settings_v3', cloudData.rpcSettings);
      }
      if (cloudData.rpcActive && typeof cloudData.rpcActive.rpcId === 'string') {
        GM_setValue('rpc_active_v1', cloudData.rpcActive);
      }
      if (cloudData.options && typeof cloudData.options === 'object') {
        if (typeof cloudData.options.autoSave === 'boolean') setAutoSaveEnabled(cloudData.options.autoSave);
        if (cloudData.options.features && typeof cloudData.options.features === 'object') GM_setValue(FEATURE_OPTIONS_KEY, cloudData.options.features);
      }
      if (Array.isArray(cloudData.syncAudits)) setSyncAudits(cloudData.syncAudits.slice(0, MAX_SYNC_AUDITS));
      if (typeof RpcHelper !== 'undefined') RpcHelper.reloadSettings();
    },
    applyCloudData: function (cloudData, mode) {
      if (!cloudData) return;
      const applyMode = mode || 'merge';

      if (applyMode === 'replace') {
        this.applyRemoteSettings(cloudData);
        setBlockedList(this.replaceUserList(cloudData.blocked));
        setWarningList(this.replaceUserList(cloudData.warning));
        setLogs(this.normalizeLogs(cloudData.logs));
        return;
      }

      // 合并名单、日志与 RPC 配置；同一服务器以本地设置为准。功能开关：本机没设过的项采用云端值，已设过的以本机为准。
      this.mergeRemoteSettings(cloudData);
      const remoteFeatures = cloudData.options && cloudData.options.features;
      if (remoteFeatures && typeof remoteFeatures === 'object') {
        const localFeatures = GM_getValue(FEATURE_OPTIONS_KEY, {});
        const mergedFeatures = { ...remoteFeatures, ...localFeatures };
        if (JSON.stringify(mergedFeatures) !== JSON.stringify(localFeatures)) GM_setValue(FEATURE_OPTIONS_KEY, mergedFeatures);
      }
      setBlockedList(this.mergeUserList(getBlockedList(), cloudData.blocked));
      setWarningList(this.mergeUserList(getWarningList(), cloudData.warning));
      setLogs(this.normalizeLogs(this.normalizeLogs(getLogs()).concat(this.normalizeLogs(cloudData.logs))));
      // 其余数据：失败记录/同步记录按 id/时间合并；其他键（登录令牌、当前 RPC 选择等）本机没有时才采用云端值。
      const values = cloudValues(cloudData);
      if (Array.isArray(values[RPC_FAILURE_KEY])) setRpcFailures(mergeById(getRpcFailures(), values[RPC_FAILURE_KEY], MAX_RPC_FAILURES));
      const audits = Array.isArray(values[SYNC_AUDIT_KEY]) ? values[SYNC_AUDIT_KEY] : cloudData.syncAudits;
      if (Array.isArray(audits)) {
        const seen = new Set(getSyncAudits().map((a) => `${a.time}|${a.mode}|${a.status}`));
        const merged = getSyncAudits().concat(audits.filter((a) => a && !seen.has(`${a.time}|${a.mode}|${a.status}`)));
        merged.sort((a, b) => String(b.time || '').localeCompare(String(a.time || '')));
        setSyncAudits(merged.slice(0, MAX_SYNC_AUDITS));
      }
      const handled = new Set([STORAGE_KEY, WARNING_KEY, LOG_KEY, FEATURE_OPTIONS_KEY, SYNC_AUDIT_KEY, RPC_FAILURE_KEY, 'rpc_helper_settings_v3', ...SYNC_EXCLUDED_KEYS]);
      Object.entries(values).forEach(([key, value]) => {
        if (handled.has(key) || value === undefined) return;
        if (GM_getValue(key, undefined) === undefined) GM_setValue(key, value);
      });
    }
  };

  function pullCloudWithSoftTimeout(timeoutMs) {
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };

      WebDAV.pull(finish, { timeoutMs: timeoutMs || FLOW.pullWaitMs, applyMode: 'merge' });
      setTimeout(finish, (timeoutMs || FLOW.pullWaitMs) + 200);
    });
  }

  function syncCloudToLocalReplace(onDone) {
    WebDAV.pull((result) => {
      if (result && result.ok && result.reason !== 'not-found') {
        showSyncResult('replace', { ok: true, status: result.status });
      } else {
        showSyncResult('replace', { ok: false, reason: (result && result.reason) || 'unknown' });
      }
      if (onDone) onDone();
    }, { timeoutMs: 8000, applyMode: 'replace' });
  }

  function syncMergeBidirectional(onDone) {
    WebDAV.pull((result) => {
      const safeToPush = result && result.ok;
      if (safeToPush) {
        WebDAV.push((pushResult) => {
          showSyncResult('merge', pushResult);
          if (onDone) onDone();
        });
      } else {
        showSyncResult('merge', { ok: false, reason: `云端拉取失败：${(result && result.reason) || 'unknown'}，已阻止上传` });
        if (onDone) onDone();
      }
    }, { timeoutMs: 6000, applyMode: 'merge' });
  }

  function getTargetSharerInfo() {
    const shareContainer = queryFirst(SELECTORS.shareContainer);
    if (!shareContainer) return null;

    const imgElement = shareContainer.querySelector('img');
    if (!imgElement || !imgElement.src) return null;
    const hashID = computeStringHash(imgElement.src);

    const nameElement = queryFirst(SELECTORS.authorName, shareContainer);
    let nickName = 'Unknown';

    if (nameElement) {
      nickName = (nameElement.innerText || '').trim() || 'Unknown';
    } else {
      const possibleNames = shareContainer.querySelectorAll('div');
      if (possibleNames.length > 1) {
        nickName = (possibleNames[1].innerText || '').trim() || 'Unknown';
      }
    }

    return { name: nickName, hash: hashID };
  }

  function getFileTitle() {
    const titleEl = queryFirst(SELECTORS.fileTitle);
    if (titleEl) {
      return titleEl.getAttribute('title') || (titleEl.innerText || '').trim() || '未知标题';
    }
    return (document.title || '').replace(' - 夸克网盘', '') || '未知标题';
  }

  function recordLog(user, snapshot) {
    recordShareSaveLog({
      site: SITE_HOST,
      url: snapshot ? snapshot.url : window.location.href,
      title: snapshot ? snapshot.title : getFileTitle(),
      name: user ? user.name : '',
      hash: user ? user.hash : ''
    });
  }

  // 与自动转存、红橙名单开关独立：原生按钮手动保存也要记录，但必须等到新的成功提示。
  function installQuarkShareSaveLogger() {
    let pending = null;
    const check = () => {
      if (!pending) return;
      if (window.location.href !== pending.url || Date.now() - pending.started > 120000) {
        pending = null;
        return;
      }
      const success = findSaveSuccessEl();
      if (!success) { pending.previousSuccess = null; return; }
      if (success === pending.previousSuccess) return;
      const saved = pending;
      pending = null;
      recordLog(saved.user || getTargetSharerInfo(), saved);
    };
    document.addEventListener('click', (event) => {
      if (!shouldHandleSharePage() || Runtime.shareFlowRunning) return;
      const target = event.target && event.target.closest ? event.target : event.target && event.target.parentElement;
      const button = target && target.closest([...SELECTORS.saveButton, ...SELECTORS.confirmButton].join(','));
      if (!button || button.disabled || button.getAttribute('aria-disabled') === 'true') return;
      // 确认按钮只延续已有的转存操作，不把其它弹窗的确定当作保存。
      if (!button.matches(SELECTORS.saveButton.join(',')) && !pending) return;
      if (!pending || pending.url !== window.location.href) {
        pending = { url: window.location.href, title: getFileTitle(), user: getTargetSharerInfo(),
          started: Date.now(), previousSuccess: findSaveSuccessEl() };
      }
    }, true);
    new MutationObserver(check).observe(document.documentElement || document.body, {
      childList: true, subtree: true, characterData: true
    });
  }

  function showBlockedOverlay(user) {
    const overlay = document.createElement('div');
    Object.assign(overlay.style, {
      position: 'fixed', top: '0', left: '0', width: '100%', height: '100%',
      backgroundColor: 'rgba(0, 0, 0, 0.95)', zIndex: '999999',
      display: 'flex', justifyContent: 'center', alignItems: 'center', flexDirection: 'column'
    });

    const text = document.createElement('h1');
    text.innerText = '⛔ 已屏蔽该分享者';
    text.style.cssText = 'color:#ff4d4f;font-size:60px;font-weight:bold;text-shadow:2px 2px 10px black;margin:0;';

    const subText = document.createElement('div');
    const nameLabel = document.createElement('p');
    nameLabel.style.cssText = 'font-size:24px;color:white;';
    nameLabel.appendChild(document.createTextNode('昵称：'));
    const nameValue = document.createElement('span');
    nameValue.style.color = '#ff6a00';
    nameValue.textContent = user.name;
    nameLabel.appendChild(nameValue);
    subText.appendChild(nameLabel);

    const unlockBtn = document.createElement('button');
    unlockBtn.innerText = '本次临时允许';
    unlockBtn.style.cssText = 'margin-top:30px;padding:10px 20px;cursor:pointer;background:#333;color:#fff;border:1px solid #666;';
    unlockBtn.onclick = function () { overlay.remove(); };

    overlay.appendChild(text);
    overlay.appendChild(subText);
    overlay.appendChild(unlockBtn);
    document.body.appendChild(overlay);
  }

  function showWarningToast(user) {
    notifyToast(`⚠️ 注意：此分享者 (${user.name}) 在警告名单中`, 'warning');
  }

  function setUserListFromLog(rawUser, mode) {
    const user = WebDAV.normalizeUserItem(rawUser);
    if (user && getEntrySite(user) === '115.com' && !user.sharerId) {
      notifyToast('⚠️ 115 旧日志没有可信账号 ID，请在分享页直接加入名单', 'warning');
      return false;
    }
    if (!user) {
      notifyToast('⚠️ 该日志缺少可用用户标识，无法加入名单', 'warning');
      return false;
    }

    const blockedList = getBlockedList();
    const warningList = getWarningList();
    const isSameUser = (u) => u && getEntrySite(u) === getEntrySite(user) &&
      (user.sharerId ? u.sharerId === user.sharerId : (u.name === user.name && u.hash === user.hash));

    if (mode === 'blocked') {
      if (blockedList.some(isSameUser)) {
        notifyToast(`⛔ 该用户 [${user.name}] 已在屏蔽列表`, 'warning');
        return false;
      }

      const warningIndex = warningList.findIndex(isSameUser);
      if (warningIndex !== -1) {
        warningList.splice(warningIndex, 1);
        setWarningList(warningList);
      }

      blockedList.push(user);
      setBlockedList(blockedList);
      WebDAV.push();
      notifyToast(`✅ 已加入屏蔽列表: ${user.name}`, 'success');
      return true;
    }

    if (mode === 'warning') {
      if (warningList.some(isSameUser)) {
        notifyToast(`⚠️ 该用户 [${user.name}] 已在警告列表`, 'warning');
        return false;
      }

      const blockedIndex = blockedList.findIndex(isSameUser);
      if (blockedIndex !== -1) {
        blockedList.splice(blockedIndex, 1);
        setBlockedList(blockedList);
      }

      warningList.push(user);
      setWarningList(warningList);
      WebDAV.push();
      notifyToast(`✅ 已加入警告列表: ${user.name}`, 'success');
      return true;
    }

    return false;
  }

  function showDuplicateOverlay(log, callback) {
    const overlay = document.createElement('div');
    Object.assign(overlay.style, {
      position: 'fixed', top: '0', left: '0', width: '100%', height: '100%',
      backgroundColor: 'rgba(0,0,0,0.90)', zIndex: '999999',
      display: 'flex', justifyContent: 'center', alignItems: 'center', flexDirection: 'column'
    });

    const text = document.createElement('h1');
    text.innerText = '🔁 此链接已保存过';
    text.style.cssText = 'color:#FFD700;font-size:50px;font-weight:bold;text-shadow:2px 2px 5px black;margin:0;';

    const infoDiv = document.createElement('div');
    infoDiv.style.cssText = 'margin-top:20px;color:#ddd;text-align:center;font-size:16px;line-height:1.6;';
    infoDiv.innerHTML = `
      <p>上次保存时间: <span style="color:white;font-weight:bold">${log.time}</span></p>
      <p>文件标题: ${log.title}</p>
    `;

    const btnContainer = document.createElement('div');
    btnContainer.style.marginTop = '40px';

    const cancelBtn = document.createElement('button');
    cancelBtn.innerText = '我知道了 (关闭页面)';
    cancelBtn.style.cssText = 'padding:10px 20px;cursor:pointer;background:#444;color:#fff;border:none;border-radius:4px;margin-right:20px;';
    cancelBtn.onclick = function () { window.close(); overlay.remove(); };

    const forceBtn = document.createElement('button');
    forceBtn.innerText = '强制再次保存';
    forceBtn.style.cssText = 'padding:10px 20px;cursor:pointer;background:#007bff;color:#fff;border:none;border-radius:4px;';
    forceBtn.onclick = function () {
      overlay.remove();
      if (callback) callback();
    };

    btnContainer.appendChild(cancelBtn);
    btnContainer.appendChild(forceBtn);
    overlay.appendChild(text);
    overlay.appendChild(infoDiv);
    overlay.appendChild(btnContainer);
    document.body.appendChild(overlay);
  }

  // 日志中心：保存记录 / 发送记录 / 失败记录，不按当前网盘隔离；可按网盘类型筛选。
  function showLogViewer(host) {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.8);z-index:999999;display:flex;justify-content:center;align-items:center;';
    const box = document.createElement('div');
    box.dataset.qkLogCenter = '1';
    box.style.cssText = 'width:90%;height:85%;background:#fff;border-radius:8px;padding:16px;display:flex;flex-direction:column;color:#333;box-sizing:border-box;';

    const kinds = [['save', '保存记录'], ['rpc', '下载记录'], ['fail', '失败记录']];
    let kind = 'save';
    let siteFilter = '';
    const selected = new Set();

    const kindBar = document.createElement('div');
    kindBar.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px;';
    const toolbar = document.createElement('div');
    toolbar.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:10px;';
    const siteSelect = document.createElement('select');
    siteSelect.dataset.qkLogSite = '1';
    siteSelect.style.cssText = 'height:32px;padding:0 8px;border:1px solid #bbb;border-radius:6px;';
    const searchInput = document.createElement('input');
    searchInput.placeholder = '🔍 搜索（昵称/标题/文件名/网址/原因）';
    searchInput.style.cssText = 'flex:1;min-width:200px;height:32px;padding:0 8px;border:1px solid #bbb;border-radius:6px;';
    const countText = document.createElement('span');
    countText.style.cssText = 'color:#555;font-size:12px;white-space:nowrap;';
    const refreshBtn = document.createElement('button');
    refreshBtn.type = 'button';
    refreshBtn.dataset.qkLogRefresh = '1';
    refreshBtn.textContent = '刷新日志';
    refreshBtn.title = '重新读取本地日志，不刷新网盘页面';
    refreshBtn.style.cssText = 'height:32px;padding:0 12px;border:1px solid #b45309;border-radius:6px;background:#fff7ed;color:#9a3412;cursor:pointer;';
    refreshBtn.onclick = render;
    toolbar.append(siteSelect, searchInput, countText, refreshBtn);

    const failActions = document.createElement('div');
    failActions.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px;';
    const actionStyle = 'padding:6px 12px;border-radius:6px;cursor:pointer;font-weight:600;';
    const selectAllBtn = document.createElement('button');
    selectAllBtn.textContent = '全选/取消';
    selectAllBtn.style.cssText = actionStyle + 'border:1px solid #999;background:#fff;';
    const retrySelectedBtn = document.createElement('button');
    retrySelectedBtn.dataset.qkRetrySelected = '1';
    retrySelectedBtn.style.cssText = actionStyle + 'border:1px solid #b45309;background:#b45309;color:#fff;';
    const advancedSelectedBtn = document.createElement('button');
    advancedSelectedBtn.dataset.qkRetryAdvancedSelected = '1';
    advancedSelectedBtn.style.cssText = actionStyle + 'border:1px solid #b45309;background:#fff7ed;color:#9a3412;';
    const deleteSelectedBtn = document.createElement('button');
    deleteSelectedBtn.textContent = '删除选中';
    deleteSelectedBtn.style.cssText = actionStyle + 'border:1px solid #cf1322;background:#fff;color:#cf1322;';
    failActions.append(selectAllBtn, retrySelectedBtn, advancedSelectedBtn, deleteSelectedBtn);

    const contentBox = document.createElement('div');
    contentBox.style.cssText = 'flex:1;overflow:auto;border:1px solid #ccc;background:#f9f9f9;';
    const table = document.createElement('table');
    table.style.cssText = 'width:100%;border-collapse:collapse;font-size:12px;';
    contentBox.appendChild(table);

    const allEntries = () => {
      const logs = getLogs();
      return {
        save: logs.filter((entry) => getLogKind(entry) === 'save'),
        rpc: logs.filter((entry) => getLogKind(entry) === 'rpc'),
        fail: getRpcFailures()
      };
    };
    const entrySite = (entry) => (kind === 'fail' ? entry.site : getEntrySite(entry));
    // 旧保存/下载日志没有 id；用字段元组定位，不按行号删，防止刷新或新日志插入后误删。
    const keyOf = (entry) => kind === 'fail' ? entry.id : JSON.stringify([getLogKind(entry), getEntrySite(entry),
      entry.time || '', entry.url || '', entry.title || '', entry.name || '', entry.hash || '', entry.status || '', entry.files || []]);
    function removeEntries(keys) {
      const drop = new Set(keys);
      if (!drop.size) return;
      if (kind === 'fail') setRpcFailures(getRpcFailures().filter((entry) => !drop.has(entry.id)));
      else setLogs(getLogs().filter((entry) => getLogKind(entry) !== kind || !drop.has(keyOf(entry))));
      drop.forEach((key) => selected.delete(key));
      WebDAV.push();
      render();
    }
    const visibleEntries = () => {
      const needle = (searchInput.value || '').trim().toLowerCase();
      return allEntries()[kind].filter((entry) => {
        if (siteFilter && entrySite(entry) !== siteFilter) return false;
        if (!needle) return true;
        return [entry.name, entry.title, entry.status, (entry.files || []).join(' '), entry.url, entry.pageUrl, entry.reason, entry.site].join(' ').toLowerCase().includes(needle);
      });
    };
    const cell = (text, css) => {
      const td = document.createElement('td');
      td.textContent = text == null ? '' : String(text);
      td.title = td.textContent;
      td.style.cssText = 'padding:6px 8px;border-bottom:1px solid #eee;vertical-align:middle;' + (css || '');
      return td;
    };
    const smallButton = (text, css) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = text;
      button.style.cssText = 'padding:2px 8px;border-radius:4px;cursor:pointer;font-size:12px;' + (css || 'border:1px solid #bbb;background:#fff;');
      return button;
    };
    const linkTo = (url, text) => {
      const a = document.createElement('a');
      a.href = url || '#';
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = text;
      a.style.color = '#1765ad';
      return a;
    };

    function renderSiteOptions() {
      const entries = allEntries();
      const sites = [...new Set([...entries.save, ...entries.rpc].map(getEntrySite).concat(entries.fail.map((x) => x.site)).filter(Boolean))].sort();
      const key = sites.join('|');
      if (siteSelect.dataset.key !== key) {
        siteSelect.dataset.key = key;
        siteSelect.innerHTML = '';
        [['', '全部网盘'], ...sites.map((site) => [site, `${siteLabel(site)}（${site}）`])].forEach(([value, label]) => {
          const option = document.createElement('option');
          option.value = value;
          option.textContent = label;
          siteSelect.appendChild(option);
        });
      }
      if (!sites.includes(siteFilter)) siteFilter = '';
      siteSelect.value = siteFilter;
    }

    function render() {
      renderSiteOptions();
      for (const button of kindBar.children) {
        const active = button.dataset.kind === kind;
        button.setAttribute('aria-selected', String(active));
        button.style.background = active ? '#b45309' : '#fff';
        button.style.color = active ? '#fff' : '#3f3f46';
      }
      retrySelectedBtn.hidden = kind !== 'fail';
      advancedSelectedBtn.hidden = kind !== 'fail';
      retrySelectedBtn.style.display = kind === 'fail' ? '' : 'none';
      advancedSelectedBtn.style.display = kind === 'fail' ? '' : 'none';
      const rows = visibleEntries();
      const liveIds = new Set(rows.map(keyOf));
      [...selected].forEach((id) => { if (!liveIds.has(id)) selected.delete(id); });
      countText.textContent = `共 ${rows.length} 条`;
      retrySelectedBtn.textContent = `重试选中（${selected.size}）`;
      retrySelectedBtn.disabled = selected.size === 0;
      advancedSelectedBtn.textContent = `高级重试选中（${selected.size}）`;
      advancedSelectedBtn.disabled = selected.size === 0;
      deleteSelectedBtn.textContent = `删除选中（${selected.size}）`;
      deleteSelectedBtn.disabled = selected.size === 0;

      table.innerHTML = '';
      const heads = kind === 'save' ? ['', '时间', '网盘', '分享者', '标题', '操作']
        : kind === 'rpc' ? ['', '时间', '网盘', '文件', '结果', '页面']
          : ['', '时间', '网盘', '文件', '错误类型', '失败原因', '次数', '操作'];
      const thead = document.createElement('thead');
      const headRow = document.createElement('tr');
      heads.forEach((text) => {
        const th = document.createElement('th');
        th.textContent = text;
        th.style.cssText = 'text-align:left;padding:8px;background:#eee;position:sticky;top:0;border-bottom:2px solid #ddd;';
        headRow.appendChild(th);
      });
      thead.appendChild(headRow);
      const tbody = document.createElement('tbody');
      const blockedUsers = kind === 'save' ? getBlockedList() : [];
      const warningUsers = kind === 'save' ? getWarningList() : [];
      rows.forEach((entry) => {
        const tr = document.createElement('tr');
        tr.dataset.qkLogRow = kind;
        const key = keyOf(entry);
        const pick = document.createElement('td');
        pick.style.cssText = 'padding:6px 8px;border-bottom:1px solid #eee;';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.dataset.qkLogPick = key;
        if (kind === 'fail') checkbox.dataset.qkFailPick = entry.id;
        checkbox.setAttribute('aria-label', `选择记录：${entry.title || entry.name || entry.time || ''}`);
        checkbox.checked = selected.has(key);
        checkbox.onchange = () => { if (checkbox.checked) selected.add(key); else selected.delete(key); render(); };
        pick.appendChild(checkbox);
        tr.appendChild(pick);
        if (kind === 'save') {
          const user = WebDAV.normalizeUserItem({ name: entry.name, hash: entry.hash, site: getEntrySite(entry), sharerId: entry.sharerId });
          const actions = document.createElement('td');
          actions.style.cssText = 'padding:6px 8px;border-bottom:1px solid #eee;white-space:nowrap;';
          actions.appendChild(linkTo(entry.url, '🔗打开'));
          if (user && entry.hash && (getEntrySite(entry) !== '115.com' || Boolean(user.sharerId))) {
            const site = getEntrySite(entry);
            const sameSharer = (item) => item && getEntrySite(item) === site && item.hash === user.hash &&
              (site === '115.com' ? item.sharerId === user.sharerId : site !== 'pan.quark.cn' || item.name === user.name);
            const blocked = blockedUsers.some(sameSharer);
            const warning = warningUsers.some(sameSharer);
            const block = smallButton(blocked ? '已屏蔽' : '屏蔽', 'margin-left:6px;color:#cf1322;border:1px solid #ffccc7;background:#fff2f0;');
            const warn = smallButton(warning ? '已警告' : '警告', 'margin-left:6px;color:#ad6800;border:1px solid #ffe58f;background:#fffbe6;');
            block.disabled = blocked;
            warn.disabled = warning;
            block.title = blocked ? '该分享者已在红名单中' : '加入红名单';
            warn.title = warning ? '该分享者已在橙名单中' : '加入橙名单';
            block.onclick = () => { setUserListFromLog(user, 'blocked'); render(); };
            warn.onclick = () => { setUserListFromLog(user, 'warning'); render(); };
            actions.append(block, warn);
          }
          tr.append(cell(entry.time, 'white-space:nowrap;'), cell(siteLabel(getEntrySite(entry)), 'white-space:nowrap;'),
            cell(entry.name, 'max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;'),
            cell(entry.title, 'max-width:420px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;'), actions);
        } else if (kind === 'rpc') {
          const page = document.createElement('td');
          page.style.cssText = 'padding:6px 8px;border-bottom:1px solid #eee;';
          page.appendChild(linkTo(entry.url, '🔗页面'));
          const hasFiles = Array.isArray(entry.files) && entry.files.length > 0;
          const fileCell = cell(hasFiles ? entry.title : '—', 'max-width:420px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;');
          fileCell.dataset.qkRpcFiles = '1';
          if (hasFiles) fileCell.title = entry.files.join('\n');
          tr.append(cell(entry.time, 'white-space:nowrap;'), cell(siteLabel(getEntrySite(entry)), 'white-space:nowrap;'), fileCell,
            cell(entry.status || entry.title, 'white-space:nowrap;'), page);
        } else {
          const actions = document.createElement('td');
          actions.style.cssText = 'padding:6px 8px;border-bottom:1px solid #eee;white-space:nowrap;';
          const retryable = Boolean(entry.call) || (typeof RpcHelper !== 'undefined' && RpcHelper.canRefetch(entry));
          const retry = smallButton('重试', 'color:#fff;border:1px solid #b45309;background:#b45309;');
          retry.dataset.qkFailRetry = entry.id;
          retry.title = entry.call ? '用原直链重发' : '在本页重新取链后发送';
          retry.disabled = !retryable;
          retry.onclick = () => runRetry([entry.id]);
          const advanced = smallButton('高级', 'margin-left:6px;color:#9a3412;border:1px solid #b45309;background:#fff7ed;');
          advanced.dataset.qkFailAdvanced = entry.id;
          advanced.onclick = () => runAdvanced([entry.id]);
          actions.append(retry, advanced);
          if (!retryable) {
            retry.title = entry.ident ? `没有原直链，需到${siteLabel(entry.site)}页面（原页面）重新取链` : '没有可复用的下载地址，需回原页重新勾选发送';
            actions.appendChild(document.createTextNode(' '));
            actions.appendChild(linkTo(entry.pageUrl, '回原页'));
          }
          const remove = smallButton('删除', 'margin-left:6px;color:#cf1322;border:1px solid #ffccc7;background:#fff;');
          remove.onclick = () => removeEntries([key]);
          actions.appendChild(remove);
          tr.append(cell(entry.time, 'white-space:nowrap;'), cell(siteLabel(entry.site), 'white-space:nowrap;'),
            cell(entry.name, 'max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;'),
            cell(RPC_FAILURE_TYPE_LABELS[rpcFailureType(entry)], 'white-space:nowrap;font-weight:600;color:#9a3412;'),
            cell(entry.reason || '', 'max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#b42318;'),
            cell(entry.attempts || 1), actions);
        }
        tbody.appendChild(tr);
      });
      table.append(thead, tbody);
    }

    async function runRetry(ids) {
      if (typeof RpcHelper === 'undefined' || !RpcHelper.retryFailures || !RpcHelper.retryFailures(null)) {
        notifyToast('请在任意支持 RPC 的网盘页面打开日志后重试', 'warning');
        return;
      }
      retrySelectedBtn.disabled = true;
      try { await RpcHelper.retryFailures(ids); }
      finally { ids.forEach((id) => selected.delete(id)); render(); }
    }
    function runAdvanced(ids) {
      if (typeof RpcHelper === 'undefined' || !RpcHelper.retryFailures || !RpcHelper.retryFailures(null)) {
        notifyToast('请在任意支持 RPC 的网盘页面打开日志后重试', 'warning');
        return;
      }
      RpcHelper.openAdvancedRetry(ids, () => { ids.forEach((id) => selected.delete(id)); render(); });
    }

    kinds.forEach(([key, label]) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.kind = key;
      button.textContent = label;
      button.style.cssText = 'min-height:36px;padding:0 16px;border:2px solid #b45309;border-radius:8px;font-weight:700;cursor:pointer;';
      button.onclick = () => { kind = key; selected.clear(); render(); };
      kindBar.appendChild(button);
    });
    siteSelect.onchange = () => { siteFilter = siteSelect.value; selected.clear(); render(); };
    searchInput.oninput = () => { selected.clear(); render(); };
    selectAllBtn.onclick = () => {
      const keys = visibleEntries().map(keyOf);
      const all = keys.length > 0 && keys.every((key) => selected.has(key));
      keys.forEach((key) => { if (all) selected.delete(key); else selected.add(key); });
      render();
    };
    retrySelectedBtn.onclick = () => { if (kind === 'fail') runRetry([...selected]); };
    advancedSelectedBtn.onclick = () => { if (kind === 'fail') runAdvanced([...selected]); };
    deleteSelectedBtn.onclick = () => removeEntries([...selected]);

    const footer = document.createElement('div');
    footer.style.cssText = 'margin-top:10px;display:flex;justify-content:flex-end;gap:8px;';
    const copyBtn = document.createElement('button');
    copyBtn.textContent = '复制当前列表';
    copyBtn.onclick = () => {
      const text = visibleEntries().map((x) => [x.time, siteLabel(entrySite(x)), x.name || '', x.title || '',
        kind === 'fail' ? RPC_FAILURE_TYPE_LABELS[rpcFailureType(x)] : '', x.reason || '', x.url || x.pageUrl || ''].join('\t')).join('\n');
      GM_setClipboard(text);
      notifyToast('✅ 已复制到剪贴板', 'success');
    };
    const clearBtn = document.createElement('button');
    clearBtn.textContent = '清空当前列表';
    clearBtn.style.color = '#cf1322';
    clearBtn.onclick = () => {
      const rows = visibleEntries();
      if (!rows.length || !qkNotice(`确定清空当前显示的 ${rows.length} 条记录？`)) return;
      removeEntries(rows.map(keyOf));
    };
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '关闭';
    closeBtn.onclick = () => overlay.remove();
    footer.append(copyBtn, clearBtn, closeBtn);

    box.append(kindBar, toolbar, failActions, contentBox, footer);
    render();
    if (host) {
      box.style.cssText += ';width:100%;height:62vh;padding:6px;';
      closeBtn.remove();
      host.appendChild(box);
      return;
    }
    overlay.appendChild(box);
    document.body.appendChild(overlay);
  }

  function showSyncResult(mode, result) {
    const ok = Boolean(result && result.ok);
    const labels = { push: '本地覆盖云端', merge: '合并同步', replace: '云端覆盖本地' };
    const label = labels[mode] || mode;
    const detail = result && (result.status || result.reason);
    addSyncAudit(mode, ok ? 'success' : 'failed', String(detail || 'unknown'));
    notifyToast(`${ok ? '✅' : '❌'} ${label}${ok ? '成功' : '失败'}${ok ? '' : `：${detail || 'unknown'}`}`, ok ? 'success' : 'error', 6000);
    const box = document.querySelector('.qk-sync-result');
    if (box) {
      box.textContent = `${label}：${ok ? '成功' : `失败（${detail || 'unknown'}）`}`;
      box.style.color = ok ? '#167647' : '#b42318';
    }
  }
  function syncLocalToCloudOverwrite(onDone) {
    WebDAV.push((result) => { showSyncResult('push', result); if (onDone) onDone(); });
  }

  function runSelectorHealthCheck() {
    const checks = [
      { name: '分享者信息容器', selectors: SELECTORS.shareContainer },
      { name: '转存按钮', selectors: SELECTORS.saveButton },
      { name: '确认按钮', selectors: SELECTORS.confirmButton },
      { name: '列表页筛选：来自分享', selectors: ['div[title="来自：分享"]', '[title="来自：分享"]'] }
    ];

    const results = checks.map((item) => {
      const hit = queryFirst(item.selectors);
      return {
        name: item.name,
        ok: Boolean(hit),
        selector: item.selectors.join(' | ')
      };
    });

    const passed = results.filter((r) => r.ok).length;
    const summary = `自检结果：${passed}/${results.length} 项可命中`;
    notifyToast(summary, passed === results.length ? 'success' : 'warning');
    return results;
  }

  function createListManagerSection(titleText, getter, setter, emptyText) {
    const section = document.createElement('div');
    section.style.cssText = 'padding:10px;border:1px solid #eee;border-radius:8px;background:#fff;display:flex;flex-direction:column;';

    const title = document.createElement('h4');
    title.innerText = titleText;
    title.style.cssText = 'margin:0 0 8px 0;';

    const listBox = document.createElement('div');
    listBox.style.cssText = 'flex:1;min-height:300px;max-height:420px;overflow:auto;border:1px solid #f0f0f0;border-radius:6px;padding:8px;background:#fafafa;';

    const render = () => {
      listBox.innerHTML = '';
      const list = getter();
      if (!Array.isArray(list) || list.length === 0) {
        const empty = document.createElement('div');
        empty.innerText = emptyText;
        empty.style.color = '#888';
        listBox.appendChild(empty);
        return;
      }

      list.forEach((u, index) => {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px dashed #ececec;gap:8px;';

        const text = document.createElement('div');
        text.style.cssText = 'font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
        text.title = `${u.name} (${u.hash}) · ${getEntrySite(u)}`;
        text.innerText = `${index + 1}. [${getEntrySite(u)}] ${u.name}`;

        const delBtn = document.createElement('button');
        delBtn.innerText = '删除';
        delBtn.style.cssText = 'color:#c00;cursor:pointer;';
        delBtn.onclick = function () {
          const next = getter().slice();
          next.splice(index, 1);
          setter(next);
          WebDAV.push();
          render();
        };

        row.appendChild(text);
        row.appendChild(delBtn);
        listBox.appendChild(row);
      });
    };

    const clearBtn = document.createElement('button');
    clearBtn.innerText = '清空此列表';
    clearBtn.style.cssText = 'margin-top:8px;color:#b00020;';
    clearBtn.onclick = function () {
      if (!qkNotice(`确认清空 ${titleText} 吗？`)) return;
      setter([]);
      WebDAV.push();
      render();
    };

    section.appendChild(title);
    section.appendChild(listBox);
    section.appendChild(clearBtn);

    render();
    return section;
  }

  function showSettingsPanel(focusWebDAV, host) {
    const quarkOnly = SITE_HOST === 'pan.quark.cn';
    const listSite = is115RelatedHost() ? '115.com' : SITE_HOST;
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.72);z-index:999999;display:flex;justify-content:center;align-items:center;';

    const panel = document.createElement('div');
    panel.style.cssText = 'width:94%;max-width:1120px;height:90%;background:#f7f8fa;border-radius:12px;display:flex;flex-direction:column;padding:14px;box-sizing:border-box;color:#1e293b;';

    const title = document.createElement('h2');
    title.innerText = '⚙️ 夸克懒得点 - 功能设置页';
    title.style.cssText = 'margin:0 0 12px 0;border-bottom:1px solid #e8e8e8;padding-bottom:10px;';

    const content = document.createElement('div');
    content.className = 'qk-lazy-settings-grid';
    content.style.cssText = 'flex:1;overflow:auto;display:grid;grid-template-columns:1fr 1fr;gap:10px;align-content:start;grid-auto-rows:min-content;';

    const quickSection = document.createElement('div');
    quickSection.style.cssText = 'grid-column:1 / -1;padding:8px 10px;border:1px solid #eee;border-radius:8px;background:#fff;';
    function addFeatureSwitch(parent, key, label, onChange) {
      const row = document.createElement('label');
      row.style.cssText = 'display:flex;align-items:center;gap:8px;margin:7px 0;font-size:13px;';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = featureEnabled(key);
      checkbox.onchange = () => { setFeatureEnabled(key, checkbox.checked); if (onChange) onChange(); WebDAV.push(); };
      row.append(checkbox, document.createTextNode(label));
      parent.appendChild(row);
      return checkbox;
    }
    const quickTitle = document.createElement('h4');
    quickTitle.innerText = '夸克功能';
    quickTitle.style.cssText = 'margin:0 0 6px 0;font-size:14px;';
    quickSection.appendChild(quickTitle);

    const autoSaveWrap = document.createElement('div');
    autoSaveWrap.style.cssText = 'display:flex;align-items:center;gap:8px;margin:0 0 8px 0;font-size:13px;';
    const autoSaveCheckbox = document.createElement('input');
    autoSaveCheckbox.type = 'checkbox';
    autoSaveCheckbox.checked = isAutoSaveEnabled();
    const autoSaveLabel = document.createElement('span');
    autoSaveLabel.innerText = '启用自动转存主流程';
    const autoSaveHint = document.createElement('span');
    autoSaveHint.style.cssText = 'font-size:12px;color:#666;';
    autoSaveHint.innerText = autoSaveCheckbox.checked ? '（当前：开启）' : '（当前：关闭）';
    autoSaveCheckbox.onchange = function () {
      setAutoSaveEnabled(autoSaveCheckbox.checked);
      WebDAV.push();
      autoSaveHint.innerText = autoSaveCheckbox.checked ? '（当前：开启）' : '（当前：关闭）';
    };
    autoSaveWrap.appendChild(autoSaveCheckbox);
    autoSaveWrap.appendChild(autoSaveLabel);
    autoSaveWrap.appendChild(autoSaveHint);
    quickSection.appendChild(autoSaveWrap);
    const quarkFeatureList = [
      ['quarkLoadAllButton', '工具栏显示「加载全部文件 / 还原分页加载」按钮'],
      ['quarkSelectAll', '页面加载后自动全选当前页（排除图片、NFO 和小于 10 MB 的视频）'],
      ['quarkTraverseFolders', '勾选文件夹时递归发送其中的文件（RPC）'],
      ['quarkHideSystemFolders', '隐藏「隐私空间」「我的备份」文件夹'],
      ['quarkFrontDelete', '删除按钮提前'],
      ['quarkDeleteKey', 'Delete 键删除'],
      ['quarkSidebarCollapse', '打开列表自动折叠侧栏'],
      ['quarkSharerFilter', '分享来源红/橙名单过滤']
    ];
    quarkFeatureList.forEach(([key, label]) => addFeatureSwitch(quickSection, key, label,
      key === 'quarkHideSystemFolders' ? scheduleToolbarRefresh : undefined));
    // RPC 失败提示音始终启用；成功不播放。
    const blockedSection = createListManagerSection('红名单（屏蔽）', () => getSiteEntries(getBlockedList(), listSite), (items) => {
      setBlockedList([...getBlockedList().filter((entry) => getEntrySite(entry) !== listSite), ...items]);
    }, '暂无屏蔽用户');
    const warningSection = createListManagerSection('橙名单（警告）', () => getSiteEntries(getWarningList(), listSite), (items) => {
      setWarningList([...getWarningList().filter((entry) => getEntrySite(entry) !== listSite), ...items]);
    }, '暂无警告用户');
    blockedSection.style.minHeight = '390px';
    warningSection.style.minHeight = '390px';
    const listsSection = document.createElement('div');
    listsSection.className = 'qk-lists-two-columns';
    listsSection.style.cssText = 'display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;';
    const listsSite = document.createElement('div');
    listsSite.textContent = `网盘类型：${listSite}`;
    listsSite.style.cssText = 'grid-column:1/-1;color:#52647c;font-size:12px;';
    listsSection.appendChild(listsSite);
    listsSection.appendChild(blockedSection);
    listsSection.appendChild(warningSection);

    const syncSection = document.createElement('div');
    syncSection.style.cssText = 'padding:10px;border:1px solid #eee;border-radius:8px;background:#fff;';
    const syncTitle = document.createElement('h4');
    syncTitle.innerText = '云端同步策略';
    syncTitle.style.cssText = 'margin:0 0 6px 0;font-size:16px;';
    const syncDesc = document.createElement('div');
    syncDesc.style.cssText = 'font-size:12px;color:#666;margin-bottom:6px;';
    syncDesc.innerText = 'x=云端：支持 x+本地（合并）、本地覆盖x、x覆盖本地。';

    const syncMergeBtn = document.createElement('button');
    syncMergeBtn.innerText = '☁️ 合并同步 (x+本地)';
    syncMergeBtn.style.cssText = 'margin-right:8px;color:#1565c0;';
    syncMergeBtn.onclick = function () { syncMergeBidirectional(); };

    const localToCloudBtn = document.createElement('button');
    localToCloudBtn.innerText = '⬆️ 本地覆盖云端';
    localToCloudBtn.style.cssText = 'margin-right:8px;color:#8a2be2;';
    localToCloudBtn.onclick = function () {
      if (!qkNotice('确认执行【本地覆盖云端】？云端将被当前设备数据覆盖。')) return;
      syncLocalToCloudOverwrite();
    };

    const cloudToLocalBtn = document.createElement('button');
    cloudToLocalBtn.innerText = '⬇️ 云端覆盖本地';
    cloudToLocalBtn.style.cssText = 'color:#b36b00;';
    cloudToLocalBtn.onclick = function () {
      if (!qkNotice('确认执行【云端覆盖本地】？本地数据将被云端替换。')) return;
      syncCloudToLocalReplace();
    };

    const syncResult = document.createElement('div');
    syncResult.className = 'qk-sync-result';
    syncResult.setAttribute('role', 'status');
    syncResult.style.cssText = 'margin-top:8px;font-size:13px;min-height:20px;';
    const healthCheckBtn = document.createElement('button');
    healthCheckBtn.innerText = '🔍 自检页面元素';
    healthCheckBtn.style.cssText = 'margin-left:8px;color:#096dd9;';

    const healthResult = document.createElement('div');
    healthResult.style.cssText = 'margin-top:8px;font-size:12px;color:#555;line-height:1.6;';

    healthCheckBtn.onclick = function () {
      const results = runSelectorHealthCheck();
      healthResult.innerHTML = results.map((r) => {
        const mark = r.ok ? '✅' : '❌';
        return `<div>${mark} ${r.name}</div>`;
      }).join('');
    };

    const auditTitle = document.createElement('div');
    auditTitle.innerText = '最近同步记录';
    auditTitle.style.cssText = 'margin-top:10px;font-size:12px;color:#666;';

    const auditBox = document.createElement('div');
    auditBox.style.cssText = 'max-height:86px;overflow:auto;margin-top:4px;padding:6px;border:1px dashed #ddd;border-radius:6px;background:#fafafa;font-size:12px;color:#444;';
    const audits = getSyncAudits().slice(0, 10);
    if (audits.length === 0) {
      auditBox.innerText = '暂无同步记录';
    } else {
      audits.forEach((a) => {
        const row = document.createElement('div');
        row.innerText = `[${a.time}] ${a.mode} / ${a.status}${a.detail ? ` / ${a.detail}` : ''}`;
        auditBox.appendChild(row);
      });
    }

    syncSection.appendChild(syncTitle);
    syncSection.appendChild(syncDesc);
    syncSection.appendChild(syncMergeBtn);
    syncSection.appendChild(localToCloudBtn);
    syncSection.appendChild(cloudToLocalBtn);
    syncSection.appendChild(syncResult);
    syncSection.appendChild(healthCheckBtn);
    syncSection.appendChild(healthResult);
    syncSection.appendChild(auditTitle);
    syncSection.appendChild(auditBox);

    const webdavSection = document.createElement('div');
    webdavSection.style.cssText = 'padding:10px;border:1px solid #eee;border-radius:8px;background:#fff;';
    const webdavTitle = document.createElement('h4');
    webdavTitle.innerText = '设置';
    webdavTitle.style.cssText = 'margin:0 0 6px 0;font-size:16px;';

    const conf = WebDAV.getConfig();
    const urlInput = document.createElement('input');
    urlInput.placeholder = 'WebDAV 地址';
    urlInput.value = conf.url || '';
    urlInput.style.cssText = 'width:100%;padding:7px;margin-bottom:5px;box-sizing:border-box;';

    const userInput = document.createElement('input');
    userInput.placeholder = 'WebDAV 账号';
    userInput.value = conf.user || '';
    userInput.style.cssText = 'width:100%;padding:7px;margin-bottom:5px;box-sizing:border-box;';

    const passInput = document.createElement('input');
    passInput.type = 'password';
    passInput.placeholder = 'WebDAV 密码';
    passInput.value = conf.pass || '';
    passInput.style.cssText = 'width:100%;padding:7px;margin-bottom:6px;box-sizing:border-box;';

    const saveWebdavBtn = document.createElement('button');
    saveWebdavBtn.innerText = '保存设置';
    saveWebdavBtn.style.cssText = 'margin-right:8px;';
    saveWebdavBtn.onclick = function () {
      WebDAV.setConfig({ url: urlInput.value.trim(), user: userInput.value.trim(), pass: passInput.value });
      notifyToast('✅ WebDAV 配置已保存', 'success');
    };

    const testWebdavBtn = document.createElement('button');
    testWebdavBtn.innerText = '保存并测试连接';
    testWebdavBtn.onclick = function () {
      WebDAV.setConfig({ url: urlInput.value.trim(), user: userInput.value.trim(), pass: passInput.value });
      WebDAV.pull((result) => {
        if (result && result.ok) {
          notifyToast('✅ 连接成功', 'success');
        } else {
          notifyToast(`❌ 连接失败：${(result && result.reason) || 'unknown'}`, 'error');
        }
      }, { timeoutMs: 6000, applyMode: 'merge' });
    };

    webdavSection.appendChild(webdavTitle);
    webdavSection.appendChild(urlInput);
    webdavSection.appendChild(userInput);
    webdavSection.appendChild(passInput);
    webdavSection.appendChild(saveWebdavBtn);
    webdavSection.appendChild(testWebdavBtn);

    const footer = document.createElement('div');
    footer.style.cssText = 'margin-top:12px;text-align:right;';
    const closeBtn = document.createElement('button');
    closeBtn.innerText = '关闭';
    closeBtn.onclick = function () { overlay.remove(); };
    footer.appendChild(closeBtn);

    content.appendChild(quickSection);
    content.appendChild(listsSection);
    // 同步策略与 WebDAV 配置合并为同一页：先配置，再同步。
    const syncWebdavSection = document.createElement('div');
    syncWebdavSection.dataset.qkSyncWebdav = '1';
    syncWebdavSection.style.cssText = 'grid-column:1 / -1;display:grid;gap:10px;';
    webdavTitle.innerText = 'WebDAV 设置';
    syncWebdavSection.appendChild(webdavSection);
    syncWebdavSection.appendChild(syncSection);
    content.appendChild(syncWebdavSection);
    if (!quarkOnly) { quickSection.remove(); }

    panel.appendChild(title);
    panel.appendChild(content);
    panel.appendChild(footer);
    overlay.appendChild(panel);
    if (host) {
      host.root.appendChild(content);
      const tabSections = { ...(quarkOnly ? { general: quickSection } : {}), blocked: listsSection, sync: syncWebdavSection };
      host.setSections(tabSections);
      return;
    }
    document.body.appendChild(overlay);
    if (focusWebDAV) webdavSection.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }


  async function ensureCheckboxChecked() {
    const checkboxInput = queryFirst(SELECTORS.checkboxInput);
    if (checkboxInput && checkboxInput.checked) return true;

    const wrapper = queryFirst(SELECTORS.checkboxWrapper) || checkboxInput;
    if (!wrapper) return false;

    safeClick(wrapper);
    await sleep(120);

    const after = queryFirst(SELECTORS.checkboxInput);
    return Boolean(after && after.checked);
  }

  async function executeSaveAction(currentUser) {
    console.log('[夸克懒得点] 执行转存...');

    await ensureCheckboxChecked();

    const saveButton = await waitClickable(SELECTORS.saveButton, ['转存', '保存到网盘'], FLOW.selectorWaitMs);
    if (!saveButton) {
      console.warn('[夸克懒得点] 未找到转存按钮');
      return false;
    }

    if (!safeClick(saveButton)) {
      console.warn('[夸克懒得点] 转存按钮点击失败');
      return false;
    }

    await sleep(500);

    for (let i = 0; i < 3; i++) {
      if (findSaveSuccessEl()) break;
      const confirmBtn = await waitClickable(SELECTORS.confirmButton, ['确定', '保存'], 1200);
      if (confirmBtn && safeClick(confirmBtn)) break;
      if (findSaveSuccessEl()) break;
      await sleep(FLOW.clickRetryGapMs * Math.pow(2, i));
    }

    if (!await waitForSaveSuccess(FLOW.selectorWaitMs)) {
      console.warn('[夸克懒得点] 未检测到保存成功，跳过日志写入');
      return false;
    }

    if (currentUser) {
      recordLog(currentUser);
    }

    setPendingSourceClick();
    window.location.href = LIST_PAGE_URL;

    return true;
  }

  async function waitForSharerInfo(timeoutMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const user = getTargetSharerInfo();
      if (user && user.hash && user.hash !== 'null') return user;
      await sleep(200);
    }
    return null;
  }

  async function processSharePageFlow(urlAtStart) {
    const currentUser = await waitForSharerInfo(12000);

    if (currentUser && featureEnabled('quarkSharerFilter')) {
      const blockedList = getBlockedList();
      if (blockedList.some((u) => u.name === currentUser.name && u.hash === currentUser.hash && getEntrySite(u) === SITE_HOST)) {
        console.warn(`[夸克懒得点] 已屏蔽: ${currentUser.name}`);
        showBlockedOverlay(currentUser);
        return true;
      }

      const warningList = getWarningList();
      if (warningList.some((u) => u.name === currentUser.name && u.hash === currentUser.hash && getEntrySite(u) === SITE_HOST)) {
        console.warn(`[夸克懒得点] 警告用户: ${currentUser.name}`);
        showWarningToast(currentUser);
      }
    }

    if (window.location.href !== urlAtStart) {
      console.log('[夸克懒得点] 页面已跳转，终止当前保存流程');
      return false;
    }

    const saveOk = await executeSaveAction(currentUser);
    if (!saveOk) return false;

    return true;
  }

  async function handleSharePage() {
    if (!isAutoSaveEnabled()) return;

    const currentUrl = window.location.href;

    if (Runtime.shareFlowDone.has(currentUrl)) return;
    if (Runtime.shareFlowRunning && Runtime.shareFlowUrl === currentUrl) return;

    Runtime.shareFlowRunning = true;
    Runtime.shareFlowUrl = currentUrl;

    await sleep(FLOW.shareStartDelayMs);

    if (!Runtime.pullDoneForUrl.has(currentUrl)) {
      await pullCloudWithSoftTimeout(FLOW.pullWaitMs);
      Runtime.pullDoneForUrl.add(currentUrl);
    }

    try {
      let success = false;
      for (let attempt = 1; attempt <= FLOW.flowRetry; attempt++) {
        if (window.location.href !== currentUrl) {
          break;
        }

        console.log(`[夸克懒得点] 尝试自动保存 (${attempt}/${FLOW.flowRetry})`);
        success = await processSharePageFlow(currentUrl);
        if (success) break;

        await sleep(700 * Math.pow(2, attempt - 1));
      }

      if (success) {
        Runtime.shareFlowDone.add(currentUrl);
      } else {
        console.warn('[夸克懒得点] 自动保存失败，等待下一次页面变更重试');
      }
    } finally {
      Runtime.shareFlowRunning = false;
      Runtime.shareFlowUrl = '';
    }
  }

  async function handleListPage() {
    const currentUrl = window.location.href;
    const pendingSourceClick = hasPendingSourceClick();
    if (Runtime.listFlowDone.has(currentUrl) && !pendingSourceClick) return;

    await sleep(FLOW.listAutoCheckDelayMs);

    if (pendingSourceClick) {
      const sourceFromShare = await waitForElement(['div[title="来自：分享"]', '[title="来自：分享"]'], {
        timeoutMs: FLOW.selectorWaitMs,
        visibleOnly: true
      });
      if (sourceFromShare && safeClick(sourceFromShare)) {
        clearPendingSourceClick();
      } else {
        console.warn('[夸克懒得点] 未找到来自：分享筛选项，等待后续重试');
      }
    }

    // 自动全选统一由 RpcHelper.scheduleAutoSelect 在列表渲染后延迟执行，此处只处理"来自：分享"跳转筛选。
    Runtime.listFlowDone.add(currentUrl);
  }

  function scheduleHandle(reason) {
    if (Runtime.scheduleTimer) return;

    Runtime.scheduleReason = reason;
    Runtime.scheduleTimer = setTimeout(() => {
      Runtime.scheduleTimer = null;
      if (shouldHandleSharePage()) {
        if (!isAutoSaveEnabled()) return;
        handleSharePage().catch((error) => {
          console.error('[夸克懒得点] share 流程异常:', error);
        });
      } else if (shouldHandleListPage()) {
        handleListPage().catch((error) => {
          console.error('[夸克懒得点] list 流程异常:', error);
        });
      }
    }, reason === 'init' ? 0 : 120);
  }

  function bindRouteWatcher() {
    if (Runtime.routeHooksBound) return;
    Runtime.routeHooksBound = true;

    const notifyRouteChange = () => {
      const now = window.location.href;
      if (now === Runtime.lastUrl) return;
      Runtime.lastUrl = now;
      scheduleHandle('route-change');
    };

    window.addEventListener('popstate', notifyRouteChange);
    window.addEventListener('hashchange', notifyRouteChange);

    const rawPushState = history.pushState;
    history.pushState = function () {
      const result = rawPushState.apply(this, arguments);
      notifyRouteChange();
      return result;
    };

    const rawReplaceState = history.replaceState;
    history.replaceState = function () {
      const result = rawReplaceState.apply(this, arguments);
      notifyRouteChange();
      return result;
    };

    Runtime.routePollId = setInterval(notifyRouteChange, FLOW.routePollMs);

    const bodyObserver = new MutationObserver(() => {
      if (isAutoSaveEnabled() && shouldHandleSharePage() && !Runtime.shareFlowDone.has(window.location.href)) {
        scheduleHandle('dom-change');
        return;
      }

      if (shouldHandleListPage() && !Runtime.listFlowDone.has(window.location.href)) {
        scheduleHandle('dom-change');
      }
    });

    bodyObserver.observe(document.documentElement || document.body, {
      childList: true,
      subtree: true
    });
  }

  // ===== RPC 切换 & 下载路径选择；完全独立于其他下载脚本 =====
  const RpcHelper = (function () {
    const SETTINGS_KEY = 'rpc_helper_settings_v3';
    const CONTAINER_ID = 'qk-rpc-container';
    const MODAL_ID = 'qk-rpc-settings-modal';
    const STYLE_ID = 'qk-rpc-style';
    const LEGACY_CONTAINER_ID = 'rpc-helper-container';
    const ACTIVE_KEY = 'rpc_active_v1';
    const ON_QUARK = SITE_HOST === 'pan.quark.cn';
    const ON_TCLOUD = SITE_HOST === 'cloud.189.cn';
    const ON_XUNLEI = SITE_HOST === 'pan.xunlei.com';
    const ON_MCLOUD = SITE_HOST === 'yun.139.com';
    const ON_123PAN = SITE_HOST === 'yun.123pan.cn';
    const ON_115 = SITE_HOST === '115.com';
    const ON_115_AUX = is115RelatedHost() && !ON_115;
    const ON_BAIDU = SITE_HOST === 'pan.baidu.com';
    const ON_UC = SITE_HOST === 'drive.uc.cn';
    const ON_GUANGYA = SITE_HOST === 'www.guangyapan.com';
    const QUARK_API = 'https://drive-pc.quark.cn';
    // 网页版下载接口对大文件返回 23018 "download file size limit"；PC 客户端接口（PC UA）不限。
    const QUARK_PC_LINK_API = 'https://drive-pc.quark.cn/1/clouddrive/file/download?pr=ucpro&fr=pc&sys=win32&ve=6.9.7.761';
    const QUARK_TOKEN_API = 'https://drive-social-api.quark.cn/1/clouddrive/chat/conv/file/acquire_dl_token?pr=ucpro&fr=pc&sys=win32&ve=6.9.7.761&fr=win&la=zh-CN&ch=pckk%40product_guanwan';
    const QUARK_TOKEN_KEY = 'quark_social_token';
    const QUARK_PC_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 QuarkPC/6.9.7.761 QuarkCloudDrivePC/6.9.7.761 quark-cloud-drive/2.5.40';
    const QUARK_LINK_BATCH = 15;
    const QUARK_CONFIRM_OVER = 300;
    const WIN_DEFAULT_PATH = '/Users/Administrator/Downloads';

    const DEFAULT_SETTINGS = {
      version: 3,
      rpcConfigs: [
        {
          id: 'local-win',
          name: '本地Win',
          domain: 'http://127.0.0.1',
          port: '6800',
          token: '',
          path: '/jsonrpc'
        },
        {
          id: 'remote-linux',
          name: '远程Linux',
          domain: 'https://your-linux-server.example.com',
          port: '443',
          token: '',
          path: '/jsonrpc'
        }
      ],
      downloadPaths: [
        { id: 'p-win-downloads', path: '/Users/Administrator/Downloads' },
        { id: 'p-win-desktop', path: '/Users/Administrator/Desktop' },
        { id: 'p-linux-downloads', path: '/root/downloads' },
        { id: 'p-linux-s26', path: '/root/downloads/s25' },
        { id: 'p-linux-x25', path: '/root/downloads/x25' },
        { id: 'p-linux-26', path: '/root/downloads/s26' }
      ],
      rpcPathBindings: {
        'local-win': {
          pathIds: ['p-win-downloads', 'p-win-desktop'],
          defaultPathId: 'p-win-downloads'
        },
        'remote-linux': {
          pathIds: ['p-linux-downloads', 'p-linux-s26', 'p-linux-x25', 'p-linux-26'],
          defaultPathId: 'p-linux-downloads'
        }
      }
    };

    function deepClone(obj) {
      return JSON.parse(JSON.stringify(obj));
    }

    function normalizePath(value) {
      return typeof value === 'string' ? value.trim() : '';
    }

    function makeId(prefix) {
      return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    }

    function isValidHttpUrl(value) {
      try {
        const url = new URL(value);
        return url.protocol === 'http:' || url.protocol === 'https:';
      } catch (err) {
        return false;
      }
    }

    function splitServerEndpoint(endpoint, fallbackPort) {
      const value = String(endpoint || '').trim();
      if (!value) return null;
      if (!isValidHttpUrl(value)) return null;

      const url = new URL(value);
      const port = String(url.port || fallbackPort || (url.protocol === 'https:' ? '443' : '80')).trim();
      return {
        domain: `${url.protocol}//${url.hostname}`,
        port
      };
    }

    function composeServerEndpoint(domain, port) {
      const d = String(domain || '').trim();
      const p = String(port || '').trim();
      if (!d) return '';
      if (!isValidHttpUrl(d)) return d;
      const parsed = splitServerEndpoint(d, p || undefined);
      if (!parsed) return d;
      return `${parsed.domain}:${parsed.port}`;
    }

    function ensureStyle() {
      if (document.getElementById(STYLE_ID)) return;
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = `
        .qk-rpc-tabs { display:flex; flex-wrap:wrap; gap:10px; padding:14px 18px; background:#fff; border-bottom:1px solid #d7e0ea; }
        .qk-rpc-tabs button { min-height:40px; min-width:112px; padding:8px 18px; border:2px solid #bdc8d4; border-radius:9px; background:#f8fafc; color:#203043; cursor:pointer; font-size:14px; font-weight:700; line-height:1.3; box-shadow:0 2px 4px rgba(15,23,42,.10); }
        .qk-rpc-tabs button:hover { border-color:#b45309; color:#7c2d12; background:#fff7ed; }
        .qk-rpc-tabs button[aria-selected="true"] { background:#b45309; border-color:#92400e; color:#fff; box-shadow:0 3px 9px rgba(146,64,14,.28); }
        .qk-rpc-extra { padding:14px 16px; overflow:auto; max-height:65vh; }
        .qk-rpc-extra .qk-lazy-settings-grid { display:block !important; }
        .qk-rpc-extra .qk-lazy-settings-grid > * { margin-bottom:10px; }
        .qk-rpc-extra .qk-lazy-settings-grid > [hidden] { display:none !important; }
        .rpc-helper-body[hidden], .rpc-helper-footer[hidden], .qk-rpc-extra[hidden], .qk-rpc-extra [hidden], .qk-rpc-feature-page[hidden], #${CONTAINER_ID} [hidden] { display:none !important; }
        .qk-rpc-extra [data-qk-global-tab][hidden] { display:none !important; }
        .qk-lists-two-columns > * { min-width:0; }
        @media (max-width:720px) { .qk-lists-two-columns { grid-template-columns:1fr !important; } }
        .qk-rpc-115-row { display:flex; align-items:center; gap:10px; padding:12px 24px; min-height:54px; box-sizing:border-box; border-bottom:1px solid #eef0f4; }
        .btn-operate:has(> .qk-rpc-quark-row) { flex-wrap:wrap !important; }
        .btn-operate > .qk-rpc-quark-row { order:2; flex:0 0 100%; display:flex; align-items:center; min-width:0; height:44px; padding:4px 0; box-sizing:border-box; }
        .btn-operate > .qk-rpc-quark-row > #${CONTAINER_ID} { margin-left:0; }
        #${CONTAINER_ID} {
          display: inline-flex;
          gap: 4px;
          align-items: center;
          margin-right: 10px;
          padding: 3px 4px;
          border-radius: 7px;
          background: #ffffff;
          border: 1px solid #cbd5e1;
          box-shadow: 0 1px 2px rgba(15, 23, 42, 0.08);
          vertical-align: middle;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
        }
        .rpc-helper-select {
          height: 28px;
          border: 1px solid transparent;
          border-radius: 5px;
          padding: 0 8px;
          background: #f1f5f9;
          color: #1e293b;
          font-size: 13px;
          outline: none;
        }
        .rpc-helper-select:hover { background: #e8eef6; }
        .rpc-helper-select:focus {
          border-color: #2563eb;
          background: #fff;
          box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.14);
        }
        .rpc-helper-btn {
          height: 34px;
          min-width: 68px;
          border: 1px solid #cbd5e1;
          border-radius: 6px;
          padding: 0 12px;
          background: #fff;
          color: #334155;
          cursor: pointer;
          transition: border-color .15s ease, background .15s ease, color .15s ease, box-shadow .15s ease;
          font-size: 13px;
          font-weight: 600;
        }
        .rpc-helper-btn:hover {
          border-color: #94a3b8;
          color: #0f172a;
          background: #f8fafc;
        }
        .rpc-helper-btn:focus-visible {
          outline: none;
          border-color: #2563eb;
          box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.18);
        }
        .rpc-helper-btn-primary {
          background: #2563eb;
          border-color: #2563eb;
          color: #fff;
        }
        .rpc-helper-btn-primary:hover {
          background: #1d4ed8;
          border-color: #1d4ed8;
          color: #fff;
        }
        .rpc-helper-btn-secondary {
          border-color: #8db1e1;
          color: #1d4ed8;
          background: #eff6ff;
        }
        .rpc-helper-btn-secondary:hover {
          border-color: #2563eb;
          color: #1d4ed8;
          background: #dbeafe;
        }
        .rpc-helper-btn-add {
          margin-top: 4px;
          border-style: dashed;
          color: #1d4ed8;
          background: #f8fbff;
        }
        .rpc-helper-btn-add:hover { background: #eff6ff; }
        .rpc-helper-btn-danger {
          min-width: 0;
          color: #b4233a;
          border-color: #f0c6cd;
          background: #fff;
        }
        .rpc-helper-btn-danger:hover {
          color: #9f1239;
          border-color: #e28b99;
          background: #fff1f2;
        }
        #${CONTAINER_ID} .rpc-helper-btn {
          height: 28px;
          min-width: 0;
          border-color: transparent;
          border-radius: 5px;
          padding: 0 9px;
          background: #eaf2ff;
          color: #1d4ed8;
        }
        #${CONTAINER_ID} .rpc-helper-btn:hover { background: #dbeafe; }
        #${CONTAINER_ID} .qk-rpc-setting-tab { color:#5b4ac8 !important; background:#f0edff !important; border:1px solid #d8d0ff !important; }
        #${CONTAINER_ID} .qk-rpc-server { color:#175db2 !important; background:#e8f2ff !important; border:1px solid #b9d8fb !important; }
        #${CONTAINER_ID} .qk-rpc-path { color:#18704a !important; background:#e8f8ee !important; border:1px solid #b8e6cb !important; }
        #${CONTAINER_ID} .qk-rpc-send { color:#fff !important; background:#e66b21 !important; border:1px solid #dd6018 !important; }
        #${CONTAINER_ID} .qk-rpc-send:hover { color:#fff !important; background:#cc5411 !important; border-color:#cc5411 !important; }
        #${CONTAINER_ID} .qk-rpc-send:disabled { color:#fff !important; background:#b88762 !important; border-color:#b88762 !important; }
        .qk-rpc-quark-row > .qk-rpc-load-all { min-height:32px; border-color:#99d2c4; color:#087b63; background:#e7f8f2; }
        .qk-rpc-quark-row > .qk-rpc-load-all:hover { border-color:#087b63; background:#d3f3e8; }
        #${MODAL_ID} {
          position: fixed;
          inset: 0;
          background: rgba(7, 15, 28, 0.66);
          backdrop-filter: blur(5px);
          z-index: 999999;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 16px;
          box-sizing: border-box;
        }
        #${MODAL_ID}.qk-rpc-aux-modal .rpc-helper-panel { max-height:min(90vh, 900px); display:flex; flex-direction:column; overflow:hidden; }
        #${MODAL_ID}.qk-rpc-aux-modal .qk-rpc-tabs { flex:none; }
        #${MODAL_ID}.qk-rpc-aux-modal .qk-rpc-extra { min-height:0; max-height:none; flex:1; overflow:auto; }
        #${MODAL_ID}.qk-rpc-aux-modal .qk-rpc-tabs .qk-rpc-aux-close { min-width:60px !important; margin-left:auto !important; background:#fff1f2 !important; color:#9f1239 !important; border-color:#fecdd3 !important; }
        #${MODAL_ID}.qk-rpc-aux-modal .qk-rpc-extra .qk-lazy-settings-grid { display:block !important; }
        #${MODAL_ID}.qk-rpc-aux-modal .qk-rpc-extra .qk-lazy-settings-grid > [hidden] { display:none !important; }
        #${MODAL_ID}.qk-rpc-aux-modal .qk-rpc-extra .qk-lists-two-columns { display:grid !important; width:100%; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; }
        #${MODAL_ID}.qk-rpc-aux-modal .qk-rpc-extra .qk-lists-two-columns > div:not(:first-child) { min-width:0; }
        #${MODAL_ID}.qk-rpc-aux-modal .qk-rpc-extra .qk-rpc-feature-page { padding:4px 2px 12px; }
        @media(max-width:720px){ #${MODAL_ID}.qk-rpc-aux-modal .qk-rpc-extra .qk-lists-two-columns { grid-template-columns:1fr !important; } }
        .rpc-helper-panel {
          width: 1160px;
          max-width: 94vw;
          max-height: 88vh;
          overflow: auto;
          background: #f1f5f9;
          border-radius: 12px;
          border: 1px solid rgba(148, 163, 184, 0.45);
          box-shadow: 0 28px 70px rgba(0, 0, 0, 0.35);
          color: #1e293b;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
        }
        .rpc-helper-head {
          position: sticky;
          top: 0;
          z-index: 2;
          padding: 20px 22px 18px;
          border-bottom: 1px solid rgba(148, 163, 184, 0.3);
          background: #0f1e33;
        }
        .rpc-helper-title {
          margin: 0;
          color: #f8fafc;
          font-size: 19px;
          font-weight: 700;
          letter-spacing: 0.01em;
        }
        .rpc-helper-desc {
          margin: 7px 0 0;
          color: #a8bdd8;
          font-size: 12px;
          line-height: 1.55;
        }
        .rpc-helper-body {
          display: grid;
          grid-template-columns: minmax(280px, 0.82fr) minmax(420px, 1.18fr);
          gap: 12px;
          padding: 14px 16px 16px;
        }
        .rpc-helper-section {
          min-width: 0;
          border: 1px solid #d7e0ea;
          border-radius: 9px;
          margin: 0;
          background: #fff;
          padding: 13px;
          box-shadow: 0 1px 2px rgba(15, 23, 42, 0.03);
        }
        .rpc-helper-body > .rpc-helper-section:first-child { grid-column: 1 / -1; }
        .rpc-helper-section-title {
          display: flex;
          align-items: center;
          gap: 8px;
          font-weight: 700;
          font-size: 14px;
          color: #172b4d;
          margin-bottom: 12px;
          letter-spacing: 0.01em;
        }
        .rpc-helper-section-title::before {
          width: 3px;
          height: 15px;
          border-radius: 2px;
          background: #2563eb;
          content: '';
        }
        .rpc-helper-row {
          display: grid;
          gap: 8px;
          margin-bottom: 7px;
          padding: 9px;
          border: 1px solid #e2e8f0;
          border-radius: 7px;
          background: #f8fafc;
          transition: border-color .15s ease, background .15s ease;
        }
        .rpc-helper-row:hover {
          border-color: #c7d5e5;
          background: #fff;
        }
        .rpc-helper-row.rpc-row {
          grid-template-columns: 130px minmax(220px, 2fr) minmax(100px, 0.9fr) 110px 108px 64px;
          align-items: center;
        }
        .rpc-helper-row.path-row {
          grid-template-columns: minmax(0, 1fr) 64px;
        }
        .rpc-helper-row.bind-editor-row {
          grid-template-columns: 132px minmax(0, 1fr);
          align-items: center;
        }
        .rpc-helper-rpc-columns {
          display: grid;
          grid-template-columns: 130px minmax(220px, 2fr) minmax(100px, 0.9fr) 110px 108px 64px;
          gap: 8px;
          padding: 0 10px 7px;
          color: #718096;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }
        .rpc-helper-input {
          height: 36px;
          border: 1px solid #cbd5e1;
          border-radius: 6px;
          padding: 0 10px;
          outline: none;
          box-sizing: border-box;
          width: 100%;
          font-size: 13px;
          color: #1e293b;
          background: #fff;
          transition: border-color .15s ease, box-shadow .15s ease;
        }
        .rpc-helper-input:focus {
          border-color: #2563eb;
          box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.13);
        }
        .rpc-helper-path-chips {
          display: flex;
          flex-wrap: wrap;
          gap: 7px;
          min-height: 52px;
          box-sizing: border-box;
          padding: 8px;
          border: 1px solid #cbd5e1;
          border-radius: 6px;
          background: #fff;
        }
        .rpc-helper-path-chip {
          min-height: 30px;
          border: 1px solid #d5dee9;
          border-radius: 999px;
          padding: 4px 10px;
          background: #f8fafc;
          color: #475569;
          cursor: pointer;
          font-size: 12px;
          line-height: 1.25;
          transition: border-color .15s ease, background .15s ease, color .15s ease, transform .15s ease;
          overflow-wrap: anywhere;
        }
        .rpc-helper-path-chip:hover {
          border-color: #93b7e6;
          background: #eff6ff;
          color: #1d4ed8;
        }
        .rpc-helper-path-chip.is-selected {
          border-color: #2563eb;
          background: #2563eb;
          color: #fff;
          box-shadow: 0 1px 2px rgba(37, 99, 235, 0.2);
        }
        .rpc-helper-path-chip.is-selected:hover { background: #1d4ed8; }
        .rpc-helper-path-chip:focus-visible {
          outline: none;
          box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.2);
        }
        .rpc-helper-path-chip:disabled {
          cursor: default;
          opacity: 0.8;
        }
        .rpc-helper-label {
          font-size: 13px;
          color: #475569;
          font-weight: 600;
        }
        .rpc-helper-empty {
          color: #64748b;
          font-size: 12px;
          padding: 10px 2px;
        }
        .rpc-helper-section-heading {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 10px;
          margin-bottom: 12px;
        }
        .rpc-helper-section-heading .rpc-helper-section-title { margin-bottom: 0; }
        .rpc-helper-check-status {
          min-height: 36px;
          display: flex;
          align-items: center;
          box-sizing: border-box;
          border: 1px solid #dbe3ed;
          border-radius: 6px;
          padding: 4px 7px;
          background: #fff;
          font-size: 12px;
          line-height: 1.35;
          color: #64748b;
          overflow-wrap: anywhere;
        }
        .rpc-helper-check-status.is-checking { color: #1d4ed8; background: #eff6ff; border-color: #bfdbfe; }
        .rpc-helper-check-status.is-success { color: #15803d; background: #f0fdf4; border-color: #bbf7d0; }
        .rpc-helper-check-status.is-error { color: #b4233a; background: #fff1f2; border-color: #fecdd3; }
        .rpc-helper-btn:disabled {
          cursor: not-allowed;
          opacity: 0.6;
        }
        .rpc-helper-error {
          margin: 0 16px 12px;
          padding: 10px 12px;
          border-radius: 7px;
          border: 1px solid #fecdd3;
          background: #fff1f2;
          color: #b4233a;
          font-size: 12px;
          display: none;
        }
        .rpc-helper-footer {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 10px;
          padding: 13px 16px;
          border-top: 1px solid #d7e0ea;
          background: rgba(255, 255, 255, 0.96);
          position: sticky;
          bottom: 0;
          z-index: 2;
        }
        .rpc-helper-group { display: flex; gap: 8px; }
        .rpc-helper-tip { color: #64748b; font-size: 12px; }
        @media (max-width: 960px) {
          .rpc-helper-panel { max-width: 96vw; }
          .rpc-helper-body { grid-template-columns: 1fr; }
          .rpc-helper-body > .rpc-helper-section:first-child { grid-column: auto; }
          .rpc-helper-rpc-columns { display: none; }
          .rpc-helper-row.rpc-row,
          .rpc-helper-row.path-row,
          .rpc-helper-row.bind-editor-row { grid-template-columns: 1fr; }
        }
        @media (max-width: 620px) {
          #${MODAL_ID} { align-items: stretch; padding: 0; }
          #${MODAL_ID}.qk-rpc-aux-modal .rpc-helper-panel { max-width:100vw; width:100%; max-height:100vh; border:0; border-radius:0; }
          .rpc-helper-panel { max-width: none; max-height: none; width: 100%; border: 0; border-radius: 0; }
          .rpc-helper-head { padding: 18px 16px; }
          .rpc-helper-body { gap: 10px; padding: 10px; }
          .rpc-helper-section { padding: 11px; }
          .rpc-helper-footer { align-items: stretch; flex-direction: column; padding: 12px; }
          .rpc-helper-group { justify-content: flex-end; }
          .rpc-helper-group .rpc-helper-btn { flex: 1; }
        }
      `;
      style.textContent += `
        .qk-rpc-115-row { padding:12px 24px; min-height:54px; }
        .qk-rpc-guangya-row { display:flex; align-items:center; flex-wrap:wrap; gap:8px; padding:4px 0 10px 28px; min-height:44px; box-sizing:border-box; }
        .qk-rpc-guangya-row #${CONTAINER_ID} { margin:0; }
        /* 139、迅雷等站点把全局 input[type=checkbox] 设成 appearance:none、宽高 0，导致脚本设置里的勾选框看不见。 */
        #${MODAL_ID} input[type="checkbox"], [data-qk-log-center] input[type="checkbox"], .qk-lazy-settings-grid input[type="checkbox"] {
          -webkit-appearance: checkbox !important; appearance: auto !important;
          display: inline-block !important; position: static !important; flex: 0 0 auto !important;
          width: 16px !important; height: 16px !important; min-width: 16px !important; margin: 0 !important; padding: 0 !important;
          opacity: 1 !important; visibility: visible !important; clip: auto !important; transform: none !important;
          accent-color: #2563eb; cursor: pointer; vertical-align: middle;
        }
        #${MODAL_ID} input[type="checkbox"]::before, #${MODAL_ID} input[type="checkbox"]::after { content: none !important; display: none !important; }
        #qk-rpc-adv-retry { position:fixed; inset:0; z-index:1000000; display:flex; align-items:center; justify-content:center; padding:16px; box-sizing:border-box; background:rgba(15,23,42,.62); backdrop-filter:blur(4px); }
        #qk-rpc-adv-retry, #qk-rpc-adv-retry * { box-sizing:border-box; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif; }
        #qk-rpc-adv-retry .qk-adv-box { width:600px; max-width:100%; max-height:min(92vh,860px); display:flex; flex-direction:column; overflow:hidden; background:#f8fafc; color:#1e293b; border-radius:16px; box-shadow:0 24px 64px rgba(0,0,0,.38); }
        #qk-rpc-adv-retry .qk-adv-head { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:16px 20px; background:#292524; color:#fff; }
        #qk-rpc-adv-retry .qk-adv-title { display:flex; align-items:center; gap:10px; font-size:18px; font-weight:700; }
        #qk-rpc-adv-retry .qk-adv-count { padding:2px 10px; border-radius:999px; background:#b45309; font-size:13px; font-weight:600; }
        #qk-rpc-adv-retry .qk-adv-close { width:40px !important; height:40px !important; min-width:0 !important; padding:0 !important; margin:0 !important; border:0 !important; border-radius:10px !important; background:rgba(255,255,255,.12) !important; color:#fff !important; font-size:24px !important; line-height:40px !important; cursor:pointer; }
        #qk-rpc-adv-retry .qk-adv-close:hover { background:rgba(255,255,255,.24) !important; }
        #qk-rpc-adv-retry .qk-adv-body { flex:1; min-height:0; overflow:auto; padding:16px 20px 4px; }
        #qk-rpc-adv-retry .qk-adv-section { margin-bottom:16px; }
        #qk-rpc-adv-retry .qk-adv-label { margin:0 0 8px; font-size:14px; font-weight:700; color:#44403c; }
        #qk-rpc-adv-retry .qk-adv-options { display:grid; grid-template-columns:repeat(auto-fill,minmax(170px,1fr)); gap:10px; }
        #qk-rpc-adv-retry .qk-adv-option { appearance:none !important; -webkit-appearance:none !important; display:flex !important; flex-direction:column; align-items:flex-start; justify-content:center; gap:3px; min-height:58px !important; height:auto !important; width:100% !important; margin:0 !important; padding:10px 14px !important; border:2px solid #d6d3d1 !important; border-radius:12px !important; background:#fff !important; color:#292524 !important; text-align:left; cursor:pointer; box-shadow:0 1px 2px rgba(0,0,0,.05); transition:border-color .15s, background .15s, box-shadow .15s; }
        #qk-rpc-adv-retry .qk-adv-option.is-wide { grid-column:1 / -1; min-height:48px !important; }
        #qk-rpc-adv-retry .qk-adv-options.is-two { grid-template-columns:repeat(2,minmax(0,1fr)); }
        #qk-rpc-adv-retry .qk-adv-btn:focus, #qk-rpc-adv-retry .qk-adv-option:focus { outline:none; }
        #qk-rpc-adv-retry .qk-adv-btn:focus-visible { box-shadow:0 0 0 3px rgba(180,83,9,.3); }
        #qk-rpc-adv-retry .qk-adv-option:hover:not(:disabled) { border-color:#d97706 !important; background:#fffbeb !important; }
        #qk-rpc-adv-retry .qk-adv-option:focus-visible { outline:none; box-shadow:0 0 0 3px rgba(180,83,9,.3); }
        #qk-rpc-adv-retry .qk-adv-option[aria-checked="true"] { border-color:#b45309 !important; background:#fff7ed !important; box-shadow:inset 0 0 0 1px #b45309, 0 2px 8px rgba(180,83,9,.18); }
        #qk-rpc-adv-retry .qk-adv-option:disabled { opacity:.45; cursor:not-allowed; }
        #qk-rpc-adv-retry .qk-adv-main { display:flex; align-items:center; gap:8px; max-width:100%; font-size:15px; font-weight:700; line-height:1.35; overflow-wrap:anywhere; }
        #qk-rpc-adv-retry .qk-adv-main::before { content:''; flex:none; width:16px; height:16px; border-radius:50%; border:2px solid #a8a29e; background:#fff; box-sizing:border-box; }
        #qk-rpc-adv-retry .qk-adv-option[aria-checked="true"] .qk-adv-main::before { border:5px solid #b45309; }
        #qk-rpc-adv-retry .qk-adv-sub { padding-left:24px; font-size:12px; font-weight:400; line-height:1.4; color:#78716c; overflow-wrap:anywhere; }
        #qk-rpc-adv-retry .qk-adv-hint { grid-column:1 / -1; padding:8px 2px; font-size:12px; color:#78716c; }
        #qk-rpc-adv-retry .qk-adv-foot { display:flex; gap:12px; padding:14px 20px; border-top:1px solid #e7e5e4; background:#fff; }
        #qk-rpc-adv-retry .qk-adv-btn { flex:1; appearance:none !important; min-height:48px !important; height:auto !important; margin:0 !important; padding:0 20px !important; border:2px solid #d6d3d1 !important; border-radius:12px !important; background:#fff !important; color:#44403c !important; font-size:16px !important; font-weight:700 !important; cursor:pointer; }
        #qk-rpc-adv-retry .qk-adv-btn:hover { border-color:#a8a29e !important; background:#fafaf9 !important; }
        #qk-rpc-adv-retry .qk-adv-btn.is-primary { flex:2; border-color:#b45309 !important; background:#b45309 !important; color:#fff !important; }
        #qk-rpc-adv-retry .qk-adv-btn.is-primary:hover { background:#92400e !important; border-color:#92400e !important; }
        #qk-rpc-adv-retry .qk-adv-btn:disabled { opacity:.5; cursor:not-allowed; }
        @media (max-width:620px) {
          #qk-rpc-adv-retry { padding:0; align-items:flex-end; }
          #qk-rpc-adv-retry .qk-adv-box { max-height:94vh; border-radius:16px 16px 0 0; }
          #qk-rpc-adv-retry .qk-adv-options { grid-template-columns:1fr; }
        }
        [data-qk-log-center] button:disabled { opacity: .45; cursor: not-allowed; }
        #${MODAL_ID} .qk-rpc-feature-page label, #${MODAL_ID} .qk-lazy-settings-grid label { font-size: 13px !important; line-height: 1.5 !important; font-weight: 400 !important; color: #1e293b !important; }
        .qk-rpc-115-row #${CONTAINER_ID} { gap:10px; padding:0; margin:0; border:0; box-shadow:none; background:transparent; }
        .qk-rpc-115-row :is(.rpc-helper-select,.rpc-helper-btn) { min-height:32px; }
        /* 115 白底下使用高对比暖色，避免被站点的蓝色主题覆盖。 */
        .qk-rpc-115-row #${CONTAINER_ID} .qk-rpc-setting-tab { color:#78350f !important; background:#fff7ed !important; border:2px solid #b45309 !important; min-height:36px; }
        .qk-rpc-115-row #${CONTAINER_ID} .qk-rpc-setting-tab:hover { color:#fff !important; background:#b45309 !important; }
        .qk-rpc-115-row #${CONTAINER_ID} .qk-rpc-retry-failed,
        #${CONTAINER_ID} .qk-rpc-retry-failed { color:#9a3412 !important; background:#ffedd5 !important; border:1px solid #c2410c !important; }
        #${MODAL_ID} .qk-rpc-tabs button { appearance:none !important; -webkit-appearance:none !important; display:inline-flex !important; align-items:center !important; justify-content:center !important; min-width:112px !important; min-height:40px !important; padding:8px 18px !important; color:#203043 !important; background:#f8fafc !important; border:2px solid #bdc8d4 !important; font-size:14px !important; font-weight:700 !important; }
        #${MODAL_ID} .qk-rpc-tabs button[aria-selected="true"] { background:#b45309 !important; border-color:#92400e !important; color:#fff !important; }
        /* 115 网盘原生样式会覆盖普通按钮，给本脚本面板控件明确的暖色对比度。 */
        #${MODAL_ID} .rpc-helper-head { background:#292524 !important; }
        #${MODAL_ID} .rpc-helper-section-title { color:#292524 !important; }
        #${MODAL_ID} .rpc-helper-section-title::before { background:#b45309 !important; }
        #${MODAL_ID} .rpc-helper-btn-primary { background:#b45309 !important; border-color:#92400e !important; color:#fff !important; }
      `;
      document.head.appendChild(style);
    }

    function getPathIdByPath(pathList, pathValue) {
      const value = normalizePath(pathValue);
      if (!value) return '';
      const found = pathList.find((item) => item.path === value);
      return found ? found.id : '';
    }

    function sanitizePathList(input) {
      const src = Array.isArray(input) ? input : [];
      const result = [];
      src.forEach((item, index) => {
        const obj = item && typeof item === 'object' ? item : {};
        const path = normalizePath(obj.path || item);
        if (!path) return;
        const id = String(obj.id || makeId(`path${index}`));
        if (result.some((x) => x.path === path)) return;
        result.push({ id, path });
      });
      return result;
    }

    function sanitizeRpcConfig(input, index) {
      const cfg = input && typeof input === 'object' ? input : {};
      const endpointRaw = String(cfg._serverEndpoint || '').trim();
      const endpointParsed = endpointRaw ? splitServerEndpoint(endpointRaw) : null;
      const domain = endpointParsed ? endpointParsed.domain : String(cfg.domain || '').trim();
      const port = endpointParsed ? endpointParsed.port : String(cfg.port || '').trim();

      return {
        id: String(cfg.id || makeId(`rpc${index}`)),
        name: String(cfg.name || `RPC-${index + 1}`).trim(),
        domain,
        port,
        token: String(cfg.token || ''),
        path: normalizePath(cfg.path || '/jsonrpc') || '/jsonrpc'
      };
    }

    function buildDefaultBinding(pathIds) {
      return {
        pathIds: pathIds.length > 0 ? pathIds : [],
        defaultPathId: pathIds.length > 0 ? pathIds[0] : ''
      };
    }

    function sanitizeSettings(rawInput) {
      const defaults = deepClone(DEFAULT_SETTINGS);
      const source = rawInput && typeof rawInput === 'object' ? rawInput : {};

      let downloadPaths = sanitizePathList(source.downloadPaths);
      if (downloadPaths.length === 0) {
        downloadPaths = sanitizePathList(defaults.downloadPaths);
      }

      const ensurePath = (pathValue) => {
        const p = normalizePath(pathValue);
        if (!p) return '';
        const existing = downloadPaths.find((item) => item.path === p);
        if (existing) return existing.id;
        const id = makeId('path');
        downloadPaths.push({ id, path: p });
        return id;
      };

      const rawRpcs = Array.isArray(source.rpcConfigs) ? source.rpcConfigs : defaults.rpcConfigs;
      let rpcConfigs = rawRpcs.map((item, index) => sanitizeRpcConfig(item, index));
      rpcConfigs = rpcConfigs.filter((rpc) => rpc.domain && rpc.port);
      if (rpcConfigs.length === 0) {
        rpcConfigs = defaults.rpcConfigs.map((item, index) => sanitizeRpcConfig(item, index));
      }

      const pathIdSet = () => new Set(downloadPaths.map((item) => item.id));
      const rawBindings = source.rpcPathBindings && typeof source.rpcPathBindings === 'object'
        ? source.rpcPathBindings
        : {};

      const bindings = {};
      rpcConfigs.forEach((rpc) => {
        const rawBinding = rawBindings[rpc.id] && typeof rawBindings[rpc.id] === 'object' ? rawBindings[rpc.id] : {};
        const idsFromBinding = Array.isArray(rawBinding.pathIds) ? rawBinding.pathIds.map(String) : [];
        const validIds = idsFromBinding.filter((id) => pathIdSet().has(id));

        const legacyRpcRaw = rawRpcs.find((item) => item && typeof item === 'object' && String(item.id || '') === rpc.id) || {};
        const legacyPaths = Array.isArray(legacyRpcRaw.downloadPaths) ? legacyRpcRaw.downloadPaths : [];
        legacyPaths.forEach((p) => {
          ensurePath(p);
        });

        let finalIds = validIds;
        if (finalIds.length === 0 && legacyPaths.length > 0) {
          finalIds = legacyPaths.map((p) => ensurePath(p)).filter((id) => Boolean(id));
        }

        const legacyDefault = normalizePath(legacyRpcRaw.defaultPath || '');
        let defaultPathId = String(rawBinding.defaultPathId || '');
        if (!pathIdSet().has(defaultPathId) && legacyDefault) {
          defaultPathId = ensurePath(legacyDefault);
        }

        if (finalIds.length === 0) {
          const sameDefault = defaults.rpcPathBindings[rpc.id];
          if (sameDefault) {
            finalIds = sameDefault.pathIds.filter((id) => pathIdSet().has(id));
            if (finalIds.length === 0) {
              finalIds = [ensurePath(WIN_DEFAULT_PATH)];
            }
            defaultPathId = pathIdSet().has(sameDefault.defaultPathId) ? sameDefault.defaultPathId : finalIds[0];
          } else {
            finalIds = [ensurePath(WIN_DEFAULT_PATH)];
            defaultPathId = finalIds[0];
          }
        }

        if (!finalIds.includes(defaultPathId)) {
          defaultPathId = finalIds[0];
        }

        bindings[rpc.id] = {
          pathIds: Array.from(new Set(finalIds)),
          defaultPathId
        };
      });

      return {
        version: 3,
        rpcConfigs,
        downloadPaths,
        rpcPathBindings: bindings
      };
    }

    function loadSettings() {
      let raw = GM_getValue(SETTINGS_KEY, null);

      if (typeof raw === 'string') {
        try {
          raw = JSON.parse(raw);
        } catch (err) {
          raw = null;
        }
      }
      const normalized = sanitizeSettings(raw);
      GM_setValue(SETTINGS_KEY, normalized);

      return normalized;
    }

    function saveSettings(settings) {
      GM_setValue(SETTINGS_KEY, settings);
    }

    let started = false;
    let openSettingsRef = null;
    let retryFailuresRef = null;
    let advancedRetryRef = null;
    let canRefetchRef = null;
    let reloadSettingsRef = null;

    function waitForDocumentAndInit() {
      const timer = setInterval(() => {
        if (!document.body || !document.head) return;
        clearInterval(timer);
        started = true;
        initHelper();
      }, 150);
    }

    function initHelper() {
      ensureStyle();
      let settings = loadSettings();

      const container = document.createElement('div');
      container.id = CONTAINER_ID;

      const selectServer = document.createElement('select');
      selectServer.className = 'rpc-helper-select qk-rpc-server';
      selectServer.style.width = '80px';

      const selectPath = document.createElement('select');
      selectPath.className = 'rpc-helper-select qk-rpc-path';
      selectPath.style.width = '200px';

      const btnSettings = document.createElement('button');
      btnSettings.type = 'button';
      btnSettings.className = 'rpc-helper-btn qk-rpc-setting-tab';
      btnSettings.textContent = '设置';

      const btnSend = document.createElement('button');
      btnSend.type = 'button';
      btnSend.className = 'rpc-helper-btn qk-rpc-send';
      btnSend.textContent = 'RPC发送';
      const btnCopyCommand = document.createElement('button');
      btnCopyCommand.type = 'button';
      btnCopyCommand.className = 'rpc-helper-btn qk-rpc-copy-command';
      btnCopyCommand.textContent = '复制Bash命令';
      btnCopyCommand.title = '复制 Motrix 可导入的 Bash GET 命令，含登录请求头；多选须同请求头，请勿公开分享';
      const btnRetryFailed = document.createElement('button');
      btnRetryFailed.type = 'button';
      btnRetryFailed.className = 'rpc-helper-btn qk-rpc-retry-failed';
      btnRetryFailed.textContent = '重试失败项';
      btnRetryFailed.hidden = true;
      const btnRetryAdvanced = document.createElement('button');
      btnRetryAdvanced.type = 'button';
      btnRetryAdvanced.className = 'rpc-helper-btn qk-rpc-retry-failed';
      btnRetryAdvanced.textContent = '高级重试';
      btnRetryAdvanced.title = '选择原链重发或重新取链，并可更换目标 RPC / 下载目录';
      btnRetryAdvanced.hidden = true;
      const selectionCount = document.createElement('span');
      selectionCount.className = 'qk-rpc-selection-count';
      selectionCount.style.cssText = 'margin-left:5px;color:#42617b;font-size:12px;white-space:nowrap;';
      selectionCount.hidden = true;

      container.appendChild(btnSettings);
      container.appendChild(selectServer);
      container.appendChild(selectPath);
      if (ON_QUARK || ON_TCLOUD || ON_XUNLEI || ON_MCLOUD || ON_123PAN || ON_115 || ON_BAIDU || ON_UC || ON_GUANGYA) {
        container.appendChild(btnSend);
        container.appendChild(btnCopyCommand);
        container.appendChild(btnRetryFailed);
        container.appendChild(btnRetryAdvanced);
      }
      if (ON_QUARK || ON_UC) container.appendChild(selectionCount);

      function shouldQuarkAutoDeselect(item) {
        if (!item || item.file !== true) return false;
        const name = String(item.file_name || '').toLowerCase();
        if (/\.nfo$/.test(name)) return true;
        if (item.file_type === 3 || /\.(?:jpe?g|png|gif|webp|bmp|heic|heif|avif|tiff?|svg)$/.test(name)) return true;
        const video = item.file_type === 1 || /\.(?:mp4|mkv|avi|mov|wmv|flv|webm|m4v|ts|m2ts|mpeg|mpg|3gp|rmvb)$/.test(name);
        return video && Number.isFinite(Number(item.size)) && Number(item.size) < 10 * 1024 * 1024;
      }

      function autoSelectCurrentPage() {
        const feature = ON_QUARK ? 'quarkSelectAll' : ON_UC ? 'ucSelectAll' : ON_115 ? '115SelectAll' : ON_BAIDU ? 'baiduSelectAll' : ON_TCLOUD ? 'tcloudSelectAll' : ON_MCLOUD ? 'mcloudSelectAll' : ON_123PAN ? '123panSelectAll' : ON_GUANGYA ? 'guangyaSelectAll' : 'xunleiSelectAll';
        if (!featureEnabled(feature)) return false;
        if (ON_QUARK && !shouldHandleListPage()) return false;
        const doc = getPageWindow().document;
        const site = SELECT_ALL_SITES[SITE_HOST];
        if (!site) return false;
        // 表头全选控件（各网盘实测）；优先取真正的 input，用它的 checked 判断，避免误判后再点一次变成取消全选。
        const control = doc.querySelector(site.head);
        if (!control) return false;
        // 表头全选被站点隐藏（如天翼系统目录里没有可选项）时不要点。
        if (control.closest('[style*="display: none"], [style*="display:none"]')) return false;
        if (!doc.querySelector(site.rows)) return false;
        const input = control.matches('input') ? control : control.querySelector('input[type="checkbox"]');
        if ((input && input.disabled) || control.getAttribute('aria-disabled') === 'true') return false;
        const holder = (input && input.closest('label')) || control;
        const alreadyChecked = (input && (input.checked === true || input.indeterminate === true)) ||
          control.getAttribute('aria-checked') === 'true' || holder.matches(site.checked) || Boolean(holder.querySelector(site.checked));
        if (alreadyChecked) return true;
        holder.click();
        if (ON_QUARK) deselectQuarkAutoExcluded(location.href);
        return true;
      }
      // 只处理夸克本次自动全选；通过行复选框点击保持 React 内部选区与界面同步。
      function deselectQuarkAutoExcluded(route) {
        if (!ON_QUARK) return;
        const start = Date.now();
        const attempt = () => {
          if (location.href !== route || !featureEnabled('quarkSelectAll')) return;
          const props = getQuarkListProps();
          const keys = props && props.selectedRowKeys || [];
          if (!keys.length && Date.now() - start < 1000) { setTimeout(attempt, 50); return; }
          const excluded = new Set((props && props.list || []).filter(shouldQuarkAutoDeselect).map((item) => String(item.fid)));
          const keep = keys.filter((fid) => !excluded.has(String(fid)));
          if (keep.length !== keys.length && typeof props.changeSelectedRowKeys === 'function') {
            // 虚拟滚动未挂载的行也存在于 React 列表/选区中，直接更新完整选区。
            props.changeSelectedRowKeys(keep);
          } else if (keep.length !== keys.length) {
            // 无选区更新方法时仅处理已渲染行，不触碰未出现的 DOM。
            const rows = [...getPageWindow().document.querySelectorAll('.file-list .ant-table-tbody tr[data-row-key]')];
            rows.forEach((row) => {
              if (!excluded.has(row.getAttribute('data-row-key'))) return;
              const checkbox = row.querySelector('.ant-table-selection-column input[type="checkbox"]');
              if (checkbox && checkbox.checked) checkbox.click();
            });
          }
          updateQuarkSelectionCount();
        };
        setTimeout(attempt, 0);
      }
      // 各网盘「全选当前页」控件、行元素与已勾选标记（均在真实页面上验证）。
      const SELECT_ALL_SITES = {
        'pan.quark.cn': { head: '.file-list .ant-table-thead input[type="checkbox"]', rows: '.file-list .ant-table-tbody tr[data-row-key]', checked: '.ant-checkbox-wrapper-checked, .ant-checkbox-checked' },
        'drive.uc.cn': { head: '.file-list .ant-table-thead input[type="checkbox"], .ant-table-thead input[type="checkbox"]', rows: '.ant-table-tbody tr[data-row-key]', checked: '.ant-checkbox-wrapper-checked, .ant-checkbox-checked' },
        '115.com': { head: 'input[type="checkbox"][title="全选当前页"]', rows: '.file-list-wrap .checkbox-area input[type="checkbox"]', checked: ':checked' },
        'pan.baidu.com': { head: '.wp-s-pan-table__header label.u-checkbox, .wp-s-pan-table__header-select label', rows: '.wp-s-pan-table__body input[type="checkbox"], .wp-s-file-grid-list__item, .wp-s-file-contain-list__item', checked: '.is-checked' },
        'yun.139.com': { head: '.document_table_header .checkbox', rows: '.document_table_list_item', checked: '.document_table_header_checked' },
        'pan.xunlei.com': { head: '.pan-list-header label[class*="FileCheckBox__checkbox"]', rows: '[class*="SourceListItem__item--"]', checked: '.is-checked' },
        'yun.123pan.cn': { head: '[class*="mfy_h-table-module__thead"] label[class*="selectionCheckbox"], .ant-table-thead input[type="checkbox"]', rows: '[class*="mfy_h-table-module__row"], .ant-table-tbody tr[data-row-key]', checked: '[class*="checkbox-module__checked"], .ant-checkbox-checked' },
        'cloud.189.cn': { head: '.c-file-list [class*="file-list-li-head"] label.ant-checkbox-wrapper', rows: '.c-file-list .c-file-item', checked: '.ant-checkbox-wrapper-checked, .ant-checkbox-checked' },
        'www.guangyapan.com': { head: '.swangpan-file-list-table__header .swangpan-checkbox__input', rows: '.swangpan-file-list-table__body .swangpan-file-list-table__row', checked: ':checked' }
      };
      let autoSelectRoute = '';
      let autoSelectPending = '';
      function scheduleAutoSelect() {
        const feature = ON_QUARK ? 'quarkSelectAll' : ON_UC ? 'ucSelectAll' : ON_115 ? '115SelectAll' : ON_BAIDU ? 'baiduSelectAll' : ON_TCLOUD ? 'tcloudSelectAll' : ON_MCLOUD ? 'mcloudSelectAll' : ON_123PAN ? '123panSelectAll' : ON_GUANGYA ? 'guangyaSelectAll' : 'xunleiSelectAll';
        if (!featureEnabled(feature)) return;
        const doc = getPageWindow().document;
        const routeHref = location.href;
        // 每个目录地址只全选一次；不再把首行 ID 拼进键里，否则列表渲染出首行后会被当成新页面再点一次。
        const route = routeHref;
        if (autoSelectRoute === route || autoSelectPending === route) return;
        autoSelectPending = route;
        const start = Date.now();
        const attempt = () => {
          if (!featureEnabled(feature)) { if (autoSelectPending === route) autoSelectPending = ''; return; }
          if (location.href !== routeHref || autoSelectRoute === route) { if (autoSelectPending === route) autoSelectPending = ''; return; }
          if (autoSelectCurrentPage()) { autoSelectRoute = route; autoSelectPending = ''; updateQuarkSelectionCount(); return; }
          if (Date.now() - start < 10000) setTimeout(attempt, 300);
          else if (autoSelectPending === route) autoSelectPending = '';
        };
        setTimeout(attempt, 350);
      }

      function getPathById(pathId) {
        return settings.downloadPaths.find((item) => item.id === pathId) || null;
      }

      function getBindingForRpc(rpcId) {
        const b = settings.rpcPathBindings && settings.rpcPathBindings[rpcId];
        if (!b || !Array.isArray(b.pathIds)) return buildDefaultBinding([]);
        const pathIds = b.pathIds.filter((id) => getPathById(id));
        const defaultPathId = pathIds.includes(b.defaultPathId) ? b.defaultPathId : (pathIds[0] || '');
        return { pathIds, defaultPathId };
      }

      function getBoundPathValues(rpcId) {
        const binding = getBindingForRpc(rpcId);
        return binding.pathIds
          .map((id) => getPathById(id))
          .filter((item) => Boolean(item))
          .map((item) => item.path);
      }

      // 旧版每次页面变动都清空重建 <option>，重建本身又触发 MutationObserver，形成每秒几十次的死循环。
      // 这里只在选项列表真正变化时才重建。
      function setSelectOptions(select, options) {
        const key = JSON.stringify(options);
        if (select.dataset.qkOptionsKey === key) return;
        select.dataset.qkOptionsKey = key;
        select.innerHTML = '';
        options.forEach(([value, text]) => {
          const option = document.createElement('option');
          option.value = value;
          option.text = text;
          select.appendChild(option);
        });
      }

      function setSelectValue(select, value) {
        if (select.value !== value) select.value = value;
      }

      function renderServerOptions() {
        const options = [['', '选择RPC服务器...']];
        settings.rpcConfigs.forEach((rpc, index) => {
          options.push([String(index), rpc.name || rpc.domain]);
        });
        setSelectOptions(selectServer, options);
      }

      function renderPathOptions(rpcId, currentDir) {
        const options = [['', '选择下载路径...']];
        const paths = rpcId ? getBoundPathValues(rpcId) : [];
        paths.forEach((p) => options.push([p, p]));
        if (currentDir && !paths.includes(currentDir)) {
          options.push([currentDir, `当前: ${currentDir}`]);
        }
        setSelectOptions(selectPath, options);
      }

      function defaultDirFor(rpc) {
        if (!rpc) return '';
        const pathObj = getPathById(getBindingForRpc(rpc.id).defaultPathId);
        return pathObj ? pathObj.path : WIN_DEFAULT_PATH;
      }

      // 当前选中的服务器/路径只存本脚本的 GM 存储。
      function resolveActive() {
        let saved = GM_getValue(ACTIVE_KEY, null);
        let rpc = saved ? settings.rpcConfigs.find((cfg) => cfg.id === saved.rpcId) : null;
        if (!rpc) {
          rpc = settings.rpcConfigs[0] || null;
          if (!rpc) return { rpc: null, dir: '' };
          saved = { rpcId: rpc.id, dir: defaultDirFor(rpc) };
          GM_setValue(ACTIVE_KEY, saved);
        }
        return { rpc, dir: saved.dir || defaultDirFor(rpc) };
      }

      function setActive(rpc, dir) {
        GM_setValue(ACTIVE_KEY, { rpcId: rpc.id, dir: dir || defaultDirFor(rpc) });
      }

      function syncUIState() {
        const active = resolveActive();
        renderServerOptions();
        renderPathOptions(active.rpc ? active.rpc.id : '', active.dir);
        const index = active.rpc ? settings.rpcConfigs.indexOf(active.rpc) : -1;
        setSelectValue(selectServer, index >= 0 ? String(index) : '');
        setSelectValue(selectPath, active.dir || '');
        const target = active.rpc ? `发送到 ${active.rpc.name || active.rpc.domain}：${active.dir || '(默认目录)'}` : '请先在「设置」里添加 RPC 服务器';
        if (btnSend.title !== target) btnSend.title = target;
      }

      // ===== 夸克独立发送 =====
      function getQuarkListProps() {
        const el = getPageWindow().document.querySelector('.file-list');
        if (!el) return null;
        const key = Object.keys(el).find((k) => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
        let fiber = key ? el[key] : null;
        for (let i = 0; fiber && i < 40; i++, fiber = fiber.return) {
          const props = fiber.memoizedProps;
          if (props && Array.isArray(props.selectedRowKeys) && Array.isArray(props.list)) return props;
        }
        return null;
      }

      function getUcListProps() {
        const el = getPageWindow().document.querySelector('.file-list');
        if (!el) return null;
        const key = Object.keys(el).find((k) => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
        let fiber = key && el[key];
        for (let i = 0; fiber && i < 40; i++, fiber = fiber.return) {
          const props = fiber.memoizedProps;
          if (props && Array.isArray(props.list) && Array.isArray(props.selectedRowKeys)) return props;
        }
        return null;
      }
      let ucRepairRoute = '';
      let ucRepairRunning = false;
      let ucRepairTimer = 0;
      function scheduleUcRepair() {
        if (!ON_UC || featureEnabled('ucSelectAll') || ucRepairRunning) return;
        clearTimeout(ucRepairTimer);
        ucRepairTimer = setTimeout(resetUcInvisibleSelection, 450);
      }
      async function resetUcInvisibleSelection() {
        if (!ON_UC || featureEnabled('ucSelectAll') || ucRepairRunning) return;
        const props = getUcListProps();
        if (!props?.selectedRowKeys.length) return;
        const rows = [...getPageWindow().document.querySelectorAll('.file-list .ant-table-tbody tr[data-row-key]')];
        if (rows.length < 2 || rows.some((row) => row.querySelector('.ant-table-selection-column input[type="checkbox"]:checked'))) return;
        const pageHref = location.href;
        const route = `${pageHref}::${rows[0].getAttribute('data-row-key')}::${rows[1].getAttribute('data-row-key')}`;
        if (ucRepairRoute === route) return;
        ucRepairRoute = route;
        ucRepairRunning = true;
        try {
          // UC 内部选区与视觉状态不同步时，模拟用户的「勾选前两项，再依次取消」。
          // 只做一次，避免观察器触发后再次点击并覆盖用户后续操作。
          for (const index of [0, 1, 0, 1]) {
            if (location.href !== pageHref || !rows[index].isConnected) break;
            const input = rows[index].querySelector('.ant-table-selection-column input[type="checkbox"]');
            if (!input) break;
            input.click();
            await sleep(80);
          }
          // UC 手动切换后仍可能保留已取消行的内部键；只在界面确实为零选中时清空。
          const after = getUcListProps();
          const stillChecked = [...getPageWindow().document.querySelectorAll('.file-list .ant-table-tbody tr[data-row-key]')]
            .some((row) => row.querySelector('.ant-table-selection-column input[type="checkbox"]:checked'));
          if (location.href === pageHref && !stillChecked && after?.selectedRowKeys.length && typeof after.changeSelectedRowKeys === 'function') {
            after.changeSelectedRowKeys([]);
          }
        } finally {
          ucRepairRunning = false;
          updateQuarkSelectionCount();
        }
      }
      function updateQuarkSelectionCount() {
        if (ON_UC) {
          scheduleUcRepair();
          const count = ucSelectedFiles().length;
          const label = `已勾选 ${count} 个文件`;
          if (selectionCount.textContent !== label) selectionCount.textContent = label;
          selectionCount.hidden = count === 0;
          return;
        }
        if (!ON_QUARK || !shouldHandleListPage()) { selectionCount.hidden = true; return; }
        const props = getQuarkListProps();
        const keys = props?.selectedRowKeys || [];
        const selected = new Set(keys);
        const rows = (props?.list || []).filter((item) => selected.has(item.fid));
        const files = rows.filter((item) => item.file === true).length;
        const folders = rows.filter((item) => item.file === false || item.dir === true).length;
        const label = `已勾选 ${files} 个文件、${folders} 个文件夹`;
        if (selectionCount.textContent !== label) selectionCount.textContent = label;
        selectionCount.hidden = keys.length === 0;
      }
      async function quarkApi(path, body) {
        const w = getPageWindow();
        const init = body
          ? { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json;charset=UTF-8' }, body: JSON.stringify(body) }
          : { credentials: 'include' };
        const res = await w.fetch(QUARK_API + path, init);
        let json = null;
        try {
          json = await res.json();
        } catch (error) {
          throw new Error(`夸克接口返回异常 HTTP ${res.status}`);
        }
        if (!json || json.code !== 0) {
          if (json && json.code === 31001) throw new Error('请先登录夸克网盘');
          throw new Error(`夸克接口错误 ${json ? json.code : ''} ${(json && json.message) || ''}`.trim());
        }
        return json;
      }

      async function quarkListDir(fid) {
        const all = [];
        for (let page = 1; page <= 100; page++) {
          const json = await quarkApi(`/1/clouddrive/file/sort?pr=ucpro&fr=pc&uc_param_str=&pdir_fid=${encodeURIComponent(fid)}&_page=${page}&_size=1000&_fetch_total=1&_fetch_sub_dirs=0&_sort=file_type:asc,file_name:asc`);
          const list = (json.data && json.data.list) || [];
          all.push(...list);
          const total = (json.metadata && json.metadata._total) || 0;
          if (list.length === 0 || all.length >= total) break;
        }
        return all;
      }

      function safeSegment(name) {
        return String(name || '').replace(/[\\/:*?"<>|]/g, '_').trim() || '_';
      }

      function joinDir(base, rel) {
        const root = String(base || '').replace(/[\\/]+$/, '');
        if (!rel) return root;
        return root ? `${root}/${rel}` : rel;
      }

      // 开关默认开启，保持原有递归行为；关闭时仅发送直接勾选的文件，不请求文件夹内容。
      async function collectQuarkFiles(items, onProgress) {
        const out = [];
        const traverseFolders = featureEnabled('quarkTraverseFolders');
        const walk = async (item, rel) => {
          if (item.file) {
            out.push({ fid: item.fid, name: safeSegment(item.file_name), rel });
            return;
          }
          if (!traverseFolders) return;
          const sub = rel ? `${rel}/${safeSegment(item.file_name)}` : safeSegment(item.file_name);
          const children = await quarkListDir(item.fid);
          for (const child of children) await walk(child, sub);
          if (onProgress) onProgress(out.length);
        };
        for (const item of items) await walk(item, '');
        return out;
      }

      // PC 客户端 UA + 页面 Cookie + 社交下载令牌，调用 PC 版下载接口。
      function quarkPcPost(url, body) {
        return new Promise((resolve, reject) => {
          GM_xmlhttpRequest({
            method: 'POST',
            url,
            headers: {
              'Content-Type': 'application/json;charset=UTF-8',
              'User-Agent': QUARK_PC_UA,
              // 显式带页面 Cookie，脚本管理器会再合并浏览器里的 httpOnly 登录 Cookie
              Cookie: getPageWindow().document.cookie,
              Origin: 'https://pan.quark.cn',
              Referer: 'https://pan.quark.cn/'
            },
            data: JSON.stringify(body),
            anonymous: false,
            timeout: 20000,
            onload(res) {
              let json = null;
              try {
                json = JSON.parse(res.responseText);
              } catch (error) {
                reject(new Error(`夸克接口返回异常 HTTP ${res.status}`));
                return;
              }
              if (!json || json.code !== 0) {
                if (json && json.code === 31001) {
                  reject(new Error('夸克登录态未带上（31001），请刷新页面后重试'));
                  return;
                }
                reject(new Error(`夸克接口错误 ${json ? json.code : ''} ${(json && json.message) || ''}`.trim()));
                return;
              }
              resolve(json);
            },
            onerror() {
              reject(new Error('无法连接夸克接口'));
            },
            ontimeout() {
              reject(new Error('夸克接口超时'));
            }
          });
        });
      }

      async function quarkGetToken() {
        const cached = GM_getValue(QUARK_TOKEN_KEY, null);
        if (cached && cached.token && cached.expired_timestamp > Date.now() + 60000) return cached.token;
        try {
          const now = Math.floor(Date.now() / 1000);
          const json = await quarkPcPost(QUARK_TOKEN_API, { conversation_id: `300000${now}`, conversation_type: 3, msg_id: `${now}000` });
          if (json.data && json.data.token) {
            GM_setValue(QUARK_TOKEN_KEY, json.data);
            return json.data.token;
          }
        } catch (error) {
          console.warn('[夸克懒得点][RPC] 获取下载令牌失败，继续无令牌取链:', error.message || error);
        }
        return '';
      }

      async function quarkPcGetLinks(fids) {
        const token = await quarkGetToken();
        try {
          return await quarkPcPost(QUARK_PC_LINK_API, { fids, speedup_session: '', token });
        } catch (error) {
          GM_setValue(QUARK_TOKEN_KEY, null);
          throw error;
        }
      }

      async function quarkGetLinks(fids) {
        let json;
        try {
          json = await quarkPcGetLinks(fids);
        } catch (error) {
          // PC 接口不可用时退回网页版接口（大文件会被 23018 拒绝）
          console.warn('[夸克懒得点][RPC] PC 接口取链失败，改用网页版接口:', error.message || error);
          json = await quarkApi('/1/clouddrive/file/download?pr=ucpro&fr=pc&uc_param_str=', { fids });
        }
        const map = {};
        (json.data || []).forEach((d) => {
          if (d && d.fid && d.download_url) map[d.fid] = d.download_url;
        });
        return map;
      }

      // 天翼：从页面现有 Vue 选区读取文件，再用 AccessToken + 时间戳签名获取直链。
      async function tcloudGetSelected() {
        const page = getPageWindow();
        const list = page.document.querySelector('.c-file-list');
        const selected = list && list.__vue__ && list.__vue__.selectedList;
        if (!Array.isArray(selected)) return [];
        return selected.filter((item) => item && item.fileId);
      }

      async function tcloudGetDownloadUrl(item, token) {
        if (item.downloadUrl) return item.downloadUrl;
        const time = String(Date.now());
        const sharePart = item.shareId ? `&dt=1&shareId=${item.shareId}` : '';
        const signText = `AccessToken=${token}&Timestamp=${time}${item.shareId ? '&dt=1' : ''}&fileId=${item.fileId}${item.shareId ? `&shareId=${item.shareId}` : ''}`;
        // 天翼页面自带签名实现（SparkMD5）。若无法找到，则 fail closed 而不是发送无效签名。
        const page = getPageWindow();
        const md5 = page.SparkMD5 && page.SparkMD5.hash || page.md5;
        if (typeof md5 !== 'function') throw new Error('天翼页面未提供 MD5 签名器，请刷新后重试');
        const signature = md5(signText).toString();
        const url = `https://api.cloud.189.cn/open/file/getFileDownloadUrl.action?fileId=${encodeURIComponent(item.fileId)}${sharePart}`;
        return new Promise((resolve, reject) => {
          GM_xmlhttpRequest({
            method: 'GET', url, timeout: 15000,
            headers: { Accept: 'application/json;charset=UTF-8', 'Sign-Type': '1', Accesstoken: token, Timestamp: time, Signature: signature },
            onload(response) {
              try {
                const result = JSON.parse(response.responseText);
                if (result.res_code != 0 || !/^https?:\/\//.test(result.fileDownloadUrl || '')) {
                  reject(new Error(`天翼接口 ${result.res_code || result.errorcode || response.status}：未获得下载地址`));
                } else resolve(result.fileDownloadUrl);
              } catch (error) { reject(error); }
            },
            onerror: () => reject(new Error('天翼取链请求失败')),
            ontimeout: () => reject(new Error('天翼取链超时'))
          });
        });
      }

      function xunleiSelectedFiles() {
        const rows = getPageWindow().document.querySelectorAll('[class*="SourceListItem__item--"]');
        return [...rows].map((row) => row.__vue__).filter((vue) => vue && vue.info && vue.selected?.includes(vue.info.id))
          .map((vue) => vue.info).filter((item) => item.kind === 'drive#file');
      }

      function xunleiAuth() {
        const store = getPageWindow().localStorage;
        const credsKey = Object.keys(store).find((key) => key.startsWith('credentials_'));
        if (!credsKey) throw new Error('迅雷登录信息不存在，请重新登录');
        const clientId = credsKey.slice('credentials_'.length);
        const credentials = JSON.parse(store.getItem(credsKey) || '{}');
        const captcha = JSON.parse(store.getItem(`captcha_${clientId}`) || '{}');
        const device = store.getItem('deviceid') || '';
        const deviceId = device.match(/\w{32}/)?.[0];
        if (!deviceId || !credentials.access_token || !captcha.token) throw new Error('迅雷登录或验证码令牌缺失，请刷新页面');
        if (credentials.expires_at && Date.parse(credentials.expires_at) < Date.now() + 60000) throw new Error('迅雷登录已过期，请重新登录');
        if (captcha.expires_at && Date.parse(captcha.expires_at) < Date.now() + 60000) throw new Error('迅雷验证码已过期，请刷新页面');
        return { credentials, captcha, deviceId };
      }

      async function xunleiGetDownloadUrl(item, auth) {
        return new Promise((resolve, reject) => {
          GM_xmlhttpRequest({
            method: 'GET', url: `https://api-pan.xunlei.com/drive/v1/files/${encodeURIComponent(item.id)}`,
            timeout: 15000,
            headers: {
              Authorization: `${auth.credentials.token_type || 'Bearer'} ${auth.credentials.access_token}`,
              'Content-Type': 'application/json',
              'X-Captcha-Token': auth.captcha.token,
              'X-Device-Id': auth.deviceId
            },
            onload(response) {
              try {
                const data = JSON.parse(response.responseText);
                if (response.status < 200 || response.status >= 300 || !/^https?:\/\//.test(data.web_content_link || '')) {
                  reject(new Error(`迅雷接口 ${data.error_code || response.status}：${data.error_description || '未获得下载地址'}`));
                } else resolve(data.web_content_link);
              } catch (error) { reject(error); }
            },
            onerror: () => reject(new Error('迅雷取链请求失败')),
            ontimeout: () => reject(new Error('迅雷取链超时'))
          });
        });
      }

      function mcloudSelectedFiles() {
        const vue = getPageWindow().document.querySelector('.main_file_list')?.__vue__;
        if (!vue || !Array.isArray(vue.selectList)) return [];
        return vue.selectList.map((x) => x.item).filter((x) => x && x.contentID && x.contentName && x.contentSuffix);
      }

      function mcloudMd5(text) {
        const bytes = new TextEncoder().encode(text);
        const length = bytes.length;
        const padded = new Uint8Array(((length + 8) >> 6 << 6) + 64);
        padded.set(bytes);
        padded[length] = 0x80;
        const view = new DataView(padded.buffer);
        const bits = length * 8;
        view.setUint32(padded.length - 8, bits >>> 0, true);
        view.setUint32(padded.length - 4, Math.floor(bits / 0x100000000), true);
        const shifts = [7,12,17,22, 5,9,14,20, 4,11,16,23, 6,10,15,21];
        const constants = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) >>> 0);
        let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476;
        for (let offset = 0; offset < padded.length; offset += 64) {
          let a = h0, b = h1, c = h2, d = h3;
          for (let i = 0; i < 64; i++) {
            let f, g, shift;
            if (i < 16) { f = (b & c) | (~b & d); g = i; shift = shifts[i % 4]; }
            else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) % 16; shift = shifts[4 + i % 4]; }
            else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) % 16; shift = shifts[8 + i % 4]; }
            else { f = c ^ (b | ~d); g = (7 * i) % 16; shift = shifts[12 + i % 4]; }
            const sum = (a + f + constants[i] + view.getUint32(offset + g * 4, true)) >>> 0;
            const rotate = ((sum << shift) | (sum >>> (32 - shift))) >>> 0;
            [a, b, c, d] = [d, (b + rotate) >>> 0, b, c];
          }
          h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0;
          h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
        }
        const out = new DataView(new ArrayBuffer(16));
        [h0,h1,h2,h3].forEach((value,i) => out.setUint32(i * 4, value, true));
        return Array.from(new Uint8Array(out.buffer), (byte) => byte.toString(16).padStart(2, '0')).join('');
      }
      function mcloudSignature(body, time, key) {
        // URI 编码 JSON 排序、Base64，再两次 MD5，实现接口签名。
        const sorted = encodeURIComponent(JSON.stringify(body).replace(/\s*/g, '')).split('').sort().join('');
        const a = mcloudMd5(btoa(sorted));
        const b = mcloudMd5(`${time}:${key}`);
        return mcloudMd5(a + b).toUpperCase();
      }

      function mcloudGetCookie(name) {
        return getPageWindow().document.cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1) || '';
      }

      async function mcloudGetDownloadUrl(item) {
        if (item.downloadUrl) return item.downloadUrl;
        const body = { fileId: item.contentID };
        const time = new Date(Date.now() + 8 * 3600 * 1000).toJSON().slice(0, 19).replace('T', ' ');
        const charset = 'ABCDEFGHJKMNPQRSTWXYZabcdefhijkmnprstwxyz2345678';
        const key = Array.from(crypto.getRandomValues(new Uint8Array(16)), (x) => charset[x % charset.length]).join('');
        const sign = mcloudSignature(body, time, key);
        const authorization = mcloudGetCookie('authorization');
        if (!authorization) throw new Error('139 登录 Cookie 缺失');
        const headers = {
          Authorization: authorization, Caller: 'web', 'Content-Type': 'application/json;charset=UTF-8',
          'CMS-DEVICE': 'default', 'Mcloud-Channel': '1000101', 'Mcloud-Client': '10701',
          'Mcloud-Sign': `${time},${key},${sign}`, 'Mcloud-Version': '7.14.2',
          'X-DeviceInfo': '||9|7.17.0|edge||||windows 10||zh-CN|||',
          'X-Huawei-ChannelSrc': '10000034', 'X-Inner-Ntwk': '2', 'X-M4C-Caller': 'PC',
          'X-M4C-Src': '10002', 'X-SvcType': '1', 'X-Yun-Api-Version': 'v1',
          'X-Yun-App-Channel': '10000034', 'X-Yun-Channel-Source': '10000034',
          'X-Yun-Client-Info': '||9|7.17.0|edge||||windows 10||zh-CN|||||',
          'X-Yun-Module-Type': '100', 'X-Yun-Svc-Type': '1', 'X-Yun-Url-Type': '3'
        };
        return new Promise((resolve, reject) => GM_xmlhttpRequest({
          method: 'POST', url: 'https://personal-kd-njs.yun.139.com/hcy/file/getDownloadUrl',
          headers, data: JSON.stringify(body), timeout: 18000,
          onload(res) {
            try {
              const data = JSON.parse(res.responseText);
              if (!data.success || !/^https?:\/\//.test(data.data?.url || '')) {
                reject(new Error(`139 接口 ${data.code || res.status}：${data.message || '未获得地址'}`));
              } else resolve(data.data.url);
            } catch (error) { reject(error); }
          },
          onerror: () => reject(new Error('139 取链请求失败')),
          ontimeout: () => reject(new Error('139 取链超时'))
        }));
      }

      function pan123SelectedFiles() {
        const el = getPageWindow().document.querySelector('.ant-table-wrapper, .tiled-list, .file-list, .single-file-sharing-container-content, .custom-table-wrapper, [class^="mfy_h-table-module__shell__"]');
        if (!el) return [];
        const key = Object.keys(el).find((k) => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
        let fiber = key && el[key];
        for (let i = 0; fiber && i < 40; i++, fiber = fiber.return) {
          const props = fiber.memoizedProps || fiber.pendingProps;
          if (!props || !Array.isArray(props.dataSource)) continue;
          const selected = props.rowSelection?.selectedRowKeys || [];
          return props.dataSource.filter((x) => x && x.Type === 0 && (x.checked || selected.includes(x.FileId)));
        }
        return [];
      }

      async function pan123GetDownloadUrl(file) {
        const store = getPageWindow().localStorage;
        const token = store.getItem('authorToken');
        if (!token) throw new Error('123 盘未登录或令牌失效');
        const headers = {
          Accept: 'application/json, text/plain, */*', 'Content-Type': 'application/json; charset=UTF-8',
          Authorization: `Bearer ${token}`,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) 123pan/3.2.3 Chrome/108.0.5359.215 Electron/22.3.27 Safari/537.36 WebView/1.0',
          'Sec-Ch-Ua': '"Not?A_Brand";v="8", "Chromium";v="108"',
          Platform: 'web', Platform_os: '123pan/v323(Windows10.0.26200)',
          'App-Version': '323', LoginUuid: store.getItem('LoginUuid') || '', Devicename: '', 'Mac-Addr': ''
        };
        const body = { driveId: 0, etag: file.Etag, fileId: file.FileId, s3keyFlag: file.S3KeyFlag, type: file.Type, fileName: file.FileName, size: file.Size };
        return new Promise((resolve, reject) => GM_xmlhttpRequest({
          method: 'POST', url: 'https://api.123pan.cn/api/v2/file/download_info', headers,
          data: JSON.stringify(body), timeout: 18000,
          onload(response) {
            try {
              const json = JSON.parse(response.responseText);
              if (json.code !== 0 || !json.data?.dispatchList?.length || !json.data?.downloadPath) {
                reject(new Error(`123 盘接口 ${json.code || response.status}：${json.message || '未获得下载地址'}`)); return;
              }
              const link = `${json.data.dispatchList[0].prefix || ''}${json.data.downloadPath}`;
              let parsed = new URL(link);
              const encoded = parsed.searchParams.get('params');
              if (encoded) {
                try { parsed = new URL(decodeURIComponent(escape(atob(encoded)))); } catch (error) { /* 此线路可能不用 Base64 包裹 */ }
              }
              if (!/^https?:$/.test(parsed.protocol)) throw new Error('123 盘链接不是 HTTP(S)');
              resolve(parsed.href);
            } catch (error) { reject(error); }
          },
          onerror: () => reject(new Error('123 盘取链请求失败')),
          ontimeout: () => reject(new Error('123 盘取链超时'))
        }));
      }

      // 115 协议常量参考 MIT 许可的 115 直链脚本：
      // https://greasyfork.org/zh-CN/scripts/591162-115 （协议流程在此独立实现）
      const ONE15_TABLE = [240,229,105,174,191,220,191,138,26,69,232,190,125,166,115,184,222,143,231,196,69,218,134,196,155,100,139,20,106,180,241,170,56,1,53,158,38,105,44,134,0,107,79,165,54,52,98,166,42,150,104,24,242,74,253,189,107,151,143,77,143,137,19,183,108,142,147,237,14,13,72,62,215,47,136,216,254,254,126,134,80,149,79,209,235,131,38,52,219,102,123,156,126,157,122,129,50,234,182,51,222,58,169,89,52,102,59,170,186,129,96,72,185,213,129,156,248,108,132,119,255,84,120,38,95,190,232,30,54,159,52,128,92,69,44,155,118,213,27,143,204,195,184,245];
      const ONE15_SHORT = [41,35,33,94];
      const ONE15_LONG = [120,6,173,76,51,134,93,24,76,1,63,70];
      const ONE15_MOD = BigInt('0x8686980c0f5a24c4b9d43020cd2c22703ff3f450756529058b1cf88f09b8602136477198a6e2683149659bd122c33592fdb5ad47944ad1ea4d36c6b172aad6338c3bb6ac6227502d010993ac967d1aef00f0c8e038de2e4d3bc2ec368af2e9f10a6f1eda4f7262f136420c07c331b871bf139f74f3010e3c4fe57df3afb71683');
      const one15Bytes = (s) => [...s].map((c) => c.charCodeAt(0));
      const one15String = (b) => String.fromCharCode(...b);
      const one15Hex = (b) => b.map((x) => x.toString(16).padStart(2, '0')).join('');
      function one15Power(base, exponent) {
        let value = 1n;
        base %= ONE15_MOD;
        while (exponent > 0n) {
          if (exponent & 1n) value = value * base % ONE15_MOD;
          base = base * base % ONE15_MOD;
          exponent >>= 1n;
        }
        return value;
      }
      function one15Derive(length, key) {
        if (!key) return (length === 12 ? ONE15_LONG : ONE15_SHORT).slice();
        return Array.from({ length }, (_, i) => ((key[i] + ONE15_TABLE[length * i]) & 255) ^ ONE15_TABLE[length * (length - 1 - i)]);
      }
      function one15Xor(bytes, key) {
        const offset = bytes.length % 4;
        return bytes.map((x, i) => x ^ key[(i < offset ? i : i - offset) % key.length]);
      }
      function one15Seal(pickCode, timestamp) {
        const hash = getPageWindow().md5;
        if (typeof hash !== 'function') throw new Error('115 页面缺 MD5，刷新后重试');
        const key = one15Bytes(hash(`!@###@#${timestamp}DFDR@#@#`));
        const payload = one15Bytes(JSON.stringify({ pickcode: pickCode }));
        const mixed = key.slice(0, 16).concat(one15Xor(one15Xor(payload, one15Derive(4, key)).reverse(), one15Derive(12)));
        let hex = '';
        for (let i = 0; i < mixed.length; i += 117) {
          const slice = mixed.slice(i, i + 117);
          const block = [0, 2, ...Array(125 - slice.length).fill(255), 0, ...slice];
          if (block.length !== 128) throw new Error('115 加密块长度不正确');
          hex += one15Power(BigInt('0x' + one15Hex(block)), 65537n).toString(16).padStart(256, '0');
        }
        const cipher = hex.match(/.{2}/g).map((x) => parseInt(x, 16));
        return { data: btoa(one15String(cipher)), key };
      }
      function one15Unseal(encoded, key) {
        const bytes = one15Bytes(atob(encoded));
        let raw = [];
        for (let i = 0; i < bytes.length; i += 128) {
          const plain = one15Power(BigInt('0x' + one15Hex(bytes.slice(i, i + 128))), 65537n).toString(16).padStart(256, '0');
          const decoded = plain.match(/.{2}/g).map((x) => parseInt(x, 16));
          const separator = decoded.indexOf(0, 2);
          if (separator < 0) throw new Error('115 解密数据缺少分隔符');
          raw.push(...decoded.slice(separator + 1));
        }
        const salt = raw.slice(0, 16);
        const payload = one15Xor(one15Xor(raw.slice(16), one15Derive(12, salt)).reverse(), one15Derive(4, key));
        return JSON.parse(new TextDecoder().decode(new Uint8Array(payload)));
      }
      function one15SelectedFiles() {
        return [...getPageWindow().document.querySelectorAll('.file-list-wrap .checkbox-area input[type="checkbox"]:checked')].map((checkbox) => {
          const key = Object.keys(checkbox).find((k) => k.startsWith('__reactFiber$'));
          let fiber = key && checkbox[key];
          for (let i = 0; fiber && i < 40; i++, fiber = fiber.return) {
            const file = fiber.memoizedProps?.file;
            if (file) return { pickCode: file.pc, name: file.n || file.name, isFolder: !file.fid, cid: file.cid, size: file.s || file.size };
          }
          return null;
        }).filter(Boolean);
      }
      // 列出 115 目录的直接子项（文件带 fid；文件夹无 fid，cid 为自身目录 ID）。
      async function one15ListDir(cid) {
        const all = [];
        let offset = 0;
        for (let page = 0; page < 100; page++) {
          const result = await gm115Json('GET', `https://webapi.115.com/files?aid=1&cid=${encodeURIComponent(cid)}&show_dir=1&limit=1000&offset=${offset}&o=file_name&asc=1&format=json`);
          if (result?.state !== true || !Array.isArray(result.data)) throw new Error(`读取 115 目录失败：${result?.error || result?.msg || result?.errNo || '未知错误'}`);
          all.push(...result.data);
          offset += result.data.length;
          const total = Number(result.count);
          if (!result.data.length || !Number.isFinite(total) || offset >= total) break;
        }
        return all;
      }
      // 开关开启时递归展开勾选的文件夹，按文件夹结构在下载目录下建子目录；关闭时仅发送直接勾选的文件。
      async function collect115Files(selected, onProgress) {
        const out = [];
        const seen = new Set();
        const visited = new Set();
        const traverse = featureEnabled('115TraverseFolders');
        const push = (pickCode, name, rel) => {
          if (!pickCode || seen.has(pickCode)) return;
          seen.add(pickCode);
          out.push({ pickCode, name, rel });
        };
        const walkDir = async (cid, rel, depth) => {
          if (!/^\d+$/.test(String(cid || '')) || visited.has(String(cid)) || depth > 30) return;
          visited.add(String(cid));
          const children = await one15ListDir(cid);
          for (const child of children) {
            const name = child.n || child.name || '';
            if (child.fid) push(child.pc, name, rel);
            else await walkDir(child.cid, `${rel}/${safeSegment(name)}`, depth + 1);
          }
          if (onProgress) onProgress(out.length);
        };
        for (const item of selected) {
          if (!item.isFolder) push(item.pickCode, item.name, '');
          else if (traverse) await walkDir(item.cid, safeSegment(item.name), 0);
        }
        return out;
      }
      async function one15GetDownloadUrl(pickCode) {
        const stamp = Math.floor(Date.now() / 1000);
        const sealed = one15Seal(pickCode, stamp);
        const result = await new Promise((resolve, reject) => GM_xmlhttpRequest({
          method: 'POST', url: `https://proapi.115.com/app/chrome/downurl?t=${stamp}`,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          data: `data=${encodeURIComponent(sealed.data)}`, timeout: 18000,
          onload(response) {
            try { resolve(JSON.parse(response.responseText)); }
            catch (error) { reject(error); }
          },
          onerror: () => reject(new Error('115 取链网络失败')),
          ontimeout: () => reject(new Error('115 取链超时'))
        }));
        if (!result.state || !result.data) throw new Error(`115 取链失败：${result.msg || result.error || '未知错误'}`);
        const decoded = one15Unseal(result.data, sealed.key);
        const file = Object.values(decoded)[0];
        const url = file?.url?.url;
        if (!/^https?:\/\//.test(url || '')) throw new Error('115 返回的下载地址无效');
        return url;
      }
      function baiduSelectedFiles() {
        const page = getPageWindow();
        const core = page.document.querySelector('.wp-s-core-pan');
        const list = core?.__vue__?.selectedList;
        return Array.isArray(list) ? list.filter((x) => x && !x.isdir && x.fs_id) : [];
      }
      async function baiduOauthToken() {
        const raw = GM_getValue('baidu_access_token', '');
        if (typeof raw === 'string' && raw) return raw;
        const endpoint = 'https://openapi.baidu.com/oauth/2.0/authorize?response_type=token&scope=basic,netdisk&client_id=omiOnr2tYnN9vSyDErcVFWpPU2mZA7YO&redirect_uri=oob&confirm_login=0';
        const result = await new Promise((resolve, reject) => GM_xmlhttpRequest({
          method: 'GET', url: endpoint, timeout: 15000,
          onload: resolve, onerror: () => reject(new Error('百度授权状态查询失败')),
          ontimeout: () => reject(new Error('百度授权状态查询超时'))
        }));
        const locationText = `${result.finalUrl || ''}\\n${result.responseHeaders || ''}`;
        const match = /access_token=([^&#\\s]+)/.exec(locationText);
        if (match) {
          const token = decodeURIComponent(match[1]);
          GM_setValue('baidu_access_token', token);
          return token;
        }
        // Never submit the OAuth consent form without the user's explicit action.
        getPageWindow().open(endpoint, '_blank', 'noopener,noreferrer');
        throw new Error('请在新标签页明确授权百度网盘，授权后再次点击 RPC发送');
      }
      async function baiduGetDownloadUrl(file, token) {
        const url = new URL('https://pan.baidu.com/rest/2.0/xpan/multimedia?method=filemetas&dlink=1');
        url.searchParams.set('fsids', JSON.stringify([file.fs_id]));
        url.searchParams.set('access_token', token);
        return new Promise((resolve, reject) => GM_xmlhttpRequest({
          method: 'GET', url: url.href, timeout: 18000,
          headers: { 'User-Agent': 'pan.baidu.com' },
          onload(response) {
            try {
              const data = JSON.parse(response.responseText);
              const entry = data.list?.find((x) => x.fs_id == file.fs_id);
              if (data.errno === 9019) {
                GM_setValue('baidu_access_token', '');
                reject(new Error('百度需要安全验证（9019）：旧授权已清除，请在百度授权页重新授权并重试；若仍报错请完成官方验证'));
                return;
              }
              if (data.errno !== 0 || !/^https?:\/\//.test(entry?.dlink || '')) {
                reject(new Error(`百度接口 ${data.errno || response.status}：${data.errmsg || '未获得下载地址'}`)); return;
              }
              const link = new URL(entry.dlink);
              link.searchParams.set('access_token', token);
              resolve(link.href);
            } catch (error) { reject(error); }
          },
          onerror: () => reject(new Error('百度取链请求失败')),
          ontimeout: () => reject(new Error('百度取链超时'))
        }));
      }
      const UC_PC_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) uc-cloud-drive/1.8.8 Chrome/100.0.4896.160 Electron/18.3.5.16-b62cf9c50d Safari/537.36 Channel/ucpan_other_ch';
      const UC_CH_UA = '"Not=A?Brand";v="99", "Chromium";v="100", "Google Chrome";v="100"';
      function ucSelectedFiles() {
        const el = getPageWindow().document.querySelector('.file-list');
        if (!el) return [];
        const key = Object.keys(el).find((k) => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
        let fiber = key && el[key];
        for (let i = 0; fiber && i < 40; i++, fiber = fiber.return) {
          const p = fiber.memoizedProps;
          if (!p || !Array.isArray(p.list) || !Array.isArray(p.selectedRowKeys)) continue;
          const mapped = new Map();
          for (const row of getPageWindow().document.querySelectorAll('.file-list .ant-table-tbody tr[data-row-key]')) {
            const checkbox = row.querySelector('.ant-table-selection-column input[type="checkbox"]');
            if (!checkbox?.checked) continue;
            const fid = row.getAttribute('data-row-key');
            const item = p.list.find((x) => x && String(x.fid) === fid);
            if (item && item.file) mapped.set(fid, { ...item, stoken: p.stoken || '' });
          }
          return [...mapped.values()];
        }
        return [];
      }
      async function ucGetDownloadUrls(batch) {
        const share = /^\/(?:s|share)\/([a-zA-Z0-9]+)/.exec(location.pathname);
        const body = { fids: batch.map((x) => x.fid) };
        if (share) {
          body.fids_token = batch.map((x) => x.share_fid_token);
          body.pwd_id = getPageWindow().factStat?.ut?.baseParams?.pwd_id || getPageWindow().factStat?.wa?.customStatParams?.pwd_id || share[1];
          body.stoken = batch[0].stoken;
          if (!body.stoken || body.fids_token.some((x) => !x)) throw new Error('UC 分享令牌缺失，请刷新页面');
        }
        return new Promise((resolve, reject) => GM_xmlhttpRequest({
          method: 'POST', url: 'https://pc-api.uc.cn/1/clouddrive/file/download?pr=UCBrowser&fr=pc&sys=win32&ve=1.8.8',
          headers: { 'Content-Type': 'application/json', Cookie: getPageWindow().document.cookie, 'User-Agent': UC_PC_UA, 'Sec-Ch-Ua': UC_CH_UA },
          data: JSON.stringify(body), timeout: 18000,
          onload(response) {
            try {
              const data = JSON.parse(response.responseText);
              if (data.code !== 0 || !Array.isArray(data.data)) {
                reject(new Error(`UC 接口 ${data.code || response.status}：${data.message || '未获得下载地址'}`)); return;
              }
              const map = new Map(data.data.filter((x) => x.fid && /^https?:\/\//.test(x.download_url || '')).map((x) => [x.fid, x.download_url]));
              resolve(map);
            } catch (error) { reject(error); }
          },
          onerror: () => reject(new Error('UC 取链请求失败')),
          ontimeout: () => reject(new Error('UC 取链超时'))
        }));
      }
      async function ucCheckAnonymousLink(link) {
        return new Promise((resolve) => {
          let settled = false;
          const finish = (ok) => { if (!settled) { settled = true; resolve(ok); } };
          let request, abortPending = false;
          request = GM_xmlhttpRequest({
            method: 'GET', url: link, headers: { Range: 'bytes=0-0', 'User-Agent': UC_PC_UA, 'Sec-Ch-Ua': UC_CH_UA, Cookie: getPageWindow().document.cookie },
            timeout: 12000,
            onreadystatechange(response) {
              if (response.readyState !== 2) return;
              // Inspect headers, then abort before downloading file content.
              if (request) request.abort(); else abortPending = true;
              finish(response.status >= 200 && response.status < 400);
            },
            onload: (response) => finish(response.status >= 200 && response.status < 400),
            onerror: () => finish(false), ontimeout: () => finish(false)
          });
          if (abortPending) request?.abort?.();
        });
      }
      // ===== 光鸭云盘：页面 React 选区 + localStorage 登录凭据调用 api.guangyapan.com =====
      const GUANGYA_API = 'https://api.guangyapan.com';
      function guangyaIsShareView() {
        return /^\/s\//.test(location.pathname) && /^#\/share/.test(location.hash || '#/share');
      }
      // DOM 节点上挂的 fiber 可能是上一次渲染留下的旧副本，需沿 return 走到 HostRoot 判断哪一份是当前树。
      function guangyaCurrentFiber(fiber) {
        if (!fiber || !fiber.alternate) return fiber;
        let top = fiber;
        for (let i = 0; top.return && i < 500; i++) top = top.return;
        return top.stateNode && top.stateNode.current === top ? fiber : fiber.alternate;
      }
      function guangyaListProps() {
        const doc = getPageWindow().document;
        for (const root of doc.querySelectorAll('.swangpan-file-list__root')) {
          const key = Object.keys(root).find((k) => k.startsWith('__reactFiber$'));
          let fiber = key && root[key];
          for (let i = 0; fiber && i < 30; i++, fiber = fiber.return) {
            const props = fiber.memoizedProps;
            if (props && Array.isArray(props.dataSource) && Array.isArray(props.selectedItems)) {
              const live = guangyaCurrentFiber(fiber).memoizedProps;
              return live && Array.isArray(live.selectedItems) ? live : props;
            }
          }
        }
        return null;
      }
      function guangyaSelectedItems() {
        const props = guangyaListProps();
        if (!props) return [];
        const keys = new Set(props.selectedItems.map(String));
        return props.dataSource.filter((item) => item && keys.has(String(item.fileId)));
      }
      function guangyaAuth() {
        const store = getPageWindow().localStorage;
        const key = Object.keys(store).find((k) => k.startsWith('credentials_'));
        let cred = null;
        try { cred = key && JSON.parse(store.getItem(key) || 'null'); } catch (error) { cred = null; }
        if (!cred || !cred.access_token) throw new Error('光鸭未登录，请先登录');
        if (cred.expires_at && Date.parse(cred.expires_at) < Date.now() + 30000) throw new Error('光鸭登录令牌已过期，请刷新页面后重试');
        return { token: `${cred.token_type || 'Bearer'} ${cred.access_token}`, did: store.getItem('swangpan_web_device_id') || '' };
      }
      async function guangyaApi(path, body) {
        const auth = guangyaAuth();
        const headers = { 'Content-Type': 'application/json', dt: '4', Authorization: auth.token };
        if (auth.did) headers.did = auth.did;
        const res = await getPageWindow().fetch(GUANGYA_API + path, { method: 'POST', headers, body: JSON.stringify(body || {}) });
        let json = null;
        try { json = await res.json(); } catch (error) { throw new Error(`光鸭接口返回异常 HTTP ${res.status}`); }
        if (!json || (typeof json.code === 'number' && json.code !== 0)) {
          throw new Error(`光鸭接口 ${json && json.code !== undefined ? json.code : res.status}：${(json && json.msg) || '请求失败'}`);
        }
        return json.data || {};
      }
      async function guangyaListDir(parentId) {
        const all = [];
        for (let page = 0; page < 200; page++) {
          const data = await guangyaApi('/userres/v1/file/get_file_list', { parentId, page, pageSize: 100 });
          const list = Array.isArray(data.list) ? data.list : [];
          all.push(...list);
          const total = Number(data.total) || 0;
          if (!list.length || all.length >= total) break;
        }
        return all;
      }
      // resType：1=文件，2=文件夹。开关开启时递归文件夹，并按目录结构在下载目录下建子目录。
      async function collectGuangyaFiles(items, onProgress) {
        const out = [];
        const seen = new Set();
        const traverse = featureEnabled('guangyaTraverseFolders');
        const walk = async (item, rel, depth) => {
          if (Number(item.resType) !== 2) {
            if (!seen.has(item.fileId)) { seen.add(item.fileId); out.push({ fileId: String(item.fileId), name: safeSegment(item.fileName), rel }); }
            return;
          }
          if (!traverse || depth > 30) return;
          const sub = rel ? `${rel}/${safeSegment(item.fileName)}` : safeSegment(item.fileName);
          for (const child of await guangyaListDir(item.fileId)) await walk(child, sub, depth + 1);
          if (onProgress) onProgress(out.length);
        };
        for (const item of items) await walk(item, '', 0);
        return out;
      }
      async function guangyaGetDownloadUrl(fileId) {
        const data = await guangyaApi('/userres/v1/get_res_download_url', { fileId });
        if (!/^https?:\/\//.test(data.signedURL || '')) throw new Error('光鸭未返回下载地址');
        return data.signedURL;
      }

      // ===== RPC 发送 / 失败记录 / 重试：公共流程（各网盘只提供适配器） =====
      const RPC_TIMEOUT_MS = 10000;
      const RPC_ERROR_LABELS = RPC_FAILURE_TYPE_LABELS;
      function rpcError(type, message) {
        const error = new Error(message);
        error.type = type;
        return error;
      }
      function describeAria2Message(message) {
        const text = String(message || '').trim() || '未知错误';
        return /unauthorized/i.test(text) ? `${text}（RPC token 错误）` : text;
      }
      function describeNetworkFailure(res) {
        const parts = [];
        if (res && res.status) parts.push(`HTTP ${res.status}${res.statusText ? ' ' + res.statusText : ''}`);
        if (res && res.error) parts.push(String(res.error));
        return parts.length ? `（${parts.join('，')}）` : '';
      }
      function liveRpc(rpc) {
        return (rpc && settings.rpcConfigs.find((r) => r.id === rpc.id)) || rpc;
      }
      function storedRpc(rpc) {
        return { id: rpc.id, name: rpc.name, domain: rpc.domain, port: rpc.port, path: rpc.path };
      }
      // 记录里的调用不含 token；发送时按当前配置补上（旧记录里写死的 token 会被替换）。
      function withToken(rpc, call) {
        const params = (call.params || []).filter((p, i) => !(i === 0 && typeof p === 'string' && p.startsWith('token:')));
        const live = liveRpc(rpc);
        const token = (live && live.token) || '';
        return { methodName: call.methodName, params: token ? [`token:${token}`, ...params] : params };
      }

      function aria2Multicall(rpc, calls) {
        const url = buildRpcCheckUrl(liveRpc(rpc));
        return new Promise((resolve, reject) => {
          GM_xmlhttpRequest({
            method: 'POST',
            url,
            headers: { 'Content-Type': 'application/json;charset=UTF-8' },
            data: JSON.stringify({ jsonrpc: '2.0', id: `qk${Date.now()}`, method: 'system.multicall', params: [calls.map((call) => withToken(rpc, call))] }),
            timeout: RPC_TIMEOUT_MS,
            onload(res) {
              let json = null;
              try {
                json = JSON.parse(res.responseText);
              } catch (error) {
                reject(rpcError('bad', `RPC 响应异常：返回内容无法解析（HTTP ${res.status}）`));
                return;
              }
              if (json && json.error) {
                reject(rpcError('rejected', `aria2 拒绝：${describeAria2Message(json.error.message)}`));
                return;
              }
              if (!json || !Array.isArray(json.result)) {
                reject(rpcError('bad', `RPC 响应异常：未返回结果列表（HTTP ${res.status}）`));
                return;
              }
              resolve(json.result);
            },
            onerror(res) {
              reject(rpcError('unreachable', `无法连接 RPC 服务器${describeNetworkFailure(res)}`));
            },
            ontimeout() {
              reject(rpcError('timeout', `RPC 超时（${RPC_TIMEOUT_MS / 1000} 秒无响应）`));
            }
          });
        });
      }

      // 只有 ["gid"] 算成功；{code,message}（JSON-RPC）或 {faultCode,faultString}（XML-RPC）是 aria2 明确拒绝；其余一律算失败。
      function classifyRpcResult(result, index) {
        if (Array.isArray(result) && result[0]) return { ok: true };
        if (result && typeof result === 'object' && !Array.isArray(result) && (result.message || result.faultString)) {
          return { type: 'rejected', reason: `aria2 拒绝：${describeAria2Message(result.message || result.faultString)}` };
        }
        return { type: 'bad', reason: result === undefined ? `RPC 响应异常：未返回第 ${index + 1} 项结果` : 'RPC 响应异常：结果格式无法识别' };
      }

      async function probeRpc(rpc) {
        try {
          await checkRpcServer(liveRpc(rpc));
          return { ok: true };
        } catch (error) {
          const message = error.message || String(error);
          const type = /超时/.test(message) ? 'timeout' : /网络请求失败/.test(message) ? 'unreachable'
            : /^HTTP |无法解析|不是有效/.test(message) ? 'bad' : 'rejected';
          return { ok: false, type, reason: `${RPC_ERROR_LABELS[type]}：${message}` };
        }
      }

      function buildAddUri(adapter, job, link) {
        const options = adapter.options(job.ident, link);
        const dir = joinDir(job.dir, job.rel);
        if (dir) options.dir = dir;
        return { methodName: 'aria2.addUri', params: [[link], options] };
      }

      // 逐批取链并发送，任何一批出错都继续处理后续批次（必须发完）。
      // RPC 请求本身失败时重测服务器；仍不可用则后续批次只取链、不发送，记为「未发送」，避免每批都等超时。
      async function deliverJobs(rpc, jobs, adapter, verb) {
        const outcome = { ok: [], failed: [] };
        const fail = (job, type, reason) => {
          job.errorType = type;
          job.reason = reason;
          outcome.failed.push(job);
        };
        let rpcDown = '';
        for (let i = 0; i < jobs.length; i += QUARK_LINK_BATCH) {
          const batch = jobs.slice(i, i + QUARK_LINK_BATCH);
          setSendText(`${verb} ${i + 1}/${jobs.length}`);
          const needLink = batch.filter((job) => !job.call);
          if (needLink.length) {
            let links;
            try {
              if (!adapter) throw new Error('当前页面不能为该网盘取链');
              links = await adapter.getLinks(needLink.map((job) => job.ident));
            } catch (error) {
              links = needLink.map(() => ({ error: error.message || String(error) }));
            }
            needLink.forEach((job, k) => {
              const got = (links && links[k]) || {};
              if (got.link) job.call = buildAddUri(adapter, job, got.link);
              else fail(job, 'link', `取链失败：${got.error || '未获得下载地址'}`);
            });
          }
          const ready = batch.filter((job) => job.call && !job.errorType);
          if (!ready.length) continue;
          if (rpcDown) {
            ready.forEach((job) => fail(job, 'skipped', `未发送：${rpcDown}`));
            continue;
          }
          try {
            const results = await aria2Multicall(rpc, ready.map((job) => job.call));
            ready.forEach((job, k) => {
              const verdict = classifyRpcResult(results[k], k);
              if (verdict.ok) outcome.ok.push(job);
              else fail(job, verdict.type, verdict.reason);
            });
          } catch (error) {
            ready.forEach((job) => fail(job, error.type || 'bad', error.message || String(error)));
            if (error.type !== 'rejected') {
              setSendText('重测 RPC…');
              const probe = await probeRpc(rpc);
              if (!probe.ok) rpcDown = probe.reason;
            }
          }
          if (i + QUARK_LINK_BATCH < jobs.length) await sleep(200);
        }
        return outcome;
      }

      function summarizeFailures(failed) {
        const counts = new Map();
        failed.forEach((job) => counts.set(job.errorType, (counts.get(job.errorType) || 0) + 1));
        return [...counts].map(([type, n]) => `${RPC_ERROR_LABELS[type] || type} ${n}`).join('、');
      }

      let sending = false;
      // 失败记录持久化（含直链、请求头与文件身份，随 WebDAV 同步）。
      let sessionFailureIds = [];
      function makeFailureId() {
        return `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      }
      function refreshRetryButton() {
        const live = new Set(getRpcFailures().map((x) => x.id));
        sessionFailureIds = sessionFailureIds.filter((id) => live.has(id));
        const n = sessionFailureIds.length;
        btnRetryFailed.hidden = n === 0;
        btnRetryAdvanced.hidden = n === 0;
        btnRetryFailed.textContent = `重试失败项（${n}）`;
        btnRetryFailed.title = n ? '用原直链重发；取链失败的项在本页重新取链。历史失败见 设置 → 日志 → 失败记录。' : '';
      }
      function resetSessionFailures() {
        sessionFailureIds = [];
        refreshRetryButton();
      }
      function jobToRecord(job, rpc) {
        return {
          id: makeFailureId(), time: formatTime(new Date()), site: SITE_HOST, pageUrl: location.href, attempts: 1,
          name: job.name, rel: job.rel || '', dir: job.dir || '', ident: job.ident || null, rpc: storedRpc(rpc),
          call: job.call || null, errorType: job.errorType, reason: job.reason
        };
      }
      function setBusy(busy) {
        sending = busy;
        btnSend.disabled = busy;
        btnRetryFailed.disabled = busy;
        btnRetryAdvanced.disabled = busy;
        if (!busy) setSendText('RPC发送');
      }

      async function runFreshSend(adapter) {
        if (sending || !adapter) return;
        const active = resolveActive();
        if (!active.rpc) {
          notifyToast('⚠️ 请先在「设置」里添加 RPC 服务器', 'warning');
          return;
        }
        const rpcName = active.rpc.name || active.rpc.domain;
        setBusy(true);
        try {
          setSendText('收集中…');
          const files = await adapter.collect((n) => setSendText(`收集中 ${n}`));
          if (!files || !files.length) return;
          if (files.length > QUARK_CONFIRM_OVER) qkNotice(`向 ${rpcName} 发送 ${files.length} 个${adapter.label}文件`);
          if (adapter.prepare) await adapter.prepare();
          setSendText('检测 RPC…');
          const probe = await probeRpc(active.rpc);
          if (!probe.ok) {
            playRpcResultSound();
            notifyToast(`❌ 未发送，${rpcName} 不可用：${probe.reason}`, 'error', 8000);
            return;
          }
          resetSessionFailures();
          const jobs = files.map((f) => ({
            name: adapter.nameOf(f), rel: (adapter.relOf && adapter.relOf(f)) || '', dir: active.dir, ident: adapter.ident(f), call: null
          }));
          const { ok, failed } = await deliverJobs(active.rpc, jobs, adapter, '发送');
          if (failed.length) console.warn('[夸克懒得点][RPC] 失败明细:', failed.map((job) => `${job.name}：${job.reason}`));
          if (!ok.length) {
            // 全部失败：视为未发送，不写失败记录和下载记录。
            playRpcResultSound();
            notifyToast(`❌ ${adapter.label} RPC 全部失败，视为未发送（${summarizeFailures(failed)}）：${failed[0].reason}`, 'error', 9000);
            return;
          }
          if (failed.length) {
            const records = failed.map((job) => jobToRecord(job, active.rpc));
            setRpcFailures(records.concat(getRpcFailures()));
            sessionFailureIds = records.map((r) => r.id);
            refreshRetryButton();
            playRpcResultSound();
          }
          recordRpcLog(adapter.label, 'RPC 任务汇总（仅表示 RPC 接收，不代表下载完成）',
            failed.length ? `已发送 ${ok.length}，失败 ${failed.length}` : `已发送 ${ok.length}`, undefined, jobs.map((job) => job.name));
          if (failed.length) {
            notifyToast(`⚠️ ${adapter.label} RPC：成功 ${ok.length}，失败 ${failed.length}（${summarizeFailures(failed)}）；${failed[0].name}：${failed[0].reason}`, 'warning', 9000);
          } else {
            notifyToast(`✅ 已发送 ${ok.length} 个文件到 ${rpcName}：${active.dir || '默认目录'}`, 'success', 5000);
          }
        } catch (error) {
          console.error(`[夸克懒得点][${adapter.label}] 发送异常:`, error);
          playRpcResultSound();
          notifyToast(`❌ ${adapter.label} RPC 未发送：${error.message || error}`, 'error', 7000);
        } finally {
          setBusy(false);
        }
      }

      // ===== 重试：默认原链重发；高级重试可选重新取链、目标 RPC、下载目录 =====
      function callWithDir(call, dir) {
        const params = (call.params || []).filter((p, i) => !(i === 0 && typeof p === 'string' && p.startsWith('token:')));
        const options = { ...(params[1] || {}) };
        if (dir) options.dir = dir; else delete options.dir;
        return { methodName: call.methodName, params: [params[0], options, ...params.slice(2)] };
      }
      function canRefetch(entry) {
        return Boolean(entry && entry.ident && entry.site === SITE_HOST && pageAdapter &&
          (!pageAdapter.canRefetch || pageAdapter.canRefetch(entry)));
      }
      function stripToken(call) {
        const params = (call.params || []).filter((p, i) => !(i === 0 && typeof p === 'string' && p.startsWith('token:')));
        return { methodName: call.methodName, params };
      }
      // options.mode: 'auto'（默认：有原链就原链重发，取链失败的项在本页重新取链）| 'reuse' | 'refetch'
      // options.rpcId: ''=原服务器；options.dir: null=原目录
      async function retryFailures(ids, options) {
        if (ids === null) return true;
        if (sending) { notifyToast('正在发送，请稍后再重试', 'warning'); return; }
        const opts = { mode: 'auto', rpcId: '', dir: null, ...(options || {}) };
        const picked = getRpcFailures().filter((x) => ids.includes(x.id));
        if (!picked.length) { notifyToast('选中项已不存在', 'warning'); return; }
        const skipped = [];
        const plans = [];
        picked.forEach((entry) => {
          const rpc = opts.rpcId ? settings.rpcConfigs.find((r) => r.id === opts.rpcId) : (entry.rpc && liveRpc(entry.rpc));
          if (!rpc) { skipped.push(`${entry.name}：没有可用的 RPC 服务器记录`); return; }
          const useOld = opts.mode !== 'refetch' && Boolean(entry.call);
          if (!useOld && !canRefetch(entry)) {
            skipped.push(`${entry.name}：${entry.ident ? `需在${siteLabel(entry.site)}页面（原页面）重新取链` : '没有可重试的下载地址，请回原页重新发送'}`);
            return;
          }
          const call = !useOld ? null : opts.dir === null ? stripToken(entry.call) : callWithDir(entry.call, joinDir(opts.dir, entry.rel));
          plans.push({ entry, rpc, job: { name: entry.name, rel: entry.rel || '', dir: opts.dir !== null ? opts.dir : (entry.dir || ''), ident: entry.ident, call } });
        });
        if (!plans.length) {
          notifyToast(`没有可重试的项：${skipped[0] || ''}`, 'warning', 7000);
          return;
        }
        setBusy(true);
        const done = new Set();
        const updates = new Map();
        const now = formatTime(new Date());
        const downRpcs = [];
        try {
          const groups = new Map();
          plans.forEach((plan) => {
            const key = plan.rpc.id || `${plan.rpc.domain}:${plan.rpc.port}`;
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(plan);
          });
          for (const group of groups.values()) {
            const rpc = group[0].rpc;
            setSendText('检测 RPC…');
            const probe = await probeRpc(rpc);
            if (!probe.ok) {
              // 服务器不可用：不发送，记录保持原样。
              downRpcs.push(`${rpc.name || rpc.domain}：${probe.reason}`);
              group.forEach((plan) => skipped.push(`${plan.entry.name}：服务器不可用，未发送`));
              continue;
            }
            const jobs = group.map((plan) => plan.job);
            const { ok, failed } = await deliverJobs(rpc, jobs, pageAdapter, '重试');
            ok.forEach((job) => done.add(group[jobs.indexOf(job)].entry.id));
            failed.forEach((job) => {
              const entry = group[jobs.indexOf(job)].entry;
              updates.set(entry.id, { ...entry, time: now, attempts: (entry.attempts || 1) + 1, errorType: job.errorType, reason: job.reason,
                uncertain: undefined, rpc: storedRpc(rpc), dir: job.dir || '', call: job.call || entry.call || null });
            });
          }
          setRpcFailures(getRpcFailures().filter((x) => !done.has(x.id)).map((x) => updates.get(x.id) || x));
          refreshRetryButton();
          const bySite = new Map();
          plans.forEach(({ entry }) => {
            if (!done.has(entry.id) && !updates.has(entry.id)) return;
            const stat = bySite.get(entry.site) || { ok: 0, fail: 0, names: [] };
            if (done.has(entry.id)) stat.ok++; else stat.fail++;
            stat.names.push(entry.name);
            bySite.set(entry.site, stat);
          });
          bySite.forEach((stat, site) => recordRpcLog(siteLabel(site), '失败记录重试（仅表示 RPC 接收，不代表下载完成）',
            `重试：${stat.fail ? `已发送 ${stat.ok}，失败 ${stat.fail}` : `已发送 ${stat.ok}`}`, site, stat.names));
          if (skipped.length) console.warn('[夸克懒得点][RPC] 本次未重试:', skipped);
          if (updates.size) console.warn('[夸克懒得点][RPC] 重试仍失败:', [...updates.values()].map((x) => `${x.name}：${x.reason}`));
          const failedList = [...updates.values()];
          const parts = [`成功 ${done.size}`, `仍失败 ${updates.size}`];
          if (skipped.length) parts.push(`未重试 ${skipped.length}`);
          const detail = downRpcs.length ? `；服务器不可用 ${downRpcs[0]}`
            : failedList.length ? `；${failedList[0].name}：${failedList[0].reason}`
              : skipped.length ? `；${skipped[0]}` : '';
          if (updates.size || skipped.length) playRpcResultSound();
          notifyToast(`重试完成：${parts.join('，')}${detail}`, updates.size || skipped.length ? 'warning' : 'success', 9000);
        } finally {
          setBusy(false);
        }
      }

      // 高级重试：全部用大按钮选择；目标 RPC 可选任一已保存服务器，下载目录只列该服务器绑定的路径。
      function openAdvancedRetry(ids, onDone) {
        const entries = getRpcFailures().filter((x) => ids.includes(x.id));
        if (!entries.length) { notifyToast('没有可重试的失败项', 'warning'); return; }
        document.getElementById('qk-rpc-adv-retry')?.remove();
        const withCall = entries.filter((x) => x.call).length;
        const refetchable = entries.filter(canRefetch).length;
        const autoUsable = withCall > 0 || refetchable > 0;
        const origRpcIds = [...new Set(entries.map((x) => x.rpc && x.rpc.id).filter(Boolean))];
        const origRpc = origRpcIds.length === 1 ? settings.rpcConfigs.find((r) => r.id === origRpcIds[0]) : null;
        const origRpcLabel = origRpc ? (origRpc.name || origRpc.domain)
          : origRpcIds.length > 1 ? `${origRpcIds.length} 台服务器` : ((entries[0].rpc && (entries[0].rpc.name || entries[0].rpc.domain)) || '记录中的服务器');
        const state = { mode: autoUsable ? 'auto' : 'refetch', rpcId: '', dir: null };

        const overlay = document.createElement('div');
        overlay.id = 'qk-rpc-adv-retry';
        const box = document.createElement('div');
        box.className = 'qk-adv-box';
        box.setAttribute('role', 'dialog');
        box.setAttribute('aria-modal', 'true');
        const head = document.createElement('div');
        head.className = 'qk-adv-head';
        const title = document.createElement('div');
        title.className = 'qk-adv-title';
        title.textContent = '高级重试';
        const count = document.createElement('span');
        count.className = 'qk-adv-count';
        count.textContent = `${entries.length} 项`;
        title.appendChild(count);
        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'qk-adv-close';
        close.setAttribute('aria-label', '关闭');
        close.textContent = '×';
        close.onclick = () => overlay.remove();
        head.append(title, close);
        const body = document.createElement('div');
        body.className = 'qk-adv-body';

        const section = (label) => {
          const wrap = document.createElement('div');
          wrap.className = 'qk-adv-section';
          const heading = document.createElement('div');
          heading.className = 'qk-adv-label';
          heading.textContent = label;
          const grid = document.createElement('div');
          grid.className = 'qk-adv-options';
          grid.setAttribute('role', 'radiogroup');
          grid.setAttribute('aria-label', label);
          wrap.append(heading, grid);
          body.appendChild(wrap);
          return grid;
        };
        const option = (grid, { main, sub, selected, disabled, onPick, wide }) => {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = `qk-adv-option${wide ? ' is-wide' : ''}`;
          button.setAttribute('role', 'radio');
          button.setAttribute('aria-checked', String(Boolean(selected)));
          button.disabled = Boolean(disabled);
          const mainText = document.createElement('span');
          mainText.className = 'qk-adv-main';
          mainText.textContent = main;
          button.appendChild(mainText);
          if (sub) {
            const subText = document.createElement('span');
            subText.className = 'qk-adv-sub';
            subText.textContent = sub;
            button.appendChild(subText);
          }
          button.title = sub ? `${main}\n${sub}` : main;
          button.onclick = onPick;
          grid.appendChild(button);
        };

        const modeGrid = section('重试方式');
        modeGrid.classList.add('is-two');
        const rpcGrid = section('目标 RPC');
        const dirGrid = section('下载目录');

        function boundPaths(rpcId) {
          return rpcId ? getBoundPathValues(rpcId) : (origRpc ? getBoundPathValues(origRpc.id) : []);
        }
        function render() {
          modeGrid.replaceChildren();
          option(modeGrid, {
            main: '原链重发',
            sub: withCall ? `${withCall}/${entries.length} 项有原链（可能已过期）${withCall < entries.length ? '；其余在本页重新取链' : ''}` : '没有可用的原链',
            selected: state.mode === 'auto', disabled: !autoUsable, onPick: () => { state.mode = 'auto'; render(); }
          });
          option(modeGrid, {
            main: '重新取链',
            sub: refetchable ? `${refetchable}/${entries.length} 项可在本页取链${refetchable < entries.length ? '；其余需到对应网盘页面' : ''}` : '需到对应网盘页面',
            selected: state.mode === 'refetch', disabled: refetchable === 0, onPick: () => { state.mode = 'refetch'; render(); }
          });

          rpcGrid.replaceChildren();
          option(rpcGrid, { main: '原服务器', sub: origRpcLabel, selected: state.rpcId === '',
            onPick: () => { state.rpcId = ''; render(); } });
          settings.rpcConfigs.forEach((rpc) => option(rpcGrid, {
            main: rpc.name || rpc.domain, sub: composeServerEndpoint(rpc.domain, rpc.port),
            selected: state.rpcId === rpc.id,
            onPick: () => { state.rpcId = rpc.id; render(); }
          }));

          const paths = boundPaths(state.rpcId);
          if (state.dir !== null && !paths.includes(state.dir)) state.dir = null;
          dirGrid.replaceChildren();
          option(dirGrid, { main: '原目录', sub: '保持每条记录发送时的目录', selected: state.dir === null, wide: true,
            onPick: () => { state.dir = null; render(); } });
          paths.forEach((path) => option(dirGrid, { main: path, selected: state.dir === path, wide: true,
            onPick: () => { state.dir = path; render(); } }));
          if (!paths.length) {
            const hint = document.createElement('div');
            hint.className = 'qk-adv-hint';
            hint.textContent = origRpcIds.length > 1 ? '记录来自多台服务器，选定目标 RPC 后可选择其绑定目录' : '该服务器没有绑定路径';
            dirGrid.appendChild(hint);
          }
        }

        const foot = document.createElement('div');
        foot.className = 'qk-adv-foot';
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'qk-adv-btn';
        cancel.textContent = '取消';
        cancel.onclick = () => overlay.remove();
        const go = document.createElement('button');
        go.type = 'button';
        go.className = 'qk-adv-btn is-primary';
        go.textContent = '开始重试';
        go.disabled = !autoUsable && refetchable === 0;
        go.onclick = () => {
          overlay.remove();
          Promise.resolve(retryFailures(ids, { mode: state.mode, rpcId: state.rpcId, dir: state.dir }))
            .finally(() => { if (onDone) onDone(); });
        };
        foot.append(cancel, go);

        render();
        box.append(head, body, foot);
        overlay.appendChild(box);
        overlay.addEventListener('click', (event) => { if (event.target === overlay) overlay.remove(); });
        overlay.addEventListener('keydown', (event) => { if (event.key === 'Escape') overlay.remove(); });
        document.body.appendChild(overlay);
        go.focus();
      }

      btnRetryFailed.onclick = () => retryFailures(sessionFailureIds.slice());
      btnRetryAdvanced.onclick = () => openAdvancedRetry(sessionFailureIds.slice());

      function setSendText(text) {
        if (btnSend.textContent !== text) btnSend.textContent = text;
      }

      // ===== 各网盘适配器：收集勾选文件、文件身份（可序列化，用于重新取链）、取链、aria2 下载参数 =====
      function settleLinks(promises) {
        return Promise.allSettled(promises).then((list) => list.map((r) => (r.status === 'fulfilled'
          ? { link: r.value } : { error: (r.reason && r.reason.message) || String(r.reason) })));
      }
      const ADAPTERS = {
        'pan.quark.cn': {
          label: '夸克',
          async collect(onProgress) {
            const props = getQuarkListProps();
            const keys = props ? new Set(props.selectedRowKeys) : new Set();
            const selected = props ? props.list.filter((item) => keys.has(item.fid)) : [];
            if (!selected.length) { notifyToast('⚠️ 请先勾选要发送的文件或文件夹', 'warning'); return []; }
            const files = await collectQuarkFiles(selected, onProgress);
            if (!files.length) {
              notifyToast(featureEnabled('quarkTraverseFolders') ? '⚠️ 所选文件夹里没有文件'
                : '⚠️ 没有可发送的文件；如需发送文件夹内文件，请开启「勾选文件夹时递归发送其中的文件（RPC）」', 'warning');
            }
            return files;
          },
          nameOf: (f) => f.name,
          relOf: (f) => f.rel,
          ident: (f) => ({ fid: f.fid, name: f.name }),
          async getLinks(idents) {
            const map = await quarkGetLinks(idents.map((x) => x.fid));
            return idents.map((x) => (map[x.fid] ? { link: map[x.fid] } : { error: '未取到下载地址' }));
          },
          options: (ident) => ({ out: ident.name, 'user-agent': QUARK_PC_UA, referer: 'https://pan.quark.cn/',
            header: [`Cookie: ${getPageWindow().document.cookie}`] })
        },
        'cloud.189.cn': {
          label: '天翼',
          async collect() {
            const selected = await tcloudGetSelected();
            if (!selected.length) { notifyToast('请先勾选文件', 'warning'); return []; }
            const files = selected.filter((item) => !item.isFolder);
            if (!files.length) notifyToast('请打开文件夹后勾选文件', 'warning');
            return files;
          },
          nameOf: (f) => f.fileName,
          ident: (f) => ({ fileId: f.fileId, shareId: f.shareId || '', fileName: f.fileName }),
          getLinks(idents) {
            const token = getPageWindow().localStorage.getItem('accessToken');
            if (!token) throw new Error('天翼登录令牌不存在，请刷新页面');
            return settleLinks(idents.map((x) => tcloudGetDownloadUrl(x, token)));
          },
          options: (ident) => ({ out: safeSegment(ident.fileName) })
        },
        'pan.xunlei.com': {
          label: '迅雷',
          async collect() {
            const files = xunleiSelectedFiles();
            if (!files.length) notifyToast('请先勾选文件（文件夹请打开后勾选文件）', 'warning');
            return files;
          },
          nameOf: (f) => f.name,
          ident: (f) => ({ id: f.id, name: f.name }),
          getLinks(idents) {
            const auth = xunleiAuth();
            return settleLinks(idents.map((x) => xunleiGetDownloadUrl(x, auth)));
          },
          options: (ident) => ({ out: safeSegment(ident.name) })
        },
        'yun.139.com': {
          label: '139',
          async collect() {
            const files = mcloudSelectedFiles();
            if (!files.length) notifyToast('请先勾选文件（文件夹请打开后勾选文件）', 'warning');
            return files;
          },
          nameOf: (f) => f.contentName,
          ident: (f) => ({ contentID: f.contentID, contentName: f.contentName }),
          getLinks: (idents) => settleLinks(idents.map((x) => mcloudGetDownloadUrl(x))),
          options: (ident) => ({ out: safeSegment(ident.contentName) })
        },
        'yun.123pan.cn': {
          label: '123',
          async collect() {
            const files = pan123SelectedFiles();
            if (!files.length) notifyToast('请先勾选文件（文件夹请打开后勾选文件）', 'warning');
            return files;
          },
          nameOf: (f) => f.FileName,
          ident: (f) => ({ Etag: f.Etag, FileId: f.FileId, S3KeyFlag: f.S3KeyFlag, Type: f.Type, FileName: f.FileName, Size: f.Size }),
          getLinks: (idents) => settleLinks(idents.map((x) => pan123GetDownloadUrl(x))),
          options: (ident) => ({ out: safeSegment(ident.FileName) })
        },
        '115.com': {
          label: '115',
          async collect(onProgress) {
            const selected = one15SelectedFiles();
            if (!selected.length) { notifyToast('请先勾选文件或文件夹', 'warning'); return []; }
            if (!featureEnabled('115TraverseFolders') && !selected.some((f) => !f.isFolder && f.pickCode)) {
              notifyToast('请先勾选文件；如需发送文件夹内文件，请在 设置 → 115专属 开启「勾选文件夹时递归发送其中的文件」', 'warning', 6000);
              return [];
            }
            const files = await collect115Files(selected, onProgress);
            if (!files.length) notifyToast('⚠️ 所选文件夹里没有文件', 'warning');
            return files;
          },
          nameOf: (f) => f.name,
          relOf: (f) => f.rel,
          ident: (f) => ({ pickCode: f.pickCode, name: f.name }),
          getLinks: (idents) => settleLinks(idents.map((x) => one15GetDownloadUrl(x.pickCode))),
          options: (ident) => ({ out: safeSegment(ident.name), 'user-agent': navigator.userAgent,
            referer: 'https://115.com/', header: [`Cookie: ${getPageWindow().document.cookie}`] })
        },
        'pan.baidu.com': {
          label: '百度',
          async collect() {
            const files = baiduSelectedFiles();
            if (!files.length) notifyToast('请先勾选文件（文件夹请打开后勾选文件）', 'warning');
            return files;
          },
          // 未授权时会打开授权页并抛错，放在检测 RPC 之前只执行一次。
          prepare: () => baiduOauthToken(),
          nameOf: (f) => f.server_filename,
          ident: (f) => ({ fs_id: f.fs_id, server_filename: f.server_filename }),
          getLinks(idents) {
            const token = GM_getValue('baidu_access_token', '');
            if (!token) throw new Error('百度未授权，请先点 RPC发送 完成授权');
            return settleLinks(idents.map((x) => baiduGetDownloadUrl(x, token)));
          },
          options: (ident) => ({ out: safeSegment(ident.server_filename), 'user-agent': 'pan.baidu.com' })
        },
        'drive.uc.cn': {
          label: 'UC',
          async collect() {
            const files = ucSelectedFiles();
            if (!files.length) notifyToast('请先勾选文件（文件夹请打开后勾选文件）', 'warning');
            return files;
          },
          nameOf: (f) => f.file_name,
          ident: (f) => ({ fid: f.fid, file_name: f.file_name, share_fid_token: f.share_fid_token || '', stoken: f.stoken || '' }),
          // UC 分享文件的取链需要分享页令牌，只能回到原分享页重新取链。
          canRefetch(entry) {
            if (!entry.ident || !entry.ident.share_fid_token) return true;
            try { return new URL(entry.pageUrl).pathname === location.pathname; } catch (error) { return false; }
          },
          async getLinks(idents) {
            const map = await ucGetDownloadUrls(idents);
            const out = [];
            for (const x of idents) {
              const link = map.get(x.fid);
              if (!link) out.push({ error: '未获得地址' });
              // 匿名分享偶尔返回 CDN 拒绝的签名地址，预检后不把坏链接交给 aria2。
              else if (!(await ucCheckAnonymousLink(link))) out.push({ error: 'UC 当前直链 CDN 返回拒绝访问' });
              else out.push({ link });
            }
            return out;
          },
          options: (ident) => ({ out: safeSegment(ident.file_name), 'user-agent': UC_PC_UA,
            header: [`Sec-Ch-Ua: ${UC_CH_UA}`, `Cookie: ${getPageWindow().document.cookie}`] })
        },
        'www.guangyapan.com': {
          label: '光鸭',
          async collect(onProgress) {
            if (guangyaIsShareView()) { notifyToast('分享页需先「保存到云盘」，再到网盘列表勾选后 RPC 发送', 'warning', 6000); return []; }
            const selected = guangyaSelectedItems();
            if (!selected.length) { notifyToast('请先勾选要发送的文件或文件夹', 'warning'); return []; }
            const files = await collectGuangyaFiles(selected, onProgress);
            if (!files.length) {
              notifyToast(featureEnabled('guangyaTraverseFolders') ? '⚠️ 所选文件夹里没有文件'
                : '⚠️ 没有可发送的文件；如需发送文件夹内文件，请在 设置 → 光鸭专属 开启递归发送', 'warning', 6000);
            }
            return files;
          },
          nameOf: (f) => f.name,
          relOf: (f) => f.rel,
          ident: (f) => ({ fileId: f.fileId, name: f.name }),
          getLinks: (idents) => settleLinks(idents.map((x) => guangyaGetDownloadUrl(x.fileId))),
          options: (ident) => ({ out: safeSegment(ident.name) })
        }
      };
      function formatMotrixCommand(entries) {
        if (!entries.length) throw new Error('没有可复制的下载地址');
        const quote = (value) => `'${String(value).replace(/'/g, `'\\''`)}'`;
        const normalize = (options) => {
          const result = {};
          if (options['user-agent']) result['User-Agent'] = String(options['user-agent']);
          if (options.referer) result.Referer = String(options.referer);
          const headers = Array.isArray(options.header) ? options.header : (options.header ? [options.header] : []);
          headers.forEach((line) => {
            const at = line.indexOf(':');
            if (at > 0) result[line.slice(0, at).trim()] = line.slice(at + 1).trim();
          });
          return result;
        };
        const opts = entries.map((entry) => entry.options || {});
        const headers = normalize(opts[0]);
        if (opts.some((item) => JSON.stringify(normalize(item)) !== JSON.stringify(headers))) {
          throw new Error('所选文件的请求头不同，Motrix 无法批量导入；请分别复制');
        }
        const args = ['curl -L', '-g'];
        for (const [key, value] of Object.entries(headers)) args.push('-H', quote(`${key}: ${value}`));
        if (entries.length === 1 && opts[0].out) args.push('-o', quote(opts[0].out));
        entries.forEach((entry) => args.push('--url', quote(entry.link)));
        return args.join(' ');
      }
      async function copySelectedLinks(adapter) {
        if (!adapter) return;
        btnCopyCommand.disabled = true;
        try {
          const files = await adapter.collect();
          if (!files || !files.length) return;
          if (adapter.prepare) await adapter.prepare();
          const entries = [];
          const failures = [];
          for (let i = 0; i < files.length; i += QUARK_LINK_BATCH) {
            const batch = files.slice(i, i + QUARK_LINK_BATCH);
            const idents = batch.map((file) => adapter.ident(file));
            let links;
            try { links = await adapter.getLinks(idents); }
            catch (error) { links = batch.map(() => ({ error: error.message || String(error) })); }
            batch.forEach((file, index) => {
              const result = links && links[index];
              const link = result && result.link;
              if (!/^https?:\/\//.test(link || '')) {
                failures.push((result && result.error) || '未取到有效下载地址');
                return;
              }
              entries.push({ link, options: adapter.options(idents[index], link) });
            });
          }
          if (!entries.length) {
            notifyToast(`复制直链失败：${failures[0] || '未获得下载地址'}`, 'error', 7000);
            return;
          }
          GM_setClipboard(formatMotrixCommand(entries));
          notifyToast(`已复制 Motrix 命令：成功 ${entries.length}${failures.length ? `，失败 ${failures.length}（${failures[0]}）` : ''}；命令含登录信息，请勿分享`, failures.length ? 'warning' : 'success', 7000);
        } catch (error) {
          notifyToast(`复制直链失败：${error.message || error}`, 'error', 7000);
        } finally {
          btnCopyCommand.disabled = false;
        }
      }
      const pageAdapter = ADAPTERS[SITE_HOST] || null;

      function makeInput(value, placeholder, type) {
        const input = document.createElement('input');
        input.className = 'rpc-helper-input';
        input.value = value || '';
        input.placeholder = placeholder;
        input.type = type || 'text';
        if (input.type === 'password') input.autocomplete = 'new-password';
        return input;
      }

      function ensureDraftBinding(draft, rpcId) {
        if (!draft.rpcPathBindings || typeof draft.rpcPathBindings !== 'object') {
          draft.rpcPathBindings = {};
        }
        if (!draft.rpcPathBindings[rpcId]) {
          const firstPathId = draft.downloadPaths[0] ? draft.downloadPaths[0].id : '';
          draft.rpcPathBindings[rpcId] = {
            pathIds: firstPathId ? [firstPathId] : [],
            defaultPathId: firstPathId
          };
        }
        const binding = draft.rpcPathBindings[rpcId];
        if (!Array.isArray(binding.pathIds)) binding.pathIds = [];
        const pathIdSet = new Set(draft.downloadPaths.map((item) => item.id));
        binding.pathIds = binding.pathIds.filter((id) => pathIdSet.has(id));
        if (binding.pathIds.length === 0 && draft.downloadPaths[0]) {
          binding.pathIds = [draft.downloadPaths[0].id];
        }
        if (!binding.pathIds.includes(binding.defaultPathId)) {
          binding.defaultPathId = binding.pathIds[0] || '';
        }
        return binding;
      }

      function buildRpcCheckUrl(rpc) {
        const endpointText = String(rpc._serverEndpoint || composeServerEndpoint(rpc.domain, rpc.port)).trim();
        const endpoint = splitServerEndpoint(endpointText);
        const rpcPath = normalizePath(rpc.path || '/jsonrpc') || '/jsonrpc';
        if (!endpoint || !rpcPath.startsWith('/')) {
          throw new Error('服务器地址或 JSON-RPC 路径无效');
        }
        return `${endpoint.domain}:${endpoint.port}${rpcPath}`;
      }

      function checkRpcServer(rpc) {
        const url = buildRpcCheckUrl(rpc);
        const params = rpc.token ? [`token:${rpc.token}`] : [];
        const payload = JSON.stringify({
          jsonrpc: '2.0',
          id: `rpc-helper-check-${Date.now()}`,
          method: 'aria2.getVersion',
          params
        });

        return new Promise((resolve, reject) => {
          if (typeof GM_xmlhttpRequest !== 'function') {
            reject(new Error('GM_xmlhttpRequest 不可用'));
            return;
          }

          GM_xmlhttpRequest({
            method: 'POST',
            url,
            headers: { 'Content-Type': 'application/json' },
            data: payload,
            responseType: 'json',
            timeout: 4000,
            onload(response) {
              if (response.status < 200 || response.status >= 300) {
                reject(new Error(`HTTP ${response.status}`));
                return;
              }

              try {
                const result = response.response && typeof response.response === 'object'
                  ? response.response
                  : JSON.parse(response.responseText || '');
                if (result.error) {
                  reject(new Error(result.error.message ? describeAria2Message(result.error.message) : `JSON-RPC 错误 ${result.error.code || ''}`.trim()));
                  return;
                }
                if (!result.result || typeof result.result !== 'object') {
                  reject(new Error('响应不是有效的 Aria2 JSON-RPC 结果'));
                  return;
                }
                resolve(result.result);
              } catch (err) {
                reject(new Error('无法解析服务器响应'));
              }
            },
            onerror(response) {
              reject(new Error(`网络请求失败${describeNetworkFailure(response)}`));
            },
            ontimeout() {
              reject(new Error('检测超时（4秒）'));
            }
          });
        });
      }

      function openSettingsModal() {
        const old = document.getElementById(MODAL_ID);
        if (old) old.remove();

        const overlay = document.createElement('div');
        overlay.id = MODAL_ID;
        if (ON_115_AUX) overlay.classList.add('qk-rpc-aux-modal');

        const panel = document.createElement('div');
        panel.className = 'rpc-helper-panel';

        const head = document.createElement('div');
        head.className = 'rpc-helper-head';
        head.innerHTML = `
          <h3 class="rpc-helper-title">${ON_115_AUX ? '115 分享 / 影巢设置' : 'RPC / 下载路径设置'}</h3>
          <p class="rpc-helper-desc">${ON_115_AUX ? '管理 115 分享来源、名单、日志和 WebDAV 同步。' : '服务器与路径分离管理；在绑定关系中选择一台 RPC 后，单独编辑其可用路径和默认路径。'}</p>
        `;

        const body = document.createElement('div');
        body.className = 'rpc-helper-body';
        const extra = document.createElement('div');
        extra.className = 'qk-rpc-extra';
        extra.hidden = true;
        const tabs = document.createElement('div');
        tabs.className = 'qk-rpc-tabs';
        if (ON_115_AUX) {
          const close = document.createElement('button');
          close.type = 'button';
          close.className = 'qk-rpc-aux-close';
          close.textContent = '关闭';
          close.style.marginLeft = 'auto';
          close.onclick = () => overlay.remove();
          tabs.appendChild(close);
        }
        const siteName = { 'pan.quark.cn':'夸克', '115.com':'115', 'drive.uc.cn':'UC', 'pan.baidu.com':'百度', 'yun.139.com':'139', 'cloud.189.cn':'天翼', 'pan.xunlei.com':'迅雷', 'yun.123pan.cn':'123', 'www.guangyapan.com':'光鸭' }[SITE_HOST] || (ON_115_AUX ? '115' : SITE_HOST);
        const pageNames = { ...(!ON_115_AUX ? { rpc: 'RPC服务器与保存位置' } : {}), general: `${siteName}专属`, blocked: '红橙名单', logs: '日志', sync: 'WebDAV同步' };
        let sections = null;
        const siteFeatures = {
          '115.com': [['115ShareSharerFilter', '分享来源红/橙名单过滤'], ['115AutoRedirect', '115 自动跳转新版'], ['115DeleteFirst', '115 删除按钮提前'], ['115HdhiveTransfer', '115 影巢一键转存'], ['115HideOperations', '115 隐藏指定操作按钮'], ['115SelectAll', '115 页面加载后自动全选当前页'], ['115TraverseFolders', '115 勾选文件夹时递归发送其中的文件（RPC）'], ['115NativeF5', '115 F5 整页刷新（替代 115 自带的列表刷新）']],
          'drive.uc.cn': [['ucShareSharerFilter', '分享来源红/橙名单过滤'], ['ucSelectAll', 'UC 页面加载后自动全选当前页']],
          'pan.baidu.com': [['baiduShareSharerFilter', '分享来源红/橙名单过滤'], ['baiduSelectAll', '百度页面加载后自动全选当前页']],
          'yun.139.com': [['mcloudShareSharerFilter', '分享来源红/橙名单过滤'], ['mcloudSelectAll', '139 页面加载后自动全选当前页']],
          'cloud.189.cn': [['tcloudShareSharerFilter', '分享来源红/橙名单过滤'], ['tcloudSelectAll', '天翼页面加载后自动全选当前页']],
          'pan.xunlei.com': [['xunleiShareSharerFilter', '分享来源红/橙名单过滤'], ['xunleiSelectAll', '迅雷页面加载后自动全选当前页']],
          'yun.123pan.cn': [['123panShareSharerFilter', '分享来源红/橙名单过滤'], ['123panSelectAll', '123 页面加载后自动全选当前页']],
          'www.guangyapan.com': [['guangyaShareSharerFilter', '分享来源红/橙名单过滤'], ['guangyaSelectAll', '光鸭页面加载后自动全选当前页'], ['guangyaTraverseFolders', '光鸭勾选文件夹时递归发送其中的文件（RPC）']]
        };
        const features = siteFeatures[ON_115_AUX ? '115.com' : SITE_HOST] || [];
        const featurePage = document.createElement('div');
        featurePage.className = 'qk-rpc-feature-page';
        if (features.length) {
          if (ON_115_AUX || ON_115) {
            const autoRow = document.createElement('label');
            autoRow.style.cssText = 'display:flex;gap:8px;align-items:center;margin:10px 0;';
            const autoCheckbox = document.createElement('input');
            autoCheckbox.type = 'checkbox'; autoCheckbox.checked = isAutoSaveEnabled();
            autoCheckbox.onchange = () => { setAutoSaveEnabled(autoCheckbox.checked); WebDAV.push(); };
            autoRow.append(autoCheckbox, document.createTextNode('启用自动转存主流程（115 常规分享保存到 /ovo）'));
            featurePage.appendChild(autoRow);
          }
          const switches = features.map(([key, label]) => {
            const row = document.createElement('label');
            row.style.cssText = 'display:flex;gap:8px;align-items:center;margin:10px 0;';
            const input = document.createElement('input');
            input.type = 'checkbox'; input.checked = featureEnabled(key);
            input.onchange = () => { setFeatureEnabled(key, input.checked); WebDAV.push(); };
            row.append(input, document.createTextNode(label));
            featurePage.appendChild(row);
            return [key, input];
          });
          const batch = document.createElement('button');
          batch.type = 'button'; batch.textContent = '全选/取消本站专属功能';
          batch.onclick = () => {
            const enable = switches.some(([key]) => !featureEnabled(key));
            switches.forEach(([key, input]) => { input.checked = enable; setFeatureEnabled(key, enable); });
            WebDAV.push();
          };
          featurePage.appendChild(batch);
        }
        const switchTab = (name) => {
          if (name !== 'rpc' && !sections) {
            showSettingsPanel(false, {
              root: extra,
              switchTab,
              setSections(items) { sections = items; }
            });
          }
          if (!featurePage.isConnected && name !== 'rpc') extra.appendChild(featurePage);
          featurePage.hidden = name !== 'general';
          if (name === 'logs' && !extra.querySelector('[data-qk-log-tab]')) {
            const logPage = document.createElement('div');
            logPage.dataset.qkLogTab = '1';
            showLogViewer(logPage);
            extra.appendChild(logPage);
          }
          body.hidden = name !== 'rpc';
          footer.hidden = name !== 'rpc';
          extra.hidden = name === 'rpc';
          if (sections) Object.entries(sections).forEach(([key, node]) => { node.hidden = key !== name || (key === 'general' && !ON_QUARK && !ON_115_AUX); });

          const logPage = extra.querySelector('[data-qk-log-tab]');
          if (logPage) logPage.hidden = name !== 'logs';
          for (const button of tabs.children) {
            if (button.dataset.page) button.setAttribute('aria-selected', String(button.dataset.page === name));
          }
        };
        for (const [key, label] of Object.entries(pageNames)) {
          const button = document.createElement('button');
          button.type = 'button';
          button.dataset.page = key;
          button.textContent = label;
          button.onclick = () => switchTab(key);
          tabs.appendChild(button);
        }
        if (ON_115_AUX) tabs.appendChild(tabs.querySelector('.qk-rpc-aux-close'));

        const rpcSection = document.createElement('div');
        rpcSection.className = 'rpc-helper-section';
        const rpcHeading = document.createElement('div');
        rpcHeading.className = 'rpc-helper-section-heading';
        const rpcTitle = document.createElement('div');
        rpcTitle.className = 'rpc-helper-section-title';
        rpcTitle.textContent = 'RPC服务器';
        const rpcCheckAll = document.createElement('button');
        rpcCheckAll.type = 'button';
        rpcCheckAll.className = 'rpc-helper-btn rpc-helper-btn-secondary';
        rpcCheckAll.textContent = '批量检测';
        const rpcColumns = document.createElement('div');
        rpcColumns.className = 'rpc-helper-rpc-columns';
        ['名称', '服务器地址', 'Token', 'RPC路径', '状态', '操作'].forEach((text) => {
          const column = document.createElement('div');
          column.textContent = text;
          rpcColumns.appendChild(column);
        });
        const rpcWrap = document.createElement('div');
        const rpcAdd = document.createElement('button');
        rpcAdd.type = 'button';
        rpcAdd.className = 'rpc-helper-btn rpc-helper-btn-add';
        rpcAdd.textContent = '+ 新增RPC';
        rpcHeading.appendChild(rpcTitle);
        rpcHeading.appendChild(rpcCheckAll);
        rpcSection.appendChild(rpcHeading);
        rpcSection.appendChild(rpcColumns);
        rpcSection.appendChild(rpcWrap);
        rpcSection.appendChild(rpcAdd);

        const pathSection = document.createElement('div');
        pathSection.className = 'rpc-helper-section';
        const pathTitle = document.createElement('div');
        pathTitle.className = 'rpc-helper-section-title';
        pathTitle.textContent = '路径库(全局)';
        const pathWrap = document.createElement('div');
        const pathAdd = document.createElement('button');
        pathAdd.type = 'button';
        pathAdd.className = 'rpc-helper-btn rpc-helper-btn-add';
        pathAdd.textContent = '+ 新增路径';
        pathSection.appendChild(pathTitle);
        pathSection.appendChild(pathWrap);
        pathSection.appendChild(pathAdd);

        const bindSection = document.createElement('div');
        bindSection.className = 'rpc-helper-section';
        const bindTitle = document.createElement('div');
        bindTitle.className = 'rpc-helper-section-title';
        bindTitle.textContent = '绑定关系';
        const bindWrap = document.createElement('div');
        bindSection.appendChild(bindTitle);
        bindSection.appendChild(bindWrap);

        const errorBox = document.createElement('div');
        errorBox.className = 'rpc-helper-error';

        const footer = document.createElement('div');
        footer.className = 'rpc-helper-footer';
        const leftTip = document.createElement('div');
        leftTip.className = 'rpc-helper-tip';
        leftTip.textContent = '路径可被多个 RPC 复用；选择服务器后，单独维护其可用路径和默认路径。';
        const actions = document.createElement('div');
        actions.className = 'rpc-helper-group';
        const btnReset = document.createElement('button');
        btnReset.type = 'button';
        btnReset.className = 'rpc-helper-btn';
        btnReset.textContent = '恢复默认';
        const btnCancel = document.createElement('button');
        btnCancel.type = 'button';
        btnCancel.className = 'rpc-helper-btn';
        btnCancel.textContent = '取消';
        const btnSave = document.createElement('button');
        btnSave.type = 'button';
        btnSave.className = 'rpc-helper-btn rpc-helper-btn-primary';
        btnSave.textContent = '保存';
        actions.appendChild(btnReset);
        actions.appendChild(btnCancel);
        actions.appendChild(btnSave);
        footer.appendChild(leftTip);
        footer.appendChild(actions);

        body.appendChild(rpcSection);
        body.appendChild(pathSection);
        body.appendChild(bindSection);

        panel.appendChild(head);
        panel.appendChild(tabs);
        panel.appendChild(body);
        panel.appendChild(extra);
        panel.appendChild(errorBox);
        panel.appendChild(footer);
        overlay.appendChild(panel);

        let draft = deepClone(settings);
        let selectedBindingRpcId = draft.rpcConfigs[0] ? draft.rpcConfigs[0].id : '';
        const rpcCheckResults = new Map();
        const rpcStatusElements = new Map();
        let isCheckingRpcs = false;
        let rpcCheckRunId = 0;

        function getRpcCheckFingerprint(rpc) {
          return JSON.stringify([
            String(rpc._serverEndpoint || composeServerEndpoint(rpc.domain, rpc.port)).trim(),
            String(rpc.token || ''),
            normalizePath(rpc.path || '/jsonrpc') || '/jsonrpc'
          ]);
        }

        function clearRpcCheckResult(rpcId) {
          rpcCheckResults.delete(rpcId);
          renderRpcCheckStatus(rpcId);
        }

        function renderRpcCheckStatus(rpcId) {
          const status = rpcStatusElements.get(rpcId);
          if (!status) return;

          const rpc = draft.rpcConfigs.find((item) => item.id === rpcId);
          const storedResult = rpcCheckResults.get(rpcId);
          const result = rpc && storedResult && storedResult.fingerprint === getRpcCheckFingerprint(rpc)
            ? storedResult
            : null;
          status.className = 'rpc-helper-check-status';
          status.textContent = result ? result.text : '未检测';
          status.title = result && result.detail ? result.detail : '';
          if (result && result.state) status.classList.add(`is-${result.state}`);
        }

        function renderBindings() {
          bindWrap.innerHTML = '';
          if (!Array.isArray(draft.rpcConfigs) || draft.rpcConfigs.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'rpc-helper-empty';
            empty.textContent = '请先添加RPC服务器。';
            bindWrap.appendChild(empty);
            return;
          }

          if (!draft.rpcConfigs.some((rpc) => rpc.id === selectedBindingRpcId)) {
            selectedBindingRpcId = draft.rpcConfigs[0].id;
          }
          const rpc = draft.rpcConfigs.find((item) => item.id === selectedBindingRpcId);
          const binding = ensureDraftBinding(draft, rpc.id);

          function makeBindingRow(labelText, control) {
            const row = document.createElement('div');
            row.className = 'rpc-helper-row bind-editor-row';
            const label = document.createElement('div');
            label.className = 'rpc-helper-label';
            label.textContent = labelText;
            row.appendChild(label);
            row.appendChild(control);
            bindWrap.appendChild(row);
          }

          const rpcSelect = document.createElement('select');
          rpcSelect.className = 'rpc-helper-input';
          draft.rpcConfigs.forEach((item) => {
            const opt = document.createElement('option');
            opt.value = item.id;
            opt.text = item.name || item.domain;
            rpcSelect.appendChild(opt);
          });
          rpcSelect.value = rpc.id;
          rpcSelect.onchange = () => {
            selectedBindingRpcId = rpcSelect.value;
            renderBindings();
          };
          makeBindingRow('绑定服务器', rpcSelect);

          const pathChips = document.createElement('div');
          pathChips.className = 'rpc-helper-path-chips';
          pathChips.setAttribute('role', 'group');
          pathChips.setAttribute('aria-label', '绑定路径（可多选）');

          const defaultSelect = document.createElement('select');
          defaultSelect.className = 'rpc-helper-input';
          const chips = [];

          function refreshDefaultSelect() {
            defaultSelect.innerHTML = '';
            binding.pathIds.forEach((id) => {
              const pathObj = draft.downloadPaths.find((p) => p.id === id);
              if (!pathObj) return;
              const opt = document.createElement('option');
              opt.value = id;
              opt.text = pathObj.path;
              defaultSelect.appendChild(opt);
            });
            if (!binding.pathIds.includes(binding.defaultPathId)) {
              binding.defaultPathId = binding.pathIds[0] || '';
            }
            defaultSelect.value = binding.defaultPathId || '';
          }

          function refreshPathChips() {
            chips.forEach(({ item, chip }) => {
              const selected = binding.pathIds.includes(item.id);
              chip.classList.toggle('is-selected', selected);
              chip.setAttribute('aria-pressed', String(selected));
              chip.disabled = selected && binding.pathIds.length === 1;
              chip.title = chip.disabled ? '至少保留一个绑定路径' : '';
            });
          }

          draft.downloadPaths.forEach((item) => {
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'rpc-helper-path-chip';
            chip.textContent = item.path;
            chip.onclick = () => {
              if (binding.pathIds.includes(item.id)) {
                binding.pathIds = binding.pathIds.filter((id) => id !== item.id);
              } else {
                binding.pathIds.push(item.id);
              }
              if (!binding.pathIds.includes(binding.defaultPathId)) {
                binding.defaultPathId = binding.pathIds[0] || '';
              }
              refreshDefaultSelect();
              refreshPathChips();
            };
            chips.push({ item, chip });
            pathChips.appendChild(chip);
          });

          if (chips.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'rpc-helper-empty';
            empty.textContent = '请先在路径库添加下载路径。';
            pathChips.appendChild(empty);
          }

          defaultSelect.onchange = () => {
            binding.defaultPathId = defaultSelect.value;
          };

          refreshDefaultSelect();
          refreshPathChips();
          makeBindingRow('绑定路径（可多选）', pathChips);
          makeBindingRow('默认下载路径', defaultSelect);
        }

        function renderRpcRows() {
          rpcWrap.innerHTML = '';
          rpcStatusElements.clear();
          draft.rpcConfigs.forEach((rpc, idx) => {
            const row = document.createElement('div');
            row.className = 'rpc-helper-row rpc-row';

            const name = makeInput(rpc.name, '名称');
            const server = makeInput(composeServerEndpoint(rpc.domain, rpc.port), '服务器(含端口) 例如 http://127.0.0.1:6800');
            const token = makeInput(rpc.token, 'Token', 'password');
            const rpcPath = makeInput(rpc.path, '/jsonrpc');
            const checkStatus = document.createElement('div');
            const del = document.createElement('button');
            del.type = 'button';
            del.className = 'rpc-helper-btn rpc-helper-btn-danger';
            del.textContent = '删除';

            name.oninput = () => { draft.rpcConfigs[idx].name = name.value; };
            server.oninput = () => {
              draft.rpcConfigs[idx]._serverEndpoint = server.value;
              clearRpcCheckResult(rpc.id);
            };
            token.oninput = () => {
              draft.rpcConfigs[idx].token = token.value;
              clearRpcCheckResult(rpc.id);
            };
            rpcPath.oninput = () => {
              draft.rpcConfigs[idx].path = rpcPath.value;
              clearRpcCheckResult(rpc.id);
            };
            del.onclick = () => {
              const rpcId = draft.rpcConfigs[idx].id;
              draft.rpcConfigs.splice(idx, 1);
              if (draft.rpcPathBindings && draft.rpcPathBindings[rpcId]) {
                delete draft.rpcPathBindings[rpcId];
              }
              rpcCheckResults.delete(rpcId);
              renderRpcRows();
              renderBindings();
            };

            row.appendChild(name);
            row.appendChild(server);
            row.appendChild(token);
            row.appendChild(rpcPath);
            row.appendChild(checkStatus);
            row.appendChild(del);
            rpcWrap.appendChild(row);

            rpcStatusElements.set(rpc.id, checkStatus);
            renderRpcCheckStatus(rpc.id);
          });
        }

        function renderPathRows() {
          pathWrap.innerHTML = '';
          draft.downloadPaths.forEach((item, idx) => {
            const row = document.createElement('div');
            row.className = 'rpc-helper-row path-row';

            const pathInput = makeInput(item.path, '路径');
            const del = document.createElement('button');
            del.type = 'button';
            del.className = 'rpc-helper-btn rpc-helper-btn-danger';
            del.textContent = '删除';

            pathInput.oninput = () => {
              draft.downloadPaths[idx].path = pathInput.value;
              renderBindings();
            };

            del.onclick = () => {
              const pathId = draft.downloadPaths[idx].id;
              draft.downloadPaths.splice(idx, 1);
              if (draft.rpcPathBindings) {
                Object.keys(draft.rpcPathBindings).forEach((rpcId) => {
                  const binding = ensureDraftBinding(draft, rpcId);
                  binding.pathIds = binding.pathIds.filter((id) => id !== pathId);
                  if (!binding.pathIds.includes(binding.defaultPathId)) {
                    binding.defaultPathId = binding.pathIds[0] || '';
                  }
                });
              }
              renderPathRows();
              renderBindings();
            };

            row.appendChild(pathInput);
            row.appendChild(del);
            pathWrap.appendChild(row);
          });
        }

        function closeModal() {
          overlay.remove();
        }

        rpcAdd.onclick = () => {
          const rpcId = makeId('rpc');
          draft.rpcConfigs.push({
            id: rpcId,
            name: '',
            domain: 'http://127.0.0.1',
            port: '6800',
            token: '',
            path: '/jsonrpc'
          });
          ensureDraftBinding(draft, rpcId);
          renderRpcRows();
          renderBindings();
        };

        rpcCheckAll.onclick = async () => {
          if (isCheckingRpcs) return;
          const checks = draft.rpcConfigs.map((rpc) => ({
            rpc,
            fingerprint: getRpcCheckFingerprint(rpc)
          }));
          if (checks.length === 0) return;

          isCheckingRpcs = true;
          const runId = ++rpcCheckRunId;
          rpcCheckAll.disabled = true;
          rpcCheckAll.textContent = '检测中...';
          checks.forEach(({ rpc, fingerprint }) => {
            rpcCheckResults.set(rpc.id, { state: 'checking', text: '检测中...', fingerprint });
            renderRpcCheckStatus(rpc.id);
          });

          await Promise.all(checks.map(async ({ rpc, fingerprint }) => {
            try {
              const version = await checkRpcServer(rpc);
              const versionText = version.version ? `可用 v${version.version}` : '可用';
              if (runId !== rpcCheckRunId) return;
              rpcCheckResults.set(rpc.id, {
                state: 'success',
                text: versionText,
                detail: versionText,
                fingerprint
              });
            } catch (err) {
              const message = err && err.message ? err.message : '检测失败';
              if (runId !== rpcCheckRunId) return;
              rpcCheckResults.set(rpc.id, {
                state: 'error',
                text: `失败: ${message.length > 48 ? `${message.slice(0, 48)}...` : message}`,
                detail: message,
                fingerprint
              });
            }
            renderRpcCheckStatus(rpc.id);
          }));

          if (runId !== rpcCheckRunId) return;
          isCheckingRpcs = false;
          rpcCheckAll.disabled = false;
          rpcCheckAll.textContent = '批量检测';
        };

        pathAdd.onclick = () => {
          const id = makeId('path');
          draft.downloadPaths.push({ id, path: WIN_DEFAULT_PATH });
          if (draft.rpcPathBindings) {
            Object.keys(draft.rpcPathBindings).forEach((rpcId) => {
              const binding = ensureDraftBinding(draft, rpcId);
              if (binding.pathIds.length === 0) {
                binding.pathIds = [id];
                binding.defaultPathId = id;
              }
            });
          }
          renderPathRows();
          renderBindings();
        };

        btnCancel.onclick = closeModal;
        overlay.addEventListener('click', (event) => {
          if (event.target === overlay) closeModal();
        });

        btnReset.onclick = () => {
          if (!qkNotice('确定恢复默认配置吗？')) return;
          rpcCheckRunId += 1;
          isCheckingRpcs = false;
          rpcCheckAll.disabled = false;
          rpcCheckAll.textContent = '批量检测';
          draft = deepClone(DEFAULT_SETTINGS);
          rpcCheckResults.clear();
          errorBox.style.display = 'none';
          renderRpcRows();
          renderPathRows();
          renderBindings();
        };

        btnSave.onclick = () => {
          const errors = [];

          if (!Array.isArray(draft.rpcConfigs) || draft.rpcConfigs.length === 0) {
            errors.push('至少保留 1 个 RPC 配置。');
          }
          if (!Array.isArray(draft.downloadPaths) || draft.downloadPaths.length === 0) {
            errors.push('至少保留 1 个下载路径。');
          }

          draft.rpcConfigs.forEach((rpc, idx) => {
            const endpointText = String(rpc._serverEndpoint || composeServerEndpoint(rpc.domain, rpc.port)).trim();
            const endpoint = splitServerEndpoint(endpointText);
            if (!endpoint) {
              errors.push(`RPC #${idx + 1} 服务器地址格式错误，示例: http://127.0.0.1:6800`);
              return;
            }
            rpc.domain = endpoint.domain;
            rpc.port = endpoint.port;

            if (!normalizePath(rpc.path).startsWith('/')) {
              errors.push(`RPC #${idx + 1} JSON-RPC 路径需以 / 开头。`);
            }

            const binding = ensureDraftBinding(draft, rpc.id);
            if (!Array.isArray(binding.pathIds) || binding.pathIds.length === 0) {
              errors.push(`RPC #${idx + 1} 至少需要绑定 1 个下载路径。`);
            }
            if (!binding.pathIds.includes(binding.defaultPathId)) {
              errors.push(`RPC #${idx + 1} 默认路径必须在绑定路径中。`);
            }
          });

          const pathSet = new Set();
          draft.downloadPaths.forEach((item, idx) => {
            item.path = normalizePath(item.path);
            if (!item.path) {
              errors.push(`路径 #${idx + 1} 不能为空。`);
              return;
            }
            if (pathSet.has(item.path)) {
              errors.push(`路径 #${idx + 1} 与其他路径重复。`);
              return;
            }
            pathSet.add(item.path);
          });

          if (errors.length > 0) {
            errorBox.innerHTML = errors.map((x) => `<div>${x}</div>`).join('');
            errorBox.style.display = 'block';
            return;
          }

          const normalized = sanitizeSettings(draft);
          settings = normalized;
          saveSettings(settings);
          syncUIState();
          WebDAV.push();
          closeModal();
        };

        renderRpcRows();
        renderPathRows();
        renderBindings();
        switchTab(ON_115_AUX ? 'general' : 'rpc');
        document.body.appendChild(overlay);
      }

      selectServer.onchange = function() {
        if (this.value === '') return;
        const rpc = settings.rpcConfigs[Number(this.value)];
        if (!rpc) return;
        setActive(rpc, defaultDirFor(rpc));
        syncUIState();
        WebDAV.push();
        console.log('[夸克懒得点][RPC] 已切换服务器:', rpc.name || rpc.domain, defaultDirFor(rpc));
      };

      selectPath.onchange = function() {
        const path = this.value;
        if (!path) return;
        const active = resolveActive();
        if (!active.rpc) return;
        setActive(active.rpc, path);
        syncUIState();
        WebDAV.push();
        console.log('[夸克懒得点][RPC] 已切换路径:', path);
      };

      btnSend.onclick = () => runFreshSend(pageAdapter);
      btnCopyCommand.onclick = () => copySelectedLinks(pageAdapter);
      btnSettings.onclick = openSettingsModal;
      openSettingsRef = openSettingsModal;
      retryFailuresRef = retryFailures;
      advancedRetryRef = openAdvancedRetry;
      canRefetchRef = canRefetch;
      refreshRetryButton();
      reloadSettingsRef = () => {
        settings = loadSettings();
        syncUIState();
      };

      let legacyWarned = false;

      function mountUI() {
        // 旧版 RPC切换 仍启用时不重复挂载，提示用户停用旧脚本
        if (document.getElementById(LEGACY_CONTAINER_ID) && !window.__qkRpcForceMount) {
          if (container.isConnected) container.remove();
          if (!legacyWarned) {
            legacyWarned = true;
            notifyToast('⚠️ 旧版「RPC切换」仍在启用，已由夸克懒得点接管，请在 Tampermonkey 中停用旧脚本', 'warning', 6000);
          }
          return;
        }
        if (ON_115) {
          // The native toolbar is replaced during selection; keep RPC in its
          // stable parent rather than depending on a transient 更多 button.
          // The rename script inserts its entry beside 上传 in that toolbar.
          const upload = [...document.querySelectorAll('button')].find((button) =>
            button.textContent.trim() === '上传' && button.closest('.sticky.top-0 > .relative'));
          const header = upload?.closest('.sticky.top-0 > .relative') ||
            [...document.querySelectorAll('.sticky.top-0 > .relative')].find((node) =>
              node.querySelector('.drive-rename-root, .file-list-wrap')) ||
            document.querySelector('.sticky.top-0 > .relative');
          const host = header?.parentElement;
          if (!host) return;
          let row = host.querySelector(':scope > .qk-rpc-115-row');
          if (!row) {
            row = document.querySelector('.qk-rpc-115-row') || document.createElement('div');
            row.className = 'qk-rpc-115-row';
          }
          if (row.previousElementSibling !== header) host.insertBefore(row, header.nextSibling);
          if (container.parentNode !== row) row.appendChild(container);
          syncUIState();
          return;
        }
        if (ON_QUARK) {
          const toolbar = document.querySelector('.btn-operate');
          const main = toolbar?.querySelector('.btn-main');
          if (!toolbar || !main) return;
          let quarkRow = toolbar.querySelector(':scope > .qk-rpc-quark-row');
          if (!quarkRow) {
            quarkRow = document.createElement('div');
            quarkRow.className = 'qk-rpc-quark-row';
          }
          if (quarkRow.previousElementSibling !== main) main.insertAdjacentElement('afterend', quarkRow);
          if (container.parentElement !== quarkRow) quarkRow.appendChild(container);
          const manualLoad = document.querySelector('[data-qk-load-all-button]') || document.createElement('button');
          manualLoad.type = 'button';
          manualLoad.dataset.qkLoadAllButton = '1';
          manualLoad.className = 'rpc-helper-btn qk-rpc-load-all';
          const loadAllLabel = () => (isListLoadAllActive() ? '还原分页加载' : '加载全部文件');
          if (!manualLoad.disabled && manualLoad.textContent !== loadAllLabel()) manualLoad.textContent = loadAllLabel();
          manualLoad.title = isListLoadAllActive() ? '恢复夸克默认的每页 50 个、滚动加载' : '手动加载当前目录全部文件（每批最多 2000 个），不会在进入页面时自动执行';
          if (!manualLoad.onclick) manualLoad.onclick = async () => {
            if (Runtime.listLoadAllRunning || !shouldHandleListPage()) return;
            const restoring = isListLoadAllActive();
            manualLoad.disabled = true;
            manualLoad.textContent = restoring ? '还原中…' : '加载中…';
            try {
              const ok = restoring ? await restoreListPaging() : await ensureListLoadAll();
              notifyToast(ok ? (restoring ? '已还原为分页加载' : '已加载当前目录全部文件') : '操作失败，请检查当前是否为「全部文件」目录', ok ? 'success' : 'warning');
            } finally {
              manualLoad.disabled = false;
              manualLoad.textContent = loadAllLabel();
            }
          };
          if (manualLoad.parentElement !== quarkRow) quarkRow.appendChild(manualLoad);
          manualLoad.hidden = !shouldHandleListPage() || !featureEnabled('quarkLoadAllButton');
          syncUIState();
          updateQuarkSelectionCount();
          return;
        }
        if (ON_GUANGYA) {
          const list = document.querySelector('.swangpan-file-list__root');
          const host = list && list.parentElement;
          if (!host) return;
          let row = host.querySelector(':scope > .qk-rpc-guangya-row');
          if (!row) {
            row = document.querySelector('.qk-rpc-guangya-row') || document.createElement('div');
            row.className = 'qk-rpc-guangya-row';
          }
          if (row.nextElementSibling !== list) host.insertBefore(row, list);
          if (container.parentNode !== row) row.appendChild(container);
          // 分享页只能先转存：隐藏发送按钮，保留设置入口（名单/日志）。
          const shareView = guangyaIsShareView();
          if (btnSend.hidden !== shareView) btnSend.hidden = shareView;
          if (btnCopyCommand.hidden !== shareView) btnCopyCommand.hidden = shareView;
          syncUIState();
          return;
        }
        let targetParent = null;
        let insertBeforeNode = null;
        if (ON_UC) {
          targetParent = document.querySelector('.btn-operate .btn-main, .file-info-share-buttom, .btn-operate');
        } else if (ON_TCLOUD) {
            targetParent = document.querySelector('[class*="FileHead_file-head-left"]');
          } else if (ON_XUNLEI) {
            targetParent = document.querySelector('[class*="FileMenu__menus--"], [class*="FileMenu__menu--"]');
          } else if (ON_MCLOUD) {
            targetParent = document.querySelector('.top_button, .top-btns');
          } else if (ON_123PAN) {
            targetParent = document.querySelector('.home-operator .home-operator-button-group, .content .content-header-container-wrap .rightInfo, .single-file-sharing-container-content-file-operate');
          } else if (ON_BAIDU) {
            targetParent = document.querySelector('.wp-s-agile-tool-bar__header');
          } else {
            targetParent =
              document.querySelector('.section-main') ||
              document.querySelector('.file-operate') ||
              document.querySelector('.list-header-operate') ||
              document.querySelector('.action-bar');
          }
          if (targetParent) insertBeforeNode = targetParent.firstChild;

        if (!targetParent) return;

        if (!targetParent.contains(container)) {
          if (insertBeforeNode) targetParent.insertBefore(container, insertBeforeNode);
          else targetParent.appendChild(container);
        }

        syncUIState();
        updateQuarkSelectionCount();
      }

      mountUI();
      scheduleAutoSelect();
      if (ON_QUARK || ON_UC) document.addEventListener('click', (event) => {
        if (event.target.closest('.file-list')) window.setTimeout(updateQuarkSelectionCount, 0);
      }, true);

      let mountTimer = 0;
      const observer = new MutationObserver((mutations) => {
        // 忽略本模块自己引起的变动
        if (mutations.every((m) => container.contains(m.target))) return;
        clearTimeout(mountTimer);
        mountTimer = window.setTimeout(() => {
          mountUI();
          scheduleAutoSelect();
        }, 120);
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }

    return {
      start() {
        if (started) return;
        waitForDocumentAndInit();
      },
      openSettings() {
        if (openSettingsRef) {
          openSettingsRef();
          return;
        }
        notifyToast('RPC 模块尚未就绪，请稍后重试', 'warning');
      },
      reloadSettings() {
        if (reloadSettingsRef) reloadSettingsRef();
      },
      retryFailures(ids, options) {
        if (ids === null) return Boolean(retryFailuresRef);
        return retryFailuresRef ? retryFailuresRef(ids, options) : Promise.resolve();
      },
      openAdvancedRetry(ids, onDone) {
        if (advancedRetryRef) advancedRetryRef(ids, onDone);
      },
      canRefetch(entry) {
        return canRefetchRef ? canRefetchRef(entry) : false;
      }
    };
  })();

  function init() {
    if (Runtime.initialized) return;
    Runtime.initialized = true;

    bindRouteWatcher();
    installQuarkShareSaveLogger();
    window.addEventListener('keydown', handleDeleteKey, true);
    installToolbarEnhance();

    scheduleHandle('init');
    window.addEventListener('load', function () {
      scheduleHandle('window-load');
    }, { once: true });
  }

  // 115 enhancement: act only on the native toolbar; do not move other scripts' DOM.
  function install115DeleteFirst() {
    if (SITE_HOST !== '115.com' || !location.pathname.startsWith('/storage/allfiles')) return;
    let pending = 0;
    const scan = () => {
      if (!featureEnabled('115DeleteFirst')) {
        document.querySelectorAll('[data-qk-115-delete-proxy]').forEach((el) => el.remove());
        return;
      }
      document.querySelectorAll('div.flex.items-center.bg-white.overflow-hidden').forEach((toolbar) => {
        const buttons = [...toolbar.querySelectorAll('button')];
        const label = (el) => (el.textContent || '').replace(/\s+/g, '').trim();
        if (!['下载', '移动', '复制', '更多'].every((text) => buttons.some((b) => label(b) === text))) return;
        const native = buttons.find((b) => label(b) === '删除');
        if (native) {
          const wrapper = native.closest('.relative.flex.items-center') || native;
          // The native button may be hidden in an overflow menu: never reparent it.
          if (wrapper.parentElement === toolbar) wrapper.style.order = '-100';
          return;
        }
        if (toolbar.querySelector('[data-qk-115-delete-proxy]')) return;
        const proxy = document.createElement('button');
        proxy.type = 'button'; proxy.dataset.qk115DeleteProxy = '1';
        proxy.textContent = '删除';
        proxy.style.cssText = 'order:-100;padding:5px 12px;color:#2777f8;border:0;background:transparent;cursor:pointer;white-space:nowrap';
        proxy.onclick = (event) => {
          event.preventDefault(); event.stopPropagation();
          const more = buttons.find((b) => label(b) === '更多');
          more?.click();
          let attempts = 0;
          const clickMenu = () => {
            const item = [...document.querySelectorAll('[role="menuitem"], .ant-dropdown button, .ant-dropdown li, [data-radix-popper-content-wrapper] button')]
              .find((el) => label(el) === '删除' && !el.closest('#qk-rpc-container'));
            if (item) item.click();
            else if (++attempts < 12) setTimeout(clickMenu, 70);
            else notifyToast('未找到 115 删除菜单，请使用原生更多菜单', 'warning');
          };
          setTimeout(clickMenu, 70);
        };
        toolbar.appendChild(proxy);
      });
    };
    const start = () => {
      if (!document.body) return setTimeout(start, 100);
      scan();
      new MutationObserver(() => { clearTimeout(pending); pending = setTimeout(scan, 150); })
        .observe(document.body, { childList:true, subtree:true });
    };
    start();
  }

  // Hide only named native 115 operations; never hide controls owned by this script or other extensions.
  function install115OperationHider() {
    if (SITE_HOST !== '115.com' || !location.pathname.startsWith('/storage/allfiles')) return;
    const hiddenLabels = new Set(['复制', '置顶', '星标', '标签', '加密隐藏', '导出目录树']);
    let timer = 0;
    const scan = () => {
      const enabled = featureEnabled('115HideOperations');
      document.querySelectorAll('[data-qk115-hidden-operation]').forEach((node) => {
        if (!enabled) { node.style.removeProperty('display'); delete node.dataset.qk115HiddenOperation; }
      });
      if (!enabled) return;
      const toolbars = [...document.querySelectorAll('div.flex.items-center.bg-white.overflow-hidden')]
        .filter((bar) => ['下载', '移动', '更多'].every((name) => [...bar.querySelectorAll('button')].some((button) => button.textContent.trim() === name)));
      toolbars.forEach((bar) => {
        [...bar.querySelectorAll('button')].forEach((button) => {
          if (!hiddenLabels.has((button.textContent || '').trim())) return;
          const wrapper = button.closest('.relative.flex.items-center') || button;
          if (wrapper.parentElement !== bar) return;
          wrapper.dataset.qk115HiddenOperation = '1';
          wrapper.style.display = 'none';
        });
      });
      document.querySelectorAll('[role="menuitem"], [role="menu"] button, .ant-dropdown li, [data-radix-popper-content-wrapper] button').forEach((item) => {
        if (!hiddenLabels.has((item.textContent || '').trim())) return;
        if (item.closest('#qk-rpc-container, #qk-rpc-settings-modal')) return;
        const wrapper = item.closest('[role="menuitem"], li') || item;
        wrapper.dataset.qk115HiddenOperation = '1';
        wrapper.style.display = 'none';
      });
    };
    const start = () => {
      if (!document.body) return setTimeout(start, 100);
      scan();
      new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(scan, 150); })
        .observe(document.body, { childList: true, subtree: true });
    };
    start();
  }

  install115OperationHider();
  // 115 新版把 F5 绑定为「刷新文件列表」并 preventDefault，导致浏览器 F5 无法整页刷新。
  // 在捕获阶段最先拦下 F5，阻止 115 处理，让浏览器执行原生刷新（Ctrl+F5 / Shift+F5 同理）。
  (function install115NativeF5() {
    if (SITE_HOST !== '115.com' || !featureEnabled('115NativeF5')) return;
    window.addEventListener('keydown', (event) => {
      if (event.key !== 'F5' && event.keyCode !== 116) return;
      event.stopImmediatePropagation();
    }, true);
  })();
  // 影巢/RE0 一键转存（参考 115Aria）：点击后打开资源页 → 自动积分解锁 → 取得 115 分享链接 → 用 115 登录态转存。
  // 解锁成功后站点会把窗口直接跳到 115 分享页，所以结果经脚本存储（跨域共享）回传，而不是 postMessage。
  const HDHIVE_AUTO_PARAM = 'qk115auto';
  const HDHIVE_JOBS_KEY = 'qk115_hdhive_jobs_v1';
  const HDHIVE_WINDOW_PREFIX = 'qk115-';
  const HDHIVE_WAIT_MS = 45000;
  function isHdhiveHost() {
    const host = SITE_HOST.toLowerCase();
    return ['re0.me'].some((domain) => host === domain || host.endsWith('.' + domain));
  }
  function getHdhiveJobs() {
    const jobs = GM_getValue(HDHIVE_JOBS_KEY, {});
    const now = Date.now();
    const live = {};
    Object.entries(jobs && typeof jobs === 'object' ? jobs : {}).forEach(([key, job]) => {
      if (job && now - (job.time || 0) < 10 * 60 * 1000) live[key] = job;
    });
    return live;
  }
  function updateHdhiveJob(token, patch) {
    const jobs = getHdhiveJobs();
    jobs[token] = { ...(jobs[token] || { time: Date.now() }), ...patch };
    GM_setValue(HDHIVE_JOBS_KEY, jobs);
  }
  function removeHdhiveJob(token) {
    const jobs = getHdhiveJobs();
    delete jobs[token];
    GM_setValue(HDHIVE_JOBS_KEY, jobs);
  }
  function parse115Share(text) {
    const raw = String(text || '').replace(/&amp;/g, '&').replace(/\\\//g, '/');
    const re = /https?:\/\/(?:[^/\s"'<>]+\.)?(?:115cdn\.com|115\.com|anxia\.com)\/s\/([A-Za-z0-9]+)[^\s"'<>]*/gi;
    let match;
    while ((match = re.exec(raw))) {
      const tail = raw.slice(match.index, match.index + match[0].length + 60);
      const code = (tail.match(/[?&#](?:password|pwd|pass)=([A-Za-z0-9]{4})/i) || tail.match(/(?:提取码|访问码|密码|口令)\s*[:：=]?\s*([A-Za-z0-9]{4})/) || [])[1];
      if (code) return { share: match[1], code, url: `https://115cdn.com/s/${match[1]}?password=${code}` };
    }
    return null;
  }
  function find115ShareIn(scope) {
    if (!scope) return null;
    for (const a of scope.querySelectorAll('a[href*="/s/"]')) {
      const parsed = parse115Share(a.href);
      if (parsed) return parsed;
    }
    const values = [...scope.querySelectorAll('input, textarea')].map((x) => x.value || '').join('\n');
    return parse115Share(`${values}\n${scope.textContent || ''}`);
  }
  // Next.js 先输出服务端渲染的按钮，React 水合后才挂上点击处理；水合前点击会被丢弃，所以默认只点已水合的按钮。
  function hdhiveUnlockButton(doc, allowUnhydrated) {
    return [...doc.querySelectorAll('button')].find((button) => {
      if (button.disabled || button.hasAttribute('data-pending') || button.closest('[data-qk115-hdhive-button], [data-qk115-detail-transfer]')) return false;
      const label = (button.textContent || '').replace(/\s+/g, '');
      if (!/(确认解锁|确定解锁|立即解锁|^解锁)/.test(label) || /取消/.test(label)) return false;
      const propsKey = Object.keys(button).find((k) => k.startsWith('__reactProps$'));
      if (!propsKey) return Boolean(allowUnhydrated);
      const props = button[propsKey] || {};
      return typeof props.onClick === 'function' || typeof props.onPress === 'function';
    }) || null;
  }
  function hdhiveDialogConfirm(doc) {
    return [...doc.querySelectorAll('[role="dialog"] button, [role="alertdialog"] button, .modal button')].find((button) => {
      const label = (button.textContent || '').replace(/\s+/g, '');
      return !button.disabled && /^(确定|确认|确认解锁|确定解锁|继续|继续解锁)$/.test(label);
    }) || null;
  }
  // 自动点击解锁：等 React 就绪后点击，未生效每 2.5 秒重试（最多 4 次），并处理可能出现的二次确认框。
  function makeHdhiveUnlocker(onStep) {
    const start = Date.now();
    let clicks = 0;
    let lastClick = 0;
    let dialogClicked = false;
    return () => {
      const dialogButton = !dialogClicked && hdhiveDialogConfirm(document);
      if (dialogButton) { dialogClicked = true; dialogButton.click(); return; }
      if (clicks >= 4 || Date.now() - lastClick < 2500) return;
      const unlock = hdhiveUnlockButton(document, Date.now() - start > 8000);
      if (!unlock) return;
      clicks++;
      lastClick = Date.now();
      if (onStep) onStep(clicks === 1 ? '正在自动解锁…' : `正在重试解锁（${clicks}）…`);
      unlock.click();
    };
  }
  // options.cid：返回到指定目录；sameWindow：原窗口跳转；persistent：不自动消失。
  function showHdhiveReturnButton(options) {
    const opts = options || {};
    const cid = /^\d+$/.test(String(opts.cid || '')) ? String(opts.cid) : '0';
    const target = `https://115.com/?cid=${cid}&offset=0&mode=wangpan`;
    document.querySelectorAll('[data-qk115-return]').forEach((node) => node.remove());
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.qk115Return = '1';
    button.textContent = '返回115';
    button.title = cid === '0' ? '打开 115 网盘根目录（转存位置）' : '打开 115 网盘 /ovo（转存位置）';
    button.style.cssText = 'position:fixed;right:24px;bottom:24px;z-index:999999;padding:12px 22px;border:0;border-radius:24px;background:#b45309;color:#fff;font-size:15px;font-weight:700;cursor:pointer;box-shadow:0 6px 18px rgba(0,0,0,.28);';
    button.onclick = () => {
      if (opts.sameWindow) { location.href = target; return; }
      window.open(target, '_blank');
      button.remove();
    };
    document.body.appendChild(button);
    if (!opts.persistent) setTimeout(() => button.remove(), 30000);
  }
  function gm115Json(method, url, body) {
    return new Promise((resolve, reject) => GM_xmlhttpRequest({
      method, url, timeout: 20000, anonymous: false,
      headers: body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {},
      data: body ? body.toString() : undefined,
      onload(res) {
        try {
          if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}`);
          resolve(JSON.parse(res.responseText));
        } catch (error) { reject(error); }
      },
      onerror: () => reject(new Error('115 接口连接失败')),
      ontimeout: () => reject(new Error('115 接口超时'))
    }));
  }
  function get115ShareCode(url) {
    try {
      const parsed = new URL(url);
      if (!['115.com', '115cdn.com', 'anxia.com'].some((domain) => parsed.hostname === domain || parsed.hostname.endsWith('.' + domain))) return '';
      return (parsed.pathname.match(/^\/s\/([A-Za-z0-9]+)(?:\/|$)/) || [])[1] || '';
    } catch (error) { return ''; }
  }
  function find115SavedShareLog(share) {
    if (!share) return null;
    return getLogs().find((entry) => getLogKind(entry) === 'save' && getEntrySite(entry) === '115.com' && get115ShareCode(entry.url) === share) || null;
  }
  function has115SavedShare(share) {
    return Boolean(find115SavedShareLog(share));
  }
  async function find115OvoFolder() {
    let offset = 0;
    for (let page = 0; page < 20; page++) {
      const result = await gm115Json('GET', `https://webapi.115.com/files?aid=1&cid=0&show_dir=1&limit=1000&offset=${offset}&format=json`);
      if (result?.state !== true || !Array.isArray(result.data)) throw new Error('无法读取 115 根目录，自动转存已停止');
      const folder = result.data.find((item) => item && item.n === 'ovo' && !item.fid && /^\d+$/.test(String(item.cid || '')));
      if (folder) return String(folder.cid);
      offset += result.data.length;
      const total = Number(result.count);
      if (!result.data.length || !Number.isFinite(total) || offset >= total) return '';
    }
    throw new Error('未能完整读取 115 根目录，无法确认 /ovo 是否存在');
  }
  // 根目录完整读取后仍没有 /ovo 才创建；创建时若已被别处建好，则重新读取。
  async function resolve115OvoFolder() {
    const found = await find115OvoFolder();
    if (found) return found;
    const created = await gm115Json('POST', 'https://webapi.115.com/files/add', new URLSearchParams({ pid: '0', cname: 'ovo' }));
    const cid = String(created?.cid || created?.file_id || created?.data?.cid || created?.data?.file_id || '');
    if (created?.state === true && /^\d+$/.test(cid)) return cid;
    const again = await find115OvoFolder().catch(() => '');
    if (again) return again;
    throw new Error(`创建 115 /ovo 文件夹失败：${created?.error || created?.msg || created?.errno || '未返回目录 ID'}`);
  }
  const pending115Transfers = new Set();
  async function transfer115Share(parsed, options) {
    if (pending115Transfers.has(parsed.share)) throw new Error('该 115 分享正在转存，请稍候');
    pending115Transfers.add(parsed.share);
    try {
      return await transfer115ShareOnce(parsed, options);
    } finally {
      pending115Transfers.delete(parsed.share);
    }
  }
  async function transfer115ShareOnce(parsed, options) {
    const params = new URLSearchParams({ share_code: parsed.share, receive_code: parsed.code, offset: '0', limit: '5000', cid: '' });
    const snap = await gm115Json('GET', `https://webapi.115.com/share/snap?${params}`);
    if (snap && snap.state === false) throw new Error(snap.error || snap.msg || `分享不可用（${snap.errno || ''}）`);
    const sharer = snap?.data?.userinfo || {};
    show115ShareIdentity(sharer);
    const decision = applyShareSourceFilter({ site: '115.com', name: sharer.user_name, id: sharer.user_id });
    if (decision === 'blocked') throw new Error('115 分享者在红名单中，已阻止一键转存');
    if (decision === 'unknown' && shareFilterEnabled('115.com')) throw new Error('无法核实 115 分享者账号 ID，已阻止自动转存；可关闭 115 分享来源过滤后重试');
    const list = snap?.data?.list || [];
    const ids = [...new Set(list.map((item) => String(item.p) === '0' || (!item.fid && item.cid) ? item.cid : (item.fid || item.file_id || item.cid)).filter(Boolean))].join(',');
    const destinationCid = options?.ovo ? await resolve115OvoFolder() : (options?.destinationCid || '0');
    if (!/^\d+$/.test(String(destinationCid))) throw new Error('115 转存目录 ID 无效');
    const receive = (extra) => gm115Json('POST', 'https://webapi.115.com/share/receive',
      new URLSearchParams({ share_code: parsed.share, receive_code: parsed.code, cid: String(destinationCid), ...(ids ? { file_id: ids } : {}), ...extra }));
    const result = await receive({});
    const errno = (x) => String(x && (x.errno || x.errNo || x.code || ''));
    const title = snap?.data?.shareinfo?.share_title || list[0]?.n || parsed.share;
    const user = snap?.data?.userinfo || {};
    if (result?.state !== true && errno(result) === '4100024') return { already: true, title, user, cid: String(destinationCid) };
    if (result?.state !== true) throw new Error(result?.error || result?.message || result?.msg || `转存失败（${errno(result) || '未知'}）`);
    return { already: false, title, user, cid: String(destinationCid) };
  }
  async function doHdhiveTransfer(parsed, sourceUrl, options) {
    const result = await transfer115Share(parsed, options);
    record115SaveLog({ share: parsed.share, code: parsed.code, title: result.title, user: result.user, already: result.already, from: sourceUrl || location.href });
    const into = options?.ovo || options?.destinationCid ? '/ovo' : '根目录';
    notifyToast(result.already ? '115：该分享已经转存过' : `✅ 已转存到 115 ${into}：${result.title}`, 'success', 5000);
    return result;
  }

  const shareFilterKeys = {
    '115.com': '115ShareSharerFilter', 'drive.uc.cn': 'ucShareSharerFilter',
    'pan.baidu.com': 'baiduShareSharerFilter', 'yun.139.com': 'mcloudShareSharerFilter',
    'cloud.189.cn': 'tcloudShareSharerFilter', 'pan.xunlei.com': 'xunleiShareSharerFilter',
    'yun.123pan.cn': '123panShareSharerFilter', 'www.guangyapan.com': 'guangyaShareSharerFilter'
  };
  const shareFilterEnabled = (site = SITE_HOST) => featureEnabled(shareFilterKeys[site] || 'shareSharerFilter');
  const is115SharerId = (value) => /^\d+$/.test(String(value || '').trim());
  // 当前分享页的可见操作入口；账号 ID 不存在时不生成可能误判的名单项。
  function showShareSourceControls(user) {
    if (!user || !user.hash || !shareFilterEnabled(user.site)) return;
    // 115 分享页不再显示右下角名单入口；115 名单在日志中心的保存记录里加入。
    if (user.site === '115.com') return;
    if (!document.body) {
      document.addEventListener('DOMContentLoaded', () => showShareSourceControls(user), { once: true });
      return;
    }
    let box = document.getElementById('qk-share-source-controls');
    if (!box) {
      box = document.createElement('div');
      box.id = 'qk-share-source-controls';
      box.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:999998;background:#fff;color:#333;border:1px solid #ddd;border-radius:10px;padding:8px 10px;box-shadow:0 4px 15px rgba(0,0,0,.25);font:13px sans-serif;display:flex;align-items:center;gap:8px;';
      document.body.appendChild(box);
    }
    const key = `${user.site}|${user.hash}|${user.name}`;
    if (box.dataset.sharer === key) return;
    box.dataset.sharer = key;
    box.replaceChildren();
    const label = document.createElement('span');
    label.textContent = `${siteLabel(user.site)}分享者：${user.name}${user.site === '115.com' ? `（ID: ${user.sharerId}）` : ''}`;
    const action = (text, mode) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = text;
      button.style.cssText = 'cursor:pointer;padding:4px 8px;border:1px solid #bbb;border-radius:5px;background:#fff;color:#333;';
      button.onclick = () => {
        const same = (u) => getEntrySite(u) === user.site && u.hash === user.hash &&
          (user.site !== '115.com' || u.sharerId === user.sharerId);
        if (mode === 'blocked') {
          setBlockedList([...getBlockedList().filter((u) => !same(u)), user]);
          setWarningList(getWarningList().filter((u) => !same(u)));
          showBlockedOverlay(user);
        } else {
          setWarningList([...getWarningList().filter((u) => !same(u)), user]);
          setBlockedList(getBlockedList().filter((u) => !same(u)));
          showWarningToast(user);
        }
        WebDAV.push();
      };
      return button;
    };
    box.append(label, action('加入红名单', 'blocked'), action('加入橙名单', 'warning'));
  }

  // 各网盘按站点分别匹配分享者；仅有昵称而没有稳定账号 ID 时不猜测身份。
  const shareFilterShown = new Set();
  function applyShareSourceFilter({ site = SITE_HOST, name, id }) {
    if (!shareFilterEnabled(site)) return 'disabled';
    const nick = String(name || '').trim();
    const uid = String(id || '').trim();
    if (!uid || (site === '115.com' ? !is115SharerId(uid) : (!nick || uid.includes('*')))) return 'unknown';
    const prefix = site === '115.com' ? '115' : site === 'pan.baidu.com' ? 'baidu' : site;
    const hash = computeStringHash(`${prefix}:${uid}`);
    const matches = (entry) => getEntrySite(entry) === site && (site === '115.com'
      ? entry.sharerId === uid && entry.hash === hash
      : entry.hash === hash);
    const user = { site, name: nick || `115 用户 ${uid}`, hash, ...(site === '115.com' ? { sharerId: uid } : {}) };
    showShareSourceControls(user);
    const marker = `${location.href}|${site}|${uid}`;
    if (getBlockedList().some(matches)) {
      if (!shareFilterShown.has(marker)) {
        shareFilterShown.add(marker);
        showBlockedOverlay(user);
      }
      return 'blocked';
    }
    if (getWarningList().some(matches)) {
      if (!shareFilterShown.has(marker)) {
        shareFilterShown.add(marker);
        showWarningToast(user);
      }
      return 'warning';
    }
    shareFilterShown.delete(marker);
    return 'allow';
  }

  // 115 用户昵称可能脱敏，先明确展示账号 ID，不能把昵称当身份。
  function show115ShareIdentity(userInfo) {
    const id = is115SharerId(userInfo?.user_id) ? String(userInfo.user_id) : '';
    if (!id || !shareFilterEnabled('115.com')) return;
    const name = String(userInfo.user_name || `115 用户 ${id}`);
    showShareSourceControls({ site: '115.com', name, hash: computeStringHash(`115:${id}`), sharerId: id });
  }
  // 115 保存记录：统一写入日志中心「保存记录」，网盘类型为 115。
  function record115SaveLog({ share, code, title, user, already, from }) {
    const shareUrl = `https://115cdn.com/s/${share}${code ? `?password=${code}` : ''}`;
    const userId = user && (user.user_id || user.userid || user.uid);
    const validUserId = is115SharerId(userId);
    recordShareSaveLog({
      site: '115.com', url: shareUrl, title: `${already ? '已转存过：' : ''}${title || share}`,
      name: validUserId ? String(userId) : '',
      hash: validUserId ? computeStringHash(`115:${userId}`) : '',
      ...(validUserId ? { sharerId: String(userId) } : {}), from: from || ''
    });
  }
  // 百度分享者信息由页面数据异步注入；等待账号 ID 与昵称同时可用再匹配。
  function installBaiduShareSourceFilter() {
    if (SITE_HOST !== 'pan.baidu.com' || !/^\/(s\/|share\/)/.test(location.pathname)) return;
    const start = () => {
      if (!document.body) return setTimeout(start, 100);
      let tries = 0;
      const check = () => {
        if (!shareFilterEnabled()) return;
        const page = getPageWindow();
        const g = (key) => { try { return page.locals && typeof page.locals.get === 'function' ? page.locals.get(key) : undefined; } catch (error) { return undefined; } };
        const yun = page.yunData || {};
        const name = g('linkusername') || yun.linkusername || '';
        const id = g('share_uk') || yun.share_uk || yun.SHARE_UK || yun.uk || '';
        if (name && id) applyShareSourceFilter({ site: 'pan.baidu.com', name, id });
        else if (++tries < 50) setTimeout(check, 300);
      };
      check();
    };
    start();
  }
  // 百度分享页：监听原生「保存到网盘」接口 /share/transfer，成功后记入保存记录。
  function installBaiduShareSaveLogger() {
    if (SITE_HOST !== 'pan.baidu.com' || !/^\/(s\/|share\/)/.test(location.pathname)) return;
    const page = getPageWindow();
    if (page.__qkBaiduSaveLogger) return;
    page.__qkBaiduSaveLogger = true;
    const shareInfo = () => {
      const g = (key) => { try { return page.locals && typeof page.locals.get === 'function' ? page.locals.get(key) : undefined; } catch (error) { return undefined; } };
      const yun = page.yunData || {};
      const list = g('file_list') || yun.file_list || [];
      const first = Array.isArray(list) ? list[0] : (list && list.list && list.list[0]);
      const title = g('title') || yun.title || (first && first.server_filename) || document.title.replace(/[_\-|].*百度网盘.*$/, '').trim();
      const uk = g('share_uk') || yun.share_uk || yun.SHARE_UK || yun.uk || '';
      const name = g('linkusername') || yun.linkusername || '';
      return { title, uk, name };
    };
    const handle = (url, text) => {
      if (!/\/share\/transfer/.test(url || '')) return;
      let json;
      try { json = typeof text === 'string' ? JSON.parse(text) : text; } catch (error) { return; }
      if (!json || json.errno !== 0) return;
      const info = shareInfo();
      const pwd = (location.search.match(/[?&]pwd=([A-Za-z0-9]{4})/) || [])[1] || '';
      const shareUrl = location.origin + location.pathname + (pwd ? `?pwd=${pwd}` : '');
      const saved = (json.extra && json.extra.list) || json.info || [];
      const firstName = Array.isArray(saved) && saved[0] ? String(saved[0].to || saved[0].path || saved[0].from || '').split('/').pop() : '';
      recordShareSaveLog({
        site: 'pan.baidu.com', url: shareUrl, title: info.title || firstName || '百度分享',
        name: info.name || '', hash: info.uk ? computeStringHash(`baidu:${info.uk}`) : ''
      });
    };
    const rawFetch = page.fetch;
    if (typeof rawFetch === 'function') {
      page.fetch = function (input) {
        const url = typeof input === 'string' ? input : (input && input.url) || '';
        const promise = rawFetch.apply(this, arguments);
        if (/\/share\/transfer/.test(url)) Promise.resolve(promise).then((res) => res && res.clone && res.clone().text().then((t) => handle(url, t))).catch(() => {});
        return promise;
      };
    }
    const XHR = page.XMLHttpRequest;
    if (XHR && XHR.prototype) {
      const rawOpen = XHR.prototype.open;
      XHR.prototype.open = function (method, url) {
        const target = String(url || '');
        if (/\/share\/transfer/.test(target)) {
          this.addEventListener('load', () => {
            try { handle(target, this.responseType === 'json' ? this.response : this.responseText); } catch (error) { /* 忽略 */ }
          });
        }
        return rawOpen.apply(this, arguments);
      };
    }
  }

  // 天翼 / 迅雷 / 139 / 123 分享页：监听各自原生「转存/保存到网盘」接口，成功后写入保存记录。
  // 接口均取自各站前端代码：天翼 createBatchTask(SHARE_SAVE)+checkBatchTask，迅雷 share/restore，
  // 139 createOuterLinkBatchOprTask，123 restful/goapi/v1/file/copy/save。
  function deepFind(obj, keys, depth) {
    if (!obj || typeof obj !== 'object' || (depth || 0) > 6) return '';
    for (const key of keys) {
      const v = obj[key];
      if (typeof v === 'string' && v.trim()) return v.trim();
      if (typeof v === 'number') return String(v);
    }
    for (const v of Object.values(obj)) {
      if (v && typeof v === 'object') { const found = deepFind(v, keys, (depth || 0) + 1); if (found) return found; }
    }
    return '';
  }
  const SHARE_SAVE_SITES = [
    {
      site: 'cloud.189.cn', label: '天翼',
      page: () => SITE_HOST === 'cloud.189.cn' && /\/web\/share|\/t\//.test(location.pathname + location.search),
      info: /getShareInfoByCode|share\/getShareInfo|listShareDir/,
      titleKeys: ['fileName', 'shareName'], userKeys: ['nickName', 'ownerName', 'ownerAccount'], idKeys: ['ownerAccount', 'creatorId', 'userId'],
      // 创建任务成功只记下 taskId；轮询到 taskStatus=4（完成）才算保存成功。
      save(url, body, json, state) {
        const isSave = /SHARE_SAVE/.test(String(body || '') + url);
        if (/createBatchTask/.test(url) && isSave && Number(json.res_code) === 0 && json.taskId) { state.tasks.add(String(json.taskId)); return false; }
        if (/checkBatchTask/.test(url)) {
          const taskId = String(json.taskId || (String(body || '') + url).match(/taskId=([\w-]+)/)?.[1] || '');
          if (Number(json.taskStatus) === 4 && !json.errorCode && (state.tasks.has(taskId) || isSave)) { state.tasks.delete(taskId); return true; }
        }
        return false;
      }
    },
    {
      site: 'pan.xunlei.com', label: '迅雷',
      page: () => SITE_HOST === 'pan.xunlei.com' && /^\/s\//.test(location.pathname),
      info: /\/v1\/share(\?|$)/,
      titleKeys: ['title'], userKeys: ['nickname', 'nick_name', 'name'], idKeys: ['user_id', 'uid'],
      save: (url, body, json) => /\/v1\/share\/restore(\?|$)/.test(url) && /^RESTORE_(COMPLETE|START)$/.test(json.restore_status || '')
    },
    {
      site: 'yun.139.com', label: '139',
      page: () => SITE_HOST === 'yun.139.com' && /\/share(web|wap)/.test(location.pathname),
      info: /getOutLinkInfo|outlink\/info/,
      titleKeys: ['linkName', 'caName', 'coName', 'name'], userKeys: ['ownerNickName', 'nickName', 'ownerName', 'ownerAccount'], idKeys: ['ownerAccount', 'owner', 'userID'],
      save: (url, body, json) => /createOuterLinkBatchOprTask/.test(url) && (json.success === true || String(json.code) === '0' || String(json.resultCode) === '0')
    },
    {
      site: 'yun.123pan.cn', label: '123',
      page: () => SITE_HOST === 'yun.123pan.cn' && /^\/s\//.test(location.pathname),
      info: /\/share\/(get|info)|share\/detail/,
      titleKeys: ['ShareName', 'FileName'], userKeys: ['Nickname', 'NickName', 'UserNickName', 'CreatorNickName'], idKeys: ['UID', 'Uid', 'CreatorUid', 'UserId'],
      save: (url, body, json) => /\/file\/copy\/save(\?|$)/.test(url) && Number(json.code) === 0
    },
    {
      site: 'www.guangyapan.com', label: '光鸭',
      page: () => SITE_HOST === 'www.guangyapan.com' && /^\/s\//.test(location.pathname),
      info: /\/userres\/v1\/get_share_summary/,
      titleKeys: ['title'], userKeys: ['nickName'], idKeys: ['userId'],
      save(url, body, json, state) {
        const ok = !json.code || Number(json.code) === 0;
        if (/\/userres\/v1\/restore_share(\?|$)/.test(url)) {
          if (ok && json.data && json.data.taskId) state.tasks.add(String(json.data.taskId));
          return false;
        }
        if (!/\/userres\/v1\/get_task_status(\?|$)/.test(url) || !ok || !json.data || Number(json.data.status) !== 2) return false;
        let taskId = '';
        try { taskId = String(JSON.parse(body || '{}').taskId || ''); } catch (error) { taskId = ''; }
        if (!state.tasks.has(taskId)) return false;
        state.tasks.delete(taskId);
        return true;
      }
    }
  ];
  function installGenericShareSaveLogger() {
    const conf = SHARE_SAVE_SITES.find((c) => c.page());
    if (!conf) return;
    const page = getPageWindow();
    if (page.__qkShareSaveLogger) return;
    page.__qkShareSaveLogger = true;
    const state = { tasks: new Set(), title: '', user: '', uid: '' };
    const bodyText = (body) => {
      if (body == null) return '';
      if (typeof body === 'string') return body;
      try { if (page.URLSearchParams && body instanceof page.URLSearchParams) return body.toString(); } catch (error) { /* 忽略 */ }
      try { if (page.FormData && body instanceof page.FormData) return [...body.entries()].map(([k, v]) => `${k}=${v}`).join('&'); } catch (error) { /* 忽略 */ }
      return '';
    };
    const handle = (url, body, text) => {
      let json;
      try { json = typeof text === 'string' ? JSON.parse(text) : text; } catch (error) { return; }
      if (!json || typeof json !== 'object') return;
      if (conf.info.test(url)) {
        // 只接受成功的分享详情，避免错误页或其他接口数据误认成分享者。
        if (json.code !== undefined && Number(json.code) !== 0) return;
        if (json.res_code !== undefined && Number(json.res_code) !== 0) return;
        if (json.success === false) return;
        const user = deepFind(json, conf.userKeys);
        const uid = deepFind(json, conf.idKeys);
        if (user && uid) {
          state.user = user;
          state.uid = uid;
          applyShareSourceFilter({ site: conf.site, name: user, id: uid });
        }
        state.title = deepFind(json, conf.titleKeys) || state.title;
        return;
      }
      if (!conf.save(url, bodyText(body), json, state)) return;
      const title = state.title || document.title.replace(/\s*[-_|].*$/, '').trim() || `${conf.label}分享`;
      recordShareSaveLog({
        site: conf.site, url: location.href, title,
        name: state.user || '', hash: state.uid ? computeStringHash(`${conf.site}:${state.uid}`) : ''
      });
    };
    const watched = (url) => conf.info.test(url) || /createBatchTask|checkBatchTask|share\/restore|createOuterLinkBatchOprTask|file\/copy\/save|restore_share|get_task_status/.test(url);
    const rawFetch = page.fetch;
    if (typeof rawFetch === 'function') {
      page.fetch = function (input, init) {
        const url = typeof input === 'string' ? input : (input && input.url) || '';
        const promise = rawFetch.apply(this, arguments);
        if (watched(url)) Promise.resolve(promise).then((res) => res && res.clone && res.clone().text().then((t) => handle(url, init && init.body, t))).catch(() => {});
        return promise;
      };
    }
    const XHR = page.XMLHttpRequest;
    if (XHR && XHR.prototype) {
      const rawOpen = XHR.prototype.open;
      const rawSend = XHR.prototype.send;
      XHR.prototype.open = function (method, url) { this.__qkSaveUrl = String(url || ''); return rawOpen.apply(this, arguments); };
      XHR.prototype.send = function (body) {
        const url = this.__qkSaveUrl || '';
        if (watched(url)) {
          this.addEventListener('load', () => {
            try { handle(url, body, this.responseType === 'json' ? this.response : this.responseText); } catch (error) { /* 忽略 */ }
          });
        }
        return rawSend.apply(this, arguments);
      };
    }
  }

  // 在 115 页面监听原生转存接口（share/receive），成功后记入日志；同时缓存 share/snap 里的标题和分享者。
  function install115ShareSaveLogger() {
    const host = SITE_HOST.toLowerCase();
    if (!['115cdn.com', '115.com', 'anxia.com'].some((d) => host === d || host.endsWith('.' + d))) return;
    const page = getPageWindow();
    if (page.__qk115SaveLogger) return;
    page.__qk115SaveLogger = true;
    const shares = new Map();
    const shareOf = (url, body) => {
      const text = `${url || ''}&${typeof body === 'string' ? body : (body && typeof body.toString === 'function' && !(body instanceof page.FormData) ? body.toString() : '')}`;
      let code = (text.match(/[?&]share_code=([A-Za-z0-9]+)/) || [])[1];
      let receive = (text.match(/[?&]receive_code=([A-Za-z0-9]{4})/) || [])[1];
      if (body instanceof page.FormData) { code = code || body.get('share_code'); receive = receive || body.get('receive_code'); }
      const fromPage = parse115Share(location.href);
      return { share: code || fromPage?.share || '', code: receive || fromPage?.code || '' };
    };
    const handle = (url, body, text) => {
      if (!/\/share\/(snap|receive)/.test(url || '')) return;
      let json;
      try { json = typeof text === 'string' ? JSON.parse(text) : text; } catch (error) { return; }
      if (!json || typeof json !== 'object') return;
      const info = shareOf(url, body);
      if (!info.share) return;
      if (/\/share\/snap/.test(url)) {
        if (json.state !== true) return;
        const data = json.data || {};
        shares.set(info.share, { title: data.shareinfo?.share_title || data.list?.[0]?.n || '', user: data.userinfo || {} });
        if (data.userinfo) {
          show115ShareIdentity(data.userinfo);
          applyShareSourceFilter({ site: '115.com', name: data.userinfo.user_name, id: data.userinfo.user_id });
        }
        return;
      }
      if (json.state !== true) return;
      const meta = shares.get(info.share) || {};
      record115SaveLog({ share: info.share, code: info.code, title: meta.title || document.title.replace(/\s*-\s*115.*$/, ''), user: meta.user, already: false, from: location.href });
    };
    const rawFetch = page.fetch;
    if (typeof rawFetch === 'function') {
      page.fetch = function (input, init) {
        const url = typeof input === 'string' ? input : (input && input.url) || '';
        const promise = rawFetch.apply(this, arguments);
        if (/\/share\/(snap|receive)/.test(url)) {
          Promise.resolve(promise).then((res) => res && res.clone && res.clone().text().then((t) => handle(url, init && init.body, t))).catch(() => {});
        }
        return promise;
      };
    }
    const XHR = page.XMLHttpRequest;
    if (XHR && XHR.prototype) {
      const rawOpen = XHR.prototype.open;
      const rawSend = XHR.prototype.send;
      XHR.prototype.open = function (method, url) { this.__qk115Url = String(url || ''); return rawOpen.apply(this, arguments); };
      XHR.prototype.send = function (body) {
        if (/\/share\/(snap|receive)/.test(this.__qk115Url || '')) {
          this.addEventListener('load', () => {
            try { handle(this.__qk115Url, body, this.responseType === 'json' ? this.response : this.responseText); } catch (error) { /* 忽略 */ }
          });
        }
        return rawSend.apply(this, arguments);
      };
    }
  }

  // 115 分享页：若是一键转存窗口跳转过来的，回传链接并关闭；同页模式则直接在这里完成转存。
  function relay115ShareForHdhive() {
    if (!/^\/s\//.test(location.pathname)) return false;
    const host = SITE_HOST.toLowerCase();
    if (!['115cdn.com', '115.com', 'anxia.com'].some((d) => host === d || host.endsWith('.' + d))) return false;
    const parsed = parse115Share(location.href);
    if (!parsed) return false;
    const jobs = getHdhiveJobs();
    const name = String(window.name || '');
    let token = name.startsWith(HDHIVE_WINDOW_PREFIX) ? name.slice(HDHIVE_WINDOW_PREFIX.length) : '';
    if (!token || !jobs[token]) {
      token = Object.keys(jobs).filter((key) => jobs[key].status === 'pending' && jobs[key].mode === 'same-tab' && Date.now() - jobs[key].time < 60000)
        .sort((a, b) => jobs[b].time - jobs[a].time)[0] || '';
    }
    if (!token || !jobs[token] || jobs[token].status !== 'pending') return false;
    if (jobs[token].mode === 'popup') {
      updateHdhiveJob(token, { status: 'link', share: parsed.share, code: parsed.code });
      setTimeout(() => window.close(), 300);
      return true;
    }
    removeHdhiveJob(token);
    const run = () => {
      if (!document.body) return setTimeout(run, 100);
      notifyToast('一键转存：正在转存…', 'info', 3000);
      doHdhiveTransfer(parsed, jobs[token].source, { ovo: true })
        .then((result) => showHdhiveReturnButton({ cid: result.cid, sameWindow: true, persistent: true }))
        .catch((error) => notifyToast(`115 转存失败：${error.message}`, 'error', 7000));
    };
    run();
    return true;
  }

  // 一键转存打开的资源页：自动点击积分解锁；若页面直接显示链接也会抓取。
  function runHdhiveChild() {
    const params = new URLSearchParams(location.search);
    const token = params.get(HDHIVE_AUTO_PARAM);
    if (!token || !/^\/resource\/115\//.test(location.pathname)) return false;
    let finished = false;
    const finish = (patch) => {
      if (finished) return;
      finished = true;
      updateHdhiveJob(token, patch);
      setTimeout(() => window.close(), 500);
    };
    const offer = (text) => { const parsed = parse115Share(text); if (parsed) finish({ status: 'link', share: parsed.share, code: parsed.code }); };
    const page = getPageWindow();
    const rawFetch = page.fetch;
    if (typeof rawFetch === 'function') {
      page.fetch = function () {
        const promise = rawFetch.apply(this, arguments);
        promise.then((res) => res.clone().text().then(offer)).catch(() => {});
        return promise;
      };
    }
    let banner = null;
    const unlocker = makeHdhiveUnlocker((step) => {
      updateHdhiveJob(token, { step });
      if (!banner && document.body) {
        banner = document.createElement('div');
        banner.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:999999;padding:8px 12px;background:#b45309;color:#fff;font:600 13px sans-serif;text-align:center;';
        document.body.appendChild(banner);
      }
      if (banner) banner.textContent = `一键转存：${step}`;
    });
    const start = Date.now();
    const tick = () => {
      if (finished) return;
      if (Date.now() - start > HDHIVE_WAIT_MS) return finish({ status: 'error', error: '解锁或获取 115 链接超时' });
      if (document.body) {
        const parsed = find115ShareIn(document.body);
        if (parsed) return finish({ status: 'link', share: parsed.share, code: parsed.code });
        const failure = (document.body.innerText || '').match(/积分不足|余额不足|请先登录|请登录后|解锁失败/);
        if (failure) return finish({ status: 'error', error: failure[0] });
        unlocker();
      }
      setTimeout(tick, 300);
    };
    tick();
    return true;
  }

  function install115HdhiveTransfer() {
    if (!isHdhiveHost()) return;
    if (runHdhiveChild()) return;
    let pending = 0;
    function getRe0ResourceSlug(card) {
      if (card.href) {
        const url = new URL(card.href, location.href);
        if (url.origin === location.origin) {
          const hit = url.pathname.match(/^\/resource\/115\/([a-f0-9]{32})$/i);
          if (hit) return hit[1];
        }
      }
      const key = Object.keys(card).find((k) => k.startsWith('__reactFiber$'));
      let fiber = key && card[key];
      for (let i = 0; fiber && i < 15; i++, fiber = fiber.return) {
        const data = fiber.memoizedProps?.data;
        if (data?.website === '115' && /^[a-f0-9]{32}$/i.test(data.slug || '')) return data.slug;
      }
      return '';
    }
    function setBusy(button, text) {
      button.disabled = Boolean(text);
      button.textContent = text || '一键转存';
    }
    async function finishTransfer(parsed, button, sourceUrl) {
      setBusy(button, '转存中…');
      // 允许重复保存：曾保存过只提示，照常再转存一次。
      if (has115SavedShare(parsed.share)) {
        const saved = find115SavedShareLog(parsed.share);
        notifyToast(`🔁 该 115 分享曾保存过${saved?.time ? `（${saved.time}）` : ''}，正在再次转存`, 'info', 4000);
      }
      try {
        const result = await doHdhiveTransfer(parsed, sourceUrl, { ovo: true });
        setBusy(button, '');
        button.textContent = result.already ? '115 提示已转存过' : '已转存（可再次转存）';
        showHdhiveReturnButton({ cid: result.cid });
      } catch (error) {
        setBusy(button, '');
        notifyToast(`115 转存失败：${error.message}`, 'error', 7000);
      }
    }
    function watchJob(token, button, sourceUrl, child) {
      const start = Date.now();
      const closeChild = () => { try { if (child && !child.closed) child.close(); } catch (error) { /* 已关闭 */ } };
      const poll = () => {
        const job = getHdhiveJobs()[token];
        if (!job) { setBusy(button, ''); return; }
        if (job.status === 'link') { removeHdhiveJob(token); setTimeout(closeChild, 600); finishTransfer(job, button, sourceUrl); return; }
        if (job.status === 'error') { removeHdhiveJob(token); setTimeout(closeChild, 600); setBusy(button, ''); notifyToast(`一键转存失败：${job.error || '未获得 115 链接'}`, 'error', 7000); return; }
        if (job.step && button.textContent !== job.step) button.textContent = job.step;
        if (Date.now() - start > HDHIVE_WAIT_MS + 8000) {
          removeHdhiveJob(token);
          closeChild();
          setBusy(button, '');
          notifyToast('一键转存超时：请检查登录状态与积分', 'warning', 7000);
          return;
        }
        setTimeout(poll, 400);
      };
      poll();
    }
    function startViaPopup(slug, button) {
      const token = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      const sourceUrl = `${location.origin}/resource/115/${slug}`;
      updateHdhiveJob(token, { time: Date.now(), status: 'pending', mode: 'popup', source: sourceUrl });
      const child = window.open(`${sourceUrl}?${HDHIVE_AUTO_PARAM}=${token}`, HDHIVE_WINDOW_PREFIX + token, 'width=360,height=260,left=0,top=80,resizable=yes,scrollbars=yes');
      if (!child) { removeHdhiveJob(token); notifyToast('浏览器拦截了弹窗，请允许本站弹出窗口后重试', 'warning', 7000); return; }
      setBusy(button, '获取链接中…');
      watchJob(token, button, sourceUrl, child);
    }
    // 详情页内：本页点击解锁；站点会跳到 115 分享页，由那里的脚本接力完成转存。
    async function runOnDetailPage(button) {
      const parsedNow = find115ShareIn(document.body);
      if (parsedNow) return finishTransfer(parsedNow, button, location.origin + location.pathname);
      const token = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      updateHdhiveJob(token, { time: Date.now(), status: 'pending', mode: 'same-tab', source: location.origin + location.pathname });
      setBusy(button, '解锁中…');
      const unlocker = makeHdhiveUnlocker((step) => { button.textContent = step; });
      const start = Date.now();
      while (Date.now() - start < HDHIVE_WAIT_MS) {
        const parsed = find115ShareIn(document.body);
        if (parsed) { removeHdhiveJob(token); return finishTransfer(parsed, button, location.origin + location.pathname); }
        const failure = (document.body.innerText || '').match(/积分不足|余额不足|请先登录|请登录后|解锁失败/);
        if (failure) { removeHdhiveJob(token); setBusy(button, ''); return notifyToast(`一键转存失败：${failure[0]}`, 'error', 7000); }
        unlocker();
        await sleep(300);
      }
      removeHdhiveJob(token);
      setBusy(button, '');
      notifyToast('一键转存超时：请检查登录状态与积分', 'warning', 7000);
    }
    const makeButton = (attr) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset[attr] = '1';
      button.textContent = '一键转存';
      button.title = '一键解锁并转存到 115 /ovo（没有时自动创建）；会消耗资源标明的积分';
      return button;
    };
    const scan = () => {
      const enabled = featureEnabled('115HdhiveTransfer');
      const onDetail = /^\/resource\/115\/[a-f0-9]{32}\/?$/i.test(location.pathname);
      document.querySelectorAll('[data-qk115-detail-transfer]').forEach((button) => { if (!enabled || !onDetail) button.remove(); });
      document.querySelectorAll('[data-qk115-hdhive-button], [data-qk-115-hdhive-button]').forEach((button) => { if (!enabled) button.remove(); });
      if (!enabled) return;
      if (onDetail && !document.querySelector('[data-qk115-detail-transfer]')) {
        const anchor = document.querySelector('button[class*="ResourceSurface_primaryAction"]') || hdhiveUnlockButton(document) ||
          [...document.querySelectorAll('a[href*="115"]')].find((a) => parse115Share(a.href));
        if (anchor) {
          const button = makeButton('qk115DetailTransfer');
          button.style.cssText = 'display:block;margin:12px 0;padding:9px 16px;border:2px solid #b45309;border-radius:9px;background:#fff7ed;color:#78350f;font-weight:700;cursor:pointer';
          button.onclick = (event) => { event.preventDefault(); event.stopPropagation(); if (!button.disabled) runOnDetailPage(button); };
          anchor.insertAdjacentElement('afterend', button);
        }
      }
      document.querySelectorAll('a[href*="/resource/115/"], [data-cloud-website="115"][role="link"]').forEach((card) => {
        const buttons = [...card.querySelectorAll('[data-qk115-hdhive-button], [data-qk-115-hdhive-button]')];
        const existing = buttons.find((button) => button.matches('[data-qk115-hdhive-button]'));
        if (existing) {
          buttons.forEach((button) => { if (button !== existing) button.remove(); });
          return;
        }
        const button = makeButton('qk115HdhiveButton');
        // 卡片右上角（卡片本身是 position:relative），浮在发布者行之上。
        button.style.cssText = 'position:absolute;top:14px;right:14px;z-index:3;margin:0;padding:5px 12px;border-radius:16px;border:1px solid #b45309;color:#92400e;background:#fff7ed;cursor:pointer;font-weight:600;font-size:13px;line-height:18px;box-shadow:0 1px 4px rgba(0,0,0,.12)';
        const cardPosition = getComputedStyle(card).position;
        if (!cardPosition || cardPosition === 'static') card.style.position = 'relative';
        button.onclick = (event) => {
          event.preventDefault(); event.stopPropagation();
          if (button.disabled) return;
          const parsed = find115ShareIn(card);
          if (parsed) return finishTransfer(parsed, button, location.href);
          const slug = getRe0ResourceSlug(card);
          if (!slug) return notifyToast('未能识别资源 ID，请打开资源详情后再点一键转存', 'warning');
          startViaPopup(slug, button);
        };
        card.appendChild(button);
      });
    };
    const start = () => {
      if (!document.body) return setTimeout(start, 100);
      scan();
      new MutationObserver(() => { clearTimeout(pending); pending = setTimeout(scan, 250); })
        .observe(document.body, { childList: true, subtree: true });
    };
    start();
  }

  // 教父页面只显示返回入口，不启动网盘/RPC 等无关模块。
  if (SITE_HOST === 'www.xn--wcv59z.com') {
    const mountReturnButton = () => {
      if (document.getElementById('qk-jiaofu-return')) return;
      const button = document.createElement('button');
      button.id = 'qk-jiaofu-return';
      button.type = 'button';
      button.textContent = '返回夸克网盘';
      button.title = '在当前窗口打开夸克网盘全部文件';
      Object.assign(button.style, {
        position: 'fixed', top: '20px', right: '20px', zIndex: '2147483647',
        padding: '9px 14px', border: '0', borderRadius: '8px',
        background: '#0d53ff', color: '#fff', fontSize: '14px', fontWeight: '600',
        cursor: 'pointer', boxShadow: '0 3px 12px rgba(0,0,0,.25)'
      });
      button.addEventListener('click', () => { window.location.href = LIST_PAGE_URL; });
      document.body.appendChild(button);
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', mountReturnButton, { once: true });
    } else {
      mountReturnButton();
    }
    return;
  }

  async function autoSave115SharePage() {
    if (!isAutoSaveEnabled() || !/^\/s\//.test(location.pathname) ||
      !['115.com', '115cdn.com', 'anxia.com'].some((d) => SITE_HOST === d || SITE_HOST.endsWith('.' + d))) return;
    const parsed = parse115Share(location.href);
    if (!parsed?.code || !parsed.share) return;
    if (Object.values(getHdhiveJobs()).some((job) => job?.status === 'pending' && job.mode === 'same-tab')) return;
    const snap = await gm115Json('GET', `https://webapi.115.com/share/snap?${new URLSearchParams({ share_code: parsed.share, receive_code: parsed.code, cid: '0', limit: '20', offset: '0' })}`);
    if (snap?.state !== true) throw new Error(snap?.error || '115 分享不可用或访问码错误');
    const info = snap.data?.userinfo || {};
    const decision = applyShareSourceFilter({ site: '115.com', name: info.user_name, id: info.user_id });
    if (decision === 'blocked') return notifyToast('⛔ 115 分享者在红名单中，已阻止自动转存', 'error', 7000);
    if (decision === 'unknown' && shareFilterEnabled('115.com')) return notifyToast('⚠️ 无法核实 115 分享者账号 ID，已阻止自动转存；可关闭 115 分享来源过滤后重试', 'warning', 7000);
    // 允许重复保存：曾保存过只提示，照常再转存一次。
    if (has115SavedShare(parsed.share)) {
      const saved = find115SavedShareLog(parsed.share);
      notifyToast(`🔁 该 115 分享曾保存过${saved?.time ? `（${saved.time}）` : ''}，正在再次转存到 /ovo`, 'info', 4000);
    }
    const cid = await resolve115OvoFolder();
    if (!isAutoSaveEnabled()) return;
    const input = document.querySelector?.('input[placeholder="请输入访问码"]');
    if (input && input.value === parsed.code) {
      const confirm = [...document.querySelectorAll('button')].find((button) => button.textContent.trim() === '确定' && !button.disabled);
      if (confirm) confirm.click();
    }
    await doHdhiveTransfer(parsed, location.href, { destinationCid: cid });
    if (/(^|\.)115cdn\.com$/.test(SITE_HOST)) showHdhiveReturnButton({ cid, sameWindow: true, persistent: true });
  }

  // UC 分享详情接口返回分享者信息时，沿用相同的站点名单匹配。
  function installUcShareSourceFilter() {
    if (SITE_HOST !== 'drive.uc.cn' || !/^\/(s|share)\//.test(location.pathname)) return;
    const page = getPageWindow();
    if (page.__qkUcSourceFilter) return;
    page.__qkUcSourceFilter = true;
    const handle = (url, text) => {
      if (!/\/share\/sharepage\/detail(?:\?|$)/.test(url || '')) return;
      let json;
      try { json = typeof text === 'string' ? JSON.parse(text) : text; } catch (error) { return; }
      if (!json || json.code !== 0 || !json.data) return;
      const info = json.data.share_info || json.data.share_user || json.data;
      applyShareSourceFilter({ site: 'drive.uc.cn',
        name: info.nickname || info.user_name || info.share_user_name,
        id: info.user_id || info.uid || info.share_user_id });
    };
    const rawFetch = page.fetch;
    if (typeof rawFetch === 'function') page.fetch = function (input) {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      const promise = rawFetch.apply(this, arguments);
      if (/\/share\/sharepage\/detail/.test(url)) Promise.resolve(promise).then((res) => res?.clone()?.text().then((text) => handle(url, text))).catch(() => {});
      return promise;
    };
    const XHR = page.XMLHttpRequest;
    if (XHR?.prototype) {
      const rawOpen = XHR.prototype.open;
      XHR.prototype.open = function (method, url) {
        const target = String(url || '');
        if (/\/share\/sharepage\/detail/.test(target)) this.addEventListener('load', () => {
          try { handle(target, this.responseType === 'json' ? this.response : this.responseText); } catch (error) { /* 忽略 */ }
        });
        return rawOpen.apply(this, arguments);
      };
    }
  }

  if (is115RelatedHost() && SITE_HOST !== '115.com') {
    GM_registerMenuCommand('设置', () => RpcHelper.openSettings());
    RpcHelper.start();
  }
  install115ShareSaveLogger();
  installBaiduShareSaveLogger();
  installBaiduShareSourceFilter();
  installUcShareSourceFilter();
  installGenericShareSaveLogger();
  if (relay115ShareForHdhive()) return;
  if (['115.com', '115cdn.com', 'anxia.com'].some((domain) => SITE_HOST === domain || SITE_HOST.endsWith('.' + domain)) && /^\/s\//.test(location.pathname)) {
    const start115AutoSave = () => autoSave115SharePage().catch((error) => {
      console.warn('[夸克懒得点] 115 自动转存已停止:', error);
      notifyToast(`115 自动转存未完成：${error.message || error}`, 'warning', 7000);
    });
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start115AutoSave, { once: true });
    else start115AutoSave();
  }
  install115DeleteFirst();
  install115HdhiveTransfer();
  const IS_QUARK = SITE_HOST === 'pan.quark.cn';
  const IS_SUPPORTED_DRIVE = IS_QUARK || ['115.com', 'drive.uc.cn', 'cloud.189.cn', 'pan.xunlei.com', 'yun.139.com', 'yun.123pan.cn', 'pan.baidu.com', 'www.guangyapan.com'].includes(SITE_HOST);

  if (location.pathname === '/' && SITE_HOST === '115.com' && featureEnabled('115AutoRedirect')) {
    const cid = new URLSearchParams(location.search).get('cid');
    location.replace(`https://115.com/storage/allfiles${cid && /^\d+$/.test(cid) ? `?cid=${cid}&mode=wangpan` : ''}`);
    return;
  }
  if (!IS_SUPPORTED_DRIVE) return;
  GM_registerMenuCommand('设置', () => RpcHelper.openSettings());
  RpcHelper.start();

  if (!IS_QUARK) return;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

  window.__quarkLazyDebug = {
    rerun: () => scheduleHandle('manual-rerun'),
    showDuplicateOverlay,
    resetDone: () => {
      Runtime.shareFlowDone.clear();
      scheduleHandle('reset-done');
    }
  };
})();
