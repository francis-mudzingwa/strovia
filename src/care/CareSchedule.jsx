import { CalendarClock } from "lucide-react"
import { occurrences } from "../shifts.js"
import { Card, colors, fmtTime } from "./ui.jsx"

const dayLabel = (d, now) => {
  const a = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const b = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const diff = Math.round((a - b) / 86400000)
  if (diff === 0) return "Today"
  if (diff === 1) return "Tomorrow"
  return d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })
}

// For family proxies: who is looking after their relative over the next week. The private notes on a shift
// (such as where a key is kept) never reach this screen.
export default function CareSchedule({ patientId, schedule, personName, firstName }) {
  if (!schedule) return null
  const now = new Date()
  const upcoming = occurrences(schedule, now, 7).slice(0, 10)
  return (
    <Card className="no-print">
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <CalendarClock size={17} color={colors.sageDeep} />
        <div style={{ fontFamily: "Fraunces, serif", fontSize: 17, fontWeight: 600, color: colors.ink }}>Who is caring for {firstName}</div>
      </div>
      {upcoming.length === 0 ? (
        <p style={{ margin: 0, fontSize: 13.5, color: colors.inkSoft }}>No shifts are set for the next 7 days. The office arranges these.</p>
      ) : upcoming.map((o, i) => {
        const onNow = o.start <= now && now < o.end
        return (
          <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "7px 0", borderTop: i ? `1px solid ${colors.hairline}` : "none", fontSize: 13.5, color: colors.ink }}>
            <span>
              <strong>{personName(patientId, o.shift.caregiver_id) || "A caregiver"}</strong>
              {onNow && <span style={{ marginLeft: 8, fontSize: 12.5, fontWeight: 700, color: colors.sageDeep, background: colors.sageTint, borderRadius: 6, padding: "2px 7px" }}>On now</span>}
            </span>
            <span style={{ color: colors.inkSoft, textAlign: "right" }}>{dayLabel(o.start, now)}, {fmtTime(o.start)} to {fmtTime(o.end)}</span>
          </div>
        )
      })}
    </Card>
  )
}
