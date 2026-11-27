import { useState, useEffect, useCallback } from "react"
import { supabase } from "../supabaseClient.js"

const pad = (n) => String(n).padStart(2, "0")
const localDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

// Everything the recovery progress screens need for one patient: every saved version of every check-in (so each person's
// check-in counts), the pain scores from readings, and the last two weeks of medicines, tasks, exercises and visit results.
// Each query that fails (for example a table that is not there yet) just comes back empty.
export function useProgress(patientId) {
  const [state, setState] = useState({ versions: [], vitals: [], medLog: [], taskLog: [], mealLog: [], exerciseLog: [], visitLog: [], loaded: false })

  const load = useCallback(async () => {
    if (!patientId) return
    const days = (n) => new Date(Date.now() - n * 24 * 3600 * 1000)
    const [versions, vitals, meds, tasks, ex, vlog, mealsRes] = await Promise.all([
      supabase.from("checkin_versions").select("entry_date, symptoms, feeling, recorded_by, saved_at").eq("patient_id", patientId).gte("entry_date", localDate(days(70))).order("saved_at", { ascending: true }),
      supabase.from("vitals").select("taken_at, pain_score").eq("patient_id", patientId).not("pain_score", "is", null).gte("taken_at", days(70).toISOString()),
      supabase.from("medication_log").select("med_name, scheduled_for, status, created_at").eq("patient_id", patientId).gte("created_at", days(17).toISOString()),
      supabase.from("task_log").select("task, task_date").eq("patient_id", patientId).gte("task_date", localDate(days(17))),
      supabase.from("exercise_log").select("exercise_id, log_date, slot, status, reason").eq("patient_id", patientId).gte("log_date", localDate(days(17))),
      supabase.from("visit_log").select("visit_id, occurred_on, status, reason").eq("patient_id", patientId).gte("occurred_on", localDate(days(17))),
      supabase.from("meal_log").select("log_date, meal, amount").eq("patient_id", patientId).gte("log_date", localDate(days(17))),
    ])
    setState({
      versions: versions.data || [], vitals: vitals.data || [], medLog: meds.data || [], taskLog: tasks.data || [], mealLog: mealsRes.data || [],
      exerciseLog: ex.data || [], visitLog: vlog.data || [], loaded: true,
    })
  }, [patientId])

  useEffect(() => {
    setState({ versions: [], vitals: [], medLog: [], taskLog: [], mealLog: [], exerciseLog: [], visitLog: [], loaded: false })
    load()
    const refresh = () => { if (document.visibilityState === "visible") load() }
    document.addEventListener("visibilitychange", refresh)
    const timer = setInterval(load, 3 * 60 * 1000)
    return () => { document.removeEventListener("visibilitychange", refresh); clearInterval(timer) }
  }, [load])

  return { ...state, reload: load }
}
