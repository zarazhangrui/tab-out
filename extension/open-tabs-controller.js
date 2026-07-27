'use strict';

(function initOpenTabsController() {
  function createOpenTabsController({
    getState,
    getTabUrl,
    isRealTabUrl,
    isTabOutTab,
    queryDashboardTabs,
  }) {
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

    async function fetchOpenTabs() {
      if (typeof queryDashboardTabs === 'function') {
        const tabs = await queryDashboardTabs();
        if (Array.isArray(tabs) && tabs.length > 0) {
          getState().openTabs = tabs;
          return tabs;
        }
      }

      try {
        const tabs = await chrome.tabs.query({});
        let windowMap = new Map();

        if (chrome.windows && typeof chrome.windows.getAll === 'function') {
          try {
            const windows = await chrome.windows.getAll();
            windowMap = new Map((Array.isArray(windows) ? windows : [])
              .map(mapWindowInfo)
              .filter(Boolean)
              .map(windowInfo => [Number(windowInfo.id), windowInfo]));
          } catch {
            windowMap = new Map();
          }
        }

        const mappedTabs = tabs.map(tab => ({
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
        getState().openTabs = mappedTabs;
        return mappedTabs;
      } catch (err) {
        console.warn('[tab-out] Failed to fetch open tabs:', err);
        getState().openTabs = [];
        return [];
      }
    }

    function getRealTabs() {
      return getState().openTabs.filter(tab => isRealTabUrl(tab && tab.url));
    }

    return {
      fetchOpenTabs,
      getRealTabs,
    };
  }

  window.TabOutOpenTabsController = {
    createOpenTabsController,
  };
})();
