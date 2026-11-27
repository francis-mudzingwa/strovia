import { useState } from "react"
import { HeartPulse, AlertTriangle, Phone } from "lucide-react"
import { supabase } from "../supabaseClient.js"
import { OFFICE_PHONE, telHref } from "../carePlan.js"
import { Card, colors, inputStyle, primaryButton, fmtWhen } from "./ui.jsx"
import { assessReading, hasRanges, everyWords, READING_NAME } from "./ranges.js"

const blank = { systolic: "", diastolic: "", pulse: "", glucose: "", weight: "", temperature: "", oxygen_saturation: "", pain_score: "", note: "" }
const numOrNull = (v) => (String(v).trim() === "" ? null : Number(v))

const describe = (v) => [
  v.systolic ? `BP ${v.systolic}/${v.diastolic}` : null,
  v.pulse ? `pulse ${v.pulse}` : null,
  v.glucose !== null && v.glucose !== undefined ? `sugar ${Number(v.glucose)}` : null,
  v.weight_lb !== null && v.weight_lb !== undefined ? `${Number(v.weight_lb)} lb` : null,
  v.temperature !== null && v.temperature !== undefined ? `${Number(v.temperature)}°F` : null,
  v.oxygen_saturation !== null && v.oxygen_saturation !== undefined ? `O₂ ${v.oxygen_saturation}%` : null,
  v.pain_score !== null && v.pain_score !== undefined ? `pain ${v.pain_score}/10` : null,
].filter(Boolean).join(" · ")

const asRangeArgs = (v) => ({ systolic: v.systolic, diastolic: v.diastolic, pulse: v.pulse, glucose: v.glucose, temperature: v.temperature, oxygen_saturation: v.oxygen_saturation, pain_score: v.pain_score, weight_lb: v.weight_lb, taken_at: v.taken_at })

// Blood pressure, pulse, blood sugar and weight. If the administrator has set ranges in the care plan, a reading
// outside them is flagged with a prompt to call the office. Without a range nothing is flagged.
export default function Readings({ patientId, userId, ranges, vitals, nameFor, onSaved, offShift, overdue = [] }) {
  const [f, setF] = useState(blank)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null) // how the reading just saved compares with the care team's levels
  const [open, setOpen] = useState(false)
  const set = (key) => (e) => setF((x) => ({ ...x, [key]: e.target.value }))

  async function save(e) {
    e.preventDefault()
    setError(null)
    const row = {
      patient_id: patientId, recorded_by: userId, systolic: numOrNull(f.systolic), diastolic: numOrNull(f.diastolic), pulse: numOrNull(f.pulse),
      glucose: numOrNull(f.glucose), weight_lb: numOrNull(f.weight), temperature: numOrNull(f.temperature), oxygen_saturation: numOrNull(f.oxygen_saturation),
      pain_score: numOrNull(f.pain_score),
      note: f.note.trim() || null,
    }
    if ((row.systolic === null) !== (row.diastolic === null)) return setError("Enter both blood pressure numbers, top and bottom.")
    if (row.pain_score !== null && (row.pain_score < 0 || row.pain_score > 10)) return setError("Pain score should be between 0 and 10.")
    if (row.systolic === null && row.pulse === null && row.glucose === null && row.weight_lb === null && row.temperature === null && row.oxygen_saturation === null && row.pain_score === null)
      return setError("Enter at least one reading.")
    setBusy(true)
    const { error: err } = await supabase.from("vitals").insert(row)
    setBusy(false)
    if (err) return setError(err.code === "P0001" ? err.message : "That reading couldn't be saved. Check the numbers and your connection, then try again.")
    setResult(assessReading(asRangeArgs(row), ranges, vitals))
    setF(blank)
    setOpen(false)
    await onSaved()
  }

  const field = (key, label, unit, step, max) => (
    <label style={{ display: "block", minWidth: 0 }}>
      <span style={{ display: "block", fontSize: 13, fontWeight: 700, color: colors.inkSoft, marginBottom: 4 }}>{label} <span style={{ fontWeight: 400, color: colors.inkFaint }}>{unit}</span></span>
      <input type="number" inputMode="decimal" step={step || "1"} min="0" max={max} value={f[key]} onChange={set(key)} style={inputStyle} />
    </label>
  )

  return (
    <Card>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 700, color: colors.ink }}>
          <HeartPulse size={16} color={colors.sageDeep} /> Readings/Vitals
        </span>
        {!open && !offShift && <button onClick={() => setOpen(true)} style={primaryButton}>Add a reading</button>}
      </div>
      {offShift && (
        <p style={{ fontSize: 13, color: colors.rust, fontWeight: 600, margin: "0 0 8px" }}>You're not on shift for this patient right now, so you can't add a reading.</p>
      )}
      {overdue.map((o) => (
        <div key={o.reading} style={{ background: colors.goldTint, border: `1px solid ${colors.gold}`, borderRadius: 12, padding: "9px 12px", margin: "0 0 8px", fontSize: 13.5, color: colors.ink, lineHeight: 1.45 }}>
          <strong style={{ color: "#6B4D0E" }}>{READING_NAME[o.reading] || o.reading} is overdue.</strong>{" "}
          It should be taken {everyWords(o.every_hours)}. {o.last_at ? `Last recorded ${fmtWhen(o.last_at)}.` : "It has not been recorded yet."}
        </div>
      ))}
      {!hasRanges(ranges) && (
        <p style={{ fontSize: 13, color: colors.inkFaint, margin: "0 0 8px", lineHeight: 1.45 }}>
          No levels are set for this patient yet, so readings are not flagged. The administrator can set them in the care plan.
        </p>
      )}

      {result && result.level === "red" && (
        <div style={{ background: colors.rustTint, border: `1.5px solid ${colors.rust}`, borderRadius: 12, padding: 12, margin: "8px 0" }}>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-start", color: colors.rust, fontWeight: 800, fontSize: 14 }}>
            <AlertTriangle size={17} style={{ flexShrink: 0, marginTop: 1 }} /> URGENT: call now
          </div>
          <ul style={{ margin: "6px 0 8px", paddingLeft: 20, fontSize: 13.5, color: colors.ink }}>
            {[...result.red, ...result.amber].map((w) => <li key={w}>{w}</li>)}
          </ul>
          <a href={telHref(OFFICE_PHONE)} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "10px 15px", borderRadius: 10, background: colors.rust, color: "#fff", fontWeight: 700, fontSize: 13.5, textDecoration: "none" }}>
            <Phone size={14} /> Call the office · {OFFICE_PHONE}
          </a>
          <p style={{ fontSize: 13, color: colors.inkSoft, margin: "8px 0 0" }}>If there is chest pain, trouble breathing or stroke warning signs (face, arm, speech), call 911 instead. Then write down what was done, below.</p>
        </div>
      )}
      {result && result.level === "amber" && (
        <div style={{ background: colors.goldTint, border: `1px solid ${colors.gold}`, borderRadius: 12, padding: 12, margin: "8px 0" }}>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-start", color: "#6B4D0E", fontWeight: 700, fontSize: 13.5 }}>
            <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} /> This reading is outside the care team's range
          </div>
          <ul style={{ margin: "6px 0 8px", paddingLeft: 20, fontSize: 13, color: colors.ink }}>
            {result.amber.map((w) => <li key={w}>{w}</li>)}
          </ul>
          <p style={{ fontSize: 13, color: colors.inkSoft, margin: "0 0 8px" }}>Tell your supervisor. If the person seems unwell or has stroke warning signs, call 911.</p>
          <a href={telHref(OFFICE_PHONE)} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "9px 14px", borderRadius: 10, background: colors.sage, color: "#fff", fontWeight: 700, fontSize: 13, textDecoration: "none" }}>
            <Phone size={14} /> Call the office · {OFFICE_PHONE}
          </a>
        </div>
      )}

      {open && (
        <form onSubmit={save} style={{ background: colors.bg, borderRadius: 12, padding: 12, margin: "8px 0" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10 }}>
            {field("systolic", "BP top", "mmHg")}
            {field("diastolic", "BP bottom", "mmHg")}
            {field("pulse", "Pulse", "/min")}
            {field("glucose", "Blood sugar", "mg/dL", "0.1")}
            {field("weight", "Weight", "lb", "0.1")}
            {field("temperature", "Temperature", "°F", "0.1")}
            {field("oxygen_saturation", "Oxygen (SpO2)", "%")}
            {field("pain_score", "Pain", "0 = none, 10 = worst", "1", "10")}
          </div>
          <input value={f.note} onChange={set("note")} maxLength={300} placeholder="Note (optional), e.g. after breakfast" style={{ ...inputStyle, marginTop: 10 }} />
          {error && <p style={{ color: colors.rust, fontSize: 13, margin: "8px 0 0" }}>{error}</p>}
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button type="submit" disabled={busy} style={{ ...primaryButton, opacity: busy ? 0.7 : 1 }}>{busy ? "Saving..." : "Save reading"}</button>
            <button type="button" onClick={() => { setOpen(false); setError(null) }} style={{ padding: "10px 16px", borderRadius: 10, border: `1px solid ${colors.hairline}`, background: "#fff", color: colors.inkSoft, fontSize: 13.5, fontWeight: 600, cursor: "pointer" }}>Cancel</button>
          </div>
        </form>
      )}

      {vitals.length === 0 ? (
        <p style={{ fontSize: 13, color: colors.inkFaint, margin: "6px 0 0" }}>No readings recorded yet.</p>
      ) : (
        vitals.slice(0, 5).map((v) => {
          const earlier = vitals.filter((x) => new Date(x.taken_at) < new Date(v.taken_at))
          const level = v.level ?? assessReading(asRangeArgs(v), ranges, earlier).level
          const bg = level === "red" ? colors.rustTint : level === "amber" ? colors.goldTint : "transparent"
          const fg = level === "red" ? colors.rust : level === "amber" ? "#6B4D0E" : colors.ink
          return (
            <div key={v.id} style={{ padding: "9px 8px", margin: "0 -8px", borderRadius: 10, borderTop: `1px solid ${colors.hairline}`, background: bg, fontSize: 13.5, color: colors.ink }}>
              <span style={{ fontWeight: 700, color: fg }}>{describe(v)}</span>
              {level && <span style={{ marginLeft: 8, fontSize: 12.5, fontWeight: 700, color: "#fff", background: level === "red" ? colors.rust : colors.gold, padding: "2px 8px", borderRadius: 999 }}>{level === "red" ? "Urgent" : "Outside range"}</span>}
              <div style={{ fontSize: 13, color: colors.inkFaint }}>{fmtWhen(v.taken_at)} · {nameFor(patientId, v.recorded_by) || "Someone on the care team"}{v.note ? ` · ${v.note}` : ""}</div>
              {level === "red" && v.acknowledged_at && (
                <div style={{ fontSize: 13, color: colors.ink, marginTop: 4 }}><strong>What was done</strong> ({nameFor(patientId, v.acknowledged_by) || "the care team"}, {fmtWhen(v.acknowledged_at)}): {v.action_note}</div>
              )}
              {level === "red" && v.level === "red" && !v.acknowledged_at && (offShift
                ? <div style={{ fontSize: 13, color: colors.rust, marginTop: 4 }}>Nobody has written down what was done yet. The caregiver on shift or an administrator can do it.</div>
                : <AckForm vitalId={v.id} onDone={onSaved} />)}
            </div>
          )
        })
      )}
    </Card>
  )
}

// Writing down what was done about an urgent reading. Until someone does, the team is reminded and the handover keeps it on top.
function AckForm({ vitalId, onDone }) {
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  async function submit() {
    setBusy(true)
    setErr(null)
    const { error } = await supabase.rpc("acknowledge_reading", { p_vital: vitalId, p_note: note })
    setBusy(false)
    if (error) { setErr(error.message || "That could not be saved. Please try again."); return }
    await onDone()
  }
  return (
    <div style={{ marginTop: 8 }}>
      <label style={{ display: "block", fontSize: 13, fontWeight: 700, color: colors.rust, marginBottom: 4 }}>Write down what was done</label>
      <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} placeholder="e.g. Rechecked after 10 minutes, called the office" style={{ ...inputStyle, resize: "vertical" }} />
      {err && <div style={{ fontSize: 13, color: colors.rust, marginTop: 4 }}>{err}</div>}
      <button onClick={submit} disabled={busy || !note.trim()} style={{ ...primaryButton, marginTop: 6, background: colors.rust, opacity: busy || !note.trim() ? 0.6 : 1 }}>{busy ? "Saving..." : "Save"}</button>
    </div>
  )
}
