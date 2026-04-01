const express = require('express');
const router = express.Router();
const db = require('../db/init');
const { calculateDistribution, getEffectivePoints } = require('../services/rewardCalc');
const ADMIN_KEY = process.env.ADMIN_SECRET || 'solranch-admin-2026';

// GET /api/rewards/burns — MUST be before /:wallet
router.get('/burns', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT burn_date, amount_ranch, burn_pct, tx_sig
      FROM burn_log ORDER BY burn_date DESC LIMIT 30
    `);
    const totalBurned = await db.query(
      "SELECT COALESCE(SUM(amount_ranch), 0) as total FROM burn_log"
    );
    res.json({
      burns: result.rows,
      totalBurned: parseFloat(totalBurned.rows[0].total),
    });
  } catch (err) {
    console.error('[BURNS] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/rewards/pool
router.get('/pool', async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const now2 = new Date();
    const dow = now2.getDay();
    const mOff = dow === 0 ? -6 : 1 - dow;
    const mon = new Date(now2);
    mon.setDate(now2.getDate() + mOff);
    const wkStart = mon.toISOString().split('T')[0];
    const stats = await db.query(
      `SELECT COUNT(DISTINCT dp.rancher_id) as active, COALESCE(SUM(dp.total_pts), 0) as total_pts
       FROM daily_points dp WHERE dp.day_date >= $1 AND dp.day_date <= $2`,
      [wkStart, today]
    );
    const pool = await db.query(
      "SELECT * FROM reward_pools ORDER BY created_at DESC LIMIT 1"
    );
    const totalDist = await db.query(
      "SELECT COALESCE(SUM(reward_usdc), 0) as total FROM reward_payouts"
    );
    const totalBurned = await db.query(
      "SELECT COALESCE(SUM(amount_ranch), 0) as total FROM burn_log"
    );
    const weeklyPoolSol = parseFloat(process.env.WEEKLY_REWARD_AMOUNT || '0');
    res.json({
      today_active_ranchers: parseInt(stats.rows[0].active),
      today_total_points: parseInt(stats.rows[0].total_pts),
      latest_pool: pool.rows[0] || null,
      total_distributed_usdc: parseFloat(totalDist.rows[0].total),
      total_burned_ranch: parseFloat(totalBurned.rows[0].total),
      weekly_pool_usdc: weeklyPoolSol,
    });
  } catch (err) {
    console.error('[REWARDS] Pool error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/rewards/:wallet
router.get('/:wallet', async (req, res) => {
  try {
    const { wallet } = req.params;
    const today = new Date().toISOString().slice(0, 10);
    // Calculate week range (Mon-Sun)
    const now = new Date();
    const dayOfWeek = now.getDay();
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(now);
    monday.setDate(now.getDate() + mondayOffset);
    const weekStart = monday.toISOString().split('T')[0];

    // Get this wallet's weekly points
    const rancher = await db.query('SELECT id FROM ranchers WHERE wallet = $1', [wallet]);
    let weeklyPts = 0;
    if (rancher.rows.length > 0) {
      const wp = await db.query(
        'SELECT COALESCE(SUM(total_pts), 0) as pts FROM daily_points WHERE rancher_id = $1 AND day_date >= $2 AND day_date <= $3',
        [rancher.rows[0].id, weekStart, today]
      );
      weeklyPts = parseInt(wp.rows[0].pts) || 0;
    }

    // Get total weekly points across all ranchers
    const allWeekly = await db.query(
      'SELECT COALESCE(SUM(dp.total_pts), 0) as total FROM daily_points dp WHERE dp.day_date >= $1 AND dp.day_date <= $2 AND dp.total_pts > 0',
      [weekStart, today]
    );
    const totalWeeklyPts = parseInt(allWeekly.rows[0].total) || 0;
    const weeklySharePct = totalWeeklyPts > 0 ? weeklyPts / totalWeeklyPts : 0;

    // Get effective points for multiplier display
    const ep = await getEffectivePoints(wallet, today);
    const payouts = await db.query(
      "SELECT *, COALESCE(week_date, day_date) as payout_date FROM reward_payouts WHERE wallet = $1 ORDER BY COALESCE(week_date, day_date) DESC LIMIT 30",
      [wallet]
    );
    const totalEarned = await db.query(
      "SELECT COALESCE(SUM(reward_usdc), 0) as total FROM reward_payouts WHERE wallet = $1",
      [wallet]
    );
    res.json({
      today: {
        rawPts: weeklyPts,
        effectivePts: Math.round(weeklyPts * (ep.rankMult || 1) * (ep.holdMult || 1) * (ep.streakMult || 1)),
        rankMult: ep.rankMult,
        holdMult: ep.holdMult,
        streakMult: ep.streakMult,
        sharePct: weeklySharePct,
        totalEffective: totalWeeklyPts,
      },
      totalEarnedUsdc: parseFloat(totalEarned.rows[0].total),
      payouts: payouts.rows,
    });
  } catch (err) {
    console.error('[REWARDS] Wallet error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/rewards/admin/distribute
router.post('/admin/distribute', async (req, res) => {
  try {
    const { adminKey, date, poolUsdc, minBalance } = req.body;
    if (adminKey !== ADMIN_KEY) return res.status(403).json({ error: 'Unauthorized' });
    if (!date || !poolUsdc) return res.status(400).json({ error: 'date and poolUsdc required' });
    const amount = parseFloat(poolUsdc);
    if (amount <= 0) return res.status(400).json({ error: 'Pool must be positive' });
    await db.query(
      "INSERT INTO reward_pools (day_date, pool_usdc, created_at) VALUES ($1, $2, NOW()) ON CONFLICT (day_date) DO UPDATE SET pool_usdc = $2",
      [date, amount]
    );
    const result = await calculateDistribution(date, amount, parseFloat(minBalance) || 0);
    for (const d of result.distributions) {
      await db.query(
        `INSERT INTO reward_payouts (wallet, day_date, raw_pts, effective_pts, share_pct, reward_usdc, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())
         ON CONFLICT (wallet, day_date) DO UPDATE SET
           raw_pts = $3, effective_pts = $4, share_pct = $5, reward_usdc = $6`,
        [d.wallet, date, d.rawPts, d.effectivePts, d.sharePct, d.rewardUsdc]
      );
    }
    res.json({
      success: true, date, poolUsdc: amount,
      activeRanchers: result.activeCount,
      totalEffective: result.totalEffective,
      distributions: result.distributions.map(d => ({
        wallet: d.wallet, rawPts: d.rawPts,
        effectivePts: Math.round(d.effectivePts),
        sharePct: (d.sharePct * 100).toFixed(2) + '%',
        rewardUsdc: d.rewardUsdc.toFixed(4),
      })),
    });
  } catch (err) {
    console.error('[REWARDS] Distribute error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/admin/preview', async (req, res) => {
  try {
    const { adminKey, date, poolUsdc, minBalance } = req.query;
    if (adminKey !== ADMIN_KEY) return res.status(403).json({ error: 'Unauthorized' });
    const result = await calculateDistribution(date, parseFloat(poolUsdc), parseFloat(minBalance) || 0);
    res.json({
      date, poolUsdc: parseFloat(poolUsdc),
      activeRanchers: result.activeCount,
      totalEffective: result.totalEffective,
      preview: result.distributions.map(d => ({
        wallet: d.wallet, effectivePts: Math.round(d.effectivePts),
        sharePct: (d.sharePct * 100).toFixed(2) + '%',
        rewardUsdc: d.rewardUsdc.toFixed(4),
      })),
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
