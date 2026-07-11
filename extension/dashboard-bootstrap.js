'use strict';

(function initDashboardBootstrap() {
  const REQUIRED_MODULES = {
    TabOutSessionUtils: [
      'createSessionExport',
      'dedupeSessionGroups',
      'parseImportedSession',
      'searchImportedSessionTabs',
      'planRestoreTabs',
      'summarizeRestorePlan',
    ],
    TabOutTabService: [
      'closeDuplicateTabs',
      'closeTab',
      'closeTabOutDupes',
      'closeTabsByUrls',
      'closeTabsExact',
      'createTab',
      'focusExactTabByUrl',
      'focusTab',
      'focusTabById',
      'getTabUrl',
      'isRealTabUrl',
      'isTabOutTab',
      'moveTabsToCurrentWindow',
      'queryDashboardTabs',
      'queryRawTabs',
    ],
    TabOutSessionStore: ['createSessionStore'],
    TabOutDashboardI18n: ['createDashboardI18n'],
    TabOutDashboardRuntime: ['createRenderScheduler'],
    TabOutDashboardHeaderUi: ['createDashboardHeaderUi'],
    TabOutDashboardStaticText: ['createDashboardStaticTextRenderer'],
    TabOutDashboardEventBindings: ['createDashboardEventBindings'],
    TabOutDashboardLifecycle: ['createDashboardLifecycle'],
    TabOutDashboardRenderFlow: ['createDashboardRenderFlow'],
    TabOutOpenTabsRuntime: ['createOpenTabsRuntime'],
    TabOutAppViewModels: [
      'buildImportedGroupViewModel',
      'buildImportedTabViewModel',
      'buildSearchResultsModel',
    ],
    TabOutDashboardViewUtils: [
      'buildFaviconImg',
      'buildFaviconPlaceholder',
      'buildSessionFilename',
      'cleanTitle',
      'escapeHtml',
      'formatSessionDate',
      'friendlyDomain',
      'getDateDisplay',
      'getDomainGroupActionId',
      'getGreeting',
      'normalizeSearchText',
      'searchTextMatches',
      'shortTimeAgo',
      'smartTitle',
      'stripTitleNoise',
      'timeAgo',
    ],
    TabOutDashboardDomainGroups: ['buildDomainGroups'],
    TabOutDashboardCardRenderer: ['createDashboardCardRenderer'],
    TabOutDashboardSearchRenderer: ['createDashboardSearchRenderer'],
    TabOutDashboardActions: ['createDashboardActions'],
    TabOutDashboardUiEffects: ['createDashboardUiEffects'],
    TabOutAppState: ['createAppState'],
    TabOutOpenTabsController: ['createOpenTabsController'],
    TabOutLaterListController: ['createLaterListController'],
    TabOutImportedSessionController: ['createImportedSessionController'],
    TabOutCustomGroupController: ['createCustomGroupController'],
  };

  function validateDashboardModules(modules) {
    const source = modules || {};
    const missing = [];

    for (const [moduleName, requiredExports] of Object.entries(REQUIRED_MODULES)) {
      const moduleValue = source[moduleName];
      if (!moduleValue || typeof moduleValue !== 'object') {
        missing.push(moduleName);
        continue;
      }

      for (const exportName of requiredExports) {
        if (typeof moduleValue[exportName] !== 'function') {
          missing.push(`${moduleName}.${exportName}`);
        }
      }
    }

    if (missing.length > 0) {
      throw new Error(`Tab Out dashboard failed to start. Missing required modules: ${missing.join(', ')}`);
    }

    return source;
  }

  const dashboardBootstrap = {
    REQUIRED_MODULES,
    validateDashboardModules,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = dashboardBootstrap;
  }

  if (typeof window !== 'undefined') {
    window.TabOutDashboardBootstrap = dashboardBootstrap;
  }
})();
