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
    'perms',
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
  const reloadButton = $('#persondetection-reload');
  const permConfig = $('#persondetection-perm-config');
  const permContainer = $('#persondetection-perms-container');
  const enablePermCheckbox = $('#persondetection_enable_perm');
  let initialLoadComplete = false;
  let frameWidth = 640;
  let frameHeight = 360;

  function getDefaultPolygonPoints(width, height) {
    // 0<width<frameWidth, 0<height<frameHeight
    if (width <= 0 || width >= frameWidth || height <= 0 || height >= frameHeight) {
      throw new Error('Invalid width or height');
    }
    const w = (width !== undefined && width !== null) ? width : frameWidth-1;
    const h = (height !== undefined && height !== null) ? height : frameHeight-1;
    return {
      pcnt: 8,
      points_x: [0, w / 2, w, w, w, w / 2, 0, 0],
      points_y: [0, 0, 0, h / 2, h, h, h, h / 2]
    };
  }

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
      // 固定permcnt为1
      persondetection.permcnt = 1;
      
      // 先更新frameWidth和frameHeight，再处理perms
      if (Object.prototype.hasOwnProperty.call(persondetection, 'frame_width')) {
        frameWidth = persondetection.frame_width || frameWidth;
        setValue(persondetection, 'persondetection', 'frame_width');
      }
      if (Object.prototype.hasOwnProperty.call(persondetection, 'frame_height')) {
        frameHeight = persondetection.frame_height || frameHeight;
        setValue(persondetection, 'persondetection', 'frame_height');
      }
      
      personDetectionParams.forEach(param => {
        if (Object.prototype.hasOwnProperty.call(persondetection, param)) {
          if (param === 'perms') {
            const defaults = getDefaultPolygonPoints();
            if (!persondetection.perms || persondetection.perms.length === 0) {
              persondetection.perms = [defaults];
            } else if (!persondetection.perms[0]) {
              persondetection.perms[0] = defaults;
            } else {
              persondetection.perms[0].pcnt = 8;
              while (persondetection.perms[0].points_x.length < 8) {
                persondetection.perms[0].points_x.push(0);
                persondetection.perms[0].points_y.push(0);
              }
              persondetection.perms[0].points_x.length = 8;
              persondetection.perms[0].points_y.length = 8;
            }
            window.personDetectionPerms = persondetection.perms;
          } else if (param !== 'frame_width' && param !== 'frame_height') {
            // 已经处理过frame_width和frame_height
            setValue(persondetection, 'persondetection', param);
          }
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
      
      // 处理权限区域显示/隐藏
      updatePermConfigVisibility();
      
      // 延迟更新画布，确保DOM已经更新
      setTimeout(() => {
        if (window.loadPolygonsFromForm) {
          window.loadPolygonsFromForm();
        }
      }, 100);
    } finally {
      updatingFromBackend = false;
    }
  }

  function updatePermConfigVisibility() {
    if (!enablePermCheckbox || !permConfig || !permContainer) return;
    
    const enabled = enablePermCheckbox.checked;
    if (enabled) {
      permConfig.classList.remove('d-none');
      permContainer.classList.add('d-none');
      
      // 延迟刷新画布，确保 DOM 已经显示
      setTimeout(() => {
        if (window.loadPolygonsFromForm) {
          window.loadPolygonsFromForm();
        }
        // 触发 resize 事件来重新计算画布尺寸
        window.dispatchEvent(new Event('resize'));
      }, 100);
    } else {
      permConfig.classList.add('d-none');
      permContainer.classList.remove('d-none');
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
    if (param === 'perms') {
      await savePermsConfig();
      return;
    }

    const el = $('#persondetection_' + param);
    if (!el) return;

    let value;
    if (el.type === 'checkbox') value = el.checked;
    else if (el.type === 'select-one') value = parseInt(el.value, 10);
    else {
      const numeric = Number(el.value);
      value = Number.isNaN(numeric) ? 0 : numeric;
    }

    try {
      await sendPersonDetectionUpdate({ persondetection: { [param]: value } });
      if (param === 'enable_perm') updatePermConfigVisibility();
    } catch (err) {
      showAlert('danger', `更新 ${param.replace(/_/g, ' ')} 失败：${err.message || err}`);
    }
  }

  function validatePermsConfig() {
    return true;
  }

  async function savePermsConfig() {
    if (!validatePermsConfig()) return;

    let perms;
    if (window.polygonData?.points) {
      const pointsX = [];
      const pointsY = [];
      for (let i = 0; i < 8; i++) {
        const pt = window.polygonData.points[i];
        pointsX.push(pt ? Math.round(pt.x) : 0);
        pointsY.push(pt ? Math.round(pt.y) : 0);
      }
      perms = [{ pcnt: 8, points_x: pointsX, points_y: pointsY }];
    } else {
      perms = [getDefaultPolygonPoints()];
    }

    try {
      await sendPersonDetectionUpdate({ persondetection: { perms, permcnt: 1 } });
      showAlert('success', '权限区域配置已保存');
    } catch (err) {
      showAlert('danger', `更新权限区域配置失败：${err.message || err}`);
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
      const el = document.getElementById('persondetection_' + param);
      if (el) el.addEventListener('change', () => savePersonDetectionParam(param));

      const slider = document.getElementById('persondetection_' + param + '-slider');
      if (slider) {
        slider.addEventListener('input', ev => {
          if (el) el.value = ev.target.value;
          const sliderValue = document.getElementById('persondetection_' + param + '-slider-value');
          if (sliderValue) sliderValue.textContent = ev.target.value;
        });
        slider.addEventListener('change', () => savePersonDetectionParam(param));
      }
    });

    personDetectionStringParams.forEach(param => {
      const el = document.getElementById('persondetection_' + param);
      if (el) el.addEventListener('change', () => savePersonDetectionStringParam(param));
    });

    if (enablePermCheckbox) {
      enablePermCheckbox.addEventListener('change', () => savePersonDetectionParam('enable_perm'));
    }
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

  function initEditor() {
    const canvasElement = document.getElementById('persondetection-editor');
    const previewImg = document.getElementById('preview');
    if (!canvasElement || !previewImg) return;

    let canvas;
    let polygonData = null;

    function initFabricCanvas() {
      const container = document.getElementById('persondetection-editor-container');
      if (!container) return;

      canvas = new fabric.Canvas('persondetection-editor', {
        selection: false,
        hoverCursor: 'pointer',
        backgroundColor: 'rgba(128, 128, 128, 0.1)'
      });

      const canvasContainer = canvasElement.parentElement;
      if (canvasContainer?.classList.contains('canvas-container')) {
        canvasContainer.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%';
      }

      resizeCanvas();
      drawGrid();
      loadPolygonsFromForm();
    }
    
    function drawGrid() {
      const gridSize = 50;
      const gridColor = 'rgba(128, 128, 128, 0.3)';
      for (let i = 0; i < frameWidth / gridSize; i++) {
        canvas.add(new fabric.Line([i * gridSize, 0, i * gridSize, frameHeight], {
          stroke: gridColor, strokeWidth: 1, selectable: false, evented: false
        }));
      }
      for (let i = 0; i < frameHeight / gridSize; i++) {
        canvas.add(new fabric.Line([0, i * gridSize, frameWidth, i * gridSize], {
          stroke: gridColor, strokeWidth: 1, selectable: false, evented: false
        }));
      }
    }
    
    function loadPolygonsFromForm() {
      if (!canvas) return;
      clearCanvas();

      let polygonPoints;
      if (window.polygonData?.points?.length === 8) {
        polygonPoints = window.polygonData.points;
      } else {
        const perm = window.personDetectionPerms?.[0] || getDefaultPolygonPoints();
        polygonPoints = [];
        for (let i = 0; i < 8; i++) {
          polygonPoints.push({ x: perm.points_x[i] || 0, y: perm.points_y[i] || 0 });
        }
      }

      createPolygon(polygonPoints);
      window.polygonData = { points: polygonPoints };
    }

    window.loadPolygonsFromForm = loadPolygonsFromForm;
    
    function clearCanvas() {
      if (!canvas) return;
      canvas.clear();
      canvas.backgroundColor = 'rgba(128, 128, 128, 0.1)';
      if (polygonData) {
        if (polygonData.polygon) canvas.remove(polygonData.polygon);
        polygonData.points.forEach(point => canvas.remove(point));
      }
      polygonData = null;
      drawGrid();
    }
    
    function createPolygon(polygonPoints) {
      if (!canvas || polygonPoints.length < 3) return;

      const polygon = new fabric.Polygon(polygonPoints, {
        fill: '#4CAF5040', stroke: '#4CAF50', strokeWidth: 2,
        selectable: false, evented: false, objectCaching: false
      });
      canvas.add(polygon);
      polygon.sendToBack();

      const areaData = { polygon, points: [] };

      polygonPoints.forEach((point, pointIndex) => {
        const circle = new fabric.Circle({
          radius: 2, fill: '#4CAF50', stroke: '#81C784', strokeWidth: 4,
          left: point.x, top: point.y, originX: 'center', originY: 'center',
          selectable: true, hasControls: false, hasBorders: false,
          hoverCursor: 'pointer', moveCursor: 'pointer',
          shadow: new fabric.Shadow({ color: '#4CAF50', blur: 10, offsetX: 0, offsetY: 0 }),
          pointIndex
        });

        circle.on('moving', function() {
          const x = Math.max(0, Math.min(frameWidth-1, this.left));
          const y = Math.max(0, Math.min(frameHeight-1, this.top));
          this.set({ left: x, top: y });
          updatePolygonPoint(pointIndex, x, y);
        });

        circle.on('modified', savePermsConfig);
        canvas.add(circle);
        areaData.points.push(circle);
      });

      polygonData = areaData;
      window.polygonData = {
        points: polygonPoints.map(p => ({ x: Math.round(p.x), y: Math.round(p.y) }))
      };
    }
    
    function updatePolygonPoint(pointIndex, x, y) {
      if (!polygonData?.polygon?.points[pointIndex]) return;
      polygonData.polygon.points[pointIndex].x = x;
      polygonData.polygon.points[pointIndex].y = y;
      polygonData.polygon.setCoords();
      if (window.polygonData) {
        window.polygonData.points[pointIndex] = { x: Math.round(x), y: Math.round(y) };
      }
    }
    
    function resizeCanvas() {
      if (!canvas) return;
      const container = document.getElementById('persondetection-editor-container');
      if (!container) return;

      const imgRect = previewImg.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();

      canvas.setWidth(imgRect.width);
      canvas.setHeight(imgRect.height);

      const scaleX = imgRect.width / frameWidth;
      const scaleY = imgRect.height / frameHeight;
      canvas.setZoom(Math.min(scaleX, scaleY));

      const canvasContainer = canvasElement.parentElement;
      if (canvasContainer?.classList.contains('canvas-container')) {
        canvasContainer.style.cssText = `position:absolute;top:${imgRect.top - containerRect.top}px;left:${imgRect.left - containerRect.left}px;width:${imgRect.width}px;height:${imgRect.height}px`;
      }

      loadPolygonsFromForm();
    }
    
    previewImg.addEventListener('load', resizeCanvas);
    window.addEventListener('resize', resizeCanvas);

    setTimeout(initFabricCanvas, 100);

    const resetAreaBtn = document.getElementById('persondetection-reset-area');
    if (resetAreaBtn) {
      resetAreaBtn.addEventListener('click', async () => {
        if (!(await confirm('确定要重置区域吗？这将恢复默认的检测区域设置。'))) return;
        const defaults = getDefaultPolygonPoints();
        const polygonPoints = defaults.points_x.map((x, i) => ({ x, y: defaults.points_y[i] }));
        clearCanvas();
        createPolygon(polygonPoints);
        window.polygonData = { points: polygonPoints };
        savePermsConfig();
      });
    }

    setTimeout(loadPolygonsFromForm, 1000);
  }

  disablePersonDetectionInputs();
  bindPersonDetectionControls();
  loadPersonDetectionConfig().then(() => {
    initEditor();
  });
})();
