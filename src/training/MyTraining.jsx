import { useState, useEffect, useCallback } from "react"
import { GraduationCap, FileText, Award, ChevronLeft, ChevronRight, Check, Upload, Camera } from "lucide-react"
import { supabase } from "../supabaseClient.js"
import { Card, colors } from "../care/ui.jsx"
import { ACCEPT, checkFile, safeName, uploadFile, openFile } from "./files.js"
import { dueText, isOverdue, isScheduled, niceDate, METHOD_LABEL } from "./shared.js"
import { printCertificate } from "./certificate.js"

const AMBER = "#6B4D0E"

// A carer's own training: what is waiting, what has been sent back, and their certificates. Only their own rows are ever
// readable (the database enforces it), so this never shows another carer's training.
export function useMyTraining(userId, enabled) {
  const [data, setData] = useState({ assignments: [], trainings: {}, certs: [], loaded: false })
  const reload = useCallback(async () => {
    if (!enabled) return
    const [a, t, c] = await Promise.all([
      supabase.from("training_assignments").select("*").eq("user_id", userId).order("created_at", { ascending: false }),
      supabase.from("trainings").select("*"),
      supabase.from("training_certificates").select("*").eq("user_id", userId).order("issued_on", { ascending: false }),
    ])
    const trainings = {}
    ;(t.data || []).forEach((x) => { trainings[x.id] = x })
    setData({ assignments: a.data || [], trainings, certs: c.data || [], loaded: true })
  }, [userId, enabled])
  useEffect(() => { reload() }, [reload])
  const todo = data.assignments.filter((a) => a.status !== "completed" && data.trainings[a.training_id] && !data.trainings[a.training_id].archived_at && !isScheduled(a, data.assignments))
  return { ...data, todo, reload }
}

// A quiz mark is shown the moment it is scored: nobody waits for the administrator to see how they did.
const isQuiz = (a, t) => t?.method === "quiz" && a.score != null
function StatusPill({ a, t }) {
  if (a.status === "submitted" && isQuiz(a, t)) {
    return a.score >= t.pass_mark
      ? <span style={pill(colors.sageTint, colors.sageDeep)}>Passed {a.score}%. Waiting for your certificate</span>
      : <span style={pill(colors.rustTint, "#7A2E1E")}>Mark {a.score}%, below the pass mark</span>
  }
  if (a.status === "assigned" && t?.method === "quiz" && a.last_score != null && !a.returned_note) {
    return <span style={pill(colors.rustTint, "#7A2E1E")}>Last try {a.last_score}%. Try again</span>
  }
  if (a.status === "submitted") return <span style={pill(colors.goldTint, AMBER)}>Sent, waiting to be checked</span>
  if (isOverdue(a.due_date)) return <span style={pill(colors.rustTint, "#7A2E1E")}>{dueText(a.due_date)}</span>
  return <span style={pill(colors.sageTint, colors.sageDeep)}>{dueText(a.due_date)}</span>
}
const pill = (bg, fg) => ({ display: "inline-block", fontSize: 12.5, fontWeight: 700, borderRadius: 999, padding: "2px 10px", background: bg, color: fg })

// On the carer's Home: only what is waiting for them.
export function TrainingHomeCard({ training, onOpen }) {
  const { todo, trainings } = training
  if (!todo.length) return null
  return (
    <div style={{ marginBottom: 14 }}>
      {todo.map((a) => {
        const t = trainings[a.training_id]
        return (
          <button key={a.id} onClick={() => onOpen(a.id)} style={{ display: "block", width: "100%", textAlign: "left", font: "inherit", cursor: "pointer", border: "none", background: colors.goldTint, borderRadius: 16, padding: "12px 14px", marginBottom: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, fontWeight: 700, letterSpacing: 0.5, color: AMBER }}><GraduationCap size={14} /> TRAINING</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: colors.ink, marginTop: 3 }}>{t.title}</div>
            <div style={{ marginTop: 5, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <StatusPill a={a} t={t} />
              <span style={{ display: "inline-flex", alignItems: "center", gap: 2, fontSize: 13, fontWeight: 700, color: colors.sageDeep }}>{a.status === "submitted" ? "View" : "Open"} <ChevronRight size={15} /></span>
            </div>
            {a.returned_note && a.status === "assigned" && <div style={{ fontSize: 13, color: "#7A2E1E", marginTop: 6 }}>Sent back: {a.returned_note}</div>}
          </button>
        )
      })}
    </div>
  )
}

// On Profile: a way in to training and certificates.
export function TrainingProfileCard({ training, onOpen }) {
  const open = training.todo.length
  return (
    <Card style={{ padding: 20, marginBottom: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: colors.inkFaint, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 8 }}>Training</div>
      <div style={{ fontSize: 14, color: colors.inkSoft, lineHeight: 1.5, marginBottom: 12 }}>
        {open ? `${open} ${open === 1 ? "training is" : "trainings are"} waiting for you. ` : "Nothing is waiting for you. "}
        {training.certs.length ? `You have ${training.certs.length} ${training.certs.length === 1 ? "certificate" : "certificates"}.` : "Your certificates will appear here."}
      </div>
      <button onClick={() => onOpen(null)} style={{ display: "inline-flex", alignItems: "center", gap: 7, border: `1px solid ${colors.hairline}`, background: "#fff", borderRadius: 10, padding: "9px 14px", fontSize: 14, fontWeight: 700, color: colors.sageDeep, cursor: "pointer" }}>
        <Award size={15} /> Training and certificates
      </button>
    </Card>
  )
}

export default function MyTrainingView({ userId, member, training, initialId, onBack }) {
  const [openId, setOpenId] = useState(initialId || null)
  const open = training.assignments.find((a) => a.id === openId)

  if (open && training.trainings[open.training_id]) {
    return <TrainingTask a={open} t={training.trainings[open.training_id]} userId={userId} member={member} onBack={() => setOpenId(null)} onChanged={training.reload} />
  }

  const done = training.assignments.filter((a) => a.status === "completed").length
  return (
    <div>
      <button onClick={onBack} style={{ display: "inline-flex", alignItems: "center", gap: 3, border: "none", background: "none", cursor: "pointer", color: colors.inkSoft, fontSize: 14, fontWeight: 600, padding: "0 0 8px" }}><ChevronLeft size={18} /> Back</button>
      <h1 style={{ fontFamily: "Fraunces, serif", fontSize: 25, fontWeight: 600, color: colors.ink, margin: "0 0 12px" }}>My training</h1>

      <div style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: 0.5, color: colors.inkFaint, textTransform: "uppercase", margin: "6px 4px 8px" }}>To do</div>
      {training.todo.length === 0 && <p style={{ fontSize: 14, color: colors.inkSoft, margin: "0 4px 10px" }}>Nothing is waiting for you.</p>}
      {training.todo.map((a) => {
        const t = training.trainings[a.training_id]
        return (
          <button key={a.id} onClick={() => setOpenId(a.id)} style={{ display: "block", width: "100%", textAlign: "left", font: "inherit", cursor: "pointer", border: "none", background: "#fff", borderRadius: 16, padding: "12px 14px", marginBottom: 9, boxShadow: "0 1px 3px rgba(32,38,31,0.06)" }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: colors.ink }}>{t.title}</div>
            <div style={{ fontSize: 13, color: colors.inkSoft, margin: "2px 0 6px" }}>{METHOD_LABEL[t.method]}</div>
            <StatusPill a={a} t={t} />
          </button>
        )
      })}

      <div style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: 0.5, color: colors.inkFaint, textTransform: "uppercase", margin: "18px 4px 8px" }}>My certificates</div>
      {training.certs.length === 0 && <p style={{ fontSize: 14, color: colors.inkSoft, margin: "0 4px" }}>{done ? "Your certificates will appear here." : "You have no certificates yet."}</p>}
      {training.certs.map((c) => <CertificateRow key={c.id} c={c} />)}
      <div style={{ display: "flex", gap: 8, alignItems: "flex-start", background: colors.tealTint, color: "#2F5A62", borderRadius: 12, padding: "9px 12px", fontSize: 13, lineHeight: 1.45, marginTop: 14 }}>
        Only you and the administrators can see your training and certificates.
      </div>
    </div>
  )
}

export function CertificateRow({ c }) {
  const [blocked, setBlocked] = useState(false)
  return (
    <div style={{ background: "#fff", borderRadius: 16, padding: "12px 14px", marginBottom: 9, boxShadow: "0 1px 3px rgba(32,38,31,0.06)", display: "flex", alignItems: "center", gap: 12 }}>
      <Award size={22} color={colors.gold} style={{ flexShrink: 0 }} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 14.5, fontWeight: 700, color: colors.ink }}>{c.training_title}</div>
        <div style={{ fontSize: 13, color: colors.inkSoft }}>{c.number} · {niceDate(c.issued_on)}{c.valid_until ? ` · valid until ${niceDate(c.valid_until)}` : ""}</div>
        {blocked && <div style={{ fontSize: 12.5, color: colors.rust }}>Your browser blocked the print window. Allow pop-ups and try again.</div>}
      </div>
      <button onClick={() => setBlocked(!printCertificate(c))} style={{ border: `1px solid ${colors.hairline}`, background: "#fff", borderRadius: 9, padding: "7px 11px", fontSize: 13, fontWeight: 700, color: colors.sageDeep, cursor: "pointer", flexShrink: 0 }}>Print</button>
    </div>
  )
}

function TrainingTask({ a, t, userId, member, onBack, onChanged }) {
  const [fileError, setFileError] = useState(null)
  const myName = [member.first_name, member.last_name].filter(Boolean).join(" ")
  const [name, setName] = useState(myName)
  const [sure, setSure] = useState(false)
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [docError, setDocError] = useState(false)

  async function openDoc() {
    setDocError(false)
    const ok = await openFile(t.doc_path, t.doc_name)
    if (!ok) setDocError(true)
  }

  async function sendUpload() {
    const problem = checkFile(file)
    if (problem) { setFileError(problem); return }
    setBusy(true); setError(null)
    const path = `sub/${userId}/${a.id}/${Date.now()}-${safeName(file.name)}`
    const upErr = await uploadFile(path, file)
    if (upErr) { setBusy(false); setError("The file could not be uploaded. Check your connection and try again."); return }
    const { error: err } = await supabase.rpc("submit_training_upload", { p_assignment: a.id, p_path: path, p_name: file.name, p_signed: name })
    setBusy(false)
    if (err) { setError(err.message || "That could not be sent."); return }
    await onChanged()
  }

  return (
    <div>
      <button onClick={onBack} style={{ display: "inline-flex", alignItems: "center", gap: 3, border: "none", background: "none", cursor: "pointer", color: colors.inkSoft, fontSize: 14, fontWeight: 600, padding: "0 0 8px" }}><ChevronLeft size={18} /> Training</button>
      <h1 style={{ fontFamily: "Fraunces, serif", fontSize: 24, fontWeight: 600, color: colors.ink, margin: "0 0 6px" }}>{t.title}</h1>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 12 }}>
        <StatusPill a={a} t={t} />
        <span style={{ fontSize: 13, color: colors.inkSoft }}>{METHOD_LABEL[t.method]}</span>
      </div>
      {t.notes && <Card style={{ padding: "12px 14px", marginBottom: 12 }}><div style={{ fontSize: 14, color: colors.ink, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{t.notes}</div></Card>}
      {t.doc_path && (
        <Card style={{ padding: "12px 14px", marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <FileText size={22} color={colors.sage} style={{ flexShrink: 0 }} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: colors.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.doc_name || "Training document"}</div>
              <div style={{ fontSize: 12.5, color: colors.inkSoft }}>Read this first</div>
            </div>
            <button onClick={openDoc} style={{ border: "none", background: colors.sage, color: "#fff", borderRadius: 10, padding: "9px 14px", fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}>Open</button>
          </div>
          {docError && <div style={{ fontSize: 13, color: colors.rust, marginTop: 8 }}>The document could not be opened. Please try again.</div>}
        </Card>
      )}

      {a.returned_note && a.status === "assigned" && (
        <div style={{ background: colors.rustTint, borderRadius: 12, padding: "10px 12px", fontSize: 13.5, color: "#7A2E1E", lineHeight: 1.45, marginBottom: 12 }}>
          <strong>Sent back for another try.</strong> {a.returned_note}
        </div>
      )}
      {a.status === "assigned" && a.attempts > 0 && !a.returned_note && a.last_score == null && (
        <div style={{ background: colors.rustTint, borderRadius: 12, padding: "10px 12px", fontSize: 13.5, color: "#7A2E1E", marginBottom: 12 }}><strong>Sent back for another try.</strong></div>
      )}
      {a.status === "assigned" && t.method === "quiz" && a.last_score != null && !a.returned_note && (
        <MarkCard score={a.last_score} passMark={t.pass_mark} passed={false}
          line="Read the notes again, then try the quiz once more. You can try as many times as you need, and nobody has to check it first." />
      )}

      {a.status === "submitted" && isQuiz(a, t) ? (
        <MarkCard score={a.score} passMark={t.pass_mark} passed={a.score >= t.pass_mark}
          line={a.score >= t.pass_mark
            ? `You finished this on ${niceDate(a.submitted_at)}. Your administrator has been told and will issue your certificate.`
            : `Your administrator will send this back so you can try again.`} />
      ) : a.status === "submitted" ? (
        <Card style={{ padding: "14px 16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 15, fontWeight: 700, color: colors.sageDeep }}><Check size={18} /> Sent</div>
          <div style={{ fontSize: 14, color: colors.inkSoft, lineHeight: 1.5, marginTop: 4 }}>
            You sent this back on {niceDate(a.submitted_at)}. Your administrator will check it and issue your certificate.
          </div>
        </Card>
      ) : t.method === "in_person" ? (
        <Card style={{ padding: "14px 16px" }}>
          <div style={{ fontSize: 14, color: colors.inkSoft, lineHeight: 1.5 }}>This training is done in person. Your administrator will mark it done and issue your certificate once you have completed it.</div>
        </Card>
      ) : t.method === "upload" ? (
        <Card style={{ padding: "14px 16px" }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: colors.ink, marginBottom: 4 }}>Send back your completed copy</div>
          <div style={{ fontSize: 13.5, color: colors.inkSoft, lineHeight: 1.5, marginBottom: 10 }}>Fill in the document, then add the completed file or a clear photo of it. Word, PDF or photo, up to 10 MB.</div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, border: `1.5px dashed ${colors.hairline}`, borderRadius: 12, padding: "12px 14px", cursor: "pointer", fontSize: 14, color: colors.inkSoft, background: "#fff" }}>
            <Upload size={17} color={colors.sage} />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{file ? file.name : "Choose a file or photo"}</span>
            <input type="file" accept={ACCEPT} onChange={(e) => { setFile(e.target.files?.[0] || null); setFileError(null) }} style={{ display: "none" }} />
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, border: `1.5px dashed ${colors.hairline}`, borderRadius: 12, padding: "12px 14px", cursor: "pointer", fontSize: 14, color: colors.inkSoft, background: "#fff", marginTop: 8 }}>
            <Camera size={17} color={colors.sage} />
            <span>Take a photo of the page</span>
            <input type="file" accept="image/*" capture="environment" onChange={(e) => { setFile(e.target.files?.[0] || null); setFileError(null) }} style={{ display: "none" }} />
          </label>
          {fileError && <div style={{ fontSize: 13, color: colors.rust, marginTop: 6 }}>{fileError}</div>}
          <Confirm name={name} setName={setName} sure={sure} setSure={setSure} />
          {error && <div style={{ fontSize: 13, color: colors.rust, marginTop: 8 }}>{error}</div>}
          <button onClick={sendUpload} disabled={busy || !file || !sure || !name.trim()} style={sendStyle(busy || !file || !sure || !name.trim())}>{busy ? "Sending..." : "Send to my administrator"}</button>
        </Card>
      ) : (
        <Quiz key={a.attempts} a={a} t={t} userId={userId} name={name} setName={setName} sure={sure} setSure={setSure} onChanged={onChanged} />
      )}
    </div>
  )
}

// The mark, highlighted: green for a pass, red below the pass mark.
function MarkCard({ score, passMark, passed, line }) {
  const fg = passed ? colors.sageDeep : "#7A2E1E"
  return (
    <div role="status" style={{ background: passed ? colors.sageTint : colors.rustTint, border: `2px solid ${passed ? colors.sage : colors.rust}`, borderRadius: 16, padding: "14px 16px", marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <div style={{ fontFamily: "Georgia, serif", fontSize: 40, fontWeight: 700, color: fg, lineHeight: 1 }}>{score}%</div>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: fg }}>{passed ? "Passed" : "Below the pass mark"}</div>
          <div style={{ fontSize: 13, color: colors.inkSoft }}>Pass mark {passMark}%</div>
        </div>
      </div>
      <div style={{ fontSize: 13.5, color: colors.ink, lineHeight: 1.5, marginTop: 8 }}>{line}</div>
    </div>
  )
}

const sendStyle = (off) => ({ width: "100%", marginTop: 12, padding: "13px 0", borderRadius: 12, border: "none", background: colors.sage, color: "#fff", fontSize: 15, fontWeight: 700, cursor: off ? "default" : "pointer", opacity: off ? 0.55 : 1 })

function Confirm({ name, setName, sure, setSure }) {
  return (
    <div style={{ marginTop: 12 }}>
      <label style={{ fontSize: 13, fontWeight: 600, color: colors.inkSoft, display: "block", marginBottom: 5 }}>Type your name to sign</label>
      <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: `1px solid ${colors.hairline}`, fontSize: 15, boxSizing: "border-box" }} />
      <label style={{ display: "flex", alignItems: "flex-start", gap: 9, marginTop: 10, fontSize: 13.5, color: colors.ink, lineHeight: 1.4, cursor: "pointer" }}>
        <input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} style={{ marginTop: 2, width: 17, height: 17 }} />
        I confirm this is my own work.
      </label>
    </div>
  )
}

// The quiz, one question at a time. Answers are kept on this phone as the carer goes, so they can stop and come back.
function Quiz({ a, t, userId, name, setName, sure, setSure, onChanged }) {
  const draftKey = `strovia-quiz-${a.id}-${a.attempts}`
  const [questions, setQuestions] = useState(null)
  const [answers, setAnswers] = useState(() => { try { return JSON.parse(localStorage.getItem(draftKey) || "[]") } catch { return [] } })
  const [step, setStep] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    supabase.from("training_questions").select("id, position, prompt, options").eq("training_id", t.id).order("position").then(({ data }) => setQuestions(data || []))
  }, [t.id])
  useEffect(() => { try { localStorage.setItem(draftKey, JSON.stringify(answers)) } catch { /* drafts are a convenience */ } }, [answers, draftKey])

  if (!questions) return <p style={{ fontSize: 14, color: colors.inkFaint }}>Loading...</p>
  if (!questions.length) return <p style={{ fontSize: 14, color: colors.inkSoft }}>This quiz has no questions yet.</p>
  const total = questions.length
  const review = step >= total
  const q = questions[Math.min(step, total - 1)]
  const answered = questions.every((_, i) => Number.isInteger(answers[i]))

  async function send() {
    setBusy(true); setError(null)
    const { error: err } = await supabase.rpc("submit_training_quiz", { p_assignment: a.id, p_answers: questions.map((_, i) => answers[i]), p_signed: name })
    setBusy(false)
    if (err) { setError(err.message || "That could not be sent."); return }
    try { localStorage.removeItem(draftKey) } catch { /* nothing to clean up */ }
    await onChanged()
    window.scrollTo(0, 0)
  }

  return (
    <Card style={{ padding: "14px 16px" }}>
      <div style={{ fontSize: 13, color: colors.inkSoft }}>{review ? "Check your answers" : `Question ${step + 1} of ${total}`} · pass mark {t.pass_mark}%</div>
      <div style={{ height: 6, background: "#E7E3D6", borderRadius: 999, margin: "7px 0 12px", overflow: "hidden" }}><div style={{ width: `${(Math.min(step, total) / total) * 100}%`, height: "100%", background: colors.sage }} /></div>
      {!review ? (
        <>
          <div style={{ fontSize: 16, fontWeight: 700, color: colors.ink, lineHeight: 1.4, marginBottom: 8 }}>{q.prompt}</div>
          {q.options.map((o, i) => (
            <label key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 12px", border: `1.5px solid ${answers[step] === i ? colors.sage : colors.hairline}`, background: answers[step] === i ? colors.sageTint : "#fff", borderRadius: 12, marginBottom: 8, cursor: "pointer", fontSize: 15, color: colors.ink }}>
              <input type="radio" name={`q${step}`} checked={answers[step] === i} onChange={() => setAnswers((prev) => { const next = [...prev]; next[step] = i; return next })} style={{ width: 18, height: 18 }} />
              {o}
            </label>
          ))}
          <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
            <button onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0} style={{ padding: "12px 18px", borderRadius: 12, border: `1px solid ${colors.hairline}`, background: "#fff", fontSize: 14, fontWeight: 700, color: colors.inkSoft, cursor: step === 0 ? "default" : "pointer", opacity: step === 0 ? 0.5 : 1 }}>Back</button>
            <button onClick={() => setStep((s) => s + 1)} disabled={!Number.isInteger(answers[step])} style={{ flex: 1, padding: "12px 0", borderRadius: 12, border: "none", background: colors.sage, color: "#fff", fontSize: 15, fontWeight: 700, cursor: Number.isInteger(answers[step]) ? "pointer" : "default", opacity: Number.isInteger(answers[step]) ? 1 : 0.55 }}>{step === total - 1 ? "Finish" : "Next"}</button>
          </div>
          <div style={{ fontSize: 12.5, color: colors.inkFaint, textAlign: "center", marginTop: 10 }}>Your answers are saved on this phone as you go.</div>
        </>
      ) : (
        <>
          {questions.map((qq, i) => (
            <button key={qq.id} onClick={() => setStep(i)} style={{ display: "block", width: "100%", textAlign: "left", font: "inherit", cursor: "pointer", border: "none", borderTop: i ? `1px solid ${colors.hairline}` : "none", background: "none", padding: "9px 0" }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: colors.ink }}>{i + 1}. {qq.prompt}</div>
              <div style={{ fontSize: 13, color: Number.isInteger(answers[i]) ? colors.inkSoft : colors.rust }}>{Number.isInteger(answers[i]) ? qq.options[answers[i]] : "Not answered. Tap to answer."}</div>
            </button>
          ))}
          <Confirm name={name} setName={setName} sure={sure} setSure={setSure} />
          {error && <div style={{ fontSize: 13, color: colors.rust, marginTop: 8 }}>{error}</div>}
          <button onClick={send} disabled={busy || !answered || !sure || !name.trim()} style={sendStyle(busy || !answered || !sure || !name.trim())}>{busy ? "Sending..." : "Send my answers"}</button>
        </>
      )}
    </Card>
  )
}
