(function() {
  'use strict';

  const endpoint = '/x/json-config-opc.cgi';
  const opcParams = ['server_ip', 'server_port', 'auth_key'];

  const alertArea = $('#opc-alerts');
  const reloadButton = $('#opc-reload');
  const form = $('#opc-form');
  const showKeyCheckbox = $('#opc_show_key');
  const authKeyInput = $('#opc_auth_key');
  const statusIndicator = $('#opc-status-indicator');
  const statusMessage = $('#opc-status-message');
  let initialLoadComplete = false;

  function showAlert(variant, message, timeout = 6000) {
    if (!message) return;

    if (window.showAlert && typeof window.showAlert === 'function') {
      window.showAlert(variant, message, timeout);
      return;
    }

    if (!alertArea) return;
    const alert = document.createElement('div');
    alert.className = `alert alert-${variant || 'secondary'} alert-dismissible fade show`;
    alert.setAttribute('role', 'alert');
    alert.textContent = message;
    const dismissBtn = document.createElement('button');
    dismissBtn.type = 'button';
    dismissBtn.className = 'btn-close';
    dismissBtn.setAttribute('aria-label', 'Close');
    dismissBtn.addEventListener('click', () => alert.remove());
    alert.appendChild(dismissBtn);
    alertArea.appendChild(alert);
    if (timeout > 0) {
      setTimeout(() => {
        alert.classList.remove('show');
        setTimeout(() => alert.remove(), 200);
      }, timeout);
    }
  }

  function setReloadBusy(state) {
    if (!reloadButton) return;
    reloadButton.disabled = !!state;
    reloadButton.classList.toggle('disabled', !!state);
  }

  function disableOpcInputs() {
    opcParams.forEach(param => {
      const el = $('#opc_' + param);
      if (el) el.disabled = true;
    });
  }

  function enableOpcInputs() {
    opcParams.forEach(param => {
      const el = $('#opc_' + param);
      if (el) el.disabled = false;
    });
  }

  async function requestOpc(payload) {
    const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch (err) {
      throw new Error('Invalid JSON response');
    }
  }

  async function requestOpcGet() {
    const response = await fetch(endpoint, {
      method: 'GET'
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch (err) {
      throw new Error('Invalid JSON response');
    }
  }

  let updatingFromBackend = false;

  function applyOpcConfig(config = {}) {
    updatingFromBackend = true;
    try {
      opcParams.forEach(param => {
        if (Object.prototype.hasOwnProperty.call(config, param)) {
          const el = $('#opc_' + param);
          if (!el) return;
          el.value = config[param] || '';
        }
      });
    } finally {
      updatingFromBackend = false;
    }
  }

  async function loadOpcConfig(options = {}) {
    const { silent = false } = options;
    let success = false;
    if (!silent) {
      showBusy('正在加载 OPC 配置...');
      disableOpcInputs();
    } else {
      setReloadBusy(true);
    }
    try {
      const data = await requestOpcGet();
      applyOpcConfig(data);
      if (!initialLoadComplete) {
        if (typeof window.attachSliderButtons === 'function') {
          window.attachSliderButtons();
        }
        initialLoadComplete = true;
      }
      success = true;
      return true;
    } catch (err) {
      console.error('Failed to load OPC config', err);
      showAlert('danger', `无法加载 OPC 配置：${err.message || err}`);
      return false;
    } finally {
      if (!silent) {
        hideBusy();
      } else {
        setReloadBusy(false);
        if (success) showAlert('info', 'OPC 配置已重新加载。', 3000);
      }
    }
  }

  async function saveOpcConfig() {
    const config = {};
    opcParams.forEach(param => {
      const el = $('#opc_' + param);
      if (el) {
        config[param] = el.value;
      }
    });

    if (!config.server_ip) {
      showAlert('danger', '服务器 IP 不能为空');
      return false;
    }
    if (!config.server_port) {
      showAlert('danger', '服务器端口不能为空');
      return false;
    }
    if (!config.auth_key) {
      showAlert('danger', '通信密钥不能为空');
      return false;
    }

    showBusy('正在保存 OPC 配置...');
    try {
      await requestOpc(config);
      showAlert('success', 'OPC 配置已保存');
      return true;
    } catch (err) {
      console.error('Failed to save OPC config', err);
      showAlert('danger', `保存 OPC 配置失败：${err.message || err}`);
      return false;
    } finally {
      hideBusy();
    }
  }

  async function checkOpcStatus() {
    showBusy('正在检查 OPC 服务状态...');
    try {
      const response = await fetch('/x/opc-status.cgi');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      
      if (data.running) {
        statusIndicator.innerHTML = '<span class="badge bg-success">运行中</span>';
        statusMessage.textContent = `PID: ${data.pid}, 连接: ${data.connected ? '已连接' : '未连接'}`;
      } else {
        statusIndicator.innerHTML = '<span class="badge bg-danger">未运行</span>';
        statusMessage.textContent = 'OPC 服务未运行';
      }
    } catch (err) {
      console.error('Failed to check OPC status', err);
      statusIndicator.innerHTML = '<span class="badge bg-secondary">未知</span>';
      statusMessage.textContent = `检查失败: ${err.message || err}`;
    } finally {
      hideBusy();
    }
  }

  async function restartOpcService() {
    if (!confirm('确定要重启 OPC 服务吗？')) {
      return;
    }
    showBusy('正在重启 OPC 服务...');
    try {
      const response = await fetch('/x/opc-restart.cgi', { method: 'POST' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (data.status === 'ok') {
        showAlert('success', 'OPC 服务重启成功');
        setTimeout(checkOpcStatus, 1000);
      } else {
        throw new Error(data.error || '重启失败');
      }
    } catch (err) {
      console.error('Failed to restart OPC service', err);
      showAlert('danger', `重启 OPC 服务失败：${err.message || err}`);
    } finally {
      hideBusy();
    }
  }

  function bindOpcControls() {
    opcParams.forEach(param => {
      const el = $('#opc_' + param);
      if (el) {
        el.addEventListener('change', () => {
          if (!updatingFromBackend) {
          }
        });
      }
    });

    if (showKeyCheckbox) {
      showKeyCheckbox.addEventListener('change', () => {
        if (authKeyInput) {
          authKeyInput.type = showKeyCheckbox.checked ? 'text' : 'password';
        }
      });
    }
  }

  const saveButton = $('#save-opc-config');
  if (saveButton) {
    saveButton.addEventListener('click', async () => {
      await saveOpcConfig();
    });
  }

  const checkStatusButton = $('#check-opc-status');
  if (checkStatusButton) {
    checkStatusButton.addEventListener('click', async () => {
      await checkOpcStatus();
    });
  }

  const restartButton = $('#restart-opc-service');
  if (restartButton) {
    restartButton.addEventListener('click', async () => {
      await restartOpcService();
    });
  }

  if (reloadButton) {
    reloadButton.addEventListener('click', async () => {
      try {
        reloadButton.disabled = true;
        const success = await loadOpcConfig({ silent: true });
        if (success) {
          showAlert('info', 'OPC 配置已从相机重新加载。', 3000);
        }
      } catch (err) {
        showAlert('danger', '重新加载 OPC 配置失败。');
      } finally {
        reloadButton.disabled = false;
      }
    });
  }

  disableOpcInputs();
  bindOpcControls();
  loadOpcConfig();
})();
