const pad = (n) => String(n).padStart(2, "0")

export const localDateStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export const localTimeStr = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`

export function startsAtFrom(date, time) {
  return new Date(`${date}T${time}`)
}

// The reminder rings the day before, at the chosen time of day.
export function reminderAtFor(start, remindTime) {
  const r = new Date(start)
  r.setDate(r.getDate() - 1)
  const [hh, mm] = remindTime.split(":").map(Number)
  r.setHours(hh, mm, 0, 0)
  return r
}

export function dayDiff(start, now = new Date()) {
  const a = new Date(start.getFullYear(), start.getMonth(), start.getDate())
  const b = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((a - b) / 86400000)
}

export function whenLabel(start, now = new Date()) {
  if (start.getTime() < now.getTime()) return "Past"
  const d = dayDiff(start, now)
  if (d === 0) return "Today"
  if (d === 1) return "Tomorrow"
  return `In ${d} days`
}

export const fmtApptDate = (d) => d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })
export const fmtApptTime = (d) => d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
export const fmtReminder = (d) => `${d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}, ${fmtApptTime(d)}`

export const mapsUrl = (address) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`

/* ---------------- "already rung" bookkeeping (per device) ---------------- */

// Two reminders per appointment: the day before (at the chosen time) and 2 hours before.
export function remindersFor(a) {
  if (!a.remind) return []
  const list = []
  if (a.reminder_at) list.push({ kind: "day", at: new Date(a.reminder_at) })
  list.push({ kind: "2h", at: new Date(new Date(a.starts_at).getTime() - 2 * 60 * 60 * 1000) })
  return list.sort((x, y) => x.at - y.at)
}

export const reminderKindLabel = (kind) => (kind === "day" ? "Day before" : "2 hours before")

// How to describe an appointment that is now close, however late the reminder actually reached us.
export function soonLabel(start, now = new Date()) {
  const mins = Math.round((start.getTime() - now.getTime()) / 60000)
  const days = dayDiff(start, now)
  if (days >= 2) return `in ${days} days`
  if (days === 1) return "tomorrow"
  if (mins > 135) return "today"
  if (mins >= 105) return "in 2 hours"
  if (mins >= 60) return `in about ${Math.round(mins / 60)} hour${Math.round(mins / 60) === 1 ? "" : "s"}`
  if (mins > 1) return `in ${mins} minutes`
  return "now"
}

const memoryDone = new Set()
const doneKey = (userKey, a, r) => `strovia.reminded.${userKey}.${a.id}.${r.kind}.${r.at.getTime()}`

export function isReminderDone(userKey, a, r) {
  const key = doneKey(userKey, a, r)
  if (memoryDone.has(key)) return true
  try { return localStorage.getItem(key) === "1" } catch { return false }
}

export function markReminderDone(userKey, a, r) {
  const key = doneKey(userKey, a, r)
  memoryDone.add(key)
  try { localStorage.setItem(key, "1") } catch { /* storage blocked: memory only */ }
}

/* ---------------- the ring ---------------- */

let audioCtx = null
let ringTimer = null
let ringStopTimer = null

export function primeAudio() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return
    if (!audioCtx) audioCtx = new AC()
    if (audioCtx.state === "suspended") audioCtx.resume()
  } catch { /* audio unavailable */ }
}

export const audioReady = () => !!audioCtx && audioCtx.state === "running"
export const isRinging = () => ringTimer !== null

function tone(freq, start, dur) {
  const osc = audioCtx.createOscillator()
  const gain = audioCtx.createGain()
  osc.type = "sine"
  osc.frequency.value = freq
  gain.gain.setValueAtTime(0, start)
  gain.gain.linearRampToValueAtTime(0.4, start + 0.02)
  gain.gain.setValueAtTime(0.4, start + dur - 0.04)
  gain.gain.linearRampToValueAtTime(0, start + dur)
  osc.connect(gain)
  gain.connect(audioCtx.destination)
  osc.start(start)
  osc.stop(start + dur)
}

function ringOnce() {
  if (!audioCtx || audioCtx.state !== "running") return
  const t = audioCtx.currentTime
  ;[0, 0.55].forEach((offset) => {
    tone(880, t + offset, 0.2)
    tone(1175, t + offset + 0.22, 0.2)
  })
}

export function stopRinging() {
  clearInterval(ringTimer)
  clearTimeout(ringStopTimer)
  ringTimer = null
  ringStopTimer = null
  try { navigator.vibrate?.(0) } catch { /* not supported */ }
}

export function startRinging(maxMs = 60000) {
  stopRinging()
  primeAudio()
  ringOnce()
  ringTimer = setInterval(ringOnce, 2200)
  ringStopTimer = setTimeout(stopRinging, maxMs)
  try { navigator.vibrate?.([400, 200, 400, 200, 400]) } catch { /* not supported */ }
}

export const notificationsSupported = () => typeof window !== "undefined" && "Notification" in window
export const notificationState = () => (notificationsSupported() ? Notification.permission : "unsupported")

export async function enableNotifications() {
  if (!notificationsSupported()) return "unsupported"
  if (Notification.permission === "default") return Notification.requestPermission()
  return Notification.permission
}

export function showNotification(title, body, tag) {
  try {
    if (notificationsSupported() && Notification.permission === "granted") {
      new Notification(title, { body, tag, requireInteraction: true })
    }
  } catch { /* some browsers only allow notifications from a service worker */ }
}

/* ---------------- calendar file (rings on the phone itself) ---------------- */

const icsDate = (d) =>
  `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`
const icsEscape = (s) =>
  String(s || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n")

export function buildIcs(a) {
  const start = new Date(a.starts_at)
  const end = new Date(start.getTime() + 60 * 60 * 1000)
  const bring = (a.bring_items || []).length ? `Bring: ${a.bring_items.join(", ")}` : ""
  const description = [bring, a.notes ? `Notes: ${a.notes}` : ""].filter(Boolean).join("\n")
  const title = `Appointment: ${a.doctor}${a.patient_name ? ` (${a.patient_name})` : ""}`
  const location = [a.place_name, a.address].filter(Boolean).join(", ")
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Strovia//Appointments//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${a.id}@strovia`,
    `DTSTAMP:${icsDate(new Date())}`,
    `DTSTART:${icsDate(start)}`,
    `DTEND:${icsDate(end)}`,
    `SUMMARY:${icsEscape(title)}`,
    `LOCATION:${icsEscape(location)}`,
    `DESCRIPTION:${icsEscape(description)}`,
    "BEGIN:VALARM",
    "TRIGGER:-P1D",
    "ACTION:DISPLAY",
    `DESCRIPTION:${icsEscape(`Tomorrow: ${title}`)}`,
    "END:VALARM",
    "BEGIN:VALARM",
    "TRIGGER:-PT2H",
    "ACTION:DISPLAY",
    `DESCRIPTION:${icsEscape(`In 2 hours: ${title}`)}`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ]
  return lines.join("\r\n")
}

export function downloadIcs(a) {
  const blob = new Blob([buildIcs(a)], { type: "text/calendar;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = `appointment-${localDateStr(new Date(a.starts_at))}.ics`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
