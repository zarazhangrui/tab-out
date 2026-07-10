'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createOpenTabsRuntime,
} = require('./open-tabs-runtime.js');

function createHarness(overrides = {}) {
  const state = {
    domainGroups: overrides.initialDomainGroups || [],
    openTabs: overrides.initialOpenTabs || [],
  };
  const calls = {
    buildDomainGroups: [],
    checkTabOutDupes: 0,
    fetchOpenTabs: 0,
    renderImportedSessionSection: 0,
    renderSearchResults: 0,
    setDomainGroups: [],
    setOpenTabs: [],
  };

  const appState = {
    setDomainGroups(groups) {
      state.domainGroups = groups;
      calls.setDomainGroups.push(groups);
      return groups;
    },
    setOpenTabs(tabs) {
      state.openTabs = tabs;
      calls.setOpenTabs.push(tabs);
      return tabs;
    },
  };

  const runtime = createOpenTabsRuntime({
    appState,
    buildDomainGroups: input => {
      calls.buildDomainGroups.push(input);
      return overrides.nextDomainGroups || [
        { domain: 'docs.example.com', tabs: state.openTabs },
      ];
    },
    checkTabOutDupes: () => {
      calls.checkTabOutDupes += 1;
    },
    fetchOpenTabs: async () => {
      calls.fetchOpenTabs += 1;
      if (overrides.fetchedOpenTabs) {
        state.openTabs = overrides.fetchedOpenTabs;
      }
    },
    getImportedSessionSectionRenderer: () => () => {
      calls.renderImportedSessionSection += 1;
    },
    getRealTabs: () => overrides.realTabs || state.openTabs,
    getRenderDomainCard: () => group => `<article>${group.domain}</article>`,
    getRenderOpenTabsSectionCount: () => (domainCount, realTabCount, totalDuplicateTabs) => {
      return `domains:${domainCount}|tabs:${realTabCount}|dupes:${totalDuplicateTabs}`;
    },
    getSearchQuery: () => overrides.searchQuery || '',
    getState: () => state,
    getTabUrl: tab => tab.url || '',
    renderSearchResults: async () => {
      calls.renderSearchResults += 1;
    },
  });

  return {
    calls,
    runtime,
    state,
  };
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

test('renderOpenTabsSectionFromState rebuilds groups and renders counts', async () => {
  const { runtime, calls } = createHarness({
    initialOpenTabs: [
      { id: 1, url: 'https://docs.example.com/guide' },
      { id: 2, url: 'https://docs.example.com/guide' },
      { id: 3, url: 'https://later.example.com/item' },
    ],
    nextDomainGroups: [
      { domain: 'docs.example.com', tabs: [{ id: 1 }, { id: 2 }] },
      { domain: 'later.example.com', tabs: [{ id: 3 }] },
    ],
  });

  const openTabsSection = { style: { display: 'none' } };
  const openTabsMissions = { innerHTML: '' };
  const openTabsSectionCount = { innerHTML: '' };
  const openTabsSectionTitle = { textContent: '' };
  const statTabs = { textContent: '' };

  await withFakeDocument({
    openTabsSection,
    openTabsMissions,
    openTabsSectionCount,
    openTabsSectionTitle,
    statTabs,
  }, async () => {
    runtime.renderOpenTabsSectionFromState();
  });

  assert.equal(calls.buildDomainGroups.length, 1);
  assert.equal(openTabsSection.style.display, 'block');
  assert.equal(openTabsSectionTitle.textContent, 'Open tabs');
  assert.equal(openTabsSectionCount.innerHTML, 'domains:2|tabs:3|dupes:1');
  assert.match(openTabsMissions.innerHTML, /docs\.example\.com/);
  assert.equal(statTabs.textContent, 3);
  assert.equal(calls.checkTabOutDupes, 1);
  assert.equal(calls.renderImportedSessionSection, 1);
});

test('removeOpenTabOptimistically updates state and refreshes search when active', async () => {
  const { runtime, calls, state } = createHarness({
    initialOpenTabs: [
      { id: 1, url: 'https://docs.example.com/guide' },
      { id: 2, url: 'https://docs.example.com/api' },
    ],
    nextDomainGroups: [{ domain: 'docs.example.com', tabs: [{ id: 2 }] }],
    searchQuery: 'docs',
  });

  await withFakeDocument({
    openTabsSection: { style: {} },
    openTabsMissions: { innerHTML: '' },
    openTabsSectionCount: { innerHTML: '' },
    openTabsSectionTitle: { textContent: '' },
    statTabs: { textContent: '' },
  }, async () => {
    await runtime.removeOpenTabOptimistically({ tabId: 1 });
  });

  assert.equal(state.openTabs.length, 1);
  assert.deepEqual(calls.setOpenTabs[0], [{ id: 2, url: 'https://docs.example.com/api' }]);
  assert.equal(calls.renderSearchResults, 1);
});

test('reconcileOpenTabsFromBrowser refetches tabs and rerenders search when needed', async () => {
  const { runtime, calls, state } = createHarness({
    initialOpenTabs: [{ id: 1, url: 'https://docs.example.com/guide' }],
    fetchedOpenTabs: [{ id: 9, url: 'https://later.example.com/item' }],
    nextDomainGroups: [{ domain: 'later.example.com', tabs: [{ id: 9 }] }],
    searchQuery: 'later',
  });

  await withFakeDocument({
    openTabsSection: { style: {} },
    openTabsMissions: { innerHTML: '' },
    openTabsSectionCount: { innerHTML: '' },
    openTabsSectionTitle: { textContent: '' },
    statTabs: { textContent: '' },
  }, async () => {
    await runtime.reconcileOpenTabsFromBrowser();
  });

  assert.equal(calls.fetchOpenTabs, 1);
  assert.deepEqual(state.openTabs, [{ id: 9, url: 'https://later.example.com/item' }]);
  assert.equal(calls.renderSearchResults, 1);
});
