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
        frameWidth = persondetection.frame_width || 640;
        setValue(persondetection, 'persondetection', 'frame_width');
      }
      if (Object.prototype.hasOwnProperty.call(persondetection, 'frame_height')) {
        frameHeight = persondetection.frame_height || 360;
        setValue(persondetection, 'persondetection', 'frame_height');
      }
      
      personDetectionParams.forEach(param => {
        if (Object.prototype.hasOwnProperty.call(persondetection, param)) {
          if (param === 'perms') {
            // 特殊处理权限区域配置
            // 确保perms数组有一个元素，且pcnt为8
            if (!persondetection.perms || persondetection.perms.length === 0) {
              // 默认坐标点覆盖整个画布，包括四个角点和四个边中点（顺时针方向连线）
              // 顺序：左上角、上中点、右上角、右中点、右下角、下中点、左下角、左中点
              persondetection.perms = [{
                pcnt: 8,
                points_x: [0, frameWidth/2, frameWidth, frameWidth, frameWidth, frameWidth/2, 0, 0],
                points_y: [0, 0, 0, frameHeight/2, frameHeight, frameHeight, frameHeight, frameHeight/2]
              }];
            } else {
              // 确保第一个区域有8个点
              if (!persondetection.perms[0]) {
                // 默认坐标点覆盖整个画布，包括四个角点和四个边中点（顺时针方向连线）
                // 顺序：左上角、上中点、右上角、右中点、右下角、下中点、左下角、左中点
                persondetection.perms[0] = {
                  pcnt: 8,
                  points_x: [0, frameWidth/2, frameWidth, frameWidth, frameWidth, frameWidth/2, 0, 0],
                  points_y: [0, 0, 0, frameHeight/2, frameHeight, frameHeight, frameHeight, frameHeight/2]
                };
              } else {
                persondetection.perms[0].pcnt = 8;
                // 确保有8个点
                while (persondetection.perms[0].points_x.length < 8) {
                  // 使用0作为默认值
                  persondetection.perms[0].points_x.push(0);
                  persondetection.perms[0].points_y.push(0);
                }
                while (persondetection.perms[0].points_x.length > 8) {
                  persondetection.perms[0].points_x.pop();
                  persondetection.perms[0].points_y.pop();
                }
              }
            }
            // 存储权限区域数据到全局变量，供canvas编辑器使用
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
      // 权限区域配置需要特殊处理
      await savePermsConfig();
      return;
    }
    
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
      
      // 特殊处理enable_perm和permcnt的变化
      if (param === 'enable_perm') {
        updatePermConfigVisibility();
      }
    } catch (err) {
      showAlert('danger', `更新 ${param.replace(/_/g, ' ')} 失败：${err.message || err}`);
    }
  }

  function validatePermsConfig() {
    // 验证通过，因为坐标通过canvas编辑器管理
    return true;
  }

  async function savePermsConfig() {
    // 验证配置
    if (!validatePermsConfig()) {
      return;
    }
    
    const perms = [];
    
    // 从canvas中获取多边形数据
    if (window.polygonData) {
      const pcnt = 8; // 固定点数为8
      const pointsX = [];
      const pointsY = [];
      
      // 确保有8个点
      for (let i = 0; i < pcnt; i++) {
        if (window.polygonData.points[i]) {
          pointsX.push(Math.round(window.polygonData.points[i].x));
          pointsY.push(Math.round(window.polygonData.points[i].y));
        } else {
          pointsX.push(0);
          pointsY.push(0);
        }
      }
      
      perms.push({
        pcnt,
        points_x: pointsX,
        points_y: pointsY
      });
    } else {
      // 默认坐标点覆盖整个画布
      const pcnt = 8;
      perms.push({
        pcnt,
        points_x: [0, frameWidth/2, frameWidth, frameWidth, frameWidth, frameWidth/2, 0, 0],
        points_y: [0, 0, 0, frameHeight/2, frameHeight, frameHeight, frameHeight, frameHeight/2]
      });
    }
    
    const payload = { persondetection: { perms, permcnt: 1 } };
    try {
      await sendPersonDetectionUpdate(payload);
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
      if (el) {
        el.addEventListener('change', () => savePersonDetectionParam(param));
      }

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
      if (el) {
        el.addEventListener('change', () => savePersonDetectionStringParam(param));
      }
    });
    
    // 绑定权限区域相关控件
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

  // 可视化编辑器相关功能
  function initEditor() {
    const canvasElement = document.getElementById('persondetection-editor');
    const previewImg = document.getElementById('preview');
    if (!canvasElement || !previewImg) return;
    
    let canvas;
    let polygonData = null;
    
    function initFabricCanvas() {
      const container = document.getElementById('persondetection-editor-container');
      if (!container) return;
      
      // 初始化Fabric Canvas
      canvas = new fabric.Canvas('persondetection-editor', {
        selection: false,
        hoverCursor: 'pointer',
        backgroundColor: 'rgba(128, 128, 128, 0.1)'
      });
      
      // 确保canvas容器保持绝对定位
      const canvasContainer = canvasElement.parentElement;
      if (canvasContainer && canvasContainer.classList.contains('canvas-container')) {
        canvasContainer.style.position = 'absolute';
        canvasContainer.style.top = '0';
        canvasContainer.style.left = '0';
        canvasContainer.style.width = '100%';
        canvasContainer.style.height = '100%';
      }
      
      // 调整画布大小和缩放比例
      resizeCanvas();
      
      drawGrid();
      loadPolygonsFromForm();
    }
    
    function drawGrid() {
      const gridSize = 50;
      const gridColor = 'rgba(128, 128, 128, 0.3)';
      
      const currentFrameWidth = frameWidth || 640;
      const currentFrameHeight = frameHeight || 360;
      
      for (let i = 0; i < currentFrameWidth / gridSize; i++) {
        const line = new fabric.Line([i * gridSize, 0, i * gridSize, currentFrameHeight], {
          stroke: gridColor,
          strokeWidth: 1,
          selectable: false,
          evented: false
        });
        canvas.add(line);
      }
      
      for (let i = 0; i < currentFrameHeight / gridSize; i++) {
        const line = new fabric.Line([0, i * gridSize, currentFrameWidth, i * gridSize], {
          stroke: gridColor,
          strokeWidth: 1,
          selectable: false,
          evented: false
        });
        canvas.add(line);
      }
    }
    
    function loadPolygonsFromForm() {
      if (!canvas) {
        return;
      }
      clearCanvas();
      
      let polygonPoints;
      
      // 优先使用全局 polygonData 中的数据（如果存在），避免重置用户的修改
      if (window.polygonData && window.polygonData.points && window.polygonData.points.length === 8) {
        polygonPoints = window.polygonData.points;
      } else {
        // 从后端数据中获取权限区域配置
        const perms = window.personDetectionPerms || [];
        const perm = perms[0] || {
          pcnt: 8,
          points_x: [0, frameWidth/2, frameWidth, frameWidth, frameWidth, frameWidth/2, 0, 0],
          points_y: [0, 0, 0, frameHeight/2, frameHeight, frameHeight, frameHeight, frameHeight/2]
        };
        
        // 确保有8个点
        const pointsX = [];
        const pointsY = [];
        
        for (let i = 0; i < 8; i++) {
          pointsX.push(perm.points_x[i] || 0);
          pointsY.push(perm.points_y[i] || 0);
        }
        
        polygonPoints = pointsX.map((x, idx) => ({ x, y: pointsY[idx] }));
      }
      
      createPolygon(polygonPoints);
      
      // 存储多边形数据到全局变量
      window.polygonData = {
        points: polygonPoints
      };
    }
    
    // 暴露loadPolygonsFromForm函数到全局作用域
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
      if (!canvas) {
        console.log('Canvas not initialized');
        return;
      }
      if (polygonPoints.length < 3) return;
      
      // 直接使用原始坐标点，因为已经通过setZoom处理了缩放
      const polygon = new fabric.Polygon(polygonPoints, {
        fill: '#4CAF5040',
        stroke: '#4CAF50',
        strokeWidth: 2,
        selectable: false,
        evented: false,
        objectCaching: false
      });
      
      canvas.add(polygon);
      polygon.sendToBack();
      
      const areaData = {
        polygon: polygon,
        points: []
      };
      
      polygonPoints.forEach((point, pointIndex) => {
        const circle = new fabric.Circle({
          radius: 2,
          fill: '#4CAF50',
          stroke: '#81C784',
          strokeWidth: 4,
          left: point.x,
          top: point.y,
          originX: 'center',
          originY: 'center',
          selectable: true,
          hasControls: false,
          hasBorders: false,
          hoverCursor: 'pointer',
          moveCursor: 'pointer',
          shadow: new fabric.Shadow({
            color: '#4CAF50',
            blur: 10,
            offsetX: 0,
            offsetY: 0
          }),
          pointIndex: pointIndex
        });
        
        circle.on('moving', function(options) {
          // 确保frameWidth和frameHeight有默认值
          const currentFrameWidth = frameWidth || 640;
          const currentFrameHeight = frameHeight || 360;
          
          // 使用0作为最小坐标值，确保坐标点不会被拖出画布
          const x = Math.max(0, Math.min(currentFrameWidth, this.left));
          const y = Math.max(0, Math.min(currentFrameHeight, this.top));
          this.set({ left: x, top: y });
          
          // 直接使用原始坐标，因为已经通过setZoom处理了缩放
          const originalX = Math.round(x);
          const originalY = Math.round(y);
          
          updatePolygonPoint(pointIndex, x, y);
        });
        
        // 顶点移动结束时保存配置
        circle.on('modified', function() {
          savePermsConfig();
        });
        
        canvas.add(circle);
        areaData.points.push(circle);
      });
      
      polygonData = areaData;
      // 更新全局 polygonData，确保 savePermsConfig 能获取到最新数据
      window.polygonData = {
        points: polygonPoints.map(point => ({ x: Math.round(point.x), y: Math.round(point.y) }))
      };
    }
    
    function updatePolygonPoint(pointIndex, x, y) {
      if (!polygonData || !polygonData.polygon) return;
      
      const polygonPoints = polygonData.polygon.points;
      if (polygonPoints[pointIndex]) {
        polygonPoints[pointIndex].x = x;
        polygonPoints[pointIndex].y = y;
        polygonData.polygon.setCoords();
        
        // 更新全局 polygonData，确保 savePermsConfig 能获取到最新数据
        if (window.polygonData) {
          window.polygonData.points[pointIndex] = { x: Math.round(x), y: Math.round(y) };
        }
      }
    }
    
    function resizeCanvas() {
      if (!canvas) return;
      
      const container = document.getElementById('persondetection-editor-container');
      if (!container) return;
      
      // 获取图片的实际显示尺寸
      const imgRect = previewImg.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      
      // 计算图片在容器内的相对位置
      const relativeTop = imgRect.top - containerRect.top;
      const relativeLeft = imgRect.left - containerRect.left;

      // 设置canvas尺寸和图片显示尺寸一致
      canvas.setWidth(imgRect.width);
      canvas.setHeight(imgRect.height);
      
      // 确保frameWidth和frameHeight有默认值
      const currentFrameWidth = frameWidth || 640;
      const currentFrameHeight = frameHeight || 360;
      // 计算缩放比例，使得frameWidth和frameHeight适配图片显示尺寸
      const scaleX = imgRect.width / currentFrameWidth;
      const scaleY = imgRect.height / currentFrameHeight;
      const scale = Math.min(scaleX, scaleY);
      
      // 设置画布缩放比例
      canvas.setZoom(scale);
      
      // 调整canvas容器位置和尺寸
      const canvasContainer = canvasElement.parentElement;
      if (canvasContainer && canvasContainer.classList.contains('canvas-container')) {
        canvasContainer.style.position = 'absolute';
        canvasContainer.style.top = relativeTop + 'px';
        canvasContainer.style.left = relativeLeft + 'px';
        canvasContainer.style.width = imgRect.width + 'px';
        canvasContainer.style.height = imgRect.height + 'px';
      }
      
      loadPolygonsFromForm();
    }
    
    previewImg.addEventListener('load', resizeCanvas);
    window.addEventListener('resize', resizeCanvas);
    
    setTimeout(initFabricCanvas, 100);
    
    const resetAreaBtn = document.getElementById('persondetection-reset-area');
    if (resetAreaBtn) {
      resetAreaBtn.addEventListener('click', async () => {
        if (!(await confirm('确定要重置区域吗？这将恢复默认的检测区域设置。'))) {
          return;
        }
        // 确保frameWidth和frameHeight有默认值
        const currentFrameWidth = frameWidth || 640;
        const currentFrameHeight = frameHeight || 360;
        // 默认坐标点覆盖整个画布，包括四个角点和四个边中点（顺时针方向连线）
        const defaultPointsX = [0, currentFrameWidth/2, currentFrameWidth, currentFrameWidth, currentFrameWidth, currentFrameWidth/2, 0, 0];
        const defaultPointsY = [0, 0, 0, currentFrameHeight/2, currentFrameHeight, currentFrameHeight, currentFrameHeight, currentFrameHeight/2];
        
        // 直接重置canvas中的多边形
        clearCanvas();
        const polygonPoints = defaultPointsX.map((x, idx) => ({ x, y: defaultPointsY[idx] }));
        createPolygon(polygonPoints);
        
        // 存储多边形数据到全局变量
        window.polygonData = {
          points: polygonPoints
        };
        
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
