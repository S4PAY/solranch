import React, { useEffect, useRef, useState, useCallback } from "react";
import Phaser from "phaser";

var API_BASE = window.location.origin + "/dev/api";
async function api(path, opts) {
  try {
    var res = await fetch(API_BASE + path, Object.assign({ headers: { "Content-Type": "application/json" } }, opts || {}));
    return await res.json();
  } catch (err) { console.error("API error:", err); return null; }
}

var TILE = 16;
var MAP = 64;
var CHUNK = 8;
var CHUNKS = MAP / CHUNK;
var MAP_PX = MAP * TILE;
var START_CHUNKS = ["3,3", "3,4", "4,3", "4,4"];

function chunkRing(cx, cy) {
  var d = Math.max(Math.abs(cx - 3.5), Math.abs(cy - 3.5));
  if (d <= 1) return 0;
  if (d <= 2) return 1;
  if (d <= 3) return 2;
  return 3;
}

var RING_COST = [0, 25000, 50000, 100000, 250000];

// Seconds to fully grow each crop (dev times — multiply x60 for production)
var CROP_GROW_SECONDS = {
  crop_carrot: 7200, crop_tomato: 14400, crop_strawberry: 28800, crop_potato: 7200, crop_watermelon: 86400, crop_radish: 3600,
};


// --- ANIMAL SPRITE DEFINITIONS ---
// All animals: 4 cols, 5 rows (walk down/right/up/left + sleep)
var ANIMALS = {
  chicken:       { file: "chicken.png",       fw: 16, fh: 16 },
  chicken_brown: { file: "chicken_brown.png", fw: 16, fh: 16 },
  chick:         { file: "chick.png",         fw: 16, fh: 16 },
  cow:           { file: "cow.png",           fw: 24, fh: 24 },
  cow_black:     { file: "cow_black.png",     fw: 24, fh: 24 },
  cow_brown:     { file: "cow_brown.png",     fw: 24, fh: 24 },
  goat:          { file: "goat.png",          fw: 19, fh: 19 },
  pig:           { file: "pig.png",           fw: 20, fh: 20 },
  sheep:         { file: "sheep.png",         fw: 17, fh: 17 },
  turkey:        { file: "turkey.png",        fw: 17, fh: 17 },
};


// --- MACHINE SPRITE DEFINITIONS ---
var MACHINES = {
  butterchurn:  { file: "butterchurn_sheet.png",  frames: 2 },
  clothmaker:   { file: "clothmaker_sheet.png",   frames: 37 },
  mayomaker:    { file: "mayomaker_sheet.png",     frames: 2 },
  spindle:      { file: "spindle_sheet.png",       frames: 8 },
};

// --- BUILDINGS / PLACEABLE ITEMS ---
var BUILDINGS = {
  // Farm buildings (from buildings/*.png)
  barn:         { w: 5, h: 5, cost: 25000,  label: "Barn",        sprite: "b_barn",       cat: "farm" },
  coop:         { w: 4, h: 4, cost: 15000,  label: "Coop",        sprite: "b_coop",       cat: "farm" },
  greenhouse:   { w: 7, h: 5, cost: 50000,  label: "Greenhouse",  sprite: "b_greenhouse", cat: "farm" },
  market:       { w: 6, h: 5, cost: 100000, label: "Market",      sprite: "b_market",     cat: "farm" },
  hospital:     { w: 9, h: 7, cost: 75000,  label: "Hospital",    sprite: "b_hospital",   cat: "farm" },
  museum:       { w: 8, h: 7, cost: 80000,  label: "Museum",      sprite: "b_museum",     cat: "farm" },
  slimehut:     { w: 5, h: 5, cost: 40000,  label: "Slime Hut",   sprite: "b_slimehut",   cat: "farm" },
  // Houses (from buildings/*.png)
  house:        { w: 4, h: 5, cost: 0,      label: "House",       sprite: "b_house",      cat: "home" },
  npc1:         { w: 5, h: 5, cost: 30000,  label: "Cottage A",   sprite: "b_npc1",       cat: "home" },
  npc2:         { w: 5, h: 5, cost: 30000,  label: "Cottage B",   sprite: "b_npc2",       cat: "home" },
  npc3:         { w: 5, h: 5, cost: 30000,  label: "Cottage C",   sprite: "b_npc3",       cat: "home" },
  npc4:         { w: 6, h: 5, cost: 35000,  label: "Villa A",     sprite: "b_npc4",       cat: "home" },
  npc5:         { w: 6, h: 5, cost: 35000,  label: "Villa B",     sprite: "b_npc5",       cat: "home" },
  npc6:         { w: 6, h: 4, cost: 35000,  label: "Lodge A",     sprite: "b_npc6",       cat: "home" },
  npc7:         { w: 6, h: 4, cost: 35000,  label: "Lodge B",     sprite: "b_npc7",       cat: "home" },
  // Machines (from machines/*.png, all 16x32 = 1x2 tiles)
  butterchurn:  { w: 1, h: 2, cost: 10000,  label: "Butter Churn",  sprite: "m_butterchurn",  cat: "machine", machine: true },
  mayomaker:    { w: 1, h: 2, cost: 10000,  label: "Mayo Maker",    sprite: "m_mayomaker",    cat: "machine", machine: true },
  clothmaker:   { w: 1, h: 2, cost: 12000,  label: "Cloth Maker",   sprite: "m_clothmaker",   cat: "machine", machine: true },
  spindle:      { w: 1, h: 2, cost: 8000,   label: "Spindle",       sprite: "m_spindle",      cat: "machine", machine: true },
  // Animals (from animals/*.png spritesheets — use first walk-down frame)
  chicken:      { w: 1, h: 1, cost: 5000,   label: "Chicken",       sprite: "a_chicken",       cat: "animal", animal: true },
  chicken_b:    { w: 1, h: 1, cost: 3000,   label: "Brown Chicken", sprite: "a_chicken_brown", cat: "animal", animal: true },
  chick:        { w: 1, h: 1, cost: 2000,   label: "Baby Chick",    sprite: "a_chick",         cat: "animal", animal: true },
  cow:          { w: 2, h: 2, cost: 15000,  label: "Cow",           sprite: "a_cow",           cat: "animal", animal: true },
  cow_black:    { w: 2, h: 2, cost: 15000,  label: "Black Cow",     sprite: "a_cow_black",     cat: "animal", animal: true },
  cow_brown:    { w: 2, h: 2, cost: 15000,  label: "Brown Cow",     sprite: "a_cow_brown",     cat: "animal", animal: true },
  pig:          { w: 2, h: 2, cost: 10000,  label: "Pig",           sprite: "a_pig",           cat: "animal", animal: true },
  sheep:        { w: 2, h: 2, cost: 12000,  label: "Sheep",         sprite: "a_sheep",         cat: "animal", animal: true },
  goat:         { w: 2, h: 2, cost: 12000,  label: "Goat",          sprite: "a_goat",          cat: "animal", animal: true },
  turkey:       { w: 2, h: 2, cost: 8000,   label: "Turkey",        sprite: "a_turkey",        cat: "animal", animal: true },
  // Crops (from crops/*.png extracted mature frames)
  crop_carrot:      { w: 1, h: 1, cost: 2000, label: "Carrot",      sprite: "c_crops",      cat: "crop", crop: true, cropRow: 0 },
  crop_tomato:      { w: 1, h: 1, cost: 2000, label: "Tomato",      sprite: "c_crops",      cat: "crop", crop: true, cropRow: 1 },
  crop_strawberry:  { w: 1, h: 1, cost: 3000, label: "Strawberry",  sprite: "c_crops",  cat: "crop", crop: true, cropRow: 2 },
  crop_potato:      { w: 1, h: 1, cost: 2000, label: "Potato",      sprite: "c_crops",      cat: "crop", crop: true, cropRow: 5 },
  crop_watermelon:  { w: 1, h: 1, cost: 5000, label: "Watermelon",  sprite: "c_crops",  cat: "crop", crop: true, cropRow: 6 },
  crop_radish:      { w: 1, h: 1, cost: 1500, label: "Radish",      sprite: "c_crops",      cat: "crop", crop: true, cropRow: 7 },
  // Nature (from deco/*.png extractions)
  tree1:        { w: 2, h: 2, cost: 2000,  label: "Tree",     sprite: "d_tree1",        cat: "nature" },
  tree2:        { w: 2, h: 2, cost: 2000,  label: "Pine Tree",   sprite: "d_tree2",        cat: "nature" },
  flower_blue:  { w: 1, h: 1, cost: 500,   label: "Blue Flower",  sprite: "d_flower_blue",  cat: "nature" },
  flower_white: { w: 1, h: 1, cost: 500,   label: "White Flower", sprite: "d_flower_white", cat: "nature" },
  // Decorations
  scarecrow:    { w: 1, h: 2, cost: 2000,  label: "Scarecrow",    sprite: "d_scarecrow",    cat: "deco" },
  woodfence:    { w: 1, h: 1, cost: 500,   label: "Wood Fence",   sprite: "d_woodfence",    cat: "deco" },
  stonefence:   { w: 1, h: 1, cost: 1000,  label: "Stone Fence",  sprite: "d_stonefence",   cat: "deco" },
  gate_wood:    { w: 1, h: 1, cost: 1500,  label: "Wood Gate",    sprite: "d_gate_wood",    cat: "deco" },
  gate_stone:   { w: 1, h: 1, cost: 2000,  label: "Stone Gate",   sprite: "d_gate_stone",   cat: "deco" },
};



// Map DB names to BUILDINGS keys
var DB_TO_KEY = {};
(function() {
  // Direct matches
  Object.keys(BUILDINGS).forEach(function(k) { DB_TO_KEY[k] = k; });
  // Machines: DB uses underscores
  DB_TO_KEY["butter_churn"] = "butterchurn";
  DB_TO_KEY["mayo_maker"] = "mayomaker";
  DB_TO_KEY["cloth_maker"] = "clothmaker";
  // Crops: DB has no prefix
  DB_TO_KEY["radish"] = "crop_radish";
  DB_TO_KEY["carrot"] = "crop_carrot";
  DB_TO_KEY["potato"] = "crop_potato";
  DB_TO_KEY["tomato"] = "crop_tomato";
  DB_TO_KEY["strawberry"] = "crop_strawberry";
  DB_TO_KEY["watermelon"] = "crop_watermelon";
  // Deco: DB uses underscores
  DB_TO_KEY["wood_fence"] = "woodfence";
  DB_TO_KEY["stone_fence"] = "stonefence";
  DB_TO_KEY["flower_blue"] = "flower_blue";
  DB_TO_KEY["flower_white"] = "flower_white";
  DB_TO_KEY["gate_wood"] = "gate_wood";
  DB_TO_KEY["gate_stone"] = "gate_stone";
  DB_TO_KEY["chicken_brown"] = "chicken_b";
})();
function dbToKey(name) { return DB_TO_KEY[name] || name; }

function getTier(pts) {
  if (pts >= 50000) return { name: "Diamond", color: "#b9f2ff", next: null };
  if (pts >= 20000) return { name: "Platinum", color: "#e5e4e2", next: 50000 };
  if (pts >= 10000) return { name: "Gold", color: "#ffd700", next: 20000 };
  if (pts >= 5000) return { name: "Silver", color: "#c0c0c0", next: 10000 };
  if (pts >= 1000) return { name: "Bronze", color: "#cd7f32", next: 5000 };
  return { name: "Starter", color: "#8b7355", next: 1000 };
}

function getHoldings(buildings) {
  var counts = { buildings: 0, animals: 0, crops: 0, deco: 0 };
  for (var i = 0; i < buildings.length; i++) {
    var def = BUILDINGS[buildings[i].type];
    if (!def) continue;
    if (def.animal) counts.animals++;
    else if (def.crop) counts.crops++;
    else if (def.cat === "deco" || def.cat === "nature") counts.deco++;
    else counts.buildings++;
  }
  return counts;
}

function CropProgress({ building }) {
  var _s = React.useState(Date.now());
  var now = _s[0], setNow = _s[1];
  React.useEffect(function() {
    var iv = setInterval(function() { setNow(Date.now()); }, 500);
    return function() { clearInterval(iv); };
  }, []);
  var elapsed = (now - building.plantedAt) / 1000;
  var total = CROP_GROW_SECONDS[building.type] || 60;
  var pct = Math.min(100, Math.floor((elapsed / total) * 100));
  var mature = elapsed >= total;
  var remaining = Math.max(0, Math.ceil(total - elapsed));
  var timeStr = remaining >= 3600 ? Math.floor(remaining/3600) + "h " + Math.floor((remaining%3600)/60) + "m" : remaining >= 60 ? Math.floor(remaining/60) + "m " + (remaining%60) + "s" : remaining + "s";
  return React.createElement("div", { style: { marginBottom: 12, textAlign: "center" } },
    React.createElement("div", { style: { fontSize: 12, color: mature ? "#4eff4e" : "#ffd060", marginBottom: 4 } }, mature ? "READY TO HARVEST! Tap crop on map." : timeStr + " remaining"),
    React.createElement("div", { style: { width: "100%", height: 8, background: "rgba(90,74,42,0.4)", borderRadius: 4 } },
      React.createElement("div", { style: { width: pct + "%", height: "100%", background: mature ? "#4eff4e" : "linear-gradient(90deg,#8b6914,#ffd060)", borderRadius: 4, transition: "width 0.5s" } })
    ),
    React.createElement("div", { style: { fontSize: 10, color: "#6a5828", marginTop: 4 } }, pct + "% grown")
  );
}

function EditContent({ building, onMove, onRemove }) {
  var def = BUILDINGS[building.type] || {};
  return React.createElement("div", { style: { textAlign: "center", marginTop: 10 } },
    React.createElement("div", { style: { fontSize: 20, fontWeight: 700, color: "#e8ddd0", marginBottom: 4, textShadow: "0 1px 2px rgba(0,0,0,0.5)" } }, def.label || building.type),
    React.createElement("div", { style: { fontSize: 11, color: "#9c8e78", marginBottom: 8 } }, "Position: (" + building.tx + ", " + building.ty + ")"),
    building.plantedAt && React.createElement(CropProgress, { building: building }),
    React.createElement("button", { onClick: onMove, style: { display: "block", width: "100%", padding: "10px", marginBottom: 8, background: "linear-gradient(180deg,#4a6a2a,#3a5a1a)", color: "#fff", border: "2px solid #6a8a3a", borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: "pointer" } }, "MOVE"),
    React.createElement("button", { onClick: onRemove, style: { display: "block", width: "100%", padding: "10px", background: "linear-gradient(180deg,#8a2a2a,#6a1a1a)", color: "#fff", border: "2px solid #aa4a4a", borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: "pointer" } }, "REMOVE"),
    React.createElement("div", { style: { fontSize: 10, color: "#5a4a2a", marginTop: 10 } }, "(Prototype - no refund in dev)")
  );
}


// ─── WALLET SCREEN ───
function NameModal({ currentName, onSave, onCancel, isNew }) {
  var _ns = React.useState(currentName || "");
  var name = _ns[0], setName = _ns[1];
  return React.createElement("div", {
    style: { position: "fixed", top: 0, left: 0, width: "100vw", height: "100vh", background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200 },
    onClick: isNew ? undefined : onCancel,
  },
    React.createElement("div", {
      onClick: function(e) { e.stopPropagation(); },
      style: { background: "#161210", border: "1px solid #2a1f14", borderRadius: 8, padding: 32, maxWidth: 400, width: "90%", textAlign: "center", fontFamily: "'Pixelify Sans', sans-serif" }
    },
      React.createElement("div", { style: { fontSize: 22, color: "#d4a636", fontWeight: 700, marginBottom: 8 } }, isNew ? "Name Your Ranch" : "Rename Your Ranch"),
      React.createElement("div", { style: { fontSize: 11, color: "#9c8e78", marginBottom: 20, lineHeight: 1.6 } }, isNew ? "Every ranch needs a name, partner. Choose wisely." : "Give your ranch a new name. 2-24 characters."),
      React.createElement("input", {
        type: "text", value: name, placeholder: "Dusty Trails...", autoFocus: true,
        onChange: function(e) { setName(e.target.value.slice(0, 24)); },
        onKeyDown: function(e) { if (e.key === "Enter" && name.length >= 2) onSave(name.trim()); },
        style: { width: "100%", padding: "12px 16px", background: "#1a1510", border: "1px solid #2a1f14", borderRadius: 4, color: "#e8ddd0", fontFamily: "'Pixelify Sans', sans-serif", fontSize: 14, textAlign: "center", letterSpacing: 1, outline: "none", boxSizing: "border-box", marginBottom: 8 }
      }),
      React.createElement("div", { style: { fontSize: 10, color: "#6d5838", marginBottom: 16 } }, name.length + "/24"),
      React.createElement("div", { style: { display: "flex", gap: 8, justifyContent: "center" } },
        !isNew && React.createElement("button", {
          onClick: onCancel,
          style: { padding: "10px 20px", background: "linear-gradient(180deg,#5c4a32,#4a3a28)", border: "none", borderRadius: 4, color: "#e8ddd0", fontSize: 13, fontWeight: 700, cursor: "pointer", letterSpacing: 2 }
        }, "CANCEL"),
        React.createElement("button", {
          onClick: function() { if (name.length >= 2) onSave(name.trim()); },
          disabled: name.length < 2,
          style: {
            padding: "10px 24px", border: "none", borderRadius: 4, color: "#e8ddd0", fontSize: 13, fontWeight: 700, cursor: name.length >= 2 ? "pointer" : "default", letterSpacing: 2, opacity: name.length < 2 ? 0.5 : 1,
            background: "repeating-linear-gradient(0deg,transparent,transparent 3px,rgba(0,0,0,.06) 3px,rgba(0,0,0,.06) 4px),linear-gradient(180deg,#8b5e3c,#6d4a2d 50%,#5c3f24)",
            boxShadow: "inset 0 1px 0 rgba(180,140,90,.3),inset 0 -1px 0 rgba(0,0,0,.4),0 2px 4px rgba(0,0,0,.4)",
          }
        }, isNew ? "STAKE YOUR CLAIM" : "RENAME")
      )
    )
  );
}

function WalletScreen({ walletInput, setWalletInput, onConnect }) {
  return React.createElement("div", {
    style: {
      position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "radial-gradient(ellipse at center, #1a1510, #0e0b08)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", zIndex: 100, fontFamily: "'Pixelify Sans', sans-serif", gap: 16, padding: 24, boxSizing: "border-box", overflow: "hidden",
    }
  },
    React.createElement("div", { style: { fontSize: 36, color: "#d4a636", fontWeight: 900, letterSpacing: 4, textShadow: "0 3px 0 rgba(26,21,15,0.8), 0 0 30px rgba(212,166,54,0.2)" } }, "SOL RANCH"),
    React.createElement("div", { style: { width: 60, height: 1, background: "linear-gradient(90deg, transparent, #d4a636, transparent)", margin: "4px 0" } }),
    React.createElement("div", { style: { fontSize: 13, color: "#9c8e78", letterSpacing: 3, textTransform: "uppercase" } }, "Virtual Ranch for Degens"),
    React.createElement("div", { style: { width: "calc(100% - 48px)", maxWidth: 340, marginTop: 16 } },
      React.createElement("input", {
        type: "text", placeholder: "Paste your Solana wallet address...",
        value: walletInput,
        onChange: function(e) { setWalletInput(e.target.value); },
        onKeyDown: function(e) { if (e.key === "Enter") onConnect(); },
        style: {
          width: "100%", padding: "14px 18px", boxSizing: "border-box",
          background: "#1a1510", border: "2px solid #2a1f14", borderRadius: 8,
          color: "#e8ddd0", fontFamily: "'Pixelify Sans', sans-serif", fontSize: 13,
          textAlign: "center", letterSpacing: 0.5, outline: "none",
        }
      }),
      React.createElement("button", {
        onClick: onConnect,
        style: {
          width: "100%", marginTop: 12, padding: "12px 0",
          color: "#e8ddd0", border: "none", borderRadius: 8,
          fontSize: 15, fontWeight: 700, cursor: "pointer", letterSpacing: 3,
          background: "repeating-linear-gradient(0deg,transparent,transparent 3px,rgba(0,0,0,.06) 3px,rgba(0,0,0,.06) 4px),linear-gradient(180deg,#8b5e3c,#6d4a2d 50%,#5c3f24)",
          boxShadow: "inset 0 1px 0 rgba(180,140,90,.3),inset 0 -1px 0 rgba(0,0,0,.4),0 4px 12px rgba(0,0,0,.5)",
          textShadow: "0 1px 2px rgba(0,0,0,0.5)",
        }
      }, "ENTER RANCH")
    ),
    React.createElement("div", { style: { fontSize: 11, color: "#6d5838", marginTop: 8, maxWidth: 340, textAlign: "center", lineHeight: 1.6 } },
      "Paste your Solana wallet address to start earning weekly USDC rewards. No wallet connection needed."
    )
  );
}

// ─── MENU OVERLAY ───
// ─── TASKS PANEL ───
// ─── PENS PANEL ───
// ─── STATS PANEL ───
// ─── LEADERBOARD PANEL ───
// ─── REWARDS PANEL ───
// ─── RAIDS PANEL ───
// --- SPRITE THUMBNAIL PATHS ---
var SPRITE_BASE = (typeof window !== "undefined" && import.meta.env.BASE_URL || "/dev/") + "sprites/game/";
var SPRITE_PATHS = {
  b_barn: "buildings/barn.png", b_coop: "buildings/coop.png", b_greenhouse: "buildings/greenhouse.png",
  b_house: "buildings/house_player.png", b_market: "buildings/market.png", b_hospital: "buildings/hospital.png",
  b_museum: "buildings/museum.png", b_slimehut: "buildings/slimehut.png",
  b_npc1: "buildings/NPC1.png", b_npc2: "buildings/NPC2.png", b_npc3: "buildings/NPC3.png",
  b_npc4: "buildings/NPC4.png", b_npc5: "buildings/NPC5.png", b_npc6: "buildings/NPC6.png", b_npc7: "buildings/NPC7.png",
  m_butterchurn: "machines/butterchurn.png", m_mayomaker: "machines/mayomaker.png",
  m_clothmaker: "machines/clothmaker.png", m_spindle: "machines/spindle.png",
  a_chicken: "animals/chicken.png", a_chicken_brown: "animals/chicken_brown.png", a_chick: "animals/chick.png",
  a_cow: "animals/cow.png", a_cow_black: "animals/cow_black.png", a_cow_brown: "animals/cow_brown.png",
  a_goat: "animals/goat.png", a_pig: "animals/pig.png", a_sheep: "animals/sheep.png", a_turkey: "animals/turkey.png",
  d_tree1: "deco/tree1.png", d_tree2: "deco/tree2.png",
  d_flower_blue: "deco/flower_spring_blue.png", d_flower_white: "deco/flower_spring_white.png",
  d_scarecrow: "deco/scarecrow.png", d_woodfence: "deco/fence_wood.png", d_stonefence: "deco/fence_stone.png",
  d_gate_wood: "deco/gate_wood_spring.png", d_gate_stone: "deco/gate_stone.png",
};

var CAT_TITLES = {
  farm: "Farm Buildings", home: "Houses", machine: "Machines",
  animal: "Animals", crop: "Crops", nature: "Nature", deco: "Decorations",
};

function formatGrowTime(sec) {
  if (sec >= 3600) return Math.floor(sec / 3600) + "h";
  if (sec >= 60) return Math.floor(sec / 60) + "m";
  return sec + "s";
}

function ItemRow({ left, right, sub }) {
  return React.createElement("div", { style: { padding: "6px 0", borderBottom: "1px solid rgba(61,46,30,0.3)" } },
    React.createElement("div", { style: { display: "flex", justifyContent: "space-between" } },
      React.createElement("span", { style: { fontSize: 13, fontWeight: 700, color: "#e8ddd0" } }, left),
      React.createElement("span", { style: { fontSize: 11, color: "#f0c040" } }, right)
    ),
    sub && React.createElement("div", { style: { fontSize: 10, color: "#9c8e78", marginTop: 2 } }, sub)
  );
}

function SectionTitle({ text }) {
  return React.createElement("div", {
    style: { fontSize: 11, color: "#9c8e78", textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 6, marginTop: 10, borderBottom: "1px solid rgba(61,46,30,0.4)", paddingBottom: 4 }
  }, text);
}

function CropThumb({ cropRow }) {
  return React.createElement("div", {
    style: {
      width: 16, height: 16, imageRendering: "pixelated",
      backgroundImage: "url(" + SPRITE_BASE + "crops/crops.png)",
      backgroundPosition: "-80px -" + (cropRow * 16) + "px",
      backgroundSize: "96px auto",
      display: "inline-block", verticalAlign: "middle",
      transform: "scale(1.8)", transformOrigin: "center",
    }
  });
}

function AnimalThumb({ sprite }) {
  var ad = null;
  var animalKeys = Object.keys(ANIMALS);
  for (var i = 0; i < animalKeys.length; i++) {
    if ("a_" + animalKeys[i] === sprite) { ad = ANIMALS[animalKeys[i]]; break; }
  }
  if (!ad) return null;
  var path = SPRITE_PATHS[sprite];
  if (!path) return null;
  return React.createElement("div", {
    style: {
      width: ad.fw, height: ad.fh, imageRendering: "pixelated",
      backgroundImage: "url(" + SPRITE_BASE + path + ")",
      backgroundPosition: "0px 0px", backgroundSize: "auto",
      display: "inline-block", verticalAlign: "middle",
      transform: "scale(" + (28 / ad.fw) + ")", transformOrigin: "center",
    }
  });
}

function SpriteThumb({ sprite }) {
  var path = SPRITE_PATHS[sprite];
  if (!path) return null;
  return React.createElement("img", {
    src: SPRITE_BASE + path,
    style: { width: 24, height: 24, imageRendering: "pixelated", objectFit: "contain" }
  });
}

function ItemThumb({ def }) {
  if (def.crop) return React.createElement(CropThumb, { cropRow: def.cropRow });
  if (def.animal) return React.createElement(AnimalThumb, { sprite: def.sprite });
  return React.createElement(SpriteThumb, { sprite: def.sprite });
}

function CategoryContent({ cats, placing, onPlace }) {
  var allItems = [];
  Object.keys(BUILDINGS).forEach(function(key) {
    var b = BUILDINGS[key];
    if (cats.indexOf(b.cat) >= 0) allItems.push({ key: key, def: b });
  });
  var [page, setPage] = React.useState(0);
  var perPage = Math.max(1, Math.min(4, Math.floor((window.innerWidth - 100) / 100)));
  var totalPages = Math.ceil(allItems.length / perPage);
  var visible = allItems.slice(page * perPage, page * perPage + perPage);
  React.useEffect(function() { setPage(0); }, [cats.join(",")]);

  return React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 6, position: "relative" } },
    React.createElement("button", {
      onClick: function() { setPage(Math.max(0, page - 1)); },
      style: {
        width: 36, height: 36, borderRadius: "50%", border: "2px solid #2a1f14", flexShrink: 0,
        background: page > 0 ? "radial-gradient(circle at 30% 30%, #5a4a2a, #2a1f14)" : "rgba(20,16,10,0.5)",
        color: page > 0 ? "#f0c040" : "#3d2e1e", fontSize: 18, fontWeight: 700, cursor: page > 0 ? "pointer" : "default",
        display: "flex", alignItems: "center", justifyContent: "center",
        boxShadow: page > 0 ? "0 3px 8px rgba(0,0,0,0.5)" : "none",
      }
    }, "\u25C0"),
    React.createElement("div", { style: { display: "flex", gap: 8, flex: 1, justifyContent: "center" } },
      visible.map(function(item) {
        var cost = item.def.cost >= 1000 ? (item.def.cost / 1000) + "k" : String(item.def.cost);
        var active = placing === item.key;
        return React.createElement("div", {
          key: item.key, onClick: function() { onPlace(item.key); },
          style: {
            width: 90, padding: "10px 4px 8px", borderRadius: 12, cursor: "pointer", textAlign: "center",
            background: active ? "linear-gradient(180deg, rgba(212,166,54,0.25), rgba(139,105,20,0.2))" : "linear-gradient(180deg, rgba(31,26,20,0.92), rgba(22,18,16,0.92))",
            backdropFilter: "blur(8px)",
            border: active ? "2px solid #d4a636" : "2px solid #2a1f14",
            boxShadow: active ? "0 0 14px rgba(212,166,54,0.4), 0 4px 12px rgba(0,0,0,0.5)" : "0 4px 12px rgba(0,0,0,0.5)",
            flexShrink: 0,
          }
        },
          React.createElement("div", {
            style: { width: 48, height: 48, borderRadius: 8, margin: "0 auto 6px", background: "radial-gradient(circle at 50% 40%, #2a2418, #1a1510)", border: "1px solid #2a1f14", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "inset 0 2px 6px rgba(0,0,0,0.4)", overflow: "hidden" }
          }, React.createElement(ItemThumb, { def: item.def })),
          React.createElement("div", { style: { fontSize: 10, fontWeight: 700, color: "#e8ddd0", lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, item.def.label),
          React.createElement("div", { style: { fontSize: 8, color: "#6d5838", marginTop: 1 } }, item.def.w + "x" + item.def.h),
          React.createElement("div", {
            style: { marginTop: 4, display: "inline-block", padding: "2px 8px", borderRadius: 10, background: item.def.cost === 0 ? "linear-gradient(180deg, #3a5a2a, #2d4a20)" : "linear-gradient(180deg, #5a4210, #3d2e1e)", border: item.def.cost === 0 ? "1px solid #4a7a2e" : "1px solid #8b6914" }
          },
            React.createElement("span", { style: { fontSize: 9, fontWeight: 700, color: item.def.cost === 0 ? "#8bc34a" : "#f0c040" } }, cost === "0" ? "FREE" : cost),
            item.def.cost > 0 && React.createElement("span", { style: { fontSize: 7, color: "#9c8e78", marginLeft: 2 } }, "$R")
          ),
          item.def.crop && CROP_GROW_SECONDS[item.key] && React.createElement("div", { style: { fontSize: 7, color: "#6d5838", marginTop: 2 } }, formatGrowTime(CROP_GROW_SECONDS[item.key]))
        );
      })
    ),
    React.createElement("button", {
      onClick: function() { setPage(Math.min(totalPages - 1, page + 1)); },
      style: {
        width: 36, height: 36, borderRadius: "50%", border: "2px solid #2a1f14", flexShrink: 0,
        background: page < totalPages - 1 ? "radial-gradient(circle at 30% 30%, #5a4a2a, #2a1f14)" : "rgba(20,16,10,0.5)",
        color: page < totalPages - 1 ? "#f0c040" : "#3d2e1e", fontSize: 18, fontWeight: 700, cursor: page < totalPages - 1 ? "pointer" : "default",
        display: "flex", alignItems: "center", justifyContent: "center",
        boxShadow: page < totalPages - 1 ? "0 3px 8px rgba(0,0,0,0.5)" : "none",
      }
    }, "\u25B6"),
    React.createElement("div", {
      style: { position: "absolute", bottom: -14, left: "50%", transform: "translateX(-50%)", display: "flex", gap: 4 }
    },
      Array.from({ length: totalPages }, function(_, i) {
        return React.createElement("div", { key: i, style: { width: i === page ? 12 : 6, height: 6, borderRadius: 3, background: i === page ? "#f0c040" : "#2a1f14" } });
      })
    )
  );
}


function BurnPopup({ item, cat, wallet, onClose, onSuccess }) {
  var _tx = React.useState("");
  var txSig = _tx[0], setTxSig = _tx[1];
  var _sub = React.useState(false);
  var submitting = _sub[0], setSubmitting = _sub[1];
  var _err = React.useState(null);
  var err = _err[0], setErr = _err[1];
  var cost = parseInt(item.burn_cost);
  var costStr = cost >= 1000000 ? (cost/1000000)+"M" : cost >= 1000 ? (cost/1000)+"k" : String(cost);
  var BURN_ADDR = "1nc1nerator11111111111111111111111111111111";

  var CAT_MAP = { buildings: "building", animals: "animal", crops: "crop", machines: "machine", decorations: "deco" };
  function doBuy() {
    if (!txSig.trim()) { setErr("Paste your TX signature"); return; }
    setSubmitting(true); setErr(null);
    api("/farm/buy", { method: "POST", body: JSON.stringify({ wallet: wallet, itemCategory: CAT_MAP[cat] || cat, itemType: item.name, quantity: 1, txSignature: txSig.trim() }) })
      .then(function(data) {
        setSubmitting(false);
        if (!data) { setErr("Request failed"); return; }
        if (data.error) { setErr(data.error); return; }
        onSuccess(data);
      });
  }

  return React.createElement("div", {
    style: { position: "fixed", top: 0, left: 0, width: "100vw", height: "100vh", background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, padding: 16, boxSizing: "border-box" },
    onClick: onClose,
  },
    React.createElement("div", {
      onClick: function(e) { e.stopPropagation(); },
      style: { background: "linear-gradient(180deg, #1a1510, #0e0b08)", border: "2px solid #3d2e1e", borderRadius: 12, padding: 24, maxWidth: 380, width: "100%", textAlign: "center", fontFamily: "'Pixelify Sans', sans-serif" }
    },
      React.createElement("div", { style: { fontSize: 18, color: "#d4a636", fontWeight: 700, marginBottom: 4, letterSpacing: 2 } }, "BUY " + item.name.replace(/_/g, " ").toUpperCase()),
      React.createElement("div", { style: { fontSize: 28, color: "#f0c040", fontWeight: 700, margin: "12px 0", textShadow: "0 0 16px rgba(240,192,64,0.3)" } }, costStr + " $RANCH"),
      React.createElement("div", { style: { fontSize: 11, color: "#9c8e78", marginBottom: 16, lineHeight: 1.6 } }, "Burn tokens to buy this item. Send exact amount to the burn address below, then paste the TX signature."),
      React.createElement("div", { style: { fontSize: 9, color: "#6d5838", letterSpacing: 1, marginBottom: 4 } }, "BURN ADDRESS"),
      React.createElement("div", {
        onClick: function() { try { navigator.clipboard.writeText(BURN_ADDR); } catch(e) {} },
        style: { fontSize: 10, color: "#e8ddd0", background: "#0e0b08", border: "1px solid #2a1f14", borderRadius: 6, padding: "8px 10px", marginBottom: 12, wordBreak: "break-all", cursor: "pointer", userSelect: "all" }
      }, BURN_ADDR),
      React.createElement("div", { style: { fontSize: 9, color: "#6d5838", letterSpacing: 1, marginBottom: 4 } }, "AMOUNT TO BURN"),
      React.createElement("div", { style: { fontSize: 13, color: "#f0c040", fontWeight: 700, marginBottom: 12 } }, cost.toLocaleString() + " $RANCH"),
      React.createElement("div", { style: { fontSize: 9, color: "#6d5838", letterSpacing: 1, marginBottom: 4 } }, "PASTE TX SIGNATURE"),
      React.createElement("input", {
        type: "text", value: txSig, placeholder: "Paste transaction signature...",
        onChange: function(e) { setTxSig(e.target.value); },
        style: { width: "100%", padding: "10px 12px", boxSizing: "border-box", background: "#0e0b08", border: "1px solid #2a1f14", borderRadius: 6, color: "#e8ddd0", fontFamily: "'Pixelify Sans', sans-serif", fontSize: 12, textAlign: "center", outline: "none", marginBottom: 12 }
      }),
      err && React.createElement("div", { style: { fontSize: 11, color: "#ff6b6b", marginBottom: 8 } }, err),
      React.createElement("div", { style: { display: "flex", gap: 8 } },
        React.createElement("button", {
          onClick: onClose,
          style: { flex: 1, padding: "10px 0", background: "linear-gradient(180deg,#3d2e1e,#2a1f14)", border: "none", borderRadius: 6, color: "#9c8e78", fontSize: 12, fontWeight: 700, cursor: "pointer", letterSpacing: 2 }
        }, "CANCEL"),
        React.createElement("button", {
          onClick: doBuy, disabled: submitting,
          style: { flex: 1, padding: "10px 0", border: "none", borderRadius: 6, color: "#e8ddd0", fontSize: 12, fontWeight: 700, cursor: submitting ? "default" : "pointer", letterSpacing: 2, opacity: submitting ? 0.5 : 1, background: "repeating-linear-gradient(0deg,transparent,transparent 3px,rgba(0,0,0,.06) 3px,rgba(0,0,0,.06) 4px),linear-gradient(180deg,#8b5e3c,#6d4a2d 50%,#5c3f24)", boxShadow: "inset 0 1px 0 rgba(180,140,90,.3),inset 0 -1px 0 rgba(0,0,0,.4),0 2px 6px rgba(0,0,0,.4)" }
        }, submitting ? "VERIFYING..." : "BURN & BUY")
      )
    )
  );
}

function ShopPanel({ shopItems, onBuy }) {
  var cats = ["buildings","animals","crops","machines","decorations"];
  var catLabels = { buildings: "BLDG", animals: "PETS", crops: "CROP", machines: "MACH", decorations: "DECO" };
  var catIcons = { buildings: "\uD83C\uDFE0", animals: "\uD83D\uDC04", crops: "\uD83C\uDF3E", machines: "\u2699\uFE0F", decorations: "\uD83C\uDF33" };
  var _st = React.useState("buildings");
  var activeCat = _st[0], setActiveCat = _st[1];
  var items = shopItems[activeCat] || [];
  return React.createElement("div", { style: { padding: "0 2px" } },
    React.createElement("div", { style: { display: "flex", gap: 4, marginBottom: 6, justifyContent: "center" } },
      cats.map(function(cat) {
        var active = activeCat === cat;
        var hasItems = (shopItems[cat] || []).length > 0;
        if (!hasItems) return null;
        return React.createElement("button", {
          key: cat, onClick: function() { setActiveCat(cat); },
          style: {
            padding: "4px 8px", border: active ? "1px solid #d4a636" : "1px solid rgba(139,105,20,0.3)",
            borderRadius: 6, cursor: "pointer",
            background: active ? "linear-gradient(180deg, rgba(90,66,16,0.9), rgba(50,36,10,0.9))" : "linear-gradient(180deg, rgba(40,32,20,0.7), rgba(20,16,12,0.8))",
            color: active ? "#f0c040" : "#6d5838",
            fontSize: 8, fontWeight: 700, letterSpacing: 1,
            display: "flex", flexDirection: "column", alignItems: "center", gap: 1,
            boxShadow: active ? "0 0 8px rgba(212,166,54,0.3)" : "0 1px 3px rgba(0,0,0,0.4)",
          }
        },
          React.createElement("span", { style: { fontSize: 14 } }, catIcons[cat]),
          React.createElement("span", null, catLabels[cat])
        );
      })
    ),
    React.createElement(ShopRow, { items: items, cat: activeCat, onBuy: onBuy })
  );
}

function ShopRow({ items, cat, onBuy }) {
  var scrollRef = React.useRef(null);
  function doScroll(dir) { if (scrollRef.current) scrollRef.current.scrollBy({ left: dir * 160, behavior: "smooth" }); }
  return React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 3 } },
    React.createElement("button", { onClick: function(){doScroll(-1);}, style: { width: 20, height: 20, borderRadius: "50%", border: "none", background: "rgba(30,24,14,0.7)", color: "#9c8e78", fontSize: 12, cursor: "pointer", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" } }, "\u25C0"),
    React.createElement("div", { ref: scrollRef, className: "hide-scrollbar", style: { display: "flex", gap: 5, overflowX: "auto", flex: 1, paddingBottom: 2 } },
      items.map(function(item) {
        var cost = parseInt(item.burn_cost);
        var costStr = cost >= 1000000 ? (cost/1000000)+"M" : cost >= 1000 ? (cost/1000)+"k" : String(cost);
        var info = item.daily_pts ? item.daily_pts + " pts/d" : item.harvest_pts ? item.harvest_pts + " pts" : "";
        var spriteKey = item.sprite_key || ("b_" + item.name);
        var thumbEl = null;
        if (cat === "crops" && item.sprite_row !== undefined) {
          thumbEl = React.createElement("div", { style: { width: 16, height: 16, imageRendering: "pixelated", backgroundImage: "url(" + SPRITE_BASE + "crops/crops.png)", backgroundPosition: "-80px -" + (item.sprite_row * 16) + "px", backgroundSize: "96px auto", display: "inline-block", transform: "scale(1.5)", transformOrigin: "center" } });
        } else if (SPRITE_PATHS[spriteKey]) {
          if (cat === "animals") {
            var aName = spriteKey.replace("a_","");
            var aDef = ANIMALS[aName];
            if (aDef) thumbEl = React.createElement("div", { style: { width: aDef.fw, height: aDef.fh, imageRendering: "pixelated", backgroundImage: "url(" + SPRITE_BASE + SPRITE_PATHS[spriteKey] + ")", backgroundPosition: "0px 0px", backgroundSize: "auto", display: "inline-block", transform: "scale(" + (24/aDef.fw) + ")", transformOrigin: "center" } });
          } else {
            thumbEl = React.createElement("img", { src: SPRITE_BASE + SPRITE_PATHS[spriteKey], style: { width: 24, height: 24, imageRendering: "pixelated", objectFit: "contain" } });
          }
        }
        return React.createElement("div", { key: item.name, onClick: function() { onBuy && onBuy(item, cat); }, style: { width: 56, minWidth: 56, padding: "5px 2px 4px", borderRadius: 6, textAlign: "center", background: "linear-gradient(180deg, rgba(40,32,20,0.85), rgba(20,16,12,0.9))", border: "1px solid rgba(139,105,20,0.25)", boxShadow: "0 2px 6px rgba(0,0,0,0.5)", cursor: "pointer", flexShrink: 0 } },
          React.createElement("div", { style: { width: 26, height: 26, margin: "0 auto 2px", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" } },
            thumbEl || React.createElement("span", { style: { fontSize: 16 } }, "\uD83C\uDF31")
          ),
          React.createElement("div", { style: { fontSize: 7, fontWeight: 700, color: "#e8ddd0", marginBottom: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, item.name.replace(/_/g, " ")),
          info && React.createElement("div", { style: { fontSize: 6, color: "#4caf50", marginBottom: 1 } }, info),
          React.createElement("div", { style: { display: "inline-block", padding: "1px 4px", borderRadius: 5, background: "linear-gradient(180deg, #5a4210, #3d2e1e)", border: "1px solid rgba(139,105,20,0.4)" } },
            React.createElement("span", { style: { fontSize: 7, fontWeight: 700, color: "#f0c040" } }, costStr + " $R")
          )
        );
      })
    ),
    React.createElement("button", { onClick: function(){doScroll(1);}, style: { width: 20, height: 20, borderRadius: "50%", border: "none", background: "rgba(30,24,14,0.7)", color: "#9c8e78", fontSize: 12, cursor: "pointer", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" } }, "\u25B6")
  );
}

export default function FarmView() {
  var gameRef = useRef(null);
  var sceneRef = useRef(null);
  var containerRef = useRef(null);
  var [unlocked, setUnlocked] = useState(function () { return new Set(START_CHUNKS); });
  var [panel, setPanel] = useState(null);
  var [selectedTile, setSelectedTile] = useState(null);
  var [placing, setPlacing] = useState(null);
  var [editingIdx, setEditingIdx] = useState(null);
  var editingRef = useRef(null);
  var [placedBuildings, setPlacedBuildings] = useState([]);
  var [points, setPoints] = useState(0);
  var [ranchName, setRanchName] = useState("My Ranch");
  var [wallet, setWallet] = useState(null);
  var [walletInput, setWalletInput] = useState("");
  var [rancher, setRancher] = useState(null);
  var [showNameModal, setShowNameModal] = useState(false);
  var [isNewRancher, setIsNewRancher] = useState(false);
  var [loading, setLoading] = useState(false);
  var [toast, setToast] = useState(null);
  var [shopItems, setShopItems] = useState(null);
  var [farmData, setFarmData] = useState(null);
  var [sceneReady, setSceneReady] = useState(false);

  // Hydrate farm from DB
  var _hydrated = useRef(null);
  useEffect(function() {
    if (!farmData || !sceneReady) return;
    // Skip if same data
    var key = JSON.stringify(farmData.buildings || []) + JSON.stringify(farmData.animals || []) + JSON.stringify(farmData.crops || []);
    if (_hydrated.current === key) return;
    _hydrated.current = key;
    var placed = [];
    // Buildings
    if (farmData.buildings) farmData.buildings.forEach(function(b) {
      var def = BUILDINGS[dbToKey(b.building_type)];
      if (def) placed.push({ type: dbToKey(b.building_type), tx: b.tile_x, ty: b.tile_y, w: def.w, h: def.h, dbId: b.id, dbCat: "building" });
    });
    // Animals
    if (farmData.animals) farmData.animals.forEach(function(a) {
      var def = BUILDINGS[dbToKey(a.animal_type)];
      if (def) placed.push({ type: dbToKey(a.animal_type), tx: a.tile_x, ty: a.tile_y, w: def.w, h: def.h, dbId: a.id, dbCat: "animal" });
    });
    // Crops
    if (farmData.crops) farmData.crops.forEach(function(c) {
      var def = BUILDINGS[dbToKey(c.crop_type)];
      if (def) placed.push({ type: dbToKey(c.crop_type), tx: c.tile_x, ty: c.tile_y, w: def.w, h: def.h, dbId: c.id, dbCat: "crop", plantedAt: new Date(c.planted_at).getTime(), stage: c.stage });
    });
    // Machines
    if (farmData.machines) farmData.machines.forEach(function(m) {
      var def = BUILDINGS[dbToKey(m.machine_type)];
      if (def) placed.push({ type: dbToKey(m.machine_type), tx: m.tile_x, ty: m.tile_y, w: def.w, h: def.h, dbId: m.id, dbCat: "machine" });
    });
    // Decorations
    if (farmData.decorations) farmData.decorations.forEach(function(d) {
      var def = BUILDINGS[dbToKey(d.deco_type)];
      if (def) placed.push({ type: dbToKey(d.deco_type), tx: d.tile_x, ty: d.tile_y, w: def.w, h: def.h, dbId: d.id, dbCat: "deco" });
    });
    setPlacedBuildings(placed);
    // Chunks
    if (farmData.chunks) {
      var chunks = new Set(START_CHUNKS);
      farmData.chunks.forEach(function(k) { chunks.add(k); });
      setUnlocked(chunks);
    }
  }, [farmData, sceneReady]);

  var [buyItem, setBuyItem] = useState(null);
  var placingRef = useRef(null);
  var placedRef = useRef([]);
  var unlockedRef = useRef(new Set(START_CHUNKS));

  useEffect(function () { unlockedRef.current = unlocked; }, [unlocked]);
  useEffect(function () { placingRef.current = placing; }, [placing]);
  useEffect(function () { editingRef.current = editingIdx; }, [editingIdx]);
  useEffect(function () { placedRef.current = placedBuildings; }, [placedBuildings]);

  // --- WALLET & API ---
  function showToastMsg(msg, type) {
    setToast({ message: msg, type: type || "success" });
    setTimeout(function() { setToast(null); }, 3000);
  }

  function connectWallet(inputAddr) {
    var addr = inputAddr || walletInput.trim();
    if (!addr || addr.length < 32 || addr.length > 44) { showToastMsg("Enter a valid Solana wallet address", "error"); return; }
    setWallet(addr);
    window._srWallet = addr;
    setLoading(true);
    var refCode = new URLSearchParams(window.location.search).get("ref") || "";
    api("/ranchers/register", { method: "POST", body: JSON.stringify({ wallet: addr, referralCode: refCode }) })
      .then(function(data) {
        setLoading(false);
        if (!data || !data.rancher) { showToastMsg("Failed to load ranch", "error"); return; }
        setRancher(data.rancher);
        setRanchName(data.rancher.ranch_name || "My Ranch");
        if (data.isNew) { setIsNewRancher(true); setShowNameModal(true); }
        // Fetch all data
        fetchAllData(addr);
        // Save to localStorage
        try { window.localStorage.setItem("solranch_wallet", addr); } catch(e) {}
      });
  }

  function fetchAllData(w) {
    // Stats
    api("/ranchers/" + w + "/stats").then(function(data) {
      if (data && !data.error) {
        setPoints(data.today_points ? data.today_points.total_pts || 0 : 0);
      }
    });
    // Shop items
    api("/farm/shop/items").then(function(data) { if (data) setShopItems(data); });
    // Farm state
    api("/farm/" + w).then(function(data) { if (data) setFarmData(data); });
  }

  function saveRanchName(name) {
    if (!wallet) return;
    api("/ranchers/" + wallet + "/rename", { method: "PATCH", body: JSON.stringify({ ranchName: name }) })
      .then(function(data) {
        if (data && data.rancher) {
          setRancher(data.rancher);
          setRanchName(data.rancher.ranch_name);
          showToastMsg(isNewRancher ? "Welcome to the ranch, partner." : "Ranch renamed.");
        } else {
          showToastMsg(data ? data.error || "Failed" : "Failed", "error");
        }
        setShowNameModal(false);
        setIsNewRancher(false);
      });
  }

  function disconnectWallet() {
    setWallet(null); setRancher(null); setWalletInput("");
    try { window.localStorage.removeItem("solranch_wallet"); } catch(e) {}
  }

  // Task API functions (exposed on window for TasksPanel)
  window._srDoFeedAnimals = function() {
    if (!wallet || loading) return;
    setLoading(true);
    api("/farm/feed", { method: "POST", body: JSON.stringify({ wallet: wallet }) }).then(function(data) {
      setLoading(false);
      if (!data) return;
      if (data.alreadyDone) { showToastMsg("Animals already fed today!"); return; }
      if (data.success) { showToastMsg("All animals fed! They earn points today."); fetchAllData(wallet); }
    });
  };


  // Auto-login from localStorage
  useEffect(function() {
    try {
      var saved = window.localStorage.getItem("solranch_wallet");
      if (saved) connectWallet(saved);
    } catch(e) {}
  }, []);

  useEffect(function () {
    if (gameRef.current) return;

    var base = (import.meta.env.BASE_URL || "/dev/") + "sprites/game/";

    var FarmScene = new Phaser.Class({
      Extends: Phaser.Scene,
      initialize: function FarmScene() {
        Phaser.Scene.call(this, { key: "FarmScene" });
        this.chunkGraphics = null;
        this.isDragging = false;
        this.dragStartX = 0;
        this.dragStartY = 0;
      },

      preload: function () {
        // Terrain (still from cozy folder)
        var cozyBase = (import.meta.env.BASE_URL || "/dev/") + "sprites/cozy/";
        this.load.image("terrain", cozyBase + "base-terrain.png");

        // --- BUILDINGS ---
        this.load.image("b_barn",       base + "buildings/barn.png");
        this.load.image("b_coop",       base + "buildings/coop.png");
        this.load.image("b_greenhouse", base + "buildings/greenhouse.png");
        this.load.image("b_house",      base + "buildings/house_player.png");
        this.load.image("b_market",     base + "buildings/market.png");
        this.load.image("b_hospital",   base + "buildings/hospital.png");
        this.load.image("b_museum",     base + "buildings/museum.png");
        this.load.image("b_slimehut",   base + "buildings/slimehut.png");
        this.load.image("b_npc1",       base + "buildings/NPC1.png");
        this.load.image("b_npc2",       base + "buildings/NPC2.png");
        this.load.image("b_npc3",       base + "buildings/NPC3.png");
        this.load.image("b_npc4",       base + "buildings/NPC4.png");
        this.load.image("b_npc5",       base + "buildings/NPC5.png");
        this.load.image("b_npc6",       base + "buildings/NPC6.png");
        this.load.image("b_npc7",       base + "buildings/NPC7.png");

        // --- MACHINES (spritesheets) ---
        var machineKeys = Object.keys(MACHINES);
        for (var mi = 0; mi < machineKeys.length; mi++) {
          var mk = machineKeys[mi];
          var md = MACHINES[mk];
          this.load.spritesheet("m_" + mk, base + "machines/" + md.file, {
            frameWidth: 16,
            frameHeight: 32,
          });
        }

        // --- ANIMALS (spritesheets: 4 cols x 5 rows) ---
        var animalKeys = Object.keys(ANIMALS);
        for (var i = 0; i < animalKeys.length; i++) {
          var ak = animalKeys[i];
          var ad = ANIMALS[ak];
          this.load.spritesheet("a_" + ak, base + "animals/" + ad.file, {
            frameWidth: ad.fw,
            frameHeight: ad.fh,
          });
        }

        // --- CROPS (spritesheet: 6 cols x rows, 16x16 per frame) ---
        this.load.spritesheet("c_crops", base + "crops/crops.png", {
          frameWidth: 16,
          frameHeight: 16,
        });

        // --- DECO ---
        this.load.image("d_tree1",         base + "deco/tree1.png");
        this.load.image("d_tree2",         base + "deco/tree2.png");
        this.load.image("d_scarecrow",     base + "deco/scarecrow.png");
        this.load.image("d_woodfence",     base + "deco/fence_wood.png");
        this.load.image("d_stonefence",    base + "deco/fence_stone.png");
        this.load.image("d_gate_wood",     base + "deco/gate_wood_spring.png");
        this.load.image("d_gate_stone",    base + "deco/gate_stone.png");
        this.load.image("d_flower_blue",   base + "deco/flower_spring_blue.png");
        this.load.image("d_flower_white",  base + "deco/flower_spring_white.png");
      },

      create: function () {
        sceneRef.current = this;
        var self = this;

        // Terrain
        var terrain = this.add.image(MAP_PX / 2, MAP_PX / 2, "terrain");
        terrain.setDisplaySize(MAP_PX, MAP_PX);

        // Camera
        var cam = this.cameras.main;
        var fillZoom = Math.max(window.innerWidth / MAP_PX, window.innerHeight / MAP_PX);
        cam.setZoom(fillZoom);
        cam.setBounds(0, 0, MAP_PX, MAP_PX);
        cam.centerOn(MAP_PX / 2, MAP_PX / 2);
        this.minZoom = fillZoom;
        this.fillZoom = fillZoom;

        // Chunk overlay
        this.chunkGraphics = this.add.graphics();
        this.drawChunks();

        // Selection highlight
        this.selectGraphics = this.add.graphics();

        // Placement ghost
        this.ghostGraphics = this.add.graphics();
        this.ghostGraphics.setDepth(10);
        this.ghostPos = { x: 0, y: 0 };

        // Buildings layer
        this.buildingsGraphics = this.add.graphics();
        this.buildingsGraphics.setDepth(5);
        this.buildingSprites = [];
        this.cropSprites = [];
        this.animalSprites = [];
        this.animalSprites = [];

        // --- CREATE ANIMAL WALK ANIMATIONS ---
        var animalKeys = Object.keys(ANIMALS);
        for (var ai = 0; ai < animalKeys.length; ai++) {
          var ak = animalKeys[ai];
          var texKey = "a_" + ak;
          // 4 frames per row, 5 rows: down=0-3, right=4-7, up=8-11, left=12-15, sleep=16-19
          var dirs = ["down", "right", "up", "left", "sleep"];
          for (var di = 0; di < dirs.length; di++) {
            this.anims.create({
              key: texKey + "_" + dirs[di],
              frames: this.anims.generateFrameNumbers(texKey, { start: di * 4, end: di * 4 + 3 }),
              frameRate: dirs[di] === "sleep" ? 3 : 5,
              repeat: -1,
            });
          }
        }

        // --- CREATE MACHINE ANIMATIONS ---
        var machineKeys2 = Object.keys(MACHINES);
        for (var mi2 = 0; mi2 < machineKeys2.length; mi2++) {
          var mk2 = machineKeys2[mi2];
          var md2 = MACHINES[mk2];
          self.anims.create({
            key: "m_" + mk2 + "_work",
            frames: self.anims.generateFrameNumbers("m_" + mk2, { start: 0, end: md2.frames - 1 }),
            frameRate: mk2 === "clothmaker" ? 12 : 4,
            repeat: -1,
          });
        }

        // Input: drag to pan
        this.input.on("pointerdown", function (pointer) {
          self.isDragging = false;
          self.dragStartX = pointer.x;
          self.dragStartY = pointer.y;
          // In placement mode, immediately position ghost at tap
          if (placingRef.current) {
            var worldPoint = cam.getWorldPoint(pointer.x, pointer.y);
            var _pType = typeof placingRef.current === "object" ? placingRef.current.type : placingRef.current;
            var def = BUILDINGS[_pType];
            if (def) {
              var tx = Math.floor(worldPoint.x / TILE);
              var ty = Math.floor(worldPoint.y / TILE);
              tx = Math.max(0, Math.min(MAP - def.w, tx));
              ty = Math.max(0, Math.min(MAP - def.h, ty));
              self.ghostPos = { x: tx, y: ty };
              self.drawGhost(placingRef.current, tx, ty);
            }
          }
        }, this);

        this.input.on("pointermove", function (pointer) {
          if (pointer.isDown) {
            var totalDist = Math.abs(pointer.x - self.dragStartX) + Math.abs(pointer.y - self.dragStartY);
            if (placingRef.current) return;
            if (totalDist > 25) {
              self.isDragging = true;
              var dx = pointer.x - pointer.prevPosition.x;
              var dy = pointer.y - pointer.prevPosition.y;
              cam.scrollX -= dx / cam.zoom;
              cam.scrollY -= dy / cam.zoom;
            }
          }
        }, this);

        // Move ghost during placement (works during drag too)
        this.input.on("pointermove", function (pointer) {
          if (!placingRef.current) return;
          var _pt = typeof placingRef.current === "object" ? placingRef.current.type : placingRef.current;
          var worldPoint = cam.getWorldPoint(pointer.x, pointer.y);
          var def = BUILDINGS[_pt];
          if (!def) return;
          var tx = Math.floor(worldPoint.x / TILE);
          var ty = Math.floor(worldPoint.y / TILE);
          tx = Math.max(0, Math.min(MAP - def.w, tx));
          ty = Math.max(0, Math.min(MAP - def.h, ty));
          self.ghostPos = { x: tx, y: ty };
          self.drawGhost(_pt, tx, ty);
          window._srGhostValid = self.isValidPlacement(_pt, tx, ty);
          window._srGhostPos = { x: tx, y: ty };
        }, this);

        // Tap handler
        this.input.on("pointerup", function (pointer) {
          if (self.isDragging) return;

          // Placement mode: update ghost position, show confirm UI
          if (placingRef.current) {
            // Just update the ghost — don't auto-place. User confirms via button.
            var _pt = typeof placingRef.current === "object" ? placingRef.current.type : placingRef.current;
            var def = BUILDINGS[_pt];
            if (def) {
              var worldPt = cam.getWorldPoint(pointer.x, pointer.y);
              var gx = Math.floor(worldPt.x / TILE);
              var gy = Math.floor(worldPt.y / TILE);
              gx = Math.max(0, Math.min(MAP - def.w, gx));
              gy = Math.max(0, Math.min(MAP - def.h, gy));
              self.ghostPos = { x: gx, y: gy };
              self.drawGhost(_pt, gx, gy);
              // Store for confirm button
              window._srGhostValid = self.isValidPlacement(_pt, gx, gy);
              window._srGhostPos = { x: gx, y: gy };
            }
            return;
          }

          var worldPoint = cam.getWorldPoint(pointer.x, pointer.y);
          var tileX = Math.floor(worldPoint.x / TILE);
          var tileY = Math.floor(worldPoint.y / TILE);
          if (tileX < 0 || tileX >= MAP || tileY < 0 || tileY >= MAP) return;

          var cx = Math.floor(tileX / CHUNK);
          var cy = Math.floor(tileY / CHUNK);
          var key = cx + "," + cy;

          // Check if tapping existing building
          var tappedBuilding = -1;
          var all = placedRef.current;
          for (var bi = 0; bi < all.length; bi++) {
            var bb = all[bi];
            if (tileX >= bb.tx && tileX < bb.tx + bb.w && tileY >= bb.ty && tileY < bb.ty + bb.h) {
              tappedBuilding = bi;
              break;
            }
          }
          if (tappedBuilding >= 0) {
            var tb = all[tappedBuilding];
            var tbDef = BUILDINGS[tb.type];
            // Check if it's a mature crop
            if (tbDef && tbDef.crop && tb.plantedAt) {
              var tbElapsed = (Date.now() - tb.plantedAt) / 1000;
              var tbTotal = CROP_GROW_SECONDS[tb.type] || 60;
              if (tbElapsed >= tbTotal) {
                // Harvest! Remove crop via API
                if (tb.dbId && window._srWallet) {
                  api("/farm/harvest", { method: "POST", body: JSON.stringify({ wallet: window._srWallet, cropId: tb.dbId }) }).then(function(data) {
                    if (data && data.success) { api("/farm/" + window._srWallet).then(function(d) { if (d) setFarmData(d); }); }
                  });
                }
                setPlacedBuildings(function(prev) { return prev.filter(function(_, idx) { return idx !== tappedBuilding; }); });
                // Show harvest toast
                var harvestText = self.add.text(
                  tb.tx * TILE + (tb.w * TILE) / 2,
                  tb.ty * TILE - 8,
                  "+" + (function(){ var p = {crop_radish:20,crop_carrot:25,crop_potato:25,crop_tomato:35,crop_strawberry:50,crop_watermelon:100}[tb.type] || 25; setPoints(function(prev){return prev + p;}); return p; })() + " pts",
                  { fontSize: "10px", color: "#4eff4e", fontStyle: "bold", backgroundColor: "rgba(0,0,0,0.5)", padding: { x: 3, y: 2 } }
                );
                harvestText.setOrigin(0.5);
                harvestText.setDepth(20);
                self.tweens.add({ targets: harvestText, y: harvestText.y - 24, alpha: 0, duration: 1200, onComplete: function() { harvestText.destroy(); } });
                setPanel(null);
                return;
              }
            }
            setEditingIdx(tappedBuilding);
            setPanel("edit");
            var eb = all[tappedBuilding];
            self.selectGraphics.clear();
            self.selectGraphics.lineStyle(3, 0xffd060, 1);
            self.selectGraphics.strokeRect(eb.tx * TILE, eb.ty * TILE, eb.w * TILE, eb.h * TILE);
            self.selectGraphics.fillStyle(0xffd060, 0.1);
            self.selectGraphics.fillRect(eb.tx * TILE, eb.ty * TILE, eb.w * TILE, eb.h * TILE);
            return;
          }

          if (unlockedRef.current.has(key)) {
            setSelectedTile({ x: tileX, y: tileY });
            setPanel("build");
            self.drawSelection(tileX, tileY);
          } else {
            setSelectedTile(null);
            setPanel({ type: "unlock", cx: cx, cy: cy, ring: chunkRing(cx, cy) });
            self.selectGraphics.clear();
            self.selectGraphics.lineStyle(3, 0xffd060, 1);
            self.selectGraphics.strokeRect(cx * CHUNK * TILE, cy * CHUNK * TILE, CHUNK * TILE, CHUNK * TILE);
            self.selectGraphics.fillStyle(0xffd060, 0.1);
            self.selectGraphics.fillRect(cx * CHUNK * TILE, cy * CHUNK * TILE, CHUNK * TILE, CHUNK * TILE);
          }
        }, this);

        // Pinch zoom
        this.input.addPointer(1);
        this.pinchDist = 0;

        this.input.on("pointermove", function () {
          if (this.input.pointer1.isDown && this.input.pointer2.isDown && !placingRef.current) {
            var dx = this.input.pointer1.x - this.input.pointer2.x;
            var dy = this.input.pointer1.y - this.input.pointer2.y;
            var dist = Math.sqrt(dx * dx + dy * dy);
            if (this.pinchDist > 0) {
              var ratio = dist / this.pinchDist;
              var newZoom = Phaser.Math.Clamp(cam.zoom * ratio, sceneRef.current.minZoom || 0.8, 6);
              cam.setZoom(newZoom);
            }
            this.pinchDist = dist;
          }
        }, this);

        this.input.on("pointerup", function () {
          this.pinchDist = 0;
        }, this);

        // Mouse wheel zoom
        this.input.on("wheel", function (pointer, gameObjects, deltaX, deltaY) {
          if (placingRef.current) return;
          var zoomFactor = deltaY < 0 ? 1.1 : 0.9;
          var newZoom = Phaser.Math.Clamp(cam.zoom * zoomFactor, sceneRef.current.minZoom || 0.8, 6);
          cam.setZoom(newZoom);
        }, this);

        // Resize
        setSceneReady(true);

        this.scale.on("resize", function (gameSize) {
          cam.setViewport(0, 0, gameSize.width, gameSize.height);
        }, this);
      },

      drawChunks: function () {
        if (!this.chunkGraphics) return;
        this.chunkGraphics.clear();
        for (var cy = 0; cy < CHUNKS; cy++) {
          for (var cx = 0; cx < CHUNKS; cx++) {
            var key = cx + "," + cy;
            if (unlockedRef.current.has(key)) continue;
            var ring = chunkRing(cx, cy);
            var alpha = 0.15 + ring * 0.05;
            this.chunkGraphics.fillStyle(0x081504, alpha);
            this.chunkGraphics.fillRect(cx * CHUNK * TILE, cy * CHUNK * TILE, CHUNK * TILE, CHUNK * TILE);
          }
        }
      },

      drawGhost: function (type, tx, ty) {
        this.ghostGraphics.clear();
        var def = BUILDINGS[type];
        if (!def) return;
        var valid = this.isValidPlacement(type, tx, ty);
        var color = valid ? 0x44ff44 : 0xff4444;

        // Sprite preview
        if (!this.ghostSprite) {
          this.ghostSprite = this.add.sprite(0, 0, "terrain");
          this.ghostSprite.setDepth(11);
          this.ghostSprite.setAlpha(0.7);
        }
        if (def.sprite) {
          this.ghostSprite.setTexture(def.sprite);
          // For spritesheets, show appropriate frame
          if (def.animal) {
            this.ghostSprite.setFrame(0);
          } else if (def.machine) {
            this.ghostSprite.setFrame(0);
          } else if (def.crop) {
            this.ghostSprite.setTexture("c_crops");
            this.ghostSprite.setFrame(def.cropRow * 6);
          }
          this.ghostSprite.setDisplaySize(def.w * TILE, def.h * TILE);
          this.ghostSprite.setPosition(tx * TILE + (def.w * TILE) / 2, ty * TILE + (def.h * TILE) / 2);
          this.ghostSprite.setAlpha(0.7);
          this.ghostSprite.setTint(valid ? 0xffffff : 0xff6666);
          this.ghostSprite.setVisible(true);
        }

        // Outline
        this.ghostGraphics.lineStyle(2, color, 0.8);
        this.ghostGraphics.strokeRect(tx * TILE, ty * TILE, def.w * TILE, def.h * TILE);

        // Label
        if (!this.ghostLabel) {
          this.ghostLabel = this.add.text(0, 0, "", { fontSize: "8px", color: "#ffffff", backgroundColor: "rgba(0,0,0,0.6)", padding: { x: 2, y: 1 } });
          this.ghostLabel.setDepth(11);
        }
        this.ghostLabel.setText(def.label);
        this.ghostLabel.setPosition(tx * TILE + (def.w * TILE) / 2 - this.ghostLabel.width / 2, ty * TILE + (def.h * TILE) / 2 - 4);
      },

      isValidPlacement: function (type, tx, ty) {
        var def = BUILDINGS[type];
        if (!def) return false;
        for (var dy = 0; dy < def.h; dy++) {
          for (var dx = 0; dx < def.w; dx++) {
            var ttx = tx + dx;
            var tty = ty + dy;
            if (ttx < 0 || ttx >= MAP || tty < 0 || tty >= MAP) return false;
            var cx = Math.floor(ttx / CHUNK);
            var cy = Math.floor(tty / CHUNK);
            if (!unlockedRef.current.has(cx + "," + cy)) return false;
          }
        }
        var all = placedRef.current;
        for (var i = 0; i < all.length; i++) {
          var b = all[i];
          if (tx < b.tx + b.w && tx + def.w > b.tx && ty < b.ty + b.h && ty + def.h > b.ty) {
            return false;
          }
        }
        return true;
      },

      drawAllBuildings: function (buildings) {
        this.buildingsGraphics.clear();
        for (var s = 0; s < this.buildingSprites.length; s++) {
          this.buildingSprites[s].destroy();
        }
        this.buildingSprites = [];
        this.cropSprites = [];

        for (var i = 0; i < buildings.length; i++) {
          var b = buildings[i];
          var def = BUILDINGS[b.type];
          if (!def || !def.sprite) continue;
          var px = b.tx * TILE + (b.w * TILE) / 2;
          var py = b.ty * TILE + (b.h * TILE) / 2;

          if (def.animal) {
            // Animated animal sprite with wandering
            var spr = this.add.sprite(px, py, def.sprite, 0);
            spr.setDisplaySize(b.w * TILE, b.h * TILE);
            spr.setDepth(5);
            var dirs = ["down", "right", "up", "left"];
            var dir = dirs[Math.floor(Math.random() * dirs.length)];
            spr.play(def.sprite + "_" + dir);
            // Wander data: animal roams within its tile area
            var roamPad = 4;
            spr.wanderData = {
              baseX: b.tx * TILE + roamPad,
              baseY: b.ty * TILE + roamPad,
              maxX: (b.tx + b.w) * TILE - roamPad,
              maxY: (b.ty + b.h) * TILE - roamPad,
              spriteKey: def.sprite,
              state: "walk",
              dir: dir,
              speed: 4 + Math.random() * 4,
              timer: 1000 + Math.random() * 2000,
              elapsed: 0,
            };
            // Start at random position within area
            spr.x = spr.wanderData.baseX + Math.random() * (spr.wanderData.maxX - spr.wanderData.baseX);
            spr.y = spr.wanderData.baseY + Math.random() * (spr.wanderData.maxY - spr.wanderData.baseY);
            this.buildingSprites.push(spr);
            this.animalSprites.push(spr);
          } else if (def.machine) {
            // Animated machine sprite
            var spr = this.add.sprite(px, py, def.sprite, 0);
            spr.setDisplaySize(b.w * TILE, b.h * TILE);
            spr.setDepth(5);
            spr.play(def.sprite + "_work");
            this.buildingSprites.push(spr);
          } else if (def.crop) {
            // Crop sprite - compute current growth stage
            var elapsed = b.plantedAt ? (Date.now() - b.plantedAt) / 1000 : 0;
            var totalGrow = CROP_GROW_SECONDS[b.type] || 60;
            var stageTime = totalGrow / 5;
            var stage = Math.min(5, Math.floor(elapsed / stageTime));
            var cropFrame = def.cropRow * 6 + stage;
            var spr = this.add.sprite(px, py, "c_crops", cropFrame);
            spr.setDisplaySize(b.w * TILE, b.h * TILE);
            spr.setDepth(5);
            spr.cropData = { type: b.type, plantedAt: b.plantedAt, cropRow: def.cropRow, idx: i };
            this.buildingSprites.push(spr);
            this.cropSprites.push(spr);
          } else {
            var spr = this.add.image(px, py, def.sprite);
            spr.setDisplaySize(b.w * TILE, b.h * TILE);
            spr.setDepth(5);
            this.buildingSprites.push(spr);
          }
        }
      },

      drawSelection: function (tx, ty) {
        this.selectGraphics.clear();
        this.selectGraphics.lineStyle(2, 0xffe866, 1);
        this.selectGraphics.strokeRect(tx * TILE, ty * TILE, TILE, TILE);
        this.selectGraphics.fillStyle(0xffe866, 0.15);
        this.selectGraphics.fillRect(tx * TILE, ty * TILE, TILE, TILE);
      },

      update: function (time, delta) {
        // --- ANIMAL WANDERING ---
        for (var ai = 0; ai < this.animalSprites.length; ai++) {
          var aspr = this.animalSprites[ai];
          if (!aspr || !aspr.wanderData || !aspr.active) continue;
          var wd = aspr.wanderData;
          wd.elapsed += delta;

          if (wd.state === "walk") {
            // Move in current direction
            var moveAmt = (wd.speed * delta) / 1000;
            if (wd.dir === "up") aspr.y -= moveAmt;
            else if (wd.dir === "down") aspr.y += moveAmt;
            else if (wd.dir === "left") aspr.x -= moveAmt;
            else if (wd.dir === "right") aspr.x += moveAmt;

            // Clamp to bounds
            if (aspr.x < wd.baseX) { aspr.x = wd.baseX; wd.dir = "right"; aspr.play(wd.spriteKey + "_right", true); }
            if (aspr.x > wd.maxX) { aspr.x = wd.maxX; wd.dir = "left"; aspr.play(wd.spriteKey + "_left", true); }
            if (aspr.y < wd.baseY) { aspr.y = wd.baseY; wd.dir = "down"; aspr.play(wd.spriteKey + "_down", true); }
            if (aspr.y > wd.maxY) { aspr.y = wd.maxY; wd.dir = "up"; aspr.play(wd.spriteKey + "_up", true); }

            // After timer, switch to idle or change direction
            if (wd.elapsed >= wd.timer) {
              wd.elapsed = 0;
              var roll = Math.random();
              if (roll < 0.3) {
                // Sleep/idle
                wd.state = "sleep";
                wd.timer = 2000 + Math.random() * 3000;
                aspr.play(wd.spriteKey + "_sleep", true);
              } else {
                // New direction
                var dirs = ["down", "right", "up", "left"];
                wd.dir = dirs[Math.floor(Math.random() * 4)];
                wd.timer = 1000 + Math.random() * 2000;
                wd.speed = 4 + Math.random() * 4;
                aspr.play(wd.spriteKey + "_" + wd.dir, true);
              }
            }
          } else if (wd.state === "sleep") {
            // Idle/sleep, wait then start walking
            if (wd.elapsed >= wd.timer) {
              wd.elapsed = 0;
              wd.state = "walk";
              var dirs = ["down", "right", "up", "left"];
              wd.dir = dirs[Math.floor(Math.random() * 4)];
              wd.timer = 1000 + Math.random() * 2000;
              wd.speed = 4 + Math.random() * 4;
              aspr.play(wd.spriteKey + "_" + wd.dir, true);
            }
          }
        }

        // Update crop growth visuals every 500ms
        if (!this._lastCropCheck) this._lastCropCheck = 0;
        this._lastCropCheck += delta;
        if (this._lastCropCheck > 500) {
          this._lastCropCheck = 0;
          for (var ci = 0; ci < this.cropSprites.length; ci++) {
            var cs = this.cropSprites[ci];
            if (!cs || !cs.cropData || !cs.active) continue;
            var cd = cs.cropData;
            var elapsed = (Date.now() - cd.plantedAt) / 1000;
            var totalGrow = CROP_GROW_SECONDS[cd.type] || 60;
            var stageTime = totalGrow / 5;
            var stage = Math.min(5, Math.floor(elapsed / stageTime));
            var newFrame = cd.cropRow * 6 + stage;
            if (cs.frame.name !== newFrame) {
              cs.setFrame(newFrame);
            }
          }
        }
      }
    });

    var config = {
      type: Phaser.AUTO,
      parent: containerRef.current,
      width: window.innerWidth,
      height: window.innerHeight,
      backgroundColor: "#0d1a06",
      pixelArt: true,
      scale: {
        mode: Phaser.Scale.RESIZE,
        autoCenter: Phaser.Scale.CENTER_BOTH,
      },
      scene: FarmScene,
      input: {
        touch: { capture: true },
      },
    };

    gameRef.current = new Phaser.Game(config);

    return function () {
      if (gameRef.current) {
        gameRef.current.destroy(true);
        gameRef.current = null;
      }
    };
  }, []);

  useEffect(function () {
    if (sceneRef.current && sceneRef.current.chunkGraphics) {
      sceneRef.current.drawChunks();
    }
  }, [unlocked]);

  useEffect(function () {
    if (sceneReady && sceneRef.current && sceneRef.current.buildingsGraphics) {
      sceneRef.current.drawAllBuildings(placedBuildings);
    }
  }, [placedBuildings, sceneReady]);

  function zoomIn() {
    if (!sceneRef.current) return;
    var cam = sceneRef.current.cameras.main;
    cam.setZoom(Phaser.Math.Clamp(cam.zoom * 1.3, sceneRef.current.minZoom || 0.8, 6));
  }
  function zoomOut() {
    if (!sceneRef.current) return;
    var cam = sceneRef.current.cameras.main;
    cam.setZoom(Phaser.Math.Clamp(cam.zoom * 0.7, sceneRef.current.minZoom || 0.8, 6));
  }
  function zoomFit() {
    if (!sceneRef.current) return;
    var cam = sceneRef.current.cameras.main;
    var fillZoom = Math.max(window.innerWidth / MAP_PX, window.innerHeight / MAP_PX);
    cam.setZoom(fillZoom);
    cam.centerOn(MAP_PX / 2, MAP_PX / 2);
  }

  var _unlockTx = useState("");
  var unlockTx = _unlockTx[0], setUnlockTx = _unlockTx[1];
  var _unlockErr = useState(null);
  var unlockErr = _unlockErr[0], setUnlockErr = _unlockErr[1];
  var _unlocking = useState(false);
  var unlocking = _unlocking[0], setUnlocking = _unlocking[1];

  function doUnlock(cx, cy) {
    if (!wallet) return;
    if (!unlockTx.trim()) { setUnlockErr("Paste your TX signature"); return; }
    setUnlocking(true); setUnlockErr(null);
    api("/farm/unlock", { method: "POST", body: JSON.stringify({ wallet: wallet, chunkX: cx, chunkY: cy, txSignature: unlockTx.trim() }) })
      .then(function(data) {
        setUnlocking(false);
        if (!data) { setUnlockErr("Request failed"); return; }
        if (data.error) { setUnlockErr(data.error); return; }
        setUnlocked(function (prev) { var n = new Set(prev); n.add(cx + "," + cy); return n; });
        setPanel(null); setUnlockTx(""); setUnlockErr(null);
        showToastMsg(data.message || "Land unlocked!");
        api("/farm/" + wallet).then(function(d) { if (d) setFarmData(d); });
      });
  }

  var panelCats = { buildings: ["farm","home"], machines: ["machine"], animals: ["animal"], crops: ["crop"], deco: ["nature","deco"] };
  var panelTitles = { buildings: "Buildings & Houses", machines: "Machines", animals: "Animals", crops: "Crops", deco: "Nature & Decor", shop: "Supply Shop" };

  function confirmPlace() {
    if (!placingRef.current || !window._srGhostPos) return;
    var placeType = typeof placingRef.current === "object" ? placingRef.current.type : placingRef.current;
    var placeCat = typeof placingRef.current === "object" ? placingRef.current.category : null;
    var placeDbName = typeof placingRef.current === "object" ? (placingRef.current.dbName || placeType) : placeType;
    var def = BUILDINGS[placeType];
    var gx = window._srGhostPos.x, gy = window._srGhostPos.y;
    if (!def || !sceneRef.current || !sceneRef.current.isValidPlacement(placeType, gx, gy)) {
      showToastMsg("Invalid position", "error"); return;
    }
    var newBuilding = { type: placeType, tx: gx, ty: gy, w: def.w, h: def.h };
    if (def.crop) { newBuilding.plantedAt = Date.now(); newBuilding.stage = 0; }
    setPlacedBuildings(function(prev) { return prev.concat([newBuilding]); });
    setPlacing(null);
    if (sceneRef.current) {
      sceneRef.current.ghostGraphics.clear();
      if (sceneRef.current.ghostSprite) sceneRef.current.ghostSprite.setVisible(false);
      if (sceneRef.current.ghostLabel) sceneRef.current.ghostLabel.setText("");
      sceneRef.current.drawAllBuildings(placedRef.current.concat([newBuilding]));
    }
    window._srGhostPos = null; window._srGhostValid = null;
    if (placeCat && window._srWallet) {
      api("/farm/place", { method: "POST", body: JSON.stringify({ wallet: window._srWallet, itemCategory: placeCat, itemType: placeDbName, tileX: gx, tileY: gy }) })
        .then(function(data) {
          if (data && data.error) { console.error("[PLACE]", data.error); }
          api("/farm/" + window._srWallet).then(function(d) { if (d) setFarmData(d); });
        });
    }
  }

  function cancelPlace() {
    setPlacing(null);
    window._srGhostPos = null; window._srGhostValid = null;
    if (sceneRef.current) {
      sceneRef.current.ghostGraphics.clear();
      if (sceneRef.current.ghostSprite) sceneRef.current.ghostSprite.setVisible(false);
      if (sceneRef.current.ghostLabel) sceneRef.current.ghostLabel.setText("");
    }
  }

  function closePanel() {
    setPanel(null); setSelectedTile(null); setPlacing(null);
    if (sceneRef.current) {
      sceneRef.current.selectGraphics.clear();
      sceneRef.current.ghostGraphics.clear();
      if (sceneRef.current.ghostLabel) sceneRef.current.ghostLabel.setText("");
      if (sceneRef.current.ghostSprite) sceneRef.current.ghostSprite.setVisible(false);
    }
  }

  function startPlace(type) {
    setPlacing(placing === type ? null : type);
    if (sceneRef.current && placing === type) {
      sceneRef.current.ghostGraphics.clear();
      if (sceneRef.current.ghostLabel) sceneRef.current.ghostLabel.setText("");
    }
  }

  // Game-style circular button
  function GameBtn(props) {
    var active = props.active;
    return React.createElement("button", {
      onClick: props.onClick,
      style: {
        width: 52, height: 52,
        borderRadius: "50%",
        border: active ? "3px solid #fff" : "3px solid rgba(0,0,0,0.3)",
        background: active
          ? "radial-gradient(circle at 30% 30%, " + (props.color || "#d4a636") + ", " + (props.colorDark || "#8b6914") + ")"
          : "radial-gradient(circle at 30% 30%, " + (props.color || "#5a4a2a") + "cc, " + (props.colorDark || "#2a1f14") + "cc)",
        boxShadow: active
          ? "0 4px 12px rgba(212,166,54,0.5), inset 0 2px 4px rgba(255,255,255,0.25)"
          : "0 4px 8px rgba(0,0,0,0.5), inset 0 2px 4px rgba(255,255,255,0.1)",
        color: "#fff",
        fontSize: 22,
        cursor: "pointer",
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        transition: "all 0.15s ease",
        position: "relative",
        WebkitTapHighlightColor: "transparent",
      }
    },
      React.createElement("span", { style: { fontSize: 22, lineHeight: 1, filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.4))" } }, props.icon),
      props.label && React.createElement("span", {
        style: { fontSize: 7, fontWeight: 700, letterSpacing: 0.5, marginTop: 1, textShadow: "0 1px 2px rgba(0,0,0,0.6)", fontFamily: "'Pixelify Sans', sans-serif" }
      }, props.label)
    );
  }

  // HUD pill badge
  function HudPill(props) {
    return React.createElement("div", {
      style: {
        display: "flex", alignItems: "center", gap: 4,
        padding: "4px 10px 4px 6px",
        background: "linear-gradient(180deg, rgba(30,24,14,0.9), rgba(14,11,8,0.95))",
        border: "2px solid " + (props.borderColor || "#3d2e1e"),
        borderRadius: 20,
        boxShadow: "0 2px 8px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.06)",
      }
    },
      React.createElement("div", {
        style: {
          width: 22, height: 22, borderRadius: "50%",
          background: "radial-gradient(circle at 30% 30%, " + (props.iconBg || "#d4a636") + ", " + (props.iconBgDark || "#8b6914") + ")",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 12, boxShadow: "inset 0 -2px 4px rgba(0,0,0,0.3)",
        }
      }, props.icon),
      React.createElement("span", {
        style: { fontSize: 12, fontWeight: 700, color: props.textColor || "#f0c040", fontFamily: "'Pixelify Sans', sans-serif", textShadow: "0 1px 2px rgba(0,0,0,0.5)" }
      }, props.value)
    );
  }

  return (
    React.createElement("div", { style: { position: "fixed", top: 0, left: 0, width: "100vw", height: "100vh", overflow: "hidden", fontFamily: "'Pixelify Sans', sans-serif" } },
      React.createElement("div", { ref: containerRef, style: { position: "absolute", top: 0, left: 0, width: "100%", height: "100%" } }),

      // ═══ TOP HUD ═══
      React.createElement("div", { style: { position: "absolute", top: 8, left: 8, right: 8, zIndex: 10, pointerEvents: "none", display: "flex", justifyContent: "space-between", alignItems: "flex-start" } },
        // Left: Ranch name + tier
        React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 4 } },
          React.createElement("div", {
            style: {
              padding: "5px 14px",
              background: "linear-gradient(180deg, rgba(90,60,20,0.9), rgba(50,30,10,0.95))",
              border: "2px solid #8b6914",
              borderRadius: 8,
              boxShadow: "0 3px 10px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.1)",
            }
          },
            React.createElement("div", { onClick: function() { if (wallet) setShowNameModal(true); }, style: { fontSize: 13, color: "#f0c040", fontWeight: 700, letterSpacing: 1, textShadow: "0 2px 4px rgba(0,0,0,0.5)", cursor: "pointer", pointerEvents: "auto" } }, ranchName),
            React.createElement("div", { style: { fontSize: 9, color: "#9c8e78", marginTop: 1 } },
              getTier(points).name + " Ranch"
            )
          ),
          // Holdings
          React.createElement("div", {
            style: {
              display: "flex", gap: 6, fontSize: 9, color: "#9c8e78",
              padding: "3px 8px",
              background: "rgba(14,11,8,0.7)",
              borderRadius: 6,
            }
          }, (function() {
            var h = getHoldings(placedBuildings);
            return React.createElement(React.Fragment, null,
              React.createElement("span", null, h.buildings + " bldg"),
              React.createElement("span", { style: { color: "#3d2e1e" } }, "|"),
              React.createElement("span", null, h.animals + " pets"),
              React.createElement("span", { style: { color: "#3d2e1e" } }, "|"),
              React.createElement("span", null, h.crops + " crops")
            );
          })())
        ),
        // Right: Points + Land pills
        React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" } },
          React.createElement(HudPill, {
            icon: "⭐", iconBg: "#f0c040", iconBgDark: "#c8941e",
            borderColor: "#8b6914",
            value: points.toLocaleString(),
            textColor: "#f0c040"
          }),
          React.createElement(HudPill, {
            icon: "🏞️", iconBg: "#4a7a2e", iconBgDark: "#2d5a18",
            borderColor: "#2d5a18",
            value: unlocked.size + "/" + (CHUNKS * CHUNKS),
            textColor: "#8bc34a"
          }),
          // Tier progress
          getTier(points).next && React.createElement("div", {
            style: { width: 80, height: 4, background: "rgba(14,11,8,0.7)", borderRadius: 2, border: "1px solid #2a1f14" }
          },
            React.createElement("div", {
              style: {
                height: "100%", borderRadius: 2,
                background: "linear-gradient(90deg, #8b6914, #f0c040)",
                width: Math.min(100, Math.floor((points / getTier(points).next) * 100)) + "%",
                transition: "width 0.5s",
                boxShadow: "0 0 6px rgba(240,192,64,0.4)",
              }
            })
          )
        )
      ),

      // ═══ ZOOM CONTROLS (right middle) ═══
      React.createElement("div", { style: { position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", display: "flex", flexDirection: "column", gap: 6, zIndex: 10 } },
        [{ l: "+", f: zoomIn }, { l: "−", f: zoomOut }, { l: "○", f: zoomFit }].map(function(z) {
          return React.createElement("button", {
            key: z.l, onClick: z.f,
            style: {
              width: 34, height: 34,
              borderRadius: "50%",
              border: "2px solid rgba(0,0,0,0.3)",
              background: "radial-gradient(circle at 30% 30%, #3d2e1e, #1a1510)",
              boxShadow: "0 3px 8px rgba(0,0,0,0.5), inset 0 1px 4px rgba(255,255,255,0.08)",
              color: "#9c8e78", fontSize: 16, fontWeight: 700,
              cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
            }
          }, z.l);
        })
      ),

      // ═══ BOTTOM SECTION ═══
      React.createElement("div", { style: { position: "absolute", bottom: 0, left: 0, right: 0, zIndex: 20, paddingBottom: 0 } },

        // ── Item Panel (slides up) ──
      // ═══ PANELS ═══
        panel && React.createElement("div", {
          style: { position: "absolute", bottom: 140, left: 0, right: 0, zIndex: 8, padding: "4px 8px", maxHeight: "55vh", overflowY: "auto", background: "transparent" }
        },
          // SHOP
          panel === "shop" && shopItems && React.createElement(ShopPanel, { shopItems: shopItems, onBuy: function(item, cat) { setBuyItem({ item: item, cat: cat }); } }),

          // BAG
          panel === "bag" && React.createElement("div", {
            style: { background: "rgba(14,11,8,0.95)", borderRadius: 12, border: "1px solid #2a1f14", padding: 16, backdropFilter: "blur(10px)" }
          },
            React.createElement("div", { style: { fontSize: 14, color: "#d4a636", fontWeight: 700, letterSpacing: 3, marginBottom: 12 } }, "INVENTORY"),
            farmData && farmData.inventory && farmData.inventory.length > 0
              ? React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 8 } },
                  farmData.inventory.map(function(item, i) {
                    return React.createElement("div", { key: i, style: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: 12, background: "linear-gradient(180deg, #1f1a14, #161210)", border: "1px solid #2a1f14", borderRadius: 10 } },
                      React.createElement("div", null,
                        React.createElement("div", { style: { fontSize: 13, fontWeight: 700, color: "#e8ddd0" } }, item.item_type.replace(/_/g, " ")),
                        React.createElement("div", { style: { fontSize: 10, color: "#6d5838" } }, item.item_category)
                      ),
                      React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 10 } },
                        React.createElement("span", { style: { fontSize: 16, fontWeight: 700, color: "#f0c040" } }, "x" + item.quantity),
                        React.createElement("button", {
                          onClick: function() { setPanel(null); setPlacing({ type: dbToKey(item.item_type), category: item.item_category, dbName: item.item_type }); showToastMsg("Tap the farm to place " + item.item_type.replace(/_/g, " ")); },
                          style: { padding: "6px 14px", border: "none", borderRadius: 6, fontSize: 10, fontWeight: 700, cursor: "pointer", color: "#e8ddd0", background: "linear-gradient(180deg,#3a5a2a,#2d4a20)", boxShadow: "inset 0 1px 0 rgba(100,160,80,.2),0 2px 4px rgba(0,0,0,.3)" }
                        }, "PLACE")
                      )
                    );
                  })
                )
              : React.createElement("div", { style: { padding: 20, textAlign: "center", color: "#6d5838", fontSize: 12 } }, "Empty. Buy items from the Shop first.")
          ),

          // EDIT
          panel === "edit" && editingIdx !== null && placedBuildings[editingIdx] && React.createElement("div", {
            style: { background: "rgba(14,11,8,0.95)", borderRadius: 12, border: "1px solid #2a1f14", padding: 16, backdropFilter: "blur(10px)", textAlign: "center" }
          },
            React.createElement("div", { style: { fontSize: 18, fontWeight: 700, color: "#e8ddd0", marginBottom: 4, textShadow: "0 1px 2px rgba(0,0,0,0.5)" } }, (BUILDINGS[placedBuildings[editingIdx].type] || {}).label || placedBuildings[editingIdx].type),
            React.createElement("div", { style: { fontSize: 11, color: "#9c8e78", marginBottom: 12 } }, "Position: (" + placedBuildings[editingIdx].tx + ", " + placedBuildings[editingIdx].ty + ")"),
            placedBuildings[editingIdx].plantedAt && React.createElement(CropProgress, { building: placedBuildings[editingIdx] }),
            React.createElement("button", {
              onClick: function() {
                var b = placedBuildings[editingIdx];
                var moveCat = b.dbCat || "building";
                var moveType = b.type;
                // Remove from map via API, then enter placement mode
                if (b.dbId && wallet) {
                  api("/farm/remove", { method: "POST", body: JSON.stringify({ wallet: wallet, itemCategory: moveCat, itemId: b.dbId }) })
                    .then(function(data) {
                      if (data && data.success) {
                        setPlacing({ type: moveType, category: moveCat });
                        setEditingIdx(null); setPanel(null);
                        showToastMsg("Tap to re-place " + moveType.replace(/_/g, " "));
                        api("/farm/" + wallet).then(function(d) { if (d) setFarmData(d); });
                      } else {
                        showToastMsg(data ? data.error : "Move failed", "error");
                      }
                    });
                } else {
                  setPlacedBuildings(function(prev) { return prev.filter(function(_, i) { return i !== editingIdx; }); });
                  setPlacing(moveType);
                  setEditingIdx(null); setPanel(null);
                }
              },
              style: { display: "block", width: "100%", padding: "10px", marginBottom: 8, background: "linear-gradient(180deg,#4a6a2a,#3a5a1a)", color: "#fff", border: "2px solid #6a8a3a", borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: "pointer", letterSpacing: 2 }
            }, "MOVE"),
            React.createElement("button", {
              onClick: function() {
                var b = placedBuildings[editingIdx];
                var removeCat = b.dbCat || "building";
                if (b.dbId && wallet) {
                  api("/farm/remove", { method: "POST", body: JSON.stringify({ wallet: wallet, itemCategory: removeCat, itemId: b.dbId }) })
                    .then(function(data) {
                      if (data && data.success) {
                        setEditingIdx(null); setPanel(null);
                        showToastMsg(data.message || "Removed!");
                        api("/farm/" + wallet).then(function(d) { if (d) setFarmData(d); });
                      } else {
                        showToastMsg(data ? data.error : "Remove failed", "error");
                      }
                    });
                } else {
                  setPlacedBuildings(function(prev) { return prev.filter(function(_, i) { return i !== editingIdx; }); });
                  setEditingIdx(null); setPanel(null);
                }
              },
              style: { display: "block", width: "100%", padding: "10px", background: "linear-gradient(180deg,#8a2a2a,#6a1a1a)", color: "#fff", border: "2px solid #aa4a4a", borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: "pointer", letterSpacing: 2 }
            }, "REMOVE"),
            React.createElement("button", {
              onClick: function() { setEditingIdx(null); setPanel(null); if (sceneRef.current) sceneRef.current.selectGraphics.clear(); },
              style: { display: "block", width: "100%", padding: "8px", marginTop: 8, background: "transparent", color: "#6d5838", border: "none", fontSize: 11, cursor: "pointer", letterSpacing: 2 }
            }, "CANCEL")
          ),

          // FEED
          panel === "feed" && React.createElement("div", {
            style: { background: "rgba(14,11,8,0.95)", borderRadius: 12, border: "1px solid #2a1f14", padding: 16, backdropFilter: "blur(10px)", textAlign: "center" }
          },
            React.createElement("div", { style: { fontSize: 14, color: "#d4a636", fontWeight: 700, letterSpacing: 3, marginBottom: 12 } }, "FEED ANIMALS"),
            React.createElement("div", { style: { fontSize: 12, color: "#9c8e78", marginBottom: 16, lineHeight: 1.6 } }, "Feed all animals once per day. Fed animals earn points. Unfed earn nothing."),
            farmData && React.createElement("div", { style: { fontSize: 11, color: farmData.fedToday ? "#4caf50" : "#f0c040", marginBottom: 16 } }, farmData.fedToday ? "\u2713 Animals fed today!" : "Animals need feeding"),
            React.createElement("button", {
              onClick: function() { window._srDoFeedAnimals && window._srDoFeedAnimals(); },
              disabled: farmData && farmData.fedToday,
              style: { width: "100%", padding: "12px 0", border: "none", borderRadius: 8, fontSize: 14, fontWeight: 700, letterSpacing: 2, cursor: farmData && farmData.fedToday ? "default" : "pointer", color: "#e8ddd0", background: farmData && farmData.fedToday ? "linear-gradient(180deg, #3a5a2a, #2d4a20)" : "repeating-linear-gradient(0deg,transparent,transparent 3px,rgba(0,0,0,.06) 3px,rgba(0,0,0,.06) 4px),linear-gradient(180deg,#8b5e3c,#6d4a2d 50%,#5c3f24)", opacity: farmData && farmData.fedToday ? 0.5 : 1 }
            }, farmData && farmData.fedToday ? "\u2713 FED TODAY" : "\uD83C\uDF3E FEED ALL ANIMALS")
          ),

          // LAND
          panel === "land" && React.createElement("div", {
            style: { background: "rgba(14,11,8,0.95)", borderRadius: 12, border: "1px solid #2a1f14", padding: 16, backdropFilter: "blur(10px)" }
          },
            React.createElement("div", { style: { fontSize: 14, color: "#d4a636", fontWeight: 700, letterSpacing: 3, marginBottom: 12 } }, "EXPAND RANCH"),
            React.createElement("div", { style: { fontSize: 11, color: "#9c8e78", marginBottom: 12, lineHeight: 1.6 } }, "Burn $RANCH to unlock new land. Tap a locked chunk on the map."),
            [{ ring: "Ring 1", chunks: 12, cost: "100k" }, { ring: "Ring 2", chunks: 20, cost: "500k" }, { ring: "Ring 3", chunks: 28, cost: "1M" }].map(function(r, i) {
              return React.createElement("div", { key: i, style: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: 12, background: "linear-gradient(180deg, #1f1a14, #161210)", border: "1px solid #2a1f14", borderRadius: 10, marginBottom: 8 } },
                React.createElement("div", null,
                  React.createElement("div", { style: { fontSize: 13, fontWeight: 700, color: "#e8ddd0" } }, r.ring),
                  React.createElement("div", { style: { fontSize: 9, color: "#6d5838" } }, r.chunks + " chunks")
                ),
                React.createElement("div", { style: { padding: "4px 12px", borderRadius: 8, background: "linear-gradient(180deg, #5a4210, #3d2e1e)", border: "1px solid #8b6914" } },
                  React.createElement("span", { style: { fontSize: 11, fontWeight: 700, color: "#f0c040" } }, r.cost + " $R each")
                )
              );
            })
          )
        ),

      panel && typeof panel === "object" && panel.type === "unlock" && React.createElement("div", {
          style: {
            background: "linear-gradient(180deg, #1a1510f0, #0e0b08f8)",
            borderTop: "2px solid #3d2e1e",
            padding: "20px 12px",
            boxShadow: "0 -6px 24px rgba(0,0,0,0.7)",
            borderRadius: "12px 12px 0 0",
            textAlign: "center",
          }
        },
          React.createElement("div", { style: { fontSize: 15, fontWeight: 700, color: "#d4a636", letterSpacing: 2, marginBottom: 4, textShadow: "0 2px 4px rgba(0,0,0,0.5)" } }, "EXPAND YOUR RANCH"),
          React.createElement("div", { style: { fontSize: 11, color: "#9c8e78", marginBottom: 10 } }, "Chunk (" + panel.cx + ", " + panel.cy + ")"),
          React.createElement("div", { style: { fontSize: 26, color: "#f0c040", fontWeight: 700, marginBottom: 14, textShadow: "0 0 16px rgba(240,192,64,0.3)" } }, (RING_COST[panel.ring] / 1000) + "k $RANCH"),
          React.createElement("div", { style: { fontSize: 9, color: "#6d5838", letterSpacing: 1, marginBottom: 4 } }, "BURN ADDRESS"),
          React.createElement("div", {
            onClick: function() { try { navigator.clipboard.writeText("1nc1nerator11111111111111111111111111111111"); } catch(e) {} },
            style: { fontSize: 9, color: "#e8ddd0", background: "#0e0b08", border: "1px solid #2a1f14", borderRadius: 6, padding: "6px 8px", marginBottom: 10, wordBreak: "break-all", cursor: "pointer", userSelect: "all" }
          }, "1nc1nerator11111111111111111111111111111111"),
          React.createElement("div", { style: { fontSize: 9, color: "#6d5838", letterSpacing: 1, marginBottom: 4 } }, "PASTE TX SIGNATURE"),
          React.createElement("input", {
            type: "text", value: unlockTx, placeholder: "Paste transaction signature...",
            onChange: function(e) { setUnlockTx(e.target.value); },
            style: { width: "100%", padding: "8px 10px", boxSizing: "border-box", background: "#0e0b08", border: "1px solid #2a1f14", borderRadius: 6, color: "#e8ddd0", fontFamily: "'Pixelify Sans', sans-serif", fontSize: 11, textAlign: "center", outline: "none", marginBottom: 10 }
          }),
          unlockErr && React.createElement("div", { style: { fontSize: 11, color: "#ff6b6b", marginBottom: 8 } }, unlockErr),
          React.createElement("button", {
            onClick: function () { doUnlock(panel.cx, panel.cy); },
            disabled: unlocking,
            style: {
              padding: "10px 32px", color: "#e8ddd0", border: "2px solid #c8a84e", borderRadius: 8,
              fontSize: 14, fontWeight: 700, cursor: unlocking ? "default" : "pointer", letterSpacing: 2, opacity: unlocking ? 0.5 : 1,
              background: "repeating-linear-gradient(0deg,transparent,transparent 3px,rgba(0,0,0,.06) 3px,rgba(0,0,0,.06) 4px),linear-gradient(180deg,#8b5e3c,#6d4a2d 50%,#5c3f24)",
              boxShadow: "inset 0 1px 0 rgba(180,140,90,.3),inset 0 -1px 0 rgba(0,0,0,.4),0 4px 12px rgba(0,0,0,.5)",
              textShadow: "0 1px 2px rgba(0,0,0,0.5)",
            }
          }, unlocking ? "VERIFYING..." : "BURN & UNLOCK")
        ),

        // PLACEMENT CONFIRM BAR
        placing && React.createElement("div", {
          style: { display: "flex", gap: 8, padding: "10px 16px", justifyContent: "center" }
        },
          React.createElement("button", {
            onClick: cancelPlace,
            style: { flex: 1, maxWidth: 160, padding: "10px 0", background: "linear-gradient(180deg,#3d2e1e,#2a1f14)", border: "2px solid #5a4a2a", borderRadius: 8, color: "#9c8e78", fontSize: 13, fontWeight: 700, cursor: "pointer", letterSpacing: 2 }
          }, "CANCEL"),
          React.createElement("button", {
            onClick: confirmPlace,
            style: { flex: 1, maxWidth: 160, padding: "10px 0", border: "2px solid #6a8a3a", borderRadius: 8, color: "#e8ddd0", fontSize: 13, fontWeight: 700, cursor: "pointer", letterSpacing: 2, background: "repeating-linear-gradient(0deg,transparent,transparent 3px,rgba(0,0,0,.06) 3px,rgba(0,0,0,.06) 4px),linear-gradient(180deg,#4a6a2a,#3a5a1a)", boxShadow: "inset 0 1px 0 rgba(100,160,80,.2),0 2px 6px rgba(0,0,0,.4)" }
          }, "PLACE HERE")
        ),

        // ═══ BOTTOM TOOLBAR ═══
        React.createElement("div", {
          style: {
            display: "flex", justifyContent: "space-evenly", alignItems: "center",
            padding: "10px 6px 64px",
            background: "linear-gradient(180deg, rgba(26,21,16,0.95), rgba(14,11,8,0.98))",
            borderTop: "2px solid #3d2e1e",
          }
        },
          [
            { k: "shop", icon: "🛒", label: "SHOP", color: "#5a4a2a", colorDark: "#3d2e1e" },
            { k: "bag", icon: "🎒", label: "BAG", color: "#4a5a2a", colorDark: "#2e3d1e" },
            { k: "feed", icon: "🌾", label: "FEED", color: "#2a5a4a", colorDark: "#1e3d2e" },
            { k: "land", icon: "🗺️", label: "LAND", color: "#4a4a5a", colorDark: "#2e2e3d" },
          ].map(function(item) {
            return React.createElement(GameBtn, {
              key: item.k,
              icon: item.icon,
              label: item.label,
              color: item.color,
              colorDark: item.colorDark,
              active: panel === item.k,
              onClick: function() { setPanel(panel === item.k ? null : item.k); },
            });
          })
        )
,

      

      // WALLET SCREEN
      !wallet && React.createElement(WalletScreen, {
        walletInput: walletInput,
        setWalletInput: setWalletInput,
        onConnect: function() { connectWallet(); }
      }),

      // MENU OVERLAY
      showNameModal && React.createElement(NameModal, {
        currentName: rancher && rancher.ranch_name !== "Unnamed Ranch" ? rancher.ranch_name : "",
        onSave: saveRanchName,
        onCancel: function() { setShowNameModal(false); setIsNewRancher(false); },
        isNew: isNewRancher,
      }),

      // BUY POPUP
      buyItem && wallet && React.createElement(BurnPopup, {
        item: buyItem.item, cat: buyItem.cat, wallet: wallet,
        onClose: function() { setBuyItem(null); },
        onSuccess: function(data) { setBuyItem(null); setToast({ message: data.message || "Purchased!", type: "success" }); setTimeout(function(){setToast(null);},3000); api("/farm/" + wallet).then(function(d){if(d)setFarmData(d);}); api("/farm/shop/items").then(function(d){if(d)setShopItems(d);}); }
      }),

      // TOAST
      toast && React.createElement("div", {
        style: {
          position: "fixed", bottom: 80, left: "50%", transform: "translateX(-50%)",
          padding: "10px 20px", borderRadius: 8, zIndex: 300,
          background: toast.type === "error" ? "rgba(255,80,80,0.9)" : "rgba(212,166,54,0.9)",
          color: "#fff", fontSize: 12, fontWeight: 700, fontFamily: "'Pixelify Sans', sans-serif",
          boxShadow: "0 4px 16px rgba(0,0,0,0.5)", textAlign: "center",
          animation: "slideIn 0.3s ease",
        }
      }, toast.message),


      )
    )
  );
}
