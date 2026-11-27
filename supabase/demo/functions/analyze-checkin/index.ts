// DEMO PROJECT ONLY. A stand-in for the real analyze-checkin function. The real one asks an AI model (Claude) for a
// plain-language note. The demo never calls an AI service (no cost, nothing can be misused), so this writes the same
// kind of note from simple fixed rules, and says so. The rules, not this note, decide every alert in the app either way.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}
const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } })

const KEYS = ["balance", "vision", "face", "arm", "speech", "headache", "fatigue"] as const
const LABEL: Record<string, string> = { balance: "balance", vision: "vision", face: "face drooping", arm: "arm strength", speech: "speech", headache: "headache", fatigue: "fatigue" }
type Entry = { date: string; symptoms: Record<string, number>; feeling?: number }

const wellness = (s: Record<string, number>) => 100 - (KEYS.reduce((a, k) => a + (s?.[k] ?? 0), 0) / KEYS.length / 3) * 100

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  const body = await req.json().catch(() => ({}))
  const entries: Entry[] = Array.isArray(body.entries) ? body.entries : []
  if (!entries.length) return json({ error: "No entries." })

  const latest = entries[entries.length - 1]
  const earlier = entries.slice(-8, -1)
  const nowScore = wellness(latest.symptoms)
  const before = earlier.length ? earlier.reduce((a, e) => a + wellness(e.symptoms), 0) / earlier.length : nowScore
  const severe = KEYS.filter((k) => (latest.symptoms?.[k] ?? 0) >= 3)
  const moderate = KEYS.filter((k) => (latest.symptoms?.[k] ?? 0) === 2)
  const trend = severe.length ? "Declining" : nowScore > before + 3 ? "Improving" : nowScore < before - 3 ? "Declining" : "Stable"
  const level = severe.length ? "Severe" : moderate.length >= 3 ? "Moderate" : moderate.length || KEYS.some((k) => (latest.symptoms?.[k] ?? 0) === 1) ? "Mild" : "Good"
  const names = (ks: readonly string[]) => ks.map((k) => LABEL[k]).join(", ")

  let explanation: string | null = null
  if (body.hasAnomalies || severe.length) {
    explanation = severe.length
      ? `Demo note: today's check-in rated ${names(severe)} as severe. In real use the care team would be alerted and told to follow the care plan; call 911 for any sudden stroke sign.`
      : `Demo note: today's score of ${Math.round(nowScore)} is lower than the recent average of ${Math.round(before)}${moderate.length ? `, mainly because of ${names(moderate)}` : ""}, so the care team is asked to take a look.`
  }
  const part = (k: (typeof KEYS)[number]) => ((latest.symptoms?.[k] ?? 0) >= 2 ? `${LABEL[k]} is still giving some trouble today` : `${LABEL[k]} looks settled today`)
  return json({
    explanation,
    mobility_progress: `Sample note: ${part("balance")}, and ${part("arm")}.`,
    speech_progress: `Sample note: ${part("speech")}.`,
    cognitive_progress: "Sample note: nothing in today's check-in points to a change in thinking or attention.",
    adl_progress: `Sample note: overall the recent days look ${trend === "Improving" ? "a little better" : trend === "Declining" ? "a little harder" : "much the same"}.`,
    recovery_level: level,
    trend,
  })
})
