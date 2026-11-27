// The home-exercise tick sheet's logic, kept separate from the screens so the Exercises tab, the Today card and the
// Shift Handoff card all count things the same way.
//
// An exercise looks like { id, plan_id, name, detail, slots: ["am","pm"], weekdays: [0..6], sort_order, created_at }
// and a tick like { id, exercise_id, log_date: "YYYY-MM-DD", slot, status, reason, note, done_by, done_at }. Weekdays
// use JavaScript's 0 = Sunday, the same numbering as shifts and visits. Dates are each caregiver's own local date,
// the same convention as daily tasks and medication.
import { dayKey } from "./medication.js"

export const DISCIPLINES = ["Physical therapy", "Occupational therapy", "Speech-language therapy", "Swallowing", "Cognitive", "Other"]
export const SLOTS = ["am", "pm"]
export const SLOT_LABEL = { am: "AM", pm: "PM" }
export const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6]
export const STATUS_WORD = { done: "Done", partly: "Partly done", not_done: "Not done" }

// Why an exercise wasn't (fully) done. The first three can matter medically, so the screen asks the caregiver to
// tell the care team; the rest describe the day.
export const REASONS = [
  { key: "tired", label: "Too tired" },
  { key: "unwell", label: "Not feeling well" },
  { key: "pain", label: "In pain" },
  { key: "dizzy", label: "Dizzy or unsteady" },
  { key: "mood", label: "Low mood or didn't want to" },
  { key: "out", label: "Visit, appointment or out" },
  { key: "no_caregiver", label: "Caregiver wasn't there" },
  { key: "forgot", label: "Forgot" },
  { key: "other", label: "Other" },
]
export const reasonLabel = (key) => REASONS.find((r) => r.key === key)?.label || key
export const CONCERN_REASONS = ["unwell", "pain", "dizzy"]

// A morning exercise not recorded by midday, or an evening one by 7 PM, is worth a caregiver's attention.
export const AM_OVERDUE_HOUR = 12
export const PM_OVERDUE_HOUR = 19

// Every exercise-and-slot due on `date`: an exercise listed for AM and PM on a scheduled weekday gives two rows.
export function scheduledRows(exercises, date) {
  const weekday = date.getDay()
  const rows = []
  for (const exercise of exercises || []) {
    if (!(exercise.weekdays || ALL_DAYS).includes(weekday)) continue
    for (const slot of SLOTS) if ((exercise.slots || SLOTS).includes(slot)) rows.push({ exercise, slot })
  }
  return rows.sort((a, b) =>
    SLOTS.indexOf(a.slot) - SLOTS.indexOf(b.slot)
    || (a.exercise.sort_order || 0) - (b.exercise.sort_order || 0)
    || String(a.exercise.created_at).localeCompare(String(b.exercise.created_at)))
}

export const entryFor = (log, exerciseId, key, slot) =>
  (log || []).find((l) => l.exercise_id === exerciseId && l.log_date === key && l.slot === slot) || null

// The last `n` calendar days ending today, oldest first.
export function lastDays(n, now = new Date()) {
  const out = []
  for (let i = n - 1; i >= 0; i--) out.push(new Date(now.getFullYear(), now.getMonth(), now.getDate() - i))
  return out
}

// A day only counts for an exercise from the day it was added, so adding one today doesn't mark last week as missed.
const startedBy = (exercise, key) => dayKey(new Date(exercise.created_at)) <= key

// One cell of the weekly grid: the slots due for that exercise on that day, each with its state.
export function cellFor(exercise, day, log, now = new Date()) {
  const key = dayKey(day)
  if (!startedBy(exercise, key) || !(exercise.weekdays || ALL_DAYS).includes(day.getDay())) return []
  const todayKey = dayKey(now)
  return SLOTS.filter((s) => (exercise.slots || SLOTS).includes(s)).map((slot) => {
    const entry = entryFor(log, exercise.id, key, slot)
    return { slot, entry, state: entry ? entry.status : key < todayKey ? "not_recorded" : "pending" }
  })
}

// The week at a glance, in plain counts. "Not recorded" is a past slot nobody ticked, which is different from a
// slot someone marked not done and gave a reason for.
export function summarize(exercises, log, days, now = new Date()) {
  const total = { scheduled: 0, due: 0, done: 0, partly: 0, notDone: 0, notRecorded: 0, pending: 0 }
  const reasons = {}
  const concerns = []
  for (const day of days) {
    for (const exercise of exercises || []) {
      for (const cell of cellFor(exercise, day, log, now)) {
        total.scheduled++
        if (cell.state === "pending") { total.pending++; continue }
        total.due++
        if (cell.state === "not_recorded") { total.notRecorded++; continue }
        if (cell.state === "done") total.done++
        else if (cell.state === "partly") total.partly++
        else total.notDone++
        const reason = cell.entry.reason
        if (reason && cell.state !== "done") {
          reasons[reason] = (reasons[reason] || 0) + 1
          if (CONCERN_REASONS.includes(reason)) concerns.push({ day, exercise, slot: cell.slot, reason, note: cell.entry.note, by: cell.entry.done_by })
        }
      }
    }
  }
  return { ...total, reasons, concerns }
}

// What the Shift Handoff card and the Today card need: today's progress, what's overdue, and any pain, dizziness or
// feeling unwell that was recorded as the reason for skipping an exercise today.
export function todaySummary(exercises, log, now = new Date()) {
  const key = dayKey(now)
  const rows = scheduledRows(exercises, now).map((r) => ({ ...r, entry: entryFor(log, r.exercise.id, key, r.slot) }))
  const open = rows.filter((r) => !r.entry)
  const overdue = open.filter((r) => (r.slot === "am" && now.getHours() >= AM_OVERDUE_HOUR) || (r.slot === "pm" && now.getHours() >= PM_OVERDUE_HOUR))
  return {
    total: rows.length,
    recorded: rows.length - open.length,
    done: rows.filter((r) => r.entry?.status === "done").length,
    open,
    overdue,
    upcoming: open.filter((r) => !overdue.includes(r)),
    concerns: rows.filter((r) => r.entry && r.entry.status !== "done" && CONCERN_REASONS.includes(r.entry.reason)),
  }
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]))
const shortDay = (d) => d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })

// A one-page weekly report to hand to the therapist. Built from data already loaded, so it prints instantly.
// Returns false if the browser blocked the print window.
export function printExerciseReport({ patientName, plans, exercises, log, nameFor, patientId, printedBy, now = new Date() }) {
  const w = window.open("", "_blank")
  if (!w) return false
  const days = lastDays(7, now)
  const s = summarize(exercises, log, days, now)
  const mark = { done: "Done", partly: "Part", not_done: "No", not_recorded: "-", pending: "" }
  const rows = exercises.map((ex) => {
    const cells = days.map((d) => {
      const cs = cellFor(ex, d, log, now)
      return `<td>${cs.length ? cs.map((c) => `${SLOT_LABEL[c.slot]} ${mark[c.state]}`).join("<br>") : "&ndash;"}</td>`
    }).join("")
    return `<tr><td><strong>${esc(ex.name)}</strong>${ex.detail ? `<br>${esc(ex.detail)}` : ""}</td>${cells}</tr>`
  }).join("")
  const skipped = []
  for (const day of days) for (const ex of exercises) for (const c of cellFor(ex, day, log, now)) {
    if (c.entry && c.entry.status !== "done") {
      skipped.push(`<li><strong>${esc(shortDay(day))} ${SLOT_LABEL[c.slot]}</strong>, ${esc(ex.name)}: ${esc(STATUS_WORD[c.entry.status].toLowerCase())}${c.entry.reason ? `, ${esc(reasonLabel(c.entry.reason).toLowerCase())}` : ""}${c.entry.note ? `. ${esc(c.entry.note)}` : ""}${nameFor && c.entry.done_by ? ` (${esc(nameFor(patientId, c.entry.done_by) || "")})` : ""}</li>`)
    }
  }
  const reasonLine = Object.entries(s.reasons).map(([k, n]) => `${esc(reasonLabel(k))}: ${n}`).join(" &middot; ")
  const planBlocks = (plans || []).map((p) => `<p><strong>${esc(p.discipline)}${p.therapist_name ? ` (${esc(p.therapist_name)})` : ""}</strong>${p.title ? `, ${esc(p.title)}` : ""}${p.precautions ? `<br>Precautions from the therapist: ${esc(p.precautions)}` : ""}</p>`).join("")
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Exercise report for ${esc(patientName)}</title>
    <style>
      body { font-family: Georgia, serif; color: #000; margin: 22px; font-size: 13px; }
      h1 { font-size: 22px; margin: 0 0 2px; } h2 { font-size: 15px; margin: 18px 0 6px; border-bottom: 1px solid #999; padding-bottom: 3px; }
      table { width: 100%; border-collapse: collapse; font-size: 11.5px; } th { text-align: left; border-bottom: 2px solid #000; padding: 4px 5px; }
      td { border-bottom: 1px solid #ccc; padding: 4px 5px; vertical-align: top; } ul { margin: 4px 0 0; padding-left: 18px; line-height: 1.5; }
      .foot { font-size: 11.5px; color: #333; margin-top: 18px; border-top: 1px solid #999; padding-top: 6px; }
    </style></head><body>
    <h1>${esc(patientName)}: exercises, last 7 days</h1>
    <p>${esc(shortDay(days[0]))} to ${esc(shortDay(days[6]))}. ${s.done} of ${s.due} recorded as done${s.partly ? `, ${s.partly} partly done` : ""}${s.notDone ? `, ${s.notDone} not done` : ""}${s.notRecorded ? `, ${s.notRecorded} not recorded` : ""}.${reasonLine ? `<br>Reasons for not doing them: ${reasonLine}.` : ""}</p>
    ${planBlocks}
    <h2>Week at a glance</h2>
    <table><thead><tr><th>Exercise</th>${days.map((d) => `<th>${esc(shortDay(d))}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table>
    <h2>Exercises not done, or only partly done</h2>
    ${skipped.length ? `<ul>${skipped.join("")}</ul>` : `<p>None this week.</p>`}
    <p class="foot">Recorded by the care team in Strovia${printedBy ? `, printed by ${esc(printedBy)}` : ""}. These are the caregivers' own records of what was done, not a clinical assessment. Pain, dizziness or feeling unwell should be discussed with the therapist or doctor.</p>
    </body></html>`)
  w.document.close()
  w.focus()
  w.print()
  return true
}
