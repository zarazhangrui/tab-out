'use strict';

(function initDashboardHeaderUi() {
  function createDashboardHeaderUi({
    getAutoRefreshEnabled,
    getMoreMenuOpen,
  }) {
    function renderAutoRefreshToggle() {
      const toggle = document.getElementById('autoRefreshToggle');
      if (!toggle) return;

      const autoRefreshEnabled = !!getAutoRefreshEnabled();
      toggle.textContent = `Auto refresh: ${autoRefreshEnabled ? 'On' : 'Off'}`;
      toggle.classList.toggle('save-tabs', autoRefreshEnabled);
      toggle.classList.toggle('danger', !autoRefreshEnabled);
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
      focusMoreMenuItem,
      getMoreMenuItems,
      renderAutoRefreshToggle,
      renderMoreMenu,
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
