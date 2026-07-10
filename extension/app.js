/* ================================================================
   Tab Out — Dashboard App (Pure Extension Edition)

   This file is the brain of the dashboard. Now that the dashboard
   IS the extension page (not inside an iframe), it can call
   chrome.tabs and chrome.storage directly — no postMessage bridge needed.

   What this file does:
   1. Reads open browser tabs directly via chrome.tabs.query()
   2. Groups tabs by domain with a landing pages category
   3. Renders domain cards, banners, and stats
   4. Handles all user actions (close tabs, save for later, focus tab)
   5. Stores "Saved for Later" tabs in chrome.storage.local (no server)
   ================================================================ */

'use strict';

const {
  createSessionExport: sessionCreateSessionExport,
  dedupeSessionGroups: sessionDedupeSessionGroups,
  parseImportedSession: sessionParseImportedSession,
  searchImportedSessionTabs: sessionSearchImportedSessionTabs,
  planRestoreTabs: sessionPlanRestoreTabs,
  summarizeRestorePlan: sessionSummarizeRestorePlan,
} = window.TabOutSessionUtils || {};
const {
  closeDuplicateTabs: closeDuplicateTabsInChrome,
  closeTab: closeOpenTabInChrome,
  closeTabOutDupes: closeTabOutDupesInChrome,
  closeTabsByUrls: closeTabsByUrlsInChrome,
  closeTabsExact: closeTabsExactInChrome,
  createTab: createTabInChrome,
  focusExactTabByUrl: focusExactTabByUrlInChrome,
  focusTab: focusTabInChrome,
  focusTabById: focusTabByIdInChrome,
  getTabUrl,
  isRealTabUrl,
  isTabOutTab,
  queryDashboardTabs,
  queryRawTabs,
} = window.TabOutTabService || {};
const { createSessionStore } = window.TabOutSessionStore || {};
const { createRenderScheduler: createRenderSchedulerFromModule } = window.TabOutDashboardRuntime || {};
const { createDashboardHeaderUi } = window.TabOutDashboardHeaderUi || {};
const { createDashboardEventBindings } = window.TabOutDashboardEventBindings || {};
const { createDashboardLifecycle } = window.TabOutDashboardLifecycle || {};
const { createOpenTabsRuntime } = window.TabOutOpenTabsRuntime || {};
const {
  buildImportedGroupViewModel: buildImportedGroupViewModelFromModule,
  buildImportedTabViewModel: buildImportedTabViewModelFromModule,
  buildSearchResultsModel: buildSearchResultsModelFromModule,
} = window.TabOutAppViewModels || {};
const {
  buildFaviconImg,
  buildSessionFilename,
  cleanTitle,
  escapeHtml,
  formatSessionDate,
  friendlyDomain: friendlyDomainLabel,
  getDateDisplay: getDashboardDateDisplay,
  getGreeting: getDashboardGreeting,
  normalizeSearchText: normalizeDashboardSearchText,
  searchTextMatches: searchDashboardTextMatches,
  shortTimeAgo: formatShortTimeAgo,
  smartTitle,
  stripTitleNoise,
  timeAgo: formatTimeAgo,
} = window.TabOutDashboardViewUtils || {};
const { buildDomainGroups: buildDashboardDomainGroups } = window.TabOutDashboardDomainGroups || {};
const { createDashboardCardRenderer } = window.TabOutDashboardCardRenderer || {};
const { createDashboardSearchRenderer } = window.TabOutDashboardSearchRenderer || {};
const { createDashboardActions } = window.TabOutDashboardActions || {};
const { createDashboardUiEffects } = window.TabOutDashboardUiEffects || {};
const { createAppState } = window.TabOutAppState || {};
const { createOpenTabsController } = window.TabOutOpenTabsController || {};
const { createLaterListController } = window.TabOutLaterListController || {};
const { createImportedSessionController } = window.TabOutImportedSessionController || {};

let dashboardRefreshTimer = null;
let autoRefreshEnabled = false;
let globalSearchQuery = '';
let searchDebounceTimer = null;
let moreMenuOpen = false;
let latestDashboardRenderPromise = Promise.resolve();
let latestSearchRenderPromise = Promise.resolve(false);
const suppressedRemovedTabIds = new Set();

function createStableId(prefix = 'item') {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

const sessionStore = typeof createSessionStore === 'function'
  ? createSessionStore({
      createStableId,
      parseImportedSession: sessionParseImportedSession,
    })
  : null;
const getStorageValue = sessionStore && typeof sessionStore.getStorageValue === 'function'
  ? sessionStore.getStorageValue
  : async key => {
      const fallback = key === 'deferred'
        ? []
        : key === 'autoRefreshEnabled'
          ? false
          : null;
      const result = await chrome.storage.local.get(key);
      return Object.prototype.hasOwnProperty.call(result, key) ? result[key] : fallback;
    };
const normalizeDeferredItems = sessionStore && typeof sessionStore.normalizeDeferredItems === 'function'
  ? sessionStore.normalizeDeferredItems
  : items => {
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
    };
const normalizeImportedSessionData = sessionStore && typeof sessionStore.normalizeImportedSessionData === 'function'
  ? sessionStore.normalizeImportedSessionData
  : session => {
      if (!session) return { session: null, changed: false };
      if (typeof sessionParseImportedSession !== 'function') return { session, changed: false };
      try {
        const normalized = sessionParseImportedSession(session);
        return {
          session: normalized,
          changed: JSON.stringify(normalized) !== JSON.stringify(session),
        };
      } catch {
        return { session: null, changed: true };
      }
    };
const setStorageValue = sessionStore && typeof sessionStore.setStorageValue === 'function'
  ? sessionStore.setStorageValue
  : async (key, value) => {
      await chrome.storage.local.set({ [key]: value });
      return value;
    };
const queueStorageUpdate = sessionStore && typeof sessionStore.queueStorageUpdate === 'function'
  ? sessionStore.queueStorageUpdate
  : async (key, updater) => {
      const currentValue = await getStorageValue(key);
      const nextValue = await updater(currentValue);
      if (typeof nextValue === 'undefined') return currentValue;
      await setStorageValue(key, nextValue);
      return nextValue;
    };
const ensureStorageSchema = sessionStore && typeof sessionStore.ensureStorageSchema === 'function'
  ? sessionStore.ensureStorageSchema
  : async () => {
      const state = {
        autoRefreshEnabled: !!(await getStorageValue('autoRefreshEnabled')),
        deferred: (await getStorageValue('deferred')) || [],
        importedSession: (await getStorageValue('importedSession')) || null,
      };
      await chrome.storage.local.set({
        ...state,
        storageSchemaVersion: 1,
      });
      return state;
    };
const fallbackAppState = {
  openTabs: [],
  importedSession: null,
  domainGroups: [],
  deferredItemsCache: [],
  ui: {},
};
const appState = typeof createAppState === 'function'
  ? createAppState()
  : {
      getState: () => fallbackAppState,
      setOpenTabs: tabs => {
        fallbackAppState.openTabs = Array.isArray(tabs) ? tabs : [];
        return fallbackAppState.openTabs;
      },
      setImportedSession: session => {
        fallbackAppState.importedSession = session || null;
        return fallbackAppState.importedSession;
      },
      setDomainGroups: groups => {
        fallbackAppState.domainGroups = Array.isArray(groups) ? groups : [];
        return fallbackAppState.domainGroups;
      },
      setDeferredItemsCache: items => {
        fallbackAppState.deferredItemsCache = Array.isArray(items) ? items : [];
        return fallbackAppState.deferredItemsCache;
      },
      setUiState: patch => Object.assign(fallbackAppState.ui, patch || {}),
    };
const state = appState.getState();
const dashboardUiEffects = typeof createDashboardUiEffects === 'function'
  ? createDashboardUiEffects({
      onCardRemoved: checkAndShowEmptyState,
    })
  : null;
const playCloseSound = dashboardUiEffects && typeof dashboardUiEffects.playCloseSound === 'function'
  ? dashboardUiEffects.playCloseSound
  : () => {};
const animateCardOut = dashboardUiEffects && typeof dashboardUiEffects.animateCardOut === 'function'
  ? dashboardUiEffects.animateCardOut
  : () => {};
const shootConfetti = dashboardUiEffects && typeof dashboardUiEffects.shootConfetti === 'function'
  ? dashboardUiEffects.shootConfetti
  : () => {};
const showToast = dashboardUiEffects && typeof dashboardUiEffects.showToast === 'function'
  ? dashboardUiEffects.showToast
  : () => {};
const downloadJsonFile = dashboardUiEffects && typeof dashboardUiEffects.downloadJsonFile === 'function'
  ? dashboardUiEffects.downloadJsonFile
  : () => {};
const dashboardHeaderUi = typeof createDashboardHeaderUi === 'function'
  ? createDashboardHeaderUi({
      getAutoRefreshEnabled: () => autoRefreshEnabled,
      getMoreMenuOpen: () => moreMenuOpen,
    })
  : null;
const openTabsController = typeof createOpenTabsController === 'function'
  ? createOpenTabsController({
      getState: () => state,
      getTabUrl,
      isRealTabUrl,
      isTabOutTab,
      queryDashboardTabs,
    })
  : null;
const laterListController = typeof createLaterListController === 'function'
  ? createLaterListController({
      buildFaviconImg,
      createStableId,
      escapeHtml,
      getState: () => state,
      getStorageValue,
      normalizeDeferredItems,
      queueStorageUpdate,
      scheduleSearchAndWait,
      setStorageValue,
      showToast,
      timeAgo: formatTimeAgo,
    })
  : null;
const importedSessionController = typeof createImportedSessionController === 'function'
  ? createImportedSessionController({
      buildImportedGroupViewModel: buildImportedGroupViewModelFromModule,
      buildImportedTabViewModel: buildImportedTabViewModelFromModule,
      buildSessionFilename,
      buildFaviconImg,
      createSessionExport: sessionCreateSessionExport,
      dedupeSessionGroups: sessionDedupeSessionGroups,
      createTab: createTabInChrome,
      downloadJsonFile,
      escapeHtml,
      focusExactTabByUrl: focusExactTabByUrlInChrome,
      friendlyDomain: friendlyDomainLabel,
      formatSessionDate,
      getState: () => state,
      getRealTabs: () => getRealTabs(),
      queryRawTabs,
      normalizeImportedSessionData,
      planRestoreTabs: sessionPlanRestoreTabs,
      parseImportedSession: sessionParseImportedSession,
      summarizeRestorePlan: sessionSummarizeRestorePlan,
      getStorageValue,
      setStorageValue,
      queueStorageUpdate,
      syncImportedSessionSearchResults,
      showToast,
    })
  : null;
const dashboardSearchRenderer = typeof createDashboardSearchRenderer === 'function'
  ? createDashboardSearchRenderer({
      buildFaviconImg,
      buildSearchResultsModel: buildSearchResultsModelFromModule,
      checkTabOutDupes,
      escapeHtml,
      friendlyDomain: friendlyDomainLabel,
      getImportedSession,
      getRealTabs: () => getRealTabs(),
      getSavedTabs,
      getState: () => state,
      normalizeSearchText: normalizeDashboardSearchText,
      searchImportedSessionTabs: sessionSearchImportedSessionTabs,
      searchTextMatches: searchDashboardTextMatches,
    })
  : null;
const dashboardCardRenderer = typeof createDashboardCardRenderer === 'function'
  ? createDashboardCardRenderer({
      buildFaviconImg,
      cleanTitle,
      escapeHtml,
      friendlyDomain: friendlyDomainLabel,
      shortTimeAgo: formatShortTimeAgo,
      smartTitle,
      stripTitleNoise,
    })
  : null;
const renderOpenTabsSectionCount = dashboardCardRenderer && typeof dashboardCardRenderer.renderOpenTabsSectionCount === 'function'
  ? dashboardCardRenderer.renderOpenTabsSectionCount
  : () => '';
const renderDomainCard = dashboardCardRenderer && typeof dashboardCardRenderer.renderDomainCard === 'function'
  ? dashboardCardRenderer.renderDomainCard
  : () => '';

function setDeferredItemsCache(items) {
  if (laterListController && typeof laterListController.setDeferredItemsCache === 'function') {
    return laterListController.setDeferredItemsCache(items);
  }
  return appState.setDeferredItemsCache(items);
}

function getSavedTabsFromCache() {
  return laterListController.getSavedTabsFromCache();
}

async function fetchOpenTabs() {
  if (openTabsController && typeof openTabsController.fetchOpenTabs === 'function') {
    return openTabsController.fetchOpenTabs();
  }

  appState.setOpenTabs([]);
  return state.openTabs;
}


/* ----------------------------------------------------------------
   SAVED FOR LATER — chrome.storage.local

   Replaces the old server-side SQLite + REST API with Chrome's
   built-in key-value storage. Data persists across browser sessions
   and doesn't require a running server.

   Data shape stored under the "deferred" key:
   [
     {
       id: "1712345678901",          // timestamp-based unique ID
       url: "https://example.com",
       title: "Example Page",
       savedAt: "2026-04-04T10:00:00.000Z",  // ISO date string
       completed: false,             // true = checked off (archived)
       dismissed: false              // true = dismissed without reading
     },
     ...
   ]
   ---------------------------------------------------------------- */

/**
 * saveTabForLater(tab)
 *
 * Saves a single tab to the "Saved for Later" list in chrome.storage.local.
 * @param {{ url: string, title: string }} tab
 */
async function saveTabForLater(tab) {
  return laterListController.saveTabForLater(tab);
}

/**
 * getSavedTabs()
 *
 * Returns all saved tabs from chrome.storage.local.
 * Filters out dismissed items (those are gone for good).
 * Splits into active (not completed) and archived (completed).
 */
async function getSavedTabs() {
  return laterListController.getSavedTabs();
}

/**
 * checkOffSavedTab(id)
 *
 * Marks a saved tab as completed (checked off). It moves to the archive.
 */
async function checkOffSavedTab(id) {
  return laterListController.checkOffSavedTab(id);
}

/**
 * dismissSavedTab(id)
 *
 * Marks a saved tab as dismissed (removed from all lists).
 */
async function dismissSavedTab(id) {
  return laterListController.dismissSavedTab(id);
}

async function clearSavedTabsByState({ completed }) {
  return laterListController.clearSavedTabsByState({ completed });
}

async function getImportedSession() {
  return importedSessionController.getImportedSession();
}

async function setImportedSession(session) {
  return importedSessionController.setImportedSession(session);
}

async function clearImportedSession() {
  return importedSessionController.clearImportedSession();
}

async function clearImportedSessionGroup(groupId) {
  return importedSessionController.clearImportedSessionGroup(groupId);
}

async function getAutoRefreshSetting() {
  autoRefreshEnabled = !!(await getStorageValue('autoRefreshEnabled'));
  return autoRefreshEnabled;
}

async function setAutoRefreshSetting(enabled) {
  autoRefreshEnabled = !!enabled;
  await setStorageValue('autoRefreshEnabled', autoRefreshEnabled);
}


const renderAutoRefreshToggle = dashboardHeaderUi && typeof dashboardHeaderUi.renderAutoRefreshToggle === 'function'
  ? dashboardHeaderUi.renderAutoRefreshToggle
  : () => {};
const renderMoreMenu = dashboardHeaderUi && typeof dashboardHeaderUi.renderMoreMenu === 'function'
  ? dashboardHeaderUi.renderMoreMenu
  : () => {};
const getMoreMenuItems = dashboardHeaderUi && typeof dashboardHeaderUi.getMoreMenuItems === 'function'
  ? dashboardHeaderUi.getMoreMenuItems
  : () => [];
const focusMoreMenuItem = dashboardHeaderUi && typeof dashboardHeaderUi.focusMoreMenuItem === 'function'
  ? dashboardHeaderUi.focusMoreMenuItem
  : () => {};

function closeMoreMenu({ restoreFocus = false } = {}) {
  if (!moreMenuOpen) return;
  moreMenuOpen = false;
  renderMoreMenu();
  if (restoreFocus) {
    const toggle = document.getElementById('moreMenuToggle');
    if (toggle) toggle.focus();
  }
}

async function syncImportedSessionSearchResults() {
  if (!normalizeDashboardSearchText(globalSearchQuery)) return;
  latestSearchRenderPromise = scheduleSearchRender();
  await latestSearchRenderPromise;
}
async function renderSearchResults(renderCtx = {}) {
  if (!dashboardSearchRenderer || typeof dashboardSearchRenderer.renderSearchResults !== 'function') {
    return false;
  }

  return dashboardSearchRenderer.renderSearchResults({
    ...renderCtx,
    globalSearchQuery,
  });
}

/**
 * checkAndShowEmptyState()
 *
 * Shows a cheerful "Inbox zero" message when all domain cards are gone.
 */
function checkAndShowEmptyState() {
  const missionsEl = document.getElementById('openTabsMissions');
  if (!missionsEl) return;

  const remaining = missionsEl.querySelectorAll('.mission-card:not(.closing)').length;
  if (remaining > 0) return;

  missionsEl.innerHTML = `
    <div class="missions-empty-state">
      <div class="empty-checkmark">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5" />
        </svg>
      </div>
      <div class="empty-title">Inbox zero, but for tabs.</div>
      <div class="empty-subtitle">You're free.</div>
    </div>
  `;

  const countEl = document.getElementById('openTabsSectionCount');
  if (countEl) countEl.textContent = '0 domains';
}

/* ----------------------------------------------------------------
   HELPER: filter out browser-internal pages
   ---------------------------------------------------------------- */

/**
 * getRealTabs()
 *
 * Returns tabs that are real web pages — no chrome://, extension
 * pages, about:blank, etc.
 */
function getRealTabs() {
  if (openTabsController && typeof openTabsController.getRealTabs === 'function') {
    return openTabsController.getRealTabs();
  }

  return state.openTabs.filter(t => {
    const url = t.url || '';
    return (
      !url.startsWith('chrome://') &&
      !url.startsWith('chrome-extension://') &&
      !url.startsWith('about:') &&
      !url.startsWith('edge://') &&
      !url.startsWith('brave://')
    );
  });
}

/**
 * checkTabOutDupes()
 *
 * Counts how many Tab Out pages are open. If more than 1,
 * shows a banner offering to close the extras.
 */
function checkTabOutDupes() {
  const tabOutTabs = state.openTabs.filter(t => t.isTabOut);
  const banner  = document.getElementById('tabOutDupeBanner');
  const countEl = document.getElementById('tabOutDupeCount');
  if (!banner) return;

  if (tabOutTabs.length > 1) {
    if (countEl) countEl.textContent = tabOutTabs.length;
    banner.style.display = 'flex';
  } else {
    banner.style.display = 'none';
  }
}


/* ----------------------------------------------------------------
   OVERFLOW CHIPS ("+N more" expand button in domain cards)
   ---------------------------------------------------------------- */

/* ----------------------------------------------------------------
   SAVED FOR LATER — Render Checklist Column
   ---------------------------------------------------------------- */

/**
 * renderLaterListColumn()
 *
 * Reads saved tabs from chrome.storage.local and renders the right-side
 * "Later list" column. Shows active items as a checklist
 * and completed items in a collapsible archive.
 */
async function renderLaterListColumn() {
  return laterListController.renderLaterListColumn();
}

function renderImportedSessionSection() {
  return importedSessionController.renderImportedSessionSection();
}

async function restoreSessionGroups(groups) {
  const result = await importedSessionController.restoreSessionGroups(groups);
  if (result && result.changedOpenTabs) {
    await fetchOpenTabs();
  }
  return result;
}

async function restoreImportedSessionTab(groupId, tabId) {
  return importedSessionController.restoreImportedSessionTab(groupId, tabId);
}

function getImportedSessionTab(groupId, tabId) {
  return importedSessionController.getImportedSessionTab(groupId, tabId);
}

async function clearImportedSessionTab(groupId, tabId) {
  return importedSessionController.clearImportedSessionTab(groupId, tabId);
}


/* ----------------------------------------------------------------
   MAIN DASHBOARD RENDERER
   ---------------------------------------------------------------- */

/**
 * renderStaticDashboard()
 *
 * The main render function:
 * 1. Paints greeting + date
 * 2. Fetches open tabs via chrome.tabs.query()
 * 3. Groups tabs by domain (with landing pages pulled out to their own group)
 * 4. Renders domain cards
 * 5. Updates footer stats
 * 6. Renders the "Saved for Later" checklist
 */
async function renderStaticDashboard(renderCtx = {}) {
  const { isStale = () => false } = renderCtx;
  try {
    await getAutoRefreshSetting();
  } catch (err) {
    console.warn('[tab-out] Failed to load auto refresh setting:', err);
  }
  if (isStale()) return false;

  // --- Header ---
  const greetingEl = document.getElementById('greeting');
  const dateEl     = document.getElementById('dateDisplay');
  const searchInput = document.getElementById('globalSearchInput');
  if (greetingEl) greetingEl.textContent = getDashboardGreeting();
  if (dateEl)     dateEl.textContent     = getDashboardDateDisplay();
  if (searchInput && searchInput.value !== globalSearchQuery) searchInput.value = globalSearchQuery;
  renderAutoRefreshToggle();
  renderMoreMenu();

  // --- Fetch tabs ---
  await fetchOpenTabs();
  if (isStale()) return false;
  renderOpenTabsSectionFromState({ includeImportedSection: false });

  // --- Imported session section ---
  await getImportedSession();
  if (isStale()) return false;
  renderImportedSessionSection();

  // --- Render "Later list" column ---
  await renderLaterListColumn();
  if (isStale()) return false;

  // --- Search results overlay ---
  await renderSearchResults(renderCtx);
  if (isStale()) return false;
  return true;
}

async function renderDashboard(renderCtx = {}) {
  return renderStaticDashboard(renderCtx);
}

const createRenderScheduler = typeof createRenderSchedulerFromModule === 'function'
  ? createRenderSchedulerFromModule
  : (renderer, { label = 'render' } = {}) => {
      let renderSequence = 0;
      let scheduledPromise = Promise.resolve();

      return function scheduleRender(...args) {
        renderSequence += 1;
        const requestId = renderSequence;

        scheduledPromise = scheduledPromise
          .catch(() => undefined)
          .then(async () => {
            const result = await renderer({ requestId, isStale: () => requestId !== renderSequence }, ...args);
            if (requestId !== renderSequence) return undefined;
            return result;
          })
          .catch(err => {
            console.warn(`[tab-out] ${label} failed:`, err);
            throw err;
          });

        return scheduledPromise;
      };
    };
const scheduleDashboardRender = createRenderScheduler(renderDashboard, { label: 'dashboard render' });
const scheduleSearchRender = createRenderScheduler(renderSearchResults, { label: 'search render' });

function scheduleDashboardRefresh(delay = 120) {
  if (!autoRefreshEnabled) return;
  clearTimeout(dashboardRefreshTimer);
  dashboardRefreshTimer = setTimeout(() => {
    latestDashboardRenderPromise = scheduleDashboardRender();
  }, delay);
}


/* ----------------------------------------------------------------
   EVENT HANDLERS — using event delegation

   One listener on document handles ALL button clicks.
   Think of it as one security guard watching the whole building
   instead of one per door.
   ---------------------------------------------------------------- */

function getDashboardStateSnapshot() {
  const realTabs = getRealTabs();
  return {
    autoRefreshEnabled,
    deferredItemsCache: state.deferredItemsCache,
    domainGroups: state.domainGroups,
    importedSession: state.importedSession,
    moreMenuOpen,
    openTabs: state.openTabs,
    realTabs,
  };
}

function getDomainGroupByStableId(domainId) {
  return state.domainGroups.find(group => 'domain-' + group.domain.replace(/[^a-z0-9]/g, '-') === domainId) || null;
}

function getImportedGroupById(groupId) {
  return importedSessionController.getImportedGroupById(groupId);
}

async function scheduleDashboardAndWait() {
  latestDashboardRenderPromise = scheduleDashboardRender();
  await latestDashboardRenderPromise;
}

async function scheduleSearchAndWait() {
  latestSearchRenderPromise = scheduleSearchRender();
  await latestSearchRenderPromise;
}

function hasActiveSearch() {
  return !!normalizeDashboardSearchText(globalSearchQuery);
}

function getMoreMenuOpen() {
  return moreMenuOpen;
}

function setMoreMenuOpen(nextValue) {
  moreMenuOpen = !!nextValue;
  return moreMenuOpen;
}

function suppressRemovedTabRefresh(tabIds = []) {
  for (const tabId of Array.isArray(tabIds) ? tabIds : []) {
    if (typeof tabId === 'undefined' || tabId === null) continue;
    suppressedRemovedTabIds.add(Number(tabId));
  }
}

const openTabsRuntime = typeof createOpenTabsRuntime === 'function'
  ? createOpenTabsRuntime({
      appState,
      buildDomainGroups: buildDashboardDomainGroups,
      checkTabOutDupes,
      fetchOpenTabs,
      getImportedSessionSectionRenderer: () => renderImportedSessionSection,
      getRealTabs,
      getRenderDomainCard: () => renderDomainCard,
      getRenderOpenTabsSectionCount: () => renderOpenTabsSectionCount,
      getSearchQuery: () => normalizeDashboardSearchText(globalSearchQuery),
      getState: () => state,
      getTabUrl,
      renderSearchResults: scheduleSearchAndWait,
    })
  : null;
const renderOpenTabsSectionFromState = openTabsRuntime && typeof openTabsRuntime.renderOpenTabsSectionFromState === 'function'
  ? openTabsRuntime.renderOpenTabsSectionFromState
  : () => {};
const removeOpenTabOptimistically = openTabsRuntime && typeof openTabsRuntime.removeOpenTabOptimistically === 'function'
  ? openTabsRuntime.removeOpenTabOptimistically
  : async () => {};
const removeOpenTabsOptimistically = openTabsRuntime && typeof openTabsRuntime.removeOpenTabsOptimistically === 'function'
  ? openTabsRuntime.removeOpenTabsOptimistically
  : async () => {};
const removeKnownTabsFromState = openTabsRuntime && typeof openTabsRuntime.removeKnownTabsFromState === 'function'
  ? openTabsRuntime.removeKnownTabsFromState
  : () => [];
const reconcileOpenTabsFromBrowser = openTabsRuntime && typeof openTabsRuntime.reconcileOpenTabsFromBrowser === 'function'
  ? openTabsRuntime.reconcileOpenTabsFromBrowser
  : async () => {};

const actionHandlers = typeof createDashboardActions === 'function'
  ? createDashboardActions({
      animateCardOut,
      buildSessionFilename,
      checkOffSavedTab,
      checkTabOutDupes,
      closeDuplicateTabs: closeDuplicateTabsInChrome,
      closeMoreMenu,
      closeOpenTab: closeOpenTabInChrome,
      closeTabOutDupes: closeTabOutDupesInChrome,
      closeTabsByUrls: closeTabsByUrlsInChrome,
      closeTabsExact: closeTabsExactInChrome,
      createSessionExport: sessionCreateSessionExport,
      createTab: createTabInChrome,
      dismissSavedTab,
      downloadJsonFile,
      focusMoreMenuItem,
      focusExactTabByUrl: focusExactTabByUrlInChrome,
      focusTab: focusTabInChrome,
      focusTabById: focusTabByIdInChrome,
      friendlyDomain: friendlyDomainLabel,
      getAutoRefreshEnabled: () => autoRefreshEnabled,
      getDashboardStateSnapshot,
      getDomainGroupByStableId,
      getMoreMenuOpen,
      getTabUrl,
      hasActiveSearch,
      importedSessionController,
      isRealTabUrl,
      laterListController,
      playCloseSound,
      removeKnownTabsFromState,
      removeOpenTabOptimistically,
      removeOpenTabsOptimistically,
      renderAutoRefreshToggle,
      renderImportedSessionSection,
      renderLaterListColumn,
      renderMoreMenu,
      reconcileOpenTabsFromBrowser,
      saveTabForLater,
      scheduleDashboardAndWait,
      scheduleSearchAndWait,
      setAutoRefreshSetting,
      setMoreMenuOpen,
      showToast,
      suppressRemovedTabRefresh,
      shootConfetti,
    })
  : {};
const dashboardEventBindings = typeof createDashboardEventBindings === 'function'
  ? createDashboardEventBindings({
      closeMoreMenu,
      focusMoreMenuItem,
      getActionHandlers: () => actionHandlers,
      getMoreMenuItems,
      getStateSnapshot: getDashboardStateSnapshot,
      handleImportSessionFiles: files => importedSessionController.handleImportSessionFiles(files),
      renderMoreMenu,
      scheduleDashboardRender: () => {
        latestDashboardRenderPromise = scheduleDashboardRender();
        return latestDashboardRenderPromise;
      },
      scheduleSearchRender: () => {
        latestSearchRenderPromise = scheduleSearchRender();
        return latestSearchRenderPromise;
      },
      setMoreMenuOpen,
      setSearchQuery: value => {
        globalSearchQuery = value;
        return globalSearchQuery;
      },
      showToast,
    })
  : null;
const dashboardLifecycle = typeof createDashboardLifecycle === 'function'
  ? createDashboardLifecycle({
      appState,
      ensureStorageSchema,
      getAutoRefreshSetting,
      getNormalizeDeferredItems: () => normalizeDeferredItems,
      getNormalizeImportedSessionData: () => normalizeImportedSessionData,
      getSearchQuery: () => normalizeDashboardSearchText(globalSearchQuery),
      renderAutoRefreshToggle,
      renderLaterListColumn,
      scheduleDashboardRefresh,
      scheduleDashboardRender: () => {
        latestDashboardRenderPromise = scheduleDashboardRender();
        return latestDashboardRenderPromise;
      },
      scheduleSearchRender: () => {
        latestSearchRenderPromise = scheduleSearchRender();
        return latestSearchRenderPromise;
      },
      setAutoRefreshEnabled: value => {
        autoRefreshEnabled = !!value;
        return autoRefreshEnabled;
      },
      setDeferredItemsCache,
      setImportedSession: session => appState.setImportedSession(session),
      shouldSkipRemovedTab: tabId => {
        if (!suppressedRemovedTabIds.has(tabId)) return false;
        suppressedRemovedTabIds.delete(tabId);
        return true;
      },
    })
  : null;

if (dashboardEventBindings && typeof dashboardEventBindings.bind === 'function') {
  dashboardEventBindings.bind(document);
}

if (dashboardLifecycle && typeof dashboardLifecycle.bindBrowserListeners === 'function') {
  dashboardLifecycle.bindBrowserListeners({
    tabsApi: chrome.tabs,
    storageApi: chrome.storage,
  });
}

/* ----------------------------------------------------------------
   INITIALIZE
   ---------------------------------------------------------------- */
if (dashboardLifecycle && typeof dashboardLifecycle.initialize === 'function') {
  dashboardLifecycle.initialize();
} else {
  Promise.resolve().finally(async () => {
    try {
      if (ensureStorageSchema) {
        await ensureStorageSchema();
      }
      await getAutoRefreshSetting();
    } catch (err) {
      console.warn('[tab-out] Initialization fallback path triggered:', err);
    }
    latestDashboardRenderPromise = scheduleDashboardRender();
  });
}
