'use strict';

(function initDashboardCardRenderer() {
  const ICONS = {
    tabs: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M3 8.25V18a2.25 2.25 0 0 0 2.25 2.25h13.5A2.25 2.25 0 0 0 21 18V8.25m-18 0V6a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 6v2.25m-18 0h18" /></svg>`,
    close: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>`,
  };

  function createDashboardCardRenderer({
    buildFaviconImg,
    cleanTitle,
    escapeHtml,
    friendlyDomain,
    shortTimeAgo,
    smartTitle,
    stripTitleNoise,
  }) {
    function buildTabChip(tab, { groupDomain = '', urlCounts = {} } = {}) {
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
      const closeTitle = count > 1 ? `Close all ${count} duplicate tabs` : 'Close this tab';
      const ageTag = shortTimeAgo(tab.lastAccessed);
      const safeUrl = escapeHtml(tab.url || '');
      const safeTitle = escapeHtml(label);
      let domain = '';
      try {
        domain = new URL(tab.url).hostname;
      } catch {}

      return `<div class="page-chip clickable${chipClass}" data-action="focus-tab" data-tab-url="${safeUrl}" title="${safeTitle}">
      ${buildFaviconImg(domain, 'chip-favicon', tab.favIconUrl)}
      <span class="chip-text">${escapeHtml(label)}</span>${dupeTag}
      ${ageTag ? `<span class="chip-age">${ageTag}</span>` : ''}
      <div class="chip-actions">
        <button class="chip-action chip-save" data-action="defer-single-tab" data-tab-url="${safeUrl}" data-tab-title="${safeTitle}" title="Save for later">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z" /></svg>
        </button>
        <button class="chip-action chip-close" data-action="${closeAction}" data-tab-url="${safeUrl}" title="${closeTitle}">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
        </button>
      </div>
    </div>`;
    }

    function renderOpenTabsSectionCount(domainCount, realTabCount, totalDuplicateTabs = 0) {
      const domainLabel = `${domainCount} domain${domainCount !== 1 ? 's' : ''}`;
      const closeAllDupesButton = totalDuplicateTabs > 0
        ? `&nbsp;&middot;&nbsp; <button class="action-btn compact" data-action="close-all-dupes">Close all ${totalDuplicateTabs} dupe${totalDuplicateTabs !== 1 ? 's' : ''}</button>`
        : '';
      return `${escapeHtml(domainLabel)}${closeAllDupesButton} &nbsp;&middot;&nbsp; <button class="action-btn close-tabs compact" data-action="close-all-open-tabs">${ICONS.close} Close all ${realTabCount} tabs</button>`;
    }

    function buildOverflowChips(hiddenTabs, urlCounts = {}) {
      const hiddenChips = hiddenTabs.map(tab => buildTabChip(tab, { urlCounts })).join('');

      return `
    <div class="page-chips-overflow">${hiddenChips}</div>
    <div class="page-chip page-chip-overflow clickable" data-action="expand-chips">
      <span class="chip-text">+${hiddenTabs.length} more</span>
    </div>`;
    }

    function renderDomainCard(group) {
      const tabs = group.tabs || [];
      const tabCount = tabs.length;
      const isLanding = group.domain === '__landing-pages__';
      const stableId = 'domain-' + group.domain.replace(/[^a-z0-9]/g, '-');

      const urlCounts = {};
      for (const tab of tabs) {
        urlCounts[tab.url] = (urlCounts[tab.url] || 0) + 1;
      }
      const dupeUrls = Object.entries(urlCounts).filter(([, count]) => count > 1);
      const hasDupes = dupeUrls.length > 0;
      const totalExtras = dupeUrls.reduce((sum, [, count]) => sum + count - 1, 0);

      const tabBadge = `<span class="open-tabs-badge">
    ${ICONS.tabs}
    ${tabCount} tab${tabCount !== 1 ? 's' : ''} open
  </span>`;

      const dupeBadge = hasDupes
        ? `<span class="open-tabs-badge dupe-badge">
        ${totalExtras} duplicate${totalExtras !== 1 ? 's' : ''}
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
        .map(tab => buildTabChip(tab, { groupDomain: group.domain, urlCounts }))
        .join('') + (extraCount > 0 ? buildOverflowChips(uniqueTabs.slice(8), urlCounts) : '');

      let actionsHtml = `
    <button class="action-btn" data-action="export-domain-group" data-domain-id="${stableId}">
      Export
    </button>
    <button class="action-btn close-tabs" data-action="close-domain-tabs" data-domain-id="${stableId}">
      ${ICONS.close}
      Close all ${tabCount} tab${tabCount !== 1 ? 's' : ''}
    </button>`;

      if (hasDupes) {
        const dupeUrlsEncoded = dupeUrls.map(([url]) => encodeURIComponent(url)).join(',');
        actionsHtml += `
      <button class="action-btn" data-action="dedup-keep-one" data-dupe-urls="${dupeUrlsEncoded}">
        Close ${totalExtras} dupe${totalExtras !== 1 ? 's' : ''}
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
