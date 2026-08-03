/**
 * Best-effort check that this machine's public IP is actually in the cloud's
 * delivery allow-list. The two can differ when the API request and media
 * delivery take different network paths (corporate VPN split tunneling, warp,
 * proxies) or when an intermediary obscures the caller's IP — in either case
 * media delivery will be silently blocked, so a heads-up here saves a
 * confusing 401 later.
 */

const IP_ECHO_URL = 'https://checkip.amazonaws.com';
const CHECK_TIMEOUT_MS = 3_000;

/**
 * True for globally routable addresses only. Corporate proxies and split-DNS
 * setups can make the echo service return a private address; sending one as a
 * delivery IP is a guaranteed 400, so those count as "couldn't determine".
 */
export function isPublicIp(ip: string): boolean {
  if (/^(10\.|127\.|0\.|192\.168\.|169\.254\.)/.test(ip)) return false;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return false;
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip)) return false; // CGNAT
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower.startsWith('fe80:') || lower.startsWith('fc') || lower.startsWith('fd')) return false;
  return true;
}

/** This machine's public IP, or null if it can't be determined quickly. Never throws. */
export async function getObservedPublicIp(fetchImpl: typeof fetch = fetch): Promise<string | null> {
  try {
    const res = await fetchImpl(IP_ECHO_URL, { signal: AbortSignal.timeout(CHECK_TIMEOUT_MS) });
    if (!res.ok) return null;
    const ip = (await res.text()).trim();
    if (!/^[0-9a-fA-F.:]+$/.test(ip)) return null;
    return isPublicIp(ip) ? ip : null;
  } catch {
    return null;
  }
}

/** Warning text when the observed IP is missing from the allow-list, else null. */
export function deliveryIpMismatchWarning(deliveryIps: string[], observedIp: string | null): string | null {
  if (!observedIp || deliveryIps.length === 0 || deliveryIps.includes(observedIp)) return null;
  return (
    `This machine's public IP (${observedIp}) is not in the cloud's delivery allow-list ` +
    `(${deliveryIps.join(', ')}), so media delivery may be blocked from here — common behind ` +
    `VPNs and proxies. To lock delivery to this machine, re-run with: --force --ip ${observedIp}`
  );
}
