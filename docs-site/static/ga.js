// Page views on the published site only, in zeikar.dev's own GA4 property,
// the same tag as zeikar.dev and Iki's pages. A browser that once opened
// zeikar.dev/?internal is tagged so the property's internal-traffic filter
// drops it. Docusaurus changes pages client-side; GA4's enhanced measurement
// counts those history changes as page views.
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
