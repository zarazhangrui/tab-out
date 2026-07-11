'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

global.window = global.window || {};
require('./custom-group-controller.js');

const {
  createCustomGroupController,
} = window.TabOutCustomGroupController;

function createElement(overrides = {}) {
  return {
    classList: {
      values: new Set(),
      add(name) {
        this.values.add(name);
      },
      remove(name) {
        this.values.delete(name);
      },
      toggle(name, force) {
        if (force) this.values.add(name);
        else this.values.delete(name);
      },
    },
    dataset: {},
    focusCalled: false,
    innerHTML: '',
    resetCalled: false,
    style: {},
    textContent: '',
    value: '',
    checked: false,
    focus() {
      this.focusCalled = true;
    },
    reset() {
      this.resetCalled = true;
    },
    ...overrides,
  };
}

function createHarness(overrides = {}) {
  const elements = {
    customGroupPanel: createElement(),
    customGroupRuleList: createElement(),
    customGroupEmpty: createElement(),
    customGroupForm: createElement(),
    customGroupRuleId: createElement(),
    customGroupEnabled: createElement(),
    customGroupLabel: createElement(),
    customGroupKey: createElement(),
    customGroupHostname: createElement(),
    customGroupHostnameEndsWith: createElement(),
    customGroupPathPrefix: createElement(),
    customGroupSaveButton: createElement(),
    ...overrides.elements,
  };
  const calls = {
    buildSessionFilename: [],
    closeMoreMenu: 0,
    downloadJsonFile: [],
    scheduleDashboardAndWait: 0,
    setStorageValue: [],
    showToast: [],
  };
  let customGroupRules = overrides.customGroupRules || [];

  const controller = createCustomGroupController({
    buildSessionFilename: scope => {
      calls.buildSessionFilename.push(scope);
      return `tab-out-${scope}-2026-07-12T09-08-07.json`;
    },
    createStableId: prefix => `${prefix}-1`,
    documentRef: {
      getElementById(id) {
        return elements[id] || null;
      },
    },
    escapeHtml: value => String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;'),
    getCustomGroupRules: () => customGroupRules,
    setCustomGroupRules: rules => {
      customGroupRules = rules;
      return customGroupRules;
    },
    setStorageValue: async (key, value) => {
      calls.setStorageValue.push({ key, value });
    },
    downloadJsonFile: (filename, payload) => {
      calls.downloadJsonFile.push({ filename, payload });
    },
    closeMoreMenu: () => {
      calls.closeMoreMenu += 1;
    },
    scheduleDashboardAndWait: async () => {
      calls.scheduleDashboardAndWait += 1;
    },
    showToast: message => {
      calls.showToast.push(message);
    },
    t: (key, vars = {}) => {
      const messages = {
        'action.addRule': 'Add rule',
        'action.saveRule': 'Save rule',
        'customGroups.empty': 'No custom grouping rules yet.',
        'customGroups.rulePattern': '{host}{path}',
        'customGroups.scope.exact': 'exact host',
        'customGroups.scope.suffix': 'host suffix',
        'toast.customGroupDeleted': 'Grouping rule removed',
        'toast.customGroupExportEmpty': 'No grouping rules to export',
        'toast.customGroupExported': 'Exported {count} grouping rules',
        'toast.customGroupImported': 'Imported {count} grouping rules',
        'toast.customGroupImportFailed': 'Could not import grouping rules',
        'toast.customGroupSaved': 'Grouping rule saved',
      };
      return (messages[key] || key).replace(/\{([a-zA-Z0-9_]+)\}/g, (_, name) => vars[name] || '');
    },
  });

  return {
    calls,
    controller,
    elements,
    getCustomGroupRules: () => customGroupRules,
  };
}

test('openPanel renders existing custom group rules and focuses the label field', () => {
  const { calls, controller, elements } = createHarness({
    customGroupRules: [
      {
        id: 'workspace',
        enabled: true,
        groupKey: 'workspace',
        groupLabel: 'Workspace',
        hostname: '',
        hostnameEndsWith: '.google.com',
        pathPrefix: '/docs',
      },
    ],
  });

  controller.openPanel();

  assert.equal(calls.closeMoreMenu, 1);
  assert.equal(elements.customGroupPanel.style.display, 'block');
  assert.equal(elements.customGroupPanel.classList.values.has('open'), true);
  assert.equal(elements.customGroupPanel.classList.values.has('hidden-by-default'), false);
  assert.equal(elements.customGroupRuleList.innerHTML.includes('Workspace'), true);
  assert.equal(elements.customGroupRuleList.innerHTML.includes('.google.com/docs'), true);
  assert.equal(elements.customGroupEmpty.style.display, 'none');
  assert.equal(elements.customGroupLabel.focusCalled, true);
});

test('closePanel hides the panel and restores the hidden class', () => {
  const { controller, elements } = createHarness();

  controller.openPanel();
  controller.closePanel();

  assert.equal(elements.customGroupPanel.style.display, 'none');
  assert.equal(elements.customGroupPanel.classList.values.has('open'), false);
  assert.equal(elements.customGroupPanel.classList.values.has('hidden-by-default'), true);
});

test('saveRule creates a normalized custom group rule', async () => {
  const { calls, controller, elements, getCustomGroupRules } = createHarness();
  elements.customGroupEnabled.checked = true;
  elements.customGroupLabel.value = 'Google Workspace';
  elements.customGroupKey.value = 'google-workspace';
  elements.customGroupHostname.value = '';
  elements.customGroupHostnameEndsWith.value = 'Google.COM';
  elements.customGroupPathPrefix.value = 'mail';

  await controller.saveRule();

  assert.deepEqual(getCustomGroupRules(), [
    {
      id: 'custom-group-1',
      enabled: true,
      groupKey: 'google-workspace',
      groupLabel: 'Google Workspace',
      hostname: '',
      hostnameEndsWith: 'google.com',
      pathPrefix: '/mail',
    },
  ]);
  assert.deepEqual(calls.setStorageValue, [{
    key: 'customGroupRules',
    value: getCustomGroupRules(),
  }]);
  assert.equal(calls.scheduleDashboardAndWait, 1);
  assert.deepEqual(calls.showToast, ['Grouping rule saved']);
});

test('deleteRule removes a custom group rule and refreshes the dashboard', async () => {
  const { calls, controller, getCustomGroupRules } = createHarness({
    customGroupRules: [
      {
        id: 'workspace',
        enabled: true,
        groupKey: 'workspace',
        groupLabel: 'Workspace',
        hostname: '',
        hostnameEndsWith: '.google.com',
        pathPrefix: '',
      },
    ],
  });

  await controller.deleteRule('workspace');

  assert.deepEqual(getCustomGroupRules(), []);
  assert.deepEqual(calls.setStorageValue, [{
    key: 'customGroupRules',
    value: [],
  }]);
  assert.equal(calls.scheduleDashboardAndWait, 1);
  assert.deepEqual(calls.showToast, ['Grouping rule removed']);
});

test('exportRules downloads grouping rules as JSON', () => {
  const { calls, controller } = createHarness({
    customGroupRules: [
      {
        id: 'workspace',
        enabled: true,
        groupKey: 'workspace',
        groupLabel: 'Workspace',
        hostname: '',
        hostnameEndsWith: '.google.com',
        pathPrefix: '',
      },
    ],
  });

  const exported = controller.exportRules();

  assert.equal(exported, true);
  assert.equal(calls.downloadJsonFile.length, 1);
  assert.deepEqual(calls.buildSessionFilename, ['grouping-rules']);
  assert.equal(calls.downloadJsonFile[0].filename, 'tab-out-grouping-rules-2026-07-12T09-08-07.json');
  assert.deepEqual(calls.downloadJsonFile[0].payload, {
    version: 1,
    source: 'tab-out',
    type: 'custom-group-rules',
    rules: [
      {
        id: 'workspace',
        enabled: true,
        groupKey: 'workspace',
        groupLabel: 'Workspace',
        hostname: '',
        hostnameEndsWith: '.google.com',
        pathPrefix: '',
      },
    ],
  });
  assert.deepEqual(calls.showToast, ['Exported 1 grouping rules']);
});

test('exportRules shows an empty toast when there are no rules', () => {
  const { calls, controller } = createHarness();

  const exported = controller.exportRules();

  assert.equal(exported, false);
  assert.deepEqual(calls.downloadJsonFile, []);
  assert.deepEqual(calls.showToast, ['No grouping rules to export']);
});

test('importRulesFromFiles merges normalized grouping rules', async () => {
  const { calls, controller, getCustomGroupRules } = createHarness({
    customGroupRules: [
      {
        id: 'workspace',
        enabled: true,
        groupKey: 'workspace',
        groupLabel: 'Workspace',
        hostname: '',
        hostnameEndsWith: '.google.com',
        pathPrefix: '',
      },
    ],
  });
  const file = {
    async text() {
      return JSON.stringify({
        type: 'custom-group-rules',
        rules: [
          {
            id: 'workspace',
            enabled: false,
            groupKey: 'workspace-docs',
            groupLabel: 'Workspace Docs',
            hostnameEndsWith: 'Google.COM',
            pathPrefix: 'docs',
          },
          {
            groupKey: 'github-issues',
            groupLabel: 'GitHub Issues',
            hostname: 'github.com',
            pathPrefix: '/mrfoolish/tab-out/issues',
          },
        ],
      });
    },
  };

  const importedCount = await controller.importRulesFromFiles([file]);

  assert.equal(importedCount, 2);
  assert.deepEqual(getCustomGroupRules(), [
    {
      id: 'workspace',
      enabled: true,
      groupKey: 'workspace',
      groupLabel: 'Workspace',
      hostname: '',
      hostnameEndsWith: '.google.com',
      pathPrefix: '',
    },
    {
      id: 'workspace-2',
      enabled: false,
      groupKey: 'workspace-docs',
      groupLabel: 'Workspace Docs',
      hostname: '',
      hostnameEndsWith: 'google.com',
      pathPrefix: '/docs',
    },
    {
      id: 'custom-group-1',
      enabled: true,
      groupKey: 'github-issues',
      groupLabel: 'GitHub Issues',
      hostname: 'github.com',
      hostnameEndsWith: '',
      pathPrefix: '/mrfoolish/tab-out/issues',
    },
  ]);
  assert.deepEqual(calls.setStorageValue, [{
    key: 'customGroupRules',
    value: getCustomGroupRules(),
  }]);
  assert.equal(calls.scheduleDashboardAndWait, 1);
  assert.deepEqual(calls.showToast, ['Imported 2 grouping rules']);
});

test('importRulesFromFiles rejects malformed grouping rule files', async () => {
  const { calls, controller, getCustomGroupRules } = createHarness();
  const file = {
    async text() {
      return '{"rules": "bad"}';
    },
  };

  const importedCount = await controller.importRulesFromFiles([file]);

  assert.equal(importedCount, 0);
  assert.deepEqual(getCustomGroupRules(), []);
  assert.deepEqual(calls.setStorageValue, []);
  assert.deepEqual(calls.showToast, ['Could not import grouping rules']);
});

test('renderRuleList shows the empty state when there are no rules', () => {
  const { controller, elements } = createHarness();

  controller.renderRuleList();

  assert.equal(elements.customGroupRuleList.innerHTML, '');
  assert.equal(elements.customGroupEmpty.style.display, 'block');
  assert.equal(elements.customGroupEmpty.textContent, 'No custom grouping rules yet.');
});
