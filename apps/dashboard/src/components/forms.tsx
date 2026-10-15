'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import {
  addDomain,
  addMember,
  createContainer,
  createWorkspace,
  deleteContainer,
  deleteDomain,
  deleteWorkspace,
  login,
  renameWorkspace,
  requestPasswordReset,
  resetPassword,
  signUp,
  verifyTwoFactor,
  provisionAgain,
  regenerateLoaderPaths,
  rotateWebhookSecret,
  saveContainerConfig,
  savePowerUps,
  saveSettings,
  verifyDomain,
  type ActionState,
} from '@/app/actions';
import type { PowerUps } from '@/lib/types';
import { CodeBlock, CopyButton, SubmitButton } from './client';
import { Alert } from './ui';

function Feedback({ state }: { state: ActionState }) {
  if (state.error) return <Alert tone="critical">{state.error}</Alert>;
  if (state.message) return <Alert tone="good">{state.message}</Alert>;
  return null;
}

export function LoginForm({ next }: { next: string }) {
  const [state, action] = useActionState(login, {});
  return (
    <form action={action} className="stack">
      <input type="hidden" name="next" value={next} />
      <div className="field">
        <label htmlFor="email">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          className="input"
          autoComplete="email"
          defaultValue={state.values?.email}
          autoFocus
          required
        />
      </div>
      <div className="field">
        <div className="label-row">
          <label htmlFor="password">Password</label>
          <Link href="/forgot-password" className="small">
            Forgot password?
          </Link>
        </div>
        <input
          id="password"
          name="password"
          type="password"
          className="input"
          autoComplete="current-password"
          required
        />
      </div>
      {state.error && <Alert tone="critical">{state.error}</Alert>}
      <SubmitButton pending="Signing in…">Sign in</SubmitButton>
    </form>
  );
}

export function TwoFactorSignInForm() {
  const [state, action] = useActionState(verifyTwoFactor, {});
  return (
    <form action={action} className="stack">
      <div className="field">
        <label htmlFor="code">Code</label>
        <input
          id="code"
          name="code"
          className="input mono code-input"
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="123456"
          autoFocus
          required
        />
        <span className="hint">Lost your phone? Enter a recovery code (like k7m2-9xqp) instead.</span>
      </div>
      {state.error && <Alert tone="critical">{state.error}</Alert>}
      <SubmitButton pending="Checking…">Verify</SubmitButton>
    </form>
  );
}

export function ForgotPasswordForm() {
  const [state, action] = useActionState(requestPasswordReset, {});
  if (state.ok) return <Alert tone="good">{state.message}</Alert>;
  return (
    <form action={action} className="stack">
      <div className="field">
        <label htmlFor="email">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          className="input"
          autoComplete="email"
          defaultValue={state.values?.email}
          autoFocus
          required
        />
      </div>
      {state.error && <Alert tone="critical">{state.error}</Alert>}
      <SubmitButton pending="Sending…">Send reset link</SubmitButton>
    </form>
  );
}

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, action] = useActionState(resetPassword.bind(null, token), {});
  return (
    <form action={action} className="stack">
      <div className="field">
        <label htmlFor="password">New password</label>
        <input
          id="password"
          name="password"
          type="password"
          className="input"
          autoComplete="new-password"
          minLength={8}
          autoFocus
          required
        />
        <span className="hint">
          At least 8 characters. Every other device you are signed in on is signed out.
        </span>
      </div>
      <div className="field">
        <label htmlFor="confirm">New password again</label>
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
      {state.error && <Alert tone="critical">{state.error}</Alert>}
      <SubmitButton pending="Saving…">Set new password</SubmitButton>
    </form>
  );
}

export function SignUpForm({ countries }: { countries: { code: string; dial: string; name: string }[] }) {
  const [state, action] = useActionState(signUp, {});
  return (
    <form action={action} className="stack">
      <div className="field">
        <label htmlFor="name">Your name</label>
        <input
          id="name"
          name="name"
          className="input"
          autoComplete="name"
          defaultValue={state.values?.name}
          autoFocus
        />
      </div>
      <div className="field">
        <label htmlFor="email">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          className="input"
          autoComplete="email"
          defaultValue={state.values?.email}
          required
        />
      </div>
      <div className="phone-row">
        <div className="field">
          <label htmlFor="phoneCountry">Country</label>
          <select
            id="phoneCountry"
            name="phoneCountry"
            className="select"
            defaultValue={state.values?.phoneCountry || 'BD'}
          >
            {countries.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} +{c.dial}
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
            pattern="[0-9 ()+\-]{4,20}"
            defaultValue={state.values?.phone}
            required
          />
        </div>
      </div>
      <div className="field">
        <label htmlFor="password">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          className="input"
          autoComplete="new-password"
          minLength={8}
          required
        />
        <span className="hint">At least 8 characters.</span>
      </div>
      <div className="field">
        <label htmlFor="confirm">Password again</label>
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
      {state.error && <Alert tone="critical">{state.error}</Alert>}
      <SubmitButton pending="Creating your account…">Create account</SubmitButton>
    </form>
  );
}

export function CreateWorkspaceForm() {
  const [state, action] = useActionState(createWorkspace, {});
  return (
    <form action={action} className="card">
      <div className="card-body stack">
        <div className="field">
          <label htmlFor="name">Workspace name</label>
          <input id="name" name="name" className="input" placeholder="Acme Ltd." autoFocus required />
          <span className="hint">
            Usually a company or a client. Containers and members belong to a workspace.
          </span>
        </div>
        <Feedback state={state} />
        <div className="row">
          <SubmitButton pending="Creating…">Create workspace</SubmitButton>
          <Link className="btn btn-ghost" href="/">
            Cancel
          </Link>
        </div>
      </div>
    </form>
  );
}

export function RenameWorkspaceForm({ workspaceId, name }: { workspaceId: string; name: string }) {
  const [state, action] = useActionState(renameWorkspace.bind(null, workspaceId), {});
  return (
    <form action={action} className="stack" style={{ gap: 10 }}>
      <div className="field">
        <label htmlFor="ws-name">Name</label>
        <input id="ws-name" name="name" className="input" defaultValue={name} required />
      </div>
      <Feedback state={state} />
      <div>
        <SubmitButton pending="Saving…">Save</SubmitButton>
      </div>
    </form>
  );
}

export function DeleteWorkspaceForm({ workspaceId, name }: { workspaceId: string; name: string }) {
  const [state, action] = useActionState(deleteWorkspace.bind(null, workspaceId, name), {});
  return (
    <form action={action} className="stack" style={{ gap: 10 }}>
      <div className="field">
        <label htmlFor="confirm-ws">
          Type <strong>{name}</strong> to confirm
        </label>
        <input id="confirm-ws" name="confirm" className="input" autoComplete="off" required />
      </div>
      <Feedback state={state} />
      <div>
        <SubmitButton pending="Deleting…" className="btn btn-danger">
          Delete workspace
        </SubmitButton>
      </div>
    </form>
  );
}

export function AddMemberForm({ workspaceId }: { workspaceId: string }) {
  const [state, action] = useActionState(addMember.bind(null, workspaceId), {});
  return (
    <form action={action} className="stack" style={{ gap: 10 }}>
      <div className="member-invite">
        <div className="field">
          <label htmlFor="invite-email">Email</label>
          <input
            id="invite-email"
            name="email"
            type="email"
            className="input"
            placeholder="name@company.com"
            required
          />
        </div>
        <div className="field">
          <label htmlFor="invite-role">Role</label>
          <select id="invite-role" name="role" className="select" defaultValue="member">
            <option value="member">Member: manage containers</option>
            <option value="owner">Owner: also manage members</option>
          </select>
        </div>
        <SubmitButton pending="Inviting…">Invite</SubmitButton>
      </div>
      <Feedback state={state} />
    </form>
  );
}

/** A one-click action (remove, change role, cancel invite) with its error shown in place. */
export function InlineAction({
  action,
  label,
  pending,
  confirm,
  danger,
  primary,
}: {
  action: (prev: ActionState) => Promise<ActionState>;
  label: string;
  pending: string;
  confirm?: string;
  danger?: boolean;
  primary?: boolean;
}) {
  const [state, run] = useActionState(action, {});
  return (
    <form
      action={run}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
      className="inline-action"
    >
      <SubmitButton
        pending={pending}
        className={`btn btn-sm ${danger ? 'btn-danger' : primary ? 'btn-primary' : ''}`}
      >
        {label}
      </SubmitButton>
      {state.error && <span className="small inline-error">{state.error}</span>}
    </form>
  );
}

export function NewContainerForm({ workspaceName }: { workspaceName: string }) {
  const [state, action] = useActionState(createContainer, {});

  if (state.ok && state.containerId) {
    return (
      <div className="card">
        <div className="card-body stack">
          <Alert tone="good">Container created. Its tagging servers are being provisioned.</Alert>
          <div className="stack" style={{ gap: 8 }}>
            <h3>WooCommerce webhook secret</h3>
            <p className="text-2">
              The WooCommerce plugin signs order events with this secret. Copy it now: it is not shown again
              (you can rotate it later in Settings).
            </p>
            <CodeBlock code={state.secret ?? ''} />
          </div>
          <div className="row">
            <Link className="btn btn-primary" href={`/containers/${state.containerId}/domains`}>
              Next: add a tracking domain
            </Link>
            <Link className="btn" href={`/containers/${state.containerId}`}>
              Go to container
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <form action={action} className="card">
      <div className="card-body stack">
        <p className="small text-2">
          In workspace <strong>{workspaceName}</strong>.
        </p>
        <div className="field">
          <label htmlFor="name">Container name</label>
          <input id="name" name="name" className="input" placeholder="Shop – production" required />
        </div>
        <div className="field">
          <label htmlFor="containerConfig">Container Config</label>
          <textarea
            id="containerConfig"
            name="containerConfig"
            className="textarea"
            placeholder="aWQ9R1RNLVhYWFhYWFgmZW52PTEmYXV0aD0uLi4="
            required
          />
          <span className="hint">
            In GTM open the <strong>server</strong> container: Admin › Container settings › Manually provision
            tagging server, and copy the Container Config string.
          </span>
        </div>
        <div className="field">
          <label htmlFor="webContainerId">Web container ID (optional)</label>
          <input id="webContainerId" name="webContainerId" className="input mono" placeholder="GTM-ABC1234" />
          <span className="hint">
            The website&apos;s web container. The custom loader serves its gtm.js from your own domain.
          </span>
        </div>
        <Feedback state={state} />
        <div className="row">
          <SubmitButton pending="Creating…">Create container</SubmitButton>
          <Link className="btn btn-ghost" href="/">
            Cancel
          </Link>
        </div>
      </div>
    </form>
  );
}

export function AddDomainForm({ containerId }: { containerId: string }) {
  const [state, action] = useActionState(addDomain.bind(null, containerId), {});
  return (
    <form action={action} className="stack" style={{ gap: 10 }}>
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <div className="field" style={{ flex: '1 1 260px' }}>
          <label htmlFor="hostname">Tracking domain</label>
          <input id="hostname" name="hostname" className="input" placeholder="sst.example.com" required />
        </div>
        <SubmitButton pending="Adding…">Add domain</SubmitButton>
      </div>
      <Feedback state={state} />
    </form>
  );
}

export function DomainActions({
  domainId,
  containerId,
  verified,
}: {
  domainId: string;
  containerId: string;
  verified: boolean;
}) {
  const [state, verify] = useActionState(verifyDomain.bind(null, domainId, containerId), {});
  const [, remove] = useActionState(deleteDomain.bind(null, domainId, containerId), {});
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row">
        <form action={verify}>
          <SubmitButton
            className={verified ? 'btn btn-sm' : 'btn btn-sm btn-primary'}
            pending="Checking DNS…"
          >
            {verified ? 'Check DNS again' : 'Verify'}
          </SubmitButton>
        </form>
        <form
          action={remove}
          onSubmit={(e) => {
            if (!confirm('Remove this domain? Tracking on it stops immediately.')) e.preventDefault();
          }}
        >
          <SubmitButton className="btn btn-sm btn-ghost" pending="Removing…">
            Remove
          </SubmitButton>
        </form>
      </div>
      <Feedback state={state} />
    </div>
  );
}

function Switch({ name, defaultChecked, label }: { name: string; defaultChecked: boolean; label: string }) {
  return (
    <span className="switch">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} aria-label={label} />
      <span />
    </span>
  );
}

export interface LoaderInfo {
  webContainerId: string | null;
  gtmPath: string;
  gtagPath: string;
  /** Verified tracking domain, to show full URLs; null until one is verified. */
  trackingHost: string | null;
}

function LoaderUrl({ label, url }: { label: string; url: string }) {
  return (
    <div className="field">
      <span className="small muted">{label}</span>
      <div className="row" style={{ flexWrap: 'nowrap' }}>
        <code className="code" style={{ flex: 1, paddingRight: 12 }}>
          {url}
        </code>
        <CopyButton text={url} />
      </div>
    </div>
  );
}

export function PowerUpsForm({
  containerId,
  powerUps,
  loader,
}: {
  containerId: string;
  powerUps: PowerUps;
  loader: LoaderInfo;
}) {
  const [state, action] = useActionState(savePowerUps.bind(null, containerId), {});
  const p = powerUps;
  const base = loader.trackingHost ? `https://${loader.trackingHost}` : '';
  return (
    <form action={action} className="stack">
      <div className="card">
        <div className="switch-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
          <div
            className="row"
            style={{ justifyContent: 'space-between', flexWrap: 'nowrap', alignItems: 'flex-start' }}
          >
            <div>
              <h3>Custom loader</h3>
              <p>
                Serves gtm.js and gtag.js from the tracking domain under random paths instead of
                googletagmanager.com, so ad blockers do not stop the tags from loading. The Overview tab has
                the GTM snippet that uses it.
              </p>
            </div>
            <Switch name="customLoader" defaultChecked={p.customLoader.enabled} label="Custom loader" />
          </div>
          <div className="field">
            <label htmlFor="webContainerId">Web container ID</label>
            <input
              id="webContainerId"
              name="webContainerId"
              className="input mono"
              defaultValue={loader.webContainerId ?? ''}
              placeholder="GTM-ABC1234"
            />
            <span className="hint">
              The website&apos;s web container, whose gtm.js the loader serves. In the server container, the
              &quot;Google Tag Manager: Web Container&quot; client must allow this ID. Without it only gtag.js
              is served.
            </span>
          </div>
          {loader.webContainerId ? (
            <LoaderUrl label="gtm.js" url={`${base}${loader.gtmPath}`} />
          ) : (
            <span className="small muted">gtm.js: set a web container ID to serve it.</span>
          )}
          <LoaderUrl
            label="gtag.js (with ?id=G-… or ?id=AW-…)"
            url={`${base}${loader.gtagPath}?id=G-XXXXXXXXXX`}
          />
          {!loader.trackingHost && (
            <span className="small muted">Full URLs appear once a tracking domain is verified.</span>
          )}
        </div>
        <div className="switch-row">
          <div>
            <h3>Geo headers</h3>
            <p>
              Adds the visitor&apos;s country, region and city as <code>x-sst-geo-*</code> request headers.
              Needs the GeoLite2 database on the gateway.
            </p>
          </div>
          <Switch name="geoHeaders" defaultChecked={p.geoHeaders} label="Geo headers" />
        </div>
        <div className="switch-row">
          <div>
            <h3>User agent info</h3>
            <p>
              Adds browser, operating system and device type as <code>x-sst-device-*</code> headers.
            </p>
          </div>
          <Switch name="userAgentInfo" defaultChecked={p.userAgentInfo} label="User agent info" />
        </div>
        <div className="switch-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
          <div>
            <h3>Bot detection</h3>
            <p>
              Checks known crawler user agents, empty user agents and IP lists. <strong>Flag</strong> adds{' '}
              <code>x-sst-bot</code> headers so tags can skip bots; <strong>Drop</strong> answers without
              forwarding.
            </p>
          </div>
          <div className="grid-2">
            <div className="field">
              <label htmlFor="botMode">Mode</label>
              <select id="botMode" name="botMode" className="select" defaultValue={p.botDetection.mode}>
                <option value="off">Off</option>
                <option value="flag">Flag</option>
                <option value="drop">Drop</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="blockedIps">Blocked IPs and ranges</label>
              <textarea
                id="blockedIps"
                name="blockedIps"
                className="textarea"
                style={{ minHeight: 38 }}
                defaultValue={p.botDetection.blockedIps.join('\n')}
                placeholder="203.0.113.0/24"
              />
              <span className="hint">One per line. CIDR ranges allowed.</span>
            </div>
          </div>
        </div>
        <div className="switch-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
          <div
            className="row"
            style={{ justifyContent: 'space-between', flexWrap: 'nowrap', alignItems: 'flex-start' }}
          >
            <div>
              <h3>Cookie keeper</h3>
              <p>
                Extends marketing cookies (Safari limits script cookies to 7 days) and restores them when the
                browser dropped them. Only cookies the visitor already has; restoring needs ad_storage
                consent.
              </p>
            </div>
            <Switch name="cookieKeeper" defaultChecked={p.cookieKeeper.enabled} label="Cookie keeper" />
          </div>
          <div className="grid-2">
            <div className="field">
              <label htmlFor="keptCookies">Cookies</label>
              <input
                id="keptCookies"
                name="keptCookies"
                className="input mono"
                defaultValue={p.cookieKeeper.cookies.join(', ')}
              />
              <span className="hint">Comma separated. A trailing * matches a prefix.</span>
            </div>
            <div className="field">
              <label htmlFor="cookieMaxAgeDays">Lifetime (days)</label>
              <input
                id="cookieMaxAgeDays"
                name="cookieMaxAgeDays"
                type="number"
                min={1}
                max={400}
                className="input"
                defaultValue={p.cookieKeeper.maxAgeDays}
              />
            </div>
          </div>
        </div>
        <div className="switch-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
          <div
            className="row"
            style={{ justifyContent: 'space-between', flexWrap: 'nowrap', alignItems: 'flex-start' }}
          >
            <div>
              <h3>Anonymizer</h3>
              <p>
                Removes or masks personal data in GA4 hits before they reach the tagging server. It applies to
                every tag fed by those hits, including Meta.
              </p>
            </div>
            <Switch name="anonymizer" defaultChecked={p.anonymizer.enabled} label="Anonymizer" />
          </div>
          <div className="row" style={{ gap: 20 }}>
            <label className="row" style={{ gap: 6 }}>
              <input type="checkbox" name="anonymizeIp" defaultChecked={p.anonymizer.anonymizeIp} /> Anonymize
              IP
            </label>
            <label className="row" style={{ gap: 6 }}>
              <input type="checkbox" name="removeUserId" defaultChecked={p.anonymizer.removeUserId} /> Remove
              user ID
            </label>
            <label className="row" style={{ gap: 6 }}>
              <input type="checkbox" name="redactPii" defaultChecked={p.anonymizer.redactPii} /> Mask emails
              and personal URL parameters
            </label>
          </div>
        </div>
      </div>
      <Feedback state={state} />
      <div>
        <SubmitButton pending="Saving…">Save power-ups</SubmitButton>
      </div>
    </form>
  );
}

export function SettingsForm({ containerId, name }: { containerId: string; name: string }) {
  const [state, action] = useActionState(saveSettings.bind(null, containerId), {});
  return (
    <form action={action} className="card-body stack">
      <div className="field">
        <label htmlFor="name">Name</label>
        <input id="name" name="name" className="input" defaultValue={name} required />
      </div>
      <Feedback state={state} />
      <div>
        <SubmitButton pending="Saving…">Save</SubmitButton>
      </div>
    </form>
  );
}

export function RotateSecretForm({ containerId }: { containerId: string }) {
  const [state, action] = useActionState(rotateWebhookSecret.bind(null, containerId), {});
  return (
    <form
      action={action}
      className="card-body stack"
      onSubmit={(e) => {
        if (!confirm('Rotate the secret? Orders from WooCommerce fail until the plugin has the new one.'))
          e.preventDefault();
      }}
    >
      <p className="text-2">
        WooCommerce signs order events with this secret. Rotating it invalidates the old one immediately.
      </p>
      {state.secret && (
        <div className="stack" style={{ gap: 8 }}>
          <Alert tone="warning">Copy the new secret now; it is not shown again.</Alert>
          <CodeBlock code={state.secret} />
        </div>
      )}
      {state.error && <Alert tone="critical">{state.error}</Alert>}
      <div>
        <SubmitButton className="btn" pending="Rotating…">
          Rotate webhook secret
        </SubmitButton>
      </div>
    </form>
  );
}

export function DeleteContainerForm({ containerId, name }: { containerId: string; name: string }) {
  const [state, action] = useActionState(deleteContainer.bind(null, containerId, name), {});
  return (
    <form action={action} className="card-body stack">
      <p className="text-2">
        Stops tracking on all of this container&apos;s domains at once and removes its tagging servers. The
        GTM container itself stays in your GTM account.
      </p>
      <div className="field">
        <label htmlFor="confirm">
          Type <strong>{name}</strong> to confirm
        </label>
        <input id="confirm" name="confirm" className="input" autoComplete="off" />
      </div>
      {state.error && <Alert tone="critical">{state.error}</Alert>}
      <div>
        <SubmitButton className="btn btn-danger" pending="Deleting…">
          Delete container
        </SubmitButton>
      </div>
    </form>
  );
}

export function ContainerConfigForm({
  containerId,
  gtmContainerId,
}: {
  containerId: string;
  gtmContainerId: string;
}) {
  const [state, action] = useActionState(saveContainerConfig.bind(null, containerId), {});
  return (
    <form action={action} className="card-body stack">
      <p className="text-2">
        Currently running server container <span className="mono">{gtmContainerId}</span>. To switch to
        another GTM server container, or after GTM issued a new config, paste the new Container Config. The
        provisioner restarts the tagging and preview servers with it; the stored config is never shown again.
      </p>
      <div className="field">
        <label htmlFor="containerConfig">New Container Config</label>
        <textarea
          id="containerConfig"
          name="containerConfig"
          className="textarea"
          placeholder="aWQ9R1RNLVhYWFhYWFgmZW52PTEmYXV0aD0uLi4="
          autoComplete="off"
          required
        />
        <span className="hint">
          GTM server container: Admin › Container settings › Manually provision tagging server.
        </span>
      </div>
      <Feedback state={state} />
      <div>
        <SubmitButton pending="Saving…">Save and restart</SubmitButton>
      </div>
    </form>
  );
}

export function ProvisionButton({ containerId, label }: { containerId: string; label: string }) {
  const [state, action] = useActionState(provisionAgain.bind(null, containerId), {});
  return (
    <form action={action} className="stack" style={{ gap: 8 }}>
      <div>
        <SubmitButton className="btn btn-sm" pending="Queueing…">
          {label}
        </SubmitButton>
      </div>
      {state.error && <Alert tone="critical">{state.error}</Alert>}
    </form>
  );
}

export function RegenerateLoaderPathsForm({ containerId }: { containerId: string }) {
  const [state, action] = useActionState(regenerateLoaderPaths.bind(null, containerId), {});
  return (
    <form
      action={action}
      className="card card-body stack"
      onSubmit={(e) => {
        if (
          !confirm(
            'Generate new loader paths? Websites using the current GTM snippet stop loading tags until it is replaced.',
          )
        )
          e.preventDefault();
      }}
    >
      <div>
        <h3>New loader paths</h3>
        <p className="text-2 small">
          If an ad blocker list starts matching the current paths, generate new ones and update the GTM
          snippet on the website.
        </p>
      </div>
      <Feedback state={state} />
      <div>
        <SubmitButton className="btn btn-sm" pending="Generating…">
          Generate new paths
        </SubmitButton>
      </div>
    </form>
  );
}
