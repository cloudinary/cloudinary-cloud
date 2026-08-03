import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

interface PackageInfo {
  name: string;
  version: string;
}

let cached: PackageInfo | undefined;

/** Name + version from package.json, so a package rename never chases constants. */
export function getPackageInfo(): PackageInfo {
  if (!cached) {
    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as PackageInfo;
    cached = { name: pkg.name, version: pkg.version };
  }
  return cached;
}

export function userAgent(): string {
  const { name, version } = getPackageInfo();
  const slug = name.replace(/^@/, '').replace('/', '-');
  return `${slug}/${version} node/${process.version}`;
}
