# Tab Out

[English](README.md) | [简体中文](README.zh-CN.md)

**Keep tabs on your tabs.**

Tab Out is a Chrome extension that replaces your new tab page with a dashboard of everything you have open. Tabs are grouped by domain, with homepages (Gmail, X, LinkedIn, etc.) pulled into their own group. Close tabs with a satisfying swoosh + confetti.

No server and no account. The only external API call is a public-IP lookup to `https://myip.ipip.net/`; the result is displayed in memory and is not stored.

This enhanced fork is maintained at [`zjwww/tab-out`](https://github.com/zjwww/tab-out) and is based on the [original Tab Out project](https://github.com/zarazhangrui/tab-out) by Zara.

---

## Enhancements in this fork (v1.1.0)

These changes are also proposed to the original project in [upstream PR #64](https://github.com/zarazhangrui/tab-out/pull/64).

### What changed

- Added system-aware dark mode with persistent system, light, and dark controls
- Added English and Simplified Chinese UI, including localized extension metadata
- Added WAN IP and original location details from `https://myip.ipip.net/`, with timeout, retry, responsive alignment, and theme-aware emphasis
- Reduced the WAN IP request timeout to 5 seconds for faster failure feedback
- Refined the dashboard layout by removing the header divider and excess spacing, and increased the overall type scale for better readability
- Moved the total open-tab count beside the **Open tabs** heading
- Simplified the footer to a localized, right-aligned attribution with links to this fork and the original author
- Documented Chrome and Microsoft Edge installation and the external IP lookup
- Escaped tab-derived text before rendering it into extension HTML

### Why

The original new-tab dashboard only provided an English light theme and did not expose network information. These changes make it more comfortable across operating-system themes, usable in Simplified Chinese, and useful in both Chrome and Edge while keeping the new external request narrowly scoped and documented.

### User impact

Users can follow their OS theme or choose one manually, switch between English and Simplified Chinese, and see their WAN IP plus the unmodified provider/location string below the greeting. Preferences and saved tabs remain local; the WAN IP response is not persisted.

The refined layout uses less vertical space, presents larger text, keeps the open-tab total near the section it describes, and leaves only the project attribution in the footer.

### Validation

- JavaScript syntax checks for `app.js` and `background.js`
- UTF-8 JSON parsing for the manifest and both locale files
- `git diff --check`
- Manual Microsoft Edge unpacked-extension verification, including the final IP/location alignment
- Local browser preview of the refined layout in English and Simplified Chinese, light and dark themes, with no console errors
- Manifest V3 APIs and permissions reviewed for Chrome and Edge compatibility

---

## Install with a coding agent

Send your coding agent (Claude Code, Codex, etc.) this repo and say **"install this"**:

```
https://github.com/zjwww/tab-out
```

The agent will walk you through it. Takes about 1 minute.

---

## Features

- **See all your tabs at a glance** on a clean grid, grouped by domain
- **Homepages group** pulls Gmail inbox, X home, YouTube, LinkedIn, GitHub homepages into one card
- **Close tabs with style** with swoosh sound + confetti burst
- **Duplicate detection** flags when you have the same page open twice, with one-click cleanup
- **Click any tab to jump to it** across windows, no new tab opened
- **Save for later** bookmark tabs to a checklist before closing them
- **Localhost grouping** shows port numbers next to each tab so you can tell your vibe coding projects apart
- **Expandable groups** show the first 8 tabs with a clickable "+N more"
- **Automatic dark mode** follows the operating system, with manual light/dark overrides
- **English and Simplified Chinese UI** with a persistent language selector
- **WAN IP and location display** fetched only from `https://myip.ipip.net/`, with a 5-second timeout and retry handling
- **Compact, readable dashboard layout** with larger typography and the open-tab total beside its section heading
- **Chrome and Edge support** through the shared Chromium Manifest V3 platform
- **Local preferences and saved tabs** stay in `chrome.storage.local`
- **Pure Chromium extension** no server, no Node.js, no npm, no setup beyond loading the extension

---

## Manual Setup

**1. Clone the repo**

```bash
git clone https://github.com/zjwww/tab-out.git
```

**2. Load the Chrome extension**

1. Open Chrome at `chrome://extensions` or Edge at `edge://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Navigate to the `extension/` folder inside the cloned repo and select it

**3. Open a new tab**

You'll see Tab Out.

---

## How it works

```
You open a new tab
  -> Tab Out shows your open tabs grouped by domain
  -> Homepages (Gmail, X, etc.) get their own group at the top
  -> Click any tab title to jump to it
  -> Close groups you're done with (swoosh + confetti)
  -> Save tabs for later before closing them
```

Everything runs inside the extension. Saved tabs and interface preferences are stored in `chrome.storage.local`. The public-IP widget makes one direct request to `https://myip.ipip.net/` when the new-tab page opens; its result is not persisted.

---

## Tech stack

| What | How |
|------|-----|
| Extension | Chrome Manifest V3 |
| Storage | chrome.storage.local |
| Sound | Web Audio API (synthesized, no files) |
| Animations | CSS transitions + JS confetti particles |

---

## License

MIT

---

Fork maintained at [zjwww/tab-out](https://github.com/zjwww/tab-out). Original project by [Zara](https://x.com/zarazhangrui).
