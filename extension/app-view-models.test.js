'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildImportedGroupViewModel,
  buildImportedTabViewModel,
  buildSearchResultsModel,
} = require('./app-view-models.js');

function searchTextMatches(query, ...parts) {
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return true;
  return parts.some(part => String(part || '').trim().toLowerCase().includes(needle));
}

test('buildSearchResultsModel keeps imported tab metadata and open state', () => {
  const results = buildSearchResultsModel({
    friendlyDomain: value => value,
    importedSession: {
      groups: [{ id: 'docs', label: 'Docs', domain: 'docs.example.com', tabs: [] }],
    },
    laterActive: [],
    laterArchived: [],
    openTabs: [
      { id: 1, title: 'Guide', url: 'https://docs.example.com/guide' },
      { id: 2, title: 'Inbox', url: 'https://mail.example.com' },
    ],
    query: 'guide',
    searchImportedSessionTabs: () => [{
      tabId: 'tab-1',
      groupId: 'docs',
      groupLabel: 'Docs',
      groupDomain: 'docs.example.com',
      title: 'Guide',
      url: 'https://docs.example.com/guide',
    }],
    searchTextMatches,
  });

  assert.deepEqual(results, [
    {
      id: 'open-1',
      tabId: '1',
      title: 'Guide',
      url: 'https://docs.example.com/guide',
      favIconUrl: '',
      source: 'open',
      sourceLabel: 'Open tab',
    },
    {
      id: 'tab-1',
      tabId: 'tab-1',
      groupId: 'docs',
      title: 'Guide',
      url: 'https://docs.example.com/guide',
      isOpen: true,
      source: 'imported',
      sourceLabel: 'Imported tab',
      groupLabel: 'Docs',
    },
  ]);
});

test('buildImportedTabViewModel switches primary action by open state', () => {
  const openSet = new Set(['https://docs.example.com/guide']);

  assert.deepEqual(
    buildImportedTabViewModel({ id: 'tab-1', title: 'Guide', url: 'https://docs.example.com/guide' }, 'docs', openSet),
    {
      groupId: 'docs',
      isOpen: true,
      primaryActionLabel: 'Open',
      primaryActionTitle: 'Open this tab',
      statusLabel: 'Opened',
      tabId: 'tab-1',
      title: 'Guide',
      url: 'https://docs.example.com/guide',
    }
  );

  assert.deepEqual(
    buildImportedTabViewModel({ id: 'tab-2', title: 'API', url: 'https://docs.example.com/api' }, 'docs', openSet),
    {
      groupId: 'docs',
      isOpen: false,
      primaryActionLabel: 'Restore',
      primaryActionTitle: 'Restore this tab',
      statusLabel: '',
      tabId: 'tab-2',
      title: 'API',
      url: 'https://docs.example.com/api',
    }
  );
});

test('buildImportedGroupViewModel tracks visible and hidden tabs', () => {
  const tabs = Array.from({ length: 10 }, (_, index) => ({
    id: `tab-${index + 1}`,
    title: `Tab ${index + 1}`,
    url: `https://example.com/${index + 1}`,
  }));

  const result = buildImportedGroupViewModel({ tabs }, new Set(tabs.slice(0, 9).map(tab => tab.url)));

  assert.equal(result.tabCount, 10);
  assert.equal(result.visibleTabs.length, 8);
  assert.equal(result.hiddenTabs.length, 2);
  assert.equal(result.openedCount, 9);
  assert.equal(result.allOpen, false);
});
