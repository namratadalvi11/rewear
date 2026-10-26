/*
 * The rental flow - the heart of ReWear.
 *
 *   request -> accepted -> handover (condition recorded + confirmed) -> active
 *           -> return (condition recorded + confirmed) -> completed -> reviews
 */
const router = require('express').Router();
const {
  all, get, run, wrap, flash, requireAuth, requireVerified, upload, uploadedPaths,
  notify, json, dayCount, DAMAGE_LEVELS, REVIEW_TAGS, verifyCsrf,
} = require('../lib/core');
const { rentalDateError } = require('../lib/rental');

/* ---------- lists ------------------------------------------------------ */
const RENTAL_COLUMNS = `r.*, i.title, i.images, i.category, i.size,
  owner.name AS owner_name, renter.name AS renter_name`;

const RENTAL_JOINS = `FROM rentals r
  JOIN items i ON i.id = r.item_id
  JOIN users owner ON owner.id = r.owner_id
  JOIN users renter ON renter.id = r.renter_id`;

// Things I have rented (or asked to rent) from other people.
router.get('/', requireAuth, wrap((req, res) => {
  const rentals = all(`SELECT ${RENTAL_COLUMNS} ${RENTAL_JOINS}
    WHERE r.renter_id = ? ORDER BY r.created_at DESC`, req.session.userId);
  res.render('rentals/my-rentals', { title: 'My Rentals', rentals });
}));

// Requests other people have made for my listings.
router.get('/requests', requireAuth, wrap((req, res) => {
  const rentals = all(`SELECT ${RENTAL_COLUMNS} ${RENTAL_JOINS}
    WHERE r.owner_id = ? ORDER BY
      CASE r.status WHEN 'pending' THEN 0 WHEN 'accepted' THEN 1 WHEN 'active' THEN 2 ELSE 3 END,
      r.created_at DESC`, req.session.userId);
  res.render('rentals/requests', { title: 'Rental Requests', rentals });
}));

/* ---------- request a rental ------------------------------------------ */
router.post('/request', requireAuth, requireVerified, wrap((req, res) => {
  const { item_id, start_date, end_date, message } = req.body;
  const item = get("SELECT * FROM items WHERE id = ? AND listing_type = 'rent'", item_id);
  const back = '/items/' + item_id;

  if (!item || item.status !== 'active') {
    flash(req, 'error', 'This item is not available for rent right now.');
    return res.redirect(back);
  }
  const dateError = rentalDateError(item, req.session.userId, start_date, end_date);
  if (dateError) {
    flash(req, 'error', dateError);
    return res.redirect(back);
  }

  const duplicate = get(`SELECT id FROM rentals WHERE item_id = ? AND renter_id = ?
    AND status = 'pending'`, item.id, req.session.userId);
  if (duplicate) {
    flash(req, 'error', 'You already have a pending request for this item.');
    return res.redirect('/rentals/' + duplicate.id);
  }

  const days = dayCount(start_date, end_date);
  const info = run(`INSERT INTO rentals
    (item_id, renter_id, owner_id, start_date, end_date, days, rental_price,
     security_deposit, message)
    VALUES (?,?,?,?,?,?,?,?,?)`,
    item.id, req.session.userId, item.owner_id, start_date, end_date, days,
    item.rental_price * days, item.security_deposit, (message || '').trim() || null);

  notify(item.owner_id, 'request',
    `${res.locals.user.name} requested to rent "${item.title}".`,
    '/rentals/' + info.lastInsertRowid);
  flash(req, 'success', 'Request sent. The owner will respond shortly.');
  res.redirect('/rentals/' + info.lastInsertRowid);
}));

/* ---------- detail ---------------------------------------------------- */
// Loads a rental and checks the logged-in user is actually part of it.
function rentalFor(req) {
  const r = get(`SELECT ${RENTAL_COLUMNS}, i.accessories, i.location AS item_location,
      i.measurements, owner.phone AS owner_phone, renter.phone AS renter_phone,
      owner.location AS owner_location, renter.location AS renter_location
    ${RENTAL_JOINS} WHERE r.id = ?`, req.params.id);
  if (!r) return null;
  const me = req.session.userId;
  if (r.owner_id !== me && r.renter_id !== me) return null;
  return r;
}

router.get('/:id', requireAuth, wrap((req, res, next) => {
  const rental = rentalFor(req);
  if (!rental) return next();

  const isOwner = rental.owner_id === req.session.userId;
  const myReview = get('SELECT id FROM reviews WHERE rental_id = ? AND reviewer_id = ?',
    rental.id, req.session.userId);

  res.render('rentals/detail', {
    title: 'Rental #' + rental.id, rental, isOwner,
    before: json(rental.condition_before, null),
    after: json(rental.condition_after, null),
    myReview, DAMAGE_LEVELS, REVIEW_TAGS,
  });
}));

/* ---------- owner decisions ------------------------------------------- */
router.post('/:id/accept', requireAuth, wrap((req, res, next) => {
  const rental = rentalFor(req);
  if (!rental || rental.owner_id !== req.session.userId) return next();
  if (rental.status !== 'pending') {
    flash(req, 'error', 'This request has already been dealt with.');
    return res.redirect('/rentals/' + rental.id);
  }

  run("UPDATE rentals SET status = 'accepted' WHERE id = ?", rental.id);

  // Any other pending request for overlapping dates can no longer be honoured.
  const clashing = all(`SELECT * FROM rentals WHERE item_id = ? AND id != ?
    AND status = 'pending' AND start_date <= ? AND end_date >= ?`,
    rental.item_id, rental.id, rental.end_date, rental.start_date);
  for (const other of clashing) {
    run("UPDATE rentals SET status = 'rejected' WHERE id = ?", other.id);
    notify(other.renter_id, 'rejected',
      `"${rental.title}" was booked by someone else for those dates.`, '/rentals/' + other.id);
  }

  notify(rental.renter_id, 'accepted',
    `Your request for "${rental.title}" was accepted. Arrange the handover.`,
    '/rentals/' + rental.id);
  flash(req, 'success', 'Request accepted. Record the item condition before handover.');
  res.redirect('/rentals/' + rental.id);
}));

router.post('/:id/reject', requireAuth, wrap((req, res, next) => {
  const rental = rentalFor(req);
  if (!rental || rental.owner_id !== req.session.userId) return next();
  if (rental.status !== 'pending') return res.redirect('/rentals/' + rental.id);

  run("UPDATE rentals SET status = 'rejected' WHERE id = ?", rental.id);
  notify(rental.renter_id, 'rejected',
    `Your request for "${rental.title}" was declined.`, '/rentals/' + rental.id);
  flash(req, 'success', 'Request declined.');
  res.redirect('/rentals/requests');
}));

router.post('/:id/cancel', requireAuth, wrap((req, res, next) => {
  const rental = rentalFor(req);
  if (!rental) return next();
  if (!['pending', 'accepted'].includes(rental.status)) {
    flash(req, 'error', 'This booking can no longer be cancelled.');
    return res.redirect('/rentals/' + rental.id);
  }

  run("UPDATE rentals SET status = 'cancelled' WHERE id = ?", rental.id);
  const other = rental.owner_id === req.session.userId ? rental.renter_id : rental.owner_id;
  notify(other, 'cancelled',
    `The booking for "${rental.title}" was cancelled by ${res.locals.user.name}.`,
    '/rentals/' + rental.id);
  flash(req, 'success', 'Booking cancelled.');
  res.redirect('/rentals/' + rental.id);
}));

/* ---------- condition records ----------------------------------------- */
// Builds the condition record that is stored as JSON on the rental row.
function readCondition(body, files, who) {
  return {
    recorded_by: who,
    recorded_at: new Date().toISOString(),
    damage: DAMAGE_LEVELS.includes(body.damage) ? body.damage : DAMAGE_LEVELS[0],
    notes: (body.notes || '').trim(),
    marks: (body.marks || '').trim(),
    accessories: (body.accessories || '').trim(),
    photos: uploadedPaths(files),
  };
}

// Owner records the condition before handing the item over.
router.post('/:id/handover', requireAuth, upload.array('photos', 6), verifyCsrf, wrap((req, res, next) => {
  const rental = rentalFor(req);
  if (!rental || rental.owner_id !== req.session.userId) return next();
  if (rental.status !== 'accepted') {
    flash(req, 'error', 'The condition record can only be added to an accepted booking.');
    return res.redirect('/rentals/' + rental.id);
  }

  const record = readCondition(req.body, req.files, res.locals.user.name);
  run('UPDATE rentals SET condition_before = ? WHERE id = ?', JSON.stringify(record), rental.id);
  notify(rental.renter_id, 'handover',
    `Condition record added for "${rental.title}". Please confirm it at handover.`,
    '/rentals/' + rental.id);
  flash(req, 'success', 'Condition recorded. Ask the renter to confirm it at handover.');
  res.redirect('/rentals/' + rental.id);
}));

// Renter agrees with the recorded condition - the rental period starts.
router.post('/:id/confirm-handover', requireAuth, wrap((req, res, next) => {
  const rental = rentalFor(req);
  if (!rental || rental.renter_id !== req.session.userId) return next();
  if (rental.status !== 'accepted' || !rental.condition_before) {
    flash(req, 'error', 'The owner needs to record the item condition first.');
    return res.redirect('/rentals/' + rental.id);
  }

  run("UPDATE rentals SET handover_confirmed = 1, status = 'active' WHERE id = ?", rental.id);
  run("UPDATE items SET status = 'rented' WHERE id = ?", rental.item_id);
  notify(rental.owner_id, 'handover',
    `${res.locals.user.name} confirmed the handover of "${rental.title}".`,
    '/rentals/' + rental.id);
  flash(req, 'success', 'Handover confirmed. Enjoy the outfit, and return it on time.');
  res.redirect('/rentals/' + rental.id);
}));

// Owner records the condition the item came back in.
router.post('/:id/return', requireAuth, upload.array('photos', 6), verifyCsrf, wrap((req, res, next) => {
  const rental = rentalFor(req);
  if (!rental || rental.owner_id !== req.session.userId) return next();
  if (rental.status !== 'active') {
    flash(req, 'error', 'This booking is not currently active.');
    return res.redirect('/rentals/' + rental.id);
  }

  const record = readCondition(req.body, req.files, res.locals.user.name);
  run("UPDATE rentals SET condition_after = ?, status = 'returned' WHERE id = ?",
    JSON.stringify(record), rental.id);
  run("UPDATE items SET status = 'active' WHERE id = ?", rental.item_id);
  notify(rental.renter_id, 'returned',
    `Return condition recorded for "${rental.title}". Please confirm to close the booking.`,
    '/rentals/' + rental.id);
  flash(req, 'success', 'Return recorded. The renter can now confirm and close the booking.');
  res.redirect('/rentals/' + rental.id);
}));

// Renter confirms the return - booking completed, both sides may review.
router.post('/:id/complete', requireAuth, wrap((req, res, next) => {
  const rental = rentalFor(req);
  if (!rental || rental.renter_id !== req.session.userId) return next();
  if (rental.status !== 'returned') {
    flash(req, 'error', 'The owner needs to record the return first.');
    return res.redirect('/rentals/' + rental.id);
  }

  run("UPDATE rentals SET return_confirmed = 1, status = 'completed' WHERE id = ?", rental.id);
  notify(rental.owner_id, 'completed',
    `"${rental.title}" is back with you and the booking is complete. You can leave a review.`,
    '/rentals/' + rental.id);
  flash(req, 'success', 'Booking completed. You can now leave a review.');
  res.redirect('/rentals/' + rental.id);
}));

module.exports = router;
