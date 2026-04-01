const express = require('express');
const router = express.Router();
const db = require('../db/init');

let cache = { data: null, ts: 0 };

router.get('/', async (req, res) => {
  try {
    if (cache.data && Date.now() - cache.ts < 30000) return res.json(cache.data);

    const total = await db.query('SELECT COUNT(*) as count FROM ranchers');
    const today = new Date().toISOString().split('T')[0];
    const active = await db.query(
      'SELECT COUNT(DISTINCT rancher_id) as count FROM daily_points WHERE day_date = $1 AND total_pts > 0', [today]
    );
    const eligible = await db.query(`
      SELECT COUNT(DISTINCT dp.rancher_id) as count FROM daily_points dp
      JOIN ranchers r ON r.id = dp.rancher_id
      LEFT JOIN token_snapshots ts ON ts.rancher_id = r.id AND ts.day_date = $1
      WHERE dp.day_date = $1 AND dp.total_pts > 0 AND COALESCE(ts.balance, 0) >= 50000
    `, [today]);
    const totalPaid = await db.query('SELECT COALESCE(SUM(reward_usdc), 0) as total FROM reward_payouts');

    const result = {
      totalRanchers: parseInt(total.rows[0].count),
      activeToday: parseInt(active.rows[0].count),
      eligibleToday: parseInt(eligible.rows[0].count),
      totalPaidUsdc: parseFloat(totalPaid.rows[0].total),
    };

    cache = { data: result, ts: Date.now() };
    res.json(result);
  } catch (err) {
    console.error('[STATS] Error:', err.message);
    res.json({ totalRanchers: 0, activeToday: 0, eligibleToday: 0, totalPaidUsdc: 0 });
  }
});

module.exports = router;
