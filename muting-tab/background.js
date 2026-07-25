importScripts('psl.min.js');

function getBaseDomain(url) {
  try {
    const urlObj = new URL(url);
    if (!['http:', 'https:'].includes(urlObj.protocol)) return null;
    
    const hostname = urlObj.hostname;
    
    // Handle localhost
    if (hostname === 'localhost') return 'localhost';
    
    // Handle IP addresses (IPv4 & IPv6)
    const ipRegex = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$|^\[?[a-fA-F0-9:]+\]?$/;
    if (ipRegex.test(hostname)) return hostname;

    const parsed = psl.parse(hostname);
    return (parsed && parsed.domain) ? parsed.domain : hostname; 
  } catch (e) {
    return null;
  }
}

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // Only handle loading status or URL changes to avoid excessive updates
  if (changeInfo.status === 'loading' || changeInfo.url) {
    const url = changeInfo.url || tab.url;
    if (!url) return;

    const domain = getBaseDomain(url);
    if (!domain) return;

    try {
      const storage = await chrome.storage.local.get('mutedDomains');
      const mutedDomains = storage.mutedDomains || [];

      if (mutedDomains.includes(domain)) {
        // Force Mute
        chrome.tabs.update(tabId, { muted: true }).catch(() => {});
      } else {
        // Force Unmute - This ensures if the domain is NOT in the list, it's NOT muted.
        // This solves cases where Chrome might have inherited a muted state.
        chrome.tabs.update(tabId, { muted: false }).catch(() => {});
      }
    } catch (e) {
      console.error('Background storage error:', e);
    }
  }
});
