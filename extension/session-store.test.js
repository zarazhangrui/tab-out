'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

global.window = global.window || {};
require('./session-store.js');

const {
  STORAGE_DEFAULTS,
  createSessionStore,
} = window.TabOutSessionStore;

function createStore() {
  return createSessionStore({
    createStableId: prefix => `${prefix}-1`,
    parseImportedSession: session => session,
  });
}

test('storage defaults include system theme preference', () => {
  assert.equal(STORAGE_DEFAULTS.themePreference, 'system');
});

test('storage defaults disable advanced tab moving', () => {
  assert.equal(STORAGE_DEFAULTS.tabMovingEnabled, false);
});

test('storage defaults use English language preference', () => {
  assert.equal(STORAGE_DEFAULTS.languagePreference, 'en');
});

test('migrateStoredState normalizes theme preference', () => {
  const store = createStore();

  assert.deepEqual(store.migrateStoredState({
    storageSchemaVersion: 1,
    deferred: [],
    importedSession: null,
    languagePreference: 'en',
    autoRefreshEnabled: false,
    tabMovingEnabled: false,
    themePreference: 'dark',
  }), {
    state: {
      storageSchemaVersion: 1,
      deferred: [],
      importedSession: null,
      languagePreference: 'en',
      autoRefreshEnabled: false,
      tabMovingEnabled: false,
      themePreference: 'dark',
    },
    changed: false,
  });

  const missing = store.migrateStoredState({
    storageSchemaVersion: 1,
    deferred: [],
    importedSession: null,
    autoRefreshEnabled: false,
  });
  assert.equal(missing.state.themePreference, 'system');
  assert.equal(missing.changed, true);

  const invalid = store.migrateStoredState({
    storageSchemaVersion: 1,
    deferred: [],
    importedSession: null,
    autoRefreshEnabled: false,
    themePreference: 'sepia',
  });
  assert.equal(invalid.state.themePreference, 'system');
  assert.equal(invalid.changed, true);
});

test('migrateStoredState normalizes advanced tab moving setting', () => {
  const store = createStore();

  const enabled = store.migrateStoredState({
    storageSchemaVersion: 1,
    deferred: [],
    importedSession: null,
    autoRefreshEnabled: false,
    languagePreference: 'en',
    themePreference: 'system',
    tabMovingEnabled: true,
  });
  assert.equal(enabled.state.tabMovingEnabled, true);
  assert.equal(enabled.changed, false);

  const missing = store.migrateStoredState({
    storageSchemaVersion: 1,
    deferred: [],
    importedSession: null,
    autoRefreshEnabled: false,
    themePreference: 'system',
  });
  assert.equal(missing.state.tabMovingEnabled, false);
  assert.equal(missing.changed, true);
});

test('migrateStoredState normalizes language preference', () => {
  const store = createStore();

  const zh = store.migrateStoredState({
    storageSchemaVersion: 1,
    deferred: [],
    importedSession: null,
    autoRefreshEnabled: false,
    languagePreference: 'zh',
    tabMovingEnabled: false,
    themePreference: 'system',
  });
  assert.equal(zh.state.languagePreference, 'zh');
  assert.equal(zh.changed, false);

  const invalid = store.migrateStoredState({
    storageSchemaVersion: 1,
    deferred: [],
    importedSession: null,
    autoRefreshEnabled: false,
    languagePreference: 'fr',
    tabMovingEnabled: false,
    themePreference: 'system',
  });
  assert.equal(invalid.state.languagePreference, 'en');
  assert.equal(invalid.changed, true);
});
