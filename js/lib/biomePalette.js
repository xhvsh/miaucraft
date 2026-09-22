// Biome -> colour map for the map page. Keys are the vanilla biome ids and may
// arrive either bare ("plains") or namespaced ("minecraft:plains"); both are
// normalized by biomeColor()/biomeName().
const BIOME_COLORS = Object.freeze({
  // oceans & rivers
  ocean: "#2b3a8f",
  deep_ocean: "#12205e",
  cold_ocean: "#1d2f86",
  deep_cold_ocean: "#0e1a50",
  frozen_ocean: "#33408f",
  deep_frozen_ocean: "#0e1a44",
  lukewarm_ocean: "#2f4bb5",
  deep_lukewarm_ocean: "#172a6e",
  warm_ocean: "#2f7fd1",
  river: "#1b4fb0",
  frozen_river: "#5683c9",
  // beaches & shores
  beach: "#e8dfae",
  snowy_beach: "#e6ecf5",
  stony_shore: "#9aa29a",
  swamp: "#3c7a5e",
  mangrove_swamp: "#2c5f4a",
  mushroom_fields: "#b06bb8",
  // plains & grasslands
  plains: "#8fbf5a",
  sunflower_plains: "#b8d98a",
  snowy_plains: "#e9f2f2",
  ice_spikes: "#bfd9e8",
  meadow: "#9fc077",
  cherry_grove: "#d99bb0",
  grove: "#8aa873",
  // forests
  forest: "#3d8f3d",
  flower_forest: "#5fa84f",
  birch_forest: "#5a8c6a",
  old_growth_birch_forest: "#2f7a4d",
  dark_forest: "#2c3f2c",
  old_growth_pine_taiga: "#58664f",
  old_growth_spruce_taiga: "#7a8a70",
  taiga: "#4a6655",
  snowy_taiga: "#5a6d68",
  windy_taiga: "#4a6655",
  // hills & mountains
  windswept_hills: "#69866e",
  windswept_forest: "#5c7a62",
  windswept_gravelly_hills: "#4a6254",
  stony_peaks: "#8a928c",
  jagged_peaks: "#8f9690",
  frozen_peaks: "#c4d2e6",
  snowy_slopes: "#cfe0ec",
  windswept_savanna: "#c0d17c",
  // savanna & badlands
  savanna: "#c2b35f",
  savanna_plateau: "#a99d5f",
  badlands: "#d2652e",
  eroded_badlands: "#d98a4e",
  wooded_badlands: "#a37f4a",
  // jungle
  jungle: "#4c7a24",
  sparse_jungle: "#3c6a42",
  bamboo_jungle: "#5f8f3f",
  // desert
  desert: "#e5c677",
  // caves
  dripstone_caves: "#8f4a3a",
  lush_caves: "#3fae8a",
  deep_dark: "#1c2430",
  // nether
  nether_wastes: "#a04b2a",
  soul_sand_valley: "#5b5347",
  crimson_forest: "#7a1f30",
  warped_forest: "#2f7a66",
  basalt_deltas: "#5a5f6e",
  // end
  the_end: "#2e2b3d",
  small_end_islands: "#5a5480",
  end_midlands: "#6a6491",
  end_highlands: "#7a74a2",
  end_barrens: "#4a4466",
  // misc
  the_void: "#000000",
});

const FALLBACK_COLORS = Object.freeze([
  "#8a7fb5", "#7fae8a", "#c0956c", "#8fb0c0", "#c0a0b0",
  "#9a8a5f", "#6f9aa8", "#b58a6f", "#7a90c0", "#9fb07a",
]);

export function biomeColor(key) {
  const bare = String(key ?? "").replace(/^minecraft:/, "");
  if (bare in BIOME_COLORS) return BIOME_COLORS[bare];
  let hash = 0;
  for (let i = 0; i < bare.length; i++) {
    hash = (hash * 31 + bare.charCodeAt(i)) >>> 0;
  }
  return FALLBACK_COLORS[hash % FALLBACK_COLORS.length];
}

export function biomeName(key) {
  const bare = String(key ?? "").replace(/^minecraft:/, "");
  return bare.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function biomeKey(key) {
  return String(key ?? "").replace(/^minecraft:/, "");
}