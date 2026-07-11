'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createDashboardSearchRenderer,
} = require('./dashboard-search-renderer.js');
const {
  createTestI18n,
} = require('./test-i18n-helper.js');

function makeElement() {
  return {
    innerHTML: '',
    textContent: '',
    style: { display: '' },
  };
}

function withMockDocument(fn) {
  const elements = {
    searchSection: makeElement(),
    searchCount: makeElement(),
    searchResults: makeElement(),
    openTabsSection: makeElement(),
    importedSessionSection: makeElement(),
    laterColumn: makeElement(),
    tabOutDupeBanner: makeElement(),
  };

  const previousDocument = global.document;
  global.document = {
    getElementById(id) {
      return elements[id] || null;
    },
  };

  try {
    return fn(elements);
  } finally {
    global.document = previousDocument;
  }
}

function createRenderer(overrides = {}) {
  const i18n = createTestI18n();
  return createDashboardSearchRenderer({
    buildFaviconImg: (domain, className = 'chip-favicon') => `[icon:${className}:${domain || ''}]`,
    buildSearchResultsModel: overrides.buildSearchResultsModel || (() => []),
    checkTabOutDupes: overrides.checkTabOutDupes || (() => {}),
    countLabel: i18n.countLabel,
    escapeHtml: value => String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;'),
    friendlyDomain: value => value,
    getImportedSession: overrides.getImportedSession || (() => null),
    getRealTabs: overrides.getRealTabs || (() => []),
    getSavedTabs: overrides.getSavedTabs || (async () => ({ active: [], archived: [] })),
    getState: overrides.getState || (() => ({ domainGroups: [], importedSession: null })),
    normalizeSearchText: value => String(value || '').trim().toLowerCase(),
    searchImportedSessionTabs: overrides.searchImportedSessionTabs || (() => []),
    searchTextMatches: overrides.searchTextMatches || (() => true),
    t: i18n.t,
  });
}

test('buildSearchResultItem renders source-specific actions', () => {
  const renderer = createRenderer();

  const openHtml = renderer.buildSearchResultItem({
    id: 'open-1',
    tabId: '1',
    title: 'Guide',
    url: 'https://docs.example.com/guide',
    source: 'open',
    sourceLabel: 'Open tab',
    favIconUrl: '',
  });
  assert.match(openHtml, /data-action="focus-tab"/);
  assert.match(openHtml, /data-action="close-single-tab"/);
  assert.match(openHtml, /data-action="defer-single-tab"/);

  const importedHtml = renderer.buildSearchResultItem({
    id: 'imported-1',
    tabId: 'tab-1',
    groupId: 'docs',
    title: 'Guide',
    url: 'https://docs.example.com/guide',
    source: 'imported',
    sourceLabel: 'Imported tab',
    isOpen: true,
  });
  assert.match(importedHtml, />Open<\/button>/);
  assert.match(importedHtml, /data-action="clear-imported-tab"/);

  const laterHtml = renderer.buildSearchResultItem({
    id: 'later-1',
    title: 'Checklist',
    url: 'https://later.example.com/item',
    source: 'later',
    sourceLabel: 'Later list',
    isArchived: false,
  });
  assert.match(laterHtml, /data-action="open-later-item"/);
  assert.match(laterHtml, /data-action="check-later"/);
  assert.match(laterHtml, /data-action="dismiss-later"/);
});

test('renderSearchResults hides overlay for empty query and restores sections', async () => {
  let dupeChecks = 0;
  const renderer = createRenderer({
    checkTabOutDupes: () => {
      dupeChecks += 1;
    },
    getSavedTabs: async () => ({ active: [{ id: 'later-1' }], archived: [] }),
    getState: () => ({
      domainGroups: [{ domain: 'docs.example.com', tabs: [] }],
      importedSession: { groups: [{ id: 'docs', tabs: [{ id: 'tab-1' }] }] },
    }),
  });

  await withMockDocument(async elements => {
    const shown = await renderer.renderSearchResults({ globalSearchQuery: '   ' });
    assert.equal(shown, false);
    assert.equal(elements.searchSection.style.display, 'none');
    assert.equal(elements.openTabsSection.style.display, 'block');
    assert.equal(elements.importedSessionSection.style.display, 'block');
    assert.equal(elements.laterColumn.style.display, 'block');
    assert.equal(dupeChecks, 1);
  });
});

test('renderSearchResults renders matched results and hides other sections', async () => {
  const renderer = createRenderer({
    buildSearchResultsModel: () => ([
      {
        id: 'open-1',
        tabId: '1',
        title: 'Guide',
        url: 'https://docs.example.com/guide',
        source: 'open',
        sourceLabel: 'Open tab',
        favIconUrl: '',
      },
      {
        id: 'later-1',
        title: 'Checklist',
        url: 'https://later.example.com/item',
        source: 'later',
        sourceLabel: 'Later list',
      },
    ]),
    getSavedTabs: async () => ({ active: [], archived: [] }),
    getState: () => ({
      domainGroups: [{ domain: 'docs.example.com', tabs: [] }],
      importedSession: { groups: [{ id: 'docs', tabs: [{ id: 'tab-1' }] }] },
    }),
  });

  await withMockDocument(async elements => {
    const shown = await renderer.renderSearchResults({ globalSearchQuery: 'guide' });
    assert.equal(shown, true);
    assert.equal(elements.searchSection.style.display, 'block');
    assert.equal(elements.searchCount.textContent, '2 results');
    assert.match(elements.searchResults.innerHTML, /Open tab/);
    assert.match(elements.searchResults.innerHTML, /Later list/);
    assert.equal(elements.openTabsSection.style.display, 'none');
    assert.equal(elements.importedSessionSection.style.display, 'none');
    assert.equal(elements.laterColumn.style.display, 'none');
    assert.equal(elements.tabOutDupeBanner.style.display, 'none');
  });
});

test('renderSearchResults shows empty message when query has no matches', async () => {
  const renderer = createRenderer({
    buildSearchResultsModel: () => [],
    getSavedTabs: async () => ({ active: [], archived: [] }),
    getState: () => ({ domainGroups: [], importedSession: null }),
  });

  await withMockDocument(async elements => {
    const shown = await renderer.renderSearchResults({ globalSearchQuery: 'nomatch' });
    assert.equal(shown, true);
    assert.equal(elements.searchCount.textContent, '0 results');
    assert.match(elements.searchResults.innerHTML, /No matching tabs/);
  });
});
