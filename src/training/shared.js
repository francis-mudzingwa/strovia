// Small helpers shared by the carer's and the administrator's Training screens.
const startOfToday = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()) }
export const daysUntil = (iso) => Math.round((new Date(`${iso}T00:00:00`) - startOfToday()) / 86400000)
export const niceDate = (iso) => new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })

// "Due in 12 days", "3 days overdue", "Due today", "No due date".
export function dueText(iso) {
  if (!iso) return "No due date"
  const d = daysUntil(iso)
  if (d < 0) return `${-d} ${d === -1 ? "day" : "days"} overdue`
  if (d === 0) return "Due today"
  if (d === 1) return "Due tomorrow"
  return `Due in ${d} days (${niceDate(iso)})`
}
export const isOverdue = (iso) => !!iso && daysUntil(iso) < 0

// A training that repeats creates the next round straight away, due a year later. Until it is within 30 days of its due date,
// it is "scheduled", not something to do: the carer is shown as up to date.
export function isScheduled(a, all) {
  return a.status === "assigned" && !!a.due_date && daysUntil(a.due_date) > 30
    && all.some((x) => x.training_id === a.training_id && x.user_id === a.user_id && x.status === "completed")
}

export const METHOD_LABEL = { upload: "Upload a completed copy", quiz: "Quiz in the app", in_person: "In person" }
export const REPEAT_LABEL = (m) => (m === 12 ? "every year" : m === 6 ? "every 6 months" : m ? `every ${m} months` : null)
