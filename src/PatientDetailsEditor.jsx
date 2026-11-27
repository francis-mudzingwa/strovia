import { useState } from "react"

const colors = { card: "#FFFFFF", hairline: "#E5DFD1", ink: "#20261F", inkSoft: "#5C6357", sage: "#3F6C51" }

const FIELDS = [
  ["Full name", "fullName", { placeholder: "Walter Bennett", required: true }],
  ["Date of birth", "dob", { type: "date" }],
  ["Phone", "phone", { type: "tel", placeholder: "(508) 555-0100" }],
  ["Address", "address", { placeholder: "214 Maple Grove Lane, Worcester, MA" }],
  ["Lives with", "livesWith", { placeholder: "Wife (Margaret)" }],
  ["Stroke type", "strokeType", { select: ["Not sure", "Ischemic", "Hemorrhagic", "TIA (mini-stroke)"] }],
  ["Date of stroke", "strokeDate", { type: "date" }],
  ["Emergency contact name", "emergencyName", { placeholder: "Margaret Bennett" }],
  ["Emergency contact relationship", "emergencyRelationship", { placeholder: "Spouse" }],
  ["Emergency contact phone", "emergencyPhone", { type: "tel", placeholder: "(508) 555-0100" }],
  ["Primary care provider", "careProvider", { placeholder: "Dr. Anna Ryan" }],
]

const inputStyle = { width: "100%", padding: "10px 12px", borderRadius: 10, border: `1px solid ${colors.hairline}`, fontSize: 14, boxSizing: "border-box", background: "#fff" }

// `setup` is true right after the administrator adds a patient: this is step 1 of 2 (details, then care plan).
export default function PatientDetailsEditor({ profile, onSave, onCancel, onSkip, setup, saving }) {
  const [form, setForm] = useState(profile)

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); onSave({ ...form, fullName: form.fullName.trim() }) }}
      style={{ background: colors.card, borderRadius: 18, boxShadow: "0 1px 3px rgba(32,38,31,0.06), 0 6px 16px rgba(32,38,31,0.05)", padding: 22 }}
    >
      {setup && <div style={{ fontSize: 13, fontWeight: 700, color: colors.sage, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>Step 1 of 2</div>}
      <h2 style={{ fontFamily: "Fraunces, serif", fontSize: 19, fontWeight: 600, color: colors.ink, margin: setup ? "0 0 6px" : "0 0 16px" }}>Patient details</h2>
      {setup && <p style={{ fontSize: 13, color: colors.inkSoft, lineHeight: 1.5, margin: "0 0 16px" }}>Fill in what you know. Anything left blank can be added later. Next you'll set up the care plan.</p>}
      {FIELDS.map(([label, key, opts]) => (
        <div key={key} style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: colors.inkSoft, display: "block", marginBottom: 5 }}>{label}</label>
          {opts.select ? (
            <select value={form[key] ?? ""} onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))} style={inputStyle}>
              {opts.select.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          ) : (
            <input
              type={opts.type || "text"}
              required={opts.required}
              value={form[key] ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
              placeholder={opts.placeholder || ""}
              style={inputStyle}
            />
          )}
        </div>
      ))}
      <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
        <button type="submit" disabled={saving} style={{ flex: 1, padding: "13px 0", borderRadius: 12, border: "none", background: colors.sage, color: "#fff", fontSize: 14.5, fontWeight: 700, cursor: saving ? "default" : "pointer", opacity: saving ? 0.7 : 1 }}>
          {saving ? "Saving..." : setup ? "Save and continue to care plan" : "Save details"}
        </button>
        <button type="button" onClick={setup ? onSkip : onCancel} style={{ padding: "13px 16px", borderRadius: 12, border: `1px solid ${colors.hairline}`, background: "#fff", color: colors.inkSoft, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
          {setup ? "Skip" : "Cancel"}
        </button>
      </div>
    </form>
  )
}
