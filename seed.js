/*
 * Demo data for ReWear.
 *
 *   npm run seed
 *
 * Wipes the tables and loads a small community: one admin, six members, fifteen
 * listings, a few bookings at different stages, reviews, donation drives and
 * survey responses. All people, organisations and items here are invented for
 * the project demonstration.
 */
const { db, run, get } = require('./db');
const { hashPassword } = require('./lib/core');

/* ---------- helpers ---------------------------------------------------- */
const DAY = 86400000;
// Dates are relative to today so availability filters always have something to find.
const day = (offset) => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10);
const measure = (o) => JSON.stringify({
  chest: '', waist: '', length: '', shoulder: '', sleeve: '', other: '', ...o,
});

console.log('Clearing existing data...');
for (const table of ['reviews', 'notifications', 'reports', 'requests', 'orders', 'rentals',
  'wishlists', 'survey', 'drives', 'items', 'users']) {
  db.exec(`DELETE FROM ${table}`);
}
db.exec("DELETE FROM sqlite_sequence WHERE name IN ('users','items','rentals','reviews'," +
  "'notifications','reports','requests','orders','drives','survey')");

/* ---------- members ---------------------------------------------------- */
console.log('Creating members...');
const PEOPLE = [
  { name: 'Riya Admin', email: 'admin@rewear.local', phone: '9800000001', pass: 'admin123',
    location: 'Campus Office', college: 'ReWear Community Team', role: 'admin',
    verification: 'verified', bio: 'Platform administrator for the ReWear community project.' },

  { name: 'Aarav Deshmukh', email: 'aarav@example.com', phone: '9800000002', pass: 'rewear123',
    location: 'Kothrud, Pune', college: 'MIT College of Engineering', verification: 'verified',
    bio: 'Third year student. Happy to lend out formal wear I only used for one placement drive.' },

  { name: 'Sneha Kulkarni', email: 'sneha@example.com', phone: '9800000003', pass: 'rewear123',
    location: 'Karve Nagar, Pune', college: 'Fergusson College', verification: 'verified',
    bio: 'I have a lot of traditional wear from family functions that deserves more than one wear.' },

  { name: 'Mohsin Shaikh', email: 'mohsin@example.com', phone: '9800000004', pass: 'rewear123',
    location: 'Camp, Pune', college: 'Symbiosis', verification: 'verified',
    bio: 'Sherwanis and blazers, mostly wedding season stuff.' },

  { name: 'Ananya Iyer', email: 'ananya@example.com', phone: '9800000005', pass: 'rewear123',
    location: 'Aundh, Pune', college: 'COEP', verification: 'verified',
    bio: 'Party dresses and jackets. Careful with items, expect the same back.' },

  { name: 'Vikram Rao', email: 'vikram@example.com', phone: '9800000006', pass: 'rewear123',
    location: 'Hadapsar, Pune', college: null, verification: 'pending',
    bio: 'New here. Clearing out a wardrobe after moving house.' },

  { name: 'Priya Nair', email: 'priya@example.com', phone: '9800000007', pass: 'rewear123',
    location: 'Kothrud, Pune', college: 'MIT College of Engineering', verification: 'unverified',
    bio: null },
];

const userId = {};
for (const p of PEOPLE) {
  const info = run(`INSERT INTO users
    (name, email, phone, password, location, college, bio, verification, role, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`,
    p.name, p.email, p.phone, hashPassword(p.pass), p.location, p.college, p.bio,
    p.verification, p.role || 'user', day(-90) + ' 10:00:00');
  userId[p.email] = Number(info.lastInsertRowid);
}

/* ---------- listings --------------------------------------------------- */
console.log('Creating listings...');
const LISTINGS = [
  // --- rentals ---
  { owner: 'sneha@example.com', type: 'rent', title: 'Maroon Banarasi Silk Saree',
    category: 'Sarees', gender: 'Women', occasion: 'Wedding', size: 'Custom Measurements',
    condition: 'Like New', rent: 450, deposit: 2000,
    accessories: 'Matching stitched blouse (size M) and fall-pico done',
    m: { length: '216', other: 'Blouse bust 36' },
    desc: 'Pure Banarasi silk in deep maroon with gold zari border. Worn once at a cousin’s wedding and dry-cleaned straight after. Comes with a stitched blouse and petticoat.',
    from: -20, to: 120 },

  { owner: 'mohsin@example.com', type: 'rent', title: 'Cream Embroidered Sherwani Set',
    category: 'Sherwanis', gender: 'Men', occasion: 'Wedding', size: 'L',
    condition: 'Excellent', rent: 700, deposit: 3000,
    accessories: 'Churidar, dupatta and matching mojaris (size 9)',
    m: { chest: '42', waist: '36', length: '46', shoulder: '18', sleeve: '25' },
    desc: 'Cream sherwani with tone-on-tone thread embroidery. Used for my brother’s reception. Full set including churidar, dupatta and mojaris. Dry-cleaned and stored in a garment bag.',
    from: -30, to: 150 },

  { owner: 'aarav@example.com', type: 'rent', title: 'Navy Formal Blazer',
    category: 'Suits', gender: 'Men', occasion: 'Interview', size: 'M',
    condition: 'Excellent', rent: 200, deposit: 800,
    accessories: 'Garment bag',
    m: { chest: '40', waist: '34', length: '30', shoulder: '17', sleeve: '24' },
    desc: 'Single-breasted navy blazer bought for placement season. Slim fit, notch lapel, works for interviews and presentations. Two small sets of wear on the inner cuff, nothing visible when worn.',
    from: -40, to: 200 },

  { owner: 'ananya@example.com', type: 'rent', title: 'Emerald Green Party Dress',
    category: 'Dresses', gender: 'Women', occasion: 'Party', size: 'S',
    condition: 'Like New', rent: 300, deposit: 1200,
    accessories: 'Detachable fabric belt',
    m: { chest: '34', waist: '28', length: '38' },
    desc: 'Midi dress in emerald satin with a cowl neck. Worn once for a college farewell. Has a concealed back zip and a detachable belt. Fits UK 8 to small 10.',
    from: -15, to: 100 },

  { owner: 'sneha@example.com', type: 'rent', title: 'Peach Anarkali Kurta Set',
    category: 'Kurtas', gender: 'Women', occasion: 'Festival', size: 'M',
    condition: 'Excellent', rent: 250, deposit: 1000,
    accessories: 'Dupatta and palazzo',
    m: { chest: '38', waist: '32', length: '52' },
    desc: 'Floor-length peach anarkali with light gota work on the yoke. Comfortable for long functions. Worn twice at Diwali gatherings, no marks.',
    from: -25, to: 130 },

  { owner: 'mohsin@example.com', type: 'rent', title: 'Black Three-Piece Suit',
    category: 'Suits', gender: 'Men', occasion: 'Formal', size: 'L',
    condition: 'Good', rent: 400, deposit: 1500,
    accessories: 'Waistcoat and tie',
    m: { chest: '42', waist: '36', length: '31', shoulder: '18', sleeve: '25' },
    desc: 'Classic black three-piece including waistcoat. Used for two weddings and a convocation. Slight shine on the seat of the trousers from wear, otherwise sharp.',
    from: -35, to: 160 },

  { owner: 'aarav@example.com', type: 'rent', title: 'Blue Denim Jacket (Oversized)',
    category: 'Jackets', gender: 'Unisex', occasion: 'Casual', size: 'L',
    condition: 'Good', rent: 120, deposit: 500,
    accessories: null,
    m: { chest: '44', length: '27', shoulder: '19', sleeve: '24' },
    desc: 'Washed blue oversized denim jacket. Great for trips and casual events. Genuinely used, so there is some fading at the cuffs, which honestly suits it.',
    from: -50, to: 250 },

  { owner: 'ananya@example.com', type: 'rent', title: 'Ivory Sequin Cocktail Gown',
    category: 'Dresses', gender: 'Women', occasion: 'Party', size: 'M',
    condition: 'Like New', rent: 550, deposit: 2500,
    accessories: 'Shawl',
    m: { chest: '36', waist: '30', length: '58' },
    desc: 'Full-length ivory gown with hand-sewn sequins and a small train. Worn for one New Year party. Two sequins replaced by the tailor, colour matched exactly.',
    from: -10, to: 90 },

  { owner: 'sneha@example.com', type: 'rent', title: 'Teal Kanjivaram Saree',
    category: 'Sarees', gender: 'Women', occasion: 'Traditional', size: 'Custom Measurements',
    condition: 'Excellent', rent: 500, deposit: 2200,
    accessories: 'Unstitched blouse piece',
    m: { length: '215', other: 'Blouse piece 0.8m unstitched' },
    desc: 'Traditional teal Kanjivaram with a contrast mustard border. Family piece, kept carefully. Blouse piece is unstitched so you can have it fitted.',
    from: -20, to: 140 },

  { owner: 'mohsin@example.com', type: 'rent', title: 'White Kurta Pyjama Set',
    category: 'Kurtas', gender: 'Men', occasion: 'Festival', size: 'M',
    condition: 'Excellent', rent: 150, deposit: 600,
    accessories: 'Nehru jacket in beige',
    m: { chest: '40', length: '42', shoulder: '17', sleeve: '23' },
    desc: 'Crisp white cotton kurta with a beige Nehru jacket. Good for pujas, festivals and college traditional days. Washed and pressed.',
    from: -45, to: 180 },

  { owner: 'aarav@example.com', type: 'rent', title: 'Charcoal Formal Trousers',
    category: 'Trousers', gender: 'Men', occasion: 'Interview', size: 'M',
    condition: 'Good', rent: 90, deposit: 300,
    accessories: null,
    m: { waist: '32', length: '40', other: 'Inseam 31' },
    desc: 'Charcoal wool-blend formal trousers, flat front. Pairs with the navy blazer I have also listed. Hem has been let out once, so there is a faint line.',
    from: -40, to: 200 },

  { owner: 'ananya@example.com', type: 'rent', title: 'Red Festive Lehenga Choli',
    category: 'Other', gender: 'Women', occasion: 'Wedding', size: 'S',
    condition: 'Like New', rent: 650, deposit: 3000,
    accessories: 'Choli (34), dupatta and matching potli bag',
    m: { chest: '34', waist: '28', length: '42' },
    desc: 'Bright red lehenga with mirror work on the border and a matching choli and dupatta. Worn for one sangeet. Includes a small potli bag.',
    from: -12, to: 110 },

  // --- resale ---
  { owner: 'vikram@example.com', type: 'sell', title: 'Beige Linen Shirt',
    category: 'Shirts', gender: 'Men', occasion: 'Casual', size: 'L',
    condition: 'Excellent', sale: 450, original: 1200, brand: 'Fabindia',
    m: { chest: '42', length: '30', shoulder: '18', sleeve: '24' },
    desc: 'Beige linen full-sleeve shirt. Bought last summer, worn a handful of times, no longer my size after moving. Clean, no stains.' },

  { owner: 'priya@example.com', type: 'sell', title: 'Mustard Cotton Kurti',
    category: 'Kurtas', gender: 'Women', occasion: 'College', size: 'M',
    condition: 'Good', sale: 300, original: 850, brand: 'Biba',
    m: { chest: '38', length: '44' },
    desc: 'Mustard straight-cut cotton kurti with block prints. Worn regularly for a semester so the colour has softened slightly. Comfortable for daily college wear.' },

  { owner: 'aarav@example.com', type: 'sell', title: 'Grey Wool Overcoat',
    category: 'Jackets', gender: 'Unisex', occasion: 'Formal', size: 'L',
    condition: 'Good', sale: 1200, original: 4500, brand: 'Westside',
    m: { chest: '44', length: '38', shoulder: '19', sleeve: '25' },
    desc: 'Grey wool overcoat, knee length. Too warm for Pune most of the year, which is exactly why I am selling it. One inner pocket has a repaired seam.' },

  // --- donation ---
  { owner: 'sneha@example.com', type: 'donate', title: 'Three Cotton Salwar Suits',
    category: 'Other', gender: 'Women', occasion: 'Casual', size: 'L',
    condition: 'Good', quantity: 3, handover: 'Collection from Karve Nagar, or I can drop at a campus drive',
    m: { chest: '40', length: '44' },
    desc: 'Three cotton salwar suits in good wearable condition, size L. All washed and pressed. Would suit someone who needs everyday wear.' },

  { owner: 'vikram@example.com', type: 'donate', title: 'Boys School Sweaters (Pack of 4)',
    category: 'Other', gender: 'Unisex', occasion: 'Casual', size: 'S',
    condition: 'Good', quantity: 4, handover: 'Pickup from Hadapsar on weekends',
    m: { chest: '30', length: '22' },
    desc: 'Four navy school sweaters, ages roughly 8 to 10. Some pilling from washing but warm and intact. Outgrown by my nephew.' },

  { owner: 'mohsin@example.com', type: 'donate', title: 'Two Formal Shirts',
    category: 'Shirts', gender: 'Men', occasion: 'Interview', size: 'M',
    condition: 'Excellent', quantity: 2, handover: 'Drop-off at the campus collection point',
    m: { chest: '40', shoulder: '17', sleeve: '24' },
    desc: 'One white and one light blue formal shirt, size M. Barely worn. Passing them to someone starting interviews.' },
];

const itemId = [];
for (const L of LISTINGS) {
  const info = run(`INSERT INTO items
    (owner_id, listing_type, title, brand, quantity, description, category, gender, occasion, size,
     measurements, condition, rental_price, sale_price, original_price, security_deposit, images, location,
     available_from, available_to, handover_method, accessories, status, views, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'[]',?,?,?,?,?,'active',?,?)`,
    userId[L.owner], L.type, L.title, L.brand || null, L.quantity || 1, L.desc,
    L.category, L.gender, L.occasion, L.size, measure(L.m || {}), L.condition,
    L.rent || 0, L.sale || 0, L.original || 0, L.deposit || 0,
    get('SELECT location FROM users WHERE id = ?', userId[L.owner]).location,
    L.from != null ? day(L.from) : null, L.to != null ? day(L.to) : null,
    L.handover || null, L.accessories || null,
    Math.floor(Math.random() * 60) + 4, day(-Math.floor(Math.random() * 40) - 2) + ' 12:00:00');
  itemId.push(Number(info.lastInsertRowid));
}

/* ---------- rentals at different stages -------------------------------- */
console.log('Creating rentals...');
const before = (by, damage, marks) => JSON.stringify({
  recorded_by: by, recorded_at: new Date(Date.now() - 20 * DAY).toISOString(),
  damage, marks, accessories: 'All listed accessories handed over',
  notes: 'Checked together at handover.', photos: [],
});
const after = (by, damage, marks) => JSON.stringify({
  recorded_by: by, recorded_at: new Date(Date.now() - 5 * DAY).toISOString(),
  damage, marks, accessories: 'All accessories returned',
  notes: 'Returned dry-cleaned.', photos: [],
});

// item index, renter, owner, start, end, status, extras
const RENTALS = [
  // completed - will carry reviews
  { item: 0, renter: 'ananya@example.com', owner: 'sneha@example.com', from: -30, to: -27,
    status: 'completed', hc: 1, rc: 1,
    cb: before('Sneha Kulkarni', 'Condition unchanged', 'None'),
    ca: after('Sneha Kulkarni', 'Condition unchanged', 'None') },

  { item: 2, renter: 'priya@example.com', owner: 'aarav@example.com', from: -22, to: -20,
    status: 'completed', hc: 1, rc: 1,
    cb: before('Aarav Deshmukh', 'Condition unchanged', 'Slight wear on inner cuff, noted at listing'),
    ca: after('Aarav Deshmukh', 'Condition unchanged', 'Same as before') },

  { item: 9, renter: 'aarav@example.com', owner: 'mohsin@example.com', from: -14, to: -12,
    status: 'completed', hc: 1, rc: 1,
    cb: before('Mohsin Shaikh', 'Condition unchanged', 'None'),
    ca: after('Mohsin Shaikh', 'Minor damage', 'Small ink mark near the right cuff') },

  // active right now
  { item: 4, renter: 'ananya@example.com', owner: 'sneha@example.com', from: -2, to: 3,
    status: 'active', hc: 1, rc: 0,
    cb: before('Sneha Kulkarni', 'Condition unchanged', 'None'), ca: null },

  // accepted, condition recorded, waiting for the renter to confirm handover
  { item: 1, renter: 'aarav@example.com', owner: 'mohsin@example.com', from: 5, to: 8,
    status: 'accepted', hc: 0, rc: 0,
    cb: before('Mohsin Shaikh', 'Condition unchanged', 'None'), ca: null },

  // accepted, nothing recorded yet
  { item: 7, renter: 'sneha@example.com', owner: 'ananya@example.com', from: 12, to: 14,
    status: 'accepted', hc: 0, rc: 0, cb: null, ca: null },

  // pending requests waiting on the owner
  { item: 3, renter: 'priya@example.com', owner: 'ananya@example.com', from: 9, to: 11,
    status: 'pending', hc: 0, rc: 0, cb: null, ca: null,
    msg: 'Need it for a college farewell on the 10th. I can collect from Aundh in the evening.' },

  { item: 11, renter: 'sneha@example.com', owner: 'ananya@example.com', from: 20, to: 23,
    status: 'pending', hc: 0, rc: 0, cb: null, ca: null,
    msg: 'For my cousin’s sangeet. Happy to pay the deposit in advance.' },

  // one declined, for a realistic history
  { item: 5, renter: 'priya@example.com', owner: 'mohsin@example.com', from: -6, to: -4,
    status: 'rejected', hc: 0, rc: 0, cb: null, ca: null },
];

const rentalId = [];
for (const R of RENTALS) {
  const item = get('SELECT * FROM items WHERE id = ?', itemId[R.item]);
  const days = Math.round((new Date(day(R.to)) - new Date(day(R.from))) / DAY) + 1;
  const info = run(`INSERT INTO rentals
    (item_id, renter_id, owner_id, start_date, end_date, days, rental_price, security_deposit,
     message, status, condition_before, condition_after, handover_confirmed, return_confirmed, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    item.id, userId[R.renter], userId[R.owner], day(R.from), day(R.to), days,
    item.rental_price * days, item.security_deposit, R.msg || null, R.status,
    R.cb, R.ca, R.hc, R.rc, day(R.from - 4) + ' 09:30:00');
  rentalId.push(Number(info.lastInsertRowid));
}

// The item that is out right now shows as rented.
run("UPDATE items SET status = 'rented' WHERE id = ?", itemId[4]);

/* ---------- resale / donation requests --------------------------------- */
console.log('Creating resale and donation requests...');
const REQUESTS = [
  { item: 12, requester: 'aarav@example.com', owner: 'vikram@example.com', kind: 'sell',
    status: 'pending', msg: 'Is the fit true to size? I usually wear L in linen.' },
  { item: 14, requester: 'mohsin@example.com', owner: 'aarav@example.com', kind: 'sell',
    status: 'completed', msg: 'Interested. Can collect from Kothrud this weekend.' },
  { item: 17, requester: 'priya@example.com', owner: 'mohsin@example.com', kind: 'donate',
    status: 'accepted', msg: 'These would really help a junior starting placements. Can collect any day.',
    quantity: 1, handover_method: 'Pickup', pickup: 7,
    time_slot: 'Afternoon (12 pm–4 pm)', pickup_location: 'Kothrud, Pune' },
];

const requestIds = [];
for (const Q of REQUESTS) {
  const code = Q.kind === 'donate' ? `DON-SEED-${Q.item}` : null;
  const info = run(`INSERT INTO requests
    (request_code, item_id, requester_id, owner_id, kind, message, quantity,
     handover_method, pickup_date, time_slot, pickup_location, status, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, code, itemId[Q.item], userId[Q.requester], userId[Q.owner],
    Q.kind, Q.msg, Q.quantity || 1, Q.handover_method || null,
    Q.pickup != null ? day(Q.pickup) : null, Q.time_slot || null, Q.pickup_location || null,
    Q.status, day(-8) + ' 16:00:00');
  requestIds.push(Number(info.lastInsertRowid));
}
run("UPDATE items SET status = 'sold' WHERE id = ?", itemId[14]);

/* ---------- reviews (only for completed transactions) ------------------ */
console.log('Creating reviews...');
const REVIEWS = [
  { rental: 0, reviewer: 'ananya@example.com', reviewee: 'sneha@example.com', item: 0, rating: 5,
    tags: ['Reliable', 'Good Condition', 'Accurate Description'],
    comment: 'The saree was exactly as described and beautifully kept. Sneha had the condition record ready before handover, which made everything easy.' },
  { rental: 0, reviewer: 'sneha@example.com', reviewee: 'ananya@example.com', item: 0, rating: 5,
    tags: ['On Time', 'Responsive'],
    comment: 'Returned on the agreed day, dry-cleaned, no issues at all. Would lend to Ananya again.' },
  { rental: 1, reviewer: 'priya@example.com', reviewee: 'aarav@example.com', item: 2, rating: 5,
    tags: ['Reliable', 'Responsive', 'Accurate Description'],
    comment: 'Got me through two interviews. The wear on the cuff was already mentioned in the listing, so no surprises.' },
  { rental: 1, reviewer: 'aarav@example.com', reviewee: 'priya@example.com', item: 2, rating: 4,
    tags: ['On Time'],
    comment: 'Returned on time and in good shape. Slightly hard to reach on the day of handover.' },
  { rental: 2, reviewer: 'aarav@example.com', reviewee: 'mohsin@example.com', item: 9, rating: 4,
    tags: ['Good Condition', 'Responsive'],
    comment: 'Lovely kurta set and the Nehru jacket was a bonus. Handover in Camp was quick.' },
  { rental: 2, reviewer: 'mohsin@example.com', reviewee: 'aarav@example.com', item: 9, rating: 4,
    tags: ['On Time'],
    comment: 'Small ink mark came back on the cuff, which Aarav owned up to immediately and got cleaned. Handled well.' },
  { request: 1, reviewer: 'mohsin@example.com', reviewee: 'aarav@example.com', item: 14, rating: 5,
    tags: ['Accurate Description', 'Reliable'],
    comment: 'Coat was exactly as photographed. Straightforward handover.' },
];

for (const V of REVIEWS) {
  run(`INSERT INTO reviews (reviewer_id, reviewee_id, item_id, rental_id, request_id,
      rating, comment, tags, created_at) VALUES (?,?,?,?,?,?,?,?,?)`,
    userId[V.reviewer], userId[V.reviewee], itemId[V.item],
    V.rental != null ? rentalId[V.rental] : null,
    V.request != null ? requestIds[V.request] : null,
    V.rating, V.comment, JSON.stringify(V.tags), day(-10) + ' 18:00:00');
}

/* ---------- notifications --------------------------------------------- */
console.log('Creating notifications...');
const NOTES = [
  { to: 'ananya@example.com', type: 'request', read: 0,
    msg: 'Priya Nair requested to rent "Emerald Green Party Dress".', link: '/rentals/' + rentalId[6] },
  { to: 'ananya@example.com', type: 'request', read: 0,
    msg: 'Sneha Kulkarni requested to rent "Red Festive Lehenga Choli".', link: '/rentals/' + rentalId[7] },
  { to: 'aarav@example.com', type: 'handover', read: 0,
    msg: 'Condition record added for "Cream Embroidered Sherwani Set". Please confirm it at handover.',
    link: '/rentals/' + rentalId[4] },
  { to: 'aarav@example.com', type: 'review', read: 1,
    msg: 'Priya Nair left you a 5-star review.', link: '/reviews' },
  { to: 'sneha@example.com', type: 'completed', read: 1,
    msg: '"Maroon Banarasi Silk Saree" is back with you and the booking is complete.',
    link: '/rentals/' + rentalId[0] },
  { to: 'vikram@example.com', type: 'enquiry', read: 0,
    msg: 'Aarav Deshmukh is interested in "Beige Linen Shirt".', link: '/requests' },
  { to: 'mohsin@example.com', type: 'donation', read: 0,
    msg: 'Priya Nair is interested in "Two Formal Shirts".', link: '/requests' },
  { to: 'admin@rewear.local', type: 'verification', read: 0,
    msg: 'Vikram Rao requested community verification.', link: '/admin/users' },
];
for (const N of NOTES) {
  run(`INSERT INTO notifications (user_id, message, type, link, read, created_at)
    VALUES (?,?,?,?,?,?)`, userId[N.to], N.msg, N.type, N.link, N.read, day(-2) + ' 11:00:00');
}

/* ---------- a report for the admin queue ------------------------------ */
run(`INSERT INTO reports (reporter_id, user_id, item_id, reason, description, status, created_at)
  VALUES (?,?,?,?,?,'open',?)`,
  userId['priya@example.com'], userId['vikram@example.com'], itemId[13],
  'Misleading Description',
  'Demo report for the admin queue: the listed size does not seem to match the measurements given.',
  day(-3) + ' 14:00:00');

/* ---------- donation drives (clearly marked as demo) ------------------ */
console.log('Creating donation drives...');
const DRIVES = [
  { title: 'Winter Clothing Collection', org: 'Demo Community Welfare Group',
    location: 'College Main Gate, Kothrud',
    desc: 'Placeholder drive for the project demonstration. Collecting warm clothing in wearable condition. Replace this entry with a real partner organisation before any actual collection.',
    from: -5, to: 25 },
  { title: 'Interview-Ready Formals Drive', org: 'Demo Student Support Cell',
    location: 'Placement Office, Campus',
    desc: 'Placeholder drive for the project demonstration. Formal shirts, trousers and blazers for students attending placement interviews.',
    from: 2, to: 40 },
  { title: 'School Uniform Reuse Drive', org: 'Demo Neighbourhood Association',
    location: 'Community Hall, Hadapsar',
    desc: 'Placeholder drive for the project demonstration. Outgrown uniforms and sweaters passed on to families in the locality.',
    from: -20, to: -2 },
];
for (const D of DRIVES) {
  run(`INSERT INTO drives (title, organization, description, location, starts_on, ends_on, is_demo)
    VALUES (?,?,?,?,?,?,1)`, D.title, D.org, D.desc, D.location, day(D.from), day(D.to));
}

/* ---------- survey responses ------------------------------------------ */
console.log('Creating survey responses...');
const Q1 = ['Very often', 'A few times a year', 'Rarely', 'Almost never'];
const Q2 = ['Many times', 'Two or three times', 'Only once', 'Never again'];
const YMN = ['Yes', 'Maybe', 'No'];
const Q7 = ['Hygiene', 'Damage or loss', 'Fit and size', 'Trusting the other person',
  'Nothing in particular'];
const COMMENTS = [
  'A size guide with real measurements would help more than S/M/L labels.',
  'I would rent out clothes if I knew the person was verified by the college.',
  'Dry-cleaning between rentals should be part of the process.',
  '', '', 'Would be good to see items available in my own locality first.',
];

// Weighted so the results look like a plausible survey rather than a flat split.
const pick = (arr, weights) => {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < arr.length; i++) { r -= weights[i]; if (r <= 0) return arr[i]; }
  return arr[0];
};

for (let i = 0; i < 24; i++) {
  run('INSERT INTO survey (user_id, answers, created_at) VALUES (?,?,?)',
    null,
    JSON.stringify({
      q1: pick(Q1, [3, 6, 3, 1]),
      q2: pick(Q2, [1, 4, 6, 2]),
      q3: pick(YMN, [7, 4, 2]),
      q4: pick(YMN, [5, 5, 3]),
      q5: pick(YMN, [6, 4, 2]),
      q6: pick(YMN, [9, 3, 1]),
      q7: pick(Q7, [5, 6, 4, 3, 2]),
      comment: COMMENTS[i % COMMENTS.length],
    }),
    day(-Math.floor(Math.random() * 30)) + ' 15:00:00');
}

/* ---------- done ------------------------------------------------------ */
const n = (sql) => get(sql).n;
console.log(`
Seed complete.

  Members   ${n('SELECT COUNT(*) AS n FROM users')}
  Listings  ${n('SELECT COUNT(*) AS n FROM items')}
  Rentals   ${n('SELECT COUNT(*) AS n FROM rentals')}
  Requests  ${n('SELECT COUNT(*) AS n FROM requests')}
  Reviews   ${n('SELECT COUNT(*) AS n FROM reviews')}
  Survey    ${n('SELECT COUNT(*) AS n FROM survey')}

Demo logins (all demo data, no real people):
  admin@rewear.local  / admin123    (admin)
  aarav@example.com   / rewear123   (verified member, has listings and bookings)
  sneha@example.com   / rewear123   (verified member, most rentals)
  ananya@example.com  / rewear123   (verified member, has pending requests to answer)
  vikram@example.com  / rewear123   (verification pending)
  priya@example.com   / rewear123   (unverified)

Start the app with:  npm run dev
`);
