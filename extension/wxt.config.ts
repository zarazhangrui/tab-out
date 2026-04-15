import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'wxt';

const extensionRoot = fileURLToPath(new URL('.', import.meta.url));
/** Persist extension storage, logins, etc. across `pnpm dev` runs (Chromium only). */
const chromiumUserDataDir = resolve(extensionRoot, '.wxt/chrome-data');

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  webExt: {
    chromiumArgs: [`--user-data-dir=${chromiumUserDataDir}`],
  },
  manifest: {
    name: 'Tab Out',
    description:
      'Keep tabs on your tabs. New tab page that groups your open tabs by domain and lets you close them with style.',
    permissions: ['tabs', 'activeTab', 'storage'],
    icons: {
      16: 'icon/16.png',
      32: 'icon/32.png',
      48: 'icon/48.png',
      96: 'icon/96.png',
      128: 'icon/128.png',
    },
    action: {
      default_title: 'Tab Out',
      default_icon: {
        16: 'icon/16.png',
        32: 'icon/32.png',
        48: 'icon/48.png',
        96: 'icon/96.png',
        128: 'icon/128.png',
      },
    },
  },
  vite: () => ({
    plugins: [tailwindcss()],
  }),
});
