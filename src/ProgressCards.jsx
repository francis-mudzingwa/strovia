import { useState } from "react"
import { ChevronDown } from "lucide-react"
import { Card, colors, fmtTime } from "./care/ui.jsx"
import { changeShort, disagreements, periodChange, dayKeyOf } from "./progress.js"
import { reasonLabel } from "./care/exercises.js"
import { Avatar } from "./Avatar.jsx"

const LEVEL_WORD = ["none", "mild", "moderate", "severe"]
const AMBER_TEXT = "#6B4D0E"
const initialsOf = (name) => (String(name).split(/\s+/).map((w) => w[0]).join("").slice(0, 2) || "?").toUpperCase()
const nice = (key) => new Date(`${key}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })
const joinNames = (names) => (names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`)
const AVATAR_TONES = [[colors.sageTint, colors.sageDeep], [colors.tealTint, colors.teal], [colors.goldTint, AMBER_TEXT], ["#EFE6F2", "#6A4A7A"]]

// A coloured tag for "Up 13 points" / "Down 11 points" / "No change".
function ChangeTag({ delta, words }) {
  const [bg, fg] = delta > 0 ? [colors.sageTint, colors.sageDeep] : delta < 0 ? [colors.rustTint, "#7A2E1E"] : [colors.bg, colors.inkSoft]
  return <span style={{ fontSize: 13, fontWeight: 700, borderRadius: 999, padding: "5px 11px", whiteSpace: "nowrap", background: bg, color: fg, flexShrink: 0 }}>{words}</span>
}

// A heading that opens and closes a part of the card, so the detail is there when wanted and out of the way otherwise.
function Fold({ title, count, open, onToggle, children }) {
  return (
    <div style={{ borderTop: `1px solid ${colors.hairline}`, marginTop: 10 }}>
      <button onClick={onToggle} aria-expanded={open} style={{ display: "flex", width: "100%", alignItems: "center", justifyContent: "space-between", border: "none", background: "none", padding: "11px 0 3px", cursor: "pointer", fontFamily: "inherit" }}>
        <span style={{ fontSize: 13.5, fontWeight: 700, color: colors.sageDeep }}>{title}</span>
        <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13, color: colors.inkFaint }}>
          {count !== undefined && count}
          <ChevronDown size={15} style={{ transform: open ? "rotate(180deg)" : "none" }} />
        </span>
      </button>
      {open && <div style={{ paddingTop: 6 }}>{children}</div>}
    </div>
  )
}

const BAR_GREEN = 70
const BAR_AMBER = 50

// The recovery card: the score and what changed first, who it is based on, one bar for each day from the first check-in, up to 14 (green at 70
// and above, amber 50 to 69, red below 50; a day nobody checked in is an empty dashed box), a note where people disagreed,
// and the detail (each person's check-in, how the score is worked out) folded away until asked for.
export function RecoveryCard({ days, latestScore, incidents = [], actions = [], symptoms, infoOf, now = new Date() }) {
  const [picked, setPicked] = useState(null)
  const [openCheckins, setOpenCheckins] = useState(false)
  const [openHow, setOpenHow] = useState(false)
  const todayKey = dayKeyOf(now)
  // The chart starts at the first day that has a check-in within the last 14 days, so it is not padded with empty days before
  // the first bar (even when the patient has much older check-ins, from weeks ago, that are no longer on the chart).
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const earliestShown = dayKeyOf(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 13))
  const recentDays = days.filter((d) => d.date >= earliestShown)
  const firstRecord = recentDays.length ? recentDays[0] : days[days.length - 1] || null
  const firstDay = firstRecord ? new Date(`${firstRecord.date}T00:00:00`) : startOfToday
  const SPAN = Math.max(1, Math.min(14, Math.round((startOfToday - firstDay) / 86400000) + 1))
  const window = Array.from({ length: SPAN }, (_, i) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - (SPAN - 1 - i)))
  const byDate = Object.fromEntries(days.map((d) => [d.date, d]))
  const points = window.map((d) => ({ date: d, key: dayKeyOf(d), day: byDate[dayKeyOf(d)] || null }))
  const latestDay = days[days.length - 1] || null
  const shown = (picked && byDate[picked]) || latestDay
  const change = periodChange(days, now)

  const X0 = 34, X1 = 380, Y0 = 12, Y1 = 112
  // With only a few days the bars sit close together in the middle instead of being stretched across the whole chart.
  const fullWidth = X1 - X0 - 24
  const step = SPAN >= 8 ? fullWidth / (SPAN - 1) : Math.min(56, SPAN > 1 ? fullWidth / (SPAN - 1) : 0)
  const startX = SPAN >= 8 ? X0 + 12 : (X0 + X1) / 2 - (step * (SPAN - 1)) / 2
  const xs = points.map((_, i) => startX + i * step)
  const bw = SPAN <= 6 ? 26 : 17
  const h = (s) => (Math.max(0, Math.min(100, s)) * (Y1 - Y0)) / 100
  const colorOf = (s) => (s >= BAR_GREEN ? colors.sage : s >= BAR_AMBER ? colors.gold : colors.rust)
  const incidentDays = new Set(incidents.map((i) => dayKeyOf(new Date(i.happened_at))))
  const actionDays = new Set(actions.map((a) => a.entry_date))
  const hasMissing = points.some((p) => !p.day)

  const isToday = shown && shown.date === todayKey
  const whenWord = isToday ? "today" : "that day"
  const labelOf = (key) => symptoms.find((s) => s.key === key)?.label.split(" ")[0] || key
  const diffs = shown ? disagreements(shown, symptoms.map((s) => s.key)) : []
  const summary = (s) => {
    const active = symptoms.filter((x) => Number(s?.[x.key] ?? 0) > 0)
    return active.length === 0 ? "No symptoms" : active.map((x) => `${labelOf(x.key)} ${LEVEL_WORD[Number(s[x.key])]}`).join(", ")
  }
  const dot = (bg, round) => ({ display: "inline-block", width: 9, height: 9, borderRadius: round ? 99 : 3, background: bg, marginRight: 4 })

  return (
    <Card style={{ padding: "20px 20px 14px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
        <div>
          <h2 style={{ fontFamily: "Fraunces, serif", fontSize: 19, fontWeight: 600, color: colors.ink, margin: 0 }}>Recovery</h2>
          <div style={{ fontSize: 13, color: colors.inkFaint, marginTop: 1 }}>{latestDay ? (latestDay.date === todayKey ? "Today" : `On ${nice(latestDay.date)}`) : "No check-ins yet"}{change ? ", compared with the 7 days before" : ""}</div>
        </div>
        {change && <ChangeTag delta={change.delta} words={changeShort(change.delta)} />}
      </div>
      <div style={{ fontFamily: "Fraunces, serif", fontSize: 38, fontWeight: 600, color: colors.sageDeep, lineHeight: 1, marginTop: 8 }}>
        {latestScore ?? "—"} <span style={{ fontSize: 15, color: colors.inkFaint, fontFamily: "Inter, sans-serif" }}>/ 100</span>
      </div>
      {latestDay && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "10px 0 4px", fontSize: 13, color: colors.inkSoft }}>
          <span style={{ display: "flex" }}>
            {latestDay.people.slice(0, 4).map((p, i) => {
              const info = infoOf(p.id)
              const [bg, fg] = AVATAR_TONES[i % AVATAR_TONES.length]
              return <Avatar key={`${p.id}${i}`} userId={p.id} name={info.name} title={info.name} size={26} fontSize={12.5} tone={[bg, fg]} style={{ border: "2px solid #fff", marginLeft: i ? -4 : 0 }} />
            })}
          </span>
          {latestDay.people.length} {latestDay.people.length === 1 ? "check-in" : "check-ins"}{latestDay.date === todayKey ? " today" : ` on ${nice(latestDay.date)}`}{latestDay.people.length > 1 ? ", averaged" : ""}
        </div>
      )}

      {days.length === 0 ? (
        <p style={{ fontSize: 13, color: colors.inkFaint, margin: "14px 0 4px" }}>Save the first check-in to start the recovery trend.</p>
      ) : (
        <>
          <svg viewBox="0 0 392 160" width="100%" role="img" aria-label="Recovery score for each day, starting from the first check-in" style={{ display: "block", marginTop: 8 }}>
            {[100, 50, 0].map((v) => (
              <g key={v}>
                <line x1={X0} x2={X1} y1={Y1 - h(v)} y2={Y1 - h(v)} stroke="#EEE9DC" />
                <text x={X0 - 6} y={Y1 - h(v) + 3.5} fontSize="11" fill={colors.inkFaint} textAnchor="end">{v}</text>
              </g>
            ))}
            {points.map((p, i) => {
              if (!p.day) return <rect key={p.key} x={xs[i] - bw / 2} y={Y1 - 14} width={bw} height={14} rx={4} fill="none" stroke="#D8D1C0" strokeDasharray="2 3" />
              const s = p.day.score
              const selected = shown && shown.date === p.key
              const marker = incidentDays.has(p.key) ? colors.rust : actionDays.has(p.key) ? colors.gold : null
              return (
                <g key={p.key} role="button" tabIndex={0} aria-label={`${nice(p.key)}: score ${s}`} style={{ cursor: "pointer", outline: "none" }}
                  onClick={() => setPicked(p.key)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setPicked(p.key) }}>
                  <rect x={xs[i] - bw / 2 - 3} y={Y0 - 6} width={bw + 6} height={Y1 - Y0 + 6} fill="transparent" />
                  <rect x={xs[i] - bw / 2} y={Y1 - h(s)} width={bw} height={h(s)} rx={4} fill={colorOf(s)} stroke={selected ? colors.ink : "none"} strokeWidth={selected ? 1.5 : 0} />
                  {marker && <circle cx={xs[i]} cy={Y1 - h(s) - 8} r="4" fill={marker} />}
                  {(selected || p.key === todayKey) && <text x={xs[i]} y={Y1 - h(s) - (marker ? 16 : 7)} fontSize="12" fontWeight="700" fill={colors.sageDeep} textAnchor="middle">{s}</text>}
                </g>
              )
            })}
            {points.map((p, i) => {
              const today = p.key === todayKey
              const fill = today ? colors.sageDeep : colors.inkFaint
              const first = i === 0 || p.date.getDate() === 1
              return (
                <g key={p.key}>
                  <text x={xs[i]} y="132" fontSize="11" fill={fill} fontWeight={today ? 700 : 400} textAnchor="middle">{p.date.toLocaleDateString(undefined, { weekday: "short" }).slice(0, 1)}</text>
                  <text x={xs[i]} y="144" fontSize="11" fill={fill} fontWeight={today ? 700 : 400} textAnchor="middle">{p.date.getDate()}</text>
                  {first && <text x={xs[i]} y="157" fontSize="11" fill={colors.inkSoft} fontWeight="700" textAnchor="middle">{p.date.toLocaleDateString(undefined, { month: "short" })}</text>}
                </g>
              )
            })}
          </svg>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, fontSize: 12.5, color: colors.inkFaint, margin: "6px 0 2px" }}>
            <span><i style={dot(colors.sage)} />{BAR_GREEN} and above</span>
            <span><i style={dot(colors.gold)} />{BAR_AMBER} to {BAR_GREEN - 1}</span>
            <span><i style={dot(colors.rust)} />Below {BAR_AMBER}</span>
            {hasMissing && <span>Dashed box: no check-in</span>}
            {incidents.length > 0 && <span><i style={dot(colors.rust, true)} />Incident</span>}
            {actions.length > 0 && <span><i style={dot(colors.gold, true)} />Action taken</span>}
          </div>
          <div style={{ fontSize: 13, color: colors.inkSoft, background: colors.bg, borderRadius: 10, padding: "8px 11px", marginTop: 8 }}>
            {picked && shown ? <><strong>{nice(shown.date)}{isToday ? " (today)" : ""}:</strong> score {shown.score} from {shown.people.length} {shown.people.length === 1 ? "check-in" : "check-ins"}.</> : "Tap any bar to see that day."}
          </div>
        </>
      )}

      {diffs.length > 0 && (
        <button onClick={() => setOpenCheckins(true)} style={{ display: "block", width: "100%", textAlign: "left", fontFamily: "inherit", fontSize: 13, lineHeight: 1.4, color: colors.ink, background: "#FBF5E6", border: "none", borderLeft: `4px solid ${colors.gold}`, borderRadius: 10, padding: "8px 11px", marginTop: 8, cursor: "pointer" }}>
          <strong>{joinNames(diffs.slice(0, 2).map((d) => labelOf(d.key)))} {diffs.length === 1 ? "was" : "were"} rated differently {whenWord}.</strong> Tap to see who rated what.
        </button>
      )}

      {shown && (
        <Fold title={isToday ? "Today's check-ins" : `Check-ins on ${nice(shown.date)}`} count={shown.people.length} open={openCheckins} onToggle={() => setOpenCheckins((o) => !o)}>
          {shown.people.map((p, i) => {
            const info = infoOf(p.id)
            return (
              <div key={`${p.id}${i}`} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "8px 0", borderTop: i ? `1px solid ${colors.hairline}` : "none" }}>
                <Avatar userId={p.id} name={info.name} size={30} fontSize={12} tone={AVATAR_TONES[i % AVATAR_TONES.length]} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: colors.ink }}>{info.name} <span style={{ fontWeight: 400, color: colors.inkFaint, fontSize: 13 }}>{[info.role, fmtTime(p.at)].filter(Boolean).join(", ")}</span></div>
                  <div style={{ fontSize: 13, color: colors.inkSoft, marginTop: 1 }}>{summary(p.symptoms)}</div>
                </div>
                <span style={{ fontSize: 15, fontWeight: 700, color: colors.sageDeep }}>{p.score}</span>
              </div>
            )
          })}
          {diffs.map((d) => (
            <div key={d.key} style={{ fontSize: 13, lineHeight: 1.45, color: colors.ink, marginTop: 6 }}>
              <strong>{labelOf(d.key)}:</strong> {d.groups.map((g) => `${LEVEL_WORD[g.level]} by ${joinNames(g.ids.map((id) => infoOf(id).name))}`).join(", ")}.
            </div>
          ))}
        </Fold>
      )}
      <Fold title="How this score is worked out" open={openHow} onToggle={() => setOpenHow((o) => !o)}>
        <div style={{ fontSize: 13, color: colors.inkSoft, lineHeight: 1.55 }}>
          It is built from everyone's check-ins, not only the last one saved: symptoms count most, then how the patient is feeling, then the pain score. Where several people checked in on a day, their ratings are averaged.
          Incidents and what was done after severe symptoms show as dots above the bars; they do not change the number. A severe rating from anyone still shows the emergency buttons.
        </div>
      </Fold>
    </Card>
  )
}

// The second score: was the care plan carried out in the last seven finished days?
export function CarePlanCard({ care }) {
  const [openMissed, setOpenMissed] = useState(false)
  if (care.total === 0) {
    return (
      <Card>
        <h3 style={{ fontFamily: "Fraunces, serif", fontSize: 18, fontWeight: 600, color: colors.ink, margin: "0 0 4px" }}>Care plan followed</h3>
        <p style={{ fontSize: 13, color: colors.inkFaint, margin: 0, lineHeight: 1.5 }}>Nothing was due in the last 7 days. Add medications, tasks or exercises to the care plan to see how well it is followed.</p>
      </Card>
    )
  }
  const areas = Object.values(care.areas)
  const m = care.missed
  const medGroups = {}
  for (const x of m.meds) (medGroups[x.name] ||= []).push(x)
  const lines = []
  for (const [name, list] of Object.entries(medGroups)) {
    const times = list.sort((a, b) => a.due - b.due).map((x) => `${x.due.toLocaleDateString(undefined, { weekday: "short" })} ${fmtTime(x.due)}${x.refused ? " (refused)" : ""}`)
    lines.push({ title: `${name} not given, ${list.length}`, detail: `${times.slice(0, 3).join(", ")}${times.length > 3 ? ` and ${times.length - 3} more` : ""}` })
  }
  if (m.exerciseSkippedCount > 0) {
    const why = m.exerciseSkips.map((r) => `${r.count} ${reasonLabel(r.reason).toLowerCase()}`).join(", ")
    lines.push({ title: `Exercises skipped, ${m.exerciseSkippedCount}`, detail: why || undefined })
  }
  if (m.exerciseNotRecorded > 0) lines.push({ title: `Exercises not recorded, ${m.exerciseNotRecorded}`, detail: "Nobody ticked them or gave a reason" })
  for (const v of m.visitsMissed) lines.push({ title: `${[v.visit.visit_type, v.visit.visitor_name].filter(Boolean).join(", ")} did not happen`, detail: `${nice(dayKeyOf(v.when))}${v.reason ? `: ${String(v.reason).replace("_", " ")}` : ""}` })
  if (m.visitsUnconfirmed > 0) lines.push({ title: `${m.visitsUnconfirmed} ${m.visitsUnconfirmed === 1 ? "visit" : "visits"} not confirmed`, detail: "Not counted either way until someone says whether it happened" })

  return (
    <Card style={{ padding: "20px 20px 14px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
        <div>
          <h3 style={{ fontFamily: "Fraunces, serif", fontSize: 19, fontWeight: 600, color: colors.ink, margin: 0 }}>Care plan followed</h3>
          <div style={{ fontSize: 13, color: colors.inkFaint, marginTop: 1 }}>Last 7 days{care.change !== null ? ", compared with the week before" : ""}</div>
        </div>
        {care.change !== null && <ChangeTag delta={care.change} words={changeShort(care.change)} />}
      </div>
      <div style={{ fontFamily: "Fraunces, serif", fontSize: 38, fontWeight: 600, color: colors.sageDeep, lineHeight: 1, marginTop: 8 }}>{care.percent}<span style={{ fontSize: 15, color: colors.inkFaint, fontFamily: "Inter, sans-serif" }}>%</span></div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 12 }}>
        {areas.map((a) => {
          const low = a.total > 0 && a.done / a.total < 0.8
          return (
            <div key={a.label} style={{ background: colors.bg, borderRadius: 12, padding: "9px 11px" }}>
              {a.total ? (
                <div style={{ fontSize: 17, fontWeight: 700, color: low ? AMBER_TEXT : colors.sageDeep }}>{a.done} <span style={{ fontSize: 13, fontWeight: 600, color: colors.inkSoft }}>of {a.total}</span></div>
              ) : (
                <div style={{ fontSize: 14, fontWeight: 600, color: colors.inkFaint, padding: "2px 0" }}>None due</div>
              )}
              <div style={{ fontSize: 12.5, color: colors.inkSoft }}>{a.label} {a.unit}</div>
            </div>
          )
        })}
      </div>
      <Fold title="Missed in the last 7 days" count={lines.length || undefined} open={openMissed} onToggle={() => setOpenMissed((o) => !o)}>
        {lines.length === 0 ? (
          <div style={{ background: colors.sageTint, borderRadius: 12, padding: "10px 12px", fontSize: 13.5, fontWeight: 700, color: colors.sageDeep }}>Nothing missed. The plan was followed.</div>
        ) : lines.map((l, i) => (
          <div key={i} style={{ padding: "8px 0", borderTop: i ? `1px solid ${colors.hairline}` : "none" }}>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: colors.ink }}>{l.title}</div>
            {l.detail && <div style={{ fontSize: 13, color: colors.inkSoft, marginTop: 1, lineHeight: 1.4 }}>{l.detail}</div>}
          </div>
        ))}
      </Fold>
    </Card>
  )
}
