import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Commander bundles are read from disk at request time (src/lib/data.ts), so tell the
  // file tracer to ship them with the server functions on Vercel.
  outputFileTracingIncludes: {
    "/*": ["./data/**/*.json"],
  },
};

export default nextConfig;
