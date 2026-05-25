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
/**
 * extractSuspendedUrl(url)
 *
 * Detects tabs suspended by Tab Suspender extensions and extracts the original URL.
 */
function extractSuspendedUrl(url) {
  if (!url || !url.startsWith('chrome-extension://')) return null;
  try {
    const parsed = new URL(url);
    for (const key of ['url', 'uri']) {
      const val = parsed.searchParams.get(key);
      if (val && (val.startsWith('http://') || val.startsWith('https://') || val.startsWith('file://'))) return val;
    }
    const hash = parsed.hash.slice(1);
    if (hash) {
      const params = new URLSearchParams(hash);
      for (const key of ['uri', 'url']) {
        const val = params.get(key);
        if (val && (val.startsWith('http://') || val.startsWith('https://') || val.startsWith('file://'))) return val;
      }
    }
  } catch {}
  return null;
}

async function updateBadge() {
  try {
    const tabs = await chrome.tabs.query({});

    const count = tabs.filter(t => {
      const url = t.url || '';
      // Suspended tabs count as real tabs
      if (extractSuspendedUrl(url)) return true;
      return (
        !url.startsWith('chrome://') &&
        !url.startsWith('chrome-extension://') &&
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
chrome.tabs.onCreated.addListener(() => {
  updateBadge();
});

// Update badge whenever a tab is closed
chrome.tabs.onRemoved.addListener(() => {
  updateBadge();
});

// Update badge when a tab's URL changes (e.g. navigating to/from chrome://)
chrome.tabs.onUpdated.addListener(() => {
  updateBadge();
});

// ─── Frequent Sites Prediction ───────────────────────────────────────────────

const PREDICTION_ALARM = 'compute-frequent-sites';
const PREDICTION_WINDOW_MS = 48 * 60 * 60 * 1000; // 48 hours
const PREDICTION_INTERVAL_MIN = 180; // 3 hours
const PREDICTION_TOP_N = 8;

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === PREDICTION_ALARM) computeFrequentSites();
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(PREDICTION_ALARM, { periodInMinutes: PREDICTION_INTERVAL_MIN });
  computeFrequentSites();
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(PREDICTION_ALARM, { periodInMinutes: PREDICTION_INTERVAL_MIN });
  computeFrequentSites();
});

async function computeFrequentSites() {
  try {
    const now = Date.now();
    const since = now - PREDICTION_WINDOW_MS;
    const hour = new Date().getHours();
    const currentSlot = Math.floor(hour / 3); // 0-7, 8 slots per day

    const items = await chrome.history.search({
      text: '',
      startTime: since,
      endTime: now,
      maxResults: 5000,
    });

    // Score by visit count weighted by time-slot match
    const siteScores = {};
    for (const item of items) {
      if (!item.url || item.url.startsWith('chrome://') || item.url.startsWith('chrome-extension://')) continue;
      let hostname;
      try { hostname = new URL(item.url).hostname; } catch { continue; }
      if (!hostname) continue;

      const visitSlot = item.lastVisitTime ? Math.floor(new Date(item.lastVisitTime).getHours() / 3) : -1;
      const slotBonus = visitSlot === currentSlot ? 2.0 : 1.0;
      const visitCount = item.visitCount || 1;

      if (!siteScores[hostname]) siteScores[hostname] = { hostname, score: 0, url: item.url, title: item.title };
      siteScores[hostname].score += visitCount * slotBonus;
      // Keep the most-visited URL for this hostname
      if (visitCount > (siteScores[hostname]._maxVisits || 0)) {
        siteScores[hostname]._maxVisits = visitCount;
        siteScores[hostname].url = item.url;
        siteScores[hostname].title = item.title;
      }
    }

    // Filter out currently open tabs
    const openTabs = await chrome.tabs.query({});
    const openHostnames = new Set();
    for (const t of openTabs) {
      try {
        const u = extractSuspendedUrl(t.url) || t.url;
        if (u) openHostnames.add(new URL(u).hostname);
      } catch {}
    }

    const candidates = Object.values(siteScores)
      .filter(s => !openHostnames.has(s.hostname))
      .sort((a, b) => b.score - a.score)
      .slice(0, PREDICTION_TOP_N)
      .map(s => ({ hostname: s.hostname, url: s.url, title: s.title || s.hostname, score: s.score }));

    await chrome.storage.local.set({
      frequentSites: candidates,
      frequentSitesUpdatedAt: now,
    });
  } catch (e) {
    // Silently fail — non-critical feature
  }
}

// ─── Initial run ─────────────────────────────────────────────────────────────

// Run once immediately when the service worker first loads
updateBadge();
