import { themes as prismThemes } from "prism-react-renderer";
import type { Config } from "@docusaurus/types";
import type * as Preset from "@docusaurus/preset-classic";

const config: Config = {
  title: "Charivo",
  tagline: "Build Live2D AI characters that talk, react, and look at you",
  favicon: "img/favicon.ico",

  // Future flags, see https://docusaurus.io/docs/api/docusaurus-config#future
  future: {
    v4: true, // Improve compatibility with the upcoming Docusaurus v4
  },

  // Set the production url of your site here
  url: "https://zeikar.dev",
  baseUrl: "/charivo/",

  // GitHub pages deployment config.
  // If you aren't using GitHub pages, you don't need these.
  organizationName: "zeikar",
  projectName: "charivo",
  deploymentBranch: "gh-pages",
  trailingSlash: true,

  onBrokenLinks: "throw",

  // The playground's Iki models are served from the web demo's copies, so
  // there is one file per model in the repo (served at /charivo/<name>.iki).
  staticDirectories: ["static", "../examples/web/public/iki"],

  // scripts doesn't get baseUrl prepended, so the path is written out.
  scripts: [{ src: "/charivo/ga.js", async: true }],

  // Even if you don't use internationalization, you can use this field to set
  // useful metadata like html lang. For example, if your site is Chinese, you
  // may want to replace "en" with "zh-Hans".
  i18n: {
    defaultLocale: "en",
    locales: ["en"],
  },

  presets: [
    [
      "classic",
      {
        docs: {
          path: "../docs/guide",
          routeBasePath: "/",
          sidebarPath: "./sidebars.ts",
          editUrl: "https://github.com/zeikar/charivo/tree/main/docs/guide/",
        },
        blog: false,
        theme: {
          customCss: "./src/css/custom.css",
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    colorMode: {
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: "Charivo",
      logo: {
        alt: "Charivo Logo",
        src: "img/logo.svg",
      },
      items: [
        {
          type: "docSidebar",
          sidebarId: "guideSidebar",
          position: "left",
          label: "Guide",
        },
        {
          to: "/playground",
          label: "Playground",
          position: "left",
        },
        {
          href: "https://github.com/zeikar/charivo",
          label: "GitHub",
          position: "right",
        },
      ],
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
