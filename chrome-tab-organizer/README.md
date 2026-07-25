# Chrome Tab Organizer

根据用户自定义规则，自动将 Chrome 标签页整理到不同窗口的浏览器扩展。

## 功能特性

- **全量分类整理**：点击扩展工具栏图标，一键将所有打开的标签页按规则分配到不同窗口
- **自定义分组规则**：支持 URL 通配符模式匹配，将特定网站归入自定义命名窗口
- **黑名单机制**：匹配黑名单的标签页不会被移动，保留在原窗口
- **两种分类模式**：支持按 Hostname（如 `google.com`）或按 TLD（如 `google.com`、`github.io`）分类
- **可视化配置页**：通过 `options.html` 提供图形界面管理所有规则
- **空窗口自动清理**：标签页移走后，自动关闭空的分类窗口
- **窗口映射持久化**：Service Worker 重启后自动恢复分类窗口与标识符的映射关系
- **触发方式灵活**：支持工具栏图标点击触发，也支持通过 `chrome.runtime.sendMessage` 以编程方式触发

## 目录结构

```
chrome-tab-organizer/
├── manifest.json              # 扩展清单文件，声明权限、入口、图标等
├── background.js              # Service Worker 主文件，注册事件监听器并协调各模块
├── startup_classifier.js      # 封装全量分类逻辑，负责将标签页分组到不同窗口
├── options.html               # 设置页面的 HTML 结构
├── options.css                # 设置页面的样式
├── options.js                 # 设置页面的交互逻辑，加载/保存配置
├── icons/
│   ├── icon16.png             # 16x16 工具栏图标
│   ├── icon48.png             # 48x48 扩展管理页图标
│   ├── icon128.png            # 128x128 Chrome 网上应用店图标
│   └── logo_generated.png     # 生成的 Logo 源文件
├── services/
│   ├── classification_service.js  # 核心分类逻辑，按优先级匹配规则并计算分类标识符
│   ├── tab_manager.js             # 封装 Chrome Tabs API，提供标签页移动、查询、创建窗口
│   └── window_manager.js          # 管理分类窗口与标识符的双向映射，处理空窗口自动关闭
└── utils/
    ├── config.js              # 配置管理器，从 chrome.storage.sync 读取/保存配置
    ├── logger.js              # 统一日志工具，带模块前缀的 debug/info/warn/error 分级输出
    ├── pattern_matcher.js     # URL 模式匹配工具，支持通配符 * 的匹配逻辑
    └── url_parser.js          # URL 解析工具，提取 hostname、TLD 或特殊协议标识符
```

## 架构说明

### 分层设计

扩展采用三层架构，各层职责清晰：

```
背景层 (Background)
  background.js          -- 入口与事件调度
  startup_classifier.js  -- 全量分类编排

服务层 (Services)
  classification_service.js  -- 分类规则引擎
  tab_manager.js             -- 标签页操作封装
  window_manager.js          -- 窗口生命周期管理

工具层 (Utils)
  config.js            -- 配置持久化
  logger.js            -- 日志输出
  pattern_matcher.js   -- 通配符匹配
  url_parser.js        -- URL 解析
```

### 规则匹配流程

`classification_service.js` 中的 `getClassificationIdentifier()` 方法按以下优先级判断标签页归属：

1. **自定义分组规则**：遍历 `customGroups` 数组，如果 URL 匹配某个自定义模式，则用该分组名称作为分类标识符（最高优先级）
2. **黑名单检查**：如果 URL 匹配黑名单中的任意模式，返回 `null`，该标签页保留在原窗口
3. **通用分类**：如果以上都不匹配，调用 `getSiteIdentifier()` 根据配置的 `classificationType`（`hostname` 或 `tld`）计算标识符

```javascript
// 优先级顺序代码示意（来自 classification_service.js）
async getClassificationIdentifier(tab) {
    // 1. 自定义分组 (最高优先级)
    for (const group of customGroups) {
        if (this.matchesAnyPattern(tab.url, [group.pattern])) {
            targetIdentifier = group.groupName;
            break;
        }
    }
    // 2. 黑名单 (次优先级)
    if (!isCustomGroup && this.matchesAnyPattern(tab.url, blacklist)) {
        return null;
    }
    // 3. 通用网站标识符
    if (!targetIdentifier) {
        targetIdentifier = this.getSiteIdentifier(tab.url, classificationType);
    }
    return targetIdentifier;
}
```

### 分窗逻辑

`startup_classifier.js` 中的 `runStartupClassification()` 方法分四个阶段执行：

1. **阶段 1 - 遍历计算**：遍历所有标签页（过滤掉 `chrome://`、`about:` 等特殊页面），调用 `getClassificationIdentifier()` 为每个标签页计算分类标识符，按标识符分组存入 `Map<string, Array<Tab>>`
2. **阶段 2 - 窗口管理**：遍历每个分组，按 `tab.id` 升序排序（`tab.id` 递增反映打开顺序），查找或创建对应窗口，将标签页依次移入
3. **阶段 3 - 空窗口清理**：检查所有原始窗口，调用 `checkAndCloseEmptyWindow()` 关闭已清空的窗口
4. **阶段 4 - 恢复焦点**：重新激活触发分类时用户所在的原始标签页

## 权限说明

| 权限 | 用途 |
|------|------|
| `tabs` | 查询所有标签页（`chrome.tabs.query`）、移动标签页（`chrome.tabs.move`）、获取标签页信息（`chrome.tabs.get`）、更新标签页状态（`chrome.tabs.update`）、监听标签页关闭事件（`chrome.tabs.onRemoved`） |
| `storage` | 使用 `chrome.storage.sync` 持久化用户配置（分类规则、黑名单等），使用 `chrome.storage.session` 持久化分类窗口映射（Service Worker 重启后恢复） |
| `scripting` | 在 manifest 中声明，但当前版本未使用，为未来扩展预留 |
| `<all_urls>` host_permissions | 允许扩展读取所有标签页的 URL 用于分类匹配 |

## 安装与使用

### 开发者模式安装

1. 打开 Chrome 浏览器，在地址栏输入 `chrome://extensions/` 并回车
2. 开启右上角的"开发者模式"开关
3. 点击左上角的"加载已解压的扩展程序"按钮
4. 选择 `chrome-tab-organizer/` 目录
5. 安装成功后，Chrome 工具栏会出现扩展图标

### 基本使用

1. 右键点击工具栏中的扩展图标，选择"选项"进入设置页面
2. 在设置页面中：
   - 选择分类依据：`Hostname`（按域名，如 `google.com` 归为一组）或 `TLD`（按顶级域名，如所有 `.com` 网站归为一组）
   - 添加自定义分组规则：输入 URL 模式（支持 `*` 通配符）和分组名称，点击 "+" 添加
   - 添加黑名单规则：输入 URL 模式，点击 "+" 添加
   - 点击"保存设置"
3. 点击扩展工具栏图标，扩展将根据规则自动整理所有标签页到不同窗口
4. 保存设置后扩展会自动触发一次全量分类，无需手动点击

### 配置示例

**自定义分组规则**：
- 模式：`*://github.com/*`，分组名：`GitHub`
- 模式：`*://*.youtube.com/*`，分组名：`YouTube`
- 模式：`*://mail.google.com/*`，分组名：`Gmail`

**黑名单规则**：
- 模式：`*://*.google.com/maps/*`  —— 地图页面不被分类
- 模式：`*://localhost:*/*`  —— 本地开发环境不被分类

## 关键实现细节

### 1. URL 解析与分类标识符提取

`url_parser.js` 中的 `getSiteIdentifier()` 函数负责将 URL 转换为分类标识符。它有两种工作模式：

- **Hostname 模式**：直接返回 `url.hostname`，例如 `https://www.google.com/search?q=test` 的标识符是 `www.google.com`
- **TLD 模式**：通过 `getTld()` 函数取 hostname 的最后两部分，例如 `www.google.com` 的标识符是 `google.com`，这意味着 `mail.google.com` 和 `www.google.com` 会被分到同一窗口

对于特殊协议（`chrome://`、`file://`、`data:`），函数会构造特殊的标识符，例如 `chrome://extensions/` 的标识符是 `chrome://extensions`。`data:` URL 还会尝试提取其中的 MIME 类型作为标识符。

注意：当前 TLD 实现是简化的，对于 `co.uk`、`com.cn` 等二级公共后缀，简单的 `parts.slice(-2)` 方式无法正确识别。如果需要精确的 TLD 解析，建议引入公共后缀列表（Public Suffix List）库。

### 2. 通配符模式匹配

`pattern_matcher.js` 中的 `matchesPattern()` 函数实现了轻量级的 URL 通配符匹配。核心思路是将通配符模式转换为正则表达式：

```javascript
// 核心转换逻辑
const regexPattern = '^' + pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')  // 转义正则特殊字符
    .replace(/\*/g, '.*')                    // 将 * 替换为 .*
    + '$';
```

例如，模式 `*://github.com/*` 会被转换为 `^.*://github\.com/.*$`，可以匹配任意协议的 GitHub URL。这种实现方式简单高效，无需引入第三方依赖，但需要注意 `*` 的贪婪匹配行为——在正则中 `.*` 会尽可能匹配更多字符，这在 URL 匹配场景中是符合预期的。

### 3. 窗口管理策略与持久化

`window_manager.js` 维护了两张双向映射表来跟踪分类窗口：

- `_classificationWindowMap`：`Map<分类标识符, 窗口ID>`，用于查找某个分类对应的窗口
- `_windowClassificationMap`：`Map<窗口ID, 分类标识符>`，用于反向查找，窗口关闭时清理映射

当创建新窗口时，`registerClassificationWindow()` 方法会同步更新两个映射，并通过 `chrome.storage.session` 持久化。`chrome.storage.session` 是 Manifest V3 提供的内存存储，在 Service Worker 重启后仍然保留，但浏览器关闭后会被清除——这符合扩展的使用场景，因为浏览器重启后窗口状态已经不连续了。

`loadPersistedWindows()` 在 Service Worker 启动时调用，它会从存储中加载映射数据，并逐条验证窗口是否仍然存在（通过 `chrome.windows.get()`），自动清理无效记录。这使得扩展在 Service Worker 被浏览器回收（Manifest V3 的典型行为）后重新激活时，能够正确恢复窗口状态。

空窗口检测逻辑在 `checkAndCloseEmptyWindow()` 中实现：仅当窗口是扩展管理的分类窗口，且不包含任何非新标签页（`chrome://newtab/` 之外的页面）时，才关闭该窗口。这避免了误关闭用户手动打开的空白窗口。