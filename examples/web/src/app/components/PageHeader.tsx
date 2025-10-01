export function PageHeader() {
  return (
    <div className="text-center mb-6">
      {/* Main Title */}
      <div className="mb-3">
        <h1 className="text-3xl md:text-4xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent mb-2">
          Charivo Demo
        </h1>
        <p className="text-base text-gray-700 dark:text-gray-300 font-medium mb-2">
          Interactive AI Character Framework
        </p>
      </div>

      {/* Description */}
      <div className="mb-4">
        <p className="text-gray-600 dark:text-gray-400 text-sm max-w-3xl mx-auto">
          Chat with Hiyori and experience{" "}
          <span className="font-semibold text-blue-600">Live2D animations</span>
          ,{" "}
          <span className="font-semibold text-purple-600">
            AI conversations
          </span>
          , and{" "}
          <span className="font-semibold text-pink-600">voice synthesis</span>{" "}
          with lip-sync
        </p>
      </div>

      {/* Quick Links */}
      <div className="flex justify-center items-center gap-3 text-xs">
        <a
          href="https://github.com/zeikar/charivo"
          target="_blank"
          rel="noopener noreferrer"
          className="text-gray-600 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
        >
          ⭐ GitHub
        </a>
        <span className="text-gray-400">•</span>
        <a
          href="https://github.com/zeikar/charivo#readme"
          target="_blank"
          rel="noopener noreferrer"
          className="text-gray-600 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
        >
          📖 Documentation
        </a>
      </div>
    </div>
  );
}
