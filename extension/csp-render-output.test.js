'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildFaviconImg,
  cleanTitle,
  escapeHtml,
  friendlyDomain,
  getDomainGroupActionId,
  shortTimeAgo,
  smartTitle,
  stripTitleNoise,
} = require('./dashboard-view-utils.js');
const {
  createDashboardCardRenderer,
} = require('./dashboard-card-renderer.js');
const {
  createDashboardSearchRenderer,
} = require('./dashboard-search-renderer.js');

function assertCspSafeHtml(html) {
  assert.doesNotMatch(html, /\son[a-z]+\s*=/i);
  assert.doesNotMatch(html, /javascript:/i);
}

test('buildFaviconImg never emits inline event handlers for favicons', () => {
  assertCspSafeHtml(buildFaviconImg(
    'docs.example.com',
    'chip-favicon',
    'https://docs.example.com/favicon.ico'
  ));
  assertCspSafeHtml(buildFaviconImg(
    'docs.example.com',
    'chip-favicon',
    'https://t2.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON'
  ));
});

test('domain card renderer emits CSP-safe HTML', () => {
  const renderer = createDashboardCardRenderer({
    buildFaviconImg,
    cleanTitle,
    escapeHtml,
    friendlyDomain,
    getDomainGroupActionId,
    shortTimeAgo,
    smartTitle,
    stripTitleNoise,
  });

  const html = renderer.renderDomainCard({
    domain: 'docs.example.com',
    tabs: [
      {
        id: 1,
        favIconUrl: 'https://docs.example.com/favicon.ico',
        lastAccessed: Date.now(),
        title: 'Docs',
        url: 'https://docs.example.com/guide',
      },
    ],
  });

  assertCspSafeHtml(html);
  assert.match(html, /https:\/\/docs\.example\.com\/favicon\.ico/);
  assert.match(html, /data-favicon-domain="docs.example.com"/);
  assert.match(html, /data-favicon-class="chip-favicon"/);
});

test('search renderer emits CSP-safe result HTML', async () => {
  const elements = {
    searchSection: { style: {} },
    searchCount: { textContent: '' },
    searchResults: { innerHTML: '' },
    openTabsSection: { style: {} },
    importedSessionSection: { style: {} },
    laterColumn: { style: {} },
    tabOutDupeBanner: { style: {} },
  };
  const previousDocument = global.document;
  global.document = {
    getElementById(id) {
      return elements[id] || null;
    },
  };

  try {
    const renderer = createDashboardSearchRenderer({
      buildFaviconImg,
      buildSearchResultsModel: () => [
        {
          favIconUrl: 'https://docs.example.com/favicon.ico',
          id: 'open-1',
          source: 'open',
          sourceLabel: 'Open tab',
          tabId: '1',
          title: 'Docs',
          url: 'https://docs.example.com/guide',
        },
      ],
      checkTabOutDupes: () => {},
      escapeHtml,
      friendlyDomain,
      getImportedSession: () => null,
      getRealTabs: () => [],
      getSavedTabs: async () => ({ active: [], archived: [] }),
      getState: () => ({ domainGroups: [], importedSession: null }),
      normalizeSearchText: value => String(value || '').trim().toLowerCase(),
      searchImportedSessionTabs: () => [],
      searchTextMatches: () => true,
    });

    await renderer.renderSearchResults({ globalSearchQuery: 'docs' });
    assertCspSafeHtml(elements.searchResults.innerHTML);
  } finally {
    global.document = previousDocument;
  }
});

test('imported session parser removes script-like URLs before rendering', () => {
  const {
    parseImportedSession,
  } = require('./session-utils.js');

  const parsed = parseImportedSession(JSON.stringify({
    groups: [
      {
        domain: 'mixed.example.com',
        tabs: [
          { title: 'Script', url: 'javascript:alert(1)' },
          { title: 'Data', url: 'data:text/html,<script>alert(1)</script>' },
          { title: 'Guide', url: 'https://docs.example.com/guide' },
        ],
      },
    ],
  }));

  assert.deepEqual(parsed.groups[0].tabs.map(tab => tab.url), [
    'https://docs.example.com/guide',
  ]);
});
