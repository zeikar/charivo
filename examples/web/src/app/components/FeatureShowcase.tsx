import { useState } from "react";

const features = [
  {
    id: "live2d",
    title: "🎭 Live2D Integration",
    description:
      "Smooth 2D character animations with real-time parameter control",
    highlights: [
      "Real-time rendering",
      "Expression control",
      "Physics simulation",
    ],
    color: "blue",
  },
  {
    id: "llm",
    title: "🤖 AI Conversations",
    description: "Context-aware conversations powered by OpenAI GPT",
    highlights: ["Natural dialogue", "Character personality", "Memory system"],
    color: "purple",
  },
  {
    id: "tts",
    title: "🔊 Voice Synthesis",
    description: "High-quality text-to-speech with multiple voice options",
    highlights: ["OpenAI TTS", "Web Speech API", "Voice customization"],
    color: "pink",
  },
  {
    id: "lipsync",
    title: "💋 Lip-Sync Animation",
    description: "Automatic mouth movement synchronized with speech audio",
    highlights: ["Real-time analysis", "Natural movement", "Auto-calibration"],
    color: "green",
  },
];

export function FeatureShowcase() {
  const [activeFeature, setActiveFeature] = useState("live2d");

  const activeData =
    features.find((f) => f.id === activeFeature) || features[0];

  const getColorClasses = (color: string, isActive: boolean) => {
    const colors = {
      blue: isActive
        ? "bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-900 dark:text-blue-200 dark:border-blue-700"
        : "bg-gray-100 text-gray-700 border-gray-300 hover:bg-blue-50 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-600 dark:hover:bg-blue-900/20",
      purple: isActive
        ? "bg-purple-100 text-purple-800 border-purple-300 dark:bg-purple-900 dark:text-purple-200 dark:border-purple-700"
        : "bg-gray-100 text-gray-700 border-gray-300 hover:bg-purple-50 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-600 dark:hover:bg-purple-900/20",
      pink: isActive
        ? "bg-pink-100 text-pink-800 border-pink-300 dark:bg-pink-900 dark:text-pink-200 dark:border-pink-700"
        : "bg-gray-100 text-gray-700 border-gray-300 hover:bg-pink-50 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-600 dark:hover:bg-pink-900/20",
      green: isActive
        ? "bg-green-100 text-green-800 border-green-300 dark:bg-green-900 dark:text-green-200 dark:border-green-700"
        : "bg-gray-100 text-gray-700 border-gray-300 hover:bg-green-50 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-600 dark:hover:bg-green-900/20",
    };
    return colors[color as keyof typeof colors];
  };

  return (
    <div className="mb-6">
      <div className="text-center mb-4">
        <h2 className="text-xl font-bold text-gray-800 dark:text-white mb-2">
          ✨ Framework Features
        </h2>
        <p className="text-sm text-gray-600 dark:text-gray-300">
          Explore what makes Charivo special
        </p>
      </div>

      {/* Feature Tabs */}
      <div className="flex flex-wrap justify-center gap-2 mb-4">
        {features.map((feature) => (
          <button
            key={feature.id}
            onClick={() => setActiveFeature(feature.id)}
            className={`px-3 py-2 rounded-lg text-sm font-medium border transition-all duration-200 ${getColorClasses(
              feature.color,
              activeFeature === feature.id,
            )}`}
          >
            {feature.title}
          </button>
        ))}
      </div>

      {/* Active Feature Content */}
      <div className="bg-white/70 dark:bg-gray-800/70 backdrop-blur-sm rounded-xl p-6 border border-gray-200 dark:border-gray-700">
        <div className="text-center mb-4">
          <h3 className="text-lg font-bold text-gray-800 dark:text-white mb-1">
            {activeData.title}
          </h3>
          <p className="text-gray-600 dark:text-gray-300 text-sm">
            {activeData.description}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {activeData.highlights.map((highlight, index) => (
            <div
              key={index}
              className="bg-white/50 dark:bg-gray-700/50 rounded-lg p-3 text-center border border-gray-200/50 dark:border-gray-600/50"
            >
              <div className="w-2 h-2 bg-current rounded-full mx-auto mb-2 opacity-60"></div>
              <p className="text-xs font-medium text-gray-700 dark:text-gray-300">
                {highlight}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
