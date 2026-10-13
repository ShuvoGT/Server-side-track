import 'server-only';
import { z } from 'zod';

const schema = z.object({
  /** The control plane API's public port. */
  API_URL: z.url().default('http://localhost:3000'),
  ADMIN_API_KEY: z.string().min(24),
  DASHBOARD_PASSWORD: z.string().min(8),
  SESSION_SECRET: z.string().min(32),
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
