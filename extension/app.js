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

let searchQuery = '';
let tabSearchInitialized = false;

/**
 * fetchOpenTabs()
 *
 * Reads all currently open browser tabs directly from Chrome.
 * Sets the extensionId flag so we can identify Tab Out's own pages.
 */
async function fetchOpenTabs() {
  try {
    // runtime.getURL() returns the right scheme per browser:
    //   chrome-extension://<id>/index.html  in Chrome
    //   moz-extension://<id>/index.html     in Firefox
    const newtabUrl = chrome.runtime.getURL('index.html');

    const tabs = await chrome.tabs.query({});
    openTabs = tabs.map(t => ({
      id:         t.id,
      url:        t.url,
      title:      t.title,
      favIconUrl: t.favIconUrl || '',
      windowId:   t.windowId,
      active:     t.active,
      // Flag Tab Out's own pages so we can detect duplicate new tabs
      // (Chrome's blank new tab is chrome://newtab/; Firefox's is about:newtab or about:home)
      isTabOut:
        t.url === newtabUrl ||
        t.url === 'chrome://newtab/' ||
        t.url === 'about:newtab' ||
        t.url === 'about:home',
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
  if (!url) return false;
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

  if (matches.length === 0) return false;

  // Prefer a match in a different window so it actually switches windows
  const match = matches.find(t => t.windowId !== currentWindow.id) || matches[0];
  await chrome.tabs.update(match.id, { active: true });
  await chrome.windows.update(match.windowId, { focused: true });
  return true;
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
  // Cross-browser: chrome-extension:// in Chrome, moz-extension:// in Firefox
  const newtabUrl = chrome.runtime.getURL('index.html');

  const allTabs = await chrome.tabs.query({});
  const currentWindow = await chrome.windows.getCurrent();
  const tabOutTabs = allTabs.filter(t =>
    t.url === newtabUrl ||
    t.url === 'chrome://newtab/' ||
    t.url === 'about:newtab' ||
    t.url === 'about:home'
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

async function getBookmarks() {
  try { return await chrome.bookmarks.getTree(); } catch { return []; }
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
 */
async function dismissSavedTab(id) {
  const { deferred = [] } = await chrome.storage.local.get('deferred');
  const tab = deferred.find(t => t.id === id);
  if (tab) { tab.dismissed = true; await chrome.storage.local.set({ deferred }); }
}

async function deleteSavedTab(id) {
  const { deferred = [] } = await chrome.storage.local.get('deferred');
  await chrome.storage.local.set({ deferred: deferred.filter(t => t.id !== id) });
}

/* ----------------------------------------------------------------
   QUICK ACCESS
   ---------------------------------------------------------------- */

const QUICK_ACCESS_DEFAULTS = [
  { url: 'https://mail.google.com/mail/u/0/#inbox', label: 'Gmail' },
  { url: 'https://x.com/home', label: 'X' },
  { url: 'https://github.com/', label: 'GitHub' },
  { url: 'https://claude.ai/', label: 'Claude' },
  { url: 'https://chatgpt.com/', label: 'ChatGPT' },
];

async function getQuickAccess() {
  const stored = await chrome.storage.local.get('quickAccess');
  if (stored.quickAccess === undefined) {
    const seeded = QUICK_ACCESS_DEFAULTS.map((s, i) => ({ id: (Date.now() + i).toString(), url: s.url, label: s.label }));
    await chrome.storage.local.set({ quickAccess: seeded });
    return seeded;
  }
  return stored.quickAccess;
}

async function addQuickAccess({ url, label }) {
  if (!url) return;
  let parsed; try { parsed = new URL(url); } catch { return; }
  const finalLabel = (label && label.trim()) || friendlyDomain(parsed.hostname) || parsed.hostname;
  const { quickAccess = [] } = await chrome.storage.local.get('quickAccess');
  quickAccess.push({ id: Date.now().toString(), url: parsed.href, label: finalLabel });
  await chrome.storage.local.set({ quickAccess });
}

async function removeQuickAccess(id) {
  const { quickAccess = [] } = await chrome.storage.local.get('quickAccess');
  await chrome.storage.local.set({ quickAccess: quickAccess.filter(s => s.id !== id) });
}

async function getQuickAccessMode() {
  const { quickAccessMode = 'card' } = await chrome.storage.local.get('quickAccessMode');
  return quickAccessMode === 'bar' ? 'bar' : 'card';
}

async function toggleQuickAccessMode() {
  const next = await getQuickAccessMode() === 'card' ? 'bar' : 'card';
  await chrome.storage.local.set({ quickAccessMode: next });
  return next;
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
 * undoClose — save URLs before closing so they can be restored
 */
let _lastClosedUrls = [];
let _lastClosedToastTimer = null;

function captureClosedTabs(urls) {
  _lastClosedUrls = urls.filter(Boolean);
}

async function undoLastClose() {
  if (_lastClosedUrls.length === 0) return;
  const urls = [..._lastClosedUrls];
  _lastClosedUrls = [];
  for (const url of urls) {
    try { await chrome.tabs.create({ url, active: false }); } catch {}
  }
  await fetchOpenTabs();
  renderDashboard();
  showToast(urls.length === 1 ? 'Tab restored' : `${urls.length} tabs restored`);
}

/**
 * showToast(message, { undo } = {})
 *
 * Brief pop-up notification at the bottom of the screen.
 * If `undo` is true, shows an "Undo" button that calls undoLastClose.
 */
function showToast(message, opts = {}) {
  const toast = document.getElementById('toast');
  const textEl = document.getElementById('toastText');
  const undoBtn = document.getElementById('toastUndo');
  textEl.textContent = message;

  if (_lastClosedToastTimer) clearTimeout(_lastClosedToastTimer);

  if (opts.undo && _lastClosedUrls.length > 0) {
    undoBtn.style.display = '';
    undoBtn.onclick = async () => {
      await undoLastClose();
      toast.classList.remove('visible');
      undoBtn.style.display = 'none';
    };
  } else {
    undoBtn.style.display = 'none';
  }

  toast.classList.add('visible');
  _lastClosedToastTimer = setTimeout(() => {
    toast.classList.remove('visible');
    _lastClosedUrls = [];
    if (undoBtn) undoBtn.style.display = 'none';
  }, 4000);
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

function matchTabBySearch(tab, query) {
  if (!query) return true;
  return (tab.title || '').toLowerCase().includes(query) || (tab.url || '').toLowerCase().includes(query);
}

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function getSearchEmptyStateHTML(rawQuery) {
  return '<div class="missions-search-empty">No tabs match <strong>&quot;' + escapeHtml(rawQuery) + '&quot;</strong></div>';
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


function faviconSrc(tab) {
  if (!tab) return '';
  if (tab.favIconUrl && !tab.favIconUrl.startsWith('chrome://')) return tab.favIconUrl;
  try {
    const { hostname } = new URL(tab.url || '');
    if (!hostname) return '';
    return 'https://www.google.com/s2/favicons?domain=' + encodeURIComponent(hostname) + '&sz=32';
  } catch { return ''; }
}

/* ----------------------------------------------------------------
   SVG ICON STRINGS
   ---------------------------------------------------------------- */
const ICONS = {
  tabs:    `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M3 8.25V18a2.25 2.25 0 0 0 2.25 2.25h13.5A2.25 2.25 0 0 0 21 18V8.25m-18 0V6a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 6v2.25m-18 0h18" /></svg>`,
  close:   `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>`,
  archive: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 0 1-2.247 2.118H6.622a2.25 2.25 0 0 1-2.247-2.118L3.75 7.5m6 4.125l2.25 2.25m0 0l2.25 2.25M12 13.875l2.25-2.25M12 13.875l-2.25 2.25M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125Z" /></svg>`,
  focus:   `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="m4.5 19.5 15-15m0 0H8.25m11.25 0v11.25" /></svg>`,
  trash:   `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673A2.25 2.25 0 0 1 15.916 21H8.084a2.25 2.25 0 0 1-2.244-1.327L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" /></svg>`,
};


/* ----------------------------------------------------------------
   IN-MEMORY STORE FOR OPEN-TAB GROUPS
   ---------------------------------------------------------------- */
let domainGroups = [];
let showWindowLabels = false;
let groupByWindow = false;
let windowNameMap = {};


/* ----------------------------------------------------------------
   WINDOW MANAGEMENT
   ---------------------------------------------------------------- */

function buildWindowNameMap() {
  const windowIds = [...new Set(openTabs.map(t => t.windowId))];
  windowNameMap = {};
  windowIds.forEach((id, i) => { windowNameMap[id] = 'Window ' + (i + 1); });
}

function getWindowCount() {
  return new Set(openTabs.map(t => t.windowId)).size;
}

async function mergeAllWindows() {
  const currentWindow = await chrome.windows.getCurrent();
  const allTabs = await chrome.tabs.query({});
  const tabsToMove = allTabs.filter(t => t.windowId !== currentWindow.id);
  for (const tab of tabsToMove) {
    await chrome.tabs.move(tab.id, { windowId: currentWindow.id, index: -1 });
  }
  await fetchOpenTabs();
}

async function moveTabToWindow(tabUrl, targetWindowId) {
  const allTabs = await chrome.tabs.query({});
  const match = allTabs.find(t => t.url === tabUrl);
  if (!match) return;
  if (targetWindowId === null) {
    await chrome.windows.create({ tabId: match.id });
  } else {
    await chrome.tabs.move(match.id, { windowId: targetWindowId, index: -1 });
    await chrome.windows.update(targetWindowId, { focused: false });
  }
  await fetchOpenTabs();
}

function buildWindowGroups(groups) {
  const byWindow = {};
  for (const g of groups) {
    const perWin = {};
    for (const tab of g.tabs) {
      const wid = tab.windowId;
      if (!perWin[wid]) perWin[wid] = { ...g, tabs: [] };
      perWin[wid].tabs.push(tab);
    }
    for (const [wid, subGroup] of Object.entries(perWin)) {
      const numWid = Number(wid);
      if (!byWindow[numWid]) {
        byWindow[numWid] = { windowId: numWid, name: windowNameMap[numWid] || 'Window ' + numWid, groups: [] };
      }
      byWindow[numWid].groups.push(subGroup);
    }
  }
  return Object.values(byWindow).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
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
      !url.startsWith('moz-extension://') &&
      !url.startsWith('resource://') &&
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
    const faviconUrl = faviconSrc(tab);
    const winLabel = showWindowLabels && windowNameMap[tab.windowId]
      ? `<span class="chip-window-badge">${windowNameMap[tab.windowId]}</span>` : '';
    return `<div class="page-chip clickable${chipClass}" data-action="focus-tab" data-tab-url="${safeUrl}" title="${safeTitle}">
      ${faviconUrl ? `<img class="chip-favicon chip-favicon--hide-on-error" src="${faviconUrl}" alt="">` : ''}
      <span class="chip-text">${label}</span>${dupeTag}${winLabel}
      <div class="chip-actions">
        <button class="chip-action chip-move" data-action="move-tab-menu" data-tab-url="${safeUrl}" title="Move to window">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"/></svg>
        </button>
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
    const safeUrl   = (tab.url || '').replace(/"/g, '&quot;');
    const safeTitle = label.replace(/"/g, '&quot;');
    const faviconUrl = faviconSrc(tab);
    const winLabel = showWindowLabels && windowNameMap[tab.windowId]
      ? `<span class="chip-window-badge">${windowNameMap[tab.windowId]}</span>` : '';
    return `<div class="page-chip clickable${chipClass}" data-action="focus-tab" data-tab-url="${safeUrl}" title="${safeTitle}">
      ${faviconUrl ? `<img class="chip-favicon chip-favicon--hide-on-error" src="${faviconUrl}" alt="">` : ''}
      <span class="chip-text">${label}</span>${dupeTag}${winLabel}
      <div class="chip-actions">
        <button class="chip-action chip-move" data-action="move-tab-menu" data-tab-url="${safeUrl}" title="Move to window">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"/></svg>
        </button>
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

    // Render active checklist items
    if (active.length > 0) {
      countEl.textContent = `${active.length} item${active.length !== 1 ? 's' : ''}`;
      list.innerHTML = active.map(item => renderDeferredItem(item)).join('');
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
 * renderDeferredItem(item)
 *
 * Builds HTML for one active checklist item: checkbox, title link,
 * domain, time ago, dismiss button.
 */
function renderDeferredItem(item) {
  let domain = '';
  try { domain = new URL(item.url).hostname.replace(/^www\./, ''); } catch {}
  const faviconUrl = faviconSrc(item);
  const ago = timeAgo(item.savedAt);

  return `
    <div class="deferred-item" data-deferred-id="${item.id}">
      <input type="checkbox" class="deferred-checkbox" data-action="check-deferred" data-deferred-id="${item.id}">
      <div class="deferred-info">
        <a href="${item.url}" target="_blank" rel="noopener" class="deferred-title" title="${(item.title || '').replace(/"/g, '&quot;')}">
          ${faviconUrl ? '<img class="chip-favicon chip-favicon--hide-on-error" src="' + faviconUrl + '" alt="" style="width:14px;height:14px;vertical-align:-2px;margin-right:4px">' : ''}${item.title || item.url}
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
    <div class="archive-item" data-deferred-id="${item.id}">
      <a href="${item.url}" class="archive-item-title" title="${(item.title || '').replace(/"/g, '&quot;')}">
        ${item.title || item.url}
      </a>
      <span class="archive-item-date">${ago}</span>
      <button class="archive-item-dismiss" data-action="dismiss-archive" data-deferred-id="${item.id}" title="Delete">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
      </button>
    </div>`;
}


/* ----------------------------------------------------------------
   QUICK ACCESS — Renderer
   ---------------------------------------------------------------- */

function quickAccessFaviconUrls(url) {
  let hostname = '', origin = '';
  try { const u = new URL(url); hostname = u.hostname; origin = u.origin; } catch {}
  return { primary: origin ? origin + '/favicon.ico' : '', fallback: hostname ? 'https://www.google.com/s2/favicons?domain=' + encodeURIComponent(hostname) + '&sz=64' : '' };
}

const QUICK_ACCESS_MODE_ICONS = {
  toBar: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5M3.75 17.25h16.5"/></svg>',
  toCard: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25A2.25 2.25 0 0 1 8.25 10.5H6A2.25 2.25 0 0 1 3.75 8.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25A2.25 2.25 0 0 1 13.5 8.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25A2.25 2.25 0 0 1 13.5 18v-2.25Z"/></svg>',
};

async function renderQuickAccess() {
  const host = document.getElementById('quickAccessContainer');
  if (!host) return;
  const shortcuts = await getQuickAccess();
  if (shortcuts.length === 0) { host.style.display = 'none'; return; }
  const mode = await getQuickAccessMode();
  host.innerHTML = mode === 'bar' ? renderQuickAccessBarHTML(shortcuts) : renderQuickAccessCardHTML(shortcuts);
  host.style.display = 'block';
  host.querySelectorAll('.qa-favicon').forEach(img => {
    let triedFallback = false;
    img.addEventListener('error', () => {
      const fallback = img.dataset.fallbackSrc;
      if (!triedFallback && fallback && fallback !== img.src) { triedFallback = true; img.src = fallback; return; }
      img.style.display = 'none';
    });
  });
}

function renderQuickAccessCardHTML(shortcuts) {
  const chips = shortcuts.map(s => {
    const { primary, fallback } = quickAccessFaviconUrls(s.url);
    const safeUrl = (s.url || '').replace(/"/g, '&quot;');
    const safeLabel = (s.label || '').replace(/"/g, '&quot;');
    return '<div class="page-chip clickable" data-action="open-shortcut" data-shortcut-url="' + safeUrl + '" title="' + safeLabel + '">' +
      (primary ? '<img class="chip-favicon qa-favicon" src="' + primary + '" data-fallback-src="' + fallback.replace(/"/g, '&quot;') + '" alt="">' : '') +
      '<span class="chip-text">' + safeLabel + '</span>' +
      '<div class="chip-actions"><button class="chip-action chip-close" data-action="remove-shortcut" data-shortcut-id="' + s.id + '" title="Remove shortcut"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12"/></svg></button></div></div>';
  }).join('');
  return '<div class="missions qa-card-wrap"><div class="mission-card domain-card has-neutral-bar" id="quickAccessCard"><div class="status-bar"></div><div class="mission-content"><div class="mission-top"><span class="mission-name">Quick access</span><span class="open-tabs-badge">' + ICONS.tabs + ' ' + shortcuts.length + ' shortcut' + (shortcuts.length !== 1 ? 's' : '') + '</span><button class="qa-mode-toggle" data-action="toggle-quick-access-mode" title="Switch to compact view">' + QUICK_ACCESS_MODE_ICONS.toBar + '</button></div><div class="mission-pages">' + chips + '</div><div class="actions" id="quickAccessActions"><button class="action-btn" data-action="start-add-shortcut"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15"/></svg> Add shortcut</button></div></div></div></div>';
}

function renderQuickAccessBarHTML(shortcuts) {
  const buttons = shortcuts.map(s => {
    const { primary, fallback } = quickAccessFaviconUrls(s.url);
    const safeUrl = (s.url || '').replace(/"/g, '&quot;');
    const safeLabel = (s.label || '').replace(/"/g, '&quot;');
    return '<button class="qa-bar-btn" data-action="open-shortcut" data-shortcut-url="' + safeUrl + '" title="' + safeLabel + '">' +
      (primary ? '<img class="qa-favicon" src="' + primary + '" data-fallback-src="' + fallback.replace(/"/g, '&quot;') + '" alt="">' : '') +
      '<span class="qa-bar-initial"' + (primary ? ' hidden' : '') + '>' + (safeLabel.charAt(0) || '?').toUpperCase() + '</span>' +
      '<span class="qa-bar-remove" data-action="remove-shortcut" data-shortcut-id="' + s.id + '" title="Remove shortcut"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="3" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12"/></svg></span></button>';
  }).join('');
  return '<div class="qa-bar">' + buttons + '<button class="qa-bar-add" data-action="start-add-shortcut" title="Add shortcut"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15"/></svg></button><div class="qa-bar-spacer"></div><button class="qa-mode-toggle" data-action="toggle-quick-access-mode" title="Switch to card view">' + QUICK_ACCESS_MODE_ICONS.toCard + '</button></div>';
}

/* ----------------------------------------------------------------
   OTHER DEVICES — synced tabs via chrome.sessions
   ---------------------------------------------------------------- */

let otherDeviceGroups = [];

async function fetchOtherDeviceTabs() {
  otherDeviceGroups = [];
  if (!chrome.sessions || typeof chrome.sessions.getDevices !== 'function') return [];
  try {
    const devices = await new Promise((resolve, reject) => {
      chrome.sessions.getDevices((result) => {
        const err = chrome.runtime.lastError;
        if (err) reject(err); else resolve(result || []);
      });
    });
    for (const device of devices) {
      const tabs = []; const seenUrls = new Set(); let lastModified = 0;
      for (const session of (device.sessions || [])) {
        if (session.lastModified && session.lastModified > lastModified) lastModified = session.lastModified;
        const windowTabs = session.window && Array.isArray(session.window.tabs) ? session.window.tabs : [];
        const allTabs = session.tab ? [session.tab, ...windowTabs] : windowTabs;
        for (const t of allTabs) {
          const url = t.url || '';
          if (!url || url.startsWith('chrome://') || url.startsWith('chrome-extension://') || url.startsWith('about:')) continue;
          if (seenUrls.has(url)) continue;
          seenUrls.add(url);
          tabs.push({ url, title: t.title || url, sessionId: t.sessionId });
        }
      }
      if (tabs.length > 0) otherDeviceGroups.push({ deviceName: device.deviceName || 'Other device', lastModified, tabs });
    }
    otherDeviceGroups.sort((a, b) => b.lastModified - a.lastModified);
  } catch (err) { console.warn('[tab-out] sessions.getDevices failed:', err); }
  return otherDeviceGroups;
}

async function restoreRemoteSession(sessionId, fallbackUrl) {
  if (sessionId && chrome.sessions && typeof chrome.sessions.restore === 'function') {
    try { await new Promise((resolve, reject) => { chrome.sessions.restore(sessionId, () => { chrome.runtime.lastError ? reject(chrome.runtime.lastError) : resolve(); }); }); return; }
    catch (err) { console.warn('[tab-out] sessions.restore failed:', err); }
  }
  if (fallbackUrl) { try { await chrome.tabs.create({ url: fallbackUrl, active: true }); } catch {} }
}

function renderOtherDevicesSection() {
  const section = document.getElementById('otherDevicesSection');
  const missions = document.getElementById('otherDevicesMissions');
  if (!section || !missions) return;
  if (otherDeviceGroups.length === 0) { section.style.display = 'none'; return; }
  section.style.display = 'block';
  const totalTabs = otherDeviceGroups.reduce((s, d) => s + d.tabs.length, 0);
  const countEl = document.getElementById('otherDevicesSectionCount');
  if (countEl) countEl.textContent = otherDeviceGroups.length + ' device' + (otherDeviceGroups.length !== 1 ? 's' : '') + ' · ' + totalTabs + ' tab' + (totalTabs !== 1 ? 's' : '');
  missions.innerHTML = otherDeviceGroups.map((d, i) => {
    const lastSeen = d.lastModified ? 'last active ' + timeAgo(new Date(d.lastModified * 1000).toISOString()) : '';
    return '<div class="device-subsection"><div class="device-subsection-header">' +
      '<span class="device-subsection-name">' + d.deviceName + '</span>' +
      '<span class="device-subsection-meta">' + d.tabs.length + ' tab' + (d.tabs.length !== 1 ? 's' : '') + (lastSeen ? ' · ' + lastSeen : '') + '</span></div>' +
      '<div class="device-tabs">' + d.tabs.map(t => {
        const safeUrl = (t.url || '').replace(/"/g, '&quot;');
        return '<div class="page-chip clickable" data-action="restore-remote-tab" data-session-id="' + (t.sessionId || '') + '" data-tab-url="' + safeUrl + '" title="' + (t.title || t.url).replace(/"/g, '&quot;') + '">' +
          '<span class="chip-text">' + (t.title || t.url) + '</span></div>';
      }).join('') + '</div></div>';
  }).join('');
}

async function renderBookmarks() {
  const column  = document.getElementById('deferredColumn');
  const section = document.getElementById('bookmarksSection');
  const list    = document.getElementById('bookmarksList');
  const countEl = document.getElementById('bookmarksCount');
  if (!section || !list) return;
  try {
    const tree = await getBookmarks();
    const hasBookmarks = tree.some(node => node.children && node.children.length > 0);
    if (!hasBookmarks) { section.style.display = 'none'; return; }
    section.style.display = 'block';
    if (column) column.style.display = 'block';
    const rootChildren = tree[0]?.children || [];
    let bookmarkCount = 0;
    function countNodes(nodes) {
      for (const n of nodes) { if (n.url) bookmarkCount++; if (n.children) countNodes(n.children); }
    }
    countNodes(rootChildren);
    countEl.textContent = bookmarkCount + ' item' + (bookmarkCount !== 1 ? 's' : '');
    function renderNode(node) {
      if (node.url) {
        const faviconUrl = 'chrome-extension://' + chrome.runtime.id + '/_favicon/?pageUrl=' + encodeURIComponent(node.url) + '&size=32';
        return '<div class="bookmark-item"><a href="' + node.url + '" class="bookmark-link" title="' + (node.title || '').replace(/"/g, '&quot;') + '">' +
          '<img src="' + faviconUrl + '" class="bookmark-favicon" alt="" onerror="this.style.display=\'none\'">' +
          '<span>' + (node.title || node.url) + '</span></a></div>';
      } else if (node.children) {
        if (node.children.length === 0 && node.id !== '0') return '';
        const childHtml = node.children.map(c => renderNode(c)).join('');
        if (node.id === '0' || node.id === '1' || node.id === '2' || node.id === '3') return childHtml;
        return '<div class="bookmark-folder"><button class="bookmark-folder-toggle" data-action="toggle-bookmark-folder">' +
          '<svg class="folder-chevron" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5"/></svg>' +
          '<svg class="folder-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" style="width:14px;height:14px;color:var(--muted)"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.625-12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm-3.75 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z"/><path stroke-linecap="round" stroke-linejoin="round" d="M3.75 9.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25h16.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H3.75Z"/></svg>' +
          '<span class="folder-name">' + node.title + '</span></button>' +
          '<div class="bookmark-folder-children" style="display:none">' + childHtml + '</div></div>';
      }
      return '';
    }
    list.innerHTML = renderNode(tree[0]);
  } catch (err) {
    console.warn('[tab-out] Could not load bookmarks:', err);
    section.style.display = 'none';
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
 * 6. Renders the "Saved for Later" checklist
 */
async function renderStaticDashboard() {
  // --- Header ---
  const greetingEl = document.getElementById('greeting');
  const dateEl     = document.getElementById('dateDisplay');
  if (greetingEl) greetingEl.textContent = getGreeting();
  if (dateEl)     dateEl.textContent     = getDateDisplay();

  // --- Fetch tabs ---
  await fetchOpenTabs();
  await fetchOtherDeviceTabs();
  buildWindowNameMap();
  let realTabs = getRealTabs();

  const totalBeforeFilter = realTabs.length;
  if (searchQuery) realTabs = realTabs.filter(t => matchTabBySearch(t, searchQuery));

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

  // --- Render domain cards ---
  const openTabsSection      = document.getElementById('openTabsSection');
  const openTabsMissionsEl   = document.getElementById('openTabsMissions');
  const openTabsSectionCount = document.getElementById('openTabsSectionCount');
  const openTabsSectionTitle = document.getElementById('openTabsSectionTitle');

  if (domainGroups.length > 0 && openTabsSection) {
    if (openTabsSectionTitle) openTabsSectionTitle.textContent = 'Open tabs';
    const winCount = getWindowCount();
    const mergeBtn = winCount > 1
      ? ` <button class="action-btn save-tabs" data-action="merge-windows" style="font-size:11px;padding:3px 10px;">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" style="width:12px;height:12px"><path stroke-linecap="round" stroke-linejoin="round" d="M9 9V4.5M9 9H4.5M9 9 3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5 5.25 5.25" /></svg>
          Merge ${winCount} windows</button>` : '';
    const showWinToggle = winCount > 1
      ? ` <button class="action-btn${showWindowLabels ? ' primary' : ''}" data-action="toggle-window-labels" style="font-size:11px;padding:3px 10px;">
          ${showWindowLabels ? 'Hide' : 'Show'} windows</button>` : '';
    const groupByWinToggle = winCount > 1
      ? ` <button class="action-btn${groupByWindow ? ' primary' : ''}" data-action="toggle-group-by-window" style="font-size:11px;padding:3px 10px;">
          Group by ${groupByWindow ? 'domain' : 'window'}</button>` : '';
    openTabsSectionCount.innerHTML = `${domainGroups.length} domain${domainGroups.length !== 1 ? 's' : ''}${winCount > 1 ? ` &middot; ${winCount} windows` : ''} &nbsp;&middot;&nbsp; <button class="action-btn close-tabs" data-action="close-all-open-tabs" style="font-size:11px;padding:3px 10px;">${ICONS.close} Close all ${realTabs.length} tabs</button>${mergeBtn}${groupByWinToggle}${showWinToggle}`;

    if (groupByWindow && winCount > 1) {
      const windowSections = buildWindowGroups(domainGroups);
      openTabsMissionsEl.innerHTML = windowSections.map(w => {
        const tabCountInWindow = w.groups.reduce((s, g) => s + g.tabs.length, 0);
        return '<div class="window-section" data-window-id="' + w.windowId + '">' +
          '<div class="window-section-header"><span class="window-section-name">' + w.name + '</span>' +
          '<span class="window-section-count">' + tabCountInWindow + ' tab' + (tabCountInWindow !== 1 ? 's' : '') + ' &middot; ' + w.groups.length + ' domain' + (w.groups.length !== 1 ? 's' : '') + '</span></div>' +
          '<div class="window-section-body">' + w.groups.map(g => renderDomainCard(g)).join('') + '</div></div>';
      }).join('');
    } else {
      openTabsMissionsEl.innerHTML = domainGroups.map(g => renderDomainCard(g)).join('');
    }
    openTabsSection.style.display = 'block';
  } else if (searchQuery !== '' && totalBeforeFilter > 0 && domainGroups.length === 0 && openTabsSection) {
    if (openTabsSectionTitle) openTabsSectionTitle.textContent = 'Open tabs';
    openTabsSectionCount.innerHTML = '';
    openTabsMissionsEl.innerHTML = getSearchEmptyStateHTML(document.getElementById('tabSearchInput')?.value ?? searchQuery);
    openTabsSection.style.display = 'block';
  } else if (openTabsSection) {
    openTabsSection.style.display = 'none';
  }

  // --- Footer stats ---
  const statTabs = document.getElementById('statTabs');
  if (statTabs) statTabs.textContent = getRealTabs().length;
  const statWindows = document.getElementById('statWindows');
  if (statWindows) statWindows.textContent = getWindowCount();

  // --- Check for duplicate Tab Out tabs ---
  checkTabOutDupes();
  await renderQuickAccess();

  // --- Render "Saved for Later" column ---
  await renderDeferredColumn();
  await renderBookmarks();
  renderOtherDevicesSection();
}

function setupTabSearch() {
  const input = document.getElementById('tabSearchInput');
  const clearBtn = document.getElementById('tabSearchClear');
  if (!input || !clearBtn) return;
  let debounceTimer = null;
  const DEBOUNCE_MS = 120;
  function syncClearButtonVisibility() { clearBtn.style.display = input.value.length > 0 ? 'inline-flex' : 'none'; }
  function commitQueryFromInput() { searchQuery = input.value.trim().toLowerCase(); renderStaticDashboard(); }
  input.addEventListener('input', () => { syncClearButtonVisibility(); if (debounceTimer) clearTimeout(debounceTimer); debounceTimer = setTimeout(commitQueryFromInput, DEBOUNCE_MS); });
  clearBtn.addEventListener('click', () => { if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; } input.value = ''; syncClearButtonVisibility(); searchQuery = ''; renderStaticDashboard(); input.focus(); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; } input.value = ''; syncClearButtonVisibility(); searchQuery = ''; renderStaticDashboard(); input.blur(); } });
  function isTypingElsewhere() { const ae = document.activeElement; if (!ae) return false; if (ae === input) return true; const tag = ae.tagName; return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!ae.isContentEditable; }
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey && !isTypingElsewhere()) { e.preventDefault(); input.focus(); input.select(); return; }
    if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); input.focus(); input.select(); }
  });
  tabSearchInitialized = true;
}

async function renderDashboard() {
  await renderStaticDashboard();
  if (!tabSearchInitialized) setupTabSearch();
}


/* ----------------------------------------------------------------
   MOVE-TAB POPOVER
   ---------------------------------------------------------------- */

function closeMoveTabMenu() {
  const existing = document.getElementById('moveTabMenu');
  if (existing) existing.remove();
}

function openMoveTabMenu(anchorEl, tabUrl) {
  closeMoveTabMenu();
  const tab = openTabs.find(t => t.url === tabUrl);
  const currentWid = tab ? tab.windowId : null;
  const windowIds = [...new Set(openTabs.map(t => t.windowId))];
  const targets = windowIds.filter(wid => wid !== currentWid);
  const safeUrl = tabUrl.replace(/"/g, '&quot;');
  const items = targets.map(wid =>
    '<button class="move-menu-item" data-action="move-tab-exec" data-tab-url="' + safeUrl + '" data-target-window="' + wid + '">' +
    (windowNameMap[wid] || 'Window ' + wid) + '</button>'
  ).join('');
  const menu = document.createElement('div');
  menu.id = 'moveTabMenu';
  menu.className = 'move-menu';
  menu.innerHTML = '<div class="move-menu-header">Move tab to</div>' + items +
    '<button class="move-menu-item move-menu-new" data-action="move-tab-exec" data-tab-url="' + safeUrl + '" data-target-window="new">+ New window</button>';
  document.body.appendChild(menu);
  const rect = anchorEl.getBoundingClientRect();
  menu.style.top = (window.scrollY + rect.bottom + 4) + 'px';
  menu.style.left = (window.scrollX + rect.left) + 'px';
  requestAnimationFrame(() => {
    const mRect = menu.getBoundingClientRect();
    if (mRect.right > window.innerWidth - 8) {
      menu.style.left = (window.scrollX + window.innerWidth - mRect.width - 8) + 'px';
    }
  });
  setTimeout(() => { document.addEventListener('click', onDocClickForMenu, { once: true }); }, 0);
}

function onDocClickForMenu(e) {
  const menu = document.getElementById('moveTabMenu');
  if (!menu) return;
  if (menu.contains(e.target)) { document.addEventListener('click', onDocClickForMenu, { once: true }); return; }
  closeMoveTabMenu();
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

  // ---- Delete an archived saved tab permanently ----
  if (action === 'delete-archive-item') {
    const id = actionEl.dataset.deferredId; if (!id) return;
    await deleteSavedTab(id);
    const item = actionEl.closest('.archive-item');
    if (item) { item.classList.add('removing'); setTimeout(() => renderDeferredColumn(), 180); }
    else await renderDeferredColumn();
    showToast('Archived tab deleted');
    return;
  }

  // ---- Theme toggle ----
  if (action === 'toggle-theme') {
    await toggleTheme();
    return;
  }

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

  // ---- Restore tab from another device ----
  if (action === 'restore-remote-tab') {
    await restoreRemoteSession(actionEl.dataset.sessionId, actionEl.dataset.tabUrl);
    return;
  }

  // ---- Focus a specific tab ----
  if (action === 'focus-tab') {
    const tabUrl = actionEl.dataset.tabUrl;
    if (tabUrl) await focusTab(tabUrl);
    return;
  }

  // ---- Close a single tab ----
  if (action === 'close-single-tab') {
    e.stopPropagation(); // don't trigger parent chip's focus-tab
    const tabUrl = actionEl.dataset.tabUrl;
    if (!tabUrl) return;

    captureClosedTabs([tabUrl]);

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
    if (statTabs) statTabs.textContent = getRealTabs().length;

    showToast('Tab closed', { undo: true });
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

  // ---- Dismiss an archived saved tab ----
  if (action === 'dismiss-archive') {
    const id = actionEl.dataset.deferredId;
    if (!id) return;
    await dismissSavedTab(id);
    const item = actionEl.closest('.archive-item');
    if (item) {
      item.style.opacity = '0';
      item.style.transform = 'translateX(12px)';
      item.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
      setTimeout(() => { item.remove(); renderDeferredColumn(); }, 200);
    }
    return;
  }

  // ---- Toggle bookmark folder ----
  if (action === 'toggle-bookmark-folder') {
    const folder = actionEl.closest('.bookmark-folder');
    if (folder) {
      folder.classList.toggle('open');
      const children = folder.querySelector('.bookmark-folder-children');
      if (children) children.style.display = children.style.display === 'none' ? 'block' : 'none';
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

    captureClosedTabs(urls);

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
    showToast(`Closed ${urls.length} tab${urls.length !== 1 ? 's' : ''} from ${groupLabel}`, { undo: true });

    const statTabs = document.getElementById('statTabs');
    if (statTabs) statTabs.textContent = getRealTabs().length;
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

  // ---- Open a quick-access shortcut ----
  if (action === 'open-shortcut') {
    const url = actionEl.dataset.shortcutUrl;
    if (!url) return;
    const focused = await focusTab(url);
    if (!focused) {
      try {
        const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (currentTab) await chrome.tabs.update(currentTab.id, { url });
        else window.location.href = url;
      } catch { window.location.href = url; }
    }
    return;
  }

  if (action === 'remove-shortcut') {
    e.stopPropagation();
    await removeQuickAccess(actionEl.dataset.shortcutId);
    const holder = actionEl.closest('.page-chip, .qa-bar-btn');
    if (holder) {
      holder.style.transition = 'opacity 0.15s, transform 0.15s';
      holder.style.opacity = '0'; holder.style.transform = 'scale(0.85)';
      setTimeout(() => renderQuickAccess(), 160);
    } else { await renderQuickAccess(); }
    return;
  }

  if (action === 'toggle-quick-access-mode') { await toggleQuickAccessMode(); await renderQuickAccess(); return; }

  // ---- Toggle group-by-window layout ----
  if (action === 'toggle-group-by-window') { groupByWindow = !groupByWindow; await renderDashboard(); return; }

  // ---- Open move-tab popover ----
  if (action === 'move-tab-menu') { e.stopPropagation(); const tabUrl = actionEl.dataset.tabUrl; if (tabUrl) openMoveTabMenu(actionEl, tabUrl); return; }

  // ---- Execute move-tab from popover ----
  if (action === 'move-tab-exec') {
    e.stopPropagation();
    const tabUrl = actionEl.dataset.tabUrl;
    const targetRaw = actionEl.dataset.targetWindow;
    closeMoveTabMenu();
    await moveTabToWindow(tabUrl, targetRaw === 'new' ? null : Number(targetRaw));
    showToast(targetRaw === 'new' ? 'Moved to new window' : 'Tab moved');
    await renderDashboard();
    return;
  }

  // ---- Merge all windows into current ----
  if (action === 'merge-windows') {
    await mergeAllWindows();
    playCloseSound();
    showToast('All windows merged into one');
    await renderDashboard();
    return;
  }

  // ---- Toggle window labels on tabs ----
  if (action === 'toggle-window-labels') {
    showWindowLabels = !showWindowLabels;
    await renderDashboard();
    return;
  }

  if (action === 'start-add-shortcut') {
    const host = document.getElementById('quickAccessContainer');
    if (!host) return;
    const existing = host.querySelector('.quick-access-input');
    if (existing) { existing.focus(); return; }
    const actionsArea = document.getElementById('quickAccessActions');
    if (actionsArea) {
      actionsArea.innerHTML = '<input type="url" class="quick-access-input" placeholder="https://…" autocomplete="off" spellcheck="false">';
    } else {
      const input = document.createElement('input');
      input.type = 'url'; input.className = 'quick-access-input quick-access-input-bar';
      input.placeholder = 'https://…'; input.autocomplete = 'off'; input.spellcheck = false;
      actionEl.replaceWith(input);
    }
    const input = host.querySelector('.quick-access-input');
    if (input) input.focus();
    return;
  }

  // ---- Close ALL open tabs ----
  if (action === 'close-all-open-tabs') {
    const allUrls = openTabs
      .filter(t => t.url && !t.url.startsWith('chrome') && !t.url.startsWith('about:'))
      .map(t => t.url);
    captureClosedTabs(allUrls);
    await closeTabsByUrls(allUrls);
    playCloseSound();

    document.querySelectorAll('#openTabsMissions .mission-card').forEach(c => {
      shootConfetti(
        c.getBoundingClientRect().left + c.offsetWidth / 2,
        c.getBoundingClientRect().top  + c.offsetHeight / 2
      );
      animateCardOut(c);
    });

    showToast('All tabs closed. Fresh start.', { undo: true });
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

// ---- Quick-access input handlers ----
document.addEventListener('keydown', async (e) => {
  if (!e.target.classList || !e.target.classList.contains('quick-access-input')) return;
  if (e.key === 'Enter') {
    e.preventDefault();
    const raw = e.target.value.trim();
    if (!raw) { await renderQuickAccess(); return; }
    const url = /^https?:\/\//i.test(raw) ? raw : 'https://' + raw;
    try { new URL(url); } catch { showToast('Invalid URL'); return; }
    await addQuickAccess({ url });
    await renderQuickAccess();
    showToast('Shortcut added');
  } else if (e.key === 'Escape') { e.preventDefault(); renderQuickAccess(); }
});

document.addEventListener('blur', (e) => {
  if (!e.target.classList || !e.target.classList.contains('quick-access-input')) return;
  setTimeout(() => { const stillThere = document.querySelector('.quick-access-input'); if (stillThere && stillThere === e.target) renderQuickAccess(); }, 150);
}, true);

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
   THEME — Dark/Light mode toggle with persistence
   ---------------------------------------------------------------- */

const THEME_STORAGE_KEY = 'theme';

const MOON_ICON = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M21.752 15.002A9.72 9.72 0 0 1 18 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 0 0 3 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 0 0 9.002-5.998Z" /></svg>`;

const SUN_ICON = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z" /></svg>`;

function getSystemTheme() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const btn = document.getElementById('themeToggle');
  if (btn) btn.innerHTML = theme === 'dark' ? SUN_ICON : MOON_ICON;
}

async function initTheme() {
  try {
    const { [THEME_STORAGE_KEY]: saved } = await chrome.storage.local.get(THEME_STORAGE_KEY);
    applyTheme(saved || getSystemTheme());
  } catch {
    applyTheme(getSystemTheme());
  }
}

async function toggleTheme() {
  const current = document.documentElement.dataset.theme || 'light';
  const next = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  try { await chrome.storage.local.set({ [THEME_STORAGE_KEY]: next }); } catch {}
}

/**
 * shootConfetti(x, y)
 *
 * Shoots a burst of colorful confetti particles from the given screen
 * coordinates. Colors adapt to the current theme for visibility.
 */
function shootConfetti(x, y) {
  const isDark = document.documentElement.dataset.theme === 'dark';
  const colors = isDark
    ? [
        '#e8955a', // amber bright
        '#f0b880', // amber light bright
        '#7a9a82', // sage bright
        '#a0c0a8', // sage light bright
        '#7a8b9a', // slate bright
        '#a0b0c0', // slate light bright
        '#5a5048', // warm dark
        '#d37a7a', // rose bright
      ]
    : [
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


/* ----------------------------------------------------------------
   PRIVACY MODE — clock + search overlay for screen sharing
   ---------------------------------------------------------------- */

const PRIVACY_DEFAULTS = {
  clock: true,
  date: true,
  motto: true,
  search: true,
  mottoText: '',
};

let privacyClockInterval = null;

async function getPrivacyMode() {
  const { privacyMode = false } = await chrome.storage.local.get('privacyMode');
  return privacyMode;
}

async function getPrivacySettings() {
  const { privacySettings = {} } = await chrome.storage.local.get('privacySettings');
  return { ...PRIVACY_DEFAULTS, ...privacySettings };
}

async function savePrivacySettings(settings) {
  await chrome.storage.local.set({ privacySettings: settings });
}

function setPrivacyMode(enabled) {
  if (enabled) {
    document.body.classList.add('privacy-mode');
  } else {
    document.body.classList.remove('privacy-mode');
  }
  applyPrivacyWidgets();
  if (enabled) {
    startPrivacyClock();
  } else {
    stopPrivacyClock();
  }
}

async function applyPrivacyWidgets() {
  const settings = await getPrivacySettings();
  document.getElementById('privacyTime').style.display = settings.clock ? '' : 'none';
  document.getElementById('privacyDate').style.display = settings.date ? '' : 'none';
  document.getElementById('privacyMotto').style.display = settings.motto ? '' : 'none';
  document.getElementById('privacySearch').style.display = settings.search ? 'flex' : 'none';
  document.getElementById('psClock').checked = settings.clock;
  document.getElementById('psDate').checked = settings.date;
  document.getElementById('psMotto').checked = settings.motto;
  document.getElementById('psSearch').checked = settings.search;
  document.getElementById('psMottoInput').value = settings.mottoText || '';
  document.getElementById('psMottoEdit').style.display = settings.motto ? '' : 'none';
  const mottoEl = document.getElementById('privacyMotto');
  if (mottoEl) mottoEl.textContent = settings.mottoText || '';
}

function updatePrivacyClock() {
  const now = new Date();
  const timeEl = document.getElementById('privacyTime');
  const dateEl = document.getElementById('privacyDate');
  if (timeEl) timeEl.textContent = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  if (dateEl) dateEl.textContent = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

function startPrivacyClock() {
  updatePrivacyClock();
  if (!privacyClockInterval) privacyClockInterval = setInterval(updatePrivacyClock, 1000);
}

function stopPrivacyClock() {
  if (privacyClockInterval) { clearInterval(privacyClockInterval); privacyClockInterval = null; }
}

async function togglePrivacyMode() {
  const current = document.body.classList.contains('privacy-mode');
  await setPrivacyMode(!current);
  await chrome.storage.local.set({ privacyMode: !current });
}

async function initPrivacyMode() {
  const mode = await getPrivacyMode();
  await setPrivacyMode(mode);
}

document.getElementById('privacyToggle')?.addEventListener('click', togglePrivacyMode);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const ae = document.activeElement;
    if (ae && (ae.id === 'privacySearchInput' || ae.id === 'psMottoInput')) return;
    if (document.body.classList.contains('privacy-mode')) togglePrivacyMode();
  }
});

document.getElementById('privacySettingsBtn')?.addEventListener('click', () => {
  const panel = document.getElementById('privacySettings');
  panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
});

document.addEventListener('click', (e) => {
  const panel = document.getElementById('privacySettings');
  const btn = document.getElementById('privacySettingsBtn');
  if (!panel || panel.style.display === 'none') return;
  if (!panel.contains(e.target) && e.target !== btn && !btn.contains(e.target)) {
    panel.style.display = 'none';
  }
});

for (const id of ['psClock', 'psDate', 'psMotto', 'psSearch']) {
  document.getElementById(id)?.addEventListener('change', async () => {
    const settings = await getPrivacySettings();
    settings[id.replace('ps', '').toLowerCase()] = document.getElementById(id).checked;
    await savePrivacySettings(settings);
    applyPrivacyWidgets();
  });
}

const psMottoInput = document.getElementById('psMottoInput');
if (psMottoInput) {
  psMottoInput.addEventListener('blur', async () => {
    const settings = await getPrivacySettings();
    settings.mottoText = psMottoInput.value;
    await savePrivacySettings(settings);
    applyPrivacyWidgets();
  });
  psMottoInput.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') { e.preventDefault(); psMottoInput.blur(); }
  });
}

document.getElementById('privacySearchInput')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    const q = encodeURIComponent(e.target.value.trim());
    if (q) window.location.href = `https://www.google.com/search?q=${q}`;
  }
});

/* ----------------------------------------------------------------
   AUTO-REFRESH — re-render when tabs change
   With manual/auto toggle persisted to chrome.storage.local.
   ---------------------------------------------------------------- */

let _tabRefreshTimer = null;
let _initialRenderDone = false;
let _autoRefreshEnabled = true;

async function initAutoRefresh() {
  const { autoRefresh = true } = await chrome.storage.local.get('autoRefresh');
  _autoRefreshEnabled = autoRefresh;
  updateAutoRefreshUI();
  if (_autoRefreshEnabled) bindTabListeners();
}

function updateAutoRefreshUI() {
  const btn = document.getElementById('autoRefreshToggle');
  if (!btn) return;
  btn.title = _autoRefreshEnabled ? 'Auto-refresh on' : 'Auto-refresh off';
  btn.classList.toggle('auto-refresh-disabled', !_autoRefreshEnabled);
}

async function toggleAutoRefresh() {
  _autoRefreshEnabled = !_autoRefreshEnabled;
  await chrome.storage.local.set({ autoRefresh: _autoRefreshEnabled });
  updateAutoRefreshUI();
  if (_autoRefreshEnabled) { bindTabListeners(); }
  else { unbindTabListeners(); }
}

let _tabListenersBound = false;

function bindTabListeners() {
  if (_tabListenersBound || typeof chrome === 'undefined' || !chrome.tabs) return;
  chrome.tabs.onCreated.addListener(scheduleRefresh);
  chrome.tabs.onRemoved.addListener(scheduleRefresh);
  chrome.tabs.onUpdated.addListener(onTabUpdated);
  chrome.tabs.onActivated.addListener(onTabActivated);
  _tabListenersBound = true;
}

function unbindTabListeners() {
  if (!_tabListenersBound || typeof chrome === 'undefined' || !chrome.tabs) return;
  chrome.tabs.onCreated.removeListener(scheduleRefresh);
  chrome.tabs.onRemoved.removeListener(scheduleRefresh);
  chrome.tabs.onUpdated.removeListener(onTabUpdated);
  chrome.tabs.onActivated.removeListener(onTabActivated);
  _tabListenersBound = false;
}

function onTabUpdated(_tabId, changeInfo) {
  if (changeInfo.status === 'complete' || changeInfo.url) scheduleRefresh();
}

async function onTabActivated(activeInfo) {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (tab.url && tab.url.startsWith(new URL(chrome.runtime.getURL('index.html')).origin)) {
      scheduleRefresh();
    }
  } catch { /* tab may have been closed */ }
}

function scheduleRefresh() {
  if (_tabRefreshTimer) clearTimeout(_tabRefreshTimer);
  _tabRefreshTimer = setTimeout(() => {
    if (_initialRenderDone) document.body.classList.add('no-entrance-anim');
    renderDashboard();
  }, 300);
}

// Manual refresh handler — always works regardless of auto-refresh state
document.addEventListener('click', async (e) => {
  const actionEl = e.target.closest('[data-action]');

  // ---- Refresh dashboard manually ----
  if (actionEl && actionEl.dataset.action === 'refresh') {
    const btn = document.getElementById('refreshBtn');
    if (btn) btn.classList.add('spinning');
    await renderDashboard();
    if (btn) btn.classList.remove('spinning');
    showToast('Refreshed');
    return;
  }

  // ---- Toggle auto-refresh ----
  if (actionEl && actionEl.dataset.action === 'toggle-auto-refresh') {
    await toggleAutoRefresh();
    showToast(_autoRefreshEnabled ? 'Auto-refresh on' : 'Auto-refresh off');
    return;
  }
});

/* ----------------------------------------------------------------
   BING DAILY BACKGROUND
   ---------------------------------------------------------------- */

async function fetchBingBackground() {
  const today = new Date().toISOString().slice(0, 10);
  const stored = await chrome.storage.local.get('bingBackground');
  const cached = stored.bingBackground;
  if (cached && cached.date === today) return cached;
  try {
    const res = await fetch('https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=1&mkt=zh-CN');
    const data = await res.json();
    const img = data.images[0];
    const result = { date: today, url: 'https://www.bing.com' + img.url, copyright: img.copyright || '' };
    await chrome.storage.local.set({ bingBackground: result });
    return result;
  } catch { return cached || null; }
}

async function applyBingBackground() {
  const bg = await fetchBingBackground();
  if (!bg) return;
  document.body.style.backgroundImage = 'url(\'' + bg.url + '\')';
  document.body.classList.add('has-bing-bg');
  const creditEl = document.getElementById('bingCredit');
  if (creditEl && bg.copyright) creditEl.textContent = '© ' + bg.copyright;
}

applyBingBackground();

/* ----------------------------------------------------------------
   INITIALIZE
   ---------------------------------------------------------------- */

document.addEventListener('error', (e) => {
  if (e.target instanceof HTMLImageElement && e.target.classList.contains('chip-favicon--hide-on-error')) {
    e.target.style.display = 'none';
  }
}, true);

initPrivacyMode().then(() => initTheme()).then(() => initAutoRefresh()).then(() => renderDashboard()).then(() => {
  _initialRenderDone = true;
});
