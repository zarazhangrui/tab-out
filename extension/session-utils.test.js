'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createSessionExport,
  parseImportedSession,
  planRestoreTabs,
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
  assert.deepEqual(payload.groups[0], {
    id: 'github.com',
    domain: 'github.com',
    label: 'GitHub',
    tabs: [
      { url: 'https://github.com/openai/gpt-5', title: 'Repo' },
    ],
  });
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
  assert.deepEqual(parsed.groups[0], {
    id: 'docs.example.com',
    domain: 'docs.example.com',
    label: 'docs.example.com',
    tabs: [
      { url: 'https://docs.example.com/page', title: 'https://docs.example.com/page' },
      { url: 'https://docs.example.com/guide', title: 'Guide' },
    ],
  });
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
    { url: 'https://b.example.com', title: 'B' },
    { url: 'https://c.example.com', title: 'C' },
  ]);
  assert.deepEqual(plan.skipped, [
    { url: 'https://a.example.com', title: 'A' },
    { url: 'https://b.example.com', title: 'B duplicate' },
  ]);
  assert.equal(plan.totalRequested, 4);
});
