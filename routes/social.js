/* Profiles, verification, reviews, reports and notifications. */
const router = require('express').Router();
const {
  all, get, run, count, wrap, flash, requireAuth, upload, uploadedPaths, notify,
  ratingOf, REVIEW_TAGS, REPORT_REASONS, verifyCsrf,
} = require('../lib/core');

/* ---------- my profile ------------------------------------------------- */
router.get('/profile', requireAuth, (req, res) => {
  res.render('profile/edit', { title: 'My Profile', errors: [] });
});

router.post('/profile', requireAuth, upload.single('profile_image'), verifyCsrf, wrap((req, res) => {
  const { name, phone, location, college, bio } = req.body;
  const errors = [];
  if (!name || name.trim().length < 2) errors.push('Please enter your name.');
  if (!/^[0-9+\-\s]{10,15}$/.test(phone || '')) errors.push('Please enter a valid phone number.');
  if (!location || location.trim().length < 2) errors.push('Please enter your locality.');
  if (errors.length) return res.status(400).render('profile/edit', { title: 'My Profile', errors });

  const image = req.file ? uploadedPaths([req.file])[0] : res.locals.user.profile_image;
  run(`UPDATE users SET name=?, phone=?, location=?, college=?, bio=?, profile_image=?
    WHERE id = ?`, name.trim(), phone.trim(), location.trim(),
    (college || '').trim() || null, (bio || '').trim() || null, image, req.session.userId);

  flash(req, 'success', 'Profile updated.');
  res.redirect('/users/' + req.session.userId);
}));

/* ---------- verification ----------------------------------------------- *
 * Deliberately lightweight: the member confirms their details and an admin
 * approves them. No document upload or KYC.
 */
router.get('/profile/verify', requireAuth, (req, res) =>
  res.render('profile/verify', { title: 'Community Verification' }));

router.post('/profile/verify', requireAuth, wrap((req, res) => {
  if (res.locals.user.verification === 'verified') return res.redirect('/profile');
  if (!req.body.agree) {
    flash(req, 'error', 'Please confirm the community guidelines to continue.');
    return res.redirect('/profile/verify');
  }

  run("UPDATE users SET verification = 'pending' WHERE id = ?", req.session.userId);
  for (const admin of all("SELECT id FROM users WHERE role = 'admin'")) {
    notify(admin.id, 'verification',
      `${res.locals.user.name} requested community verification.`, '/admin/users');
  }
  flash(req, 'success', 'Verification requested. An admin will review it shortly.');
  res.redirect('/dashboard');
}));

/* ---------- public profile --------------------------------------------- */
router.get('/users/:id', wrap((req, res, next) => {
  // Only public fields are selected - phone, email and password never leave here.
  const person = get(`SELECT id, name, profile_image, location, college, bio,
    verification, role, created_at FROM users WHERE id = ?`, req.params.id);
  if (!person) return next();

  const listings = all(`SELECT * FROM items WHERE owner_id = ? AND status IN ('active','paused')
    ORDER BY created_at DESC`, person.id);
  const history = all(`SELECT r.*, i.title FROM rentals r JOIN items i ON i.id = r.item_id
    WHERE (r.owner_id = ? OR r.renter_id = ?) AND r.status = 'completed'
    ORDER BY r.end_date DESC LIMIT 20`, person.id, person.id);
  const reviews = all(`SELECT r.*, u.name AS reviewer_name, i.title AS item_title
    FROM reviews r JOIN users u ON u.id = r.reviewer_id
    LEFT JOIN items i ON i.id = r.item_id
    WHERE r.reviewee_id = ? ORDER BY r.created_at DESC`, person.id);

  res.render('profile/show', {
    title: person.name, person, listings, history, reviews,
    rating: ratingOf(person.id),
    completed: count(`SELECT COUNT(*) AS n FROM rentals
      WHERE (owner_id = ? OR renter_id = ?) AND status = 'completed'`, person.id, person.id),
    tab: ['listings', 'history', 'reviews'].includes(req.query.tab) ? req.query.tab : 'listings',
  });
}));

/* ---------- reviews ---------------------------------------------------- */
router.get('/reviews', requireAuth, wrap((req, res) => {
  const received = all(`SELECT r.*, u.name AS reviewer_name, i.title AS item_title
    FROM reviews r JOIN users u ON u.id = r.reviewer_id
    LEFT JOIN items i ON i.id = r.item_id
    WHERE r.reviewee_id = ? ORDER BY r.created_at DESC`, req.session.userId);
  const given = all(`SELECT r.*, u.name AS reviewee_name, i.title AS item_title
    FROM reviews r JOIN users u ON u.id = r.reviewee_id
    LEFT JOIN items i ON i.id = r.item_id
    WHERE r.reviewer_id = ? ORDER BY r.created_at DESC`, req.session.userId);

  // Completed transactions this member has not reviewed yet.
  const pendingRentals = all(`SELECT r.id, r.item_id, i.title, 'rental' AS kind,
      CASE WHEN r.owner_id = ? THEN r.renter_id ELSE r.owner_id END AS other_id,
      CASE WHEN r.owner_id = ? THEN renter.name ELSE owner.name END AS other_name
    FROM rentals r JOIN items i ON i.id = r.item_id
    JOIN users owner ON owner.id = r.owner_id JOIN users renter ON renter.id = r.renter_id
    WHERE (r.owner_id = ? OR r.renter_id = ?) AND r.status = 'completed'
      AND NOT EXISTS (SELECT 1 FROM reviews v WHERE v.rental_id = r.id AND v.reviewer_id = ?)`,
    req.session.userId, req.session.userId, req.session.userId, req.session.userId, req.session.userId);

  const pendingRequests = all(`SELECT q.id, q.item_id, i.title, 'request' AS kind,
      CASE WHEN q.owner_id = ? THEN q.requester_id ELSE q.owner_id END AS other_id,
      CASE WHEN q.owner_id = ? THEN requester.name ELSE owner.name END AS other_name
    FROM requests q JOIN items i ON i.id = q.item_id
    JOIN users owner ON owner.id = q.owner_id JOIN users requester ON requester.id = q.requester_id
    WHERE (q.owner_id = ? OR q.requester_id = ?) AND q.status = 'completed'
      AND NOT EXISTS (SELECT 1 FROM reviews v WHERE v.request_id = q.id AND v.reviewer_id = ?)`,
    req.session.userId, req.session.userId, req.session.userId, req.session.userId, req.session.userId);

  res.render('profile/reviews', {
    title: 'Reviews', received, given, rating: ratingOf(req.session.userId),
    pending: [...pendingRentals, ...pendingRequests], REVIEW_TAGS,
  });
}));

router.post('/reviews', requireAuth, wrap((req, res) => {
  const me = req.session.userId;
  const rating = Number(req.body.rating);
  const rentalId = Number(req.body.rental_id) || null;
  const requestId = Number(req.body.request_id) || null;

  if (!(rating >= 1 && rating <= 5)) {
    flash(req, 'error', 'Please choose a rating between 1 and 5 stars.');
    return res.redirect('/reviews');
  }

  // A review is only possible for a transaction that actually completed and
  // that this member took part in.
  let deal = null;
  if (rentalId) {
    deal = get(`SELECT id, item_id, owner_id AS a, renter_id AS b FROM rentals
      WHERE id = ? AND status = 'completed' AND (owner_id = ? OR renter_id = ?)`, rentalId, me, me);
  } else if (requestId) {
    deal = get(`SELECT id, item_id, owner_id AS a, requester_id AS b FROM requests
      WHERE id = ? AND status = 'completed' AND (owner_id = ? OR requester_id = ?)`, requestId, me, me);
  }
  if (!deal) {
    flash(req, 'error', 'You can only review a transaction you completed on ReWear.');
    return res.redirect('/reviews');
  }

  const already = get(
    rentalId ? 'SELECT id FROM reviews WHERE rental_id = ? AND reviewer_id = ?'
             : 'SELECT id FROM reviews WHERE request_id = ? AND reviewer_id = ?',
    rentalId || requestId, me);
  if (already) {
    flash(req, 'error', 'You have already reviewed this transaction.');
    return res.redirect('/reviews');
  }

  const revieweeId = deal.a === me ? deal.b : deal.a;
  const tags = [].concat(req.body.tags || []).filter((t) => REVIEW_TAGS.includes(t));

  run(`INSERT INTO reviews (reviewer_id, reviewee_id, item_id, rental_id, request_id,
      rating, comment, tags) VALUES (?,?,?,?,?,?,?,?)`,
    me, revieweeId, deal.item_id, rentalId, requestId, rating,
    (req.body.comment || '').trim() || null, JSON.stringify(tags));

  notify(revieweeId, 'review', `${res.locals.user.name} left you a ${rating}-star review.`,
    '/reviews');
  flash(req, 'success', 'Thanks for the review.');
  res.redirect('/reviews');
}));

/* ---------- reports ---------------------------------------------------- */
router.post('/reports', requireAuth, wrap((req, res) => {
  const { reason, description, item_id, user_id } = req.body;
  if (!REPORT_REASONS.includes(reason)) {
    flash(req, 'error', 'Please choose a reason for the report.');
    return res.redirect(req.body.back || '/');
  }

  run(`INSERT INTO reports (reporter_id, user_id, item_id, reason, description)
    VALUES (?,?,?,?,?)`, req.session.userId, Number(user_id) || null,
    Number(item_id) || null, reason, (description || '').trim() || null);

  for (const admin of all("SELECT id FROM users WHERE role = 'admin'")) {
    notify(admin.id, 'report', `New report received: ${reason}.`, '/admin/reports');
  }
  flash(req, 'success', 'Thank you. An admin will look into this report.');
  res.redirect(req.body.back || '/');
}));

/* ---------- notifications ---------------------------------------------- */
router.get('/notifications', requireAuth, wrap((req, res) => {
  const items = all('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 60',
    req.session.userId);
  run('UPDATE notifications SET read = 1 WHERE user_id = ?', req.session.userId);
  res.render('dashboard/notifications', { title: 'Notifications', items });
}));

module.exports = router;
