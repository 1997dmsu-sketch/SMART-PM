import { readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';

const root = fileURLToPath(new URL('../cloudfunctions/', import.meta.url));
const queue = readdirSync(root).filter(name => existsSync(resolve(root, name, 'package.json')));
let failed = false;
async function worker() {
  while (queue.length) {
    const name = queue.shift();
    const cwd = resolve(root, name);
    // Legacy addTuyaDevice lock omits node-fetch; preserve source files and resolve locally.
    const useLock = name !== 'addTuyaDevice' && existsSync(resolve(cwd, 'package-lock.json'));
    const command = useLock ? ['ci'] : ['install', '--package-lock=false'];
    console.log(`Installing ${name}`);
    const code = await new Promise((done, reject) => {
      const proc = spawn('npm', [...command, '--no-audit', '--no-fund'], {
        cwd, stdio: 'inherit',
        env: { ...process.env, npm_config_cache: process.env.npm_config_cache || '/workspace/.smart-pm-npm-cache' },
      });
      proc.on('error', reject);
      proc.on('close', done);
    });
    if (code !== 0) { console.error(`Installation failed: ${name}`); failed = true; }
  }
}
await Promise.all(Array.from({ length: 4 }, worker));
if (failed) process.exitCode = 1;
