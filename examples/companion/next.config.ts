import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@charivo/core",
    "@charivo/realtime",
    "@charivo/realtime-avatar",
    "@charivo/render",
    "@charivo/render-live2d",
    "@charivo/server",
  ],
};

export default nextConfig;
