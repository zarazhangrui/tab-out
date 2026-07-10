'use strict';

(function initDashboardDomainGroups() {
  const LANDING_PAGE_PATTERNS = [
    {
      hostname: 'mail.google.com',
      test: (pathname, fullUrl) => !fullUrl.includes('#inbox/') && !fullUrl.includes('#sent/') && !fullUrl.includes('#search/'),
    },
    { hostname: 'x.com', pathExact: ['/home'] },
    { hostname: 'www.linkedin.com', pathExact: ['/'] },
    { hostname: 'github.com', pathExact: ['/'] },
    { hostname: 'www.youtube.com', pathExact: ['/'] },
  ];

  function getResolvedTabUrl(tab, getTabUrl) {
    if (typeof getTabUrl === 'function') {
      return getTabUrl(tab) || '';
    }
    return tab && typeof tab.url === 'string' ? tab.url : '';
  }

  function isLandingPage(url) {
    try {
      const parsed = new URL(url);
      return LANDING_PAGE_PATTERNS.some(pattern => {
        const hostnameMatch = pattern.hostname
          ? parsed.hostname === pattern.hostname
          : pattern.hostnameEndsWith
            ? parsed.hostname.endsWith(pattern.hostnameEndsWith)
            : false;
        if (!hostnameMatch) return false;
        if (pattern.test) return pattern.test(parsed.pathname, url);
        if (pattern.pathPrefix) return parsed.pathname.startsWith(pattern.pathPrefix);
        if (pattern.pathExact) return pattern.pathExact.includes(parsed.pathname);
        return parsed.pathname === '/';
      });
    } catch {
      return false;
    }
  }

  function isLandingDomain(domain) {
    const landingHostnames = new Set(LANDING_PAGE_PATTERNS.map(pattern => pattern.hostname).filter(Boolean));
    const landingSuffixes = LANDING_PAGE_PATTERNS.map(pattern => pattern.hostnameEndsWith).filter(Boolean);
    if (landingHostnames.has(domain)) return true;
    return landingSuffixes.some(suffix => domain.endsWith(suffix));
  }

  function buildDomainGroups({ tabs = [], getTabUrl, previousGroups = [] } = {}) {
    const sourceTabs = Array.isArray(tabs) ? tabs : [];
    const groupMap = {};
    const landingTabs = [];
    const previousOrder = new Map(
      (Array.isArray(previousGroups) ? previousGroups : []).map((group, index) => [group.domain, index])
    );

    for (const tab of sourceTabs) {
      try {
        const url = getResolvedTabUrl(tab, getTabUrl);
        if (!url) continue;

        if (isLandingPage(url)) {
          landingTabs.push(tab);
          continue;
        }

        let hostname;
        if (url.startsWith('file://')) {
          hostname = 'local-files';
        } else {
          hostname = new URL(url).hostname;
        }
        if (!hostname) continue;

        if (!groupMap[hostname]) {
          groupMap[hostname] = { domain: hostname, tabs: [] };
        }
        groupMap[hostname].tabs.push(tab);
      } catch {
        // Skip malformed tab URLs.
      }
    }

    if (landingTabs.length > 0) {
      groupMap['__landing-pages__'] = {
        domain: '__landing-pages__',
        tabs: landingTabs,
      };
    }

    return Object.values(groupMap).sort((a, b) => {
      const aIsLanding = a.domain === '__landing-pages__';
      const bIsLanding = b.domain === '__landing-pages__';
      if (aIsLanding !== bIsLanding) return aIsLanding ? -1 : 1;

      const aIsPriority = isLandingDomain(a.domain);
      const bIsPriority = isLandingDomain(b.domain);
      if (aIsPriority !== bIsPriority) return aIsPriority ? -1 : 1;

      const aPrevIndex = previousOrder.has(a.domain) ? previousOrder.get(a.domain) : Number.POSITIVE_INFINITY;
      const bPrevIndex = previousOrder.has(b.domain) ? previousOrder.get(b.domain) : Number.POSITIVE_INFINITY;
      if (aPrevIndex !== bPrevIndex) return aPrevIndex - bPrevIndex;

      const countDiff = b.tabs.length - a.tabs.length;
      if (countDiff !== 0) return countDiff;
      return a.domain.localeCompare(b.domain);
    });
  }

  const dashboardDomainGroups = {
    buildDomainGroups,
    isLandingPage,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = dashboardDomainGroups;
  }

  if (typeof window !== 'undefined') {
    window.TabOutDashboardDomainGroups = dashboardDomainGroups;
  }
})();
