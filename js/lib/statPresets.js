export const PRESET_STATS = [
  { id: "distance_traveled", label: "Distance Traveled", aggregateCm: true, format: "distance" },
  { id: "jumps", label: "Jumps", keys: ["JUMP"], format: "count" },
  { id: "mob_kills", label: "Mob Kills", keys: ["MOB_KILLS_TOTAL", "MOB_KILLS"], format: "count" },
  { id: "time_played", label: "Time Played", keys: ["PLAY_ONE_MINUTE", "TIME_PLAYED"], format: "time" },
  { id: "player_deaths", label: "Deaths", keys: ["DEATHS"], format: "count" },
  { id: "crafting_table_interactions", label: "Crafting Table Interactions", keys: ["CRAFTING_TABLE_INTERACTION"], format: "count" },
  { id: "blocks_mined", label: "Blocks Mined", keys: ["BLOCKS_MINED_TOTAL"], format: "count" },
];

export const CM_DISTANCE_LABELS = {
  WALK: "Walked",
  SPRINT: "Sprinted",
  CROUCH: "Crouched",
  FLY: "Flown",
  AVIATE: "by Elytra",
  CLIMB: "Climbed",
  FALL: "Fallen",
  SWIM: "Swum",
  DIVE: "Dove",
  BOAT: "by Boat",
  WALK_ON_WATER: "Walked on Water",
  WALK_UNDER_WATER: "Walked Underwater",
};
export const STAT_PREFIX_LABELS = {
  KILL_ENTITY: "Kills",
  ENTITY_KILLED_BY: "Killed By",
  MINE_BLOCK: "Mined",
  USE_ITEM: "Used",
  BREAK_ITEM: "Broken",
  CRAFT_ITEM: "Crafted",
  DROP: "Dropped",
  PICKUP: "Picked Up",
};
export const STAT_NAME_OVERRIDES = {
  PLAY_ONE_MINUTE: "Time Played",
  TIME_PLAYED: "Time Played",
  SHULKER_BOX_OPENED: "Shulker Boxes Opened",
  CHEST_OPENED: "Chests Opened",
  BLOCKS_MINED_TOTAL: "Blocks Mined",
  LEAVE_GAME: "Games Quit",
  TALKED_TO_VILLAGER: "Talked to Villagers",
  DROP_COUNT: "Items Dropped",
  ARMOR_CLEANED: "Armor Pieces Cleaned",
  OPEN_BARREL: "Barrels Opened",
  CAULDRON_FILLED: "Cauldrons Filled",
  DISPENSER_INSPECTED: "Dispensers Searched",
  DROPPER_INSPECTED: "Droppers Searched",
  HOPPER_INSPECTED: "Hoppers Searched",
  ENDERCHEST_OPENED: "Ender Chests Opened",
  MOB_KILLS_TOTAL: "Direct Mob Kills",
  MOB_KILLS: "Total Mob Kills",
  TOTAL_WORLD_TIME: "Time with World Open",
  TRADED_WITH_VILLAGER: "Traded with Villagers",
  CAULDRON_USED: "Cauldrons Used",
  DAMAGE_DEALT: "Damage Dealt",
  DAMAGE_TAKEN: "Damage Taken",
  SNEAK_TIME: "Sneak Time",
  TIME_SINCE_REST: "Time Since Last Rest",
  TIME_SINCE_DEATH: "Time Since Last Death",
  JUMP: "Jumps",
  DEATHS: "Deaths",
  PLAYER_KILLS: "Player Kills",
  FISH_CAUGHT: "Fish Caught",
  ANIMALS_BRED: "Animals Bred",
  BELL_RING: "Bells Rung",
  CAKE_SLICES_EATEN: "Cake Slices Eaten",
  ENCHANT_ITEM: "Items Enchanted",
  ITEM_ENCHANTED: "Items Enchanted",
  FLOWER_POTTED: "Plants Potted",
  RAID_TRIGGER: "Raids Triggered",
  RAID_WIN: "Raids Won",
  RECORD_PLAYED: "Music Discs Played",
  NOTEBLOCK_PLAYED: "Note Blocks Played",
  NOTEBLOCK_TUNED: "Note Blocks Tuned",
  SLEEP_IN_BED: "Times Slept in a Bed",
  INTERACT_WITH_BREWINGSTAND: "Interactions with Brewing Stand",
  BREWINGSTAND_INTERACTION: "Interactions with Brewing Stand",
};

export function titleCaseStatKey(str) {
  return str
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// Blocks Minecraft draws with a block-entity renderer (code, not a JSON model)
// so blockrender.dev has nothing to rasterise and 404s. Those fall back to the
// Minecraft Wiki's file for that block instead. Plain "banner" has no wiki file
// (only the coloured variants), so it maps to the white banner, and the wood
// chest variants all share the generic chest sprite.
const WIKI_BLOCK_FALLBACKS = {
  chest: "Chest.png",
  oak_chest: "Chest.png",
  spruce_chest: "Chest.png",
  birch_chest: "Chest.png",
  jungle_chest: "Chest.png",
  acacia_chest: "Chest.png",
  dark_oak_chest: "Chest.png",
  crimson_chest: "Chest.png",
  warped_chest: "Chest.png",
  mangrove_chest: "Chest.png",
  cherry_chest: "Chest.png",
  pale_oak_chest: "Chest.png",
  copper_chest: "Copper_Chest.png",
  exposed_copper_chest: "Exposed_Copper_Chest.png",
  weathered_copper_chest: "Weathered_Copper_Chest.png",
  oxidized_copper_chest: "Oxidized_Copper_Chest.png",
  // Copper golem statues are block-entity blocks, so no blockrender.dev
  // output. Waxed variants are visually identical to their unwaxed stage.
  copper_golem_statue: "Copper_Golem_Statue.png",
  exposed_copper_golem_statue: "Exposed_Copper_Golem_Statue.png",
  weathered_copper_golem_statue: "Weathered_Copper_Golem_Statue.png",
  oxidized_copper_golem_statue: "Oxidized_Copper_Golem_Statue.png",
  waxed_copper_golem_statue: "Copper_Golem_Statue.png",
  waxed_exposed_copper_golem_statue: "Exposed_Copper_Golem_Statue.png",
  waxed_weathered_copper_golem_statue: "Weathered_Copper_Golem_Statue.png",
  waxed_oxidized_copper_golem_statue: "Oxidized_Copper_Golem_Statue.png",
  mob_spawner: "Monster_Spawner.png",
  trapped_chest: "Trapped_Chest.png",
  ender_chest: "Ender_Chest.png",
  shulker_box: "Shulker_Box.png",
  white_shulker_box: "White_Shulker_Box.png",
  orange_shulker_box: "Orange_Shulker_Box.png",
  magenta_shulker_box: "Magenta_Shulker_Box.png",
  light_blue_shulker_box: "Light_Blue_Shulker_Box.png",
  yellow_shulker_box: "Yellow_Shulker_Box.png",
  lime_shulker_box: "Lime_Shulker_Box.png",
  pink_shulker_box: "Pink_Shulker_Box.png",
  gray_shulker_box: "Gray_Shulker_Box.png",
  light_gray_shulker_box: "Light_Gray_Shulker_Box.png",
  cyan_shulker_box: "Cyan_Shulker_Box.png",
  purple_shulker_box: "Purple_Shulker_Box.png",
  blue_shulker_box: "Blue_Shulker_Box.png",
  brown_shulker_box: "Brown_Shulker_Box.png",
  green_shulker_box: "Green_Shulker_Box.png",
  red_shulker_box: "Red_Shulker_Box.png",
  black_shulker_box: "Black_Shulker_Box.png",
  decorated_pot: "Decorated_Pot.png",
  skeleton_skull: "Skeleton_Skull.png",
  wither_skeleton_skull: "Wither_Skeleton_Skull.png",
  zombie_head: "Zombie_Head.png",
  player_head: "Player_Head.png",
  creeper_head: "Creeper_Head.png",
  dragon_head: "Dragon_Head.png",
  piglin_head: "Piglin_Head.png",
  conduit: "Conduit.png",
  shield: "Shield.png",
  trident: "Trident_(item).png",
  brush: "Brush.png",
  trial_key: "Trial_Key.png",
  ominous_trial_key: "Ominous_Trial_Key.png",
  banner: "White_Banner.png",
  white_banner: "White_Banner.png",
  orange_banner: "Orange_Banner.png",
  magenta_banner: "Magenta_Banner.png",
  light_blue_banner: "Light_Blue_Banner.png",
  yellow_banner: "Yellow_Banner.png",
  lime_banner: "Lime_Banner.png",
  pink_banner: "Pink_Banner.png",
  gray_banner: "Gray_Banner.png",
  light_gray_banner: "Light_Gray_Banner.png",
  cyan_banner: "Cyan_Banner.png",
  purple_banner: "Purple_Banner.png",
  blue_banner: "Blue_Banner.png",
  brown_banner: "Brown_Banner.png",
  green_banner: "Green_Banner.png",
  red_banner: "Red_Banner.png",
  black_banner: "Black_Banner.png",
};

// The DB occasionally emits stat targets without their word separator, and wall
// variants (which are just the standing block mounted on a wall surface and have
// no separate render) share the standing model's icon.
const BLOCK_ID_ALIASES = {
  enderchest: "ender_chest",
  trappedchest: "trapped_chest",
  shulkerbox: "shulker_box",
  decoratedpot: "decorated_pot",
  brewingstand: "brewing_stand",
  noteblock: "note_block",
  wall_head: "player_head",
  wall_skull: "skeleton_skull",
  wall_banner: "white_banner",
};

const INVISIBLE_ID_RE = /^(air|cave_air|void_air)$/;

// A 1x1 transparent PNG: air has no icon slot content, but the slot still
// needs to exist so rows keep their alignment.
const TRANSPARENT_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

function canonicalBlockId(id) {
  const lower = (id || "").toLowerCase();
  const wallMatch = lower.match(/^(.+)_wall_(head|skull|banner)$/);
  if (wallMatch) return `${wallMatch[1]}_${wallMatch[2]}`;
  return BLOCK_ID_ALIASES[lower] || lower;
}

// Flat or sparse block models (rails, webs) render as a squashed sliver through
// the block endpoint, so draw them with their item sprite instead.
const FLAT_RENDER_IDS = new Set(["rail", "powered_rail", "detector_rail", "activator_rail", "cobweb"]);

// Blocks whose block-renderer output comes out sideways/cropped (bell hangs at
// a weird angle as a block), flattened into a sliver (glass panes), rendered in
// half (doors, 2-block plants), or just wrong (pistons, beds, coral fans) by
// the block endpoint - every stat targeting them uses their item sprite, which
// is always a clean front-facing render.
const ITEM_RENDER_BLOCK_IDS = new Set([
  "bell",
  // pistons render fine as blocks except when their arm is extended
  "piston",
  "sticky_piston",
  // panes/bars flatten into a squashed sliver
  "glass_pane",
  "white_stained_glass_pane",
  "orange_stained_glass_pane",
  "magenta_stained_glass_pane",
  "light_blue_stained_glass_pane",
  "yellow_stained_glass_pane",
  "lime_stained_glass_pane",
  "pink_stained_glass_pane",
  "gray_stained_glass_pane",
  "light_gray_stained_glass_pane",
  "cyan_stained_glass_pane",
  "purple_stained_glass_pane",
  "blue_stained_glass_pane",
  "brown_stained_glass_pane",
  "green_stained_glass_pane",
  "red_stained_glass_pane",
  "black_stained_glass_pane",
  "iron_bars",
  // doors render as a single half
  "oak_door",
  "spruce_door",
  "birch_door",
  "jungle_door",
  "acacia_door",
  "dark_oak_door",
  "crimson_door",
  "warped_door",
  "mangrove_door",
  "cherry_door",
  "bamboo_door",
  "pale_oak_door",
  "copper_door",
  "exposed_copper_door",
  "weathered_copper_door",
  "oxidized_copper_door",
  "waxed_copper_door",
  "waxed_exposed_copper_door",
  "waxed_weathered_copper_door",
  "waxed_oxidized_copper_door",
  "iron_door",
  // beds render as a tilted two-block model
  "bed",
  "white_bed",
  "orange_bed",
  "magenta_bed",
  "light_blue_bed",
  "yellow_bed",
  "lime_bed",
  "pink_bed",
  "gray_bed",
  "light_gray_bed",
  "cyan_bed",
  "purple_bed",
  "blue_bed",
  "brown_bed",
  "green_bed",
  "red_bed",
  "black_bed",
  // coral fans flatten into a sliver (horn especially)
  "tube_coral_fan",
  "brain_coral_fan",
  "bubble_coral_fan",
  "fire_coral_fan",
  "horn_coral_fan",
  "dead_tube_coral_fan",
  "dead_brain_coral_fan",
  "dead_bubble_coral_fan",
  "dead_fire_coral_fan",
  "dead_horn_coral_fan",
  // the item sprite is the classic top-down sheet for this one
  "pointed_dripstone",
  "spyglass",
]);

// Cross-model plants/vegetation (flowers, grass, roots, saplings, fungi, kelp,
// vines, dripleaf...) render as a flat top-down X or clip hard - every stat
// targeting them uses their item sprite instead.
const PLANT_ITEM_RENDER_IDS = new Set([
  "dandelion",
  "poppy",
  "blue_orchid",
  "allium",
  "azure_bluet",
  "red_tulip",
  "orange_tulip",
  "white_tulip",
  "pink_tulip",
  "oxeye_daisy",
  "cornflower",
  "lily_of_the_valley",
  "torchflower",
  "wither_rose",
  "closed_eyeblossom",
  "open_eyeblossom",
  "pale_hibiscus",
  "sunflower",
  "lilac",
  "rose_bush",
  "peony",
  "pitcher_plant",
  "short_grass",
  "grass",
  "tall_grass",
  "fern",
  "large_fern",
  "short_dry_grass",
  "tall_dry_grass",
  "dead_bush",
  "pink_petals",
  "sugar_cane",
  "kelp",
  "seagrass",
  "tall_seagrass",
  "crimson_roots",
  "warped_roots",
  "nether_sprouts",
  "weeping_vines",
  "twisting_vines",
  "vine",
  "hanging_roots",
  "glow_lichen",
  "small_dripleaf",
  "big_dripleaf",
  "mangrove_propagule",
  "azalea",
  "flowering_azalea",
  "bamboo",
  "oak_sapling",
  "spruce_sapling",
  "birch_sapling",
  "jungle_sapling",
  "acacia_sapling",
  "dark_oak_sapling",
  "cherry_sapling",
  "pale_oak_sapling",
  "brown_mushroom",
  "red_mushroom",
  "crimson_fungus",
  "warped_fungus",
]);

function blockRenderUrl(id) {
  const canonical = canonicalBlockId(id);
  if (INVISIBLE_ID_RE.test(canonical)) return TRANSPARENT_PNG;
  const wikiFile = WIKI_BLOCK_FALLBACKS[canonical];
  if (wikiFile) return `https://minecraft.wiki/Special:FilePath/${wikiFile}`;
  if (FLAT_RENDER_IDS.has(canonical)) return itemRenderUrl(canonical);
  if (ITEM_RENDER_BLOCK_IDS.has(canonical)) return itemRenderUrl(canonical);
  if (PLANT_ITEM_RENDER_IDS.has(canonical)) return itemRenderUrl(canonical);
  return `https://blockrender.dev/render/block/${encodeURIComponent(canonical)}.png?size=512&crop=true`;
}

function itemRenderUrl(id) {
  const canonical = canonicalBlockId(id);
  if (INVISIBLE_ID_RE.test(canonical)) return TRANSPARENT_PNG;
  const wikiFile = WIKI_BLOCK_FALLBACKS[canonical];
  if (wikiFile) return `https://minecraft.wiki/Special:FilePath/${wikiFile}`;
  return `https://blockrender.dev/render/item/${encodeURIComponent(canonical)}.png?size=512&crop=true`;
}

// General stats whose key doesn't decompose into a target via a clean
// verb suffix/prefix, or whose verb maps to several possible blocks.
// Everything here renders as an item sprite unless marked "block".
const GENERAL_STAT_TARGETS = {
  ARMOR_CLEANED: { id: "leather_chestplate", render: "item" },
  BLOCKS_MINED_TOTAL: { id: "iron_pickaxe", render: "item" },
  CAKE_SLICES_EATEN: { id: "cake", render: "item" },
  DAMAGE_BLOCKED_BY_SHIELD: { id: "shield", render: "item" },
  DAMAGE_DEALT: { id: "iron_sword", render: "item" },
  DAMAGE_TAKEN: { id: "iron_sword", render: "item" },
  ITEMS_CRAFTED_TOTAL: { id: "crafting_table", render: "block" },
  FLOWER_POTTED: { id: "flower_pot", render: "block" },
  RECORD_PLAYED: { id: "music_disc_13", render: "item" },
  SLEEP_IN_BED: { id: "red_bed", render: "item" },
  TIME_SINCE_REST: { id: "red_bed", render: "item" },
};

// Distance stats ("X_ONE_CM") keyed by the transport/mechanism base, which
// gets its own icon where one exists (minecart, boat, elytra, ladder).
const DISTANCE_ICON_TARGETS = {
  AVIATE: "elytra",
  BOAT: "oak_boat",
  MINECART: "minecart",
  CLIMB: "ladder",
};

// Strip the trailing verb and treat the rest as a block id: Dispensers
// Searched -> dispenser, Hopper/Noteblock Played -> note_block, Bells Rung
// -> bell, Cauldrons Filled/Used -> cauldron, Chests Opened -> chest, etc.
const GENERAL_SUFFIX_RE = /^(.+)_(OPENED|INSPECTED|FILLED|USED|RING|PLAYED|TUNED)$/;

// Barrels Opened (OPEN_BARREL) puts the verb first, so flip it around.
const GENERAL_PREFIX_RE = /^OPEN_(.+)$/;

// Block/item stats get a real Minecraft render from blockrender.dev;
// entities and general stats have no block/item model, so they keep the
// FontAwesome fallback (the <img> is simply removed on 404).
export function statIconUrl(statKey) {
  const key = (statKey || "").trim();
  if (!key) return null;
  if (key.includes(":")) {
    const colon = key.indexOf(":");
    const prefix = key.slice(0, colon).trim().toUpperCase();
    const id = key.slice(colon + 1).trim();
    if (!id) return null;
    if (prefix === "MINE_BLOCK") return blockRenderUrl(id);
    if (["USE_ITEM", "BREAK_ITEM", "CRAFT_ITEM", "DROP", "PICKUP"].includes(prefix)) {
      return itemRenderUrl(id);
    }
    return null;
  }
  // "Interactions with X" keys come in two shapes the DB emits:
  // CAMPFIRE_INTERACTION and INTERACT_WITH_CAMPFIRE. Both are general counters
  // whose target is a block, so render it as a block. Entity targets (e.g.
  // villager) 404 and the onerror fallback hides the icon.
  let interactKey = null;
  const interactionSuffix = key.match(/^(.+)_INTERACTION$/);
  const interactPrefix = key.match(/^INTERACT_WITH_(.+)$/);
  if (interactionSuffix) interactKey = interactionSuffix[1];
  else if (interactPrefix) interactKey = interactPrefix[1];
  if (interactKey) {
    return blockRenderUrl(interactKey);
  }
  const targetOverride = GENERAL_STAT_TARGETS[key];
  if (targetOverride) {
    return targetOverride.render === "item" ? itemRenderUrl(targetOverride.id) : blockRenderUrl(targetOverride.id);
  }
  // General counters whose key is "<BLOCK>_<VERB>": strip the verb and render
  // the target as a block (Chests Opened, Dispensers Searched, Hopper/Note
  // Block Played, Bells Rung, Cauldrons Filled/Used...). Unknown rest remain
  // iconless - the onerror fallback hides the img if the render 404s.
  const suffixMatch = key.match(GENERAL_SUFFIX_RE);
  if (suffixMatch) {
    return blockRenderUrl(suffixMatch[1]);
  }
  const prefixMatch = key.match(GENERAL_PREFIX_RE);
  if (prefixMatch) {
    return blockRenderUrl(prefixMatch[1]);
  }
  const distanceMatch = key.match(/^(.+)_ONE_CM$/);
  if (distanceMatch) {
    const distanceIcon = DISTANCE_ICON_TARGETS[distanceMatch[1]];
    if (distanceIcon) return itemRenderUrl(distanceIcon);
  }
  return null;
}

export function getStatDisplayName(key) {
  if (!key) return "";
  const trimmedKey = key.trim();
  if (STAT_NAME_OVERRIDES[trimmedKey]) return STAT_NAME_OVERRIDES[trimmedKey];
  if (trimmedKey.endsWith("_ONE_CM")) {
    const base = trimmedKey.slice(0, -"_ONE_CM".length);
    if (CM_DISTANCE_LABELS[base]) return `Distance ${CM_DISTANCE_LABELS[base]}`;
    return `Distance by ${titleCaseStatKey(base)}`;
  }
  if (trimmedKey.includes(":")) {
    const [prefix, suffix] = trimmedKey.split(":").map((p) => p.trim());
    const label = STAT_PREFIX_LABELS[prefix] || titleCaseStatKey(prefix);
    return `${label} ${titleCaseStatKey(suffix)}`;
  }
  if (trimmedKey.endsWith("_INTERACTION")) {
    return `Interactions with ${titleCaseStatKey(trimmedKey.slice(0, -"_INTERACTION".length))}`;
  }
  const base = titleCaseStatKey(trimmedKey);
  if (base.startsWith("Interact With ")) return `Interactions with ${base.slice("Interact With ".length)}`;
  return base;
}

const PLAYTIME_KEYS = ["PLAY_ONE_MINUTE", "TIME_PLAYED"];

export function guessStatFormat(key) {
  const normalized = (key || "").trim();
  if (normalized.endsWith("_ONE_CM")) return "distance";
  if (PLAYTIME_KEYS.includes(normalized) || normalized.includes("TIME")) return "time";
  if (normalized.includes("DAMAGE")) return "damage";
  return "count";
}

export function formatStatValue(format, value) {
  const n = Number(value) || 0;
  switch (format) {
    case "distance":
      return `${(n / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })} blocks`;
    case "time": {
      const totalSeconds = n / 20;
      const days = Math.floor(totalSeconds / 86400);
      const hours = Math.floor((totalSeconds % 86400) / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const totalHours = Math.round(totalSeconds / 3600);
      const main = days > 0 ? `${days}d ${hours}h ${minutes}m` : `${hours}h ${minutes}m`;
      return `${main} (${totalHours}h)`;
    }
    case "damage":
      return `${(n / 10).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} HP`;
    case "count":
    default:
      return n.toLocaleString();
  }
}
