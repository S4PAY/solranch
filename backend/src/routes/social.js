const express = require('express');
const router = express.Router();
const db = require('../db/init');
const { getRancher, getRankForPoints, getStreakMult } = require('../services/points');

const TASKS = {
  retweet: { pts: 15, daily: true, needsUrl: true, label: 'Retweet' },
  reply: { pts: 20, daily: true, needsUrl: true, label: 'Reply' },
  quote: { pts: 25, daily: true, needsUrl: true, label: 'Quote Tweet' },
  follow: { pts: 50, daily: false, needsUrl: false, label: 'Follow' },
};

function isValidTweetUrl(url) {
  const pattern = /^https?:\/\/(x\.com|twitter\.com)\/[a-zA-Z0-9_]+\/status\/(\d+)/;
  return pattern.test(url);
}

function getTweetTimestamp(url) {
  const match = url.match(/status\/(\d+)/);
  if (!match) return null;
  // Twitter snowflake: (id >> 22) + 1288834974657
  const id = BigInt(match[1]);
  const timestamp = Number((id >> 22n) + 1288834974657n);
  return new Date(timestamp);
}

function isRecentTweet(url, hoursAgo = 168) {
  const ts = getTweetTimestamp(url);
  if (!ts) return false;
  const cutoff = new Date(Date.now() - hoursAgo * 60 * 60 * 1000);
  return ts > cutoff;
}

async function verifyTweetExists(url) {
  try {
    const oembedUrl = 'https://publish.twitter.com/oembed?url=' + encodeURIComponent(url) + '&omit_script=true';
    const resp = await fetch(oembedUrl, { signal: AbortSignal.timeout(5000) });
    if (!resp.ok) return { exists: false, html: '' };
    const data = await resp.json();
    return { exists: true, html: data.html || '', author: data.author_name || '' };
  } catch (e) {
    console.log('[SOCIAL] Tweet verify failed:', e.message);
    return { exists: false, html: '' };
  }
}

// POST /api/social/:taskType
// Body: { wallet, proofUrl?, xHandle? }
router.post('/:taskType', async (req, res) => {
  try {
    const { taskType } = req.params;
    const { wallet, proofUrl, xHandle } = req.body;
    
    const task = TASKS[taskType];
    if (!task) return res.status(400).json({ error: 'Invalid task type' });
    if (!wallet) return res.status(400).json({ error: 'Wallet required' });
    
    const rancher = await getRancher(wallet);
    if (!rancher) return res.status(404).json({ error: 'Rancher not found' });
    
    const today = new Date().toISOString().split('T')[0];
    
    // Follow is one-time
    if (taskType === 'follow') {
      if (!xHandle || xHandle.length < 2) return res.status(400).json({ error: 'X handle required' });
      
      const cleanHandle = xHandle.replace('@', '').trim().toLowerCase();
      
      // Check if already followed (ever)
      const existing = await db.query(
        "SELECT id FROM social_engagements WHERE rancher_id = $1 AND task_type = 'follow'",
        [rancher.id]
      );
      if (existing.rows.length > 0) return res.json({ alreadyDone: true });
      
      // Check if this X handle is already used by another wallet
      const handleUsed = await db.query(
        "SELECT id FROM social_engagements WHERE x_handle = $1 AND task_type = 'follow' AND rancher_id != $2",
        [cleanHandle, rancher.id]
      );
      if (handleUsed.rows.length > 0) return res.status(400).json({ error: 'This X account is already linked to another ranch' });
      
      // Award points
      const rank = getRankForPoints(rancher.lifetime_pts);
      const streakMult = getStreakMult(rancher.current_streak);
      const totalPts = Math.floor(task.pts * streakMult * rank.mult);
      
      await db.query(
        "INSERT INTO social_engagements (rancher_id, day_date, task_type, x_handle, pts_awarded) VALUES ($1, $2, $3, $4, $5)",
        [rancher.id, today, 'follow', cleanHandle, totalPts]
      );
      
      await db.query(`
        INSERT INTO daily_points (rancher_id, day_date, social_pts, streak_mult, rank_mult, total_pts)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (rancher_id, day_date)
        DO UPDATE SET social_pts = daily_points.social_pts + $3, total_pts = daily_points.total_pts + $6
      `, [rancher.id, today, totalPts, streakMult, rank.mult, totalPts]);
      
      await db.query('UPDATE ranchers SET lifetime_pts = lifetime_pts + $1, updated_at = NOW() WHERE id = $2', [totalPts, rancher.id]);
      
      return res.json({ pointsEarned: totalPts, message: 'Follow verified! +' + totalPts + ' pts' });
    }
    
    // Daily tasks (retweet, reply, quote)
    if (!proofUrl) return res.status(400).json({ error: 'Tweet URL required' });
    if (!isValidTweetUrl(proofUrl)) return res.status(400).json({ error: 'Invalid tweet URL. Must be x.com or twitter.com link' });
    
    // Verify tweet actually exists
    const verified = await verifyTweetExists(proofUrl);
    if (!verified.exists) return res.status(400).json({ error: 'Tweet not found. Make sure the URL is correct and the tweet is public.' });
    
    // Check tweet mentions @Solranchfarm or $RANCH
    const content = (verified.html + ' ' + verified.author).toLowerCase();
    if (!content.includes('solranchfarm') && !content.includes('solranch') && !content.includes('ranch')) {
      return res.status(400).json({ error: 'Tweet must mention @Solranchfarm or $RANCH' });
    }
    
    // Check if already done today
    const existing = await db.query(
      "SELECT id FROM social_engagements WHERE rancher_id = $1 AND day_date = $2 AND task_type = $3",
      [rancher.id, today, taskType]
    );
    if (existing.rows.length > 0) return res.json({ alreadyDone: true });
    
    // Check if this URL was already used by ANY wallet
    const urlUsed = await db.query(
      "SELECT id FROM social_engagements WHERE proof_url = $1",
      [proofUrl]
    );
    if (urlUsed.rows.length > 0) return res.status(400).json({ error: 'This tweet was already submitted by another rancher' });
    
    // Award points
    const rank = getRankForPoints(rancher.lifetime_pts);
    const streakMult = getStreakMult(rancher.current_streak);
    const totalPts = Math.floor(task.pts * streakMult * rank.mult);
    
    await db.query(
      "INSERT INTO social_engagements (rancher_id, day_date, task_type, proof_url, pts_awarded) VALUES ($1, $2, $3, $4, $5)",
      [rancher.id, today, taskType, proofUrl, totalPts]
    );
    
    await db.query(`
      INSERT INTO daily_points (rancher_id, day_date, social_pts, streak_mult, rank_mult, total_pts)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (rancher_id, day_date)
      DO UPDATE SET social_pts = daily_points.social_pts + $3, total_pts = daily_points.total_pts + $6
    `, [rancher.id, today, totalPts, streakMult, rank.mult, totalPts]);
    
    await db.query('UPDATE ranchers SET lifetime_pts = lifetime_pts + $1, updated_at = NOW() WHERE id = $2', [totalPts, rancher.id]);
    
    console.log('[SOCIAL] ' + taskType + ': ' + wallet.slice(0,8) + '... = ' + totalPts + ' pts');
    res.json({ pointsEarned: totalPts, message: task.label + ' verified! +' + totalPts + ' pts' });
    
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Already submitted' });
    console.error('[SOCIAL] Error:', err.message);
    res.status(500).json({ error: 'Failed' });
  }
});

// GET /api/social/:wallet/status
router.get('/:wallet/status', async (req, res) => {
  try {
    const rancher = await getRancher(req.params.wallet);
    if (!rancher) return res.json({ retweet: false, reply: false, quote: false, follow: false });
    
    const today = new Date().toISOString().split('T')[0];
    
    const todayTasks = await db.query(
      "SELECT task_type FROM social_engagements WHERE rancher_id = $1 AND day_date = $2",
      [rancher.id, today]
    );
    
    const followEver = await db.query(
      "SELECT id FROM social_engagements WHERE rancher_id = $1 AND task_type = 'follow'",
      [rancher.id]
    );
    
    const done = todayTasks.rows.map(r => r.task_type);
    
    res.json({
      retweet: done.includes('retweet'),
      reply: done.includes('reply'),
      quote: done.includes('quote'),
      follow: followEver.rows.length > 0,
    });
  } catch (err) {
    console.error('[SOCIAL] Status error:', err.message);
    res.json({ retweet: false, reply: false, quote: false, follow: false });
  }
});

module.exports = router;
