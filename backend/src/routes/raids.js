const express = require('express');
const router = express.Router();
const db = require('../db/init');
const { getRancher } = require('../services/points');
const { getHoldTier } = require('../services/holdingTiers');

const MIN_PTS_TO_RAID = 100;
const SHIELD_HOURS = 3;
const MIN_STEAL = 20;
const STEAL_PCT = 0.10;
const DEFENDER_BONUS = 25;
const FAIL_PENALTY = 100;

const RAID_TIERS = [
  { minTokens: 500000,  maxRaids: 3, label: 'Stockman' },
  { minTokens: 100000,  maxRaids: 2, label: 'Rancher' },
  { minTokens: 50000,   maxRaids: 1, label: 'Settler' },
];
const MIN_RAID_TOKENS = 50000;


function getRaidTier(balance) {
  for (const tier of RAID_TIERS) {
    if (balance >= tier.minTokens) return tier;
  }
  return null;
}

function calcSuccessChance(attackerTier, defenderTier, attackerStreak) {
  let chance = 0.55;
  chance += (attackerTier - defenderTier) * 0.05;
  chance += Math.min(attackerStreak * 0.01, 0.10);
  return Math.max(0.25, Math.min(0.80, chance));
}

router.post('/attack', async (req, res) => {
  try {
    const { wallet, targetWallet } = req.body;
    if (!wallet || !targetWallet) return res.status(400).json({ error: 'Wallet and target required' });
    if (wallet === targetWallet) return res.status(400).json({ error: "You can't raid your own ranch, partner" });

    const attacker = await getRancher(wallet);
    if (!attacker) return res.status(404).json({ error: 'Rancher not found' });
    const defender = await getRancher(targetWallet);
    if (!defender) return res.status(404).json({ error: 'Target ranch not found' });

    const today = new Date().toISOString().split('T')[0];

    if (attacker.lifetime_pts < MIN_PTS_TO_RAID) {
      return res.status(400).json({ error: 'Need at least ' + MIN_PTS_TO_RAID + ' lifetime pts to raid' });
    }

    const attackerSnap = await db.query(
      'SELECT balance FROM token_snapshots WHERE rancher_id = $1 ORDER BY day_date DESC LIMIT 1', [attacker.id]
    );
    const attackerBal = attackerSnap.rows.length > 0 ? parseFloat(attackerSnap.rows[0].balance) : 0;
    const raidTier = getRaidTier(attackerBal);

    if (!raidTier) {
      return res.status(400).json({
        error: 'Hold at least ' + MIN_RAID_TOKENS.toLocaleString() + ' $RANCH to raid. You have ' + Math.floor(attackerBal).toLocaleString(),
        needTokens: true
      });
    }
    const effectiveRaidTier = raidTier;

    const raidCount = await db.query(
      'SELECT COUNT(*) as cnt FROM ranch_raids WHERE attacker_id = $1 AND day_date = $2',
      [attacker.id, today]
    );
    if (parseInt(raidCount.rows[0].cnt) >= effectiveRaidTier.maxRaids) {
      const nextTier = RAID_TIERS.find(t => t.maxRaids > effectiveRaidTier.maxRaids);
      const upgradeMsg = nextTier ? ' Hold ' + nextTier.minTokens.toLocaleString() + '+ $RANCH for ' + nextTier.maxRaids + ' raids/day' : '';
      return res.status(400).json({ error: 'Max ' + effectiveRaidTier.maxRaids + ' raids/day at your tier.' + upgradeMsg });
    }

    const alreadyRaided = await db.query(
      'SELECT id FROM ranch_raids WHERE attacker_id = $1 AND defender_id = $2 AND day_date = $3',
      [attacker.id, defender.id, today]
    );
    if (alreadyRaided.rows.length > 0) {
      return res.status(400).json({ error: 'Already raided this ranch today' });
    }

    const shieldCheck = await db.query(
      "SELECT id FROM ranch_raids WHERE defender_id = $1 AND created_at > NOW() - INTERVAL '" + SHIELD_HOURS + " hours'",
      [defender.id]
    );
    if (shieldCheck.rows.length > 0) {
      return res.status(400).json({ error: 'This ranch has a shield active. Try another target' });
    }

    const defenderSnap = await db.query(
      'SELECT balance FROM token_snapshots WHERE rancher_id = $1 ORDER BY day_date DESC LIMIT 1', [defender.id]
    );
    const defenderBal = defenderSnap.rows.length > 0 ? parseFloat(defenderSnap.rows[0].balance) : 0;
    const attackerTier = getHoldTier(attackerBal).level || 0;
    const defenderTier = getHoldTier(defenderBal).level || 0;

    const chance = calcSuccessChance(attackerTier, defenderTier, attacker.current_streak);
    const roll = Math.random();
    const success = roll < chance;

    let ptsStolen = 0;
    let ptsLost = 0;
    let message = '';

    if (success) {
      const defPts = await db.query(
        'SELECT total_pts FROM daily_points WHERE rancher_id = $1 AND day_date = $2',
        [defender.id, today]
      );
      const defTodayPts = defPts.rows.length > 0 ? parseInt(defPts.rows[0].total_pts) : 0;
      ptsStolen = Math.max(MIN_STEAL, Math.floor(defTodayPts * STEAL_PCT));

      await db.query('INSERT INTO daily_points (rancher_id, day_date, rodeo_pts, total_pts) VALUES ($1, $2, $3, $4) ON CONFLICT (rancher_id, day_date) DO UPDATE SET rodeo_pts = daily_points.rodeo_pts + $3, total_pts = daily_points.total_pts + $4', [attacker.id, today, ptsStolen, ptsStolen]);
      await db.query('UPDATE ranchers SET lifetime_pts = lifetime_pts + $1 WHERE id = $2', [ptsStolen, attacker.id]);

      await db.query('UPDATE daily_points SET rodeo_pts = GREATEST(rodeo_pts - $1, 0), total_pts = GREATEST(total_pts - $1, 0) WHERE rancher_id = $2 AND day_date = $3', [ptsStolen, defender.id, today]);
      await db.query('UPDATE ranchers SET lifetime_pts = GREATEST(lifetime_pts - $1, 0) WHERE id = $2', [ptsStolen, defender.id]);

      message = 'Raid successful! Stole ' + ptsStolen + ' pts from ' + defender.ranch_name;
    } else {
      ptsLost = FAIL_PENALTY;

      await db.query('UPDATE daily_points SET rodeo_pts = GREATEST(rodeo_pts - $1, 0), total_pts = GREATEST(total_pts - $1, 0) WHERE rancher_id = $2 AND day_date = $3', [ptsLost, attacker.id, today]);
      await db.query('UPDATE ranchers SET lifetime_pts = GREATEST(lifetime_pts - $1, 0) WHERE id = $2', [ptsLost, attacker.id]);

      await db.query('INSERT INTO daily_points (rancher_id, day_date, rodeo_pts, total_pts) VALUES ($1, $2, $3, $4) ON CONFLICT (rancher_id, day_date) DO UPDATE SET rodeo_pts = daily_points.rodeo_pts + $3, total_pts = daily_points.total_pts + $4', [defender.id, today, DEFENDER_BONUS, DEFENDER_BONUS]);
      await db.query('UPDATE ranchers SET lifetime_pts = lifetime_pts + $1 WHERE id = $2', [DEFENDER_BONUS, defender.id]);

      message = 'Raid failed! ' + defender.ranch_name + ' fought back. You lost ' + ptsLost + ' pts';
    }

    await db.query(
      'INSERT INTO ranch_raids (attacker_id, defender_id, day_date, success, pts_stolen, pts_lost, attacker_tier, defender_tier) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
      [attacker.id, defender.id, today, success, ptsStolen, ptsLost, attackerTier, defenderTier]
    );

    console.log('[RAID] ' + attacker.ranch_name + ' -> ' + defender.ranch_name + ': ' + (success ? 'WIN +' + ptsStolen : 'LOSE -' + ptsLost));

    res.json({
      success, message, ptsStolen, ptsLost,
      chance: Math.round(chance * 100),
      raidTier: { maxRaids: effectiveRaidTier.maxRaids, label: effectiveRaidTier.label, balance: Math.floor(attackerBal) },
      attacker: { name: attacker.ranch_name, tier: attackerTier },
      defender: { name: defender.ranch_name, tier: defenderTier },
    });
  } catch (err) {
    console.error('[RAID] Error:', err.message);
    res.status(500).json({ error: 'Raid failed: ' + err.message });
  }
});

router.get('/:wallet/status', async (req, res) => {
  try {
    const rancher = await getRancher(req.params.wallet);
    if (!rancher) return res.json({ raidsToday: 0, maxRaids: 0, raidTier: null, recentRaids: [], raidedBy: [] });

    const today = new Date().toISOString().split('T')[0];

    const snap = await db.query(
      'SELECT balance FROM token_snapshots WHERE rancher_id = $1 ORDER BY day_date DESC LIMIT 1', [rancher.id]
    );
    const balance = snap.rows.length > 0 ? parseFloat(snap.rows[0].balance) : 0;
    const raidTier = getRaidTier(balance);

    const raidsToday = await db.query(
      'SELECT COUNT(*) as cnt FROM ranch_raids WHERE attacker_id = $1 AND day_date = $2',
      [rancher.id, today]
    );

    const recent = await db.query('SELECT rr.success, rr.pts_stolen, rr.pts_lost, rr.created_at, r.ranch_name as target_name, r.wallet as target_wallet FROM ranch_raids rr JOIN ranchers r ON r.id = rr.defender_id WHERE rr.attacker_id = $1 ORDER BY rr.created_at DESC LIMIT 10', [rancher.id]);

    const raidedBy = await db.query('SELECT rr.success, rr.pts_stolen, rr.pts_lost, rr.created_at, r.ranch_name as attacker_name, r.wallet as attacker_wallet FROM ranch_raids rr JOIN ranchers r ON r.id = rr.attacker_id WHERE rr.defender_id = $1 ORDER BY rr.created_at DESC LIMIT 10', [rancher.id]);

    const shield = await db.query("SELECT created_at FROM ranch_raids WHERE defender_id = $1 AND created_at > NOW() - INTERVAL '" + SHIELD_HOURS + " hours' ORDER BY created_at DESC LIMIT 1", [rancher.id]);
    const hasShield = shield.rows.length > 0;
    const shieldExpires = hasShield ? new Date(new Date(shield.rows[0].created_at).getTime() + SHIELD_HOURS * 3600000).toISOString() : null;

    const nextRaidTier = raidTier ? RAID_TIERS.find(t => t.maxRaids > raidTier.maxRaids) || null : RAID_TIERS[RAID_TIERS.length - 1];

    res.json({
      raidsToday: parseInt(raidsToday.rows[0].cnt),
      maxRaids: raidTier ? raidTier.maxRaids : 0,
      raidTier: raidTier ? { label: raidTier.label, maxRaids: raidTier.maxRaids, minTokens: raidTier.minTokens } : null,
      nextRaidTier: nextRaidTier ? { label: nextRaidTier.label, maxRaids: nextRaidTier.maxRaids, minTokens: nextRaidTier.minTokens } : null,
      ranchBalance: Math.floor(balance),
      hasShield, shieldExpires,
      recentRaids: recent.rows,
      raidedBy: raidedBy.rows,
    });
  } catch (err) {
    console.error('[RAID] Status error:', err.message);
    res.json({ raidsToday: 0, maxRaids: 0, raidTier: null, recentRaids: [], raidedBy: [] });
  }
});

router.get('/targets/list', async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const targets = await db.query('SELECT r.wallet, r.ranch_name, r.rank_level, COALESCE(dp.total_pts, 0) as today_pts, COALESCE(ts.balance, 0) as token_balance FROM ranchers r LEFT JOIN daily_points dp ON dp.rancher_id = r.id AND dp.day_date = $1 LEFT JOIN token_snapshots ts ON ts.rancher_id = r.id AND ts.day_date = $1 WHERE COALESCE(dp.total_pts, 0) > 0 ORDER BY dp.total_pts DESC LIMIT 30', [today]);

    const result = targets.rows.map(r => {
      const tier = getHoldTier(parseFloat(r.token_balance) || 0);
      return { wallet: r.wallet, ranch_name: r.ranch_name, rank_level: r.rank_level, today_pts: parseInt(r.today_pts), hold_tier: tier.name, hold_level: tier.level };
    });
    res.json({ targets: result });
  } catch (err) {
    console.error('[RAID] Targets error:', err.message);
    res.json({ targets: [] });
  }
});

module.exports = router;
