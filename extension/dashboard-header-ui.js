'use strict';

(function initDashboardHeaderUi() {
  function createDashboardHeaderUi({
    getAutoRefreshEnabled,
    getLanguagePreference = () => 'en',
    getMoreMenuOpen,
    getSearchScope = () => 'all',
    getTabMovingEnabled = () => false,
    getThemePreference = () => 'system',
    getNextLanguage = language => (language === 'zh' ? 'en' : 'zh'),
    t = key => key,
  }) {
    const THEME_LABELS = {
      system: 'System',
      light: 'Light',
      dark: 'Dark',
    };
    const VALID_THEME_PREFERENCES = new Set(Object.keys(THEME_LABELS));
    const VALID_SEARCH_SCOPES = new Set(['all', 'open', 'later', 'imported']);

    function normalizeThemePreference(preference) {
      return VALID_THEME_PREFERENCES.has(preference) ? preference : 'system';
    }

    function normalizeSearchScope(scope) {
      return VALID_SEARCH_SCOPES.has(scope) ? scope : 'all';
    }

    function getSystemTheme() {
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
        return 'light';
      }
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }

    function getAppliedTheme(preference = getThemePreference()) {
      const normalized = normalizeThemePreference(preference);
      return normalized === 'system' ? getSystemTheme() : normalized;
    }

    function getNextThemePreference(preference = getThemePreference()) {
      const normalized = normalizeThemePreference(preference);
      if (normalized === 'system') return 'light';
      if (normalized === 'light') return 'dark';
      return 'system';
    }

    function applyThemePreference(preference = getThemePreference()) {
      const root = typeof document !== 'undefined' ? document.documentElement : null;
      if (!root || !root.dataset) return;

      const normalized = normalizeThemePreference(preference);
      root.dataset.themePreference = normalized;
      if (normalized === 'system') {
        delete root.dataset.theme;
        if (root.style) root.style.colorScheme = 'light dark';
        return;
      }

      root.dataset.theme = normalized;
      if (root.style) root.style.colorScheme = normalized;
    }

    function renderAutoRefreshToggle() {
      const toggle = document.getElementById('autoRefreshToggle');
      if (!toggle) return;

      const autoRefreshEnabled = !!getAutoRefreshEnabled();
      toggle.textContent = t('menu.autoRefresh', {
        state: t(autoRefreshEnabled ? 'menu.on' : 'menu.off'),
      });
      toggle.classList.toggle('save-tabs', autoRefreshEnabled);
      toggle.classList.toggle('danger', !autoRefreshEnabled);
    }

    function renderThemeToggle() {
      applyThemePreference();

      const toggle = document.getElementById('themeToggle');
      if (!toggle) return;

      const preference = normalizeThemePreference(getThemePreference());
      const label = t(`menu.theme.${preference}`);
      toggle.textContent = t('menu.theme', { theme: label });
      toggle.classList.toggle('save-tabs', false);
      toggle.classList.toggle('danger', false);
      toggle.setAttribute(
        'aria-label',
        preference === 'system'
          ? `${t('menu.theme', { theme: label })}. Currently following your browser theme.`
          : `${t('menu.theme', { theme: label })}.`
      );
    }

    function renderLanguageToggle() {
      const toggle = document.getElementById('languageToggle');
      if (!toggle) return;

      const language = getLanguagePreference() === 'zh' ? 'zh' : 'en';
      const nextLanguage = getNextLanguage(language);
      const languageLabel = t(`language.${language}`);
      const nextLanguageLabel = t(`language.${nextLanguage}`);
      toggle.textContent = t('menu.language', { language: languageLabel });
      toggle.classList.toggle('save-tabs', false);
      toggle.classList.toggle('danger', false);
      toggle.setAttribute('aria-label', `${t('menu.language', { language: languageLabel })}. Switch to ${nextLanguageLabel}.`);
    }

    function renderTabMovingToggle() {
      const toggle = document.getElementById('tabMovingToggle');
      if (!toggle) return;

      const tabMovingEnabled = !!getTabMovingEnabled();
      toggle.textContent = t('menu.tabMoving', {
        state: t(tabMovingEnabled ? 'menu.on' : 'menu.off'),
      });
      toggle.classList.toggle('save-tabs', tabMovingEnabled);
      toggle.classList.toggle('danger', !tabMovingEnabled);
      toggle.setAttribute(
        'aria-label',
        `Advanced tab moving ${tabMovingEnabled ? 'enabled' : 'disabled'}.`
      );
    }

    function renderSearchScopeToggle() {
      const scope = normalizeSearchScope(getSearchScope());
      const inputs = Array.from(document.querySelectorAll('[name="searchScope"]'));

      for (const input of inputs) {
        const selected = input.value === scope;
        input.checked = selected;
        if (typeof input.setAttribute === 'function') {
          input.setAttribute('aria-checked', selected ? 'true' : 'false');
        }
      }
    }

    function renderMoreMenu() {
      const menu = document.getElementById('moreMenu');
      const toggle = document.getElementById('moreMenuToggle');
      const panel = document.getElementById('moreMenuPanel');
      if (!menu || !toggle || !panel) return;

      const moreMenuOpen = !!getMoreMenuOpen();
      menu.classList.toggle('open', moreMenuOpen);
      toggle.setAttribute('aria-expanded', moreMenuOpen ? 'true' : 'false');
      panel.style.display = moreMenuOpen ? 'flex' : 'none';
    }

    function getMoreMenuItems() {
      return Array.from(document.querySelectorAll('#moreMenuPanel .more-menu-item'));
    }

    function focusMoreMenuItem(index) {
      const items = getMoreMenuItems();
      if (items.length === 0) return;
      const safeIndex = Math.max(0, Math.min(index, items.length - 1));
      items[safeIndex].focus();
    }

    return {
      applyThemePreference,
      focusMoreMenuItem,
      getAppliedTheme,
      getMoreMenuItems,
      getNextThemePreference,
      renderAutoRefreshToggle,
      renderLanguageToggle,
      renderMoreMenu,
      renderSearchScopeToggle,
      renderTabMovingToggle,
      renderThemeToggle,
    };
  }

  const dashboardHeaderUi = {
    createDashboardHeaderUi,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = dashboardHeaderUi;
  }

  if (typeof window !== 'undefined') {
    window.TabOutDashboardHeaderUi = dashboardHeaderUi;
  }
})();
