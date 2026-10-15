import {
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  type ScryptOptions,
} from 'node:crypto';
import { newId, newUserSettings, type User } from './model.js';
import type { SecretBox } from './secretBox.js';
import { newRecoveryCodes, newTotpSecret, otpauthUrl, verifyTotp } from './totp.js';
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

const RESET_TTL_MS = 3_600_000;
const RESETS_PER_HOUR = 3;
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

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
    private readonly secrets: SecretBox,
    private readonly options: {
      /** New accounts wait for a super-admin's approval (default). */
      requireApproval?: boolean;
      /** Told about each new account that waits for approval, e.g. to email the super-admins. */
      onAccountRequested?: (user: User) => Promise<void>;
    } = {},
  ) {
    this.superAdmins = new Set(superAdminEmails.map(normalizeEmail));
  }

  private get newStatus() {
    return this.options.requireApproval === false ? ('active' as const) : ('pending' as const);
  }

  isSuperAdmin(user: User): boolean {
    return user.emailVerified && this.superAdmins.has(user.email);
  }

  async signUp(input: {
    email: string;
    password: string;
    name: string;
    phoneCountry?: string;
    phone?: string;
  }): Promise<User | 'email_taken'> {
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
        passwordChangedAt: null,
        status: this.newStatus,
        ...newUserSettings(),
        phoneCountry: input.phone ? (input.phoneCountry ?? null) : null,
        phone: input.phone ? input.phone.replace(/\s+/g, ' ') : null,
      });
      return await this.afterSignIn(user, true);
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
    let created = false;
    if (!user) {
      const existing = await this.store.getUserByEmail(email);
      if (existing) {
        // Link Google to the account with this address. If nobody had proven the address yet, a password set by
        // whoever signed up with it is dropped: the Google account owner is the real owner of the address.
        user = await this.store.updateUser(existing.id, {
          googleSub: profile.sub,
          emailVerified: true,
          // ...and is signed out everywhere.
          ...(!existing.emailVerified && { passwordHash: null, passwordChangedAt: new Date() }),
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
          passwordChangedAt: null,
          status: this.newStatus,
          ...newUserSettings(),
        });
        created = true;
      }
    }
    return this.afterSignIn(user, created);
  }

  /**
   * A one-hour, single-use link to set a new password. Null when there is no such account or too many links
   * were asked for; the caller answers the same either way, so the form does not reveal who has an account.
   */
  async requestPasswordReset(emailInput: string): Promise<{ user: User; token: string } | null> {
    const user = await this.store.getUserByEmail(normalizeEmail(emailInput));
    if (!user) return null;
    const now = Date.now();
    if ((await this.store.countPasswordResetsSince(user.id, new Date(now - 3_600_000))) >= RESETS_PER_HOUR)
      return null;
    const token = randomBytes(32).toString('base64url');
    await this.store.createPasswordReset({
      id: newId('pwr'),
      userId: user.id,
      tokenHash: hashToken(token),
      expiresAt: new Date(now + RESET_TTL_MS),
      usedAt: null,
      createdAt: new Date(now),
    });
    return { user, token };
  }

  /**
   * Sets the new password from a reset link. Receiving the email proves the address, so the account counts as
   * verified from then on; every other session of the account ends.
   */
  async resetPassword(token: string, password: string): Promise<User | 'invalid_token'> {
    const reset = await this.store.getPasswordResetByTokenHash(hashToken(token));
    if (!reset || reset.usedAt || reset.expiresAt.getTime() < Date.now()) return 'invalid_token';
    const now = new Date();
    await this.store.usePasswordResets(reset.userId, now);
    const user = await this.store.updateUser(reset.userId, {
      passwordHash: await hashPassword(password),
      emailVerified: true,
      passwordChangedAt: now,
    });
    return this.afterSignIn(user);
  }

  /**
   * Records the sign-in and accepts pending invites. A pending account is approved at once for super-admins and
   * for people a workspace owner invited (the invite is the approval); anyone else waits. Active accounts always
   * have a workspace.
   */
  private async afterSignIn(user: User, isNew = false): Promise<User> {
    const now = new Date();
    let signedIn = await this.store.updateUser(user.id, { lastLoginAt: now });
    let invited = 0;
    if (signedIn.emailVerified) {
      for (const invite of await this.store.listInvitesForEmail(signedIn.email)) {
        await this.store.putMembership({
          userId: signedIn.id,
          tenantId: invite.tenantId,
          role: invite.role,
          createdAt: now,
        });
        await this.store.deleteInvite(invite.id);
        invited++;
      }
    }
    if (signedIn.status === 'pending' && (this.isSuperAdmin(signedIn) || invited > 0)) {
      signedIn = await this.store.updateUser(signedIn.id, { status: 'active', approvedAt: now });
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
    if (signedIn.status === 'active') await this.ensureWorkspace(signedIn);
    else if (isNew && signedIn.status === 'pending' && this.options.onAccountRequested) {
      await this.options.onAccountRequested(signedIn).catch(() => undefined);
    }
    return signedIn;
  }

  /** Every active account has at least one workspace of its own. */
  private async ensureWorkspace(user: User) {
    if ((await this.store.listUserMemberships(user.id)).length > 0) return;
    const now = new Date();
    const tenant = await this.store.createTenant({
      id: newId('tnt'),
      name: `${user.name}'s workspace`,
      createdAt: now,
    });
    await this.store.putMembership({ userId: user.id, tenantId: tenant.id, role: 'owner', createdAt: now });
  }

  /** A super-admin lets a pending (or earlier rejected) account in. */
  async approve(user: User): Promise<User> {
    const approved =
      user.status === 'active'
        ? user
        : await this.store.updateUser(user.id, { status: 'active', approvedAt: new Date() });
    await this.ensureWorkspace(approved);
    return approved;
  }

  async reject(user: User): Promise<User> {
    return this.store.updateUser(user.id, { status: 'rejected', approvedAt: null });
  }

  /**
   * Changes the password from Settings. Accounts that have one must give it; Google-only accounts set their first
   * password. Every other session of the account ends.
   */
  async changePassword(
    user: User,
    current: string | undefined,
    next: string,
  ): Promise<User | 'wrong_password'> {
    if (user.passwordHash && !(current && (await verifyPassword(current, user.passwordHash))))
      return 'wrong_password';
    return this.store.updateUser(user.id, {
      passwordHash: await hashPassword(next),
      passwordChangedAt: new Date(),
    });
  }

  /** Step 1 of two-step verification: a new key to scan; nothing changes for sign-in until it is confirmed. */
  async setUpTwoFactor(user: User): Promise<{ secret: string; otpauthUrl: string } | 'already_enabled'> {
    if (user.totpEnabledAt) return 'already_enabled';
    const secret = newTotpSecret();
    await this.store.updateUser(user.id, { totpSecret: this.secrets.seal(secret), totpLastStep: null });
    return { secret, otpauthUrl: otpauthUrl(secret, user.email) };
  }

  /** Step 2: a code from the app proves it was scanned; returns the recovery codes, shown once. */
  async enableTwoFactor(user: User, code: string): Promise<string[] | 'not_set_up' | 'invalid_code'> {
    if (user.totpEnabledAt) return 'invalid_code';
    if (!user.totpSecret) return 'not_set_up';
    const step = verifyTotp(this.secrets.open(user.totpSecret), code, null);
    if (step === null) return 'invalid_code';
    const codes = newRecoveryCodes();
    await this.store.updateUser(user.id, {
      totpEnabledAt: new Date(),
      totpLastStep: step,
      recoveryCodeHashes: codes.map(hashRecoveryCode),
    });
    return codes;
  }

  /** Checks a code from the app, or uses up a recovery code. */
  async verifySecondFactor(user: User, code: string): Promise<boolean> {
    if (!user.totpEnabledAt || !user.totpSecret) return false;
    const step = verifyTotp(this.secrets.open(user.totpSecret), code, user.totpLastStep);
    if (step !== null) {
      await this.store.updateUser(user.id, { totpLastStep: step });
      return true;
    }
    const hash = hashRecoveryCode(code);
    if (!user.recoveryCodeHashes.includes(hash)) return false;
    await this.store.updateUser(user.id, {
      recoveryCodeHashes: user.recoveryCodeHashes.filter((h) => h !== hash),
    });
    return true;
  }

  async disableTwoFactor(user: User, code: string): Promise<boolean> {
    if (!(await this.verifySecondFactor(user, code))) return false;
    await this.store.updateUser(user.id, {
      totpSecret: null,
      totpEnabledAt: null,
      totpLastStep: null,
      recoveryCodeHashes: [],
    });
    return true;
  }
}

const hashRecoveryCode = (code: string) =>
  createHash('sha256').update(code.trim().toLowerCase().replace(/\s/g, '')).digest('hex');

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
