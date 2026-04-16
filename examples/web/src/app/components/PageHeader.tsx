export function PageHeader() {
  return (
    <div className="text-center">
      {/* Main Title */}
      <div className="mb-2">
        <h1 className="text-2xl md:text-3xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent mb-1">
          Charivo
        </h1>
        <p className="text-sm text-gray-600 dark:text-gray-400 font-medium">
          Live2D AI Characters That Come Alive
        </p>
      </div>

      {/* Description */}
      <div className="mb-3 space-y-1">
        <p className="text-gray-500 dark:text-gray-500 text-xs max-w-2xl mx-auto leading-relaxed">
          Real-time voice conversations with{" "}
          <span className="font-semibold text-blue-600 dark:text-blue-400">
            Live2D characters
          </span>{" "}
          — AI controls{" "}
          <span className="font-semibold text-purple-600 dark:text-purple-400">
            expression, motion, gaze
          </span>
          , and{" "}
          <span className="font-semibold text-pink-600 dark:text-pink-400">
            lip-sync
          </span>{" "}
          so the character{" "}
          <span className="font-semibold text-green-600 dark:text-green-400">
            feels alive
          </span>
        </p>
        <p className="text-gray-400 dark:text-gray-600 text-xs max-w-2xl mx-auto leading-relaxed">
          🎭 <span className="font-semibold">Avatar Control:</span> Expression,
          motion, and gaze driven by AI tools (
          <span className="text-purple-500">Natori</span> has full expression
          support) • 💋 <span className="font-semibold">Auto Lip-Sync:</span>{" "}
          Natural mouth movements synced to voice • 🌐{" "}
          <span className="font-semibold">WebRTC Voice:</span> Low-latency
          conversations powered by OpenAI Realtime API
        </p>
      </div>

      {/* Quick Links */}
      <div className="flex justify-center items-center gap-2">
        <a
          href="https://github.com/zeikar/charivo"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-blue-500 to-blue-600 text-white hover:from-blue-600 hover:to-blue-700 shadow-md hover:shadow-lg transition-all font-medium text-xs"
        >
          ⭐ GitHub
        </a>
        <a
          href="https://zeikar.github.io/charivo/"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-purple-500 to-purple-600 text-white hover:from-purple-600 hover:to-purple-700 shadow-md hover:shadow-lg transition-all font-medium text-xs"
        >
          📖 Documentation
        </a>
      </div>
    </div>
  );
}
