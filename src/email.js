// Thin abstraction so you can swap providers by changing EMAIL_PROVIDER in .env
// without touching the rest of the app. All providers receive the same shape:
// { to, subject, text, html, headers }

const provider = process.env.EMAIL_PROVIDER || 'console';
const fromLine = `${process.env.FROM_NAME || 'Inkwell'} <${process.env.FROM_EMAIL || 'notifications@example.com'}>`;

let sendViaResend, sendViaSmtp, sendViaConsole;

sendViaConsole = async ({ to, subject, text, html, headers }) => {
  console.log(`\n📬 [EMAIL DELIVERED (Simulated)]`);
  console.log(`From:    ${fromLine}`);
  console.log(`To:      ${to}`);
  console.log(`Subject: ${subject}`);
  console.log(`Headers:`, JSON.stringify(headers));
  console.log(`Format:  ${html ? 'HTML + Plain Text' : 'Plain Text'}`);
  console.log(`----------------------------------------`);
  console.log(text || '(HTML Email Content)');
  console.log(`----------------------------------------\n`);
};

if (provider === 'resend') {
  const { Resend } = require('resend');
  const resend = new Resend(process.env.RESEND_API_KEY || 'dummy_key');
  sendViaResend = async ({ to, subject, text, html, headers }) => {
    if (!process.env.RESEND_API_KEY || process.env.RESEND_API_KEY.startsWith('re_placeholder')) {
      return sendViaConsole({ to, subject, text, html, headers });
    }
    const payload = {
      from: fromLine,
      to,
      subject,
      reply_to: process.env.REPLY_TO_EMAIL,
      headers,
    };
    if (html) payload.html = html;
    if (text) payload.text = text;

    const { error } = await resend.emails.send(payload);
    if (error) throw new Error(error.message || JSON.stringify(error));
  };
} else if (provider === 'smtp') {
  const nodemailer = require('nodemailer');
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'localhost',
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
  sendViaSmtp = async ({ to, subject, text, html, headers }) => {
    if ((!process.env.SMTP_HOST || process.env.SMTP_HOST === 'localhost') && !process.env.SMTP_USER) {
      return sendViaConsole({ to, subject, text, html, headers });
    }
    await transporter.sendMail({
      from: fromLine,
      to,
      subject,
      text,
      html,
      replyTo: process.env.REPLY_TO_EMAIL,
      headers,
    });
  };
}

/**
 * Send one email. Always attaches List-Unsubscribe headers (RFC 8058)
 * so Gmail/Yahoo show a native one-click unsubscribe button — this is
 * mandatory for bulk senders as of 2024's inbox provider requirements.
 */
async function sendMail({ to, subject, text, html, unsubscribeUrl }) {
  const headers = {};
  if (unsubscribeUrl && !unsubscribeUrl.includes('localhost')) {
    headers['List-Unsubscribe'] = `<${unsubscribeUrl}>`;
    headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
  } else {
    const replyEmail = process.env.REPLY_TO_EMAIL || process.env.FROM_EMAIL || 'supportinkwell.mail@gmail.com';
    headers['List-Unsubscribe'] = `<mailto:${replyEmail}?subject=unsubscribe>`;
  }
  if (provider === 'resend' && sendViaResend) {
    return sendViaResend({ to, subject, text, html, headers });
  }
  if (provider === 'smtp' && sendViaSmtp) {
    return sendViaSmtp({ to, subject, text, html, headers });
  }
  return sendViaConsole({ to, subject, text, html, headers });
}

module.exports = { sendMail };
