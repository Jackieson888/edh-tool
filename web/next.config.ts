import type { NextConfig } from "next";

// Data now comes from Postgres (DATABASE_URL), so nothing under web/data needs shipping with the server functions.
const nextConfig: NextConfig = {};

export default nextConfig;
