const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, '..', 'inkwell.db'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS lists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS subscribers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  first_name TEXT,
  list_id INTEGER NOT NULL REFERENCES lists(id),
  status TEXT NOT NULL DEFAULT 'pending',   -- pending | active | bounced | unsubscribed
  confirm_token TEXT,
  unsubscribe_token TEXT NOT NULL,
  consent_ip TEXT,                          -- captured at signup, proof of consent
  confirmed_at TEXT,                        -- when double opt-in was completed
  last_engaged_at TEXT,                     -- most recent open or click, any campaign
  complained_at TEXT,                       -- set if they ever hit "mark as spam"
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject TEXT NOT NULL,
  body_text TEXT NOT NULL,
  list_id INTEGER NOT NULL REFERENCES lists(id),
  status TEXT NOT NULL DEFAULT 'draft',      -- draft | sending | sent
  created_at TEXT DEFAULT (datetime('now')),
  sent_at TEXT
);

CREATE TABLE IF NOT EXISTS recipients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id),
  subscriber_id INTEGER NOT NULL REFERENCES subscribers(id),
  tracking_token TEXT NOT NULL UNIQUE,
  sent_at TEXT,
  opened_at TEXT,
  clicked_at TEXT,
  bounced_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_sub_list ON subscribers(list_id);
CREATE INDEX IF NOT EXISTS idx_recip_campaign ON recipients(campaign_id);
`);

const subCols = db.prepare("PRAGMA table_info(subscribers)").all().map(c => c.name);
if (!subCols.includes('consent_ip')) db.exec('ALTER TABLE subscribers ADD COLUMN consent_ip TEXT');
if (!subCols.includes('confirmed_at')) db.exec('ALTER TABLE subscribers ADD COLUMN confirmed_at TEXT');
if (!subCols.includes('last_engaged_at')) db.exec('ALTER TABLE subscribers ADD COLUMN last_engaged_at TEXT');
if (!subCols.includes('complained_at')) db.exec('ALTER TABLE subscribers ADD COLUMN complained_at TEXT');
if (!subCols.includes('tags')) db.exec('ALTER TABLE subscribers ADD COLUMN tags TEXT');
if (!subCols.includes('custom_fields')) db.exec('ALTER TABLE subscribers ADD COLUMN custom_fields TEXT');

const campCols = db.prepare("PRAGMA table_info(campaigns)").all().map(c => c.name);
if (!campCols.includes('body_html')) db.exec('ALTER TABLE campaigns ADD COLUMN body_html TEXT');
if (!campCols.includes('template_type')) db.exec("ALTER TABLE campaigns ADD COLUMN template_type TEXT DEFAULT 'custom'");
if (!campCols.includes('is_ab_test')) db.exec('ALTER TABLE campaigns ADD COLUMN is_ab_test INTEGER DEFAULT 0');
if (!campCols.includes('subject_b')) db.exec('ALTER TABLE campaigns ADD COLUMN subject_b TEXT');
if (!campCols.includes('scheduled_for')) db.exec('ALTER TABLE campaigns ADD COLUMN scheduled_for TEXT');
if (!campCols.includes('tag_filter')) db.exec('ALTER TABLE campaigns ADD COLUMN tag_filter TEXT');

const recipCols = db.prepare("PRAGMA table_info(recipients)").all().map(c => c.name);
if (!recipCols.includes('variant')) db.exec("ALTER TABLE recipients ADD COLUMN variant TEXT DEFAULT 'A'");

// Seed a default list so the app is usable immediately.
const listCount = db.prepare('SELECT COUNT(*) AS n FROM lists').get().n;
if (listCount === 0) {
  db.prepare('INSERT INTO lists (name) VALUES (?)').run('Main list');
}

module.exports = db;
