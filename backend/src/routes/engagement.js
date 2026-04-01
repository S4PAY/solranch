const express = require('express');
const router = express.Router();
const db = require('../db/init');
const { getRancher, getRankForPoints, getStreakMult } = require('../services/points');

// ═══════════════════════════════════════════════
// AFTERNOON CHECK-IN
// ═══════════════════════════════════════════════

router.post('/evening-feed', async (req, res) => {
  try {
    const { wallet } = req.body;
    if (!wallet) return res.status(400).json({ error: 'Wallet required' });

    const rancher = await getRancher(wallet);
    if (!rancher) return res.status(404).json({ error: 'Rancher not found' });

    const today = new Date().toISOString().split('T')[0];

    // Check if already did evening feed today
    const existing = await db.query(
      'SELECT evening_pts FROM daily_points WHERE rancher_id = $1 AND day_date = $2',
      [rancher.id, today]
    );
    if (existing.rows.length > 0 && parseInt(existing.rows[0].evening_pts) > 0) {
      return res.json({ alreadyDone: true });
    }

    // Check if morning checkin was done and at least 12hrs ago
    if (!rancher.last_checkin) {
      return res.status(400).json({ error: 'Do your morning feed first, partner' });
    }

    const lastCheckin = new Date(rancher.last_checkin);
    const now = new Date();
    const hoursSince = (now - lastCheckin) / (1000 * 60 * 60);

    if (hoursSince < 12) {
      const hoursLeft = Math.ceil(12 - hoursSince);
      return res.status(400).json({
        error: 'Evening feed unlocks 12 hours after morning feed. ' + hoursLeft + 'h remaining',
        hoursLeft
      });
    }

    // Award points
    const basePts = 15;
    const rank = getRankForPoints(rancher.lifetime_pts);
    const streakMult = getStreakMult(rancher.current_streak);
    const totalPts = Math.floor(basePts * streakMult * rank.mult);

    await db.query(`
      INSERT INTO daily_points (rancher_id, day_date, evening_pts, streak_mult, rank_mult, total_pts)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (rancher_id, day_date)
      DO UPDATE SET evening_pts = daily_points.evening_pts + $3, total_pts = daily_points.total_pts + $6
    `, [rancher.id, today, totalPts, streakMult, rank.mult, totalPts]);

    await db.query(
      'UPDATE ranchers SET lifetime_pts = lifetime_pts + $1, updated_at = NOW() WHERE id = $2',
      [totalPts, rancher.id]
    );

    res.json({ pointsEarned: totalPts, message: 'Evening feed done! +' + totalPts + ' pts' });
  } catch (err) {
    console.error('[EVENING] Error:', err.message);
    res.status(500).json({ error: 'Failed' });
  }
});

// GET evening feed status
router.get('/evening-feed/:wallet', async (req, res) => {
  try {
    const rancher = await getRancher(req.params.wallet);
    if (!rancher) return res.json({ available: false, done: false });

    const today = new Date().toISOString().split('T')[0];

    const existing = await db.query(
      'SELECT evening_pts FROM daily_points WHERE rancher_id = $1 AND day_date = $2',
      [rancher.id, today]
    );
    const done = existing.rows.length > 0 && parseInt(existing.rows[0].evening_pts) > 0;

    let available = false;
    let hoursLeft = 12;
    if (rancher.last_checkin) {
      const hoursSince = (new Date() - new Date(rancher.last_checkin)) / (1000 * 60 * 60);
      available = hoursSince >= 12;
      hoursLeft = available ? 0 : Math.ceil(12 - hoursSince);
    }

    res.json({ available: available && !done, done, hoursLeft });
  } catch (err) {
    res.json({ available: false, done: false, hoursLeft: 12 });
  }
});

// ═══════════════════════════════════════════════
// DAILY BOUNTY BOARD
// ═══════════════════════════════════════════════

const BOUNTY_POOL = [
  { type: 'raid_2', description: 'Raid 2 ranches today', reward_pts: 100, check: 'raids' },
  { type: 'all_daily', description: 'Complete all 4 daily chores', reward_pts: 75, check: 'daily_tasks' },
  { type: 'social_share', description: 'Share Sol Ranch on X today', reward_pts: 60, check: 'social' },
  { type: 'streak_keeper', description: 'Keep your streak alive today', reward_pts: 50, check: 'checkin' },
  { type: 'water_patrol', description: 'Water cattle AND patrol fences today', reward_pts: 65, check: 'water_patrol' },
  { type: 'evening_grinder', description: 'Do both morning AND evening feed', reward_pts: 80, check: 'morning_evening' },
  { type: 'point_hunter', description: 'Earn 100+ points today', reward_pts: 75, check: 'points_100' },
];

// Ensure today's bounty exists
async function ensureTodayBounty() {
  const today = new Date().toISOString().split('T')[0];
  const existing = await db.query('SELECT * FROM daily_bounties WHERE day_date = $1', [today]);
  if (existing.rows.length > 0) return existing.rows[0];

  // Pick a bounty based on day of year for consistency
  const dayOfYear = Math.floor((new Date() - new Date(new Date().getFullYear(), 0, 0)) / (1000 * 60 * 60 * 24));
  const bounty = BOUNTY_POOL[dayOfYear % BOUNTY_POOL.length];

  const result = await db.query(
    'INSERT INTO daily_bounties (day_date, bounty_type, description, reward_pts) VALUES ($1, $2, $3, $4) RETURNING *',
    [today, bounty.type, bounty.description, bounty.reward_pts]
  );
  return result.rows[0];
}

// GET today's bounty
router.get('/bounty/today', async (req, res) => {
  try {
    const bounty = await ensureTodayBounty();
    const wallet = req.query.wallet;

    let claimed = false;
    let totalClaims = 0;

    const claimsCount = await db.query(
      'SELECT COUNT(*) as cnt FROM bounty_claims WHERE bounty_id = $1', [bounty.id]
    );
    totalClaims = parseInt(claimsCount.rows[0].cnt);

    if (wallet) {
      const rancher = await getRancher(wallet);
      if (rancher) {
        const claim = await db.query(
          'SELECT id FROM bounty_claims WHERE bounty_id = $1 AND rancher_id = $2',
          [bounty.id, rancher.id]
        );
        claimed = claim.rows.length > 0;
      }
    }

    res.json({
      id: bounty.id,
      type: bounty.bounty_type,
      description: bounty.description,
      reward_pts: bounty.reward_pts,
      claimed,
      totalClaims,
    });
  } catch (err) {
    console.error('[BOUNTY] Error:', err.message);
    res.status(500).json({ error: 'Failed' });
  }
});

// POST claim bounty
router.post('/bounty/claim', async (req, res) => {
  try {
    const { wallet } = req.body;
    if (!wallet) return res.status(400).json({ error: 'Wallet required' });

    const rancher = await getRancher(wallet);
    if (!rancher) return res.status(404).json({ error: 'Rancher not found' });

    const bounty = await ensureTodayBounty();
    const today = new Date().toISOString().split('T')[0];

    // Check if already claimed
    const existing = await db.query(
      'SELECT id FROM bounty_claims WHERE bounty_id = $1 AND rancher_id = $2',
      [bounty.id, rancher.id]
    );
    if (existing.rows.length > 0) {
      return res.json({ alreadyDone: true });
    }

    // Verify the bounty condition is met
    const dp = await db.query(
      'SELECT * FROM daily_points WHERE rancher_id = $1 AND day_date = CURRENT_DATE',
      [rancher.id]
    );
    const pts = dp.rows[0] || {};
    console.log('[BOUNTY] Check for ' + wallet.slice(0,8) + ': total_pts=' + (pts.total_pts || 0) + ' type=' + bounty.bounty_type);

    let completed = false;
    switch (bounty.bounty_type) {
      case 'raid_2': {
        const raids = await db.query(
          'SELECT COUNT(*) as cnt FROM ranch_raids WHERE attacker_id = $1 AND day_date = $2',
          [rancher.id, today]
        );
        completed = parseInt(raids.rows[0].cnt) >= 2;
        break;
      }
      case 'all_daily':
        completed = (pts.checkin_pts > 0) && (pts.social_pts > 0) && (pts.hold_pts > 0) && (pts.rodeo_pts > 0);
        break;
      case 'social_share':
        completed = (pts.social_pts > 0);
        break;
      case 'streak_keeper':
        completed = (pts.checkin_pts > 0);
        break;
      case 'water_patrol':
        completed = (pts.hold_pts > 0) && (pts.rodeo_pts > 0);
        break;
      case 'evening_grinder':
        completed = (pts.checkin_pts > 0) && (pts.evening_pts > 0);
        break;
      case 'point_hunter':
        completed = (parseInt(pts.total_pts) || 0) >= 100;
        break;
      default:
        completed = false;
    }

    if (!completed) {
      return res.status(400).json({ error: 'Bounty not completed yet. ' + bounty.description });
    }

    // Award bounty
    const rank = getRankForPoints(rancher.lifetime_pts);
    const streakMult = getStreakMult(rancher.current_streak);
    const totalPts = Math.floor(bounty.reward_pts * streakMult * rank.mult);

    await db.query(
      'INSERT INTO bounty_claims (bounty_id, rancher_id, day_date) VALUES ($1, $2, $3)',
      [bounty.id, rancher.id, today]
    );

    await db.query(`
      INSERT INTO daily_points (rancher_id, day_date, rodeo_pts, streak_mult, rank_mult, total_pts)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (rancher_id, day_date)
      DO UPDATE SET rodeo_pts = daily_points.rodeo_pts + $3, total_pts = daily_points.total_pts + $6
    `, [rancher.id, today, totalPts, streakMult, rank.mult, totalPts]);

    await db.query(
      'UPDATE ranchers SET lifetime_pts = lifetime_pts + $1, updated_at = NOW() WHERE id = $2',
      [totalPts, rancher.id]
    );

    console.log('[BOUNTY] ' + wallet.slice(0,8) + '... claimed ' + bounty.bounty_type + ' +' + totalPts + ' pts');

    res.json({ pointsEarned: totalPts, message: 'Bounty claimed! +' + totalPts + ' pts' });
  } catch (err) {
    if (err.code === '23505') return res.json({ alreadyDone: true });
    console.error('[BOUNTY] Claim error:', err.message);
    res.status(500).json({ error: 'Failed' });
  }
});

// ═══════════════════════════════════════════════
// RANCH VISITORS
// ═══════════════════════════════════════════════

// POST log a visit
router.post('/visit', async (req, res) => {
  try {
    const { wallet, targetWallet } = req.body;
    if (!wallet || !targetWallet) return res.status(400).json({ error: 'Both wallets required' });
    if (wallet === targetWallet) return res.json({ ok: true }); // don't log self-visits

    const visitor = await getRancher(wallet);
    const ranch = await getRancher(targetWallet);
    if (!visitor || !ranch) return res.json({ ok: true });

    // Rate limit: max 1 visit log per visitor per ranch per hour
    const recent = await db.query(
      "SELECT id FROM ranch_visits WHERE visitor_id = $1 AND ranch_id = $2 AND visited_at > NOW() - INTERVAL '1 hour'",
      [visitor.id, ranch.id]
    );
    if (recent.rows.length > 0) return res.json({ ok: true });

    await db.query(
      'INSERT INTO ranch_visits (visitor_id, ranch_id) VALUES ($1, $2)',
      [visitor.id, ranch.id]
    );

    res.json({ ok: true });
  } catch (err) {
    res.json({ ok: true }); // never fail on visit logging
  }
});

// GET visitors for a ranch
router.get('/visitors/:wallet', async (req, res) => {
  try {
    const rancher = await getRancher(req.params.wallet);
    if (!rancher) return res.json({ visitors: [], totalVisits: 0 });

    const recent = await db.query(`
      SELECT DISTINCT ON (r.id) r.ranch_name, r.wallet, rv.visited_at
      FROM ranch_visits rv
      JOIN ranchers r ON r.id = rv.visitor_id
      WHERE rv.ranch_id = $1
      ORDER BY r.id, rv.visited_at DESC
    `, [rancher.id]);

    const total = await db.query(
      'SELECT COUNT(*) as cnt FROM ranch_visits WHERE ranch_id = $1', [rancher.id]
    );

    // Sort by most recent visit
    const visitors = recent.rows
      .sort((a, b) => new Date(b.visited_at) - new Date(a.visited_at))
      .slice(0, 20)
      .map(v => ({
        ranch_name: v.ranch_name,
        wallet: v.wallet,
        visited_at: v.visited_at,
      }));

    res.json({ visitors, totalVisits: parseInt(total.rows[0].cnt) });
  } catch (err) {
    console.error('[VISITORS] Error:', err.message);
    res.json({ visitors: [], totalVisits: 0 });
  }
});

module.exports = router;
