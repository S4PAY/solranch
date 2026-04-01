const express = require('express');
const router = express.Router();
const db = require('../db/init');
const { getRancher, getRankForPoints, getStreakMult } = require('../services/points');
const { verifyBurnTx, isTxUsed, BURN_ADDRESS } = require('../services/verifyBurn');

// ═══════════════════════════════════════
// FULL PEN CONFIG — ORIGINAL SPEC
// ═══════════════════════════════════════
const PEN_CONFIG = {
  cattle: {
    name: 'Cattle Ranch', icon: '🐄', minBalance: 50000, healthDecayPerDay: 15,
    tasks: {
      milk:       { name: 'Milk Run',      pts: 12, cooldownHrs: 8,  healthRestore: 0,  desc: 'Milk the herd. Fresh dairy earns premium points. Every 8 hours.' },
      brand:      { name: 'Brand Cattle',  pts: 20, cooldownHrs: 24, healthRestore: 0,  desc: 'Mark your herd with the ranch brand. Shows ownership, earns respect.' },
      herd_count: { name: 'Herd Count',    pts: 15, cooldownHrs: 24, healthRestore: 25, desc: 'Count the herd and check for strays. Restores pen health.' },
    },
    special: { name: 'Bull Sale', type: 'burn_weekly', burnCost: 50000, reward: 500, cooldownHrs: 168, desc: 'Auction your prized bull. Burn 50k $RANCH for 500 bonus pts. Once per week.' }
  },
  chicken: {
    name: 'Chicken Coop', icon: '🐔', minBalance: 100000, healthDecayPerDay: 15,
    tasks: {
      feed:         { name: 'Scatter Feed',  pts: 8,  cooldownHrs: 24, healthRestore: 25, desc: 'Toss grain across the yard. Keep the flock fed and happy.' },
      collect_eggs: { name: 'Collect Eggs',  pts: 10, cooldownHrs: 8,  healthRestore: 0,  desc: 'Check the nesting boxes. More eggs, more points. Every 8 hours.' },
      clean:        { name: 'Clean Coop',    pts: 15, cooldownHrs: 24, healthRestore: 20, desc: 'Shovel out the coop. Clean chickens lay better eggs.' },
    },
    special: { name: 'Golden Egg', type: 'random_bonus', chance: 0.01, reward: 200, desc: '1% chance when collecting eggs. Strike gold for +200 bonus pts.' }
  },
  horse: {
    name: 'Horse Stable', icon: '🐴', minBalance: 250000, healthDecayPerDay: 15,
    tasks: {
      feed: { name: 'Feed & Brush',  pts: 12, cooldownHrs: 24, healthRestore: 25, desc: 'Oats and a good brushing. A groomed horse is a fast horse.' },
      ride: { name: 'Ride Out',      pts: 20, cooldownHrs: 24, healthRestore: 0,  desc: 'Saddle up and ride the range. Gives +15% raid success for 12 hours.' },
      shoe: { name: 'Shoe Horse',    pts: 15, cooldownHrs: 24, healthRestore: 20, desc: 'Hammer fresh shoes. Good hooves keep the stable healthy.' },
    },
    special: { name: 'Horse Race', type: 'weekly_event', desc: 'Weekly race event. Top 3 riders earn bonus USDC from the treasury.' }
  },
  sheep: {
    name: 'Sheep Pen', icon: '🐑', minBalance: 500000, healthDecayPerDay: 15,
    tasks: {
      feed:  { name: 'Feed Flock',   pts: 10, cooldownHrs: 24, healthRestore: 25, desc: 'Spread hay across the pen. A well-fed flock grows thick wool.' },
      shear: { name: 'Shear Wool',   pts: 25, cooldownHrs: 24, healthRestore: 0,  desc: 'Clip the fleece. Premium wool brings premium points.' },
      watch: { name: 'Night Watch',  pts: 15, cooldownHrs: 24, healthRestore: 0,  desc: 'Guard the flock overnight. Wolves never sleep and neither do you.' },
    },
    special: { name: 'Wool Market', type: 'weekly_accumulate', desc: 'Wool accumulates all week from shearing. Sell at market on Sunday for bonus pts.' }
  },
  pig: {
    name: 'Pig Sty', icon: '🐷', minBalance: 1000000, healthDecayPerDay: 15,
    tasks: {
      feed:  { name: 'Slop Bucket',  pts: 15, cooldownHrs: 24, healthRestore: 25, desc: 'Dump the slop. Pigs eat anything and love every bite.' },
      smoke: { name: 'Smoke House',  pts: 30, cooldownHrs: 24, healthRestore: 0,  desc: 'Cure the meat low and slow. Smoked bacon is liquid gold on the ranch.' },
      mud:   { name: 'Mud Bath',     pts: 10, cooldownHrs: 24, healthRestore: 40, desc: 'Let them roll in the mud. Happy pigs stay healthy pigs.' },
    },
    special: { name: 'Truffle Hunt', type: 'daily_random', minReward: 50, maxReward: 500, cooldownHrs: 24, desc: 'Send your pig out to hunt. Random reward between 50-500 pts daily.' }
  }
};

const SUPPLY_SHOP = {
  vitamin:        { name: 'Vitamin Pack',    healthRestore: 50,  burnCost: 5000,   applyTo: 'single', desc: 'Instant +50% health to any pen. Burns 5k $RANCH.' },
  super_feed:     { name: 'Super Feed',      healthRestore: 100, burnCost: 15000,  applyTo: 'single', desc: 'Full heal one pen to 100%. Burns 15k $RANCH.' },
  vet_visit:      { name: 'Vet Visit',       healthRestore: 100, burnCost: 50000,  applyTo: 'all',    desc: 'Full heal ALL pens. Burns 50k $RANCH.' },
  growth_hormone: { name: 'Growth Hormone',  healthRestore: 0,   burnCost: 25000,  applyTo: 'single', desc: '2x points from one pen for 24 hours. Burns 25k $RANCH.', effect: '2x_points_24h' },
  fence_upgrade:  { name: 'Fence Upgrade',   healthRestore: 0,   burnCost: 100000, applyTo: 'all',    desc: 'Half health decay for 7 days across all pens. Burns 100k $RANCH.', effect: 'half_decay_7d' },
};

// ═══════════════════════════════════════
// GET /pens/:wallet — all pens status
// ═══════════════════════════════════════
router.get('/:wallet', async (req, res) => {
  try {
    const rancher = await getRancher(req.params.wallet);
    if (!rancher) return res.json({ pens: [], balance: 0, shop: SUPPLY_SHOP });

    const snap = await db.query('SELECT balance FROM token_snapshots WHERE rancher_id = $1 AND day_date = CURRENT_DATE', [rancher.id]);
    const balance = snap.rows.length > 0 ? parseInt(snap.rows[0].balance) : 0;

    const pens = await db.query('SELECT pen_type, health, unlocked_at FROM animal_pens WHERE rancher_id = $1', [rancher.id]);
    const unlockedPens = {};
    pens.rows.forEach(p => { unlockedPens[p.pen_type] = { health: p.health, unlocked_at: p.unlocked_at }; });

    const tasks = await db.query(
      "SELECT pen_type, task_type, completed_at FROM pen_tasks WHERE rancher_id = $1 AND completed_at > NOW() - INTERVAL '168 hours' ORDER BY completed_at DESC",
      [rancher.id]
    );

    // Check active buffs
    const buffs = await db.query(
      "SELECT item_type, pen_type, created_at FROM supply_purchases WHERE rancher_id = $1 AND created_at > NOW() - INTERVAL '7 days' ORDER BY created_at DESC",
      [rancher.id]
    );
    const activeBuffs = {};
    buffs.rows.forEach(b => {
      if (b.item_type === 'growth_hormone') {
        const elapsed = (Date.now() - new Date(b.created_at).getTime()) / (1000 * 60 * 60);
        if (elapsed < 24) activeBuffs[b.pen_type + '_2x'] = true;
      }
      if (b.item_type === 'fence_upgrade') {
        const elapsed = (Date.now() - new Date(b.created_at).getTime()) / (1000 * 60 * 60);
        if (elapsed < 168) activeBuffs['half_decay'] = true;
      }
    });

    const penList = [];
    for (const [penType, config] of Object.entries(PEN_CONFIG)) {
      const unlocked = !!unlockedPens[penType];
      const canUnlock = balance >= config.minBalance;
      const health = unlocked ? unlockedPens[penType].health : 0;
      const has2x = activeBuffs[penType + '_2x'] || false;

      const taskStatus = {};
      for (const [taskId, taskConfig] of Object.entries(config.tasks)) {
        const lastDone = tasks.rows.find(t => t.pen_type === penType && t.task_type === taskId);
        let available = true;
        let cooldownLeft = 0;
        if (lastDone) {
          const elapsed = (Date.now() - new Date(lastDone.completed_at).getTime()) / (1000 * 60 * 60);
          if (elapsed < taskConfig.cooldownHrs) {
            available = false;
            cooldownLeft = Math.ceil(taskConfig.cooldownHrs - elapsed);
          }
        }
        const healthMult = (unlocked && health < 50) ? 0.5 : 1;
        const buffMult = has2x ? 2 : 1;

        taskStatus[taskId] = {
          name: taskConfig.name,
          desc: taskConfig.desc || '',
          basePts: taskConfig.pts,
          effectivePts: Math.floor(taskConfig.pts * healthMult * buffMult),
          cooldownHrs: taskConfig.cooldownHrs,
          cooldownLeft,
          available: unlocked && available,
          healthRestore: taskConfig.healthRestore,
          healthMult,
          buffMult,
        };
      }

      // Special task status
      let specialStatus = null;
      if (config.special && unlocked) {
        const spec = config.special;
        specialStatus = { ...spec };

        if (spec.type === 'burn_weekly') {
          const lastSpecial = tasks.rows.find(t => t.pen_type === penType && t.task_type === 'special');
          let specAvailable = true;
          let specCooldown = 0;
          if (lastSpecial) {
            const elapsed = (Date.now() - new Date(lastSpecial.completed_at).getTime()) / (1000 * 60 * 60);
            if (elapsed < spec.cooldownHrs) { specAvailable = false; specCooldown = Math.ceil(spec.cooldownHrs - elapsed); }
          }
          specialStatus.available = specAvailable;
          specialStatus.cooldownLeft = specCooldown;
        } else if (spec.type === 'daily_random') {
          const lastSpecial = tasks.rows.find(t => t.pen_type === penType && t.task_type === 'special');
          let specAvailable = true;
          let specCooldown = 0;
          if (lastSpecial) {
            const elapsed = (Date.now() - new Date(lastSpecial.completed_at).getTime()) / (1000 * 60 * 60);
            if (elapsed < spec.cooldownHrs) { specAvailable = false; specCooldown = Math.ceil(spec.cooldownHrs - elapsed); }
          }
          specialStatus.available = specAvailable;
          specialStatus.cooldownLeft = specCooldown;
        } else if (spec.type === 'random_bonus') {
          specialStatus.available = false; // triggered automatically on egg collect
          specialStatus.passive = true;
        } else if (spec.type === 'weekly_event' || spec.type === 'weekly_accumulate') {
          specialStatus.available = false;
          specialStatus.comingSoon = true;
        }
      }

      penList.push({
        type: penType,
        name: config.name,
        icon: config.icon,
        minBalance: config.minBalance,
        unlocked,
        canUnlock: !unlocked && canUnlock,
        health,
        maxHealth: 100,
        tasks: taskStatus,
        special: specialStatus,
        has2x,
        halfDecay: activeBuffs['half_decay'] || false,
      });
    }

    res.json({ pens: penList, balance, shop: SUPPLY_SHOP });
  } catch (err) {
    console.error('[PENS] Error:', err.message);
    res.status(500).json({ error: 'Failed' });
  }
});

// ═══════════════════════════════════════
// POST /pens/unlock
// ═══════════════════════════════════════
router.post('/unlock', async (req, res) => {
  try {
    const { wallet, penType } = req.body;
    if (!wallet || !penType) return res.status(400).json({ error: 'Missing fields' });
    const config = PEN_CONFIG[penType];
    if (!config) return res.status(400).json({ error: 'Invalid pen type' });
    const rancher = await getRancher(wallet);
    if (!rancher) return res.status(404).json({ error: 'Rancher not found' });

    const snap = await db.query('SELECT balance FROM token_snapshots WHERE rancher_id = $1 AND day_date = CURRENT_DATE', [rancher.id]);
    const balance = snap.rows.length > 0 ? parseInt(snap.rows[0].balance) : 0;
    if (balance < config.minBalance) return res.status(400).json({ error: 'Need ' + config.minBalance.toLocaleString() + ' $RANCH to unlock ' + config.name });

    const existing = await db.query('SELECT id FROM animal_pens WHERE rancher_id = $1 AND pen_type = $2', [rancher.id, penType]);
    if (existing.rows.length > 0) return res.json({ alreadyUnlocked: true });

    await db.query('INSERT INTO animal_pens (rancher_id, pen_type, health) VALUES ($1, $2, 100)', [rancher.id, penType]);
    console.log('[PENS] ' + wallet.slice(0,8) + '... unlocked ' + config.name);
    res.json({ success: true, pen: penType, name: config.name });
  } catch (err) {
    if (err.code === '23505') return res.json({ alreadyUnlocked: true });
    console.error('[PENS] Unlock error:', err.message);
    res.status(500).json({ error: 'Failed' });
  }
});

// ═══════════════════════════════════════
// POST /pens/task — complete a pen task
// ═══════════════════════════════════════
router.post('/task', async (req, res) => {
  try {
    const { wallet, penType, taskType } = req.body;
    if (!wallet || !penType || !taskType) return res.status(400).json({ error: 'Missing fields' });
    const config = PEN_CONFIG[penType];
    if (!config) return res.status(400).json({ error: 'Invalid pen' });
    const taskConfig = config.tasks[taskType];
    if (!taskConfig) return res.status(400).json({ error: 'Invalid task' });

    const rancher = await getRancher(wallet);
    if (!rancher) return res.status(404).json({ error: 'Not found' });

    const pen = await db.query('SELECT id, health FROM animal_pens WHERE rancher_id = $1 AND pen_type = $2', [rancher.id, penType]);
    if (pen.rows.length === 0) return res.status(400).json({ error: 'Pen not unlocked' });
    const currentHealth = pen.rows[0].health;

    // Cooldown check
    const lastDone = await db.query(
      "SELECT completed_at FROM pen_tasks WHERE rancher_id = $1 AND pen_type = $2 AND task_type = $3 ORDER BY completed_at DESC LIMIT 1",
      [rancher.id, penType, taskType]
    );
    if (lastDone.rows.length > 0) {
      const elapsed = (Date.now() - new Date(lastDone.rows[0].completed_at).getTime()) / (1000 * 60 * 60);
      if (elapsed < taskConfig.cooldownHrs) {
        return res.status(400).json({ error: Math.ceil(taskConfig.cooldownHrs - elapsed) + 'h cooldown remaining' });
      }
    }

    // Calculate points
    const healthMult = currentHealth < 50 ? 0.5 : 1;
    const rank = getRankForPoints(rancher.lifetime_pts);
    const streakMult = getStreakMult(rancher.current_streak);

    // Check 2x buff
    const buff = await db.query(
      "SELECT id FROM supply_purchases WHERE rancher_id = $1 AND item_type = 'growth_hormone' AND pen_type = $2 AND created_at > NOW() - INTERVAL '24 hours'",
      [rancher.id, penType]
    );
    const buffMult = buff.rows.length > 0 ? 2 : 1;

    const basePts = Math.floor(taskConfig.pts * healthMult * buffMult);
    const totalPts = Math.floor(basePts * streakMult * rank.mult);

    // Log task
    await db.query('INSERT INTO pen_tasks (rancher_id, pen_type, task_type, points_earned, day_date) VALUES ($1, $2, $3, $4, CURRENT_DATE)',
      [rancher.id, penType, taskType, totalPts]);

    // Update health
    let newHealth = currentHealth;
    if (taskConfig.healthRestore > 0) {
      newHealth = Math.min(100, currentHealth + taskConfig.healthRestore);
      await db.query('UPDATE animal_pens SET health = $1 WHERE rancher_id = $2 AND pen_type = $3', [newHealth, rancher.id, penType]);
    }

    // Add to daily_points
    const today = new Date().toISOString().split('T')[0];
    await db.query(`
      INSERT INTO daily_points (rancher_id, day_date, pen_pts, streak_mult, rank_mult, total_pts)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (rancher_id, day_date)
      DO UPDATE SET pen_pts = daily_points.pen_pts + $3, total_pts = daily_points.total_pts + $6
    `, [rancher.id, today, totalPts, streakMult, rank.mult, totalPts]);

    await db.query('UPDATE ranchers SET lifetime_pts = lifetime_pts + $1, updated_at = NOW() WHERE id = $2', [totalPts, rancher.id]);

    // Golden Egg check (chicken coop, collect_eggs)
    let goldenEgg = false;
    if (penType === 'chicken' && taskType === 'collect_eggs') {
      if (Math.random() < 0.01) {
        goldenEgg = true;
        const bonusPts = Math.floor(200 * streakMult * rank.mult);
        await db.query(`
          INSERT INTO daily_points (rancher_id, day_date, pen_pts, total_pts) VALUES ($1, $2, $3, $4)
          ON CONFLICT (rancher_id, day_date) DO UPDATE SET pen_pts = daily_points.pen_pts + $3, total_pts = daily_points.total_pts + $4
        `, [rancher.id, today, bonusPts, bonusPts]);
        await db.query('UPDATE ranchers SET lifetime_pts = lifetime_pts + $1 WHERE id = $2', [bonusPts, rancher.id]);
        console.log('[PENS] 🥚 GOLDEN EGG! ' + wallet.slice(0,8) + '... +' + bonusPts + ' bonus pts!');
      }
    }

    console.log('[PENS] ' + wallet.slice(0,8) + '... ' + taskConfig.name + ' +' + totalPts + ' pts (HP: ' + newHealth + '%)');

    res.json({
      success: true, task: taskConfig.name, pointsEarned: totalPts,
      basePts, healthMult, buffMult, newHealth, goldenEgg,
      goldenEggMsg: goldenEgg ? '🥚 GOLDEN EGG! +200 bonus pts!' : null,
    });
  } catch (err) {
    console.error('[PENS] Task error:', err.message);
    res.status(500).json({ error: 'Failed' });
  }
});

// ═══════════════════════════════════════
// POST /pens/special — execute special task
// ═══════════════════════════════════════
router.post('/special', async (req, res) => {
  try {
    const { wallet, penType } = req.body;
    if (!wallet || !penType) return res.status(400).json({ error: 'Missing fields' });
    const config = PEN_CONFIG[penType];
    if (!config || !config.special) return res.status(400).json({ error: 'No special for this pen' });

    const rancher = await getRancher(wallet);
    if (!rancher) return res.status(404).json({ error: 'Not found' });

    const pen = await db.query('SELECT id FROM animal_pens WHERE rancher_id = $1 AND pen_type = $2', [rancher.id, penType]);
    if (pen.rows.length === 0) return res.status(400).json({ error: 'Pen not unlocked' });

    const spec = config.special;
    const rank = getRankForPoints(rancher.lifetime_pts);
    const streakMult = getStreakMult(rancher.current_streak);
    const today = new Date().toISOString().split('T')[0];

    // Cooldown check
    if (spec.cooldownHrs) {
      const lastSpecial = await db.query(
        "SELECT completed_at FROM pen_tasks WHERE rancher_id = $1 AND pen_type = $2 AND task_type = 'special' ORDER BY completed_at DESC LIMIT 1",
        [rancher.id, penType]
      );
      if (lastSpecial.rows.length > 0) {
        const elapsed = (Date.now() - new Date(lastSpecial.rows[0].completed_at).getTime()) / (1000 * 60 * 60);
        if (elapsed < spec.cooldownHrs) {
          return res.status(400).json({ error: Math.ceil(spec.cooldownHrs - elapsed) + 'h cooldown remaining' });
        }
      }
    }

    let reward = 0;
    let message = '';

    if (spec.type === 'burn_weekly') {
      // Bull Sale: requires verified burn TX
      const { txSignature } = req.body;
      if (!txSignature) return res.status(400).json({ error: 'Bull Sale requires burning ' + spec.burnCost.toLocaleString() + ' $RANCH. Burn to: 1nc1nerator11111111111111111111111111111111 then paste TX.' });

      // Check TX not already used
      if (await isTxUsed(db, txSignature)) {
        return res.status(400).json({ error: 'This transaction was already used.' });
      }

      // Verify burn on-chain
      try {
        const verification = await verifyBurnTx(txSignature, wallet, spec.burnCost);
        if (!verification.verified) return res.status(400).json({ error: 'Burn verification failed.' });
        console.log('[PENS] Bull Sale verified: ' + verification.amount.toLocaleString() + ' $RANCH burned');
      } catch (verifyErr) {
        return res.status(400).json({ error: verifyErr.message });
      }

      reward = Math.floor(spec.reward * streakMult * rank.mult);
      message = spec.name + '! +' + reward + ' pts (verified burn: ' + spec.burnCost.toLocaleString() + ' $RANCH)';

      // Log burn TX to prevent reuse
      await db.query('INSERT INTO supply_purchases (rancher_id, item_type, pen_type, ranch_burned, tx_sig) VALUES ($1, $2, $3, $4, $5)',
        [rancher.id, 'bull_sale', penType, spec.burnCost, txSignature]).catch(() => {});

      // Log to burn_log
      await db.query('INSERT INTO burn_log (burn_date, amount_ranch, tx_sig, notes) VALUES (CURRENT_DATE, $1, $2, $3)',
        [spec.burnCost, txSignature, 'Bull Sale by ' + wallet.slice(0,8)]).catch(() => {});

    } else if (spec.type === 'daily_random') {
      // Truffle Hunt: random 50-500 pts
      const baseReward = spec.minReward + Math.floor(Math.random() * (spec.maxReward - spec.minReward));
      reward = Math.floor(baseReward * streakMult * rank.mult);
      message = spec.name + '! Your pig found +' + reward + ' pts!';
    }

    if (reward > 0) {
      await db.query('INSERT INTO pen_tasks (rancher_id, pen_type, task_type, points_earned, day_date) VALUES ($1, $2, $3, $4, CURRENT_DATE)',
        [rancher.id, penType, 'special', reward]);
      await db.query(`
        INSERT INTO daily_points (rancher_id, day_date, pen_pts, total_pts) VALUES ($1, $2, $3, $4)
        ON CONFLICT (rancher_id, day_date) DO UPDATE SET pen_pts = daily_points.pen_pts + $3, total_pts = daily_points.total_pts + $4
      `, [rancher.id, today, reward, reward]);
      await db.query('UPDATE ranchers SET lifetime_pts = lifetime_pts + $1 WHERE id = $2', [reward, rancher.id]);
      console.log('[PENS] SPECIAL: ' + wallet.slice(0,8) + '... ' + message);
    }

    res.json({ success: true, reward, message, specialName: spec.name });
  } catch (err) {
    console.error('[PENS] Special error:', err.message);
    res.status(500).json({ error: 'Failed' });
  }
});

// ═══════════════════════════════════════
// POST /pens/supply — buy supply (burn $RANCH)
// ═══════════════════════════════════════
// GET burn address for frontend
router.get('/burn-address', (req, res) => {
  res.json({ burnAddress: BURN_ADDRESS });
});

router.post('/supply', async (req, res) => {
  try {
    const { wallet, itemType, penType, txSignature } = req.body;
    if (!wallet || !itemType || !txSignature) return res.status(400).json({ error: 'Missing fields. Burn $RANCH first, then submit TX signature.' });
    const item = SUPPLY_SHOP[itemType];
    if (!item) return res.status(400).json({ error: 'Invalid item' });

    const rancher = await getRancher(wallet);
    if (!rancher) return res.status(404).json({ error: 'Not found' });

    // Check TX not already used
    if (await isTxUsed(db, txSignature)) {
      return res.status(400).json({ error: 'This transaction was already used for a purchase.' });
    }

    // Verify the burn on-chain
    console.log('[SUPPLY] Verifying burn TX: ' + txSignature.slice(0,16) + '...');
    let verification;
    try {
      verification = await verifyBurnTx(txSignature, wallet, item.burnCost);
    } catch (verifyErr) {
      return res.status(400).json({ error: verifyErr.message });
    }

    if (!verification.verified) {
      return res.status(400).json({ error: 'Burn verification failed' });
    }

    console.log('[SUPPLY] Verified! ' + verification.amount.toLocaleString() + ' $RANCH burned by ' + wallet.slice(0,8));

    // Apply health
    if (item.applyTo === 'single') {
      if (!penType) return res.status(400).json({ error: 'Specify which pen' });
      if (item.healthRestore > 0) {
        await db.query('UPDATE animal_pens SET health = LEAST(100, health + $1) WHERE rancher_id = $2 AND pen_type = $3', [item.healthRestore, rancher.id, penType]);
      }
    } else {
      if (item.healthRestore > 0) {
        await db.query('UPDATE animal_pens SET health = LEAST(100, health + $1) WHERE rancher_id = $2', [item.healthRestore, rancher.id]);
      }
    }

    // Log purchase with TX sig (prevents double-use)
    await db.query('INSERT INTO supply_purchases (rancher_id, item_type, pen_type, ranch_burned, tx_sig) VALUES ($1, $2, $3, $4, $5)',
      [rancher.id, itemType, penType || null, item.burnCost, txSignature]);

    // Log as burn
    await db.query(
      'INSERT INTO burn_log (burn_date, amount_ranch, tx_sig, notes) VALUES (CURRENT_DATE, $1, $2, $3)',
      [item.burnCost, txSignature, 'Supply Shop: ' + item.name + ' by ' + wallet.slice(0,8)]
    ).catch(() => {});

    console.log('[SUPPLY] ' + wallet.slice(0,8) + '... bought ' + item.name + ' (verified burn: ' + item.burnCost.toLocaleString() + ' $RANCH)');
    res.json({ success: true, item: item.name, burnCost: item.burnCost, desc: item.desc, verified: true });
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'This transaction was already used.' });
    console.error('[SUPPLY] Error:', err.message);
    res.status(500).json({ error: 'Failed' });
  }
});

// ═══════════════════════════════════════
// GET /pens/shop — supply shop items
// ═══════════════════════════════════════
router.get('/shop/items', async (req, res) => {
  res.json(SUPPLY_SHOP);
});

module.exports = router;
