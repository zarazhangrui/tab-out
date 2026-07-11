'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildFaviconImg,
  buildSessionFilename,
  cleanTitle,
  escapeHtml,
  friendlyDomain,
  getDomainGroupActionId,
  normalizeSearchText,
  searchTextMatches,
  shortTimeAgo,
  smartTitle,
  stripTitleNoise,
  timeAgo,
} = require('./dashboard-view-utils.js');

test('buildFaviconImg uses a local placeholder when favicon url is absent or blocked', () => {
  const placeholder = buildFaviconImg('docs.example.com', 'chip-favicon', '');
  assert.match(placeholder, /favicon-placeholder/);
  assert.match(placeholder, />D<\/span>/);

  const blocked = buildFaviconImg(
    'docs.example.com',
    'chip-favicon',
    'https://t2.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON'
  );
  assert.match(blocked, /favicon-placeholder/);
  assert.doesNotMatch(blocked, /<img/);
});

test('buildFaviconImg uses Chrome favicon endpoint for page urls', () => {
  const html = buildFaviconImg('docs.example.com', 'chip-favicon', 'https://docs.example.com/guide');
  assert.match(html, /<img class="chip-favicon"/);
  assert.match(html, /\/_favicon\/\?pageUrl=https%3A%2F%2Fdocs\.example\.com%2Fguide&amp;size=32/);
});

test('buildFaviconImg blocks remote native favicon urls', () => {
  const docs = buildFaviconImg('docs.example.com', 'chip-favicon', 'https://docs.example.com/favicon.ico');
  assert.match(docs, /favicon-placeholder/);
  assert.doesNotMatch(docs, /<img/);
  assert.doesNotMatch(docs, /https:\/\/docs\.example\.com\/favicon\.ico/);

  const acm = buildFaviconImg('dl.acm.org', 'chip-favicon', 'https://dl.acm.org/favicon.ico');
  assert.match(acm, /favicon-placeholder/);
  assert.doesNotMatch(acm, /<img/);
  assert.doesNotMatch(acm, /https:\/\/dl\.acm\.org\/favicon\.ico/);
});

test('buildFaviconImg keeps embedded favicon urls', () => {
  const html = buildFaviconImg('docs.example.com', 'chip-favicon', 'data:image/png;base64,abc');
  assert.match(html, /<img class="chip-favicon"/);
  assert.match(html, /data:image\/png;base64,abc/);
});

test('buildSessionFilename uses local timestamp shape and sanitized scope', () => {
  const filename = buildSessionFilename('Imported Session');
  assert.match(filename, /^tab-out-imported-session-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.json$/);
});

test('friendlyDomain maps common hosts and formats unknown domains', () => {
  assert.equal(friendlyDomain('github.com'), 'GitHub');
  assert.equal(friendlyDomain('foo.github.io'), 'Foo (GitHub Pages)');
  assert.equal(friendlyDomain('newsletter.substack.com'), "Newsletter's Substack");
  assert.equal(friendlyDomain('docs.example.dev'), 'Docs Example');
});

test('getDomainGroupActionId prefers stable group ids and keeps domain fallback deterministic', () => {
  assert.equal(
    getDomainGroupActionId({ id: 'group_docs-example-com_1', domain: 'docs.example.com' }),
    'group_docs-example-com_1'
  );
  assert.equal(
    getDomainGroupActionId({ domain: 'docs.example.com' }),
    'domain-docs-example-com'
  );
  assert.notEqual(
    getDomainGroupActionId({ id: 'docs.example.com', domain: 'docs.example.com' }),
    getDomainGroupActionId({ id: 'docs-example-com', domain: 'docs-example-com' })
  );
});

test('stripTitleNoise removes counters, email addresses, and x suffix noise', () => {
  assert.equal(
    stripTitleNoise('(12) Inbox (16,359) - lucas@example.com'),
    'Inbox'
  );
  assert.equal(
    stripTitleNoise('Builder update on X: / X'),
    'Builder update:'
  );
});

test('cleanTitle removes redundant domain suffixes', () => {
  assert.equal(cleanTitle('Agents overview - GitHub', 'github.com'), 'Agents overview');
  assert.equal(cleanTitle('Docs | docs.example.com', 'docs.example.com'), 'Docs');
});

test('smartTitle derives stable labels from well-known url shapes', () => {
  assert.equal(
    smartTitle('', 'https://github.com/openai/gpt-5/pull/42'),
    'openai/gpt-5 PR #42'
  );
  assert.equal(
    smartTitle('https://x.com/someone/status/123', 'https://x.com/someone/status/123'),
    'Post by @someone'
  );
});

test('search helpers normalize text consistently', () => {
  assert.equal(normalizeSearchText('  HeLLo  '), 'hello');
  assert.equal(searchTextMatches('guide', 'API', 'Guide page'), true);
  assert.equal(searchTextMatches('guide', 'API', 'Reference'), false);
});

test('relative time helpers return compact, user-facing labels', () => {
  const now = Date.now();
  assert.equal(shortTimeAgo(now), 'now');
  assert.equal(shortTimeAgo(now - 5 * 60 * 1000), '5m ago');

  const ninetyMinutesAgo = new Date(Date.now() - 90 * 60 * 1000).toISOString();
  assert.equal(timeAgo(ninetyMinutesAgo), '1 hr ago');
});

test('escapeHtml encodes unsafe characters', () => {
  assert.equal(
    escapeHtml('<script>alert("x")</script>'),
    '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;'
  );
});
