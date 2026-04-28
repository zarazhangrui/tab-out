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


/* ----------------------------------------------------------------
   CHROME TABS — Direct API Access

   Since this page IS the extension's new tab page, it has full
   access to chrome.tabs and chrome.storage. No middleman needed.
   ---------------------------------------------------------------- */

// All open tabs — populated by fetchOpenTabs()
let openTabs = [];

/**
 * fetchOpenTabs()
 *
 * Reads all currently open browser tabs directly from Chrome.
 * Sets the extensionId flag so we can identify Tab Out's own pages.
 */
async function fetchOpenTabs() {
  try {
    const extensionId = chrome.runtime.id;
    // The new URL for this page is now index.html (not newtab.html)
    const newtabUrl = `chrome-extension://${extensionId}/index.html`;

    const tabs = await chrome.tabs.query({});
    openTabs = tabs.map(t => ({
      id:       t.id,
      url:      t.url,
      title:    t.title,
      windowId: t.windowId,
      active:   t.active,
      // Flag Tab Out's own pages so we can detect duplicate new tabs
      isTabOut: t.url === newtabUrl || t.url === 'chrome://newtab/',
    }));
  } catch {
    // chrome.tabs API unavailable (shouldn't happen in an extension page)
    openTabs = [];
  }
}

/**
 * closeTabsByUrls(urls)
 *
 * Closes all open tabs whose hostname matches any of the given URLs.
 * After closing, re-fetches the tab list to keep our state accurate.
 *
 * Special case: file:// URLs are matched exactly (they have no hostname).
 */
async function closeTabsByUrls(urls) {
  if (!urls || urls.length === 0) return;

  // Separate file:// URLs (exact match) from regular URLs (hostname match)
  const targetHostnames = [];
  const exactUrls = new Set();

  for (const u of urls) {
    if (u.startsWith('file://')) {
      exactUrls.add(u);
    } else {
      try { targetHostnames.push(new URL(u).hostname); }
      catch { /* skip unparseable */ }
    }
  }

  const allTabs = await chrome.tabs.query({});
  const toClose = allTabs
    .filter(tab => {
      const tabUrl = tab.url || '';
      if (tabUrl.startsWith('file://') && exactUrls.has(tabUrl)) return true;
      try {
        const tabHostname = new URL(tabUrl).hostname;
        return tabHostname && targetHostnames.includes(tabHostname);
      } catch { return false; }
    })
    .map(tab => tab.id);

  if (toClose.length > 0) await chrome.tabs.remove(toClose);
  await fetchOpenTabs();
}

/**
 * closeTabsExact(urls)
 *
 * Closes tabs by exact URL match (not hostname). Used for landing pages
 * so closing "Gmail inbox" doesn't also close individual email threads.
 */
async function closeTabsExact(urls) {
  if (!urls || urls.length === 0) return;
  const urlSet = new Set(urls);
  const allTabs = await chrome.tabs.query({});
  const toClose = allTabs.filter(t => urlSet.has(t.url)).map(t => t.id);
  if (toClose.length > 0) await chrome.tabs.remove(toClose);
  await fetchOpenTabs();
}

/**
 * focusTab(url)
 *
 * Switches Chrome to the tab with the given URL (exact match first,
 * then hostname fallback). Also brings the window to the front.
 */
async function focusTab(url) {
  if (!url) return;
  const allTabs = await chrome.tabs.query({});
  const currentWindow = await chrome.windows.getCurrent();

  // Try exact URL match first
  let matches = allTabs.filter(t => t.url === url);

  // Fall back to hostname match
  if (matches.length === 0) {
    try {
      const targetHost = new URL(url).hostname;
      matches = allTabs.filter(t => {
        try { return new URL(t.url).hostname === targetHost; }
        catch { return false; }
      });
    } catch {}
  }

  if (matches.length === 0) return;

  // Prefer a match in a different window so it actually switches windows
  const match = matches.find(t => t.windowId !== currentWindow.id) || matches[0];
  await chrome.tabs.update(match.id, { active: true });
  await chrome.windows.update(match.windowId, { focused: true });
}

/**
 * closeDuplicateTabs(urls, keepOne)
 *
 * Closes duplicate tabs for the given list of URLs.
 * keepOne=true → keep one copy of each, close the rest.
 * keepOne=false → close all copies.
 */
async function closeDuplicateTabs(urls, keepOne = true) {
  const allTabs = await chrome.tabs.query({});
  const toClose = [];

  for (const url of urls) {
    const matching = allTabs.filter(t => t.url === url);
    if (keepOne) {
      const keep = matching.find(t => t.active) || matching[0];
      for (const tab of matching) {
        if (tab.id !== keep.id) toClose.push(tab.id);
      }
    } else {
      for (const tab of matching) toClose.push(tab.id);
    }
  }

  if (toClose.length > 0) await chrome.tabs.remove(toClose);
  await fetchOpenTabs();
}

/**
 * closeTabOutDupes()
 *
 * Closes all duplicate Tab Out new-tab pages except the current one.
 */
async function closeTabOutDupes() {
  const extensionId = chrome.runtime.id;
  const newtabUrl = `chrome-extension://${extensionId}/index.html`;

  const allTabs = await chrome.tabs.query({});
  const currentWindow = await chrome.windows.getCurrent();
  const tabOutTabs = allTabs.filter(t =>
    t.url === newtabUrl || t.url === 'chrome://newtab/'
  );

  if (tabOutTabs.length <= 1) return;

  // Keep the active Tab Out tab in the CURRENT window — that's the one the
  // user is looking at right now. Falls back to any active one, then the first.
  const keep =
    tabOutTabs.find(t => t.active && t.windowId === currentWindow.id) ||
    tabOutTabs.find(t => t.active) ||
    tabOutTabs[0];
  const toClose = tabOutTabs.filter(t => t.id !== keep.id).map(t => t.id);
  if (toClose.length > 0) await chrome.tabs.remove(toClose);
  await fetchOpenTabs();
}


/* ----------------------------------------------------------------
   OTHER DEVICES — chrome.sessions API

   chrome.sessions.getDevices() returns tabs/windows synced from
   other devices on the same Chrome profile (when "Open tabs" is on
   in Chrome Sync). Each tab carries a sessionId we can pass to
   chrome.sessions.restore(sessionId) to reopen it locally. Chrome
   does NOT expose any way to close a tab on a remote device, so the
   remote-device cards are read-only (open / save-for-later only).
   ---------------------------------------------------------------- */

// Cached fetch result. Shape: [{ deviceName, lastModified, tabs: [...] }]
let otherDeviceGroups = [];

/**
 * fetchOtherDeviceTabs()
 *
 * Reads synced sessions from other devices on this Chrome profile.
 * Flattens the per-device session list (each containing windows or
 * single tabs) into one tab array per device. Skips browser-internal
 * URLs and dedupes by URL within each device. Most-recently-used
 * tab first.
 */
async function fetchOtherDeviceTabs() {
  otherDeviceGroups = [];

  if (!chrome.sessions || typeof chrome.sessions.getDevices !== 'function') {
    return otherDeviceGroups;
  }

  let devices = [];
  try {
    devices = await new Promise((resolve, reject) => {
      try {
        chrome.sessions.getDevices((result) => {
          const err = chrome.runtime.lastError;
          if (err) reject(err); else resolve(result || []);
        });
      } catch (e) { reject(e); }
    });
  } catch (err) {
    console.warn('[tab-out] chrome.sessions.getDevices failed:', err);
    return otherDeviceGroups;
  }

  for (const device of devices) {
    const tabs = [];
    const seenUrls = new Set();
    let lastModified = 0;

    for (const session of (device.sessions || [])) {
      if (session.lastModified && session.lastModified > lastModified) {
        lastModified = session.lastModified;
      }

      // A session is either a single tab or a window containing tabs
      const windowTabs = session.window && Array.isArray(session.window.tabs)
        ? session.window.tabs
        : [];
      const allTabs = session.tab ? [session.tab, ...windowTabs] : windowTabs;

      for (const t of allTabs) {
        const url = t.url || '';
        if (!url) continue;
        if (
          url.startsWith('chrome://') ||
          url.startsWith('chrome-extension://') ||
          url.startsWith('about:') ||
          url.startsWith('edge://') ||
          url.startsWith('brave://')
        ) continue;
        if (seenUrls.has(url)) continue;
        seenUrls.add(url);
        tabs.push({
          url,
          title:     t.title || url,
          sessionId: t.sessionId,
        });
      }
    }

    if (tabs.length === 0) continue;

    otherDeviceGroups.push({
      deviceName: device.deviceName || 'Other device',
      lastModified,
      tabs,
    });
  }

  // Most recently active device first
  otherDeviceGroups.sort((a, b) => b.lastModified - a.lastModified);
  return otherDeviceGroups;
}

/**
 * restoreRemoteSession(sessionId)
 *
 * Reopens a synced tab from another device on THIS device. There is
 * no API to focus the original device; "restore" creates a new local
 * tab pointing at that URL. Falls back to chrome.tabs.create on error.
 */
async function restoreRemoteSession(sessionId, fallbackUrl) {
  if (sessionId && chrome.sessions && typeof chrome.sessions.restore === 'function') {
    try {
      await new Promise((resolve, reject) => {
        chrome.sessions.restore(sessionId, () => {
          const err = chrome.runtime.lastError;
          if (err) reject(err); else resolve();
        });
      });
      return;
    } catch (err) {
      console.warn('[tab-out] sessions.restore failed, falling back to create:', err);
    }
  }
  if (fallbackUrl) {
    try { await chrome.tabs.create({ url: fallbackUrl, active: true }); }
    catch (e) { console.warn('[tab-out] tabs.create fallback failed:', e); }
  }
}

/**
 * deviceIcon(deviceName)
 *
 * Best-effort guess of a phone vs laptop icon based on the device
 * name string Chrome reports (e.g. "Jatin's MacBook Pro", "Pixel 8").
 */
function deviceIcon(deviceName) {
  const n = (deviceName || '').toLowerCase();
  const isPhone =
    n.includes('phone') || n.includes('iphone') || n.includes('android') ||
    n.includes('pixel') || n.includes('galaxy');
  const isTablet = n.includes('ipad') || n.includes('tablet');

  if (isPhone) {
    return `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.8" stroke="currentColor" width="14" height="14" style="vertical-align:-2px"><path stroke-linecap="round" stroke-linejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 0 0 6 3.75v16.5a2.25 2.25 0 0 0 2.25 2.25h7.5A2.25 2.25 0 0 0 18 20.25V3.75a2.25 2.25 0 0 0-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3"/></svg>`;
  }
  if (isTablet) {
    return `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.8" stroke="currentColor" width="14" height="14" style="vertical-align:-2px"><rect x="4" y="3" width="16" height="18" rx="2"/><path stroke-linecap="round" stroke-linejoin="round" d="M11 18h2"/></svg>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.8" stroke="currentColor" width="14" height="14" style="vertical-align:-2px"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 18 3.75 19.5h16.5L21.75 18M4.5 4.5h15a.75.75 0 0 1 .75.75v11.25H3.75V5.25a.75.75 0 0 1 .75-.75Z"/></svg>`;
}

/**
 * renderDeviceSubsection(device, deviceIndex)
 *
 * Renders one synced device as a subsection: a small device header
 * (name + last-active + tab count) followed by domain-grouped cards
 * built with the same renderDomainCard logic the local section uses
 * (read-only mode — no close buttons, since Chrome can't close tabs
 * on a remote device).
 */
function renderDeviceSubsection(device, deviceIndex) {
  const tabs   = device.tabs || [];
  const groups = groupTabsByDomain(tabs);

  const lastSeen = device.lastModified
    ? `last active ${timeAgo(new Date(device.lastModified * 1000).toISOString())}`
    : '';

  const cardsHtml = groups
    .map(g => renderDomainCard(g, { remote: true, deviceIndex }))
    .join('');

  return `
    <div class="device-subsection" data-device-index="${deviceIndex}">
      <div class="device-subsection-header">
        <span class="device-subsection-name">${deviceIcon(device.deviceName)} ${device.deviceName}</span>
        <span class="device-subsection-meta">${tabs.length} tab${tabs.length !== 1 ? 's' : ''}${lastSeen ? ' · ' + lastSeen : ''}</span>
      </div>
      <div class="missions">${cardsHtml}</div>
    </div>`;
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
  const { deferred = [] } = await chrome.storage.local.get('deferred');
  deferred.push({
    id:        Date.now().toString(),
    url:       tab.url,
    title:     tab.title,
    savedAt:   new Date().toISOString(),
    completed: false,
    dismissed: false,
  });
  await chrome.storage.local.set({ deferred });
}

/**
 * getSavedTabs()
 *
 * Returns all saved tabs from chrome.storage.local.
 * Filters out dismissed items (those are gone for good).
 * Splits into active (not completed) and archived (completed).
 */
async function getSavedTabs() {
  const { deferred = [] } = await chrome.storage.local.get('deferred');
  const visible = deferred.filter(t => !t.dismissed);
  return {
    active:   visible.filter(t => !t.completed),
    archived: visible.filter(t => t.completed),
  };
}

/**
 * checkOffSavedTab(id)
 *
 * Marks a saved tab as completed (checked off). It moves to the archive.
 */
async function checkOffSavedTab(id) {
  const { deferred = [] } = await chrome.storage.local.get('deferred');
  const tab = deferred.find(t => t.id === id);
  if (tab) {
    tab.completed = true;
    tab.completedAt = new Date().toISOString();
    await chrome.storage.local.set({ deferred });
  }
}

/**
 * dismissSavedTab(id)
 *
 * Marks a saved tab as dismissed (removed from all lists).
 */
async function dismissSavedTab(id) {
  const { deferred = [] } = await chrome.storage.local.get('deferred');
  const tab = deferred.find(t => t.id === id);
  if (tab) {
    tab.dismissed = true;
    await chrome.storage.local.set({ deferred });
  }
}


/* ----------------------------------------------------------------
   SITE NAMES — chrome.storage.local

   User-editable nickname for any URL. Keyed by full URL so the same
   page renamed once shows the same nickname everywhere it appears,
   including remote-device cards (because Chrome Sync gives us the
   exact same URL across devices). Lives in chrome.storage.local
   (per-profile, persists across browser restarts).

   Storage shape under "siteNames":
   { "https://example.com/foo": "My nickname", ... }
   ---------------------------------------------------------------- */

let siteNames = {};

/**
 * loadSiteNames()
 *
 * Reads the siteNames map from chrome.storage.local into the in-memory
 * cache. Called once before the dashboard renders, and again after any
 * edit so the view stays consistent.
 */
async function loadSiteNames() {
  try {
    const { siteNames: s = {} } = await chrome.storage.local.get('siteNames');
    siteNames = s || {};
  } catch (err) {
    console.warn('[tab-out] Failed to load siteNames:', err);
    siteNames = {};
  }
}

/**
 * setSiteName(url, name)
 *
 * Persists a custom name for a URL. Empty/whitespace name clears the
 * override (back to the auto-cleaned title).
 */
async function setSiteName(url, name) {
  if (!url) return;
  const trimmed = (name || '').trim();
  if (!trimmed) {
    delete siteNames[url];
  } else {
    siteNames[url] = trimmed;
  }
  try {
    await chrome.storage.local.set({ siteNames });
  } catch (err) {
    console.warn('[tab-out] Failed to save siteNames:', err);
  }
}

/**
 * defaultLabelForTab(tab)
 *
 * The auto-computed label we'd show if there's no custom name. Pulled
 * out so the edit input can use it as a placeholder, and so the
 * search query can match against it too.
 */
function defaultLabelForTab(tab) {
  let hostname = '';
  try { hostname = new URL(tab.url).hostname; } catch {}
  let label = cleanTitle(smartTitle(stripTitleNoise(tab.title || ''), tab.url), hostname);
  try {
    const parsed = new URL(tab.url);
    if (parsed.hostname === 'localhost' && parsed.port) label = `${parsed.port} ${label}`;
  } catch {}
  return label || tab.url || '';
}


/* ----------------------------------------------------------------
   GLOBAL SEARCH — in-memory filter applied at render time

   A single query string filters chips across local tabs, every
   remote-device subsection, and the saved-for-later list. Matches
   on custom name, auto-title, and URL (case-insensitive).
   ---------------------------------------------------------------- */

let searchQuery = '';

/* ----------------------------------------------------------------
   DOMAIN ORDER — persisted user-chosen ordering of local domain cards

   Storage shape under "domainOrder":
   ["github.com", "x.com", "__landing-pages__", ...]

   Domains not in this list fall back to the default sort (landing
   first, priority sites next, then by tab count). When the user
   reorders, we save the visible-card order and append any unseen
   (e.g. filtered-out) domains at the end so their relative ordering
   isn't lost.
   ---------------------------------------------------------------- */

let domainOrder = [];

async function loadDomainOrder() {
  try {
    const { domainOrder: o = [] } = await chrome.storage.local.get('domainOrder');
    domainOrder = Array.isArray(o) ? o : [];
  } catch (err) {
    console.warn('[tab-out] Failed to load domainOrder:', err);
    domainOrder = [];
  }
}

async function persistDomainOrder() {
  try {
    await chrome.storage.local.set({ domainOrder });
  } catch (err) {
    console.warn('[tab-out] Failed to save domainOrder:', err);
  }
}

/**
 * applyUserDomainOrder(groups)
 *
 * Stable-sorts groups so that any group whose domain is in the user's
 * persisted order comes first (in that order), and the rest keep their
 * incoming order (which is already the "natural" sort from
 * groupTabsByDomain — landing pages first, etc.).
 */
function applyUserDomainOrder(groups) {
  if (!domainOrder || domainOrder.length === 0) return groups;
  const orderIndex = new Map(domainOrder.map((d, i) => [d, i]));
  const indexed = groups.map((g, naturalIdx) => ({
    g,
    primary:   orderIndex.has(g.domain) ? orderIndex.get(g.domain) : Infinity,
    secondary: naturalIdx,
  }));
  indexed.sort((a, b) => a.primary - b.primary || a.secondary - b.secondary);
  return indexed.map(x => x.g);
}

function tabMatchesQuery(tab, q) {
  if (!q) return true;
  const url   = (tab.url || '').toLowerCase();
  const title = (tab.title || '').toLowerCase();
  const named = (siteNames[tab.url] || '').toLowerCase();
  const auto  = defaultLabelForTab(tab).toLowerCase();
  return url.includes(q) || title.includes(q) || named.includes(q) || auto.includes(q);
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
   IN-MEMORY STORE FOR OPEN-TAB GROUPS
   ---------------------------------------------------------------- */
let domainGroups = [];


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
  return openTabs.filter(t => {
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
  const tabOutTabs = openTabs.filter(t => t.isTabOut);
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
   PAGE CHIP RENDERER — shared by domain cards (local + remote)

   opts.remote   = true  → chip click restores a synced session
                   instead of focusing a local tab; chip has no
                   close-X button (Chrome can't close remote tabs).
   opts.groupKey = the domain or group key, used by cleanTitle()
                   to strip site names from titles.
   ---------------------------------------------------------------- */

function renderChip(tab, urlCounts = {}, opts = {}) {
  const groupKey = opts.groupKey || '';
  let hostname = '';
  try { hostname = new URL(tab.url).hostname; } catch {}

  // Auto-computed label: domain-stripped, smart-titled, port-prefixed
  // for localhost. Used as fallback when no custom name is set, and as
  // placeholder text when editing.
  let autoLabel = cleanTitle(smartTitle(stripTitleNoise(tab.title || ''), tab.url), groupKey || hostname);
  try {
    const parsed = new URL(tab.url);
    if (parsed.hostname === 'localhost' && parsed.port) autoLabel = `${parsed.port} ${autoLabel}`;
  } catch {}

  const customName = siteNames[tab.url] || '';
  const label      = customName || autoLabel;

  const count     = urlCounts[tab.url] || 1;
  const dupeTag   = count > 1 ? ` <span class="chip-dupe-badge">(${count}x)</span>` : '';
  const chipClass = (count > 1 ? ' chip-has-dupes' : '') + (customName ? ' chip-has-custom-name' : '');
  const safeUrl   = (tab.url || '').replace(/"/g, '&quot;');
  const safeTitle = label.replace(/"/g, '&quot;');
  const safeAuto  = autoLabel.replace(/"/g, '&quot;');
  const faviconUrl = hostname ? `https://www.google.com/s2/favicons?domain=${hostname}&sz=16` : '';

  // Remote chips open via chrome.sessions.restore (sessionId), local chips
  // focus an existing tab by URL.
  const clickAction = opts.remote ? 'restore-remote-tab' : 'focus-tab';
  const sessionAttr = opts.remote
    ? ` data-session-id="${(tab.sessionId || '').replace(/"/g, '&quot;')}"`
    : '';

  // No close button on remote chips — Chrome doesn't expose any way to
  // close tabs on another device.
  const closeBtn = opts.remote
    ? ''
    : `<button class="chip-action chip-close" data-action="close-single-tab" data-tab-url="${safeUrl}" title="Close this tab">
         <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
       </button>`;

  // Pencil button — toggles inline rename input. Available on local AND
  // remote chips so you can rename a synced page from any device.
  const editBtn = `<button class="chip-action chip-edit" data-action="edit-name" data-tab-url="${safeUrl}" data-auto-label="${safeAuto}" title="Rename">
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M16.862 4.487 18.549 2.799a2.121 2.121 0 1 1 3 3L19.862 7.487M16.862 4.487 6.687 14.662a4.5 4.5 0 0 0-1.13 1.897l-1.05 3.504 3.504-1.05a4.5 4.5 0 0 0 1.897-1.13L19.862 7.487M16.862 4.487l3 3" /></svg>
  </button>`;

  return `<div class="page-chip clickable${chipClass}" data-action="${clickAction}" data-tab-url="${safeUrl}"${sessionAttr} title="${safeTitle}">
    ${faviconUrl ? `<img class="chip-favicon" src="${faviconUrl}" alt="" onerror="this.style.display='none'">` : ''}
    <span class="chip-text">${label}</span>${dupeTag}
    <div class="chip-actions">
      ${editBtn}
      <button class="chip-action chip-save" data-action="defer-single-tab" data-tab-url="${safeUrl}" data-tab-title="${safeTitle}" title="Save for later">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z" /></svg>
      </button>
      ${closeBtn}
    </div>
  </div>`;
}


/* ----------------------------------------------------------------
   OVERFLOW CHIPS ("+N more" expand button in domain cards)
   ---------------------------------------------------------------- */

function buildOverflowChips(hiddenTabs, urlCounts = {}, opts = {}) {
  const hiddenChips = hiddenTabs.map(tab => renderChip(tab, urlCounts, opts)).join('');

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
 * renderDomainCard(group, opts)
 *
 * Builds the HTML for one domain group card.
 * group = { domain: string, tabs: [...] }
 * opts.remote      = true → read-only card (no close/dedup buttons; chips
 *                    open via sessions.restore). For tabs synced from
 *                    other devices.
 * opts.deviceIndex = index of the owning device (used to namespace IDs).
 */
function renderDomainCard(group, opts = {}) {
  const remote    = !!opts.remote;
  const tabs      = group.tabs || [];
  const tabCount  = tabs.length;
  const isLanding = group.domain === '__landing-pages__';
  const idPrefix  = remote ? `device-${opts.deviceIndex || 0}-domain-` : 'domain-';
  const stableId  = idPrefix + group.domain.replace(/[^a-z0-9]/g, '-');

  // Count duplicates (exact URL match) — only meaningful for local tabs;
  // remote tabs are pre-deduped by URL across the device.
  const urlCounts = {};
  for (const tab of tabs) urlCounts[tab.url] = (urlCounts[tab.url] || 0) + 1;
  const dupeUrls    = Object.entries(urlCounts).filter(([, c]) => c > 1);
  const hasDupes    = !remote && dupeUrls.length > 0;
  const totalExtras = dupeUrls.reduce((s, [, c]) => s + c - 1, 0);

  const tabBadge = `<span class="open-tabs-badge">
    ${ICONS.tabs}
    ${tabCount} tab${tabCount !== 1 ? 's' : ''}${remote ? '' : ' open'}
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

  const chipOpts    = { remote, groupKey: group.domain };
  const visibleTabs = uniqueTabs.slice(0, 8);
  const extraCount  = uniqueTabs.length - visibleTabs.length;

  const pageChips = visibleTabs.map(tab => renderChip(tab, urlCounts, chipOpts)).join('')
    + (extraCount > 0 ? buildOverflowChips(uniqueTabs.slice(8), urlCounts, chipOpts) : '');

  // Action buttons. None for remote cards — Chrome can't close tabs on
  // another device, so a close button would be a lie.
  let actionsHtml = '';
  if (!remote) {
    actionsHtml = `
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
  }

  const actionsBlock = actionsHtml ? `<div class="actions">${actionsHtml}</div>` : '';

  // Drag handle — only on local cards. Only the handle is draggable so
  // the rest of the card (chips, buttons, edit-name input) keeps normal
  // click and text-selection behavior.
  const dragHandle = remote ? '' : `
    <div class="drag-handle" draggable="true" title="Drag to reorder" aria-label="Drag to reorder">
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.8" stroke="currentColor"><circle cx="9" cy="6" r="0.9" fill="currentColor"/><circle cx="15" cy="6" r="0.9" fill="currentColor"/><circle cx="9" cy="12" r="0.9" fill="currentColor"/><circle cx="15" cy="12" r="0.9" fill="currentColor"/><circle cx="9" cy="18" r="0.9" fill="currentColor"/><circle cx="15" cy="18" r="0.9" fill="currentColor"/></svg>
    </div>`;

  // Encode the actual domain key on the element so the drag handler can
  // read it back without having to map sanitized IDs.
  const domainAttr = ` data-domain="${(group.domain || '').replace(/"/g, '&quot;')}"`;

  return `
    <div class="mission-card domain-card ${hasDupes ? 'has-amber-bar' : 'has-neutral-bar'}${remote ? ' remote-card' : ''}" data-domain-id="${stableId}"${domainAttr}>
      <div class="status-bar"></div>
      ${dragHandle}
      <div class="mission-content">
        <div class="mission-top">
          <span class="mission-name">${isLanding ? 'Homepages' : (group.label || friendlyDomain(group.domain))}</span>
          ${tabBadge}
          ${dupeBadge}
        </div>
        <div class="mission-pages">${pageChips}</div>
        ${actionsBlock}
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
 * renderDeferredColumn()
 *
 * Reads saved tabs from chrome.storage.local and renders the right-side
 * "Saved for Later" checklist column. Shows active items as a checklist
 * and completed items in a collapsible archive.
 */
async function renderDeferredColumn() {
  const column         = document.getElementById('deferredColumn');
  const list           = document.getElementById('deferredList');
  const empty          = document.getElementById('deferredEmpty');
  const countEl        = document.getElementById('deferredCount');
  const archiveEl      = document.getElementById('deferredArchive');
  const archiveCountEl = document.getElementById('archiveCount');
  const archiveList    = document.getElementById('archiveList');

  if (!column) return;

  try {
    const { active, archived } = await getSavedTabs();

    // Apply global search filter — matches on custom name, title, URL
    const q = searchQuery.toLowerCase();
    const matchItem = (item) =>
      !q ||
      (item.title || '').toLowerCase().includes(q) ||
      (item.url   || '').toLowerCase().includes(q) ||
      (siteNames[item.url] || '').toLowerCase().includes(q);

    const activeFiltered   = q ? active.filter(matchItem)   : active;
    const archivedFiltered = q ? archived.filter(matchItem) : archived;

    // Hide the entire column if there's nothing to show (and no query active)
    if (active.length === 0 && archived.length === 0) {
      column.style.display = 'none';
      return;
    }
    // With a query but nothing matches, also hide
    if (q && activeFiltered.length === 0 && archivedFiltered.length === 0) {
      column.style.display = 'none';
      return;
    }

    column.style.display = 'block';

    // Render active checklist items
    if (activeFiltered.length > 0) {
      countEl.textContent = `${activeFiltered.length} item${activeFiltered.length !== 1 ? 's' : ''}${q ? ' · matches' : ''}`;
      list.innerHTML = activeFiltered.map(item => renderDeferredItem(item)).join('');
      list.style.display = 'block';
      empty.style.display = 'none';
    } else {
      list.style.display = 'none';
      countEl.textContent = '';
      empty.style.display = 'block';
    }

    // Render archive section
    if (archivedFiltered.length > 0) {
      archiveCountEl.textContent = `(${archivedFiltered.length})`;
      archiveList.innerHTML = archivedFiltered.map(item => renderArchiveItem(item)).join('');
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
 * renderDeferredItem(item)
 *
 * Builds HTML for one active checklist item: checkbox, title link,
 * domain, time ago, dismiss button.
 */
function renderDeferredItem(item) {
  let domain = '';
  try { domain = new URL(item.url).hostname.replace(/^www\./, ''); } catch {}
  const faviconUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=16`;
  const ago = timeAgo(item.savedAt);

  return `
    <div class="deferred-item" data-deferred-id="${item.id}">
      <input type="checkbox" class="deferred-checkbox" data-action="check-deferred" data-deferred-id="${item.id}">
      <div class="deferred-info">
        <a href="${item.url}" target="_blank" rel="noopener" class="deferred-title" title="${(item.title || '').replace(/"/g, '&quot;')}">
          <img src="${faviconUrl}" alt="" style="width:14px;height:14px;vertical-align:-2px;margin-right:4px" onerror="this.style.display='none'">${item.title || item.url}
        </a>
        <div class="deferred-meta">
          <span>${domain}</span>
          <span>${ago}</span>
        </div>
      </div>
      <button class="deferred-dismiss" data-action="dismiss-deferred" data-deferred-id="${item.id}" title="Dismiss">
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
  return `
    <div class="archive-item">
      <a href="${item.url}" target="_blank" rel="noopener" class="archive-item-title" title="${(item.title || '').replace(/"/g, '&quot;')}">
        ${item.title || item.url}
      </a>
      <span class="archive-item-date">${ago}</span>
    </div>`;
}


/* ----------------------------------------------------------------
   DOMAIN GROUPING — shared between local and remote-device tab lists
   ---------------------------------------------------------------- */

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

function matchCustomGroup(url) {
  const customGroups = typeof LOCAL_CUSTOM_GROUPS !== 'undefined' ? LOCAL_CUSTOM_GROUPS : [];
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
      return true;
    }) || null;
  } catch { return null; }
}

/**
 * groupTabsByDomain(tabs)
 *
 * Pure helper used for both local tabs and synced remote-device tabs.
 * Same logic the dashboard has always used: pull landing pages into a
 * special group, honor custom groups from config.local.js, otherwise
 * group by hostname. Returns a sorted array of groups.
 */
function groupTabsByDomain(tabs) {
  const groupMap    = {};
  const landingTabs = [];

  for (const tab of tabs) {
    if (!tab.url) continue;
    try {
      if (isLandingPage(tab.url)) {
        landingTabs.push(tab);
        continue;
      }

      const customRule = matchCustomGroup(tab.url);
      if (customRule) {
        const key = customRule.groupKey;
        if (!groupMap[key]) groupMap[key] = { domain: key, label: customRule.groupLabel, tabs: [] };
        groupMap[key].tabs.push(tab);
        continue;
      }

      let hostname;
      if (tab.url.startsWith('file://')) {
        hostname = 'local-files';
      } else {
        hostname = new URL(tab.url).hostname;
      }
      if (!hostname) continue;

      if (!groupMap[hostname]) groupMap[hostname] = { domain: hostname, tabs: [] };
      groupMap[hostname].tabs.push(tab);
    } catch {
      // skip malformed URLs
    }
  }

  if (landingTabs.length > 0) {
    groupMap['__landing-pages__'] = { domain: '__landing-pages__', tabs: landingTabs };
  }

  const landingHostnames = new Set(LANDING_PAGE_PATTERNS.map(p => p.hostname).filter(Boolean));
  const landingSuffixes  = LANDING_PAGE_PATTERNS.map(p => p.hostnameEndsWith).filter(Boolean);
  const isLandingDomain  = (domain) =>
    landingHostnames.has(domain) || landingSuffixes.some(s => domain.endsWith(s));

  return Object.values(groupMap).sort((a, b) => {
    const aIsLanding = a.domain === '__landing-pages__';
    const bIsLanding = b.domain === '__landing-pages__';
    if (aIsLanding !== bIsLanding) return aIsLanding ? -1 : 1;

    const aIsPriority = isLandingDomain(a.domain);
    const bIsPriority = isLandingDomain(b.domain);
    if (aIsPriority !== bIsPriority) return aIsPriority ? -1 : 1;

    return b.tabs.length - a.tabs.length;
  });
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
async function renderStaticDashboard() {
  // --- Header ---
  const greetingEl = document.getElementById('greeting');
  const dateEl     = document.getElementById('dateDisplay');
  if (greetingEl) greetingEl.textContent = getGreeting();
  if (dateEl)     dateEl.textContent     = getDateDisplay();

  // --- Load persisted state (custom names + drag order) before any chip render ---
  await Promise.all([loadSiteNames(), loadDomainOrder()]);

  // --- Fetch tabs (local + synced from other devices) ---
  await fetchOpenTabs();
  await fetchOtherDeviceTabs();

  // --- Render every tab section (sync DOM updates from cached state) ---
  rerenderTabSections();

  // --- Footer stats ---
  const statTabs = document.getElementById('statTabs');
  if (statTabs) statTabs.textContent = openTabs.length;

  // --- Check for duplicate Tab Out tabs ---
  checkTabOutDupes();

  // --- Render "Saved for Later" column ---
  await renderDeferredColumn();
}

/**
 * rerenderTabSections()
 *
 * Pure DOM update from already-fetched state. Called on initial load
 * and again whenever the search query changes or a custom name is
 * edited — no chrome.tabs / chrome.sessions calls.
 */
function rerenderTabSections() {
  renderLocalTabsSection();
  renderOtherDevicesSection();
}

/**
 * renderLocalTabsSection()
 *
 * Renders the "Open tabs" section from the cached `openTabs` list,
 * applying the global search filter.
 */
function renderLocalTabsSection() {
  const openTabsSection      = document.getElementById('openTabsSection');
  const openTabsMissionsEl   = document.getElementById('openTabsMissions');
  const openTabsSectionCount = document.getElementById('openTabsSectionCount');
  const openTabsSectionTitle = document.getElementById('openTabsSectionTitle');
  if (!openTabsSection) return;

  const realTabs = getRealTabs();
  const q = searchQuery.toLowerCase();
  const filteredTabs = q ? realTabs.filter(t => tabMatchesQuery(t, q)) : realTabs;
  domainGroups = applyUserDomainOrder(groupTabsByDomain(filteredTabs));

  if (domainGroups.length > 0) {
    if (openTabsSectionTitle) openTabsSectionTitle.textContent = q ? 'Open tabs — matches' : 'Open tabs';
    openTabsSectionCount.innerHTML = q
      ? `${filteredTabs.length} match${filteredTabs.length !== 1 ? 'es' : ''} in ${domainGroups.length} domain${domainGroups.length !== 1 ? 's' : ''}`
      : `${domainGroups.length} domain${domainGroups.length !== 1 ? 's' : ''} &nbsp;&middot;&nbsp; <button class="action-btn close-tabs" data-action="close-all-open-tabs" style="font-size:11px;padding:3px 10px;">${ICONS.close} Close all ${realTabs.length} tabs</button>`;
    openTabsMissionsEl.innerHTML = domainGroups.map(g => renderDomainCard(g)).join('');
    openTabsSection.style.display = 'block';
  } else if (q) {
    // Search active but no local matches — keep section visible with empty hint
    if (openTabsSectionTitle) openTabsSectionTitle.textContent = 'Open tabs — matches';
    openTabsSectionCount.innerHTML = '0 matches';
    openTabsMissionsEl.innerHTML = `<div style="font-size:13px;color:var(--muted);padding:12px 4px;">No open tabs match "${q.replace(/</g, '&lt;')}".</div>`;
    openTabsSection.style.display = 'block';
  } else {
    openTabsSection.style.display = 'none';
  }
}

/**
 * renderOtherDevicesSection()
 *
 * Pure DOM update from cached `otherDeviceGroups`, applying the global
 * search filter. If the API is missing, sync is off, or no devices
 * return, shows a hint instead of the section.
 */
function renderOtherDevicesSection() {
  const section   = document.getElementById('otherDevicesSection');
  const missions  = document.getElementById('otherDevicesMissions');
  const countEl   = document.getElementById('otherDevicesSectionCount');
  const hintEl    = document.getElementById('otherDevicesHint');
  if (!section || !missions) return;

  if (otherDeviceGroups.length === 0) {
    section.style.display = 'none';
    if (hintEl) hintEl.style.display = 'block';
    return;
  }
  if (hintEl) hintEl.style.display = 'none';

  const q = searchQuery.toLowerCase();
  // Apply filter per-device; drop devices whose tabs all fail the filter
  const filteredDevices = otherDeviceGroups
    .map(d => ({
      ...d,
      tabs: q ? d.tabs.filter(t => tabMatchesQuery(t, q)) : d.tabs,
    }))
    .filter(d => d.tabs.length > 0);

  if (filteredDevices.length === 0) {
    if (countEl) countEl.textContent = q ? '0 matches' : '';
    missions.innerHTML = q
      ? `<div style="font-size:13px;color:var(--muted);padding:12px 4px;">No tabs from other devices match "${q.replace(/</g, '&lt;')}".</div>`
      : '';
    section.style.display = q ? 'block' : 'none';
    return;
  }

  const totalTabs = filteredDevices.reduce((s, d) => s + d.tabs.length, 0);
  if (countEl) {
    countEl.textContent = `${filteredDevices.length} device${filteredDevices.length !== 1 ? 's' : ''} · ${totalTabs} tab${totalTabs !== 1 ? 's' : ''}${q ? ' · matches' : ''}`;
  }
  missions.innerHTML = filteredDevices.map((d, i) => renderDeviceSubsection(d, i)).join('');
  section.style.display = 'block';
}

async function renderDashboard() {
  await renderStaticDashboard();
}


/* ----------------------------------------------------------------
   EVENT HANDLERS — using event delegation

   One listener on document handles ALL button clicks.
   Think of it as one security guard watching the whole building
   instead of one per door.
   ---------------------------------------------------------------- */

document.addEventListener('click', async (e) => {
  // Walk up the DOM to find the nearest element with data-action
  const actionEl = e.target.closest('[data-action]');
  if (!actionEl) return;

  const action = actionEl.dataset.action;

  // ---- Close duplicate Tab Out tabs ----
  if (action === 'close-tabout-dupes') {
    await closeTabOutDupes();
    playCloseSound();
    const banner = document.getElementById('tabOutDupeBanner');
    if (banner) {
      banner.style.transition = 'opacity 0.4s';
      banner.style.opacity = '0';
      setTimeout(() => { banner.style.display = 'none'; banner.style.opacity = '1'; }, 400);
    }
    showToast('Closed extra Tab Out tabs');
    return;
  }

  const card = actionEl.closest('.mission-card');

  // ---- Expand overflow chips ("+N more") ----
  if (action === 'expand-chips') {
    const overflowContainer = actionEl.parentElement.querySelector('.page-chips-overflow');
    if (overflowContainer) {
      overflowContainer.style.display = 'contents';
      actionEl.remove();
    }
    return;
  }

  // ---- Focus a specific tab ----
  if (action === 'focus-tab') {
    const tabUrl = actionEl.dataset.tabUrl;
    if (tabUrl) await focusTab(tabUrl);
    return;
  }

  // ---- Open a tab synced from another device (locally) ----
  if (action === 'restore-remote-tab') {
    const sessionId = actionEl.dataset.sessionId;
    const tabUrl    = actionEl.dataset.tabUrl;
    await restoreRemoteSession(sessionId, tabUrl);
    return;
  }

  // ---- Inline-edit a chip's custom name ----
  if (action === 'edit-name') {
    e.stopPropagation(); // don't trigger parent chip's focus / restore
    const chip = actionEl.closest('.page-chip');
    if (!chip) return;
    const tabUrl = actionEl.dataset.tabUrl;
    if (!tabUrl) return;
    beginChipNameEdit(chip, tabUrl, actionEl.dataset.autoLabel || '');
    return;
  }

  // ---- Close a single tab ----
  if (action === 'close-single-tab') {
    e.stopPropagation(); // don't trigger parent chip's focus-tab
    const tabUrl = actionEl.dataset.tabUrl;
    if (!tabUrl) return;

    // Close the tab in Chrome directly
    const allTabs = await chrome.tabs.query({});
    const match   = allTabs.find(t => t.url === tabUrl);
    if (match) await chrome.tabs.remove(match.id);
    await fetchOpenTabs();

    playCloseSound();

    // Animate the chip row out
    const chip = actionEl.closest('.page-chip');
    if (chip) {
      const rect = chip.getBoundingClientRect();
      shootConfetti(rect.left + rect.width / 2, rect.top + rect.height / 2);
      chip.style.transition = 'opacity 0.2s, transform 0.2s';
      chip.style.opacity    = '0';
      chip.style.transform  = 'scale(0.8)';
      setTimeout(() => {
        chip.remove();
        // If the card now has no tabs, remove it too
        const parentCard = document.querySelector('.mission-card:has(.mission-pages:empty)');
        if (parentCard) animateCardOut(parentCard);
        document.querySelectorAll('.mission-card').forEach(c => {
          if (c.querySelectorAll('.page-chip[data-action="focus-tab"]').length === 0) {
            animateCardOut(c);
          }
        });
      }, 200);
    }

    // Update footer
    const statTabs = document.getElementById('statTabs');
    if (statTabs) statTabs.textContent = openTabs.length;

    showToast('Tab closed');
    return;
  }

  // ---- Save a single tab for later (then close it) ----
  if (action === 'defer-single-tab') {
    e.stopPropagation();
    const tabUrl   = actionEl.dataset.tabUrl;
    const tabTitle = actionEl.dataset.tabTitle || tabUrl;
    if (!tabUrl) return;

    // Save to chrome.storage.local
    try {
      await saveTabForLater({ url: tabUrl, title: tabTitle });
    } catch (err) {
      console.error('[tab-out] Failed to save tab:', err);
      showToast('Failed to save tab');
      return;
    }

    // Close the tab in Chrome
    const allTabs = await chrome.tabs.query({});
    const match   = allTabs.find(t => t.url === tabUrl);
    if (match) await chrome.tabs.remove(match.id);
    await fetchOpenTabs();

    // Animate chip out
    const chip = actionEl.closest('.page-chip');
    if (chip) {
      chip.style.transition = 'opacity 0.2s, transform 0.2s';
      chip.style.opacity    = '0';
      chip.style.transform  = 'scale(0.8)';
      setTimeout(() => chip.remove(), 200);
    }

    showToast('Saved for later');
    await renderDeferredColumn();
    return;
  }

  // ---- Check off a saved tab (moves it to archive) ----
  if (action === 'check-deferred') {
    const id = actionEl.dataset.deferredId;
    if (!id) return;

    await checkOffSavedTab(id);

    // Animate: strikethrough first, then slide out
    const item = actionEl.closest('.deferred-item');
    if (item) {
      item.classList.add('checked');
      setTimeout(() => {
        item.classList.add('removing');
        setTimeout(() => {
          item.remove();
          renderDeferredColumn(); // refresh counts and archive
        }, 300);
      }, 800);
    }
    return;
  }

  // ---- Dismiss a saved tab (removes it entirely) ----
  if (action === 'dismiss-deferred') {
    const id = actionEl.dataset.deferredId;
    if (!id) return;

    await dismissSavedTab(id);

    const item = actionEl.closest('.deferred-item');
    if (item) {
      item.classList.add('removing');
      setTimeout(() => {
        item.remove();
        renderDeferredColumn();
      }, 300);
    }
    return;
  }

  // ---- Close all tabs in a domain group ----
  if (action === 'close-domain-tabs') {
    const domainId = actionEl.dataset.domainId;
    const group    = domainGroups.find(g => {
      return 'domain-' + g.domain.replace(/[^a-z0-9]/g, '-') === domainId;
    });
    if (!group) return;

    const urls      = group.tabs.map(t => t.url);
    // Landing pages and custom groups (whose domain key isn't a real hostname)
    // must use exact URL matching to avoid closing unrelated tabs
    const useExact  = group.domain === '__landing-pages__' || !!group.label;

    if (useExact) {
      await closeTabsExact(urls);
    } else {
      await closeTabsByUrls(urls);
    }

    if (card) {
      playCloseSound();
      animateCardOut(card);
    }

    // Remove from in-memory groups
    const idx = domainGroups.indexOf(group);
    if (idx !== -1) domainGroups.splice(idx, 1);

    const groupLabel = group.domain === '__landing-pages__' ? 'Homepages' : (group.label || friendlyDomain(group.domain));
    showToast(`Closed ${urls.length} tab${urls.length !== 1 ? 's' : ''} from ${groupLabel}`);

    const statTabs = document.getElementById('statTabs');
    if (statTabs) statTabs.textContent = openTabs.length;
    return;
  }

  // ---- Close duplicates, keep one copy ----
  if (action === 'dedup-keep-one') {
    const urlsEncoded = actionEl.dataset.dupeUrls || '';
    const urls = urlsEncoded.split(',').map(u => decodeURIComponent(u)).filter(Boolean);
    if (urls.length === 0) return;

    await closeDuplicateTabs(urls, true);
    playCloseSound();

    // Hide the dedup button
    actionEl.style.transition = 'opacity 0.2s';
    actionEl.style.opacity    = '0';
    setTimeout(() => actionEl.remove(), 200);

    // Remove dupe badges from the card
    if (card) {
      card.querySelectorAll('.chip-dupe-badge').forEach(b => {
        b.style.transition = 'opacity 0.2s';
        b.style.opacity    = '0';
        setTimeout(() => b.remove(), 200);
      });
      card.querySelectorAll('.open-tabs-badge').forEach(badge => {
        if (badge.textContent.includes('duplicate')) {
          badge.style.transition = 'opacity 0.2s';
          badge.style.opacity    = '0';
          setTimeout(() => badge.remove(), 200);
        }
      });
      card.classList.remove('has-amber-bar');
      card.classList.add('has-neutral-bar');
    }

    showToast('Closed duplicates, kept one copy each');
    return;
  }

  // ---- Close ALL open tabs ----
  if (action === 'close-all-open-tabs') {
    const allUrls = openTabs
      .filter(t => t.url && !t.url.startsWith('chrome') && !t.url.startsWith('about:'))
      .map(t => t.url);
    await closeTabsByUrls(allUrls);
    playCloseSound();

    document.querySelectorAll('#openTabsMissions .mission-card').forEach(c => {
      shootConfetti(
        c.getBoundingClientRect().left + c.offsetWidth / 2,
        c.getBoundingClientRect().top  + c.offsetHeight / 2
      );
      animateCardOut(c);
    });

    showToast('All tabs closed. Fresh start.');
    return;
  }
});

// ---- Archive toggle — expand/collapse the archive section ----
document.addEventListener('click', (e) => {
  const toggle = e.target.closest('#archiveToggle');
  if (!toggle) return;

  toggle.classList.toggle('open');
  const body = document.getElementById('archiveBody');
  if (body) {
    body.style.display = body.style.display === 'none' ? 'block' : 'none';
  }
});

// ---- Archive search — filter archived items as user types ----
document.addEventListener('input', async (e) => {
  if (e.target.id !== 'archiveSearch') return;

  const q = e.target.value.trim().toLowerCase();
  const archiveList = document.getElementById('archiveList');
  if (!archiveList) return;

  try {
    const { archived } = await getSavedTabs();

    if (q.length < 2) {
      // Show all archived items
      archiveList.innerHTML = archived.map(item => renderArchiveItem(item)).join('');
      return;
    }

    // Filter by title or URL containing the query string
    const results = archived.filter(item =>
      (item.title || '').toLowerCase().includes(q) ||
      (item.url  || '').toLowerCase().includes(q)
    );

    archiveList.innerHTML = results.map(item => renderArchiveItem(item)).join('')
      || '<div style="font-size:12px;color:var(--muted);padding:8px 0">No results</div>';
  } catch (err) {
    console.warn('[tab-out] Archive search failed:', err);
  }
});


/* ----------------------------------------------------------------
   CHIP NAME EDITING — inline rename for any chip

   Replaces the chip's text label with an input field. Enter or blur
   commits, Escape cancels. Persists to chrome.storage.local under
   `siteNames[url]` so the override survives sync, restarts, and
   shows up on every device that opens the same URL.
   ---------------------------------------------------------------- */

function beginChipNameEdit(chip, url, autoLabel) {
  if (!chip) return;
  if (chip.classList.contains('editing')) return;

  const textEl = chip.querySelector('.chip-text');
  if (!textEl) return;

  chip.classList.add('editing');
  // Disable the chip's main click-through while editing
  chip.dataset.actionBackup = chip.dataset.action || '';
  chip.removeAttribute('data-action');

  const current = siteNames[url] || '';
  // Pre-fill with whatever's currently displayed — custom name if set,
  // otherwise the auto-cleaned label — so the user can edit instead of
  // typing from scratch.
  const startValue = current || autoLabel || '';
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'chip-name-input';
  input.value = startValue;
  input.placeholder = autoLabel || 'Custom name';
  input.maxLength = 80;
  input.setAttribute('aria-label', 'Rename this site');

  const originalText = textEl.textContent;
  textEl.replaceWith(input);
  // Defer focus until after click event finishes
  setTimeout(() => { input.focus(); input.select(); }, 0);

  let finished = false;
  const restore = () => {
    chip.classList.remove('editing');
    if (chip.dataset.actionBackup) {
      chip.dataset.action = chip.dataset.actionBackup;
      delete chip.dataset.actionBackup;
    }
  };

  const commit = async (save) => {
    if (finished) return;
    finished = true;

    if (save) {
      const newName = input.value.trim();
      // If the user opened the editor and submits without changes (or
      // submits a value identical to the auto-label), don't lock the
      // auto-label in as a "custom" name.
      const effective = (newName === autoLabel) ? '' : newName;

      if (effective !== current) {
        await setSiteName(url, effective);
        // Re-render every section so all instances of this URL update
        rerenderTabSections();
        await renderDeferredColumn();
        showToast(effective ? 'Renamed' : 'Name cleared');
        return; // re-render replaces the chip entirely
      }
    }
    // Cancel path or no-op save: restore the original label in place
    const span = document.createElement('span');
    span.className = 'chip-text';
    span.textContent = originalText;
    input.replaceWith(span);
    restore();
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter')      { e.preventDefault(); commit(true); }
    else if (e.key === 'Escape'){ e.preventDefault(); commit(false); }
    e.stopPropagation();
  });
  input.addEventListener('blur',  () => commit(true));
  input.addEventListener('click', (e) => e.stopPropagation());
}


/* ----------------------------------------------------------------
   GLOBAL SEARCH WIRING

   Single input at the top filters every tab section live (and the
   saved-for-later list). Debounced lightly so heavy typers don't
   re-render on every keystroke.
   ---------------------------------------------------------------- */

(function wireGlobalSearch() {
  const input    = document.getElementById('globalSearch');
  const clearBtn = document.getElementById('globalSearchClear');
  if (!input) return;

  let debounceTimer = null;
  const apply = () => {
    searchQuery = input.value.trim();
    if (clearBtn) clearBtn.style.display = searchQuery ? 'flex' : 'none';
    rerenderTabSections();
    renderDeferredColumn();
  };

  input.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(apply, 80);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      input.value = '';
      apply();
      input.blur();
    }
  });

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      input.value = '';
      apply();
      input.focus();
    });
  }

  // Cmd/Ctrl+K focuses the search bar
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      input.focus();
      input.select();
    }
  });
})();


/* ----------------------------------------------------------------
   DRAG-AND-DROP REORDER for local domain cards

   Only the .drag-handle inside each local card has draggable=true, so
   chips and buttons keep normal click/text behavior. On drop we splice
   the dragged card into the new DOM position, then read back the
   resulting card order and persist it to chrome.storage.local. The
   stored order survives sync (it's just a list of domain keys).
   ---------------------------------------------------------------- */

(function wireDragReorder() {
  const container = document.getElementById('openTabsMissions');
  if (!container) return;

  let draggedCard = null;

  const clearDropIndicators = () => {
    container.querySelectorAll('.drop-before, .drop-after').forEach(el =>
      el.classList.remove('drop-before', 'drop-after')
    );
  };

  // Save the new order from the current DOM. Preserves any domains that
  // are NOT currently in the DOM (e.g. filtered out by search) by
  // appending them in their existing relative order.
  const persistOrderFromDOM = async () => {
    const cards = container.querySelectorAll('.mission-card.domain-card:not(.remote-card)');
    const visibleOrder = [];
    cards.forEach(card => {
      const d = card.dataset.domain;
      if (d) visibleOrder.push(d);
    });
    const visibleSet = new Set(visibleOrder);
    const remaining = domainOrder.filter(d => !visibleSet.has(d));
    domainOrder = [...visibleOrder, ...remaining];
    await persistDomainOrder();
  };

  container.addEventListener('dragstart', (e) => {
    const handle = e.target.closest('.drag-handle');
    if (!handle) return; // drag from anything other than the handle is ignored
    const card = handle.closest('.mission-card.domain-card');
    if (!card || card.classList.contains('remote-card')) return;
    draggedCard = card;
    card.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    // setData is required in Firefox for the drag to actually start
    try { e.dataTransfer.setData('text/plain', card.dataset.domain || ''); } catch {}
    // Use the whole card (not just the small handle) as the drag image
    const rect = card.getBoundingClientRect();
    try { e.dataTransfer.setDragImage(card, e.clientX - rect.left, e.clientY - rect.top); } catch {}
  });

  container.addEventListener('dragover', (e) => {
    if (!draggedCard) return;
    const card = e.target.closest('.mission-card.domain-card');
    if (!card || card === draggedCard || card.classList.contains('remote-card')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const rect = card.getBoundingClientRect();
    const before = (e.clientY - rect.top) < rect.height / 2;
    clearDropIndicators();
    card.classList.add(before ? 'drop-before' : 'drop-after');
  });

  container.addEventListener('dragleave', (e) => {
    // Only clear if leaving the container entirely (not just moving between cards)
    if (e.relatedTarget && container.contains(e.relatedTarget)) return;
    clearDropIndicators();
  });

  container.addEventListener('drop', async (e) => {
    if (!draggedCard) return;
    const card = e.target.closest('.mission-card.domain-card');
    if (!card || card === draggedCard || card.classList.contains('remote-card')) {
      clearDropIndicators();
      return;
    }
    e.preventDefault();
    const rect = card.getBoundingClientRect();
    const before = (e.clientY - rect.top) < rect.height / 2;
    if (before) container.insertBefore(draggedCard, card);
    else        container.insertBefore(draggedCard, card.nextSibling);
    clearDropIndicators();
    await persistOrderFromDOM();
  });

  container.addEventListener('dragend', () => {
    if (draggedCard) draggedCard.classList.remove('dragging');
    draggedCard = null;
    clearDropIndicators();
  });
})();


/* ----------------------------------------------------------------
   INITIALIZE
   ---------------------------------------------------------------- */
renderDashboard();
