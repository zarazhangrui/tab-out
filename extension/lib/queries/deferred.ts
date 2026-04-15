import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { deferredStorageItem, getSavedTabsSplit } from '@/lib/storage';
import type { SavedTab } from '@/lib/types';
import { queryKeys } from '@/lib/queries/keys';

export async function fetchDeferredQuery() {
  return getSavedTabsSplit();
}

export function useDeferredQuery() {
  const qc = useQueryClient();
  useEffect(() => {
    const unwatch = deferredStorageItem.watch(() => {
      void qc.invalidateQueries({ queryKey: queryKeys.deferred });
    });
    return unwatch;
  }, [qc]);

  return useQuery({
    queryKey: queryKeys.deferred,
    queryFn: fetchDeferredQuery,
  });
}

export function useCheckOffDeferredMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const deferred = await deferredStorageItem.getValue();
      const next = deferred.map((t) =>
        t.id === id ? { ...t, completed: true, completedAt: new Date().toISOString() } : t,
      );
      await deferredStorageItem.setValue(next);
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.deferred }),
  });
}

export function useDismissDeferredMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const deferred = await deferredStorageItem.getValue();
      const next = deferred.map((t) => (t.id === id ? { ...t, dismissed: true } : t));
      await deferredStorageItem.setValue(next);
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.deferred }),
  });
}

export function useDeferAndCloseMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (tab: { url: string; title: string }) => {
      const deferred = await deferredStorageItem.getValue();
      const row: SavedTab = {
        id: Date.now().toString(),
        url: tab.url,
        title: tab.title,
        savedAt: new Date().toISOString(),
        completed: false,
        dismissed: false,
      };
      await deferredStorageItem.setValue([...deferred, row]);
      const allTabs = await browser.tabs.query({});
      const match = allTabs.find((t) => t.url === tab.url);
      if (match?.id != null) await browser.tabs.remove(match.id);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.deferred });
      void qc.invalidateQueries({ queryKey: queryKeys.openTabs });
    },
  });
}
