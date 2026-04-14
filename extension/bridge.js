/**
 * bridge.js — Shared PostMessage Bridge
 *
 * Middleman between the dashboard (running inside an iframe at localhost:3456)
 * and Chrome's privileged tabs API. The dashboard posts messages requesting
 * tab operations; this module performs the Chrome API calls and replies.
 *
 * Used by both newtab.js and sidepanel.js — each entry point calls
 * setupBridge() with its own DOM references.
 */

const DASHBOARD_ORIGIN = 'http://localhost:3456';

/**
 * Wire up the health-check, fallback UI, and postMessage listener for a
 * given iframe + fallback element pair.
 */
export function setupBridge(frame, fallback) {
  // 1. Check whether the server is reachable.
  //    'no-cors' so the fetch doesn't fail due to CORS headers — we only
  //    need to know *something* answered.
  fetch(DASHBOARD_ORIGIN, { mode: 'no-cors' })
    .then(() => { /* Server is up — iframe is already loading */ })
    .catch(() => showFallback(frame, fallback));

  // 2. Catch cases where the fetch succeeded but the iframe itself errors.
  frame.addEventListener('error', () => showFallback(frame, fallback));

  // 3. Listen for postMessage requests from the dashboard.
  window.addEventListener('message', async (event) => {
    if (event.origin !== DASHBOARD_ORIGIN) return;

    const msg = event.data || {};
    const { messageId, action } = msg;
    if (!messageId || !action) return;

    let response;

    try {
      if (action === 'getTabs') {
        response = await handleGetTabs();
      } else if (action === 'closeTabs') {
        response = msg.exact
          ? await handleCloseTabsExact(msg.urls)
          : await handleCloseTabs(msg.urls);
      } else if (action === 'focusTabs') {
        response = await handleFocusTabs(msg.urls);
      } else if (action === 'focusTab') {
        response = await handleFocusSingleTab(msg.url);
      } else if (action === 'closeDuplicates') {
        response = await handleCloseDuplicates(msg.urls, msg.keepOne);
      } else if (action === 'closeTabOutDupes') {
        response = await handleCloseTabOutDupes();
      } else {
        response = { error: `Unknown action: ${action}` };
      }
    } catch (err) {
      response = { error: err.message };
    }

    if (!response.error) {
      response.success = true;
    }

    frame.contentWindow.postMessage(
      { messageId, ...response },
      DASHBOARD_ORIGIN
    );
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function showFallback(frame, fallback) {
  frame.classList.add('hidden');
  fallback.classList.remove('hidden');
}

// ─── Action handlers ──────────────────────────────────────────────────────────

/**
 * Returns a trimmed list of all open Chrome tabs.  Only the fields the
 * dashboard actually needs are included.
 */
async function handleGetTabs() {
  const tabs = await chrome.tabs.query({});
  const extensionId = chrome.runtime.id;
  const newtabUrl = `chrome-extension://${extensionId}/newtab.html`;

  const simpleTabs = tabs.map(tab => ({
    id:       tab.id,
    url:      tab.url,
    title:    tab.title,
    windowId: tab.windowId,
    active:   tab.active,
    isTabOut: tab.url === newtabUrl || tab.url === 'chrome://newtab/',
  }));
  return { tabs: simpleTabs };
}

/**
 * Closes all tabs whose hostname matches any of the given URLs.
 * file:// URLs are matched exactly (they have no hostname).
 */
async function handleCloseTabs(urls = []) {
  const targetHostnames = [];
  const targetExactUrls = new Set();

  for (const u of urls) {
    if (u.startsWith('file://')) {
      targetExactUrls.add(u);
    } else {
      try { targetHostnames.push(new URL(u).hostname); }
      catch { /* skip unparseable URLs */ }
    }
  }

  const allTabs = await chrome.tabs.query({});

  const matchingTabIds = allTabs
    .filter(tab => {
      const tabUrl = tab.url || '';
      if (tabUrl.startsWith('file://') && targetExactUrls.has(tabUrl)) return true;
      try {
        const tabHostname = new URL(tabUrl).hostname;
        return tabHostname && targetHostnames.includes(tabHostname);
      } catch {
        return false;
      }
    })
    .map(tab => tab.id);

  if (matchingTabIds.length > 0) {
    await chrome.tabs.remove(matchingTabIds);
  }

  return { closedCount: matchingTabIds.length };
}

/**
 * Closes tabs matching exact URLs (not by hostname).  Used for landing
 * pages so closing "Gmail inbox" doesn't also close individual threads.
 */
async function handleCloseTabsExact(urls = []) {
  const urlSet = new Set(urls);
  const allTabs = await chrome.tabs.query({});
  const matchingIds = allTabs
    .filter(tab => urlSet.has(tab.url))
    .map(tab => tab.id);

  if (matchingIds.length > 0) {
    await chrome.tabs.remove(matchingIds);
  }
  return { closedCount: matchingIds.length };
}

/**
 * Switches Chrome's view to the first tab whose hostname matches any of
 * the given URLs.
 */
async function handleFocusTabs(urls = []) {
  if (!urls || urls.length === 0) return { error: 'No URLs provided' };

  const targetHostnames = urls.map(u => {
    try { return new URL(u).hostname; }
    catch { return null; }
  }).filter(Boolean);

  if (targetHostnames.length === 0) return { error: 'No valid URLs' };

  const allTabs = await chrome.tabs.query({});

  const matchingTab = allTabs.find(tab => {
    try { return targetHostnames.includes(new URL(tab.url).hostname); }
    catch { return false; }
  });

  if (!matchingTab) {
    return { error: 'No matching tab found' };
  }

  await chrome.tabs.update(matchingTab.id, { active: true });
  await chrome.windows.update(matchingTab.windowId, { focused: true });

  return { focusedTabId: matchingTab.id };
}

/**
 * Switches to a specific tab by exact URL match.  Prefers tabs in other
 * windows so the user actually sees a window switch.
 */
async function handleFocusSingleTab(url) {
  if (!url) return { error: 'No URL provided' };

  const allTabs = await chrome.tabs.query({});
  const currentWindow = await chrome.windows.getCurrent();

  let matches = allTabs.filter(t => t.url === url);
  if (matches.length === 0) {
    try {
      const targetHost = new URL(url).hostname;
      matches = allTabs.filter(t => {
        try { return new URL(t.url).hostname === targetHost; }
        catch { return false; }
      });
    } catch { /* ignore */ }
  }

  if (matches.length === 0) return { error: 'Tab not found' };

  const match = matches.find(t => t.windowId !== currentWindow.id) || matches[0];

  await chrome.tabs.update(match.id, { active: true });
  await chrome.windows.update(match.windowId, { focused: true });
  return { focusedTabId: match.id };
}

/**
 * Closes duplicate tabs for the given URLs.
 * @param {boolean} keepOne — if true, keep one copy of each URL.
 */
async function handleCloseDuplicates(urls = [], keepOne = true) {
  const allTabs = await chrome.tabs.query({});
  const tabIdsToClose = [];

  for (const url of urls) {
    const matching = allTabs.filter(t => t.url === url);

    if (keepOne) {
      const keep = matching.find(t => t.active) || matching[0];
      for (const tab of matching) {
        if (tab.id !== keep.id) tabIdsToClose.push(tab.id);
      }
    } else {
      for (const tab of matching) tabIdsToClose.push(tab.id);
    }
  }

  if (tabIdsToClose.length > 0) {
    await chrome.tabs.remove(tabIdsToClose);
  }

  return { closedCount: tabIdsToClose.length };
}

/**
 * Closes all duplicate Tab Out new-tab pages except the one the user is
 * currently looking at.
 */
async function handleCloseTabOutDupes() {
  const allTabs = await chrome.tabs.query({});

  const extensionId = chrome.runtime.id;
  const newtabUrl = `chrome-extension://${extensionId}/newtab.html`;

  const tabOutTabs = allTabs.filter(t =>
    t.url === newtabUrl || t.url === 'chrome://newtab/'
  );

  if (tabOutTabs.length <= 1) {
    return { closedCount: 0 };
  }

  const keep = tabOutTabs.find(t => t.active) || tabOutTabs[0];
  const toClose = tabOutTabs.filter(t => t.id !== keep.id).map(t => t.id);

  if (toClose.length > 0) {
    await chrome.tabs.remove(toClose);
  }

  return { closedCount: toClose.length };
}
