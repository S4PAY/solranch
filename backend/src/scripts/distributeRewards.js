const { Connection, Keypair, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const bs58 = require('bs58');
const db = require('../db/init');
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const connection = new Connection(
  process.env.HELIUS_API_KEY
    ? `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`
    : process.env.SOLANA_RPC_URL
);

async function runDailyDistribution() {
  // Yesterday's points get distributed today
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const dayDate = yesterday.toISOString().split('T')[0];

  console.log(`[DISTRIBUTE] Processing rewards for ${dayDate}`);

  // Check if already distributed
  const existing = await db.query(
    'SELECT id FROM reward_distributions WHERE day_date = $1',
    [dayDate]
  );
  if (existing.rows.length > 0) {
    console.log('[DISTRIBUTE] Already distributed for this day');
    return;
  }

  // Get the reward pool amount (manually set in env or fetched from wallet)
  const dailyPool = parseFloat(process.env.DAILY_REWARD_AMOUNT || '0');
  if (dailyPool <= 0) {
    console.log('[DISTRIBUTE] No reward pool set. Skipping.');
    return;
  }

  // Get all points earned yesterday
  const pointsResult = await db.query(`
    SELECT dp.rancher_id, dp.total_pts, r.wallet
    FROM daily_points dp
    JOIN ranchers r ON r.id = dp.rancher_id
    WHERE dp.day_date = $1 AND dp.total_pts > 0
    ORDER BY dp.total_pts DESC
  `, [dayDate]);

  if (pointsResult.rows.length === 0) {
    console.log('[DISTRIBUTE] No points earned yesterday');
    return;
  }

  const totalPoints = pointsResult.rows.reduce((sum, r) => sum + parseInt(r.total_pts), 0);
  const numRecipients = pointsResult.rows.length;

  console.log(`[DISTRIBUTE] Pool: ${dailyPool} SOL | Total pts: ${totalPoints} | Recipients: ${numRecipients}`);

  // Create distribution record
  const distResult = await db.query(`
    INSERT INTO reward_distributions (day_date, total_pool_sol, total_points, num_recipients, status)
    VALUES ($1, $2, $3, $4, 'processing')
    RETURNING id
  `, [dayDate, dailyPool, totalPoints, numRecipients]);

  const distributionId = distResult.rows[0].id;

  // Calculate each rancher's share
  const payouts = pointsResult.rows.map(row => ({
    rancherId: row.rancher_id,
    wallet: row.wallet,
    points: parseInt(row.total_pts),
    sharePct: parseInt(row.total_pts) / totalPoints,
    amountSol: (parseInt(row.total_pts) / totalPoints) * dailyPool,
  }));

  // Filter out dust (< 0.000001 SOL)
  const validPayouts = payouts.filter(p => p.amountSol >= 0.000001);

  // Load rewards wallet
  let rewardsKeypair;
  try {
    const privateKey = process.env.REWARDS_WALLET_PRIVATE_KEY;
    rewardsKeypair = Keypair.fromSecretKey(bs58.decode(privateKey));
  } catch (err) {
    console.error('[DISTRIBUTE] Invalid rewards wallet key:', err.message);
    await db.query('UPDATE reward_distributions SET status = $1 WHERE id = $2', ['failed', distributionId]);
    return;
  }

  // Send SOL to each rancher
  // Batch into transactions of 10 transfers each (to stay within tx size limits)
  const BATCH_SIZE = 10;
  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < validPayouts.length; i += BATCH_SIZE) {
    const batch = validPayouts.slice(i, i + BATCH_SIZE);

    try {
      const tx = new Transaction();

      for (const payout of batch) {
        tx.add(
          SystemProgram.transfer({
            fromPubkey: rewardsKeypair.publicKey,
            toPubkey: new PublicKey(payout.wallet),
            lamports: Math.floor(payout.amountSol * LAMPORTS_PER_SOL),
          })
        );
      }

      const { blockhash } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = rewardsKeypair.publicKey;

      const sig = await connection.sendTransaction(tx, [rewardsKeypair]);
      await connection.confirmTransaction(sig, 'confirmed');

      // Record successful payouts
      for (const payout of batch) {
        await db.query(`
          INSERT INTO reward_payouts
            (distribution_id, rancher_id, points_earned, share_pct, amount_sol, tx_sig, status)
          VALUES ($1, $2, $3, $4, $5, $6, 'completed')
        `, [distributionId, payout.rancherId, payout.points, payout.sharePct, payout.amountSol, sig]);
        successCount++;
      }

      console.log(`[DISTRIBUTE] Batch sent: ${batch.length} payouts, tx: ${sig}`);

      // Small delay between batches
      await new Promise(r => setTimeout(r, 1000));

    } catch (err) {
      console.error(`[DISTRIBUTE] Batch failed:`, err.message);

      for (const payout of batch) {
        await db.query(`
          INSERT INTO reward_payouts
            (distribution_id, rancher_id, points_earned, share_pct, amount_sol, status)
          VALUES ($1, $2, $3, $4, $5, 'failed')
        `, [distributionId, payout.rancherId, payout.points, payout.sharePct, payout.amountSol]);
        failCount++;
      }
    }
  }

  // Update distribution status
  const finalStatus = failCount === 0 ? 'completed' : (successCount === 0 ? 'failed' : 'partial');
  await db.query(
    'UPDATE reward_distributions SET status = $1 WHERE id = $2',
    [finalStatus, distributionId]
  );

  console.log(`[DISTRIBUTE] Done. Success: ${successCount}, Failed: ${failCount}, Status: ${finalStatus}`);
  return { successCount, failCount, status: finalStatus };
}

if (require.main === module) {
  runDailyDistribution()
    .then(() => process.exit(0))
    .catch(err => { console.error(err); process.exit(1); });
}

module.exports = { runDailyDistribution };
