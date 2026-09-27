const express = require('express');
const { nanoid } = require('nanoid');
const db = require('../db');
const { sendMail } = require('../email');
const spamCheck = require('../spamCheck');
const { buildEmailHtml, htmlToPlainText } = require('../templates');

const router = express.Router();

router.get('/campaigns', (req, res) => {
  const campaigns = db.prepare('SELECT * FROM campaigns ORDER BY created_at DESC').all();
  const withStats = campaigns.map((c) => {
    const stats = db.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN sent_at IS NOT NULL THEN 1 ELSE 0 END) AS sent,
        SUM(CASE WHEN opened_at IS NOT NULL THEN 1 ELSE 0 END) AS opened,
        SUM(CASE WHEN clicked_at IS NOT NULL THEN 1 ELSE 0 END) AS clicked,
        SUM(CASE WHEN bounced_at IS NOT NULL THEN 1 ELSE 0 END) AS bounced,
        SUM(CASE WHEN variant = 'A' AND opened_at IS NOT NULL THEN 1 ELSE 0 END) AS opened_a,
        SUM(CASE WHEN variant = 'B' AND opened_at IS NOT NULL THEN 1 ELSE 0 END) AS opened_b,
        SUM(CASE WHEN variant = 'A' THEN 1 ELSE 0 END) AS sent_a,
        SUM(CASE WHEN variant = 'B' THEN 1 ELSE 0 END) AS sent_b
      FROM recipients WHERE campaign_id = ?
    `).get(c.id);
    return { ...c, stats };
  });
  res.json(withStats);
});

router.post('/campaigns', (req, res) => {
  const {
    subject,
    subject_b,
    is_ab_test = 0,
    body_text,
    body_html,
    template_type = 'newsletter',
    list_id,
    tag_filter,
    scheduled_for,
  } = req.body;

  if (!subject || !list_id) {
    return res.status(400).json({ error: 'subject and list_id are required' });
  }

  const initialStatus = scheduled_for && new Date(scheduled_for) > new Date() ? 'scheduled' : 'draft';
  const plainText = body_text || (body_html ? htmlToPlainText(body_html) : '');

  const info = db.prepare(`
    INSERT INTO campaigns (
      subject, subject_b, is_ab_test, body_text, body_html,
      template_type, list_id, tag_filter, scheduled_for, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    subject,
    subject_b || null,
    is_ab_test ? 1 : 0,
    plainText,
    body_html || null,
    template_type,
    list_id,
    tag_filter || null,
    scheduled_for || null,
    initialStatus
  );

  res.json({ id: info.lastInsertRowid, status: initialStatus });
});

router.post('/campaigns/check', (req, res) => {
  const { subject, body_text, body_html } = req.body;
  const contentToCheck = body_text || htmlToPlainText(body_html || '');
  res.json(spamCheck.check(subject || '', contentToCheck));
});

// ---- Core campaign sending logic (callable directly or from scheduler) ----
async function dispatchCampaign(campaignId, options = {}) {
  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campaignId);
  if (!campaign) throw new Error('Campaign not found');

  const engagedOnly = options.engagedOnly === true;
  let sql = `SELECT * FROM subscribers WHERE list_id = ? AND status = 'active'`;
  const params = [campaign.list_id];

  if (campaign.tag_filter) {
    sql += ` AND tags LIKE ?`;
    params.push(`%${campaign.tag_filter}%`);
  }

  if (engagedOnly) {
    sql += ` AND (last_engaged_at >= datetime('now', '-180 days') OR confirmed_at >= datetime('now', '-30 days'))`;
  }

  const recipients = db.prepare(sql).all(...params);
  if (recipients.length === 0) {
    db.prepare(`UPDATE campaigns SET status = 'sent', sent_at = datetime('now') WHERE id = ?`).run(campaign.id);
    return { ok: true, queued: 0 };
  }

  db.prepare(`UPDATE campaigns SET status = 'sending' WHERE id = ?`).run(campaign.id);

  const batchSize = Number(process.env.SEND_BATCH_SIZE || 10);
  const batchDelay = Number(process.env.SEND_BATCH_DELAY_MS || 1000);
  const insertRecipient = db.prepare(`
    INSERT INTO recipients (campaign_id, subscriber_id, tracking_token, variant, sent_at)
    VALUES (?, ?, ?, ?, datetime('now'))
  `);
  const markBounced = db.prepare(`UPDATE subscribers SET status = 'bounced' WHERE id = ?`);

  // Asynchronous background batch loop
  (async () => {
    for (let i = 0; i < recipients.length; i += batchSize) {
      const batch = recipients.slice(i, i + batchSize);
      await Promise.all(batch.map(async (sub, idx) => {
        const token = nanoid(24);
        const isLocal = !process.env.APP_URL || process.env.APP_URL.includes('localhost');
        const unsubUrl = isLocal ? null : `${process.env.APP_URL}/unsubscribe/${sub.unsubscribe_token}`;
        const myDataUrl = isLocal ? null : `${process.env.APP_URL}/my-data/${sub.unsubscribe_token}`;
        const openPixel = isLocal ? null : `${process.env.APP_URL}/t/o/${token}.png`;

        // A/B Variant selection
        let chosenSubject = campaign.subject;
        let variant = 'A';
        if (campaign.is_ab_test && campaign.subject_b) {
          variant = (i + idx) % 2 === 0 ? 'A' : 'B';
          chosenSubject = variant === 'B' ? campaign.subject_b : campaign.subject;
        }

        const personalizedSubject = chosenSubject.replace(/\{\{first_name\}\}/g, sub.first_name || 'there');

        // Prepare Plain Text Content
        const plainPersonalized = (campaign.body_text || '').replace(/\{\{first_name\}\}/g, sub.first_name || 'there');
        const textFooter = isLocal
          ? `\n\n—\n${process.env.COMPANY_NAME || 'Inkwell'}\n${process.env.COMPANY_ADDRESS || ''}\n\nTo unsubscribe, reply to this email with "Unsubscribe".`
          : `\n\n—\n${process.env.COMPANY_NAME || 'Inkwell'}\n${process.env.COMPANY_ADDRESS || ''}\n\nUnsubscribe: ${unsubUrl}\nView or delete your data: ${myDataUrl}`;
        const fullPlainText = `${plainPersonalized}${textFooter}`;

        // Prepare HTML Content if present
        let fullHtml = null;
        if (campaign.body_html) {
          let htmlContent = campaign.body_html.replace(/\{\{first_name\}\}/g, sub.first_name || 'there');
          // Wrap links with click-tracking only when using a public domain
          if (!isLocal) {
            htmlContent = htmlContent.replace(/href="(https?:\/\/[^"]+)"/gi, (match, url) => {
              const trackUrl = `${process.env.APP_URL}/t/c/${token}?url=${encodeURIComponent(url)}`;
              return `href="${trackUrl}"`;
            });
          }

          const htmlFooter = isLocal
            ? `${process.env.COMPANY_NAME || 'Inkwell'} &bull; ${process.env.COMPANY_ADDRESS || ''}<br><span style="color:#64748b;">To unsubscribe, simply reply to this email with "Unsubscribe"</span>`
            : `${process.env.COMPANY_NAME || 'Inkwell'} &bull; ${process.env.COMPANY_ADDRESS || ''}<br><a href="${unsubUrl}" style="color: #64748b; text-decoration: underline;">One-Click Unsubscribe</a> &bull; <a href="${myDataUrl}" style="color: #64748b; text-decoration: underline;">View or Delete Data</a>`;

          fullHtml = buildEmailHtml({
            templateType: campaign.template_type || 'newsletter',
            data: {
              subject: personalizedSubject,
              content: htmlContent,
              companyName: process.env.COMPANY_NAME || 'Inkwell'
            },
            footer: htmlFooter,
            openPixel
          });
        }

        try {
          await sendMail({
            to: sub.email,
            subject: personalizedSubject,
            text: fullPlainText,
            html: fullHtml,
            unsubscribeUrl: unsubUrl,
          });
          insertRecipient.run(campaign.id, sub.id, token, variant);
        } catch (err) {
          console.error(`Send failed for ${sub.email}:`, err.message);
          insertRecipient.run(campaign.id, sub.id, token, variant);
          if (!err.code?.includes('ECONN') && !err.message?.includes('ECONNREFUSED')) {
            markBounced.run(sub.id);
          }
        }
      }));

      if (i + batchSize < recipients.length) {
        await new Promise((r) => setTimeout(r, batchDelay));
      }
    }

    db.prepare(`UPDATE campaigns SET status = 'sent', sent_at = datetime('now') WHERE id = ?`).run(campaign.id);
  })();

  return { ok: true, queued: recipients.length };
}

// POST endpoint for sending or resending a campaign
router.post('/campaigns/:id/send', async (req, res) => {
  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
  if (!campaign) return res.status(404).json({ error: 'not found' });
  if (campaign.status === 'sent' && req.body?.resend !== true) {
    return res.status(400).json({ error: 'already sent' });
  }

  try {
    const result = await dispatchCampaign(campaign.id, {
      resend: req.body?.resend === true,
      engagedOnly: req.body?.engaged_only === true
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = {
  router,
  dispatchCampaign
};
