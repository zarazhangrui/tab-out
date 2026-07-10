'use strict';

(function initDashboardViewUtils() {
  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatSessionDate(dateStr) {
    if (!dateStr) return '';

    const date = new Date(dateStr);
    if (Number.isNaN(date.getTime())) return '';

    return date.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    });
  }

  function buildSessionFilename(scopeLabel) {
    const now = new Date();
    const pad = value => String(value).padStart(2, '0');
    const stamp = [
      now.getFullYear(),
      pad(now.getMonth() + 1),
      pad(now.getDate()),
    ].join('-') + 'T' + [
      pad(now.getHours()),
      pad(now.getMinutes()),
      pad(now.getSeconds()),
    ].join('-');
    const safeScope = String(scopeLabel || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'session';
    return `tab-out-${safeScope}-${stamp}.json`;
  }

  function isSafeRenderableFaviconUrl(url) {
    if (!url || typeof url !== 'string') return false;
    if (/^https:\/\/t\d\.gstatic\.com\/faviconV2\b/i.test(url)) return false;
    return /^(https?:|data:|chrome:)/i.test(url);
  }

  function buildFaviconImg(domain, className = 'chip-favicon', faviconUrl = '') {
    const resolvedFaviconUrl = isSafeRenderableFaviconUrl(faviconUrl) ? faviconUrl : '';
    if (resolvedFaviconUrl) {
      return `<img class="${className}" src="${escapeHtml(resolvedFaviconUrl)}" alt="">`;
    }

    const domainLabel = String(domain || '').replace(/^www\./, '').trim();
    const placeholderLetter = escapeHtml((domainLabel[0] || '?').toUpperCase());
    const placeholderTitle = escapeHtml(domainLabel || 'Unknown site');
    return `<span class="${className} favicon-placeholder" aria-hidden="true" title="${placeholderTitle}">${placeholderLetter}</span>`;
  }

  function normalizeSearchText(value) {
    return String(value || '').trim().toLowerCase();
  }

  function searchTextMatches(query, ...parts) {
    const needle = normalizeSearchText(query);
    if (!needle) return true;
    return parts.some(part => normalizeSearchText(part).includes(needle));
  }

  function timeAgo(dateStr) {
    if (!dateStr) return '';
    const then = new Date(dateStr);
    const now = new Date();
    const diffMins = Math.floor((now - then) / 60000);
    const diffHours = Math.floor((now - then) / 3600000);
    const diffDays = Math.floor((now - then) / 86400000);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins} min ago`;
    if (diffHours < 24) return `${diffHours} hr${diffHours !== 1 ? 's' : ''} ago`;
    if (diffDays === 1) return 'yesterday';
    return `${diffDays} days ago`;
  }

  function shortTimeAgo(timestamp) {
    if (!timestamp) return '';
    const diffMs = Date.now() - Number(timestamp);
    if (!Number.isFinite(diffMs) || diffMs < 0) return '';

    const mins = Math.floor(diffMs / 60000);
    const hours = Math.floor(diffMs / 3600000);
    const days = Math.floor(diffMs / 86400000);

    if (mins < 1) return 'now';
    if (mins < 60) return `${mins}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
  }

  function getGreeting() {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  }

  function getDateDisplay() {
    return new Date().toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  }

  const FRIENDLY_DOMAINS = {
    'github.com': 'GitHub',
    'www.github.com': 'GitHub',
    'gist.github.com': 'GitHub Gist',
    'youtube.com': 'YouTube',
    'www.youtube.com': 'YouTube',
    'music.youtube.com': 'YouTube Music',
    'x.com': 'X',
    'www.x.com': 'X',
    'twitter.com': 'X',
    'www.twitter.com': 'X',
    'reddit.com': 'Reddit',
    'www.reddit.com': 'Reddit',
    'old.reddit.com': 'Reddit',
    'substack.com': 'Substack',
    'www.substack.com': 'Substack',
    'medium.com': 'Medium',
    'www.medium.com': 'Medium',
    'linkedin.com': 'LinkedIn',
    'www.linkedin.com': 'LinkedIn',
    'stackoverflow.com': 'Stack Overflow',
    'www.stackoverflow.com': 'Stack Overflow',
    'news.ycombinator.com': 'Hacker News',
    'google.com': 'Google',
    'www.google.com': 'Google',
    'mail.google.com': 'Gmail',
    'docs.google.com': 'Google Docs',
    'drive.google.com': 'Google Drive',
    'calendar.google.com': 'Google Calendar',
    'meet.google.com': 'Google Meet',
    'gemini.google.com': 'Gemini',
    'chatgpt.com': 'ChatGPT',
    'www.chatgpt.com': 'ChatGPT',
    'chat.openai.com': 'ChatGPT',
    'claude.ai': 'Claude',
    'www.claude.ai': 'Claude',
    'code.claude.com': 'Claude Code',
    'notion.so': 'Notion',
    'www.notion.so': 'Notion',
    'figma.com': 'Figma',
    'www.figma.com': 'Figma',
    'slack.com': 'Slack',
    'app.slack.com': 'Slack',
    'discord.com': 'Discord',
    'www.discord.com': 'Discord',
    'wikipedia.org': 'Wikipedia',
    'en.wikipedia.org': 'Wikipedia',
    'amazon.com': 'Amazon',
    'www.amazon.com': 'Amazon',
    'netflix.com': 'Netflix',
    'www.netflix.com': 'Netflix',
    'spotify.com': 'Spotify',
    'open.spotify.com': 'Spotify',
    'vercel.com': 'Vercel',
    'www.vercel.com': 'Vercel',
    'npmjs.com': 'npm',
    'www.npmjs.com': 'npm',
    'developer.mozilla.org': 'MDN',
    'arxiv.org': 'arXiv',
    'www.arxiv.org': 'arXiv',
    'huggingface.co': 'Hugging Face',
    'www.huggingface.co': 'Hugging Face',
    'producthunt.com': 'Product Hunt',
    'www.producthunt.com': 'Product Hunt',
    'xiaohongshu.com': 'RedNote',
    'www.xiaohongshu.com': 'RedNote',
    'local-files': 'Local Files',
  };

  function capitalize(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  function friendlyDomain(hostname) {
    if (!hostname) return '';
    if (FRIENDLY_DOMAINS[hostname]) return FRIENDLY_DOMAINS[hostname];

    if (hostname.endsWith('.substack.com') && hostname !== 'substack.com') {
      return `${capitalize(hostname.replace('.substack.com', ''))}'s Substack`;
    }
    if (hostname.endsWith('.github.io')) {
      return `${capitalize(hostname.replace('.github.io', ''))} (GitHub Pages)`;
    }

    const clean = hostname
      .replace(/^www\./, '')
      .replace(/\.(com|org|net|io|co|ai|dev|app|so|me|xyz|info|us|uk|co\.uk|co\.jp)$/, '');

    return clean.split('.').map(part => capitalize(part)).join(' ');
  }

  function getDomainGroupActionId(group) {
    const source = group && (group.id || group.domain);
    const sourceText = String(source || 'domain').toLowerCase();

    if (group && group.id) {
      return sourceText.replace(/[^a-z0-9_-]/g, char => `_${char.charCodeAt(0).toString(16)}_`);
    }

    const safeDomain = sourceText
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-|-$/g, '');
    return `domain-${safeDomain || 'unknown'}`;
  }

  function stripTitleNoise(title) {
    if (!title) return '';
    let nextTitle = title.replace(/^\(\d+\+?\)\s*/, '');
    nextTitle = nextTitle.replace(/\s*\([\d,]+\+?\)\s*/g, ' ');
    nextTitle = nextTitle.replace(/\s*[\-\u2010-\u2015]\s*[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, '');
    nextTitle = nextTitle.replace(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, '');
    nextTitle = nextTitle.replace(/\s+on X:\s*/, ': ');
    nextTitle = nextTitle.replace(/\s*\/\s*X\s*$/, '');
    return nextTitle.trim();
  }

  function cleanTitle(title, hostname) {
    if (!title || !hostname) return title || '';

    const friendly = friendlyDomain(hostname);
    const domain = hostname.replace(/^www\./, '');
    const seps = [' - ', ' | ', ' — ', ' · ', ' – '];

    for (const sep of seps) {
      const idx = title.lastIndexOf(sep);
      if (idx === -1) continue;
      const suffix = title.slice(idx + sep.length).trim();
      const suffixLow = suffix.toLowerCase();
      if (
        suffixLow === hostname.toLowerCase() ||
        suffixLow === domain.toLowerCase() ||
        suffixLow === friendly.toLowerCase() ||
        suffixLow === domain.replace(/\.\w+$/, '').toLowerCase() ||
        domain.toLowerCase().includes(suffixLow) ||
        friendly.toLowerCase().includes(suffixLow)
      ) {
        const cleaned = title.slice(0, idx).trim();
        if (cleaned.length > 0) return cleaned;
      }
    }
    return title;
  }

  function smartTitle(title, url) {
    if (!url) return title || '';
    let pathname = '';
    let hostname = '';

    try {
      const parsed = new URL(url);
      pathname = parsed.pathname;
      hostname = parsed.hostname;
    } catch {
      return title || '';
    }

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
        if (rest[0] === 'pull' && rest[1]) return `${owner}/${repo} PR #${rest[1]}`;
        if (rest[0] === 'blob' || rest[0] === 'tree') return `${owner}/${repo} — ${rest.slice(2).join('/')}`;
        if (titleIsUrl) return `${owner}/${repo}`;
      }
    }

    if ((hostname === 'www.youtube.com' || hostname === 'youtube.com') && pathname === '/watch') {
      if (titleIsUrl) return 'YouTube Video';
    }

    if ((hostname === 'www.reddit.com' || hostname === 'reddit.com' || hostname === 'old.reddit.com') && pathname.includes('/comments/')) {
      const parts = pathname.split('/').filter(Boolean);
      const subIdx = parts.indexOf('r');
      if (subIdx !== -1 && parts[subIdx + 1] && titleIsUrl) {
        return `r/${parts[subIdx + 1]} post`;
      }
    }

    return title || url;
  }

  const dashboardViewUtils = {
    buildFaviconImg,
    buildSessionFilename,
    capitalize,
    cleanTitle,
    escapeHtml,
    formatSessionDate,
    friendlyDomain,
    getDateDisplay,
    getDomainGroupActionId,
    getGreeting,
    normalizeSearchText,
    searchTextMatches,
    shortTimeAgo,
    smartTitle,
    stripTitleNoise,
    timeAgo,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = dashboardViewUtils;
  }

  if (typeof window !== 'undefined') {
    window.TabOutDashboardViewUtils = dashboardViewUtils;
  }
})();
