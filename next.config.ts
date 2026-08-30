import type { NextConfig } from "next";

const configuredDjangoApiOrigin =
  process.env.DJANGO_API_ORIGIN?.trim() || "http://127.0.0.1:8000";

// Fix: Next.js external rewrites require a fully qualified HTTP(S) URL.
const djangoApiOrigin = /^https?:\/\//i.test(configuredDjangoApiOrigin)
  ? configuredDjangoApiOrigin.replace(/\/+$/, "")
  : `https://${configuredDjangoApiOrigin.replace(/\/+$/, "")}`;

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
