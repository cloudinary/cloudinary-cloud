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

/** This machine's public IP, or null if it can't be determined quickly. Never throws. */
export async function getObservedPublicIp(fetchImpl: typeof fetch = fetch): Promise<string | null> {
  try {
    const res = await fetchImpl(IP_ECHO_URL, { signal: AbortSignal.timeout(CHECK_TIMEOUT_MS) });
    if (!res.ok) return null;
    const ip = (await res.text()).trim();
    return /^[0-9a-fA-F.:]+$/.test(ip) ? ip : null;
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
