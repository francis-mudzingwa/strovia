import { supabase } from "../supabaseClient.js"

// Word, PDF and photo files, up to 10 MB, kept in a private bucket.
const TYPES = {
  pdf: "application/pdf", doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
}
export const ACCEPT = ".pdf,.doc,.docx,.jpg,.jpeg,.png,.webp,image/*"
export const MAX_BYTES = 10 * 1024 * 1024
export const extOf = (name) => (String(name).split(".").pop() || "").toLowerCase()
export const typeOf = (file) => TYPES[extOf(file.name)] || null
export const safeName = (name) => String(name).normalize("NFKD").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(-80) || "file"

// Returns a sentence to show the person, or null when the file is fine.
export function checkFile(file) {
  if (!file) return "Choose a file first."
  if (!typeOf(file)) return "Please choose a Word, PDF or photo file."
  if (file.size > MAX_BYTES) return "That file is bigger than 10 MB."
  return null
}

// Returns an error object, or null.
export async function uploadFile(path, file) {
  const { error } = await supabase.storage.from("training-files").upload(path, file, { contentType: typeOf(file) })
  return error || null
}

// PDFs and photos open in a new tab; Word files download.
export async function openFile(path, name) {
  const inline = ["pdf", "jpg", "jpeg", "png", "webp"].includes(extOf(path))
  const w = inline ? window.open("", "_blank") : null
  const { data, error } = await supabase.storage.from("training-files").createSignedUrl(path, 600, inline ? undefined : { download: name || true })
  if (error || !data?.signedUrl) { if (w) w.close(); return false }
  if (inline) {
    if (w) w.location.href = data.signedUrl
    else window.location.href = data.signedUrl
  } else {
    const a = document.createElement("a")
    a.href = data.signedUrl
    a.download = name || ""
    document.body.appendChild(a)
    a.click()
    a.remove()
  }
  return true
}
