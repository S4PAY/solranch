-- Sol Ranch Phase 6 — Farm Game Schema
-- New: inventory system, balanced points, feeding mechanic
-- Run: PGPASSWORD=pick_a_strong_password psql -h localhost -U postgres -d solranch -f schema-farm.sql

-- ═══ DROP OLD SEED DATA (re-seed with new values) ═══
DELETE FROM chunk_costs;
DELETE FROM crop_types;
DELETE FROM building_types;

-- ═══ INVENTORY — items bought (burned) but not yet placed ═══
CREATE TABLE IF NOT EXISTS ranch_inventory (
    id SERIAL PRIMARY KEY,
    wallet VARCHAR(64) NOT NULL,
    item_category VARCHAR(16) NOT NULL,   -- 'building','animal','crop','machine','deco'
    item_type VARCHAR(32) NOT NULL,        -- 'barn','cow','carrot_seed','butter_churn','wood_fence'
    quantity INT DEFAULT 1,
    burn_tx VARCHAR(128),
    burn_amount BIGINT DEFAULT 0,
    purchased_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(wallet, item_type)              -- stack same items
);

-- ═══ ANIMALS — separate from buildings, need feeding ═══
CREATE TABLE IF NOT EXISTS ranch_animals (
    id SERIAL PRIMARY KEY,
    wallet VARCHAR(64) NOT NULL,
    animal_type VARCHAR(32) NOT NULL,      -- 'chicken','cow','pig','sheep','goat','turkey','chick','chicken_brown','cow_black','cow_brown'
    tile_x INT NOT NULL,
    tile_y INT NOT NULL,
    last_fed_at TIMESTAMP,                 -- NULL = never fed
    burn_tx VARCHAR(128),
    placed_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(wallet, tile_x, tile_y)
);

-- ═══ MACHINES — boost nearby items ═══
CREATE TABLE IF NOT EXISTS ranch_machines (
    id SERIAL PRIMARY KEY,
    wallet VARCHAR(64) NOT NULL,
    machine_type VARCHAR(32) NOT NULL,     -- 'butter_churn','mayo_maker','spindle','cloth_maker'
    tile_x INT NOT NULL,
    tile_y INT NOT NULL,
    burn_tx VARCHAR(128),
    placed_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(wallet, tile_x, tile_y)
);

-- ═══ POINTS LOG — track all point earnings ═══
CREATE TABLE IF NOT EXISTS ranch_points_log (
    id SERIAL PRIMARY KEY,
    wallet VARCHAR(64) NOT NULL,
    source_category VARCHAR(16) NOT NULL,  -- 'building','animal','crop','machine','deco','task'
    source_type VARCHAR(32) NOT NULL,      -- 'barn','cow','carrot_harvest','butter_churn','morning_feed'
    points NUMERIC(10,2) NOT NULL,
    earned_at TIMESTAMP DEFAULT NOW()
);

-- ═══ DAILY FEED TRACKER — one feed action per day feeds all animals ═══
CREATE TABLE IF NOT EXISTS ranch_feed_log (
    id SERIAL PRIMARY KEY,
    wallet VARCHAR(64) NOT NULL,
    fed_at TIMESTAMP DEFAULT NOW()
);

-- ═══ UPDATE CHUNK COSTS — new ring pricing ═══
-- Ring 0 = center 4 chunks (3,3)(3,4)(4,3)(4,4) = FREE
-- Ring 1 = next 12 chunks = 100k each
-- Ring 2 = next 20 chunks = 500k each  
-- Ring 3 = outer 28 chunks = 1M each
INSERT INTO chunk_costs (ring, burn_cost) VALUES
    (1, 100000),
    (2, 500000),
    (3, 1000000),
    (4, 1000000)
ON CONFLICT (ring) DO UPDATE SET burn_cost = EXCLUDED.burn_cost;

-- ═══ UPDATE CROP TYPES — balanced for new economy ═══
-- Formula: ~3 harvests to break even on seed cost
-- Pts are per-harvest, seeds consumed on plant
INSERT INTO crop_types (name, burn_cost, grow_minutes, harvest_pts, sprite_row) VALUES
    ('radish',     2000,   60,  1, 7),     -- 1h, 0.5 base pts, need 4 harvests to ROI
    ('carrot',     3000,  120,  1, 0),     -- 2h, 1.0 base pts, need 3 harvests
    ('potato',     3000,  120,  1, 5),     -- 2h, 1.0 base pts, need 3 harvests
    ('tomato',     5000,  240,  2, 1),     -- 4h, 2.0 base pts, need 2.5 harvests
    ('strawberry', 8000,  480,  4, 2),     -- 8h, 4.0 base pts, need 2 harvests
    ('watermelon', 15000, 1440, 8, 6)      -- 24h, 8.0 base pts, need ~2 harvests
ON CONFLICT (name) DO UPDATE SET 
    burn_cost = EXCLUDED.burn_cost, 
    grow_minutes = EXCLUDED.grow_minutes, 
    harvest_pts = EXCLUDED.harvest_pts;

-- ═══ UPDATE BUILDING TYPES — 1 base pt/day per 50k burned ═══
INSERT INTO building_types (name, width_tiles, height_tiles, max_level, burn_cost_base, burn_cost_per_level) VALUES
    ('house',      4, 5, 1, 25000, 0),      -- 0.5 pts/day
    ('barn',       5, 5, 1, 50000, 0),       -- 1.0 pts/day
    ('coop',       4, 4, 1, 30000, 0),       -- 0.6 pts/day
    ('greenhouse', 7, 5, 1, 100000, 0),      -- 2.0 pts/day, +20% crop growth
    ('market',     6, 5, 1, 200000, 0),      -- 4.0 pts/day, +10% all pts
    ('hospital',   9, 7, 1, 150000, 0),      -- 3.0 pts/day
    ('museum',     8, 7, 1, 150000, 0),      -- 3.0 pts/day
    ('slimehut',   5, 5, 1, 80000, 0)        -- 1.5 pts/day, random 0-50 bonus
ON CONFLICT (name) DO UPDATE SET 
    burn_cost_base = EXCLUDED.burn_cost_base,
    width_tiles = EXCLUDED.width_tiles,
    height_tiles = EXCLUDED.height_tiles;

-- ═══ NEW: ANIMAL TYPES ═══
CREATE TABLE IF NOT EXISTS animal_types (
    id SERIAL PRIMARY KEY,
    name VARCHAR(32) UNIQUE NOT NULL,
    burn_cost BIGINT NOT NULL,
    daily_pts NUMERIC(4,1) NOT NULL,       -- pts/day when fed
    width_tiles INT DEFAULT 1,
    height_tiles INT DEFAULT 1,
    sprite_key VARCHAR(32) NOT NULL        -- matches Phaser sprite key
);

INSERT INTO animal_types (name, burn_cost, daily_pts, width_tiles, height_tiles, sprite_key) VALUES
    ('chick',          5000,   0.2, 1, 1, 'a_chick'),
    ('chicken',        10000,  0.4, 1, 1, 'a_chicken'),
    ('chicken_brown',  8000,   0.4, 1, 1, 'a_chicken_brown'),
    ('turkey',         15000,  0.6, 2, 2, 'a_turkey'),
    ('pig',            20000,  0.8, 2, 2, 'a_pig'),
    ('sheep',          25000,  1.0, 2, 2, 'a_sheep'),
    ('goat',           25000,  1.0, 2, 2, 'a_goat'),
    ('cow',            30000,  1.2, 2, 2, 'a_cow'),
    ('cow_black',      30000,  1.2, 2, 2, 'a_cow_black'),
    ('cow_brown',      30000,  1.2, 2, 2, 'a_cow_brown')
ON CONFLICT (name) DO UPDATE SET 
    burn_cost = EXCLUDED.burn_cost,
    daily_pts = EXCLUDED.daily_pts;

-- ═══ NEW: MACHINE TYPES ═══
CREATE TABLE IF NOT EXISTS machine_types (
    id SERIAL PRIMARY KEY,
    name VARCHAR(32) UNIQUE NOT NULL,
    burn_cost BIGINT NOT NULL,
    daily_pts NUMERIC(4,1) NOT NULL,
    boost_type VARCHAR(16),                -- 'animal','crop','all'
    boost_pct INT DEFAULT 0,               -- percentage boost
    sprite_key VARCHAR(32) NOT NULL
);

INSERT INTO machine_types (name, burn_cost, daily_pts, boost_type, boost_pct, sprite_key) VALUES
    ('butter_churn', 20000, 0.4, 'animal', 10, 'm_butterchurn'),
    ('mayo_maker',   20000, 0.4, 'crop',   10, 'm_mayomaker'),
    ('spindle',      15000, 0.3, 'all',     5,  'm_spindle'),
    ('cloth_maker',  25000, 0.5, 'all',     5,  'm_clothmaker')
ON CONFLICT (name) DO UPDATE SET 
    burn_cost = EXCLUDED.burn_cost,
    daily_pts = EXCLUDED.daily_pts,
    boost_pct = EXCLUDED.boost_pct;

-- ═══ NEW: DECO TYPES ═══
CREATE TABLE IF NOT EXISTS deco_types (
    id SERIAL PRIMARY KEY,
    name VARCHAR(32) UNIQUE NOT NULL,
    burn_cost BIGINT NOT NULL,
    daily_pts NUMERIC(4,1) NOT NULL,
    sprite_key VARCHAR(32) NOT NULL
);

INSERT INTO deco_types (name, burn_cost, daily_pts, sprite_key) VALUES
    ('wood_fence',    1000, 0.1, 'd_woodfence'),
    ('stone_fence',   2000, 0.1, 'd_stonefence'),
    ('tree1',         5000, 0.2, 'd_tree1'),
    ('tree2',         5000, 0.2, 'd_tree2'),
    ('flower_blue',   2000, 0.1, 'd_flower_blue'),
    ('flower_white',  2000, 0.1, 'd_flower_white'),
    ('scarecrow',     5000, 0.2, 'd_scarecrow'),
    ('gate_wood',     3000, 0.1, 'd_gate_wood'),
    ('gate_stone',    3000, 0.1, 'd_gate_stone')
ON CONFLICT (name) DO UPDATE SET 
    burn_cost = EXCLUDED.burn_cost,
    daily_pts = EXCLUDED.daily_pts;

-- ═══ INDEXES ═══
CREATE INDEX IF NOT EXISTS idx_ranch_inventory_wallet ON ranch_inventory(wallet);
CREATE INDEX IF NOT EXISTS idx_ranch_animals_wallet ON ranch_animals(wallet);
CREATE INDEX IF NOT EXISTS idx_ranch_machines_wallet ON ranch_machines(wallet);
CREATE INDEX IF NOT EXISTS idx_ranch_points_log_wallet ON ranch_points_log(wallet);
CREATE INDEX IF NOT EXISTS idx_ranch_points_log_date ON ranch_points_log(wallet, earned_at);
CREATE INDEX IF NOT EXISTS idx_ranch_feed_log_wallet ON ranch_feed_log(wallet, fed_at);
