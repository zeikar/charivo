import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@charivo/core", "@charivo/realtime", "@charivo/server"],
};

export default nextConfig;
