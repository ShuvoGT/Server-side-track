import { BlockList, isIPv4, isIPv6 } from 'node:net';
import { isbot } from 'isbot';

export type BotReason = 'empty-user-agent' | 'user-agent' | 'ip-list';

export interface BotVerdict {
  isBot: boolean;
  reason: BotReason | null;
}

/** Adds addresses and CIDR ranges to a BlockList. Invalid entries are reported, not thrown. */
export function buildBlockList(entries: Iterable<string>, onInvalid?: (entry: string) => void): BlockList {
  const list = new BlockList();
  for (const raw of entries) {
    const entry = raw.trim();
    if (!entry || entry.startsWith('#')) continue;
    const [address, prefix] = entry.split('/') as [string, string | undefined];
    const type = isIPv4(address) ? 'ipv4' : isIPv6(address) ? 'ipv6' : null;
    const bits = prefix === undefined ? null : Number(prefix);
    if (
      !type ||
      (bits !== null && (!Number.isInteger(bits) || bits < 0 || bits > (type === 'ipv4' ? 32 : 128)))
    ) {
      onInvalid?.(entry);
      continue;
    }
    if (bits === null) list.addAddress(address, type);
    else list.addSubnet(address, bits, type);
  }
  return list;
}

/** Basic bot check from the guide's MVP scope: the isbot user agent patterns plus IP lists. */
export function detectBot(ip: string | null, userAgent: string | undefined, lists: BlockList[]): BotVerdict {
  if (!userAgent || !userAgent.trim()) return { isBot: true, reason: 'empty-user-agent' };
  if (isbot(userAgent)) return { isBot: true, reason: 'user-agent' };
  if (ip) {
    const type = isIPv4(ip) ? 'ipv4' : isIPv6(ip) ? 'ipv6' : null;
    if (type && lists.some((list) => list.check(ip, type))) return { isBot: true, reason: 'ip-list' };
  }
  return { isBot: false, reason: null };
}
