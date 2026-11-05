// One-time setup for auto-updates: points the app at your GitHub repository.
// Run with:  npm run setup-updates
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const file = path.join(__dirname, '..', 'package.json');
const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
const pub = pkg.build.publish[0];
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q, def) => new Promise((res) => rl.question(def ? `${q} (${def}): ` : `${q}: `, (a) => res(a.trim() || def || '')));

(async () => {
  console.log('\nGlass Dock auto-updates use GitHub Releases (free).');
  console.log('You need a GitHub account and an empty public repository for the app.\n');
  const owner = await ask('Your GitHub username', pub.owner !== 'YOUR_GITHUB_NAME' ? pub.owner : '');
  const repo = await ask('Repository name', pub.repo || 'glass-dock');
  rl.close();
  if (!/^[A-Za-z0-9-]+$/.test(owner) || !/^[A-Za-z0-9._-]+$/.test(repo)) {
    console.log('\nThat name doesn\'t look right. Nothing was changed.');
    process.exit(1);
  }
  pkg.build.publish[0] = { ...pub, owner, repo };
  fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n');
  console.log(`\nDone. Updates will come from https://github.com/${owner}/${repo}/releases`);
  console.log('\nTo publish a version:');
  console.log('  1. Make a GitHub token: github.com → Settings → Developer settings → Personal access tokens →');
  console.log('     Fine-grained token → only this repository → Contents: Read and write.');
  console.log('  2. In this window run:   set GH_TOKEN=paste_your_token_here');
  console.log('  3. Raise "version" in package.json (for example 1.0.0 → 1.0.1)');
  console.log('  4. Run:   npm run release');
  console.log('\nEveryone with Glass Dock installed gets the new version automatically.\n');
})();
