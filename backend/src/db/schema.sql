-- SOL RANCH Database Schema
-- Run: psql -U postgres -d solranch -f schema.sql

-- ============================================
-- RANCHERS (player profiles)
-- ============================================
CREATE TABLE IF NOT EXISTS ranchers (
  id            SERIAL PRIMARY KEY,
  wallet        VARCHAR(44) UNIQUE NOT NULL,
  ranch_name    VARCHAR(32),
  rank_level    INTEGER DEFAULT 1,
  lifetime_pts  BIGINT DEFAULT 0,
  current_streak INTEGER DEFAULT 0,
  longest_streak INTEGER DEFAULT 0,
  last_checkin  TIMESTAMP,
  referral_code VARCHAR(12) UNIQUE,
  referred_by   INTEGER REFERENCES ranchers(id),
  created_at    TIMESTAMP DEFAULT NOW(),
  updated_at    TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_ranchers_wallet ON ranchers(wallet);
CREATE INDEX idx_ranchers_referral ON ranchers(referral_code);

-- ============================================
-- DAILY POINTS (points earned per day per player)
-- ============================================
CREATE TABLE IF NOT EXISTS daily_points (
  id          SERIAL PRIMARY KEY,
  rancher_id  INTEGER NOT NULL REFERENCES ranchers(id),
  day_date    DATE NOT NULL DEFAULT CURRENT_DATE,
  checkin_pts INTEGER DEFAULT 0,
  hold_pts    INTEGER DEFAULT 0,
  social_pts  INTEGER DEFAULT 0,
  buy_pts     INTEGER DEFAULT 0,
  referral_pts INTEGER DEFAULT 0,
  rodeo_pts   INTEGER DEFAULT 0,
  streak_mult NUMERIC(3,2) DEFAULT 1.00,
  rank_mult   NUMERIC(3,2) DEFAULT 1.00,
  total_pts   BIGINT DEFAULT 0,
  created_at  TIMESTAMP DEFAULT NOW(),

  UNIQUE(rancher_id, day_date)
);

CREATE INDEX idx_daily_points_day ON daily_points(day_date);
CREATE INDEX idx_daily_points_rancher ON daily_points(rancher_id);

-- ============================================
-- TOKEN SNAPSHOTS (daily holding balances)
-- ============================================
CREATE TABLE IF NOT EXISTS token_snapshots (
  id          SERIAL PRIMARY KEY,
  rancher_id  INTEGER NOT NULL REFERENCES ranchers(id),
  day_date    DATE NOT NULL DEFAULT CURRENT_DATE,
  balance     BIGINT DEFAULT 0,
  hold_tier   INTEGER DEFAULT 0,
  pts_awarded INTEGER DEFAULT 0,
  created_at  TIMESTAMP DEFAULT NOW(),

  UNIQUE(rancher_id, day_date)
);

-- ============================================
-- BUY EVENTS (detected via Helius webhooks)
-- ============================================
CREATE TABLE IF NOT EXISTS buy_events (
  id          SERIAL PRIMARY KEY,
  rancher_id  INTEGER NOT NULL REFERENCES ranchers(id),
  tx_sig      VARCHAR(88) UNIQUE NOT NULL,
  amount_sol  NUMERIC(18,9),
  amount_token BIGINT,
  pts_awarded INTEGER DEFAULT 50,
  detected_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_buy_events_rancher ON buy_events(rancher_id);

-- ============================================
-- SOCIAL TASKS (verified social shares)
-- ============================================
CREATE TABLE IF NOT EXISTS social_tasks (
  id          SERIAL PRIMARY KEY,
  rancher_id  INTEGER NOT NULL REFERENCES ranchers(id),
  day_date    DATE NOT NULL DEFAULT CURRENT_DATE,
  platform    VARCHAR(20) DEFAULT 'twitter',
  post_url    TEXT,
  verified    BOOLEAN DEFAULT FALSE,
  pts_awarded INTEGER DEFAULT 0,
  created_at  TIMESTAMP DEFAULT NOW(),

  UNIQUE(rancher_id, day_date, platform)
);

-- ============================================
-- REFERRALS (tracking who brought who)
-- ============================================
CREATE TABLE IF NOT EXISTS referrals (
  id            SERIAL PRIMARY KEY,
  referrer_id   INTEGER NOT NULL REFERENCES ranchers(id),
  referred_id   INTEGER NOT NULL REFERENCES ranchers(id),
  pts_awarded   INTEGER DEFAULT 100,
  created_at    TIMESTAMP DEFAULT NOW(),

  UNIQUE(referred_id)
);

-- ============================================
-- REWARD DISTRIBUTIONS (daily payouts)
-- ============================================
CREATE TABLE IF NOT EXISTS reward_distributions (
  id              SERIAL PRIMARY KEY,
  day_date        DATE NOT NULL,
  total_pool_sol  NUMERIC(18,9) NOT NULL,
  total_points    BIGINT NOT NULL,
  num_recipients  INTEGER NOT NULL,
  tx_sig          VARCHAR(88),
  status          VARCHAR(20) DEFAULT 'pending',
  created_at      TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reward_payouts (
  id              SERIAL PRIMARY KEY,
  distribution_id INTEGER NOT NULL REFERENCES reward_distributions(id),
  rancher_id      INTEGER NOT NULL REFERENCES ranchers(id),
  points_earned   BIGINT NOT NULL,
  share_pct       NUMERIC(10,6) NOT NULL,
  amount_sol      NUMERIC(18,9) NOT NULL,
  tx_sig          VARCHAR(88),
  status          VARCHAR(20) DEFAULT 'pending',
  created_at      TIMESTAMP DEFAULT NOW()
);

-- ============================================
-- RODEO EVENTS (weekly competitions)
-- ============================================
CREATE TABLE IF NOT EXISTS rodeo_events (
  id          SERIAL PRIMARY KEY,
  title       VARCHAR(100) NOT NULL,
  description TEXT,
  event_type  VARCHAR(20) NOT NULL,
  starts_at   TIMESTAMP NOT NULL,
  ends_at     TIMESTAMP NOT NULL,
  prize_pts   INTEGER DEFAULT 0,
  active      BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rodeo_entries (
  id          SERIAL PRIMARY KEY,
  event_id    INTEGER NOT NULL REFERENCES rodeo_events(id),
  rancher_id  INTEGER NOT NULL REFERENCES ranchers(id),
  answer      TEXT,
  pts_awarded INTEGER DEFAULT 0,
  created_at  TIMESTAMP DEFAULT NOW(),

  UNIQUE(event_id, rancher_id)
);

-- ============================================
-- RANK DEFINITIONS (reference table)
-- ============================================
CREATE TABLE IF NOT EXISTS rank_levels (
  level       INTEGER PRIMARY KEY,
  name        VARCHAR(20) NOT NULL,
  min_pts     BIGINT NOT NULL,
  multiplier  NUMERIC(3,2) NOT NULL
);

INSERT INTO rank_levels (level, name, min_pts, multiplier) VALUES
  (1, 'Homestead',    0,      1.00),
  (2, 'Smallhold',    1000,   1.25),
  (3, 'Spread',       5000,   1.50),
  (4, 'Estate',       25000,  2.00),
  (5, 'Cattle Baron', 100000, 3.00)
ON CONFLICT (level) DO NOTHING;

-- ============================================
-- HOLD TIER DEFINITIONS (reference table)
-- ============================================
CREATE TABLE IF NOT EXISTS hold_tiers (
  tier        INTEGER PRIMARY KEY,
  min_tokens  BIGINT NOT NULL,
  daily_pts   INTEGER NOT NULL
);

INSERT INTO hold_tiers (tier, min_tokens, daily_pts) VALUES
  (1, 10000,    10),
  (2, 100000,   30),
  (3, 1000000,  75),
  (4, 10000000, 150)
ON CONFLICT (tier) DO NOTHING;
