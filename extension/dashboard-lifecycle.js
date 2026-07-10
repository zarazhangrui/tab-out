'use strict';

(function initDashboardLifecycle() {
  function createDashboardLifecycle({
    ensureStorageSchema,
    getAutoRefreshSetting,
    getNormalizeDeferredItems,
    getNormalizeImportedSessionData,
    getSearchQuery,
    renderAutoRefreshToggle,
    renderLaterListColumn,
    scheduleOpenTabsRefresh,
    scheduleDashboardRender,
    scheduleSearchRender,
    setAutoRefreshEnabled,
    setDeferredItemsCache,
    setImportedSession,
    shouldSkipRemovedTab,
    tabCreateMergeWindowMs = 800,
  }) {
    const recentlyCreatedTabs = new Map();

    function markTabCreated(tabId) {
      if (typeof tabId === 'undefined' || tabId === null) return;
      recentlyCreatedTabs.set(Number(tabId), Date.now());
    }

    function wasRecentlyCreated(tabId) {
      if (typeof tabId === 'undefined' || tabId === null) return false;
      const createdAt = recentlyCreatedTabs.get(Number(tabId));
      if (!createdAt) return false;
      if (Date.now() - createdAt > tabCreateMergeWindowMs) {
        recentlyCreatedTabs.delete(Number(tabId));
        return false;
      }
      return true;
    }

    function clearRecentlyCreated(tabId) {
      if (typeof tabId === 'undefined' || tabId === null) return;
      recentlyCreatedTabs.delete(Number(tabId));
    }

    function bindBrowserListeners({ tabsApi, storageApi, logger = console } = {}) {
      const safeTabsApi = tabsApi || (typeof chrome !== 'undefined' ? chrome.tabs : null);
      const safeStorageApi = storageApi || (typeof chrome !== 'undefined' ? chrome.storage : null);

      if (safeTabsApi && safeTabsApi.onCreated) {
        safeTabsApi.onCreated.addListener(tab => {
          markTabCreated(tab && tab.id);
          scheduleOpenTabsRefresh();
        });
      }

      if (safeTabsApi && safeTabsApi.onRemoved) {
        safeTabsApi.onRemoved.addListener(tabId => {
          clearRecentlyCreated(tabId);
          if (shouldSkipRemovedTab(tabId)) return;
          scheduleOpenTabsRefresh();
        });
      }

      if (safeTabsApi && safeTabsApi.onUpdated) {
        safeTabsApi.onUpdated.addListener((tabId, changeInfo) => {
          const hasMeaningfulUpdate = !!(changeInfo.url || changeInfo.status === 'complete');
          if (!hasMeaningfulUpdate) return;

          if (wasRecentlyCreated(tabId)) {
            clearRecentlyCreated(tabId);
            return;
          }

          if (changeInfo.url || changeInfo.status === 'complete') {
            scheduleOpenTabsRefresh();
          }
        });
      }

      if (safeStorageApi && safeStorageApi.onChanged) {
        safeStorageApi.onChanged.addListener((changes, areaName) => {
          if (areaName !== 'local') return;

          let shouldRender = false;

          if (changes.deferred) {
            const { items } = getNormalizeDeferredItems()(changes.deferred.newValue);
            setDeferredItemsCache(items);
            renderLaterListColumn().catch(err => {
              logger.warn('[tab-out] Failed to refresh later list after storage change:', err);
            });
            if (getSearchQuery()) {
              scheduleSearchRender();
            }
          }

          if (changes.importedSession) {
            const { session } = getNormalizeImportedSessionData()(changes.importedSession.newValue);
            setImportedSession(session);
            shouldRender = true;
          }

          if (changes.autoRefreshEnabled) {
            setAutoRefreshEnabled(!!changes.autoRefreshEnabled.newValue);
            renderAutoRefreshToggle();
          }

          if (shouldRender) {
            scheduleDashboardRender();
          }
        });
      }
    }

    function initialize({ logger = console } = {}) {
      return Promise.resolve().finally(async () => {
        try {
          if (ensureStorageSchema) {
            await ensureStorageSchema();
          }
          await getAutoRefreshSetting();
        } catch (err) {
          logger.warn('[tab-out] Initialization fallback path triggered:', err);
        }
        scheduleDashboardRender();
      });
    }

    return {
      bindBrowserListeners,
      initialize,
    };
  }

  const dashboardLifecycle = {
    createDashboardLifecycle,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = dashboardLifecycle;
  }

  if (typeof window !== 'undefined') {
    window.TabOutDashboardLifecycle = dashboardLifecycle;
  }
})();
