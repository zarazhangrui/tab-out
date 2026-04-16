/**
 * background.js — Background Script for Badge Updates (Firefox)
 *
 * Firefox event page for Tab Out.
 * Its only job: keep the toolbar badge showing the current open tab count.
 *
 * Since we no longer have a server, we query browser.tabs directly.
 * The badge counts real web tabs (skipping browser-internal pages).
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
 * "Real" tabs = not chrome://, not extension pages, not about:blank, etc.
 */
async function updateBadge() {
  try {
    const tabs = await browser.tabs.query({});

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
    await browser.browserAction.setBadgeText({ text: count > 0 ? String(count) : '' });

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

    await browser.browserAction.setBadgeBackgroundColor({ color });

  } catch {
    // If something goes wrong, clear the badge rather than show stale data
    browser.browserAction.setBadgeText({ text: '' });
  }
}

// ─── Event listeners ──────────────────────────────────────────────────────────

browser.runtime.onInstalled.addListener(() => {
  updateBadge();
});

browser.runtime.onStartup.addListener(() => {
  updateBadge();
});

browser.tabs.onCreated.addListener(() => {
  updateBadge();
});

browser.tabs.onRemoved.addListener(() => {
  updateBadge();
});

browser.tabs.onUpdated.addListener(() => {
  updateBadge();
});

// ─── Initial run ─────────────────────────────────────────────────────────────

updateBadge();
