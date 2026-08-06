import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@charivo/avatar",
    "@charivo/core",
    "@charivo/realtime",
    "@charivo/render",
    "@charivo/render-live2d",
    "@charivo/server",
  ],
};

export default nextConfig;
