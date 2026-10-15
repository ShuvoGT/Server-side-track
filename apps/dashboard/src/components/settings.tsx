'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import {
  changePassword,
  disableTwoFactor,
  enableTwoFactor,
  savePreferences,
  saveProfile,
  startTwoFactorSetup,
  type ActionState,
} from '@/app/actions';
import { CURRENCIES } from '@/lib/choices';
import type { User } from '@/lib/types';
import { CodeBlock, CopyButton, SubmitButton } from './client';
import { Alert } from './ui';

function Feedback({ state }: { state: ActionState }) {
  if (state.error) return <Alert tone="critical">{state.error}</Alert>;
  if (state.message) return <Alert tone="good">{state.message}</Alert>;
  return null;
}

function Section({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <section className="card settings-card">
      <div className="settings-card-head">
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      <div className="settings-card-body">{children}</div>
      {footer && <div className="settings-card-foot">{footer}</div>}
    </section>
  );
}

const Required = () => (
  <span className="required" aria-hidden="true">
    *
  </span>
);

/** Country names come from the server's Intl data, so the browser renders exactly what the server did. */
export function ProfileForm({
  user,
  countries,
}: {
  user: User;
  countries: { code: string; dial: string; name: string }[];
}) {
  const [state, action] = useActionState(saveProfile, {});
  return (
    <form action={action}>
      <Section
        title="Profile information"
        description="Update your account profile information."
        footer={
          <>
            <Feedback state={state} />
            <SubmitButton pending="Saving…">Save profile</SubmitButton>
          </>
        }
      >
        <div className="settings-grid">
          <div className="field">
            <label htmlFor="name">
              Name <Required />
            </label>
            <input id="name" name="name" className="input" defaultValue={user.name} required />
          </div>
          <div className="field">
            <label htmlFor="email">
              Email <Required />
            </label>
            <input id="email" className="input" value={user.email} readOnly aria-describedby="email-hint" />
            <span id="email-hint" className="hint">
              Your sign-in address{user.hasGoogle ? ', linked to your Google account' : ''}.
            </span>
          </div>
          <div className="field">
            <label htmlFor="phoneCountry">Country</label>
            <select
              id="phoneCountry"
              name="phoneCountry"
              className="select"
              defaultValue={user.phoneCountry ?? 'BD'}
            >
              {countries.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} +{c.dial} · {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="phone">Phone number</label>
            <input
              id="phone"
              name="phone"
              className="input"
              inputMode="tel"
              autoComplete="tel-national"
              placeholder="1711421236"
              defaultValue={user.phone ?? ''}
            />
          </div>
        </div>
      </Section>
    </form>
  );
}

export function PreferencesForm({
  user,
  timeZones,
}: {
  user: User;
  timeZones: { id: string; label: string }[];
}) {
  const [state, action] = useActionState(savePreferences, {});
  return (
    <form action={action}>
      <Section
        title="Preferences"
        description="Set your display preferences for currency and time zone."
        footer={
          <>
            <Feedback state={state} />
            <SubmitButton pending="Saving…">Save preferences</SubmitButton>
          </>
        }
      >
        <div className="settings-grid">
          <div className="field">
            <label htmlFor="currency">
              Currency <Required />
            </label>
            <select id="currency" name="currency" className="select" defaultValue={user.currency}>
              {CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} ({c.symbol})
                </option>
              ))}
            </select>
            <span className="hint">Used for showing revenue in the dashboard.</span>
          </div>
          <div className="field">
            <label htmlFor="timezone">
              Time zone <Required />
            </label>
            <select id="timezone" name="timezone" className="select" defaultValue={user.timezone}>
              {timeZones.map((tz) => (
                <option key={tz.id} value={tz.id}>
                  {tz.label}
                </option>
              ))}
            </select>
            <span className="hint">Used for dates and times: logs, usage, members.</span>
          </div>
        </div>
      </Section>
    </form>
  );
}

export function PasswordForm({ hasPassword }: { hasPassword: boolean }) {
  const [state, action] = useActionState(changePassword, {});
  return (
    <form action={action}>
      <Section
        title={hasPassword ? 'Update password' : 'Set a password'}
        description={
          hasPassword
            ? 'Ensure your account is using a secure password.'
            : 'You sign in with Google. A password lets you sign in with your email too.'
        }
        footer={
          <>
            {hasPassword && (
              <Link href="/forgot-password" className="small settings-link">
                Don&apos;t remember your current password? Reset via email
              </Link>
            )}
            <Feedback state={state} />
            <SubmitButton pending="Saving…">{hasPassword ? 'Update password' : 'Set password'}</SubmitButton>
          </>
        }
      >
        <div className="stack" style={{ gap: 14 }}>
          {hasPassword && (
            <div className="field">
              <label htmlFor="currentPassword">
                Current password <Required />
              </label>
              <input
                id="currentPassword"
                name="currentPassword"
                type="password"
                className="input"
                autoComplete="current-password"
                required
              />
            </div>
          )}
          <div className="field">
            <label htmlFor="newPassword">
              New password <Required />
            </label>
            <input
              id="newPassword"
              name="newPassword"
              type="password"
              className="input"
              autoComplete="new-password"
              minLength={8}
              required
            />
            <span className="hint">At least 8 characters. Your other devices are signed out.</span>
          </div>
          <div className="field">
            <label htmlFor="confirm">
              Confirm password <Required />
            </label>
            <input
              id="confirm"
              name="confirm"
              type="password"
              className="input"
              autoComplete="new-password"
              minLength={8}
              required
            />
          </div>
        </div>
      </Section>
    </form>
  );
}

function RecoveryCodes({ codes }: { codes: string[] }) {
  return (
    <div className="stack" style={{ gap: 10 }}>
      <Alert tone="good">
        Two-step verification is on. From now on, signing in asks for a code from your authenticator app.
      </Alert>
      <h3>Save your recovery codes</h3>
      <p className="small text-2">
        If you lose your phone, each of these codes signs you in once. Keep them somewhere safe, such as a
        password manager: they are not shown again.
      </p>
      <ol className="recovery-codes">
        {codes.map((c) => (
          <li key={c} className="mono">
            {c}
          </li>
        ))}
      </ol>
      <div className="row">
        <CopyButton text={codes.join('\n')} label="Copy codes" />
        <a className="btn btn-primary" href="/settings?tab=security">
          I saved them
        </a>
      </div>
    </div>
  );
}

export function TwoFactorCard({ user }: { user: User }) {
  const [setup, startSetup] = useActionState(startTwoFactorSetup, {});
  const [enabled, enable] = useActionState(enableTwoFactor, {});
  const [disabled, disable] = useActionState(disableTwoFactor, {});

  if (enabled.recoveryCodes) {
    return (
      <Section title="Two-step verification" description="Your account now asks for a code at every sign-in.">
        <RecoveryCodes codes={enabled.recoveryCodes} />
      </Section>
    );
  }

  if (user.twoFactorEnabled) {
    return (
      <Section
        title="Two-step verification"
        description="On. Signing in asks for a code from your authenticator app, after the password or Google."
      >
        <div className="stack" style={{ gap: 12 }}>
          <div className="row">
            <span className="badge badge-good">On</span>
            <span className="small text-2">
              {user.recoveryCodesLeft} of 10 recovery codes left
              {user.recoveryCodesLeft <= 3 && ': turn it off and on again for new ones'}
            </span>
          </div>
          <form action={disable} className="two-factor-row">
            <div className="field">
              <label htmlFor="disable-code">
                To turn it off, enter a code from the app or a recovery code
              </label>
              <input
                id="disable-code"
                name="code"
                className="input mono"
                inputMode="text"
                autoComplete="one-time-code"
                placeholder="123456"
                required
              />
            </div>
            <SubmitButton pending="Turning off…" className="btn btn-danger">
              Turn off
            </SubmitButton>
          </form>
          <Feedback state={disabled} />
        </div>
      </Section>
    );
  }

  if (setup.qrSvg) {
    return (
      <Section
        title="Two-step verification"
        description="Scan the code with an authenticator app, then enter the 6-digit code it shows."
      >
        <div className="two-factor-setup">
          <div className="qr" dangerouslySetInnerHTML={{ __html: setup.qrSvg }} />
          <div className="stack" style={{ gap: 12 }}>
            <ol className="small text-2 steps">
              <li>Open Google Authenticator, Microsoft Authenticator, 1Password or a similar app.</li>
              <li>Add an account and scan this QR code. If you cannot scan, type the key below.</li>
              <li>Enter the 6-digit code the app shows.</li>
            </ol>
            <CodeBlock code={setup.totpSecret ?? ''} />
            <form action={enable} className="two-factor-row">
              <div className="field">
                <label htmlFor="enable-code">Code from the app</label>
                <input
                  id="enable-code"
                  name="code"
                  className="input mono"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  placeholder="123456"
                  autoFocus
                  required
                />
              </div>
              <SubmitButton pending="Checking…">Turn on</SubmitButton>
            </form>
            <Feedback state={enabled} />
          </div>
        </div>
      </Section>
    );
  }

  return (
    <Section
      title="Two-step verification"
      description="Add an authenticator app code after password or Google sign-in."
    >
      <form action={startSetup} className="two-factor-intro">
        <p className="small text-2">
          Protect your account with a code from an authenticator app. This also applies to Google sign-in.
        </p>
        <SubmitButton pending="Preparing…">Enable two-step verification</SubmitButton>
      </form>
      <Feedback state={setup} />
    </Section>
  );
}
