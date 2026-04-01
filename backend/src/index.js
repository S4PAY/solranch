require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cron = require('node-cron');

const rancherRoutes = require('./routes/ranchers');
const pointsRoutes = require('./routes/points');
const webhookRoutes = require('./routes/webhooks');
const leaderboardRoutes = require('./routes/leaderboard');
const rewardsRoutes = require('./routes/rewards');
const rodeoRoutes = require('./routes/rodeo');

const { runDailySnapshot } = require('./scripts/dailySnapshot');
const { runDailyDistribution } = require('./scripts/distributeRewards');

const app = express();
app.set("trust proxy", 1);
const PORT = process.env.PORT || 3002;

// ---------------------
// Middleware
// ---------------------
// Webhook route - no cors/auth/rate limit (Helius needs direct access)
app.use('/api/webhooks', express.json(), webhookRoutes);

app.use(helmet());
app.use(cors({ origin: ['https://solranch.farm', 'http://localhost:5173'] }));
app.use(express.json());

const limiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 300,
  message: { error: 'Too many requests, partner. Slow down.' }
});
app.use('/api/', limiter);
// Block all point-earning on dev
app.use("/api", (req, res, next) => {
  if (req.method === "POST" && !req.path.startsWith("/farm") && !req.path.startsWith("/ranchers")) return res.status(403).json({ error: "Dev server - points disabled" });
  next();
});

// ---------------------
// Routes
// ---------------------
app.use('/api/ranchers', rancherRoutes);
app.use('/api/points', pointsRoutes);
app.use('/api/leaderboard', leaderboardRoutes);
app.use('/api/rewards', rewardsRoutes);
app.use('/api/token', require('./routes/token'));
app.use('/api/rodeo', rodeoRoutes);
app.use('/api/tiers', require('./routes/tiers'));
app.use('/api/social', require('./routes/social'));
app.use('/api/raids', require('./routes/raids'));
app.use('/api/engage', require('./routes/engagement'));
app.use('/api/beta', require('./routes/beta'));
app.use('/api/pens', require('./routes/pens'));
app.use('/api/farm', require('./routes/farm'));
app.use('/api/stats', require('./routes/stats'));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', ranch: 'open', timestamp: new Date().toISOString() });
});

// ---------------------
// Cron Jobs
// ---------------------

// Daily snapshot: capture token holdings at midnight UTC
cron.schedule('0 0 * * *', async () => {
  console.log('[CRON] Running daily token snapshot...');
  try {
    await runDailySnapshot();
    console.log('[CRON] Snapshot complete');
  } catch (err) {
    console.error('[CRON] Snapshot failed:', err.message);
  }
});

// Daily distribution: run at 00:30 UTC (after snapshot)
cron.schedule('30 0 * * *', async () => {
  console.log('[CRON] Running daily reward distribution...');
  try {
    await runDailyDistribution();
    console.log('[CRON] Distribution complete');
  } catch (err) {
    console.error('[CRON] Distribution failed:', err.message);
  }
});

// ---------------------
// Start
// ---------------------
app.listen(PORT, () => {
  console.log(`[SOL RANCH] Server running on port ${PORT}`);
  console.log(`[SOL RANCH] Environment: ${process.env.NODE_ENV || 'development'}`);
});

module.exports = app;

// Serve frontend for dev
const path = require('path');
app.use(require('express').static(path.join(__dirname, '../../frontend/dist')));
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(__dirname, '../../frontend/dist/index.html'));
  }
});
