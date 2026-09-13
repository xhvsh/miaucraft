// Local (per-browser) display preferences. Extracted from the old app.js so
// map.js, profile.js and the waypoint form can all format coordinates the
// same way without importing from each other.

const SETTINGS_STORAGE_KEY = "miaucraft-settings";

const DEFAULT_SETTINGS = {
  hideFilteredWaypoints: true,
  copyFormat: "labeled",
  showDimensionConversion: false,
};

const COORD_COPY_FORMATS = {
  labeled: (x, y, z) => `x ${x}${y !== null ? `, y ${y}` : ""}, z ${z}`,
  comma: (x, y, z) => `${x}${y !== null ? `, ${y}` : ""}, ${z}`,
  space: (x, y, z) => `${x}${y !== null ? ` ${y}` : ""} ${z}`,
  slash: (x, y, z) => `${x}${y !== null ? ` / ${y}` : ""} / ${z}`,
};

function load() {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export const settings = load();

export function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {}
}

export function formatCoordsForCopy(x, y, z) {
  const formatter = COORD_COPY_FORMATS[settings.copyFormat] || COORD_COPY_FORMATS.labeled;
  return formatter(x, y !== null && y !== undefined ? y : null, z);
}

// readable display form (used on waypoint cards / tooltips / logs), follows the
// user's selected coordinate copy format
export function formatCoordsForDisplay(x, y, z) {
  return formatCoordsForCopy(x, y, z);
}
