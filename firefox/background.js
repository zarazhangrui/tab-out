/**
 * background.js — Background Script / Service Worker for Badge Updates
 *
 * Keeps the toolbar badge showing the current open tab count.
 * Works on Chrome (MV3 service worker) and Firefox (MV2 event page).
 *
 * The badge counts real web tabs (skipping browser-internal pages).
 *
 * Color coding gives a quick at-a-glance health signal:
 *   Green  (#3d7a4a) → 1–10 tabs  (focused, manageable)
 *   Amber  (#b8892e) → 11–20 tabs (getting busy)
 *   Red    (#b35a5a) → 21+ tabs   (time to cull!)
 */

// Cross-browser API wrapper: Firefox uses browser.* (native Promises), Chrome uses chrome.*
const browserAPI = {
  tabs:    (typeof browser !== 'undefined' && browser.tabs)    ? browser.tabs    : chrome.tabs,
  windows: (typeof browser !== 'undefined' && browser.windows) ? browser.windows : chrome.windows,
  storage: (typeof browser !== 'undefined' && browser.storage) ? browser.storage : chrome.storage,
  runtime: (typeof browser !== 'undefined' && browser.runtime) ? browser.runtime : chrome.runtime,
};

// Cross-browser action API shim (Chrome uses chrome.action, Firefox MV2 uses chrome.browserAction)
const actionAPI = (typeof chrome !== 'undefined' && chrome.action) ? chrome.action : chrome.browserAction;

// ─── Badge updater ────────────────────────────────────────────────────────────

/**
 * updateBadge()
 *
 * Counts open real-web tabs and updates the extension's toolbar badge.
 * "Real" tabs = not chrome://, not extension pages, not about:blank, etc.
 */
async function updateBadge() {
  try {
    const tabs = await browserAPI.tabs.query({});

    // Only count actual web pages — skip browser internals and extension pages
    const count = tabs.filter(t => {
      const url = t.url || '';
      return (
        !url.startsWith('chrome://') &&
        !url.startsWith('chrome-extension://') &&
        !url.startsWith('about:') &&
        !url.startsWith('edge://') &&
        !url.startsWith('brave://') &&
        !url.startsWith('moz-extension://') &&
        !url.startsWith('resource://')
      );
    }).length;

    // Don't show "0" — an empty badge is cleaner
    await actionAPI.setBadgeText({ text: count > 0 ? String(count) : '' });

    if (count === 0) return;

    // Pick badge color based on workload level
    let color;
    if (count <= 10) {
      color = '#3d7a4a'; // Green — you're in control
    } else if (count <= 20) {
      color = '#b8892e'; // Amber — things are piling up
    } else {
      color = '#b35a5a'; // Red — time to focus and close some tabs
    }

    await actionAPI.setBadgeBackgroundColor({ color });

  } catch {
    // If something goes wrong, clear the badge rather than show stale data
    actionAPI.setBadgeText({ text: '' });
  }
}

// ─── Event listeners ──────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  updateBadge();
});

chrome.runtime.onStartup.addListener(() => {
  updateBadge();
});

chrome.tabs.onCreated.addListener(() => {
  updateBadge();
});

chrome.tabs.onRemoved.addListener(() => {
  updateBadge();
});

chrome.tabs.onUpdated.addListener(() => {
  updateBadge();
});

// ─── Initial run ─────────────────────────────────────────────────────────────

updateBadge();
