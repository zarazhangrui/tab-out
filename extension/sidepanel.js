/**
 * sidepanel.js — Side Panel entry point
 *
 * Bootstraps the postMessage bridge between the dashboard iframe and
 * Chrome's tabs API.  All shared logic lives in bridge.js.
 */

import { setupBridge } from './bridge.js';

setupBridge(
  document.getElementById('dashboard-frame'),
  document.getElementById('fallback')
);
