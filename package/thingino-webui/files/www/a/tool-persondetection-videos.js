(function() {
  const API_URL = '/x/tool-persondetection-videos.cgi';
  const tableBody = document.querySelector('#videoTable tbody');
  const emptyState = $('#emptyState');
  const loadingState = $('#loadingState');
  const refreshBtn = $('#btnRefresh');
  const openFileManagerBtn = $('#btnOpenFileManager');
  const pathInfoText = $('#pathInfoText');
  const playerModalEl = $('#playerModal');
  const playerEl = $('#player');
  const playerModalLabel = $('#playerModalLabel');
  const playerModalDownload = $('#playerModalDownload');

  const state = {
    videos: [],
    savePath: '',
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

  function showVideoPlayer(video) {
    playerModalLabel.textContent = video.name;
    playerModalDownload.href = `/x/tool-persondetection-videos.cgi?dl=${encodePath(video.path)}`;
    playerModalDownload.download = video.name;
    playerEl.src = `/x/tool-persondetection-videos.cgi?play=${encodePath(video.path)}`;

    new bootstrap.Modal(playerModalEl).show();
    playerEl.play().catch(() => {});
  }

  function renderVideos(videos) {
    tableBody.innerHTML = '';
    if (!videos || !videos.length) {
      emptyState.classList.remove('d-none');
      return;
    }
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

      const sizeCell = document.createElement('td');
      sizeCell.className = 'text-end';
      sizeCell.textContent = formatFileSize(video.size);
      tr.appendChild(sizeCell);

      const dateCell = document.createElement('td');
      dateCell.textContent = formatDate(video.time);
      tr.appendChild(dateCell);

      const durationCell = document.createElement('td');
      durationCell.className = 'text-end';
      durationCell.textContent = formatDuration(video.duration);
      tr.appendChild(durationCell);

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
  }

  async function loadVideos() {
    if (state.loading) return;
    state.loading = true;
    loadingState.classList.remove('d-none');
    emptyState.classList.add('d-none');

    try {
      const response = await fetch(API_URL, {
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

  refreshBtn.addEventListener('click', loadVideos);

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

  loadVideos();
})();
