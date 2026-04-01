const { getHoldTier } = require('./holdingTiers');
const db = require('../db/init');

// ---------------------
// RANK MULTIPLIERS
// ---------------------
const RANKS = [
  { level: 1, name: 'Homestead',    minPts: 0,      mult: 1.00 },
  { level: 2, name: 'Smallhold',    minPts: 1000,   mult: 1.25 },
  { level: 3, name: 'Spread',       minPts: 5000,   mult: 1.50 },
  { level: 4, name: 'Estate',       minPts: 25000,  mult: 2.00 },
  { level: 5, name: 'Cattle Baron', minPts: 100000, mult: 3.00 },
];

// ---------------------
// HOLD TIERS
// ---------------------
const HOLD_TIERS = [
  { minTokens: 10000000, pts: 150 },
  { minTokens: 1000000,  pts: 75 },
  { minTokens: 100000,   pts: 30 },
  { minTokens: 10000,    pts: 10 },
];

// ---------------------
// STREAK MULTIPLIERS
// ---------------------
function getStreakMult(streak) {
  if (streak >= 30) return 3.0;
  if (streak >= 7) return 2.0;
  return 1.0;
}

// ---------------------
// GET RANK FROM LIFETIME PTS
// ---------------------
function getRankForPoints(lifetimePts) {
  let rank = RANKS[0];
  for (const r of RANKS) {
    if (lifetimePts >= r.minPts) rank = r;
  }
  return rank;
}

// ---------------------
// GET HOLD POINTS FROM BALANCE
// ---------------------
function getHoldPoints(tokenBalance) {
  for (const tier of HOLD_TIERS) {
    if (tokenBalance >= tier.minTokens) return tier.pts;
  }
  return 0;
}

// ---------------------
// DAILY CHECK-IN
// ---------------------
async function processCheckin(walletAddress) {
  const rancher = await getRancher(walletAddress);
  if (!rancher) throw new Error('Rancher not found');

  const today = new Date().toISOString().split('T')[0];

  // Check if already checked in today
  const existing = await db.query(
    'SELECT id, checkin_pts FROM daily_points WHERE rancher_id = $1 AND day_date = $2',
    [rancher.id, today]
  );

  if (existing.rows.length > 0 && parseInt(existing.rows[0].checkin_pts) > 0) {
    return { alreadyDone: true };
  }

  // Update streak
  const lastCheckin = rancher.last_checkin;
  let newStreak = 1;
  if (lastCheckin) {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const lastDate = new Date(lastCheckin).toISOString().split('T')[0];
    const yesterdayDate = yesterday.toISOString().split('T')[0];
    if (lastDate === yesterdayDate) {
      newStreak = rancher.current_streak + 1;
    }
  }

  const longestStreak = Math.max(newStreak, rancher.longest_streak);
  const streakMult = getStreakMult(newStreak);
  const rank = getRankForPoints(rancher.lifetime_pts);
  const basePts = 10;
  const totalPts = Math.floor(basePts * streakMult * rank.mult);

  // Upsert daily_points row
  await db.query(`
    INSERT INTO daily_points (rancher_id, day_date, checkin_pts, streak_mult, rank_mult, total_pts)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (rancher_id, day_date)
    DO UPDATE SET
      checkin_pts = daily_points.checkin_pts + $3,
      streak_mult = $4,
      rank_mult = $5,
      total_pts = daily_points.total_pts + $6
  `, [rancher.id, today, totalPts, streakMult, rank.mult, totalPts]);
  await db.query(`
    UPDATE ranchers SET
      current_streak = $1,
      longest_streak = $2,
      last_checkin = NOW(),
      lifetime_pts = lifetime_pts + $3,
      rank_level = $4,
      updated_at = NOW()
    WHERE id = $5
  `, [newStreak, longestStreak, totalPts, rank.level, rancher.id]);

  return {
    pointsEarned: totalPts,
    streak: newStreak,
    streakMult,
    rankMult: rank.mult,
    rankName: rank.name,
  };
}

// ---------------------
// PROCESS BUY EVENT (from Helius webhook)
// ---------------------
async function processBuyEvent(walletAddress, txSig, amountSol, amountToken) {
  const rancher = await getRancher(walletAddress);
  if (!rancher) return null;

  const today = new Date().toISOString().split('T')[0];

  // Get SOL price to calculate USD value
  let solPrice = 0;
  try {
    const resp = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd');
    const json = await resp.json();
    solPrice = json.solana?.usd || 0;
  } catch (e) {
    console.log('[POINTS] CoinGecko error, using fallback price');
    solPrice = 130; // fallback
  }

  const usdValue = amountSol * solPrice;
  const basePts = Math.floor(usdValue); // 1 pt per $1

  if (basePts <= 0) return null;

  const rank = getRankForPoints(rancher.lifetime_pts);
  const streakMult = getStreakMult(rancher.current_streak);
  const totalPts = Math.floor(basePts * streakMult * rank.mult);

  // Insert buy event (ignore duplicates)
  try {
    await db.query(
      'INSERT INTO buy_events (rancher_id, tx_sig, amount_sol, amount_token, pts_awarded) VALUES ($1, $2, $3, $4, $5)',
      [rancher.id, txSig, amountSol, amountToken, totalPts]
    );
  } catch (err) {
    if (err.code === '23505') return null; // Duplicate tx
    throw err;
  }

  // Update daily_points
  await db.query(`
    INSERT INTO daily_points (rancher_id, day_date, buy_pts, streak_mult, rank_mult, total_pts)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (rancher_id, day_date)
    DO UPDATE SET
      buy_pts = daily_points.buy_pts + $3,
      total_pts = daily_points.total_pts + $6
  `, [rancher.id, today, totalPts, streakMult, rank.mult, totalPts]);

  // Update lifetime
  await db.query(
    'UPDATE ranchers SET lifetime_pts = lifetime_pts + $1, rank_level = $2, updated_at = NOW() WHERE id = $3',
    [totalPts, rank.level, rancher.id]
  );

  console.log('[POINTS] Buy: ' + walletAddress.slice(0,8) + '... spent $' + usdValue.toFixed(2) + ' = ' + totalPts + ' pts');
  return { pointsEarned: totalPts, usdValue: usdValue.toFixed(2), txSig };
}

async function processSocialTask(walletAddress, postUrl) {
  const rancher = await getRancher(walletAddress);
  if (!rancher) throw new Error('Rancher not found');

  const today = new Date().toISOString().split('T')[0];
  const rank = getRankForPoints(rancher.lifetime_pts);
  const streakMult = getStreakMult(rancher.current_streak);
  const basePts = 30;
  const totalPts = Math.floor(basePts * streakMult * rank.mult);

  try {
    await db.query(`
      INSERT INTO social_tasks (rancher_id, day_date, post_url, verified, pts_awarded)
      VALUES ($1, $2, $3, TRUE, $4)
    `, [rancher.id, today, postUrl, totalPts]);
  } catch (err) {
    if (err.code === '23505') return { alreadyDone: true };
    throw err;
  }

  await db.query(`
    INSERT INTO daily_points (rancher_id, day_date, social_pts, streak_mult, rank_mult, total_pts)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (rancher_id, day_date)
    DO UPDATE SET
      social_pts = daily_points.social_pts + $3,
      total_pts = daily_points.total_pts + $6
  `, [rancher.id, today, totalPts, streakMult, rank.mult, totalPts]);

  await db.query(
    'UPDATE ranchers SET lifetime_pts = lifetime_pts + $1, rank_level = $2, updated_at = NOW() WHERE id = $3',
    [totalPts, rank.level, rancher.id]
  );

  return { pointsEarned: totalPts };
}

// ---------------------
// PROCESS REFERRAL
// ---------------------
async function processReferral(referrerWallet, newRancherId) {
  const referrer = await getRancher(referrerWallet);
  if (!referrer) return null;

  const today = new Date().toISOString().split('T')[0];
  const rank = getRankForPoints(referrer.lifetime_pts);
  const streakMult = getStreakMult(referrer.current_streak);
  const basePts = 100;
  const totalPts = Math.floor(basePts * streakMult * rank.mult);

  try {
    await db.query(
      'INSERT INTO referrals (referrer_id, referred_id, pts_awarded) VALUES ($1, $2, $3)',
      [referrer.id, newRancherId, totalPts]
    );
  } catch (err) {
    if (err.code === '23505') return null;
    throw err;
  }

  await db.query(`
    INSERT INTO daily_points (rancher_id, day_date, referral_pts, streak_mult, rank_mult, total_pts)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (rancher_id, day_date)
    DO UPDATE SET
      referral_pts = daily_points.referral_pts + $3,
      total_pts = daily_points.total_pts + $6
  `, [referrer.id, today, totalPts, streakMult, rank.mult, totalPts]);

  await db.query(
    'UPDATE ranchers SET lifetime_pts = lifetime_pts + $1, updated_at = NOW() WHERE id = $2',
    [totalPts, referrer.id]
  );

  return { pointsEarned: totalPts };
}

// ---------------------
// HELPER
// ---------------------
async function getRancher(walletAddress) {
  const result = await db.query('SELECT * FROM ranchers WHERE wallet = $1', [walletAddress]);
  return result.rows[0] || null;
}

module.exports = {
  processCheckin,
  processBuyEvent,
  processSocialTask,
  processReferral,
  getRankForPoints,
  getHoldPoints,
  getStreakMult,
  getRancher,
  RANKS,
  HOLD_TIERS,
};
