/**
 * R07：SDK 依赖解析边界（全部合成假 SDK，无凭据、无真实 npm 安装、无真实云请求）。
 * 证明：默认边界只解析 worker 自有 node_modules；下层/偶然 node_modules 不被使用；
 * 无凭据装配（init 只带 env）；callFunction/downloadFile 形状与错误映射；sdkModulePath 显式边界。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createCloudClient, loadWorkerConfig, WorkerConfigError } from '../worker-runtime.mjs';

const SDK_PACKAGE = {
  'package.json': JSON.stringify({ name: '@cloudbase/node-sdk', version: '3.18.7-synthetic', main: 'index.js' }),
  'index.js': `
'use strict';
let lastInitArgs = null;
module.exports = {
  init(args) {
    lastInitArgs = args;
    return {
      callFunction: async (request) => {
        if (request && request.name === 'checkinFaceTest' && request.data && request.data.action === 'claimTask') {
          return { result: { code: 0, data: { task: null }, msg: '' } };
        }
        if (request && request.data && request.data.action === 'reportTask') {
          return { result: { code: 0, data: { ok: true }, msg: '' } };
        }
        if (request && request.data && request.data.action === 'beginTaskExecution') {
          return { result: { code: 'CLAIM_EXPIRED', data: null, msg: 'synthetic reject' } };
        }
        return { result: { code: 0, data: {}, msg: '' } };
      },
      downloadFile: async (request) => ({ fileContent: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) }),
    };
  },
  __getLastInitArgs() { return lastInitArgs; },
};
`,
}

async function installFakeSdk(rootDir) {
  const sdkDir = join(rootDir, 'node_modules', '@cloudbase', 'node-sdk');
  await mkdir(sdkDir, { recursive: true });
  for (const [name, content] of Object.entries(SDK_PACKAGE)) {
    await writeFile(join(sdkDir, name), content, 'utf8');
  }
  return sdkDir;
}

async function withTemp(run) {
  const dir = await mkdtemp(join(tmpdir(), 'checkin-face-sdk-'));
  try {
    return await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('R07：默认边界不解析 admin-web 下层/偶然 node_modules（旧断点复现并拒绝）', async () => {
  await withTemp(async (dir) => {
    await installFakeSdk(join(dir, 'admin-web')); // 只存在于“下层”目录
    const client = createCloudClient({ config: { cloudEnv: 'synthetic-env' }, env: {} });
    await assert.rejects(client, (error) => error instanceof WorkerConfigError && error.code === 'CLOUD_SDK_RESOLVE_FAILED');
  });
});

test('R07：显式边界不捡祖先级偶然 node_modules（NC-R07 的对偶断言）', async () => {
  await withTemp(async (dir) => {
    await installFakeSdk(dir); // dir 本身含 node_modules
    const anchor = join(dir, 'sub'); // sdkModulePath 指向不含 node_modules 的子目录
    await mkdir(anchor, { recursive: true });
    await assert.rejects(
      createCloudClient({ config: { cloudEnv: 'synthetic-env' }, env: {}, sdkModulePath: anchor }),
      (error) => error instanceof WorkerConfigError && error.code === 'CLOUD_SDK_RESOLVE_FAILED',
      '祖先级 node_modules 不得被显式边界拾取',
    );
    const ok = await createCloudClient({ config: { cloudEnv: 'synthetic-env' }, env: {}, sdkModulePath: dir });
    assert.equal(typeof ok.callFunction, 'function');
  });
});

test('R07：worker 自有 node_modules 是唯一默认边界——无注入替身即可解析并装配（无凭据 init）', async () => {
  await withTemp(async (dir) => {
    await installFakeSdk(dir); // dir 即 worker 安装根
    const client = await createCloudClient({ config: { cloudEnv: 'synthetic-env' }, env: {}, sdkModulePath: dir });
    const sdkEntry = join(dir, 'node_modules', '@cloudbase', 'node-sdk', 'index.js');
    const fake = (await import(pathToFileURL(sdkEntry).href)).default;
    assert.deepEqual(fake.__getLastInitArgs(), { env: 'synthetic-env' }, '无凭据装配：init 只携带 env，不带 secretId/secretKey');

    // 装配形状：claimTask 走 app.callFunction({name, data:{action,...}})
    const claimed = await client.callFunction('claimTask', { workerToken: 't', workerId: 'w' });
    assert.deepEqual(claimed, { task: null });

    // 错误映射：云端非零码携带闭式码
    await assert.rejects(
      () => client.callFunction('beginTaskExecution', { workerToken: 't', workerId: 'w', taskId: 'x', claimId: 'y', revision: 1 }),
      (error) => error instanceof WorkerConfigError && error.code === 'CLOUD_CALL_FAILED' && error.cloudCode === 'CLAIM_EXPIRED',
    );

    // 下载形状：真实 fileID 透传；非 cloud:// 拒绝
    const bytes = await client.downloadFile('cloud://synthetic/test-face/photo.jpg');
    assert.ok(Buffer.isBuffer(bytes) && bytes.length === 4);
    await assert.rejects(() => client.downloadFile('test-face/x.jpg'), (error) => error?.code === 'FILE_ID_INVALID');

    // action 白名单
    await assert.rejects(() => client.callFunction('unlockDevice', {}), (error) => error instanceof WorkerConfigError && error.code === 'CLOUD_ACTION_INVALID');
  });
});

test('R07：解析失败给出 worker 自有安装指引（含 npm install 提示），失败关闭', async () => {
  await withTemp(async (dir) => {
    await assert.rejects(
      createCloudClient({ config: { cloudEnv: 'synthetic-env' }, env: {}, sdkModulePath: dir }),
      (error) => error instanceof WorkerConfigError && error.code === 'CLOUD_SDK_RESOLVE_FAILED' && /npm install/.test(error.message),
    );
  });
});

test('R07：sdkModulePath 经 loadWorkerConfig 解析为绝对路径，缺省为空（默认 worker 自有边界）', async () => {
  const readJson = (extra) => loadWorkerConfig({
    configPath: 'C:/synthetic/worker.local.json',
    env: { CHECKIN_FACE_WORKER_TOKEN: 'SyntheticWorkerToken-0123456789abcdef' },
    readJsonFile: async () => JSON.stringify({
      cloudEnv: 'synthetic-env', workerId: 'w', deviceKey: 'device-key-stable',
      name: 'n', roomNote: '102',
      device: { origin: '', username: '', password: '', certificatePath: '', expectedModel: '', planTemplateNo: '', developmentTls: false },
      ...extra,
    }),
  });
  const withPath = await readJson({ sdkModulePath: 'C:/synthetic/worker-sdk' });
  assert.equal(withPath.sdkModulePath, resolve('C:/synthetic/worker-sdk'), '必须解析为绝对路径');
  const withoutPath = await readJson({});
  assert.equal(withoutPath.sdkModulePath, '');
});

test('R07：worker 自有 package.json 锁定 @cloudbase/node-sdk 3.18.7（与 admin-web 一致）', async () => {
  const { readFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const { dirname, join } = await import('node:path');
  const workerDir = join(dirname(fileURLToPath(import.meta.url)), '..');
  const pkg = JSON.parse(await readFile(join(workerDir, 'package.json'), 'utf8'));
  assert.equal(pkg.dependencies['@cloudbase/node-sdk'], '3.18.7');
  assert.equal(pkg.overrides.axios, '0.34.0');
  assert.equal(pkg.overrides['@cloudbase/database'], '2.0.0');
});
