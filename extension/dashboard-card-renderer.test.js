'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createDashboardCardRenderer,
} = require('./dashboard-card-renderer.js');

function createRenderer() {
  return createDashboardCardRenderer({
    buildFaviconImg: (domain, className = 'chip-favicon') => `[icon:${className}:${domain || ''}]`,
    cleanTitle: title => title,
    escapeHtml: value => String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;'),
    friendlyDomain: value => `friendly:${value}`,
    getDomainGroupActionId: group => group.id || `domain-${group.domain.replace(/[^a-z0-9]/g, '-')}`,
    shortTimeAgo: value => (value ? '5m ago' : ''),
    smartTitle: title => title || '',
    stripTitleNoise: title => title || '',
  });
}

test('renderOpenTabsSectionCount shows domain summary and close-all action', () => {
  const renderer = createRenderer();
  const html = renderer.renderOpenTabsSectionCount(2, 9);

  assert.match(html, /2 domains/);
  assert.match(html, /data-action="close-all-open-tabs"/);
  assert.match(html, /Close all 9 tabs/);
});

test('renderOpenTabsSectionCount shows close-all-dupes when duplicate tabs exist', () => {
  const renderer = createRenderer();
  const html = renderer.renderOpenTabsSectionCount(2, 9, 3);

  assert.match(html, /data-action="close-all-dupes"/);
  assert.match(html, /Close all 3 dupes/);
  assert.match(html, /data-action="close-all-open-tabs"/);
});

test('buildOverflowChips renders hidden tabs and overflow trigger', () => {
  const renderer = createRenderer();
  const html = renderer.buildOverflowChips([
    {
      title: 'Docs',
      url: 'https://docs.example.com/guide',
      favIconUrl: '',
      lastAccessed: Date.now(),
    },
    {
      title: 'Guide',
      url: 'https://docs.example.com/guide',
      favIconUrl: '',
      lastAccessed: Date.now(),
    },
  ], {
    'https://docs.example.com/guide': 2,
  });

  assert.match(html, /page-chips-overflow/);
  assert.match(html, /\+2 more/);
  assert.match(html, /\(2x\)/);
  assert.match(html, /data-action="close-tab-url-dupes"/);
});

test('renderDomainCard renders dupes, localhost labels, and domain actions', () => {
  const renderer = createRenderer();
  const html = renderer.renderDomainCard({
    domain: 'localhost',
    tabs: [
      {
        title: 'Project A',
        url: 'http://localhost:3000/app',
        favIconUrl: '',
        lastAccessed: Date.now(),
      },
      {
        title: 'Project A',
        url: 'http://localhost:3000/app',
        favIconUrl: '',
        lastAccessed: Date.now(),
      },
      {
        title: 'Project B',
        url: 'http://localhost:5173/',
        favIconUrl: '',
        lastAccessed: Date.now(),
      },
    ],
  });

  assert.match(html, /friendly:localhost/);
  assert.match(html, /1 duplicate/);
  assert.match(html, /3000 Project A/);
  assert.match(html, /5173 Project B/);
  assert.match(html, /data-action="export-domain-group"/);
  assert.match(html, /data-action="close-domain-tabs"/);
  assert.match(html, /data-action="dedup-keep-one"/);
  assert.match(html, /data-action="close-tab-url-dupes"/);
});

test('renderDomainCard uses Homepages label for landing group', () => {
  const renderer = createRenderer();
  const html = renderer.renderDomainCard({
    domain: '__landing-pages__',
    tabs: [
      {
        title: 'Inbox',
        url: 'https://mail.google.com/mail/u/0/#inbox',
        favIconUrl: '',
        lastAccessed: Date.now(),
      },
    ],
  });

  assert.match(html, />Homepages</);
  assert.match(html, /1 tab open/);
});
