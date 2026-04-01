// weeklyDistribute.js
// Calculates weekly USDC reward payouts with seller detection.
// Anyone who dropped to 0 $RANCH during the week = forfeited, share redistributed.
// NO private keys. NO on-chain transactions.
//
// Run every Sunday night:  node weeklyDistribute.js
// Preview only:            node weeklyDistribute.js --dry-run

const db = require('./src/db/init');
require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const DRY_RUN = process.argv.includes('--dry-run');


function getWeekRange() {
  const now = new Date();
  const day = now.getDay(); // 0=Sun, 1=Mon, ...
  const isDryRun = process.argv.includes('--dry-run');

  // On Monday (payout day): pay for LAST week (Mon-Sun)
  // Other days dry-run: show current week progress
  if (day === 1 && !isDryRun) {
    // Actual Monday payout: last week Mon-Sun
    const lastMonday = new Date(now);
    lastMonday.setDate(now.getDate() - 7);
    lastMonday.setHours(0, 0, 0, 0);
    const lastSunday = new Date(lastMonday);
    lastSunday.setDate(lastMonday.getDate() + 6);
    const fmt = d => d.toISOString().split('T')[0];
    return { weekStart: fmt(lastMonday), weekEnd: fmt(lastSunday) };
  }

  if (day === 1 && isDryRun) {
    // Monday dry-run: also show last week
    const lastMonday = new Date(now);
    lastMonday.setDate(now.getDate() - 7);
    lastMonday.setHours(0, 0, 0, 0);
    const lastSunday = new Date(lastMonday);
    lastSunday.setDate(lastMonday.getDate() + 6);
    const fmt = d => d.toISOString().split('T')[0];
    return { weekStart: fmt(lastMonday), weekEnd: fmt(lastSunday) };
  }

  // Other days: show current week progress
  const monday = new Date(now);
  monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
  monday.setHours(0, 0, 0, 0);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const fmt = d => d.toISOString().split('T')[0];
  return { weekStart: fmt(monday), weekEnd: fmt(today) };
}

async function checkHeldAllWeek(rancherId, wallet, weekStart, weekEnd) {

  // Get all snapshots for this rancher during the week
  const snapshots = await db.query(`
    SELECT day_date, balance FROM token_snapshots
    WHERE rancher_id = $1 AND day_date BETWEEN $2 AND $3
    ORDER BY day_date
  `, [rancherId, weekStart, weekEnd]);

  // No snapshots at all = not holding
  if (snapshots.rows.length === 0) {
    return { held: false, reason: 'No snapshots found' };
  }

  // Check how many days held 50k+ (allow missing 2 days max)
  const MIN_BALANCE = 50000;
  const totalDays = snapshots.rows.length;
  let heldDays = 0;
  let failDate = '';
  for (const snap of snapshots.rows) {
    const bal = parseFloat(snap.balance);
    if (bal >= MIN_BALANCE) {
      heldDays++;
    } else {
      const d = snap.day_date instanceof Date ? snap.day_date.toLocaleDateString('en-CA') : String(snap.day_date).split('T')[0];
      if (!failDate) failDate = d + ' (bal: ' + Math.floor(bal).toLocaleString() + ')';
    }
  }
  const MIN_HELD_DAYS = Math.max(totalDays - 2, 1); // Allow missing up to 2 days
  if (heldDays < MIN_HELD_DAYS) {
    return { held: false, reason: 'Held ' + heldDays + '/' + totalDays + ' days (need ' + MIN_HELD_DAYS + '). First fail: ' + failDate };
  }

  return { held: true, reason: 'Held all week' };
}

async function runWeeklyDistribution() {
  const { weekStart, weekEnd } = getWeekRange();

  console.log(`\n[WEEKLY] ========================================`);
  console.log(`[WEEKLY] Processing rewards for week: ${weekStart} → ${weekEnd}`);
  if (DRY_RUN) console.log(`[WEEKLY] DRY RUN — no DB writes`);
  console.log(`[WEEKLY] ========================================\n`);

  if (!DRY_RUN) {
    const existing = await db.query(
      `SELECT id FROM reward_payouts WHERE week_date = $1 LIMIT 1`,
      [weekEnd]
    );
    if (existing.rows.length > 0) {
      console.log(`[WEEKLY] Already distributed for week ending ${weekEnd}. Exiting.`);
      return;
    }
  }

  // Fetch live USDC balance from treasury wallet
  const TREASURY_WALLET = '9yFm38wYQpv9yVGz764WXntkLvax3bd7MrmFy2Wey1Nr';
  const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
  const rpcUrl = process.env.HELIUS_API_KEY
    ? 'https://mainnet.helius-rpc.com/?api-key=' + process.env.HELIUS_API_KEY
    : 'https://api.mainnet-beta.solana.com';

  let weeklyPool = 0;
  try {
    const resp = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1,
        method: 'getTokenAccountsByOwner',
        params: [TREASURY_WALLET, { mint: USDC_MINT }, { encoding: 'jsonParsed' }]
      })
    });
    const json = await resp.json();
    if (json.result && json.result.value && json.result.value.length > 0) {
      weeklyPool = parseFloat(json.result.value[0].account.data.parsed.info.tokenAmount.uiAmount) || 0;
    }
  } catch (err) {
    console.error('[WEEKLY] Failed to fetch treasury balance:', err.message);
    return;
  }

  if (weeklyPool <= 0) {
    console.log('[WEEKLY] Treasury is empty. No USDC to distribute. Exiting.');
    return;
  }
  weeklyPool = Math.floor(weeklyPool * 100) / 100; // round down to cents
  console.log(`[WEEKLY] Treasury USDC balance: ${weeklyPool}`);
  console.log(`[WEEKLY] Distributing full treasury to eligible holders`);

  // Get all ranchers with points this week
  const pointsResult = await db.query(`
    SELECT
      r.id        AS rancher_id,
      r.wallet,
      r.ranch_name,
      SUM(dp.total_pts)   AS raw_pts,
      SUM(COALESCE(dp.checkin_pts,0) + COALESCE(dp.social_pts,0) + COALESCE(dp.rodeo_pts,0) + COALESCE(dp.buy_pts,0) + COALESCE(dp.referral_pts,0)) AS active_pts,
      SUM(COALESCE(dp.hold_pts,0)) AS hold_pts,
      AVG(dp.streak_mult) AS avg_streak,
      AVG(dp.rank_mult)   AS avg_rank
    FROM daily_points dp
    JOIN ranchers r ON r.id = dp.rancher_id
    WHERE dp.day_date BETWEEN $1 AND $2
      AND dp.total_pts > 0
    GROUP BY r.id, r.wallet, r.ranch_name
    ORDER BY raw_pts DESC
  `, [weekStart, weekEnd]);

  if (pointsResult.rows.length === 0) {
    console.log('[WEEKLY] No points earned this week. Exiting.');
    return;
  }

  console.log(`[WEEKLY] Total ranchers with points: ${pointsResult.rows.length}`);
  console.log(`[WEEKLY] Checking who held $RANCH all week...\n`);

  // Check each rancher's holdings throughout the week
  const eligible = [];
  const forfeited = [];

  for (const row of pointsResult.rows) {
    const check = await checkHeldAllWeek(row.rancher_id, row.wallet, weekStart, weekEnd);
    const activePts = parseInt(row.active_pts) || 0;
    const holdPts = parseInt(row.hold_pts) || 0;

    if (!check.held) {
      forfeited.push({ ...row, rawPts: parseInt(row.raw_pts), activePts, holdReason: check.reason });
    } else if (activePts <= 0) {
      forfeited.push({ ...row, rawPts: parseInt(row.raw_pts), activePts, holdReason: 'Passive holder only — no active tasks completed' });
    } else {
      eligible.push({ ...row, rawPts: parseInt(row.raw_pts), activePts, holdReason: check.reason });
    }
  }

  // Print forfeited wallets
  if (forfeited.length > 0) {
    console.log(`[WEEKLY] ── FORFEITED (sold during the week) ──`);
    for (const f of forfeited) {
      const w = f.wallet.slice(0, 8) + '...' + f.wallet.slice(-6);
      console.log(`  ✗ ${w} (${f.ranch_name}) — ${f.rawPts} pts forfeited — ${f.holdReason}`);
    }
    const totalForfeited = forfeited.reduce((sum, f) => sum + f.rawPts, 0);
    console.log(`  Total forfeited points: ${totalForfeited}`);
    console.log(`  Their share redistributed to ${eligible.length} eligible holders\n`);
  } else {
    console.log(`[WEEKLY] No sellers detected — all points honored\n`);
  }

  if (eligible.length === 0) {
    console.log('[WEEKLY] No eligible ranchers this week. Exiting.');
    return;
  }

  // Calculate payouts from eligible wallets only
  const totalEligiblePts = eligible.reduce((sum, r) => sum + r.rawPts, 0);

  console.log(`[WEEKLY] Eligible ranchers: ${eligible.length}`);
  console.log(`[WEEKLY] Eligible points: ${totalEligiblePts}`);
  console.log(`[WEEKLY] Forfeited ranchers: ${forfeited.length}\n`);

  const payouts = eligible.map(row => {
    const sharePct = row.rawPts / totalEligiblePts;
    const amountUsdc = sharePct * weeklyPool;
    return {
      rancherId: row.rancher_id,
      wallet: row.wallet,
      ranchName: row.ranch_name,
      rawPts: row.rawPts,
      sharePct,
      amountUsdc,
          };
  });

  const validPayouts = payouts.filter(p => p.amountUsdc >= 0.01);
  const dustCount = payouts.length - validPayouts.length;

  console.log(`[WEEKLY] Valid payouts: ${validPayouts.length} (${dustCount} filtered as dust)\n`);

  // Print payout table
  console.log(`[WEEKLY] ── PAYOUT TABLE ──`);
  console.log(`${'Rancher'.padEnd(20)} ${'Wallet'.padEnd(18)} ${'Points'.padStart(10)} ${'Share%'.padStart(8)} ${'USDC'.padStart(12)}`);
  console.log('─'.repeat(80));
  for (const p of validPayouts) {
    const w = p.wallet.slice(0, 8) + '...' + p.wallet.slice(-4);
    const name = p.ranchName.slice(0, 18).padEnd(20);
    console.log(
      `${name} ${w.padEnd(18)} ${String(p.rawPts).padStart(10)} ${(p.sharePct * 100).toFixed(2).padStart(7)}% ${('$' + p.amountUsdc.toFixed(2)).padStart(12)}`
    );
  }
  console.log('─'.repeat(80));
  console.log(`${'TOTAL'.padEnd(20)} ${''.padEnd(18)} ${''.padEnd(5)} ${String(totalEligiblePts).padStart(10)} ${'100.00'.padStart(7)}% ${('$' + weeklyPool.toFixed(2)).padStart(12)}`);

  // Print CSV for distribution
  console.log(`\n[WEEKLY] ── CSV (wallet,amount) ──`);
  for (const p of validPayouts) {
    console.log(`${p.wallet},${p.amountUsdc.toFixed(4)}`);
  }

  if (DRY_RUN) {
    console.log('\n[WEEKLY] DRY RUN complete. Run without --dry-run to save to DB.');
    return;
  }

  // Save to DB
  let saved = 0;
  for (const p of validPayouts) {
    await db.query(`
      INSERT INTO reward_payouts (wallet, week_date, raw_pts, effective_pts, share_pct, reward_usdc)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (wallet, week_date) DO NOTHING
    `, [p.wallet, weekEnd, p.rawPts, p.rawPts, p.sharePct, p.amountUsdc]);
    saved++;
  }

  console.log(`\n[WEEKLY] ✅ Saved ${saved} payout records for week ending ${weekEnd}`);
  console.log(`[WEEKLY] Rewards automatically sent to eligible users on Monday.`);
  console.log(`[WEEKLY] ${forfeited.length} sellers forfeited — their share went to holders.\n`);

  return { saved, weekEnd, eligible: validPayouts.length, forfeited: forfeited.length };
}

if (require.main === module) {
  runWeeklyDistribution()
    .then(() => process.exit(0))
    .catch(err => { console.error('[WEEKLY] Fatal error:', err); process.exit(1); });
}

module.exports = { runWeeklyDistribution };
