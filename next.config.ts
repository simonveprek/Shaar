import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  async redirects() {
    // This app only serves the API; the root shows the API docs.
    return [{ source: "/", destination: "/docs", permanent: false }];
  },
};

export default nextConfig;
