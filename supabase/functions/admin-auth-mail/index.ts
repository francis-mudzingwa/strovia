// Lets the administrator resend a person's verification email, or send them a password-reset email.
// Only a signed-in, approved administrator can call it. Each send is recorded in the audit trail, and a person
// can be emailed at most 3 times an hour this way.
import { createClient } from "npm:@supabase/supabase-js@2"

const URL = Deno.env.get("SUPABASE_URL")!
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!
// See company-login's SERVICE_ROLE_KEY_OVERRIDE comment / memory: service-role-key-outage.
const admin = createClient(URL, Deno.env.get("SERVICE_ROLE_KEY_OVERRIDE") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!)
const SITE_URL = Deno.env.get("SITE_URL") ?? "https://strovia-app.netlify.app"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } })

const ACTIONS: Record<string, string> = {
  resend_verification: "sent a verification email",
  reset_password: "sent a password-reset email",
}
const MAX_PER_HOUR = 3

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })

  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "")
  if (!token) return json({ error: "Unauthorized" }, 401)
  const { data: caller, error: callerError } = await admin.auth.getUser(token)
  if (callerError || !caller?.user) return json({ error: "Unauthorized" }, 401)

  const { data: me } = await admin.from("staff_accounts").select("role, approved, first_name, last_name").eq("user_id", caller.user.id).maybeSingle()
  if (!me || me.role !== "admin" || !me.approved) return json({ error: "Administrators only." }, 403)

  const body = await req.json().catch(() => ({}))
  const action = String(body.action ?? "")
  const userId = String(body.userId ?? "")
  const label = ACTIONS[action]
  if (!label || !userId) return json({ error: "Unknown request." }, 400)

  const { data: target, error: targetError } = await admin.auth.admin.getUserById(userId)
  const email = target?.user?.email
  if (targetError || !email) return json({ error: "That account was not found." }, 404)

  if (action === "resend_verification" && target.user.email_confirmed_at) {
    return json({ error: "That email address is already verified." }, 400)
  }

  const since = new Date(Date.now() - 3600 * 1000).toISOString()
  const { count } = await admin.from("activity_log").select("id", { count: "exact", head: true })
    .eq("action", label).eq("detail", email).gte("created_at", since)
  if ((count ?? 0) >= MAX_PER_HOUR) return json({ error: "That person was emailed several times in the last hour. Please wait a while." }, 429)

  const anon = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
  const { error } = action === "resend_verification"
    ? await anon.auth.resend({ type: "signup", email, options: { emailRedirectTo: SITE_URL } })
    : await anon.auth.resetPasswordForEmail(email, { redirectTo: SITE_URL })
  if (error) return json({ error: "The email could not be sent right now. Please try again later." }, 502)

  const name = [me.first_name, me.last_name].filter(Boolean).join(" ") || caller.user.email
  await admin.from("activity_log").insert({ actor_id: caller.user.id, actor_name: name, actor_role: "admin", action: label, detail: email })
  return json({ sent: true })
})
