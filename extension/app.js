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

// Bookmarked URLs cache — loaded once, refreshed on bookmark changes
let bookmarkUrlSet = new Set();

async function loadBookmarks(forceRefresh = false) {
  if (!forceRefresh) {
    const { bookmarkUrlCache } = await chrome.storage.local.get('bookmarkUrlCache');
    if (bookmarkUrlCache) { bookmarkUrlSet = new Set(bookmarkUrlCache); return; }
  }
  const tree = await chrome.bookmarks.getTree();
  const urls = [];
  (function walk(nodes) {
    for (const n of nodes) {
      if (n.url) urls.push(n.url);
      if (n.children) walk(n.children);
    }
  })(tree);
  bookmarkUrlSet = new Set(urls);
  await chrome.storage.local.set({ bookmarkUrlCache: urls });
}

chrome.bookmarks.onCreated.addListener(() => loadBookmarks(true));
chrome.bookmarks.onRemoved.addListener(() => loadBookmarks(true));
chrome.bookmarks.onChanged.addListener(() => loadBookmarks(true));

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

async function fetchOpenTabs() {
  try {
    const extensionId = chrome.runtime.id;
    const newtabUrl = `chrome-extension://${extensionId}/index.html`;

    const tabs = await chrome.tabs.query({});
    openTabs = tabs.map(t => {
      const suspendedOriginal = extractSuspendedUrl(t.url);
      return {
        id:        t.id,
        url:       suspendedOriginal || t.url,
        title:     t.title,
        windowId:  t.windowId,
        active:    t.active,
        suspended: !!suspendedOriginal,
        isTabOut:  t.url === newtabUrl || t.url === 'chrome://newtab/',
      };
    });
  } catch {
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
      const tabUrl = extractSuspendedUrl(tab.url) || tab.url || '';
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
  const toClose = allTabs.filter(t => urlSet.has(t.url) || urlSet.has(extractSuspendedUrl(t.url))).map(t => t.id);
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

  // Try exact URL match (including suspended tab original URL)
  let matches = allTabs.filter(t => t.url === url || extractSuspendedUrl(t.url) === url);

  // Fall back to hostname match
  if (matches.length === 0) {
    try {
      const targetHost = new URL(url).hostname;
      matches = allTabs.filter(t => {
        const effective = extractSuspendedUrl(t.url) || t.url;
        try { return new URL(effective).hostname === targetHost; }
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
    const matching = allTabs.filter(t => t.url === url || extractSuspendedUrl(t.url) === url);
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

function showConfirm(message) {
  return new Promise(resolve => {
    const overlay = document.getElementById('confirmOverlay');
    document.getElementById('confirmMsg').textContent = message;
    overlay.classList.add('visible');
    const cleanup = (result) => {
      overlay.classList.remove('visible');
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      resolve(result);
    };
    const onOk = () => cleanup(true);
    const onCancel = () => cleanup(false);
    const okBtn = document.getElementById('confirmOk');
    const cancelBtn = document.getElementById('confirmCancel');
    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
  });
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
   AI SUGGESTION BANNERS
   ---------------------------------------------------------------- */

let pendingSuggestions = [];

/**
 * renderSuggestionBanners(suggestions)
 *
 * Takes an array of AI grouping suggestions and renders one banner at a time.
 * Each suggestion: { groupLabel, tabIndices, reasoning }
 */
function renderSuggestionBanners(suggestions) {
  pendingSuggestions = suggestions || [];
  renderNextSuggestionBanner();
}

function renderNextSuggestionBanner() {
  const container = document.getElementById('openTabsMissions');
  if (!container) return;

  // Remove any existing banner
  const existing = container.querySelector('.ai-suggestion-banner');
  if (existing) existing.remove();

  if (pendingSuggestions.length === 0) return;

  const suggestion = pendingSuggestions[0];
  const tabCount = suggestion.tabIndices ? suggestion.tabIndices.length : 0;

  function esc(s) { return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  const bannerHtml = `<div class="ai-suggestion-banner" data-suggestion-index="0">
  <span class="suggestion-icon">✨</span>
  <div class="suggestion-content">
    <div class="suggestion-label">合并为一组？[${esc(suggestion.groupLabel)}] — ${tabCount} 个标签</div>
    <div class="suggestion-meta">${esc(suggestion.reasoning)}</div>
  </div>
  <div class="suggestion-actions">
    <button class="btn-accept" data-action="accept-suggestion">接受</button>
    <button class="btn-dismiss" data-action="dismiss-suggestion">忽略</button>
  </div>
</div>`;

  const firstCard = container.querySelector('.mission-card');
  if (firstCard) {
    firstCard.insertAdjacentHTML('beforebegin', bannerHtml);
  } else {
    container.insertAdjacentHTML('afterbegin', bannerHtml);
  }
}


/* ----------------------------------------------------------------
   AI CLOSE SUGGESTION BANNERS
   ---------------------------------------------------------------- */

let pendingCloseSuggestions = [];

function renderCloseSuggestions(suggestions) {
  pendingCloseSuggestions = suggestions || [];
  renderNextCloseBanner();
}

function renderNextCloseBanner() {
  const container = document.getElementById('openTabsMissions');
  if (!container) return;

  const existing = container.querySelector('.ai-close-banner');
  if (existing) existing.remove();

  if (pendingCloseSuggestions.length === 0) return;
  if (pendingSuggestions.length > 0) return;

  const suggestion = pendingCloseSuggestions[0];
  const tabCount = suggestion.tabIndices ? suggestion.tabIndices.length : 0;

  function esc(s) { return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  const bannerHtml = `<div class="ai-close-banner">
  <span class="suggestion-icon">🧹</span>
  <div class="suggestion-content">
    <div class="suggestion-label">可以关掉？— ${tabCount} 个标签</div>
    <div class="suggestion-meta">${esc(suggestion.reasoning)}</div>
  </div>
  <div class="suggestion-actions">
    <button class="btn-close-accept" data-action="accept-close-suggestion">关闭</button>
    <button class="btn-dismiss" data-action="dismiss-close-suggestion">保留</button>
  </div>
</div>`;

  const firstCard = container.querySelector('.mission-card');
  if (firstCard) {
    firstCard.insertAdjacentHTML('beforebegin', bannerHtml);
  } else {
    container.insertAdjacentHTML('afterbegin', bannerHtml);
  }
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
    return `<div class="page-chip clickable${chipClass}" data-action="focus-tab" data-tab-url="${safeUrl}" title="${safeTitle}">
      ${faviconUrl ? `<img class="chip-favicon" src="${faviconUrl}" alt="" onerror="this.style.display='none'">` : ''}
      ${bookmarkUrlSet.has(tab.url) ? '<span class="chip-bookmark">⭐</span>' : ''}<span class="chip-text">${label}</span>${dupeTag}
      <div class="chip-actions">
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
    let domain = '';
    try { domain = new URL(tab.url).hostname; } catch {}
    const faviconUrl = domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=16` : '';
    return `<div class="page-chip clickable${chipClass}" data-action="focus-tab" data-tab-url="${safeUrl}" title="${safeTitle}">
      ${faviconUrl ? `<img class="chip-favicon" src="${faviconUrl}" alt="" onerror="this.style.display='none'">` : ''}
      ${bookmarkUrlSet.has(tab.url) ? '<span class="chip-bookmark">⭐</span>' : ''}<span class="chip-text">${label}</span>${dupeTag}
      <div class="chip-actions">
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

    // Hide the entire column if there's nothing to show
    if (active.length === 0 && archived.length === 0) {
      column.style.display = 'none';
      return;
    }

    column.style.display = 'block';

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
  await loadBookmarks();
  const realTabs = getRealTabs();

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

  // AI-learned group rules from chrome.storage.local
  let learnedGroups = [];
  try {
    const stored = await new Promise(resolve =>
      chrome.storage.local.get('ai_learned_groups', r => resolve(r.ai_learned_groups))
    );
    learnedGroups = stored || [];
  } catch { /* ignore */ }

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

  function matchLearnedGroup(url) {
    try {
      const parsed = new URL(url);
      return learnedGroups.find(r =>
        r.rule && r.rule.hostnames && r.rule.hostnames.includes(parsed.hostname)
      ) || null;
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

      // Check AI-learned group rules (lower priority than custom groups)
      const learnedRule = matchLearnedGroup(tab.url);
      if (learnedRule) {
        const key = learnedRule.groupKey;
        if (!groupMap[key]) groupMap[key] = { domain: key, label: learnedRule.groupLabel, tabs: [] };
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
    openTabsSectionCount.innerHTML = `${domainGroups.length} domain${domainGroups.length !== 1 ? 's' : ''} &nbsp;&middot;&nbsp; <button class="action-btn close-tabs" data-action="close-all-open-tabs" style="font-size:11px;padding:3px 10px;">${ICONS.close} Close all ${realTabs.length} tabs</button> <button class="action-btn ai-trigger-btn" data-action="trigger-ai" style="font-size:11px;padding:3px 10px;" title="AI 分组建议">✨</button>`;
    openTabsMissionsEl.innerHTML = domainGroups.map(g => renderDomainCard(g)).join('');
    openTabsSection.style.display = 'block';

    // Render AI search input if not already present
    if (!document.getElementById('aiSearchInput')) {
      const searchHtml = `<div class="ai-search-container">
        <input type="text" id="aiSearchInput" class="ai-search-input" placeholder="描述你要找的标签...">
        <span id="aiSearchStatus" class="ai-search-status"></span>
      </div>`;
      openTabsMissionsEl.insertAdjacentHTML('beforebegin', searchHtml);
    }
  } else if (openTabsSection) {
    openTabsSection.style.display = 'none';
  }

  // --- Footer stats ---
  const statTabs = document.getElementById('statTabs');
  if (statTabs) statTabs.textContent = openTabs.length;

  // --- Check for duplicate Tab Out tabs ---
  checkTabOutDupes();

  // --- Render "Saved for Later" column ---
  await renderDeferredColumn();
}

async function renderFrequentSites() {
  const { frequentSites, frequentBlacklist = [] } = await chrome.storage.local.get(['frequentSites', 'frequentBlacklist']);
  const container = document.getElementById('frequentSitesSection');
  if (!container) return;
  if (!frequentSites || frequentSites.length === 0) {
    container.style.display = 'none';
    return;
  }
  const blacklistSet = new Set(frequentBlacklist);
  const visible = frequentSites.filter(s => !blacklistSet.has(s.hostname));
  if (visible.length === 0) {
    container.style.display = 'none';
    return;
  }
  container.style.display = 'block';
  const listEl = document.getElementById('frequentSitesList');
  listEl.innerHTML = visible.map(s => {
    const favicon = `https://www.google.com/s2/favicons?domain=${s.hostname}&sz=32`;
    const label = s.title.length > 24 ? s.title.slice(0, 22) + '…' : s.title;
    return `<a class="freq-chip" href="${s.url}" data-freq-url="${s.url}" data-freq-host="${s.hostname}" title="${s.title}">
      <img class="freq-favicon" src="${favicon}" width="16" height="16" alt="">
      <span class="freq-label">${label}</span>
      <button class="freq-dismiss" data-action="dismiss-freq" title="不再显示">×</button>
    </a>`;
  }).join('');
}

document.addEventListener('click', async e => {
  if (e.target.closest('[data-action="dismiss-freq"]')) {
    e.preventDefault();
    e.stopPropagation();
    const chip = e.target.closest('.freq-chip');
    if (!chip) return;
    const host = chip.dataset.freqHost;
    if (!host) return;
    const { frequentBlacklist = [] } = await chrome.storage.local.get('frequentBlacklist');
    if (!frequentBlacklist.includes(host)) {
      frequentBlacklist.push(host);
      await chrome.storage.local.set({ frequentBlacklist });
    }
    chip.style.transition = 'opacity 0.2s, transform 0.2s';
    chip.style.opacity = '0';
    chip.style.transform = 'scale(0.9)';
    setTimeout(() => { chip.remove(); renderFrequentSites(); }, 200);
    if (typeof showToast === 'function') showToast(`已屏蔽 ${host}`);
    return;
  }
  const chip = e.target.closest('.freq-chip');
  if (!chip) return;
  e.preventDefault();
  const url = chip.dataset.freqUrl;
  focusOrOpen(url);
});

async function focusOrOpen(url) {
  const allTabs = await chrome.tabs.query({});
  let hostname;
  try { hostname = new URL(url).hostname; } catch { return; }
  const match = allTabs.find(t => {
    try { return new URL(t.url).hostname === hostname; } catch { return false; }
  });
  if (match) {
    await chrome.tabs.update(match.id, { active: true });
    await chrome.windows.update(match.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url });
  }
}

async function renderDashboard() {
  await renderStaticDashboard();
  await renderFrequentSites();
  if (!skipNextAiCall) triggerAiSuggestions();
  skipNextAiCall = false;
}

let skipNextAiCall = false;
let aiAbortController = null;

async function enrichTabsWithMeta(realTabs, tabData) {
  if (!chrome.scripting?.executeScript) return tabData;
  const results = await Promise.allSettled(
    realTabs.map(t => {
      if (!t.id || t.url.startsWith('file://')) return Promise.resolve(null);
      return chrome.scripting.executeScript({
        target: { tabId: t.id },
        func: () => document.querySelector('meta[name="description"]')?.content || '',
      }).then(r => r?.[0]?.result || '').catch(() => '');
    })
  );
  return tabData.map((td, i) => {
    const desc = results[i]?.status === 'fulfilled' ? results[i].value : '';
    return desc ? { ...td, description: desc.slice(0, 150) } : td;
  });
}

async function triggerAiSuggestions() {
  try {
    if (aiAbortController) {
      aiAbortController.abort();
      aiAbortController = null;
      await new Promise(r => setTimeout(r, 50));
    }
    aiAbortController = new AbortController();

    const settings = await new Promise(resolve =>
      chrome.storage.local.get('ai_settings', r => resolve(r.ai_settings))
    );
    if (!settings || !settings.baseUrl || !settings.apiKey || !settings.model) return;

    const realTabs = openTabs.filter(t => !t.isTabOut && t.url && !t.url.startsWith('chrome'));
    if (realTabs.length < 3) return;

    const { ai_learned_groups: learnedGroups = [] } = await chrome.storage.local.get('ai_learned_groups');
    let tabData = realTabs.map(t => ({ title: t.title, url: t.url }));
    if (settings.metaDesc) {
      tabData = await enrichTabsWithMeta(realTabs, tabData);
    }
    const { suggestions, renames, closeSuggestions } = await fetchGroupingSuggestions(tabData, settings, aiAbortController.signal, learnedGroups);

    const filteredSuggestions = suggestions.filter(s => {
      if (!s.tabIndices || s.tabIndices.length < 2) return false;
      const groups = new Set(s.tabIndices.map(idx => {
        const tab = realTabs[idx - 1];
        if (!tab) return null;
        return domainGroups.findIndex(g => g.tabs.some(gt => gt.url === tab.url));
      }));
      return groups.size > 1 || groups.has(-1);
    });

    if (filteredSuggestions.length > 0) renderSuggestionBanners(filteredSuggestions);
    if (renames && renames.length > 0) applyAiRenames(renames);
    if (closeSuggestions && closeSuggestions.length > 0) renderCloseSuggestions(closeSuggestions);
    if (settings.debug) renderDebugPanel();
  } catch (e) {
    console.debug('AI suggestions skipped:', e.message);
  }
}

function applyAiRenames(renames) {
  for (const r of renames) {
    const cards = document.querySelectorAll('.mission-card');
    for (const card of cards) {
      const nameEl = card.querySelector('.mission-name');
      if (nameEl && nameEl.textContent.trim().toLowerCase() === r.original_domain.toLowerCase()) {
        nameEl.title = nameEl.textContent;
        nameEl.textContent = r.suggested_name + ' ✨';
      }
    }
  }
}

function renderDebugPanel() {
  let panel = document.getElementById('aiDebugPanel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'aiDebugPanel';
    panel.className = 'ai-debug-panel';
    document.body.appendChild(panel);
  }

  const entries = window.__aiDebug || [];
  const triggerBtns = '<span class="debug-triggers">' +
    '<button data-action="debug-trigger-ai" data-ai-only="grouping">Grouping</button>' +
    '<button data-action="debug-trigger-ai" data-ai-only="rename">Rename</button>' +
    '<button data-action="debug-trigger-ai" data-ai-only="close">Close</button></span>';

  if (entries.length === 0) {
    panel.innerHTML = '<div class="debug-header">AI Debug ' + triggerBtns + '<button id="debugClose" class="debug-close">✕</button></div><div class="debug-empty">No AI calls yet</div>';
  } else {
    panel.innerHTML = '<div class="debug-header">AI Debug (' + entries.length + ' calls) ' + triggerBtns + '<button id="debugClose" class="debug-close">✕</button></div>' +
      entries.map((e, i) => `<details class="debug-entry">
        <summary>[${e.type}] ${e.duration}ms — ${new Date(e.timestamp).toLocaleTimeString()}${e.query ? ' — "' + e.query + '"' : ''}</summary>
        <div class="debug-section"><strong>Prompt:</strong><pre>${JSON.stringify(e.prompt, null, 2).replace(/</g, '&lt;')}</pre></div>
        <div class="debug-section"><strong>Response:</strong><pre>${(typeof e.response === 'string' ? e.response : JSON.stringify(e.response, null, 2)).replace(/</g, '&lt;')}</pre></div>
        <div class="debug-section"><strong>Parsed:</strong><pre>${JSON.stringify(e.parsed, null, 2)}</pre></div>
      </details>`).join('');
  }
  panel.style.display = 'block';
  panel.querySelector('#debugClose')?.addEventListener('click', () => { panel.style.display = 'none'; });
}

async function triggerAiOnly(mode) {
  try {
    if (aiAbortController) {
      aiAbortController.abort();
      aiAbortController = null;
      await new Promise(r => setTimeout(r, 50));
    }
    aiAbortController = new AbortController();

    const settings = await new Promise(resolve =>
      chrome.storage.local.get('ai_settings', r => resolve(r.ai_settings))
    );
    if (!settings || !settings.baseUrl || !settings.apiKey || !settings.model) return;

    const realTabs = openTabs.filter(t => !t.isTabOut && t.url && !t.url.startsWith('chrome'));
    if (realTabs.length < 3) return;

    let tabData = realTabs.map(t => ({ title: t.title, url: t.url }));
    if (settings.metaDesc) {
      tabData = await enrichTabsWithMeta(realTabs, tabData);
    }
    const { suggestions, renames, closeSuggestions } = await fetchGroupingSuggestions(tabData, settings, aiAbortController.signal);

    if (mode === 'grouping' && suggestions && suggestions.length > 0) {
      const filtered = suggestions.filter(s => {
        if (!s.tabIndices || s.tabIndices.length < 2) return false;
        const groups = new Set(s.tabIndices.map(idx => {
          const tab = realTabs[idx - 1];
          if (!tab) return null;
          return domainGroups.findIndex(g => g.tabs.some(gt => gt.url === tab.url));
        }));
        return groups.size > 1 || groups.has(-1);
      });
      if (filtered.length > 0) renderSuggestionBanners(filtered);
    }
    if (mode === 'rename' && renames && renames.length > 0) applyAiRenames(renames);
    if (mode === 'close' && closeSuggestions && closeSuggestions.length > 0) renderCloseSuggestions(closeSuggestions);

    renderDebugPanel();
  } catch (e) {
    console.debug('AI trigger (' + mode + ') failed:', e.message);
  }
}

let searchAbortController = null;

async function searchTabsWithAi(query) {
  if (!query || query.trim().length < 2) { clearSearchHighlights(); clearHistoryResults(); return; }

  const settings = await new Promise(resolve =>
    chrome.storage.local.get('ai_settings', r => resolve(r.ai_settings))
  );
  if (!settings || !settings.baseUrl || !settings.apiKey) return;

  if (searchAbortController) searchAbortController.abort();
  searchAbortController = new AbortController();

  const realTabs = openTabs.filter(t => !t.isTabOut && t.url && !t.url.startsWith('chrome'));
  const tabData = realTabs.map(t => ({ title: t.title, url: t.url }));

  const searchArea = document.getElementById('aiSearchStatus');
  if (searchArea) searchArea.textContent = '搜索中...';

  const openUrls = new Set(realTabs.map(t => t.url));
  let historyData = [];
  try {
    const historyRaw = await chrome.history.search({ text: query, maxResults: 30 });
    const historyDeduped = (historyRaw || []).filter(h => {
      if (!h.url) return false;
      if (h.url.startsWith('chrome-extension://') || h.url.startsWith('chrome://')) return false;
      return !openUrls.has(h.url);
    });
    historyData = historyDeduped.slice(0, 20).map(h => ({ title: h.title || h.url, url: h.url }));
  } catch (e) {
    console.warn('[Tab Out] chrome.history.search failed:', e);
  }

  const { openMatches, historyMatches } = await fetchTabSearch(query, tabData, historyData, settings, searchAbortController.signal);
  if (searchArea) searchArea.textContent = '';

  if (openMatches.length === 0 && historyMatches.length === 0) {
    if (searchArea) searchArea.textContent = '未找到匹配';
    setTimeout(() => { if (searchArea) searchArea.textContent = ''; }, 2000);
    clearHistoryResults();
    return;
  }

  highlightMatchedTabs(openMatches, realTabs);
  renderHistoryResults(historyMatches, historyData);
  if (settings && settings.debug) renderDebugPanel();
}

function highlightMatchedTabs(indices, realTabs) {
  clearSearchHighlights();
  const matchedUrls = new Set(indices.map(i => realTabs[i - 1]?.url).filter(Boolean));

  document.querySelectorAll('.page-chip[data-tab-url]').forEach(row => {
    if (matchedUrls.has(row.dataset.tabUrl)) {
      row.classList.add('tab-highlighted');
    } else {
      row.classList.add('tab-dimmed');
    }
  });
}

function clearSearchHighlights() {
  document.querySelectorAll('.tab-highlighted').forEach(el => el.classList.remove('tab-highlighted'));
  document.querySelectorAll('.tab-dimmed').forEach(el => el.classList.remove('tab-dimmed'));
}

function renderHistoryResults(indices, historyData) {
  clearHistoryResults();
  if (!indices || indices.length === 0) return;

  const items = indices
    .map(i => historyData[i - 1])
    .filter(Boolean)
    .map(h => {
      const hostname = new URL(h.url).hostname.replace('www.', '');
      return `<div class="history-result-item" data-url="${h.url.replace(/"/g, '&quot;')}">
        <img class="chip-favicon" src="https://www.google.com/s2/favicons?domain=${hostname}&sz=32" alt="">
        <span class="history-result-title">${h.title || hostname}</span>
        <span class="history-result-host">${hostname}</span>
      </div>`;
    }).join('');

  const html = `<div class="history-results-section" id="historyResultsSection">
    <div class="section-header"><h2>History</h2><div class="section-line"></div></div>
    ${items}
  </div>`;

  const topRow = document.getElementById('topRow');
  if (topRow) {
    topRow.insertAdjacentHTML('beforeend', html);
  }

  document.getElementById('historyResultsSection').addEventListener('click', (e) => {
    const item = e.target.closest('.history-result-item');
    if (item) chrome.tabs.create({ url: item.dataset.url });
  });
}

function clearHistoryResults() {
  const el = document.getElementById('historyResultsSection');
  if (el) el.remove();
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

  // ---- Trigger AI suggestions manually ----
  if (action === 'trigger-ai') {
    triggerAiSuggestions();
    return;
  }

  // ---- Debug: trigger single AI capability ----
  if (action === 'debug-trigger-ai') {
    triggerAiOnly(actionEl.dataset.aiOnly);
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

    // Close the tab in Chrome directly
    const allTabs = await chrome.tabs.query({});
    const match = allTabs.find(t => t.url === tabUrl || extractSuspendedUrl(t.url) === tabUrl);
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

  // ---- Accept AI suggestion ----
  if (action === 'accept-suggestion') {
    const banner = actionEl.closest('.ai-suggestion-banner');
    if (banner && pendingSuggestions.length > 0) {
      const suggestion = pendingSuggestions[0];
      const realTabs = openTabs.filter(t => !t.isTabOut && t.url && !t.url.startsWith('chrome'));
      const hostnames = [...new Set(
        suggestion.tabIndices
          .map(i => realTabs[i - 1])
          .filter(Boolean)
          .map(t => { try { return new URL(t.url).hostname; } catch { return null; } })
          .filter(Boolean)
      )];

      const rule = {
        groupKey: 'ai_' + suggestion.groupLabel.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
        groupLabel: suggestion.groupLabel,
        rule: { hostnames },
        createdAt: Date.now()
      };

      const { ai_learned_groups: groups = [] } = await chrome.storage.local.get('ai_learned_groups');
      groups.push(rule);
      await chrome.storage.local.set({ ai_learned_groups: groups });

      banner.classList.add('hiding');
      setTimeout(() => {
        banner.remove();
        pendingSuggestions.shift();
        renderNextSuggestionBanner();
        if (pendingSuggestions.length === 0) renderNextCloseBanner();
        skipNextAiCall = true;
        renderDashboard();
      }, 300);
      showToast(`已添加分组规则：${suggestion.groupLabel}`);
    }
    return;
  }

  // ---- Dismiss AI suggestion ----
  if (action === 'dismiss-suggestion') {
    const banner = actionEl.closest('.ai-suggestion-banner');
    if (banner) {
      banner.classList.add('hiding');
      setTimeout(() => {
        banner.remove();
        pendingSuggestions.shift();
        renderNextSuggestionBanner();
        if (pendingSuggestions.length === 0) renderNextCloseBanner();
      }, 300);
    }
    return;
  }

  // ---- Accept close suggestion ----
  if (action === 'accept-close-suggestion') {
    const banner = actionEl.closest('.ai-close-banner');
    if (banner && pendingCloseSuggestions.length > 0) {
      const suggestion = pendingCloseSuggestions[0];
      const realTabs = openTabs.filter(t => !t.isTabOut && t.url && !t.url.startsWith('chrome'));
      const urlsToClose = suggestion.tabIndices
        .map(i => realTabs[i - 1])
        .filter(Boolean)
        .map(t => t.url);

      await closeTabsExact(urlsToClose);
      playCloseSound();

      banner.classList.add('hiding');
      setTimeout(() => {
        banner.remove();
        pendingCloseSuggestions.shift();
        renderNextCloseBanner();
        skipNextAiCall = true;
        renderDashboard();
      }, 300);
      showToast(`已关闭 ${urlsToClose.length} 个标签`);
    }
    return;
  }

  // ---- Dismiss close suggestion ----
  if (action === 'dismiss-close-suggestion') {
    const banner = actionEl.closest('.ai-close-banner');
    if (banner) {
      banner.classList.add('hiding');
      setTimeout(() => {
        banner.remove();
        pendingCloseSuggestions.shift();
        renderNextCloseBanner();
      }, 300);
    }
    return;
  }

  // ---- Close ALL open tabs ----
  if (action === 'close-all-open-tabs') {
    const allUrls = openTabs
      .filter(t => t.url && !t.url.startsWith('chrome') && !t.url.startsWith('about:'))
      .map(t => t.url);
    const count = allUrls.length;
    const confirmed = await showConfirm(`This will close all ${count} tab${count !== 1 ? 's' : ''}. Are you sure?`);
    if (!confirmed) return;
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
   INITIALIZE
   ---------------------------------------------------------------- */
document.addEventListener('input', (e) => {
  if (e.target.id !== 'aiSearchInput') return;
  clearTimeout(e.target._debounce);
  e.target._debounce = setTimeout(() => searchTabsWithAi(e.target.value), 500);
});

document.addEventListener('keydown', (e) => {
  if (e.target.id !== 'aiSearchInput') return;
  if (e.key === 'Enter') { clearTimeout(e.target._debounce); searchTabsWithAi(e.target.value); }
  if (e.key === 'Escape') { e.target.value = ''; clearSearchHighlights(); clearHistoryResults(); }
});

renderDashboard();
