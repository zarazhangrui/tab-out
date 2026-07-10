'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createDashboardRenderFlow,
} = require('./dashboard-render-flow.js');

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

test('renderStaticDashboard renders sections in order', async () => {
  const calls = [];
  const flow = createDashboardRenderFlow({
    fetchOpenTabs: async () => { calls.push('fetchOpenTabs'); },
    getDateDisplay: () => 'Friday',
    getGreeting: () => 'Good afternoon',
    getImportedSession: async () => { calls.push('getImportedSession'); },
    getSearchQuery: () => 'docs',
    renderAutoRefreshToggle: () => { calls.push('renderAutoRefreshToggle'); },
    renderImportedSessionSection: () => { calls.push('renderImportedSessionSection'); },
    renderLaterListColumn: async () => { calls.push('renderLaterListColumn'); },
    renderMoreMenu: () => { calls.push('renderMoreMenu'); },
    renderOpenTabsSectionFromState: options => { calls.push(['renderOpenTabsSectionFromState', options]); },
    renderSearchResults: async ctx => { calls.push(['renderSearchResults', ctx]); },
  });

  const greeting = { textContent: '' };
  const dateDisplay = { textContent: '' };
  const searchInput = { value: '' };

  await withFakeDocument({
    greeting,
    dateDisplay,
    globalSearchInput: searchInput,
  }, async () => {
    const result = await flow.renderStaticDashboard({ requestId: 1 });
    assert.equal(result, true);
  });

  assert.equal(greeting.textContent, 'Good afternoon');
  assert.equal(dateDisplay.textContent, 'Friday');
  assert.equal(searchInput.value, 'docs');
  assert.deepEqual(calls, [
    'renderAutoRefreshToggle',
    'renderMoreMenu',
    'fetchOpenTabs',
    ['renderOpenTabsSectionFromState', { includeImportedSection: false }],
    'getImportedSession',
    'renderImportedSessionSection',
    'renderLaterListColumn',
    ['renderSearchResults', { requestId: 1 }],
  ]);
});

test('renderStaticDashboard stops early when render becomes stale', async () => {
  const calls = [];
  let stale = false;
  const flow = createDashboardRenderFlow({
    fetchOpenTabs: async () => {
      calls.push('fetchOpenTabs');
      stale = true;
    },
    getDateDisplay: () => 'Friday',
    getGreeting: () => 'Good afternoon',
    getImportedSession: async () => { calls.push('getImportedSession'); },
    getSearchQuery: () => '',
    renderAutoRefreshToggle: () => { calls.push('renderAutoRefreshToggle'); },
    renderImportedSessionSection: () => { calls.push('renderImportedSessionSection'); },
    renderLaterListColumn: async () => { calls.push('renderLaterListColumn'); },
    renderMoreMenu: () => { calls.push('renderMoreMenu'); },
    renderOpenTabsSectionFromState: options => { calls.push(['renderOpenTabsSectionFromState', options]); },
    renderSearchResults: async () => { calls.push('renderSearchResults'); },
  });

  await withFakeDocument({
    greeting: { textContent: '' },
    dateDisplay: { textContent: '' },
    globalSearchInput: { value: '' },
  }, async () => {
    const result = await flow.renderStaticDashboard({
      isStale: () => stale,
    });
    assert.equal(result, false);
  });

  assert.deepEqual(calls, [
    'renderAutoRefreshToggle',
    'renderMoreMenu',
    'fetchOpenTabs',
  ]);
});
