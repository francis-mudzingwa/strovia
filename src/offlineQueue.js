// A check-in saved with no signal (a rural home, a lift, a bad patch) is kept on the phone and sent as soon as
// the connection returns, so it is never lost. Only check-ins are queued, and each is removed once it is sent.
const KEY = "strovia-pending-checkins"

function read() {
  try { return JSON.parse(localStorage.getItem(KEY) || "[]") } catch { return [] }
}
function write(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list)) } catch { /* storage may be blocked: nothing more to do */ }
}

// True when the failure is "no connection", as opposed to the server refusing the save.
export const isNetworkError = (error) =>
  !!error && (!navigator.onLine || (!error.code && /fetch|network|load failed/i.test(error.message || "")))

export function queueCheckin(userId, row) {
  const rest = read().filter((x) => !(x.userId === userId && x.row.patient_id === row.patient_id && x.row.entry_date === row.entry_date))
  write([...rest, { userId, row, queuedAt: new Date().toISOString() }])
}

export const pendingCount = (userId) => read().filter((x) => x.userId === userId).length

// Try to send everything waiting for this person. Returns how many were sent and how many were refused by the server.
export async function flushQueue(supabase, userId) {
  const mine = read().filter((x) => x.userId === userId)
  let sent = 0
  let refused = 0
  for (const item of mine) {
    const { error } = await supabase.from("checkins").upsert(item.row, { onConflict: "patient_id,entry_date" })
    if (error && isNetworkError(error)) break
    write(read().filter((x) => !(x.userId === userId && x.row.patient_id === item.row.patient_id && x.row.entry_date === item.row.entry_date)))
    if (error) refused++
    else sent++
  }
  return { sent, refused }
}
