// Command tab-bridge is a local WebSocket bridge that relays tab/control messages
// between Chrome and Edge instances of the Tab Sender extension, and raises the
// target browser window to the foreground when a tab is opened in "focus" mode.
//
// It listens on 127.0.0.1:18923, runs hidden (no console window) when built with
// -H windowsgui, and supports registering itself for Windows auto-start.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/gorilla/websocket"
	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
)

const (
	defaultAddr  = "127.0.0.1:18923"
	autostartKey = `Software\Microsoft\Windows\CurrentVersion\Run`
	autostartVal = "TabSenderBridge"

	// Message types exchanged with the extension (see extension/background.js).
	msgRegister   = "register"
	msgTabsUpdate = "tabs-update"
	msgOpenURL    = "open-url"
	msgCloseTab   = "close-tab"
	msgOpenReq    = "open-tab"         // bridge -> extension
	msgCloseReq   = "close-tab-remote" // bridge -> extension
)

// envelope is the wire format shared with extension/background.js.
type envelope struct {
	Type string          `json:"type"`
	Data json.RawMessage `json:"data,omitempty"`
}

type registerData struct {
	Browser string `json:"browser"` // "chrome" or "edge"
}

type openURLData struct {
	URL      string `json:"url"`
	Focus    bool   `json:"focus"`
	Target   string `json:"target,omitempty"` // override recipient
	Source   string `json:"source,omitempty"` // who sent it
	SendTime int64  `json:"sendTime,omitempty"`
}

type tabInfo struct {
	ID    int    `json:"id"`
	URL   string `json:"url"`
	Title string `json:"title"`
	Fav   string `json:"fav,omitempty"`
	Incog bool   `json:"incognito,omitempty"`
}

type tabsUpdateData struct {
	Browser string    `json:"browser"`
	Tabs    []tabInfo `json:"tabs"`
}

type closeTabData struct {
	Target string `json:"target"`
	TabID  int    `json:"tabId"`
}

// clientConn wraps websocket.Conn with a mutex to ensure gorilla/websocket's
// single-writer contract is respected across concurrent goroutines.
type clientConn struct {
	conn *websocket.Conn
	mu   sync.Mutex
}

func (c *clientConn) writeEnvelope(env envelope) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	_ = c.conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
	return c.conn.WriteJSON(env)
}

func (c *clientConn) close() error {
	return c.conn.Close()
}

// bridge holds registered clients keyed by browser name, cached tabs, pending
// open requests, plus relay counters surfaced via /health.
type bridge struct {
	mu          sync.RWMutex
	clients     map[string]*clientConn
	lastTabs    map[string][]tabInfo     // browser -> last known tabs snapshot
	pendingOpen map[string][]openURLData // target browser -> queued open-url requests

	// relay counters (all under mu)
	countRegister   map[string]int // per browser, number of (re)connections
	countTabsUpdate int
	countOpenURL    int
	countCloseTab   int
	countOpenReq    int
	countCloseReq   int
	lastActivity    time.Time
}

var upgrader = websocket.Upgrader{
	// Mitigate CSWSH: only accept browser requests originating from extension
	// contexts or local non-browser clients (empty Origin), rejecting arbitrary web origins.
	CheckOrigin: func(r *http.Request) bool {
		origin := strings.ToLower(r.Header.Get("Origin"))
		if origin == "" {
			return true
		}
		if strings.HasPrefix(origin, "chrome-extension://") || strings.HasPrefix(origin, "edge-extension://") {
			return true
		}
		log.Printf("[bridge] rejected ws origin: %s", origin)
		return false
	},
}

func newBridge() *bridge {
	return &bridge{
		clients:       make(map[string]*clientConn),
		lastTabs:      make(map[string][]tabInfo),
		pendingOpen:   make(map[string][]openURLData),
		countRegister: make(map[string]int),
	}
}

func (b *bridge) touch() { b.lastActivity = time.Now() }

// store registers a client under its browser name, replacing any prior conn.
func (b *bridge) store(name string, c *websocket.Conn) *clientConn {
	b.mu.Lock()
	defer b.mu.Unlock()
	if old, ok := b.clients[name]; ok && old.conn != c {
		_ = old.close()
	}
	cc := &clientConn{conn: c}
	b.clients[name] = cc
	b.countRegister[name]++
	b.touch()
	log.Printf("[bridge] client registered browser=%s total_reg=%d now_connected=%d",
		name, b.countRegister[name], len(b.clients))
	return cc
}

func (b *bridge) drop(name string, c *websocket.Conn) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if cur, ok := b.clients[name]; ok && cur.conn == c {
		delete(b.clients, name)
		log.Printf("[bridge] client dropped browser=%s now_connected=%d", name, len(b.clients))
	}
}

// peer returns the clientConn for the browser that is NOT the given one.
func (b *bridge) peer(self string) *clientConn {
	b.mu.RLock()
	defer b.mu.RUnlock()
	for name, c := range b.clients {
		if name != self {
			return c
		}
	}
	return nil
}

func (b *bridge) conn(name string) *clientConn {
	b.mu.RLock()
	defer b.mu.RUnlock()
	return b.clients[name]
}

// sendCachedTabs immediately sends the last known tabs snapshot of the peer to client.
func (b *bridge) sendCachedTabs(peerName string, client *clientConn) {
	b.mu.RLock()
	tabs, ok := b.lastTabs[peerName]
	b.mu.RUnlock()
	if !ok || len(tabs) == 0 {
		return
	}
	data, err := json.Marshal(tabsUpdateData{Browser: peerName, Tabs: tabs})
	if err != nil {
		return
	}
	log.Printf("[bridge] sending cached peer tabs (count=%d) from %s to newly connected browser", len(tabs), peerName)
	_ = client.writeEnvelope(envelope{Type: msgTabsUpdate, Data: data})
}

// flushPendingOpen sends any open-url requests that arrived while browser was disconnected.
func (b *bridge) flushPendingOpen(browser string, client *clientConn) {
	b.mu.Lock()
	queued := b.pendingOpen[browser]
	delete(b.pendingOpen, browser)
	b.mu.Unlock()

	if len(queued) == 0 {
		return
	}
	log.Printf("[bridge] flushing %d queued open-url messages to %s", len(queued), browser)
	shouldFocus := false
	for _, d := range queued {
		out, err := json.Marshal(d)
		if err != nil {
			continue
		}
		if err := client.writeEnvelope(envelope{Type: msgOpenReq, Data: out}); err == nil {
			b.mu.Lock()
			b.countOpenReq++
			b.mu.Unlock()
			if d.Focus {
				shouldFocus = true
			}
		}
	}
	if shouldFocus {
		log.Printf("[bridge] activating window for queued focus request browser=%s", browser)
		activateBrowserWindow(browser)
	}
}

func main() {
	addr := flag.String("addr", defaultAddr, "listen address")
	autostart := flag.Bool("autostart", false, "register this executable for Windows auto-start and exit")
	removeAutostart := flag.Bool("remove-autostart", false, "remove the Windows auto-start entry and exit")
	flag.Parse()

	if *autostart {
		if err := installAutostart(); err != nil {
			fmt.Fprintln(os.Stderr, "autostart:", err)
			os.Exit(1)
		}
		fmt.Println("autostart registered")
		return
	}
	if *removeAutostart {
		if err := uninstallAutostart(); err != nil {
			fmt.Fprintln(os.Stderr, "remove-autostart:", err)
			os.Exit(1)
		}
		fmt.Println("autostart removed")
		return
	}

	ln, err := listenWithReuse(*addr)
	if err != nil {
		log.Fatalf("listen %s: %v", *addr, err)
	}
	br := newBridge()
	mux := http.NewServeMux()
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		br.mu.RLock()
		defer br.mu.RUnlock()
		clients := make([]string, 0, len(br.clients))
		for k := range br.clients {
			clients = append(clients, k)
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"ok":          true,
			"clients":     clients,
			"connected":   len(clients),
			"counts": map[string]int{
				"tabs-update": br.countTabsUpdate,
				"open-url":    br.countOpenURL,
				"close-tab":   br.countCloseTab,
				"open-tab":    br.countOpenReq,
				"close-tab-remote": br.countCloseReq,
			},
			"registers":     br.countRegister,
			"lastActivity":  br.lastActivity.Format(time.RFC3339),
			"lastActivityMs": time.Since(br.lastActivity).Milliseconds(),
		})
	})
	mux.HandleFunc("/ws", br.handleWS)

	srv := &http.Server{Handler: mux, ReadHeaderTimeout: 10 * time.Second}
	log.Printf("tab-bridge listening on http://%s", *addr)
	if err := srv.Serve(ln); err != nil {
		log.Fatalf("serve: %v", err)
	}
}

// handleWS upgrades an HTTP request to a WebSocket and runs the read loop.
func (b *bridge) handleWS(w http.ResponseWriter, r *http.Request) {
	c, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer c.Close()

	// The extension registers its browser identity as its first message.
	_ = c.SetReadDeadline(time.Now().Add(10 * time.Second))
	_, data, err := c.ReadMessage()
	if err != nil {
		_ = c.WriteMessage(websocket.CloseMessage,
			websocket.FormatCloseMessage(websocket.ClosePolicyViolation, "register timeout"))
		return
	}
	var reg envelope
	if err := json.Unmarshal(data, &reg); err != nil || reg.Type != msgRegister {
		_ = c.WriteMessage(websocket.CloseMessage,
			websocket.FormatCloseMessage(websocket.ClosePolicyViolation, "expected register first"))
		return
	}
	var rd registerData
	_ = json.Unmarshal(reg.Data, &rd)
	if rd.Browser != "chrome" && rd.Browser != "edge" {
		_ = c.WriteMessage(websocket.CloseMessage,
			websocket.FormatCloseMessage(websocket.ClosePolicyViolation, "unknown browser"))
		return
	}
	client := b.store(rd.Browser, c)
	defer b.drop(rd.Browser, c)
	_ = c.SetReadDeadline(time.Time{}) // clear deadline for the long-poll loop

	// Send cached peer tabs if available so cold-starting dashboard isn't blank
	peerName := otherBrowser(rd.Browser)
	b.sendCachedTabs(peerName, client)

	// Flush any pending open-url requests that were queued while this browser was offline
	b.flushPendingOpen(rd.Browser, client)

	b.readLoop(rd.Browser, client)
}

// readLoop processes inbound messages from one extension.
func (b *bridge) readLoop(self string, client *clientConn) {
	for {
		_, data, err := client.conn.ReadMessage()
		if err != nil {
			log.Printf("[bridge] read error browser=%s: %v", self, err)
			return
		}
		var env envelope
		if err := json.Unmarshal(data, &env); err != nil {
			log.Printf("[bridge] parse error browser=%s: %v", self, err)
			continue
		}
		switch env.Type {
		case msgTabsUpdate:
			var d tabsUpdateData
			if err := json.Unmarshal(env.Data, &d); err != nil {
				log.Printf("[bridge] tabs-update parse error browser=%s: %v", self, err)
				continue
			}
			b.mu.Lock()
			b.countTabsUpdate++
			if d.Tabs != nil {
				b.lastTabs[self] = d.Tabs // cache tabs for cold-start retrieval
			}
			b.touch()
			b.mu.Unlock()
			log.Printf("[bridge] <%s tabs-update tabs=%d", self, len(d.Tabs))
			// Forward to peer so the other browser's UI refreshes.
			if peer := b.peer(self); peer != nil {
				_ = peer.writeEnvelope(env)
			}
		case msgOpenURL:
			var d openURLData
			if err := json.Unmarshal(env.Data, &d); err != nil {
				log.Printf("[bridge] open-url parse error browser=%s: %v", self, err)
				continue
			}
			d.Source = self
			recipient := d.Target
			if recipient == "" || recipient == self {
				recipient = otherBrowser(self)
			}

			b.mu.Lock()
			b.countOpenURL++
			b.touch()
			peer := b.clients[recipient]
			if peer == nil {
				// Target not connected: queue it instead of dropping
				if len(b.pendingOpen[recipient]) < 50 {
					b.pendingOpen[recipient] = append(b.pendingOpen[recipient], d)
				}
				log.Printf("[bridge] <%s open-url url=%s focus=%v ->%s queued (peer offline, pending=%d)",
					self, d.URL, d.Focus, recipient, len(b.pendingOpen[recipient]))
				b.mu.Unlock()
				continue
			}
			b.mu.Unlock()

			log.Printf("[bridge] <%s open-url url=%s focus=%v ->%s peer_connected=true",
				self, d.URL, d.Focus, recipient)
			out, _ := json.Marshal(d)
			if err := peer.writeEnvelope(envelope{Type: msgOpenReq, Data: out}); err != nil {
				log.Printf("[bridge] write open-url error ->%s: %v; queueing instead", recipient, err)
				b.mu.Lock()
				if len(b.pendingOpen[recipient]) < 50 {
					b.pendingOpen[recipient] = append(b.pendingOpen[recipient], d)
				}
				b.mu.Unlock()
				continue
			}

			b.mu.Lock()
			b.countOpenReq++
			b.mu.Unlock()
			if d.Focus {
				log.Printf("[bridge] activating window browser=%s", recipient)
				activateBrowserWindow(recipient)
			}
		case msgCloseTab:
			var d closeTabData
			if err := json.Unmarshal(env.Data, &d); err != nil {
				log.Printf("[bridge] close-tab parse error browser=%s: %v", self, err)
				continue
			}
			if d.Target == "" {
				d.Target = otherBrowser(self)
			}
			b.mu.Lock()
			b.countCloseTab++
			b.touch()
			b.mu.Unlock()
			log.Printf("[bridge] <%s close-tab tabId=%d ->%s", self, d.TabID, d.Target)
			if peer := b.conn(d.Target); peer != nil {
				out, _ := json.Marshal(d)
				if err := peer.writeEnvelope(envelope{Type: msgCloseReq, Data: out}); err == nil {
					b.mu.Lock()
					b.countCloseReq++
					b.mu.Unlock()
				} else {
					log.Printf("[bridge] write close-tab error ->%s: %v", d.Target, err)
				}
			}
		default:
			log.Printf("[bridge] unknown type=%s from=%s", env.Type, self)
		}
	}
}

func otherBrowser(name string) string {
	if name == "chrome" {
		return "edge"
	}
	return "chrome"
}

// installAutostart registers the current executable in HKCU\...\Run.
func installAutostart() error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	k, _, err := registry.CreateKey(registry.CURRENT_USER, autostartKey, registry.SET_VALUE|registry.QUERY_VALUE)
	if err != nil {
		return err
	}
	defer k.Close()
	return k.SetStringValue(autostartVal, fmt.Sprintf("\"%s\"", exe))
}

func uninstallAutostart() error {
	k, err := registry.OpenKey(registry.CURRENT_USER, autostartKey, registry.SET_VALUE)
	if err != nil {
		return err
	}
	defer k.Close()
	return k.DeleteValue(autostartVal)
}

// listenWithReuse creates a TCP listener with SO_REUSEADDR enabled on Windows,
// allowing rapid server restart without failing on lingering TIME_WAIT sockets.
func listenWithReuse(addr string) (net.Listener, error) {
	var lc net.ListenConfig
	lc.Control = func(network, address string, c syscall.RawConn) error {
		var err error
		cErr := c.Control(func(fd uintptr) {
			err = windows.SetsockoptInt(windows.Handle(fd), windows.SOL_SOCKET, windows.SO_REUSEADDR, 1)
		})
		if cErr != nil {
			return cErr
		}
		return err
	}
	return lc.Listen(context.Background(), "tcp", addr)
}

// windows.go holds the Win32 activation implementation (split for readability).

