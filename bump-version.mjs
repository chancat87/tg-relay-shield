import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const type = process.argv[2] || 'patch';

// 1. 读取当前 package.json 版本
const pkgPath = path.join(__dirname, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const currentVersion = pkg.version;

let [major, minor, patch] = currentVersion.split('.').map(Number);

let newVersion = '';
if (type === 'major') {
  major += 1;
  minor = 0;
  patch = 0;
  newVersion = `${major}.${minor}.${patch}`;
} else if (type === 'minor') {
  minor += 1;
  patch = 0;
  newVersion = `${major}.${minor}.${patch}`;
} else if (type === 'patch') {
  patch += 1;
  newVersion = `${major}.${minor}.${patch}`;
} else if (/^\d+\.\d+\.\d+$/.test(type)) {
  newVersion = type;
} else {
  console.error(`❌ 未知版本递增类型: "${type}"。请使用 patch, minor, major 或指定版本号如 3.6.1`);
  process.exit(1);
}

const shieldVersion = `${newVersion}-Shield`;

console.log(`\n📦 正在执行自动化版本同步:`);
console.log(`   当前版本: ${currentVersion}`);
console.log(`   目标版本: ${newVersion} (${shieldVersion})\n`);

// 2. 更新 package.json
pkg.version = newVersion;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
console.log(`✓ [1/5] package.json -> ${newVersion}`);

// 3. 更新 worker.js
const workerPath = path.join(__dirname, 'worker.js');
let workerCode = fs.readFileSync(workerPath, 'utf8');
workerCode = workerCode.replace(/Version:\s*\d+\.\d+\.\d+-Shield/g, `Version: ${shieldVersion}`);
workerCode = workerCode.replace(/const BOT_VERSION = '[^']+';/, `const BOT_VERSION = '${shieldVersion}';`);
fs.writeFileSync(workerPath, workerCode, 'utf8');
console.log(`✓ [2/5] worker.js (BOT_VERSION) -> ${shieldVersion}`);

// 4. 更新 test_suite.mjs
const testPath = path.join(__dirname, 'test_suite.mjs');
let testCode = fs.readFileSync(testPath, 'utf8');
testCode = testCode.replace(/PRODUCTION TEST SUITES PASSED PERFECTLY \([^)]+\)/, `PRODUCTION TEST SUITES PASSED PERFECTLY (v${shieldVersion})`);
fs.writeFileSync(testPath, testCode, 'utf8');
console.log(`✓ [3/5] test_suite.mjs -> v${shieldVersion}`);

// 5. 更新 README.md
const readmePath = path.join(__dirname, 'README.md');
if (fs.existsSync(readmePath)) {
  let readme = fs.readFileSync(readmePath, 'utf8');
  readme = readme.replace(/Version-v\d+\.\d+\.\d+--Shield-blue\.svg/g, `Version-v${newVersion}--Shield-blue.svg`);
  fs.writeFileSync(readmePath, readme, 'utf8');
  console.log(`✓ [4/5] README.md 徽章 -> v${shieldVersion}`);
}

// 6. 更新 README_EN.md
const readmeEnPath = path.join(__dirname, 'README_EN.md');
if (fs.existsSync(readmeEnPath)) {
  let readmeEn = fs.readFileSync(readmeEnPath, 'utf8');
  readmeEn = readmeEn.replace(/Version-v\d+\.\d+\.\d+--Shield-blue\.svg/g, `Version-v${newVersion}--Shield-blue.svg`);
  fs.writeFileSync(readmeEnPath, readmeEn, 'utf8');
  console.log(`✓ [5/5] README_EN.md 徽章 -> v${shieldVersion}`);
}

console.log(`\n🎉 全项目 5 处版本号已 100% 自动同步更新为: v${shieldVersion}！\n`);
