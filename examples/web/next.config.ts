import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@charivo/core",
    "@charivo/shared",
    "@charivo/llm-core",
    "@charivo/llm-client-openai",
    "@charivo/llm-client-remote",
    "@charivo/llm-client-stub",
    "@charivo/llm-provider-openai",
    "@charivo/render-core",
    "@charivo/render-live2d",
    "@charivo/render-stub",
    "@charivo/tts-core",
    "@charivo/tts-player-web",
    "@charivo/tts-player-openai",
    "@charivo/tts-player-remote",
    "@charivo/tts-provider-openai",
  ],
};

export default nextConfig;
