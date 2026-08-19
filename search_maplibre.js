import fs from 'fs';
import path from 'path';

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
        if (content.toLowerCase().includes('maplibre')) {
          results.push(fullPath);
        }
      }
    }
  }
}

try {
  search(searchDir);
  fs.writeFileSync('c:\\CAPSTONE\\maplibre_search_results.json', JSON.stringify(results, null, 2));
} catch (e: any) {
  fs.writeFileSync('c:\\CAPSTONE\\maplibre_search_results.json', JSON.stringify({ error: e.message }));
}
