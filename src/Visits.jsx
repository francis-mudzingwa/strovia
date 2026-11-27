import { useState, useEffect, useCallback } from "react"
import { HeartHandshake, Pencil, Trash2, Plus, X, Check } from "lucide-react"
import { supabase } from "./supabaseClient.js"
import {
  WEEKDAYS, DAY_ORDER, describeShift, fmtTimeRange, fmtDuration, durationMinutes, isOvernight, isExpired, isoDate, occurrences, fmtClock,
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

// Common visit types, plus room for anything else the administrator wants to record.
export const VISIT_TYPES = ["Physical therapy", "Occupational therapy", "Speech-language therapy", "Nursing visit", "Other"]

// Every visit the signed-in person may see (RLS scopes this to their own patients already).
export function useVisits() {
  const [visits, setVisits] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const { data, error } = await supabase.from("visits").select("*")
    if (!error) setVisits(data || [])
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
    const refresh = () => { if (document.visibilityState === "visible") load() }
    document.addEventListener("visibilitychange", refresh)
    const timer = setInterval(load, 5 * 60 * 1000)
    return () => { document.removeEventListener("visibilitychange", refresh); clearInterval(timer) }
  }, [load])

  return { visits, loading, reload: load }
}

const blankForm = (lockedPatientId) => ({
  id: null, patient: lockedPatientId || "", visitorName: "", visitType: VISIT_TYPES[0], repeat: "weekly", days: [], onDate: "",
  startsOn: isoDate(new Date()), endsOn: "", start: "10:00", end: "11:00", notes: "",
})
const formFromVisit = (v) => ({
  id: v.id, patient: v.patient_id, visitorName: v.visitor_name || "", visitType: v.visit_type,
  repeat: v.weekday !== null ? "weekly" : "once", days: v.weekday !== null ? [v.weekday] : [],
  onDate: v.on_date || "", startsOn: v.starts_on, endsOn: v.ends_on || "",
  start: String(v.start_time).slice(0, 5), end: String(v.end_time).slice(0, 5), notes: v.notes || "",
})

// The add/edit form: a patient picker when called from the administrator's cross-patient view, or locked to one
// patient when called from that patient's own Visits tab (any caregiver or family proxy assigned to the patient can
// add one there, and change or remove one they added themselves; an administrator can change or remove any visit).
function VisitForm({ patients, lockedPatientId, userId, existing, onSaved, onCancel }) {
  const [form, setForm] = useState(() => (existing ? formFromVisit(existing) : blankForm(lockedPatientId)))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))
  const toggleDay = (d) => setForm((f) => ({ ...f, days: f.days.includes(d) ? f.days.filter((x) => x !== d) : [...f.days, d] }))

  async function save(e) {
    e.preventDefault()
    setError(null)
    if (!form.patient) return setError("Choose a patient.")
    if (!form.visitType.trim()) return setError("Choose or enter what kind of visit this is.")
    if (form.start === form.end) return setError("The visit must end at a different time than it starts.")
    if (form.repeat === "weekly" && form.days.length === 0) return setError("Choose at least one day of the week.")
    if (form.repeat === "once" && !form.onDate) return setError("Choose the date of the visit.")
    if (form.repeat === "weekly" && form.endsOn && form.endsOn < form.startsOn) return setError("The last day cannot be before the first day.")
    const base = {
      patient_id: form.patient, visitor_name: form.visitorName.trim() || null, visit_type: form.visitType.trim(),
      start_time: form.start, end_time: form.end, notes: form.notes.trim() || null,
    }
    const rows = form.repeat === "weekly"
      ? form.days.map((d) => ({ ...base, weekday: d, on_date: null, starts_on: form.startsOn, ends_on: form.endsOn || null }))
      : [{ ...base, weekday: null, on_date: form.onDate }]
    setBusy(true)
    let result
    if (form.id) {
      result = await supabase.from("visits").update(rows[0]).eq("id", form.id).select()
      if (!result.error && (result.data || []).length === 0) result = { error: { message: "That visit could not be changed." } }
    } else {
      result = await supabase.from("visits").insert(rows.map((r) => ({ ...r, created_by: userId }))).select()
    }
    setBusy(false)
    if (result.error) return setError(result.error.message)
    onSaved()
  }

  return (
    <Card>
      <form onSubmit={save}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: colors.ink }}>{form.id ? "Change visit" : "New visit"}</div>
          <button type="button" onClick={onCancel} aria-label="Close" style={{ border: "none", background: "transparent", cursor: "pointer", color: colors.inkFaint }}><X size={18} /></button>
        </div>

        {!lockedPatientId && (
          <>
            <label style={labelStyle}>Patient</label>
            <select required disabled={!!form.id} value={form.patient} onChange={set("patient")} style={{ ...inputStyle, marginBottom: 12 }}>
              <option value="">Choose a patient</option>
              {patients.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
            </select>
          </>
        )}

        <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Type of visit</label>
            <select value={form.visitType} onChange={set("visitType")} style={inputStyle}>
              {VISIT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Visitor's name (optional)</label>
            <input value={form.visitorName} onChange={set("visitorName")} placeholder="e.g. Sarah Chen" style={inputStyle} />
          </div>
        </div>

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
            <label style={labelStyle}>{form.id ? "Day" : "Days (choose one or more)"}</label>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
              {DAY_ORDER.map((d) => {
                const on = form.days.includes(d)
                return (
                  <button type="button" key={d} onClick={() => (form.id ? setForm((f) => ({ ...f, days: [d] })) : toggleDay(d))}
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
        {form.start !== form.end && (
          <p style={{ fontSize: 13, color: colors.inkFaint, margin: "0 0 12px" }}>
            {fmtDuration(durationMinutes({ start_time: form.start, end_time: form.end }))}
            {isOvernight({ start_time: form.start, end_time: form.end }) ? ", finishing the next day" : ""}
          </p>
        )}

        <label style={labelStyle}>Note (optional)</label>
        <textarea value={form.notes} onChange={set("notes")} rows={2} placeholder="For example: uses the side door, brings own equipment" style={{ ...inputStyle, resize: "vertical", marginBottom: 12 }} />

        {error && <p style={{ color: colors.rust, fontSize: 13, margin: "0 0 12px", lineHeight: 1.45 }}>{error}</p>}

        <div style={{ display: "flex", gap: 8 }}>
          <button type="submit" disabled={busy} style={{ flex: 1, padding: "11px 0", borderRadius: 10, border: "none", background: colors.sage, color: "#fff", fontSize: 14, fontWeight: 700, cursor: busy ? "default" : "pointer", opacity: busy ? 0.7 : 1 }}>
            {busy ? "Saving..." : form.id ? "Save changes" : form.days.length > 1 ? `Add ${form.days.length} visits` : "Add visit"}
          </button>
          <button type="button" onClick={onCancel} style={{ padding: "11px 16px", borderRadius: 10, border: `1px solid ${colors.hairline}`, background: "#fff", color: colors.inkSoft, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Cancel</button>
        </div>
      </form>
    </Card>
  )
}

const sortVisits = (list) => [...list].sort((a, b) =>
  (a.weekday !== null ? DAY_ORDER.indexOf(a.weekday) : 100) - (b.weekday !== null ? DAY_ORDER.indexOf(b.weekday) : 100)
  || (a.on_date || "").localeCompare(b.on_date || "") || a.start_time.localeCompare(b.start_time))

// One visit, laid out so each part reads differently: the kind of visit and who is coming as a tag and a name, the day as
// a green tag, and the hours in plain text. Used by the patient's own Visits tab and by the administrator's list.
function VisitInfo({ v, expired }) {
  const recurring = v.weekday !== null && v.weekday !== undefined
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: colors.teal, background: colors.tealTint, borderRadius: 999, padding: "2px 10px" }}>{v.visit_type}</span>
        {v.visitor_name && <span style={{ fontSize: 14, fontWeight: 600, color: colors.ink }}>{v.visitor_name}</span>}
        {expired && <span style={{ fontSize: 12.5, fontWeight: 700, color: colors.inkFaint }}>Ended</span>}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: colors.sageDeep, background: colors.sageTint, borderRadius: 8, padding: "3px 9px" }}>{describeShift(v)}</span>
        <span style={{ fontSize: 13, color: colors.inkSoft }}>{fmtTimeRange(v)} · {fmtDuration(durationMinutes(v))}{isOvernight(v) ? ", overnight" : ""}</span>
      </div>
      {recurring && (v.ends_on || v.starts_on > isoDate(new Date())) && (
        <div style={{ fontSize: 13, color: colors.inkFaint, marginTop: 4 }}>
          {v.starts_on > isoDate(new Date()) ? `From ${new Date(v.starts_on + "T00:00:00").toLocaleDateString()}` : ""}{v.ends_on ? ` Until ${new Date(v.ends_on + "T00:00:00").toLocaleDateString()}` : ""}
        </div>
      )}
      {v.notes && <div style={{ fontSize: 13, color: colors.inkFaint, marginTop: 4 }}>{v.notes}</div>}
    </div>
  )
}

/* ---------------- did the visit happen? ---------------- */

const MISSED_REASONS = [
  ["cancelled", "Therapist cancelled"], ["unwell", "Patient unwell"], ["out", "Patient was out"], ["wrong_time", "Wrong day or time"], ["other", "Other"],
]
const reasonText = (key) => MISSED_REASONS.find(([k]) => k === key)?.[1] || key
const visitTitle = (v) => [v.visit_type, v.visitor_name].filter(Boolean).join(", ")
const whenText = (date) => `${date.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}, ${date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`

// One visit that has already passed with no result recorded. "Yes" records it at once; "It didn't happen" asks why.
function ConfirmVisit({ occ, userId, onSaved }) {
  const v = occ.shift
  const [mode, setMode] = useState(null) // null | missed
  const [reason, setReason] = useState("")
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function save(status) {
    setBusy(true)
    setError(null)
    const { error: err } = await supabase.from("visit_log").insert({
      visit_id: v.id, patient_id: v.patient_id, occurred_on: isoDate(occ.start), status,
      reason: status === "missed" ? reason : null, note: note.trim() || null, recorded_by: userId,
    })
    setBusy(false)
    if (err) setError(err.code === "23505" ? "Someone has already recorded this visit." : "That couldn't be saved. Check your connection and try again.")
    if (!err || err.code === "23505") await onSaved()
  }

  return (
    <div style={{ background: "#FBF5E6", borderLeft: `5px solid ${colors.gold}`, borderRadius: 14, padding: "12px 14px", marginBottom: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: colors.teal, background: colors.tealTint, borderRadius: 999, padding: "2px 10px" }}>{v.visit_type}</span>
        {v.visitor_name && <span style={{ fontSize: 14, fontWeight: 600, color: colors.ink }}>{v.visitor_name}</span>}
      </div>
      <div style={{ fontSize: 14.5, fontWeight: 700, color: colors.ink, margin: "6px 0 1px" }}>Did this visit happen?</div>
      <div style={{ fontSize: 13, color: colors.inkSoft }}>{whenText(occ.start)} to {fmtClock(v.end_time)}</div>
      {mode === null ? (
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <button onClick={() => save("happened")} disabled={busy} style={{ flex: 1, padding: "10px 0", borderRadius: 11, border: "none", background: colors.sage, color: "#fff", fontWeight: 700, fontSize: 13.5, cursor: "pointer", opacity: busy ? 0.6 : 1 }}>Yes, it happened</button>
          <button onClick={() => setMode("missed")} disabled={busy} style={{ flex: 1, padding: "9px 0", borderRadius: 11, border: `1.5px solid ${colors.rust}`, background: "#fff", color: colors.rust, fontWeight: 700, fontSize: 13.5, cursor: "pointer" }}>It didn't happen</button>
        </div>
      ) : (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 13, color: colors.inkSoft, marginBottom: 6 }}>Why? (so the office knows)</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {MISSED_REASONS.map(([key, label]) => (
              <button key={key} type="button" onClick={() => setReason(key)} style={{ padding: "5px 11px", borderRadius: 999, border: `1px solid ${reason === key ? colors.rust : colors.hairline}`, background: reason === key ? colors.rustTint : "#fff", color: reason === key ? colors.rust : colors.inkSoft, fontWeight: 600, fontSize: 13, cursor: "pointer" }}>{label}</button>
            ))}
          </div>
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Add a note (optional)" style={{ ...inputStyle, marginTop: 9, fontSize: 13 }} />
          <div style={{ display: "flex", gap: 8, marginTop: 9 }}>
            <button onClick={() => save("missed")} disabled={busy || !reason} style={{ padding: "9px 16px", borderRadius: 10, border: "none", background: colors.rust, color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer", opacity: busy || !reason ? 0.5 : 1 }}>Save</button>
            <button onClick={() => { setMode(null); setReason(""); setNote("") }} style={smallButton}>Back</button>
          </div>
        </div>
      )}
      {error && <p style={{ color: colors.rust, fontSize: 13, margin: "8px 0 0" }}>{error}</p>}
    </div>
  )
}

// One recorded result: a tick or a cross, who recorded it, the reason or note. A note can be added afterwards, and a
// mistaken result can be undone, which puts the visit back under "Please confirm".
function ResultRow({ log, visit, nameFor, patientId, onChanged }) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(log.note || "")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const ok = log.status === "happened"
  const start = new Date(`${log.occurred_on}T${String(visit.start_time).slice(0, 5)}`)
  const who = (log.recorded_by && nameFor?.(patientId, log.recorded_by)) || "someone"

  async function saveNote() {
    setBusy(true)
    setError(null)
    const { data, error: err } = await supabase.from("visit_log").update({ note: text.trim() || null }).eq("id", log.id).select()
    setBusy(false)
    if (err || !data || data.length === 0) return setError("That couldn't be saved.")
    setEditing(false)
    await onChanged()
  }
  async function undo() {
    setBusy(true)
    setError(null)
    const { data, error: err } = await supabase.from("visit_log").delete().eq("id", log.id).select()
    setBusy(false)
    if (err || !data || data.length === 0) return setError("That couldn't be undone.")
    await onChanged()
  }
  const link = { border: "none", background: "none", padding: 0, color: colors.sageDeep, fontWeight: 700, fontSize: 13, textDecoration: "underline", cursor: "pointer" }

  return (
    <div style={{ display: "flex", gap: 11, alignItems: "flex-start", padding: "10px 0", borderTop: `1px solid ${colors.hairline}` }}>
      <span style={{ width: 26, height: 26, borderRadius: 999, background: ok ? colors.sageTint : colors.rustTint, color: ok ? colors.sageDeep : colors.rust, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1 }}>
        {ok ? <Check size={15} /> : <X size={15} />}
      </span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: colors.ink }}>{visitTitle(visit)}</div>
        <div style={{ fontSize: 13, color: colors.inkSoft, marginTop: 1 }}>{whenText(start)}</div>
        <div style={{ fontSize: 13, color: colors.inkFaint, marginTop: 2 }}>
          {ok ? `Confirmed by ${who}.` : `Didn't happen: ${reasonText(log.reason).toLowerCase()}. Recorded by ${who}.`}{log.note && !editing ? ` "${log.note}"` : ""}
        </div>
        {editing ? (
          <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
            <input value={text} onChange={(e) => setText(e.target.value)} maxLength={300} placeholder="What was done, or anything worth passing on" style={{ ...inputStyle, fontSize: 13, padding: "7px 10px" }} />
            <button onClick={saveNote} disabled={busy} style={{ ...smallButton, background: colors.sage, color: "#fff", border: "none" }}>Save</button>
            <button onClick={() => { setEditing(false); setText(log.note || "") }} style={smallButton}>Cancel</button>
          </div>
        ) : (
          <div style={{ display: "flex", gap: 12, marginTop: 4 }}>
            <button onClick={() => setEditing(true)} style={link}>{log.note ? "Change note" : "Add a note"}</button>
            <button onClick={undo} disabled={busy} style={{ ...link, color: colors.inkFaint }}>Undo</button>
          </div>
        )}
        {error && <p style={{ color: colors.rust, fontSize: 13, margin: "4px 0 0" }}>{error}</p>}
      </div>
    </div>
  )
}

// Every visit set up for one patient, on that patient's own Visits tab. Anyone who can see the patient — caregiver,
// family proxy or administrator — can add one, since they're often the first to hear a visit's been scheduled and
// shouldn't have to relay it through the office first. The same people can also change or remove any of the patient's
// visits, including ones the office added (migration 050); the database enforces this with can_edit_patient.
export function PatientVisits({ patientId, visits, userId, isAdmin, onChanged, nameFor }) {
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState(null)
  const [confirming, setConfirming] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [logs, setLogs] = useState([])
  const [showAllPending, setShowAllPending] = useState(false)
  const [showAllRecent, setShowAllRecent] = useState(false)

  const mine = sortVisits(visits.filter((v) => v.patient_id === patientId))

  // The recorded results for this patient's visits. If the table is not there yet this simply stays empty.
  const loadLogs = useCallback(async () => {
    const { data, error: err } = await supabase.from("visit_log").select("*").eq("patient_id", patientId).order("occurred_on", { ascending: false })
    if (!err) setLogs(data || [])
  }, [patientId])
  useEffect(() => { loadLogs() }, [loadLogs])

  // Visits that have passed in the last two weeks with no result yet, newest first, and the results already recorded.
  const now = new Date()
  const logKey = (visitId, date) => `${visitId}|${date}`
  const recorded = new Set(logs.map((l) => logKey(l.visit_id, l.occurred_on)))
  const pending = occurrences(mine, new Date(now.getTime() - 14 * 86400000), 14)
    .filter((o) => o.end <= now && !recorded.has(logKey(o.shift.id, isoDate(o.start))))
    .sort((a, b) => b.start - a.start)
  const visitById = Object.fromEntries(mine.map((v) => [v.id, v]))
  const results = logs.filter((l) => visitById[l.visit_id]).sort((a, b) => `${b.occurred_on}${visitById[b.visit_id].start_time}`.localeCompare(`${a.occurred_on}${visitById[a.visit_id].start_time}`))
  const afterResult = async () => { await loadLogs() }

  async function remove(id) {
    setBusy(true)
    setError(null)
    const { data, error: err } = await supabase.from("visits").delete().eq("id", id).select()
    setBusy(false)
    setConfirming(null)
    if (err) return setError(err.message)
    if (!data || data.length === 0) return setError("That visit could not be removed. Refresh the page and try again.")
    await onChanged()
  }

  const closeForm = () => { setAdding(false); setEditing(null) }
  const afterSave = async () => { closeForm(); await onChanged() }

  return (
    <>
      {!adding && !editing && (
        <button onClick={() => setAdding(true)} style={{ padding: "10px 16px", borderRadius: 10, border: "none", background: colors.sage, color: "#fff", fontSize: 13.5, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, marginBottom: 14 }}>
          <Plus size={15} /> Add a visit
        </button>
      )}
      {(adding || editing) && (
        <VisitForm lockedPatientId={patientId} userId={userId} existing={editing} onSaved={afterSave} onCancel={closeForm} />
      )}
      {error && <p style={{ color: colors.rust, fontSize: 13, margin: "0 0 12px", lineHeight: 1.45 }}>{error}</p>}

      {pending.length > 0 && (
        <div style={{ marginBottom: 6 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: colors.inkFaint, textTransform: "uppercase", letterSpacing: 0.7, margin: "0 2px 8px" }}>Please confirm</div>
          {(showAllPending ? pending : pending.slice(0, 3)).map((o) => (
            <ConfirmVisit key={`${o.shift.id}|${isoDate(o.start)}`} occ={o} userId={userId} onSaved={afterResult} />
          ))}
          {pending.length > 3 && !showAllPending && (
            <button onClick={() => setShowAllPending(true)} style={{ ...smallButton, marginBottom: 10 }}>Show {pending.length - 3} earlier</button>
          )}
        </div>
      )}

      <Card>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 700, color: colors.ink, marginBottom: 4 }}>
          <HeartHandshake size={16} color={colors.teal} /> Visits
        </div>
        {mine.length === 0 && !adding && (
          <p style={{ fontSize: 13.5, color: colors.inkFaint, margin: 0 }}>No visits set up yet.</p>
        )}
        {mine.map((v) => {
          const expired = isExpired(v)
          return (
            <div key={v.id} style={{ padding: "9px 0", borderTop: `1px solid ${colors.hairline}`, opacity: expired ? 0.55 : 1 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
                <VisitInfo v={v} expired={expired} />
                <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                  <button onClick={() => { setEditing(v); setAdding(false); window.scrollTo({ top: 0, behavior: "smooth" }) }} aria-label="Change visit" style={smallButton}><Pencil size={13} /> Edit</button>
                  <button onClick={() => setConfirming(v.id)} aria-label="Remove visit" style={{ ...smallButton, color: colors.rust }}><Trash2 size={13} /></button>
                </div>
              </div>
              {confirming === v.id && (
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
                  <span style={{ fontSize: 13, color: colors.inkSoft }}>Remove this visit?</span>
                  <button onClick={() => remove(v.id)} disabled={busy} style={{ ...smallButton, background: colors.rust, color: "#fff", border: "none" }}>Yes, remove</button>
                  <button onClick={() => setConfirming(null)} style={smallButton}>Keep</button>
                </div>
              )}
            </div>
          )
        })}
      </Card>

      {results.length > 0 && (
        <Card>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: colors.inkFaint, textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 2 }}>Recent visits</div>
          {(showAllRecent ? results : results.slice(0, 6)).map((l) => (
            <ResultRow key={l.id} log={l} visit={visitById[l.visit_id]} nameFor={nameFor} patientId={patientId} onChanged={afterResult} />
          ))}
          {results.length > 6 && !showAllRecent && (
            <button onClick={() => setShowAllRecent(true)} style={{ ...smallButton, marginTop: 8 }}>Show {results.length - 6} earlier</button>
          )}
        </Card>
      )}
    </>
  )
}

/* ---------------- administrator: set up visits across every patient ---------------- */

export function VisitsAdmin({ userId, patients, visits, onChanged }) {
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState(null)
  const [confirming, setConfirming] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const patientName = (id) => patients.find((p) => p.id === id)?.full_name || "Patient"

  async function remove(id) {
    setBusy(true)
    setError(null)
    const { data, error: err } = await supabase.from("visits").delete().eq("id", id).select()
    setBusy(false)
    setConfirming(null)
    if (err) return setError(err.message)
    if (!data || data.length === 0) return setError("That visit could not be removed. Refresh the page and try again.")
    await onChanged()
  }

  const closeForm = () => { setAdding(false); setEditing(null) }
  const afterSave = async () => { closeForm(); await onChanged() }

  const byPatient = {}
  for (const v of visits) (byPatient[v.patient_id] ||= []).push(v)
  const patientIds = Object.keys(byPatient).sort((a, b) => patientName(a).localeCompare(patientName(b)))

  return (
    <>
      <p style={{ fontSize: 13, color: colors.inkSoft, margin: "0 0 12px", lineHeight: 1.5 }}>
        Set up a therapist, nurse, or other visitor's schedule for a patient. Everyone caring for that patient can see it, and a caregiver or family proxy can add one too. They can also change or remove a visit they added themselves; as the administrator, you can change or remove any of them.
      </p>

      {!adding && !editing && (
        <button onClick={() => setAdding(true)} style={{ padding: "10px 16px", borderRadius: 10, border: "none", background: colors.sage, color: "#fff", fontSize: 13.5, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, marginBottom: 14 }}>
          <Plus size={15} /> Add a visit
        </button>
      )}
      {(adding || editing) && (
        <VisitForm patients={patients} userId={userId} existing={editing} onSaved={afterSave} onCancel={closeForm} />
      )}

      {error && <p style={{ color: colors.rust, fontSize: 13, margin: "0 0 12px", lineHeight: 1.45 }}>{error}</p>}

      {patientIds.length === 0 ? (
        <p style={{ fontSize: 13.5, color: colors.inkFaint }}>No visits set up yet.</p>
      ) : (
        patientIds.map((id) => {
          const list = sortVisits(byPatient[id])
          return (
            <Card key={id}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
                <span style={{ width: 38, height: 38, borderRadius: 999, background: colors.sageTint, color: colors.sageDeep, fontWeight: 700, fontSize: 13.5, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  {(patientName(id).split(/\s+/).map((w) => w[0]).join("").slice(0, 2) || "?").toUpperCase()}
                </span>
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span style={{ display: "block", fontFamily: "Fraunces, Georgia, serif", fontSize: 18, fontWeight: 600, color: colors.ink }}>{patientName(id)}</span>
                  <span style={{ display: "block", fontSize: 13, color: colors.inkFaint }}>{list.length} {list.length === 1 ? "visit" : "visits"}</span>
                </span>
              </div>
              {list.map((v) => {
                const expired = isExpired(v)
                return (
                  <div key={v.id} style={{ borderTop: `1px solid ${colors.hairline}`, padding: "11px 0 11px 50px", opacity: expired ? 0.55 : 1 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
                      <VisitInfo v={v} expired={expired} />
                      <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                        <button onClick={() => setEditing(v)} aria-label="Change visit" style={smallButton}><Pencil size={13} /> Edit</button>
                        <button onClick={() => setConfirming(v.id)} aria-label="Remove visit" style={{ ...smallButton, color: colors.rust }}><Trash2 size={13} /></button>
                      </div>
                    </div>
                    {confirming === v.id && (
                      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
                        <span style={{ fontSize: 13, color: colors.inkSoft }}>Remove this visit?</span>
                        <button onClick={() => remove(v.id)} disabled={busy} style={{ ...smallButton, background: colors.rust, color: "#fff", border: "none" }}>Yes, remove</button>
                        <button onClick={() => setConfirming(null)} style={smallButton}>Keep</button>
                      </div>
                    )}
                  </div>
                )
              })}
            </Card>
          )
        })
      )}
    </>
  )
}
