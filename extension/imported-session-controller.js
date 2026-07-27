'use strict';

(function initImportedSessionController() {
  function createImportedSessionController({
    buildImportedGroupViewModel,
    buildImportedTabViewModel,
    buildSessionFilename,
    buildFaviconImg,
    countLabel = (_key, count) => (Number(count) === 1 ? 'tab' : 'tabs'),
    createSessionExport,
    dedupeSessionGroups,
    createTab,
    createTabsInWindow,
    downloadJsonFile,
    escapeHtml,
    focusExactTabByUrl,
    friendlyDomain,
    formatSessionDate,
    getState,
    getRealTabs,
    queryRawTabs,
    normalizeImportedSessionData,
    planRestoreTabs,
    parseImportedSession,
    summarizeRestorePlan,
    getStorageValue,
    setStorageValue,
    queueStorageUpdate,
    syncImportedSessionSearchResults,
    showToast,
    t = key => key,
  }) {
    async function getImportedSession() {
      const rawImportedSession = await getStorageValue('importedSession');
      const { session, changed } = normalizeImportedSessionData(rawImportedSession);
      getState().importedSession = session;
      if (changed) {
        await setStorageValue('importedSession', session);
      }
      return getState().importedSession;
    }

    async function setImportedSession(session) {
      const { session: normalized } = normalizeImportedSessionData(session);
      getState().importedSession = normalized;
      await queueStorageUpdate('importedSession', () => getState().importedSession);
    }

    async function clearImportedSession() {
      getState().importedSession = null;
      await queueStorageUpdate('importedSession', () => null);
    }

    async function clearImportedSessionGroup(groupId) {
      const { importedSession } = getState();
      if (!importedSession || !Array.isArray(importedSession.groups)) return;

      const nextGroups = importedSession.groups.filter(group => group.id !== groupId);
      if (nextGroups.length === 0) {
        await clearImportedSession();
        return;
      }

      await setImportedSession({
        ...importedSession,
        groups: nextGroups,
      });
    }

    function mergeImportedSessions(existingSession, incomingSession) {
      if (!existingSession || !Array.isArray(existingSession.groups) || existingSession.groups.length === 0) {
        return incomingSession;
      }

      const existingGroups = existingSession.groups || [];
      const existingIds = new Set(existingGroups.map(group => group.id));
      const mergedGroups = [...existingGroups];

      for (const group of incomingSession.groups || []) {
        let nextId = group.id || group.domain || 'imported-group';
        let suffix = 2;

        while (existingIds.has(nextId)) {
          nextId = `${group.id || group.domain || 'imported-group'}-${suffix}`;
          suffix += 1;
        }

        existingIds.add(nextId);
        mergedGroups.push({
          ...group,
          id: nextId,
        });
      }

      return {
        version: incomingSession.version || existingSession.version || 1,
        source: 'tab-out',
        exportedAt: incomingSession.exportedAt || existingSession.exportedAt || new Date().toISOString(),
        groups: mergedGroups,
      };
    }

    function getImportedGroupById(groupId) {
      const { importedSession } = getState();
      return importedSession && Array.isArray(importedSession.groups)
        ? importedSession.groups.find(group => group.id === groupId) || null
        : null;
    }

    function getImportedSessionTab(groupId, tabId) {
      const group = getImportedGroupById(groupId);
      if (!group || !Array.isArray(group.tabs)) return null;
      const tab = group.tabs.find(item => item && item.id === tabId);
      if (!tab) return null;
      return { group, tab };
    }

    async function clearImportedSessionTab(groupId, tabId) {
      const { importedSession } = getState();
      if (!importedSession || !Array.isArray(importedSession.groups) || !groupId || !tabId) return false;

      const nextGroups = [];
      let changed = false;

      for (const group of importedSession.groups) {
        if (group.id !== groupId) {
          nextGroups.push(group);
          continue;
        }

        const nextTabs = (group.tabs || []).filter(tab => {
          const keep = !(tab && tab.id === tabId);
          if (!keep) changed = true;
          return keep;
        });

        if (nextTabs.length > 0) {
          nextGroups.push({
            ...group,
            tabs: nextTabs,
          });
        }
      }

      if (!changed) return false;

      if (nextGroups.length === 0) {
        await clearImportedSession();
        return true;
      }

      await setImportedSession({
        ...importedSession,
        groups: nextGroups,
      });
      return true;
    }

    async function restoreSessionGroups(groups, { mode = 'current-window' } = {}) {
      const safeGroups = Array.isArray(groups) ? groups : [];
      if (safeGroups.length === 0) {
        return { opened: 0, skipped: 0, changedOpenTabs: false };
      }

      const currentTabs = typeof queryRawTabs === 'function' ? await queryRawTabs() : [];
      const plan = typeof summarizeRestorePlan === 'function'
        ? summarizeRestorePlan(safeGroups, currentTabs)
        : planRestoreTabs(safeGroups, currentTabs);

      if (plan.toOpen.length === 0) {
        return {
          opened: 0,
          skipped: plan.skipped.length,
          changedOpenTabs: false,
        };
      }

      const restoreOriginalWindows = mode === 'original-windows';

      if (restoreOriginalWindows && Array.isArray(plan.windowGroups) && plan.windowGroups.length > 0 && typeof createTabsInWindow === 'function') {
        for (const windowGroup of plan.windowGroups) {
          const urls = (windowGroup.tabs || []).map(tab => tab.url).filter(Boolean);
          if (urls.length === 0) continue;
          await createTabsInWindow(urls, {
            active: false,
            windowOptions: windowGroup.window || {},
          });
        }
      } else {
        for (const tab of plan.toOpen) {
          await createTab(tab.url, { active: false });
        }
        return {
          opened: plan.toOpen.length,
          skipped: plan.skipped.length,
          changedOpenTabs: true,
        };
      }

      for (const tab of Array.isArray(plan.ungroupedTabs) ? plan.ungroupedTabs : []) {
        await createTab(tab.url, { active: false });
      }

      return {
        opened: plan.toOpen.length,
        skipped: plan.skipped.length,
        changedOpenTabs: true,
      };
    }

    async function restoreImportedSessionTab(groupId, tabId) {
      const found = getImportedSessionTab(groupId, tabId);
      if (!found) {
        return { opened: 0, skipped: 0, changedOpenTabs: false };
      }
      const { group, tab } = found;
      return restoreSessionGroups([{ ...group, tabs: [tab] }]);
    }

    function renderImportedSessionTabChip(tab, groupId, openUrlSet) {
      const viewModel = typeof buildImportedTabViewModel === 'function'
        ? buildImportedTabViewModel(tab, groupId, openUrlSet)
        : {
            groupId: groupId || '',
            isOpen: !!openUrlSet.has(tab.url),
            primaryActionLabel: openUrlSet.has(tab.url) ? t('action.open') : t('action.restore'),
            primaryActionTitle: openUrlSet.has(tab.url) ? t('action.open') : t('action.restore'),
            statusLabel: openUrlSet.has(tab.url) ? t('action.open') : '',
            tabId: tab.id || '',
            title: tab.title || tab.url || '',
            url: tab.url || '',
          };
      const safeTitle = escapeHtml(viewModel.title);
      const safeGroupId = escapeHtml(viewModel.groupId);
      const safeTabId = escapeHtml(viewModel.tabId);
      const safeUrl = escapeHtml(viewModel.url);
      let domain = '';
      try { domain = new URL(viewModel.url).hostname; } catch {}

      const statusBadge = viewModel.statusLabel
        ? `<span class="chip-inline-status chip-open-status" data-tooltip="${t('action.alreadyOpen')}" aria-label="${t('action.alreadyOpen')}">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75 11.25 15 15 9.75" /><path stroke-linecap="round" stroke-linejoin="round" d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>
          </span>`
        : '';

      return `<div class="page-chip clickable tab-title-tooltip" data-action="restore-imported-tab" data-imported-group-id="${safeGroupId}" data-imported-tab-id="${safeTabId}" data-tab-url="${safeUrl}" data-tooltip="${safeTitle}" aria-label="${safeTitle}">
          ${buildFaviconImg(domain)}
          <span class="chip-text">${safeTitle}</span>
          ${statusBadge}
          <div class="chip-actions">
            <button class="chip-action chip-close" data-action="clear-imported-tab" data-imported-group-id="${safeGroupId}" data-imported-tab-id="${safeTabId}" data-tooltip="${t('action.clear')}" aria-label="${t('action.clear')}">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
            </button>
          </div>
        </div>`;
    }

    function renderImportedSessionCard(group, openUrlSet) {
      const groupId = escapeHtml(group.id || group.domain || '');
      const viewModel = typeof buildImportedGroupViewModel === 'function'
        ? buildImportedGroupViewModel(group, openUrlSet)
        : {
            allOpen: false,
            hiddenTabs: (group.tabs || []).slice(8),
            openedCount: 0,
            tabCount: Array.isArray(group.tabs) ? group.tabs.length : 0,
            visibleTabs: (group.tabs || []).slice(0, 8),
          };
      const extraCount = viewModel.hiddenTabs.length;
      const statusBadge = viewModel.openedCount > 0
        ? `<span class="open-tabs-badge imported-status-badge">${t('badge.importedOpened', { count: viewModel.openedCount })}</span>`
        : '';

      const visibleChips = viewModel.visibleTabs
        .map(tab => renderImportedSessionTabChip(tab, group.id || group.domain || '', openUrlSet))
        .join('');
      const hiddenChips = viewModel.hiddenTabs
        .map(tab => renderImportedSessionTabChip(tab, group.id || group.domain || '', openUrlSet))
        .join('');
      const pageChips = visibleChips + (extraCount > 0 ? `
        <div class="page-chips-overflow">${hiddenChips}</div>
        <div class="page-chip page-chip-overflow clickable" data-action="expand-chips">
          <span class="chip-text">+${extraCount} more</span>
        </div>` : '');

      return `
        <div class="mission-card domain-card has-active-bar" data-imported-group-id="${groupId}">
          <div class="status-bar"></div>
          <div class="mission-content">
            <div class="mission-top">
              <span class="mission-name">${escapeHtml(group.label || friendlyDomain(group.domain))}</span>
              <span class="open-tabs-badge"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M3 8.25V18a2.25 2.25 0 0 0 2.25 2.25h13.5A2.25 2.25 0 0 0 21 18V8.25m-18 0V6a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 6v2.25m-18 0h18" /></svg>${viewModel.tabCount} ${countLabel('common.tab', viewModel.tabCount)}</span>
              ${statusBadge}
            </div>
            <div class="mission-pages">${pageChips}</div>
            <div class="actions">
              <button class="action-btn save-tabs" data-action="restore-imported-group" data-imported-group-id="${groupId}">${t('action.restoreHere')}</button>
              <button class="action-btn" data-action="restore-imported-group-original" data-imported-group-id="${groupId}">${t('action.restoreOriginalWindowSingle')}</button>
              <button class="action-btn danger" data-action="clear-imported-group" data-imported-group-id="${groupId}">${t('action.clear')}</button>
            </div>
          </div>
            <div class="mission-meta">
            <div class="mission-page-count">${viewModel.tabCount}</div>
            <div class="mission-page-label">${countLabel('common.tab', viewModel.tabCount)}</div>
          </div>
        </div>`;
    }

    function renderImportedSessionSection() {
      const section = document.getElementById('importedSessionSection');
      const countEl = document.getElementById('importedSessionCount');
      const metaEl = document.getElementById('importedSessionMeta');
      const missionsEl = document.getElementById('importedSessionMissions');

      if (!section || !countEl || !metaEl || !missionsEl) return;

      const { importedSession } = getState();
      if (!importedSession || !Array.isArray(importedSession.groups) || importedSession.groups.length === 0) {
        section.style.display = 'none';
        missionsEl.innerHTML = '';
        return;
      }

      const groupCount = importedSession.groups.length;
      const tabCount = importedSession.groups.reduce((sum, group) => sum + ((group.tabs || []).length), 0);
      const exportedAt = formatSessionDate(importedSession.exportedAt);
      const openUrlSet = new Set(getRealTabs().map(tab => tab.url));

      countEl.textContent = `${groupCount} ${countLabel('common.group', groupCount)} · ${tabCount} ${countLabel('common.tab', tabCount)}`;
      metaEl.textContent = exportedAt ? t('status.importedFromFileExported', { date: exportedAt }) : t('status.importedFromFile');
      missionsEl.innerHTML = importedSession.groups.map(group => renderImportedSessionCard(group, openUrlSet)).join('');
      section.style.display = 'block';
    }

    async function handleExportImportedSession() {
      const { importedSession } = getState();
      if (!importedSession || !Array.isArray(importedSession.groups) || importedSession.groups.length === 0) return;
      const exportGroups = typeof dedupeSessionGroups === 'function'
        ? dedupeSessionGroups(importedSession.groups)
        : importedSession.groups;
      const payload = createSessionExport(exportGroups, {
        exportedAt: importedSession.exportedAt,
      });
      downloadJsonFile(buildSessionFilename('imported-session'), payload);
      showToast(t('toast.exportedImportedGroups', {
        count: payload.groups.length,
        groupLabel: countLabel('common.group', payload.groups.length),
      }));
    }

    async function refreshImportedSessionViews(message) {
      renderImportedSessionSection();
      if (typeof syncImportedSessionSearchResults === 'function') {
        await syncImportedSessionSearchResults();
      }
      if (message) {
        showToast(message);
      }
    }

    async function handleImportSessionFiles(files) {
      const safeFiles = Array.isArray(files) ? files : [];
      if (safeFiles.length === 0) return 0;
      if (typeof parseImportedSession !== 'function') {
        throw new Error('Imported session parser is unavailable');
      }

      let nextImportedSession = getState().importedSession;
      let importedGroupCount = 0;

      for (const file of safeFiles) {
        const text = await file.text();
        const parsed = parseImportedSession(text);
        nextImportedSession = mergeImportedSessions(nextImportedSession, parsed);
        importedGroupCount += parsed.groups.length;
      }

      await setImportedSession(nextImportedSession);
      await refreshImportedSessionViews(t('toast.importedGroups', {
        count: importedGroupCount,
        groupLabel: countLabel('common.group', importedGroupCount),
      }));
      return importedGroupCount;
    }

    async function handleRestoreImportedSession() {
      const { importedSession } = getState();
      if (!importedSession) return;
      const result = await restoreSessionGroups(importedSession.groups);
      showToast(t('toast.restoredSkipped', {
        opened: result.opened,
        skipped: result.skipped,
        tabLabel: countLabel('common.tab', result.opened),
      }));
      return result;
    }

    async function handleRestoreImportedSessionOriginalWindows() {
      const { importedSession } = getState();
      if (!importedSession) return;
      const result = await restoreSessionGroups(importedSession.groups, { mode: 'original-windows' });
      showToast(t('toast.restoredSkipped', {
        opened: result.opened,
        skipped: result.skipped,
        tabLabel: countLabel('common.tab', result.opened),
      }));
      return result;
    }

    async function handleRestoreImportedGroup(groupId) {
      const group = getImportedGroupById(groupId);
      if (!group) return null;
      const result = await restoreSessionGroups([group]);
      showToast(t('toast.restoredSkipped', {
        opened: result.opened,
        skipped: result.skipped,
        tabLabel: countLabel('common.tab', result.opened),
      }));
      return result;
    }

    async function handleRestoreImportedGroupOriginalWindow(groupId) {
      const group = getImportedGroupById(groupId);
      if (!group) return null;
      const result = await restoreSessionGroups([group], { mode: 'original-windows' });
      showToast(t('toast.restoredSkipped', {
        opened: result.opened,
        skipped: result.skipped,
        tabLabel: countLabel('common.tab', result.opened),
      }));
      return result;
    }

    async function handleRestoreImportedTab(groupId, tabId, tabUrl) {
      const found = getImportedSessionTab(groupId, tabId);
      if (!found) return null;
      if (tabUrl && await focusExactTabByUrl(tabUrl)) {
        showToast(t('toast.openedExisting'));
        return {
          opened: 0,
          skipped: 1,
          changedOpenTabs: false,
          focusedExistingTab: true,
        };
      }
      const result = await restoreImportedSessionTab(groupId, tabId);
      showToast(result.opened > 0
        ? t('toast.restoredSkipped', {
            opened: result.opened,
            skipped: result.skipped,
            tabLabel: countLabel('common.tab', result.opened),
          })
        : t('toast.tabAlreadyOpen'));
      return result;
    }

    async function handleClearImportedSession() {
      await clearImportedSession();
      await refreshImportedSessionViews(t('toast.importedSessionCleared'));
    }

    async function handleClearImportedGroup(groupId) {
      if (!groupId) return;
      await clearImportedSessionGroup(groupId);
      await refreshImportedSessionViews(t('toast.importedGroupCleared'));
    }

    async function handleClearImportedTab(groupId, tabId) {
      if (!groupId || !tabId) return false;
      const changed = await clearImportedSessionTab(groupId, tabId);
      if (!changed) return false;
      await refreshImportedSessionViews(t('toast.importedTabCleared'));
      return true;
    }

    return {
      clearImportedSession,
      clearImportedSessionGroup,
      clearImportedSessionTab,
      handleClearImportedSession,
      handleClearImportedGroup,
      handleClearImportedTab,
      handleExportImportedSession,
      handleImportSessionFiles,
      handleRestoreImportedGroup,
      handleRestoreImportedGroupOriginalWindow,
      handleRestoreImportedSession,
      handleRestoreImportedSessionOriginalWindows,
      handleRestoreImportedTab,
      getImportedGroupById,
      getImportedSession,
      getImportedSessionTab,
      renderImportedSessionSection,
      restoreImportedSessionTab,
      restoreSessionGroups,
      setImportedSession,
    };
  }

  window.TabOutImportedSessionController = {
    createImportedSessionController,
  };
})();
