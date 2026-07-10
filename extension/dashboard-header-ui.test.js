'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createDashboardHeaderUi,
} = require('./dashboard-header-ui.js');

function withFakeDocument(fakeDocument, run) {
  const previousDocument = global.document;
  global.document = fakeDocument;
  return Promise.resolve()
    .then(run)
    .finally(() => {
      global.document = previousDocument;
    });
}

test('renderAutoRefreshToggle reflects current enabled state', async () => {
  let enabled = true;
  const toggle = {
    textContent: '',
    classList: {
      added: new Set(),
      toggle(name, force) {
        if (force) {
          this.added.add(name);
          return;
        }
        this.added.delete(name);
      },
    },
  };

  const headerUi = createDashboardHeaderUi({
    getAutoRefreshEnabled: () => enabled,
    getMoreMenuOpen: () => false,
  });

  await withFakeDocument({
    getElementById(id) {
      return id === 'autoRefreshToggle' ? toggle : null;
    },
    querySelectorAll() {
      return [];
    },
  }, async () => {
    headerUi.renderAutoRefreshToggle();
    assert.equal(toggle.textContent, 'Auto refresh: On');
    assert.equal(toggle.classList.added.has('save-tabs'), true);
    assert.equal(toggle.classList.added.has('danger'), false);

    enabled = false;
    headerUi.renderAutoRefreshToggle();
    assert.equal(toggle.textContent, 'Auto refresh: Off');
    assert.equal(toggle.classList.added.has('save-tabs'), false);
    assert.equal(toggle.classList.added.has('danger'), true);
  });
});

test('renderMoreMenu and focusMoreMenuItem follow menu state', async () => {
  let open = true;
  const focusCalls = [];
  const menu = {
    classList: {
      added: new Set(),
      toggle(name, force) {
        if (force) {
          this.added.add(name);
          return;
        }
        this.added.delete(name);
      },
    },
  };
  const toggle = {
    attributes: {},
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
  };
  const panel = { style: { display: 'none' } };
  const items = [
    { focus() { focusCalls.push(0); } },
    { focus() { focusCalls.push(1); } },
  ];

  const headerUi = createDashboardHeaderUi({
    getAutoRefreshEnabled: () => false,
    getMoreMenuOpen: () => open,
  });

  await withFakeDocument({
    getElementById(id) {
      if (id === 'moreMenu') return menu;
      if (id === 'moreMenuToggle') return toggle;
      if (id === 'moreMenuPanel') return panel;
      return null;
    },
    querySelectorAll(selector) {
      return selector === '#moreMenuPanel .more-menu-item' ? items : [];
    },
  }, async () => {
    headerUi.renderMoreMenu();
    assert.equal(menu.classList.added.has('open'), true);
    assert.equal(toggle.attributes['aria-expanded'], 'true');
    assert.equal(panel.style.display, 'flex');

    headerUi.focusMoreMenuItem(1);
    assert.deepEqual(focusCalls, [1]);

    open = false;
    headerUi.renderMoreMenu();
    assert.equal(menu.classList.added.has('open'), false);
    assert.equal(toggle.attributes['aria-expanded'], 'false');
    assert.equal(panel.style.display, 'none');
  });
});
