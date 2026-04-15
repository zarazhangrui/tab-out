async function updateBadge() {
  try {
    const tabs = await browser.tabs.query({});
    const count = tabs.filter((t) => {
      const url = t.url || '';
      return (
        !url.startsWith('chrome://') &&
        !url.startsWith('chrome-extension://') &&
        !url.startsWith('about:') &&
        !url.startsWith('edge://') &&
        !url.startsWith('brave://')
      );
    }).length;

    await browser.action.setBadgeText({ text: count > 0 ? String(count) : '' });
    if (count === 0) return;

    let color: string;
    if (count <= 10) color = '#3d7a4a';
    else if (count <= 20) color = '#b8892e';
    else color = '#b35a5a';

    await browser.action.setBadgeBackgroundColor({ color });
  } catch {
    await browser.action.setBadgeText({ text: '' });
  }
}

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(() => void updateBadge());
  browser.runtime.onStartup.addListener(() => void updateBadge());
  browser.tabs.onCreated.addListener(() => void updateBadge());
  browser.tabs.onRemoved.addListener(() => void updateBadge());
  browser.tabs.onUpdated.addListener(() => void updateBadge());
  void updateBadge();
});
