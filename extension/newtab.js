'use strict';

// Legacy fallback for already-loaded unpacked installs until Chrome reloads
// the manifest. New installs load index.html directly as the new-tab override.
location.replace(chrome.runtime.getURL('index.html'));
