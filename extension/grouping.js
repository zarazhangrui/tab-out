/**
 * 本地语义分组的纯函数。
 * 不读取页面正文，不访问网络，也不调用 chrome。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (root) root.TabOutGrouping = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DRAG_MIME = 'application/x-tab-out-url';
  const FIXED_NOW = '2026-11-12T00:00:00.000Z';

  const CATEGORY_ORDER = [
    'ai', 'study', 'design', 'dev', 'jobs',
    'notes', 'office', 'social', 'video', 'shopping',
  ];

  const BUILTINS = [
    { id: 'builtin-ai', name: 'AI 平台', builtinKey: 'ai', order: 0 },
    { id: 'builtin-study', name: '学习课程', builtinKey: 'study', order: 1 },
    { id: 'builtin-design', name: '设计平台', builtinKey: 'design', order: 2 },
    { id: 'builtin-dev', name: '开发工具', builtinKey: 'dev', order: 3 },
    { id: 'builtin-jobs', name: '求职招聘', builtinKey: 'jobs', order: 4 },
    { id: 'builtin-notes', name: '知识笔记', builtinKey: 'notes', order: 5 },
    { id: 'builtin-office', name: '办公协作', builtinKey: 'office', order: 6 },
    { id: 'builtin-social', name: '社交内容', builtinKey: 'social', order: 7 },
    { id: 'builtin-video', name: '视频娱乐', builtinKey: 'video', order: 8 },
    { id: 'builtin-shopping', name: '购物消费', builtinKey: 'shopping', order: 9 },
    { id: 'builtin-other', name: '其他', builtinKey: 'other', order: 10 },
  ];

  const CATEGORY_ID = Object.fromEntries(BUILTINS.map(item => [item.builtinKey, item.id]));
  const CATEGORY_RANK = Object.fromEntries(CATEGORY_ORDER.map((key, index) => [key, index]));

  function hostRule(category, host) {
    return { kind: 'host', category, host };
  }

  function titleRule(category, keywords) {
    return { kind: 'title', category, keywords };
  }

  const BUILTIN_RULES = [
    ...['chatgpt.com', 'chat.openai.com', 'claude.ai', 'gemini.google.com', 'grok.com', 'cursor.com', 'cursor.sh']
      .map(host => hostRule('ai', host)),
    ...['coursera.org', 'xuetangx.com'].map(host => hostRule('study', host)),
    ...['figma.com', 'canva.com', 'pinterest.com', 'dribbble.com'].map(host => hostRule('design', host)),
    ...['github.com', 'github.io', 'stackoverflow.com', 'localhost', '127.0.0.1', 'vercel.com']
      .map(host => hostRule('dev', host)),
    ...['zhipin.com', 'liepin.com', 'linkedin.com'].map(host => hostRule('jobs', host)),
    ...['notion.so', 'notion.com', 'evernote.com', 'yinxiang.com', 'obsidian.md']
      .map(host => hostRule('notes', host)),
    ...['docs.google.com', 'sheets.google.com', 'mail.google.com', 'gmail.com', 'calendar.google.com', 'feishu.cn', 'larksuite.com', 'docs.qq.com']
      .map(host => hostRule('office', host)),
    ...['xiaohongshu.com', 'x.com', 'twitter.com', 'weibo.com', 'weibo.cn'].map(host => hostRule('social', host)),
    ...['youtube.com', 'youtu.be', 'bilibili.com', 'b23.tv'].map(host => hostRule('video', host)),
    ...['taobao.com', 'jd.com', 'amazon.com', 'amazon.cn'].map(host => hostRule('shopping', host)),
    titleRule('ai', ['chatgpt', 'claude', 'gemini', 'grok']),
    titleRule('study', ['教程', '网课', '公开课', '讲义', '课程', 'tutorial', 'lecture']),
    titleRule('notes', ['obsidian', 'evernote', '印象笔记']),
  ];

  const BUILTIN_LANDING_PATTERNS = [
    { hostname: 'mail.google.com', test: (_pathname, fullUrl) =>
      !fullUrl.includes('#inbox/') && !fullUrl.includes('#sent/') && !fullUrl.includes('#search/') },
    { hostname: 'x.com', pathExact: ['/home'] },
    { hostname: 'www.linkedin.com', pathExact: ['/'] },
    { hostname: 'github.com', pathExact: ['/'] },
    { hostname: 'www.youtube.com', pathExact: ['/'] },
  ];

  const TRACKING_KEYS = new Set([
    'fbclid', 'gclid', 'igshid', 'mc_cid', 'mc_eid', 'yclid', 'gbraid', 'wbraid',
  ]);

  function escapeHtml(text) {
    return String(text ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function cloneState(state) {
    return {
      version: 1,
      groups: (state.groups || []).map(group => ({ ...group })),
      assignments: { ...(state.assignments || {}) },
      disabledBuiltinKeys: [...(state.disabledBuiltinKeys || [])],
    };
  }

  function clockOf(now) {
    return typeof now === 'function' ? now : () => new Date().toISOString();
  }

  function builtinRecord(def, now) {
    const stamp = now();
    return {
      id: def.id,
      name: def.name,
      kind: 'builtin',
      builtinKey: def.builtinKey,
      order: def.order,
      createdAt: stamp,
      updatedAt: stamp,
    };
  }

  function emptyState(now) {
    return {
      version: 1,
      groups: BUILTINS.map(def => builtinRecord(def, now)),
      assignments: {},
      disabledBuiltinKeys: [],
    };
  }

  function normalizeAssignmentUrl(raw) {
    let url;
    try {
      url = new URL(raw);
    } catch {
      return null;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:' && url.protocol !== 'file:') {
      return null;
    }
    if (url.protocol === 'file:') {
      return url.href.split('#')[0];
    }
    let path = url.pathname || '/';
    if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
    const params = [];
    for (const [key, value] of url.searchParams) {
      const lower = key.toLowerCase();
      if (lower.startsWith('utm_') || TRACKING_KEYS.has(lower)) continue;
      params.push([key, value]);
    }
    params.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0)));
    const search = new URLSearchParams();
    for (const [key, value] of params) search.append(key, value);
    const query = search.toString();
    const port = url.port ? ':' + url.port : '';
    return `${url.protocol}//${url.hostname.toLowerCase()}${port}${path}${query ? '?' + query : ''}`;
  }

  function semanticHost(hostname) {
    const host = String(hostname || '').toLowerCase();
    return host.startsWith('www.') ? host.slice(4) : host;
  }

  function hostMatches(hostname, ruleHost) {
    const host = semanticHost(hostname);
    const expected = String(ruleHost || '').toLowerCase();
    return host === expected || host.endsWith('.' + expected);
  }

  function pathMatches(pathname, prefix) {
    if (!prefix) return true;
    return pathname === prefix || pathname.startsWith(prefix + '/');
  }

  function keywordMatches(title, keyword) {
    if (!title || !keyword || Array.from(keyword).length < 2) return false;
    if (/[^\u0000-\u007f]/.test(keyword)) return title.toLowerCase().includes(keyword.toLowerCase());
    const pattern = new RegExp('(?:^|[^a-z0-9])' + escapeRegExp(keyword) + '(?:[^a-z0-9]|$)', 'i');
    return pattern.test(title);
  }

  function ruleMatches(rule, tab) {
    if (rule.kind === 'title') {
      return (rule.keywords || []).some(keyword => keywordMatches(tab.title || '', keyword));
    }
    let parsed;
    try {
      parsed = new URL(tab.url);
    } catch {
      return false;
    }
    if (!hostMatches(parsed.hostname, rule.host)) return false;
    if (rule.pathPrefix && !pathMatches(parsed.pathname, rule.pathPrefix)) return false;
    if (rule.kind === 'host-title') {
      return (rule.keywords || []).some(keyword => keywordMatches(tab.title || '', keyword));
    }
    return rule.kind === 'host';
  }

  function ruleScore(rule) {
    if (rule.kind === 'title') return 0;
    return rule.host.length * 1000 + (rule.pathPrefix ? rule.pathPrefix.length : 0);
  }

  function pickBest(rules, tab) {
    let best = null;
    for (const rule of rules) {
      if (!ruleMatches(rule, tab)) continue;
      const score = ruleScore(rule);
      const rank = CATEGORY_RANK[rule.category] ?? 99;
      if (!best || score > best.score || (score === best.score && rank < best.rank)) {
        best = { rule, score, rank };
      }
    }
    return best;
  }

  function isLandingPage(url, patterns) {
    try {
      const parsed = new URL(url);
      return patterns.some(pattern => {
        const hostnameMatch = pattern.hostname
          ? parsed.hostname === pattern.hostname
          : pattern.hostnameEndsWith
            ? parsed.hostname.endsWith(pattern.hostnameEndsWith)
            : false;
        if (!hostnameMatch) return false;
        if (pattern.test) return pattern.test(parsed.pathname, url);
        if (pattern.pathPrefix) return parsed.pathname.startsWith(pattern.pathPrefix);
        if (pattern.pathExact) return pattern.pathExact.includes(parsed.pathname);
        return parsed.pathname === '/';
      });
    } catch {
      return false;
    }
  }

  function matchCustomGroup(url, customGroups) {
    try {
      const parsed = new URL(url);
      return customGroups.find(rule => {
        const hostMatch = rule.hostname
          ? parsed.hostname === rule.hostname
          : rule.hostnameEndsWith
            ? parsed.hostname.endsWith(rule.hostnameEndsWith)
            : false;
        if (!hostMatch) return false;
        if (rule.pathPrefix) return parsed.pathname.startsWith(rule.pathPrefix);
        return true;
      }) || null;
    } catch {
      return null;
    }
  }

  function groupById(state, groupId) {
    return (state.groups || []).find(group => group.id === groupId) || null;
  }

  function groupIsActive(state, groupId) {
    const group = groupById(state, groupId);
    if (!group) return false;
    if (group.builtinKey && (state.disabledBuiltinKeys || []).includes(group.builtinKey)) return false;
    return true;
  }

  function readContext(context) {
    const source = context || {};
    const state = source.semanticGroups || source;
    return {
      groups: source.groups || state.groups || [],
      assignments: source.assignments || state.assignments || {},
      disabledBuiltinKeys: source.disabledBuiltinKeys || state.disabledBuiltinKeys || [],
      landingPatterns: Array.isArray(source.landingPatterns)
        ? source.landingPatterns
        : BUILTIN_LANDING_PATTERNS.concat(source.extraLandingPatterns || []),
      customGroups: source.customGroups || [],
      rules: source.rules || BUILTIN_RULES,
    };
  }

  function classifyTab(tab, context) {
    const current = readContext(context);
    const state = {
      groups: current.groups,
      assignments: current.assignments,
      disabledBuiltinKeys: current.disabledBuiltinKeys,
    };
    const key = normalizeAssignmentUrl(tab && tab.url);
    if (key && state.assignments[key] && groupIsActive(state, state.assignments[key])) {
      return { groupId: state.assignments[key], source: 'manual' };
    }

    const disabled = new Set(state.disabledBuiltinKeys);
    for (const kind of ['host', 'host-title', 'title']) {
      const best = pickBest(current.rules.filter(rule => rule.kind === kind), tab || {});
      if (!best) continue;
      if (disabled.has(best.rule.category)) break;
      return { groupId: CATEGORY_ID[best.rule.category], source: kind };
    }

    if (isLandingPage(tab && tab.url, current.landingPatterns)) {
      return { groupId: '__landing-pages__', source: 'landing' };
    }
    const custom = matchCustomGroup(tab && tab.url, current.customGroups);
    if (custom) return { groupId: 'custom:' + custom.groupKey, source: 'custom' };
    return { groupId: 'builtin-other', source: 'other' };
  }

  function loadSemanticState(storage, now) {
    const clock = clockOf(now);
    const raw = storage ? storage.semanticGroups : undefined;
    if (raw == null) {
      return { semanticGroups: emptyState(clock), persist: true, writable: true };
    }
    if (typeof raw !== 'object' || Array.isArray(raw) || raw.version !== 1) {
      console.warn('[tab-out] 认不出 semanticGroups 的版本，本次不写回。');
      return { semanticGroups: emptyState(clock), persist: false, writable: false };
    }

    let changed = false;
    const groups = Array.isArray(raw.groups) ? raw.groups.map(group => ({ ...group })) : [];
    if (!Array.isArray(raw.groups)) changed = true;
    const disabled = Array.isArray(raw.disabledBuiltinKeys) ? [...raw.disabledBuiltinKeys] : [];
    if (!Array.isArray(raw.disabledBuiltinKeys)) changed = true;
    const assignments = raw.assignments && typeof raw.assignments === 'object' && !Array.isArray(raw.assignments)
      ? { ...raw.assignments }
      : {};
    if (!raw.assignments || typeof raw.assignments !== 'object' || Array.isArray(raw.assignments)) changed = true;

    for (const def of BUILTINS) {
      if (!groups.some(group => group.id === def.id)) {
        groups.push(builtinRecord(def, clock));
        changed = true;
      }
    }

    const uniqueDisabled = [];
    for (const key of disabled) {
      if (!uniqueDisabled.includes(key)) uniqueDisabled.push(key);
    }
    if (uniqueDisabled.length !== disabled.length) changed = true;

    for (const [url, groupId] of Object.entries(assignments)) {
      const group = groups.find(item => item.id === groupId);
      if (!group || (group.builtinKey && uniqueDisabled.includes(group.builtinKey))) {
        delete assignments[url];
        changed = true;
      }
    }

    return {
      semanticGroups: {
        version: 1,
        groups,
        assignments,
        disabledBuiltinKeys: uniqueDisabled,
      },
      persist: changed,
      writable: true,
    };
  }

  function cleanedName(name) {
    return String(name ?? '').trim();
  }

  function invalidName(name) {
    const length = Array.from(name).length;
    return length < 1 || length > 40;
  }

  function createGroup(state, name, options) {
    const cleaned = cleanedName(name);
    if (invalidName(cleaned)) return { state, error: '分组名称无效' };
    if ((state.groups || []).some(group => group.name === cleaned)) {
      return { state, error: '已经有同名分组' };
    }
    const users = (state.groups || []).filter(group => group.kind === 'user');
    if (users.length >= 30) return { state, error: '分组数量已达上限' };
    const settings = options || {};
    const now = clockOf(settings.now);
    const randomUUID = settings.randomUUID || (() => crypto.randomUUID());
    const order = users.length === 0 ? 11 : Math.max(...users.map(group => group.order)) + 1;
    const stamp = now();
    const next = cloneState(state);
    next.groups.push({
      id: 'user-' + randomUUID(),
      name: cleaned,
      kind: 'user',
      builtinKey: null,
      order,
      createdAt: stamp,
      updatedAt: stamp,
    });
    return { state: next, error: null };
  }

  function renameGroup(state, groupId, name, now) {
    const cleaned = cleanedName(name);
    if (invalidName(cleaned)) return { state, error: '分组名称无效' };
    const current = groupById(state, groupId);
    if (!current) return { state, error: '分组名称无效' };
    if ((state.groups || []).some(group => group.id !== groupId && group.name === cleaned)) {
      return { state, error: '已经有同名分组' };
    }
    if (current.name === cleaned) return { state, error: null };
    const next = cloneState(state);
    const target = groupById(next, groupId);
    target.name = cleaned;
    target.updatedAt = clockOf(now)();
    return { state: next, error: null };
  }

  function deleteGroup(state, groupId) {
    const current = groupById(state, groupId);
    if (!current || current.builtinKey === 'other') {
      return { state, error: null, closedTabIds: [] };
    }
    const next = cloneState(state);
    if (current.kind === 'builtin') {
      if (!next.disabledBuiltinKeys.includes(current.builtinKey)) {
        next.disabledBuiltinKeys.push(current.builtinKey);
      }
    } else {
      next.groups = next.groups.filter(group => group.id !== groupId);
    }
    for (const [url, assigned] of Object.entries(next.assignments)) {
      if (assigned === groupId) delete next.assignments[url];
    }
    return { state: next, error: null, closedTabIds: [] };
  }

  function restoreDefaultGroups(state, now) {
    const next = cloneState(state);
    next.disabledBuiltinKeys = [];
    const clock = clockOf(now);
    for (const def of BUILTINS) {
      if (!next.groups.some(group => group.id === def.id)) {
        next.groups.push(builtinRecord(def, clock));
      }
    }
    return { state: next, error: null };
  }

  function assignUrl(state, rawUrl, groupId) {
    const key = normalizeAssignmentUrl(rawUrl);
    if (!key || !groupIsActive(state, groupId)) return { state, error: '分组没能保存' };
    if (state.assignments && state.assignments[key] === groupId) return { state, error: null };
    const next = cloneState(state);
    next.assignments[key] = groupId;
    return { state: next, error: null };
  }

  function clearAssignment(state, rawUrl) {
    const key = normalizeAssignmentUrl(rawUrl);
    if (!key || !state.assignments || !Object.prototype.hasOwnProperty.call(state.assignments, key)) {
      return { state, error: null };
    }
    const next = cloneState(state);
    delete next.assignments[key];
    return { state: next, error: null };
  }

  function orderedGroupIds(state) {
    const disabled = new Set(state.disabledBuiltinKeys || []);
    const ids = [];
    for (const def of BUILTINS) {
      if (def.builtinKey === 'other') continue;
      if (disabled.has(def.builtinKey)) continue;
      if ((state.groups || []).some(group => group.id === def.id)) ids.push(def.id);
    }
    const users = (state.groups || [])
      .filter(group => group.kind === 'user')
      .slice()
      .sort((a, b) => a.order - b.order);
    for (const group of users) ids.push(group.id);
    if (!disabled.has('other') && (state.groups || []).some(group => group.id === 'builtin-other')) {
      ids.push('builtin-other');
    }
    return ids;
  }

  return {
    DRAG_MIME,
    BUILTIN_RULES,
    BUILTIN_LANDING_PATTERNS,
    escapeHtml,
    normalizeAssignmentUrl,
    classifyTab,
    loadSemanticState,
    createGroup,
    renameGroup,
    deleteGroup,
    restoreDefaultGroups,
    assignUrl,
    clearAssignment,
    orderedGroupIds,
    FIXED_NOW,
  };
});
