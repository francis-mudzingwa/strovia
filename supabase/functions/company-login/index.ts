// Log in (or start a password reset) with a Company ID without ever revealing whether the ID exists,
// which email belongs to it, or why a login failed. Every failure looks identical.
//
// Administrators additionally need an emailed 6-digit code (see migration 035). Two request shapes:
//   { identifier, password, device_token? }   the ordinary sign-in; may come back needing a code
//   { challenge, code, remember_device? }     confirming that code
import { createClient } from "npm:@supabase/supabase-js@2"

const URL = Deno.env.get("SUPABASE_URL")!
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? ""
// Prefer an explicitly-set legacy service-role key: the platform's own auto-injected SUPABASE_SERVICE_ROLE_KEY can
// resolve to a newer secret-key format that (as of 2026-09-29) is rejected by the Auth admin API, breaking every
// sign-in silently. See memory: service-role-key-outage.
const admin = createClient(URL, Deno.env.get("SERVICE_ROLE_KEY_OVERRIDE") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!)

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}
const GENERIC = "Invalid Company ID or password."
const CODE_SENTINEL = "A sign-in code has been emailed. Enter it to continue."
const COMPANY_ID = /^C\d{6}$/
const MAX_FAILURES = 8
const WINDOW_MS = 10 * 60 * 1000
const CODE_TTL_MS = 10 * 60 * 1000
const MAX_CODE_ATTEMPTS = 5
const MAX_CODES_PER_HOUR = 5
const DEVICE_TTL_MS = 30 * 24 * 3600 * 1000

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } })

const anonClient = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })

function randomCode(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000
  return String(n).padStart(6, "0")
}
function randomToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(24))).map((b) => b.toString(16).padStart(2, "0")).join("")
}
// Keyed by the server's own secret, so a stolen database row alone can't be brute-forced offline.
async function hmac(id: string, code: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(CRON_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}:${code}`))
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("")
}

async function sendCodeEmail(email: string, code: string): Promise<boolean> {
  try {
    const res = await fetch(`${URL}/functions/v1/send-mail`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-cron-secret": CRON_SECRET },
      body: JSON.stringify({ type: "login_code", email, code }),
    })
    if (!res.ok) return false
    const data = await res.json().catch(() => ({}))
    return (data?.sent ?? 0) > 0
  } catch {
    return false
  }
}

async function verifiedAccountFor(companyId: string): Promise<{ id: string; email: string } | null> {
  const { data } = await admin.from("staff_accounts").select("user_id").eq("company_id", companyId).maybeSingle()
  if (!data) return null
  const { data: user } = await admin.auth.admin.getUserById(data.user_id)
  return user?.user?.email_confirmed_at && user.user.email ? { id: data.user_id, email: user.user.email } : null
}

const verifiedEmailFor = async (companyId: string) => (await verifiedAccountFor(companyId))?.email ?? null

async function tooManyFailures(ip: string, identifier: string) {
  const since = new Date(Date.now() - WINDOW_MS).toISOString()
  const { count } = await admin
    .from("login_attempts")
    .select("id", { count: "exact", head: true })
    .eq("ip", ip).eq("identifier", identifier).gte("at", since)
  return (count ?? 0) >= MAX_FAILURES
}

async function recordFailure(ip: string, identifier: string) {
  await admin.from("login_attempts").insert({ ip, identifier })
  await admin.from("login_attempts").delete().lt("at", new Date(Date.now() - 24 * 3600 * 1000).toISOString())
}

// Marks the sign-in log row the auth hook just wrote (address-less) with the caller's IP, best effort.
async function tagSignInIp(userId: string, ip: string) {
  const { data: latest } = await admin.from("sign_in_log").select("id").eq("user_id", userId).is("ip", null)
    .gte("at", new Date(Date.now() - 30_000).toISOString()).order("at", { ascending: false }).limit(1)
  if (latest?.[0]) await admin.from("sign_in_log").update({ ip }).eq("id", latest[0].id)
}

// The password was just proven correct (the hook refused the token only because a code is required). Email one.
async function issueCode(userId: string, email: string) {
  await admin.from("admin_login_codes").delete().lt("expires_at", new Date().toISOString())
  const { count } = await admin.from("admin_login_codes").select("id", { count: "exact", head: true })
    .eq("user_id", userId).gte("created_at", new Date(Date.now() - 3_600_000).toISOString())
  if ((count ?? 0) >= MAX_CODES_PER_HOUR) {
    return json({ error: "Too many codes requested. Please wait an hour, or contact your administrator." })
  }
  const challengeId = crypto.randomUUID()
  const code = randomCode()
  const codeHash = await hmac(challengeId, code)
  const { error: insErr } = await admin.from("admin_login_codes").insert({
    id: challengeId, user_id: userId, code_hash: codeHash, expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
  })
  if (insErr) return json({ error: GENERIC })
  if (!(await sendCodeEmail(email, code))) {
    await admin.from("admin_login_codes").delete().eq("id", challengeId)
    return json({ error: "The sign-in code could not be emailed. Please try again in a moment." })
  }
  return json({ needs_code: true, challenge: challengeId })
}

// Confirming the emailed code: mints the real session with a Supabase magic-link token generated and redeemed
// here, server-side — nothing is emailed a second time, and the link itself is never sent anywhere.
async function verifyCode(body: Record<string, unknown>, ip: string) {
  const challenge = String(body.challenge ?? "")
  const code = String(body.code ?? "").trim()
  const badCode = () => json({ error: "That code is incorrect or has expired." })
  if (!challenge || !/^\d{6}$/.test(code)) return badCode()

  const { data: row } = await admin.from("admin_login_codes").select("*").eq("id", challenge).maybeSingle()
  if (!row || row.consumed_at || new Date(row.expires_at) < new Date()) return badCode()
  if (row.attempts >= MAX_CODE_ATTEMPTS) return json({ error: "Too many attempts. Request a new code." })

  if ((await hmac(row.id, code)) !== row.code_hash) {
    await admin.from("admin_login_codes").update({ attempts: row.attempts + 1 }).eq("id", row.id)
    return badCode()
  }
  await admin.from("admin_login_codes").update({ consumed_at: new Date().toISOString() }).eq("id", row.id)

  const { data: userRes } = await admin.auth.admin.getUserById(row.user_id)
  const email = userRes?.user?.email
  if (!email) return json({ error: GENERIC })

  // A marker for the auth hook: the very next token this user is issued while it's still valid is a login-code
  // verification, not an ordinary email-link click, so the audit trail can label it correctly.
  await admin.from("login_permits").upsert({ user_id: row.user_id, expires_at: new Date(Date.now() + 30_000).toISOString() })
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: "magiclink", email })
  if (linkErr || !link?.properties?.hashed_token) return json({ error: GENERIC })
  const { data: sess, error: verifyErr } = await anonClient().auth.verifyOtp({
    token_hash: link.properties.hashed_token, type: "magiclink",
  })
  if (verifyErr || !sess.session) return json({ error: GENERIC })

  let deviceToken: string | null = null
  if (body.remember_device) {
    deviceToken = randomToken()
    await admin.from("trusted_devices").insert({ token: deviceToken, user_id: row.user_id, expires_at: new Date(Date.now() + DEVICE_TTL_MS).toISOString() })
  }
  await tagSignInIp(row.user_id, ip)
  return json({ session: { access_token: sess.session.access_token, refresh_token: sess.session.refresh_token }, device_token: deviceToken })
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })

  const body = await req.json().catch(() => ({}))
  const ip = (req.headers.get("x-forwarded-for") ?? "unknown").split(",")[0].trim()

  if (body.challenge && body.code) return await verifyCode(body, ip)

  const identifier = String(body.identifier ?? "").trim().toUpperCase()
  if (!COMPANY_ID.test(identifier)) return json({ error: GENERIC })


  if (body.action === "reset") {
    const email = await verifiedEmailFor(identifier)
    if (email) await anonClient().auth.resetPasswordForEmail(email)
    return json({ ok: true }) // same answer whether or not the ID exists
  }

  if (await tooManyFailures(ip, identifier)) return json({ error: GENERIC })

  // Unknown IDs still go through a real sign-in attempt so the response time doesn't give them away.
  const account = await verifiedAccountFor(identifier)
  const email = account?.email ?? "no-such-user@invalid.example"

  let requiresCode = false
  if (account) {
    const { data: acct } = await admin.from("staff_accounts").select("role, login_code_enabled").eq("user_id", account.id).maybeSingle()
    requiresCode = acct?.role === "admin" && acct?.login_code_enabled === true
  }
  let deviceTrusted = false
  if (account && requiresCode && typeof body.device_token === "string" && body.device_token) {
    const { data: dev } = await admin.from("trusted_devices").select("id")
      .eq("token", body.device_token).eq("user_id", account.id).gt("expires_at", new Date().toISOString()).maybeSingle()
    deviceTrusted = !!dev
    if (dev) await admin.from("trusted_devices").update({ last_used_at: new Date().toISOString() }).eq("id", dev.id)
  }

  // The permit is what lets a caregiver's or a trusted-device admin's password sign-in through the auth hook:
  // only this function writes one. An admin who still needs a code gets no permit, so the hook refuses the token.
  const needsPermit = !!account && (!requiresCode || deviceTrusted)
  if (needsPermit) await admin.from("login_permits").upsert({ user_id: account!.id, expires_at: new Date(Date.now() + 30_000).toISOString() })
  const { data, error } = await anonClient().auth.signInWithPassword({ email, password: String(body.password ?? "") })
  if (needsPermit) await admin.from("login_permits").delete().eq("user_id", account!.id)

  if (account && requiresCode && !deviceTrusted) {
    if (error?.message === CODE_SENTINEL) return await issueCode(account.id, account.email)
    await recordFailure(ip, identifier)
    return json({ error: GENERIC })
  }

  if (error || !data.session) {
    await recordFailure(ip, identifier)
    return json({ error: GENERIC })
  }
  if (account) await tagSignInIp(account.id, ip)
  return json({ session: { access_token: data.session.access_token, refresh_token: data.session.refresh_token } })
})
