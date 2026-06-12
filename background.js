console.log('[Image Downloader] SW starting...');

let nextRuleId = 1000;
let activeRuleIds = new Set();

function cleanupRules() {
  if (activeRuleIds.size === 0) return;
  const ids = [...activeRuleIds];
  activeRuleIds.clear();
  chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: ids }).catch(() => {});
}
setInterval(cleanupRules, 30000);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // ===== 批量打包下载 =====
  if (message.action === 'batchDownload') {
    const items = message.items || [];     // [{url, filename}, ...]
    const pageUrl = message.pageUrl || '';

    if (items.length === 0) {
      sendResponse({ success: false, error: '没有下载项' });
      return false;
    }

    // 1. 创建 DNR 规则（为每个图片 URL 注入 Referer）
    const rules = items.map((item) => {
      const id = nextRuleId++;
      activeRuleIds.add(id);
      return {
        id,
        priority: 1,
        action: {
          type: 'modifyHeaders',
          requestHeaders: [{ header: 'Referer', operation: 'set', value: pageUrl }]
        },
        condition: {
          urlFilter: item.url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
          resourceTypes: ['main_frame', 'sub_frame', 'image', 'xmlhttprequest', 'other']
        }
      };
    });

    chrome.declarativeNetRequest.updateDynamicRules({ addRules: rules })
      .then(async () => {
        // 2. 逐个 fetch 图片（有 host_permissions，跨域不受 CORS 限制）
        const fetchResults = [];
        for (const item of items) {
          try {
            const resp = await fetch(item.url, {
              credentials: 'include',
              referrerPolicy: 'unsafe-url'
            });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const blob = await resp.blob();
            const ab = await blob.arrayBuffer();
            const ctype = resp.headers.get('content-type') || 'image/jpeg';
            fetchResults.push({ ok: true, url: item.url, filename: item.filename, data: ab, contentType: ctype });
          } catch (err) {
            fetchResults.push({ ok: false, url: item.url, error: err.message });
          }
        }

        // 清理 DNR 规则
        cleanupRules();

        const okItems = fetchResults.filter(r => r.ok);
        const failItems = fetchResults.filter(r => !r.ok);

        if (okItems.length === 0) {
          sendResponse({ success: false, error: '所有图片抓取失败', failures: failItems });
          return;
        }

        // 3. 创建 ZIP 文件
        const zipData = await createZip(okItems);
        const zipDataUrl = arrayBufferToDataURL(zipData, 'application/zip');

        // 4. 用 data URL 下载（单次下载，无多重弹窗）
        const zipFilename = `images_${Date.now()}.zip`;
        chrome.downloads.download(
          { url: zipDataUrl, filename: zipFilename, saveAs: false },
          (id) => {
            const err = chrome.runtime.lastError;
            sendResponse({
              success: !err,
              zipFile: zipFilename,
              total: items.length,
              succeeded: okItems.length,
              failed: failItems.length,
              errors: failItems.length > 0 ? failItems : undefined,
              downloadId: err ? undefined : id,
              error: err?.message
            });
          }
        );
      })
      .catch((e) => {
        cleanupRules();
        sendResponse({ success: false, error: e.message });
      });

    return true;
  }

  // ===== 清理规则 =====
  if (message.action === 'removeRules') {
    const ids = message.ruleIds || [];
    ids.forEach((id) => activeRuleIds.delete(id));
    chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: ids }).catch(() => {});
    sendResponse({ success: true });
    return false;
  }
});

// ===== ZIP 创建工具 =====
async function createZip(files) {
  // files: [{filename, data: ArrayBuffer, contentType}]
  const localHeaders = [];
  const centralDir = [];
  let dataOffset = 0;

  for (const file of files) {
    const nameBytes = stringToBytes(file.filename);
    const crc = crc32(new Uint8Array(file.data));

    // Local file header
    const localHeader = new ArrayBuffer(30 + nameBytes.length);
    const lv = new DataView(localHeader);
    lv.setUint32(0, 0x04034b50, true);     // signature
    lv.setUint16(4, 20, true);             // version needed
    lv.setUint16(6, 0, true);              // flags
    lv.setUint16(8, 0, true);              // compression: stored
    lv.setUint16(10, 0, true);             // mod time
    lv.setUint16(12, 0, true);             // mod date
    lv.setUint32(14, crc, true);           // crc32
    lv.setUint32(18, file.data.byteLength, true); // compressed size
    lv.setUint32(22, file.data.byteLength, true); // uncompressed size
    lv.setUint16(26, nameBytes.length, true);     // filename length
    lv.setUint16(28, 0, true);             // extra field length
    new Uint8Array(localHeader, 30).set(nameBytes);

    // Central directory entry
    const cdEntry = new ArrayBuffer(46 + nameBytes.length);
    const cv = new DataView(cdEntry);
    cv.setUint32(0, 0x02014b50, true);     // signature
    cv.setUint16(4, 20, true);             // version made by
    cv.setUint16(6, 20, true);             // version needed
    cv.setUint16(8, 0, true);              // flags
    cv.setUint16(10, 0, true);             // compression
    cv.setUint16(12, 0, true);             // mod time
    cv.setUint16(14, 0, true);             // mod date
    cv.setUint32(16, crc, true);           // crc32
    cv.setUint32(20, file.data.byteLength, true); // compressed
    cv.setUint32(24, file.data.byteLength, true); // uncompressed
    cv.setUint16(28, nameBytes.length, true);     // filename length
    cv.setUint16(30, 0, true);             // extra field length
    cv.setUint16(32, 0, true);             // file comment length
    cv.setUint16(34, 0, true);             // disk number start
    cv.setUint16(36, 0, true);             // internal attrs
    cv.setUint32(38, 0, true);             // external attrs
    cv.setUint32(42, dataOffset, true);    // relative offset
    new Uint8Array(cdEntry, 46).set(nameBytes);

    localHeaders.push(localHeader);
    centralDir.push(cdEntry);
    dataOffset += 30 + nameBytes.length + file.data.byteLength;
  }

  // 计算总大小
  const totalLocal = localHeaders.reduce((s, h, i) => s + h.byteLength + files[i].data.byteLength, 0);
  const totalCD = centralDir.reduce((s, h) => s + h.byteLength, 0);
  const eocdSize = 22;
  const zipSize = totalLocal + totalCD + eocdSize;

  const zip = new Uint8Array(zipSize);
  let offset = 0;

  // 写入 local file headers + data
  for (let i = 0; i < files.length; i++) {
    zip.set(new Uint8Array(localHeaders[i]), offset); offset += localHeaders[i].byteLength;
    zip.set(new Uint8Array(files[i].data), offset); offset += files[i].data.byteLength;
  }

  // 写入 central directory
  const cdOffset = totalLocal;
  for (const h of centralDir) {
    zip.set(new Uint8Array(h), offset); offset += h.byteLength;
  }

  // 写入 End of Central Directory
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true);    // signature
  eocd.setUint16(4, 0, true);             // disk number
  eocd.setUint16(6, 0, true);             // disk with CD
  eocd.setUint16(8, files.length, true);  // entries on this disk
  eocd.setUint16(10, files.length, true); // total entries
  eocd.setUint32(12, totalCD, true);      // CD size
  eocd.setUint32(16, cdOffset, true);     // CD offset
  eocd.setUint16(20, 0, true);            // comment length
  zip.set(new Uint8Array(eocd.buffer), offset);

  return zip.buffer;
}

function stringToBytes(str) {
  return new TextEncoder().encode(str);
}

function crc32(data) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function arrayBufferToDataURL(buffer, mime) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

console.log('[Image Downloader] SW ready.');
