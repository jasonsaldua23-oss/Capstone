import fs from 'fs';
import path from 'path';

export default function RestoreNowPage() {
  let result = 'Not run';
  try {
    const lostFoundDir = path.join(process.cwd(), '.git', 'lost-found', 'other');
    const matchedBlobs: any[] = [];
    
    if (fs.existsSync(lostFoundDir)) {
      const fileNames = fs.readdirSync(lostFoundDir);
      for (const name of fileNames) {
        const filePath = path.join(lostFoundDir, name);
        const stats = fs.statSync(filePath);
        // helpers files are usually smaller (1kb - 15kb)
        if (stats.size > 2000 && stats.size < 30000) {
          const content = fs.readFileSync(filePath, 'utf8');
          if (content.includes('openNavigation') && content.includes('DriverGpsLocation')) {
            matchedBlobs.push({
              hash: name,
              size: stats.size,
              lines: content.split('\n').length,
              preview: content.substring(0, 300)
            });
          }
        }
      }
    }
    
    fs.writeFileSync('c:\\CAPSTONE\\helpers_matched_blobs.json', JSON.stringify(matchedBlobs, null, 2), 'utf8');
    result = `Found ${matchedBlobs.length} candidates for trip-detail-helpers.ts.`;
  } catch (error: any) {
    result = `Error: ${error.message}`;
  }

  return (
    <div style={{ padding: '2rem', fontFamily: 'sans-serif' }}>
      <h1>Scan helpers results</h1>
      <pre>{result}</pre>
    </div>
  );
}
