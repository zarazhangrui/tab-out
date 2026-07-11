'use strict';

(function initOpenTabsRuntime() {
  function createOpenTabsRuntime({
    appState,
    buildDomainGroups,
    checkTabOutDupes,
    fetchOpenTabs,
    getImportedSessionSectionRenderer,
    getRealTabs,
    getRenderDomainCard,
    getRenderOpenTabsSectionCount,
    getCurrentWindowId = () => null,
    getCustomGroupRules = () => [],
    getSearchQuery,
    getState,
    getTabMovingEnabled = () => false,
    getTabUrl,
    renderSearchResults,
    t = key => key,
  }) {
    function rebuildDomainGroupsFromState() {
      appState.setDomainGroups(
        typeof buildDomainGroups === 'function'
          ? buildDomainGroups({
              tabs: getRealTabs(),
              getTabUrl,
              previousGroups: getState().domainGroups,
              customGroupRules: getCustomGroupRules(),
            })
          : []
      );
    }

    function renderOpenTabsSectionFromState({ includeImportedSection = true } = {}) {
      const realTabs = getRealTabs();
      const state = getState();
      const openTabsSection = document.getElementById('openTabsSection');
      const openTabsMissionsEl = document.getElementById('openTabsMissions');
      const openTabsSectionCount = document.getElementById('openTabsSectionCount');
      const openTabsSectionTitle = document.getElementById('openTabsSectionTitle');
      const urlCounts = {};
      const currentWindowId = getCurrentWindowId();
      const tabMovingEnabled = !!getTabMovingEnabled();
      const movableTabCount = realTabs.filter(tab => (
        tabMovingEnabled &&
        typeof tab.windowId !== 'undefined' &&
        currentWindowId !== null &&
        Number(tab.windowId) !== Number(currentWindowId)
      )).length;

      rebuildDomainGroupsFromState();
      for (const tab of realTabs) {
        const url = getTabUrl(tab);
        if (!url) continue;
        urlCounts[url] = (urlCounts[url] || 0) + 1;
      }
      const totalDuplicateTabs = Object.values(urlCounts).reduce((sum, count) => (
        count > 1 ? sum + count - 1 : sum
      ), 0);

      if (state.domainGroups.length > 0 && openTabsSection && openTabsMissionsEl && openTabsSectionCount) {
        if (openTabsSectionTitle) openTabsSectionTitle.textContent = t('section.openTabs');
        openTabsSectionCount.innerHTML = getRenderOpenTabsSectionCount()(
          state.domainGroups.length,
          realTabs.length,
          totalDuplicateTabs,
          {
            movableTabCount,
            tabMovingEnabled,
          }
        );
        openTabsMissionsEl.innerHTML = state.domainGroups.map(group => getRenderDomainCard()(group, {
          currentWindowId,
          tabMovingEnabled,
        })).join('');
        openTabsSection.style.display = 'block';
      } else if (openTabsSection) {
        openTabsSection.style.display = 'none';
      }

      const statTabs = document.getElementById('statTabs');
      if (statTabs) statTabs.textContent = realTabs.length;

      checkTabOutDupes();
      if (includeImportedSection) {
        getImportedSessionSectionRenderer()();
      }
    }

    async function scheduleSearchAndWait() {
      await renderSearchResults();
    }

    async function removeOpenTabOptimistically({ tabId, tabUrl } = {}) {
      const nextOpenTabs = getState().openTabs.filter(tab => {
        if (tabId && String(tab.id) === String(tabId)) return false;
        if (!tabId && tabUrl && getTabUrl(tab) === tabUrl) return false;
        return true;
      });

      appState.setOpenTabs(nextOpenTabs);
      renderOpenTabsSectionFromState();

      if (getSearchQuery()) {
        await scheduleSearchAndWait();
      }
    }

    async function removeOpenTabsOptimistically({ tabIds = [], tabUrls = [] } = {}) {
      const idSet = new Set((Array.isArray(tabIds) ? tabIds : []).map(value => String(value)));
      const urlSet = new Set((Array.isArray(tabUrls) ? tabUrls : []).filter(Boolean));

      const nextOpenTabs = getState().openTabs.filter(tab => {
        if (idSet.size > 0 && idSet.has(String(tab.id))) return false;
        if (urlSet.size > 0 && urlSet.has(getTabUrl(tab))) return false;
        return true;
      });

      appState.setOpenTabs(nextOpenTabs);
      renderOpenTabsSectionFromState();

      if (getSearchQuery()) {
        await scheduleSearchAndWait();
      }
    }

    function removeKnownTabsFromState({ tabIds = [], tabUrls = [] } = {}) {
      const idSet = new Set((Array.isArray(tabIds) ? tabIds : []).map(value => String(value)));
      const urlSet = new Set((Array.isArray(tabUrls) ? tabUrls : []).filter(Boolean));

      const nextOpenTabs = getState().openTabs.filter(tab => {
        if (idSet.size > 0 && idSet.has(String(tab.id))) return false;
        if (urlSet.size > 0 && urlSet.has(getTabUrl(tab))) return false;
        return true;
      });

      appState.setOpenTabs(nextOpenTabs);
      return nextOpenTabs;
    }

    let latestOpenTabsReconcilePromise = Promise.resolve();

    async function reconcileOpenTabsFromBrowser() {
      latestOpenTabsReconcilePromise = latestOpenTabsReconcilePromise
        .catch(() => undefined)
        .then(async () => {
          await fetchOpenTabs();
          renderOpenTabsSectionFromState();
          if (getSearchQuery()) {
            await scheduleSearchAndWait();
          }
        });

      await latestOpenTabsReconcilePromise;
    }

    return {
      rebuildDomainGroupsFromState,
      reconcileOpenTabsFromBrowser,
      removeKnownTabsFromState,
      removeOpenTabOptimistically,
      removeOpenTabsOptimistically,
      renderOpenTabsSectionFromState,
    };
  }

  const openTabsRuntime = {
    createOpenTabsRuntime,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = openTabsRuntime;
  }

  if (typeof window !== 'undefined') {
    window.TabOutOpenTabsRuntime = openTabsRuntime;
  }
})();
