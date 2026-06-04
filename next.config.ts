import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Build a self-contained server (.next/standalone) for the Docker runner image.
  output: "standalone",
};

export default nextConfig;
