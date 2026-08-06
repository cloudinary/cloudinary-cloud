import { join } from 'path';
import * as pc from '../lib/colors.js';
import {
  provisionCloud,
  getCloudinaryUrl,
  ProvisionError,
  type ProvisionRequest,
  type CloudAccount,
} from '../lib/provision.js';
import { writeCloudEnv, hasCloudinaryUrl, isEnvExposedToGit, type EnvWriteResult } from '../lib/env-file.js';
import { printHumanSummary, printPlainSummary } from '../lib/output.js';
import { getObservedPublicIp, deliveryIpMismatchWarning, privateRequesterHint } from '../lib/ip-check.js';
import { detectAgentMetadata } from '../lib/agent-metadata.js';

export interface CreateOptions {
  ip?: string[];
  email?: string;
  json?: boolean;
  force?: boolean;
  apiHost?: string;
  /** Skip writing .env entirely (used by callers that persist credentials themselves). */
  env?: boolean;
  /** What the agent is building; sent as agent_goal attribution when provided. */
  goal?: string;
  /** The LLM model driving the session; overrides env detection (which usually finds nothing). */
  model?: string;
  /** Set false (--no-agent-metadata) to omit attribution fields entirely. */
  agentMetadata?: boolean;
  /** Test seam for the public-IP echo lookup. */
  ipEchoFetch?: typeof fetch;
}

export interface CreateResult {
  account: CloudAccount;
  cloudinaryUrl: string;
  envPath: string;
  envResult: EnvWriteResult;
}

/**
 * Provision a cloud and persist CLOUDINARY_URL to ./.env.
 * Programmatic core shared by the `create` command and @cloudinary/dev-cli.
 */
export async function runCreate(options: CreateOptions): Promise<CreateResult> {
  // Default: omit delivery_ips — the server derives the allow-list from the
  // requester's resolved address. Explicit --ip values are sent verbatim.
  // (The public-IP lookup is diagnostics-only; see the post-create warning.)
  const request: ProvisionRequest = {};
  if (options.ip && options.ip.length > 0) request.deliveryIps = options.ip;

  if (options.email !== undefined) request.email = options.email;

  // Experimental agent attribution — remove with lib/agent-metadata.ts.
  if (options.agentMetadata !== false) {
    request.agentMetadata = detectAgentMetadata(process.env, options.goal);
    if (options.model) request.agentMetadata.agent_llm_model = options.model;
  }

  const envPath = join(process.cwd(), '.env');
  const writeEnv = options.env !== false;

  // Refuse before provisioning: a cloud is rate-limited and disposable, so don't
  // burn one only to then refuse to store its credentials.
  if (writeEnv && !options.force && hasCloudinaryUrl(envPath)) {
    throw new ProvisionError(
      `${envPath} already contains CLOUDINARY_URL. Re-run with --force to provision a new cloud and replace it.`,
      409,
    );
  }

  const account = await provisionCloud(request, { apiHost: options.apiHost });
  const cloudinaryUrl = getCloudinaryUrl(account.product_environments[0]);

  // The cloud exists from here on — an .env write failure (read-only cwd, CI,
  // clouded runtime) must never swallow the credentials, so it becomes a
  // 'failed' result instead of an exception.
  let envResult: EnvWriteResult = { action: 'skipped' };
  if (writeEnv) {
    try {
      envResult = writeCloudEnv(envPath, {
        cloudinaryUrl,
        claimUrl: account.claim_url,
        expiresAt: account.expires_at,
      }, { force: options.force });
    } catch (err) {
      envResult = { action: 'failed', reason: (err as Error).message };
    }
  }

  return { account, cloudinaryUrl, envPath, envResult };
}

/** CLI action wrapper: output + exit codes around runCreate. */
export async function createCommand(options: CreateOptions): Promise<void> {
  try {
    const result = await runCreate(options);

    if (options.json) {
      console.log(JSON.stringify({ ...result.account, env_file: result.envPath, env_file_action: result.envResult.action }, null, 2));
    } else if (process.stdout.isTTY) {
      printHumanSummary(result.account, result);
    } else {
      printPlainSummary(result.account, result);
    }

    if (result.envResult.action === 'failed') {
      console.error(pc.yellow(`Warning: could not write ${result.envPath}: ${result.envResult.reason}`));
      console.error(pc.yellow('The credentials above are your only copy — store them now.'));
    } else if (result.envResult.action !== 'skipped' && isEnvExposedToGit(result.envPath)) {
      console.error(pc.yellow('Warning: .env is not covered by .gitignore here — add it before committing.'));
    }

    // Diagnostics only: delivery is IP-locked to the allow-list the server
    // returned. If this machine's externally observed IP isn't in it (VPN
    // split egress, NAT pools), the first media request would 401 with no
    // explanation — warn now with the exact fix instead. Never shapes the
    // request; failure to determine the IP just means no warning.
    const observed = await getObservedPublicIp(options.ipEchoFetch ?? fetch);
    const mismatch = deliveryIpMismatchWarning(result.account.delivery_ips ?? [], observed);
    if (mismatch) console.error(pc.yellow(`Warning: ${mismatch}`));
  } catch (err) {
    if (err instanceof ProvisionError) {
      const requesterHint = err.code === 'delivery_ips_not_public'
        ? privateRequesterHint(err.message, options.ip)
        : null;
      // --json callers parse stdout; give them the API's error envelope shape.
      if (options.json) {
        console.log(JSON.stringify({
          error: {
            category: err.category ?? 'error',
            ...(err.code ? { code: err.code } : {}),
            message: err.message,
            ...(requesterHint ? { hint: requesterHint } : {}),
          },
        }, null, 2));
        process.exit(1);
      }
      const detail = err.code ? ` [${err.code}]` : '';
      console.error(pc.red(`Error: ${err.message}${detail}`));
      if (err.code === 'ip_rate_limit_exceeded' || err.code === 'global_rate_limit_exceeded') {
        console.error(pc.dim('A rate limit was hit. Wait a while before provisioning another cloud.'));
      } else if (err.code === 'agent_registration_disabled') {
        console.error(pc.dim('Cloud provisioning is currently disabled by Cloudinary.'));
      } else if (requesterHint) {
        console.error(pc.dim(requesterHint));
      }
      process.exit(1);
    }
    console.error(pc.red(`Error: ${(err as Error).message}`));
    process.exit(1);
  }
}
