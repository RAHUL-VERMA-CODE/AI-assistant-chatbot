import fs from 'node:fs';
import path from 'node:path';

const srcDir = 'C:/Users/Rahul/OneDrive/Desktop/voice-commerce-assistant';
const destDir = 'C:/Users/Rahul/.gemini/antigravity/scratch/voice-commerce-assistant';

fs.mkdirSync(destDir, { recursive: true });

fs.cpSync(srcDir, destDir, {
  recursive: true,
  filter: (src) => {
    const rel = path.relative(srcDir, src);
    if (rel.startsWith('node_modules') || rel.startsWith('.git')) return false;
    return true;
  },
});

console.log('✓ Successfully synced voice-commerce-assistant to scratch directory.');
