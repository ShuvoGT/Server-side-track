import { changeRole, removeMember, cancelInvite } from '@/app/actions';
import { AddMemberForm, InlineAction, RenameWorkspaceForm } from '@/components/forms';
import { Alert, formatDateTime } from '@/components/ui';
import { api } from '@/lib/api';
import { currentWorkspace, getMe } from '@/lib/data';

export const metadata = { title: 'Members' };

export default async function WorkspacePage() {
  const [{ user }, workspace] = await Promise.all([getMe(), currentWorkspace()]);
  const { members, invites } = await api.members(workspace.id);
  const canManage = workspace.role === 'owner' || user.superAdmin;
  const owners = members.filter((m) => m.role === 'owner').length;

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <h1>{workspace.name}</h1>
          <p>
            Everyone here sees and manages this workspace&apos;s containers. Owners also manage members.
            {workspace.role === null && ' You see it as super-admin.'}
          </p>
        </div>
      </div>

      {canManage && (
        <section className="card">
          <div className="card-head">
            <h2>Invite someone</h2>
          </div>
          <div className="card-body stack">
            <AddMemberForm workspaceId={workspace.id} />
            <p className="small muted">
              People whose Google account has this address join at once. Anyone else gets an invite, which
              they accept by signing in with Google using that address. A password account alone cannot prove
              that an address is theirs.
            </p>
          </div>
        </section>
      )}

      <section className="card">
        <div className="card-head">
          <h2>Members</h2>
          <span className="small muted">{members.length}</span>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Person</th>
                <th>Role</th>
                <th>Last sign-in</th>
                <th className="num" aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {members.map((m) => {
                const self = m.userId === user.id;
                const lastOwner = m.role === 'owner' && owners === 1;
                return (
                  <tr key={m.userId}>
                    <td>
                      <div className="member">
                        <span className="avatar" aria-hidden="true">
                          {(m.name || m.email).slice(0, 1).toUpperCase()}
                        </span>
                        <div>
                          <strong>{m.name}</strong> {self && <span className="badge">You</span>}
                          <div className="small muted">{m.email}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className={`badge ${m.role === 'owner' ? 'badge-info' : ''}`}>
                        {m.role === 'owner' ? 'Owner' : 'Member'}
                      </span>
                    </td>
                    <td className="small text-2">
                      {m.lastLoginAt ? formatDateTime(m.lastLoginAt) : 'Never'}
                    </td>
                    <td className="num">
                      <div className="member-actions">
                        {canManage && !lastOwner && (
                          <InlineAction
                            action={changeRole.bind(
                              null,
                              workspace.id,
                              m.userId,
                              m.role === 'owner' ? 'member' : 'owner',
                            )}
                            label={m.role === 'owner' ? 'Make member' : 'Make owner'}
                            pending="Saving…"
                          />
                        )}
                        {(canManage || self) && !lastOwner && (
                          <InlineAction
                            action={removeMember.bind(null, workspace.id, m.userId)}
                            label={self ? 'Leave' : 'Remove'}
                            pending={self ? 'Leaving…' : 'Removing…'}
                            confirm={
                              self
                                ? `Leave ${workspace.name}? You lose access to its containers.`
                                : `Remove ${m.email} from ${workspace.name}?`
                            }
                            danger
                          />
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {invites.length > 0 && (
        <section className="card">
          <div className="card-head">
            <h2>Pending invites</h2>
            <span className="small muted">{invites.length}</span>
          </div>
          <div className="table-wrap">
            <table className="table">
              <tbody>
                {invites.map((i) => (
                  <tr key={i.id}>
                    <td>{i.email}</td>
                    <td>
                      <span className="badge">{i.role === 'owner' ? 'Owner' : 'Member'}</span>
                    </td>
                    <td className="small text-2">Invited {formatDateTime(i.createdAt)}</td>
                    <td className="num">
                      {canManage && (
                        <InlineAction
                          action={cancelInvite.bind(null, workspace.id, i.id)}
                          label="Cancel invite"
                          pending="Cancelling…"
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {canManage ? (
        <section className="card">
          <div className="card-head">
            <h2>Workspace name</h2>
          </div>
          <div className="card-body">
            <RenameWorkspaceForm workspaceId={workspace.id} name={workspace.name} />
          </div>
        </section>
      ) : (
        <Alert tone="info">Only owners can invite people or rename the workspace.</Alert>
      )}
    </div>
  );
}
