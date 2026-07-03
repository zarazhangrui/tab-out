'use strict';

(function initDashboardSearchRenderer() {
  function createDashboardSearchRenderer({
    buildFaviconImg,
    buildSearchResultsModel,
    checkTabOutDupes,
    escapeHtml,
    friendlyDomain,
    getImportedSession,
    getRealTabs,
    getSavedTabs,
    getState,
    normalizeSearchText,
    searchImportedSessionTabs,
    searchTextMatches,
  }) {
    function buildSearchResultItem(item) {
      const safeId = escapeHtml(item.id || '');
      const safeTabId = escapeHtml(item.tabId || '');
      const safeGroupId = escapeHtml(item.groupId || '');
      const safeUrl = escapeHtml(item.url || '');
      const safeTitle = escapeHtml(item.title || item.url || '');
      const safeSourceLabel = escapeHtml(item.sourceLabel || '');
      const safeDisplayTitle = escapeHtml(item.title || item.url || '');
      const safeGroupLabel = escapeHtml(item.groupLabel || '');
      const sourceBadgeClass = item.source === 'imported' ? ' imported' : item.source === 'later' ? ' later' : '';
      let domain = '';
      try { domain = new URL(item.url).hostname.replace(/^www\./, ''); } catch {}
      const safeDomain = escapeHtml(domain || item.groupLabel || 'Unknown source');
      const faviconHtml = buildFaviconImg(
        domain,
        'chip-favicon',
        item.source === 'open' ? item.favIconUrl : ''
      );

      let actions = '';
      if (item.source === 'open') {
        actions = `
          <button class="action-btn" data-action="focus-tab" data-tab-id="${safeTabId}" data-tab-url="${safeUrl}">Focus</button>
          <button class="action-btn close-tabs" data-action="close-single-tab" data-tab-id="${safeTabId}" data-tab-url="${safeUrl}">Close</button>
          <button class="action-btn save-tabs" data-action="defer-single-tab" data-tab-id="${safeTabId}" data-tab-url="${safeUrl}" data-tab-title="${safeTitle}">Later</button>
        `;
      } else if (item.source === 'imported') {
        const primaryLabel = item.isOpen ? 'Open' : 'Restore';
        actions = `
          <button class="action-btn save-tabs" data-action="restore-imported-tab" data-imported-group-id="${safeGroupId}" data-imported-tab-id="${safeTabId}" data-tab-url="${safeUrl}">${primaryLabel}</button>
          <button class="action-btn danger" data-action="clear-imported-tab" data-imported-group-id="${safeGroupId}" data-imported-tab-id="${safeTabId}">Clear</button>
        `;
      } else {
        actions = item.isArchived
          ? `
            <button class="action-btn" data-action="open-later-item" data-later-url="${safeUrl}">Open</button>
            <button class="action-btn danger" data-action="dismiss-later" data-later-id="${safeId}">Remove</button>
          `
          : `
            <button class="action-btn" data-action="open-later-item" data-later-url="${safeUrl}">Open</button>
            <button class="action-btn save-tabs" data-action="check-later" data-later-id="${safeId}">Done</button>
            <button class="action-btn danger" data-action="dismiss-later" data-later-id="${safeId}">Remove</button>
          `;
      }

      return `
        <div class="search-card">
          <div class="search-card-header">
            <div class="search-card-title">${faviconHtml}${safeDisplayTitle}</div>
            <span class="search-source-badge${sourceBadgeClass}">${safeSourceLabel}</span>
          </div>
          <div class="search-card-meta">
            <span>${safeDomain}</span>
            ${item.groupLabel ? `<span>${safeGroupLabel}</span>` : ''}
            ${item.url ? `<span>${safeUrl}</span>` : ''}
          </div>
          <div class="search-card-actions">${actions}</div>
        </div>`;
    }

    async function renderSearchResults({
      globalSearchQuery = '',
      isStale = () => false,
    } = {}) {
      const searchSection = document.getElementById('searchSection');
      const searchCount = document.getElementById('searchCount');
      const searchResults = document.getElementById('searchResults');
      const openTabsSection = document.getElementById('openTabsSection');
      const importedSessionSection = document.getElementById('importedSessionSection');
      const laterColumn = document.getElementById('laterColumn');
      const tabOutDupeBanner = document.getElementById('tabOutDupeBanner');

      if (!searchSection || !searchCount || !searchResults) return false;

      const query = normalizeSearchText(globalSearchQuery);
      if (!query) {
        searchSection.style.display = 'none';
        if (openTabsSection) openTabsSection.style.display = getState().domainGroups.length > 0 ? 'block' : 'none';
        if (laterColumn) {
          const { active, archived } = await getSavedTabs();
          laterColumn.style.display = active.length === 0 && archived.length === 0 ? 'none' : 'block';
        }
        if (importedSessionSection) {
          const importedSession = getState().importedSession;
          if (importedSession && Array.isArray(importedSession.groups) && importedSession.groups.length > 0) {
            importedSessionSection.style.display = 'block';
          }
        }
        if (tabOutDupeBanner) checkTabOutDupes();
        return false;
      }

      const { active: laterActive, archived: laterArchived } = await getSavedTabs();
      if (isStale()) return false;
      const results = typeof buildSearchResultsModel === 'function'
        ? buildSearchResultsModel({
            friendlyDomain,
            importedSession: getState().importedSession,
            laterActive,
            laterArchived,
            openTabs: getRealTabs(),
            query,
            searchImportedSessionTabs,
            searchTextMatches,
          })
        : [];

      if (openTabsSection) openTabsSection.style.display = 'none';
      if (importedSessionSection) importedSessionSection.style.display = 'none';
      if (laterColumn) laterColumn.style.display = 'none';
      if (tabOutDupeBanner) tabOutDupeBanner.style.display = 'none';

      searchCount.textContent = `${results.length} result${results.length !== 1 ? 's' : ''}`;
      searchResults.innerHTML = results.length > 0
        ? results.map(buildSearchResultItem).join('')
        : '<div class="search-empty">No matching tabs across open tabs, imported session, or later list.</div>';
      if (isStale()) return false;
      searchSection.style.display = 'block';
      return true;
    }

    return {
      buildSearchResultItem,
      renderSearchResults,
    };
  }

  const dashboardSearchRenderer = {
    createDashboardSearchRenderer,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = dashboardSearchRenderer;
  }

  if (typeof window !== 'undefined') {
    window.TabOutDashboardSearchRenderer = dashboardSearchRenderer;
  }
})();
