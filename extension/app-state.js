'use strict';

(function initTabOutAppState() {
  function createAppState() {
    const state = {
      openTabs: [],
      importedSession: null,
      domainGroups: [],
      deferredItemsCache: [],
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
    };
  }

  window.TabOutAppState = {
    createAppState,
  };
})();
