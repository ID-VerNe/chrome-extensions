// Service Worker — 编排导出/导入流程

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.action) {
    case "export":
      handleExport(message.storageType || "localStorage", sendResponse);
      return true; // 保持通道开放，等待异步响应

    case "import":
      handleImport(message.data, message.strategy, sendResponse);
      return true;

    default:
      sendResponse({ success: false, error: "Unknown action: " + message.action });
  }
});

/**
 * 导出流程：注入 content script → 读取指定 storage → 下载 JSON
 */
async function handleExport(storageType, sendResponse) {
  try {
    const tab = await getCurrentTab();
    if (!tab) {
      sendResponse({ success: false, error: "无法获取当前标签页" });
      return;
    }

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: readStorage,
      args: [storageType],
    });

    const data = results[0]?.result;
    if (!data) {
      sendResponse({ success: false, error: "Content script 未返回数据" });
      return;
    }

    // Service Worker 中没有 URL.createObjectURL，改用 Data URL
    const jsonStr = JSON.stringify(data, null, 2);
    const dataUrl = jsonToDataUrl(jsonStr);

    const domain = data.domain.replace(/[^a-z0-9.-]/gi, "_");
    const now = new Date();
    const dateStr = now.getFullYear() +
      String(now.getMonth() + 1).padStart(2, "0") +
      String(now.getDate()).padStart(2, "0") +
      String(now.getHours()).padStart(2, "0") +
      String(now.getMinutes()).padStart(2, "0") +
      String(now.getSeconds()).padStart(2, "0");
    const hash = shortHash(jsonStr);
    const typeLabel = storageType === "localStorage" ? "ls" : "ss";
    const filename = `${domain}-${typeLabel}-${dateStr}-${hash}.json`;

    // chrome.downloads.download 对 data URL 有大小限制（约 2MB），
    // 但 localStorage 数据通常远小于此
    await chrome.downloads.download({
      url: dataUrl,
      filename: filename,
      saveAs: false,
    });

    sendResponse({
      success: true,
      data: {
        domain: data.domain,
        storageType,
        keyCount: Object.keys(data[storageType] || {}).length,
        filename: filename,
      },
    });
  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }
}

/**
 * 导入流程：接收数据 → 注入 content script → 写入 storage
 */
async function handleImport(importData, strategy, sendResponse) {
  try {
    const tab = await getCurrentTab();
    if (!tab) {
      sendResponse({ success: false, error: "无法获取当前标签页" });
      return;
    }

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: writeStorage,
      args: [importData, strategy],
    });

    const result = results[0]?.result;
    sendResponse(result || { success: false, error: "Content script 未返回结果" });
  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }
}

/**
 * 将 JSON 字符串转为 Data URL（替代 Service Worker 中不可用的 URL.createObjectURL）
 */
function jsonToDataUrl(jsonStr) {
  const encoded = encodeURIComponent(jsonStr);
  return `data:application/json;charset=utf-8,${encoded}`;
}

/**
 * 对字符串取前 8 位十六进制 MD5 风格哈希（简单快速，非加密用途）
 */
function shortHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // 强制 32 位整数
  }
  return (Math.abs(hash) >>> 0).toString(16).slice(0, 8);
}

/**
 * 获取当前活跃标签页
 */
async function getCurrentTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

/**
 * 以下函数运行在页面上下文中（content script 注入）
 */

// 读取 localStorage 或 sessionStorage
function readStorage(storageType) {
  const store = storageType === "sessionStorage" ? sessionStorage : localStorage;
  const data = {};
  for (let i = 0; i < store.length; i++) {
    const key = store.key(i);
    data[key] = store.getItem(key);
  }

  return {
    domain: location.hostname,
    exportedAt: new Date().toISOString(),
    url: location.href,
    [storageType]: data,
  };
}

// 写入 localStorage 和 sessionStorage
function writeStorage(data, strategy) {
  if (!data || typeof data !== "object") {
    return { success: false, error: "无效的数据格式" };
  }

  const errors = [];
  let localStorageWritten = 0;
  let sessionStorageWritten = 0;

  // 写入 localStorage
  if (data.localStorage && typeof data.localStorage === "object") {
    try {
      if (strategy === "replace") {
        localStorage.clear();
      }
      for (const [key, value] of Object.entries(data.localStorage)) {
        if (typeof value === "string") {
          localStorage.setItem(key, value);
          localStorageWritten++;
        }
      }
    } catch (e) {
      errors.push("localStorage 写入失败: " + e.message);
    }
  }

  // 写入 sessionStorage
  if (data.sessionStorage && typeof data.sessionStorage === "object") {
    try {
      if (strategy === "replace") {
        sessionStorage.clear();
      }
      for (const [key, value] of Object.entries(data.sessionStorage)) {
        if (typeof value === "string") {
          sessionStorage.setItem(key, value);
          sessionStorageWritten++;
        }
      }
    } catch (e) {
      errors.push("sessionStorage 写入失败: " + e.message);
    }
  }

  return {
    success: errors.length === 0,
    localStorageWritten,
    sessionStorageWritten,
    errors: errors.length > 0 ? errors : undefined,
  };
}