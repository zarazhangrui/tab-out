'use strict';

// Chrome M148 can force the native bookmarks bar onto extension-provided New
// Tab pages. Keep Chrome's new-tab hook on this tiny trampoline, then replace
// it with the real dashboard so Tab Out runs as a normal extension page.
location.replace(chrome.runtime.getURL('index.html'));
