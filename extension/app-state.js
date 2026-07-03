'use strict';

(function initTabOutAppState() {
  function createAppState() {
    const state = {
      openTabs: [],
      importedSession: null,
      domainGroups: [],
      deferredItemsCache: [],
      ui: {
        dashboardRefreshTimer: null,
        autoRefreshEnabled: false,
        globalSearchQuery: '',
        searchDebounceTimer: null,
        moreMenuOpen: false,
        latestDashboardRenderPromise: Promise.resolve(),
        latestSearchRenderPromise: Promise.resolve(false),
      },
    };

    return {
      getState() {
        return state;
      },
      setOpenTabs(tabs) {
        state.openTabs = Array.isArray(tabs) ? tabs : [];
        return state.openTabs;
      },
      setImportedSession(session) {
        state.importedSession = session || null;
        return state.importedSession;
      },
      setDomainGroups(groups) {
        state.domainGroups = Array.isArray(groups) ? groups : [];
        return state.domainGroups;
      },
      setDeferredItemsCache(items) {
        state.deferredItemsCache = Array.isArray(items) ? items : [];
        return state.deferredItemsCache;
      },
      setUiState(patch) {
        Object.assign(state.ui, patch || {});
        return state.ui;
      },
    };
  }

  window.TabOutAppState = {
    createAppState,
  };
})();
