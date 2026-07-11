'use strict';

function buildSearchResultsModel({
  friendlyDomain,
  importedSession,
  laterActive = [],
  laterArchived = [],
  openTabs = [],
  query,
  searchImportedSessionTabs,
  searchTextMatches,
}) {
  const results = [];
  const openUrlSet = new Set((openTabs || []).map(tab => tab.url).filter(Boolean));

  for (const tab of openTabs || []) {
    if (!searchTextMatches(query, tab.title, tab.url)) continue;
    results.push({
      id: `open-${tab.id}`,
      tabId: String(tab.id),
      title: tab.title,
      url: tab.url,
      favIconUrl: tab.favIconUrl || '',
      source: 'open',
      sourceLabelKey: 'source.open',
      sourceLabel: 'Open tab',
    });
  }

  if (importedSession && Array.isArray(importedSession.groups) && typeof searchImportedSessionTabs === 'function') {
    const importedMatches = searchImportedSessionTabs(importedSession, query);
    for (const match of importedMatches) {
      results.push({
        id: match.tabId,
        tabId: match.tabId,
        groupId: match.groupId,
        title: match.title,
        url: match.url,
        isOpen: openUrlSet.has(match.url),
        source: 'imported',
        sourceLabelKey: 'source.imported',
        sourceLabel: 'Imported tab',
        groupLabel: match.groupLabel || friendlyDomain(match.groupDomain),
      });
    }
  }

  for (const item of [...laterActive, ...laterArchived]) {
    if (!searchTextMatches(query, item.title, item.url)) continue;
    results.push({
      id: item.id,
      title: item.title,
      url: item.url,
      source: 'later',
      isArchived: !!item.completed,
      sourceLabelKey: item.completed ? 'source.laterArchived' : 'source.later',
      sourceLabel: item.completed ? 'Later archived' : 'Later list',
    });
  }

  return results;
}

function buildImportedTabViewModel(tab, groupId, openUrlSet) {
  const url = tab && tab.url ? tab.url : '';
  const title = tab && (tab.title || tab.url) ? (tab.title || tab.url) : '';
  const isOpen = !!(openUrlSet && openUrlSet.has(url));

  return {
    groupId: groupId || '',
    isOpen,
    primaryActionLabel: isOpen ? 'Open' : 'Restore',
    primaryActionTitle: isOpen ? 'Open this tab' : 'Restore this tab',
    statusLabel: isOpen ? 'Opened' : '',
    tabId: tab && tab.id ? tab.id : '',
    title,
    url,
  };
}

function buildImportedGroupViewModel(group, openUrlSet) {
  const tabs = Array.isArray(group && group.tabs) ? group.tabs : [];
  const visibleTabs = tabs.slice(0, 8);
  const hiddenTabs = tabs.slice(8);
  const openedCount = tabs.reduce((count, tab) => count + (openUrlSet.has(tab.url) ? 1 : 0), 0);
  const allOpen = tabs.length > 0 && tabs.every(tab => openUrlSet.has(tab.url));

  return {
    allOpen,
    hiddenTabs,
    openedCount,
    tabCount: tabs.length,
    visibleTabs,
  };
}

const appViewModels = {
  buildImportedGroupViewModel,
  buildImportedTabViewModel,
  buildSearchResultsModel,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = appViewModels;
}

if (typeof window !== 'undefined') {
  window.TabOutAppViewModels = appViewModels;
}
