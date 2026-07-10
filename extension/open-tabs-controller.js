'use strict';

(function initOpenTabsController() {
  function createOpenTabsController({
    getState,
    getTabUrl,
    isRealTabUrl,
    isTabOutTab,
    queryDashboardTabs,
  }) {
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
        const mappedTabs = tabs.map(tab => ({
          id: tab.id,
          url: getTabUrl(tab),
          title: tab.title,
          favIconUrl: tab.favIconUrl || '',
          windowId: tab.windowId,
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
