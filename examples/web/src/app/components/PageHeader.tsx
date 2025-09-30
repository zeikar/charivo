export function PageHeader() {
  return (
    <div className="text-center mb-8">
      {/* Main Title */}
      <div className="mb-4">
        <h1 className="text-4xl md:text-5xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent mb-2">
          🧩✨ Charivo Demo
        </h1>
        <p className="text-xl text-gray-700 dark:text-gray-300 font-medium">
          Interactive AI Character Framework
        </p>
      </div>

      {/* Description */}
      <div className="mb-6">
        <p className="text-gray-600 dark:text-gray-400 text-sm max-w-4xl mx-auto leading-relaxed">
          Experience the power of Charivo - a modular Live2D + LLM framework.
          Chat with Hiyori and explore
          <span className="font-semibold text-blue-600">
            {" "}
            real-time 2D animations
          </span>
          ,
          <span className="font-semibold text-purple-600">
            {" "}
            AI conversations
          </span>{" "}
          powered by OpenAI GPT, and{" "}
          <span className="font-semibold text-pink-600">
            natural voice synthesis
          </span>{" "}
          with lip-sync animation.
        </p>
      </div>

      {/* GitHub and Social Links */}
      <div className="mb-6">
        <div className="flex justify-center items-center gap-4 mb-4">
          <a
            href="https://github.com/zeikar/charivo"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 bg-gray-900 hover:bg-gray-800 text-white px-4 py-2 rounded-lg font-medium transition-colors duration-200"
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 0C5.374 0 0 5.373 0 12 0 17.302 3.438 21.8 8.207 23.387c.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z" />
            </svg>
            ⭐ Star on GitHub
          </a>
          <a
            href="https://github.com/zeikar/charivo#readme"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium transition-colors duration-200"
          >
            📖 Documentation
          </a>
        </div>
      </div>

      {/* Feature Tags */}
      <div className="flex justify-center items-center flex-wrap gap-2 text-xs">
        <span className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 px-3 py-1 rounded-full font-medium">
          💋 Lip-Sync
        </span>
        <span className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 px-3 py-1 rounded-full font-medium">
          🎭 Live2D
        </span>
        <span className="bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200 px-3 py-1 rounded-full font-medium">
          🤖 OpenAI GPT
        </span>
        <span className="bg-pink-100 text-pink-800 dark:bg-pink-900 dark:text-pink-200 px-3 py-1 rounded-full font-medium">
          🔊 TTS
        </span>
        <span className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200 px-3 py-1 rounded-full font-medium">
          ⚡ TypeScript
        </span>
        <span className="bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200 px-3 py-1 rounded-full font-medium">
          🧩 Modular
        </span>
      </div>
    </div>
  );
}
