document.addEventListener('DOMContentLoaded', async () => {
  const domainList = document.getElementById('domainList');
  const searchInput = document.getElementById('searchInput');

  let allTabs = [];
  let mutedDomains = new Set();
  let expandedDomains = new Set();

  // Load saved muted domains
  try {
    const storage = await chrome.storage.local.get('mutedDomains');
    if (storage.mutedDomains) {
      const normalized = new Set();
      storage.mutedDomains.forEach(d => {
        const parsed = psl.parse(d);
        const base = parsed.domain || d;
        normalized.add(base);
      });
      mutedDomains = normalized;
      if (normalized.size !== storage.mutedDomains.length) {
        await chrome.storage.local.set({ mutedDomains: Array.from(mutedDomains) });
      }
    }
  } catch (e) {
    console.error('Failed to load storage:', e);
  }

  async function refresh() {
    try {
      allTabs = await chrome.tabs.query({});
      render();
    } catch (e) {
      console.error('Failed to query tabs:', e);
    }
  }

  function getBaseDomain(url) {
    try {
      const urlObj = new URL(url);
      if (!['http:', 'https:'].includes(urlObj.protocol)) return null;
      
      const hostname = urlObj.hostname;
      if (hostname === 'localhost') return 'localhost';
      
      // Improved IP regex (IPv4 & basic IPv6)
      const ipRegex = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$|^\[?[a-fA-F0-9:]+\]?$/;
      if (ipRegex.test(hostname)) return hostname;

      const parsed = psl.parse(hostname);
      return parsed.domain || hostname; 
    } catch (e) {
      return null;
    }
  }

  async function render() {
    const query = searchInput.value.toLowerCase();
    const groups = {};
    
    let activeDomain = null;
    let activeTabId = null;
    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (activeTab) {
        activeDomain = getBaseDomain(activeTab.url);
        activeTabId = activeTab.id;
      }
    } catch (e) {
      console.error('Failed to get active tab:', e);
    }
    
    if (activeDomain && expandedDomains.size === 0 && !query) {
      expandedDomains.add(activeDomain);
    }

    allTabs.forEach(tab => {
      const domain = getBaseDomain(tab.url);
      if (!domain) return;
      if (!groups[domain]) groups[domain] = [];
      groups[domain].push(tab);
    });

    // Use DocumentFragment for better performance
    const fragment = document.createDocumentFragment();

    const sortedDomains = Object.keys(groups).sort((a, b) => {
      if (a === activeDomain) return -1;
      if (b === activeDomain) return 1;
      return a.localeCompare(b);
    });

    sortedDomains.forEach(domain => {
      const tabs = groups[domain];
      const isDomainMuted = mutedDomains.has(domain);
      
      const matchesDomain = domain.toLowerCase().includes(query);
      const matchingTabs = tabs.filter(t => t.title.toLowerCase().includes(query));
      
      if (!matchesDomain && matchingTabs.length === 0) return;

      const domainItem = document.createElement('div');
      domainItem.className = 'domain-item';
      if (domain === activeDomain) {
        domainItem.classList.add('active-domain');
      }
      
      const domainMain = document.createElement('div');
      domainMain.className = 'domain-main';
      
      const expandBtn = document.createElement('div');
      expandBtn.className = 'expand-btn';
      if (expandedDomains.has(domain) || (query && matchingTabs.length > 0)) {
        expandBtn.classList.add('expanded');
      }
      expandBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>`;
      
      const favicon = document.createElement('img');
      favicon.className = 'favicon';
      favicon.src = tabs[0].favIconUrl || 'icons/icon.png';
      
      const info = document.createElement('div');
      info.className = 'domain-info';
      const domainNameEl = document.createElement('div');
      domainNameEl.className = 'domain-name';
      domainNameEl.textContent = domain; // Security: use textContent
      info.appendChild(domainNameEl);
      
      const domainSwitchLabel = document.createElement('label');
      domainSwitchLabel.className = 'switch';
      const domainCheckbox = document.createElement('input');
      domainCheckbox.type = 'checkbox';
      domainCheckbox.checked = isDomainMuted;
      
      domainCheckbox.addEventListener('change', async (e) => {
        const checked = e.target.checked;
        if (checked) {
          mutedDomains.add(domain);
        } else {
          mutedDomains.delete(domain);
        }
        try {
          await chrome.storage.local.set({ mutedDomains: Array.from(mutedDomains) });
          // Parallel updates for better performance
          await Promise.all(tabs.map(tab => chrome.tabs.update(tab.id, { muted: checked })));
          refresh();
        } catch (err) {
          console.error('Failed to update domain mute status:', err);
        }
      });

      const slider = document.createElement('span');
      slider.className = 'slider';
      
      domainSwitchLabel.appendChild(domainCheckbox);
      domainSwitchLabel.appendChild(slider);
      
      domainMain.appendChild(expandBtn);
      domainMain.appendChild(favicon);
      domainMain.appendChild(info);
      domainMain.appendChild(domainSwitchLabel);
      
      const tabsList = document.createElement('div');
      tabsList.className = 'tabs-list';
      if (expandedDomains.has(domain) || (query && matchingTabs.length > 0)) {
        tabsList.classList.add('visible');
      }
      
      // Sort tabs so the active one is at the top of its domain group
      const sortedTabs = [...tabs].sort((a, b) => {
        if (a.id === activeTabId) return -1;
        if (b.id === activeTabId) return 1;
        return 0;
      });

      sortedTabs.forEach(tab => {
        const tabItem = document.createElement('div');
        tabItem.className = 'tab-item';
        if (tab.id === activeTabId) {
          tabItem.classList.add('active-tab');
        }
        
        const tabInfo = document.createElement('div');
        tabInfo.className = 'tab-info';
        tabInfo.textContent = tab.title;
        tabInfo.title = tab.title;
        
        const tabSwitchLabel = document.createElement('label');
        tabSwitchLabel.className = 'switch';
        const tabCheckbox = document.createElement('input');
        tabCheckbox.type = 'checkbox';
        tabCheckbox.checked = tab.mutedInfo.muted;
        
        tabCheckbox.addEventListener('change', async (e) => {
          try {
            await chrome.tabs.update(tab.id, { muted: e.target.checked });
            refresh();
          } catch (err) {
            console.error('Failed to update tab mute status:', err);
          }
        });
        
        const tabSlider = document.createElement('span');
        tabSlider.className = 'slider';
        
        tabSwitchLabel.appendChild(tabCheckbox);
        tabSwitchLabel.appendChild(tabSlider);
        
        tabItem.appendChild(tabInfo);
        tabItem.appendChild(tabSwitchLabel);
        tabsList.appendChild(tabItem);
      });

      domainMain.addEventListener('click', (e) => {
        if (e.target.closest('.switch')) return;
        const isVisible = tabsList.classList.toggle('visible');
        expandBtn.classList.toggle('expanded', isVisible);
        if (isVisible) {
          expandedDomains.add(domain);
        } else {
          expandedDomains.delete(domain);
        }
      });

      domainItem.appendChild(domainMain);
      domainItem.appendChild(tabsList);
      fragment.appendChild(domainItem);
    });

    domainList.innerHTML = '';
    domainList.appendChild(fragment);
  }

  searchInput.addEventListener('input', render);
  
  const clearRulesBtn = document.getElementById('clearRulesBtn');
  clearRulesBtn.addEventListener('click', async () => {
    if (confirm('是否清空所有域名静音规则？')) {
      mutedDomains = new Set();
      await chrome.storage.local.set({ mutedDomains: [] });
      refresh();
    }
  });

  refresh();
});
