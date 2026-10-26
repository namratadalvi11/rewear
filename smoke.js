/*
 * End-to-end smoke test. Walks the whole app the way a demo would:
 * public pages, register, login, listing, the full rental flow, resale,
 * donation, review, survey, report, admin, and the access checks.
 *
 *   node smoke.js          (expects the app running on PORT, default 5000)
 *
 * Run against an app instance configured with a dedicated test database (see README).
 */
const BASE = 'http://localhost:' + (process.env.PORT || 5000);

let pass = 0;
const failures = [];

function check(label, ok, detail) {
  if (ok) { pass++; console.log('  ok   ' + label); }
  else { failures.push(label + (detail ? ' -> ' + detail : '')); console.log('  FAIL ' + label + (detail ? ' -> ' + detail : '')); }
}

/* Each "session" is just a cookie jar plus its current CSRF token. */
function session() {
  return { cookie: '', csrf: null };
}

async function req(s, path, { method = 'GET', body, expect } = {}) {
  const headers = { cookie: s.cookie };
  let payload;
  if (method === 'POST') {
    // Every POST carries the session CSRF token, exactly like a real form.
    headers['content-type'] = 'application/x-www-form-urlencoded';
    payload = new URLSearchParams({ ...(body || {}), _csrf: s.csrf || '' }).toString();
  }
  const res = await fetch(BASE + path, { method, headers, body: payload, redirect: 'manual' });

  const setCookie = res.headers.getSetCookie?.() || [];
  for (const c of setCookie) s.cookie = c.split(';')[0];

  const text = res.status >= 300 && res.status < 400 ? '' : await res.text();
  const token = text.match(/name="_csrf" value="([^"]+)"/);
  if (token) s.csrf = token[1];

  if (expect) check(`${method} ${path} -> ${expect}`, res.status === expect, 'got ' + res.status);
  return { status: res.status, text, location: res.headers.get('location') };
}

// Loads a page purely to pick up a fresh CSRF token before posting.
const primeCsrf = (s, path) => req(s, path);

(async () => {
  console.log('\n--- public pages ---');
  const guest = session();
  for (const p of ['/', '/explore', '/browse', '/resale', '/donate', '/how-it-works', '/about',
    '/community', '/community/survey', '/login', '/register', '/items/1']) {
    await req(guest, p, { expect: 200 });
  }
  await req(guest, '/no-such-page', { expect: 404 });

  console.log('\n--- search, filters, sorting, pagination ---');
  for (const q of ['/explore?q=saree', '/explore?sort=price_asc',
    '/explore?from=2099-01-01&to=2099-01-05', '/browse?q=saree', '/browse?category=Sarees&occasion=Wedding',
    '/browse?gender=Men&size=L&condition=Excellent', '/browse?min_price=100&max_price=500',
    '/browse?sort=price_asc', '/browse?sort=most_rented', '/browse?sort=rating',
    '/browse?location=Pune&page=1', '/browse?from=2099-01-01&to=2099-01-05',
    '/resale?q=linen', '/donate?category=Other']) {
    await req(guest, q, { expect: 200 });
  }

  console.log('\n--- protected routes reject guests ---');
  for (const p of ['/dashboard', '/my-listings', '/rentals', '/rentals/requests',
    '/requests', '/reviews', '/notifications', '/wishlist', '/profile', '/orders', '/items/new', '/admin']) {
    const r = await req(guest, p);
    check(`guest blocked from ${p}`, r.status === 302 && /\/login/.test(r.location || ''),
      `${r.status} ${r.location}`);
  }

  console.log('\n--- registration and login ---');
  const owner = session();
  await primeCsrf(owner, '/register');
  const stamp = Date.now();
  let r = await req(owner, '/register', { method: 'POST', body: {
    name: 'Test Owner', email: `owner${stamp}@test.local`, phone: '9876543210',
    password: 'password123', confirm: 'password123', location: 'Testville', college: 'Test College' } });
  check('register redirects to dashboard', r.location === '/dashboard', `${r.status} ${r.location}`);
  await req(owner, '/dashboard', { expect: 200 });

  await primeCsrf(owner, '/register');
  r = await req(owner, '/register', { method: 'POST', body: {
    name: 'X', email: 'bad-email', phone: '1', password: 'short', confirm: 'nope', location: '' } });
  check('invalid registration is rejected', r.status === 400, 'got ' + r.status);

  const renter = session();
  await primeCsrf(renter, '/login');
  r = await req(renter, '/login', { method: 'POST',
    body: { email: 'aarav@example.com', password: 'wrong-password' } });
  check('wrong password rejected', r.status === 401, 'got ' + r.status);

  await primeCsrf(renter, '/login');
  r = await req(renter, '/login', { method: 'POST',
    body: { email: 'aarav@example.com', password: 'rewear123' } });
  check('login redirects in', r.status === 302, `${r.status} ${r.location}`);

  console.log('\n--- verification needs an admin ---');
  await primeCsrf(owner, '/profile/verify');
  await req(owner, '/profile/verify', { method: 'POST', body: { agree: '1' } });
  r = await req(owner, '/items/new');
  check('unverified member cannot reach the listing form',
    r.status === 302 && r.location === '/profile/verify', `${r.status} ${r.location}`);

  const admin = session();
  await primeCsrf(admin, '/login');
  await req(admin, '/login', { method: 'POST',
    body: { email: 'admin@rewear.local', password: 'admin123' } });
  await req(admin, '/admin', { expect: 200 });
  for (const p of ['/admin/users', '/admin/listings', '/admin/rentals', '/admin/reports',
    '/admin/drives', '/admin/survey']) {
    await req(admin, p, { expect: 200 });
  }

  r = await req(renter, '/admin');
  check('non-admin gets 403 on /admin', r.status === 403, 'got ' + r.status);

  const usersPage = await req(admin, '/admin/users');
  const ownerId = (usersPage.text.match(/href="\/users\/(\d+)"><strong>Test Owner<\/strong>/) || [])[1];
  check('found the new member id', !!ownerId, 'new member missing from admin users page');

  await primeCsrf(admin, '/admin/users');
  r = await req(admin, `/admin/users/${ownerId}/verification`, { method: 'POST',
    body: { status: 'verified' } });
  check('admin verifies a member', r.status === 302, 'got ' + r.status);

  console.log('\n--- create, edit and browse a listing ---');
  const smokeBlazerTitle = `Smoke Test Blazer ${stamp}`;
  await primeCsrf(owner, '/items/new');
  r = await req(owner, '/items/new', { expect: 200 });
  await primeCsrf(owner, '/items/new');
  r = await req(owner, '/items', { method: 'POST', body: {
    listing_type: 'rent', title: smokeBlazerTitle,
    description: 'A blazer created by the automated smoke test run.',
    category: 'Suits', gender: 'Men', occasion: 'Interview', size: 'M', condition: 'Good',
    rental_price: '199', security_deposit: '500', location: 'Testville',
    chest: '40', waist: '34' } });
  const itemId = (r.location || '').split('/').pop();
  check('listing created', r.status === 302 && /^\/items\/\d+$/.test(r.location || ''),
    `${r.status} ${r.location}`);

  await primeCsrf(renter, `/items/${itemId}`);
  r = await req(renter, `/wishlist/${itemId}/add`, { method: 'POST',
    body: { back: `/items/${itemId}` } });
  check('wishlist item saved', r.status === 302 && r.location === `/items/${itemId}`,
    `${r.status} ${r.location}`);
  const wishlist = await req(renter, '/wishlist', { expect: 200 });
  check('saved item appears in wishlist',
    wishlist.text.includes(smokeBlazerTitle) && wishlist.text.includes('aria-pressed="true"'),
    'saved item missing or heart state not active');
  await primeCsrf(renter, '/wishlist');
  r = await req(renter, `/wishlist/${itemId}/remove`, { method: 'POST',
    body: { back: '/wishlist' } });
  check('wishlist item removed', r.status === 302 && r.location === '/wishlist',
    `${r.status} ${r.location}`);
  const emptyWishlist = await req(renter, '/wishlist', { expect: 200 });
  check('removed item no longer appears in wishlist',
    !emptyWishlist.text.includes(smokeBlazerTitle)
      && !emptyWishlist.text.includes(`action="/wishlist/${itemId}/remove"`),
    'item remains in wishlist');

  await req(guest, `/items/${itemId}`, { expect: 200 });
  await req(owner, `/items/${itemId}/edit`, { expect: 200 });
  await primeCsrf(owner, `/items/${itemId}/edit`);
  r = await req(owner, `/items/${itemId}/edit`, { method: 'POST', body: {
    title: `${smokeBlazerTitle} (edited)`,
    description: 'Edited by the automated smoke test run.',
    category: 'Suits', gender: 'Men', occasion: 'Interview', size: 'M', condition: 'Good',
    rental_price: '249', security_deposit: '500', location: 'Testville' } });
  check('listing edited', r.status === 302, 'got ' + r.status);

  await primeCsrf(owner, '/items/new');
  r = await req(owner, '/items', { method: 'POST', body: {
    listing_type: 'rent', title: 'x', description: 'too short', category: 'Nope',
    gender: '', size: '', condition: '', rental_price: '0', location: '' } });
  check('invalid listing rejected', r.status === 400, 'got ' + r.status);

  await req(owner, '/my-listings', { expect: 200 });

  console.log('\n--- rental flow ---');
  const d = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

  await primeCsrf(renter, `/items/${itemId}`);
  r = await req(renter, '/rentals/request', { method: 'POST', body: {
    item_id: itemId, start_date: d(3), end_date: d(5), message: 'Smoke test booking.' } });
  const rentalId = (r.location || '').split('/').pop();
  check('rental requested', /^\/rentals\/\d+$/.test(r.location || ''), r.location);

  await primeCsrf(renter, `/items/${itemId}`);
  r = await req(renter, '/rentals/request', { method: 'POST',
    body: { item_id: itemId, start_date: d(-5), end_date: d(-3) } });
  check('past dates rejected', r.location === `/items/${itemId}`, r.location);

  await primeCsrf(owner, `/items/${itemId}`);
  r = await req(owner, '/rentals/request', { method: 'POST',
    body: { item_id: itemId, start_date: d(30), end_date: d(31) } });
  check('cannot rent your own listing', r.location === `/items/${itemId}`, r.location);

  await req(renter, '/rentals', { expect: 200 });
  await req(owner, '/rentals/requests', { expect: 200 });
  await req(owner, `/rentals/${rentalId}`, { expect: 200 });
  await req(renter, `/rentals/${rentalId}`, { expect: 200 });

  const stranger = session();
  await primeCsrf(stranger, '/login');
  await req(stranger, '/login', { method: 'POST',
    body: { email: 'sneha@example.com', password: 'rewear123' } });
  r = await req(stranger, `/rentals/${rentalId}`);
  check('outsider cannot read a booking', r.status === 404, 'got ' + r.status);

  await primeCsrf(owner, `/rentals/${rentalId}`);
  r = await req(owner, `/rentals/${rentalId}/accept`, { method: 'POST' });
  check('owner accepts', r.status === 302, 'got ' + r.status);

  await primeCsrf(owner, `/rentals/${rentalId}`);
  r = await req(owner, `/rentals/${rentalId}/handover`, { method: 'POST', body: {
    damage: 'Condition unchanged', marks: 'None', accessories: 'Garment bag',
    notes: 'Checked at handover.' } });
  check('owner records before-condition', r.status === 302, 'got ' + r.status);

  await primeCsrf(renter, `/rentals/${rentalId}`);
  r = await req(renter, `/rentals/${rentalId}/confirm-handover`, { method: 'POST' });
  check('renter confirms handover', r.status === 302, 'got ' + r.status);

  await primeCsrf(renter, '/reviews');
  r = await req(renter, '/reviews', { method: 'POST',
    body: { rental_id: rentalId, rating: '5', comment: 'Too early to review.' } });
  const early = await req(renter, '/reviews');
  check('review blocked before completion',
    /only review a transaction you completed/.test(early.text), 'no guard message found');

  await primeCsrf(owner, `/rentals/${rentalId}`);
  r = await req(owner, `/rentals/${rentalId}/return`, { method: 'POST', body: {
    damage: 'Condition unchanged', marks: 'None', accessories: 'Returned', notes: 'All good.' } });
  check('owner records return', r.status === 302, 'got ' + r.status);

  await primeCsrf(renter, `/rentals/${rentalId}`);
  r = await req(renter, `/rentals/${rentalId}/complete`, { method: 'POST' });
  check('renter completes booking', r.status === 302, 'got ' + r.status);

  await primeCsrf(renter, '/reviews');
  r = await req(renter, '/reviews', { method: 'POST', body: {
    rental_id: rentalId, rating: '5', tags: 'Reliable',
    comment: 'Smooth handover, item exactly as described.' } });
  check('review accepted after completion', r.status === 302, 'got ' + r.status);
  const reviewed = await req(renter, '/reviews');
  check('review appears on the reviews page',
    /Smooth handover/.test(reviewed.text), 'review text missing');

  await primeCsrf(renter, '/reviews');
  await req(renter, '/reviews', { method: 'POST',
    body: { rental_id: rentalId, rating: '1', comment: 'Duplicate attempt.' } });
  const dupe = await req(renter, '/reviews');
  check('duplicate review blocked', /already reviewed/.test(dupe.text), 'no duplicate guard');

  console.log('\n--- rental cart checkout ---');
  await primeCsrf(renter, `/items/${itemId}`);
  r = await req(renter, '/cart/add', { method: 'POST', body: {
    item_id: itemId, start_date: d(50), end_date: d(49) } });
  check('rental cart rejects invalid date ranges',
    r.status === 302 && r.location === `/items/${itemId}`, `${r.status} ${r.location}`);
  const invalidCartDates = await req(renter, `/items/${itemId}`, { expect: 200 });
  check('invalid rental dates explain the problem',
    /return date must be on or after the start date/i.test(invalidCartDates.text),
    'validation message missing');

  await primeCsrf(renter, `/items/${itemId}`);
  r = await req(renter, '/cart/add', { method: 'POST', body: {
    item_id: itemId, start_date: d(50), end_date: d(52) } });
  check('rental added to cart', r.status === 302 && r.location === '/cart', `${r.status} ${r.location}`);
  const cart = await req(renter, '/cart', { expect: 200 });
  check('cart shows rental price and fee disclosures',
    cart.text.includes('Smoke Test Blazer') && /Platform fees/.test(cart.text)
      && /no payment (?:will be )?collected/i.test(cart.text), 'cart details missing');

  await primeCsrf(renter, '/cart');
  r = await req(renter, '/cart/remove', { method: 'POST', body: { item_id: itemId } });
  check('rental can be removed from cart', r.status === 302 && r.location === '/cart',
    `${r.status} ${r.location}`);
  const emptyCart = await req(renter, '/cart', { expect: 200 });
  check('removed rental no longer appears in cart', !emptyCart.text.includes('Smoke Test Blazer'),
    'removed listing still visible');

  await primeCsrf(renter, `/items/${itemId}`);
  r = await req(renter, '/cart/add', { method: 'POST', body: {
    item_id: itemId, start_date: d(50), end_date: d(52) } });
  check('rental can be re-added for checkout', r.status === 302 && r.location === '/cart',
    `${r.status} ${r.location}`);

  await primeCsrf(owner, `/items/${itemId}`);
  r = await req(owner, `/items/${itemId}/status`, { method: 'POST',
    body: { status: 'paused', back: `/items/${itemId}` } });
  check('owner can pause cart listing before checkout', r.status === 302, 'got ' + r.status);
  await primeCsrf(renter, '/cart');
  r = await req(renter, '/cart/checkout', { method: 'POST' });
  check('checkout rechecks an unavailable listing', r.status === 302 && r.location === '/cart',
    `${r.status} ${r.location}`);
  const unavailableCart = await req(renter, '/cart', { expect: 200 });
  check('unavailable listing remains in cart with an explanation',
    /not available for rent right now/i.test(unavailableCart.text), 'availability error missing');
  await primeCsrf(owner, `/items/${itemId}`);
  await req(owner, `/items/${itemId}/status`, { method: 'POST',
    body: { status: 'active', back: `/items/${itemId}` } });

  await primeCsrf(renter, '/cart');
  r = await req(renter, '/cart/checkout', { method: 'POST' });
  check('cart checkout submits booking requests', r.status === 302 && r.location === '/rentals',
    `${r.status} ${r.location}`);
  const cartRentals = await req(renter, '/rentals', { expect: 200 });
  const cartRentalId = (cartRentals.text.match(/href="\/rentals\/(\d+)" class="t">Smoke Test Blazer/) || [])[1];
  check('cart checkout creates a visible rental request', !!cartRentalId, 'cart request missing');
  if (cartRentalId) {
    await primeCsrf(owner, '/rentals/requests');
    r = await req(owner, `/rentals/${cartRentalId}/accept`, { method: 'POST' });
    check('owner can accept a cart rental request', r.status === 302,
      'got ' + r.status);
    await primeCsrf(renter, `/rentals/${cartRentalId}`);
    r = await req(renter, `/rentals/${cartRentalId}/cancel`, { method: 'POST' });
    check('accepted cart request can be cancelled', r.status === 302, 'got ' + r.status);
  }

  console.log('\n--- double-booking guard ---');
  await primeCsrf(stranger, '/items/1');
  await req(stranger, '/rentals/request', { method: 'POST',
    body: { item_id: '1', start_date: d(40), end_date: d(42) } });
  await primeCsrf(admin, '/items/1');
  r = await req(admin, '/rentals/request', { method: 'POST',
    body: { item_id: '1', start_date: d(41), end_date: d(43) } });
  check('overlap only blocked once confirmed', r.status === 302, 'got ' + r.status);

  console.log('\n--- resale and donation ---');
  await primeCsrf(owner, '/items/new');
  r = await req(owner, '/items', { method: 'POST', body: {
    listing_type: 'sell', title: 'Smoke Test Shirt',
    description: 'A shirt created by the automated smoke test run.',
    category: 'Shirts', gender: 'Men', size: 'L', condition: 'Good',
    brand: 'Test Brand', sale_price: '399', original_price: '799', location: 'Testville' } });
  const sellId = (r.location || '').split('/').pop();
  check('sale listing created', /^\/items\/\d+$/.test(r.location || ''), r.location);

  await primeCsrf(renter, `/items/${sellId}`);
  r = await req(renter, '/requests', { method: 'POST',
    body: { item_id: sellId, message: 'Is it still available?' } });
  check('enquiry sent', r.location === '/requests', r.location);
  await req(renter, '/requests', { expect: 200 });

  const enq = await req(owner, '/requests');
  const enqId = (enq.text.match(/\/requests\/(\d+)\/accept/) || [])[1];
  check('enquiry visible to owner', !!enqId, 'no accept action found');

  await primeCsrf(owner, '/requests');
  r = await req(owner, `/requests/${enqId}/accept`, { method: 'POST' });
  check('enquiry accepted', r.status === 302, 'got ' + r.status);
  await primeCsrf(owner, '/requests');
  r = await req(owner, `/requests/${enqId}/complete`, { method: 'POST' });
  check('enquiry completed', r.status === 302, 'got ' + r.status);

  await primeCsrf(owner, '/items/new');
  r = await req(owner, '/items', { method: 'POST', body: {
    listing_type: 'sell', title: 'Smoke Test Demo Order',
    description: 'A resale item for the demo order workflow.',
    category: 'Shirts', gender: 'Men', size: 'L', condition: 'Good',
    brand: 'Demo Brand', sale_price: '499', original_price: '999', location: 'Testville' } });
  const orderItemId = (r.location || '').split('/').pop();
  check('demo-order listing created', /^\/items\/\d+$/.test(r.location || ''), r.location);
  await req(guest, `/resale?brand=Demo`, { expect: 200 });

  await primeCsrf(renter, `/items/${orderItemId}`);
  r = await req(renter, '/orders', { method: 'POST', body: { item_id: orderItemId } });
  const orderId = (r.location || '').split('/').pop();
  check('demo order placed without payment', r.status === 302 && /^\/orders\/\d+$/.test(r.location || ''),
    `${r.status} ${r.location}`);
  const orderPage = await req(renter, `/orders/${orderId}`, { expect: 200 });
  check('order clearly reports demo payment mode', /no payment was collected or processed/i.test(orderPage.text),
    'demo payment disclosure missing');
  await req(renter, '/orders', { expect: 200 });
  await req(owner, '/orders', { expect: 200 });
  await primeCsrf(owner, `/orders/${orderId}`);
  r = await req(owner, `/orders/${orderId}/status`, { method: 'POST', body: { action: 'accept' } });
  check('seller accepts order', r.status === 302, 'got ' + r.status);
  await primeCsrf(owner, `/orders/${orderId}`);
  r = await req(owner, `/orders/${orderId}/status`, { method: 'POST', body: { action: 'ready' } });
  check('seller marks order ready', r.status === 302, 'got ' + r.status);
  await primeCsrf(owner, `/orders/${orderId}`);
  r = await req(owner, `/orders/${orderId}/status`, { method: 'POST', body: { action: 'complete' } });
  check('seller completes order', r.status === 302, 'got ' + r.status);
  await primeCsrf(stranger, `/items/${orderItemId}`);
  r = await req(stranger, '/orders', { method: 'POST', body: { item_id: orderItemId } });
  check('sold listing cannot be ordered twice', r.status === 302 && r.location === '/resale',
    `${r.status} ${r.location}`);

  await primeCsrf(owner, '/items/new');
  r = await req(owner, '/items', { method: 'POST', body: {
    listing_type: 'donate', title: 'Smoke Test Donation',
    description: 'Clothes offered by the automated smoke test run.',
    category: 'Other', gender: 'Unisex', size: 'M', condition: 'Good',
    quantity: '3',
    handover_method: 'Collection from Testville', location: 'Testville' } });
  const donationId = (r.location || '').split('/').pop();
  check('donation listing created', /^\/items\/\d+$/.test(r.location || ''), r.location);
  await primeCsrf(renter, `/items/${donationId}`);
  r = await req(renter, '/requests', { method: 'POST', body: {
    item_id: donationId, quantity: '2', handover_method: 'Pickup', pickup_date: d(5),
    time_slot: 'Morning (9 am–12 pm)', pickup_location: 'Testville', message: 'For a community drive.' } });
  check('donation pickup request created', r.location === '/requests', r.location);
  const donationRequests = await req(owner, '/requests', { expect: 200 });
  check('donation request has a unique reference',
    /DON-[A-Z0-9]+-[A-F0-9]{6}/.test(donationRequests.text), 'reference missing');

  console.log('\n--- listing status and delete ---');
  await primeCsrf(owner, '/my-listings');
  r = await req(owner, `/items/${itemId}/status`, { method: 'POST', body: { status: 'paused' } });
  check('listing paused', r.status === 302, 'got ' + r.status);
  await primeCsrf(owner, '/my-listings');
  r = await req(owner, `/items/${itemId}/status`, { method: 'POST', body: { status: 'active' } });
  check('listing resumed', r.status === 302, 'got ' + r.status);

  await primeCsrf(stranger, '/my-listings');
  r = await req(stranger, `/items/${itemId}/delete`, { method: 'POST' });
  check('stranger cannot delete a listing', r.status === 404, 'got ' + r.status);

  await primeCsrf(owner, '/my-listings');
  r = await req(owner, `/items/${itemId}/delete`, { method: 'POST' });
  check('owner deletes a listing', r.status === 302, 'got ' + r.status);

  console.log('\n--- profile, notifications, report, survey ---');
  await req(owner, '/profile', { expect: 200 });
  await primeCsrf(owner, '/profile');
  r = await req(owner, '/profile', { method: 'POST', body: {
    name: 'Test Owner', phone: '9876543211', location: 'Testville',
    college: 'Test College', bio: 'Updated by the smoke test.' } });
  check('profile updated', r.status === 302, 'got ' + r.status);

  await req(guest, `/users/${ownerId}`, { expect: 200 });
  await req(guest, `/users/${ownerId}?tab=history`, { expect: 200 });
  await req(guest, `/users/${ownerId}?tab=reviews`, { expect: 200 });
  await req(guest, '/users/99999', { expect: 404 });

  await req(renter, '/notifications', { expect: 200 });
  await req(renter, '/reviews', { expect: 200 });

  await primeCsrf(renter, '/items/1');
  r = await req(renter, '/reports', { method: 'POST', body: {
    item_id: '1', user_id: '3', reason: 'Misleading Description',
    description: 'Raised by the smoke test.', back: '/items/1' } });
  check('report submitted', r.status === 302, 'got ' + r.status);

  await primeCsrf(guest, '/community/survey');
  r = await req(guest, '/community/survey', { method: 'POST', body: {
    q1: 'A few times a year', q2: 'Only once', q3: 'Yes', q4: 'Maybe', q5: 'Yes',
    q6: 'Yes', q7: 'Fit and size', comment: 'Submitted by the smoke test.' } });
  check('survey accepted', r.location === '/community/survey?done=1', r.location);

  await primeCsrf(guest, '/community/survey');
  r = await req(guest, '/community/survey', { method: 'POST', body: { q1: 'Rarely' } });
  check('incomplete survey rejected', r.location === '/community/survey', r.location);

  await req(admin, '/admin/survey', { expect: 200 });
  await req(admin, '/admin/reports', { expect: 200 });

  console.log('\n--- admin moderation and drives ---');
  await primeCsrf(admin, '/admin/drives');
  r = await req(admin, '/admin/drives', { method: 'POST', body: {
    title: 'Smoke Test Drive', organization: 'Smoke Test Org', location: 'Testville',
    description: 'Created by the smoke test.' } });
  check('drive added', r.status === 302, 'got ' + r.status);
  const drives = await req(admin, '/admin/drives');
  const driveId = (drives.text.match(/\/admin\/drives\/(\d+)\/delete/) || [])[1];
  await primeCsrf(admin, '/admin/drives');
  r = await req(admin, `/admin/drives/${driveId}/delete`, { method: 'POST' });
  check('drive deleted', r.status === 302, 'got ' + r.status);

  await primeCsrf(admin, '/admin/listings');
  r = await req(admin, `/admin/listings/${sellId}/remove`, { method: 'POST' });
  check('admin removes a listing', r.status === 302, 'got ' + r.status);
  r = await req(guest, `/items/${sellId}`);
  check('removed listing is gone', r.status === 404, 'got ' + r.status);

  const reports = await req(admin, '/admin/reports');
  const reportId = (reports.text.match(/\/admin\/reports\/(\d+)\/status/) || [])[1];
  await primeCsrf(admin, '/admin/reports');
  r = await req(admin, `/admin/reports/${reportId}/status`, { method: 'POST',
    body: { status: 'reviewed' } });
  check('report marked reviewed', r.status === 302, 'got ' + r.status);

  console.log('\n--- CSRF guard ---');
  const bad = session();
  await primeCsrf(bad, '/login');
  bad.csrf = 'not-the-real-token';
  r = await req(bad, '/login', { method: 'POST',
    body: { email: 'aarav@example.com', password: 'rewear123' } });
  check('bad CSRF token rejected', r.status === 403, 'got ' + r.status);

  console.log('\n--- logout ---');
  await primeCsrf(renter, '/dashboard');
  r = await req(renter, '/logout', { method: 'POST' });
  check('logout redirects home', r.location === '/', r.location);
  r = await req(renter, '/dashboard');
  check('session ended', r.status === 302 && /\/login/.test(r.location || ''), r.location);

  console.log(`\n${'='.repeat(52)}`);
  console.log(`${pass} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log('\nFailures:');
    failures.forEach((f) => console.log('  - ' + f));
    process.exit(1);
  }
  console.log('All checks passed.');
})().catch((e) => { console.error('\nSmoke run crashed:', e); process.exit(1); });
