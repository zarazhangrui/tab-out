const assert = require('assert');
const {
  buildCommandItems,
  filterCommandItems,
  createUndoSnapshot,
} = require('../extension/app-core');

function run(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    console.error(error.stack || error.message);
    process.exitCode = 1;
  }
}

run('buildCommandItems only includes open tabs', () => {
  const items = buildCommandItems({
    openTabs: [
      { id: 1, title: 'GitHub Pull Request', url: 'https://github.com/a/b/pull/1', windowId: 4 },
      { id: 2, title: 'Chrome Settings', url: 'chrome://settings', windowId: 4 },
    ],
    savedTabs: {
      active: [{ id: 's1', title: 'Reading List Item', url: 'https://example.com/read' }],
      archived: [{ id: 's2', title: 'Archived Item', url: 'https://example.com/old' }],
    },
    quickLinks: [{ name: 'Calendar', url: 'https://calendar.google.com' }],
  });

  assert.deepStrictEqual(items.map(item => item.type), ['open-tab']);
  assert.strictEqual(items[0].meta, 'Open tab');
  assert.strictEqual(items[0].title, 'GitHub Pull Request');
});

run('filterCommandItems matches title url and meta case-insensitively', () => {
  const items = buildCommandItems({
    openTabs: [
      { title: 'Linear Issue', url: 'https://linear.app/acme/issue/APP-1' },
      { title: 'Recipe', url: 'https://food.example.com' },
    ],
    savedTabs: { active: [], archived: [] },
  });

  assert.deepStrictEqual(filterCommandItems(items, 'APP-1').map(item => item.title), ['Linear Issue']);
  assert.deepStrictEqual(filterCommandItems(items, 'quick').map(item => item.title), []);
  assert.deepStrictEqual(filterCommandItems(items, '').length, 2);
});

run('createUndoSnapshot keeps restorable tab fields only', () => {
  const snapshot = createUndoSnapshot('Closed GitHub', [
    { title: 'GitHub', url: 'https://github.com', pinned: true, active: true, discarded: false },
    { title: 'Chrome Settings', url: 'chrome://settings', pinned: false },
    { title: 'Blank', url: 'about:blank' },
  ]);

  assert.strictEqual(snapshot.label, 'Closed GitHub');
  assert.deepStrictEqual(snapshot.tabs, [
    { title: 'GitHub', url: 'https://github.com', pinned: true },
  ]);
  assert.ok(snapshot.createdAt);
});
