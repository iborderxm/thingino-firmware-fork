// tool-nas.js - NAS 挂载（NFS）配置页面
// GET/POST /x/json-config-nas.cgi，后端把 <server_ip>:<remote_path> 写入 nfs_share。
(function () {
  'use strict';

  const API_URL = '/x/json-config-nas.cgi';
  const SERVER_IP_RE = /^[A-Za-z0-9._-]+$/;
  const REMOTE_PATH_RE = /^\/[A-Za-z0-9._/-]*$/;

  const form = document.getElementById('nas-form');
  const serverIpInput = document.getElementById('nas-server-ip');
  const remotePathInput = document.getElementById('nas-remote-path');
  const currentShare = document.getElementById('nas-current-share');
  const messageBox = document.getElementById('nas-message');
  const submitBtn = document.getElementById('nas-submit');
  const reloadBtn = document.getElementById('nas-reload');
  const mountBadge = document.getElementById('nas-mount-badge');
  const mountNote = document.getElementById('nas-mount-note');
  const mountDetails = document.getElementById('nas-mount-details');
  const statusReloadBtn = document.getElementById('nas-status-reload');

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

    mountBadge.className = badgeClass;
    mountBadge.textContent = badgeText;
    mountNote.textContent = note;

    const rows = [
      ['配置 nfs_share', state.nfs_share],
      ['实际挂载源', state.source],
      ['服务端 IP', state.server_ip],
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
      throw new Error(data.message || `请求失败（HTTP ${response.status}）`);
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
      if (announce) {
        showMessage('已从相机重新加载配置', 'info');
      } else if (share && !parts.remotePath) {
        showMessage('当前 nfs_share 格式不是 <server_ip>:<remote_path>，请重新填写后保存', 'warning');
      }
    } catch (error) {
      showMessage('加载配置失败：' + error.message, 'danger');
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
      submitBtn.disabled = false;
      if (typeof window.hideBusy === 'function') window.hideBusy();
    }
  }

  async function refreshMountStatus() {
    statusReloadBtn.disabled = true;
    try {
      const data = await fetchJson({ cache: 'no-store' });
      renderMount(data.mount);
      showMessage('已刷新挂载状态', 'info');
    } catch (error) {
      showMessage('刷新挂载状态失败：' + error.message, 'danger');
    } finally {
      statusReloadBtn.disabled = false;
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    form.addEventListener('submit', saveConfig);
    reloadBtn.addEventListener('click', () => loadConfig(true));
    statusReloadBtn.addEventListener('click', refreshMountStatus);
    loadConfig(false);
  });
})();
