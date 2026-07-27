'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildImportedGroupViewModel,
  buildImportedTabViewModel,
} = require('./app-view-models.js');
const {
  createTestI18n,
} = require('./test-i18n-helper.js');

global.window = global.window || {};
require('./imported-session-controller.js');

const {
  createImportedSessionController,
} = window.TabOutImportedSessionController;

function createHarness(overrides = {}) {
  const i18n = createTestI18n(overrides.language || 'en');
  const state = {
    importedSession: overrides.initialImportedSession || null,
  };
  const calls = {
    createTab: [],
    createTabsInWindow: [],
    downloadJsonFile: [],
    queueStorageUpdate: [],
    setStorageValue: [],
    showToast: [],
    syncImportedSessionSearchResults: 0,
  };

  const controller = createImportedSessionController({
    buildImportedGroupViewModel: overrides.buildImportedGroupViewModel,
    buildImportedTabViewModel: overrides.buildImportedTabViewModel,
    buildSessionFilename: scope => `tab-out-${scope}.json`,
    buildFaviconImg: domain => `[icon:${domain || ''}]`,
    countLabel: i18n.countLabel,
    createSessionExport: groups => ({ groups }),
    dedupeSessionGroups: groups => groups,
    createTab: async (url, options) => {
      calls.createTab.push({ url, options });
      return { url, ...options };
    },
    createTabsInWindow: overrides.createTabsInWindow || (async (urls, options) => {
      calls.createTabsInWindow.push({ urls, options });
      return { urls, ...options };
    }),
    downloadJsonFile: (filename, payload) => {
      calls.downloadJsonFile.push({ filename, payload });
    },
    escapeHtml: value => String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;'),
    focusExactTabByUrl: overrides.focusExactTabByUrl || (async () => false),
    friendlyDomain: value => `friendly:${value}`,
    formatSessionDate: value => value ? `formatted:${value}` : '',
    getState: () => state,
    getRealTabs: () => overrides.realTabs || [],
    queryRawTabs: async () => overrides.rawTabs || [],
    normalizeImportedSessionData: input => ({ session: input, changed: false }),
    planRestoreTabs: overrides.planRestoreTabs,
    parseImportedSession: overrides.parseImportedSession,
    summarizeRestorePlan: overrides.summarizeRestorePlan,
    getStorageValue: async key => {
      if (key === 'importedSession') {
        return overrides.storedImportedSession ?? state.importedSession;
      }
      return null;
    },
    setStorageValue: async (key, value) => {
      calls.setStorageValue.push({ key, value });
      if (key === 'importedSession') {
        state.importedSession = value;
      }
      return value;
    },
    queueStorageUpdate: async (key, updater) => {
      const nextValue = await updater(state.importedSession);
      calls.queueStorageUpdate.push({ key, value: nextValue });
      if (key === 'importedSession') {
        state.importedSession = nextValue;
      }
      return nextValue;
    },
    syncImportedSessionSearchResults: async () => {
      calls.syncImportedSessionSearchResults += 1;
    },
    showToast: message => {
      calls.showToast.push(message);
    },
    t: i18n.t,
  });

  return { controller, calls, state };
}

function withFakeDocument(elements, run) {
  const previousDocument = global.document;
  global.document = {
    getElementById(id) {
      return elements[id] || null;
    },
  };

  return Promise.resolve()
    .then(run)
    .finally(() => {
      global.document = previousDocument;
    });
}

test('handleImportSessionFiles merges groups and disambiguates duplicate ids', async () => {
  const { controller, calls, state } = createHarness({
    initialImportedSession: {
      version: 1,
      exportedAt: '2026-07-10T08:00:00.000Z',
      groups: [
        {
          id: 'docs',
          domain: 'docs.example.com',
          label: 'Docs',
          tabs: [{ id: 'doc-1', title: 'Guide', url: 'https://docs.example.com/guide' }],
        },
      ],
    },
    parseImportedSession(text) {
      assert.equal(text, '{"ok":true}');
      return {
        version: 1,
        exportedAt: '2026-07-10T09:00:00.000Z',
        groups: [
          {
            id: 'docs',
            domain: 'docs.example.com',
            label: 'Docs 2',
            tabs: [{ id: 'doc-2', title: 'API', url: 'https://docs.example.com/api' }],
          },
        ],
      };
    },
  });

  await withFakeDocument({
    importedSessionSection: { style: {}, innerHTML: '' },
    importedSessionCount: { textContent: '' },
    importedSessionMeta: { textContent: '' },
    importedSessionMissions: { innerHTML: '' },
  }, async () => {
    const count = await controller.handleImportSessionFiles([{
      async text() {
        return '{"ok":true}';
      },
    }]);

    assert.equal(count, 1);
  });

  assert.equal(state.importedSession.groups.length, 2);
  assert.deepEqual(
    state.importedSession.groups.map(group => group.id),
    ['docs', 'docs-2']
  );
  assert.equal(calls.queueStorageUpdate.length, 1);
  assert.equal(calls.syncImportedSessionSearchResults, 1);
  assert.deepEqual(calls.showToast, ['Imported 1 group']);
});

test('handleRestoreImportedTab opens existing tab instead of restoring when already open', async () => {
  const { controller, calls } = createHarness({
    initialImportedSession: {
      groups: [
        {
          id: 'docs',
          domain: 'docs.example.com',
          tabs: [{ id: 'doc-1', title: 'Guide', url: 'https://docs.example.com/guide' }],
        },
      ],
    },
    focusExactTabByUrl: async url => url === 'https://docs.example.com/guide',
  });

  const result = await controller.handleRestoreImportedTab(
    'docs',
    'doc-1',
    'https://docs.example.com/guide'
  );

  assert.deepEqual(result, {
    opened: 0,
    skipped: 1,
    changedOpenTabs: false,
    focusedExistingTab: true,
  });
  assert.deepEqual(calls.createTab, []);
  assert.deepEqual(calls.showToast, ['Opened existing tab']);
});

test('restoreSessionGroups restores tabs into the current window by default', async () => {
  const { controller, calls } = createHarness({
    rawTabs: [],
    summarizeRestorePlan: () => ({
      toOpen: [
        { id: 'doc-1', title: 'Guide', url: 'https://docs.example.com/guide' },
        { id: 'doc-2', title: 'API', url: 'https://docs.example.com/api' },
        { id: 'later-1', title: 'Later', url: 'https://later.example.com/item' },
      ],
      skipped: [],
      windowGroups: [
        {
          sourceWindowId: '2',
          window: { id: '2', state: 'normal', left: 10, top: 20, width: 1200, height: 800 },
          tabs: [
            { id: 'doc-1', title: 'Guide', url: 'https://docs.example.com/guide' },
            { id: 'doc-2', title: 'API', url: 'https://docs.example.com/api' },
          ],
        },
      ],
      ungroupedTabs: [
        { id: 'later-1', title: 'Later', url: 'https://later.example.com/item' },
      ],
    }),
  });

  const result = await controller.restoreSessionGroups([
    {
      id: 'docs',
      tabs: [
        { id: 'doc-1', title: 'Guide', url: 'https://docs.example.com/guide' },
        { id: 'doc-2', title: 'API', url: 'https://docs.example.com/api' },
      ],
    },
  ]);

  assert.deepEqual(calls.createTabsInWindow, []);
  assert.deepEqual(calls.createTab, [
    {
      url: 'https://docs.example.com/guide',
      options: { active: false },
    },
    {
      url: 'https://docs.example.com/api',
      options: { active: false },
    },
    {
      url: 'https://later.example.com/item',
      options: { active: false },
    },
  ]);
  assert.deepEqual(result, {
    opened: 3,
    skipped: 0,
    changedOpenTabs: true,
  });
});

test('restoreSessionGroups can restore tabs into their original window groups', async () => {
  const { controller, calls } = createHarness({
    rawTabs: [],
    summarizeRestorePlan: () => ({
      toOpen: [
        { id: 'doc-1', title: 'Guide', url: 'https://docs.example.com/guide' },
        { id: 'doc-2', title: 'API', url: 'https://docs.example.com/api' },
        { id: 'later-1', title: 'Later', url: 'https://later.example.com/item' },
      ],
      skipped: [],
      windowGroups: [
        {
          sourceWindowId: '2',
          window: { id: '2', state: 'normal', left: 10, top: 20, width: 1200, height: 800 },
          tabs: [
            { id: 'doc-1', title: 'Guide', url: 'https://docs.example.com/guide' },
            { id: 'doc-2', title: 'API', url: 'https://docs.example.com/api' },
          ],
        },
      ],
      ungroupedTabs: [
        { id: 'later-1', title: 'Later', url: 'https://later.example.com/item' },
      ],
    }),
  });

  const result = await controller.restoreSessionGroups([
    {
      id: 'docs',
      tabs: [
        { id: 'doc-1', title: 'Guide', url: 'https://docs.example.com/guide' },
        { id: 'doc-2', title: 'API', url: 'https://docs.example.com/api' },
      ],
    },
  ], { mode: 'original-windows' });

  assert.deepEqual(calls.createTabsInWindow, [
    {
      urls: [
        'https://docs.example.com/guide',
        'https://docs.example.com/api',
      ],
      options: {
        active: false,
        windowOptions: { id: '2', state: 'normal', left: 10, top: 20, width: 1200, height: 800 },
      },
    },
  ]);
  assert.deepEqual(calls.createTab, [
    {
      url: 'https://later.example.com/item',
      options: { active: false },
    },
  ]);
  assert.deepEqual(result, {
    opened: 3,
    skipped: 0,
    changedOpenTabs: true,
  });
});

test('handleClearImportedTab removes target tab and syncs search results', async () => {
  const { controller, calls, state } = createHarness({
    initialImportedSession: {
      groups: [
        {
          id: 'docs',
          domain: 'docs.example.com',
          tabs: [
            { id: 'doc-1', title: 'Guide', url: 'https://docs.example.com/guide' },
            { id: 'doc-2', title: 'API', url: 'https://docs.example.com/api' },
          ],
        },
      ],
    },
  });

  await withFakeDocument({
    importedSessionSection: { style: {}, innerHTML: '' },
    importedSessionCount: { textContent: '' },
    importedSessionMeta: { textContent: '' },
    importedSessionMissions: { innerHTML: '' },
  }, async () => {
    const changed = await controller.handleClearImportedTab('docs', 'doc-1');
    assert.equal(changed, true);
  });

  assert.deepEqual(
    state.importedSession.groups[0].tabs.map(tab => tab.id),
    ['doc-2']
  );
  assert.equal(calls.queueStorageUpdate.length, 1);
  assert.equal(calls.syncImportedSessionSearchResults, 1);
  assert.deepEqual(calls.showToast, ['Imported tab cleared']);
});

test('renderImportedSessionSection shows opened count badge for open imported tabs', async () => {
  const { controller } = createHarness({
    buildImportedGroupViewModel,
    buildImportedTabViewModel,
    initialImportedSession: {
      exportedAt: '2026-07-10T09:00:00.000Z',
      groups: [
        {
          id: 'docs',
          domain: 'docs.example.com',
          label: 'Docs',
          tabs: [
            { id: 'doc-1', title: 'Guide', url: 'https://docs.example.com/guide' },
            { id: 'doc-2', title: 'API', url: 'https://docs.example.com/api' },
          ],
        },
      ],
    },
    realTabs: [
      { id: 1, url: 'https://docs.example.com/guide' },
    ],
  });

  const section = { style: { display: 'none' } };
  const countEl = { textContent: '' };
  const metaEl = { textContent: '' };
  const missionsEl = { innerHTML: '' };

  await withFakeDocument({
    importedSessionSection: section,
    importedSessionCount: countEl,
    importedSessionMeta: metaEl,
    importedSessionMissions: missionsEl,
  }, async () => {
    controller.renderImportedSessionSection();
  });

  assert.equal(section.style.display, 'block');
  assert.match(countEl.textContent, /1 group/);
  assert.match(countEl.textContent, /2 tabs/);
  assert.match(metaEl.textContent, /formatted:2026-07-10T09:00:00.000Z/);
  assert.match(missionsEl.innerHTML, /1 opened/);
  assert.match(missionsEl.innerHTML, /class="page-chip clickable tab-title-tooltip"/);
  assert.match(missionsEl.innerHTML, /data-tooltip="Guide"/);
  assert.doesNotMatch(missionsEl.innerHTML, /title="Guide"/);
  assert.match(missionsEl.innerHTML, /class="chip-inline-status chip-open-status"/);
  assert.match(missionsEl.innerHTML, /data-tooltip="Already open"/);
  assert.match(missionsEl.innerHTML, /aria-label="Already open"/);
  assert.doesNotMatch(missionsEl.innerHTML, />Opened</);
  assert.match(missionsEl.innerHTML, /data-action="restore-imported-group"/);
  assert.match(missionsEl.innerHTML, /data-action="restore-imported-group-original"/);
  assert.match(missionsEl.innerHTML, />Restore window</);
});

test('renderImportedSessionSection localizes imported open status icon', async () => {
  const { controller } = createHarness({
    buildImportedGroupViewModel,
    buildImportedTabViewModel,
    language: 'zh',
    initialImportedSession: {
      groups: [
        {
          id: 'docs',
          domain: 'docs.example.com',
          label: 'Docs',
          tabs: [
            { id: 'doc-1', title: 'Guide', url: 'https://docs.example.com/guide' },
          ],
        },
      ],
    },
    realTabs: [
      { id: 1, url: 'https://docs.example.com/guide' },
    ],
  });

  const section = { style: { display: 'none' } };
  const missionsEl = { innerHTML: '' };

  await withFakeDocument({
    importedSessionSection: section,
    importedSessionCount: { textContent: '' },
    importedSessionMeta: { textContent: '' },
    importedSessionMissions: missionsEl,
  }, async () => {
    controller.renderImportedSessionSection();
  });

  assert.match(missionsEl.innerHTML, /class="chip-inline-status chip-open-status"/);
  assert.match(missionsEl.innerHTML, /data-tooltip="已打开"/);
  assert.match(missionsEl.innerHTML, /aria-label="已打开"/);
});
