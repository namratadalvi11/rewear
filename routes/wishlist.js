/* Saved listings for the logged-in member. */
const router = require('express').Router();
const { all, get, run, wrap, flash, requireAuth } = require('../lib/core');

router.get('/wishlist', requireAuth, wrap((req, res) => {
  const items = all(`SELECT i.*, u.name AS owner_name, u.verification,
      u.location AS owner_location,
      (SELECT ROUND(AVG(rating),1) FROM reviews WHERE reviewee_id = u.id) AS owner_rating
    FROM wishlists w
    JOIN items i ON i.id = w.item_id
    JOIN users u ON u.id = i.owner_id
    WHERE w.user_id = ? AND i.status != 'removed'
    ORDER BY w.created_at DESC`, req.session.userId);
  res.render('wishlist', { title: 'Wishlist', items });
}));

router.post('/wishlist/:itemId/:action(add|remove)', requireAuth, wrap((req, res, next) => {
  const itemId = Number(req.params.itemId);
  if (!Number.isSafeInteger(itemId) || itemId < 1) return next();

  const item = get("SELECT id FROM items WHERE id = ? AND status != 'removed'", itemId);
  if (!item) return next();

  if (req.params.action === 'remove') {
    run('DELETE FROM wishlists WHERE user_id = ? AND item_id = ?', req.session.userId, item.id);
  } else {
    run(`INSERT INTO wishlists (user_id, item_id) VALUES (?, ?)
      ON CONFLICT (user_id, item_id) DO NOTHING`, req.session.userId, item.id);
  }

  const back = typeof req.body.back === 'string'
    && req.body.back.startsWith('/')
    && !req.body.back.startsWith('//')
    && !/[\r\n\\]/.test(req.body.back)
    ? req.body.back : '/wishlist';
  flash(req, 'success', req.params.action === 'remove'
    ? 'Item removed from your wishlist.' : 'Item saved to your wishlist.');
  res.redirect(back);
}));

module.exports = router;
