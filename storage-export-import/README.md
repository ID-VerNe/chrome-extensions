# Storage Export/Import

导出和导入当前页面的 localStorage 与 sessionStorage 数据。

## 功能特性

- **导出 localStorage**：将当前页面的全部 localStorage 数据导出为 JSON 文件，自动下载。
- **导出 sessionStorage**：将当前页面的全部 sessionStorage 数据导出为 JSON 文件，自动下载。
- **导入数据**：选择之前导出的 JSON 文件，将数据写入当前页面的 localStorage 和/或 sessionStorage。
- **两种导入策略**：
  - **Replace**：写入前先清空对应 storage 的现有数据。
  - **Merge**：保留现有键，仅覆盖同名键的值。
- **导入前预览**：选择文件后展示来源域名、导出时间、localStorage/sessionStorage 的键数量，确认后再写入。
- **实时概览**：打开弹窗时自动读取当前页面的 localStorage 和 sessionStorage 的键数量与数据体积，并列出前 12 个键名。

## 目录结构

```
storage-export-import/
├── manifest.json          # Chrome Extension Manifest V3 配置文件
├── background.js          # Service Worker，编排导出/导入流程，处理消息路由
├── icons/
│   └── icon128.png        # 扩展图标（128x128）
├── popup/
│   ├── popup.html         # 弹窗 UI 结构（概览卡片、导出按钮、导入拖放区、策略选择）
│   ├── popup.js           # 弹窗交互逻辑（DOM 操作、消息发送、文件解析、刷新预览）
│   └── popup.css          # 弹窗样式（340px 宽、system-ui 字体、蓝/紫配色）
```

## 架构说明

### 组件分工

扩展由两个运行时组件组成：

- **Service Worker** (`background.js`)：后台常驻，负责接收来自 popup 的消息，编排导出/导入流程。它通过 `chrome.scripting.executeScript` 向当前标签页注入内容脚本读取或写入 storage，然后通过 `chrome.downloads.download` 触发文件下载。
- **Popup** (`popup/`)：用户点击扩展图标后弹出的临时界面。其生命周期仅持续到用户点击页面其他地方。popup 直接通过 `chrome.scripting.executeScript` 实时读取页面 storage 展示概览；导出/导入的实际操作则通过 `chrome.runtime.sendMessage` 委托给 Service Worker 执行。

### 导出流程

```
用户点击 Export localStorage/sessionStorage 按钮
  -> popup.js 调用 chrome.runtime.sendMessage({ action: "export", storageType })
  -> background.js handleExport() 获取当前标签页
  -> chrome.scripting.executeScript() 注入 readStorage() 函数到页面上下文
  -> readStorage() 遍历 localStorage 或 sessionStorage，返回 { domain, exportedAt, url, [storageType]: {...} }
  -> background.js 序列化为 JSON -> Data URL -> chrome.downloads.download() 下载
  -> 通知 popup 导出结果，popup 显示 toast 提示
```

### 导入流程

```
用户选择 JSON 文件
  -> popup.js 读取文件内容、解析 JSON、展示预览（域名、导出时间、键数量）
  -> 用户选择 Replace 或 Merge 策略，点击 Import data
  -> popup.js 调用 chrome.runtime.sendMessage({ action: "import", data, strategy })
  -> background.js handleImport() 获取当前标签页
  -> chrome.scripting.executeScript() 注入 writeStorage() 函数到页面上下文
  -> writeStorage() 根据策略写入 localStorage 和 sessionStorage
  -> 返回写入结果（各 storage 写入的键数量）
  -> popup 显示 toast 提示，400ms 后刷新预览
```

## 权限说明

- **activeTab**：获取当前活跃标签页的信息（URL、hostname），用于定位目标页面和生成文件名。该权限仅在用户主动点击扩展图标时临时生效，不会在后台持续监控标签页。
- **scripting**：通过 `chrome.scripting.executeScript` 向当前标签页注入 JavaScript 代码，在页面上下文中读取和写入 localStorage 与 sessionStorage。这是整个扩展的核心技术手段。
- **downloads**：通过 `chrome.downloads.download` API 触发文件下载，将导出的 JSON 数据保存到用户本地。

## 安装与使用

### 安装（开发者模式）

1. 打开 Chrome 浏览器，在地址栏输入 `chrome://extensions/` 并回车。
2. 开启右上角的 **开发者模式**（Developer mode）。
3. 点击左上角的 **加载已解压的扩展**（Load unpacked）。
4. 选择 `storage-export-import/` 目录。
5. 扩展加载成功后，地址栏右侧会出现图标。如果图标未显示，点击拼图图标扩展管理按钮，找到 "Storage Export/Import" 并固定。

### 导出操作

1. 打开任意网页（确保页面已加载完毕）。
2. 点击扩展图标打开弹窗。
3. 在 Export 区域，点击 **localStorage** 或 **sessionStorage** 卡片。
4. 浏览器会自动下载一个 JSON 文件，命名格式为 `{域名}-{ls/ss}-{YYYYMMDDHHmmss}-{8位哈希}.json`。
5. 弹窗底部会显示导出的键数量。

### 导入操作

1. 打开目标网页（确保页面已加载完毕）。
2. 点击扩展图标打开弹窗。
3. 在 Import 区域，点击虚线框，选择之前导出的 JSON 文件。
4. 弹窗展开预览面板，显示文件来源域名、导出时间、包含的键数量。
5. 选择导入策略：
   - **Replace**：先清空当前页面对应 storage 的全部数据，再写入文件中的数据。
   - **Merge**：保留当前页面的现有数据，仅覆盖同名键。
6. 点击 **Import data** 按钮确认导入。
7. 导入完成后弹窗自动刷新，显示最新的 storage 概览。

## 关键实现细节

### 1. 通过 `chrome.scripting.executeScript` 注入函数读取页面 storage

Chrome 扩展不能直接访问网页的 `localStorage` 和 `sessionStorage`，因为这些存储是按源（origin）隔离的，扩展的 Service Worker 和 popup 都有自己的独立源。该扩展的解决方案是使用 `chrome.scripting.executeScript` 将函数注入到目标页面的 JavaScript 上下文中执行。

在 `background.js` 的 `handleExport` 函数中：

```javascript
const results = await chrome.scripting.executeScript({
  target: { tabId: tab.id },
  func: readStorage,
  args: [storageType],
});
```

被注入的 `readStorage` 函数定义在 `background.js` 文件末尾，但它以 `func` 参数传递，Chrome 会将其序列化后在目标页面中执行。因此 `readStorage` 内部可以直接访问 `localStorage`、`sessionStorage`、`location.hostname` 等页面级 API：

```javascript
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
```

导入流程的 `writeStorage` 函数也采用同样的注入方式，区别在于它接收 `data` 和 `strategy` 两个参数，并遍历写入。

### 2. 在 Service Worker 中使用 Data URL 替代 Blob URL 实现文件下载

Service Worker 环境中没有 `document` 对象，因此无法使用 `URL.createObjectURL(blob)` 创建 Blob URL。该扩展的解决方式是将 JSON 字符串编码为 Data URL：

```javascript
function jsonToDataUrl(jsonStr) {
  const encoded = encodeURIComponent(jsonStr);
  return `data:application/json;charset=utf-8,${encoded}`;
}
```

然后将 Data URL 直接传给 `chrome.downloads.download`：

```javascript
await chrome.downloads.download({
  url: dataUrl,
  filename: filename,
  saveAs: false,
});
```

Data URL 有大小限制（约 2MB），但对于 localStorage 和 sessionStorage 的常见数据量级（通常远小于 1MB）来说足够使用。

### 3. 防重名文件名——短哈希与时间戳组合

导出的文件名使用 `domain-storageType-timestamp-hash` 组合，确保同一页面多次导出不会重名覆盖：

```javascript
const filename = `${domain}-${typeLabel}-${dateStr}-${hash}.json`;
```

其中的 `hash` 来自一个非加密用途的快速哈希函数 `shortHash`，它遍历字符串的每个字符，使用类似 DJB2 的算法（`hash = ((hash << 5) - hash) + char`）计算出一个 32 位整数，再取前 8 位十六进制：

```javascript
function shortHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return (Math.abs(hash) >>> 0).toString(16).slice(0, 8);
}
```

该哈希值基于 JSON 内容计算，因此同一份数据总是生成相同的文件名，方便用户判断是否重复导出。

### 架构细节备注

- Popup 直接使用 `chrome.scripting.executeScript` 读取 storage 展示概览，而导出/导入则通过 `chrome.runtime.sendMessage` 委托给 Service Worker。这样设计是因为 popup 随时可能被关闭（用户点击页面其他位置），而 Service Worker 可以在 popup 关闭后继续完成下载操作。
- 导入时支持两种策略：Replace 会先调用 `localStorage.clear()` 或 `sessionStorage.clear()` 再写入；Merge 则直接遍历写入，不执行清空操作。