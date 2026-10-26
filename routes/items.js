/* Browsing, viewing and managing clothing listings. */
const router = require('express').Router();
const {
  all, get, run, wrap, flash, requireAuth, requireVerified, upload, uploadedPaths,
  json, today, verifyCsrf, CATEGORIES, GENDERS, OCCASIONS, SIZES, CONDITIONS, REPORT_REASONS,
  DONATION_HANDOVER_METHODS, DONATION_TIME_SLOTS,
} = require('../lib/core');
const { searchItems } = require('../lib/search');

const filterOptions = {
  CATEGORIES, GENDERS, OCCASIONS, SIZES, CONDITIONS,
  DONATION_HANDOVER_METHODS, DONATION_TIME_SLOTS,
};

/* ---------- explore all listing types --------------------------------- */
router.get('/explore', wrap((req, res) => {
  const result = searchItems('all', req.query);
  res.render('items/browse', {
    title: 'Explore Collection', ...result, ...filterOptions, mode: 'all',
    heading: 'Explore Collection',
    sub: 'Find unique pieces, give them a new story.',
  });
}));

/* ---------- browse (rentals) ------------------------------------------ */
router.get('/browse', wrap((req, res) => {
  const result = searchItems('rent', req.query);
  res.render('items/browse', {
    title: 'Browse Clothes', ...result, ...filterOptions, mode: 'rent',
    heading: 'Explore Collection',
    sub: 'Find unique pieces, give them a new story.',
  });
}));

/* ---------- new listing ---------------------------------------------- */
router.get('/items/new', requireAuth, requireVerified, (req, res) => {
  const type = ['sell', 'donate'].includes(req.query.type) ? req.query.type : 'rent';
  res.render('items/form', { title: 'List an Item', item: null, type, errors: [], ...filterOptions });
});

// Reads and validates the listing form. Shared by create and edit.
function readListing(body, errors) {
  const type = ['rent', 'sell', 'donate'].includes(body.listing_type) ? body.listing_type : 'rent';
  const num = (v) => Math.max(0, Math.round(Number(v) || 0));

  const data = {
    listing_type: type,
    title: (body.title || '').trim(),
    brand: (typeof body.brand === 'string' ? body.brand.trim() : '') || null,
    quantity: type === 'donate' ? Number(body.quantity || 1) : 1,
    description: (body.description || '').trim(),
    category: body.category,
    gender: body.gender,
    occasion: body.occasion || null,
    size: body.size,
    condition: body.condition,
    location: (body.location || '').trim(),
    accessories: (body.accessories || '').trim() || null,
    rental_price: type === 'rent' ? num(body.rental_price) : 0,
    security_deposit: type === 'rent' ? num(body.security_deposit) : 0,
    sale_price: type === 'sell' ? num(body.sale_price) : 0,
    original_price: type === 'sell' ? num(body.original_price) : 0,
    available_from: type === 'rent' ? (body.available_from || null) : null,
    available_to: type === 'rent' ? (body.available_to || null) : null,
    handover_method: type === 'donate' ? (body.handover_method || '').trim() || null : null,
    measurements: JSON.stringify({
      chest: (body.chest || '').trim(), waist: (body.waist || '').trim(),
      length: (body.length || '').trim(), shoulder: (body.shoulder || '').trim(),
      sleeve: (body.sleeve || '').trim(), other: (body.other || '').trim(),
    }),
  };

  if (data.title.length < 3) errors.push('Please give the item a clear name.');
  if (data.brand && data.brand.length > 80) errors.push('Brand must be 80 characters or fewer.');
  if (type === 'donate' && (!Number.isInteger(data.quantity) || data.quantity < 1 || data.quantity > 100)) {
    errors.push('Donation quantity must be between 1 and 100.');
  }
  if (data.description.length < 15) errors.push('Please write at least a short description (15 characters or more).');
  if (!CATEGORIES.includes(data.category)) errors.push('Please choose a category.');
  if (!GENDERS.includes(data.gender)) errors.push('Please choose who the item is for.');
  if (!SIZES.includes(data.size)) errors.push('Please choose a size.');
  if (!CONDITIONS.includes(data.condition)) errors.push('Please choose the condition.');
  if (!data.location) errors.push('Please enter the locality where handover will happen.');
  if (type === 'rent' && data.rental_price < 1) errors.push('Please enter a rental price per day.');
  if (type === 'sell' && data.sale_price < 1) errors.push('Please enter a sale price.');
  if (type === 'sell' && data.original_price > 0 && data.original_price < data.sale_price) {
    errors.push('The original price must be at least the resale price.');
  }
  if (type === 'rent' && data.available_from && data.available_to
      && data.available_to < data.available_from) {
    errors.push('The availability end date must be after the start date.');
  }
  return data;
}

router.post('/items', requireAuth, requireVerified, upload.array('images', 6), verifyCsrf, wrap((req, res) => {
  const errors = [];
  const d = readListing(req.body, errors);
  const images = uploadedPaths(req.files);

  if (errors.length) {
    return res.status(400).render('items/form', {
      title: 'List an Item', item: { ...d, images: '[]' },
      type: d.listing_type, errors, ...filterOptions,
    });
  }

  const info = run(`INSERT INTO items
    (owner_id, listing_type, title, brand, quantity, description, category, gender, occasion, size,
     measurements, condition, rental_price, sale_price, original_price, security_deposit, images,
     location, available_from, available_to, handover_method, accessories)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    req.session.userId, d.listing_type, d.title, d.brand, d.quantity, d.description, d.category, d.gender,
    d.occasion, d.size, d.measurements, d.condition, d.rental_price, d.sale_price,
    d.original_price, d.security_deposit, JSON.stringify(images), d.location, d.available_from,
    d.available_to, d.handover_method, d.accessories);

  flash(req, 'success', 'Your listing is live. Thank you for keeping clothes in use.');
  res.redirect('/items/' + info.lastInsertRowid);
}));

/* ---------- my listings ---------------------------------------------- */
router.get('/my-listings', requireAuth, wrap((req, res) => {
  const items = all(`
    SELECT i.*,
      (SELECT COUNT(*) FROM rentals r WHERE r.item_id = i.id) AS bookings,
      (SELECT COUNT(*) FROM rentals r WHERE r.item_id = i.id AND r.status = 'pending') AS pending,
      (SELECT COUNT(*) FROM requests q WHERE q.item_id = i.id AND q.status = 'pending') AS enquiries
    FROM items i WHERE i.owner_id = ? AND i.status != 'removed'
    ORDER BY i.created_at DESC`, req.session.userId);
  res.render('items/my-listings', { title: 'My Listings', items });
}));

/* ---------- detail ---------------------------------------------------- */
router.get('/items/:id', wrap((req, res, next) => {
  const item = get(`SELECT i.*, u.name AS owner_name, u.id AS owner_id, u.verification,
      u.location AS owner_location, u.college, u.profile_image, u.created_at AS owner_since
    FROM items i JOIN users u ON u.id = i.owner_id
    WHERE i.id = ? AND i.status != 'removed'`, req.params.id);
  if (!item) return next();

  run('UPDATE items SET views = views + 1 WHERE id = ?', item.id);

  const ownerStats = get(`SELECT
      (SELECT ROUND(AVG(rating),1) FROM reviews WHERE reviewee_id = ?) AS rating,
      (SELECT COUNT(*) FROM reviews WHERE reviewee_id = ?) AS review_count,
      (SELECT COUNT(*) FROM rentals WHERE owner_id = ? AND status = 'completed') AS completed`,
    item.owner_id, item.owner_id, item.owner_id);

  // Dates already blocked by a confirmed booking, shown next to the date picker.
  const booked = all(`SELECT start_date, end_date FROM rentals
    WHERE item_id = ? AND status IN ('accepted','active') AND end_date >= ?
    ORDER BY start_date`, item.id, today());

  const reviews = all(`SELECT r.*, u.name AS reviewer_name FROM reviews r
    JOIN users u ON u.id = r.reviewer_id WHERE r.item_id = ?
    ORDER BY r.created_at DESC LIMIT 10`, item.id);

  const similarItems = all(`SELECT i.*, u.name AS owner_name, u.verification,
      u.location AS owner_location,
      (SELECT ROUND(AVG(rating),1) FROM reviews WHERE reviewee_id = u.id) AS owner_rating
    FROM items i JOIN users u ON u.id = i.owner_id
    WHERE i.id != ? AND i.category = ? AND i.status = 'active'
    ORDER BY i.created_at DESC LIMIT 4`, item.id, item.category);

  const isOwner = res.locals.user && res.locals.user.id === item.owner_id;
  res.render('items/detail', {
    title: item.title, item, ownerStats, booked, reviews, similarItems, isOwner, REPORT_REASONS,
    DONATION_HANDOVER_METHODS, DONATION_TIME_SLOTS,
  });
}));

/* ---------- edit / delete / status ----------------------------------- */
// Returns the listing only if the logged-in user owns it.
function ownedItem(req) {
  const item = get('SELECT * FROM items WHERE id = ?', req.params.id);
  return item && item.owner_id === req.session.userId ? item : null;
}

router.get('/items/:id/edit', requireAuth, wrap((req, res, next) => {
  const item = ownedItem(req);
  if (!item) return next();
  res.render('items/form', {
    title: 'Edit Listing', item, type: item.listing_type, errors: [], ...filterOptions,
  });
}));

router.post('/items/:id/edit', requireAuth, upload.array('images', 6), verifyCsrf, wrap((req, res, next) => {
  const item = ownedItem(req);
  if (!item) return next();

  const errors = [];
  const d = readListing({ ...req.body, listing_type: item.listing_type }, errors);
  if (errors.length) {
    return res.status(400).render('items/form', {
      title: 'Edit Listing', item: { ...item, ...d }, type: item.listing_type,
      errors, ...filterOptions,
    });
  }

  // New uploads are added to the existing images rather than replacing them.
  const images = json(item.images, []).concat(uploadedPaths(req.files));

  run(`UPDATE items SET title=?, brand=?, quantity=?, description=?, category=?, gender=?, occasion=?, size=?,
      measurements=?, condition=?, rental_price=?, sale_price=?, original_price=?, security_deposit=?,
      images=?, location=?, available_from=?, available_to=?, handover_method=?, accessories=?
    WHERE id = ?`,
    d.title, d.brand, d.quantity, d.description, d.category, d.gender, d.occasion, d.size, d.measurements,
    d.condition, d.rental_price, d.sale_price, d.original_price, d.security_deposit, JSON.stringify(images),
    d.location, d.available_from, d.available_to, d.handover_method, d.accessories, item.id);

  flash(req, 'success', 'Listing updated.');
  res.redirect('/items/' + item.id);
}));

router.post('/items/:id/status', requireAuth, wrap((req, res, next) => {
  const item = ownedItem(req);
  if (!item) return next();
  if (!['active', 'paused', 'sold', 'donated'].includes(req.body.status)) {
    return res.redirect('/my-listings');
  }
  run('UPDATE items SET status = ? WHERE id = ?', req.body.status, item.id);
  flash(req, 'success', 'Listing marked ' + req.body.status + '.');
  res.redirect(req.body.back || '/my-listings');
}));

router.post('/items/:id/delete', requireAuth, wrap((req, res, next) => {
  const item = ownedItem(req);
  if (!item) return next();

  const open = get(`SELECT id FROM rentals WHERE item_id = ?
    AND status IN ('pending','accepted','active')`, item.id);
  if (open) {
    flash(req, 'error', 'This item has an open booking. Settle it before deleting the listing.');
    return res.redirect('/my-listings');
  }
  // Soft delete, so past rentals and reviews still make sense.
  run("UPDATE items SET status = 'removed' WHERE id = ?", item.id);
  flash(req, 'success', 'Listing removed.');
  res.redirect('/my-listings');
}));

module.exports = router;
