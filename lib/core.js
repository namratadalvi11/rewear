/*
 * Shared helpers: password hashing, auth middleware, CSRF, uploads, notifications
 * and the option lists used by the listing forms and filters.
 */
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const multer = require('multer');
const { all, get, run, count } = require('../db');

/* ---------- passwords -------------------------------------------------- */
// scrypt ships with Node, so there is no native module to compile.
// Stored format:  scrypt$<salt-hex>$<hash-hex>
function hashPassword(plain) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(plain, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(plain, stored) {
  const [, saltHex, hashHex] = String(stored).split('$');
  if (!saltHex || !hashHex) return false;
  const hash = crypto.scryptSync(plain, Buffer.from(saltHex, 'hex'), 64);
  const known = Buffer.from(hashHex, 'hex');
  return hash.length === known.length && crypto.timingSafeEqual(hash, known);
}

/* ---------- route helpers --------------------------------------------- */
// Wraps an async route so a rejected promise reaches the Express error handler.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function flash(req, type, text) {
  req.session.flash = { type, text };
}

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    flash(req, 'error', 'Please log in to continue.');
    req.session.returnTo = req.originalUrl;
    return res.redirect('/login');
  }
  next();
}

function requireVerified(req, res, next) {
  if (res.locals.user?.verification !== 'verified') {
    flash(req, 'error', 'Your account needs to be verified before you can do this.');
    return res.redirect('/profile/verify');
  }
  next();
}

function requireAdmin(req, res, next) {
  if (res.locals.user?.role !== 'admin') {
    return res.status(403).render('error', { title: 'Not allowed', code: 403,
      message: 'This area is only for administrators.' });
  }
  next();
}

/* ---------- CSRF ------------------------------------------------------ */
// One token per session, compared against a hidden field on every POST.
function csrf(req, res, next) {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString('hex');
  res.locals.csrfToken = req.session.csrf;
  // Multipart forms (photo uploads) are parsed later by multer, so their token is
  // checked by verifyCsrf after the upload middleware instead of here.
  if (req.method === 'POST' && !req.is('multipart/form-data') && req.body._csrf !== req.session.csrf) {
    return csrfFailure(res);
  }
  next();
}

function csrfFailure(res) {
  return res.status(403).render('error', { title: 'Session expired', code: 403,
    message: 'Your form session expired. Please go back and try again.' });
}

// Use on routes that accept multipart uploads, directly after the upload middleware.
function verifyCsrf(req, res, next) {
  if (req.method === 'POST' && req.body?._csrf !== req.session.csrf) return csrfFailure(res);
  next();
}

/* ---------- login throttle ------------------------------------------- */
// Keeps failed login attempts per IP in memory. Plenty for a community-scale app.
// ponytail: in-memory map, move to a shared store only if the app ever runs on
// more than one process.
const attempts = new Map();
function loginThrottle(req, res, next) {
  const key = req.ip;
  const rec = attempts.get(key);
  if (rec && rec.count >= 10 && Date.now() - rec.first < 15 * 60 * 1000) {
    return res.status(429).render('error', { title: 'Too many attempts', code: 429,
      message: 'Too many login attempts. Please wait 15 minutes and try again.' });
  }
  next();
}
function noteFailedLogin(ip) {
  const rec = attempts.get(ip);
  if (!rec || Date.now() - rec.first > 15 * 60 * 1000) attempts.set(ip, { count: 1, first: Date.now() });
  else rec.count++;
}
const clearFailedLogins = (ip) => attempts.delete(ip);
const isLoginLocked = (ip) => {
  const rec = attempts.get(ip);
  return !!(rec && rec.count >= 10 && Date.now() - rec.first < 15 * 60 * 1000);
};

/* ---------- image uploads -------------------------------------------- */
const UPLOAD_DIR = path.join(__dirname, '..', 'public', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) =>
      cb(null, Date.now() + '-' + crypto.randomBytes(4).toString('hex') +
        path.extname(file.originalname).toLowerCase()),
  }),
  limits: { fileSize: 4 * 1024 * 1024, files: 6 },
  fileFilter: (req, file, cb) => {
    const ok = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.mimetype);
    cb(ok ? null : new Error('Only JPG, PNG, WEBP or GIF images are allowed.'), ok);
  },
});

const uploadedPaths = (files) => (files || []).map((f) => '/uploads/' + f.filename);

/* ---------- notifications -------------------------------------------- */
function notify(userId, type, message, link) {
  run('INSERT INTO notifications (user_id, type, message, link) VALUES (?,?,?,?)',
    userId, type, message, link || null);
}

/* ---------- ratings --------------------------------------------------- */
function ratingOf(userId) {
  const r = get('SELECT ROUND(AVG(rating),1) AS avg, COUNT(*) AS n FROM reviews WHERE reviewee_id = ?', userId);
  return { avg: r.avg || 0, n: Number(r.n || 0) };
}

/* ---------- option lists (used by forms and filters) ------------------ */
const CATEGORIES = ['Sarees', 'Dresses', 'Shirts', 'Kurtas', 'Sherwanis', 'Suits',
  'Jackets', 'Trousers', 'Accessories', 'Other'];
const GENDERS = ['Women', 'Men', 'Unisex'];
const OCCASIONS = ['Wedding', 'Festival', 'Party', 'College', 'Interview', 'Formal',
  'Casual', 'Traditional'];
const SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'Custom Measurements'];
const CONDITIONS = ['Like New', 'Excellent', 'Good', 'Used'];
const REPORT_REASONS = ['Fraud', 'Misleading Description', 'Inappropriate Content',
  'Damaged Item', 'Other'];
const REVIEW_TAGS = ['Reliable', 'On Time', 'Good Condition', 'Responsive', 'Accurate Description'];
const DAMAGE_LEVELS = ['Condition unchanged', 'Minor damage', 'Major damage', 'Missing item/accessory'];
const DONATION_HANDOVER_METHODS = ['Pickup', 'Drop-off'];
const DONATION_TIME_SLOTS = ['Morning (9 am–12 pm)', 'Afternoon (12 pm–4 pm)', 'Evening (4 pm–7 pm)'];

/* ---------- misc formatting ------------------------------------------ */
const money = (n) => '\u20B9' + Number(n || 0).toLocaleString('en-IN');
const json = (text, fallback) => { try { return JSON.parse(text); } catch { return fallback; } };
const today = () => new Date().toISOString().slice(0, 10);
const dayCount = (from, to) =>
  Math.round((new Date(to) - new Date(from)) / 86400000) + 1; // inclusive of both days
const prettyDate = (d) => d ? new Date(d + (d.length === 10 ? 'T00:00:00' : ''))
  .toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '';

module.exports = {
  all, get, run, count,
  hashPassword, verifyPassword,
  wrap, flash, requireAuth, requireVerified, requireAdmin, csrf, verifyCsrf,
  loginThrottle, noteFailedLogin, clearFailedLogins, isLoginLocked,
  upload, uploadedPaths, notify, ratingOf,
  CATEGORIES, GENDERS, OCCASIONS, SIZES, CONDITIONS, REPORT_REASONS, REVIEW_TAGS, DAMAGE_LEVELS,
  DONATION_HANDOVER_METHODS, DONATION_TIME_SLOTS,
  money, json, today, dayCount, prettyDate,
};
