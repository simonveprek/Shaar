import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  // The local database runs inside the server process; keep it out of the bundle.
  serverExternalPackages: ["@electric-sql/pglite"],
  partialPrefetching: true,
};

export default nextConfig;
