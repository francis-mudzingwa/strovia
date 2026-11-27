import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Public try-it copy only: a link such as /?try=caregiver starts from a clean slate, so the role in the link is the role you get
// even if someone was already signed in on this browser. The real app never builds with VITE_DEMO, so this never runs there.
if (import.meta.env.VITE_DEMO === "true" && typeof window !== "undefined" && new URLSearchParams(window.location.search).has("try")) {
  try { Object.keys(localStorage).filter((k) => k.startsWith("sb-")).forEach((k) => localStorage.removeItem(k)) } catch { /* storage unavailable */ }
}

// Until you add real values to .env, userId stays null in main.jsx below,
// so the app never actually calls Supabase (it just shows the demo data).
export const supabase = createClient(
  supabaseUrl || "https://placeholder.supabase.co",
  supabaseAnonKey || "placeholder-key"
);
