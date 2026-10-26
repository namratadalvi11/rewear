/*
 * Database setup.
 * We use Node's built-in SQLite module (node:sqlite) so the project runs with
 * zero external services - the whole database is a single file (rewear.db).
 * The schema below is created automatically the first time the app starts.
 */
const { DatabaseSync } = require('node:sqlite');

const db = new DatabaseSync(process.env.DB_FILE || 'rewear.db');

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  phone         TEXT NOT NULL,
  password      TEXT NOT NULL,            -- scrypt hash, never the raw password
  profile_image TEXT,
  location      TEXT NOT NULL,            -- locality / community
  college       TEXT,
  bio           TEXT,
  verification  TEXT NOT NULL DEFAULT 'unverified', -- unverified | pending | verified
  role          TEXT NOT NULL DEFAULT 'user',       -- user | admin
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS items (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id         INTEGER NOT NULL REFERENCES users(id),
  listing_type     TEXT NOT NULL,          -- rent | sell | donate
  title            TEXT NOT NULL,
  brand            TEXT,
  quantity         INTEGER NOT NULL DEFAULT 1,
  description      TEXT NOT NULL,
  category         TEXT NOT NULL,
  gender           TEXT NOT NULL,          -- Women | Men | Unisex
  occasion         TEXT,
  size             TEXT NOT NULL,
  measurements     TEXT,                   -- JSON: {chest,waist,length,shoulder,sleeve,other}
  condition        TEXT NOT NULL,          -- Like New | Excellent | Good | Used
  rental_price     INTEGER DEFAULT 0,      -- rupees per day
  sale_price       INTEGER DEFAULT 0,
  original_price   INTEGER NOT NULL DEFAULT 0,
  security_deposit INTEGER DEFAULT 0,
  images           TEXT NOT NULL DEFAULT '[]', -- JSON array of image paths
  location         TEXT NOT NULL,
  available_from   TEXT,
  available_to     TEXT,
  handover_method  TEXT,                   -- for donations: pickup / drop-off etc.
  accessories      TEXT,                   -- what is included with the item
  status           TEXT NOT NULL DEFAULT 'active', -- active|paused|rented|sold|donated|removed
  views            INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS wishlists (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id    INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, item_id)
);

CREATE TABLE IF NOT EXISTS rentals (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id           INTEGER NOT NULL REFERENCES items(id),
  renter_id         INTEGER NOT NULL REFERENCES users(id),
  owner_id          INTEGER NOT NULL REFERENCES users(id),
  start_date        TEXT NOT NULL,
  end_date          TEXT NOT NULL,
  days              INTEGER NOT NULL,
  rental_price      INTEGER NOT NULL,      -- total for the whole period
  security_deposit  INTEGER NOT NULL,
  message           TEXT,
  status            TEXT NOT NULL DEFAULT 'pending',
     -- pending|accepted|rejected|active|returned|completed|cancelled
  condition_before  TEXT,                  -- JSON condition record filled by owner
  condition_after   TEXT,                  -- JSON condition record filled on return
  handover_confirmed INTEGER NOT NULL DEFAULT 0, -- renter agreed with the before-record
  return_confirmed   INTEGER NOT NULL DEFAULT 0, -- renter confirmed the return
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Used for both resale enquiries and donation requests, so the flow stays simple.
CREATE TABLE IF NOT EXISTS requests (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  request_code TEXT UNIQUE,
  item_id      INTEGER NOT NULL REFERENCES items(id),
  requester_id INTEGER NOT NULL REFERENCES users(id),
  owner_id     INTEGER NOT NULL REFERENCES users(id),
  kind         TEXT NOT NULL,              -- sell | donate
  message      TEXT,
  quantity     INTEGER NOT NULL DEFAULT 1,
  handover_method TEXT,
  pickup_date  TEXT,
  time_slot    TEXT,
  pickup_location TEXT,
  status       TEXT NOT NULL DEFAULT 'pending', -- pending|accepted|rejected|completed
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS orders (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id     INTEGER NOT NULL REFERENCES items(id),
  buyer_id    INTEGER NOT NULL REFERENCES users(id),
  seller_id   INTEGER NOT NULL REFERENCES users(id),
  sale_price  INTEGER NOT NULL,
  payment_mode TEXT NOT NULL DEFAULT 'demo',
  status      TEXT NOT NULL DEFAULT 'pending',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS reviews (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  reviewer_id INTEGER NOT NULL REFERENCES users(id),
  reviewee_id INTEGER NOT NULL REFERENCES users(id),
  item_id     INTEGER REFERENCES items(id),
  rental_id   INTEGER REFERENCES rentals(id),
  request_id  INTEGER REFERENCES requests(id),
  rating      INTEGER NOT NULL,
  comment     TEXT,
  tags        TEXT NOT NULL DEFAULT '[]',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  message    TEXT NOT NULL,
  type       TEXT NOT NULL,
  link       TEXT,
  read       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS reports (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  reporter_id INTEGER NOT NULL REFERENCES users(id),
  user_id     INTEGER REFERENCES users(id),
  item_id     INTEGER REFERENCES items(id),
  reason      TEXT NOT NULL,
  description TEXT,
  status      TEXT NOT NULL DEFAULT 'open', -- open | reviewed | dismissed
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS drives (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  organization TEXT NOT NULL,
  description TEXT,
  location    TEXT,
  starts_on   TEXT,
  ends_on     TEXT,
  is_demo     INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS survey (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER REFERENCES users(id),
  answers    TEXT NOT NULL,                -- JSON {q1: "...", q2: "..."}
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_items_type   ON items(listing_type, status);
CREATE INDEX IF NOT EXISTS idx_items_owner  ON items(owner_id);
CREATE INDEX IF NOT EXISTS idx_rent_renter  ON rentals(renter_id);
CREATE INDEX IF NOT EXISTS idx_rent_owner   ON rentals(owner_id);
CREATE INDEX IF NOT EXISTS idx_notif_user   ON notifications(user_id, read);
CREATE INDEX IF NOT EXISTS idx_orders_buyer ON orders(buyer_id, created_at);
CREATE INDEX IF NOT EXISTS idx_orders_seller ON orders(seller_id, created_at);
`);

// Keep existing community databases compatible as new listing/request fields are added.
function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((entry) => entry.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

ensureColumn('items', 'brand', 'TEXT');
ensureColumn('items', 'original_price', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('items', 'quantity', 'INTEGER NOT NULL DEFAULT 1');
ensureColumn('requests', 'request_code', 'TEXT');
ensureColumn('requests', 'quantity', 'INTEGER NOT NULL DEFAULT 1');
ensureColumn('requests', 'handover_method', 'TEXT');
ensureColumn('requests', 'pickup_date', 'TEXT');
ensureColumn('requests', 'time_slot', 'TEXT');
ensureColumn('requests', 'pickup_location', 'TEXT');
db.exec(`UPDATE requests SET request_code = 'DON-' || id
  WHERE kind = 'donate' AND request_code IS NULL`);
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_requests_code
  ON requests(request_code) WHERE request_code IS NOT NULL`);
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_active_item ON orders(item_id)
  WHERE status != 'cancelled'`);

/* Small query helpers so route files stay readable. */
const all = (sql, ...p) => db.prepare(sql).all(...p);
const get = (sql, ...p) => db.prepare(sql).get(...p);
const run = (sql, ...p) => db.prepare(sql).run(...p);
const count = (sql, ...p) => Number(get(sql, ...p).n || 0);

module.exports = { db, all, get, run, count };
