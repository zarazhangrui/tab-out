import type { SavedTab } from '@/lib/types';

export const deferredStorageItem = storage.defineItem<SavedTab[]>('local:deferred', {
  fallback: [],
});

export async function getSavedTabsSplit() {
  const deferred = await deferredStorageItem.getValue();
  const visible = deferred.filter((t) => !t.dismissed);
  return {
    active: visible.filter((t) => !t.completed),
    archived: visible.filter((t) => t.completed),
  };
}
