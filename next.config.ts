import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  // This app lives in `web/` inside a larger git repo (docs, android, backend...).
  // Pin the Turbopack root to this directory so it is never inferred from a
  // parent folder (CSS imports like `@import "tailwindcss"` would then be
  // resolved from a folder that has no node_modules).
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
