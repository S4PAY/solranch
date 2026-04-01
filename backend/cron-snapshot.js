const db = require('./src/db/init');
const { getHoldTier } = require('./src/services/holdingTiers');

const MINT = process.env.RANCH_TOKEN_MINT || '';
const HELIUS_KEY = process.env.HELIUS_API_KEY || '';

async function fetchBalance(wallet) {
  if (!MINT || !HELIUS_KEY) return 0;
  try {
    const resp = await fetch(`https://mainnet.helius-rpc.com/?api-key=${HELIUS_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1,
        method: 'getTokenAccountsByOwner',
        params: [wallet, { mint: MINT }, { encoding: 'jsonParsed' }]
      })
    });
    const json = await resp.json();
    if (json.result?.value?.length > 0) {
      return parseFloat(json.result.value[0].account.data.parsed.info.tokenAmount.uiAmount) || 0;
    }
    return 0;
  } catch (err) {
    console.error(`[SNAPSHOT] RPC error for ${wallet}:`, err.message);
    return 0;
  }
}

async function run() {
  console.log('[SNAPSHOT] Starting daily balance snapshot...');
  const today = new Date().toISOString().split('T')[0];

  const ranchers = await db.query('SELECT id, wallet FROM ranchers');
  let updated = 0;

  for (const r of ranchers.rows) {
    const balance = await fetchBalance(r.wallet);
    const tier = getHoldTier(balance);

    await db.query(`
      INSERT INTO token_snapshots (rancher_id, day_date, balance, hold_tier)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (rancher_id, day_date)
      DO UPDATE SET balance = $3, hold_tier = $4
    `, [r.id, today, Math.floor(balance), parseInt(tier.level) || 0]);

    updated++;
    console.log(`  ${r.wallet.slice(0,8)}... = ${Math.floor(balance)} tokens (${tier.name})`);

    // Rate limit: 100ms between calls
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  console.log('[SNAPSHOT] Done. ' + updated + ' wallets updated.');

  process.exit(0);
}

run().catch(err => { console.error('[SNAPSHOT] Fatal:', err); process.exit(1); });

// Process pending referrals (only if referred holds 50k+)
async function processPendingReferrals() {
  const { processReferral } = require('./src/services/points');
  const pending = await db.query(`
    SELECT r.id as referred_id, r.referred_by, r2.wallet as referrer_wallet
    FROM ranchers r
    JOIN ranchers r2 ON r2.id = r.referred_by
    LEFT JOIN referrals ref ON ref.referred_id = r.id
    LEFT JOIN token_snapshots ts ON ts.rancher_id = r.id AND ts.day_date = CURRENT_DATE
    WHERE r.referred_by IS NOT NULL AND ref.id IS NULL AND COALESCE(ts.balance, 0) >= 50000
  `);
  for (const row of pending.rows) {
    try {
      await processReferral(row.referrer_wallet, row.referred_id);
      console.log('[REFERRAL] Credited: referred #' + row.referred_id + ' holds 50k+');
    } catch (e) {
      console.log('[REFERRAL] Error:', e.message);
    }
  }
  console.log('[REFERRAL] Processed ' + pending.rows.length + ' pending referrals');
}

processPendingReferrals().catch(e => console.error(e));
