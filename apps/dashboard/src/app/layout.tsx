import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { themeBootScript } from '@/components/theme';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'OpenTrack', template: '%s · OpenTrack' },
  description: 'Server-side tracking: containers, domains, power-ups, logs and usage.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // The boot script sets data-theme before hydration.
    <html lang="en" data-theme="light" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
