// Runs every *.test.mjs file in this directory against app.html/index.html,
// checked out fresh each time (no build step — these read the real files).
// Exits 1 if anything fails, so this can gate a deploy.
import { readdirSync } from 'fs';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const here = dirname(fileURLToPath(import.meta.url));
const testFiles = readdirSync(here).filter(f => f.endsWith('.test.mjs')).sort();

if (!testFiles.length) {
  console.log('No *.test.mjs files found in', here);
  process.exit(1);
}

let failed = 0;
console.log(`Running ${testFiles.length} test file(s)...\n`);

for (const file of testFiles) {
  const result = spawnSync('node', [join(here, file)], { encoding: 'utf8' });
  const out = (result.stdout || '') + (result.stderr || '');
  // A test file is treated as failed if it exited non-zero, threw a script-level
  // error, or its own JSON result explicitly reports ok:false.
  const looksFailed = result.status !== 0
    || /SCRIPT-LEVEL ERROR|SCRIPT THREW/.test(out)
    || /"ok":\s*false/.test(out);

  if (looksFailed) {
    failed++;
    console.log(`✗ FAIL  ${file}`);
    console.log(out.split('\n').map(l => '    ' + l).join('\n'));
  } else {
    console.log(`✓ pass  ${file}`);
  }
}

console.log(`\n${testFiles.length - failed}/${testFiles.length} passed.`);
process.exit(failed ? 1 : 0);
