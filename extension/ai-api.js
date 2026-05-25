window.__aiDebug = [];

async function fetchGroupingSuggestions(tabs, settings, externalSignal, existingGroups) {
  const startTime = Date.now();
  const tabList = tabs.map((t, i) => `${i + 1}. ${t.title} - ${t.url}${t.description ? ' | ' + t.description : ''}`).join('\n');
  let existingInfo = '';
  if (existingGroups && existingGroups.length > 0) {
    existingInfo = '\n\nAlready grouped (DO NOT suggest these again):\n' + existingGroups.map(g => `- "${g.groupLabel}": ${g.rule.hostnames.join(', ')}`).join('\n');
  }
  const messages = [
    {
      role: 'system',
      content: 'You are a browser tab organizer. Analyze the user\'s open tabs and find groups of 2+ tabs that share a common research topic or task. Also suggest better display names for domain groups that have 2+ tabs. Also identify tabs that look stale or unnecessary. Return ONLY valid JSON, no markdown.'
    },
    {
      role: 'user',
      content: `Here are my open tabs:\n${tabList}${existingInfo}\n\nReturn JSON with:\n1. "suggestions": [{"label": "短标签", "tab_indices": [1,2,3], "reasoning": "为什么这些标签相关"}] — 1-3 groups of 2+ related tabs\n2. "renames": [{"original_domain": "hostname", "suggested_name": "短名称"}] — friendlier names for domain groups\n3. "close_suggestions": [{"tab_indices": [4,7], "reasoning": "为什么这些标签可以关闭"}] — tabs that look like one-time lookups or completed tasks`
    }
  ];

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    if (externalSignal) externalSignal.addEventListener('abort', () => controller.abort());

    let response;
    try {
      response = await fetch(`${settings.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${settings.apiKey}`,
          'Content-Type': 'application/json'
        },
        signal: controller.signal,
        body: JSON.stringify({ model: settings.model, messages })
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      window.__aiDebug.push({ timestamp: Date.now(), type: 'grouping', prompt: messages, response: `HTTP ${response.status}`, parsed: null, duration: Date.now() - startTime });
      return { suggestions: [], renames: [], closeSuggestions: [] };
    }

    const data = await response.json();
    const content = data.choices[0].message.content;
    const parsed = JSON.parse(content.replace(/```json\s*|```\s*/g, '').trim());

    if (!Array.isArray(parsed.suggestions)) {
      window.__aiDebug.push({ timestamp: Date.now(), type: 'grouping', prompt: messages, response: content, parsed: null, duration: Date.now() - startTime });
      return { suggestions: [], renames: [], closeSuggestions: [] };
    }

    const results = [];
    for (const item of parsed.suggestions) {
      if (typeof item.label !== 'string' || !Array.isArray(item.tab_indices) || !item.tab_indices.every(i => typeof i === 'number' && i >= 1 && i <= tabs.length) || typeof item.reasoning !== 'string') continue;
      results.push({ groupLabel: item.label, tabIndices: item.tab_indices, reasoning: item.reasoning });
    }

    const validatedRenames = [];
    if (Array.isArray(parsed.renames)) {
      for (const r of parsed.renames) {
        if (typeof r.original_domain === 'string' && typeof r.suggested_name === 'string') validatedRenames.push(r);
      }
    }

    const validatedClose = [];
    if (Array.isArray(parsed.close_suggestions)) {
      for (const c of parsed.close_suggestions) {
        if (Array.isArray(c.tab_indices) && c.tab_indices.every(i => typeof i === 'number' && i >= 1 && i <= tabs.length) && typeof c.reasoning === 'string') {
          validatedClose.push({ tabIndices: c.tab_indices, reasoning: c.reasoning });
        }
      }
    }

    const result = { suggestions: results, renames: validatedRenames, closeSuggestions: validatedClose };
    window.__aiDebug.push({ timestamp: Date.now(), type: 'grouping', prompt: messages, response: content, parsed: result, duration: Date.now() - startTime });
    return result;
  } catch (e) {
    window.__aiDebug.push({ timestamp: Date.now(), type: 'grouping', prompt: messages, response: e.message, parsed: null, duration: Date.now() - startTime });
    return { suggestions: [], renames: [], closeSuggestions: [] };
  }
}

async function fetchTabSearch(query, tabs, historyItems, settings, externalSignal) {
  const startTime = Date.now();
  const allItems = [];
  tabs.forEach((t, i) => allItems.push(`${allItems.length + 1}. [OPEN] ${t.title} - ${t.url}`));
  historyItems.forEach((h, i) => allItems.push(`${allItems.length + 1}. [HISTORY] ${h.title} - ${h.url}`));

  const messages = [
    { role: 'system', content: 'You find browser tabs/pages matching a user description. Rank by relevance. Return ONLY valid JSON, no markdown.' },
    { role: 'user', content: `Items:\n${allItems.join('\n')}\n\nFind items matching: "${query}"\nReturn: {"matches": [3, 1, 7]}  (indices ranked by relevance, best first)` }
  ];

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    if (externalSignal) externalSignal.addEventListener('abort', () => controller.abort());

    let response;
    try {
      response = await fetch(`${settings.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${settings.apiKey}`,
          'Content-Type': 'application/json'
        },
        signal: controller.signal,
        body: JSON.stringify({ model: settings.model, messages })
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      window.__aiDebug.push({ timestamp: Date.now(), type: 'search', query, prompt: messages, response: `HTTP ${response.status}`, parsed: null, duration: Date.now() - startTime });
      return { openMatches: [], historyMatches: [] };
    }
    const data = await response.json();
    const content = data.choices[0].message.content;
    const parsed = JSON.parse(content.replace(/```json\s*|```\s*/g, '').trim());
    if (!Array.isArray(parsed.matches)) {
      window.__aiDebug.push({ timestamp: Date.now(), type: 'search', query, prompt: messages, response: content, parsed: null, duration: Date.now() - startTime });
      return { openMatches: [], historyMatches: [] };
    }
    const valid = parsed.matches.filter(i => typeof i === 'number' && i >= 1 && i <= allItems.length);
    const openCount = tabs.length;
    const openMatches = valid.filter(i => i <= openCount);
    const historyMatches = valid.filter(i => i > openCount).map(i => i - openCount);
    window.__aiDebug.push({ timestamp: Date.now(), type: 'search', query, prompt: messages, response: content, parsed: { openMatches, historyMatches }, duration: Date.now() - startTime });
    return { openMatches, historyMatches };
  } catch (e) {
    window.__aiDebug.push({ timestamp: Date.now(), type: 'search', query, prompt: messages, response: e.message, parsed: null, duration: Date.now() - startTime });
    return { openMatches: [], historyMatches: [] };
  }
}
