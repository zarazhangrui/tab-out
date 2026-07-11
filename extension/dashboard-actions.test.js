'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createDashboardActions,
} = require('./dashboard-actions.js');
const {
  createTestI18n,
} = require('./test-i18n-helper.js');

function createHarness(overrides = {}) {
  const i18n = createTestI18n();
  let moreMenuOpen = overrides.moreMenuOpen || false;
  const querySelectorAllMap = overrides.querySelectorAllMap || {};
  const querySelectorMap = overrides.querySelectorMap || {};
  const calls = {
    animateCardOut: [],
    checkOffSavedTab: [],
    checkTabOutDupes: 0,
    closeDuplicateTabs: [],
    closeMoreMenu: 0,
    closeOpenTab: [],
    closeTabOutDupes: 0,
    closeTabsByUrls: [],
    closeTabsExact: [],
    createTab: [],
    dismissSavedTab: [],
    downloadJsonFile: [],
    focusExactTabByUrl: [],
    focusMoreMenuItem: [],
    focusTab: [],
    focusTabById: [],
    moveTabsToCurrentWindow: [],
    playCloseSound: 0,
    removeKnownTabsFromState: [],
    removeOpenTabOptimistically: [],
    removeOpenTabsOptimistically: [],
    renderAutoRefreshToggle: 0,
    renderImportedSessionSection: 0,
    renderLaterListColumn: 0,
    renderLanguageToggle: 0,
    renderMoreMenu: 0,
    renderStaticText: 0,
    renderTabMovingToggle: 0,
    renderThemeToggle: 0,
    reconcileOpenTabsFromBrowser: 0,
    saveTabForLater: [],
    scheduleDashboardAndWait: 0,
    scheduleSearchAndWait: 0,
    setAutoRefreshSetting: [],
    setLanguagePreferenceSetting: [],
    setTabMovingSetting: [],
    setThemePreferenceSetting: [],
    showToast: [],
    suppressRemovedTabRefresh: [],
    shootConfetti: [],
  };

  const importedSessionController = {
    async handleExportImportedSession() { return 'exported'; },
    async handleClearImportedSession() { return 'cleared'; },
    async handleRestoreImportedSession() { return overrides.restoreImportedSessionResult || null; },
    async handleRestoreImportedGroup() { return overrides.restoreImportedGroupResult || null; },
    async handleRestoreImportedTab() { return overrides.restoreImportedTabResult || null; },
    async handleClearImportedGroup(groupId) { return groupId; },
    async handleClearImportedTab(groupId, tabId) { return { groupId, tabId }; },
  };

  const laterListController = {
    async handleClearSavedTabsByState(input) { return input; },
  };

  const actions = createDashboardActions({
    animateCardOut: value => calls.animateCardOut.push(value),
    buildSessionFilename: scope => `file-${scope}.json`,
    checkOffSavedTab: async id => { calls.checkOffSavedTab.push(id); },
    checkTabOutDupes: () => { calls.checkTabOutDupes += 1; },
    closeDuplicateTabs: async (urls, keepOne) => {
      calls.closeDuplicateTabs.push({ urls, keepOne });
      return overrides.closeDuplicateTabsResult || { tabIds: [8, 9] };
    },
    closeMoreMenu: () => { calls.closeMoreMenu += 1; },
    closeOpenTab: async (tabId, tabUrl) => {
      calls.closeOpenTab.push({ tabId, tabUrl });
      return Object.prototype.hasOwnProperty.call(overrides, 'closeOpenTabResult')
        ? overrides.closeOpenTabResult
        : { closed: true, tabId: Number(tabId) || 1 };
    },
    closeTabOutDupes: async options => {
      calls.closeTabOutDupes += 1;
      if (options && typeof options.beforeRemove === 'function') {
        await options.beforeRemove(
          overrides.closeTabOutDupesBeforeRemoveIds ||
          (overrides.closeTabOutDupesResult && overrides.closeTabOutDupesResult.suppressRefreshForTabIds) ||
          []
        );
      }
      return overrides.closeTabOutDupesResult || { tabIds: [3, 4] };
    },
    closeTabsByUrls: async urls => { calls.closeTabsByUrls.push(urls); },
    closeTabsExact: async urls => {
      calls.closeTabsExact.push(urls);
      return overrides.closeTabsExactResult || { closedCount: urls.length, tabIds: [] };
    },
    createSessionExport: groups => ({ groups }),
    createTab: async (url, options) => { calls.createTab.push({ url, options }); },
    dismissSavedTab: async id => {
      calls.dismissSavedTab.push(id);
      return overrides.dismissSavedTabResult || { completed: false };
    },
    downloadJsonFile: (filename, payload) => { calls.downloadJsonFile.push({ filename, payload }); },
    focusExactTabByUrl: async url => {
      calls.focusExactTabByUrl.push(url);
      return overrides.focusExactTabByUrlResult || false;
    },
    focusMoreMenuItem: index => { calls.focusMoreMenuItem.push(index); },
    focusTab: async url => {
      calls.focusTab.push(url);
      return overrides.focusTabResult || false;
    },
    focusTabById: async tabId => {
      calls.focusTabById.push(tabId);
      return overrides.focusTabByIdResult || false;
    },
    friendlyDomain: value => `friendly:${value}`,
    getAutoRefreshEnabled: () => !!overrides.autoRefreshEnabled,
    getCurrentWindowId: () => overrides.currentWindowId || 1,
    getDashboardStateSnapshot: () => overrides.dashboardStateSnapshot || {
      tabMovingEnabled: !!overrides.tabMovingEnabled,
      domainGroups: [{ domain: 'docs.example.com' }],
      openTabs: [
        { id: 1, url: 'https://docs.example.com/guide' },
        { id: 2, url: 'https://docs.example.com/guide' },
      ],
    },
    getDomainGroupByStableId: () => overrides.domainGroup || null,
    getLanguagePreference: () => overrides.languagePreference || 'en',
    getMoreMenuOpen: () => moreMenuOpen,
    getNextLanguagePreference: i18n.getNextLanguage,
    getNextThemePreference: overrides.getNextThemePreference || (() => overrides.nextThemePreference || 'dark'),
    getTabUrl: tab => tab.url || '',
    getThemePreference: () => overrides.themePreference || 'system',
    hasActiveSearch: () => !!overrides.hasActiveSearch,
    importedSessionController,
    isRealTabUrl: url => /^https?:/.test(url),
    laterListController,
    moveTabsToCurrentWindow: async tabIds => {
      calls.moveTabsToCurrentWindow.push(tabIds);
      return overrides.moveTabsToCurrentWindowResult || {
        movedCount: Array.isArray(tabIds) ? tabIds.length : 0,
        skippedCount: 0,
        tabIds,
        windowId: overrides.currentWindowId || 1,
      };
    },
    playCloseSound: () => { calls.playCloseSound += 1; },
    removeKnownTabsFromState: input => { calls.removeKnownTabsFromState.push(input); },
    removeOpenTabOptimistically: async input => { calls.removeOpenTabOptimistically.push(input); },
    removeOpenTabsOptimistically: async input => { calls.removeOpenTabsOptimistically.push(input); },
    renderAutoRefreshToggle: () => { calls.renderAutoRefreshToggle += 1; },
    renderImportedSessionSection: () => { calls.renderImportedSessionSection += 1; },
    renderLaterListColumn: async () => { calls.renderLaterListColumn += 1; },
    renderLanguageToggle: () => { calls.renderLanguageToggle += 1; },
    renderMoreMenu: () => { calls.renderMoreMenu += 1; },
    renderStaticText: () => { calls.renderStaticText += 1; },
    renderTabMovingToggle: () => { calls.renderTabMovingToggle += 1; },
    renderThemeToggle: () => { calls.renderThemeToggle += 1; },
    reconcileOpenTabsFromBrowser: async () => { calls.reconcileOpenTabsFromBrowser += 1; },
    saveTabForLater: async input => {
      calls.saveTabForLater.push(input);
      if (overrides.saveTabForLaterError) throw overrides.saveTabForLaterError;
    },
    scheduleDashboardAndWait: async () => { calls.scheduleDashboardAndWait += 1; },
    scheduleSearchAndWait: async () => { calls.scheduleSearchAndWait += 1; },
    setAutoRefreshSetting: async value => { calls.setAutoRefreshSetting.push(value); },
    setLanguagePreferenceSetting: async value => { calls.setLanguagePreferenceSetting.push(value); },
    setTabMovingSetting: async value => { calls.setTabMovingSetting.push(value); },
    setMoreMenuOpen: value => {
      moreMenuOpen = value;
      return moreMenuOpen;
    },
    setThemePreferenceSetting: async value => { calls.setThemePreferenceSetting.push(value); },
    showToast: message => { calls.showToast.push(message); },
    suppressRemovedTabRefresh: tabIds => { calls.suppressRemovedTabRefresh.push(tabIds); },
    shootConfetti: (...args) => { calls.shootConfetti.push(args); },
    t: i18n.t,
  });

  return {
    actions,
    calls,
  };
}

function withFakeDocument(overrides, run) {
  const previousDocument = global.document;
  global.document = {
    querySelector(selector) {
      if (Object.prototype.hasOwnProperty.call(overrides, selector)) {
        return overrides[selector];
      }
      return null;
    },
    querySelectorAll(selector) {
      if (Object.prototype.hasOwnProperty.call(overrides, selector)) {
        return overrides[selector];
      }
      return [];
    },
  };

  return Promise.resolve()
    .then(run)
    .finally(() => {
      global.document = previousDocument;
    });
}

test('toggle-more-menu updates state, rerenders menu, and focuses first item when opening', async () => {
  const timeouts = [];
  const previousSetTimeout = global.setTimeout;
  global.setTimeout = fn => {
    timeouts.push(fn);
    return 1;
  };

  try {
    const { actions, calls } = createHarness({ moreMenuOpen: false });
    await actions['toggle-more-menu']();

    assert.equal(calls.renderMoreMenu, 1);
    assert.equal(timeouts.length, 1);
    timeouts[0]();
    assert.deepEqual(calls.focusMoreMenuItem, [0]);
  } finally {
    global.setTimeout = previousSetTimeout;
  }
});

test('toggle-theme stores next theme preference and updates menu state', async () => {
  const { actions, calls } = createHarness({
    nextThemePreference: 'dark',
    themePreference: 'system',
  });

  await actions['toggle-theme']();

  assert.deepEqual(calls.setThemePreferenceSetting, ['dark']);
  assert.equal(calls.renderThemeToggle, 1);
  assert.equal(calls.closeMoreMenu, 1);
  assert.deepEqual(calls.showToast, ['Dark theme enabled']);
});

test('move-tab-here moves one tab to current window and refreshes view', async () => {
  const { actions, calls } = createHarness({
    moveTabsToCurrentWindowResult: { movedCount: 1, skippedCount: 0, tabIds: [9], windowId: 1 },
  });

  await actions['move-tab-here']({
    actionEl: {
      dataset: { tabId: '9' },
    },
    event: { stopPropagation() {} },
  });

  assert.deepEqual(calls.moveTabsToCurrentWindow, [['9']]);
  assert.equal(calls.reconcileOpenTabsFromBrowser, 1);
  assert.deepEqual(calls.showToast, ['Moved 1 tab here']);
});

test('move-domain-tabs-here moves only group tabs outside current window', async () => {
  const { actions, calls } = createHarness({
    currentWindowId: 1,
    domainGroup: {
      domain: 'docs.example.com',
      tabs: [
        { id: 1, windowId: 1, url: 'https://docs.example.com/current' },
        { id: 2, windowId: 2, url: 'https://docs.example.com/remote' },
      ],
    },
    moveTabsToCurrentWindowResult: { movedCount: 1, skippedCount: 0, tabIds: [2], windowId: 1 },
  });

  await actions['move-domain-tabs-here']({
    actionEl: {
      dataset: { domainId: 'domain-docs-example-com' },
    },
  });

  assert.deepEqual(calls.moveTabsToCurrentWindow, [[2]]);
  assert.equal(calls.reconcileOpenTabsFromBrowser, 1);
  assert.deepEqual(calls.showToast, ['Moved 1 tab from friendly:docs.example.com here']);
});

test('move-all-tabs-here moves all tabs outside current window', async () => {
  const { actions, calls } = createHarness({
    currentWindowId: 1,
    dashboardStateSnapshot: {
      domainGroups: [],
      openTabs: [
        { id: 1, windowId: 1, url: 'https://docs.example.com/current' },
        { id: 2, windowId: 2, url: 'https://docs.example.com/remote' },
        { id: 3, windowId: 3, url: 'https://later.example.com/remote' },
      ],
    },
    moveTabsToCurrentWindowResult: { movedCount: 2, skippedCount: 0, tabIds: [2, 3], windowId: 1 },
  });

  await actions['move-all-tabs-here']();

  assert.deepEqual(calls.moveTabsToCurrentWindow, [[2, 3]]);
  assert.equal(calls.reconcileOpenTabsFromBrowser, 1);
  assert.deepEqual(calls.showToast, ['Moved 2 tabs here']);
});

test('close-tabout-dupes uses local state cleanup without full dashboard refresh', async () => {
  const { actions, calls } = createHarness({
    closeTabOutDupesResult: { closedCount: 2, tabIds: [11, 12], suppressRefreshForTabIds: [11, 12] },
  });

  await actions['close-tabout-dupes']();

  assert.equal(calls.closeTabOutDupes, 1);
  assert.equal(calls.playCloseSound, 1);
  assert.deepEqual(calls.suppressRemovedTabRefresh, [[11, 12]]);
  assert.deepEqual(calls.removeKnownTabsFromState, [{ tabIds: [11, 12], tabUrls: [] }]);
  assert.equal(calls.checkTabOutDupes, 1);
  assert.equal(calls.reconcileOpenTabsFromBrowser, 0);
  assert.equal(calls.scheduleDashboardAndWait, 0);
  assert.deepEqual(calls.showToast, ['Closed extra Tab Out tabs']);
});

test('close-tabout-dupes refreshes from source when no extra tab-out tabs remain', async () => {
  const { actions, calls } = createHarness({
    closeTabOutDupesResult: { closedCount: 0, tabIds: [], suppressRefreshForTabIds: [] },
  });

  await actions['close-tabout-dupes']();

  assert.equal(calls.closeTabOutDupes, 1);
  assert.deepEqual(calls.suppressRemovedTabRefresh, [[]]);
  assert.equal(calls.playCloseSound, 0);
  assert.deepEqual(calls.removeKnownTabsFromState, []);
  assert.equal(calls.checkTabOutDupes, 0);
  assert.equal(calls.reconcileOpenTabsFromBrowser, 0);
  assert.equal(calls.scheduleDashboardAndWait, 1);
  assert.deepEqual(calls.showToast, ['No extra Tab Out tabs to close']);
});

test('focus-tab shows stale-tab toast and reconciles when target is gone', async () => {
  const { actions, calls } = createHarness({
    focusTabByIdResult: false,
    focusExactTabByUrlResult: false,
  });

  await actions['focus-tab']({
    actionEl: {
      dataset: {
        tabId: '7',
        tabUrl: 'https://docs.example.com/guide',
      },
    },
  });

  assert.deepEqual(calls.focusTabById, ['7']);
  assert.deepEqual(calls.focusExactTabByUrl, ['https://docs.example.com/guide']);
  assert.deepEqual(calls.focusTab, []);
  assert.deepEqual(calls.showToast, ['This tab is no longer open']);
  assert.equal(calls.reconcileOpenTabsFromBrowser, 1);
});

test('focus-tab can focus open tab chips by exact url when no tab id is present', async () => {
  const { actions, calls } = createHarness({
    focusExactTabByUrlResult: { focused: true, matchedBy: 'exact' },
  });

  await actions['focus-tab']({
    actionEl: {
      dataset: {
        tabUrl: 'https://docs.example.com/guide',
      },
    },
  });

  assert.deepEqual(calls.focusTabById, []);
  assert.deepEqual(calls.focusExactTabByUrl, ['https://docs.example.com/guide']);
  assert.deepEqual(calls.focusTab, []);
  assert.deepEqual(calls.showToast, []);
  assert.equal(calls.reconcileOpenTabsFromBrowser, 0);
});

test('close-single-tab closes tab and applies optimistic update', async () => {
  const chip = { closest: () => null };
  const actionEl = {
    dataset: { tabId: '7', tabUrl: 'https://docs.example.com/guide' },
    closest: selector => selector === '.page-chip' ? chip : null,
  };
  let stopped = 0;

  const { actions, calls } = createHarness();
  await actions['close-single-tab']({
    actionEl,
    event: { stopPropagation() { stopped += 1; } },
  });

  assert.equal(stopped, 1);
  assert.deepEqual(calls.closeOpenTab, [{ tabId: '7', tabUrl: 'https://docs.example.com/guide' }]);
  assert.equal(calls.playCloseSound, 1);
  assert.deepEqual(calls.animateCardOut, [chip]);
  assert.deepEqual(calls.removeOpenTabOptimistically, [{ tabId: '7', tabUrl: 'https://docs.example.com/guide' }]);
  assert.equal(calls.reconcileOpenTabsFromBrowser, 1);
  assert.deepEqual(calls.showToast, ['Tab closed']);
});

test('close-single-tab shows stale-tab toast when target is already gone', async () => {
  const chip = { closest: () => null };
  const actionEl = {
    dataset: { tabId: '7', tabUrl: 'https://docs.example.com/guide' },
    closest: selector => selector === '.page-chip' ? chip : null,
  };
  let stopped = 0;

  const { actions, calls } = createHarness({
    closeOpenTabResult: false,
  });
  await actions['close-single-tab']({
    actionEl,
    event: { stopPropagation() { stopped += 1; } },
  });

  assert.equal(stopped, 1);
  assert.deepEqual(calls.closeOpenTab, [{ tabId: '7', tabUrl: 'https://docs.example.com/guide' }]);
  assert.equal(calls.playCloseSound, 0);
  assert.deepEqual(calls.animateCardOut, []);
  assert.deepEqual(calls.removeOpenTabOptimistically, []);
  assert.equal(calls.reconcileOpenTabsFromBrowser, 1);
  assert.deepEqual(calls.showToast, ['This tab is no longer open']);
});

test('close-tab-url-dupes closes all exact-match duplicates and reconciles open tabs', async () => {
  const chip = { closest: () => null };
  const actionEl = {
    dataset: { tabUrl: 'https://docs.example.com/guide' },
    closest: selector => selector === '.page-chip' ? chip : null,
  };
  let stopped = 0;

  const { actions, calls } = createHarness({
    closeTabsExactResult: { closedCount: 2, tabIds: [31, 32] },
  });
  const originalCloseTabsExact = actions['close-all-open-tabs'];
  void originalCloseTabsExact;

  await actions['close-tab-url-dupes']({
    actionEl,
    event: { stopPropagation() { stopped += 1; } },
  });

  assert.equal(stopped, 1);
  assert.deepEqual(calls.closeTabsExact, [['https://docs.example.com/guide']]);
  assert.equal(calls.playCloseSound, 1);
  assert.deepEqual(calls.animateCardOut, [chip]);
  assert.deepEqual(calls.removeOpenTabsOptimistically, [{
    tabIds: [31, 32],
    tabUrls: ['https://docs.example.com/guide'],
  }]);
  assert.equal(calls.reconcileOpenTabsFromBrowser, 1);
  assert.deepEqual(calls.showToast, ['Closed 2 duplicate tabs']);
});

test('defer-single-tab saves later item, closes tab, and updates later/open sections locally', async () => {
  const chip = { closest: () => null };
  const actionEl = {
    dataset: {
      tabId: '8',
      tabUrl: 'https://docs.example.com/api',
      tabTitle: 'API',
    },
    closest: selector => selector === '.page-chip' ? chip : null,
  };

  const { actions, calls } = createHarness();
  await actions['defer-single-tab']({
    actionEl,
    event: { stopPropagation() {} },
  });

  assert.deepEqual(calls.saveTabForLater, [{ url: 'https://docs.example.com/api', title: 'API' }]);
  assert.deepEqual(calls.closeOpenTab, [{ tabId: '8', tabUrl: 'https://docs.example.com/api' }]);
  assert.equal(calls.renderLaterListColumn, 1);
  assert.deepEqual(calls.removeOpenTabOptimistically, [{ tabId: '8', tabUrl: 'https://docs.example.com/api' }]);
  assert.deepEqual(calls.showToast, ['Added to Later list']);
});

test('dedup-keep-one removes duplicate tabs with optimistic update', async () => {
  const { actions, calls } = createHarness({
    closeDuplicateTabsResult: { tabIds: [21, 22] },
  });

  await actions['dedup-keep-one']({
    actionEl: {
      dataset: {
        dupeUrls: `${encodeURIComponent('https://docs.example.com/guide')},${encodeURIComponent('https://later.example.com/item')}`,
      },
    },
  });

  assert.deepEqual(calls.closeDuplicateTabs, [{
    urls: ['https://docs.example.com/guide', 'https://later.example.com/item'],
    keepOne: true,
  }]);
  assert.deepEqual(calls.removeOpenTabsOptimistically, [{
    tabIds: [21, 22],
    tabUrls: ['https://docs.example.com/guide', 'https://later.example.com/item'],
  }]);
  assert.equal(calls.reconcileOpenTabsFromBrowser, 1);
  assert.deepEqual(calls.showToast, ['Closed duplicates, kept one copy each']);
});

test('close-all-dupes closes all duplicate urls and reconciles open tabs', async () => {
  const { actions, calls } = createHarness({
    dashboardStateSnapshot: {
      domainGroups: [],
      openTabs: [
        { id: 1, url: 'https://docs.example.com/guide' },
        { id: 2, url: 'https://docs.example.com/guide' },
        { id: 3, url: 'https://later.example.com/item' },
        { id: 4, url: 'https://later.example.com/item' },
        { id: 5, url: 'https://unique.example.com/home' },
      ],
    },
    closeDuplicateTabsResult: { tabIds: [2, 4] },
  });

  await actions['close-all-dupes']();

  assert.deepEqual(calls.closeDuplicateTabs, [{
    urls: ['https://docs.example.com/guide', 'https://later.example.com/item'],
    keepOne: true,
  }]);
  assert.equal(calls.playCloseSound, 1);
  assert.deepEqual(calls.removeOpenTabsOptimistically, [{
    tabIds: [2, 4],
    tabUrls: ['https://docs.example.com/guide', 'https://later.example.com/item'],
  }]);
  assert.equal(calls.reconcileOpenTabsFromBrowser, 1);
  assert.deepEqual(calls.showToast, ['Closed all dupes, kept one copy each']);
});

function buildTabs(count, prefix = 'https://docs.example.com') {
  return Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    url: `${prefix}/${index + 1}`,
  }));
}

test('close-domain-tabs uses light confirmation for 10+ tabs before closing', async () => {
  const timeouts = [];
  const previousSetTimeout = global.setTimeout;
  const previousClearTimeout = global.clearTimeout;
  global.setTimeout = fn => {
    timeouts.push(fn);
    return timeouts.length;
  };
  global.clearTimeout = () => {};

  const actionEl = {
    dataset: { domainId: 'domain-docs-example-com' },
    innerHTML: 'Close all 10 tabs',
    textContent: 'Close all 10 tabs',
    closest: () => null,
  };
  const domainGroup = {
    domain: 'docs.example.com',
    tabs: buildTabs(10),
  };

  try {
    const { actions, calls } = createHarness({ domainGroup });

    await actions['close-domain-tabs']({ actionEl });

    assert.equal(calls.closeTabsByUrls.length, 0);
    assert.deepEqual(calls.showToast, ['Click again to close 10 tabs from friendly:docs.example.com']);
    assert.equal(actionEl.dataset.bulkCloseConfirming, 'true');
    assert.equal(actionEl.dataset.bulkCloseConfirmMode, 'light');
    assert.equal(actionEl.textContent, 'Click again: close 10 tabs');

    await actions['close-domain-tabs']({ actionEl });

    assert.deepEqual(calls.closeTabsByUrls, [buildTabs(10).map(tab => tab.url)]);
    assert.deepEqual(calls.removeOpenTabsOptimistically, [{
      tabIds: buildTabs(10).map(tab => tab.id),
      tabUrls: buildTabs(10).map(tab => tab.url),
    }]);
    assert.equal(calls.reconcileOpenTabsFromBrowser, 1);
    assert.deepEqual(calls.showToast, [
      'Click again to close 10 tabs from friendly:docs.example.com',
      'Closed 10 tabs from friendly:docs.example.com',
    ]);
  } finally {
    global.setTimeout = previousSetTimeout;
    global.clearTimeout = previousClearTimeout;
  }
});

test('close-domain-tabs uses strong confirmation for 20+ tabs before closing', async () => {
  const timeouts = [];
  const previousSetTimeout = global.setTimeout;
  const previousClearTimeout = global.clearTimeout;
  global.setTimeout = fn => {
    timeouts.push(fn);
    return timeouts.length;
  };
  global.clearTimeout = () => {};

  const actionEl = {
    dataset: { domainId: 'domain-docs-example-com' },
    innerHTML: 'Close all 20 tabs',
    textContent: 'Close all 20 tabs',
    closest: () => null,
  };
  const domainGroup = {
    domain: 'docs.example.com',
    tabs: buildTabs(20),
  };

  try {
    const { actions, calls } = createHarness({ domainGroup });

    await actions['close-domain-tabs']({ actionEl });

    assert.equal(calls.closeTabsByUrls.length, 0);
    assert.deepEqual(calls.showToast, ['Click again for explicit confirm to close 20 tabs from friendly:docs.example.com']);
    assert.equal(actionEl.dataset.bulkCloseConfirmMode, 'strong');
    assert.equal(actionEl.textContent, 'Yes, close 20 tabs');

    await actions['close-domain-tabs']({ actionEl });

    assert.equal(calls.closeTabsByUrls.length, 1);
    assert.equal(calls.reconcileOpenTabsFromBrowser, 1);
    assert.deepEqual(calls.showToast.at(-1), 'Closed 20 tabs from friendly:docs.example.com');
  } finally {
    global.setTimeout = previousSetTimeout;
    global.clearTimeout = previousClearTimeout;
  }
});

test('close-all-open-tabs uses light confirmation for 30+ tabs before closing', async () => {
  const timeouts = [];
  const previousSetTimeout = global.setTimeout;
  const previousClearTimeout = global.clearTimeout;
  global.setTimeout = fn => {
    timeouts.push(fn);
    return timeouts.length;
  };
  global.clearTimeout = () => {};

  const closeAllButton = {
    dataset: {},
    innerHTML: 'Close all 30 tabs',
    textContent: 'Close all 30 tabs',
  };
  const missionCard = {
    offsetWidth: 100,
    offsetHeight: 50,
    getBoundingClientRect() {
      return { left: 10, top: 20 };
    },
  };

  try {
    const { actions, calls } = createHarness({
      dashboardStateSnapshot: {
        domainGroups: [],
        openTabs: buildTabs(30),
      },
    });

    await withFakeDocument({
      '[data-action="close-all-open-tabs"]': closeAllButton,
      '#openTabsMissions .mission-card': [missionCard],
    }, async () => {
      await actions['close-all-open-tabs']();

      assert.equal(calls.closeTabsExact.length, 0);
      assert.deepEqual(calls.showToast, ['Click again to close 30 tabs']);
      assert.equal(closeAllButton.dataset.bulkCloseConfirming, 'true');
      assert.equal(closeAllButton.dataset.bulkCloseConfirmMode, 'light');
      assert.equal(closeAllButton.textContent, 'Click again: close 30 tabs');

      await actions['close-all-open-tabs']();
    });

    assert.deepEqual(calls.closeTabsExact, [buildTabs(30).map(tab => tab.url)]);
    assert.equal(calls.playCloseSound, 1);
    assert.equal(calls.shootConfetti.length, 1);
    assert.equal(calls.reconcileOpenTabsFromBrowser, 1);
    assert.deepEqual(calls.showToast, [
      'Click again to close 30 tabs',
      'All tabs closed. Fresh start.',
    ]);
  } finally {
    global.setTimeout = previousSetTimeout;
    global.clearTimeout = previousClearTimeout;
  }
});

test('close-all-open-tabs uses strong confirmation for 60+ tabs before closing', async () => {
  const timeouts = [];
  const previousSetTimeout = global.setTimeout;
  const previousClearTimeout = global.clearTimeout;
  global.setTimeout = fn => {
    timeouts.push(fn);
    return timeouts.length;
  };
  global.clearTimeout = () => {};

  const closeAllButton = {
    dataset: {},
    innerHTML: 'Close all 60 tabs',
    textContent: 'Close all 60 tabs',
  };

  try {
    const { actions, calls } = createHarness({
      dashboardStateSnapshot: {
        domainGroups: [],
        openTabs: buildTabs(60),
      },
    });

    await withFakeDocument({
      '[data-action="close-all-open-tabs"]': closeAllButton,
      '#openTabsMissions .mission-card': [],
    }, async () => {
      await actions['close-all-open-tabs']();

      assert.equal(calls.closeTabsExact.length, 0);
      assert.deepEqual(calls.showToast, ['Click again for explicit confirm to close 60 tabs']);
      assert.equal(closeAllButton.dataset.bulkCloseConfirmMode, 'strong');
      assert.equal(closeAllButton.textContent, 'Yes, close 60 tabs');

      await actions['close-all-open-tabs']();
    });

    assert.equal(calls.closeTabsExact.length, 1);
    assert.equal(calls.reconcileOpenTabsFromBrowser, 1);
    assert.deepEqual(calls.showToast.at(-1), 'All tabs closed. Fresh start.');
  } finally {
    global.setTimeout = previousSetTimeout;
    global.clearTimeout = previousClearTimeout;
  }
});
