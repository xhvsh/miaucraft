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
