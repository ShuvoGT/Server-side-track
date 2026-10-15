import 'server-only';
import { notFound, redirect } from 'next/navigation';
import { cache } from 'react';
import { api, ApiError } from './api';
import { requireSession, selectedWorkspaceId } from './session';

/** Loads a container once per request, shared by the layout and the page; 404s for unknown ids. */
export const getContainer = cache(async (id: string) => {
  try {
    return await api.container(id);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
});

/** The signed-in user and their workspaces, once per request. A deleted account goes back to sign-in. */
export const getMe = cache(async () => {
  // Pages render alongside the layout, so each checks the session itself (e.g. a cookie from an older version).
  await requireSession();
  try {
    const me = await api.me();
    if (me.user.status !== 'active') redirect('/pending');
    return me;
  } catch (error) {
    if (error instanceof ApiError && (error.status === 401 || error.code === 'no_user')) redirect('/logout');
    throw error;
  }
});

/** The workspace picked in the sidebar, or the user's first own one. */
export const currentWorkspace = cache(async () => {
  const { workspaces } = await getMe();
  const picked = await selectedWorkspaceId();
  return workspaces.find((w) => w.id === picked) ?? workspaces.find((w) => w.role) ?? workspaces[0]!;
});
