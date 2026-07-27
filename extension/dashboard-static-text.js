'use strict';

(function initDashboardStaticText() {
  function createDashboardStaticTextRenderer({
    documentRef = typeof document !== 'undefined' ? document : null,
    getCustomGroupController = () => null,
    t = key => key,
  } = {}) {
    function getElement(id) {
      return documentRef && typeof documentRef.getElementById === 'function'
        ? documentRef.getElementById(id)
        : null;
    }

    function querySelector(selector) {
      return documentRef && typeof documentRef.querySelector === 'function'
        ? documentRef.querySelector(selector)
        : null;
    }

    function setElementTextById(id, text) {
      const element = getElement(id);
      if (element) element.textContent = text;
    }

    function setElementPlaceholderById(id, placeholder) {
      const element = getElement(id);
      if (element) element.setAttribute('placeholder', placeholder);
    }

    function setTextByAction(action, text) {
      const element = querySelector(`[data-action="${action}"]`);
      if (element) element.textContent = text;
    }

    function setTextNodeText(element, text) {
      if (!element || !element.childNodes) return;
      const textNode = Array.from(element.childNodes).find(node => (
        node.nodeType === 3 && node.textContent.trim()
      ));
      if (textNode) textNode.textContent = ` ${text} `;
    }

    function renderBaseText() {
      const staticText = {
        globalSearchInput: {
          ariaLabel: t('aria.search'),
          placeholder: t('placeholder.search'),
        },
        moreMenuPanel: { ariaLabel: t('aria.moreActions') },
        searchSection: null,
        searchCount: null,
        importedSessionTitle: { text: t('section.importedSession') },
        openTabsSectionTitle: { text: t('section.openTabs') },
        laterCount: null,
        laterEmpty: { text: t('state.laterEmpty') },
        statTabs: null,
      };

      const searchHeading = querySelector('#searchSection h2');
      if (searchHeading) searchHeading.textContent = t('section.searchResults');
      const laterHeading = querySelector('#laterColumn h2');
      if (laterHeading) laterHeading.textContent = t('section.laterList');
      const statLabel = querySelector('.stat-label');
      if (statLabel) statLabel.textContent = t('footer.openTabs');

      setTextNodeText(getElement('moreMenuToggle'), t('menu.more'));
      setTextNodeText(getElement('archiveToggle'), t('common.archive'));

      setTextByAction('clear-later-list', t('action.clearAll'));
      setTextByAction('clear-later-archive', t('action.clear'));
      setTextByAction('close-tabout-dupes', t('action.closeExtras'));
      setTextByAction('export-imported-session', t('action.exportAll'));
      setTextByAction('restore-imported-session', t('action.restoreHere'));
      setTextByAction('restore-imported-session-original', t('action.restoreOriginalWindow'));
      setTextByAction('clear-imported-session', t('action.clear'));
      setTextByAction('manual-refresh', t('action.refresh'));
      setTextByAction('trigger-import-session', t('action.importFile'));
      setTextByAction('export-all-groups', t('action.exportAll'));
      setTextByAction('open-custom-groups', t('menu.customGroups'));

      for (const [id, config] of Object.entries(staticText)) {
        if (!config) continue;
        const element = getElement(id);
        if (!element) continue;
        if (config.text) element.textContent = config.text;
        if (config.placeholder) element.setAttribute('placeholder', config.placeholder);
        if (config.ariaLabel) element.setAttribute('aria-label', config.ariaLabel);
      }
    }

    function renderCustomGroupText() {
      setElementTextById('customGroupTitle', t('customGroups.title'));
      setElementTextById('customGroupDescription', t('customGroups.description'));
      setElementTextById('customGroupEnabledLabel', t('customGroups.enabled'));
      setElementTextById('customGroupLabelLabel', t('customGroups.groupLabel'));
      setElementTextById('customGroupKeyLabel', t('customGroups.groupKey'));
      setElementTextById('customGroupHostnameLabel', t('customGroups.hostname'));
      setElementTextById('customGroupHostnameEndsWithLabel', t('customGroups.hostnameEndsWith'));
      setElementTextById('customGroupPathPrefixLabel', t('customGroups.pathPrefix'));
      setElementTextById('customGroupResetButton', t('action.reset'));
      setElementTextById('customGroupImportButton', t('action.importRules'));
      setElementTextById('customGroupExportButton', t('action.exportRules'));

      setElementPlaceholderById('customGroupLabel', t('customGroups.placeholder.groupLabel'));
      setElementPlaceholderById('customGroupKey', t('customGroups.placeholder.groupKey'));
      setElementPlaceholderById('customGroupHostname', t('customGroups.placeholder.hostname'));
      setElementPlaceholderById('customGroupHostnameEndsWith', t('customGroups.placeholder.hostnameEndsWith'));
      setElementPlaceholderById('customGroupPathPrefix', t('customGroups.placeholder.pathPrefix'));

      const customGroupSaveButton = getElement('customGroupSaveButton');
      const customGroupRuleId = getElement('customGroupRuleId');
      if (customGroupSaveButton) {
        customGroupSaveButton.textContent = customGroupRuleId && customGroupRuleId.value
          ? t('action.saveRule')
          : t('action.addRule');
      }

      const customGroupCloseButton = querySelector('[data-action="close-custom-groups"]');
      if (customGroupCloseButton) customGroupCloseButton.setAttribute('aria-label', t('customGroups.close'));

      const customGroupController = getCustomGroupController();
      if (customGroupController && typeof customGroupController.renderPanel === 'function') {
        customGroupController.renderPanel();
      }
    }

    function renderStaticText() {
      renderBaseText();
      renderCustomGroupText();
    }

    return {
      renderStaticText,
    };
  }

  const dashboardStaticText = {
    createDashboardStaticTextRenderer,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = dashboardStaticText;
  }

  if (typeof window !== 'undefined') {
    window.TabOutDashboardStaticText = dashboardStaticText;
  }
})();
