import { useState } from "react"
import { Pill, Check, X as XIcon } from "lucide-react"
import { supabase } from "../supabaseClient.js"
import { Card, colors, inputStyle, primaryButton, quietButton, fmtTime, fmtWhen, ago } from "./ui.jsx"
import { scheduledSlotsFor, slotStatus, todaysProgress, weeklyAdherence } from "./medication.js"

const STATUS_COLOR = {
  given: { color: colors.sageDeep, bg: colors.sageTint, text: "Given" },
  refused: { color: colors.rust, bg: colors.rustTint, text: "Refused" },
  due: { color: "#7A5A12", bg: colors.goldTint, text: "Due now" },
  overdue: { color: colors.rust, bg: colors.rustTint, text: "Overdue" },
  upcoming: { color: colors.inkFaint, bg: colors.bg, text: "Upcoming" },
}

// The medication schedule the administrator set in the care plan, what's due today, and a short recent history so
// everyone — caregiver, family proxy and administrator alike — can see who gave what and when.
export default function Medication({ patientId, userId, schedule, log, nameFor, onSaved, offShift }) {
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)
  const [refusing, setRefusing] = useState(null)
  const [note, setNote] = useState("")

  const now = new Date()
  const slots = scheduledSlotsFor(schedule, now, log)
  const asNeeded = (schedule || []).filter((m) => m.asNeeded && m.name)
  const { total, given } = todaysProgress(schedule, log, now)
  // Never blocks a dose (a patient may need one at any hour): it only shows when the same medicine was last given, so nobody has to guess.
  const lastGiven = (name) => log.find((l) => l.med_name === name && l.status === "given")
  const lastLine = (name) => {
    const l = lastGiven(name)
    return l ? <div style={{ fontSize: 13, color: colors.inkSoft }}>Last given {fmtWhen(l.created_at)} ({ago(l.created_at)}) by {nameFor(patientId, l.given_by) || "someone on the care team"}</div> : null
  }
  const week = weeklyAdherence(schedule, log, now)

  async function record(rowKey, medName, dose, scheduledFor, status, noteText) {
    setBusy(rowKey)
    setError(null)
    const { error: err } = await supabase.from("medication_log").insert({
      patient_id: patientId, med_name: medName, dose: dose || null, scheduled_for: scheduledFor, status, given_by: userId, note: noteText?.trim() || null,
    })
    setBusy(null)
    if (err) return setError(err.code === "P0001" ? err.message : "That couldn't be saved. Check your connection and try again.")
    setRefusing(null)
    setNote("")
    await onSaved()
  }

  if (slots.length === 0 && asNeeded.length === 0) {
    return (
      <Card>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <Pill size={16} color={colors.sageDeep} />
          <span style={{ fontSize: 14, fontWeight: 700, color: colors.ink }}>Medications</span>
        </div>
        <p style={{ fontSize: 13, color: colors.inkFaint, margin: 0 }}>No medication schedule has been set up for this patient yet. The administrator can add one in the care plan.</p>
      </Card>
    )
  }

  return (
    <>
      <Card>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 4 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 700, color: colors.ink }}>
            <Pill size={16} color={colors.sageDeep} /> Medications
          </span>
          {total > 0 && <span style={{ fontSize: 13, fontWeight: 700, color: given === total ? colors.sageDeep : colors.inkSoft }}>{given} of {total} given today</span>}
        </div>
        {total > 0 && (
          <div style={{ height: 8, background: colors.sageTint, borderRadius: 999, margin: "6px 0 12px", overflow: "hidden" }}>
            <div style={{ width: `${(given / total) * 100}%`, height: "100%", background: colors.sage, borderRadius: 999, transition: "width 0.3s ease" }} />
          </div>
        )}

        {slots.map((slot) => {
          const status = slotStatus(slot, now)
          const style = STATUS_COLOR[status]
          const rowKey = `${slot.med.name}-${slot.time}`
          const scheduledIso = slot.due.toISOString()
          const isRefusing = refusing === rowKey
          return (
            <div key={rowKey} style={{ padding: "10px 8px", margin: "0 -8px", borderRadius: 10, borderTop: `1px solid ${colors.hairline}`, background: status === "overdue" ? colors.rustTint : "transparent" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <div>
                  <span style={{ fontSize: 14, fontWeight: 700, color: colors.ink }}>{slot.med.name}</span>
                  {slot.med.dose && <span style={{ fontSize: 13, color: colors.inkSoft }}> · {slot.med.dose}</span>}
                  <div style={{ fontSize: 13, color: colors.inkFaint }}>{fmtTime(slot.due)}{slot.med.instructions ? ` · ${slot.med.instructions}` : ""}</div>
                  {!slot.entry && lastLine(slot.med.name)}
                </div>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: style.color, background: style.bg, padding: "3px 10px", borderRadius: 999 }}>
                  {status === "given" ? `Given ${fmtTime(slot.entry.created_at)}` : style.text}
                </span>
              </div>
              {slot.entry ? (
                <div style={{ fontSize: 13, color: colors.inkFaint, marginTop: 4 }}>
                  {nameFor(patientId, slot.entry.given_by) || "Someone on the care team"}{slot.entry.note ? ` · ${slot.entry.note}` : ""}
                </div>
              ) : offShift ? (
                <p style={{ fontSize: 13, color: colors.rust, fontWeight: 600, margin: "8px 0 0" }}>You're not on shift for this patient right now, so you can't give medication.</p>
              ) : (
                <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                  <button onClick={() => record(rowKey, slot.med.name, slot.med.dose, scheduledIso, "given")} disabled={busy === rowKey}
                    style={{ ...primaryButton, padding: "7px 14px", fontSize: 13, display: "inline-flex", alignItems: "center", gap: 5, opacity: busy === rowKey ? 0.6 : 1 }}>
                    <Check size={13} /> Give
                  </button>
                  <button onClick={() => setRefusing(isRefusing ? null : rowKey)} disabled={busy === rowKey}
                    style={{ ...quietButton, padding: "7px 14px", fontSize: 13, color: colors.rust, borderColor: colors.rust }}>
                    <XIcon size={13} /> Refused
                  </button>
                </div>
              )}
              {isRefusing && (
                <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Why, if known (optional)" style={{ ...inputStyle, fontSize: 13, flex: 1, minWidth: 160 }} />
                  <button onClick={() => record(rowKey, slot.med.name, slot.med.dose, scheduledIso, "refused", note)} disabled={busy === rowKey}
                    style={{ ...primaryButton, background: colors.rust, whiteSpace: "nowrap", opacity: busy === rowKey ? 0.6 : 1 }}>
                    Confirm refused
                  </button>
                </div>
              )}
            </div>
          )
        })}

        {asNeeded.length > 0 && (
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: colors.inkFaint, textTransform: "uppercase", letterSpacing: 0.5, margin: slots.length ? "12px 0 2px" : "0 0 2px" }}>As needed</div>
            {asNeeded.map((m) => {
              const rowKey = `prn-${m.name}`
              return (
                <div key={rowKey} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "8px 0", borderTop: `1px solid ${colors.hairline}` }}>
                  <div>
                    <span style={{ fontSize: 14, fontWeight: 700, color: colors.ink }}>{m.name}</span>
                    {m.dose && <span style={{ fontSize: 13, color: colors.inkSoft }}> · {m.dose}</span>}
                    {m.instructions && <div style={{ fontSize: 13, color: colors.inkFaint }}>{m.instructions}</div>}
                    {lastLine(m.name)}
                  </div>
                  <button onClick={() => record(rowKey, m.name, m.dose, null, "given")} disabled={busy === rowKey || offShift} title={offShift ? "You're not on shift for this patient right now." : undefined}
                    style={{ ...quietButton, padding: "7px 14px", fontSize: 13, opacity: busy === rowKey || offShift ? 0.5 : 1, flexShrink: 0, cursor: offShift ? "default" : "pointer" }}>
                    Give now
                  </button>
                </div>
              )
            })}
          </div>
        )}

        {week.total > 0 && <p style={{ fontSize: 13, color: colors.inkFaint, margin: "10px 0 0" }}>{week.given} of {week.total} scheduled doses given in the last 7 days.</p>}
        {error && <p style={{ color: colors.rust, fontSize: 13, margin: "8px 0 0" }}>{error}</p>}
      </Card>

      {log.length > 0 && (
        <Card>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: colors.ink, marginBottom: 4 }}>Recent medication history</div>
          {log.slice(0, 10).map((l) => (
            <div key={l.id} style={{ padding: "9px 0", borderTop: `1px solid ${colors.hairline}` }}>
              <span style={{ fontSize: 13.5, fontWeight: 700, color: l.status === "refused" ? colors.rust : colors.ink }}>
                {l.med_name}{l.dose ? ` · ${l.dose}` : ""}{l.status === "refused" ? " — refused" : ""}
              </span>
              {l.note && <div style={{ fontSize: 13, color: colors.inkSoft }}>{l.note}</div>}
              <div style={{ fontSize: 13, color: colors.inkFaint }}>{fmtWhen(l.created_at)} ({ago(l.created_at)}) · {nameFor(patientId, l.given_by) || "Someone on the care team"}</div>
            </div>
          ))}
        </Card>
      )}
    </>
  )
}
