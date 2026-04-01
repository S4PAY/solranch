import { useState, useEffect, useRef, useCallback } from 'react';

// ── Constants ────────────────────────────────────────────────────────
const TILE_SIZE = 16;          // sprite pixels
const MAP_TILES = 64;          // 64x64 grid
const CHUNK_SIZE = 8;          // 8x8 tiles per chunk
const CHUNKS_PER_AXIS = MAP_TILES / CHUNK_SIZE; // 8
const SCALE_DEFAULT = 3;       // render scale (16*3 = 48px per tile)
const SCALE_MIN = 1.5;
const SCALE_MAX = 5;

// Starting chunks: center 2x2 (chunks 3,3 / 3,4 / 4,3 / 4,4)
const START_CHUNKS = [
  '3,3', '3,4', '4,3', '4,4'
];

// Chunk ring mapping: distance from center determines burn cost
// Ring 0 = starting (free), Ring 1 = adjacent, Ring 2, Ring 3, Ring 4 = edges
function getChunkRing(cx, cy) {
  // Center chunks are (3,3), (3,4), (4,3), (4,4)
  const centerX = 3.5, centerY = 3.5;
  const dist = Math.max(Math.abs(cx - centerX), Math.abs(cy - centerY));
  if (dist <= 1) return 0; // starting area
  if (dist <= 2) return 1;
  if (dist <= 3) return 2;
  if (dist <= 4) return 3;
  return 4;
}

const RING_COSTS = { 0: 0, 1: 25000, 2: 50000, 3: 100000, 4: 250000 };
const RING_COLORS = {
  0: null,
  1: 'rgba(0,0,0,0.45)',
  2: 'rgba(0,0,0,0.55)',
  3: 'rgba(0,0,0,0.65)',
  4: 'rgba(0,0,0,0.75)',
};

// ── Grass tile coordinates in tiles.png (spring column) ──────────
// These are the key 16x16 tiles we need from the sprite sheet
// The grass autotile is in the top-left of tiles.png
// We'll use a simple grass fill for prototype, refine autotile later
const SPRITE_COORDS = {
  // Basic terrain (x, y in pixels on tiles.png)
  grass_center: { x: 16, y: 0 },       // solid grass
  grass_detail1: { x: 48, y: 0 },      // grass with flowers
  grass_detail2: { x: 64, y: 0 },      // grass with tiny flowers
  grass_detail3: { x: 80, y: 0 },      // grass with mushroom
  dirt_center: { x: 16, y: 48 },       // solid dirt
  path_h: { x: 0, y: 160 },           // horizontal path

  // Water tiles (approximate - will refine)
  water: { x: 0, y: 96 },
  water_edge_top: { x: 16, y: 80 },
  water_edge_bottom: { x: 16, y: 112 },
  water_edge_left: { x: 0, y: 96 },
  water_edge_right: { x: 32, y: 96 },

  // Trees (larger than 16x16, these are top-left of tree sprite)
  tree: { x: 0, y: 320, w: 32, h: 48 },
  pine: { x: 64, y: 320, w: 32, h: 48 },
  fruit_tree: { x: 32, y: 320, w: 32, h: 48 },

  // Small details
  rock1: { x: 160, y: 336 },
  rock2: { x: 176, y: 336 },
  bush1: { x: 128, y: 336 },
  bush2: { x: 144, y: 336 },
};

// ── Component ────────────────────────────────────────────────────────
export default function FarmView() {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);

  // Camera state
  const cameraRef = useRef({
    x: 0, y: 0,
    scale: SCALE_DEFAULT,
    dragging: false,
    dragStartX: 0, dragStartY: 0,
    camStartX: 0, camStartY: 0,
    // Pinch zoom
    lastPinchDist: 0,
    touching: false,
  });

  // Game state
  const [tilesImg, setTilesImg] = useState(null);
  const [buildingsImg, setBuildingsImg] = useState(null);
  const [cropsImg, setCropsImg] = useState(null);
  const [loaded, setLoaded] = useState(false);

  // Unlocked chunks (prototype: just the starting 4)
  const [unlockedChunks, setUnlockedChunks] = useState(new Set(START_CHUNKS));

  // Placed objects (prototype: empty, will come from DB)
  const [buildings, setBuildings] = useState([
    // Auto-place player house at center
    { type: 'player_house', tileX: 29, tileY: 29, level: 1 },
  ]);
  const [crops, setCrops] = useState([]);

  // Hovered chunk for UI
  const [hoveredChunk, setHoveredChunk] = useState(null);
  const [selectedTile, setSelectedTile] = useState(null);

  // Map data: seeded pseudo-random grass details
  const mapDataRef = useRef(null);
  if (!mapDataRef.current) {
    // Generate static map decorations (grass variants, scattered rocks/bushes)
    const data = new Array(MAP_TILES * MAP_TILES).fill(0);
    // Simple seeded random
    let seed = 42;
    const rand = () => { seed = (seed * 16807 + 0) % 2147483647; return (seed - 1) / 2147483646; };
    for (let i = 0; i < data.length; i++) {
      const r = rand();
      if (r < 0.03) data[i] = 1;      // flower detail
      else if (r < 0.05) data[i] = 2;  // tiny flowers
      else if (r < 0.055) data[i] = 3; // mushroom
      else data[i] = 0;                // plain grass
    }
    // Border tiles = water (2 tiles thick)
    for (let x = 0; x < MAP_TILES; x++) {
      for (let y = 0; y < MAP_TILES; y++) {
        if (x < 2 || x >= MAP_TILES - 2 || y < 2 || y >= MAP_TILES - 2) {
          data[y * MAP_TILES + x] = -1; // water
        }
      }
    }
    mapDataRef.current = data;
  }

  // ── Load sprites ───────────────────────────────────────────────
  useEffect(() => {
    let mounted = true;
    const basePath = import.meta.env.BASE_URL + 'sprites/cozy/';

    const loadImg = (src) => new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Failed to load: ${src}`));
      img.src = src;
    });

    Promise.all([
      loadImg(basePath + 'tiles.png'),
      loadImg(basePath + 'buildings.png'),
      loadImg(basePath + 'crops.png'),
    ]).then(([tiles, bldgs, crps]) => {
      if (!mounted) return;
      setTilesImg(tiles);
      setBuildingsImg(bldgs);
      setCropsImg(crps);
      setLoaded(true);
    }).catch(err => {
      console.error('Sprite load error:', err);
    });

    return () => { mounted = false; };
  }, []);

  // ── Center camera on load ──────────────────────────────────────
  useEffect(() => {
    if (!loaded || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const cam = cameraRef.current;
    const mapPx = MAP_TILES * TILE_SIZE * cam.scale;
    cam.x = (mapPx - rect.width) / 2;
    cam.y = (mapPx - rect.height) / 2;
  }, [loaded]);

  // ── Render loop ────────────────────────────────────────────────
  const renderFrame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !tilesImg) return;

    const ctx = canvas.getContext('2d');
    const cam = cameraRef.current;
    const W = canvas.width;
    const H = canvas.height;
    const scale = cam.scale;
    const tilePx = TILE_SIZE * scale;

    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, W, H);

    // Visible tile range (with 2-tile padding)
    const startTileX = Math.max(0, Math.floor(cam.x / tilePx) - 2);
    const startTileY = Math.max(0, Math.floor(cam.y / tilePx) - 2);
    const endTileX = Math.min(MAP_TILES, Math.ceil((cam.x + W) / tilePx) + 2);
    const endTileY = Math.min(MAP_TILES, Math.ceil((cam.y + H) / tilePx) + 2);

    const mapData = mapDataRef.current;

    // ── Draw terrain ──
    for (let ty = startTileY; ty < endTileY; ty++) {
      for (let tx = startTileX; tx < endTileX; tx++) {
        const screenX = tx * tilePx - cam.x;
        const screenY = ty * tilePx - cam.y;
        const tileVal = mapData[ty * MAP_TILES + tx];

        if (tileVal === -1) {
          // Water tile
          const wt = SPRITE_COORDS.water;
          ctx.drawImage(tilesImg, wt.x, wt.y, TILE_SIZE, TILE_SIZE,
            screenX, screenY, tilePx, tilePx);
        } else {
          // Grass tile
          let gt;
          switch (tileVal) {
            case 1: gt = SPRITE_COORDS.grass_detail1; break;
            case 2: gt = SPRITE_COORDS.grass_detail2; break;
            case 3: gt = SPRITE_COORDS.grass_detail3; break;
            default: gt = SPRITE_COORDS.grass_center; break;
          }
          ctx.drawImage(tilesImg, gt.x, gt.y, TILE_SIZE, TILE_SIZE,
            screenX, screenY, tilePx, tilePx);
        }
      }
    }

    // ── Draw locked chunk overlays ──
    for (let cy = 0; cy < CHUNKS_PER_AXIS; cy++) {
      for (let cx = 0; cx < CHUNKS_PER_AXIS; cx++) {
        const key = `${cx},${cy}`;
        if (unlockedChunks.has(key)) continue;

        const ring = getChunkRing(cx, cy);
        const color = RING_COLORS[ring] || 'rgba(0,0,0,0.5)';

        const chunkScreenX = cx * CHUNK_SIZE * tilePx - cam.x;
        const chunkScreenY = cy * CHUNK_SIZE * tilePx - cam.y;
        const chunkPx = CHUNK_SIZE * tilePx;

        // Skip if off screen
        if (chunkScreenX + chunkPx < 0 || chunkScreenX > W) continue;
        if (chunkScreenY + chunkPx < 0 || chunkScreenY > H) continue;

        ctx.fillStyle = color;
        ctx.fillRect(chunkScreenX, chunkScreenY, chunkPx, chunkPx);

        // Draw lock icon + cost text
        ctx.save();
        const centerX = chunkScreenX + chunkPx / 2;
        const centerY = chunkScreenY + chunkPx / 2;

        // Lock icon
        const lockSize = Math.max(12, tilePx * 0.8);
        ctx.font = `${lockSize}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = 'rgba(255,255,255,0.5)';

        // Only show details if chunk is reasonably sized on screen
        if (chunkPx > 80) {
          ctx.fillText('\u{1F512}', centerX, centerY - lockSize * 0.4);

          // Cost
          const cost = RING_COSTS[ring];
          if (cost > 0) {
            ctx.font = `bold ${Math.max(10, tilePx * 0.35)}px monospace`;
            ctx.fillStyle = 'rgba(255,220,100,0.8)';
            const label = cost >= 1000 ? `${cost / 1000}k` : `${cost}`;
            ctx.fillText(`${label} $RANCH`, centerX, centerY + lockSize * 0.5);
          }
        }
        ctx.restore();

        // Highlight hovered chunk
        if (hoveredChunk && hoveredChunk.cx === cx && hoveredChunk.cy === cy) {
          ctx.strokeStyle = 'rgba(255,220,100,0.8)';
          ctx.lineWidth = 2;
          ctx.strokeRect(chunkScreenX + 1, chunkScreenY + 1, chunkPx - 2, chunkPx - 2);
        }
      }
    }

    // ── Draw chunk grid lines (subtle) ──
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    for (let cx = 0; cx <= CHUNKS_PER_AXIS; cx++) {
      const x = cx * CHUNK_SIZE * tilePx - cam.x;
      ctx.beginPath();
      ctx.moveTo(x, -cam.y);
      ctx.lineTo(x, MAP_TILES * tilePx - cam.y);
      ctx.stroke();
    }
    for (let cy = 0; cy <= CHUNKS_PER_AXIS; cy++) {
      const y = cy * CHUNK_SIZE * tilePx - cam.y;
      ctx.beginPath();
      ctx.moveTo(-cam.x, y);
      ctx.lineTo(MAP_TILES * tilePx - cam.x, y);
      ctx.stroke();
    }

    // ── Draw placed buildings (placeholder rectangles for now) ──
    buildings.forEach(b => {
      const bx = b.tileX * tilePx - cam.x;
      const by = b.tileY * tilePx - cam.y;
      let bw = 3, bh = 3;
      if (b.type === 'barn') { bw = 4; bh = 3; }
      if (b.type === 'mill') { bw = 3; bh = 4; }

      // For prototype, draw colored rectangle with label
      // Later: draw from buildings.png
      ctx.fillStyle = b.type === 'player_house' ? 'rgba(180,120,60,0.85)' :
                      b.type === 'barn' ? 'rgba(140,80,40,0.85)' :
                      b.type === 'coop' ? 'rgba(160,140,80,0.85)' :
                      'rgba(100,130,100,0.85)';
      ctx.fillRect(bx, by, bw * tilePx, bh * tilePx);

      // Roof
      ctx.fillStyle = b.type === 'player_house' ? 'rgba(160,60,60,0.9)' :
                      'rgba(120,50,50,0.9)';
      ctx.fillRect(bx - tilePx * 0.2, by - tilePx * 0.3, bw * tilePx + tilePx * 0.4, tilePx * 1.2);

      // Label
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${Math.max(10, tilePx * 0.3)}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const label = b.type.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase());
      ctx.fillText(label, bx + bw * tilePx / 2, by + bh * tilePx / 2);
    });

    // ── Draw selected tile highlight ──
    if (selectedTile) {
      const sx = selectedTile.x * tilePx - cam.x;
      const sy = selectedTile.y * tilePx - cam.y;
      ctx.strokeStyle = 'rgba(255,255,100,0.9)';
      ctx.lineWidth = 2;
      ctx.strokeRect(sx, sy, tilePx, tilePx);
    }
  }, [tilesImg, unlockedChunks, buildings, crops, hoveredChunk, selectedTile]);

  // ── Animation loop ──
  useEffect(() => {
    if (!loaded) return;
    let animId;
    const loop = () => {
      renderFrame();
      animId = requestAnimationFrame(loop);
    };
    animId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animId);
  }, [loaded, renderFrame]);

  // ── Resize handler ──
  useEffect(() => {
    const resize = () => {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return;
      canvas.width = container.clientWidth;
      canvas.height = container.clientHeight;
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  // ── Mouse/Touch handlers ──────────────────────────────────────
  const getEventPos = (e) => {
    if (e.touches && e.touches.length > 0) {
      return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }
    return { x: e.clientX, y: e.clientY };
  };

  const handlePointerDown = useCallback((e) => {
    // Handle pinch start
    if (e.touches && e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      cameraRef.current.lastPinchDist = Math.sqrt(dx * dx + dy * dy);
      cameraRef.current.touching = true;
      return;
    }

    const pos = getEventPos(e);
    const cam = cameraRef.current;
    cam.dragging = true;
    cam.dragStartX = pos.x;
    cam.dragStartY = pos.y;
    cam.camStartX = cam.x;
    cam.camStartY = cam.y;
  }, []);

  const handlePointerMove = useCallback((e) => {
    const cam = cameraRef.current;

    // Handle pinch zoom
    if (e.touches && e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (cam.lastPinchDist > 0) {
        const ratio = dist / cam.lastPinchDist;
        cam.scale = Math.max(SCALE_MIN, Math.min(SCALE_MAX, cam.scale * ratio));
      }
      cam.lastPinchDist = dist;
      return;
    }

    if (!cam.dragging) {
      // Update hovered chunk
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const pos = getEventPos(e);
      const worldX = (pos.x - rect.left) + cam.x;
      const worldY = (pos.y - rect.top) + cam.y;
      const tilePx = TILE_SIZE * cam.scale;
      const tileX = Math.floor(worldX / tilePx);
      const tileY = Math.floor(worldY / tilePx);
      const cx = Math.floor(tileX / CHUNK_SIZE);
      const cy = Math.floor(tileY / CHUNK_SIZE);
      if (cx >= 0 && cx < CHUNKS_PER_AXIS && cy >= 0 && cy < CHUNKS_PER_AXIS) {
        if (!unlockedChunks.has(`${cx},${cy}`)) {
          setHoveredChunk({ cx, cy });
        } else {
          setHoveredChunk(null);
        }
      }
      return;
    }

    const pos = getEventPos(e);
    cam.x = cam.camStartX - (pos.x - cam.dragStartX);
    cam.y = cam.camStartY - (pos.y - cam.dragStartY);
  }, [unlockedChunks]);

  const handlePointerUp = useCallback((e) => {
    const cam = cameraRef.current;

    if (cam.touching) {
      cam.touching = false;
      cam.lastPinchDist = 0;
      cam.dragging = false;
      return;
    }

    // Detect tap vs drag
    if (cam.dragging) {
      const pos = getEventPos(e.changedTouches ? e : e);
      const dragDist = Math.abs(pos.x - cam.dragStartX) + Math.abs(pos.y - cam.dragStartY);

      if (dragDist < 10) {
        // This was a tap — handle tile/chunk selection
        const canvas = canvasRef.current;
        if (canvas) {
          const rect = canvas.getBoundingClientRect();
          const worldX = (pos.x - rect.left) + cam.x;
          const worldY = (pos.y - rect.top) + cam.y;
          const tilePx = TILE_SIZE * cam.scale;
          const tileX = Math.floor(worldX / tilePx);
          const tileY = Math.floor(worldY / tilePx);

          if (tileX >= 0 && tileX < MAP_TILES && tileY >= 0 && tileY < MAP_TILES) {
            const cx = Math.floor(tileX / CHUNK_SIZE);
            const cy = Math.floor(tileY / CHUNK_SIZE);
            const chunkKey = `${cx},${cy}`;

            if (unlockedChunks.has(chunkKey)) {
              // Tapped an unlocked tile
              setSelectedTile({ x: tileX, y: tileY });
            } else {
              // Tapped a locked chunk — could trigger buy UI
              setSelectedTile(null);
              console.log(`Locked chunk ${chunkKey}, ring ${getChunkRing(cx, cy)}, cost: ${RING_COSTS[getChunkRing(cx, cy)]}k $RANCH`);
            }
          }
        }
      }
      cam.dragging = false;
    }
  }, [unlockedChunks]);

  const handleWheel = useCallback((e) => {
    e.preventDefault();
    const cam = cameraRef.current;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // World position under mouse before zoom
    const worldX = mouseX + cam.x;
    const worldY = mouseY + cam.y;

    const oldScale = cam.scale;
    const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
    cam.scale = Math.max(SCALE_MIN, Math.min(SCALE_MAX, cam.scale * zoomFactor));

    // Adjust camera to keep world point under mouse
    const scaleRatio = cam.scale / oldScale;
    cam.x = worldX * scaleRatio - mouseX;
    cam.y = worldY * scaleRatio - mouseY;
  }, []);

  // ── HUD ──
  const hudStyle = {
    position: 'absolute',
    bottom: 16,
    left: '50%',
    transform: 'translateX(-50%)',
    display: 'flex',
    gap: 8,
    zIndex: 10,
  };

  const btnStyle = {
    padding: '8px 16px',
    background: 'rgba(80,60,40,0.9)',
    color: '#f0d090',
    border: '2px solid #a08050',
    borderRadius: 6,
    fontFamily: '"Big Shoulders Display", monospace',
    fontSize: 14,
    fontWeight: 700,
    cursor: 'pointer',
    textTransform: 'uppercase',
    letterSpacing: 1,
  };

  const infoPanelStyle = {
    position: 'absolute',
    top: 16,
    right: 16,
    background: 'rgba(40,30,20,0.9)',
    color: '#f0d090',
    padding: '12px 16px',
    borderRadius: 8,
    border: '2px solid #a08050',
    fontFamily: '"Big Shoulders Display", monospace',
    fontSize: 13,
    zIndex: 10,
    minWidth: 180,
  };

  const titleBarStyle = {
    position: 'absolute',
    top: 16,
    left: 16,
    background: 'rgba(40,30,20,0.9)',
    color: '#f0d090',
    padding: '8px 16px',
    borderRadius: 8,
    border: '2px solid #a08050',
    fontFamily: '"Big Shoulders Display", monospace',
    fontSize: 18,
    fontWeight: 700,
    zIndex: 10,
    letterSpacing: 1,
  };

  // ── Loading state ──
  if (!loaded) {
    return (
      <div style={{
        width: '100vw', height: '100vh',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#1a1408', color: '#f0d090',
        fontFamily: '"Big Shoulders Display", monospace',
        fontSize: 24,
      }}>
        Loading ranch...
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      style={{
        width: '100vw',
        height: '100vh',
        overflow: 'hidden',
        position: 'relative',
        background: '#2a4a1a',
        touchAction: 'none',
        userSelect: 'none',
      }}
    >
      <canvas
        ref={canvasRef}
        onMouseDown={handlePointerDown}
        onMouseMove={handlePointerMove}
        onMouseUp={handlePointerUp}
        onMouseLeave={() => { cameraRef.current.dragging = false; setHoveredChunk(null); }}
        onTouchStart={handlePointerDown}
        onTouchMove={handlePointerMove}
        onTouchEnd={handlePointerUp}
        onWheel={handleWheel}
        style={{ display: 'block', cursor: 'grab' }}
      />

      {/* Title bar */}
      <div style={titleBarStyle}>
        SOL RANCH
      </div>

      {/* Info panel */}
      <div style={infoPanelStyle}>
        <div style={{ marginBottom: 4 }}>
          Unlocked: {unlockedChunks.size}/{CHUNKS_PER_AXIS * CHUNKS_PER_AXIS} chunks
        </div>
        <div style={{ marginBottom: 4 }}>
          Buildings: {buildings.length}
        </div>
        {selectedTile && (
          <div style={{ marginTop: 8, borderTop: '1px solid #a08050', paddingTop: 8 }}>
            Tile: ({selectedTile.x}, {selectedTile.y})
            <br />
            Chunk: ({Math.floor(selectedTile.x / CHUNK_SIZE)}, {Math.floor(selectedTile.y / CHUNK_SIZE)})
          </div>
        )}
        {hoveredChunk && (
          <div style={{ marginTop: 8, borderTop: '1px solid #a08050', paddingTop: 8, color: '#ffd060' }}>
            Locked chunk ({hoveredChunk.cx}, {hoveredChunk.cy})
            <br />
            Cost: {(RING_COSTS[getChunkRing(hoveredChunk.cx, hoveredChunk.cy)] / 1000)}k $RANCH
          </div>
        )}
      </div>

      {/* Bottom HUD */}
      <div style={hudStyle}>
        <button style={btnStyle} onClick={() => {
          const cam = cameraRef.current;
          cam.scale = SCALE_DEFAULT;
          const canvas = canvasRef.current;
          if (canvas) {
            cam.x = (MAP_TILES * TILE_SIZE * cam.scale - canvas.width) / 2;
            cam.y = (MAP_TILES * TILE_SIZE * cam.scale - canvas.height) / 2;
          }
        }}>
          Center
        </button>
        <button style={btnStyle} onClick={() => {
          cameraRef.current.scale = Math.min(SCALE_MAX, cameraRef.current.scale * 1.3);
        }}>
          Zoom +
        </button>
        <button style={btnStyle} onClick={() => {
          cameraRef.current.scale = Math.max(SCALE_MIN, cameraRef.current.scale * 0.7);
        }}>
          Zoom -
        </button>
      </div>
    </div>
  );
}
