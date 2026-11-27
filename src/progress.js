// How the recovery progress screens are worked out. Pure functions, kept apart from the screens so they can be tested.
//
// Two scores, on purpose:
//  * the Recovery Score is about the patient's symptoms. It is built from every check-in anyone on the team saved for a
//    day (a caregiver, a family proxy or the administrator), not only from whoever saved last;
//  * "Care plan followed" is about whether the plan was carried out: medicines, tasks, exercises and visits.
import { scheduledSlotsFor } from "./care/medication.js"
import { summarize, lastDays } from "./care/exercises.js"
import { occurrences } from "./shifts.js"

const pad = (n) => String(n).padStart(2, "0")
export const dayKeyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)

// Symptoms count most; how the patient is feeling and the pain score add to it.
export const WEIGHTS = { symptoms: 0.7, feeling: 0.15, pain: 0.15 }

// One person's check-in as a 0 to 100 score (100 = no symptoms). `keys` are the symptom keys, each rated 0 (none) to 3 (severe).
export function symptomScore(symptoms, keys) {
  const vals = keys.map((k) => Number(symptoms?.[k] ?? 0))
  const avg = vals.reduce((a, b) => a + b, 0) / (vals.length || 1)
  return Math.round(100 - (avg / 3) * 100)
}
// "How is the patient feeling": 1 (rough) to 5 (great), as a 0 to 100 score.
const feelingScore = (f) => (f >= 1 && f <= 5 ? ((f - 1) / 4) * 100 : null)
// A pain score of 0 (none) to 10 (worst), as a 0 to 100 score.
const painScore = (p) => (p >= 0 && p <= 10 ? 100 - p * 10 : null)

// A person's own score: symptoms plus, if they gave one, how the patient is feeling.
function personScore(version, keys) {
  const s = symptomScore(version.symptoms, keys)
  const f = feelingScore(version.feeling)
  if (f === null) return s
  return Math.round((WEIGHTS.symptoms * s + WEIGHTS.feeling * f) / (WEIGHTS.symptoms + WEIGHTS.feeling))
}

// Every day that has at least one check-in, oldest first. `versions` are all the saved check-in versions (checkin_versions),
// `vitals` the readings (for the pain score). For each day only each person's LATEST save counts, so someone correcting
// their own check-in does not count twice. The day's score is the average of those people, then the pain score is added.
export function combineDays(versions, vitals, keys) {
  const byDay = new Map()
  for (const v of versions || []) {
    if (!byDay.has(v.entry_date)) byDay.set(v.entry_date, new Map())
    const people = byDay.get(v.entry_date)
    const key = v.recorded_by || "unknown"
    const cur = people.get(key)
    if (!cur || new Date(v.saved_at) > new Date(cur.saved_at)) people.set(key, v)
  }
  const painByDay = new Map()
  for (const r of vitals || []) {
    if (r.pain_score === null || r.pain_score === undefined) continue
    const k = dayKeyOf(new Date(r.taken_at))
    if (!painByDay.has(k)) painByDay.set(k, [])
    painByDay.get(k).push(Number(r.pain_score))
  }
  const days = []
  for (const [date, people] of byDay) {
    const list = [...people.values()].sort((a, b) => new Date(a.saved_at) - new Date(b.saved_at)).map((v) => ({
      id: v.recorded_by, at: v.saved_at, symptoms: v.symptoms, feeling: v.feeling, score: personScore(v, keys),
    }))
    const mean = list.reduce((a, p) => a + p.score, 0) / list.length
    const pains = painByDay.get(date)
    const pain = pains ? pains.reduce((a, b) => a + b, 0) / pains.length : null
    const p = pain === null ? null : painScore(pain)
    const score = p === null ? Math.round(mean) : Math.round((1 - WEIGHTS.pain) * mean + WEIGHTS.pain * p)
    days.push({ date, score, people: list, pain })
  }
  return days.sort((a, b) => a.date.localeCompare(b.date))
}

// Symptoms rated differently by the people who checked in that day, worst first: [{ key, groups: [{ level, ids }] }].
export function disagreements(day, keys) {
  const out = []
  if (!day || day.people.length < 2) return out
  for (const key of keys) {
    const levels = day.people.map((p) => Number(p.symptoms?.[key] ?? 0))
    if (Math.max(...levels) === Math.min(...levels)) continue
    const groups = []
    for (const level of [...new Set(levels)].sort((a, b) => b - a)) {
      groups.push({ level, ids: day.people.filter((p) => Number(p.symptoms?.[key] ?? 0) === level).map((p) => p.id) })
    }
    out.push({ key, max: Math.max(...levels), groups })
  }
  return out.sort((a, b) => b.max - a.max)
}

// For the alert that offers the emergency buttons: a symptom counts at the worst rating anyone gave today.
export function worstSymptoms(day, keys) {
  if (!day) return null
  const out = {}
  for (const k of keys) out[k] = Math.max(...day.people.map((p) => Number(p.symptoms?.[k] ?? 0)))
  return out
}

// The average score over the last 7 days against the 7 days before. null unless both periods have a check-in.
export function periodChange(days, now = new Date()) {
  const key = (n) => dayKeyOf(addDays(now, -n))
  const inRange = (from, to) => days.filter((d) => d.date >= key(from) && d.date <= key(to))
  const recent = inRange(6, 0)
  const before = inRange(13, 7)
  if (!recent.length || !before.length) return null
  const avg = (list) => list.reduce((a, d) => a + d.score, 0) / list.length
  const delta = Math.round(avg(recent)) - Math.round(avg(before))
  return { delta, recent: Math.round(avg(recent)), before: Math.round(avg(before)) }
}
export const changeWords = (delta, unit = "points", span = "the 7 days before") =>
  delta === 0 ? `No change from ${span}` : `${delta > 0 ? "Up" : "Down"} ${Math.abs(delta)} ${Math.abs(delta) === 1 ? unit.replace(/s$/, "") : unit} from ${span}`
// The short form for a tag: "Up 13 points" / "Down 1 point" / "No change".
export const changeShort = (delta, unit = "points") =>
  delta === 0 ? "No change" : `${delta > 0 ? "Up" : "Down"} ${Math.abs(delta)} ${Math.abs(delta) === 1 ? unit.replace(/s$/, "") : unit}`

/* ---------------- care plan followed ---------------- */

// Medicines, tasks, exercises and visits over two periods of seven finished days: the last seven days (not counting today,
// which is not over yet) and the seven before. `data` holds what was recorded: medLog, taskLog, exerciseLog, visitLog.
export function carePlanFollowed({ plan, exercises, visits, data, now = new Date() }) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const period = (endOffset) => Array.from({ length: 7 }, (_, i) => addDays(today, -(endOffset + 6 - i))) // oldest first
  const thisWeek = period(1)
  const lastWeek = period(8)

  const measure = (days) => {
    const first = days[0]
    const last = addDays(days[6], 1) // end of the last day
    const areas = {}
    const missed = { meds: [], exerciseSkips: [], visitsMissed: [], visitsUnconfirmed: 0 }

    // Medicines: every scheduled dose whose time has passed, given or not.
    let medTotal = 0
    let medDone = 0
    for (const day of days) {
      for (const slot of scheduledSlotsFor(plan.medSchedule, day, data.medLog)) {
        if (slot.due > now) continue
        medTotal++
        if (slot.entry?.status === "given") medDone++
        else missed.meds.push({ name: slot.med.name, due: slot.due, refused: slot.entry?.status === "refused" })
      }
    }
    areas.medicines = { label: "Medications", done: medDone, total: medTotal, unit: "given" }

    // Tasks: the daily task list, each task once a day.
    const tasks = plan.tasks || []
    let taskTotal = 0
    let taskDone = 0
    for (const day of days) {
      const key = dayKeyOf(day)
      const ticked = new Set((data.taskLog || []).filter((t) => t.task_date === key).map((t) => t.task))
      taskTotal += tasks.length
      taskDone += tasks.filter((t) => ticked.has(t)).length
    }
    areas.tasks = { label: "Tasks", done: taskDone, total: taskTotal, unit: "done" }

    // Meals: three a day, each counted when someone recorded it (how much was eaten does not count for or against the plan).
    let mealTotal = 0
    let mealDone = 0
    for (const day of days) {
      const key = dayKeyOf(day)
      mealTotal += 3
      mealDone += new Set((data.mealLog || []).filter((m) => m.log_date === key).map((m) => m.meal)).size
    }
    areas.meals = { label: "Meals", done: mealDone, total: mealTotal, unit: "recorded" }

    // Exercises: the therapist's sheet, counted from the day each exercise was added.
    const ex = summarize(exercises, data.exerciseLog, days, now)
    areas.exercises = { label: "Exercises", done: ex.done, total: ex.due, unit: "done" }
    const skipped = ex.partly + ex.notDone
    if (skipped > 0) missed.exerciseSkips = Object.entries(ex.reasons).sort((a, b) => b[1] - a[1]).map(([reason, count]) => ({ reason, count }))
    missed.exerciseSkippedCount = skipped
    missed.exerciseNotRecorded = ex.notRecorded

    // Visits: those with a result recorded; ones nobody confirmed are listed but not counted against the plan.
    let visitTotal = 0
    let visitDone = 0
    const visitList = (visits || [])
    for (const o of occurrences(visitList, new Date(first.getTime() - 1), 8).filter((o) => o.end <= now && o.start < last && o.start >= first)) {
      const log = (data.visitLog || []).find((l) => l.visit_id === o.shift.id && l.occurred_on === dayKeyOf(o.start))
      if (!log) { missed.visitsUnconfirmed++; continue }
      visitTotal++
      if (log.status === "happened") visitDone++
      else missed.visitsMissed.push({ visit: o.shift, when: o.start, reason: log.reason })
    }
    areas.visits = { label: "Visits", done: visitDone, total: visitTotal, unit: "happened" }

    const done = Object.values(areas).reduce((a, x) => a + x.done, 0)
    const total = Object.values(areas).reduce((a, x) => a + x.total, 0)
    return { areas, missed, done, total, percent: total ? Math.round((done / total) * 100) : null }
  }

  const now7 = measure(thisWeek)
  const before7 = measure(lastWeek)
  // Only compared with the week before when something was actually recorded then: a brand new patient has no earlier week.
  const change = now7.percent !== null && before7.percent !== null && before7.done > 0 ? now7.percent - before7.percent : null
  return { ...now7, change }
}

export { lastDays }
