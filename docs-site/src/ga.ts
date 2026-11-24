import type { ClientModule } from "@docusaurus/types";

// static/ga.js sends the first page view. Docusaurus changes pages
// client-side, and the GA4 property doesn't count history changes on its own
// (enhanced measurement's browser-history page views are off), so each route
// change sends one here. If that setting is ever turned on, remove this file,
// or every navigation counts twice. Only a new path counts: following a
// heading anchor on the same page does not.
const gaRouteViews: ClientModule = {
  onRouteDidUpdate({ location, previousLocation }) {
    if (!previousLocation || location.pathname === previousLocation.pathname) {
      return;
    }
    const { gtag } = window as Window & {
      gtag?: (...args: unknown[]) => void;
    };
    if (!gtag) {
      return;
    }
    // Docusaurus sets document.title after this hook runs.
    setTimeout(() => {
      gtag("event", "page_view", {
        page_location:
          window.location.origin + location.pathname + location.search,
        page_title: document.title,
      });
    });
  },
};

export default gaRouteViews;
