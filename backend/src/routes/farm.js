const express = require('express');
const router = express.Router();
const db = require('../db/init');

// ═══ HELPER: Verify burn TX via Helius ═══
async function verifyBurn(wallet, txSignature, expectedAmount) {
  try {
    // Check TX not already used
    const used = await db.query(
      "SELECT id FROM ranch_inventory WHERE burn_tx = $1 UNION SELECT id FROM ranch_chunks WHERE burn_tx = $1 UNION SELECT id FROM ranch_buildings WHERE burn_tx = $1 UNION SELECT id FROM ranch_animals WHERE burn_tx = $1 UNION SELECT id FROM ranch_machines WHERE burn_tx = $1 UNION SELECT id FROM ranch_decorations WHERE burn_tx = $1 UNION SELECT id FROM ranch_crops WHERE burn_tx = $1",
      [txSignature]
    );
    if (used.rows.length > 0) return { ok: false, error: 'TX already used' };

    // Call Helius to verify
    const HELIUS_KEY = process.env.HELIUS_API_KEY;
    if (!HELIUS_KEY) {
      console.warn('[FARM] No Helius key, skipping verification in dev');
      return { ok: true }; // Dev mode: skip verification
    }

    const resp = await fetch(`https://api.helius.xyz/v0/transactions/?api-key=${HELIUS_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transactions: [txSignature] }),
    });
    const txs = await resp.json();
    if (!txs || txs.length === 0) return { ok: false, error: 'TX not found' };

    const tx = txs[0];
    // Verify it's a token transfer to burn address
    const BURN_ADDR = '1nc1nerator11111111111111111111111111111111';
    const RANCH_MINT = 'Enzqw4s6cwjTbd67ud1mgc9Wj6wh4GHMP7h1Y9Kypump';

    let burnFound = false;
    if (tx.tokenTransfers) {
      for (const t of tx.tokenTransfers) {
        if (t.fromUserAccount === wallet && t.toUserAccount === BURN_ADDR && t.mint === RANCH_MINT) {
          if (t.tokenAmount >= expectedAmount * 0.95) { // 5% tolerance
            burnFound = true;
            break;
          }
        }
      }
    }
    if (!burnFound) return { ok: false, error: 'Burn not verified. Check wallet, amount, and burn address.' };
    return { ok: true };
  } catch (err) {
    console.error('[FARM] Verify burn error:', err.message);
    return { ok: false, error: 'Verification failed' };
  }
}

// ═══ GET /api/farm/:wallet — Load full farm state ═══
router.get('/shop/items', async (req, res) => {
  try {
    const [buildings, animals, crops, machines, decos] = await Promise.all([
      db.query('SELECT name, width_tiles, height_tiles, burn_cost_base as burn_cost FROM building_types'),
      db.query('SELECT name, burn_cost, daily_pts, width_tiles, height_tiles, sprite_key FROM animal_types'),
      db.query('SELECT name, burn_cost, grow_minutes, harvest_pts, sprite_row FROM crop_types'),
      db.query('SELECT name, burn_cost, daily_pts, boost_type, boost_pct, sprite_key FROM machine_types'),
      db.query('SELECT name, burn_cost, daily_pts, sprite_key FROM deco_types'),
    ]);

router.get('/:wallet', async (req, res) => {
  try {
    const { wallet } = req.params;

    const [inventory, buildings, animals, crops, machines, decos, chunks, feedLog] = await Promise.all([
      db.query('SELECT item_category, item_type, quantity FROM ranch_inventory WHERE wallet = $1', [wallet]),
      db.query('SELECT id, building_type, tile_x, tile_y, level, placed_at FROM ranch_buildings WHERE wallet = $1', [wallet]),
      db.query('SELECT id, animal_type, tile_x, tile_y, last_fed_at, placed_at FROM ranch_animals WHERE wallet = $1', [wallet]),
      db.query('SELECT id, crop_type, tile_x, tile_y, stage, planted_at, next_stage_at FROM ranch_crops WHERE wallet = $1', [wallet]),
      db.query('SELECT id, machine_type, tile_x, tile_y, placed_at FROM ranch_machines WHERE wallet = $1', [wallet]),
      db.query('SELECT id, deco_type, tile_x, tile_y, placed_at FROM ranch_decorations WHERE wallet = $1', [wallet]),
      db.query('SELECT chunk_x, chunk_y FROM ranch_chunks WHERE wallet = $1', [wallet]),
      db.query("SELECT fed_at FROM ranch_feed_log WHERE wallet = $1 AND fed_at > NOW() - INTERVAL '24 hours' ORDER BY fed_at DESC LIMIT 1", [wallet]),
    ]);

    // Check if animals are fed today
    const fedToday = feedLog.rows.length > 0;

    res.json({
      inventory: inventory.rows,
      buildings: buildings.rows,
      animals: animals.rows,
      crops: crops.rows,
      machines: machines.rows,
      decorations: decos.rows,
      chunks: chunks.rows.map(r => r.chunk_x + ',' + r.chunk_y),
      fedToday,
    });
  } catch (err) {
    console.error('[FARM] Load error:', err.message);
    res.status(500).json({ error: 'Failed to load farm' });
  }
});

// ═══ GET /api/farm/shop/items — Get all shop items with prices ═══


    res.json({
      buildings: buildings.rows,
      animals: animals.rows,
      crops: crops.rows,
      machines: machines.rows,
      decorations: decos.rows,
    });
  } catch (err) {
    console.error('[FARM] Shop error:', err.message);
    res.status(500).json({ error: 'Failed to load shop' });
  }
});

// ═══ POST /api/farm/buy — Buy item from shop (burn $RANCH) ═══
router.post('/buy', async (req, res) => {
  try {
    const { wallet, itemCategory, itemType, quantity, txSignature } = req.body;
    if (!wallet || !itemCategory || !itemType || !txSignature) {
      return res.status(400).json({ error: 'Missing fields' });
    }
    const qty = quantity || 1;

    // Get item cost
    let cost = 0;
    if (itemCategory === 'building') {
      const r = await db.query('SELECT burn_cost_base FROM building_types WHERE name = $1', [itemType]);
      if (!r.rows.length) return res.status(400).json({ error: 'Unknown building: ' + itemType });
      cost = parseInt(r.rows[0].burn_cost_base);
    } else if (itemCategory === 'animal') {
      const r = await db.query('SELECT burn_cost FROM animal_types WHERE name = $1', [itemType]);
      if (!r.rows.length) return res.status(400).json({ error: 'Unknown animal: ' + itemType });
      cost = parseInt(r.rows[0].burn_cost);
    } else if (itemCategory === 'crop') {
      const r = await db.query('SELECT burn_cost FROM crop_types WHERE name = $1', [itemType]);
      if (!r.rows.length) return res.status(400).json({ error: 'Unknown crop: ' + itemType });
      cost = parseInt(r.rows[0].burn_cost);
    } else if (itemCategory === 'machine') {
      const r = await db.query('SELECT burn_cost FROM machine_types WHERE name = $1', [itemType]);
      if (!r.rows.length) return res.status(400).json({ error: 'Unknown machine: ' + itemType });
      cost = parseInt(r.rows[0].burn_cost);
    } else if (itemCategory === 'deco') {
      const r = await db.query('SELECT burn_cost FROM deco_types WHERE name = $1', [itemType]);
      if (!r.rows.length) return res.status(400).json({ error: 'Unknown decoration: ' + itemType });
      cost = parseInt(r.rows[0].burn_cost);
    } else {
      return res.status(400).json({ error: 'Unknown category: ' + itemCategory });
    }

    const totalCost = cost * qty;

    // Verify burn
    const verify = await verifyBurn(wallet, txSignature, totalCost);
    if (!verify.ok) return res.status(400).json({ error: verify.error });

    // Add to inventory (upsert: stack same items)
    await db.query(
      `INSERT INTO ranch_inventory (wallet, item_category, item_type, quantity, burn_tx, burn_amount)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (wallet, item_type) DO UPDATE SET quantity = ranch_inventory.quantity + $4`,
      [wallet, itemCategory, itemType, qty, txSignature, totalCost]
    );

    // Log the burn in burn_log if table exists
    try {
      const rancher = await db.query('SELECT id FROM ranchers WHERE wallet = $1', [wallet]);
      if (rancher.rows.length) {
        await db.query(
          'INSERT INTO burn_log (rancher_id, amount_ranch, tx_sig, burn_date, item_type) VALUES ($1, $2, $3, NOW()::date, $4)',
          [rancher.rows[0].id, totalCost, txSignature, itemType]
        ).catch(() => {});
      }
    } catch(e) {}

    // Notify TG
    try {
      const tg = require('../services/tgbot');
      const rancherName = await db.query('SELECT ranch_name FROM ranchers WHERE wallet = $1', [wallet]);
      const name = rancherName.rows[0]?.ranch_name || 'Unknown';
      tg.sendTg(`🔥 <b>FARM BURN</b>\n${name} burned ${totalCost.toLocaleString()} $RANCH\nBought: ${qty}x ${itemType}\n\n🌐 <a href="https://solranch.farm">solranch.farm</a>`).catch(() => {});
    } catch(e) {}

    res.json({
      success: true,
      item: itemType,
      quantity: qty,
      burned: totalCost,
      message: qty + 'x ' + itemType + ' added to inventory! ' + totalCost.toLocaleString() + ' $RANCH burned.',
    });
  } catch (err) {
    console.error('[FARM] Buy error:', err.message);
    res.status(500).json({ error: 'Purchase failed' });
  }
});

// ═══ POST /api/farm/place — Place item from inventory onto farm ═══
router.post('/place', async (req, res) => {
  try {
    const { wallet, itemCategory, itemType, tileX, tileY } = req.body;
    if (!wallet || !itemCategory || !itemType || tileX === undefined || tileY === undefined) {
      return res.status(400).json({ error: 'Missing fields' });
    }

    // Check inventory
    const inv = await db.query(
      'SELECT id, quantity FROM ranch_inventory WHERE wallet = $1 AND item_type = $2',
      [wallet, itemType]
    );
    if (!inv.rows.length || inv.rows[0].quantity < 1) {
      return res.status(400).json({ error: 'Not in inventory. Buy from shop first.' });
    }

    // Check tile is on unlocked land
    const chunkX = Math.floor(tileX / 8);
    const chunkY = Math.floor(tileY / 8);
    const startChunks = ['3,3', '3,4', '4,3', '4,4'];
    const chunkKey = chunkX + ',' + chunkY;
    if (!startChunks.includes(chunkKey)) {
      const owned = await db.query(
        'SELECT id FROM ranch_chunks WHERE wallet = $1 AND chunk_x = $2 AND chunk_y = $3',
        [wallet, chunkX, chunkY]
      );
      if (!owned.rows.length) return res.status(400).json({ error: 'Land not unlocked' });
    }

    // Place based on category
    if (itemCategory === 'building') {
      await db.query(
        'INSERT INTO ranch_buildings (wallet, building_type, tile_x, tile_y) VALUES ($1, $2, $3, $4)',
        [wallet, itemType, tileX, tileY]
      );
    } else if (itemCategory === 'animal') {
      await db.query(
        'INSERT INTO ranch_animals (wallet, animal_type, tile_x, tile_y) VALUES ($1, $2, $3, $4)',
        [wallet, itemType, tileX, tileY]
      );
    } else if (itemCategory === 'crop') {
      // Crops: calculate next stage time
      const cropInfo = await db.query('SELECT grow_minutes FROM crop_types WHERE name = $1', [itemType]);
      const growMin = cropInfo.rows[0]?.grow_minutes || 60;
      const stageMin = Math.floor(growMin / 5); // 5 growth stages
      await db.query(
        "INSERT INTO ranch_crops (wallet, crop_type, tile_x, tile_y, stage, planted_at, next_stage_at) VALUES ($1, $2, $3, $4, 0, NOW(), NOW() + ($5 || ' minutes')::interval)",
        [wallet, itemType, tileX, tileY, stageMin]
      );
    } else if (itemCategory === 'machine') {
      await db.query(
        'INSERT INTO ranch_machines (wallet, machine_type, tile_x, tile_y) VALUES ($1, $2, $3, $4)',
        [wallet, itemType, tileX, tileY]
      );
    } else if (itemCategory === 'deco') {
      await db.query(
        'INSERT INTO ranch_decorations (wallet, deco_type, tile_x, tile_y) VALUES ($1, $2, $3, $4)',
        [wallet, itemType, tileX, tileY]
      );
    }

    // Reduce inventory
    await db.query(
      'UPDATE ranch_inventory SET quantity = quantity - 1 WHERE wallet = $1 AND item_type = $2',
      [wallet, itemType]
    );
    // Clean up zero-quantity
    await db.query('DELETE FROM ranch_inventory WHERE wallet = $1 AND item_type = $2 AND quantity <= 0', [wallet, itemType]);

    res.json({ success: true, message: itemType + ' placed on farm!' });
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Tile already occupied' });
    console.error('[FARM] Place error:', err.message);
    res.status(500).json({ error: 'Placement failed' });
  }
});

// ═══ POST /api/farm/remove — Remove item from farm back to inventory ═══
router.post('/remove', async (req, res) => {
  try {
    const { wallet, itemCategory, itemId } = req.body;
    if (!wallet || !itemCategory || !itemId) return res.status(400).json({ error: 'Missing fields' });

    let itemType = null;

    if (itemCategory === 'building') {
      const r = await db.query('DELETE FROM ranch_buildings WHERE id = $1 AND wallet = $2 RETURNING building_type', [itemId, wallet]);
      if (r.rows.length) itemType = r.rows[0].building_type;
    } else if (itemCategory === 'animal') {
      const r = await db.query('DELETE FROM ranch_animals WHERE id = $1 AND wallet = $2 RETURNING animal_type', [itemId, wallet]);
      if (r.rows.length) itemType = r.rows[0].animal_type;
    } else if (itemCategory === 'crop') {
      // Crops are consumed, no return to inventory
      await db.query('DELETE FROM ranch_crops WHERE id = $1 AND wallet = $2', [itemId, wallet]);
      return res.json({ success: true, message: 'Crop removed (no refund)' });
    } else if (itemCategory === 'machine') {
      const r = await db.query('DELETE FROM ranch_machines WHERE id = $1 AND wallet = $2 RETURNING machine_type', [itemId, wallet]);
      if (r.rows.length) itemType = r.rows[0].machine_type;
    } else if (itemCategory === 'deco') {
      const r = await db.query('DELETE FROM ranch_decorations WHERE id = $1 AND wallet = $2 RETURNING deco_type', [itemId, wallet]);
      if (r.rows.length) itemType = r.rows[0].deco_type;
    }

    if (!itemType) return res.status(400).json({ error: 'Item not found' });

    // Return to inventory
    await db.query(
      `INSERT INTO ranch_inventory (wallet, item_category, item_type, quantity)
       VALUES ($1, $2, $3, 1)
       ON CONFLICT (wallet, item_type) DO UPDATE SET quantity = ranch_inventory.quantity + 1`,
      [wallet, itemCategory, itemType]
    );

    res.json({ success: true, message: itemType + ' returned to inventory' });
  } catch (err) {
    console.error('[FARM] Remove error:', err.message);
    res.status(500).json({ error: 'Remove failed' });
  }
});

// ═══ POST /api/farm/harvest — Harvest a mature crop ═══
router.post('/harvest', async (req, res) => {
  try {
    const { wallet, cropId } = req.body;
    if (!wallet || !cropId) return res.status(400).json({ error: 'Missing fields' });

    // Get crop
    const crop = await db.query(
      'SELECT c.id, c.crop_type, c.stage, c.planted_at, ct.grow_minutes, ct.harvest_pts FROM ranch_crops c JOIN crop_types ct ON ct.name = c.crop_type WHERE c.id = $1 AND c.wallet = $2',
      [cropId, wallet]
    );
    if (!crop.rows.length) return res.status(400).json({ error: 'Crop not found' });

    const c = crop.rows[0];
    const elapsed = (Date.now() - new Date(c.planted_at).getTime()) / 60000; // minutes
    if (elapsed < c.grow_minutes) {
      return res.status(400).json({ error: 'Not ready yet. ' + Math.ceil(c.grow_minutes - elapsed) + ' minutes remaining.' });
    }

    // Harvest: award points + remove crop
    const pts = parseFloat(c.harvest_pts);

    // Log points
    await db.query(
      'INSERT INTO ranch_points_log (wallet, source_category, source_type, points) VALUES ($1, $2, $3, $4)',
      [wallet, 'crop', c.crop_type + '_harvest', pts]
    );

    // Add to daily_points if table exists
    try {
      const rancher = await db.query('SELECT id FROM ranchers WHERE wallet = $1', [wallet]);
      if (rancher.rows.length) {
        const today = new Date().toISOString().split('T')[0];
        await db.query(
          'INSERT INTO daily_points (rancher_id, day_date, total_pts) VALUES ($1, $2, $3) ON CONFLICT (rancher_id, day_date) DO UPDATE SET total_pts = daily_points.total_pts + $3',
          [rancher.rows[0].id, today, pts]
        );
        await db.query('UPDATE ranchers SET lifetime_pts = lifetime_pts + $1 WHERE id = $2', [pts, rancher.rows[0].id]);
      }
    } catch(e) { console.error('[FARM] Points update error:', e.message); }

    // Remove crop (consumed)
    await db.query('DELETE FROM ranch_crops WHERE id = $1', [cropId]);

    res.json({
      success: true,
      crop: c.crop_type,
      points: pts,
      message: 'Harvested ' + c.crop_type + '! +' + pts + ' pts',
    });
  } catch (err) {
    console.error('[FARM] Harvest error:', err.message);
    res.status(500).json({ error: 'Harvest failed' });
  }
});

// ═══ POST /api/farm/feed — Feed all animals (daily, free) ═══
router.post('/feed', async (req, res) => {
  try {
    const { wallet } = req.body;
    if (!wallet) return res.status(400).json({ error: 'Missing wallet' });

    // Check if already fed in last 24h
    const recent = await db.query(
      "SELECT id FROM ranch_feed_log WHERE wallet = $1 AND fed_at > NOW() - INTERVAL '24 hours'",
      [wallet]
    );
    if (recent.rows.length) return res.json({ alreadyDone: true, message: 'Animals already fed today' });

    // Log feed
    await db.query('INSERT INTO ranch_feed_log (wallet) VALUES ($1)', [wallet]);

    // Update all animals last_fed_at
    await db.query('UPDATE ranch_animals SET last_fed_at = NOW() WHERE wallet = $1', [wallet]);

    res.json({ success: true, message: 'All animals fed! They will earn points today.' });
  } catch (err) {
    console.error('[FARM] Feed error:', err.message);
    res.status(500).json({ error: 'Feed failed' });
  }
});

// ═══ POST /api/farm/unlock — Unlock land chunk (burn $RANCH) ═══
router.post('/unlock', async (req, res) => {
  try {
    const { wallet, chunkX, chunkY, txSignature } = req.body;
    if (!wallet || chunkX === undefined || chunkY === undefined || !txSignature) {
      return res.status(400).json({ error: 'Missing fields' });
    }

    // Check not already owned
    const existing = await db.query(
      'SELECT id FROM ranch_chunks WHERE wallet = $1 AND chunk_x = $2 AND chunk_y = $3',
      [wallet, chunkX, chunkY]
    );
    if (existing.rows.length) return res.status(400).json({ error: 'Already unlocked' });

    // Calculate ring cost
    const d = Math.max(Math.abs(chunkX - 3.5), Math.abs(chunkY - 3.5));
    let ring = 1;
    if (d > 2) ring = 3;
    else if (d > 1) ring = 2;

    const costRow = await db.query('SELECT burn_cost FROM chunk_costs WHERE ring = $1', [ring]);
    if (!costRow.rows.length) return res.status(400).json({ error: 'Invalid chunk' });
    const cost = parseInt(costRow.rows[0].burn_cost);

    // Verify burn
    const verify = await verifyBurn(wallet, txSignature, cost);
    if (!verify.ok) return res.status(400).json({ error: verify.error });

    // Unlock
    await db.query(
      'INSERT INTO ranch_chunks (wallet, chunk_x, chunk_y, burn_tx, burn_amount) VALUES ($1, $2, $3, $4, $5)',
      [wallet, chunkX, chunkY, txSignature, cost]
    );

    res.json({
      success: true,
      chunk: chunkX + ',' + chunkY,
      burned: cost,
      message: 'Land unlocked! ' + cost.toLocaleString() + ' $RANCH burned.',
    });
  } catch (err) {
    console.error('[FARM] Unlock error:', err.message);
    res.status(500).json({ error: 'Unlock failed' });
  }
});

// ═══ GET /api/farm/points/:wallet — Daily farm points breakdown ═══
router.get('/points/:wallet', async (req, res) => {
  try {
    const { wallet } = req.params;

    // Check if animals fed today
    const fedCheck = await db.query(
      "SELECT id FROM ranch_feed_log WHERE wallet = $1 AND fed_at > NOW() - INTERVAL '24 hours'",
      [wallet]
    );
    const fedToday = fedCheck.rows.length > 0;

    // Count buildings
    const buildings = await db.query(
      `SELECT b.building_type, bt.burn_cost_base FROM ranch_buildings b 
       JOIN building_types bt ON bt.name = b.building_type WHERE b.wallet = $1`,
      [wallet]
    );
    let buildingPts = 0;
    buildings.rows.forEach(b => { buildingPts += parseInt(b.burn_cost_base) / 50000; });

    // Count animals (only if fed)
    const animals = await db.query(
      `SELECT a.animal_type, at.daily_pts FROM ranch_animals a 
       JOIN animal_types at ON at.name = a.animal_type WHERE a.wallet = $1`,
      [wallet]
    );
    let animalPts = 0;
    if (fedToday) { animals.rows.forEach(a => { animalPts += parseFloat(a.daily_pts); }); }

    // Count machines
    const machines = await db.query(
      `SELECT m.machine_type, mt.daily_pts FROM ranch_machines m 
       JOIN machine_types mt ON mt.name = m.machine_type WHERE m.wallet = $1`,
      [wallet]
    );
    let machinePts = 0;
    machines.rows.forEach(m => { machinePts += parseFloat(m.daily_pts); });

    // Count decos
    const decos = await db.query(
      `SELECT d.deco_type, dt.daily_pts FROM ranch_decorations d 
       JOIN deco_types dt ON dt.name = d.deco_type WHERE d.wallet = $1`,
      [wallet]
    );
    let decoPts = 0;
    decos.rows.forEach(d => { decoPts += parseFloat(d.daily_pts); });

    // Today's harvest points
    const today = new Date().toISOString().split('T')[0];
    const harvests = await db.query(
      "SELECT COALESCE(SUM(points), 0) as total FROM ranch_points_log WHERE wallet = $1 AND source_category = 'crop' AND earned_at::date = $2",
      [wallet, today]
    );
    const harvestPts = parseFloat(harvests.rows[0].total);

    const totalDaily = buildingPts + animalPts + machinePts + decoPts + harvestPts;

    res.json({
      buildingPts: Math.round(buildingPts * 10) / 10,
      animalPts: Math.round(animalPts * 10) / 10,
      machinePts: Math.round(machinePts * 10) / 10,
      decoPts: Math.round(decoPts * 10) / 10,
      harvestPts: Math.round(harvestPts * 10) / 10,
      totalDaily: Math.round(totalDaily * 10) / 10,
      fedToday,
      buildingCount: buildings.rows.length,
      animalCount: animals.rows.length,
      machineCount: machines.rows.length,
      decoCount: decos.rows.length,
    });
  } catch (err) {
    console.error('[FARM] Points error:', err.message);
    res.status(500).json({ error: 'Failed to calculate points' });
  }
});

module.exports = router;
