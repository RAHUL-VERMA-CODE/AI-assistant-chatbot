import { spawn } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function findTestFiles(dir, files = []) {
  const entries = readdirSync(dir);
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === '.git' || entry === 'dist') continue;
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      findTestFiles(fullPath, files);
    } else if (entry.endsWith('.test.ts') || entry.endsWith('.test.js')) {
      files.push(fullPath);
    }
  }
  return files;
}

async function runTestFile(file) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--experimental-strip-types', '--test', file], {
      stdio: 'pipe',
      env: process.env,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });

    child.on('close', (code) => {
      resolve({ file, code, stdout, stderr });
    });
  });
}

async function main() {
  const testFiles = findTestFiles(process.cwd());
  console.log(`\nFound ${testFiles.length} test files to execute...\n`);

  let passedFiles = 0;
  let failedFiles = 0;
  const startTime = Date.now();

  for (const file of testFiles) {
    const relative = file.replace(process.cwd() + '\\', '').replace(process.cwd() + '/', '');
    process.stdout.write(`• Running ${relative}... `);
    const res = await runTestFile(file);
    if (res.code === 0) {
      process.stdout.write(`✓ PASS\n`);
      passedFiles++;
    } else {
      process.stdout.write(`✗ FAIL\n`);
      console.error(`\n--- Test Output for ${relative} ---`);
      console.error(res.stdout);
      if (res.stderr) console.error(res.stderr);
      console.error(`--------------------------------------\n`);
      failedFiles++;
    }
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log('\n==================================================');
  console.log(`Test Results: ${passedFiles} passed, ${failedFiles} failed (${duration}s)`);
  console.log('==================================================\n');

  if (failedFiles > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
