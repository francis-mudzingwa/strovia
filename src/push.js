import { supabase } from "./supabaseClient.js"

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY

function keyToBytes(base64Url) {
  const padded = base64Url + "=".repeat((4 - (base64Url.length % 4)) % 4)
  const raw = atob(padded.replace(/-/g, "+").replace(/_/g, "/"))
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}

export const pushSupported = () =>
  !!VAPID_PUBLIC_KEY && typeof window !== "undefined" &&
  "serviceWorker" in navigator && "PushManager" in window && "Notification" in window

export const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent)
export const isInstalledApp = () =>
  window.matchMedia?.("(display-mode: standalone)").matches || navigator.standalone === true

async function currentSubscription() {
  const reg = await navigator.serviceWorker.getRegistration("/")
  return reg ? reg.pushManager.getSubscription() : null
}

// "unsupported" | "denied" | "off" | "on" — "on" means this device is subscribed AND belongs to the signed-in account.
export async function getPushState() {
  if (!pushSupported()) return "unsupported"
  if (Notification.permission === "denied") return "denied"
  try {
    const sub = await currentSubscription()
    if (!sub) return "off"
    const { data } = await supabase.from("push_subscriptions").select("endpoint").eq("endpoint", sub.endpoint).maybeSingle()
    return data ? "on" : "off"
  } catch {
    return "off"
  }
}

export async function enablePush() {
  if (!pushSupported()) return { state: "unsupported" }
  const permission = await Notification.requestPermission()
  if (permission !== "granted") return { state: "denied" }
  try {
    await navigator.serviceWorker.register("/sw.js")
    const reg = await navigator.serviceWorker.ready
    const sub =
      (await reg.pushManager.getSubscription()) ||
      (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(VAPID_PUBLIC_KEY) }))
    const json = sub.toJSON()
    const { error } = await supabase.rpc("save_push_subscription", {
      p_endpoint: json.endpoint,
      p_p256dh: json.keys.p256dh,
      p_auth: json.keys.auth,
      p_user_agent: navigator.userAgent.slice(0, 200),
    })
    if (error) return { state: "off", error: error.message }
    return { state: "on" }
  } catch (e) {
    return { state: "off", error: e.message || "Couldn't turn on alerts on this device." }
  }
}

export async function disablePush() {
  try {
    const sub = await currentSubscription()
    if (sub) {
      await supabase.rpc("remove_push_subscription", { p_endpoint: sub.endpoint })
      await sub.unsubscribe()
    }
  } catch { /* nothing to undo */ }
  return "off"
}

// Asks the server to push a test notification to every device this account has enabled.
export async function sendTestPush() {
  const { data, error } = await supabase.functions.invoke("send-reminders", { body: { action: "test" } })
  if (error) return { error: "The alert service isn't reachable yet. Check that it has been set up." }
  return { sent: data?.sent ?? 0 }
}
