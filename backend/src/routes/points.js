const express = require('express');
const router = express.Router();
const db = require('../db/init');
const { processCheckin, processSocialTask, getRancher, getRankForPoints, getStreakMult } = require('../services/points');

// POST /api/points/checkin
router.post('/checkin', async (req, res) => {
  try {
    const { wallet } = req.body;
    if (!wallet) return res.status(400).json({ error: 'Wallet required' });
    const result = await processCheckin(wallet);
    if (result.alreadyDone) return res.json({ message: 'Already checked in today', alreadyDone: true });
    res.json({ message: 'Cattle fed successfully', ...result });
  } catch (err) {
    console.error('[POINTS] Checkin error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/points/social
router.post('/social', async (req, res) => {
  try {
    const { wallet, postUrl } = req.body;
    if (!wallet || !postUrl) return res.status(400).json({ error: 'Wallet and post URL required' });
    const result = await processSocialTask(wallet, postUrl);
    if (result.alreadyDone) return res.json({ message: 'Fences already repaired today', alreadyDone: true });
    res.json({ message: 'Fences repaired. Points awarded.', ...result });
  } catch (err) {
    console.error('[POINTS] Social error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Helper: process a simple daily/weekly task
async function processTask(wallet, taskField, basePts, isWeekly) {
  // Anti-abuse: strict check
  const rancher = await getRancher(wallet);
  if (!rancher) throw new Error('Rancher not found');

  const today = new Date().toISOString().split('T')[0];
  const rank = getRankForPoints(rancher.lifetime_pts);
  const streakMult = getStreakMult(rancher.current_streak);
  const totalPts = Math.floor(basePts * streakMult * rank.mult);

  if (isWeekly) {
    const now = new Date();
    const day = now.getDay();
    const diff = now.getDate() - day + (day === 0 ? -6 : 1);
    const weekStart = new Date(new Date().setDate(diff)).toISOString().slice(0, 10);
    const check = await db.query(
      'SELECT ' + taskField + ' FROM daily_points WHERE rancher_id = $1 AND day_date >= $2 AND ' + taskField + ' > 0',
      [rancher.id, weekStart]
    );
    if (check.rows.length > 0) return { alreadyDone: true };
  } else {
    const check = await db.query(
      'SELECT ' + taskField + ' FROM daily_points WHERE rancher_id = $1 AND day_date = $2 AND ' + taskField + ' > 0',
      [rancher.id, today]
    );
    if (check.rows.length > 0) return { alreadyDone: true };
  }

  await db.query(`
    INSERT INTO daily_points (rancher_id, day_date, ${taskField}, streak_mult, rank_mult, total_pts)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (rancher_id, day_date)
    DO UPDATE SET
      ${taskField} = daily_points.${taskField} + $3,
      total_pts = daily_points.total_pts + $6
  `, [rancher.id, today, totalPts, streakMult, rank.mult, totalPts]);

  await db.query(
    'UPDATE ranchers SET lifetime_pts = lifetime_pts + $1, rank_level = $2, updated_at = NOW() WHERE id = $3',
    [totalPts, rank.level, rancher.id]
  );

  return { pointsEarned: totalPts };
}

// POST /api/points/water (daily, base 15)
router.post('/water', async (req, res) => {
  try {
    const { wallet } = req.body;
    if (!wallet) return res.status(400).json({ error: 'Wallet required' });
    const result = await processTask(wallet, 'hold_pts', 15, false);
    if (result.alreadyDone) return res.json({ alreadyDone: true });
    res.json(result);
  } catch (err) {
    console.error('[POINTS] Water error:', err.message);
    res.status(500).json({ error: 'Failed' });
  }
});

// POST /api/points/patrol (daily, base 20)
router.post('/patrol', async (req, res) => {
  try {
    const { wallet } = req.body;
    if (!wallet) return res.status(400).json({ error: 'Wallet required' });
    const result = await processTask(wallet, 'rodeo_pts', 20, false);
    if (result.alreadyDone) return res.json({ alreadyDone: true });
    res.json(result);
  } catch (err) {
    console.error('[POINTS] Patrol error:', err.message);
    res.status(500).json({ error: 'Failed' });
  }
});

// POST /api/points/brand (weekly, base 75)
router.post('/brand', async (req, res) => {
  try {
    const { wallet } = req.body;
    if (!wallet) return res.status(400).json({ error: 'Wallet required' });
    const result = await processTask(wallet, 'buy_pts', 75, true);
    if (result.alreadyDone) return res.json({ alreadyDone: true });
    res.json(result);
  } catch (err) {
    console.error('[POINTS] Brand error:', err.message);
    res.status(500).json({ error: 'Failed' });
  }
});

// POST /api/points/harvest (weekly, base 50)
router.post('/harvest', async (req, res) => {
  try {
    const { wallet } = req.body;
    if (!wallet) return res.status(400).json({ error: 'Wallet required' });
    const result = await processTask(wallet, 'referral_pts', 50, true);
    if (result.alreadyDone) return res.json({ alreadyDone: true });
    res.json(result);
  } catch (err) {
    console.error('[POINTS] Harvest error:', err.message);
    res.status(500).json({ error: 'Failed' });
  }
});

// GET /api/points/:wallet/tasks
router.get('/:wallet/tasks', async (req, res) => {
  try {
    const { wallet } = req.params;
    const rancher = await getRancher(wallet);
    if (!rancher) return res.json({ daily: {}, weekly: {}, challenge: { feedDaysThisWeek: 0, target: 7, reward: 500 } });

    const today = new Date().toISOString().split('T')[0];
    const now = new Date();
    const day = now.getDay();
    const diff = now.getDate() - day + (day === 0 ? -6 : 1);
    const weekStart = new Date(new Date().setDate(diff)).toISOString().slice(0, 10);

    // Today's points
    const todayRow = await db.query(
      'SELECT * FROM daily_points WHERE rancher_id = $1 AND day_date = $2',
      [rancher.id, today]
    );
    const tp = todayRow.rows[0] || {};

    // Weekly checks
    const weeklyRows = await db.query(
      'SELECT buy_pts, referral_pts FROM daily_points WHERE rancher_id = $1 AND day_date >= $2',
      [rancher.id, weekStart]
    );
    const weeklyBrand = weeklyRows.rows.some(r => r.buy_pts > 0);
    const weeklyHarvest = weeklyRows.rows.some(r => r.referral_pts > 0);

    // Feed days this week (for weekly challenge)
    const feedDays = await db.query(
      'SELECT COUNT(*) as cnt FROM daily_points WHERE rancher_id = $1 AND day_date >= $2 AND checkin_pts > 0',
      [rancher.id, weekStart]
    );

    // Social task check
    const socialCheck = await db.query(
      'SELECT id FROM social_tasks WHERE rancher_id = $1 AND day_date = $2',
      [rancher.id, today]
    );

    res.json({
      daily: {
        checkin: (tp.checkin_pts || 0) > 0,
        social: socialCheck.rows.length > 0,
        water: (tp.hold_pts || 0) > 0,
        patrol: (tp.rodeo_pts || 0) > 0,
      },
      weekly: {
        brand: weeklyBrand,
        harvest: weeklyHarvest,
      },
      challenge: {
        feedDaysThisWeek: parseInt(feedDays.rows[0].cnt),
        target: 7,
        reward: 500,
      }
    });
  } catch (err) {
    console.error('[POINTS] Tasks status error:', err.message);
    res.status(500).json({ error: 'Failed' });
  }
});

module.exports = router;
