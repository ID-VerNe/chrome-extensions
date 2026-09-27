# Smart Back to Top

一个智能的"返回顶部"Chrome 扩展，按钮能自适应融入任意网页。

## 功能特性

- **智能检测**：自动检测页面是否已有"返回顶部"按钮，避免重复注入（仅行为验证通过才判定已有，否则一律注入）
- **自适应配色**：从页面的 CSS 自定义属性（递归解析 `var()`）或交互元素颜色中提取主色，自动生成按钮背景色和悬停色
- **形态融入**：采样页面交互元素的多数倾向推断圆角和材质风格，高流量站点（GitHub/X/Bilibili 等）有视觉预设，用户设置可强制覆盖
- **双模式注入**：优先嵌入页面右侧已有的工具栏（如 Bilibili、Twitter 等），无工具栏时自动切换为悬浮按钮
- **克制动画**：纯 opacity 淡入淡出（无位移），按压为无过冲轻按，hover 微缩放，曲线 `ease-out`
- **SPA 路由适配**：通过 History API 拦截和 MutationObserver 监测，在单页应用切换页面时重新检测和注入
- **选项配置页**：支持全局开关、主题模式（自动/亮/暗）、图标样式、圆角风格、材质风格、不透明度、自定义颜色、注入模式、禁用网站管理；改动经 `storage.onChanged` 实时生效，无需刷新
- **禁用网站黑名单**：支持通配符模式（如 `*.example.com`），可添加/删除

## 目录结构

```
to-the-top/
├── manifest.json                 # Manifest V3 扩展声明（源路径，构建时改写）
├── package.json                  # 项目依赖与构建脚本
├── scripts/
│   └── assemble.mjs              # 构建脚本：两次 Vite 打包 + 资源复制 + manifest 派生
├── src/
│   ├── shared/
│   │   └── settings.ts           # 设置类型、默认值、storage.sync 读写、黑名单匹配
│   ├── content-script/
│   │   ├── main.ts               # 内容脚本入口：编排检测、取色、形态、注入、动画、SPA/storage 监听
│   │   ├── detector.ts           # 已有按钮检测：选择器/文本/行为验证三层，仅行为验证通过才判定
│   │   ├── color.ts              # 颜色工具：提取页面主色（递归 var()）、检测亮暗、生成按钮颜色
│   │   ├── form.ts               # 形态推断：采样交互元素多数倾向推断圆角/材质
│   │   ├── site-presets.ts       # 高流量站点视觉预设（圆角/材质倾向，6 条）
│   │   ├── injector.ts           # 按钮注入器：双模式 DOM、圆角/材质/图标样式
│   │   └── animator.ts           # 动画控制器：纯 opacity 淡入淡出、按压动画、滚动锁定
│   ├── options/
│   │   ├── index.html            # 选项页面 HTML
│   │   └── options.ts            # 选项页面逻辑：直读 storage.sync 加载/保存设置
│   └── assets/
│       ├── icon-16.svg           # 16x16 扩展图标
│       ├── icon-48.svg           # 48x48 扩展图标
│       └── icon-128.svg          # 128x128 扩展图标
└── dist/                         # 构建产物（gitignore）
```

## 架构说明

### 两层架构（无 Service Worker）

扩展分为两个执行上下文，共享 `src/shared/settings.ts`，通过 `chrome.storage.sync` 直接通信，无 Background SW：

1. **Content Script** (`content-script/main.ts`)：注入到所有页面，是核心逻辑的编排者。执行流程为：

   ```
   init() 调用
     → loadSettings()               // 读 storage.sync；禁用/黑名单则短路
     → detectExistingTopButton()    // 检测页面是否已有按钮
     → getPageColors(settings)      // 提取页面主色和主题（含 override）
     → getVisualConfig(settings)    // 形态：启发 → 站点预设 → 用户 override
     → detectRightToolbar()         // 检测右侧工具栏（按 injectionMode）
     → injectButton()               // 注入按钮（工具栏/悬浮）
     → setupScrollVisibility()      // 绑定滚动可见性（含 visibleOpacity）
     → attachClickHandler()         // 绑定点击事件
   ```

   同时设置 SPA 路由监听器（`setupSPAWatcher`）和 `chrome.storage.onChanged` 监听器，在 URL 变化、DOM 大改或选项页改动时重新执行 `init()`。`gen` token 防止并发重入。

2. **Options Page** (`options/`)：独立的选项页面，通过 `loadSettings()` 直读 `storage.sync`，修改后通过 `saveSettings()` 写回。由于内容脚本也监听 `storage.onChanged`，选项改动对已打开标签页实时生效。

### 按钮注入与动画流程

- 注入器（`injector.ts`）首先按 `injectionMode` 决定：`floating` 强制悬浮；`toolbar` 强制工具栏（无工具栏则不注入）；`auto` 调用 `detectRightToolbar()` 扫描页面中 `position: fixed` 或 `position: sticky` 的右侧窄条容器，找到则工具栏模式，否则悬浮模式。工具栏模式小尺寸、透明背景、仅悬停时显示淡色背景；悬浮模式固定定位、圆角矩形，材质按 `visualStyle` 决定是否带毛玻璃和阴影。
- 形态（圆角 + 材质）由 `form.ts` 的 `getVisualConfig()` 合并三源得到：通用启发（采样 ≤20 个交互元素的 `border-radius`/`box-shadow` 取多数）→ 站点预设（`site-presets.ts`，6 条高流量站点）→ 用户 override（`cornerStyle`/`visualStyle` 非 `auto` 时强制）。
- 动画控制器（`animator.ts`）通过 `requestAnimationFrame` 节流的 `scroll` 事件监听滚动位置。当滚动超过 `1.5` 倍视口高度时调用 `showButton()`（设 `opacity` 为 `visibleOpacity`，由设置的不透明度推导）；当滚动回顶部时调用 `hideButton()`（`opacity: 0`）。淡入淡出由注入器设的 `transition: opacity 0.3s ease-out` 驱动，纯 opacity、无位移。
- 点击按钮时触发按压动画（`sbt-press` 关键帧，`scale(0.92)→1` 无过冲，`0.2s ease-out`），然后执行 `window.scrollTo({ top: 0, behavior: 'smooth' })`，同时通过 `hideUntilManualScroll()` 锁定按钮，防止在平滑滚动过程中重新出现——只有用户再次手动滚动超过阈值后才会解除锁定。

### 自适应配色机制

`color.ts` 实现了主色提取策略（用户设了合法 `primaryColor` 则跳过提取直接用）：

1. 优先从 CSS 自定义属性中提取。扫描 `--primary`、`--color-primary`、`--accent`、`--brand-color` 等 13 个常见 CSS 变量名，对 `var()` 嵌套引用做递归解析（含 `var(--x, fallback)` 语法，深度上限 5）。
2. 其次从页面第一个非默认颜色的 `<a>` 链接的 `color` 计算值中提取（扫前 5 个有文本的链接）。
3. 再次从第一个 `<a>`/`<button>` 交互元素颜色提取。
4. 兜底使用 `#1a73e8`（Google Blue）。

亮暗主题检测也分两层（用户设了 `themeMode` 非 `auto` 则强制）：

1. 检查 `<html>` 和 `<body>` 上的 `data-theme`、`class` 等标记（如 `dark`、`theme-dark`、`dark-mode`）。
2. 若未找到标记，用 `computeBrightness()` 计算 `body` 背景色的亮度值（公式 `(R*299 + G*587 + B*114) / 1000`），小于 128 判定为暗色。

最终通过 `getButtonColors()` 根据主色和主题生成按钮的背景色、图标色和悬停色：暗色模式下将主色变亮作为背景，亮色模式下将主色变暗作为背景。

## 权限说明

| 权限 | 用途 |
|------|------|
| `storage` | 通过 `chrome.storage.sync` 存储和同步扩展设置（全局开关、主题模式、圆角/材质、禁用网站列表等） |
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

构建产物输出到 `dist/` 目录。构建流程（`scripts/assemble.mjs`）：

1. 内容脚本以 **IIFE** 格式打包（`js/main.js`）——内容脚本作为 classic script 注入，顶层 `import`/`export` 会报 `SyntaxError`，单入口 IIFE 把所有依赖内联。
2. 选项页以 **ES module** 格式打包（`js/options.js`），配合 `<script type="module">`。
3. 拷贝 SVG 图标到 `dist/assets/`。
4. 读取 `src/options/index.html`，把 `src="./options.ts"` 改写为 `src="js/options.js"`，输出 `dist/options.html`。
5. 从源 `manifest.json` **派生** `dist/manifest.json`：`content_scripts[].js` 的 `src/.../*.ts` → `js/{basename}.js`，`icons`/`action.default_icon` 的 `src/assets/...` → `assets/...`，`options_page` → `options.html`，其余字段透传。

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

此外，每个候选元素通过 `scoreCandidate()` 打分，综合考虑位置（浮动靠近右下角 +2 分）、箭头语义（+2 分）、尺寸（< 80px +1 分）、是否在导航/菜单内部（-2 分）等因素。得分大于 0 的前 3 个候选进入行为验证；**只有行为验证通过的元素才被认定为"已有按钮"**，否则一律注入自己的按钮（扩展的核心承诺是页面没有可验证的回顶按钮时就提供按钮）。检测器还吸收了 Maxun 分页检测器的一条复合选择器 `[class*="scroll"][class*="top"]`（命中 `class="scroll top"` 这类命名）。

### 2. 自适应配色（color.ts）

颜色的提取和计算是"自适应融入"的核心。`getPageColors(settings)` 的提取顺序如下（用户设了合法 `primaryColor` 则直接用，跳过提取）：

```
CSS 自定义属性（13 个常见变量名，递归解析 var()）
  → 页面第一个非默认颜色的 <a> 链接颜色（前 5 个）
  → 第一个非默认颜色的 <button>/<a> 交互元素颜色
  → 兜底 #1a73e8
```

得到主色后，`getButtonColors()` 根据亮暗主题生成三组颜色（用户设了 `themeMode` 非 `auto` 则强制主题，跳过检测）：

- 亮色页面：背景 = 主色加深 10%，悬停 = 主色加深 25%，图标 = 白色
- 暗色页面：背景 = 主色变亮 30%，悬停 = 主色变亮 50%，图标 = 白色

`darkenColor()` 和 `lightenColor()` 基于 RGB 通道线性插值，`rgbToHex()` 将 `getComputedStyle` 返回的 `rgb()` 字符串标准化为 `#rrggbb` 格式。

### 3. 形态融入（form.ts + site-presets.ts）

按钮的圆角和材质由 `getVisualConfig(settings, hostname)` 合并三源决定：

- **通用启发**（`form.ts`）：采样 ≤20 个交互元素（`button`、`a[class]`、`[role=button]`、`.btn` 等），读 `border-radius` 取中位数映射到 `square`(<4px)/`soft`(4–14px)/`pill`(>14px)；读 `box-shadow`/`backdrop-filter` 是否非 none 多数决定 `elevated`/`flat`。采样不足 5 个时圆角回退 `soft`、材质回退 `elevated`。
- **站点预设**（`site-presets.ts`）：6 条高流量站点（GitHub 方角扁平、X/Twitter 胶囊扁平、Bilibili 柔角浮起、知乎柔角扁平、Stack Overflow 方角扁平）覆盖其视觉特征鲜明的轴。子域命中裸域。
- **用户 override**：`cornerStyle`/`visualStyle` 非 `auto` 时强制，覆盖前两者。

注入器把解析后的圆角（floating: square 2 / soft 8 / pill 22；toolbar 各自半高）和材质（flat = 无阴影无毛玻璃；elevated = 阴影 + `backdrop-filter: blur(4px)`）应用到按钮。

### 4. 滚动可见性锁定机制（animator.ts）

`setupScrollVisibility()` 中的 `hideUntilManualScroll()` 实现了一个精妙的锁定机制，解决了一类常见问题：用户点击"返回顶部"后，按钮在平滑滚动过程中会经过阈值位置，如果不加锁，按钮会立即重新出现，造成视觉闪烁。

实现方式：

- 点击时设置 `lockUntilThresholdCycle = true` 和 `hasBeenAboveThresholdSinceLock = false`
- 在 `onScroll()` 中，只有当 `hasBeenAboveThresholdSinceLock` 变为 `true`（用户已手动滚动回顶部以上）后，才允许按钮再次显示
- 锁定期间按钮始终保持隐藏（`opacity: 0`、`pointer-events: none`）
- 滚动事件通过 `requestAnimationFrame` 节流，避免频繁计算影响性能

可见性切换为纯 `opacity` transition（注入器设 `transition: opacity 0.3s ease-out`），无位移，避免小按钮的"弹跳感"。按压动画 `sbt-press` 为 `scale(0.92)→1` 无过冲，`0.2s ease-out`，flat 与 Material 风格站点都成立。`visibleOpacity` 由设置的不透明度推导（`opacity / 100`）。