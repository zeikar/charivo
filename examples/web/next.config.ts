import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@charivo/core",
    "@charivo/llm",
    "@charivo/realtime",
    "@charivo/render",
    "@charivo/render-live2d",
    "@charivo/server",
    "@charivo/stt",
    "@charivo/tts",
  ],
};

export default nextConfig;
