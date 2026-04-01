-- Sol Ranch Phase 5 — Database Schema
-- Per-user ranch state: buildings, crops, land expansion
-- Run on: PGPASSWORD=pick_a_strong_password psql -h localhost -U postgres -d solranch

-- Land chunks owned by each player (8x8 tiles each)
-- The 64x64 map has chunk coords from 0-7 on each axis
-- Starting area = chunks (3,3), (3,4), (4,3), (4,4) — free for everyone
CREATE TABLE IF NOT EXISTS ranch_chunks (
    id SERIAL PRIMARY KEY,
    wallet VARCHAR(64) NOT NULL,
    chunk_x INT NOT NULL,        -- 0-7
    chunk_y INT NOT NULL,        -- 0-7
    burn_tx VARCHAR(128),        -- burn transaction signature
    burn_amount BIGINT DEFAULT 0,
    unlocked_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(wallet, chunk_x, chunk_y)
);

-- Buildings placed by each player
CREATE TABLE IF NOT EXISTS ranch_buildings (
    id SERIAL PRIMARY KEY,
    wallet VARCHAR(64) NOT NULL,
    building_type VARCHAR(32) NOT NULL,  -- 'player_house','barn','coop','greenhouse','mill','silo','market','slime_hut'
    tile_x INT NOT NULL,          -- tile position (0-63)
    tile_y INT NOT NULL,
    level INT DEFAULT 1,          -- upgrade level
    burn_tx VARCHAR(128),
    placed_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(wallet, tile_x, tile_y)
);

-- Crops planted by each player
CREATE TABLE IF NOT EXISTS ranch_crops (
    id SERIAL PRIMARY KEY,
    wallet VARCHAR(64) NOT NULL,
    tile_x INT NOT NULL,
    tile_y INT NOT NULL,
    crop_type VARCHAR(32) NOT NULL,  -- 'carrot','tomato','strawberry','pumpkin','corn','potato','watermelon','radish','lettuce','wheat'
    stage INT DEFAULT 0,             -- 0=seed, 1-4=growing, 5=harvestable
    watered BOOLEAN DEFAULT FALSE,
    planted_at TIMESTAMP DEFAULT NOW(),
    next_stage_at TIMESTAMP,         -- when crop advances to next stage
    burn_tx VARCHAR(128),
    UNIQUE(wallet, tile_x, tile_y)
);

-- Decorations placed by each player (fences, trees, flowers, etc)
CREATE TABLE IF NOT EXISTS ranch_decorations (
    id SERIAL PRIMARY KEY,
    wallet VARCHAR(64) NOT NULL,
    tile_x INT NOT NULL,
    tile_y INT NOT NULL,
    deco_type VARCHAR(32) NOT NULL,  -- 'wood_fence','stone_fence','tree','pine_tree','fruit_tree','rock','bush','bench','streetlight','scarecrow'
    variant INT DEFAULT 0,           -- color/style variant
    burn_tx VARCHAR(128),
    placed_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(wallet, tile_x, tile_y)
);

-- Crop type definitions
CREATE TABLE IF NOT EXISTS crop_types (
    id SERIAL PRIMARY KEY,
    name VARCHAR(32) UNIQUE NOT NULL,
    burn_cost BIGINT NOT NULL,       -- $RANCH to plant
    grow_minutes INT NOT NULL,       -- minutes per growth stage
    harvest_pts INT NOT NULL,        -- points earned on harvest
    sprite_row INT NOT NULL          -- row index in crops.png
);

-- Building type definitions
CREATE TABLE IF NOT EXISTS building_types (
    id SERIAL PRIMARY KEY,
    name VARCHAR(32) UNIQUE NOT NULL,
    width_tiles INT NOT NULL,        -- building width in tiles
    height_tiles INT NOT NULL,       -- building height in tiles
    max_level INT DEFAULT 3,
    burn_cost_base BIGINT NOT NULL,  -- $RANCH to build level 1
    burn_cost_per_level BIGINT NOT NULL  -- additional per upgrade
);

-- Chunk unlock cost definitions
CREATE TABLE IF NOT EXISTS chunk_costs (
    ring INT PRIMARY KEY,            -- 1=touching start, 2=next out, 3, 4=edges
    burn_cost BIGINT NOT NULL
);

-- Seed data: chunk costs
INSERT INTO chunk_costs (ring, burn_cost) VALUES
    (1, 25000),
    (2, 50000),
    (3, 100000),
    (4, 250000)
ON CONFLICT (ring) DO NOTHING;

-- Seed data: crop types
INSERT INTO crop_types (name, burn_cost, grow_minutes, harvest_pts, sprite_row) VALUES
    ('carrot',     2000,  60, 25, 0),
    ('tomato',     2000,  90, 30, 1),
    ('strawberry', 3000, 120, 40, 2),
    ('pumpkin',    5000, 240, 75, 3),
    ('corn',       3000, 150, 50, 4),
    ('potato',     2000,  60, 25, 5),
    ('watermelon', 5000, 300, 100, 6),
    ('radish',     1500,  45, 20, 7),
    ('lettuce',    1500,  45, 20, 8),
    ('wheat',      2500, 120, 35, 9)
ON CONFLICT (name) DO NOTHING;

-- Seed data: building types (width x height in tiles)
INSERT INTO building_types (name, width_tiles, height_tiles, max_level, burn_cost_base, burn_cost_per_level) VALUES
    ('player_house', 3, 3, 3, 0, 50000),        -- free at level 1, 50k per upgrade
    ('barn',         4, 3, 3, 25000, 25000),
    ('coop',         3, 3, 3, 15000, 15000),
    ('greenhouse',   4, 3, 2, 50000, 50000),
    ('mill',         3, 4, 1, 30000, 0),
    ('silo',         2, 3, 1, 20000, 0),
    ('market',       6, 3, 1, 100000, 0),
    ('slime_hut',    3, 3, 1, 75000, 0)
ON CONFLICT (name) DO NOTHING;

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_ranch_chunks_wallet ON ranch_chunks(wallet);
CREATE INDEX IF NOT EXISTS idx_ranch_buildings_wallet ON ranch_buildings(wallet);
CREATE INDEX IF NOT EXISTS idx_ranch_crops_wallet ON ranch_crops(wallet);
CREATE INDEX IF NOT EXISTS idx_ranch_crops_harvest ON ranch_crops(wallet, next_stage_at) WHERE stage < 5;
CREATE INDEX IF NOT EXISTS idx_ranch_decorations_wallet ON ranch_decorations(wallet);
