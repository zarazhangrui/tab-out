'use strict';

const SESSION_FILE_VERSION = 1;

function normalizeId(value) {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

function hashText(value) {
  const text = String(value || '');
  let hash = 5381;

  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) + hash) ^ text.charCodeAt(i);
  }

  return (hash >>> 0).toString(36);
}

function createDerivedId(prefix, seed, index = 0) {
  return `${prefix}-${hashText(`${seed}::${index}`)}`;
}

function sanitizeSessionTab(tab, context = {}) {
  if (!tab || typeof tab.url !== 'string' || !tab.url.trim()) return null;

  const url = tab.url.trim();
  const title = typeof tab.title === 'string' && tab.title.trim() ? tab.title.trim() : url;
  const id = normalizeId(tab.id)
    || normalizeId(tab.tabId)
    || createDerivedId('tab', `${context.groupId || 'group'}::${url}::${title}`, context.index);

  return { id, url, title };
}

function getComparableTabUrl(tab) {
  if (!tab || typeof tab !== 'object') return '';

  if (typeof tab.pendingUrl === 'string' && tab.pendingUrl.trim()) {
    return tab.pendingUrl.trim();
  }

  if (typeof tab.url === 'string' && tab.url.trim()) {
    return tab.url.trim();
  }

  return '';
}

function sanitizeSessionGroup(group, index = 0) {
  if (!group || !Array.isArray(group.tabs)) return null;

  const domain = typeof group.domain === 'string' && group.domain.trim()
    ? group.domain.trim()
    : `imported-group-${index + 1}`;

  const label = typeof group.label === 'string' && group.label.trim()
    ? group.label.trim()
    : domain;

  const id = typeof group.id === 'string' && group.id.trim()
    ? group.id.trim()
    : domain;

  const tabs = group.tabs
    .map((tab, tabIndex) => sanitizeSessionTab(tab, { groupId: id, index: tabIndex }))
    .filter(Boolean);

  if (tabs.length === 0) return null;

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

function dedupeSessionGroups(groups) {
  const safeGroups = Array.isArray(groups)
    ? groups.map((group, index) => sanitizeSessionGroup(group, index)).filter(Boolean)
    : [];

  const seenUrls = new Set();
  const dedupedGroups = [];

  for (const group of safeGroups) {
    const nextTabs = [];

    for (const tab of group.tabs) {
      if (seenUrls.has(tab.url)) continue;
      seenUrls.add(tab.url);
      nextTabs.push(tab);
    }

    if (nextTabs.length === 0) continue;

    dedupedGroups.push({
      ...group,
      tabs: nextTabs,
    });
  }

  return dedupedGroups;
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

function normalizeSearchText(value) {
  return String(value || '').trim().toLowerCase();
}

function searchTextMatches(query, ...parts) {
  const needle = normalizeSearchText(query);
  if (!needle) return true;
  return parts.some(part => normalizeSearchText(part).includes(needle));
}

function searchImportedSessionTabs(session, query) {
  const safeQuery = normalizeSearchText(query);
  if (!safeQuery || !session || !Array.isArray(session.groups)) return [];

  const results = [];

  for (const group of session.groups) {
    const safeGroup = sanitizeSessionGroup(group);
    if (!safeGroup) continue;

    for (const tab of safeGroup.tabs) {
      if (!searchTextMatches(safeQuery, safeGroup.label, safeGroup.domain, tab.title, tab.url)) {
        continue;
      }

      results.push({
        id: tab.id,
        tabId: tab.id,
        groupId: safeGroup.id,
        groupLabel: safeGroup.label,
        groupDomain: safeGroup.domain,
        title: tab.title,
        url: tab.url,
      });
    }
  }

  return results;
}

function planRestoreTabs(groups, openTabs) {
  const openUrlSet = new Set(
    Array.isArray(openTabs)
      ? openTabs
          .map(getComparableTabUrl)
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

function summarizeRestorePlan(groups, openTabs) {
  const plan = planRestoreTabs(groups, openTabs);

  return {
    ...plan,
    hasWork: plan.toOpen.length > 0,
    alreadyOpenCount: plan.skipped.length,
    toOpenCount: plan.toOpen.length,
  };
}

const sessionUtils = {
  SESSION_FILE_VERSION,
  createSessionExport,
  dedupeSessionGroups,
  parseImportedSession,
  searchImportedSessionTabs,
  planRestoreTabs,
  summarizeRestorePlan,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = sessionUtils;
}

if (typeof window !== 'undefined') {
  window.TabOutSessionUtils = sessionUtils;
}
