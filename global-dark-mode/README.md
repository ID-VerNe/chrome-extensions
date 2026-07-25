# Global Dark Mode

> 全局夜间模式：默认对所有网站开启智能暗色，可按站点关闭。

基于 [darkreader](https://github.com/darkreader/darkreader) 引擎的 Chrome 扩展，默认对每个网站应用暗色主题，并允许按站点关闭、自由调节亮度/对比度/色温，通过 `chrome.storage.sync` 跨设备同步设置。

---

## 功能特性

- **智能暗色** — 基于 darkreader 引擎，自动分析页面样式并生成暗色主题，默认对全部网站开启。
- **按站点关闭** — 对特定站点关闭夜间模式，域名加入关闭名单后不再应用暗色。关闭名单以 `origin`（协议+域名+端口）精确匹配。
- **亮度/对比度/色温调节** — 三项滑块实时调节，范围分别为 50-150、50-150、0-100。默认值 90/90/30（暖色调），可自由调整。
- **背景色与文本色自定义** — 选项页面提供颜色选择器，可独立设置暗色模式下的背景色和文本色。
- **跨设备同步** — 所有设置储存在 `chrome.storage.sync`，登录同一 Chrome 账号时自动同步。
- **白闪防护** — 在 `document_start` 阶段注入 CSS 将页面背景设为深色，阻止页面加载初期出现白色闪烁。
- **CSP 兼容** — 在 `disableStyleSheetsProxy` 和 `disableCustomElementRegistryProxy` 模式下运行 darkreader，并手动补发 `__darkreader__inlineScriptsAllowed` 事件，确保高 CSP 站点（如 bilibili）也能正常暗色化。
- **跨域 CSS 获取** — 内容脚本无法直接跨域 fetch，通过 Service Worker 代理获取跨域样式表，并内置 3 次重试机制。

---

## 目录结构

```
global-dark-mode/
├── .gitignore                  # 忽略 node_modules/、dist/、.plan/
├── manifest.json               # Chrome Extension Manifest V3，定义权限、脚本注册
├── package.json                # npm 依赖管理（darkreader、esbuild、sharp）
├── scripts/
│   └── build.mjs               # esbuild 打包脚本，将各组件的 import 依赖 bundle 为独立文件
├── background/
│   └── sw.js                   # Service Worker：初始化安装、存储变更广播、跨域 CSS fetch 代理
├── content/
│   ├── inject.js               # 内容脚本：加载 darkreader 并应用暗色主题
│   └── flash-block.css         # 预注入 CSS：在页面渲染前设置深色背景，防止白闪
├── popup/
│   ├── popup.html              # 弹出面板 HTML：全局开关、三项滑块、当前站点切换
│   ├── popup.js                # 弹出面板逻辑：读写存储、渲染状态、保存设置
│   └── popup.css               # 弹出面板样式：深色主题 UI，300px 宽
├── options/
│   ├── options.html            # 选项页面 HTML：完整参数调节、颜色选择器、站点关闭名单管理
│   ├── options.js              # 选项页面逻辑：状态管理、站点名单增删改
│   └── options.css             # 选项页面样式：深色主题 UI，响应式布局
├── shared/
│   ├── constants.js            # 共享常量：存储键（gdm_state/gdm_disabled_sites）、消息类型、默认配置
│   └── matching.js             # 站点匹配工具函数：originOf、siteDisabled、toggleSite
└── icons/
    ├── (源图标文件)             # 源图标（如 微信图片_xxx.png 或 source.png）
    ├── icon-16.png             # 16px 图标
    ├── icon-48.png             # 48px 图标
    └── icon-128.png            # 128px 图标
```

---

## 架构说明

### 分层结构

扩展分为五个层次，通过 `chrome.storage` 和消息传递协作：

| 层 | 文件 | 职责 |
|---|---|---|
| **content** | `content/inject.js`、`content/flash-block.css` | 注入到每个页面，直接操作 DOM |
| **background** | `background/sw.js` | Service Worker，无 UI 的后台进程 |
| **popup** | `popup/` | 浏览器工具栏弹出面板，快速操作入口 |
| **options** | `options/` | 右键菜单选项页，完整设置界面 |
| **shared** | `shared/constants.js`、`shared/matching.js` | 纯函数与常量，被上述各层 import |

### 设置同步流程

1. 用户在 popup 或 options 中修改设置，写入 `chrome.storage.sync`。
2. Service Worker 监听 `chrome.storage.onChanged`，检测到 `gdm_state` 或 `gdm_disabled_sites` 变化后，遍历所有已打开的 HTTP/HTTPS 标签页，通过 `chrome.tabs.sendMessage` 发送 `gdm_update` 消息。
3. 每个标签页的内容脚本收到 `gdm_update` 消息后，更新本地状态并调用 `DarkReader.enable()` 或 `DarkReader.disable()`。
4. 内容脚本同时也直接监听 `chrome.storage.onChanged`，作为冗余更新通道（双通道保障）。

### 跨域 CSS 代理机制

内容脚本在 `isolated_world` 环境中运行，跨域 fetch 受 CSP 限制。darkreader 需要获取页面引用的外部样式表，这个过程通过以下链路完成：

1. 内容脚本调用 `DarkReader.setFetchMethod()` 注册自定义 fetch 函数。
2. 自定义 fetch 函数通过 `chrome.runtime.sendMessage({ type: 'gdm_fetch', url })` 向 Service Worker 发送请求。
3. Service Worker 的 `chrome.runtime.onMessage` 处理 `gdm_fetch` 消息，使用 `fetch(msg.url, { credentials: 'omit' })` 获取原始 CSS 文本，通过 `sendResponse` 返回。
4. 内容脚本将返回的 CSS 文本包装为 `Response` 对象返回给 darkreader 内部解析。

### 构建流程

构建脚本 `scripts/build.mjs` 使用 esbuild 分别打包以下入口：

- **content/inject.js** — 以 IIFE 格式打包，将 darkreader ESM 依赖一并 bundle 进去，输出到 `dist/`。
- **popup/popup.js** — 以 ESM 格式打包，bundle shared 模块。
- **options/options.js** — 以 ESM 格式打包，bundle shared 模块。
- **background/sw.js** — 以 ESM 格式打包，bundle shared 模块。
- 静态资源（HTML/CSS/图标/清单）直接复制到 `dist/`。
- 构建脚本会重写 `manifest.json` 中的路径，使其指向 `dist/` 下的打包产物。

---

## 权限说明

| 权限 | 用途 |
|---|---|
| `"storage"` | 读写 `chrome.storage.sync`，存储全局状态（开启/关闭、亮度、对比度、色温、背景色、文本色）和站点关闭名单，支持跨设备同步。 |
| `"tabs"` | 在 Service Worker 中通过 `chrome.tabs.query` 查询所有打开的标签页，在存储变更时向每个标签页广播 `gdm_update` 消息。 |
| `"<all_urls>"` （host_permissions） | 允许内容脚本注入到所有 URL 匹配的页面，并允许 Service Worker 对任意域发起跨域 fetch 请求以获取外部样式表。 |

---

## 构建与安装

### 前提

- Node.js >= 18
- npm

### 构建

```bash
# 在项目根目录下执行
npm install
npm run build
```

构建产物输出到 `dist/` 目录。如果仅需生成图标，可使用：

```bash
npm run icons
```

### 安装到 Chrome

1. 打开 Chrome，访问 `chrome://extensions`。
2. 开启右上角的"开发者模式"。
3. 点击"加载已解压的扩展程序"。
4. 选择 `dist/` 目录（而非项目根目录，因为 `manifest.json` 中的路径指向 `dist/` 下的打包产物）。
5. 扩展图标将出现在工具栏，点击即可打开弹出面板。

### 重置

如需重置为默认设置，可在选项页面点击"重置为默认值"按钮，或通过 `chrome.storage.sync` 清除数据。

---

## 关键实现细节

### 1. 基于 darkreader 引擎，关闭样式表代理以兼容高 CSP 站点

darkreader 默认使用 `StyleSheet` 代理和 `customElements` 代理来拦截页面样式，但这种方式依赖内联 `<script>` 注入，在 CSP 严格的站点（如 bilibili）会被直接拦截，导致暗色模式失效。

解决方案：在 `DarkReader.enable()` 时传入 `disableStyleSheetsProxy: true` 和 `disableCustomElementRegistryProxy: true`，关闭两个代理，回退到 `requestAnimationFrame` 轮询检测新增样式。这种方式不依赖内联脚本注入，对所有站点通用。

```js
DarkReader.enable(buildTheme(state), {
  disableStyleSheetsProxy: true,
  disableCustomElementRegistryProxy: true,
});
```

### 2. `document_start` 注入 flash-block.css 防白闪

内容脚本在 `document_idle` 阶段（`content/inject.js`）才执行，这时页面已经渲染了初始帧。如果页面背景为白色，用户会看到一闪而过的白色背景，然后才被 darkreader 覆盖。

解决方案：在 `manifest.json` 中注册两个 `content_scripts` 条目。第一个条目以 `run_at: "document_start"` 和 `all_frames: true` 注入 `flash-block.css`，在浏览器构建 DOM 之前就将 `html` 和 `body` 的背景色设为深色：

```css
html {
  background-color: #241d18 !important;
}
body {
  background-color: #241d18 !important;
}
```

第二个条目以 `run_at: "document_idle"` 注入 `inject.js`（包含 darkreader）。darkreader 接管后，这些预置的 CSS 规则会被覆盖，整个过程对用户无感知。

### 3. Service Worker 代理跨域 CSS fetch 及其重试机制

内容脚本运行在 `isolated_world` 中，无法直接跨域 fetch。darkreader 需要获取页面引用的外部样式表（如 CDN 上的 CSS 文件），因此必须通过扩展的 Service Worker 中转。

内容脚本在初始化时调用 `DarkReader.setFetchMethod()` 注册自定义 fetch 函数。该函数通过 `chrome.runtime.sendMessage({ type: 'gdm_fetch', url })` 发送消息到 Service Worker，Service Worker 在 `onMessage` 监听中处理：

```js
// background/sw.js
if (msg.type === MSG.FETCH) {
  fetch(msg.url, { credentials: 'omit' })
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.text();
    })
    .then((text) => sendResponse({ ok: true, text }))
    .catch((err) => sendResponse({ ok: false, error: err.message }));
  return true; // 保持消息通道打开以支持异步 sendResponse
}
```

**重试机制**：MV3 的 Service Worker 在空闲 30 秒后会被浏览器终止，收到消息时重新唤醒。刚唤醒时，`chrome.runtime.sendMessage` 的第一次请求可能失败（竞争条件）。因此自定义 fetch 函数内置了 3 次重试，每次失败后递增等待时间（300ms / 600ms / 900ms），第三次失败才抛出异常：

```js
DarkReader.setFetchMethod(async (url) => {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'gdm_fetch', url });
      if (resp && resp.ok) {
        return new Response(resp.text, { status: 200, statusText: 'OK',
          headers: { 'Content-Type': 'text/css' } });
      }
      throw new Error(resp?.error || 'fetch failed');
    } catch (e) {
      if (attempt === 2) throw e;
      await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
    }
  }
});
```

### 4. 手动补发 `__darkreader__inlineScriptsAllowed` 事件

darkreader 内部通过 `__darkreader__inlineScriptsAllowed` 自定义事件来确认内联脚本是否被允许。在禁用了样式表代理后，darkreader 不再尝试注入内联脚本，但这个事件也就不会触发，导致 darkreader 内部某些状态机停滞。

解决方案：在每次调用 `DarkReader.enable()` 后，手动 dispatch 该事件：

```js
try {
  document.dispatchEvent(new CustomEvent('__darkreader__inlineScriptsAllowed'));
} catch (e) {
  // 非关键，忽略
}
```

这确保了 darkreader 内部状态正常，不需要依赖内联脚本注入。同样地，`disableStyleSheetsProxy` 和 `disableCustomElementRegistryProxy` 也避免了 CSP 对内联脚本的拦截。

### 5. 存储变更双通道广播

当用户在 popup 或 options 页面修改设置时，设置写入 `chrome.storage.sync`。Service Worker 监听 `storage.onChanged` 并主动向所有标签页广播 `gdm_update` 消息。同时，内容脚本自身也监听 `storage.onChanged`，作为后备接收通道。这种双通道设计确保在 Service Worker 偶发唤醒延迟时，内容脚本仍能通过存储层直接获取最新状态。

---

## 技术栈

- **Chrome Extension Manifest V3** — 使用 Service Worker 替代持久化后台页面
- **darkreader** — 核心暗色引擎，MIT 许可证
- **esbuild** — 构建打包，高速 bundle ESM 依赖
- **sharp** — 图标尺寸缩放（可选）

---

## 注意事项

- 构建脚本的 `SRC` 路径硬编码为 `scripts/../src/`，但实际源文件位于项目根目录。执行 `npm run build` 前需确认路径一致，或将源文件移至 `src/` 目录下，或修改 `build.mjs` 中的 `SRC` 定义。
- `flash-block.css` 中的背景色硬编码为 `#241d18`，与 `DEFAULTS.darkBg` 一致，但若用户修改背景色，预注入 CSS 的颜色不会响应变化——这是有意为之，因为 `document_start` 阶段无法读取 `chrome.storage`。