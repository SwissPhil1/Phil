import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: "https://phil-production.up.railway.app/api/:path*",
      },
    ];
  },
};

export default nextConfig;
