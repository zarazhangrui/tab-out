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
    const safeUrl = String(url || '').trim();
    if (!safeUrl) return false;

    try {
      return ['http:', 'https:', 'file:'].includes(new URL(safeUrl).protocol);
    } catch {
      return false;
    }
  }

  function isTabOutUrl(url) {
    const safeUrl = String(url || '');
    return safeUrl === getTabOutNewTabUrl() || safeUrl === 'chrome://newtab/';
  }

  function isTabOutTab(tab) {
    return isTabOutUrl(getTabUrl(tab));
  }

  function isMissingTabError(error) {
    return !!(error && /No tab with id|Tabs cannot be edited right now/i.test(String(error.message || error)));
  }

  function mapWindowInfo(windowInfo) {
    if (!windowInfo || typeof windowInfo.id === 'undefined') return null;

    const mapped = { id: windowInfo.id };
    const stringFields = ['type', 'state'];
    const booleanFields = ['focused', 'incognito', 'alwaysOnTop'];
    const numberFields = ['left', 'top', 'width', 'height'];

    for (const field of stringFields) {
      if (typeof windowInfo[field] === 'string' && windowInfo[field]) mapped[field] = windowInfo[field];
    }

    for (const field of booleanFields) {
      if (typeof windowInfo[field] === 'boolean') mapped[field] = windowInfo[field];
    }

    for (const field of numberFields) {
      if (typeof windowInfo[field] === 'number' && Number.isFinite(windowInfo[field])) mapped[field] = windowInfo[field];
    }

    return mapped;
  }

  async function queryRawTabs() {
    return tabsApi.query({});
  }

  async function queryDashboardTabs() {
    try {
      const tabs = await queryRawTabs();
      let windowMap = new Map();

      if (windowsApi && typeof windowsApi.getAll === 'function') {
        try {
          const windows = await windowsApi.getAll();
          windowMap = new Map((Array.isArray(windows) ? windows : [])
            .map(mapWindowInfo)
            .filter(Boolean)
            .map(windowInfo => [Number(windowInfo.id), windowInfo]));
        } catch {
          windowMap = new Map();
        }
      }

      return tabs.map(tab => ({
        id: tab.id,
        url: getTabUrl(tab),
        title: tab.title,
        favIconUrl: tab.favIconUrl || '',
        windowId: tab.windowId,
        window: windowMap.get(Number(tab.windowId)) || (
          typeof tab.windowId !== 'undefined' ? { id: tab.windowId } : null
        ),
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

  async function createTab(url, { active = false, windowId } = {}) {
    if (!url) return null;
    const payload = { url, active };
    const numericWindowId = Number(windowId);
    if (Number.isFinite(numericWindowId)) {
      payload.windowId = numericWindowId;
    }
    return tabsApi.create(payload);
  }

  async function createWindowForRestore(payload) {
    try {
      return await windowsApi.create(payload);
    } catch (err) {
      const fallbackPayload = {
        url: payload.url,
        focused: false,
      };
      return windowsApi.create(fallbackPayload);
    }
  }

  async function getExistingRestoreWindowId(windowOptions) {
    const sourceWindowId = Number(windowOptions && windowOptions.id);
    if (!Number.isFinite(sourceWindowId) || !windowsApi || typeof windowsApi.get !== 'function') {
      return null;
    }

    try {
      await windowsApi.get(sourceWindowId);
      return sourceWindowId;
    } catch {
      return null;
    }
  }

  async function createTabsInWindow(urls, { active = false, windowOptions = {} } = {}) {
    const safeUrls = (Array.isArray(urls) ? urls : [])
      .map(url => String(url || '').trim())
      .filter(Boolean);
    if (safeUrls.length === 0) {
      return {
        createdTabs: [],
        windowId: null,
      };
    }

    const existingWindowId = await getExistingRestoreWindowId(windowOptions);
    if (existingWindowId !== null) {
      const createdTabs = [];

      for (const url of safeUrls) {
        createdTabs.push(await createTab(url, { active, windowId: existingWindowId }));
      }

      return {
        createdTabs,
        reusedExistingWindow: true,
        windowId: existingWindowId,
      };
    }

    const firstWindowPayload = {
      url: safeUrls[0],
      focused: false,
    };

    if (windowOptions && typeof windowOptions === 'object') {
      const { left, top, width, height } = windowOptions;
      const canApplyBounds = !windowOptions.state || windowOptions.state === 'normal';
      if (canApplyBounds && typeof left === 'number' && Number.isFinite(left)) firstWindowPayload.left = left;
      if (canApplyBounds && typeof top === 'number' && Number.isFinite(top)) firstWindowPayload.top = top;
      if (canApplyBounds && typeof width === 'number' && Number.isFinite(width)) firstWindowPayload.width = width;
      if (canApplyBounds && typeof height === 'number' && Number.isFinite(height)) firstWindowPayload.height = height;
      if (typeof windowOptions.incognito === 'boolean') firstWindowPayload.incognito = windowOptions.incognito;
      if (['normal', 'popup'].includes(windowOptions.type)) firstWindowPayload.type = windowOptions.type;
      if (['normal', 'minimized', 'maximized', 'fullscreen'].includes(windowOptions.state)) {
        firstWindowPayload.state = windowOptions.state;
      }
    }

    const createdWindow = await createWindowForRestore(firstWindowPayload);
    const createdTabs = Array.isArray(createdWindow && createdWindow.tabs)
      ? createdWindow.tabs
      : [];
    const windowId = createdWindow && createdWindow.id;

    for (const url of safeUrls.slice(1)) {
      createdTabs.push(await createTab(url, { active, windowId }));
    }

    return {
      createdTabs,
      reusedExistingWindow: false,
      windowId,
    };
  }

  async function closeTab(tabId, fallbackUrl) {
    if (tabId) {
      const allTabs = await queryRawTabs();
      const match = allTabs.find(tab => String(tab.id) === String(tabId));
      if (!match) return false;

      try {
        await tabsApi.remove(Number(tabId));
      } catch (error) {
        if (isMissingTabError(error)) return false;
        throw error;
      }

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

    try {
      await tabsApi.remove(match.id);
    } catch (error) {
      if (isMissingTabError(error)) return false;
      throw error;
    }

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

  async function closeTabOutDupes({ beforeRemove } = {}) {
    const allTabs = await queryRawTabs();
    const currentWindow = await windowsApi.getCurrent();
    const tabOutTabs = allTabs.filter(tab => isTabOutTab(tab));

    if (tabOutTabs.length <= 1) {
      return {
        closedCount: 0,
        suppressRefreshForTabIds: [],
        tabIds: [],
      };
    }

    const keep =
      tabOutTabs.find(tab => tab.active && tab.windowId === currentWindow.id) ||
      tabOutTabs.find(tab => tab.active) ||
      tabOutTabs[0];
    const toClose = tabOutTabs.filter(tab => tab.id !== keep.id).map(tab => tab.id);

    if (toClose.length > 0) {
      if (typeof beforeRemove === 'function') {
        await beforeRemove(toClose);
      }
      await tabsApi.remove(toClose);
    }

    return {
      closedCount: toClose.length,
      suppressRefreshForTabIds: toClose,
      tabIds: toClose,
    };
  }

  async function moveTabsToCurrentWindow(tabIds = []) {
    const requestedIds = (Array.isArray(tabIds) ? tabIds : [tabIds])
      .map(value => Number(value))
      .filter(value => Number.isFinite(value));
    if (requestedIds.length === 0) {
      const currentWindow = await windowsApi.getCurrent();
      return {
        movedCount: 0,
        skippedCount: 0,
        tabIds: [],
        windowId: currentWindow.id,
      };
    }

    const requestedIdSet = new Set(requestedIds);
    const allTabs = await queryRawTabs();
    const currentWindow = await windowsApi.getCurrent();
    const movableTabs = allTabs.filter(tab => (
      requestedIdSet.has(Number(tab.id)) &&
      Number(tab.windowId) !== Number(currentWindow.id)
    ));
    const movableIds = movableTabs.map(tab => Number(tab.id));
    const skippedCount = allTabs.filter(tab => (
      requestedIdSet.has(Number(tab.id)) &&
      Number(tab.windowId) === Number(currentWindow.id)
    )).length;

    if (movableIds.length > 0) {
      await tabsApi.move(movableIds, {
        windowId: currentWindow.id,
        index: -1,
      });
    }

    return {
      movedCount: movableIds.length,
      skippedCount,
      tabIds: movableIds,
      windowId: currentWindow.id,
    };
  }

    return {
    closeDuplicateTabs,
    closeTab,
    closeTabOutDupes,
    closeTabsByUrls,
    closeTabsExact,
    createTab,
    createTabsInWindow,
    focusExactTabByUrl,
    focusTab,
    focusTabById,
    getTabUrl,
    getTabOutNewTabUrl,
    isRealTabUrl,
    isTabOutTab,
    isTabOutUrl,
    moveTabsToCurrentWindow,
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
