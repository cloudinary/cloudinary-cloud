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

/**
 * Guidance for delivery_ips_not_public when a rejected private address was
 * derived by the server rather than passed via --ip. The server folds the
 * requester's address into the delivery allow-list, so behind a corporate VPN
 * or secure gateway (e.g. Cloudflare WARP) the API sees a private address and
 * refuses — no flag can avoid that. Worded for AI agents as much as humans:
 * explicitly not a security block, and the remedy is the user's call.
 *
 * Returns null when the hint would be wrong or redundant: every rejected
 * address is public (the "private address" story doesn't apply), the user
 * passed the private address themselves, or the message has no parseable IP
 * while --ip values were given (can't attribute the rejection to the server).
 */
export function privateRequesterHint(message: string, suppliedIps?: string[]): string | null {
  const rejected = extractIps(message);
  const rejectedPrivate = rejected.filter(ip => !isPublicIp(ip));
  if (rejected.length > 0 && rejectedPrivate.length === 0) return null;

  const supplied = new Set((suppliedIps ?? []).map(normalizeIp));
  const derived = rejectedPrivate.find(ip => !supplied.has(normalizeIp(ip)));
  if (rejectedPrivate.length > 0 && derived === undefined) return null;
  if (rejected.length === 0 && supplied.size > 0) return null;

  return [
    `This request reached Cloudinary from a private network address${derived ? ` (${derived})` : ''} —`,
    'usually a corporate VPN or secure gateway (e.g. Cloudflare WARP) routing the connection.',
    'The service derives the media-delivery allow-list from that address and cannot use a',
    'private one, so it refused to provision. This is a network-routing limitation — not a',
    'security block, and not a problem with the request, this tool, or your account.',
    'To proceed, re-run from a connection the gateway does not route: pause the VPN for this',
    'one command, or use another network or host. If you are an AI agent, report this to the',
    'user and let them decide — do not change network or VPN settings yourself.',
  ].join('\n');
}

/** IP-shaped tokens in prose. IPv6 must contain '::' or all 8 groups, so times ("10:30:45") don't match. */
function extractIps(text: string): string[] {
  const candidates = text.match(/(?:\d{1,3}\.){3}\d{1,3}|[0-9a-fA-F:]*::[0-9a-fA-F:.]*|(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}/g) ?? [];
  return candidates.filter(v => {
    const m = v.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (m) return m.slice(1).every(o => Number(o) <= 255);
    return v.includes('::') || v.split(':').length === 8;
  });
}

/**
 * Comparison form only (never displayed): lowercase, '::' expanded, leading
 * zeros stripped — so a user-supplied "2001:db8::1" matches the server's
 * "2001:0DB8:0000:0000:0000:0000:0000:0001". IPv4 passes through unchanged.
 */
function normalizeIp(ip: string): string {
  if (!ip.includes(':')) return ip;
  const lower = ip.toLowerCase();
  const [head = '', tail = ''] = lower.split('::');
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const groups = lower.includes('::')
    ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t]
    : h;
  return groups.map(g => g.replace(/^0+(?=.)/, '')).join(':');
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
