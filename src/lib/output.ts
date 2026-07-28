import * as pc from './colors.js';
import { getCloudinaryUrl, getActiveAccessKey, type SandboxAccount } from './provision.js';
import type { EnvWriteResult } from './env-file.js';

export interface OutputContext {
  envPath: string;
  envResult: EnvWriteResult;
}

function minutesUntil(iso: string): number | null {
  const expires = Date.parse(iso);
  if (Number.isNaN(expires)) return null;
  return Math.max(0, Math.round((expires - Date.now()) / 60_000));
}

function describeEnvResult(result: EnvWriteResult, envPath: string): string {
  switch (result.action) {
    case 'created': return `Created ${envPath} with CLOUDINARY_URL`;
    case 'appended': return `Appended CLOUDINARY_URL to ${envPath}`;
    case 'replaced': return `Replaced CLOUDINARY_URL in ${envPath}`;
    case 'conflict': return `Left ${envPath} unchanged (already has ${result.existing.split('=')[0]})`;
    case 'skipped': return 'Not written (disabled with --no-env)';
    case 'failed': return `NOT WRITTEN — ${result.reason}. Store the credentials above now.`;
  }
}

/** Human-facing summary for interactive terminals. */
export function printHumanSummary(account: SandboxAccount, ctx: OutputContext): void {
  const env = account.product_environments[0];
  const mins = minutesUntil(account.expires_at);
  const expiry = mins === null ? account.expires_at : `${account.expires_at} (${mins} minutes from now)`;

  console.log();
  console.log(pc.green(pc.bold('  ✔ Sandbox provisioned — your media is live on Cloudinary')));
  console.log();
  console.log(`  ${pc.dim('Cloud name')}    ${pc.cyan(env.cloud_name)}`);
  console.log(`  ${pc.dim('Expires')}       ${pc.yellow(expiry)}`);
  console.log(`  ${pc.dim('Delivery IPs')}  ${account.delivery_ips.join(', ')}`);
  console.log(`  ${pc.dim('Env file')}      ${describeEnvResult(ctx.envResult, ctx.envPath)}`);
  console.log();
  console.log(pc.bold('  Keep this account (and its assets) past expiry:'));
  console.log(`  ${pc.dim('Send this claim link to a human — opening it and verifying an email')}`);
  console.log(`  ${pc.dim('makes the sandbox permanent with the same credentials.')}`);
  console.log();
  console.log(`  ${pc.cyan(pc.underline(account.claim_url))}`);
  console.log();
  if (account.guidance) {
    console.log(pc.dim(`  ${account.guidance}`));
    console.log();
  }
}

/** Greppable KEY=value lines for non-TTY callers (agents) not using --json. */
export function printPlainSummary(account: SandboxAccount, ctx: OutputContext): void {
  const env = account.product_environments[0];
  const accessKey = getActiveAccessKey(env);
  console.log(`CLOUD_NAME=${env.cloud_name}`);
  console.log(`API_KEY=${accessKey.key}`);
  console.log(`API_SECRET=${accessKey.secret}`);
  console.log(`CLOUDINARY_URL=${getCloudinaryUrl(env)}`);
  console.log(`EXPIRES_AT=${account.expires_at}`);
  console.log(`CLAIM_URL=${account.claim_url}`);
  console.log(`DELIVERY_IPS=${account.delivery_ips.join(',')}`);
  console.log(`ENV_FILE=${ctx.envPath}`);
  console.log(`ENV_FILE_ACTION=${ctx.envResult.action}`);
}
