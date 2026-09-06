import type { NextConfig } from "next";

const configuredDjangoApiOrigin =
  process.env.DJANGO_API_ORIGIN?.trim() || "http://127.0.0.1:8000";

// Fix: Next.js external rewrites require a fully qualified HTTP(S) URL.
const djangoApiOrigin = /^https?:\/\//i.test(configuredDjangoApiOrigin)
  ? configuredDjangoApiOrigin.replace(/\/+$/, "")
  : `https://${configuredDjangoApiOrigin.replace(/\/+$/, "")}`;

const nextConfig: NextConfig = {
  output: "standalone",
  // Production deploys build into a staging directory and rename it into place only
  // once the output is verified complete, so a build that dies partway (OOM, full
  // disk) can never leave the live .next half-written. Unset outside the deploy
  // script, so local and CI builds still use the default .next.
  distDir: process.env.NEXT_DIST_DIR || ".next",
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
  async headers() {
    return [
      {
        source: "/push-sw.js",
        headers: [
          // Fix: hosted CDNs must revalidate the worker so push handling updates
          // reach installed browsers instead of remaining pinned to a stale script.
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
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
