import Link from 'next/link';
import { NewContainerForm } from '@/components/forms';
import { currentWorkspace } from '@/lib/data';

export const metadata = { title: 'New container' };

export default async function NewContainerPage() {
  const workspace = await currentWorkspace();
  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      <div className="crumbs">
        <Link href="/">Containers</Link> / New
      </div>
      <div className="page-head">
        <div>
          <h1>New container</h1>
          <p>Connect a GTM server container. Setup takes three steps.</p>
        </div>
      </div>
      <ol className="card checklist" style={{ marginBottom: 16 }}>
        <li>
          <span className="check-dot">1</span>
          <div>
            <h3>Create the container here</h3>
            <p>
              Paste the Container Config. The platform starts two tagging servers and one preview server for
              it.
            </p>
          </div>
        </li>
        <li>
          <span className="check-dot">2</span>
          <div>
            <h3>Add a tracking domain</h3>
            <p>
              A subdomain of the website, such as sst.example.com, pointed at the platform with a CNAME
              record.
            </p>
          </div>
        </li>
        <li>
          <span className="check-dot">3</span>
          <div>
            <h3>Install the snippet</h3>
            <p>
              Set the server container URL in GTM and replace the website&apos;s GTM snippet with the one the
              platform gives you.
            </p>
          </div>
        </li>
      </ol>
      <NewContainerForm workspaceName={workspace.name} />
    </div>
  );
}
