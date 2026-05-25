function openSettings() {
  let panel = document.getElementById('settingsOverlay');
  if (panel) {
    panel.style.display = 'flex';
    loadSettings();
    return;
  }

  const overlay = document.createElement('div');
  overlay.id = 'settingsOverlay';
  overlay.className = 'settings-overlay';
  overlay.addEventListener('click', function(e) {
    if (e.target === overlay) closeSettings();
  });

  overlay.innerHTML = `
    <div class="settings-panel">
      <h2 class="settings-title">AI Settings</h2>
      <label for="settingsBaseUrl">Base URL</label>
      <input type="text" id="settingsBaseUrl" placeholder="https://api.openai.com/v1">
      <label for="settingsApiKey">API Key</label>
      <input type="password" id="settingsApiKey" placeholder="sk-...">
      <label for="settingsModel">Model</label>
      <input type="text" id="settingsModel" placeholder="gpt-4o">
      <div class="settings-actions">
        <button class="settings-cancel" id="settingsCancelBtn">Cancel</button>
        <button class="settings-save" id="settingsSaveBtn">Save</button>
      </div>
      <label class="settings-debug-label"><input type="checkbox" id="settingsDebug"> Debug Mode</label>
      <label class="settings-debug-label"><input type="checkbox" id="settingsMetaDesc"> Include Meta Description</label>
      <button class="settings-test-ai" id="settingsTestAiBtn">Test AI</button>
      <div class="settings-blacklist-section" id="settingsBlacklistSection">
        <label>已屏蔽的网站（不再出现在 Might open next）</label>
        <div class="blacklist-list" id="settingsBlacklistList"></div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  document.getElementById('settingsCancelBtn').addEventListener('click', closeSettings);
  document.getElementById('settingsSaveBtn').addEventListener('click', saveSettings);
  document.getElementById('settingsTestAiBtn').addEventListener('click', () => {
    closeSettings();
    if (typeof triggerAiSuggestions === 'function') triggerAiSuggestions();
    setTimeout(() => { if (typeof renderDebugPanel === 'function') renderDebugPanel(); }, 500);
  });
  overlay.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action="unblock-freq"]');
    if (!btn) return;
    const host = btn.dataset.host;
    const { frequentBlacklist = [] } = await chrome.storage.local.get('frequentBlacklist');
    const updated = frequentBlacklist.filter(h => h !== host);
    await chrome.storage.local.set({ frequentBlacklist: updated });
    renderBlacklist();
    if (typeof renderFrequentSites === 'function') renderFrequentSites();
    if (typeof showToast === 'function') showToast(`已恢复 ${host}`);
  });
  loadSettings();
}

function closeSettings() {
  const overlay = document.getElementById('settingsOverlay');
  if (overlay) overlay.style.display = 'none';
}

function saveSettings() {
  const baseUrl = document.getElementById('settingsBaseUrl').value.trim();
  const apiKey = document.getElementById('settingsApiKey').value.trim();
  const model = document.getElementById('settingsModel').value.trim();

  chrome.storage.local.set({ ai_settings: { baseUrl, apiKey, model, debug: document.getElementById('settingsDebug').checked, metaDesc: document.getElementById('settingsMetaDesc').checked } }, function() {
    closeSettings();
    if (typeof showToast === 'function') showToast('Settings saved');
    if (document.getElementById('settingsDebug').checked && typeof renderDebugPanel === 'function') renderDebugPanel();
  });
}

function loadSettings() {
  chrome.storage.local.get('ai_settings', function(result) {
    const s = result.ai_settings || {};
    const urlEl = document.getElementById('settingsBaseUrl');
    const keyEl = document.getElementById('settingsApiKey');
    const modelEl = document.getElementById('settingsModel');
    if (urlEl) urlEl.value = s.baseUrl || '';
    if (keyEl) keyEl.value = s.apiKey || '';
    if (modelEl) modelEl.value = s.model || '';
    const debugEl = document.getElementById('settingsDebug');
    if (debugEl) debugEl.checked = !!s.debug;
    const metaDescEl = document.getElementById('settingsMetaDesc');
    if (metaDescEl) metaDescEl.checked = !!s.metaDesc;
  });
  renderBlacklist();
}

async function renderBlacklist() {
  const listEl = document.getElementById('settingsBlacklistList');
  if (!listEl) return;
  const { frequentBlacklist = [] } = await chrome.storage.local.get('frequentBlacklist');
  if (frequentBlacklist.length === 0) {
    listEl.innerHTML = '<div class="blacklist-empty">暂无屏蔽项</div>';
    return;
  }
  listEl.innerHTML = frequentBlacklist.map(host => `<div class="blacklist-item">
    <span class="blacklist-host">${host}</span>
    <button class="blacklist-remove" data-action="unblock-freq" data-host="${host}" title="恢复显示">×</button>
  </div>`).join('');
}

document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('settingsBtn');
  if (btn) btn.addEventListener('click', openSettings);
});
