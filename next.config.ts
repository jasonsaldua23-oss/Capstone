import type { NextConfig } from "next";

const djangoApiOrigin = process.env.DJANGO_API_ORIGIN || "http://127.0.0.1:8000";

const nextConfig: NextConfig = {
  output: "standalone",
  devIndicators: false,
  turbopack: {
    root: __dirname,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  async rewrites() {
    return {
      // Django-first backend mode: all /api/* is handled by Django.
      beforeFiles: [
        {
          source: "/api/:path*",
          destination: `${djangoApiOrigin}/api/:path*`,
        },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
};

export default nextConfig;
