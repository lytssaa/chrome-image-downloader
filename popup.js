// popup.js - 网页图片下载器 主逻辑
(() => {
  'use strict';

  // ===== 状态 =====
  let allImages = [];
  let selectedIndices = new Set();
  let currentFilter = { format: 'all', minWidth: 0, minHeight: 0 };

  // ===== DOM 引用 =====
  const $ = (id) => document.getElementById(id);
  const contentArea = $('contentArea');
  const totalCount = $('totalCount');
  const selectedInfo = $('selectedInfo');
  const downloadBtn = $('downloadBtn');
  const selectAllBtn = $('selectAllBtn');
  const deselectAllBtn = $('deselectAllBtn');
  const filterFormat = $('filterFormat');
  const minWidth = $('minWidth');
  const minHeight = $('minHeight');
  const toast = $('toast');
  const refreshBtn = $('refreshBtn');


  // ===== Toast 提示 =====
  let toastTimer = null;
  function showToast(msg, duration = 2000) {
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), duration);
  }

  // ===== 提取图片（注入到目标页面执行） =====
  async function extractImages() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) {
      showStatus('error', '❌', '未找到活动标签页');
      return;
    }

    // 检查受限页面
    if (!tab.url || /^chrome:\/\/|chrome-extension:\/\/|about:|edge:\/\/|view-source:/.test(tab.url)) {
      showStatus('error', '🔒', '此页面不支持扩展运行');
      return;
    }

    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: extractImagesFromPage,
      });

      const rawImages = results?.[0]?.result || [];
      if (!Array.isArray(rawImages) || rawImages.length === 0) {
        showStatus('empty', '📭', '未在页面中找到图片');
        return;
      }

      // 去重（按 URL）
      const seen = new Set();
      allImages = rawImages.filter((img) => {
        if (!img?.url || seen.has(img.url)) return false;
        seen.add(img.url);
        return true;
      });

      if (allImages.length === 0) {
        showStatus('empty', '📭', '未找到有效图片');
        return;
      }

      renderImages();
    } catch (err) {
      console.error('提取失败:', err);
      showStatus('error', '❌', '提取图片失败: ' + err.message);
    }
  }

  // ---- 此函数在目标页面上下文中执行 ----
  function extractImagesFromPage() {
    const images = [];
    const seen = new Set();

    /** 判断 URL 是否能在弹窗中展示（过滤 blob: / chrome-extension: 等内部协议） */
    function isLoadableInPopup(url) {
      try {
        const u = new URL(url);
        // blob: 只能在创建它的文档中加载，扩展弹窗加载不了
        if (u.protocol === 'blob:') return false;
        // javascript: / data: 大 base64 / chrome-extension: 等也不行
        if (u.protocol === 'javascript:' || u.protocol === 'chrome-extension:' || u.protocol === 'file:') return false;
        return true;
      } catch {
        return false;
      }
    }

    /** 添加图片记录，去重 */
    function add(url, width, height, altText, sourceType) {
      if (!url || typeof url !== 'string') return;
      // 处理相对路径
      try {
        url = new URL(url, location.href).href;
      } catch {
        return;
      }
      if (seen.has(url)) return;
      // 过滤掉不符合条件的 URL
      if (!isLoadableInPopup(url)) return;
      seen.add(url);

      const fmt = url.match(/\.(\w+)(?:\?|#|$)/)?.[1]?.toLowerCase() || '';
      const formatMap = { jpg: 'jpg', jpeg: 'jpg', png: 'png', gif: 'gif', webp: 'webp', svg: 'svg', avif: 'avif', ico: 'ico' };
      const format = formatMap[fmt] || fmt || 'unknown';

      images.push({ url, width: width || 0, height: height || 0, alt: altText || '', format, source: sourceType || 'img' });
    }

    // 1. <img> 标签 —— 优先取加载完成后的实际尺寸
    document.querySelectorAll('img').forEach((img) => {
      let src = img.currentSrc || img.src || '';
      // 如果是空的或 data: 占位，看看有没有 data-src / data-lazy-src
      if (!src || src === '' || (img.dataset && (img.dataset.src || img.dataset.lazySrc || img.dataset.original))) {
        src = img.dataset?.src || img.dataset?.lazySrc || img.dataset?.original || img.src || '';
      }
      if (!src || src.startsWith('data:image/gif') || src === location.href) return;

      const w = img.naturalWidth || img.width || 0;
      const h = img.naturalHeight || img.height || 0;
      add(src, w, h, img.alt, 'img');
    });

    // 2. CSS background-image
    document.querySelectorAll('*').forEach((el) => {
      const style = window.getComputedStyle(el);
      const bg = style.backgroundImage;
      if (!bg || bg === 'none') return;
      const matches = bg.match(/url\(["']?([^"')]+)["']?\)/g);
      if (!matches) return;
      matches.forEach((m) => {
        const url = m.replace(/^url\(["']?|["']?\)$/g, '');
        if (!url || url.startsWith('data:')) return;
        const rect = el.getBoundingClientRect();
        add(url, Math.round(rect.width), Math.round(rect.height), 'background', 'css-bg');
      });
    });

    // 3. <picture> > <source>
    document.querySelectorAll('picture source').forEach((source) => {
      (source.srcset || '').split(',').forEach((entry) => {
        const url = entry.trim().split(/\s+/)[0];
        add(url, 0, 0, 'source', 'picture');
      });
    });

    // 4. 懒加载容器中的 data 属性
    document.querySelectorAll('[data-src][data-src*="."], [data-lazy][data-lazy*="."]').forEach((el) => {
      const src = el.dataset.src || el.dataset.lazy || '';
      if (src.match(/\.(jpe?g|png|gif|webp|svg|avif)(\?|#|$)/i)) {
        add(src, 0, 0, el.alt || '', 'lazy-data');
      }
    });

    return images;
  }

  // ===== 状态显示 =====
  function showStatus(type, icon, msg) {
    contentArea.innerHTML = `
      <div class="status">
        ${type === 'loading' ? '<div class="status-spinner"></div>' : `<div class="status-icon">${icon}</div>`}
        <h3>${msg}</h3>
      </div>
    `;
    totalCount.textContent = '0 张';
    updateFooter();
  }

  // ===== 渲染图片网格 =====
  function renderImages() {
    const filtered = getFilteredImages();
    if (filtered.length === 0) {
      contentArea.innerHTML = `
        <div class="status">
          <div class="status-icon">🔍</div>
          <h3>没有匹配的图片</h3>
          <p>共 ${allImages.length} 张，当前筛选无结果</p>
        </div>
      `;
      totalCount.textContent = `${allImages.length} 张`;
      updateFooter();
      return;
    }

    let html = '<div class="grid-wrap"><div class="grid">';
    filtered.forEach((img) => {
      const originalIndex = allImages.indexOf(img);
      const selected = selectedIndices.has(originalIndex);
      const dims = img.width && img.height ? `${img.width}×${img.height}` : '?×?';
      const fmtLabel = img.format !== 'unknown' ? img.format.toUpperCase() : '';
      const label = dims + (fmtLabel ? ' · ' + fmtLabel : '');

      html += `
        <div class="card ${selected ? 'selected' : ''}" data-index="${originalIndex}">
          <div class="card-placeholder" title="${escapeAttr(img.url)}"
               style="background:${placeholderColor(img.format)}">
            <div class="ph-icon">${placeholderIcon(img.format)}</div>
            <div class="ph-label">${escapeHtml(label)}</div>
          </div>
          <img class="card-img" src="${escapeAttr(img.url)}" alt="${escapeAttr(img.alt)}"
               loading="lazy" title="${escapeAttr(img.url)}"
               onload="this.style.display='block'"
               onerror="console.warn('图片加载失败:',this.title);this.style.display='none'">
          <div class="card-check">✓</div>
          <div class="card-info" title="${escapeAttr(img.url)}">${escapeHtml(label)}</div>
        </div>
      `;
    });
    html += '</div></div>';
    contentArea.innerHTML = html;

    // 绑定点击选中 + 双击预览
    contentArea.querySelectorAll('.card').forEach((card) => {
      let clickTimer = null;
      card.addEventListener('click', () => {
        // 延迟区分单击和双击
        if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; return; }
        clickTimer = setTimeout(() => {
          const idx = parseInt(card.dataset.index);
          toggleSelect(idx);
          clickTimer = null;
        }, 200);
      });
      card.addEventListener('dblclick', () => {
        if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
        const idx = parseInt(card.dataset.index);
        openPreview(idx);
      });
    });

    totalCount.textContent = `${allImages.length} 张`;
    updateFooter();
  }

  function escapeAttr(str) {
    return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  /** 按图片格式返回占位符背景色 */
  function placeholderColor(format) {
    const colors = {
      jpg: 'linear-gradient(135deg,#667eea,#764ba2)',
      jpeg: 'linear-gradient(135deg,#667eea,#764ba2)',
      png: 'linear-gradient(135deg,#38bdf8,#3b82f6)',
      gif: 'linear-gradient(135deg,#fbbf24,#f59e0b)',
      webp: 'linear-gradient(135deg,#34d399,#059669)',
      svg: 'linear-gradient(135deg,#f472b6,#ec4899)',
      avif: 'linear-gradient(135deg,#a78bfa,#8b5cf6)',
      ico: 'linear-gradient(135deg,#9ca3af,#6b7280)',
    };
    return colors[format] || 'linear-gradient(135deg,#e5e7eb,#9ca3af)';
  }

  /** 按图片格式返回占位符图标 */
  function placeholderIcon(format) {
    const icons = {
      jpg: '📷', jpeg: '📷',
      png: '🔲',
      gif: '🎞',
      webp: '🌐',
      svg: '✨',
      avif: '🔮',
      ico: '🔖',
    };
    return icons[format] || '🖼';
  }

  // ===== 筛选 =====
  function getFilteredImages() {
    return allImages.filter((img) => {
      if (currentFilter.format !== 'all' && img.format !== currentFilter.format) return false;
      if (img.width < currentFilter.minWidth || img.height < currentFilter.minHeight) return false;
      return true;
    });
  }

  // ===== 选中操作 =====
  function toggleSelect(idx) {
    if (selectedIndices.has(idx)) selectedIndices.delete(idx);
    else selectedIndices.add(idx);
    const card = contentArea.querySelector(`.card[data-index="${idx}"]`);
    if (card) card.classList.toggle('selected');
    updateFooter();
  }

  function selectAll() {
    getFilteredImages().forEach((img) => selectedIndices.add(allImages.indexOf(img)));
    // 重新刷新全部卡片的选中状态
    contentArea.querySelectorAll('.card').forEach((card) => {
      const idx = parseInt(card.dataset.index);
      card.classList.toggle('selected', selectedIndices.has(idx));
    });
    updateFooter();
  }

  function deselectAll() {
    selectedIndices.clear();
    contentArea.querySelectorAll('.card').forEach((card) => card.classList.remove('selected'));
    updateFooter();
  }

  function updateFooter() {
    const count = selectedIndices.size;
    selectedInfo.textContent = `已选 ${count} 张`;
    downloadBtn.disabled = count === 0;
  }

  // ===== 下载（打包 ZIP，只下载一次） =====
  async function downloadSelected() {
    if (selectedIndices.size === 0) return;

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) { showToast('无法获取当前页面', 2500); return; }
    const pageUrl = tab.url || '';

    const items = [];
    selectedIndices.forEach((idx) => {
      const img = allImages[idx];
      if (!img || img.url.startsWith('data:')) return;
      const namePart = img.url.split('/').pop()?.split('?')[0]?.split('#')[0] || `image_${idx + 1}`;
      const cleanName = namePart.replace(/[^a-zA-Z0-9_\-\.]/g, '_');
      const fmt = img.format || cleanName.split('.').pop() || 'jpg';
      const finalName = cleanName.includes('.') ? cleanName : `${cleanName}.${fmt}`;
      items.push({ url: img.url, filename: finalName });
    });

    if (items.length === 0) {
      showToast('没有可下载的图片', 2500);
      return;
    }

    downloadBtn.textContent = `打包中 ${items.length} 张…`;
    downloadBtn.disabled = true;

    try {
      const resp = await chrome.runtime.sendMessage({
        action: 'batchDownload',
        items,
        pageUrl
      });

      if (resp?.success) {
        showToast(`已下载 ${resp.succeeded} 张图片 → ${resp.zipFile}`, 3000);
      } else {
        const failed = resp?.failed || 0;
        const errMsg = resp?.error || '';
        if (resp?.succeeded > 0) {
          showToast(`部分成功：${resp.succeeded} 张已打包，${failed} 张失败`, 3000);
        } else {
          showToast(`下载失败${errMsg ? ': ' + errMsg : ''}`, 3000);
        }
        if (failed > 0) console.warn('下载失败:', resp?.errors);
      }

      selectedIndices.clear();
      renderImages();
    } catch (err) {
      console.error('下载失败:', err);
      showToast('下载失败: ' + err.message, 3000);
    } finally {
      downloadBtn.textContent = '下载选中';
      downloadBtn.disabled = selectedIndices.size === 0;
    }
  }

  // ===== 刷新（重新提取） =====
  async function reExtractImages() {
    showStatus('loading', '', '正在重新提取…');
    refreshBtn.textContent = '↻ 刷新中…';
    refreshBtn.disabled = true;
    try {
      // 重新从目标页面提取
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) { showStatus('error', '❌', '未找到活动标签页'); return; }
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: extractImagesFromPage,
      });
      const rawImages = results?.[0]?.result || [];
      const seen = new Set();
      allImages = rawImages.filter((img) => {
        if (!img?.url || seen.has(img.url)) return false;
        seen.add(img.url);
        return true;
      });
      if (allImages.length === 0) showStatus('empty', '📭', '未找到图片');
      else renderImages();
      showToast(`已刷新，共 ${allImages.length} 张图片`, 1500);
    } catch (err) {
      console.error('刷新失败:', err);
      showStatus('error', '❌', '刷新失败: ' + err.message);
    } finally {
      refreshBtn.textContent = '↻ 刷新';
      refreshBtn.disabled = false;
    }
  }

  // ===== 预览（弹出独立窗口） =====
  async function openPreview(idx) {
    const img = allImages[idx];
    if (!img) return;

    // 编码图片数据到 URL 参数（比 chrome.storage.session 更可靠）
    const data = encodeURIComponent(JSON.stringify({
      images: allImages.slice(0, 100), // 最多传 100 张，避免 URL 太长
      index: idx
    }));

    // 计算窗口大小（屏幕 85%，但不超过 1200×900）
    const w = Math.min(Math.floor(window.screen.availWidth * 0.85), 1200);
    const h = Math.min(Math.floor(window.screen.availHeight * 0.85), 900);

    chrome.windows.create({
      url: `preview.html?data=${data}`,
      type: 'popup',
      width: w,
      height: h,
      left: Math.floor((window.screen.availWidth - w) / 2),
      top: Math.floor((window.screen.availHeight - h) / 2)
    });
  }

  // ===== 单张下载 =====
  async function downloadSingle(url, filename) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) { showToast('无法获取当前页面', 2500); return; }

    try {
      const resp = await chrome.runtime.sendMessage({
        action: 'batchDownload',
        items: [{ url, filename }],
        pageUrl: tab.url
      });
      if (resp?.success) showToast('已开始下载', 1500);
      else showToast('下载失败: ' + (resp?.error || '未知错误'), 2500);
    } catch (err) {
      showToast('下载失败: ' + err.message, 2500);
    }
  }

  // ===== 事件绑定 =====
  downloadBtn.addEventListener('click', downloadSelected);
  selectAllBtn.addEventListener('click', selectAll);
  deselectAllBtn.addEventListener('click', deselectAll);
  refreshBtn.addEventListener('click', reExtractImages);

  filterFormat.addEventListener('change', () => {
    currentFilter.format = filterFormat.value;
    renderImages();
  });

  let filterDebounce = null;
  [minWidth, minHeight].forEach((input) => {
    input.addEventListener('input', () => {
      clearTimeout(filterDebounce);
      filterDebounce = setTimeout(() => {
        currentFilter.minWidth = parseInt(minWidth.value) || 0;
        currentFilter.minHeight = parseInt(minHeight.value) || 0;
        renderImages();
      }, 300);
    });
  });

  // ===== 启动 =====
  extractImages();
})();
