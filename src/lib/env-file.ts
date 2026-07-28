import { existsSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';

export type EnvWriteResult =
  | { action: 'created' | 'appended' | 'replaced' | 'skipped' }
  | { action: 'conflict'; existing: string }
  | { action: 'failed'; reason: string };

/**
 * Write CLOUDINARY_URL into an .env file.
 *
 * - No file → create it.
 * - File without CLOUDINARY_URL → append.
 * - File with CLOUDINARY_URL → 'conflict' unless force, which replaces the line in place.
 */
export function writeCloudinaryUrl(
  envPath: string,
  cloudinaryUrl: string,
  { force = false }: { force?: boolean } = {},
): EnvWriteResult {
  const line = `CLOUDINARY_URL=${cloudinaryUrl}`;

  if (!existsSync(envPath)) {
    writeFileSync(envPath, `${line}\n`, 'utf-8');
    return { action: 'created' };
  }

  const content = readFileSync(envPath, 'utf-8');
  const lines = content.split('\n');
  const index = lines.findIndex(l => /^\s*CLOUDINARY_URL\s*=/.test(l));

  if (index === -1) {
    const separator = content.endsWith('\n') || content === '' ? '' : '\n';
    writeFileSync(envPath, `${content}${separator}${line}\n`, 'utf-8');
    return { action: 'appended' };
  }

  if (!force) {
    return { action: 'conflict', existing: lines[index].trim() };
  }

  lines[index] = line;
  writeFileSync(envPath, lines.join('\n'), 'utf-8');
  return { action: 'replaced' };
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
