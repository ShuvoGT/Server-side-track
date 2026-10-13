import { isIPv4, isIPv6 } from 'node:net';

/** Expands an IPv6 address to eight 16-bit groups. Handles :: and an embedded IPv4 tail. */
function expandIPv6(ip: string): number[] {
  let address = ip.split('%')[0]!;
  const tail = address.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (tail) {
    const octets = tail[1]!.split('.').map(Number);
    address =
      address.slice(0, -tail[1]!.length) +
      ((octets[0]! << 8) | octets[1]!).toString(16) +
      ':' +
      ((octets[2]! << 8) | octets[3]!).toString(16);
  }
  const [head, rest] = address.split('::') as [string, string | undefined];
  const left = head ? head.split(':') : [];
  const right = rest ? rest.split(':') : [];
  const fill = rest === undefined ? [] : new Array<string>(8 - left.length - right.length).fill('0');
  return [...left, ...fill, ...right].map((group) => parseInt(group, 16));
}

/**
 * Removes the part of an IP address that identifies a single device: the last octet of IPv4 and the last
 * 80 bits of IPv6. Returns null for values that are not IP addresses.
 */
export function anonymizeIp(ip: string): string | null {
  if (isIPv4(ip)) {
    return ip.split('.').slice(0, 3).concat('0').join('.');
  }
  if (isIPv6(ip)) {
    const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
    if (mapped) return anonymizeIp(mapped[1]!);
    const groups = expandIPv6(ip).slice(0, 3);
    return `${groups.map((g) => g.toString(16)).join(':')}::`;
  }
  return null;
}
