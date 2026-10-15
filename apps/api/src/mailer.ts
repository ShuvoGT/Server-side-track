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
    ? `${input.inviter} added you to the workspace "${input.workspace}" on Tracking Platform as ${role}.`
    : `${input.inviter} invited you to the workspace "${input.workspace}" on Tracking Platform as ${role}.`;
  const how = input.added
    ? 'Sign in to see its containers.'
    : `To join, sign in with Google using this address (${input.to}). The workspace appears as soon as you are in.`;
  return {
    to: input.to,
    subject: input.added
      ? `You were added to ${input.workspace} on Tracking Platform`
      : `${input.inviter} invited you to ${input.workspace} on Tracking Platform`,
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

export function passwordResetMail(to: string, name: string, link: string): MailMessage {
  const greeting = name ? `Hi ${name},` : 'Hi,';
  return {
    to,
    subject: 'Reset your Tracking Platform password',
    text: [
      greeting,
      '',
      'Someone asked to reset the password of your Tracking Platform account. To choose a new one, open this link:',
      '',
      link,
      '',
      'The link works once and expires in one hour. If you did not ask for it, ignore this email: your password stays as it is.',
    ].join('\n'),
    html: `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.5;color:#10131a;max-width:520px">
<p>${escapeHtml(greeting)}</p>
<p>Someone asked to reset the password of your Tracking Platform account. To choose a new one, use the button below.</p>
<p style="margin:28px 0"><a href="${escapeHtml(link)}" style="background:#4f46e5;color:#ffffff;padding:11px 20px;border-radius:8px;text-decoration:none;font-weight:600">Set a new password</a></p>
<p style="color:#4a5163;font-size:13px">The link works once and expires in one hour. If you did not ask for it, ignore this email: your password stays as it is.</p>
<p style="color:#6b7387;font-size:12px;word-break:break-all">${escapeHtml(link)}</p>
</div>`,
  };
}
