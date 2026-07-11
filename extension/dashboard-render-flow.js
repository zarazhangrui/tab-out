'use strict';

(function initDashboardRenderFlow() {
  function createDashboardRenderFlow({
    fetchOpenTabs,
    getDateDisplay,
    getGreeting,
    getImportedSession,
    getSearchQuery,
    renderAutoRefreshToggle,
    renderLanguageToggle,
    renderThemeToggle,
    renderImportedSessionSection,
    renderLaterListColumn,
    renderMoreMenu,
    renderOpenTabsSectionFromState,
    renderSearchResults,
    renderStaticText = () => {},
  }) {
    async function renderStaticDashboard(renderCtx = {}) {
      const { isStale = () => false } = renderCtx;
      if (isStale()) return false;

      const greetingEl = document.getElementById('greeting');
      const dateEl = document.getElementById('dateDisplay');
      const searchInput = document.getElementById('globalSearchInput');
      if (greetingEl) greetingEl.textContent = getGreeting();
      if (dateEl) dateEl.textContent = getDateDisplay();
      const searchQuery = getSearchQuery();
      if (searchInput && searchInput.value !== searchQuery) searchInput.value = searchQuery;
      renderStaticText();
      renderAutoRefreshToggle();
      renderLanguageToggle();
      renderThemeToggle();
      renderMoreMenu();

      await fetchOpenTabs();
      if (isStale()) return false;
      renderOpenTabsSectionFromState({ includeImportedSection: false });

      await getImportedSession();
      if (isStale()) return false;
      renderImportedSessionSection();

      await renderLaterListColumn();
      if (isStale()) return false;

      await renderSearchResults(renderCtx);
      if (isStale()) return false;
      return true;
    }

    return {
      renderStaticDashboard,
    };
  }

  const dashboardRenderFlow = {
    createDashboardRenderFlow,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = dashboardRenderFlow;
  }

  if (typeof window !== 'undefined') {
    window.TabOutDashboardRenderFlow = dashboardRenderFlow;
  }
})();
