// preview.js - 独立窗口图片预览（含缩放 + 拖拽平移）
(() => {
  'use strict';

  // ===== DOM =====
  const img = document.getElementById('previewImg');
  const imgWrap = document.getElementById('imgWrap');
  const container = document.getElementById('imageContainer');
  const counter = document.getElementById('counter');
  const dimensions = document.getElementById('dimensions');
  const formatBadge = document.getElementById('formatBadge');
  const prevBtn = document.getElementById('prevBtn');
  const nextBtn = document.getElementById('nextBtn');
  const closeBtn = document.getElementById('closeBtn');
  const openTabBtn = document.getElementById('openTabBtn');
  const downloadBtn = document.getElementById('downloadBtn');
  const zoomBadge = document.getElementById('zoomBadge');
  const zoomResetBtn = document.getElementById('zoomResetBtn');

  // ===== 从 URL 参数读取数据 =====
  let images = [];
  let currentIndex = 0;
  try {
    const data = new URLSearchParams(location.search).get('data');
    if (data) {
      const parsed = JSON.parse(decodeURIComponent(data));
      images = parsed.images || [];
      currentIndex = parsed.index || 0;
    }
  } catch (e) { console.error('读取预览数据失败:', e); }

  // ===== 缩放 + 拖拽 =====
  let zoomLevel = 1;
  let isDragging = false;
  let dragStartX = 0, dragStartY = 0;
  let panX = 0, panY = 0;
  let zoomBadgeTimer = null;

  const MIN_ZOOM = 0.25;
  const MAX_ZOOM = 10;
  const ZOOM_STEP = 0.1;

  // 通过 transform: translate(panX, panY) scale(zoomLevel) 实现
  // 利用 flex 居中 + transform-origin: center，缩放从图片中心展开
  function applyZoom() {
    const pct = Math.round(zoomLevel * 100);
    if (zoomLevel <= 1) {
      panX = 0;
      panY = 0;
    }
    imgWrap.style.transform = `translate(${panX}px, ${panY}px) scale(${zoomLevel})`;
    zoomResetBtn.style.display = zoomLevel !== 1 ? '' : 'none';
    showZoomBadge(pct + '%');
  }

  function resetZoom() {
    zoomLevel = 1;
    panX = 0;
    panY = 0;
    imgWrap.style.transform = '';
    zoomResetBtn.style.display = 'none';
    showZoomBadge('100%');
  }

  function showZoomBadge(text) {
    zoomBadge.textContent = text;
    zoomBadge.classList.add('show');
    clearTimeout(zoomBadgeTimer);
    zoomBadgeTimer = setTimeout(() => zoomBadge.classList.remove('show'), 1000);
  }

  // ===== 显示图片 =====
  function showImage(index) {
    const imgData = images[index];
    if (!imgData) return;
    resetZoom();
    img.style.opacity = '0';
    img.onload = () => { img.style.opacity = '1'; dimensions.textContent = `${img.naturalWidth} × ${img.naturalHeight} px`; };
    img.onerror = () => { img.style.opacity = '1'; dimensions.textContent = '加载失败'; };
    img.src = imgData.url;
    counter.textContent = `${index + 1} / ${images.length}`;
    formatBadge.textContent = (imgData.format || 'unknown').toUpperCase();
    formatBadge.style.display = imgData.format && imgData.format !== 'unknown' ? 'inline' : 'none';
    currentIndex = index;
    prevBtn.disabled = index <= 0;
    nextBtn.disabled = index >= images.length - 1;
    document.title = `图片预览 (${index + 1}/${images.length})`;
  }

  // ===== 鼠标滚轮缩放 =====
  container.addEventListener('wheel', (e) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
      zoomLevel = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoomLevel + delta));
      zoomLevel = Math.round(zoomLevel * 20) / 20; // 保留 0.05 精度
      applyZoom();
    }
  }, { passive: false });

  // ===== 拖拽平移 =====
  container.addEventListener('mousedown', (e) => {
    if (zoomLevel === 1) return;
    isDragging = true;
    dragStartX = e.clientX - panX;
    dragStartY = e.clientY - panY;
    container.classList.add('dragging');
  });

  window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    panX = e.clientX - dragStartX;
    panY = e.clientY - dragStartY;
    applyZoom();
  });

  window.addEventListener('mouseup', () => {
    isDragging = false;
    container.classList.remove('dragging');
  });

  // ===== 双击还原 =====
  img.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    resetZoom();
  });

  // ===== 按钮事件 =====
  closeBtn.addEventListener('click', () => window.close());
  prevBtn.addEventListener('click', () => { if (currentIndex > 0) showImage(currentIndex - 1); });
  nextBtn.addEventListener('click', () => { if (currentIndex < images.length - 1) showImage(currentIndex + 1); });
  zoomResetBtn.addEventListener('click', resetZoom);

  openTabBtn.addEventListener('click', () => {
    const d = images[currentIndex];
    if (d) chrome.tabs.create({ url: d.url });
  });

  downloadBtn.addEventListener('click', async () => {
    const d = images[currentIndex];
    if (!d) return;
    const name = (d.url.split('/').pop()?.split('?')[0]?.split('#')[0] || 'image').replace(/[^a-zA-Z0-9_\-\.]/g, '_');
    const fmt = d.format || name.split('.').pop() || 'jpg';
    const finalName = name.includes('.') ? name : `${name}.${fmt}`;

    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const pageUrl = tabs[0]?.url || '';
      const resp = await chrome.runtime.sendMessage({
        action: 'batchDownload',
        items: [{ url: d.url, filename: finalName }],
        pageUrl
      });
      if (resp?.success) {
        downloadBtn.textContent = '✓ 已下载';
        setTimeout(() => { downloadBtn.textContent = '⬇ 下载'; }, 2000);
      }
    } catch (e) {
      downloadBtn.textContent = '✗ 失败';
      setTimeout(() => { downloadBtn.textContent = '⬇ 下载'; }, 2000);
    }
  });

  // ===== 键盘快捷键 =====
  document.addEventListener('keydown', (e) => {
    switch (e.key) {
      case 'Escape': window.close(); break;
      case 'ArrowLeft': prevBtn.click(); break;
      case 'ArrowRight': nextBtn.click(); break;
      case '0': resetZoom(); break;
    }
    // Ctrl+滚轮已经有浏览器默认行为，不用额外处理
  });

  // ===== 启动 =====
  if (images.length > 0) {
    requestAnimationFrame(() => showImage(currentIndex));
  } else {
    document.body.innerHTML = '<div style="color:#fff;font-size:18px;padding:40px;text-align:center;">没有可预览的图片</div>';
  }
})();
