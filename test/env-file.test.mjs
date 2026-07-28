import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { writeCloudinaryUrl, hasCloudinaryUrl, isEnvExposedToGit } from '../dist/lib/env-file.js';

const URL_A = 'cloudinary://key:secret@cloud-a';
const URL_B = 'cloudinary://key2:secret2@cloud-b';

function tempEnvPath() {
  return join(mkdtempSync(join(tmpdir(), 'cld-env-')), '.env');
}

test('creates .env when missing', () => {
  const envPath = tempEnvPath();
  const result = writeCloudinaryUrl(envPath, URL_A);
  assert.equal(result.action, 'created');
  assert.equal(readFileSync(envPath, 'utf-8'), `CLOUDINARY_URL=${URL_A}\n`);
});

test('appends to existing .env without CLOUDINARY_URL', () => {
  const envPath = tempEnvPath();
  writeFileSync(envPath, 'OTHER_VAR=hello\n');
  const result = writeCloudinaryUrl(envPath, URL_A);
  assert.equal(result.action, 'appended');
  assert.equal(readFileSync(envPath, 'utf-8'), `OTHER_VAR=hello\nCLOUDINARY_URL=${URL_A}\n`);
});

test('appends with newline separator when file lacks trailing newline', () => {
  const envPath = tempEnvPath();
  writeFileSync(envPath, 'OTHER_VAR=hello');
  writeCloudinaryUrl(envPath, URL_A);
  assert.equal(readFileSync(envPath, 'utf-8'), `OTHER_VAR=hello\nCLOUDINARY_URL=${URL_A}\n`);
});

test('conflicts when CLOUDINARY_URL exists and force is off', () => {
  const envPath = tempEnvPath();
  writeFileSync(envPath, `CLOUDINARY_URL=${URL_A}\n`);
  const result = writeCloudinaryUrl(envPath, URL_B);
  assert.equal(result.action, 'conflict');
  assert.match(result.existing, /CLOUDINARY_URL=/);
  assert.equal(readFileSync(envPath, 'utf-8'), `CLOUDINARY_URL=${URL_A}\n`);
});

test('force replaces the existing line in place, preserving neighbors', () => {
  const envPath = tempEnvPath();
  writeFileSync(envPath, `BEFORE=1\nCLOUDINARY_URL=${URL_A}\nAFTER=2\n`);
  const result = writeCloudinaryUrl(envPath, URL_B, { force: true });
  assert.equal(result.action, 'replaced');
  assert.equal(readFileSync(envPath, 'utf-8'), `BEFORE=1\nCLOUDINARY_URL=${URL_B}\nAFTER=2\n`);
});

test('hasCloudinaryUrl detects the key with surrounding whitespace', () => {
  const envPath = tempEnvPath();
  assert.equal(hasCloudinaryUrl(envPath), false);
  writeFileSync(envPath, `  CLOUDINARY_URL = ${URL_A}\n`);
  assert.equal(hasCloudinaryUrl(envPath), true);
});

test('handles CRLF line endings (Windows-authored .env)', () => {
  const envPath = tempEnvPath();
  writeFileSync(envPath, 'OTHER=1\r\nCLOUDINARY_URL=old\r\nAFTER=2\r\n');
  assert.equal(hasCloudinaryUrl(envPath), true);
  const result = writeCloudinaryUrl(envPath, URL_B, { force: true });
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
