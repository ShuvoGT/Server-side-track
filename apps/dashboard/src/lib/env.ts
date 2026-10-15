import 'server-only';
import { z } from 'zod';

const optional = z.preprocess((v) => (v === '' ? undefined : v), z.string().optional());

const schema = z.object({
  /** The control plane API's public port. */
  API_URL: z.url().default('http://localhost:3000'),
  ADMIN_API_KEY: z.string().min(24),
  SESSION_SECRET: z.string().min(32),
  /** The dashboard's public address, for Google's redirect back after sign-in. */
  DASHBOARD_URL: z.url().default('http://localhost:3100'),
  /** OAuth client from Google Cloud Console (APIs & Services › Credentials). Without it, Google sign-in is hidden. */
  GOOGLE_CLIENT_ID: optional,
  GOOGLE_CLIENT_SECRET: optional,
});

let cached: z.infer<typeof schema> | undefined;

/** Read lazily so `next build` works without the runtime secrets. */
export function env() {
  if (!cached) {
    const result = schema.safeParse(process.env);
    if (!result.success)
      throw new Error(`Invalid dashboard configuration:\n${z.prettifyError(result.error)}`);
    cached = result.data;
  }
  return cached;
}

export const googleEnabled = () => Boolean(env().GOOGLE_CLIENT_ID && env().GOOGLE_CLIENT_SECRET);
