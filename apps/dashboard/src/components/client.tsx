'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { useFormStatus } from 'react-dom';

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // Clipboard blocked (insecure context); the text is still selectable.
        }
      }}
    >
      {copied ? 'Copied' : label}
    </button>
  );
}

export function CodeBlock({ code }: { code: string }) {
  return (
    <div className="code">
      <code>{code}</code>
      <CopyButton text={code} />
    </div>
  );
}

/** Submit button that disables itself and shows progress while its form's server action runs. */
export function SubmitButton({
  children,
  pending,
  className = 'btn btn-primary',
  ...rest
}: {
  children: ReactNode;
  pending?: string;
  className?: string;
  name?: string;
  value?: string;
  disabled?: boolean;
}) {
  const status = useFormStatus();
  return (
    <button type="submit" className={className} disabled={status.pending || rest.disabled} {...rest}>
      {status.pending ? (pending ?? 'Working…') : children}
    </button>
  );
}

/** Navigation link that marks itself as current. `exact` for index routes. */
export function NavLink({ href, children, exact }: { href: string; children: ReactNode; exact?: boolean }) {
  const pathname = usePathname();
  const active = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link href={href} aria-current={active ? 'page' : undefined}>
      {children}
    </Link>
  );
}

/** Re-renders the page from the server every few seconds while `active`, e.g. while a container provisions. */
export function AutoRefresh({ active, intervalMs = 4000 }: { active: boolean; intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(timer);
  }, [active, intervalMs, router]);
  return null;
}
