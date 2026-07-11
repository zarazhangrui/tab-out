'use strict';

(function initDashboardActions() {
  function createDashboardActions({
    animateCardOut,
    buildSessionFilename,
    checkOffSavedTab,
    checkTabOutDupes,
    closeDuplicateTabs,
    closeMoreMenu,
    closeOpenTab,
    closeTabOutDupes,
    closeTabsByUrls,
    closeTabsExact,
    createSessionExport,
    createTab,
    dismissSavedTab,
    downloadJsonFile,
    focusMoreMenuItem,
    focusExactTabByUrl,
    focusTab,
    focusTabById,
    friendlyDomain,
    getAutoRefreshEnabled,
    getCurrentWindowId = () => null,
    getDashboardStateSnapshot,
    getDomainGroupByStableId,
    getLanguagePreference = () => 'en',
    getMoreMenuOpen,
    getNextLanguagePreference = language => (language === 'zh' ? 'en' : 'zh'),
    getNextThemePreference,
    getTabUrl,
    getThemePreference,
    hasActiveSearch,
    importedSessionController,
    isRealTabUrl,
    laterListController,
    moveTabsToCurrentWindow,
    playCloseSound,
    removeKnownTabsFromState,
    removeOpenTabOptimistically,
    removeOpenTabsOptimistically,
    renderAutoRefreshToggle,
    renderImportedSessionSection,
    renderLaterListColumn,
    renderLanguageToggle,
    renderMoreMenu,
    renderStaticText = () => {},
    renderTabMovingToggle,
    renderThemeToggle,
    reconcileOpenTabsFromBrowser,
    saveTabForLater,
    scheduleDashboardAndWait,
    scheduleSearchAndWait,
    sessionImportInputSelector = '#sessionImportInput',
    setAutoRefreshSetting,
    setLanguagePreferenceSetting,
    setMoreMenuOpen,
    setTabMovingSetting,
    setThemePreferenceSetting,
    showToast,
    suppressRemovedTabRefresh,
    shootConfetti,
    t = key => key,
  }) {
    const BULK_CLOSE_THRESHOLDS = {
      'close-all-open-tabs': {
        light: 30,
        strong: 60,
      },
      'close-domain-tabs': {
        light: 10,
        strong: 20,
      },
    };
    const BULK_CLOSE_CONFIRM_WINDOW_MS = 2500;
    let pendingBulkCloseConfirmation = null;

    function restoreBulkCloseActionLabel(actionEl) {
      if (!actionEl || !actionEl.dataset) return;
      const originalLabel = actionEl.dataset.originalLabel;
      if (originalLabel) {
        actionEl.innerHTML = originalLabel;
      }
      delete actionEl.dataset.originalLabel;
      delete actionEl.dataset.bulkCloseConfirming;
      delete actionEl.dataset.bulkCloseConfirmMode;
    }

    function clearBulkCloseConfirmation() {
      if (!pendingBulkCloseConfirmation) return;
      if (pendingBulkCloseConfirmation.timeoutId) {
        clearTimeout(pendingBulkCloseConfirmation.timeoutId);
      }
      restoreBulkCloseActionLabel(pendingBulkCloseConfirmation.actionEl);
      pendingBulkCloseConfirmation = null;
    }

    function getBulkCloseConfirmationMode(action, count) {
      const thresholds = BULK_CLOSE_THRESHOLDS[action];
      if (!thresholds) return null;
      if (count >= thresholds.strong) return 'strong';
      if (count >= thresholds.light) return 'light';
      return null;
    }

    function buildBulkCloseConfirmationCopy({ count, description = '', mode }) {
      if (mode === 'strong') {
        return {
          buttonLabel: `Yes, close ${count} tabs`,
          toastMessage: `Click again for explicit confirm to close ${count} tabs${description ? ` ${description}` : ''}`,
        };
      }
      return {
        buttonLabel: `Click again: close ${count} tabs`,
        toastMessage: `Click again to close ${count} tabs${description ? ` ${description}` : ''}`,
      };
    }

    function requestBulkCloseConfirmation({ action, actionEl, count, description = '' }) {
      const mode = getBulkCloseConfirmationMode(action, count);
      if (!actionEl || !mode) {
        return true;
      }

      if (
        pendingBulkCloseConfirmation &&
        pendingBulkCloseConfirmation.actionEl === actionEl &&
        actionEl.dataset.bulkCloseConfirming === 'true' &&
        actionEl.dataset.bulkCloseConfirmMode === mode
      ) {
        clearBulkCloseConfirmation();
        return true;
      }

      const copy = buildBulkCloseConfirmationCopy({ count, description, mode });
      clearBulkCloseConfirmation();
      actionEl.dataset.originalLabel = actionEl.innerHTML;
      actionEl.dataset.bulkCloseConfirming = 'true';
      actionEl.dataset.bulkCloseConfirmMode = mode;
      actionEl.textContent = copy.buttonLabel;
      pendingBulkCloseConfirmation = {
        actionEl,
        timeoutId: setTimeout(() => {
          restoreBulkCloseActionLabel(actionEl);
          pendingBulkCloseConfirmation = null;
        }, BULK_CLOSE_CONFIRM_WINDOW_MS),
      };
      showToast(copy.toastMessage);
      return false;
    }

    return {
      'manual-refresh': async () => {
        closeMoreMenu();
        await scheduleDashboardAndWait();
        showToast(t('toast.refreshed'));
      },
      'toggle-more-menu': async () => {
        setMoreMenuOpen(!getMoreMenuOpen());
        renderMoreMenu();
        if (getMoreMenuOpen()) {
          setTimeout(() => focusMoreMenuItem(0), 0);
        }
      },
      'toggle-auto-refresh': async () => {
        await setAutoRefreshSetting(!getAutoRefreshEnabled());
        renderAutoRefreshToggle();
        closeMoreMenu();
        showToast(t('toast.autoRefresh', {
          state: t(getAutoRefreshEnabled() ? 'menu.on' : 'menu.off'),
        }));
      },
      'toggle-theme': async () => {
        const nextPreference = getNextThemePreference(getThemePreference());
        await setThemePreferenceSetting(nextPreference);
        renderThemeToggle();
        closeMoreMenu();
        showToast(t('toast.theme', {
          theme: t(`menu.theme.${nextPreference}`),
        }));
      },
      'toggle-language': async () => {
        const nextLanguage = getNextLanguagePreference(getLanguagePreference());
        await setLanguagePreferenceSetting(nextLanguage);
        renderStaticText();
        renderAutoRefreshToggle();
        renderLanguageToggle();
        renderTabMovingToggle();
        renderThemeToggle();
        await scheduleDashboardAndWait();
        closeMoreMenu();
        showToast(t('toast.language', {
          language: t(`language.${nextLanguage}`),
        }));
      },
      'toggle-tab-moving': async () => {
        const snapshot = getDashboardStateSnapshot();
        await setTabMovingSetting(!snapshot.tabMovingEnabled);
        renderTabMovingToggle();
        await scheduleDashboardAndWait();
        closeMoreMenu();
        showToast(t('toast.tabMoving', {
          state: t(snapshot.tabMovingEnabled ? 'menu.off' : 'menu.on'),
        }));
      },
      'trigger-import-session': async () => {
        const input = document.querySelector(sessionImportInputSelector);
        closeMoreMenu();
        if (input) input.click();
      },
      'export-all-groups': async () => {
        const payload = createSessionExport(getDashboardStateSnapshot().domainGroups);
        closeMoreMenu();
        downloadJsonFile(buildSessionFilename('all-tabs'), payload);
        showToast(t('toast.exportedGroups', {
          count: payload.groups.length,
          groupLabel: t(payload.groups.length === 1 ? 'common.group.one' : 'common.group.other'),
        }));
      },
      'export-imported-session': async () => importedSessionController.handleExportImportedSession(),
      'clear-imported-session': async () => importedSessionController.handleClearImportedSession(),
      'restore-imported-session': async () => {
        const result = await importedSessionController.handleRestoreImportedSession();
        if (!result) return;
        if (result.changedOpenTabs) {
          await scheduleDashboardAndWait();
          return;
        }
        renderImportedSessionSection();
      },
      'clear-later-list': async () => laterListController.handleClearSavedTabsByState({ completed: false }),
      'clear-later-archive': async () => laterListController.handleClearSavedTabsByState({ completed: true }),
      'close-tabout-dupes': async () => {
        const result = await closeTabOutDupes({
          beforeRemove(tabIds) {
            suppressRemovedTabRefresh(tabIds);
          },
        });
        if (!result || !result.closedCount) {
          await scheduleDashboardAndWait();
          showToast(t('toast.noExtraTabOut'));
          return;
        }
        playCloseSound();
        removeKnownTabsFromState({
          tabIds: result && Array.isArray(result.tabIds) ? result.tabIds : [],
          tabUrls: [],
        });
        checkTabOutDupes();
        showToast(t('toast.closedExtraTabOut'));
      },
      'expand-chips': async ({ actionEl }) => {
        const overflowContainer = actionEl.parentElement.querySelector('.page-chips-overflow');
        if (overflowContainer) {
          overflowContainer.style.display = 'contents';
          actionEl.remove();
        }
      },
      'focus-tab': async ({ actionEl }) => {
        const tabId = actionEl.dataset.tabId;
        const tabUrl = actionEl.dataset.tabUrl;
        let focused = false;

        if (tabId) {
          focused = !!(await focusTabById(tabId));
        }

        if (!focused && tabUrl && typeof focusExactTabByUrl === 'function') {
          focused = !!(await focusExactTabByUrl(tabUrl));
        }

        if (!focused && tabUrl && !tabId) {
          focused = !!(await focusTab(tabUrl));
        }

        if (focused) return;

        showToast(t('toast.targetGone'));
        await reconcileOpenTabsFromBrowser();
      },
      'open-later-item': async ({ actionEl }) => {
        const laterUrl = actionEl.dataset.laterUrl;
        if (!laterUrl) return;
        await createTab(laterUrl, { active: true });
      },
      'restore-imported-group': async ({ actionEl }) => {
        const result = await importedSessionController.handleRestoreImportedGroup(actionEl.dataset.importedGroupId);
        if (!result) return;
        if (result.changedOpenTabs) {
          await scheduleDashboardAndWait();
          return;
        }
        renderImportedSessionSection();
      },
      'restore-imported-tab': async ({ actionEl }) => {
        const result = await importedSessionController.handleRestoreImportedTab(
          actionEl.dataset.importedGroupId,
          actionEl.dataset.importedTabId,
          actionEl.dataset.tabUrl
        );
        if (!result) return;
        if (result.changedOpenTabs) {
          await scheduleDashboardAndWait();
          return;
        }
        if (!result.focusedExistingTab) {
          renderImportedSessionSection();
        }
      },
      'clear-imported-group': async ({ actionEl }) => (
        importedSessionController.handleClearImportedGroup(actionEl.dataset.importedGroupId)
      ),
      'clear-imported-tab': async ({ actionEl, event }) => {
        event.stopPropagation();
        await importedSessionController.handleClearImportedTab(
          actionEl.dataset.importedGroupId,
          actionEl.dataset.importedTabId
        );
      },
      'move-tab-here': async ({ actionEl, event }) => {
        if (event && typeof event.stopPropagation === 'function') {
          event.stopPropagation();
        }
        const tabId = actionEl.dataset.tabId;
        if (!tabId || typeof moveTabsToCurrentWindow !== 'function') return;
        const result = await moveTabsToCurrentWindow([tabId]);
        await reconcileOpenTabsFromBrowser();
        showToast(result && result.movedCount > 0
          ? t('toast.movedHere', { count: result.movedCount, tabLabel: t(result.movedCount === 1 ? 'common.tab.one' : 'common.tab.other') })
          : t('toast.targetAlreadyHere'));
      },
      'close-single-tab': async ({ actionEl, event }) => {
        event.stopPropagation();
        const tabId = actionEl.dataset.tabId;
        const tabUrl = actionEl.dataset.tabUrl;
        if (!tabId && !tabUrl) return;
        const chip = actionEl.closest('.page-chip');
        const result = await closeOpenTab(tabId, tabUrl);
        if (!result) {
          showToast(t('toast.targetGone'));
          await reconcileOpenTabsFromBrowser();
          return;
        }
        playCloseSound();
        if (chip) {
          animateCardOut(chip);
        }
        await removeOpenTabOptimistically({ tabId, tabUrl });
        await reconcileOpenTabsFromBrowser();
        showToast(t('toast.closedTab'));
      },
      'close-tab-url-dupes': async ({ actionEl, event }) => {
        event.stopPropagation();
        const tabUrl = actionEl.dataset.tabUrl;
        if (!tabUrl) return;
        const chip = actionEl.closest('.page-chip');
        const result = await closeTabsExact([tabUrl]);
        if (!result || !result.closedCount) return;
        playCloseSound();
        if (chip) {
          animateCardOut(chip);
        }
        await removeOpenTabsOptimistically({
          tabIds: result && Array.isArray(result.tabIds) ? result.tabIds : [],
          tabUrls: [tabUrl],
        });
        await reconcileOpenTabsFromBrowser();
        showToast(t('toast.closedTabDupes', {
          count: result.closedCount,
          tabLabel: t(result.closedCount === 1 ? 'common.tab.one' : 'common.tab.other'),
        }));
      },
      'defer-single-tab': async ({ actionEl, event }) => {
        event.stopPropagation();
        const tabId = actionEl.dataset.tabId;
        const tabUrl = actionEl.dataset.tabUrl;
        const tabTitle = actionEl.dataset.tabTitle || tabUrl;
        if (!tabUrl) return;
        const chip = actionEl.closest('.page-chip');
        try {
          await saveTabForLater({ url: tabUrl, title: tabTitle });
        } catch (err) {
          console.error('[tab-out] Failed to save tab:', err);
          showToast(t('toast.failedSave'));
          return;
        }
        await closeOpenTab(tabId, tabUrl);
        playCloseSound();
        if (chip) {
          animateCardOut(chip);
        }
        await renderLaterListColumn();
        await removeOpenTabOptimistically({ tabId, tabUrl });
        showToast(t('toast.addedToLater'));
      },
      'check-later': async ({ actionEl }) => {
        const id = actionEl.dataset.laterId;
        if (!id) return;
        await checkOffSavedTab(id);
        const item = actionEl.closest('.later-item');
        if (item) {
          item.classList.add('checked');
          setTimeout(() => {
            item.classList.add('removing');
            setTimeout(async () => {
              await renderLaterListColumn();
              if (hasActiveSearch()) {
                await scheduleSearchAndWait();
              }
            }, 300);
          }, 800);
        } else {
          await renderLaterListColumn();
          if (hasActiveSearch()) {
            await scheduleSearchAndWait();
          }
        }
        showToast(t('toast.movedToArchive'));
      },
      'dismiss-later': async ({ actionEl }) => {
        const id = actionEl.dataset.laterId;
        if (!id) return;
        const removedItem = await dismissSavedTab(id);
        const item = actionEl.closest('.later-item');
        if (item) {
          item.classList.add('removing');
          setTimeout(async () => {
            await renderLaterListColumn();
            if (hasActiveSearch()) {
              await scheduleSearchAndWait();
            }
          }, 300);
        } else {
          await renderLaterListColumn();
          if (hasActiveSearch()) {
            await scheduleSearchAndWait();
          }
        }
        showToast(removedItem && removedItem.completed ? t('toast.removedArchive') : t('toast.removedLater'));
      },
      'close-domain-tabs': async ({ actionEl }) => {
        const card = actionEl.closest('.mission-card');
        const group = getDomainGroupByStableId(actionEl.dataset.domainId);
        if (!group) return;
        const urls = group.tabs.map(tab => getTabUrl(tab)).filter(url => isRealTabUrl(url));
        if (urls.length === 0) return;
        const groupLabel = group.domain === '__landing-pages__' ? 'Homepages' : (group.label || friendlyDomain(group.domain));
        if (!requestBulkCloseConfirmation({
          action: 'close-domain-tabs',
          actionEl,
          count: urls.length,
          description: `from ${groupLabel}`,
        })) {
          return;
        }
        const useExact = group.domain === '__landing-pages__' || !!group.label;
        if (useExact) {
          await closeTabsExact(urls);
        } else {
          await closeTabsByUrls(urls);
        }
        const closedTabIds = group.tabs.map(tab => tab.id).filter(id => typeof id !== 'undefined' && id !== null);
        if (card) {
          playCloseSound();
          animateCardOut(card);
        }
        await removeOpenTabsOptimistically({ tabIds: closedTabIds, tabUrls: urls });
        await reconcileOpenTabsFromBrowser();
        showToast(t('toast.closedFromGroup', {
          count: urls.length,
          group: groupLabel,
          tabLabel: t(urls.length === 1 ? 'common.tab.one' : 'common.tab.other'),
        }));
      },
      'move-domain-tabs-here': async ({ actionEl }) => {
        const group = getDomainGroupByStableId(actionEl.dataset.domainId);
        if (!group || typeof moveTabsToCurrentWindow !== 'function') return;
        const currentWindowId = getCurrentWindowId();
        const tabIds = (group.tabs || [])
          .filter(tab => (
            typeof tab.id !== 'undefined' &&
            typeof tab.windowId !== 'undefined' &&
            currentWindowId !== null &&
            Number(tab.windowId) !== Number(currentWindowId)
          ))
          .map(tab => tab.id);
        const groupLabel = group.domain === '__landing-pages__' ? 'Homepages' : (group.label || friendlyDomain(group.domain));
        if (tabIds.length === 0) {
          showToast(`${groupLabel} ${t('toast.targetAlreadyHere')}`);
          return;
        }
        const result = await moveTabsToCurrentWindow(tabIds);
        await reconcileOpenTabsFromBrowser();
        showToast(result && result.movedCount > 0
          ? t('toast.movedFromGroup', {
              count: result.movedCount,
              group: groupLabel,
              tabLabel: t(result.movedCount === 1 ? 'common.tab.one' : 'common.tab.other'),
            })
          : `${groupLabel} ${t('toast.targetAlreadyHere')}`);
      },
      'export-domain-group': async ({ actionEl }) => {
        const group = getDomainGroupByStableId(actionEl.dataset.domainId);
        if (!group) return;
        const payload = createSessionExport([group]);
        downloadJsonFile(buildSessionFilename(group.label || group.domain || 'group'), payload);
        showToast(t('toast.exportedGroups', {
          count: 1,
          groupLabel: group.label || friendlyDomain(group.domain),
        }));
      },
      'dedup-keep-one': async ({ actionEl }) => {
        const urlsEncoded = actionEl.dataset.dupeUrls || '';
        const urls = urlsEncoded.split(',').map(value => decodeURIComponent(value)).filter(Boolean);
        if (urls.length === 0) return;
        const result = await closeDuplicateTabs(urls, true);
        playCloseSound();
        await removeOpenTabsOptimistically({
          tabIds: result && Array.isArray(result.tabIds) ? result.tabIds : [],
          tabUrls: urls,
        });
        await reconcileOpenTabsFromBrowser();
        showToast(t('toast.closedDuplicates'));
      },
      'close-all-dupes': async () => {
        const snapshot = getDashboardStateSnapshot();
        const urlCounts = {};
        for (const tab of snapshot.openTabs || []) {
          const url = getTabUrl(tab);
          if (!isRealTabUrl(url)) continue;
          urlCounts[url] = (urlCounts[url] || 0) + 1;
        }
        const dupeUrls = Object.entries(urlCounts)
          .filter(([, count]) => count > 1)
          .map(([url]) => url);
        if (dupeUrls.length === 0) return;
        const result = await closeDuplicateTabs(dupeUrls, true);
        playCloseSound();
        await removeOpenTabsOptimistically({
          tabIds: result && Array.isArray(result.tabIds) ? result.tabIds : [],
          tabUrls: dupeUrls,
        });
        await reconcileOpenTabsFromBrowser();
        showToast(t('toast.closedAllDupes'));
      },
      'close-all-open-tabs': async () => {
        const snapshot = getDashboardStateSnapshot();
        const openTabIds = snapshot.openTabs.map(tab => tab.id).filter(id => typeof id !== 'undefined' && id !== null);
        const allUrls = snapshot.openTabs
          .map(tab => getTabUrl(tab))
          .filter(url => isRealTabUrl(url));
        if (allUrls.length === 0) return;
        const closeAllButton = document.querySelector('[data-action="close-all-open-tabs"]');
        if (!requestBulkCloseConfirmation({
          action: 'close-all-open-tabs',
          actionEl: closeAllButton,
          count: allUrls.length,
        })) {
          return;
        }
        document.querySelectorAll('#openTabsMissions .mission-card').forEach(card => {
          shootConfetti(
            card.getBoundingClientRect().left + card.offsetWidth / 2,
            card.getBoundingClientRect().top + card.offsetHeight / 2
          );
        });
        await closeTabsExact(allUrls);
        playCloseSound();
        await removeOpenTabsOptimistically({ tabIds: openTabIds, tabUrls: allUrls });
        await reconcileOpenTabsFromBrowser();
        showToast(t('toast.allTabsClosed'));
      },
      'move-all-tabs-here': async () => {
        if (typeof moveTabsToCurrentWindow !== 'function') return;
        const currentWindowId = getCurrentWindowId();
        const snapshot = getDashboardStateSnapshot();
        const tabIds = (snapshot.openTabs || [])
          .filter(tab => (
            typeof tab.id !== 'undefined' &&
            typeof tab.windowId !== 'undefined' &&
            currentWindowId !== null &&
            Number(tab.windowId) !== Number(currentWindowId) &&
            isRealTabUrl(getTabUrl(tab))
          ))
          .map(tab => tab.id);
        if (tabIds.length === 0) {
          showToast(t('toast.allAlreadyHere'));
          return;
        }
        const result = await moveTabsToCurrentWindow(tabIds);
        await reconcileOpenTabsFromBrowser();
        showToast(result && result.movedCount > 0
          ? t('toast.movedHere', {
              count: result.movedCount,
              tabLabel: t(result.movedCount === 1 ? 'common.tab.one' : 'common.tab.other'),
            })
          : t('toast.allAlreadyHere'));
      },
    };
  }

  const dashboardActions = {
    createDashboardActions,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = dashboardActions;
  }

  if (typeof window !== 'undefined') {
    window.TabOutDashboardActions = dashboardActions;
  }
})();
