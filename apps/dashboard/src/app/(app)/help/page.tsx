import type { ReactNode } from 'react';

export const metadata = { title: 'User manual' };

const SECTIONS = [
  ['flow', 'How it works'],
  ['account', '1. Account and sign-in'],
  ['workspace', '2. Workspace and team'],
  ['container', '3. Create a container'],
  ['domain', '4. Tracking domain'],
  ['gtm', '5. Google Tag Manager'],
  ['website', '6. Website snippet'],
  ['check', '7. Check that it works'],
  ['problems', 'Troubleshooting'],
  ['checklist', 'Checklist'],
] as const;

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="card manual-section">
      <div className="card-head">
        <h2>{title}</h2>
      </div>
      <div className="card-body manual-body">{children}</div>
    </section>
  );
}

function Shot({ src, alt, caption }: { src: string; alt: string; caption: string }) {
  return (
    <figure className="manual-shot">
      <img src={`/manual/${src}`} alt={alt} loading="lazy" />
      <figcaption>{caption}</figcaption>
    </figure>
  );
}

export default function HelpPage() {
  return (
    <div className="manual">
      <div className="page-head">
        <div>
          <h1>User manual</h1>
          <p>
            From a new account to a website whose Google Analytics data flows through your own tracking
            domain. Follow the steps in order; most setups take 30–45 minutes.
          </p>
        </div>
      </div>

      <nav className="card manual-toc" aria-label="Contents">
        {SECTIONS.map(([id, title]) => (
          <a key={id} href={`#${id}`}>
            {title}
          </a>
        ))}
      </nav>

      <Section id="flow" title="How it works">
        <div
          className="manual-flow"
          role="img"
          aria-label="Website, tracking domain, tagging server, vendors"
        >
          <div>
            <strong>Your website</strong>
            <span>GTM web container</span>
          </div>
          <i aria-hidden="true">→</i>
          <div className="accent">
            <strong>ss.yoursite.com</strong>
            <span>your tracking domain</span>
          </div>
          <i aria-hidden="true">→</i>
          <div>
            <strong>Tagging server</strong>
            <span>GTM server container</span>
          </div>
          <i aria-hidden="true">→</i>
          <div>
            <strong>GA4, Ads, Meta</strong>
            <span>your tags send on</span>
          </div>
        </div>
        <p>
          The browser sends tracking hits to your own subdomain instead of Google. OpenTrack runs your GTM
          server container there, and its tags forward the data to GA4 and other vendors.
        </p>
      </Section>

      <Section id="account" title="1. Account and sign-in">
        <ol>
          <li>
            Click <strong>Create an account</strong>. Enter your name, email, country, phone number and a
            password (at least 10 characters), or click <strong>Continue with Google</strong>.
          </li>
          <li>
            Your account waits for approval. You see a waiting page, and the platform admin gets an email.
          </li>
          <li>When you are approved, you get an email titled “Your account is approved”. Sign in again.</li>
          <li>
            Recommended: <strong>Settings → Security</strong> → turn on <strong>two-step verification</strong>{' '}
            with an authenticator app, and keep the recovery codes somewhere safe.
          </li>
        </ol>
        <p>
          Forgot your password? Click <strong>Forgot password?</strong> on the sign-in page; the emailed link
          works for one hour. Invited by a teammate? Sign in with the invited address: invited accounts are
          approved automatically.
        </p>
      </Section>

      <Section id="workspace" title="2. Workspace and team">
        <p>
          A <strong>workspace</strong> holds containers and the people who manage them, for example one per
          brand or client.
        </p>
        <ul>
          <li>
            <strong>Switch or create:</strong> the <strong>Workspace</strong> menu at the top of the sidebar.
          </li>
          <li>
            <strong>Invite:</strong> <strong>Members</strong> → email → <strong>Owner</strong> or{' '}
            <strong>Member</strong> → <strong>Add</strong>. They get an email invite.
          </li>
        </ul>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Role</th>
                <th>Can do</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Owner</td>
                <td>Everything: containers, domains, members, rename or delete the workspace</td>
              </tr>
              <tr>
                <td>Member</td>
                <td>Work with containers and domains; cannot manage members or delete the workspace</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Section>

      <Section id="container" title="3. Create a container">
        <p>
          One container = one <strong>GTM server container</strong>. The platform starts its tagging server
          and GTM Preview server for you.
        </p>
        <h3>Get the Container Config from GTM</h3>
        <ol>
          <li>
            Open <a href="https://tagmanager.google.com">tagmanager.google.com</a> and choose your{' '}
            <strong>Server</strong> container (or create one with target platform <strong>Server</strong>).
          </li>
          <li>
            <strong>Admin → Container Settings</strong> → <strong>Manually provision tagging server</strong> →
            copy the <strong>Container Config</strong> (a long text starting like <code>aWQ9R1RN…</code>).
          </li>
        </ol>
        <h3>Create it here</h3>
        <ol>
          <li>
            Sidebar → <strong>New container</strong>.
          </li>
          <li>Name it, e.g. Shop-production, and paste the Container Config.</li>
          <li>
            Optional: your <strong>web</strong> GTM ID (e.g. <code>GTM-ABC1234</code>), needed for the
            dashboard snippet; it can also be set later under <strong>Power-ups</strong>.
          </li>
          <li>
            <strong>Create container</strong>. It shows <strong>Provisioning</strong> for about a minute, then{' '}
            <strong>Active</strong>. <strong>Failed</strong> shows the reason and a{' '}
            <strong>Provision again</strong> button.
          </li>
        </ol>
      </Section>

      <Section id="domain" title="4. Tracking domain">
        <p>
          Use a <strong>subdomain of your website</strong>, e.g. <code>ss.yoursite.com</code>. Never the main
          domain: pointing it here takes your website down.
        </p>
        <ol>
          <li>
            Container → <strong>Domains</strong> → type <code>ss.yoursite.com</code> →{' '}
            <strong>Add domain</strong>.
          </li>
        </ol>
        <Shot
          src="domain-add.png"
          alt="Tracking domain field with the Add domain button"
          caption="Add the domain"
        />
        <ol start={2}>
          <li>At your DNS provider, create the record the page shows:</li>
        </ol>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Type</th>
                <th>Name</th>
                <th>Value</th>
                <th>Cloudflare proxy</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>CNAME</td>
                <td className="mono">ss</td>
                <td className="mono">sst.ibos.agency</td>
                <td>
                  <strong>DNS only</strong> (grey cloud)
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <Shot
          src="domain-dns.png"
          alt="A domain waiting for DNS, with the CNAME record to create"
          caption="Waiting for DNS: the page shows the exact record to create"
        />
        <ol start={3}>
          <li>
            Wait 1–2 minutes, then click <strong>Verify</strong>. The HTTPS certificate follows within a
            minute or two.
          </li>
        </ol>
        <Shot src="domain-verified.png" alt="A verified tracking domain" caption="Verified" />
        <ul>
          <li>
            In Cloudflare type only <code>ss</code> as the Name. An orange (proxied) cloud stops the
            certificate.
          </li>
          <li>
            Delete any older record named <code>ss</code> first. An A record to <code>103.197.205.34</code>{' '}
            also works if a CNAME is impossible, but must change if the platform&apos;s address changes.
          </li>
        </ul>
      </Section>

      <Section id="gtm" title="5. Google Tag Manager">
        <p>
          Every change below needs <strong>Submit → Publish</strong>. Save or Preview alone does nothing for
          real visitors.
        </p>
        <h3>Server container</h3>
        <ol>
          <li>
            <strong>Admin → Container Settings → Server container URLs:</strong> add{' '}
            <code>https://ss.yoursite.com</code>.
          </li>
          <li>
            <strong>Clients → New → Google Tag Manager: Web Container.</strong> Allowed Container IDs: your
            web container ID. Tick <strong>Automatically serve all dependent Google scripts</strong>.
          </li>
          <li>
            Check that a <strong>GA4</strong> client exists.
          </li>
          <li>
            <strong>Tags → New → Google Analytics: GA4</strong>, trigger{' '}
            <strong>Custom → Client Name equals GA4</strong>.
          </li>
          <li>
            <strong>Submit → Publish.</strong>
          </li>
        </ol>
        <Shot
          src="gtm-web-container-client.png"
          alt="GTM Web Container client with an allowed container ID"
          caption="Web Container client. “Added in this workspace” means it is not published yet."
        />
        <h3>Web container</h3>
        <ol>
          <li>
            Open the <strong>Google tag</strong> that carries your GA4 ID (<code>G-…</code>).
          </li>
          <li>
            <strong>Configuration settings → Add parameter:</strong> <code>server_container_url</code> ={' '}
            <code>https://ss.yoursite.com</code>.
          </li>
          <li>
            Trigger <strong>Initialization – All Pages</strong> → <strong>Submit → Publish</strong>.
          </li>
        </ol>
        <div className="alert alert-info">
          One Google tag can send to several IDs. In Tag Assistant, a tag&apos;s{' '}
          <strong>Destination IDs</strong> list them; put <code>server_container_url</code> on the Google tag
          whose destinations include your GA4 ID.
        </div>
        <Shot
          src="tag-assistant-hits.png"
          alt="Tag Assistant showing a Google tag with its destination IDs"
          caption="Tag Assistant: this Google tag sends to an Ads ID and a GA4 ID"
        />
      </Section>

      <Section id="website" title="6. Website snippet">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th />
                <th>Keep Google&apos;s GTM snippet</th>
                <th>Dashboard snippet (recommended)</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>GA4 data through your domain</td>
                <td>Yes</td>
                <td>Yes</td>
              </tr>
              <tr>
                <td>GTM loads from</td>
                <td className="mono">googletagmanager.com</td>
                <td className="mono">ss.yoursite.com</td>
              </tr>
              <tr>
                <td>Visitors with ad blockers</td>
                <td>Often blocked: no data</td>
                <td>Usually not blocked</td>
              </tr>
              <tr>
                <td>Web container ID in Power-ups</td>
                <td>Not needed</td>
                <td>Needed</td>
              </tr>
            </tbody>
          </table>
        </div>
        <h3>Use the dashboard snippet</h3>
        <ol>
          <li>
            Container → <strong>Power-ups</strong> → set the <strong>Web container ID</strong>; keep{' '}
            <strong>Custom loader</strong> on.
          </li>
          <li>
            Container → <strong>Overview</strong> → copy the GTM snippet.
          </li>
          <li>
            Replace Google&apos;s GTM snippet in your website&apos;s <code>&lt;head&gt;</code> with it.
          </li>
        </ol>
        <h3>Clean up the page</h3>
        <ul>
          <li>
            Remove other Google tags with the same GA4 ID: hard-coded <code>gtag.js</code>,{' '}
            <strong>Site Kit by Google</strong>, <strong>GTM4WP</strong> (container code Off), GA plugins.
          </li>
          <li>
            Exclude <code>ss.yoursite.com</code> and <code>gtm.start</code> from “delay JS” in LiteSpeed
            Cache, Airlift, WP Rocket and similar.
          </li>
          <li>Purge every cache after each change.</li>
        </ul>
      </Section>

      <Section id="check" title="7. Check that it works">
        <h3>Logs</h3>
        <ol>
          <li>Open your website in an incognito window and scroll a little.</li>
          <li>
            Container → <strong>Logs</strong> → <strong>Event: page_view</strong> →{' '}
            <strong>Apply filters</strong>.
          </li>
          <li>
            Expect a <strong>Loader</strong> row (dashboard snippet) and <strong>Tracking</strong> rows for{' '}
            <code>/g/collect</code> with <code>page_view</code>.
          </li>
        </ol>
        <Shot
          src="logs.png"
          alt="Event logs with loader and tracking rows"
          caption="Logs with events arriving"
        />
        <h3>GTM Preview</h3>
        <ol>
          <li>
            In the server container click <strong>Preview</strong> and keep that tab open.
          </li>
          <li>
            In the <strong>same browser</strong> (not incognito), open your website. Each request appears;
            click one to see the tags that fired.
          </li>
        </ol>
        <Shot
          src="gtm-server-preview.png"
          alt="Server container preview with a page_view and a GA4 tag that succeeded"
          caption="Server preview: page_view arrived and the GA4 tag succeeded"
        />
        <Shot
          src="tag-assistant.png"
          alt="Tag Assistant for the web container showing fired tags"
          caption="Web container preview (Tag Assistant): the GA4 tags fire"
        />
        <h3>Browser DevTools</h3>
        <p>
          F12 → <strong>Network</strong> → filter <code>g/collect</code> → reload. Requests must go to{' '}
          <code>ss.yoursite.com</code>. Requests to <code>google-analytics.com</code> mean a Google tag still
          lacks <code>server_container_url</code>, or a second Google tag is on the page.
        </p>
      </Section>

      <Section id="problems" title="Troubleshooting">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>What you see</th>
                <th>Why</th>
                <th>Fix</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Domain stays Waiting for DNS</td>
                <td>CNAME missing, misspelled, or on the main domain</td>
                <td>
                  <code>ss</code> CNAME <code>sst.ibos.agency</code> (DNS only), wait, Verify
                </td>
              </tr>
              <tr>
                <td>Certificate warning on the tracking domain</td>
                <td>Certificate still being issued, or orange Cloudflare cloud</td>
                <td>Wait 2 minutes; set DNS only</td>
              </tr>
              <tr>
                <td>Container Failed</td>
                <td>Setup on the platform was interrupted</td>
                <td>Provision again; if it repeats, send the message to support</td>
              </tr>
              <tr>
                <td>Loader answers 400</td>
                <td>No web container ID in Power-ups, or the Web Container client is not published</td>
                <td>Set the ID; add the client and Publish</td>
              </tr>
              <tr>
                <td>Loader works but no page_view</td>
                <td>Google tag lacks server_container_url, or not published</td>
                <td>Step 5, web container</td>
              </tr>
              <tr>
                <td>page_view only while GTM Preview is open</td>
                <td>Changes exist only in the workspace</td>
                <td>Submit → Publish</td>
              </tr>
              <tr>
                <td>Data still goes to google-analytics.com</td>
                <td>A second Google tag on the page</td>
                <td>Remove it (Step 6)</td>
              </tr>
              <tr>
                <td>Events only after scrolling</td>
                <td>A speed plugin delays the snippet</td>
                <td>Exclude it from delay JS</td>
              </tr>
              <tr>
                <td>/gtm/get_memo rows with 502</td>
                <td>A GTM Preview tab is open and waiting</td>
                <td>Harmless</td>
              </tr>
              <tr>
                <td>/wp-login.php or /healthy marked bot</td>
                <td>Bots and uptime checks</td>
                <td>Harmless</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Section>

      <Section id="checklist" title="Checklist for each new website">
        <ul className="manual-checklist">
          <li>Container created and Active</li>
          <li>
            <code>ss</code> CNAME <code>sst.ibos.agency</code> (DNS only), domain Verified
          </li>
          <li>Server container: server URL, Web Container client, GA4 client and tag, Published</li>
          <li>Web container: server_container_url on the Google tag with your GA4 ID, Published</li>
          <li>Power-ups: web container ID (dashboard snippet)</li>
          <li>
            Website: snippet in place, duplicate Google tags removed, delay-JS exclusions, caches purged
          </li>
          <li>Logs show page_view from an incognito visit</li>
        </ul>
      </Section>
    </div>
  );
}
