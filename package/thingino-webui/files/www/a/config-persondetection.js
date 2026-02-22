(function() {
  'use strict';

  const endpoint = '/x/json-prudynt.cgi';
  const personDetectionParams = [
    'enabled',
    'enable_perm',
    'enable_move',
    'sensitivity',
    'skip_frame_count',
    'detect_distance',
    'permcnt',
    'debounce_time',
    'post_time',
    'cooldown_time',
    'init_time',
    'min_time',
    'recording_duration',
    'recording_detection_interval',
    'monitor_stream',
    'recording_stream',
    'frame_width',
    'frame_height',
    'ivs_polling_timeout'
  ];
  const personDetectionStringParams = ['save_path'];

  const alertArea = $('#persondetection-alerts');
  const contentWrap = $('#persondetection-content');
  const reloadButton = $('#persondetection-reload');
  const form = $('#persondetection-form');
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

  function disablePersonDetectionInputs() {
    personDetectionParams.forEach(param => {
      const el = $('#persondetection_' + param);
      if (el) el.disabled = true;
      const slider = $('#persondetection_' + param + '-slider');
      if (slider) slider.disabled = true;
    });
    personDetectionStringParams.forEach(param => {
      const el = $('#persondetection_' + param);
      if (el) el.disabled = true;
    });
  }

  async function requestPrudynt(payload) {
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
      throw new Error('Invalid JSON from prudynt');
    }
  }

  function buildReadPayload() {
    const persondetection = {};
    personDetectionParams.forEach(param => {
      persondetection[param] = null;
    });
    personDetectionStringParams.forEach(param => {
      persondetection[param] = null;
    });
    return { persondetection };
  }

  let updatingFromBackend = false;

  function applyPersonDetectionConfig(persondetection = {}) {
    updatingFromBackend = true;
    try {
      personDetectionParams.forEach(param => {
        if (Object.prototype.hasOwnProperty.call(persondetection, param)) {
          setValue(persondetection, 'persondetection', param);
        }
      });
      personDetectionStringParams.forEach(param => {
        if (Object.prototype.hasOwnProperty.call(persondetection, param)) {
          const el = $('#persondetection_' + param);
          if (!el) return;
          el.value = persondetection[param] || '';
          el.disabled = false;
        }
      });
    } finally {
      updatingFromBackend = false;
    }
  }

  async function loadPersonDetectionConfig(options = {}) {
    const { silent = false } = options;
    let success = false;
    if (!silent) {
      showBusy('正在加载人形检测设置...');
      disablePersonDetectionInputs();
    } else {
      setReloadBusy(true);
    }
    try {
      const data = await requestPrudynt(buildReadPayload());
      if (!data || !data.persondetection) {
        throw new Error('Missing persondetection payload');
      }
      applyPersonDetectionConfig(data.persondetection);
      if (!initialLoadComplete) {
        if (contentWrap) contentWrap.classList.remove('d-none');
        if (typeof window.attachSliderButtons === 'function') {
          window.attachSliderButtons();
        }
        initialLoadComplete = true;
      }
      success = true;
      return true;
    } catch (err) {
      console.error('Failed to load person detection settings', err);
      showAlert('danger', `无法加载人形检测设置：${err.message || err}`);
      return false;
    } finally {
      if (!silent) {
        hideBusy();
      } else {
        setReloadBusy(false);
        if (success) showAlert('info', '人形检测设置已重新加载。', 3000);
      }
    }
  }

  async function sendPersonDetectionUpdate(payload) {
    try {
      const data = await requestPrudynt(payload);
      if (data && data.persondetection) {
        applyPersonDetectionConfig(data.persondetection);
      }
    } catch (err) {
      console.error('Failed to update person detection setting', err);
      throw err;
    }
  }

  async function savePersonDetectionParam(param) {
    const el = $('#persondetection_' + param);
    if (!el) return;
    let value;
    if (el.type === 'checkbox') {
      value = el.checked;
    } else if (el.type === 'select-one') {
      value = parseInt(el.value, 10);
    } else {
      const numeric = Number(el.value);
      value = Number.isNaN(numeric) ? 0 : numeric;
    }
    const payload = { persondetection: { [param]: value } };
    try {
      await sendPersonDetectionUpdate(payload);
    } catch (err) {
      showAlert('danger', `更新 ${param.replace(/_/g, ' ')} 失败：${err.message || err}`);
    }
  }

  async function savePersonDetectionStringParam(param) {
    const el = $('#persondetection_' + param);
    if (!el) return;
    const value = el.value;
    const payload = { persondetection: { [param]: value } };
    try {
      await sendPersonDetectionUpdate(payload);
    } catch (err) {
      showAlert('danger', `更新 ${param.replace(/_/g, ' ')} 失败：${err.message || err}`);
    }
  }

  function bindPersonDetectionControls() {
    personDetectionParams.forEach(param => {
      const el = $('#persondetection_' + param);
      if (el) {
        el.addEventListener('change', () => savePersonDetectionParam(param));
      }

      const slider = $('#persondetection_' + param + '-slider');
      if (slider) {
        slider.addEventListener('input', ev => {
          if (el) el.value = ev.target.value;
          const sliderValue = $('#persondetection_' + param + '-slider-value');
          if (sliderValue) sliderValue.textContent = ev.target.value;
        });
        slider.addEventListener('change', () => savePersonDetectionParam(param));
      }
    });

    personDetectionStringParams.forEach(param => {
      const el = $('#persondetection_' + param);
      if (el) {
        el.addEventListener('change', () => savePersonDetectionStringParam(param));
      }
    });
  }

  if (reloadButton) {
    reloadButton.addEventListener('click', async () => {
      try {
        reloadButton.disabled = true;
        const success = await loadPersonDetectionConfig({ silent: true });
        if (success) {
          showAlert('info', '人形检测设置已从相机重新加载。', 3000);
        }
      } catch (err) {
        showAlert('danger', '重新加载人形检测设置失败。');
      } finally {
        reloadButton.disabled = false;
      }
    });
  }

  disablePersonDetectionInputs();
  bindPersonDetectionControls();
  loadPersonDetectionConfig();
})();
