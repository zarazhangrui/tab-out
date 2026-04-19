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
      id:           t.id,
      url:          t.url,
      title:        t.title,
      favIconUrl:   t.favIconUrl || '',
      windowId:     t.windowId,
      active:       t.active,
      lastAccessed: t.lastAccessed || 0,
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
  // Only persist http(s) favicons to avoid bloating storage with data: URIs
  const favIconUrl = (tab.favIconUrl && /^https?:\/\//.test(tab.favIconUrl))
    ? tab.favIconUrl : '';
  deferred.push({
    id:         Date.now().toString(),
    url:        tab.url,
    title:      tab.title,
    favIconUrl,
    savedAt:    new Date().toISOString(),
    completed:  false,
    dismissed:  false,
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
      <div class="empty-title">${t('inbox_zero_title')}</div>
      <div class="empty-subtitle">${t('inbox_zero_subtitle')}</div>
    </div>
  `;

  const countEl = document.getElementById('openTabsSectionCount');
  if (countEl) countEl.textContent = t('domains_count', 0);
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

  if (diffMins < 1)   return t('just_now');
  if (diffMins < 60)  return t('min_ago', diffMins);
  if (diffHours < 24) return t('hr_ago', diffHours);
  if (diffDays === 1) return t('yesterday');
  return t('days_ago', diffDays);
}

/**
 * getGroupStatus(tabs)
 *
 * Returns the staleness status of a group based on the most recently
 * accessed tab's lastAccessed timestamp.
 *
 *   active    — accessed within the last 30 minutes  (green)
 *   cooling   — 30 minutes to 4 hours ago            (amber)
 *   abandoned — more than 4 hours ago                (red)
 *   neutral   — no lastAccessed data available
 */
function getGroupStatus(tabs) {
  const mostRecent = Math.max(...tabs.map(t => t.lastAccessed || 0));
  if (!mostRecent) return 'neutral';
  const ageMinutes = (Date.now() - mostRecent) / 60000;
  if (ageMinutes < 30)  return 'active';
  if (ageMinutes < 240) return 'cooling';
  return 'abandoned';
}

/**
 * lastActiveAgo(tabs)
 *
 * Returns a short human-readable string for the most recent access time
 * among all tabs in a group. e.g. "3 min ago", "2 hrs ago".
 */
function lastActiveAgo(tabs) {
  const mostRecent = Math.max(...tabs.map(t => t.lastAccessed || 0));
  if (!mostRecent) return '';
  return timeAgo(new Date(mostRecent).toISOString());
}


function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return t('greeting_morning');
  if (hour < 17) return t('greeting_afternoon');
  return t('greeting_evening');
}

/**
 * getDateDisplay() — "Friday, April 4, 2026"
 */
function getDateDisplay() {
  return new Date().toLocaleDateString(LOCALE, {
    weekday: 'long',
    year:    'numeric',
    month:   'long',
    day:     'numeric',
  });
}


/**
 * fuzzyMatch(query, target)
 *
 * Returns true if every character in `query` appears in `target` in order
 * (case-insensitive). Classic fuzzy-find behaviour.
 * e.g. fuzzyMatch("ghb", "github.com") → true
 */
function fuzzyMatch(query, target) {
  if (!query) return true;
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  let qi = 0;
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) qi++;
  }
  return qi === q.length;
}

/**
 * filterTabsBySearch(query)
 *
 * Filters the visible domain cards and tab chips in real-time.
 * When query is non-empty:
 *   - Expands all overflow containers so hidden chips are also searchable
 *   - Hides chips that don't match title or URL
 *   - Hides entire cards where no chips match (unless the domain name itself matches)
 * When query is empty:
 *   - Re-renders the full dashboard to restore original state
 */
async function filterTabsBySearch(query) {
  if (!query) {
    // Clear: re-render to restore original overflow state
    await renderStaticDashboard();
    return;
  }

  const cards = document.querySelectorAll('#openTabsMissions .mission-card');
  let anyVisible = false;

  cards.forEach(card => {
    // Expand overflow so we can search inside it
    const overflowContainer = card.querySelector('.page-chips-overflow');
    const overflowBtn       = card.querySelector('.page-chip-overflow');
    if (overflowContainer) overflowContainer.style.display = 'contents';
    if (overflowBtn)       overflowBtn.style.display = 'none';

    // Filter individual chips
    const chips = card.querySelectorAll('.page-chip[data-action="focus-tab"]');
    let chipsVisible = 0;
    chips.forEach(chip => {
      const title = chip.querySelector('.chip-text')?.textContent || '';
      const url   = chip.dataset.tabUrl || '';
      const match = fuzzyMatch(query, title) || fuzzyMatch(query, url);
      chip.style.display = match ? '' : 'none';
      if (match) chipsVisible++;
    });

    // Also match against the domain/group name so e.g. "github" shows all GitHub tabs
    const domainName = card.querySelector('.mission-name')?.textContent || '';
    const domainMatch = fuzzyMatch(query, domainName);

    if (chipsVisible > 0 || domainMatch) {
      card.style.display = '';
      if (domainMatch) {
        // Domain matched — show all chips for this card
        chips.forEach(chip => chip.style.display = '');
      }
      anyVisible = true;
    } else {
      card.style.display = 'none';
    }
  });

  // Show "no results" if everything is hidden
  const missionsEl = document.getElementById('openTabsMissions');
  const existing = missionsEl?.querySelector('.search-empty-state');
  if (!anyVisible) {
    if (!existing && missionsEl) {
      missionsEl.insertAdjacentHTML('beforeend', `
        <div class="search-empty-state">
          <div class="empty-title" style="font-size:16px">${t('no_tabs_match', query)}</div>
        </div>`);
    }
  } else if (existing) {
    existing.remove();
  }
}



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
    if (username) return titleIsUrl ? t('post_by', username) : title;
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
    if (titleIsUrl) return t('youtube_video');
  }

  if ((hostname === 'www.reddit.com' || hostname === 'reddit.com' || hostname === 'old.reddit.com') && pathname.includes('/comments/')) {
    const parts  = pathname.split('/').filter(Boolean);
    const subIdx = parts.indexOf('r');
    if (subIdx !== -1 && parts[subIdx + 1]) {
      if (titleIsUrl) return t('reddit_post', parts[subIdx + 1]);
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
  const banner         = document.getElementById('tabOutDupeBanner');
  const bannerText     = document.getElementById('tabOutDupeBannerText');
  const closeExtrasBtn = document.getElementById('closeExtrasBtn');
  if (!banner) return;

  if (tabOutTabs.length > 1) {
    if (bannerText) bannerText.innerHTML = t('dupe_banner', tabOutTabs.length);
    if (closeExtrasBtn) closeExtrasBtn.textContent = t('close_extras');
    banner.style.display = 'flex';
  } else {
    banner.style.display = 'none';
  }
}


/* ----------------------------------------------------------------
   OVERFLOW CHIPS ("+N more" expand button in domain cards)
   ---------------------------------------------------------------- */

/**
 * getTabFavicon(tab)
 *
 * Returns the best available favicon URL for a tab.
 * Prefers Chrome's own cached favIconUrl (most accurate), falls back
 * to Google's Favicon API for sites Chrome hasn't cached yet.
 * Ignores non-http(s) favIconUrls (e.g. chrome://, data:) to avoid leaking
 * internal Chrome URLs into img src attributes.
 */
function getTabFavicon(tab) {
  if (tab.favIconUrl && /^https?:\/\//.test(tab.favIconUrl)) {
    return tab.favIconUrl;
  }
  let domain = '';
  try { domain = new URL(tab.url || '').hostname; } catch {}
  return domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=16` : '';
}

function buildOverflowChips(hiddenTabs, urlCounts = {}) {
  const hiddenChips = hiddenTabs.map(tab => {
    const label    = cleanTitle(smartTitle(stripTitleNoise(tab.title || ''), tab.url), '');
    const count    = urlCounts[tab.url] || 1;
    const dupeTag  = count > 1 ? ` <span class="chip-dupe-badge">(${count}x)</span>` : '';
    const chipClass = count > 1 ? ' chip-has-dupes' : '';
    const safeUrl    = (tab.url || '').replace(/"/g, '&quot;');
    const safeTitle  = label.replace(/"/g, '&quot;');
    const faviconUrl = getTabFavicon(tab);
    const safeFavicon = faviconUrl.replace(/"/g, '&quot;');
    return `<div class="page-chip clickable${chipClass}" data-action="focus-tab" data-tab-url="${safeUrl}" title="${safeTitle}">
      ${faviconUrl ? `<img class="chip-favicon" src="${faviconUrl}" alt="" onerror="this.style.display='none'">` : ''}
      <span class="chip-text">${label}</span>${dupeTag}
      <div class="chip-actions">
        <button class="chip-action chip-save" data-action="defer-single-tab" data-tab-url="${safeUrl}" data-tab-title="${safeTitle}" data-tab-favicon="${safeFavicon}" title="${t('save_for_later')}">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z" /></svg>
        </button>
        <button class="chip-action chip-close" data-action="close-single-tab" data-tab-url="${safeUrl}" title="${t('close_this_tab')}">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
        </button>
      </div>
    </div>`;
  }).join('');

  return `
    <div class="page-chips-overflow" style="display:none">${hiddenChips}</div>
    <div class="page-chip page-chip-overflow clickable" data-action="expand-chips">
      <span class="chip-text">${t('overflow_more', hiddenTabs.length)}</span>
    </div>`;
}


/* ----------------------------------------------------------------
   DOMAIN CARD RENDERER
   ---------------------------------------------------------------- */

/**
 * renderDomainCard(group, globalUrlCounts)
 *
 * Builds the HTML for one domain group card.
 * group = { domain: string, tabs: [{ url, title, id, windowId, active }] }
 * globalUrlCounts = URL count map across ALL windows (for cross-window dupe detection)
 */
function renderDomainCard(group, globalUrlCounts = null) {
  const tabs      = group.tabs || [];
  const tabCount  = tabs.length;
  const isLanding = group.domain === '__landing-pages__';
  // Include windowId in stableId so the same domain in different windows
  // gets distinct IDs and close-domain-tabs works correctly.
  const windowSuffix = group.windowId ? '-w' + group.windowId : '';
  const stableId  = 'domain-' + group.domain.replace(/[^a-z0-9]/g, '-') + windowSuffix;

  // Count duplicates using global counts (cross-window) when available,
  // falling back to local counts within this group.
  const urlCounts = {};
  if (globalUrlCounts) {
    // Use global counts but only for URLs present in this group
    for (const tab of tabs) urlCounts[tab.url] = globalUrlCounts[tab.url] || 1;
  } else {
    for (const tab of tabs) urlCounts[tab.url] = (urlCounts[tab.url] || 0) + 1;
  }
  const dupeUrls    = Object.entries(urlCounts).filter(([, c]) => c > 1);
  const hasDupes    = dupeUrls.length > 0;
  const totalExtras = dupeUrls.reduce((s, [, c]) => s + c - 1, 0);

  // Staleness status — drives the top bar color
  const status   = getGroupStatus(tabs);
  const ageLabel = lastActiveAgo(tabs);
  const barClass =
    hasDupes              ? 'has-amber-bar' :
    status === 'active'   ? 'has-active-bar' :
    status === 'cooling'  ? 'has-amber-bar' :
    status === 'abandoned'? 'has-abandoned-bar' :
                            'has-neutral-bar';

  const statusColors = {
    active:    'var(--status-active)',
    cooling:   'var(--status-cooling)',
    abandoned: 'var(--status-abandoned)',
    neutral:   'var(--muted)',
  };
  const ageBadge = ageLabel
    ? `<span class="status-age-badge" style="color:${statusColors[status] || statusColors.neutral}">${ageLabel}</span>`
    : '';

  const tabBadge = `<span class="open-tabs-badge">
    ${ICONS.tabs}
    ${t('tabs_open', tabCount)}
  </span>`;

  const dupeBadge = hasDupes
    ? `<span class="open-tabs-badge" style="color:var(--accent-amber);background:var(--dup-badge-bg);">
        ${t('duplicates_badge', totalExtras)}
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
    const safeUrl    = (tab.url || '').replace(/"/g, '&quot;');
    const safeTitle  = label.replace(/"/g, '&quot;');
    const faviconUrl = getTabFavicon(tab);
    const safeFavicon = faviconUrl.replace(/"/g, '&quot;');
    return `<div class="page-chip clickable${chipClass}" data-action="focus-tab" data-tab-url="${safeUrl}" title="${safeTitle}">
      ${faviconUrl ? `<img class="chip-favicon" src="${faviconUrl}" alt="" onerror="this.style.display='none'">` : ''}
      <span class="chip-text">${label}</span>${dupeTag}
      <div class="chip-actions">
        <button class="chip-action chip-save" data-action="defer-single-tab" data-tab-url="${safeUrl}" data-tab-title="${safeTitle}" data-tab-favicon="${safeFavicon}" title="${t('save_for_later')}">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z" /></svg>
        </button>
        <button class="chip-action chip-close" data-action="close-single-tab" data-tab-url="${safeUrl}" title="${t('close_this_tab')}">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
        </button>
      </div>
    </div>`;
  }).join('') + (extraCount > 0 ? buildOverflowChips(uniqueTabs.slice(8), urlCounts) : '');

  let actionsHtml = `
    <button class="action-btn close-tabs" data-action="close-domain-tabs" data-domain-id="${stableId}">
      ${ICONS.close}
      ${t('close_all_tabs', tabCount)}
    </button>`;

  if (hasDupes) {
    const dupeUrlsEncoded = dupeUrls.map(([url]) => encodeURIComponent(url)).join(',');
    actionsHtml += `
      <button class="action-btn" data-action="dedup-keep-one" data-dupe-urls="${dupeUrlsEncoded}">
        ${t('close_duplicates', totalExtras)}
      </button>`;
  }

  return `
    <div class="mission-card domain-card ${barClass}" data-domain-id="${stableId}">
      <div class="status-bar"></div>
      <div class="mission-content">
        <div class="mission-top">
          <span class="mission-name">${isLanding ? t('homepages') : (group.label || friendlyDomain(group.domain))}</span>
          ${tabBadge}
          ${dupeBadge}
          ${ageBadge}
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
      countEl.textContent = t('items_count', active.length);
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
  // Prefer the saved favicon URL; fall back to Google's API
  const faviconUrl = (item.favIconUrl && /^https?:\/\//.test(item.favIconUrl))
    ? item.favIconUrl
    : (domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=16` : '');
  const ago = timeAgo(item.savedAt);

  return `
    <div class="deferred-item" data-deferred-id="${item.id}">
      <input type="checkbox" class="deferred-checkbox" data-action="check-deferred" data-deferred-id="${item.id}">
      <div class="deferred-info">
        <a href="${item.url}" target="_blank" rel="noopener" class="deferred-title" title="${(item.title || '').replace(/"/g, '&quot;')}">
          ${faviconUrl ? `<img src="${faviconUrl}" alt="" style="width:14px;height:14px;vertical-align:-2px;margin-right:4px" onerror="this.style.display='none'">` : ''}${item.title || item.url}
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
    if (openTabsSectionTitle) openTabsSectionTitle.textContent = t('section_open_tabs');
    openTabsSectionCount.innerHTML = `${t('domains_count', domainGroups.length)} &nbsp;&middot;&nbsp; <button class="action-btn close-tabs" data-action="close-all-open-tabs" style="font-size:11px;padding:3px 10px;">${ICONS.close} ${t('close_all_tabs', realTabs.length)}</button>`;

    // Split each domain group by window so the same domain in two windows
    // appears as two separate cards.
    const splitGroups = [];
    for (const group of domainGroups) {
      const windowMap = {};
      for (const tab of group.tabs) {
        const wid = tab.windowId;
        if (!windowMap[wid]) windowMap[wid] = { ...group, tabs: [], windowId: wid };
        windowMap[wid].tabs.push(tab);
      }
      splitGroups.push(...Object.values(windowMap));
    }
    // Replace domainGroups with the window-split version so event handlers
    // (close-domain-tabs) can still find the right group.
    domainGroups = splitGroups;

    // Determine unique windows and their display order (current window first)
    const currentWindow = await chrome.windows.getCurrent();
    const currentWindowId = currentWindow.id;
    const windowIds = [...new Set(splitGroups.map(g => g.windowId))].sort((a, b) =>
      a === currentWindowId ? -1 : b === currentWindowId ? 1 : a - b
    );
    const multiWindow = windowIds.length > 1;

    // Compute global URL counts across ALL windows for cross-window dupe detection
    const globalUrlCounts = {};
    for (const tab of realTabs) {
      if (tab.url) globalUrlCounts[tab.url] = (globalUrlCounts[tab.url] || 0) + 1;
    }

    // Build HTML — add a window section header before each window's cards
    let cardsHtml = '';
    windowIds.forEach((wid, idx) => {
      if (multiWindow) {
        const label = wid === currentWindowId ? t('this_window') : t('window_n', idx + 1);
        const switchBtn = wid !== currentWindowId
          ? `<button class="window-switch-btn" data-action="focus-window" data-window-id="${wid}" title="${t('switch_here')}">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="m4.5 19.5 15-15m0 0H8.25m11.25 0v11.25" /></svg>
              ${t('switch_here')}
            </button>`
          : '';
        const closeBtn = `<button class="window-switch-btn window-close-btn" data-action="close-window-tabs" data-window-id="${wid}" title="${t('close_window')}">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
              ${t('close_window')}
            </button>`;
        cardsHtml += `<div class="window-section-header" style="column-span:all">${label}${switchBtn}${closeBtn}</div>`;
      }
      const groups = splitGroups.filter(g => g.windowId === wid);
      cardsHtml += groups.map(g => renderDomainCard(g, globalUrlCounts)).join('');
    });

    openTabsMissionsEl.innerHTML = cardsHtml;
    openTabsSection.style.display = 'block';

    // Show the search bar when there are tabs to search
    const searchWrapper = document.getElementById('searchBarWrapper');
    if (searchWrapper) searchWrapper.style.display = 'block';
  } else if (openTabsSection) {
    openTabsSection.style.display = 'none';
    const searchWrapper = document.getElementById('searchBarWrapper');
    if (searchWrapper) searchWrapper.style.display = 'none';
  }

  // --- Footer stats ---
  const statTabs = document.getElementById('statTabs');
  if (statTabs) statTabs.textContent = getRealTabs().length;

  // --- Check for duplicate Tab Out tabs ---
  checkTabOutDupes();

  // --- Render "Saved for Later" column ---
  await renderDeferredColumn();
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
    showToast(t('toast_closed_tabout'));
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

  // ---- Switch to another window ----
  if (action === 'focus-window') {
    const windowId = parseInt(actionEl.dataset.windowId, 10);
    if (windowId) await chrome.windows.update(windowId, { focused: true });
    return;
  }

  // ---- Close all tabs in another window ----
  if (action === 'close-window-tabs') {
    const windowId = parseInt(actionEl.dataset.windowId, 10);
    if (!windowId) return;

    const allTabs = await chrome.tabs.query({ windowId });
    const toClose = allTabs.map(t => t.id);
    if (toClose.length > 0) await chrome.tabs.remove(toClose);
    await fetchOpenTabs();
    playCloseSound();

    // Remove all cards belonging to this window from the DOM
    domainGroups
      .filter(g => g.windowId === windowId)
      .forEach(g => {
        const windowSuffix = '-w' + windowId;
        const stableId = 'domain-' + g.domain.replace(/[^a-z0-9]/g, '-') + windowSuffix;
        const card = document.querySelector(`.mission-card[data-domain-id="${stableId}"]`);
        if (card) animateCardOut(card);
      });
    domainGroups = domainGroups.filter(g => g.windowId !== windowId);

    // Remove the window section header
    const header = actionEl.closest('.window-section-header');
    if (header) header.remove();

    const statTabs = document.getElementById('statTabs');
    if (statTabs) statTabs.textContent = getRealTabs().length;
    showToast(t('toast_closed_window'));
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
    if (statTabs) statTabs.textContent = getRealTabs().length;

    showToast(t('toast_tab_closed'));
    return;
  }

  // ---- Save a single tab for later (then close it) ----
  if (action === 'defer-single-tab') {
    e.stopPropagation();
    const tabUrl      = actionEl.dataset.tabUrl;
    const tabTitle    = actionEl.dataset.tabTitle || tabUrl;
    const tabFavIcon  = actionEl.dataset.tabFavicon || '';
    if (!tabUrl) return;

    // Save to chrome.storage.local
    try {
      await saveTabForLater({ url: tabUrl, title: tabTitle, favIconUrl: tabFavIcon });
    } catch (err) {
      console.error('[tab-out] Failed to save tab:', err);
      showToast(t('toast_save_failed'));
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

    showToast(t('toast_saved_later'));
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
      const windowSuffix = g.windowId ? '-w' + g.windowId : '';
      return 'domain-' + g.domain.replace(/[^a-z0-9]/g, '-') + windowSuffix === domainId;
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

    const groupLabel = group.domain === '__landing-pages__' ? t('homepages') : (group.label || friendlyDomain(group.domain));
    showToast(t('toast_closed_domain', urls.length, groupLabel));

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

    showToast(t('toast_closed_dupes'));
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

    showToast(t('toast_closed_all'));
    return;
  }
});

/* ----------------------------------------------------------------
   CHIP HOVER PREVIEW CARD
   Shows a floating card with favicon, full title, URL and domain
   when the user hovers over a .page-chip.clickable for 300 ms.
   Uses event delegation on document (mouseenter doesn't bubble,
   so we use mouseover + closest()).
   ---------------------------------------------------------------- */

(function initChipPreview() {
  const card     = document.getElementById('chipPreview');
  const favicon  = document.getElementById('chipPreviewFavicon');
  const titleEl  = document.getElementById('chipPreviewTitle');
  const hostEl   = document.getElementById('chipPreviewHost');
  const timeEl   = document.getElementById('chipPreviewTime');
  const countEl  = document.getElementById('chipPreviewCount');

  if (!card) return;

  let showTimer   = null;
  let currentChip = null;

  // ---- Helpers ----

  function getHostname(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); }
    catch { return ''; }
  }

  function getFaviconUrl(url, chipEl) {
    const saveBtn = chipEl.querySelector('[data-tab-favicon]');
    if (saveBtn && saveBtn.dataset.tabFavicon) return saveBtn.dataset.tabFavicon;

    const tab = openTabs.find(t => t.url === url);
    if (tab && tab.favIconUrl && /^https?:\/\//.test(tab.favIconUrl)) return tab.favIconUrl;

    const hostname = getHostname(url);
    return hostname ? `https://www.google.com/s2/favicons?domain=${hostname}&sz=32` : '';
  }

  // Count all open tabs (across all windows) sharing the same hostname
  function countSameDomainTabs(url) {
    const hostname = getHostname(url);
    if (!hostname) return 0;
    return openTabs.filter(t => {
      try { return new URL(t.url).hostname === hostname; }
      catch { return false; }
    }).length;
  }

  // ---- Positioning ----

  function positionCard(chipEl) {
    const GAP      = 8;
    const vw       = window.innerWidth;
    const vh       = window.innerHeight;
    const chipRect = chipEl.getBoundingClientRect();
    const cardW    = card.offsetWidth;
    const cardH    = card.offsetHeight;

    let left;
    if (chipRect.right + GAP + cardW <= vw - GAP) {
      left = chipRect.right + GAP;
    } else {
      left = Math.max(GAP, chipRect.left - GAP - cardW);
    }

    let top = chipRect.top;
    if (top + cardH > vh - GAP) top = vh - cardH - GAP;
    top = Math.max(GAP, top);

    card.style.left = `${Math.round(left)}px`;
    card.style.top  = `${Math.round(top)}px`;
  }

  // ---- Show / hide ----

  function showPreview(chipEl) {
    const url   = chipEl.dataset.tabUrl || '';
    const title = chipEl.title || chipEl.querySelector('.chip-text')?.textContent?.trim() || url;

    // Header: domain
    hostEl.textContent = getHostname(url);

    // Title: full, no truncation
    titleEl.textContent = title;

    // Favicon
    const faviconUrl = getFaviconUrl(url, chipEl);
    if (faviconUrl) {
      favicon.src = faviconUrl;
      favicon.classList.remove('hidden');
      favicon.onerror = () => favicon.classList.add('hidden');
    } else {
      favicon.src = '';
      favicon.classList.add('hidden');
    }

    // Last accessed time — look up the live tab
    const tab = openTabs.find(t => t.url === url);
    timeEl.textContent = tab?.lastAccessed ? timeAgo(tab.lastAccessed) : '';

    // Same-domain tab count
    const domainCount = countSameDomainTabs(url);
    countEl.textContent = domainCount > 1 ? `该域名共 ${domainCount} 个 tab` : '';

    // Hide meta row entirely if nothing to show
    const metaEl = document.getElementById('chipPreviewMeta');
    if (metaEl) metaEl.style.display =
      (timeEl.textContent || countEl.textContent) ? '' : 'none';

    card.classList.remove('visible');
    requestAnimationFrame(() => {
      positionCard(chipEl);
      card.classList.add('visible');
    });
  }

  function hidePreview() {
    clearTimeout(showTimer);
    showTimer   = null;
    currentChip = null;
    card.classList.remove('visible');
  }

  // ---- Event delegation ----

  document.addEventListener('mouseover', (e) => {
    const chip = e.target.closest('.page-chip.clickable');
    if (!chip) return;
    if (chip === currentChip) return;

    clearTimeout(showTimer);
    currentChip = chip;
    showTimer = setTimeout(() => showPreview(chip), 300);
  });

  document.addEventListener('mouseout', (e) => {
    const chip = e.target.closest('.page-chip.clickable');
    if (!chip) return;
    if (chip.contains(e.relatedTarget)) return;
    hidePreview();
  });

  window.addEventListener('scroll', hidePreview, { passive: true });
})();

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
      || `<div style="font-size:12px;color:var(--muted);padding:8px 0">${t('no_results')}</div>`;
  } catch (err) {
    console.warn('[tab-out] Archive search failed:', err);
  }
});


// ---- Tab search — filter cards as user types ----
document.addEventListener('input', async (e) => {
  if (e.target.id !== 'tabSearch') return;

  const query = e.target.value.trim();
  const clearBtn = document.getElementById('searchClear');
  if (clearBtn) clearBtn.style.display = query ? 'flex' : 'none';

  await filterTabsBySearch(query);

  // After re-render from clearing, restore focus to the input
  if (!query) e.target.focus();
});

document.getElementById('searchClear')?.addEventListener('click', async () => {
  const input = document.getElementById('tabSearch');
  if (!input) return;
  input.value = '';
  document.getElementById('searchClear').style.display = 'none';
  await filterTabsBySearch('');
  input.focus();
});


/* ----------------------------------------------------------------
   QUICK SHORTCUTS — chrome.storage.sync (synced across devices)
   ---------------------------------------------------------------- */

/**
 * migrateShortcutsFromLocal()
 *
 * One-time migration: move shortcuts from chrome.storage.local to chrome.storage.sync.
 * This ensures users don't lose their shortcuts when switching to sync storage.
 */
async function migrateShortcutsFromLocal() {
  // Check if already migrated
  const { shortcutsMigrated } = await chrome.storage.sync.get('shortcutsMigrated');
  if (shortcutsMigrated) return;

  // Check if there's old data in local storage
  const { shortcuts: localShortcuts = [] } = await chrome.storage.local.get('shortcuts');

  if (localShortcuts.length > 0) {
    // Migrate to sync
    await chrome.storage.sync.set({ shortcuts: localShortcuts });
    // Clear local storage
    await chrome.storage.local.remove('shortcuts');
    console.log('[tab-out] Migrated', localShortcuts.length, 'shortcuts from local to sync');
  }

  // Mark as migrated
  await chrome.storage.sync.set({ shortcutsMigrated: true });
}

/**
 * getShortcuts()
 *
 * Returns all saved shortcuts from chrome.storage.sync.
 */
async function getShortcuts() {
  // Run migration on first load
  await migrateShortcutsFromLocal();

  const { shortcuts = [] } = await chrome.storage.sync.get('shortcuts');

  // Return default shortcuts if none exist
  if (shortcuts.length === 0) {
    return [
      { id: 'default-1', url: 'https://www.google.com', title: 'Google', faviconUrl: 'https://www.google.com/s2/favicons?domain=google.com&sz=64' },
      { id: 'default-2', url: 'https://github.com', title: 'GitHub', faviconUrl: 'https://www.google.com/s2/favicons?domain=github.com&sz=64' },
      { id: 'default-3', url: 'https://huggingface.co', title: 'Hugging Face', faviconUrl: 'https://www.google.com/s2/favicons?domain=huggingface.co&sz=64' },
    ];
  }

  return shortcuts;
}

/**
 * saveShortcuts(shortcuts)
 *
 * Saves the shortcuts array to chrome.storage.sync.
 */
async function saveShortcuts(shortcuts) {
  await chrome.storage.sync.set({ shortcuts });
}

/**
 * addShortcut(url, title, faviconUrl)
 *
 * Adds a new shortcut.
 */
async function addShortcut(url, title, faviconUrl) {
  const shortcuts = await getShortcuts();
  const id = Date.now().toString();
  shortcuts.push({
    id,
    url: url.trim(),
    title: title.trim() || url,
    faviconUrl: faviconUrl || '',
  });
  await saveShortcuts(shortcuts);
  return id;
}

/**
 * updateShortcut(id, url, title, faviconUrl)
 *
 * Updates an existing shortcut.
 */
async function updateShortcut(id, url, title, faviconUrl) {
  const shortcuts = await getShortcuts();
  const idx = shortcuts.findIndex(s => s.id === id);
  if (idx !== -1) {
    shortcuts[idx] = {
      ...shortcuts[idx],
      url: url.trim(),
      title: title.trim() || url,
      faviconUrl: faviconUrl || '',
    };
    await saveShortcuts(shortcuts);
  }
}

/**
 * deleteShortcut(id)
 *
 * Deletes a shortcut by ID.
 */
async function deleteShortcut(id) {
  const shortcuts = await getShortcuts();
  const filtered = shortcuts.filter(s => s.id !== id);
  await saveShortcuts(filtered);
}

/**
 * getFaviconForShortcut(url)
 *
 * Returns the best favicon URL for a shortcut.
 */
function getFaviconForShortcut(url) {
  try {
    const domain = new URL(url).hostname;
    if (domain) {
      return `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
    }
  } catch {}
  return '';
}

/**
 * getLetterForShortcut(title)
 *
 * Returns the first letter of the title for display.
 */
function getLetterForShortcut(title) {
  return (title || '').charAt(0).toUpperCase() || '?';
}

/**
 * renderShortcuts()
 *
 * Renders the shortcuts icons bar.
 */
async function renderShortcuts() {
  const container = document.getElementById('shortcutsIcons');
  if (!container) return;

  const shortcuts = await getShortcuts();

  if (shortcuts.length === 0) {
    container.innerHTML = `<span class="shortcuts-empty">右键点击添加快捷方式</span>`;
    return;
  }

  container.innerHTML = shortcuts.map(shortcut => {
    const safeUrl = (shortcut.url || '').replace(/"/g, '&quot;');
    const safeTitle = (shortcut.title || '').replace(/"/g, '&quot;');
    const faviconUrl = shortcut.faviconUrl || getFaviconForShortcut(shortcut.url);
    const safeFavicon = faviconUrl.replace(/"/g, '&quot;');
    const letter = getLetterForShortcut(shortcut.title);

    return `<div class="shortcut-icon"
      data-action="shortcut-open"
      data-shortcut-url="${safeUrl}"
      data-shortcut-id="${shortcut.id}"
      title="${safeTitle}">
      <div class="shortcut-img-box">
        ${faviconUrl
          ? `<img class="shortcut-favicon" src="${safeFavicon}" alt="" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';"><span class="shortcut-letter" style="display:none">${letter}</span>`
          : `<span class="shortcut-letter" style="display:flex">${letter}</span>`
        }
      </div>
      <span class="shortcut-label">${safeTitle}</span>
    </div>`;
  }).join('');
}

/* ----------------------------------------------------------------
   SHORTCUTS EVENT HANDLERS
   ---------------------------------------------------------------- */

// Left-click on shortcut icon: open URL
document.addEventListener('click', async (e) => {
  const icon = e.target.closest('[data-action="shortcut-open"]');
  if (!icon) return;

  const url = icon.dataset.shortcutUrl;
  if (url) {
    await chrome.tabs.create({ url });
  }
});

// Right-click on shortcut icon: open edit panel
document.addEventListener('contextmenu', async (e) => {
  const icon = e.target.closest('.shortcut-icon');
  if (!icon) return;

  e.preventDefault();
  await openShortcutsEditPanel();
});

// Open edit panel
async function openShortcutsEditPanel() {
  const panel = document.getElementById('shortcutsEditPanel');
  const overlay = document.getElementById('shortcutsEditOverlay');
  const list = document.getElementById('shortcutsEditList');

  if (!panel || !overlay || !list) return;

  // Render the list
  const shortcuts = await getShortcuts();
  list.innerHTML = shortcuts.map(s => {
    const faviconUrl = s.faviconUrl || getFaviconForShortcut(s.url);
    const safeUrl = (s.url || '').replace(/"/g, '&quot;');
    const safeTitle = (s.title || '').replace(/"/g, '&quot;');
    return `<div class="shortcut-edit-item" data-shortcut-id="${s.id}">
      <img class="shortcut-edit-favicon" src="${faviconUrl}" alt="" onerror="this.style.opacity='0.3'">
      <div class="shortcut-edit-info">
        <div class="shortcut-edit-title">${safeTitle}</div>
        <div class="shortcut-edit-url">${safeUrl}</div>
      </div>
      <div class="shortcut-edit-actions">
        <button class="shortcut-edit-btn" data-action="shortcut-edit" data-shortcut-id="${s.id}" title="Edit">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
          </svg>
        </button>
        <button class="shortcut-edit-btn delete" data-action="shortcut-delete" data-shortcut-id="${s.id}" title="Delete">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
          </svg>
        </button>
      </div>
    </div>`;
  }).join('');

  panel.classList.add('visible');
  overlay.classList.add('visible');
}

// Close edit panel
function closeShortcutsEditPanel() {
  const panel = document.getElementById('shortcutsEditPanel');
  const overlay = document.getElementById('shortcutsEditOverlay');
  if (panel) panel.classList.remove('visible');
  if (overlay) overlay.classList.remove('visible');
  closeShortcutForm();
}

document.getElementById('shortcutsEditClose')?.addEventListener('click', closeShortcutsEditPanel);
document.getElementById('shortcutsEditOverlay')?.addEventListener('click', closeShortcutsEditPanel);

// Add new shortcut button
document.getElementById('shortcutsAddBtn')?.addEventListener('click', () => {
  openShortcutForm(null);
});

// Edit shortcut
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action="shortcut-edit"]');
  if (!btn) return;

  const id = btn.dataset.shortcutId;
  const shortcuts = await getShortcuts();
  const shortcut = shortcuts.find(s => s.id === id);
  if (shortcut) {
    openShortcutForm(shortcut);
  }
});

// Delete shortcut
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action="shortcut-delete"]');
  if (!btn) return;

  const id = btn.dataset.shortcutId;
  if (!id) return;

  // Remove from DOM with animation
  const item = btn.closest('.shortcut-edit-item');
  if (item) {
    item.style.transition = 'opacity 0.2s, transform 0.2s';
    item.style.opacity = '0';
    item.style.transform = 'translateX(20px)';
    setTimeout(() => item.remove(), 200);
  }

  await deleteShortcut(id);
  showToast('Shortcut deleted');
  await renderShortcuts();
});

// Shortcut form modal
let currentEditingId = null;

function openShortcutForm(shortcut = null) {
  currentEditingId = shortcut ? shortcut.id : null;

  // Create modal if not exists
  let modal = document.getElementById('shortcutFormModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.className = 'shortcut-form-modal';
    modal.id = 'shortcutFormModal';
    modal.innerHTML = `
      <h3 id="shortcutFormTitle">添加快捷方式</h3>
      <div class="shortcut-form-group">
        <label>标题</label>
        <input type="text" id="shortcutFormTitleInput" placeholder="e.g., GitHub">
      </div>
      <div class="shortcut-form-group">
        <label>网址</label>
        <input type="url" id="shortcutFormUrlInput" placeholder="https://github.com">
      </div>
      <div class="shortcut-form-actions">
        <button class="shortcut-form-cancel" id="shortcutFormCancel">取消</button>
        <button class="shortcut-form-submit" id="shortcutFormSubmit">保存</button>
      </div>
    `;
    document.body.appendChild(modal);

    document.getElementById('shortcutFormCancel').addEventListener('click', closeShortcutForm);
    document.getElementById('shortcutFormSubmit').addEventListener('click', submitShortcutForm);
  }

  const titleInput = document.getElementById('shortcutFormTitleInput');
  const urlInput = document.getElementById('shortcutFormUrlInput');
  const formTitle = document.getElementById('shortcutFormTitle');

  if (shortcut) {
    titleInput.value = shortcut.title || '';
    urlInput.value = shortcut.url || '';
    formTitle.textContent = '编辑快捷方式';
  } else {
    titleInput.value = '';
    urlInput.value = '';
    formTitle.textContent = '添加快捷方式';
  }

  modal.classList.add('visible');
}

function closeShortcutForm() {
  const modal = document.getElementById('shortcutFormModal');
  if (modal) modal.classList.remove('visible');
  currentEditingId = null;
}

async function submitShortcutForm() {
  const titleInput = document.getElementById('shortcutFormTitleInput');
  const urlInput = document.getElementById('shortcutFormUrlInput');

  const url = urlInput.value.trim();
  if (!url) {
    showToast('Please enter a URL');
    return;
  }

  // Validate URL
  try {
    new URL(url);
  } catch {
    showToast('Please enter a valid URL');
    return;
  }

  const title = titleInput.value.trim() || url;
  const faviconUrl = getFaviconForShortcut(url);

  if (currentEditingId) {
    await updateShortcut(currentEditingId, url, title, faviconUrl);
    showToast('Shortcut updated');
  } else {
    await addShortcut(url, title, faviconUrl);
    showToast('Shortcut added');
  }

  closeShortcutForm();
  await openShortcutsEditPanel(); // Refresh the panel
  await renderShortcuts(); // Refresh the icons bar
}

/* ----------------------------------------------------------------
   INITIALIZE
   ---------------------------------------------------------------- */
function initI18nElements() {
  const tabSearch = document.getElementById('tabSearch');
  if (tabSearch) tabSearch.placeholder = t('search_placeholder');

  const savedForLaterTitle = document.getElementById('savedForLaterTitle');
  if (savedForLaterTitle) savedForLaterTitle.textContent = t('saved_for_later');

  const nothingSavedText = document.getElementById('nothingSavedText');
  if (nothingSavedText) nothingSavedText.textContent = t('nothing_saved');

  const archiveLabel = document.getElementById('archiveLabel');
  if (archiveLabel) archiveLabel.textContent = t('archive');

  const archiveSearch = document.getElementById('archiveSearch');
  if (archiveSearch) archiveSearch.placeholder = t('search_archive_placeholder');

  const statTabsLabel = document.getElementById('statTabsLabel');
  if (statTabsLabel) statTabsLabel.textContent = t('stat_open_tabs');
}

initI18nElements();
renderShortcuts();
renderDashboard();


/* ----------------------------------------------------------------
   AUTO-REFRESH — React to tab changes in real time

   Since this IS an extension page, we can listen directly to
   chrome.tabs events. We debounce refreshes so that a burst of
   changes (e.g. closing many tabs at once) only triggers one
   re-render.
   ---------------------------------------------------------------- */
(function initAutoRefresh() {
  let refreshTimer = null;

  function scheduleRefresh() {
    // Don't clobber an active search query
    const searchInput = document.getElementById('tabSearch');
    if (searchInput && searchInput.value.trim()) return;

    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(async () => {
      await renderStaticDashboard();
    }, 500);
  }

  chrome.tabs.onCreated.addListener(scheduleRefresh);
  chrome.tabs.onRemoved.addListener(scheduleRefresh);
  chrome.tabs.onUpdated.addListener((_id, changeInfo) => {
    // Only refresh on meaningful changes to avoid noise from minor updates
    if (changeInfo.title || changeInfo.url || changeInfo.status === 'complete') {
      scheduleRefresh();
    }
  });
  chrome.tabs.onActivated.addListener(scheduleRefresh);
  chrome.tabs.onMoved.addListener(scheduleRefresh);
  chrome.tabs.onAttached.addListener(scheduleRefresh);
  chrome.tabs.onDetached.addListener(scheduleRefresh);
})();


/* ----------------------------------------------------------------
   MANUAL REFRESH BUTTON
   ---------------------------------------------------------------- */
document.getElementById('refreshBtn')?.addEventListener('click', async () => {
  const btn = document.getElementById('refreshBtn');
  if (btn) btn.classList.add('spinning');
  await renderStaticDashboard();
  if (btn) {
    btn.classList.remove('spinning');
  }
});
