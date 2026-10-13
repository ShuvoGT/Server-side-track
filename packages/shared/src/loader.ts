import { randomBytes } from 'node:crypto';
import type { ContainerRoute } from './schemas.js';

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** A random script path such as /k3x9q2mf7a.js. Names that look like gtm.js are what blockers match on. */
export function generateLoaderPath(length = 10): string {
  const bytes = randomBytes(length);
  let slug = '';
  for (const byte of bytes) slug += ALPHABET[byte % ALPHABET.length];
  return `/${slug}.js`;
}

export interface LoaderRewrite {
  kind: 'gtm' | 'gtag';
  /** Path and query to request from the tagging server. */
  upstreamPath: string;
  /** True if the request is for a preview or environment build, which must not be cached. */
  cacheable: boolean;
}

const UNCACHEABLE_PARAMS = ['gtm_auth', 'gtm_preview', 'gtm_debug'];

/**
 * Maps a disguised loader path to the script URL the tagging server's Web Container client serves.
 * gtm.js always uses the configured web container id; gtag.js needs the measurement id from the query (?id=G-...).
 */
export function rewriteLoaderRequest(
  route: ContainerRoute,
  path: string,
  query: URLSearchParams,
): LoaderRewrite | null {
  if (!route.powerUps.customLoader.enabled) return null;
  let kind: LoaderRewrite['kind'];
  let upstream: string;
  const params = new URLSearchParams(query);
  if (path === route.loader.gtmPath) {
    if (!route.loader.webContainerId) return null;
    kind = 'gtm';
    upstream = '/gtm.js';
    params.set('id', route.loader.webContainerId);
  } else if (path === route.loader.gtagPath) {
    kind = 'gtag';
    upstream = '/gtag/js';
    const id = params.get('id');
    if (!id || !/^(G|AW|DC|GT)-[A-Z0-9]{4,16}$/.test(id)) return null;
  } else {
    return null;
  }
  const cacheable = !UNCACHEABLE_PARAMS.some((name) => params.has(name));
  return { kind, upstreamPath: `${upstream}?${params.toString()}`, cacheable };
}

/** The GTM head snippet for a website, loading gtm.js through the custom loader path on the tracking domain. */
export function gtmSnippet(trackingHost: string, route: Pick<ContainerRoute, 'loader'>): string {
  const src = `https://${trackingHost}${route.loader.gtmPath}`;
  return (
    `<script>(function(w,d,s,l){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});` +
    `var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'l='+l:'';j.async=true;` +
    `j.src='${src}'+(dl?'?'+dl:'');f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer');</script>`
  );
}
