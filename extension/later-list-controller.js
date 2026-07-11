'use strict';

(function initLaterListController() {
  function createLaterListController({
    buildFaviconImg,
    countLabel = (_key, count) => (Number(count) === 1 ? 'item' : 'items'),
    createStableId,
    escapeHtml,
    getState,
    getStorageValue,
    normalizeDeferredItems,
    queueStorageUpdate,
    scheduleSearchAndWait,
    setStorageValue,
    showToast,
    t = key => key,
    timeAgo,
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

    function renderLaterItem(item) {
      let domain = '';
      try { domain = new URL(item.url).hostname.replace(/^www\./, ''); } catch {}
      const ago = timeAgo(item.savedAt);
      const safeId = escapeHtml(item.id);
      const safeUrl = escapeHtml(item.url);
      const safeTitle = escapeHtml(item.title || item.url);
      const safeDomain = escapeHtml(domain);

      return `
        <div class="later-item" data-later-id="${safeId}">
          <input type="checkbox" class="later-checkbox" data-action="check-later" data-later-id="${safeId}">
          <div class="later-info">
            <a href="${safeUrl}" target="_blank" rel="noopener" class="later-title text-tooltip" data-tooltip="${safeTitle}" aria-label="${safeTitle}">
              ${buildFaviconImg(domain, 'deferred-favicon')}${safeTitle}
            </a>
            <div class="later-meta">
              <span>${safeDomain}</span>
              <span>${escapeHtml(ago)}</span>
            </div>
          </div>
          <button class="later-dismiss" data-action="dismiss-later" data-later-id="${safeId}" data-tooltip="${t('action.remove')}" aria-label="${t('action.remove')}">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
          </button>
        </div>`;
    }

    function renderArchiveItem(item) {
      const ago = item.completedAt ? timeAgo(item.completedAt) : timeAgo(item.savedAt);
      const safeUrl = escapeHtml(item.url);
      const safeTitle = escapeHtml(item.title || item.url);
      return `
        <div class="archive-item">
          <a href="${safeUrl}" target="_blank" rel="noopener" class="archive-item-title text-tooltip" data-tooltip="${safeTitle}" aria-label="${safeTitle}">
            ${safeTitle}
          </a>
          <span class="archive-item-date">${escapeHtml(ago)}</span>
        </div>`;
    }

    async function renderLaterListColumn() {
      const column = document.getElementById('laterColumn');
      const list = document.getElementById('laterList');
      const empty = document.getElementById('laterEmpty');
      const countEl = document.getElementById('laterCount');
      const archiveEl = document.getElementById('laterArchive');
      const archiveCountEl = document.getElementById('archiveCount');
      const archiveList = document.getElementById('archiveList');

      if (!column) return;

      try {
        const { active, archived } = await getSavedTabs();

        if (active.length === 0 && archived.length === 0) {
          column.style.display = 'none';
          return;
        }

        column.style.display = 'block';

        if (active.length > 0) {
          countEl.textContent = `${active.length} ${countLabel('common.item', active.length)}`;
          list.innerHTML = active.map(item => renderLaterItem(item)).join('');
          list.style.display = 'block';
          empty.style.display = 'none';
        } else {
          list.style.display = 'none';
          countEl.textContent = '';
          empty.style.display = 'block';
        }

        if (archived.length > 0) {
          archiveCountEl.textContent = `(${archived.length})`;
          archiveList.innerHTML = archived.map(item => renderArchiveItem(item)).join('');
          archiveEl.style.display = 'block';
        } else {
          archiveEl.style.display = 'none';
        }
      } catch (err) {
        console.warn('[tab-out] Could not load saved tabs:', err);
        column.style.display = 'none';
      }
    }

    async function handleClearSavedTabsByState({ completed }) {
      const cleared = await clearSavedTabsByState({ completed });
      await renderLaterListColumn();
      if (typeof scheduleSearchAndWait === 'function') {
        await scheduleSearchAndWait();
      }
      if (typeof showToast === 'function') {
        if (completed) {
          showToast(cleared > 0
            ? t('toast.clearedArchive', { count: cleared, itemLabel: countLabel('common.item', cleared) })
            : t('toast.archiveAlreadyEmpty'));
        } else {
          showToast(cleared > 0
            ? t('toast.clearedLater', { count: cleared, itemLabel: countLabel('common.item', cleared) })
            : t('toast.laterAlreadyEmpty'));
        }
      }
      return cleared;
    }

    return {
      checkOffSavedTab,
      clearSavedTabsByState,
      dismissSavedTab,
      handleClearSavedTabsByState,
      getSavedTabs,
      getSavedTabsFromCache,
      renderArchiveItem,
      renderLaterItem,
      renderLaterListColumn,
      saveTabForLater,
      setDeferredItemsCache,
    };
  }

  window.TabOutLaterListController = {
    createLaterListController,
  };
})();
