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
    renderAutoRefreshToggle: 0,
    renderLaterListColumn: 0,
    scheduleDashboardRefresh: 0,
    scheduleDashboardRender: 0,
    scheduleSearchRender: 0,
    setAutoRefreshEnabled: [],
    setDeferredItemsCache: [],
    setImportedSession: [],
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
    scheduleDashboardRefresh: () => {
      calls.scheduleDashboardRefresh += 1;
    },
    scheduleDashboardRender: () => {
      calls.scheduleDashboardRender += 1;
    },
    scheduleSearchRender: () => {
      calls.scheduleSearchRender += 1;
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

  tabsListeners.created();
  tabsListeners.updated(1, { status: 'complete' });
  tabsListeners.removed(2);

  assert.equal(calls.scheduleDashboardRefresh, 3);
  assert.deepEqual(calls.shouldSkipRemovedTab, [2]);
});

test('bindBrowserListeners skips suppressed remove refresh', async () => {
  const { calls, lifecycle, tabsApi, storageApi, tabsListeners } = createHarness({
    skipRemovedTab: true,
  });

  lifecycle.bindBrowserListeners({ tabsApi, storageApi });
  tabsListeners.removed(9);

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
