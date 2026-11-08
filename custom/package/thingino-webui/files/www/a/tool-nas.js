// tool-nas.js - NAS 挂载(NFS)配置页面
// GET/POST /x/json-config-nas.cgi，后端把 <server_ip>:<remote_path> 写入 nfs_share。
(function () {
  'use strict';

  const API_URL = '/x/json-config-nas.cgi';
  const SERVER_IP_RE = /^[A-Za-z0-9._-]+$/;
  const REMOTE_PATH_RE = /^\/[A-Za-z0-9._/-]*$/;
  // 与 tool-nas.html 的文案保持一致；后台 2049 端口探测本身每分钟才更新一次
  const STATUS_POLL_MS = 5000;
  // 后端 df 在 NFS 卡住时最多耗时 5 秒，超时放弃本次轮询以免请求堆积
  const STATUS_POLL_TIMEOUT_MS = 8000;

  const form = document.getElementById('nas-form');
  const serverIpInput = document.getElementById('nas-server-ip');
  const remotePathInput = document.getElementById('nas-remote-path');
  const currentShare = document.getElementById('nas-current-share');
  const messageBox = document.getElementById('nas-message');
  const submitBtn = document.getElementById('nas-submit');
  const reloadBtn = document.getElementById('nas-reload');
  const mountBadge = document.getElementById('nas-mount-badge');
  const serverBadge = document.getElementById('nas-server-badge');
  const mountNote = document.getElementById('nas-mount-note');
  const mountDetails = document.getElementById('nas-mount-details');
  const statusReloadBtn = document.getElementById('nas-status-reload');
  const autoRefreshToggle = document.getElementById('nas-auto-refresh');
  const statusUpdated = document.getElementById('nas-status-updated');

  // 轮询防重入；保存/手动刷新期间跳过轮询，避免旧状态覆盖新结果
  let statusPollInFlight = false;
  let actionPending = false;
  // 状态未变化时跳过 DOM 重建，避免打断页面上的文本选择
  let lastMountSnapshot = null;

  function showMessage(text, variant) {
    messageBox.textContent = text;
    messageBox.className = `alert alert-${variant}`;
  }

  function renderShare(share) {
    currentShare.textContent = share || '未配置';
  }

  function splitShare(share) {
    const pos = share.indexOf(':');
    if (pos === -1) {
      return { serverIp: share, remotePath: '' };
    }
    return { serverIp: share.slice(0, pos), remotePath: share.slice(pos + 1) };
  }

  function renderMount(mount) {
    const snapshot = JSON.stringify(mount || {});
    if (snapshot === lastMountSnapshot) return;
    lastMountSnapshot = snapshot;
    const state = mount || {};
    let badgeClass = 'badge text-bg-secondary';
    let badgeText = '状态未知';
    let note = '';

    if (state.mounted === true && state.matched === true) {
      badgeClass = 'badge text-bg-success';
      badgeText = '已挂载 · 与配置一致';
      note = '服务端与远程目录均与 /etc/thingino.json 一致';
    } else if (state.mounted === true) {
      badgeClass = 'badge text-bg-warning';
      badgeText = '已挂载 · 与配置不一致';
      note = '保存配置后会自动重启挂载服务';
    } else if (state.mounted === false) {
      badgeClass = 'badge text-bg-danger';
      badgeText = '未挂载';
      note = state.nfs_share ? '已配置 nfs_share，保存配置后将尝试挂载' : '尚未配置 nfs_share';
    }

    // 后台 checknfs 每分钟探测 2049 端口：true 可达 / false 不可达 / null 未探测
    let serverBadgeClass = 'badge text-bg-secondary';
    let serverBadgeText = '服务端状态未知';
    let serverAliveText = '未探测';
    if (state.server_alive === true) {
      serverBadgeClass = 'badge text-bg-success';
      serverBadgeText = '服务端可达';
      serverAliveText = '正常(2049 端口可达)';
    } else if (state.server_alive === false) {
      serverBadgeClass = 'badge text-bg-danger';
      serverBadgeText = '服务端不可达';
      serverAliveText = '异常(2049 端口不可达)';
      note = (note ? note + '；' : '') + '服务端 2049 端口不可达，录像写入可能失败';
    }
    serverBadge.className = serverBadgeClass;
    serverBadge.textContent = serverBadgeText;

    mountBadge.className = badgeClass;
    mountBadge.textContent = badgeText;
    mountNote.textContent = note;

    const rows = [
      ['配置 nfs_share', state.nfs_share],
      ['实际挂载源', state.source],
      ['服务端 IP', state.server_ip],
      ['服务端 2049 探测', serverAliveText],
      ['远程共享目录', state.remote_path],
      ['挂载点', state.mount_point],
      ['容量', state.size],
      ['已用', state.used],
      ['可用', state.available],
      ['使用率', state.use_percent]
    ];
    mountDetails.textContent = '';
    rows.forEach(([label, value]) => {
      const col = document.createElement('div');
      col.className = 'mb-2';
      const dt = document.createElement('dt');
      dt.className = 'text-secondary small mb-0';
      dt.textContent = label;
      const dd = document.createElement('dd');
      dd.className = 'mb-0';
      dd.textContent = value || '-';
      col.appendChild(dt);
      col.appendChild(dd);
      mountDetails.appendChild(col);
    });
  }

  async function fetchJson(options) {
    const response = await fetch(API_URL, options);
    let data;
    try {
      data = await response.json();
    } catch (error) {
      throw new Error('后端返回格式无效');
    }
    if (data.error) {
      throw new Error(data.error.message || '请求失败');
    }
    if (!response.ok) {
      throw new Error(data.message || `请求失败(HTTP ${response.status})`);
    }
    return data;
  }

  async function loadConfig(announce) {
    try {
      const data = await fetchJson({ cache: 'no-store' });
      const share = data.nfs_share || '';
      const parts = splitShare(share);
      serverIpInput.value = parts.serverIp;
      remotePathInput.value = parts.remotePath;
      renderShare(share);
      renderMount(data.mount);
      renderStatusUpdateTime(true);
      if (announce) {
        showMessage('已从相机重新加载配置', 'info');
      } else if (share && !parts.remotePath) {
        showMessage('当前 nfs_share 格式不是 <server_ip>:<remote_path>，请重新填写后保存', 'warning');
      }
    } catch (error) {
      showMessage('加载配置失败：' + error.message, 'danger');
      renderStatusUpdateTime(false);
    }
  }

  async function saveConfig(event) {
    event.preventDefault();
    const serverIp = serverIpInput.value.trim();
    const remotePath = remotePathInput.value.trim();

    if (!serverIp || !SERVER_IP_RE.test(serverIp) || serverIp.length > 253) {
      showMessage('server_ip 格式无效，仅支持 IPv4 地址或域名', 'danger');
      serverIpInput.focus();
      return;
    }
    if (!REMOTE_PATH_RE.test(remotePath) || remotePath.length > 256 || remotePath.includes('/..')) {
      showMessage('remote_path 格式无效，须以 / 开头且不含空格、引号或特殊字符', 'danger');
      remotePathInput.focus();
      return;
    }

    actionPending = true;
    submitBtn.disabled = true;
    if (typeof window.showBusy === 'function') window.showBusy('保存并检查挂载状态...');
    try {
      const data = await fetchJson({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ server_ip: serverIp, remote_path: remotePath })
      });
      renderShare(data.nfs_share || '');
      renderMount(data.mount);
      renderStatusUpdateTime(true);
      const check = data.check || {};
      const detail = check.message ? '。' + check.message : '';
      const repaired = data.config_repaired === true
        ? '。检测到配置损坏，原文件已备份' + (data.config_backup ? '为 ' + data.config_backup : '') + '，请检查其他配置项'
        : '';
      const variant = (check.matched === false || data.config_repaired === true) ? 'warning' : 'success';
      showMessage('配置已保存：' + (data.nfs_share || '') + detail + repaired, variant);
    } catch (error) {
      showMessage('保存配置失败：' + error.message, 'danger');
    } finally {
      actionPending = false;
      submitBtn.disabled = false;
      if (typeof window.hideBusy === 'function') window.hideBusy();
    }
  }

  function renderStatusUpdateTime(ok) {
    statusUpdated.textContent = ok
      ? '最近更新 ' + new Date().toLocaleTimeString()
      : '状态更新失败，保留上次结果';
  }

  // 定时轮询：只刷新状态区，不覆盖表单输入、不弹提示；失败时静默保留上次状态
  async function pollMountStatus() {
    if (!autoRefreshToggle.checked || document.hidden || actionPending || statusPollInFlight) return;
    statusPollInFlight = true;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), STATUS_POLL_TIMEOUT_MS);
    try {
      const data = await fetchJson({ cache: 'no-store', signal: controller.signal });
      // 期间若用户已保存或手动刷新，丢弃这次可能过期的状态
      if (actionPending) return;
      renderMount(data.mount);
      renderStatusUpdateTime(true);
    } catch (error) {
      // 轮询失败不打断页面操作
      console.debug('定时刷新挂载状态失败', error);
      renderStatusUpdateTime(false);
    } finally {
      clearTimeout(timeoutId);
      statusPollInFlight = false;
    }
  }

  async function refreshMountStatus() {
    if (actionPending) return;
    actionPending = true;
    statusReloadBtn.disabled = true;
    try {
      const data = await fetchJson({ cache: 'no-store' });
      renderMount(data.mount);
      renderStatusUpdateTime(true);
      showMessage('已刷新挂载状态', 'info');
    } catch (error) {
      showMessage('刷新挂载状态失败：' + error.message, 'danger');
      renderStatusUpdateTime(false);
    } finally {
      actionPending = false;
      statusReloadBtn.disabled = false;
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    form.addEventListener('submit', saveConfig);
    reloadBtn.addEventListener('click', () => loadConfig(true));
    statusReloadBtn.addEventListener('click', refreshMountStatus);
    autoRefreshToggle.addEventListener('change', () => {
      if (autoRefreshToggle.checked) pollMountStatus();
    });
    // 页面重新可见时立即刷新一次，不必等下一个轮询周期
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) pollMountStatus();
    });
    setInterval(pollMountStatus, STATUS_POLL_MS);
    loadConfig(false);
  });
})();
