import assert from "node:assert";

// 1. Test makeMatcher
function makeMatcher(combo) {
  const parts = new Set((combo || "").toLowerCase().split("+").map((p) => p.trim()).filter(Boolean));
  if (!parts.size) return () => false;
  const wantAlt = parts.has("alt");
  const wantCtrl = parts.has("ctrl") || parts.has("control");
  const wantShift = parts.has("shift");
  const wantMeta = parts.has("meta") || parts.has("cmd");
  return (e) => {
    return (
      Boolean(e.altKey) === wantAlt &&
      Boolean(e.ctrlKey) === wantCtrl &&
      Boolean(e.shiftKey) === wantShift &&
      Boolean(e.metaKey) === wantMeta
    );
  };
}

const matchBg = makeMatcher("alt+shift");
assert.strictEqual(matchBg({ altKey: true, shiftKey: true, ctrlKey: false, metaKey: false }), true, "alt+shift matches");
assert.strictEqual(matchBg({ altKey: true, shiftKey: true, ctrlKey: true, metaKey: false }), false, "extra ctrlKey must NOT match");
assert.strictEqual(matchBg({ altKey: true, shiftKey: false, ctrlKey: false, metaKey: false }), false, "missing shift must NOT match");
assert.strictEqual(matchBg({ altKey: false, shiftKey: false, ctrlKey: false, metaKey: false }), false, "no keys must NOT match");

// 2. Test extractHref
function extractHref(el) {
  if (!el) return "";
  let h = el.href;
  if (typeof h === "object" && h !== null) {
    h = h.baseVal || h.animVal || "";
  }
  if (typeof h !== "string" || !h) {
    h = el.getAttribute ? (el.getAttribute("href") || el.getAttribute("xlink:href") || "") : "";
  }
  if (typeof h === "string" && h) {
    try {
      const u = new URL(h, "http://localhost");
      if (u.protocol === "javascript:") return "";
      return u.href;
    } catch {
      if (/^\s*javascript:/i.test(h)) return "";
      return h;
    }
  }
  return "";
}

// Normal HTML link
assert.strictEqual(extractHref({ href: "https://example.com/test" }), "https://example.com/test");

// SVG link with SVGAnimatedString
assert.strictEqual(
  extractHref({
    href: { baseVal: "https://example.com/svg-link", animVal: "https://example.com/svg-link" },
    getAttribute: () => null
  }),
  "https://example.com/svg-link"
);

// Fallback attribute
assert.strictEqual(
  extractHref({
    href: null,
    getAttribute: (attr) => attr === "xlink:href" ? "https://example.com/xlink" : null
  }),
  "https://example.com/xlink"
);

// Javascript pseudo-protocol must be rejected
assert.strictEqual(extractHref({ href: "javascript:void(0)" }), "", "javascript:void(0) must return empty");
assert.strictEqual(extractHref({ href: "javascript:alert(1)" }), "", "javascript:alert(1) must return empty");

// 3. Test pushTabs filter for undefined URLs
const rawTabs = [
  { id: 1, url: "https://google.com", title: "Google" },
  { id: 2, url: undefined, title: "Loading..." },
  { id: 3, url: "chrome://settings", title: "Settings" },
  { id: 4, url: "edge://flags", title: "Flags" },
  { id: 5, url: "http://intranet.local", title: "Intranet" },
];

const slim = rawTabs
  .filter((t) => typeof t.url === "string" && !t.url.startsWith("chrome://") && !t.url.startsWith("edge://"))
  .map((t) => ({ id: t.id, url: t.url, title: t.title }));

assert.strictEqual(slim.length, 2);
assert.strictEqual(slim[0].id, 1);
assert.strictEqual(slim[1].id, 5);

// 4. Test multi-port management logic
const uiPorts = new Set();
const port1 = { postMessage: (msg) => { port1.lastMsg = msg; } };
const port2 = { postMessage: (msg) => { port2.lastMsg = msg; } };

uiPorts.add(port1);
uiPorts.add(port2);
assert.strictEqual(uiPorts.size, 2);

function broadcastState(state) {
  for (const p of uiPorts) {
    p.postMessage(state);
  }
}

broadcastState({ connected: true });
assert.deepStrictEqual(port1.lastMsg, { connected: true });
assert.deepStrictEqual(port2.lastMsg, { connected: true });

// Port 1 disconnects (e.g. popup closes)
uiPorts.delete(port1);
assert.strictEqual(uiPorts.size, 1);

broadcastState({ connected: false });
assert.deepStrictEqual(port1.lastMsg, { connected: true }); // not updated
assert.deepStrictEqual(port2.lastMsg, { connected: false }); // updated!

// Dead port error cleanup
const errorPort = {
  postMessage: () => { throw new Error("disconnected"); }
};
uiPorts.add(errorPort);
assert.strictEqual(uiPorts.size, 2);

function sendStateToPort(p, state) {
  try {
    p.postMessage(state);
  } catch {
    uiPorts.delete(p);
  }
}
sendStateToPort(errorPort, { connected: true });
assert.strictEqual(uiPorts.size, 1, "failing port must be pruned from uiPorts");
assert.strictEqual(uiPorts.has(errorPort), false);

// 5. Test stateful recording logic
const MOD_ORDER = ["ctrl", "alt", "shift", "meta"];
function normalizeCombo(mods) {
  const set = new Set(mods.map((m) => m.toLowerCase()));
  const out = MOD_ORDER.filter((m) => set.has(m));
  return out.join("+");
}

let activeMods = new Set();
// Step 1: User presses Alt
activeMods.add("alt");
// Step 2: User presses Shift
activeMods.add("shift");
// Step 3: KeyUp fires
const combo = normalizeCombo(Array.from(activeMods));
assert.strictEqual(combo, "alt+shift");

// 6. Test Shadow DOM composedPath traversal in findAnchor
function findAnchor(e) {
  if (e && typeof e.composedPath === "function") {
    const path = e.composedPath();
    for (const el of path) {
      if (el && (el.nodeType === 1 || el.nodeType === 1)) {
        if ((el.tagName || "").toLowerCase() === "a" && extractHref(el)) {
          return el;
        }
      }
    }
  }
  let el = e && e.target ? e.target : e;
  while (el && (el.nodeType === 1 || el.nodeType === 1)) {
    if ((el.tagName || "").toLowerCase() === "a" && extractHref(el)) {
      return el;
    }
    el = el.parentElement;
  }
  return null;
}

const spanInsideAnchor = { nodeType: 1, tagName: "span", parentElement: null };
const shadowAnchor = { nodeType: 1, tagName: "a", href: "https://example.com/shadow", parentElement: null };
const mockEvent = {
  target: spanInsideAnchor,
  composedPath: () => [spanInsideAnchor, shadowAnchor]
};

const found = findAnchor(mockEvent);
assert.strictEqual(found, shadowAnchor, "findAnchor must penetrate shadow DOM via composedPath");

console.log("All JS unit tests passed successfully!");
