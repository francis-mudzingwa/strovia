import { useState, useEffect, useCallback } from "react"
import { supabase } from "../supabaseClient.js"

const pad = (n) => String(n).padStart(2, "0")
export const localDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

// What a patient's page needs about today: ticked tasks, who has arrived, recent readings and incidents, and (for
// family proxies and the administrator) who is scheduled. Everything is limited by the database to the patients
// the signed-in person may see.
export function useCareToday(patientId, role) {
  const [state, setState] = useState({ tasksDone: [], attendance: [], vitals: [], incidents: [], medications: [], exercisePlans: [], exercises: [], exerciseLog: [], handoverNotes: [], visitLog: [], overdue: [], bowel: [], meals: [], schedule: null, loaded: false })

  const load = useCallback(async () => {
    if (!patientId) return
    const today = localDate()
    const since24h = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
    const since7d = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString()
    const since8d = new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString()
    const since36h = new Date(Date.now() - 36 * 3600 * 1000).toISOString()
    const [tasks, att, vit, inc, meds, sched, exPlans, exList, exLog, notes, vLog, ovr, bowel, meals] = await Promise.all([
      supabase.from("task_log").select("id, task, done_by, done_at, early_reason").eq("patient_id", patientId).eq("task_date", today),
      supabase.from("shift_attendance").select("id, caregiver_id, planned_start, planned_end, arrived_at, left_at").eq("patient_id", patientId).gte("arrived_at", since24h).order("arrived_at", { ascending: false }),
      supabase.from("vitals").select("*").eq("patient_id", patientId).order("taken_at", { ascending: false }).limit(8),
      supabase.from("incidents").select("*").eq("patient_id", patientId).gte("happened_at", since7d).order("happened_at", { ascending: false }),
      supabase.from("medication_log").select("*").eq("patient_id", patientId).gte("created_at", since8d).order("created_at", { ascending: false }),
      role === "relative" || role === "admin" ? supabase.rpc("patient_shift_schedule", { p_patient: patientId }) : Promise.resolve({ data: null }),
      supabase.from("exercise_plans").select("*").eq("patient_id", patientId).eq("active", true).order("created_at"),
      supabase.from("exercises").select("*").eq("patient_id", patientId).eq("active", true).order("sort_order").order("created_at"),
      supabase.from("exercise_log").select("*").eq("patient_id", patientId).gte("log_date", localDate(new Date(Date.now() - 8 * 24 * 3600 * 1000))),
      // The handover note and the visit results: if either table is not there yet these just come back empty.
      supabase.from("handover_notes").select("*").eq("patient_id", patientId).gte("created_at", since36h).order("created_at", { ascending: false }),
      supabase.from("visit_log").select("*").eq("patient_id", patientId).gte("occurred_on", localDate(new Date(Date.now() - 3 * 24 * 3600 * 1000))),
      // Readings the care plan says should have been taken by now (empty until the database part is in place).
      supabase.rpc("overdue_readings"),
      // The bowel log is for carers and administrators only (the database returns nothing to family).
      role === "relative" ? Promise.resolve({ data: [] }) : supabase.from("bowel_log").select("*").eq("patient_id", patientId).gte("happened_at", new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString()).order("happened_at", { ascending: false }),
      // Today's meals and the last two days (readable by the family too).
      supabase.from("meal_log").select("*").eq("patient_id", patientId).gte("log_date", localDate(new Date(Date.now() - 2 * 24 * 3600 * 1000))),
    ])
    setState({
      tasksDone: tasks.data || [], attendance: att.data || [], vitals: vit.data || [], incidents: inc.data || [],
      medications: meds.data || [], exercisePlans: exPlans.data || [], exercises: exList.data || [], exerciseLog: exLog.data || [],
      handoverNotes: notes.data || [], visitLog: vLog.data || [],
      overdue: (ovr.data || []).filter((r) => r.patient_id === patientId),
      bowel: bowel.data || [], meals: meals.data || [],
      schedule: sched.data || null, loaded: true,
    })
  }, [patientId, role])

  useEffect(() => {
    setState({ tasksDone: [], attendance: [], vitals: [], incidents: [], medications: [], exercisePlans: [], exercises: [], exerciseLog: [], handoverNotes: [], visitLog: [], overdue: [], bowel: [], meals: [], schedule: null, loaded: false })
    load()
    const refresh = () => { if (document.visibilityState === "visible") load() }
    document.addEventListener("visibilitychange", refresh)
    const timer = setInterval(load, 2 * 60 * 1000)
    return () => { document.removeEventListener("visibilitychange", refresh); clearInterval(timer) }
  }, [load])

  return { ...state, reload: load }
}
