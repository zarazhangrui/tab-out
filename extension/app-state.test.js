'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

global.window = global.window || {};
require('./app-state.js');

const {
  createAppState,
} = window.TabOutAppState;

test('createAppState owns shared dashboard data without a duplicate ui state branch', () => {
  const appState = createAppState();
  const state = appState.getState();

  assert.deepEqual(Object.keys(state).sort(), [
    'deferredItemsCache',
    'domainGroups',
    'importedSession',
    'openTabs',
  ]);
  assert.equal('ui' in state, false);
});

test('createAppState updates dashboard data through focused setters', () => {
  const appState = createAppState();

  assert.deepEqual(appState.setOpenTabs([{ id: 1 }]), [{ id: 1 }]);
  assert.deepEqual(appState.setDomainGroups([{ domain: 'docs.example.com' }]), [{ domain: 'docs.example.com' }]);
  assert.deepEqual(appState.setDeferredItemsCache([{ id: 'later-1' }]), [{ id: 'later-1' }]);
  assert.deepEqual(appState.setImportedSession({ groups: [] }), { groups: [] });

  assert.deepEqual(appState.getState(), {
    openTabs: [{ id: 1 }],
    importedSession: { groups: [] },
    domainGroups: [{ domain: 'docs.example.com' }],
    deferredItemsCache: [{ id: 'later-1' }],
  });
});
