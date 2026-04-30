(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.TabOutCore = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function normalizeText(value) {
    return String(value || '').trim().toLowerCase();
  }

  function isRestorableUrl(url) {
    return /^https?:\/\//i.test(url || '') || /^file:\/\//i.test(url || '');
  }

  function buildCommandItems({ openTabs = [] } = {}) {
    return openTabs.filter(tab => isRestorableUrl(tab.url)).map(tab => ({
      type: 'open-tab',
      title: tab.title || tab.url,
      url: tab.url,
      meta: 'Open tab',
      tabId: tab.id,
      windowId: tab.windowId,
    }));
  }

  function filterCommandItems(items, query) {
    const q = normalizeText(query);
    if (!q) return items.slice(0, 50);

    return items.filter(item => {
      const haystack = normalizeText(`${item.title} ${item.url} ${item.meta}`);
      return haystack.includes(q);
    }).slice(0, 50);
  }

  function createUndoSnapshot(label, tabs) {
    return {
      label,
      createdAt: new Date().toISOString(),
      tabs: (tabs || [])
        .filter(tab => isRestorableUrl(tab.url))
        .map(tab => ({
          title: tab.title || tab.url,
          url: tab.url,
          pinned: !!tab.pinned,
        })),
    };
  }

  return {
    buildCommandItems,
    filterCommandItems,
    createUndoSnapshot,
    isRestorableUrl,
  };
});
