'use strict';

(function initDashboardCardRenderer() {
  const ICONS = {
    tabs: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M3 8.25V18a2.25 2.25 0 0 0 2.25 2.25h13.5A2.25 2.25 0 0 0 21 18V8.25m-18 0V6a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 6v2.25m-18 0h18" /></svg>`,
    close: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>`,
    dedupe: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M8.25 7.5h10.5m-10.5 4.5h10.5m-10.5 4.5h10.5M4.5 7.5h.008v.008H4.5V7.5Zm0 4.5h.008v.008H4.5V12Zm0 4.5h.008v.008H4.5V16.5Z" /></svg>`,
    export: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M12 3v12m0 0 4.5-4.5M12 15l-4.5-4.5M4.5 19.5h15" /></svg>`,
    move: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M3.75 5.25h8.25a2.25 2.25 0 0 1 2.25 2.25v1.5m-10.5-3.75v11.25a2.25 2.25 0 0 0 2.25 2.25h8.25m-10.5-13.5h14.25a2.25 2.25 0 0 1 2.25 2.25v9a2.25 2.25 0 0 1-2.25 2.25h-4.5m-5.25-6h11.25m0 0-3-3m3 3-3 3" /></svg>`,
  };

  function createDashboardCardRenderer({
    buildFaviconImg,
    cleanTitle,
    escapeHtml,
    friendlyDomain,
    getDomainGroupActionId,
    shortTimeAgo,
    smartTitle,
    stripTitleNoise,
    t = key => key,
    countLabel = (_key, count) => (Number(count) === 1 ? 'tab' : 'tabs'),
  }) {
    function buildTabChip(tab, {
      currentWindowId = null,
      groupDomain = '',
      tabMovingEnabled = false,
      urlCounts = {},
    } = {}) {
      let label = cleanTitle(
        smartTitle(stripTitleNoise(tab.title || ''), tab.url),
        groupDomain
      );

      try {
        const parsed = new URL(tab.url);
        if (parsed.hostname === 'localhost' && parsed.port) {
          label = `${parsed.port} ${label}`;
        }
      } catch {}

      const count = urlCounts[tab.url] || 1;
      const dupeTag = count > 1 ? ` <span class="chip-dupe-badge">(${count}x)</span>` : '';
      const chipClass = count > 1 ? ' chip-has-dupes' : '';
      const closeAction = count > 1 ? 'close-tab-url-dupes' : 'close-single-tab';
      const closeTitle = count > 1 ? t('action.closeAllTabs', { count, tabLabel: countLabel('common.tab', count) }) : t('action.closeThisTab');
      const ageTag = shortTimeAgo(tab.lastAccessed);
      const safeUrl = escapeHtml(tab.url || '');
      const safeTitle = escapeHtml(label);
      const safeTabId = escapeHtml(tab.id || '');
      const isCurrentWindow = (
        tabMovingEnabled &&
        currentWindowId !== null &&
        typeof tab.windowId !== 'undefined' &&
        Number(tab.windowId) === Number(currentWindowId)
      );
      const moveControl = tabMovingEnabled
        ? (
            isCurrentWindow
              ? `<span class="chip-inline-status chip-here-status" data-tooltip="${t('action.alreadyHere')}" aria-label="${t('action.alreadyHere')}">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M3.75 5.25h16.5v10.5H3.75z" /><path stroke-linecap="round" stroke-linejoin="round" d="m8.25 18.75 2.25 2.25 5.25-5.25" /></svg>
                </span>`
              : `<button class="chip-action chip-move" data-action="move-tab-here" data-tab-id="${safeTabId}" data-tooltip="${t('action.moveToThisWindow')}" aria-label="${t('action.moveToThisWindow')}">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M3.75 5.25h8.25a2.25 2.25 0 0 1 2.25 2.25v1.5m-10.5-3.75v11.25a2.25 2.25 0 0 0 2.25 2.25h8.25m-10.5-13.5h14.25a2.25 2.25 0 0 1 2.25 2.25v9a2.25 2.25 0 0 1-2.25 2.25h-4.5m-5.25-6h11.25m0 0-3-3m3 3-3 3" /></svg>
                </button>`
          )
        : '';
      let domain = '';
      try {
        domain = new URL(tab.url).hostname;
      } catch {}

      return `<div class="page-chip clickable tab-title-tooltip${chipClass}" data-action="focus-tab" data-tab-url="${safeUrl}" data-tooltip="${safeTitle}" aria-label="${safeTitle}">
      ${buildFaviconImg(domain, 'chip-favicon', tab.url, tab.favIconUrl)}
      <span class="chip-text">${escapeHtml(label)}</span>${dupeTag}
      ${ageTag ? `<span class="chip-age">${ageTag}</span>` : ''}
      <div class="chip-actions">
        ${moveControl}
        <button class="chip-action chip-save" data-action="defer-single-tab" data-tab-url="${safeUrl}" data-tab-title="${safeTitle}" data-tooltip="${t('action.saveForLater')}" aria-label="${t('action.saveForLater')}">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z" /></svg>
        </button>
        <button class="chip-action chip-close" data-action="${closeAction}" data-tab-url="${safeUrl}" data-tooltip="${closeTitle}" aria-label="${closeTitle}">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
        </button>
      </div>
    </div>`;
    }

    function renderOpenTabsSectionCount(domainCount, realTabCount, totalDuplicateTabs = 0, options = {}) {
      const {
        movableTabCount = 0,
        tabMovingEnabled = false,
      } = options;
      const domainLabel = `${domainCount} domain${domainCount !== 1 ? 's' : ''}`;
      const closeAllDupesButton = totalDuplicateTabs > 0
        ? `&nbsp;&middot;&nbsp; <button class="action-btn dupe-tabs compact" data-action="close-all-dupes">${ICONS.dedupe} ${t('action.closeAllDupes', { count: totalDuplicateTabs, dupeLabel: countLabel('common.dupe', totalDuplicateTabs) })}</button>`
        : '';
      const moveAllButton = tabMovingEnabled && movableTabCount > 0
        ? `&nbsp;&middot;&nbsp; <button class="action-btn save-tabs compact" data-action="move-all-tabs-here">${ICONS.move} ${t('action.moveAllHere')}</button>`
        : '';
      return `${escapeHtml(domainLabel)}${moveAllButton}${closeAllDupesButton} &nbsp;&middot;&nbsp; <button class="action-btn close-tabs compact" data-action="close-all-open-tabs">${ICONS.close} ${t('action.closeAllTabs', { count: realTabCount, tabLabel: countLabel('common.tab', realTabCount) })}</button>`;
    }

    function buildOverflowChips(hiddenTabs, urlCounts = {}, options = {}) {
      const hiddenChips = hiddenTabs.map(tab => buildTabChip(tab, { ...options, urlCounts })).join('');

      return `
    <div class="page-chips-overflow">${hiddenChips}</div>
    <div class="page-chip page-chip-overflow clickable" data-action="expand-chips">
      <span class="chip-text">+${hiddenTabs.length} more</span>
    </div>`;
    }

    function renderDomainCard(group, options = {}) {
      const {
        currentWindowId = null,
        tabMovingEnabled = false,
      } = options;
      const tabs = group.tabs || [];
      const tabCount = tabs.length;
      const isLanding = group.domain === '__landing-pages__';
      const stableId = getDomainGroupActionId(group);
      const movableTabIds = tabs
        .filter(tab => (
          tabMovingEnabled &&
          typeof tab.id !== 'undefined' &&
          typeof tab.windowId !== 'undefined' &&
          currentWindowId !== null &&
          Number(tab.windowId) !== Number(currentWindowId)
        ))
        .map(tab => tab.id);

      const urlCounts = {};
      for (const tab of tabs) {
        urlCounts[tab.url] = (urlCounts[tab.url] || 0) + 1;
      }
      const dupeUrls = Object.entries(urlCounts).filter(([, count]) => count > 1);
      const hasDupes = dupeUrls.length > 0;
      const totalExtras = dupeUrls.reduce((sum, [, count]) => sum + count - 1, 0);

      const tabBadge = `<span class="open-tabs-badge">
    ${ICONS.tabs}
        ${t('badge.tabsOpen', { count: tabCount, tabLabel: countLabel('common.tab', tabCount) })}
  </span>`;

      const dupeBadge = hasDupes
        ? `<span class="open-tabs-badge dupe-badge">
        ${t('badge.duplicate', { count: totalExtras, duplicateLabel: countLabel('common.duplicate', totalExtras) })}
      </span>`
        : '';

      const seen = new Set();
      const uniqueTabs = [];
      for (const tab of tabs) {
        if (!seen.has(tab.url)) {
          seen.add(tab.url);
          uniqueTabs.push(tab);
        }
      }

      const visibleTabs = uniqueTabs.slice(0, 8);
      const extraCount = uniqueTabs.length - visibleTabs.length;
      const pageChips = visibleTabs
        .map(tab => buildTabChip(tab, { currentWindowId, groupDomain: group.domain, tabMovingEnabled, urlCounts }))
        .join('') + (extraCount > 0 ? buildOverflowChips(uniqueTabs.slice(8), urlCounts, { currentWindowId, groupDomain: group.domain, tabMovingEnabled }) : '');

      let actionsHtml = `
    <button class="action-btn" data-action="export-domain-group" data-domain-id="${stableId}">
      ${ICONS.export}
      ${t('action.export')}
    </button>
    <button class="action-btn close-tabs" data-action="close-domain-tabs" data-domain-id="${stableId}">
      ${ICONS.close}
      ${t('action.closeAllTabs', { count: tabCount, tabLabel: countLabel('common.tab', tabCount) })}
    </button>`;

      if (hasDupes) {
        const dupeUrlsEncoded = dupeUrls.map(([url]) => encodeURIComponent(url)).join(',');
        actionsHtml += `
      <button class="action-btn dupe-tabs" data-action="dedup-keep-one" data-dupe-urls="${dupeUrlsEncoded}">
        ${ICONS.dedupe}
        ${t('action.closeDupes', { count: totalExtras, dupeLabel: countLabel('common.dupe', totalExtras) })}
      </button>`;
      }

      if (tabMovingEnabled && movableTabIds.length > 0) {
        actionsHtml += `
      <button class="action-btn save-tabs" data-action="move-domain-tabs-here" data-domain-id="${stableId}">
        ${ICONS.move}
        ${t('action.moveGroupHere')}
      </button>`;
      }

      return `
    <div class="mission-card domain-card has-neutral-bar" data-domain-id="${stableId}">
      <div class="status-bar"></div>
      <div class="mission-content">
        <div class="mission-top">
          <span class="mission-name">${escapeHtml(isLanding ? 'Homepages' : (group.label || friendlyDomain(group.domain)))}</span>
          ${tabBadge}
          ${dupeBadge}
        </div>
        <div class="mission-pages">${pageChips}</div>
        <div class="actions">${actionsHtml}</div>
      </div>
      <div class="mission-meta">
        <div class="mission-page-count">${tabCount}</div>
        <div class="mission-page-label">tabs</div>
      </div>
    </div>`;
    }

    return {
      buildOverflowChips,
      renderDomainCard,
      renderOpenTabsSectionCount,
    };
  }

  const dashboardCardRenderer = {
    createDashboardCardRenderer,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = dashboardCardRenderer;
  }

  if (typeof window !== 'undefined') {
    window.TabOutDashboardCardRenderer = dashboardCardRenderer;
  }
})();
