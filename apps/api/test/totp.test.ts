import { describe, expect, it } from 'vitest';
import { SecretBox } from '../src/secretBox.js';
import { base32Decode, base32Encode, hotp, verifyTotp } from '../src/totp.js';

// RFC 6238 appendix B: SHA-1 key "12345678901234567890", 8-digit codes.
const RFC_KEY = Buffer.from('12345678901234567890');

describe('TOTP', () => {
  it('matches the RFC 6238 test vectors', () => {
    expect(hotp(RFC_KEY, Math.floor(59 / 30), 8)).toBe('94287082');
    expect(hotp(RFC_KEY, Math.floor(1111111109 / 30), 8)).toBe('07081804');
    expect(hotp(RFC_KEY, Math.floor(2000000000 / 30), 8)).toBe('69279037');
  });

  it('round-trips base32', () => {
    expect(base32Decode(base32Encode(RFC_KEY)).equals(RFC_KEY)).toBe(true);
    expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
  });

  it('accepts one step of drift, refuses reuse and other codes', () => {
    const secret = base32Encode(RFC_KEY);
    const now = 1_111_111_109_000;
    const step = Math.floor(now / 30_000);
    const code = hotp(RFC_KEY, step);
    expect(verifyTotp(secret, code, null, now)).toBe(step);
    expect(verifyTotp(secret, code, null, now + 30_000)).toBe(step);
    expect(verifyTotp(secret, code, null, now + 90_000)).toBeNull();
    expect(verifyTotp(secret, code, step, now)).toBeNull();
    expect(verifyTotp(secret, '000000', null, now)).toBeNull();
    expect(verifyTotp(secret, 'abc', null, now)).toBeNull();
  });
});

describe('SecretBox', () => {
  it('encrypts and authenticates', () => {
    const box = new SecretBox('key material');
    const sealed = box.seal('JBSWY3DPEHPK3PXP');
    expect(sealed).not.toContain('JBSWY3DPEHPK3PXP');
    expect(box.open(sealed)).toBe('JBSWY3DPEHPK3PXP');
    expect(() => new SecretBox('other key').open(sealed)).toThrow();
  });
});
