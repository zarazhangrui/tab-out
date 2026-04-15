# Tab Out

**Keep tabs on your tabs.**

Tab Out is a Chrome extension that replaces your new tab page with a dashboard of everything you have open. Tabs are grouped by domain, with homepages (Gmail, X, LinkedIn, etc.) pulled into their own group. Close tabs with a satisfying swoosh + confetti.

No server. No account. No external API calls. Just a Chrome extension.

---

## Install with a coding agent

Send your coding agent (Claude Code, Codex, etc.) this repo and say **"install this"**:

```
https://github.com/zarazhangrui/tab-out
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
- **100% local** your data never leaves your machine
- **Pure Chrome extension** no server or account; at runtime nothing leaves your machine (building from source uses Node in `extension/`)

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

Everything runs inside the Chrome extension. No external server, no API calls, no data sent anywhere. Saved tabs are stored in `chrome.storage.local`.

---

## Tech stack

| What | How |
|------|-----|
| Language | [TypeScript](https://www.typescriptlang.org/) |
| Extension tooling | [WXT](https://wxt.dev) (bundles with [Vite](https://vitejs.dev/)) |
| UI library | [React](https://react.dev/) 19 |
| Styling | [Tailwind CSS](https://tailwindcss.com/) 4 (`@tailwindcss/vite`) |
| Components | [shadcn/ui](https://ui.shadcn.com/) ([Radix UI](https://www.radix-ui.com/) primitives) |
| Data / caching | [TanStack Query](https://tanstack.com/query) |
| Icons | [Lucide React](https://lucide.dev/) |
| Toasts | [Sonner](https://sonner.emilkowal.ski/) |
| Class helpers | [class-variance-authority](https://cva.style/docs), [clsx](https://github.com/lukeed/clsx), [tailwind-merge](https://github.com/dcastil/tailwind-merge) |
| Package manager | [pnpm](https://pnpm.io/) (see `extension/pnpm-lock.yaml`) |

---

## Development build

From the repo root:

```
cd extension
pnpm i
npm run dev
```

WXT starts the dev server and opens a browser with the extension loaded so you can iterate on changes.

---

## Install manually

From the repo root:

```
cd extension
pnpm i
npm run build
```

Then add the built extension to Chrome:

1. Open `chrome://extensions`
2. Turn on **Developer mode**
3. Click **Load unpacked**
4. Choose the `extension/.output/chrome-mv3` folder (the directory that contains `manifest.json`)

---

## License

MIT

---

Built by [Zara](https://x.com/zarazhangrui)
