// DEMO PROJECT ONLY. One-click sign-in to the made-up demo accounts, so a reviewer can try Strovia without an account.
// It refuses to run unless the project has the secret DEMO_MODE=true, and it can only ever sign in to the four fixed demo
// users below, so it can never be used on real accounts. The real Strovia project does not deploy this function.
import { createClient } from "npm:@supabase/supabase-js@2"

const URL = Deno.env.get("SUPABASE_URL")!
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!
const admin = createClient(URL, Deno.env.get("SERVICE_ROLE_KEY_OVERRIDE") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!)

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } })

const DEMO_EMAILS: Record<string, string> = {
  caregiver: "demo.caregiver@strovia-demo.example",
  relative: "demo.family@strovia-demo.example",
  admin: "demo.admin@strovia-demo.example",
}
const WINDOW_MS = 10 * 60 * 1000
const MAX_PER_IP = 40

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  if (Deno.env.get("DEMO_MODE") !== "true") return json({ error: "Not available." }, 404)

  const body = await req.json().catch(() => ({}))
  const email = DEMO_EMAILS[String(body.role ?? "")]
  if (!email) return json({ error: "Choose caregiver, family or administrator." })

  const ip = (req.headers.get("x-forwarded-for") ?? "unknown").split(",")[0].trim()
  const { count } = await admin.from("login_attempts").select("id", { count: "exact", head: true })
    .eq("ip", ip).eq("identifier", "DEMO").gte("at", new Date(Date.now() - WINDOW_MS).toISOString())
  if ((count ?? 0) >= MAX_PER_IP) return json({ error: "Too many demo sign-ins from this address. Please wait a few minutes." })
  await admin.from("login_attempts").insert({ ip, identifier: "DEMO" })

  const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 50 })
  const user = list?.users?.find((u) => u.email === email)
  if (!user) return json({ error: "The demo is being set up. Please try again in a minute." })

  // Same hand-off the real sign-in uses: a short permit for the auth hook, then a magic-link token made and used here.
  await admin.from("login_permits").upsert({ user_id: user.id, expires_at: new Date(Date.now() + 30_000).toISOString() })
  let session: { access_token: string; refresh_token: string } | null = null
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: "magiclink", email })
  if (!linkErr && link?.properties?.hashed_token) {
    const anon = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
    const { data: sess, error: verifyErr } = await anon.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" })
    if (!verifyErr && sess.session) session = { access_token: sess.session.access_token, refresh_token: sess.session.refresh_token }
  }
  await admin.from("login_permits").delete().eq("user_id", user.id)
  if (!session) return json({ error: "The demo could not start. Please try again." })
  return json({ session })
})
