import Link from 'next/link';
import { PasswordForm, PreferencesForm, ProfileForm, TwoFactorCard } from '@/components/settings';
import { timeZoneOptions } from '@/lib/choices';
import { COUNTRIES } from '@/lib/countries';
import { getMe } from '@/lib/data';

export const metadata = { title: 'Settings' };

const TABS = {
  profile: { label: 'Profile', icon: 'M20 21a8 8 0 0 0-16 0M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z' },
  preferences: {
    label: 'Preferences',
    icon: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4',
  },
  security: {
    label: 'Security',
    icon: 'M12 2 4 5v6c0 5 3.4 9.3 8 11 4.6-1.7 8-6 8-11V5l-8-3Zm-3 10 2 2 4-4',
  },
} as const;
type Tab = keyof typeof TABS;

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab: raw } = await searchParams;
  const tab: Tab = raw && raw in TABS ? (raw as Tab) : 'profile';
  const { user } = await getMe();

  return (
    <div className="stack settings" style={{ gap: 20 }}>
      <div>
        <h1>Settings</h1>
        <p className="text-2" style={{ marginTop: 4 }}>
          Manage your account, preferences, and security.
        </p>
      </div>

      <nav className="tabs settings-tabs" aria-label="Settings">
        {(Object.keys(TABS) as Tab[]).map((key) => (
          <Link key={key} href={`/settings?tab=${key}`} aria-current={tab === key ? 'page' : undefined}>
            <svg
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d={TABS[key].icon} />
            </svg>
            {TABS[key].label}
          </Link>
        ))}
      </nav>

      {tab === 'profile' && <ProfileForm user={user} countries={COUNTRIES} />}
      {tab === 'preferences' && <PreferencesForm user={user} timeZones={timeZoneOptions()} />}
      {tab === 'security' && (
        <>
          <PasswordForm hasPassword={user.hasPassword} />
          <TwoFactorCard user={user} />
        </>
      )}
    </div>
  );
}
