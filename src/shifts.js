// Shifts are wall-clock times ("Monday 8:00 am to 8:00 pm") shown in the viewer's own time.
// start_time / end_time come back from the database as "HH:MM:SS". An end time that is not later than the
// start time means the shift finishes the next day (a night shift).

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
export const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0] // Monday first

const pad = (n) => String(n).padStart(2, "0")
export const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

function minutesOf(time) {
  const [h, m] = String(time).split(":")
  return Number(h) * 60 + Number(m)
}

// How many days after the start day a shift ends: 0 = the same day, 1 = the next day, 2 = a live-in shift ending two days
// later, and so on. Shifts saved before multi-day shifts existed have no value; they keep the old rule, where an end time
// that is not later than the start time means the next day.
export const endDayOffset = (s) =>
  (s.ends_after_days !== null && s.ends_after_days !== undefined ? s.ends_after_days : minutesOf(s.end_time) <= minutesOf(s.start_time) ? 1 : 0)

export const isOvernight = (s) => endDayOffset(s) >= 1

export function durationMinutes(s) {
  return endDayOffset(s) * 1440 + minutesOf(s.end_time) - minutesOf(s.start_time)
}

// "", "overnight", or "live-in" (runs over two or more nights): how a long shift is described next to its hours.
export const describeSpan = (s) => {
  const n = endDayOffset(s)
  return n === 0 ? "" : n === 1 ? "overnight" : "live-in"
}

export function fmtDuration(minutes) {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (!m) return `${h} ${h === 1 ? "hour" : "hours"}`
  return h ? `${h} h ${m} min` : `${m} min`
}

export function fmtClock(time) {
  const mins = minutesOf(time)
  return new Date(2000, 0, 1, Math.floor(mins / 60), mins % 60).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
}

// "8:00 AM to 8:00 PM". A shift that ends days later names both days instead of a "+2": "Mon 8:00 AM to Wed 8:00 AM".
export function fmtTimeRange(s) {
  const n = endDayOffset(s)
  if (n >= 2) {
    const first = s.weekday !== null && s.weekday !== undefined ? s.weekday : s.on_date ? new Date(s.on_date + "T00:00:00").getDay() : null
    if (first !== null) {
      const short = (d) => WEEKDAYS[((d % 7) + 7) % 7].slice(0, 3)
      return `${short(first)} ${fmtClock(s.start_time)} to ${short(first + n)} ${fmtClock(s.end_time)}`
    }
  }
  return `${fmtClock(s.start_time)} to ${fmtClock(s.end_time)}`
}

const fmtDay = (d) => d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })

export function dayLabel(date, now = new Date()) {
  const start = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const diff = Math.round((start(date) - start(now)) / 86400000)
  if (diff === 0) return "Today"
  if (diff === 1) return "Tomorrow"
  return fmtDay(date)
}

export function describeShift(s) {
  if (s.weekday !== null && s.weekday !== undefined) return `Every ${WEEKDAYS[s.weekday]}`
  return new Date(s.on_date + "T00:00:00").toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric", year: "numeric" })
}

export const isExpired = (s, now = new Date()) => {
  const today = isoDate(now)
  if (s.on_date) return s.on_date < today && !isOvernightStillRunning(s, now)
  return !!s.ends_on && s.ends_on < today && !isOvernightStillRunning(s, now)
}

function isOvernightStillRunning(s, now) {
  return occurrences([s], now, 0).some((o) => o.start <= now && now < o.end)
}

// Every stretch of time the shifts cover that has not finished yet and starts within `days` days of `from`.
export function occurrences(shifts, from = new Date(), days = 14) {
  const out = []
  // Start looking back far enough to catch a shift that began earlier and is still running: a night shift began
  // yesterday, and a live-in shift may have begun several days ago.
  const back = 1 + Math.max(0, ...shifts.map((s) => Math.floor((durationMinutes(s) - 1) / 1440)))
  const first = new Date(from.getFullYear(), from.getMonth(), from.getDate() - back)
  for (let i = 0; i <= days + back; i++) {
    const day = new Date(first.getFullYear(), first.getMonth(), first.getDate() + i)
    const iso = isoDate(day)
    for (const s of shifts) {
      const weekly = s.weekday !== null && s.weekday !== undefined
      const applies = weekly
        ? day.getDay() === s.weekday && iso >= s.starts_on && (!s.ends_on || iso <= s.ends_on)
        : s.on_date === iso
      if (!applies) continue
      const mins = minutesOf(s.start_time)
      const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(mins / 60), mins % 60)
      const end = new Date(start.getTime() + durationMinutes(s) * 60000)
      if (end > from && start < new Date(from.getTime() + days * 86400000)) out.push({ shift: s, start, end })
    }
  }
  return out.sort((a, b) => a.start - b.start)
}

export function shiftsOnNow(shifts, now = new Date()) {
  return occurrences(shifts, now, 1).filter((o) => o.start <= now && now < o.end)
}

// Is a caregiver close enough to a scheduled shift for this patient to start a fresh check-in? A patient this
// caregiver has no shifts recorded for at all is never blocked — shift tracking they haven't adopted should never
// stop them working. `graceMinutes` covers arriving a little early or finishing paperwork a little late. This
// mirrors the database's own rule (migration 039) — including the clocked-in bypass — so the button's enabled
// state correctly predicts whether the server will actually accept the check-in.
export function shiftWindowStatus(shifts, patientId, now = new Date(), graceMinutes = 30, attendance = [], myUserId = null) {
  const clockedIn = attendance.some((a) => a.caregiver_id === myUserId && !a.left_at && now - new Date(a.arrived_at) < 20 * 3600000)
  if (clockedIn) return { allowed: true, tracked: true, next: null }
  const mine = shifts.filter((s) => s.patient_id === patientId)
  if (mine.length === 0) return { allowed: true, tracked: false, next: null }
  const grace = graceMinutes * 60000
  const nearby = occurrences(mine, new Date(now.getTime() - 24 * 3600000), 2)
  // Checking out ends the shift: if this person already arrived and left during that shift, it no longer counts for them.
  // An arrival belongs to the shift it was recorded against (its planned start); one with no planned start, to the shift it happened in.
  const checkedOut = (o) => attendance.some((a) => a.caregiver_id === myUserId && (!a.patient_id || a.patient_id === patientId) && a.left_at && new Date(a.left_at) <= now
    && (a.planned_start
      ? Math.abs(new Date(a.planned_start) - o.start) < 120000
      : new Date(a.arrived_at) >= new Date(o.start.getTime() - 3600000) && new Date(a.arrived_at) < o.end))
  const on = nearby.some((o) => now >= new Date(o.start.getTime() - grace) && now < new Date(o.end.getTime() + grace) && !checkedOut(o))
  const next = on ? null : nearby.find((o) => o.start > now) || null
  return { allowed: on, tracked: true, next }
}

export const mondayOf = (date) => {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return d
}

// One patient's shifts over a week (starting on `weekStart`): for each day, how many minutes someone is on shift,
// and the stretches nobody is. A night shift counts towards both of the days it covers.
export function coverageForWeek(shifts, weekStart) {
  const before = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() - 1)
  const windows = occurrences(shifts, before, 9)
  const days = []
  for (let i = 0; i < 7; i++) {
    const day = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + i)
    const dayStart = day.getTime()
    const dayEnd = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1).getTime()
    const spans = windows
      .map((o) => [Math.max(o.start.getTime(), dayStart), Math.min(o.end.getTime(), dayEnd)])
      .filter(([a, b]) => b > a)
      .sort((x, y) => x[0] - y[0])
    const merged = []
    for (const [a, b] of spans) {
      const last = merged[merged.length - 1]
      if (last && a <= last[1]) last[1] = Math.max(last[1], b)
      else merged.push([a, b])
    }
    const covered = merged.reduce((sum, [a, b]) => sum + Math.round((b - a) / 60000), 0)
    const gaps = []
    let cursor = dayStart
    for (const [a, b] of merged) {
      if (a > cursor) gaps.push([cursor, a])
      cursor = b
    }
    if (cursor < dayEnd) gaps.push([cursor, dayEnd])
    days.push({ date: day, covered, gaps })
  }
  return days
}

export function weeklyMinutes(shifts) {
  return shifts.filter((s) => s.weekday !== null && s.weekday !== undefined).reduce((sum, s) => sum + durationMinutes(s), 0)
}

// "8 AM", "8:30 PM": a clock in plain words, without the ":00".
export function fmtClockPlain(time) {
  const mins = minutesOf(time)
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return `${h % 12 || 12}${m ? `:${pad(m)}` : ""} ${h >= 12 ? "PM" : "AM"}`
}

// "8a", "8:30p": a short clock for tight spaces such as the week grid.
export function fmtClockShort(time) {
  const mins = minutesOf(time)
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return `${h % 12 || 12}${m ? `:${pad(m)}` : ""}${h >= 12 ? "p" : "a"}`
}

// "Mon to Fri", "Mon, Wed, Fri", "Saturday", "Every day". Days use 0 = Sunday and are read Monday first.
export function describeDays(days) {
  const idx = [...new Set(days)].map((d) => DAY_ORDER.indexOf(d)).sort((a, b) => a - b)
  const short = (i) => WEEKDAYS[DAY_ORDER[i]].slice(0, 3)
  if (idx.length === 0) return ""
  if (idx.length === 7) return "Every day"
  if (idx.length === 1) return WEEKDAYS[DAY_ORDER[idx[0]]]
  const run = idx.every((v, i) => i === 0 || v === idx[i - 1] + 1)
  if (run && idx.length >= 3) return `${short(idx[0])} to ${short(idx[idx.length - 1])}`
  return idx.map(short).join(", ")
}

// The shift form saves one row per weekday, so "Monday to Friday, 8 to 8" is five rows in the database. This groups
// those rows back into one line for display: rows that match in everything but the weekday. Changing or removing still
// works on the individual rows (`rows`), so nothing is lost. One-off shifts are left as they are.
export function groupRecurring(shifts) {
  const groups = new Map()
  const oneOff = []
  for (const s of shifts) {
    if (s.weekday === null || s.weekday === undefined) { oneOff.push(s); continue }
    const key = [s.patient_id, s.caregiver_id, String(s.start_time).slice(0, 5), String(s.end_time).slice(0, 5), endDayOffset(s), s.starts_on, s.ends_on || "", s.notes || ""].join("|")
    if (!groups.has(key)) groups.set(key, { key, shift: s, rows: [], days: [] })
    const g = groups.get(key)
    g.rows.push(s)
    g.days.push(s.weekday)
  }
  const weekly = [...groups.values()].map((g) => ({
    ...g,
    days: DAY_ORDER.filter((d) => g.days.includes(d)),
    rows: [...g.rows].sort((a, b) => DAY_ORDER.indexOf(a.weekday) - DAY_ORDER.indexOf(b.weekday)),
  }))
  weekly.sort((a, b) => DAY_ORDER.indexOf(a.days[0]) - DAY_ORDER.indexOf(b.days[0]) || String(a.shift.start_time).localeCompare(String(b.shift.start_time)))
  return { weekly, oneOff }
}
