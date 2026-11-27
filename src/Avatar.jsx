import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import { Camera } from "lucide-react"
import { supabase } from "./supabaseClient.js"
import { colors } from "./care/ui.jsx"

// Profile pictures. Photos are kept in a private bucket, so each one is fetched through a short-lived link.
// Screens only need to say WHO (a user id and a name): the picture's location is learned from the people lists
// the app already loads (registerAvatars), and anyone without a photo gets their initials as before.

const paths = new Map() // user id -> storage path, or null when they have no photo
const links = new Map() // storage path -> { url, expires } | { failed: time }
const asked = new Set() // paths already requested and waiting
let version = 0
const listeners = new Set()
const emit = () => { version += 1; listeners.forEach((l) => l()) }
const subscribe = (l) => { listeners.add(l); return () => listeners.delete(l) }
const LINK_SECONDS = 3600

// Tell the app where people's photos are. Accepts rows that carry user_id (or id) and avatar_path.
export function registerAvatars(rows) {
  let changed = false
  for (const r of rows || []) {
    const id = r?.user_id || r?.id
    if (!id) continue
    const p = r.avatar_path || null
    if (paths.get(id) !== p) { paths.set(id, p); changed = true }
  }
  if (changed) emit()
}

let timer = null
function ask(path) {
  if (asked.has(path)) return
  asked.add(path)
  if (timer) return
  timer = setTimeout(async () => {
    timer = null
    const batch = [...asked]
    asked.clear()
    const { data } = await supabase.storage.from("avatars").createSignedUrls(batch, LINK_SECONDS)
    const now = Date.now()
    batch.forEach((p) => {
      const hit = (data || []).find((d) => d.path === p)
      if (hit && hit.signedUrl && !hit.error) links.set(p, { url: hit.signedUrl, expires: now + (LINK_SECONDS - 300) * 1000 })
      else links.set(p, { failed: now })
    })
    emit()
  }, 25)
}

function useAvatarUrl(userId) {
  useSyncExternalStore(subscribe, () => version)
  const path = userId ? paths.get(userId) : null
  const link = path ? links.get(path) : null
  const usable = link && link.url && link.expires > Date.now()
  const retry = link && link.failed && Date.now() - link.failed > 5 * 60 * 1000
  const needs = !!path && (!link || (link.url && !usable) || retry)
  useEffect(() => { if (needs) ask(path) }, [needs, path])
  return usable ? link.url : null
}

const initialsOf = (name) => (String(name || "").trim().split(/\s+/).map((w) => w[0]).join("").slice(0, 2) || "?").toUpperCase()

// A round picture, or the person's initials when there is no photo. Pass `tone` as [background, text] to colour the initials.
export function Avatar({ userId, name, size = 32, tone, fontSize, style, title }) {
  const url = useAvatarUrl(userId)
  const [broken, setBroken] = useState(null)
  const [bg, fg] = tone || [colors.sageTint, colors.sageDeep]
  const showPhoto = url && broken !== url
  return (
    <span
      title={title}
      style={{ width: size, height: size, borderRadius: 999, background: showPhoto ? colors.hairline : bg, color: fg, fontWeight: 700, fontSize: fontSize || Math.max(11, Math.round(size * 0.4)), display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0, overflow: "hidden", boxSizing: "border-box", ...style }}
    >
      {showPhoto ? <img src={url} alt="" onError={() => setBroken(url)} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} /> : initialsOf(name)}
    </span>
  )
}

// Crop to a centred square and shrink to 320 x 320, so a phone photo of several megabytes becomes a few tens of kilobytes.
async function squareJpeg(file, side = 320) {
  let bmp
  try {
    bmp = await createImageBitmap(file, { imageOrientation: "from-image" })
  } catch {
    bmp = await new Promise((resolve, reject) => {
      const img = new Image()
      const u = URL.createObjectURL(file)
      img.onload = () => { URL.revokeObjectURL(u); resolve(img) }
      img.onerror = () => { URL.revokeObjectURL(u); reject(new Error("unreadable")) }
      img.src = u
    })
  }
  const w = bmp.width || bmp.naturalWidth
  const h = bmp.height || bmp.naturalHeight
  const s = Math.min(w, h)
  const canvas = document.createElement("canvas")
  canvas.width = side
  canvas.height = side
  const ctx = canvas.getContext("2d")
  ctx.fillStyle = "#fff"
  ctx.fillRect(0, 0, side, side)
  ctx.drawImage(bmp, (w - s) / 2, (h - s) / 2, s, s, 0, 0, side, side)
  return await new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("unreadable"))), "image/jpeg", 0.86))
}

// The Profile screen's picture and its Add / Change / Remove buttons.
export function ProfilePhoto({ userId, name, avatarPath, onChanged, size = 72 }) {
  const input = useRef(null)
  const cam = useRef(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => { registerAvatars([{ user_id: userId, avatar_path: avatarPath }]) }, [userId, avatarPath])

  async function choose(e) {
    const file = e.target.files && e.target.files[0]
    e.target.value = ""
    if (!file) return
    setError(null)
    setBusy(true)
    try {
      const blob = await squareJpeg(file)
      const path = `${userId}/${Date.now()}.jpg`
      const up = await supabase.storage.from("avatars").upload(path, blob, { contentType: "image/jpeg" })
      if (up.error) throw up.error
      const { error: rpcError } = await supabase.rpc("set_my_avatar", { p_path: path })
      if (rpcError) { await supabase.storage.from("avatars").remove([path]); throw rpcError }
      if (avatarPath) await supabase.storage.from("avatars").remove([avatarPath])
      registerAvatars([{ user_id: userId, avatar_path: path }])
      onChanged(path)
    } catch (err) {
      setError(err && err.message === "unreadable" ? "That file isn't a picture we can read. Please choose a JPG or PNG photo." : "Your photo couldn't be saved. Please try again.")
    }
    setBusy(false)
  }

  async function remove() {
    setError(null)
    setBusy(true)
    const { error: rpcError } = await supabase.rpc("set_my_avatar", { p_path: null })
    if (rpcError) { setError("Your photo couldn't be removed. Please try again."); setBusy(false); return }
    if (avatarPath) await supabase.storage.from("avatars").remove([avatarPath])
    registerAvatars([{ user_id: userId, avatar_path: null }])
    onChanged(null)
    setBusy(false)
  }

  const link = { border: "none", background: "none", padding: 0, fontSize: 13, fontWeight: 700, cursor: busy ? "default" : "pointer", color: colors.sageDeep }
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16, minWidth: 0, marginBottom: 16 }}>
      <input ref={input} type="file" accept="image/*" onChange={choose} style={{ display: "none" }} aria-label="Choose a profile photo" />
      <input ref={cam} type="file" accept="image/*" capture="user" onChange={choose} style={{ display: "none" }} aria-label="Take a profile photo" />
      <button
        type="button"
        onClick={() => !busy && input.current && input.current.click()}
        aria-label={avatarPath ? "Change your photo" : "Add a photo"}
        style={{ position: "relative", border: "none", background: "none", padding: 0, cursor: busy ? "default" : "pointer", width: size, height: size, borderRadius: 999, flexShrink: 0 }}
      >
        <Avatar userId={userId} name={name} size={size} tone={[colors.sage, "#fff"]} fontSize={Math.round(size * 0.4)} />
        <span style={{ position: "absolute", right: -2, bottom: -2, width: 24, height: 24, borderRadius: 999, background: "#fff", border: `1.5px solid ${colors.hairline}`, display: "flex", alignItems: "center", justifyContent: "center", color: colors.sageDeep }}>
          <Camera size={13} />
        </span>
      </button>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 14 }}>
          {busy ? (
            <span style={{ color: colors.inkSoft, fontWeight: 600 }}>Saving...</span>
          ) : (
            <>
              <button type="button" onClick={() => cam.current && cam.current.click()} style={{ ...link, fontSize: 14, padding: "9px 0" }}>Take a photo</button>
              <button type="button" onClick={() => input.current && input.current.click()} style={{ ...link, fontSize: 14, padding: "9px 0" }}>{avatarPath ? "Choose another photo" : "Choose from photos"}</button>
              {avatarPath && <button type="button" onClick={remove} style={{ ...link, fontSize: 14, color: colors.inkSoft, fontWeight: 600 }}>Remove</button>}
            </>
          )}
        </div>
        <div style={{ fontSize: 13, color: colors.inkFaint, marginTop: 3, lineHeight: 1.4 }}>
          {avatarPath ? "Your team sees this photo next to your name." : "A clear photo helps your team know who is who."}
        </div>
        {error && <p style={{ color: colors.rust, fontSize: 13, margin: "4px 0 0", lineHeight: 1.4 }}>{error}</p>}
      </div>
    </div>
  )
}
