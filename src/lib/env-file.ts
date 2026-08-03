import { existsSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';

export type EnvWriteResult =
  | { action: 'created' | 'appended' | 'replaced' | 'skipped' }
  | { action: 'conflict'; existing: string }
  | { action: 'failed'; reason: string };

export interface CloudEnvEntries {
  cloudinaryUrl: string;
  /** Persisted so the claim path survives lost terminal output. */
  claimUrl?: string;
  expiresAt?: string;
}

const CLAIM_URL_KEY = 'CLOUDINARY_CLOUD_CLAIM_URL';
const EXPIRES_AT_KEY = 'CLOUDINARY_CLOUD_EXPIRES_AT';

/**
 * Write the cloud's env entries (CLOUDINARY_URL plus the claim URL and
 * expiry) into an .env file.
 *
 * - No file → create it.
 * - File without CLOUDINARY_URL → append entries (upserting stale cloud keys).
 * - File with CLOUDINARY_URL → 'conflict' unless force, which replaces in place.
 *
 * Conflict detection keys off CLOUDINARY_URL alone — the cloud metadata keys
 * follow whatever it does.
 */
export function writeCloudEnv(
  envPath: string,
  entries: CloudEnvEntries,
  { force = false }: { force?: boolean } = {},
): EnvWriteResult {
  const pairs: Array<[string, string]> = [['CLOUDINARY_URL', entries.cloudinaryUrl]];
  if (entries.claimUrl) pairs.push([CLAIM_URL_KEY, entries.claimUrl]);
  if (entries.expiresAt) pairs.push([EXPIRES_AT_KEY, entries.expiresAt]);

  if (!existsSync(envPath)) {
    writeFileSync(envPath, pairs.map(([k, v]) => `${k}=${v}`).join('\n') + '\n', 'utf-8');
    return { action: 'created' };
  }

  const content = readFileSync(envPath, 'utf-8');
  const lines = content.split('\n');
  const urlIndex = lines.findIndex(l => /^\s*CLOUDINARY_URL\s*=/.test(l));

  if (urlIndex !== -1 && !force) {
    return { action: 'conflict', existing: lines[urlIndex].trim() };
  }

  const upserted = upsert(lines, pairs);
  writeFileSync(envPath, upserted.join('\n'), 'utf-8');
  return { action: urlIndex === -1 ? 'appended' : 'replaced' };
}

/** Replace each key's line in place, appending keys that aren't present. */
function upsert(lines: string[], pairs: Array<[string, string]>): string[] {
  const result = [...lines];
  const trailingBlank = result[result.length - 1] === '' ? result.pop() : undefined;

  for (const [key, value] of pairs) {
    const line = `${key}=${value}`;
    const index = result.findIndex(l => new RegExp(`^\\s*${key}\\s*=`).test(l));
    if (index === -1) result.push(line);
    else result[index] = line;
  }

  if (trailingBlank !== undefined || result.length > 0) result.push('');
  return result;
}

/** Read a persisted cloud entry back (for the future `claim`/`status` commands). */
export function readCloudEnv(envPath: string): Partial<CloudEnvEntries> {
  if (!existsSync(envPath)) return {};
  try {
    const lines = readFileSync(envPath, 'utf-8').split('\n');
    const get = (key: string) =>
      lines.find(l => l.trimStart().startsWith(`${key}=`))?.split('=').slice(1).join('=').trim();
    return {
      cloudinaryUrl: get('CLOUDINARY_URL'),
      claimUrl: get(CLAIM_URL_KEY),
      expiresAt: get(EXPIRES_AT_KEY),
    };
  } catch {
    return {};
  }
}

export function hasCloudinaryUrl(envPath: string): boolean {
  if (!existsSync(envPath)) return false;
  try {
    return readFileSync(envPath, 'utf-8')
      .split('\n')
      .some(l => /^\s*CLOUDINARY_URL\s*=/.test(l));
  } catch {
    // Unreadable (permissions, or .env is a directory): can't confirm a
    // conflict, so let init proceed — the write itself reports the failure.
    return false;
  }
}

/**
 * True when the .env file's directory is a git repo whose .gitignore does not
 * cover `.env` — i.e. the secrets we just wrote could be committed. Only the
 * same directory is checked (not parent gitignores or negations); a false
 * negative here just means no warning.
 */
export function isEnvExposedToGit(envPath: string): boolean {
  const dir = dirname(envPath);
  if (!existsSync(join(dir, '.git'))) return false;

  const gitignorePath = join(dir, '.gitignore');
  if (!existsSync(gitignorePath)) return true;

  const patterns = readFileSync(gitignorePath, 'utf-8').split('\n').map(l => l.trim());
  const covers = patterns.some(p =>
    p === '.env' || p === '/.env' || p === '.env*' || p === '*.env' || p === '.env.*',
  );
  return !covers;
}
