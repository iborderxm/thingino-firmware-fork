/**
 * 人形检测视频浏览页
 *
 * 视图结构：根视图按日期（YYYYMMDD）文件夹展示，进入文件夹后展示其中的录像视频。
 * 后端返回真实文件大小与修改时间，视频列表按时间倒序并支持前端分页。
 */
(function() {
  'use strict';

  const API_URL = '/x/tool-persondetection-videos.cgi';
  const PAGE_SIZE = 50;

  const tableBody = document.querySelector('#videoTable tbody');
  const tableHead = document.querySelector('#tableHead');
  const emptyState = $('#emptyState');
  const emptyText = $('#emptyText');
  const loadingState = $('#loadingState');
  const refreshBtn = $('#btnRefresh');
  const openFileManagerBtn = $('#btnOpenFileManager');
  const pathInfoText = $('#pathInfoText');
  const breadcrumb = $('#breadcrumb');
  const paginationNav = $('#pagination');
  const pageInfo = $('#pageInfo');
  const prevPageBtn = $('#prevPage');
  const nextPageBtn = $('#nextPage');
  const playerModalEl = $('#playerModal');
  const playerContainer = $('#player');
  const playerStage = $('#playerStage');
  const playerLoading = $('#playerLoading');
  const playerMeta = $('#playerMeta');
  const playerFallback = $('#playerFallback');
  const playerFallbackText = $('#playerFallbackText');
  const playerModalLabel = $('#playerModalLabel');
  const playerModalDownload = $('#playerModalDownload');
  const playerModalSound = $('#playerModalSound');
  const playerModalSoft = $('#playerModalSoft');
  const playerBtnPlayPause = $('#playerBtnPlayPause');
  const playerBtnFullscreen = $('#playerBtnFullscreen');
  const playerTime = $('#playerTime');
  const playerSeek = $('#playerSeek');

  const state = {
    folders: [],
    videos: [],
    savePath: '',
    currentFolder: null,
    currentFolderPath: null,
    loading: false,
    page: 1
  };

  // ---------- 格式化工具 ----------

  function encodePath(path) {
    return encodeURIComponent(path);
  }

  function formatFileSize(bytes) {
    if (!bytes || bytes <= 0) return '-';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  function formatDate(timestamp) {
    if (!timestamp) return '-';
    const date = new Date(timestamp * 1000);
    if (isNaN(date.getTime())) return '-';
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function formatFolderDate(timestamp) {
    if (!timestamp) return '-';
    const date = new Date(timestamp * 1000);
    if (isNaN(date.getTime())) return '-';
    return date.toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
  }

  // ---------- 状态展示 ----------

  function showEmpty(message) {
    emptyText.textContent = message;
    emptyState.classList.remove('d-none');
  }

  function hideEmpty() {
    emptyState.classList.add('d-none');
  }

  function showError(message) {
    if (window.showAlert) window.showAlert('danger', message);
    showEmpty(`加载失败: ${message}`);
  }

  function updatePathInfo() {
    pathInfoText.textContent = state.savePath
      ? `保存路径: ${state.savePath}`
      : '未配置保存路径';
  }

  function setBusy(busy) {
    loadingState.classList.toggle('d-none', !busy);
    state.loading = busy;
  }

  // ---------- 视图渲染 ----------

  function updateBreadcrumb() {
    breadcrumb.innerHTML = '';

    const rootItem = document.createElement('li');
    rootItem.className = 'breadcrumb-item';
    if (state.currentFolder) {
      const rootLink = document.createElement('a');
      rootLink.href = '#';
      rootLink.textContent = '人形检测视频';
      rootLink.addEventListener('click', (e) => {
        e.preventDefault();
        loadFolders();
      });
      rootItem.appendChild(rootLink);
    } else {
      rootItem.setAttribute('aria-current', 'page');
      rootItem.textContent = '人形检测视频';
    }
    breadcrumb.appendChild(rootItem);

    if (state.currentFolder) {
      const folderItem = document.createElement('li');
      folderItem.className = 'breadcrumb-item active';
      folderItem.setAttribute('aria-current', 'page');
      folderItem.textContent = state.currentFolder;
      breadcrumb.appendChild(folderItem);
    }
  }

  function updateTableHead(isFolderView) {
    tableHead.innerHTML = isFolderView ? `
      <tr>
        <th scope="col">文件夹名称</th>
        <th scope="col" class="text-end">视频数量</th>
        <th scope="col">最近录像</th>
        <th scope="col" class="text-end">操作</th>
      </tr>
    ` : `
      <tr>
        <th scope="col">文件名</th>
        <th scope="col" class="text-end">大小</th>
        <th scope="col">录制时间</th>
        <th scope="col" class="text-end">操作</th>
      </tr>
    `;
  }

  function updatePagination(total, totalPages) {
    const show = totalPages > 1;
    paginationNav.classList.toggle('d-none', !show);
    if (!show) return;

    prevPageBtn.parentElement.classList.toggle('disabled', state.page <= 1);
    nextPageBtn.parentElement.classList.toggle('disabled', state.page >= totalPages);
    pageInfo.textContent = `第 ${state.page} / ${totalPages} 页 · 共 ${total} 个`;
  }

  function renderFolders(folders) {
    tableBody.innerHTML = '';
    if (!folders || !folders.length) {
      showEmpty('未找到日期文件夹。');
      return;
    }
    hideEmpty();

    folders.forEach(folder => {
      const tr = document.createElement('tr');

      const nameCell = document.createElement('td');
      const nameLink = document.createElement('a');
      nameLink.href = '#';
      nameLink.textContent = folder.name;
      nameLink.className = 'text-decoration-none';
      nameLink.addEventListener('click', (e) => {
        e.preventDefault();
        loadVideosInFolder(folder.path, folder.name);
      });
      nameCell.appendChild(nameLink);
      tr.appendChild(nameCell);

      const countCell = document.createElement('td');
      countCell.className = 'text-end';
      countCell.textContent = String(folder.count || 0);
      tr.appendChild(countCell);

      const timeCell = document.createElement('td');
      timeCell.textContent = formatFolderDate(folder.time);
      tr.appendChild(timeCell);

      const actionCell = document.createElement('td');
      actionCell.className = 'text-end';

      const openBtn = document.createElement('button');
      openBtn.type = 'button';
      openBtn.className = 'btn btn-sm btn-outline-primary';
      openBtn.innerHTML = '<i class="bi bi-folder2-open"></i>';
      openBtn.title = '打开';
      openBtn.addEventListener('click', () => loadVideosInFolder(folder.path, folder.name));
      actionCell.appendChild(openBtn);

      tr.appendChild(actionCell);
      tableBody.appendChild(tr);
    });
  }

  function renderVideos() {
    tableBody.innerHTML = '';

    const total = state.videos.length;
    if (!total) {
      paginationNav.classList.add('d-none');
      showEmpty('该文件夹内未找到人形检测视频。');
      return;
    }
    hideEmpty();

    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (state.page > totalPages) state.page = totalPages;
    const start = (state.page - 1) * PAGE_SIZE;
    const rows = state.videos.slice(start, start + PAGE_SIZE);

    rows.forEach(video => {
      const tr = document.createElement('tr');

      const nameCell = document.createElement('td');
      const nameLink = document.createElement('a');
      nameLink.href = '#';
      nameLink.textContent = video.name;
      nameLink.className = 'text-decoration-none';
      nameLink.addEventListener('click', (e) => {
        e.preventDefault();
        showVideoPlayer(video);
      });
      nameCell.appendChild(nameLink);
      tr.appendChild(nameCell);

      const sizeCell = document.createElement('td');
      sizeCell.className = 'text-end';
      sizeCell.textContent = formatFileSize(video.size);
      tr.appendChild(sizeCell);

      const timeCell = document.createElement('td');
      timeCell.textContent = formatDate(video.time);
      tr.appendChild(timeCell);

      const actionCell = document.createElement('td');
      actionCell.className = 'text-end';

      const playBtn = document.createElement('button');
      playBtn.type = 'button';
      playBtn.className = 'btn btn-sm btn-outline-primary me-1';
      playBtn.innerHTML = '<i class="bi bi-play-fill"></i>';
      playBtn.title = '播放';
      playBtn.addEventListener('click', () => showVideoPlayer(video));
      actionCell.appendChild(playBtn);

      const downloadBtn = document.createElement('a');
      downloadBtn.href = `${API_URL}?dl=${encodePath(video.path)}`;
      downloadBtn.className = 'btn btn-sm btn-outline-secondary';
      downloadBtn.innerHTML = '<i class="bi bi-download"></i>';
      downloadBtn.title = '下载';
      downloadBtn.setAttribute('download', video.name);
      actionCell.appendChild(downloadBtn);

      tr.appendChild(actionCell);
      tableBody.appendChild(tr);
    });

    updatePagination(total, totalPages);
  }

  // ---------- 播放器 ----------
  //
  // 本机录像（prudynt.json 的 stream0/stream1 默认 "format": "H265"）在 Chrome/Firefox
  // 上无法用原生 <video> 解码，因此统一改由 h265web.js 播放：
  // 它会按 MP4 容器解封装，再走 MSE/WebCodec 硬解或 WASM 软解，H.264 文件同样适用。
  //
  // SDK 运行时约 4.7MB（h265web.js + h265web_wasm.js + h265web_wasm.wasm），
  // 不打包进固件，改为首次播放时从 CDN 按需加载，避免列表页首屏承担这段开销。
  // 许可证：CYL_Free-1.0（免费使用、可商用，禁止单独售卖本项目本体）。

  const H265_SDK_VERSION = 'v20261014';
  const H265_SDK_FILES = {
    main: 'h265web.js',
    wasmJs: 'h265web_wasm.js',
    wasmBinary: 'h265web_wasm.wasm'
  };
  // 主 CDN 不可达时依次回退；两个域名同源同版本，命中哪个都用同一套 base_url
  const H265_CDN_BASES = [
    `https://cdn.jsdelivr.net/gh/numberwolf/h265web.js@${H265_SDK_VERSION}/static/`,
    `https://fastly.jsdelivr.net/gh/numberwolf/h265web.js@${H265_SDK_VERSION}/static/`
  ];
  // h265web.js 支持的 VOD 容器；avi/webm 等不在此列，直接提示下载
  const SDK_PLAYABLE_EXT = ['mp4', 'm4v', 'mov', 'mkv', 'ts'];
  // 自动选核时 Chrome 常把 MSE/WebCodec 的 HEVC 报成"支持"，实际硬件解码器不输出帧，
  // 结果是"有声无画"。怀疑硬解失败时强制走 WASM 软解（CPU 换兼容性）。
  const H265_SOFT_CORE = 'wasm_hevc';
  const VIDEO_OUTPUT_CHECK_MS = 1500;

  let h265SdkPromise = null;
  let hevcPlayer = null;
  let pendingVideo = null;
  let playbackToken = 0;
  // 控件状态：SDK 不提供 UI，播放/暂停/进度/声音都由页面自己拼
  let mediaDuration = 0;
  let isPlaying = false;
  let isDragging = false;
  let soundOn = false;

  // 媒体地址必须给完整 URL：SDK 的拉流/解封装模块加载在 CDN 域下，
  // 站点绝对路径（/x/...）会被按 base_url 的源解析成 https://<CDN>/x/... 而 404。
  function mediaPlayUrl(path) {
    return `${window.location.origin}${API_URL}?play=${encodePath(path)}`;
  }

  function fileExtension(name) {
    const value = String(name || '');
    const idx = value.lastIndexOf('.');
    return idx < 0 ? '' : value.slice(idx + 1).toLowerCase();
  }

  function setPlayerLoading(busy) {
    playerLoading.classList.toggle('d-none', !busy);
  }

  function formatClock(seconds) {
    const value = isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
    const mm = String(Math.floor(value / 60)).padStart(2, '0');
    const ss = String(value % 60).padStart(2, '0');
    return `${mm}:${ss}`;
  }

  function updateTimeText(current) {
    const total = mediaDuration > 0 ? formatClock(mediaDuration) : '--:--';
    playerTime.textContent = `${formatClock(current)} / ${total}`;
  }

  function setPlayingUI(playing) {
    isPlaying = playing;
    playerBtnPlayPause.innerHTML = playing
      ? '<i class="bi bi-pause-fill"></i>'
      : '<i class="bi bi-play-fill"></i>';
  }

  function setControlsEnabled(enabled) {
    playerBtnPlayPause.disabled = !enabled;
    playerSeek.disabled = !enabled;
    playerBtnFullscreen.disabled = !enabled;
  }

  function isDocumentFullscreen() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement || document.mozFullscreenElement);
  }

  function updateFullscreenButton() {
    const active = isDocumentFullscreen();
    playerBtnFullscreen.innerHTML = active
      ? '<i class="bi bi-fullscreen-exit"></i>'
      : '<i class="bi bi-arrows-fullscreen"></i>';
    playerBtnFullscreen.title = active ? '退出全屏' : '全屏';
  }

  // 用 SDK 自带的全屏接口，避免和它内部的画布尺寸逻辑打架
  function toggleFullscreen() {
    if (!hevcPlayer) return;
    try {
      if (isDocumentFullscreen()) {
        if (typeof hevcPlayer.closeFullScreen === 'function') hevcPlayer.closeFullScreen();
        else if (document.exitFullscreen) document.exitFullscreen();
      } else if (typeof hevcPlayer.fullScreen === 'function') {
        hevcPlayer.fullScreen();
      }
    } catch (error) {
      showPlayerNotice(`全屏切换失败：${error.message || error}`);
    }
  }

  function resetControls() {
    mediaDuration = 0;
    isDragging = false;
    soundOn = true;
    playerSeek.value = '0';
    playerSeek.max = '100';
    updateTimeText(0);
    setPlayingUI(false);
    setControlsEnabled(false);
  }

  function setSoundButton(enabled) {
    playerModalSound.disabled = !enabled;
    playerModalSound.innerHTML = soundOn
      ? '<i class="bi bi-volume-up-fill"></i>'
      : '<i class="bi bi-volume-mute-fill"></i>';
    playerModalSound.title = soundOn ? '静音' : '开启声音';
  }

  function setSoftButton(enabled) {
    playerModalSoft.disabled = !enabled;
  }

  function showPlayerNotice(message) {
    if (!message) {
      playerFallback.classList.add('d-none');
      return;
    }
    playerFallbackText.textContent = message;
    playerFallback.classList.remove('d-none');
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const el = document.createElement('script');
      el.src = src;
      el.async = true;
      el.onload = () => resolve(src);
      el.onerror = () => {
        el.remove();
        reject(new Error(`无法加载 ${src}`));
      };
      document.head.appendChild(el);
    });
  }

  // 返回实际可用的 CDN base_url；全部失败时清空缓存以便下次重试
  function loadH265Sdk() {
    if (typeof window.H265webjsPlayer === 'function') return Promise.resolve(H265_CDN_BASES[0]);
    if (h265SdkPromise) return h265SdkPromise;

    h265SdkPromise = (async () => {
      let lastError = null;
      for (const base of H265_CDN_BASES) {
        try {
          await loadScript(`${base}${H265_SDK_FILES.main}`);
          if (typeof window.H265webjsPlayer === 'function') return base;
          lastError = new Error('h265web.js 已加载但未注册播放器');
        } catch (error) {
          lastError = error;
        }
      }
      h265SdkPromise = null;
      throw lastError || new Error('h265web.js 资源加载失败');
    })();

    return h265SdkPromise;
  }

  function releaseHevcPlayer() {
    if (hevcPlayer) {
      try {
        hevcPlayer.release();
      } catch (error) {
        // 异常状态下 release 可能抛错，忽略以避免中断清理流程
      }
      hevcPlayer = null;
    }
    playerContainer.innerHTML = '';
  }

  function stageHeight() {
    const width = playerStage.clientWidth || 640;
    return Math.max(240, Math.round(width * 9 / 16));
  }

  // 渲染诊断：把容器里实际出现的画布/视频元素尺寸显示出来，便于判断"黑屏"是没渲染还是没出帧
  function describeRenderDom() {
    const canvas = playerContainer.querySelector('canvas');
    const videoEl = playerContainer.querySelector('video');
    const parts = [];
    if (canvas) parts.push(`canvas ${canvas.width}x${canvas.height}`);
    if (videoEl) parts.push(`video ${videoEl.videoWidth}x${videoEl.videoHeight}`);
    return parts.join(' · ');
  }

  // 硬解路径（MSE / 原生）会插入 <video>，此时可以查解码帧数；
  // 若一直是 0 帧说明解码器没出画面，自动改用 WASM 软解重放。
  // 走 canvas 渲染的 WebCodec 路径无法这样判定，留给"软件解码"按钮手动处理。
  function watchVideoOutput(token) {
    setTimeout(() => {
      if (token !== playbackToken) return;
      const videoEl = playerContainer.querySelector('video');
      if (!videoEl) return;

      const quality = typeof videoEl.getVideoPlaybackQuality === 'function'
        ? videoEl.getVideoPlaybackQuality()
        : null;
      const frames = quality
        ? (quality.totalVideoFrames || 0)
        : (videoEl.webkitDecodedFrameCount || 0);
      if (frames > 0) return;

      showPlayerNotice('硬解路径未输出画面（音频正常），已自动切换到软件解码重试。');
      startPlayback({ forceSoftDecode: true });
    }, VIDEO_OUTPUT_CHECK_MS);
  }

  async function startPlayback(options = {}) {
    const video = pendingVideo;
    if (!video) return;

    const forceSoftDecode = !!options.forceSoftDecode;

    // token 用于丢弃已经过期的加载结果（例如用户已关闭弹窗）
    const token = ++playbackToken;
    releaseHevcPlayer();
    playerMeta.textContent = '';
    // 软解重试时保留提示，让用户知道当前走的是 CPU 软解
    if (forceSoftDecode) {
      showPlayerNotice('正在用 WASM 软件解码重放（兼容性最好，CPU 占用更高）…');
    } else {
      showPlayerNotice(null);
    }

    const ext = fileExtension(video.name);
    if (SDK_PLAYABLE_EXT.indexOf(ext) === -1) {
      setPlayerLoading(false);
      showPlayerNotice(
        ext
          ? `暂不支持在线播放 .${ext} 文件，请下载后使用本地播放器观看。`
          : '无法识别文件格式，请下载后使用本地播放器观看。'
      );
      return;
    }

    setPlayerLoading(true);

    try {
      const baseUrl = await loadH265Sdk();
      if (token !== playbackToken) return;

      hevcPlayer = window.H265webjsPlayer();

      hevcPlayer.on_ready_show_done_callback = () => {
        if (token !== playbackToken) return;
        setPlayerLoading(false);
        // 默认开启声音。若浏览器因自动播放策略挂起了音频，点一次静音图标再点开即可恢复。
        soundOn = true;
        if (typeof hevcPlayer.set_voice === 'function') hevcPlayer.set_voice(1);
        setSoundButton(true);
        setSoftButton(true);
        setControlsEnabled(true);
        setPlayingUI(true);

        const renderInfo = describeRenderDom();
        if (renderInfo) {
          playerMeta.textContent = [playerMeta.textContent, renderInfo].filter(Boolean).join(' · ');
        }
        if (!forceSoftDecode) watchVideoOutput(token);
      };

      hevcPlayer.video_probe_callback = (info) => {
        if (token !== playbackToken || !info) return;
        const codec = info.codecTypeName || info.codec_name || info.codec || '';
        const size = info.width && info.height ? `${info.width}x${info.height}` : '';
        const duration = typeof info.duration === 'number' ? `${info.duration.toFixed(1)}s` : '';
        playerMeta.textContent = [codec, size, duration].filter(Boolean).join(' · ');

        // 注意：录像用的是分片 MP4（moov 里 mvhd/tkhd/mdhd 的 duration 全是 0），
        // probe 拿到的只是"已解析部分"的时长，会随播放推进在 on_play_time 里修正。
        if (typeof info.duration === 'number' && info.duration > 0) {
          mediaDuration = info.duration;
          playerSeek.max = String(info.duration);
          updateTimeText(0);
        }
      };

      hevcPlayer.on_play_time = (pts) => {
        if (token !== playbackToken) return;
        let current = typeof pts === 'number' ? pts : 0;
        // 部分解码路径上报的是毫秒，按"远超总时长"折算回秒，避免时间/进度显示错乱
        if (mediaDuration > 0 && current > mediaDuration * 5 && current > 1000) {
          current = current / 1000;
        }
        // 分片 MP4 没有容器时长，probe 的时长偏短；按实际播到的位置把总时长往后推，
        // 这样进度条能覆盖真实时长，而不是卡在 probe 报的 6s。
        if (current > mediaDuration) {
          mediaDuration = current;
          playerSeek.max = String(current);
        }
        updateTimeText(current);
        if (!isDragging && mediaDuration > 0) {
          playerSeek.value = String(Math.min(current, mediaDuration));
        }
      };

      hevcPlayer.on_play_finished = () => {
        if (token !== playbackToken) return;
        setPlayingUI(false);
      };

      hevcPlayer.on_error_callback = (error) => {
        if (token !== playbackToken) return;
        setPlayerLoading(false);
        const detail = error && (error.message || error.code);
        showPlayerNotice(`播放失败：${detail || '未知错误'}`);
      };

      const config = {
        player_id: 'player',
        base_url: baseUrl,
        wasm_js_uri: H265_SDK_FILES.wasmJs,
        wasm_wasm_uri: H265_SDK_FILES.wasmBinary,
        width: '100%',
        height: stageHeight(),
        color: '#000000',
        auto_play: true,
        ignore_audio: false
      };
      // 不指定 core 时 SDK 会按 MSE/WebCodec → WASM 自动选核
      if (forceSoftDecode) config.core = H265_SOFT_CORE;

      const built = hevcPlayer.build(config);

      if (!built) throw new Error('播放器初始化失败');

      hevcPlayer.load_media(mediaPlayUrl(video.path));
    } catch (error) {
      if (token !== playbackToken) return;
      releaseHevcPlayer();
      setPlayerLoading(false);
      showPlayerNotice(
        `无法初始化播放器：${error.message || error}。请确认浏览器可以访问外网后重试，或下载后用本地播放器观看。`
      );
    }
  }

  function showVideoPlayer(video) {
    pendingVideo = video;
    playerModalLabel.textContent = video.name;
    playerModalDownload.href = `${API_URL}?dl=${encodePath(video.path)}`;
    playerModalDownload.setAttribute('download', video.name);
    showPlayerNotice(null);
    playerMeta.textContent = '';
    resetControls();
    setSoundButton(false);
    setSoftButton(false);
    setPlayerLoading(true);

    bootstrap.Modal.getOrCreateInstance(playerModalEl).show();
    // 实际构建放到 shown 之后：此时容器宽度才可测量，便于算出正确的画面高度
  }

  // ---------- 数据加载 ----------

  async function fetchJson(url) {
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' }
    });
    let payload = null;
    try {
      payload = await response.json();
    } catch (err) {
      // 响应不是 JSON（如 404 纯文本），交给下面的统一错误处理
    }
    if (!response.ok || (payload && payload.error)) {
      const message = payload && payload.error && payload.error.message
        ? payload.error.message
        : `请求失败 (HTTP ${response.status})`;
      throw new Error(message);
    }
    if (!payload) throw new Error('服务器返回无效数据');
    return payload;
  }

  function applyFolderView(payload) {
    state.folders = payload.folders || [];
    state.savePath = payload.save_path || '';
    state.currentFolder = null;
    state.currentFolderPath = null;
    state.page = 1;

    updatePathInfo();
    updateTableHead(true);
    updateBreadcrumb();
    paginationNav.classList.add('d-none');
    renderFolders(state.folders);
  }

  function applyVideoView(payload, folderName, folderPath) {
    state.videos = payload.videos || [];
    state.savePath = payload.save_path || '';
    state.currentFolder = folderName;
    state.currentFolderPath = folderPath;

    updatePathInfo();
    updateTableHead(false);
    updateBreadcrumb();
    renderVideos();
  }

  async function loadFolders() {
    if (state.loading) return;
    setBusy(true);
    hideEmpty();

    try {
      applyFolderView(await fetchJson(API_URL));
    } catch (error) {
      showError(error.message || '无法加载文件夹列表');
    } finally {
      setBusy(false);
    }
  }

  async function loadVideosInFolder(folderPath, folderName, options = {}) {
    if (state.loading) return;
    setBusy(true);
    hideEmpty();
    state.currentFolder = folderName;
    state.currentFolderPath = folderPath;
    // 刷新当前文件夹时保留页码；切换文件夹时回到第一页
    if (!options.keepPage) state.page = 1;

    try {
      const url = `${API_URL}?folder=${encodePath(folderPath)}`;
      applyVideoView(await fetchJson(url), folderName, folderPath);
    } catch (error) {
      showError(error.message || '无法加载视频列表');
    } finally {
      setBusy(false);
    }
  }

  // ---------- 事件绑定 ----------

  refreshBtn.addEventListener('click', () => {
    if (state.currentFolder) {
      loadVideosInFolder(state.currentFolderPath, state.currentFolder, { keepPage: true });
    } else {
      loadFolders();
    }
  });

  openFileManagerBtn.addEventListener('click', () => {
    if (!state.savePath) {
      if (window.showAlert) window.showAlert('warning', '未配置保存路径，无法打开文件管理器');
      return;
    }
    const normalized = state.savePath.startsWith('/') ? state.savePath : `/${state.savePath}`;
    const url = normalized === '/'
      ? '/tool-file-manager.html'
      : `/tool-file-manager.html?cd=${encodeURIComponent(normalized)}`;
    window.location.href = url;
  });

  prevPageBtn.addEventListener('click', (e) => {
    e.preventDefault();
    if (state.page > 1) {
      state.page -= 1;
      renderVideos();
    }
  });

  nextPageBtn.addEventListener('click', (e) => {
    e.preventDefault();
    const totalPages = Math.max(1, Math.ceil(state.videos.length / PAGE_SIZE));
    if (state.page < totalPages) {
      state.page += 1;
      renderVideos();
    }
  });

  playerModalEl.addEventListener('shown.bs.modal', () => {
    if (pendingVideo) startPlayback();
  });

  playerModalEl.addEventListener('hidden.bs.modal', () => {
    // 全屏状态下关弹窗会留下黑屏，先退出全屏
    if (isDocumentFullscreen() && document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
    }
    // 递增 token 让仍在进行的 SDK 加载结果失效，再释放 wasm/WebGL 实例
    playbackToken += 1;
    pendingVideo = null;
    releaseHevcPlayer();
    setPlayerLoading(false);
    resetControls();
    setSoundButton(false);
    setSoftButton(false);
  });

  playerModalSound.addEventListener('click', () => {
    if (!hevcPlayer || typeof hevcPlayer.set_voice !== 'function') return;
    soundOn = !soundOn;
    hevcPlayer.set_voice(soundOn ? 1 : 0);
    setSoundButton(true);
  });

  playerBtnPlayPause.addEventListener('click', () => {
    if (!hevcPlayer) return;
    if (isPlaying) {
      if (typeof hevcPlayer.pause === 'function') hevcPlayer.pause();
    } else if (typeof hevcPlayer.play === 'function') {
      hevcPlayer.play();
    }
    setPlayingUI(!isPlaying);
  });

  // 拖动时只更新时间文本，松手（change）才真正 seek，避免拖动过程狂发 Range 请求
  playerSeek.addEventListener('input', () => {
    isDragging = true;
    updateTimeText(parseFloat(playerSeek.value) || 0);
  });

  playerSeek.addEventListener('change', () => {
    const target = parseFloat(playerSeek.value) || 0;
    isDragging = false;
    updateTimeText(target);
    if (hevcPlayer && typeof hevcPlayer.seek === 'function') hevcPlayer.seek(target);
  });

  playerBtnFullscreen.addEventListener('click', toggleFullscreen);

  // SDK 内部双击画面也会切全屏，统一监听事件回写图标状态
  ['fullscreenchange', 'webkitfullscreenchange', 'mozfullscreenchange'].forEach((eventName) => {
    document.addEventListener(eventName, updateFullscreenButton);
  });

  // 硬解黑屏（有声无画）时的手动兜底：强制 WASM 软解重放
  playerModalSoft.addEventListener('click', () => {
    if (!pendingVideo) return;
    showPlayerNotice(null);
    startPlayback({ forceSoftDecode: true });
  });

  window.addEventListener('beforeunload', releaseHevcPlayer);

  loadFolders();
})();
