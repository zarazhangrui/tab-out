'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createDashboardStaticTextRenderer,
} = require('./dashboard-static-text.js');

function createTextNode(text) {
  return {
    nodeType: 3,
    textContent: text,
  };
}

function createElement(overrides = {}) {
  return {
    attributes: {},
    childNodes: [],
    textContent: '',
    value: '',
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
    ...overrides,
  };
}

function createSearchScopeInput() {
  const labelText = createElement();
  return createElement({
    labelText,
    closest(selector) {
      if (selector !== 'label') return null;
      return {
        querySelector(labelSelector) {
          return labelSelector === 'span' ? labelText : null;
        },
      };
    },
  });
}

function createHarness(overrides = {}) {
  const elements = {
    globalSearchInput: createElement(),
    searchScopeAll: createSearchScopeInput(),
    searchScopeOpen: createSearchScopeInput(),
    searchScopeLater: createSearchScopeInput(),
    searchScopeImported: createSearchScopeInput(),
    moreMenuPanel: createElement(),
    importedSessionTitle: createElement(),
    openTabsSectionTitle: createElement(),
    laterEmpty: createElement(),
    moreMenuToggle: createElement({ childNodes: [createTextNode(' More '), { nodeType: 1 }] }),
    archiveToggle: createElement({ childNodes: [{ nodeType: 1 }, createTextNode(' Archive ')] }),
    customGroupRuleId: createElement({ value: overrides.customGroupRuleId || '' }),
    customGroupSaveButton: createElement(),
    customGroupLabel: createElement(),
    customGroupKey: createElement(),
    customGroupHostname: createElement(),
    customGroupHostnameEndsWith: createElement(),
    customGroupPathPrefix: createElement(),
    ...overrides.elements,
  };
  const selectors = {
    '#searchSection h2': createElement(),
    '.search-scope-toggle': createElement(),
    '#laterColumn h2': createElement(),
    '.stat-label': createElement(),
    '[data-action="clear-later-list"]': createElement(),
    '[data-action="archive-later-list"]': createElement(),
    '[data-action="clear-later-archive"]': createElement(),
    '[data-action="close-tabout-dupes"]': createElement(),
    '[data-action="export-imported-session"]': createElement(),
    '[data-action="restore-imported-session"]': createElement(),
    '[data-action="restore-imported-session-original"]': createElement(),
    '[data-action="clear-imported-session"]': createElement(),
    '[data-action="manual-refresh"]': createElement(),
    '[data-action="trigger-import-session"]': createElement(),
    '[data-action="export-all-groups"]': createElement(),
    '[data-action="open-custom-groups"]': createElement(),
    '[data-action="close-custom-groups"]': createElement(),
    ...overrides.selectors,
  };
  const calls = {
    renderCustomGroupPanel: 0,
  };
  const documentRef = {
    getElementById(id) {
      return elements[id] || null;
    },
    querySelector(selector) {
      return selectors[selector] || null;
    },
  };
  const messages = {
    'action.addRule': 'Add rule',
    'action.archive': 'Archive',
    'action.clear': 'Clear',
    'action.clearAll': 'Clear all',
    'action.closeExtras': 'Close extras',
    'action.exportAll': 'Export all',
    'action.exportRules': 'Export rules',
    'action.importFile': 'Import file',
    'action.importRules': 'Import rules',
    'action.refresh': 'Refresh',
    'action.reset': 'Reset',
    'action.restoreAll': 'Restore all',
    'action.restoreHere': 'Restore here',
    'action.restoreOriginalWindow': 'Restore windows',
    'action.saveRule': 'Save rule',
    'aria.moreActions': 'More actions',
    'aria.search': 'Search tabs',
    'common.archive': 'Archive',
    'customGroups.close': 'Close grouping rules',
    'customGroups.description': 'Move matching tabs into a named group.',
    'customGroups.enabled': 'On',
    'customGroups.groupKey': 'Group key',
    'customGroups.groupLabel': 'Group label',
    'customGroups.hostname': 'Exact host',
    'customGroups.hostnameEndsWith': 'Host suffix',
    'customGroups.pathPrefix': 'Path prefix',
    'customGroups.placeholder.groupKey': 'google-workspace',
    'customGroups.placeholder.groupLabel': 'Google Workspace',
    'customGroups.placeholder.hostname': 'mail.google.com',
    'customGroups.placeholder.hostnameEndsWith': '.google.com',
    'customGroups.placeholder.pathPrefix': '/mail',
    'customGroups.title': 'Grouping rules',
    'footer.openTabs': 'Open tabs',
    'menu.customGroups': 'Grouping rules',
    'menu.more': 'More',
    'placeholder.search': 'Search all tabs',
    'search.scope': 'Search scope',
    'search.scope.all': 'All',
    'search.scope.imported': 'Imported',
    'search.scope.later': 'Later',
    'search.scope.open': 'Open',
    'section.importedSession': 'Imported session',
    'section.laterList': 'Later list',
    'section.openTabs': 'Open tabs',
    'section.searchResults': 'Search results',
    'state.laterEmpty': 'Nothing saved.',
  };
  const renderer = createDashboardStaticTextRenderer({
    documentRef,
    getCustomGroupController: () => ({
      renderPanel() {
        calls.renderCustomGroupPanel += 1;
      },
    }),
    t: key => messages[key] || key,
  });

  return {
    calls,
    elements,
    renderer,
    selectors,
  };
}

test('renderStaticText updates common dashboard labels and attributes', () => {
  const { elements, renderer, selectors } = createHarness();

  renderer.renderStaticText();

  assert.equal(elements.globalSearchInput.attributes.placeholder, 'Search all tabs');
  assert.equal(elements.globalSearchInput.attributes['aria-label'], 'Search tabs');
  assert.equal(selectors['.search-scope-toggle'].attributes['aria-label'], 'Search scope');
  assert.equal(elements.searchScopeAll.labelText.textContent, 'All');
  assert.equal(elements.searchScopeOpen.labelText.textContent, 'Open');
  assert.equal(elements.searchScopeLater.labelText.textContent, 'Later');
  assert.equal(elements.searchScopeImported.labelText.textContent, 'Imported');
  assert.equal(elements.moreMenuPanel.attributes['aria-label'], 'More actions');
  assert.equal(selectors['#searchSection h2'].textContent, 'Search results');
  assert.equal(selectors['#laterColumn h2'].textContent, 'Later list');
  assert.equal(selectors['.stat-label'].textContent, 'Open tabs');
  assert.equal(elements.moreMenuToggle.childNodes[0].textContent, ' More ');
  assert.equal(elements.archiveToggle.childNodes[1].textContent, ' Archive ');
  assert.equal(selectors['[data-action="clear-later-list"]'].textContent, 'Clear');
  assert.equal(selectors['[data-action="archive-later-list"]'].textContent, 'Archive');
  assert.equal(selectors['[data-action="manual-refresh"]'].textContent, 'Refresh');
  assert.equal(selectors['[data-action="restore-imported-session"]'].textContent, 'Restore here');
  assert.equal(selectors['[data-action="restore-imported-session-original"]'].textContent, 'Restore windows');
  assert.equal(selectors['[data-action="open-custom-groups"]'].textContent, 'Grouping rules');
});

test('renderStaticText updates custom group form labels and add state', () => {
  const { calls, elements, renderer, selectors } = createHarness();

  renderer.renderStaticText();

  assert.equal(elements.customGroupSaveButton.textContent, 'Add rule');
  assert.equal(elements.customGroupLabel.attributes.placeholder, 'Google Workspace');
  assert.equal(elements.customGroupKey.attributes.placeholder, 'google-workspace');
  assert.equal(elements.customGroupHostname.attributes.placeholder, 'mail.google.com');
  assert.equal(elements.customGroupHostnameEndsWith.attributes.placeholder, '.google.com');
  assert.equal(elements.customGroupPathPrefix.attributes.placeholder, '/mail');
  assert.equal(selectors['[data-action="close-custom-groups"]'].attributes['aria-label'], 'Close grouping rules');
  assert.equal(calls.renderCustomGroupPanel, 1);
});

test('renderStaticText keeps custom group save button in edit state', () => {
  const { elements, renderer } = createHarness({ customGroupRuleId: 'workspace' });

  renderer.renderStaticText();

  assert.equal(elements.customGroupSaveButton.textContent, 'Save rule');
});
