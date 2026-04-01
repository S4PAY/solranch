import { useRef, useEffect, useState } from 'react';

const S = '/sprites';

const SCENES = {
  cattle: {
    bg: '#4a7a2e', bg2: '#3d6b25',
    sprites: [
      { src: 'cow_brown.png', fw: 32, fh: 32, frames: 8, row: 0, scale: 2 },
      { src: 'cow_light.png', fw: 32, fh: 32, frames: 8, row: 0, scale: 2 },
    ],
    building: { src: 'barn.png', w: 96, h: 128 },
    extra: { src: 'water_tray.png', w: 96, h: 16, yOff: 0.7 },
    animals: 5,
  },
  chicken: {
    bg: '#5a8a3a', bg2: '#4a7a2e',
    sprites: [
      { src: 'chicken_default.png', fw: 32, fh: 32, frames: 4, row: 0, scale: 1.5 },
      { src: 'chicken_brown.png', fw: 32, fh: 32, frames: 4, row: 0, scale: 1.5 },
    ],
    building: { src: 'chicken_houses.png', w: 64, h: 48, sx: 0, sy: 0, sw: 48, sh: 44 },
    extra: { src: 'nest.png', w: 40, h: 16, yOff: 0.5 },
    animals: 7,
  },
  horse: {
    bg: '#4a7a2e', bg2: '#3d6b25',
    sprites: [
      { src: 'horse_grazing.png', fw: 64, fh: 64, frames: 6, row: 0, scale: 1 },
      { src: 'horse_running.png', fw: 64, fh: 64, frames: 5, row: 0, scale: 1 },
    ],
    building: { src: 'barn.png', w: 96, h: 128 },
    extra: { src: 'water_tray.png', w: 96, h: 16, yOff: 0.65 },
    animals: 3,
  },
  sheep: {
    bg: '#5a9a3e', bg2: '#4a8a30',
    sprites: [
      { src: 'sheep_idle.png', fw: 44, fh: 32, frames: 3, row: 0, scale: 1.8 },
      { src: 'sheep_walk.png', fw: 44, fh: 32, frames: 4, row: 0, scale: 1.8 },
    ],
    building: { src: 'water_well.png', w: 64, h: 64 },
    extra: null,
    animals: 6,
  },
  pig: {
    bg: '#4a7228', bg2: '#3d6520',
    sprites: [
      { src: 'pig_idle.png', fw: 42, fh: 32, frames: 3, row: 0, scale: 1.8 },
      { src: 'pig_walk.png', fw: 42, fh: 32, frames: 4, row: 0, scale: 1.8 },
    ],
    building: { src: 'water_tray.png', w: 96, h: 16 },
    extra: null,
    animals: 5,
  },
};

const FENCE_COLOR = '#c4a882';
const FENCE_DARK = '#9c8868';
const FENCE_POST = '#7a6345';

function seededRandom(seed) {
  let s = seed;
  return function() {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function PenScene({ penType, health, unlocked, animalCount }) {
  const canvasRef = useRef(null);
  const imagesRef = useRef({});
  const animRef = useRef(0);
  const frameRef = useRef(0);

  const W = 480, H = 280;
  const scene = SCENES[penType] || SCENES.cattle;
  const count = animalCount || scene.animals;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;

    // Load all images
    const toLoad = [];
    scene.sprites.forEach(sp => {
      if (!imagesRef.current[sp.src]) {
        const img = new Image();
        img.src = S + '/' + sp.src;
        imagesRef.current[sp.src] = img;
        toLoad.push(new Promise(r => { img.onload = r; img.onerror = r; }));
      }
    });
    if (scene.building) {
      const bs = scene.building.src;
      if (!imagesRef.current[bs]) {
        const img = new Image();
        img.src = S + '/' + bs;
        imagesRef.current[bs] = img;
        toLoad.push(new Promise(r => { img.onload = r; img.onerror = r; }));
      }
    }
    if (scene.extra) {
      const es = scene.extra.src;
      if (!imagesRef.current[es]) {
        const img = new Image();
        img.src = S + '/' + es;
        imagesRef.current[es] = img;
        toLoad.push(new Promise(r => { img.onload = r; img.onerror = r; }));
      }
    }

    // Generate animal positions with seed
    const rng = seededRandom(penType.length * 1000 + 42);
    const positions = [];
    for (let i = 0; i < count; i++) {
      positions.push({
        x: 80 + rng() * (W - 180),
        y: 60 + rng() * (H - 120),
        spriteIdx: Math.floor(rng() * scene.sprites.length),
        flip: rng() > 0.5,
        speed: 0.3 + rng() * 0.4,
        offsetX: 0,
        dir: rng() > 0.5 ? 1 : -1,
        moving: rng() > 0.4,
      });
    }
    // Sort by Y for depth
    positions.sort((a, b) => a.y - b.y);

    function drawFence(ctx) {
      const postW = 4, postH = 16, railH = 3, gap = 24;
      // Top fence
      for (let x = 8; x < W - 8; x += gap) {
        ctx.fillStyle = FENCE_POST;
        ctx.fillRect(x, 6, postW, postH);
        ctx.fillStyle = FENCE_COLOR;
        ctx.fillRect(x, 10, gap, railH);
        ctx.fillStyle = FENCE_DARK;
        ctx.fillRect(x, 17, gap, railH);
      }
      // Bottom fence
      for (let x = 8; x < W - 8; x += gap) {
        ctx.fillStyle = FENCE_POST;
        ctx.fillRect(x, H - 22, postW, postH);
        ctx.fillStyle = FENCE_COLOR;
        ctx.fillRect(x, H - 18, gap, railH);
        ctx.fillStyle = FENCE_DARK;
        ctx.fillRect(x, H - 11, gap, railH);
      }
      // Left fence
      for (let y = 6; y < H - 8; y += gap) {
        ctx.fillStyle = FENCE_POST;
        ctx.fillRect(4, y, postW, postH);
      }
      // Right fence
      for (let y = 6; y < H - 8; y += gap) {
        ctx.fillStyle = FENCE_POST;
        ctx.fillRect(W - 8, y, postW, postH);
      }
    }

    function drawGrass(ctx) {
      ctx.fillStyle = scene.bg;
      ctx.fillRect(0, 0, W, H);
      // Variation patches
      const rng2 = seededRandom(penType.charCodeAt(0) * 7);
      for (let i = 0; i < 30; i++) {
        ctx.fillStyle = scene.bg2;
        const gx = rng2() * W, gy = rng2() * H;
        const gw = 16 + rng2() * 40, gh = 16 + rng2() * 40;
        ctx.fillRect(gx, gy, gw, gh);
      }
      // Grass tufts
      ctx.fillStyle = '#5a8a3a';
      for (let i = 0; i < 40; i++) {
        const gx = rng2() * W, gy = rng2() * H;
        ctx.fillRect(gx, gy, 2, 4);
        ctx.fillRect(gx + 2, gy - 1, 2, 5);
      }
    }

    function drawBuilding(ctx) {
      if (!scene.building) return;
      const img = imagesRef.current[scene.building.src];
      if (!img || !img.complete || !img.naturalWidth) return;
      const b = scene.building;
      if (b.sx !== undefined) {
        ctx.drawImage(img, b.sx, b.sy, b.sw, b.sh, 12, 30, b.w, b.h);
      } else {
        ctx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight, 12, 30, b.w, b.h);
      }
    }

    function drawExtra(ctx) {
      if (!scene.extra) return;
      const img = imagesRef.current[scene.extra.src];
      if (!img || !img.complete || !img.naturalWidth) return;
      const e = scene.extra;
      const ey = H * (e.yOff || 0.5);
      ctx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight, W - e.w - 20, ey, e.w, e.h);
    }

    function drawAnimal(ctx, pos, frame) {
      const sp = scene.sprites[pos.spriteIdx % scene.sprites.length];
      const img = imagesRef.current[sp.src];
      if (!img || !img.complete || !img.naturalWidth) return;

      const f = pos.moving ? frame % sp.frames : 0;
      const sx = f * sp.fw;
      const sy = (sp.row || 0) * sp.fh;
      const dw = sp.fw * (sp.scale || 1);
      const dh = sp.fh * (sp.scale || 1);

      ctx.save();
      const dx = pos.x + pos.offsetX;
      const dy = pos.y;
      if (pos.flip) {
        ctx.translate(dx + dw, dy);
        ctx.scale(-1, 1);
        ctx.drawImage(img, sx, sy, sp.fw, sp.fh, 0, 0, dw, dh);
      } else {
        ctx.drawImage(img, sx, sy, sp.fw, sp.fh, dx, dy, dw, dh);
      }
      ctx.restore();
    }

    function drawLocked(ctx) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#8b7355';
      ctx.font = 'bold 24px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('LOCKED', W / 2, H / 2 - 10);
      ctx.fillStyle = '#c4a882';
      ctx.font = '12px monospace';
      ctx.fillText('Hold more $RANCH to unlock', W / 2, H / 2 + 14);
    }

    function drawHealthBar(ctx, hp) {
      const bw = 60, bh = 8, bx = W - bw - 14, by = 10;
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
      ctx.fillStyle = hp > 50 ? '#4caf50' : hp > 25 ? '#d4a636' : '#b8461b';
      ctx.fillRect(bx, by, Math.max(0, bw * hp / 100), bh);
      ctx.fillStyle = '#e8dcc8';
      ctx.font = '8px monospace';
      ctx.textAlign = 'right';
      ctx.fillText(hp + '%', bx - 4, by + 7);
    }

    let running = true;
    let tick = 0;

    Promise.all(toLoad).then(() => {
      function render() {
        if (!running) return;
        tick++;
        const frame = Math.floor(tick / 12);

        // Move animals slightly
        positions.forEach(p => {
          if (p.moving && tick % 3 === 0) {
            p.offsetX += p.dir * p.speed;
            if (p.offsetX > 30) { p.dir = -1; p.flip = true; }
            if (p.offsetX < -30) { p.dir = 1; p.flip = false; }
            if (Math.random() < 0.005) p.moving = !p.moving;
          } else if (!p.moving && Math.random() < 0.01) {
            p.moving = true;
          }
        });

        drawGrass(ctx);
        drawFence(ctx);
        drawBuilding(ctx);
        drawExtra(ctx);
        positions.forEach(p => drawAnimal(ctx, p, frame));
        if (!unlocked) drawLocked(ctx);
        else if (health !== undefined) drawHealthBar(ctx, health);

        animRef.current = requestAnimationFrame(render);
      }
      render();
    });

    return () => { running = false; cancelAnimationFrame(animRef.current); };
  }, [penType, unlocked, health, count]);

  return (
    <div style={{ position: 'relative', width: '100%', maxWidth: 480, margin: '0 auto 8px' }}>
      <canvas
        ref={canvasRef}
        width={W}
        height={H}
        style={{
          width: '100%',
          height: 'auto',
          borderRadius: 8,
          border: '2px solid #2a1f14',
          imageRendering: 'pixelated',
        }}
      />
    </div>
  );
}

export default PenScene;
