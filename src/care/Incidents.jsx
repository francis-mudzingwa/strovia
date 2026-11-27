import { useState } from "react"
import { Siren, Phone } from "lucide-react"
import { supabase } from "../supabaseClient.js"
import { OFFICE_PHONE, telHref } from "../carePlan.js"
import { Card, colors, inputStyle, primaryButton, quietButton, fmtWhen, ago } from "./ui.jsx"

const KINDS = [
  ["fall", "A fall"],
  ["missed medicine", "Missed medication"],
  ["refused medicine", "Refused medication"],
  ["choking or coughing at meals", "Choking or coughing at meals"],
  ["skin problem", "Skin redness or a sore"],
  ["other", "Something else"],
]
const labelOf = (kind) => KINDS.find(([k]) => k === kind)?.[1] || kind

const localNow = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)

// Things that go wrong and need the office to know: falls, missed or refused medicine, choking, skin problems.
// Anyone caring for the patient can report one; the administrator sees it straight away and in the audit trail.
export default function Incidents({ patientId, userId, incidents, nameFor, onSaved }) {
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState("fall")
  const [when, setWhen] = useState(localNow())
  const [injury, setInjury] = useState(false)
  const [details, setDetails] = useState("")
  const [action, setAction] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [saved, setSaved] = useState(null)

  async function save(e) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    const happened = new Date(when)
    const { error: err } = await supabase.from("incidents").insert({
      patient_id: patientId, reported_by: userId, kind, injury, happened_at: Number.isNaN(happened.getTime()) ? new Date().toISOString() : happened.toISOString(),
      details: details.trim() || null, action_taken: action.trim() || null,
    })
    setBusy(false)
    if (err) return setError("That couldn't be saved. Check your connection and try again.")
    setSaved({ kind, injury })
    setOpen(false); setKind("fall"); setWhen(localNow()); setInjury(false); setDetails(""); setAction("")
    await onSaved()
  }

  const needsCall = saved && (saved.kind === "fall" || saved.kind === "choking or coughing at meals" || saved.injury)

  return (
    <div style={{ marginBottom: 16 }}>
      {!open && (
        <button onClick={() => { setOpen(true); setSaved(null) }} style={quietButton}><Siren size={14} color={colors.rust} /> Report an incident</button>
      )}

      {saved && !open && (
        <Card style={{ marginTop: 10, background: needsCall ? colors.rustTint : colors.sageTint, border: needsCall ? `1px solid ${colors.rust}` : "none" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: colors.ink }}>The incident was reported. The administrator has been told.</div>
          {needsCall && (
            <>
              <p style={{ fontSize: 13, color: colors.ink, margin: "6px 0 10px", lineHeight: 1.5 }}>Please also phone the office now. If there is a head injury, a suspected broken bone or the person can't be woken, call 911.</p>
              <a href={telHref(OFFICE_PHONE)} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "9px 14px", borderRadius: 10, background: colors.rust, color: "#fff", fontWeight: 700, fontSize: 13, textDecoration: "none" }}><Phone size={14} /> Call the office · {OFFICE_PHONE}</a>
            </>
          )}
        </Card>
      )}

      {open && (
        <Card style={{ marginBottom: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: colors.ink, marginBottom: 10 }}>Report an incident</div>
          <form onSubmit={save}>
            <label style={{ display: "block", marginBottom: 10 }}>
              <span style={{ display: "block", fontSize: 13, fontWeight: 700, color: colors.inkSoft, marginBottom: 4 }}>What happened</span>
              <select value={kind} onChange={(e) => setKind(e.target.value)} style={inputStyle}>
                {KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </label>
            <label style={{ display: "block", marginBottom: 10 }}>
              <span style={{ display: "block", fontSize: 13, fontWeight: 700, color: colors.inkSoft, marginBottom: 4 }}>When</span>
              <input type="datetime-local" value={when} max={localNow()} onChange={(e) => setWhen(e.target.value)} style={inputStyle} />
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, fontSize: 14, color: colors.ink }}>
              <input type="checkbox" checked={injury} onChange={(e) => setInjury(e.target.checked)} style={{ width: 18, height: 18 }} /> There was an injury
            </label>
            <textarea value={details} onChange={(e) => setDetails(e.target.value)} rows={3} maxLength={1000} placeholder="What happened? (optional)" style={{ ...inputStyle, resize: "vertical", marginBottom: 8 }} />
            <textarea value={action} onChange={(e) => setAction(e.target.value)} rows={2} maxLength={1000} placeholder="What did you do? (optional)" style={{ ...inputStyle, resize: "vertical", marginBottom: 10 }} />
            {error && <p style={{ color: colors.rust, fontSize: 13, margin: "0 0 8px" }}>{error}</p>}
            <div style={{ display: "flex", gap: 8 }}>
              <button type="submit" disabled={busy} style={{ ...primaryButton, opacity: busy ? 0.7 : 1 }}>{busy ? "Saving..." : "Report incident"}</button>
              <button type="button" onClick={() => { setOpen(false); setError(null) }} style={quietButton}>Cancel</button>
            </div>
          </form>
        </Card>
      )}

      {incidents.length > 0 && (
        <Card style={{ marginTop: 10, marginBottom: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: colors.ink, marginBottom: 4 }}>Incidents in the last 7 days</div>
          {incidents.map((i) => (
            <div key={i.id} style={{ padding: "9px 0", borderTop: `1px solid ${colors.hairline}` }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: colors.ink }}>{labelOf(i.kind)}{i.injury ? " (with injury)" : ""}</div>
              {i.details && <div style={{ fontSize: 13, color: colors.inkSoft, marginTop: 2 }}>{i.details}</div>}
              {i.action_taken && <div style={{ fontSize: 13, color: colors.inkSoft }}>Done: {i.action_taken}</div>}
              <div style={{ fontSize: 13, color: colors.inkFaint, marginTop: 2 }}>{fmtWhen(i.happened_at)} ({ago(i.happened_at)}) · {nameFor(patientId, i.reported_by) || "Someone on the care team"}</div>
            </div>
          ))}
        </Card>
      )}
    </div>
  )
}
