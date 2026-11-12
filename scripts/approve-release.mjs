// Run manually after a release to review and approve the staged npm versions,
// then publish the draft GitHub release of next-intl, if there is one. Needs
// `npm login` (npm 11.15+) and `gh auth login`. See https://github.com/amannn/next-intl/blob/main/CONTRIBUTORS.md#stable-releases
import {execFileSync} from 'node:child_process';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createInterface} from 'node:readline/promises';

function run(command, args, options) {
  return execFileSync(command, args, {encoding: 'utf8', ...options}).trim();
}

function show(command, args, options) {
  execFileSync(command, args, {stdio: 'inherit', ...options});
}

// CI tags every version it stages
run('git', ['fetch', '--tags', '--quiet']);
const tags = run('git', ['tag', '--list', '*@*']).split('\n');

// The npm account can have staged versions of other packages too
function listStaged() {
  return JSON.parse(run('npm', ['stage', 'list', '--json'])).filter((item) =>
    tags.includes(`${item.packageName}@${item.version}`)
  );
}

const staged = listStaged();
if (staged.length === 0) {
  console.log('No staged versions of this repo found.');
  process.exit(1);
}

const dir = mkdtempSync(path.join(tmpdir(), 'staged-'));
for (const item of staged) {
  console.log(`\n=== ${item.packageName}@${item.version}\n`);
  show('npm', ['stage', 'view', item.id]);

  // Compare with what users currently get for the same dist-tag
  const file = run('npm', ['stage', 'download', item.id], {cwd: dir})
    .split('\n')
    .at(-1);
  let current = '';
  try {
    current = run('npm', [
      'view',
      `${item.packageName}@${item.tag}`,
      'version'
    ]);
  } catch {}
  if (!current) {
    console.log(`\nNo version under "${item.tag}" yet to compare with.`);
    continue;
  }
  const diff = [
    'diff',
    `--diff=${item.packageName}@${current}`,
    `--diff=${path.join(dir, file)}`
  ];
  console.log(`\nChanged files since ${current}:`);
  show('npm', [...diff, '--diff-name-only']);
  // New dependencies or install scripts would show up here
  show('npm', [...diff, 'package.json']);
  console.log(`\nFull diff: npm ${diff.join(' ')}`);
}

const prompt = createInterface({input: process.stdin, output: process.stdout});
const answer = await prompt.question(
  `\nApprove ${staged.map((item) => `${item.packageName}@${item.version}`).join(', ')}? [y/N] `
);
prompt.close();
if (answer.toLowerCase() !== 'y') process.exit(1);

// One OTP for all, in dependency order
try {
  show('pnpm', ['stage', 'approve', ...staged.map((item) => item.id)]);
} finally {
  // Publish the draft release only if its version got approved, also if
  // others failed
  const pending = new Set(
    listStaged().map((item) => `${item.id} ${item.status}`)
  );
  const drafts = run('gh', [
    'release',
    'list',
    '--json',
    'tagName,isDraft',
    '--jq',
    '.[] | select(.isDraft) | .tagName'
  ]).split('\n');
  for (const item of staged) {
    const tag = `${item.packageName}@${item.version}`;
    if (pending.has(`${item.id} ${item.status}`) || !drafts.includes(tag)) {
      continue;
    }
    show('gh', ['release', 'edit', tag, '--draft=false']);
  }
}
