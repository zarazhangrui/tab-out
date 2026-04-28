const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const indexHtml = fs.readFileSync(path.join(root, 'extension/index.html'), 'utf8');
const appJs = fs.readFileSync(path.join(root, 'extension/app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'extension/style.css'), 'utf8');

test('renders a top favorites section before the dashboard columns', () => {
  assert.match(indexHtml, /id="favoritesSection"/);
  assert.match(indexHtml, /data-action="toggle-favorite-form"/);
  assert.match(indexHtml, /id="favoriteForm"[^>]*style="display:none"/);
  assert.match(indexHtml, /id="favoriteName"/);
  assert.match(indexHtml, /id="favoriteUrl"/);
  assert.ok(indexHtml.indexOf('id="favoritesSection"') < indexHtml.indexOf('id="dashboardColumns"'));
});

test('favorites are persisted, rendered, opened, and removed from chrome.storage.local', () => {
  assert.match(appJs, /async function getFavoriteSites\(\)/);
  assert.match(appJs, /async function saveFavoriteSite\(/);
  assert.match(appJs, /async function deleteFavoriteSite\(/);
  assert.match(appJs, /async function renderFavoritesSection\(\)/);
  assert.match(appJs, /function deriveFavoriteTitleFromUrl\(/);
  assert.match(appJs, /function autofillFavoriteNameFromUrl\(/);
  assert.match(appJs, /favoriteNameWasEdited/);
  assert.match(appJs, /action === 'toggle-favorite-form'/);
  assert.match(appJs, /data-action="open-favorite"/);
  assert.match(appJs, /data-action="delete-favorite"/);
  assert.match(appJs, /chrome\.tabs\.create/);
});

test('archived saved tabs can be deleted from the archive list', () => {
  assert.match(appJs, /async function deleteSavedTab\(/);
  assert.match(appJs, /data-action="delete-archive-item"/);
  assert.match(appJs, /action === 'delete-archive-item'/);
});

test('new favorite and archive controls have dedicated styling', () => {
  assert.match(css, /\.favorites-section/);
  assert.match(css, /\.favorite-toggle/);
  assert.match(css, /\.favorite-toggle\s*\{[\s\S]*width:\s*28px;[\s\S]*height:\s*28px;[\s\S]*border-radius:\s*4px;[\s\S]*border:\s*none;/);
  assert.match(css, /\.favorite-form/);
  assert.match(css, /\.favorite-delete/);
  assert.match(css, /\.archive-delete/);
});
