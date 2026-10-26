/* The logged-in member's home screen. */
const router = require('express').Router();
const { all, get, count, wrap, requireAuth, ratingOf, today } = require('../lib/core');

router.get('/', requireAuth, wrap((req, res) => {
  const me = req.session.userId;

  const stats = {
    active: count(`SELECT COUNT(*) AS n FROM rentals WHERE renter_id = ? AND status = 'active'`, me),
    upcoming: count(`SELECT COUNT(*) AS n FROM rentals WHERE renter_id = ?
      AND status = 'accepted' AND end_date >= ?`, me, today()),
    listings: count(`SELECT COUNT(*) AS n FROM items WHERE owner_id = ? AND status != 'removed'`, me),
    pending: count(`SELECT COUNT(*) AS n FROM rentals WHERE owner_id = ? AND status = 'pending'`, me),
    completed: count(`SELECT COUNT(*) AS n FROM rentals
      WHERE (owner_id = ? OR renter_id = ?) AND status = 'completed'`, me, me),
    enquiries: count(`SELECT COUNT(*) AS n FROM requests WHERE owner_id = ? AND status = 'pending'`, me),
    orders: count(`SELECT COUNT(*) AS n FROM orders
      WHERE (buyer_id = ? OR seller_id = ?) AND status != 'cancelled'`, me, me),
  };

  const upcoming = all(`SELECT r.*, i.title, i.images, i.category, u.name AS owner_name
    FROM rentals r JOIN items i ON i.id = r.item_id JOIN users u ON u.id = r.owner_id
    WHERE r.renter_id = ? AND r.status IN ('accepted','active') AND r.end_date >= ?
    ORDER BY r.start_date LIMIT 4`, me, today());

  const requests = all(`SELECT r.*, i.title, i.images, i.category, u.name AS renter_name
    FROM rentals r JOIN items i ON i.id = r.item_id JOIN users u ON u.id = r.renter_id
    WHERE r.owner_id = ? AND r.status = 'pending' ORDER BY r.created_at DESC LIMIT 4`, me);

  const listings = all(`SELECT * FROM items WHERE owner_id = ? AND status != 'removed'
    ORDER BY created_at DESC LIMIT 4`, me);

  const activity = all(`SELECT * FROM notifications WHERE user_id = ?
    ORDER BY created_at DESC LIMIT 6`, me);

  // A gentle nudge when something is due back within two days.
  const dueSoon = all(`SELECT r.id, i.title, r.end_date FROM rentals r
    JOIN items i ON i.id = r.item_id
    WHERE r.renter_id = ? AND r.status = 'active' AND r.end_date <= date('now','+2 day')`, me);

  res.render('dashboard/index', {
    title: 'Dashboard', stats, upcoming, requests, listings, activity, dueSoon,
    rating: ratingOf(me),
  });
}));

module.exports = router;
