'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createDashboardLifecycle,
} = require('./dashboard-lifecycle.js');

function createHarness(overrides = {}) {
  const calls = {
    ensureStorageSchema: 0,
    getAutoRefreshSetting: 0,
    getCurrentTabId: 0,
    scheduleOpenTabsRefresh: 0,
    renderAutoRefreshToggle: 0,
    renderLaterListColumn: 0,
    scheduleDashboardRefresh: 0,
    scheduleDashboardRender: 0,
    scheduleSearchRender: 0,
    setAutoRefreshEnabled: [],
    setDeferredItemsCache: [],
    setImportedSession: [],
    shouldSkipUpdatedTab: [],
    shouldSkipRemovedTab: [],
    warnings: [],
  };

  const tabsListeners = {};
  const storageListeners = {};
  const tabsApi = {
    onCreated: {
      addListener(handler) {
        tabsListeners.created = handler;
      },
    },
    onRemoved: {
      addListener(handler) {
        tabsListeners.removed = handler;
      },
    },
    onUpdated: {
      addListener(handler) {
        tabsListeners.updated = handler;
      },
    },
  };
  const storageApi = {
    onChanged: {
      addListener(handler) {
        storageListeners.changed = handler;
      },
    },
  };

  const lifecycle = createDashboardLifecycle({
    appState: {},
    ensureStorageSchema: async () => {
      calls.ensureStorageSchema += 1;
      if (overrides.ensureStorageSchemaError) throw overrides.ensureStorageSchemaError;
    },
    getAutoRefreshSetting: async () => {
      calls.getAutoRefreshSetting += 1;
      if (overrides.getAutoRefreshSettingError) throw overrides.getAutoRefreshSettingError;
      return true;
    },
    getCurrentTabId: overrides.currentTabId === undefined && !overrides.getCurrentTabIdError && !overrides.getCurrentTabId
      ? undefined
      : async () => {
          calls.getCurrentTabId += 1;
          if (overrides.getCurrentTabIdError) throw overrides.getCurrentTabIdError;
          if (overrides.getCurrentTabId) return overrides.getCurrentTabId();
          return overrides.currentTabId;
        },
    getNormalizeDeferredItems: () => value => ({ items: value || [] }),
    getNormalizeImportedSessionData: () => value => ({ session: value || null }),
    getSearchQuery: () => overrides.searchQuery || '',
    renderAutoRefreshToggle: () => {
      calls.renderAutoRefreshToggle += 1;
    },
    renderLaterListColumn: async () => {
      calls.renderLaterListColumn += 1;
      if (overrides.renderLaterListColumnError) throw overrides.renderLaterListColumnError;
    },
    scheduleOpenTabsRefresh: () => {
      calls.scheduleOpenTabsRefresh += 1;
    },
    scheduleDashboardRefresh: () => {
      calls.scheduleDashboardRefresh += 1;
    },
    scheduleDashboardRender: () => {
      calls.scheduleDashboardRender += 1;
    },
    scheduleSearchRender: () => {
      calls.scheduleSearchRender += 1;
    },
    shouldSkipUpdatedTab: (tabId, changeInfo, tab) => {
      calls.shouldSkipUpdatedTab.push({ tabId, changeInfo, tab });
      return !!(overrides.shouldSkipUpdatedTab && overrides.shouldSkipUpdatedTab(tabId, changeInfo, tab));
    },
    setAutoRefreshEnabled: value => {
      calls.setAutoRefreshEnabled.push(value);
    },
    setDeferredItemsCache: items => {
      calls.setDeferredItemsCache.push(items);
    },
    setImportedSession: session => {
      calls.setImportedSession.push(session);
    },
    shouldSkipRemovedTab: tabId => {
      calls.shouldSkipRemovedTab.push(tabId);
      return !!overrides.skipRemovedTab;
    },
    tabCreateMergeWindowMs: overrides.tabCreateMergeWindowMs,
  });

  return {
    calls,
    lifecycle,
    logger: {
      warn(...args) {
        calls.warnings.push(args);
      },
    },
    storageListeners,
    tabsApi,
    tabsListeners,
    storageApi,
  };
}

test('bindBrowserListeners wires tab lifecycle events to dashboard refresh', async () => {
  const { calls, lifecycle, tabsApi, storageApi, tabsListeners } = createHarness();

  lifecycle.bindBrowserListeners({ tabsApi, storageApi });

  tabsListeners.created({ id: 1 });
  tabsListeners.updated(1, { status: 'complete' });
  tabsListeners.removed(2);

  assert.equal(calls.scheduleOpenTabsRefresh, 2);
  assert.equal(calls.scheduleDashboardRefresh, 0);
  assert.deepEqual(calls.shouldSkipRemovedTab, [2]);
});

test('bindBrowserListeners merges early updates after tab creation into one refresh', async () => {
  const { calls, lifecycle, tabsApi, storageApi, tabsListeners } = createHarness();

  lifecycle.bindBrowserListeners({ tabsApi, storageApi });
  tabsListeners.created({ id: 7 });
  tabsListeners.updated(7, { url: 'https://docs.example.com/guide' });
  tabsListeners.updated(7, { status: 'complete' });

  assert.equal(calls.scheduleOpenTabsRefresh, 1);
  assert.equal(calls.scheduleDashboardRefresh, 0);
});

test('bindBrowserListeners skips caller-designated updated tabs', async () => {
  const { calls, lifecycle, tabsApi, storageApi, tabsListeners } = createHarness({
    shouldSkipUpdatedTab: (_tabId, _changeInfo, tab) => tab && tab.isTabOut,
  });

  lifecycle.bindBrowserListeners({ tabsApi, storageApi });
  tabsListeners.updated(17, { status: 'complete' }, { id: 17, isTabOut: true });

  assert.equal(calls.scheduleOpenTabsRefresh, 0);
  assert.deepEqual(calls.shouldSkipUpdatedTab, [
    { tabId: 17, changeInfo: { status: 'complete' }, tab: { id: 17, isTabOut: true } },
  ]);
});

test('bindBrowserListeners skips updates for the dashboard tab navigating away', async () => {
  const { calls, lifecycle, tabsApi, storageApi, tabsListeners } = createHarness({
    currentTabId: 17,
  });

  lifecycle.bindBrowserListeners({ tabsApi, storageApi });
  await Promise.resolve();

  tabsListeners.updated(17, { url: 'https://example.com/' }, { id: 17, url: 'https://example.com/' });
  tabsListeners.updated(17, { status: 'complete' }, { id: 17, url: 'https://example.com/' });
  await Promise.resolve();

  assert.equal(calls.getCurrentTabId, 1);
  assert.equal(calls.scheduleOpenTabsRefresh, 0);
});

test('bindBrowserListeners waits for current tab id before handling early current-tab updates', async () => {
  let resolveCurrentTabId;
  const currentTabIdPromise = new Promise(resolve => {
    resolveCurrentTabId = resolve;
  });
  const { calls, lifecycle, tabsApi, storageApi, tabsListeners } = createHarness({
    getCurrentTabId: () => currentTabIdPromise,
  });

  lifecycle.bindBrowserListeners({ tabsApi, storageApi });
  tabsListeners.updated(17, { status: 'complete' }, { id: 17, url: 'https://example.com/' });

  assert.equal(calls.getCurrentTabId, 1);
  assert.equal(calls.scheduleOpenTabsRefresh, 0);

  resolveCurrentTabId(17);
  await currentTabIdPromise;
  await Promise.resolve();

  assert.equal(calls.scheduleOpenTabsRefresh, 0);
});

test('bindBrowserListeners still refreshes updates for older tabs', async () => {
  const { calls, lifecycle, tabsApi, storageApi, tabsListeners } = createHarness();

  lifecycle.bindBrowserListeners({ tabsApi, storageApi });
  tabsListeners.updated(11, { status: 'complete' });
  await Promise.resolve();

  assert.equal(calls.scheduleOpenTabsRefresh, 1);
  assert.equal(calls.scheduleDashboardRefresh, 0);
});

test('bindBrowserListeners merges url and complete updates for the same tab navigation', async () => {
  const { calls, lifecycle, tabsApi, storageApi, tabsListeners } = createHarness();

  lifecycle.bindBrowserListeners({ tabsApi, storageApi });
  tabsListeners.updated(11, { url: 'https://example.com/' }, { id: 11, url: 'https://example.com/' });
  await Promise.resolve();
  tabsListeners.updated(11, { status: 'complete' }, { id: 11, url: 'https://example.com/' });
  await Promise.resolve();

  assert.equal(calls.scheduleOpenTabsRefresh, 1);
});

test('bindBrowserListeners skips suppressed remove refresh', async () => {
  const { calls, lifecycle, tabsApi, storageApi, tabsListeners } = createHarness({
    skipRemovedTab: true,
  });

  lifecycle.bindBrowserListeners({ tabsApi, storageApi });
  tabsListeners.removed(9);

  assert.equal(calls.scheduleOpenTabsRefresh, 0);
  assert.equal(calls.scheduleDashboardRefresh, 0);
  assert.deepEqual(calls.shouldSkipRemovedTab, [9]);
});

test('bindBrowserListeners reacts to storage changes', async () => {
  const { calls, lifecycle, tabsApi, storageApi, storageListeners } = createHarness({
    searchQuery: 'docs',
  });

  lifecycle.bindBrowserListeners({ tabsApi, storageApi });
  storageListeners.changed({
    deferred: { newValue: [{ id: 'later-1' }] },
    importedSession: { newValue: { groups: [{ id: 'docs' }] } },
    autoRefreshEnabled: { newValue: true },
  }, 'local');

  await Promise.resolve();

  assert.deepEqual(calls.setDeferredItemsCache, [[{ id: 'later-1' }]]);
  assert.equal(calls.renderLaterListColumn, 1);
  assert.equal(calls.scheduleSearchRender, 1);
  assert.deepEqual(calls.setImportedSession, [{ groups: [{ id: 'docs' }] }]);
  assert.deepEqual(calls.setAutoRefreshEnabled, [true]);
  assert.equal(calls.renderAutoRefreshToggle, 1);
  assert.equal(calls.scheduleDashboardRender, 1);
});

test('initialize loads schema and settings then schedules first render', async () => {
  const { calls, lifecycle, logger } = createHarness();

  await lifecycle.initialize({ logger });

  assert.equal(calls.ensureStorageSchema, 1);
  assert.equal(calls.getAutoRefreshSetting, 1);
  assert.equal(calls.scheduleDashboardRender, 1);
  assert.deepEqual(calls.warnings, []);
});

test('initialize warns and still schedules first render on fallback path', async () => {
  const { calls, lifecycle, logger } = createHarness({
    ensureStorageSchemaError: new Error('boom'),
  });

  await lifecycle.initialize({ logger });

  assert.equal(calls.scheduleDashboardRender, 1);
  assert.equal(calls.warnings.length, 1);
  assert.match(String(calls.warnings[0][0]), /Initialization fallback path triggered/);
});
