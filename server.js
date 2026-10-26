/*
 * ReWear - community clothing rental, resale and donation platform.
 * Entry point: configures Express, sessions and routes. All real logic lives
 * in routes/ and lib/ so this file stays short.
 */
const path = require('node:path');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');

const { all, get, count, csrf, json, money, prettyDate, today } = require('./lib/core');

const app = express();
const PORT = process.env.PORT || 5000;

/* ---------- view engine ---------------------------------------------- */
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
// Lets templates use absolute includes like <%- include('/partials/head') %>
// no matter how deep the template sits inside views/.
app.set('view options', { root: path.join(__dirname, 'views') });

/* ---------- security & parsing --------------------------------------- */
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      // Inline styles are needed for server-rendered progress and chart widths;
      // scripts remain external and restricted to this origin.
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:'],
    },
  },
}));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'rewear-dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: 7 * 24 * 60 * 60 * 1000 },
}));
/* ---------- things every template needs ------------------------------ */
app.use((req, res, next) => {
  const user = req.session.userId
    ? get('SELECT * FROM users WHERE id = ?', req.session.userId)
    : null;
  if (req.session.userId && !user) req.session.destroy(() => {}); // deleted account
  res.locals.user = user;
  res.locals.unread = user
    ? count('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read = 0', user.id)
    : 0;
  res.locals.wishlistIds = user
    ? all('SELECT item_id FROM wishlists WHERE user_id = ?', user.id).map((row) => row.item_id)
    : [];
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  res.locals.path = req.path;
  res.locals.query = req.query;
  // view helpers
  res.locals.money = money;
  res.locals.json = json;
  res.locals.prettyDate = prettyDate;
  res.locals.today = today();
  res.locals.stars = (v) => {
    const n = Math.round(Number(v) || 0);
    return '★'.repeat(n) + '☆'.repeat(5 - n);
  };
  res.locals.itemImage = (item) => {
    const imgs = json(item.images, []);
    return imgs.length ? imgs[0]
      : `/placeholder.svg?t=${encodeURIComponent(item.title)}&c=${encodeURIComponent(item.category)}`;
  };
  res.locals.itemImages = (item) => {
    const imgs = json(item.images, []);
    return imgs.length ? imgs : [res.locals.itemImage(item)];
  };
  next();
});

// After the locals above, so that the CSRF failure page can render the layout.
// JSON API for mobile apps and integrations. Mounted before the CSRF guard because it
// uses JSON-only mutations instead of hidden form tokens (see routes/api.js).
app.use('/api/v1', require('./routes/api'));

app.use(csrf);

/* ---------- placeholder artwork --------------------------------------
 * Demo listings have no photographs, so we draw a simple labelled swatch
 * instead of shipping stock images. Real uploads are served from /uploads.
 */
const SWATCHES = {
  Sarees: ['#7C3B4B', '#C8A96B'], Dresses: ['#3F5A76', '#C8A96B'],
  Shirts: ['#4A6572', '#E6DED0'], Kurtas: ['#6B8E6E', '#F0E7D6'],
  Sherwanis: ['#243B2F', '#C8A96B'], Suits: ['#2B2B33', '#B9AE96'],
  Jackets: ['#3A4A52', '#D8CDB8'], Trousers: ['#4C4A42', '#E1D8C6'],
  Accessories: ['#8A6A4B', '#F0E7D6'], Other: ['#5A6B5C', '#EDE5D6'],
};
app.get('/placeholder.svg', (req, res) => {
  const cat = String(req.query.c || 'Other');
  const label = String(req.query.t || 'ReWear').slice(0, 40)
    .replace(/[<>&]/g, ''); // keep the SVG well-formed
  const [bg, fg] = SWATCHES[cat] || SWATCHES.Other;
  res.type('image/svg+xml').set('Cache-Control', 'public, max-age=86400').send(
`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 500" width="400" height="500" role="img" aria-label="${label}">
  <rect width="400" height="500" fill="${bg}"/>
  <circle cx="330" cy="90" r="120" fill="${fg}" opacity="0.18"/>
  <circle cx="60" cy="430" r="90" fill="${fg}" opacity="0.14"/>
  <path d="M200 120 l34 26 -14 28 h-40 l-14 -28z" fill="${fg}" opacity="0.7"/>
  <path d="M180 174 h40 l26 130 q-46 18 -92 0z" fill="${fg}" opacity="0.5"/>
  <text x="200" y="370" text-anchor="middle" fill="${fg}" font-family="Georgia,serif" font-size="22">${cat}</text>
  <text x="200" y="400" text-anchor="middle" fill="${fg}" font-family="Helvetica,sans-serif" font-size="14" opacity="0.8">ReWear</text>
</svg>`);
});

/* ---------- routes ---------------------------------------------------- */
app.use('/', require('./routes/pages'));
app.use('/', require('./routes/auth'));
app.use('/', require('./routes/items'));
app.use('/', require('./routes/orders'));
app.use('/', require('./routes/cart'));
app.use('/rentals', require('./routes/rentals'));
app.use('/', require('./routes/trade'));      // resale hub + donation hub
app.use('/', require('./routes/wishlist'));
app.use('/', require('./routes/social'));     // reviews, reports, notifications, profile
app.use('/dashboard', require('./routes/dashboard'));
app.use('/community', require('./routes/community'));
app.use('/admin', require('./routes/admin'));

/* ---------- 404 + error handling -------------------------------------- */
app.use((req, res) => {
  res.status(404).render('error', { title: 'Page not found', code: 404,
    message: "We couldn't find that page. It may have been moved or removed." });
});

// Central error handler - logs the real error, shows the user something friendly.
app.use((err, req, res, next) => {
  console.error('[error]', err.message);
  const isUpload = err.code === 'LIMIT_FILE_SIZE' || /images are allowed/.test(err.message);
  res.status(isUpload ? 400 : 500).render('error', {
    title: isUpload ? 'Upload problem' : 'Something went wrong',
    code: isUpload ? 400 : 500,
    message: isUpload ? err.message
      : 'Something went wrong on our side. Please try again in a moment.',
  });
});

app.listen(PORT, () => console.log(`ReWear running on http://localhost:${PORT}`));
