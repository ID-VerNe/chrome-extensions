# Muting Tab

Mute/unmute tabs by domain or individually with a modern UI.

## 功能特性

- **按域名批量静音**：开启某域名的静音开关后，该域名下的所有标签页自动静音，新打开的标签页也会被自动静音。
- **单独静音标签页**：在域名分组内可单独控制每个标签页的静音状态，不受域名开关影响。
- **域名自动分组**：使用 Public Suffix List（PSL）将标签页按注册域名（eTLD+1）分组，子域名归入同一组。
- **搜索过滤**：支持按域名或标签页标题实时搜索筛选。
- **当前标签页优先**：当前活动标签页所在的域名组自动展开，且置顶显示。
- **一键清空规则**：提供清空按钮，一键移除所有域名静音规则。

## 目录结构

```
muting-tab/
├── manifest.json      # 扩展清单文件，声明权限、入口和资源
├── background.js      # 后台 Service Worker，监听标签页变化并强制应用静音规则
├── popup.html         # 弹出页 HTML 结构，包含搜索框和域名列表容器
├── popup.css          # 弹出页样式，现代 UI 风格，包含开关动画和列表布局
├── popup.js           # 弹出页逻辑，加载/渲染域名列表、处理开关交互、读写存储
├── psl.min.js         # Public Suffix List 库，用于提取注册域名（eTLD+1）
└── icons/
    ├── icon16.png     # 16x16 扩展图标
    ├── icon48.png     # 48x48 扩展图标
    └── icon128.png    # 128x128 扩展图标
```

## 架构说明

### 组件职责

- **background.js（Service Worker）**：后台常驻脚本，监听 `chrome.tabs.onUpdated` 事件。当标签页 URL 变化或进入加载状态时，从 `chrome.storage.local` 读取 `mutedDomains` 列表，判断该标签页的域名是否在静音列表中，若是则调用 `chrome.tabs.update(tabId, { muted: true })` 强制静音，否则强制取消静音（`muted: false`）。这种"强制同步"策略确保静音状态始终与存储中的规则一致，不会因 Chrome 继承历史静音状态而产生偏差。

- **popup.js（弹出页）**：用户界面逻辑。点击扩展图标时触发，从 `chrome.storage.local` 加载 `mutedDomains` 列表，通过 `chrome.tabs.query({})` 获取所有标签页，按域名分组渲染为可折叠列表。用户通过开关切换静音状态时，popup.js 直接更新存储并调用 `chrome.tabs.update` 修改标签页的静音状态。

### 静音状态存储与同步流程

```
用户操作（popup.js 中切换开关）
    │
    ▼
chrome.storage.local.set({ mutedDomains: [...] })
    │
    ├─── 立即生效：popup.js 调用 Promise.all(tabs.map(t => chrome.tabs.update(t.id, { muted })))
    │
    └─── 持久生效：background.js 监听 onUpdated 事件，
                   读取 mutedDomains 列表，对新加载/新打开的标签页强制应用规则
```

两个组件之间**不通过消息传递（runtime.sendMessage）通信**，而是通过 `chrome.storage.local` 共享状态。background.js 在每次标签页更新时主动读取存储，确保静音规则被持久执行。

## 权限说明

| 权限 | 用途 |
|------|------|
| `tabs` | 查询所有标签页信息（`chrome.tabs.query`）、获取标签页 URL 和标题、读取/修改标签页静音状态（`chrome.tabs.update` 的 `muted` 属性）、监听标签页更新事件（`chrome.tabs.onUpdated`） |
| `storage` | 使用 `chrome.storage.local` 持久化存储域名静音规则列表（`mutedDomains`），确保关闭浏览器后规则不丢失 |

## 安装与使用

### 安装（开发者模式）

1. 打开 Chrome 浏览器，在地址栏输入 `chrome://extensions/` 并回车。
2. 开启右上角的"开发者模式"开关。
3. 点击左上角的"加载已解压的扩展程序"按钮。
4. 选择本项目所在的 `muting-tab/` 目录。
5. 扩展加载成功后，Chrome 工具栏会出现扩展图标。

### 使用

1. 点击扩展图标打开弹出面板。
2. 面板显示所有已打开的标签页，按域名分组。
3. 点击域名右侧的开关，批量静音/取消静音该域名下的所有标签页。
4. 点击域名行展开该域名下的标签页列表，可单独控制每个标签页的静音状态。
5. 使用顶部的搜索框，按域名或标签页标题筛选。
6. 点击搜索框右侧的清空按钮（扫帚图标），可一键移除所有域名静音规则。

## 关键实现细节

### 1. 基于 PSL 的域名分组

扩展使用 `psl.min.js`（Public Suffix List 库）提取 URL 的注册域名（eTLD+1，即 effective Top-Level Domain plus one）。例如 `sub.example.co.uk` 会被解析为 `example.co.uk`，`a.b.example.com` 被解析为 `example.com`。这样所有子域名下的标签页都会被归入同一个域名组，实现"按域名批量静音"的效果。

对应的函数在 `background.js` 和 `popup.js` 中独立实现，逻辑完全一致：

```javascript
function getBaseDomain(url) {
  const urlObj = new URL(url);
  const hostname = urlObj.hostname;
  if (hostname === 'localhost') return 'localhost';
  const ipRegex = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$|^\[?[a-fA-F0-9:]+\]?$/;
  if (ipRegex.test(hostname)) return hostname;
  const parsed = psl.parse(hostname);
  return parsed.domain || hostname;
}
```

### 2. 静音状态的持久化与强制同步

静音规则存储在 `chrome.storage.local` 的 `mutedDomains` 键下，是一个字符串数组。当用户在 popup 中切换域名开关时，popup.js 立即更新此存储并同步所有对应标签页的静音状态：

```javascript
// popup.js - 域名开关切换
await chrome.storage.local.set({ mutedDomains: Array.from(mutedDomains) });
await Promise.all(tabs.map(tab => chrome.tabs.update(tab.id, { muted: checked })));
```

background.js 中的 `chrome.tabs.onUpdated` 监听器作为兜底机制：任何标签页加载或 URL 变化时，都会重新读取 `mutedDomains` 并强制应用规则。这种设计解决了两个问题：

- 用户在切换域名静音后新打开的标签页自动继承规则。
- 防止 Chrome 继承标签页历史静音状态导致的规则不一致。

### 3. 异步并行更新与性能优化

popup.js 在切换域名静音时，使用 `Promise.all` 并行更新该域名下所有标签页，而非逐个串行更新，减少等待时间：

```javascript
await Promise.all(tabs.map(tab => chrome.tabs.update(tab.id, { muted: checked })));
```

在渲染域名列表时，使用 `DocumentFragment` 批量构建 DOM 节点，最后一次性追加到 `domainList` 容器中，避免多次触发重排（reflow）：

```javascript
const fragment = document.createDocumentFragment();
// ... 构建所有域名节点 ...
domainList.innerHTML = '';
domainList.appendChild(fragment);
```

搜索框使用 `input` 事件实时触发重新渲染，而非 `change` 事件，提供更即时的搜索反馈。