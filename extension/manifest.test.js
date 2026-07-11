'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const manifest = require('./manifest.json');

test('manifest exposes Chrome favicon endpoint to extension pages', () => {
  assert.equal(manifest.permissions.includes('favicon'), true);
  assert.deepEqual(manifest.web_accessible_resources, [
    {
      resources: ['_favicon/*'],
      matches: ['<all_urls>'],
    },
  ]);
});
