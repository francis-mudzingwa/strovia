import { useState, useEffect } from "react"
import { Cake } from "lucide-react"
import { supabase } from "./supabaseClient.js"
import { colors } from "./care/ui.jsx"
import { LogoMark } from "./Logo.jsx"
import { BirthdayFields } from "./Birthdays.jsx"

// Caregivers and administrators must have a birthday on file. Anyone without one sees this single step before anything else,
// once. A birthday typed on the registration form is picked up here automatically, so new accounts never see it.
export default function BirthdayGate({ member, onSaved, onSignOut }) {
  const [checking, setChecking] = useState(true)
  const [month, setMonth] = useState("")
  const [day, setDay] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    supabase.rpc("claim_signup_birthday").then(({ data }) => {
      if (cancelled) return
      const row = Array.isArray(data) ? data[0] : data
      if (row && row.birthday_month && row.birthday_day) onSaved({ birthday_month: row.birthday_month, birthday_day: row.birthday_day })
      else setChecking(false)
    })
    return () => { cancelled = true }
  }, [])

  async function save(e) {
    e.preventDefault()
    if (!month || !day) return
    setBusy(true)
    setError(null)
    const { error: err } = await supabase.rpc("set_my_birthday", { p_month: Number(month), p_day: Number(day) })
    setBusy(false)
    if (err) { setError("Your birthday couldn't be saved. Check that the day exists in that month, and try again."); return }
    onSaved({ birthday_month: Number(month), birthday_day: Number(day) })
  }

  const select = { width: "100%", padding: "11px 12px", borderRadius: 10, border: `1px solid ${colors.hairline}`, fontSize: 15, boxSizing: "border-box", background: "#fff", color: colors.ink }
  const label = { fontSize: 13, fontWeight: 600, color: colors.inkSoft, display: "block", marginBottom: 5 }

  return (
    <div style={{ minHeight: "100vh", background: colors.bg, display: "flex", alignItems: "center", justifyContent: "center", padding: 16, fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
      <div style={{ background: "#fff", borderRadius: 18, padding: 26, width: "100%", maxWidth: 380, boxSizing: "border-box", boxShadow: "0 1px 3px rgba(32,38,31,0.06), 0 6px 16px rgba(32,38,31,0.05)" }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 12 }}><LogoMark size={48} radius={22} /></div>
        {checking ? (
          <p style={{ textAlign: "center", color: colors.inkFaint, fontSize: 14, margin: 0 }}>One moment...</p>
        ) : (
          <form onSubmit={save}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 6 }}>
              <Cake size={20} color={colors.gold} />
              <div style={{ fontFamily: "Fraunces, serif", fontSize: 21, fontWeight: 600, color: colors.ink }}>One quick step{member.first_name ? `, ${member.first_name}` : ""}</div>
            </div>
            <p style={{ fontSize: 14, color: colors.inkSoft, lineHeight: 1.5, textAlign: "center", margin: "0 0 16px" }}>
              Please add your birthday so the team can celebrate it. Month and day only, no year. You'll only be asked once.
            </p>
            <BirthdayFields required month={month} day={day} onChange={(m, d) => { setMonth(m); setDay(d) }} selectStyle={select} labelStyle={label} />
            {error && <p style={{ color: colors.rust, fontSize: 13, margin: "10px 0 0", lineHeight: 1.4 }}>{error}</p>}
            <button type="submit" disabled={busy || !month || !day} style={{ width: "100%", marginTop: 16, padding: "13px 0", borderRadius: 12, border: "none", background: colors.sage, color: "#fff", fontSize: 15, fontWeight: 700, cursor: busy || !month || !day ? "default" : "pointer", opacity: busy || !month || !day ? 0.55 : 1 }}>
              {busy ? "Saving..." : "Save and continue"}
            </button>
            <div style={{ textAlign: "center", marginTop: 12 }}>
              <button type="button" onClick={onSignOut} style={{ border: "none", background: "none", color: colors.inkSoft, fontSize: 13, fontWeight: 600, textDecoration: "underline", cursor: "pointer" }}>Log out</button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
