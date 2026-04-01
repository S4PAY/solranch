// Holding Tier Multipliers
// These multiply on TOP of rank multipliers
// Total effective = rank_mult × hold_mult
const HOLD_TIERS = [
  { name: 'Drifter',      min: 0,        mult: 1,   level: 0 },
  { name: 'Settler',      min: 50000,    mult: 1.5, level: 1 },
  { name: 'Rancher',      min: 100000,   mult: 2,   level: 2 },
  { name: 'Stockman',     min: 500000,   mult: 3,   level: 3 },
  { name: 'Trail Boss',   min: 1000000,  mult: 4,   level: 4 },
  { name: 'Land Baron',   min: 10000000, mult: 5,   level: 5 },
];

function getHoldTier(tokenBalance) {
  let tier = HOLD_TIERS[0];
  for (const t of HOLD_TIERS) {
    if (tokenBalance >= t.min) tier = t;
  }
  return tier;
}

function getAllTiers() {
  return HOLD_TIERS;
}

module.exports = { getHoldTier, getAllTiers, HOLD_TIERS };
