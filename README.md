<div align="center">

# Tab Out

[中文](./README.zh.md) &nbsp;·&nbsp;
[![License](https://img.shields.io/badge/license-MIT-green)](./LICENSE)
[![Chrome](https://img.shields.io/badge/Chrome%20Extension-MV3-blue)](https://developer.chrome.com/docs/extensions/mv3/)

</div>

<br>

> **Keep tabs on your tabs.** Tab Out replaces your new tab page with a clean,
> local dashboard for every open tab, grouped by domain and built for fast cleanup.

No server. No account. No external API calls. Your tab data stays on your machine.

<br>

## Features

- **Domain grouping**: see open tabs grouped by site on a clean grid.
- **Homepages card**: Gmail, X, YouTube, LinkedIn, GitHub homepages are pulled into one cleanup-friendly group.
- **One-click cleanup**: close one tab, all duplicates, one domain group, or all open tabs.
- **Swoosh + confetti**: closing tabs feels deliberate and visible.
- **Duplicate detection**: repeated pages show `(2x)` badges with dedicated cleanup actions.
- **Cross-window jump**: click a tab title to focus that exact tab, even in another Chrome window.
- **Advanced tab moving**: move one tab, one Tab Out group, or all tabs into the current window.
- **Custom grouping rules**: group tabs by exact host, host suffix, and optional path prefix.
- **Save for later**: save tabs into a local checklist before closing them.
- **Import / export sessions**: export current groups and import historical session files.
- **Import / export grouping rules**: move rule sets between browsers or keep a local backup.
- **Search everywhere**: one search covers open tabs, imported sessions, and the later list.
- **Light / dark / system themes**: switch theme from the More menu.
- **English / Chinese UI**: switch language from the More menu. English is the default.
- **Resilient favicons**: tries real tab favicons first, then falls back to Chrome's favicon endpoint and local placeholders.
- **100% local**: saved tabs, imported sessions, grouping rules, settings, language, theme, and advanced controls use `chrome.storage.local`.

<br>

## How It Works

```text
Open a new tab
  -> Tab Out shows your open tabs grouped by domain
  -> Homepages (Gmail, X, etc.) appear in their own group
  -> Click a tab title to jump to it across windows
  -> Use More to switch theme, language, auto refresh, tab moving, and grouping rules
  -> Add custom grouping rules for exact hosts, host suffixes, or path prefixes
  -> Move tabs into the current window when advanced tab moving is enabled
  -> Save tabs for later before closing them
  -> Export or import tab sessions and grouping rules when you need a snapshot
```

Everything runs inside the Chrome extension. No server or build step is required.

<br>

## Manual Setup

**1. Clone the repo**

```bash
git clone https://github.com/mrfoolish/tab-out.git
```

**2. Load the Chrome extension**

| Step | Action |
|------|--------|
| 1 | Open `chrome://extensions` |
| 2 | Toggle **Developer mode** in the top-right corner |
| 3 | Click **Load unpacked** |
| 4 | Select the `extension/` folder in this repo |

**3. Open a new tab**

Tab Out will replace the default Chrome new tab page.

<br>

## Install With A Coding Agent

Send your coding agent this repo:

```text
https://github.com/mrfoolish/tab-out
```

Say **"install this"**. It can walk you through loading the unpacked extension in about a minute.

<br>

## Tech Stack

| What | How |
|------|-----|
| Extension | Chrome Manifest V3 |
| Storage | `chrome.storage.local` |
| Tabs | `chrome.tabs` |
| Favicons | Tab favicon URL, Chrome `_favicon` endpoint, and local placeholders |
| Sound | Web Audio API |
| UI | HTML, CSS, vanilla JavaScript |

<br>

## License

MIT. Fork maintained at [mrfoolish/tab-out](https://github.com/mrfoolish/tab-out). Original project by [Zara](https://x.com/zarazhangrui).
