# Tab Sender

在 Chrome 与 Edge 之间用快捷键点击超链接互发标签页，并在扩展弹窗/侧边栏实时查看并管理对端浏览器的标签页。

## 架构

两部分，本地联动：

1. **`tab-bridge.exe`** — Go 编写的本地 WebSocket 桥梁守护进程
   - 监听 `127.0.0.1:18923`，作为 Chrome 与 Edge 之间的 Pub/Sub 中转
   - `Alt+Ctrl` 前台置顶模式下，调用 Win32 `EnumWindows` + `SetForegroundWindow` 把目标浏览器窗口拉到最前
   - 自带开机自启注册（写 `HKCU\...\Run`）
   - 静态编译，`-H windowsgui` 无控制台黑框，内存 ~4MB

2. **`extension/`** — 一份 MV3 扩展，Chrome / Edge 通用
   - `navigator.userAgent` 自动推导自身身份（Edge vs Chrome）与对端
   - `content.js`：`Alt+Shift+点击` 后台静默打开，`Alt+Ctrl+点击` 前台拉起置顶，右下角轻量 Toast
   - `background.js`：WebSocket 长连接 + 断线重连 + Tab 列表防抖同步 + 右键菜单发送
   - `popup.html` / `sidepanel.html`：对端 Tab 看板（搜索 / 一键克隆 / 远程关闭）

## 安装

### 1. 编译并启动桥梁

```powershell
# 编译 tab-bridge.exe（隐藏窗口，剥离调试符号）
powershell -ExecutionPolicy Bypass -File build.ps1

# 后台启动
.\start-bridge.bat

# 注册开机自启（可选）
.\install-autostart.bat
```

验证桥梁已就绪：

```powershell
netstat -ano | findstr :18923
curl http://127.0.0.1:18923/health   # -> {"ok":true,"clients":[]}
```

### 2. 加载扩展

在 Chrome 和 Edge 中各自打开 `chrome://extensions`（或 `edge://extensions`），开启「开发者模式」→「加载已解压的扩展程序」→ 选中本目录下的 `extension/` 文件夹。

两个浏览器都加载后，弹窗/侧边栏顶部的状态点应变绿，并能看到对端的标签页。

## 使用

| 操作 | 效果 |
|---|---|
| `Alt+Shift + 点击超链接` | 在对端浏览器后台静默打开（原页面保留焦点，右下角 Toast 提示） |
| `Alt+Ctrl + 点击超链接` | 在对端浏览器打开并自动把对端窗口激活置顶 |
| 右键链接 / 页面 | 「Send to Chrome/Edge」菜单，后台或前台发送 |
| 弹窗 / 侧边栏 | 搜索对端 Tab，点击在本地打开，悬停「×」远程关闭对端 Tab |
| `Alt+Shift+S` | 打开侧边栏 |

快捷键可在 `chrome.storage.sync` 中自定义（`bgKey` / `fgKey`，格式如 `alt+shift`）。

## 消息协议

桥梁与扩展之间用 JSON 信封 `{ type, data }` 通信：

| 方向 | type | 含义 |
|---|---|---|
| ext → bridge | `register` | 注册自身浏览器身份 |
| ext → bridge | `tabs-update` | 上报本端 Tab 列表 |
| ext → bridge | `open-url` | 请求在对端打开某 URL（`focus` 决定是否置顶） |
| ext → bridge | `close-tab` | 请求远程关闭对端某 Tab |
| bridge → ext | `open-tab` | 在本端打开某 URL |
| bridge → ext | `close-tab-remote` | 在本端关闭某 Tab |
| bridge → ext | `tabs-update` | 透传对端 Tab 列表 |

## 验证记录

- `go vet ./...` 通过，`go build -ldflags "-H windowsgui -s -w"` 产出 6.5MB `tab-bridge.exe`
- 端口监听：`netstat` 显示 `127.0.0.1:18923 LISTENING`
- `/health` 返回 `{"ok":true,"clients":[]}`
- 双端 WS 烟雾测试：chrome 发 `tabs-update` → edge 收到；chrome 发 `open-url focus:false` → edge 收到 `open-tab`；`/health` 列出 `["chrome","edge"]`
- 自启注册：`-autostart` 写入 `HKCU\...\Run\TabSenderBridge`，`-remove-autostart` 清除

## 目录

```
tab-sender/
├── bridge/
│   ├── main.go          # WS 服务器 / 消息中转 / 自启注册
│   ├── windows.go       # Win32 EnumWindows + SetForegroundWindow 激活
│   └── go.mod
├── extension/
│   ├── manifest.json
│   ├── background.js     # SW: WS 长连接 + Tab 同步 + 右键菜单
│   ├── content.js        # 修饰键点击捕获 + Toast
│   ├── content.css
│   ├── popup.html / popup.js / popup.css
│   ├── sidepanel.html    # 复用 popup.js
│   └── icons/           # 16/48/128 PNG（tools/gen-icons 生成）
├── tools/gen-icons/     # 纯标准库 PNG 图标生成器
├── build.ps1            # 编译 tab-bridge.exe
├── start-bridge.bat     # 后台启动
├── install-autostart.bat / uninstall-autostart.bat
└── tab-bridge.exe       # 编译产物
```
