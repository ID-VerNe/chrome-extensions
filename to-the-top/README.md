# Smart Back to Top

一个智能的"返回顶部"Chrome 扩展，按钮能自适应融入任意网页。

## 功能特性

- **智能检测**：自动检测页面是否已有"返回顶部"按钮，避免重复注入
- **自适应配色**：从页面的 CSS 自定义属性或交互元素颜色中提取主色，自动生成按钮背景色和悬停色
- **双模式注入**：优先嵌入页面右侧已有的工具栏（如 Bilibili、Twitter 等），无工具栏时自动切换为悬浮按钮
- **平滑动画**：滚动时淡入淡出，点击时按压动画并平滑滚动到顶部
- **SPA 路由适配**：通过 History API 拦截和 MutationObserver 监测，在单页应用切换页面时重新检测和注入
- **选项配置页**：支持全局开关、主题模式（自动/亮/暗）、图标样式、不透明度、自定义颜色、注入模式、禁用网站管理
- **禁用网站黑名单**：支持通配符模式（如 `*.example.com`），可添加/删除

## 目录结构

```
to-the-top/
├── manifest.json                 # Manifest V3 扩展声明
├── package.json                  # 项目依赖与构建脚本
├── scripts/
│   └── assemble.mjs              # 构建脚本：Vite 打包 + 资源复制 + manifest 生成
├── src/
│   ├── background/
│   │   └── background.ts         # Service Worker：管理设置存储、响应消息、初始化默认配置
│   ├── content-script/
│   │   ├── main.ts               # 内容脚本入口：编排检测、取色、注入、动画、SPA 监听
│   │   ├── detector.ts           # 页面已有按钮检测器：三层策略（CSS选择器/文本匹配/行为验证）
│   │   ├── color.ts              # 颜色工具：提取页面主色、检测亮暗主题、生成按钮颜色
│   │   ├── injector.ts           # 按钮注入器：检测工具栏、构建按钮 DOM、注入样式
│   │   └── animator.ts           # 动画控制器：滚动可见性管理、平滑滚动、按压动画
│   ├── options/
│   │   ├── index.html            # 选项页面 HTML（含内联样式）
│   │   └── options.ts            # 选项页面逻辑：加载/保存设置、管理与禁用网站列表交互
│   └── assets/
│       ├── icon-16.svg           # 16x16 扩展图标
│       ├── icon-48.svg           # 48x48 扩展图标
│       └── icon-128.svg          # 128x128 扩展图标
└── dist/                         # 构建产物（gitignore）
```

## 架构说明

### 三层架构

扩展分为三个独立的执行上下文，通过 `chrome.runtime.sendMessage` / `chrome.storage` 通信：

1. **Background Service Worker** (`background.ts`)：扩展的后台进程，负责在安装时初始化默认设置，处理来自内容脚本和选项页面的 `GET_SETTINGS` 消息，通过 `chrome.storage.sync` 读写设置。

2. **Content Script** (`content-script/main.ts`)：注入到所有页面，是核心逻辑的编排者。执行流程为：

   ```
   init() 调用
     → detectExistingTopButton()    // 检测页面是否已有按钮
     → getPageColors()              // 提取页面主色和主题
     → detectRightToolbar()         // 检测右侧工具栏
     → injectButton()               // 注入按钮（工具栏模式或悬浮模式）
     → setupScrollVisibility()      // 绑定滚动可见性
     → attachClickHandler()         // 绑定点击事件
   ```

   同时设置 SPA 路由监听器（`setupSPAWatcher`），在页面 URL 变化或 DOM 发生重大变化时重新执行 `init()`。

3. **Options Page** (`options/`)：独立的选项页面，通过 `chrome.runtime.sendMessage({ type: 'GET_SETTINGS' })` 获取设置，修改后通过 `chrome.storage.sync.set` 保存。内容脚本通过 `chrome.storage.sync.get` 读取设置，因此无需跨上下文直接传递。

### 按钮注入与动画流程

- 注入器（`injector.ts`）首先调用 `detectRightToolbar()` 扫描页面中 `position: fixed` 或 `position: sticky` 的右侧窄条容器；如果找到，按钮以工具栏模式注入（小尺寸、透明背景、仅悬停时显示淡色背景）；否则以悬浮模式注入（固定定位、圆角矩形、带毛玻璃效果和阴影）。
- 动画控制器（`animator.ts`）通过 `requestAnimationFrame` 节流的 `scroll` 事件监听滚动位置。当滚动超过 `1.5` 倍视口高度时调用 `showButton()` 触发淡入动画；当滚动回顶部时调用 `hideButton()` 触发淡出动画。
- 点击按钮时触发按压动画（`sbt-press` 关键帧动画），然后执行 `window.scrollTo({ top: 0, behavior: 'smooth' })`，同时通过 `hideUntilManualScroll()` 锁定按钮，防止在平滑滚动过程中重新出现——只有用户再次手动滚动超过阈值后才会解除锁定。

### 自适应配色机制

`color.ts` 实现了三级主色提取策略：

1. 优先从 CSS 自定义属性中提取。扫描 `--primary`、`--color-primary`、`--accent`、`--brand-color` 等 13 个常见 CSS 变量名，对 `var()` 嵌套引用做递归解析。
2. 其次从页面第一个非默认颜色的 `<a>` 或 `<button>` 元素的 `color` 计算值中提取。
3. 兜底使用 `#1a73e8`（Google Blue）。

亮暗主题检测也分两层：

1. 检查 `<html>` 和 `<body>` 上的 `data-theme`、`class` 等标记（如 `dark`、`theme-dark`、`dark-mode`）。
2. 若未找到标记，用 `computeBrightness()` 计算 `body` 背景色的亮度值（公式 `(R*299 + G*587 + B*114) / 1000`），小于 128 判定为暗色。

最终通过 `getButtonColors()` 根据主色和主题生成按钮的背景色、图标色和悬停色：暗色模式下将主色变亮作为背景，亮色模式下将主色变暗作为背景。

## 权限说明

| 权限 | 用途 |
|------|------|
| `storage` | 通过 `chrome.storage.sync` 存储和同步扩展设置（全局开关、主题模式、禁用网站列表等） |
| `activeTab` | 获取当前活动标签页的信息（当前用于预留，实际内容脚本通过 `<all_urls>` 注入） |
| `host_permissions: <all_urls>` | 允许内容脚本在所有域名下执行，确保在每个页面都能注入"返回顶部"按钮 |

## 构建与安装

### 前置要求

- Node.js >= 18
- npm

### 构建步骤

```bash
# 1. 安装依赖
npm install

# 2. 构建扩展
npm run build
# 或直接运行：node scripts/assemble.mjs
```

构建产物输出到 `dist/` 目录。

### 在 Chrome 中加载已解压的扩展

1. 打开 Chrome，访问 `chrome://extensions`
2. 开启右上角的"开发者模式"
3. 点击"加载已解压的扩展程序"
4. 选择 `dist/` 目录
5. 扩展安装完成，访问任意网页即可看到右下角的"返回顶部"按钮

## 关键实现细节

### 1. 页面已有按钮检测（detector.ts）

`detectExistingTopButton()` 使用了三层递进策略：

- **第一层——CSS 选择器匹配**：`collectSelectorCandidates()` 遍历 30 多个选择器模式，覆盖常见的 class 命名（`back-to-top`、`go-top`、`scroll-top` 等）、id 命名、href 锚点（`#`、`#top`、`#0`）以及 aria-label/title 属性。
- **第二层——文本节点匹配**：`collectTextCandidates()` 使用 `TreeWalker` 扫描页面所有文本节点，匹配中英文关键词（"回到顶部"、"back to top"）和箭头字符（↑、▲、△ 等），然后检查父元素是否可点击。
- **第三层——行为验证**：`verifyBehavior()` 是最高置信度的检测手段。对候选元素执行安全的点击模拟（`dispatchEvent` + `preventDefault` 拦截），在 `requestAnimationFrame` 回调中检查 `window.scrollY` 是否减少了 50px 以上。同时还检查 inline `onclick` 属性中是否包含 `scrollTo(0,0)` 等模式。

此外，每个候选元素通过 `scoreCandidate()` 打分，综合考虑位置（浮动靠近右下角 +2 分）、箭头语义（+2 分）、尺寸（< 80px +1 分）、是否在导航/菜单内部（-2 分）等因素。只有得分大于 0 且通过行为验证的元素才被认定为"已有按钮"。

### 2. 自适应配色（color.ts）

颜色的提取和计算是"自适应融入"的核心。`getPageColors()` 的提取顺序如下：

```
CSS 自定义属性（13 个常见变量名）
  → 页面第一个非默认颜色的 <a> 链接颜色
  → 第一个非默认颜色的 <button>/<a> 交互元素颜色
  → 兜底 #1a73e8
```

得到主色后，`getButtonColors()` 根据亮暗主题生成三组颜色：

- 亮色页面：背景 = 主色加深 10%，悬停 = 主色加深 25%，图标 = 白色
- 暗色页面：背景 = 主色变亮 30%，悬停 = 主色变亮 50%，图标 = 白色

`darkenColor()` 和 `lightenColor()` 基于 RGB 通道线性插值，`rgbToHex()` 将 `getComputedStyle` 返回的 `rgb()` 字符串标准化为 `#rrggbb` 格式。

### 3. 滚动可见性锁定机制（animator.ts）

`setupScrollVisibility()` 中的 `hideUntilManualScroll()` 实现了一个精妙的锁定机制，解决了一类常见问题：用户点击"返回顶部"后，按钮在平滑滚动过程中会经过阈值位置，如果不加锁，按钮会立即重新出现，造成视觉闪烁。

实现方式：

- 点击时设置 `lockUntilThresholdCycle = true` 和 `hasBeenAboveThresholdSinceLock = false`
- 在 `onScroll()` 中，只有当 `hasBeenAboveThresholdSinceLock` 变为 `true`（用户已手动滚动回顶部以上）后，才允许按钮再次显示
- 锁定期间按钮始终保持隐藏（`opacity: 0`、`pointer-events: none`）
- 滚动事件通过 `requestAnimationFrame` 节流，避免频繁计算影响性能