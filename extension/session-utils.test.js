'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createSessionExport,
  parseImportedSession,
  searchImportedSessionTabs,
  planRestoreTabs,
  summarizeRestorePlan,
} = require('./session-utils.js');

test('createSessionExport keeps only valid groups and tabs', () => {
  const payload = createSessionExport([
    {
      domain: 'github.com',
      label: 'GitHub',
      tabs: [
        { url: 'https://github.com/openai/gpt-5', title: 'Repo' },
        { url: '   ', title: 'Ignore me' },
      ],
    },
    {
      domain: 'empty.example',
      tabs: [],
    },
  ], { exportedAt: '2026-06-29T00:00:00.000Z' });

  assert.equal(payload.source, 'tab-out');
  assert.equal(payload.groups.length, 1);
  assert.equal(payload.groups[0].id, 'github.com');
  assert.equal(payload.groups[0].domain, 'github.com');
  assert.equal(payload.groups[0].label, 'GitHub');
  assert.equal(payload.groups[0].tabs.length, 1);
  assert.equal(payload.groups[0].tabs[0].url, 'https://github.com/openai/gpt-5');
  assert.equal(payload.groups[0].tabs[0].title, 'Repo');
  assert.match(payload.groups[0].tabs[0].id, /^tab-/);
});

test('parseImportedSession rejects malformed payloads', () => {
  assert.throws(
    () => parseImportedSession('{'),
    /not valid JSON/i
  );

  assert.throws(
    () => parseImportedSession(JSON.stringify({ version: 1 })),
    /groups array/i
  );

  assert.throws(
    () => parseImportedSession(JSON.stringify({ groups: [{ tabs: [] }] })),
    /restorable tabs/i
  );
});

test('parseImportedSession normalizes group metadata and tab titles', () => {
  const parsed = parseImportedSession(JSON.stringify({
    groups: [
      {
        domain: 'docs.example.com',
        tabs: [
          { url: 'https://docs.example.com/page', title: '' },
          { url: 'https://docs.example.com/guide', title: 'Guide' },
        ],
      },
    ],
  }));

  assert.equal(parsed.groups.length, 1);
  assert.equal(parsed.groups[0].id, 'docs.example.com');
  assert.equal(parsed.groups[0].domain, 'docs.example.com');
  assert.equal(parsed.groups[0].label, 'docs.example.com');
  assert.deepEqual(
    parsed.groups[0].tabs.map(tab => ({ url: tab.url, title: tab.title })),
    [
      { url: 'https://docs.example.com/page', title: 'https://docs.example.com/page' },
      { url: 'https://docs.example.com/guide', title: 'Guide' },
    ]
  );
  assert.ok(parsed.groups[0].tabs.every(tab => /^tab-/.test(tab.id)));
});

test('planRestoreTabs skips already open and duplicate queued urls', () => {
  const plan = planRestoreTabs([
    {
      tabs: [
        { url: 'https://a.example.com', title: 'A' },
        { url: 'https://b.example.com', title: 'B' },
      ],
    },
    {
      tabs: [
        { url: 'https://b.example.com', title: 'B duplicate' },
        { url: 'https://c.example.com', title: 'C' },
      ],
    },
  ], [
    { url: 'https://a.example.com' },
  ]);

  assert.deepEqual(plan.toOpen, [
    { id: plan.toOpen[0].id, url: 'https://b.example.com', title: 'B' },
    { id: plan.toOpen[1].id, url: 'https://c.example.com', title: 'C' },
  ]);
  assert.deepEqual(plan.skipped, [
    { id: plan.skipped[0].id, url: 'https://a.example.com', title: 'A' },
    { id: plan.skipped[1].id, url: 'https://b.example.com', title: 'B duplicate' },
  ]);
  assert.ok(plan.toOpen.every(tab => /^tab-/.test(tab.id)));
  assert.ok(plan.skipped.every(tab => /^tab-/.test(tab.id)));
  assert.equal(plan.totalRequested, 4);
});

test('planRestoreTabs treats pendingUrl as already open', () => {
  const plan = planRestoreTabs([
    {
      tabs: [
        { url: 'https://loading.example.com', title: 'Loading' },
        { url: 'https://ready.example.com', title: 'Ready' },
      ],
    },
  ], [
    { pendingUrl: 'https://loading.example.com' },
  ]);

  assert.deepEqual(plan.toOpen, [
    { id: plan.toOpen[0].id, url: 'https://ready.example.com', title: 'Ready' },
  ]);
  assert.deepEqual(plan.skipped, [
    { id: plan.skipped[0].id, url: 'https://loading.example.com', title: 'Loading' },
  ]);
  assert.match(plan.toOpen[0].id, /^tab-/);
  assert.match(plan.skipped[0].id, /^tab-/);
});

test('searchImportedSessionTabs returns concrete imported tab matches', () => {
  const matches = searchImportedSessionTabs({
    groups: [
      {
        id: 'docs',
        label: 'Docs',
        domain: 'docs.example.com',
        tabs: [
          { url: 'https://docs.example.com/guide', title: 'Guide' },
          { url: 'https://docs.example.com/api', title: 'API Reference' },
        ],
      },
    ],
  }, 'api');

  assert.deepEqual(matches, [
    {
      id: matches[0].id,
      tabId: matches[0].tabId,
      groupId: 'docs',
      groupLabel: 'Docs',
      groupDomain: 'docs.example.com',
      title: 'API Reference',
      url: 'https://docs.example.com/api',
    },
  ]);
  assert.equal(matches[0].id, matches[0].tabId);
  assert.match(matches[0].id, /^tab-/);
});

test('searchImportedSessionTabs returns each tab when group metadata matches', () => {
  const matches = searchImportedSessionTabs({
    groups: [
      {
        id: 'research',
        label: 'Research Sprint',
        domain: 'research.example.com',
        tabs: [
          { url: 'https://research.example.com/brief', title: 'Brief' },
          { url: 'https://research.example.com/notes', title: 'Notes' },
        ],
      },
    ],
  }, 'sprint');

  assert.deepEqual(matches.map(item => item.url), [
    'https://research.example.com/brief',
    'https://research.example.com/notes',
  ]);
});

test('searchImportedSessionTabs returns no results for empty query', () => {
  const matches = searchImportedSessionTabs({
    groups: [
      {
        id: 'docs',
        label: 'Docs',
        domain: 'docs.example.com',
        tabs: [
          { url: 'https://docs.example.com/guide', title: 'Guide' },
        ],
      },
    ],
  }, '   ');

  assert.deepEqual(matches, []);
});

test('summarizeRestorePlan exposes confirmation-friendly counts', () => {
  const summary = summarizeRestorePlan([
    {
      tabs: [
        { url: 'https://one.example.com', title: 'One' },
        { url: 'https://two.example.com', title: 'Two' },
      ],
    },
  ], [
    { url: 'https://one.example.com' },
  ]);

  assert.equal(summary.hasWork, true);
  assert.equal(summary.toOpenCount, 1);
  assert.equal(summary.alreadyOpenCount, 1);
  assert.equal(summary.totalRequested, 2);
});
