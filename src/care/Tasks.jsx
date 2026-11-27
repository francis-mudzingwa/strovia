import { useState } from "react"
import { ListChecks, Check } from "lucide-react"
import { supabase } from "../supabaseClient.js"
import { Card, DoneRow, colors, fmtTime } from "./ui.jsx"
import { localDate } from "./useCare.js"
import { WHEN_LABEL, taskOpensAt, isBefore, hourText } from "./timeOfDay.js"

// Today's tick-list, written by the administrator in the care plan. Anyone caring for the patient can tick a task;
// it shows who did it and when. Only the person who ticked it (or the administrator) can untick it. A task the care plan
// tags Afternoon or Evening opens at 12 noon or 5 PM; an administrator can still record it earlier, with a reason.
export default function Tasks({ patientId, userId, isAdmin, tasks, taskTimes = {}, done, nameFor, onChanged, offShift }) {
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)
  const [expanded, setExpanded] = useState(false)
  if (!tasks || tasks.length === 0) return null

  const now = new Date()
  const doneFor = (task) => done.find((d) => d.task === task)
  const count = tasks.filter((t) => doneFor(t)).length

  async function toggle(task) {
    const row = doneFor(task)
    const opens = taskOpensAt(taskTimes, task)
    let earlyReason = null
    if (!row && isBefore(now, opens)) {
      if (!isAdmin) return
      earlyReason = (window.prompt(`This task opens at ${hourText(opens)}. Why is it being recorded early?`) || "").trim()
      if (!earlyReason) return
    }
    setBusy(task)
    setError(null)
    const result = row
      ? await supabase.from("task_log").delete().eq("id", row.id)
      : await supabase.from("task_log").insert({ patient_id: patientId, task_date: localDate(), task, done_by: userId, ...(earlyReason ? { early_reason: earlyReason } : {}) })
    setBusy(null)
    // Two people ticking the same task at once is fine: the second just refreshes.
    if (result.error && result.error.code !== "23505") {
      setError(result.error.code === "P0001" ? result.error.message : "That couldn't be saved. Check your connection and try again.")
    }
    await onChanged()
  }

  // Every task ticked: one line, tap to open (to see who ticked what, or to undo one).
  if (count === tasks.length && !expanded) return <DoneRow icon={ListChecks} title="Today's tasks" status={`${count} of ${tasks.length} done`} onClick={() => setExpanded(true)} expanded={false} />

  return (
    <Card>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 4 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 700, color: colors.ink }}>
          <ListChecks size={16} color={colors.sageDeep} /> Today's tasks
        </span>
        <span style={{ fontSize: 13, fontWeight: 700, color: count === tasks.length ? colors.sageDeep : colors.inkSoft }}>{count} of {tasks.length} done</span>
      </div>
      <div style={{ height: 8, background: colors.sageTint, borderRadius: 999, margin: "6px 0 12px", overflow: "hidden" }}>
        <div style={{ width: `${(count / tasks.length) * 100}%`, height: "100%", background: colors.sage, borderRadius: 999, transition: "width 0.3s ease" }} />
      </div>
      {tasks.map((task) => {
        const row = doneFor(task)
        const mine = row && (row.done_by === userId || isAdmin)
        const locked = row && !mine
        const blockedOffShift = offShift && !row
        const opens = taskOpensAt(taskTimes, task)
        const waiting = !row && isBefore(now, opens)
        const blockedEarly = waiting && !isAdmin
        const when = taskTimes[task] ? WHEN_LABEL[taskTimes[task]] : null
        const inert = locked || blockedOffShift || blockedEarly
        return (
          <button key={task} onClick={() => toggle(task)} disabled={busy === task || inert} aria-pressed={!!row} className={inert ? "" : "task-row"}
            style={{ display: "flex", width: "100%", alignItems: "center", gap: 12, textAlign: "left", padding: "10px 8px", borderRadius: 10, border: "none", borderTop: `1px solid ${colors.hairline}`, background: "none", cursor: inert ? "default" : "pointer", opacity: busy === task ? 0.6 : blockedOffShift || blockedEarly ? 0.55 : 1 }}>
            <span style={{ width: 26, height: 26, borderRadius: 8, border: `2px solid ${row ? colors.sage : colors.hairline}`, background: row ? colors.sage : "#fff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transition: "background 0.15s ease, border-color 0.15s ease" }}>
              {row && <Check size={16} color="#fff" strokeWidth={3} />}
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", fontSize: 14, color: row ? colors.inkSoft : colors.ink, textDecoration: row ? "line-through" : "none" }}>
                {task}{when && <span style={{ marginLeft: 8, fontSize: 11.5, fontWeight: 700, color: colors.inkFaint, background: colors.bg, borderRadius: 999, padding: "1px 8px", textDecoration: "none", display: "inline-block" }}>{when}</span>}
              </span>
              {waiting && <span style={{ display: "block", fontSize: 12.5, color: colors.inkFaint }}>Opens at {hourText(opens)}{isAdmin ? ". Tap to record it early." : ""}</span>}
              {row && row.early_reason && <span style={{ display: "block", fontSize: 12.5, color: colors.inkFaint }}>Recorded early: {row.early_reason}</span>}
            </span>
            {row && <span style={{ fontSize: 13, color: colors.inkFaint }}>{nameFor(patientId, row.done_by) || "Someone"}, {fmtTime(row.done_at)}</span>}
          </button>
        )
      })}
      {offShift && count < tasks.length && <p style={{ fontSize: 13, color: colors.rust, margin: "8px 0 0" }}>You're not on shift for this patient right now, so you can't tick off the tasks below.</p>}
      {error && <p style={{ color: colors.rust, fontSize: 13, margin: "8px 0 0" }}>{error}</p>}
    </Card>
  )
}
