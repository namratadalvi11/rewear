/*
 * Resale hub and Donation hub.
 *
 * Both are supporting modules, so instead of a payment system they use one
 * simple enquiry flow: a member sends a request, the owner accepts or declines,
 * and the handover is arranged locally and then marked complete.
 */
const router = require('express').Router();
const crypto = require('node:crypto');
const {
  all, get, run, wrap, flash, requireAuth, requireVerified, notify,
  CATEGORIES, GENDERS, OCCASIONS, SIZES, CONDITIONS,
  DONATION_HANDOVER_METHODS, DONATION_TIME_SLOTS, today,
} = require('../lib/core');
const { searchItems } = require('../lib/search');

const filterOptions = { CATEGORIES, GENDERS, OCCASIONS, SIZES, CONDITIONS };

/* ---------- resale hub ------------------------------------------------- */
router.get('/resale', wrap((req, res) => {
  const result = searchItems('sell', req.query);
  res.render('items/browse', {
    title: 'Resale Hub', ...result, ...filterOptions, mode: 'sell',
    heading: 'Give Your Unused Clothes a Second Buyer.',
    sub: 'Clothes offered for sale by members of the community.',
  });
}));

/* ---------- donation hub ---------------------------------------------- */
router.get('/donate', wrap((req, res) => {
  const result = searchItems('donate', req.query);
  const drives = all('SELECT * FROM drives ORDER BY starts_on DESC');
  const activity = all(`SELECT i.title, i.category, i.status, i.created_at, u.name AS donor
    FROM items i JOIN users u ON u.id = i.owner_id
    WHERE i.listing_type = 'donate' ORDER BY i.created_at DESC LIMIT 6`);
  res.render('items/donate', {
    title: 'Donation Hub', ...result, ...filterOptions, mode: 'donate', drives, activity,
    heading: 'Pass Wearable Clothes Forward.',
    sub: 'Clothes offered for donation, plus collection drives in the community.',
  });
}));

/* ---------- enquiries -------------------------------------------------- */
router.post('/requests', requireAuth, requireVerified, wrap((req, res) => {
  const itemId = Number(req.body.item_id);
  const item = Number.isSafeInteger(itemId) && itemId > 0
    ? get('SELECT * FROM items WHERE id = ?', itemId) : null;
  const back = '/items/' + req.body.item_id;

  if (!item || !['sell', 'donate'].includes(item.listing_type) || item.status !== 'active') {
    flash(req, 'error', 'This item is not available right now.');
    return res.redirect(back);
  }
  if (item.owner_id === req.session.userId) {
    flash(req, 'error', 'This is your own listing.');
    return res.redirect(back);
  }
  let donation = { quantity: 1, handover_method: null, pickup_date: null, time_slot: null, pickup_location: null };
  if (item.listing_type === 'donate') {
    const quantity = Number(req.body.quantity);
    const handoverMethod = req.body.handover_method;
    const pickupDate = String(req.body.pickup_date || '');
    const timeSlot = req.body.time_slot;
    const pickupLocation = String(req.body.pickup_location || '').trim();
    const validDate = /^\d{4}-\d{2}-\d{2}$/.test(pickupDate)
      && !Number.isNaN(Date.parse(pickupDate))
      && new Date(pickupDate).toISOString().slice(0, 10) === pickupDate;

    if (!Number.isInteger(quantity) || quantity < 1 || quantity > item.quantity) {
      flash(req, 'error', `Choose a quantity between 1 and ${item.quantity}.`);
      return res.redirect(back);
    }
    if (!DONATION_HANDOVER_METHODS.includes(handoverMethod)
        || !validDate || pickupDate < today()
        || !DONATION_TIME_SLOTS.includes(timeSlot)
        || !pickupLocation || pickupLocation.length > 120) {
      flash(req, 'error', 'Choose a valid collection method, future date, time slot, and locality.');
      return res.redirect(back);
    }
    donation = {
      quantity, handover_method: handoverMethod, pickup_date: pickupDate,
      time_slot: timeSlot, pickup_location: pickupLocation,
    };
  }
  const existing = get(`SELECT id FROM requests WHERE item_id = ? AND requester_id = ?
    AND status = 'pending'`, item.id, req.session.userId);
  if (existing) {
    flash(req, 'error', 'You already have a pending request for this item.');
    return res.redirect('/requests');
  }

  const requestCode = item.listing_type === 'donate'
    ? `DON-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`
    : null;
  run(`INSERT INTO requests
    (request_code, item_id, requester_id, owner_id, kind, message, quantity,
     handover_method, pickup_date, time_slot, pickup_location)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
  requestCode, item.id, req.session.userId, item.owner_id, item.listing_type,
  (req.body.message || '').trim() || null, donation.quantity, donation.handover_method,
  donation.pickup_date, donation.time_slot, donation.pickup_location);

  notify(item.owner_id, item.listing_type === 'sell' ? 'enquiry' : 'donation',
    item.listing_type === 'donate'
      ? `${res.locals.user.name} requested donation ${requestCode} for "${item.title}".`
      : `${res.locals.user.name} is interested in "${item.title}".`, '/requests');
  flash(req, 'success', item.listing_type === 'donate'
    ? `Donation request ${requestCode} sent.`
    : 'Request sent. The owner will get back to you through ReWear.');
  res.redirect('/requests');
}));

const REQUEST_COLUMNS = `q.*, i.title, i.images, i.category, i.condition, i.sale_price,
  i.location AS item_location, owner.name AS owner_name, owner.phone AS owner_phone,
  requester.name AS requester_name, requester.phone AS requester_phone`;

const REQUEST_JOINS = `FROM requests q
  JOIN items i ON i.id = q.item_id
  JOIN users owner ON owner.id = q.owner_id
  JOIN users requester ON requester.id = q.requester_id`;

router.get('/requests', requireAuth, wrap((req, res) => {
  const incoming = all(`SELECT ${REQUEST_COLUMNS} ${REQUEST_JOINS}
    WHERE q.owner_id = ? ORDER BY q.created_at DESC`, req.session.userId);
  const outgoing = all(`SELECT ${REQUEST_COLUMNS} ${REQUEST_JOINS}
    WHERE q.requester_id = ? ORDER BY q.created_at DESC`, req.session.userId);
  res.render('rentals/enquiries', { title: 'Resale & Donation Requests', incoming, outgoing });
}));

// Loads a request the logged-in user is part of.
function requestFor(req) {
  const r = get(`SELECT ${REQUEST_COLUMNS} ${REQUEST_JOINS} WHERE q.id = ?`, req.params.id);
  if (!r) return null;
  return (r.owner_id === req.session.userId || r.requester_id === req.session.userId) ? r : null;
}

router.post('/requests/:id/:action', requireAuth, wrap((req, res, next) => {
  const reqRow = requestFor(req);
  if (!reqRow) return next();
  const isOwner = reqRow.owner_id === req.session.userId;
  const { action } = req.params;

  if ((action === 'accept' || action === 'reject') && isOwner && reqRow.status === 'pending') {
    if (action === 'accept') {
      const item = get('SELECT status FROM items WHERE id = ?', reqRow.item_id);
      const anotherAccepted = get(`SELECT id FROM requests WHERE item_id = ?
        AND id != ? AND status = 'accepted'`, reqRow.item_id, reqRow.id);
      const openOrder = get(`SELECT id FROM orders WHERE item_id = ?
        AND status != 'cancelled'`, reqRow.item_id);
      if (!item || item.status !== 'active' || anotherAccepted || openOrder) {
        flash(req, 'error', 'This item is no longer available to accept another request.');
        return res.redirect('/requests');
      }
    }
    const status = action === 'accept' ? 'accepted' : 'rejected';
    run('UPDATE requests SET status = ? WHERE id = ?', status, reqRow.id);
    notify(reqRow.requester_id, 'enquiry',
      action === 'accept'
        ? `Your request for "${reqRow.title}" was accepted. Contact details are on the request.`
        : `Your request for "${reqRow.title}" was declined.`, '/requests');
    flash(req, 'success', 'Request ' + status + '.');

  } else if (action === 'complete' && isOwner && reqRow.status === 'accepted') {
    const item = get('SELECT quantity, status FROM items WHERE id = ?', reqRow.item_id);
    if (!item || item.status !== 'active') {
      flash(req, 'error', 'This listing is no longer available to complete.');
      return res.redirect('/requests');
    }
    // Handover done: the listing leaves the hub and the other pending requests close.
    run("UPDATE requests SET status = 'completed' WHERE id = ?", reqRow.id);
    if (reqRow.kind === 'sell' || reqRow.quantity >= item.quantity) {
      run('UPDATE items SET status = ? WHERE id = ?',
        reqRow.kind === 'sell' ? 'sold' : 'donated', reqRow.item_id);
    } else {
      run('UPDATE items SET quantity = quantity - ? WHERE id = ?', reqRow.quantity, reqRow.item_id);
    }
    for (const other of all(`SELECT * FROM requests WHERE item_id = ? AND id != ?
        AND status = 'pending'`, reqRow.item_id, reqRow.id)) {
      run("UPDATE requests SET status = 'rejected' WHERE id = ?", other.id);
      notify(other.requester_id, 'enquiry',
        `"${reqRow.title}" has already gone to someone else.`, '/requests');
    }
    notify(reqRow.requester_id, 'enquiry',
      `"${reqRow.title}" is marked as handed over. You can leave a review.`, '/requests');
    flash(req, 'success', 'Marked as handed over.');

  } else if (action === 'cancel' && !isOwner && reqRow.status === 'pending') {
    run("UPDATE requests SET status = 'rejected' WHERE id = ?", reqRow.id);
    flash(req, 'success', 'Request withdrawn.');

  } else {
    flash(req, 'error', 'That action is not available for this request.');
  }
  res.redirect('/requests');
}));

module.exports = router;
