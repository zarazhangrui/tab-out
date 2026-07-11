'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createDashboardEventBindings,
} = require('./dashboard-event-bindings.js');
const {
  createTestI18n,
} = require('./test-i18n-helper.js');

function createHarness(overrides = {}) {
  const i18n = createTestI18n();
  const calls = {
    closeMoreMenu: [],
    focusMoreMenuItem: [],
    handleImportSessionFiles: [],
    renderMoreMenu: 0,
    scheduleDashboardRender: 0,
    scheduleSearchRender: 0,
    setMoreMenuOpen: [],
    setSearchQuery: [],
    showToast: [],
  };
  const listeners = {};
  const documentRef = {
    addEventListener(type, handler) {
      listeners[type] = handler;
    },
    getElementById(id) {
      if (id === 'archiveBody') {
        return overrides.archiveBody || null;
      }
      return null;
    },
  };
  const actionHandlers = overrides.actionHandlers || {};

  const bindings = createDashboardEventBindings({
    closeMoreMenu: options => {
      calls.closeMoreMenu.push(options || null);
    },
    focusMoreMenuItem: index => {
      calls.focusMoreMenuItem.push(index);
    },
    getActionHandlers: () => actionHandlers,
    getMoreMenuItems: () => overrides.moreMenuItems || [],
    getSearchDebounceMs: () => overrides.searchDebounceMs || 120,
    getStateSnapshot: () => ({ openTabs: [] }),
    handleImportSessionFiles: async files => {
      calls.handleImportSessionFiles.push(files);
      if (overrides.importError) throw overrides.importError;
    },
    renderMoreMenu: () => {
      calls.renderMoreMenu += 1;
    },
    scheduleDashboardRender: () => {
      calls.scheduleDashboardRender += 1;
    },
    scheduleSearchRender: () => {
      calls.scheduleSearchRender += 1;
    },
    setMoreMenuOpen: value => {
      calls.setMoreMenuOpen.push(value);
    },
    setSearchQuery: value => {
      calls.setSearchQuery.push(value);
    },
    showToast: message => {
      calls.showToast.push(message);
    },
    t: i18n.t,
  });

  bindings.bind(documentRef);

  return {
    calls,
    documentRef,
    listeners,
  };
}

test('click action failure shows toast and schedules dashboard refresh', async () => {
  const { calls, listeners } = createHarness({
    actionHandlers: {
      explode: async () => {
        throw new Error('boom');
      },
    },
  });
  const previousConsoleError = console.error;
  console.error = () => {};

  try {
    await listeners.click({
      target: {
        closest(selector) {
          if (selector === '[data-action]') {
            return { dataset: { action: 'explode' } };
          }
          return null;
        },
      },
    });
  } finally {
    console.error = previousConsoleError;
  }

  assert.deepEqual(calls.showToast, ['Action failed, refreshing view']);
  assert.equal(calls.scheduleDashboardRender, 1);
});

test('input updates search query and debounces search render', async () => {
  const pendingTimeouts = [];
  const previousSetTimeout = global.setTimeout;
  const previousClearTimeout = global.clearTimeout;
  global.setTimeout = fn => {
    pendingTimeouts.push(fn);
    return pendingTimeouts.length;
  };
  global.clearTimeout = () => {};

  try {
    const { calls, listeners } = createHarness({ searchDebounceMs: 140 });
    listeners.input({
      target: {
        id: 'globalSearchInput',
        value: 'docs',
      },
    });

    assert.deepEqual(calls.setSearchQuery, ['docs']);
    assert.equal(calls.scheduleSearchRender, 0);

    pendingTimeouts[0]();
    assert.equal(calls.scheduleSearchRender, 1);
  } finally {
    global.setTimeout = previousSetTimeout;
    global.clearTimeout = previousClearTimeout;
  }
});

test('keydown on more menu toggle opens menu and focuses first item', async () => {
  const pendingTimeouts = [];
  const previousSetTimeout = global.setTimeout;
  global.setTimeout = fn => {
    pendingTimeouts.push(fn);
    return 1;
  };

  try {
    const { calls, listeners } = createHarness();
    listeners.keydown({
      key: 'Enter',
      preventDefault() {},
      target: {
        id: 'moreMenuToggle',
        closest() {
          return null;
        },
      },
    });

    assert.deepEqual(calls.setMoreMenuOpen, [true]);
    assert.equal(calls.renderMoreMenu, 1);
    pendingTimeouts[0]();
    assert.deepEqual(calls.focusMoreMenuItem, [0]);
  } finally {
    global.setTimeout = previousSetTimeout;
  }
});

test('click toggles archive body and closes more menu when clicking outside', async () => {
  const archiveBody = { style: { display: 'none' } };
  const { calls, listeners } = createHarness({ archiveBody });
  const toggle = {
    classList: {
      toggle() {},
    },
  };

  await listeners.click({
    target: {
      closest(selector) {
        if (selector === '[data-action]') return null;
        if (selector === '#moreMenu') return null;
        if (selector === '#archiveToggle') return toggle;
        return null;
      },
    },
  });

  assert.deepEqual(calls.closeMoreMenu, [null]);
  assert.equal(archiveBody.style.display, 'block');
});

test('change imports selected files and resets input value', async () => {
  const { calls, listeners } = createHarness();
  const target = {
    id: 'sessionImportInput',
    files: [{ name: 'session.json' }],
    value: 'filled',
  };

  await listeners.change({ target });

  assert.equal(calls.handleImportSessionFiles.length, 1);
  assert.equal(target.value, '');
});
