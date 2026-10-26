/* Public informational pages: home, how it works, about. */
const router = require('express').Router();
const { all, count, wrap, OCCASIONS } = require('../lib/core');

function platformStats() {
  return {
    users: count('SELECT COUNT(*) AS n FROM users'),
    verified: count("SELECT COUNT(*) AS n FROM users WHERE verification = 'verified'"),
    listed: count("SELECT COUNT(*) AS n FROM items WHERE status != 'removed'"),
    rentals: count("SELECT COUNT(*) AS n FROM rentals WHERE status = 'completed'"),
    activeRentals: count("SELECT COUNT(*) AS n FROM rentals WHERE status IN ('accepted','active')"),
    resold: count("SELECT COUNT(*) AS n FROM items WHERE listing_type='sell' AND status='sold'"),
    donated: count("SELECT COUNT(*) AS n FROM items WHERE listing_type='donate' AND status='donated'"),
    reviews: count('SELECT COUNT(*) AS n FROM reviews'),
  };
}

router.get('/', wrap((req, res) => {
  const featured = all(`
    SELECT i.*, u.name AS owner_name, u.verification, u.location AS owner_location,
           (SELECT ROUND(AVG(rating),1) FROM reviews WHERE reviewee_id = u.id) AS owner_rating
    FROM items i JOIN users u ON u.id = i.owner_id
    WHERE i.listing_type = 'rent' AND i.status = 'active'
    ORDER BY (SELECT COUNT(*) FROM rentals r WHERE r.item_id = i.id) DESC, i.created_at DESC
    LIMIT 8`);
  res.render('home', { title: 'ReWear - Wear More. Waste Less.', featured,
    occasions: OCCASIONS, stats: platformStats() });
}));

router.get('/how-it-works', (req, res) =>
  res.render('how-it-works', { title: 'How ReWear Works' }));

router.get('/about', (req, res) =>
  res.render('about', { title: 'About ReWear' }));

module.exports = router;
module.exports.platformStats = platformStats;
