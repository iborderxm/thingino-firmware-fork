(function() {
  'use strict';

  const motorsConfigEndpoint = '/x/json-motors-config.cgi';
  const alertContainer = $('#motors-alerts');
  const contentWrap = $('#motors-content');
  const form = $('#motors-form');
  const reloadButton = $('#motors-reload');
  const submitButton = form ? form.querySelector('button[type="submit"]') : null;
  const submitSpinner = submitButton ? submitButton.querySelector('.spinner-border') : null;
  const submitLabel = submitButton ? submitButton.querySelector('.label') : null;
  const submitDefaultText = submitLabel ? submitLabel.textContent : '保存电机';
  const typeBadge = $('#motors-type-badge');
  let initialLoadComplete = false;
  let svcStatus = { running: false, pid: '', service: false };
  let actionPending = false;

  function showAlert(variant, message, timeout = 6000) {
    if (!message) return;

    // Use global alert system from main.js
    if (window.showAlert && typeof window.showAlert === 'function') {
      window.showAlert(variant, message, timeout);
      return;
    }

    // Fallback to local alert container if it exists
    if (!alertContainer) return;
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
    alertContainer.appendChild(alert);
    if (timeout > 0) {
      setTimeout(() => {
        alert.classList.remove('show');
        setTimeout(() => alert.remove(), 200);
      }, timeout);
    }
  }

  function parseMotorPins(raw) {
    if (typeof raw !== 'string') return [];
    return raw.trim().split(/\s+/).filter(Boolean);
  }

  function setMotorPins(prefix, pins) {
    if (!Array.isArray(pins)) return;
    for (let i = 1; i <= 4; i += 1) {
      const input = $(`#gpio_${prefix}_${i}`);
      if (input) input.value = pins[i - 1] || '';
    }
  }

  function setMotorFieldValue(id, value) {
    const input = $(`#${id}`);
    if (!input) return;
    input.value = value === undefined || value === null ? '' : value;
  }

  function setMotorPinInputsEnabled(enabled) {
    const disablePins = !enabled;
    $$('#motors-form input[id^="gpio_"]').forEach(input => {
      input.disabled = disablePins;
    });
    $$('.flip_motor').forEach(btn => {
      btn.disabled = disablePins;
      btn.classList.toggle('disabled', disablePins);
    });
  }

  function updateBadge(isSpi) {
    if (!typeBadge) return;
    if (isSpi) {
      typeBadge.textContent = 'SPI 电机板';
      typeBadge.className = 'badge text-bg-info';
      typeBadge.title = '引脚由 SPI 控制,GPIO 输入已禁用';
    } else {
      typeBadge.textContent = '独立 GPIO 驱动';
      typeBadge.className = 'badge text-bg-dark';
      typeBadge.title = '引脚通过 GPIO 直接驱动';
    }
  }

  function updateHomingInputs() {
    const homing = $('#homing');
    const x = $('#pos_0_x');
    const y = $('#pos_0_y');
    if (!homing) return;
    const disabled = !homing.checked;
    if (x) x.disabled = disabled;
    if (y) y.disabled = disabled;
  }

  // Keep center (home) coordinate inputs bounded by the configured max steps
  function updateCenterLimits() {
    const stepsPanEl = $('#steps_pan');
    const stepsTiltEl = $('#steps_tilt');
    const homePanEl = $('#home_pan');
    const homeTiltEl = $('#home_tilt');
    const stepsPanVal = stepsPanEl && stepsPanEl.value ? parseInt(stepsPanEl.value, 10) : null;
    const stepsTiltVal = stepsTiltEl && stepsTiltEl.value ? parseInt(stepsTiltEl.value, 10) : null;
    if (homePanEl) homePanEl.max = stepsPanVal && stepsPanVal > 0 ? String(stepsPanVal) : '';
    if (homeTiltEl) homeTiltEl.max = stepsTiltVal && stepsTiltVal > 0 ? String(stepsTiltVal) : '';
  }

  // 渲染电机服务运行状态与启停按钮
  function renderStatus() {
    const badge = $('#motors-status-badge');
    const detail = $('#motors-status-detail');
    if (!badge) return;
    const buttons = ['btn-start', 'btn-stop', 'btn-restart'];
    if (!svcStatus.service) {
      badge.className = 'badge text-bg-danger';
      badge.innerHTML = '<i class="bi bi-exclamation-triangle"></i> 服务脚本未安装';
      if (detail) detail.textContent = '缺少 /etc/init.d/S59motor';
      buttons.forEach(id => { const b = $(`#${id}`); if (b) b.classList.add('d-none'); });
      return;
    }
    buttons.forEach(id => { const b = $(`#${id}`); if (b) b.classList.remove('d-none'); });
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

  // 服务控制:action = start|stop|restart（后端经 /etc/init.d/S59motor 执行）
  async function doAction(action) {
    const labels = { start: '启动', stop: '停止', restart: '重启' };
    const buttons = ['btn-start', 'btn-stop', 'btn-restart'];
    actionPending = true;
    buttons.forEach(id => { const b = $(`#${id}`); if (b) b.disabled = true; });
    try {
      if (window.showBusy) showBusy(`${labels[action]}电机服务...`);
      const params = new URLSearchParams();
      params.append('action', action);
      const response = await fetch(motorsConfigEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
        cache: 'no-store'
      });
      let payload = null;
      try { payload = await response.json(); } catch (_) { payload = null; }
      if (!response.ok || !payload || payload.error) {
        const message = payload && payload.error && payload.error.message;
        throw new Error(message || `HTTP ${response.status}`);
      }
      const inner = payload.message || {};
      const ok = inner.success !== false;
      showAlert(ok ? 'success' : 'danger', inner.message || `${labels[action]}完成`);
    } catch (err) {
      console.error(`Error ${action} motors service:`, err);
      showAlert('danger', `${labels[action]}失败: ${err.message || err}`);
    } finally {
      buttons.forEach(id => { const b = $(`#${id}`); if (b) b.disabled = false; });
      if (window.hideBusy) hideBusy();
      // 延迟回读状态:start 为后台拉起、stop 退出需要一点时间
      setTimeout(() => {
        loadMotorsConfig({ silent: true, statusOnly: true });
        actionPending = false;
      }, 800);
    }
  }

  function applyMotorsConfig(config = {}) {
    if (typeof config !== 'object' || !config) return;
    setMotorPins('pan', parseMotorPins(config.gpio_pan));
    setMotorPins('tilt', parseMotorPins(config.gpio_tilt));
    setMotorFieldValue('steps_pan', config.steps_pan);
    setMotorFieldValue('steps_tilt', config.steps_tilt);
    setMotorFieldValue('speed_pan', config.speed_pan);
    setMotorFieldValue('speed_tilt', config.speed_tilt);
    const homingEl = $('#homing');
    if (homingEl) {
      homingEl.checked = config.homing === true || config.homing === 'true';
    }
    const posParts = typeof config.pos_0 === 'string' ? config.pos_0.split(/\s*,\s*/) : [];
    setMotorFieldValue('pos_0_x', posParts[0] || '');
    setMotorFieldValue('pos_0_y', posParts[1] || '');
    setMotorFieldValue('home_pan', config.home_pan);
    setMotorFieldValue('home_tilt', config.home_tilt);
    updateHomingInputs();
    updateCenterLimits();
    const isSpi = config.is_spi === true || config.is_spi === 'true';
    setMotorPinInputsEnabled(!isSpi);
    updateBadge(isSpi);
    if (config.status) {
      svcStatus = config.status;
    }
    renderStatus();
  }

  async function loadMotorsConfig(options = {}) {
    const { silent = false, statusOnly = false } = options;
    if (!silent) showBusy('正在加载电机设置...');
    try {
      const response = await fetch(motorsConfigEndpoint, {
        headers: { 'Accept': 'application/json' },
        cache: 'no-store'
      });
      let payload = null;
      try {
        payload = await response.json();
      } catch (parseErr) {
        console.error('JSON parse error:', parseErr);
        payload = null;
      }
      if (!response.ok || !payload || payload.result !== 'success') {
        const message = payload && payload.error && payload.error.message;
        throw new Error(message || `HTTP ${response.status}`);
      }
      if (statusOnly) {
        const cfg = payload.message || {};
        if (cfg.status) svcStatus = cfg.status;
        renderStatus();
      } else {
        try {
          applyMotorsConfig(payload.message || {});
        } catch (applyErr) {
          console.error('applyMotorsConfig error:', applyErr);
          throw applyErr;
        }
        if (!initialLoadComplete) {
          if (contentWrap) contentWrap.classList.remove('d-none');
          initialLoadComplete = true;
        }
      }
      return true;
    } catch (err) {
      console.error('Failed to load motors config', err);
      showAlert('danger', `无法加载电机设置:${err.message || err}`);
      return false;
    } finally {
      if (!silent) hideBusy();
    }
  }

  async function saveMotorsConfig() {
    const form = $('#motors-form');
    if (!form) return;

    // Client-side validation to prevent 412 errors
    const requiredFields = [
      'gpio_pan_1', 'gpio_pan_2', 'gpio_pan_3', 'gpio_pan_4',
      'gpio_tilt_1', 'gpio_tilt_2', 'gpio_tilt_3', 'gpio_tilt_4',
      'steps_pan', 'steps_tilt'
    ];

    const formData = new FormData(form);
    const errors = [];

    // Check GPIO fields
    for (let i = 0; i < 8; i++) {
      const field = requiredFields[i];
      const value = formData.get(field);
      if (!value || value.trim() === '') {
        errors.push(`${field.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())} 为必填项`);
      }
    }

    // Check steps fields
    const stepsPan = formData.get('steps_pan');
    const stepsTilt = formData.get('steps_tilt');
    if (!stepsPan || parseInt(stepsPan) <= 0) {
      errors.push('水平最大步数必须为正数');
    }
    if (!stepsTilt || parseInt(stepsTilt) <= 0) {
      errors.push('垂直最大步数必须为正数');
    }

    // Check center (home) coordinates: positive integers not exceeding max steps
    const stepsPanNum = parseInt(stepsPan, 10) || 0;
    const stepsTiltNum = parseInt(stepsTilt, 10) || 0;
    const homePan = formData.get('home_pan');
    const homeTilt = formData.get('home_tilt');
    if (homePan !== null && String(homePan).trim() !== '') {
      const hp = Number(homePan);
      if (!Number.isInteger(hp) || hp <= 0) {
        errors.push('中心位置 Pan (home_pan) 必须为正整数');
      } else if (hp > stepsPanNum) {
        errors.push('中心位置 Pan (home_pan) 不能超过水平最大步数 (' + stepsPanNum + ')');
      }
    }
    if (homeTilt !== null && String(homeTilt).trim() !== '') {
      const ht = Number(homeTilt);
      if (!Number.isInteger(ht) || ht <= 0) {
        errors.push('中心位置 Tilt (home_tilt) 必须为正整数');
      } else if (ht > stepsTiltNum) {
        errors.push('中心位置 Tilt (home_tilt) 不能超过垂直最大步数 (' + stepsTiltNum + ')');
      }
    }

    if (errors.length > 0) {
      showAlert('danger', '请修复以下错误:' + errors);
      return;
    }

    showBusy('正在保存电机设置...');
    try {
      const homingEl = $('#homing');
      const params = new URLSearchParams();
      params.append('form', 'motors');
      params.append('homing', homingEl && homingEl.checked ? 'true' : 'false');
      formData.forEach((value, key) => {
        if (key !== 'form' && key !== 'homing') {
          params.append(key, value == null ? '' : value);
        }
      });
      const response = await fetch(motorsConfigEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
        cache: 'no-store'
      });
      let payload = null;
      try {
        payload = await response.json();
      } catch (_) {
        payload = null;
      }
      if (!response.ok || !payload || payload.result !== 'success') {
        const message = payload && payload.error && payload.error.message;
        throw new Error(message || `HTTP ${response.status}`);
      }
      applyMotorsConfig(payload.message || {});
      showAlert('success', '电机设置已更新.');
    } catch (err) {
      console.error('Failed to save motors config', err);
      showAlert('danger', `保存电机设置失败:${err.message || err}`);
    } finally {
      hideBusy();
    }
  }

  async function readMotorsPosition() {
    try {
      const res = await fetch('/x/json-motor.cgi?' + new URLSearchParams({ d: 'i' }).toString());
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { message } = await res.json();
      if (message) {
        if ($('#pos_0_x')) $('#pos_0_x').value = message.xpos;
        if ($('#pos_0_y')) $('#pos_0_y').value = message.ypos;
      }
      updateHomingInputs();
      showAlert('success', '已捕获当前位置作为新的参考点.', 4000);
    } catch (err) {
      console.error('Failed to read motors position', err);
      showAlert('danger', `无法读取当前位置:${err.message || err}`);
    }
  }

  async function readHomePosition() {
    try {
      const res = await fetch('/x/json-motor.cgi?' + new URLSearchParams({ d: 'i' }).toString());
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { message } = await res.json();
      if (message) {
        if ($('#home_pan')) $('#home_pan').value = message.xpos;
        if ($('#home_tilt')) $('#home_tilt').value = message.ypos;
      }
      showAlert('success', '已捕获当前位置作为新的中心 (home).', 4000);
    } catch (err) {
      console.error('Failed to read motors position', err);
      showAlert('danger', `无法读取当前位置:${err.message || err}`);
    }
  }

  if (form) {
    form.addEventListener('submit', ev => {
      ev.preventDefault();
      saveMotorsConfig();
    });
  }

  if (reloadButton) {
    reloadButton.addEventListener('click', async () => {
      try {
        reloadButton.disabled = true;
        const success = await loadMotorsConfig({ silent: true });
        if (success) {
          showAlert('info', '已从相机重新加载电机设置.', 3000);
        }
      } catch (err) {
        showAlert('danger', '重新加载电机设置失败.');
      } finally {
        reloadButton.disabled = false;
      }
    });
  }

  $$('.flip_motor').forEach(el => {
    el.addEventListener('click', ev => {
      ev.preventDefault();
      const dir = el.dataset.direction;
      if (!dir) return;
      const base = '#gpio_' + dir + '_';
      const pins = [1, 2, 3, 4].map(i => $(base + i)?.value).reverse();
      [1, 2, 3, 4].forEach((i, idx) => {
        const field = $(base + i);
        if (field && pins[idx] !== undefined) field.value = pins[idx];
      });
    });
  });

  $$('.read-motors').forEach(el => {
    el.addEventListener('click', ev => {
      ev.preventDefault();
      readMotorsPosition();
    });
  });

  $$('.read-home').forEach(el => {
    el.addEventListener('click', ev => {
      ev.preventDefault();
      readHomePosition();
    });
  });

  const homingSwitch = $('#homing');
  if (homingSwitch) {
    homingSwitch.addEventListener('change', updateHomingInputs);
    updateHomingInputs();
  }

  const stepsPanInput = $('#steps_pan');
  const stepsTiltInput = $('#steps_tilt');
  if (stepsPanInput) stepsPanInput.addEventListener('input', updateCenterLimits);
  if (stepsTiltInput) stepsTiltInput.addEventListener('input', updateCenterLimits);

  ['btn-start', 'btn-stop', 'btn-restart'].forEach(id => {
    const b = $(`#${id}`);
    if (b) b.addEventListener('click', () => doAction(id.replace('btn-', '')));
  });

  // 定时刷新运行状态（不覆盖表单输入；动作进行中时跳过）
  setInterval(() => {
    if (!actionPending) {
      loadMotorsConfig({ silent: true, statusOnly: true });
    }
  }, 5000);

  loadMotorsConfig();
})();
