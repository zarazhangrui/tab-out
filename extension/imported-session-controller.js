'use strict';

(function initImportedSessionController() {
  function createImportedSessionController({
    getState,
    normalizeImportedSessionData,
    getStorageValue,
    setStorageValue,
    queueStorageUpdate,
  }) {
    async function getImportedSession() {
      const rawImportedSession = await getStorageValue('importedSession');
      const { session, changed } = normalizeImportedSessionData(rawImportedSession);
      getState().importedSession = session;
      if (changed) {
        await setStorageValue('importedSession', session);
      }
      return getState().importedSession;
    }

    async function setImportedSession(session) {
      const { session: normalized } = normalizeImportedSessionData(session);
      getState().importedSession = normalized;
      await queueStorageUpdate('importedSession', () => getState().importedSession);
    }

    async function clearImportedSession() {
      getState().importedSession = null;
      await queueStorageUpdate('importedSession', () => null);
    }

    async function clearImportedSessionGroup(groupId) {
      const { importedSession } = getState();
      if (!importedSession || !Array.isArray(importedSession.groups)) return;

      const nextGroups = importedSession.groups.filter(group => group.id !== groupId);
      if (nextGroups.length === 0) {
        await clearImportedSession();
        return;
      }

      await setImportedSession({
        ...importedSession,
        groups: nextGroups,
      });
    }

    function getImportedGroupById(groupId) {
      const { importedSession } = getState();
      return importedSession && Array.isArray(importedSession.groups)
        ? importedSession.groups.find(group => group.id === groupId) || null
        : null;
    }

    function getImportedSessionTab(groupId, tabId) {
      const group = getImportedGroupById(groupId);
      if (!group || !Array.isArray(group.tabs)) return null;
      const tab = group.tabs.find(item => item && item.id === tabId);
      if (!tab) return null;
      return { group, tab };
    }

    async function clearImportedSessionTab(groupId, tabId) {
      const { importedSession } = getState();
      if (!importedSession || !Array.isArray(importedSession.groups) || !groupId || !tabId) return false;

      const nextGroups = [];
      let changed = false;

      for (const group of importedSession.groups) {
        if (group.id !== groupId) {
          nextGroups.push(group);
          continue;
        }

        const nextTabs = (group.tabs || []).filter(tab => {
          const keep = !(tab && tab.id === tabId);
          if (!keep) changed = true;
          return keep;
        });

        if (nextTabs.length > 0) {
          nextGroups.push({
            ...group,
            tabs: nextTabs,
          });
        }
      }

      if (!changed) return false;

      if (nextGroups.length === 0) {
        await clearImportedSession();
        return true;
      }

      await setImportedSession({
        ...importedSession,
        groups: nextGroups,
      });
      return true;
    }

    return {
      clearImportedSession,
      clearImportedSessionGroup,
      clearImportedSessionTab,
      getImportedGroupById,
      getImportedSession,
      getImportedSessionTab,
      setImportedSession,
    };
  }

  window.TabOutImportedSessionController = {
    createImportedSessionController,
  };
})();
