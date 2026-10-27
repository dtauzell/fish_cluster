import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gitVersion } from '../scripts/git-version.mjs';
import { versionLabel, requestAppVersion } from '../dist/version.mjs';

test('version stamping reads the commit date and distinguishes source edits from generated metadata', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'fish-git-version-'));
  const git = args => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_AUTHOR_DATE: '2026-10-27T11:30:00-05:00', GIT_COMMITTER_DATE: '2026-10-27T12:30:00-05:00' } }).trim();
  try {
    git(['init', '-q']);
    await mkdir(join(cwd, 'dist'));
    await writeFile(join(cwd, 'dist/offline-assets.js'), 'generated');
    await writeFile(join(cwd, 'dist/app.mjs'), 'source');
    git(['add', '.']);
    git(['-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', '-c', 'user.name=Version Test',
      '-c', 'user.email=version@example.invalid', 'commit', '-qm', 'Version fixture']);
    const clean = gitVersion(cwd);
    assert.equal(clean.commit, git(['rev-parse', 'HEAD']));
    assert.equal(clean.commitDate, '2026-10-27T12:30:00-05:00');
    assert.equal(clean.dirty, false);
    await writeFile(join(cwd, 'dist/offline-assets.js'), 'new generated snapshot');
    assert.equal(gitVersion(cwd).dirty, false);
    await writeFile(join(cwd, 'dist/app.mjs'), 'edited source');
    assert.equal(gitVersion(cwd).dirty, true);
    await writeFile(join(cwd, 'dist/app.mjs'), 'source');
    await writeFile(join(cwd, 'untracked.mjs'), 'new source');
    assert.equal(gitVersion(cwd).dirty, true);
  } finally { await rm(cwd, { recursive: true, force: true }); }
});

test('a source copy without Git metadata has an honest unavailable version', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'fish-no-git-'));
  try { assert.deepEqual(gitVersion(cwd), { commit: null, commitDate: null, dirty: null }); }
  finally { await rm(cwd, { recursive: true, force: true }); }
  assert.equal(versionLabel(), 'Version unavailable');
});

test('the version label includes the short commit, commit date, and modified state', () => {
  const metadata = { version: { commit: '1234567890abcdef1234567890abcdef12345678', commitDate: '2026-10-27T11:30:00-05:00', dirty: false } };
  assert.match(versionLabel(metadata), /^Version 12345678 · /);
  assert.match(versionLabel(metadata), /2026/);
  assert.ok(!versionLabel(metadata).includes('modified'));
  assert.match(versionLabel({ version: { ...metadata.version, dirty: true } }), / · modified$/);
});

test('the page reads the serving worker version over a message channel', async () => {
  const metadata = { revision: 'offline-release', version: { commit: 'older-serving-commit', commitDate: '2026-10-26T00:00:00Z' } };
  const worker = { postMessage: (message, [port]) => {
    assert.equal(message.type, 'GET_APP_VERSION');
    port.postMessage(metadata);
    port.close();
  } };
  assert.deepEqual(await requestAppVersion(worker), metadata);
  await assert.rejects(requestAppVersion({ postMessage() {} }, 10), /Version unavailable/);
});
