import { useState, useEffect, useCallback } from "react"
import { Plus, ChevronLeft, FileText, Award, Trash2, X, Check } from "lucide-react"
import { supabase } from "../supabaseClient.js"
import { Avatar } from "../Avatar.jsx"
import { colors, Card, inputStyle, smallButton, primaryButton, dangerButton, nameOf } from "../manage/ui.jsx"
import { ACCEPT, checkFile, safeName, uploadFile, openFile } from "./files.js"
import { dueText, isOverdue, isScheduled, niceDate, METHOD_LABEL, REPEAT_LABEL } from "./shared.js"
import { printCertificate } from "./certificate.js"

const AMBER = "#6B4D0E"
const pill = (bg, fg) => ({ display: "inline-block", fontSize: 12.5, fontWeight: 700, borderRadius: 999, padding: "2px 10px", background: bg, color: fg, whiteSpace: "nowrap" })
const labelStyle = { fontSize: 13, fontWeight: 600, color: colors.inkSoft, display: "block", marginBottom: 5 }
const sectionLabel = { fontSize: 12.5, fontWeight: 700, letterSpacing: 0.5, color: colors.inkFaint, textTransform: "uppercase", margin: "14px 2px 7px" }

// Where one carer stands on one training: waiting to be checked, still to do, or done.
function standing(assignments, trainingId, uid) {
  const mine = assignments.filter((a) => a.training_id === trainingId && a.user_id === uid)
  const open = mine.find((a) => a.status !== "completed")
  const lastDone = mine.filter((a) => a.status === "completed").sort((x, y) => new Date(y.completed_at) - new Date(x.completed_at))[0]
  if (open && open.status === "submitted") return { kind: "review", a: open, lastDone }
  if (open && !isScheduled(open, assignments)) return { kind: "todo", a: open, lastDone }
  if (lastDone) return { kind: "done", a: lastDone, next: open, lastDone }
  return { kind: "todo", a: open, lastDone }
}

// Manage > Training: set a training for particular carers or all of them, see who has done it, check what was sent back
// and issue certificates.
export default function TrainingAdmin({ userId, accounts, onChanged }) {
  const [data, setData] = useState({ trainings: [], assignments: [], certs: [], loaded: false })
  const [view, setView] = useState("list") // list | new | a training id
  const [showArchived, setShowArchived] = useState(false)

  const reload = useCallback(async () => {
    const [t, a, c] = await Promise.all([
      supabase.from("trainings").select("*").order("created_at", { ascending: false }),
      supabase.from("training_assignments").select("*"),
      supabase.from("training_certificates").select("*"),
    ])
    setData({ trainings: t.data || [], assignments: a.data || [], certs: c.data || [], loaded: true })
    if (onChanged) onChanged()
  }, [onChanged])
  useEffect(() => { reload() }, [reload])

  const carers = accounts.filter((a) => a.role === "caregiver" && a.approved && !a.suspended)
  const byId = Object.fromEntries(accounts.map((a) => [a.user_id, a]))

  if (view === "new") {
    return <NewTraining carers={carers} onCancel={() => setView("list")} onCreated={async (id) => { await reload(); setView(id) }} />
  }
  const current = data.trainings.find((t) => t.id === view)
  if (current) {
    return <TrainingDetail t={current} data={data} byId={byId} onBack={() => setView("list")} reload={reload} />
  }

  const active = data.trainings.filter((t) => !t.archived_at)
  const archived = data.trainings.filter((t) => t.archived_at)

  const summary = (t) => {
    const uids = [...new Set(data.assignments.filter((a) => a.training_id === t.id).map((a) => a.user_id))]
    const rows = uids.map((u) => standing(data.assignments, t.id, u))
    return {
      total: uids.length,
      done: rows.filter((r) => r.kind === "done").length,
      review: rows.filter((r) => r.kind === "review").length,
      overdue: rows.filter((r) => r.kind === "todo" && r.a && isOverdue(r.a.due_date)).length,
    }
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 10 }}>
        <div style={{ fontSize: 13.5, color: colors.inkSoft }}>{active.length} {active.length === 1 ? "training" : "trainings"}</div>
        <button onClick={() => setView("new")} style={{ ...primaryButton, padding: "9px 14px", fontSize: 14 }}><Plus size={15} /> New training</button>
      </div>
      {!data.loaded && <p style={{ fontSize: 14, color: colors.inkFaint }}>Loading...</p>}
      {data.loaded && active.length === 0 && (
        <Card style={{ textAlign: "center", padding: 24 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: colors.ink, marginBottom: 6 }}>No trainings yet</div>
          <div style={{ fontSize: 13.5, color: colors.inkSoft, lineHeight: 1.5 }}>Set a training for one carer or all carers. They can read a document, answer a quiz in the app, or you can mark it done in person. You then issue a certificate.</div>
        </Card>
      )}
      {active.map((t) => {
        const s = summary(t)
        return (
          <button key={t.id} onClick={() => setView(t.id)} style={{ display: "block", width: "100%", textAlign: "left", font: "inherit", cursor: "pointer", border: "none", background: "#fff", borderRadius: 16, padding: "13px 14px", marginBottom: 9, boxShadow: "0 1px 3px rgba(32,38,31,0.06)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: colors.ink }}>{t.title}</div>
              <div style={{ display: "flex", gap: 6, flexShrink: 0, flexWrap: "wrap", justifyContent: "flex-end" }}>
                {s.review > 0 && <span style={pill(colors.goldTint, AMBER)}>{s.review} to check</span>}
                {s.overdue > 0 && <span style={pill(colors.rustTint, "#7A2E1E")}>{s.overdue} overdue</span>}
                {s.total > 0 && s.done === s.total && <span style={pill(colors.sageTint, colors.sageDeep)}>All done</span>}
              </div>
            </div>
            <div style={{ fontSize: 13, color: colors.inkSoft, marginTop: 2 }}>
              {METHOD_LABEL[t.method]}{t.due_date ? ` · due ${niceDate(t.due_date)}` : ""}{t.repeat_months ? ` · repeats ${REPEAT_LABEL(t.repeat_months)}` : ""}
            </div>
            <div style={{ height: 7, background: "#E7E3D6", borderRadius: 999, margin: "9px 0 4px", overflow: "hidden" }}><div style={{ width: `${s.total ? (s.done / s.total) * 100 : 0}%`, height: "100%", background: colors.sage }} /></div>
            <div style={{ fontSize: 12.5, color: colors.inkSoft }}>{s.done} of {s.total} done</div>
          </button>
        )
      })}
      {archived.length > 0 && (
        <>
          <button onClick={() => setShowArchived((v) => !v)} style={{ border: "none", background: "none", cursor: "pointer", fontSize: 13.5, fontWeight: 700, color: colors.inkSoft, padding: "8px 2px" }}>{showArchived ? "Hide" : "Show"} {archived.length} archived</button>
          {showArchived && archived.map((t) => (
            <button key={t.id} onClick={() => setView(t.id)} style={{ display: "block", width: "100%", textAlign: "left", font: "inherit", cursor: "pointer", border: "none", background: "#fff", borderRadius: 14, padding: "10px 14px", marginBottom: 8, opacity: 0.75 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: colors.ink }}>{t.title}</div>
              <div style={{ fontSize: 12.5, color: colors.inkSoft }}>Archived {niceDate(t.archived_at)}</div>
            </button>
          ))}
        </>
      )}
    </div>
  )
}

const blankQuestion = () => ({ kind: "choice", prompt: "", options: ["", ""], correct: 0 })

function NewTraining({ carers, onCancel, onCreated }) {
  const [f, setF] = useState({ title: "", notes: "", method: "upload", due: "", repeat: "0", pass: "80", who: "all", users: [] })
  const [questions, setQuestions] = useState([blankQuestion()])
  const [doc, setDoc] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }))
  const setQ = (i, patch) => setQuestions((qs) => qs.map((q, j) => (j === i ? { ...q, ...patch } : q)))

  const chip = (on) => ({ border: `1.5px solid ${on ? colors.sage : colors.hairline}`, background: on ? colors.sageTint : "#fff", color: on ? colors.sageDeep : colors.inkSoft, borderRadius: 999, padding: "8px 14px", fontSize: 14, fontWeight: 700, cursor: "pointer" })

  async function create() {
    setError(null)
    if (!f.title.trim()) return setError("Give the training a name.")
    if (f.method === "upload" && !doc) return setError("Add the document the carers should fill in.")
    if (doc) { const p = checkFile(doc); if (p) return setError(p) }
    if (f.who === "some" && f.users.length === 0) return setError("Choose at least one carer.")
    let payload = null
    if (f.method === "quiz") {
      payload = []
      for (let i = 0; i < questions.length; i++) {
        const q = questions[i]
        const options = q.kind === "truefalse" ? ["True", "False"] : q.options.map((o) => o.trim())
        if (!q.prompt.trim()) return setError(`Question ${i + 1} needs its text.`)
        if (options.some((o) => !o)) return setError(`Fill in every answer for question ${i + 1}, or remove the empty ones.`)
        payload.push({ prompt: q.prompt.trim(), options, correct: q.correct })
      }
    }
    setBusy(true)
    const id = crypto.randomUUID()
    let docPath = null
    if (doc) {
      docPath = `docs/${id}/${Date.now()}-${safeName(doc.name)}`
      const upErr = await uploadFile(docPath, doc)
      if (upErr) { setBusy(false); return setError("The document could not be uploaded. Check your connection and try again.") }
    }
    const { error: err } = await supabase.rpc("create_training", {
      p_id: id, p_title: f.title.trim(), p_notes: f.notes.trim() || null, p_method: f.method, p_due: f.due || null,
      p_repeat: Number(f.repeat) || null, p_pass: Number(f.pass) || 80, p_doc_path: docPath, p_doc_name: doc ? doc.name : null,
      p_questions: payload, p_users: f.who === "all" ? null : f.users,
    })
    setBusy(false)
    if (err) return setError(err.message || "The training could not be created.")
    await onCreated(id)
  }

  return (
    <div>
      <button onClick={onCancel} style={{ display: "inline-flex", alignItems: "center", gap: 3, border: "none", background: "none", cursor: "pointer", color: colors.inkSoft, fontSize: 14, fontWeight: 600, padding: "0 0 8px" }}><ChevronLeft size={18} /> Training</button>
      <h2 style={{ fontFamily: "Fraunces, serif", fontSize: 22, fontWeight: 600, color: colors.ink, margin: "0 0 10px" }}>New training</h2>
      <Card>
        <label style={labelStyle}>Name</label>
        <input value={f.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. HIPAA: maintaining confidentiality" style={inputStyle} maxLength={200} />
        <label style={{ ...labelStyle, marginTop: 12 }}>Notes (optional)</label>
        <textarea value={f.notes} onChange={(e) => set("notes", e.target.value)} rows={2} maxLength={2000} placeholder="What the carer should know or do" style={{ ...inputStyle, resize: "vertical" }} />

        <div style={sectionLabel}>How do they finish it?</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {[["upload", "Upload a completed copy"], ["quiz", "Quiz in the app"], ["in_person", "In person"]].map(([k, l]) => (
            <button key={k} type="button" onClick={() => set("method", k)} aria-pressed={f.method === k} style={chip(f.method === k)}>{l}</button>
          ))}
        </div>
        <div style={{ fontSize: 13, color: colors.inkSoft, marginTop: 8, lineHeight: 1.45 }}>
          {f.method === "upload" && "Carers read your document, fill it in, and send back the completed file or a photo. You check it by hand."}
          {f.method === "quiz" && "Carers answer your questions on their phone and the app scores them. You can also attach a document to read first."}
          {f.method === "in_person" && "Nothing to send back. You mark each carer done after the training, and issue their certificate."}
        </div>

        <div style={sectionLabel}>{f.method === "upload" ? "Document" : "Document (optional)"}</div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, border: `1.5px dashed ${colors.hairline}`, borderRadius: 12, padding: "11px 13px", cursor: "pointer", fontSize: 14, color: colors.inkSoft, background: "#fff" }}>
          <FileText size={17} color={colors.sage} />
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{doc ? doc.name : "Choose a Word or PDF file"}</span>
          {doc && <button type="button" onClick={(e) => { e.preventDefault(); setDoc(null) }} aria-label="Remove the document" style={{ border: "none", background: "none", cursor: "pointer", color: colors.inkSoft, display: "flex" }}><X size={16} /></button>}
          <input type="file" accept={ACCEPT} onChange={(e) => setDoc(e.target.files?.[0] || null)} style={{ display: "none" }} />
        </label>

        {f.method === "quiz" && (
          <>
            <div style={sectionLabel}>Questions</div>
            {questions.map((q, i) => (
              <div key={i} style={{ border: `1px solid ${colors.hairline}`, borderRadius: 14, padding: 12, marginBottom: 10, background: colors.bg }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: colors.inkSoft }}>Question {i + 1}</div>
                  <select value={q.kind} onChange={(e) => setQ(i, e.target.value === "truefalse" ? { kind: "truefalse", options: ["True", "False"], correct: 0 } : { kind: "choice", options: ["", ""], correct: 0 })} style={{ ...inputStyle, width: "auto", padding: "5px 8px", fontSize: 13, marginLeft: "auto" }} aria-label={`Question ${i + 1} type`}>
                    <option value="choice">Multiple choice</option>
                    <option value="truefalse">True or false</option>
                  </select>
                  {questions.length > 1 && <button type="button" onClick={() => setQuestions((qs) => qs.filter((_, j) => j !== i))} aria-label={`Remove question ${i + 1}`} style={{ border: "none", background: "none", cursor: "pointer", color: colors.rust, display: "flex" }}><Trash2 size={16} /></button>}
                </div>
                <textarea value={q.prompt} onChange={(e) => setQ(i, { prompt: e.target.value })} rows={2} maxLength={600} placeholder="The question" style={{ ...inputStyle, resize: "vertical", marginBottom: 8 }} />
                {(q.kind === "truefalse" ? ["True", "False"] : q.options).map((o, k) => (
                  <div key={k} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <input type="radio" name={`correct${i}`} checked={q.correct === k} onChange={() => setQ(i, { correct: k })} aria-label={`Answer ${k + 1} is correct`} style={{ width: 18, height: 18, flexShrink: 0 }} />
                    {q.kind === "truefalse"
                      ? <span style={{ fontSize: 14, color: colors.ink }}>{o}</span>
                      : <input value={o} onChange={(e) => setQ(i, { options: q.options.map((x, j) => (j === k ? e.target.value : x)) })} placeholder={`Answer ${k + 1}`} maxLength={200} style={{ ...inputStyle, padding: "8px 10px" }} />}
                    {q.kind === "choice" && q.options.length > 2 && <button type="button" onClick={() => setQ(i, { options: q.options.filter((_, j) => j !== k), correct: q.correct === k ? 0 : q.correct > k ? q.correct - 1 : q.correct })} aria-label={`Remove answer ${k + 1}`} style={{ border: "none", background: "none", cursor: "pointer", color: colors.inkSoft, display: "flex" }}><X size={15} /></button>}
                  </div>
                ))}
                <div style={{ fontSize: 12.5, color: colors.inkFaint, margin: "2px 0 0" }}>Tick the circle beside the correct answer.</div>
                {q.kind === "choice" && q.options.length < 6 && <button type="button" onClick={() => setQ(i, { options: [...q.options, ""] })} style={{ ...smallButton, marginTop: 8 }}><Plus size={13} /> Add an answer</button>}
              </div>
            ))}
            <button type="button" onClick={() => setQuestions((qs) => [...qs, blankQuestion()])} style={smallButton}><Plus size={14} /> Add a question</button>
            <label style={{ ...labelStyle, marginTop: 12 }}>Pass mark (%)</label>
            <input type="number" min={1} max={100} value={f.pass} onChange={(e) => set("pass", e.target.value)} style={{ ...inputStyle, width: 110 }} />
          </>
        )}

        <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 150px" }}>
            <label style={labelStyle}>Due date (optional)</label>
            <input type="date" value={f.due} onChange={(e) => set("due", e.target.value)} style={inputStyle} />
          </div>
          <div style={{ flex: "1 1 150px" }}>
            <label style={labelStyle}>Repeats</label>
            <select value={f.repeat} onChange={(e) => set("repeat", e.target.value)} style={inputStyle}>
              <option value="0">Does not repeat</option>
              <option value="12">Every year</option>
              <option value="6">Every 6 months</option>
            </select>
          </div>
        </div>

        <div style={sectionLabel}>Who is it for?</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" onClick={() => set("who", "all")} aria-pressed={f.who === "all"} style={chip(f.who === "all")}>All carers ({carers.length})</button>
          <button type="button" onClick={() => set("who", "some")} aria-pressed={f.who === "some"} style={chip(f.who === "some")}>Choose carers</button>
        </div>
        {f.who === "some" && (
          <div style={{ marginTop: 10 }}>
            {carers.map((c) => (
              <label key={c.user_id} style={{ display: "flex", alignItems: "center", gap: 9, padding: "5px 0", fontSize: 14.5, cursor: "pointer", color: colors.ink }}>
                <input type="checkbox" checked={f.users.includes(c.user_id)} onChange={(e) => set("users", e.target.checked ? [...f.users, c.user_id] : f.users.filter((u) => u !== c.user_id))} style={{ width: 17, height: 17 }} />
                {nameOf(c)}
              </label>
            ))}
            {carers.length === 0 && <div style={{ fontSize: 13.5, color: colors.inkSoft }}>There are no active carers yet.</div>}
          </div>
        )}
        <div style={{ background: colors.tealTint, color: "#2F5A62", borderRadius: 12, padding: "9px 12px", fontSize: 13, lineHeight: 1.45, marginTop: 12 }}>
          Only caregivers can be chosen. Family members and health proxies are never included. Each carer gets a message that a training was set for them.
        </div>
        {error && <p style={{ color: colors.rust, fontSize: 13.5, margin: "12px 0 0", lineHeight: 1.4 }}>{error}</p>}
        <button onClick={create} disabled={busy} style={{ ...primaryButton, width: "100%", justifyContent: "center", marginTop: 14, padding: "13px 0", fontSize: 15, opacity: busy ? 0.6 : 1 }}>{busy ? "Creating..." : "Create and send"}</button>
      </Card>
    </div>
  )
}

function TrainingDetail({ t, data, byId, onBack, reload }) {
  const [openRow, setOpenRow] = useState(null) // a user id whose review / confirm panel is open
  const [message, setMessage] = useState(null)
  const [busy, setBusy] = useState(false)
  const [docError, setDocError] = useState(false)

  const uids = [...new Set(data.assignments.filter((a) => a.training_id === t.id).map((a) => a.user_id))]
  const rows = uids.map((u) => ({ uid: u, ...standing(data.assignments, t.id, u) }))
    .sort((x, y) => ({ review: 0, todo: 1, done: 2 }[x.kind] - { review: 0, todo: 1, done: 2 }[y.kind]) || nameOf(byId[x.uid] || {}).localeCompare(nameOf(byId[y.uid] || {})))
  const done = rows.filter((r) => r.kind === "done").length

  async function act(fn, ok) {
    setBusy(true); setMessage(null)
    const { error } = await fn()
    setBusy(false)
    if (error) { setMessage({ type: "error", text: error.message || "That did not work. Please try again." }); return false }
    setMessage({ type: "ok", text: ok })
    await reload()
    return true
  }

  return (
    <div>
      <button onClick={onBack} style={{ display: "inline-flex", alignItems: "center", gap: 3, border: "none", background: "none", cursor: "pointer", color: colors.inkSoft, fontSize: 14, fontWeight: 600, padding: "0 0 8px" }}><ChevronLeft size={18} /> Training</button>
      <h2 style={{ fontFamily: "Fraunces, serif", fontSize: 22, fontWeight: 600, color: colors.ink, margin: "0 0 4px" }}>{t.title}</h2>
      <div style={{ fontSize: 13, color: colors.inkSoft, marginBottom: 10, lineHeight: 1.5 }}>
        {METHOD_LABEL[t.method]}{t.due_date ? ` · due ${niceDate(t.due_date)}` : ""}{t.repeat_months ? ` · repeats ${REPEAT_LABEL(t.repeat_months)}` : ""} · {done} of {rows.length} done
        {t.archived_at ? " · archived" : ""}
      </div>
      {t.notes && <div style={{ fontSize: 13.5, color: colors.ink, marginBottom: 10, whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{t.notes}</div>}
      {t.doc_path && (
        <button onClick={async () => { setDocError(false); if (!(await openFile(t.doc_path, t.doc_name))) setDocError(true) }} style={{ ...smallButton, marginBottom: 10 }}><FileText size={14} /> {t.doc_name || "Training document"}</button>
      )}
      {docError && <div style={{ fontSize: 13, color: colors.rust, marginBottom: 8 }}>The document could not be opened.</div>}
      {message && <div style={{ fontSize: 13.5, fontWeight: 600, color: message.type === "ok" ? colors.sageDeep : colors.rust, margin: "4px 0 10px" }}>{message.text}</div>}

      <Card style={{ padding: "6px 14px" }}>
        {rows.map((r, i) => {
          const acct = byId[r.uid] || {}
          const name = nameOf(acct) || "Former carer"
          const cert = r.kind === "done" ? data.certs.find((c) => c.assignment_id === r.lastDone?.id) : null
          const shown = openRow === r.uid
          return (
            <div key={r.uid} style={{ borderTop: i ? `1px solid ${colors.hairline}` : "none", padding: "10px 0" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Avatar userId={r.uid} name={name} size={36} fontSize={13} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 14.5, fontWeight: 700, color: colors.ink }}>{name}</div>
                  <div style={{ fontSize: 13, color: r.kind === "todo" && isOverdue(r.a?.due_date) ? colors.rust : colors.inkSoft, fontWeight: r.kind === "todo" && isOverdue(r.a?.due_date) ? 700 : 400 }}>
                    {r.kind === "done" ? `Done ${niceDate(r.a.completed_at)}${r.next ? `, renews ${niceDate(r.next.due_date)}` : ""}`
                      : r.kind === "review" ? `Sent ${niceDate(r.a.submitted_at)}`
                      : r.a ? dueText(r.a.due_date) : "Not set"}
                    {r.kind === "todo" && r.a?.last_score != null && !r.a.returned_note ? ` · retaking, last try ${r.a.last_score}% (${r.a.attempts} ${r.a.attempts === 1 ? "try" : "tries"})` : r.kind === "todo" && r.a?.attempts > 0 ? " · sent back" : ""}
                  </div>
                </div>
                {r.kind === "done" && <span style={pill(colors.sageTint, colors.sageDeep)}>Done</span>}
                {r.kind === "review" && <button onClick={() => setOpenRow(shown ? null : r.uid)} style={{ ...primaryButton, background: colors.gold, padding: "6px 12px" }}>{shown ? "Close" : "Check"}</button>}
              </div>
              {r.kind === "todo" && r.a && !t.archived_at && (
                <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                  {t.method === "in_person" && <button onClick={() => setOpenRow(shown ? null : r.uid)} style={smallButton}><Check size={13} /> Mark done</button>}
                  <button disabled={busy} onClick={() => act(() => supabase.rpc("remind_training", { p_assignment: r.a.id }), `A reminder was sent to ${name}.`)} style={smallButton}>Remind</button>
                </div>
              )}
              {cert && <div style={{ marginTop: 8 }}><button onClick={() => { if (!printCertificate(cert)) setMessage({ type: "error", text: "Your browser blocked the print window. Allow pop-ups and try again." }) }} style={smallButton}><Award size={13} /> Certificate {cert.number}</button></div>}
              {shown && r.kind === "review" && <ReviewPanel t={t} a={r.a} name={name} busy={busy} act={act} close={() => setOpenRow(null)} />}
              {shown && r.kind === "todo" && t.method === "in_person" && (
                <div style={{ background: colors.bg, borderRadius: 12, padding: 12, marginTop: 8, fontSize: 13.5, color: colors.ink, lineHeight: 1.5 }}>
                  Mark <strong>{name}</strong> done and issue their certificate?
                  <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                    <button disabled={busy} onClick={async () => { if (await act(() => supabase.rpc("issue_training_certificate", { p_assignment: r.a.id }), `${name} is done. Their certificate was issued.`)) setOpenRow(null) }} style={{ ...primaryButton, opacity: busy ? 0.6 : 1 }}>Yes, issue certificate</button>
                    <button onClick={() => setOpenRow(null)} style={smallButton}>Cancel</button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
        {rows.length === 0 && <div style={{ padding: "12px 0", fontSize: 14, color: colors.inkSoft }}>Nobody is on this training.</div>}
      </Card>

      {!t.archived_at && (
        <button disabled={busy} onClick={() => { if (window.confirm("Archive this training? Open work is hidden from carers. Certificates already issued are kept.")) act(() => supabase.rpc("archive_training", { p_training: t.id }), "The training was archived.") }} style={{ ...smallButton, color: colors.rust, marginTop: 4 }}><Trash2 size={13} /> Archive this training</button>
      )}
    </div>
  )
}

// What a carer sent back: their completed file, or their quiz answers with the correct ones. The administrator then issues the
// certificate or sends it back.
function ReviewPanel({ t, a, name, busy, act, close }) {
  const [qs, setQs] = useState(null)
  const [keys, setKeys] = useState({})
  const [note, setNote] = useState("")
  const [back, setBack] = useState(false)
  const [fileError, setFileError] = useState(false)
  const [tries, setTries] = useState([])

  useEffect(() => {
    if (t.method !== "quiz") return
    supabase.from("training_attempts").select("attempt_no, score").eq("assignment_id", a.id).order("attempt_no").then(({ data }) => setTries(data || []))
  }, [a.id, t.method])

  useEffect(() => {
    if (t.method !== "quiz") return
    let cancelled = false
    ;(async () => {
      const { data: q } = await supabase.from("training_questions").select("id, position, prompt, options").eq("training_id", t.id).order("position")
      const ids = (q || []).map((x) => x.id)
      const { data: k } = ids.length ? await supabase.from("training_answer_key").select("question_id, correct").in("question_id", ids) : { data: [] }
      if (cancelled) return
      setQs(q || [])
      setKeys(Object.fromEntries((k || []).map((x) => [x.question_id, x.correct])))
    })()
    return () => { cancelled = true }
  }, [t.id, t.method])

  const passed = t.method !== "quiz" || (a.score ?? 0) >= t.pass_mark
  return (
    <div style={{ background: colors.bg, borderRadius: 12, padding: 12, marginTop: 8 }}>
      <div style={{ fontSize: 13, color: colors.inkSoft, lineHeight: 1.5, marginBottom: 8 }}>
        Signed by <strong style={{ color: colors.ink }}>{a.signed_name}</strong> on {niceDate(a.submitted_at)}.
      </div>
      {t.method === "upload" && a.submission_path && (
        <>
          <button onClick={async () => { setFileError(false); if (!(await openFile(a.submission_path, a.submission_name))) setFileError(true) }} style={smallButton}><FileText size={13} /> {a.submission_name || "Completed copy"}</button>
          {fileError && <div style={{ fontSize: 13, color: colors.rust, marginTop: 6 }}>The file could not be opened.</div>}
        </>
      )}
      {t.method === "quiz" && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <div style={{ fontFamily: "Georgia, serif", fontSize: 28, fontWeight: 700, color: passed ? colors.sageDeep : colors.rust }}>{a.score}%</div>
            <div style={{ fontSize: 13.5, color: colors.inkSoft }}>{passed ? "Passed" : "Below the pass mark"} (pass mark {t.pass_mark}%)</div>
          </div>
          {tries.length > 1 && <div style={{ fontSize: 13, color: colors.inkSoft, marginBottom: 8 }}>Tries so far: {tries.map((x, i) => `${i + 1}: ${x.score}%`).join(", ")}. {name.split(" ")[0]} saw each mark straight away.</div>}
          {!qs && <div style={{ fontSize: 13, color: colors.inkFaint }}>Loading the answers...</div>}
          {qs && qs.map((q, i) => {
            const chosen = a.answers?.[i]
            const right = keys[q.id]
            const ok = chosen === right
            return (
              <div key={q.id} style={{ background: ok ? colors.sageTint : colors.rustTint, border: `1px solid ${ok ? colors.sage : colors.rust}`, borderRadius: 11, padding: "8px 10px", marginBottom: 6 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: colors.ink }}>{i + 1}. {q.prompt}</div>
                <div style={{ fontSize: 13, color: colors.inkSoft }}>{name.split(" ")[0]}: {q.options[chosen] ?? "no answer"} {ok ? "✓" : "✗"}{!ok && right != null ? ` · correct: ${q.options[right]}` : ""}</div>
              </div>
            )
          })}
        </>
      )}
      {back ? (
        <div style={{ marginTop: 10 }}>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} placeholder="What should they look at again? (optional)" style={{ ...inputStyle, resize: "vertical" }} />
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button disabled={busy} onClick={async () => { if (await act(() => supabase.rpc("return_training", { p_assignment: a.id, p_note: note }), `It was sent back to ${name}.`)) close() }} style={{ ...dangerButton, opacity: busy ? 0.6 : 1 }}>Send back</button>
            <button onClick={() => setBack(false)} style={smallButton}>Cancel</button>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          <button disabled={busy || !passed} onClick={async () => { if (await act(() => supabase.rpc("issue_training_certificate", { p_assignment: a.id }), `${name}'s certificate was issued.`)) close() }} style={{ ...primaryButton, opacity: busy || !passed ? 0.5 : 1 }}><Award size={14} /> Issue certificate</button>
          <button disabled={busy} onClick={() => setBack(true)} style={smallButton}>Send back to retake</button>
        </div>
      )}
      {!passed && <div style={{ fontSize: 12.5, color: colors.inkFaint, marginTop: 8 }}>A quiz below the pass mark can't get a certificate. Send it back for another try.</div>}
    </div>
  )
}
