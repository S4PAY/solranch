const { Connection, PublicKey } = require('@solana/web3.js');
const db = require('../db/init');
const { getHoldPoints, getRankForPoints, getStreakMult } = require('../services/points');
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const connection = new Connection(
  process.env.HELIUS_API_KEY
    ? `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`
    : process.env.SOLANA_RPC_URL
);

const RANCH_MINT = new PublicKey(process.env.RANCH_TOKEN_MINT || '11111111111111111111111111111111');

async function runDailySnapshot() {
  const today = new Date().toISOString().split('T')[0];
  console.log(`[SNAPSHOT] Running for ${today}`);

  // Get all registered ranchers
  const ranchers = await db.query('SELECT id, wallet, lifetime_pts, current_streak FROM ranchers');
  console.log(`[SNAPSHOT] Found ${ranchers.rows.length} ranchers`);

  let processed = 0;
  let errors = 0;

  for (const rancher of ranchers.rows) {
    try {
      // Fetch token balance for this wallet
      const walletPubkey = new PublicKey(rancher.wallet);

      const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
        walletPubkey,
        { mint: RANCH_MINT }
      );

      let balance = 0;
      if (tokenAccounts.value.length > 0) {
        balance = tokenAccounts.value[0].account.data.parsed.info.tokenAmount.uiAmount || 0;
      }

      // Calculate hold points
      const holdPts = getHoldPoints(balance);

      if (holdPts > 0) {
        const rank = getRankForPoints(rancher.lifetime_pts);
        const streakMult = getStreakMult(rancher.current_streak);
        const totalPts = Math.floor(holdPts * streakMult * rank.mult);

        // Record snapshot
        await db.query(`
          INSERT INTO token_snapshots (rancher_id, day_date, balance, hold_tier, pts_awarded)
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (rancher_id, day_date)
          DO UPDATE SET balance = $3, hold_tier = $4, pts_awarded = $5
        `, [rancher.id, today, balance, holdPts, totalPts]);

        // Update daily points
        await db.query(`
          INSERT INTO daily_points (rancher_id, day_date, hold_pts, streak_mult, rank_mult, total_pts)
          VALUES ($1, $2, $3, $4, $5, $3)
          ON CONFLICT (rancher_id, day_date)
          DO UPDATE SET
            hold_pts = $3,
            total_pts = daily_points.total_pts - COALESCE(daily_points.hold_pts, 0) + $3
        `, [rancher.id, today, totalPts, streakMult, rank.mult]);

        // Update lifetime
        await db.query(
          'UPDATE ranchers SET lifetime_pts = lifetime_pts + $1, updated_at = NOW() WHERE id = $2',
          [totalPts, rancher.id]
        );
      }

      processed++;

      // Rate limit: avoid hammering the RPC
      if (processed % 10 === 0) {
        await new Promise(r => setTimeout(r, 500));
      }
    } catch (err) {
      console.error(`[SNAPSHOT] Error for wallet ${rancher.wallet}:`, err.message);
      errors++;
    }
  }

  console.log(`[SNAPSHOT] Done. Processed: ${processed}, Errors: ${errors}`);
  return { processed, errors };
}

// Run directly
if (require.main === module) {
  runDailySnapshot()
    .then(() => process.exit(0))
    .catch(err => { console.error(err); process.exit(1); });
}

module.exports = { runDailySnapshot };
