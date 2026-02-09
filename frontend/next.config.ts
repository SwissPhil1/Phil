import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Prevent Vercel from stripping trailing slashes before rewrites.
  // FastAPI routes use trailing slashes, and stripping them causes a redirect loop.
  skipTrailingSlashRedirect: true,
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
