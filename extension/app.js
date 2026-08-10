/* ================================================================
   Tab Out — Dashboard App (Pure Extension Edition)

   This file is the brain of the dashboard. Now that the dashboard
   IS the extension page (not inside an iframe), it can call
   chrome.tabs and chrome.storage directly — no postMessage bridge needed.

   What this file does:
   1. Reads open browser tabs directly via chrome.tabs.query()
   2. Groups tabs by domain with a landing pages category
   3. Renders domain cards, banners, and stats
   4. Handles all user actions (close tabs, save for later, focus tab)
   5. Stores "Saved for Later" tabs in chrome.storage.local (no server)
   ================================================================ */

'use strict';

/* ----------------------------------------------------------------
   CONFIG.LOCAL.JS — Dynamic load (CSP-safe replacement for inline onerror)

   The old index.html used <script src="config.local.js" onerror="...">,
   which violates Firefox's CSP (script-src 'self'). We load it here via
   a <script> element instead; if the file is absent the load simply
   fails silently and app.js falls back to its built-in defaults.
   ---------------------------------------------------------------- */
(function () {
  const s = document.createElement('script');
  s.src = 'config.local.js';
  s.onerror = () => { /* no personal config, that's fine */ };
  document.head.appendChild(s);
})();


/* ----------------------------------------------------------------
   CHROME TABS — Direct API Access

   Since this page IS the extension's new tab page, it has full
   access to chrome.tabs and chrome.storage. No middleman needed.
   ---------------------------------------------------------------- */

// All open tabs — populated by fetchOpenTabs()
let openTabs = [];

// URLs that represent a browser-native "new tab" page across browsers.
// Chrome uses chrome://newtab/, Firefox uses about:newtab / about:home.
const NEW_TAB_URLS = ['chrome://newtab/', 'about:newtab', 'about:home'];

/**
 * fetchOpenTabs()
 *
 * Reads all currently open browser tabs directly from Chrome.
 * Sets the extensionId flag so we can identify Tab Out's own pages.
 */
async function fetchOpenTabs() {
  try {
    // chrome.runtime.getURL() returns the correct extension URL regardless
    // of browser: chrome-extension://<id>/index.html or moz-extension://<id>/index.html
    const newtabUrl = chrome.runtime.getURL('index.html');

    const tabs = await chrome.tabs.query({});
    openTabs = tabs.map(t => ({
      id:       t.id,
      url:      t.url,
      title:    t.title,
      windowId: t.windowId,
      active:   t.active,
      // Flag Tab Out's own pages so we can detect duplicate new tabs
      isTabOut: t.url === newtabUrl || NEW_TAB_URLS.includes(t.url),
    }));
  } catch {
    // chrome.tabs API unavailable (shouldn't happen in an extension page)
    openTabs = [];
  }
}

/**
 * closeTabsByUrls(urls)
 *
 * Closes all open tabs whose hostname matches any of the given URLs.
 * After closing, re-fetches the tab list to keep our state accurate.
 *
 * Special case: file:// URLs are matched exactly (they have no hostname).
 */
async function closeTabsByUrls(urls) {
  if (!urls || urls.length === 0) return;

  // Separate file:// URLs (exact match) from regular URLs (hostname match)
  const targetHostnames = [];
  const exactUrls = new Set();

  for (const u of urls) {
    if (u.startsWith('file://')) {
      exactUrls.add(u);
    } else {
      try { targetHostnames.push(new URL(u).hostname); }
      catch { /* skip unparseable */ }
    }
  }

  const allTabs = await chrome.tabs.query({});
  const toClose = allTabs
    .filter(tab => {
      const tabUrl = tab.url || '';
      if (tabUrl.startsWith('file://') && exactUrls.has(tabUrl)) return true;
      try {
        const tabHostname = new URL(tabUrl).hostname;
        return tabHostname && targetHostnames.includes(tabHostname);
      } catch { return false; }
    })
    .map(tab => tab.id);

  if (toClose.length > 0) await chrome.tabs.remove(toClose);
  await fetchOpenTabs();
}

/**
 * closeTabsExact(urls)
 *
 * Closes tabs by exact URL match (not hostname). Used for landing pages
 * so closing "Gmail inbox" doesn't also close individual email threads.
 */
async function closeTabsExact(urls) {
  if (!urls || urls.length === 0) return;
  const urlSet = new Set(urls);
  const allTabs = await chrome.tabs.query({});
  const toClose = allTabs.filter(t => urlSet.has(t.url)).map(t => t.id);
  if (toClose.length > 0) await chrome.tabs.remove(toClose);
  await fetchOpenTabs();
}

/**
 * focusTab(url)
 *
 * Switches Chrome to the tab with the given URL (exact match first,
 * then hostname fallback). Also brings the window to the front.
 */
async function focusTab(url) {
  if (!url) return;
  const allTabs = await chrome.tabs.query({});
  const currentWindow = await chrome.windows.getCurrent();

  // Try exact URL match first
  let matches = allTabs.filter(t => t.url === url);

  // Fall back to hostname match
  if (matches.length === 0) {
    try {
      const targetHost = new URL(url).hostname;
      matches = allTabs.filter(t => {
        try { return new URL(t.url).hostname === targetHost; }
        catch { return false; }
      });
    } catch {}
  }

  if (matches.length === 0) return;

  // Prefer a match in a different window so it actually switches windows
  const match = matches.find(t => t.windowId !== currentWindow.id) || matches[0];
  await chrome.tabs.update(match.id, { active: true });
  await chrome.windows.update(match.windowId, { focused: true });
}

/**
 * closeDuplicateTabs(urls, keepOne)
 *
 * Closes duplicate tabs for the given list of URLs.
 * keepOne=true → keep one copy of each, close the rest.
 * keepOne=false → close all copies.
 */
async function closeDuplicateTabs(urls, keepOne = true) {
  const allTabs = await chrome.tabs.query({});
  const toClose = [];

  for (const url of urls) {
    const matching = allTabs.filter(t => t.url === url);
    if (keepOne) {
      const keep = matching.find(t => t.active) || matching[0];
      for (const tab of matching) {
        if (tab.id !== keep.id) toClose.push(tab.id);
      }
    } else {
      for (const tab of matching) toClose.push(tab.id);
    }
  }

  if (toClose.length > 0) await chrome.tabs.remove(toClose);
  await fetchOpenTabs();
}

/**
 * closeTabOutDupes()
 *
 * Closes all duplicate Tab Out new-tab pages except the current one.
 */
async function closeTabOutDupes() {
  const newtabUrl = chrome.runtime.getURL('index.html');

  const allTabs = await chrome.tabs.query({});
  const currentWindow = await chrome.windows.getCurrent();
  const tabOutTabs = allTabs.filter(t =>
    t.url === newtabUrl || NEW_TAB_URLS.includes(t.url)
  );

  if (tabOutTabs.length <= 1) return;

  // Keep the active Tab Out tab in the CURRENT window — that's the one the
  // user is looking at right now. Falls back to any active one, then the first.
  const keep =
    tabOutTabs.find(t => t.active && t.windowId === currentWindow.id) ||
    tabOutTabs.find(t => t.active) ||
    tabOutTabs[0];
  const toClose = tabOutTabs.filter(t => t.id !== keep.id).map(t => t.id);
  if (toClose.length > 0) await chrome.tabs.remove(toClose);
  await fetchOpenTabs();
}


/* ----------------------------------------------------------------
   SAVED FOR LATER — chrome.storage.local

   Replaces the old server-side SQLite + REST API with Chrome's
   built-in key-value storage. Data persists across browser sessions
   and doesn't require a running server.

   Data shape stored under the "deferred" key:
   [
     {
       id: "1712345678901",          // timestamp-based unique ID
       url: "https://example.com",
       title: "Example Page",
       savedAt: "2026-04-04T10:00:00.000Z",  // ISO date string
       completed: false,             // true = checked off (archived)
       dismissed: false              // true = dismissed without reading
     },
     ...
   ]
   ---------------------------------------------------------------- */

/**
 * saveTabForLater(tab)
 *
 * Saves a single tab to the "Saved for Later" list in chrome.storage.local.
 * @param {{ url: string, title: string }} tab
 */
async function saveTabForLater(tab) {
  const { deferred = [] } = await chrome.storage.local.get('deferred');
  deferred.push({
    id:        Date.now().toString(),
    url:       tab.url,
    title:     tab.title,
    savedAt:   new Date().toISOString(),
    completed: false,
    dismissed: false,
  });
  await chrome.storage.local.set({ deferred });
}

/**
 * getSavedTabs()
 *
 * Returns all saved tabs from chrome.storage.local.
 * Filters out dismissed items (those are gone for good).
 * Splits into active (not completed) and archived (completed).
 */
async function getSavedTabs() {
  const { deferred = [] } = await chrome.storage.local.get('deferred');
  const visible = deferred.filter(t => !t.dismissed);
  return {
    active:   visible.filter(t => !t.completed),
    archived: visible.filter(t => t.completed),
  };
}

/**
 * checkOffSavedTab(id)
 *
 * Marks a saved tab as completed (checked off). It moves to the archive.
 */
async function checkOffSavedTab(id) {
  const { deferred = [] } = await chrome.storage.local.get('deferred');
  const tab = deferred.find(t => t.id === id);
  if (tab) {
    tab.completed = true;
    tab.completedAt = new Date().toISOString();
    await chrome.storage.local.set({ deferred });
  }
}

/**
 * dismissSavedTab(id)
 *
 * Marks a saved tab as dismissed (removed from all lists).
 */
async function dismissSavedTab(id) {
  const { deferred = [] } = await chrome.storage.local.get('deferred');
  const tab = deferred.find(t => t.id === id);
  if (tab) {
    tab.dismissed = true;
    await chrome.storage.local.set({ deferred });
  }
}


/* ----------------------------------------------------------------
   COLLECTIONS — Browser bookmark manager
   Manages the browser's native bookmarks (folders = groups,
   bookmarks = saved tabs). All changes sync to the bookmarks bar.
   ---------------------------------------------------------------- */

const TEMP_FOLDER_TITLE = '临时分组';
let currentView = 'open';                       // 'open' | 'collections'
let tempFolderId = null;                        // cached id of the "临时分组" folder
const collapsedSubgroups = new Set();           // subgroup ids that are collapsed

// HTML-safe escaping for user-provided strings
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// --- Bookmark node type helpers ---
// Firefox's chrome.bookmarks returns a `type` field ("bookmark" | "folder").
// Chrome does NOT return `type`; instead, a node is a bookmark if it has a `url`
// and a folder if it doesn't. These helpers normalize both behaviors so the
// rest of the code can treat them uniformly.
function isBookmarkNode(node) {
  if (!node) return false;
  if (node.type) return node.type === 'bookmark';
  return !!node.url;
}
function isFolderNode(node) {
  if (!node) return false;
  if (node.type) return node.type === 'folder';
  return !node.url;
}

// Fetch the full bookmarks tree and split it into the top-level bookmark
// containers (书签栏 / 其他书签 / 移动书签 …). Firefox's root id is 0 and its
// direct children are the visible bookmark areas. We must scan ALL of them —
// not just the first folder child — otherwise bookmarks stored under "其他
// 书签" (Other Bookmarks) are silently dropped.
async function getBookmarkContainers() {
  const root = await chrome.bookmarks.getTree();
  const rootNode = root && root[0];
  if (!rootNode || !Array.isArray(rootNode.children)) return [];
  // Top-level containers are the folder children of the root node.
  return rootNode.children.filter(n => isFolderNode(n) && Array.isArray(n.children));
}

// Locate the bookmarks bar (书签栏). Firefox and Chrome use different fixed
// ids AND different ordering for the top-level containers:
//   Firefox: toolbar_____ (书签栏), menu________ (书签菜单), unfiled_____
//   Chrome:  1 (书签栏),   2 (其他书签)
// We prefer the known id, then fall back to the first container whose title
// is empty (Chrome/Firefox bar has no title) or just the first container.
async function getBookmarksBarTree() {
  const containers = await getBookmarkContainers();
  if (!containers.length) return null;
  // Firefox bookmarks bar id is the fixed string "toolbar_____".
  const byId = containers.find(c => c.id === 'toolbar_____');
  if (byId) return byId;
  // Chrome bookmarks bar id is "1".
  const byChromeId = containers.find(c => c.id === '1');
  if (byChromeId) return byChromeId;
  // Fallback: the bar typically has an empty title in both browsers.
  const byEmptyTitle = containers.find(c => !c.title || c.title === '');
  if (byEmptyTitle) return byEmptyTitle;
  return containers[0];
}

// Find or create the "临时分组" folder on the bookmarks bar.
// Caches its id in tempFolderId after first lookup.
async function ensureTempFolder() {
  if (tempFolderId) {
    // Verify it still exists (user may have deleted it from the browser UI).
    try {
      const chk = await chrome.bookmarks.get(tempFolderId);
      if (chk && chk[0]) return tempFolderId;
    } catch { /* folder gone, fall through to re-create */ }
    tempFolderId = null;
  }
  const bar = await getBookmarksBarTree();
  if (!bar) throw new Error('未找到书签栏');
  const children = bar.children || [];
  const existing = children.find(n => isFolderNode(n) && n.title === TEMP_FOLDER_TITLE);
  if (existing) {
    tempFolderId = existing.id;
    return tempFolderId;
  }
  const created = await chrome.bookmarks.create({
    parentId: bar.id,
    title: TEMP_FOLDER_TITLE,
  });
  tempFolderId = created.id;
  return tempFolderId;
}

// Read all groups (folders) and loose bookmarks from EVERY top-level bookmark
// container (书签栏 + 其他书签 + 移动书签). Loose bookmarks (bookmarks sitting
// directly in a container, not inside a folder) are treated as temp members.
// Supports nested subgroups up to MAX_DEPTH levels.
// Returns { temp: BookmarkNode[], groups: GroupNode[], tempId }.
// GroupNode = { id, title, tabs: BookmarkNode[], subgroups: GroupNode[] }
const MAX_SUBGROUP_DEPTH = 5;

function buildGroupNode(folderNode, depth) {
  const children = folderNode.children || [];
  const tabs = children.filter(c => isBookmarkNode(c) && c.url);
  const subfolders = children.filter(c => isFolderNode(c));
  const subgroups = depth < MAX_SUBGROUP_DEPTH
    ? subfolders.map(f => buildGroupNode(f, depth + 1))
    : [];
  return {
    id: folderNode.id,
    title: folderNode.title || '未命名分组',
    tabs,
    subgroups,
    depth,
  };
}

async function getCollectionData() {
  const tempId = await ensureTempFolder();
  const containers = await getBookmarkContainers();
  if (!containers.length) return { temp: [], groups: [], tempId };

  const temp = [];
  const groups = [];
  for (const container of containers) {
    for (const node of (container.children || [])) {
      if (isFolderNode(node)) {
        if (node.id === tempId) {
          // The temp folder's own bookmarks (flatten, no subgroups).
          collectAllBookmarks(node, temp);
        } else {
          groups.push(buildGroupNode(node, 0));
        }
      } else if (isBookmarkNode(node) && node.url) {
        // A bookmark sitting directly in a container (not in a folder) → temp.
        temp.push(node);
      }
    }
  }
  return { temp, groups, tempId };
}

// Recursively collect all bookmarks from a folder tree into a flat array.
function collectAllBookmarks(folderNode, out) {
  for (const child of (folderNode.children || [])) {
    if (isBookmarkNode(child) && child.url) {
      out.push(child);
    } else if (isFolderNode(child)) {
      collectAllBookmarks(child, out);
    }
  }
}

// Create a new group = a new folder on the bookmarks bar.
// Create a new group. If parentId is omitted, creates on the bookmarks bar.
// If parentId is provided, creates as a subgroup inside that folder.
async function createBookmarkGroup(name, parentId) {
  const title = (name || '').trim() || '新分组';
  const targetParent = parentId || (await getBookmarksBarTree()).id;
  if (!targetParent) throw new Error('未找到目标分组');
  const folder = await chrome.bookmarks.create({
    parentId: targetParent,
    title,
    index: 0,  // New groups always appear first.
  });
  return folder.id;
}

// Delete a group = move ALL bookmarks (including nested subgroups) into the
// temp folder, then removeTree the now-empty folder. Bookmarks are never lost.
async function deleteBookmarkGroup(folderId) {
  const tempId = await ensureTempFolder();
  // Use getSubTree to get the full nested tree, then collect all bookmarks.
  const subtree = await chrome.bookmarks.getSubTree(folderId);
  const allBookmarks = [];
  if (subtree && subtree[0]) {
    collectAllBookmarks(subtree[0], allBookmarks);
  }
  for (const bm of allBookmarks) {
    try {
      await chrome.bookmarks.move(bm.id, { parentId: tempId });
    } catch (e) {
      console.warn('[tab-out] could not move bookmark', bm.id, e);
    }
  }
  try {
    await chrome.bookmarks.removeTree(folderId);
  } catch (e) {
    console.error('[tab-out] deleteBookmarkGroup: removeTree failed for', folderId, e);
    // Fallback: try plain remove in case the folder is already empty.
    try { await chrome.bookmarks.remove(folderId); } catch (_) { /* ignore */ }
  }
}

// Move a bookmark from one folder to another (drag & drop).
async function moveBookmark(bookmarkId, targetFolderId) {
  const destId = targetFolderId || await ensureTempFolder();
  await chrome.bookmarks.move(bookmarkId, { parentId: destId });
}

// Reorder a group folder: move it to a new position among its siblings on the
// bookmarks bar. Chrome/Firefox accept an `index` on bookmarks.move; the
// target index is relative to the parent's children list.
async function moveGroupToIndex(folderId, targetIndex) {
  const nodes = await chrome.bookmarks.get(folderId);
  const folder = nodes && nodes[0];
  if (!folder) throw new Error('分组未找到');
  await chrome.bookmarks.move(folderId, { index: targetIndex });
}

// Rename a group folder (updates the bookmark folder title).
async function renameBookmarkGroup(folderId, newTitle) {
  await chrome.bookmarks.update(folderId, { title: newTitle });
}

// Delete a single bookmark permanently.
async function deleteBookmark(bookmarkId) {
  await chrome.bookmarks.remove(bookmarkId);
}

function collectionTabRow(bm) {
  let domain = '';
  try { domain = new URL(bm.url).hostname.replace(/^www\./, ''); } catch (e) { /* ignore */ }
  // Use a 1x1 transparent placeholder as the src; the real favicon loads via
  // the background-image CSS property which does NOT emit network errors to
  // the console on 404 (unlike <img src>). This keeps the console clean.
  const faviconBg = domain
    ? `https://www.google.com/s2/favicons?domain=${esc(domain)}&sz=32`
    : '';
  const faviconStyle = faviconBg ? `style="background-image:url('${faviconBg}');background-size:cover;background-position:center"` : '';
  const title = bm.title || bm.url;
  return `
    <div class="collection-tab" draggable="true" data-tab-id="${esc(bm.id)}">
      <div class="chip-favicon" ${faviconStyle}></div>
      <span class="collection-tab-title" data-action="open-bookmark" data-tab-id="${esc(bm.id)}" title="${esc(title)}">${esc(title)}</span>
      <button class="chip-action chip-close" data-action="delete-bookmark" data-tab-id="${esc(bm.id)}" title="删除">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
      </button>
    </div>`;
}

// Count total bookmarks in a group (including all nested subgroups).
function countAllTabs(group) {
  let n = group.tabs.length;
  for (const sg of (group.subgroups || [])) n += countAllTabs(sg);
  return n;
}

// Find the depth of a group by id in the groups tree.
// Top-level groups = depth 0, their subgroups = depth 1, etc.
// Returns null if not found.
function findGroupDepth(groups, targetId) {
  function search(list, depth) {
    for (const g of list) {
      if (g.id === targetId) return depth;
      if (g.subgroups && g.subgroups.length) {
        const found = search(g.subgroups, depth + 1);
        if (found != null) return found;
      }
    }
    return null;
  }
  return search(groups, 0);
}

function groupCardHtml(g) {
  return groupCardHtmlRecursive(g, 0);
}

function groupCardHtmlRecursive(g, depth) {
  const totalCount = g.temp ? g.tabs.length : countAllTabs(g);
  const tabsHtml = g.tabs.length
    ? g.tabs.map(collectionTabRow).join('')
    : '';
  const delBtn = g.temp ? '' :
    `<button class="chip-action chip-close group-delete" data-action="delete-group" data-group-id="${esc(g.id)}" title="删除分组">
       <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
     </button>`;
  // "Add subgroup" button — shown for all non-temp groups.
  const addSubBtn = g.temp ? '' :
    `<button class="chip-action group-add-sub" data-action="add-subgroup" data-group-id="${esc(g.id)}" title="新建子分组">
       <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
     </button>`;
  // "Rename group" button — shown for all non-temp groups.
  const renameBtn = g.temp ? '' :
    `<button class="chip-action group-rename" data-action="rename-group" data-group-id="${esc(g.id)}" title="重命名分组">
       <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125" /></svg>
     </button>`;

  // Subgroup HTML — recursively rendered with indentation.
  const subgroupsHtml = (g.subgroups || []).map(sg => {
    const sgCount = countAllTabs(sg);
    // Subgroups can also have subgroups — show "+" button if depth allows.
    const sgDepth = (g.depth != null ? g.depth : depth) + 1;
    const canAddSub = sgDepth < MAX_SUBGROUP_DEPTH;
    const addSubForSg = canAddSub
      ? `<button class="chip-action subgroup-add-sub" data-action="add-subgroup" data-group-id="${esc(sg.id)}" title="新建子分组">
           <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
         </button>`
      : '';
    const renameForSg = `<button class="chip-action subgroup-rename" data-action="rename-group" data-group-id="${esc(sg.id)}" title="重命名子分组">
           <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125" /></svg>
         </button>`;
    return `
      <div class="subgroup ${collapsedSubgroups.has(sg.id) ? 'collapsed' : ''}" data-group-id="${esc(sg.id)}" data-depth="${sgDepth}">
        <div class="subgroup-header" data-action="toggle-subgroup" data-group-id="${esc(sg.id)}">
          <svg class="subgroup-chevron ${collapsedSubgroups.has(sg.id) ? 'collapsed' : ''}" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" /></svg>
          <span class="subgroup-name">${esc(sg.title)}</span>
          <span class="subgroup-count">${sgCount}</span>
          ${renameForSg}
          ${addSubForSg}
          <button class="chip-action chip-close subgroup-delete" data-action="delete-group" data-group-id="${esc(sg.id)}" title="删除子分组">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <div class="subgroup-body">
          ${groupCardHtmlRecursive({ ...sg, temp: false, sortable: false, depth: sgDepth }, depth + 1)}
        </div>
      </div>`;
  }).join('');

  const isEmpty = !tabsHtml && !subgroupsHtml;
  const emptyHtml = isEmpty ? `<div class="group-empty">拖拽标签到这里</div>` : '';

  // Only top-level groups (depth 0) get sortable + draggable.
  const sortableClass = (g.sortable && depth === 0) ? 'group-card-sortable' : '';
  const draggableAttr = (g.sortable && depth === 0) ? 'draggable="true"' : '';
  const tempClass = g.temp ? 'group-card-temp' : '';

  return `
    <div class="group-card ${tempClass} ${sortableClass}" data-group-id="${esc(g.id)}" ${draggableAttr}>
      <div class="group-card-header">
        <span class="group-name">${esc(g.name || g.title)}</span>
        <span class="group-count">${totalCount}</span>
        ${renameBtn}
        ${addSubBtn}
        ${delBtn}
      </div>
      <div class="group-tabs">
        ${subgroupsHtml}
        ${tabsHtml}
        ${emptyHtml}
      </div>
    </div>`;
}

async function renderCollectionsView() {
  const view = document.getElementById('collectionsView');
  if (!view) return;
  let temp, groups, tempId;
  try {
    ({ temp, groups, tempId } = await getCollectionData());
  } catch (e) {
    console.error('[tab-out] Collections bookmark read failed:', e);
    view.innerHTML = `<div class="collections-empty">无法读取浏览器书签：${esc(e && e.message ? e.message : String(e))}<br>请确认扩展已获得书签权限，并在浏览器中重新加载扩展。</div>`;
    return;
  }
  const total = temp.length + groups.reduce((n, g) => n + countAllTabs(g), 0);

  const newGroupCard = `
    <div class="group-card new-group-card">
      <input class="new-group-input" id="newGroupInput" type="text" placeholder="新建分组名称…" maxlength="40" autocomplete="off">
      <button class="action-btn primary" data-action="create-group">创建</button>
    </div>`;

  if (total === 0) {
    view.innerHTML = `
      <div class="collections-grid">
        ${newGroupCard}
      </div>
      <div class="collections-empty">还没有浏览器书签。在浏览器中点击地址栏星标即可收藏页面，收藏后会显示在这里。</div>`;
    return;
  }

  const tempCard = groupCardHtml({ id: tempId, name: '临时分组', temp: true, tabs: temp, subgroups: [] });
  const groupCards = groups.map(g => groupCardHtml({ id: g.id, name: g.title, temp: false, sortable: true, tabs: g.tabs, subgroups: g.subgroups || [] })).join('');

  view.innerHTML = `
    <div class="collections-grid">
      ${newGroupCard}
      ${tempCard}
      ${groupCards}
    </div>`;
}

// Export the current collections (groups + bookmarks, including nested
// subgroups) as a downloadable JSON file.
async function exportCollectionsJson() {
  const { temp, groups, tempId } = await getCollectionData();

  // Build a clean serializable tree from the group node structure.
  function serializeGroup(g) {
    return {
      title: g.title || g.name || '未命名分组',
      bookmarks: (g.tabs || []).map(bm => ({
        title: bm.title || bm.url,
        url: bm.url,
        dateAdded: bm.dateAdded || null,
      })),
      subgroups: (g.subgroups || []).map(serializeGroup),
    };
  }

  const exportData = {
    exportedAt: new Date().toISOString(),
    tempGroup: {
      title: '临时分组',
      bookmarks: temp.map(bm => ({
        title: bm.title || bm.url,
        url: bm.url,
        dateAdded: bm.dateAdded || null,
      })),
    },
    groups: groups.map(serializeGroup),
  };

  const json = JSON.stringify(exportData, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  a.download = `tab-out-bookmarks-${ts}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('已导出书签 JSON');
}

function switchView(view) {
  currentView = view;
  const openSection = document.getElementById('openTabsSection');
  const deferredCol = document.getElementById('deferredColumn');
  const collectionsView = document.getElementById('collectionsView');
  document.querySelectorAll('.view-tab').forEach(b => b.classList.toggle('active',
    b.dataset.action === (view === 'collections' ? 'show-collections' : 'show-open-tabs')));

  if (view === 'collections') {
    if (openSection) openSection.style.display = 'none';
    if (deferredCol) deferredCol.style.display = 'none';
    collectionsView.hidden = false;
    renderCollectionsView();
  } else {
    if (openSection) openSection.style.display = '';
    if (deferredCol) deferredCol.style.display = '';
    collectionsView.hidden = true;
  }
}

// Native HTML5 drag & drop for moving tabs between groups. Delegated on the
// container and attached once. Works in Chrome + Firefox (no extra permission).
function initCollectionsInteractions() {
  const view = document.getElementById('collectionsView');
  if (!view) return;

  // Track what is being dragged: 'tab' or 'group'
  let dragType = null;
  let dragGroupId = null;

  view.addEventListener('dragstart', (e) => {
    // IMPORTANT: check group-card-sortable FIRST. A sortable card contains
    // .collection-tab children, so closest('.collection-tab') would match
    // even when dragging the card itself. We must test the card before the
    // tab to avoid misidentifying a group drag as a tab drag.
    const targetEl = e.target instanceof Element ? e.target : null;
    const sortableCard = targetEl ? targetEl.closest('.group-card-sortable') : null;
    const tab = targetEl ? targetEl.closest('.collection-tab') : null;

    if (sortableCard && !tab) {
      // Dragging a whole group card.
      dragType = 'group';
      dragGroupId = sortableCard.dataset.groupId;
      // text/plain is required for the drag to work across browsers.
      // Chrome also requires effectAllowed to match the dropEffect set in
      // dragover, otherwise the drop is silently rejected.
      e.dataTransfer.setData('text/plain', 'group:' + dragGroupId);
      e.dataTransfer.setData('text/group-id', dragGroupId);
      e.dataTransfer.effectAllowed = 'move';
      sortableCard.classList.add('dragging');
      e.stopPropagation();
      return;
    }

    if (tab) {
      // Dragging a tab (bookmark) inside a group.
      dragType = 'tab';
      e.dataTransfer.setData('text/plain', tab.dataset.tabId);
      e.dataTransfer.effectAllowed = 'move';
      tab.classList.add('dragging');
      return;
    }

    // If neither a sortable card nor a tab was dragged, cancel the drag.
    // This prevents Chrome from starting a drag on inner elements (buttons,
    // SVGs) that would confuse the drop logic.
    e.preventDefault();
  });

  view.addEventListener('dragend', (e) => {
    const tab = e.target.closest('.collection-tab');
    if (tab) tab.classList.remove('dragging');
    const card = e.target.closest('.group-card-sortable');
    if (card) card.classList.remove('dragging');
    dragType = null;
    dragGroupId = null;
    view.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
  });

  // Helper: find the target group id from a drop event.
  // Checks .subgroup FIRST (innermost), then .group-card. This ensures that
  // dropping on a subgroup header or body resolves to the subgroup, not the
  // parent group.
  function findDropTargetGroupId(target) {
    // Walk up from the drop target. A .subgroup always wraps a .group-card,
    // so checking .subgroup first gives us the more specific (deeper) match.
    const subgroup = target.closest('.subgroup');
    if (subgroup && subgroup.dataset.groupId) {
      return { id: subgroup.dataset.groupId, element: subgroup };
    }
    const card = target.closest('.group-card');
    if (card && card.dataset.groupId) {
      return { id: card.dataset.groupId, element: card };
    }
    return null;
  }

  // Helper: find the drop target element for highlight purposes.
  function findDropTargetElement(target) {
    const subgroup = target.closest('.subgroup');
    if (subgroup) return subgroup;
    return target.closest('.group-card');
  }

  view.addEventListener('dragover', (e) => {
    // In Chrome, e.target can be a text node or an inner element (button, SVG)
    // that is itself draggable. closest() handles Element targets, but text
    // nodes don't have closest(). Guard against that.
    const targetEl = e.target instanceof Element ? e.target : null;
    const el = targetEl ? findDropTargetElement(targetEl) : null;
    if (!el) return;
    e.preventDefault();                       // REQUIRED to allow a drop
    e.dataTransfer.dropEffect = 'move';
    el.classList.add('drag-over');
  });

  view.addEventListener('dragleave', (e) => {
    const targetEl = e.target instanceof Element ? e.target : null;
    const el = targetEl ? findDropTargetElement(targetEl) : null;
    if (el && !el.contains(e.relatedTarget)) el.classList.remove('drag-over');
  });

  view.addEventListener('drop', async (e) => {
    const targetEl = e.target instanceof Element ? e.target : null;
    const target = targetEl ? findDropTargetGroupId(targetEl) : null;
    if (!target) return;
    e.preventDefault();

    // Clear all drag-over highlights.
    view.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));

    // Use local copies before clearing state, in case dragend fires.
    const localDragType = dragType;
    const localDragGroupId = dragGroupId;

    if (localDragType === 'group') {
      // ---- Swap two groups (cross-row supported) ----
      const targetId = target.id;
      if (!targetId || targetId === localDragGroupId) return;

      // Only swap between two sortable (top-level) group cards.
      const targetCard = view.querySelector(`.group-card-sortable[data-group-id="${targetId}"]`);
      if (!targetCard) return;

      // Find the parent container and index of each folder.
      // Groups may live in different bookmark containers (书签栏 vs 其他书签),
      // so we search ALL containers — not just the bookmarks bar.
      try {
        const containers = await getBookmarkContainers();
        let srcParent = null, srcIdx = -1;
        let dstParent = null, dstIdx = -1;

        for (const container of containers) {
          const folderChildren = (container.children || []).filter(c => isFolderNode(c));
          const ids = folderChildren.map(c => c.id);
          const si = ids.indexOf(localDragGroupId);
          const di = ids.indexOf(targetId);
          if (si !== -1) { srcParent = container.id; srcIdx = si; }
          if (di !== -1) { dstParent = container.id; dstIdx = di; }
        }

        if (srcIdx === -1 || dstIdx === -1) return;

        if (srcParent === dstParent) {
          // Same container: move the higher-index folder down first to avoid shift.
          const lowerIdx = Math.min(srcIdx, dstIdx);
          const higherIdx = Math.max(srcIdx, dstIdx);
          const lowerId = srcIdx < dstIdx ? localDragGroupId : targetId;
          const higherId = srcIdx < dstIdx ? targetId : localDragGroupId;
          await chrome.bookmarks.move(higherId, { index: lowerIdx });
          await chrome.bookmarks.move(lowerId, { index: higherIdx });
        } else {
          // Different containers: move each to the other's position.
          // Chrome's bookmarks.move with a new parentId relocates the folder.
          await chrome.bookmarks.move(localDragGroupId, { parentId: dstParent, index: dstIdx });
          await chrome.bookmarks.move(targetId, { parentId: srcParent, index: srcIdx });
        }
      } catch (err) {
        console.error('[tab-out drag] group swap failed:', err);
      }
      renderCollectionsView();
      return;
    }

    // ---- Dragging a tab (bookmark) into a group (or subgroup) ----
    const tabId = e.dataTransfer.getData('text/plain');
    if (!tabId || tabId.startsWith('group:')) return;
    await moveBookmark(tabId, target.id);
    renderCollectionsView();
  });

  // Enter key in the new-group input triggers create
  view.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.id === 'newGroupInput') {
      e.preventDefault();
      const btn = view.querySelector('[data-action="create-group"]');
      if (btn) btn.click();
    }
  });
}


/* ----------------------------------------------------------------
   UI HELPERS
   ---------------------------------------------------------------- */

/**
 * playCloseSound()
 *
 * Plays a clean "swoosh" sound when tabs are closed.
 * Built entirely with the Web Audio API — no sound files needed.
 * A filtered noise sweep that descends in pitch, like air moving.
 */
function playCloseSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const t = ctx.currentTime;

    // Swoosh: shaped white noise through a sweeping bandpass filter
    const duration = 0.25;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate);
    const data = buffer.getChannelData(0);

    // Generate noise with a natural envelope (quick attack, smooth decay)
    for (let i = 0; i < data.length; i++) {
      const pos = i / data.length;
      // Envelope: ramps up fast in first 10%, then fades out smoothly
      const env = pos < 0.1 ? pos / 0.1 : Math.pow(1 - (pos - 0.1) / 0.9, 1.5);
      data[i] = (Math.random() * 2 - 1) * env;
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;

    // Bandpass filter sweeps from high to low — creates the "swoosh" character
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 2.0;
    filter.frequency.setValueAtTime(4000, t);
    filter.frequency.exponentialRampToValueAtTime(400, t + duration);

    // Volume
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.15, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);

    source.connect(filter).connect(gain).connect(ctx.destination);
    source.start(t);

    setTimeout(() => ctx.close(), 500);
  } catch {
    // Audio not supported — fail silently
  }
}

/**
 * shootConfetti(x, y)
 *
 * Shoots a burst of colorful confetti particles from the given screen
 * coordinates (typically the center of a card being closed).
 * Pure CSS + JS, no libraries.
 */
function shootConfetti(x, y) {
  const colors = [
    '#c8713a', // amber
    '#e8a070', // amber light
    '#5a7a62', // sage
    '#8aaa92', // sage light
    '#5a6b7a', // slate
    '#8a9baa', // slate light
    '#d4b896', // warm paper
    '#b35a5a', // rose
  ];

  const particleCount = 17;

  for (let i = 0; i < particleCount; i++) {
    const el = document.createElement('div');

    const isCircle = Math.random() > 0.5;
    const size = 5 + Math.random() * 6; // 5–11px
    const color = colors[Math.floor(Math.random() * colors.length)];

    el.style.cssText = `
      position: fixed;
      left: ${x}px;
      top: ${y}px;
      width: ${size}px;
      height: ${size}px;
      background: ${color};
      border-radius: ${isCircle ? '50%' : '2px'};
      pointer-events: none;
      z-index: 9999;
      transform: translate(-50%, -50%);
      opacity: 1;
    `;
    document.body.appendChild(el);

    // Physics: random angle and speed for the outward burst
    const angle   = Math.random() * Math.PI * 2;
    const speed   = 60 + Math.random() * 120;
    const vx      = Math.cos(angle) * speed;
    const vy      = Math.sin(angle) * speed - 80; // bias upward
    const gravity = 200;

    const startTime = performance.now();
    const duration  = 700 + Math.random() * 200; // 700–900ms

    function frame(now) {
      const elapsed  = (now - startTime) / 1000;
      const progress = elapsed / (duration / 1000);

      if (progress >= 1) { el.remove(); return; }

      const px = vx * elapsed;
      const py = vy * elapsed + 0.5 * gravity * elapsed * elapsed;
      const opacity = progress < 0.5 ? 1 : 1 - (progress - 0.5) * 2;
      const rotate  = elapsed * 200 * (isCircle ? 0 : 1);

      el.style.transform = `translate(calc(-50% + ${px}px), calc(-50% + ${py}px)) rotate(${rotate}deg)`;
      el.style.opacity = opacity;

      requestAnimationFrame(frame);
    }

    requestAnimationFrame(frame);
  }
}

/**
 * animateCardOut(card)
 *
 * Smoothly removes a mission card: fade + scale down, then confetti.
 * After the animation, checks if the grid is now empty.
 */
function animateCardOut(card) {
  if (!card) return;

  const rect = card.getBoundingClientRect();
  shootConfetti(rect.left + rect.width / 2, rect.top + rect.height / 2);

  card.classList.add('closing');
  setTimeout(() => {
    card.remove();
    checkAndShowEmptyState();
  }, 300);
}

/**
 * showToast(message)
 *
 * Brief pop-up notification at the bottom of the screen.
 */
function showToast(message) {
  const toast = document.getElementById('toast');
  document.getElementById('toastText').textContent = message;
  toast.classList.add('visible');
  setTimeout(() => toast.classList.remove('visible'), 2500);
}

/**
 * showModal(title, defaultValue) — reusable custom dialog with text input.
 * Returns a Promise<string|null>: resolves with the trimmed input value on
 * confirm, or null on cancel / overlay click / Escape.
 */
function showModal(title, defaultValue = '') {
  return _showModalInternal(title, { inputDefault: defaultValue });
}

/**
 * showConfirm(title, message) — reusable custom confirmation dialog.
 * Returns a Promise<boolean>: true on confirm, false on cancel.
 */
function showConfirm(title, message) {
  return _showModalInternal(title, { message, expectBoolean: true });
}

function _showModalInternal(title, opts = {}) {
  return new Promise((resolve) => {
    const overlay = document.getElementById('modalOverlay');
    const titleEl = document.getElementById('modalTitle');
    const messageEl = document.getElementById('modalMessage');
    const input = document.getElementById('modalInput');
    const confirmBtn = document.getElementById('modalConfirm');
    const cancelBtn = document.getElementById('modalCancel');
    if (!overlay) { resolve(opts.expectBoolean ? false : null); return; }

    titleEl.textContent = title;

    // Configure input vs message mode.
    if (opts.message) {
      messageEl.textContent = opts.message;
      messageEl.classList.add('visible');
      input.classList.add('hidden');
    } else {
      messageEl.classList.remove('visible');
      input.classList.remove('hidden');
      input.value = opts.inputDefault || '';
    }

    let settled = false;
    function close(result) {
      if (settled) return;
      settled = true;
      overlay.classList.remove('visible');
      confirmBtn.removeEventListener('click', onConfirm);
      cancelBtn.removeEventListener('click', onCancel);
      input.removeEventListener('keydown', onKeydown);
      overlay.removeEventListener('click', onOverlay);
      resolve(result);
    }
    function onConfirm() {
      if (opts.expectBoolean) { close(true); }
      else { close(input.value.trim() || null); }
    }
    function onCancel() { close(opts.expectBoolean ? false : null); }
    function onKeydown(e) {
      if (e.key === 'Enter') { e.preventDefault(); onConfirm(); }
      if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
    }
    function onOverlay(e) { if (e.target === overlay) close(opts.expectBoolean ? false : null); }

    confirmBtn.addEventListener('click', onConfirm);
    cancelBtn.addEventListener('click', onCancel);
    input.addEventListener('keydown', onKeydown);
    overlay.addEventListener('click', onOverlay);

    overlay.classList.add('visible');
    if (!opts.message) {
      setTimeout(() => { input.focus(); input.select(); }, 50);
    } else {
      setTimeout(() => { confirmBtn.focus(); }, 50);
    }
  });
}

/**
 * checkAndShowEmptyState()
 *
 * Shows a cheerful "Inbox zero" message when all domain cards are gone.
 */
function checkAndShowEmptyState() {
  const missionsEl = document.getElementById('openTabsMissions');
  if (!missionsEl) return;

  const remaining = missionsEl.querySelectorAll('.mission-card:not(.closing)').length;
  if (remaining > 0) return;

  missionsEl.innerHTML = `
    <div class="missions-empty-state">
      <div class="empty-checkmark">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5" />
        </svg>
      </div>
      <div class="empty-title">Inbox zero, but for tabs.</div>
      <div class="empty-subtitle">You're free.</div>
    </div>
  `;

  const countEl = document.getElementById('openTabsSectionCount');
  if (countEl) countEl.textContent = '0 domains';
}

/**
 * timeAgo(dateStr)
 *
 * Converts an ISO date string into a human-friendly relative time.
 * "2026-04-04T10:00:00Z" → "2 hrs ago" or "yesterday"
 */
function timeAgo(dateStr) {
  if (!dateStr) return '';
  const then = new Date(dateStr);
  const now  = new Date();
  const diffMins  = Math.floor((now - then) / 60000);
  const diffHours = Math.floor((now - then) / 3600000);
  const diffDays  = Math.floor((now - then) / 86400000);

  if (diffMins < 1)   return 'just now';
  if (diffMins < 60)  return diffMins + ' min ago';
  if (diffHours < 24) return diffHours + ' hr' + (diffHours !== 1 ? 's' : '') + ' ago';
  if (diffDays === 1) return 'yesterday';
  return diffDays + ' days ago';
}

/**
 * getGreeting() — "Good morning / afternoon / evening"
 */
function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

/**
 * getDateDisplay() — "Friday, April 4, 2026"
 */
function getDateDisplay() {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year:    'numeric',
    month:   'long',
    day:     'numeric',
  });
}


/* ----------------------------------------------------------------
   DOMAIN & TITLE CLEANUP HELPERS
   ---------------------------------------------------------------- */

// Map of known hostnames → friendly display names.
const FRIENDLY_DOMAINS = {
  'github.com':           'GitHub',
  'www.github.com':       'GitHub',
  'gist.github.com':      'GitHub Gist',
  'youtube.com':          'YouTube',
  'www.youtube.com':      'YouTube',
  'music.youtube.com':    'YouTube Music',
  'x.com':                'X',
  'www.x.com':            'X',
  'twitter.com':          'X',
  'www.twitter.com':      'X',
  'reddit.com':           'Reddit',
  'www.reddit.com':       'Reddit',
  'old.reddit.com':       'Reddit',
  'substack.com':         'Substack',
  'www.substack.com':     'Substack',
  'medium.com':           'Medium',
  'www.medium.com':       'Medium',
  'linkedin.com':         'LinkedIn',
  'www.linkedin.com':     'LinkedIn',
  'stackoverflow.com':    'Stack Overflow',
  'www.stackoverflow.com':'Stack Overflow',
  'news.ycombinator.com': 'Hacker News',
  'google.com':           'Google',
  'www.google.com':       'Google',
  'mail.google.com':      'Gmail',
  'docs.google.com':      'Google Docs',
  'drive.google.com':     'Google Drive',
  'calendar.google.com':  'Google Calendar',
  'meet.google.com':      'Google Meet',
  'gemini.google.com':    'Gemini',
  'chatgpt.com':          'ChatGPT',
  'www.chatgpt.com':      'ChatGPT',
  'chat.openai.com':      'ChatGPT',
  'claude.ai':            'Claude',
  'www.claude.ai':        'Claude',
  'code.claude.com':      'Claude Code',
  'notion.so':            'Notion',
  'www.notion.so':        'Notion',
  'figma.com':            'Figma',
  'www.figma.com':        'Figma',
  'slack.com':            'Slack',
  'app.slack.com':        'Slack',
  'discord.com':          'Discord',
  'www.discord.com':      'Discord',
  'wikipedia.org':        'Wikipedia',
  'en.wikipedia.org':     'Wikipedia',
  'amazon.com':           'Amazon',
  'www.amazon.com':       'Amazon',
  'netflix.com':          'Netflix',
  'www.netflix.com':      'Netflix',
  'spotify.com':          'Spotify',
  'open.spotify.com':     'Spotify',
  'vercel.com':           'Vercel',
  'www.vercel.com':       'Vercel',
  'npmjs.com':            'npm',
  'www.npmjs.com':        'npm',
  'developer.mozilla.org':'MDN',
  'arxiv.org':            'arXiv',
  'www.arxiv.org':        'arXiv',
  'huggingface.co':       'Hugging Face',
  'www.huggingface.co':   'Hugging Face',
  'producthunt.com':      'Product Hunt',
  'www.producthunt.com':  'Product Hunt',
  'xiaohongshu.com':      'RedNote',
  'www.xiaohongshu.com':  'RedNote',
  'local-files':          'Local Files',
};

function friendlyDomain(hostname) {
  if (!hostname) return '';
  if (FRIENDLY_DOMAINS[hostname]) return FRIENDLY_DOMAINS[hostname];

  if (hostname.endsWith('.substack.com') && hostname !== 'substack.com') {
    return capitalize(hostname.replace('.substack.com', '')) + "'s Substack";
  }
  if (hostname.endsWith('.github.io')) {
    return capitalize(hostname.replace('.github.io', '')) + ' (GitHub Pages)';
  }

  let clean = hostname
    .replace(/^www\./, '')
    .replace(/\.(com|org|net|io|co|ai|dev|app|so|me|xyz|info|us|uk|co\.uk|co\.jp)$/, '');

  return clean.split('.').map(part => capitalize(part)).join(' ');
}

function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function stripTitleNoise(title) {
  if (!title) return '';
  // Strip leading notification count: "(2) Title"
  title = title.replace(/^\(\d+\+?\)\s*/, '');
  // Strip inline counts like "Inbox (16,359)"
  title = title.replace(/\s*\([\d,]+\+?\)\s*/g, ' ');
  // Strip email addresses (privacy + cleaner display)
  title = title.replace(/\s*[\-\u2010-\u2015]\s*[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, '');
  title = title.replace(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, '');
  // Clean X/Twitter format
  title = title.replace(/\s+on X:\s*/, ': ');
  title = title.replace(/\s*\/\s*X\s*$/, '');
  return title.trim();
}

function cleanTitle(title, hostname) {
  if (!title || !hostname) return title || '';

  const friendly = friendlyDomain(hostname);
  const domain   = hostname.replace(/^www\./, '');
  const seps     = [' - ', ' | ', ' — ', ' · ', ' – '];

  for (const sep of seps) {
    const idx = title.lastIndexOf(sep);
    if (idx === -1) continue;
    const suffix     = title.slice(idx + sep.length).trim();
    const suffixLow  = suffix.toLowerCase();
    if (
      suffixLow === domain.toLowerCase() ||
      suffixLow === friendly.toLowerCase() ||
      suffixLow === domain.replace(/\.\w+$/, '').toLowerCase() ||
      domain.toLowerCase().includes(suffixLow) ||
      friendly.toLowerCase().includes(suffixLow)
    ) {
      const cleaned = title.slice(0, idx).trim();
      if (cleaned.length >= 5) return cleaned;
    }
  }
  return title;
}

function smartTitle(title, url) {
  if (!url) return title || '';
  let pathname = '', hostname = '';
  try { const u = new URL(url); pathname = u.pathname; hostname = u.hostname; }
  catch { return title || ''; }

  const titleIsUrl = !title || title === url || title.startsWith(hostname) || title.startsWith('http');

  if ((hostname === 'x.com' || hostname === 'twitter.com' || hostname === 'www.x.com') && pathname.includes('/status/')) {
    const username = pathname.split('/')[1];
    if (username) return titleIsUrl ? `Post by @${username}` : title;
  }

  if (hostname === 'github.com' || hostname === 'www.github.com') {
    const parts = pathname.split('/').filter(Boolean);
    if (parts.length >= 2) {
      const [owner, repo, ...rest] = parts;
      if (rest[0] === 'issues' && rest[1]) return `${owner}/${repo} Issue #${rest[1]}`;
      if (rest[0] === 'pull'   && rest[1]) return `${owner}/${repo} PR #${rest[1]}`;
      if (rest[0] === 'blob' || rest[0] === 'tree') return `${owner}/${repo} — ${rest.slice(2).join('/')}`;
      if (titleIsUrl) return `${owner}/${repo}`;
    }
  }

  if ((hostname === 'www.youtube.com' || hostname === 'youtube.com') && pathname === '/watch') {
    if (titleIsUrl) return 'YouTube Video';
  }

  if ((hostname === 'www.reddit.com' || hostname === 'reddit.com' || hostname === 'old.reddit.com') && pathname.includes('/comments/')) {
    const parts  = pathname.split('/').filter(Boolean);
    const subIdx = parts.indexOf('r');
    if (subIdx !== -1 && parts[subIdx + 1]) {
      if (titleIsUrl) return `r/${parts[subIdx + 1]} post`;
    }
  }

  return title || url;
}


/* ----------------------------------------------------------------
   SVG ICON STRINGS
   ---------------------------------------------------------------- */
const ICONS = {
  tabs:    `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M3 8.25V18a2.25 2.25 0 0 0 2.25 2.25h13.5A2.25 2.25 0 0 0 21 18V8.25m-18 0V6a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 6v2.25m-18 0h18" /></svg>`,
  close:   `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>`,
  archive: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 0 1-2.247 2.118H6.622a2.25 2.25 0 0 1-2.247-2.118L3.75 7.5m6 4.125l2.25 2.25m0 0l2.25 2.25M12 13.875l2.25-2.25M12 13.875l-2.25 2.25M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125Z" /></svg>`,
  focus:   `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="m4.5 19.5 15-15m0 0H8.25m11.25 0v11.25" /></svg>`,
};


/* ----------------------------------------------------------------
   IN-MEMORY STORE FOR OPEN-TAB GROUPS
   ---------------------------------------------------------------- */
let domainGroups = [];


/* ----------------------------------------------------------------
   HELPER: filter out browser-internal pages
   ---------------------------------------------------------------- */

/**
 * getRealTabs()
 *
 * Returns tabs that are real web pages — no chrome://, extension
 * pages, about:blank, etc.
 */
function getRealTabs() {
  return openTabs.filter(t => {
    const url = t.url || '';
    return (
      !url.startsWith('chrome://') &&
      !url.startsWith('chrome-extension://') &&
      !url.startsWith('moz-extension://') &&
      !url.startsWith('about:') &&
      !url.startsWith('edge://') &&
      !url.startsWith('brave://')
    );
  });
}

/**
 * checkTabOutDupes()
 *
 * Counts how many Tab Out pages are open. If more than 1,
 * shows a banner offering to close the extras.
 */
function checkTabOutDupes() {
  const tabOutTabs = openTabs.filter(t => t.isTabOut);
  const banner  = document.getElementById('tabOutDupeBanner');
  const countEl = document.getElementById('tabOutDupeCount');
  if (!banner) return;

  if (tabOutTabs.length > 1) {
    if (countEl) countEl.textContent = tabOutTabs.length;
    banner.style.display = 'flex';
  } else {
    banner.style.display = 'none';
  }
}


/* ----------------------------------------------------------------
   OVERFLOW CHIPS ("+N more" expand button in domain cards)
   ---------------------------------------------------------------- */

function buildOverflowChips(hiddenTabs, urlCounts = {}) {
  const hiddenChips = hiddenTabs.map(tab => {
    const label    = cleanTitle(smartTitle(stripTitleNoise(tab.title || ''), tab.url), '');
    const count    = urlCounts[tab.url] || 1;
    const dupeTag  = count > 1 ? ` <span class="chip-dupe-badge">(${count}x)</span>` : '';
    const chipClass = count > 1 ? ' chip-has-dupes' : '';
    const safeUrl   = (tab.url || '').replace(/"/g, '&quot;');
    const safeTitle = label.replace(/"/g, '&quot;');
    let domain = '';
    try { domain = new URL(tab.url).hostname; } catch {}
    const faviconUrl = domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=16` : '';
    return `<div class="page-chip clickable${chipClass}" data-action="focus-tab" data-tab-url="${safeUrl}" title="${safeTitle}">
      ${faviconUrl ? `<img class="chip-favicon" src="${faviconUrl}" alt="">` : ''}
      <span class="chip-text">${label}</span>${dupeTag}
      <div class="chip-actions">
        <button class="chip-action chip-save" data-action="defer-single-tab" data-tab-url="${safeUrl}" data-tab-title="${safeTitle}" title="Save for later">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z" /></svg>
        </button>
        <button class="chip-action chip-close" data-action="close-single-tab" data-tab-url="${safeUrl}" title="Close this tab">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
        </button>
      </div>
    </div>`;
  }).join('');

  return `
    <div class="page-chips-overflow" style="display:none">${hiddenChips}</div>
    <div class="page-chip page-chip-overflow clickable" data-action="expand-chips">
      <span class="chip-text">+${hiddenTabs.length} more</span>
    </div>`;
}


/* ----------------------------------------------------------------
   DOMAIN CARD RENDERER
   ---------------------------------------------------------------- */

/**
 * renderDomainCard(group, groupIndex)
 *
 * Builds the HTML for one domain group card.
 * group = { domain: string, tabs: [{ url, title, id, windowId, active }] }
 */
function renderDomainCard(group) {
  const tabs      = group.tabs || [];
  const tabCount  = tabs.length;
  const isLanding = group.domain === '__landing-pages__';
  const stableId  = 'domain-' + group.domain.replace(/[^a-z0-9]/g, '-');

  // Count duplicates (exact URL match)
  const urlCounts = {};
  for (const tab of tabs) urlCounts[tab.url] = (urlCounts[tab.url] || 0) + 1;
  const dupeUrls   = Object.entries(urlCounts).filter(([, c]) => c > 1);
  const hasDupes   = dupeUrls.length > 0;
  const totalExtras = dupeUrls.reduce((s, [, c]) => s + c - 1, 0);

  const tabBadge = `<span class="open-tabs-badge">
    ${ICONS.tabs}
    ${tabCount} tab${tabCount !== 1 ? 's' : ''} open
  </span>`;

  const dupeBadge = hasDupes
    ? `<span class="open-tabs-badge" style="color:var(--accent-amber);background:rgba(200,113,58,0.08);">
        ${totalExtras} duplicate${totalExtras !== 1 ? 's' : ''}
      </span>`
    : '';

  // Deduplicate for display: show each URL once, with (Nx) badge if duped
  const seen = new Set();
  const uniqueTabs = [];
  for (const tab of tabs) {
    if (!seen.has(tab.url)) { seen.add(tab.url); uniqueTabs.push(tab); }
  }

  const visibleTabs = uniqueTabs.slice(0, 8);
  const extraCount  = uniqueTabs.length - visibleTabs.length;

  const pageChips = visibleTabs.map(tab => {
    let label = cleanTitle(smartTitle(stripTitleNoise(tab.title || ''), tab.url), group.domain);
    // For localhost tabs, prepend port number so you can tell projects apart
    try {
      const parsed = new URL(tab.url);
      if (parsed.hostname === 'localhost' && parsed.port) label = `${parsed.port} ${label}`;
    } catch {}
    const count    = urlCounts[tab.url];
    const dupeTag  = count > 1 ? ` <span class="chip-dupe-badge">(${count}x)</span>` : '';
    const chipClass = count > 1 ? ' chip-has-dupes' : '';
    const safeUrl   = (tab.url || '').replace(/"/g, '&quot;');
    const safeTitle = label.replace(/"/g, '&quot;');
    let domain = '';
    try { domain = new URL(tab.url).hostname; } catch {}
    const faviconUrl = domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=16` : '';
    return `<div class="page-chip clickable${chipClass}" data-action="focus-tab" data-tab-url="${safeUrl}" title="${safeTitle}">
      ${faviconUrl ? `<img class="chip-favicon" src="${faviconUrl}" alt="">` : ''}
      <span class="chip-text">${label}</span>${dupeTag}
      <div class="chip-actions">
        <button class="chip-action chip-save" data-action="defer-single-tab" data-tab-url="${safeUrl}" data-tab-title="${safeTitle}" title="Save for later">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z" /></svg>
        </button>
        <button class="chip-action chip-close" data-action="close-single-tab" data-tab-url="${safeUrl}" title="Close this tab">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
        </button>
      </div>
    </div>`;
  }).join('') + (extraCount > 0 ? buildOverflowChips(uniqueTabs.slice(8), urlCounts) : '');

  let actionsHtml = `
    <button class="action-btn close-tabs" data-action="close-domain-tabs" data-domain-id="${stableId}">
      ${ICONS.close}
      Close all ${tabCount} tab${tabCount !== 1 ? 's' : ''}
    </button>`;

  if (hasDupes) {
    const dupeUrlsEncoded = dupeUrls.map(([url]) => encodeURIComponent(url)).join(',');
    actionsHtml += `
      <button class="action-btn" data-action="dedup-keep-one" data-dupe-urls="${dupeUrlsEncoded}">
        Close ${totalExtras} duplicate${totalExtras !== 1 ? 's' : ''}
      </button>`;
  }

  return `
    <div class="mission-card domain-card ${hasDupes ? 'has-amber-bar' : 'has-neutral-bar'}" data-domain-id="${stableId}">
      <div class="status-bar"></div>
      <div class="mission-content">
        <div class="mission-top">
          <span class="mission-name">${isLanding ? 'Homepages' : (group.label || friendlyDomain(group.domain))}</span>
          ${tabBadge}
          ${dupeBadge}
        </div>
        <div class="mission-pages">${pageChips}</div>
        <div class="actions">${actionsHtml}</div>
      </div>
      <div class="mission-meta">
        <div class="mission-page-count">${tabCount}</div>
        <div class="mission-page-label">tabs</div>
      </div>
    </div>`;
}


/* ----------------------------------------------------------------
   SAVED FOR LATER — Render Checklist Column
   ---------------------------------------------------------------- */

/**
 * renderDeferredColumn()
 *
 * Reads saved tabs from chrome.storage.local and renders the right-side
 * "Saved for Later" checklist column. Shows active items as a checklist
 * and completed items in a collapsible archive.
 */
async function renderDeferredColumn() {
  const column         = document.getElementById('deferredColumn');
  const list           = document.getElementById('deferredList');
  const empty          = document.getElementById('deferredEmpty');
  const countEl        = document.getElementById('deferredCount');
  const archiveEl      = document.getElementById('deferredArchive');
  const archiveCountEl = document.getElementById('archiveCount');
  const archiveList    = document.getElementById('archiveList');

  if (!column) return;

  try {
    const { active, archived } = await getSavedTabs();

    // Hide the entire column if there's nothing to show
    if (active.length === 0 && archived.length === 0) {
      column.style.display = 'none';
      return;
    }

    column.style.display = 'block';

    // Render active checklist items
    if (active.length > 0) {
      countEl.textContent = `${active.length} item${active.length !== 1 ? 's' : ''}`;
      list.innerHTML = active.map(item => renderDeferredItem(item)).join('');
      list.style.display = 'block';
      empty.style.display = 'none';
    } else {
      list.style.display = 'none';
      countEl.textContent = '';
      empty.style.display = 'block';
    }

    // Render archive section
    if (archived.length > 0) {
      archiveCountEl.textContent = `(${archived.length})`;
      archiveList.innerHTML = archived.map(item => renderArchiveItem(item)).join('');
      archiveEl.style.display = 'block';
    } else {
      archiveEl.style.display = 'none';
    }

  } catch (err) {
    console.warn('[tab-out] Could not load saved tabs:', err);
    column.style.display = 'none';
  }
}

/**
 * renderDeferredItem(item)
 *
 * Builds HTML for one active checklist item: checkbox, title link,
 * domain, time ago, dismiss button.
 */
function renderDeferredItem(item) {
  let domain = '';
  try { domain = new URL(item.url).hostname.replace(/^www\./, ''); } catch {}
  const faviconUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=16`;
  const ago = timeAgo(item.savedAt);

  return `
    <div class="deferred-item" data-deferred-id="${item.id}">
      <input type="checkbox" class="deferred-checkbox" data-action="check-deferred" data-deferred-id="${item.id}">
      <div class="deferred-info">
        <a href="${item.url}" target="_blank" rel="noopener" class="deferred-title" title="${(item.title || '').replace(/"/g, '&quot;')}">
          <img class="deferred-favicon" src="${faviconUrl}" alt="" style="width:14px;height:14px;vertical-align:-2px;margin-right:4px">${item.title || item.url}
        </a>
        <div class="deferred-meta">
          <span>${domain}</span>
          <span>${ago}</span>
        </div>
      </div>
      <button class="deferred-dismiss" data-action="dismiss-deferred" data-deferred-id="${item.id}" title="Dismiss">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
      </button>
    </div>`;
}

/**
 * renderArchiveItem(item)
 *
 * Builds HTML for one completed/archived item (simpler: just title + date).
 */
function renderArchiveItem(item) {
  const ago = item.completedAt ? timeAgo(item.completedAt) : timeAgo(item.savedAt);
  return `
    <div class="archive-item">
      <a href="${item.url}" target="_blank" rel="noopener" class="archive-item-title" title="${(item.title || '').replace(/"/g, '&quot;')}">
        ${item.title || item.url}
      </a>
      <span class="archive-item-date">${ago}</span>
    </div>`;
}


/* ----------------------------------------------------------------
   MAIN DASHBOARD RENDERER
   ---------------------------------------------------------------- */

/**
 * renderStaticDashboard()
 *
 * The main render function:
 * 1. Paints greeting + date
 * 2. Fetches open tabs via chrome.tabs.query()
 * 3. Groups tabs by domain (with landing pages pulled out to their own group)
 * 4. Renders domain cards
 * 5. Updates footer stats
 * 6. Renders the "Saved for Later" checklist
 */
async function renderStaticDashboard() {
  // --- Header ---
  const greetingEl = document.getElementById('greeting');
  const dateEl     = document.getElementById('dateDisplay');
  if (greetingEl) greetingEl.textContent = getGreeting();
  if (dateEl)     dateEl.textContent     = getDateDisplay();

  // --- Fetch tabs ---
  await fetchOpenTabs();
  const realTabs = getRealTabs();

  // --- Group tabs by domain ---
  // Landing pages (Gmail inbox, Twitter home, etc.) get their own special group
  // so they can be closed together without affecting content tabs on the same domain.
  const LANDING_PAGE_PATTERNS = [
    { hostname: 'mail.google.com', test: (p, h) =>
        !h.includes('#inbox/') && !h.includes('#sent/') && !h.includes('#search/') },
    { hostname: 'x.com',               pathExact: ['/home'] },
    { hostname: 'www.linkedin.com',    pathExact: ['/'] },
    { hostname: 'github.com',          pathExact: ['/'] },
    { hostname: 'www.youtube.com',     pathExact: ['/'] },
    // Merge personal patterns from config.local.js (if it exists)
    ...(typeof LOCAL_LANDING_PAGE_PATTERNS !== 'undefined' ? LOCAL_LANDING_PAGE_PATTERNS : []),
  ];

  function isLandingPage(url) {
    try {
      const parsed = new URL(url);
      return LANDING_PAGE_PATTERNS.some(p => {
        // Support both exact hostname and suffix matching (for wildcard subdomains)
        const hostnameMatch = p.hostname
          ? parsed.hostname === p.hostname
          : p.hostnameEndsWith
            ? parsed.hostname.endsWith(p.hostnameEndsWith)
            : false;
        if (!hostnameMatch) return false;
        if (p.test)       return p.test(parsed.pathname, url);
        if (p.pathPrefix) return parsed.pathname.startsWith(p.pathPrefix);
        if (p.pathExact)  return p.pathExact.includes(parsed.pathname);
        return parsed.pathname === '/';
      });
    } catch { return false; }
  }

  domainGroups = [];
  const groupMap    = {};
  const landingTabs = [];

  // Custom group rules from config.local.js (if any)
  const customGroups = typeof LOCAL_CUSTOM_GROUPS !== 'undefined' ? LOCAL_CUSTOM_GROUPS : [];

  // Check if a URL matches a custom group rule; returns the rule or null
  function matchCustomGroup(url) {
    try {
      const parsed = new URL(url);
      return customGroups.find(r => {
        const hostMatch = r.hostname
          ? parsed.hostname === r.hostname
          : r.hostnameEndsWith
            ? parsed.hostname.endsWith(r.hostnameEndsWith)
            : false;
        if (!hostMatch) return false;
        if (r.pathPrefix) return parsed.pathname.startsWith(r.pathPrefix);
        return true; // hostname matched, no path filter
      }) || null;
    } catch { return null; }
  }

  for (const tab of realTabs) {
    try {
      if (isLandingPage(tab.url)) {
        landingTabs.push(tab);
        continue;
      }

      // Check custom group rules first (e.g. merge subdomains, split by path)
      const customRule = matchCustomGroup(tab.url);
      if (customRule) {
        const key = customRule.groupKey;
        if (!groupMap[key]) groupMap[key] = { domain: key, label: customRule.groupLabel, tabs: [] };
        groupMap[key].tabs.push(tab);
        continue;
      }

      let hostname;
      if (tab.url && tab.url.startsWith('file://')) {
        hostname = 'local-files';
      } else {
        hostname = new URL(tab.url).hostname;
      }
      if (!hostname) continue;

      if (!groupMap[hostname]) groupMap[hostname] = { domain: hostname, tabs: [] };
      groupMap[hostname].tabs.push(tab);
    } catch {
      // Skip malformed URLs
    }
  }

  if (landingTabs.length > 0) {
    groupMap['__landing-pages__'] = { domain: '__landing-pages__', tabs: landingTabs };
  }

  // Sort: landing pages first, then domains from landing page sites, then by tab count
  // Collect exact hostnames and suffix patterns for priority sorting
  const landingHostnames = new Set(LANDING_PAGE_PATTERNS.map(p => p.hostname).filter(Boolean));
  const landingSuffixes = LANDING_PAGE_PATTERNS.map(p => p.hostnameEndsWith).filter(Boolean);
  function isLandingDomain(domain) {
    if (landingHostnames.has(domain)) return true;
    return landingSuffixes.some(s => domain.endsWith(s));
  }
  domainGroups = Object.values(groupMap).sort((a, b) => {
    const aIsLanding = a.domain === '__landing-pages__';
    const bIsLanding = b.domain === '__landing-pages__';
    if (aIsLanding !== bIsLanding) return aIsLanding ? -1 : 1;

    const aIsPriority = isLandingDomain(a.domain);
    const bIsPriority = isLandingDomain(b.domain);
    if (aIsPriority !== bIsPriority) return aIsPriority ? -1 : 1;

    return b.tabs.length - a.tabs.length;
  });

  // --- Render domain cards ---
  const openTabsSection      = document.getElementById('openTabsSection');
  const openTabsMissionsEl   = document.getElementById('openTabsMissions');
  const openTabsSectionCount = document.getElementById('openTabsSectionCount');
  const openTabsSectionTitle = document.getElementById('openTabsSectionTitle');

  if (domainGroups.length > 0 && openTabsSection) {
    if (openTabsSectionTitle) openTabsSectionTitle.textContent = 'Open tabs';
    openTabsSectionCount.innerHTML = `${domainGroups.length} domain${domainGroups.length !== 1 ? 's' : ''} &nbsp;&middot;&nbsp; <button class="action-btn close-tabs" data-action="close-all-open-tabs" style="font-size:11px;padding:3px 10px;">${ICONS.close} Close all ${realTabs.length} tabs</button>`;
    openTabsMissionsEl.innerHTML = domainGroups.map(g => renderDomainCard(g)).join('');
    openTabsSection.style.display = 'block';
  } else if (openTabsSection) {
    openTabsSection.style.display = 'none';
  }

  // --- Footer stats ---
  const statTabs = document.getElementById('statTabs');
  if (statTabs) statTabs.textContent = openTabs.length;

  // --- Check for duplicate Tab Out tabs ---
  checkTabOutDupes();

  // --- Render "Saved for Later" column ---
  await renderDeferredColumn();
}

async function renderDashboard() {
  await renderStaticDashboard();
}


/* ----------------------------------------------------------------
   EVENT HANDLERS — using event delegation

   One listener on document handles ALL button clicks.
   Think of it as one security guard watching the whole building
   instead of one per door.
   ---------------------------------------------------------------- */

// ---- Favicon load-failure handler (event delegation) ----
// Uses capture phase because the 'error' event does NOT bubble.
// Replaces the old inline onerror="" attributes that violated CSP.
document.addEventListener('error', (e) => {
  const img = e.target;
  if (img && img.tagName === 'IMG' && img.classList.contains('chip-favicon')) {
    img.style.visibility = 'hidden';
  } else if (img && img.tagName === 'IMG' && img.classList.contains('deferred-favicon')) {
    img.style.display = 'none';
  }
}, true);

document.addEventListener('click', async (e) => {
  // Walk up the DOM to find the nearest element with data-action
  const actionEl = e.target.closest('[data-action]');
  if (!actionEl) return;

  const action = actionEl.dataset.action;

  // ---- Close duplicate Tab Out tabs ----
  if (action === 'close-tabout-dupes') {
    await closeTabOutDupes();
    playCloseSound();
    const banner = document.getElementById('tabOutDupeBanner');
    if (banner) {
      banner.style.transition = 'opacity 0.4s';
      banner.style.opacity = '0';
      setTimeout(() => { banner.style.display = 'none'; banner.style.opacity = '1'; }, 400);
    }
    showToast('Closed extra Tab Out tabs');
    return;
  }

  const card = actionEl.closest('.mission-card');

  // ---- Expand overflow chips ("+N more") ----
  if (action === 'expand-chips') {
    const overflowContainer = actionEl.parentElement.querySelector('.page-chips-overflow');
    if (overflowContainer) {
      overflowContainer.style.display = 'contents';
      actionEl.remove();
    }
    return;
  }

  // ---- Focus a specific tab ----
  if (action === 'focus-tab') {
    const tabUrl = actionEl.dataset.tabUrl;
    if (tabUrl) await focusTab(tabUrl);
    return;
  }

  // ---- Close a single tab ----
  if (action === 'close-single-tab') {
    e.stopPropagation(); // don't trigger parent chip's focus-tab
    const tabUrl = actionEl.dataset.tabUrl;
    if (!tabUrl) return;

    // Close the tab in Chrome directly
    const allTabs = await chrome.tabs.query({});
    const match   = allTabs.find(t => t.url === tabUrl);
    if (match) await chrome.tabs.remove(match.id);
    await fetchOpenTabs();

    playCloseSound();

    // Animate the chip row out
    const chip = actionEl.closest('.page-chip');
    if (chip) {
      const rect = chip.getBoundingClientRect();
      shootConfetti(rect.left + rect.width / 2, rect.top + rect.height / 2);
      chip.style.transition = 'opacity 0.2s, transform 0.2s';
      chip.style.opacity    = '0';
      chip.style.transform  = 'scale(0.8)';
      setTimeout(() => {
        chip.remove();
        // If the card now has no tabs, remove it too
        const parentCard = document.querySelector('.mission-card:has(.mission-pages:empty)');
        if (parentCard) animateCardOut(parentCard);
        document.querySelectorAll('.mission-card').forEach(c => {
          if (c.querySelectorAll('.page-chip[data-action="focus-tab"]').length === 0) {
            animateCardOut(c);
          }
        });
      }, 200);
    }

    // Update footer
    const statTabs = document.getElementById('statTabs');
    if (statTabs) statTabs.textContent = openTabs.length;

    showToast('Tab closed');
    return;
  }

  // ---- Save a single tab for later (then close it) ----
  if (action === 'defer-single-tab') {
    e.stopPropagation();
    const tabUrl   = actionEl.dataset.tabUrl;
    const tabTitle = actionEl.dataset.tabTitle || tabUrl;
    if (!tabUrl) return;

    // Save to chrome.storage.local
    try {
      await saveTabForLater({ url: tabUrl, title: tabTitle });
    } catch (err) {
      console.error('[tab-out] Failed to save tab:', err);
      showToast('Failed to save tab');
      return;
    }

    // Close the tab in Chrome
    const allTabs = await chrome.tabs.query({});
    const match   = allTabs.find(t => t.url === tabUrl);
    if (match) await chrome.tabs.remove(match.id);
    await fetchOpenTabs();

    // Animate chip out
    const chip = actionEl.closest('.page-chip');
    if (chip) {
      chip.style.transition = 'opacity 0.2s, transform 0.2s';
      chip.style.opacity    = '0';
      chip.style.transform  = 'scale(0.8)';
      setTimeout(() => chip.remove(), 200);
    }

    showToast('Saved for later');
    await renderDeferredColumn();
    return;
  }

  // ---- Check off a saved tab (moves it to archive) ----
  if (action === 'check-deferred') {
    const id = actionEl.dataset.deferredId;
    if (!id) return;

    await checkOffSavedTab(id);

    // Animate: strikethrough first, then slide out
    const item = actionEl.closest('.deferred-item');
    if (item) {
      item.classList.add('checked');
      setTimeout(() => {
        item.classList.add('removing');
        setTimeout(() => {
          item.remove();
          renderDeferredColumn(); // refresh counts and archive
        }, 300);
      }, 800);
    }
    return;
  }

  // ---- Dismiss a saved tab (removes it entirely) ----
  if (action === 'dismiss-deferred') {
    const id = actionEl.dataset.deferredId;
    if (!id) return;

    await dismissSavedTab(id);

    const item = actionEl.closest('.deferred-item');
    if (item) {
      item.classList.add('removing');
      setTimeout(() => {
        item.remove();
        renderDeferredColumn();
      }, 300);
    }
    return;
  }

  // ---- Collections: switch views ----
  if (action === 'show-collections') {
    switchView('collections');
    return;
  }
  if (action === 'export-collections') {
    await exportCollectionsJson();
    return;
  }
  if (action === 'show-open-tabs') {
    switchView('open');
    return;
  }

  // ---- Collections: create a new group (bookmarks folder) ----
  if (action === 'create-group') {
    const input = document.getElementById('newGroupInput');
    const name = input ? input.value : '';
    if (name.trim()) {
      await createBookmarkGroup(name);
      renderCollectionsView();
      showToast('已新建分组');
    } else if (input) {
      input.focus();
    }
    return;
  }

  // ---- Collections: add a subgroup inside an existing group ----
  if (action === 'add-subgroup') {
    const parentId = actionEl.dataset.groupId;
    if (!parentId) return;
    // Check depth: find the target group's depth in the tree.
    const { groups } = await getCollectionData();
    const found = findGroupDepth(groups, parentId);
    if (found != null && found >= MAX_SUBGROUP_DEPTH) {
      await showConfirm('提示', `已达到最大嵌套深度（${MAX_SUBGROUP_DEPTH} 层），无法继续创建子分组。`);
      return;
    }
    const name = await showModal('新建子分组', '');
    if (name) {
      try {
        await createBookmarkGroup(name, parentId);
        renderCollectionsView();
        showToast('已新建子分组');
      } catch (e) {
        showToast('新建子分组失败：' + (e.message || e));
      }
    }
    return;
  }

  // ---- Collections: rename a group ----
  if (action === 'rename-group') {
    const groupId = actionEl.dataset.groupId;
    if (!groupId) return;
    const { groups } = await getCollectionData();
    const g = groups.find(x => x.id === groupId);
    const currentName = g ? g.title : '';
    const newName = await showModal('重命名分组', currentName);
    if (newName && newName !== currentName) {
      try {
        await renameBookmarkGroup(groupId, newName);
        renderCollectionsView();
        showToast('已重命名分组');
      } catch (e) {
        showToast('重命名失败：' + (e.message || e));
      }
    }
    return;
  }

  // ---- Collections: delete a group (its bookmarks move to 临时分组) ----
  if (action === 'delete-group') {
    const groupId = actionEl.dataset.groupId;
    if (!groupId) return;
    const { groups } = await getCollectionData();
    const g = groups.find(x => x.id === groupId);
    const n = g ? countAllTabs(g) : 0;
    const groupName = g ? g.title : '';
    const confirmed = await showConfirm('删除分组', `删除分组「${groupName}」？其下 ${n} 个书签将移入「临时分组」。`);
    if (confirmed) {
      await deleteBookmarkGroup(groupId);
      renderCollectionsView();
      showToast('已删除分组，书签移入临时分组');
    }
    return;
  }

  // ---- Collections: toggle subgroup expand/collapse ----
  if (action === 'toggle-subgroup') {
    const groupId = actionEl.dataset.groupId;
    if (!groupId) return;
    // Toggle collapse state and re-render to apply consistently.
    if (collapsedSubgroups.has(groupId)) {
      collapsedSubgroups.delete(groupId);
    } else {
      collapsedSubgroups.add(groupId);
    }
    renderCollectionsView();
    return;
  }

  // ---- Collections: delete a single bookmark ----
  if (action === 'delete-bookmark') {
    const id = actionEl.dataset.tabId;
    if (!id) return;
    const row = actionEl.closest('.collection-tab');
    await deleteBookmark(id);
    if (row) {
      row.classList.add('removing');
      setTimeout(() => renderCollectionsView(), 300);
    } else {
      renderCollectionsView();
    }
    return;
  }

  // ---- Collections: open a bookmark in a new browser tab ----
  if (action === 'open-bookmark') {
    const id = actionEl.dataset.tabId;
    try {
      const nodes = await chrome.bookmarks.get(id);
      const bm = nodes && nodes[0];
      if (bm && bm.url) chrome.tabs.create({ url: bm.url });
    } catch { /* bookmark not found */ }
    return;
  }

  // ---- Close all tabs in a domain group ----
  if (action === 'close-domain-tabs') {
    const domainId = actionEl.dataset.domainId;
    const group    = domainGroups.find(g => {
      return 'domain-' + g.domain.replace(/[^a-z0-9]/g, '-') === domainId;
    });
    if (!group) return;

    const urls      = group.tabs.map(t => t.url);
    // Landing pages and custom groups (whose domain key isn't a real hostname)
    // must use exact URL matching to avoid closing unrelated tabs
    const useExact  = group.domain === '__landing-pages__' || !!group.label;

    if (useExact) {
      await closeTabsExact(urls);
    } else {
      await closeTabsByUrls(urls);
    }

    if (card) {
      playCloseSound();
      animateCardOut(card);
    }

    // Remove from in-memory groups
    const idx = domainGroups.indexOf(group);
    if (idx !== -1) domainGroups.splice(idx, 1);

    const groupLabel = group.domain === '__landing-pages__' ? 'Homepages' : (group.label || friendlyDomain(group.domain));
    showToast(`Closed ${urls.length} tab${urls.length !== 1 ? 's' : ''} from ${groupLabel}`);

    const statTabs = document.getElementById('statTabs');
    if (statTabs) statTabs.textContent = openTabs.length;
    return;
  }

  // ---- Close duplicates, keep one copy ----
  if (action === 'dedup-keep-one') {
    const urlsEncoded = actionEl.dataset.dupeUrls || '';
    const urls = urlsEncoded.split(',').map(u => decodeURIComponent(u)).filter(Boolean);
    if (urls.length === 0) return;

    await closeDuplicateTabs(urls, true);
    playCloseSound();

    // Hide the dedup button
    actionEl.style.transition = 'opacity 0.2s';
    actionEl.style.opacity    = '0';
    setTimeout(() => actionEl.remove(), 200);

    // Remove dupe badges from the card
    if (card) {
      card.querySelectorAll('.chip-dupe-badge').forEach(b => {
        b.style.transition = 'opacity 0.2s';
        b.style.opacity    = '0';
        setTimeout(() => b.remove(), 200);
      });
      card.querySelectorAll('.open-tabs-badge').forEach(badge => {
        if (badge.textContent.includes('duplicate')) {
          badge.style.transition = 'opacity 0.2s';
          badge.style.opacity    = '0';
          setTimeout(() => badge.remove(), 200);
        }
      });
      card.classList.remove('has-amber-bar');
      card.classList.add('has-neutral-bar');
    }

    showToast('Closed duplicates, kept one copy each');
    return;
  }

  // ---- Close ALL open tabs ----
  if (action === 'close-all-open-tabs') {
    const allUrls = openTabs
      .filter(t => t.url && !t.url.startsWith('chrome') && !t.url.startsWith('about:'))
      .map(t => t.url);
    await closeTabsByUrls(allUrls);
    playCloseSound();

    document.querySelectorAll('#openTabsMissions .mission-card').forEach(c => {
      shootConfetti(
        c.getBoundingClientRect().left + c.offsetWidth / 2,
        c.getBoundingClientRect().top  + c.offsetHeight / 2
      );
      animateCardOut(c);
    });

    showToast('All tabs closed. Fresh start.');
    return;
  }
});

// ---- Archive toggle — expand/collapse the archive section ----
document.addEventListener('click', (e) => {
  const toggle = e.target.closest('#archiveToggle');
  if (!toggle) return;

  toggle.classList.toggle('open');
  const body = document.getElementById('archiveBody');
  if (body) {
    body.style.display = body.style.display === 'none' ? 'block' : 'none';
  }
});

// ---- Archive search — filter archived items as user types ----
document.addEventListener('input', async (e) => {
  if (e.target.id !== 'archiveSearch') return;

  const q = e.target.value.trim().toLowerCase();
  const archiveList = document.getElementById('archiveList');
  if (!archiveList) return;

  try {
    const { archived } = await getSavedTabs();

    if (q.length < 2) {
      // Show all archived items
      archiveList.innerHTML = archived.map(item => renderArchiveItem(item)).join('');
      return;
    }

    // Filter by title or URL containing the query string
    const results = archived.filter(item =>
      (item.title || '').toLowerCase().includes(q) ||
      (item.url  || '').toLowerCase().includes(q)
    );

    archiveList.innerHTML = results.map(item => renderArchiveItem(item)).join('')
      || '<div style="font-size:12px;color:var(--muted);padding:8px 0">No results</div>';
  } catch (err) {
    console.warn('[tab-out] Archive search failed:', err);
  }
});


/* ----------------------------------------------------------------
   INITIALIZE
   ---------------------------------------------------------------- */
renderDashboard();
initCollectionsInteractions();
