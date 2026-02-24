import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  cacheComponents: true,
  images: {
    remotePatterns: [
      {
        hostname: "ui-avatars.com",
      },
    ],
  },
  async rewrites() {
    return [
      {
        source: "/api/terraform/:path*",
        destination: `${process.env.BACKEND_URL || "http://127.0.0.1:8000"}/terraform/:path*`,
      },
      {
        source: "/api/project/:path*",
        destination: `${process.env.BACKEND_URL || "http://127.0.0.1:8000"}/project/:path*`,
      },
    ];
  },
};

export default nextConfig;
