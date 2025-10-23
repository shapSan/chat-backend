// hbDebug.ts — works in browser (Framer) and Node (backend). Default: ON.

export type Any = Record<string, any>;

// Detect environments
const hasWindow = typeof window !== "undefined";
const hasProcess = typeof process !== "undefined";

// DEFAULT ON. Turn off by: window.__HB_DEBUG__ = false (frontend) or HB_DEBUG=0 (backend)
function initialFlag() {
  if (hasProcess && process.env.HB_DEBUG === "0") return false;
  if (hasWindow && (window as any).__HB_DEBUG__ === false) return false;
  return true; // default ON
}

let _HB_DEBUG = initialFlag();

// Public toggle helpers
export const HBDebug = {
  isOn() { return _HB_DEBUG; },
  on()  { _HB_DEBUG = true;  },
  off() { _HB_DEBUG = false; },
  set(v: boolean) { _HB_DEBUG = !!v; }
};

export const HB_KEYS = [
  "main_cast",
  "shoot_location__city_",
  "audience_segment",
  "distributor",
  "synopsis",
  "genre_production",
  "productionStartDate",
  "releaseDate",
  "partnership_name",
  "title",
];

function pick(vals: Any, keys: string[]) {
  const src = vals ?? {};
  const out: Any = {};
  for (const k of keys) out[k] = Object.prototype.hasOwnProperty.call(src, k) ? src[k] : undefined;
  return out;
}

/**
 * Log one stage in the pipeline. Prints the same keys from top-level and .properties
 * so you can see where values flip to null/undefined.
 */
export function logStage(stage: string, obj: Any, keys: string[], extra: Any = {}) {
  if (!_HB_DEBUG || !obj) return;

  const id =
    obj.id ??
    obj.hs_object_id ??
    obj?.properties?.hs_object_id ??
    obj?.properties?.id ??
    "";

  const flat = pick(obj, keys);
  const props = pick(obj.properties ?? {}, keys);

  const parts = keys.map((k) => {
    const p = props[k];
    const t = flat[k];
    const pv = p === undefined ? "U" : p === null ? "N" : JSON.stringify(p);
    const tv = t === undefined ? "U" : t === null ? "N" : JSON.stringify(t);
    return `${k}:props=${pv}|top=${tv}`;
  }).join(" ");

  // eslint-disable-next-line no-console
  console.log(`[HB][${stage}] id=${id} ${parts}`, extra);
}
