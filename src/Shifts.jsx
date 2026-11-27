import { useState, useEffect, useMemo, useCallback } from "react"
import { CalendarClock, Lock, Moon, Pencil, Trash2, Plus, X, ChevronLeft, ChevronRight, Printer } from "lucide-react"
import { supabase } from "./supabaseClient.js"
import { Avatar } from "./Avatar.jsx"
import { OFFICE_PHONE, telHref } from "./carePlan.js"
import { ListView, WeekGrid, MonthGrid, patientColorsFor } from "./MyShiftViews.jsx"
import {
  WEEKDAYS, DAY_ORDER, occurrences, shiftsOnNow, describeShift, fmtClock, fmtTimeRange, fmtDuration,
  durationMinutes, isOvernight, dayLabel, isExpired, weeklyMinutes, isoDate, mondayOf, coverageForWeek,
  describeDays, groupRecurring, fmtClockShort, fmtClockPlain, describeSpan, endDayOffset,
} from "./shifts.js"

const colors = {
  bg: "#FAF6EF", card: "#FFFFFF", hairline: "#E5DFD1", ink: "#20261F", inkSoft: "#5C6357", inkFaint: "#6B7266",
  sage: "#3F6C51", sageDeep: "#2C4E3A", sageTint: "#E3EBE0", gold: "#B98A2E", goldTint: "#F3E7CC",
  rust: "#A24632", rustTint: "#F3DAD2", teal: "#4C7A82", tealTint: "#E5EEEF",
}
const inputStyle = { width: "100%", padding: "10px 12px", borderRadius: 10, border: `1px solid ${colors.hairline}`, fontSize: 14, boxSizing: "border-box", background: "#fff", fontFamily: "inherit", color: colors.ink }
const labelStyle = { fontSize: 13, fontWeight: 700, color: colors.inkSoft, display: "block", marginBottom: 5 }
const smallButton = { border: `1px solid ${colors.hairline}`, background: "#fff", borderRadius: 9, padding: "7px 12px", fontSize: 13, fontWeight: 600, color: colors.inkSoft, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }

function Card({ children, style }) {
  return <div style={{ background: colors.card, borderRadius: 18, boxShadow: "0 1px 3px rgba(32,38,31,0.06), 0 6px 16px rgba(32,38,31,0.05)", padding: 18, marginBottom: 14, ...style }}>{children}</div>
}

// A caregiver's shifts. Only their own come back from the database, and the database refuses any change from them.
export function useMyShifts(enabled) {
  const [shifts, setShifts] = useState([])
  const [loading, setLoading] = useState(!!enabled)

  const load = useCallback(async () => {
    const { data, error } = await supabase.from("shifts").select("*")
    if (!error) setShifts(data || [])
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!enabled) return undefined
    load()
    const refresh = () => { if (document.visibilityState === "visible") load() }
    document.addEventListener("visibilitychange", refresh)
    const timer = setInterval(load, 5 * 60 * 1000)
    return () => { document.removeEventListener("visibilitychange", refresh); clearInterval(timer) }
  }, [enabled, load])

  return { shifts, loading }
}

function useNow() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60 * 1000)
    return () => clearInterval(t)
  }, [])
  return now
}

const endLabel = (o) => {
  const sameDay = o.start.toDateString() === o.end.toDateString()
  return sameDay ? fmtClock(`${o.end.getHours()}:${o.end.getMinutes()}`) : `${o.end.toLocaleDateString(undefined, { weekday: "short" })} ${fmtClock(`${o.end.getHours()}:${o.end.getMinutes()}`)}`
}

/* ---------------- caregiver: My shifts (read only) ---------------- */

const timeLeft = (o, now) => {
  const mins = Math.max(0, Math.round((o.end - now) / 60000))
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return h ? `${h} h${m ? ` ${m} min` : ""} left` : `${m} min left`
}

// A caregiver's own shifts, read only (the office makes any changes): the shift they are on now, then a List / Week / Month
// switch. The list is the daily view (what is next, grouped by week with the hours), the week grid shows the length of every
// shift across the hours of each day, and the month calendar shows the whole month. Each patient has their own colour.
export function MyShifts({ shifts, patients, loading, onOpenPatient }) {
  const now = useNow()
  const [view, setView] = useState(() => { try { const v = localStorage.getItem("strovia-shifts-view"); return v === "week" || v === "month" ? v : "list" } catch { return "list" } })
  const choose = (v) => { setView(v); try { localStorage.setItem("strovia-shifts-view", v) } catch { /* a remembered choice is only a convenience */ } }
  const nameOf = (id) => patients.find((p) => p.id === id)?.full_name || "Patient"
  const colorOf = useMemo(() => patientColorsFor(shifts), [shifts])
  const running = useMemo(() => shiftsOnNow(shifts, now), [shifts, now])
  const weekStart = useMemo(() => mondayOf(now), [now])
  const windows = useMemo(() => occurrences(shifts, weekStart, 21), [shifts, weekStart])
  const upcoming = useMemo(() => windows.filter((o) => o.start > now && o.start < new Date(now.getTime() + 14 * 86400000)), [windows, now])
  const regular = useMemo(() => groupRecurring(shifts.filter((s) => !isExpired(s, now))).weekly, [shifts, now])

  if (loading) return <Card><p style={{ fontSize: 13.5, color: colors.inkFaint, margin: 0 }}>Loading...</p></Card>
  if (running.length === 0 && upcoming.length === 0 && regular.length === 0) {
    return (
      <Card>
        <p style={{ fontSize: 13.5, color: colors.inkSoft, margin: 0, lineHeight: 1.5 }}>
          No shifts in the next two weeks. When your administrator assigns you a shift, it appears here.
        </p>
      </Card>
    )
  }

  const regularCard = regular.length > 0 && (
    <Card>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: colors.sageDeep, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 4 }}>Your regular week</div>
      {regular.map((g, i) => (
        <div key={g.key} style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", padding: "9px 0", borderTop: i ? `1px solid ${colors.hairline}` : "none" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: colors.ink }}>{describeDays(g.days)}</div>
            <div style={{ fontSize: 13, color: colors.inkSoft }}>{fmtTimeRange(g.shift)} · {fmtDuration(durationMinutes(g.shift))}</div>
            {(g.shift.ends_on || g.shift.starts_on > isoDate(now)) && (
              <div style={{ fontSize: 13, color: colors.inkFaint }}>
                {g.shift.starts_on > isoDate(now) ? `From ${new Date(g.shift.starts_on + "T00:00:00").toLocaleDateString()}` : ""}{g.shift.ends_on ? ` Until ${new Date(g.shift.ends_on + "T00:00:00").toLocaleDateString()}` : ""}
              </div>
            )}
          </div>
          <span style={{ fontSize: 13, fontWeight: 700, color: colors.sageDeep, background: colors.sageTint, borderRadius: 999, padding: "3px 10px", flexShrink: 0 }}>{nameOf(g.shift.patient_id)}</span>
        </div>
      ))}
    </Card>
  )

  return (
    <>
      {running.map((o) => (
        <div key={o.shift.id} style={{ background: colors.sageTint, borderRadius: 16, padding: "14px 16px", marginBottom: 14 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: colors.sageDeep, textTransform: "uppercase", letterSpacing: 0.6 }}>On shift now</div>
          <div style={{ fontSize: 17, fontWeight: 700, color: colors.ink, marginTop: 3 }}>{nameOf(o.shift.patient_id)}</div>
          <div style={{ fontSize: 13, color: colors.inkSoft }}>Until {endLabel(o)} · {timeLeft(o, now)}</div>
          {onOpenPatient && (
            <button onClick={() => onOpenPatient(o.shift.patient_id)} style={{ display: "block", width: "100%", marginTop: 10, padding: "10px 0", borderRadius: 10, border: "none", background: colors.sage, color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
              Open {nameOf(o.shift.patient_id).split(" ")[0]}
            </button>
          )}
        </div>
      ))}

      <div role="tablist" aria-label="How to show my shifts" style={{ display: "flex", background: "#fff", border: `1px solid ${colors.hairline}`, borderRadius: 12, padding: 3, marginBottom: 12 }}>
        {[["list", "List"], ["week", "Week"], ["month", "Month"]].map(([k, label]) => (
          <button key={k} role="tab" aria-selected={view === k} onClick={() => choose(k)}
            style={{ flex: 1, border: "none", cursor: "pointer", padding: "8px 0", borderRadius: 9, fontSize: 13.5, fontWeight: 700, background: view === k ? colors.sageTint : "transparent", color: view === k ? colors.sageDeep : colors.inkSoft }}>{label}</button>
        ))}
      </div>

      {view === "list" && <ListView now={now} upcoming={upcoming} nameOf={nameOf} colorOf={colorOf} onOpen={onOpenPatient} regular={regularCard} />}
      {view === "week" && <WeekGrid now={now} shifts={shifts} nameOf={nameOf} colorOf={colorOf} onOpen={onOpenPatient} />}
      {view === "month" && <MonthGrid now={now} shifts={shifts} nameOf={nameOf} colorOf={colorOf} onOpen={onOpenPatient} />}

      <p style={{ fontSize: 13, color: colors.inkFaint, margin: "0 2px 14px", lineHeight: 1.5, display: "flex", gap: 6, alignItems: "flex-start" }}>
        <Lock size={12} style={{ marginTop: 2, flexShrink: 0 }} />
        <span>Set by your administrator. To ask for a change, call the office on <a href={telHref(OFFICE_PHONE)} style={{ color: colors.sageDeep, fontWeight: 700 }}>{OFFICE_PHONE}</a>.</span>
      </p>
    </>
  )
}

// On a patient's Today page: is this caregiver on shift for this patient today?
export function ShiftBanner({ shifts, patientId }) {
  const now = useNow()
  const mine = useMemo(() => shifts.filter((s) => s.patient_id === patientId), [shifts, patientId])
  const today = useMemo(() => {
    const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
    return occurrences(mine, now, 2).filter((o) => o.start < endOfToday)
  }, [mine, now])
  if (today.length === 0) return null
  return (
    <div className="no-print" style={{ background: colors.sageTint, borderRadius: 12, padding: "10px 13px", marginBottom: 12, display: "flex", gap: 8, alignItems: "flex-start" }}>
      <CalendarClock size={16} color={colors.sageDeep} style={{ marginTop: 2, flexShrink: 0 }} />
      <div style={{ fontSize: 13.5, color: colors.ink, lineHeight: 1.5 }}>
        {today.map((o) => (
          <div key={o.start.getTime()}>
            <strong>{o.start <= now ? "Your shift now" : "Your shift today"}:</strong> {fmtClock(o.shift.start_time)} to {endLabel(o)}
          </div>
        ))}
      </div>
    </div>
  )
}

/* ---------------- administrator: assign and manage shifts ---------------- */

const clockOf = (date) => date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
const dayHead = (d) => d.toLocaleDateString(undefined, { weekday: "short", day: "numeric" })

// The whole week at a glance: who works when ("grid"), or how much of each day each patient is covered ("coverage").
function WeekView({ mode, shifts, accounts, patients, assignments, allCaregivers, onEdit }) {
  const [offset, setOffset] = useState(0)
  const weekStart = useMemo(() => { const m = mondayOf(new Date()); m.setDate(m.getDate() + offset * 7); return m }, [offset])
  const days = Array.from({ length: 7 }, (_, i) => new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + i))
  const byId = Object.fromEntries(accounts.map((a) => [a.user_id, a]))
  const patientName = (id) => patients.find((p) => p.id === id)?.full_name || "Patient"
  const live = shifts.filter((s) => patients.some((p) => p.id === s.patient_id))
  const before = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() - 1)
  const cell = { border: `1px solid ${colors.hairline}`, padding: "6px 7px", verticalAlign: "top", fontSize: 13 }
  const head = { ...cell, background: colors.bg, fontWeight: 700, color: colors.inkSoft, textAlign: "left" }

  // One color per patient (cycling through three); every box also carries the patient's name.
  const palette = [
    { bg: colors.sageTint, fg: colors.sageDeep, edge: colors.sage },
    { bg: colors.tealTint, fg: "#2F5A62", edge: colors.teal },
    { bg: colors.goldTint, fg: "#6B4D0E", edge: colors.gold },
  ]
  const paletteOf = (patientId) => palette[Math.max(0, patients.findIndex((p) => p.id === patientId)) % palette.length]

  const nav = (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
      <button onClick={() => setOffset((o) => o - 1)} aria-label="Previous week" style={smallButton}><ChevronLeft size={14} /></button>
      <span style={{ fontSize: 13.5, fontWeight: 700, color: colors.ink }}>Week of {days[0].toLocaleDateString(undefined, { month: "short", day: "numeric" })}{offset === 0 ? " (this week)" : ""}</span>
      <button onClick={() => setOffset((o) => o + 1)} aria-label="Next week" style={smallButton}><ChevronRight size={14} /></button>
      {offset !== 0 && <button onClick={() => setOffset(0)} style={smallButton}>This week</button>}
    </div>
  )

  if (mode === "grid") {
    const weekEnd = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 7)
    const dayIndex = (d) => Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - weekStart) / 86400000)
    const clamp = (n) => Math.max(0, Math.min(6, n))
    const plainOf = (d) => fmtClockPlain(`${d.getHours()}:${d.getMinutes()}`)
    const dayShort = (d) => d.toLocaleDateString(undefined, { weekday: "short" })
    const byCaregiver = {}
    for (const s of live) (byCaregiver[s.caregiver_id] ||= []).push(s)
    const nameOfId = (id) => (byId[id] ? personName(byId[id]) : "Unknown")

    // One strip per shift. A live-in shift is one strip across all its days; the same shift on following days (Tue to Fri,
    // 8 AM to 4 PM) is one strip too. Strips that would sit on top of each other go on a second line.
    const rowsFor = (id) => {
      const windows = occurrences(byCaregiver[id], before, 9)
      const segs = []
      let minutes = 0
      for (const o of windows) {
        minutes += Math.max(0, (Math.min(o.end, weekEnd) - Math.max(o.start, weekStart)) / 60000)
        const n = daysLater(o)
        const first = dayIndex(o.start)
        const lastDay = dayIndex(new Date(o.end.getTime() - 60000))
        const long = endDayOffset(o.shift) >= 2
        if (long ? lastDay < 0 || first > 6 : first < 0 || first > 6) continue
        const key = [o.shift.patient_id, o.shift.start_time, o.shift.end_time, endDayOffset(o.shift)].join("|")
        const prev = segs[segs.length - 1]
        if (!long && prev && !prev.long && prev.key === key && prev.colEnd + 1 === first) {
          prev.colEnd = first; prev.lastStart = o.start; prev.shifts.push(o.shift)
          continue
        }
        segs.push({ key, long, shift: o.shift, shifts: [o.shift], colStart: clamp(first), colEnd: long ? clamp(lastDay) : first, firstStart: o.start, lastStart: o.start, start: o.start, end: o.end, n })
      }
      const lanes = []
      for (const sg of segs.sort((a, b) => a.colStart - b.colStart)) {
        const lane = lanes.find((l) => l[l.length - 1].colEnd < sg.colStart)
        if (lane) lane.push(sg); else lanes.push([sg])
      }
      const hours = Math.round(minutes / 6) / 10
      return { lanes: lanes.length ? lanes : [[]], hours }
    }
    const label = (sg) => {
      const hrs = `${fmtClockPlain(sg.shift.start_time)} to ${fmtClockPlain(sg.shift.end_time)}`
      if (sg.long) return `${dayShort(sg.start)} ${plainOf(sg.start)} to ${dayShort(sg.end)} ${plainOf(sg.end)}`
      if (sg.colEnd > sg.colStart) return `${dayShort(sg.firstStart)} to ${dayShort(sg.lastStart)}, ${hrs}`
      return hrs
    }

    const ids = Object.keys(byCaregiver)
    const extras = (allCaregivers || []).filter((a) => !byCaregiver[a.user_id])
    const everyone = [...ids.map((id) => ({ id, has: true })), ...extras.map((a) => ({ id: a.user_id, has: false }))]
      .sort((a, b) => nameOfId(a.id).localeCompare(nameOfId(b.id)))
    const assignedCount = (id) => (assignments || []).filter((x) => x.user_id === id && patients.some((p) => p.id === x.patient_id)).length
    const dash = <span style={{ color: colors.inkFaint }}>-</span>
    return (
      <>
        {nav}
        {ids.length > 0 && onEdit && <p style={{ fontSize: 13, color: colors.inkFaint, margin: "0 0 8px" }}>Tap a box to change that shift.</p>}
        {everyone.length === 0 ? <p style={{ fontSize: 13.5, color: colors.inkFaint }}>No shifts assigned yet.</p> : (
          <div style={{ overflowX: "auto", marginBottom: 12 }}>
            <table style={{ width: "100%", minWidth: 760, borderCollapse: "collapse", tableLayout: "fixed" }}>
              <thead><tr><th style={{ ...head, width: 118 }}>Caregiver</th>{days.map((d) => <th key={d.getTime()} style={head}>{dayHead(d)}</th>)}<th style={{ ...head, width: 64 }}>Hours</th></tr></thead>
              <tbody>
                {everyone.map(({ id, has }) => {
                  if (!has) {
                    const none = assignedCount(id) === 0
                    return (
                      <tr key={id}>
                        <td style={{ ...cell, fontWeight: 700, color: colors.ink, fontSize: 13 }}>{nameOfId(id)}</td>
                        <td colSpan={8} style={{ ...cell, textAlign: "center", verticalAlign: "middle", background: none ? colors.rustTint : colors.bg, color: none ? colors.rust : colors.inkFaint }}>
                          {none ? "No patients yet, so no shifts can be set" : "No shifts set yet"}
                        </td>
                      </tr>
                    )
                  }
                  const { lanes, hours } = rowsFor(id)
                  return lanes.map((lane, li) => {
                    const cells = []
                    let col = 0
                    for (const sg of lane) {
                      while (col < sg.colStart) { cells.push(<td key={`e${col}`} style={{ ...cell, textAlign: "center", verticalAlign: "middle" }}>{dash}</td>); col++ }
                      const c = paletteOf(sg.shift.patient_id)
                      const text = `${patientName(sg.shift.patient_id)}, ${label(sg)}`
                      cells.push(
                        <td key={`s${sg.colStart}`} colSpan={sg.colEnd - sg.colStart + 1} style={{ ...cell, verticalAlign: "middle" }}>
                          <button type="button" onClick={() => onEdit?.(sg.shift)} title={onEdit ? `${text}. Tap to change this shift` : text} aria-label={`${text}. Change this shift`}
                            style={{ display: "block", width: "100%", textAlign: "left", font: "inherit", border: "none", background: c.bg, borderLeft: `4px solid ${c.edge}`, borderRadius: 7, padding: "6px 8px", color: c.fg, lineHeight: 1.3, cursor: onEdit ? "pointer" : "default" }}>
                            <strong style={{ display: "block", fontSize: 13 }}>{patientName(sg.shift.patient_id)}</strong>
                            <span style={{ fontSize: 12.5 }}>{label(sg)}</span>
                          </button>
                        </td>,
                      )
                      col = sg.colEnd + 1
                    }
                    while (col < 7) { cells.push(<td key={`e${col}`} style={{ ...cell, textAlign: "center", verticalAlign: "middle" }}>{dash}</td>); col++ }
                    return (
                      <tr key={`${id}-${li}`}>
                        {li === 0 && <td rowSpan={lanes.length} style={{ ...cell, fontWeight: 700, color: colors.ink, fontSize: 13, verticalAlign: "middle" }}>{nameOfId(id)}</td>}
                        {cells}
                        {li === 0 && <td rowSpan={lanes.length} style={{ ...cell, fontSize: 13, verticalAlign: "middle" }}>{hours > 0 ? `${hours} h` : "-"}</td>}
                      </tr>
                    )
                  })
                })}
              </tbody>
            </table>
          </div>
        )}
      </>
    )
  }

  return (
    <>
      {nav}
      <p style={{ fontSize: 13, color: colors.inkFaint, margin: "0 0 10px", lineHeight: 1.5 }}>
        How many hours of each day someone is on shift for the patient. Green is all 24 hours, amber has gaps (the first is shown), red has no cover. A night shift counts towards both days.
      </p>
      {patients.length === 0 ? <p style={{ fontSize: 13.5, color: colors.inkFaint }}>No patients yet.</p> : (
        <div style={{ overflowX: "auto", marginBottom: 12 }}>
          <table style={{ width: "100%", minWidth: 680, borderCollapse: "collapse" }}>
            <thead><tr><th style={head}>Patient</th>{days.map((d) => <th key={d.getTime()} style={head}>{dayHead(d)}</th>)}</tr></thead>
            <tbody>
              {patients.map((p) => {
                const list = live.filter((s) => s.patient_id === p.id)
                const cover = list.length ? coverageForWeek(list, weekStart) : null
                return (
                  <tr key={p.id}>
                    <td style={{ ...cell, fontWeight: 700, color: colors.ink }}>
                      {p.full_name}
                      {!cover && <div style={{ fontWeight: 400, color: colors.inkFaint }}>No shifts set</div>}
                    </td>
                    {days.map((d, i) => {
                      if (!cover) return <td key={d.getTime()} style={{ ...cell, color: colors.inkFaint }}>-</td>
                      const c = cover[i]
                      const full = c.covered >= 1440
                      const none = c.covered === 0
                      const [bg, fg] = full ? [colors.sageTint, colors.sageDeep] : none ? [colors.rustTint, colors.rust] : [colors.goldTint, colors.gold]
                      const gap = c.gaps[0]
                      return (
                        <td key={d.getTime()} style={cell} title={c.gaps.map(([a, b]) => `${clockOf(new Date(a))} to ${clockOf(new Date(b))}`).join(", ")}>
                          <div style={{ background: bg, color: fg, borderRadius: 6, padding: "3px 6px", fontWeight: 700 }}>
                            {full ? "24 h" : none ? "None" : fmtDuration(c.covered)}
                            {!full && !none && gap && <div style={{ fontWeight: 400 }}>gap {clockOf(new Date(gap[0]))} to {clockOf(new Date(gap[1]))}{c.gaps.length > 1 ? ` and ${c.gaps.length - 1} more` : ""}</div>}
                          </div>
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

const blankForm = () => ({
  id: null, caregiver: "", patient: "", repeat: "weekly", days: [], onDate: "", startsOn: isoDate(new Date()), endsOn: "",
  start: "08:00", end: "20:00", endsAfter: "auto", notes: "",
})

const hhmm = (t) => String(t).slice(0, 5)
const daysLater = (o) => Math.round((new Date(o.end.getFullYear(), o.end.getMonth(), o.end.getDate()) - new Date(o.start.getFullYear(), o.start.getMonth(), o.start.getDate())) / 86400000)
const personName = (a) => [a.first_name, a.last_name].filter(Boolean).join(" ") || a.email
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]))

// A printable page: this week's schedule at a glance, and every caregiver's full list of shifts. Only
// administrators see the button that opens this.
function printShifts({ shifts, accounts, patients, printedBy }) {
  const w = window.open("", "_blank")
  if (!w) return false
  const byId = Object.fromEntries(accounts.map((a) => [a.user_id, a]))
  const patientName = (id) => patients.find((p) => p.id === id)?.full_name || "Patient"
  const live = shifts.filter((s) => patients.some((p) => p.id === s.patient_id))

  const byCaregiver = {}
  for (const s of live) (byCaregiver[s.caregiver_id] ||= []).push(s)
  const order = (s) => (s.weekday !== null ? DAY_ORDER.indexOf(s.weekday) : 100)
  const sortShifts = (list) => [...list].sort((a, b) => order(a) - order(b) || (a.on_date || "").localeCompare(b.on_date || "") || a.start_time.localeCompare(b.start_time))
  const people = Object.keys(byCaregiver).sort((a, b) => personName(byId[a] || { email: "" }).localeCompare(personName(byId[b] || { email: "" })))
  const clockOf = (d) => d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })

  const listSections = people.map((id) => {
    const list = sortShifts(byCaregiver[id])
    const weekly = weeklyMinutes(list.filter((s) => !isExpired(s)))
    const rows = list.map((s) => `
      <tr class="${isExpired(s) ? "expired" : ""}">
        <td>${esc(describeShift(s))}${isExpired(s) ? " (ended)" : ""}</td>
        <td>${esc(fmtTimeRange(s))}</td>
        <td>${esc(fmtDuration(durationMinutes(s)))}${describeSpan(s) ? ", " + describeSpan(s) : ""}</td>
        <td>${esc(patientName(s.patient_id))}</td>
        <td>${esc(s.notes || "")}</td>
      </tr>`).join("")
    return `<h3>${esc(byId[id] ? personName(byId[id]) : "Unknown caregiver")}${weekly > 0 ? ` <span class="muted">· ${esc(fmtDuration(weekly))} a week</span>` : ""}</h3>
      <table><thead><tr><th>Day</th><th>Time</th><th>Length</th><th>Patient</th><th>Note</th></tr></thead><tbody>${rows}</tbody></table>`
  }).join("")

  const weekStart = mondayOf(new Date())
  const days = Array.from({ length: 7 }, (_, i) => new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + i))
  const before = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() - 1)
  const dayHead = (d) => d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })
  const gridRows = people.map((id) => {
    const windows = occurrences(byCaregiver[id], before, 9)
    const cells = days.map((d) => {
      const dayEnd = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)
      const here = windows.filter((o) => o.start >= d && o.start < dayEnd)
      return `<td>${here.length === 0 ? "-" : here.map((o) => `${esc(clockOf(o.start))} to ${daysLater(o) >= 2 ? esc(o.end.toLocaleDateString(undefined, { weekday: "short" })) + " " : ""}${esc(clockOf(o.end))}<br><span class="muted">${esc(patientName(o.shift.patient_id))}</span>`).join("<br>")}</td>`
    }).join("")
    return `<tr><td>${esc(byId[id] ? personName(byId[id]) : "Unknown")}</td>${cells}</tr>`
  }).join("")

  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Strovia shift schedule</title>
    <style>
      body { font-family: Georgia, serif; color: #000; margin: 24px; }
      h1 { font-size: 22px; margin: 0 0 4px; }
      h2 { font-size: 16px; margin: 22px 0 8px; border-bottom: 1px solid #999; padding-bottom: 3px; }
      h3 { font-size: 14px; margin: 14px 0 4px; }
      .meta { font-size: 12.5px; color: #333; margin: 0 0 14px; line-height: 1.5; }
      table { width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 10px; }
      th { text-align: left; border-bottom: 2px solid #000; padding: 5px 7px; }
      td { border-bottom: 1px solid #bbb; padding: 5px 7px; vertical-align: top; }
      tr.expired { color: #777; }
      tr { page-break-inside: avoid; }
      .muted { color: #555; font-size: 11px; }
      .empty { color: #555; }
      .foot { font-size: 11.5px; color: #333; margin-top: 16px; border-top: 1px solid #999; padding-top: 8px; }
    </style></head><body>
    <h1>Strovia - shift schedule</h1>
    <p class="meta">${people.length} ${people.length === 1 ? "caregiver has" : "caregivers have"} shifts assigned. Contains confidential information.</p>
    <h2>This week (${esc(days[0].toLocaleDateString(undefined, { month: "short", day: "numeric" }))} to ${esc(days[6].toLocaleDateString(undefined, { month: "short", day: "numeric" }))})</h2>
    ${people.length === 0 ? `<p class="empty">No shifts assigned yet.</p>` : `<table><thead><tr><th>Caregiver</th>${days.map((d) => `<th>${esc(dayHead(d))}</th>`).join("")}</tr></thead><tbody>${gridRows}</tbody></table>`}
    <h2>Every shift, by caregiver</h2>
    ${people.length === 0 ? `<p class="empty">No shifts assigned yet.</p>` : listSections}
    <p class="foot">Printed by ${esc(printedBy)} on ${esc(new Date().toLocaleString())}.</p>
    </body></html>`)
  w.document.close()
  w.focus()
  w.print()
  return true
}

export function ShiftsAdmin({ userId, accounts, patients, assignments, shifts, printedBy, onChanged, onGoTo }) {
  const [form, setForm] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [confirming, setConfirming] = useState(null)
  const [view, setView] = useState("grid") // list | grid | coverage (the week grid answers "who works when" fastest)
  const [blocked, setBlocked] = useState(false)
  const [filterCg, setFilterCg] = useState("all")
  const [filterPt, setFilterPt] = useState("all")
  const [openCg, setOpenCg] = useState({}) // caregiver id -> card opened or closed by hand
  const [openGroup, setOpenGroup] = useState({}) // merged weekly row key -> its separate days showing
  const [showEnded, setShowEnded] = useState(false)

  const caregivers = accounts.filter((a) => a.role === "caregiver" && a.approved)
  const byId = Object.fromEntries(accounts.map((a) => [a.user_id, a]))
  const patientName = (id) => patients.find((p) => p.id === id)?.full_name || "Patient"

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))
  // Every patient can be chosen. One this caregiver has no access to yet is marked, and saving the shift gives them
  // access first (a shift can only be given for a patient the caregiver is assigned to).
  const isAssigned = (patientId, caregiverId) => assignments.some((a) => a.patient_id === patientId && a.user_id === caregiverId)
  const assignedPatients = form?.caregiver ? patients : []

  // What is not set up yet: patients nobody looks after, patients with a caregiver but no hours, and caregivers with no patients.
  const activeCaregivers = caregivers.filter((a) => !a.suspended)
  const caregiversOf = (patientId) => assignments.filter((x) => x.patient_id === patientId && activeCaregivers.some((c) => c.user_id === x.user_id)).map((x) => x.user_id)
  const noCaregiver = patients.filter((p) => caregiversOf(p.id).length === 0)
  const noShifts = patients.filter((p) => caregiversOf(p.id).length > 0 && !shifts.some((s) => s.patient_id === p.id && !isExpired(s)))
  const noPatients = activeCaregivers.filter((a) => !assignments.some((x) => x.user_id === a.user_id && patients.some((p) => p.id === x.patient_id)))
  const needsAttention = noCaregiver.length + noShifts.length + noPatients.length > 0
  const attentionRow = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "4px 0", fontSize: 13.5, color: colors.ink }
  const startShift = (caregiver, patient) => { setForm({ ...blankForm(), caregiver: caregiver || "", patient: patient || "" }); setError(null) }
  const needsAccess = !!(form?.caregiver && form.patient && !form.id && !isAssigned(form.patient, form.caregiver))
  const toggleDay = (d) => setForm((f) => ({ ...f, days: f.days.includes(d) ? f.days.filter((x) => x !== d) : [...f.days, d] }))

  // "auto" keeps the old rule (a later end time that is earlier than the start means the next day); otherwise the number of
  // days after the start day that the shift ends, which is how a live-in shift from Monday 8 AM to Wednesday 8 AM is set up.
  const endsAfterOf = (s) => (s.ends_after_days !== null && s.ends_after_days !== undefined ? String(s.ends_after_days) : "auto")
  const offsetOf = (f) => (f.endsAfter === "auto" ? (f.end <= f.start ? 1 : 0) : Number(f.endsAfter))
  const formLength = (f) => durationMinutes({ start_time: f.start, end_time: f.end, ends_after_days: offsetOf(f) })

  // The form opens at the top of the page, so bring it into view when it was opened from further down.
  const showForm = () => window.scrollTo({ top: 0, behavior: "smooth" })

  function edit(s) {
    setError(null)
    setForm({
      id: s.id, caregiver: s.caregiver_id, patient: s.patient_id, repeat: s.weekday !== null ? "weekly" : "once",
      days: s.weekday !== null ? [s.weekday] : [], onDate: s.on_date || "", startsOn: s.starts_on, endsOn: s.ends_on || "",
      start: hhmm(s.start_time), end: hhmm(s.end_time), endsAfter: endsAfterOf(s), notes: s.notes || "",
    })
    showForm()
  }

  // One edit for a whole repeating schedule (the same hours on several weekdays): change the hours, the dates, or which
  // days it covers, and every day follows. Days that are added get new shifts; days that are taken out are removed.
  function editGroup(g) {
    setError(null)
    const s = g.shift
    setForm({
      id: g.rows[0].id, groupRows: g.rows, caregiver: s.caregiver_id, patient: s.patient_id, repeat: "weekly",
      days: [...g.days], onDate: "", startsOn: s.starts_on, endsOn: s.ends_on || "",
      start: hhmm(s.start_time), end: hhmm(s.end_time), endsAfter: endsAfterOf(s), notes: s.notes || "",
    })
    showForm()
  }

  // Tapping a block in the week grid: the whole schedule if it repeats on several days, otherwise just that shift.
  function editFromGrid(s) {
    const group = groupRecurring(shifts.filter((x) => x.caregiver_id === s.caregiver_id && x.patient_id === s.patient_id)).weekly.find((g) => g.rows.some((r) => r.id === s.id))
    if (group && group.rows.length > 1) editGroup(group)
    else edit(s)
  }

  async function save(e) {
    e.preventDefault()
    setError(null)
    if (!form.caregiver || !form.patient) return setError("Choose a caregiver and a patient.")
    if (formLength(form) <= 0) return setError("That shift would finish before it starts. Choose a later end time, or pick a later day under \"Finishes\".")
    if (form.repeat === "weekly" && form.days.length === 0) return setError("Choose at least one day of the week.")
    if (form.repeat === "once" && !form.onDate) return setError("Choose the date of the shift.")
    if (form.repeat === "weekly" && form.endsOn && form.endsOn < form.startsOn) return setError("The last day cannot be before the first day.")
    const base = {
      patient_id: form.patient, caregiver_id: form.caregiver, start_time: form.start, end_time: form.end,
      ends_after_days: offsetOf(form), notes: form.notes.trim() || null,
    }
    const rows = form.repeat === "weekly"
      ? form.days.map((d) => ({ ...base, weekday: d, on_date: null, starts_on: form.startsOn, ends_on: form.endsOn || null }))
      : [{ ...base, weekday: null, on_date: form.onDate }]
    if (form.groupRows) {
      setBusy(true)
      const existing = new Map(form.groupRows.map((r) => [r.weekday, r.id]))
      let err = null
      for (const d of form.days) {
        const fields = { ...base, weekday: d, on_date: null, starts_on: form.startsOn, ends_on: form.endsOn || null }
        const res = existing.has(d)
          ? await supabase.from("shifts").update(fields).eq("id", existing.get(d)).select()
          : await supabase.from("shifts").insert({ ...fields, created_by: userId }).select()
        if (res.error) { err = res.error; break }
        if (existing.has(d) && (res.data || []).length === 0) { err = { message: "That shift could not be changed." }; break }
      }
      if (!err) {
        const gone = form.groupRows.filter((r) => !form.days.includes(r.weekday)).map((r) => r.id)
        if (gone.length) err = (await supabase.from("shifts").delete().in("id", gone)).error
      }
      setBusy(false)
      await onChanged()
      if (err) return setError(`${err.message} Some of the days may already have been changed, so check the list.`)
      setForm(null)
      return
    }
    setBusy(true)
    let result
    let gaveAccess = false
    if (!form.id && !isAssigned(form.patient, form.caregiver)) {
      const grant = await supabase.from("patient_assignments").insert({ patient_id: form.patient, user_id: form.caregiver, assigned_by: userId })
      if (grant.error) { setBusy(false); return setError(`Could not give this caregiver access to the patient: ${grant.error.message}`) }
      gaveAccess = true
    }
    if (form.id) {
      result = await supabase.from("shifts").update(rows[0]).eq("id", form.id).select()
      if (!result.error && (result.data || []).length === 0) result = { error: { message: "That shift could not be changed." } }
    } else {
      result = await supabase.from("shifts").insert(rows.map((r) => ({ ...r, created_by: userId }))).select()
    }
    if (result.error && gaveAccess) {
      // The shift was refused (for example it overlaps another one): take back the access we just gave.
      await supabase.from("patient_assignments").delete().eq("patient_id", form.patient).eq("user_id", form.caregiver)
    }
    setBusy(false)
    if (result.error) return setError(result.error.message)
    setForm(null)
    await onChanged()
  }

  async function remove(id) {
    setBusy(true)
    setError(null)
    const { error: err } = await supabase.from("shifts").delete().eq("id", id)
    setBusy(false)
    setConfirming(null)
    if (err) return setError(err.message)
    await onChanged()
  }

  async function removeMany(key, ids) {
    setBusy(true)
    setError(null)
    const { error: err } = await supabase.from("shifts").delete().in("id", ids)
    setBusy(false)
    setConfirming(null)
    if (err) return setError(err.message)
    await onChanged()
  }

  // The caregiver and patient filters narrow everything below: the list, the week grid and the coverage view. Shifts
  // that have ended stay out of the list unless asked for, so it doesn't grow forever.
  const matches = (s) => (filterCg === "all" || s.caregiver_id === filterCg) && (filterPt === "all" || s.patient_id === filterPt)
  const filtered = shifts.filter(matches)
  const endedShifts = filtered.filter((s) => isExpired(s))
  const listed = showEnded ? filtered : filtered.filter((s) => !isExpired(s))
  const byCaregiver = {}
  for (const s of listed) (byCaregiver[s.caregiver_id] ||= []).push(s)
  const order = (s) => (s.weekday !== null ? DAY_ORDER.indexOf(s.weekday) : 100)
  const sortShifts = (list) => [...list].sort((a, b) => order(a) - order(b) || (a.on_date || "").localeCompare(b.on_date || "") || a.start_time.localeCompare(b.start_time))
  const people = Object.keys(byCaregiver).sort((a, b) => personName(byId[a] || { email: "" }).localeCompare(personName(byId[b] || { email: "" })))
  const cgOpen = (id) => openCg[id] ?? (people.length <= 2 || filterCg !== "all")
  const shiftCaregivers = [...new Set(shifts.map((s) => s.caregiver_id))].filter((id) => byId[id]).sort((a, b) => personName(byId[a]).localeCompare(personName(byId[b])))
  const shiftPatients = patients.filter((p) => shifts.some((s) => s.patient_id === p.id))
  const initials = (a) => (personName(a || { email: "?" }).split(/\s+/).map((w) => w[0]).join("").slice(0, 2) || "?").toUpperCase()

  // One shift on its own line, with change and remove. Used for single shifts, one-off shifts and, inside an opened
  // weekly group, each separate day.
  const shiftLine = (s, indent = 66) => {
    const expired = isExpired(s)
    return (
      <div key={s.id} style={{ borderTop: `1px solid ${colors.hairline}`, padding: `10px 18px 10px ${indent}px`, opacity: expired ? 0.55 : 1 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: colors.ink }}>
              {describeShift(s)}{expired && " (ended)"}
            </div>
            <div style={{ fontSize: 13, color: colors.inkSoft }}>
              {fmtTimeRange(s)} · {fmtDuration(durationMinutes(s))}{describeSpan(s) ? `, ${describeSpan(s)}` : ""} · {patientName(s.patient_id)}
            </div>
            {s.weekday !== null && (s.ends_on || s.starts_on > isoDate(new Date())) && (
              <div style={{ fontSize: 13, color: colors.inkFaint, marginTop: 2 }}>
                {s.starts_on > isoDate(new Date()) ? `From ${new Date(s.starts_on + "T00:00:00").toLocaleDateString()}` : ""}{s.ends_on ? ` Until ${new Date(s.ends_on + "T00:00:00").toLocaleDateString()}` : ""}
              </div>
            )}
            {s.notes && <div style={{ fontSize: 13, color: colors.inkFaint, marginTop: 3 }}>{s.notes}</div>}
          </div>
          <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
            <button onClick={() => edit(s)} aria-label="Change this shift" style={smallButton}><Pencil size={13} /> Edit</button>
            <button onClick={() => setConfirming(s.id)} aria-label="Remove shift" style={{ ...smallButton, color: colors.rust }}><Trash2 size={13} /></button>
          </div>
        </div>
        {confirming === s.id && (
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
            <span style={{ fontSize: 13, color: colors.inkSoft }}>Remove this shift?</span>
            <button onClick={() => remove(s.id)} disabled={busy} style={{ ...smallButton, background: colors.rust, color: "#fff", border: "none" }}>Yes, remove</button>
            <button onClick={() => setConfirming(null)} style={smallButton}>Keep</button>
          </div>
        )}
      </div>
    )
  }

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 12 }}>
        {!form ? (
          <button onClick={() => { setForm(blankForm()); setError(null) }} style={{ padding: "10px 16px", borderRadius: 10, border: "none", background: colors.sage, color: "#fff", fontSize: 13.5, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
            <Plus size={15} /> Assign a shift
          </button>
        ) : <span />}
        <button onClick={() => setBlocked(!printShifts({ shifts, accounts, patients, printedBy }))} style={{ ...smallButton, background: "none", border: "none", color: colors.sageDeep, fontWeight: 700 }}>
          <Printer size={14} /> Print
        </button>
      </div>

      {(patients.length > 0 || caregivers.length > 0) && (
        needsAttention ? (
          <div style={{ marginBottom: 14 }}>
            {noCaregiver.length > 0 && (
              <div style={{ background: colors.rustTint, borderLeft: `5px solid ${colors.rust}`, borderRadius: 12, padding: "10px 12px", marginBottom: 8 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: colors.rust, marginBottom: 4 }}>{noCaregiver.length} {noCaregiver.length === 1 ? "patient has" : "patients have"} no caregiver</div>
                {noCaregiver.map((p) => (
                  <div key={p.id} style={attentionRow}><span>{p.full_name}</span><button onClick={() => onGoTo?.("patients")} style={smallButton}>Assign a caregiver</button></div>
                ))}
              </div>
            )}
            {noShifts.length > 0 && (
              <div style={{ background: colors.goldTint, borderLeft: `5px solid ${colors.gold}`, borderRadius: 12, padding: "10px 12px", marginBottom: 8 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: "#6B4D0E", marginBottom: 4 }}>{noShifts.length} {noShifts.length === 1 ? "patient has a caregiver but no shifts" : "patients have a caregiver but no shifts"}</div>
                {noShifts.map((p) => (
                  <div key={p.id} style={attentionRow}>
                    <span>{p.full_name} <span style={{ color: colors.inkSoft }}>({caregiversOf(p.id).map((id) => personName(byId[id])).join(", ")})</span></span>
                    <button onClick={() => startShift(caregiversOf(p.id)[0], p.id)} style={smallButton}>Add shifts</button>
                  </div>
                ))}
              </div>
            )}
            {noPatients.length > 0 && (
              <div style={{ background: colors.goldTint, borderLeft: `5px solid ${colors.gold}`, borderRadius: 12, padding: "10px 12px", marginBottom: 8 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: "#6B4D0E", marginBottom: 4 }}>{noPatients.length} {noPatients.length === 1 ? "caregiver has" : "caregivers have"} no patients</div>
                {noPatients.map((a) => (
                  <div key={a.user_id} style={attentionRow}><span>{personName(a)}</span><button onClick={() => startShift(a.user_id, "")} style={smallButton}>Give a patient</button></div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div style={{ background: colors.sageTint, borderLeft: `5px solid ${colors.sage}`, borderRadius: 12, padding: "9px 12px", marginBottom: 14, fontSize: 13.5, fontWeight: 700, color: colors.sageDeep }}>
            Everyone is set up: every patient has a caregiver and shifts, and every caregiver has patients.
          </div>
        )
      )}

      {form && (
        <Card>
          <form onSubmit={save}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: colors.ink }}>{form.groupRows ? `Change schedule (${describeDays(form.groupRows.map((r) => r.weekday))})` : form.id ? "Change shift" : "New shift"}</div>
              <button type="button" onClick={() => { setForm(null); setError(null) }} aria-label="Close" style={{ border: "none", background: "transparent", cursor: "pointer", color: colors.inkFaint }}><X size={18} /></button>
            </div>

            <label style={labelStyle}>Caregiver</label>
            <select required disabled={!!form.id} value={form.caregiver} onChange={(e) => setForm((f) => ({ ...f, caregiver: e.target.value, patient: "" }))} style={{ ...inputStyle, marginBottom: 12 }}>
              <option value="">Choose a caregiver</option>
              {caregivers.map((c) => <option key={c.user_id} value={c.user_id}>{personName(c)}</option>)}
            </select>

            <label style={labelStyle}>Patient</label>
            <select required disabled={!form.caregiver || !!form.id} value={form.patient} onChange={set("patient")} style={{ ...inputStyle, marginBottom: form.caregiver && assignedPatients.length === 0 ? 4 : 12 }}>
              <option value="">{form.caregiver ? "Choose a patient" : "Choose a caregiver first"}</option>
              {assignedPatients.map((p) => <option key={p.id} value={p.id}>{p.full_name}{isAssigned(p.id, form.caregiver) ? "" : " (will be assigned to this caregiver)"}</option>)}
            </select>
            {form.caregiver && assignedPatients.length === 0 && (
              <p style={{ fontSize: 13, color: colors.rust, margin: "0 0 12px" }}>There are no patients to choose from yet.</p>
            )}
            {needsAccess && (
              <p style={{ fontSize: 13, color: colors.inkSoft, margin: "0 0 12px" }}>
                {personName(byId[form.caregiver])} is not assigned to {patientName(form.patient)} yet. Saving this shift will assign them, so they can see this patient.
              </p>
            )}

            <label style={labelStyle}>How often</label>
            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              {[["weekly", "Every week"], ["once", "One day only"]].map(([key, label]) => (
                <button type="button" key={key} disabled={!!form.id && key !== form.repeat} onClick={() => setForm((f) => ({ ...f, repeat: key }))}
                  style={{ flex: 1, padding: "9px 0", borderRadius: 10, border: `1px solid ${form.repeat === key ? colors.sage : colors.hairline}`, background: form.repeat === key ? colors.sageTint : "#fff", color: form.repeat === key ? colors.sageDeep : colors.inkSoft, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
                  {label}
                </button>
              ))}
            </div>

            {form.repeat === "weekly" ? (
              <>
                <label style={labelStyle}>{form.groupRows ? "Days this schedule covers" : form.id ? "Day" : "Days (choose one or more)"}</label>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
                  {DAY_ORDER.map((d) => {
                    const on = form.days.includes(d)
                    return (
                      <button type="button" key={d} onClick={() => (form.id && !form.groupRows ? setForm((f) => ({ ...f, days: [d] })) : toggleDay(d))}
                        style={{ minWidth: 52, padding: "8px 0", borderRadius: 999, border: `1px solid ${on ? colors.sage : colors.hairline}`, background: on ? colors.sage : "#fff", color: on ? "#fff" : colors.inkSoft, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
                        {WEEKDAYS[d].slice(0, 3)}
                      </button>
                    )
                  })}
                </div>
                <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
                  <div style={{ flex: 1 }}>
                    <label style={labelStyle}>Starting on</label>
                    <input type="date" required value={form.startsOn} onChange={set("startsOn")} style={inputStyle} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={labelStyle}>Until (optional)</label>
                    <input type="date" value={form.endsOn} onChange={set("endsOn")} style={inputStyle} />
                  </div>
                </div>
              </>
            ) : (
              <>
                <label style={labelStyle}>Date</label>
                <input type="date" required value={form.onDate} onChange={set("onDate")} style={{ ...inputStyle, marginBottom: 12 }} />
              </>
            )}

            <div style={{ display: "flex", gap: 10, marginBottom: 6 }}>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>Starts</label>
                <input type="time" required value={form.start} onChange={set("start")} style={inputStyle} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>Ends</label>
                <input type="time" required value={form.end} onChange={set("end")} style={inputStyle} />
              </div>
            </div>
            <label style={{ ...labelStyle, marginTop: 8 }}>Finishes</label>
            <select value={form.endsAfter} onChange={set("endsAfter")} style={{ ...inputStyle, marginBottom: 6 }}>
              <option value="auto">Automatically: the same day, or the next day if the end time is earlier</option>
              <option value="0">The same day</option>
              <option value="1">The next day</option>
              {[2, 3, 4, 5, 6, 7].map((n) => <option key={n} value={String(n)}>{n} days later (a live-in shift)</option>)}
            </select>
            {formLength(form) > 0 ? (
              <p style={{ fontSize: 13, color: colors.inkFaint, margin: "0 0 12px" }}>
                {fmtDuration(formLength(form))}
                {offsetOf(form) === 1 ? ", finishing the next day" : offsetOf(form) >= 2 ? `, finishing ${offsetOf(form)} days later` : ""}
              </p>
            ) : (
              <p style={{ fontSize: 13, color: colors.rust, margin: "0 0 12px" }}>That would finish before it starts. Choose a later end time or a later day.</p>
            )}

            <label style={labelStyle}>Note for the caregiver (optional)</label>
            <textarea value={form.notes} onChange={set("notes")} rows={2} placeholder="For example: key is in the lockbox, handover at 8 pm" style={{ ...inputStyle, resize: "vertical", marginBottom: 12 }} />

            <div style={{ display: "flex", gap: 8 }}>
              <button type="submit" disabled={busy} style={{ flex: 1, padding: "11px 0", borderRadius: 10, border: "none", background: colors.sage, color: "#fff", fontSize: 14, fontWeight: 700, cursor: busy ? "default" : "pointer", opacity: busy ? 0.7 : 1 }}>
                {busy ? "Saving..." : form.id ? "Save changes" : form.days.length > 1 ? `Assign ${form.days.length} shifts` : "Assign shift"}
              </button>
              <button type="button" onClick={() => { setForm(null); setError(null) }} style={{ padding: "11px 16px", borderRadius: 10, border: `1px solid ${colors.hairline}`, background: "#fff", color: colors.inkSoft, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Cancel</button>
            </div>
          </form>
        </Card>
      )}

      {error && <p style={{ color: colors.rust, fontSize: 13, margin: "0 0 12px", lineHeight: 1.45 }}>{error}</p>}

      <div style={{ display: "flex", background: "#F1EEE4", borderRadius: 11, padding: 3, marginBottom: 12 }}>
        {[["grid", "Week"], ["list", "List"], ["coverage", "Coverage"]].map(([key, label]) => (
          <button key={key} onClick={() => setView(key)} aria-pressed={view === key} style={{ flex: 1, padding: "8px 4px", borderRadius: 9, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 700, background: view === key ? "#fff" : "transparent", color: view === key ? colors.sageDeep : colors.inkSoft, boxShadow: view === key ? "0 1px 2px rgba(0,0,0,0.08)" : "none" }}>{label}</button>
        ))}
      </div>
      {blocked && <p style={{ fontSize: 13, color: colors.rust, margin: "0 0 12px" }}>Your browser blocked the print window. Allow pop-ups for this site and press Print schedule again.</p>}

      {shifts.length > 0 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
          <select value={filterCg} onChange={(e) => setFilterCg(e.target.value)} aria-label="Show one caregiver" style={{ ...inputStyle, width: "auto", padding: "7px 12px", fontSize: 13 }}>
            <option value="all">All caregivers</option>
            {shiftCaregivers.map((id) => <option key={id} value={id}>{personName(byId[id])}</option>)}
          </select>
          <select value={filterPt} onChange={(e) => setFilterPt(e.target.value)} aria-label="Show one patient" style={{ ...inputStyle, width: "auto", padding: "7px 12px", fontSize: 13 }}>
            <option value="all">All patients</option>
            {shiftPatients.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
          </select>
          {(filterCg !== "all" || filterPt !== "all") && (
            <button onClick={() => { setFilterCg("all"); setFilterPt("all") }} style={{ border: "none", background: "none", color: colors.sageDeep, fontWeight: 700, fontSize: 13, textDecoration: "underline", cursor: "pointer" }}>Clear filters</button>
          )}
        </div>
      )}

      {view !== "list" ? (
        <WeekView mode={view} shifts={filtered} accounts={accounts} assignments={assignments} allCaregivers={filterCg === "all" && filterPt === "all" ? caregivers : null} patients={filterPt === "all" ? patients : patients.filter((p) => p.id === filterPt)} onEdit={editFromGrid} />
      ) : people.length === 0 ? (
        <p style={{ fontSize: 13.5, color: colors.inkFaint }}>{shifts.length > 0 ? "No shifts match these filters." : "No shifts assigned yet."}</p>
      ) : (
        people.map((id) => {
          const list = sortShifts(byCaregiver[id])
          const weekly = weeklyMinutes(list.filter((s) => !isExpired(s)))
          const open = cgOpen(id)
          const patientNames = [...new Set(list.map((s) => patientName(s.patient_id)))].join(", ")
          const { weekly: groups, oneOff } = groupRecurring(list)
          // Everything this caregiver has within the current filter, ended shifts included, even when those are hidden.
          const theirs = filtered.filter((s) => s.caregiver_id === id)
          const allIds = theirs.map((s) => s.id)
          const endedCount = theirs.filter((s) => isExpired(s)).length
          return (
            <Card key={id} style={{ padding: 0, overflow: "hidden" }}>
              <button
                onClick={() => setOpenCg((o) => ({ ...o, [id]: !open }))} aria-expanded={open}
                style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", padding: "14px 18px", background: "none", border: "none", textAlign: "left", cursor: "pointer" }}
              >
                <Avatar userId={id} name={byId[id] ? personName(byId[id]) : "?"} size={36} fontSize={13} />
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span style={{ display: "block", fontSize: 15, fontWeight: 700, color: colors.ink }}>{byId[id] ? personName(byId[id]) : "Unknown caregiver"}</span>
                  <span style={{ display: "block", fontSize: 13, color: colors.inkFaint, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{patientNames}</span>
                </span>
                {weekly > 0 && <span style={{ fontSize: 13, color: colors.inkSoft, flexShrink: 0 }}><strong>{fmtDuration(weekly)}</strong> a week</span>}
                <ChevronRight size={16} color={colors.inkFaint} style={{ transform: open ? "rotate(90deg)" : "none", flexShrink: 0 }} />
              </button>
              {open && (
                <div>
                  {groups.map((g) => {
                    if (g.rows.length === 1) return shiftLine(g.rows[0])
                    const expired = g.rows.every((r) => isExpired(r))
                    const days = openGroup[g.key]
                    return (
                      <div key={g.key} style={{ borderTop: `1px solid ${colors.hairline}`, padding: "11px 18px 11px 66px", opacity: expired ? 0.55 : 1 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 14, fontWeight: 700, color: colors.ink }}>{describeDays(g.days)}{expired && " (ended)"}</div>
                            <div style={{ fontSize: 13, color: colors.inkSoft }}>
                              {fmtTimeRange(g.shift)} · {fmtDuration(durationMinutes(g.shift))}{describeSpan(g.shift) ? `, ${describeSpan(g.shift)}` : ""} · <span style={{ fontWeight: 700, color: colors.sageDeep, background: colors.sageTint, borderRadius: 999, padding: "1px 9px", fontSize: 13 }}>{patientName(g.shift.patient_id)}</span>
                            </div>
                            {(g.shift.ends_on || g.shift.starts_on > isoDate(new Date())) && (
                              <div style={{ fontSize: 13, color: colors.inkFaint, marginTop: 2 }}>
                                {g.shift.starts_on > isoDate(new Date()) ? `From ${new Date(g.shift.starts_on + "T00:00:00").toLocaleDateString()}` : ""}{g.shift.ends_on ? ` Until ${new Date(g.shift.ends_on + "T00:00:00").toLocaleDateString()}` : ""}
                              </div>
                            )}
                            {g.shift.notes && <div style={{ fontSize: 13, color: colors.inkFaint, marginTop: 3 }}>{g.shift.notes}</div>}
                          </div>
                          <div style={{ display: "flex", gap: 6, flexShrink: 0, flexWrap: "wrap", justifyContent: "flex-end" }}>
                            <button onClick={() => editGroup(g)} aria-label={`Change the ${describeDays(g.days)} schedule`} style={smallButton}><Pencil size={13} /> Edit</button>
                            <button onClick={() => setOpenGroup((o) => ({ ...o, [g.key]: !days }))} aria-expanded={!!days} style={smallButton}>{days ? "Hide days" : "Single days"}</button>
                            <button onClick={() => setConfirming(`all-${g.key}`)} aria-label={`Remove the ${describeDays(g.days)} schedule`} style={{ ...smallButton, color: colors.rust }}><Trash2 size={13} /> Remove</button>
                          </div>
                        </div>
                        {confirming === `all-${g.key}` && (
                          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
                            <span style={{ fontSize: 13, color: colors.inkSoft }}>Remove this whole schedule ({describeDays(g.days)}, {g.rows.length} days)?</span>
                            <button onClick={() => removeMany(g.key, g.rows.map((r) => r.id))} disabled={busy} style={{ ...smallButton, background: colors.rust, color: "#fff", border: "none" }}>Yes, remove</button>
                            <button onClick={() => setConfirming(null)} style={smallButton}>Keep</button>
                          </div>
                        )}
                        {days && (
                          <div style={{ marginTop: 6, marginLeft: -18 }}>
                            {g.rows.map((r) => shiftLine(r, 18))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                  {sortShifts(oneOff).map((s) => shiftLine(s))}
                  <div style={{ borderTop: `1px solid ${colors.hairline}`, padding: "11px 18px" }}>
                    {confirming === `cg-${id}` ? (
                      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
                        <span style={{ fontSize: 13, color: colors.inkSoft, flex: "1 1 220px" }}>
                          Remove all {allIds.length} {allIds.length === 1 ? "shift" : "shifts"} for {byId[id] ? personName(byId[id]) : "this caregiver"}{filterPt !== "all" ? ` with ${patientName(filterPt)}` : ""}{endedCount > 0 ? `, including ${endedCount} that ${endedCount === 1 ? "has" : "have"} ended` : ""}? This can't be undone.
                        </span>
                        <button onClick={() => removeMany(`cg-${id}`, allIds)} disabled={busy} style={{ ...smallButton, background: colors.rust, color: "#fff", border: "none" }}>Yes, remove all</button>
                        <button onClick={() => setConfirming(null)} style={smallButton}>Keep</button>
                      </div>
                    ) : (
                      <div style={{ display: "flex", justifyContent: "flex-end" }}>
                        <button onClick={() => setConfirming(`cg-${id}`)} style={{ ...smallButton, color: colors.rust }}><Trash2 size={13} /> Remove all shifts ({allIds.length})</button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </Card>
          )
        })
      )}
      {view === "list" && endedShifts.length > 0 && (
        <button onClick={() => setShowEnded((v) => !v)} style={{ border: "none", background: "none", padding: "2px 4px 12px", color: colors.sageDeep, fontWeight: 700, fontSize: 13, textDecoration: "underline", cursor: "pointer" }}>
          {showEnded ? "Hide ended shifts" : `Show ${endedShifts.length} ended ${endedShifts.length === 1 ? "shift" : "shifts"}`}
        </button>
      )}
    </>
  )
}
