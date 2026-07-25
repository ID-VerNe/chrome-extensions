# SageDLP

自动将浏览器 Cookie 发送到本地 SageDLP 服务，实现 YouTube Cookie 身份认证的无缝对接。

## 功能特性

- **Cookie 自动采集与发送**：监听 `cookies.onChanged` 事件，Cookie 发生变化时自动采集当前活动标签页的 Cookie，以 Netscape 格式序列化后 POST 到本地 SageDLP 服务（`http://127.0.0.1:9876/api/cookies`），附带去重与防抖机制。
- **Cookie 数量徽章**：在扩展图标上显示当前页面的 Cookie 总数，随标签页切换、页面更新或窗口焦点变化实时更新。
- **弹出面板展示与操作**：点击扩展图标打开弹出面板，以表格形式展示当前页面的所有 Cookie（Domain、Include Subdomains、Path、Secure、Expiry、Name、Value），支持表格内容不换行显示。
- **三种导出格式**：支持以 Netscape（格式文本）、JSON、Header String 三种格式导出 Cookie，格式选择自动持久化到 `localStorage`。
- **导出与复制**：支持导出为文件（默认保存 / 另存为）、复制到剪贴板、导出所有 Cookie（不限当前域名）。
- **跨浏览器适配**：在 Firefox 中，`saveAs` 无法在弹出面板中直接使用，通过 `chrome.runtime.sendMessage` 将保存请求转发给 background service worker 处理。
- **深色模式**：自动跟随系统 `prefers-color-scheme: dark` 切换深色主题。
- **版本更新通知**：扩展更新后弹出系统通知，提供查看 GitHub Releases 和卸载扩展的按钮。

## 目录结构

```
sage-dlp/
  manifest.json                    -- 扩展清单文件，定义权限、版本、入口等
  background.html                  -- Firefox 兼容性文件，用于加载 background.mjs
  background.mjs                   -- Service Worker：Cookie 变化监听、自动发送、徽章更新、通知
  popup.html                       -- 弹出面板的 HTML 结构
  popup.mjs                        -- 弹出面板的交互逻辑：表格渲染、导出、复制、格式切换
  popup.css                        -- 弹出面板基础样式
  popup-options.css                -- 格式选择与换行选项的样式
  popup.dark.css                   -- 深色模式样式
  table-nowrap.js                  -- 表格不换行开关控制，状态持久化到 localStorage
  modules/
    get_all_cookies.mjs            -- Cookie 获取模块，支持 partitionKey 与跨浏览器兼容
    cookie_format.mjs              -- 三种格式的序列化器（Netscape / JSON / Header String）
    save_to_file.mjs               -- 基于 chrome.downloads API 的文件保存模块
  iconfont/
    material-icons.css             -- Material Icons 字体样式
    MaterialIconsOutlined.woff2    -- Material Icons 字体文件
  images/
    icon16.png                     -- 16x16 扩展图标
    icon32.png                     -- 32x32 扩展图标
    icon48.png                     -- 48x48 扩展图标
    icon128.png                    -- 128x128 扩展图标
    bmc-logo.svg                   -- Buy Me a Coffee 打赏图标（未在源码中引用）
    paypal-logo.svg                -- PayPal 打赏图标（未在源码中引用）
```

## 架构说明

### 分层结构

```
background.mjs (Service Worker)
  |-- 监听 chrome.cookies.onChanged 事件       -> 自动采集 + POST 到 SageDLP
  |-- 监听 chrome.tabs.onUpdated               -> 更新徽章计数
  |-- 监听 chrome.tabs.onActivated              -> 更新徽章计数
  |-- 监听 chrome.windows.onFocusChanged         -> 更新徽章计数
  |-- 监听 chrome.runtime.onMessage              -> 接收 Firefox 保存请求
  |-- 监听 chrome.runtime.onInstalled            -> 更新通知
  |
  |-- modules/get_all_cookies.mjs               -- Cookie 采集
  |-- modules/save_to_file.mjs                  -- 文件保存

popup.mjs (Popup)
  |-- 获取当前活动标签页 URL + Cookie            -> 渲染 Cookie 表格
  |-- 导出按钮（Export / Export As / Copy / Export All）
  |-- 格式选择器（Netscape / JSON / Header）
  |
  |-- modules/get_all_cookies.mjs               -- Cookie 采集
  |-- modules/cookie_format.mjs                 -- 格式序列化
  |-- modules/save_to_file.mjs                  -- 文件保存
```

### Cookie 自动采集与发送流程

1. 用户在浏览器中访问任意页面，该页面的 Cookie 发生增删改变化时，触发 `chrome.cookies.onChanged` 事件。
2. `background.mjs` 中的 `handleCookieChanged` 回调被调用，查询当前活动标签页的 URL。
3. 调用 `postCookiesToServer(url)`，该函数包含 300ms 防抖（按 hostname 分组）：
   - 通过 `getAllCookies()` 获取该 URL 对应的所有 Cookie。
   - 调用 `serializeNetscape()` 将 Cookie 数组序列化为 Netscape 格式的文本。
   - 与上一次发送的文本进行字符串比对（去重），若无变化则跳过。
   - 若有变化，通过 `fetch()` 以 `POST` 方式发送 JSON 到 `http://127.0.0.1:9876/api/cookies`，请求体包含 `{ cookies, url, source: "extension" }`。
4. 发送失败时仅 `console.warn` 输出日志，不弹出用户可见的错误提示。

### 文件保存流程

1. 弹出面板中点击 Export / Export As / Export All 按钮时，`popup.mjs` 调用 `getCookieText()` 获取格式化后的文本与格式信息。
2. 调用 `saveToFile()` 函数：
   - 在 Chrome 中直接调用 `modules/save_to_file.mjs` 的 `saveToFile` 函数，通过 `chrome.downloads.download` 保存文件，下载完成后通过 `chrome.downloads.onChanged` 监听器释放 blob URL。
   - 在 Firefox 中，通过 `chrome.runtime.sendMessage({ type: "save", target: "background", data: ... })` 将保存请求发送给 background service worker 处理，绕过 Firefox 弹出面板中 `saveAs` 不可用的限制。

## 权限说明

| 权限 | 用途 |
|---|---|
| `activeTab` | 查询当前活动标签页的 URL 和 ID，用于采集 Cookie 和更新徽章。 |
| `cookies` | 通过 `chrome.cookies.getAll()` 读取浏览器的 Cookie 数据。 |
| `downloads` | 通过 `chrome.downloads.download()` 将 Cookie 导出为文件。 |
| `notifications` | 扩展更新后通过 `chrome.notifications.create()` 弹出系统通知。 |
| `host_permissions: <all_urls>` | 允许读取所有域名下的 Cookie。 |
| `host_permissions: http://127.0.0.1:9876/*` | 允许向本地 SageDLP 服务发送 POST 请求。 |

## 安装与使用

### 安装（开发者模式）

1. 在 Chrome 地址栏中输入 `chrome://extensions` 并回车。
2. 打开右上角的"开发者模式"开关。
3. 点击"加载已解压的扩展程序"。
4. 选择本 `sage-dlp` 目录，确认加载。
5. 加载成功后，扩展图标将出现在浏览器工具栏中。

### 基本使用

1. 访问任意网站（如 YouTube）。
2. 扩展图标上会显示当前页面的 Cookie 数量徽章。
3. 点击扩展图标打开弹出面板，以表格形式查看当前页面的所有 Cookie。
4. 面板顶部提供四个操作按钮：
   - **Export**：以当前选中格式导出当前域名的 Cookie 文件（默认保存）。
   - **Export As**：以当前选中格式导出，弹出文件保存对话框供选择路径。
   - **Copy**：将当前域名的 Cookie 复制到剪贴板（按钮会短暂显示"Copied!"反馈）。
   - **Export All Cookies**：导出浏览器中所有 Cookie（不限于当前域名）。
5. 在"Export Format"下拉菜单中切换 Netscape / JSON / Header String 三种格式，选择会自动保存。
6. 勾选或取消"Table Nowrap"可控制 Cookie 表格内容是否换行。
7. 后台自动工作：Cookie 发生任何变化时，扩展自动采集并发送到 `http://127.0.0.1:9876/api/cookies`。

## 关键实现细节

### 1. Cookie 采集：`getAllCookies` 模块

`modules/get_all_cookies.mjs` 中的 `getAllCookies` 函数封装了 `chrome.cookies.getAll()` 的调用，处理了两个边界情况：

- **Partition Key 支持**：Chrome 119+ 引入了 `partitionKey` 参数（用于 Chrome 的 Privacy Sandbox 相关存储分区），但旧版本 Chrome 传此参数会报错。函数通过 `try/catch` 包裹带 `partitionKey` 的调用，失败时静默返回空数组，同时再发起一次不带 `partitionKey` 的调用保证兼容性。最终将两次结果合并返回。
- **Cookie Store 自动检测**：`getCurrentCookieStoreId` 函数处理三种情况——Firefox 的 `tab.cookieStoreId` 属性、Chrome 的 `cookies.getAllCookieStores` API、以及 Manifest 中 `incognito: "split"` 模式下默认返回 `undefined`（使用默认 store）。

核心代码示意：

```javascript
export default async function getAllCookies(details) {
  details.storeId ??= await getCurrentCookieStoreId();
  const { partitionKey, ...detailsWithoutPartitionKey } = details;
  const cookiesWithPartitionKey = partitionKey
    ? await Promise.resolve()
        .then(() => chrome.cookies.getAll(details))
        .catch(() => [])
    : [];
  const cookies = await chrome.cookies.getAll(detailsWithoutPartitionKey);
  return [...cookies, ...cookiesWithPartitionKey];
}
```

### 2. Cookie 格式化：`cookie_format` 模块

`modules/cookie_format.mjs` 定义了三种格式的序列化器，封装在 `formatMap` 对象中，每个格式包含 `ext`（文件扩展名）、`mimeType`（MIME 类型）和 `serializer`（序列化函数）：

- **Netscape 格式**：先通过 `jsonToNetscapeMapper` 将 Cookie 对象映射为二维字符串数组，再将每行以制表符拼接。输出文件头部包含 Netscape Cookie File 规范注释。这是 curl、wget 等命令行工具兼容的标准格式，也是 SageDLP 服务期望的格式。
- **JSON 格式**：直接使用 `JSON.stringify` 将 Cookie 数组序列化为 JSON 字符串。
- **Header String 格式**：将 Cookie 的 name 和 value 拼接为 `name=value;` 格式，以空格连接，可直接作为 HTTP 请求的 `Cookie` 请求头使用。

### 3. 自动发送的去重与防抖

`background.mjs` 中的 `postCookiesToServer` 函数同时实现了防抖和去重两种优化：

- **防抖**：按域名分组维护 `_debounceTimers` Map，每次触发时清除该域名对应的旧定时器，设置 300ms 后执行。这使得短时间内连续多次 Cookie 变化只触发一次实际发送。
- **去重**：每次发送前将序列化后的文本与 `_lastCookiesText` 做字符串比较。如果内容与上次完全相同，直接跳过发送。这在 Cookie 仅变更了过期时间等无关字段时能有效减少不必要的网络请求。

```javascript
// 防抖
clearTimeout(_debounceTimers.get(host));
_debounceTimers.set(host, setTimeout(async () => { ... }, 300));

// 去重
if (cookiesText === _lastCookiesText) return;
_lastCookiesText = cookiesText;
```