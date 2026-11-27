// The administrator sets reading levels in a patient's care plan, from the numbers the doctor gave. Two levels for each reading:
//   amber = outside the range (tell the supervisor)      stored as <reading>_min / <reading>_max
//   red   = urgent (call now)                            stored as <reading>_red_min / <reading>_red_max
// plus a weight-gain rule and, for every reading, how often it should be taken. Nothing is flagged unless a number has been
// entered: Strovia never invents medical limits. The "commonly published" guides below are shown beside the boxes only as a
// reference for the person entering the doctor's numbers.
export const RANGE_FIELDS = [
  { key: "systolic", label: "Blood pressure, top number", unit: "mmHg" },
  { key: "diastolic", label: "Blood pressure, bottom number", unit: "mmHg" },
  { key: "pulse", label: "Pulse", unit: "beats a minute" },
  { key: "glucose", label: "Blood sugar", unit: "mg/dL" },
  { key: "temperature", label: "Temperature", unit: "°F" },
  { key: "oxygen_saturation", label: "Oxygen saturation", unit: "%" },
  { key: "pain_score", label: "Pain score", unit: "out of 10" },
]

// How the screen groups them: one card per reading, with its "how often".
export const READING_GROUPS = [
  { key: "bp", title: "Blood pressure", every: "bp_every", fields: ["systolic", "diastolic"],
    guide: "Commonly published: 130/80 or higher is high; above 180 on top or above 120 on the bottom is urgent. Confirm with the doctor." },
  { key: "pulse", title: "Pulse", every: "pulse_every", fields: ["pulse"],
    guide: "Commonly published: a resting pulse below 50 or above 100 is a concern; below 40 or above 130, or with dizziness, fainting or chest pain, is urgent." },
  { key: "glucose", title: "Blood sugar", every: "glucose_every", fields: ["glucose"],
    guide: "Commonly published: below 70 mg/dL is low and below 54 is seriously low; above about 250 is high, and above 300 with symptoms needs a call." },
  { key: "temperature", title: "Temperature", every: "temperature_every", fields: ["temperature"],
    guide: "Commonly published: 100.4°F (38°C) or higher is a fever; 103°F or higher, or a fever with confusion or a stiff neck, is urgent; below 95°F is dangerously low." },
  { key: "oxygen_saturation", title: "Oxygen saturation", every: "oxygen_saturation_every", fields: ["oxygen_saturation"],
    guide: "Commonly published: below 94% is a concern; 90% or below is urgent. Some lung conditions have a lower target, so ask the doctor." },
  { key: "pain_score", title: "Pain score", every: "pain_score_every", fields: ["pain_score"],
    guide: "Commonly published: 7 or more out of 10 is severe; a sudden severe headache can be a stroke warning sign." },
]
export const WEIGHT_GROUP = {
  every: "weight_every", gain1: "weight_gain_1d", gain7: "weight_gain_7d",
  guide: "Commonly published: a gain of 2 to 3 lb in a day, or 5 lb in a week, is a warning sign for heart failure.",
}

// "How often", in hours.
export const EVERY_OPTIONS = [["", "Not required"], ["12", "Twice a day"], ["24", "Every day"], ["48", "Every 2 days"], ["168", "Every week"]]
export const EVERY_KEYS = [...READING_GROUPS.map((g) => g.every), WEIGHT_GROUP.every]
export const everyWords = (hours) => ({ 12: "twice a day", 24: "every day", 48: "every 2 days", 168: "every week" }[Number(hours)] || `every ${hours} hours`)
export const READING_NAME = { bp: "Blood pressure", pulse: "Pulse", glucose: "Blood sugar", temperature: "Temperature", oxygen_saturation: "Oxygen level", pain_score: "Pain score", weight: "Weight" }

// Every key the care plan editor edits (used to build its form).
export const ALL_RANGE_KEYS = [
  ...RANGE_FIELDS.flatMap((f) => [`${f.key}_min`, `${f.key}_max`, `${f.key}_red_min`, `${f.key}_red_max`]),
  WEIGHT_GROUP.gain1, WEIGHT_GROUP.gain7, ...EVERY_KEYS,
]

const num = (v) => (v === "" || v === null || v === undefined || Number.isNaN(Number(v)) ? null : Number(v))

// Judge a reading against the care team's levels. `recent` (earlier readings, newest first) is only needed for the weight rule.
// Returns { level: "red" | "amber" | null, red: [...], amber: [...] } with plain-language sentences.
export function assessReading(values, ranges = {}, recent = []) {
  const red = []
  const amber = []
  for (const f of RANGE_FIELDS) {
    const v = num(values[f.key])
    if (v === null) continue
    const redMax = num(ranges[`${f.key}_red_max`])
    const redMin = num(ranges[`${f.key}_red_min`])
    const max = num(ranges[`${f.key}_max`])
    const min = num(ranges[`${f.key}_min`])
    const name = f.label.toLowerCase()
    if (redMax !== null && v > redMax) red.push(`${name} ${v} is above the urgent limit set by the care team (${redMax} ${f.unit})`)
    else if (redMin !== null && v < redMin) red.push(`${name} ${v} is below the urgent limit set by the care team (${redMin} ${f.unit})`)
    else if (max !== null && v > max) amber.push(`${name} ${v} is above the range set by the care team (up to ${max} ${f.unit})`)
    else if (min !== null && v < min) amber.push(`${name} ${v} is below the range set by the care team (at least ${min} ${f.unit})`)
  }
  const w = num(values.weight_lb ?? values.weight)
  const g1 = num(ranges[WEIGHT_GROUP.gain1])
  const g7 = num(ranges[WEIGHT_GROUP.gain7])
  if (w !== null && (g1 !== null || g7 !== null)) {
    const now = values.taken_at ? new Date(values.taken_at).getTime() : Date.now()
    const lowest = (ms) => recent.filter((r) => r.weight_lb != null && new Date(r.taken_at).getTime() > now - ms && new Date(r.taken_at).getTime() < now).reduce((m, r) => (m === null || Number(r.weight_lb) < m ? Number(r.weight_lb) : m), null)
    const low1 = lowest(24 * 3600000)
    const low7 = lowest(7 * 24 * 3600000)
    if (g1 !== null && low1 !== null && w - low1 > g1) amber.push(`weight ${w} lb is up ${Math.round((w - low1) * 10) / 10} lb in a day (the care team's limit is ${g1} lb)`)
    else if (g7 !== null && low7 !== null && w - low7 > g7) amber.push(`weight ${w} lb is up ${Math.round((w - low7) * 10) / 10} lb in a week (the care team's limit is ${g7} lb)`)
  }
  return { level: red.length ? "red" : amber.length ? "amber" : null, red, amber }
}

// The older single-list check: every problem, urgent or not.
export function checkReading(values, ranges = {}, recent = []) {
  const a = assessReading(values, ranges, recent)
  return [...a.red, ...a.amber]
}

export const hasRanges = (ranges = {}) => ALL_RANGE_KEYS.filter((k) => !k.endsWith("_every")).some((k) => num(ranges[k]) !== null)

// Keep only sensible values when the administrator saves. `previous` (the ranges before this save) decides whether the
// "how often" clock restarts: it restarts when a frequency is added or changed, so a reading is not called overdue the moment
// the plan is saved.
export function cleanRanges(input = {}, previous = {}) {
  const out = {}
  for (const f of RANGE_FIELDS) {
    for (const edge of ["min", "max", "red_min", "red_max"]) {
      const v = num(input[`${f.key}_${edge}`])
      if (v !== null && v > 0 && v < 2000) out[`${f.key}_${edge}`] = v
    }
  }
  for (const k of [WEIGHT_GROUP.gain1, WEIGHT_GROUP.gain7]) {
    const v = num(input[k])
    if (v !== null && v > 0 && v < 100) out[k] = v
  }
  for (const k of EVERY_KEYS) {
    const v = num(input[k])
    if ([12, 24, 48, 168].includes(v)) out[k] = v
  }
  const source = String(input.source ?? "").trim().slice(0, 120)
  if (source) out.source = source
  const everyNow = EVERY_KEYS.filter((k) => out[k] != null)
  if (everyNow.length) {
    const changed = EVERY_KEYS.some((k) => (out[k] ?? null) !== (num(previous?.[k]) ?? null))
    out.set_at = changed || !previous?.set_at ? new Date().toISOString() : previous.set_at
  }
  return out
}
