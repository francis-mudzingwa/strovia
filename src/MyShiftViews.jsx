import { useState, useMemo } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { occurrences, mondayOf, isoDate, fmtClock, dayLabel } from "./shifts.js"

// The three ways a caregiver can look at their own shifts: an improved list, a week grid (hours across) and a month calendar.
// Every patient gets a colour, so you see who as well as when. Read only.

const colors = {
  bg: "#FAF6EF", card: "#FFFFFF", hairline: "#E5DFD1", ink: "#20261F", inkSoft: "#5C6357", inkFaint: "#6B7266",
  sage: "#3F6C51", sageDeep: "#2C4E3A", sageTint: "#E3EBE0", gold: "#B98A2E", goldTint: "#F3E7CC", rust: "#A24632",
}
const PALETTE = ["#3F6C51", "#4C7A82", "#B98A2E", "#7A5C8A", "#8A5A44"]
const STRIPE = "repeating-linear-gradient(135deg, rgba(255,255,255,0.3) 0 4px, transparent 4px 8px)"
const DAY = 86400000
const shadow = "0 1px 3px rgba(32,38,31,0.06), 0 6px 16px rgba(32,38,31,0.05)"

// A stable colour for each patient the carer works with.
export function patientColorsFor(shifts) {
  const ids = [...new Set(shifts.map((s) => s.patient_id))].sort()
  return (id) => PALETTE[Math.max(0, ids.indexOf(id)) % PALETTE.length]
}

const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
const clock = (d) => fmtClock(`${d.getHours()}:${d.getMinutes()}`)
const endText = (o) => (o.start.toDateString() === o.end.toDateString() ? clock(o.end) : `${o.end.toLocaleDateString(undefined, { weekday: "short" })} ${clock(o.end)}`)
const hoursOf = (o) => (o.end - o.start) / 3600000
const hoursText = (h) => `${Math.round(h)} ${Math.round(h) === 1 ? "hour" : "hours"}`
const isNight = (o) => o.start.toDateString() !== o.end.toDateString() && hoursOf(o) < 24
const isLiveIn = (o) => hoursOf(o) >= 24
const short = (d) => { const h = d.getHours(); const m = d.getMinutes(); return `${h % 12 || 12}${m ? ":" + String(m).padStart(2, "0") : ""}${h < 12 ? "a" : "p"}` }

// Every shift that overlaps [from, to). Long shifts that began days earlier are included.
function inRange(shifts, from, to) {
  return occurrences(shifts, addDays(from, -15), Math.round((to - from) / DAY) + 15).filter((o) => o.end > from && o.start < to)
}
// The part of a shift that falls on one day, and whether it starts or ends there.
function segment(o, day) {
  const d0 = startOfDay(day)
  const d1 = addDays(d0, 1)
  const s = o.start > d0 ? o.start : d0
  const e = o.end < d1 ? o.end : d1
  if (e <= s) return null
  return { s, e, d0, startsHere: o.start >= d0, endsHere: o.end <= d1 }
}

function Tag({ children, tone = "gold" }) {
  const [bg, fg] = tone === "night" ? ["#E5E8F2", "#3A4A7A"] : [colors.goldTint, "#6B4D0E"]
  return <span style={{ display: "inline-block", fontSize: 11, fontWeight: 700, borderRadius: 999, padding: "1px 8px", background: bg, color: fg, marginLeft: 6, verticalAlign: 1 }}>{children}</span>
}

function Legend({ ids, nameOf, colorOf, note }) {
  return (
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 12.5, color: colors.inkSoft, margin: "2px 2px 8px" }}>
      {ids.map((id) => <span key={id}><i style={{ display: "inline-block", width: 10, height: 10, borderRadius: 3, background: colorOf(id), marginRight: 5, verticalAlign: -1 }} />{nameOf(id).split(" ")[0]}</span>)}
      {note && <span style={{ marginLeft: "auto" }}>{note}</span>}
    </div>
  )
}

function Nav({ label, onPrev, onNext, onToday, showToday }) {
  const btn = { border: `1px solid ${colors.hairline}`, background: "#fff", borderRadius: 9, padding: "6px 10px", cursor: "pointer", color: colors.inkSoft, display: "flex" }
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "0 0 8px" }}>
      <button onClick={onPrev} aria-label="Earlier" style={btn}><ChevronLeft size={16} /></button>
      <div style={{ flex: 1, textAlign: "center", fontFamily: "Fraunces, serif", fontSize: 17, fontWeight: 600, color: colors.ink }}>{label}</div>
      <button onClick={onNext} aria-label="Later" style={btn}><ChevronRight size={16} /></button>
      {showToday && <button onClick={onToday} style={{ ...btn, fontSize: 13, fontWeight: 700, color: colors.sageDeep }}>Today</button>}
    </div>
  )
}

/* ------------------------------------------------ list ------------------------------------------------ */

export function ListView({ now, upcoming, nameOf, colorOf, onOpen, regular }) {
  if (upcoming.length === 0) {
    return <p style={{ fontSize: 14, color: colors.inkSoft, margin: "6px 2px 14px" }}>Nothing else in the next two weeks.</p>
  }
  const next = upcoming[0]
  const thisMonday = mondayOf(now)
  const groups = []
  upcoming.forEach((o) => {
    const mon = mondayOf(o.start)
    const key = isoDate(mon)
    let g = groups.find((x) => x.key === key)
    if (!g) { g = { key, mon, items: [] }; groups.push(g) }
    g.items.push(o)
  })
  const label = (g) => {
    const diff = Math.round((g.mon - thisMonday) / (7 * DAY))
    return diff === 0 ? "This week" : diff === 1 ? "Next week" : `Week of ${g.mon.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
  }
  const mins = Math.round((next.start - now) / 60000)
  const startsIn = mins < 0 ? "" : mins < 60 ? ` · starts in ${mins} min` : mins < 24 * 60 ? ` · starts in ${Math.round(mins / 60)} ${Math.round(mins / 60) === 1 ? "hour" : "hours"}` : ""
  const totalHours = upcoming.reduce((n, o) => n + hoursOf(o), 0)

  return (
    <>
      <button onClick={() => onOpen?.(next.shift.patient_id)} style={{ display: "block", width: "100%", textAlign: "left", font: "inherit", cursor: "pointer", border: "none", background: colors.sageTint, borderRadius: 16, padding: "12px 14px", marginBottom: 6 }}>
        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.6, color: colors.sageDeep, textTransform: "uppercase" }}>Next · {dayLabel(next.start, now).toLowerCase()}</div>
        <div style={{ fontSize: 18, fontWeight: 700, color: colors.ink, marginTop: 3 }}>{nameOf(next.shift.patient_id)}</div>
        <div style={{ fontSize: 13, color: colors.inkSoft }}>{next.start.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} · {clock(next.start)} to {endText(next)}{startsIn}</div>
      </button>

      {groups.map((g) => {
        const gh = g.items.reduce((n, o) => n + hoursOf(o), 0)
        return (
          <div key={g.key}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, fontWeight: 700, letterSpacing: 0.5, color: colors.inkFaint, textTransform: "uppercase", margin: "12px 3px 6px" }}>
              {label(g)} <span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 600 }}>{g.items.length} {g.items.length === 1 ? "shift" : "shifts"} · {hoursText(gh)}</span>
            </div>
            <div style={{ background: "#fff", borderRadius: 16, padding: "2px 12px", boxShadow: shadow }}>
              {g.items.map((o, i) => {
                const showDate = i === 0 || g.items[i - 1].start.toDateString() !== o.start.toDateString()
                const today = o.start.toDateString() === now.toDateString()
                return (
                  <button key={o.shift.id + o.start.getTime()} onClick={() => onOpen?.(o.shift.patient_id)}
                    style={{ display: "flex", gap: 11, alignItems: "stretch", width: "100%", textAlign: "left", font: "inherit", cursor: "pointer", background: "none", border: "none", borderTop: i ? `1px solid ${colors.hairline}` : "none", padding: "9px 0" }}>
                    <div style={{ width: 40, flexShrink: 0, textAlign: "center", fontSize: 12, fontWeight: 700, lineHeight: 1.15, color: today ? colors.sageDeep : colors.inkFaint, alignSelf: "center" }}>
                      {showDate && (<>{o.start.toLocaleDateString(undefined, { weekday: "short" })}<div style={{ fontSize: 17, color: today ? colors.sageDeep : colors.ink }}>{o.start.getDate()}</div></>)}
                    </div>
                    <span style={{ width: 5, borderRadius: 4, background: colorOf(o.shift.patient_id), flexShrink: 0 }} />
                    <div style={{ minWidth: 0, alignSelf: "center" }}>
                      <div style={{ fontSize: 14.5, fontWeight: 700, color: colors.ink }}>
                        {nameOf(o.shift.patient_id)}
                        {isLiveIn(o) ? <Tag>Live-in</Tag> : isNight(o) ? <Tag tone="night">Night</Tag> : null}
                      </div>
                      <div style={{ fontSize: 13, color: colors.inkSoft }}>{clock(o.start)} to {endText(o)} · {hoursText(hoursOf(o))}</div>
                      {o.shift.notes && <div style={{ fontSize: 13, color: colors.inkSoft, background: colors.goldTint, borderRadius: 8, padding: "5px 9px", marginTop: 5, lineHeight: 1.45 }}>{o.shift.notes}</div>}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}
      <div style={{ fontSize: 12.5, color: colors.inkSoft, textAlign: "center", margin: "10px 0 12px" }}>Next 14 days: {upcoming.length} {upcoming.length === 1 ? "shift" : "shifts"} · {hoursText(totalHours)}</div>
      {regular}
    </>
  )
}

/* ------------------------------------------------ week grid ------------------------------------------------ */

export function WeekGrid({ now, shifts, nameOf, colorOf, onOpen }) {
  const [offset, setOffset] = useState(0)
  const first = addDays(mondayOf(now), offset * 7)
  const end = addDays(first, 14)
  const days = Array.from({ length: 14 }, (_, i) => addDays(first, i))
  const occs = useMemo(() => inRange(shifts, first, end), [shifts, offset, now.getDate()]) // eslint-disable-line react-hooks/exhaustive-deps
  const ids = [...new Set(occs.map((o) => o.shift.patient_id))]
  const weekStats = (w) => {
    const from = addDays(first, w * 7)
    const to = addDays(from, 7)
    const list = occs.filter((o) => o.start >= from && o.start < to)
    return `${list.length} ${list.length === 1 ? "shift" : "shifts"} · ${hoursText(list.reduce((n, o) => n + hoursOf(o), 0))}`
  }
  const range = `${first.toLocaleDateString(undefined, { month: "short", day: "numeric" })} to ${addDays(end, -1).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`

  return (
    <div>
      <Nav label={range} onPrev={() => setOffset((o) => o - 1)} onNext={() => setOffset((o) => o + 1)} onToday={() => setOffset(0)} showToday={offset !== 0} />
      <Legend ids={ids} nameOf={nameOf} colorOf={colorOf} note="striped = night" />
      <div style={{ display: "flex", justifyContent: "space-between", margin: "0 0 2px 58px", fontSize: 10, color: colors.inkFaint }}><span>12a</span><span>6a</span><span>12p</span><span>6p</span><span>12a</span></div>
      {days.map((d, i) => {
        const isToday = d.toDateString() === now.toDateString()
        const segs = occs.map((o) => ({ o, seg: segment(o, d) })).filter((x) => x.seg).sort((a, b) => a.seg.s - b.seg.s)
        return (
          <div key={isoDate(d)}>
            {(i === 0 || i === 7) && (
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, fontWeight: 700, letterSpacing: 0.5, color: colors.inkFaint, textTransform: "uppercase", margin: "10px 2px 5px" }}>
                {offset + i / 7 === 0 ? "This week" : offset + i / 7 === 1 ? "Next week" : `Week of ${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`}
                <span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 600 }}>{weekStats(i / 7)}</span>
              </div>
            )}
            <div style={{ display: "flex", alignItems: "center", gap: 8, height: 34 }}>
              <div style={{ width: 50, fontSize: 11.5, fontWeight: 700, lineHeight: 1.05, color: isToday ? colors.sageDeep : colors.inkSoft }}>
                {d.toLocaleDateString(undefined, { weekday: "short" })}<b style={{ display: "block", fontSize: 14, color: colors.ink }}>{d.getDate()}</b>
              </div>
              <div style={{ flex: 1, position: "relative", height: 26, borderRadius: 7, border: `1px solid ${isToday ? colors.sage : colors.hairline}`, background: isToday ? colors.sageTint : "#fff", overflow: "visible" }}>
                {[25, 50, 75].map((p) => <span key={p} style={{ position: "absolute", left: `${p}%`, top: 0, bottom: 0, width: 1, background: "#EFEADF" }} />)}
                {segs.map(({ o, seg }) => {
                  const left = ((seg.s - seg.d0) / DAY) * 100
                  const width = ((seg.e - seg.s) / DAY) * 100
                  const who = nameOf(o.shift.patient_id).split(" ")[0]
                  const text = seg.startsHere && seg.endsHere ? `${who} ${short(o.start)}–${short(o.end)}`
                    : seg.startsHere ? (width > 40 ? `${who} ${short(o.start)} to ${o.end.toLocaleDateString(undefined, { weekday: "short" })} ${short(o.end)}` : who)
                    : seg.endsHere ? `${width > 22 ? who + " " : ""}until ${short(o.end)}` : `${who}, all day`
                  return (
                    <button key={o.shift.id + o.start.getTime()} onClick={() => onOpen?.(o.shift.patient_id)} title={`${nameOf(o.shift.patient_id)}, ${clock(o.start)} to ${endText(o)}`}
                      style={{ position: "absolute", top: 2, bottom: 2, left: `${left}%`, width: `${width}%`, border: "none", cursor: "pointer", padding: "0 5px", textAlign: "left", font: "inherit", fontSize: 10, fontWeight: 700, color: "#fff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                        background: colorOf(o.shift.patient_id), backgroundImage: isNight(o) ? STRIPE : "none", opacity: o.end < now ? 0.55 : 1,
                        borderRadius: `${seg.startsHere ? 5 : 0}px ${seg.endsHere ? 5 : 0}px ${seg.endsHere ? 5 : 0}px ${seg.startsHere ? 5 : 0}px` }}>
                      {text}
                    </button>
                  )
                })}
                {isToday && <span style={{ position: "absolute", top: -3, bottom: -3, width: 2, borderRadius: 2, background: colors.rust, left: `${((now - startOfDay(now)) / DAY) * 100}%` }} />}
              </div>
            </div>
          </div>
        )
      })}
      <div style={{ fontSize: 12.5, color: colors.inkSoft, textAlign: "center", margin: "8px 0 12px" }}>Red line = now. Tap a bar to open the patient.</div>
    </div>
  )
}

/* ------------------------------------------------ month calendar ------------------------------------------------ */

export function MonthGrid({ now, shifts, nameOf, colorOf, onOpen }) {
  const [offset, setOffset] = useState(0)
  const [sel, setSel] = useState(null)
  const m0 = new Date(now.getFullYear(), now.getMonth() + offset, 1)
  const daysInMonth = new Date(m0.getFullYear(), m0.getMonth() + 1, 0).getDate()
  const gridStart = mondayOf(m0)
  const weeks = Math.ceil((daysInMonth + ((m0.getDay() + 6) % 7)) / 7)
  const cells = Array.from({ length: weeks * 7 }, (_, i) => addDays(gridStart, i))
  const occs = useMemo(() => inRange(shifts, gridStart, addDays(gridStart, weeks * 7)), [shifts, offset, now.getDate()]) // eslint-disable-line react-hooks/exhaustive-deps
  const ids = [...new Set(occs.map((o) => o.shift.patient_id))]
  const inMonth = (d) => d.getMonth() === m0.getMonth()
  const todayInMonth = now.getFullYear() === m0.getFullYear() && now.getMonth() === m0.getMonth()
  const selDay = sel && inMonth(new Date(sel + "T00:00:00")) ? new Date(sel + "T00:00:00") : todayInMonth ? startOfDay(now) : m0
  const selShifts = occs.filter((o) => segment(o, selDay)).sort((a, b) => a.start - b.start)
  const monthName = m0.toLocaleDateString(undefined, { month: "long", year: "numeric" })

  return (
    <div>
      <Nav label={monthName} onPrev={() => { setOffset((o) => o - 1); setSel(null) }} onNext={() => { setOffset((o) => o + 1); setSel(null) }} onToday={() => { setOffset(0); setSel(null) }} showToday={offset !== 0} />
      <Legend ids={ids} nameOf={nameOf} colorOf={colorOf} note="striped = night" />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 3 }}>
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((w) => <div key={w} style={{ textAlign: "center", fontSize: 11, fontWeight: 700, color: colors.inkFaint, paddingBottom: 2 }}>{w}</div>)}
        {cells.map((d, i) => {
          if (!inMonth(d)) return <div key={i} />
          const iso = isoDate(d)
          const isToday = d.toDateString() === now.toDateString()
          const isSel = d.toDateString() === selDay.toDateString()
          const here = occs.map((o) => ({ o, seg: segment(o, d) })).filter((x) => x.seg).sort((a, b) => a.seg.s - b.seg.s)
          const past = d < startOfDay(now)
          const col = i % 7
          return (
            <button key={iso} onClick={() => setSel(iso)} aria-pressed={isSel}
              aria-label={`${d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}: ${here.length ? here.map(({ o }) => `${nameOf(o.shift.patient_id)} ${clock(o.start)} to ${endText(o)}`).join(", ") : "no shift"}`}
              style={{ minHeight: 58, padding: "3px 0 3px", borderRadius: 8, textAlign: "left", font: "inherit", cursor: "pointer", position: "relative", overflow: "visible",
                border: isToday ? `2px solid ${colors.sage}` : `1px solid ${isSel ? colors.sage : colors.hairline}`, background: isSel ? colors.sageTint : "#fff", opacity: past ? 0.6 : 1 }}>
              <div style={{ fontSize: 11.5, fontWeight: 700, paddingLeft: 4, color: colors.ink }}>{d.getDate()}</div>
              {here.slice(0, 3).map(({ o, seg }) => {
                const leftCont = !seg.startsHere
                const rightCont = !seg.endsHere
                const who = nameOf(o.shift.patient_id).trim()
                return (
                  <div key={o.shift.id + o.start.getTime()} style={{ height: 15, margin: "2px 3px 0", marginLeft: leftCont ? -4 : 3, marginRight: rightCont ? -4 : 3, paddingLeft: leftCont ? 8 : 4,
                    borderRadius: `${leftCont ? 0 : 4}px ${rightCont ? 0 : 4}px ${rightCont ? 0 : 4}px ${leftCont ? 0 : 4}px`, background: colorOf(o.shift.patient_id), backgroundImage: isNight(o) ? STRIPE : "none",
                    color: "#fff", fontSize: 9.5, fontWeight: 700, lineHeight: "15px", whiteSpace: "nowrap", overflow: "hidden" }}>
                    {seg.startsHere || col === 0 ? who.charAt(0).toUpperCase() : ""}
                  </div>
                )
              })}
              {here.length > 3 && <div style={{ fontSize: 10, color: colors.inkFaint, paddingLeft: 4 }}>+{here.length - 3}</div>}
            </button>
          )
        })}
      </div>

      <div style={{ background: "#fff", borderRadius: 16, padding: "11px 13px", marginTop: 10, boxShadow: shadow }}>
        <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: 0.5, color: colors.inkFaint, textTransform: "uppercase", marginBottom: 4 }}>
          {selDay.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}{selDay.toDateString() === now.toDateString() ? " · today" : ""}
        </div>
        {selShifts.length === 0 && <div style={{ fontSize: 13.5, color: colors.inkSoft, padding: "4px 0" }}>No shift this day.</div>}
        {selShifts.map((o, i) => (
          <button key={o.shift.id + o.start.getTime()} onClick={() => onOpen?.(o.shift.patient_id)}
            style={{ display: "flex", gap: 10, alignItems: "stretch", width: "100%", textAlign: "left", font: "inherit", cursor: "pointer", background: "none", border: "none", borderTop: i ? `1px solid ${colors.hairline}` : "none", padding: "7px 0" }}>
            <span style={{ width: 5, borderRadius: 4, background: colorOf(o.shift.patient_id), flexShrink: 0 }} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 14.5, fontWeight: 700, color: colors.ink }}>{nameOf(o.shift.patient_id)}{isLiveIn(o) ? <Tag>Live-in</Tag> : isNight(o) ? <Tag tone="night">Night</Tag> : null}</div>
              <div style={{ fontSize: 13, color: colors.inkSoft }}>{o.start.toDateString() === selDay.toDateString() ? clock(o.start) : `${o.start.toLocaleDateString(undefined, { weekday: "short" })} ${clock(o.start)}`} to {endText(o)} · {hoursText(hoursOf(o))}</div>
              {o.shift.notes && <div style={{ fontSize: 13, color: colors.inkSoft, background: colors.goldTint, borderRadius: 8, padding: "5px 9px", marginTop: 5, lineHeight: 1.45 }}>{o.shift.notes}</div>}
            </div>
          </button>
        ))}
      </div>
      <div style={{ fontSize: 12.5, color: colors.inkSoft, textAlign: "center", margin: "8px 0 12px" }}>Tap any day to see it.</div>
    </div>
  )
}
