import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  experimental: { serverActions: { bodySizeLimit: "6mb" } },
  async redirects() {
    return [{ source: "/import", destination: "/admin?tab=import", permanent: false }];
  },
};

export default nextConfig;
