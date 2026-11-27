// Sends appointment reminders as web push notifications.
//  - Called every minute by pg_cron (header x-cron-secret): pushes any reminder that has just come due.
//  - Called from the app by a signed-in user with {"action":"test"}: pushes a test alert to that user's devices.
import { createClient } from "npm:@supabase/supabase-js@2"
import webpush from "npm:web-push@3.6.7"

// See company-login's SERVICE_ROLE_KEY_OVERRIDE comment / memory: service-role-key-outage.
const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SERVICE_ROLE_KEY_OVERRIDE") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!)

webpush.setVapidDetails(
  Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@example.com",
  Deno.env.get("VAPID_PUBLIC_KEY")!,
  Deno.env.get("VAPID_PRIVATE_KEY")!,
)

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
}

const HOUR = 3600 * 1000
// A reminder is only sent if it came due recently; anything older was missed and would just confuse.
const MAX_LATE_MS = 3 * HOUR

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } })

type Sub = { endpoint: string; p256dh: string; auth: string; user_id: string }

async function push(subs: Sub[], payload: Record<string, unknown>) {
  let sent = 0
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(payload),
        { TTL: 6 * 3600, urgency: "high" },
      )
      sent++
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode
      // 404/410 mean the device has unsubscribed for good: forget it.
      if (status === 404 || status === 410) await supabase.from("push_subscriptions").delete().eq("endpoint", s.endpoint)
      else console.error("push failed", status, (err as Error).message)
    }
  }))
  return sent
}

async function subscriptionsFor(userIds: string[]): Promise<Sub[]> {
  if (!userIds.length) return []
  const { data } = await supabase.from("push_subscriptions").select("endpoint, p256dh, auth, user_id").in("user_id", userIds)
  return (data ?? []) as Sub[]
}

async function runDueReminders() {
  const now = Date.now()
  const { data: appts, error } = await supabase
    .from("appointments")
    .select("*")
    .eq("remind", true)
    .gt("starts_at", new Date(now).toISOString())
    .lt("starts_at", new Date(now + 4 * 24 * HOUR).toISOString())
  if (error) return { error: error.message }

  let due = 0
  let sent = 0
  for (const a of appts ?? []) {
    const start = new Date(a.starts_at).getTime()
    const created = new Date(a.created_at).getTime()
    const reminders = [
      a.reminder_at ? { kind: "day", at: new Date(a.reminder_at).getTime() } : null,
      { kind: "2h", at: start - 2 * HOUR },
    ].filter(Boolean) as { kind: string; at: number }[]

    // No reminders for an archived patient.
    const { data: patient } = await supabase.from("patients").select("archived_at").eq("id", a.patient_id).maybeSingle()
    if (patient?.archived_at) continue

    for (const r of reminders) {
      // Not due yet, missed long ago, or already past when the appointment was created.
      if (r.at > now || now - r.at > MAX_LATE_MS || r.at < created) continue

      // The unique key makes this a claim: only the run that inserts the row sends.
      const { error: claimError } = await supabase
        .from("reminder_sends")
        .insert({ appointment_id: a.id, kind: r.kind, reminder_at: new Date(r.at).toISOString() })
      if (claimError) continue
      due++

      // Everyone assigned to this patient (caregivers and relatives), plus the administrators.
      const { data: assigned } = await supabase.from("patient_assignments").select("user_id").eq("patient_id", a.patient_id)
      const { data: admins } = await supabase.from("staff_accounts").select("user_id").eq("role", "admin")
      const candidates = [...new Set([
        ...(assigned ?? []).map((x) => x.user_id as string),
        ...(admins ?? []).map((x) => x.user_id as string),
      ])]
      // Only approved, active accounts: a suspended person gets nothing about a patient.
      const { data: active } = candidates.length
        ? await supabase.from("staff_accounts").select("user_id").in("user_id", candidates).eq("approved", true).eq("suspended", false)
        : { data: [] }
      const recipients = (active ?? []).map((x) => x.user_id as string)

      const subs = await subscriptionsFor(recipients)
      sent += await push(subs, {
        kind: r.kind,
        appointment_id: a.id,
        doctor: a.doctor,
        patient_name: a.patient_name,
        starts_at: a.starts_at,
        place_name: a.place_name,
        address: a.address,
      })
    }
  }
  return { due, sent }
}

// Something important happened for a patient (sent by the database, never by the app). Tell the people on the
// patient's team, but not the person who did it. Messages carry only what happened and the patient's name.
const EVENT_KINDS: Record<string, { to: "everyone" | "care_team" }> = {
  severe: { to: "everyone" },
  action_recorded: { to: "everyone" },
  incident: { to: "everyone" },
  reading: { to: "everyone" },
  care_plan: { to: "everyone" },
  medication_refused: { to: "everyone" },
  medication_missed: { to: "everyone" },
  reading_urgent: { to: "everyone" }, // a reading at or past the care team's urgent (red) limit
  bowel_blood: { to: "care_team" }, // blood or black stool recorded: carers and administrators only, family never sees the bowel log
  question: { to: "care_team" }, // the family asked; the caregivers and administrators answer
}

// Everyone assigned to the patient plus every administrator, minus whoever caused the event (if anyone), minus
// anyone not approved or suspended, and — for a care_team-only event — minus family proxies.
async function recipientsFor(patientId: string, to: "everyone" | "care_team", excludeUserId?: string): Promise<string[]> {
  const { data: assigned } = await supabase.from("patient_assignments").select("user_id").eq("patient_id", patientId)
  const { data: admins } = await supabase.from("staff_accounts").select("user_id").eq("role", "admin")
  const candidates = [...new Set([
    ...(assigned ?? []).map((x) => x.user_id as string),
    ...(admins ?? []).map((x) => x.user_id as string),
  ])].filter((id) => id !== excludeUserId)
  if (!candidates.length) return []
  const { data: active } = await supabase
    .from("staff_accounts").select("user_id, role")
    .in("user_id", candidates).eq("approved", true).eq("suspended", false)
  return (active ?? []).filter((a) => to === "everyone" || a.role !== "relative").map((a) => a.user_id as string)
}

async function runEvent(body: { event?: string; patient_id?: string; actor_id?: string; actor_name?: string; label?: string; dry_run?: boolean }) {
  const rule = body.event ? EVENT_KINDS[body.event] : undefined
  if (!rule || !body.patient_id) return { error: "Unknown event" }

  const { data: patient } = await supabase.from("patients").select("full_name, archived_at").eq("id", body.patient_id).maybeSingle()
  if (!patient || patient.archived_at) return { recipients: 0, sent: 0 }

  const recipients = await recipientsFor(body.patient_id, rule.to, body.actor_id)
  if (!recipients.length) return { recipients: 0, sent: 0 }

  // Testing aid: report who would be told, without sending anything.
  if (body.dry_run) return { recipients: recipients.length, would_notify: recipients, sent: 0 }

  const subs = await subscriptionsFor(recipients)
  const sent = await push(subs, {
    kind: body.event,
    patient_name: patient.full_name,
    patient_id: body.patient_id,
    label: body.label ?? null,
    by: body.actor_name ?? null,
  })
  return { recipients: recipients.length, sent }
}

// An urgent staff message (sent by the database, never by the app): the database names who is in the conversation, and
// this only double-checks that each is still active care staff. The alert says who wrote, never what was written.
async function runUrgentMessage(body: { user_ids?: unknown; actor_name?: string; thread_id?: string }) {
  const ids = Array.isArray(body.user_ids) ? body.user_ids.filter((x): x is string => typeof x === "string" && /^[0-9a-f-]{36}$/i.test(x)) : []
  if (!ids.length) return { recipients: 0, sent: 0 }
  const { data: active } = await supabase
    .from("staff_accounts").select("user_id")
    .in("user_id", ids).in("role", ["admin", "caregiver"]).eq("approved", true).eq("suspended", false)
  const recipients = (active ?? []).map((a) => a.user_id as string)
  if (!recipients.length) return { recipients: 0, sent: 0 }
  const subs = await subscriptionsFor(recipients)
  const sent = await push(subs, { kind: "message_urgent", by: body.actor_name ?? "A colleague", thread_id: body.thread_id ?? null })
  return { recipients: recipients.length, sent }
}

// Medication schedules are wall-clock, meant for whatever timezone the household is in — the same as shifts. This
// project's household is US Eastern (see the weekly digest), so a scheduled dose's real due moment is computed
// there. "Guess as UTC, see what that renders as in Eastern, correct the difference" avoids needing a timezone
// library and is correct across the daylight-saving change (verified against both an EDT and an EST date).
const TZ = "America/New_York"
function todayEasternDate(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date())
}
function easternWallToUtc(dateStr: string, hhmm: string): Date {
  const [y, mo, d] = dateStr.split("-").map(Number)
  const [h, mi] = hhmm.split(":").map(Number)
  let guess = Date.UTC(y, mo - 1, d, h, mi, 0)
  for (let i = 0; i < 2; i++) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: TZ, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    }).formatToParts(new Date(guess))
    const map = Object.fromEntries(parts.map((p) => [p.type, p.value])) as Record<string, string>
    const renderedAsUtc = Date.UTC(Number(map.year), Number(map.month) - 1, Number(map.day), Number(map.hour) % 24, Number(map.minute))
    guess += Date.UTC(y, mo - 1, d, h, mi) - renderedAsUtc
  }
  return new Date(guess)
}

// A dose that is 45 minutes overdue and never logged (given or refused) alerts the team, once, the same way an
// incident does. Only today's Eastern-date doses are ever considered, so a cron outage never floods old alerts once
// it comes back, and an as-needed medicine (no fixed time) is never "missed".
const MED_GRACE_MS = 45 * 60 * 1000

async function runMissedMedications() {
  const now = Date.now()
  const today = todayEasternDate()
  const { data: patients } = await supabase.from("patients").select("id, full_name, care_plan").is("archived_at", null)
  let due = 0
  let sent = 0
  for (const p of patients ?? []) {
    const schedule = (p.care_plan as { medSchedule?: { name: string; dose?: string; asNeeded?: boolean; times?: string[] }[] } | null)?.medSchedule ?? []
    for (const med of schedule) {
      if (med.asNeeded || !med.name || !Array.isArray(med.times)) continue
      for (const time of med.times) {
        const scheduledFor = easternWallToUtc(today, time)
        if (now - scheduledFor.getTime() < MED_GRACE_MS) continue // not due for an alert yet (includes not-yet-due doses)

        const { data: logged } = await supabase.from("medication_log").select("id")
          .eq("patient_id", p.id).eq("med_name", med.name).eq("scheduled_for", scheduledFor.toISOString()).maybeSingle()
        if (logged) continue // given or refused: refused already has its own alert

        // The unique key makes this a claim: only the run that inserts the row alerts, so it happens exactly once.
        const { error: claimError } = await supabase.from("medication_missed_alerts")
          .insert({ patient_id: p.id, med_name: med.name, scheduled_for: scheduledFor.toISOString() })
        if (claimError) continue
        due++

        const recipients = await recipientsFor(p.id, "everyone")
        const subs = await subscriptionsFor(recipients)
        sent += await push(subs, {
          kind: "medication_missed",
          patient_name: p.full_name,
          patient_id: p.id,
          label: med.dose ? `${med.name} (${med.dose})` : med.name,
        })
      }
    }
  }
  return { due, sent }
}

// A dose (or several sharing the same scheduled time) that has just come due gets one push naming what's due, sent
// only to the caregiver(s) actually on shift right now for this patient — reusing the same rule the check-in gate
// enforces, so a pairing with no shift schedule tracked at all still gets the reminder (not penalized for a feature
// nobody adopted). Never sent if every medicine in the slot is already logged, even if logged a few minutes early:
// scheduled_for is the dose's fixed due instant regardless of when it was actually given, so an early log still
// matches. Several medicines due at the same instant share a single push, not one each.
const DUE_WINDOW_MS = 15 * 60 * 1000

async function runDueMedications() {
  const now = Date.now()
  const today = todayEasternDate()
  const { data: patients } = await supabase.from("patients").select("id, full_name, care_plan").is("archived_at", null)
  let due = 0
  let sent = 0
  for (const p of patients ?? []) {
    const schedule = (p.care_plan as { medSchedule?: { name: string; dose?: string; asNeeded?: boolean; times?: string[] }[] } | null)?.medSchedule ?? []

    // Group this patient's scheduled doses by the instant they're due, so simultaneous medicines share one push.
    const slots = new Map<number, { name: string; dose?: string }[]>()
    for (const med of schedule) {
      if (med.asNeeded || !med.name || !Array.isArray(med.times)) continue
      for (const time of med.times) {
        const scheduledFor = easternWallToUtc(today, time)
        const elapsed = now - scheduledFor.getTime()
        if (elapsed < 0 || elapsed >= DUE_WINDOW_MS) continue // not due yet, or too late for a "due now" nudge
        const key = scheduledFor.getTime()
        if (!slots.has(key)) slots.set(key, [])
        slots.get(key)!.push({ name: med.name, dose: med.dose })
      }
    }

    for (const [key, meds] of slots) {
      const scheduledFor = new Date(key)

      const { data: logged } = await supabase.from("medication_log").select("med_name")
        .eq("patient_id", p.id).eq("scheduled_for", scheduledFor.toISOString()).in("med_name", meds.map((m) => m.name))
      const loggedNames = new Set((logged ?? []).map((l) => l.med_name as string))
      const stillDue = meds.filter((m) => !loggedNames.has(m.name))
      if (stillDue.length === 0) continue // every medicine in this slot was already given or refused

      // The unique key makes this a claim: only the run that inserts the row sends, so it happens exactly once.
      const { error: claimError } = await supabase.from("medication_due_reminders")
        .insert({ patient_id: p.id, scheduled_for: scheduledFor.toISOString() })
      if (claimError) continue
      due++

      const { data: assigned } = await supabase.from("patient_assignments").select("user_id").eq("patient_id", p.id)
      const { data: caregivers } = assigned?.length
        ? await supabase.from("staff_accounts").select("user_id").in("user_id", assigned.map((a) => a.user_id as string))
            .eq("role", "caregiver").eq("approved", true).eq("suspended", false)
        : { data: [] }
      const onShift: string[] = []
      for (const c of caregivers ?? []) {
        const { data: isOn } = await supabase.rpc("caregiver_on_shift", { p_patient: p.id, p_caregiver: c.user_id })
        if (isOn) onShift.push(c.user_id as string)
      }
      if (!onShift.length) continue // nobody currently on shift to act on it; the missed-dose alert is the backstop

      const label = stillDue.map((m) => (m.dose ? `${m.name} (${m.dose})` : m.name)).join(", ")
      const subs = await subscriptionsFor(onShift)
      sent += await push(subs, { kind: "medication_due", patient_name: p.full_name, patient_id: p.id, label })
    }
  }
  return { due, sent }
}

// An urgent (red) reading nobody has written down what was done about is announced again every 15 minutes, up to 3 more times.
async function runUrgentRepeats() {
  const since = new Date(Date.now() - 2 * HOUR).toISOString()
  const { data: rows } = await supabase.from("vitals").select("id, patient_id, taken_at, repeat_count, last_alert_at")
    .eq("level", "red").is("acknowledged_at", null).gt("taken_at", since).lt("repeat_count", 3)
  let sent = 0
  for (const r of rows ?? []) {
    const last = new Date((r.last_alert_at as string | null) ?? (r.taken_at as string)).getTime()
    if (Date.now() - last < 15 * 60 * 1000) continue
    const { data: patient } = await supabase.from("patients").select("full_name, archived_at").eq("id", r.patient_id).maybeSingle()
    if (!patient || patient.archived_at) continue
    const recipients = await recipientsFor(r.patient_id as string, "everyone")
    if (recipients.length) sent += await push(await subscriptionsFor(recipients), { kind: "reading_urgent_repeat", patient_name: patient.full_name, patient_id: r.patient_id })
    await supabase.from("vitals").update({ repeat_count: ((r.repeat_count as number | null) ?? 0) + 1, last_alert_at: new Date().toISOString() }).eq("id", r.id)
  }
  return { sent }
}

// A reading that has not been recorded when the care plan says it should be: once per overdue period, to the administrators and
// the caregiver on shift. Nothing between 9 PM and 7 AM Eastern (it still shows in the app).
const READING_LABEL: Record<string, string> = {
  bp: "Blood pressure", pulse: "Pulse", glucose: "Blood sugar", temperature: "Temperature",
  oxygen_saturation: "Oxygen level", pain_score: "Pain score", weight: "Weight",
}
async function runOverdueReadings() {
  const hourET = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }).format(new Date())) % 24
  if (hourET >= 21 || hourET < 7) return { skipped: "night" }
  const { data: rows } = await supabase.rpc("reading_overdue_alertable")
  const byPatient = new Map<string, string[]>()
  for (const r of rows ?? []) {
    const { error } = await supabase.from("reading_overdue_log").insert({ patient_id: r.patient_id, reading: r.reading, due_at: r.due_at })
    if (error) continue // already announced for this overdue period
    byPatient.set(r.patient_id, [...(byPatient.get(r.patient_id) ?? []), READING_LABEL[r.reading] ?? r.reading])
  }
  let sent = 0
  for (const [patientId, labels] of byPatient) {
    const { data: patient } = await supabase.from("patients").select("full_name, archived_at").eq("id", patientId).maybeSingle()
    if (!patient || patient.archived_at) continue
    const { data: admins } = await supabase.from("staff_accounts").select("user_id").eq("role", "admin").eq("approved", true).eq("suspended", false)
    const { data: assigned } = await supabase.from("patient_assignments").select("user_id").eq("patient_id", patientId)
    const { data: carers } = (assigned ?? []).length
      ? await supabase.from("staff_accounts").select("user_id").in("user_id", (assigned ?? []).map((a) => a.user_id)).eq("role", "caregiver").eq("approved", true).eq("suspended", false)
      : { data: [] }
    const onShift: string[] = []
    for (const c of carers ?? []) {
      const { data: isOn } = await supabase.rpc("caregiver_on_shift", { p_patient: patientId, p_caregiver: c.user_id })
      if (isOn) onShift.push(c.user_id as string)
    }
    const recipients = [...new Set([...(admins ?? []).map((a) => a.user_id as string), ...onShift])]
    if (recipients.length) sent += await push(await subscriptionsFor(recipients), { kind: "reading_overdue", patient_name: patient.full_name, patient_id: patientId, label: labels.join(", ") })
  }
  return { sent }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })

  const cronSecret = Deno.env.get("CRON_SECRET")
  if (cronSecret && req.headers.get("x-cron-secret") === cronSecret) {
    const payload = await req.json().catch(() => ({}))
    if (payload?.event === "message_urgent") return json(await runUrgentMessage(payload))
    if (payload?.event) return json(await runEvent(payload))
    const [reminders, dueMeds, missedMeds, urgentRepeats, overdueReadings] = await Promise.all([
      runDueReminders(), runDueMedications(), runMissedMedications(), runUrgentRepeats().catch((e) => ({ error: String(e) })), runOverdueReadings().catch((e) => ({ error: String(e) })),
    ])
    return json({ ...reminders, due_medications: dueMeds, missed_medications: missedMeds, urgent_repeats: urgentRepeats, overdue_readings: overdueReadings })
  }

  // Otherwise it must be a signed-in user asking for a test alert.
  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "")
  if (!token) return json({ error: "Unauthorized" }, 401)
  const { data: userData, error: userError } = await supabase.auth.getUser(token)
  if (userError || !userData?.user) return json({ error: "Unauthorized" }, 401)

  const body = await req.json().catch(() => ({}))
  if (body?.action !== "test") return json({ error: "Unknown action" }, 400)

  const subs = await subscriptionsFor([userData.user.id])
  const sent = await push(subs, { kind: "test" })
  return json({ sent })
})
