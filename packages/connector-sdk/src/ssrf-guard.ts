import dns from 'node:dns/promises';
import net from 'node:net';

/**
 * SSRF & DNS Rebinding Guard
 * Strictly blocks private, loopback, link-local, and cloud metadata IP ranges.
 */

export class SsrfGuard {
  private static readonly BLOCKED_IPV4_RANGES = [
    { start: '0.0.0.0', end: '0.255.255.255' },
    { start: '10.0.0.0', end: '10.255.255.255' }, // RFC 1918
    { start: '100.64.0.0', end: '100.127.255.255' }, // RFC 6598 CGNAT
    { start: '127.0.0.0', end: '127.255.255.255' }, // Loopback
    { start: '169.254.0.0', end: '169.254.255.255' }, // Link-local & Cloud Metadata (169.254.169.254)
    { start: '172.16.0.0', end: '172.31.255.255' }, // RFC 1918
    { start: '192.0.0.0', end: '192.0.0.255' },
    { start: '192.168.0.0', end: '192.168.255.255' }, // RFC 1918
    { start: '198.18.0.0', end: '198.19.255.255' },
  ];

  public static isIpBlocked(ip: string): boolean {
    if (ip === '::1' || ip.startsWith('fe80:') || ip.startsWith('fc00:') || ip.startsWith('fd00:')) {
      return true; // IPv6 loopback, link-local, ULA
    }

    if (!net.isIPv4(ip)) {
      return false;
    }

    const ipNum = SsrfGuard.ipv4ToNumber(ip);
    for (const range of SsrfGuard.BLOCKED_IPV4_RANGES) {
      const startNum = SsrfGuard.ipv4ToNumber(range.start);
      const endNum = SsrfGuard.ipv4ToNumber(range.end);
      if (ipNum >= startNum && ipNum <= endNum) {
        return true;
      }
    }
    return false;
  }

  public static async validateAndResolveUrl(
    urlString: string,
    allowLocalhostForTesting = false,
  ): Promise<{ resolvedIp: string; parsedUrl: URL }> {
    let parsed: URL;
    try {
      parsed = new URL(urlString);
    } catch {
      throw new Error(`Invalid URL: ${urlString}`);
    }

    if (parsed.protocol !== 'https:' && (!allowLocalhostForTesting || parsed.protocol !== 'http:')) {
      throw new Error(`Insecure protocol '${parsed.protocol}'. HTTPS is strictly required for connector endpoints.`);
    }

    const hostname = parsed.hostname;

    // Check if hostname is already a raw IP
    if (net.isIP(hostname)) {
      if (!allowLocalhostForTesting && SsrfGuard.isIpBlocked(hostname)) {
        throw new Error(`Connector URL host resolves to blocked IP address: ${hostname}`);
      }
      return { resolvedIp: hostname, parsedUrl: parsed };
    }

    // Resolve DNS
    const addresses = await dns.resolve4(hostname).catch(async () => {
      return await dns.resolve6(hostname);
    });

    if (!addresses || addresses.length === 0) {
      throw new Error(`DNS resolution failed for connector host '${hostname}'`);
    }

    const resolvedIp = addresses[0]!;
    if (!allowLocalhostForTesting && SsrfGuard.isIpBlocked(resolvedIp)) {
      throw new Error(
        `SSRF Guard: Host '${hostname}' resolved to blocked private/link-local address: ${resolvedIp}`,
      );
    }

    return { resolvedIp, parsedUrl: parsed };
  }

  private static ipv4ToNumber(ip: string): number {
    return ip
      .split('.')
      .reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
  }
}
