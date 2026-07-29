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
    faviconPlaceholders: [],
    focusMoreMenuItem: [],
    handleImportSessionFiles: [],
    renderMoreMenu: 0,
    scheduleDashboardRender: 0,
    scheduleSearchRender: 0,
    setMoreMenuOpen: [],
    setSearchQuery: [],
    setSearchScope: [],
    showToast: [],
  };
  const listeners = {};
  const documentRef = {
    addEventListener(type, handler) {
      listeners[type] = handler;
    },
    createElement(tagName) {
      return {
        firstElementChild: { tagName: 'SPAN' },
        set innerHTML(value) {
          this.html = value;
          this.firstElementChild = { html: value };
        },
      };
    },
    getElementById(id) {
      if (id === 'customGroupPanel') {
        return overrides.customGroupPanel || null;
      }
      if (id === 'archiveBody') {
        return overrides.archiveBody || null;
      }
      return null;
    },
  };
  const actionHandlers = overrides.actionHandlers || {};

  const bindings = createDashboardEventBindings({
    buildFaviconPlaceholder: (domain, className) => {
      calls.faviconPlaceholders.push({ domain, className });
      return `<span class="${className} favicon-placeholder">${domain[0]}</span>`;
    },
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
    setSearchScope: value => {
      calls.setSearchScope.push(value);
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

test('favicon image errors fall back to local placeholder', () => {
  const { calls, listeners } = createHarness();
  const replacements = [];
  const img = {
    className: 'chip-favicon',
    dataset: {
      faviconClass: 'chip-favicon',
      faviconDomain: 'github.com',
    },
    replaceWith(node) {
      replacements.push(node);
    },
  };

  listeners.error({
    target: img,
  });

  assert.deepEqual(calls.faviconPlaceholders, [
    { domain: 'github.com', className: 'chip-favicon' },
  ]);
  assert.equal(replacements.length, 1);
  assert.match(replacements[0].html, /favicon-placeholder/);
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

test('change updates search scope and renders current search', async () => {
  const { calls, listeners } = createHarness();
  await listeners.change({
    target: {
      id: 'searchScopeImported',
      name: 'searchScope',
      value: 'imported',
    },
  });

  assert.deepEqual(calls.setSearchScope, ['imported']);
  assert.equal(calls.scheduleSearchRender, 1);
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
  const archiveBody = {
    classList: {
      values: new Set(['hidden-by-default']),
      contains(name) {
        return this.values.has(name);
      },
      remove(name) {
        this.values.delete(name);
      },
      add(name) {
        this.values.add(name);
      },
    },
    style: { display: '' },
  };
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
  assert.equal(archiveBody.classList.values.has('hidden-by-default'), false);
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

test('change imports custom group rule files through action handler', async () => {
  const handled = [];
  const { listeners } = createHarness({
    actionHandlers: {
      'import-custom-group-rules': async input => {
        handled.push({
          action: input.action,
          fileCount: Array.from(input.actionEl.files || []).length,
        });
      },
    },
  });
  const target = {
    id: 'customGroupImportInput',
    files: [{ name: 'rules.json' }],
    value: 'filled',
  };

  await listeners.change({ target });

  assert.deepEqual(handled, [{
    action: 'import-custom-group-rules',
    fileCount: 1,
  }]);
  assert.equal(target.value, '');
});

test('submit on custom group form routes to save action', async () => {
  const handled = [];
  const { listeners } = createHarness({
    actionHandlers: {
      'save-custom-group-rule': async input => {
        handled.push(input.action);
      },
    },
  });
  let prevented = 0;

  await listeners.submit({
    target: { id: 'customGroupForm' },
    preventDefault() {
      prevented += 1;
    },
  });

  assert.equal(prevented, 1);
  assert.deepEqual(handled, ['save-custom-group-rule']);
});

test('escape closes custom group panel before closing the more menu', () => {
  const handled = [];
  const { calls, listeners } = createHarness({
    customGroupPanel: {
      style: { display: 'block' },
      classList: { contains: () => true },
    },
    actionHandlers: {
      'close-custom-groups': input => {
        handled.push(input.action);
      },
    },
  });

  listeners.keydown({
    key: 'Escape',
    target: {},
  });

  assert.deepEqual(handled, ['close-custom-groups']);
  assert.deepEqual(calls.closeMoreMenu, []);
});

test('escape closes the more menu when custom group panel is not open', () => {
  const { calls, listeners } = createHarness({
    customGroupPanel: {
      style: {},
      classList: { contains: () => false },
    },
  });

  listeners.keydown({
    key: 'Escape',
    target: {},
  });

  assert.deepEqual(calls.closeMoreMenu, [{ restoreFocus: true }]);
});
