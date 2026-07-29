'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createDashboardHeaderUi,
} = require('./dashboard-header-ui.js');
const {
  createTestI18n,
} = require('./test-i18n-helper.js');

function createHeaderUi(overrides = {}) {
  const i18n = createTestI18n(overrides.language || 'en');
  return createDashboardHeaderUi({
    getAutoRefreshEnabled: overrides.getAutoRefreshEnabled || (() => false),
    getLanguagePreference: overrides.getLanguagePreference || (() => overrides.language || 'en'),
    getMoreMenuOpen: overrides.getMoreMenuOpen || (() => false),
    getSearchScope: overrides.getSearchScope || (() => 'all'),
    getTabMovingEnabled: overrides.getTabMovingEnabled || (() => false),
    getThemePreference: overrides.getThemePreference || (() => 'system'),
    getNextLanguage: i18n.getNextLanguage,
    t: i18n.t,
  });
}

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

  const headerUi = createHeaderUi({
    getAutoRefreshEnabled: () => enabled,
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

  const headerUi = createHeaderUi({
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

test('renderThemeToggle applies and labels stored theme preference', async () => {
  let preference = 'system';
  const root = {
    dataset: {},
    style: {},
  };
  const toggle = {
    attributes: {},
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
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
  };
  const previousWindow = global.window;
  global.window = {
    matchMedia(query) {
      return {
        matches: query === '(prefers-color-scheme: dark)',
      };
    },
  };

  const headerUi = createHeaderUi({
    getThemePreference: () => preference,
  });

  try {
    await withFakeDocument({
      documentElement: root,
      getElementById(id) {
        return id === 'themeToggle' ? toggle : null;
      },
      querySelectorAll() {
        return [];
      },
    }, async () => {
      headerUi.renderThemeToggle();
      assert.equal(toggle.textContent, 'Theme: System');
      assert.equal(toggle.attributes['aria-label'], 'Theme: System. Currently following your browser theme.');
      assert.equal(root.dataset.themePreference, 'system');
      assert.equal(root.dataset.theme, undefined);
      assert.equal(root.style.colorScheme, 'light dark');
      assert.equal(toggle.classList.added.has('save-tabs'), false);

      preference = 'dark';
      headerUi.renderThemeToggle();
      assert.equal(toggle.textContent, 'Theme: Dark');
      assert.equal(toggle.attributes['aria-label'], 'Theme: Dark.');
      assert.equal(root.dataset.themePreference, 'dark');
      assert.equal(root.dataset.theme, 'dark');
      assert.equal(root.style.colorScheme, 'dark');
      assert.equal(toggle.classList.added.has('save-tabs'), false);

      preference = 'light';
      headerUi.renderThemeToggle();
      assert.equal(toggle.textContent, 'Theme: Light');
      assert.equal(root.dataset.themePreference, 'light');
      assert.equal(root.dataset.theme, 'light');
      assert.equal(root.style.colorScheme, 'light');
      assert.equal(toggle.classList.added.has('save-tabs'), false);
    });
  } finally {
    global.window = previousWindow;
  }
});

test('renderTabMovingToggle reflects advanced moving setting', async () => {
  let enabled = false;
  const toggle = {
    attributes: {},
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
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
  };

  const headerUi = createHeaderUi({
    getTabMovingEnabled: () => enabled,
  });

  await withFakeDocument({
    getElementById(id) {
      return id === 'tabMovingToggle' ? toggle : null;
    },
    querySelectorAll() {
      return [];
    },
  }, async () => {
    headerUi.renderTabMovingToggle();
    assert.equal(toggle.textContent, 'Tab moving: Off');
    assert.equal(toggle.attributes['aria-label'], 'Advanced tab moving disabled.');
    assert.equal(toggle.classList.added.has('save-tabs'), false);
    assert.equal(toggle.classList.added.has('danger'), true);

    enabled = true;
    headerUi.renderTabMovingToggle();
    assert.equal(toggle.textContent, 'Tab moving: On');
    assert.equal(toggle.attributes['aria-label'], 'Advanced tab moving enabled.');
    assert.equal(toggle.classList.added.has('save-tabs'), true);
    assert.equal(toggle.classList.added.has('danger'), false);
  });
});

test('renderSearchScopeToggle marks the selected search range', async () => {
  let scope = 'open';
  const options = [
    { id: 'searchScopeAll', value: 'all', checked: false, attributes: {}, setAttribute(name, value) { this.attributes[name] = value; } },
    { id: 'searchScopeOpen', value: 'open', checked: false, attributes: {}, setAttribute(name, value) { this.attributes[name] = value; } },
    { id: 'searchScopeLater', value: 'later', checked: false, attributes: {}, setAttribute(name, value) { this.attributes[name] = value; } },
    { id: 'searchScopeImported', value: 'imported', checked: false, attributes: {}, setAttribute(name, value) { this.attributes[name] = value; } },
  ];

  const headerUi = createHeaderUi({
    getSearchScope: () => scope,
  });

  await withFakeDocument({
    getElementById(id) {
      return options.find(option => option.id === id) || null;
    },
    querySelectorAll(selector) {
      return selector === '[name="searchScope"]' ? options : [];
    },
  }, async () => {
    headerUi.renderSearchScopeToggle();
    assert.equal(options[0].checked, false);
    assert.equal(options[1].checked, true);
    assert.equal(options[2].checked, false);
    assert.equal(options[3].checked, false);
    assert.equal(options[1].attributes['aria-checked'], 'true');

    scope = 'imported';
    headerUi.renderSearchScopeToggle();
    assert.equal(options[0].checked, false);
    assert.equal(options[1].checked, false);
    assert.equal(options[2].checked, false);
    assert.equal(options[3].checked, true);
    assert.equal(options[3].attributes['aria-checked'], 'true');
  });
});

test('getNextThemePreference switches visibly from system theme', () => {
  const headerUi = createHeaderUi({
    getThemePreference: () => 'system',
  });

  assert.equal(headerUi.getNextThemePreference('system'), 'light');
  assert.equal(headerUi.getNextThemePreference('light'), 'dark');
  assert.equal(headerUi.getNextThemePreference('dark'), 'system');
});
