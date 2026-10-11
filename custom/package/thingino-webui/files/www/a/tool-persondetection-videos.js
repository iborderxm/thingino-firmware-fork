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
  const playerEl = $('#player');
  const playerModalLabel = $('#playerModalLabel');
  const playerModalDownload = $('#playerModalDownload');

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

  function showVideoPlayer(video) {
    playerModalLabel.textContent = video.name;
    playerModalDownload.href = `${API_URL}?dl=${encodePath(video.path)}`;
    playerModalDownload.setAttribute('download', video.name);
    playerEl.src = `${API_URL}?play=${encodePath(video.path)}`;

    bootstrap.Modal.getOrCreateInstance(playerModalEl).show();
    playerEl.play().catch(() => {});
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

  playerModalEl.addEventListener('hidden.bs.modal', () => {
    playerEl.pause();
    playerEl.removeAttribute('src');
    playerEl.load();
  });

  loadFolders();
})();
