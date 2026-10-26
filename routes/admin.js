/*
 * Admin area. Every route here sits behind requireAuth + requireAdmin.
 */
const router = require('express').Router();
const {
  all, get, run, count, wrap, flash, requireAuth, requireAdmin, notify, json,
} = require('../lib/core');
const { platformStats } = require('./pages');
const { QUESTIONS } = require('./community');

router.use(requireAuth, requireAdmin);

/* ---------- overview --------------------------------------------------- */
router.get('/', wrap((req, res) => {
  res.render('admin/index', {
    title: 'Admin Dashboard',
    stats: platformStats(),
    pendingVerifications: count("SELECT COUNT(*) AS n FROM users WHERE verification = 'pending'"),
    openReports: count("SELECT COUNT(*) AS n FROM reports WHERE status = 'open'"),
    surveyCount: count('SELECT COUNT(*) AS n FROM survey'),
    recent: all(`SELECT i.*, u.name AS owner_name FROM items i JOIN users u ON u.id = i.owner_id
      ORDER BY i.created_at DESC LIMIT 6`),
  });
}));

/* ---------- users ------------------------------------------------------ */
router.get('/users', wrap((req, res) => {
  const users = all(`SELECT u.*,
      (SELECT COUNT(*) FROM items WHERE owner_id = u.id AND status != 'removed') AS listings,
      (SELECT COUNT(*) FROM rentals WHERE owner_id = u.id OR renter_id = u.id) AS rentals
    FROM users u ORDER BY
      CASE u.verification WHEN 'pending' THEN 0 WHEN 'unverified' THEN 1 ELSE 2 END,
      u.created_at DESC`);
  res.render('admin/users', { title: 'Members', users });
}));

router.post('/users/:id/verification', wrap((req, res) => {
  const status = req.body.status;
  if (!['verified', 'unverified', 'pending'].includes(status)) return res.redirect('/admin/users');

  const person = get('SELECT * FROM users WHERE id = ?', req.params.id);
  if (!person) return res.redirect('/admin/users');

  run('UPDATE users SET verification = ? WHERE id = ?', status, person.id);
  notify(person.id, 'verification',
    status === 'verified'
      ? 'Your account is now verified. You can rent and list items.'
      : `Your verification status was set to ${status}.`, '/profile/verify');
  flash(req, 'success', `${person.name} is now ${status}.`);
  res.redirect('/admin/users');
}));

/* ---------- listings --------------------------------------------------- */
router.get('/listings', wrap((req, res) => {
  const items = all(`SELECT i.*, u.name AS owner_name FROM items i JOIN users u ON u.id = i.owner_id
    ORDER BY i.created_at DESC`);
  res.render('admin/listings', { title: 'All Listings', items });
}));

router.post('/listings/:id/remove', wrap((req, res) => {
  const item = get('SELECT * FROM items WHERE id = ?', req.params.id);
  if (!item) return res.redirect('/admin/listings');

  run("UPDATE items SET status = 'removed' WHERE id = ?", item.id);
  notify(item.owner_id, 'moderation',
    `Your listing "${item.title}" was removed by an admin.`, '/my-listings');
  flash(req, 'success', 'Listing removed.');
  res.redirect(req.body.back || '/admin/listings');
}));

/* ---------- rentals & enquiries ---------------------------------------- */
router.get('/rentals', wrap((req, res) => {
  const rentals = all(`SELECT r.*, i.title, o.name AS owner_name, n.name AS renter_name
    FROM rentals r JOIN items i ON i.id = r.item_id
    JOIN users o ON o.id = r.owner_id JOIN users n ON n.id = r.renter_id
    ORDER BY r.created_at DESC`);
  const requests = all(`SELECT q.*, i.title, o.name AS owner_name, u.name AS requester_name
    FROM requests q JOIN items i ON i.id = q.item_id
    JOIN users o ON o.id = q.owner_id JOIN users u ON u.id = q.requester_id
    ORDER BY q.created_at DESC`);
  const orders = all(`SELECT o.*, i.title, seller.name AS seller_name, buyer.name AS buyer_name
    FROM orders o JOIN items i ON i.id = o.item_id
    JOIN users seller ON seller.id = o.seller_id
    JOIN users buyer ON buyer.id = o.buyer_id
    ORDER BY o.created_at DESC`);
  res.render('admin/rentals', { title: 'Transactions', rentals, requests, orders });
}));

/* ---------- reports ---------------------------------------------------- */
router.get('/reports', wrap((req, res) => {
  const reports = all(`SELECT r.*, rep.name AS reporter_name, u.name AS user_name,
      i.title AS item_title
    FROM reports r JOIN users rep ON rep.id = r.reporter_id
    LEFT JOIN users u ON u.id = r.user_id LEFT JOIN items i ON i.id = r.item_id
    ORDER BY CASE r.status WHEN 'open' THEN 0 ELSE 1 END, r.created_at DESC`);
  res.render('admin/reports', { title: 'Reports', reports });
}));

router.post('/reports/:id/status', wrap((req, res) => {
  if (!['reviewed', 'dismissed', 'open'].includes(req.body.status)) return res.redirect('/admin/reports');
  run('UPDATE reports SET status = ? WHERE id = ?', req.body.status, req.params.id);
  flash(req, 'success', 'Report updated.');
  res.redirect('/admin/reports');
}));

/* ---------- donation drives ------------------------------------------- */
router.get('/drives', wrap((req, res) => {
  res.render('admin/drives', { title: 'Donation Drives',
    drives: all('SELECT * FROM drives ORDER BY starts_on DESC') });
}));

router.post('/drives', wrap((req, res) => {
  const { title, organization, description, location, starts_on, ends_on } = req.body;
  if (!title || !organization) {
    flash(req, 'error', 'A drive needs a title and an organisation.');
    return res.redirect('/admin/drives');
  }
  run(`INSERT INTO drives (title, organization, description, location, starts_on, ends_on, is_demo)
    VALUES (?,?,?,?,?,?,0)`, title.trim(), organization.trim(),
    (description || '').trim() || null, (location || '').trim() || null,
    starts_on || null, ends_on || null);
  flash(req, 'success', 'Drive added.');
  res.redirect('/admin/drives');
}));

router.post('/drives/:id/delete', wrap((req, res) => {
  run('DELETE FROM drives WHERE id = ?', req.params.id);
  flash(req, 'success', 'Drive deleted.');
  res.redirect('/admin/drives');
}));

/* ---------- survey results -------------------------------------------- */
router.get('/survey', wrap((req, res) => {
  const rows = all('SELECT * FROM survey ORDER BY created_at DESC');
  const parsed = rows.map((r) => ({ ...r, answers: json(r.answers, {}) }));

  // Count how many people picked each option, per question.
  const summary = QUESTIONS.map((q) => ({
    ...q,
    counts: q.options.map((opt) => ({
      option: opt,
      n: parsed.filter((r) => r.answers[q.id] === opt).length,
    })),
  }));
  const comments = parsed.map((r) => r.answers.comment).filter(Boolean).slice(0, 25);

  res.render('admin/survey', { title: 'Survey Results', total: parsed.length, summary, comments });
}));

module.exports = router;
