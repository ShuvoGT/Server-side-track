'use client';

import Link from 'next/link';
import { useRef } from 'react';
import { ThemeToggle } from '@/components/theme';

/** The landing page's menu on narrow screens: section links, sign-in and the theme switch. */
export function LandingMenu() {
  const menu = useRef<HTMLDetailsElement>(null);
  const close = () => menu.current?.removeAttribute('open');
  return (
    <details ref={menu} className="lp-menu">
      <summary aria-label="Menu">
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </summary>
      <div className="lp-menu-panel">
        <a href="#features" onClick={close}>
          Features
        </a>
        <a href="#how" onClick={close}>
          How it works
        </a>
        <a href="#faq" onClick={close}>
          FAQ
        </a>
        <Link href="/login" onClick={close}>
          Sign in
        </Link>
        <div className="lp-menu-theme">
          <span>Theme</span>
          <ThemeToggle />
        </div>
      </div>
    </details>
  );
}
