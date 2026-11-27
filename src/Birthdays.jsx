import { useState, useEffect } from "react"
import { Cake } from "lucide-react"
import { supabase } from "./supabaseClient.js"
import { Card, colors } from "./care/ui.jsx"
import { Avatar } from "./Avatar.jsx"

export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
export const birthdayText = (m, d) => (m && d ? `${d} ${MONTHS[m - 1]}` : null)

const AMBER = "#6B4D0E"

// "Birthdays in the next month": clients (from their date of birth) and carers (a day and month they or an administrator
// entered). Shown to caregivers and administrators only; the database sends nothing to anyone else.
export default function BirthdaysCard({ isAdmin }) {
  const [rows, setRows] = useState(null)
  const [all, setAll] = useState(false)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const { data, error } = await supabase.rpc("upcoming_birthdays", { p_days: 31, p_back: 7 })
      if (!cancelled && !error && data) setRows(data)
    }
    load()
    const onVisible = () => { if (document.visibilityState === "visible") load() }
    document.addEventListener("visibilitychange", onVisible)
    return () => { cancelled = true; document.removeEventListener("visibilitychange", onVisible) }
  }, [])

  if (rows === null) return null
  if (rows.length === 0 && !isAdmin) return null

  const shown = all ? rows : rows.slice(0, 6)
  const when = (r) => {
    if (r.days_until === 0) return "Today"
    if (r.days_until === 1) return "Tomorrow"
    if (r.days_until === -1) return "Yesterday"
    if (r.days_until < 0) return `${-r.days_until} days ago (${new Date(`${r.on_date}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })})`
    return new Date(`${r.on_date}T00:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })
  }

  return (
    <Card style={{ padding: "14px 16px", marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: rows.length ? 6 : 0 }}>
        <Cake size={18} color={colors.gold} />
        <div style={{ fontFamily: "Fraunces, serif", fontSize: 17, fontWeight: 600, color: colors.ink }}>Birthdays: past week and next month</div>
      </div>
      {rows.length === 0 && <div style={{ fontSize: 13.5, color: colors.inkSoft, marginTop: 6 }}>No birthdays in the past week or the next month.</div>}
      {shown.map((r, i) => {
        const today = r.days_until === 0
        const past = r.days_until < 0
        const firstPast = past && (i === 0 || shown[i - 1].days_until >= 0)
        return (
          <div key={`${r.kind}${r.person_id}`}>
          {firstPast && <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.5, color: colors.inkFaint, textTransform: "uppercase", margin: i ? "10px 0 0" : "4px 0 0", paddingTop: i ? 10 : 0, borderTop: i ? `1px solid ${colors.hairline}` : "none" }}>In the past week</div>}
          <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "9px 0", borderTop: i && !firstPast ? `1px solid ${colors.hairline}` : "none", opacity: past ? 0.8 : 1 }}>
            {r.kind === "carer"
              ? <Avatar userId={r.person_id} name={r.name} size={36} fontSize={13} />
              : <Avatar name={r.name} size={36} fontSize={13} tone={[colors.goldTint, AMBER]} />}
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 14.5, fontWeight: 700, color: colors.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</div>
              <div style={{ fontSize: 13, color: today ? AMBER : colors.inkSoft, fontWeight: today ? 700 : 400 }}>
                {when(r)}{r.turning ? ` · ${past ? "turned" : "turns"} ${r.turning}` : ""}
              </div>
            </div>
            <span style={{ fontSize: 12, fontWeight: 700, borderRadius: 999, padding: "3px 10px", flexShrink: 0, background: r.kind === "client" ? colors.goldTint : colors.tealTint, color: r.kind === "client" ? AMBER : "#2F5A62" }}>
              {r.kind === "client" ? "Client" : "Carer"}
            </span>
          </div>
          </div>
        )
      })}
      {rows.length > 6 && (
        <button onClick={() => setAll((v) => !v)} style={{ border: "none", background: "none", cursor: "pointer", padding: "6px 0 0", fontSize: 13.5, fontWeight: 700, color: colors.sageDeep }}>
          {all ? "Show fewer" : `Show all ${rows.length}`}
        </button>
      )}
      {isAdmin && (
        <div style={{ fontSize: 12.5, color: colors.inkFaint, marginTop: 8, lineHeight: 1.4 }}>
          Clients come from their date of birth. Every caregiver and administrator is asked for their birthday the next time they sign in; you can also set it in Manage, Accounts, Edit details.
        </div>
      )}
    </Card>
  )
}

// A month and day picker pair, used on Profile and in the administrator's Edit details.
export function BirthdayFields({ month, day, onChange, selectStyle, labelStyle, required = false }) {
  const days = Array.from({ length: 31 }, (_, i) => i + 1)
  return (
    <div>
      <span style={labelStyle}>{required ? "Birthday (required, no year)" : "Birthday (optional, no year)"}</span>
      <div style={{ display: "flex", gap: 8 }}>
        <select aria-label="Birthday month" required={required} value={month || ""} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : "", day)} style={{ ...selectStyle, flex: 2 }}>
          <option value="">Month</option>
          {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
        </select>
        <select aria-label="Birthday day" required={required} value={day || ""} onChange={(e) => onChange(month, e.target.value ? Number(e.target.value) : "")} style={{ ...selectStyle, flex: 1 }}>
          <option value="">Day</option>
          {days.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
      </div>
    </div>
  )
}
