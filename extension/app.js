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
  queryDashboardTabs,
  queryRawTabs,
} = window.TabOutTabService || {};
const { createSessionStore } = window.TabOutSessionStore || {};
const {
  buildImportedGroupViewModel: buildImportedGroupViewModelFromModule,
  buildImportedTabViewModel: buildImportedTabViewModelFromModule,
  buildSearchResultsModel: buildSearchResultsModelFromModule,
} = window.TabOutAppViewModels || {};
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

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

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
const openTabsController = typeof createOpenTabsController === 'function'
  ? createOpenTabsController({
      getState: () => state,
      getTabUrl,
      queryDashboardTabs,
    })
  : null;
const laterListController = typeof createLaterListController === 'function'
  ? createLaterListController({
      createStableId,
      getState: () => state,
      getStorageValue,
      normalizeDeferredItems,
      queueStorageUpdate,
      setStorageValue,
    })
  : null;
const importedSessionController = typeof createImportedSessionController === 'function'
  ? createImportedSessionController({
      getState: () => state,
      normalizeImportedSessionData,
      getStorageValue,
      setStorageValue,
      queueStorageUpdate,
    })
  : null;

function setDeferredItemsCache(items) {
  if (laterListController && typeof laterListController.setDeferredItemsCache === 'function') {
    return laterListController.setDeferredItemsCache(items);
  }
  return appState.setDeferredItemsCache(items);
}

function getSavedTabsFromCache() {
  if (laterListController && typeof laterListController.getSavedTabsFromCache === 'function') {
    return laterListController.getSavedTabsFromCache();
  }
  const visible = state.deferredItemsCache.filter(t => !t.dismissed);
  return {
    active: visible.filter(t => !t.completed),
    archived: visible.filter(t => t.completed),
  };
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
  if (laterListController && typeof laterListController.saveTabForLater === 'function') {
    return laterListController.saveTabForLater(tab);
  }

  await queueStorageUpdate('deferred', currentDeferred => {
    const { items } = normalizeDeferredItems(currentDeferred);
    const deferred = [...items];
    deferred.push({
      id:        createStableId('later'),
      url:       tab.url,
      title:     tab.title,
      savedAt:   new Date().toISOString(),
      completed: false,
      dismissed: false,
    });
    setDeferredItemsCache(deferred);
    return deferred;
  });
}

/**
 * getSavedTabs()
 *
 * Returns all saved tabs from chrome.storage.local.
 * Filters out dismissed items (those are gone for good).
 * Splits into active (not completed) and archived (completed).
 */
async function getSavedTabs() {
  if (laterListController && typeof laterListController.getSavedTabs === 'function') {
    return laterListController.getSavedTabs();
  }

  const rawDeferred = await getStorageValue('deferred');
  const { items: deferred, changed } = normalizeDeferredItems(rawDeferred);
  setDeferredItemsCache(deferred);
  if (changed) {
    await setStorageValue('deferred', deferred);
  }
  return getSavedTabsFromCache();
}

/**
 * checkOffSavedTab(id)
 *
 * Marks a saved tab as completed (checked off). It moves to the archive.
 */
async function checkOffSavedTab(id) {
  if (laterListController && typeof laterListController.checkOffSavedTab === 'function') {
    return laterListController.checkOffSavedTab(id);
  }

  await queueStorageUpdate('deferred', currentDeferred => {
    const { items } = normalizeDeferredItems(currentDeferred);
    const deferred = [...items];
    const tab = deferred.find(t => t.id === id);
    if (!tab) return deferred;
    tab.completed = true;
    tab.completedAt = new Date().toISOString();
    setDeferredItemsCache(deferred);
    return deferred;
  });
}

/**
 * dismissSavedTab(id)
 *
 * Marks a saved tab as dismissed (removed from all lists).
 */
async function dismissSavedTab(id) {
  if (laterListController && typeof laterListController.dismissSavedTab === 'function') {
    return laterListController.dismissSavedTab(id);
  }

  let removed = null;
  await queueStorageUpdate('deferred', currentDeferred => {
    const { items } = normalizeDeferredItems(currentDeferred);
    const deferred = [...items];
    const tab = deferred.find(t => t.id === id);
    if (!tab) return deferred;
    tab.dismissed = true;
    removed = { ...tab };
    setDeferredItemsCache(deferred);
    return deferred;
  });
  return removed;
}

async function clearSavedTabsByState({ completed }) {
  if (laterListController && typeof laterListController.clearSavedTabsByState === 'function') {
    return laterListController.clearSavedTabsByState({ completed });
  }

  let changed = 0;
  await queueStorageUpdate('deferred', currentDeferred => {
    const { items } = normalizeDeferredItems(currentDeferred);
    const deferred = [...items];

    for (const item of deferred) {
      if (item.dismissed) continue;
      if (!!item.completed !== !!completed) continue;
      item.dismissed = true;
      changed += 1;
    }

    setDeferredItemsCache(deferred);
    return deferred;
  });

  return changed;
}

async function getImportedSession() {
  if (importedSessionController && typeof importedSessionController.getImportedSession === 'function') {
    return importedSessionController.getImportedSession();
  }

  const rawImportedSession = await getStorageValue('importedSession');
  const { session, changed } = normalizeImportedSessionData(rawImportedSession);
  appState.setImportedSession(session);
  if (changed) {
    await setStorageValue('importedSession', session);
  }
  return state.importedSession;
}

async function setImportedSession(session) {
  if (importedSessionController && typeof importedSessionController.setImportedSession === 'function') {
    return importedSessionController.setImportedSession(session);
  }

  const { session: normalized } = normalizeImportedSessionData(session);
  appState.setImportedSession(normalized);
  await queueStorageUpdate('importedSession', () => state.importedSession);
}

async function clearImportedSession() {
  if (importedSessionController && typeof importedSessionController.clearImportedSession === 'function') {
    return importedSessionController.clearImportedSession();
  }

  appState.setImportedSession(null);
  await queueStorageUpdate('importedSession', () => null);
}

async function clearImportedSessionGroup(groupId) {
  if (importedSessionController && typeof importedSessionController.clearImportedSessionGroup === 'function') {
    return importedSessionController.clearImportedSessionGroup(groupId);
  }

  if (!state.importedSession || !Array.isArray(state.importedSession.groups)) return;

  const nextGroups = state.importedSession.groups.filter(group => group.id !== groupId);
  if (nextGroups.length === 0) {
    await clearImportedSession();
    return;
  }

  await setImportedSession({
    ...state.importedSession,
    groups: nextGroups,
  });
}

function mergeImportedSessions(existingSession, incomingSession) {
  if (!existingSession || !Array.isArray(existingSession.groups) || existingSession.groups.length === 0) {
    return incomingSession;
  }

  const existingGroups = existingSession.groups || [];
  const existingIds = new Set(existingGroups.map(group => group.id));

  const mergedGroups = [...existingGroups];

  for (const group of incomingSession.groups || []) {
    let nextId = group.id || group.domain || 'imported-group';
    let suffix = 2;

    while (existingIds.has(nextId)) {
      nextId = `${group.id || group.domain || 'imported-group'}-${suffix}`;
      suffix += 1;
    }

    existingIds.add(nextId);
    mergedGroups.push({
      ...group,
      id: nextId,
    });
  }

  return {
    version: incomingSession.version || existingSession.version || 1,
    source: 'tab-out',
    exportedAt: incomingSession.exportedAt || existingSession.exportedAt || new Date().toISOString(),
    groups: mergedGroups,
  };
}

async function getAutoRefreshSetting() {
  autoRefreshEnabled = !!(await getStorageValue('autoRefreshEnabled'));
  return autoRefreshEnabled;
}

async function setAutoRefreshSetting(enabled) {
  autoRefreshEnabled = !!enabled;
  await setStorageValue('autoRefreshEnabled', autoRefreshEnabled);
}


/* ----------------------------------------------------------------
   UI HELPERS
   ---------------------------------------------------------------- */

/**
 * playCloseSound()
 *
 * Plays a clean "swoosh" sound when tabs are closed.
 * Built entirely with the Web Audio API — no sound files needed.
 * A filtered noise sweep that descends in pitch, like air moving.
 */
function playCloseSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const t = ctx.currentTime;

    // Swoosh: shaped white noise through a sweeping bandpass filter
    const duration = 0.25;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate);
    const data = buffer.getChannelData(0);

    // Generate noise with a natural envelope (quick attack, smooth decay)
    for (let i = 0; i < data.length; i++) {
      const pos = i / data.length;
      // Envelope: ramps up fast in first 10%, then fades out smoothly
      const env = pos < 0.1 ? pos / 0.1 : Math.pow(1 - (pos - 0.1) / 0.9, 1.5);
      data[i] = (Math.random() * 2 - 1) * env;
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;

    // Bandpass filter sweeps from high to low — creates the "swoosh" character
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 2.0;
    filter.frequency.setValueAtTime(4000, t);
    filter.frequency.exponentialRampToValueAtTime(400, t + duration);

    // Volume
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.15, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);

    source.connect(filter).connect(gain).connect(ctx.destination);
    source.start(t);

    setTimeout(() => ctx.close(), 500);
  } catch {
    // Audio not supported — fail silently
  }
}

/**
 * shootConfetti(x, y)
 *
 * Shoots a burst of colorful confetti particles from the given screen
 * coordinates (typically the center of a card being closed).
 * Pure CSS + JS, no libraries.
 */
function shootConfetti(x, y) {
  const colors = [
    '#c8713a', // amber
    '#e8a070', // amber light
    '#5a7a62', // sage
    '#8aaa92', // sage light
    '#5a6b7a', // slate
    '#8a9baa', // slate light
    '#d4b896', // warm paper
    '#b35a5a', // rose
  ];

  const particleCount = 17;

  for (let i = 0; i < particleCount; i++) {
    const el = document.createElement('div');

    const isCircle = Math.random() > 0.5;
    const size = 5 + Math.random() * 6; // 5–11px
    const color = colors[Math.floor(Math.random() * colors.length)];

    el.style.cssText = `
      position: fixed;
      left: ${x}px;
      top: ${y}px;
      width: ${size}px;
      height: ${size}px;
      background: ${color};
      border-radius: ${isCircle ? '50%' : '2px'};
      pointer-events: none;
      z-index: 9999;
      transform: translate(-50%, -50%);
      opacity: 1;
    `;
    document.body.appendChild(el);

    // Physics: random angle and speed for the outward burst
    const angle   = Math.random() * Math.PI * 2;
    const speed   = 60 + Math.random() * 120;
    const vx      = Math.cos(angle) * speed;
    const vy      = Math.sin(angle) * speed - 80; // bias upward
    const gravity = 200;

    const startTime = performance.now();
    const duration  = 700 + Math.random() * 200; // 700–900ms

    function frame(now) {
      const elapsed  = (now - startTime) / 1000;
      const progress = elapsed / (duration / 1000);

      if (progress >= 1) { el.remove(); return; }

      const px = vx * elapsed;
      const py = vy * elapsed + 0.5 * gravity * elapsed * elapsed;
      const opacity = progress < 0.5 ? 1 : 1 - (progress - 0.5) * 2;
      const rotate  = elapsed * 200 * (isCircle ? 0 : 1);

      el.style.transform = `translate(calc(-50% + ${px}px), calc(-50% + ${py}px)) rotate(${rotate}deg)`;
      el.style.opacity = opacity;

      requestAnimationFrame(frame);
    }

    requestAnimationFrame(frame);
  }
}

/**
 * animateCardOut(card)
 *
 * Smoothly removes a mission card: fade + scale down, then confetti.
 * After the animation, checks if the grid is now empty.
 */
function animateCardOut(card) {
  if (!card) return;

  const rect = card.getBoundingClientRect();
  shootConfetti(rect.left + rect.width / 2, rect.top + rect.height / 2);

  card.classList.add('closing');
  setTimeout(() => {
    card.remove();
    checkAndShowEmptyState();
  }, 300);
}

/**
 * showToast(message)
 *
 * Brief pop-up notification at the bottom of the screen.
 */
function showToast(message) {
  const toast = document.getElementById('toast');
  document.getElementById('toastText').textContent = message;
  toast.classList.add('visible');
  setTimeout(() => toast.classList.remove('visible'), 2500);
}

function renderAutoRefreshToggle() {
  const toggle = document.getElementById('autoRefreshToggle');
  if (!toggle) return;

  toggle.textContent = `Auto refresh: ${autoRefreshEnabled ? 'On' : 'Off'}`;
  toggle.classList.toggle('save-tabs', autoRefreshEnabled);
  toggle.classList.toggle('danger', !autoRefreshEnabled);
}

function renderMoreMenu() {
  const menu = document.getElementById('moreMenu');
  const toggle = document.getElementById('moreMenuToggle');
  const panel = document.getElementById('moreMenuPanel');
  if (!menu || !toggle || !panel) return;

  menu.classList.toggle('open', moreMenuOpen);
  toggle.setAttribute('aria-expanded', moreMenuOpen ? 'true' : 'false');
  panel.style.display = moreMenuOpen ? 'flex' : 'none';
}

function getMoreMenuItems() {
  return Array.from(document.querySelectorAll('#moreMenuPanel .more-menu-item'));
}

function focusMoreMenuItem(index) {
  const items = getMoreMenuItems();
  if (items.length === 0) return;
  const safeIndex = Math.max(0, Math.min(index, items.length - 1));
  items[safeIndex].focus();
}

function closeMoreMenu({ restoreFocus = false } = {}) {
  if (!moreMenuOpen) return;
  moreMenuOpen = false;
  renderMoreMenu();
  if (restoreFocus) {
    const toggle = document.getElementById('moreMenuToggle');
    if (toggle) toggle.focus();
  }
}

function formatSessionDate(dateStr) {
  if (!dateStr) return '';

  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return '';

  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function downloadJsonFile(filename, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function buildSessionFilename(scopeLabel) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safeScope = scopeLabel.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'session';
  return `tab-out-${safeScope}-${stamp}.json`;
}

function buildFaviconImg(domain, className = 'chip-favicon') {
  if (!domain) return '';
  const faviconUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=16`;
  return `<img class="${className}" src="${faviconUrl}" alt="">`;
}

function loadOptionalLocalConfig() {
  return new Promise(resolve => {
    const existing = document.querySelector('script[data-local-config="true"]');
    if (existing) {
      resolve();
      return;
    }

    const script = document.createElement('script');
    script.src = 'config.local.js';
    script.dataset.localConfig = 'true';
    script.onload = () => resolve();
    script.onerror = () => resolve();
    document.head.appendChild(script);
  });
}

function normalizeSearchText(value) {
  return String(value || '').trim().toLowerCase();
}

function searchTextMatches(query, ...parts) {
  const needle = normalizeSearchText(query);
  if (!needle) return true;
  return parts.some(part => normalizeSearchText(part).includes(needle));
}

async function syncImportedSessionSearchResults() {
  if (!normalizeSearchText(globalSearchQuery)) return;
  latestSearchRenderPromise = scheduleSearchRender();
  await latestSearchRenderPromise;
}

function buildSearchResultItem(item) {
  const safeId = escapeHtml(item.id || '');
  const safeTabId = escapeHtml(item.tabId || '');
  const safeGroupId = escapeHtml(item.groupId || '');
  const safeUrl = escapeHtml(item.url || '');
  const safeTitle = escapeHtml(item.title || item.url || '');
  const safeSourceLabel = escapeHtml(item.sourceLabel || '');
  const safeDisplayTitle = escapeHtml(item.title || item.url || '');
  const safeGroupLabel = escapeHtml(item.groupLabel || '');
  const sourceBadgeClass = item.source === 'imported' ? ' imported' : item.source === 'later' ? ' later' : '';
  let domain = '';
  try { domain = new URL(item.url).hostname.replace(/^www\./, ''); } catch {}
  const safeDomain = escapeHtml(domain || item.groupLabel || 'Unknown source');

  let actions = '';
  if (item.source === 'open') {
    actions = `
      <button class="action-btn" data-action="focus-tab" data-tab-id="${safeTabId}" data-tab-url="${safeUrl}">Focus</button>
      <button class="action-btn close-tabs" data-action="close-single-tab" data-tab-id="${safeTabId}" data-tab-url="${safeUrl}">Close</button>
      <button class="action-btn save-tabs" data-action="defer-single-tab" data-tab-id="${safeTabId}" data-tab-url="${safeUrl}" data-tab-title="${safeTitle}">Later</button>
    `;
  } else if (item.source === 'imported') {
    const primaryLabel = item.isOpen ? 'Open' : 'Restore';
    actions = `
      <button class="action-btn save-tabs" data-action="restore-imported-tab" data-imported-group-id="${safeGroupId}" data-imported-tab-id="${safeTabId}" data-tab-url="${safeUrl}">${primaryLabel}</button>
      <button class="action-btn danger" data-action="clear-imported-tab" data-imported-group-id="${safeGroupId}" data-imported-tab-id="${safeTabId}">Clear</button>
    `;
  } else {
    actions = item.isArchived
      ? `
        <button class="action-btn" data-action="open-later-item" data-later-url="${safeUrl}">Open</button>
        <button class="action-btn danger" data-action="dismiss-later" data-later-id="${safeId}">Remove</button>
      `
      : `
        <button class="action-btn" data-action="open-later-item" data-later-url="${safeUrl}">Open</button>
        <button class="action-btn save-tabs" data-action="check-later" data-later-id="${safeId}">Done</button>
        <button class="action-btn danger" data-action="dismiss-later" data-later-id="${safeId}">Remove</button>
      `;
  }

  return `
    <div class="search-card">
      <div class="search-card-header">
        <div class="search-card-title">${buildFaviconImg(domain)}${safeDisplayTitle}</div>
        <span class="search-source-badge${sourceBadgeClass}">${safeSourceLabel}</span>
      </div>
      <div class="search-card-meta">
        <span>${safeDomain}</span>
        ${item.groupLabel ? `<span>${safeGroupLabel}</span>` : ''}
        ${item.url ? `<span>${safeUrl}</span>` : ''}
      </div>
      <div class="search-card-actions">${actions}</div>
    </div>`;
}

async function renderSearchResults(renderCtx = {}) {
  const { isStale = () => false } = renderCtx;
  const searchSection = document.getElementById('searchSection');
  const searchCount = document.getElementById('searchCount');
  const searchResults = document.getElementById('searchResults');
  const openTabsSection = document.getElementById('openTabsSection');
  const importedSessionSection = document.getElementById('importedSessionSection');
  const laterColumn = document.getElementById('laterColumn');
  const tabOutDupeBanner = document.getElementById('tabOutDupeBanner');

  if (!searchSection || !searchCount || !searchResults) return false;

  const query = normalizeSearchText(globalSearchQuery);
  if (!query) {
    searchSection.style.display = 'none';
    if (openTabsSection) openTabsSection.style.display = state.domainGroups.length > 0 ? 'block' : 'none';
    if (laterColumn) {
      const { active, archived } = await getSavedTabs();
      laterColumn.style.display = active.length === 0 && archived.length === 0 ? 'none' : 'block';
    }
    if (importedSessionSection && state.importedSession && Array.isArray(state.importedSession.groups) && state.importedSession.groups.length > 0) {
      importedSessionSection.style.display = 'block';
    }
    if (tabOutDupeBanner) checkTabOutDupes();
    return false;
  }

  const { active: laterActive, archived: laterArchived } = await getSavedTabs();
  if (isStale()) return false;
  const results = typeof buildSearchResultsModelFromModule === 'function'
    ? buildSearchResultsModelFromModule({
        friendlyDomain,
        importedSession: state.importedSession,
        laterActive,
        laterArchived,
        openTabs: getRealTabs(),
        query,
        searchImportedSessionTabs: sessionSearchImportedSessionTabs,
        searchTextMatches,
      })
    : [];

  if (openTabsSection) openTabsSection.style.display = 'none';
  if (importedSessionSection) importedSessionSection.style.display = 'none';
  if (laterColumn) laterColumn.style.display = 'none';
  if (tabOutDupeBanner) tabOutDupeBanner.style.display = 'none';

  searchCount.textContent = `${results.length} result${results.length !== 1 ? 's' : ''}`;
  searchResults.innerHTML = results.length > 0
    ? results.map(buildSearchResultItem).join('')
    : '<div class="search-empty">No matching tabs across open tabs, imported session, or later list.</div>';
  if (isStale()) return false;
  searchSection.style.display = 'block';
  return true;
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

function renderOpenTabsSectionCount(domainCount, realTabCount) {
  const domainLabel = `${domainCount} domain${domainCount !== 1 ? 's' : ''}`;
  return `${escapeHtml(domainLabel)} &nbsp;&middot;&nbsp; <button class="action-btn close-tabs" data-action="close-all-open-tabs" style="font-size:11px;padding:3px 10px;">${ICONS.close} Close all ${realTabCount} tabs</button>`;
}

/**
 * timeAgo(dateStr)
 *
 * Converts an ISO date string into a human-friendly relative time.
 * "2026-04-04T10:00:00Z" → "2 hrs ago" or "yesterday"
 */
function timeAgo(dateStr) {
  if (!dateStr) return '';
  const then = new Date(dateStr);
  const now  = new Date();
  const diffMins  = Math.floor((now - then) / 60000);
  const diffHours = Math.floor((now - then) / 3600000);
  const diffDays  = Math.floor((now - then) / 86400000);

  if (diffMins < 1)   return 'just now';
  if (diffMins < 60)  return diffMins + ' min ago';
  if (diffHours < 24) return diffHours + ' hr' + (diffHours !== 1 ? 's' : '') + ' ago';
  if (diffDays === 1) return 'yesterday';
  return diffDays + ' days ago';
}

function shortTimeAgo(timestamp) {
  if (!timestamp) return '';
  const diffMs = Date.now() - Number(timestamp);
  if (!Number.isFinite(diffMs) || diffMs < 0) return '';

  const mins = Math.floor(diffMs / 60000);
  const hours = Math.floor(diffMs / 3600000);
  const days = Math.floor(diffMs / 86400000);

  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

/**
 * getGreeting() — "Good morning / afternoon / evening"
 */
function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

/**
 * getDateDisplay() — "Friday, April 4, 2026"
 */
function getDateDisplay() {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year:    'numeric',
    month:   'long',
    day:     'numeric',
  });
}


/* ----------------------------------------------------------------
   DOMAIN & TITLE CLEANUP HELPERS
   ---------------------------------------------------------------- */

// Map of known hostnames → friendly display names.
const FRIENDLY_DOMAINS = {
  'github.com':           'GitHub',
  'www.github.com':       'GitHub',
  'gist.github.com':      'GitHub Gist',
  'youtube.com':          'YouTube',
  'www.youtube.com':      'YouTube',
  'music.youtube.com':    'YouTube Music',
  'x.com':                'X',
  'www.x.com':            'X',
  'twitter.com':          'X',
  'www.twitter.com':      'X',
  'reddit.com':           'Reddit',
  'www.reddit.com':       'Reddit',
  'old.reddit.com':       'Reddit',
  'substack.com':         'Substack',
  'www.substack.com':     'Substack',
  'medium.com':           'Medium',
  'www.medium.com':       'Medium',
  'linkedin.com':         'LinkedIn',
  'www.linkedin.com':     'LinkedIn',
  'stackoverflow.com':    'Stack Overflow',
  'www.stackoverflow.com':'Stack Overflow',
  'news.ycombinator.com': 'Hacker News',
  'google.com':           'Google',
  'www.google.com':       'Google',
  'mail.google.com':      'Gmail',
  'docs.google.com':      'Google Docs',
  'drive.google.com':     'Google Drive',
  'calendar.google.com':  'Google Calendar',
  'meet.google.com':      'Google Meet',
  'gemini.google.com':    'Gemini',
  'chatgpt.com':          'ChatGPT',
  'www.chatgpt.com':      'ChatGPT',
  'chat.openai.com':      'ChatGPT',
  'claude.ai':            'Claude',
  'www.claude.ai':        'Claude',
  'code.claude.com':      'Claude Code',
  'notion.so':            'Notion',
  'www.notion.so':        'Notion',
  'figma.com':            'Figma',
  'www.figma.com':        'Figma',
  'slack.com':            'Slack',
  'app.slack.com':        'Slack',
  'discord.com':          'Discord',
  'www.discord.com':      'Discord',
  'wikipedia.org':        'Wikipedia',
  'en.wikipedia.org':     'Wikipedia',
  'amazon.com':           'Amazon',
  'www.amazon.com':       'Amazon',
  'netflix.com':          'Netflix',
  'www.netflix.com':      'Netflix',
  'spotify.com':          'Spotify',
  'open.spotify.com':     'Spotify',
  'vercel.com':           'Vercel',
  'www.vercel.com':       'Vercel',
  'npmjs.com':            'npm',
  'www.npmjs.com':        'npm',
  'developer.mozilla.org':'MDN',
  'arxiv.org':            'arXiv',
  'www.arxiv.org':        'arXiv',
  'huggingface.co':       'Hugging Face',
  'www.huggingface.co':   'Hugging Face',
  'producthunt.com':      'Product Hunt',
  'www.producthunt.com':  'Product Hunt',
  'xiaohongshu.com':      'RedNote',
  'www.xiaohongshu.com':  'RedNote',
  'local-files':          'Local Files',
};

function friendlyDomain(hostname) {
  if (!hostname) return '';
  if (FRIENDLY_DOMAINS[hostname]) return FRIENDLY_DOMAINS[hostname];

  if (hostname.endsWith('.substack.com') && hostname !== 'substack.com') {
    return capitalize(hostname.replace('.substack.com', '')) + "'s Substack";
  }
  if (hostname.endsWith('.github.io')) {
    return capitalize(hostname.replace('.github.io', '')) + ' (GitHub Pages)';
  }

  let clean = hostname
    .replace(/^www\./, '')
    .replace(/\.(com|org|net|io|co|ai|dev|app|so|me|xyz|info|us|uk|co\.uk|co\.jp)$/, '');

  return clean.split('.').map(part => capitalize(part)).join(' ');
}

function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function stripTitleNoise(title) {
  if (!title) return '';
  // Strip leading notification count: "(2) Title"
  title = title.replace(/^\(\d+\+?\)\s*/, '');
  // Strip inline counts like "Inbox (16,359)"
  title = title.replace(/\s*\([\d,]+\+?\)\s*/g, ' ');
  // Strip email addresses (privacy + cleaner display)
  title = title.replace(/\s*[\-\u2010-\u2015]\s*[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, '');
  title = title.replace(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, '');
  // Clean X/Twitter format
  title = title.replace(/\s+on X:\s*/, ': ');
  title = title.replace(/\s*\/\s*X\s*$/, '');
  return title.trim();
}

function cleanTitle(title, hostname) {
  if (!title || !hostname) return title || '';

  const friendly = friendlyDomain(hostname);
  const domain   = hostname.replace(/^www\./, '');
  const seps     = [' - ', ' | ', ' — ', ' · ', ' – '];

  for (const sep of seps) {
    const idx = title.lastIndexOf(sep);
    if (idx === -1) continue;
    const suffix     = title.slice(idx + sep.length).trim();
    const suffixLow  = suffix.toLowerCase();
    if (
      suffixLow === domain.toLowerCase() ||
      suffixLow === friendly.toLowerCase() ||
      suffixLow === domain.replace(/\.\w+$/, '').toLowerCase() ||
      domain.toLowerCase().includes(suffixLow) ||
      friendly.toLowerCase().includes(suffixLow)
    ) {
      const cleaned = title.slice(0, idx).trim();
      if (cleaned.length >= 5) return cleaned;
    }
  }
  return title;
}

function smartTitle(title, url) {
  if (!url) return title || '';
  let pathname = '', hostname = '';
  try { const u = new URL(url); pathname = u.pathname; hostname = u.hostname; }
  catch { return title || ''; }

  const titleIsUrl = !title || title === url || title.startsWith(hostname) || title.startsWith('http');

  if ((hostname === 'x.com' || hostname === 'twitter.com' || hostname === 'www.x.com') && pathname.includes('/status/')) {
    const username = pathname.split('/')[1];
    if (username) return titleIsUrl ? `Post by @${username}` : title;
  }

  if (hostname === 'github.com' || hostname === 'www.github.com') {
    const parts = pathname.split('/').filter(Boolean);
    if (parts.length >= 2) {
      const [owner, repo, ...rest] = parts;
      if (rest[0] === 'issues' && rest[1]) return `${owner}/${repo} Issue #${rest[1]}`;
      if (rest[0] === 'pull'   && rest[1]) return `${owner}/${repo} PR #${rest[1]}`;
      if (rest[0] === 'blob' || rest[0] === 'tree') return `${owner}/${repo} — ${rest.slice(2).join('/')}`;
      if (titleIsUrl) return `${owner}/${repo}`;
    }
  }

  if ((hostname === 'www.youtube.com' || hostname === 'youtube.com') && pathname === '/watch') {
    if (titleIsUrl) return 'YouTube Video';
  }

  if ((hostname === 'www.reddit.com' || hostname === 'reddit.com' || hostname === 'old.reddit.com') && pathname.includes('/comments/')) {
    const parts  = pathname.split('/').filter(Boolean);
    const subIdx = parts.indexOf('r');
    if (subIdx !== -1 && parts[subIdx + 1]) {
      if (titleIsUrl) return `r/${parts[subIdx + 1]} post`;
    }
  }

  return title || url;
}


/* ----------------------------------------------------------------
   SVG ICON STRINGS
   ---------------------------------------------------------------- */
const ICONS = {
  tabs:    `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M3 8.25V18a2.25 2.25 0 0 0 2.25 2.25h13.5A2.25 2.25 0 0 0 21 18V8.25m-18 0V6a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 6v2.25m-18 0h18" /></svg>`,
  close:   `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>`,
  archive: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 0 1-2.247 2.118H6.622a2.25 2.25 0 0 1-2.247-2.118L3.75 7.5m6 4.125l2.25 2.25m0 0l2.25 2.25M12 13.875l2.25-2.25M12 13.875l-2.25 2.25M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125Z" /></svg>`,
  focus:   `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="m4.5 19.5 15-15m0 0H8.25m11.25 0v11.25" /></svg>`,
};


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

function buildOverflowChips(hiddenTabs, urlCounts = {}) {
  const hiddenChips = hiddenTabs.map(tab => {
    const label    = cleanTitle(smartTitle(stripTitleNoise(tab.title || ''), tab.url), '');
    const count    = urlCounts[tab.url] || 1;
    const dupeTag  = count > 1 ? ` <span class="chip-dupe-badge">(${count}x)</span>` : '';
    const chipClass = count > 1 ? ' chip-has-dupes' : '';
    const ageTag   = shortTimeAgo(tab.lastAccessed);
    const safeUrl   = escapeHtml(tab.url || '');
    const safeTitle = escapeHtml(label);
    let domain = '';
    try { domain = new URL(tab.url).hostname; } catch {}
    return `<div class="page-chip clickable${chipClass}" data-action="focus-tab" data-tab-url="${safeUrl}" title="${safeTitle}">
      ${buildFaviconImg(domain)}
      <span class="chip-text">${escapeHtml(label)}</span>${dupeTag}
      ${ageTag ? `<span class="chip-age">${ageTag}</span>` : ''}
      <div class="chip-actions">
        <button class="chip-action chip-save" data-action="defer-single-tab" data-tab-url="${safeUrl}" data-tab-title="${safeTitle}" title="Save for later">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z" /></svg>
        </button>
        <button class="chip-action chip-close" data-action="close-single-tab" data-tab-url="${safeUrl}" title="Close this tab">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
        </button>
      </div>
    </div>`;
  }).join('');

  return `
    <div class="page-chips-overflow" style="display:none">${hiddenChips}</div>
    <div class="page-chip page-chip-overflow clickable" data-action="expand-chips">
      <span class="chip-text">+${hiddenTabs.length} more</span>
    </div>`;
}


/* ----------------------------------------------------------------
   DOMAIN CARD RENDERER
   ---------------------------------------------------------------- */

/**
 * renderDomainCard(group, groupIndex)
 *
 * Builds the HTML for one domain group card.
 * group = { domain: string, tabs: [{ url, title, id, windowId, active }] }
 */
function renderDomainCard(group) {
  const tabs      = group.tabs || [];
  const tabCount  = tabs.length;
  const isLanding = group.domain === '__landing-pages__';
  const stableId  = 'domain-' + group.domain.replace(/[^a-z0-9]/g, '-');

  // Count duplicates (exact URL match)
  const urlCounts = {};
  for (const tab of tabs) urlCounts[tab.url] = (urlCounts[tab.url] || 0) + 1;
  const dupeUrls   = Object.entries(urlCounts).filter(([, c]) => c > 1);
  const hasDupes   = dupeUrls.length > 0;
  const totalExtras = dupeUrls.reduce((s, [, c]) => s + c - 1, 0);

  const tabBadge = `<span class="open-tabs-badge">
    ${ICONS.tabs}
    ${tabCount} tab${tabCount !== 1 ? 's' : ''} open
  </span>`;

  const dupeBadge = hasDupes
    ? `<span class="open-tabs-badge" style="color:var(--accent-amber);background:rgba(200,113,58,0.08);">
        ${totalExtras} duplicate${totalExtras !== 1 ? 's' : ''}
      </span>`
    : '';

  // Deduplicate for display: show each URL once, with (Nx) badge if duped
  const seen = new Set();
  const uniqueTabs = [];
  for (const tab of tabs) {
    if (!seen.has(tab.url)) { seen.add(tab.url); uniqueTabs.push(tab); }
  }

  const visibleTabs = uniqueTabs.slice(0, 8);
  const extraCount  = uniqueTabs.length - visibleTabs.length;

  const pageChips = visibleTabs.map(tab => {
    let label = cleanTitle(smartTitle(stripTitleNoise(tab.title || ''), tab.url), group.domain);
    // For localhost tabs, prepend port number so you can tell projects apart
    try {
      const parsed = new URL(tab.url);
      if (parsed.hostname === 'localhost' && parsed.port) label = `${parsed.port} ${label}`;
    } catch {}
    const count    = urlCounts[tab.url];
    const dupeTag  = count > 1 ? ` <span class="chip-dupe-badge">(${count}x)</span>` : '';
    const chipClass = count > 1 ? ' chip-has-dupes' : '';
    const ageTag   = shortTimeAgo(tab.lastAccessed);
    const safeUrl   = escapeHtml(tab.url || '');
    const safeTitle = escapeHtml(label);
    let domain = '';
    try { domain = new URL(tab.url).hostname; } catch {}
    return `<div class="page-chip clickable${chipClass}" data-action="focus-tab" data-tab-url="${safeUrl}" title="${safeTitle}">
      ${buildFaviconImg(domain)}
      <span class="chip-text">${escapeHtml(label)}</span>${dupeTag}
      ${ageTag ? `<span class="chip-age">${ageTag}</span>` : ''}
      <div class="chip-actions">
        <button class="chip-action chip-save" data-action="defer-single-tab" data-tab-url="${safeUrl}" data-tab-title="${safeTitle}" title="Save for later">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z" /></svg>
        </button>
        <button class="chip-action chip-close" data-action="close-single-tab" data-tab-url="${safeUrl}" title="Close this tab">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
        </button>
      </div>
    </div>`;
  }).join('') + (extraCount > 0 ? buildOverflowChips(uniqueTabs.slice(8), urlCounts) : '');

  let actionsHtml = `
    <button class="action-btn" data-action="export-domain-group" data-domain-id="${stableId}">
      Export
    </button>
    <button class="action-btn close-tabs" data-action="close-domain-tabs" data-domain-id="${stableId}">
      ${ICONS.close}
      Close all ${tabCount} tab${tabCount !== 1 ? 's' : ''}
    </button>`;

  if (hasDupes) {
    const dupeUrlsEncoded = dupeUrls.map(([url]) => encodeURIComponent(url)).join(',');
    actionsHtml += `
      <button class="action-btn" data-action="dedup-keep-one" data-dupe-urls="${dupeUrlsEncoded}">
        Close ${totalExtras} duplicate${totalExtras !== 1 ? 's' : ''}
      </button>`;
  }

  return `
    <div class="mission-card domain-card ${hasDupes ? 'has-amber-bar' : 'has-neutral-bar'}" data-domain-id="${stableId}">
      <div class="status-bar"></div>
      <div class="mission-content">
        <div class="mission-top">
          <span class="mission-name">${escapeHtml(isLanding ? 'Homepages' : (group.label || friendlyDomain(group.domain)))}</span>
          ${tabBadge}
          ${dupeBadge}
        </div>
        <div class="mission-pages">${pageChips}</div>
        <div class="actions">${actionsHtml}</div>
      </div>
      <div class="mission-meta">
        <div class="mission-page-count">${tabCount}</div>
        <div class="mission-page-label">tabs</div>
      </div>
    </div>`;
}


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
  const column         = document.getElementById('laterColumn');
  const list           = document.getElementById('laterList');
  const empty          = document.getElementById('laterEmpty');
  const countEl        = document.getElementById('laterCount');
  const archiveEl      = document.getElementById('laterArchive');
  const archiveCountEl = document.getElementById('archiveCount');
  const archiveList    = document.getElementById('archiveList');

  if (!column) return;

  try {
    const { active, archived } = await getSavedTabs();

    // Hide the entire column if there's nothing to show
    if (active.length === 0 && archived.length === 0) {
      column.style.display = 'none';
      return;
    }

    column.style.display = 'block';

    // Render active checklist items
    if (active.length > 0) {
      countEl.textContent = `${active.length} item${active.length !== 1 ? 's' : ''}`;
      list.innerHTML = active.map(item => renderLaterItem(item)).join('');
      list.style.display = 'block';
      empty.style.display = 'none';
    } else {
      list.style.display = 'none';
      countEl.textContent = '';
      empty.style.display = 'block';
    }

    // Render archive section
    if (archived.length > 0) {
      archiveCountEl.textContent = `(${archived.length})`;
      archiveList.innerHTML = archived.map(item => renderArchiveItem(item)).join('');
      archiveEl.style.display = 'block';
    } else {
      archiveEl.style.display = 'none';
    }

  } catch (err) {
    console.warn('[tab-out] Could not load saved tabs:', err);
    column.style.display = 'none';
  }
}

/**
 * renderLaterItem(item)
 *
 * Builds HTML for one active checklist item: checkbox, title link,
 * domain, time ago, dismiss button.
 */
function renderLaterItem(item) {
  let domain = '';
  try { domain = new URL(item.url).hostname.replace(/^www\./, ''); } catch {}
  const ago = timeAgo(item.savedAt);
  const safeId = escapeHtml(item.id);
  const safeUrl = escapeHtml(item.url);
  const safeTitle = escapeHtml(item.title || item.url);
  const safeDomain = escapeHtml(domain);

  return `
    <div class="later-item" data-later-id="${safeId}">
      <input type="checkbox" class="later-checkbox" data-action="check-later" data-later-id="${safeId}">
      <div class="later-info">
        <a href="${safeUrl}" target="_blank" rel="noopener" class="later-title" title="${safeTitle}">
          ${buildFaviconImg(domain, 'deferred-favicon')}${safeTitle}
        </a>
        <div class="later-meta">
          <span>${safeDomain}</span>
          <span>${escapeHtml(ago)}</span>
        </div>
      </div>
      <button class="later-dismiss" data-action="dismiss-later" data-later-id="${safeId}" title="Remove">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
      </button>
    </div>`;
}

/**
 * renderArchiveItem(item)
 *
 * Builds HTML for one completed/archived item (simpler: just title + date).
 */
function renderArchiveItem(item) {
  const ago = item.completedAt ? timeAgo(item.completedAt) : timeAgo(item.savedAt);
  const safeUrl = escapeHtml(item.url);
  const safeTitle = escapeHtml(item.title || item.url);
  return `
    <div class="archive-item">
      <a href="${safeUrl}" target="_blank" rel="noopener" class="archive-item-title" title="${safeTitle}">
        ${safeTitle}
      </a>
      <span class="archive-item-date">${escapeHtml(ago)}</span>
    </div>`;
}

function renderImportedSessionTabChip(tab, groupId, openUrlSet) {
  const viewModel = typeof buildImportedTabViewModelFromModule === 'function'
    ? buildImportedTabViewModelFromModule(tab, groupId, openUrlSet)
    : {
        groupId: groupId || '',
        isOpen: !!openUrlSet.has(tab.url),
        primaryActionLabel: openUrlSet.has(tab.url) ? 'Open' : 'Restore',
        primaryActionTitle: openUrlSet.has(tab.url) ? 'Open this tab' : 'Restore this tab',
        statusLabel: openUrlSet.has(tab.url) ? 'Open' : '',
        tabId: tab.id || '',
        title: tab.title || tab.url || '',
        url: tab.url || '',
      };
  const safeTitle = escapeHtml(viewModel.title);
  const safeGroupId = escapeHtml(viewModel.groupId);
  const safeTabId = escapeHtml(viewModel.tabId);
  const safeUrl = escapeHtml(viewModel.url);
  let domain = '';
  try { domain = new URL(viewModel.url).hostname; } catch {}

  const statusBadge = viewModel.statusLabel
    ? `<span class="chip-inline-status">${escapeHtml(viewModel.statusLabel)}</span>`
    : '';

  return `<div class="page-chip" title="${safeTitle}">
      ${buildFaviconImg(domain)}
      <span class="chip-text">${safeTitle}</span>
      ${statusBadge}
      <div class="chip-actions">
        <button class="chip-action chip-restore" data-action="restore-imported-tab" data-imported-group-id="${safeGroupId}" data-imported-tab-id="${safeTabId}" data-tab-url="${safeUrl}" title="${escapeHtml(viewModel.primaryActionTitle)}">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="m4.5 19.5 15-15m0 0H8.25m11.25 0v11.25" /></svg>
        </button>
        <button class="chip-action chip-close" data-action="clear-imported-tab" data-imported-group-id="${safeGroupId}" data-imported-tab-id="${safeTabId}" title="Clear this imported tab">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
        </button>
      </div>
    </div>`;
}

function renderImportedSessionCard(group, openUrlSet) {
  const groupId = escapeHtml(group.id || group.domain || '');
  const viewModel = typeof buildImportedGroupViewModelFromModule === 'function'
    ? buildImportedGroupViewModelFromModule(group, openUrlSet)
    : {
        allOpen: false,
        hiddenTabs: (group.tabs || []).slice(8),
        tabCount: Array.isArray(group.tabs) ? group.tabs.length : 0,
        visibleTabs: (group.tabs || []).slice(0, 8),
      };
  const extraCount = viewModel.hiddenTabs.length;
  const statusBadge = viewModel.allOpen
    ? `<span class="open-tabs-badge imported-status-badge">Opened</span>`
    : '';

  const visibleChips = viewModel.visibleTabs
    .map(tab => renderImportedSessionTabChip(tab, group.id || group.domain || '', openUrlSet))
    .join('');
  const hiddenChips = viewModel.hiddenTabs
    .map(tab => renderImportedSessionTabChip(tab, group.id || group.domain || '', openUrlSet))
    .join('');
  const pageChips = visibleChips + (extraCount > 0 ? `
    <div class="page-chips-overflow" style="display:none">${hiddenChips}</div>
    <div class="page-chip page-chip-overflow clickable" data-action="expand-chips">
      <span class="chip-text">+${extraCount} more</span>
    </div>` : '');

  return `
    <div class="mission-card domain-card has-active-bar" data-imported-group-id="${groupId}">
      <div class="status-bar"></div>
      <div class="mission-content">
        <div class="mission-top">
          <span class="mission-name">${escapeHtml(group.label || friendlyDomain(group.domain))}</span>
          <span class="open-tabs-badge">${ICONS.tabs}${viewModel.tabCount} tab${viewModel.tabCount !== 1 ? 's' : ''}</span>
          ${statusBadge}
        </div>
        <div class="mission-pages">${pageChips}</div>
        <div class="actions">
          <button class="action-btn save-tabs" data-action="restore-imported-group" data-imported-group-id="${groupId}">Restore</button>
          <button class="action-btn danger" data-action="clear-imported-group" data-imported-group-id="${groupId}">Clear</button>
        </div>
      </div>
        <div class="mission-meta">
        <div class="mission-page-count">${viewModel.tabCount}</div>
        <div class="mission-page-label">tabs</div>
      </div>
    </div>`;
}

function renderImportedSessionSection() {
  const section = document.getElementById('importedSessionSection');
  const countEl = document.getElementById('importedSessionCount');
  const metaEl = document.getElementById('importedSessionMeta');
  const missionsEl = document.getElementById('importedSessionMissions');

  if (!section || !countEl || !metaEl || !missionsEl) return;

  if (!state.importedSession || !Array.isArray(state.importedSession.groups) || state.importedSession.groups.length === 0) {
    section.style.display = 'none';
    missionsEl.innerHTML = '';
    return;
  }

  const groupCount = state.importedSession.groups.length;
  const tabCount = state.importedSession.groups.reduce((sum, group) => sum + ((group.tabs || []).length), 0);
  const exportedAt = formatSessionDate(state.importedSession.exportedAt);
  const openUrlSet = new Set(getRealTabs().map(tab => tab.url));

  countEl.textContent = `${groupCount} group${groupCount !== 1 ? 's' : ''} · ${tabCount} tab${tabCount !== 1 ? 's' : ''}`;
  metaEl.textContent = exportedAt ? `Imported from file exported ${exportedAt}` : 'Imported from file';
  missionsEl.innerHTML = state.importedSession.groups.map(group => renderImportedSessionCard(group, openUrlSet)).join('');
  section.style.display = 'block';
}

async function restoreSessionGroups(groups) {
  const safeGroups = Array.isArray(groups) ? groups : [];
  if (safeGroups.length === 0) {
    return { opened: 0, skipped: 0, changedOpenTabs: false };
  }

  const currentTabs = typeof queryRawTabs === 'function' ? await queryRawTabs() : [];
  const plan = sessionSummarizeRestorePlan
    ? sessionSummarizeRestorePlan(safeGroups, currentTabs)
    : sessionPlanRestoreTabs(safeGroups, currentTabs);

  if (plan.toOpen.length === 0) {
    return {
      opened: 0,
      skipped: plan.skipped.length,
      changedOpenTabs: false,
    };
  }

  for (const tab of plan.toOpen) {
    await createTabInChrome(tab.url, { active: false });
  }

  await fetchOpenTabs();

  return {
    opened: plan.toOpen.length,
    skipped: plan.skipped.length,
    changedOpenTabs: true,
  };
}

function createRenderScheduler(renderer, { label = 'render' } = {}) {
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
}

async function restoreImportedSessionTab(groupId, tabId) {
  const found = getImportedSessionTab(groupId, tabId);
  if (!found) {
    return { opened: 0, skipped: 0 };
  }
  const { group, tab } = found;

  return restoreSessionGroups([{ ...group, tabs: [tab] }]);
}

function getImportedSessionTab(groupId, tabId) {
  if (importedSessionController && typeof importedSessionController.getImportedSessionTab === 'function') {
    return importedSessionController.getImportedSessionTab(groupId, tabId);
  }
  if (!state.importedSession || !Array.isArray(state.importedSession.groups) || !groupId || !tabId) return null;
  const group = state.importedSession.groups.find(item => item.id === groupId);
  if (!group || !Array.isArray(group.tabs)) return null;
  const tab = group.tabs.find(item => item && item.id === tabId);
  if (!tab) return null;
  return { group, tab };
}

async function clearImportedSessionTab(groupId, tabId) {
  if (importedSessionController && typeof importedSessionController.clearImportedSessionTab === 'function') {
    return importedSessionController.clearImportedSessionTab(groupId, tabId);
  }
  if (!state.importedSession || !Array.isArray(state.importedSession.groups) || !groupId || !tabId) return false;

  const nextGroups = [];
  let changed = false;

  for (const group of state.importedSession.groups) {
    if (group.id !== groupId) {
      nextGroups.push(group);
      continue;
    }

    const nextTabs = (group.tabs || []).filter(tab => {
      const keep = !(tab && tab.id === tabId);
      if (!keep) changed = true;
      return keep;
    });

    if (nextTabs.length > 0) {
      nextGroups.push({
        ...group,
        tabs: nextTabs,
      });
    }
  }

  if (!changed) return false;

  if (nextGroups.length === 0) {
    await clearImportedSession();
    return true;
  }

  await setImportedSession({
    ...state.importedSession,
    groups: nextGroups,
  });
  return true;
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
  if (greetingEl) greetingEl.textContent = getGreeting();
  if (dateEl)     dateEl.textContent     = getDateDisplay();
  if (searchInput && searchInput.value !== globalSearchQuery) searchInput.value = globalSearchQuery;
  renderAutoRefreshToggle();
  renderMoreMenu();

  // --- Fetch tabs ---
  await fetchOpenTabs();
  if (isStale()) return false;
  const realTabs = getRealTabs();

  // --- Group tabs by domain ---
  // Landing pages (Gmail inbox, Twitter home, etc.) get their own special group
  // so they can be closed together without affecting content tabs on the same domain.
  const LANDING_PAGE_PATTERNS = [
    { hostname: 'mail.google.com', test: (p, h) =>
        !h.includes('#inbox/') && !h.includes('#sent/') && !h.includes('#search/') },
    { hostname: 'x.com',               pathExact: ['/home'] },
    { hostname: 'www.linkedin.com',    pathExact: ['/'] },
    { hostname: 'github.com',          pathExact: ['/'] },
    { hostname: 'www.youtube.com',     pathExact: ['/'] },
    // Merge personal patterns from config.local.js (if it exists)
    ...(typeof LOCAL_LANDING_PAGE_PATTERNS !== 'undefined' ? LOCAL_LANDING_PAGE_PATTERNS : []),
  ];

  function isLandingPage(url) {
    try {
      const parsed = new URL(url);
      return LANDING_PAGE_PATTERNS.some(p => {
        // Support both exact hostname and suffix matching (for wildcard subdomains)
        const hostnameMatch = p.hostname
          ? parsed.hostname === p.hostname
          : p.hostnameEndsWith
            ? parsed.hostname.endsWith(p.hostnameEndsWith)
            : false;
        if (!hostnameMatch) return false;
        if (p.test)       return p.test(parsed.pathname, url);
        if (p.pathPrefix) return parsed.pathname.startsWith(p.pathPrefix);
        if (p.pathExact)  return p.pathExact.includes(parsed.pathname);
        return parsed.pathname === '/';
      });
    } catch { return false; }
  }

  appState.setDomainGroups([]);
  const groupMap    = {};
  const landingTabs = [];

  // Custom group rules from config.local.js (if any)
  const customGroups = typeof LOCAL_CUSTOM_GROUPS !== 'undefined' ? LOCAL_CUSTOM_GROUPS : [];

  // Check if a URL matches a custom group rule; returns the rule or null
  function matchCustomGroup(url) {
    try {
      const parsed = new URL(url);
      return customGroups.find(r => {
        const hostMatch = r.hostname
          ? parsed.hostname === r.hostname
          : r.hostnameEndsWith
            ? parsed.hostname.endsWith(r.hostnameEndsWith)
            : false;
        if (!hostMatch) return false;
        if (r.pathPrefix) return parsed.pathname.startsWith(r.pathPrefix);
        return true; // hostname matched, no path filter
      }) || null;
    } catch { return null; }
  }

  for (const tab of realTabs) {
    try {
      if (isLandingPage(tab.url)) {
        landingTabs.push(tab);
        continue;
      }

      // Check custom group rules first (e.g. merge subdomains, split by path)
      const customRule = matchCustomGroup(tab.url);
      if (customRule) {
        const key = customRule.groupKey;
        if (!groupMap[key]) groupMap[key] = { domain: key, label: customRule.groupLabel, tabs: [] };
        groupMap[key].tabs.push(tab);
        continue;
      }

      let hostname;
      if (tab.url && tab.url.startsWith('file://')) {
        hostname = 'local-files';
      } else {
        hostname = new URL(tab.url).hostname;
      }
      if (!hostname) continue;

      if (!groupMap[hostname]) groupMap[hostname] = { domain: hostname, tabs: [] };
      groupMap[hostname].tabs.push(tab);
    } catch {
      // Skip malformed URLs
    }
  }

  if (landingTabs.length > 0) {
    groupMap['__landing-pages__'] = { domain: '__landing-pages__', tabs: landingTabs };
  }

  // Sort: landing pages first, then domains from landing page sites, then by tab count
  // Collect exact hostnames and suffix patterns for priority sorting
  const landingHostnames = new Set(LANDING_PAGE_PATTERNS.map(p => p.hostname).filter(Boolean));
  const landingSuffixes = LANDING_PAGE_PATTERNS.map(p => p.hostnameEndsWith).filter(Boolean);
  function isLandingDomain(domain) {
    if (landingHostnames.has(domain)) return true;
    return landingSuffixes.some(s => domain.endsWith(s));
  }
  appState.setDomainGroups(Object.values(groupMap).sort((a, b) => {
    const aIsLanding = a.domain === '__landing-pages__';
    const bIsLanding = b.domain === '__landing-pages__';
    if (aIsLanding !== bIsLanding) return aIsLanding ? -1 : 1;

    const aIsPriority = isLandingDomain(a.domain);
    const bIsPriority = isLandingDomain(b.domain);
    if (aIsPriority !== bIsPriority) return aIsPriority ? -1 : 1;

    return b.tabs.length - a.tabs.length;
  }));

  // --- Render domain cards ---
  const openTabsSection      = document.getElementById('openTabsSection');
  const openTabsMissionsEl   = document.getElementById('openTabsMissions');
  const openTabsSectionCount = document.getElementById('openTabsSectionCount');
  const openTabsSectionTitle = document.getElementById('openTabsSectionTitle');

  if (state.domainGroups.length > 0 && openTabsSection) {
    if (openTabsSectionTitle) openTabsSectionTitle.textContent = 'Open tabs';
    openTabsSectionCount.innerHTML = renderOpenTabsSectionCount(state.domainGroups.length, realTabs.length);
    openTabsMissionsEl.innerHTML = state.domainGroups.map(g => renderDomainCard(g)).join('');
    openTabsSection.style.display = 'block';
  } else if (openTabsSection) {
    openTabsSection.style.display = 'none';
  }

  // --- Footer stats ---
  const statTabs = document.getElementById('statTabs');
  if (statTabs) statTabs.textContent = realTabs.length;

  // --- Check for duplicate Tab Out tabs ---
  checkTabOutDupes();

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

const scheduleDashboardRender = createRenderScheduler(renderDashboard, { label: 'dashboard render' });
const scheduleSearchRender = createRenderScheduler(renderSearchResults, { label: 'search render' });

function scheduleDashboardRefresh(delay = 120) {
  if (!autoRefreshEnabled) return;
  clearTimeout(dashboardRefreshTimer);
  dashboardRefreshTimer = setTimeout(() => {
    latestDashboardRenderPromise = scheduleDashboardRender();
  }, delay);
}

chrome.tabs.onCreated.addListener(() => {
  scheduleDashboardRefresh();
});

chrome.tabs.onRemoved.addListener(() => {
  scheduleDashboardRefresh();
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url || changeInfo.status === 'complete') {
    scheduleDashboardRefresh();
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;

  let shouldRender = false;

  if (changes.deferred) {
    const { items } = normalizeDeferredItems(changes.deferred.newValue);
    setDeferredItemsCache(items);
    shouldRender = true;
  }

  if (changes.importedSession) {
    const { session } = normalizeImportedSessionData(changes.importedSession.newValue);
    appState.setImportedSession(session);
    shouldRender = true;
  }

  if (changes.autoRefreshEnabled) {
    autoRefreshEnabled = !!changes.autoRefreshEnabled.newValue;
    renderAutoRefreshToggle();
  }

  if (shouldRender) {
    latestDashboardRenderPromise = scheduleDashboardRender();
  }
});


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
  if (importedSessionController && typeof importedSessionController.getImportedGroupById === 'function') {
    return importedSessionController.getImportedGroupById(groupId);
  }
  return state.importedSession && Array.isArray(state.importedSession.groups)
    ? state.importedSession.groups.find(group => group.id === groupId) || null
    : null;
}

async function scheduleDashboardAndWait() {
  latestDashboardRenderPromise = scheduleDashboardRender();
  await latestDashboardRenderPromise;
}

async function scheduleSearchAndWait() {
  latestSearchRenderPromise = scheduleSearchRender();
  await latestSearchRenderPromise;
}

const actionHandlers = {
  'manual-refresh': async () => {
    closeMoreMenu();
    await scheduleDashboardAndWait();
    showToast('Refreshed');
  },
  'toggle-more-menu': async () => {
    moreMenuOpen = !moreMenuOpen;
    renderMoreMenu();
    if (moreMenuOpen) {
      setTimeout(() => focusMoreMenuItem(0), 0);
    }
  },
  'toggle-auto-refresh': async () => {
    await setAutoRefreshSetting(!autoRefreshEnabled);
    renderAutoRefreshToggle();
    closeMoreMenu();
    showToast(`Auto refresh ${autoRefreshEnabled ? 'enabled' : 'disabled'}`);
  },
  'trigger-import-session': async () => {
    const input = document.getElementById('sessionImportInput');
    closeMoreMenu();
    if (input) input.click();
  },
  'export-all-groups': async () => {
    const payload = sessionCreateSessionExport(state.domainGroups);
    closeMoreMenu();
    downloadJsonFile(buildSessionFilename('all-tabs'), payload);
    showToast(`Exported ${payload.groups.length} group${payload.groups.length !== 1 ? 's' : ''}`);
  },
  'export-imported-session': async () => {
    if (!state.importedSession || !Array.isArray(state.importedSession.groups) || state.importedSession.groups.length === 0) return;
    const exportGroups = typeof sessionDedupeSessionGroups === 'function'
      ? sessionDedupeSessionGroups(state.importedSession.groups)
      : state.importedSession.groups;
    const payload = sessionCreateSessionExport(exportGroups, {
      exportedAt: state.importedSession.exportedAt,
    });
    downloadJsonFile(buildSessionFilename('imported-session'), payload);
    showToast(`Exported ${payload.groups.length} imported group${payload.groups.length !== 1 ? 's' : ''}`);
  },
  'clear-imported-session': async () => {
    await clearImportedSession();
    renderImportedSessionSection();
    await syncImportedSessionSearchResults();
    showToast('Imported session cleared');
  },
  'restore-imported-session': async () => {
    if (!state.importedSession) return;
    const result = await restoreSessionGroups(state.importedSession.groups);
    showToast(`Restored ${result.opened} tab${result.opened !== 1 ? 's' : ''}, skipped ${result.skipped}`);
    if (result.changedOpenTabs) {
      await scheduleDashboardAndWait();
      return;
    }
    renderImportedSessionSection();
  },
  'clear-later-list': async () => {
    const cleared = await clearSavedTabsByState({ completed: false });
    await renderLaterListColumn();
    await scheduleSearchAndWait();
    showToast(cleared > 0 ? `Cleared ${cleared} item${cleared !== 1 ? 's' : ''} from Later list` : 'Later list already empty');
  },
  'clear-later-archive': async () => {
    const cleared = await clearSavedTabsByState({ completed: true });
    await renderLaterListColumn();
    await scheduleSearchAndWait();
    showToast(cleared > 0 ? `Cleared ${cleared} archived item${cleared !== 1 ? 's' : ''}` : 'Archive already empty');
  },
  'close-tabout-dupes': async () => {
    await closeTabOutDupesInChrome();
    playCloseSound();
    await scheduleDashboardAndWait();
    showToast('Closed extra Tab Out tabs');
  },
  'expand-chips': async ({ actionEl }) => {
    const overflowContainer = actionEl.parentElement.querySelector('.page-chips-overflow');
    if (overflowContainer) {
      overflowContainer.style.display = 'contents';
      actionEl.remove();
    }
  },
  'focus-tab': async ({ actionEl }) => {
    const tabId = actionEl.dataset.tabId;
    const tabUrl = actionEl.dataset.tabUrl;
    if (tabId) {
      await focusTabByIdInChrome(tabId);
      return;
    }
    if (tabUrl) await focusTabInChrome(tabUrl);
  },
  'open-later-item': async ({ actionEl }) => {
    const laterUrl = actionEl.dataset.laterUrl;
    if (!laterUrl) return;
    await createTabInChrome(laterUrl, { active: true });
  },
  'restore-imported-group': async ({ actionEl }) => {
    const group = getImportedGroupById(actionEl.dataset.importedGroupId);
    if (!group) return;
    const result = await restoreSessionGroups([group]);
    showToast(`Restored ${result.opened} tab${result.opened !== 1 ? 's' : ''}, skipped ${result.skipped}`);
    if (result.changedOpenTabs) {
      await scheduleDashboardAndWait();
      return;
    }
    renderImportedSessionSection();
  },
  'restore-imported-tab': async ({ actionEl }) => {
    const groupId = actionEl.dataset.importedGroupId;
    const tabId = actionEl.dataset.importedTabId;
    const tabUrl = actionEl.dataset.tabUrl;
    const found = getImportedSessionTab(groupId, tabId);
    if (!found) return;
    if (tabUrl && await focusExactTabByUrlInChrome(tabUrl)) {
      showToast('Opened existing tab');
      return;
    }
    const result = await restoreImportedSessionTab(groupId, tabId);
    showToast(result.opened > 0
      ? `Restored ${result.opened} tab${result.opened !== 1 ? 's' : ''}, skipped ${result.skipped}`
      : 'Tab already open');
    if (result.changedOpenTabs) {
      await scheduleDashboardAndWait();
      return;
    }
    renderImportedSessionSection();
  },
  'clear-imported-group': async ({ actionEl }) => {
    const groupId = actionEl.dataset.importedGroupId;
    if (!groupId) return;
    await clearImportedSessionGroup(groupId);
    renderImportedSessionSection();
    await syncImportedSessionSearchResults();
    showToast('Imported group cleared');
  },
  'clear-imported-tab': async ({ actionEl }) => {
    const groupId = actionEl.dataset.importedGroupId;
    const tabId = actionEl.dataset.importedTabId;
    if (!groupId || !tabId) return;
    const changed = await clearImportedSessionTab(groupId, tabId);
    if (!changed) return;
    renderImportedSessionSection();
    await syncImportedSessionSearchResults();
    showToast('Imported tab cleared');
  },
  'close-single-tab': async ({ actionEl, event }) => {
    event.stopPropagation();
    const tabId = actionEl.dataset.tabId;
    const tabUrl = actionEl.dataset.tabUrl;
    if (!tabId && !tabUrl) return;
    await closeOpenTabInChrome(tabId, tabUrl);
    await fetchOpenTabs();
    playCloseSound();
    const chip = actionEl.closest('.page-chip');
    if (chip) {
      const rect = chip.getBoundingClientRect();
      shootConfetti(rect.left + rect.width / 2, rect.top + rect.height / 2);
    }
    await scheduleDashboardAndWait();
    showToast('Tab closed');
  },
  'defer-single-tab': async ({ actionEl, event }) => {
    event.stopPropagation();
    const tabId = actionEl.dataset.tabId;
    const tabUrl = actionEl.dataset.tabUrl;
    const tabTitle = actionEl.dataset.tabTitle || tabUrl;
    if (!tabUrl) return;
    try {
      await saveTabForLater({ url: tabUrl, title: tabTitle });
    } catch (err) {
      console.error('[tab-out] Failed to save tab:', err);
      showToast('Failed to save tab');
      return;
    }
    await closeOpenTabInChrome(tabId, tabUrl);
    await fetchOpenTabs();
    const chip = actionEl.closest('.page-chip');
    if (chip) {
      const rect = chip.getBoundingClientRect();
      shootConfetti(rect.left + rect.width / 2, rect.top + rect.height / 2);
    }
    await scheduleDashboardAndWait();
    showToast('Added to Later list');
  },
  'check-later': async ({ actionEl }) => {
    const id = actionEl.dataset.laterId;
    if (!id) return;
    await checkOffSavedTab(id);
    const item = actionEl.closest('.later-item');
    if (item) {
      item.classList.add('checked');
      setTimeout(() => {
        item.classList.add('removing');
        setTimeout(() => {
          latestDashboardRenderPromise = scheduleDashboardRender();
        }, 300);
      }, 800);
    } else {
      await scheduleDashboardAndWait();
    }
    showToast('Moved to Archive');
  },
  'dismiss-later': async ({ actionEl }) => {
    const id = actionEl.dataset.laterId;
    if (!id) return;
    const removedItem = await dismissSavedTab(id);
    const item = actionEl.closest('.later-item');
    if (item) {
      item.classList.add('removing');
      setTimeout(() => {
        latestDashboardRenderPromise = scheduleDashboardRender();
      }, 300);
    } else {
      await scheduleDashboardAndWait();
    }
    showToast(removedItem && removedItem.completed ? 'Removed from Archive' : 'Removed from Later list');
  },
  'close-domain-tabs': async ({ actionEl }) => {
    const card = actionEl.closest('.mission-card');
    const group = getDomainGroupByStableId(actionEl.dataset.domainId);
    if (!group) return;
    const urls = group.tabs.map(tab => tab.url);
    const useExact = group.domain === '__landing-pages__' || !!group.label;
    if (useExact) {
      await closeTabsExactInChrome(urls);
    } else {
      await closeTabsByUrlsInChrome(urls);
    }
    if (card) {
      playCloseSound();
      const rect = card.getBoundingClientRect();
      shootConfetti(rect.left + rect.width / 2, rect.top + rect.height / 2);
    }
    const groupLabel = group.domain === '__landing-pages__' ? 'Homepages' : (group.label || friendlyDomain(group.domain));
    await scheduleDashboardAndWait();
    showToast(`Closed ${urls.length} tab${urls.length !== 1 ? 's' : ''} from ${groupLabel}`);
  },
  'export-domain-group': async ({ actionEl }) => {
    const group = getDomainGroupByStableId(actionEl.dataset.domainId);
    if (!group) return;
    const payload = sessionCreateSessionExport([group]);
    downloadJsonFile(buildSessionFilename(group.label || group.domain || 'group'), payload);
    showToast(`Exported ${group.label || friendlyDomain(group.domain)}`);
  },
  'dedup-keep-one': async ({ actionEl }) => {
    const urlsEncoded = actionEl.dataset.dupeUrls || '';
    const urls = urlsEncoded.split(',').map(value => decodeURIComponent(value)).filter(Boolean);
    if (urls.length === 0) return;
    await closeDuplicateTabsInChrome(urls, true);
    playCloseSound();
    await scheduleDashboardAndWait();
    showToast('Closed duplicates, kept one copy each');
  },
  'close-all-open-tabs': async () => {
    const snapshot = getDashboardStateSnapshot();
    const allUrls = snapshot.openTabs
      .filter(tab => tab.url && !tab.url.startsWith('chrome') && !tab.url.startsWith('about:'))
      .map(tab => tab.url);
    document.querySelectorAll('#openTabsMissions .mission-card').forEach(card => {
      shootConfetti(
        card.getBoundingClientRect().left + card.offsetWidth / 2,
        card.getBoundingClientRect().top + card.offsetHeight / 2
      );
    });
    await closeTabsByUrlsInChrome(allUrls);
    playCloseSound();
    await scheduleDashboardAndWait();
    showToast('All tabs closed. Fresh start.');
  },
};

document.addEventListener('click', async (e) => {
  const actionEl = e.target.closest('[data-action]');
  if (!actionEl) return;
  const action = actionEl.dataset.action;
  const handler = actionHandlers[action];
  if (!handler) return;
  try {
    await handler({
      action,
      actionEl,
      event: e,
      snapshot: getDashboardStateSnapshot(),
    });
  } catch (err) {
    console.error(`[tab-out] Action failed: ${action}`, err);
    showToast('Action failed, refreshing view');
    latestDashboardRenderPromise = scheduleDashboardRender();
  }
});

document.addEventListener('change', async (e) => {
  if (e.target.id !== 'sessionImportInput') return;

  const files = Array.from(e.target.files || []);
  if (files.length === 0) return;

  try {
    let nextImportedSession = state.importedSession;
    let importedGroupCount = 0;

    for (const file of files) {
      const text = await file.text();
      const parsed = sessionParseImportedSession(text);
      nextImportedSession = mergeImportedSessions(nextImportedSession, parsed);
      importedGroupCount += parsed.groups.length;
    }

    await setImportedSession(nextImportedSession);
    renderImportedSessionSection();
    await syncImportedSessionSearchResults();
    showToast(`Imported ${importedGroupCount} group${importedGroupCount !== 1 ? 's' : ''}`);
  } catch (err) {
    console.error('[tab-out] Failed to import session:', err);
    showToast(err && err.message ? err.message : 'Import failed');
  } finally {
    e.target.value = '';
  }
});

document.addEventListener('input', async (e) => {
  if (e.target.id === 'globalSearchInput') {
    globalSearchQuery = e.target.value || '';
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
      latestSearchRenderPromise = scheduleSearchRender();
    }, 120);
    return;
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeMoreMenu({ restoreFocus: true });
    return;
  }

  const isToggle = e.target && e.target.id === 'moreMenuToggle';
  const isMenuItem = !!(e.target && e.target.closest && e.target.closest('#moreMenuPanel .more-menu-item'));

  if (!isToggle && !isMenuItem) return;

  if (isToggle && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) {
    e.preventDefault();
    moreMenuOpen = true;
    renderMoreMenu();
    setTimeout(() => focusMoreMenuItem(0), 0);
    return;
  }

  if (!isMenuItem) return;

  const items = getMoreMenuItems();
  const currentIndex = items.indexOf(e.target);
  if (currentIndex === -1) return;

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    focusMoreMenuItem((currentIndex + 1) % items.length);
    return;
  }

  if (e.key === 'ArrowUp') {
    e.preventDefault();
    focusMoreMenuItem((currentIndex - 1 + items.length) % items.length);
  }
});

// ---- Archive toggle — expand/collapse the archive section ----
document.addEventListener('click', (e) => {
  if (!e.target.closest('#moreMenu')) {
    closeMoreMenu();
  }

  const toggle = e.target.closest('#archiveToggle');
  if (!toggle) return;

  toggle.classList.toggle('open');
  const body = document.getElementById('archiveBody');
  if (body) {
    body.style.display = body.style.display === 'none' ? 'block' : 'none';
  }
});

/* ----------------------------------------------------------------
   INITIALIZE
   ---------------------------------------------------------------- */
loadOptionalLocalConfig().finally(async () => {
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
