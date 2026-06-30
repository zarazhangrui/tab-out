'use strict';

const SESSION_FILE_VERSION = 1;

function sanitizeSessionTab(tab) {
  if (!tab || typeof tab.url !== 'string' || !tab.url.trim()) return null;

  const url = tab.url.trim();
  const title = typeof tab.title === 'string' && tab.title.trim() ? tab.title.trim() : url;

  return { url, title };
}

function sanitizeSessionGroup(group, index = 0) {
  if (!group || !Array.isArray(group.tabs)) return null;

  const tabs = group.tabs
    .map(sanitizeSessionTab)
    .filter(Boolean);

  if (tabs.length === 0) return null;

  const domain = typeof group.domain === 'string' && group.domain.trim()
    ? group.domain.trim()
    : `imported-group-${index + 1}`;

  const label = typeof group.label === 'string' && group.label.trim()
    ? group.label.trim()
    : domain;

  const id = typeof group.id === 'string' && group.id.trim()
    ? group.id.trim()
    : domain;

  return { id, label, domain, tabs };
}

function createSessionExport(groups, metadata = {}) {
  const safeGroups = Array.isArray(groups)
    ? groups.map((group, index) => sanitizeSessionGroup(group, index)).filter(Boolean)
    : [];

  return {
    version: SESSION_FILE_VERSION,
    source: 'tab-out',
    exportedAt: metadata.exportedAt || new Date().toISOString(),
    groups: safeGroups,
  };
}

function parseImportedSession(raw) {
  let payload;

  if (typeof raw === 'string') {
    try {
      payload = JSON.parse(raw);
    } catch (err) {
      throw new Error('Import file is not valid JSON.');
    }
  } else {
    payload = raw;
  }

  if (!payload || typeof payload !== 'object') {
    throw new Error('Import file is empty or malformed.');
  }

  if (!Array.isArray(payload.groups)) {
    throw new Error('Import file must contain a groups array.');
  }

  const groups = payload.groups
    .map((group, index) => sanitizeSessionGroup(group, index))
    .filter(Boolean);

  if (groups.length === 0) {
    throw new Error('Import file does not contain any restorable tabs.');
  }

  return {
    version: typeof payload.version === 'number' ? payload.version : SESSION_FILE_VERSION,
    source: typeof payload.source === 'string' && payload.source.trim() ? payload.source.trim() : 'tab-out',
    exportedAt: typeof payload.exportedAt === 'string' && payload.exportedAt.trim()
      ? payload.exportedAt
      : new Date().toISOString(),
    groups,
  };
}

function planRestoreTabs(groups, openTabs) {
  const openUrlSet = new Set(
    Array.isArray(openTabs)
      ? openTabs
          .map(tab => (tab && typeof tab.url === 'string' ? tab.url.trim() : ''))
          .filter(Boolean)
      : []
  );

  const toOpen = [];
  const skipped = [];
  const seenQueued = new Set();

  const safeGroups = Array.isArray(groups) ? groups : [];

  for (const group of safeGroups) {
    const tabs = Array.isArray(group && group.tabs) ? group.tabs : [];

    for (const tab of tabs) {
      const safeTab = sanitizeSessionTab(tab);
      if (!safeTab) continue;

      if (openUrlSet.has(safeTab.url) || seenQueued.has(safeTab.url)) {
        skipped.push(safeTab);
        continue;
      }

      seenQueued.add(safeTab.url);
      toOpen.push(safeTab);
    }
  }

  return {
    toOpen,
    skipped,
    totalRequested: toOpen.length + skipped.length,
  };
}

const sessionUtils = {
  SESSION_FILE_VERSION,
  createSessionExport,
  parseImportedSession,
  planRestoreTabs,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = sessionUtils;
}

if (typeof window !== 'undefined') {
  window.TabOutSessionUtils = sessionUtils;
}
