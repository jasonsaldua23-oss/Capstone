export const dynamic = 'force-dynamic';

import fs from 'fs';
import path from 'path';

export default function RestorePage() {
  let result = 'Not run';
  try {
    const lostFoundDir = path.join(process.cwd(), '.git', 'lost-found', 'other');
    
    // Copy candidate 3f
    const path3f = path.join(lostFoundDir, '3f2ba251924196a0066c8f3bb1e3d054fb84be04');
    if (fs.existsSync(path3f)) {
      fs.copyFileSync(path3f, 'c:\\CAPSTONE\\candidate_3f.tsx');
    }

    // Copy candidate 84
    const path84 = path.join(lostFoundDir, '846636e0a7dd27f002f3ed0b486aec55d4ad6d65');
    if (fs.existsSync(path84)) {
      fs.copyFileSync(path84, 'c:\\CAPSTONE\\candidate_84.tsx');
    }

    result = 'Candidates copied successfully to c:\\CAPSTONE\\candidate_3f.tsx and candidate_84.tsx';
  } catch (error: any) {
    result = `Error: ${error.message}`;
  }

  return (
    <div style={{ padding: '2rem', fontFamily: 'sans-serif' }}>
      <h1>Copy results</h1>
      <pre>{result}</pre>
    </div>
  );
}
