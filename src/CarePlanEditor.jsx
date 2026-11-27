import { useState } from "react"
import { Plus, X } from "lucide-react"
import { RANGE_FIELDS, READING_GROUPS, WEIGHT_GROUP, EVERY_OPTIONS, EVERY_KEYS, ALL_RANGE_KEYS, cleanRanges } from "./care/ranges.js"
import { parseTimesList, timesToText } from "./care/medication.js"
import { WHEN_OPTIONS } from "./care/timeOfDay.js"
import { BOWEL_DAY_OPTIONS } from "./care/bowel.js"

const colors = {
  bg: "#FAF6EF", card: "#FFFFFF", hairline: "#E5DFD1", ink: "#20261F", inkSoft: "#5C6357", inkFaint: "#6B7266",
  sage: "#3F6C51", sageDeep: "#2C4E3A", sageTint: "#E3EBE0", rust: "#A24632", gold: "#B98A2E",
}

const inputStyle = { width: "100%", padding: "9px 11px", borderRadius: 9, border: `1px solid ${colors.hairline}`, fontSize: 13.5, boxSizing: "border-box", background: "#fff", fontFamily: "inherit", color: colors.ink }
const labelStyle = { fontSize: 13, fontWeight: 700, color: colors.inkSoft, display: "block", marginBottom: 5 }
const hintStyle = { fontSize: 12.5, color: colors.inkFaint, margin: "4px 0 0", lineHeight: 1.4 }

const toLines = (list) => (list || []).join("\n")
const fromLines = (text) => text.split("\n").map((s) => s.trim()).filter(Boolean)

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <label style={labelStyle}>{title}</label>
      {children}
    </div>
  )
}

// Only administrators reach this screen. Lists are typed one item per line; services and follow-ups are rows.
export default function CarePlanEditor({ plan, patientName, onSave, onCancel, saving, error }) {
  const [form, setForm] = useState(() => ({
    fallRisk: plan.fallRisk,
    fallPrecautions: toLines(plan.fallPrecautions),
    allergies: plan.allergies,
    equipment: toLines(plan.equipment),
    medications: toLines(plan.medications),
    diet: toLines(plan.diet),
    goals: toLines(plan.goals),
    additional: toLines(plan.additional),
    callOfficeIf: toLines(plan.callOfficeIf),
    call911If: toLines(plan.call911If),
    review: plan.review,
    services: (plan.services || []).map((s) => ({ ...s })),
    followUps: (plan.followUps || []).map((f) => ({ ...f })),
    tasks: toLines(plan.tasks),
    taskTimes: { ...(plan.taskTimes || {}) },
    bowelDays: plan.bowelDays ? String(plan.bowelDays) : "",
    readingsNeeded: plan.readingsNeeded === true ? "yes" : plan.readingsNeeded === false ? "no" : "",
    ranges: { ...Object.fromEntries(ALL_RANGE_KEYS.map((k) => [k, plan.ranges?.[k] ?? ""])), source: plan.ranges?.source ?? "" },
    medSchedule: (plan.medSchedule || []).map((m) => ({ name: m.name || "", dose: m.dose || "", timesText: timesToText(m.times), instructions: m.instructions || "", asNeeded: !!m.asNeeded })),
  }))

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))
  const setRow = (key, index, field, value) =>
    setForm((f) => ({ ...f, [key]: f[key].map((row, i) => (i === index ? { ...row, [field]: value } : row)) }))
  const addRow = (key, blank) => setForm((f) => ({ ...f, [key]: [...f[key], blank] }))
  const removeRow = (key, index) => setForm((f) => ({ ...f, [key]: f[key].filter((_, i) => i !== index) }))

  function submit(e) {
    e.preventDefault()
    const taskList = fromLines(form.tasks).map((t) => t.slice(0, 120))
    onSave({
      fallRisk: form.fallRisk,
      fallPrecautions: fromLines(form.fallPrecautions),
      allergies: form.allergies.trim(),
      equipment: fromLines(form.equipment),
      medications: fromLines(form.medications),
      diet: fromLines(form.diet),
      goals: fromLines(form.goals),
      additional: fromLines(form.additional),
      callOfficeIf: fromLines(form.callOfficeIf),
      call911If: fromLines(form.call911If),
      review: form.review.trim(),
      services: form.services.filter((s) => s.name.trim()).map((s) => ({ name: s.name.trim(), frequency: s.frequency.trim(), detail: s.detail.trim() })),
      followUps: form.followUps.filter((f) => f.who.trim()).map((f) => ({ who: f.who.trim(), when: f.when.trim() })),
      tasks: taskList,
      taskTimes: Object.fromEntries(taskList.filter((t) => form.taskTimes[t]).map((t) => [t, form.taskTimes[t]])),
      bowelDays: form.bowelDays ? Number(form.bowelDays) : null,
      // A patient who does not need regular readings is saved with no "how often", so nothing is ever reported overdue for them.
      readingsNeeded: form.readingsNeeded === "yes" ? true : form.readingsNeeded === "no" ? false : null,
      ranges: cleanRanges(form.readingsNeeded === "no" ? { ...form.ranges, ...Object.fromEntries(EVERY_KEYS.map((k) => [k, ""])) } : form.ranges, plan.ranges || {}),
      medSchedule: form.medSchedule
        .filter((m) => m.name.trim())
        .map((m) => ({
          name: m.name.trim().slice(0, 120), dose: m.dose.trim().slice(0, 60) || null,
          instructions: m.instructions.trim().slice(0, 300) || null, asNeeded: m.asNeeded,
          times: m.asNeeded ? [] : parseTimesList(m.timesText),
        })),
    })
  }

  const area = (key, rows = 4) => <textarea value={form[key]} onChange={set(key)} rows={rows} style={{ ...inputStyle, resize: "vertical" }} />

  return (
    <form onSubmit={submit} style={{ background: colors.card, borderRadius: 18, boxShadow: "0 1px 3px rgba(32,38,31,0.06), 0 6px 16px rgba(32,38,31,0.05)", padding: 20 }}>
      <h2 style={{ fontFamily: "Fraunces, Georgia, serif", fontSize: 20, fontWeight: 600, color: colors.ink, margin: "0 0 4px" }}>Edit care plan</h2>
      <p style={{ fontSize: 13, color: colors.inkFaint, margin: "0 0 18px", lineHeight: 1.5 }}>
        Write the plan for {patientName}. Caregivers and family see it and can print it, but only you can change it. Type one item per line.
      </p>

      <Section title="Fall risk">
        <select value={form.fallRisk} onChange={set("fallRisk")} style={{ ...inputStyle, marginBottom: 8 }}>
          {["High", "Moderate", "Low"].map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        {area("fallPrecautions", 4)}
        <p style={hintStyle}>Precautions, one per line.</p>
      </Section>

      <Section title="Allergies">{area("allergies", 2)}</Section>
      <Section title="Special equipment">{area("equipment", 5)}</Section>

      <Section title="Services">
        {form.services.map((s, i) => (
          <div key={i} style={{ background: colors.bg, borderRadius: 12, padding: 10, marginBottom: 8 }}>
            <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
              <input value={s.name} onChange={(e) => setRow("services", i, "name", e.target.value)} placeholder="Service (e.g. Physical therapy)" style={inputStyle} />
              <button type="button" onClick={() => removeRow("services", i)} aria-label="Remove service" style={{ border: "none", background: "none", cursor: "pointer", color: colors.inkFaint, display: "flex", alignItems: "center" }}><X size={17} /></button>
            </div>
            <input value={s.frequency} onChange={(e) => setRow("services", i, "frequency", e.target.value)} placeholder="How often (e.g. 3 sessions per week)" style={{ ...inputStyle, marginBottom: 6 }} />
            <input value={s.detail} onChange={(e) => setRow("services", i, "detail", e.target.value)} placeholder="What it involves" style={inputStyle} />
          </div>
        ))}
        <button type="button" onClick={() => addRow("services", { name: "", frequency: "", detail: "" })} style={{ border: `1px dashed ${colors.sage}`, background: "#fff", color: colors.sageDeep, borderRadius: 9, padding: "8px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
          <Plus size={14} /> Add a service
        </button>
      </Section>

      <Section title="Medications">
        {area("medications", 5)}
        <p style={hintStyle}>Types or names of medications, for the printed plan. Doses come only from the prescriber's list.</p>
      </Section>

      <Section title="Medication schedule (for the daily Medications tab)">
        <p style={{ ...hintStyle, margin: "0 0 10px" }}>
          What's due and when. Caregivers and family mark each dose given or refused, and everyone can see who did it and when.
        </p>
        {form.medSchedule.map((m, i) => (
          <div key={i} style={{ background: colors.bg, borderRadius: 12, padding: 10, marginBottom: 8 }}>
            <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
              <input value={m.name} onChange={(e) => setRow("medSchedule", i, "name", e.target.value)} placeholder="Medication (e.g. Aspirin)" style={inputStyle} />
              <input value={m.dose} onChange={(e) => setRow("medSchedule", i, "dose", e.target.value)} placeholder="Dose (e.g. 81mg)" style={{ ...inputStyle, maxWidth: 130 }} />
              <button type="button" onClick={() => removeRow("medSchedule", i)} aria-label="Remove medication" style={{ border: "none", background: "none", cursor: "pointer", color: colors.inkFaint, display: "flex", alignItems: "center" }}><X size={17} /></button>
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13, color: colors.inkSoft, marginBottom: 6, cursor: "pointer" }}>
              <input type="checkbox" checked={m.asNeeded} onChange={(e) => setRow("medSchedule", i, "asNeeded", e.target.checked)} />
              Taken as needed, not on a schedule
            </label>
            {!m.asNeeded && (
              <>
                <input value={m.timesText} onChange={(e) => setRow("medSchedule", i, "timesText", e.target.value)} placeholder="Times (e.g. 8:00 AM, 8:00 PM)" style={{ ...inputStyle, marginBottom: 6 }} />
              </>
            )}
            <input value={m.instructions} onChange={(e) => setRow("medSchedule", i, "instructions", e.target.value)} placeholder="Instructions (optional, e.g. with food)" style={inputStyle} />
          </div>
        ))}
        <button type="button" onClick={() => addRow("medSchedule", { name: "", dose: "", timesText: "", instructions: "", asNeeded: false })} style={{ border: `1px dashed ${colors.sage}`, background: "#fff", color: colors.sageDeep, borderRadius: 9, padding: "8px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
          <Plus size={14} /> Add a medication
        </button>
      </Section>
      <Section title="Diet and eating">{area("diet", 5)}</Section>
      <Section title="Recovery goals">{area("goals", 4)}</Section>

      <Section title="Follow-up appointments">
        {form.followUps.map((f, i) => (
          <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <input value={f.who} onChange={(e) => setRow("followUps", i, "who", e.target.value)} placeholder="Who (e.g. Neurology)" style={inputStyle} />
            <input value={f.when} onChange={(e) => setRow("followUps", i, "when", e.target.value)} placeholder="When (e.g. every 6 weeks)" style={inputStyle} />
            <button type="button" onClick={() => removeRow("followUps", i)} aria-label="Remove follow-up" style={{ border: "none", background: "none", cursor: "pointer", color: colors.inkFaint, display: "flex", alignItems: "center" }}><X size={17} /></button>
          </div>
        ))}
        <button type="button" onClick={() => addRow("followUps", { who: "", when: "" })} style={{ border: `1px dashed ${colors.sage}`, background: "#fff", color: colors.sageDeep, borderRadius: 9, padding: "8px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
          <Plus size={14} /> Add a follow-up
        </button>
      </Section>

      <Section title="Daily tasks">
        {area("tasks", 5)}
        <p style={hintStyle}>The tick-list carers see every day, one task per line. Leave it empty for no list.</p>
        {fromLines(form.tasks).length > 0 && (
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: colors.inkSoft, marginBottom: 4 }}>When can each task be ticked?</div>
            {fromLines(form.tasks).map((t) => (
              <div key={t} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: colors.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t}</span>
                <select value={form.taskTimes[t] || ""} onChange={(e) => setForm((x) => ({ ...x, taskTimes: { ...x.taskTimes, [t.slice(0, 120)]: e.target.value } }))} aria-label={`When: ${t}`} style={{ ...inputStyle, width: "auto", padding: "6px 8px" }}>
                  {WHEN_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
            ))}
            <p style={hintStyle}>Afternoon opens at 12 noon and Evening at 5 PM (Eastern time). Morning and Any time are open all day. An administrator can still record one early, with a reason.</p>
          </div>
        )}
      </Section>

      <Section title="Reading levels (optional)">
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, fontWeight: 700, color: colors.ink, marginBottom: 6, flexWrap: "wrap" }}>
          Does this patient need regular readings?
          <select value={form.readingsNeeded} onChange={set("readingsNeeded")} style={{ ...inputStyle, width: "auto", padding: "6px 8px" }}>
            <option value="">Not decided yet</option>
            <option value="yes">Yes, set the levels and how often</option>
            <option value="no">No regular readings</option>
          </select>
        </label>
        {form.readingsNeeded === "no" && (
          <p style={{ ...hintStyle, margin: "0 0 4px" }}>
            No reminders about readings will be sent for this patient. A carer can still record a reading at any time (for example if the patient seems unwell), and it is saved. If you have entered levels below, they still flag a reading that is recorded.
          </p>
        )}
        <div style={form.readingsNeeded === "no" ? { opacity: 0.6 } : undefined}>
        <p style={{ ...hintStyle, margin: "0 0 10px" }}>
          Enter the numbers the doctor gave you. Each reading has two levels: <strong style={{ color: "#6B4D0E" }}>amber</strong> means outside the range (the carer is told to tell the supervisor and the team gets an alert),
          <strong style={{ color: colors.rust }}> red</strong> means urgent (the carer is told to call now, and the alert repeats until someone writes down what was done). Leave a box empty for no limit. Strovia never sets medical limits for you; the "commonly published" notes are only a guide.
        </p>
        {READING_GROUPS.map((g) => (
          <div key={g.key} style={{ border: `1px solid ${colors.hairline}`, borderRadius: 14, padding: 12, marginBottom: 10, background: "#fff" }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: colors.ink }}>{g.title}</div>
            <div style={{ background: "#E5EEEF", color: "#2F5A62", borderRadius: 9, padding: "7px 10px", fontSize: 12, lineHeight: 1.4, margin: "6px 0 8px" }}>{g.guide}</div>
            {g.fields.map((fk) => {
              const f = RANGE_FIELDS.find((x) => x.key === fk)
              const inp = (k, ph) => (
                <input type="number" min="0" step="any" placeholder={ph} aria-label={`${f.label} ${ph.toLowerCase()} for ${k.includes("red") ? "red" : "amber"}`} value={form.ranges[k]}
                  onChange={(e) => setForm((x) => ({ ...x, ranges: { ...x.ranges, [k]: e.target.value } }))} style={inputStyle} />
              )
              return (
                <div key={fk} style={{ marginBottom: 8 }}>
                  {g.fields.length > 1 && <div style={{ fontSize: 12.5, fontWeight: 700, color: colors.inkSoft, margin: "4px 0" }}>{f.label} ({f.unit})</div>}
                  {g.fields.length === 1 && <div style={{ fontSize: 12, color: colors.inkFaint, margin: "0 0 4px" }}>Unit: {f.unit}</div>}
                  <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 1fr", gap: 6, alignItems: "center", marginBottom: 5 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, borderRadius: 8, padding: "6px 8px", background: "#F3E7CC", color: "#6B4D0E", lineHeight: 1.2 }}>Tell the supervisor if outside</span>
                    {inp(`${fk}_min`, "Lowest")}{inp(`${fk}_max`, "Highest")}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 1fr", gap: 6, alignItems: "center" }}>
                    <span style={{ fontSize: 12, fontWeight: 700, borderRadius: 8, padding: "6px 8px", background: "#F3DAD2", color: "#7A2E1E", lineHeight: 1.2 }}>Call now if</span>
                    {inp(`${fk}_red_min`, "Below")}{inp(`${fk}_red_max`, "Above")}
                  </div>
                </div>
              )
            })}
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: colors.inkSoft, marginTop: 6 }}>
              How often should it be taken?
              <select value={form.ranges[g.every] === "" ? "" : String(form.ranges[g.every])} onChange={(e) => setForm((x) => ({ ...x, ranges: { ...x.ranges, [g.every]: e.target.value } }))} style={{ ...inputStyle, width: "auto", padding: "6px 8px" }}>
                {EVERY_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
          </div>
        ))}

        <div style={{ border: `1px solid ${colors.hairline}`, borderRadius: 14, padding: 12, marginBottom: 10, background: "#fff" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: colors.ink }}>Weight gain</div>
          <div style={{ background: "#E5EEEF", color: "#2F5A62", borderRadius: 9, padding: "7px 10px", fontSize: 12, lineHeight: 1.4, margin: "6px 0 8px" }}>{WEIGHT_GROUP.guide} Compared with the lowest weight recorded in that time.</div>
          <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 1fr", gap: 6, alignItems: "center" }}>
            <span style={{ fontSize: 12, fontWeight: 700, borderRadius: 8, padding: "6px 8px", background: "#F3E7CC", color: "#6B4D0E", lineHeight: 1.2 }}>Tell the supervisor if up more than (lb)</span>
            <input type="number" min="0" step="any" placeholder="In 1 day" aria-label="Weight gain in 1 day" value={form.ranges[WEIGHT_GROUP.gain1]} onChange={(e) => setForm((x) => ({ ...x, ranges: { ...x.ranges, [WEIGHT_GROUP.gain1]: e.target.value } }))} style={inputStyle} />
            <input type="number" min="0" step="any" placeholder="In 7 days" aria-label="Weight gain in 7 days" value={form.ranges[WEIGHT_GROUP.gain7]} onChange={(e) => setForm((x) => ({ ...x, ranges: { ...x.ranges, [WEIGHT_GROUP.gain7]: e.target.value } }))} style={inputStyle} />
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: colors.inkSoft, marginTop: 8 }}>
            How often should it be taken?
            <select value={form.ranges[WEIGHT_GROUP.every] === "" ? "" : String(form.ranges[WEIGHT_GROUP.every])} onChange={(e) => setForm((x) => ({ ...x, ranges: { ...x.ranges, [WEIGHT_GROUP.every]: e.target.value } }))} style={{ ...inputStyle, width: "auto", padding: "6px 8px" }}>
              {EVERY_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
        </div>

        <label style={{ ...labelStyle, marginTop: 4 }}>Numbers given by (optional)</label>
        <input value={form.ranges.source} onChange={(e) => setForm((x) => ({ ...x, ranges: { ...x.ranges, source: e.target.value } }))} maxLength={120} placeholder="e.g. Dr. A. Okafor, Nov 10" style={inputStyle} />
        <p style={hintStyle}>A reading that is not recorded when "how often" says it should be shows as overdue to you and the care team.</p>
        </div>
      </Section>

      <Section title="Bowel movements (optional)">
        <select value={form.bowelDays} onChange={set("bowelDays")} aria-label="Tell the office after how many days with no bowel movement" style={{ ...inputStyle, width: "auto" }}>
          <option value="">Don't flag a gap</option>
          {BOWEL_DAY_OPTIONS.map((n) => <option key={n} value={String(n)}>Tell the office after {n} days with none</option>)}
        </select>
        <p style={hintStyle}>Carers log bowel movements on the Today page. Strovia shows a warning when this many days pass with none recorded. The right number depends on the person, so only set it when their doctor or care team has said.</p>
      </Section>
      <Section title="Additional information">{area("additional", 4)}</Section>
      <Section title="Call the office if…">{area("callOfficeIf", 6)}</Section>
      <Section title="Call 911 if…">{area("call911If", 6)}</Section>
      <Section title="Review"><input value={form.review} onChange={set("review")} style={inputStyle} /></Section>

      {error && <p style={{ color: colors.rust, fontSize: 13, margin: "0 0 12px" }}>{error}</p>}
      <div style={{ display: "flex", gap: 10 }}>
        <button type="submit" disabled={saving} style={{ flex: 1, padding: "13px 0", borderRadius: 12, border: "none", background: colors.sage, color: "#fff", fontSize: 14.5, fontWeight: 700, cursor: saving ? "default" : "pointer", opacity: saving ? 0.7 : 1 }}>
          {saving ? "Saving..." : "Save care plan"}
        </button>
        <button type="button" onClick={onCancel} style={{ padding: "13px 18px", borderRadius: 12, border: `1px solid ${colors.hairline}`, background: "#fff", color: colors.inkSoft, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
          Cancel
        </button>
      </div>
    </form>
  )
}
