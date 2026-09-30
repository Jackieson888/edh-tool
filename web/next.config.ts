import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Data files are read from disk at request time (src/lib/data.ts), so tell the file
  // tracer to ship them with the server functions on Vercel. Only the top-level files:
  // web/data/commanders/ holds the old per-commander bundles, which nothing reads now.
  outputFileTracingIncludes: {
    "/*": ["./data/*.json"],
  },
};

export default nextConfig;
