'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CopyButton } from './client';

/** Second-level labels under which a registrable domain takes three labels, e.g. shop.co.uk. */
const SECOND_LEVEL = new Set(['co', 'com', 'net', 'org', 'ac', 'gov', 'edu']);

/** The DNS zone a hostname lives in and the record name inside it: ss.shop.com → shop.com + "ss". */
export function splitHostname(hostname: string): { zone: string; name: string } {
  const labels = hostname.split('.');
  const take = labels.length >= 3 && labels.at(-1)!.length === 2 && SECOND_LEVEL.has(labels.at(-2)!) ? 3 : 2;
  const zone = labels.slice(-take).join('.');
  const name = labels.slice(0, -take).join('.') || '@';
  return { zone, name };
}

type Provider = 'cloudflare' | 'godaddy' | 'namecheap' | 'other';

const PROVIDERS: { id: Provider; label: string }[] = [
  { id: 'cloudflare', label: 'Cloudflare' },
  { id: 'godaddy', label: 'GoDaddy' },
  { id: 'namecheap', label: 'Namecheap' },
  { id: 'other', label: 'Other / cPanel' },
];

function Value({ text }: { text: string }) {
  return (
    <span className="dns-value">
      <code>{text}</code>
      <CopyButton text={text} />
    </span>
  );
}

function RecordTable({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <div className="table-wrap card" style={{ boxShadow: 'none' }}>
      <table className="table table-compact">
        <tbody>
          {rows.map(([field, value]) => (
            <tr key={field}>
              <th scope="row">{field}</th>
              <td>{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Step-by-step instructions for creating the tracking domain's CNAME at common DNS providers, in a dialog. Opens
 * by itself the first time a pending domain is shown (remembered per domain in this browser).
 */
export function DnsGuide({
  domainId,
  hostname,
  target,
}: {
  domainId: string;
  hostname: string;
  target: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [provider, setProvider] = useState<Provider>('cloudflare');
  const { zone, name } = splitHostname(hostname);

  useEffect(() => {
    const key = `opentrack.dnsGuide.${domainId}`;
    try {
      if (localStorage.getItem(key)) return;
      localStorage.setItem(key, '1');
    } catch {
      return; // Storage blocked: never open by itself.
    }
    dialog.current?.showModal();
  }, [domainId]);

  const nameValue = <Value text={name} />;
  const targetValue = <Value text={target} />;

  return (
    <>
      <button type="button" className="btn btn-sm" onClick={() => dialog.current?.showModal()}>
        How to add this record
      </button>
      <dialog
        ref={dialog}
        className="dns-guide"
        aria-labelledby={`dns-guide-${domainId}`}
        onClick={(e) => {
          if (e.target === dialog.current) dialog.current.close();
        }}
      >
        <div className="dns-guide-inner">
          <div className="dns-guide-head">
            <div>
              <h2 id={`dns-guide-${domainId}`}>Point {hostname} at OpenTrack</h2>
              <p className="text-2 small">
                Create one CNAME record in the DNS of <strong>{zone}</strong>, then press Verify.
              </p>
            </div>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              aria-label="Close"
              onClick={() => dialog.current?.close()}
            >
              ✕
            </button>
          </div>

          <div className="dns-tabs" role="tablist" aria-label="DNS provider">
            {PROVIDERS.map((p) => (
              <button
                key={p.id}
                type="button"
                role="tab"
                aria-selected={provider === p.id}
                className={provider === p.id ? 'active' : ''}
                onClick={() => setProvider(p.id)}
              >
                {p.label}
              </button>
            ))}
          </div>

          {provider === 'cloudflare' && (
            <ol className="dns-steps">
              <li>
                Open{' '}
                <a href="https://dash.cloudflare.com" target="_blank" rel="noreferrer">
                  dash.cloudflare.com
                </a>{' '}
                → choose <strong>{zone}</strong> → <strong>DNS → Records → Add record</strong>.
              </li>
              <li>
                Fill in:
                <RecordTable
                  rows={[
                    ['Type', <code key="t">CNAME</code>],
                    ['Name', nameValue],
                    ['Target', targetValue],
                    [
                      'Proxy status',
                      <span key="p">
                        <strong>DNS only</strong> (grey cloud): click the orange cloud to turn it grey
                      </span>,
                    ],
                    ['TTL', 'Auto'],
                  ]}
                />
              </li>
              <li>
                <strong>Save</strong>, wait 1–2 minutes, then press <strong>Verify</strong>.
              </li>
            </ol>
          )}

          {provider === 'godaddy' && (
            <ol className="dns-steps">
              <li>
                Open{' '}
                <a href="https://dcc.godaddy.com/control/portfolio" target="_blank" rel="noreferrer">
                  GoDaddy Domain Portfolio
                </a>{' '}
                → <strong>{zone}</strong> → <strong>DNS</strong> → <strong>Add New Record</strong>.
              </li>
              <li>
                Fill in:
                <RecordTable
                  rows={[
                    ['Type', <code key="t">CNAME</code>],
                    ['Name', nameValue],
                    ['Value', targetValue],
                    ['TTL', 'Default (1 hour)'],
                  ]}
                />
              </li>
              <li>
                <strong>Save</strong>, wait a few minutes, then press <strong>Verify</strong>.
              </li>
            </ol>
          )}

          {provider === 'namecheap' && (
            <ol className="dns-steps">
              <li>
                Open{' '}
                <a href="https://ap.www.namecheap.com/domains/list/" target="_blank" rel="noreferrer">
                  Namecheap Domain List
                </a>{' '}
                → <strong>Manage</strong> next to <strong>{zone}</strong> → <strong>Advanced DNS</strong> →{' '}
                <strong>Add New Record</strong>.
              </li>
              <li>
                Fill in:
                <RecordTable
                  rows={[
                    ['Type', <code key="t">CNAME Record</code>],
                    ['Host', nameValue],
                    ['Value', targetValue],
                    ['TTL', 'Automatic'],
                  ]}
                />
              </li>
              <li>
                Click the <strong>✓</strong> to save, wait a few minutes, then press <strong>Verify</strong>.
              </li>
            </ol>
          )}

          {provider === 'other' && (
            <ol className="dns-steps">
              <li>
                Sign in where the DNS of <strong>{zone}</strong> is managed (your registrar, hosting panel or
                cPanel → <strong>Zone Editor</strong>) and add a record.
              </li>
              <li>
                Fill in:
                <RecordTable
                  rows={[
                    ['Type', <code key="t">CNAME</code>],
                    ['Name / Host', nameValue],
                    ['Value / Target / Points to', targetValue],
                    ['TTL', 'Default'],
                  ]}
                />
                <p className="small muted">
                  Some panels want the full name instead: <code>{hostname}</code> (some with a dot at the end,{' '}
                  <code>{hostname}.</code>).
                </p>
              </li>
              <li>
                Save, wait a few minutes, then press <strong>Verify</strong>.
              </li>
            </ol>
          )}

          <div className="dns-guide-notes small text-2">
            <p>
              <strong>Use only the subdomain.</strong> Never change the record of {zone} itself; that takes
              your website down.
            </p>
            <p>
              Delete any older record named <code>{name}</code> first: a name can have only one CNAME.
            </p>
          </div>

          <div className="dns-guide-foot">
            <button type="button" className="btn btn-primary" onClick={() => dialog.current?.close()}>
              Done
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
