'use strict';

(function initLaterListController() {
  function createLaterListController({
    createStableId,
    getState,
    getStorageValue,
    normalizeDeferredItems,
    queueStorageUpdate,
    setStorageValue,
  }) {
    function setDeferredItemsCache(items) {
      getState().deferredItemsCache = Array.isArray(items) ? items : [];
    }

    function getSavedTabsFromCache() {
      const visible = getState().deferredItemsCache.filter(item => !item.dismissed);
      return {
        active: visible.filter(item => !item.completed),
        archived: visible.filter(item => item.completed),
      };
    }

    async function saveTabForLater(tab) {
      await queueStorageUpdate('deferred', currentDeferred => {
        const { items } = normalizeDeferredItems(currentDeferred);
        const deferred = [...items];
        deferred.push({
          id: createStableId('later'),
          url: tab.url,
          title: tab.title,
          savedAt: new Date().toISOString(),
          completed: false,
          dismissed: false,
        });
        setDeferredItemsCache(deferred);
        return deferred;
      });
    }

    async function getSavedTabs() {
      const rawDeferred = await getStorageValue('deferred');
      const { items: deferred, changed } = normalizeDeferredItems(rawDeferred);
      setDeferredItemsCache(deferred);
      if (changed) {
        await setStorageValue('deferred', deferred);
      }
      return getSavedTabsFromCache();
    }

    async function checkOffSavedTab(id) {
      await queueStorageUpdate('deferred', currentDeferred => {
        const { items } = normalizeDeferredItems(currentDeferred);
        const deferred = [...items];
        const tab = deferred.find(item => item.id === id);
        if (!tab) return deferred;
        tab.completed = true;
        tab.completedAt = new Date().toISOString();
        setDeferredItemsCache(deferred);
        return deferred;
      });
    }

    async function dismissSavedTab(id) {
      let removed = null;
      await queueStorageUpdate('deferred', currentDeferred => {
        const { items } = normalizeDeferredItems(currentDeferred);
        const deferred = [...items];
        const tab = deferred.find(item => item.id === id);
        if (!tab) return deferred;
        tab.dismissed = true;
        removed = { ...tab };
        setDeferredItemsCache(deferred);
        return deferred;
      });
      return removed;
    }

    async function clearSavedTabsByState({ completed }) {
      let changed = 0;
      await queueStorageUpdate('deferred', currentDeferred => {
        const { items } = normalizeDeferredItems(currentDeferred);
        const deferred = [...items];

        for (const item of deferred) {
          if (item.dismissed) continue;
          if (!!item.completed !== !!completed) continue;
          item.dismissed = true;
          changed += 1;
        }

        setDeferredItemsCache(deferred);
        return deferred;
      });

      return changed;
    }

    return {
      checkOffSavedTab,
      clearSavedTabsByState,
      dismissSavedTab,
      getSavedTabs,
      getSavedTabsFromCache,
      saveTabForLater,
      setDeferredItemsCache,
    };
  }

  window.TabOutLaterListController = {
    createLaterListController,
  };
})();
