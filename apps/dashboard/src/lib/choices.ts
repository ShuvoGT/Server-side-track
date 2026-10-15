/** Options for the account settings forms. */

export const CURRENCIES: { code: string; symbol: string }[] = [
  { code: 'BDT', symbol: '৳' },
  { code: 'USD', symbol: '$' },
  { code: 'EUR', symbol: '€' },
  { code: 'GBP', symbol: '£' },
  { code: 'INR', symbol: '₹' },
  { code: 'AED', symbol: 'د.إ' },
  { code: 'SAR', symbol: '﷼' },
  { code: 'MYR', symbol: 'RM' },
  { code: 'SGD', symbol: 'S$' },
  { code: 'AUD', symbol: 'A$' },
  { code: 'CAD', symbol: 'C$' },
  { code: 'JPY', symbol: '¥' },
  { code: 'PKR', symbol: '₨' },
  { code: 'NPR', symbol: 'रू' },
  { code: 'LKR', symbol: 'Rs' },
];

/** "(UTC+06:00) Asia/Dhaka", sorted by offset. */
export function timeZoneOptions(now = new Date()): { id: string; label: string }[] {
  const offsetMinutes = (tz: string) => {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' })
      .formatToParts(now)
      .find((p) => p.type === 'timeZoneName')?.value;
    const match = /GMT([+-])(\d{2}):(\d{2})/.exec(parts ?? '');
    return match ? (match[1] === '-' ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3])) : 0;
  };
  return Intl.supportedValuesOf('timeZone')
    .map((id) => {
      const minutes = offsetMinutes(id);
      const sign = minutes < 0 ? '-' : '+';
      const abs = Math.abs(minutes);
      const offset = `${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
      return { id, minutes, label: `(UTC${sign}${offset}) ${id}` };
    })
    .sort((a, b) => a.minutes - b.minutes || a.id.localeCompare(b.id))
    .map(({ id, label }) => ({ id, label }));
}
