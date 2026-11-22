import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@charivo/avatar",
    "@charivo/core",
    "@charivo/llm",
    "@charivo/render",
    "@charivo/render-live2d",
    "@charivo/server",
    "@charivo/tts",
  ],
};

export default nextConfig;
