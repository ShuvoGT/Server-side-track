import { CreateWorkspaceForm } from '@/components/forms';

export const metadata = { title: 'New workspace' };

export default function NewWorkspacePage() {
  return (
    <div style={{ maxWidth: 560, margin: '0 auto' }}>
      <div className="page-head">
        <div>
          <h1>New workspace</h1>
          <p>A separate space with its own containers and members, e.g. for a client.</p>
        </div>
      </div>
      <CreateWorkspaceForm />
    </div>
  );
}
