/**
 * 人形检测视频浏览页
 *
 * 视图结构：根视图按日期（YYYYMMDD）文件夹展示，进入文件夹后展示其中的录像视频。
 * 后端返回真实文件大小与修改时间，视频列表按时间倒序并支持前端分页。
 *
 * 编码兼容：录制流可能是 H.264 或 H.265，文件名与 MIME 都不携带编码信息。
 * 页面只读取 MP4 头/尾片段中的 stsd box 识别编码，并结合浏览器
 * canPlayType 做初步判断。浏览器可能只解码音频、静默丢弃 H.265 视频轨
 * （不触发 error，canPlayType 也可能声称支持），所以播放后还会检查是否
 * 真的解码出视频帧，没有画面时停止"假播放"并给出下载引导。
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
  const playerEl = $('#player');
  const playerModalLabel = $('#playerModalLabel');
  const playerModalDownload = $('#playerModalDownload');
  const playerCodecBadge = $('#playerCodecBadge');
  const playerProbeHint = $('#playerProbeHint');
  const playerNotice = $('#playerNotice');
  const playerNoticeTitle = $('#playerNoticeTitle');
  const playerNoticeText = $('#playerNoticeText');
  const playerNoticeDownload = $('#playerNoticeDownload');
  const playerForcePlayBtn = $('#playerForcePlay');

  const state = {
    folders: [],
    videos: [],
    savePath: '',
    currentFolder: null,
    currentFolderPath: null,
    loading: false,
    page: 1,
    viewToken: 0
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

  // ---------- MP4 编码解析 ----------

  const CODEC_FOURCC = [
    ['hvc1', 'h265'], ['hev1', 'h265'], ['hvc2', 'h265'], ['hev2', 'h265'],
    ['avc1', 'h264'], ['avc3', 'h264'], ['avc4', 'h264'],
    ['av01', 'av1'], ['vp09', 'vp9'], ['mp4v', 'other']
  ];

  function readU32(bytes, offset) {
    if (offset < 0 || offset + 4 > bytes.length) return 0;
    return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
  }

  function fourCC(bytes, offset) {
    if (offset < 0 || offset + 4 > bytes.length) return '';
    return String.fromCharCode(bytes[offset], bytes[offset + 1],
      bytes[offset + 2], bytes[offset + 3]);
  }

  function codecFromFourCC(cc) {
    for (let i = 0; i < CODEC_FOURCC.length; i++) {
      if (CODEC_FOURCC[i][0] === cc) return CODEC_FOURCC[i][1];
    }
    return null;
  }

  function findFourCC(bytes, cc) {
    const first = cc.charCodeAt(0);
    for (let i = 0; i + 4 <= bytes.length; i++) {
      if (bytes[i] === first && fourCC(bytes, i) === cc) return i;
    }
    return -1;
  }

  // stsd 的 sample entry 保存真实编码；moov 可能在文件头(fMP4/faststart)或文件尾
  function parseMp4Codec(buffer) {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    for (let i = 0; i + 12 <= bytes.length; i++) {
      if (bytes[i] !== 0x73 || fourCC(bytes, i) !== 'stsd') continue;
      const count = Math.min(readU32(bytes, i + 8), 16);
      let entry = i + 12;
      for (let n = 0; n < count && entry + 8 <= bytes.length; n++) {
        const codec = codecFromFourCC(fourCC(bytes, entry + 4));
        if (codec) return codec;
        const size = readU32(bytes, entry);
        if (size < 8) break;
        entry += size;
      }
    }
    // stsd 被截断时退化为扫描，要求 4CC 前是合理的 sample entry 长度
    for (let i = 0; i < CODEC_FOURCC.length; i++) {
      const cc = CODEC_FOURCC[i][0];
      const offset = findFourCC(bytes, cc);
      if (offset < 4) continue;
      const size = readU32(bytes, offset - 4);
      if (size >= 8 && size <= 4096) return CODEC_FOURCC[i][1];
    }
    return 'unknown';
  }

  // ---------- 编码信息 ----------

  const PROBE_SIZE = 32 * 1024;
  const codecCache = new Map();
  const probeQueue = [];
  const MAX_CONCURRENT_PROBES = 2;
  let activeProbes = 0;
  let capabilityProbe = null;

  function codecLabel(codec) {
    const labels = {
      h264: 'H.264', h265: 'H.265', av1: 'AV1', vp9: 'VP9',
      other: '其他', unknown: '未知'
    };
    return labels[codec] || '未知';
  }

  function isMp4Container(name) {
    return /\.(mp4|m4v|mov)$/i.test(name || '');
  }

  function browserPlays(codec) {
    if (!codec || codec === 'unknown' || codec === 'other') return true;
    if (typeof document === 'undefined') return true;
    if (!capabilityProbe) capabilityProbe = document.createElement('video');
    if (typeof capabilityProbe.canPlayType !== 'function') return true;
    let types;
    if (codec === 'h265') {
      types = ['video/mp4; codecs="hvc1.1.6.L93.B0"',
        'video/mp4; codecs="hev1.1.6.L93.B0"',
        'video/mp4; codecs="hvc1"', 'video/mp4; codecs="hev1"'];
    } else if (codec === 'h264') {
      types = ['video/mp4; codecs="avc1.42E01E"', 'video/mp4'];
    } else if (codec === 'av1') {
      types = ['video/mp4; codecs="av01.0.05M.08"'];
    } else {
      types = ['video/webm; codecs="vp9"'];
    }
    return types.some(type => !!capabilityProbe.canPlayType(type));
  }

  function codecBadgeHtml(codec) {
    const tone = codec === 'h264' ? 'text-bg-info'
      : codec === 'h265' ? 'text-bg-warning'
        : codec === 'unknown' ? 'text-bg-secondary' : 'text-bg-primary';
    // canPlayType 声称支持 HEVC 时也可能只播音频，故对 H.265 一律给出兼容性提示
    const warning = codec === 'h265'
      ? '<i class="bi bi-exclamation-triangle-fill ms-1" title="H.265 兼容性取决于浏览器，若只有声音请下载播放"></i>'
      : '';
    return `<span class="badge ${tone}">${codecLabel(codec)}</span>${warning}`;
  }

  function playUrl(video) {
    return `${API_URL}?play=${encodePath(video.path)}`;
  }

  function downloadUrl(video) {
    return `${API_URL}?dl=${encodePath(video.path)}`;
  }

  // ---------- 编码探测 ----------

  // 优先用 Range 让服务端只返回文件头/尾片段；若服务端忽略 Range
  // （例如 busybox httpd 不透传该头），只消费前 limit 字节就取消响应流，
  // 避免把整段录像读进内存。
  async function fetchRangePrefix(url, range, limit) {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), 8000) : null;
    try {
      const options = { headers: { Range: range } };
      if (controller) options.signal = controller.signal;
      const response = await fetch(url, options);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (!response.body || typeof response.body.getReader !== 'function') {
        return (await response.arrayBuffer()).slice(0, limit);
      }
      const reader = response.body.getReader();
      const chunks = [];
      let total = 0;
      let done = false;
      try {
        while (!done && total < limit) {
          const part = await reader.read();
          done = part.done;
          if (part.value) {
            chunks.push(part.value);
            total += part.value.length;
          }
        }
      } finally {
        if (!done) {
          try { await reader.cancel(); } catch (err) { /* 流已关闭 */ }
        } else if (reader.releaseLock) {
          reader.releaseLock();
        }
      }
      const merged = new Uint8Array(Math.min(total, limit));
      let offset = 0;
      for (let i = 0; i < chunks.length && offset < merged.length; i++) {
        const take = Math.min(chunks[i].length, merged.length - offset);
        merged.set(chunks[i].subarray(0, take), offset);
        offset += take;
      }
      return merged;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function detectCodec(video) {
    if (!isMp4Container(video.name)) return 'unknown';
    try {
      const head = await fetchRangePrefix(playUrl(video), `bytes=0-${PROBE_SIZE - 1}`, PROBE_SIZE);
      const codec = parseMp4Codec(head);
      if (codec !== 'unknown') return codec;
      // moov 位于文件尾的 MP4：再取尾部片段
      const tailSize = PROBE_SIZE * 2;
      const tail = await fetchRangePrefix(playUrl(video), `bytes=-${tailSize}`, tailSize);
      return parseMp4Codec(tail);
    } catch (err) {
      return 'unknown';
    }
  }

  function getCodec(video) {
    if (!codecCache.has(video.path)) {
      codecCache.set(video.path, detectCodec(video).catch(() => 'unknown'));
    }
    return codecCache.get(video.path);
  }

  function updateCodecCell(video, codec) {
    const rows = tableBody.querySelectorAll('tr[data-video-path]');
    rows.forEach(row => {
      if (row.getAttribute('data-video-path') !== video.path) return;
      const cell = row.querySelector('.codec-cell');
      if (cell) cell.innerHTML = codecBadgeHtml(codec);
    });
  }

  function pumpCodecProbes() {
    while (activeProbes < MAX_CONCURRENT_PROBES && probeQueue.length) {
      const job = probeQueue.shift();
      activeProbes += 1;
      getCodec(job.video).then(codec => {
        if (job.token === state.viewToken) updateCodecCell(job.video, codec);
      }).finally(() => {
        activeProbes -= 1;
        pumpCodecProbes();
      });
    }
  }

  function probeVisibleCodecs() {
    const token = state.viewToken;
    const start = (state.page - 1) * PAGE_SIZE;
    state.videos.slice(start, start + PAGE_SIZE).forEach(video => {
      if (!isMp4Container(video.name)) {
        updateCodecCell(video, 'unknown');
        return;
      }
      const cached = codecCache.get(video.path);
      if (cached) {
        cached.then(codec => {
          if (token === state.viewToken) updateCodecCell(video, codec);
        });
      } else {
        probeQueue.push({ video, token });
      }
    });
    pumpCodecProbes();
  }

  function resetCodecProbes() {
    probeQueue.length = 0;
    state.viewToken += 1;
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
        <th scope="col">编码</th>
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
      tr.setAttribute('data-video-path', video.path);

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

      const codecCell = document.createElement('td');
      codecCell.className = 'codec-cell';
      codecCell.innerHTML = '<span class="badge text-bg-secondary opacity-75">检测中…</span>';
      tr.appendChild(codecCell);

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
      downloadBtn.href = downloadUrl(video);
      downloadBtn.className = 'btn btn-sm btn-outline-secondary';
      downloadBtn.innerHTML = '<i class="bi bi-download"></i>';
      downloadBtn.title = '下载';
      downloadBtn.setAttribute('download', video.name);
      actionCell.appendChild(downloadBtn);

      tr.appendChild(actionCell);
      tableBody.appendChild(tr);
    });

    updatePagination(total, totalPages);
    probeVisibleCodecs();
  }

  // ---------- 播放器 ----------

  // 浏览器可能只解码音频、静默丢弃 H.265 视频轨：不触发 error，canPlayType
  // 也可能声称支持。因此以实际解码出的视频帧作为能否播放的最终判据。
  const FRAME_CHECK_DELAY = 3000;
  let activeVideo = null;
  let activeCodec = 'unknown';
  let playerToken = 0;
  let frameWatchdogTimer = null;
  let forcePlayUsed = false;

  function clearFrameWatchdog() {
    if (frameWatchdogTimer) {
      clearTimeout(frameWatchdogTimer);
      frameWatchdogTimer = null;
    }
  }

  function hasVideoFrame() {
    if (playerEl.videoWidth > 0 && playerEl.videoHeight > 0) return true;
    if (typeof playerEl.getVideoPlaybackQuality === 'function') {
      return playerEl.getVideoPlaybackQuality().totalVideoFrames > 0;
    }
    return false;
  }

  function scheduleFrameWatchdog(token, retry = 1) {
    clearFrameWatchdog();
    frameWatchdogTimer = setTimeout(() => {
      frameWatchdogTimer = null;
      if (token !== playerToken || !activeVideo) return;
      if (!playerEl.getAttribute('src') || playerEl.paused) return;
      if (hasVideoFrame()) return;
      // 数据尚未就绪时再给一次机会，避免慢加载被误判
      if (playerEl.readyState < 2 || playerEl.currentTime < 0.2) {
        if (retry > 0) scheduleFrameWatchdog(token, retry - 1);
        return;
      }
      const codecHint = activeCodec === 'h265'
        ? '该录像使用 H.265 / HEVC 编码，浏览器只播放了音频、未解码出视频画面。'
        : '浏览器只播放了音频、未解码出视频画面。';
      hidePlayerVideo();
      showPlayerNotice(
        '视频画面无法解码',
        `${codecHint}请下载后用 VLC、PotPlayer 等播放器打开；如需在网页中直接播放，可把人形检测录制流的编码改为 H.264。`,
        !forcePlayUsed
      );
      playerProbeHint.textContent = '浏览器未能解码视频轨';
    }, FRAME_CHECK_DELAY);
  }

  function hidePlayerVideo() {
    clearFrameWatchdog();
    playerEl.pause();
    playerEl.removeAttribute('src');
    playerEl.load();
    playerEl.classList.add('d-none');
  }

  function showPlayerNotice(title, text, allowRetry) {
    clearFrameWatchdog();
    playerNoticeTitle.textContent = title;
    playerNoticeText.textContent = text;
    playerForcePlayBtn.classList.toggle('d-none', !allowRetry);
    playerNotice.classList.remove('d-none');
    playerEl.classList.add('d-none');
  }

  function startPlayback() {
    if (!activeVideo) return;
    playerNotice.classList.add('d-none');
    playerEl.classList.remove('d-none');
    playerEl.src = playUrl(activeVideo);
    const promise = playerEl.play();
    if (promise && typeof promise.catch === 'function') promise.catch(() => {});
    scheduleFrameWatchdog(playerToken);
  }

  function applyCodecToPlayer(codec) {
    activeCodec = codec;
    playerCodecBadge.textContent = codecLabel(codec);
    playerCodecBadge.className = 'badge ' + (codec === 'h264' ? 'text-bg-info'
      : codec === 'h265' ? 'text-bg-warning'
        : codec === 'unknown' ? 'text-bg-secondary' : 'text-bg-primary');
    playerProbeHint.textContent = codec === 'unknown' ? '未能识别编码，仍会尝试播放' : '';
  }

  function showVideoPlayer(video) {
    const token = ++playerToken;
    activeVideo = video;
    activeCodec = 'unknown';
    forcePlayUsed = false;
    clearFrameWatchdog();
    playerModalLabel.textContent = video.name;

    const dl = downloadUrl(video);
    [playerModalDownload, playerNoticeDownload].forEach(link => {
      link.href = dl;
      link.setAttribute('download', video.name);
    });

    hidePlayerVideo();
    playerNotice.classList.add('d-none');
    playerForcePlayBtn.classList.add('d-none');
    playerCodecBadge.textContent = '检测中…';
    playerCodecBadge.className = 'badge text-bg-secondary';
    playerProbeHint.textContent = '正在检测视频编码…';

    bootstrap.Modal.getOrCreateInstance(playerModalEl).show();
    // 保持在用户手势内启动播放，兼容浏览器的自动播放策略
    startPlayback();

    getCodec(video).then(codec => {
      if (token !== playerToken) return;
      applyCodecToPlayer(codec);
      if (codec === 'h265' && !browserPlays('h265')) {
        hidePlayerVideo();
        showPlayerNotice(
          '当前浏览器不支持 H.265 视频',
          '该录像使用 H.265 / HEVC 编码，浏览器无法直接解码。请下载后用 VLC、PotPlayer 等支持 H.265 的播放器打开，或换用支持该编码的浏览器；也可以在设置中把录制流改为 H.264。',
          true
        );
      }
    });
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
    resetCodecProbes();
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
    resetCodecProbes();
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
      resetCodecProbes();
      renderVideos();
    }
  });

  nextPageBtn.addEventListener('click', (e) => {
    e.preventDefault();
    const totalPages = Math.max(1, Math.ceil(state.videos.length / PAGE_SIZE));
    if (state.page < totalPages) {
      state.page += 1;
      resetCodecProbes();
      renderVideos();
    }
  });

  playerForcePlayBtn.addEventListener('click', () => {
    forcePlayUsed = true;
    startPlayback();
  });

  // 手动点播放、或自动播放被拒后恢复播放时重新计时
  playerEl.addEventListener('playing', () => {
    if (activeVideo) scheduleFrameWatchdog(playerToken);
  });

  // 媒体元素显式报错时的兜底（仅音频的假播放不会走这里，由帧看门狗处理）
  playerEl.addEventListener('error', () => {
    if (!activeVideo || !playerEl.getAttribute('src')) return;
    if (!playerModalEl.classList.contains('show')) return;
    hidePlayerVideo();
    showPlayerNotice(
      '视频无法播放',
      '浏览器未能解码该视频。若录像是 H.265 / HEVC 编码，请下载后用 VLC、PotPlayer 等播放器打开，或改用支持该编码的浏览器。',
      false
    );
  });

  playerModalEl.addEventListener('hidden.bs.modal', () => {
    clearFrameWatchdog();
    playerToken += 1;
    activeVideo = null;
    hidePlayerVideo();
    playerNotice.classList.add('d-none');
  });

  loadFolders();
})();
