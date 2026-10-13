import Bowser from 'bowser';

export interface DeviceInfo {
  browser: string | null;
  browserVersion: string | null;
  os: string | null;
  osVersion: string | null;
  /** desktop, mobile, tablet or tv. */
  type: string | null;
}

/** Parses a User-Agent with bowser (MIT licensed; ua-parser-js 2.x is AGPL, see the technology stack). */
export function parseDevice(userAgent: string | undefined): DeviceInfo {
  if (!userAgent) return { browser: null, browserVersion: null, os: null, osVersion: null, type: null };
  const result = Bowser.parse(userAgent);
  return {
    browser: result.browser.name ?? null,
    browserVersion: result.browser.version ?? null,
    os: result.os.name ?? null,
    osVersion: result.os.version ?? null,
    type: result.platform.type ?? null,
  };
}
