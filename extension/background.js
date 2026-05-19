/**
 * background.js — Service Worker for Badge Updates
 *
 * Chrome's "always-on" background script for Tab Out.
 * Its only job: keep the toolbar badge showing the current open tab count.
 *
 * Since we no longer have a server, we query chrome.tabs directly.
 * The badge counts real web tabs (skipping chrome:// and extension pages).
 *
 * Color coding gives a quick at-a-glance health signal:
 *   Green  (#3d7a4a) → 1–10 tabs  (focused, manageable)
 *   Amber  (#b8892e) → 11–20 tabs (getting busy)
 *   Red    (#b35a5a) → 21+ tabs   (time to cull!)
 */

// ─── Badge updater ────────────────────────────────────────────────────────────

/**
 * updateBadge()
 *
 * Counts open real-web tabs and updates the extension's toolbar badge.
 * "Real" tabs = not chrome://, not extension pages, not about:blank.
 */
async function updateBadge() {
  try {
    const tabs = await chrome.tabs.query({});

    // Only count actual web pages — skip browser internals and extension pages
    // Includes Firefox schemes (moz-extension://, resource://, about:*) so the
    // badge stays accurate when running as a Firefox WebExtension.
    const count = tabs.filter(t => {
      const url = t.url || '';
      return (
        !url.startsWith('chrome://') &&
        !url.startsWith('chrome-extension://') &&
        !url.startsWith('moz-extension://') &&
        !url.startsWith('resource://') &&
        !url.startsWith('about:') &&
        !url.startsWith('edge://') &&
        !url.startsWith('brave://')
      );
    }).length;

    // Don't show "0" — an empty badge is cleaner
    await chrome.action.setBadgeText({ text: count > 0 ? String(count) : '' });

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

    await chrome.action.setBadgeBackgroundColor({ color });

  } catch {
    // If something goes wrong, clear the badge rather than show stale data
    chrome.action.setBadgeText({ text: '' });
  }
}

// ─── Single-instance enforcement ──────────────────────────────────────────────

function isTabOutUrl(url) {
  if (!url) return false;
  return url === chrome.runtime.getURL('index.html') ||
    url === 'chrome://newtab/' ||
    url === 'about:newtab' ||
    url === 'about:home';
}

let enforceInFlight = false;

async function enforceSingleTabOut(keepTabId) {
  if (enforceInFlight) return;
  enforceInFlight = true;
  try {
    const allTabs = await chrome.tabs.query({});
    const tabOutTabs = allTabs.filter(t => isTabOutUrl(t.url) || isTabOutUrl(t.pendingUrl));
    if (tabOutTabs.length <= 1) return;
    const toClose = tabOutTabs.filter(t => t.id !== keepTabId).map(t => t.id);
    if (toClose.length > 0) await chrome.tabs.remove(toClose);
  } catch {} finally { enforceInFlight = false; }
}

// ─── Event listeners ──────────────────────────────────────────────────────────

// Update badge when the extension is first installed
chrome.runtime.onInstalled.addListener(() => {
  updateBadge();
});

// Update badge when Chrome starts up
chrome.runtime.onStartup.addListener(() => {
  updateBadge();
});

// Update badge whenever a tab is opened
chrome.tabs.onCreated.addListener(tab => {
  updateBadge();
  if (isTabOutUrl(tab.url) || isTabOutUrl(tab.pendingUrl)) enforceSingleTabOut(tab.id);
});

// Update badge whenever a tab is closed
chrome.tabs.onRemoved.addListener(() => updateBadge());

// Update badge when a tab's URL changes
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  updateBadge();
  if (changeInfo.url && isTabOutUrl(changeInfo.url)) enforceSingleTabOut(tabId);
});

// ─── Initial run ─────────────────────────────────────────────────────────────

// Run once immediately when the service worker first loads
updateBadge();
