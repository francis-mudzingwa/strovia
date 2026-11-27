import { useState } from "react"
import { ClipboardCheck, AlertTriangle, Check } from "lucide-react"
import { supabase } from "./supabaseClient.js"

const colors = {
  bg: "#FAF6EF", card: "#FFFFFF", hairline: "#E5DFD1", ink: "#20261F", inkSoft: "#5C6357", inkFaint: "#6B7266",
  sage: "#3F6C51", sageDeep: "#2C4E3A", sageTint: "#E3EBE0", gold: "#B98A2E", goldTint: "#F3E7CC",
  rust: "#A24632", rustTint: "#F3DAD2",
}

// Suggestions to tick. People can also write something else.
export const SUGGESTED_ACTIONS = [
  "Called 911",
  "Called the office",
  "Told the family or emergency contact",
  "Stayed with the patient and kept them calm",
  "Helped them sit or lie down safely",
  "Noted the time the symptoms started",
  "Gave nothing to eat or drink",
  "Checked blood pressure or blood sugar",
  "Ambulance came or the patient went to hospital",
  "Symptoms settled, watching closely",
]

const pad = (n) => String(n).padStart(2, "0")
const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const hasSevere = (symptoms) => Object.values(symptoms || {}).some((v) => v === 3)
const fmtDay = (iso) => new Date(iso + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })
const fmtTime = (d) => new Date(d).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })

// The most recent day, within the last `days` days, on which a check-in had a severe symptom (or null).
export function latestSevereDate(entries, days = 3, now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - days)
  const found = (entries || []).filter((e) => hasSevere(e.symptoms) && e.date >= start)
  if (!found.length) return null
  return isoDate(found.reduce((a, b) => (a.date > b.date ? a : b)).date)
}

// What was done, one line per person: "Called 911; Called the office. Also: ...".
export const describeAction = (a) =>
  [(a.actions || []).join("; "), a.other_note ? `${(a.actions || []).length ? "Also: " : ""}${a.other_note}` : ""].filter(Boolean).join(". ")

// Shown on a patient's page (and right after a severe check-in): what was done, and a place to record it.
export default function ActionTaken({ patientId, entries, actions, userId, nameFor, onSaved, heading = "Severe symptoms: record what was done" }) {
  const date = latestSevereDate(entries)
  const [picked, setPicked] = useState([])
  const [other, setOther] = useState("")
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  if (!date) return null
  const done = (actions || []).filter((a) => a.patient_id === patientId && a.entry_date === date)
  const formOpen = open || done.length === 0

  const toggle = (item) => setPicked((p) => (p.includes(item) ? p.filter((x) => x !== item) : [...p, item]))

  async function save(e) {
    e.preventDefault()
    if (picked.length === 0 && !other.trim()) return setError("Tick what was done, or write it in the box.")
    setBusy(true)
    setError(null)
    const { error: err } = await supabase.from("symptom_actions").insert({
      patient_id: patientId, entry_date: date, actions: picked, other_note: other.trim() || null, recorded_by: userId,
    })
    setBusy(false)
    if (err) return setError("That couldn't be saved. Check your connection and try again.")
    setPicked([])
    setOther("")
    setOpen(false)
    await onSaved?.()
  }

  return (
    <div className="no-print" style={{ background: done.length ? colors.card : colors.rustTint, border: `1px solid ${done.length ? colors.hairline : colors.rust}`, borderRadius: 16, padding: 16, marginBottom: 16, boxShadow: "0 1px 3px rgba(32,38,31,0.06), 0 6px 16px rgba(32,38,31,0.05)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        {done.length ? <ClipboardCheck size={18} color={colors.sageDeep} /> : <AlertTriangle size={18} color={colors.rust} />}
        <span style={{ fontSize: 15, fontWeight: 700, color: colors.ink }}>{done.length ? "Action taken for severe symptoms" : heading}</span>
      </div>
      <p style={{ fontSize: 13, color: colors.inkSoft, margin: "0 0 10px", lineHeight: 1.5 }}>
        Severe symptoms were recorded on <strong>{fmtDay(date)}</strong>.{" "}
        {done.length === 0
          ? "Please note what you did. The administrator can see it."
          : "The administrator can see this."}
      </p>

      {done.map((a) => (
        <div key={a.id} style={{ background: colors.sageTint, borderRadius: 10, padding: "9px 12px", marginBottom: 8 }}>
          <div style={{ fontSize: 13.5, color: colors.ink, lineHeight: 1.5 }}>{describeAction(a)}</div>
          <div style={{ fontSize: 13, color: colors.inkSoft, marginTop: 2 }}>
            {nameFor(patientId, a.recorded_by) || "Someone on the care team"} · {fmtTime(a.created_at)}
          </div>
        </div>
      ))}

      {formOpen ? (
        <form onSubmit={save}>
          <div style={{ fontSize: 13, fontWeight: 700, color: colors.inkSoft, margin: "4px 0 8px" }}>What was done? Tick all that apply.</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
            {SUGGESTED_ACTIONS.map((item) => {
              const on = picked.includes(item)
              return (
                <button type="button" key={item} onClick={() => toggle(item)}
                  style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "7px 12px", borderRadius: 999, border: `1px solid ${on ? colors.sage : colors.hairline}`, background: on ? colors.sage : "#fff", color: on ? "#fff" : colors.inkSoft, fontSize: 13, fontWeight: 600, cursor: "pointer", textAlign: "left" }}>
                  {on && <Check size={13} />} {item}
                </button>
              )
            })}
          </div>
          <textarea value={other} onChange={(e) => setOther(e.target.value)} rows={2} maxLength={500} placeholder="Anything else you did (optional)"
            style={{ width: "100%", padding: 10, borderRadius: 10, border: `1px solid ${colors.hairline}`, fontSize: 13.5, fontFamily: "inherit", boxSizing: "border-box", resize: "vertical", marginBottom: 10 }} />
          {error && <p style={{ color: colors.rust, fontSize: 13, margin: "0 0 8px" }}>{error}</p>}
          <div style={{ display: "flex", gap: 8 }}>
            <button type="submit" disabled={busy} style={{ flex: 1, padding: "11px 0", borderRadius: 10, border: "none", background: colors.sage, color: "#fff", fontSize: 14, fontWeight: 700, cursor: busy ? "default" : "pointer", opacity: busy ? 0.7 : 1 }}>
              {busy ? "Saving..." : "Save what was done"}
            </button>
            {done.length > 0 && (
              <button type="button" onClick={() => { setOpen(false); setError(null) }} style={{ padding: "11px 16px", borderRadius: 10, border: `1px solid ${colors.hairline}`, background: "#fff", color: colors.inkSoft, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Cancel</button>
            )}
          </div>
        </form>
      ) : (
        <button onClick={() => setOpen(true)} style={{ padding: "9px 14px", borderRadius: 10, border: `1px solid ${colors.hairline}`, background: "#fff", color: colors.inkSoft, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
          Add something else that was done
        </button>
      )}
    </div>
  )
}
