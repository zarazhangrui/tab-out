import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { OpenTab } from '@/lib/types';
import { friendlyDomain } from '@/lib/domain';
import { queryKeys } from '@/lib/queries/keys';

export async function fetchOpenTabsForQuery(): Promise<OpenTab[]> {
  try {
    const newtabUrl = browser.runtime.getURL('/newtab.html');
    const tabs = await browser.tabs.query({});
    return tabs.map((t) => ({
      id: t.id!,
      url: t.url,
      title: t.title,
      windowId: t.windowId,
      active: !!t.active,
      isTabOut: t.url === newtabUrl || t.url === 'chrome://newtab/',
    }));
  } catch {
    return [];
  }
}

function isRealWebUrl(url: string) {
  return (
    !url.startsWith('chrome://') &&
    !url.startsWith('chrome-extension://') &&
    !url.startsWith('about:') &&
    !url.startsWith('edge://') &&
    !url.startsWith('brave://')
  );
}

export async function closeTabsByUrls(urls: string[]) {
  if (!urls.length) return;

  const targetHostnames: string[] = [];
  const exactUrls = new Set<string>();

  for (const u of urls) {
    if (u.startsWith('file://')) {
      exactUrls.add(u);
    } else {
      try {
        targetHostnames.push(new URL(u).hostname);
      } catch {
        /* skip */
      }
    }
  }

  const allTabs = await browser.tabs.query({});
  const toClose = allTabs
    .filter((tab) => {
      const tabUrl = tab.url || '';
      if (tabUrl.startsWith('file://') && exactUrls.has(tabUrl)) return true;
      try {
        const tabHostname = new URL(tabUrl).hostname;
        return !!tabHostname && targetHostnames.includes(tabHostname);
      } catch {
        return false;
      }
    })
    .map((tab) => tab.id!);

  if (toClose.length) await browser.tabs.remove(toClose);
}

export async function closeTabsExact(urls: string[]) {
  if (!urls.length) return;
  const urlSet = new Set(urls);
  const allTabs = await browser.tabs.query({});
  const toClose = allTabs.filter((t) => urlSet.has(t.url || '')).map((t) => t.id!);
  if (toClose.length) await browser.tabs.remove(toClose);
}

export async function focusTab(url: string) {
  if (!url) return;
  const allTabs = await browser.tabs.query({});
  const currentWindow = await browser.windows.getCurrent();

  let matches = allTabs.filter((t) => t.url === url);
  if (matches.length === 0) {
    try {
      const targetHost = new URL(url).hostname;
      matches = allTabs.filter((t) => {
        try {
          return new URL(t.url || '').hostname === targetHost;
        } catch {
          return false;
        }
      });
    } catch {
      /* noop */
    }
  }
  if (matches.length === 0) return;

  const match =
    matches.find((t) => t.windowId !== currentWindow.id) || matches[0];
  await browser.tabs.update(match.id!, { active: true });
  await browser.windows.update(match.windowId, { focused: true });
}

export async function closeDuplicateTabs(urls: string[], keepOne = true) {
  const allTabs = await browser.tabs.query({});
  const toClose: number[] = [];

  for (const url of urls) {
    const matching = allTabs.filter((t) => t.url === url);
    if (keepOne) {
      const keep = matching.find((t) => t.active) || matching[0];
      for (const tab of matching) {
        if (tab.id !== keep?.id) toClose.push(tab.id!);
      }
    } else {
      for (const tab of matching) toClose.push(tab.id!);
    }
  }

  if (toClose.length) await browser.tabs.remove(toClose);
}

export async function closeTabOutDupes() {
  const newtabUrl = browser.runtime.getURL('/newtab.html');
  const allTabs = await browser.tabs.query({});
  const currentWindow = await browser.windows.getCurrent();
  const tabOutTabs = allTabs.filter((t) => t.url === newtabUrl || t.url === 'chrome://newtab/');
  if (tabOutTabs.length <= 1) return;

  const keep =
    tabOutTabs.find((t) => t.active && t.windowId === currentWindow.id) ||
    tabOutTabs.find((t) => t.active) ||
    tabOutTabs[0];
  const toClose = tabOutTabs.filter((t) => t.id !== keep.id).map((t) => t.id!);
  if (toClose.length) await browser.tabs.remove(toClose);
}

export async function closeSingleTabByUrl(url: string) {
  const allTabs = await browser.tabs.query({});
  const match = allTabs.find((t) => t.url === url);
  if (match?.id != null) await browser.tabs.remove(match.id);
}

export async function closeAllRealTabs(openTabs: OpenTab[]) {
  const urls = openTabs
    .map((t) => t.url || '')
    .filter((u) => u && !u.startsWith('chrome') && !u.startsWith('about:'));
  await closeTabsByUrls(urls);
}

export function useTabEventsInvalidation() {
  const qc = useQueryClient();
  useEffect(() => {
    const inv = () => void qc.invalidateQueries({ queryKey: queryKeys.openTabs });
    browser.tabs.onCreated.addListener(inv);
    browser.tabs.onRemoved.addListener(inv);
    browser.tabs.onUpdated.addListener(inv);
    return () => {
      browser.tabs.onCreated.removeListener(inv);
      browser.tabs.onRemoved.removeListener(inv);
      browser.tabs.onUpdated.removeListener(inv);
    };
  }, [qc]);
}

export function useOpenTabsQuery() {
  useTabEventsInvalidation();
  return useQuery({
    queryKey: queryKeys.openTabs,
    queryFn: fetchOpenTabsForQuery,
  });
}

export function useCloseDomainGroupMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (opts: {
      domain: string;
      label?: string;
      urls: string[];
    }) => {
      const useExact = opts.domain === '__landing-pages__' || !!opts.label;
      if (useExact) await closeTabsExact(opts.urls);
      else await closeTabsByUrls(opts.urls);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.openTabs }),
  });
}

export function useDedupTabsMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (urls: string[]) => closeDuplicateTabs(urls, true),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.openTabs }),
  });
}

export function useCloseSingleTabMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (url: string) => closeSingleTabByUrl(url),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.openTabs }),
  });
}

export function useCloseTabOutDupesMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => closeTabOutDupes(),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.openTabs }),
  });
}

export function useCloseAllTabsMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (openTabs: OpenTab[]) => closeAllRealTabs(openTabs),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.openTabs }),
  });
}

export function stableDomainId(domain: string) {
  return `domain-${domain.replace(/[^a-z0-9]/gi, '-')}`;
}

export function domainToastLabel(domain: string, label?: string) {
  if (domain === '__landing-pages__') return 'Homepages';
  return label || friendlyDomain(domain);
}

export function countRealTabs(tabs: OpenTab[]) {
  return tabs.filter((t) => t.url && isRealWebUrl(t.url)).length;
}
