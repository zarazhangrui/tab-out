<div align="center">

# Tab Out

[中文](./README.zh.md) &nbsp;·&nbsp;
[![License](https://img.shields.io/badge/license-MIT-green)](./LICENSE)
[![Chrome](https://img.shields.io/badge/Chrome%20Extension-MV3-blue)](https://developer.chrome.com/docs/extensions/mv3/)

</div>

<br>

> **Keep tabs on your tabs.** A clean dashboard for your open tabs — grouped by domain,
> with one-click cleanup. No server, no account, no data sent anywhere.

<br>

## ✨ Features

- 🗂 **Domain grouping** — all your tabs sorted by domain on a clean grid
- 🏠 **Homepages card** — Gmail, X, YouTube, LinkedIn, GitHub homepages in one group
- 🧹 **One-click cleanup** — close a whole domain group with a single click
- ✨ **Swoosh + confetti** — close tabs with a satisfying sound and burst of color
- ⚡ **Duplicate detection** — flags (2x) badges when the same page is open twice
- 🎯 **Click to jump** — click any tab title to jump to it, even across windows
- 📌 **Save for later** — bookmark tabs to a checklist before closing them
- 🔢 **Localhost ports** — local dev tabs show port numbers so you can tell projects apart
- 📋 **Expandable groups** — shows first 8 tabs, click "+N more" to expand
- 🪟 **Standalone tab** — opens via extension icon, doesn't hijack your new tab page
- 🔒 **100% local** — your browsing data never leaves your machine

<br>

## 🧭 How it works

```
Click Tab Out icon
  ├─ Tab Out opens in a standalone tab
  ├─ Your open tabs appear, grouped by domain
  ├─ Homepages (Gmail, X, etc.) get their own group at the top
  ├─ Click any tab title → jump to it (cross-window)
  ├─ Close groups you're done with → swoosh + confetti
  └─ Save tabs for later before closing them

Click the icon again → focuses the existing Tab Out tab (no duplicates).
```

Everything runs inside the extension. Saved tabs live in `chrome.storage.local`.

<br>

## 📦 Manual Setup

**1. Clone the repo**

```bash
git clone https://github.com/zarazhangrui/tab-out.git
```

**2. Load in Chrome**

| Step | Action |
|------|--------|
| ① | Open `chrome://extensions` |
| ② | Toggle **Developer mode** (top-right) |
| ③ | Click **Load unpacked** |
| ④ | Select the `extension/` folder in the cloned repo |

**3. Pin the icon**

Click the Tab Out icon in your toolbar to open the dashboard. Right-click → **Pin** for one-click access.

<br>

## 🤖 Install with a coding agent

Send your coding agent this repo:

```
https://github.com/zarazhangrui/tab-out
```

Say **"install this"** — it'll walk you through in about a minute.

<br>

## 📄 License

MIT · Built by [Zara](https://x.com/zarazhangrui)
