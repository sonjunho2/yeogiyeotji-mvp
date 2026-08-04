'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');

async function availablePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

function runServer(env, expectHealth) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [path.join(__dirname, 'server.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = ''; let healthReached = false; let timedOut = false; let settled = false; let timer;
    child.stdout.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    const finish = (exitCode, exitSignal) => { if (settled) return; settled = true; clearTimeout(timer); resolve({ healthReached, exitCode, exitSignal, stdout, stderr, timedOut }); };
    const stop = () => { if (!child.killed) child.kill(); };
    child.once('error', error => finish(null, error.code || null));
    child.once('exit', finish);
    timer = setTimeout(() => { timedOut = true; stop(); }, 2500);
    const poll = async () => {
      try { const response = await fetch(`http://127.0.0.1:${env.PORT}/api/health`); if (response.status === 200) { healthReached = true; stop(); return; } } catch (_) {}
      if (!settled) setTimeout(poll, 50);
    };
    if (expectHealth) poll();
  });
}

function baseEnvironment(directory, port) {
  const env = { ...process.env, NODE_ENV: 'test', STORAGE_DRIVER: 'json', PORT: String(port), DATA_FILE: path.join(directory, 'store.json') };
  for (const key of ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_JWT_ISSUER', 'SUPABASE_JWKS_URL', 'SUPABASE_JWT_AUDIENCE']) delete env[key];
  return env;
}

(async () => {
  const directories = [];
  try {
    const normalDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'yeogiyeotji-auth-init-')); directories.push(normalDirectory);
    const normal = await runServer(baseEnvironment(normalDirectory, await availablePort()), true);
    assert.equal(normal.healthReached, true);
    assert.equal(normal.timedOut, false);
    assert.equal(normal.exitCode, null);

    const incompatibleDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'yeogiyeotji-auth-init-')); directories.push(incompatibleDirectory);
    const incompatibleEnv = { ...baseEnvironment(incompatibleDirectory, await availablePort()), SUPABASE_URL: 'https://test-project.supabase.co' };
    const incompatible = await runServer(incompatibleEnv, true);
    assert.equal(incompatible.healthReached, false);
    assert.equal(incompatible.timedOut, false);
    assert.equal(incompatible.exitCode, 1);
    assert.match(incompatible.stderr, /Server initialization failed: Authentication configuration is invalid/);
    assert.doesNotMatch(incompatible.stderr, /test-project\.supabase\.co|\.well-known\/jwks\.json|SUPABASE_URL|Error:|\bat server\b|stack/i);

    const partialDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'yeogiyeotji-auth-init-')); directories.push(partialDirectory);
    const partial = await runServer({ ...baseEnvironment(partialDirectory, await availablePort()), SUPABASE_JWT_AUDIENCE: 'private-test-audience' }, true);
    assert.equal(partial.healthReached, false);
    assert.equal(partial.timedOut, false);
    assert.equal(partial.exitCode, 1);
    assert.match(partial.stderr, /Server initialization failed: Authentication configuration is invalid/);
    assert.doesNotMatch(partial.stderr, /private-test-audience|SUPABASE_JWT_AUDIENCE|Error:|\bat server\b|stack/i);

    const publicConfigDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'yeogiyeotji-auth-init-')); directories.push(publicConfigDirectory);
    const publicConfig = await runServer({ ...baseEnvironment(publicConfigDirectory, await availablePort()), SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test' }, true);
    assert.equal(publicConfig.healthReached, false);
    assert.equal(publicConfig.exitCode, 1);
    assert.match(publicConfig.stderr, /Server initialization failed: Authentication configuration is invalid/);
    assert.doesNotMatch(publicConfig.stderr, /sb_publishable|SUPABASE_PUBLISHABLE_KEY|Error:|stack|at /i);
    console.log('Server auth initialization tests passed: disabled health, incompatible storage, and partial configuration scenarios');
  } finally {
    for (const directory of directories) fs.rmSync(directory, { recursive: true, force: true });
    for (const directory of directories) assert.equal(fs.existsSync(directory), false);
  }
})().catch(error => { console.error(`Server auth initialization tests failed: ${error.message}`); process.exitCode = 1; });
