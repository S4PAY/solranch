const express = require('express');
const db = require('../db/init');
const router = express.Router();

const MINT = process.env.RANCH_TOKEN_MINT || '';
let cache = { data: null, ts: 0 };

// GET /api/token — price, mcap, holders
router.get('/', async (req, res) => {
  try {
    // Cache for 60 seconds
    if (cache.data && Date.now() - cache.ts < 60000) return res.json(cache.data);

    const resp = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${MINT}`);
    const json = await resp.json();

    let result = { price: null, marketCap: null, holders: null, pumpUrl: `https://pump.fun/coin/${MINT}` };

    if (json.pairs && json.pairs.length > 0) {
      const pair = json.pairs[0];
      result.price = parseFloat(pair.priceUsd) || null;
      result.marketCap = pair.marketCap || pair.fdv || null;
    }

    // Get holder count — paginate through all token accounts
    try {
      const heliusKey = process.env.HELIUS_API_KEY;
      if (heliusKey && MINT) {
        let totalHolders = 0;
        let page = 1;
        let hasMore = true;
        while (hasMore && page <= 20) {
          const hResp = await fetch(`https://mainnet.helius-rpc.com/?api-key=${heliusKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0', id: 1, method: 'getTokenAccounts',
              params: { mint: MINT, limit: 1000, page: page }
            })
          });
          const hJson = await hResp.json();
          const accounts = hJson.result?.token_accounts || [];
          // Only count accounts with balance > 0
          const active = accounts.filter(a => parseFloat(a.amount) > 0);
          totalHolders += active.length;
          if (accounts.length < 1000) hasMore = false;
          page++;
        }
        result.holders = totalHolders;
      }
    } catch (e) {
      // Fallback to DB count
      try {
        const dbCount = await db.query(
          "SELECT COUNT(DISTINCT rancher_id) as cnt FROM token_snapshots WHERE day_date = CURRENT_DATE AND balance > 0"
        );
        result.holders = parseInt(dbCount.rows[0].cnt) || 0;
      } catch(e2) {}
      console.log('[TOKEN] Holder count error:', e.message);
    }

    cache = { data: result, ts: Date.now() };
    res.json(result);
  } catch (err) {
    console.error('[TOKEN] Error:', err.message);
    res.json({ price: null, marketCap: null, holders: null, pumpUrl: `https://pump.fun/coin/${MINT}` });
  }
});

const TREASURY_WALLET = '9yFm38wYQpv9yVGz764WXntkLvax3bd7MrmFy2Wey1Nr';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
let treasuryCache = { data: null, ts: 0 };

// GET /api/token/treasury
router.get('/treasury', async (req, res) => {
  try {
    if (treasuryCache.data && Date.now() - treasuryCache.ts < 30000) return res.json(treasuryCache.data);

    const heliusKey = process.env.HELIUS_API_KEY;
    const rpcUrl = heliusKey ? 'https://mainnet.helius-rpc.com/?api-key=' + heliusKey : 'https://api.mainnet-beta.solana.com';

    const resp = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1,
        method: 'getTokenAccountsByOwner',
        params: [
          TREASURY_WALLET,
          { mint: USDC_MINT },
          { encoding: 'jsonParsed' }
        ]
      })
    });
    const json = await resp.json();

    let usdcBalance = 0;
    if (json.result && json.result.value && json.result.value.length > 0) {
      usdcBalance = parseFloat(json.result.value[0].account.data.parsed.info.tokenAmount.uiAmount) || 0;
    }

    // Also get SOL balance
    const solResp = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1,
        method: 'getBalance',
        params: [TREASURY_WALLET]
      })
    });
    const solJson = await solResp.json();
    const solBalance = solJson.result ? solJson.result.value / 1e9 : 0;

    const result = {
      wallet: TREASURY_WALLET,
      usdcBalance: Math.floor(usdcBalance * 100) / 100,
      solBalance: Math.floor(solBalance * 1000) / 1000,
    };

    treasuryCache = { data: result, ts: Date.now() };
    res.json(result);
  } catch (err) {
    console.error('[TREASURY] Error:', err.message);
    res.json({ wallet: TREASURY_WALLET, usdcBalance: 0, solBalance: 0 });
  }
});

module.exports = router;
