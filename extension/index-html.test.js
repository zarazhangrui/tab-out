'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('later list header uses distinct archive and clear button styles', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

  assert.match(html, /class="action-btn save-tabs" data-action="archive-later-list"/);
  assert.match(html, /class="action-btn close-tabs" data-action="clear-later-list"/);
});

test('archive disclosure chevron points right when collapsed and down when open', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, 'style.css'), 'utf8');

  assert.match(html, /class="archive-chevron"[^>]*>.*d="m8\.25 4\.5 7\.5 7\.5-7\.5 7\.5"/s);
  assert.match(css, /\.archive-toggle\.open \.archive-chevron\s*\{[^}]*transform:\s*rotate\(90deg\);/s);
});

test('search result cards wrap long titles and urls instead of widening the page', () => {
  const css = fs.readFileSync(path.join(__dirname, 'style.css'), 'utf8');

  assert.match(css, /\.search-results\s*\{[^}]*min-width:\s*0;/s);
  assert.match(css, /\.search-card\s*\{[^}]*min-width:\s*0;/s);
  assert.match(css, /\.search-card-title\s*\{[^}]*overflow-wrap:\s*anywhere;/s);
  assert.match(css, /\.search-card-meta\s+span\s*\{[^}]*overflow-wrap:\s*anywhere;/s);
});
