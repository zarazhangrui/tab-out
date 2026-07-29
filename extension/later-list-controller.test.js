'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

global.window = global.window || {};
require('./later-list-controller.js');

const {
  createLaterListController,
} = global.window.TabOutLaterListController;

function createController(overrides = {}) {
  return createLaterListController({
    buildFaviconImg: (domain, className, pageUrl) => `[icon:${className}:${domain || ''}:${pageUrl || ''}]`,
    countLabel: (_key, count) => (Number(count) === 1 ? 'item' : 'items'),
    createStableId: () => 'later-1',
    escapeHtml: value => String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;'),
    getState: overrides.getState || (() => ({ deferredItemsCache: [] })),
    getStorageValue: overrides.getStorageValue || (async () => []),
    normalizeDeferredItems: overrides.normalizeDeferredItems || (value => ({ items: Array.isArray(value) ? value : [], changed: false })),
    queueStorageUpdate: overrides.queueStorageUpdate || (async () => {}),
    scheduleSearchAndWait: overrides.scheduleSearchAndWait || (async () => {}),
    setStorageValue: overrides.setStorageValue || (async () => {}),
    showToast: overrides.showToast || (() => {}),
    t: (key, vars = {}) => ({
      'action.remove': 'Remove',
      'toast.archivedLater': `Archived ${vars.count} ${vars.itemLabel}`,
      'toast.laterAlreadyEmpty': 'Later list already empty',
    }[key] || key),
    timeAgo: () => '2h ago',
  });
}

test('renderLaterItem passes the saved tab url to favicon rendering and exposes title tooltip', () => {
  const controller = createController();
  const html = controller.renderLaterItem({
    id: 'later-1',
    title: 'Docs Guide',
    url: 'https://docs.example.com/guide',
    savedAt: '2026-07-28T10:00:00.000Z',
  });

  assert.match(html, /\[icon:deferred-favicon:docs\.example\.com:https:\/\/docs\.example\.com\/guide\]/);
  assert.match(html, /class="later-title text-tooltip"/);
  assert.match(html, /data-tooltip="Docs Guide"/);
});

test('renderArchiveItem includes favicon and title tooltip for archived tabs', () => {
  const controller = createController();
  const html = controller.renderArchiveItem({
    id: 'later-1',
    title: 'Archived Docs',
    url: 'https://docs.example.com/archive',
    savedAt: '2026-07-28T10:00:00.000Z',
    completedAt: '2026-07-28T11:00:00.000Z',
  });

  assert.match(html, /\[icon:deferred-favicon:docs\.example\.com:https:\/\/docs\.example\.com\/archive\]/);
  assert.match(html, /class="archive-item-title text-tooltip"/);
  assert.match(html, /data-tooltip="Archived Docs"/);
});

test('later list styles allow title and dismiss tooltips to escape the right column', () => {
  const css = fs.readFileSync(path.join(__dirname, 'style.css'), 'utf8');

  assert.match(css, /\.later-column\s*\{[^}]*overflow:\s*visible;/s);
  assert.match(css, /\.later-title\s*\{[^}]*display:\s*flex;/s);
  assert.match(css, /\.later-title-text\s*\{[^}]*text-overflow:\s*ellipsis;/s);
  assert.match(css, /\.later-dismiss\[data-tooltip\]::after\s*\{[^}]*right:\s*0;/s);
});

test('handleArchiveActiveSavedTabs archives visible active later items and refreshes views', async () => {
  const calls = {
    scheduleSearchAndWait: 0,
    showToast: [],
  };
  let stored = [
    { id: 'active-1', title: 'A', url: 'https://a.example.com', completed: false, dismissed: false },
    { id: 'done-1', title: 'B', url: 'https://b.example.com', completed: true, dismissed: false },
    { id: 'gone-1', title: 'C', url: 'https://c.example.com', completed: false, dismissed: true },
  ];
  const state = { deferredItemsCache: [] };
  const previousDocument = global.document;
  global.document = {
    getElementById(id) {
      const elements = {
        archiveCount: { textContent: '' },
        archiveList: { innerHTML: '' },
        laterArchive: { style: {} },
        laterColumn: { style: {} },
        laterCount: { textContent: '' },
        laterEmpty: { style: {} },
        laterList: { innerHTML: '', style: {} },
      };
      return elements[id] || null;
    },
  };
  const controller = createController({
    getState: () => state,
    normalizeDeferredItems: value => ({ items: value.map(item => ({ ...item })), changed: false }),
    queueStorageUpdate: async (_key, updater) => {
      stored = await updater(stored);
    },
    scheduleSearchAndWait: async () => {
      calls.scheduleSearchAndWait += 1;
    },
    showToast: message => {
      calls.showToast.push(message);
    },
  });
  try {
    const archived = await controller.handleArchiveActiveSavedTabs();

    assert.equal(archived, 1);
    assert.equal(stored[0].completed, true);
    assert.equal(typeof stored[0].completedAt, 'string');
    assert.equal(stored[1].completedAt, undefined);
    assert.equal(stored[2].completed, false);
    assert.equal(calls.scheduleSearchAndWait, 1);
    assert.deepEqual(calls.showToast, ['Archived 1 item']);
  } finally {
    global.document = previousDocument;
  }
});
