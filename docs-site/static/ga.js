// Page views on the published site only, in zeikar.dev's own GA4 property,
// the same tag as zeikar.dev and Iki's pages. A browser that once opened
// zeikar.dev/?internal is tagged so the property's internal-traffic filter
// drops it. Page views after the first come from src/ga.ts, on each
// client-side route change.
if (window.location.hostname === "zeikar.dev") {
  const gaScript = document.createElement("script");
  gaScript.async = true;
  gaScript.src = "https://www.googletagmanager.com/gtag/js?id=G-TL9N5ZKRN2";
  document.head.appendChild(gaScript);
  window.dataLayer = window.dataLayer || [];
  window.gtag = function () {
    window.dataLayer.push(arguments);
  };
  window.gtag("js", new Date());
  let gaInternal = false;
  try {
    gaInternal = window.localStorage.getItem("ga_internal") === "1";
  } catch {
    // Storage blocked: count the visit as external.
  }
  window.gtag(
    "config",
    "G-TL9N5ZKRN2",
    gaInternal ? { traffic_type: "internal" } : {},
  );
}
