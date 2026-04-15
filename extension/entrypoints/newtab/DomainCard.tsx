import { useMemo, useState } from 'react';
import { Bookmark, LayoutGrid, X } from 'lucide-react';
import { chipLabel, friendlyDomain } from '@/lib/domain';
import type { DomainGroup, OpenTab } from '@/lib/types';
import { stableDomainId } from '@/lib/queries/tabs';

function faviconUrlFor(tabUrl: string) {
  try {
    const host = new URL(tabUrl).hostname;
    return host ? `https://www.google.com/s2/favicons?domain=${host}&sz=16` : '';
  } catch {
    return '';
  }
}

type DomainCardProps = {
  group: DomainGroup;
  index: number;
  onFocusTab: (url: string) => void;
  onCloseTab: (url: string, origin?: { x: number; y: number }) => void;
  onDeferTab: (url: string, title: string) => void;
  onCloseDomain: (g: DomainGroup) => void;
  onDedup: (urls: string[]) => void;
};

export function DomainCard({
  group,
  index,
  onFocusTab,
  onCloseTab,
  onDeferTab,
  onCloseDomain,
  onDedup,
}: DomainCardProps) {
  const [overflowOpen, setOverflowOpen] = useState(false);
  const tabs = group.tabs || [];
  const tabCount = tabs.length;
  const isLanding = group.domain === '__landing-pages__';
  const stableId = stableDomainId(group.domain);

  const { urlCounts, uniqueTabs, dupeUrls, totalExtras, hasDupes } = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const tab of tabs) {
      const u = tab.url || '';
      counts[u] = (counts[u] || 0) + 1;
    }
    const dupeEntries = Object.entries(counts).filter(([, c]) => c > 1);
    const extras = dupeEntries.reduce((s, [, c]) => s + c - 1, 0);
    const seen = new Set<string>();
    const unique: OpenTab[] = [];
    for (const tab of tabs) {
      const u = tab.url || '';
      if (!seen.has(u)) {
        seen.add(u);
        unique.push(tab);
      }
    }
    return {
      urlCounts: counts,
      uniqueTabs: unique,
      dupeUrls: dupeEntries.map(([u]) => u),
      totalExtras: extras,
      hasDupes: dupeEntries.length > 0,
    };
  }, [tabs]);

  const visibleTabs = uniqueTabs.slice(0, 8);
  const hiddenTabs = uniqueTabs.slice(8);
  const showOverflowToggle = hiddenTabs.length > 0;

  const topBarClass = hasDupes ? 'bg-tab-amber' : 'bg-tab-warm-gray';

  const cardDelay = `${0.25 + index * 0.05}s`;

  function renderChipRow(tab: OpenTab, keySuffix: string) {
    const url = tab.url || '';
    const label = chipLabel(tab, group.domain);
    const count = urlCounts[url] || 1;
    const fav = faviconUrlFor(url);
    const borderClass = count > 1 ? 'border-tab-amber/25' : 'border-tab-muted/10';

    return (
      <div
        key={keySuffix}
        role="button"
        tabIndex={0}
        className={`page-chip clickable group flex cursor-pointer items-start gap-2 border-b py-2 pl-1 pr-1 text-[13px] leading-snug text-tab-ink transition-colors last:border-b-0 hover:bg-tab-amber/[0.04] ${borderClass}`}
        onClick={() => onFocusTab(url)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onFocusTab(url);
          }
        }}
      >
        {fav ? (
          <img
            src={fav}
            alt=""
            className="chip-favicon mt-0.5 size-4 shrink-0 rounded-sm"
            onError={(e) => (e.currentTarget.style.display = 'none')}
          />
        ) : null}
        <span className="chip-text min-w-0 flex-1 [display:-webkit-box] [-webkit-line-clamp:2] [-webkit-box-orient:vertical] overflow-hidden">
          {label}
        </span>
        {count > 1 ? <span className="chip-dupe-badge shrink-0 font-semibold text-tab-amber">({count}x)</span> : null}
        <div className="chip-actions ml-auto inline-flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            className="chip-action chip-save inline-flex size-7 items-center justify-center rounded text-tab-muted opacity-[0.35] transition-all hover:bg-tab-sage/10 hover:text-tab-sage hover:opacity-100"
            title="Save for later"
            onClick={(e) => {
              e.stopPropagation();
              onDeferTab(url, label);
            }}
          >
            <Bookmark className="size-[15px]" strokeWidth={2} />
          </button>
          <button
            type="button"
            className="chip-action chip-close inline-flex size-7 items-center justify-center rounded text-tab-muted opacity-[0.35] transition-all hover:bg-tab-rose/[0.08] hover:opacity-100 hover:text-tab-rose"
            title="Close tab"
            onClick={(e) => {
              e.stopPropagation();
              onCloseTab(url, { x: e.clientX, y: e.clientY });
            }}
          >
            <X className="size-[15px]" strokeWidth={2.5} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <article
      className="mission-card group/card relative mb-3 cursor-pointer break-inside-avoid rounded-lg border border-tab-warm-gray bg-tab-card px-[18px] pb-4 pt-4 shadow-none transition-[box-shadow,transform] duration-[250ms] ease-out hover:-translate-y-px hover:shadow-[var(--shadow-mission)]"
      style={{ animation: `fade-up 0.4s ease ${cardDelay} both` }}
    >
      <div className={`pointer-events-none absolute inset-x-0 top-0 h-[3px] ${topBarClass}`} />

      <div className="mission-content min-w-0">
        <div className="mission-top mb-1.5 flex flex-wrap items-center gap-2.5">
          <span className="mission-name text-[15px] font-semibold tracking-tight text-tab-ink">
            {isLanding ? 'Homepages' : group.label || friendlyDomain(group.domain)}
          </span>
          <span className="open-tabs-badge inline-flex items-center gap-1 rounded-[3px] bg-tab-amber/[0.08] px-2 py-0.5 text-[10px] font-medium text-tab-amber">
            <LayoutGrid className="size-2.5" strokeWidth={2} />
            {tabCount} tab{tabCount !== 1 ? 's' : ''} open
          </span>
          {hasDupes ? (
            <span className="open-tabs-badge inline-flex items-center gap-1 rounded-[3px] bg-tab-amber/[0.08] px-2 py-0.5 text-[10px] font-medium text-tab-amber">
              {totalExtras} duplicate{totalExtras !== 1 ? 's' : ''}
            </span>
          ) : null}
        </div>

        <div className="mission-pages flex flex-col">
          {visibleTabs.map((tab) => renderChipRow(tab, `${stableId}-${tab.url}`))}

          {showOverflowToggle && !overflowOpen ? (
            <button
              type="button"
              className="page-chip page-chip-overflow clickable mt-0 border-b-0 py-1.5 pl-1 text-left text-[12px] text-tab-muted transition-colors hover:bg-tab-amber/[0.04]"
              onClick={() => setOverflowOpen(true)}
            >
              +{hiddenTabs.length} more
            </button>
          ) : null}

          {showOverflowToggle && overflowOpen
            ? hiddenTabs.map((tab) => renderChipRow(tab, `${stableId}-hid-${tab.url}`))
            : null}
        </div>

        <div className="actions mt-2.5 flex flex-wrap gap-2">
          <button
            type="button"
            className="action-btn close-tabs inline-flex items-center gap-1.5 rounded border border-tab-amber/30 bg-tab-amber/[0.04] px-3.5 py-[5px] text-[11px] font-medium text-tab-amber transition-all hover:border-tab-amber hover:bg-tab-amber/10"
            onClick={(e) => {
              e.stopPropagation();
              onCloseDomain(group);
            }}
          >
            <X className="size-3" strokeWidth={2} />
            Close all {tabCount} tab{tabCount !== 1 ? 's' : ''}
          </button>
          {hasDupes ? (
            <button
              type="button"
              className="action-btn inline-flex items-center gap-1.5 rounded border border-tab-warm-gray bg-tab-card px-3.5 py-[5px] text-[11px] font-medium text-tab-muted transition-all hover:border-tab-ink hover:text-tab-ink"
              onClick={(e) => {
                e.stopPropagation();
                onDedup(dupeUrls);
              }}
            >
              Close {totalExtras} duplicate{totalExtras !== 1 ? 's' : ''}
            </button>
          ) : null}
        </div>
      </div>
    </article>
  );
}
