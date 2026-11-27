import { useState } from "react"
import { UtensilsCrossed, Check, X, AlertTriangle, Trash2 } from "lucide-react"
import { supabase } from "../supabaseClient.js"
import { Card, DoneRow, colors, inputStyle, primaryButton, fmtTime } from "./ui.jsx"
import { localDate } from "./useCare.js"
import { hourText } from "./timeOfDay.js"
import { MEALS, AMOUNTS, DRINKS, summary, mealRow, mealConcerns } from "./meals.js"

const chip = (on, tone) => ({
  padding: "7px 12px", borderRadius: 999, fontSize: 13.5, fontWeight: on ? 700 : 500, cursor: "pointer", fontFamily: "inherit",
  border: `1.5px solid ${on ? (tone === "bad" ? colors.rust : colors.sage) : colors.hairline}`,
  background: on ? (tone === "bad" ? colors.rustTint : colors.sageTint) : "#fff",
  color: on ? (tone === "bad" ? colors.rust : colors.sageDeep) : colors.inkSoft,
})
const lbl = { fontSize: 12.5, fontWeight: 700, color: colors.inkFaint, margin: "0 0 6px" }

// Today's meals: for each meal, how much was eaten and drunk, and any trouble swallowing. Carers and administrators record them
// (a carer only while on shift); family members see them. Lunch opens at 12 noon and dinner at 5 PM; an administrator can still
// record one early, with a reason.
export default function Meals({ patientId, userId, isAdmin, canRecord, rows, nameFor, onSaved, offShift }) {
  const [open, setOpen] = useState(null) // meal key whose form is open
  const [amount, setAmount] = useState("")
  const [drinks, setDrinks] = useState("")
  const [trouble, setTrouble] = useState(false)
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [expanded, setExpanded] = useState(false)

  const now = new Date()
  const today = localDate()
  const who = (r) => nameFor(patientId, r.done_by) || "Someone on the care team"
  const recordedCount = MEALS.filter((m) => mealRow(rows, today, m.key)).length

  function begin(key) {
    setOpen(open === key ? null : key); setAmount(""); setDrinks(""); setTrouble(false); setNote(""); setError(null)
  }

  async function save(meal) {
    setError(null)
    if (!amount) { setError("Choose how much was eaten."); return }
    if (!drinks) { setError("Choose how much was drunk."); return }
    let earlyReason = null
    if (now.getHours() < meal.opens) {
      if (!isAdmin) return
      earlyReason = (window.prompt(`${meal.label} opens at ${hourText(meal.opens)}. Why is it being recorded early?`) || "").trim()
      if (!earlyReason) return
    }
    setBusy(true)
    const { error: err } = await supabase.from("meal_log").insert({
      patient_id: patientId, log_date: today, meal: meal.key, amount, drinks, trouble, note: note.trim() || null, done_by: userId,
      ...(earlyReason ? { early_reason: earlyReason } : {}),
    })
    setBusy(false)
    // Two people recording the same meal at once is fine: the second just refreshes.
    if (err && err.code !== "23505") { setError(err.code === "P0001" ? err.message : "That couldn't be saved. Check your connection and try again."); return }
    setOpen(null)
    await onSaved()
  }

  async function undo(r) {
    const { error: err } = await supabase.from("meal_log").delete().eq("id", r.id)
    if (err) { setError("That couldn't be undone. Try again."); return }
    await onSaved()
  }

  // All three recorded and nothing to look at twice (little eaten or drunk, trouble swallowing): one line, tap to open.
  const allDone = recordedCount === MEALS.length && mealConcerns(rows, today).length === 0
  if (allDone && !expanded) return <DoneRow icon={UtensilsCrossed} title="Meals" status={`${recordedCount} of ${MEALS.length} recorded`} onClick={() => setExpanded(true)} expanded={false} />

  return (
    <Card>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 700, color: colors.ink }}>
          <UtensilsCrossed size={16} color={colors.sageDeep} /> Meals
        </span>
        <span style={{ fontSize: 13, fontWeight: 700, color: colors.inkSoft }}>{recordedCount} of {MEALS.length} recorded</span>
      </div>

      {MEALS.map((meal) => {
        const r = mealRow(rows, today, meal.key)
        const waiting = !r && now.getHours() < meal.opens
        const canAdd = canRecord && !offShift && (!waiting || isAdmin)
        const mine = r && (isAdmin || r.done_by === userId) && canRecord
        return (
          <div key={meal.key} style={{ borderTop: `1px solid ${colors.hairline}`, padding: "10px 0" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ width: 26, height: 26, borderRadius: 8, border: `2px solid ${r ? colors.sage : colors.hairline}`, background: r ? colors.sage : "#fff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                {r && <Check size={16} color="#fff" strokeWidth={3} />}
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 14, fontWeight: 700, color: r ? colors.inkSoft : colors.ink }}>{meal.label}</span>
                {r ? (
                  <>
                    <span style={{ display: "block", fontSize: 13.5, color: colors.ink }}>{summary(r)}</span>
                    {r.trouble && <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 13, fontWeight: 700, color: colors.rust }}><AlertTriangle size={13} /> Coughing, choking or trouble swallowing</span>}
                    {r.note && <span style={{ display: "block", fontSize: 13, color: colors.inkSoft }}>{r.note}</span>}
                    <span style={{ display: "block", fontSize: 12.5, color: colors.inkFaint }}>{who(r)}, {fmtTime(r.done_at)}{r.early_reason ? `. Recorded early: ${r.early_reason}` : ""}</span>
                  </>
                ) : waiting ? (
                  <span style={{ display: "block", fontSize: 12.5, color: colors.inkFaint }}>Opens at {hourText(meal.opens)}{canRecord && isAdmin ? ". You can record it early." : ""}</span>
                ) : (
                  <span style={{ display: "block", fontSize: 12.5, color: colors.inkFaint }}>Not recorded yet</span>
                )}
              </span>
              {mine && <button onClick={() => undo(r)} aria-label={`Undo ${meal.label}`} style={{ border: "none", background: "none", cursor: "pointer", color: colors.inkFaint, padding: 4 }}><Trash2 size={15} /></button>}
              {!r && canAdd && (
                <button onClick={() => begin(meal.key)} aria-expanded={open === meal.key} style={{ border: `1.5px solid ${colors.sage}`, background: open === meal.key ? colors.sage : "#fff", color: open === meal.key ? "#fff" : colors.sageDeep, borderRadius: 11, padding: "7px 12px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", display: "inline-flex", alignItems: "center", gap: 5 }}>
                  {open === meal.key ? <><X size={14} /> Close</> : "Record"}
                </button>
              )}
            </div>

            {open === meal.key && !r && (
              <div style={{ marginTop: 12 }}>
                <p style={lbl}>How much did they eat?</p>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
                  {AMOUNTS.map(([v, l]) => <button key={v} type="button" onClick={() => setAmount(v)} aria-pressed={amount === v} style={chip(amount === v)}>{l}</button>)}
                </div>
                <p style={lbl}>How much did they drink?</p>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
                  {DRINKS.map(([v, l]) => <button key={v} type="button" onClick={() => setDrinks(v)} aria-pressed={drinks === v} style={chip(drinks === v)}>{l}</button>)}
                </div>
                <div style={{ border: `1px solid ${trouble ? colors.rust : colors.hairline}`, borderRadius: 12, padding: "10px 12px", marginBottom: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: colors.rust }}>Coughing, choking or trouble swallowing</span>
                    <span style={{ display: "flex", gap: 6 }}>
                      <button type="button" onClick={() => setTrouble(true)} aria-pressed={trouble} style={chip(trouble, "bad")}>Yes</button>
                      <button type="button" onClick={() => setTrouble(false)} aria-pressed={!trouble} style={chip(!trouble)}>No</button>
                    </span>
                  </div>
                  <div style={{ fontSize: 12.5, color: trouble ? colors.rust : colors.inkFaint, marginTop: 4 }}>{trouble ? "This shows on the handover so the next carer and the office know." : "If yes, it shows on the handover."}</div>
                </div>
                <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} rows={2} placeholder="Note (optional)" style={{ ...inputStyle, resize: "vertical", marginBottom: 10 }} />
                {error && <p style={{ color: colors.rust, fontSize: 13, margin: "0 0 8px" }}>{error}</p>}
                <button onClick={() => save(meal)} disabled={busy} style={{ ...primaryButton, opacity: busy ? 0.6 : 1 }}>{busy ? "Saving…" : "Save"}</button>
              </div>
            )}
          </div>
        )
      })}
      {!open && error && <p style={{ color: colors.rust, fontSize: 13, margin: "8px 0 0" }}>{error}</p>}
      {canRecord && offShift && recordedCount < MEALS.length && <p style={{ fontSize: 13, color: colors.rust, margin: "8px 0 0" }}>You're not on shift for this patient right now, so you can't record meals.</p>}
    </Card>
  )
}
