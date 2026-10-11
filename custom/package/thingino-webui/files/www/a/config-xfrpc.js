// config-xfrpc.js - xfrp 内网穿透配置页面前端逻辑
// 数据读写走 /x/json-config-xfrpc.cgi，后端通过 xfrpc-ctl 操作 /etc/xfrpc.toml。
// 仅可修改：serverAddr、serverPort、enabled 与每个代理的 enabled、remotePort。

const API_URL = '/x/json-config-xfrpc.cgi';

// 当前相机上的配置（服务器参数）
let xfrpcConfig = { serverAddr: '', serverPort: null, enabled: false };
// 当前相机上的代理列表 [{name, type, enabled, localPort, remotePort}]
let proxies = [];
// 服务运行状态 {running, pid, service}
let svcStatus = { running: false, pid: '', service: false };
// 服务动作进行中标志（避免轮询与动作请求叠加）
let actionPending = false;

function showMessage(message, variant = 'info') {
  if (window.thinginoFooter && typeof window.thinginoFooter.showMessage === 'function') {
    window.thinginoFooter.showMessage(message, variant);
    return;
  }
  console.log(`[${variant}] ${message}`);
}

// 简易 HTML 转义，防止代理名等内容注入页面
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// 端口校验：1-65535 纯数字
function isValidPort(value) {
  return /^[0-9]+$/.test(String(value)) && Number(value) >= 1 && Number(value) <= 65535;
}

// 从相机加载当前配置；updateForm=false 时仅刷新运行状态，不覆盖表单输入
async function loadData(updateForm = true) {
  try {
    const response = await fetch(API_URL);
    if (!response.ok) throw new Error('加载配置失败');
    const data = await response.json();
    if (data.error) throw new Error(data.error.message || '加载配置失败');

    if (data.supported === false) {
      $('#xfrpc-not-supported').classList.remove('d-none');
      $('#xfrpcForm').classList.add('d-none');
      return;
    }

    xfrpcConfig = data.config || xfrpcConfig;
    proxies = Array.isArray(data.proxies) ? data.proxies : [];
    svcStatus = data.status || svcStatus;

    $('#xfrpc-not-supported').classList.add('d-none');
    $('#xfrpcForm').classList.remove('d-none');

    renderStatus();
    if (updateForm) {
      renderUI();
    }
  } catch (error) {
    console.error('Error loading data:', error);
    if (updateForm) {
      showMessage('加载配置失败: ' + error.message, 'danger');
    }
  }
}

// 渲染服务运行状态与启停按钮可见性
function renderStatus() {
  const badge = $('#xfrpc-status-badge');
  const detail = $('#xfrpc-status-detail');
  if (!badge) return;

  const buttons = ['btn-start', 'btn-stop', 'btn-restart'];

  // 服务脚本未安装：隐藏按钮并提示
  if (!svcStatus.service) {
    badge.className = 'badge text-bg-danger';
    badge.innerHTML = '<i class="bi bi-exclamation-triangle"></i> 服务脚本未安装';
    if (detail) detail.textContent = '缺少 /etc/init.d/S99xfrpc';
    buttons.forEach(id => {
      const b = $(`#${id}`);
      if (b) b.classList.add('d-none');
    });
    return;
  }
  buttons.forEach(id => {
    const b = $(`#${id}`);
    if (b) b.classList.remove('d-none');
  });

  if (svcStatus.running) {
    badge.className = 'badge text-bg-success';
    badge.innerHTML = '<i class="bi bi-play-circle"></i> 运行中';
    if (detail) detail.textContent = svcStatus.pid ? `PID: ${svcStatus.pid}` : '';
  } else {
    badge.className = 'badge text-bg-secondary';
    badge.innerHTML = '<i class="bi bi-stop-circle"></i> 已停止';
    if (detail) detail.textContent = '';
  }
}

// 服务控制：action = start|stop|restart（后端经 /etc/init.d/S99xfrpc 执行）
async function doAction(action) {
  const labels = { start: '启动', stop: '停止', restart: '重启' };
  const buttons = ['btn-start', 'btn-stop', 'btn-restart'];

  actionPending = true;
  buttons.forEach(id => {
    const b = $(`#${id}`);
    if (b) b.disabled = true;
  });

  try {
    if (window.showBusy) showBusy(`${labels[action]}服务...`);
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action })
    });
    const data = await response.json();
    if (data.error) throw new Error(data.error.message || '操作失败');

    if (data.success === false) {
      showMessage(`${labels[action]}失败: ${data.message || '未知错误'}`, 'danger');
    } else {
      showMessage(data.message || `${labels[action]}完成`, 'success');
    }
  } catch (error) {
    console.error(`Error ${action} service:`, error);
    showMessage(`${labels[action]}失败: ` + error.message, 'danger');
  } finally {
    buttons.forEach(id => {
      const b = $(`#${id}`);
      if (b) b.disabled = false;
    });
    if (window.hideBusy) hideBusy();
    // 延迟回读状态：start 为后台拉起、stop 退出需要一点时间
    setTimeout(() => {
      loadData(false);
      actionPending = false;
    }, 800);
  }
}

// 渲染整个表单
function renderUI() {
  $('#server-addr').value = xfrpcConfig.serverAddr || '';
  $('#server-port').value = xfrpcConfig.serverPort ?? '';
  $('#server-enabled').checked = xfrpcConfig.enabled === true;

  renderProxies();
}

// 渲染代理列表（名称/类型/本地端口只读，启用与远程端口可编辑）
function renderProxies() {
  const container = $('#proxies-list');

  if (!proxies.length) {
    container.innerHTML = '<p class="text-muted mb-0">未配置代理。</p>';
    return;
  }

  let html = '';
  proxies.forEach((p, index) => {
    const name = escapeHtml(p.name);
    html += `
      <div class="border rounded p-3 mb-3">
        <div class="d-flex justify-content-between align-items-center mb-2">
          <h5 class="mb-0">${name}</h5>
          <small class="text-muted">${escapeHtml(p.type || 'tcp')} · 本地端口 ${p.localPort ?? '-'}</small>
        </div>
        <div class="row g-3 align-items-center">
          <div class="col-12 col-md-5">
            <div class="form-check form-switch">
              <input class="form-check-input proxy-enabled" type="checkbox" id="proxy-enabled-${index}" data-index="${index}" ${p.enabled ? 'checked' : ''}>
              <label class="form-check-label" for="proxy-enabled-${index}">启用此代理</label>
            </div>
          </div>
          <div class="col-12 col-md-5">
            <label class="form-label" for="proxy-remote-${index}">远程端口 (remotePort)</label>
            <input type="number" class="form-control proxy-remote" id="proxy-remote-${index}" data-index="${index}"
              min="1" max="65535" placeholder="如 180" value="${p.remotePort ?? ''}">
          </div>
        </div>
      </div>`;
  });

  container.innerHTML = html;
}

// 收集表单并保存（仅提交白名单参数）
async function saveData() {
  // 前端校验
  const serverAddr = $('#server-addr').value.trim();
  const serverPort = $('#server-port').value.trim();

  if (!serverAddr) {
    showMessage('服务器地址不能为空', 'danger');
    return;
  }
  if (!/^[A-Za-z0-9._-]+$/.test(serverAddr)) {
    showMessage('服务器地址仅支持字母、数字、点、下划线和连字符', 'danger');
    return;
  }
  if (!isValidPort(serverPort)) {
    showMessage('服务器端口须为 1-65535 的数字', 'danger');
    return;
  }
  for (let i = 0; i < proxies.length; i++) {
    const input = $(`#proxy-remote-${i}`);
    if (input && input.value.trim() !== '' && !isValidPort(input.value.trim())) {
      showMessage(`代理 ${proxies[i].name} 的远程端口须为 1-65535 的数字`, 'danger');
      return;
    }
  }

  // 组装报文：服务器参数 + 每个代理的 enabled/remotePort
  const body = {
    serverAddr: serverAddr,
    serverPort: parseInt(serverPort, 10),
    enabled: $('#server-enabled').checked,
    proxies: {}
  };
  proxies.forEach((p, index) => {
    const remoteInput = $(`#proxy-remote-${index}`);
    const enabledInput = $(`#proxy-enabled-${index}`);
    const item = {
      enabled: enabledInput ? enabledInput.checked : p.enabled === true
    };
    // 远程端口留空则不上送该键，后端将跳过此项，保持原值不变
    if (remoteInput && remoteInput.value.trim() !== '') {
      item.remotePort = parseInt(remoteInput.value, 10);
    }
    body.proxies[p.name] = item;
  });

  const btnSave = $('#btn-save');
  try {
    btnSave.disabled = true;
    if (window.showBusy) showBusy('保存配置...');
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await response.json();
    if (data.error) throw new Error(data.error.message || '保存失败');
    if (data.success === false) {
      showMessage('保存失败: ' + (data.message || '未知错误') + (data.errors ? ` (${data.errors})` : ''), 'danger');
      return;
    }

    showMessage('配置已保存', 'success');
    await loadData(); // 保存后回读，以相机上的实际值为准
  } catch (error) {
    console.error('Error saving data:', error);
    showMessage('保存失败: ' + error.message, 'danger');
  } finally {
    btnSave.disabled = false;
    if (window.hideBusy) hideBusy();
  }
}

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  loadData();

  // 保存按钮
  $('#btn-save').addEventListener('click', saveData);

  // 服务控制按钮
  $('#btn-start').addEventListener('click', () => doAction('start'));
  $('#btn-stop').addEventListener('click', () => doAction('stop'));
  $('#btn-restart').addEventListener('click', () => doAction('restart'));

  // 重新加载按钮
  const btnReload = $('#xfrpc-reload');
  if (btnReload) {
    btnReload.addEventListener('click', async () => {
      try {
        btnReload.disabled = true;
        if (window.showBusy) showBusy('重新加载...');
        await loadData();
        showMessage('已从相机重新加载配置', 'info');
      } catch (err) {
        showMessage('重新加载配置失败', 'danger');
      } finally {
        btnReload.disabled = false;
        if (window.hideBusy) hideBusy();
      }
    });
  }

  // 定时刷新运行状态（不覆盖表单输入；动作进行中时跳过）
  setInterval(() => {
    if (!actionPending) {
      loadData(false);
    }
  }, 5000);
});
