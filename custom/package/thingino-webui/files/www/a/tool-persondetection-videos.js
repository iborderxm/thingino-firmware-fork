(function() {
  const API_URL = '/x/tool-persondetection-videos.cgi';
  const tableBody = document.querySelector('#videoTable tbody');
  const tableHead = document.querySelector('#tableHead');
  const emptyState = $('#emptyState');
  const loadingState = $('#loadingState');
  const refreshBtn = $('#btnRefresh');
  const openFileManagerBtn = $('#btnOpenFileManager');
  const pathInfoText = $('#pathInfoText');
  const breadcrumb = $('#breadcrumb');
  const breadcrumbRoot = $('#breadcrumbRoot');
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
    loading: false
  };

  function encodePath(path) {
    return encodeURIComponent(path);
  }

  function formatFileSize(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  function formatDuration(seconds) {
    if (!seconds || seconds === 0) return '-';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) {
      return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  function formatDate(timestamp) {
    if (!timestamp) return '-';
    const date = new Date(timestamp * 1000);
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  }

  function formatFolderDate(timestamp) {
    if (!timestamp) return '-';
    const date = new Date(timestamp * 1000);
    return date.toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
  }

  function showVideoPlayer(video) {
    playerModalLabel.textContent = video.name;
    playerModalDownload.href = `/x/tool-persondetection-videos.cgi?dl=${encodePath(video.path)}`;
    playerModalDownload.download = video.name;
    playerEl.src = `/x/tool-persondetection-videos.cgi?play=${encodePath(video.path)}`;

    new bootstrap.Modal(playerModalEl).show();
    playerEl.play().catch(() => {});
  }

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
    if (isFolderView) {
      tableHead.innerHTML = `
        <tr>
          <th scope="col">文件夹名称</th>
          <th scope="col" class="text-end">操作</th>
        </tr>
      `;
    } else {
      tableHead.innerHTML = `
        <tr>
          <th scope="col">文件名</th>
          <th scope="col" class="text-end">操作</th>
        </tr>
      `;
    }
  }

  function renderFolders(folders) {
    console.log('renderFolders called with folders:', folders);
    tableBody.innerHTML = '';
    if (!folders || !folders.length) {
      console.log('No folders found, showing empty state');
      emptyState.classList.remove('d-none');
      emptyState.querySelector('p').textContent = '未找到日期文件夹。';
      return;
    }
    console.log('Folders found, hiding empty state');
    emptyState.classList.add('d-none');

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
    console.log('Rendered', folders.length, 'folders');
  }

  function renderVideos(videos) {
    console.log('renderVideos called with videos:', videos);
    tableBody.innerHTML = '';
    if (!videos || !videos.length) {
      console.log('No videos found, showing empty state');
      emptyState.classList.remove('d-none');
      emptyState.querySelector('p').textContent = '未找到人形检测视频。';
      return;
    }
    console.log('Videos found, hiding empty state');
    emptyState.classList.add('d-none');

    videos.forEach(video => {
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
      downloadBtn.href = `/x/tool-persondetection-videos.cgi?dl=${encodePath(video.path)}`;
      downloadBtn.className = 'btn btn-sm btn-outline-secondary';
      downloadBtn.innerHTML = '<i class="bi bi-download"></i>';
      downloadBtn.title = '下载';
      downloadBtn.download = video.name;
      actionCell.appendChild(downloadBtn);

      tr.appendChild(actionCell);
      tableBody.appendChild(tr);
    });
    console.log('Rendered', videos.length, 'videos');
  }

  async function loadFolders() {
    if (state.loading) return;
    state.loading = true;
    loadingState.classList.remove('d-none');
    emptyState.classList.add('d-none');
    state.currentFolder = null;
    state.currentFolderPath = null;

    try {
      const response = await fetch(API_URL, {
        headers: { 'Accept': 'application/json' }
      });
      const payload = await response.json();

      console.log('Response status:', response.status);
      console.log('Response payload:', payload);

      if (!response.ok || (payload && payload.error)) {
        const message = payload && payload.error ? payload.error.message : `Request failed with status ${response.status}`;
        throw new Error(message || 'Unable to load folders');
      }

      state.folders = payload.folders || [];
      state.savePath = payload.save_path || '';

      console.log('state.folders:', state.folders);
      console.log('state.folders.length:', state.folders.length);

      if (state.savePath) {
        pathInfoText.textContent = `保存路径: ${state.savePath}`;
      } else {
        pathInfoText.textContent = '未配置保存路径';
      }

      updateTableHead(true);
      updateBreadcrumb();
      renderFolders(state.folders);
    } catch (error) {
      console.error('Error loading folders:', error);
      showAlert('danger', error.message || 'Unable to load folders');
      emptyState.classList.remove('d-none');
      emptyState.querySelector('p').textContent = `加载失败: ${error.message}`;
    } finally {
      loadingState.classList.add('d-none');
      state.loading = false;
    }
  }

  async function loadVideosInFolder(folderPath, folderName) {
    if (state.loading) return;
    state.loading = true;
    loadingState.classList.remove('d-none');
    emptyState.classList.add('d-none');
    state.currentFolder = folderName;
    state.currentFolderPath = folderPath;

    try {
      const url = `${API_URL}?folder=${encodePath(folderPath)}`;
      const response = await fetch(url, {
        headers: { 'Accept': 'application/json' }
      });
      const payload = await response.json();

      if (!response.ok || (payload && payload.error)) {
        const message = payload && payload.error ? payload.error.message : `Request failed with status ${response.status}`;
        throw new Error(message || 'Unable to load videos');
      }

      state.videos = payload.videos || [];
      state.savePath = payload.save_path || '';

      if (state.savePath) {
        pathInfoText.textContent = `保存路径: ${state.savePath}`;
      } else {
        pathInfoText.textContent = '未配置保存路径';
      }

      updateTableHead(false);
      updateBreadcrumb();
      renderVideos(state.videos);
    } catch (error) {
      showAlert('danger', error.message || 'Unable to load videos');
      emptyState.classList.remove('d-none');
      emptyState.querySelector('p').textContent = `加载失败: ${error.message}`;
    } finally {
      loadingState.classList.add('d-none');
      state.loading = false;
    }
  }

  refreshBtn.addEventListener('click', () => {
    if (state.currentFolder) {
      loadVideosInFolder(state.currentFolderPath, state.currentFolder);
    } else {
      loadFolders();
    }
  });

  openFileManagerBtn.addEventListener('click', () => {
    if (state.savePath) {
      const normalized = state.savePath.startsWith('/') ? state.savePath : `/${state.savePath}`;
      const url = normalized === '/' ? '/tool-file-manager.html' : `/tool-file-manager.html?cd=${encodeURIComponent(normalized)}`;
      window.location.href = url;
    } else {
      showAlert('warning', '未配置保存路径，无法打开文件管理器');
    }
  });

  playerModalEl.addEventListener('hidden.bs.modal', () => {
    playerEl.pause();
    playerEl.removeAttribute('src');
    playerEl.load();
  });

  loadFolders();
})();
