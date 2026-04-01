const db = require('../db/init');
const { getHoldTier } = require('./holdingTiers');

const RANK_MULT = { 1: 1, 2: 1.25, 3: 1.5, 4: 2, 5: 3 };

function streakMult(days) {
  if (days >= 30) return 3;
  if (days >= 7) return 2;
  return 1;
}

async function getEffectivePoints(wallet, date) {
  const rancher = await db.query(
    'SELECT id, rank_level, current_streak FROM ranchers WHERE wallet = $1', [wallet]
  );
  if (rancher.rows.length === 0) return { rawPts: 0, effectivePts: 0, rankMult: 1, holdMult: 1, streakMult: 1 };
  const r = rancher.rows[0];

  const pts = await db.query(
    'SELECT COALESCE(total_pts, 0) as total_pts FROM daily_points WHERE rancher_id = $1 AND day_date = $2',
    [r.id, date]
  );
  const rawPts = pts.rows.length > 0 ? parseInt(pts.rows[0].total_pts) : 0;

  const rMult = RANK_MULT[r.rank_level || 1] || 1;
  const sMult = streakMult(r.current_streak || 0);

  const snap = await db.query(
    'SELECT balance FROM token_snapshots WHERE rancher_id = $1 ORDER BY day_date DESC LIMIT 1',
    [r.id]
  );
  const balance = snap.rows.length > 0 ? parseFloat(snap.rows[0].balance) : 0;
  const hMult = getHoldTier(balance).mult;

  const effectivePts = rawPts * rMult * hMult * sMult;
  return { rawPts, effectivePts, rankMult: rMult, holdMult: hMult, streakMult: sMult };
}

async function calculateDistribution(date, poolAmount, minBalance = 0) {
  const active = await db.query(
    `SELECT r.wallet FROM ranchers r
     INNER JOIN daily_points dp ON dp.rancher_id = r.id
     WHERE dp.day_date = $1 AND dp.total_pts > 0`, [date]
  );
  if (active.rows.length === 0) return { distributions: [], totalEffective: 0, poolAmount, activeCount: 0 };

  const results = [];
  let totalEffective = 0;
  for (const row of active.rows) {
    // Check token balance if minBalance set
    if (minBalance > 0) {
      const rancher = await db.query('SELECT id FROM ranchers WHERE wallet = $1', [row.wallet]);
      if (rancher.rows.length > 0) {
        const snap = await db.query('SELECT balance FROM token_snapshots WHERE rancher_id = $1 ORDER BY day_date DESC LIMIT 1', [rancher.rows[0].id]);
        const bal = snap.rows.length > 0 ? parseFloat(snap.rows[0].balance) : 0;
        if (bal < minBalance) continue;
      } else { continue; }
    }
    const ep = await getEffectivePoints(row.wallet, date);
    if (ep.effectivePts > 0) { results.push({ wallet: row.wallet, ...ep }); totalEffective += ep.effectivePts; }
  }

  const distributions = results.map(r => ({
    wallet: r.wallet, rawPts: r.rawPts, effectivePts: r.effectivePts,
    rankMult: r.rankMult, holdMult: r.holdMult, streakMult: r.streakMult,
    sharePct: totalEffective > 0 ? r.effectivePts / totalEffective : 0,
    rewardUsdc: totalEffective > 0 ? (r.effectivePts / totalEffective) * poolAmount : 0,
  }));

  return { distributions, totalEffective, poolAmount, activeCount: results.length };
}

module.exports = { getEffectivePoints, calculateDistribution, streakMult, RANK_MULT };
