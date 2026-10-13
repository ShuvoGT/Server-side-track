'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { createSession, destroySession, passwordMatches, requireSession } from '@/lib/session';
import type { PowerUps } from '@/lib/types';

export interface ActionState {
  ok?: boolean;
  error?: string;
  message?: string;
  /** A secret shown once, right after it is created. */
  secret?: string;
  containerId?: string;
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

export async function login(_prev: ActionState, form: FormData): Promise<ActionState> {
  if (!passwordMatches(text(form, 'password'))) return { error: 'Wrong password.' };
  await createSession();
  redirect('/');
}

export async function logout(): Promise<void> {
  await destroySession();
  redirect('/login');
}

export async function createContainer(_prev: ActionState, form: FormData): Promise<ActionState> {
  return guarded(async () => {
    const name = text(form, 'name');
    const containerConfig = text(form, 'containerConfig');
    const webContainerId = text(form, 'webContainerId').toUpperCase() || null;
    let tenantId = text(form, 'tenantId');
    if (!name) return { error: 'Give the container a name.' };
    if (!containerConfig) return { error: 'Paste the Container Config from GTM.' };
    if (webContainerId && !/^GTM-[A-Z0-9]{4,12}$/.test(webContainerId)) {
      return { error: 'The web container ID looks like GTM-ABC1234.' };
    }
    if (tenantId === '__new') {
      const tenantName = text(form, 'tenantName');
      if (!tenantName) return { error: 'Name the new website or product.' };
      tenantId = (await api.createTenant(tenantName)).id;
    }
    if (!tenantId) return { error: 'Choose which website or product this container is for.' };
    const container = await api.createContainer({ tenantId, name, containerConfig, webContainerId });
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
