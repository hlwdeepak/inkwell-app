const express = require('express');
const db = require('../db');

const router = express.Router();

// ---- Overall deliverability health: the numbers that actually predict
// whether mailbox providers trust you. Thresholds noted inline. ----
router.get('/reports/deliverability', (req, res) => {
  const totals = db.prepare(`
    SELECT
      COUNT(*) AS sent,
      SUM(CASE WHEN opened_at IS NOT NULL THEN 1 ELSE 0 END) AS opened,
      SUM(CASE WHEN clicked_at IS NOT NULL THEN 1 ELSE 0 END) AS clicked
    FROM recipients
  `).get();

  const subStatus = db.prepare(`
    SELECT status, COUNT(*) AS n FROM subscribers GROUP BY status
  `).all();
  const byStatus = Object.fromEntries(subStatus.map((r) => [r.status, r.n]));

  const totalSubs = Object.values(byStatus).reduce((a, b) => a + b, 0) || 1;
  const bounceRate = (byStatus.bounced || 0) / totalSubs;
  const complained = db.prepare(`SELECT COUNT(*) AS n FROM subscribers WHERE complained_at IS NOT NULL`).get().n;
  const complaintRate = complained / totalSubs;
  const openRate = totals.sent ? totals.opened / totals.sent : 0;
  const clickRate = totals.sent ? totals.clicked / totals.sent : 0;

  const coldCount = db.prepare(`
    SELECT COUNT(*) AS n FROM subscribers
    WHERE status = 'active'
      AND (confirmed_at IS NULL OR confirmed_at < datetime('now', '-30 days'))
      AND (last_engaged_at IS NULL OR last_engaged_at < datetime('now', '-180 days'))
  `).get().n;

  res.json({
    subscribers: { total: totalSubs, ...byStatus },
    sending: { sent: totals.sent, opened: totals.opened, clicked: totals.clicked },
    rates: {
      bounce_rate: bounceRate,
      bounce_rate_status: bounceRate > 0.05 ? 'bad' : bounceRate > 0.02 ? 'warn' : 'good', // industry guidance: keep under 2%
      complaint_rate: complaintRate,
      complaint_rate_status: complaintRate > 0.001 ? 'bad' : 'good', // 0.1% is the commonly cited danger threshold
      open_rate: openRate,
      click_rate: clickRate,
    },
    cold_subscriber_count: coldCount,
  });
});

// ---- Subscribers who haven't engaged in 180+ days and aren't new.
// Candidates for a re-engagement campaign, or suppression if that fails. ----
router.get('/reports/cold-subscribers', (req, res) => {
  const rows = db.prepare(`
    SELECT id, email, first_name, last_engaged_at, confirmed_at
    FROM subscribers
    WHERE status = 'active'
      AND (confirmed_at IS NULL OR confirmed_at < datetime('now', '-30 days'))
      AND (last_engaged_at IS NULL OR last_engaged_at < datetime('now', '-180 days'))
    ORDER BY (last_engaged_at IS NOT NULL), last_engaged_at ASC
  `).all();
  res.json(rows);
});

// ---- Bulk-suppress a set of subscriber ids (e.g. cold list that didn't
// respond to a re-engagement campaign). Marks unsubscribed, not deleted. ----
router.post('/reports/suppress', (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids array required' });
  const stmt = db.prepare(`UPDATE subscribers SET status = 'unsubscribed' WHERE id = ?`);
  const tx = db.transaction((list) => list.forEach((id) => stmt.run(id)));
  tx(ids);
  res.json({ ok: true, suppressed: ids.length });
});

module.exports = router;
