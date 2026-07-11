'use strict';

(function initDashboardLifecycle() {
  function createDashboardLifecycle({
    ensureStorageSchema,
    getAutoRefreshSetting,
    getCustomGroupRulesSetting,
    getLanguagePreferenceSetting,
    getTabMovingSetting,
    getThemePreferenceSetting,
    getCurrentTabId,
    getCurrentWindowId,
    getNormalizeDeferredItems,
    getNormalizeImportedSessionData,
    getSearchQuery,
    renderAutoRefreshToggle,
    renderLanguageToggle,
    renderTabMovingToggle,
    renderThemeToggle,
    renderLaterListColumn,
    scheduleOpenTabsRefresh,
    scheduleDashboardRender,
    scheduleSearchRender,
    setAutoRefreshEnabled,
    setCustomGroupRules,
    setCurrentWindowId,
    setDeferredItemsCache,
    setImportedSession,
    setLanguagePreference,
    setTabMovingEnabled,
    setThemePreference,
    shouldSkipRemovedTab,
    shouldSkipUpdatedTab = () => false,
    tabCreateMergeWindowMs = 800,
    tabUpdateMergeWindowMs = 800,
  }) {
    const recentlyCreatedTabs = new Map();
    const recentlyUpdatedTabs = new Map();
    let currentDashboardTabId = null;
    let currentDashboardTabIdPromise = Promise.resolve();

    function pruneRecentlyCreatedTabs(now = Date.now()) {
      for (const [tabId, createdAt] of recentlyCreatedTabs) {
        if (now - createdAt > tabCreateMergeWindowMs) {
          recentlyCreatedTabs.delete(tabId);
        }
      }
    }

    function markTabUpdated(tabId) {
      if (typeof tabId === 'undefined' || tabId === null) return;
      recentlyUpdatedTabs.set(Number(tabId), Date.now());
    }

    function wasRecentlyUpdated(tabId) {
      if (typeof tabId === 'undefined' || tabId === null) return false;
      const updatedAt = recentlyUpdatedTabs.get(Number(tabId));
      if (!updatedAt) return false;
      if (Date.now() - updatedAt > tabUpdateMergeWindowMs) {
        recentlyUpdatedTabs.delete(Number(tabId));
        return false;
      }
      return true;
    }

    function clearRecentlyUpdated(tabId) {
      if (typeof tabId === 'undefined' || tabId === null) return;
      recentlyUpdatedTabs.delete(Number(tabId));
    }

    function markTabCreated(tabId) {
      if (typeof tabId === 'undefined' || tabId === null) return;
      const now = Date.now();
      pruneRecentlyCreatedTabs(now);
      recentlyCreatedTabs.set(Number(tabId), now);
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

    async function hydrateCurrentDashboardTabId(logger = console) {
      if (typeof getCurrentTabId !== 'function') return;

      currentDashboardTabIdPromise = (async () => {
        const currentTab = await getCurrentTabId();
        const tabId = currentTab && typeof currentTab === 'object' ? currentTab.id : currentTab;
        if (typeof tabId === 'undefined' || tabId === null) return;
        currentDashboardTabId = Number(tabId);
        if (currentTab && typeof currentTab === 'object' && typeof setCurrentWindowId === 'function') {
          setCurrentWindowId(currentTab.windowId);
        }
      })().catch(err => {
        logger.warn('[tab-out] Failed to identify dashboard tab:', err);
      });

      await currentDashboardTabIdPromise;
    }

    async function handleUpdatedTab(tabId, changeInfo, tab) {
      const hasMeaningfulUpdate = !!(changeInfo.url || changeInfo.status === 'complete');
      if (!hasMeaningfulUpdate) return;

      if (shouldSkipUpdatedTab(tabId, changeInfo, tab)) return;

      try {
        await currentDashboardTabIdPromise;
      } catch (err) {
        // hydrateCurrentDashboardTabId logs the failure; keep normal tab updates working.
      }

      if (currentDashboardTabId !== null && Number(tabId) === currentDashboardTabId) return;

      if (wasRecentlyCreated(tabId)) {
        return;
      }

      if (changeInfo.status === 'complete' && wasRecentlyUpdated(tabId)) {
        clearRecentlyUpdated(tabId);
        return;
      }

      if (changeInfo.url || changeInfo.status === 'complete') {
        if (changeInfo.url) {
          markTabUpdated(tabId);
        }
        scheduleOpenTabsRefresh();
      }
    }

    function bindBrowserListeners({ tabsApi, storageApi, logger = console } = {}) {
      const safeTabsApi = tabsApi || (typeof chrome !== 'undefined' ? chrome.tabs : null);
      const safeStorageApi = storageApi || (typeof chrome !== 'undefined' ? chrome.storage : null);

      hydrateCurrentDashboardTabId(logger);

      if (safeTabsApi && safeTabsApi.onCreated) {
        safeTabsApi.onCreated.addListener(tab => {
          markTabCreated(tab && tab.id);
          scheduleOpenTabsRefresh();
        });
      }

      if (safeTabsApi && safeTabsApi.onRemoved) {
        safeTabsApi.onRemoved.addListener(tabId => {
          clearRecentlyCreated(tabId);
          clearRecentlyUpdated(tabId);
          if (shouldSkipRemovedTab(tabId)) return;
          scheduleOpenTabsRefresh();
        });
      }

      if (safeTabsApi && safeTabsApi.onAttached) {
        safeTabsApi.onAttached.addListener(() => {
          scheduleOpenTabsRefresh();
        });
      }

      if (safeTabsApi && safeTabsApi.onDetached) {
        safeTabsApi.onDetached.addListener(() => {
          scheduleOpenTabsRefresh();
        });
      }

      if (safeTabsApi && safeTabsApi.onUpdated) {
        safeTabsApi.onUpdated.addListener((tabId, changeInfo, tab) => {
          handleUpdatedTab(tabId, changeInfo, tab);
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

          if (changes.customGroupRules) {
            if (typeof setCustomGroupRules === 'function') {
              setCustomGroupRules(Array.isArray(changes.customGroupRules.newValue)
                ? changes.customGroupRules.newValue
                : []);
            }
            shouldRender = true;
          }

          if (changes.themePreference) {
            setThemePreference(changes.themePreference.newValue);
            renderThemeToggle();
          }

          if (changes.languagePreference) {
            setLanguagePreference(changes.languagePreference.newValue);
            renderLanguageToggle();
            shouldRender = true;
          }

          if (changes.tabMovingEnabled) {
            setTabMovingEnabled(!!changes.tabMovingEnabled.newValue);
            renderTabMovingToggle();
            shouldRender = true;
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
          if (getLanguagePreferenceSetting) {
            await getLanguagePreferenceSetting();
          }
          if (getCustomGroupRulesSetting) {
            await getCustomGroupRulesSetting();
          }
          if (getTabMovingSetting) {
            await getTabMovingSetting();
          }
          if (getCurrentWindowId && typeof setCurrentWindowId === 'function') {
            setCurrentWindowId(await getCurrentWindowId());
          }
          if (getThemePreferenceSetting) {
            await getThemePreferenceSetting();
          }
          if (renderLanguageToggle) {
            renderLanguageToggle();
          }
          if (renderTabMovingToggle) {
            renderTabMovingToggle();
          }
          if (renderThemeToggle) {
            renderThemeToggle();
          }
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
