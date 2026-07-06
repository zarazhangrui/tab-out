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
