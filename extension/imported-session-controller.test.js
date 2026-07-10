'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildImportedGroupViewModel,
  buildImportedTabViewModel,
} = require('./app-view-models.js');

global.window = global.window || {};
require('./imported-session-controller.js');

const {
  createImportedSessionController,
} = window.TabOutImportedSessionController;

function createHarness(overrides = {}) {
  const state = {
    importedSession: overrides.initialImportedSession || null,
  };
  const calls = {
    createTab: [],
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
    createSessionExport: groups => ({ groups }),
    dedupeSessionGroups: groups => groups,
    createTab: async (url, options) => {
      calls.createTab.push({ url, options });
      return { url, ...options };
    },
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
  assert.match(missionsEl.innerHTML, /<span class="chip-inline-status">Opened<\/span>/);
  assert.match(missionsEl.innerHTML, /data-action="restore-imported-group"/);
});
