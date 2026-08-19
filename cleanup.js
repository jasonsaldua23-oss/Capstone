const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

try {
  execSync('git checkout -- src/app/page.tsx', { stdio: 'inherit' });
  console.log('page.tsx reverted');
} catch (e) {
  console.error('Failed to revert page.tsx', e);
}

// Delay deletion slightly so the HTTP response can complete
setTimeout(() => {
  try {
    fs.unlinkSync(path.join(__dirname, 'src', 'app', 'actions.ts'));
    console.log('actions.ts deleted');
  } catch (e) {}

  try {
    fs.unlinkSync(path.join(__dirname, 'src', 'app', 'restore', 'page.tsx'));
    fs.rmdirSync(path.join(__dirname, 'src', 'app', 'restore'));
    console.log('restore page deleted');
  } catch (e) {}

  try {
    // Delete files we created during the process
    fs.unlinkSync(path.join(__dirname, 'git_status.json'));
    fs.unlinkSync(path.join(__dirname, 'log_scan_results.json'));
    fs.unlinkSync(path.join(__dirname, 'lost_found_results.json'));
    fs.unlinkSync(path.join(__dirname, 'matched_blobs.json'));
    fs.unlinkSync(path.join(__dirname, 'scratch_scan_results.json'));
    fs.unlinkSync(path.join(__dirname, 'git_branches_details.json'));
    fs.unlinkSync(path.join(__dirname, 'git_details.json'));
    fs.unlinkSync(path.join(__dirname, 'cleanup.js'));
  } catch (e) {}
}, 2000);
