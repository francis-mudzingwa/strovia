import { useState, useEffect } from "react"
import { Sprout, Eye, EyeOff, MailCheck } from "lucide-react"
import { supabase } from "./supabaseClient.js"
import { passwordStrength } from "./AuthCard.jsx"

const colors = { sage: "#3F6C51", sageDeep: "#2C4E3A", sageTint: "#E3EBE0", bg: "#FAF6EF", ink: "#20261F", inkFaint: "#6B7266", hairline: "#E5DFD1", rust: "#A24632" }

const inputStyle = { width: "100%", padding: 11, borderRadius: 9, border: `1px solid ${colors.hairline}`, boxSizing: "border-box", fontSize: 14.5, background: "#fff" }
const labelStyle = { fontSize: 13, fontWeight: 600, color: colors.ink, display: "block", marginBottom: 5 }

// A relative opens the link the administrator sent: they set a password (or, once their email is
// confirmed, come back here signed in) and are then able to look after their family member, covering for the caregiver when needed.
export default function JoinPage({ token, session, onSignOut }) {
  const [preview, setPreview] = useState(undefined) // undefined = loading, null = not found
  const [first, setFirst] = useState("")
  const [last, setLast] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [needsConfirm, setNeedsConfirm] = useState(false)
  const [done, setDone] = useState(false)
  // The email already has a confirmed account (they verified it earlier): sign in right here and accept, instead of
  // sending them to the main page, which loses this invitation link and drops them on a dead end.
  const [existingAccount, setExistingAccount] = useState(false)
  const [resetSent, setResetSent] = useState(false)

  useEffect(() => {
    let cancelled = false
    supabase.rpc("get_join_preview", { p_token: token }).then(({ data, error }) => {
      if (cancelled) return
      if (error || !data || data.length === 0) { setPreview(null); return }
      setPreview(data[0])
      const parts = (data[0].invitee_name || "").trim().split(/\s+/)
      setFirst(parts[0] || "")
      setLast(parts.slice(1).join(" "))
    })
    return () => { cancelled = true }
  }, [token])

  async function accept() {
    const { error: acceptError } = await supabase.rpc("accept_join_invitation", {
      p_token: token, p_first: first, p_last: last, p_phone: "",
    })
    if (acceptError) { setError(acceptError.message); return false }
    window.history.replaceState({}, "", window.location.pathname)
    setDone(true)
    return true
  }

  async function submit(e) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    if (!session && existingAccount) {
      const { error: signInError } = await supabase.auth.signInWithPassword({ email: preview.invitee_email, password })
      if (signInError) {
        setBusy(false)
        setError(signInError.message === "Invalid login credentials" ? "That password isn't right. Try again, or reset it below." : signInError.message)
        return
      }
    } else if (!session) {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: preview.invitee_email,
        password,
        options: { emailRedirectTo: window.location.href, data: { first_name: first, last_name: last } },
      })
      if (signUpError) { setBusy(false); setError(signUpError.message); return }
      if (data?.user && data.user.identities?.length === 0) {
        setBusy(false)
        setPassword("")
        setExistingAccount(true)
        setError("This email already has an account (you've probably confirmed it already). Enter your password to sign in and finish accepting.")
        return
      }
      // With "Confirm email" on there is no session until the emailed link is opened; it returns here.
      if (!data.session) { setBusy(false); setNeedsConfirm(true); return }
    }
    await accept()
    setBusy(false)
  }

  async function sendReset() {
    setError(null)
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(preview.invitee_email, { redirectTo: window.location.origin })
    if (resetError) setError(resetError.message)
    else setResetSent(true)
  }

  const strength = passwordStrength(password)
  const wrongAccount = session && preview && session.user.email?.toLowerCase() !== preview.invitee_email?.toLowerCase()

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", background: colors.bg, padding: 16 }}>
      <div style={{ background: "#fff", padding: 30, borderRadius: 18, width: 400, maxWidth: "100%", boxSizing: "border-box", boxShadow: "0 1px 3px rgba(32,38,31,0.06), 0 6px 16px rgba(32,38,31,0.05)" }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 20 }}>
          <div style={{ width: 52, height: 52, borderRadius: 14, background: colors.sageTint, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 10 }}>
            <Sprout size={26} color={colors.sageDeep} />
          </div>
          <div style={{ fontSize: 16, fontWeight: 700, color: colors.ink }}>Family access to Strovia</div>
        </div>

        {preview === undefined ? (
          <p style={{ fontSize: 13.5, color: colors.inkFaint, textAlign: "center" }}>Loading invitation...</p>
        ) : preview === null ? (
          <p style={{ fontSize: 13.5, color: colors.rust, textAlign: "center" }}>This invitation link isn't valid.</p>
        ) : done ? (
          <>
            <p style={{ fontSize: 14, color: colors.ink, textAlign: "center", lineHeight: 1.5, marginBottom: 18 }}>
              You can now look after {preview.patient_name}, alongside the caregiver.
            </p>
            <button onClick={() => window.location.reload()} style={{ width: "100%", padding: 12, borderRadius: 9, border: "none", background: colors.sage, color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: 15 }}>
              Continue to Strovia
            </button>
          </>
        ) : preview.status === "expired" ? (
          <p style={{ fontSize: 13.5, color: colors.inkFaint, textAlign: "center", lineHeight: 1.5 }}>This invitation has expired. Please ask your administrator to send you a new one.</p>
        ) : preview.status !== "pending" ? (
          <p style={{ fontSize: 13.5, color: colors.inkFaint, textAlign: "center" }}>This invitation has already been used. Log in from the main page.</p>
        ) : needsConfirm ? (
          <div style={{ textAlign: "center" }}>
            <MailCheck size={30} color={colors.sageDeep} style={{ marginBottom: 8 }} />
            <p style={{ fontSize: 14, color: colors.ink, lineHeight: 1.55, margin: 0 }}>
              Almost there. We emailed a confirmation link to <strong>{preview.invitee_email}</strong>. Open it and you'll return here to finish.
            </p>
          </div>
        ) : wrongAccount ? (
          <>
            <p style={{ fontSize: 13.5, color: colors.rust, textAlign: "center", lineHeight: 1.5 }}>
              This invitation is for {preview.invitee_email}, but you're signed in as {session.user.email}.
            </p>
            <button onClick={onSignOut} style={{ width: "100%", padding: 11, borderRadius: 9, border: `1px solid ${colors.hairline}`, background: "#fff", cursor: "pointer", fontSize: 14, fontWeight: 600 }}>
              Log out
            </button>
          </>
        ) : (
          <form onSubmit={submit}>
            <p style={{ fontSize: 13.5, color: colors.ink, lineHeight: 1.55, margin: "0 0 16px" }}>
              You've been invited to follow <strong>{preview.patient_name}</strong>'s recovery
              {preview.relationship ? ` as their ${preview.relationship.toLowerCase()}` : ""}. Like their caregiver, you'll be able to
              record daily check-ins, manage appointments, follow the care plan and write notes, so you can take over when the caregiver is away.
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
              <div>
                <label style={labelStyle}>First name</label>
                <input required value={first} onChange={(e) => setFirst(e.target.value)} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Last name</label>
                <input value={last} onChange={(e) => setLast(e.target.value)} style={inputStyle} />
              </div>
            </div>
            <label style={labelStyle}>Email</label>
            <input value={preview.invitee_email} readOnly style={{ ...inputStyle, background: colors.bg, marginBottom: 12 }} />
            {!session && (
              <>
                <label style={labelStyle}>{existingAccount ? "Your password" : "Choose a password"}</label>
                <div style={{ position: "relative", marginBottom: 6 }}>
                  <input
                    type={showPassword ? "text" : "password"}
                    required
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="At least 8 characters"
                    autoComplete={existingAccount ? "current-password" : "new-password"}
                    style={{ ...inputStyle, paddingRight: 40 }}
                  />
                  <button type="button" onClick={() => setShowPassword((v) => !v)} aria-label={showPassword ? "Hide password" : "Show password"} style={{ position: "absolute", right: 9, top: "50%", transform: "translateY(-50%)", border: "none", background: "none", cursor: "pointer", padding: 4, display: "flex", color: colors.inkFaint }}>
                    {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                  </button>
                </div>
                <div style={{ marginBottom: 14, minHeight: 16, fontSize: 13 }}>
                  {existingAccount ? (
                    resetSent
                      ? <span style={{ color: colors.sageDeep, fontWeight: 600 }}>Reset link sent to {preview.invitee_email}.</span>
                      : <button type="button" onClick={sendReset} style={{ border: "none", background: "none", padding: 0, color: colors.sageDeep, fontWeight: 600, fontSize: 13, cursor: "pointer", textDecoration: "underline" }}>Forgot your password?</button>
                  ) : strength
                    ? <span style={{ fontWeight: 700, color: strength.color }}>Password strength: {strength.label}</span>
                    : <span style={{ color: colors.inkFaint }}>Use at least 8 characters.</span>}
                </div>
              </>
            )}
            <button type="submit" disabled={busy} style={{ width: "100%", padding: 12, borderRadius: 9, border: "none", background: colors.sage, color: "#fff", fontWeight: 700, cursor: busy ? "default" : "pointer", opacity: busy ? 0.7 : 1, fontSize: 15 }}>
              {busy ? "Please wait..." : session ? "Accept invitation" : existingAccount ? "Sign in and accept" : "Create my account"}
            </button>
            {error && <p style={{ color: colors.rust, fontSize: 13, marginTop: 10, marginBottom: 0 }}>{error}</p>}
            {!session && (
              <button
                type="button"
                onClick={() => { setExistingAccount((v) => !v); setError(null); setPassword(""); setResetSent(false) }}
                style={{ display: "block", margin: "14px auto 0", border: "none", background: "none", padding: 0, color: colors.sageDeep, fontWeight: 600, fontSize: 13, cursor: "pointer", textDecoration: "underline" }}
              >
                {existingAccount ? "I don't have an account yet" : "I already confirmed my email or have an account"}
              </button>
            )}
          </form>
        )}
      </div>
    </div>
  )
}
