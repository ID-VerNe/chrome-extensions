package main

import (
	"sync"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

// Win32 constants and declarations for window enumeration and activation.
const (
	_SW_RESTORE = 9
	_SW_SHOW    = 5
	_GW_OWNER   = 4
	_PATH_MAX   = 1024

	_VK_MENU          = 0x12 // Alt virtual-key code
	_KEYEVENTF_KEYUP  = 0x0002
	_PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
)

var (
	user32                      = windows.NewLazySystemDLL("user32.dll")
	kernel32                    = windows.NewLazySystemDLL("kernel32.dll")
	pEnumWindows                = user32.NewProc("EnumWindows")
	pIsWindowVisible            = user32.NewProc("IsWindowVisible")
	pGetWindowThreadProcessId   = user32.NewProc("GetWindowThreadProcessId")
	pSetForegroundWindow        = user32.NewProc("SetForegroundWindow")
	pShowWindow                 = user32.NewProc("ShowWindow")
	pIsIconic                   = user32.NewProc("IsIconic")
	pGetWindow                  = user32.NewProc("GetWindow")
	pGetClassNameW             = user32.NewProc("GetClassNameW")
	pGetWindowTextLengthW       = user32.NewProc("GetWindowTextLengthW")
	pGetWindowRect              = user32.NewProc("GetWindowRect")
	pOpenProcess                = kernel32.NewProc("OpenProcess")
	pCloseHandle                 = kernel32.NewProc("CloseHandle")
	pQueryFullProcessImageNameW = kernel32.NewProc("QueryFullProcessImageNameW")
	pkeybd_event                = user32.NewProc("keybd_event")
)

type rect struct {
	Left, Top, Right, Bottom int32
}

var (
	enumWindowsCallback uintptr
	enumTarget          string
	enumFound           uintptr
	enumMu              sync.Mutex
)

func init() {
	enumWindowsCallback = syscall.NewCallback(enumWindowsProc)
}

func enumWindowsProc(hwnd, _ uintptr) uintptr {
	if !isWindowVisible(hwnd) {
		return 1 // continue
	}
	if getWindow(hwnd, _GW_OWNER) != 0 {
		return 1 // skip child/owned windows
	}
	if className(hwnd) != "Chrome_WidgetWin_1" {
		return 1 // Chrome/Edge main window class only
	}
	if !isValidBrowserWindow(hwnd) {
		return 1 // skip utility / background / zero-size widgets
	}
	if eqi(processExeName(hwnd), enumTarget) {
		enumFound = hwnd
		return 0 // stop enumeration
	}
	return 1
}

func windowTextLength(hwnd uintptr) int {
	r, _, _ := pGetWindowTextLengthW.Call(hwnd)
	return int(r)
}

func windowRect(hwnd uintptr) (width int, height int) {
	var r rect
	ret, _, _ := pGetWindowRect.Call(hwnd, uintptr(unsafe.Pointer(&r)))
	if ret == 0 {
		return 0, 0
	}
	return int(r.Right - r.Left), int(r.Bottom - r.Top)
}

func isValidBrowserWindow(hwnd uintptr) bool {
	if windowTextLength(hwnd) <= 0 {
		return false
	}
	// Minimized windows (iconic) have titles and are valid browser windows, but
	// their Win32 rect is collapsed (e.g. -32000, -32000 with dimensions ~160x24).
	if isIconic(hwnd) {
		return true
	}
	w, h := windowRect(hwnd)
	if w <= 200 || h <= 200 {
		return false
	}
	return true
}

// targetExeFor returns the process image name we look for when activating a
// given browser ("chrome.exe" or "msedge.exe").
func targetExeFor(browser string) string {
	if browser == "chrome" {
		return "chrome.exe"
	}
	return "msedge.exe"
}

// activateBrowserWindow finds a top-level visible window whose owner process
// matches the target browser and brings it to the foreground. Best-effort:
// any error is swallowed because focus is a UX enhancement, not correctness.
func activateBrowserWindow(browser string) {
	target := targetExeFor(browser)

	enumMu.Lock()
	enumTarget = target
	enumFound = 0
	_, _, _ = pEnumWindows.Call(enumWindowsCallback, 0)
	found := enumFound
	enumMu.Unlock()

	if found == 0 {
		return
	}
	// Restore if minimized, then focus. The Alt keystroke works around the
	// foreground-lock restriction: SetForegroundWindow silently fails when the
	// caller is not already the foreground process, but synthesizing an Alt
	// keypress resets the foreground lock so the call succeeds.
	if isIconic(found) {
		_, _, _ = pShowWindow.Call(found, _SW_RESTORE)
	} else {
		_, _, _ = pShowWindow.Call(found, _SW_SHOW)
	}
	_, _, _ = pkeybd_event.Call(_VK_MENU, 0, 0, 0)
	_, _, _ = pkeybd_event.Call(_VK_MENU, 0, _KEYEVENTF_KEYUP, 0)
	_, _, _ = pSetForegroundWindow.Call(found)
}

func isWindowVisible(hwnd uintptr) bool {
	r, _, _ := pIsWindowVisible.Call(hwnd)
	return r != 0
}

func isIconic(hwnd uintptr) bool {
	r, _, _ := pIsIconic.Call(hwnd)
	return r != 0
}

func getWindow(hwnd uintptr, cmd uintptr) uintptr {
	r, _, _ := pGetWindow.Call(hwnd, cmd)
	return r
}

func className(hwnd uintptr) string {
	buf := make([]uint16, 256)
	n, _, _ := pGetClassNameW.Call(hwnd,
		uintptr(unsafe.Pointer(&buf[0])),
		uintptr(len(buf)))
	if n == 0 {
		return ""
	}
	return syscall.UTF16ToString(buf[:n])
}

// processExeName returns the lowercase exe name owning the window's process.
// Uses QueryFullProcessImageNameW which works with PROCESS_QUERY_LIMITED_INFORMATION.
func processExeName(hwnd uintptr) string {
	var pid uint32
	_, _, _ = pGetWindowThreadProcessId.Call(hwnd, uintptr(unsafe.Pointer(&pid)))
	if pid == 0 {
		return ""
	}
	h, _, _ := pOpenProcess.Call(_PROCESS_QUERY_LIMITED_INFORMATION, 0, uintptr(pid))
	if h == 0 {
		return ""
	}
	defer pCloseHandle.Call(h)

	name := queryFullProcessImageName(h)
	return baseName(name)
}

func queryFullProcessImageName(h uintptr) string {
	buf := make([]uint16, _PATH_MAX)
	var size uint32 = uint32(len(buf))
	r, _, _ := pQueryFullProcessImageNameW.Call(h, 0,
		uintptr(unsafe.Pointer(&buf[0])),
		uintptr(unsafe.Pointer(&size)))
	if r == 0 {
		return ""
	}
	return syscall.UTF16ToString(buf[:size])
}

// baseName returns the last path segment, lowercased.
func baseName(p string) string {
	if p == "" {
		return ""
	}
	for i := len(p) - 1; i >= 0; i-- {
		switch p[i] {
		case '\\', '/', ':':
			return toLowerASCII(p[i+1:])
		}
	}
	return toLowerASCII(p)
}

func toLowerASCII(s string) string {
	b := []byte(s)
	for i, c := range b {
		if c >= 'A' && c <= 'Z' {
			b[i] = c + ('a' - 'A')
		}
	}
	return string(b)
}

// eqi is a case-insensitive ASCII compare.
func eqi(a, b string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := 0; i < len(a); i++ {
		ca, cb := a[i], b[i]
		if ca >= 'A' && ca <= 'Z' {
			ca += 'a' - 'A'
		}
		if cb >= 'A' && cb <= 'Z' {
			cb += 'a' - 'A'
		}
		if ca != cb {
			return false
		}
	}
	return true
}
