export function PageHeader() {
  return (
    <div className="text-center mb-6">
      <h1 className="text-3xl font-bold text-gray-800 dark:text-white mb-2">
        🧩✨ Charivo Live2D Demo
      </h1>
      <p className="text-gray-600 dark:text-gray-300 text-base mb-1">
        Interactive AI Character Framework
      </p>
      <p className="text-gray-500 dark:text-gray-400 text-xs max-w-3xl mx-auto mb-3">
        Experience the power of Charivo - a modular Live2D + LLM framework. Chat
        with Hiyori and explore real-time 2D animations, AI conversations
        powered by OpenAI GPT, and natural voice synthesis using OpenAI TTS API.
      </p>
      <div className="flex justify-center items-center space-x-3 text-xs text-gray-400">
        <span className="bg-blue-100 text-blue-800 px-2 py-1 rounded">
          TypeScript
        </span>
        <span className="bg-green-100 text-green-800 px-2 py-1 rounded">
          Live2D
        </span>
        <span className="bg-purple-100 text-purple-800 px-2 py-1 rounded">
          OpenAI
        </span>
        <span className="bg-pink-100 text-pink-800 px-2 py-1 rounded">
          OpenAI TTS
        </span>
      </div>
    </div>
  );
}
