import type { NextConfig } from "next";

const djangoApiOrigin = process.env.DJANGO_API_ORIGIN || "http://127.0.0.1:8000";

const nextConfig: NextConfig = {
  output: "standalone",
  devIndicators: false,
  allowedDevOrigins: [
    "localhost",
    "127.0.0.1",
    "10.248.36.183",
    "192.168.0.107"
  ],
  turbopack: {
    root: __dirname,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  async rewrites() {
    return {
      beforeFiles: [
        {
          source: "/api/:path*",
          destination: `${djangoApiOrigin}/api/:path*`,
        },
        {
          source: "/uploads/:path*",
          destination: `${djangoApiOrigin}/uploads/:path*`,
        },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
};

export default nextConfig;
