import { randomBytes, scrypt as scryptCallback, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import { newId, type User } from './model.js';
import { DuplicateEmailError, type Store } from './store.js';

const scrypt = (password: string, salt: Buffer, keylen: number, options: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) =>
    scryptCallback(password, salt, keylen, options, (err, key) => (err ? reject(err) : resolve(key))),
  );

const SCRYPT = { N: 16_384, r: 8, p: 1 } as const;
const KEY_LENGTH = 64;
export const MIN_PASSWORD_LENGTH = 8;

/** "scrypt$N$r$p$salt$hash", base64url; the parameters are stored so they can be raised later. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEY_LENGTH, SCRYPT);
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64url'), key.toString('base64url')].join(
    '$',
  );
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64url');
  const key = await scrypt(password, Buffer.from(salt, 'base64url'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  return timingSafeEqual(key, expected);
}

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

// A hash to check against when the address is unknown, so a failed login takes as long either way.
const dummyHash = hashPassword(randomBytes(16).toString('hex'));

export interface GoogleProfile {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string;
}

/**
 * Sign-up and sign-in. An address counts as proven only when Google says so: invites and super-admin rights
 * apply to verified addresses alone, otherwise anyone could sign up with a password as someone else.
 */
export class Accounts {
  private readonly superAdmins: Set<string>;

  constructor(
    private readonly store: Store,
    superAdminEmails: string[],
  ) {
    this.superAdmins = new Set(superAdminEmails.map(normalizeEmail));
  }

  isSuperAdmin(user: User): boolean {
    return user.emailVerified && this.superAdmins.has(user.email);
  }

  async signUp(input: { email: string; password: string; name: string }): Promise<User | 'email_taken'> {
    const email = normalizeEmail(input.email);
    if (await this.store.getUserByEmail(email)) return 'email_taken';
    try {
      const user = await this.store.createUser({
        id: newId('usr'),
        email,
        name: input.name.trim() || email.split('@')[0]!,
        passwordHash: await hashPassword(input.password),
        googleSub: null,
        emailVerified: false,
        createdAt: new Date(),
        lastLoginAt: null,
      });
      return await this.afterSignIn(user);
    } catch (error) {
      if (error instanceof DuplicateEmailError) return 'email_taken';
      throw error;
    }
  }

  async signIn(emailInput: string, password: string): Promise<User | null> {
    const user = await this.store.getUserByEmail(normalizeEmail(emailInput));
    if (!user?.passwordHash) {
      await verifyPassword(password, await dummyHash);
      return null;
    }
    if (!(await verifyPassword(password, user.passwordHash))) return null;
    return this.afterSignIn(user);
  }

  async signInWithGoogle(profile: GoogleProfile): Promise<User | 'email_not_verified'> {
    if (!profile.emailVerified) return 'email_not_verified';
    const email = normalizeEmail(profile.email);
    let user = await this.store.getUserByGoogleSub(profile.sub);
    if (!user) {
      const existing = await this.store.getUserByEmail(email);
      if (existing) {
        // Link Google to the account with this address. If nobody had proven the address yet, a password set by
        // whoever signed up with it is dropped: the Google account owner is the real owner of the address.
        user = await this.store.updateUser(existing.id, {
          googleSub: profile.sub,
          emailVerified: true,
          ...(!existing.emailVerified && { passwordHash: null }),
        });
      } else {
        user = await this.store.createUser({
          id: newId('usr'),
          email,
          name: profile.name.trim() || email.split('@')[0]!,
          passwordHash: null,
          googleSub: profile.sub,
          emailVerified: true,
          createdAt: new Date(),
          lastLoginAt: null,
        });
      }
    }
    return this.afterSignIn(user);
  }

  /** Records the sign-in, accepts pending invites, and makes sure the user has a workspace. */
  private async afterSignIn(user: User): Promise<User> {
    const now = new Date();
    const signedIn = await this.store.updateUser(user.id, { lastLoginAt: now });
    if (signedIn.emailVerified) {
      for (const invite of await this.store.listInvitesForEmail(signedIn.email)) {
        await this.store.putMembership({
          userId: signedIn.id,
          tenantId: invite.tenantId,
          role: invite.role,
          createdAt: now,
        });
        await this.store.deleteInvite(invite.id);
      }
    }
    if (this.isSuperAdmin(signedIn)) {
      // Workspaces from before user accounts existed belong to the platform owner.
      for (const tenant of await this.store.listTenantsWithoutMembers()) {
        await this.store.putMembership({
          userId: signedIn.id,
          tenantId: tenant.id,
          role: 'owner',
          createdAt: now,
        });
      }
    }
    if ((await this.store.listUserMemberships(signedIn.id)).length === 0) {
      const tenant = await this.store.createTenant({
        id: newId('tnt'),
        name: `${signedIn.name}'s workspace`,
        createdAt: now,
      });
      await this.store.putMembership({
        userId: signedIn.id,
        tenantId: tenant.id,
        role: 'owner',
        createdAt: now,
      });
    }
    return signedIn;
  }
}

/** Counts failed sign-ins per address and per client in memory, to slow down password guessing. */
export class SignInLimiter {
  private failures = new Map<string, { count: number; until: number }>();

  constructor(
    private readonly maxFailures = 10,
    private readonly windowMs = 15 * 60_000,
  ) {}

  blocked(...keys: string[]): boolean {
    const now = Date.now();
    return keys.some((key) => {
      const entry = this.failures.get(key);
      return entry !== undefined && entry.until > now && entry.count >= this.maxFailures;
    });
  }

  fail(...keys: string[]) {
    const now = Date.now();
    for (const key of keys) {
      const entry = this.failures.get(key);
      this.failures.set(
        key,
        entry && entry.until > now
          ? { ...entry, count: entry.count + 1 }
          : { count: 1, until: now + this.windowMs },
      );
    }
    if (this.failures.size > 10_000) {
      for (const [key, entry] of this.failures) if (entry.until <= now) this.failures.delete(key);
    }
  }

  succeed(...keys: string[]) {
    for (const key of keys) this.failures.delete(key);
  }
}
