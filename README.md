# Chrome Extensions 合集

精选的 Chrome 扩展源码集合，涵盖夜间模式、标签管理、隐私工具、页面增强等实用功能。

每个扩展均可独立安装使用，所有源码可自由查阅和修改。

---

## 扩展列表

### 1. Global Dark Mode — 全局夜间模式

默认对所有网站开启智能暗色，可按站点关闭。基于 darkreader 引擎，支持亮度/对比度/色温调节、背景色和文本色自定义，跨设备同步设置。

- 技术栈：Manifest V3, darkreader, esbuild
- 关键特性：CSP 兼容、白闪防护、跨域 CSS 代理
- [源码](./global-dark-mode/) | [安装说明](./global-dark-mode/README.md)

### 2. Chrome Tab Organizer — 标签页自动分类

一键将当前窗口的所有标签页按域名、关键词或自定义规则分组到不同窗口。支持黑名单、两种分类模式、持久化窗口映射，可配置快捷键触发。

- 技术栈：Manifest V3, 原生 JS
- 关键特性：URL 解析、通配符模式匹配、窗口管理策略
- [源码](./chrome-tab-organizer/) | [安装说明](./chrome-tab-organizer/README.md)

### 3. Extension Manager Pro — 扩展管理器

在弹出面板中快速启用/禁用其他扩展，支持搜索、拖拽排序、状态过滤。告别 chrome://extensions 页面，直接在工具栏管理所有扩展。

- 技术栈：Manifest V3, chrome.management API
- 关键特性：乐观更新与回滚、拖拽排序持久化、批量操作
- [源码](./chrome-extension-manager/) | [安装说明](./chrome-extension-manager/README.md)

### 4. Sage DLP — Cookie 导出工具

一键导出当前网站所有 Cookie，支持 JSON / Netscape / Header 三种格式，可自动发送到指定 API 端点或保存为文件。内置防抖和去重机制。

- 技术栈：Manifest V3, Chrome Cookie API
- 关键特性：partitionKey 兼容、多格式序列化、自动发送
- [源码](./sage-dlp/) | [安装说明](./sage-dlp/README.md)

### 5. Storage Export/Import — Chrome 存储导出导入

图形化导出和导入 `chrome.storage` 中的所有数据，适用于跨浏览器迁移扩展配置、调试或备份。支持 `chrome.storage.local` 和 `chrome.storage.sync`。

- 技术栈：Manifest V3, 原生 JS
- 关键特性：Data URL 下载、防重名哈希、函数注入读取
- [源码](./storage-export-import/) | [安装说明](./storage-export-import/README.md)

### 6. Smart Back to Top — 智能回到顶部

自动在页面右下角注入一个「回到顶部」按钮，支持平滑滚动动画、自适应页面配色、三种滚动检测策略，可配置阈值和触发条件。

- 技术栈：TypeScript, Manifest V3
- 关键特性：自适应配色、三级检测策略、滚动可见性锁定
- [源码](./to-the-top/) | [安装说明](./to-the-top/README.md)

### 7. Muting Tab — 域名静音管理器

按域名全局管理标签页静音状态。设置某个域名"静音"后，该域名下的所有标签页（包括新打开的）都会自动静音。支持批量静音/取消静音、域名列表管理。

- 技术栈：Manifest V3, 原生 JS
- 关键特性：PSL 域名分组、静音状态持久化与强制同步、批量渲染优化
- [源码](./muting-tab/) | [安装说明](./muting-tab/README.md)

---

## 安装方式

所有扩展均以开发者模式加载：

1. 打开 Chrome，访问 `chrome://extensions`
2. 开启右上角的「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择对应扩展的目录（如 `global-dark-mode/`）
5. 安装完成后，扩展图标会出现在工具栏

> 部分扩展（如 to-the-top）需要先构建：进入对应目录执行 `npm install && npm run build`，然后加载 `dist/` 目录。

---

## 许可

本项目下的所有扩展均为开源软件。具体许可协议请参阅各扩展目录下的 `LICENSE` 文件（如有）或联系原作者。