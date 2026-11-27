// The medication schedule's logic, kept separate from the screen so the same rules run on the Today page's
// Medications tab and on the administrator's Home overview.
//
// A schedule entry looks like { name, dose, times: ["08:00","20:00"], instructions, asNeeded }. Times are wall-clock,
// on whatever day each caregiver's own device says it is — the same convention the daily task list already uses.

export const DUE_WINDOW_MIN = 30 // "due now" starts this many minutes before the scheduled time and lasts this long after

const pad = (n) => String(n).padStart(2, "0")
export const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

function atTime(date, hhmm) {
  const [h, m] = String(hhmm).split(":").map(Number)
  const d = new Date(date)
  d.setHours(h || 0, m || 0, 0, 0)
  return d
}

// One row per scheduled dose due on `date`: which medicine, what dose, when it's due, and (if someone already
// logged it) who gave or refused it. As-needed medicines never appear here; they're logged freely instead.
export function scheduledSlotsFor(schedule, date, log) {
  const key = dayKey(date)
  const out = []
  for (const med of schedule || []) {
    if (med.asNeeded || !med.name) continue
    for (const time of med.times || []) {
      const due = atTime(date, time)
      const entry = (log || []).find((l) => l.med_name === med.name && l.scheduled_for && dayKey(new Date(l.scheduled_for)) === key && new Date(l.scheduled_for).toTimeString().slice(0, 5) === time)
      out.push({ med, time, due, entry })
    }
  }
  return out.sort((a, b) => a.due - b.due)
}

// "given" / "refused" once logged; otherwise "upcoming", "due" (within the window either side of the due time), or
// "overdue".
export function slotStatus(slot, now) {
  if (slot.entry) return slot.entry.status
  const diffMin = (now - slot.due) / 60000
  if (diffMin < -DUE_WINDOW_MIN) return "upcoming"
  if (diffMin > DUE_WINDOW_MIN) return "overdue"
  return "due"
}

// Today's scheduled doses that are due by now (i.e. not still upcoming), and how many of those were given —
// the "3 of 4 doses given today" line shown on both the tab and the Home overview.
export function todaysProgress(schedule, log, now = new Date()) {
  const slots = scheduledSlotsFor(schedule, now, log).filter((s) => slotStatus(s, now) !== "upcoming")
  return { total: slots.length, given: slots.filter((s) => s.entry?.status === "given").length }
}

// A simple week-back count of how many scheduled doses were given, out of how many came due — no medical judgment,
// just what was logged.
export function weeklyAdherence(schedule, log, now = new Date()) {
  let total = 0
  let given = 0
  for (let i = 0; i < 7; i++) {
    const day = new Date(now)
    day.setDate(day.getDate() - i)
    const { total: t, given: g } = todaysProgress(schedule, log, i === 0 ? now : new Date(day.setHours(23, 59, 0, 0)))
    total += t
    given += g
  }
  return { total, given }
}

// Turns what an administrator types — "8:00, 20:00" or "8 AM, 8 PM" — into normalized 24-hour "HH:MM" times, so a
// dose logged later can be matched back to the schedule exactly. Anything that isn't a recognizable time is dropped.
export function parseTimesList(text) {
  const out = []
  for (const raw of String(text || "").split(/[,\n]/)) {
    const t = raw.trim()
    if (!t) continue
    const ampm = t.match(/^(\d{1,2})(?::([0-5]\d))?\s*(am|pm)$/i)
    if (ampm) {
      let h = Number(ampm[1]) % 12
      if (/pm/i.test(ampm[3])) h += 12
      out.push(`${pad(h)}:${ampm[2] || "00"}`)
      continue
    }
    const plain = t.match(/^([01]?\d|2[0-3]):([0-5]\d)$/)
    if (plain) out.push(`${pad(Number(plain[1]))}:${plain[2]}`)
  }
  return [...new Set(out)].sort()
}

// The reverse, for showing a saved schedule back in plain language: ["08:00","20:00"] -> "8:00 AM, 8:00 PM".
export const timesToText = (times) => (times || []).map((t) => {
  const [h, m] = t.split(":").map(Number)
  const period = h < 12 ? "AM" : "PM"
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${pad(m)} ${period}`
}).join(", ")
