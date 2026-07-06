'use strict';

(function initTabOutTabService() {
  function createTabService(deps = {}) {
    const tabsApi = deps.tabsApi || (typeof chrome !== 'undefined' ? chrome.tabs : null);
    const windowsApi = deps.windowsApi || (typeof chrome !== 'undefined' ? chrome.windows : null);
    const runtimeApi = deps.runtimeApi || (typeof chrome !== 'undefined' ? chrome.runtime : null);

  function getTabUrl(tab) {
    return (tab && (tab.pendingUrl || tab.url)) || '';
  }

  function getTabOutNewTabUrl() {
    return `chrome-extension://${runtimeApi.id}/index.html`;
  }

  function isRealTabUrl(url) {
    const safeUrl = String(url || '');
    return (
      !safeUrl.startsWith('chrome://') &&
      !safeUrl.startsWith('chrome-extension://') &&
      !safeUrl.startsWith('about:') &&
      !safeUrl.startsWith('edge://') &&
      !safeUrl.startsWith('brave://')
    );
  }

  function isTabOutUrl(url) {
    const safeUrl = String(url || '');
    return safeUrl === getTabOutNewTabUrl() || safeUrl === 'chrome://newtab/';
  }

  function isTabOutTab(tab) {
    return isTabOutUrl(getTabUrl(tab));
  }

  async function queryRawTabs() {
    return tabsApi.query({});
  }

  async function queryDashboardTabs() {
    try {
      const tabs = await queryRawTabs();

      return tabs.map(tab => ({
        id: tab.id,
        url: getTabUrl(tab),
        title: tab.title,
        favIconUrl: tab.favIconUrl || '',
        windowId: tab.windowId,
        active: tab.active,
        lastAccessed: tab.lastAccessed,
        isTabOut: isTabOutTab(tab),
      }));
    } catch {
      return [];
    }
  }

  async function focusTab(url) {
    if (!url) return false;

    const allTabs = await queryRawTabs();
    const currentWindow = await windowsApi.getCurrent();
    let matches = allTabs.filter(tab => getTabUrl(tab) === url);

    if (matches.length === 0) {
      try {
        const targetHost = new URL(url).hostname;
        matches = allTabs.filter(tab => {
          try {
            return new URL(getTabUrl(tab)).hostname === targetHost;
          } catch {
            return false;
          }
        });
      } catch {
        return false;
      }
    }

    if (matches.length === 0) return false;

    const match = matches.find(tab => tab.windowId !== currentWindow.id) || matches[0];
    await tabsApi.update(match.id, { active: true });
    await windowsApi.update(match.windowId, { focused: true });
    return {
      focused: true,
      matchedBy: matches[0] && getTabUrl(matches[0]) === url ? 'exact' : 'hostname',
      tabId: match.id,
      windowId: match.windowId,
    };
  }

  async function focusTabById(tabId) {
    if (!tabId) return false;

    const allTabs = await queryRawTabs();
    const match = allTabs.find(tab => String(tab.id) === String(tabId));
    if (!match) return false;

    await tabsApi.update(match.id, { active: true });
    await windowsApi.update(match.windowId, { focused: true });
    return {
      focused: true,
      matchedBy: 'id',
      tabId: match.id,
      windowId: match.windowId,
    };
  }

  async function focusExactTabByUrl(url) {
    if (!url) return false;

    const allTabs = await queryRawTabs();
    const match = allTabs.find(tab => getTabUrl(tab) === url);
    if (!match) return false;

    await tabsApi.update(match.id, { active: true });
    await windowsApi.update(match.windowId, { focused: true });
    return {
      focused: true,
      matchedBy: 'exact',
      tabId: match.id,
      windowId: match.windowId,
    };
  }

  async function closeTabsByUrls(urls) {
    if (!Array.isArray(urls) || urls.length === 0) return 0;

    const targetHostnames = [];
    const exactUrls = new Set();

    for (const url of urls) {
      if (typeof url !== 'string' || !url) continue;
      if (url.startsWith('file://')) {
        exactUrls.add(url);
        continue;
      }

      try {
        targetHostnames.push(new URL(url).hostname);
      } catch {
        // Skip malformed URLs.
      }
    }

    const allTabs = await queryRawTabs();
    const toClose = allTabs.filter(tab => {
      const tabUrl = getTabUrl(tab);
      if (tabUrl.startsWith('file://') && exactUrls.has(tabUrl)) return true;

      try {
        const hostname = new URL(tabUrl).hostname;
        return hostname && targetHostnames.includes(hostname);
      } catch {
        return false;
      }
    }).map(tab => tab.id);

    if (toClose.length > 0) {
      await tabsApi.remove(toClose);
    }

    return {
      closedCount: toClose.length,
      tabIds: toClose,
    };
  }

  async function closeTabsExact(urls) {
    if (!Array.isArray(urls) || urls.length === 0) return 0;

    const urlSet = new Set(urls);
    const allTabs = await queryRawTabs();
    const toClose = allTabs.filter(tab => urlSet.has(getTabUrl(tab))).map(tab => tab.id);

    if (toClose.length > 0) {
      await tabsApi.remove(toClose);
    }

    return {
      closedCount: toClose.length,
      tabIds: toClose,
    };
  }

  async function createTab(url, { active = false } = {}) {
    if (!url) return null;
    return tabsApi.create({ url, active });
  }

  async function closeTab(tabId, fallbackUrl) {
    if (tabId) {
      await tabsApi.remove(Number(tabId));
      return {
        closed: true,
        matchedBy: 'id',
        tabId: Number(tabId),
      };
    }

    if (!fallbackUrl) return false;

    const allTabs = await queryRawTabs();
    const match = allTabs.find(tab => getTabUrl(tab) === fallbackUrl);
    if (!match) return false;

    await tabsApi.remove(match.id);
    return {
      closed: true,
      matchedBy: 'url',
      tabId: match.id,
    };
  }

  async function closeDuplicateTabs(urls, keepOne = true) {
    const allTabs = await queryRawTabs();
    const toClose = [];

    for (const url of urls || []) {
      const matching = allTabs.filter(tab => getTabUrl(tab) === url);
      if (matching.length === 0) continue;

      if (keepOne) {
        const keep = matching.find(tab => tab.active) || matching[0];
        for (const tab of matching) {
          if (tab.id !== keep.id) toClose.push(tab.id);
        }
        continue;
      }

      for (const tab of matching) {
        toClose.push(tab.id);
      }
    }

    if (toClose.length > 0) {
      await tabsApi.remove(toClose);
    }

    return {
      closedCount: toClose.length,
      keptOne: !!keepOne,
      tabIds: toClose,
    };
  }

  async function closeTabOutDupes() {
    const allTabs = await queryRawTabs();
    const currentWindow = await windowsApi.getCurrent();
    const tabOutTabs = allTabs.filter(tab => isTabOutTab(tab));

    if (tabOutTabs.length <= 1) return 0;

    const keep =
      tabOutTabs.find(tab => tab.active && tab.windowId === currentWindow.id) ||
      tabOutTabs.find(tab => tab.active) ||
      tabOutTabs[0];
    const toClose = tabOutTabs.filter(tab => tab.id !== keep.id).map(tab => tab.id);

    if (toClose.length > 0) {
      await tabsApi.remove(toClose);
    }

    return {
      closedCount: toClose.length,
      tabIds: toClose,
    };
  }

    return {
    closeDuplicateTabs,
    closeTab,
    closeTabOutDupes,
    closeTabsByUrls,
    closeTabsExact,
    createTab,
    focusExactTabByUrl,
    focusTab,
    focusTabById,
    getTabUrl,
    getTabOutNewTabUrl,
    isRealTabUrl,
    isTabOutTab,
    isTabOutUrl,
    queryDashboardTabs,
    queryRawTabs,
  };
  }

  const tabService = createTabService();

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      createTabService,
    };
  }

  if (typeof window !== 'undefined') {
    window.TabOutTabService = tabService;
  }
})();
