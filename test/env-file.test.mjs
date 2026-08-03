import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { writeCloudEnv, readCloudEnv, hasCloudinaryUrl, isEnvExposedToGit } from '../dist/lib/env-file.js';

const URL_A = 'cloudinary://key:secret@cloud-a';
const URL_B = 'cloudinary://key2:secret2@cloud-b';

function tempEnvPath() {
  return join(mkdtempSync(join(tmpdir(), 'cld-env-')), '.env');
}

test('creates .env when missing', () => {
  const envPath = tempEnvPath();
  const result = writeCloudEnv(envPath, { cloudinaryUrl: URL_A });
  assert.equal(result.action, 'created');
  assert.equal(readFileSync(envPath, 'utf-8'), `CLOUDINARY_URL=${URL_A}\n`);
});

test('appends to existing .env without CLOUDINARY_URL', () => {
  const envPath = tempEnvPath();
  writeFileSync(envPath, 'OTHER_VAR=hello\n');
  const result = writeCloudEnv(envPath, { cloudinaryUrl: URL_A });
  assert.equal(result.action, 'appended');
  assert.equal(readFileSync(envPath, 'utf-8'), `OTHER_VAR=hello\nCLOUDINARY_URL=${URL_A}\n`);
});

test('appends with newline separator when file lacks trailing newline', () => {
  const envPath = tempEnvPath();
  writeFileSync(envPath, 'OTHER_VAR=hello');
  writeCloudEnv(envPath, { cloudinaryUrl: URL_A });
  assert.equal(readFileSync(envPath, 'utf-8'), `OTHER_VAR=hello\nCLOUDINARY_URL=${URL_A}\n`);
});

test('conflicts when CLOUDINARY_URL exists and force is off', () => {
  const envPath = tempEnvPath();
  writeFileSync(envPath, `CLOUDINARY_URL=${URL_A}\n`);
  const result = writeCloudEnv(envPath, { cloudinaryUrl: URL_B });
  assert.equal(result.action, 'conflict');
  assert.match(result.existing, /CLOUDINARY_URL=/);
  assert.equal(readFileSync(envPath, 'utf-8'), `CLOUDINARY_URL=${URL_A}\n`);
});

test('force replaces the existing line in place, preserving neighbors', () => {
  const envPath = tempEnvPath();
  writeFileSync(envPath, `BEFORE=1\nCLOUDINARY_URL=${URL_A}\nAFTER=2\n`);
  const result = writeCloudEnv(envPath, { cloudinaryUrl: URL_B }, { force: true });
  assert.equal(result.action, 'replaced');
  assert.equal(readFileSync(envPath, 'utf-8'), `BEFORE=1\nCLOUDINARY_URL=${URL_B}\nAFTER=2\n`);
});

test('hasCloudinaryUrl detects the key with surrounding whitespace', () => {
  const envPath = tempEnvPath();
  assert.equal(hasCloudinaryUrl(envPath), false);
  writeFileSync(envPath, `  CLOUDINARY_URL = ${URL_A}\n`);
  assert.equal(hasCloudinaryUrl(envPath), true);
});

test('persists claim URL and expiry alongside CLOUDINARY_URL', () => {
  const envPath = tempEnvPath();
  const result = writeCloudEnv(envPath, {
    cloudinaryUrl: URL_A,
    claimUrl: 'https://console.cloudinary.com/claim?token=t1',
    expiresAt: '2026-08-01T00:00:00Z',
  });
  assert.equal(result.action, 'created');
  assert.equal(
    readFileSync(envPath, 'utf-8'),
    `CLOUDINARY_URL=${URL_A}\n` +
    'CLOUDINARY_CLOUD_CLAIM_URL=https://console.cloudinary.com/claim?token=t1\n' +
    'CLOUDINARY_CLOUD_EXPIRES_AT=2026-08-01T00:00:00Z\n',
  );
});

test('force upserts all cloud keys in place, preserving neighbors', () => {
  const envPath = tempEnvPath();
  writeFileSync(envPath,
    `BEFORE=1\nCLOUDINARY_URL=${URL_A}\nCLOUDINARY_CLOUD_CLAIM_URL=https://old\nAFTER=2\n`);
  const result = writeCloudEnv(envPath, {
    cloudinaryUrl: URL_B,
    claimUrl: 'https://new',
    expiresAt: '2026-08-02T00:00:00Z',
  }, { force: true });
  assert.equal(result.action, 'replaced');
  assert.equal(
    readFileSync(envPath, 'utf-8'),
    `BEFORE=1\nCLOUDINARY_URL=${URL_B}\nCLOUDINARY_CLOUD_CLAIM_URL=https://new\nAFTER=2\n` +
    'CLOUDINARY_CLOUD_EXPIRES_AT=2026-08-02T00:00:00Z\n',
  );
});

test('readCloudEnv round-trips the persisted entries', () => {
  const envPath = tempEnvPath();
  writeCloudEnv(envPath, {
    cloudinaryUrl: URL_A,
    claimUrl: 'https://console.cloudinary.com/claim?token=t=with=equals',
    expiresAt: '2026-08-01T00:00:00Z',
  });
  const read = readCloudEnv(envPath);
  assert.equal(read.cloudinaryUrl, URL_A);
  assert.equal(read.claimUrl, 'https://console.cloudinary.com/claim?token=t=with=equals');
  assert.equal(read.expiresAt, '2026-08-01T00:00:00Z');
  assert.deepEqual(readCloudEnv(join(dirname(envPath), 'missing.env')), {});
});

test('handles CRLF line endings (Windows-authored .env)', () => {
  const envPath = tempEnvPath();
  writeFileSync(envPath, 'OTHER=1\r\nCLOUDINARY_URL=old\r\nAFTER=2\r\n');
  assert.equal(hasCloudinaryUrl(envPath), true);
  const result = writeCloudEnv(envPath, { cloudinaryUrl: URL_B }, { force: true });
  assert.equal(result.action, 'replaced');
  const content = readFileSync(envPath, 'utf-8');
  assert.ok(content.includes(`CLOUDINARY_URL=${URL_B}`));
  assert.ok(content.includes('OTHER=1'));
  assert.ok(content.includes('AFTER=2'));
});

test('isEnvExposedToGit: no .git dir → not exposed', () => {
  const envPath = tempEnvPath();
  assert.equal(isEnvExposedToGit(envPath), false);
});

test('isEnvExposedToGit: git repo without .gitignore → exposed', () => {
  const envPath = tempEnvPath();
  mkdirSync(join(dirname(envPath), '.git'));
  assert.equal(isEnvExposedToGit(envPath), true);
});

test('isEnvExposedToGit: .gitignore covering .env → not exposed', () => {
  const envPath = tempEnvPath();
  const dir = dirname(envPath);
  mkdirSync(join(dir, '.git'));
  writeFileSync(join(dir, '.gitignore'), 'node_modules/\n.env\n');
  assert.equal(isEnvExposedToGit(envPath), false);
});

test('isEnvExposedToGit: .gitignore without .env pattern → exposed', () => {
  const envPath = tempEnvPath();
  const dir = dirname(envPath);
  mkdirSync(join(dir, '.git'));
  writeFileSync(join(dir, '.gitignore'), 'node_modules/\ndist/\n');
  assert.equal(isEnvExposedToGit(envPath), true);
});
