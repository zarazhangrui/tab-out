'use strict';

(function initDashboardEventBindings() {
  function createDashboardEventBindings({
    buildFaviconPlaceholder,
    closeMoreMenu,
    focusMoreMenuItem,
    getActionHandlers,
    getMoreMenuItems,
    getSearchDebounceMs = () => 120,
    getStateSnapshot,
    handleImportSessionFiles,
    renderMoreMenu,
    scheduleDashboardRender,
    scheduleSearchRender,
    setMoreMenuOpen,
    setSearchQuery,
    showToast,
    t = key => key,
  }) {
    function bind(documentRef) {
      if (!documentRef || typeof documentRef.addEventListener !== 'function') {
        return;
      }

      documentRef.addEventListener('error', event => {
        const target = event.target;
        if (!target || !target.dataset || !target.dataset.faviconDomain) return;
        if (typeof buildFaviconPlaceholder !== 'function') return;

        const wrapper = documentRef.createElement
          ? documentRef.createElement('span')
          : null;
        if (!wrapper) return;

        wrapper.innerHTML = buildFaviconPlaceholder(
          target.dataset.faviconDomain,
          target.dataset.faviconClass || target.className || 'chip-favicon'
        );
        const placeholder = wrapper.firstElementChild;
        if (placeholder && typeof target.replaceWith === 'function') {
          target.replaceWith(placeholder);
        }
      }, true);

      documentRef.addEventListener('click', async event => {
        const actionEl = event.target.closest('[data-action]');
        if (actionEl) {
          const action = actionEl.dataset.action;
          const handler = getActionHandlers()[action];
          if (!handler) return;
          try {
            await handler({
              action,
              actionEl,
              event,
              snapshot: getStateSnapshot(),
            });
          } catch (err) {
            console.error(`[tab-out] Action failed: ${action}`, err);
            showToast(t('toast.actionFailed'));
            scheduleDashboardRender();
          }
          return;
        }

        if (!event.target.closest('#moreMenu')) {
          closeMoreMenu();
        }

        const toggle = event.target.closest('#archiveToggle');
        if (!toggle) return;

        toggle.classList.toggle('open');
        const body = documentRef.getElementById('archiveBody');
        if (body) {
          body.style.display = body.style.display === 'none' ? 'block' : 'none';
        }
      });

      documentRef.addEventListener('change', async event => {
        if (event.target.id === 'customGroupImportInput') {
          const files = Array.from(event.target.files || []);
          if (files.length === 0) return;

          const handler = getActionHandlers()['import-custom-group-rules'];
          if (typeof handler !== 'function') return;

          try {
            await handler({
              action: 'import-custom-group-rules',
              actionEl: event.target,
              event,
              snapshot: getStateSnapshot(),
            });
          } catch (err) {
            console.error('[tab-out] Failed to import custom grouping rules:', err);
            showToast(t('toast.customGroupImportFailed'));
            scheduleDashboardRender();
          } finally {
            event.target.value = '';
          }
          return;
        }

        if (event.target.id !== 'sessionImportInput') return;

        const files = Array.from(event.target.files || []);
        if (files.length === 0) return;

        try {
          await handleImportSessionFiles(files);
        } catch (err) {
          console.error('[tab-out] Failed to import session:', err);
          showToast(err && err.message ? err.message : 'Import failed');
        } finally {
          event.target.value = '';
        }
      });

      documentRef.addEventListener('input', event => {
        if (event.target.id !== 'globalSearchInput') return;
        setSearchQuery(event.target.value || '');
        clearTimeout(bind.searchDebounceTimer);
        bind.searchDebounceTimer = setTimeout(() => {
          scheduleSearchRender();
        }, getSearchDebounceMs());
      });

      documentRef.addEventListener('submit', async event => {
        if (!event.target || event.target.id !== 'customGroupForm') return;
        event.preventDefault();
        const handler = getActionHandlers()['save-custom-group-rule'];
        if (typeof handler !== 'function') return;
        try {
          await handler({
            action: 'save-custom-group-rule',
            actionEl: event.target,
            event,
            snapshot: getStateSnapshot(),
          });
        } catch (err) {
          console.error('[tab-out] Failed to save custom grouping rule:', err);
          showToast(t('toast.actionFailed'));
          scheduleDashboardRender();
        }
      });

      documentRef.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
          const customGroupPanel = documentRef.getElementById('customGroupPanel');
          const customGroupPanelOpen = !!(
            customGroupPanel &&
            (
              (customGroupPanel.classList && typeof customGroupPanel.classList.contains === 'function' && customGroupPanel.classList.contains('open')) ||
              (customGroupPanel.style && customGroupPanel.style.display === 'block')
            )
          );
          if (customGroupPanelOpen) {
            const handler = getActionHandlers()['close-custom-groups'];
            if (typeof handler === 'function') {
              handler({
                action: 'close-custom-groups',
                actionEl: customGroupPanel,
                event,
                snapshot: getStateSnapshot(),
              });
              return;
            }
          }
          closeMoreMenu({ restoreFocus: true });
          return;
        }

        const isToggle = event.target && event.target.id === 'moreMenuToggle';
        const isMenuItem = !!(event.target && event.target.closest && event.target.closest('#moreMenuPanel .more-menu-item'));

        if (!isToggle && !isMenuItem) return;

        if (isToggle && (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          setMoreMenuOpen(true);
          renderMoreMenu();
          setTimeout(() => focusMoreMenuItem(0), 0);
          return;
        }

        if (!isMenuItem) return;

        const items = getMoreMenuItems();
        const currentIndex = items.indexOf(event.target);
        if (currentIndex === -1) return;

        if (event.key === 'ArrowDown') {
          event.preventDefault();
          focusMoreMenuItem((currentIndex + 1) % items.length);
          return;
        }

        if (event.key === 'ArrowUp') {
          event.preventDefault();
          focusMoreMenuItem((currentIndex - 1 + items.length) % items.length);
        }
      });
    }

    return {
      bind,
    };
  }

  const dashboardEventBindings = {
    createDashboardEventBindings,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = dashboardEventBindings;
  }

  if (typeof window !== 'undefined') {
    window.TabOutDashboardEventBindings = dashboardEventBindings;
  }
})();
