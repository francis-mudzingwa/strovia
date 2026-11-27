// Sends the app's own emails over SMTP:
//   invitation       admin -> a family member, with their join link
//   approved         admin -> a caregiver whose account was just approved
//   new_registration database trigger -> every administrator, when a caregiver registers
//   weekly_digest    weekly schedule -> every family proxy, a short summary of the last 7 days
//   login_code       company-login edge function -> an administrator signing in, a 6-digit code
//   message_notice   database trigger -> staff who have a new message, "open Strovia to read it" (never the message itself)
//   profile_change_result  database -> a family member whose change request was answered, "look at your Profile"
// (Sign-up verification and password-reset emails are sent by Supabase Auth using the same SMTP account.)
import nodemailer from "npm:nodemailer@6"
import { createClient } from "npm:@supabase/supabase-js@2"

// See company-login's SERVICE_ROLE_KEY_OVERRIDE comment / memory: service-role-key-outage.
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SERVICE_ROLE_KEY_OVERRIDE") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!)

const SITE_URL = (Deno.env.get("SITE_URL") ?? "https://strovia-app.netlify.app").replace(/\/$/, "")
const FROM_NAME = Deno.env.get("SMTP_FROM_NAME") ?? "Strovia"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } })

const transport = nodemailer.createTransport({
  host: Deno.env.get("SMTP_HOST"),
  port: Number(Deno.env.get("SMTP_PORT") ?? 465),
  secure: Number(Deno.env.get("SMTP_PORT") ?? 465) === 465,
  auth: { user: Deno.env.get("SMTP_USER"), pass: Deno.env.get("SMTP_PASS") },
})

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!))

function layout(title: string, bodyHtml: string, buttonLabel?: string, buttonUrl?: string) {
  return `<div style="background:#FAF6EF;padding:24px;font-family:-apple-system,Segoe UI,Arial,sans-serif;color:#20261F">
  <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:16px;padding:28px">
    <div style="font-family:Georgia,serif;font-size:26px;font-weight:600;color:#2C4E3A;margin-bottom:16px">Strovia</div>
    <div style="font-size:18px;font-weight:700;margin-bottom:12px">${esc(title)}</div>
    <div style="font-size:14.5px;line-height:1.6;color:#4B5245">${bodyHtml}</div>
    ${buttonUrl ? `<p style="margin:22px 0 6px"><a href="${esc(buttonUrl)}" style="background:#3F6C51;color:#fff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:9px;display:inline-block">${esc(buttonLabel)}</a></p>
    <p style="font-size:12px;color:#8B9184;word-break:break-all">Or paste this link into your browser:<br>${esc(buttonUrl)}</p>` : ""}
  </div>
  <p style="text-align:center;font-size:11.5px;color:#8B9184;margin-top:14px">Strovia, your stroke recovery monitoring companion</p>
</div>`
}

async function send(to: string | string[], subject: string, html: string) {
  await transport.sendMail({
    from: `"${FROM_NAME}" <${Deno.env.get("SMTP_USER")}>`,
    to,
    subject,
    html,
  })
}

async function callerIsApprovedAdmin(req: Request) {
  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "")
  if (!token) return false
  const { data } = await admin.auth.getUser(token)
  if (!data?.user) return false
  const { data: member } = await admin.from("staff_accounts").select("role, approved").eq("user_id", data.user.id).maybeSingle()
  return member?.role === "admin" && member.approved === true
}

const DAY = 24 * 3600 * 1000

// Everything the office sees is in US Eastern Time (EST in winter, EDT in summer; the switch is automatic).
const TZ = "America/New_York"
const isoDay = (t: number) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(t))
const easternWhen = (iso: string) => {
  const d = new Date(iso)
  const day = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric" }).format(d)
  const time = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" }).format(d)
  return `${day} at ${time} ET`
}
// Is it Sunday morning, 9 o'clock, in Eastern Time right now? (The schedule fires at both 13:00 and 14:00 UTC so that
// one of them is 9 AM in summer and the other in winter.)
function isSundayNineEastern() {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short", hour: "numeric", hour12: false }).formatToParts(new Date())
  const weekday = parts.find((p) => p.type === "weekday")?.value
  const hour = Number(parts.find((p) => p.type === "hour")?.value) % 24
  return weekday === "Sun" && hour === 9
}

// One email per family proxy, covering each patient they help look after. Plain language, no medical detail:
// counts and dates only, and a link to open Strovia for the rest.
async function sendWeeklyDigests(onlyEmail: string | null) {
  const { data: relatives } = await admin.from("staff_accounts").select("user_id, first_name").eq("role", "relative").eq("approved", true).eq("suspended", false)
  let sent = 0
  for (const rel of relatives ?? []) {
    const { data: userData } = await admin.auth.admin.getUserById(rel.user_id)
    const email = userData?.user?.email
    if (!email || (onlyEmail && email.toLowerCase() !== onlyEmail)) continue

    const { data: links } = await admin.from("patient_assignments").select("patient_id").eq("user_id", rel.user_id)
    const sections: string[] = []
    for (const link of links ?? []) {
      const { data: patient } = await admin.from("patients").select("full_name, archived_at").eq("id", link.patient_id).maybeSingle()
      if (!patient || patient.archived_at) continue
      const from = isoDay(Date.now() - 6 * DAY)
      const { data: days } = await admin.from("checkins").select("entry_date, symptoms").eq("patient_id", link.patient_id).gte("entry_date", from)
      const severeDays = (days ?? []).filter((d) => Object.values(d.symptoms ?? {}).some((v) => String(v) === "3")).map((d) => d.entry_date as string)
      const { data: acted } = severeDays.length
        ? await admin.from("symptom_actions").select("entry_date").eq("patient_id", link.patient_id).in("entry_date", severeDays)
        : { data: [] }
      const actedDays = new Set((acted ?? []).map((a) => a.entry_date as string))
      const { count: incidents } = await admin.from("incidents").select("id", { count: "exact", head: true })
        .eq("patient_id", link.patient_id).gte("happened_at", new Date(Date.now() - 7 * DAY).toISOString())
      const { data: appts } = await admin.from("appointments").select("doctor, starts_at").eq("patient_id", link.patient_id)
        .gt("starts_at", new Date().toISOString()).lt("starts_at", new Date(Date.now() + 7 * DAY).toISOString()).order("starts_at")

      const lines = [
        `<li>Check-ins recorded on <strong>${(days ?? []).length} of the last 7 days</strong>.</li>`,
        severeDays.length
          ? `<li><strong>${severeDays.length}</strong> ${severeDays.length === 1 ? "day" : "days"} with severe symptoms; what was done was written down for <strong>${severeDays.filter((d) => actedDays.has(d)).length}</strong>.</li>`
          : `<li>No severe symptoms were recorded.</li>`,
        (incidents ?? 0) > 0 ? `<li><strong>${incidents}</strong> ${incidents === 1 ? "incident was" : "incidents were"} reported.</li>` : "",
        (appts ?? []).length
          ? `<li>Coming up: ${(appts ?? []).map((a) => `appointment with ${esc(a.doctor)} on ${easternWhen(a.starts_at)}`).join("; ")}.</li>`
          : `<li>No appointments in the next 7 days.</li>`,
      ].filter(Boolean).join("")
      sections.push(`<p style="margin:18px 0 6px;font-weight:700;color:#2C4E3A">${esc(patient.full_name)}</p><ul style="margin:0;padding-left:18px">${lines}</ul>`)
    }
    if (!sections.length) continue

    await send(email, "Your week with Strovia", layout(
      `Hello${rel.first_name ? `, ${rel.first_name}` : ""}: here is your week`,
      `<p>A short summary of the last 7 days.</p>${sections.join("")}<p style="margin-top:16px">Open Strovia to see the details.</p>`,
      "Open Strovia", SITE_URL))
    sent++
  }
  return { sent }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })

  const body = await req.json().catch(() => ({}))
  const type = String(body.type ?? "")
  const fromDatabase = !!Deno.env.get("CRON_SECRET") && req.headers.get("x-cron-secret") === Deno.env.get("CRON_SECRET")

  try {
    if (type === "new_registration") {
      if (!fromDatabase) return json({ error: "Unauthorized" }, 401)
      const since = new Date(Date.now() - 3600 * 1000).toISOString()
      const { count } = await admin.from("mail_log").select("id", { count: "exact", head: true }).eq("type", type).gte("at", since)
      if ((count ?? 0) >= 5) return json({ sent: 0 }) // at most 5 notices an hour
      await admin.from("mail_log").insert({ type })
      await admin.from("mail_log").delete().eq("type", type).lt("at", new Date(Date.now() - 24 * 3600 * 1000).toISOString())
      const { data: person } = await admin.from("staff_accounts").select("first_name, last_name, company_id, organisation, job_title").eq("user_id", body.userId).maybeSingle()
      if (!person) return json({ sent: 0 })
      const { data: admins } = await admin.from("staff_accounts").select("user_id").eq("role", "admin").eq("approved", true)
      const emails: string[] = []
      for (const a of admins ?? []) {
        const { data } = await admin.auth.admin.getUserById(a.user_id)
        if (data?.user?.email) emails.push(data.user.email)
      }
      if (!emails.length) return json({ sent: 0 })
      const name = [person.first_name, person.last_name].filter(Boolean).join(" ") || "Someone"
      await send(emails, `${name} registered and is waiting for approval`, layout(
        "A new caregiver is waiting for approval",
        `<p><strong>${esc(name)}</strong> registered with Company ID <strong>${esc(person.company_id)}</strong>${person.organisation ? ` (${esc(person.organisation)}` : ""}${person.job_title ? `, ${esc(person.job_title)}` : ""}${person.organisation ? ")" : ""}.</p>
         <p>They can't see anything until you approve them. Once they've verified their email, log in and open <strong>Manage Accounts</strong>.</p>`,
        "Open Strovia", SITE_URL))
      return json({ sent: emails.length })
    }

    if (type === "login_code") {
      if (!fromDatabase) return json({ error: "Unauthorized" }, 401)
      const email = String(body.email ?? "")
      const code = String(body.code ?? "")
      if (!email || !/^\d{6}$/.test(code)) return json({ error: "Bad request" }, 400)
      await send(email, `${code} is your Strovia sign-in code`, layout(
        "Confirm it's you",
        `<p>Enter this code to finish signing in to Strovia:</p>
         <p style="font-size:32px;font-weight:700;letter-spacing:6px;color:#2C4E3A;text-align:center;margin:18px 0">${esc(code)}</p>
         <p>It expires in 10 minutes and can only be used once.</p>
         <p style="color:#8B9184;font-size:12.5px">If you didn't just try to sign in to Strovia, you can ignore this email — nobody can get in without this code.</p>`))
      return json({ sent: 1 })
    }

    // A staff message is waiting. The email says only that: no message, no sender and no link to the message (the button opens
    // Strovia's sign-in page). Who gets it, and how often, is decided by the database before it calls this.
    if (type === "message_notice") {
      if (!fromDatabase) return json({ error: "Unauthorized" }, 401)
      const ids = Array.isArray(body.user_ids) ? body.user_ids.filter((x: unknown): x is string => typeof x === "string" && /^[0-9a-f-]{36}$/i.test(x)) : []
      if (!ids.length) return json({ sent: 0 })
      const { data: people } = await admin.from("staff_accounts").select("user_id")
        .in("user_id", ids).in("role", ["admin", "caregiver"]).eq("approved", true).eq("suspended", false).eq("email_message_notices", true)
      const urgent = body.urgent === true
      let sent = 0
      let wouldSend = 0
      for (const p of people ?? []) {
        const { data } = await admin.auth.admin.getUserById(p.user_id)
        const email = data?.user?.email
        if (!email) continue
        if (body.dry_run === true) { wouldSend++; continue }
        await send(email, urgent ? "Urgent: you have a new message in Strovia" : "You have a new message in Strovia", layout(
          urgent ? "You have an urgent message" : "You have a new message",
          `<p>${urgent ? "Someone sent you a message and marked it urgent." : "Someone has sent you a message in Strovia."}</p>
           <p>For everyone's privacy, messages are never shown in email. Open Strovia and go to <strong>Messages</strong> to read it.</p>
           <p style="color:#8B9184;font-size:12.5px">You can turn these emails off under Profile in Strovia.</p>`,
          "Open Strovia", SITE_URL))
        sent++
      }
      return json(body.dry_run === true ? { would_send: wouldSend, sent: 0 } : { sent })
    }

    // A family member asked to change their details and an administrator has answered. Family members have no Messages, so this
    // short email tells them to look at their Profile. It does not say what the answer was.
    if (type === "profile_change_result") {
      if (!fromDatabase) return json({ error: "Unauthorized" }, 401)
      const { data: person } = await admin.from("staff_accounts").select("first_name, approved, suspended").eq("user_id", body.user_id).maybeSingle()
      if (!person?.approved || person.suspended) return json({ sent: 0 })
      const { data } = await admin.auth.admin.getUserById(String(body.user_id))
      if (!data?.user?.email) return json({ sent: 0 })
      if (body.dry_run === true) return json({ would_send: 1, sent: 0 })
      await send(data.user.email, "Your request was answered", layout(
        `Hello${person.first_name ? `, ${person.first_name}` : ""}`,
        `<p>Your administrator has answered your request to change your details.</p><p>Open Strovia and look at your <strong>Profile</strong> to see the answer.</p>`,
        "Open Strovia", SITE_URL))
      return json({ sent: 1 })
    }

    if (type === "weekly_digest") {
      if (!fromDatabase) return json({ error: "Unauthorized" }, 401)
      // Sent once a week. `only_email` (used for testing) limits it to one address and skips the once-a-week guard.
      const onlyEmail = typeof body.only_email === "string" ? body.only_email.toLowerCase() : null
      if (!onlyEmail) {
        if (!isSundayNineEastern()) return json({ sent: 0, skipped: "It is not Sunday at 9 AM Eastern." })
        const since = new Date(Date.now() - 6 * 24 * 3600 * 1000).toISOString()
        const { count } = await admin.from("mail_log").select("id", { count: "exact", head: true }).eq("type", type).gte("at", since)
        if ((count ?? 0) > 0) return json({ sent: 0 })
        await admin.from("mail_log").insert({ type })
      }
      return json(await sendWeeklyDigests(onlyEmail))
    }

    if (!(await callerIsApprovedAdmin(req))) return json({ error: "Unauthorized" }, 401)

    if (type === "invitation") {
      const { data: inv } = await admin.from("join_invitations").select("token, invitee_name, invitee_email, relationship, status, patient_id").eq("id", body.invitationId).maybeSingle()
      if (!inv || inv.status !== "pending") return json({ error: "Invitation not found" }, 404)
      const { data: patient } = await admin.from("patients").select("full_name").eq("id", inv.patient_id).maybeSingle()
      const patientName = patient?.full_name ?? "your family member"
      const link = `${SITE_URL}/?join=${inv.token}`
      await send(inv.invitee_email, `You've been invited to help look after ${patientName}`, layout(
        `Hello ${inv.invitee_name}`,
        `<p>You've been invited to Strovia to help look after <strong>${esc(patientName)}</strong>${inv.relationship ? ` as their ${esc(String(inv.relationship).toLowerCase())}` : ""}.</p>
         <p>You'll be able to record daily check-ins, manage appointments, follow the care plan and write notes, so you can step in when the caregiver is away.</p>
         <p>Use this email address (${esc(inv.invitee_email)}) to set your password.</p>`,
        "Accept the invitation", link))
      return json({ sent: 1 })
    }

    if (type === "approved") {
      const { data: person } = await admin.from("staff_accounts").select("first_name, approved").eq("user_id", body.userId).maybeSingle()
      if (!person?.approved) return json({ error: "Account is not approved" }, 400)
      const { data } = await admin.auth.admin.getUserById(body.userId)
      if (!data?.user?.email) return json({ error: "No email" }, 404)
      await send(data.user.email, "Your Strovia account has been approved", layout(
        `Welcome${person.first_name ? `, ${person.first_name}` : ""}`,
        `<p>Your account has been approved. Log in with your Company ID and password.</p>
         <p>Once the administrator assigns you a patient, you'll see them on your home screen.</p>`,
        "Log in to Strovia", SITE_URL))
      return json({ sent: 1 })
    }

    return json({ error: "Unknown type" }, 400)
  } catch (error) {
    console.error("send-mail failed:", (error as Error).message)
    return json({ error: "The email could not be sent" }, 502)
  }
})
