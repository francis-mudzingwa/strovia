import { useState, useEffect } from "react"
import { Printer, FileText, Pencil } from "lucide-react"
import { WHEN_LABEL } from "./care/timeOfDay.js"
import { RANGE_FIELDS, WEIGHT_GROUP, EVERY_KEYS, READING_GROUPS, READING_NAME, everyWords, hasRanges } from "./care/ranges.js"
import { supabase } from "./supabaseClient.js"
import CallActions from "./CallActions.jsx"
import CarePlanEditor from "./CarePlanEditor.jsx"
import { ageFromDob, resolveCarePlan } from "./carePlan.js"
import { timesToText } from "./care/medication.js"

const colors = {
  bg: "#FAF6EF", card: "#FFFFFF", hairline: "#E5DFD1", ink: "#20261F", inkSoft: "#5C6357", inkFaint: "#6B7266",
  sage: "#3F6C51", sageDeep: "#2C4E3A", sageTint: "#E3EBE0", gold: "#B98A2E", goldTint: "#F3E7CC",
  rust: "#A24632", rustTint: "#F3DAD2", teal: "#4C7A82", tealTint: "#E5EEEF",
}

const ROLE_LABEL = { admin: "Administrator", caregiver: "Caregiver", relative: "Family proxy" }
const RISK_COLOR = { High: colors.rust, Moderate: colors.gold, Low: colors.sage }

function Card({ children, style, className = "" }) {
  return (
    <div className={`careplan-card ${className}`} style={{ background: colors.card, borderRadius: 18, boxShadow: "0 1px 3px rgba(32,38,31,0.06), 0 6px 16px rgba(32,38,31,0.05)", padding: 20, marginBottom: 16, ...style }}>
      {children}
    </div>
  )
}

function SectionTitle({ children }) {
  return (
    <div style={{ fontSize: 13, fontWeight: 700, color: colors.inkFaint, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 10 }}>
      {children}
    </div>
  )
}

function Row({ label, value }) {
  if (value === null || value === undefined || value === "") return null
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 16, padding: "9px 0", borderBottom: `1px solid ${colors.hairline}` }}>
      <span style={{ fontSize: 13, color: colors.inkFaint, flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 13.5, fontWeight: 600, color: colors.ink, textAlign: "right" }}>{value}</span>
    </div>
  )
}

function Bullets({ items, color = colors.ink }) {
  return (
    <ul style={{ margin: 0, padding: "0 0 0 18px" }}>
      {items.map((t, i) => (
        <li key={`${i}-${t}`} style={{ fontSize: 13.5, color, lineHeight: 1.55, marginBottom: 4 }}>{t}</li>
      ))}
    </ul>
  )
}

const fmtLongDate = (d) => d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
const fmtStamp = (d) => d.toLocaleString("en-US", { year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" })

function PrintHistory({ patientId }) {
  const [rows, setRows] = useState(null)

  useEffect(() => {
    let cancelled = false
    supabase
      .from("activity_log")
      .select("id, actor_name, actor_role, created_at")
      .eq("patient_id", patientId)
      .eq("action", "printed the care plan")
      .order("created_at", { ascending: false })
      .limit(20)
      .then(({ data }) => { if (!cancelled) setRows(data || []) })
    return () => { cancelled = true }
  }, [patientId])

  return (
    <Card className="no-print">
      <SectionTitle>Print history (only administrators see this)</SectionTitle>
      {rows === null ? (
        <p style={{ fontSize: 13, color: colors.inkFaint, margin: 0 }}>Loading...</p>
      ) : rows.length === 0 ? (
        <p style={{ fontSize: 13, color: colors.inkFaint, margin: 0 }}>This care plan hasn't been printed yet.</p>
      ) : (
        rows.map((r) => (
          <div key={r.id} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "8px 0", borderBottom: `1px solid ${colors.hairline}` }}>
            <span style={{ fontSize: 13.5, color: colors.ink, fontWeight: 600 }}>{r.actor_name} <span style={{ fontWeight: 400, color: colors.inkFaint }}>({ROLE_LABEL[r.actor_role] || r.actor_role})</span></span>
            <span style={{ fontSize: 13, color: colors.inkSoft, textAlign: "right" }}>{fmtStamp(new Date(r.created_at))}</span>
          </div>
        ))
      )}
    </Card>
  )
}

// `setup` is true right after the administrator adds a patient: the care plan opens for editing (step 2 of 2).
export default function CarePlan({ profile, savedPlan, viewer, patientId, alert, isAdmin, onPrint, onSavePlan, onEditDetails, setView, setup, onSetupDone }) {
  const [editing, setEditing] = useState(!!setup && !!isAdmin)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)

  const plan = resolveCarePlan(savedPlan, profile)
  const age = ageFromDob(profile.dob)
  const strokeDate = profile.strokeDate ? new Date(profile.strokeDate + "T00:00:00") : null
  const weeksSince = strokeDate ? Math.max(0, Math.floor((Date.now() - strokeDate.getTime()) / (7 * 24 * 3600 * 1000))) : null

  const conditions = []
  if (profile.heartDisease) conditions.push("Heart disease")
  if (profile.hypertension) conditions.push("High blood pressure")
  if (profile.avgGlucose >= 200) conditions.push(`High average blood glucose (${profile.avgGlucose} mg/dL)`)
  if (profile.bmi >= 30) conditions.push(`BMI ${profile.bmi} (obesity range)`)
  if (profile.smokingStatus) conditions.push(`Smoking: ${profile.smokingStatus.toLowerCase()}`)

  const now = new Date()

  async function save(next) {
    setSaving(true)
    setSaveError(null)
    const error = await onSavePlan(next)
    setSaving(false)
    if (error) setSaveError(error)
    else { setEditing(false); onSetupDone?.(true) }
  }

  if (editing) {
    return (
      <>
        {setup && (
          <div className="no-print" style={{ background: colors.sageTint, borderRadius: 12, padding: "11px 14px", marginBottom: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: colors.sageDeep, textTransform: "uppercase", letterSpacing: 0.5 }}>Step 2 of 2</div>
            <div style={{ fontSize: 13, color: colors.ink, lineHeight: 1.5, marginTop: 2 }}>
              The care plan starts from Strovia's standard stroke care plan. Change whatever is different for {profile.fullName || "this patient"}, then save.
            </div>
          </div>
        )}
        <CarePlanEditor
          plan={plan} patientName={profile.fullName || "the patient"}
          onSave={save} onCancel={() => { setEditing(false); setSaveError(null); onSetupDone?.(false) }}
          saving={saving} error={saveError}
        />
      </>
    )
  }

  return (
    <div>
      <style>{`
        .print-only { display: none; }
        @media print {
          .no-print { display: none !important; }
          .print-only { display: block !important; }
          .careplan-card { box-shadow: none !important; break-inside: avoid; border: 1px solid #ddd; }
          body { background: #fff !important; }
        }
      `}</style>

      {alert && <div className="no-print"><CallActions alert={alert} /></div>}

      <Card>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 14 }}>
          <div style={{ width: 42, height: 42, borderRadius: 12, background: colors.sageTint, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <FileText size={21} color={colors.sageDeep} />
          </div>
          <div style={{ flex: 1 }}>
            <h1 style={{ fontFamily: "Fraunces, serif", fontSize: 22, fontWeight: 600, color: colors.ink, margin: 0 }}>Stroke Care Plan</h1>
            <div style={{ fontSize: 13, color: colors.inkFaint, marginTop: 2 }}>Recovery and safety plan for {profile.fullName || "the patient"}</div>
          </div>
        </div>

        <div className="no-print" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          {isAdmin && (
            <button onClick={() => setEditing(true)} style={{ border: "none", background: colors.sage, color: "#fff", borderRadius: 9, padding: "8px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
              <Pencil size={13} /> Edit care plan
            </button>
          )}
          <button onClick={onEditDetails} style={{ border: `1px solid ${colors.hairline}`, background: "#fff", borderRadius: 9, padding: "8px 14px", fontSize: 13, fontWeight: 600, color: colors.inkSoft, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
            <Pencil size={13} /> Edit patient details
          </button>
          <button onClick={onPrint} style={{ border: `1px solid ${colors.hairline}`, background: "#fff", borderRadius: 9, padding: "8px 14px", fontSize: 13, fontWeight: 600, color: colors.inkSoft, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
            <Printer size={14} /> Print
          </button>
        </div>

        {!savedPlan && isAdmin && (
          <div className="no-print" style={{ background: colors.goldTint, borderRadius: 10, padding: "9px 12px", marginBottom: 12, fontSize: 13, color: colors.ink, lineHeight: 1.5 }}>
            This is the standard stroke care plan. Tap <strong>Edit care plan</strong> to fit it to {profile.fullName || "this patient"}.
          </div>
        )}

        {profile.sampleRecord && (
          <div className="no-print" style={{ background: colors.tealTint, borderRadius: 10, padding: "9px 12px", marginBottom: 12, fontSize: 13, color: colors.teal, lineHeight: 1.5 }}>
            <strong>Sample record.</strong> Clinical details come from a public stroke dataset ({profile.datasetSource}). The name, address, dates and contact details are fictional.
          </div>
        )}

        <Row label="Client" value={profile.fullName || "Not set"} />
        <Row label="Lives with" value={profile.livesWith} />
        <Row label="Address" value={profile.address} />
        <Row label="Primary phone" value={profile.phone} />
        <Row label="Plan date" value={fmtLongDate(now)} />
        <Row label="Review" value={plan.review} />
      </Card>

      <Card>
        <SectionTitle>Client information</SectionTitle>
        <Row label="Age" value={age !== null ? `${age} years` : null} />
        <Row label="Gender" value={profile.gender} />
        <Row label="Date of birth" value={profile.dob ? fmtLongDate(new Date(profile.dob + "T00:00:00")) : null} />
        <Row label="Marital status" value={profile.maritalStatus} />
        <Row label="Work" value={profile.workType} />
        <Row label="Residence" value={profile.residence} />
        <Row label="Emergency contact" value={profile.emergencyName ? `${profile.emergencyName}${profile.emergencyRelationship ? ` (${profile.emergencyRelationship})` : ""}` : null} />
        <Row label="Emergency phone" value={profile.emergencyPhone} />
        <Row label="Primary provider" value={profile.careProvider} />
      </Card>

      <Card>
        <SectionTitle>Diagnosis</SectionTitle>
        <div style={{ fontSize: 14.5, fontWeight: 700, color: colors.ink, marginBottom: 4 }}>
          {profile.strokeType && profile.strokeType !== "Not sure" ? `${profile.strokeType} stroke` : "Stroke"}
        </div>
        <div style={{ fontSize: 13, color: colors.inkSoft, marginBottom: conditions.length ? 12 : 0, lineHeight: 1.5 }}>
          {strokeDate ? `Stroke on ${fmtLongDate(strokeDate)}${weeksSince !== null ? ` (${weeksSince} week${weeksSince === 1 ? "" : "s"} ago)` : ""}. ` : ""}
          Now in recovery. The main aims are preventing a second stroke, rebuilding function and staying safe at home.
        </div>
        {conditions.length > 0 && (
          <>
            <div style={{ fontSize: 13, fontWeight: 700, color: colors.inkSoft, marginBottom: 6 }}>Other health factors</div>
            <Bullets items={conditions} />
          </>
        )}
      </Card>

      <Card>
        <SectionTitle>Fall risk</SectionTitle>
        <div style={{ display: "inline-block", fontSize: 13, fontWeight: 700, padding: "3px 12px", borderRadius: 999, background: RISK_COLOR[plan.fallRisk] || colors.rust, color: "#fff", marginBottom: 10 }}>{plan.fallRisk}</div>
        {plan.fallPrecautions.length > 0 && <Bullets items={plan.fallPrecautions} />}
      </Card>

      {plan.allergies && (
        <Card>
          <SectionTitle>Allergies</SectionTitle>
          <p style={{ fontSize: 13.5, color: colors.ink, margin: 0, lineHeight: 1.55 }}>{plan.allergies}</p>
        </Card>
      )}

      {plan.equipment.length > 0 && (
        <Card>
          <SectionTitle>Special equipment</SectionTitle>
          <Bullets items={plan.equipment} />
        </Card>
      )}

      {plan.services.length > 0 && (
        <Card>
          <SectionTitle>Services</SectionTitle>
          {plan.services.map((s, i) => (
            <div key={`${i}-${s.name}`} style={{ padding: "11px 0", borderBottom: i < plan.services.length - 1 ? `1px solid ${colors.hairline}` : "none" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: colors.ink }}>{s.name}</span>
                {s.frequency && <span style={{ fontSize: 13, fontWeight: 600, color: colors.sageDeep, background: colors.sageTint, padding: "2px 10px", borderRadius: 999 }}>{s.frequency}</span>}
              </div>
              {s.detail && <div style={{ fontSize: 13, color: colors.inkSoft, lineHeight: 1.5, marginTop: 3 }}>{s.detail}</div>}
            </div>
          ))}
        </Card>
      )}

      {plan.medications.length > 0 && (
        <Card>
          <SectionTitle>Medications</SectionTitle>
          <p style={{ fontSize: 13, color: colors.inkSoft, lineHeight: 1.5, margin: "0 0 8px" }}>
            Names and doses come only from the prescriber's current medication list. Never change or stop a medication without asking.
          </p>
          <Bullets items={plan.medications} />
        </Card>
      )}

      {(plan.medSchedule || []).length > 0 && (
        <Card>
          <SectionTitle>Medication schedule</SectionTitle>
          {plan.medSchedule.map((m, i) => (
            <div key={`${i}-${m.name}`} style={{ padding: "10px 0", borderBottom: i < plan.medSchedule.length - 1 ? `1px solid ${colors.hairline}` : "none" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: colors.ink }}>{m.name}{m.dose ? <span style={{ fontWeight: 400, color: colors.inkSoft }}> · {m.dose}</span> : null}</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: colors.sageDeep, background: colors.sageTint, padding: "2px 10px", borderRadius: 999 }}>
                  {m.asNeeded ? "As needed" : timesToText(m.times) || "No times set"}
                </span>
              </div>
              {m.instructions && <div style={{ fontSize: 13, color: colors.inkSoft, lineHeight: 1.5, marginTop: 3 }}>{m.instructions}</div>}
            </div>
          ))}
          <button
            className="no-print"
            onClick={() => setView("medications")}
            style={{ marginTop: 12, border: "none", background: "none", color: colors.sageDeep, fontSize: 13, fontWeight: 700, cursor: "pointer", padding: 0 }}
          >
            Open the Medications tab →
          </button>
        </Card>
      )}

      {plan.diet.length > 0 && (
        <Card>
          <SectionTitle>Diet and eating</SectionTitle>
          <Bullets items={plan.diet} />
        </Card>
      )}

      {(plan.tasks || []).length > 0 && (
        <Card>
          <SectionTitle>Daily tasks</SectionTitle>
          <Bullets items={plan.tasks.map((t) => (plan.taskTimes?.[t] ? `${t} (${WHEN_LABEL[plan.taskTimes[t]].toLowerCase()})` : t))} />
        </Card>
      )}

      {plan.readingsNeeded === false && (
        <Card>
          <SectionTitle>Readings</SectionTitle>
          <div style={{ fontSize: 14, color: colors.inkSoft, lineHeight: 1.5 }}>No regular readings are needed for this patient. A reading can still be recorded at any time.</div>
        </Card>
      )}

      {hasRanges(plan.ranges) && (
        <Card>
          <SectionTitle>Reading levels set by the care team</SectionTitle>
          <Bullets items={[
            ...RANGE_FIELDS.filter((f) => ["min", "max", "red_min", "red_max"].some((e) => plan.ranges[`${f.key}_${e}`] != null)).map((f) => {
              const r = plan.ranges
              const lo = r[`${f.key}_min`]
              const hi = r[`${f.key}_max`]
              const rl = r[`${f.key}_red_min`]
              const rh = r[`${f.key}_red_max`]
              const amber = lo != null || hi != null ? `tell the supervisor if ${lo != null && hi != null ? `outside ${lo} to ${hi}` : lo != null ? `below ${lo}` : `above ${hi}`}` : null
              const red = rl != null || rh != null ? `call now if ${rl != null && rh != null ? `below ${rl} or above ${rh}` : rl != null ? `below ${rl}` : `above ${rh}`}` : null
              return `${f.label} (${f.unit}): ${[amber, red].filter(Boolean).join("; ")}`
            }),
            ...(plan.ranges[WEIGHT_GROUP.gain1] != null || plan.ranges[WEIGHT_GROUP.gain7] != null
              ? [`Weight: tell the supervisor if up more than ${[plan.ranges[WEIGHT_GROUP.gain1] != null ? `${plan.ranges[WEIGHT_GROUP.gain1]} lb in a day` : null, plan.ranges[WEIGHT_GROUP.gain7] != null ? `${plan.ranges[WEIGHT_GROUP.gain7]} lb in a week` : null].filter(Boolean).join(" or ")}`]
              : []),
            ...(EVERY_KEYS.some((k) => plan.ranges[k] != null)
              ? [`How often: ${[...READING_GROUPS.map((g) => [READING_NAME[g.key], plan.ranges[g.every]]), [READING_NAME.weight, plan.ranges[WEIGHT_GROUP.every]]].filter(([, h]) => h != null).map(([n, h]) => `${n.toLowerCase()} ${everyWords(h)}`).join(", ")}`]
              : []),
            ...(plan.ranges.source ? [`Numbers given by: ${plan.ranges.source}`] : []),
          ]} />
        </Card>
      )}

      <Card>
        <SectionTitle>Recovery goals</SectionTitle>
        {plan.goals.length > 0
          ? <Bullets items={plan.goals} />
          : <p style={{ fontSize: 13.5, color: colors.inkFaint, margin: 0 }}>No goals set yet.</p>}
      </Card>

      {plan.followUps.length > 0 && (
        <Card>
          <SectionTitle>Follow-up appointments</SectionTitle>
          {plan.followUps.map((f, i) => (
            <div key={`${i}-${f.who}`} style={{ display: "flex", justifyContent: "space-between", gap: 14, padding: "9px 0", borderBottom: i < plan.followUps.length - 1 ? `1px solid ${colors.hairline}` : "none" }}>
              <span style={{ fontSize: 13.5, fontWeight: 600, color: colors.ink }}>{f.who}</span>
              <span style={{ fontSize: 13, color: colors.inkSoft, textAlign: "right" }}>{f.when}</span>
            </div>
          ))}
          <button
            className="no-print"
            onClick={() => setView("appointments")}
            style={{ marginTop: 12, border: "none", background: "none", color: colors.sageDeep, fontSize: 13, fontWeight: 700, cursor: "pointer", padding: 0 }}
          >
            Manage appointments and reminders →
          </button>
        </Card>
      )}

      {plan.additional.length > 0 && (
        <Card>
          <SectionTitle>Additional information</SectionTitle>
          <Bullets items={plan.additional} />
        </Card>
      )}

      {plan.callOfficeIf.length > 0 && (
        <div style={{ background: colors.goldTint, borderRadius: 18, padding: 20, marginBottom: 16, border: `1px solid ${colors.gold}` }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: colors.ink, marginBottom: 4 }}>Call the office if…</div>
          <div style={{ fontSize: 13, color: colors.inkSoft, marginBottom: 10 }}>
            Not an emergency, but the care team needs to know the same day. Strovia shows a call button here when it detects a steep change.
          </div>
          <Bullets items={plan.callOfficeIf} />
        </div>
      )}

      {plan.call911If.length > 0 && (
        <div style={{ background: colors.rustTint, borderRadius: 18, padding: 20, marginBottom: 16, border: `1px solid ${colors.rust}` }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: colors.rust, marginBottom: 4 }}>Call 911 if…</div>
          <div style={{ fontSize: 13, color: colors.inkSoft, marginBottom: 10 }}>
            Do not wait, and do not drive the person yourself. Strovia shows a call button here when the check-ins show severe symptoms.
          </div>
          <Bullets items={plan.call911If} />
        </div>
      )}

      <p style={{ fontSize: 12.5, color: colors.inkFaint, lineHeight: 1.5, margin: "0 4px 8px" }}>
        This care plan guides the care team and family. It does not replace the treating clinicians' orders. Strovia does not diagnose medical conditions.
      </p>

      <p className="print-only" style={{ fontSize: 13, color: "#000", borderTop: "1px solid #999", paddingTop: 8, marginTop: 16 }}>
        Printed by {viewer.name} ({ROLE_LABEL[viewer.role] || viewer.role}) on {fmtStamp(now)}.
      </p>

      {isAdmin && patientId && <PrintHistory patientId={patientId} />}
    </div>
  )
}
