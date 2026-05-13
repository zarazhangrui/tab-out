/* ================================================================
   Tab Out — Dashboard App
   1. 读取当前窗口标签页
   2. 按域名分组（常用主页独立分组）
   3. 渲染域名卡片、统计
   4. 处理用户操作（关闭、保存、跳转）
   5. 稍后查看（chrome.storage.local）
   ================================================================ */

'use strict';

/* ----------------------------------------------------------------
   THEME MODE — system / light / dark
   ---------------------------------------------------------------- */

function applyThemeMode(mode) {
  const root = document.documentElement;
  const prefersDark = window.matchMedia &&
    window.matchMedia('(prefers-color-scheme: dark)').matches;
  const isDark = mode === 'dark' || (mode === 'system' && prefersDark);
  if (isDark) root.setAttribute('data-theme', 'dark');
  else        root.setAttribute('data-theme', 'light');
  root.setAttribute('data-mode', mode);
}

if (window.matchMedia) {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const onChange = () => {
    const mode = document.documentElement.getAttribute('data-mode') || 'system';
    if (mode === 'system') applyThemeMode('system');
  };
  if (mq.addEventListener) mq.addEventListener('change', onChange);
  else if (mq.addListener) mq.addListener(onChange);
}

try {
  if (chrome && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes.theme) return;
      const next = changes.theme.newValue;
      if (next === document.documentElement.getAttribute('data-mode')) return;
      applyThemeMode(next);
      try { localStorage.setItem('tabout-theme', next); } catch (err) {}
    });
  }
} catch (err) {}

/* ----------------------------------------------------------------
   CHROME TABS
   ---------------------------------------------------------------- */

let openTabs = [];

async function fetchOpenTabs() {
  try {
    const tabs = await chrome.tabs.query({});
    openTabs = tabs.map(t => ({
      id:       t.id,
      url:      t.url,
      title:    t.title,
      windowId: t.windowId,
      active:   t.active,
    }));
  } catch {
    openTabs = [];
  }
}

async function closeTabsByUrls(urls) {
  if (!urls || urls.length === 0) return;
  const targetHostnames = [];
  const exactUrls = new Set();
  for (const u of urls) {
    if (u.startsWith('file://')) { exactUrls.add(u); }
    else { try { targetHostnames.push(new URL(u).hostname); } catch {} }
  }
  const allTabs = await chrome.tabs.query({});
  const toClose = allTabs.filter(tab => {
    const tabUrl = tab.url || '';
    if (tabUrl.startsWith('file://') && exactUrls.has(tabUrl)) return true;
    try { return targetHostnames.includes(new URL(tabUrl).hostname); }
    catch { return false; }
  }).map(tab => tab.id);
  if (toClose.length > 0) await chrome.tabs.remove(toClose);
  await fetchOpenTabs();
}

async function closeTabsExact(urls) {
  if (!urls || urls.length === 0) return;
  const urlSet = new Set(urls);
  const allTabs = await chrome.tabs.query({});
  const toClose = allTabs.filter(t => urlSet.has(t.url)).map(t => t.id);
  if (toClose.length > 0) await chrome.tabs.remove(toClose);
  await fetchOpenTabs();
}

async function focusTab(url) {
  if (!url) return;
  const allTabs = await chrome.tabs.query({});
  const currentWindow = await chrome.windows.getCurrent();
  let matches = allTabs.filter(t => t.url === url);
  if (matches.length === 0) {
    try {
      const targetHost = new URL(url).hostname;
      matches = allTabs.filter(t => { try { return new URL(t.url).hostname === targetHost; } catch { return false; } });
    } catch {}
  }
  if (matches.length === 0) return;
  const match = matches.find(t => t.windowId !== currentWindow.id) || matches[0];
  await chrome.tabs.update(match.id, { active: true });
  await chrome.windows.update(match.windowId, { focused: true });
}

async function closeDuplicateTabs(urls, keepOne = true) {
  const allTabs = await chrome.tabs.query({});
  const toClose = [];
  for (const url of urls) {
    const matching = allTabs.filter(t => t.url === url);
    if (keepOne) {
      const keep = matching.find(t => t.active) || matching[0];
      for (const tab of matching) { if (tab.id !== keep.id) toClose.push(tab.id); }
    } else {
      for (const tab of matching) toClose.push(tab.id);
    }
  }
  if (toClose.length > 0) await chrome.tabs.remove(toClose);
  await fetchOpenTabs();
}

/* ----------------------------------------------------------------
   SAVED FOR LATER — chrome.storage.local
   ---------------------------------------------------------------- */

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

async function getSavedTabs() {
  const { deferred = [] } = await chrome.storage.local.get('deferred');
  const visible = deferred.filter(t => !t.dismissed);
  return {
    active:   visible.filter(t => !t.completed),
    archived: visible.filter(t => t.completed),
  };
}

async function checkOffSavedTab(id) {
  const { deferred = [] } = await chrome.storage.local.get('deferred');
  const tab = deferred.find(t => t.id === id);
  if (tab) { tab.completed = true; tab.completedAt = new Date().toISOString(); }
  await chrome.storage.local.set({ deferred });
}

async function dismissSavedTab(id) {
  const { deferred = [] } = await chrome.storage.local.get('deferred');
  const tab = deferred.find(t => t.id === id);
  if (tab) tab.dismissed = true;
  await chrome.storage.local.set({ deferred });
}

/* ----------------------------------------------------------------
   UI HELPERS
   ---------------------------------------------------------------- */

function playCloseSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const t = ctx.currentTime;
    const duration = 0.25;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      const pos = i / data.length;
      const env = pos < 0.1 ? pos / 0.1 : Math.pow(1 - (pos - 0.1) / 0.9, 1.5);
      data[i] = (Math.random() * 2 - 1) * env;
    }
    const source = ctx.createBufferSource(); source.buffer = buffer;
    const filter = ctx.createBiquadFilter(); filter.type = 'bandpass'; filter.Q.value = 2.0;
    filter.frequency.setValueAtTime(4000, t);
    filter.frequency.exponentialRampToValueAtTime(400, t + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.15, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    source.connect(filter).connect(gain).connect(ctx.destination);
    source.start(t);
    setTimeout(() => ctx.close(), 500);
  } catch {}
}

function shootConfetti(x, y) {
  const colors = ['#818cf8','#a78bfa','#f472b6','#fbbf24','#34d399','#38bdf8','#fb923c','#f87171'];
  const particleCount = 17;
  for (let i = 0; i < particleCount; i++) {
    const el = document.createElement('div');
    const size = 5 + Math.random() * 6;
    el.style.cssText = `position:fixed;left:${x}px;top:${y}px;width:${size}px;height:${size}px;background:${colors[Math.floor(Math.random()*colors.length)]};border-radius:${Math.random()>0.5?'50%':'2px'};pointer-events:none;z-index:9999;transform:translate(-50%,-50%);opacity:1;`;
    document.body.appendChild(el);
    const angle = Math.random() * Math.PI * 2;
    const speed = 60 + Math.random() * 120;
    const vx = Math.cos(angle) * speed;
    const vy = Math.sin(angle) * speed - 80;
    const gravity = 200;
    const startTime = performance.now();
    const duration = 700 + Math.random() * 200;
    function frame(now) {
      const elapsed = (now - startTime) / 1000;
      const progress = elapsed / (duration / 1000);
      if (progress >= 1) { el.remove(); return; }
      const px = vx * elapsed;
      const py = vy * elapsed + 0.5 * gravity * elapsed * elapsed;
      el.style.transform = `translate(calc(-50% + ${px}px), calc(-50% + ${py}px)) rotate(${elapsed*200}deg)`;
      el.style.opacity = progress < 0.5 ? 1 : 1 - (progress - 0.5) * 2;
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }
}

function animateCardOut(card) {
  if (!card) return;
  const rect = card.getBoundingClientRect();
  shootConfetti(rect.left + rect.width / 2, rect.top + rect.height / 2);
  card.classList.add('closing');
  setTimeout(() => { card.remove(); checkAndShowEmptyState(); }, 300);
}

function showToast(message) {
  const toast = document.getElementById('toast');
  document.getElementById('toastText').textContent = message;
  toast.classList.add('visible');
  setTimeout(() => toast.classList.remove('visible'), 2500);
}

function checkAndShowEmptyState() {
  const missionsEl = document.getElementById('openTabsMissions');
  if (!missionsEl) return;
  const remaining = missionsEl.querySelectorAll('.mission-card:not(.closing)').length;
  if (remaining > 0) return;
  missionsEl.innerHTML = `
    <div class="missions-empty-state">
      <div class="empty-checkmark">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5" /></svg>
      </div>
      <div class="empty-title">标签页已清零</div>
      <div class="empty-subtitle">干得漂亮</div>
    </div>`;
  const countEl = document.getElementById('openTabsSectionCount');
  if (countEl) countEl.textContent = '0 个域名';
}

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const then = new Date(dateStr);
  const now  = new Date();
  const diffMins  = Math.floor((now - then) / 60000);
  const diffHours = Math.floor((now - then) / 3600000);
  const diffDays  = Math.floor((now - then) / 86400000);
  if (diffMins < 1)   return '刚刚';
  if (diffMins < 60)  return diffMins + ' 分钟前';
  if (diffHours < 24) return diffHours + ' 小时前';
  if (diffDays === 1) return '昨天';
  return diffDays + ' 天前';
}

/* ----------------------------------------------------------------
   DOMAIN & TITLE HELPERS
   ---------------------------------------------------------------- */

const FRIENDLY_DOMAINS = {
  'github.com':'GitHub','www.github.com':'GitHub','gist.github.com':'GitHub Gist',
  'youtube.com':'YouTube','www.youtube.com':'YouTube','music.youtube.com':'YouTube Music',
  'x.com':'X','www.x.com':'X','twitter.com':'X','www.twitter.com':'X',
  'reddit.com':'Reddit','www.reddit.com':'Reddit','old.reddit.com':'Reddit',
  'linkedin.com':'LinkedIn','www.linkedin.com':'LinkedIn',
  'stackoverflow.com':'Stack Overflow','www.stackoverflow.com':'Stack Overflow',
  'news.ycombinator.com':'Hacker News',
  'google.com':'Google','www.google.com':'Google',
  'mail.google.com':'Gmail','docs.google.com':'文档','drive.google.com':'网盘',
  'calendar.google.com':'日历','meet.google.com':'Meet','gemini.google.com':'Gemini',
  'chatgpt.com':'ChatGPT','www.chatgpt.com':'ChatGPT','chat.openai.com':'ChatGPT',
  'claude.ai':'Claude','www.claude.ai':'Claude','code.claude.com':'Claude Code',
  'notion.so':'Notion','www.notion.so':'Notion',
  'figma.com':'Figma','www.figma.com':'Figma',
  'slack.com':'Slack','app.slack.com':'Slack',
  'discord.com':'Discord','www.discord.com':'Discord',
  'wikipedia.org':'维基百科','en.wikipedia.org':'维基百科',
  'amazon.com':'Amazon','www.amazon.com':'Amazon',
  'netflix.com':'Netflix','www.netflix.com':'Netflix',
  'spotify.com':'Spotify','open.spotify.com':'Spotify',
  'vercel.com':'Vercel','www.vercel.com':'Vercel',
  'npmjs.com':'npm','www.npmjs.com':'npm',
  'developer.mozilla.org':'MDN',
  'arxiv.org':'arXiv','www.arxiv.org':'arXiv',
  'huggingface.co':'Hugging Face','www.huggingface.co':'Hugging Face',
  'producthunt.com':'Product Hunt','www.producthunt.com':'Product Hunt',
  'xiaohongshu.com':'小红书','www.xiaohongshu.com':'小红书',
  'substack.com':'Substack','www.substack.com':'Substack',
  'medium.com':'Medium','www.medium.com':'Medium',
  'local-files':'本地文件',
};

function friendlyDomain(hostname) {
  if (!hostname) return '';
  if (FRIENDLY_DOMAINS[hostname]) return FRIENDLY_DOMAINS[hostname];
  if (hostname.endsWith('.substack.com') && hostname !== 'substack.com') return capitalize(hostname.replace('.substack.com','')) + "'s Substack";
  if (hostname.endsWith('.github.io')) return capitalize(hostname.replace('.github.io','')) + ' (GitHub Pages)';
  let clean = hostname.replace(/^www\./,'').replace(/\.(com|org|net|io|co|ai|dev|app|so|me|xyz|info|us|uk|co\.uk|co\.jp)$/,'');
  return clean.split('.').map(part => capitalize(part)).join(' ');
}

function capitalize(str) { return str ? str.charAt(0).toUpperCase() + str.slice(1) : ''; }

function stripTitleNoise(title) {
  if (!title) return '';
  title = title.replace(/^\(\d+\+?\)\s*/, '');
  title = title.replace(/\s*\([\d,]+\+?\)\s*/g, ' ');
  title = title.replace(/\s*[\-\u2010-\u2015]\s*[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, '');
  title = title.replace(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, '');
  title = title.replace(/\s+on X:\s*/, ': ');
  title = title.replace(/\s*\/\s*X\s*$/, '');
  return title.trim();
}

function cleanTitle(title, hostname) {
  if (!title || !hostname) return title || '';
  const friendly = friendlyDomain(hostname);
  const domain = hostname.replace(/^www\./, '');
  const seps = [' - ', ' | ', ' — ', ' · ', ' – '];
  for (const sep of seps) {
    const idx = title.lastIndexOf(sep);
    if (idx === -1) continue;
    const suffix = title.slice(idx + sep.length).trim().toLowerCase();
    if (suffix === domain.toLowerCase() || suffix === friendly.toLowerCase() || suffix === domain.replace(/\.\w+$/, '').toLowerCase() || domain.toLowerCase().includes(suffix) || friendly.toLowerCase().includes(suffix)) {
      const cleaned = title.slice(0, idx).trim();
      if (cleaned.length >= 5) return cleaned;
    }
  }
  return title;
}

function smartTitle(title, url) {
  if (!url) return title || '';
  let pathname = '', hostname = '';
  try { const u = new URL(url); pathname = u.pathname; hostname = u.hostname; } catch { return title || ''; }
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
  if ((hostname === 'www.youtube.com' || hostname === 'youtube.com') && pathname === '/watch') { if (titleIsUrl) return 'YouTube 视频'; }
  if ((hostname === 'www.reddit.com' || hostname === 'reddit.com' || hostname === 'old.reddit.com') && pathname.includes('/comments/')) {
    const parts = pathname.split('/').filter(Boolean);
    const subIdx = parts.indexOf('r');
    if (subIdx !== -1 && parts[subIdx + 1]) { if (titleIsUrl) return `r/${parts[subIdx + 1]} post`; }
  }
  return title || url;
}

/* ----------------------------------------------------------------
   SVG ICONS
   ---------------------------------------------------------------- */

const ICONS = {
  tabs:  `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M3 8.25V18a2.25 2.25 0 0 0 2.25 2.25h13.5A2.25 2.25 0 0 0 21 18V8.25m-18 0V6a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 6v2.25m-18 0h18" /></svg>`,
  close: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>`,
};

/* ----------------------------------------------------------------
   STATE
   ---------------------------------------------------------------- */

let domainGroups = [];
let showWindowLabels = false;
let windowNameMap = {};
let currentWindowId = null;

/* ----------------------------------------------------------------
   WINDOW MANAGEMENT
   ---------------------------------------------------------------- */

function buildWindowNameMap() {
  const windowIds = [...new Set(openTabs.map(t => t.windowId))];
  windowNameMap = {};
  windowIds.forEach((id, i) => { windowNameMap[id] = `窗口 ${i + 1}`; });
}

function getWindowCount() { return new Set(openTabs.map(t => t.windowId)).size; }

async function mergeAllWindows() {
  const currentWindow = await chrome.windows.getCurrent();
  const allTabs = await chrome.tabs.query({});
  const tabsToMove = allTabs.filter(t => t.windowId !== currentWindow.id);
  for (const tab of tabsToMove) await chrome.tabs.move(tab.id, { windowId: currentWindow.id, index: -1 });
  await fetchOpenTabs();
}

/* ----------------------------------------------------------------
   FILTER — current window only
   ---------------------------------------------------------------- */

function getRealTabs() {
  return openTabs.filter(t => {
    if (t.windowId !== currentWindowId) return false;
    const url = t.url || '';
    return !url.startsWith('chrome://') && !url.startsWith('chrome-extension://') && !url.startsWith('moz-extension://') && !url.startsWith('resource://') && !url.startsWith('about:') && !url.startsWith('edge://') && !url.startsWith('brave://');
  });
}

/* ----------------------------------------------------------------
   OVERFLOW CHIPS
   ---------------------------------------------------------------- */

function buildOverflowChips(hiddenTabs, urlCounts = {}) {
  const hiddenChips = hiddenTabs.map(tab => {
    const label = cleanTitle(smartTitle(stripTitleNoise(tab.title || ''), tab.url), '');
    const count = urlCounts[tab.url] || 1;
    const dupeTag = count > 1 ? ` <span class="chip-dupe-badge">(${count}x)</span>` : '';
    const chipClass = count > 1 ? ' chip-has-dupes' : '';
    const safeUrl = (tab.url || '').replace(/"/g, '&quot;');
    const safeTitle = label.replace(/"/g, '&quot;');
    let domain = ''; try { domain = new URL(tab.url).hostname; } catch {}
    const faviconUrl = domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=16` : '';
    return `<div class="page-chip clickable${chipClass}" data-action="focus-tab" data-tab-url="${safeUrl}" title="${safeTitle}">
      ${faviconUrl ? `<img class="chip-favicon" src="${faviconUrl}" alt="" onerror="this.style.display='none'">` : ''}
      <span class="chip-text">${label}</span>${dupeTag}
      <div class="chip-actions">
        <button class="chip-action chip-save" data-action="defer-single-tab" data-tab-url="${safeUrl}" data-tab-title="${safeTitle}" title="保存"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z" /></svg></button>
        <button class="chip-action chip-close" data-action="close-single-tab" data-tab-url="${safeUrl}" title="关闭"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg></button>
      </div></div>`;
  }).join('');
  return `<div class="page-chips-overflow" style="display:none">${hiddenChips}</div>
    <div class="page-chip page-chip-overflow clickable" data-action="expand-chips"><span class="chip-text">+${hiddenTabs.length} 更多</span></div>`;
}

/* ----------------------------------------------------------------
   DOMAIN CARD RENDERER
   ---------------------------------------------------------------- */

function renderDomainCard(group) {
  const tabs = group.tabs || [];
  const tabCount = tabs.length;
  const isLanding = group.domain === '__landing-pages__';
  const stableId = 'domain-' + group.domain.replace(/[^a-z0-9]/g, '-');

  const urlCounts = {};
  for (const tab of tabs) urlCounts[tab.url] = (urlCounts[tab.url] || 0) + 1;
  const dupeUrls = Object.entries(urlCounts).filter(([, c]) => c > 1);
  const hasDupes = dupeUrls.length > 0;
  const totalExtras = dupeUrls.reduce((s, [, c]) => s + c - 1, 0);

  const tabBadge = `<span class="open-tabs-badge">${ICONS.tabs}${tabCount} 个标签</span>`;
  const dupeBadge = hasDupes ? `<span class="open-tabs-badge" style="color:var(--accent-amber);background:rgba(200,113,58,0.08);">${totalExtras} 个重复</span>` : '';

  const seen = new Set();
  const uniqueTabs = [];
  for (const tab of tabs) { if (!seen.has(tab.url)) { seen.add(tab.url); uniqueTabs.push(tab); } }
  const visibleTabs = uniqueTabs.slice(0, 8);
  const extraCount = uniqueTabs.length - visibleTabs.length;

  const pageChips = visibleTabs.map(tab => {
    let label = cleanTitle(smartTitle(stripTitleNoise(tab.title || ''), tab.url), group.domain);
    try { const parsed = new URL(tab.url); if (parsed.hostname === 'localhost' && parsed.port) label = `${parsed.port} ${label}`; } catch {}
    const count = urlCounts[tab.url];
    const dupeTag = count > 1 ? ` <span class="chip-dupe-badge">(${count}x)</span>` : '';
    const chipClass = count > 1 ? ' chip-has-dupes' : '';
    const safeUrl = (tab.url || '').replace(/"/g, '&quot;');
    const safeTitle = label.replace(/"/g, '&quot;');
    let domain = ''; try { domain = new URL(tab.url).hostname; } catch {}
    const faviconUrl = domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=16` : '';
    const winLabel = showWindowLabels && windowNameMap[tab.windowId] ? `<span class="chip-window-badge">${windowNameMap[tab.windowId]}</span>` : '';
    return `<div class="page-chip clickable${chipClass}" data-action="focus-tab" data-tab-url="${safeUrl}" title="${safeTitle}">
      ${faviconUrl ? `<img class="chip-favicon" src="${faviconUrl}" alt="" onerror="this.style.display='none'">` : ''}
      <span class="chip-text">${label}</span>${dupeTag}${winLabel}
      <div class="chip-actions">
        <button class="chip-action chip-save" data-action="defer-single-tab" data-tab-url="${safeUrl}" data-tab-title="${safeTitle}" title="保存"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z" /></svg></button>
        <button class="chip-action chip-close" data-action="close-single-tab" data-tab-url="${safeUrl}" title="关闭"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg></button>
      </div></div>`;
  }).join('') + (extraCount > 0 ? buildOverflowChips(uniqueTabs.slice(8), urlCounts) : '');

  let actionsHtml = `<button class="action-btn close-tabs" data-action="close-domain-tabs" data-domain-id="${stableId}">${ICONS.close}关闭全部 ${tabCount} 个</button>`;
  if (hasDupes) {
    const dupeUrlsEncoded = dupeUrls.map(([url]) => encodeURIComponent(url)).join(',');
    actionsHtml += `<button class="action-btn" data-action="dedup-keep-one" data-dupe-urls="${dupeUrlsEncoded}">关闭 ${totalExtras} 个重复</button>`;
  }

  return `<div class="mission-card domain-card ${hasDupes ? 'has-amber-bar' : 'has-neutral-bar'}" data-domain-id="${stableId}">
    <div class="status-bar"></div>
    <div class="mission-content">
      <div class="mission-top">
        <span class="mission-name">${isLanding ? '常用主页' : (group.label || friendlyDomain(group.domain))}</span>
        ${tabBadge}${dupeBadge}
      </div>
      <div class="mission-pages">${pageChips}</div>
      <div class="actions">${actionsHtml}</div>
    </div></div>`;
}

/* ----------------------------------------------------------------
   SAVED FOR LATER — Render
   ---------------------------------------------------------------- */

async function renderDeferredColumn() {
  const column = document.getElementById('deferredColumn');
  if (!column) return;
  try {
    const { active, archived } = await getSavedTabs();
    if (active.length === 0 && archived.length === 0) { column.style.display = 'none'; return; }
    column.style.display = 'block';
    const list = document.getElementById('deferredList');
    const empty = document.getElementById('deferredEmpty');
    const countEl = document.getElementById('deferredCount');
    const archiveEl = document.getElementById('deferredArchive');
    const archiveCountEl = document.getElementById('archiveCount');
    const archiveList = document.getElementById('archiveList');
    if (active.length > 0) {
      countEl.textContent = `${active.length} 项`;
      list.innerHTML = active.map(item => renderDeferredItem(item)).join('');
      list.style.display = 'block'; empty.style.display = 'none';
    } else {
      list.style.display = 'none'; countEl.textContent = ''; empty.style.display = 'block';
    }
    if (archived.length > 0) {
      archiveCountEl.textContent = `(${archived.length})`;
      archiveList.innerHTML = archived.map(item => renderArchiveItem(item)).join('');
      archiveEl.style.display = 'block';
    } else { archiveEl.style.display = 'none'; }
  } catch (err) {
    console.warn('[tab-out] 无法加载保存列表:', err);
    column.style.display = 'none';
  }
}

function renderDeferredItem(item) {
  let domain = ''; try { domain = new URL(item.url).hostname.replace(/^www\./, ''); } catch {}
  const faviconUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=16`;
  const ago = timeAgo(item.savedAt);
  return `<div class="deferred-item" data-deferred-id="${item.id}">
    <input type="checkbox" class="deferred-checkbox" data-action="check-deferred" data-deferred-id="${item.id}">
    <div class="deferred-info">
      <a href="${item.url}" target="_blank" rel="noopener" class="deferred-title" title="${(item.title || '').replace(/"/g, '&quot;')}">
        <img src="${faviconUrl}" alt="" style="width:14px;height:14px;vertical-align:-2px;margin-right:4px" onerror="this.style.display='none'">${item.title || item.url}
      </a>
      <div class="deferred-meta"><span>${domain}</span><span>${ago}</span></div>
    </div>
    <button class="deferred-dismiss" data-action="dismiss-deferred" data-deferred-id="${item.id}" title="删除"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg></button>
  </div>`;
}

function renderArchiveItem(item) {
  const ago = item.completedAt ? timeAgo(item.completedAt) : timeAgo(item.savedAt);
  return `<div class="archive-item" data-deferred-id="${item.id}">
    <a href="${item.url}" target="_blank" rel="noopener" class="archive-item-title" title="${(item.title || '').replace(/"/g, '&quot;')}">${item.title || item.url}</a>
    <span class="archive-item-date">${ago}</span>
    <button class="deferred-dismiss" data-action="dismiss-deferred" data-deferred-id="${item.id}" title="删除"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg></button>
  </div>`;
}

/* ----------------------------------------------------------------
   MAIN RENDER
   ---------------------------------------------------------------- */

async function renderStaticDashboard() {
  if (!currentWindowId) { const w = await chrome.windows.getCurrent(); currentWindowId = w.id; }
  await fetchOpenTabs();
  buildWindowNameMap();
  const realTabs = getRealTabs();

  const LANDING_PAGE_PATTERNS = [
    { hostname: 'mail.google.com', test: (p, h) => !h.includes('#inbox/') && !h.includes('#sent/') && !h.includes('#search/') },
    { hostname: 'x.com', pathExact: ['/home'] },
    { hostname: 'www.linkedin.com', pathExact: ['/'] },
    { hostname: 'github.com', pathExact: ['/'] },
    { hostname: 'www.youtube.com', pathExact: ['/'] },
    ...(typeof LOCAL_LANDING_PAGE_PATTERNS !== 'undefined' ? LOCAL_LANDING_PAGE_PATTERNS : []),
  ];

  function isLandingPage(url) {
    try {
      const parsed = new URL(url);
      return LANDING_PAGE_PATTERNS.some(p => {
        const hostnameMatch = p.hostname ? parsed.hostname === p.hostname : p.hostnameEndsWith ? parsed.hostname.endsWith(p.hostnameEndsWith) : false;
        if (!hostnameMatch) return false;
        if (p.test) return p.test(parsed.pathname, url);
        if (p.pathPrefix) return parsed.pathname.startsWith(p.pathPrefix);
        if (p.pathExact) return p.pathExact.includes(parsed.pathname);
        return parsed.pathname === '/';
      });
    } catch { return false; }
  }

  domainGroups = [];
  const groupMap = {};
  const landingTabs = [];
  const customGroups = typeof LOCAL_CUSTOM_GROUPS !== 'undefined' ? LOCAL_CUSTOM_GROUPS : [];

  function matchCustomGroup(url) {
    try {
      const parsed = new URL(url);
      return customGroups.find(r => {
        const hostMatch = r.hostname ? parsed.hostname === r.hostname : r.hostnameEndsWith ? parsed.hostname.endsWith(r.hostnameEndsWith) : false;
        if (!hostMatch) return false;
        if (r.pathPrefix) return parsed.pathname.startsWith(r.pathPrefix);
        return true;
      }) || null;
    } catch { return null; }
  }

  for (const tab of realTabs) {
    try {
      if (isLandingPage(tab.url)) { landingTabs.push(tab); continue; }
      const customRule = matchCustomGroup(tab.url);
      if (customRule) {
        const key = customRule.groupKey;
        if (!groupMap[key]) groupMap[key] = { domain: key, label: customRule.groupLabel, tabs: [] };
        groupMap[key].tabs.push(tab); continue;
      }
      let hostname;
      if (tab.url && tab.url.startsWith('file://')) hostname = 'local-files';
      else hostname = new URL(tab.url).hostname;
      if (!hostname) continue;
      if (!groupMap[hostname]) groupMap[hostname] = { domain: hostname, tabs: [] };
      groupMap[hostname].tabs.push(tab);
    } catch {}
  }

  if (landingTabs.length > 0) groupMap['__landing-pages__'] = { domain: '__landing-pages__', tabs: landingTabs };

  const landingHostnames = new Set(LANDING_PAGE_PATTERNS.map(p => p.hostname).filter(Boolean));
  const landingSuffixes = LANDING_PAGE_PATTERNS.map(p => p.hostnameEndsWith).filter(Boolean);
  function isLandingDomain(domain) { return landingHostnames.has(domain) || landingSuffixes.some(s => domain.endsWith(s)); }

  domainGroups = Object.values(groupMap).sort((a, b) => {
    if (a.domain === '__landing-pages__' && b.domain !== '__landing-pages__') return -1;
    if (b.domain === '__landing-pages__' && a.domain !== '__landing-pages__') return 1;
    const aP = isLandingDomain(a.domain), bP = isLandingDomain(b.domain);
    if (aP !== bP) return aP ? -1 : 1;
    return b.tabs.length - a.tabs.length;
  });

  const openTabsSection = document.getElementById('openTabsSection');
  const openTabsMissionsEl = document.getElementById('openTabsMissions');
  const openTabsSectionCount = document.getElementById('openTabsSectionCount');

  if (domainGroups.length > 0 && openTabsSection) {
    const winCount = getWindowCount();
    const mergeBtn = winCount > 1
      ? ` <button class="action-btn save-tabs" data-action="merge-windows" style="font-size:11px;padding:3px 10px;">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" style="width:12px;height:12px"><path stroke-linecap="round" stroke-linejoin="round" d="M9 9V4.5M9 9H4.5M9 9 3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5 5.25 5.25" /></svg>
          合并 ${winCount} 个窗口</button>` : '';
    const showWinToggle = winCount > 1
      ? ` <button class="action-btn${showWindowLabels ? ' primary' : ''}" data-action="toggle-window-labels" style="font-size:11px;padding:3px 10px;">${ICONS.tabs}${showWindowLabels ? '隐藏' : '显示'}窗口</button>` : '';
    openTabsSectionCount.innerHTML = `${domainGroups.length} 个域名 &nbsp;&middot;&nbsp; <button class="action-btn close-tabs" data-action="close-all-open-tabs" style="font-size:11px;padding:3px 10px;">${ICONS.close}关闭全部 ${realTabs.length} 个标签</button>${mergeBtn}${showWinToggle}`;
    openTabsMissionsEl.innerHTML = domainGroups.map(g => renderDomainCard(g)).join('');
    openTabsSection.style.display = 'block';
  } else if (openTabsSection) {
    openTabsSection.style.display = 'none';
  }

  const statTabs = document.getElementById('statTabs');
  if (statTabs) statTabs.textContent = realTabs.length;

  await renderDeferredColumn();
}

async function renderDashboard() { await renderStaticDashboard(); }

/* ----------------------------------------------------------------
   EVENT HANDLERS
   ---------------------------------------------------------------- */

document.addEventListener('click', async (e) => {
  const actionEl = e.target.closest('[data-action]');
  if (!actionEl) return;
  const action = actionEl.dataset.action;

  if (action === 'toggle-theme') {
    const root = document.documentElement;
    const cur = root.getAttribute('data-mode') || 'system';
    const next = cur === 'system' ? 'light' : cur === 'light' ? 'dark' : 'system';
    applyThemeMode(next);
    try { localStorage.setItem('tabout-theme', next); } catch (err) {}
    try { await chrome.storage.local.set({ theme: next }); } catch (err) {}
    return;
  }

  const card = actionEl.closest('.mission-card');

  if (action === 'expand-chips') {
    const overflowContainer = actionEl.parentElement.querySelector('.page-chips-overflow');
    if (overflowContainer) { overflowContainer.style.display = 'contents'; actionEl.remove(); }
    return;
  }

  if (action === 'focus-tab') { const tabUrl = actionEl.dataset.tabUrl; if (tabUrl) await focusTab(tabUrl); return; }

  if (action === 'close-single-tab') {
    e.stopPropagation();
    const tabUrl = actionEl.dataset.tabUrl;
    if (!tabUrl) return;
    const allTabs = await chrome.tabs.query({});
    const match = allTabs.find(t => t.url === tabUrl);
    if (match) await chrome.tabs.remove(match.id);
    await fetchOpenTabs();
    playCloseSound();
    const chip = actionEl.closest('.page-chip');
    if (chip) {
      const rect = chip.getBoundingClientRect();
      shootConfetti(rect.left + rect.width / 2, rect.top + rect.height / 2);
      chip.style.transition = 'opacity 0.2s, transform 0.2s';
      chip.style.opacity = '0'; chip.style.transform = 'scale(0.8)';
      setTimeout(() => { chip.remove(); document.querySelectorAll('.mission-card').forEach(c => { if (c.querySelectorAll('.page-chip[data-action="focus-tab"]').length === 0) animateCardOut(c); }); }, 200);
    }
    const statTabs = document.getElementById('statTabs');
    if (statTabs) statTabs.textContent = getRealTabs().length;
    showToast('已关闭');
    return;
  }

  if (action === 'defer-single-tab') {
    e.stopPropagation();
    const tabUrl = actionEl.dataset.tabUrl, tabTitle = actionEl.dataset.tabTitle || tabUrl;
    if (!tabUrl) return;
    try { await saveTabForLater({ url: tabUrl, title: tabTitle }); } catch (err) { showToast('保存失败'); return; }
    const allTabs = await chrome.tabs.query({});
    const match = allTabs.find(t => t.url === tabUrl);
    if (match) await chrome.tabs.remove(match.id);
    await fetchOpenTabs();
    const chip = actionEl.closest('.page-chip');
    if (chip) { chip.style.transition = 'opacity 0.2s, transform 0.2s'; chip.style.opacity = '0'; chip.style.transform = 'scale(0.8)'; setTimeout(() => chip.remove(), 200); }
    showToast('已保存');
    await renderDeferredColumn();
    return;
  }

  if (action === 'check-deferred') {
    const id = actionEl.dataset.deferredId; if (!id) return;
    await checkOffSavedTab(id);
    const item = actionEl.closest('.deferred-item');
    if (item) { item.classList.add('checked'); setTimeout(() => { item.classList.add('removing'); setTimeout(() => { item.remove(); renderDeferredColumn(); }, 300); }, 800); }
    return;
  }

  if (action === 'dismiss-deferred') {
    const id = actionEl.dataset.deferredId; if (!id) return;
    await dismissSavedTab(id);
    const item = actionEl.closest('.deferred-item, .archive-item');
    if (item) { item.classList.add('removing'); setTimeout(() => { item.remove(); renderDeferredColumn(); }, 300); }
    return;
  }

  if (action === 'close-domain-tabs') {
    const domainId = actionEl.dataset.domainId;
    const group = domainGroups.find(g => 'domain-' + g.domain.replace(/[^a-z0-9]/g, '-') === domainId);
    if (!group) return;
    const urls = group.tabs.map(t => t.url);
    const useExact = group.domain === '__landing-pages__' || !!group.label;
    if (useExact) await closeTabsExact(urls); else await closeTabsByUrls(urls);
    if (card) { playCloseSound(); animateCardOut(card); }
    const idx = domainGroups.indexOf(group); if (idx !== -1) domainGroups.splice(idx, 1);
    const groupLabel = group.domain === '__landing-pages__' ? '常用主页' : (group.label || friendlyDomain(group.domain));
    showToast(`已关闭 ${groupLabel} 的 ${urls.length} 个标签`);
    const statTabs = document.getElementById('statTabs');
    if (statTabs) statTabs.textContent = getRealTabs().length;
    return;
  }

  if (action === 'dedup-keep-one') {
    const urlsEncoded = actionEl.dataset.dupeUrls || '';
    const urls = urlsEncoded.split(',').map(u => decodeURIComponent(u)).filter(Boolean);
    if (urls.length === 0) return;
    await closeDuplicateTabs(urls, true);
    playCloseSound();
    actionEl.style.transition = 'opacity 0.2s'; actionEl.style.opacity = '0'; setTimeout(() => actionEl.remove(), 200);
    if (card) {
      card.querySelectorAll('.chip-dupe-badge').forEach(b => { b.style.transition = 'opacity 0.2s'; b.style.opacity = '0'; setTimeout(() => b.remove(), 200); });
      card.querySelectorAll('.open-tabs-badge').forEach(badge => { if (badge.textContent.includes('重复')) { badge.style.transition = 'opacity 0.2s'; badge.style.opacity = '0'; setTimeout(() => badge.remove(), 200); } });
      card.classList.remove('has-amber-bar'); card.classList.add('has-neutral-bar');
    }
    showToast('已去重');
    return;
  }

  if (action === 'merge-windows') { await mergeAllWindows(); playCloseSound(); showToast('所有窗口已合并'); await renderDashboard(); return; }

  if (action === 'toggle-window-labels') { showWindowLabels = !showWindowLabels; await renderDashboard(); return; }

  if (action === 'close-all-open-tabs') {
    const allUrls = openTabs.filter(t => t.windowId === currentWindowId && t.url && !t.url.startsWith('chrome') && !t.url.startsWith('about:')).map(t => t.url);
    await closeTabsByUrls(allUrls);
    playCloseSound();
    document.querySelectorAll('#openTabsMissions .mission-card').forEach(c => { shootConfetti(c.getBoundingClientRect().left + c.offsetWidth / 2, c.getBoundingClientRect().top + c.offsetHeight / 2); animateCardOut(c); });
    showToast('全部已关闭');
    return;
  }
});

document.addEventListener('click', (e) => {
  const toggle = e.target.closest('#archiveToggle');
  if (!toggle) return;
  toggle.classList.toggle('open');
  const body = document.getElementById('archiveBody');
  if (body) body.style.display = body.style.display === 'none' ? 'block' : 'none';
});

document.addEventListener('input', (e) => {
  if (e.target.id === 'openTabsSearch') {
    const q = e.target.value.trim().toLowerCase();
    const missionsEl = document.getElementById('openTabsMissions');
    if (!missionsEl) return;
    const cards = missionsEl.querySelectorAll('.mission-card');
    if (q.length === 0) { missionsEl.classList.remove('is-searching'); cards.forEach(card => { card.classList.remove('search-hidden'); card.querySelectorAll('.page-chip').forEach(chip => chip.classList.remove('search-hidden')); }); return; }
    missionsEl.classList.add('is-searching');
    cards.forEach(card => {
      const domainLabel = (card.querySelector('.mission-name')?.textContent || '').toLowerCase();
      if (domainLabel.includes(q)) { card.classList.remove('search-hidden'); card.querySelectorAll('.page-chip:not(.page-chip-overflow)').forEach(chip => chip.classList.remove('search-hidden')); return; }
      let anyVisible = false;
      card.querySelectorAll('.page-chip:not(.page-chip-overflow)').forEach(chip => {
        const title = (chip.title || chip.querySelector('.chip-text')?.textContent || '').toLowerCase();
        const url = (chip.dataset.tabUrl || '').toLowerCase();
        if (title.includes(q) || url.includes(q)) { chip.classList.remove('search-hidden'); anyVisible = true; } else { chip.classList.add('search-hidden'); }
      });
      card.classList.toggle('search-hidden', !anyVisible);
    });
  }
  if (e.target.id === 'archiveSearch') {
    (async () => {
      const q = e.target.value.trim().toLowerCase();
      const archiveList = document.getElementById('archiveList');
      if (!archiveList) return;
      try {
        const { archived } = await getSavedTabs();
        if (q.length < 2) { archiveList.innerHTML = archived.map(item => renderArchiveItem(item)).join(''); return; }
        const results = archived.filter(item => (item.title || '').toLowerCase().includes(q) || (item.url || '').toLowerCase().includes(q));
        archiveList.innerHTML = results.map(item => renderArchiveItem(item)).join('') || '<div style="font-size:12px;color:var(--muted);padding:8px 0">无结果</div>';
      } catch (err) { console.warn('[tab-out] 搜索归档失败:', err); }
    })();
  }
});

/* ----------------------------------------------------------------
   LIVE TAB LISTENERS
   ---------------------------------------------------------------- */

let _tabRefreshTimer = null;
let _initialRenderDone = false;

function scheduleRefresh() {
  if (_tabRefreshTimer) clearTimeout(_tabRefreshTimer);
  _tabRefreshTimer = setTimeout(() => { if (_initialRenderDone) document.body.classList.add('no-entrance-anim'); renderDashboard(); }, 300);
}

if (typeof chrome !== 'undefined' && chrome.tabs) {
  chrome.tabs.onCreated.addListener(scheduleRefresh);
  chrome.tabs.onRemoved.addListener(scheduleRefresh);
  chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => { if (changeInfo.status === 'complete' || changeInfo.url) scheduleRefresh(); });
  chrome.tabs.onActivated.addListener(async (activeInfo) => {
    try { const tab = await chrome.tabs.get(activeInfo.tabId); if (tab.url && tab.url.startsWith(`chrome-extension://${chrome.runtime.id}/`)) scheduleRefresh(); } catch {}
  });
}

/* ----------------------------------------------------------------
   KEYBOARD SHORTCUTS
   ---------------------------------------------------------------- */

document.addEventListener('keydown', (e) => {
  const search = document.getElementById('openTabsSearch');
  if (!search) return;
  if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey) {
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    e.preventDefault(); search.focus(); search.select(); return;
  }
  if (e.key === 'Escape' && document.activeElement === search) { search.value = ''; search.dispatchEvent(new Event('input')); search.blur(); }
});

/* ----------------------------------------------------------------
   INITIALIZE
   ---------------------------------------------------------------- */

renderDashboard().then(() => { _initialRenderDone = true; });
