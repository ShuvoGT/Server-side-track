import { createTransport } from 'nodemailer';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

/** SMTP through nodemailer, e.g. smtps://user:password@smtp.example.com:465. */
export function smtpMailer(smtpUrl: string, from: string): Mailer {
  const transport = createTransport(smtpUrl);
  return {
    async send(message) {
      await transport.sendMail({ from, ...message });
    },
  };
}

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

/**
 * Tells someone they were added to or invited into a workspace. An invite is accepted by signing in with Google
 * using the invited address (or by setting a password through a reset link, which proves the address too).
 */
export function workspaceInviteMail(input: {
  to: string;
  inviter: string;
  workspace: string;
  role: 'owner' | 'member';
  added: boolean;
  link: string;
}): MailMessage {
  const role = input.role === 'owner' ? 'an owner' : 'a member';
  const what = input.added
    ? `${input.inviter} added you to the workspace "${input.workspace}" on OpenTrack as ${role}.`
    : `${input.inviter} invited you to the workspace "${input.workspace}" on OpenTrack as ${role}.`;
  const how = input.added
    ? 'Sign in to see its containers.'
    : `To join, sign in with Google using this address (${input.to}). The workspace appears as soon as you are in.`;
  return {
    to: input.to,
    subject: input.added
      ? `You were added to ${input.workspace} on OpenTrack`
      : `${input.inviter} invited you to ${input.workspace} on OpenTrack`,
    text: ['Hi,', '', what, how, '', input.link].join('\n'),
    html: `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.5;color:#10131a;max-width:520px">
<p>Hi,</p>
<p>${escapeHtml(what)}</p>
<p>${escapeHtml(how)}</p>
<p style="margin:28px 0"><a href="${escapeHtml(input.link)}" style="background:#4f46e5;color:#ffffff;padding:11px 20px;border-radius:8px;text-decoration:none;font-weight:600">${input.added ? 'Open the dashboard' : 'Accept the invite'}</a></p>
<p style="color:#6b7387;font-size:12px">If you did not expect this, you can ignore this email.</p>
</div>`,
  };
}

const wrap = (body: string) =>
  `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.5;color:#10131a;max-width:520px">${body}</div>`;
const button = (link: string, label: string) =>
  `<p style="margin:28px 0"><a href="${escapeHtml(link)}" style="background:#4f46e5;color:#ffffff;padding:11px 20px;border-radius:8px;text-decoration:none;font-weight:600">${escapeHtml(label)}</a></p>`;

/** To super-admins: someone created an account and waits for approval. */
export function accountRequestedMail(input: {
  to: string;
  name: string;
  email: string;
  method: string;
  /** "+880 1711421236", or null when none was given (Google sign-ups). */
  phone: string | null;
  link: string;
}): MailMessage {
  const line = `${input.name} (${input.email}) created an account with ${input.method} and is waiting for your approval.`;
  const details: [string, string][] = [
    ['Name', input.name],
    ['Email', input.email],
    ['Phone', input.phone ?? 'not given'],
    ['Signed up with', input.method],
  ];
  const rows = details
    .map(
      ([k, v]) =>
        `<tr><td style="padding:3px 16px 3px 0;color:#6b7387">${escapeHtml(k)}</td><td style="padding:3px 0"><strong>${escapeHtml(v)}</strong></td></tr>`,
    )
    .join('');
  return {
    to: input.to,
    subject: `New account waiting for approval: ${input.email}`,
    text: [
      'Hi,',
      '',
      line,
      '',
      ...details.map(([k, v]) => `${k}: ${v}`),
      '',
      'Approve or reject it under Members in the dashboard:',
      input.link,
    ].join('\n'),
    html: wrap(
      `<p>Hi,</p><p>${escapeHtml(line)}</p><table style="border-collapse:collapse;font-size:14px">${rows}</table>${button(input.link, 'Review the request')}<p style="color:#6b7387;font-size:12px">Until you approve it, the account cannot open the dashboard.</p>`,
    ),
  };
}

/** To the user: their account was approved. */
export function accountApprovedMail(input: { to: string; name: string; link: string }): MailMessage {
  const greeting = input.name ? `Hi ${input.name},` : 'Hi,';
  const line = 'Your OpenTrack account has been approved. You can now sign in and use the dashboard.';
  return {
    to: input.to,
    subject: 'Your OpenTrack account is approved',
    text: [greeting, '', line, '', input.link].join('\n'),
    html: wrap(
      `<p>${escapeHtml(greeting)}</p><p>${escapeHtml(line)}</p>${button(input.link, 'Open the dashboard')}`,
    ),
  };
}

export function passwordResetMail(to: string, name: string, link: string): MailMessage {
  const greeting = name ? `Hi ${name},` : 'Hi,';
  return {
    to,
    subject: 'Reset your OpenTrack password',
    text: [
      greeting,
      '',
      'Someone asked to reset the password of your OpenTrack account. To choose a new one, open this link:',
      '',
      link,
      '',
      'The link works once and expires in one hour. If you did not ask for it, ignore this email: your password stays as it is.',
    ].join('\n'),
    html: `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.5;color:#10131a;max-width:520px">
<p>${escapeHtml(greeting)}</p>
<p>Someone asked to reset the password of your OpenTrack account. To choose a new one, use the button below.</p>
<p style="margin:28px 0"><a href="${escapeHtml(link)}" style="background:#4f46e5;color:#ffffff;padding:11px 20px;border-radius:8px;text-decoration:none;font-weight:600">Set a new password</a></p>
<p style="color:#4a5163;font-size:13px">The link works once and expires in one hour. If you did not ask for it, ignore this email: your password stays as it is.</p>
<p style="color:#6b7387;font-size:12px;word-break:break-all">${escapeHtml(link)}</p>
</div>`,
  };
}
