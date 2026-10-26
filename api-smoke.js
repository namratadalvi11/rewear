/*
 * End-to-end test for the JSON API (/api/v1). Run against a dedicated copy of the
 * database after `npm run seed`, because it creates bookings and wishlist rows.
 *
 *   PORT=5000 node api-smoke.js
 */
const BASE = `http://localhost:${process.env.PORT || 5000}/api/v1`;

let pass = 0;
const failures = [];
function check(label, ok, detail) {
  if (ok) { pass++; console.log('  ok   ' + label); }
  else { failures.push(label); console.log('  FAIL ' + label + (detail ? ' -> ' + detail : '')); }
}

// A tiny client that keeps the session cookie between requests.
function client() {
  let cookie = '';
  return async function call(method, path, body, { raw, headers = {} } = {}) {
    const h = { ...headers };
    let payload;
    if (raw !== undefined) {
      h['content-type'] = 'application/json';
      payload = raw;                       // send exactly these bytes (used for malformed JSON)
    } else if (body !== undefined) {
      h['content-type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    if (cookie) h.cookie = cookie;
    const res = await fetch(BASE + path, { method, headers: h, body: payload, redirect: 'manual' });
    for (const c of res.headers.getSetCookie?.() || []) cookie = c.split(';')[0];
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = null; }
    return { status: res.status, body: json, text };
  };
}

const tomorrow = (n) => {
  const d = new Date(); d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

(async () => {
  const guest = client();
  console.log('\n--- health and public catalogue ---');
  let r = await guest('GET', '/health');
  check('health responds', r.status === 200 && r.body.ok === true);

  r = await guest('GET', '/items?type=rent');
  check('rent listings are public', r.status === 200 && Array.isArray(r.body.items) && r.body.total > 0,
    `status ${r.status}`);
  check('listings never expose a phone number', r.body.items.every((i) => !('phone' in i) && !('owner_phone' in i)));
  check('listing images are an array', r.body.items.every((i) => Array.isArray(i.images)));

  r = await guest('GET', '/items?type=sell');
  check('resale filter returns only sell listings', r.body.items.every((i) => i.listing_type === 'sell'));

  r = await guest('GET', '/items?type=rent&q=saree&category=Sarees&sort=price_asc&page=1');
  check('search and filters combine', r.status === 200 && Array.isArray(r.body.items));

  r = await guest('GET', '/items/1');
  check('item detail', r.status === 200 && r.body.item.id === 1 && Array.isArray(r.body.booked_dates));
  r = await guest('GET', '/items/999999');
  check('unknown item is 404 JSON', r.status === 404 && r.body.error.code === 'not_found');
  r = await guest('GET', '/items/abc');
  check('non-numeric id is 404 JSON', r.status === 404);

  console.log('\n--- authentication ---');
  r = await guest('GET', '/me');
  check('/me requires login', r.status === 401 && r.body.error.code === 'unauthorized');
  r = await guest('POST', '/auth/login', { email: 'aarav@example.com', password: 'wrong-password' });
  check('wrong password is 401', r.status === 401 && r.body.error.code === 'invalid_credentials');
  r = await guest('POST', '/auth/login', { email: 'aarav@example.com' });
  check('missing password is 401, not a crash', r.status === 401);

  const aarav = client();
  r = await aarav('POST', '/auth/login', { email: 'AARAV@example.com ', password: 'rewear123' });
  check('login (email is case-insensitive)', r.status === 200 && r.body.user.name.startsWith('Aarav'));
  check('login response has no password hash', !JSON.stringify(r.body).includes('scrypt'));
  r = await aarav('GET', '/me');
  check('/me returns the session user', r.status === 200 && r.body.user.verification === 'verified'
    && typeof r.body.unread_notifications === 'number');
  check('/me does not expose the email address', !('email' in r.body.user));

  console.log('\n--- request conventions ---');
  r = await client()('POST', '/auth/login', undefined, { raw: '{bad json' });
  check('malformed JSON is 400 JSON', r.status === 400 && r.body?.error?.code === 'invalid_json', `status ${r.status}`);
  const formPost = await fetch(BASE + '/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'email=aarav%40example.com&password=rewear123',
  });
  check('form-encoded mutation is refused (415)', formPost.status === 415);
  const noCt = await fetch(BASE + '/auth/logout', { method: 'POST' });
  check('mutation without content type is refused', noCt.status === 415);
  r = await guest('GET', '/no-such-endpoint');
  check('unknown endpoint is JSON 404', r.status === 404 && r.body.error.code === 'not_found');

  console.log('\n--- rentals: request, duplicate, accept, decline, cancel ---');
  // Aarav owns item 3 (rentable, Rs 200/day). Sneha rents from him.
  const sneha = client();
  r = await sneha('POST', '/auth/login', { email: 'sneha@example.com', password: 'rewear123' });
  check('renter logs in', r.status === 200);

  r = await sneha('POST', '/rentals', { item_id: 3, start_date: tomorrow(40), end_date: tomorrow(42), message: '  Wedding in Pune  ' });
  check('rental request created (201)', r.status === 201 && r.body.rental.status === 'pending', `status ${r.status} ${r.text}`);
  const rentalId = r.body?.rental?.id;
  check('price is calculated server-side (3 days)', r.body?.rental?.days === 3
    && r.body?.rental?.rental_price === 3 * 200, JSON.stringify(r.body?.rental));
  check('message is trimmed', r.body?.rental?.message === 'Wedding in Pune');

  r = await sneha('POST', '/rentals', { item_id: 3, start_date: tomorrow(40), end_date: tomorrow(42) });
  check('duplicate pending request is 409', r.status === 409 && r.body.error.code === 'duplicate_request');

  r = await sneha('POST', '/rentals', { item_id: 3, start_date: '2020-01-01', end_date: '2020-01-02' });
  check('past dates are rejected (422)', r.status === 422 && r.body.error.code === 'invalid_booking');

  r = await sneha('POST', '/rentals', { item_id: 3, start_date: tomorrow(5), end_date: tomorrow(3) });
  check('end before start is rejected', r.status === 422);

  r = await aarav('POST', '/rentals', { item_id: 3, start_date: tomorrow(40), end_date: tomorrow(41) });
  check('owner cannot rent own listing', r.status === 422, `status ${r.status}`);

  const priya = client();
  await priya('POST', '/auth/login', { email: 'priya@example.com', password: 'rewear123' });
  r = await priya('POST', '/rentals', { item_id: 3, start_date: tomorrow(40), end_date: tomorrow(41) });
  check('unverified member cannot request (403)', r.status === 403 && r.body.error.code === 'not_verified');

  r = await sneha('POST', `/rentals/${rentalId}/accept`, {});
  check('renter cannot accept their own request (403)', r.status === 403);

  r = await aarav('GET', '/rentals?role=owner');
  check('owner sees the incoming request', r.status === 200 && r.body.rentals.some((x) => x.id === rentalId));

  r = await sneha('GET', '/rentals');
  check('renter sees their own request', r.body.rentals.some((x) => x.id === rentalId));

  r = await aarav('POST', `/rentals/${rentalId}/accept`, {});
  check('owner accepts the request', r.status === 200 && r.body.rental.status === 'accepted');

  r = await aarav('POST', `/rentals/${rentalId}/accept`, {});
  check('accepting twice is 409', r.status === 409 && r.body.error.code === 'invalid_state');

  r = await sneha('POST', `/rentals/${rentalId}/cancel`, {});
  check('renter can cancel an accepted booking', r.status === 200 && r.body.rental.status === 'cancelled');

  r = await sneha('POST', `/rentals/${rentalId}/cancel`, {});
  check('cancelling again is 409', r.status === 409);

  const stranger = client();
  await stranger('POST', '/auth/login', { email: 'mohsin@example.com', password: 'rewear123' });
  r = await stranger('GET', `/rentals/${rentalId}`);
  check('strangers cannot read a rental (404, not 403, to hide it)', r.status === 404);

  // A decline path with a fresh request.
  r = await sneha('POST', '/rentals', { item_id: 3, start_date: tomorrow(60), end_date: tomorrow(61) });
  const declineId = r.body?.rental?.id;
  r = await aarav('POST', `/rentals/${declineId}/reject`, {});
  check('owner declines a request', r.status === 200 && r.body.rental.status === 'rejected');

  console.log('\n--- notifications and wishlist ---');
  r = await sneha('GET', '/notifications');
  check('renter has notifications', r.status === 200 && r.body.notifications.length > 0);
  check('notifications carry a link', r.body.notifications.every((n) => typeof n.link === 'string' || n.link === null));
  r = await sneha('POST', '/notifications/read-all', {});
  r = await sneha('GET', '/notifications');
  check('read-all clears the unread count', r.body.unread === 0);

  r = await sneha('PUT', '/wishlist/1', { saved: true });
  check('save to wishlist', r.status === 200 && r.body.saved === true);
  r = await sneha('PUT', '/wishlist/1', { saved: true });
  check('saving twice is idempotent', r.status === 200);
  r = await sneha('GET', '/wishlist');
  check('wishlist lists the saved item once', r.body.items.filter((i) => i.id === 1).length === 1);
  r = await sneha('PUT', '/wishlist/1', { saved: false });
  r = await sneha('GET', '/wishlist');
  check('remove from wishlist', !r.body.items.some((i) => i.id === 1));
  r = await sneha('PUT', '/wishlist/1', { saved: 'yes' });
  check('non-boolean saved is 400', r.status === 400 && r.body.error.code === 'invalid_body');
  r = await sneha('PUT', '/wishlist/999999', { saved: true });
  check('wishlisting an unknown item is 404', r.status === 404);

  console.log('\n--- logout ---');
  r = await aarav('POST', '/auth/logout', {});
  check('logout ends the session', r.status === 200);
  r = await aarav('GET', '/me');
  check('session is gone after logout', r.status === 401);

  console.log('\n====================================================');
  console.log(`${pass} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log('Failures:\n - ' + failures.join('\n - '));
    process.exit(1);
  }
  console.log('All API checks passed.');
})().catch((err) => {
  console.error('API smoke run crashed:', err);
  process.exit(1);
});
