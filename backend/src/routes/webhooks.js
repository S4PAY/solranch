const express = require('express');
const router = express.Router();
const { processBuyEvent } = require('../services/points');

const MINT = process.env.RANCH_TOKEN_MINT || '';

router.post('/helius', async (req, res) => {
  try {
    const events = Array.isArray(req.body) ? req.body : [req.body];
    
    // Log everything for debugging
    console.log(`[WEBHOOK] Received ${events.length} event(s)`);
    
    for (const tx of events) {
      console.log(`[WEBHOOK] Type: ${tx.type} | Sig: ${(tx.signature || '').slice(0,20)}...`);
      
      const tokenTransfers = tx.tokenTransfers || [];
      if (tokenTransfers.length > 0) {
        console.log(`[WEBHOOK] Token transfers: ${JSON.stringify(tokenTransfers.map(t => ({ mint: t.mint?.slice(0,8), to: t.toUserAccount?.slice(0,8), amount: t.tokenAmount })))}`);
      }

      // Check all token transfers for our mint
      for (const transfer of tokenTransfers) {
        if (transfer.mint === MINT && transfer.toUserAccount) {
          const buyer = transfer.toUserAccount;
          const amount = transfer.tokenAmount || 0;
          const sig = tx.signature || '';
          // Get SOL from all native transfers (buyer pays SOL, receives tokens)
          let solAmount = 0;
          for (const nt of (tx.nativeTransfers || [])) {
            if (nt.fromUserAccount === buyer && nt.amount > 0) {
              solAmount += nt.amount / 1e9;
            }
          }
          // Fallback: if no SOL found from buyer, use first native transfer
          if (solAmount === 0 && tx.nativeTransfers && tx.nativeTransfers.length > 0) {
            solAmount = Math.abs(tx.nativeTransfers[0].amount) / 1e9;
          }

          console.log(`[WEBHOOK] Buy detected: ${buyer} got ${amount} tokens, spent ${solAmount} SOL`);
          const result = await processBuyEvent(buyer, sig, solAmount, amount);
          if (result) console.log(`[WEBHOOK] Awarded ${result.pointsEarned} pts ($${result.usdValue})`);
        }
      }
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[WEBHOOK] Error:', err.message);
    res.status(200).json({ success: false });
  }
});

module.exports = router;
