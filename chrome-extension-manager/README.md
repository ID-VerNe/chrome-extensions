# Extension Manager Pro

一个可以快速查看、启用/禁用和管理所有 Chrome 扩展的工具。

## 功能特性

- **扩展列表浏览**：以列表形式展示所有已安装的 Chrome 扩展，显示图标、名称和版本号。
- **启用/禁用切换**：通过开关控件一键启用或禁用任意扩展，无需进入 chrome://extensions 页面。
- **搜索过滤**：实时搜索过滤，按扩展名称快速定位目标扩展。
- **固定排序（Pin）**：将常用扩展固定到列表顶部，支持拖拽调整固定项的顺序，固定状态持久化保存。
- **卸载扩展**：一键卸载，卸载前弹出 Chrome 原生的确认对话框。
- **智能点击**：点击扩展图标或名称区域时，根据扩展状态自动执行不同操作——禁用时启用，启用时打开选项页，无选项页则跳转至 chrome://extensions 详情页。
- **查看详情**：齿轮按钮统一跳转到 Chrome 扩展管理页的该扩展详情页，查看权限、来源等信息。
- **加载状态与空状态**：列表加载时显示旋转动画，搜索无结果时显示提示文字。

## 目录结构

```
chrome-extension-manager/
├── manifest.json                    # 扩展清单文件，定义名称、版本、权限、popup 入口
├── main.js                          # 应用入口，ExtensionManagerApp 类，UI 渲染与事件绑定
├── domain/
│   └── extension_manager.js         # 领域层，封装 chrome.management API 的读写操作
├── interface/
│   ├── popup.html                   # 弹出窗口的 HTML 结构，包含模板和状态占位
│   ├── popup.css                    # 弹出窗口的样式，包含开关、拖拽、动画等样式
│   └── icons/
│       ├── icon_16.png              # 16x16 扩展图标（工具栏）
│       ├── icon_48.png              # 48x48 扩展图标（管理页）
│       └── icon_128.png             # 128x128 扩展图标（Chrome 商店）
└── utils/
    ├── config.js                    # 全局配置，含 DOM 元素 ID、CSS 类名、默认图标 URL
    └── logger.js                    # 日志工具，提供带时间戳和上下文的分层日志
```

## 架构说明

### 分层职责

该扩展采用三层架构，代码组织遵循关注点分离原则：

**domain/ (领域层)**
- 封装与 Chrome 扩展 API 的直接交互，提供 `getAllExtensions`、`setEnabled`、`uninstall`、`openOptionsPage` 四个函数和一个 `storage` 封装对象。
- 所有函数返回 Promise，统一处理 `chrome.runtime.lastError` 错误。
- 上层不直接调用 `chrome.management` 或 `chrome.storage`，而是通过该层间接访问。

**interface/ (界面层)**
- `popup.html` 定义弹出窗口的骨架结构和 `<template>` 模板。
- `popup.css` 提供完整的视觉样式，包括 CSS 变量主题、Flexbox 布局、开关动画、拖拽视觉反馈、加载旋转动画等。
- `main.js` 中的 `ExtensionManagerApp` 类负责所有 UI 逻辑：渲染扩展列表、绑定事件、处理搜索过滤、管理拖拽排序、控制加载/空状态。

**utils/ (工具层)**
- `config.js` 集中管理 DOM 元素 ID 和 CSS 类名等常量，避免硬编码字符串散落在业务代码中。
- `logger.js` 提供带时间戳 `[ISO 时间]`、日志级别 `[DEBUG/INFO/WARN/ERROR]` 和上下文标签 `[MainApp/ExtensionManager]` 的结构化日志输出。

### 消息流

```
用户操作 popup.html
        |
        v
main.js: ExtensionManagerApp
  - init() 启动流程
  - render() 获取数据并渲染
  - filterExtensions() 搜索过滤
  - handleToggle() 启用/禁用
  - handlePin() 固定/取消固定
  - handleUninstall() 卸载
  - 拖拽事件 (dragStart/dragOver/drop/dragEnd)
        |
        v
domain/extension_manager.js
  - getAllExtensions()  -> chrome.management.getAll()
  - setEnabled(id, bool) -> chrome.management.setEnabled()
  - uninstall(id)        -> chrome.management.uninstall()
  - openOptionsPage(url) -> chrome.tabs.create()
  - storage.get/set       -> chrome.storage.local.get/set()
        |
        v
Chrome Extension API
```

### 数据流

1. **初始化数据流**：`init()` 先调用 `loadPinnedExtensions()` 从 `chrome.storage.local` 读取已保存的固定扩展 ID 列表；然后调用 `render()`，其中通过 `getAllExtensions()` 获取所有扩展，通过 `chrome.management.getSelf()` 排除自身，过滤出 `type === 'extension'` 的项，按固定状态和名称排序后逐个渲染。

2. **状态变更数据流**：用户操作（切换开关、拖拽排序、固定/取消固定）触发对应 handler，handler 调用 `domain/extension_manager.js` 的 API 写入 Chrome 状态，然后在成功或失败后更新 UI（成功时重绘列表，失败时回滚 UI 状态）。

3. **持久化数据流**：固定扩展的 ID 列表通过 `chrome.storage.local` 读写，以 `{ pinned: string[] }` 格式存储。其他数据（扩展列表、启用状态）由 Chrome 自身管理，不额外持久化。

## 权限说明

manifest.json 中声明了两个权限：

| 权限 | 用途 |
|------|------|
| `management` | 允许扩展调用 `chrome.management` API，用于获取已安装扩展列表 (`getAll`)、启用/禁用扩展 (`setEnabled`)、卸载扩展 (`uninstall`)。这是本扩展的核心功能依赖。 |
| `storage` | 允许使用 `chrome.storage.local` 持久化存储固定扩展的 ID 列表，确保用户关闭弹出窗口后固定顺序不会丢失。 |

扩展不请求任何主机权限（`host_permissions`），仅操作自身 UI 和 Chrome 管理 API，不会读取或修改网页内容。

## 安装与使用

### 开发者模式加载

1. 在 Chrome 地址栏输入 `chrome://extensions` 并按回车。
2. 开启右上角的 **"开发者模式"** 开关。
3. 点击左上角的 **"加载已解压的扩展"** 按钮。
4. 在弹出的文件选择器中，选择 `chrome-extension-manager/` 目录（即 `manifest.json` 所在的文件夹）。
5. 加载成功后，Chrome 工具栏会出现扩展图标，点击即可使用。

### 基本使用流程

1. 点击 Chrome 工具栏中的扩展图标，弹出管理窗口。
2. 列表中展示所有已安装的扩展（排除自身），每个扩展项显示图标、名称、版本号。
3. **启用/禁用**：点击扩展项右侧的开关滑块，立即切换扩展的启用状态。
4. **搜索**：在顶部的搜索框中输入关键字，列表实时过滤出名称匹配的扩展。
5. **固定**：点击扩展项上的图钉按钮，将其固定到列表顶部。已固定的扩展项背景变为浅蓝色，且图钉按钮高亮。
6. **拖拽排序**：已固定的扩展项支持拖拽，拖拽时目标位置出现蓝色指示线，松开后保存新顺序。
7. **查看详情**：点击齿轮按钮，在新建标签页中打开 `chrome://extensions/?id=xxx` 详情页。
8. **卸载**：点击垃圾桶按钮，Chrome 弹出确认对话框，确认后卸载。

### 特殊交互

点击扩展的图标或名称区域时，行为取决于扩展当前的启用状态：

- 如果扩展当前**禁用**，则直接启用它。
- 如果扩展当前**启用**且有选项页（`optionsUrl`），则打开选项页。
- 如果扩展当前**启用**但无选项页，则跳转到 `chrome://extensions/?id=xxx` 的详情页。

## 关键实现细节

### 1. 获取扩展列表：`chrome.management.getAll()` 的过滤与排序

在 `domain/extension_manager.js` 中，`getAllExtensions()` 函数通过 Promise 封装 `chrome.management.getAll()` 获取所有已安装的扩展/应用：

```javascript
const getAllExtensions = async () => {
    const extensions = await new Promise((resolve) => {
        chrome.management.getAll(resolve);
    });
    return extensions;
};
```

在 `main.js` 的 `render()` 方法中，获取到列表后做了两件事：

- **过滤**：排除自身（`chrome.management.getSelf()` 返回的当前扩展 ID）和非扩展类型（`ext.type !== 'extension'`，排除主题、应用等）。
- **排序**：先按固定状态排序——固定项排在最前面，且固定项之间按用户定义的固定顺序（`this.pinnedExtensions` 数组中的索引顺序）排列，未固定项则按扩展名称的字母顺序排列。

### 2. 启用/禁用扩展：`chrome.management.setEnabled()` 与 UI 回滚

`domain/extension_manager.js` 中的 `setEnabled()` 函数封装了 `chrome.management.setEnabled(id, enabled, callback)`，通过 Promise 包装并检查 `chrome.runtime.lastError` 来捕获错误。

在 `main.js` 的 `handleToggle()` 方法中，切换开关时先乐观更新 UI（立即切换 `disabled` 类名），然后调用 `setEnabled` 写入 Chrome。如果写入失败（例如用户没有权限操作某个扩展），则**回滚 UI 状态**：

```javascript
async handleToggle(event, id, itemElement) {
    const isEnabled = event.target.checked;
    itemElement.classList.toggle(CONFIG.CSS_CLASSES.ITEM_DISABLED, !isEnabled);
    try {
        await setEnabled(id, isEnabled);
    } catch (error) {
        event.target.checked = !isEnabled;
        itemElement.classList.toggle(CONFIG.CSS_CLASSES.ITEM_DISABLED, isEnabled);
    }
}
```

这种乐观更新 + 回滚的机制让 UI 反馈更即时，同时保证数据一致性。

### 3. 固定排序的持久化与拖拽重排

固定功能涉及三个层面的配合：

**持久化**：固定列表存储在 `chrome.storage.local` 中，键名为 `pinned`，值为扩展 ID 的字符串数组。所有变更（固定/取消固定、拖拽重排）都通过 `storage.set({ pinned: ... })` 写入，`render()` 每次渲染时通过 `loadPinnedExtensions()` 重新读取。

**拖拽 API**：使用 HTML5 原生拖拽（Drag and Drop）API，四个事件组成完整流程：

- `dragstart`：记录被拖拽的 DOM 元素。
- `dragover`：阻止默认行为以允许放置，仅在目标元素也是固定项时添加视觉反馈。
- `drop`：交换 `pinnedExtensions` 数组中两个 ID 的位置，写入存储后重新渲染。
- `dragend`：清理拖拽状态和所有视觉高亮。

**约束**：只有已固定的扩展项才可拖拽（`draggable = true`），且只能拖拽到其他固定项的位置上。`handleDragOver` 中通过检查 `targetId` 是否在 `this.pinnedExtensions` 数组中来确保这一点。

### 已知问题

- `popup.html` 第 48 行的 `<script>` 标签中 `src` 路径为 `../application/main.js`，但实际 `main.js` 位于扩展根目录。正确的路径应为 `../main.js`。当前配置下该模块将无法加载，修正后方可正常启动。

---

*此 README 基于源码 v1.0.0 撰写。*