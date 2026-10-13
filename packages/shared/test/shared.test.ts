import { describe, expect, it } from 'vitest';
import {
  anonymizeGa4Body,
  anonymizeIp,
  BACKUP_COOKIE,
  buildBlockList,
  consentFromGcs,
  containerRouteSchema,
  cookieDomainFor,
  detectBot,
  hourBucket,
  InvalidContainerConfigError,
  normalizeHost,
  parseContainerConfig,
  parseCookieHeader,
  parseDevice,
  planCookieKeeper,
  powerUpsSchema,
  redactUrl,
  rewriteLoaderRequest,
  signWebhook,
  verifyWebhook,
  type ContainerRoute,
} from '../src/index.js';

const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

function route(overrides: Partial<ContainerRoute> = {}): ContainerRoute {
  return containerRouteSchema.parse({
    hostname: 'sst.shop.com',
    containerId: 'ctr_1',
    gtmContainerId: 'GTM-SERVER1',
    upstreamUrl: 'http://tagging:8080',
    loader: { webContainerId: 'GTM-WEB1234', gtmPath: '/abc123def4.js', gtagPath: '/xyz789uvw0.js' },
    webhook: null,
    powerUps: {},
    ...overrides,
  });
}

describe('powerUpsSchema', () => {
  it('fills defaults for an empty object', () => {
    const p = powerUpsSchema.parse({});
    expect(p.customLoader.enabled).toBe(true);
    expect(p.geoHeaders).toBe(true);
    expect(p.botDetection.mode).toBe('flag');
    expect(p.cookieKeeper.enabled).toBe(false);
    expect(p.cookieKeeper.cookies).toContain('_fbp');
    expect(p.anonymizer.enabled).toBe(false);
  });
});

describe('normalizeHost / cookieDomainFor', () => {
  it('normalizes host headers', () => {
    expect(normalizeHost('SST.Shop.com:443')).toBe('sst.shop.com');
    expect(normalizeHost('sst.shop.com.')).toBe('sst.shop.com');
    expect(normalizeHost('[::1]:8080')).toBeNull();
    expect(normalizeHost('bad_host')).toBeNull();
    expect(normalizeHost(undefined)).toBeNull();
  });

  it('scopes cookies to the registrable domain, including .com.bd', () => {
    expect(cookieDomainFor('sst.shop.com')).toBe('shop.com');
    expect(cookieDomainFor('sst.shop.com.bd')).toBe('shop.com.bd');
  });
});

describe('parseContainerConfig', () => {
  it('decodes a valid config', () => {
    const value = Buffer.from('id=GTM-ABC1234&env=1&auth=secret').toString('base64');
    expect(parseContainerConfig(value)).toEqual({ id: 'GTM-ABC1234', env: '1', auth: 'secret' });
  });

  it('rejects incomplete or malformed configs', () => {
    expect(() => parseContainerConfig(Buffer.from('id=GTM-ABC1234').toString('base64'))).toThrow(
      InvalidContainerConfigError,
    );
    expect(() => parseContainerConfig('not base64!')).toThrow(InvalidContainerConfigError);
    expect(() => parseContainerConfig(Buffer.from('id=UA-1&env=1&auth=x').toString('base64'))).toThrow(
      /invalid container id/,
    );
  });
});

describe('rewriteLoaderRequest', () => {
  it('maps the gtm path to the web container', () => {
    const r = rewriteLoaderRequest(route(), '/abc123def4.js', new URLSearchParams('l=dl2&id=GTM-EVIL'));
    expect(r).toEqual({ kind: 'gtm', upstreamPath: '/gtm.js?l=dl2&id=GTM-WEB1234', cacheable: true });
  });

  it('passes the measurement id through for gtag and refuses bad ids', () => {
    expect(
      rewriteLoaderRequest(route(), '/xyz789uvw0.js', new URLSearchParams('id=G-ABCD1234'))?.upstreamPath,
    ).toBe('/gtag/js?id=G-ABCD1234');
    expect(rewriteLoaderRequest(route(), '/xyz789uvw0.js', new URLSearchParams('id=<script>'))).toBeNull();
  });

  it('marks preview requests as uncacheable', () => {
    const r = rewriteLoaderRequest(
      route(),
      '/abc123def4.js',
      new URLSearchParams('gtm_auth=a&gtm_preview=env-3'),
    );
    expect(r?.cacheable).toBe(false);
  });

  it('serves nothing when the custom loader is switched off', () => {
    const off = route({ powerUps: { ...route().powerUps, customLoader: { enabled: false } } });
    expect(rewriteLoaderRequest(off, '/abc123def4.js', new URLSearchParams())).toBeNull();
    expect(rewriteLoaderRequest(off, '/xyz789uvw0.js', new URLSearchParams('id=G-ABCD1234'))).toBeNull();
  });

  it('ignores other paths and a missing web container', () => {
    expect(rewriteLoaderRequest(route(), '/g/collect', new URLSearchParams())).toBeNull();
    const noWeb = route({
      loader: { webContainerId: null, gtmPath: '/abc123def4.js', gtagPath: '/xyz789uvw0.js' },
    });
    expect(rewriteLoaderRequest(noWeb, '/abc123def4.js', new URLSearchParams())).toBeNull();
  });
});

describe('anonymizeIp', () => {
  it('masks IPv4 and IPv6', () => {
    expect(anonymizeIp('103.0.0.10')).toBe('103.0.0.0');
    expect(anonymizeIp('2001:db8:85a3:8d3:1319:8a2e:370:7348')).toBe('2001:db8:85a3::');
    expect(anonymizeIp('2001:db8::1')).toBe('2001:db8:0::');
    expect(anonymizeIp('::ffff:192.168.1.20')).toBe('192.168.1.0');
    expect(anonymizeIp('nope')).toBeNull();
  });
});

describe('detectBot', () => {
  const list = buildBlockList(['203.0.113.0/24', '2001:db8::/32', 'garbage', '# comment']);

  it('flags crawlers, empty user agents and listed IPs', () => {
    expect(detectBot('1.1.1.1', 'Googlebot/2.1 (+http://www.google.com/bot.html)', [])).toEqual({
      isBot: true,
      reason: 'user-agent',
    });
    expect(detectBot('1.1.1.1', '', []).reason).toBe('empty-user-agent');
    expect(detectBot('203.0.113.9', CHROME_UA, [list]).reason).toBe('ip-list');
    expect(detectBot('2001:db8::5', CHROME_UA, [list]).reason).toBe('ip-list');
    expect(detectBot('198.51.100.1', CHROME_UA, [list])).toEqual({ isBot: false, reason: null });
  });

  it('reports invalid list entries', () => {
    const invalid: string[] = [];
    buildBlockList(['10.0.0.0/33', '1.2.3.4'], (e) => invalid.push(e));
    expect(invalid).toEqual(['10.0.0.0/33']);
  });
});

describe('parseDevice', () => {
  it('parses desktop and mobile agents', () => {
    expect(parseDevice(CHROME_UA)).toMatchObject({ browser: 'Chrome', os: 'Windows', type: 'desktop' });
    expect(parseDevice(IPHONE_UA)).toMatchObject({ browser: 'Safari', os: 'iOS', type: 'mobile' });
  });
});

describe('consentFromGcs', () => {
  it('reads ad and analytics storage', () => {
    expect(consentFromGcs('G110')).toEqual({ adStorage: true, analyticsStorage: false });
    expect(consentFromGcs('G101')).toEqual({ adStorage: false, analyticsStorage: true });
    expect(consentFromGcs(null)).toEqual({ adStorage: null, analyticsStorage: null });
  });
});

describe('planCookieKeeper', () => {
  const config = powerUpsSchema.parse({ cookieKeeper: { enabled: true, maxAgeDays: 10 } }).cookieKeeper;
  const granted = { adStorage: true, analyticsStorage: true };
  const unknown = { adStorage: null, analyticsStorage: null };
  const denied = { adStorage: false, analyticsStorage: false };
  const backupOf = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');

  it('does nothing when disabled', () => {
    const plan = planCookieKeeper({ ...config, enabled: false }, '_fbp=a', granted, 'shop.com');
    expect(plan.forwardCookieHeader).toBe('_fbp=a');
    expect(plan.finalize([])).toEqual([]);
  });

  it('extends present marketing cookies and writes a backup', () => {
    const plan = planCookieKeeper(config, '_fbp=fb.1.1; session=x; _ga_ABC=GS1', unknown, 'shop.com');
    const out = plan.finalize([]);
    expect(out).toContain('_fbp=fb.1.1; Path=/; Max-Age=864000; Secure; SameSite=Lax; Domain=shop.com');
    expect(out.some((c) => c.startsWith('_ga_ABC=GS1'))).toBe(true);
    expect(out.some((c) => c.startsWith('session='))).toBe(false);
    const backup = out.find((c) => c.startsWith(`${BACKUP_COOKIE}=`))!;
    expect(backup).toContain('HttpOnly');
    const value = backup.split(';')[0]!.slice(BACKUP_COOKIE.length + 1);
    expect(JSON.parse(Buffer.from(value, 'base64url').toString())).toEqual({
      _fbp: 'fb.1.1',
      _ga_ABC: 'GS1',
    });
  });

  it('restores missing cookies only with ad_storage granted', () => {
    const header = `${BACKUP_COOKIE}=${backupOf({ _fbp: 'fb.1.old', _fbc: 'fb.1.click' })}; _fbp=fb.1.new`;
    const plan = planCookieKeeper(config, header, granted, 'shop.com');
    expect(plan.restored).toEqual(['_fbc']);
    expect(parseCookieHeader(plan.forwardCookieHeader)).toEqual(
      new Map([
        ['_fbp', 'fb.1.new'],
        ['_fbc', 'fb.1.click'],
      ]),
    );

    const noConsent = planCookieKeeper(config, header, unknown, 'shop.com');
    expect(noConsent.restored).toEqual([]);
    expect(noConsent.forwardCookieHeader).toBe('_fbp=fb.1.new');
  });

  it('does not override cookies the tagging server sets, and drops deleted ones from the backup', () => {
    const plan = planCookieKeeper(config, '_fbp=a; _fbc=b', unknown, 'shop.com');
    const out = plan.finalize(['_fbp=new; Path=/; Max-Age=100', '_fbc=; Max-Age=0']);
    expect(out.filter((c) => c.startsWith('_fbp=') || c.startsWith('_fbc='))).toEqual([]);
    const backup = out
      .find((c) => c.startsWith(`${BACKUP_COOKIE}=`))!
      .split(';')[0]!
      .split('=')[1]!;
    expect(JSON.parse(Buffer.from(backup, 'base64url').toString())).toEqual({ _fbp: 'new' });
  });

  it('removes the backup and extends nothing when ad_storage is denied', () => {
    const header = `${BACKUP_COOKIE}=${backupOf({ _fbp: 'x' })}; _fbp=x`;
    const plan = planCookieKeeper(config, header, denied, 'shop.com');
    expect(plan.forwardCookieHeader).toBe('_fbp=x');
    expect(plan.finalize([])).toEqual([
      `${BACKUP_COOKIE}=; Path=/; Max-Age=0; Secure; SameSite=Lax; Domain=shop.com; HttpOnly`,
    ]);
  });
});

describe('anonymizer', () => {
  const config = powerUpsSchema.parse({ anonymizer: { enabled: true } }).anonymizer;

  it('redacts personal URL parameters and emails', () => {
    expect(redactUrl('https://shop.com/thanks?email=a%40b.com&utm_source=x')).toBe(
      'https://shop.com/thanks?email=%5Bredacted%5D&utm_source=x',
    );
    expect(redactUrl('https://shop.com/u/jane.doe@example.com')).toBe('https://shop.com/u/[redacted]');
  });

  it('removes uid and _uip and masks event parameters in each body line', () => {
    const body =
      'en=page_view&uid=42&dl=https%3A%2F%2Fshop.com%2F%3Fphone%3D017\nen=sign_up&ep.note=me%40x.com&_uip=1.2.3.4';
    const out = anonymizeGa4Body(body, config).split('\n');
    expect(new URLSearchParams(out[0]).get('uid')).toBeNull();
    expect(new URLSearchParams(out[0]).get('dl')).toBe('https://shop.com/?phone=%5Bredacted%5D');
    expect(new URLSearchParams(out[1]).get('ep.note')).toBe('[redacted]');
    expect(new URLSearchParams(out[1]).get('_uip')).toBeNull();
  });
});

describe('webhook signatures', () => {
  const secret = 'x'.repeat(32);
  const body = Buffer.from('{"order_id":1052}');

  it('accepts a valid signature and rejects tampering or stale timestamps', () => {
    const ts = 1_760_000_000;
    const sig = signWebhook(secret, ts, body);
    expect(verifyWebhook(secret, String(ts), sig, body, ts + 10)).toEqual({ ok: true });
    expect(verifyWebhook(secret, String(ts), sig, Buffer.from('{}'), ts)).toEqual({
      ok: false,
      reason: 'mismatch',
    });
    expect(verifyWebhook(secret, String(ts), sig, body, ts + 301)).toEqual({ ok: false, reason: 'stale' });
    expect(verifyWebhook(secret, undefined, sig, body, ts)).toEqual({ ok: false, reason: 'missing' });
    expect(verifyWebhook(secret, String(ts), 'zz', body, ts)).toEqual({ ok: false, reason: 'mismatch' });
  });
});

describe('hourBucket', () => {
  it('formats UTC hours', () => {
    expect(hourBucket(new Date('2026-10-13T09:45:00Z'))).toBe('2026101309');
  });
});
