/*
 * JSON API v1 - the same ReWear backend, exposed as JSON for mobile apps,
 * integrations and automated tests. The HTML site keeps working unchanged.
 *
 * Conventions
 *   - Every response is JSON. Errors look like { "error": { "code", "message" } }.
 *   - Authentication is the same session cookie the website uses. Log in with
 *     POST /api/v1/auth/login, then send the cookie with later requests.
 *   - Mutating requests (POST / PUT / DELETE) must send Content-Type: application/json.
 *     A plain HTML form cannot do that cross-site, which replaces the CSRF token
 *     for this API. CORS is not enabled, so browsers on other origins are blocked.
 *   - Personal contact details (phone numbers) are never returned.
 */
const router = require('express').Router();
const express = require('express');
const { db, all, get, run, count } = require('../db');
const {
  wrap, notify, verifyPassword, noteFailedLogin, clearFailedLogins, isLoginLocked,
  json, today, dayCount,
} = require('../lib/core');
const { searchItems } = require('../lib/search');
const { rentalDateError } = require('../lib/rental');

const fail = (res, status, code, message) => res.status(status).json({ error: { code, message } });

router.use(express.json({ limit: '100kb' }));

// Mutations must be JSON. Browsers cannot send this content type cross-site without CORS.
router.use((req, res, next) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && !req.is('application/json')) {
    return fail(res, 415, 'unsupported_media_type', 'Send mutating requests as application/json.');
  }
  next();
});

/* ---------- middleware -------------------------------------------------- */
function apiAuth(req, res, next) {
  const user = req.session.userId ? get('SELECT * FROM users WHERE id = ?', req.session.userId) : null;
  if (!user) return fail(res, 401, 'unauthorized', 'Log in to continue.');
  req.user = user;
  next();
}

function apiVerified(req, res, next) {
  if (req.user.verification !== 'verified') {
    return fail(res, 403, 'not_verified', 'Your account must be verified for this action.');
  }
  next();
}

/* ---------- output shapes (never expose phone numbers or password hashes) - */
const publicUser = (u) => ({
  id: u.id, name: u.name, location: u.location, college: u.college || null,
  bio: u.bio || null, verification: u.verification, role: u.role,
});

const itemOut = (i) => ({
  id: i.id, owner_id: i.owner_id, owner_name: i.owner_name || null,
  owner_location: i.owner_location || null, owner_verification: i.verification || null,
  listing_type: i.listing_type, title: i.title, brand: i.brand || null,
  description: i.description, category: i.category, gender: i.gender,
  occasion: i.occasion || null, size: i.size, condition: i.condition,
  measurements: json(i.measurements, null), accessories: i.accessories || null,
  location: i.location, quantity: i.quantity, status: i.status, views: i.views,
  rental_price: i.rental_price, security_deposit: i.security_deposit,
  sale_price: i.sale_price, original_price: i.original_price,
  available_from: i.available_from || null, available_to: i.available_to || null,
  handover_method: i.handover_method || null, images: json(i.images, []),
  created_at: i.created_at,
});

const RENTAL_SELECT = `SELECT r.*, i.title, i.images, i.category, i.size,
    owner.name AS owner_name, renter.name AS renter_name
  FROM rentals r
  JOIN items i ON i.id = r.item_id
  JOIN users owner ON owner.id = r.owner_id
  JOIN users renter ON renter.id = r.renter_id`;

const rentalOut = (r) => ({
  id: r.id, item_id: r.item_id, title: r.title, category: r.category, size: r.size,
  images: json(r.images, []), renter_id: r.renter_id, renter_name: r.renter_name,
  owner_id: r.owner_id, owner_name: r.owner_name, start_date: r.start_date,
  end_date: r.end_date, days: r.days, rental_price: r.rental_price,
  security_deposit: r.security_deposit, message: r.message || null, status: r.status,
  condition_before: json(r.condition_before, null), condition_after: json(r.condition_after, null),
  handover_confirmed: !!r.handover_confirmed, return_confirmed: !!r.return_confirmed,
  created_at: r.created_at,
});

/* ---------- health & session -------------------------------------------- */
router.get('/health', (req, res) => res.json({ ok: true, service: 'rewear-api', version: 1 }));

router.post('/auth/login', wrap((req, res) => {
  if (isLoginLocked(req.ip)) {
    return fail(res, 429, 'too_many_attempts', 'Too many failed logins. Wait 15 minutes and try again.');
  }
  const email = String(req.body?.email || '').toLowerCase().trim();
  const password = String(req.body?.password || '');
  const user = email ? get('SELECT * FROM users WHERE email = ?', email) : null;
  if (!user || !verifyPassword(password, user.password)) {
    noteFailedLogin(req.ip);
    return fail(res, 401, 'invalid_credentials', 'Incorrect email or password.');
  }
  clearFailedLogins(req.ip);
  req.session.regenerate((err) => {
    if (err) return fail(res, 500, 'server_error', 'Could not start a session.');
    req.session.userId = user.id;
    res.json({ user: publicUser(user) });
  });
}));

router.post('/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.get('/me', apiAuth, (req, res) => {
  const unread = count('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read = 0', req.user.id);
  res.json({ user: publicUser(req.user), unread_notifications: unread });
});

/* ---------- items ------------------------------------------------------- */
const LISTING_TYPES = ['all', 'rent', 'sell', 'donate'];

// GET /api/v1/items?type=all|rent|sell|donate&q=&category=&gender=&occasion=&size=&condition=
//                 &brand=&location=&min_price=&max_price=&from=&to=&sort=&page=
router.get('/items', wrap((req, res) => {
  const type = LISTING_TYPES.includes(req.query.type) ? req.query.type : 'all';
  const result = searchItems(type, req.query);
  res.json({
    items: result.items.map(itemOut),
    total: result.total,
    page: result.page,
    pages: result.pages,
  });
}));

router.get('/items/:id', wrap((req, res) => {
  const id = Number(req.params.id);
  const item = Number.isSafeInteger(id) && id > 0 ? get(
    `SELECT i.*, u.name AS owner_name, u.verification, u.location AS owner_location
     FROM items i JOIN users u ON u.id = i.owner_id
     WHERE i.id = ? AND i.status != 'removed'`, id) : null;
  if (!item) return fail(res, 404, 'not_found', 'Item not found.');
  const booked = all(`SELECT start_date, end_date FROM rentals
    WHERE item_id = ? AND status IN ('accepted','active') AND end_date >= ?
    ORDER BY start_date`, id, today());
  res.json({ item: itemOut(item), booked_dates: booked });
}));

/* ---------- rentals ----------------------------------------------------- */
// GET /api/v1/rentals?role=renter|owner  (default renter: things I rent)
router.get('/rentals', apiAuth, (req, res) => {
  const column = req.query.role === 'owner' ? 'r.owner_id' : 'r.renter_id';
  const rows = all(`${RENTAL_SELECT} WHERE ${column} = ? ORDER BY r.created_at DESC`, req.user.id);
  res.json({ rentals: rows.map(rentalOut) });
});

router.get('/rentals/:id', apiAuth, (req, res) => {
  const rental = get(`${RENTAL_SELECT} WHERE r.id = ?`, Number(req.params.id));
  if (!rental || (rental.owner_id !== req.user.id && rental.renter_id !== req.user.id)) {
    return fail(res, 404, 'not_found', 'Rental not found.');
  }
  res.json({ rental: rentalOut(rental) });
});

// POST /api/v1/rentals  { item_id, start_date, end_date, message? }
router.post('/rentals', apiAuth, apiVerified, wrap((req, res) => {
  const itemId = Number(req.body?.item_id);
  const item = Number.isSafeInteger(itemId) && itemId > 0
    ? get("SELECT * FROM items WHERE id = ? AND listing_type = 'rent'", itemId) : null;
  if (!item) return fail(res, 404, 'not_found', 'Rental item not found.');

  const { start_date: start, end_date: end } = req.body;
  const dateError = rentalDateError(item, req.user.id, start, end);
  if (dateError) return fail(res, 422, 'invalid_booking', dateError);

  const duplicate = get(`SELECT id FROM rentals WHERE item_id = ? AND renter_id = ? AND status = 'pending'`,
    item.id, req.user.id);
  if (duplicate) return fail(res, 409, 'duplicate_request', 'You already have a pending request for this item.');

  const days = dayCount(start, end);
  const message = typeof req.body.message === 'string' ? req.body.message.trim().slice(0, 500) || null : null;
  const info = run(`INSERT INTO rentals
    (item_id, renter_id, owner_id, start_date, end_date, days, rental_price, security_deposit, message)
    VALUES (?,?,?,?,?,?,?,?,?)`,
  item.id, req.user.id, item.owner_id, start, end, days,
  item.rental_price * days, item.security_deposit, message);

  notify(item.owner_id, 'request',
    `${req.user.name} requested to rent "${item.title}".`, '/rentals/' + info.lastInsertRowid);
  res.status(201).json({ rental: rentalOut(get(`${RENTAL_SELECT} WHERE r.id = ?`, info.lastInsertRowid)) });
}));

// POST /api/v1/rentals/:id/accept | reject (owner)   POST /api/v1/rentals/:id/cancel (either party)
router.post('/rentals/:id/:action(accept|reject|cancel)', apiAuth, wrap((req, res) => {
  const me = req.user.id;
  const rental = get(`${RENTAL_SELECT} WHERE r.id = ?`, Number(req.params.id));
  if (!rental || (rental.owner_id !== me && rental.renter_id !== me)) {
    return fail(res, 404, 'not_found', 'Rental not found.');
  }
  const { action } = req.params;

  if (action === 'cancel') {
    if (!['pending', 'accepted'].includes(rental.status)) {
      return fail(res, 409, 'invalid_state', 'This booking can no longer be cancelled.');
    }
    run("UPDATE rentals SET status = 'cancelled' WHERE id = ?", rental.id);
    const other = me === rental.owner_id ? rental.renter_id : rental.owner_id;
    notify(other, 'cancelled', `The booking for "${rental.title}" was cancelled.`, '/rentals/' + rental.id);
  } else {
    if (rental.owner_id !== me) return fail(res, 403, 'forbidden', 'Only the owner can accept or decline requests.');
    if (rental.status !== 'pending') return fail(res, 409, 'invalid_state', 'This request has already been decided.');

    if (action === 'reject') {
      run("UPDATE rentals SET status = 'rejected' WHERE id = ?", rental.id);
      notify(rental.renter_id, 'rejected', `Your request for "${rental.title}" was declined.`, '/rentals/' + rental.id);
    } else {
      // Accepting one request closes every other overlapping pending request, atomically.
      db.exec('BEGIN IMMEDIATE');
      try {
        run("UPDATE rentals SET status = 'accepted' WHERE id = ?", rental.id);
        const clashing = all(`SELECT * FROM rentals WHERE item_id = ? AND id != ?
          AND status = 'pending' AND start_date <= ? AND end_date >= ?`,
        rental.item_id, rental.id, rental.end_date, rental.start_date);
        for (const other of clashing) {
          run("UPDATE rentals SET status = 'rejected' WHERE id = ?", other.id);
          notify(other.renter_id, 'rejected',
            `"${rental.title}" was booked by someone else for those dates.`, '/rentals/' + other.id);
        }
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
      notify(rental.renter_id, 'accepted',
        `Your request for "${rental.title}" was accepted. Arrange the handover.`, '/rentals/' + rental.id);
    }
  }
  res.json({ rental: rentalOut(get(`${RENTAL_SELECT} WHERE r.id = ?`, rental.id)) });
}));

/* ---------- wishlist ---------------------------------------------------- */
router.get('/wishlist', apiAuth, (req, res) => {
  const items = all(`SELECT i.*, u.name AS owner_name, u.verification, u.location AS owner_location
    FROM wishlists w
    JOIN items i ON i.id = w.item_id
    JOIN users u ON u.id = i.owner_id
    WHERE w.user_id = ? AND i.status != 'removed'
    ORDER BY w.created_at DESC`, req.user.id);
  res.json({ items: items.map(itemOut) });
});

// PUT /api/v1/wishlist/:itemId  { "saved": true | false }   (idempotent)
router.put('/wishlist/:itemId', apiAuth, wrap((req, res) => {
  const itemId = Number(req.params.itemId);
  const item = Number.isSafeInteger(itemId) && itemId > 0
    ? get("SELECT id FROM items WHERE id = ? AND status != 'removed'", itemId) : null;
  if (!item) return fail(res, 404, 'not_found', 'Item not found.');
  if (typeof req.body?.saved !== 'boolean') return fail(res, 400, 'invalid_body', '"saved" must be true or false.');

  if (req.body.saved) {
    run('INSERT OR IGNORE INTO wishlists (user_id, item_id) VALUES (?, ?)', req.user.id, item.id);
  } else {
    run('DELETE FROM wishlists WHERE user_id = ? AND item_id = ?', req.user.id, item.id);
  }
  res.json({ item_id: item.id, saved: req.body.saved });
}));

/* ---------- notifications ----------------------------------------------- */
router.get('/notifications', apiAuth, (req, res) => {
  const rows = all(`SELECT id, type, message, link, read, created_at FROM notifications
    WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 50`, req.user.id);
  res.json({
    notifications: rows.map((n) => ({ ...n, read: !!n.read })),
    unread: count('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read = 0', req.user.id),
  });
});

router.post('/notifications/read-all', apiAuth, (req, res) => {
  run('UPDATE notifications SET read = 1 WHERE user_id = ? AND read = 0', req.user.id);
  res.json({ ok: true });
});

/* ---------- errors ------------------------------------------------------ */
router.use((req, res) => fail(res, 404, 'not_found', 'No such API endpoint.'));

router.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return fail(res, 400, 'invalid_json', 'Request body is not valid JSON.');
  if (err.type === 'entity.too.large') return fail(res, 413, 'payload_too_large', 'Request body is too large.');
  console.error('[api]', err.message);
  return fail(res, 500, 'server_error', 'Something went wrong.');
});

module.exports = router;
