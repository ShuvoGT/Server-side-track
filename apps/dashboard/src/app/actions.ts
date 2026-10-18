'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { currentWorkspace } from '@/lib/data';
import QRCode from 'qrcode';
import {
  clearPendingSignIn,
  createSession,
  destroySession,
  getPendingSignIn,
  requireSession,
  selectWorkspace,
  startPendingSignIn,
} from '@/lib/session';
import type { Me, PowerUps, Role } from '@/lib/types';

export interface ActionState {
  ok?: boolean;
  error?: string;
  message?: string;
  /** A secret shown once, right after it is created. */
  secret?: string;
  containerId?: string;
  /** Typed values to show again after a failed submit (React resets the form). */
  values?: Record<string, string>;
  /** Two-step setup: the key to scan, as an SVG QR code and as text. */
  qrSvg?: string;
  totpSecret?: string;
  /** Shown once, right after two-step verification is turned on. */
  recoveryCodes?: string[];
}

async function guarded(run: () => Promise<ActionState>): Promise<ActionState> {
  await requireSession();
  try {
    return await run();
  } catch (error) {
    if (error instanceof ApiError) return { error: error.message };
    throw error;
  }
}

const text = (form: FormData, name: string) => String(form.get(name) ?? '').trim();

/** Only paths inside the dashboard, so a sign-in link cannot send people elsewhere. */
function safeNext(value: string): string {
  return value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\') ? value : '/';
}

async function clientIp(): Promise<string | undefined> {
  const h = await headers();
  return h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || undefined;
}

async function startSession(me: Me, next: string): Promise<never> {
  // A new account waits for a super-admin: it gets a session, but only for the waiting page.
  if (me.user.status !== 'active') {
    await createSession(me.user.id);
    redirect('/pending');
  }
  // With two-step verification on, the password or Google step only earns a short wait for the code.
  if (me.user.twoFactorEnabled) {
    await startPendingSignIn(me.user.id, safeNext(next));
    redirect('/login/verify');
  }
  await createSession(me.user.id);
  const own = me.workspaces.find((w) => w.role === 'owner') ?? me.workspaces[0];
  if (own) await selectWorkspace(own.id);
  redirect(safeNext(next));
}

export async function login(_prev: ActionState, form: FormData): Promise<ActionState> {
  const email = text(form, 'email');
  const password = String(form.get('password') ?? '');
  const values = { email };
  if (!email || !password) return { error: 'Enter your email and password.', values };
  let me: Me;
  try {
    me = await api.signIn({ email, password, clientIp: await clientIp() });
  } catch (error) {
    if (error instanceof ApiError) return { error: error.message, values };
    throw error;
  }
  return startSession(me, text(form, 'next'));
}

export async function signUp(_prev: ActionState, form: FormData): Promise<ActionState> {
  const email = text(form, 'email');
  const password = String(form.get('password') ?? '');
  const values = {
    email,
    name: text(form, 'name'),
    phoneCountry: text(form, 'phoneCountry'),
    phone: text(form, 'phone'),
  };
  if (!email) return { error: 'Enter your email address.', values };
  if (!/^[0-9 ()+-]{4,20}$/.test(values.phone))
    return { error: 'Enter your phone number, digits only (e.g. 1711421236).', values };
  if (password.length < 8) return { error: 'Use a password of at least 8 characters.', values };
  if (password !== String(form.get('confirm') ?? '')) return { error: 'The two passwords differ.', values };
  let me: Me;
  try {
    me = await api.signUp({
      email,
      password,
      name: values.name,
      phoneCountry: values.phoneCountry || undefined,
      phone: values.phone,
    });
  } catch (error) {
    if (error instanceof ApiError)
      return {
        error: error.code === 'invalid_request' ? 'Enter a valid email address.' : error.message,
        values,
      };
    throw error;
  }
  return startSession(me, '/');
}

export async function requestPasswordReset(_prev: ActionState, form: FormData): Promise<ActionState> {
  const email = text(form, 'email');
  if (!email) return { error: 'Enter the email address of your account.' };
  try {
    await api.requestPasswordReset(email, await clientIp());
  } catch (error) {
    if (error instanceof ApiError) return { error: error.message, values: { email } };
    throw error;
  }
  return {
    ok: true,
    message: `If ${email} has an account, a link to set a new password is on its way. It works for one hour.`,
  };
}

export async function resetPassword(token: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const password = String(form.get('password') ?? '');
  if (password.length < 8) return { error: 'Use a password of at least 8 characters.' };
  if (password !== String(form.get('confirm') ?? '')) return { error: 'The two passwords differ.' };
  let me: Me;
  try {
    me = await api.resetPassword(token, password);
  } catch (error) {
    if (error instanceof ApiError)
      return { error: error.code === 'invalid_request' ? 'This reset link is not valid.' : error.message };
    throw error;
  }
  return startSession(me, '/');
}

export async function verifyTwoFactor(_prev: ActionState, form: FormData): Promise<ActionState> {
  const pending = await getPendingSignIn();
  if (!pending) redirect('/login?error=two_factor_expired');
  const code = text(form, 'code');
  if (!code) return { error: 'Enter the 6-digit code from your authenticator app.' };
  let me: Me;
  try {
    me = await api.verifySecondFactor(pending.userId, code);
  } catch (error) {
    if (error instanceof ApiError) return { error: error.message };
    throw error;
  }
  await clearPendingSignIn();
  await createSession(me.user.id);
  const own = me.workspaces.find((w) => w.role === 'owner') ?? me.workspaces[0];
  if (own) await selectWorkspace(own.id);
  redirect(safeNext(pending.next));
}

// Account settings

export async function saveProfile(_prev: ActionState, form: FormData): Promise<ActionState> {
  return guarded(async () => {
    const name = text(form, 'name');
    const phone = text(form, 'phone');
    if (!name) return { error: 'Your name cannot be empty.' };
    await api.updateProfile({
      name,
      phoneCountry: text(form, 'phoneCountry') || null,
      phone: phone || null,
    });
    revalidatePath('/', 'layout');
    return { ok: true, message: 'Profile saved.' };
  });
}

export async function savePreferences(_prev: ActionState, form: FormData): Promise<ActionState> {
  return guarded(async () => {
    await api.updateProfile({ currency: text(form, 'currency'), timezone: text(form, 'timezone') });
    revalidatePath('/', 'layout');
    return { ok: true, message: 'Preferences saved. Dates and times now use your time zone.' };
  });
}

export async function changePassword(_prev: ActionState, form: FormData): Promise<ActionState> {
  return guarded(async () => {
    const current = String(form.get('currentPassword') ?? '');
    const next = String(form.get('newPassword') ?? '');
    if (next.length < 8) return { error: 'Use a new password of at least 8 characters.' };
    if (next !== String(form.get('confirm') ?? '')) return { error: 'The two new passwords differ.' };
    const me = await api.changePassword(current || undefined, next);
    // The change ended every older session, this one included: sign it in again.
    await createSession(me.user.id);
    revalidatePath('/', 'layout');
    return { ok: true, message: 'Password updated. You were signed out on every other device.' };
  });
}

export async function startTwoFactorSetup(_prev: ActionState): Promise<ActionState> {
  return guarded(async () => {
    const { secret, otpauthUrl } = await api.setUpTwoFactor();
    const qrSvg = await QRCode.toString(otpauthUrl, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
    return { ok: true, qrSvg, totpSecret: secret };
  });
}

export async function enableTwoFactor(_prev: ActionState, form: FormData): Promise<ActionState> {
  return guarded(async () => {
    const code = text(form, 'code');
    if (!code) return { error: 'Enter the 6-digit code from the app.' };
    const { recoveryCodes } = await api.enableTwoFactor(code);
    revalidatePath('/settings');
    return { ok: true, recoveryCodes };
  });
}

export async function disableTwoFactor(_prev: ActionState, form: FormData): Promise<ActionState> {
  return guarded(async () => {
    const code = text(form, 'code');
    if (!code) return { error: 'Enter a code from the app, or a recovery code.' };
    await api.disableTwoFactor(code);
    revalidatePath('/settings');
    return { ok: true, message: 'Two-step verification is off.' };
  });
}

export async function logout(): Promise<void> {
  await destroySession();
  redirect('/login');
}

// Workspaces

export async function switchWorkspace(form: FormData): Promise<void> {
  await requireSession();
  const id = text(form, 'workspaceId');
  if (id === '__new') redirect('/workspace/new');
  await selectWorkspace(id);
  redirect('/');
}

export async function createWorkspace(_prev: ActionState, form: FormData): Promise<ActionState> {
  const result = await guarded(async () => {
    const name = text(form, 'name');
    if (!name) return { error: 'Name the workspace, e.g. the company or client.' };
    const workspace = await api.createWorkspace(name);
    await selectWorkspace(workspace.id);
    return { ok: true };
  });
  if (result.ok) redirect('/');
  return result;
}

export async function renameWorkspace(workspaceId: string, _prev: ActionState, form: FormData) {
  return guarded(async () => {
    const name = text(form, 'name');
    if (!name) return { error: 'The name cannot be empty.' };
    await api.renameWorkspace(workspaceId, name);
    revalidatePath('/', 'layout');
    return { ok: true, message: 'Saved.' };
  });
}

export async function deleteWorkspace(
  workspaceId: string,
  expectedName: string,
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const result = await guarded(async () => {
    if (text(form, 'confirm') !== expectedName) return { error: `Type ${expectedName} to confirm.` };
    await api.deleteWorkspace(workspaceId);
    // Move to another workspace the user still has.
    const remaining = (await api.workspaces()).find((w) => w.role === 'owner') ?? (await api.workspaces())[0];
    if (remaining) await selectWorkspace(remaining.id);
    revalidatePath('/', 'layout');
    return { ok: true };
  });
  if (result.ok) redirect('/');
  return result;
}

/** Super-admins, from All workspaces: deletes a workspace and every container in it. */
export async function adminDeleteWorkspace(workspaceId: string, _prev: ActionState): Promise<ActionState> {
  return guarded(async () => {
    await api.deleteWorkspaceWithContainers(workspaceId);
    revalidatePath('/', 'layout');
    return { ok: true };
  });
}

export async function approveUser(userId: string, _prev: ActionState): Promise<ActionState> {
  return guarded(async () => {
    const { emailed } = await api.approveUser(userId);
    revalidatePath('/', 'layout');
    return { ok: true, message: emailed ? 'Approved and emailed.' : 'Approved.' };
  });
}

export async function deleteUser(userId: string, _prev: ActionState): Promise<ActionState> {
  return guarded(async () => {
    await api.deleteUser(userId);
    revalidatePath('/', 'layout');
    return { ok: true };
  });
}

export async function rejectUser(userId: string, _prev: ActionState): Promise<ActionState> {
  return guarded(async () => {
    await api.rejectUser(userId);
    revalidatePath('/', 'layout');
    return { ok: true };
  });
}

export async function addMember(workspaceId: string, _prev: ActionState, form: FormData) {
  return guarded(async () => {
    const email = text(form, 'email');
    if (!email) return { error: 'Enter the email address to invite.' };
    const role = (text(form, 'role') === 'owner' ? 'owner' : 'member') as Role;
    const result = await api.addMember(workspaceId, email, role);
    revalidatePath('/workspace');
    const mailed = result.emailed ? ' We emailed them.' : ' No email was sent: tell them yourself.';
    return {
      ok: true,
      message: result.added
        ? `${result.added.email} is now a member.${mailed}`
        : `Invited ${result.invited?.email}. They join when they sign in with Google using that address.${mailed}`,
    };
  });
}

export async function changeRole(workspaceId: string, userId: string, role: Role, _prev: ActionState) {
  return guarded(async () => {
    await api.changeRole(workspaceId, userId, role);
    revalidatePath('/workspace');
    return { ok: true };
  });
}

export async function removeMember(workspaceId: string, userId: string, _prev: ActionState) {
  const session = await requireSession();
  const result = await guarded(async () => {
    await api.removeMember(workspaceId, userId);
    revalidatePath('/', 'layout');
    return { ok: true };
  });
  // Leaving a workspace: go back to one the user still belongs to.
  if (result.ok && userId === session.userId) redirect('/');
  return result;
}

export async function cancelInvite(workspaceId: string, inviteId: string, _prev: ActionState) {
  return guarded(async () => {
    await api.cancelInvite(workspaceId, inviteId);
    revalidatePath('/workspace');
    return { ok: true };
  });
}

// Containers

export async function createContainer(_prev: ActionState, form: FormData): Promise<ActionState> {
  return guarded(async () => {
    const name = text(form, 'name');
    const containerConfig = text(form, 'containerConfig');
    const webContainerId = text(form, 'webContainerId').toUpperCase() || null;
    if (!name) return { error: 'Give the container a name.' };
    if (!containerConfig) return { error: 'Paste the Container Config from GTM.' };
    if (webContainerId && !/^GTM-[A-Z0-9]{4,12}$/.test(webContainerId)) {
      return { error: 'The web container ID looks like GTM-ABC1234.' };
    }
    const workspace = await currentWorkspace();
    const container = await api.createContainer({
      tenantId: workspace.id,
      name,
      containerConfig,
      webContainerId,
    });
    revalidatePath('/');
    return { ok: true, containerId: container.id, secret: container.webhookSecret };
  });
}

export async function addDomain(
  containerId: string,
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  return guarded(async () => {
    const hostname = text(form, 'hostname');
    if (!hostname) return { error: 'Enter the tracking domain, e.g. sst.example.com.' };
    const domain = await api.addDomain(containerId, hostname);
    revalidatePath(`/containers/${containerId}`, 'layout');
    return { ok: true, message: `${domain.hostname} added. Create the DNS record below, then verify.` };
  });
}

export async function verifyDomain(
  domainId: string,
  containerId: string,
  _prev: ActionState,
): Promise<ActionState> {
  return guarded(async () => {
    const result = await api.verifyDomain(domainId);
    revalidatePath(`/containers/${containerId}`, 'layout');
    if (!result.check.ok) return { error: result.check.error };
    return {
      ok: true,
      message:
        result.check.warning ??
        `Verified. ${result.hostname} is live; its certificate is issued on the first request.`,
    };
  });
}

export async function deleteDomain(domainId: string, containerId: string): Promise<ActionState> {
  return guarded(async () => {
    await api.deleteDomain(domainId);
    revalidatePath(`/containers/${containerId}`, 'layout');
    return { ok: true };
  });
}

function parseIpList(value: string): string[] {
  return value
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function savePowerUps(
  containerId: string,
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  return guarded(async () => {
    const on = (name: string) => form.get(name) === 'on';
    const webContainerId = text(form, 'webContainerId').toUpperCase() || null;
    if (webContainerId && !/^GTM-[A-Z0-9]{4,12}$/.test(webContainerId)) {
      return { error: 'The web container ID looks like GTM-ABC1234.' };
    }
    const maxAgeDays = Number(text(form, 'cookieMaxAgeDays') || 400);
    if (!Number.isInteger(maxAgeDays) || maxAgeDays < 1 || maxAgeDays > 400) {
      return { error: 'Cookie lifetime must be between 1 and 400 days.' };
    }
    const powerUps: Partial<PowerUps> = {
      customLoader: { enabled: on('customLoader') },
      geoHeaders: on('geoHeaders'),
      userAgentInfo: on('userAgentInfo'),
      botDetection: {
        mode: text(form, 'botMode') as PowerUps['botDetection']['mode'],
        blockedIps: parseIpList(text(form, 'blockedIps')),
      },
      cookieKeeper: {
        enabled: on('cookieKeeper'),
        cookies: parseIpList(text(form, 'keptCookies')),
        maxAgeDays,
      },
      anonymizer: {
        enabled: on('anonymizer'),
        anonymizeIp: on('anonymizeIp'),
        removeUserId: on('removeUserId'),
        redactPii: on('redactPii'),
      },
    };
    await api.updateContainer(containerId, { powerUps, webContainerId });
    revalidatePath(`/containers/${containerId}`, 'layout');
    return { ok: true, message: 'Saved. The gateway applies the change within seconds.' };
  });
}

export async function saveSettings(
  containerId: string,
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  return guarded(async () => {
    const name = text(form, 'name');
    if (!name) return { error: 'The name cannot be empty.' };
    await api.updateContainer(containerId, { name });
    revalidatePath('/', 'layout');
    return { ok: true, message: 'Saved.' };
  });
}

export async function saveContainerConfig(
  containerId: string,
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  return guarded(async () => {
    const containerConfig = text(form, 'containerConfig');
    if (!containerConfig) return { error: 'Paste the new Container Config from GTM.' };
    const updated = await api.updateContainer(containerId, { containerConfig });
    revalidatePath(`/containers/${containerId}`, 'layout');
    return {
      ok: true,
      message:
        updated.status === 'provisioning'
          ? `Saved. Restarting the tagging servers for ${updated.gtmContainerId}.`
          : 'That is the Container Config already in use; nothing changed.',
    };
  });
}

export async function regenerateLoaderPaths(containerId: string, _prev: ActionState): Promise<ActionState> {
  return guarded(async () => {
    await api.regenerateLoaderPaths(containerId);
    revalidatePath(`/containers/${containerId}`, 'layout');
    return {
      ok: true,
      message: 'New paths are live. Update the GTM snippet on the website now: the old paths no longer work.',
    };
  });
}

export async function provisionAgain(containerId: string, _prev: ActionState): Promise<ActionState> {
  return guarded(async () => {
    await api.provision(containerId);
    revalidatePath(`/containers/${containerId}`, 'layout');
    return { ok: true, message: 'Queued. The provisioner restarts the tagging servers.' };
  });
}

export async function rotateWebhookSecret(containerId: string, _prev: ActionState): Promise<ActionState> {
  return guarded(async () => {
    const result = await api.rotateWebhookSecret(containerId);
    return { ok: true, secret: result.webhookSecret };
  });
}

export async function deleteContainer(
  containerId: string,
  expectedName: string,
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const result = await guarded(async () => {
    if (text(form, 'confirm') !== expectedName) return { error: `Type ${expectedName} to confirm.` };
    await api.deleteContainer(containerId);
    revalidatePath('/');
    return { ok: true };
  });
  if (result.ok) redirect('/');
  return result;
}
