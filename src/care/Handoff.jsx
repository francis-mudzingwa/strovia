import { useState } from "react"
import { CheckCircle2, Clock, Siren, MessageSquare } from "lucide-react"
import { shiftsOnNow, occurrences } from "../shifts.js"
import { todaySummary, reasonLabel } from "./exercises.js"
import { scheduledSlotsFor, slotStatus } from "./medication.js"
import { assessReading, hasRanges, everyWords, READING_NAME } from "./ranges.js"
import { taskOpensAt, isBefore } from "./timeOfDay.js"
import { bowelStatus, kindLabel, dayWord as bowelDay } from "./bowel.js"
import { MEALS, mealRow, mealConcerns, openMeals, mealLabel, summary as mealSummary } from "./meals.js"
import { localDate } from "./useCare.js"
import { Card, colors, fmtTime, fmtWhen } from "./ui.jsx"
import { Avatar } from "../Avatar.jsx"

const SYMPTOM_LABELS = { balance: "Balance", vision: "Vision", face: "Face", arm: "Arm", speech: "Speech", headache: "Headache", fatigue: "Fatigue" }
const LEVEL_WORD = ["None", "Mild", "Moderate", "Severe"]
const AMBER_TEXT = "#6B4D0E"
export const HANDOVER_TAGS = [["ate_well", "Ate and drank well"], ["tired", "Tired today"], ["mood_low", "Mood low"], ["follow_up", "Needs follow-up"], ["quiet", "Quiet day"]]
const tagLabel = (key) => HANDOVER_TAGS.find(([k]) => k === key)?.[1] || key

const localDay = (d) => { const x = new Date(d); return `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}` }
const isToday = (d, now) => localDay(d) === localDay(now)
const shortDay = (d) => d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })
const slotWord = (slot) => (slot === "am" ? "morning" : "evening")
function dayWord(d, now) {
  const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diff = Math.round((startOf(d) - startOf(now)) / 86400000)
  if (diff === 0) return "Today"
  if (diff === 1) return "Tomorrow"
  if (diff === -1) return "Yesterday"
  return shortDay(d)
}

const sectionLabel = { fontSize: 12.5, fontWeight: 700, color: colors.inkFaint, textTransform: "uppercase", letterSpacing: 0.7, margin: "16px 0 8px" }
const initialsOf = (name) => (name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2) || "?").toUpperCase()

// The card a caregiver reads when they arrive: who handed over to whom, the note the last caregiver left, where to start in
// order, what was done during the last shift, and what is next. Everything except the note is worked out from what was
// recorded (no AI): the card can only say what someone wrote down, which is why the note matters.
export default function Handoff({ patientId, profile, entries, alert, severeDone, appointments, plan, care, overview, visits, anomalies, personName, userId, role, offShift = false, onMessage, now = new Date() }) {
  const [showAllEvents, setShowAllEvents] = useState(false)
  const fullName = profile.fullName || "The patient"
  const first = fullName.split(" ")[0]
  const todayEntry = entries.find((e) => e.isToday)
  const nameOf = (uid) => (uid && personName(patientId, uid)) || "A caregiver"
  const viewer = role === "caregiver" || role === "relative" ? "You" : "the next caregiver"

  // The caregiver who handed over: the most recent other person whose time at the patient has ended.
  const attendance = care.attendance || []
  const endOf = (a) => (a.left_at ? new Date(a.left_at) : a.planned_end && new Date(a.planned_end) < now ? new Date(a.planned_end) : null)
  const prevAtt = attendance.filter((a) => a.caregiver_id !== userId && endOf(a)).sort((a, b) => new Date(b.arrived_at) - new Date(a.arrived_at))[0] || null
  const prev = prevAtt ? { id: prevAtt.caregiver_id, name: nameOf(prevAtt.caregiver_id), start: new Date(prevAtt.arrived_at), end: endOf(prevAtt) } : null
  const windowStart = prev ? prev.start : new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const windowEnd = prev ? prev.end : now
  const inWindow = (d) => d && new Date(d) >= windowStart && new Date(d) <= new Date(windowEnd.getTime() + 60000)

  const note = (care.handoverNotes || [])[0] || null

  const items = [] // "Start here": { tone: "bad" | "warn" | "info", title, detail }

  // Alerts first: this is the one thing a handover must not bury.
  if (alert?.level === "emergency") {
    items.push({ tone: "bad", title: "Severe symptoms were recorded", detail: severeDone ? "What was done has been noted" : "Nobody has noted what was done yet" })
  } else if (alert) {
    for (const r of alert.reasons) items.push({ tone: "warn", title: r })
  }
  if (anomalies && anomalies.length > 0) {
    items.push(anomalies.length === 1
      ? { tone: "warn", title: `Watch: ${anomalies[0].label.toLowerCase()}`, detail: anomalies[0].message }
      : { tone: "warn", title: `${anomalies.length} symptoms changed since the last check-in`, detail: anomalies.map((a) => a.label).join(", ") })
  }

  // Medications: name anything overdue, due now or refused; the next dose coming up soon.
  const medSlots = scheduledSlotsFor(plan.medSchedule, now, care.medications)
  for (const s of medSlots) {
    const status = slotStatus(s, now)
    if (status === "overdue" || status === "due") {
      items.push({ tone: status === "overdue" ? "bad" : "warn", title: `Give ${s.med.name}${s.med.dose ? ` (${s.med.dose})` : ""}`, detail: status === "overdue" ? `Overdue. Was due at ${fmtTime(s.due)} and not recorded as given` : `Due now (${fmtTime(s.due)})` })
    }
  }
  for (const m of care.medications || []) {
    if (m.status === "refused" && isToday(m.created_at, now)) {
      items.push({ tone: "bad", title: `${m.med_name}${m.dose ? ` (${m.dose})` : ""} was refused`, detail: m.note || undefined })
    }
  }
  const nextDose = medSlots.find((s) => slotStatus(s, now) === "upcoming")
  if (nextDose) items.push({ tone: "info", title: `${nextDose.med.name}${nextDose.med.dose ? ` (${nextDose.med.dose})` : ""} is next`, detail: `Due at ${fmtTime(nextDose.due)}` })

  // Open questions and any incident reported today.
  if (overview.questions > 0) {
    items.push({ tone: "bad", title: `${overview.questions} ${overview.questions === 1 ? "question is" : "questions are"} waiting for an answer` })
  }
  for (const inc of (care.incidents || [])) {
    if (isToday(inc.happened_at, now)) items.push({ tone: "bad", title: `Incident reported: ${inc.kind}${inc.injury ? " (with injury)" : ""}`, detail: `At ${fmtTime(inc.happened_at)}` })
  }

  // Check-in not done: urgent once it is getting late, otherwise just a thing to do.
  if (!todayEntry) {
    items.push({ tone: now.getHours() >= 18 ? "bad" : now.getHours() >= 12 ? "warn" : "info", title: "Do today's symptom check-in", detail: "Not recorded yet today" })
  }

  // Readings outside the care team's range.
  const ranged = hasRanges(plan.ranges || {})
  const latestVital = care.vitals[0] || null
  const levelOf = (v) => v.level ?? (ranged ? assessReading({ ...v, weight: v.weight_lb }, plan.ranges, (care.vitals || []).filter((x) => new Date(x.taken_at) < new Date(v.taken_at))).level : null)
  // An urgent (red) reading stays at the top until someone writes down what was done about it.
  for (const v of care.vitals || []) {
    if (levelOf(v) === "red" && !v.acknowledged_at && now - new Date(v.taken_at) < 24 * 3600000) {
      items.push({ tone: "bad", title: "Urgent reading: nobody has written down what was done", detail: `Recorded ${isToday(v.taken_at, now) ? "" : `${dayWord(new Date(v.taken_at), now)} `}${fmtTime(v.taken_at)}. Open Readings and record what was done.` })
    }
  }
  if (latestVital && levelOf(latestVital) === "amber") {
    items.push({ tone: "warn", title: "Latest reading is outside the care team's range", detail: "Tell the supervisor" })
  }
  // Bowel movements (carers and administrators only; never shown to family or to someone who is off shift).
  if (role !== "relative" && !offShift) {
    const bw = bowelStatus(care.bowel || [], plan, now)
    if (bw.blood) items.push({ tone: "bad", title: "Blood or black stool was recorded", detail: `${bowelDay(bw.blood.happened_at, now) === "today" ? "" : `${bowelDay(bw.blood.happened_at, now)} `}${fmtTime(bw.blood.happened_at)}. The office was told.` })
    if (bw.amber) items.push({ tone: "warn", title: `No bowel movement for ${bw.days} days`, detail: `The care plan says to tell the office after ${bw.limit} days` })
    else if (bw.last) items.push({ tone: "info", title: `Last bowel movement: ${bowelDay(bw.last.happened_at, now)}, ${fmtTime(bw.last.happened_at)}`, detail: kindLabel(bw.last.kind) + (bw.last.accident ? ", accident" : "") })
  }

  // Readings the care plan says should have been taken by now.
  for (const o of care.overdue || []) {
    items.push({ tone: "warn", title: `${READING_NAME[o.reading] || o.reading} is overdue`, detail: `It should be taken ${everyWords(o.every_hours)}. ${o.last_at ? `Last recorded ${fmtWhen(o.last_at)}.` : "Not recorded yet."}` })
  }

  // Exercises left by a therapist: overdue ones need attention, a skip because of pain or dizziness is passed on, the rest are still to do.
  const ex = todaySummary(care.exercises, care.exerciseLog, now)
  if (ex.total > 0) {
    if (ex.overdue.length) items.push({ tone: "warn", title: "Record the exercises", detail: ex.overdue.map((r) => `${r.exercise.name} (${slotWord(r.slot)})`).join(", ") })
    for (const r of ex.concerns) {
      items.push({ tone: "warn", title: `${r.exercise.name} (${slotWord(r.slot)}) was ${r.entry.status === "partly" ? "only partly done" : "not done"}`, detail: `${reasonLabel(r.entry.reason)}. Worth telling the therapist.` })
    }
    if (ex.upcoming.length) items.push({ tone: "info", title: "Exercises still to do", detail: ex.upcoming.map((r) => `${r.exercise.name} (${slotWord(r.slot)})`).join(", ") })
  }

  // Meals: little eaten or drunk and trouble swallowing are passed on; what was recorded so far and which meals still need recording.
  if (!offShift) {
    const mealToday = localDate(now)
    const mealRows = care.meals || []
    for (const c of mealConcerns(mealRows, mealToday)) items.push(c)
    const eaten = MEALS.map((m) => ({ m, r: mealRow(mealRows, mealToday, m.key) })).filter((x) => x.r)
    if (eaten.length) items.push({ tone: "info", title: `Meals so far today: ${eaten.length} of ${MEALS.length}`, detail: eaten.map((x) => `${x.m.label}: ${mealSummary(x.r).toLowerCase()}`).join(". ") })
    const toRecord = openMeals(now).filter((m) => !mealRow(mealRows, mealToday, m.key))
    if (toRecord.length) items.push({ tone: "info", title: "Meals still to record", detail: toRecord.map((m) => m.label).join(", ") })
  }

  // Tasks: naming the ones left is the whole point of a handover.
  // Only tasks that are open now: an Evening task is not "still to do" at 9 in the morning.
  const undone = (plan.tasks || []).filter((t) => !care.tasksDone.some((d) => d === t || d.task === t) && !isBefore(now, taskOpensAt(plan.taskTimes, t)))
  if (undone.length === 1) items.push({ tone: "info", title: undone[0], detail: "The only task left today" })
  else if (undone.length > 1) items.push({ tone: "info", title: "Tasks still to do", detail: undone.join(", ") })

  const rank = { bad: 0, warn: 1, info: 2 }
  items.sort((a, b) => rank[a.tone] - rank[b.tone])

  // What happened during the last shift (or so far today when nobody has handed over): one line per thing recorded.
  const events = []
  if (prev) events.push({ at: prev.start, tone: "g", title: "Arrived" })
  if (todayEntry?.at && inWindow(todayEntry.at)) {
    const active = Object.entries(todayEntry.symptoms || {}).filter(([, v]) => v > 0)
    events.push({ at: new Date(todayEntry.at), tone: active.length ? "w" : "g", title: "Today's symptom check-in", detail: active.length === 0 ? "No symptoms reported" : active.map(([k, v]) => `${SYMPTOM_LABELS[k] || k} ${LEVEL_WORD[v].toLowerCase()}`).join(", ") })
  }
  for (const v of care.vitals || []) {
    if (!inWindow(v.taken_at)) continue
    const level = levelOf(v)
    events.push({ at: new Date(v.taken_at), tone: level ? "r" : "g", title: "Reading recorded", detail: level === "red" ? (v.acknowledged_at ? `Urgent. What was done: ${v.action_note}` : "Urgent: above the care team's urgent limit") : level === "amber" ? "Outside the care team's range" : ranged ? "Within the care team's limits" : undefined })
  }
  for (const m of care.medications || []) {
    if (!inWindow(m.created_at)) continue
    const label = `${m.med_name}${m.dose ? ` (${m.dose})` : ""}`
    events.push({ at: new Date(m.created_at), tone: m.status === "refused" ? "r" : "g", title: `${label} ${m.status === "refused" ? "refused" : "given"}`, detail: m.status === "refused" ? m.note || undefined : undefined })
  }
  // Only ticks of tasks that are on the care plan's list today count (older ticks of removed tasks would otherwise give "4 of 3").
  const planTasks = plan.tasks || []
  const doneTasks = (care.tasksDone || []).filter((t) => inWindow(t.done_at) && planTasks.includes(t.task))
  if (doneTasks.length) {
    const last = doneTasks.reduce((a, b) => (new Date(a.done_at) > new Date(b.done_at) ? a : b))
    events.push({ at: new Date(last.done_at), tone: "g", title: `${doneTasks.length} of ${planTasks.length} ${planTasks.length === 1 ? "task" : "tasks"} done`, detail: doneTasks.map((t) => t.task).join(", ") })
  }
  // Meals and bowel movements recorded during the window (not for family, and not while off shift).
  if (!offShift) {
    for (const m of care.meals || []) {
      if (!inWindow(m.done_at)) continue
      events.push({ at: new Date(m.done_at), tone: m.trouble ? "r" : m.amount === "little" || m.amount === "none" ? "w" : "g", title: `${mealLabel(m.meal)}: ${mealSummary(m).toLowerCase()}`, detail: m.trouble ? "Coughing, choking or trouble swallowing" : undefined })
    }
    if (role !== "relative") {
      for (const b of care.bowel || []) {
        if (!inWindow(b.happened_at)) continue
        events.push({ at: new Date(b.happened_at), tone: b.blood ? "r" : "g", title: `Bowel movement (${kindLabel(b.kind).toLowerCase()})`, detail: b.blood ? "Blood or black stool" : b.accident ? "Accident" : undefined })
      }
    }
  }
  for (const l of care.exerciseLog || []) {
    if (!inWindow(l.done_at)) continue
    const exercise = (care.exercises || []).find((e) => e.id === l.exercise_id)
    const word = l.status === "done" ? "done" : l.status === "partly" ? "only partly done" : "not done"
    events.push({ at: new Date(l.done_at), tone: l.status === "done" ? "g" : "w", title: `${exercise?.name || "Exercise"} (${slotWord(l.slot)}) ${word}`, detail: l.status !== "done" && l.reason ? reasonLabel(l.reason) : undefined })
  }
  for (const inc of care.incidents || []) {
    if (inWindow(inc.happened_at)) events.push({ at: new Date(inc.happened_at), tone: "r", title: `Incident: ${inc.kind}${inc.injury ? " (with injury)" : ""}` })
  }
  for (const l of care.visitLog || []) {
    const visit = (visits || []).find((v) => v.id === l.visit_id)
    if (!visit) continue
    const when = new Date(`${l.occurred_on}T${String(visit.start_time).slice(0, 5)}`)
    if (!inWindow(when)) continue
    const who = [visit.visit_type, visit.visitor_name].filter(Boolean).join(", ")
    events.push(l.status === "happened"
      ? { at: when, tone: "g", title: `${visit.visit_type} visit happened`, detail: visit.visitor_name || undefined }
      : { at: when, tone: "w", title: `${who || "Visit"} did not happen`, detail: l.reason ? String(l.reason).replace("_", " ") : undefined })
  }
  events.sort((a, b) => a.at - b.at)
  const shownEvents = showAllEvents ? events : events.slice(-8)

  // Who is with the patient now, and the next visit or appointment.
  const rows = []
  const here = attendance.filter((a) => !a.left_at && a.caregiver_id !== userId)
  if (here.length) {
    rows.push({ label: `With ${first}`, text: here.map((a) => nameOf(a.caregiver_id)).join(", "), sub: `Arrived ${fmtTime(here[0].arrived_at)}` })
  } else if (care.schedule && care.schedule.length && !prev) {
    const onNow = shiftsOnNow(care.schedule, now)
    if (onNow.length) rows.push({ label: "On shift", text: onNow.map((o) => nameOf(o.shift.caregiver_id)).join(", "), sub: `Until ${fmtTime(onNow[0].end)}` })
    else {
      const next = occurrences(care.schedule, now, 14).find((o) => o.start > now)
      rows.push({ label: "On shift", text: "Nobody right now", sub: next ? `Next: ${nameOf(next.shift.caregiver_id)}, ${shortDay(next.start)} at ${fmtTime(next.start)}` : undefined })
    }
  }
  const nextVisit = occurrences((visits || []).filter((v) => v.patient_id === patientId), now, 3).find((o) => o.start > now)
  const nextAppt = [...(appointments || [])].filter((a) => new Date(a.starts_at) >= now).sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at))[0]
  const visitFirst = nextVisit && (!nextAppt || nextVisit.start < new Date(nextAppt.starts_at))
  const soonest = visitFirst
    ? { label: "Next visit", when: nextVisit.start, text: [nextVisit.shift.visit_type, nextVisit.shift.visitor_name].filter(Boolean).join(", ") }
    : nextAppt ? { label: "Appointment", when: new Date(nextAppt.starts_at), text: nextAppt.doctor } : null
  if (soonest) rows.push({ label: soonest.label, text: soonest.text, sub: `${dayWord(soonest.when, now)} at ${fmtTime(soonest.when)}` })

  const hasBad = items.some((a) => a.tone === "bad")
  const hasWarn = items.some((a) => a.tone === "warn")
  const overall = hasBad
    ? { label: "Needs attention", fg: colors.rust, bg: colors.rustTint, icon: Siren }
    : hasWarn
    ? { label: "Worth a look", fg: AMBER_TEXT, bg: colors.goldTint, icon: Clock }
    : { label: "Doing well", fg: colors.sageDeep, bg: colors.sageTint, icon: CheckCircle2 }
  const when = `${now.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}, ${fmtTime(now)}`
  const numberColor = { bad: colors.rust, warn: colors.gold, info: colors.teal }
  const noteAuthor = note ? (note.author_id === userId ? "you" : nameOf(note.author_id)) : null
  const noteWhen = note ? `${isToday(note.created_at, now) ? "" : `${dayWord(new Date(note.created_at), now)} `}${fmtTime(note.created_at)}`.trim() : ""

  return (
    <Card>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: "Fraunces, serif", fontSize: 19, fontWeight: 600, color: colors.ink }}>Shift handover</div>
          <div style={{ fontSize: 13, color: colors.inkSoft, marginTop: 2 }}>{fullName} · {when}</div>
        </div>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 13, fontWeight: 700, color: overall.fg, background: overall.bg, borderRadius: 999, padding: "5px 12px", whiteSpace: "nowrap", flexShrink: 0 }}>
          <overall.icon size={13} /> {overall.label}
        </span>
      </div>

      {prev && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", background: colors.bg, borderRadius: 12, padding: "9px 12px", marginTop: 12, fontSize: 13 }}>
          <Avatar userId={prev.id} name={prev.name} size={28} fontSize={12.5} />
          <span><strong>{prev.name}</strong> <span style={{ color: colors.inkFaint }}>{fmtTime(prev.start)} to {fmtTime(prev.end)}</span></span>
          <span style={{ color: colors.inkFaint }}>→</span>
          <strong>{viewer}</strong>
          {onMessage && prev.id !== userId && (
            <button onClick={() => onMessage(prev.id)} style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 5, border: `1px solid ${colors.hairline}`, background: "#fff", borderRadius: 9, padding: "5px 10px", fontSize: 12.5, fontWeight: 700, color: colors.sageDeep, cursor: "pointer" }}>
              <MessageSquare size={13} /> Message
            </button>
          )}
        </div>
      )}

      {note && (
        <>
          <div style={sectionLabel}>{noteAuthor === "you" ? "Your note" : `Note from ${noteAuthor.split(" ")[0]}`}</div>
          <div style={{ background: "#F3F6F1", borderRadius: 12, padding: "11px 13px", fontSize: 13.5, lineHeight: 1.5, color: colors.ink }}>
            {note.tags && note.tags.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: note.note ? 8 : 0 }}>
                {note.tags.map((t) => <span key={t} style={{ fontSize: 13, fontWeight: 700, color: colors.sageDeep, background: colors.sageTint, borderRadius: 999, padding: "2px 10px" }}>{tagLabel(t)}</span>)}
              </div>
            )}
            {note.note}
            <div style={{ fontSize: 13, color: colors.inkFaint, marginTop: 6 }}>Written by {noteAuthor} at {noteWhen}</div>
          </div>
        </>
      )}
      {!note && prev && (
        <div style={{ fontSize: 13, color: colors.inkFaint, marginTop: 10 }}>{prev.name.split(" ")[0]} did not leave a note.</div>
      )}

      <div style={sectionLabel}>Start here</div>
      {items.length === 0 ? (
        <div style={{ background: colors.sageTint, borderLeft: `5px solid ${colors.sage}`, borderRadius: 12, padding: "11px 12px", fontSize: 14, fontWeight: 700, color: colors.sageDeep }}>
          Nothing is overdue or waiting. You are all caught up.
        </div>
      ) : (
        <div style={{ background: hasBad ? "#FBF1EE" : hasWarn ? "#FBF5E6" : colors.bg, borderLeft: `5px solid ${hasBad ? colors.rust : hasWarn ? colors.gold : colors.teal}`, borderRadius: 12, padding: "2px 12px" }}>
          {items.map((a, i) => (
            <div key={i} style={{ display: "flex", gap: 11, padding: "10px 0", borderTop: i ? "1px solid rgba(32,38,31,0.08)" : "none" }}>
              <span style={{ width: 22, height: 22, borderRadius: 999, background: numberColor[a.tone], color: "#fff", fontWeight: 700, fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1 }}>{i + 1}</span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: a.tone === "bad" ? colors.rust : a.tone === "warn" ? AMBER_TEXT : colors.ink, lineHeight: 1.35 }}>{a.title}</div>
                {a.detail && <div style={{ fontSize: 13, color: colors.inkSoft, marginTop: 1, lineHeight: 1.4 }}>{a.detail}</div>}
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={sectionLabel}>{prev ? `What ${prev.name.split(" ")[0]} did` : "Today so far"}</div>
      {offShift ? (
        // A caregiver who is not on shift reads the handover (the note and where to start) but not the record of what was
        // done. It opens as soon as they are on shift: clocked in with "I've arrived", or within the shift window.
        <div style={{ background: colors.bg, borderRadius: 12, padding: "11px 13px", fontSize: 13, color: colors.inkSoft, lineHeight: 1.5 }}>
          You will see {prev ? `what ${prev.name.split(" ")[0]} did` : "what has been recorded today"} when you are on shift. Tap <strong>I've arrived</strong> on the welcome page when you start.
        </div>
      ) : events.length === 0 ? (
        <div style={{ fontSize: 13, color: colors.inkFaint }}>Nothing has been recorded {prev ? "during that shift" : "yet today"}.</div>
      ) : (
        <div>
          {events.length > shownEvents.length && (
            <button onClick={() => setShowAllEvents(true)} style={{ border: "none", background: "none", padding: "0 0 8px", color: colors.sageDeep, fontWeight: 700, fontSize: 13, textDecoration: "underline", cursor: "pointer" }}>Show {events.length - shownEvents.length} earlier</button>
          )}
          {shownEvents.map((e, i) => (
            <div key={i} style={{ display: "flex", gap: 12, position: "relative", paddingBottom: i === shownEvents.length - 1 ? 0 : 12 }}>
              {i < shownEvents.length - 1 && <span style={{ position: "absolute", left: 70, top: 14, bottom: -2, width: 2, background: colors.hairline }} />}
              <span style={{ width: 54, flexShrink: 0, fontSize: 13, fontWeight: 700, color: colors.inkFaint, paddingTop: 2 }}>{fmtTime(e.at)}</span>
              <span style={{ width: 12, height: 12, borderRadius: 999, background: e.tone === "r" ? colors.rust : e.tone === "w" ? colors.gold : colors.sage, marginTop: 4, flexShrink: 0, position: "relative", zIndex: 1 }} />
              <div style={{ minWidth: 0, fontSize: 13.5, lineHeight: 1.4, color: colors.ink }}>
                {e.title}
                {e.detail && <span style={{ display: "block", fontSize: 13, color: colors.inkSoft }}>{e.detail}</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {rows.length > 0 && (
        <>
          <div style={sectionLabel}>Next</div>
          <div>
            {rows.map((r, i) => (
              <div key={i} style={{ display: "flex", gap: 12, padding: "9px 0", borderTop: i ? `1px solid ${colors.hairline}` : "none", fontSize: 13.5 }}>
                <span style={{ width: 92, flexShrink: 0, fontSize: 13, fontWeight: 700, color: colors.inkFaint, paddingTop: 1 }}>{r.label}</span>
                <span style={{ minWidth: 0, lineHeight: 1.4, color: colors.ink }}>
                  {r.text}
                  {r.sub && <span style={{ display: "block", fontSize: 13, color: colors.inkSoft }}>{r.sub}</span>}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </Card>
  )
}
