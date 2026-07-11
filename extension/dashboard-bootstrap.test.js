'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  validateDashboardModules,
} = require('./dashboard-bootstrap.js');

test('validateDashboardModules reports missing required globals and factories', () => {
  assert.throws(
    () => validateDashboardModules({
      TabOutSessionUtils: {},
      TabOutTabService: {
        closeTab: () => {},
      },
    }),
    err => {
      assert.match(err.message, /Tab Out dashboard failed to start/);
      assert.match(err.message, /TabOutSessionUtils\.createSessionExport/);
      assert.match(err.message, /TabOutDashboardRenderFlow/);
      assert.match(err.message, /TabOutTabService\.queryDashboardTabs/);
      return true;
    }
  );
});

test('validateDashboardModules accepts the dashboard module surface used by app.js', () => {
  const fn = () => {};
  assert.doesNotThrow(() => validateDashboardModules({
    TabOutSessionUtils: {
      createSessionExport: fn,
      dedupeSessionGroups: fn,
      parseImportedSession: fn,
      searchImportedSessionTabs: fn,
      planRestoreTabs: fn,
      summarizeRestorePlan: fn,
    },
    TabOutTabService: {
      closeDuplicateTabs: fn,
      closeTab: fn,
      closeTabOutDupes: fn,
      closeTabsByUrls: fn,
      closeTabsExact: fn,
      createTab: fn,
      focusExactTabByUrl: fn,
      focusTab: fn,
      focusTabById: fn,
      getTabUrl: fn,
      isRealTabUrl: fn,
      isTabOutTab: fn,
      moveTabsToCurrentWindow: fn,
      queryDashboardTabs: fn,
      queryRawTabs: fn,
    },
    TabOutSessionStore: { createSessionStore: fn },
    TabOutDashboardI18n: { createDashboardI18n: fn },
    TabOutDashboardRuntime: { createRenderScheduler: fn },
    TabOutDashboardHeaderUi: { createDashboardHeaderUi: fn },
    TabOutDashboardEventBindings: { createDashboardEventBindings: fn },
    TabOutDashboardLifecycle: { createDashboardLifecycle: fn },
    TabOutDashboardRenderFlow: { createDashboardRenderFlow: fn },
    TabOutOpenTabsRuntime: { createOpenTabsRuntime: fn },
    TabOutAppViewModels: {
      buildImportedGroupViewModel: fn,
      buildImportedTabViewModel: fn,
      buildSearchResultsModel: fn,
    },
    TabOutDashboardViewUtils: {
      buildFaviconImg: fn,
      buildSessionFilename: fn,
      cleanTitle: fn,
      escapeHtml: fn,
      formatSessionDate: fn,
      friendlyDomain: fn,
      getDateDisplay: fn,
      getDomainGroupActionId: fn,
      getGreeting: fn,
      normalizeSearchText: fn,
      searchTextMatches: fn,
      shortTimeAgo: fn,
      smartTitle: fn,
      stripTitleNoise: fn,
      timeAgo: fn,
    },
    TabOutDashboardDomainGroups: { buildDomainGroups: fn },
    TabOutDashboardCardRenderer: { createDashboardCardRenderer: fn },
    TabOutDashboardSearchRenderer: { createDashboardSearchRenderer: fn },
    TabOutDashboardActions: { createDashboardActions: fn },
    TabOutDashboardUiEffects: { createDashboardUiEffects: fn },
    TabOutAppState: { createAppState: fn },
    TabOutOpenTabsController: { createOpenTabsController: fn },
    TabOutLaterListController: { createLaterListController: fn },
    TabOutImportedSessionController: { createImportedSessionController: fn },
  }));
});
