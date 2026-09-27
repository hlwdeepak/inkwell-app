const express = require('express');
const { nanoid } = require('nanoid');
const db = require('../db');
const { sendMail } = require('../email');

const router = express.Router();

// ---- Public: signup form submits here (double opt-in). Unauthenticated
// by design — this is the endpoint your public website's form posts to. ----
router.post('/api/public/subscribe', express.json(), async (req, res) => {
  const { email, first_name, list_id } = req.body;
  if (!email || !list_id) return res.status(400).json({ error: 'email and list_id are required' });

  // Consent proof: capture the IP that submitted the form. Required to
  // credibly demonstrate opt-in if a complaint or GDPR request ever comes in.
  const consentIp = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;

  const existing = db.prepare('SELECT * FROM subscribers WHERE email = ?').get(email);
  if (existing && existing.status === 'active') {
    return res.json({ ok: true, message: 'Already subscribed.' });
  }

  const confirmToken = nanoid(24);
  const unsubToken = nanoid(24);

  if (existing) {
    db.prepare('UPDATE subscribers SET confirm_token = ?, status = ?, consent_ip = ? WHERE id = ?')
      .run(confirmToken, 'pending', consentIp, existing.id);
  } else {
    db.prepare(`
      INSERT INTO subscribers (email, first_name, list_id, status, confirm_token, unsubscribe_token, consent_ip)
      VALUES (?, ?, ?, 'pending', ?, ?, ?)
    `).run(email, first_name || null, list_id, confirmToken, unsubToken, consentIp);
  }

  const confirmUrl = `${process.env.APP_URL}/confirm/${confirmToken}`;
  try {
    await sendMail({
      to: email,
      subject: 'Confirm your subscription',
      text: `Hi${first_name ? ' ' + first_name : ''},\n\nPlease confirm you'd like to receive emails from us:\n${confirmUrl}\n\nIf you didn't request this, ignore this email.`,
      unsubscribeUrl: `${process.env.APP_URL}/unsubscribe/${unsubToken}`,
    });
  } catch (e) {
    console.error('Confirmation email failed:', e.message);
    return res.status(502).json({ error: 'Could not send confirmation email. Check your provider config.' });
  }

  res.json({ ok: true, message: 'Check your inbox to confirm.' });
});

// 1x1 transparent PNG, served for open tracking.
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

// ---- Confirm double opt-in ----
router.get('/confirm/:token', (req, res) => {
  const sub = db.prepare('SELECT * FROM subscribers WHERE confirm_token = ?').get(req.params.token);
  if (!sub) return res.status(404).send(page('Link not found', 'This confirmation link is invalid or already used.'));
  db.prepare(`UPDATE subscribers SET status = 'active', confirm_token = NULL, confirmed_at = datetime('now') WHERE id = ?`).run(sub.id);
  res.send(page('Subscribed', `You're confirmed, ${sub.first_name || 'friend'}. You'll start receiving emails.`));
});

// ---- Unsubscribe: GET for the link in the email body, POST for Gmail/Yahoo's
// native one-click button (RFC 8058 List-Unsubscribe-Post) ----
function doUnsubscribe(req, res) {
  const sub = db.prepare('SELECT * FROM subscribers WHERE unsubscribe_token = ?').get(req.params.token);
  if (!sub) return res.status(404).send(page('Link not found', 'This unsubscribe link is invalid.'));
  db.prepare(`UPDATE subscribers SET status = 'unsubscribed' WHERE id = ?`).run(sub.id);
  if (req.method === 'POST') return res.status(200).end(); // one-click clients expect a bare 200
  res.send(page('Unsubscribed', "You won't receive any more emails from this list."));
}
router.get('/unsubscribe/:token', doUnsubscribe);
router.post('/unsubscribe/:token', doUnsubscribe);

// ---- GDPR self-service: a subscriber can view and export everything held
// about them (Article 15) or request erasure (Article 17), using their own
// unsubscribe link as identification — no admin involvement needed. ----
router.get('/my-data/:token', (req, res) => {
  const sub = db.prepare('SELECT * FROM subscribers WHERE unsubscribe_token = ?').get(req.params.token);
  if (!sub) return res.status(404).send(page('Link not found', 'This link is invalid.'));
  const sends = db.prepare(`
    SELECT c.subject, r.sent_at, r.opened_at, r.clicked_at
    FROM recipients r JOIN campaigns c ON c.id = r.campaign_id
    WHERE r.subscriber_id = ? ORDER BY r.sent_at DESC
  `).all(sub.id);
  res.json({
    email: sub.email,
    first_name: sub.first_name,
    status: sub.status,
    consent_captured_ip: sub.consent_ip,
    confirmed_at: sub.confirmed_at,
    subscribed_since: sub.created_at,
    campaigns_received: sends,
  });
});

router.post('/my-data/:token/delete', (req, res) => {
  const sub = db.prepare('SELECT * FROM subscribers WHERE unsubscribe_token = ?').get(req.params.token);
  if (!sub) return res.status(404).send(page('Link not found', 'This link is invalid.'));
  db.prepare('DELETE FROM recipients WHERE subscriber_id = ?').run(sub.id);
  db.prepare('DELETE FROM subscribers WHERE id = ?').run(sub.id);
  res.send(page('Data deleted', 'Your email address and all associated data have been permanently removed.'));
});

// ---- Open tracking pixel ----
router.get('/t/o/:token.png', (req, res) => {
  db.prepare(`
    UPDATE recipients SET opened_at = COALESCE(opened_at, datetime('now'))
    WHERE tracking_token = ?
  `).run(req.params.token);
  markEngaged(req.params.token);
  res.set('Content-Type', 'image/png');
  res.send(PIXEL);
});

// ---- Click tracking: wrap outbound links as /t/c/:token?url=... ----
router.get('/t/c/:token', (req, res) => {
  const url = req.query.url;
  db.prepare(`
    UPDATE recipients SET clicked_at = COALESCE(clicked_at, datetime('now'))
    WHERE tracking_token = ?
  `).run(req.params.token);
  markEngaged(req.params.token);
  if (!url) return res.status(400).send('Missing url');
  res.redirect(url);
});

function markEngaged(trackingToken) {
  db.prepare(`
    UPDATE subscribers SET last_engaged_at = datetime('now')
    WHERE id = (SELECT subscriber_id FROM recipients WHERE tracking_token = ?)
  `).run(trackingToken);
}

// ---- Provider webhook: bounces/complaints flip a subscriber to suppressed.
// Point your provider's webhook (Resend, SES SNS, Postmark) at POST /webhooks/inbound
// and adapt the field names below to match that provider's payload shape. ----
router.post('/webhooks/inbound', express.json(), (req, res) => {
  const { type, data } = req.body || {};
  const email = data?.to?.[0] || data?.email;
  if (!email) return res.status(200).end();

  if (type === 'email.bounced' || type === 'bounce') {
    db.prepare(`UPDATE subscribers SET status = 'bounced' WHERE email = ?`).run(email);
  }
  if (type === 'email.complained' || type === 'complaint') {
    db.prepare(`UPDATE subscribers SET status = 'unsubscribed', complained_at = datetime('now') WHERE email = ?`).run(email);
  }
  res.status(200).end();
});

function page(title, body) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>
  <style>body{font-family:system-ui,sans-serif;max-width:420px;margin:80px auto;text-align:center;color:#1D2521}
  h1{font-size:22px}</style></head><body><h1>${title}</h1><p>${body}</p></body></html>`;
}

module.exports = router;
