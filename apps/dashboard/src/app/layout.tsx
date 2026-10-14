import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { themeBootScript } from '@/components/theme';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Tracking Platform', template: '%s · Tracking Platform' },
  description: 'Server-side tracking: containers, domains, power-ups, logs and usage.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // The boot script sets data-theme before hydration.
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
