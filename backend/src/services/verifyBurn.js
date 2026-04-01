const HELIUS_KEY = process.env.HELIUS_API_KEY || '';
const RANCH_MINT = process.env.RANCH_TOKEN_MINT || '';
const BURN_ADDRESS = '1nc1nerator11111111111111111111111111111111';

async function verifyBurnTx(txSignature, expectedSender, expectedAmount) {
  if (!HELIUS_KEY) throw new Error('Helius API key not configured');

  // Fetch parsed transaction from Helius
  const resp = await fetch(`https://api.helius.xyz/v0/transactions/?api-key=${HELIUS_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transactions: [txSignature] })
  });

  const data = await resp.json();
  if (!data || !data[0]) {
    throw new Error('Transaction not found. Wait a moment and try again.');
  }

  const tx = data[0];

  // Check if TX has errors
  if (tx.transactionError) {
    throw new Error('Transaction failed on-chain');
  }

  // Check token transfers
  const transfers = tx.tokenTransfers || [];
  
  // Look for a transfer of $RANCH from the sender
  const burnTransfer = transfers.find(t => {
    const isRanchToken = t.mint === RANCH_MINT;
    const isFromSender = t.fromUserAccount === expectedSender;
    const isToBurn = t.toUserAccount === BURN_ADDRESS;
    // Also accept SPL token burn instruction (no receiver)
    const isBurnInstruction = !t.toUserAccount && t.fromUserAccount === expectedSender;
    return isRanchToken && isFromSender && (isToBurn || isBurnInstruction);
  });

  if (!burnTransfer) {
    // Check native token burns (SPL burn instruction shows differently)
    // Also check account data for burn instruction
    const instructions = tx.instructions || [];
    const hasBurnIx = instructions.some(ix => 
      ix.programId === 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' && 
      ix.data && ix.accounts && ix.accounts.length >= 3
    );

    if (!hasBurnIx) {
      throw new Error('No $RANCH burn found in this transaction. Make sure you burned (not just sent) $RANCH.');
    }

    // If burn instruction exists, check the amount from account balance changes
    const accountData = tx.accountData || [];
    const senderChange = accountData.find(a => a.account === expectedSender);
    
    // Fallback: check token balance changes
    const tokenBalChanges = tx.tokenBalanceChanges || [];
    const senderTokenChange = tokenBalChanges.find(c => 
      c.userAccount === expectedSender && c.mint === RANCH_MINT
    );

    if (senderTokenChange) {
      const burnedAmount = Math.abs(parseFloat(senderTokenChange.rawTokenAmount?.tokenAmount || 0) / 
        Math.pow(10, senderTokenChange.rawTokenAmount?.decimals || 6));
      
      if (burnedAmount < expectedAmount) {
        throw new Error('Burned ' + Math.floor(burnedAmount).toLocaleString() + ' but need ' + expectedAmount.toLocaleString() + ' $RANCH');
      }
      
      return {
        verified: true,
        sender: expectedSender,
        amount: burnedAmount,
        txSignature,
        method: 'spl_burn'
      };
    }

    throw new Error('Could not verify burn amount. Try sending to the burn address instead: ' + BURN_ADDRESS);
  }

  // Verify amount (tokenAmount is in raw decimals)
  const burnedAmount = parseFloat(burnTransfer.tokenAmount) || 0;
  
  if (burnedAmount < expectedAmount) {
    throw new Error('Burned ' + Math.floor(burnedAmount).toLocaleString() + ' but need ' + expectedAmount.toLocaleString() + ' $RANCH');
  }

  return {
    verified: true,
    sender: expectedSender,
    amount: burnedAmount,
    receiver: burnTransfer.toUserAccount || 'burned',
    txSignature,
    method: 'transfer_to_incinerator'
  };
}

// Check if TX was already used
async function isTxUsed(db, txSignature) {
  const result = await db.query(
    'SELECT id FROM supply_purchases WHERE tx_sig = $1',
    [txSignature]
  );
  return result.rows.length > 0;
}

module.exports = { verifyBurnTx, isTxUsed, BURN_ADDRESS };
