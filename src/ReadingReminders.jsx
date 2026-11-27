import { useState, useEffect } from "react"
import { AlertTriangle, ChevronRight } from "lucide-react"
import { supabase } from "./supabaseClient.js"
import { Card, colors, fmtWhen } from "./care/ui.jsx"
import { hasRanges, everyWords, READING_NAME } from "./care/ranges.js"

const AMBER = "#6B4D0E"

// The administrator's two reminders about readings: patients whose care plan has no levels (so nothing they record is ever
// flagged), and readings that are overdue by the care plan's "how often".
export default function ReadingReminders({ patients, onOpen }) {
  const [overdue, setOverdue] = useState([])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const { data, error } = await supabase.rpc("overdue_readings")
      if (!cancelled && !error && data) setOverdue(data)
    }
    load()
    const timer = setInterval(load, 5 * 60 * 1000)
    const onVisible = () => { if (document.visibilityState === "visible") load() }
    document.addEventListener("visibilitychange", onVisible)
    return () => { cancelled = true; clearInterval(timer); document.removeEventListener("visibilitychange", onVisible) }
  }, [])

  // Patients marked "No regular readings" in their care plan are left out: nothing is expected of them.
  const noLevels = patients.filter((p) => p.care_plan?.readingsNeeded !== false && !hasRanges(p.care_plan?.ranges || {}))
  const byPatient = patients
    .map((p) => ({ p, rows: overdue.filter((o) => o.patient_id === p.id) }))
    .filter((x) => x.rows.length > 0)
  if (noLevels.length === 0 && byPatient.length === 0) return null

  const row = (key, name, detail, onClick, last) => (
    <button key={key} onClick={onClick} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, width: "100%", textAlign: "left", font: "inherit", cursor: "pointer", background: "none", border: "none", borderTop: last === 0 ? "none" : "1px solid #E6D6AE", padding: "7px 0" }}>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 13.5, fontWeight: 700, color: colors.ink }}>{name}</span>
        {detail && <span style={{ display: "block", fontSize: 12.5, color: colors.inkSoft }}>{detail}</span>}
      </span>
      <ChevronRight size={16} color={AMBER} style={{ flexShrink: 0 }} />
    </button>
  )

  return (
    <>
      {byPatient.length > 0 && (
        <Card style={{ padding: "13px 15px", border: `1.5px solid ${colors.gold}`, marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 14, fontWeight: 800, color: AMBER }}><AlertTriangle size={15} /> Readings overdue</div>
          <div style={{ marginTop: 4 }}>
            {byPatient.slice(0, 6).map(({ p, rows }, i) => row(
              p.id, p.full_name,
              rows.map((o) => `${READING_NAME[o.reading] || o.reading} (${everyWords(o.every_hours)}): ${o.last_at ? `last ${fmtWhen(o.last_at)}` : "not recorded yet"}`).join(" · "),
              () => onOpen(p.id), i,
            ))}
            {byPatient.length > 6 && <div style={{ fontSize: 12.5, color: colors.inkSoft, paddingTop: 6 }}>and {byPatient.length - 6} more patients</div>}
          </div>
        </Card>
      )}
      {noLevels.length > 0 && (
        <Card style={{ padding: "13px 15px", background: colors.goldTint, marginBottom: 12 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: AMBER }}>Reading levels are not set</div>
          <div style={{ fontSize: 13, color: colors.ink, margin: "3px 0 4px", lineHeight: 1.45 }}>
            {noLevels.length === 1 ? "1 patient has" : `${noLevels.length} patients have`} no reading levels, so nothing recorded for them is ever flagged. Open the patient, then Care plan, then Edit. Enter the doctor's numbers, or choose "No regular readings" if they don't need them.
          </div>
          {noLevels.slice(0, 5).map((p, i) => row(p.id, p.full_name, null, () => onOpen(p.id), i))}
          {noLevels.length > 5 && <div style={{ fontSize: 12.5, color: colors.inkSoft, paddingTop: 6 }}>and {noLevels.length - 5} more patients</div>}
        </Card>
      )}
    </>
  )
}
