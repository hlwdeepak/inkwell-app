const express = require('express');
const { nanoid } = require('nanoid');
const db = require('../db');

const router = express.Router();

// ---- Admin: direct add subscriber (as active or pending) with tags ----
router.post('/subscribers', (req, res) => {
  const { email, first_name, list_id, status = 'active', tags } = req.body;
  if (!email || !list_id) return res.status(400).json({ error: 'email and list_id are required' });
  const unsubToken = nanoid(24);
  const tagStr = Array.isArray(tags) ? tags.join(',') : (tags || null);
  const info = db.prepare(`
    INSERT INTO subscribers (email, first_name, list_id, status, tags, unsubscribe_token, confirmed_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(email) DO UPDATE SET
      first_name = COALESCE(excluded.first_name, first_name),
      status = excluded.status,
      tags = COALESCE(excluded.tags, tags),
      confirmed_at = datetime('now')
  `).run(email.trim().toLowerCase(), first_name?.trim() || null, list_id, status, tagStr, unsubToken);
  res.json({ id: info.lastInsertRowid, ok: true });
});

// ---- Admin: Bulk CSV import ----
router.post('/subscribers/import-csv', (req, res) => {
  const { records, list_id, default_status = 'active', append_tags } = req.body;
  if (!Array.isArray(records) || records.length === 0) {
    return res.status(400).json({ error: 'No records provided' });
  }
  if (!list_id) return res.status(400).json({ error: 'list_id is required' });

  const stmt = db.prepare(`
    INSERT INTO subscribers (email, first_name, list_id, status, tags, unsubscribe_token, confirmed_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(email) DO UPDATE SET
      first_name = COALESCE(excluded.first_name, first_name),
      status = excluded.status,
      tags = CASE
        WHEN excluded.tags IS NOT NULL AND tags IS NOT NULL THEN tags || ',' || excluded.tags
        ELSE COALESCE(excluded.tags, tags)
      END,
      confirmed_at = COALESCE(confirmed_at, datetime('now'))
  `);

  let imported = 0;
  let skipped = 0;

  const importTx = db.transaction((rows) => {
    for (const r of rows) {
      const email = (r.email || r.Email || '').trim().toLowerCase();
      if (!email || !email.includes('@')) {
        skipped++;
        continue;
      }
      const firstName = (r.first_name || r.name || r['First Name'] || r.FirstName || '').trim() || null;
      let tags = (r.tags || r.tag || r.Tags || '').trim();
      if (append_tags) {
        tags = tags ? `${tags},${append_tags}` : append_tags;
      }
      const unsubToken = nanoid(24);
      stmt.run(email, firstName, list_id, default_status, tags || null, unsubToken);
      imported++;
    }
  });

  try {
    importTx(records);
    res.json({ ok: true, imported, skipped });
  } catch (err) {
    console.error('CSV import error:', err);
    res.status(500).json({ error: 'Database import error: ' + err.message });
  }
});

// ---- Admin: list subscribers with optional search/filter ----
router.get('/subscribers', (req, res) => {
  const { list_id, tag, search } = req.query;
  let sql = `
    SELECT s.*, l.name AS list_name FROM subscribers s
    JOIN lists l ON l.id = s.list_id
    WHERE 1=1
  `;
  const params = [];

  if (list_id) {
    sql += ` AND s.list_id = ?`;
    params.push(list_id);
  }
  if (tag) {
    sql += ` AND s.tags LIKE ?`;
    params.push(`%${tag}%`);
  }
  if (search) {
    sql += ` AND (s.email LIKE ? OR s.first_name LIKE ?)`;
    params.push(`%${search}%`, `%${search}%`);
  }

  sql += ` ORDER BY s.created_at DESC`;
  const rows = db.prepare(sql).all(...params);
  res.json(rows);
});

// ---- Admin: get all distinct tags ----
router.get('/tags', (req, res) => {
  const rows = db.prepare(`SELECT tags FROM subscribers WHERE tags IS NOT NULL AND tags != ''`).all();
  const tagSet = new Set();
  rows.forEach(r => {
    r.tags.split(',').map(t => t.trim()).filter(Boolean).forEach(t => tagSet.add(t));
  });
  res.json(Array.from(tagSet).sort());
});

// ---- Admin: lists ----
router.get('/lists', (req, res) => {
  res.json(db.prepare('SELECT * FROM lists ORDER BY id').all());
});

router.post('/lists', (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  const info = db.prepare('INSERT INTO lists (name) VALUES (?)').run(name);
  res.json({ id: info.lastInsertRowid, name });
});

// ---- Admin: update tags on subscriber ----
router.patch('/subscribers/:id/tags', (req, res) => {
  const { tags } = req.body;
  const tagStr = Array.isArray(tags) ? tags.join(',') : (tags || null);
  db.prepare('UPDATE subscribers SET tags = ? WHERE id = ?').run(tagStr, req.params.id);
  res.json({ ok: true });
});

// ---- Admin: manually mark a subscriber (e.g. re-add, suppress) ----
router.patch('/subscribers/:id', (req, res) => {
  const { status, tags, first_name } = req.body;
  if (status) {
    const allowed = ['pending', 'active', 'bounced', 'unsubscribed'];
    if (!allowed.includes(status)) return res.status(400).json({ error: 'invalid status' });
    if (status === 'active') {
      db.prepare(`
        UPDATE subscribers
        SET status = 'active', confirm_token = NULL, confirmed_at = COALESCE(confirmed_at, datetime('now'))
        WHERE id = ?
      `).run(req.params.id);
    } else {
      db.prepare('UPDATE subscribers SET status = ? WHERE id = ?').run(status, req.params.id);
    }
  }
  if (tags !== undefined) {
    const tagStr = Array.isArray(tags) ? tags.join(',') : (tags || null);
    db.prepare('UPDATE subscribers SET tags = ? WHERE id = ?').run(tagStr, req.params.id);
  }
  if (first_name !== undefined) {
    db.prepare('UPDATE subscribers SET first_name = ? WHERE id = ?').run(first_name || null, req.params.id);
  }
  res.json({ ok: true });
});

router.delete('/subscribers/:id', (req, res) => {
  db.prepare('DELETE FROM recipients WHERE subscriber_id = ?').run(req.params.id);
  db.prepare('DELETE FROM subscribers WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
