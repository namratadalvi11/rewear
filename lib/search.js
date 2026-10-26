/*
 * One search/filter function shared by the Browse page, the Resale hub and the
 * Donation hub. Filters arrive as query-string parameters so links stay shareable
 * and filters survive a new search (e.g. /browse?category=Sarees&occasion=Wedding).
 */
const { all, count } = require('../db');

const PER_PAGE = 12;

const SORTS = {
  newest: 'i.created_at DESC',
  price_asc: 'price ASC',
  price_desc: 'price DESC',
  most_rented: 'rent_count DESC, i.created_at DESC',
  rating: 'owner_rating IS NULL, owner_rating DESC, i.created_at DESC',
};

function searchItems(listingType, q) {
  const where = ["i.status IN ('active','paused')"];
  const params = [];
  if (listingType !== 'all') {
    where.push('i.listing_type = ?');
    params.push(listingType);
  }

  if (q.q) {
    where.push('(i.title LIKE ? OR i.brand LIKE ? OR i.category LIKE ? OR i.occasion LIKE ? OR i.description LIKE ?)');
    const like = `%${q.q.trim()}%`;
    params.push(like, like, like, like, like);
  }
  for (const [field, col] of [['category', 'i.category'], ['gender', 'i.gender'],
    ['occasion', 'i.occasion'], ['size', 'i.size'], ['condition', 'i.condition']]) {
    if (q[field]) { where.push(`${col} = ?`); params.push(q[field]); }
  }
  if (q.brand) { where.push('i.brand LIKE ?'); params.push(`%${q.brand.trim()}%`); }
  if (q.location) { where.push('i.location LIKE ?'); params.push(`%${q.location.trim()}%`); }

  const priceCol = listingType === 'all'
    ? "CASE WHEN i.listing_type = 'rent' THEN i.rental_price WHEN i.listing_type = 'sell' THEN i.sale_price ELSE 0 END"
    : (listingType === 'rent' ? 'i.rental_price' : 'i.sale_price');
  if (q.min_price) { where.push(`${priceCol} >= ?`); params.push(Number(q.min_price)); }
  if (q.max_price) { where.push(`${priceCol} <= ?`); params.push(Number(q.max_price)); }

  // Availability: the item's own window must cover the dates and no confirmed
  // rental may overlap them.
  if ((listingType === 'rent' || listingType === 'all') && q.from && q.to) {
    where.push("(i.listing_type != 'rent' OR (i.available_from IS NULL OR i.available_from <= ?))");
    params.push(q.from);
    where.push("(i.listing_type != 'rent' OR (i.available_to IS NULL OR i.available_to >= ?))");
    params.push(q.to);
    where.push(`(i.listing_type != 'rent' OR NOT EXISTS (SELECT 1 FROM rentals r WHERE r.item_id = i.id
      AND r.status IN ('accepted','active') AND r.start_date <= ? AND r.end_date >= ?))`);
    params.push(q.to, q.from);
  }

  const sql = `
    SELECT i.*, u.name AS owner_name, u.verification, u.location AS owner_location,
      ${priceCol} AS price,
      (SELECT ROUND(AVG(rating),1) FROM reviews WHERE reviewee_id = u.id) AS owner_rating,
      (SELECT COUNT(*) FROM rentals r WHERE r.item_id = i.id) AS rent_count
    FROM items i JOIN users u ON u.id = i.owner_id
    WHERE ${where.join(' AND ')}
    ORDER BY ${SORTS[q.sort] || SORTS.newest}`;

  const total = count(
    `SELECT COUNT(*) AS n FROM items i JOIN users u ON u.id = i.owner_id WHERE ${where.join(' AND ')}`,
    ...params);

  const page = Math.max(1, Number(q.page) || 1);
  const items = all(`${sql} LIMIT ? OFFSET ?`, ...params, PER_PAGE, (page - 1) * PER_PAGE);

  return { items, total, page, pages: Math.max(1, Math.ceil(total / PER_PAGE)) };
}

module.exports = { searchItems, PER_PAGE };
