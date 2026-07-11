'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildDomainGroups,
  isLandingPage,
} = require('./dashboard-domain-groups.js');

test('isLandingPage matches configured homepage tabs only', () => {
  assert.equal(isLandingPage('https://github.com/'), true);
  assert.equal(isLandingPage('https://www.youtube.com/'), true);
  assert.equal(isLandingPage('https://x.com/home'), true);
  assert.equal(isLandingPage('https://github.com/openai/gpt-5'), false);
  assert.equal(isLandingPage('https://mail.google.com/mail/u/0/#inbox'), true);
  assert.equal(isLandingPage('https://mail.google.com/mail/u/0/#inbox/FMfcgzQbdrA'), false);
});

test('buildDomainGroups groups by hostname and extracts landing pages', () => {
  const tabs = [
    { title: 'GitHub Home', url: 'https://github.com/' },
    { title: 'Repo', url: 'https://github.com/openai/gpt-5' },
    { title: 'Docs', url: 'https://docs.example.com/guide' },
    { title: 'Local', url: 'file:///Users/lucas/Desktop/spec.pdf' },
  ];

  const groups = buildDomainGroups({ tabs });

  assert.deepEqual(
    groups.map(group => group.domain),
    ['__landing-pages__', 'github.com', 'docs.example.com', 'local-files']
  );
  assert.equal(groups[0].tabs.length, 1);
  assert.equal(groups[1].tabs.length, 1);
  assert.equal(groups[2].tabs.length, 1);
  assert.equal(groups[3].tabs.length, 1);
});

test('buildDomainGroups prioritizes landing-related domains before other domains', () => {
  const tabs = [
    { title: 'Doc 1', url: 'https://docs.example.com/1' },
    { title: 'Doc 2', url: 'https://docs.example.com/2' },
    { title: 'LinkedIn Feed', url: 'https://www.linkedin.com/feed/' },
    { title: 'LinkedIn Home', url: 'https://www.linkedin.com/' },
    { title: 'Other', url: 'https://zeta.example.com/' },
  ];

  const groups = buildDomainGroups({ tabs });

  assert.deepEqual(
    groups.map(group => group.domain),
    ['__landing-pages__', 'www.linkedin.com', 'docs.example.com', 'zeta.example.com']
  );
});

test('buildDomainGroups can resolve urls through getTabUrl', () => {
  const tabs = [
    { pendingUrl: 'https://github.com/' },
    { pendingUrl: 'https://docs.example.com/guide' },
  ];

  const groups = buildDomainGroups({
    tabs,
    getTabUrl: tab => tab.pendingUrl || '',
  });

  assert.deepEqual(
    groups.map(group => group.domain),
    ['__landing-pages__', 'docs.example.com']
  );
});

test('buildDomainGroups preserves previous order within the same priority band', () => {
  const previousGroups = [
    { domain: 'docs.example.com', tabs: [{ url: 'https://docs.example.com/1' }] },
    { domain: 'zeta.example.com', tabs: [{ url: 'https://zeta.example.com/1' }] },
    { domain: 'alpha.example.com', tabs: [{ url: 'https://alpha.example.com/1' }] },
  ];

  const tabs = [
    { title: 'Alpha', url: 'https://alpha.example.com/a' },
    { title: 'Alpha 2', url: 'https://alpha.example.com/b' },
    { title: 'Docs', url: 'https://docs.example.com/a' },
    { title: 'Zeta', url: 'https://zeta.example.com/a' },
  ];

  const groups = buildDomainGroups({ tabs, previousGroups });

  assert.deepEqual(
    groups.map(group => group.domain),
    ['docs.example.com', 'zeta.example.com', 'alpha.example.com']
  );
});

test('buildDomainGroups still sorts new groups by tab count when no previous order exists', () => {
  const tabs = [
    { title: 'Alpha 1', url: 'https://alpha.example.com/1' },
    { title: 'Alpha 2', url: 'https://alpha.example.com/2' },
    { title: 'Zeta', url: 'https://zeta.example.com/1' },
    { title: 'Beta', url: 'https://beta.example.com/1' },
  ];

  const groups = buildDomainGroups({ tabs, previousGroups: [] });

  assert.deepEqual(
    groups.map(group => group.domain),
    ['alpha.example.com', 'beta.example.com', 'zeta.example.com']
  );
});

test('buildDomainGroups applies custom hostname rules with exact close metadata', () => {
  const tabs = [
    { title: 'Mail', url: 'https://mail.google.com/mail/u/0/#inbox/FMfcgzQbdrA' },
    { title: 'Docs', url: 'https://docs.google.com/document/d/abc' },
    { title: 'Calendar', url: 'https://calendar.google.com/calendar/u/0/r' },
  ];

  const groups = buildDomainGroups({
    tabs,
    customGroupRules: [
      {
        id: 'google-workspace',
        enabled: true,
        groupKey: 'google-workspace',
        groupLabel: 'Google Workspace',
        hostname: 'mail.google.com',
      },
    ],
  });

  const customGroup = groups.find(group => group.domain === 'google-workspace');
  assert.ok(customGroup);
  assert.equal(customGroup.label, 'Google Workspace');
  assert.equal(customGroup.closeMode, 'exact');
  assert.deepEqual(customGroup.tabs.map(tab => tab.title), ['Mail']);
});

test('buildDomainGroups applies custom hostname suffix rules before default host grouping', () => {
  const tabs = [
    { title: 'Doc', url: 'https://docs.google.com/document/d/abc' },
    { title: 'Sheet', url: 'https://sheets.google.com/spreadsheets/d/abc' },
    { title: 'Example', url: 'https://example.com/' },
  ];

  const groups = buildDomainGroups({
    tabs,
    customGroupRules: [
      {
        id: 'workspace-suite',
        enabled: true,
        groupKey: 'workspace-suite',
        groupLabel: 'Workspace Suite',
        hostnameEndsWith: '.google.com',
      },
    ],
  });

  assert.deepEqual(
    groups.map(group => group.domain),
    ['workspace-suite', 'example.com']
  );
  assert.deepEqual(
    groups.find(group => group.domain === 'workspace-suite').tabs.map(tab => tab.title),
    ['Doc', 'Sheet']
  );
});

test('buildDomainGroups lets custom path prefixes split tabs on the same hostname', () => {
  const tabs = [
    { title: 'Issue', url: 'https://github.com/mrfoolish/tab-out/issues/1' },
    { title: 'Pull request', url: 'https://github.com/mrfoolish/tab-out/pull/2' },
    { title: 'Code', url: 'https://github.com/mrfoolish/tab-out' },
  ];

  const groups = buildDomainGroups({
    tabs,
    customGroupRules: [
      {
        id: 'tab-out-issues',
        enabled: true,
        groupKey: 'tab-out-issues',
        groupLabel: 'Tab Out Issues',
        hostname: 'github.com',
        pathPrefix: '/mrfoolish/tab-out/issues',
      },
      {
        id: 'tab-out-pulls',
        enabled: true,
        groupKey: 'tab-out-pulls',
        groupLabel: 'Tab Out Pull Requests',
        hostname: 'github.com',
        pathPrefix: '/mrfoolish/tab-out/pull',
      },
    ],
  });

  assert.deepEqual(
    groups.map(group => group.domain),
    ['tab-out-issues', 'tab-out-pulls', 'github.com']
  );
  assert.deepEqual(groups.find(group => group.domain === 'tab-out-issues').tabs.map(tab => tab.title), ['Issue']);
  assert.deepEqual(groups.find(group => group.domain === 'tab-out-pulls').tabs.map(tab => tab.title), ['Pull request']);
  assert.deepEqual(groups.find(group => group.domain === 'github.com').tabs.map(tab => tab.title), ['Code']);
});

test('buildDomainGroups ignores disabled or incomplete custom group rules', () => {
  const tabs = [
    { title: 'Docs', url: 'https://docs.google.com/document/d/abc' },
  ];

  const groups = buildDomainGroups({
    tabs,
    customGroupRules: [
      {
        id: 'disabled',
        enabled: false,
        groupKey: 'disabled',
        groupLabel: 'Disabled',
        hostname: 'docs.google.com',
      },
      {
        id: 'missing-match',
        enabled: true,
        groupKey: 'missing-match',
        groupLabel: 'Missing match',
      },
    ],
  });

  assert.deepEqual(groups.map(group => group.domain), ['docs.google.com']);
});
