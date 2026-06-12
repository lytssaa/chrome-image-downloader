// preview.js - 独立窗口图片预览
(() => {
  'use strict';

  const img = document.getElementById('previewImg');
  const counter = document.getElementById('counter');
  const dimensions = document.getElementById('dimensions');
  const formatBadge = document.getElementById('formatBadge');
  const prevBtn = document.getElementById('prevBtn');
  const nextBtn = document.getElementById('nextBtn');
  const closeBtn = document.getElementById('closeBtn');
  const openTabBtn = document.getElementById('openTabBtn');
  const downloadBtn = document.getElementById('downloadBtn');

  // 从 chrome.storage.session 读取数据（由 popup 写入）
  let images = [];
  let currentIndex = 0;

  chrome.storage.session.get('previewData').then((data) => {
    if (data.previewData) {
      images = data.previewData.images || [];
      currentIndex = data.previewData.index || 0;
    }
    if (images.length > 0) {
      showImage(currentIndex);
    } else {
      document.body.innerHTML = '<div style="color:#fff;font-size:18px;">没有可预览的图片</div>';
    }
  });

  function showImage(index) {
    const imgData = images[index];
    if (!imgData) return;

    // 显示加载中
    img.style.opacity = '0';

    // 等图片加载完成后显示
    img.onload = () => {
      img.style.opacity = '1';
      dimensions.textContent = `${img.naturalWidth} × ${img.naturalHeight} px`;
    };
    img.onerror = () => {
      img.style.opacity = '1';
      dimensions.textContent = '加载失败';
    };

    img.src = imgData.url;

    counter.textContent = `${index + 1} / ${images.length}`;
    formatBadge.textContent = (imgData.format || 'unknown').toUpperCase();
    formatBadge.style.display = imgData.format && imgData.format !== 'unknown' ? 'inline' : 'none';

    currentIndex = index;
    prevBtn.disabled = index <= 0;
    nextBtn.disabled = index >= images.length - 1;

    // 更新窗口标题
    document.title = `图片预览 (${index + 1}/${images.length})`;
  }

  // 上一张
  function prevImage() {
    if (currentIndex > 0) showImage(currentIndex - 1);
  }

  // 下一张
  function nextImage() {
    if (currentIndex < images.length - 1) showImage(currentIndex + 1);
  }

  // 关闭窗口
  function closePreview() {
    window.close();
  }

  // 键盘快捷键
  document.addEventListener('keydown', (e) => {
    switch (e.key) {
      case 'Escape': closePreview(); break;
      case 'ArrowLeft': prevImage(); break;
      case 'ArrowRight': nextImage(); break;
    }
  });

  // 事件绑定
  closeBtn.addEventListener('click', closePreview);
  prevBtn.addEventListener('click', prevImage);
  nextBtn.addEventListener('click', nextImage);

  openTabBtn.addEventListener('click', () => {
    const imgData = images[currentIndex];
    if (imgData) chrome.tabs.create({ url: imgData.url });
  });

  downloadBtn.addEventListener('click', async () => {
    const imgData = images[currentIndex];
    if (!imgData) return;

    const namePart = imgData.url.split('/').pop()?.split('?')[0]?.split('#')[0] || `image_${currentIndex + 1}`;
    const cleanName = namePart.replace(/[^a-zA-Z0-9_\-\.]/g, '_');
    const fmt = imgData.format || cleanName.split('.').pop() || 'jpg';
    const finalName = cleanName.includes('.') ? cleanName : `${cleanName}.${fmt}`;

    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const pageUrl = tabs[0]?.url || '';

      const resp = await chrome.runtime.sendMessage({
        action: 'batchDownload',
        items: [{ url: imgData.url, filename: finalName }],
        pageUrl
      });

      if (resp?.success) {
        downloadBtn.textContent = '✓ 已下载';
        setTimeout(() => { downloadBtn.textContent = '⬇ 下载'; }, 2000);
      } else {
        throw new Error(resp?.error || '下载失败');
      }
    } catch (e) {
      console.error('下载失败:', e);
      downloadBtn.textContent = '✗ 失败';
      setTimeout(() => { downloadBtn.textContent = '⬇ 下载'; }, 2000);
    }
  });

  // 启动：显示当前图片
  if (images.length > 0) {
    showImage(currentIndex);
  } else {
    document.body.innerHTML = '<div style="color:#fff;font-size:18px;">没有可预览的图片</div>';
  }
})();
