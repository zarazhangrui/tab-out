/**
 * background.js — Service Worker for Badge Updates
 *
 * This is Chrome's "always-on" background script for the extension. Unlike a
 * normal webpage script, it keeps running even when no tabs are open.
 *
 * Its only job is to keep the toolbar badge up to date with the current
 * mission count from the dashboard server. The badge is the little number/text
 * that appears on the extension icon in the Chrome toolbar.
 *
 * Color coding gives the user a quick at-a-glance health signal:
 *   Green  (#3d7a4a) → 1–3 missions  (focused, manageable)
 *   Amber  (#b8892e) → 4–6 missions  (getting busy)
 *   Red    (#b35a5a) → 7+ missions   (overloaded — time to cull!)
 */

// ─── Badge updater ────────────────────────────────────────────────────────────

/**
 * updateBadge — Fetches mission stats from the local server and updates the
 * Chrome toolbar badge to reflect the current total mission count.
 */
async function updateBadge() {
  try {
    const res  = await fetch('http://localhost:3456/api/stats');
    const data = await res.json();

    const count = data.totalMissions ?? 0;

    // Don't show "0" — an empty badge is cleaner when there's nothing to do
    if (count === 0) {
      chrome.action.setBadgeText({ text: '' });
      return;
    }

    // Set the text (Chrome badge supports short strings; a number works great)
    chrome.action.setBadgeText({ text: String(count) });

    // Pick a color based on workload level
    let badgeColor;
    if (count <= 3) {
      badgeColor = '#3d7a4a'; // Green — you're in control
    } else if (count <= 6) {
      badgeColor = '#b8892e'; // Amber — things are piling up
    } else {
      badgeColor = '#b35a5a'; // Red — time to focus and close some tabs
    }

    chrome.action.setBadgeBackgroundColor({ color: badgeColor });

  } catch {
    // If the server isn't running, clear the badge rather than show stale data
    chrome.action.setBadgeText({ text: '' });
  }
}

// ─── Side Panel ──────────────────────────────────────────────────────────────

// Open the side panel when the user clicks the extension's toolbar icon.
// This provides an alternative to the new-tab-page override for browsers
// that don't support chrome_url_overrides or override it themselves.
chrome.action.onClicked.addListener(async (tab) => {
  await chrome.sidePanel.open({ windowId: tab.windowId });
});

// ─── Event listeners ──────────────────────────────────────────────────────────

// Update the badge immediately when the extension is first installed
chrome.runtime.onInstalled.addListener(() => {
  updateBadge();
});

// Update the badge when Chrome starts up (e.g. after a reboot)
chrome.runtime.onStartup.addListener(() => {
  updateBadge();
});

// Update the badge whenever a new tab is opened — the user might be adding
// work that should bump the mission count
chrome.tabs.onCreated.addListener(() => {
  updateBadge();
});

// Update the badge whenever a tab is closed — a mission may have been completed
chrome.tabs.onRemoved.addListener(() => {
  updateBadge();
});

// ─── Polling ─────────────────────────────────────────────────────────────────

// Refresh the badge every 60 seconds in case missions are added/edited via
// the dashboard without any tab events firing (e.g. editing inside the app)
setInterval(updateBadge, 60 * 1000);

// Also run once immediately when the service worker first loads
updateBadge();
