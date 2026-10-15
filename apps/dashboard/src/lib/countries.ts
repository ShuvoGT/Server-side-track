import 'server-only';
import { DIAL_CODES, formatPhone } from '@sst/shared';

export { formatPhone };

const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });

/** Countries for phone number fields; names come from the server so the browser renders the same text. */
export const COUNTRIES = DIAL_CODES.map(([code, dial]) => ({
  code,
  dial,
  name: regionNames.of(code) ?? code,
})).sort((a, b) => (a.code === 'BD' ? -1 : b.code === 'BD' ? 1 : a.name.localeCompare(b.name)));

export type Country = (typeof COUNTRIES)[number];
