# ReWear

**Wear More. Waste Less.**

A community-driven clothing reuse platform. Members of a local community (a college,
a neighbourhood) **rent** clothes to each other, with **resale** and **donation** as
supporting options. Built as a Community Engagement Project.

Occasion wear is the clearest case of clothes bought for a single use — a wedding
outfit, an interview blazer, a festival saree. Within one community, the person who
owns that outfit and the person who needs it next are usually a short walk apart.
ReWear makes that exchange practical by focusing on the hard part: **trust**.

---

## Contents

- [Quick start](#quick-start)
- [Demo accounts](#demo-accounts)
- [What to show in a demo](#what-to-show-in-a-demo)
- [Technology stack](#technology-stack)
- [Features](#features)
- [Folder structure](#folder-structure)
- [Database schema](#database-schema)
- [Routes](#routes)
- [Environment variables](#environment-variables)
- [Testing](#testing)
- [Design notes](#design-notes)
- [Future scope](#future-scope)

---

## Quick start

Requires **Node.js 22.5 or newer** (it uses Node's built-in SQLite module).
Check with `node -v`.

```bash
npm install
```

```bash
cp .env.example .env
```

```bash
npm run seed
```

```bash
npm run dev
```

Then open **http://localhost:5000**.

There is **no database server to install**. The whole database is one file
(`rewear.db`) created automatically on first run. `npm run seed` wipes it and loads
the demo community.

| Command | What it does |
| --- | --- |
| `npm run dev` | Start with auto-restart on file changes |
| `npm start` | Start normally |
| `npm run seed` | Reset the database and load demo data |
| `npm run smoke` | Run the end-to-end test against a running app |

---

## Demo accounts

All demo people, organisations and items are invented for this project. No real
personal information is used anywhere.

| Email | Password | Role |
| --- | --- | --- |
| `admin@rewear.local` | `admin123` | **Admin** — verification queue, reports, drives, survey results |
| `aarav@example.com` | `rewear123` | Verified member — has listings, bookings and reviews |
| `sneha@example.com` | `rewear123` | Verified member — most rentals, traditional wear |
| `ananya@example.com` | `rewear123` | Verified member — **has pending requests waiting for a decision** |
| `mohsin@example.com` | `rewear123` | Verified member |
| `vikram@example.com` | `rewear123` | Verification **pending** — shows the admin queue |
| `priya@example.com` | `rewear123` | **Unverified** — shows the verification gate |

---

## What to show in a demo

A path through the app that hits every important feature in a few minutes.

1. **Home** — hero, occasion tiles, featured rentals pulled from the database, live
   impact statistics.
2. **Browse** (`/browse`) — filter by category, occasion, size and price; try the
   date-range filter, which hides anything already booked; change the sort.
3. **Item detail** — measurements, condition, deposit, owner rating, booked dates,
   trust indicators. Note that the owner's phone number is *not* shown.
4. **Log in as `priya@example.com`** — try to request a rental. You are stopped by
   the verification gate.
5. **Log in as `admin@rewear.local`** → `/admin/users` → verify Vikram Rao. The
   admin dashboard also shows reports, all listings, all transactions and survey results.
6. **Log in as `ananya@example.com`** → `/rentals/requests` — two real pending requests.
   **Accept** one.
7. On the booking page, **record the condition before handover** (damage level, marks,
   accessories, photos). The timeline advances.
8. **Log in as the renter** (`priya@example.com` or `sneha@example.com`) → confirm the
   handover. The rental goes active and the item shows as rented.
9. Back as the owner → **record the return**. Renter confirms → booking **completed**.
10. Both sides can now **leave a review** — try reviewing a booking that is not
    complete and it is refused.
11. **Resale Hub** (`/resale`) and **Donation Hub** (`/donate`) — send an enquiry,
    accept it as the owner, mark it handed over.
12. **Community** (`/community`) — impact dashboard with charts built from real rows.
13. **Survey** (`/community/survey`) — submit a response, then view the aggregated
    results at `/admin/survey`.

---

## Technology stack

| Layer | Choice | Why |
| --- | --- | --- |
| Server | **Node.js + Express** | Simple, well documented, easy to explain |
| Views | **EJS** templates | Server-rendered HTML, no frontend framework |
| Styling | **Plain CSS** (one stylesheet, CSS variables) | No build step, no Bootstrap look |
| Client JS | **Vanilla JavaScript** | Progressive enhancement only |
| Database | **SQLite** via Node's built-in `node:sqlite` | Zero setup — no server to install or run |
| Auth | `express-session` + **scrypt** from `node:crypto` | Password hashing with no native module to compile |
| Uploads | `multer` | Image uploads to `public/uploads/` |
| Security | `helmet`, CSRF tokens, login throttling | Sensible defaults |
| Config | `node --env-file` | Built in, so no `dotenv` dependency |
| Dev reload | `node --watch` | Built in, so no `nodemon` dependency |

Total runtime dependencies: **five** (`express`, `ejs`, `express-session`, `helmet`,
`multer`). Everything else is the Node standard library.

> **Note on the original brief.** The brief specified MongoDB + Mongoose and bcrypt.
> This build uses SQLite and scrypt instead, both from Node's standard library, so the
> project runs with `npm install && npm run dev` on any machine with no database server
> and no native compilation step. The data model is unchanged — the same seven entities,
> the same fields, just relational tables instead of documents. If MongoDB is a hard
> requirement for assessment, `db.js` is the only file that would need rewriting.

---

## Features

### Rentals (the core)

- Browse with search across name, category, occasion and description
- Filters: category, gender, occasion, size, condition, price range, locality, **date availability**
- Sort by newest, price, most rented, highest-rated owner; pagination
- Item pages with real measurements (chest, waist, length, shoulder, sleeve), condition,
  deposit, included accessories and a list of already-booked dates
- Request → owner accepts or rejects → handover → active → return → completed
- Accepting a request **automatically declines other requests for the same dates**
- Date validation: no past dates, end after start, inside the owner's availability
  window, no overlap with a confirmed booking, and you cannot rent your own listing
- A session-backed rental cart can hold date-specific requests for multiple listings.
  Checkout rechecks availability and submits owner-approved requests; it does not
  collect payment. Handover and delivery are arranged locally by members.

### Condition records

The trust feature. For every booking:

- Before handover, the owner records overall condition, visible marks, stains, tears,
  missing buttons, accessories included, plus photos
- The renter confirms that record before the rental starts
- On return the owner records the condition again — unchanged, minor damage, major
  damage, or missing item
- Both records stay attached to the booking, shown on a **Listed → Booked → Handed Over
  → Rented → Returned → Completed** timeline

### Resale and donation

Resale listings include optional brand and original-price details. Buyers can place a
trackable demo-mode order; the listing is reserved immediately to prevent a second order,
and the seller updates its status through acceptance, handover-ready and completion.
**No payment is collected or processed**: members arrange payment and local handover
themselves. A seller can also use the original enquiry-and-handover flow.

Donation listings support garment quantities. A recipient can request a quantity and
propose pickup or drop-off, a future date, a time window and a locality. Each request gets
a unique reference; full street addresses are not collected. The Donation Hub also lists
collection drives managed by an admin.

### Trust and safety

- Verification: unverified → pending → verified, approved by an admin. Browsing is open;
  renting and listing require verification
- Reviews only after a **completed** transaction, one per person per transaction
- Report any listing or member; admins can remove listings and the owner is notified
- Phone numbers are shared only after a booking is accepted. Home addresses are never
  stored or shown — only a locality

### Also built

Notifications with unread count in the navbar · member dashboard with stats, upcoming
rentals and return reminders · public profiles with listings, rental history and review
tabs · community impact dashboard · community survey with an admin results view ·
admin dashboard for members, listings, transactions, reports and drives.

---

## Folder structure

```
rewear/
├── server.js              Express setup, view locals, error handling
├── db.js                  SQLite connection + schema (created on first run)
├── seed.js                Demo data
├── smoke.js               End-to-end test
├── .env.example
│
├── lib/
│   ├── core.js            Passwords, auth middleware, CSRF, uploads, option lists
│   ├── rental.js          Shared rental date and availability validation
│   └── search.js          The filter/sort/paginate query, shared by all three hubs
│
├── routes/
│   ├── pages.js           Home, how it works, about
│   ├── auth.js            Register, login, logout
│   ├── items.js           Browse, item detail, create/edit/delete listings
│   ├── rentals.js         The rental flow and condition records
│   ├── trade.js           Resale hub, donation hub, enquiries
│   ├── orders.js          Demo-mode resale orders and seller status updates
│   ├── cart.js            Rental cart and owner-approved booking checkout
│   ├── social.js          Profiles, verification, reviews, reports, notifications
│   ├── dashboard.js       Member dashboard
│   ├── community.js       Impact page and survey
│   └── admin.js           Admin area (all routes behind requireAdmin)
│
├── views/
│   ├── partials/          head, navbar, foot, item-card, filters, pager, empty, admin-tabs
│   ├── auth/  items/  rentals/  orders/  dashboard/  profile/  community/  admin/
│   ├── home.ejs  how-it-works.ejs  about.ejs  error.ejs
│
└── public/
    ├── css/style.css      One stylesheet, sectioned and commented
    ├── js/main.js         Nav, gallery, image preview, date totals, confirmations
    └── uploads/           Uploaded images (git-ignored)
```

---

## Database schema

Eleven tables, created automatically by `db.js`; new columns are added to existing
databases on startup.

| Table | Purpose | Key fields |
| --- | --- | --- |
| `users` | Members | name, email, phone, password (scrypt hash), location, college, verification, role |
| `items` | All listings | owner_id, listing_type (rent/sell/donate), title, brand, quantity, category, gender, occasion, size, measurements, condition, rental_price, sale_price, original_price, security_deposit, images, availability, status |
| `wishlists` | Member-saved items | user_id, item_id, created_at |
| `rentals` | Bookings | item_id, renter_id, owner_id, dates, days, price, deposit, status, **condition_before**, **condition_after**, handover_confirmed, return_confirmed |
| `orders` | Resale orders | item_id, buyer_id, seller_id, sale_price, payment_mode, status |
| `requests` | Resale and donation enquiries | request_code, item_id, requester_id, owner_id, kind, donation quantity and handover preferences, status |
| `reviews` | Post-transaction reviews | reviewer_id, reviewee_id, item_id, rental_id, request_id, rating, comment, tags |
| `notifications` | In-app alerts | user_id, message, type, link, read |
| `reports` | Member reports | reporter_id, user_id, item_id, reason, description, status |
| `drives` | Donation collection drives | title, organization, description, location, dates, is_demo |
| `survey` | Community survey responses | user_id (nullable), answers (JSON) |

Fields holding structured data (`measurements`, `images`, `tags`, the condition records,
survey `answers`) are stored as JSON text and parsed in the view layer.

Listings are **soft-deleted** (`status = 'removed'`) so past bookings and reviews still
make sense.

---

## Routes

**Public** — `/` · `/explore` · `/browse` · `/resale` · `/donate` · `/items/:id` ·
`/how-it-works` · `/about` · `/community` · `/community/survey` · `/users/:id` ·
`/login` · `/register`

**Members** (login required) — `/dashboard` · `/my-listings` · `/items/new` · `/cart` · `/orders` ·
`/items/:id/edit` · `/rentals` · `/rentals/requests` · `/rentals/:id` · `/requests` ·
`/reviews` · `/notifications` · `/wishlist` · `/profile` · `/profile/verify`

**Rental actions** (POST) — `/rentals/request` · `/rentals/:id/accept` · `/reject` ·
`/cancel` · `/handover` · `/confirm-handover` · `/return` · `/complete`

**Resale orders** — POST `/orders` to place a demo-mode order; GET `/orders` and
`/orders/:id` to track it; POST `/orders/:id/status` for seller updates or cancellation.

**Rental cart** — POST `/cart/add` and `/cart/remove` to manage date-specific selections;
POST `/cart/checkout` revalidates availability and submits rental requests. GET `/cart`
shows estimated rent and deposits; payment, delivery, and platform fees are not processed.

**Admin** (admin role required) — `/admin` · `/admin/users` · `/admin/listings` ·
`/admin/rentals` · `/admin/reports` · `/admin/drives` · `/admin/survey`

Filters use query parameters, so any filtered view is a shareable link:
`/browse?category=Sarees&occasion=Wedding&size=M&sort=price_asc`

---

## Environment variables

Copy `.env.example` to `.env`:

```
PORT=5000
SESSION_SECRET=change-me-to-a-long-random-string
DB_FILE=rewear.db
```

Nothing is hard-coded, and `.env` is git-ignored.

---

## Testing

`smoke.js` walks the whole application end to end: public pages, search and filters,
registration validation, login (including a wrong password), the verification gate,
listing creation and editing, rental cart checkout and cancellation, the complete rental
flow through both condition records,
the review guard, member wishlists, resale demo orders and status updates, donation
request references and pickup preferences, resale and donation enquiries, reports, the survey,
every admin page and action, the CSRF guard, access control, and logout.

```bash
npm run seed
```

```bash
npm start
```

Then, in a second terminal:

```bash
npm run smoke
```

It prints a line per check and a final count.

To keep the test away from demo data, point it at its own database:
`DB_FILE=test.db npm run seed` and `DB_FILE=test.db npm start`.

---

## Design notes

**Palette** — forest green `#234D3C`, cream `#F7F4ED`, beige `#E8DCD0`, gold `#C5A46D`,
charcoal `#252525` and white. **Type** — Playfair Display for headings, Inter for body.

**Images** — homepage editorial and category photography is stored locally in
`public/images/`. The images are sourced from Unsplash under its
[Unsplash License](https://unsplash.com/license), so the design does not rely on a remote
image host at runtime. Homepage image sources (Unsplash photo IDs) are:

- Hero — `1764298493197-a1c1cce57800`
- Ethnic — `1773439878720-1d2410dee362`
- Western — `1785354745571-2b7df3fdfe50`
- Party — `1597976618063-810eb50c84fb`
- Formal — `1571513800374-df1bbe650e56`
- Casual — `1727535726705-b2aa71327c1c`
- Accessories — `1527683733002-dacad6f2c4b6`

Demo listings without member-uploaded photos continue to use the labelled, category-tinted
swatches from `/placeholder.svg`; this avoids presenting stock photography as an actual
member listing. Real uploads are served from `/uploads`.

**Responsive** — breakpoints at 1000px, 900px, 780px and 420px. Navigation collapses to a
hamburger with a fixed mobile quick-navigation bar, collection filters collapse behind a
disclosure, cards reflow to two-up on phones, item details stack into a touch-friendly gallery
and information flow, dashboard statistics and actions adapt to phone widths, and admin
tables scroll horizontally rather than squashing.

**Accessibility** — semantic HTML, a skip link, labels on every field, visible focus
rings, `alt` text, charts carry text alternatives, and `prefers-reduced-motion` is honoured.

**Progressive enhancement** — every action is a plain HTML form, so the app works with
JavaScript disabled. JS adds the mobile menu and collection-filter disclosure, gallery
thumbnail and previous/next controls, image previews, the live rental total and confirmation
prompts.

**Security** — scrypt password hashing, session cookies that are `httpOnly` and
`sameSite=lax`, session id regenerated on login, a CSRF token on every POST, login
throttling per IP, Helmet with a content security policy, upload type and size limits,
server-side validation on every form, and ownership checks on every mutating route.
Profile queries select only public columns, so passwords, emails and phone numbers
cannot leak into a template by accident.

---

## Future scope

Not built, and deliberately not implied by dead buttons. The About page lists these
as "Coming Soon" cards.

- **Your Digital Wardrobe** — upload your wardrobe and find ways to rent, resell,
  donate or restyle what you already own
- **ReWear Score** — a reuse score from rentals, wears, resale, donations and condition
- AI-assisted condition checks from photos · outfit recommendations · size matching
- Digital payments and escrow for deposits · delivery partnerships · damage protection
- Laundry partners between rentals · verified NGO partnerships · community rewards
- Campus-level and society-level sub-communities

---

*ReWear is a student Community Engagement Project. All data in the seeded demo is
invented. Environmental claims are deliberately limited to counts of clothes reused —
no unsupported water or carbon figures.*

---

## JSON API (v1)

The same backend is also available as JSON for mobile apps and integrations. It lives in
`routes/api.js` under `/api/v1` and reuses the website's database, search, validation and booking rules.

| Method | Path | Auth | What it does |
|---|---|---|---|
| GET | `/api/v1/health` | none | Service check |
| POST | `/api/v1/auth/login` | none | `{ email, password }`, starts a session cookie |
| POST | `/api/v1/auth/logout` | session | Ends the session |
| GET | `/api/v1/me` | session | Current user and unread notification count |
| GET | `/api/v1/items` | none | Search: `type=all\|rent\|sell\|donate`, `q`, `category`, `size`, `sort`, `page`, … |
| GET | `/api/v1/items/:id` | none | One listing with booked dates |
| GET | `/api/v1/rentals?role=renter\|owner` | session | Bookings I rent, or requests for my items |
| GET | `/api/v1/rentals/:id` | session | One booking (only its renter or owner can see it) |
| POST | `/api/v1/rentals` | verified | `{ item_id, start_date, end_date, message? }` |
| POST | `/api/v1/rentals/:id/accept\|reject` | owner | Decide a pending request |
| POST | `/api/v1/rentals/:id/cancel` | renter or owner | Cancel a pending or accepted booking |
| GET | `/api/v1/wishlist` | session | Saved items |
| PUT | `/api/v1/wishlist/:itemId` | session | `{ "saved": true \| false }` (idempotent) |
| GET | `/api/v1/notifications` | session | Latest 50 notifications |
| POST | `/api/v1/notifications/read-all` | session | Mark all as read |

**Conventions**

- Responses are JSON. Errors look like `{ "error": { "code": "...", "message": "..." } }`.
- Send `Content-Type: application/json` on every POST or PUT. Other content types are refused with 415,
  which protects the API from cross-site form attacks without a CSRF token.
- Phone numbers and password hashes are never returned.
- Login uses the same brute-force lockout as the website (10 failures per IP, 15 minutes).

**Test it**

```bash
npm run seed                      # demo data
npm start                         # in one terminal
npm run api-smoke                 # 49 checks, in another terminal (PORT defaults to 5000)
```

Example:

```bash
curl -c jar.txt -H "Content-Type: application/json" \
  -d '{"email":"sneha@example.com","password":"rewear123"}' http://localhost:5000/api/v1/auth/login
curl -b jar.txt http://localhost:5000/api/v1/rentals
```
