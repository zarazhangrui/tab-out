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
  const createdWindows = [];
  const created = [];
  const moved = [];

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
    async move(tabIds, payload) {
      const ids = Array.isArray(tabIds) ? tabIds.map(Number) : [Number(tabIds)];
      moved.push({ tabIds: ids, payload });
      tabs = tabs.map(tab => (
        ids.includes(Number(tab.id))
          ? { ...tab, windowId: payload.windowId }
          : tab
      ));
      return ids.map(id => tabs.find(tab => Number(tab.id) === id)).filter(Boolean);
    },
  };

  const windowsApi = {
    async getCurrent() {
      return { id: 1 };
    },
    async getAll() {
      return [
        {
          id: 1,
          type: 'normal',
          state: 'normal',
          focused: true,
          incognito: false,
          left: 0,
          top: 0,
          width: 1000,
          height: 800,
        },
        {
          id: 2,
          type: 'normal',
          state: 'maximized',
          focused: false,
          incognito: false,
          alwaysOnTop: false,
          left: 20,
          top: 30,
          width: 1200,
          height: 900,
        },
      ];
    },
    async create(payload) {
      createdWindows.push(payload);
      return {
        id: 42,
        ...payload,
        tabs: [{ id: 420, url: payload.url, windowId: 42 }],
      };
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
    createdWindows,
    created,
    moved,
  };
}

function createHarnessWithCustomTabsApi(initialTabs = [], tabsApiOverrides = {}) {
  let tabs = initialTabs.map(tab => ({ ...tab }));
  const removed = [];
  const updates = [];
  const windowUpdates = [];

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
    ...tabsApiOverrides,
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
  };
}

function createHarnessWithCustomWindowsApi(initialTabs = [], windowsApiOverrides = {}) {
  let tabs = initialTabs.map(tab => ({ ...tab }));
  const removed = [];
  const updates = [];
  const windowUpdates = [];
  const created = [];
  const createdWindows = [];

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
    async get(windowId) {
      return { id: windowId };
    },
    async update(windowId, patch) {
      windowUpdates.push({ windowId, patch });
      return { id: windowId, ...patch };
    },
    ...windowsApiOverrides,
    async create(payload) {
      createdWindows.push(payload);
      if (windowsApiOverrides.create) {
        return windowsApiOverrides.create(payload);
      }
      return {
        id: 42,
        ...payload,
        tabs: [{ id: 420, url: payload.url, windowId: 42 }],
      };
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
    createdWindows,
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
  assert.equal(service.isRealTabUrl('file:///Users/lucas/Desktop/spec.pdf'), true);
  assert.equal(service.isRealTabUrl('chrome://settings'), false);
  assert.equal(service.isRealTabUrl('chrome-extension://abc/index.html'), false);
  assert.equal(service.isRealTabUrl('about:blank'), false);
  assert.equal(service.isRealTabUrl('javascript:alert(1)'), false);
  assert.equal(service.isRealTabUrl('data:text/html,<script>alert(1)</script>'), false);
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
      window: {
        id: 2,
        type: 'normal',
        state: 'maximized',
        focused: false,
        incognito: false,
        alwaysOnTop: false,
        left: 20,
        top: 30,
        width: 1200,
        height: 900,
      },
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
      window: {
        id: 1,
        type: 'normal',
        state: 'normal',
        focused: true,
        incognito: false,
        left: 0,
        top: 0,
        width: 1000,
        height: 800,
      },
      active: false,
      lastAccessed: 124,
      isTabOut: true,
    },
  ]);
});

test('createTab can target an existing window', async () => {
  const { service, created } = createHarness();

  await service.createTab('https://docs.example.com/guide', {
    active: false,
    windowId: '42',
  });

  assert.deepEqual(created, [
    {
      url: 'https://docs.example.com/guide',
      active: false,
      windowId: 42,
    },
  ]);
});

test('createTabsInWindow restores a tab group into one new window', async () => {
  const { service, createdWindows, created } = createHarness();

  const result = await service.createTabsInWindow([
    'https://docs.example.com/guide',
    'https://docs.example.com/api',
  ], {
    active: false,
    windowOptions: {
      type: 'normal',
      state: 'normal',
      left: 10,
      top: 20,
      width: 1200,
      height: 800,
      incognito: false,
    },
  });

  assert.deepEqual(createdWindows, [
    {
      url: 'https://docs.example.com/guide',
      focused: false,
      left: 10,
      top: 20,
      width: 1200,
      height: 800,
      incognito: false,
      type: 'normal',
      state: 'normal',
    },
  ]);
  assert.deepEqual(created, [
    {
      url: 'https://docs.example.com/api',
      active: false,
      windowId: 42,
    },
  ]);
  assert.equal(result.windowId, 42);
  assert.equal(result.createdTabs.length, 2);
});

test('createTabsInWindow reuses the original window when the source id still exists', async () => {
  const { service, createdWindows, created } = createHarnessWithCustomWindowsApi([], {
    async get(windowId) {
      assert.equal(windowId, 7);
      return { id: 7 };
    },
  });

  const result = await service.createTabsInWindow([
    'https://docs.example.com/guide',
    'https://docs.example.com/api',
  ], {
    active: false,
    windowOptions: { id: 7, state: 'normal' },
  });

  assert.deepEqual(createdWindows, []);
  assert.deepEqual(created, [
    {
      url: 'https://docs.example.com/guide',
      active: false,
      windowId: 7,
    },
    {
      url: 'https://docs.example.com/api',
      active: false,
      windowId: 7,
    },
  ]);
  assert.equal(result.reusedExistingWindow, true);
  assert.equal(result.windowId, 7);
  assert.equal(result.createdTabs.length, 2);
});

test('createTabsInWindow creates a new restore window when the source id is gone', async () => {
  const { service, createdWindows, created } = createHarnessWithCustomWindowsApi([], {
    async get() {
      throw new Error('No window with id: 7');
    },
  });

  const result = await service.createTabsInWindow([
    'https://docs.example.com/guide',
    'https://docs.example.com/api',
  ], {
    active: false,
    windowOptions: { id: 7, state: 'normal' },
  });

  assert.deepEqual(createdWindows, [
    {
      url: 'https://docs.example.com/guide',
      focused: false,
      state: 'normal',
    },
  ]);
  assert.deepEqual(created, [
    {
      url: 'https://docs.example.com/api',
      active: false,
      windowId: 42,
    },
  ]);
  assert.equal(result.reusedExistingWindow, false);
  assert.equal(result.windowId, 42);
  assert.equal(result.createdTabs.length, 2);
});

test('createTabsInWindow avoids bounds when restoring maximized windows', async () => {
  const { service, createdWindows } = createHarness();

  await service.createTabsInWindow([
    'https://docs.example.com/guide',
  ], {
    windowOptions: {
      state: 'maximized',
      left: 10,
      top: 20,
      width: 1200,
      height: 800,
    },
  });

  assert.deepEqual(createdWindows, [
    {
      url: 'https://docs.example.com/guide',
      focused: false,
      state: 'maximized',
    },
  ]);
});

test('createTabsInWindow falls back when Chrome rejects restore window options', async () => {
  let createAttempts = 0;
  const { service, createdWindows } = createHarnessWithCustomWindowsApi([], {
    async create(payload) {
      createAttempts += 1;
      if (createAttempts === 1) {
        throw new Error('Incognito mode is unavailable');
      }
      return {
        id: 99,
        ...payload,
        tabs: [{ id: 990, url: payload.url, windowId: 99 }],
      };
    },
  });

  const result = await service.createTabsInWindow([
    'https://docs.example.com/guide',
  ], {
    windowOptions: {
      incognito: true,
      state: 'normal',
      left: 10,
    },
  });

  assert.deepEqual(createdWindows, [
    {
      url: 'https://docs.example.com/guide',
      focused: false,
      left: 10,
      incognito: true,
      state: 'normal',
    },
    {
      url: 'https://docs.example.com/guide',
      focused: false,
    },
  ]);
  assert.equal(result.windowId, 99);
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

test('closeTab returns false when target tab id is already gone', async () => {
  const { service, removed } = createHarness([
    { id: 1, url: 'https://docs.example.com/guide' },
  ]);

  const result = await service.closeTab(99, 'https://docs.example.com/guide');

  assert.equal(result, false);
  assert.deepEqual(removed, []);
});

test('closeTab returns false when chrome reports missing tab during remove', async () => {
  const { service, removed } = createHarnessWithCustomTabsApi(
    [{ id: 7, url: 'https://docs.example.com/guide' }],
    {
      async remove() {
        throw new Error('No tab with id: 7.');
      },
    }
  );

  const result = await service.closeTab(7, 'https://docs.example.com/guide');

  assert.equal(result, false);
  assert.deepEqual(removed, []);
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
    suppressRefreshForTabIds: [2, 3],
    tabIds: [2, 3],
  });
});

test('closeTabOutDupes calls beforeRemove before removing tabs', async () => {
  const { service, removed } = createHarness([
    { id: 1, url: 'chrome-extension://test-extension-id/index.html', windowId: 1, active: true },
    { id: 2, url: 'chrome-extension://test-extension-id/index.html', windowId: 2, active: true },
    { id: 3, url: 'chrome://newtab/', windowId: 3, active: false },
  ]);
  const callOrder = [];

  await service.closeTabOutDupes({
    async beforeRemove(tabIds) {
      callOrder.push({ type: 'beforeRemove', tabIds });
      assert.deepEqual(removed, []);
    },
  });

  callOrder.push({ type: 'afterClose', removed: [...removed] });

  assert.deepEqual(callOrder, [
    { type: 'beforeRemove', tabIds: [2, 3] },
    { type: 'afterClose', removed: [2, 3] },
  ]);
});

test('moveTabsToCurrentWindow moves only tabs outside the current window', async () => {
  const { service, moved } = createHarness([
    { id: 1, url: 'https://docs.example.com/current', windowId: 1 },
    { id: 2, url: 'https://docs.example.com/remote', windowId: 2 },
    { id: 3, url: 'https://docs.example.com/remote-2', windowId: 3 },
  ]);

  const result = await service.moveTabsToCurrentWindow([1, 2, 3, 99]);

  assert.deepEqual(moved, [
    {
      tabIds: [2, 3],
      payload: { windowId: 1, index: -1 },
    },
  ]);
  assert.deepEqual(result, {
    movedCount: 2,
    skippedCount: 1,
    tabIds: [2, 3],
    windowId: 1,
  });
});
