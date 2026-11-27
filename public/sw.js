// Strovia service worker: shows appointment reminders pushed from the server,
// even when no Strovia tab is open.

self.addEventListener("install", () => self.skipWaiting())
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()))

function dayDiff(start, now) {
  const a = new Date(start.getFullYear(), start.getMonth(), start.getDate())
  const b = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((a - b) / 86400000)
}

// Alerts about something that happened. They say only what happened and to whom; the details are inside the app.
const EVENT_TEXT = {
  severe: (n) => ({ title: `Severe symptoms recorded for ${n}`, body: "Open Strovia to see what was noted and what was done." }),
  action_recorded: (n) => ({ title: `Action recorded for ${n}`, body: "Someone wrote down what was done about severe symptoms." }),
  incident: (n, d) => ({ title: `Incident reported for ${n}`, body: d.label || "Open Strovia for details." }),
  reading: (n) => ({ title: `A reading for ${n} is outside the care team's range`, body: "Open Strovia to see it." }),
  care_plan: (n) => ({ title: `The care plan for ${n} was changed`, body: "Open Strovia to see what changed." }),
  medication_refused: (n, d) => ({ title: `${n} refused a dose`, body: d.label ? `${d.label} was not taken.` : "Open Strovia for details." }),
  medication_missed: (n, d) => ({ title: `A dose was missed for ${n}`, body: d.label ? `${d.label} is overdue and hasn't been given.` : "A scheduled dose is overdue." }),
  medication_due: (n, d) => ({ title: `Medication due for ${n}`, body: d.label ? `${d.label} is due now.` : "A dose is due now." }),
  question: (n) => ({ title: `A question about ${n}`, body: "Someone asked the care team a question." }),
  reading_urgent: (n) => ({ title: `URGENT reading for ${n}`, body: "Open Strovia to see it, then call the office." }),
  reading_urgent_repeat: (n) => ({ title: `Still not checked: urgent reading for ${n}`, body: "Nobody has written down what was done yet." }),
  bowel_blood: (n) => ({ title: `Blood or black stool recorded for ${n}`, body: "Open Strovia to see it, then call the office." }),
  reading_overdue: (n, d) => ({ title: `A reading is overdue for ${n}`, body: d.label ? `${d.label}: not recorded when it was due.` : "A reading was not recorded when it was due." }),
  message_urgent: (n, d) => ({ title: `Urgent message from ${d.by || "a colleague"}`, body: "Open Strovia, then Messages, to read it." }),
}

function describe(data) {
  if (EVENT_TEXT[data.kind]) return EVENT_TEXT[data.kind](data.patient_name || "a patient", data)
  const start = new Date(data.starts_at)
  const when = `${start.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} at ${start.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`
  let title
  if (data.kind === "test") {
    return { title: "Strovia test alert", body: "Alerts are working on this device." }
  }
  if (data.kind === "2h") {
    title = `Appointment in 2 hours: ${data.doctor}`
  } else {
    const days = dayDiff(start, new Date())
    title = `Appointment ${days === 1 ? "tomorrow" : days === 0 ? "today" : "coming up"}: ${data.doctor}`
  }
  const where = [data.place_name, data.address].filter(Boolean).join(", ")
  const forWho = data.patient_name ? ` for ${data.patient_name}` : ""
  return { title, body: `${when}${forWho}${where ? ` — ${where}` : ""}` }
}

self.addEventListener("push", (event) => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch { /* no payload */ }

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true })
    const visible = windows.filter((w) => w.visibilityState === "visible")
    // If Strovia is on screen, its own in-page alarm rings; nudge it to check right now.
    if (visible.length && data.kind !== "test" && !EVENT_TEXT[data.kind]) {
      visible.forEach((w) => w.postMessage({ type: "reminder-push" }))
      return
    }
    const { title, body } = describe(data)
    await self.registration.showNotification(title, {
      body,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: `${data.appointment_id || data.patient_id || "strovia"}-${data.kind || "alert"}`,
      renotify: true,
      requireInteraction: true,
      vibrate: [400, 200, 400, 200, 400],
      data: { url: "/" },
    })
  })())
})

self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  const target = (event.notification.data && event.notification.data.url) || "/"
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true })
    for (const w of windows) {
      if ("focus" in w) { await w.focus(); w.postMessage({ type: "reminder-push" }); return }
    }
    await self.clients.openWindow(target)
  })())
})
