import path from 'node:path';
import type { NextConfig } from 'next';

const config: NextConfig = {
  // Self-contained server bundle for the Docker image. Off elsewhere: on Windows it needs symlink rights.
  output: process.env.NEXT_STANDALONE === '1' ? 'standalone' : undefined,
  // The monorepo root, so the standalone build includes workspace packages.
  outputFileTracingRoot: path.join(import.meta.dirname, '../..'),
  poweredByHeader: false,
  devIndicators: false,
  // The repository's own ESLint run covers this app.
  eslint: { ignoreDuringBuilds: true },
};

export default config;
