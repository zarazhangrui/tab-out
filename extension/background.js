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
    const count = tabs.filter(t => {
      const url = t.url || '';
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

// ─── Single-instance enforcement ──────────────────────────────────────────────

/**
 * isTabOutUrl(url)
 *
 * 判断给定 URL 是否为 Tab Out 自身的新标签页。
 * 同时识别两种形态：
 *   1. chrome-extension://<id>/index.html  —— 扩展页面真实路径
 *   2. chrome://newtab/                    —— Chrome newtab override 解析前的过渡 URL
 *
 * @author Alfie
 * @param {string} url 待判断的标签 URL
 * @returns {boolean} 是否为 Tab Out 自身页面
 */
function isTabOutUrl(url) {
  if (!url) return false;
  const newtabUrl = `chrome-extension://${chrome.runtime.id}/index.html`;
  return url === newtabUrl || url === 'chrome://newtab/';
}

/**
 * enforceSingleTabOut(keepTabId)
 *
 * 关闭除 keepTabId 之外所有其他 Tab Out 标签，保证浏览器中只剩一个最新实例。
 * 在新建/更新事件中调用，将 keepTabId 设为刚触发事件的那个 tab。
 *
 * 注意：使用一个全局 inFlight 标志去抖，避免连续多次新建 Tab Out 时
 * 多个事件并发关闭同一批标签导致 race condition。
 *
 * @author Alfie
 * @param {number} keepTabId 需要保留的 Tab Out 标签 ID（通常是刚被打开/导航的那个）
 * @returns {Promise<void>}
 */
let enforceInFlight = false;
async function enforceSingleTabOut(keepTabId) {
  if (enforceInFlight) return;
  enforceInFlight = true;
  try {
    const allTabs = await chrome.tabs.query({});
    const tabOutTabs = allTabs.filter(t => isTabOutUrl(t.url) || isTabOutUrl(t.pendingUrl));
    if (tabOutTabs.length <= 1) return;

    const toClose = tabOutTabs
      .filter(t => t.id !== keepTabId)
      .map(t => t.id);

    if (toClose.length > 0) {
      await chrome.tabs.remove(toClose);
    }
  } catch {
    // 标签可能在我们关闭之前已被用户手动关闭——忽略即可
  } finally {
    enforceInFlight = false;
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
chrome.tabs.onCreated.addListener(tab => {
  updateBadge();
  // 新建时若 Chrome 已经把 URL 填上（例如直接打开 newtab override），
  // 立刻执行单实例约束；否则交给下方 onUpdated 处理。
  if (isTabOutUrl(tab.url) || isTabOutUrl(tab.pendingUrl)) {
    enforceSingleTabOut(tab.id);
  }
});

// Update badge whenever a tab is closed
chrome.tabs.onRemoved.addListener(() => {
  updateBadge();
});

// Update badge when a tab's URL changes (e.g. navigating to/from chrome://)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  updateBadge();
  // 只在 URL 真正变化的事件中触发，避免 status/title 变化带来的额外调用。
  if (changeInfo.url && isTabOutUrl(changeInfo.url)) {
    enforceSingleTabOut(tabId);
  }
});

// ─── Initial run ─────────────────────────────────────────────────────────────

// Run once immediately when the service worker first loads
updateBadge();
