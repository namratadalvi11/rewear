/* Registration, login and logout. */
const router = require('express').Router();
const { get, run, wrap, flash, hashPassword, verifyPassword,
  loginThrottle, noteFailedLogin, clearFailedLogins, notify } = require('../lib/core');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
const PHONE_RE = /^[0-9+\-\s]{10,15}$/;

router.get('/register', (req, res) => {
  if (req.session.userId) return res.redirect('/dashboard');
  res.render('auth/register', { title: 'Join ReWear', errors: [], form: {} });
});

router.post('/register', wrap((req, res) => {
  const { name, email, phone, password, confirm, location, college } = req.body;
  const form = { name, email, phone, location, college };
  const errors = [];

  if (!name || name.trim().length < 2) errors.push('Please enter your full name.');
  if (!EMAIL_RE.test(email || '')) errors.push('Please enter a valid email address.');
  if (!PHONE_RE.test(phone || '')) errors.push('Please enter a valid phone number.');
  if (!password || password.length < 8) errors.push('Password must be at least 8 characters.');
  if (password !== confirm) errors.push('The two passwords do not match.');
  if (!location || location.trim().length < 2) errors.push('Please enter your locality or community.');
  if (!errors.length && get('SELECT id FROM users WHERE email = ?', email.toLowerCase()))
    errors.push('An account with this email already exists.');

  if (errors.length) return res.status(400).render('auth/register',
    { title: 'Join ReWear', errors, form });

  const info = run(
    `INSERT INTO users (name, email, phone, password, location, college)
     VALUES (?,?,?,?,?,?)`,
    name.trim(), email.toLowerCase().trim(), phone.trim(),
    hashPassword(password), location.trim(), (college || '').trim() || null);

  req.session.userId = Number(info.lastInsertRowid);
  notify(req.session.userId, 'welcome',
    'Welcome to ReWear! Request verification to start renting and listing.', '/profile/verify');
  flash(req, 'success', 'Account created. Welcome to ReWear!');
  res.redirect('/dashboard');
}));

router.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect('/dashboard');
  res.render('auth/login', { title: 'Log in to ReWear', errors: [], form: {} });
});

router.post('/login', loginThrottle, wrap((req, res) => {
  const { email, password } = req.body;
  const user = get('SELECT * FROM users WHERE email = ?', String(email || '').toLowerCase().trim());

  if (!user || !verifyPassword(password || '', user.password)) {
    noteFailedLogin(req.ip);
    return res.status(401).render('auth/login', { title: 'Log in to ReWear',
      errors: ['Incorrect email or password.'], form: { email } });
  }

  clearFailedLogins(req.ip);
  const to = req.session.returnTo;
  req.session.regenerate((err) => {         // new session id after login
    if (err) throw err;
    req.session.userId = user.id;
    flash(req, 'success', `Welcome back, ${user.name.split(' ')[0]}.`);
    res.redirect(to || '/dashboard');
  });
}));

router.post('/logout', (req, res) => req.session.destroy(() => res.redirect('/')));

module.exports = router;
