'use strict';

(function initTabOutSessionStore() {
  const STORAGE_SCHEMA_VERSION = 1;
  const STORAGE_DEFAULTS = {
    autoRefreshEnabled: false,
    deferred: [],
    importedSession: null,
  };

  const storageQueues = new Map();

  function createSessionStore({ createStableId, parseImportedSession }) {
    if (typeof createStableId !== 'function') {
      throw new Error('createStableId is required');
    }

    function normalizeDeferredItems(items) {
      const source = Array.isArray(items) ? items : [];
      let changed = false;

      const normalized = source.map(item => {
        if (!item || typeof item !== 'object') {
          changed = true;
          return {
            id: createStableId('later'),
            url: '',
            title: '',
            savedAt: new Date().toISOString(),
            completed: false,
            dismissed: true,
          };
        }

        if (item.id) return item;
        changed = true;
        return {
          ...item,
          id: createStableId('later'),
        };
      });

      return { items: normalized, changed };
    }

    function migrateStoredState(rawState = {}) {
      const source = rawState && typeof rawState === 'object' ? rawState : {};
      const currentVersion = Number(source.storageSchemaVersion) || 0;
      let changed = currentVersion !== STORAGE_SCHEMA_VERSION;
      const nextState = {
        ...source,
        storageSchemaVersion: STORAGE_SCHEMA_VERSION,
      };

      if (!Array.isArray(nextState.deferred)) {
        nextState.deferred = [];
        changed = true;
      }

      if (typeof nextState.autoRefreshEnabled !== 'boolean') {
        nextState.autoRefreshEnabled = !!nextState.autoRefreshEnabled;
        changed = true;
      }

      if (!('importedSession' in nextState)) {
        nextState.importedSession = null;
        changed = true;
      }

      return { state: nextState, changed };
    }

    function normalizeImportedSessionData(session) {
      if (!session) return { session: null, changed: false };
      if (typeof parseImportedSession !== 'function') return { session, changed: false };

      try {
        const normalized = parseImportedSession(session);
        const changed = JSON.stringify(normalized) !== JSON.stringify(session);
        return { session: normalized, changed };
      } catch {
        return { session: null, changed: true };
      }
    }

    async function getStorageValue(key) {
      const fallback = Object.prototype.hasOwnProperty.call(STORAGE_DEFAULTS, key)
        ? STORAGE_DEFAULTS[key]
        : null;
      const result = await chrome.storage.local.get(key);
      return Object.prototype.hasOwnProperty.call(result, key) ? result[key] : fallback;
    }

    async function setStorageValue(key, value) {
      await chrome.storage.local.set({ [key]: value });
      return value;
    }

    function queueStorageUpdate(key, updater) {
      const previous = storageQueues.get(key) || Promise.resolve();
      const next = previous
        .catch(() => undefined)
        .then(async () => {
          const currentValue = await getStorageValue(key);
          const nextValue = await updater(currentValue);
          if (typeof nextValue === 'undefined') return currentValue;
          await setStorageValue(key, nextValue);
          return nextValue;
        });

      storageQueues.set(key, next);
      return next.finally(() => {
        if (storageQueues.get(key) === next) {
          storageQueues.delete(key);
        }
      });
    }

    async function ensureStorageSchema() {
      const result = await chrome.storage.local.get(Object.keys(STORAGE_DEFAULTS).concat('storageSchemaVersion'));
      const { state, changed } = migrateStoredState(result);
      if (changed) {
        await chrome.storage.local.set(state);
      }
      return state;
    }

    return {
      ensureStorageSchema,
      getStorageValue,
      migrateStoredState,
      normalizeDeferredItems,
      normalizeImportedSessionData,
      queueStorageUpdate,
      setStorageValue,
    };
  }

  window.TabOutSessionStore = {
    STORAGE_SCHEMA_VERSION,
    STORAGE_DEFAULTS,
    createSessionStore,
  };
})();
