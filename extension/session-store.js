'use strict';

(function initTabOutSessionStore() {
  const STORAGE_SCHEMA_VERSION = 1;
  const STORAGE_DEFAULTS = {
    autoRefreshEnabled: false,
    customGroupRules: [],
    deferred: [],
    importedSession: null,
    languagePreference: 'en',
    tabMovingEnabled: false,
    themePreference: 'system',
  };
  const VALID_THEME_PREFERENCES = new Set(['system', 'light', 'dark']);
  const VALID_LANGUAGE_PREFERENCES = new Set(['en', 'zh']);

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

    function normalizeHostname(value) {
      return String(value || '').trim().toLowerCase();
    }

    function normalizePathPrefix(value) {
      const trimmed = String(value || '').trim();
      if (!trimmed) return '';
      return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
    }

    function normalizeCustomGroupRules(rules) {
      const source = Array.isArray(rules) ? rules : [];
      let changed = !Array.isArray(rules);
      const normalized = [];

      source.forEach(rule => {
        if (!rule || typeof rule !== 'object') {
          changed = true;
          return;
        }

        const nextRule = {
          id: String(rule.id || '').trim() || createStableId('custom-group'),
          enabled: rule.enabled !== false,
          groupKey: String(rule.groupKey || '').trim(),
          groupLabel: String(rule.groupLabel || '').trim(),
          hostname: normalizeHostname(rule.hostname),
          hostnameEndsWith: normalizeHostname(rule.hostnameEndsWith),
          pathPrefix: normalizePathPrefix(rule.pathPrefix),
        };

        if (!nextRule.groupKey || !nextRule.groupLabel || (!nextRule.hostname && !nextRule.hostnameEndsWith)) {
          changed = true;
          return;
        }

        normalized.push(nextRule);

        const expected = {
          id: String(rule.id || '').trim() || nextRule.id,
          enabled: rule.enabled !== false,
          groupKey: String(rule.groupKey || '').trim(),
          groupLabel: String(rule.groupLabel || '').trim(),
          hostname: normalizeHostname(rule.hostname),
          hostnameEndsWith: normalizeHostname(rule.hostnameEndsWith),
          pathPrefix: normalizePathPrefix(rule.pathPrefix),
        };
        if (
          !rule.id ||
          JSON.stringify(expected) !== JSON.stringify({
            id: rule.id,
            enabled: Object.prototype.hasOwnProperty.call(rule, 'enabled') ? rule.enabled : true,
            groupKey: rule.groupKey,
            groupLabel: rule.groupLabel,
            hostname: rule.hostname || '',
            hostnameEndsWith: rule.hostnameEndsWith || '',
            pathPrefix: rule.pathPrefix || '',
          })
        ) {
          changed = true;
        }
      });

      if (normalized.length !== source.filter(rule => rule && typeof rule === 'object').length) {
        changed = true;
      }

      return { rules: normalized, changed };
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

      if (!VALID_THEME_PREFERENCES.has(nextState.themePreference)) {
        nextState.themePreference = STORAGE_DEFAULTS.themePreference;
        changed = true;
      }

      if (!VALID_LANGUAGE_PREFERENCES.has(nextState.languagePreference)) {
        nextState.languagePreference = STORAGE_DEFAULTS.languagePreference;
        changed = true;
      }

      if (typeof nextState.tabMovingEnabled !== 'boolean') {
        nextState.tabMovingEnabled = !!nextState.tabMovingEnabled;
        changed = true;
      }

      const customGroupRulesResult = normalizeCustomGroupRules(nextState.customGroupRules);
      nextState.customGroupRules = customGroupRulesResult.rules;
      if (customGroupRulesResult.changed) {
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
      normalizeCustomGroupRules,
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
