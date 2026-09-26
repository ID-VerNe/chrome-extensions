package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func TestOriginCheck(t *testing.T) {
	cases := []struct {
		origin string
		allow  bool
	}{
		{"", true},
		{"chrome-extension://abcdefghijklmnop", true},
		{"CHROME-EXTENSION://ABCDEFGHIJKLMnop", true},
		{"edge-extension://abcdefghijklmnop", true},
		{"EDGE-EXTENSION://ABCDEFGHIJKLMnop", true},
		{"http://localhost:8080", false},
		{"http://127.0.0.1:18923", false},
		{"https://evil.com", false},
		{"null", false},
	}

	for _, tc := range cases {
		req, _ := http.NewRequest("GET", "http://127.0.0.1:18923/ws", nil)
		if tc.origin != "" {
			req.Header.Set("Origin", tc.origin)
		}
		allowed := upgrader.CheckOrigin(req)
		if allowed != tc.allow {
			t.Errorf("origin %q: expected allow=%v, got %v", tc.origin, tc.allow, allowed)
		}
	}
}

func TestTabSnapshotCachingAndPendingQueue(t *testing.T) {
	br := newBridge()
	server := httptest.NewServer(http.HandlerFunc(br.handleWS))
	defer server.Close()

	wsURL := "ws" + strings.TrimPrefix(server.URL, "http")

	// 1. Connect Chrome client
	chromeDialer := websocket.Dialer{}
	header := http.Header{}
	header.Set("Origin", "chrome-extension://chrome-test-id")
	chromeConn, _, err := chromeDialer.Dial(wsURL, header)
	if err != nil {
		t.Fatalf("dial chrome ws: %v", err)
	}
	defer chromeConn.Close()

	// Register as chrome
	regMsg := envelope{
		Type: msgRegister,
		Data: json.RawMessage(`{"browser":"chrome"}`),
	}
	if err := chromeConn.WriteJSON(regMsg); err != nil {
		t.Fatalf("register chrome: %v", err)
	}

	// Wait briefly for registration
	time.Sleep(50 * time.Millisecond)

	// 2. Chrome updates its tabs
	tabsData := tabsUpdateData{
		Browser: "chrome",
		Tabs: []tabInfo{
			{ID: 1, URL: "https://example.com", Title: "Example"},
			{ID: 2, URL: "https://golang.org", Title: "Go"},
		},
	}
	tabsBytes, _ := json.Marshal(tabsData)
	_ = chromeConn.WriteJSON(envelope{Type: msgTabsUpdate, Data: tabsBytes})

	time.Sleep(50 * time.Millisecond)

	// Verify tabs cached in bridge
	br.mu.RLock()
	cachedChromeTabs, ok := br.lastTabs["chrome"]
	br.mu.RUnlock()
	if !ok || len(cachedChromeTabs) != 2 {
		t.Fatalf("expected 2 cached tabs for chrome, got %d", len(cachedChromeTabs))
	}

	// 3. Chrome sends open-url to Edge while Edge is OFFLINE
	openData := openURLData{
		URL:   "https://offline-queued.com",
		Focus: false,
	}
	openBytes, _ := json.Marshal(openData)
	_ = chromeConn.WriteJSON(envelope{Type: msgOpenURL, Data: openBytes})

	time.Sleep(50 * time.Millisecond)

	// Verify pending queue in bridge has the message for Edge
	br.mu.RLock()
	pendingEdge, ok := br.pendingOpen["edge"]
	br.mu.RUnlock()
	if !ok || len(pendingEdge) != 1 {
		t.Fatalf("expected 1 pending open-url for edge, got %d", len(pendingEdge))
	}
	if pendingEdge[0].URL != "https://offline-queued.com" {
		t.Fatalf("expected pending URL https://offline-queued.com, got %s", pendingEdge[0].URL)
	}

	// 4. Now Edge connects!
	edgeDialer := websocket.Dialer{}
	edgeHeader := http.Header{}
	edgeHeader.Set("Origin", "chrome-extension://edge-test-id")
	edgeConn, _, err := edgeDialer.Dial(wsURL, edgeHeader)
	if err != nil {
		t.Fatalf("dial edge ws: %v", err)
	}
	defer edgeConn.Close()

	// Edge registers
	regEdge := envelope{
		Type: msgRegister,
		Data: json.RawMessage(`{"browser":"edge"}`),
	}
	if err := edgeConn.WriteJSON(regEdge); err != nil {
		t.Fatalf("register edge: %v", err)
	}

	// Edge should receive:
	// 1) Cached tabs from Chrome (tabs-update)
	// 2) Queued open-tab request
	_ = edgeConn.SetReadDeadline(time.Now().Add(2 * time.Second))

	var firstMsg envelope
	if err := edgeConn.ReadJSON(&firstMsg); err != nil {
		t.Fatalf("edge read msg 1: %v", err)
	}
	if firstMsg.Type != msgTabsUpdate {
		t.Fatalf("expected msgTabsUpdate as first msg, got %s", firstMsg.Type)
	}
	var receivedTabs tabsUpdateData
	_ = json.Unmarshal(firstMsg.Data, &receivedTabs)
	if len(receivedTabs.Tabs) != 2 || receivedTabs.Browser != "chrome" {
		t.Fatalf("unexpected tabs received: %+v", receivedTabs)
	}

	var secondMsg envelope
	if err := edgeConn.ReadJSON(&secondMsg); err != nil {
		t.Fatalf("edge read msg 2: %v", err)
	}
	if secondMsg.Type != msgOpenReq {
		t.Fatalf("expected msgOpenReq as second msg, got %s", secondMsg.Type)
	}
	var receivedOpen openURLData
	_ = json.Unmarshal(secondMsg.Data, &receivedOpen)
	if receivedOpen.URL != "https://offline-queued.com" {
		t.Fatalf("unexpected open URL received: %s", receivedOpen.URL)
	}

	// Verify pending queue for edge was cleared
	br.mu.RLock()
	remainingPending := len(br.pendingOpen["edge"])
	br.mu.RUnlock()
	if remainingPending != 0 {
		t.Fatalf("expected 0 remaining pending messages, got %d", remainingPending)
	}
}

func TestTabsUpdateMalformedDoesNotClearCache(t *testing.T) {
	br := newBridge()
	// Set initial tabs in cache
	br.lastTabs["chrome"] = []tabInfo{{ID: 1, URL: "https://initial.com", Title: "Initial"}}

	server := httptest.NewServer(http.HandlerFunc(br.handleWS))
	defer server.Close()

	wsURL := "ws" + strings.TrimPrefix(server.URL, "http")
	chromeDialer := websocket.Dialer{}
	header := http.Header{}
	header.Set("Origin", "CHROME-EXTENSION://test-id")
	chromeConn, _, err := chromeDialer.Dial(wsURL, header)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer chromeConn.Close()

	// Register
	_ = chromeConn.WriteJSON(envelope{
		Type: msgRegister,
		Data: json.RawMessage(`{"browser":"chrome"}`),
	})
	time.Sleep(50 * time.Millisecond)

	// Send malformed tabs-update
	_ = chromeConn.WriteJSON(envelope{
		Type: msgTabsUpdate,
		Data: json.RawMessage(`{not-json}`),
	})
	time.Sleep(50 * time.Millisecond)

	// Verify initial cache was NOT overwritten with nil
	br.mu.RLock()
	cached := br.lastTabs["chrome"]
	br.mu.RUnlock()
	if len(cached) != 1 || cached[0].URL != "https://initial.com" {
		t.Fatalf("expected cache to be preserved, got %+v", cached)
	}
}

func TestPendingQueueOnWriteFailure(t *testing.T) {
	br := newBridge()
	server := httptest.NewServer(http.HandlerFunc(br.handleWS))
	defer server.Close()

	wsURL := "ws" + strings.TrimPrefix(server.URL, "http")

	// Connect Chrome
	chromeConn, _, err := websocket.DefaultDialer.Dial(wsURL, http.Header{"Origin": {"chrome-extension://chrome"}})
	if err != nil {
		t.Fatalf("dial chrome: %v", err)
	}
	defer chromeConn.Close()
	_ = chromeConn.WriteJSON(envelope{Type: msgRegister, Data: json.RawMessage(`{"browser":"chrome"}`)})

	// Connect Edge
	edgeConn, _, err := websocket.DefaultDialer.Dial(wsURL, http.Header{"Origin": {"edge-extension://edge"}})
	if err != nil {
		t.Fatalf("dial edge: %v", err)
	}
	_ = edgeConn.WriteJSON(envelope{Type: msgRegister, Data: json.RawMessage(`{"browser":"edge"}`)})
	time.Sleep(50 * time.Millisecond)

	// Abruptly close Edge's underlying connection without deregistering
	_ = edgeConn.Close()
	time.Sleep(50 * time.Millisecond)

	// Chrome sends an open-url to Edge
	openMsg := envelope{
		Type: msgOpenURL,
		Data: json.RawMessage(`{"url":"https://retained-on-failure.com","focus":false}`),
	}
	_ = chromeConn.WriteJSON(openMsg)
	time.Sleep(100 * time.Millisecond)

	// Message should NOT be lost; it should be queued in pendingOpen["edge"]
	br.mu.RLock()
	pending := br.pendingOpen["edge"]
	br.mu.RUnlock()
	if len(pending) != 1 || pending[0].URL != "https://retained-on-failure.com" {
		t.Fatalf("expected open-url to be queued upon write failure, got: %+v", pending)
	}
}

func TestDummyWindowValidation(t *testing.T) {
	// A null hwnd should fail validation
	if isValidBrowserWindow(0) {
		t.Errorf("hwnd 0 should not be valid")
	}
}
