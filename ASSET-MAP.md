# Sol Ranch Phase 5 — Asset Map (Cozy Farm by shubibubi)

*Generated March 21, 2026*

---

## Source Files

| File | Size | Purpose |
|------|------|---------|
| tiles/tiles.png | 864x800 | All terrain tiles (4 seasons) |
| Buildings/buildings.png | 1503x1072 | All buildings (4 seasons) |
| farming/crops.png | 96x592 | 10 crops x 5 growth stages (dry soil) |
| farming/crops_wet.png | 96x592 | Same crops on wet soil |
| farming/crops_all.png | 400x592 | All crops + flowers + all seasons combined |
| farming/crops_winter.png | 96x592 | Winter crop variants |
| farming/seeds.png | 112x96 | Seed packets (7x6 grid) |
| farming/tools.png | 592x64 | Machines, fences, props |
| farming/scarecrows.png | varies | 4 seasonal scarecrows |
| ui/items.png | 160x192 | 89 inventory icons (10x12 grid, 16px) |
| ui/UI.png | 384x144 | Clock, toolbar, health/stamina, font |
| ui/UI_all.png | varies | Complete UI reference |
| ui/inventory.png | 848x1360 | Full inventory layout |
| ui/inventory_chopped.png | 656x320 | Inventory components |
| ui/button maker.png | varies | Button templates + font |
| ui/logo maker.png | varies | Logo background + font |
| global.png | 2368x1136 | Everything on one mega sheet |
| animals/*.png | varies | 27 animal sprite sheets |
| Buildings/gifs/**/*.gif | varies | Animated doors per building per season |
| enemies/**/*.png+gif | varies | Slimes (9 colors), bats (3), ghost |
| farming/*.gif | varies | Machine animations |
| tiles/*.gif | varies | Gate, flower, tree shake animations |

---

## Tile Map: tiles.png (864x800)

The sprite sheet is organized in 3 seasonal columns:

| Column | X Range | Season |
|--------|---------|--------|
| Left | 0-287 | Spring |
| Middle | 288-575 | Fall |
| Right | 576-863 | Winter |

Summer variants use the Spring column base with swapped detail colors.

### Terrain Tiles (per season column, 16px grid)

**Grass Autotile** — Rows 0-2 (y:0-47), 18 tiles wide
- Standard 47-tile autotile blob layout (GM2 format)
- Grass details: flowers, mushrooms, pebbles at row 1 right side

**Grass-Dirt Transition** — Rows 3-5 (y:48-95)
- Autotile for grass-to-dirt edges

**Water + Cliff** — Rows 6-9 (y:96-159)
- Water autotile with animated bubbles
- Cliff edges, cliff-water transitions
- Stairs (cliff access)

**Soil** — Located in farming/crops.png
- Dry soil: first row of crops.png
- Wet soil: first row of crops_wet.png

**Dirt Path** — Row ~10 (y:160+)
- Path autotile for walkways

**Snow Tiles** — Winter column only
- Snow autotile + 6 snow details

### Decoration Tiles (per season)

**Trees** (y:320+ area)
- Fruit tree: ~32x32 (2x2 tiles)
- Pine tree: ~32x48 (2x3 tiles)
- Regular tree: ~32x48 (2x3 tiles)
- Stumps: 16x16 each
- Tree shake animations: separate GIFs per season

**Rocks** — 2 variants, 16x16 each

**Bushes** — 2 variants, 16x16 each

**Flowers** — Animated, per season (separate GIFs)
- Spring: blue, white
- Summer: orange, red
- Fall: orange, red
- Winter: blue, purple

**Fences**
- Wood fence: horizontal + vertical + corners + posts
- Stone fence: horizontal + vertical + corners + posts
- Wood gate: animated (GIF per season)
- Stone gate: animated (GIF per season)

**Bridges**
- Wood bridge: tileable horizontal
- Stone bridge: tileable horizontal

**Streetlights**
- Green: animated flicker (+ winter/snow variant)
- Black: static (+ winter variant)

**Benches** — 2 colors + snowy variants

---

## Buildings: buildings.png (1503x1072)

Buildings are NOT on a 16px grid — they are larger composite sprites. Each building has 4 seasonal variants arranged horizontally.

### Player House
- Base: ~48x48 (3x3 tiles)
- Upgrade 1: ~64x48 (4x3 tiles)
- Upgrade 2: ~64x64 (4x4 tiles)
- 4 seasons x 3 levels = 12 sprites
- Animated doors: Buildings/gifs/player house/

### Barn (for cows, pigs, sheep, goats)
- Size: ~64x48 (4x3 tiles)
- 4 seasons
- Animated doors: Buildings/gifs/barn/
- Animal sign variants included

### Coop (for chickens, bunnies, turkeys)
- Size: ~48x48 (3x3 tiles)
- 4 seasons
- Animated doors: Buildings/gifs/coop/
- Animal sign variants included

### Greenhouse
- Size: ~64x48 (4x3 tiles)
- 4 seasons
- Animated door: Buildings/gifs/greenhouse/

### Mill
- Size: ~48x64 (3x4 tiles)
- 4 seasons
- Flour ready indicator (bubble)

### Silo
- Size: ~32x48 (2x3 tiles)
- 2 color options (matches barn or coop)
- 4 seasons

### Slime Hut
- Size: ~48x48 (3x3 tiles)
- 4 seasons
- Animated door: Buildings/gifs/slimehut/

### Market
- Size: ~96x48 (6x3 tiles)
- 4 seasons
- Animated sign: Buildings/gifs/market/
- Wooden category signs

### Hospital
- Size: ~64x48 (4x3 tiles)
- 4 seasons
- Animated sign: Buildings/gifs/hospital/

### Museum
- Size: ~64x48 (4x3 tiles)
- 4 seasons
- Animated door: Buildings/gifs/museum/

### NPC Houses (7 variants)
- Various sizes ~48x48 to ~64x48
- 4 seasons each
- Animated doors: Buildings/gifs/NPC1-7/

---

## Crops: farming/crops.png (96x592)

6 columns x 37 rows at 16px. Layout per crop:

| Column | Content |
|--------|---------|
| 0 | Soil with seed (planted) |
| 1 | Growth stage 1 (sprout) |
| 2 | Growth stage 2 |
| 3 | Growth stage 3 |
| 4 | Growth stage 4 |
| 5 | Growth stage 5 (harvestable) |

### Crop List (order in sprite sheet, top to bottom)

| # | Crop | Row Start | Notes |
|---|------|-----------|-------|
| 0 | Carrot | 0 | |
| 1 | Tomato | ~3 | |
| 2 | Strawberry | ~6 | |
| 3 | Pumpkin | ~9 | Larger sprite at stage 5 |
| 4 | Corn | ~12 | Taller sprite at stages 4-5 |
| 5 | Potato | ~15 | |
| 6 | Watermelon | ~18 | Larger sprite at stage 5 |
| 7 | Radish | ~21 | |
| 8 | Lettuce | ~24 | |
| 9 | Wheat | ~27 | |

After crops: Flowers (Rose, Tulip, Lily, Alfalfa, Canola) with 4 growth stages each.

### Variants
- crops.png = dry soil (spring)
- crops_wet.png = wet/watered soil
- crops_winter.png = winter soil
- crops_winter_wet.png = winter wet soil

---

## Seeds: farming/seeds.png (112x96)

7 columns x 6 rows at 16px = 42 seed packet icons.
Includes crop seeds + flower seeds, color-coded packets.

---

## Animals (27 sprite sheets in animals/)

Each animal PNG is a sprite sheet with walk (4 directions x 4 frames) + sleep (4 frames).

| Animal | File | Grid Size | Frames |
|--------|------|-----------|--------|
| Chicken (white) | chicken animation.png | 16x16 | 64x80 = 4x5 |
| Chicken (brown) | chicken_brown animation.png | 16x16 | |
| Baby Chick | chicken_baby animation.png | 16x16 | |
| Cow (spotted) | cow animation.png | 24x24 | 96x120 = 4x5 |
| Cow (black) | cow_black animation.png | 24x24 | |
| Cow (brown) | cow_brown animation.png | 24x24 | |
| Baby Cow (3 variants) | cow_baby*.png | 21x21 | |
| Pig (pink) | pig animation.png | 20x20 | 80x100 = 4x5 |
| Pig (striped) | pig_stripe animation.png | 20x20 | |
| Baby Pig (2 variants) | pig_baby*.png | 16x16 | |
| Sheep | sheep animation.png | 17x17 | 68x85 = 4x5 |
| Baby Sheep | sheep_baby animation.png | 16x16 | |
| Goat | goat animation.png | 19x19 | 76x95 = 4x5 |
| Goat (striped) | goat_stripe animation.png | 19x19 | |
| Baby Goat (2 variants) | goat_baby*.png | 16x16 | |
| Turkey | turkey animation.png | 17x17 | 68x85 = 4x5 |
| Bunny | bunny_animations.png | 17x17 | 68x85 = 4x5 |
| Bunny (grey) | bunny_grey animation.png | 17x17 | |
| Baby Bunny (2 variants) | bunny_baby*.png | 16x16 | |

### Animation Layout (all animals follow same pattern)
- Row 0: Walk down (4 frames)
- Row 1: Walk right (4 frames)
- Row 2: Walk up (4 frames)
- Row 3: Walk left (4 frames)
- Row 4: Sleep (4 frames)

### Frame Rates (from info.txt)
- Walk: 200ms per frame
- Sleep: 300, 500, 300, 700ms per frame
- Baby sheep/goat walk: 150ms per frame

---

## Enemies

### Slimes (9 colors: red, orange, yellow, green, blue, purple, pink, black, rainbow)
- Each: individual PNG sprite sheet + GIF animations
- Animations: walk (4 dir), idle (4 dir), attack (4 dir), die (4 dir)
- Walk FR: 100ms, Idle FR: 250ms
- Drop items: slime_items.png (9 color-coded drops)

### Bats (3 colors: purple, red, black)
- bat_all.png = combined sheet
- Individual PNGs per color
- GIF animations: walk 4 directions + die

### Ghost
- ghost_all.png = combined sheet
- Animations: walk, attack, die

---

## UI: ui/ folder

### items.png (160x192) — 89 Inventory Icons
10 columns x 12 rows at 16px. Order matches item list.txt:
Row 0: Carrot, Tomato, Strawberry, Pumpkin, Corn, Potato, Watermelon, Radish, Lettuce, Wheat
Row 1: Apple, Avocado, Cherry, Sour Cherry, Orange, Plum, Sour Plum, Pear, Peach, Lemon
Row 2: Cow Milk, Goat Milk, Butter, Cheese, Mozzarella, Goat Cheese, Bacon, White Feather, Brown Feather, Turkey Feather
Row 3: White Egg, L.White Egg, Brown Egg, L.Brown Egg, Green Egg, L.Green Egg, Blue Egg, L.Blue Egg, Mayo, White Wool
Row 4: Grey Wool, White Yarn, Grey Yarn, White Cloth, Grey Cloth, Hay, Raspberry, Wild Berries, Fawn Mushroom, Violet Webcap
Row 5: Diamond, Ruby, Emerald, Gold Nugget, Silver Nugget, Copper Nugget, Wood, Stone, Pine Cone, Snail
Row 6: Clam, Water Bottle, Red Rose, Orange Rose, Yellow Rose, Pink Rose, Purple Rose, Blue Rose, Black Rose, White Lily
Row 7: Yellow Lily, Red Camellia, Orange Camellia, Yellow Camellia, Pink Camellia, Purple Camellia, Blue Camellia, Black Camellia, White Camellia, Red Tulip
Row 8+: More flowers, Canola, Alfalfa, slime drops...

### UI.png (384x144) — HUD Elements
- Clock widget (time, day, date, currency display)
- Custom pixel font (numbers + days of week)
- Toolbar (wooden plank style)
- Health bar (tileable)
- Stamina bar (tileable)

### inventory.png (848x1360) — Full Inventory Layout
- Complete inventory panel with slots
- 8 seasonal portrait backgrounds
- Equipment slots (hat, shirt, pants, shoes, ring)

### button maker.png — Button Templates
- Start, Exit, New Save, Back buttons
- Custom font for making new buttons

---

## Farming Machines (GIFs in farming/)

| Machine | File | Frame Rate |
|---------|------|-----------|
| Mayo Maker | mayomaker.gif | 250ms |
| Butter Churn | butterchurn.gif | 250ms |
| Cheese Press | press_cheese.gif | 250ms |
| Goat Cheese Press | press_goat.gif | 250ms |
| Mozzarella Press | press_mozzarella.gif | 250ms |
| Cloth Maker | clothmaker.gif | 200ms |
| Spindle | spindle.gif | 200ms |

crafting ready.png = bubble indicator when machine output is ready

---

## Game Object → Sprite Mapping

### Phase 5 Priority (what we build first)

| Game Object | Sprite Source | Notes |
|-------------|-------------|-------|
| Base terrain (grass) | tiles.png spring col | Autotile, fill entire 64x64 |
| Map border (water) | tiles.png water section | Edge tiles |
| Locked land overlay | Custom dark tint | Code-generated |
| Soil plot | farming/crops.png col 0 | Empty tilled soil |
| Crop stages 1-5 | farming/crops.png cols 1-5 | Per crop type |
| Player House | buildings.png row 0 | Auto-placed at center |
| Barn | buildings.png | Unlockable building |
| Coop | buildings.png | Unlockable building |
| Greenhouse | buildings.png | Unlockable building |
| Mill | buildings.png | Unlockable building |
| Silo | buildings.png | Unlockable building |
| Chicken | animals/chicken animation.png | Walk + sleep in coop area |
| Cow | animals/cow animation.png | Walk + sleep in barn area |
| Pig | animals/pig animation.png | Walk + sleep in barn area |
| Sheep | animals/sheep animation.png | Walk + sleep in barn area |
| Goat | animals/goat animation.png | Walk + sleep in barn area |
| Wood fence | tiles.png fence section | Placeable decoration |
| Stone fence | tiles.png fence section | Placeable decoration |
| Trees | tiles.png tree section | Decorative placement |
| Flowers | tiles.png + GIFs | Decorative placement |
| Inventory icons | ui/items.png | Side panel display |
| HUD clock | ui/UI.png | Top overlay |
| Toolbar | ui/UI.png | Bottom overlay |

---

## File Organization for VPS

Upload to: `/opt/sol-ranch-dev/frontend/public/sprites/cozy/`

```
cozy/
  tiles.png
  buildings.png
  crops.png
  crops_wet.png
  crops_winter.png
  seeds.png
  items.png
  ui.png
  tools.png
  scarecrows.png
  animals/
    chicken.png
    chicken_brown.png
    chicken_baby.png
    cow.png
    cow_black.png
    cow_brown.png
    cow_baby.png
    cow_baby_black.png
    cow_baby_brown.png
    pig.png
    pig_stripe.png
    pig_baby.png
    pig_baby_stripe.png
    sheep.png
    sheep_baby.png
    goat.png
    goat_stripe.png
    goat_baby.png
    goat_baby_stripe.png
    turkey.png
    bunny.png
    bunny_grey.png
    bunny_baby.png
    bunny_baby_grey.png
  enemies/
    (later phase)
```

Note: Filenames will be cleaned (spaces removed) during upload.
