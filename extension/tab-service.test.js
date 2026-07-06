'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createTabService,
} = require('./tab-service.js');

function createHarness(initialTabs = []) {
  let tabs = initialTabs.map(tab => ({ ...tab }));
  const removed = [];
  const updates = [];
  const windowUpdates = [];
  const created = [];

  const tabsApi = {
    async query() {
      return tabs.map(tab => ({ ...tab }));
    },
    async update(tabId, patch) {
      updates.push({ tabId, patch });
      return { id: tabId, ...patch };
    },
    async remove(ids) {
      const nextIds = Array.isArray(ids) ? ids.map(Number) : [Number(ids)];
      removed.push(...nextIds);
      tabs = tabs.filter(tab => !nextIds.includes(Number(tab.id)));
    },
    async create(payload) {
      created.push(payload);
      return payload;
    },
  };

  const windowsApi = {
    async getCurrent() {
      return { id: 1 };
    },
    async update(windowId, patch) {
      windowUpdates.push({ windowId, patch });
      return { id: windowId, ...patch };
    },
  };

  const runtimeApi = {
    id: 'test-extension-id',
  };

  return {
    service: createTabService({ tabsApi, windowsApi, runtimeApi }),
    removed,
    updates,
    windowUpdates,
    created,
  };
}

test('getTabUrl prefers pendingUrl over url', () => {
  const { service } = createHarness();

  assert.equal(
    service.getTabUrl({ pendingUrl: 'https://pending.example.com', url: 'https://loaded.example.com' }),
    'https://pending.example.com'
  );
  assert.equal(
    service.getTabUrl({ url: 'https://loaded.example.com' }),
    'https://loaded.example.com'
  );
});

test('isRealTabUrl filters browser-internal pages', () => {
  const { service } = createHarness();

  assert.equal(service.isRealTabUrl('https://example.com'), true);
  assert.equal(service.isRealTabUrl('chrome://settings'), false);
  assert.equal(service.isRealTabUrl('chrome-extension://abc/index.html'), false);
  assert.equal(service.isRealTabUrl('about:blank'), false);
});

test('isTabOutUrl recognizes extension new tab and chrome newtab', () => {
  const { service } = createHarness();

  assert.equal(service.getTabOutNewTabUrl(), 'chrome-extension://test-extension-id/index.html');
  assert.equal(service.isTabOutUrl('chrome-extension://test-extension-id/index.html'), true);
  assert.equal(service.isTabOutUrl('chrome://newtab/'), true);
  assert.equal(service.isTabOutUrl('https://example.com'), false);
});

test('queryDashboardTabs maps tab metadata and Tab Out state', async () => {
  const { service } = createHarness([
    {
      id: 1,
      pendingUrl: 'https://docs.example.com/guide',
      url: 'https://docs.example.com/loading',
      title: 'Guide',
      favIconUrl: 'https://docs.example.com/favicon.ico',
      windowId: 2,
      active: true,
      lastAccessed: 123,
    },
    {
      id: 2,
      url: 'chrome-extension://test-extension-id/index.html',
      title: 'Tab Out',
      windowId: 1,
      active: false,
      lastAccessed: 124,
    },
  ]);

  const tabs = await service.queryDashboardTabs();

  assert.deepEqual(tabs, [
    {
      id: 1,
      url: 'https://docs.example.com/guide',
      title: 'Guide',
      favIconUrl: 'https://docs.example.com/favicon.ico',
      windowId: 2,
      active: true,
      lastAccessed: 123,
      isTabOut: false,
    },
    {
      id: 2,
      url: 'chrome-extension://test-extension-id/index.html',
      title: 'Tab Out',
      favIconUrl: '',
      windowId: 1,
      active: false,
      lastAccessed: 124,
      isTabOut: true,
    },
  ]);
});

test('closeTabsExact closes only exact matched urls', async () => {
  const { service, removed } = createHarness([
    { id: 1, url: 'https://docs.example.com/guide' },
    { id: 2, url: 'https://docs.example.com/guide?tab=2' },
    { id: 3, url: 'https://later.example.com/item' },
  ]);

  const result = await service.closeTabsExact([
    'https://docs.example.com/guide',
    'https://later.example.com/item',
  ]);

  assert.deepEqual(removed, [1, 3]);
  assert.deepEqual(result, {
    closedCount: 2,
    tabIds: [1, 3],
  });
});

test('closeTabOutDupes keeps the active tab in the current window', async () => {
  const { service, removed } = createHarness([
    { id: 1, url: 'chrome-extension://test-extension-id/index.html', windowId: 1, active: true },
    { id: 2, url: 'chrome-extension://test-extension-id/index.html', windowId: 2, active: true },
    { id: 3, url: 'chrome://newtab/', windowId: 3, active: false },
  ]);

  const result = await service.closeTabOutDupes();

  assert.deepEqual(removed, [2, 3]);
  assert.deepEqual(result, {
    closedCount: 2,
    tabIds: [2, 3],
  });
});
