const db = require('./src/db/init');

async function calculateFarmPoints() {
  const today = new Date().toISOString().split('T')[0];
  console.log('[FARM-CRON] Calculating daily farm points for', today);

  // Get all wallets with placed items
  const wallets = await db.query('SELECT DISTINCT wallet FROM ranchers WHERE wallet IS NOT NULL');
  let totalAwarded = 0;

  for (const row of wallets.rows) {
    const w = row.wallet;
    let farmPts = 0;

    // Buildings: 1 pt per 50k burn_cost_base
    const buildings = await db.query(
      `SELECT COALESCE(SUM(bt.burn_cost_base), 0) as total_cost
       FROM ranch_buildings b JOIN building_types bt ON bt.name = b.building_type
       WHERE b.wallet = $1`, [w]
    );
    const buildingPts = parseInt(buildings.rows[0].total_cost) / 50000;

    // Animals: only if fed in last 24h
    const fedCheck = await db.query(
      "SELECT id FROM ranch_feed_log WHERE wallet = $1 AND fed_at > NOW() - INTERVAL '24 hours'", [w]
    );
    let animalPts = 0;
    if (fedCheck.rows.length > 0) {
      const animals = await db.query(
        `SELECT COALESCE(SUM(at.daily_pts), 0) as total
         FROM ranch_animals a JOIN animal_types at ON at.name = a.animal_type
         WHERE a.wallet = $1`, [w]
      );
      animalPts = parseFloat(animals.rows[0].total);
    }

    // Machines
    const machines = await db.query(
      `SELECT COALESCE(SUM(mt.daily_pts), 0) as total
       FROM ranch_machines m JOIN machine_types mt ON mt.name = m.machine_type
       WHERE m.wallet = $1`, [w]
    );
    const machinePts = parseFloat(machines.rows[0].total);

    // Decorations
    const decos = await db.query(
      `SELECT COALESCE(SUM(dt.daily_pts), 0) as total
       FROM ranch_decorations d JOIN deco_types dt ON dt.name = d.deco_type
       WHERE d.wallet = $1`, [w]
    );
    const decoPts = parseFloat(decos.rows[0].total);

    farmPts = buildingPts + animalPts + machinePts + decoPts;
    if (farmPts <= 0) continue;

    farmPts = Math.round(farmPts);
    if (farmPts < 1 && (buildingPts + animalPts + machinePts + decoPts) > 0) farmPts = 1;

    // Get rancher id
    const rancher = await db.query('SELECT id FROM ranchers WHERE wallet = $1', [w]);
    if (!rancher.rows.length) continue;
    const rid = rancher.rows[0].id;

    // Log to ranch_points_log
    await db.query(
      "INSERT INTO ranch_points_log (wallet, source_category, source_type, points) VALUES ($1, 'farm', 'daily_passive', $2)",
      [w, farmPts]
    );

    // Add to daily_points
    await db.query(
      `INSERT INTO daily_points (rancher_id, day_date, total_pts)
       VALUES ($1, $2, $3)
       ON CONFLICT (rancher_id, day_date) DO UPDATE SET total_pts = daily_points.total_pts + $3`,
      [rid, today, farmPts]
    );

    // Update lifetime
    await db.query(
      'UPDATE ranchers SET lifetime_pts = lifetime_pts + $1 WHERE id = $2',
      [farmPts, rid]
    );

    console.log('[FARM-CRON] ' + w.slice(0,8) + '... +' + farmPts + ' pts (bldg:' + buildingPts.toFixed(1) + ' animal:' + animalPts.toFixed(1) + ' machine:' + machinePts.toFixed(1) + ' deco:' + decoPts.toFixed(1) + ')');
    totalAwarded++;
  }

  console.log('[FARM-CRON] Done. Awarded points to ' + totalAwarded + ' ranchers.');
}

calculateFarmPoints()
  .then(() => process.exit(0))
  .catch(err => { console.error('[FARM-CRON] Fatal:', err); process.exit(1); });
