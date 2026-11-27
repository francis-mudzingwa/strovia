// The public try-it copy sets VITE_OFFICE_PHONE to a made-up number so it never shows a real one.
export const OFFICE_PHONE = import.meta.env.VITE_OFFICE_PHONE || "(555) 010-0100"

export const telHref = (phone) => `tel:${String(phone || "").replace(/[^\d+]/g, "")}`

export function ageFromDob(dob) {
  if (!dob) return null
  const born = new Date(dob + "T00:00:00")
  if (Number.isNaN(born.getTime())) return null
  const now = new Date()
  let age = now.getFullYear() - born.getFullYear()
  const beforeBirthday = now.getMonth() < born.getMonth() || (now.getMonth() === born.getMonth() && now.getDate() < born.getDate())
  if (beforeBirthday) age--
  return age
}

// Emergency: the B.E. F.A.S.T. signs plus other life-threatening events.
export const CALL_911_IF = [
  "Balance — sudden loss of balance, dizziness or trouble walking",
  "Eyes — sudden vision loss or double vision",
  "Face — one side of the face drooping",
  "Arms — sudden weakness or numbness in an arm or leg",
  "Speech — slurred speech, confusion, or trouble understanding",
  "Time — note when it started, then call 911 straight away",
  "A sudden, severe headache unlike any before",
  "A seizure, or the person cannot be woken",
  "Chest pain, or difficulty breathing",
  "Choking that does not clear, or a fall with a head injury or suspected broken bone",
]

// Not an emergency, but the care team needs to hear about it the same day.
export const CALL_OFFICE_IF = [
  "Any change in symptoms — weakness, numbness, speech or vision that is different from usual but not sudden or severe",
  "A new or worsening symptom flagged by Strovia's daily check-in",
  "A fall, even without injury",
  "Missed or refused medication, or a suspected side effect",
  "Blood pressure or blood sugar readings outside the range set by the care team",
  "Coughing or choking during meals, or a wet-sounding voice after drinking",
  "New swelling, redness or pain in a leg or arm",
  "New confusion, low mood, anxiety or a marked change in sleep or appetite",
  "Skin redness or sores where the person sits or lies",
  "A hospital or emergency visit, new prescription, or any change to this care plan",
  "The regular caregiver cannot attend, or equipment is broken or missing",
]

export const SERVICES = [
  { name: "Nursing check", detail: "Vital signs, blood pressure and blood glucose review, medication check, skin check.", frequency: "2 visits per week for 6 weeks, then weekly" },
  { name: "Physical therapy", detail: "Balance, walking, leg and core strength; transfers and safe use of the cane or walker.", frequency: "3 sessions per week" },
  { name: "Occupational therapy", detail: "Dressing, bathing, cooking and hand and arm function; home safety review.", frequency: "2 sessions per week" },
  { name: "Speech-language therapy", detail: "Speech clarity, understanding and swallowing safety.", frequency: "2 sessions per week" },
  { name: "Personal care", detail: "Help with bathing, dressing and toileting as needed. Stand-by assistance for the shower.", frequency: "Daily, mornings" },
  { name: "Medication reminders", detail: "Set up the weekly pill organiser and confirm each dose is taken.", frequency: "Daily" },
  { name: "Meals", detail: "Heart-healthy, low-salt, blood-sugar-friendly meals. Encourage fluids.", frequency: "Daily" },
  { name: "Daily Strovia check-in", detail: "Rate balance, eyes, face, arms and speech, and note when anything started.", frequency: "Once every day" },
  { name: "Transport", detail: "Rides to therapy and clinic appointments.", frequency: "As scheduled" },
]

export const EQUIPMENT = [
  "Cane (quad or single-point) — walker if therapy advises",
  "Shower chair, hand-held shower and grab bars",
  "Raised toilet seat",
  "Non-slip footwear; keep walkways clear and well lit",
  "Gait belt for caregiver-assisted transfers",
  "Home blood pressure monitor and glucose meter",
  "Weekly pill organiser",
]

export const MEDICATION_CATEGORIES = [
  "Blood-thinning or antiplatelet medicine to help prevent another stroke",
  "Cholesterol-lowering medicine",
  "Blood pressure medicine",
  "Diabetes / blood-sugar medicine",
  "Heart medicines for the heart condition on record",
]

export const DIET = [
  "Low salt, heart-healthy eating (vegetables, fruit, whole grains, lean protein)",
  "Steady carbohydrate intake to keep blood sugar in range",
  "Sit fully upright to eat; small bites and unhurried meals",
  "Use thickened fluids or softer foods only if the speech-language therapist advises",
  "No smoking — the person has quit and should be supported to stay smoke-free",
]

export const FOLLOW_UPS = [
  { who: "Neurology", when: "Every 4 to 6 weeks in the first 3 months" },
  { who: "Primary care", when: "Within 2 weeks of any hospital stay, then every 3 months" },
  { who: "Cardiology", when: "As directed, for the heart condition and stroke prevention" },
  { who: "Diabetes / blood sugar review", when: "Every 3 months, or sooner if readings are high" },
  { who: "Vision check", when: "If any change in vision is noticed" },
]

export const ADDITIONAL_INFO = [
  "Watch for low mood or anxiety, which are common after a stroke, and report changes to the office.",
  "Fatigue is expected. Plan rest between therapy sessions and avoid over-doing it on good days.",
  "Encourage the person to do as much as they safely can for themselves.",
  "Everyone in the home should know the B.E. F.A.S.T. signs and this plan's emergency steps.",
]

export const FALL_PRECAUTIONS = [
  "Use the cane or walker every time the person walks",
  "Stand by, close, for bathing, stairs and getting in and out of the car",
  "Keep floors clear; remove loose rugs; use night lights",
  "Rise slowly from lying or sitting to avoid dizziness",
]

// What carers tick off each day. The administrator can change this list for each patient.
// It starts empty: medicines and exercises have their own tabs, and meals have their own log (Today > Meals), so a tick here would only
// repeat them. An administrator can still add any custom task (and give it Morning / Afternoon / Evening) in the care plan.
export const DEFAULT_TASKS = []
export const DEFAULT_TASK_TIMES = {}

// The standard stroke care plan. Whatever an administrator saves for a patient replaces the matching part.
export const DEFAULT_PLAN = {
  tasks: DEFAULT_TASKS,
  taskTimes: DEFAULT_TASK_TIMES,
  ranges: {},
  medSchedule: [],
  fallRisk: "High",
  fallPrecautions: FALL_PRECAUTIONS,
  allergies: "No known drug allergies recorded. Confirm with the client, family and prescriber before any new medicine.",
  equipment: EQUIPMENT,
  services: SERVICES,
  medications: MEDICATION_CATEGORIES,
  diet: DIET,
  followUps: FOLLOW_UPS,
  additional: ADDITIONAL_INFO,
  callOfficeIf: CALL_OFFICE_IF,
  call911If: CALL_911_IF,
  review: "Every 30 days, and after any change",
}

export function resolveCarePlan(saved, profile) {
  const plan = { ...DEFAULT_PLAN, goals: profile?.recoveryGoals || [], ...(saved || {}) }
  // A plan that has its own task list uses its own times (or none); only the built-in list gets the built-in times. The database
  // applies the same rule, so what the screen blocks and what the database refuses always agree.
  if (saved && Object.prototype.hasOwnProperty.call(saved, "tasks")) plan.taskTimes = saved.taskTimes || {}
  return plan
}
