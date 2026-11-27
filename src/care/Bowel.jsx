import { useState } from "react"
import { ClipboardCheck, Plus, X, AlertTriangle, Trash2 } from "lucide-react"
import { supabase } from "../supabaseClient.js"
import { Card, colors, inputStyle, primaryButton, fmtTime } from "./ui.jsx"
import { BOWEL_KINDS, kindLabel, bowelStatus, dayWord } from "./bowel.js"

const AMBER_TEXT = "#6B4D0E"
const pad = (n) => String(n).padStart(2, "0")

const chip = (on, tone) => ({
  padding: "7px 12px", borderRadius: 999, fontSize: 13.5, fontWeight: on ? 700 : 500, cursor: "pointer", fontFamily: "inherit",
  border: `1.5px solid ${on ? (tone === "bad" ? colors.rust : colors.sage) : colors.hairline}`,
  background: on ? (tone === "bad" ? colors.rustTint : colors.sageTint) : "#fff",
  color: on ? (tone === "bad" ? colors.rust : colors.sageDeep) : colors.inkSoft,
})
const lbl = { fontSize: 12.5, fontWeight: 700, color: colors.inkFaint, margin: "0 0 6px" }

// The bowel movement card on a patient's Today page: when the last one was, a warning when the care plan's number of days has
// gone by, a red notice when blood or black stool was recorded, and a short form to add one. Carers and administrators only
// (the database enforces that, and that a carer is on shift to add one).
export default function Bowel({ patientId, userId, isAdmin, plan, log, nameFor, onSaved, offShift }) {
  const [open, setOpen] = useState(false)
  const [when, setWhen] = useState("now") // now | earlier
  const [time, setTime] = useState("")
  const [kind, setKind] = useState("")
  const [accident, setAccident] = useState(false)
  const [blood, setBlood] = useState(false)
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [history, setHistory] = useState(false)

  const now = new Date()
  const st = bowelStatus(log, plan, now)
  const who = (r) => (r && nameFor(patientId, r.done_by)) || "someone on the care team"

  function reset() { setWhen("now"); setTime(""); setKind(""); setAccident(false); setBlood(false); setNote(""); setError(null) }

  async function save() {
    setError(null)
    if (!kind) { setError("Choose what it was like."); return }
    let at = new Date()
    if (when === "earlier") {
      if (!time) { setError("Choose the time."); return }
      const [h, m] = time.split(":").map(Number)
      at = new Date(); at.setHours(h, m, 0, 0)
      if (at > new Date()) { setError("That time hasn't happened yet today."); return }
    }
    setBusy(true)
    const { error: err } = await supabase.from("bowel_log").insert({
      patient_id: patientId, happened_at: at.toISOString(), kind, accident, blood, note: note.trim() || null, done_by: userId,
    })
    setBusy(false)
    if (err) { setError(err.code === "P0001" ? err.message : "That couldn't be saved. Check your connection and try again."); return }
    reset(); setOpen(false)
    await onSaved()
  }

  async function undo(r) {
    const { error: err } = await supabase.from("bowel_log").delete().eq("id", r.id)
    if (err) { setError("That couldn't be undone. Try again."); return }
    await onSaved()
  }

  const recent = st.rows.filter((r) => now - new Date(r.happened_at) < 7 * 24 * 3600000)

  return (
    <Card>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 700, color: colors.ink }}>
          <ClipboardCheck size={16} color={colors.sageDeep} /> Bowel movements
        </span>
        {!offShift && (
          <button onClick={() => { setOpen((o) => !o); setError(null) }} aria-expanded={open} style={{ display: "inline-flex", alignItems: "center", gap: 5, border: `1.5px solid ${colors.sage}`, background: open ? colors.sage : "#fff", color: open ? "#fff" : colors.sageDeep, borderRadius: 11, padding: "7px 12px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
            {open ? <X size={14} /> : <Plus size={14} />} {open ? "Close" : "Add"}
          </button>
        )}
      </div>

      {st.blood && (
        <div role="alert" style={{ background: colors.rustTint, border: `1px solid ${colors.rust}`, borderRadius: 12, padding: "10px 12px", marginBottom: 10, color: colors.rust, fontSize: 13.5, lineHeight: 1.45 }}>
          <strong style={{ display: "flex", alignItems: "center", gap: 6 }}><AlertTriangle size={14} /> Blood or black stool recorded</strong>
          {dayWord(st.blood.happened_at, now) === "today" ? "" : `${dayWord(st.blood.happened_at, now)} `}{fmtTime(st.blood.happened_at)} by {who(st.blood)}. The office and care team were told.
        </div>
      )}
      {st.amber && (
        <div style={{ background: colors.goldTint, border: `1px solid ${colors.gold}`, borderRadius: 12, padding: "10px 12px", marginBottom: 10, color: AMBER_TEXT, fontSize: 13.5, lineHeight: 1.45 }}>
          <strong style={{ display: "flex", alignItems: "center", gap: 6 }}><AlertTriangle size={14} /> No bowel movement for {st.days} days</strong>
          The care plan says to tell the office after {st.limit} days.
        </div>
      )}

      {st.last ? (
        <div style={{ fontSize: 14, color: colors.ink }}>
          Last: {dayWord(st.last.happened_at, now)}, {fmtTime(st.last.happened_at)}
          <div style={{ fontSize: 13, color: colors.inkSoft }}>{kindLabel(st.last.kind)}{st.last.accident ? ", accident" : ""}, recorded by {who(st.last)}</div>
        </div>
      ) : (
        <div style={{ fontSize: 13.5, color: colors.inkFaint }}>Nothing recorded yet.</div>
      )}
      {st.limit && <div style={{ fontSize: 12.5, color: colors.inkFaint, marginTop: 6 }}>Care plan: tell the office after {st.limit} days with none</div>}

      {open && !offShift && (
        <div style={{ borderTop: `1px solid ${colors.hairline}`, marginTop: 12, paddingTop: 12 }}>
          <p style={lbl}>When</p>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
            <button type="button" onClick={() => setWhen("now")} style={chip(when === "now")}>Now</button>
            <button type="button" onClick={() => { setWhen("earlier"); if (!time) setTime(`${pad(now.getHours())}:${pad(now.getMinutes())}`) }} style={chip(when === "earlier")}>Earlier today</button>
            {when === "earlier" && <input type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-label="Time it happened" style={{ ...inputStyle, width: "auto", padding: "6px 10px" }} />}
          </div>

          <p style={lbl}>What was it like?</p>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {BOWEL_KINDS.map(([v, l]) => <button key={v} type="button" onClick={() => setKind(v)} aria-pressed={kind === v} style={chip(kind === v)}>{l}</button>)}
          </div>
          <p style={{ fontSize: 11.5, color: colors.inkFaint, margin: "6px 0 12px" }}>Bristol scale: {BOWEL_KINDS.map(([, l, b]) => `${l.toLowerCase()} ${b.replace("Bristol ", "")}`).join(", ")}</p>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 14, color: colors.ink }}>Was it an accident?</span>
            <span style={{ display: "flex", gap: 6 }}>
              <button type="button" onClick={() => setAccident(true)} aria-pressed={accident} style={chip(accident)}>Yes</button>
              <button type="button" onClick={() => setAccident(false)} aria-pressed={!accident} style={chip(!accident)}>No</button>
            </span>
          </div>

          <div style={{ border: `1px solid ${blood ? colors.rust : colors.hairline}`, borderRadius: 12, padding: "10px 12px", marginBottom: 10 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: colors.rust }}>Blood or black stool</span>
              <span style={{ display: "flex", gap: 6 }}>
                <button type="button" onClick={() => setBlood(true)} aria-pressed={blood} style={chip(blood, "bad")}>Yes</button>
                <button type="button" onClick={() => setBlood(false)} aria-pressed={!blood} style={chip(!blood)}>No</button>
              </span>
            </div>
            <div style={{ fontSize: 12.5, color: blood ? colors.rust : colors.inkFaint, marginTop: 4 }}>{blood ? "Saving this tells the office and the care team straight away." : "If yes, the office and care team are told straight away."}</div>
          </div>

          <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} rows={2} placeholder="Note (optional)" style={{ ...inputStyle, resize: "vertical", marginBottom: 10 }} />
          {error && <p style={{ color: colors.rust, fontSize: 13, margin: "0 0 8px" }}>{error}</p>}
          <button onClick={save} disabled={busy} style={{ ...primaryButton, opacity: busy ? 0.6 : 1 }}>{busy ? "Saving…" : "Save"}</button>
        </div>
      )}
      {!open && error && <p style={{ color: colors.rust, fontSize: 13, margin: "8px 0 0" }}>{error}</p>}

      {recent.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <button onClick={() => setHistory((h) => !h)} aria-expanded={history} style={{ border: "none", background: "none", padding: 0, fontSize: 13, fontWeight: 700, color: colors.sageDeep, cursor: "pointer", fontFamily: "inherit" }}>
            {history ? "Hide" : "Show"} the last 7 days ({recent.length})
          </button>
          {history && recent.map((r) => (
            <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0", borderTop: `1px solid ${colors.hairline}`, marginTop: 8, fontSize: 13.5 }}>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ color: colors.ink }}>{dayWord(r.happened_at, now) === "today" ? "Today" : dayWord(r.happened_at, now)}, {fmtTime(r.happened_at)}</span>{" "}
                <span style={{ color: colors.inkSoft }}>{kindLabel(r.kind)}{r.accident ? ", accident" : ""}</span>
                {r.blood && <span style={{ color: colors.rust, fontWeight: 700 }}> · blood or black stool</span>}
                <span style={{ display: "block", fontSize: 12.5, color: colors.inkFaint }}>{who(r)}{r.note ? ` · ${r.note}` : ""}</span>
              </span>
              {(isAdmin || r.done_by === userId) && (
                <button onClick={() => undo(r)} aria-label="Undo this entry" style={{ border: "none", background: "none", cursor: "pointer", color: colors.inkFaint, padding: 4 }}><Trash2 size={15} /></button>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}
