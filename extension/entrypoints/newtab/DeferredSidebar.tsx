import { useMemo, useState } from 'react';
import { ChevronDown, X } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { timeAgo } from '@/lib/domain';
import type { SavedTab } from '@/lib/types';

type DeferredSidebarProps = {
  active: SavedTab[];
  archived: SavedTab[];
  onCheckOff: (id: string) => void;
  onDismiss: (id: string) => void;
};

export function DeferredSidebar({ active, archived, onCheckOff, onDismiss }: DeferredSidebarProps) {
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveQuery, setArchiveQuery] = useState('');

  const filteredArchive = useMemo(() => {
    const q = archiveQuery.trim().toLowerCase();
    if (q.length < 2) return archived;
    return archived.filter(
      (item) =>
        (item.title || '').toLowerCase().includes(q) || (item.url || '').toLowerCase().includes(q),
    );
  }, [archived, archiveQuery]);

  if (active.length === 0 && archived.length === 0) return null;

  return (
    <aside className="deferred-column w-full shrink-0 lg:sticky lg:top-8 lg:w-[280px] lg:max-h-[calc(100vh-4rem)] lg:overflow-y-auto">
      <div className="section-header mb-5 mt-2 flex animate-fade-up-delay-1 items-center gap-3">
        <h2 className="font-newsreader text-[18px] font-normal italic whitespace-nowrap text-tab-muted">Saved for later</h2>
        <div className="h-px flex-1 bg-tab-warm-gray" />
        {active.length > 0 ? (
          <span className="whitespace-nowrap text-[12px] font-medium tracking-wide text-tab-muted">
            {active.length} item{active.length !== 1 ? 's' : ''}
          </span>
        ) : null}
      </div>

      {active.length > 0 ? (
        <ul className="deferred-list">
          {active.map((item, i) => {
            let domain = '';
            try {
              domain = new URL(item.url).hostname.replace(/^www\./, '');
            } catch {
              /* noop */
            }
            const fav = domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=16` : '';
            return (
              <li
                key={item.id}
                className="deferred-item flex animate-fade-up items-start gap-2.5 border-b border-tab-muted/12 py-2.5 last:border-b-0"
                style={{ animationDelay: `${0.05 + i * 0.05}s` }}
              >
                <Checkbox
                  className="mt-0.5 size-[18px] rounded border-2 border-tab-warm-gray data-[state=checked]:border-tab-sage data-[state=checked]:bg-tab-sage"
                  onCheckedChange={(v) => {
                    if (v === true) onCheckOff(item.id);
                  }}
                  aria-label={`Mark ${item.title} as done`}
                />
                <div className="deferred-info min-w-0 flex-1">
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="deferred-title inline-flex max-w-full items-center gap-1.5 text-[13px] text-tab-ink transition-colors hover:text-tab-amber"
                  >
                    {fav ? (
                      <img src={fav} alt="" className="size-3.5 shrink-0" onError={(e) => (e.currentTarget.style.display = 'none')} />
                    ) : null}
                    <span className="min-w-0 truncate">{item.title || item.url}</span>
                  </a>
                  <div className="deferred-meta mt-0.5 flex gap-2 text-[11px] text-tab-muted">
                    <span>{domain}</span>
                    <span>{timeAgo(item.savedAt)}</span>
                  </div>
                </div>
                <button
                  type="button"
                  className="deferred-dismiss mt-0.5 inline-flex shrink-0 rounded p-0.5 text-tab-muted opacity-30 transition-all hover:opacity-100 hover:text-tab-rose"
                  title="Dismiss"
                  onClick={() => onDismiss(item.id)}
                >
                  <X className="size-3.5" strokeWidth={2} />
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="deferred-empty px-0 py-6 text-center text-[13px] italic text-tab-muted">Nothing saved. Living in the moment.</p>
      )}

      {archived.length > 0 ? (
        <div className="deferred-archive mt-4 border-t border-tab-warm-gray pt-3">
          <button
            type="button"
            className="archive-toggle flex w-full items-center gap-1.5 py-1 text-left text-[12px] font-medium text-tab-muted transition-colors hover:text-tab-ink"
            onClick={() => setArchiveOpen((o) => !o)}
          >
            <ChevronDown className={`archive-chevron size-3.5 shrink-0 transition-transform ${archiveOpen ? 'rotate-180' : ''}`} />
            Archive
            <span className="archive-count text-[11px] opacity-70">({archived.length})</span>
          </button>

          {archiveOpen ? (
            <div className="archive-body pt-3">
              <Input
                value={archiveQuery}
                onChange={(e) => setArchiveQuery(e.target.value)}
                placeholder="Search archived tabs..."
                className="archive-search mb-3 h-auto rounded-md border-tab-warm-gray bg-tab-card px-3 py-2 text-[12px] text-tab-ink placeholder:text-tab-muted focus-visible:border-tab-amber focus-visible:ring-tab-amber/30"
              />
              <ul className="max-h-48 space-y-0 overflow-y-auto pr-1">
                {filteredArchive.length === 0 ? (
                  <li className="py-2 text-[12px] text-tab-muted">No results</li>
                ) : (
                  filteredArchive.map((item) => (
                    <li
                      key={item.id}
                      className="archive-item flex items-center gap-2 border-b border-tab-muted/8 py-1.5 last:border-b-0"
                    >
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="archive-item-title min-w-0 flex-1 truncate text-[12px] text-tab-muted transition-colors hover:text-tab-ink"
                      >
                        {item.title || item.url}
                      </a>
                      <span className="archive-item-date shrink-0 text-[10px] text-tab-muted/60">
                        {timeAgo(item.completedAt || item.savedAt)}
                      </span>
                    </li>
                  ))
                )}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </aside>
  );
}
