import { useState, useEffect, useRef, useCallback, useMemo } from "react"
import {
  CalendarDays, CalendarPlus, Bell, BellRing, MapPin, Clock, Trash2, Pencil,
  Plus, Volume2, Navigation, X, Check, ShoppingBag, StickyNote, Car,
} from "lucide-react"
import { supabase } from "./supabaseClient.js"
import { getPushState, enablePush, disablePush, sendTestPush, isIos, isInstalledApp } from "./push.js"
import {
  localDateStr, localTimeStr, startsAtFrom, reminderAtFor, whenLabel,
  fmtApptDate, fmtApptTime, fmtReminder, mapsUrl, downloadIcs,
  isReminderDone, markReminderDone, remindersFor, reminderKindLabel, soonLabel,
  primeAudio, audioReady, startRinging, stopRinging, isRinging,
  notificationState, enableNotifications, showNotification,
} from "./appointments.js"

const colors = {
  bg: "#FAF6EF", card: "#FFFFFF", hairline: "#E5DFD1", ink: "#20261F", inkSoft: "#5C6357", inkFaint: "#6B7266",
  sage: "#3F6C51", sageDeep: "#2C4E3A", sageTint: "#E3EBE0", gold: "#B98A2E", goldTint: "#F3E7CC",
  rust: "#A24632", rustTint: "#F3DAD2", teal: "#4C7A82", tealTint: "#E5EEEF",
}

const BRING_SUGGESTIONS = [
  "Insurance card", "Photo ID", "List of current medications", "Recent test results or scans",
  "Glasses or hearing aids", "Cane or walker", "Water and a snack", "Someone to come along",
]

const inputStyle = {
  width: "100%", padding: "10px 12px", borderRadius: 10, border: `1px solid ${colors.hairline}`,
  fontSize: 14, boxSizing: "border-box", background: "#fff", fontFamily: "inherit", color: colors.ink,
}
const labelStyle = { fontSize: 13, fontWeight: 600, color: colors.inkSoft, display: "block", marginBottom: 5 }

function Card({ children, style }) {
  return <div style={{ background: colors.card, borderRadius: 18, boxShadow: "0 1px 3px rgba(32,38,31,0.06), 0 6px 16px rgba(32,38,31,0.05)", padding: 18, ...style }}>{children}</div>
}

/* ---------------- data ---------------- */

export function useAppointments(userId) {
  const [appointments, setAppointments] = useState([])
  const [loading, setLoading] = useState(!!userId)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    supabase
      .from("appointments")
      .select("*")
      .order("starts_at", { ascending: true })
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) setError("Couldn't load appointments. Check your connection and try again.")
        else setAppointments(data || [])
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [userId])

  const sortByStart = (list) => [...list].sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at))

  // Reminder times already gone by when an appointment is saved late must not ring; this has to
  // happen before the new list is published, or the reminder check would ring them straight away.
  function skipPastReminders(row) {
    remindersFor(row)
      .filter((r) => r.at.getTime() <= Date.now())
      .forEach((r) => markReminderDone(userId || "local", row, r))
  }

  async function save(fields, id) {
    if (!userId) {
      const row = { ...fields, id: id || crypto.randomUUID(), created_by: null }
      skipPastReminders(row)
      setAppointments((prev) => sortByStart([...prev.filter((a) => a.id !== row.id), row]))
      return { data: row }
    }
    const query = id
      ? supabase.from("appointments").update(fields).eq("id", id).select().single()
      : supabase.from("appointments").insert({ ...fields, created_by: userId }).select().single()
    const { data, error } = await query
    if (error) return { error: error.message }
    skipPastReminders(data)
    setAppointments((prev) => sortByStart([...prev.filter((a) => a.id !== data.id), data]))
    return { data }
  }

  async function remove(id) {
    if (userId) {
      const { error } = await supabase.from("appointments").delete().eq("id", id)
      if (error) return { error: error.message }
    }
    setAppointments((prev) => prev.filter((a) => a.id !== id))
    return {}
  }

  return { appointments, loading, error, save, remove }
}

/* ---------------- the ringing reminder ---------------- */

export function useReminderAlarm(appointments, userKey) {
  const [alarm, setAlarm] = useState(null)
  const alarmRef = useRef(null)
  const listRef = useRef(appointments)
  const snoozed = useRef({})
  listRef.current = appointments

  const check = useCallback(() => {
    if (alarmRef.current) return
    const now = Date.now()
    const due = []
    for (const a of listRef.current) {
      if (new Date(a.starts_at).getTime() <= now || snoozed.current[a.id] > now) continue
      // A reminder time that had already passed when the appointment was created never rings (on any device).
      const created = a.created_at ? new Date(a.created_at).getTime() : 0
      const ready = remindersFor(a).filter((r) => r.at.getTime() <= now && r.at.getTime() >= created && !isReminderDone(userKey, a, r))
      if (ready.length) due.push({ appt: a, ready })
    }
    if (!due.length) return
    due.sort((x, y) => new Date(x.appt.starts_at) - new Date(y.appt.starts_at))
    const next = due[0]
    alarmRef.current = next
    setAlarm(next)
    startRinging()
    const start = new Date(next.appt.starts_at)
    showNotification(
      `Appointment ${soonLabel(start)}: ${next.appt.doctor}`,
      `${fmtApptDate(start)} at ${fmtApptTime(start)} — ${next.appt.address}`,
      next.appt.id,
    )
  }, [userKey])

  useEffect(() => {
    check()
    const timer = setInterval(check, 20000)
    // Background tabs get their timers slowed down by the browser, so re-check the moment the person returns.
    const onVisible = () => { if (!document.hidden) check() }
    document.addEventListener("visibilitychange", onVisible)
    window.addEventListener("focus", check)
    // The service worker pings us when a push arrives while Strovia is on screen.
    const sw = "serviceWorker" in navigator ? navigator.serviceWorker : null
    const onMessage = (e) => { if (e.data?.type === "reminder-push") check() }
    sw?.addEventListener("message", onMessage)
    return () => {
      clearInterval(timer)
      document.removeEventListener("visibilitychange", onVisible)
      window.removeEventListener("focus", check)
      sw?.removeEventListener("message", onMessage)
    }
  }, [check, appointments])

  // Browsers keep sound off until the person has touched the page; the first tap unlocks it.
  useEffect(() => {
    const unlock = () => {
      primeAudio()
      if (alarmRef.current && !isRinging() && audioReady()) startRinging()
    }
    window.addEventListener("pointerdown", unlock)
    window.addEventListener("keydown", unlock)
    return () => {
      window.removeEventListener("pointerdown", unlock)
      window.removeEventListener("keydown", unlock)
      stopRinging()
    }
  }, [])

  function close() {
    stopRinging()
    alarmRef.current = null
    setAlarm(null)
    setTimeout(check, 0)
  }

  function dismiss() {
    const current = alarmRef.current
    // Acknowledging the latest reminder also clears any earlier one that was still waiting.
    if (current) current.ready.forEach((r) => markReminderDone(userKey, current.appt, r))
    close()
  }

  function snooze(minutes = 30) {
    if (alarmRef.current) snoozed.current[alarmRef.current.appt.id] = Date.now() + minutes * 60000
    close()
  }

  return { alarm, dismiss, snooze }
}

export function ReminderAlarm({ alarm, onDismiss, onSnooze }) {
  const [, force] = useState(0)
  useEffect(() => {
    if (!alarm) return
    const t = setInterval(() => force((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [alarm])
  if (!alarm) return null

  const a = alarm.appt
  const start = new Date(a.starts_at)
  const label = `Appointment ${soonLabel(start)}`
  const silent = !audioReady()

  return (
    <div role="alertdialog" aria-label={label} style={{ position: "fixed", inset: 0, background: "rgba(32,38,31,0.55)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <style>{`@keyframes stroviaRing { 0%,100% { transform: rotate(0) } 15% { transform: rotate(16deg) } 30% { transform: rotate(-14deg) } 45% { transform: rotate(10deg) } 60% { transform: rotate(-8deg) } 75% { transform: rotate(0) } }`}</style>
      <div style={{ background: "#fff", borderRadius: 22, padding: 24, width: "100%", maxWidth: 400, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 20px 50px rgba(0,0,0,0.3)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
          <div style={{ width: 52, height: 52, borderRadius: 16, background: colors.goldTint, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <BellRing size={26} color={colors.gold} style={{ animation: "stroviaRing 1.2s ease-in-out infinite", transformOrigin: "50% 10%" }} />
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#7A5A12", textTransform: "uppercase", letterSpacing: 0.5 }}>Reminder</div>
            <div style={{ fontFamily: "Fraunces, Georgia, serif", fontSize: 21, fontWeight: 600, color: colors.ink }}>{label}</div>
          </div>
        </div>

        <div style={{ background: colors.bg, borderRadius: 14, padding: 14, marginBottom: 14 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: colors.ink }}>{a.doctor}{a.specialty ? ` · ${a.specialty}` : ""}</div>
          {a.patient_name && <div style={{ fontSize: 13, color: colors.inkSoft, marginTop: 2 }}>For {a.patient_name}</div>}
          <div style={{ fontSize: 13.5, color: colors.ink, marginTop: 8 }}>{fmtApptDate(start)} at <strong>{fmtApptTime(start)}</strong></div>
          <div style={{ fontSize: 13.5, color: colors.ink, marginTop: 4 }}>{[a.place_name, a.address].filter(Boolean).join(", ")}</div>
          {(a.bring_items || []).length > 0 && (
            <div style={{ fontSize: 13, color: colors.inkSoft, marginTop: 8 }}><strong>Bring:</strong> {a.bring_items.join(", ")}</div>
          )}
          {a.notes && <div style={{ fontSize: 13, color: colors.inkSoft, marginTop: 6 }}><strong>Notes:</strong> {a.notes}</div>}
        </div>

        {silent && (
          <button
            onClick={() => { primeAudio(); startRinging() }}
            style={{ width: "100%", padding: "10px 0", borderRadius: 10, border: `1px solid ${colors.gold}`, background: colors.goldTint, color: colors.ink, fontSize: 13, fontWeight: 700, cursor: "pointer", marginBottom: 10, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
          >
            <Volume2 size={15} /> Tap to turn the ring on
          </button>
        )}

        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onDismiss} style={{ flex: 1, padding: "13px 0", borderRadius: 12, border: "none", background: colors.sage, color: "#fff", fontSize: 15, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
            <Check size={17} /> Got it
          </button>
          <button onClick={() => onSnooze(30)} style={{ padding: "13px 16px", borderRadius: 12, border: `1px solid ${colors.hairline}`, background: "#fff", color: colors.inkSoft, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
            Snooze 30 min
          </button>
        </div>
      </div>
    </div>
  )
}

/* ---------------- one appointment ---------------- */

export function AppointmentCard({ appt, readOnly, onEdit, onDelete, userKey, escortName, onEscort }) {
  const [confirming, setConfirming] = useState(false)
  const start = new Date(appt.starts_at)
  const past = start.getTime() < Date.now()
  const label = whenLabel(start)
  const badgeColor = past ? colors.inkFaint : label === "Today" || label === "Tomorrow" ? colors.rust : colors.sage
  const reminders = remindersFor(appt)

  return (
    <Card style={{ marginBottom: 12, opacity: past ? 0.75 : 1 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 15.5, fontWeight: 700, color: colors.ink }}>{appt.doctor}</div>
          <div style={{ fontSize: 13, color: colors.inkFaint, marginTop: 1 }}>
            {[appt.specialty, appt.patient_name && `for ${appt.patient_name}`].filter(Boolean).join(" · ")}
          </div>
        </div>
        <span style={{ flexShrink: 0, fontSize: 12.5, fontWeight: 700, color: "#fff", background: badgeColor, padding: "3px 11px", borderRadius: 999 }}>{label}</span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <Clock size={15} color={colors.inkFaint} style={{ flexShrink: 0 }} />
        <span style={{ fontSize: 13.5, color: colors.ink }}>{fmtApptDate(start)} at <strong>{fmtApptTime(start)}</strong></span>
      </div>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 6 }}>
        <MapPin size={15} color={colors.inkFaint} style={{ flexShrink: 0, marginTop: 2 }} />
        <span style={{ fontSize: 13.5, color: colors.ink, lineHeight: 1.45 }}>
          {appt.place_name && <strong>{appt.place_name}<br /></strong>}
          {appt.address}{" "}
          <a href={mapsUrl(appt.address)} target="_blank" rel="noreferrer" style={{ color: colors.sageDeep, fontWeight: 600, whiteSpace: "nowrap" }}>
            <Navigation size={11} style={{ verticalAlign: "-1px" }} /> Directions
          </a>
        </span>
      </div>

      {(appt.bring_items || []).length > 0 && (
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginTop: 10 }}>
          <ShoppingBag size={15} color={colors.inkFaint} style={{ flexShrink: 0, marginTop: 2 }} />
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: colors.inkFaint, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 4 }}>What to bring</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {appt.bring_items.map((item) => (
                <span key={item} style={{ fontSize: 13, color: colors.ink, background: colors.sageTint, padding: "3px 10px", borderRadius: 999 }}>{item}</span>
              ))}
            </div>
          </div>
        </div>
      )}

      {!past && onEscort && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          <Car size={15} color={colors.inkFaint} style={{ flexShrink: 0 }} />
          <span style={{ fontSize: 13.5, color: colors.ink }}>
            Taking them: {escortName ? <strong>{escortName}</strong> : <span style={{ color: colors.inkFaint }}>nobody yet</span>}
          </span>
          {appt.escort_id && appt.escort_id === userKey ? (
            <button onClick={() => onEscort(appt, null)} style={smallButton}>I can't after all</button>
          ) : (
            <button onClick={() => onEscort(appt, userKey)} style={smallButton}>{appt.escort_id ? "I'll take them instead" : "I'll take them"}</button>
          )}
        </div>
      )}

      {appt.notes && (
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginTop: 10 }}>
          <StickyNote size={15} color={colors.inkFaint} style={{ flexShrink: 0, marginTop: 2 }} />
          <span style={{ fontSize: 13, color: colors.inkSoft, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{appt.notes}</span>
        </div>
      )}

      {!past && (
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginTop: 12, padding: "8px 10px", borderRadius: 10, background: colors.goldTint }}>
          <Bell size={14} color={colors.gold} style={{ flexShrink: 0, marginTop: 2 }} />
          <div style={{ fontSize: 13, color: colors.ink, lineHeight: 1.6 }}>
            {reminders.length === 0 ? "No reminders" : reminders.map((r) => {
              const rang = r.at.getTime() <= Date.now() && (userKey ? isReminderDone(userKey, appt, r) : true)
              return (
                <div key={r.kind}>
                  <strong>{reminderKindLabel(r.kind)}:</strong> {rang ? "rang" : "rings"} {fmtReminder(r.at)}
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        {!past && (
          <button onClick={() => downloadIcs(appt)} style={smallButton}>
            <CalendarPlus size={13} /> Add to phone calendar
          </button>
        )}
        {!readOnly && (
          <>
            <button onClick={() => onEdit(appt)} style={smallButton}><Pencil size={13} /> Edit</button>
            {confirming ? (
              <>
                <button onClick={() => onDelete(appt.id)} style={{ ...smallButton, background: colors.rust, color: "#fff", border: "none" }}>Yes, delete</button>
                <button onClick={() => setConfirming(false)} style={smallButton}>Keep</button>
              </>
            ) : (
              <button onClick={() => setConfirming(true)} style={{ ...smallButton, color: colors.rust }}><Trash2 size={13} /> Delete</button>
            )}
          </>
        )}
      </div>
    </Card>
  )
}

const smallButton = {
  border: `1px solid ${colors.hairline}`, background: "#fff", borderRadius: 9, padding: "7px 12px",
  fontSize: 13, fontWeight: 600, color: colors.inkSoft, cursor: "pointer", display: "flex", alignItems: "center", gap: 6,
}

/* ---------------- sound + notification controls ---------------- */

export function ReminderSettings({ style }) {
  const [testing, setTesting] = useState(false)
  const [pushState, setPushState] = useState("checking")
  const [pushBusy, setPushBusy] = useState(false)
  const [pushMessage, setPushMessage] = useState(null)

  useEffect(() => {
    let cancelled = false
    getPushState().then((s) => { if (!cancelled) setPushState(s) })
    return () => { cancelled = true }
  }, [])

  function testRing() {
    primeAudio()
    startRinging(3000)
    setTesting(true)
    setTimeout(() => setTesting(false), 3000)
  }

  async function turnOn() {
    setPushBusy(true)
    setPushMessage(null)
    const result = await enablePush()
    setPushState(result.state)
    if (result.error) setPushMessage(result.error)
    setPushBusy(false)
  }

  async function turnOff() {
    setPushBusy(true)
    setPushState(await disablePush())
    setPushMessage(null)
    setPushBusy(false)
  }

  async function sendTest() {
    setPushBusy(true)
    setPushMessage(null)
    const result = await sendTestPush()
    setPushMessage(result.error || (result.sent > 0
      ? `Sent to ${result.sent} device${result.sent === 1 ? "" : "s"}. It should appear within a few seconds.`
      : "Nothing was sent: no device has alerts turned on for this account."))
    setPushBusy(false)
  }

  const needsInstall = pushState === "unsupported" && isIos() && !isInstalledApp()

  return (
    <Card style={style}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <BellRing size={16} color={colors.gold} />
        <span style={{ fontSize: 14, fontWeight: 700, color: colors.ink }}>Reminder alerts</span>
      </div>
      <p style={{ fontSize: 13, color: colors.inkSoft, lineHeight: 1.55, margin: "0 0 12px" }}>
        Strovia alerts you the day before and again 2 hours before each appointment. While Strovia is open it rings and shows
        the details. Turn on <strong>alerts when Strovia is closed</strong> below and this device will also get a notification with
        its normal alert sound, even if the browser tab is closed.
      </p>

      <div style={{ background: colors.bg, borderRadius: 12, padding: 12, marginBottom: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: colors.ink, marginBottom: 4 }}>
          Alerts when Strovia is closed on this device:{" "}
          <span style={{ color: pushState === "on" ? colors.sage : colors.inkFaint }}>
            {pushState === "on" ? "On" : pushState === "checking" ? "…" : "Off"}
          </span>
        </div>
        {pushState === "unsupported" && (
          <div style={{ fontSize: 13, color: colors.inkSoft, lineHeight: 1.5 }}>
            {needsInstall
              ? "On iPhone and iPad, first add Strovia to your Home Screen (Share button, then Add to Home Screen), open it from there, and come back to this page."
              : "This browser doesn't support alerts when the page is closed. Try Chrome, Edge or Firefox, or use Add to phone calendar on an appointment."}
          </div>
        )}
        {pushState === "denied" && (
          <div style={{ fontSize: 13, color: colors.inkSoft, lineHeight: 1.5 }}>
            Notifications are blocked for this site. Allow them in the browser's site settings, then reload this page.
          </div>
        )}
        {(pushState === "off" || pushState === "on") && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
            {pushState === "off" ? (
              <button onClick={turnOn} disabled={pushBusy} style={{ ...smallButton, background: colors.sage, color: "#fff", border: "none" }}>
                <Bell size={13} /> {pushBusy ? "Turning on..." : "Turn on alerts on this device"}
              </button>
            ) : (
              <>
                <button onClick={sendTest} disabled={pushBusy} style={smallButton}>
                  <BellRing size={13} /> {pushBusy ? "Sending..." : "Send a test alert"}
                </button>
                <button onClick={turnOff} disabled={pushBusy} style={smallButton}>Turn off</button>
              </>
            )}
          </div>
        )}
        {pushMessage && <div style={{ fontSize: 13, color: colors.inkSoft, marginTop: 8, lineHeight: 1.45 }}>{pushMessage}</div>}
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button onClick={testRing} style={smallButton}>
          <Volume2 size={13} /> {testing ? "Ringing..." : "Test the in-app ring"}
        </button>
      </div>
      <p style={{ fontSize: 12.5, color: colors.inkFaint, lineHeight: 1.5, margin: "10px 0 0" }}>
        Alerts follow the account that turned them on last on this device. Use <strong>Add to phone calendar</strong> on an
        appointment if you also want your phone's own calendar to alert you.
      </p>
    </Card>
  )
}

/* ---------------- the appointments page ---------------- */

const emptyForm = (patientName) => ({
  patientName: patientName || "", doctor: "", specialty: "", date: "", time: "",
  placeName: "", address: "", notes: "", bringItems: [], customItem: "", remind: true, remindTime: "09:00",
})

function formFromAppointment(a) {
  const start = new Date(a.starts_at)
  return {
    patientName: a.patient_name || "", doctor: a.doctor || "", specialty: a.specialty || "",
    date: localDateStr(start), time: localTimeStr(start),
    placeName: a.place_name || "", address: a.address || "", notes: a.notes || "",
    bringItems: a.bring_items || [], customItem: "",
    remind: a.remind, remindTime: a.reminder_at ? localTimeStr(new Date(a.reminder_at)) : "09:00",
  }
}

export function AppointmentsView({ patient, appointments, loading, loadError, save, remove, userKey, nameFor }) {
  const [editing, setEditing] = useState(null) // null | "new" | appointment id
  const [form, setForm] = useState(() => emptyForm(patient?.name))
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [showPast, setShowPast] = useState(false)
  const [notifState, setNotifState] = useState(notificationState())

  const { upcoming, past } = useMemo(() => {
    const now = Date.now()
    return {
      upcoming: appointments.filter((a) => new Date(a.starts_at).getTime() >= now),
      past: appointments.filter((a) => new Date(a.starts_at).getTime() < now).reverse(),
    }
  }, [appointments])

  const setField = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))
  const toggleItem = (item) => setForm((f) => ({
    ...f, bringItems: f.bringItems.includes(item) ? f.bringItems.filter((i) => i !== item) : [...f.bringItems, item],
  }))

  function openNew() {
    setForm(emptyForm(patient?.name))
    setError(null)
    setEditing("new")
  }

  function openEdit(a) {
    setForm(formFromAppointment(a))
    setError(null)
    setEditing(a.id)
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  function addCustomItem() {
    const item = form.customItem.trim()
    if (!item) return
    setForm((f) => ({ ...f, bringItems: f.bringItems.includes(item) ? f.bringItems : [...f.bringItems, item], customItem: "" }))
  }

  async function submit(e) {
    e.preventDefault()
    setError(null)
    const start = startsAtFrom(form.date, form.time)
    if (Number.isNaN(start.getTime())) { setError("Choose a date and time."); return }
    if (editing === "new" && start.getTime() <= Date.now()) { setError("Choose a date and time in the future."); return }

    const reminder = form.remind ? reminderAtFor(start, form.remindTime || "09:00") : null
    const fields = {
      patient_id: patient.id,
      patient_name: patient.name,
      doctor: form.doctor.trim(),
      specialty: form.specialty.trim() || null,
      starts_at: start.toISOString(),
      place_name: form.placeName.trim() || null,
      address: form.address.trim(),
      notes: form.notes.trim() || null,
      bring_items: form.bringItems,
      remind: form.remind,
      reminder_at: reminder ? reminder.toISOString() : null,
    }
    setBusy(true)
    const { data, error: saveError } = await save(fields, editing === "new" ? undefined : editing)
    setBusy(false)
    if (saveError) { setError(saveError); return }
    if (form.remind && notificationState() === "default") enableNotifications().then(setNotifState)
    primeAudio()
    setEditing(null)
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 4 }}>
        <h1 style={{ fontFamily: "Fraunces, Georgia, serif", fontSize: 23, fontWeight: 600, color: colors.ink, margin: 0 }}>Appointments</h1>
        {!editing && (
          <button onClick={openNew} style={{ padding: "10px 16px", borderRadius: 11, border: "none", background: colors.sage, color: "#fff", fontSize: 13.5, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
            <Plus size={16} /> Add appointment
          </button>
        )}
      </div>
      <p style={{ fontSize: 13, color: colors.inkFaint, margin: "0 0 16px" }}>
        Keep track of doctor visits, with reminders the day before and 2 hours before.
      </p>

      {editing && (
        <Card style={{ marginBottom: 18 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <h2 style={{ fontFamily: "Fraunces, Georgia, serif", fontSize: 18, fontWeight: 600, color: colors.ink, margin: 0 }}>
              {editing === "new" ? "New appointment" : "Edit appointment"}
            </h2>
            <button onClick={() => setEditing(null)} aria-label="Close" style={{ border: "none", background: "none", cursor: "pointer", color: colors.inkFaint, display: "flex" }}><X size={19} /></button>
          </div>
          <form onSubmit={submit}>
            <div style={{ marginBottom: 12 }}>
              <label style={labelStyle}>Patient</label>
              <input value={patient.name} readOnly style={{ ...inputStyle, background: colors.bg }} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
              <div>
                <label style={labelStyle}>Doctor</label>
                <input required value={form.doctor} onChange={setField("doctor")} placeholder="Dr. Priya Raman" style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Specialty (optional)</label>
                <input value={form.specialty} onChange={setField("specialty")} placeholder="Neurology" style={inputStyle} />
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
              <div>
                <label style={labelStyle}>Date</label>
                <input required type="date" value={form.date} onChange={setField("date")} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Time</label>
                <input required type="time" value={form.time} onChange={setField("time")} style={inputStyle} />
              </div>
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={labelStyle}>Place (optional)</label>
              <input value={form.placeName} onChange={setField("placeName")} placeholder="Riverside Neurology Clinic, Suite 4" style={inputStyle} />
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>Address</label>
              <input required value={form.address} onChange={setField("address")} placeholder="120 Main Street, Worcester, MA 01608" style={inputStyle} />
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>What to bring</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginBottom: 8 }}>
                {[...BRING_SUGGESTIONS, ...form.bringItems.filter((i) => !BRING_SUGGESTIONS.includes(i))].map((item) => {
                  const on = form.bringItems.includes(item)
                  return (
                    <button
                      key={item}
                      type="button"
                      onClick={() => toggleItem(item)}
                      style={{ padding: "6px 12px", borderRadius: 999, fontSize: 13, fontWeight: 600, cursor: "pointer", border: `1px solid ${on ? colors.sage : colors.hairline}`, background: on ? colors.sage : "#fff", color: on ? "#fff" : colors.inkSoft }}
                    >
                      {on ? "✓ " : ""}{item}
                    </button>
                  )
                })}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  value={form.customItem}
                  onChange={setField("customItem")}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCustomItem() } }}
                  placeholder="Something else to bring"
                  style={inputStyle}
                />
                <button type="button" onClick={addCustomItem} style={{ ...smallButton, flexShrink: 0 }}>Add</button>
              </div>
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>Extra notes (optional)</label>
              <textarea
                value={form.notes}
                onChange={setField("notes")}
                rows={3}
                placeholder="e.g. No food after midnight. Ask about the new blood pressure medication."
                style={{ ...inputStyle, resize: "vertical" }}
              />
            </div>

            <div style={{ background: colors.goldTint, borderRadius: 12, padding: 12, marginBottom: 16 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 9, cursor: "pointer", fontSize: 13.5, fontWeight: 700, color: colors.ink }}>
                <input type="checkbox" checked={form.remind} onChange={(e) => setForm((f) => ({ ...f, remind: e.target.checked }))} style={{ width: 17, height: 17, accentColor: colors.sage }} />
                <Bell size={15} color={colors.gold} /> Remind me the day before and 2 hours before
              </label>
              {form.remind && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 13, color: colors.inkSoft }}>Day-before reminder rings at</span>
                    <input type="time" required value={form.remindTime} onChange={setField("remindTime")} style={{ ...inputStyle, width: "auto" }} />
                  </div>
                  {form.date && form.time && !Number.isNaN(startsAtFrom(form.date, form.time).getTime()) && (
                    <div style={{ fontSize: 13, color: colors.inkSoft, marginTop: 8, lineHeight: 1.6 }}>
                      <div>1. {fmtReminder(reminderAtFor(startsAtFrom(form.date, form.time), form.remindTime || "09:00"))} (day before)</div>
                      <div>2. {fmtReminder(new Date(startsAtFrom(form.date, form.time).getTime() - 2 * 3600 * 1000))} (2 hours before)</div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div style={{ display: "flex", gap: 10 }}>
              <button type="submit" disabled={busy} style={{ flex: 1, padding: "13px 0", borderRadius: 12, border: "none", background: colors.sage, color: "#fff", fontSize: 14.5, fontWeight: 700, cursor: busy ? "default" : "pointer", opacity: busy ? 0.7 : 1 }}>
                {busy ? "Saving..." : "Save appointment"}
              </button>
              <button type="button" onClick={() => setEditing(null)} style={{ padding: "13px 18px", borderRadius: 12, border: `1px solid ${colors.hairline}`, background: "#fff", color: colors.inkSoft, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
                Cancel
              </button>
            </div>
            {error && <p style={{ color: colors.rust, fontSize: 13, margin: "10px 0 0" }}>{error}</p>}
          </form>
        </Card>
      )}

      {loadError && <p style={{ color: colors.rust, fontSize: 13 }}>{loadError}</p>}

      {loading ? (
        <p style={{ fontSize: 13.5, color: colors.inkFaint }}>Loading appointments...</p>
      ) : (
        <>
          {upcoming.length === 0 && !editing && (
            <Card style={{ textAlign: "center", padding: 28, marginBottom: 14 }}>
              <CalendarDays size={30} color={colors.sageDeep} style={{ marginBottom: 8 }} />
              <div style={{ fontSize: 14.5, fontWeight: 700, color: colors.ink, marginBottom: 4 }}>No upcoming appointments</div>
              <div style={{ fontSize: 13, color: colors.inkFaint }}>Tap "Add appointment" to add the doctor, time and address.</div>
            </Card>
          )}
          {upcoming.map((a) => (
            <AppointmentCard
              key={a.id} appt={a} onEdit={openEdit} onDelete={remove} userKey={userKey}
              escortName={a.escort_id ? (a.escort_id === userKey ? "You" : nameFor?.(patient.id, a.escort_id) || "A member of the care team") : null}
              onEscort={userKey ? (appt, uid) => save({ escort_id: uid }, appt.id) : undefined}
            />
          ))}

          {past.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <button onClick={() => setShowPast((v) => !v)} style={{ border: "none", background: "none", color: colors.sageDeep, fontSize: 13, fontWeight: 700, cursor: "pointer", padding: "4px 0", marginBottom: 8 }}>
                {showPast ? "Hide" : "Show"} past appointments ({past.length})
              </button>
              {showPast && past.map((a) => (
                <AppointmentCard key={a.id} appt={a} onEdit={openEdit} onDelete={remove} userKey={userKey} />
              ))}
            </div>
          )}
        </>
      )}

      <ReminderSettings style={{ marginTop: 6 }} />
    </div>
  )
}
