import { Layers, X } from 'lucide-react';
import { toast } from 'sonner';
import { getDateDisplay, getGreeting, groupTabsByDomain } from '@/lib/domain';
import { playCloseSound, shootConfetti } from '@/lib/fx';
import {
  countRealTabs,
  domainToastLabel,
  focusTab,
  useCheckOffDeferredMutation,
  useCloseAllTabsMutation,
  useCloseDomainGroupMutation,
  useCloseSingleTabMutation,
  useCloseTabOutDupesMutation,
  useDedupTabsMutation,
  useDeferAndCloseMutation,
  useDeferredQuery,
  useDismissDeferredMutation,
  useOpenTabsQuery,
} from '@/lib/queries';
import { DomainCard } from './DomainCard';
import { DeferredSidebar } from './DeferredSidebar';

export default function App() {
  const { data: openTabs = [], isPending, isError } = useOpenTabsQuery();
  const { data: deferred = { active: [], archived: [] } } = useDeferredQuery();

  const closeDomain = useCloseDomainGroupMutation();
  const dedup = useDedupTabsMutation();
  const closeOne = useCloseSingleTabMutation();
  const closeTabOutDupes = useCloseTabOutDupesMutation();
  const closeAll = useCloseAllTabsMutation();
  const deferClose = useDeferAndCloseMutation();
  const checkOff = useCheckOffDeferredMutation();
  const dismissDef = useDismissDeferredMutation();

  const groups = groupTabsByDomain(openTabs);
  const tabOutDupes = openTabs.filter((t) => t.isTabOut).length;
  const realCount = countRealTabs(openTabs);
  const hasDeferred = deferred.active.length > 0 || deferred.archived.length > 0;

  return (
    <div className="relative min-h-screen">
      <div
        className={`relative z-[1] mx-auto px-8 pb-20 pt-12 ${hasDeferred && groups.length > 0 ? 'max-w-[1300px]' : 'max-w-[960px]'}`}
      >
        <header className="mb-12 animate-fade-up border-b border-tab-warm-gray pb-6">
          <h1 className="font-newsreader text-[28px] font-light tracking-[-0.5px] text-tab-ink">{getGreeting()}</h1>
          <p className="mt-1 text-[13px] font-normal uppercase tracking-wide text-tab-muted">{getDateDisplay()}</p>
        </header>

        {tabOutDupes > 1 ? (
          <div
            className="tab-cleanup-banner mb-4 flex animate-fade-up-delay-1 flex-wrap items-center justify-between gap-4 rounded-lg border border-tab-amber/20 px-6 py-4"
            style={{
              background: 'linear-gradient(135deg, rgba(200, 113, 58, 0.04), rgba(200, 113, 58, 0.09))',
            }}
          >
            <div className="tab-cleanup-left inline-flex items-center gap-4">
              <span className="tab-cleanup-icon inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-tab-amber/10">
                <Layers className="size-[18px] text-tab-amber" strokeWidth={1.5} />
              </span>
              <p className="text-[13px] leading-snug text-tab-ink">
                You have <strong className="font-semibold">{tabOutDupes}</strong> Tab Out tabs open. Keep just this one?
              </p>
            </div>
            <button
              type="button"
              className="tab-cleanup-btn inline-flex whitespace-nowrap rounded-md border-0 bg-tab-amber px-5 py-2 text-[12px] font-semibold text-white transition-all hover:-translate-y-px hover:opacity-[0.85]"
              onClick={async () => {
                await closeTabOutDupes.mutateAsync();
                playCloseSound();
                toast.success('Closed extra Tab Out tabs');
              }}
            >
              Close extras
            </button>
          </div>
        ) : null}

        {isError ? (
          <p className="text-sm text-destructive">Could not read tabs.</p>
        ) : isPending ? (
          <p className="text-sm text-tab-muted">Loading your tabs…</p>
        ) : groups.length === 0 ? (
          <div className="missions-empty-state flex animate-fade-up flex-col items-center justify-center gap-3 px-6 py-14 text-center">
            <div className="empty-checkmark flex size-14 animate-check-pop items-center justify-center rounded-full border-[1.5px] border-tab-sage/30 bg-tab-sage/10 shadow-[0_0_0_8px_rgba(90,122,98,0.05),0_0_0_16px_rgba(90,122,98,0.03)]">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2.5}
                stroke="currentColor"
                className="size-[26px] text-tab-sage"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
              </svg>
            </div>
            <p className="empty-title font-newsreader text-[20px] font-normal italic tracking-tight text-tab-ink">
              Inbox zero, but for tabs.
            </p>
            <p className="empty-subtitle text-[13px] font-normal tracking-wide text-tab-muted">You&apos;re free.</p>
          </div>
        ) : (
          <div className="dashboard-columns flex flex-col gap-8 lg:flex-row lg:items-start">
            <section className="active-section min-w-0 flex-1 lg:min-w-[600px]">
              <div className="section-header mb-5 mt-2 flex animate-fade-up-delay-2 items-center gap-3">
                <h2 className="font-newsreader text-[18px] font-normal italic whitespace-nowrap text-tab-muted">Open tabs</h2>
                <div className="h-px flex-1 bg-tab-warm-gray" />
                <div className="flex flex-wrap items-center gap-2 whitespace-nowrap text-[12px] font-medium tracking-wide text-tab-muted">
                  <span>
                    {groups.length} domain{groups.length !== 1 ? 's' : ''}
                  </span>
                  <span className="text-tab-muted/50">·</span>
                  <button
                    type="button"
                    className="action-btn danger inline-flex items-center gap-1 rounded border border-tab-warm-gray bg-tab-card px-3 py-[5px] text-[11px] font-medium text-tab-muted transition-all hover:border-tab-rose hover:text-tab-rose"
                    onClick={async () => {
                      await closeAll.mutateAsync(openTabs);
                      playCloseSound();
                      shootConfetti(window.innerWidth / 2, window.innerHeight / 3);
                      toast.success('All tabs closed. Fresh start.');
                    }}
                  >
                    <X className="size-3" strokeWidth={2} />
                    Close all {realCount} tabs
                  </button>
                </div>
              </div>

              <div className="missions mb-10 columns-[280px] gap-x-3">
                {groups.map((group, idx) => (
                  <DomainCard
                    key={group.domain}
                    index={idx}
                    group={group}
                    onFocusTab={(url) => void focusTab(url)}
                    onCloseTab={(url, origin) => {
                      void closeOne.mutateAsync(url).then(() => {
                        playCloseSound();
                        if (origin) shootConfetti(origin.x, origin.y);
                        toast.message('Tab closed');
                      });
                    }}
                    onDeferTab={(url, title) => {
                      void deferClose.mutateAsync({ url, title }).then(() => {
                        playCloseSound();
                        toast.success('Saved for later');
                      });
                    }}
                    onCloseDomain={async (g) => {
                      const urls = g.tabs.map((t) => t.url!).filter(Boolean);
                      await closeDomain.mutateAsync({
                        domain: g.domain,
                        label: g.label,
                        urls,
                      });
                      playCloseSound();
                      toast.success(
                        `Closed ${urls.length} tab${urls.length !== 1 ? 's' : ''} from ${domainToastLabel(g.domain, g.label)}`,
                      );
                    }}
                    onDedup={(urls) => {
                      void dedup.mutateAsync(urls).then(() => {
                        playCloseSound();
                        toast.message('Closed duplicates, kept one copy each');
                      });
                    }}
                  />
                ))}
              </div>
            </section>

            <DeferredSidebar
              active={deferred.active}
              archived={deferred.archived}
              onCheckOff={(id) => void checkOff.mutateAsync(id)}
              onDismiss={(id) => void dismissDef.mutateAsync(id)}
            />
          </div>
        )}

        <footer
          className="mt-12 flex flex-wrap items-center justify-between gap-6 border-t border-tab-warm-gray pt-5 text-[11px] text-tab-muted animate-fade-up"
          style={{ animationDelay: '0.65s' }}
        >
          <div className="footer-stats flex gap-8">
            <div className="stat text-center">
              <div className="stat-num font-newsreader text-[28px] font-light leading-none text-tab-ink">{openTabs.length}</div>
              <div className="stat-label mt-1 text-[10px] uppercase tracking-[1.5px] text-tab-muted">Open tabs</div>
            </div>
          </div>
          <div className="last-refresh">
            <a
              href="https://github.com/zarazhangrui/tab-out"
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2"
            >
              Tab Out
            </a>{' '}
            by{' '}
            <a href="https://x.com/zarazhangrui" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
              Zara
            </a>
          </div>
        </footer>
      </div>
    </div>
  );
}
