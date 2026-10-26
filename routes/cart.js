/* Session-backed rental basket; checkout creates owner-approved booking requests. */
const router = require('express').Router();
const { db, all, get, run } = require('../db');
const { wrap, flash, requireAuth, requireVerified, notify, dayCount } = require('../lib/core');
const { isIsoDate, rentalDateError } = require('../lib/rental');

router.get('/cart', requireAuth, wrap((req, res) => {
  const entries = Array.isArray(req.session.rentalCart) ? req.session.rentalCart : [];
  const items = entries.map((entry) => {
    const item = get(`SELECT i.*, u.name AS owner_name FROM items i
      JOIN users u ON u.id = i.owner_id WHERE i.id = ?`, entry.item_id);
    const validDates = isIsoDate(entry.start_date) && isIsoDate(entry.end_date);
    const days = validDates ? dayCount(entry.start_date, entry.end_date) : 0;
    return {
      ...entry,
      item,
      days,
      rentTotal: item && days > 0 ? item.rental_price * days : 0,
      deposit: item ? item.security_deposit : 0,
      error: rentalDateError(item, req.session.userId, entry.start_date, entry.end_date),
    };
  });
  res.render('cart', {
    title: 'Rental Cart',
    cartItems: items,
    rentTotal: items.reduce((sum, entry) => sum + entry.rentTotal, 0),
    depositTotal: items.reduce((sum, entry) => sum + entry.deposit, 0),
    canCheckout: items.length > 0 && items.every((entry) => !entry.error),
  });
}));

router.post('/cart/add', requireAuth, requireVerified, wrap((req, res) => {
  const itemId = Number(req.body.item_id);
  const item = Number.isSafeInteger(itemId) && itemId > 0
    ? get("SELECT * FROM items WHERE id = ? AND listing_type = 'rent'", itemId) : null;
  const dateError = rentalDateError(item, req.session.userId, req.body.start_date, req.body.end_date);
  if (dateError) {
    flash(req, 'error', dateError);
    return res.redirect(item ? `/items/${item.id}` : '/browse');
  }

  const pending = get(`SELECT id FROM rentals WHERE item_id = ? AND renter_id = ?
    AND status = 'pending'`, item.id, req.session.userId);
  if (pending) {
    flash(req, 'error', 'You already have a pending request for this item.');
    return res.redirect(`/rentals/${pending.id}`);
  }
  const cart = Array.isArray(req.session.rentalCart) ? req.session.rentalCart : [];
  if (cart.some((entry) => Number(entry.item_id) === item.id)) {
    flash(req, 'error', 'This item is already in your rental cart.');
    return res.redirect('/cart');
  }

  cart.push({ item_id: item.id, start_date: req.body.start_date, end_date: req.body.end_date });
  req.session.rentalCart = cart;
  flash(req, 'success', 'Added to your rental cart.');
  res.redirect('/cart');
}));

router.post('/cart/remove', requireAuth, wrap((req, res) => {
  const itemId = Number(req.body.item_id);
  const cart = Array.isArray(req.session.rentalCart) ? req.session.rentalCart : [];
  req.session.rentalCart = cart.filter((entry) => Number(entry.item_id) !== itemId);
  flash(req, 'success', 'Item removed from your rental cart.');
  res.redirect('/cart');
}));

router.post('/cart/checkout', requireAuth, requireVerified, wrap((req, res) => {
  const cart = Array.isArray(req.session.rentalCart) ? req.session.rentalCart : [];
  if (!cart.length) {
    flash(req, 'error', 'Your rental cart is empty.');
    return res.redirect('/cart');
  }

  const created = [];
  db.exec('BEGIN IMMEDIATE');
  try {
    const seen = new Set();
    for (const entry of cart) {
      const item = get("SELECT * FROM items WHERE id = ? AND listing_type = 'rent'", entry.item_id);
      const dateError = rentalDateError(item, req.session.userId, entry.start_date, entry.end_date);
      if (dateError) {
        db.exec('ROLLBACK');
        flash(req, 'error', `${item ? item.title : 'A cart item'}: ${dateError}`);
        return res.redirect('/cart');
      }
      if (seen.has(item.id)) {
        db.exec('ROLLBACK');
        flash(req, 'error', 'The same listing cannot be checked out twice.');
        return res.redirect('/cart');
      }
      seen.add(item.id);

      const pending = get(`SELECT id FROM rentals WHERE item_id = ? AND renter_id = ?
        AND status = 'pending'`, item.id, req.session.userId);
      if (pending) {
        db.exec('ROLLBACK');
        flash(req, 'error', `${item.title}: you already have a pending request for this item.`);
        return res.redirect('/cart');
      }

      const days = dayCount(entry.start_date, entry.end_date);
      const info = run(`INSERT INTO rentals
        (item_id, renter_id, owner_id, start_date, end_date, days, rental_price,
         security_deposit, message)
        VALUES (?,?,?,?,?,?,?,?,?)`,
      item.id, req.session.userId, item.owner_id, entry.start_date, entry.end_date,
      days, item.rental_price * days, item.security_deposit, 'Requested from rental cart.');
      created.push(Number(info.lastInsertRowid));
      notify(item.owner_id, 'request',
        `${res.locals.user.name} requested to rent "${item.title}" from the rental cart.`,
        `/rentals/${info.lastInsertRowid}`);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  req.session.rentalCart = [];
  flash(req, 'success',
    `${created.length} rental request${created.length === 1 ? '' : 's'} submitted. Owners must accept; no payment was collected.`);
  res.redirect('/rentals');
}));

module.exports = router;
