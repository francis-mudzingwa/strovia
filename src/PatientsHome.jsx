import { useState, useEffect } from "react"
import { Plus, ChevronRight, CalendarDays, AlertTriangle, CheckCircle2, Clock, Users, Phone, Search, CalendarClock, SlidersHorizontal, ListChecks, UserCheck, Siren, HelpCircle, Pill, MessageSquare } from "lucide-react"
import { ageFromDob, telHref } from "./carePlan.js"
import { Avatar } from "./Avatar.jsx"
import BirthdaysCard from "./Birthdays.jsx"
import ReadingReminders from "./ReadingReminders.jsx"
import { whenLabel, fmtApptTime } from "./appointments.js"

const colors = {
  bg: "#FAF6EF", card: "#FFFFFF", hairline: "#E5DFD1", ink: "#20261F", inkSoft: "#5C6357", inkFaint: "#6B7266",
  sage: "#3F6C51", sageDeep: "#2C4E3A", sageTint: "#E3EBE0", gold: "#B98A2E", goldTint: "#F3E7CC",
  rust: "#A24632", rustTint: "#F3DAD2", teal: "#4C7A82", tealTint: "#E5EEEF",
}

export const fmtClockTime = (d) => d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
const fmtShortDate = (d) => d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })

export function ago(date, now) {
  const mins = Math.max(0, Math.round((now - date) / 60000))
  if (mins < 2) return "just now"
  if (mins < 60) return `${mins} minutes ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`
  const days = Math.floor(hours / 24)
  return `${days} ${days === 1 ? "day" : "days"} ago`
}

export function useNow() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60 * 1000)
    return () => clearInterval(t)
  }, [])
  return now
}

// "Appointment tomorrow with Dr. Smith on Mon, Sep 21 at 11:00 AM": says plainly that it is an appointment.
export function appointmentText(appt) {
  const start = new Date(appt.starts_at)
  const label = whenLabel(start)
  const lead = label === "Today" ? "Appointment today" : label === "Tomorrow" ? "Appointment tomorrow" : `Appointment ${label.toLowerCase()}`
  const who = appt.doctor ? ` with ${appt.doctor}` : ""
  const day = label === "Today" ? "" : ` on ${fmtShortDate(start)}`
  return `${lead}${who}${day} at ${fmtApptTime(start)}`
}

// Everything the cards and the summary need for one patient, plus a score that puts the patients who need
// attention first. Only an administrator sees coverage gaps and missing caregivers.
export function assess(p, ctx, now) {
  const { statusFor, teamFor, severeFor, coverageFor, nextAppointmentFor, careFor, isAdmin } = ctx
  const status = statusFor(p.id)
  const team = teamFor(p.id)
  const severe = severeFor(p.id)
  const cover = isAdmin ? coverageFor(p.id) : null
  const appt = nextAppointmentFor(p.id)
  const apptLabel = appt ? whenLabel(new Date(appt.starts_at), now) : null
  const care = careFor ? careFor(p.id) : null
  // Who is on duty right now, and whether each of them has tapped "I've arrived". Someone whose shift is running with no arrival
  // recorded is "starting" for the first 15 minutes and "late" after that. This applies to every caregiver who has a shift.
  const arrivalFor = (caregiverId, start) => (care?.attendance || [])
    .filter((a) => a.caregiver_id === caregiverId && new Date(a.arrived_at) >= new Date(start.getTime() - 2 * 3600000))
    .sort((a, b) => new Date(a.arrived_at) - new Date(b.arrived_at))[0] || null
  const onDuty = isAdmin && cover
    ? cover.on.map((o) => {
        const a = arrivalFor(o.caregiverId, o.start)
        const state = !care ? "unknown" : a ? "arrived" : now - o.start > 15 * 60000 ? "late" : "starting"
        return { ...o, arrivedAt: a ? new Date(a.arrived_at) : null, leftAt: a?.left_at ? new Date(a.left_at) : null, state }
      })
    : []
  const late = onDuty.filter((d) => d.state === "late")
  // The day's shifts for this patient, each marked as finished, running or still to come, and whether the person arrived.
  const todayShifts = isAdmin && cover?.today
    ? cover.today.map((s) => ({ ...s, arrived: care ? !!arrivalFor(s.caregiverId, s.start) : null }))
    : []
  const incidentRecent = !!care?.incident && now - new Date(care.incident.happened_at) < 24 * 3600000
  // Named, not generic: who was actually scheduled today and hasn't personally recorded today's check-in, and
  // whose shift ended with tasks still undone. Only when there is shift data to name someone from.
  const notCheckedIn = isAdmin && cover?.todayScheduled?.length
    ? cover.todayScheduled.filter((o) => !(status.checkedInToday && status.checkin?.by === o.caregiverId))
    : []
  const tasksLeftByEndedShift = isAdmin && care && cover?.todayScheduled?.length && care.tasksTotal > 0 && care.tasksDone < care.tasksTotal
    ? cover.todayScheduled.filter((o) => o.ended)
    : []
  // Is a symptom check-in expected today? Only when someone is scheduled for this patient today, or has already arrived. A patient
  // with nobody scheduled today is not "missing" a check-in. A patient with no shifts tracked at all keeps the old behaviour
  // (we cannot tell), and so does the family view. A caregiver's own Home passes `checkinExpectedFor` (their own shifts today).
  const arrivedToday = (care?.attendance || []).some((a) => new Date(a.arrived_at) >= new Date(now.getFullYear(), now.getMonth(), now.getDate()))
  const checkinExpected = ctx.checkinExpectedFor
    ? ctx.checkinExpectedFor(p.id, arrivedToday)
    : isAdmin && cover ? (cover.today.length > 0 || arrivedToday) : true
  const flags = {
    severePending: !!severe?.pending,
    noCaregiver: isAdmin && team.caregivers.length === 0,
    alert: !!status.alert,
    lateCheckin: checkinExpected && !status.checkedInToday && now.getHours() >= 12,
    noCover: !!cover && cover.on.length === 0,
    apptSoon: apptLabel === "Today" || apptLabel === "Tomorrow",
    noShow: late.length > 0,
    incident: incidentRecent,
    question: (care?.questions || 0) > 0,
  }
  const hoursOpen = flags.severePending && severe.at ? (now - severe.at) / 3600000 : 0
  let score = 0
  if (flags.severePending) score += 100 + Math.min(hoursOpen, 48)
  if (flags.noCaregiver) score += 50
  const handled = severe && !severe.pending // severe symptoms that already have an action recorded
  if (flags.alert) score += handled ? 15 : status.alert.level === "emergency" ? 40 : 30
  // A missing check-in is a to-do, not a patient problem: after noon it nudges the order (amber), and only from 6 PM does it count as "needs attention".
  if (flags.lateCheckin) score += now.getHours() >= 18 ? 25 : 10
  if (flags.noCover) score += 10 // often normal outside working hours, so it only nudges the order
  if (flags.apptSoon) score += 5
  if (flags.noShow) score += 40
  if (flags.incident) score += care.incident.injury || care.incident.kind === "fall" ? 35 : 22
  if (flags.question) score += 15
  return { p, status, team, severe, cover, appt, care, late, onDuty, todayShifts, notCheckedIn, tasksLeftByEndedShift, checkinExpected, flags, score, needsAttention: score >= 20 }
}

// One line: whether the patient was checked in today, and by whom and when. It gets more urgent as the day goes on.
// When we know who was actually scheduled today, name them instead of a generic "no check-in".
function CheckInLine({ status, byName, now, notCheckedIn, expected = true }) {
  const checkin = status.checkin
  const by = byName ? ` by ${byName}` : ""
  const time = checkin?.at ? ` at ${fmtClockTime(checkin.at)}` : ""
  if (status.checkedInToday) {
    return <Line icon={CheckCircle2} color={colors.sageDeep}><strong style={{ color: colors.sageDeep }}>Checked in today</strong>{time}{by}</Line>
  }
  const hour = now.getHours()
  const tone = hour >= 18 ? colors.rust : hour >= 12 ? colors.gold : colors.inkSoft
  if (notCheckedIn && notCheckedIn.length > 0) {
    const names = notCheckedIn.map((o) => o.name).join(" and ")
    const stillOn = notCheckedIn.some((o) => !o.ended)
    return (
      <Line icon={Clock} color={tone}>
        <strong style={{ color: tone }}>{names} {notCheckedIn.length > 1 ? "haven't" : "hasn't"} checked in today.</strong>{" "}
        {stillOn ? "Still on shift." : `Shift ended ${fmtClockTime(notCheckedIn[0].end)}.`}
      </Line>
    )
  }
  const last = checkin ? ` · last check-in ${fmtShortDate(checkin.date)}${time}${by}` : " · none in the last 2 weeks"
  // Nobody is scheduled for this patient today, so no check-in is due: say so quietly instead of raising an alarm.
  if (!expected) return <Line icon={Clock} color={colors.inkSoft}><strong style={{ color: colors.inkSoft }}>No check-in due today</strong> · nobody is scheduled{last}</Line>
  return <Line icon={Clock} color={tone}><strong style={{ color: tone }}>No check-in today</strong>{last}</Line>
}

function Line({ icon: Icon, color, children }) {
  return (
    <div style={{ display: "flex", gap: 7, alignItems: "flex-start", marginTop: 4 }}>
      <Icon size={14} color={color} style={{ marginTop: 3, flexShrink: 0 }} />
      <span>{children}</span>
    </div>
  )
}

// After a severe check-in in the last 3 days: what was done about it, or how long it has been waiting for an action.
export function SevereActionLine({ severe, isAdmin, now }) {
  const day = new Date(severe.date + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })
  if (severe.pending) {
    const hours = severe.at ? (now - severe.at) / 3600000 : 0
    const strong = hours >= 2
    const what = severe.symptoms?.length
      ? `${severe.symptoms.join(", ")} ${severe.symptoms.length > 1 ? "were" : "was"} severe ${severe.at ? ago(severe.at, now) : `on ${day}`}.`
      : `Severe symptoms ${severe.at ? ago(severe.at, now) : `on ${day}`}.`
    return (
      <div style={{ marginTop: 10, background: strong ? colors.rust : colors.rustTint, color: strong ? "#fff" : colors.rust, borderRadius: 10, padding: "8px 11px", fontSize: 13, fontWeight: 600, lineHeight: 1.5, display: "flex", gap: 7, alignItems: "flex-start" }}>
        <AlertTriangle size={14} style={{ marginTop: 2, flexShrink: 0 }} />
        <span>No action recorded yet. {what}{isAdmin ? "" : " Open the patient and note what was done."}</span>
      </div>
    )
  }
  const shown = severe.done.slice(-2)
  return (
    <div style={{ marginTop: 10, background: colors.sageTint, borderRadius: 10, padding: "8px 11px", fontSize: 13, color: colors.ink, lineHeight: 1.5 }}>
      <strong style={{ color: colors.sageDeep }}>Action taken for severe symptoms ({day})</strong>
      {shown.map((d, i) => (
        <div key={i} style={{ marginTop: 2 }}>
          {d.text}
          <span style={{ color: colors.inkSoft }}> · {d.by ? `${d.by}, ` : ""}{fmtClockTime(d.at)}</span>
        </div>
      ))}
      {severe.done.length > shown.length && <div style={{ color: colors.inkSoft, marginTop: 2 }}>and {severe.done.length - shown.length} earlier</div>}
    </div>
  )
}

export const INCIDENT_LABEL = { fall: "A fall", "missed medicine": "Missed medication", "refused medicine": "Refused medication", "choking or coughing at meals": "Choking or coughing", "skin problem": "A skin problem", other: "An incident" }

const fmtRange = (a, b) => `${fmtClockTime(a)} to ${fmtClockTime(b)}`

// The first thing an administrator needs on each card: who is on duty right now, by name, and whether they have arrived. A
// caregiver who has not tapped "I've arrived" is shown in red, not buried in a line of small print.
function DutyBlock({ row, now }) {
  const { p, cover, onDuty } = row
  const box = (tone) => ({
    ok: { bg: colors.sageTint, edge: colors.sage, fg: colors.sageDeep },
    late: { bg: colors.rustTint, edge: colors.rust, fg: "#7A2E1E" },
    soon: { bg: colors.goldTint, edge: colors.gold, fg: "#6B4D0E" },
    none: { bg: colors.bg, edge: colors.hairline, fg: colors.inkSoft },
  }[tone])
  const block = (tone, key, icon, title, detail, userId, who) => {
    const c = box(tone)
    return (
      <div key={key} style={{ display: "flex", gap: 9, alignItems: "flex-start", background: c.bg, borderLeft: `5px solid ${c.edge}`, borderRadius: 12, padding: "9px 12px", marginTop: 8 }}>
        {userId ? <Avatar userId={userId} name={who} size={30} fontSize={12} tone={["#fff", c.fg]} style={{ border: `2px solid ${c.edge}` }} /> : <span style={{ marginTop: 1, flexShrink: 0 }}>{icon}</span>}
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: c.fg, lineHeight: 1.35 }}>{title}</div>
          {detail && <div style={{ fontSize: 13, color: colors.inkSoft, marginTop: 1, lineHeight: 1.4 }}>{detail}</div>}
        </div>
      </div>
    )
  }
  if (!cover) return block("none", "noshifts", <CalendarClock size={16} color={colors.inkFaint} />, "No shifts set up", "Nobody is scheduled for this patient yet.")
  if (onDuty.length === 0) {
    return block("none", "nobody", <CalendarClock size={16} color={colors.inkFaint} />, "Nobody on duty now",
      cover.next ? `Next: ${cover.next.name}, ${fmtShortDate(cover.next.start)} at ${fmtClockTime(cover.next.start)}` : "No shift coming up in the next two weeks")
  }
  return onDuty.map((d) => {
    const hours = fmtRange(d.start, d.until)
    if (d.state === "late") {
      return block("late", d.caregiverId, <AlertTriangle size={16} color={colors.rust} />, `${d.name} has NOT arrived`,
        `Shift ${hours} started ${ago(d.start, now)}. Nobody has tapped "I've arrived".`, d.caregiverId, d.name)
    }
    if (d.state === "starting") {
      return block("soon", d.caregiverId, <Clock size={16} color={colors.gold} />, `${d.name} has not arrived yet`, `Shift ${hours} started ${ago(d.start, now)}.`, d.caregiverId, d.name)
    }
    return block("ok", d.caregiverId, <UserCheck size={16} color={colors.sageDeep} />, `${d.name} is on duty`,
      d.state === "arrived" ? `${hours} · Arrived ${fmtClockTime(d.arrivedAt)}${d.leftAt ? ` · Left ${fmtClockTime(d.leftAt)}` : ""}` : `${hours}`, d.caregiverId, d.name)
  })
}

// Every shift for this patient today as small tags: finished, running now, or later today.
function TodayShifts({ shifts, now }) {
  if (!shifts.length) return null
  const sorted = [...shifts].sort((a, b) => a.start - b.start)
  return (
    <div style={{ marginTop: 9 }}>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: colors.inkFaint, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 5 }}>Shifts today</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {sorted.map((s, i) => {
          const done = s.end <= now
          const running = !done && s.start <= now
          const missed = (done || running) && s.arrived === false
          const [bg, fg] = missed ? [colors.goldTint, "#6B4D0E"] : running ? [colors.sageTint, colors.sageDeep] : done ? ["#EFEBE0", colors.inkSoft] : [colors.tealTint, "#2F5A62"]
          const state = running ? (missed ? "not arrived" : "now") : done ? (missed ? "no arrival recorded" : "finished") : "later"
          return (
            <span key={`${s.caregiverId}${i}`} style={{ fontSize: 12.5, fontWeight: 600, borderRadius: 999, padding: "3px 10px", background: bg, color: fg }}>
              {s.name} {fmtRange(s.start, s.end)} · {state}
            </span>
          )
        })}
      </div>
    </div>
  )
}

// The administrator's view of the day at a glance: for every patient, who is on duty and whether they have arrived.
function OnDutyBoard({ rows, now, onOpen }) {
  const rank = (r) => (r.late.length ? 0 : r.onDuty.some((d) => d.state === "starting") ? 1 : r.onDuty.length ? 2 : r.cover ? 3 : 4)
  const sorted = [...rows].sort((a, b) => rank(a) - rank(b) || a.p.full_name.localeCompare(b.p.full_name))
  const onDutyCount = rows.filter((r) => r.onDuty.length).length
  const notArrived = rows.filter((r) => r.onDuty.some((d) => d.state === "late" || d.state === "starting")).length
  const nobody = rows.filter((r) => !r.onDuty.length).length
  const pillStyle = (bg, fg) => ({ fontSize: 12.5, fontWeight: 700, borderRadius: 999, padding: "3px 10px", background: bg, color: fg, whiteSpace: "nowrap" })
  return (
    <div style={{ background: colors.card, borderRadius: 18, padding: "14px 16px", marginBottom: 16, boxShadow: "0 1px 3px rgba(32,38,31,0.06), 0 6px 16px rgba(32,38,31,0.05)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
        <div style={{ fontFamily: "Fraunces, serif", fontSize: 18, fontWeight: 600, color: colors.ink }}>On duty now</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <span style={pillStyle(colors.sageTint, colors.sageDeep)}>{onDutyCount} {onDutyCount === 1 ? "patient has" : "patients have"} a caregiver</span>
          {notArrived > 0 && <span style={pillStyle(colors.rustTint, "#7A2E1E")}>{notArrived} not arrived</span>}
          {nobody > 0 && <span style={pillStyle("#EFEBE0", colors.inkSoft)}>{nobody} with nobody</span>}
        </div>
      </div>
      {sorted.map((r, i) => {
        const bad = r.onDuty.filter((d) => d.state === "late")
        const wait = r.onDuty.filter((d) => d.state === "starting")
        const good = r.onDuty.filter((d) => d.state === "arrived" || d.state === "unknown")
        return (
          <button key={r.p.id} type="button" onClick={() => onOpen(r.p.id)}
            style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, width: "100%", textAlign: "left", background: "none", border: "none", borderTop: i ? `1px solid ${colors.hairline}` : "none", padding: "9px 0", cursor: "pointer", font: "inherit" }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: colors.ink, minWidth: 0 }}>{r.p.full_name}</span>
            <span style={{ textAlign: "right", fontSize: 13, lineHeight: 1.4, minWidth: 0 }}>
              {bad.map((d) => <span key={d.caregiverId} style={{ display: "block", color: colors.rust, fontWeight: 700 }}>{d.name}: NOT ARRIVED (due {fmtClockTime(d.start)})</span>)}
              {wait.map((d) => <span key={d.caregiverId} style={{ display: "block", color: "#6B4D0E", fontWeight: 700 }}>{d.name}: not arrived yet (due {fmtClockTime(d.start)})</span>)}
              {good.map((d) => <span key={d.caregiverId} style={{ display: "block", color: colors.sageDeep, fontWeight: 600 }}>{d.name}{d.arrivedAt ? `, arrived ${fmtClockTime(d.arrivedAt)}` : ""} until {fmtClockTime(d.until)}</span>)}
              {!r.onDuty.length && (
                <span style={{ display: "block", color: colors.inkSoft }}>
                  {r.cover ? (r.cover.next ? `Nobody now. Next: ${r.cover.next.name}, ${fmtShortDate(r.cover.next.start)} ${fmtClockTime(r.cover.next.start)}` : "Nobody now, no shift coming up") : "No shifts set up"}
                </span>
              )}
            </span>
          </button>
        )
      })}
    </div>
  )
}

function PatientCard({ row, isAdmin, now, personName, callTargetFor, onOpen, onMessage }) {
  const { p, status, team, severe, cover, appt, flags, care, late, notCheckedIn, tasksLeftByEndedShift } = row
  const emergency = status.alert?.level === "emergency"
  const age = ageFromDob(p.profile?.dob)
  const meta = [age !== null ? `${age} yrs` : null, p.profile?.strokeType && p.profile.strokeType !== "Not sure" ? `${p.profile.strokeType} stroke` : null].filter(Boolean).join(" · ")
  const handled = severe && !severe.pending
  const call = isAdmin && (flags.severePending || (flags.alert && !handled) || (flags.lateCheckin && now.getHours() >= 18) || flags.noShow) ? callTargetFor(p.id) : null
  const chip = { display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12.5, fontWeight: 700, padding: "3px 10px", borderRadius: 999 }
  // The plain reasons behind the call button, so it never appears without saying why.
  const callReasons = []
  if (call) {
    if (flags.severePending) callReasons.push("Severe symptoms were recorded and nobody has noted what was done about them.")
    else if (flags.alert && !handled) callReasons.push(`There is a warning on this patient that has not been dealt with${status.alert?.reasons?.[0] ? `: ${status.alert.reasons[0]}` : "."}`)
    for (const d of row.onDuty.filter((x) => x.state === "late" || x.state === "starting")) {
      callReasons.push(`${d.name} has not arrived for the shift that started at ${fmtClockTime(d.start)} (nobody has tapped "I've arrived").`)
    }
    if (flags.lateCheckin) {
      const who = notCheckedIn.length ? ` ${notCheckedIn.map((o) => o.name).join(" and ")} ${notCheckedIn.length > 1 ? "were" : "was"} scheduled today and ${notCheckedIn.length > 1 ? "have" : "has"} not recorded one.` : ""
      callReasons.push(`No symptom check-in has been recorded today, and it is past noon.${who}`)
    }
  }
  const names = (list) => list.join(", ")

  return (
    <div
      role="button" tabIndex={0}
      className="patient-card"
      onClick={() => onOpen(p.id)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(p.id) } }}
      style={{ display: "block", textAlign: "left", background: colors.card, border: status.alert ? `1.5px solid ${emergency ? colors.rust : colors.gold}` : "none", borderRadius: 18, padding: 16, marginBottom: 12, cursor: "pointer", boxShadow: "0 1px 3px rgba(32,38,31,0.06), 0 6px 16px rgba(32,38,31,0.05)" }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: "Fraunces, serif", fontSize: 19, fontWeight: 600, color: colors.ink }}>{p.full_name}</div>
          {meta && <div style={{ fontSize: 13, color: colors.inkFaint, marginTop: 2 }}>{meta}</div>}
        </div>
        <ChevronRight size={20} color={colors.sageDeep} style={{ flexShrink: 0 }} />
      </div>

      {isAdmin && <DutyBlock row={row} now={now} />}
      {isAdmin && <TodayShifts shifts={row.todayShifts} now={now} />}

      {(status.alert || appt) && (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginTop: 12 }}>
          {status.alert && (
            <span style={{ ...chip, color: "#fff", background: emergency ? colors.rust : colors.gold }}>
              <AlertTriangle size={12} /> {emergency ? "Severe symptoms" : "Steep change"}
            </span>
          )}
          {appt && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: colors.inkSoft }}>
              <CalendarDays size={14} color={colors.gold} /> {appointmentText(appt)}
            </span>
          )}
        </div>
      )}

      <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${colors.hairline}`, fontSize: 13, color: colors.inkSoft, lineHeight: 1.55 }}>
        <Line icon={Users} color={colors.sageDeep}>
          <strong style={{ color: colors.ink }}>Caregiver:</strong>{" "}
          {team.caregivers.length
            ? team.caregivers.map((n) => (team.primary === n && team.caregivers.length > 1 ? `${n} (primary)` : n)).join(", ")
            : <span style={{ color: "#7A5A12", fontWeight: 600 }}>none assigned</span>}
          {team.relatives.length > 0 && <><span style={{ color: colors.inkFaint }}> · </span><strong style={{ color: colors.ink }}>Family proxy:</strong> {names(team.relatives)}</>}
        </Line>
        <CheckInLine status={status} byName={status.checkin ? personName(p.id, status.checkin.by) : null} now={now} notCheckedIn={notCheckedIn} expected={row.checkinExpected} />
      </div>

      {care && (
        <div style={{ marginTop: 6, fontSize: 13, color: colors.inkSoft, lineHeight: 1.55 }}>
          {care && care.tasksTotal > 0 && (
            <Line icon={ListChecks} color={care.tasksDone === care.tasksTotal ? colors.sageDeep : tasksLeftByEndedShift.length ? colors.rust : colors.inkSoft}>
              Meals and tasks today: {care.tasksDone} of {care.tasksTotal} done
              {tasksLeftByEndedShift.length > 0 && (
                <> — <strong style={{ color: colors.rust }}>{tasksLeftByEndedShift.map((o) => o.name).join(" and ")}</strong> finished {tasksLeftByEndedShift.length > 1 ? "their" : "their"} shift without completing them.</>
              )}
            </Line>
          )}
          {care && care.medsTotal > 0 && (
            <Line icon={Pill} color={care.medsGiven === care.medsTotal ? colors.sageDeep : colors.inkSoft}>
              Medications today: {care.medsGiven} of {care.medsTotal} given
            </Line>
          )}
          {flags.incident && (
            <Line icon={Siren} color={colors.rust}>
              <strong style={{ color: colors.rust }}>{INCIDENT_LABEL[care.incident.kind] || "An incident"}{care.incident.injury ? " with injury" : ""}</strong> reported {ago(new Date(care.incident.happened_at), now)}
            </Line>
          )}
          {flags.question && (
            <Line icon={HelpCircle} color={colors.gold}>
              <strong style={{ color: "#7A5A12" }}>{care.questions} {care.questions === 1 ? "question is" : "questions are"} waiting</strong> for an answer
            </Line>
          )}
        </div>
      )}

      {severe && <SevereActionLine severe={severe} isAdmin={isAdmin} now={now} />}

      {call && (
        <div onClick={(e) => e.stopPropagation()} style={{ marginTop: 10, background: colors.bg, borderRadius: 12, padding: "10px 12px" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: colors.ink, marginBottom: 4 }}>Why you are asked to call {call.name.split(" ")[0]}</div>
          <ul style={{ margin: "0 0 6px", paddingLeft: 18, fontSize: 13, color: colors.inkSoft, lineHeight: 1.5 }}>
            {callReasons.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
          <div style={{ fontSize: 12.5, color: colors.inkFaint, marginBottom: 8, lineHeight: 1.4 }}>
            {call.name} is {call.onShift ? "the caregiver on shift for this patient now" : "the first caregiver with a phone number for this patient (nobody is on shift now)"}, so that is the person to ask.
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <a
              href={telHref(call.phone)}
              style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "8px 14px", borderRadius: 10, background: colors.sage, color: "#fff", fontSize: 13, fontWeight: 700, textDecoration: "none" }}
            >
              <Phone size={14} /> Call {call.name}
            </a>
            {onMessage && call.userId && (
              <button
                onClick={() => onMessage(call.userId)}
                style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 12px", borderRadius: 10, border: `1px solid ${colors.hairline}`, background: "#fff", color: colors.sageDeep, fontSize: 13, fontWeight: 700, cursor: "pointer" }}
              >
                <MessageSquare size={14} /> Message
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// A count that doubles as a shortcut: tapping it filters the list to those patients.
function Tile({ label, hint, n, tone, icon: Icon, active, onClick }) {
  const palette = { red: [colors.rust, colors.rustTint], amber: ["#7A5A12", colors.goldTint], info: [colors.teal, colors.tealTint] }
  const [fg, bg] = n === 0 || !palette[tone] ? [colors.sageDeep, colors.sageTint] : palette[tone]
  return (
    <button type="button" onClick={onClick} title={hint} aria-pressed={!!active} className="stat-tile"
      style={{ textAlign: "left", background: bg, borderRadius: 14, padding: "12px", border: active ? `2px solid ${fg}` : "2px solid transparent", cursor: "pointer", font: "inherit", display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
        <div style={{ fontFamily: "Fraunces, serif", fontSize: 24, fontWeight: 600, color: fg, lineHeight: 1 }}>{n}</div>
        {Icon && (
          <div style={{ width: 26, height: 26, borderRadius: 999, background: "rgba(255,255,255,0.65)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Icon size={14} color={fg} />
          </div>
        )}
      </div>
      <div style={{ fontSize: 13, fontWeight: 600, color: fg }}>{label}</div>
    </button>
  )
}

/* ---------------- search and filters ---------------- */

const STATUS_OPTIONS = [
  ["all", "Any"], ["attention", "Needs attention"], ["severe", "Severe, no action recorded"], ["checked", "Checked in today"],
  ["nocheckin", "No check-in today"], ["nocaregiver", "No caregiver"], ["onshift", "On shift now"], ["noshift", "Not on shift now"], ["noshow", "Caregiver not arrived"],
  ["appt", "Appointment today or tomorrow"],
]
const STROKE_OPTIONS = [["any", "Any type"], ["Ischemic", "Ischemic"], ["Hemorrhagic", "Hemorrhagic"], ["TIA (mini-stroke)", "TIA (mini-stroke)"], ["none", "Not recorded"]]
const PHASE_OPTIONS = [["any", "Any time"], ["lt4", "Under 4 weeks ago"], ["m13", "1 to 3 months ago"], ["gt3", "More than 3 months ago"], ["none", "Date not recorded"]]
const AGE_OPTIONS = [["any", "Any age"], ["lt65", "Under 65"], ["65", "65 to 79"], ["80", "80 and over"]]
const FAMILY_OPTIONS = [["any", "Any"], ["has", "Has a family proxy"], ["none", "No family proxy"]]
const NO_FILTERS = { status: "all", caregiver: "any", family: "any", stroke: "any", phase: "any", age: "any" }

function matchesStatus(r, s) {
  switch (s) {
    case "attention": return r.needsAttention
    case "severe": return r.flags.severePending
    case "checked": return r.status.checkedInToday
    case "nocheckin": return r.checkinExpected && !r.status.checkedInToday
    case "nocaregiver": return r.flags.noCaregiver
    case "onshift": return !!r.cover && r.cover.on.length > 0
    case "noshift": return r.flags.noCover
    case "noshow": return r.onDuty.some((d) => d.state === "late" || d.state === "starting")
    case "appt": return r.flags.apptSoon
    default: return true
  }
}

function matchesFilters(r, f, now) {
  const profile = r.p.profile || {}
  if (!matchesStatus(r, f.status)) return false
  if (f.caregiver === "none" && r.team.caregivers.length) return false
  if (f.caregiver !== "any" && f.caregiver !== "none" && !r.team.caregivers.includes(f.caregiver)) return false
  if (f.family === "has" && !r.team.relatives.length) return false
  if (f.family === "none" && r.team.relatives.length) return false
  if (f.stroke !== "any") {
    const type = !profile.strokeType || profile.strokeType === "Not sure" ? "none" : profile.strokeType
    if (type !== f.stroke) return false
  }
  if (f.phase !== "any") {
    const date = profile.strokeDate ? new Date(profile.strokeDate + "T00:00:00") : null
    const weeks = date ? (now - date) / (7 * 86400000) : null
    if (f.phase === "none" ? weeks !== null : weeks === null) return false
    if (f.phase === "lt4" && !(weeks < 4)) return false
    if (f.phase === "m13" && !(weeks >= 4 && weeks < 13)) return false
    if (f.phase === "gt3" && !(weeks >= 13)) return false
  }
  if (f.age !== "any") {
    const age = ageFromDob(profile.dob)
    if (age === null) return false
    if (f.age === "lt65" && !(age < 65)) return false
    if (f.age === "65" && !(age >= 65 && age < 80)) return false
    if (f.age === "80" && !(age >= 80)) return false
  }
  return true
}

function FilterSelect({ label, value, onChange, options }) {
  return (
    <label style={{ display: "block", minWidth: 0 }}>
      <span style={{ display: "block", fontSize: 13, fontWeight: 700, color: colors.inkSoft, marginBottom: 4 }}>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} style={{ width: "100%", padding: "9px 10px", borderRadius: 10, border: `1px solid ${colors.hairline}`, fontSize: 13.5, background: "#fff", color: colors.ink, fontFamily: "inherit" }}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  )
}

// The Home page: everyone sees the patients they may open (admin: all of them, caregivers and family: only
// the ones assigned to them). Patients who need attention come first. Only the administrator can add a patient.
export default function PatientsHome({
  member, patients, statusFor, nextAppointmentFor, teamFor, personName, severeFor, coverageFor, callTargetFor, careFor,
  isAdmin, pending, loading, onOpen, onAddPatient, onOpenManage, userId, onMessage,
}) {
  const now = useNow()
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState("")
  const [dob, setDob] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [filters, setFilters] = useState(NO_FILTERS)
  const [panelOpen, setPanelOpen] = useState(false)
  const [query, setQuery] = useState("")
  const setFilter = (key) => (value) => setFilters((f) => ({ ...f, [key]: value }))
  const setStatus = (value) => setFilters((f) => ({ ...f, status: f.status === value ? "all" : value }))

  async function add(e) {
    e.preventDefault()
    if (!name.trim()) return
    setBusy(true)
    setError(null)
    const message = await onAddPatient(name.trim(), dob)
    setBusy(false)
    if (message) { setError(message); return }
    setName("")
    setDob("")
    setAdding(false)
  }

  const ctx = { statusFor, teamFor, severeFor, coverageFor, nextAppointmentFor, careFor, isAdmin }
  const rows = patients
    .map((p) => assess(p, ctx, now))
    .sort((a, b) => b.score - a.score || a.p.full_name.localeCompare(b.p.full_name))
  const count = (test) => rows.filter(test).length
  const needAttention = count((r) => r.needsAttention)
  const noCaregiver = count((r) => r.flags.noCaregiver)
  const q = query.trim().toLowerCase()
  const searchText = (r) => [r.p.full_name, ...r.team.caregivers, ...r.team.relatives, r.p.profile?.careProvider].filter(Boolean).join(" ").toLowerCase()
  const shown = rows.filter((r) => matchesFilters(r, filters, now) && (!q || searchText(r).includes(q)))
  const caregiverNames = [...new Set(rows.flatMap((r) => r.team.caregivers))].sort((a, b) => a.localeCompare(b))
  const activeCount = Object.keys(NO_FILTERS).filter((k) => filters[k] !== NO_FILTERS[k]).length
  const anythingActive = activeCount > 0 || !!q
  const clearAll = () => { setFilters(NO_FILTERS); setQuery("") }
  const pill = (active) => ({ padding: "6px 13px", borderRadius: 999, border: `1px solid ${colors.hairline}`, cursor: "pointer", fontSize: 13, fontWeight: 600, background: active ? colors.sage : "#fff", color: active ? "#fff" : colors.inkSoft })
  const showControls = !loading && patients.length > 0 && (isAdmin || patients.length >= 8)

  const welcome = (
    <>
      <h1 style={{ fontFamily: "Fraunces, serif", fontSize: 24, fontWeight: 600, color: colors.ink, margin: "0 0 2px", display: "flex", alignItems: "center", gap: 10 }}>
        <Avatar userId={userId} name={member.first_name || "?"} size={38} fontSize={15} tone={[colors.sage, "#fff"]} />
        <span>Welcome, {member.first_name || "there"}</span>
      </h1>
      <p style={{ fontSize: 13, color: colors.inkFaint, margin: "0 0 16px" }}>
        {now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
      </p>
    </>
  )
  return (
    <div>
      {welcome}

      {isAdmin && pending > 0 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", background: colors.goldTint, border: `1px solid ${colors.gold}`, borderRadius: 12, padding: "10px 14px", marginBottom: 14 }}>
          <span style={{ fontSize: 13.5, fontWeight: 700, color: colors.ink }}>
            {pending} {pending === 1 ? "account is" : "accounts are"} waiting for your approval
          </span>
          <button onClick={onOpenManage} style={{ border: "none", background: colors.gold, color: "#fff", borderRadius: 9, padding: "7px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Review</button>
        </div>
      )}

      {isAdmin && !loading && patients.length > 0 && <OnDutyBoard rows={rows} now={now} onOpen={onOpen} />}
      {isAdmin && !loading && patients.length > 0 && <ReadingReminders patients={patients} onOpen={onOpen} />}
      {isAdmin && <BirthdaysCard isAdmin />}

      {isAdmin && patients.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10, marginBottom: 16 }}>
          <Tile label="Severe, no action" n={count((r) => r.flags.severePending)} tone="red" icon={AlertTriangle} active={filters.status === "severe"} onClick={() => setStatus("severe")} hint="Severe symptoms recorded and nobody has noted what was done. Tap to filter" />
          <Tile label="Not arrived" n={count((r) => r.onDuty.some((d) => d.state === "late" || d.state === "starting"))} tone="red" icon={AlertTriangle} active={filters.status === "noshow"} onClick={() => setStatus("noshow")} hint="A caregiver whose shift has started but who has not tapped I've arrived. Tap to filter" />
          <Tile label="No check-in yet" n={count((r) => r.checkinExpected && !r.status.checkedInToday)} tone={now.getHours() >= 12 ? "amber" : "info"} icon={Clock} active={filters.status === "nocheckin"} onClick={() => setStatus("nocheckin")} hint="Patients with someone scheduled today and no check-in yet. Tap to filter" />
          <Tile label="No caregiver" n={count((r) => r.flags.noCaregiver)} tone="amber" icon={Users} active={filters.status === "nocaregiver"} onClick={() => setStatus("nocaregiver")} hint="Patients with no caregiver assigned. Tap to filter" />
          <Tile label="Not on shift now" n={count((r) => r.flags.noCover)} tone="info" icon={CalendarClock} active={filters.status === "noshift"} onClick={() => setStatus("noshift")} hint="Patients with shifts set, but no one on shift right now. Often normal outside working hours. Tap to filter" />
          <Tile label="Appointments soon" n={count((r) => r.flags.apptSoon)} tone="info" icon={CalendarDays} active={filters.status === "appt"} onClick={() => setStatus("appt")} hint="Appointments today or tomorrow. Tap to filter" />
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: colors.inkSoft, textTransform: "uppercase", letterSpacing: 0.5 }}>Patients ({patients.length})</div>
        {isAdmin && !adding && (
          <button onClick={() => setAdding(true)} style={{ padding: "9px 15px", borderRadius: 10, border: "none", background: colors.sage, color: "#fff", fontSize: 13.5, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
            <Plus size={15} /> Add patient
          </button>
        )}
      </div>

      {adding && (
        <form onSubmit={add} style={{ background: colors.card, borderRadius: 16, padding: 16, marginBottom: 14, boxShadow: "0 1px 3px rgba(32,38,31,0.06), 0 6px 16px rgba(32,38,31,0.05)" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: colors.ink, marginBottom: 10 }}>New patient</div>
          <input autoFocus required value={name} onChange={(e) => setName(e.target.value)} placeholder="Patient's full name" style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: `1px solid ${colors.hairline}`, fontSize: 14, boxSizing: "border-box", marginBottom: 8 }} />
          <label style={{ fontSize: 13, color: colors.inkFaint, display: "block", marginBottom: 4 }}>Date of birth (optional)</label>
          <input type="date" value={dob} onChange={(e) => setDob(e.target.value)} style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: `1px solid ${colors.hairline}`, fontSize: 14, boxSizing: "border-box", marginBottom: 12 }} />
          <div style={{ display: "flex", gap: 8 }}>
            <button type="submit" disabled={busy || !name.trim()} style={{ flex: 1, padding: "11px 0", borderRadius: 10, border: "none", background: colors.sage, color: "#fff", fontSize: 14, fontWeight: 700, cursor: busy ? "default" : "pointer", opacity: busy || !name.trim() ? 0.7 : 1 }}>
              {busy ? "Adding..." : "Add patient"}
            </button>
            <button type="button" onClick={() => { setAdding(false); setError(null) }} style={{ padding: "11px 16px", borderRadius: 10, border: `1px solid ${colors.hairline}`, background: "#fff", color: colors.inkSoft, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Cancel</button>
          </div>
          {error && <p style={{ color: colors.rust, fontSize: 13, margin: "10px 0 0" }}>{error}</p>}
        </form>
      )}

      {showControls && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
            <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
              <Search size={14} color={colors.inkFaint} style={{ position: "absolute", left: 12, top: 12 }} />
              <input
                value={query} onChange={(e) => setQuery(e.target.value)}
                placeholder={isAdmin ? "Search name, caregiver, family or doctor" : "Search patients"}
                style={{ width: "100%", boxSizing: "border-box", padding: "9px 12px 9px 34px", borderRadius: 999, border: `1px solid ${colors.hairline}`, fontSize: 13.5 }}
              />
            </div>
            {isAdmin && (
              <button onClick={() => setPanelOpen((o) => !o)} aria-expanded={panelOpen}
                style={{ ...pill(panelOpen || activeCount > 0), display: "inline-flex", alignItems: "center", gap: 6, flexShrink: 0, padding: "9px 14px" }}>
                <SlidersHorizontal size={14} /> Filters{activeCount > 0 ? ` (${activeCount})` : ""}
              </button>
            )}
          </div>

          {isAdmin && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button onClick={() => setFilter("status")("all")} style={pill(filters.status === "all")}>All ({patients.length})</button>
              <button onClick={() => setFilter("status")("attention")} style={pill(filters.status === "attention")}>Needs attention ({needAttention})</button>
              <button onClick={() => setFilter("status")("nocaregiver")} style={pill(filters.status === "nocaregiver")}>No caregiver ({noCaregiver})</button>
            </div>
          )}

          {isAdmin && panelOpen && (
            <div style={{ background: colors.card, borderRadius: 16, padding: 14, marginTop: 10, boxShadow: "0 1px 3px rgba(32,38,31,0.06), 0 6px 16px rgba(32,38,31,0.05)" }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12 }}>
                <FilterSelect label="Status" value={filters.status} onChange={setFilter("status")} options={STATUS_OPTIONS} />
                <FilterSelect label="Caregiver" value={filters.caregiver} onChange={setFilter("caregiver")}
                  options={[["any", "Any caregiver"], ["none", "No caregiver assigned"], ...caregiverNames.map((n) => [n, n])]} />
                <FilterSelect label="Family proxy" value={filters.family} onChange={setFilter("family")} options={FAMILY_OPTIONS} />
                <FilterSelect label="Stroke type" value={filters.stroke} onChange={setFilter("stroke")} options={STROKE_OPTIONS} />
                <FilterSelect label="Stroke happened" value={filters.phase} onChange={setFilter("phase")} options={PHASE_OPTIONS} />
                <FilterSelect label="Age" value={filters.age} onChange={setFilter("age")} options={AGE_OPTIONS} />
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
                <button onClick={clearAll} disabled={!anythingActive} style={{ border: "none", background: "transparent", color: anythingActive ? colors.rust : colors.inkFaint, fontSize: 13, fontWeight: 700, cursor: anythingActive ? "pointer" : "default" }}>
                  Clear filters
                </button>
              </div>
            </div>
          )}

          {anythingActive && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8, fontSize: 13, color: colors.inkSoft }}>
              <span>Showing {shown.length} of {patients.length} patients</span>
              <button onClick={clearAll} style={{ border: "none", background: "transparent", color: colors.rust, fontSize: 13, fontWeight: 700, cursor: "pointer", padding: 0 }}>Clear</button>
            </div>
          )}
        </div>
      )}

      {loading ? (
        <p style={{ fontSize: 13.5, color: colors.inkFaint }}>Loading...</p>
      ) : patients.length === 0 ? (
        <div style={{ background: colors.card, borderRadius: 18, padding: 26, textAlign: "center", boxShadow: "0 1px 3px rgba(32,38,31,0.06), 0 6px 16px rgba(32,38,31,0.05)" }}>
          <Users size={30} color={colors.sageDeep} style={{ marginBottom: 10 }} />
          <div style={{ fontSize: 15, fontWeight: 700, color: colors.ink, marginBottom: 6 }}>No patients yet</div>
          <p style={{ fontSize: 13.5, color: colors.inkSoft, lineHeight: 1.55, margin: isAdmin ? "0 0 14px" : 0 }}>
            {isAdmin
              ? "Add a patient above, then assign them to a caregiver in Manage Accounts."
              : "You haven't been assigned a patient yet. Ask your administrator to assign one to you."}
          </p>
          {isAdmin && (
            <button onClick={onOpenManage} style={{ padding: "11px 20px", borderRadius: 10, border: "none", background: colors.sage, color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
              Open Manage Accounts
            </button>
          )}
        </div>
      ) : shown.length === 0 ? (
        <div style={{ fontSize: 13.5, color: colors.inkSoft }}>
          {filters.status === "attention" && activeCount === 1 && !q ? "Nothing needs attention right now." : "No patients match these filters."}
          {anythingActive && <button onClick={clearAll} style={{ marginLeft: 8, border: "none", background: "transparent", color: colors.rust, fontWeight: 700, cursor: "pointer", fontSize: 13.5 }}>Clear filters</button>}
        </div>
      ) : (
        shown.map((row) => (
          <PatientCard key={row.p.id} row={row} isAdmin={isAdmin} now={now} personName={personName} callTargetFor={callTargetFor} onOpen={onOpen} onMessage={onMessage} />
        ))
      )}
    </div>
  )
}
