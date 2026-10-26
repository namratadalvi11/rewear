/*
 * Resale orders run in a clearly labelled demo mode until a payment provider
 * is configured. No payment details are collected or charges attempted.
 */
const router = require('express').Router();
const { db, all, get, run } = require('../db');
const { wrap, flash, requireAuth, requireVerified, notify } = require('../lib/core');

const ORDER_SELECT = `o.*, i.title, i.images, i.category, i.size, i.condition,
  i.location AS item_location, buyer.name AS buyer_name, buyer.phone AS buyer_phone,
  seller.name AS seller_name, seller.phone AS seller_phone`;
const ORDER_JOINS = `FROM orders o
  JOIN items i ON i.id = o.item_id
  JOIN users buyer ON buyer.id = o.buyer_id
  JOIN users seller ON seller.id = o.seller_id`;

router.get('/orders', requireAuth, wrap((req, res) => {
  const bought = all(`SELECT ${ORDER_SELECT} ${ORDER_JOINS}
    WHERE o.buyer_id = ? ORDER BY o.created_at DESC`, req.session.userId);
  const sold = all(`SELECT ${ORDER_SELECT} ${ORDER_JOINS}
    WHERE o.seller_id = ? ORDER BY o.created_at DESC`, req.session.userId);
  res.render('orders/index', { title: 'Resale Orders', bought, sold });
}));

router.get('/orders/:id', requireAuth, wrap((req, res, next) => {
  const order = get(`SELECT ${ORDER_SELECT} ${ORDER_JOINS} WHERE o.id = ?`, req.params.id);
  if (!order || (order.buyer_id !== req.session.userId && order.seller_id !== req.session.userId)) {
    return next();
  }
  res.render('orders/detail', {
    title: `Order #${order.id}`,
    order,
    isSeller: order.seller_id === req.session.userId,
    canSeeContact: ['accepted', 'ready', 'completed'].includes(order.status),
  });
}));

router.post('/orders', requireAuth, requireVerified, wrap((req, res) => {
  const itemId = Number(req.body.item_id);
  if (!Number.isSafeInteger(itemId) || itemId < 1) {
    flash(req, 'error', 'Choose a valid resale listing.');
    return res.redirect('/resale');
  }

  db.exec('BEGIN IMMEDIATE');
  try {
    const item = get("SELECT * FROM items WHERE id = ? AND listing_type = 'sell' AND status = 'active'", itemId);
    if (!item) {
      db.exec('ROLLBACK');
      flash(req, 'error', 'This listing has already been ordered or is no longer available.');
      return res.redirect('/resale');
    }
    if (item.owner_id === req.session.userId) {
      db.exec('ROLLBACK');
      flash(req, 'error', 'You cannot order your own listing.');
      return res.redirect(`/items/${item.id}`);
    }
    const acceptedRequest = get(`SELECT id FROM requests WHERE item_id = ?
      AND kind = 'sell' AND status = 'accepted'`, item.id);
    if (acceptedRequest) {
      db.exec('ROLLBACK');
      flash(req, 'error', 'The seller is already arranging this item with another member.');
      return res.redirect(`/items/${item.id}`);
    }

    const info = run(`INSERT INTO orders (item_id, buyer_id, seller_id, sale_price, payment_mode)
      VALUES (?,?,?,?, 'demo')`,
    item.id, req.session.userId, item.owner_id, item.sale_price);
    const changed = run("UPDATE items SET status = 'sold' WHERE id = ? AND status = 'active'", item.id);
    if (Number(changed.changes) !== 1) {
      throw new Error(`Could not reserve resale listing ${item.id} for order ${info.lastInsertRowid}.`);
    }

    for (const request of all(`SELECT id, requester_id FROM requests
        WHERE item_id = ? AND kind = 'sell' AND status = 'pending'`, item.id)) {
      run("UPDATE requests SET status = 'rejected' WHERE id = ?", request.id);
      notify(request.requester_id, 'enquiry',
        `"${item.title}" is no longer available.`, '/requests');
    }
    notify(item.owner_id, 'order', `A demo-mode order was placed for "${item.title}".`, '/orders');
    notify(req.session.userId, 'order',
      `Order #${info.lastInsertRowid} confirmed. No payment was collected.`, `/orders/${info.lastInsertRowid}`);
    db.exec('COMMIT');
    flash(req, 'success', 'Demo order confirmed. No payment was collected.');
    res.redirect(`/orders/${info.lastInsertRowid}`);
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}));

router.post('/orders/:id/status', requireAuth, wrap((req, res, next) => {
  const order = get('SELECT * FROM orders WHERE id = ?', req.params.id);
  if (!order || (order.buyer_id !== req.session.userId && order.seller_id !== req.session.userId)) {
    return next();
  }

  const action = req.body.action;
  const isSeller = order.seller_id === req.session.userId;
  const nextStatus = {
    accept: 'accepted',
    ready: 'ready',
    complete: 'completed',
  }[action];

  if (action === 'cancel' && ['pending', 'accepted'].includes(order.status)) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const changed = run(`UPDATE orders SET status = 'cancelled'
        WHERE id = ? AND status IN ('pending','accepted')`, order.id);
      if (Number(changed.changes) !== 1) {
        db.exec('ROLLBACK');
        flash(req, 'error', 'This order has already changed and cannot be cancelled.');
        return res.redirect(`/orders/${order.id}`);
      }
      run("UPDATE items SET status = 'active' WHERE id = ? AND status = 'sold'", order.item_id);
      const otherId = isSeller ? order.buyer_id : order.seller_id;
      notify(otherId, 'order', `Order #${order.id} was cancelled.`, `/orders/${order.id}`);
      db.exec('COMMIT');
      flash(req, 'success', 'Order cancelled. No payment was collected.');
      return res.redirect(`/orders/${order.id}`);
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }

  const allowed = isSeller
    && ((action === 'accept' && order.status === 'pending')
      || (action === 'ready' && order.status === 'accepted')
      || (action === 'complete' && order.status === 'ready'));
  if (!allowed) {
    flash(req, 'error', 'That order update is not available.');
    return res.redirect(`/orders/${order.id}`);
  }

  run('UPDATE orders SET status = ? WHERE id = ?', nextStatus, order.id);
  const otherId = isSeller ? order.buyer_id : order.seller_id;
  notify(otherId, 'order', `Order #${order.id} is now ${nextStatus}.`, `/orders/${order.id}`);
  flash(req, 'success', `Order marked ${nextStatus}.`);
  res.redirect(`/orders/${order.id}`);
}));

module.exports = router;
