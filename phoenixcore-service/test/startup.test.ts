import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { test } from 'node:test';

test('the default hosting entry serves health on the assigned SERVER_PORT', { timeout: 10000 }, async t => {
  const child = spawn(process.execPath, ['index.js'], {
    cwd: new URL('../../', import.meta.url),
    env: {
      ...process.env,
      PORT: '',
      SERVER_PORT: '0',
      DATABASE_URL: '',
      SQLITE_FILE: ':memory:',
      DISCORD_RP_ENABLED: 'false',
      SERVICE_ORIGIN: 'http://localhost',
      DASHBOARD_URL: 'http://localhost/phoenixcore/',
      DISCORD_CLIENT_ID: '800000000000000001',
      DISCORD_GUILD_ID: '800000000000000002',
      DISCORD_OWNER_ID: '800000000000000003',
      DISCORD_PUBLIC_KEY: 'ab'.repeat(32),
      DISCORD_CLIENT_SECRET: 'test-only',
      DISCORD_BOT_TOKEN: 'test-only'
    },
    stdio: ['ignore', 'pipe', 'inherit']
  });
  const exited = once(child, 'exit');
  t.after(async () => {
    child.kill();
    await exited;
  });

  const lines = createInterface({ input: child.stdout });
  for await (const line of lines) {
    const match = /^PhoenixCore is listening on port (\d+)$/.exec(line);
    if (!match) continue;
    const port = Number(match[1]);
    assert.ok(port > 0 && port !== 4100, 'expected the port assigned by the OS');
    const response = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
    return;
  }
  assert.fail('PhoenixCore exited before it began listening');
});
