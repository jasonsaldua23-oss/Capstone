import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET() {
  try {
    const searchDir = 'c:\\CAPSTONE';
    const ignoreDirs = ['node_modules', '.next', '.git', 'backend'];
    const results: string[] = [];

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
            if (content.includes('react-map-gl') || content.includes('maplibre-gl') || content.includes('MapLibre') || content.includes('Mapbox')) {
              results.push(fullPath);
            }
          }
        }
      }
    }

    search(searchDir);

    return NextResponse.json({
      success: true,
      results
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message });
  }
}
