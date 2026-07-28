import { join } from 'path';
import * as pc from '../lib/colors.js';
import {
  provisionSandbox,
  getCloudinaryUrl,
  ProvisionError,
  REQUESTER_IP_SENTINEL,
  type ProvisionRequest,
  type SandboxAccount,
} from '../lib/provision.js';
import { writeCloudinaryUrl, hasCloudinaryUrl, isEnvExposedToGit, type EnvWriteResult } from '../lib/env-file.js';
import { printHumanSummary, printPlainSummary } from '../lib/output.js';

export interface CreateOptions {
  ip?: string[];
  email?: string;
  json?: boolean;
  force?: boolean;
  apiHost?: string;
  /** Skip writing .env entirely (used by callers that persist credentials themselves). */
  env?: boolean;
}

export interface CreateResult {
  account: SandboxAccount;
  cloudinaryUrl: string;
  envPath: string;
  envResult: EnvWriteResult;
}

/**
 * Provision a sandbox and persist CLOUDINARY_URL to ./.env.
 * Programmatic core shared by the `create` command and @cloudinary/dev-cli.
 */
export async function runCreate(options: CreateOptions): Promise<CreateResult> {
  const request: ProvisionRequest = {
    deliveryIps: options.ip && options.ip.length > 0 ? options.ip : [REQUESTER_IP_SENTINEL],
  };

  if (options.email !== undefined) request.email = options.email;

  const envPath = join(process.cwd(), '.env');
  const writeEnv = options.env !== false;

  // Refuse before provisioning: a sandbox is rate-limited and disposable, so don't
  // burn one only to then refuse to store its credentials.
  if (writeEnv && !options.force && hasCloudinaryUrl(envPath)) {
    throw new ProvisionError(
      `${envPath} already contains CLOUDINARY_URL. Re-run with --force to provision a new sandbox and replace it.`,
      409,
    );
  }

  const account = await provisionSandbox(request, { apiHost: options.apiHost });
  const cloudinaryUrl = getCloudinaryUrl(account.product_environments[0]);

  // The sandbox exists from here on — an .env write failure (read-only cwd, CI,
  // sandboxed runtime) must never swallow the credentials, so it becomes a
  // 'failed' result instead of an exception.
  let envResult: EnvWriteResult = { action: 'skipped' };
  if (writeEnv) {
    try {
      envResult = writeCloudinaryUrl(envPath, cloudinaryUrl, { force: options.force });
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
  } catch (err) {
    if (err instanceof ProvisionError) {
      // --json callers parse stdout; give them the API's error envelope shape.
      if (options.json) {
        console.log(JSON.stringify({
          error: {
            category: err.category ?? 'error',
            ...(err.code ? { code: err.code } : {}),
            message: err.message,
          },
        }, null, 2));
        process.exit(1);
      }
      const detail = err.code ? ` [${err.code}]` : '';
      console.error(pc.red(`Error: ${err.message}${detail}`));
      if (err.code === 'ip_rate_limit_exceeded' || err.code === 'global_rate_limit_exceeded') {
        console.error(pc.dim('A rate limit was hit. Wait a while before provisioning another sandbox.'));
      } else if (err.code === 'agent_registration_disabled') {
        console.error(pc.dim('Sandbox provisioning is currently disabled by Cloudinary.'));
      }
      process.exit(1);
    }
    console.error(pc.red(`Error: ${(err as Error).message}`));
    process.exit(1);
  }
}
