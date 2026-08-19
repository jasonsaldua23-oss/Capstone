'use server'

import fs from 'fs';
import path from 'path';

export async function findFileInLogs() {
  try {
    const lostFoundDir = path.join(process.cwd(), '.git', 'lost-found', 'other');
    const matchedBlobs: any[] = [];
    
    if (fs.existsSync(lostFoundDir)) {
      const fileNames = fs.readdirSync(lostFoundDir);
      for (const name of fileNames) {
        const filePath = path.join(lostFoundDir, name);
        const stats = fs.statSync(filePath);
        // Read file contents
        const content = fs.readFileSync(filePath, 'utf8');
        if (content.includes('voiceGuidanceEnabled') || content.includes('is3DPerspective')) {
          matchedBlobs.push({
            hash: name,
            size: stats.size,
            lines: content.split('\n').length,
            preview: content.substring(0, 300)
          });
        }
      }
    }
    fs.writeFileSync('c:\\CAPSTONE\\voice_matched_blobs.json', JSON.stringify(matchedBlobs, null, 2), 'utf8');
    return { success: true, matchedBlobs };
  } catch (error: any) {
    fs.writeFileSync('c:\\CAPSTONE\\voice_matched_blobs.json', JSON.stringify({ error: error.message }, null, 2), 'utf8');
    return { success: false, error: error.message };
  }
}
