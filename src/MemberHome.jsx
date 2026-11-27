import { useState } from "react"
import { Avatar } from "./Avatar.jsx"
import BirthdaysCard from "./Birthdays.jsx"
import { TrainingHomeCard } from "./training/MyTraining.jsx"
import { Search, X, Clock, AlertTriangle, CheckCircle2, ArrowRight, ChevronRight, CalendarDays, MapPin, Check } from "lucide-react"
import { supabase } from "./supabaseClient.js"
import { shiftsOnNow, occurrences, dayLabel } from "./shifts.js"
import { assess, useNow, ago, fmtClockTime, appointmentText, SevereActionLine, INCIDENT_LABEL } from "./PatientsHome.jsx"
import { HANDOVER_TAGS } from "./care/Handoff.jsx"

const colors = {
  bg: "#FAF6EF", card: "#FFFFFF", hairline: "#E5DFD1", ink: "#20261F", inkSoft: "#5C6357", inkFaint: "#6B7266",
  sage: "#3F6C51", sageDeep: "#2C4E3A", sageTint: "#E3EBE0", gold: "#B98A2E", goldTint: "#F3E7CC",
  rust: "#A24632", rustTint: "#F3DAD2", hero: "#2F5A41",
}
const shadow = "0 1px 3px rgba(32,38,31,0.07), 0 6px 16px rgba(32,38,31,0.05)"
const initials = (name) => (name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2) || "?").toUpperCase()
const spanText = (ms) => {
  const m = Math.max(0, Math.round(ms / 60000))
  const h = Math.floor(m / 60)
  return h ? `${h} h${m % 60 ? ` ${m % 60} min` : ""}` : `${m} min`
}

// Names are matched while typing: the part that matches is marked so it's clear why a patient is shown.
function Highlight({ text, q }) {
  const i = q ? text.toLowerCase().indexOf(q) : -1
  if (i < 0) return text
  return <>{text.slice(0, i)}<mark style={{ background: "#FFF1C9", color: "inherit", borderRadius: 4, padding: "0 1px" }}>{text.slice(i, i + q.length)}</mark>{text.slice(i + q.length)}</>
}

function Pill({ icon: Icon, tone, children }) {
  const look = { green: [colors.sageTint, colors.sageDeep], red: ["#F8E6E0", "#7A2E1E"], plain: ["#fff", colors.inkSoft] }[tone]
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600, borderRadius: 999, padding: "7px 12px", background: look[0], color: look[1], border: tone === "plain" ? `1px solid ${colors.hairline}` : "none", whiteSpace: "nowrap" }}>
      <Icon size={15} /> {children}
    </span>
  )
}

// "Before you go": shown when a caregiver taps "I'm leaving". A short note for whoever comes next (optional), with quick tags,
// next to what has been recorded and what is still open. Saving it and closing the arrival happen together; leaving without a
// note is always possible.
export function LeavePanel({ patient, care, checkedIn, openId, userId, onDone, onCancel }) {
  const [note, setNote] = useState("")
  const [tags, setTags] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [noteSaved, setNoteSaved] = useState(false)
  const first = patient.full_name.split(" ")[0]
  const toggle = (key) => setTags((t) => (t.includes(key) ? t.filter((x) => x !== key) : [...t, key]))
  const hasNote = note.trim().length > 0 || tags.length > 0
  const medsLeft = care ? Math.max(0, care.medsTotal - care.medsGiven) : 0
  const tasksLeft = care ? Math.max(0, care.tasksTotal - care.tasksDone) : 0
  const open = [!checkedIn ? "today's symptom check-in" : null, medsLeft ? `${medsLeft} ${medsLeft === 1 ? "medication" : "medications"}` : null, tasksLeft ? `${tasksLeft} ${tasksLeft === 1 ? "task" : "tasks"}` : null].filter(Boolean)

  async function finish(withNote) {
    setBusy(true)
    setError(null)
    if (withNote && hasNote && !noteSaved) {
      const { error: noteErr } = await supabase.from("handover_notes").insert({ patient_id: patient.id, author_id: userId, note: note.trim() || null, tags })
      if (noteErr) { setBusy(false); return setError("The note couldn't be saved. Try again, or leave without a note.") }
      setNoteSaved(true)
    }
    const { error: leaveErr } = await supabase.rpc("clock_out", { p_attendance: openId })
    setBusy(false)
    if (leaveErr) return setError("That couldn't be saved. Check your connection and try again.")
    await onDone()
  }

  return (
    <div style={{ background: "#fff", borderRadius: 16, padding: 14, marginTop: 12, boxShadow: "0 0 0 1px #B9D3BF" }}>
      <div style={{ fontFamily: "Fraunces, serif", fontSize: 17, fontWeight: 600, color: colors.ink }}>Before you go</div>
      <div style={{ fontSize: 13, color: colors.inkSoft, margin: "1px 0 9px" }}>Leave a note for the next caregiver</div>
      <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={600} rows={3} placeholder={`How was ${first} today? Anything to watch, or to tell the family?`}
        style={{ width: "100%", boxSizing: "border-box", border: `1.5px dashed ${colors.hairline}`, borderRadius: 12, padding: "10px 12px", fontSize: 13.5, fontFamily: "inherit", color: colors.ink, resize: "vertical" }} />
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
        {HANDOVER_TAGS.map(([key, label]) => (
          <button key={key} type="button" onClick={() => toggle(key)} aria-pressed={tags.includes(key)}
            style={{ fontSize: 13, fontWeight: 600, borderRadius: 999, padding: "5px 11px", cursor: "pointer", border: `1px solid ${tags.includes(key) ? colors.sage : colors.hairline}`, background: tags.includes(key) ? colors.sageTint : "#fff", color: tags.includes(key) ? colors.sageDeep : colors.inkSoft }}>{label}</button>
        ))}
      </div>
      <div style={{ fontSize: 13, color: colors.inkSoft, marginTop: 11, lineHeight: 1.5 }}>
        {open.length === 0
          ? "Everything recorded for today is done."
          : <>Not done yet, so the next caregiver will be told: <strong>{open.join(", ")}</strong>.</>}
      </div>
      <button onClick={() => finish(true)} disabled={busy} style={{ display: "block", width: "100%", marginTop: 10, padding: "12px 0", border: "none", borderRadius: 12, background: colors.hero, color: "#fff", fontWeight: 700, fontSize: 14, cursor: busy ? "default" : "pointer", opacity: busy ? 0.65 : 1 }}>
        {hasNote ? "Save note and leave" : "Leave"}
      </button>
      <div style={{ display: "flex", justifyContent: "center", gap: 16, marginTop: 9 }}>
        {hasNote && <button onClick={() => finish(false)} disabled={busy} style={{ border: "none", background: "none", padding: 0, color: colors.sageDeep, fontWeight: 700, fontSize: 13, textDecoration: "underline", cursor: "pointer" }}>Leave without the note</button>}
        <button onClick={onCancel} disabled={busy} style={{ border: "none", background: "none", padding: 0, color: colors.inkSoft, fontWeight: 700, fontSize: 13, textDecoration: "underline", cursor: "pointer" }}>Not yet</button>
      </div>
      {error && <div style={{ fontSize: 13, color: colors.rust, marginTop: 8 }}>{error}</div>}
    </div>
  )
}

// The patient this caregiver is on shift with right now (or whose shift starts within half an hour): set apart from the
// list. "I've arrived" tells the team they're there, then the card shows how much of the shift is done; near the end
// (or any time, from the small link) "I'm leaving" closes it. Same two database calls the patient's page uses.
function WithYouToday({ occurrence, starting, patient, attendance, userId, onClockChange, now, onOpen, care, checkedIn }) {
  const [leaving, setLeaving] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const total = occurrence.end - occurrence.start
  const done = Math.min(Math.max(now - occurrence.start, 0), total)
  const left = total - done
  const first = patient.full_name.split(" ")[0]
  // An arrival stays valid for the whole shift, so a live-in caregiver on a multi-day shift isn't asked to arrive again.
  const open = attendance.find((a) => a.caregiver_id === userId && !a.left_at && now - new Date(a.arrived_at) < Math.max(20 * 3600000, total + 4 * 3600000))
  const nearEnd = !starting && left <= 30 * 60000
  // Just arrived: for ten minutes the main button stays "Open", so a second tap in the same spot can never mean "leave".
  const justArrived = !!open && now - new Date(open.arrived_at).getTime() < 10 * 60000
  // Already arrived and left during this shift: the card says so, and does not offer "I've arrived" all over again.
  const finished = !open && !starting
    ? attendance.find((a) => a.caregiver_id === userId && a.left_at && new Date(a.arrived_at) >= occurrence.start.getTime() - 3600000 && new Date(a.arrived_at) < occurrence.end.getTime())
    : null

  async function run(call) {
    setBusy(true)
    setError(null)
    const { error: err } = await call()
    setBusy(false)
    if (err) setError("That couldn't be saved. Check your connection and try again.")
    await onClockChange?.()
  }
  const arrive = () => run(() => supabase.rpc("clock_in", { p_patient: patient.id, p_shift: occurrence.shift.id, p_start: occurrence.start.toISOString(), p_end: occurrence.end.toISOString() }))
  const leave = () => setLeaving(true)
  // A tap by mistake can be taken back for two minutes (the database enforces the same limit).
  const undo = () => run(() => supabase.rpc("undo_clock_in", { p_attendance: open.id }))
  const canUndo = open && now - new Date(open.arrived_at) < 2 * 60000

  const primary ={ display: "flex", alignItems: "center", justifyContent: "center", gap: 7, flex: 1, padding: "13px 0", border: "none", borderRadius: 13, background: colors.hero, color: "#fff", fontWeight: 700, fontSize: 14.5, cursor: busy ? "default" : "pointer", opacity: busy ? 0.65 : 1, boxShadow: "0 4px 12px rgba(47,90,65,0.3)" }
  const outline = { display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "12px 16px", borderRadius: 13, background: "#fff", border: `1.5px solid ${colors.hero}`, color: colors.sageDeep, fontWeight: 700, fontSize: 14, cursor: "pointer" }

  return (
    <div style={{ background: "linear-gradient(#EAF2EA, #E3EDE3)", border: "1.5px solid #B9D3BF", borderRadius: 20, padding: 14, marginBottom: 12 }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, background: colors.hero, color: "#fff", fontSize: 12.5, fontWeight: 700, letterSpacing: 0.4, borderRadius: 999, padding: "4px 11px", marginBottom: 11 }}>
        <span style={{ width: 7, height: 7, borderRadius: 999, background: open ? "#8FE0A6" : "#F0C46A" }} /> {starting ? `SHIFT STARTS ${fmtClockTime(occurrence.start)}` : finished ? "YOU HAVE LEFT" : "WITH YOU TODAY"}
      </span>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span aria-hidden="true" style={{ width: 50, height: 50, borderRadius: 999, background: "#fff", color: colors.sageDeep, boxShadow: `0 0 0 3px ${colors.sage}`, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 15, flexShrink: 0 }}>{initials(patient.full_name)}</span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: "Fraunces, serif", fontSize: 19, fontWeight: 600, color: colors.ink }}>{patient.full_name}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 13, fontWeight: 600, color: colors.sageDeep, marginTop: 2 }}>
            <Clock size={14} /> {fmtClockTime(occurrence.start)} to {fmtClockTime(occurrence.end)}
          </div>
        </div>
      </div>

      {open && (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#fff", color: colors.sageDeep, fontSize: 13, fontWeight: 700, borderRadius: 999, padding: "5px 11px", marginTop: 10, boxShadow: "0 0 0 1px #B9D3BF" }}>
          <Check size={14} /> Arrived {fmtClockTime(new Date(open.arrived_at))}
        </span>
      )}
      {finished && (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#fff", color: colors.sageDeep, fontSize: 13, fontWeight: 700, borderRadius: 999, padding: "5px 11px", marginTop: 10, boxShadow: "0 0 0 1px #B9D3BF" }}>
          <Check size={14} /> Arrived {fmtClockTime(new Date(finished.arrived_at))}, left {fmtClockTime(new Date(finished.left_at))}
        </span>
      )}
      {canUndo && (
        <button onClick={undo} disabled={busy} style={{ marginLeft: 10, border: "none", background: "none", padding: 0, color: colors.sageDeep, fontWeight: 700, fontSize: 13, textDecoration: "underline", cursor: "pointer" }}>Undo</button>
      )}
      {open && !starting && (
        <>
          <div role="progressbar" aria-label="How much of the shift is done" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((done / total) * 100)}
            style={{ height: 6, background: "rgba(47,90,65,0.15)", borderRadius: 999, margin: "12px 0 4px", overflow: "hidden" }}>
            <div style={{ width: `${(done / total) * 100}%`, height: "100%", background: colors.sage, borderRadius: 999 }} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, color: colors.inkSoft }}>
            <span>{spanText(done)} done</span><span>{spanText(left)} left</span>
          </div>
        </>
      )}

      {leaving && open ? (
        <LeavePanel patient={patient} care={care} checkedIn={checkedIn} openId={open.id} userId={userId} onDone={async () => { setLeaving(false); await onClockChange?.() }} onCancel={() => setLeaving(false)} />
      ) : (
      <>
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        {finished ? (
          <button onClick={() => onOpen(patient.id)} style={primary}>Open {first} <ArrowRight size={16} /></button>
        ) : !open ? (
          <>
            <button onClick={arrive} disabled={busy} style={primary}><MapPin size={16} /> I've arrived</button>
            <button onClick={() => onOpen(patient.id)} style={outline}>Open {first}</button>
          </>
        ) : nearEnd && justArrived ? (
          <>
            <button onClick={() => onOpen(patient.id)} style={primary}>Open {first} <ArrowRight size={16} /></button>
            <button onClick={leave} disabled={busy} style={outline}>I'm leaving</button>
          </>
        ) : nearEnd ? (
          <>
            <button onClick={leave} disabled={busy} style={primary}><ArrowRight size={16} /> I'm leaving</button>
            <button onClick={() => onOpen(patient.id)} style={outline}>Open {first}</button>
          </>
        ) : (
          <button onClick={() => onOpen(patient.id)} style={primary}>Open {first} <ArrowRight size={16} /></button>
        )}
      </div>
      {!open && !finished && <div style={{ fontSize: 13, color: colors.inkSoft, marginTop: 9 }}>Let the team know you're here</div>}
      {finished && (
        <div style={{ fontSize: 13, color: colors.inkSoft, marginTop: 9 }}>
          Your shift here is recorded as finished.{" "}
          <button onClick={arrive} disabled={busy} style={{ border: "none", background: "none", padding: 0, color: colors.sageDeep, fontWeight: 700, fontSize: 13, textDecoration: "underline", cursor: "pointer" }}>Left by mistake? I'm still here</button>
        </div>
      )}
      {open && nearEnd && <div style={{ fontSize: 13, color: colors.inkSoft, marginTop: 9 }}>Tap when you hand over or finish</div>}
      {open && !nearEnd && !starting && (
        <button onClick={leave} disabled={busy} style={{ display: "block", margin: "0 auto", border: "none", background: "none", padding: "10px 12px", color: colors.sageDeep, fontWeight: 700, fontSize: 13, textDecoration: "underline", cursor: "pointer" }}>I'm leaving now</button>
      )}
      </>
      )}
      {error && <div style={{ fontSize: 13, color: colors.rust, marginTop: 8 }}>{error}</div>}
    </div>
  )
}

// Still clocked in after the shift ended (or for a patient with no shift now): one line and a button to close it.
function StillClockedIn({ patient, open, onClockChange, onOpen, care, checkedIn, userId }) {
  const [leaving, setLeaving] = useState(false)
  const busy = false
  const error = null
  const leave = () => setLeaving(true)
  if (leaving) {
    return (
      <div style={{ background: colors.card, borderRadius: 18, padding: "4px 14px 14px", marginBottom: 12, boxShadow: shadow }}>
        <LeavePanel patient={patient} care={care} checkedIn={checkedIn} openId={open.id} userId={userId} onDone={async () => { setLeaving(false); await onClockChange?.() }} onCancel={() => setLeaving(false)} />
      </div>
    )
  }
  return (
    <div style={{ background: colors.card, borderRadius: 18, padding: "13px 14px", marginBottom: 12, boxShadow: shadow, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
      <div style={{ flex: "1 1 180px", minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: colors.ink }}>Still clocked in with {patient.full_name.split(" ")[0]}</div>
        <div style={{ fontSize: 13, color: colors.inkSoft, marginTop: 2 }}>You arrived at {fmtClockTime(new Date(open.arrived_at))}. Mark that you're leaving when you finish.</div>
        {error && <div style={{ fontSize: 13, color: colors.rust, marginTop: 4 }}>{error}</div>}
      </div>
      <button onClick={leave} disabled={busy} style={{ padding: "10px 16px", border: "none", borderRadius: 12, background: colors.hero, color: "#fff", fontWeight: 700, fontSize: 13.5, cursor: busy ? "default" : "pointer", opacity: busy ? 0.65 : 1 }}>I'm leaving</button>
    </div>
  )
}

// One patient: an initials badge, the name, one line about their shift or day, and a label. Those who need attention say
// why in red. Where there are many patients, those doing well shrink to a slim row so the page stays calm.
function MemberCard({ row, attention, slim, subline, q, now, onOpen, familyLine }) {
  const { p, status, severe, appt, flags, care } = row
  const emergency = status.alert?.level === "emergency"
  const tasksLeft = care && care.tasksTotal > care.tasksDone
  const medsLeft = care && care.medsTotal > care.medsGiven
  const quiet = !row.checkinExpected // nobody is scheduled for this patient today, so nothing is due from the caregiver
  const due = flags.lateCheckin // a symptom check-in is expected, it is past noon and nobody has done it: an amber to-do, red only after 6 PM
  const allGood = !attention && !quiet && status.checkedInToday && !tasksLeft && !medsLeft
  const chip = attention
    ? { text: flags.severePending || emergency ? "Severe symptoms" : "Needs attention", bg: colors.rustTint, fg: "#7A2E1E" }
    : quiet ? { text: "No shift today", bg: colors.bg, fg: colors.inkSoft }
    : due ? { text: "Check-in due", bg: colors.goldTint, fg: "#6B4D0E" }
    : allGood ? { text: "All good", bg: colors.sageTint, fg: colors.sageDeep } : { text: "To do today", bg: colors.goldTint, fg: "#6B4D0E" }
  const avatar = attention ? [colors.rustTint, "#7A2E1E"] : quiet ? [colors.bg, colors.inkSoft] : due ? [colors.goldTint, "#6B4D0E"] : allGood ? [colors.sageTint, colors.sageDeep] : [colors.goldTint, "#6B4D0E"]

  const reasons = []
  if (flags.severePending) reasons.push("Severe symptoms, no action recorded")
  else if (status.alert) reasons.push(emergency ? "Severe symptoms" : "Steep change in symptoms")
  if (row.checkinExpected && !status.checkedInToday && (flags.lateCheckin || attention)) reasons.push("Check-in due")
  if (flags.incident) reasons.push(`${INCIDENT_LABEL[care.incident.kind] || "An incident"}${care.incident.injury ? " with injury" : ""}, ${ago(new Date(care.incident.happened_at), now)}`)
  if (flags.question) reasons.push(`${care.questions} ${care.questions === 1 ? "question" : "questions"} waiting`)

  return (
    <div
      role="button" tabIndex={0} className="patient-card"
      onClick={() => onOpen(p.id)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(p.id) } }}
      style={{ background: colors.card, borderRadius: slim ? 16 : 18, padding: slim ? "11px 14px" : "13px 14px", marginBottom: slim ? 9 : 11, cursor: "pointer", borderLeft: attention ? `5px solid ${colors.rust}` : "5px solid transparent", boxShadow: shadow }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span aria-hidden="true" style={{ width: slim ? 38 : 44, height: slim ? 38 : 44, borderRadius: 999, background: avatar[0], color: avatar[1], display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: slim ? 13 : 14, flexShrink: 0 }}>{initials(p.full_name)}</span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontFamily: "Fraunces, serif", fontSize: slim ? 16 : 17, fontWeight: 600, color: colors.ink }}><Highlight text={p.full_name} q={q} /></div>
          <div style={{ fontSize: 13, color: colors.inkFaint, marginTop: 1 }}>{subline}</div>
        </div>
        <span style={{ fontSize: 12.5, fontWeight: 700, padding: "3px 10px", borderRadius: 999, background: chip.bg, color: chip.fg, whiteSpace: "nowrap" }}>{chip.text}</span>
        <ChevronRight size={16} color={colors.inkFaint} style={{ flexShrink: 0 }} />
      </div>
      {!slim && attention && reasons.length > 0 && (
        <div style={{ fontSize: 13.5, color: colors.inkSoft, marginTop: 8, lineHeight: 1.45 }}>
          {reasons.map((r, i) => <span key={r}>{i > 0 && " · "}{i === 0 ? <strong style={{ color: colors.rust }}>{r}</strong> : r}</span>)}
        </div>
      )}
      {!slim && flags.apptSoon && appt && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: colors.inkSoft, marginTop: 8 }}>
          <CalendarDays size={13} color={colors.gold} /> {appointmentText(appt)}
        </div>
      )}
      {!slim && severe && <SevereActionLine severe={severe} isAdmin={false} now={now} />}
      {!slim && familyLine && <div style={{ fontSize: 13, color: colors.inkFaint, marginTop: 8 }}>{familyLine}</div>}
    </div>
  )
}

// The Home page for a caregiver or a family proxy. A caregiver also sees who they are on shift with; their full list of
// shifts is on the My shifts page. A family proxy has no shifts, so it is the same page without that part.
export default function MemberHome({ member, patients, loading, statusFor, nextAppointmentFor, teamFor, personName, severeFor, careFor, onOpen, myShifts, userId, onClockChange, training, onOpenTraining }) {
  const now = useNow()
  const [query, setQuery] = useState("")
  const isCaregiver = !!myShifts
  // A caregiver is only expected to do a patient's check-in when it is their own work today: they have a shift with that patient
  // today, or they have arrived there themselves (covering). Being assigned to a patient, or someone else arriving there, is not
  // enough: a caregiver working with one patient is not "behind" on the others. The only exception is a caregiver with no shifts
  // tracked at all, who keeps the old behaviour because nothing can be said about their day. The family view is unchanged.
  const checkinExpectedFor = isCaregiver && myShifts.length > 0
    ? (id) => {
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
        const mine = myShifts.filter((s) => s.patient_id === id)
        const ownArrival = (careFor(id)?.attendance || []).some((a) => a.caregiver_id === userId && new Date(a.arrived_at) >= startOfToday)
        return ownArrival || (mine.length > 0 && occurrences(mine, startOfToday, 1).length > 0)
      }
    : undefined
  const ctx = { statusFor, teamFor, severeFor, coverageFor: () => null, nextAppointmentFor, careFor, isAdmin: false, checkinExpectedFor }
  const rows = patients
    .map((p) => assess(p, ctx, now))
    .sort((a, b) => b.score - a.score || a.p.full_name.localeCompare(b.p.full_name))

  // A waiting question or a recent incident counts, even though the score alone wouldn't flag it.
  const needsLook = (r) => r.needsAttention || r.flags.question || r.flags.incident
  const attnAll = rows.filter(needsLook).length
  const q = query.trim().toLowerCase()
  // Matches the patient's name only: the same caregiver and family names appear on most patients, so including them would
  // return nearly everyone for any search.
  const shown = rows.filter((r) => !q || r.p.full_name.toLowerCase().includes(q))

  const running = isCaregiver ? shiftsOnNow(myShifts, now) : []
  const upcoming = isCaregiver ? occurrences(myShifts, now, 14).filter((o) => o.start > now) : []
  const whenText = (o) => { const label = dayLabel(o.start, now); return `${label === "Today" ? "today" : label} at ${fmtClockTime(o.start)}` }
  const heroIds = new Set(running.map((o) => o.shift.patient_id))
  const attendanceOf = (id) => rows.find((r) => r.p.id === id)?.care?.attendance || []
  const careOf = (id) => rows.find((r) => r.p.id === id)?.care || null
  const checkedInOf = (id) => !!rows.find((r) => r.p.id === id)?.status?.checkedInToday
  const longestRunning = Math.max(20 * 3600000, ...running.map((o) => o.end - o.start + 4 * 3600000))
  const openFor = (id) => attendanceOf(id).find((a) => a.caregiver_id === userId && !a.left_at && now - new Date(a.arrived_at) < longestRunning)
  // A shift that starts within half an hour (the same grace the database gives) can be arrived for early.
  const soon = upcoming.filter((o) => o.start - now <= 30 * 60000 && !heroIds.has(o.shift.patient_id))
  const soonIds = new Set(soon.map((o) => o.shift.patient_id))
  const stale = isCaregiver ? rows.filter((r) => !heroIds.has(r.p.id) && !soonIds.has(r.p.id) && openFor(r.p.id)) : []
  const shiftLine = (id) => {
    if (!isCaregiver) return null
    const mine = myShifts.filter((s) => s.patient_id === id)
    if (mine.length === 0) return null
    if (heroIds.has(id)) return "On your shift now"
    const next = upcoming.find((o) => o.shift.patient_id === id)
    return next ? `Next shift: ${whenText(next)}` : "No upcoming shift"
  }
  // Another caregiver who has arrived at this patient and not left yet (so this patient is theirs today, not yours).
  const withOther = (r) => {
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const a = (r.care?.attendance || []).find((x) => x.caregiver_id !== userId && !x.left_at && new Date(x.arrived_at) >= startOfToday)
    return a ? (personName(r.p.id, a.caregiver_id) || "another caregiver").split(" ")[0] : null
  }
  const summaryLine = (r) => {
    const care = r.care
    return [r.status.checkedInToday ? `Checked in${r.status.checkin?.at ? ` ${fmtClockTime(r.status.checkin.at)}` : ""}` : r.checkinExpected ? "Not checked in yet" : withOther(r) ? `With ${withOther(r)} now` : "Not on your schedule today",
      care && care.tasksTotal > 0 ? `Meals and tasks ${care.tasksDone}/${care.tasksTotal}` : null,
      care && care.medsTotal > 0 ? `Medications ${care.medsGiven}/${care.medsTotal}` : null].filter(Boolean).join(" · ")
  }

  // The patient you're with has their own card above the list, unless they need attention too: then they stay in the
  // list as well, so a problem is never hidden behind a tidy card.
  const listed = shown.filter((r) => q || !(heroIds.has(r.p.id) || soonIds.has(r.p.id)) || needsLook(r))
  const attnRows = listed.filter(needsLook)
  const okRows = listed.filter((r) => !needsLook(r))
  const slim = patients.length > 4
  const familyLine = (r) => (!isCaregiver && r.team.caregivers.length ? `Caregiver: ${r.team.caregivers.join(", ")}` : null)
  const card = (r, attention, isSlim) => (
    <MemberCard key={r.p.id} row={r} attention={attention} slim={isSlim} q={q} now={now} onOpen={onOpen}
      subline={shiftLine(r.p.id) || summaryLine(r)} familyLine={familyLine(r)} />
  )

  return (
    <div>
      <h1 style={{ fontFamily: "Fraunces, serif", fontSize: 25, fontWeight: 600, color: colors.ink, margin: "0 0 2px", display: "flex", alignItems: "center", gap: 10 }}>
        <Avatar userId={userId} name={member.first_name || "?"} size={38} fontSize={15} tone={[colors.sage, "#fff"]} />
        <span>Welcome, {member.first_name || "there"}</span>
      </h1>
      <p style={{ fontSize: 13, color: colors.inkFaint, margin: "0 0 14px" }}>{now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</p>

      {training && <TrainingHomeCard training={training} onOpen={onOpenTraining} />}

      {!loading && patients.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 9, background: "#fff", border: `1px solid ${query ? colors.sage : colors.hairline}`, borderRadius: 999, padding: "0 14px", marginBottom: 12, boxShadow: query ? "0 0 0 3px rgba(63,108,81,0.15)" : "0 1px 3px rgba(32,38,31,0.05)" }}>
          <Search size={16} color={colors.inkFaint} />
          <input
            value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search your patients" placeholder="Search your patients"
            style={{ flex: 1, minWidth: 0, border: "none", outline: "none", background: "transparent", padding: "12px 0", fontSize: 14.5, color: colors.ink, fontFamily: "inherit" }}
          />
          {query && (
            <button onClick={() => setQuery("")} aria-label="Clear search" style={{ border: "none", background: colors.hairline, borderRadius: 999, width: 22, height: 22, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", padding: 0, color: colors.inkSoft }}>
              <X size={13} />
            </button>
          )}
        </div>
      )}

      {!loading && patients.length > 0 && !q && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
          {running.length > 0 && <Pill icon={Clock} tone="green">{openFor(running[0].shift.patient_id) ? `On shift until ${fmtClockTime(running[0].end)}` : `Shift started ${fmtClockTime(running[0].start)}`}</Pill>}
          {running.length === 0 && upcoming[0] && <Pill icon={Clock} tone="plain">Next shift: {whenText(upcoming[0])}</Pill>}
          {attnAll > 0
            ? <Pill icon={AlertTriangle} tone="red">{attnAll} {attnAll === 1 ? "needs" : "need"} attention</Pill>
            : <Pill icon={CheckCircle2} tone="green">Everyone is doing well</Pill>}
        </div>
      )}

      {loading ? (
        <p style={{ fontSize: 13.5, color: colors.inkFaint }}>Loading...</p>
      ) : patients.length === 0 ? (
        <div style={{ background: colors.card, borderRadius: 18, padding: 26, textAlign: "center", boxShadow: shadow }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: colors.ink, marginBottom: 6 }}>No patients yet</div>
          <p style={{ fontSize: 13.5, color: colors.inkSoft, lineHeight: 1.55, margin: 0 }}>You haven't been assigned a patient yet. Ask your administrator to assign one to you.</p>
        </div>
      ) : (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", margin: "2px 3px 9px" }}>
            <h2 style={{ fontFamily: "Fraunces, serif", fontSize: 17, fontWeight: 600, color: colors.ink, margin: 0 }}>{q ? "Results" : "Your patients"}</h2>
            <span style={{ fontSize: 13, color: colors.inkFaint }}>{q ? `${shown.length} of ${patients.length}` : patients.length}</span>
          </div>
          {!q && running.map((o) => {
            const patient = patients.find((p) => p.id === o.shift.patient_id)
            return patient ? <WithYouToday key={o.shift.id + o.start.getTime()} occurrence={o} patient={patient} attendance={attendanceOf(patient.id)} userId={userId} onClockChange={onClockChange} now={now} onOpen={onOpen} care={careOf(patient.id)} checkedIn={checkedInOf(patient.id)} /> : null
          })}
          {!q && soon.map((o) => {
            const patient = patients.find((p) => p.id === o.shift.patient_id)
            return patient ? <WithYouToday key={"soon" + o.shift.id + o.start.getTime()} starting occurrence={o} patient={patient} attendance={attendanceOf(patient.id)} userId={userId} onClockChange={onClockChange} now={now} onOpen={onOpen} /> : null
          })}
          {!q && stale.map((r) => <StillClockedIn key={"stale" + r.p.id} patient={r.p} open={openFor(r.p.id)} onClockChange={onClockChange} onOpen={onOpen} care={r.care} checkedIn={r.status.checkedInToday} userId={userId} />)}
          {shown.length === 0 && <p style={{ fontSize: 13.5, color: colors.inkSoft }}>No patients match "{query.trim()}".</p>}
          {attnRows.map((r) => card(r, true, false))}
          {okRows.map((r) => card(r, false, slim))}
        </>
      )}
      {!q && <div style={{ marginTop: 16 }}><BirthdaysCard /></div>}
    </div>
  )
}
