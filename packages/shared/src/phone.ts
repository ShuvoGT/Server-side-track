/** Phone numbers on accounts: an ISO 3166 country plus the national number. */

/** [ISO 3166 code, international dialing code], Bangladesh first. */
export const DIAL_CODES: readonly (readonly [string, string])[] = [
  ['BD', '880'],
  ['AE', '971'],
  ['AF', '93'],
  ['AU', '61'],
  ['BH', '973'],
  ['BR', '55'],
  ['BT', '975'],
  ['CA', '1'],
  ['CH', '41'],
  ['CN', '86'],
  ['DE', '49'],
  ['DK', '45'],
  ['EG', '20'],
  ['ES', '34'],
  ['FR', '33'],
  ['GB', '44'],
  ['HK', '852'],
  ['ID', '62'],
  ['IE', '353'],
  ['IN', '91'],
  ['IT', '39'],
  ['JP', '81'],
  ['KE', '254'],
  ['KR', '82'],
  ['KW', '965'],
  ['LK', '94'],
  ['MM', '95'],
  ['MV', '960'],
  ['MY', '60'],
  ['NG', '234'],
  ['NL', '31'],
  ['NO', '47'],
  ['NP', '977'],
  ['NZ', '64'],
  ['OM', '968'],
  ['PH', '63'],
  ['PK', '92'],
  ['PL', '48'],
  ['PT', '351'],
  ['QA', '974'],
  ['SA', '966'],
  ['SE', '46'],
  ['SG', '65'],
  ['TH', '66'],
  ['TR', '90'],
  ['US', '1'],
  ['VN', '84'],
  ['ZA', '27'],
];

const DIAL = new Map(DIAL_CODES);

/** "+880 1711421236", or the bare number when the country is unknown; null without a number. */
export function formatPhone(
  country: string | null | undefined,
  phone: string | null | undefined,
): string | null {
  if (!phone) return null;
  const dial = country ? DIAL.get(country) : undefined;
  return dial ? `+${dial} ${phone.replace(/^0+/, '')}` : phone;
}
