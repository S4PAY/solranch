const express = require('express');
const router = express.Router();
const { getHoldTier, getAllTiers } = require('../services/holdingTiers');
const db = require('../db/init');

const MINT = process.env.RANCH_TOKEN_MINT || '';
const HELIUS_KEY = process.env.HELIUS_API_KEY || '';

async function fetchOnChainBalance(walletAddress) {
  if (!MINT || !HELIUS_KEY) return 0;
  try {
    const resp = await fetch(`https://mainnet.helius-rpc.com/?api-key=${HELIUS_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1,
        method: 'getTokenAccountsByOwner',
        params: [
          walletAddress,
          { mint: MINT },
          { encoding: 'jsonParsed' }
        ]
      })
    });
    const json = await resp.json();
    if (json.result && json.result.value && json.result.value.length > 0) {
      const info = json.result.value[0].account.data.parsed.info;
      return parseFloat(info.tokenAmount.uiAmount) || 0;
    }
    return 0;
  } catch (err) {
    console.error('[TIERS] RPC error:', err.message);
    return 0;
  }
}

router.get('/', (req, res) => {
  res.json({ tiers: getAllTiers() });
});


router.get('/:wallet', async (req, res) => {
  try {
    const wallet = req.params.wallet;

    // Fetch live balance from chain
    const balance = await fetchOnChainBalance(wallet);

    // Save snapshot for reward calc
    const rancher = await db.query('SELECT id FROM ranchers WHERE wallet = $1', [wallet]);
    if (rancher.rows.length > 0) {
      const today = new Date().toISOString().split('T')[0];
      const tier = getHoldTier(balance);
      await db.query(`
        INSERT INTO token_snapshots (rancher_id, day_date, balance, hold_tier)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (rancher_id, day_date)
        DO UPDATE SET balance = $3, hold_tier = $4
      `, [rancher.rows[0].id, today, Math.floor(balance), tier.level || 0]);
    }

    const tier = getHoldTier(balance);
    res.json({ balance, tier, allTiers: getAllTiers() });
  } catch (err) {
    console.error('[TIERS] Error:', err.message);
    res.json({ balance: 0, tier: getHoldTier(0), allTiers: getAllTiers() });
  }
});

module.exports = router;
