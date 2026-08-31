/**
 * User preferences: persistent cross-session settings controlled via
 * src/preferences/preferences.ts's drawer. Modeled on persistence.ts's
 * versioned-schema + structural-validation + try/catch idiom.
 */

export interface UserPreferences {
  version: 1;
  autoEliminate: boolean;
}

const STORAGE_KEY = "colordoku:preferences";
const CURRENT_VERSION = 1;
const DEFAULTS: Omit<UserPreferences, "version"> = { autoEliminate: false };

export function loadPreferences(): UserPreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return { version: CURRENT_VERSION, ...DEFAULTS };
    const parsed: unknown = JSON.parse(raw);
    if (isUserPreferences(parsed)) return parsed;
    return { version: CURRENT_VERSION, ...DEFAULTS };
  } catch {
    return { version: CURRENT_VERSION, ...DEFAULTS };
  }
}

export function savePreferences(prefs: Omit<UserPreferences, "version">): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...prefs, version: CURRENT_VERSION }),
    );
  } catch {
    // Nice-to-have, never worth crashing over — same reasoning as saveGame().
  }
}

function isUserPreferences(value: unknown): value is UserPreferences {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Partial<UserPreferences>;
  if (v.version !== CURRENT_VERSION) return false;
  if (typeof v.autoEliminate !== "boolean") return false;
  return true;
}
