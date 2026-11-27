import { useState, useEffect } from "react"
import { StickyNote, Trash2, Repeat2, HelpCircle, Check } from "lucide-react"
import { supabase } from "./supabaseClient.js"

const colors = { card: "#FFFFFF", hairline: "#E5DFD1", ink: "#20261F", inkSoft: "#5C6357", inkFaint: "#6B7266", sage: "#3F6C51", sageDeep: "#2C4E3A", sageTint: "#E3EBE0", gold: "#B98A2E", goldTint: "#F3E7CC", rust: "#A24632", tealTint: "#E5EEEF", teal: "#4C7A82" }

const ROLE_STYLE = {
  admin: { label: "Administrator", bg: colors.goldTint, fg: "#7A5A12" },
  caregiver: { label: "Caregiver", bg: colors.sageTint, fg: colors.sageDeep },
  relative: { label: "Family proxy", bg: colors.tealTint, fg: colors.teal },
}

const KINDS = [
  { key: "note", label: "Wellbeing note", icon: StickyNote, hint: "Write how the patient is doing in general: mood, appetite, sleep, energy, anything worth sharing. Everyone caring for them can read these.", placeholder: "e.g. Slept well, ate a full breakfast, and walked to the garden with the cane.", button: "Add note" },
  { key: "handover", label: "Shift handover", icon: Repeat2, hint: "Leaving? Tell whoever comes next what happened, what is still to do, and anything to watch.", placeholder: "e.g. Ate well. Took morning medications. Tired after therapy: let her rest. Lunch still to do. Watch her left arm.", button: "Leave handover" },
  { key: "question", label: "Question", icon: HelpCircle, hint: "Ask the care team something. It stays highlighted for the administrator and the carers until someone marks it answered.", placeholder: "e.g. Should Dad still have the evening pill if he's very sleepy?", button: "Ask the care team" },
]

const fmtWhen = (iso) =>
  new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })

const SELECT = "id, author_id, author_name, author_role, note, kind, created_at, answered_at, answered_by"

// Everyone who can see the patient can write to the team. Notes can't be edited; only an administrator can delete one,
// and every note is also copied to the administrator's audit trail.
export default function NotesCard({ patientId, member, userId, isAdmin, nameFor }) {
  const [notes, setNotes] = useState(null) // null = loading
  const [kind, setKind] = useState("note")
  const [text, setText] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const current = KINDS.find((k) => k.key === kind)

  useEffect(() => {
    setNotes(null)
    if (!patientId) return
    let cancelled = false
    supabase
      .from("patient_notes")
      .select(SELECT)
      .eq("patient_id", patientId)
      .order("created_at", { ascending: false })
      .limit(60)
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) { setError("Couldn't load notes."); setNotes([]) } else setNotes(data || [])
      })
    return () => { cancelled = true }
  }, [patientId])

  async function addNote(e) {
    e.preventDefault()
    const note = text.trim()
    if (!note) return
    setBusy(true)
    setError(null)
    const authorName = [member.first_name, member.last_name].filter(Boolean).join(" ") || "Unnamed"
    const { data, error } = await supabase
      .from("patient_notes")
      .insert({ patient_id: patientId, author_id: userId, author_name: authorName, author_role: member.role, note, kind })
      .select(SELECT)
      .single()
    setBusy(false)
    if (error) { setError("That couldn't be saved. Please try again."); return }
    setNotes((prev) => [data, ...(prev || [])])
    setText("")
  }

  async function removeNote(id) {
    const { error } = await supabase.from("patient_notes").delete().eq("id", id)
    if (!error) setNotes((prev) => prev.filter((n) => n.id !== id))
  }

  async function answer(id) {
    const { error } = await supabase.rpc("answer_question", { p_note: id })
    if (error) { setError("That couldn't be saved. Please try again."); return }
    setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, answered_at: new Date().toISOString(), answered_by: userId } : n)))
  }

  const latestHandover = (notes || []).find((n) => n.kind === "handover")

  const renderNote = (n, pinned) => {
    const style = ROLE_STYLE[n.author_role] || { label: "", bg: colors.sageTint, fg: colors.sageDeep }
    const isQuestion = n.kind === "question"
    const open = isQuestion && !n.answered_at
    return (
      <div key={(pinned ? "pin-" : "") + n.id} style={{ padding: "12px 12px", margin: pinned ? "0 0 12px" : "0", borderTop: pinned ? "none" : `1px solid ${colors.hairline}`, background: pinned ? colors.sageTint : open ? colors.goldTint : "transparent", borderRadius: pinned || open ? 12 : 0, marginBottom: open && !pinned ? 6 : undefined }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
          {pinned && <span style={{ fontSize: 12.5, fontWeight: 800, letterSpacing: 0.4, color: colors.sageDeep, textTransform: "uppercase" }}>Latest handover</span>}
          {!pinned && n.kind === "handover" && <span style={{ fontSize: 12.5, fontWeight: 700, color: colors.sageDeep, background: colors.sageTint, padding: "2px 8px", borderRadius: 999 }}>Handover</span>}
          {isQuestion && <span style={{ fontSize: 12.5, fontWeight: 700, color: open ? "#fff" : colors.inkSoft, background: open ? colors.gold : colors.hairline, padding: "2px 8px", borderRadius: 999 }}>{open ? "Question, waiting" : "Question, answered"}</span>}
          <span style={{ fontSize: 13, fontWeight: 700, color: colors.ink }}>{n.author_name}</span>
          {style.label && <span style={{ fontSize: 12.5, fontWeight: 700, color: style.fg, background: style.bg, padding: "2px 8px", borderRadius: 999 }}>{style.label}</span>}
          <span style={{ fontSize: 13, color: colors.inkFaint }}>{fmtWhen(n.created_at)}</span>
          {isAdmin && (
            <button onClick={() => removeNote(n.id)} aria-label="Delete note" style={{ marginLeft: "auto", border: "none", background: "none", cursor: "pointer", color: colors.inkFaint, display: "flex" }}>
              <Trash2 size={14} />
            </button>
          )}
        </div>
        <div style={{ fontSize: 13.5, color: colors.ink, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{n.note}</div>
        {open && (
          <button onClick={() => answer(n.id)} style={{ marginTop: 8, display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 9, border: `1px solid ${colors.gold}`, background: "#fff", color: colors.ink, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
            <Check size={13} /> Mark as answered
          </button>
        )}
        {isQuestion && n.answered_at && (
          <div style={{ fontSize: 13, color: colors.inkFaint, marginTop: 4 }}>Marked answered by {(nameFor && nameFor(patientId, n.answered_by)) || "someone on the care team"}, {fmtWhen(n.answered_at)}</div>
        )}
      </div>
    )
  }

  return (
    <div style={{ background: colors.card, borderRadius: 18, boxShadow: "0 1px 3px rgba(32,38,31,0.06), 0 6px 16px rgba(32,38,31,0.05)", padding: 18, marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <StickyNote size={16} color={colors.sageDeep} />
        <span style={{ fontSize: 14, fontWeight: 700, color: colors.ink }}>Notes, handovers and questions</span>
      </div>

      {latestHandover && renderNote(latestHandover, true)}

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
        {KINDS.map((k) => (
          <button key={k.key} type="button" onClick={() => setKind(k.key)} aria-pressed={kind === k.key}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 12px", borderRadius: 999, border: `1px solid ${kind === k.key ? colors.sage : colors.hairline}`, background: kind === k.key ? colors.sage : "#fff", color: kind === k.key ? "#fff" : colors.inkSoft, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
            <k.icon size={13} /> {k.label}
          </button>
        ))}
      </div>
      <p style={{ fontSize: 13, color: colors.inkFaint, margin: "0 0 10px", lineHeight: 1.45 }}>{current.hint}</p>

      <form onSubmit={addNote} style={{ marginBottom: 14 }}>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          maxLength={2000}
          placeholder={current.placeholder}
          style={{ width: "100%", padding: 12, borderRadius: 10, border: `1px solid ${colors.hairline}`, fontSize: 13.5, fontFamily: "inherit", boxSizing: "border-box", resize: "vertical", marginBottom: 8 }}
        />
        <button
          type="submit"
          disabled={busy || !text.trim()}
          style={{ padding: "10px 18px", borderRadius: 9, border: "none", background: colors.sage, color: "#fff", fontSize: 13.5, fontWeight: 700, cursor: busy || !text.trim() ? "default" : "pointer", opacity: busy || !text.trim() ? 0.6 : 1 }}
        >
          {busy ? "Saving..." : current.button}
        </button>
        {error && <span style={{ marginLeft: 10, fontSize: 13, color: colors.rust }}>{error}</span>}
      </form>

      {notes === null ? (
        <p style={{ fontSize: 13, color: colors.inkFaint, margin: 0 }}>Loading...</p>
      ) : notes.length === 0 ? (
        <p style={{ fontSize: 13, color: colors.inkFaint, margin: 0 }}>Nothing here yet.</p>
      ) : (
        notes.filter((n) => n !== latestHandover).map((n) => renderNote(n, false))
      )}
    </div>
  )
}
