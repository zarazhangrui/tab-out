'use strict';

(function initCustomGroupController() {
  function createCustomGroupController({
    buildSessionFilename,
    createStableId,
    documentRef = typeof document !== 'undefined' ? document : null,
    escapeHtml,
    getCustomGroupRules,
    setCustomGroupRules,
    setStorageValue,
    closeMoreMenu = () => {},
    downloadJsonFile = () => {},
    scheduleDashboardAndWait = async () => {},
    showToast = () => {},
    t = key => key,
  }) {
    function getElement(id) {
      return documentRef && typeof documentRef.getElementById === 'function'
        ? documentRef.getElementById(id)
        : null;
    }

    function safeEscape(value) {
      return typeof escapeHtml === 'function'
        ? escapeHtml(value)
        : String(value || '');
    }

    function getRules() {
      return Array.isArray(getCustomGroupRules && getCustomGroupRules())
        ? getCustomGroupRules()
        : [];
    }

    function normalizeHostname(value) {
      return String(value || '').trim().toLowerCase();
    }

    function normalizePathPrefix(value) {
      const trimmed = String(value || '').trim();
      if (!trimmed) return '';
      return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
    }

    function normalizeGroupKey(value) {
      return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '');
    }

    function normalizeRule(rule) {
      if (!rule || typeof rule !== 'object') return null;
      const groupLabel = String(rule.groupLabel || '').trim();
      const groupKey = normalizeGroupKey(rule.groupKey || groupLabel);
      const hostname = normalizeHostname(rule.hostname);
      const hostnameEndsWith = normalizeHostname(rule.hostnameEndsWith);
      if (!groupLabel || !groupKey || (!hostname && !hostnameEndsWith)) {
        return null;
      }

      return {
        id: String(rule.id || '').trim() || createStableId('custom-group'),
        enabled: rule.enabled !== false,
        groupKey,
        groupLabel,
        hostname,
        hostnameEndsWith,
        pathPrefix: normalizePathPrefix(rule.pathPrefix),
      };
    }

    function createUniqueRuleId(baseId, existingIds) {
      const fallbackId = createStableId('custom-group');
      const safeBaseId = String(baseId || fallbackId).trim() || fallbackId;
      if (!existingIds.has(safeBaseId)) {
        existingIds.add(safeBaseId);
        return safeBaseId;
      }

      let suffix = 2;
      let nextId = `${safeBaseId}-${suffix}`;
      while (existingIds.has(nextId)) {
        suffix += 1;
        nextId = `${safeBaseId}-${suffix}`;
      }
      existingIds.add(nextId);
      return nextId;
    }

    function getFormRule() {
      const idEl = getElement('customGroupRuleId');
      const enabledEl = getElement('customGroupEnabled');
      const labelEl = getElement('customGroupLabel');
      const keyEl = getElement('customGroupKey');
      const hostnameEl = getElement('customGroupHostname');
      const suffixEl = getElement('customGroupHostnameEndsWith');
      const pathEl = getElement('customGroupPathPrefix');
      const groupLabel = String(labelEl && labelEl.value || '').trim();
      const groupKey = normalizeGroupKey(keyEl && keyEl.value || groupLabel);
      const hostname = normalizeHostname(hostnameEl && hostnameEl.value);
      const hostnameEndsWith = normalizeHostname(suffixEl && suffixEl.value);

      return normalizeRule({
        id: String(idEl && idEl.value || '').trim() || createStableId('custom-group'),
        enabled: !enabledEl || enabledEl.checked !== false,
        groupKey,
        groupLabel,
        hostname,
        hostnameEndsWith,
        pathPrefix: normalizePathPrefix(pathEl && pathEl.value),
      });
    }

    function setFormRule(rule) {
      const safeRule = rule || {};
      const idEl = getElement('customGroupRuleId');
      const enabledEl = getElement('customGroupEnabled');
      const labelEl = getElement('customGroupLabel');
      const keyEl = getElement('customGroupKey');
      const hostnameEl = getElement('customGroupHostname');
      const suffixEl = getElement('customGroupHostnameEndsWith');
      const pathEl = getElement('customGroupPathPrefix');
      const saveButton = getElement('customGroupSaveButton');

      if (idEl) idEl.value = safeRule.id || '';
      if (enabledEl) enabledEl.checked = safeRule.enabled !== false;
      if (labelEl) labelEl.value = safeRule.groupLabel || '';
      if (keyEl) keyEl.value = safeRule.groupKey || '';
      if (hostnameEl) hostnameEl.value = safeRule.hostname || '';
      if (suffixEl) suffixEl.value = safeRule.hostnameEndsWith || '';
      if (pathEl) pathEl.value = safeRule.pathPrefix || '';
      if (saveButton) saveButton.textContent = safeRule.id ? t('action.saveRule') : t('action.addRule');
    }

    function resetForm() {
      const form = getElement('customGroupForm');
      if (form && typeof form.reset === 'function') {
        form.reset();
      }
      setFormRule({ enabled: true });
    }

    function buildRuleSummary(rule) {
      const host = rule.hostname || rule.hostnameEndsWith || '';
      return t('customGroups.rulePattern', {
        host,
        path: rule.pathPrefix || '',
      });
    }

    function renderRuleList() {
      const listEl = getElement('customGroupRuleList');
      const emptyEl = getElement('customGroupEmpty');
      if (!listEl || !emptyEl) return;

      const rules = getRules();
      if (rules.length === 0) {
        listEl.innerHTML = '';
        emptyEl.textContent = t('customGroups.empty');
        emptyEl.style.display = 'block';
        return;
      }

      emptyEl.style.display = 'none';
      listEl.innerHTML = rules.map(rule => {
        const scopeLabel = rule.hostname
          ? t('customGroups.scope.exact')
          : t('customGroups.scope.suffix');
        const enabledLabel = rule.enabled === false
          ? t('customGroups.disabled')
          : t('customGroups.enabled');

        return `
          <div class="custom-group-rule" data-rule-id="${safeEscape(rule.id)}">
            <div class="custom-group-rule-main">
              <div class="custom-group-rule-title">
                <span>${safeEscape(rule.groupLabel)}</span>
                <span class="custom-group-rule-state">${safeEscape(enabledLabel)}</span>
              </div>
              <div class="custom-group-rule-meta">
                <span>${safeEscape(scopeLabel)}</span>
                <span>${safeEscape(buildRuleSummary(rule))}</span>
                <span>${safeEscape(rule.groupKey)}</span>
              </div>
            </div>
            <div class="custom-group-rule-actions">
              <button class="action-btn compact" data-action="edit-custom-group-rule" data-rule-id="${safeEscape(rule.id)}">${safeEscape(t('action.edit'))}</button>
              <button class="action-btn compact close-tabs" data-action="delete-custom-group-rule" data-rule-id="${safeEscape(rule.id)}">${safeEscape(t('action.remove'))}</button>
            </div>
          </div>`;
      }).join('');
    }

    function renderPanel() {
      const panel = getElement('customGroupPanel');
      if (!panel) return;
      renderRuleList();
    }

    function openPanel() {
      const panel = getElement('customGroupPanel');
      closeMoreMenu();
      resetForm();
      renderPanel();
      if (panel) {
        panel.style.display = 'block';
        if (panel.classList && typeof panel.classList.remove === 'function') {
          panel.classList.remove('hidden-by-default');
        }
        if (panel.classList && typeof panel.classList.toggle === 'function') {
          panel.classList.toggle('open', true);
        }
      }
      const labelEl = getElement('customGroupLabel');
      if (labelEl && typeof labelEl.focus === 'function') {
        labelEl.focus();
      }
    }

    function closePanel() {
      const panel = getElement('customGroupPanel');
      if (!panel) return;
      panel.style.display = 'none';
      if (panel.classList && typeof panel.classList.toggle === 'function') {
        panel.classList.toggle('open', false);
      }
      if (panel.classList && typeof panel.classList.add === 'function') {
        panel.classList.add('hidden-by-default');
      }
    }

    async function persistRules(rules) {
      const safeRules = Array.isArray(rules) ? rules : [];
      setCustomGroupRules(safeRules);
      await setStorageValue('customGroupRules', safeRules);
      renderRuleList();
      await scheduleDashboardAndWait();
    }

    async function saveRule() {
      const rule = getFormRule();
      if (!rule) {
        showToast(t('toast.customGroupInvalid'));
        return false;
      }

      const rules = getRules();
      const existingIndex = rules.findIndex(item => item.id === rule.id);
      const nextRules = existingIndex >= 0
        ? rules.map(item => (item.id === rule.id ? rule : item))
        : [...rules, rule];

      await persistRules(nextRules);
      resetForm();
      showToast(t('toast.customGroupSaved'));
      return true;
    }

    function editRule(ruleId) {
      const rule = getRules().find(item => item.id === ruleId);
      if (!rule) return false;
      setFormRule(rule);
      const labelEl = getElement('customGroupLabel');
      if (labelEl && typeof labelEl.focus === 'function') {
        labelEl.focus();
      }
      return true;
    }

    async function deleteRule(ruleId) {
      if (!ruleId) return false;
      const nextRules = getRules().filter(rule => rule.id !== ruleId);
      await persistRules(nextRules);
      resetForm();
      showToast(t('toast.customGroupDeleted'));
      return true;
    }

    function buildExportFilename() {
      return typeof buildSessionFilename === 'function'
        ? buildSessionFilename('grouping-rules')
        : 'tab-out-grouping-rules.json';
    }

    function exportRules() {
      const rules = getRules();
      if (rules.length === 0) {
        showToast(t('toast.customGroupExportEmpty'));
        return false;
      }

      downloadJsonFile(buildExportFilename(), {
        version: 1,
        source: 'tab-out',
        type: 'custom-group-rules',
        rules,
      });
      showToast(t('toast.customGroupExported', { count: rules.length }));
      return true;
    }

    function parseImportedRules(text) {
      const payload = JSON.parse(text);
      const sourceRules = Array.isArray(payload)
        ? payload
        : payload && typeof payload === 'object' && Array.isArray(payload.rules)
          ? payload.rules
          : null;
      if (!sourceRules) {
        throw new Error('Invalid grouping rule file');
      }
      return sourceRules.map(normalizeRule).filter(Boolean);
    }

    async function importRulesFromFiles(files) {
      const safeFiles = Array.isArray(files) ? files : [];
      if (safeFiles.length === 0) return 0;

      try {
        const existingRules = getRules();
        const existingIds = new Set(existingRules.map(rule => rule.id));
        const importedRules = [];

        for (const file of safeFiles) {
          const text = await file.text();
          for (const rule of parseImportedRules(text)) {
            importedRules.push({
              ...rule,
              id: createUniqueRuleId(rule.id, existingIds),
            });
          }
        }

        if (importedRules.length === 0) {
          throw new Error('No valid grouping rules');
        }

        await persistRules([...existingRules, ...importedRules]);
        showToast(t('toast.customGroupImported', { count: importedRules.length }));
        return importedRules.length;
      } catch {
        showToast(t('toast.customGroupImportFailed'));
        return 0;
      }
    }

    return {
      closePanel,
      deleteRule,
      editRule,
      exportRules,
      importRulesFromFiles,
      openPanel,
      renderPanel,
      renderRuleList,
      resetForm,
      saveRule,
    };
  }

  const customGroupController = {
    createCustomGroupController,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = customGroupController;
  }

  if (typeof window !== 'undefined') {
    window.TabOutCustomGroupController = customGroupController;
  }
})();
