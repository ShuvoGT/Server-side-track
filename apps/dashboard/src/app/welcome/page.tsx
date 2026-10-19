import Link from 'next/link';
import { ThemeToggle } from '@/components/theme';
import './welcome.css';

export const metadata = {
  title: 'Server-side tracking on your own domain',
  description:
    'OpenTrack runs your Google Tag Manager server container on your own subdomain: first-party data, fewer blocked tags, live logs.',
};

const FEATURES = [
  {
    title: 'Your own tracking domain',
    text: 'Hits go to ss.yoursite.com instead of Google. First-party requests keep cookies longer and keep working where third-party scripts are blocked.',
  },
  {
    title: 'Managed GTM server containers',
    text: 'Paste the Container Config from Google Tag Manager. OpenTrack starts the tagging server and the Preview server for you, with HTTPS.',
  },
  {
    title: 'Ad-blocker resilient loader',
    text: 'The dashboard snippet loads gtm.js from your domain on a random path, so blocklists that match googletagmanager.com do not stop it.',
  },
  {
    title: 'Live event logs',
    text: 'Every request with its event, status, timing, device and bot flag, live every five seconds. Kept seven days, no IP addresses stored.',
  },
  {
    title: 'Power-ups',
    text: 'Geo and device headers, bot filtering, a cookie keeper and an anonymizer, switched on per container.',
  },
  {
    title: 'Teams and security',
    text: 'Workspaces with owners and members, invites, Google sign-in, two-step verification and approval of new accounts.',
  },
];

const STEPS = [
  [
    'Create a container',
    'Paste your GTM server Container Config. The tagging server is up in about a minute.',
  ],
  ['Point a subdomain', 'Add one CNAME, ss → sst.ibos.agency. The certificate is issued automatically.'],
  ['Connect GTM', 'Set server_container_url on your Google tag and publish both containers.'],
  ['Watch it work', 'Open your site and see page_view arrive in the live logs.'],
];

const FAQ = [
  [
    'Do I have to change the snippet on my website?',
    'No. Setting server_container_url on your Google tag is enough for GA4 to go through your domain. The dashboard snippet adds ad-blocker resilience on top.',
  ],
  [
    'Which tools can I send data to?',
    'Anything your GTM server container has tags for: GA4, Google Ads, Meta Conversions API and other vendors with server-side templates.',
  ],
  [
    'Does GTM Preview still work?',
    'Yes. Every container gets its own Preview server, so Tag Assistant shows server-side requests and fired tags as usual.',
  ],
  [
    'What happens to visitor IP addresses?',
    'The logs never store them. The anonymizer power-up can also shorten IPs and strip identifiers before your tags see them.',
  ],
];

function Mark() {
  return (
    <span className="lp-mark" aria-hidden="true">
      O
    </span>
  );
}

export default function WelcomePage() {
  return (
    <div className="lp">
      <header className="lp-nav">
        <div className="lp-wrap lp-nav-inner">
          <Link href="/" className="lp-brand">
            <Mark />
            OpenTrack
          </Link>
          <nav className="lp-links" aria-label="Main">
            <a href="#features">Features</a>
            <a href="#how">How it works</a>
            <a href="#faq">FAQ</a>
          </nav>
          <div className="lp-nav-actions">
            <ThemeToggle />
            <Link href="/login" className="btn btn-ghost">
              Sign in
            </Link>
            <Link href="/signup" className="btn btn-primary">
              Get started
            </Link>
          </div>
        </div>
      </header>

      <main>
        <section className="lp-hero">
          <div className="lp-wrap lp-hero-inner">
            <p className="lp-eyebrow">Server-side tagging, managed</p>
            <h1>
              Your analytics, on <span>your own domain</span>
            </h1>
            <p className="lp-lead">
              OpenTrack runs your Google Tag Manager server container on a subdomain of your website. GA4, Ads
              and Meta get complete, first-party data, and you see every request arrive live.
            </p>
            <div className="lp-cta">
              <Link href="/signup" className="btn btn-primary lp-btn-lg">
                Create an account
              </Link>
              <Link href="/login" className="btn lp-btn-lg">
                Sign in
              </Link>
            </div>
            <p className="lp-note">Google or email sign-in · set up in under an hour</p>

            <div
              className="lp-flow"
              role="img"
              aria-label="Website to your tracking domain to tagging server to GA4"
            >
              <div>
                <strong>Your website</strong>
                <span>GTM web container</span>
              </div>
              <i aria-hidden="true" />
              <div className="lp-flow-accent">
                <strong>ss.yoursite.com</strong>
                <span>your tracking domain</span>
              </div>
              <i aria-hidden="true" />
              <div>
                <strong>Tagging server</strong>
                <span>run by OpenTrack</span>
              </div>
              <i aria-hidden="true" />
              <div>
                <strong>GA4 · Ads · Meta</strong>
                <span>your tags send on</span>
              </div>
            </div>
          </div>
        </section>

        <section id="features" className="lp-section">
          <div className="lp-wrap">
            <h2>Everything server-side tagging needs, in one place</h2>
            <p className="lp-sub">
              No servers to run, no cloud account to wire up, no certificates to renew.
            </p>
            <div className="lp-grid">
              {FEATURES.map((f) => (
                <article key={f.title} className="lp-card">
                  <h3>{f.title}</h3>
                  <p>{f.text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="how" className="lp-section lp-section-alt">
          <div className="lp-wrap">
            <h2>Live in four steps</h2>
            <p className="lp-sub">
              Each step takes minutes; the user manual inside the dashboard shows every screen.
            </p>
            <ol className="lp-steps">
              {STEPS.map(([title, text], i) => (
                <li key={title}>
                  <span className="lp-step-n">{i + 1}</span>
                  <h3>{title}</h3>
                  <p>{text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="faq" className="lp-section">
          <div className="lp-wrap lp-narrow">
            <h2>Questions</h2>
            <div className="lp-faq">
              {FAQ.map(([q, a]) => (
                <details key={q}>
                  <summary>{q}</summary>
                  <p>{a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="lp-band">
          <div className="lp-wrap">
            <div className="lp-band-inner">
              <div>
                <h2>Start tracking on your own domain</h2>
                <p>Create an account; an admin approves it, then you add your first container.</p>
              </div>
              <Link href="/signup" className="btn btn-primary lp-btn-lg">
                Get started
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="lp-footer">
        <div className="lp-wrap lp-footer-inner">
          <span className="lp-brand">
            <Mark />
            OpenTrack
          </span>
          <span>Server-side tagging by iBOS</span>
          <nav aria-label="Footer">
            <Link href="/login">Sign in</Link>
            <Link href="/signup">Create account</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
