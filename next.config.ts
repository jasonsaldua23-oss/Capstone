import type { NextConfig } from "next";
import fs from 'fs';
import path from 'path';

try {
  const searchDir = 'c:\\CAPSTONE';
  const ignoreDirs = ['node_modules', '.next', '.git', 'backend'];
  const results: any[] = [];

  function search(dir: string) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        if (!ignoreDirs.some(id => fullPath.includes(id))) {
          search(fullPath);
        }
      } else {
        if (file.endsWith('.ts') || file.endsWith('.tsx') || file.endsWith('.js') || file.endsWith('.jsx')) {
          const content = fs.readFileSync(fullPath, 'utf8');
          if (content.includes('react-map-gl')) {
            results.push(fullPath);
          }
        }
      }
    }
  }

  search(searchDir);
  fs.writeFileSync('c:\\CAPSTONE\\react_map_gl_search_results.json', JSON.stringify(results, null, 2));
} catch (e: any) {
  fs.writeFileSync('c:\\CAPSTONE\\react_map_gl_search_results.json', JSON.stringify({ error: e.message }));
}

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
