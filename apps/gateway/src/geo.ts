import maxmind, { type CityResponse } from 'maxmind';

export interface GeoInfo {
  country: string | null;
  region: string | null;
  city: string | null;
}

export type GeoLookup = (ip: string) => GeoInfo | null;

/** Opens a MaxMind GeoLite2 City database (needs a MaxMind account and licence key to download). */
export async function openGeoLookup(path: string): Promise<GeoLookup> {
  const reader = await maxmind.open<CityResponse>(path);
  return (ip) => {
    let result: CityResponse | null;
    try {
      result = reader.get(ip);
    } catch {
      return null;
    }
    if (!result) return null;
    return {
      country: result.country?.iso_code ?? null,
      region: result.subdivisions?.[0]?.iso_code ?? null,
      city: result.city?.names?.en ?? null,
    };
  };
}
