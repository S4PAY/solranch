// dailyBurn.js
// Calculates daily burn amount and logs completed burns to DB.
// Actual burn is executed MANUALLY from the deployer wallet.
// NO private keys. NO on-chain transactions.
//
// Calculate today's burn:
//   node dailyBurn.js --dry-run
//
// Log a completed burn (after you manually burned):
//   node dailyBurn.js --log --amount 50000 --tx <tx_signature>
//
// Check burn history:
//   node dailyBurn.js --history

const db = require('./src/db/init');
require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const LOG_MODE = args.includes('--log');
const HISTORY = args.includes('--history');
const BURN_PERCENT = parseFloat(process.env.BURN_PERCENT || '30') / 100;
const today = new Date().toISOString().split('T')[0];

function getArg(flag) {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : null;
}

async function showHistory() {
  console.log(`\n[BURN] ── BURN HISTORY ──`);
  const result = await db.query(`
    SELECT burn_date, amount_ranch, burn_pct, tx_sig
    FROM burn_log
    ORDER BY burn_date DESC
    LIMIT 14
  `);

  if (result.rows.length === 0) {
    console.log('[BURN] No burns logged yet.');
    return;
  }

  console.log(`${'Date'.padEnd(14)} ${'$RANCH Burned'.padStart(16)} ${'%'.padStart(5)} ${'TX Sig'}`);
  console.log('─'.repeat(80));

  let totalBurned = 0;
  for (const row of result.rows) {
    const amt = parseFloat(row.amount_ranch);
    totalBurned += amt;
    const sig = row.tx_sig ? row.tx_sig.slice(0, 20) + '...' : 'n/a';
    console.log(
      `${row.burn_date.toISOString().split('T')[0].padEnd(14)} ${amt.toLocaleString().padStart(16)} ${String(row.burn_pct).padStart(4)}% ${sig}`
    );
  }

  console.log('─'.repeat(80));
  console.log(`Total burned (last ${result.rows.length} entries): ${totalBurned.toLocaleString()} $RANCH\n`);
}

async function logBurn() {
  const amount = parseFloat(getArg('--amount'));
  const txSig = getArg('--tx');

  if (!amount || isNaN(amount)) {
    console.error('[BURN] --amount required. Usage: node dailyBurn.js --log --amount 50000 --tx <sig>');
    process.exit(1);
  }

  console.log(`\n[BURN] ========================================`);
  console.log(`[BURN] Logging burn for ${today}`);
  console.log(`[BURN] Amount: ${amount.toLocaleString()} $RANCH`);
  console.log(`[BURN] TX: ${txSig || 'not provided'}`);
  console.log(`[BURN] ========================================\n`);

  // Check for duplicate
  const existing = await db.query(
    `SELECT id FROM burn_log WHERE burn_date = $1 LIMIT 1`,
    [today]
  );
  if (existing.rows.length > 0) {
    console.log(`[BURN] ⚠️  Already have a burn logged for ${today}. Adding another entry anyway.`);
  }

  await db.query(`
    INSERT INTO burn_log (burn_date, amount_ranch, burn_pct, tx_sig, wallet)
    VALUES ($1, $2, $3, $4, $5)
  `, [today, amount, BURN_PERCENT * 100, txSig || null, 'deployer']);

  console.log(`[BURN] ✅ Burn logged to DB`);
  console.log(`\n[BURN] ── POST THIS TO TWITTER/TELEGRAM ──`);
  console.log(`🔥 Daily Burn — ${today}`);
  console.log(`${amount.toLocaleString()} $RANCH burned`);
  if (txSig) console.log(`TX: https://solscan.io/tx/${txSig}`);
  console.log(`\n🌐 solranch.farm`);
  console.log(`💰 $RANCH on Pump.fun`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
}

async function calculateBurn() {
  console.log(`\n[BURN] ========================================`);
  console.log(`[BURN] Daily $RANCH Burn Calculator — ${today}`);
  console.log(`[BURN] Burn allocation: ${BURN_PERCENT * 100}% of daily creator fees`);
  console.log(`[BURN] ========================================\n`);

  // Check if already burned today
  const existing = await db.query(
    `SELECT amount_ranch, tx_sig FROM burn_log WHERE burn_date = $1`,
    [today]
  );
  if (existing.rows.length > 0) {
    const row = existing.rows[0];
    console.log(`[BURN] ⚠️  Already burned today: ${parseFloat(row.amount_ranch).toLocaleString()} $RANCH`);
    if (row.tx_sig) console.log(`[BURN] TX: https://solscan.io/tx/${row.tx_sig}`);
    return;
  }

  console.log(`[BURN] HOW TO BURN:`);
  console.log(`  1. Check Pump.fun creator fees collected today`);
  console.log(`  2. Calculate 30% of fees in $RANCH`);
  console.log(`  3. Buy $RANCH with that SOL amount from deployer wallet`);
  console.log(`  4. Burn the $RANCH (send to burn address or use SPL burn)`);
  console.log(`  5. Log it: node dailyBurn.js --log --amount <RANCH_AMOUNT> --tx <TX_SIG>`);
  console.log(`  6. Post the burn to Twitter/Telegram\n`);

  // Show recent burns for context
  const recent = await db.query(`
    SELECT burn_date, amount_ranch FROM burn_log
    ORDER BY burn_date DESC LIMIT 5
  `);
  if (recent.rows.length > 0) {
    console.log(`[BURN] Recent burns:`);
    for (const r of recent.rows) {
      console.log(`  ${r.burn_date.toISOString().split('T')[0]}: ${parseFloat(r.amount_ranch).toLocaleString()} $RANCH`);
    }
  }
}

async function main() {
  if (HISTORY) return showHistory();
  if (LOG_MODE) return logBurn();
  return calculateBurn();
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch(err => { console.error('[BURN] Fatal:', err); process.exit(1); });
}

module.exports = { logBurn, calculateBurn };

