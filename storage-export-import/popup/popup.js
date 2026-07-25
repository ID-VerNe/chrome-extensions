// Popup — StorageKit

// === DOM refs ===
const domainBadge = document.getElementById("domain-badge");
const lsCount = document.getElementById("ls-count");
const lsSize = document.getElementById("ls-size");
const ssCount = document.getElementById("ss-count");
const ssSize = document.getElementById("ss-size");
const keyListContent = document.getElementById("key-list-content");
const keyCount = document.getElementById("key-count");
const refreshBtn = document.getElementById("refresh-btn");
const exportLsBtn = document.getElementById("export-ls-btn");
const exportSsBtn = document.getElementById("export-ss-btn");
const fileInput = document.getElementById("file-input");
const importBtn = document.getElementById("import-btn");
const importPreview = document.getElementById("import-preview");
const importDomain = document.getElementById("import-domain");
const importTime = document.getElementById("import-time");
const importLsCount = document.getElementById("import-ls-count");
const importSsCount = document.getElementById("import-ss-count");
const confirmImportBtn = document.getElementById("confirm-import-btn");
const toast = document.getElementById("toast");

let pendingImportData = null;
let toastTimer = null;

// === helpers ===

function byteSize(str) {
  return new Blob([str]).size;
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

function showToast(message, type) {
  if (toastTimer) clearTimeout(toastTimer);
  toast.textContent = message;
  toast.className = "toast " + type;
  toastTimer = setTimeout(() => {
    toast.className = "toast";
    toast.style.display = "none";
  }, 2800);
}

function formatTime(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch {
    return iso;
  }
}

function getCurrentTab() {
  return chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => tabs[0]);
}

// === refresh preview ===

async function refreshPreview() {
  try {
    const tab = await getCurrentTab();
    if (!tab) {
      showToast("Unable to get current tab", "error");
      return;
    }

    domainBadge.textContent = tab.url ? new URL(tab.url).hostname : "—";

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const ls = {};
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          ls[key] = localStorage.getItem(key);
        }
        const ss = {};
        for (let i = 0; i < sessionStorage.length; i++) {
          const key = sessionStorage.key(i);
          ss[key] = sessionStorage.getItem(key);
        }
        return { localStorage: ls, sessionStorage: ss };
      },
    });

    const data = results[0]?.result || { localStorage: {}, sessionStorage: {} };

    const lsKeys = Object.keys(data.localStorage);
    const ssKeys = Object.keys(data.sessionStorage);

    lsCount.textContent = lsKeys.length;
    ssCount.textContent = ssKeys.length;

    const lsBytes = byteSize(JSON.stringify(data.localStorage));
    const ssBytes = byteSize(JSON.stringify(data.sessionStorage));
    lsSize.textContent = formatBytes(lsBytes);
    ssSize.textContent = formatBytes(ssBytes);

    // key list
    const allKeys = [
      ...lsKeys.map((k) => ({ key: k, type: "LS" })),
      ...ssKeys.map((k) => ({ key: k, type: "SS" })),
    ];

    keyCount.textContent = allKeys.length;

    keyListContent.innerHTML = "";
    const toShow = allKeys.slice(0, 12);
    toShow.forEach(({ key, type }) => {
      const li = document.createElement("li");
      li.textContent = `[${type}] ${key}`;
      keyListContent.appendChild(li);
    });
    if (allKeys.length > 12) {
      const li = document.createElement("li");
      li.textContent = `... and ${allKeys.length - 12} more`;
      li.style.color = "#94a3b8";
      li.style.fontStyle = "italic";
      keyListContent.appendChild(li);
    }
  } catch (err) {
    showToast("Read failed: " + err.message, "error");
  }
}

// === export ===

async function doExport(storageType) {
  const btn = storageType === "localStorage" ? exportLsBtn : exportSsBtn;
  const label = storageType === "localStorage" ? "localStorage" : "sessionStorage";

  btn.disabled = true;
  btn.style.opacity = "0.6";

  try {
    const response = await chrome.runtime.sendMessage({ action: "export", storageType });
    if (response.success) {
      showToast(`${response.data.keyCount} keys saved (${label})`, "success");
    } else {
      showToast("Export failed: " + response.error, "error");
    }
  } catch (err) {
    showToast("Export failed: " + err.message, "error");
  } finally {
    btn.disabled = false;
    btn.style.opacity = "1";
  }
}

exportLsBtn.addEventListener("click", () => doExport("localStorage"));
exportSsBtn.addEventListener("click", () => doExport("sessionStorage"));

// === import: file picker ===

importBtn.addEventListener("click", () => fileInput.click());

fileInput.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  try {
    const text = await file.text();
    const data = JSON.parse(text);

    if (!data || typeof data !== "object") {
      showToast("Invalid JSON file", "error");
      return;
    }

    pendingImportData = data;

    const lsKeys = Object.keys(data.localStorage || {});
    const ssKeys = Object.keys(data.sessionStorage || {});

    importDomain.textContent = data.domain || "unknown";
    importTime.textContent = data.exportedAt ? formatTime(data.exportedAt) : "unknown";
    importLsCount.textContent = lsKeys.length;
    importSsCount.textContent = ssKeys.length;

    importPreview.classList.remove("hidden");
  } catch (err) {
    showToast("Parse failed: " + err.message, "error");
  }
});

// === import: confirm ===

confirmImportBtn.addEventListener("click", async () => {
  if (!pendingImportData) {
    showToast("Select a file first", "error");
    return;
  }

  const strategy = document.querySelector('input[name="strategy"]:checked').value;

  confirmImportBtn.disabled = true;
  confirmImportBtn.innerHTML = '<span>Importing...</span>';

  try {
    const response = await chrome.runtime.sendMessage({
      action: "import",
      data: pendingImportData,
      strategy: strategy,
    });

    if (response.success) {
      const parts = [];
      if (response.localStorageWritten > 0) parts.push(`LS ${response.localStorageWritten}`);
      if (response.sessionStorageWritten > 0) parts.push(`SS ${response.sessionStorageWritten}`);
      showToast(`Imported: ${parts.join(" + ")}`, "success");
      importPreview.classList.add("hidden");
      pendingImportData = null;
      fileInput.value = "";
      setTimeout(refreshPreview, 400);
    } else {
      showToast("Import failed: " + (response.error || "unknown error"), "error");
    }
  } catch (err) {
    showToast("Import failed: " + err.message, "error");
  } finally {
    confirmImportBtn.disabled = false;
    confirmImportBtn.innerHTML = `
      <span>Import data</span>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="17 1 21 5 17 9"/>
        <path d="M3 11V9a4 4 0 0 1 4-4h14"/>
        <polyline points="7 23 3 19 7 15"/>
        <path d="M21 13v2a4 4 0 0 1-4 4H3"/>
      </svg>`;
  }
});

// === init ===

document.addEventListener("DOMContentLoaded", () => {
  refreshPreview();
  // mark default radio as data-checked
  const checked = document.querySelector('input[name="strategy"]:checked');
  if (checked) checked.closest(".strategy-option")?.setAttribute("data-checked", "");
  // sync data-checked on change
  document.querySelectorAll('input[name="strategy"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      document.querySelectorAll(".strategy-option").forEach((opt) => opt.removeAttribute("data-checked"));
      if (radio.checked) radio.closest(".strategy-option")?.setAttribute("data-checked", "");
    });
  });
  // refresh on visibility (popup re-open)
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refreshPreview();
  });
});