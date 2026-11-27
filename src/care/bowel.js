// Bowel movement log helpers. Strovia never decides how many days is "too long": the administrator sets it per patient in the
// care plan (plan.bowelDays), and nothing is flagged when it is not set.
export const BOWEL_KINDS = [
  ["hard", "Hard", "Bristol 1-2"],
  ["normal", "Normal", "Bristol 3-4"],
  ["loose", "Loose", "Bristol 5-6"],
  ["watery", "Watery", "Bristol 7"],
]
export const BOWEL_DAY_OPTIONS = [2, 3, 4, 5, 6, 7]
export const kindLabel = (k) => BOWEL_KINDS.find(([v]) => v === k)?.[1] || k

const startOfDay = (d) => { const x = new Date(d); return new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime() }

// Whole calendar days between the last bowel movement and today (0 = today, 1 = yesterday).
export const daysSince = (when, now = new Date()) => Math.round((startOfDay(now) - startOfDay(when)) / 86400000)

export function dayWord(when, now = new Date()) {
  const n = daysSince(when, now)
  if (n === 0) return "today"
  if (n === 1) return "yesterday"
  return new Date(when).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })
}

// What the card and the handover say: the latest entry, an amber state when the care plan's number of days has gone by with
// nothing recorded, and a red state when blood or black stool was recorded in the last 24 hours.
export function bowelStatus(log, plan, now = new Date()) {
  const rows = [...(log || [])].sort((a, b) => new Date(b.happened_at) - new Date(a.happened_at))
  const last = rows[0] || null
  const limit = Number(plan?.bowelDays) > 0 ? Number(plan.bowelDays) : null
  const days = last ? daysSince(last.happened_at, now) : null
  const amber = !!(limit && last && days >= limit)
  const blood = rows.find((r) => r.blood && now - new Date(r.happened_at) < 24 * 3600000) || null
  return { rows, last, days, limit, amber, blood }
}

