import { useState, useEffect } from "react"
import { Dumbbell, Check, Minus, X as XIcon, Plus, Pencil, Printer, Camera, RefreshCw, FileText, Trash2 } from "lucide-react"
import { supabase } from "../supabaseClient.js"
import { WEEKDAYS, DAY_ORDER } from "../shifts.js"
import { Card, DoneRow, colors, inputStyle, primaryButton, quietButton, fmtTime } from "./ui.jsx"
import { dayKey } from "./medication.js"
import { isBefore, hourText, PM_EXERCISE_OPENS } from "./timeOfDay.js"
import {
  DISCIPLINES, SLOTS, SLOT_LABEL, ALL_DAYS, STATUS_WORD, REASONS, reasonLabel, CONCERN_REASONS,
  scheduledRows, entryFor, lastDays, cellFor, summarize, todaySummary, printExerciseReport,
} from "./exercises.js"

const labelStyle = { fontSize: 13, fontWeight: 700, color: colors.inkSoft, display: "block", marginBottom: 5 }
const STATE_LOOK = {
  done: { bg: colors.sage, border: colors.sage, icon: Check, color: "#fff", word: "Done" },
  partly: { bg: colors.gold, border: colors.gold, icon: Minus, color: "#fff", word: "Partly done" },
  not_done: { bg: colors.rust, border: colors.rust, icon: XIcon, color: "#fff", word: "Not done" },
  not_recorded: { bg: "#fff", border: colors.inkFaint, icon: null, color: colors.inkFaint, word: "Not recorded", dashed: true },
  pending: { bg: "#fff", border: colors.hairline, icon: null, color: colors.inkFaint, word: "Still to do" },
}

/* ---------------- the therapist's sheet: photos ---------------- */

const isPdf = (path) => /\.pdf$/i.test(path)

function useSignedUrls(paths) {
  const [urls, setUrls] = useState({})
  const key = (paths || []).join("|")
  useEffect(() => {
    let cancelled = false
    if (!paths || paths.length === 0) { setUrls({}); return }
    supabase.storage.from("exercise-sheets").createSignedUrls(paths, 3600).then(({ data }) => {
      if (cancelled || !data) return
      setUrls(Object.fromEntries(data.filter((d) => d.signedUrl).map((d) => [d.path, d.signedUrl])))
    })
    return () => { cancelled = true }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  return urls
}

function SheetPhotos({ paths }) {
  const urls = useSignedUrls(paths)
  if (!paths || paths.length === 0) return null
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "10px 0 4px" }}>
      {paths.map((p, i) => {
        const url = urls[p]
        return (
          <a key={p} href={url || undefined} target="_blank" rel="noreferrer" aria-label={`Open the therapist's sheet, page ${i + 1}`}
            style={{ width: 76, height: 76, borderRadius: 10, border: `1px solid ${colors.hairline}`, background: colors.bg, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", textDecoration: "none", color: colors.inkSoft, fontSize: 12.5, fontWeight: 700 }}>
            {!url ? "..." : isPdf(p) ? <span style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}><FileText size={20} />PDF</span>
              : <img src={url} alt={`The therapist's sheet, page ${i + 1}`} style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
          </a>
        )
      })}
    </div>
  )
}

// A phone photo is several megabytes; shrink it so it uploads quickly on a weak signal and the sheet stays readable.
async function shrinkImage(file) {
  if (file.type === "application/pdf") return file
  try {
    const bmp = await createImageBitmap(file)
    const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height))
    const canvas = document.createElement("canvas")
    canvas.width = Math.round(bmp.width * scale)
    canvas.height = Math.round(bmp.height * scale)
    canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85))
    return blob ? new File([blob], "sheet.jpg", { type: "image/jpeg" }) : file
  } catch {
    return file
  }
}
const extFor = (file) => ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "application/pdf": "pdf" }[file.type] || "jpg")

/* ---------------- add or change a plan ---------------- */

const blankExercise = () => ({ key: Math.random().toString(36).slice(2), id: null, name: "", detail: "", slots: ["am", "pm"], weekdays: [...ALL_DAYS] })

function PlanForm({ patientId, userId, existing, existingExercises, copyFrom, onSaved, onCancel }) {
  const source = existing || copyFrom
  const [discipline, setDiscipline] = useState(source?.discipline || DISCIPLINES[0])
  const [therapist, setTherapist] = useState(source?.therapist_name || "")
  const [title, setTitle] = useState(existing?.title || "")
  const [precautions, setPrecautions] = useState(source?.precautions || "")
  const [paths, setPaths] = useState(existing?.sheet_paths || [])
  const [newFiles, setNewFiles] = useState([])
  const [items, setItems] = useState(() => {
    const list = existing ? existingExercises : copyFrom ? copyFrom.exercises : []
    return list.length ? list.map((e) => ({ key: Math.random().toString(36).slice(2), id: existing ? e.id : null, name: e.name, detail: e.detail || "", slots: [...e.slots], weekdays: [...e.weekdays] })) : [blankExercise()]
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const urls = useSignedUrls(paths)

  const setItem = (key, patch) => setItems((list) => list.map((it) => (it.key === key ? { ...it, ...patch } : it)))
  const toggleIn = (arr, v) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v])

  async function addFiles(e) {
    const picked = Array.from(e.target.files || [])
    e.target.value = ""
    const ok = []
    for (const f of picked) {
      if (!f.type.startsWith("image/") && f.type !== "application/pdf") { setError("Only photos and PDFs can be added."); continue }
      const small = await shrinkImage(f)
      if (small.size > 10 * 1024 * 1024) { setError("That file is too large (10 MB at most)."); continue }
      ok.push(small)
    }
    setNewFiles((list) => [...list, ...ok].slice(0, 10 - paths.length))
  }

  async function save(e) {
    e.preventDefault()
    setError(null)
    const named = items.filter((it) => it.name.trim())
    if (named.length === 0) return setError("Add at least one exercise, in the therapist's words.")
    if (named.some((it) => it.slots.length === 0 || it.weekdays.length === 0)) return setError("Each exercise needs at least one time (AM or PM) and one day.")
    setBusy(true)
    try {
      // 1. The plan itself.
      const planFields = {
        discipline, therapist_name: therapist.trim() || null, title: title.trim() || null, precautions: precautions.trim() || null,
      }
      let planId = existing?.id
      if (existing) {
        const { error: err } = await supabase.from("exercise_plans").update(planFields).eq("id", planId)
        if (err) throw err
      } else {
        const { data, error: err } = await supabase.from("exercise_plans").insert({ ...planFields, patient_id: patientId, created_by: userId }).select("id").single()
        if (err) throw err
        planId = data.id
      }
      // 2. Photos of the sheet. A failed upload stops here; the plan is saved and the photo can be added again.
      const uploaded = []
      for (const file of newFiles) {
        const path = `${patientId}/${crypto.randomUUID()}.${extFor(file)}`
        const { error: err } = await supabase.storage.from("exercise-sheets").upload(path, file, { contentType: file.type })
        if (err) throw new Error("The plan was saved, but a photo could not be uploaded. Open the plan and add it again.")
        uploaded.push(path)
      }
      const finalPaths = [...paths, ...uploaded]
      if (existing ? (finalPaths.join() !== (existing.sheet_paths || []).join()) : uploaded.length) {
        const { error: err } = await supabase.from("exercise_plans").update({ sheet_paths: finalPaths }).eq("id", planId)
        if (err) throw err
      }
      const removed = (existing?.sheet_paths || []).filter((p) => !paths.includes(p))
      if (removed.length) await supabase.storage.from("exercise-sheets").remove(removed)
      // 3. The exercises: new ones are added, changed ones updated, ones taken out are retired so history stays.
      const keptIds = named.filter((it) => it.id).map((it) => it.id)
      const retired = (existingExercises || []).filter((x) => !keptIds.includes(x.id)).map((x) => x.id)
      if (retired.length) {
        const { error: err } = await supabase.from("exercises").update({ active: false }).in("id", retired)
        if (err) throw err
      }
      for (const [index, it] of named.entries()) {
        const fields = { name: it.name.trim(), detail: it.detail.trim() || null, slots: SLOTS.filter((s) => it.slots.includes(s)), weekdays: [...it.weekdays].sort(), sort_order: index }
        const { error: err } = it.id
          ? await supabase.from("exercises").update(fields).eq("id", it.id)
          : await supabase.from("exercises").insert({ ...fields, plan_id: planId, patient_id: patientId })
        if (err) throw err
      }
      // 4. A replacement sheet retires the one before it, once the new one is safely saved.
      if (copyFrom?.replacesPlanId) {
        const { error: err } = await supabase.from("exercise_plans").update({ active: false, ended_on: dayKey(new Date()) }).eq("id", copyFrom.replacesPlanId)
        if (err) throw err
        await supabase.from("exercises").update({ active: false }).eq("plan_id", copyFrom.replacesPlanId)
      }
    } catch (err) {
      setBusy(false)
      return setError(err.message || "That couldn't be saved. Check your connection and try again.")
    }
    setBusy(false)
    onSaved()
  }

  return (
    <Card>
      <form onSubmit={save}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: colors.ink }}>{existing ? "Change exercise plan" : copyFrom?.replacesPlanId ? "New sheet from the therapist" : "New exercise plan"}</div>
          <button type="button" onClick={onCancel} aria-label="Close" style={{ border: "none", background: "transparent", cursor: "pointer", color: colors.inkFaint }}><XIcon size={18} /></button>
        </div>
        <p style={{ fontSize: 13, color: colors.inkFaint, margin: "0 0 14px", lineHeight: 1.5 }}>
          Copy the exercises from the therapist's sheet exactly as written. Strovia only records what the therapist prescribed; it never suggests or changes an exercise.
        </p>

        <div style={{ display: "flex", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 180px" }}>
            <label style={labelStyle}>Who set these exercises</label>
            <select value={discipline} onChange={(e) => setDiscipline(e.target.value)} style={inputStyle}>
              {DISCIPLINES.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div style={{ flex: "1 1 180px" }}>
            <label style={labelStyle}>Therapist's name (optional)</label>
            <input value={therapist} onChange={(e) => setTherapist(e.target.value)} maxLength={80} placeholder="e.g. Sarah Chen" style={inputStyle} />
          </div>
        </div>
        <label style={labelStyle}>Name of this sheet (optional)</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="e.g. Arm program, week 3" style={{ ...inputStyle, marginBottom: 12 }} />

        <label style={labelStyle}>Precautions from the therapist (optional)</label>
        <textarea value={precautions} onChange={(e) => setPrecautions(e.target.value)} maxLength={600} rows={2} placeholder="For example: stop if there is pain or a headache" style={{ ...inputStyle, resize: "vertical", marginBottom: 12 }} />

        <label style={labelStyle}>Photo of the printed sheet (optional)</label>
        <p style={{ fontSize: 13, color: colors.inkFaint, margin: "0 0 8px", lineHeight: 1.5 }}>
          Lay the page flat in good light and fill the frame. The diagrams stay one tap away next to the exercises. On a laptop this opens the file picker; on a phone, the camera.
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
          {paths.map((p, i) => (
            <div key={p} style={{ position: "relative", width: 76, height: 76, borderRadius: 10, border: `1px solid ${colors.hairline}`, overflow: "hidden", background: colors.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
              {isPdf(p) ? <FileText size={22} color={colors.inkSoft} /> : urls[p] ? <img src={urls[p]} alt={`Page ${i + 1}`} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : "..."}
              <button type="button" onClick={() => setPaths((list) => list.filter((x) => x !== p))} aria-label="Remove this photo" style={{ position: "absolute", top: 2, right: 2, width: 22, height: 22, borderRadius: 999, border: "none", background: "rgba(32,38,31,0.7)", color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}><XIcon size={13} /></button>
            </div>
          ))}
          {newFiles.map((f, i) => (
            <div key={i} style={{ position: "relative", width: 76, height: 76, borderRadius: 10, border: `1px dashed ${colors.sage}`, background: colors.sageTint, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12.5, fontWeight: 700, color: colors.sageDeep, textAlign: "center", padding: 4, boxSizing: "border-box" }}>
              New {f.type === "application/pdf" ? "PDF" : "photo"}
              <button type="button" onClick={() => setNewFiles((list) => list.filter((_, j) => j !== i))} aria-label="Remove this photo" style={{ position: "absolute", top: 2, right: 2, width: 22, height: 22, borderRadius: 999, border: "none", background: "rgba(32,38,31,0.7)", color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}><XIcon size={13} /></button>
            </div>
          ))}
          {paths.length + newFiles.length < 10 && (
            <label style={{ ...quietButton, width: 76, height: 76, boxSizing: "border-box", flexDirection: "column", justifyContent: "center", gap: 4, fontSize: 12.5, cursor: "pointer" }}>
              <Camera size={20} /> Add
              <input type="file" accept="image/*,application/pdf" multiple onChange={addFiles} style={{ display: "none" }} />
            </label>
          )}
        </div>

        <label style={{ ...labelStyle, marginTop: 14 }}>The exercises</label>
        {items.map((it, index) => (
          <div key={it.key} style={{ border: `1px solid ${colors.hairline}`, borderRadius: 12, padding: 12, marginBottom: 10 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
              <input value={it.name} onChange={(e) => setItem(it.key, { name: e.target.value })} maxLength={120} placeholder={`Exercise ${index + 1}, e.g. Arm raises`} aria-label="Exercise name" style={inputStyle} />
              {items.length > 1 && (
                <button type="button" onClick={() => setItems((list) => list.filter((x) => x.key !== it.key))} aria-label="Take this exercise out" style={{ ...quietButton, padding: "9px 10px", color: colors.rust }}><Trash2 size={14} /></button>
              )}
            </div>
            <input value={it.detail} onChange={(e) => setItem(it.key, { detail: e.target.value })} maxLength={400} placeholder="How many, how long, how (as written on the sheet)" aria-label="Instructions" style={{ ...inputStyle, marginBottom: 10 }} />
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: colors.inkSoft, marginRight: 4 }}>Times a day</span>
              {SLOTS.map((s) => {
                const on = it.slots.includes(s)
                return <button type="button" key={s} onClick={() => setItem(it.key, { slots: toggleIn(it.slots, s) })} aria-pressed={on}
                  style={{ minWidth: 52, padding: "7px 0", borderRadius: 999, border: `1px solid ${on ? colors.sage : colors.hairline}`, background: on ? colors.sage : "#fff", color: on ? "#fff" : colors.inkSoft, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>{SLOT_LABEL[s]}</button>
              })}
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {DAY_ORDER.map((d) => {
                const on = it.weekdays.includes(d)
                return <button type="button" key={d} onClick={() => setItem(it.key, { weekdays: toggleIn(it.weekdays, d) })} aria-pressed={on}
                  style={{ minWidth: 46, padding: "7px 0", borderRadius: 999, border: `1px solid ${on ? colors.sage : colors.hairline}`, background: on ? colors.sageTint : "#fff", color: on ? colors.sageDeep : colors.inkFaint, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>{WEEKDAYS[d].slice(0, 3)}</button>
              })}
            </div>
          </div>
        ))}
        <button type="button" onClick={() => setItems((list) => [...list, blankExercise()])} style={{ ...quietButton, marginBottom: 14 }}><Plus size={14} /> Add another exercise</button>

        {error && <p style={{ color: colors.rust, fontSize: 13, margin: "0 0 12px", lineHeight: 1.45 }}>{error}</p>}
        <div style={{ display: "flex", gap: 8 }}>
          <button type="submit" disabled={busy} style={{ ...primaryButton, flex: 1, padding: "11px 0", opacity: busy ? 0.7 : 1 }}>{busy ? "Saving..." : "Save plan"}</button>
          <button type="button" onClick={onCancel} style={{ ...quietButton, padding: "11px 16px" }}>Cancel</button>
        </div>
      </form>
    </Card>
  )
}

/* ---------------- today's tick sheet ---------------- */

function TodayRow({ row, entry, userId, isAdmin, nameFor, patientId, busy, onSave, onUndo, offShift }) {
  const [picking, setPicking] = useState(null) // "partly" | "not_done"
  const [reason, setReason] = useState(null)
  const [note, setNote] = useState("")
  const mine = entry && (entry.done_by === userId || isAdmin)
  const look = entry ? STATE_LOOK[entry.status] : null
  const concern = entry && entry.status !== "done" && CONCERN_REASONS.includes(entry.reason)
  // The PM exercises open at 12 noon. Before then the buttons are replaced by a note; an administrator can still record one early, with a reason.
  const waiting = !entry && row.slot === "pm" && isBefore(new Date(), PM_EXERCISE_OPENS)
  const guardedSave = async (r, s, rs, n) => {
    if (waiting) {
      if (!isAdmin) return false
      const why = (window.prompt(`The PM exercises open at ${hourText(PM_EXERCISE_OPENS)}. Why is this being recorded early?`) || "").trim()
      if (!why) return false
      return onSave(r, s, rs, n, why)
    }
    return onSave(r, s, rs, n)
  }

  async function submit() {
    if (picking === "not_done" && !reason) return
    const ok = await guardedSave(row, picking, reason, note)
    if (ok) { setPicking(null); setReason(null); setNote("") }
  }

  return (
    <div style={{ padding: "11px 0", borderTop: `1px solid ${colors.hairline}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ minWidth: 0, flex: "1 1 200px" }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ fontSize: 12.5, fontWeight: 800, color: colors.sageDeep, background: colors.sageTint, borderRadius: 999, padding: "2px 9px" }}>{SLOT_LABEL[row.slot]}</span>
            <span style={{ fontSize: 14.5, fontWeight: 700, color: colors.ink }}>{row.exercise.name}</span>
          </div>
          {row.exercise.detail && <div style={{ fontSize: 13, color: colors.inkSoft, marginTop: 3, lineHeight: 1.45 }}>{row.exercise.detail}</div>}
        </div>
        {entry ? (
          <div style={{ textAlign: "right", flexShrink: 0 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 13, fontWeight: 700, color: look.bg, background: colors.bg, border: `1px solid ${look.border}`, borderRadius: 999, padding: "4px 10px" }}>
              {look.icon && <look.icon size={13} />} {STATUS_WORD[entry.status]}
            </span>
            <div style={{ fontSize: 13, color: colors.inkFaint, marginTop: 4 }}>{nameFor(patientId, entry.done_by) || "Someone"}, {fmtTime(entry.done_at)}</div>
            {mine && <button onClick={() => onUndo(entry)} disabled={busy} style={{ border: "none", background: "none", color: colors.inkSoft, fontSize: 13, fontWeight: 700, textDecoration: "underline", cursor: "pointer", padding: "2px 0" }}>Undo</button>}
          </div>
        ) : waiting && !isAdmin ? (
          <div style={{ fontSize: 13, color: colors.inkFaint, textAlign: "right", flexShrink: 0 }}>Opens at {hourText(PM_EXERCISE_OPENS)}</div>
        ) : !picking && (
          <div style={{ display: "flex", gap: 6, flexShrink: 0, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
            {waiting && <span style={{ fontSize: 12.5, color: colors.inkFaint }}>Opens at {hourText(PM_EXERCISE_OPENS)}</span>}
            <button onClick={() => guardedSave(row, "done")} disabled={busy || offShift} style={{ ...primaryButton, padding: "8px 14px", fontSize: 13, opacity: busy || offShift ? 0.5 : 1 }}>Done</button>
            <button onClick={() => setPicking("partly")} disabled={busy || offShift} style={{ ...quietButton, opacity: offShift ? 0.5 : 1 }}>Partly</button>
            <button onClick={() => setPicking("not_done")} disabled={busy || offShift} style={{ ...quietButton, color: colors.rust, opacity: offShift ? 0.5 : 1 }}>Not done</button>
          </div>
        )}
      </div>

      {entry && entry.early_reason && <div style={{ fontSize: 13, color: colors.inkFaint, marginTop: 6 }}>Recorded early: {entry.early_reason}</div>}
      {entry && entry.reason && <div style={{ fontSize: 13, color: colors.inkSoft, marginTop: 6 }}>{reasonLabel(entry.reason)}{entry.note ? `: ${entry.note}` : ""}</div>}
      {entry && !entry.reason && entry.note && <div style={{ fontSize: 13, color: colors.inkSoft, marginTop: 6 }}>{entry.note}</div>}
      {concern && (
        <div style={{ fontSize: 13, color: colors.ink, background: colors.goldTint, borderRadius: 10, padding: "8px 10px", marginTop: 8, lineHeight: 1.5 }}>
          Pain, dizziness or feeling unwell is worth telling the care team or the therapist about. If something new and sudden appears, such as a drooping face, weak arm or trouble speaking, go to the Safety page or call 911.
        </div>
      )}

      {picking && (
        <div style={{ marginTop: 10, background: colors.bg, borderRadius: 12, padding: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: colors.ink, marginBottom: 8 }}>
            {picking === "partly" ? "Partly done. What got in the way? (optional)" : "What got in the way?"}
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
            {REASONS.map((r) => {
              const on = reason === r.key
              return <button key={r.key} onClick={() => setReason(on ? null : r.key)} aria-pressed={on}
                style={{ padding: "7px 12px", borderRadius: 999, border: `1px solid ${on ? colors.sage : colors.hairline}`, background: on ? colors.sage : "#fff", color: on ? "#fff" : colors.inkSoft, fontWeight: 600, fontSize: 13, cursor: "pointer" }}>{r.label}</button>
            })}
          </div>
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Anything to add? (optional)" aria-label="Note" style={{ ...inputStyle, marginBottom: 10 }} />
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={submit} disabled={busy || (picking === "not_done" && !reason)} style={{ ...primaryButton, padding: "9px 16px", opacity: busy || (picking === "not_done" && !reason) ? 0.5 : 1 }}>Save</button>
            <button onClick={() => { setPicking(null); setReason(null); setNote("") }} style={quietButton}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}

/* ---------------- the last seven days ---------------- */

function Mark({ state, label }) {
  const look = STATE_LOOK[state]
  return (
    <span title={`${label}: ${look.word}`} aria-label={`${label}: ${look.word}`}
      style={{ width: 16, height: 16, borderRadius: 4, boxSizing: "border-box", background: look.bg, border: `1.5px ${look.dashed ? "dashed" : "solid"} ${look.border}`, display: "inline-flex", alignItems: "center", justifyContent: "center", color: look.color }}>
      {look.icon && <look.icon size={11} strokeWidth={3.5} />}
    </span>
  )
}

function WeekGrid({ exercises, log, days, now }) {
  return (
    <div style={{ overflowX: "auto", margin: "0 -4px" }}>
      <table style={{ borderCollapse: "collapse", minWidth: 300, width: "100%" }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left", fontSize: 12.5, color: colors.inkFaint, padding: "4px" }}>Exercise</th>
            {days.map((d) => (
              <th key={dayKey(d)} style={{ fontSize: 12.5, color: dayKey(d) === dayKey(now) ? colors.sageDeep : colors.inkFaint, fontWeight: 700, padding: "4px 2px", textAlign: "center" }}>
                {d.toLocaleDateString(undefined, { weekday: "short" })}<br />{d.getDate()}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {exercises.map((ex) => (
            <tr key={ex.id} style={{ borderTop: `1px solid ${colors.hairline}` }}>
              <td style={{ fontSize: 13, fontWeight: 600, color: colors.ink, padding: "8px 4px", maxWidth: 110, lineHeight: 1.3 }}>{ex.name}</td>
              {days.map((d) => {
                const cells = cellFor(ex, d, log, now)
                return (
                  <td key={dayKey(d)} style={{ textAlign: "center", padding: "6px 2px" }}>
                    {cells.length === 0 ? <span style={{ color: colors.hairline }}>–</span> : (
                      <span style={{ display: "inline-flex", gap: 3 }}>
                        {cells.map((c) => <Mark key={c.slot} state={c.state} label={`${ex.name}, ${d.toLocaleDateString(undefined, { weekday: "long" })} ${SLOT_LABEL[c.slot]}`} />)}
                      </span>
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 12.5, color: colors.inkSoft, marginTop: 10, paddingLeft: 4 }}>
        {["done", "partly", "not_done", "not_recorded", "pending"].map((s) => (
          <span key={s} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><Mark state={s} label="Key" /> {STATE_LOOK[s].word}</span>
        ))}
      </div>
      <p style={{ fontSize: 12.5, color: colors.inkFaint, margin: "6px 4px 0" }}>Two boxes in a day are AM then PM. A dash means it isn't scheduled that day.</p>
    </div>
  )
}

/* ---------------- the tab ---------------- */

export default function Exercises({ patientId, userId, isAdmin, patientName, plans, exercises, log, nameFor, onChanged, offShift }) {
  const [form, setForm] = useState(null) // null | { existing } | { copyFrom }
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)
  const [blocked, setBlocked] = useState(false)
  const [confirmingEnd, setConfirmingEnd] = useState(null)

  const now = new Date()
  const key = dayKey(now)
  const rows = scheduledRows(exercises, now)
  const today = todaySummary(exercises, log, now)
  const days = lastDays(7, now)
  const week = summarize(exercises, log, days, now)
  const exercisesOf = (planId) => exercises.filter((e) => e.plan_id === planId)

  async function saveEntry(row, status, reason, note, earlyReason) {
    const rowKey = `${row.exercise.id}-${row.slot}`
    setBusy(rowKey)
    setError(null)
    const { error: err } = await supabase.from("exercise_log").insert({
      patient_id: patientId, exercise_id: row.exercise.id, log_date: key, slot: row.slot, status,
      reason: reason || null, note: note?.trim() || null, done_by: userId, ...(earlyReason ? { early_reason: earlyReason } : {}),
    })
    setBusy(null)
    // Two people ticking the same box at once is fine: the second just refreshes.
    if (err && err.code !== "23505") { setError(err.code === "P0001" ? err.message : "That couldn't be saved. Check your connection and try again."); return false }
    await onChanged()
    return true
  }

  async function undo(entry) {
    setBusy(entry.id)
    setError(null)
    const { error: err } = await supabase.from("exercise_log").delete().eq("id", entry.id)
    setBusy(null)
    if (err) setError("That couldn't be undone. Try again.")
    await onChanged()
  }

  async function endPlan(plan) {
    setBusy(plan.id)
    setError(null)
    const a = await supabase.from("exercise_plans").update({ active: false, ended_on: key }).eq("id", plan.id)
    const b = await supabase.from("exercises").update({ active: false }).eq("plan_id", plan.id)
    setBusy(null)
    setConfirmingEnd(null)
    if (a.error || b.error) setError("That couldn't be saved. Try again.")
    await onChanged()
  }

  const afterSave = async () => { setForm(null); await onChanged() }

  if (form) {
    return (
      <PlanForm
        patientId={patientId} userId={userId}
        existing={form.existing} existingExercises={form.existing ? exercisesOf(form.existing.id) : []} copyFrom={form.copyFrom}
        onSaved={afterSave} onCancel={() => setForm(null)}
      />
    )
  }

  if (plans.length === 0) {
    return (
      <Card>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <Dumbbell size={16} color={colors.sageDeep} />
          <span style={{ fontSize: 14, fontWeight: 700, color: colors.ink }}>Exercises</span>
        </div>
        <p style={{ fontSize: 13.5, color: colors.inkSoft, lineHeight: 1.55, margin: "0 0 12px" }}>
          When a physiotherapist, occupational therapist or speech therapist leaves home exercises, add the sheet here. You tick each exercise off by morning and evening, say why when one is missed, and Strovia sums up the week to show the therapist.
        </p>
        <button onClick={() => setForm({})} style={{ ...primaryButton, display: "inline-flex", alignItems: "center", gap: 6 }}><Plus size={15} /> Add the therapist's sheet</button>
      </Card>
    )
  }

  return (
    <>
      <Card>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 4 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 700, color: colors.ink }}>
            <Dumbbell size={16} color={colors.sageDeep} /> Today's exercises
          </span>
          {today.total > 0 && <span style={{ fontSize: 13, fontWeight: 700, color: today.recorded === today.total ? colors.sageDeep : colors.inkSoft }}>{today.recorded} of {today.total} recorded</span>}
        </div>
        {today.total > 0 && (
          <div style={{ height: 8, background: colors.sageTint, borderRadius: 999, margin: "6px 0 6px", overflow: "hidden" }}>
            <div style={{ width: `${(today.recorded / today.total) * 100}%`, height: "100%", background: colors.sage, borderRadius: 999, transition: "width 0.3s ease" }} />
          </div>
        )}
        {plans.filter((p) => p.precautions).map((p) => (
          <div key={p.id} style={{ fontSize: 13, color: colors.ink, background: colors.goldTint, borderRadius: 10, padding: "8px 10px", margin: "8px 0", lineHeight: 1.5 }}>
            <strong>Precautions{plans.length > 1 ? ` (${p.discipline})` : ""}:</strong> {p.precautions}
          </div>
        ))}
        {rows.length === 0 && <p style={{ fontSize: 13.5, color: colors.inkFaint, margin: "8px 0 0" }}>Nothing is scheduled for today.</p>}
        {rows.map((row) => {
          const entry = entryFor(log, row.exercise.id, key, row.slot)
          return (
            <TodayRow key={`${row.exercise.id}-${row.slot}`} row={row} entry={entry} userId={userId} isAdmin={isAdmin} nameFor={nameFor} patientId={patientId}
              busy={busy === `${row.exercise.id}-${row.slot}` || busy === entry?.id} onSave={saveEntry} onUndo={undo} offShift={offShift} />
          )
        })}
        {offShift && today.open.length > 0 && (
          <p style={{ fontSize: 13, color: colors.rust, margin: "8px 0 0", lineHeight: 1.5 }}>
            You're not on shift for this patient right now, so you can't record the {today.open.length === 1 ? "exercise" : `${today.open.length} exercises`} still to do.
            {today.recorded > 0 ? " What was already recorded today stays as it is." : ""} Someone on shift, or a family member, can record the rest.
          </p>
        )}
        {error && <p style={{ color: colors.rust, fontSize: 13, margin: "8px 0 0" }}>{error}</p>}
      </Card>

      <Card>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: colors.ink }}>The last 7 days</span>
          <button className="no-print" onClick={() => setBlocked(!printExerciseReport({ patientName, plans, exercises, log, nameFor, patientId }))} style={quietButton}><Printer size={14} /> Print for the therapist</button>
        </div>
        {blocked && <p style={{ fontSize: 13, color: colors.rust, margin: "0 0 10px" }}>Your browser blocked the print window. Allow pop-ups for this site and try again.</p>}
        <div style={{ fontSize: 14, color: colors.ink, lineHeight: 1.55, marginBottom: 10 }}>
          {week.due === 0 ? "Nothing has been due yet." : (
            <>
              <strong>{week.done} of {week.due}</strong> recorded as done
              {week.partly > 0 && <>, {week.partly} partly done</>}
              {week.notDone > 0 && <>, {week.notDone} not done</>}
              {week.notRecorded > 0 && <>, {week.notRecorded} not recorded</>}.
            </>
          )}
        </div>
        {Object.keys(week.reasons).length > 0 && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
            {Object.entries(week.reasons).sort((a, b) => b[1] - a[1]).map(([k, n]) => (
              <span key={k} style={{ fontSize: 13, fontWeight: 600, color: CONCERN_REASONS.includes(k) ? colors.rust : colors.inkSoft, background: CONCERN_REASONS.includes(k) ? colors.rustTint : colors.bg, borderRadius: 999, padding: "4px 11px" }}>{reasonLabel(k)}: {n}</span>
            ))}
          </div>
        )}
        {week.concerns.length > 0 && (
          <p style={{ fontSize: 13, color: colors.ink, background: colors.goldTint, borderRadius: 10, padding: "8px 10px", margin: "0 0 12px", lineHeight: 1.5 }}>
            Pain, dizziness or feeling unwell was recorded {week.concerns.length} {week.concerns.length === 1 ? "time" : "times"} this week. It's worth telling the therapist or doctor.
          </p>
        )}
        <WeekGrid exercises={exercises} log={log} days={days} now={now} />
      </Card>

      <div style={{ fontSize: 14, fontWeight: 700, color: colors.ink, margin: "20px 2px 8px" }}>Exercise plans</div>
      {plans.map((plan) => (
        <Card key={plan.id}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 14.5, fontWeight: 700, color: colors.ink }}>{plan.discipline}{plan.therapist_name ? `, ${plan.therapist_name}` : ""}</div>
              <div style={{ fontSize: 13, color: colors.inkFaint }}>{plan.title ? `${plan.title} · ` : ""}from {new Date(plan.starts_on + "T00:00:00").toLocaleDateString()}</div>
            </div>
            <button onClick={() => setForm({ existing: plan })} aria-label="Change this plan" style={quietButton}><Pencil size={13} /></button>
          </div>
          <SheetPhotos paths={plan.sheet_paths} />
          <div style={{ marginTop: 8 }}>
            {exercisesOf(plan.id).map((ex) => (
              <div key={ex.id} style={{ padding: "7px 0", borderTop: `1px solid ${colors.hairline}`, fontSize: 13.5, color: colors.ink }}>
                <strong>{ex.name}</strong>{ex.detail ? <span style={{ color: colors.inkSoft }}> · {ex.detail}</span> : null}
                <div style={{ fontSize: 13, color: colors.inkFaint }}>
                  {ex.slots.map((s) => SLOT_LABEL[s]).join(" and ")} · {ex.weekdays.length === 7 ? "every day" : DAY_ORDER.filter((d) => ex.weekdays.includes(d)).map((d) => WEEKDAYS[d].slice(0, 3)).join(", ")}
                </div>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
            <button onClick={() => setForm({ copyFrom: { ...plan, exercises: exercisesOf(plan.id), replacesPlanId: plan.id } })} style={quietButton}><RefreshCw size={13} /> The therapist gave a new sheet</button>
            <button onClick={() => setConfirmingEnd(plan.id)} style={{ ...quietButton, color: colors.rust }}>Stop this plan</button>
          </div>
          {confirmingEnd === plan.id && (
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 13, color: colors.inkSoft }}>Stop tracking this plan? Past records are kept.</span>
              <button onClick={() => endPlan(plan)} disabled={busy === plan.id} style={{ ...quietButton, background: colors.rust, color: "#fff", border: "none" }}>Yes, stop</button>
              <button onClick={() => setConfirmingEnd(null)} style={quietButton}>Keep</button>
            </div>
          )}
        </Card>
      ))}
      <button onClick={() => setForm({})} style={{ ...primaryButton, display: "inline-flex", alignItems: "center", gap: 6, marginBottom: 14 }}><Plus size={15} /> Add another plan</button>
    </>
  )
}

/* ---------------- the card on the Today page ---------------- */

export function ExercisesToday({ exercises, log, onOpen, offShift }) {
  if (!exercises || exercises.length === 0) return null
  const today = todaySummary(exercises, log, new Date())
  if (today.total === 0) return null
  // Everything recorded and nothing worth a second look (no skip or partial): shrink to one line that opens the exercises.
  if (today.recorded === today.total && today.open.length === 0 && (today.concerns || []).length === 0) {
    return <DoneRow icon={Dumbbell} title="Today's exercises" status={`${today.recorded} of ${today.total} recorded`} onClick={onOpen} />
  }
  return (
    <Card>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 4 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 700, color: colors.ink }}>
          <Dumbbell size={16} color={colors.sageDeep} /> Today's exercises
        </span>
        <span style={{ fontSize: 13, fontWeight: 700, color: today.recorded === today.total ? colors.sageDeep : colors.inkSoft }}>{today.recorded} of {today.total} recorded</span>
      </div>
      <div style={{ height: 8, background: colors.sageTint, borderRadius: 999, margin: "6px 0 10px", overflow: "hidden" }}>
        <div style={{ width: `${(today.recorded / today.total) * 100}%`, height: "100%", background: colors.sage, borderRadius: 999, transition: "width 0.3s ease" }} />
      </div>
      {today.open.length > 0 && (
        <p style={{ fontSize: 13, color: today.overdue.length ? colors.rust : colors.inkSoft, margin: "0 0 10px", lineHeight: 1.5 }}>
          Still to do: {today.open.map((r) => `${r.exercise.name} (${SLOT_LABEL[r.slot]})`).join(", ")}.
        </p>
      )}
      <button onClick={onOpen} style={quietButton}>{offShift ? "See today's exercises" : "Open exercises"}</button>
    </Card>
  )
}
