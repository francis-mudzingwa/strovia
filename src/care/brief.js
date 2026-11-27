import { supabase } from "../supabaseClient.js"
import { ageFromDob } from "../carePlan.js"

const SYMPTOMS = [
  ["balance", "Balance"], ["vision", "Vision"], ["face", "Face"], ["arm", "Arm"], ["speech", "Speech"], ["headache", "Headache"], ["fatigue", "Fatigue"],
]
const LEVEL = ["None", "Mild", "Mod.", "Severe"]
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]))
const day = (iso) => new Date(iso.length <= 10 ? iso + "T00:00:00" : iso).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })
const when = (iso) => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })

// A one-page summary of the last 14 days to take to a doctor's appointment: symptoms, readings, incidents, what was
// done about severe symptoms, and recent notes. Returns false if the browser blocked the print window.
export async function printDoctorBrief({ patientId, patientName, profile, plan, printedBy }) {
  const w = window.open("", "_blank")
  if (!w) return false
  const since = new Date(Date.now() - 14 * 86400000)
  const sinceDate = `${since.getFullYear()}-${String(since.getMonth() + 1).padStart(2, "0")}-${String(since.getDate()).padStart(2, "0")}`
  const [checkins, vitals, incidents, actions, notes, meds] = await Promise.all([
    supabase.from("checkins").select("entry_date, symptoms, feeling, onset_note, notes").eq("patient_id", patientId).gte("entry_date", sinceDate).order("entry_date", { ascending: false }),
    supabase.from("vitals").select("*").eq("patient_id", patientId).gte("taken_at", since.toISOString()).order("taken_at", { ascending: false }),
    supabase.from("incidents").select("*").eq("patient_id", patientId).gte("happened_at", since.toISOString()).order("happened_at", { ascending: false }),
    supabase.from("symptom_actions").select("entry_date, actions, other_note").eq("patient_id", patientId).gte("entry_date", sinceDate).order("entry_date", { ascending: false }),
    supabase.from("patient_notes").select("note, kind, created_at, author_name").eq("patient_id", patientId).gte("created_at", since.toISOString()).order("created_at", { ascending: false }).limit(15),
    supabase.from("medication_log").select("med_name, dose, status, created_at").eq("patient_id", patientId).gte("created_at", since.toISOString()).order("created_at", { ascending: false }),
  ])

  const age = ageFromDob(profile.dob)
  const head = [age !== null ? `${age} years` : null, profile.strokeType && profile.strokeType !== "Not sure" ? `${profile.strokeType} stroke` : null, profile.strokeDate ? `on ${day(profile.strokeDate)}` : null].filter(Boolean).join(", ")

  const symptomRows = (checkins.data || []).map((c) => `<tr><td>${esc(day(c.entry_date))}</td>${SYMPTOMS.map(([k]) => {
    const v = c.symptoms?.[k]
    return `<td class="${v === 3 ? "sev" : ""}">${v == null ? "-" : LEVEL[v]}</td>`
  }).join("")}<td>${esc(c.onset_note || "")}</td></tr>`).join("")

  const vitalRows = (vitals.data || []).map((v) => `<tr><td>${esc(when(v.taken_at))}</td><td>${v.systolic ? `${v.systolic}/${v.diastolic}` : "-"}</td><td>${v.pulse ?? "-"}</td><td>${v.glucose ?? "-"}</td><td>${v.weight_lb ?? "-"}</td><td>${v.temperature ?? "-"}</td><td>${v.oxygen_saturation ?? "-"}</td><td>${v.pain_score ?? "-"}</td><td>${esc(v.note || "")}</td></tr>`).join("")

  const incidentRows = (incidents.data || []).map((i) => `<li><strong>${esc(when(i.happened_at))}</strong>: ${esc(i.kind)}${i.injury ? " (with injury)" : ""}${i.details ? `. ${esc(i.details)}` : ""}${i.action_taken ? ` Done: ${esc(i.action_taken)}` : ""}</li>`).join("")
  const actionRows = (actions.data || []).map((a) => `<li><strong>${esc(day(a.entry_date))}</strong>: ${esc([(a.actions || []).join("; "), a.other_note].filter(Boolean).join(". "))}</li>`).join("")
  const noteRows = (notes.data || []).map((n) => `<li><strong>${esc(when(n.created_at))}</strong>${n.kind === "handover" ? " (handover)" : n.kind === "question" ? " (question)" : ""}, ${esc(n.author_name || "")}: ${esc(n.note)}</li>`).join("")
  const refusedMeds = (meds.data || []).filter((m) => m.status === "refused")
  const medRows = refusedMeds.map((m) => `<li><strong>${esc(when(m.created_at))}</strong>: ${esc(m.med_name)}${m.dose ? ` (${esc(m.dose)})` : ""} refused</li>`).join("")

  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Summary for ${esc(patientName)}</title>
    <style>
      body { font-family: Georgia, serif; color: #000; margin: 22px; font-size: 13px; }
      h1 { font-size: 22px; margin: 0 0 2px; } h2 { font-size: 15px; margin: 18px 0 6px; border-bottom: 1px solid #999; padding-bottom: 3px; }
      .meta { color: #333; margin: 0 0 8px; line-height: 1.5; }
      table { width: 100%; border-collapse: collapse; font-size: 12px; } th { text-align: left; border-bottom: 2px solid #000; padding: 4px 6px; }
      td { border-bottom: 1px solid #ccc; padding: 4px 6px; } td.sev { font-weight: bold; background: #eee; }
      ul { margin: 4px 0 0; padding-left: 18px; line-height: 1.5; } .empty { color: #555; }
      .foot { font-size: 11.5px; color: #333; margin-top: 18px; border-top: 1px solid #999; padding-top: 6px; }
    </style></head><body>
    <h1>${esc(patientName)}: the last 14 days</h1>
    <p class="meta">${esc(head)}${head ? "<br>" : ""}Allergies: ${esc(plan.allergies || "not recorded")}<br>Fall risk: ${esc(plan.fallRisk || "not recorded")}${profile.careProvider ? `<br>Doctor: ${esc(profile.careProvider)}` : ""}</p>
    <h2>Symptom check-ins</h2>
    ${symptomRows ? `<table><thead><tr><th>Date</th>${SYMPTOMS.map(([, l]) => `<th>${l}</th>`).join("")}<th>Started</th></tr></thead><tbody>${symptomRows}</tbody></table>` : `<p class="empty">No check-ins in this period.</p>`}
    <h2>Readings/Vitals</h2>
    ${vitalRows ? `<table><thead><tr><th>When</th><th>Blood pressure</th><th>Pulse</th><th>Sugar (mg/dL)</th><th>Weight (lb)</th><th>Temp (°F)</th><th>SpO2 (%)</th><th>Pain (/10)</th><th>Note</th></tr></thead><tbody>${vitalRows}</tbody></table>` : `<p class="empty">No readings recorded.</p>`}
    <h2>Incidents</h2>${incidentRows ? `<ul>${incidentRows}</ul>` : `<p class="empty">None reported.</p>`}
    <h2>What was done about severe symptoms</h2>${actionRows ? `<ul>${actionRows}</ul>` : `<p class="empty">Nothing recorded.</p>`}
    <h2>Refused medication</h2>${medRows ? `<ul>${medRows}</ul>` : `<p class="empty">None recorded.</p>`}
    <h2>Recent notes</h2>${noteRows ? `<ul>${noteRows}</ul>` : `<p class="empty">No notes.</p>`}
    <p class="foot">Prepared by ${esc(printedBy)} on ${esc(new Date().toLocaleString())} from Strovia. This is a summary of what carers recorded. It is not a medical record and does not replace the treating team's instructions.</p>
    </body></html>`)
  w.document.close()
  w.focus()
  w.print()
  return true
}
