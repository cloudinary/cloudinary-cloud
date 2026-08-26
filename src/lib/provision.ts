/**
 * Client for the Cloudinary cloud provisioning endpoint.
 *
 * Contract: POST /v1_1/provisioning/clouds (public, unauthenticated,
 * rate limited per IP).
 */

import { userAgent } from './version.js';

export const DEFAULT_API_HOST = 'https://api.cloudinary.com';
export const CLOUDS_PATH = '/v1_1/provisioning/clouds';

/** Array item the server resolves to the request's own source IP. */
export const REQUESTER_IP_SENTINEL = 'requester_ip';

export const MAX_DELIVERY_IPS = 3;

export interface ProvisionRequest {
  /**
   * 1-3 entries: public IPs and/or the "requester_ip" sentinel. Omit to let
   * the server derive the allow-list (it always appends the requester's
   * resolved address).
   */
  deliveryIps?: string[];
  /** Optional pre-fill hint for the claim page; never verified at creation. */
  email?: string;
  /**
   * Optional attribution fields (agent_framework/agent_llm_model/agent_goal),
   * spread into the request body as-is. Experimental — see lib/agent-metadata.ts.
   */
  agentMetadata?: Record<string, string | undefined>;
}

export interface ApiAccessKey {
  key: string;
  secret: string;
  enabled: boolean;
}

/**
 * Credentials have been observed in two shapes — flat api_key/api_secret/
 * api_environment_variable and nested api_access_keys[] — so every credential
 * field is optional and extraction tolerates all known variants.
 */
export interface ProductEnvironment {
  id?: string;
  external_id?: string;
  cloud_name: string;
  name?: string;
  enabled?: boolean;
  api_access_keys?: ApiAccessKey[];
  api_key?: string;
  api_secret?: string;
  api_environment_variable?: string;
  created_at?: string;
  updated_at?: string;
}

export interface CloudAccount {
  id?: string;
  external_id?: string;
  email: string;
  expires_at: string;
  delivery_ips: string[];
  claim_url: string;
  product_environments: ProductEnvironment[];
  guidance?: string;
}

export type ProvisionErrorCode =
  | 'delivery_ips_required'
  | 'delivery_ips_too_many'
  | 'delivery_ips_invalid'
  | 'delivery_ips_not_public'
  | 'agent_registration_disabled'
  | 'geo_location_not_permitted'
  | 'ip_rate_limit_exceeded'
  | 'global_rate_limit_exceeded';

export class ProvisionError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: ProvisionErrorCode,
    public readonly category?: string,
  ) {
    super(message);
    this.name = 'ProvisionError';
  }
}

export const DEFAULT_TIMEOUT_MS = 30_000;

export interface ProvisionOptions {
  /** Override the API host (e.g. a local stub). Falls back to CLOUDINARY_API_HOST, then production. */
  apiHost?: string;
  /** Request timeout in milliseconds. Default 30s. */
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export function resolveApiHost(explicit?: string): string {
  return (explicit ?? process.env.CLOUDINARY_API_HOST ?? DEFAULT_API_HOST).replace(/\/+$/, '');
}

/**
 * Validate delivery IPs client-side so agents get instant feedback instead of a
 * network round-trip. Mirrors the server rules: 1-3 entries, each a single IP
 * (no CIDR) or the "requester_ip" sentinel.
 */
export function validateDeliveryIps(ips: string[]): string | null {
  if (ips.length === 0) return `At least one delivery IP is required (or use "${REQUESTER_IP_SENTINEL}").`;
  if (ips.length > MAX_DELIVERY_IPS) return `At most ${MAX_DELIVERY_IPS} delivery IPs are allowed.`;
  for (const ip of ips) {
    if (ip === REQUESTER_IP_SENTINEL) continue;
    if (ip.includes('/')) return `CIDR ranges are not accepted: ${ip}`;
    if (!isIpLike(ip)) return `Not a valid IP address: ${ip}`;
  }
  return null;
}

function isIpLike(value: string): boolean {
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  const m = value.match(v4);
  if (m) return m.slice(1).every(o => Number(o) <= 255);
  // IPv6: at least two groups separated by colons, hex digits only
  return /^[0-9a-fA-F:]+$/.test(value) && value.includes(':');
}

export async function provisionCloud(
  request: ProvisionRequest,
  options: ProvisionOptions = {},
): Promise<CloudAccount> {
  if (request.deliveryIps !== undefined) {
    const invalid = validateDeliveryIps(request.deliveryIps);
    if (invalid) throw new ProvisionError(invalid, 400, 'delivery_ips_invalid', 'user_error');
  }

  const host = resolveApiHost(options.apiHost);
  const doFetch = options.fetchImpl ?? fetch;

  const body: Record<string, unknown> = {};
  if (request.deliveryIps !== undefined) body.delivery_ips = request.deliveryIps;
  if (request.email !== undefined) body.email = request.email;
  for (const [key, value] of Object.entries(request.agentMetadata ?? {})) {
    if (value) body[key] = value;
  }

  let res: Response;
  try {
    res = await doFetch(`${host}${CLOUDS_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': userAgent() },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (err) {
    const e = err as Error;
    if (e.name === 'TimeoutError' || e.name === 'AbortError') {
      throw new ProvisionError(
        `Request to ${host} timed out after ${(options.timeoutMs ?? DEFAULT_TIMEOUT_MS) / 1000}s.`,
        0,
      );
    }
    throw new ProvisionError(`Could not reach ${host}: ${e.message}`, 0);
  }

  if (!res.ok) {
    let code: ProvisionErrorCode | undefined;
    let category: string | undefined;
    let message = `Provisioning failed with HTTP ${res.status}`;
    try {
      const payload = (await res.json()) as {
        error?: { category?: string; code?: ProvisionErrorCode; message?: string };
      };
      code = payload.error?.code;
      category = payload.error?.category;
      if (payload.error?.message) message = payload.error.message;
    } catch {
      // non-JSON error body; keep the generic message
    }
    throw new ProvisionError(message, res.status, code, category);
  }

  return normalizeAccount(await res.json());
}

/**
 * The API has served the cloud's environment both nested (product_environments[])
 * and flattened onto the account object itself. Normalize to the nested shape so
 * every consumer reads one contract. Throwing here must include the raw response:
 * the cloud already exists, so an unrecognized shape must never cost the caller
 * their only copy of its credentials.
 */
function normalizeAccount(raw: unknown): CloudAccount {
  const account = raw as CloudAccount & ProductEnvironment;
  if (Array.isArray(account.product_environments) && account.product_environments.length > 0) {
    return account;
  }
  if (typeof account.cloud_name === 'string' && account.cloud_name !== '') {
    // Copy, not a self-reference: the account must stay JSON-serializable
    // (--json output stringifies it).
    const { product_environments: _omit, ...env } = account;
    account.product_environments = [env];
    return account;
  }
  throw new ProvisionError(
    `Provisioning succeeded but the response shape was not recognized. Raw response (keep it — it may contain your credentials): ${JSON.stringify(raw)}`,
    0,
  );
}

/** The credentials the CLI surfaces, tolerant of every response shape seen so far. */
export function getActiveAccessKey(env: ProductEnvironment): ApiAccessKey {
  if (env.api_access_keys && env.api_access_keys.length > 0) {
    return env.api_access_keys.find(k => k.enabled !== false) ?? env.api_access_keys[0];
  }
  if (env.api_key && env.api_secret) {
    return { key: env.api_key, secret: env.api_secret, enabled: true };
  }
  const fromUrl = env.api_environment_variable?.match(/^CLOUDINARY_URL=cloudinary:\/\/([^:]+):([^@]+)@/);
  if (fromUrl) {
    return { key: fromUrl[1], secret: fromUrl[2], enabled: true };
  }
  throw new ProvisionError('Response contained no API credentials in any known shape.', 0);
}

export function getCloudinaryUrl(env: ProductEnvironment): string {
  const fromServer = env.api_environment_variable?.replace(/^CLOUDINARY_URL=/, '');
  if (fromServer) return fromServer;
  const { key, secret } = getActiveAccessKey(env);
  return `cloudinary://${key}:${secret}@${env.cloud_name}`;
}
