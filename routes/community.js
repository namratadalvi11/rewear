/*
 * Community Impact page and the community survey.
 *
 * The survey is the community-engagement part of the project: responses are
 * stored in the database and summarised for the admin.
 */
const router = require('express').Router();
const { all, get, run, count, wrap, flash } = require('../lib/core');
const { platformStats } = require('./pages');

// The survey questions live here so the form, the summary and the seed script
// all stay in step.
const QUESTIONS = [
  { id: 'q1', text: 'How often do you buy clothes for special occasions?',
    options: ['Very often', 'A few times a year', 'Rarely', 'Almost never'] },
  { id: 'q2', text: 'How often do you actually wear those clothes afterwards?',
    options: ['Many times', 'Two or three times', 'Only once', 'Never again'] },
  { id: 'q3', text: 'Would you rent clothes from someone in your community?',
    options: ['Yes', 'Maybe', 'No'] },
  { id: 'q4', text: 'Would you rent out your unused clothes?',
    options: ['Yes', 'Maybe', 'No'] },
  { id: 'q5', text: 'Would you resell clothes you no longer wear?',
    options: ['Yes', 'Maybe', 'No'] },
  { id: 'q6', text: 'Would you donate wearable clothes?',
    options: ['Yes', 'Maybe', 'No'] },
  { id: 'q7', text: 'What would most stop you from renting clothes?',
    options: ['Hygiene', 'Damage or loss', 'Fit and size', 'Trusting the other person',
      'Nothing in particular'] },
];

/* ---------- impact ----------------------------------------------------- */
router.get('/', wrap((req, res) => {
  const stats = platformStats();

  // Category mix, used for the simple bar chart on the page.
  const byCategory = all(`SELECT category, COUNT(*) AS n FROM items
    WHERE status != 'removed' GROUP BY category ORDER BY n DESC`);
  const byType = all(`SELECT listing_type, COUNT(*) AS n FROM items
    WHERE status != 'removed' GROUP BY listing_type`);
  const topLocations = all(`SELECT location, COUNT(*) AS n FROM items
    WHERE status != 'removed' GROUP BY location ORDER BY n DESC LIMIT 6`);

  // Estimate only. 1 rental or resale or donation = 1 garment kept in use.
  // Stated plainly on the page, with the assumption written next to it.
  const reuseEvents = stats.rentals + stats.resold + stats.donated;

  res.render('community/impact', {
    title: 'Community Impact', stats, byCategory, byType, topLocations, reuseEvents,
    responses: count('SELECT COUNT(*) AS n FROM survey'),
  });
}));

/* ---------- survey ----------------------------------------------------- */
router.get('/survey', (req, res) =>
  res.render('community/survey', { title: 'Community Survey', questions: QUESTIONS,
    done: req.query.done === '1' }));

router.post('/survey', wrap((req, res) => {
  const answers = {};
  for (const q of QUESTIONS) {
    const given = req.body[q.id];
    if (q.options.includes(given)) answers[q.id] = given;
  }
  if (Object.keys(answers).length < QUESTIONS.length) {
    flash(req, 'error', 'Please answer all the questions.');
    return res.redirect('/community/survey');
  }
  answers.comment = String(req.body.comment || '').trim().slice(0, 500);

  run('INSERT INTO survey (user_id, answers) VALUES (?,?)',
    req.session.userId || null, JSON.stringify(answers));
  res.redirect('/community/survey?done=1');
}));

module.exports = router;
module.exports.QUESTIONS = QUESTIONS;
