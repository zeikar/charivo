const FEATURES = [
  {
    icon: "🎭",
    title: "Avatar Control",
    description:
      "Expression, motion, and gaze driven by AI tools — Natori has full expression support",
  },
  {
    icon: "💋",
    title: "Auto Lip-Sync",
    description: "Natural mouth movements synced to voice in real time",
  },
  {
    icon: "🌐",
    title: "WebRTC Voice",
    description: "Low-latency conversations powered by the OpenAI Realtime API",
  },
];

export function PageHeader() {
  return (
    <header className="text-center md:text-left">
      {/* Brand */}
      <h1 className="text-xl md:text-4xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent leading-tight">
        Charivo
      </h1>
      <p className="mt-0.5 md:mt-1.5 text-[11px] md:text-base text-gray-700 dark:text-gray-300 font-medium">
        Live2D AI Characters That Come Alive
      </p>

      {/* Hero tagline — desktop only */}
      <p className="hidden md:block mt-5 text-[13px] leading-relaxed text-gray-600 dark:text-gray-400">
        Real-time voice conversations with Live2D characters — AI controls
        expression, motion, gaze, and lip-sync so the character{" "}
        <span className="font-semibold text-blue-600 dark:text-blue-400">
          feels alive
        </span>
        .
      </p>

      {/* Features — desktop only */}
      <section aria-labelledby="features-heading" className="hidden md:block">
        <h2 id="features-heading" className="sr-only">
          Features
        </h2>
        <ul className="flex flex-col gap-3 mt-4">
          {FEATURES.map((feature) => (
            <li key={feature.title} className="flex items-start gap-2.5">
              <span className="text-base leading-none mt-0.5" aria-hidden>
                {feature.icon}
              </span>
              <div className="min-w-0">
                <h3 className="text-[13px] font-semibold text-gray-800 dark:text-gray-200">
                  {feature.title}
                </h3>
                <p className="text-[12px] leading-relaxed text-gray-500 dark:text-gray-400">
                  {feature.description}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* CTAs */}
      <nav
        aria-label="Project links"
        className="mt-3 md:mt-6 flex items-center justify-center md:justify-start gap-2 flex-wrap"
      >
        <a
          href="https://github.com/zeikar/charivo"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="View Charivo on GitHub"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 md:px-4 md:py-2 rounded-lg bg-gray-900 text-white hover:bg-gray-800 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100 shadow-sm hover:shadow transition-all font-medium text-xs md:text-sm"
        >
          ⭐ GitHub
        </a>
        <a
          href="https://zeikar.dev/charivo/"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Read the Charivo documentation"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 md:px-4 md:py-2 rounded-lg bg-white text-gray-800 border border-gray-300 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-200 dark:border-gray-700 dark:hover:bg-gray-700 shadow-sm hover:shadow transition-all font-medium text-xs md:text-sm"
        >
          📖 Documentation
        </a>
      </nav>
    </header>
  );
}
