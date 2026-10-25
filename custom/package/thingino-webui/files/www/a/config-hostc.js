// config-hostc.js - hostc Cloudflare 隧道配置页面前端逻辑
// 数据读写走 /x/json-config-hostc.cgi，后端通过 fw_printenv/fw_setenv 操作 uboot 环境变量。
// 可修改：HOSTC_SERVER、HOSTC_TARGET、HOSTC_SUBDOMAIN、HOSTC_ENABLED。

const API_URL = '/x/json-config-hostc.cgi';

// 当前相机上的配置
let hostcConfig = { server: '', target: '', subdomain: '', enabled: false };
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

// 子域名命名规则：长度 12 位，仅小写字母或数字
function isValidSubdomain(value) {
  return /^[a-z0-9]{12}$/.test(value);
}

// target 命名规则：host:port，port 1-65535
function isValidTarget(value) {
  if (!/^[^:]+:[0-9]+$/.test(value)) return false;
  const port = Number(value.split(':').pop());
  return port >= 1 && port <= 65535;
}

// 从相机加载当前配置；updateForm=false 时仅刷新运行状态，不覆盖表单输入
async function loadData(updateForm = true) {
  try {
    const response = await fetch(API_URL);
    if (!response.ok) throw new Error('加载配置失败');
    const data = await response.json();
    if (data.error) throw new Error(data.error.message || '加载配置失败');

    if (data.supported === false) {
      $('#hostc-not-supported').classList.remove('d-none');
      $('#hostcForm').classList.add('d-none');
      return;
    }

    hostcConfig = data.config || hostcConfig;
    svcStatus = data.status || svcStatus;

    $('#hostc-not-supported').classList.add('d-none');
    $('#hostcForm').classList.remove('d-none');

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
  const badge = $('#hostc-status-badge');
  const detail = $('#hostc-status-detail');
  if (!badge) return;

  const buttons = ['btn-start', 'btn-stop', 'btn-restart'];

  // 服务脚本未安装：隐藏按钮并提示
  if (!svcStatus.service) {
    badge.className = 'badge text-bg-danger';
    badge.innerHTML = '<i class="bi bi-exclamation-triangle"></i> 服务脚本未安装';
    if (detail) detail.textContent = '缺少 /etc/init.d/S99hostc';
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

// 服务控制：action = start|stop|restart（后端经 /etc/init.d/S99hostc 执行）
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
  $('#hostc-server').value = hostcConfig.server || '';
  $('#hostc-target').value = hostcConfig.target || '';
  $('#hostc-subdomain').value = hostcConfig.subdomain || '';
  $('#hostc-enabled').checked = hostcConfig.enabled === true;
  updateTunnelPreview();
}

// 由 server 与 subdomain 拼出完整隧道地址 https://{subdomain}.{host}
function buildTunnelUrl(subdomain, server) {
  if (!subdomain) return '';
  let host = (server || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!host) host = '166989.xyz';
  return 'https://' + subdomain + '.' + host;
}

// 根据当前输入刷新隧道地址预览与复制按钮可用性
function updateTunnelPreview() {
  const subdomain = $('#hostc-subdomain').value.trim();
  const server = $('#hostc-server').value.trim();
  const url = buildTunnelUrl(subdomain, server);
  const urlInput = $('#hostc-tunnel-url');
  if (urlInput) urlInput.value = url;
  const copyBtn = $('#btn-copy-tunnel');
  if (copyBtn) copyBtn.disabled = !url;
  updateSubdomainCounter();
}

// 子域名长度计数器（必须正好 12 位）
function updateSubdomainCounter() {
  const el = $('#hostc-subdomain');
  const cnt = $('#hostc-subdomain-count');
  if (!el || !cnt) return;
  const len = el.value.length;
  cnt.textContent = len + ' / 12';
  cnt.classList.remove('text-success', 'text-danger');
  if (len === 12) {
    cnt.classList.add('text-success');
  } else if (len > 0) {
    cnt.classList.add('text-danger');
  }
}

// 复制完整隧道地址到剪贴板（优先 Clipboard API，失败回退 execCommand）
async function copyTunnelUrl() {
  const url = $('#hostc-tunnel-url').value;
  if (!url) return;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(url);
    } else {
      const input = $('#hostc-tunnel-url');
      input.removeAttribute('readonly');
      input.select();
      input.setSelectionRange(0, 99999);
      document.execCommand('copy');
      input.setAttribute('readonly', '');
    }
    showMessage('隧道地址已复制: ' + url, 'success');
  } catch (err) {
    console.error('Copy failed:', err);
    showMessage('复制失败: ' + err.message, 'danger');
  }
}

// 随机生成 12 位子域名（小写字母 + 数字）
function generateSubdomain() {
  const charset = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 12; i++) {
    out += charset.charAt(Math.floor(Math.random() * charset.length));
  }
  return out;
}

// 收集表单并保存（写入 uboot 环境变量）
async function saveData() {
  const server = $('#hostc-server').value.trim();
  const target = $('#hostc-target').value.trim();
  const subdomain = $('#hostc-subdomain').value.trim();
  const enabled = $('#hostc-enabled').checked;

  // 前端校验
  if (!server) {
    showMessage('隧道服务器地址不能为空', 'danger');
    return;
  }
  if (!/^https?:\/\/[A-Za-z0-9._:-]+$/.test(server)) {
    showMessage('隧道服务器地址须以 http(s):// 开头，仅支持字母、数字、点、下划线、连字符和冒号', 'danger');
    return;
  }
  if (!target) {
    showMessage('本地目标不能为空', 'danger');
    return;
  }
  if (!isValidTarget(target)) {
    showMessage('本地目标格式须为 host:port，端口 1-65535', 'danger');
    return;
  }
  if (enabled && !subdomain) {
    showMessage('启用 hostc 前必须先填写 12 位子域名', 'danger');
    return;
  }
  if (subdomain && !isValidSubdomain(subdomain)) {
    showMessage('子域名长度必须正好 12 位，且仅含小写字母或数字', 'danger');
    return;
  }

  const body = {
    server,
    target,
    subdomain,
    enabled
  };

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

  // 随机生成子域名
  $('#btn-gen-subdomain').addEventListener('click', () => {
    $('#hostc-subdomain').value = generateSubdomain();
    updateTunnelPreview();
  });

  // 子域名 / 服务器变化时刷新隧道地址预览
  $('#hostc-subdomain').addEventListener('input', updateTunnelPreview);
  $('#hostc-server').addEventListener('input', updateTunnelPreview);

  // 复制完整隧道地址
  $('#btn-copy-tunnel').addEventListener('click', copyTunnelUrl);

  // 重新加载按钮
  const btnReload = $('#hostc-reload');
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
