const express = require('express');
const router = express.Router();
const db = require('../db/init');

router.get('/count', async (req, res) => {
  try {
    const result = await db.query('SELECT COUNT(*) as cnt FROM beta_signups');
    res.json({ count: parseInt(result.rows[0].cnt) });
  } catch (err) {
    res.json({ count: 0 });
  }
});

router.post('/signup', async (req, res) => {
  try {
    const { email, ranch_name } = req.body;
    if (!email || !email.includes('@gmail.com')) {
      return res.status(400).json({ error: 'Must be a Gmail address' });
    }

    const existing = await db.query('SELECT id FROM beta_signups WHERE email = $1', [email.toLowerCase()]);
    if (existing.rows.length > 0) {
      return res.json({ error: 'You already signed up!' });
    }

    await db.query(
      'INSERT INTO beta_signups (email, ranch_name) VALUES ($1, $2)',
      [email.toLowerCase(), ranch_name || null]
    );

    const count = await db.query('SELECT COUNT(*) as cnt FROM beta_signups');
    console.log('[BETA] New signup: ' + email + ' (' + count.rows[0].cnt + '/12)');

    res.json({ success: true, count: parseInt(count.rows[0].cnt) });
  } catch (err) {
    if (err.code === '23505') return res.json({ error: 'You already signed up!' });
    console.error('[BETA] Error:', err.message);
    res.status(500).json({ error: 'Something went wrong' });
  }
});

// Admin: list signups (add ?key=solranch for basic auth)
router.get('/list', async (req, res) => {
  if (req.query.key !== 'solranch') return res.status(403).json({ error: 'Forbidden' });
  const result = await db.query('SELECT * FROM beta_signups ORDER BY created_at');
  res.json(result.rows);
});

module.exports = router;
