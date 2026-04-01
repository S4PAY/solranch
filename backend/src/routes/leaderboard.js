const express = require('express');
const router = express.Router();
const db = require('../db/init');
const { getHoldTier } = require('../services/holdingTiers');
const { getRankForPoints } = require('../services/points');


router.get('/', async (req, res) => {
  try {
    const period = req.query.period || 'today';
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const today = new Date().toISOString().split('T')[0];
    let rows;
    if (period === 'today') {
      const result = await db.query(`
        SELECT r.wallet, r.ranch_name, r.rank_level, r.current_streak, r.lifetime_pts,
               COALESCE(dp.total_pts, 0) as points,
               COALESCE(ts.balance, 0) as token_balance
        FROM ranchers r
        LEFT JOIN daily_points dp ON dp.rancher_id = r.id AND dp.day_date = $1
        LEFT JOIN token_snapshots ts ON ts.rancher_id = r.id AND ts.day_date = $1
        WHERE dp.total_pts > 0
          ORDER BY dp.total_pts DESC
        LIMIT $2
      `, [today, limit]);
      rows = result.rows;
    } else if (period === 'week') {
      const now2 = new Date();
      const day2 = now2.getDay();
      const mondayOffset = day2 === 0 ? -6 : 1 - day2;
      const monday = new Date(now2);
      monday.setDate(now2.getDate() + mondayOffset);
      const weekStart = monday.toISOString().split('T')[0];
      const result = await db.query(`
        SELECT r.wallet, r.ranch_name, r.rank_level, r.current_streak, r.lifetime_pts,
               COALESCE(SUM(dp.total_pts), 0) as points,
               COALESCE(ts.balance, 0) as token_balance
        FROM ranchers r
        LEFT JOIN daily_points dp ON dp.rancher_id = r.id AND dp.day_date >= $1 AND dp.day_date <= $2
        LEFT JOIN token_snapshots ts ON ts.rancher_id = r.id AND ts.day_date = $2
        GROUP BY r.id, r.wallet, r.ranch_name, r.rank_level, r.current_streak, r.lifetime_pts, ts.balance
        HAVING COALESCE(SUM(dp.total_pts), 0) > 0
        ORDER BY points DESC
        LIMIT $3
      `, [weekStart, today, limit]);
      rows = result.rows;
    } else {
      const result = await db.query(`
        SELECT r.wallet, r.ranch_name, r.rank_level, r.current_streak, r.lifetime_pts,
               r.lifetime_pts as points,
               COALESCE(ts.balance, 0) as token_balance
        FROM ranchers r
        LEFT JOIN token_snapshots ts ON ts.rancher_id = r.id AND ts.day_date = $1
        WHERE r.lifetime_pts > 0
          ORDER BY r.lifetime_pts DESC
        LIMIT $2
      `, [today, limit]);
      rows = result.rows;
    }
    const leaderboard = rows.map(r => {
      const rank = getRankForPoints(r.lifetime_pts || 0);
      const holdTier = getHoldTier(parseFloat(r.token_balance) || 0);
      return {
        wallet: r.wallet,
        ranch_name: r.ranch_name,
        rank_level: r.rank_level,
        rank_name: rank.name,
        rank_mult: rank.mult,
        current_streak: r.current_streak,
        points: parseInt(r.points),
        token_balance: parseFloat(r.token_balance) || 0,
        hold_tier: holdTier.name,
        hold_mult: holdTier.mult,
        eligible: parseFloat(r.token_balance) > 0,
      };
    });
    res.json({ period, leaderboard });
  } catch (err) {
    console.error('[LEADERBOARD] Error:', err.message);
    res.status(500).json({ error: 'Failed to fetch leaderboard' });
  }
});
module.exports = router;
