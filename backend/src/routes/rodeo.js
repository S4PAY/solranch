const express = require('express');
const router = express.Router();
const db = require('../db/init');
const { getRancher } = require('../services/points');

// GET /api/rodeo/active
router.get('/active', async (req, res) => {
  try {
    const result = await db.query(
      'SELECT * FROM rodeo_events WHERE active = TRUE AND ends_at > NOW() ORDER BY starts_at ASC'
    );
    res.json({ events: result.rows });
  } catch (err) {
    console.error('[RODEO] Active events error:', err.message);
    res.status(500).json({ error: 'Failed to fetch rodeo events' });
  }
});

// POST /api/rodeo/enter
// Body: { wallet, eventId, answer }
router.post('/enter', async (req, res) => {
  try {
    const { wallet, eventId, answer } = req.body;
    if (!wallet || !eventId) {
      return res.status(400).json({ error: 'Wallet and event ID required' });
    }

    const rancher = await getRancher(wallet);
    if (!rancher) return res.status(404).json({ error: 'Rancher not found' });

    const event = await db.query(
      'SELECT * FROM rodeo_events WHERE id = $1 AND active = TRUE AND ends_at > NOW()',
      [eventId]
    );
    if (event.rows.length === 0) {
      return res.status(404).json({ error: 'Event not found or ended' });
    }

    try {
      await db.query(
        'INSERT INTO rodeo_entries (event_id, rancher_id, answer) VALUES ($1, $2, $3)',
        [eventId, rancher.id, answer || null]
      );
    } catch (err) {
      if (err.code === '23505') {
        return res.json({ message: 'Already entered this rodeo', alreadyEntered: true });
      }
      throw err;
    }

    res.json({ message: 'Entered the rodeo. Good luck, partner.' });
  } catch (err) {
    console.error('[RODEO] Enter error:', err.message);
    res.status(500).json({ error: 'Failed to enter rodeo' });
  }
});

module.exports = router;
