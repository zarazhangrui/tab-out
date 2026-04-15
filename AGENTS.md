# AGENTS.md -- Tab Out: Setup & Onboarding Guide for Coding Agents

You're installing **Tab Out** for the user. Your job is not just to set it up -- it's to get them excited about using it.

---

## Step 0 -- Introduce the product

Before doing anything technical, tell the user what they're about to get:

> **Tab Out** replaces your new tab page with a clean dashboard of everything you have open, grouped by domain.
>
> Here's what makes it great:
> - **See all your open tabs at a glance** grouped by domain on a grid
> - **Homepages group** pulls Gmail, X, LinkedIn, YouTube, GitHub homepages into one card for easy cleanup
> - **Close tabs with style** satisfying swoosh sound + confetti burst
> - **Duplicate detection** flags when you have the same page open twice
> - **Click any tab title to jump to it** even across different Chrome windows
> - **Save for later** bookmark individual tabs to a checklist before closing them
> - **100% local** no server, no accounts, no data sent anywhere
>
> It's just a Chrome extension. Setup takes about 1 minute.

---

## Step 1 -- Clone the repo

```bash
git clone https://github.com/zarazhangrui/tab-out.git
cd tab-out
```

---

## Step 2 -- Build and install the Chrome extension

The installable extension is the **production build** under `extension/.output/chrome-mv3/` (WXT output). The raw `extension/` source tree is not what you load in Chrome.

**First**, install dependencies and build from the repo root:

```bash
cd extension
pnpm i
npm run build
```

**Then**, print the full path to the built folder (this is what **Load unpacked** must point at). You should still be inside `extension/` after the build:

```bash
echo "Load this folder in Chrome: $(pwd)/.output/chrome-mv3"
```

**Then**, copy that `.output/chrome-mv3` path to their clipboard:
- macOS: `pwd | sed 's|$|/.output/chrome-mv3|' | pbcopy && echo "Path copied to clipboard"` (run from `extension/`)
- Linux: `pwd | sed 's|$|/.output/chrome-mv3|' | xclip -selection clipboard 2>/dev/null || echo "Path: $(pwd)/.output/chrome-mv3"` (run from `extension/`)
- Windows (PowerShell): from `extension/`, `(Resolve-Path .\\.output\\chrome-mv3).Path | Set-Clipboard`

**Then**, open the extensions page:
```bash
open "chrome://extensions"
```

**Then**, walk the user through it step by step:

> I've copied the **built** extension folder path (it ends in `.output/chrome-mv3`) to your clipboard. Now:
>
> 1. You should see Chrome's extensions page. In the **top-right corner**, toggle on **Developer mode** (it's a switch).
> 2. Once Developer mode is on, you'll see a button called **"Load unpacked"** appear in the top-left. Click it.
> 3. A file picker will open. **Press Cmd+Shift+G** (Mac) or **Ctrl+L** (Windows/Linux) to open the "Go to folder" bar, then **paste** the path I copied (Cmd+V / Ctrl+V) and press Enter.
> 4. Click **"Select"** or **"Open"** and the extension will install.
>
> You should see "Tab Out" appear in your extensions list.

**Also**, open the file browser directly to the built folder as a fallback:
- macOS: `open extension/.output/chrome-mv3`
- Linux: `xdg-open extension/.output/chrome-mv3`
- Windows: `explorer extension\\.output\\chrome-mv3`

---

## Optional -- Development build (for contributors)

If the user wants to hack on the extension, from the repo root:

```bash
cd extension
pnpm i
npm run dev
```

WXT starts the dev server and opens a browser with the extension loaded. Use this instead of Step 2's production build when iterating on code.

---

## Step 3 -- Show them around

Once the extension is loaded:

> You're all set! Open a **new tab** and you'll see Tab Out.
>
> Here's how it works:
> 1. **Your open tabs are grouped by domain** in a grid layout.
> 2. **Homepages** (Gmail inbox, X home, YouTube, etc.) are in their own group at the top.
> 3. **Click any tab title** to jump directly to that tab.
> 4. **Click the X** next to any tab to close just that one (with swoosh + confetti).
> 5. **Click "Close all N tabs"** on a group to close the whole thing.
> 6. **Duplicate tabs** are flagged with an amber "(2x)" badge. Click "Close duplicates" to keep one copy.
> 7. **Save a tab for later** by clicking the bookmark icon before closing it. Saved tabs appear in the sidebar.
>
> That's it! No server to run, no config files. Everything works right away.

---

## Key Facts

- Tab Out is a pure Chrome extension at **runtime**: no server, no account, no external API calls.
- **Building from source** uses Node in `extension/` ([pnpm](https://pnpm.io/) + `npm run build` or `npm run dev`); the loadable artifact is `extension/.output/chrome-mv3/`.
- Saved tabs are stored in `chrome.storage.local` (persists across sessions).
- 100% local at runtime. No data is sent to any external service.
- To update after pulling changes: `cd extension && pnpm i && npm run build`, then click **Reload** on the extension card in `chrome://extensions`.
