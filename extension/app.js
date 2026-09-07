/* ================================================================
   Tab Out — Dashboard App (Pure Extension Edition)

   This file is the brain of the dashboard. Now that the dashboard
   IS the extension page (not inside an iframe), it can call
   chrome.tabs and chrome.storage directly — no postMessage bridge needed.

   What this file does:
   1. Reads normal browser windows and their open tabs
   2. Groups tabs by domain or by browser window
   3. Renders domain/window cards, banners, and stats
   4. Handles tab focus, close, archive, restore, reorder, and cross-window moves
   5. Stores archived tabs in chrome.storage.local (no server)
   ================================================================ */

'use strict';


/* ----------------------------------------------------------------
   CHROME TABS — Direct API Access

   Since this page IS the extension's new tab page, it has full
   access to chrome.tabs and chrome.storage. No middleman needed.
   ---------------------------------------------------------------- */

// Browser state — populated by fetchOpenTabs(). Only normal, non-incognito
// windows are included in the dashboard.
let openTabs = [];
let openWindows = [];
let currentWindowId = null;

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

    const [windows, currentWindow] = await Promise.all([
      chrome.windows.getAll({ populate: true, windowTypes: ['normal'] }),
      chrome.windows.getCurrent(),
    ]);

    currentWindowId = currentWindow.id;
    openWindows = windows
      .filter(browserWindow => !browserWindow.incognito)
      .map(browserWindow => ({
        id: browserWindow.id,
        focused: browserWindow.focused,
        state: browserWindow.state,
        type: browserWindow.type,
        tabs: (browserWindow.tabs || []).map(tab => ({
          id: tab.id,
          url: tab.url || tab.pendingUrl || '',
          title: tab.title || '',
          favIconUrl: tab.favIconUrl || '',
          windowId: tab.windowId,
          index: tab.index,
          active: tab.active,
          pinned: tab.pinned,
          groupId: tab.groupId,
          // Flag Tab Out's own pages so we can detect duplicate new tabs.
          isTabOut: tab.url === newtabUrl || tab.url === 'chrome://newtab/',
        })),
      }));

    openTabs = openWindows.flatMap(browserWindow => browserWindow.tabs);
  } catch {
    // chrome.tabs API unavailable (shouldn't happen in an extension page)
    openTabs = [];
    openWindows = [];
    currentWindowId = null;
  }
}

/** Close exact browser tabs without relying on URL matching. */
async function closeTabsByIds(tabIds) {
  const ids = [...new Set((tabIds || []).map(Number).filter(Number.isInteger))];
  if (ids.length === 0) return;
  await chrome.tabs.remove(ids);
  await fetchOpenTabs();
}

/**
 * focusTab(tabId, fallbackUrl)
 *
 * Switches Chrome to one exact tab and brings its window to the front.
 * URL matching remains only as a fallback for older rendered markup.
 */
async function focusTab(tabId, fallbackUrl = '') {
  let match = null;

  if (Number.isInteger(tabId)) {
    try { match = await chrome.tabs.get(tabId); }
    catch { /* The tab may have been closed between render and click. */ }
  }

  if (!match && fallbackUrl) {
    const allTabs = await chrome.tabs.query({});
    const currentWindow = await chrome.windows.getCurrent();

    // Backwards-compatible fallback for any older markup: exact URL first.
    let matches = allTabs.filter(t => t.url === fallbackUrl);

    if (matches.length === 0) {
      try {
        const targetHost = new URL(fallbackUrl).hostname;
        matches = allTabs.filter(t => {
          try { return new URL(t.url).hostname === targetHost; }
          catch { return false; }
        });
      } catch {}
    }

    match = matches.find(t => t.windowId !== currentWindow.id) || matches[0] || null;
  }

  if (!match || !Number.isInteger(match.id)) return;
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
  const allTabs = openTabs;
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

  const tabOutTabs = openTabs.filter(t =>
    t.url === newtabUrl || t.url === 'chrome://newtab/'
  );

  if (tabOutTabs.length <= 1) return;

  // Keep the active Tab Out tab in the CURRENT window — that's the one the
  // user is looking at right now. Falls back to any active one, then the first.
  const keep =
    tabOutTabs.find(t => t.active && t.windowId === currentWindowId) ||
    tabOutTabs.find(t => t.active) ||
    tabOutTabs[0];
  const toClose = tabOutTabs.filter(t => t.id !== keep.id).map(t => t.id);
  if (toClose.length > 0) await chrome.tabs.remove(toClose);
  await fetchOpenTabs();
}


/* ----------------------------------------------------------------
   ARCHIVE — chrome.storage.local

   Archiving is deliberately temporary: persist enough metadata to reopen a
   page, then close the live Chrome tab so it no longer consumes memory.
   Restoring does the reverse and removes the stored item only after Chrome
   successfully creates the replacement tab.

   The original window/index are kept as hints for future restore controls.
   The default restore target is always the window containing this dashboard.
   ---------------------------------------------------------------- */

const ARCHIVED_TABS_KEY = 'archivedTabs';
const ARCHIVE_MIGRATION_KEY = 'archiveMigrationV1';
let archiveStorageQueue = Promise.resolve();
let archiveActionInProgress = false;

function queueArchiveStorageMutation(operation) {
  const result = archiveStorageQueue.then(operation, operation);
  archiveStorageQueue = result.catch(() => {});
  return result;
}

function createArchiveId() {
  return globalThis.crypto?.randomUUID?.()
    || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function optionalInteger(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isInteger(number) ? number : null;
}

function normalizeArchivedTab(item, fallbackId = createArchiveId()) {
  if (!item || typeof item.url !== 'string' || item.url.length === 0) return null;
  return {
    id: String(item.id || fallbackId),
    url: item.url,
    title: item.title || item.url,
    favIconUrl: item.favIconUrl || '',
    archivedAt: item.archivedAt || item.savedAt || new Date().toISOString(),
    sourceWindowId: optionalInteger(item.sourceWindowId ?? item.windowId),
    sourceIndex: optionalInteger(item.sourceIndex ?? item.index),
    sourceGroupId: optionalInteger(item.sourceGroupId ?? item.groupId),
    pinned: item.pinned === true,
  };
}

function sortArchivedTabs(items) {
  return [...items].sort((a, b) => {
    return new Date(b.archivedAt).getTime() - new Date(a.archivedAt).getTime();
  });
}

/**
 * Loads the current archive and performs a one-time, non-destructive migration
 * of unfinished "Saved for later" items from older versions. Completed and
 * dismissed legacy history stays in its old key and is intentionally hidden.
 */
async function getArchivedTabs() {
  const stored = await chrome.storage.local.get([
    ARCHIVED_TABS_KEY,
    ARCHIVE_MIGRATION_KEY,
    'deferred',
  ]);

  let archivedTabs = (Array.isArray(stored[ARCHIVED_TABS_KEY])
    ? stored[ARCHIVED_TABS_KEY]
    : [])
    .map(item => normalizeArchivedTab(item))
    .filter(Boolean);

  if (!stored[ARCHIVE_MIGRATION_KEY]) {
    const knownIds = new Set(archivedTabs.map(item => item.id));
    const legacyItems = (Array.isArray(stored.deferred) ? stored.deferred : [])
      .filter(item => item && !item.completed && !item.dismissed && item.url)
      .map(item => normalizeArchivedTab({
        ...item,
        id: `legacy-${item.id || createArchiveId()}`,
        archivedAt: item.savedAt,
      }))
      .filter(item => item && !knownIds.has(item.id));

    archivedTabs = sortArchivedTabs([...archivedTabs, ...legacyItems]);
    await chrome.storage.local.set({
      [ARCHIVED_TABS_KEY]: archivedTabs,
      [ARCHIVE_MIGRATION_KEY]: true,
    });
  }

  return sortArchivedTabs(archivedTabs);
}

/** Persist one archive record for every live tab before any tab is closed. */
async function addArchivedTabs(tabs) {
  return queueArchiveStorageMutation(async () => {
    const existing = await getArchivedTabs();
    const archivedAt = new Date().toISOString();
    const records = (tabs || []).map((tab, index) => normalizeArchivedTab({
      id: createArchiveId(),
      url: tab.url,
      title: tab.title || tab.url,
      favIconUrl: tab.favIconUrl || '',
      archivedAt,
      sourceWindowId: tab.windowId,
      sourceIndex: tab.index,
      sourceGroupId: tab.groupId,
      pinned: tab.pinned,
    }, `${Date.now()}-${index}`)).filter(Boolean);

    if (records.length === 0) return [];
    await chrome.storage.local.set({
      [ARCHIVED_TABS_KEY]: sortArchivedTabs([...records, ...existing]),
    });
    return records;
  });
}

async function removeArchivedTabs(ids) {
  const idSet = new Set((ids || []).map(String));
  if (idSet.size === 0) return;
  return queueArchiveStorageMutation(async () => {
    const archivedTabs = await getArchivedTabs();
    await chrome.storage.local.set({
      [ARCHIVED_TABS_KEY]: archivedTabs.filter(item => !idSet.has(item.id)),
    });
  });
}

/**
 * Archives exact live tabs. Storage happens first, so a Chrome API failure can
 * create a harmless duplicate but can never lose the only way back to a page.
 */
async function archiveLiveTabs(tabs) {
  const seenIds = new Set();
  const liveTabs = (tabs || []).filter(tab => {
    if (!tab || !Number.isInteger(tab.id) || !tab.url || seenIds.has(tab.id)) return false;
    seenIds.add(tab.id);
    return true;
  });
  if (liveTabs.length === 0) return 0;

  const records = await addArchivedTabs(liveTabs);
  try {
    await chrome.tabs.remove(liveTabs.map(tab => tab.id));
  } catch (error) {
    // Roll back records for tabs that are definitely still open. Records for
    // tabs Chrome did close are retained, even if the batch call also failed.
    const stillOpenRecordIds = [];
    await Promise.all(liveTabs.map(async (tab, index) => {
      try {
        await chrome.tabs.get(tab.id);
        if (records[index]) stillOpenRecordIds.push(records[index].id);
      } catch { /* Missing means the tab was closed and its archive is valid. */ }
    }));
    await removeArchivedTabs(stillOpenRecordIds);
    throw error;
  } finally {
    await fetchOpenTabs();
  }

  return records.length;
}

/** Restore into this dashboard's window, adjacent to the dashboard tab. */
async function restoreArchivedTab(id, active = true) {
  const archivedTabs = await getArchivedTabs();
  const item = archivedTabs.find(tab => tab.id === String(id));
  if (!item) return null;

  const [targetWindow, dashboardTab] = await Promise.all([
    chrome.windows.getCurrent(),
    chrome.tabs.getCurrent(),
  ]);
  const createProperties = {
    windowId: targetWindow.id,
    url: item.url,
    active,
    pinned: item.pinned,
  };

  if (!item.pinned && dashboardTab?.windowId === targetWindow.id && Number.isInteger(dashboardTab.index)) {
    createProperties.index = dashboardTab.index + 1;
  }

  const restoredTab = await chrome.tabs.create(createProperties);
  await removeArchivedTabs([item.id]);
  return restoredTab;
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
  if (countEl) countEl.textContent = activeOpenTabsView === 'windows' ? '0 windows' : '0 domains';
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
  archive: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 0 1-2.247 2.118H6.622a2.25 2.25 0 0 1-2.247-2.118L3.75 7.5m4.5 0V6a2.25 2.25 0 0 1 2.25-2.25h3A2.25 2.25 0 0 1 15.75 6v1.5m-12.375 0h17.25M9.75 12h4.5" /></svg>`,
  focus:   `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="m4.5 19.5 15-15m0 0H8.25m11.25 0v11.25" /></svg>`,
};


/* ----------------------------------------------------------------
   IN-MEMORY STORE FOR OPEN-TAB GROUPS
   ---------------------------------------------------------------- */
let domainGroups = [];
let windowGroups = [];

const OPEN_TABS_VIEW_KEY = 'openTabsView';
let activeOpenTabsView = 'domains';
let draggedTab = null;
let refreshAfterDrag = false;
let ignoreTabClickUntil = 0;
let dropInProgress = false;
let refreshTimer = null;
let renderInProgress = false;
let renderAgain = false;
let dashboardHasRendered = false;
let dashboardDirtyWhileHidden = false;
let lastOpenTabsRenderKey = null;
let lastArchiveRenderKey = null;
let localDashboardMutationDepth = 0;
let suppressRefreshEventsUntil = 0;

function cancelScheduledDashboardRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = null;
}

/**
 * Chrome echoes our own tab/storage mutations back through event listeners.
 * Suppress those echoes briefly; the caller renders once after the mutation
 * has settled. Events caused elsewhere still refresh the dashboard normally.
 */
async function runLocalDashboardMutation(operation) {
  localDashboardMutationDepth += 1;
  cancelScheduledDashboardRefresh();
  try {
    return await operation();
  } finally {
    // Let events already queued by the Chrome API reach their listeners while
    // the mutation is still marked local.
    await new Promise(resolve => setTimeout(resolve, 0));
    localDashboardMutationDepth = Math.max(0, localDashboardMutationDepth - 1);
    if (localDashboardMutationDepth === 0) {
      suppressRefreshEventsUntil = Date.now() + 500;
      cancelScheduledDashboardRefresh();
    }
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function tabIdFromElement(element) {
  const tabId = Number(element?.dataset.tabId);
  return Number.isInteger(tabId) ? tabId : null;
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
   OVERFLOW CHIPS ("+N more" expand button in domain cards)
   ---------------------------------------------------------------- */

function buildOverflowChips(hiddenTabs, urlCounts = {}) {
  const hiddenChips = hiddenTabs.map(tab => {
    const label    = cleanTitle(smartTitle(stripTitleNoise(tab.title || ''), tab.url), '');
    const count    = urlCounts[tab.url] || 1;
    const dupeTag  = count > 1 ? ` <span class="chip-dupe-badge">(${count}x)</span>` : '';
    const chipClass = count > 1 ? ' chip-has-dupes' : '';
    const safeUrl   = (tab.url || '').replace(/"/g, '&quot;');
    const safeTitle = label.replace(/"/g, '&quot;');
    let domain = '';
    try { domain = new URL(tab.url).hostname; } catch {}
    const faviconUrl = domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=16` : '';
    return `<div class="page-chip clickable${chipClass}" data-action="focus-tab" data-tab-id="${tab.id}" data-tab-url="${safeUrl}" title="${safeTitle}">
      ${faviconUrl ? `<img class="chip-favicon" src="${faviconUrl}" alt="" onerror="this.style.display='none'">` : ''}
      <span class="chip-text">${label}</span>${dupeTag}
      <div class="chip-actions">
        <button class="chip-action chip-archive" data-action="archive-single-tab" data-tab-id="${tab.id}" title="Archive this tab">
          ${ICONS.archive}
        </button>
        <button class="chip-action chip-close" data-action="close-single-tab" data-tab-id="${tab.id}" data-tab-url="${safeUrl}" title="Close this tab">
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
    const safeUrl   = (tab.url || '').replace(/"/g, '&quot;');
    const safeTitle = label.replace(/"/g, '&quot;');
    let domain = '';
    try { domain = new URL(tab.url).hostname; } catch {}
    const faviconUrl = domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=16` : '';
    return `<div class="page-chip clickable${chipClass}" data-action="focus-tab" data-tab-id="${tab.id}" data-tab-url="${safeUrl}" title="${safeTitle}">
      ${faviconUrl ? `<img class="chip-favicon" src="${faviconUrl}" alt="" onerror="this.style.display='none'">` : ''}
      <span class="chip-text">${label}</span>${dupeTag}
      <div class="chip-actions">
        <button class="chip-action chip-archive" data-action="archive-single-tab" data-tab-id="${tab.id}" title="Archive this tab">
          ${ICONS.archive}
        </button>
        <button class="chip-action chip-close" data-action="close-single-tab" data-tab-id="${tab.id}" data-tab-url="${safeUrl}" title="Close this tab">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
        </button>
      </div>
    </div>`;
  }).join('') + (extraCount > 0 ? buildOverflowChips(uniqueTabs.slice(8), urlCounts) : '');

  let actionsHtml = `
    <button class="action-btn archive-tabs" data-action="archive-domain-tabs" data-domain-id="${stableId}">
      ${ICONS.archive}
      Archive all ${tabCount} tab${tabCount !== 1 ? 's' : ''}
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
          <span class="mission-name">${isLanding ? 'Homepages' : (group.label || friendlyDomain(group.domain))}</span>
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
   WINDOW VIEW — one draggable row per real browser tab
   ---------------------------------------------------------------- */

function renderWindowTabRow(tab) {
  let hostname = '';
  try { hostname = new URL(tab.url).hostname; } catch {}

  let label = cleanTitle(smartTitle(stripTitleNoise(tab.title || ''), tab.url), hostname);
  try {
    const parsed = new URL(tab.url);
    if (parsed.hostname === 'localhost' && parsed.port) label = `${parsed.port} ${label}`;
  } catch {}

  const safeUrl = escapeHtml(tab.url);
  const safeTitle = escapeHtml(label || tab.url);
  const faviconUrl = tab.favIconUrl || (hostname
    ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname)}&sz=16`
    : '');

  const stateBadges = [
    tab.active ? '<span class="window-tab-badge active">Active</span>' : '',
    tab.pinned ? '<span class="window-tab-badge pinned">Pinned</span>' : '',
    Number.isInteger(tab.groupId) && tab.groupId >= 0
      ? '<span class="window-tab-badge grouped">Grouped</span>'
      : '',
  ].join('');

  return `
    <div class="page-chip clickable window-tab-row${tab.active ? ' is-active' : ''}${tab.pinned ? ' is-pinned' : ''}"
         draggable="true"
         data-action="focus-tab"
         data-tab-id="${tab.id}"
         data-tab-url="${safeUrl}"
         data-window-id="${tab.windowId}"
         data-tab-index="${tab.index}"
         data-tab-pinned="${tab.pinned ? 'true' : 'false'}"
         aria-grabbed="false"
         title="${safeTitle}">
      <span class="drag-handle" aria-hidden="true" title="Drag to move this tab">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor"><circle cx="5" cy="3" r="1.15"/><circle cx="11" cy="3" r="1.15"/><circle cx="5" cy="8" r="1.15"/><circle cx="11" cy="8" r="1.15"/><circle cx="5" cy="13" r="1.15"/><circle cx="11" cy="13" r="1.15"/></svg>
      </span>
      ${faviconUrl ? `<img class="chip-favicon" src="${escapeHtml(faviconUrl)}" alt="" onerror="this.style.display='none'">` : ''}
      <span class="chip-text">${safeTitle}</span>
      <span class="window-tab-badges">${stateBadges}</span>
      <div class="chip-actions">
        <button class="chip-action chip-archive" data-action="archive-single-tab" data-tab-id="${tab.id}" title="Archive this tab">
          ${ICONS.archive}
        </button>
        <button class="chip-action chip-close" data-action="close-single-tab" data-tab-id="${tab.id}" data-tab-url="${safeUrl}" title="Close this tab">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
        </button>
      </div>
    </div>`;
}

function renderWindowCard(group) {
  const tabCount = group.tabs.length;
  const rows = group.tabs.map(renderWindowTabRow).join('');
  const windowState = group.state && group.state !== 'normal'
    ? `<span class="window-state">${escapeHtml(group.state)}</span>`
    : '';

  const actionsHtml = tabCount > 0
    ? `<div class="actions">
        <button class="action-btn archive-tabs" data-action="archive-window-tabs" data-window-id="${group.windowId}">
          ${ICONS.archive} Archive all ${tabCount} tab${tabCount !== 1 ? 's' : ''}
        </button>
        <button class="action-btn close-tabs" data-action="close-window-tabs" data-window-id="${group.windowId}">
          ${ICONS.close} Close all ${tabCount} tab${tabCount !== 1 ? 's' : ''}
        </button>
      </div>`
    : '';

  return `
    <div class="mission-card window-card has-neutral-bar${group.isCurrent ? ' is-current-window' : ''}"
         data-window-id="${group.windowId}">
      <div class="status-bar"></div>
      <div class="mission-content">
        <div class="mission-top window-card-header">
          <span class="mission-name">${escapeHtml(group.label)}</span>
          ${group.isCurrent ? '<span class="window-current-badge">Current</span>' : ''}
          ${windowState}
          <span class="open-tabs-badge">${ICONS.tabs} ${tabCount} tab${tabCount !== 1 ? 's' : ''}</span>
        </div>
        <div class="window-card-hint">Drag tabs between windows or place them in a new order.</div>
        <div class="mission-pages window-tabs-drop-zone" data-window-id="${group.windowId}">
          ${rows}
          <div class="window-drop-tail${tabCount === 0 ? ' is-empty' : ''}" data-window-id="${group.windowId}">
            ${tabCount === 0 ? 'Drop a tab here' : 'Drop here to move to the end'}
          </div>
        </div>
        ${actionsHtml}
      </div>
    </div>`;
}

function buildWindowGroups(realTabs) {
  const tabsByWindow = new Map();
  for (const tab of realTabs) {
    if (!tabsByWindow.has(tab.windowId)) tabsByWindow.set(tab.windowId, []);
    tabsByWindow.get(tab.windowId).push(tab);
  }

  return openWindows
    .map(browserWindow => ({
      windowId: browserWindow.id,
      isCurrent: browserWindow.id === currentWindowId,
      focused: browserWindow.focused,
      state: browserWindow.state,
      tabs: (tabsByWindow.get(browserWindow.id) || []).sort((a, b) => a.index - b.index),
    }))
    .sort((a, b) => {
      if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
      return a.windowId - b.windowId;
    })
    .map((group, index) => ({
      ...group,
      label: group.isCurrent ? 'This window' : `Window ${index + 1}`,
    }));
}

function renderEmptyOpenTabs() {
  return `
    <div class="missions-empty-state">
      <div class="empty-checkmark">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5" />
        </svg>
      </div>
      <div class="empty-title">Inbox zero, but for tabs.</div>
      <div class="empty-subtitle">You're free.</div>
    </div>`;
}


/* ----------------------------------------------------------------
   ARCHIVE — Restorable Tabs Column
   ---------------------------------------------------------------- */

function filterArchivedTabs(items, query) {
  const normalizedQuery = String(query || '').trim().toLowerCase();
  if (!normalizedQuery) return items;
  return items.filter(item =>
    (item.title || '').toLowerCase().includes(normalizedQuery)
    || (item.url || '').toLowerCase().includes(normalizedQuery)
  );
}

function renderArchiveItem(item) {
  let domain = '';
  try { domain = new URL(item.url).hostname.replace(/^www\./, ''); } catch {}
  const faviconUrl = item.favIconUrl || (domain
    ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32`
    : '');
  const pinnedLabel = item.pinned ? '<span class="archive-item-pinned">Pinned</span>' : '';
  const safeId = escapeHtml(item.id);
  const safeTitle = escapeHtml(item.title || item.url);

  return `
    <div class="archive-item" data-archive-id="${safeId}">
      <button class="archive-restore" data-action="restore-archived-tab" data-archive-id="${safeId}" title="Restore to this window">
        ${faviconUrl ? `<img class="archive-item-favicon" src="${escapeHtml(faviconUrl)}" alt="" onerror="this.style.display='none'">` : ''}
        <span class="archive-item-info">
          <span class="archive-item-title">${safeTitle}</span>
          <span class="archive-item-meta">
            <span>${escapeHtml(domain || 'Saved page')}</span>
            <span>${escapeHtml(timeAgo(item.archivedAt))}</span>
            ${pinnedLabel}
          </span>
        </span>
        <svg class="archive-restore-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M15 15l6-6m0 0h-4.5M21 9v4.5M9 5.25H7.5A2.25 2.25 0 0 0 5.25 7.5v9A2.25 2.25 0 0 0 7.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25V15" /></svg>
      </button>
      <button class="archive-forget" data-action="forget-archived-tab" data-archive-id="${safeId}" title="Forget this archived tab" aria-label="Forget ${safeTitle}">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
      </button>
    </div>`;
}

function renderArchiveResults(items, query = '') {
  const results = filterArchivedTabs(items, query);
  return results.map(renderArchiveItem).join('')
    || '<div class="archive-no-results">No archived tabs found.</div>';
}

function getArchiveRenderKey(items, query, html) {
  return `${String(query || '').trim().toLowerCase()}\u0000${items.length}\u0000${html}`;
}

function getOpenTabsRenderKey(view, countHtml, groups) {
  // The active tab is patched in place by updateActiveTabIndicator(). Keeping
  // it out of this fingerprint prevents a later unrelated event from turning
  // a simple active-marker change into a full cards rebuild.
  const visibleState = groups.map(group => ({
    id: view === 'windows' ? group.windowId : group.domain,
    label: group.label || '',
    isCurrent: group.isCurrent === true,
    state: group.state || '',
    tabs: (group.tabs || []).map(tab => ({
      id: tab.id,
      url: tab.url,
      title: tab.title,
      favIconUrl: tab.favIconUrl || '',
      windowId: tab.windowId,
      index: tab.index,
      pinned: tab.pinned === true,
      groupId: tab.groupId,
    })),
  }));
  return JSON.stringify([view, countHtml, visibleState]);
}

/** The archive rail stays visible so the feature is always discoverable. */
async function renderArchiveColumn() {
  const column = document.getElementById('archiveColumn');
  const list = document.getElementById('archiveList');
  const empty = document.getElementById('archiveEmpty');
  const countEl = document.getElementById('archiveCount');
  const search = document.getElementById('archiveSearch');
  if (!column || !list || !empty || !countEl || !search) return;

  try {
    const archivedTabs = await getArchivedTabs();
    const currentQuery = search.value;
    column.style.display = 'block';
    countEl.textContent = `${archivedTabs.length} tab${archivedTabs.length !== 1 ? 's' : ''}`;

    if (archivedTabs.length === 0) {
      search.style.display = 'none';
      list.style.display = 'none';
      empty.style.display = 'block';
      if (lastArchiveRenderKey !== 'empty') list.innerHTML = '';
      lastArchiveRenderKey = 'empty';
      return;
    }

    search.style.display = 'block';
    list.style.display = 'block';
    empty.style.display = 'none';
    const nextHtml = renderArchiveResults(archivedTabs, currentQuery);
    const nextRenderKey = getArchiveRenderKey(archivedTabs, currentQuery, nextHtml);
    if (nextRenderKey !== lastArchiveRenderKey) {
      list.innerHTML = nextHtml;
      lastArchiveRenderKey = nextRenderKey;
    }
  } catch (error) {
    console.warn('[tab-out] Could not load archived tabs:', error);
    countEl.textContent = 'Unavailable';
    search.style.display = 'none';
    list.style.display = 'none';
    empty.style.display = 'block';
    lastArchiveRenderKey = null;
  }
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
 * 6. Renders the restorable Archive column
 */
async function renderStaticDashboard() {
  // --- Header ---
  const greetingEl = document.getElementById('greeting');
  const dateEl     = document.getElementById('dateDisplay');
  if (greetingEl) greetingEl.textContent = getGreeting();
  if (dateEl)     dateEl.textContent     = getDateDisplay();

  // --- Fetch tabs ---
  await fetchOpenTabs();
  const realTabs = getRealTabs();
  windowGroups = buildWindowGroups(realTabs);

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

  domainGroups = [];
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
  domainGroups = Object.values(groupMap).sort((a, b) => {
    const aIsLanding = a.domain === '__landing-pages__';
    const bIsLanding = b.domain === '__landing-pages__';
    if (aIsLanding !== bIsLanding) return aIsLanding ? -1 : 1;

    const aIsPriority = isLandingDomain(a.domain);
    const bIsPriority = isLandingDomain(b.domain);
    if (aIsPriority !== bIsPriority) return aIsPriority ? -1 : 1;

    return b.tabs.length - a.tabs.length;
  });

  // --- Render the selected Domains / Windows view ---
  const openTabsSection      = document.getElementById('openTabsSection');
  const openTabsMissionsEl   = document.getElementById('openTabsMissions');
  const openTabsSectionCount = document.getElementById('openTabsSectionCount');
  const openTabsSectionTitle = document.getElementById('openTabsSectionTitle');

  document.querySelectorAll('[data-action="set-open-tabs-view"]').forEach(button => {
    const isActive = button.dataset.view === activeOpenTabsView;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-pressed', String(isActive));
  });

  if (openTabsSection && openTabsMissionsEl && openTabsSectionCount) {
    const isWindowView = activeOpenTabsView === 'windows';
    const groups = isWindowView ? windowGroups : domainGroups;
    const groupLabel = isWindowView
      ? `${groups.length} window${groups.length !== 1 ? 's' : ''}`
      : `${groups.length} domain${groups.length !== 1 ? 's' : ''}`;
    const allTabsActions = realTabs.length > 0
      ? ` &nbsp;&middot;&nbsp; <button class="action-btn archive-tabs compact-action" data-action="archive-all-open-tabs">${ICONS.archive} Archive all ${realTabs.length}</button>
          <button class="action-btn close-tabs compact-action" data-action="close-all-open-tabs">${ICONS.close} Close all ${realTabs.length}</button>`
      : '';
    const nextCountHtml = groupLabel + allTabsActions;
    const nextMissionsHtml = groups.length > 0
      ? groups.map(group => isWindowView ? renderWindowCard(group) : renderDomainCard(group)).join('')
      : renderEmptyOpenTabs();
    const nextRenderKey = getOpenTabsRenderKey(activeOpenTabsView, nextCountHtml, groups);

    if (openTabsSectionTitle) openTabsSectionTitle.textContent = 'Open tabs';
    if (nextRenderKey !== lastOpenTabsRenderKey) {
      openTabsSectionCount.innerHTML = nextCountHtml;
      openTabsMissionsEl.classList.toggle('window-missions', isWindowView);
      openTabsMissionsEl.innerHTML = nextMissionsHtml;
      lastOpenTabsRenderKey = nextRenderKey;
    }
    openTabsSection.style.display = 'block';
  }

  // --- Footer stats ---
  const statTabs = document.getElementById('statTabs');
  if (statTabs) statTabs.textContent = realTabs.length;

  // --- Check for duplicate Tab Out tabs ---
  checkTabOutDupes();

  // --- Render restorable Archive column ---
  await renderArchiveColumn();
}

async function renderDashboard() {
  cancelScheduledDashboardRefresh();
  if (dashboardHasRendered) document.body.classList.add('dashboard-ready');
  if (renderInProgress) {
    renderAgain = true;
    return;
  }

  renderInProgress = true;
  try {
    do {
      renderAgain = false;
      await renderStaticDashboard();
      dashboardHasRendered = true;
      if (renderAgain) document.body.classList.add('dashboard-ready');
    } while (renderAgain);
  } finally {
    renderInProgress = false;
  }
}

function scheduleDashboardRefresh() {
  if (localDashboardMutationDepth > 0 || Date.now() < suppressRefreshEventsUntil) return;

  if (document.visibilityState === 'hidden') {
    dashboardDirtyWhileHidden = true;
    cancelScheduledDashboardRefresh();
    return;
  }

  if (draggedTab || dropInProgress) {
    refreshAfterDrag = true;
    return;
  }

  cancelScheduledDashboardRefresh();
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    renderDashboard().catch(error => console.warn('[tab-out] Refresh failed:', error));
  }, 220);
}

function updateActiveTabIndicator(activeInfo) {
  if (!activeInfo || !Number.isInteger(activeInfo.tabId) || !Number.isInteger(activeInfo.windowId)) return;

  openTabs.forEach(tab => {
    if (tab.windowId === activeInfo.windowId) tab.active = tab.id === activeInfo.tabId;
  });

  if (activeOpenTabsView !== 'windows') return;
  const card = document.querySelector(`.window-card[data-window-id="${activeInfo.windowId}"]`);
  if (!card) return;

  card.querySelectorAll('.window-tab-row.is-active').forEach(row => row.classList.remove('is-active'));
  card.querySelectorAll('.window-tab-badge.active').forEach(badge => badge.remove());

  const activeRow = card.querySelector(`.window-tab-row[data-tab-id="${activeInfo.tabId}"]`);
  if (!activeRow) return;
  activeRow.classList.add('is-active');
  activeRow.querySelector('.window-tab-badges')?.insertAdjacentHTML(
    'afterbegin',
    '<span class="window-tab-badge active">Active</span>'
  );
}

async function archiveTabsWithFeedback(tabs, context = '') {
  if (archiveActionInProgress) return false;
  archiveActionInProgress = true;
  try {
    const count = await runLocalDashboardMutation(() => archiveLiveTabs(tabs));
    if (count === 0) return false;
    playCloseSound();
    const suffix = context ? ` ${context}` : '';
    showToast(`Archived ${count} tab${count !== 1 ? 's' : ''}${suffix}`);
    await renderDashboard();
    return true;
  } catch (error) {
    console.error('[tab-out] Failed to archive tabs:', error);
    showToast('Could not archive every tab');
    await renderDashboard();
    return false;
  } finally {
    archiveActionInProgress = false;
  }
}

function clearDragIndicators() {
  document.querySelectorAll('.window-card.drag-over').forEach(element => element.classList.remove('drag-over'));
  document.querySelectorAll('.window-tab-row.drop-before, .window-tab-row.drop-after').forEach(element => {
    element.classList.remove('drop-before', 'drop-after');
  });
  document.querySelectorAll('.window-drop-tail.drag-over').forEach(element => element.classList.remove('drag-over'));
}

async function moveTabWithRetry(tabId, moveProperties, attemptsLeft = 5) {
  try {
    return await chrome.tabs.move(tabId, moveProperties);
  } catch (error) {
    const message = String(error?.message || error);
    if (attemptsLeft > 1 && message.includes('Tabs cannot be edited right now')) {
      await new Promise(resolve => setTimeout(resolve, 50));
      return moveTabWithRetry(tabId, moveProperties, attemptsLeft - 1);
    }
    throw error;
  }
}

function calculateDropSide(event, targetRow) {
  if (!targetRow) return 'end';
  const rect = targetRow.getBoundingClientRect();
  return event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
}

async function moveDraggedTab(dragged, targetWindowId, targetRow, dropSide) {
  const liveDraggedTab = await chrome.tabs.get(dragged.id);
  const targetTabs = await chrome.tabs.query({ windowId: targetWindowId });
  const targetRowTabId = tabIdFromElement(targetRow);
  const targetTab = targetRowTabId === null
    ? null
    : targetTabs.find(tab => tab.id === targetRowTabId) || null;

  // Dropping on the dragged tab itself is a no-op.
  if (targetTab?.id === liveDraggedTab.id) return false;

  let targetIndex = -1;
  if (targetTab) {
    targetIndex = targetTab.index + (dropSide === 'after' ? 1 : 0);

    // tabs.move() receives the final index. Removing a tab that starts before
    // the insertion slot shifts that slot one place to the left.
    if (liveDraggedTab.windowId === targetWindowId && liveDraggedTab.index < targetIndex) {
      targetIndex -= 1;
    }
  }

  const otherTargetTabs = targetTabs.filter(tab => tab.id !== liveDraggedTab.id);
  const pinnedCount = otherTargetTabs.filter(tab => tab.pinned).length;

  // Chrome keeps pinned tabs before normal tabs. Constrain the requested index
  // to that legal region while preserving the dragged tab's pinned state.
  if (liveDraggedTab.pinned) {
    if (!targetTab || !targetTab.pinned) targetIndex = pinnedCount;
    targetIndex = Math.min(Math.max(targetIndex, 0), pinnedCount);
  } else if (targetIndex !== -1) {
    targetIndex = Math.max(targetIndex, pinnedCount);
  }

  const moved = await moveTabWithRetry(liveDraggedTab.id, {
    windowId: targetWindowId,
    index: targetIndex,
  });
  const movedTab = Array.isArray(moved) ? moved[0] : moved;

  if (movedTab && movedTab.pinned !== liveDraggedTab.pinned) {
    await chrome.tabs.update(movedTab.id, { pinned: liveDraggedTab.pinned });
  }

  return true;
}


/* ----------------------------------------------------------------
   WINDOW VIEW DRAG AND DROP
   ---------------------------------------------------------------- */

document.addEventListener('dragstart', (event) => {
  const row = event.target.closest('.window-tab-row');
  if (!row || activeOpenTabsView !== 'windows') return;
  if (event.target.closest('button')) {
    event.preventDefault();
    return;
  }

  const tabId = tabIdFromElement(row);
  const tab = openTabs.find(item => item.id === tabId);
  if (!tab) {
    event.preventDefault();
    return;
  }

  draggedTab = { ...tab };
  refreshAfterDrag = false;
  row.classList.add('is-dragging');
  row.setAttribute('aria-grabbed', 'true');

  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(tab.id));
  }
});

document.addEventListener('dragover', (event) => {
  if (!draggedTab) return;
  const card = event.target.closest('.window-card');
  if (!card) return;

  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  clearDragIndicators();
  card.classList.add('drag-over');

  const row = event.target.closest('.window-tab-row');
  if (row && tabIdFromElement(row) !== draggedTab.id) {
    row.classList.add(calculateDropSide(event, row) === 'before' ? 'drop-before' : 'drop-after');
  } else {
    card.querySelector('.window-drop-tail')?.classList.add('drag-over');
  }
});

document.addEventListener('drop', async (event) => {
  if (!draggedTab) return;
  const card = event.target.closest('.window-card');
  if (!card) return;

  event.preventDefault();
  dropInProgress = true;
  const dragged = draggedTab;
  const targetWindowId = Number(card.dataset.windowId);
  const targetRow = event.target.closest('.window-tab-row');
  const dropSide = calculateDropSide(event, targetRow);

  try {
    const didMove = await moveDraggedTab(dragged, targetWindowId, targetRow, dropSide);
    if (didMove) showToast('Tab moved');
  } catch (error) {
    console.error('[tab-out] Failed to move tab:', error);
    showToast('Could not move that tab');
  } finally {
    dropInProgress = false;
    draggedTab = null;
    ignoreTabClickUntil = Date.now() + 250;
    clearDragIndicators();
    refreshAfterDrag = false;
    await renderDashboard();
  }
});

document.addEventListener('dragend', () => {
  ignoreTabClickUntil = Date.now() + 250;
  document.querySelectorAll('.window-tab-row.is-dragging').forEach(row => {
    row.classList.remove('is-dragging');
    row.setAttribute('aria-grabbed', 'false');
  });
  clearDragIndicators();

  // A successful drop finishes asynchronously in the drop handler.
  if (dropInProgress) return;
  draggedTab = null;
  if (refreshAfterDrag) {
    refreshAfterDrag = false;
    scheduleDashboardRefresh();
  }
});


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

  // ---- Switch between Domains and Windows, remembering the choice ----
  if (action === 'set-open-tabs-view') {
    const nextView = actionEl.dataset.view;
    if (nextView !== 'domains' && nextView !== 'windows') return;
    activeOpenTabsView = nextView;
    await chrome.storage.local.set({ [OPEN_TABS_VIEW_KEY]: nextView });
    await renderDashboard();
    return;
  }

  // ---- Close duplicate Tab Out tabs ----
  if (action === 'close-tabout-dupes') {
    await runLocalDashboardMutation(closeTabOutDupes);
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
    if (Date.now() < ignoreTabClickUntil) return;
    const tabId = tabIdFromElement(actionEl);
    const tabUrl = actionEl.dataset.tabUrl;
    if (tabId !== null || tabUrl) await focusTab(tabId, tabUrl);
    return;
  }

  // ---- Close a single tab ----
  if (action === 'close-single-tab') {
    e.stopPropagation(); // don't trigger parent chip's focus-tab
    const tabId = tabIdFromElement(actionEl);
    const tabUrl = actionEl.dataset.tabUrl;
    if (tabId === null && !tabUrl) return;

    await runLocalDashboardMutation(async () => {
      // Close the exact tab in Chrome. URL matching is only a compatibility fallback.
      if (tabId !== null) {
        await closeTabsByIds([tabId]);
      } else {
        const allTabs = await chrome.tabs.query({});
        const match = allTabs.find(t => t.url === tabUrl);
        if (match) await closeTabsByIds([match.id]);
      }
    });

    playCloseSound();

    // Animate the chip row out
    const chip = actionEl.closest('.page-chip');
    if (chip) {
      const rect = chip.getBoundingClientRect();
      shootConfetti(rect.left + rect.width / 2, rect.top + rect.height / 2);
      chip.style.transition = 'opacity 0.2s, transform 0.2s';
      chip.style.opacity    = '0';
      chip.style.transform  = 'scale(0.8)';
      setTimeout(() => chip.remove(), 200);
      await new Promise(resolve => setTimeout(resolve, 220));
    }

    // Update footer
    const statTabs = document.getElementById('statTabs');
    if (statTabs) statTabs.textContent = getRealTabs().length;

    showToast('Tab closed');
    await renderDashboard();
    return;
  }

  // ---- Archive one live tab (persist first, then close it) ----
  if (action === 'archive-single-tab') {
    e.stopPropagation();
    const tabId = tabIdFromElement(actionEl);
    if (tabId === null) return;

    let tab = openTabs.find(item => item.id === tabId) || null;
    if (!tab) {
      try { tab = await chrome.tabs.get(tabId); }
      catch { /* It was closed between render and click. */ }
    }

    if (!tab) {
      showToast('That tab is no longer open');
      await renderDashboard();
      return;
    }

    await archiveTabsWithFeedback([tab]);
    return;
  }

  // ---- Restore one archived tab into this dashboard's window ----
  if (action === 'restore-archived-tab') {
    const id = actionEl.dataset.archiveId;
    if (!id) return;
    actionEl.disabled = true;
    actionEl.closest('.archive-item')?.classList.add('restoring');

    try {
      // Cmd/Ctrl-click restores in the background; a normal click activates it.
      const restored = await runLocalDashboardMutation(() => {
        return restoreArchivedTab(id, !(e.metaKey || e.ctrlKey));
      });
      if (!restored) {
        showToast('That archived tab is no longer available');
      } else {
        showToast('Tab restored to this window');
      }
      await renderDashboard();
    } catch (error) {
      console.error('[tab-out] Failed to restore archived tab:', error);
      actionEl.disabled = false;
      actionEl.closest('.archive-item')?.classList.remove('restoring');
      showToast('Could not restore that tab');
    }
    return;
  }

  // ---- Permanently forget an archived tab ----
  if (action === 'forget-archived-tab') {
    e.stopPropagation();
    const id = actionEl.dataset.archiveId;
    if (!id) return;

    await runLocalDashboardMutation(() => removeArchivedTabs([id]));
    const item = actionEl.closest('.archive-item');
    if (item) {
      item.classList.add('removing');
      setTimeout(() => {
        item.remove();
        renderArchiveColumn();
      }, 300);
    }
    return;
  }

  // ---- Archive all tabs in one domain group ----
  if (action === 'archive-domain-tabs') {
    const domainId = actionEl.dataset.domainId;
    const group = domainGroups.find(item => {
      return 'domain-' + item.domain.replace(/[^a-z0-9]/g, '-') === domainId;
    });
    if (!group) return;

    const groupLabel = group.domain === '__landing-pages__'
      ? 'from Homepages'
      : `from ${group.label || friendlyDomain(group.domain)}`;
    await archiveTabsWithFeedback(group.tabs, groupLabel);
    return;
  }

  // ---- Close all tabs in a domain group ----
  if (action === 'close-domain-tabs') {
    const domainId = actionEl.dataset.domainId;
    const group    = domainGroups.find(g => {
      return 'domain-' + g.domain.replace(/[^a-z0-9]/g, '-') === domainId;
    });
    if (!group) return;

    const tabIds = group.tabs.map(tab => tab.id);
    await runLocalDashboardMutation(() => closeTabsByIds(tabIds));

    if (card) {
      playCloseSound();
      animateCardOut(card);
    }

    // Remove from in-memory groups
    const idx = domainGroups.indexOf(group);
    if (idx !== -1) domainGroups.splice(idx, 1);

    const groupLabel = group.domain === '__landing-pages__' ? 'Homepages' : (group.label || friendlyDomain(group.domain));
    showToast(`Closed ${tabIds.length} tab${tabIds.length !== 1 ? 's' : ''} from ${groupLabel}`);

    const statTabs = document.getElementById('statTabs');
    if (statTabs) statTabs.textContent = getRealTabs().length;
    await new Promise(resolve => setTimeout(resolve, 320));
    await renderDashboard();
    return;
  }

  // ---- Close all real tabs in one browser window ----
  if (action === 'close-window-tabs') {
    const windowId = Number(actionEl.dataset.windowId);
    const group = windowGroups.find(item => item.windowId === windowId);
    if (!group || group.tabs.length === 0) return;

    const tabIds = group.tabs.map(tab => tab.id);
    await runLocalDashboardMutation(() => closeTabsByIds(tabIds));
    playCloseSound();
    showToast(`Closed ${tabIds.length} tab${tabIds.length !== 1 ? 's' : ''} from ${group.label}`);
    await renderDashboard();
    return;
  }

  // ---- Archive all real tabs in one browser window ----
  if (action === 'archive-window-tabs') {
    const windowId = Number(actionEl.dataset.windowId);
    const group = windowGroups.find(item => item.windowId === windowId);
    if (!group || group.tabs.length === 0) return;

    await archiveTabsWithFeedback(group.tabs, `from ${group.label}`);
    return;
  }

  // ---- Close duplicates, keep one copy ----
  if (action === 'dedup-keep-one') {
    const urlsEncoded = actionEl.dataset.dupeUrls || '';
    const urls = urlsEncoded.split(',').map(u => decodeURIComponent(u)).filter(Boolean);
    if (urls.length === 0) return;

    await runLocalDashboardMutation(() => closeDuplicateTabs(urls, true));
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
    await new Promise(resolve => setTimeout(resolve, 220));
    await renderDashboard();
    return;
  }

  // ---- Archive ALL open web tabs ----
  if (action === 'archive-all-open-tabs') {
    await archiveTabsWithFeedback(getRealTabs());
    return;
  }

  // ---- Close ALL open tabs ----
  if (action === 'close-all-open-tabs') {
    const allTabIds = getRealTabs().map(tab => tab.id);
    await runLocalDashboardMutation(() => closeTabsByIds(allTabIds));
    playCloseSound();

    document.querySelectorAll('#openTabsMissions .mission-card').forEach(c => {
      shootConfetti(
        c.getBoundingClientRect().left + c.offsetWidth / 2,
        c.getBoundingClientRect().top  + c.offsetHeight / 2
      );
      animateCardOut(c);
    });

    showToast('All tabs closed. Fresh start.');
    await new Promise(resolve => setTimeout(resolve, 320));
    await renderDashboard();
    return;
  }
});

// ---- Archive search — filter archived items as user types ----
document.addEventListener('input', async (e) => {
  if (e.target.id !== 'archiveSearch') return;

  const archiveList = document.getElementById('archiveList');
  if (!archiveList) return;

  try {
    const archivedTabs = await getArchivedTabs();
    const nextHtml = renderArchiveResults(archivedTabs, e.target.value);
    archiveList.innerHTML = nextHtml;
    lastArchiveRenderKey = getArchiveRenderKey(archivedTabs, e.target.value, nextHtml);
  } catch (err) {
    console.warn('[tab-out] Archive search failed:', err);
  }
});


/* ----------------------------------------------------------------
   INITIALIZE
   ---------------------------------------------------------------- */

[
  chrome.tabs.onCreated,
  chrome.tabs.onRemoved,
  chrome.tabs.onMoved,
  chrome.tabs.onAttached,
  chrome.tabs.onDetached,
  chrome.windows.onCreated,
  chrome.windows.onRemoved,
].forEach(event => event.addListener(scheduleDashboardRefresh));

// Activation changes only one visual marker in Windows view. Rebuilding every
// card when the user merely returns to the Tab Out tab caused the most obvious
// reload-like flash.
chrome.tabs.onActivated.addListener(updateActiveTabIndicator);

// Ignore noisy loading/status updates. Only fields that change what Tab Out
// actually displays should cause a repaint.
chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
  const displayedFields = ['url', 'title', 'favIconUrl', 'pinned', 'groupId'];
  if (displayedFields.some(field => Object.prototype.hasOwnProperty.call(changeInfo, field))) {
    scheduleDashboardRefresh();
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;

  if (changes[OPEN_TABS_VIEW_KEY]) {
    const nextView = changes[OPEN_TABS_VIEW_KEY].newValue;
    if ((nextView === 'domains' || nextView === 'windows') && nextView !== activeOpenTabsView) {
      activeOpenTabsView = nextView;
      scheduleDashboardRefresh();
    }
  }

  // A first-run migration writes both keys during the initial render; that
  // render already includes the migrated items, so scheduling another pass
  // would only replay the page once more.
  if (changes[ARCHIVED_TABS_KEY] && !changes[ARCHIVE_MIGRATION_KEY]) {
    scheduleDashboardRefresh();
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    if (refreshTimer !== null) dashboardDirtyWhileHidden = true;
    cancelScheduledDashboardRefresh();
    return;
  }

  if (!dashboardDirtyWhileHidden) return;
  dashboardDirtyWhileHidden = false;
  scheduleDashboardRefresh();
});

async function initializeDashboard() {
  try {
    const saved = await chrome.storage.local.get(OPEN_TABS_VIEW_KEY);
    if (saved[OPEN_TABS_VIEW_KEY] === 'windows') activeOpenTabsView = 'windows';
  } catch (error) {
    console.warn('[tab-out] Could not load the saved view:', error);
  }

  await renderDashboard();
}

initializeDashboard().catch(error => {
  console.error('[tab-out] Dashboard failed to initialize:', error);
});
