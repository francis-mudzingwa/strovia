import { useState, useEffect } from 'react'
import { Eye, EyeOff, MailCheck, CheckCircle2, AlertTriangle, ClipboardCheck, HeartHandshake, ShieldCheck } from 'lucide-react'
import { BirthdayFields } from "./Birthdays.jsx"
import { supabase } from './supabaseClient.js'

const colors = { sage: "#3F6C51", sageDeep: "#2C4E3A", sageTint: "#E3EBE0", bg: "#FAF6EF", ink: "#20261F", inkSoft: "#4B5245", inkFaint: "#6B7266", hairline: "#E5DFD1", rust: "#A24632", rustTint: "#F6E4DE", gold: "#B98A2E" }

export function passwordStrength(pw) {
  if (!pw) return null
  let score = 0
  if (pw.length >= 8) score++
  if (pw.length >= 12) score++
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++
  if (/[0-9]/.test(pw)) score++
  if (/[^A-Za-z0-9]/.test(pw)) score++
  if (score <= 1) return { label: "Weak", color: "#A24632" }
  if (score <= 3) return { label: "Medium", color: "#B98A2E" }
  return { label: "Strong", color: "#3F6C51" }
}

// The public try-it copy of the app (a separate project with made-up people and sample patients) is built with VITE_DEMO=true.
// It swaps the sign-in form for one-click demo buttons. The real app is never built with this switch.
const DEMO = import.meta.env.VITE_DEMO === "true"
const DEMO_ROLES = [
  { role: "caregiver", Icon: ClipboardCheck, title: "Caregiver", text: "Arrive on shift, do the daily check-in, log readings, medicines and meals." },
  { role: "relative", Icon: HeartHandshake, title: "Family", text: "Follow one person's recovery, read the care plan and step in as a proxy." },
  { role: "admin", Icon: ShieldCheck, title: "Administrator", text: "Write care plans, set alert limits, schedule shifts and review the audit trail." },
]
const COMPANY_ID_PATTERN = /^c\d{6}$/i
const DEVICE_KEY = "strovia-admin-device"
const readDeviceToken = () => { try { return localStorage.getItem(DEVICE_KEY) } catch { return null } }
const writeDeviceToken = (t) => { try { localStorage.setItem(DEVICE_KEY, t) } catch { /* not remembered on this device */ } }

const inputStyle = {
  width: "100%", padding: 12, borderRadius: 9, border: `1px solid ${colors.hairline}`,
  boxSizing: "border-box", fontSize: 15, background: "#fff", color: colors.ink,
}
const labelStyle = { fontSize: 13, fontWeight: 600, color: colors.ink, display: "block", marginBottom: 6 }
const primaryButton = (busy) => ({
  width: "100%", padding: 13, borderRadius: 9, border: "none", background: colors.sage, color: "#fff",
  fontWeight: 700, cursor: busy ? "default" : "pointer", opacity: busy ? 0.7 : 1, fontSize: 16,
  boxShadow: "0 4px 12px rgba(63,108,81,0.25)",
})

function PasswordField({ value, onChange, placeholder, show, onToggle, autoComplete, required = true }) {
  return (
    <div style={{ position: "relative" }}>
      <input
        type={show ? "text" : "password"}
        required={required}
        minLength={8}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        autoComplete={autoComplete}
        style={{ ...inputStyle, padding: "12px 40px 12px 12px" }}
      />
      <button
        type="button"
        onClick={onToggle}
        aria-label={show ? "Hide password" : "Show password"}
        style={{ position: "absolute", right: 9, top: "50%", transform: "translateY(-50%)", border: "none", background: "none", cursor: "pointer", padding: 9, display: "flex", color: colors.inkFaint }}
      >
        {show ? <EyeOff size={18} /> : <Eye size={18} />}
      </button>
    </div>
  )
}

const EMPTY_REG = {
  firstName: "", lastName: "", jobTitle: "", phone: "", organisation: "",
  companyId: "", email: "", password: "", confirm: "", bMonth: "", bDay: "",
}

export default function AuthCard({ banner }) {
  const [tab, setTab] = useState("login") // "login" | "register"
  const [identifier, setIdentifier] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [resetSent, setResetSent] = useState(false)
  const [codeStep, setCodeStep] = useState(null) // { challenge } once an administrator's code has been emailed
  const [code, setCode] = useState("")
  const [rememberDevice, setRememberDevice] = useState(false)
  const [codeBusy, setCodeBusy] = useState(false)
  const [codeError, setCodeError] = useState(null)
  const [resendingCode, setResendingCode] = useState(false)

  const [reg, setReg] = useState(EMPTY_REG)
  const [registered, setRegistered] = useState(null) // { email } once the sign-up request has been sent
  const [resendState, setResendState] = useState(null) // null | "sending" | "sent" | "failed"

  function switchTab(next) {
    setTab(next)
    setError(null)
    setResetSent(false)
  }

  const setField = (key) => (e) => setReg((r) => ({ ...r, [key]: e.target.value }))

  // Every failed login says the same thing, so it never reveals whether an ID or email exists.
  const LOGIN_FAILED = "Invalid Company ID or password. If you registered recently, make sure you have verified your email."

  async function handleLogin(e) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    const value = identifier.trim()
    if (COMPANY_ID_PATTERN.test(value)) {
      // A Company ID with no password is tried as the temporary Company-ID-only access (only the accounts the owner allowed, only
      // until the end date, decided by the server). Anyone else gets the same message as a wrong password.
      const body = { identifier: value, password, device_token: readDeviceToken() }
      const { data, error } = await supabase.functions.invoke("company-login", { body })
      if (data?.needs_code) {
        setCodeStep({ challenge: data.challenge })
      } else if (error || !data?.session) {
        setError(password ? (data?.error || LOGIN_FAILED) : LOGIN_FAILED)
      } else {
        await supabase.auth.setSession({ access_token: data.session.access_token, refresh_token: data.session.refresh_token })
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email: value, password })
      if (error) setError(LOGIN_FAILED)
    }
    setBusy(false)
  }

  async function handleDemo(role) {
    setError(null)
    setBusy(true)
    const { data, error } = await supabase.functions.invoke("demo-login", { body: { role } })
    if (error || !data?.session) {
      setError(data?.error || "The demo couldn't start just now. Please try again in a moment.")
    } else {
      await supabase.auth.setSession({ access_token: data.session.access_token, refresh_token: data.session.refresh_token })
    }
    setBusy(false)
  }

  // A link like /?try=family signs straight in as that demo role (used by the buttons and the live frame on the portfolio page).
  useEffect(() => {
    if (!DEMO) return
    const wanted = new URLSearchParams(window.location.search).get("try")
    if (DEMO_ROLES.some((r) => r.role === wanted)) {
      window.history.replaceState({}, "", window.location.pathname)
      handleDemo(wanted)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const demoPanel = (
    <div>
      <div style={{ fontSize: 19, fontWeight: 700, color: colors.ink, marginBottom: 5 }}>Try Strovia</div>
      <div style={{ fontSize: 13.5, color: colors.inkFaint, marginBottom: 18, lineHeight: 1.5 }}>
        No account needed. Pick a role and you are signed in at once. Everything here is made-up sample data, and it is reset every night. Nothing you do reaches a real person.
      </div>
      <div style={{ display: "grid", gap: 10 }}>
        {DEMO_ROLES.map(({ role, Icon, title, text }) => (
          <button
            key={role}
            type="button"
            disabled={busy}
            onClick={() => handleDemo(role)}
            style={{
              display: "flex", alignItems: "center", gap: 14, textAlign: "left", width: "100%", boxSizing: "border-box",
              padding: "14px 16px", borderRadius: 14, border: `1px solid ${colors.hairline}`, background: "#fff",
              cursor: busy ? "default" : "pointer", opacity: busy ? 0.7 : 1, color: colors.ink,
            }}
          >
            <span style={{ width: 44, height: 44, borderRadius: 12, background: colors.sageTint, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <Icon size={22} color={colors.sageDeep} />
            </span>
            <span style={{ flex: 1 }}>
              <span style={{ display: "block", fontSize: 16, fontWeight: 700 }}>{busy ? "Please wait..." : `Try as ${title}`}</span>
              <span style={{ display: "block", fontSize: 13.5, color: colors.inkSoft, lineHeight: 1.4, marginTop: 2 }}>{text}</span>
            </span>
          </button>
        ))}
      </div>
      {error && <p style={{ color: colors.rust, fontSize: 13.5, marginTop: 12, marginBottom: 0, lineHeight: 1.45 }}>{error}</p>}
      <p style={{ fontSize: 12.5, color: colors.inkFaint, marginTop: 16, marginBottom: 0, lineHeight: 1.5 }}>
        Strovia is a student prototype, not a medical device. Admins in the real app also confirm their sign-in with an emailed code; the demo skips that.
      </p>
    </div>
  )

  // The administrator's second step: the 6-digit code just emailed to them.
  async function handleVerifyCode(e) {
    e.preventDefault()
    setCodeError(null)
    setCodeBusy(true)
    const { data, error } = await supabase.functions.invoke("company-login", { body: { challenge: codeStep.challenge, code, remember_device: rememberDevice } })
    setCodeBusy(false)
    if (error || !data?.session) { setCodeError(data?.error || "That code is incorrect or has expired."); return }
    if (data.device_token) writeDeviceToken(data.device_token)
    setCodeStep(null)
    setCode("")
    await supabase.auth.setSession({ access_token: data.session.access_token, refresh_token: data.session.refresh_token })
  }

  async function handleResendCode() {
    setResendingCode(true)
    setCodeError(null)
    const { data, error } = await supabase.functions.invoke("company-login", { body: { identifier: identifier.trim(), password, device_token: readDeviceToken() } })
    setResendingCode(false)
    if (data?.needs_code) setCodeStep({ challenge: data.challenge })
    else setCodeError(data?.error || (error ? "Couldn't send a new code. Please try logging in again." : null))
  }

  async function handleForgot() {
    const value = identifier.trim()
    if (!value) { setError("Enter your Company ID or email above first, then tap Forgot password?"); return }
    setError(null)
    if (COMPANY_ID_PATTERN.test(value)) {
      await supabase.functions.invoke("company-login", { body: { action: "reset", identifier: value } })
    } else {
      await supabase.auth.resetPasswordForEmail(value)
    }
    // Same message whether or not the account exists, so it can't be used to probe for accounts.
    setResetSent(true)
  }

  async function handleRegister(e) {
    e.preventDefault()
    setError(null)
    if (reg.password.length < 8) { setError("Password must be at least 8 characters."); return }
    if (reg.password !== reg.confirm) { setError("The two passwords don't match."); return }
    setBusy(true)
    const email = reg.email.trim()
    const { error } = await supabase.auth.signUp({
      email,
      password: reg.password,
      options: {
        emailRedirectTo: `${window.location.origin}/?verified=staff`,
        data: {
          company_id: reg.companyId.trim().toUpperCase(),
          organisation: reg.organisation.trim(),
          first_name: reg.firstName.trim(),
          last_name: reg.lastName.trim(),
          job_title: reg.jobTitle.trim(),
          phone: reg.phone.trim(),
          birthday_month: reg.bMonth ? String(reg.bMonth) : "",
          birthday_day: reg.bDay ? String(reg.bDay) : "",
        },
      },
    })
    setBusy(false)
    if (error) {
      // The server refuses any Company ID outside the allowed range, and one that is already registered, with the same
      // answer, so a refusal never says which of the two it was.
      if (/database error|company_id_not_accepted/i.test(error.message)) {
        setError("That Company ID can't be used to register. Check that it is typed exactly as you were given it (letters and numbers only, no spaces), or contact your administrator.")
      } else {
        setError("We couldn't complete your registration right now. Please try again in a few minutes.")
      }
      return
    }
    // An email that already has an account looks exactly like a new sign-up, so emails can't be probed.
    setRegistered({ email })
  }

  async function handleResend() {
    setResendState("sending")
    const { error } = await supabase.auth.resend({
      type: "signup",
      email: registered.email,
      options: { emailRedirectTo: `${window.location.origin}/?verified=staff` },
    })
    setResendState(error ? "failed" : "sent")
  }

  const strength = passwordStrength(reg.password)
  const bannerColor = banner?.type === "error" ? colors.rust : colors.sageDeep
  const bannerBg = banner?.type === "error" ? colors.rustTint : colors.sageTint

  return (
    <div style={{ background: "#fff", padding: 30, borderRadius: 22, boxSizing: "border-box", border: `1px solid ${colors.hairline}`, boxShadow: "0 12px 32px rgba(44,78,58,0.08)" }}>
      {banner && (
        <div style={{ background: bannerBg, color: bannerColor, borderRadius: 11, padding: "12px 14px", marginBottom: 18, display: "flex", gap: 10, alignItems: "flex-start", fontSize: 13.5, lineHeight: 1.45 }}>
          {banner.type === "error" ? <AlertTriangle size={17} style={{ flexShrink: 0, marginTop: 1 }} /> : <CheckCircle2 size={17} style={{ flexShrink: 0, marginTop: 1 }} />}
          <span>{banner.text}</span>
        </div>
      )}

      {codeStep ? (
        <div>
          <div style={{ fontSize: 19, fontWeight: 700, color: colors.ink, marginBottom: 5 }}>Enter your sign-in code</div>
          <p style={{ fontSize: 13.5, color: colors.inkFaint, marginBottom: 18, lineHeight: 1.5 }}>
            We've emailed a 6-digit code to confirm it's really you. It's valid for 10 minutes.
          </p>
          <form onSubmit={handleVerifyCode}>
            <label style={labelStyle}>Code</label>
            <input
              type="text" inputMode="numeric" pattern="[0-9]*" maxLength={6} required autoFocus
              value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="123456" autoComplete="one-time-code"
              style={{ ...inputStyle, marginBottom: 14, letterSpacing: 6, fontSize: 20, textAlign: "center" }}
            />
            <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, fontSize: 13.5, color: colors.ink, cursor: "pointer" }}>
              <input type="checkbox" checked={rememberDevice} onChange={(e) => setRememberDevice(e.target.checked)} style={{ width: 17, height: 17 }} />
              Remember this device for 30 days
            </label>
            <button type="submit" disabled={codeBusy || code.length !== 6} style={primaryButton(codeBusy)}>
              {codeBusy ? "Checking..." : "Confirm"}
            </button>
            {codeError && <p style={{ color: colors.rust, fontSize: 13.5, marginTop: 11, marginBottom: 0, lineHeight: 1.45 }}>{codeError}</p>}
          </form>
          <div style={{ textAlign: "center", marginTop: 16, display: "flex", flexDirection: "column", gap: 10 }}>
            <button
              onClick={handleResendCode}
              disabled={resendingCode}
              style={{ border: "none", background: "none", color: colors.sageDeep, fontSize: 13, cursor: "pointer", textDecoration: "underline", padding: 0 }}
            >
              {resendingCode ? "Sending..." : "Send a new code"}
            </button>
            <button
              onClick={() => { setCodeStep(null); setCode(""); setCodeError(null) }}
              style={{ border: "none", background: "none", color: colors.inkFaint, fontSize: 13, cursor: "pointer", padding: 0 }}
            >
              ← Back to log in
            </button>
          </div>
        </div>
      ) : registered ? (
        <div style={{ textAlign: "center" }}>
          <div style={{ width: 56, height: 56, borderRadius: 16, background: colors.sageTint, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px" }}>
            <MailCheck size={28} color={colors.sageDeep} />
          </div>
          <div style={{ fontSize: 19, fontWeight: 700, color: colors.ink, marginBottom: 8 }}>Check your email</div>
          <p style={{ fontSize: 14, color: colors.inkSoft, lineHeight: 1.55, margin: "0 0 14px" }}>
            If the details you entered can be registered, we've sent a verification link to <strong>{registered.email}</strong>. Open it to activate your account, then log in with your Company ID and password.
          </p>
          <button
            onClick={() => { setRegistered(null); setReg(EMPTY_REG); setResendState(null); setTab("login") }}
            style={primaryButton(false)}
          >
            Go to log in
          </button>
          <div style={{ marginTop: 14, fontSize: 13, color: colors.inkFaint }}>
            {resendState === "sent" ? "If a verification email is due, it has been sent again." : (
              <>
                Didn't get it?{" "}
                <button
                  onClick={handleResend}
                  disabled={resendState === "sending"}
                  style={{ border: "none", background: "none", color: colors.sageDeep, fontSize: 13, cursor: "pointer", textDecoration: "underline", padding: 0 }}
                >
                  {resendState === "sending" ? "Sending..." : "Resend email"}
                </button>
              </>
            )}
            {resendState === "failed" && <div style={{ color: colors.rust, marginTop: 6 }}>Couldn't send right now. Please try again in a few minutes.</div>}
          </div>
        </div>
      ) : (
        <>
          {DEMO ? demoPanel : tab === "login" ? (
            <>
              <div style={{ fontSize: 19, fontWeight: 700, color: colors.ink, marginBottom: 5 }}>Welcome back</div>
              <div style={{ fontSize: 13.5, color: colors.inkFaint, marginBottom: 20 }}>Caregivers log in with their Company ID. Family members log in with their email.</div>
              <form onSubmit={handleLogin}>
                <label style={labelStyle}>Company ID or family email</label>
                <input
                  type="text"
                  required
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder="Company ID, or email for family"
                  autoComplete="username"
                  style={{ ...inputStyle, marginBottom: 14 }}
                />
                <label style={labelStyle}>Password</label>
                <div style={{ marginBottom: 16 }}>
                  <PasswordField
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Password"
                    required={!COMPANY_ID_PATTERN.test(identifier.trim())}
                    show={showPassword}
                    onToggle={() => setShowPassword((v) => !v)}
                    autoComplete="current-password"
                  />
                </div>
                <button type="submit" disabled={busy} style={primaryButton(busy)}>
                  {busy ? "Please wait..." : "Log In"}
                </button>
                {error && <p style={{ color: colors.rust, fontSize: 13.5, marginTop: 11, marginBottom: 0, lineHeight: 1.45 }}>{error}</p>}
              </form>
              <div style={{ textAlign: "center", marginTop: 14 }}>
                {resetSent ? (
                  <p style={{ fontSize: 13, color: colors.inkFaint, margin: 0 }}>If an account matches, a password reset email is on its way.</p>
                ) : (
                  <button
                    onClick={handleForgot}
                    style={{ border: "none", background: "none", color: colors.sageDeep, fontSize: 13, cursor: "pointer", textDecoration: "underline", padding: "10px 12px", margin: "-10px -12px" }}
                  >
                    Forgot password?
                  </button>
                )}
              </div>
              <div style={{ marginTop: 18, paddingTop: 16, borderTop: `1px solid ${colors.hairline}`, textAlign: "center" }}>
                <button
                  onClick={() => switchTab("register")}
                  style={{ border: "none", background: "none", color: colors.sageDeep, fontSize: 14.5, fontWeight: 700, cursor: "pointer", textDecoration: "underline", padding: "10px 12px", margin: "-10px -12px" }}
                >
                  Register account
                </button>
              </div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 19, fontWeight: 700, color: colors.ink, marginBottom: 5 }}>Register your organisation account</div>
              <div style={{ fontSize: 13.5, color: colors.inkFaint, marginBottom: 20, lineHeight: 1.45 }}>
                We'll email you a link to verify your address. After that, you log in with your Company ID.
              </div>
              <form onSubmit={handleRegister}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
                  <div>
                    <label style={labelStyle}>First name</label>
                    <input required value={reg.firstName} onChange={setField("firstName")} autoComplete="given-name" style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>Last name</label>
                    <input required value={reg.lastName} onChange={setField("lastName")} autoComplete="family-name" style={inputStyle} />
                  </div>
                </div>

                <label style={labelStyle}>Job title</label>
                <input required value={reg.jobTitle} onChange={setField("jobTitle")} placeholder="e.g. Care coordinator" autoComplete="organization-title" style={{ ...inputStyle, marginBottom: 14 }} />

                <label style={labelStyle}>Organisation</label>
                <input required value={reg.organisation} onChange={setField("organisation")} placeholder="e.g. Riverside Rehabilitation Centre" autoComplete="organization" style={{ ...inputStyle, marginBottom: 14 }} />

                <label style={labelStyle}>Company ID</label>
                <input
                  required
                  value={reg.companyId}
                  onChange={setField("companyId")}
                  placeholder="The Company ID you were given"
                  autoComplete="off"
                  autoCapitalize="characters"
                  style={{ ...inputStyle, marginBottom: 6, textTransform: "uppercase" }}
                />
                <div style={{ fontSize: 13, color: colors.inkFaint, marginBottom: 14, lineHeight: 1.4 }}>
                  This becomes your username when you log in.
                </div>

                <label style={labelStyle}>Phone (optional)</label>
                <input type="tel" value={reg.phone} onChange={setField("phone")} autoComplete="tel" style={{ ...inputStyle, marginBottom: 14 }} />

                <div style={{ marginBottom: 14 }}>
                  <BirthdayFields required month={reg.bMonth} day={reg.bDay} onChange={(m, d) => setReg((r) => ({ ...r, bMonth: m, bDay: d }))} selectStyle={inputStyle} labelStyle={labelStyle} />
                </div>

                <label style={labelStyle}>Work email</label>
                <input type="email" required value={reg.email} onChange={setField("email")} placeholder="you@organisation.com" autoComplete="email" style={{ ...inputStyle, marginBottom: 14 }} />

                <label style={labelStyle}>Choose a password</label>
                <div style={{ marginBottom: 7 }}>
                  <PasswordField
                    value={reg.password}
                    onChange={setField("password")}
                    placeholder="At least 8 characters"
                    show={showPassword}
                    onToggle={() => setShowPassword((v) => !v)}
                    autoComplete="new-password"
                  />
                </div>
                <div style={{ marginBottom: 14, minHeight: 16 }}>
                  {strength ? (
                    <span style={{ fontSize: 13, fontWeight: 700, color: strength.color }}>Password strength: {strength.label}</span>
                  ) : (
                    <span style={{ fontSize: 13, color: colors.inkFaint }}>Use at least 8 characters — mix in a number or symbol for a stronger password.</span>
                  )}
                </div>

                <label style={labelStyle}>Confirm password</label>
                <div style={{ marginBottom: 18 }}>
                  <PasswordField
                    value={reg.confirm}
                    onChange={setField("confirm")}
                    placeholder="Re-enter your password"
                    show={showPassword}
                    onToggle={() => setShowPassword((v) => !v)}
                    autoComplete="new-password"
                  />
                </div>

                <button type="submit" disabled={busy} style={primaryButton(busy)}>
                  {busy ? "Please wait..." : "Register"}
                </button>
                {error && <p style={{ color: colors.rust, fontSize: 13.5, marginTop: 11, marginBottom: 0, lineHeight: 1.45 }}>{error}</p>}
              </form>
              <button
                onClick={() => switchTab("login")}
                style={{ marginTop: 16, width: "100%", textAlign: "center", border: "none", background: "none", color: colors.sageDeep, fontSize: 13.5, cursor: "pointer", textDecoration: "underline" }}
              >
                ← Back to log in
              </button>
            </>
          )}
        </>
      )}
    </div>
  )
}
