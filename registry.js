const REGISTRY_FILE = "/data/registry.txt"
const MAX_FILE_SIZE = 200000 // ~200KB hard cap
const WRITE_COOLDOWN = 50 // ms between writes

let LAST_WRITE = 0

/** @param {NS} ns **/
export function readRegistry(ns) {
  try {
    const raw = ns.read(REGISTRY_FILE)
    if (!raw) return {}
    return JSON.parse(raw)
  } catch (e) {
    ns.print(`[registry] READ ERROR: ${e}`)
    return {}
  }
}

/** @param {NS} ns **/
export function writeRegistry(ns, registry) {
  const now = Date.now()
  if (now - LAST_WRITE < WRITE_COOLDOWN) return
  LAST_WRITE = now

  try {
    const safe = sanitizeRegistry(registry)
    const json = JSON.stringify(safe, null, 2)

    if (json.length > MAX_FILE_SIZE) {
      ns.print("[registry] WARNING: registry too large, trimming...")
      const trimmed = hardTrimRegistry(safe)
      const trimmedJson = JSON.stringify(trimmed, null, 2)

      if (trimmedJson.length > MAX_FILE_SIZE) {
        ns.print("[registry] ERROR: still too large after trim, skipping write")
        return
      }

      ns.write(REGISTRY_FILE, trimmedJson, "w")
      return
    }

    const existing = ns.read(REGISTRY_FILE)
    if (existing === json) return // no change

    ns.write(REGISTRY_FILE, json, "w")
  } catch (e) {
    ns.print(`[registry] WRITE ERROR: ${e}`)
  }
}

/** MAIN SAFE UPDATE FUNCTION */
/** @param {NS} ns **/
export function updateRegistry(ns, path, valueOrFn) {
  const registry = readRegistry(ns)

  const keys = path.split(".")
  let cursor = registry

  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i]
    if (typeof cursor[k] !== "object" || cursor[k] === null) {
      cursor[k] = {}
    }
    cursor = cursor[k]
  }

  const leafKey = keys[keys.length - 1]
  const currentValue = cursor[leafKey]

  cursor[leafKey] =
    typeof valueOrFn === "function"
      ? valueOrFn(currentValue, registry)
      : valueOrFn

  writeRegistry(ns, registry)
  return registry
}

/** OPTIONAL SAFE READ */
/** @param {NS} ns **/
export function getRegistryValue(ns, path) {
  const registry = readRegistry(ns)
  const keys = path.split(".")

  let cursor = registry
  for (const k of keys) {
    if (cursor == null) return undefined
    cursor = cursor[k]
  }

  return cursor
}

/* ── SAFETY HELPERS ───────────────────────── */

/** Remove known heavy fields */
function sanitizeRegistry(registry) {
  const copy = { ...registry }

  // Example: prevent huge darknet host dumps
  if (copy.darknet?.hosts) {
    copy.darknet = { ...copy.darknet, hosts: {} }
  }

  return copy
}

/** Aggressively trim large data structures */
function hardTrimRegistry(registry) {
  const trimmed = {}

  for (const [key, value] of Object.entries(registry)) {
    trimmed[key] = trimValue(value)
  }

  return trimmed
}

function trimValue(value) {
  if (value == null) return value

  // Arrays → keep last 10
  if (Array.isArray(value)) {
    return value.slice(-10)
  }

  // Objects → trim nested arrays
  if (typeof value === "object") {
    const obj = {}

    for (const [k, v] of Object.entries(value)) {
      if (Array.isArray(v)) {
        obj[k] = v.slice(-10)
      } else if (typeof v === "object" && v !== null) {
        obj[k] = trimValue(v)
      } else {
        obj[k] = v
      }
    }

    return obj
  }

  return value
}