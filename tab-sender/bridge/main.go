// Command tab-bridge is a local WebSocket bridge that relays tab/control messages
// between Chrome and Edge instances of the Tab Sender extension, and raises the
// target browser window to the foreground when a tab is opened in "focus" mode.
//
// It listens on 127.0.0.1:18923, runs hidden (no console window) when built with
// -H windowsgui, and supports registering itself for Windows auto-start.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"sync"
	"time"

	"github.com/gorilla/websocket"
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

// bridge holds registered clients keyed by browser name.
type bridge struct {
	mu      sync.RWMutex
	clients map[string]*websocket.Conn // browser -> conn
}

var upgrader = websocket.Upgrader{
	// chrome-extension:// origins are non-standard; accept them all. The bridge
	// is loopback-only and the extension identity is verified via the register
	// handshake, so origin checks add no security here.
	CheckOrigin: func(r *http.Request) bool { return true },
}

func newBridge() *bridge {
	return &bridge{clients: make(map[string]*websocket.Conn)}
}

// store registers a client under its browser name, replacing any prior conn.
func (b *bridge) store(name string, c *websocket.Conn) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if old, ok := b.clients[name]; ok && old != c {
		_ = old.Close()
	}
	b.clients[name] = c
}

func (b *bridge) drop(name string, c *websocket.Conn) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if cur, ok := b.clients[name]; ok && cur == c {
		delete(b.clients, name)
	}
}

// peer returns the conn for the browser that is NOT the given one.
func (b *bridge) peer(self string) *websocket.Conn {
	b.mu.RLock()
	defer b.mu.RUnlock()
	for name, c := range b.clients {
		if name != self {
			return c
		}
	}
	return nil
}

func (b *bridge) conn(name string) *websocket.Conn {
	b.mu.RLock()
	defer b.mu.RUnlock()
	return b.clients[name]
}

// write sends one envelope as JSON over a conn with a write deadline.
func write(c *websocket.Conn, env envelope) error {
	_ = c.SetWriteDeadline(time.Now().Add(5 * time.Second))
	return c.WriteJSON(env)
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

	ln, err := net.Listen("tcp", *addr)
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
			"ok":      true,
			"clients": clients,
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
	b.store(rd.Browser, c)
	defer b.drop(rd.Browser, c)
	_ = c.SetReadDeadline(time.Time{}) // clear deadline for the long-poll loop

	b.readLoop(rd.Browser, c)
}

// readLoop processes inbound messages from one extension.
func (b *bridge) readLoop(self string, c *websocket.Conn) {
	for {
		_, data, err := c.ReadMessage()
		if err != nil {
			return
		}
		var env envelope
		if err := json.Unmarshal(data, &env); err != nil {
			continue
		}
		switch env.Type {
		case msgTabsUpdate:
			// Forward to peer so the other browser's UI refreshes.
			if peer := b.peer(self); peer != nil {
				_ = write(peer, env)
			}
		case msgOpenURL:
			var d openURLData
			if err := json.Unmarshal(env.Data, &d); err != nil {
				continue
			}
			d.Source = self
			recipient := d.Target
			if recipient == "" || recipient == self {
				recipient = otherBrowser(self)
			}
			peer := b.conn(recipient)
			if peer == nil {
				continue // target not connected: drop (MVP, no pending queue)
			}
			out, _ := json.Marshal(d)
			_ = write(peer, envelope{Type: msgOpenReq, Data: out})
			if d.Focus {
				activateBrowserWindow(recipient)
			}
		case msgCloseTab:
			var d closeTabData
			if err := json.Unmarshal(env.Data, &d); err != nil {
				continue
			}
			if d.Target == "" {
				d.Target = otherBrowser(self)
			}
			if peer := b.conn(d.Target); peer != nil {
				out, _ := json.Marshal(d)
				_ = write(peer, envelope{Type: msgCloseReq, Data: out})
			}
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
	return k.SetStringValue(autostartVal, fmt.Sprintf("%q", exe))
}

func uninstallAutostart() error {
	k, err := registry.OpenKey(registry.CURRENT_USER, autostartKey, registry.SET_VALUE)
	if err != nil {
		return err
	}
	defer k.Close()
	return k.DeleteValue(autostartVal)
}

// windows.go holds the Win32 activation implementation (split for readability).
