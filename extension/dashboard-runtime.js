'use strict';

(function initDashboardRuntime() {
  function createRenderScheduler(renderer, { label = 'render', logger = console } = {}) {
    let renderSequence = 0;
    let scheduledPromise = Promise.resolve();

    return function scheduleRender(...args) {
      renderSequence += 1;
      const requestId = renderSequence;

      scheduledPromise = scheduledPromise
        .catch(() => undefined)
        .then(async () => {
          const result = await renderer({ requestId, isStale: () => requestId !== renderSequence }, ...args);
          if (requestId !== renderSequence) return undefined;
          return result;
        })
        .catch(err => {
          logger.warn(`[tab-out] ${label} failed:`, err);
          throw err;
        });

      return scheduledPromise;
    };
  }

  const dashboardRuntime = {
    createRenderScheduler,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = dashboardRuntime;
  }

  if (typeof window !== 'undefined') {
    window.TabOutDashboardRuntime = dashboardRuntime;
  }
})();
