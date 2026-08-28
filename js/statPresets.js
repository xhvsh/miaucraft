export const PRESET_STATS = [
  { id: "distance_traveled", label: "Distance Traveled", aggregateCm: true, format: "distance" },
  { id: "jumps", label: "Jumps", keys: ["JUMP"], format: "count" },
  { id: "mob_kills", label: "Mob Kills", keys: ["MOB_KILLS_TOTAL", "MOB_KILLS"], format: "count" },
  { id: "time_played", label: "Time Played", keys: ["PLAY_ONE_MINUTE", "TIME_PLAYED"], format: "time" },
  { id: "player_deaths", label: "Deaths", keys: ["DEATHS"], format: "count" },
  { id: "shulker_boxes_opened", label: "Shulker Boxes Opened", keys: ["SHULKER_BOX_OPENED"], format: "count" },
  { id: "crafting_table_interactions", label: "Crafting Table Interactions", keys: ["CRAFTING_TABLE_INTERACTION"], format: "count" },
  { id: "blocks_mined", label: "Blocks Mined", keys: ["BLOCKS_MINED_TOTAL"], format: "count" },
];

export const CM_DISTANCE_LABELS = {
  WALK: "Walked",
  SPRINT: "Sprinted",
  CROUCH: "Crouched",
  FLY: "Flown",
  AVIATE: "Flown (Elytra)",
  CLIMB: "Climbed",
  FALL: "Fallen",
  SWIM: "Swum",
  DIVE: "Dove",
  BOAT: "Boated",
  HORSE: "Ridden (Horse)",
  MINECART: "Ridden (Minecart)",
  PIG: "Ridden (Pig)",
  STRIDER: "Ridden (Strider)",
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
  CHEST_OPENED: "Chests Opened",
  BLOCKS_MINED_TOTAL: "Blocks Mined",
  LEAVE_GAME: "Times Left Game",
  TALKED_TO_VILLAGER: "Talked to Villager",
  DROP_COUNT: "Items Dropped",
  MOB_KILLS_TOTAL: "Mob Kills",
  MOB_KILLS: "Mob Kills",
  TOTAL_WORLD_TIME: "Time in World",
  TRADED_WITH_VILLAGER: "Villager Trades",
  DAMAGE_DEALT: "Damage Dealt",
  DAMAGE_TAKEN: "Damage Taken",
  SNEAK_TIME: "Time Sneaking",
  TIME_SINCE_REST: "Time Since Rest",
  TIME_SINCE_DEATH: "Time Since Death",
  JUMP: "Jumps",
  DEATHS: "Deaths",
  PLAYER_KILLS: "Player Kills",
  FISH_CAUGHT: "Fish Caught",
  ANIMALS_BRED: "Animals Bred",
  BELL_RING: "Bells Rung",
  CAKE_SLICES_EATEN: "Cake Slices Eaten",
  ENCHANT_ITEM: "Items Enchanted",
  FLOWER_POTTED: "Flowers Potted",
  RAID_TRIGGER: "Raids Triggered",
  RAID_WIN: "Raids Won",
  RECORD_PLAYED: "Records Played",
  SLEEP_IN_BED: "Times Slept",
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
  return titleCaseStatKey(trimmedKey);
}

export function formatStatValue(format, value) {
  const n = Number(value) || 0;
  switch (format) {
    case "distance":
      return `${(n / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })} blocks`;
    case "time": {
      const totalSeconds = n / 20;
      const hours = Math.floor(totalSeconds / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
    }
    case "damage":
      return `${(n / 10).toLocaleString(undefined, { maximumFractionDigits: 1 })} HP`;
    case "count":
    default:
      return n.toLocaleString();
  }
}

const STAT_ICON_RULES = [
  [/^PLAY_ONE_MINUTE$|^TIME_PLAYED$|^TOTAL_WORLD_TIME$/, "fa-hourglass-half"],
  [/^DEATHS$|DIED|ENTITY_KILLED_BY/, "fa-skull"],
  [/PLAYER_KILLS|^KILL_ENTITY:PLAYER/, "fa-user-injured"],
  [/MOB_KILLS|^KILL_ENTITY/, "fa-crosshairs"],
  [/^JUMP$/, "fa-person-running"],
  [/FISH_CAUGHT/, "fa-fish"],
  [/ANIMALS_BRED/, "fa-paw"],
  [/TALKED_TO_VILLAGER|TRADED_WITH_VILLAGER/, "fa-comments"],
  [/SLEEP_IN_BED/, "fa-bed"],
  [/CHEST_OPENED/, "fa-box-open"],
  [/SHULKER_BOX_OPENED/, "fa-cube"],
  [/CRAFTING_TABLE_INTERACTION|^CRAFT_ITEM/, "fa-hammer"],
  [/^MINE_BLOCK|BLOCKS_MINED_TOTAL/, "fa-mountain"],
  [/^BREAK_ITEM/, "fa-heart-crack"],
  [/^USE_ITEM/, "fa-hand"],
  [/^DROP/, "fa-arrow-down"],
  [/^PICKUP/, "fa-hand-sparkles"],
  [/ENCHANT_ITEM/, "fa-wand-magic-sparkles"],
  [/FLOWER_POTTED/, "fa-seedling"],
  [/BELL_RING/, "fa-bell"],
  [/CAKE_SLICES_EATEN/, "fa-cake-candles"],
  [/RECORD_PLAYED/, "fa-record-vinyl"],
  [/RAID_TRIGGER|RAID_WIN/, "fa-shield-halved"],
  [/DAMAGE_DEALT/, "fa-burst"],
  [/DAMAGE_TAKEN/, "fa-heart-crack"],
  [/LEAVE_GAME/, "fa-door-open"],
  [/SNEAK_TIME|^CROUCH_ONE_CM$/, "fa-shoe-prints"],
  [/^SWIM_ONE_CM$|^DIVE_ONE_CM$|^WALK_UNDER_WATER_ONE_CM$/, "fa-water"],
  [/^BOAT_ONE_CM$/, "fa-ship"],
  [/^HORSE_ONE_CM$|^PIG_ONE_CM$|^STRIDER_ONE_CM$/, "fa-horse"],
  [/^MINECART_ONE_CM$/, "fa-train"],
  [/^AVIATE_ONE_CM$|^FLY_ONE_CM$/, "fa-plane"],
  [/^CLIMB_ONE_CM$/, "fa-mountain"],
  [/^FALL_ONE_CM$/, "fa-arrow-down-long"],
  [/_ONE_CM$/, "fa-route"],
];
const DEFAULT_STAT_ICON = "fa-chart-simple";

export function getStatIcon(key) {
  const trimmed = (key || "").trim().toUpperCase();
  for (const [pattern, icon] of STAT_ICON_RULES) {
    if (pattern.test(trimmed)) return icon;
  }
  return DEFAULT_STAT_ICON;
}
