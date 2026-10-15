'use client';

import { switchWorkspace } from '@/app/actions';
import type { Workspace } from '@/lib/types';

/** Switches on change; the form posts to a server action, so it also works before hydration. */
export function WorkspaceSwitcher({
  workspaces,
  currentId,
  superAdmin,
}: {
  workspaces: Workspace[];
  currentId: string;
  superAdmin: boolean;
}) {
  const own = workspaces.filter((w) => w.role);
  const others = workspaces.filter((w) => !w.role);
  return (
    <form action={switchWorkspace} className="ws-switcher">
      <label htmlFor="workspaceId" className="ws-label">
        Workspace
      </label>
      <select
        id="workspaceId"
        name="workspaceId"
        className="select"
        defaultValue={currentId}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
      >
        {own.map((w) => (
          <option key={w.id} value={w.id}>
            {w.name}
          </option>
        ))}
        {superAdmin && others.length > 0 && (
          <optgroup label="Other workspaces (super-admin)">
            {others.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </optgroup>
        )}
        <option value="__new">+ New workspace…</option>
      </select>
      <noscript>
        <button type="submit" className="btn btn-sm">
          Switch
        </button>
      </noscript>
    </form>
  );
}
