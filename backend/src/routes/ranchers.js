const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../db/init');
const { getRancher, processReferral, getRankForPoints } = require('../services/points');

// POST /api/ranchers/register
router.post('/register', async (req, res) => {
  try {
    const { wallet, ranchName, referralCode } = req.body;
    if (!wallet) return res.status(400).json({ error: 'Wallet address required' });

    const existing = await getRancher(wallet);
    if (existing) return res.json({ rancher: existing, isNew: false });

    const refCode = crypto.randomBytes(6).toString('hex');
    let referredBy = null;
    if (referralCode) {
      const referrer = await db.query('SELECT id FROM ranchers WHERE referral_code = $1', [referralCode]);
      if (referrer.rows.length > 0) referredBy = referrer.rows[0].id;
    }

    const result = await db.query(
      `INSERT INTO ranchers (wallet, ranch_name, referral_code, referred_by) VALUES ($1, $2, $3, $4) RETURNING *`,
      [wallet, ranchName || 'Unnamed Ranch', refCode, referredBy]
    );

    const newRancher = result.rows[0];
    // Referral points awarded later when referred user holds 50k+ tokens

    res.json({ rancher: newRancher, isNew: true });
  } catch (err) {
    console.error('[RANCHERS] Register error:', err.message);
    res.status(500).json({ error: 'Failed to register rancher' });
  }
});

// GET /api/ranchers/:wallet
router.get('/:wallet', async (req, res) => {
  try {
    const rancher = await getRancher(req.params.wallet);
    if (!rancher) return res.status(404).json({ error: 'Rancher not found' });
    const rank = getRankForPoints(rancher.lifetime_pts);
    res.json({ ...rancher, rank_name: rank.name, rank_mult: rank.mult });
  } catch (err) {
    console.error('[RANCHERS] Fetch error:', err.message);
    res.status(500).json({ error: 'Failed to fetch rancher' });
  }
});

// GET /api/ranchers/:wallet/stats
router.get('/:wallet/stats', async (req, res) => {
  try {
    const rancher = await getRancher(req.params.wallet);
    if (!rancher) return res.status(404).json({ error: 'Rancher not found' });

    const today = new Date().toISOString().split('T')[0];
    const todayPoints = await db.query(
      'SELECT * FROM daily_points WHERE rancher_id = $1 AND day_date = $2', [rancher.id, today]
    );

    const totalEarned = await db.query(
      'SELECT COALESCE(SUM(reward_usdc), 0) as total FROM reward_payouts WHERE wallet = $1', [rancher.wallet]
    );

    const referralCount = await db.query(
      'SELECT COUNT(*) as count FROM referrals WHERE referrer_id = $1', [rancher.id]
    );

    res.json({
      wallet: rancher.wallet,
      ranch_name: rancher.ranch_name,
      lifetime_pts: rancher.lifetime_pts,
      current_streak: rancher.current_streak,
      longest_streak: rancher.longest_streak,
      rank_level: rancher.rank_level,
      today_points: todayPoints.rows[0] || null,
      total_earned_usdc: parseFloat(totalEarned.rows[0].total),
      referral_count: parseInt(referralCount.rows[0].count),
      referral_code: rancher.referral_code,
    });
  } catch (err) {
    console.error('[RANCHERS] Stats error:', err.message);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// PATCH /api/ranchers/:wallet/rename
router.patch('/:wallet/rename', async (req, res) => {
  try {
    const { ranchName } = req.body;
    if (!ranchName || ranchName.length < 2 || ranchName.length > 24)
      return res.status(400).json({ error: 'Ranch name must be 2-24 characters' });
    const result = await db.query(
      'UPDATE ranchers SET ranch_name = $1, updated_at = NOW() WHERE wallet = $2 RETURNING *',
      [ranchName.trim(), req.params.wallet]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Rancher not found' });
    res.json({ rancher: result.rows[0] });
  } catch (err) {
    console.error('[RANCHERS] Rename error:', err.message);
    res.status(500).json({ error: 'Failed to rename ranch' });
  }
});

module.exports = router;
