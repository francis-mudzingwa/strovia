import { useState } from "react"
import { FileText, Plus, X, ChevronDown, Lock } from "lucide-react"
import { Card, colors, quietButton } from "./ui.jsx"
import Handoff from "./Handoff.jsx"
import CareSchedule from "./CareSchedule.jsx"
import Tasks from "./Tasks.jsx"
import { ExercisesToday } from "./Exercises.jsx"
import Readings from "./Readings.jsx"
import Bowel from "./Bowel.jsx"
import Meals from "./Meals.jsx"
import Incidents from "./Incidents.jsx"
import EmergencyCard from "./EmergencyCard.jsx"
import { printDoctorBrief } from "./brief.js"

// The top of a patient's Today page: a plain-language summary of how they are today. Arriving for a shift ("I've arrived")
// lives only on the welcome page, so it is not repeated here.
export function TodayTop({ patient, profile, entries, alert, severeDone, appointments, plan, care, userId, role, myShifts, personName, overview, visits, anomalies, offShift, onMessage }) {
  return (
    <>
      {overview && (
        <Handoff
          patientId={patient.id} profile={profile} entries={entries} alert={alert} severeDone={severeDone} appointments={appointments}
          plan={plan} care={care} overview={overview} visits={visits} anomalies={anomalies} personName={personName} userId={userId} role={role} offShift={offShift} onMessage={onMessage}
        />
      )}
      {role === "relative" && (
        <CareSchedule patientId={patient.id} schedule={care.schedule} personName={personName} firstName={(profile.fullName || patient.full_name || "them").split(" ")[0]} />
      )}
    </>
  )
}

// The working cards, placed just after the check-in: exercises and tasks stay in view; readings, incidents and notes open from
// three quick buttons; the emergency information and the doctor summary are folded away under "More".
export function TodayTools({ patient, profile, plan, care, userId, isAdmin, isStaff, personName, printedBy, offShift, onOpenExercises, notesNode }) {
  const [blocked, setBlocked] = useState(false)
  const [panel, setPanel] = useState(null) // null | reading | incident | note
  const [more, setMore] = useState(false)
  // Off shift, only reporting an incident stays: someone who sees a fall must always be able to say so.
  const quick = offShift ? [["incident", "Incident"]] : [["reading", "Reading"], ["incident", "Incident"], ["note", "Note"]]
  const quickStyle = (on) => ({ flex: 1, padding: "10px 4px", borderRadius: 11, border: `1.5px solid ${colors.sage}`, background: on ? colors.sage : "#fff", color: on ? "#fff" : colors.sageDeep, fontWeight: 700, fontSize: 13.5, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 5 })
  return (
    <>
      {!offShift && <ExercisesToday exercises={care.exercises} log={care.exerciseLog} onOpen={onOpenExercises} offShift={offShift} />}
      {!offShift && <Meals patientId={patient.id} userId={userId} isAdmin={isAdmin} canRecord={!!isStaff} rows={care.meals || []} nameFor={personName} onSaved={care.reload} offShift={offShift} />}
      {!offShift && <Tasks patientId={patient.id} userId={userId} isAdmin={isAdmin} tasks={plan.tasks} taskTimes={plan.taskTimes || {}} done={care.tasksDone} nameFor={personName} onChanged={care.reload} offShift={offShift} />}

      {!offShift && isStaff && <Bowel patientId={patient.id} userId={userId} isAdmin={isAdmin} plan={plan} log={care.bowel || []} nameFor={personName} onSaved={care.reload} offShift={offShift} />}

      <div className="no-print" style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        {quick.map(([key, label]) => (
          <button key={key} onClick={() => setPanel(panel === key ? null : key)} aria-pressed={panel === key} style={quickStyle(panel === key)}>
            {panel === key ? <X size={14} /> : <Plus size={14} />} {label}
          </button>
        ))}
      </div>
      {offShift && (
        <Card className="no-print" style={{ padding: "12px 16px", marginBottom: 14 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 13.5, color: colors.inkSoft, lineHeight: 1.5 }}>
            <Lock size={16} color={colors.inkFaint} style={{ flexShrink: 0, marginTop: 2 }} />
            <span><strong style={{ color: colors.ink }}>Tasks, exercises, readings and notes open while you are on shift.</strong> Tap I've arrived on the welcome page when you start.</span>
          </div>
        </Card>
      )}
      {panel === "reading" && <Readings patientId={patient.id} userId={userId} ranges={plan.ranges || {}} vitals={care.vitals} nameFor={personName} onSaved={care.reload} offShift={offShift} overdue={care.overdue || []} />}
      {panel === "incident" && <Incidents patientId={patient.id} userId={userId} incidents={care.incidents} nameFor={personName} onSaved={care.reload} />}
      {panel === "note" && notesNode}

      <Card className="no-print" style={{ padding: "4px 16px", marginBottom: 16 }}>
        <button onClick={() => setMore((m) => !m)} aria-expanded={more} style={{ display: "flex", width: "100%", alignItems: "center", justifyContent: "space-between", border: "none", background: "none", padding: "12px 0", cursor: "pointer", fontFamily: "inherit", fontSize: 14, fontWeight: 700, color: colors.sageDeep }}>
          {offShift ? "Emergency information" : "More: emergency information and doctor summary"}
          <ChevronDown size={16} style={{ transform: more ? "rotate(180deg)" : "none" }} />
        </button>
        {more && (
          <div style={{ paddingBottom: 12 }}>
            <EmergencyCard profile={profile} plan={plan} />
            {!offShift && (
              <button onClick={async () => setBlocked(!(await printDoctorBrief({ patientId: patient.id, patientName: patient.full_name, profile, plan, printedBy })))} style={quietButton}>
                <FileText size={14} /> Print a summary for the doctor
              </button>
            )}
            {blocked && <p style={{ fontSize: 13, color: colors.rust, margin: "8px 0 0" }}>Your browser blocked the print window. Allow pop-ups for this site and try again.</p>}
          </div>
        )}
      </Card>
    </>
  )
}
